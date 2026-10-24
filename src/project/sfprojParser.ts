import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { listDirectories, listFiles, pathExists, readTextFile, resolveAgainst } from '../util/fs';
import { buildPropertyMap, type RawProperty, type RawPropertyGroup } from './msbuildPropertyExpander';
import type {
	ApplicationManifest,
	ApplicationParameter,
	ApplicationProject,
	ServiceEndpoint,
	ServiceManifest,
	ServiceManifestRef,
	SfProjFile,
} from './sfprojModel';

// fast-xml-parser output is an untyped tree of objects/arrays/strings.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = any;

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	allowBooleanAttributes: true,
	parseAttributeValue: false,
	parseTagValue: false,
	trimValues: true,
	isArray: (name, _jpath, _isLeaf, _isAttr) => MULTI_ELEMENTS.has(name),
});

const MULTI_ELEMENTS = new Set([
	'ProjectReference',
	'Parameter',
	'ServiceManifestImport',
	'CodePackage',
	'ConfigPackage',
	'DataPackage',
	'Endpoint',
	'PropertyGroup',
	'ItemGroup',
	'None',
	'Content',
]);

export async function parseSfProj(absPath: string): Promise<SfProjFile> {
	const text = await readTextFile(absPath);
	const directory = path.dirname(absPath);
	const tree: XmlNode = xml.parse(text);
	const project: XmlNode = tree?.Project ?? {};
	const propertyGroups: XmlNode[] = ensureArray(project.PropertyGroup);
	const itemGroups: XmlNode[] = ensureArray(project.ItemGroup);
	const projectGuid = firstScalar(propertyGroups, 'ProjectGuid');
	const projectVersion = firstScalar(propertyGroups, 'ProjectVersion');
	const apkgRoot = firstScalar(propertyGroups, 'ApplicationPackageRootFolder') ?? 'ApplicationPackageRoot';
	// 1.1.9 — collect every <PropertyGroup> block (with its Condition
	// attribute) and pre-expand the scalars we expose on SfProjFile. The
	// deploy flow re-derives the property map with a non-Debug Configuration
	// when needed; callers reading SfProjFile.outputPath / .packageLocation
	// out-of-band see the Debug-resolved values, which matches the historical
	// hardcode in deployFlow.ts.
	const rawPropertyGroups = collectRawPropertyGroups(propertyGroups);
	const intrinsics = new Map<string, string>([
		['MSBuildProjectName', path.basename(absPath, path.extname(absPath))],
		['MSBuildProjectFile', path.basename(absPath)],
		['MSBuildProjectExtension', path.extname(absPath)],
		['MSBuildProjectDirectory', directory],
		['MSBuildThisFileDirectory', directory + path.sep],
		['MSBuildThisFileFullPath', absPath],
	]);
	const properties = buildPropertyMap({
		propertyGroups: rawPropertyGroups,
		intrinsics,
		configuration: 'Debug',
	});
	// Read post-expansion values from the property map (honors Conditioned
	// <PropertyGroup>s — `firstScalar` is document-order-first and would
	// silently ignore Condition="'$(Configuration)' == ..."). Track any
	// tokens still unresolved after the map walk so callers can log a single
	// actionable line.
	const outputPath = properties.get('OutputPath');
	const packageLocation = properties.get('PackageLocation');
	const unresolved = new Set<string>();
	const scanUnresolved = (s: string | undefined): void => {
		if (!s) return;
		for (const m of s.matchAll(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g)) unresolved.add(m[1]);
	};
	scanUnresolved(outputPath);
	scanUnresolved(packageLocation);
	const projectReferences: string[] = [];
	for (const ig of itemGroups) {
		for (const pr of ensureArray<XmlNode>(ig.ProjectReference)) {
			const inc = pr['@_Include'];
			if (typeof inc === 'string' && inc.length > 0) {
				projectReferences.push(resolveAgainst(directory, inc));
			}
		}
	}
	return {
		path: absPath,
		directory,
		projectGuid,
		projectVersion,
		applicationPackageRootFolder: apkgRoot,
		outputPath,
		packageLocation,
		projectReferences,
		propertyGroups: rawPropertyGroups,
		properties,
		intrinsics,
		unresolvedProperties: unresolved.size > 0 ? [...unresolved] : undefined,
	};
}

export async function parseApplicationManifest(filePath: string): Promise<ApplicationManifest | undefined> {
	if (!(await pathExists(filePath))) return undefined;
	const text = await readTextFile(filePath);
	const tree: XmlNode = xml.parse(text);
	const am: XmlNode = tree?.ApplicationManifest;
	if (!am) return undefined;
	const params: ApplicationParameter[] = [];
	const paramsNode: XmlNode = am.Parameters;
	if (paramsNode) {
		for (const p of ensureArray<XmlNode>(paramsNode.Parameter)) {
			if (typeof p['@_Name'] === 'string') {
				params.push({ name: p['@_Name'], defaultValue: p['@_DefaultValue'] });
			}
		}
	}
	const refs: ServiceManifestRef[] = [];
	for (const imp of ensureArray<XmlNode>(am.ServiceManifestImport)) {
		const ref: XmlNode = imp.ServiceManifestRef;
		if (ref && typeof ref['@_ServiceManifestName'] === 'string') {
			refs.push({
				name: ref['@_ServiceManifestName'],
				version: ref['@_ServiceManifestVersion'] ?? '',
			});
		}
	}
	return {
		path: filePath,
		applicationTypeName: am['@_ApplicationTypeName'] ?? '',
		applicationTypeVersion: am['@_ApplicationTypeVersion'] ?? '',
		parameters: params,
		serviceManifestRefs: refs,
	};
}

export async function parseServiceManifest(filePath: string): Promise<ServiceManifest | undefined> {
	if (!(await pathExists(filePath))) return undefined;
	const text = await readTextFile(filePath);
	const tree: XmlNode = xml.parse(text);
	const sm: XmlNode = tree?.ServiceManifest;
	if (!sm) return undefined;
	const endpoints: ServiceEndpoint[] = [];
	const resources: XmlNode = sm.Resources;
	if (resources?.Endpoints) {
		for (const ep of ensureArray<XmlNode>(resources.Endpoints.Endpoint)) {
			if (typeof ep['@_Name'] === 'string') {
				endpoints.push({
					name: ep['@_Name'],
					protocol: ep['@_Protocol'],
					type: ep['@_Type'],
					port: ep['@_Port'],
				});
			}
		}
	}
	const codePackages = ensureArray<XmlNode>(sm.CodePackage)
		.map((c) => c['@_Name'])
		.filter((n): n is string => typeof n === 'string');
	const configPackages = ensureArray<XmlNode>(sm.ConfigPackage)
		.map((c) => c['@_Name'])
		.filter((n): n is string => typeof n === 'string');
	const dataPackages = ensureArray<XmlNode>(sm.DataPackage)
		.map((c) => c['@_Name'])
		.filter((n): n is string => typeof n === 'string');
	return {
		path: filePath,
		packageDirectory: path.dirname(filePath),
		name: sm['@_Name'] ?? '',
		version: sm['@_Version'] ?? '',
		endpoints,
		codePackages,
		configPackages,
		dataPackages,
	};
}

export async function loadApplicationProject(sfprojPath: string): Promise<ApplicationProject> {
	const sfproj = await parseSfProj(sfprojPath);
	const apkgRoot = path.join(sfproj.directory, sfproj.applicationPackageRootFolder);
	const appManifestPath = path.join(apkgRoot, 'ApplicationManifest.xml');
	const applicationManifest = await parseApplicationManifest(appManifestPath);
	// Two layouts coexist:
	//  - Modern (VS canonical, 1.1.3+): each <ProjectReference> in the .sfproj
	//    points at a sibling C# project whose `<csprojDir>/PackageRoot/` holds
	//    the manifest. Walk those first.
	//  - Legacy (1.1.2 and earlier): every package lives under
	//    `<App>/ApplicationPackageRoot/<Service>Pkg/`. Falls back when no
	//    project reference manifest is found, or to pick up any stragglers
	//    that the modern layout doesn't cover (e.g. guest exes).
	const serviceManifests: ServiceManifest[] = [];
	const seenPaths = new Set<string>();
	for (const ref of sfproj.projectReferences) {
		const csprojDir = path.dirname(ref);
		const candidate = path.join(csprojDir, 'PackageRoot', 'ServiceManifest.xml');
		if (seenPaths.has(candidate)) continue;
		const sm = await parseServiceManifest(candidate);
		if (sm) {
			serviceManifests.push(sm);
			seenPaths.add(candidate);
		}
	}
	for (const dir of await listDirectories(apkgRoot)) {
		const candidate = path.join(dir, 'ServiceManifest.xml');
		if (seenPaths.has(candidate)) continue;
		const sm = await parseServiceManifest(candidate);
		if (sm) {
			serviceManifests.push(sm);
			seenPaths.add(candidate);
		}
	}
	const publishProfiles = await listFiles(path.join(sfproj.directory, 'PublishProfiles'), '.xml');
	const applicationParameters = await listFiles(path.join(sfproj.directory, 'ApplicationParameters'), '.xml');
	const startupServiceParameters = await listFiles(path.join(sfproj.directory, 'StartupServiceParameters'), '.xml');
	const startupServicesPath = path.join(sfproj.directory, 'StartupServices.xml');
	const startupServicesManifest = (await pathExists(startupServicesPath)) ? startupServicesPath : undefined;
	const scripts = await listFiles(path.join(sfproj.directory, 'Scripts'), '.ps1');
	return {
		sfproj,
		applicationManifest,
		serviceManifests,
		publishProfiles,
		applicationParameters,
		startupServiceParameters,
		startupServicesManifest,
		scripts,
	};
}

function ensureArray<T>(v: T | T[] | null | undefined): T[] {
	if (v === undefined || v === null) return [];
	return Array.isArray(v) ? v : [v];
}

function firstScalar(propertyGroups: XmlNode[], name: string): string | undefined {
	for (const pg of propertyGroups) {
		const v = pg?.[name];
		if (typeof v === 'string') return v;
		if (v && typeof v === 'object' && '#text' in v && typeof v['#text'] === 'string') {
			return v['#text'];
		}
	}
	return undefined;
}

/**
 * Walk every `<PropertyGroup>` and collect its scalar children into a flat
 * `RawPropertyGroup` for the Tier-1 expander. The Condition attribute is
 * preserved verbatim; nested elements (which `fast-xml-parser` materializes
 * as objects) are skipped — they aren't properties in the MSBuild sense.
 */
function collectRawPropertyGroups(propertyGroups: XmlNode[]): RawPropertyGroup[] {
	const out: RawPropertyGroup[] = [];
	for (const pg of propertyGroups) {
		if (!pg || typeof pg !== 'object') continue;
		const condition: string | undefined = typeof pg['@_Condition'] === 'string' ? pg['@_Condition'] : undefined;
		const properties: RawProperty[] = [];
		for (const [key, raw] of Object.entries<XmlNode>(pg)) {
			if (key.startsWith('@_') || key === '#text') continue;
			if (typeof raw === 'string') {
				properties.push({ name: key, value: raw });
			} else if (raw && typeof raw === 'object' && '#text' in raw && typeof raw['#text'] === 'string') {
				properties.push({ name: key, value: raw['#text'] });
			}
		}
		out.push({ condition, properties });
	}
	return out;
}
