// @ts-nocheck
import * as path from 'path';
import * as fast_xml_parser from 'fast-xml-parser';
import { listDirectories, listFiles, pathExists, readTextFile, resolveAgainst } from '../util/fs';
import { buildPropertyMap } from './msbuildPropertyExpander';

var xml = new fast_xml_parser.XMLParser({
		ignoreAttributes: !1,
		attributeNamePrefix: '@_',
		allowBooleanAttributes: !0,
		parseAttributeValue: !1,
		parseTagValue: !1,
		trimValues: !0,
		isArray: (e, t, r, n) => MULTI_ELEMENTS.has(e),
	}),
	MULTI_ELEMENTS = new Set([
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

async function parseSfProj(e) {
	let t = await readTextFile(e),
		r = path.dirname(e),
		i = xml.parse(t)?.Project ?? {},
		o = ensureArray(i.PropertyGroup),
		s = ensureArray(i.ItemGroup),
		a = firstScalar(o, 'ProjectGuid'),
		c = firstScalar(o, 'ProjectVersion'),
		l = firstScalar(o, 'ApplicationPackageRootFolder') ?? 'ApplicationPackageRoot',
		u = collectRawPropertyGroups(o),
		p = new Map([
			['MSBuildProjectName', path.basename(e, path.extname(e))],
			['MSBuildProjectFile', path.basename(e)],
			['MSBuildProjectExtension', path.extname(e)],
			['MSBuildProjectDirectory', r],
			['MSBuildThisFileDirectory', r + path.sep],
			['MSBuildThisFileFullPath', e],
		]),
		d = buildPropertyMap({
			propertyGroups: u,
			intrinsics: p,
			configuration: 'Debug',
		}),
		f = d.get('OutputPath'),
		m = d.get('PackageLocation'),
		v = new Set(),
		h = (g) => {
			if (g) for (let w of g.matchAll(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g)) v.add(w[1]);
		};
	(h(f), h(m));
	let P = [];
	for (let g of s)
		for (let w of ensureArray(g.ProjectReference)) {
			let b = w['@_Include'];
			typeof b == 'string' && b.length > 0 && P.push(resolveAgainst(r, b));
		}
	return {
		path: e,
		directory: r,
		projectGuid: a,
		projectVersion: c,
		applicationPackageRootFolder: l,
		outputPath: f,
		packageLocation: m,
		projectReferences: P,
		propertyGroups: u,
		properties: d,
		intrinsics: p,
		unresolvedProperties: v.size > 0 ? [...v] : void 0,
	};
}

async function parseApplicationManifest(e) {
	if (!(await pathExists(e))) return;
	let t = await readTextFile(e),
		n = xml.parse(t)?.ApplicationManifest;
	if (!n) return;
	let i = [],
		o = n.Parameters;
	if (o)
		for (let a of ensureArray(o.Parameter))
			typeof a['@_Name'] == 'string' &&
				i.push({
					name: a['@_Name'],
					defaultValue: a['@_DefaultValue'],
				});
	let s = [];
	for (let a of ensureArray(n.ServiceManifestImport)) {
		let c = a.ServiceManifestRef;
		c &&
			typeof c['@_ServiceManifestName'] == 'string' &&
			s.push({
				name: c['@_ServiceManifestName'],
				version: c['@_ServiceManifestVersion'] ?? '',
			});
	}
	return {
		path: e,
		applicationTypeName: n['@_ApplicationTypeName'] ?? '',
		applicationTypeVersion: n['@_ApplicationTypeVersion'] ?? '',
		parameters: i,
		serviceManifestRefs: s,
	};
}

async function parseServiceManifest(e) {
	if (!(await pathExists(e))) return;
	let t = await readTextFile(e),
		n = xml.parse(t)?.ServiceManifest;
	if (!n) return;
	let i = [],
		o = n.Resources;
	if (o?.Endpoints)
		for (let l of ensureArray(o.Endpoints.Endpoint))
			typeof l['@_Name'] == 'string' &&
				i.push({
					name: l['@_Name'],
					protocol: l['@_Protocol'],
					type: l['@_Type'],
					port: l['@_Port'],
				});
	let s = ensureArray(n.CodePackage)
			.map((l) => l['@_Name'])
			.filter((l) => typeof l == 'string'),
		a = ensureArray(n.ConfigPackage)
			.map((l) => l['@_Name'])
			.filter((l) => typeof l == 'string'),
		c = ensureArray(n.DataPackage)
			.map((l) => l['@_Name'])
			.filter((l) => typeof l == 'string');
	return {
		path: e,
		packageDirectory: path.dirname(e),
		name: n['@_Name'] ?? '',
		version: n['@_Version'] ?? '',
		endpoints: i,
		codePackages: s,
		configPackages: a,
		dataPackages: c,
	};
}

async function loadApplicationProject(e) {
	let t = await parseSfProj(e),
		r = path.join(t.directory, t.applicationPackageRootFolder),
		n = path.join(r, 'ApplicationManifest.xml'),
		i = await parseApplicationManifest(n),
		o = [],
		s = new Set();
	for (let f of t.projectReferences) {
		let m = path.dirname(f),
			v = path.join(m, 'PackageRoot', 'ServiceManifest.xml');
		if (s.has(v)) continue;
		let h = await parseServiceManifest(v);
		h && (o.push(h), s.add(v));
	}
	for (let f of await listDirectories(r)) {
		let m = path.join(f, 'ServiceManifest.xml');
		if (s.has(m)) continue;
		let v = await parseServiceManifest(m);
		v && (o.push(v), s.add(m));
	}
	let a = await listFiles(path.join(t.directory, 'PublishProfiles'), '.xml'),
		c = await listFiles(path.join(t.directory, 'ApplicationParameters'), '.xml'),
		l = await listFiles(path.join(t.directory, 'StartupServiceParameters'), '.xml'),
		u = path.join(t.directory, 'StartupServices.xml'),
		p = (await pathExists(u)) ? u : void 0,
		d = await listFiles(path.join(t.directory, 'Scripts'), '.ps1');
	return {
		sfproj: t,
		applicationManifest: i,
		serviceManifests: o,
		publishProfiles: a,
		applicationParameters: c,
		startupServiceParameters: l,
		startupServicesManifest: p,
		scripts: d,
	};
}

function ensureArray(e) {
	return e == null ? [] : Array.isArray(e) ? e : [e];
}

function firstScalar(e, t) {
	for (let r of e) {
		let n = r?.[t];
		if (typeof n == 'string') return n;
		if (n && typeof n == 'object' && '#text' in n && typeof n['#text'] == 'string') return n['#text'];
	}
}

function collectRawPropertyGroups(e) {
	let t = [];
	for (let r of e) {
		if (!r || typeof r != 'object') continue;
		let n = typeof r['@_Condition'] == 'string' ? r['@_Condition'] : void 0,
			i = [];
		for (let [o, s] of Object.entries(r))
			o.startsWith('@_') ||
				o === '#text' ||
				(typeof s == 'string'
					? i.push({
							name: o,
							value: s,
						})
					: s &&
						typeof s == 'object' &&
						'#text' in s &&
						typeof s['#text'] == 'string' &&
						i.push({
							name: o,
							value: s['#text'],
						}));
		t.push({
			condition: n,
			properties: i,
		});
	}
	return t;
}

export { loadApplicationProject };
