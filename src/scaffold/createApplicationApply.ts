import * as fs from 'fs';
import * as path from 'path';
import {
	buildActorCs,
	buildActorInterfaceCs,
	buildActorInterfacesCsproj,
	buildAspNetAppsettingsDevelopmentJson,
	buildAspNetAppsettingsJson,
	buildAspNetValuesControllerCs,
	buildCsharpCsproj,
	buildCsharpProgramCs,
	buildCsharpServiceCs,
	buildLaunchSettingsJson,
	isAspNetKind,
	isCsharpKind,
	patchSfprojForProjectReference,
	resolveCsharpSettings,
} from './addServiceTemplates';
import type { AddServiceTemplate, CsharpSettings } from './addServiceTemplates';
import {
	ENVIRONMENT_NAMES,
	buildApplicationManifestXml,
	buildApplicationParametersXml,
	buildDeployFabricApplicationScript,
	buildPackagesConfigXml,
	buildPublishProfileXml,
	buildServiceManifestXml,
	buildSettingsXml,
	buildSfprojXml,
	buildStartupServiceParametersXml,
	buildStartupServicesXml,
} from './createApplicationTemplates';
import type { CreateApplicationTemplate, EnvironmentName } from './createApplicationTemplates';

/** Options for {@link applyCreateApplication}. */
export interface CreateApplicationOptions extends CreateApplicationTemplate {
	/** The `<AppName>/` folder to create. Must not exist yet. */
	targetDirectory: string;
}

/** Absolute paths of everything {@link applyCreateApplication} wrote. */
export interface CreateApplicationResult {
	sfprojPath: string;
	applicationManifestPath: string;
	serviceManifestPath: string;
	settingsXmlPath: string;
	publishProfilePaths: string[];
	applicationParameterPaths: string[];
	startupServiceParameterPaths: string[];
	startupServicesPath: string;
	deployScriptPath: string;
	packagesConfigPath: string;
	/** Only set for C# seeded kinds. */
	csprojPath: string | undefined;
	/** Only set for C# seeded kinds. */
	launchSettingsPath: string | undefined;
	/** Only set for ASP.NET seeded kinds. */
	appsettingsDevelopmentPath: string | undefined;
}

interface SeededCsharpProjectPaths {
	csprojPath: string;
	launchSettingsPath: string;
	appsettingsDevelopmentPath: string | undefined;
}

/**
 * Pure (no `vscode` import) on-disk apply step for `serviceFabric.createApplication`.
 *
 * Lays out the same directory shape that Visual Studio's "Service Fabric
 * Application" project template produces — including
 * `Scripts/Deploy-FabricApplication.ps1`, `StartupServices.xml`, and the
 * three-environment `{Cloud,Local.1Node,Local.5Node}` triads under
 * `ApplicationParameters/`, `PublishProfiles/`, and `StartupServiceParameters/`.
 */
export function applyCreateApplication(opts: CreateApplicationOptions): CreateApplicationResult {
	if (fs.existsSync(opts.targetDirectory)) {
		throw new Error(`Folder already exists: ${opts.targetDirectory}`);
	}
	if (!opts.applicationName || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(opts.applicationName)) {
		throw new Error(`Invalid application name: '${opts.applicationName}'.`);
	}
	if (!opts.serviceName || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(opts.serviceName)) {
		throw new Error(`Invalid service name: '${opts.serviceName}'.`);
	}
	if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(opts.projectGuid)) {
		throw new Error(`Invalid project GUID: '${opts.projectGuid}'.`);
	}
	const root = opts.targetDirectory;
	const apkg = path.join(root, 'ApplicationPackageRoot');
	const appParamsDir = path.join(root, 'ApplicationParameters');
	const publishDir = path.join(root, 'PublishProfiles');
	const startupParamsDir = path.join(root, 'StartupServiceParameters');
	const scriptsDir = path.join(root, 'Scripts');
	// Layout decision: C# kinds host PackageRoot inside their csproj folder
	// (sibling-project layout, matching the VS canonical Application1 shape).
	// Plain stateless/stateful/actor/aspNet kinds therefore do NOT create
	// <App>/ApplicationPackageRoot/<Service>Pkg/. Guest seeded services (rare
	// here, since Create Application defaults to stateless) keep the legacy
	// layout under <App>/ApplicationPackageRoot/.
	const seededKind = opts.kind ?? 'stateless';
	const seededIsCsharp = isCsharpKind(seededKind);
	const repoDir = path.dirname(root);
	const seededTemplate: AddServiceTemplate = {
		serviceName: opts.serviceName,
		serviceTypeName: opts.serviceTypeName ?? `${opts.serviceName}Type`,
		kind: seededKind,
		runtime: opts.runtime ?? 'netcore',
		version: opts.serviceVersion ?? '1.0.0',
		targetFramework: opts.targetFramework,
	};
	const seededSettings = seededIsCsharp ? resolveCsharpSettings(seededTemplate) : undefined;
	const seededCsprojDir = seededIsCsharp && seededSettings ? path.join(repoDir, seededSettings.csprojDirName) : undefined;
	const svcPkg = seededIsCsharp && seededCsprojDir ? path.join(seededCsprojDir, 'PackageRoot') : path.join(apkg, `${opts.serviceName}Pkg`);
	if (seededIsCsharp && seededCsprojDir && fs.existsSync(seededCsprojDir)) {
		throw new Error(`Cannot scaffold C# project: directory already exists: ${seededCsprojDir}`);
	}
	// Base directories.
	fs.mkdirSync(apkg, { recursive: true });
	if (seededIsCsharp) {
		// Physical PackageRoot lives under csprojDir.
		fs.mkdirSync(path.join(svcPkg, 'Config'), { recursive: true });
	} else {
		fs.mkdirSync(path.join(svcPkg, 'Code'), { recursive: true });
		fs.mkdirSync(path.join(svcPkg, 'Config'), { recursive: true });
	}
	fs.mkdirSync(appParamsDir, { recursive: true });
	fs.mkdirSync(publishDir, { recursive: true });
	fs.mkdirSync(startupParamsDir, { recursive: true });
	fs.mkdirSync(scriptsDir, { recursive: true });
	// .sfproj (root file).
	const sfprojPath = path.join(root, `${opts.applicationName}.sfproj`);
	fs.writeFileSync(sfprojPath, buildSfprojXml(opts), 'utf8');
	// packages.config (root).
	const packagesConfigPath = path.join(root, 'packages.config');
	fs.writeFileSync(packagesConfigPath, buildPackagesConfigXml(), 'utf8');
	// ApplicationManifest.xml + ServiceManifest.xml + Settings.xml.
	const applicationManifestPath = path.join(apkg, 'ApplicationManifest.xml');
	fs.writeFileSync(applicationManifestPath, buildApplicationManifestXml(opts), 'utf8');
	const serviceManifestPath = path.join(svcPkg, 'ServiceManifest.xml');
	fs.writeFileSync(serviceManifestPath, buildServiceManifestXml(opts), 'utf8');
	const settingsXmlPath = path.join(svcPkg, 'Config', 'Settings.xml');
	fs.writeFileSync(settingsXmlPath, buildSettingsXml(), 'utf8');
	// Per-environment triads.
	const publishProfilePaths: string[] = [];
	const applicationParameterPaths: string[] = [];
	const startupServiceParameterPaths: string[] = [];
	for (const env of ENVIRONMENT_NAMES) {
		publishProfilePaths.push(writeEnvFile(publishDir, env, buildPublishProfileXml(env)));
		applicationParameterPaths.push(writeEnvFile(appParamsDir, env, buildApplicationParametersXml(opts, env)));
		startupServiceParameterPaths.push(writeEnvFile(startupParamsDir, env, buildStartupServiceParametersXml(opts, env)));
	}
	// StartupServices.xml (root).
	const startupServicesPath = path.join(root, 'StartupServices.xml');
	fs.writeFileSync(startupServicesPath, buildStartupServicesXml(opts), 'utf8');
	// Scripts/Deploy-FabricApplication.ps1.
	const deployScriptPath = path.join(scriptsDir, 'Deploy-FabricApplication.ps1');
	fs.writeFileSync(deployScriptPath, buildDeployFabricApplicationScript(), 'utf8');
	// Companion C# project for the seeded service (when kind is C#).
	let csprojPath: string | undefined;
	let launchSettingsPath: string | undefined;
	let appsettingsDevelopmentPath: string | undefined;
	if (seededIsCsharp && seededCsprojDir && seededSettings) {
		const cs = scaffoldSeededCsharpProject(seededTemplate, seededSettings, seededCsprojDir, sfprojPath);
		csprojPath = cs.csprojPath;
		launchSettingsPath = cs.launchSettingsPath;
		appsettingsDevelopmentPath = cs.appsettingsDevelopmentPath;
	}
	return {
		sfprojPath,
		applicationManifestPath,
		serviceManifestPath,
		settingsXmlPath,
		publishProfilePaths,
		applicationParameterPaths,
		startupServiceParameterPaths,
		startupServicesPath,
		deployScriptPath,
		packagesConfigPath,
		csprojPath,
		launchSettingsPath,
		appsettingsDevelopmentPath,
	};
}

/**
 * Scaffolds the C# project that backs the seeded service, mirroring the
 * layout `addServiceApply.scaffoldCsharpProject` produces. Lives in a sibling
 * folder of the .sfproj's directory and is registered as a `<ProjectReference>`
 * in the .sfproj.
 */
function scaffoldSeededCsharpProject(
	template: AddServiceTemplate,
	settings: CsharpSettings,
	csprojDir: string,
	sfprojPath: string,
): SeededCsharpProjectPaths {
	fs.mkdirSync(csprojDir, { recursive: true });
	const csprojPath = path.join(csprojDir, `${settings.csprojDirName}.csproj`);
	fs.writeFileSync(csprojPath, buildCsharpCsproj(template, undefined, settings), 'utf8');
	fs.writeFileSync(path.join(csprojDir, 'Program.cs'), buildCsharpProgramCs(template, settings), 'utf8');
	if (template.kind === 'actor') {
		// Sibling-project layout: actor host + interfaces project side-by-side.
		const interfacesDir = `${csprojDir}.Interfaces`;
		fs.mkdirSync(interfacesDir, { recursive: true });
		fs.writeFileSync(
			path.join(interfacesDir, `${settings.csprojDirName}.Interfaces.csproj`),
			buildActorInterfacesCsproj(template, settings),
			'utf8',
		);
		fs.writeFileSync(path.join(interfacesDir, `${settings.actorInterfaceName}.cs`), buildActorInterfaceCs(template, settings), 'utf8');
		fs.writeFileSync(path.join(csprojDir, `${settings.actorTypeName}.cs`), buildActorCs(template, settings), 'utf8');
	} else {
		fs.writeFileSync(path.join(csprojDir, `${settings.className}.cs`), buildCsharpServiceCs(template, settings), 'utf8');
	}
	let appsettingsDevelopmentPath: string | undefined;
	if (isAspNetKind(template.kind)) {
		const controllersDir = path.join(csprojDir, 'Controllers');
		fs.mkdirSync(controllersDir, { recursive: true });
		fs.writeFileSync(path.join(controllersDir, 'ValuesController.cs'), buildAspNetValuesControllerCs(template, settings), 'utf8');
		fs.writeFileSync(path.join(csprojDir, 'appsettings.json'), buildAspNetAppsettingsJson(), 'utf8');
		appsettingsDevelopmentPath = path.join(csprojDir, 'appsettings.Development.json');
		fs.writeFileSync(appsettingsDevelopmentPath, buildAspNetAppsettingsDevelopmentJson(), 'utf8');
	}
	// Properties/launchSettings.json — enables F5 / dotnet run for every C# kind.
	const propertiesDir = path.join(csprojDir, 'Properties');
	fs.mkdirSync(propertiesDir, { recursive: true });
	const launchSettingsPath = path.join(propertiesDir, 'launchSettings.json');
	const launchPort = template.endpointPort ?? (isAspNetKind(template.kind) ? 8559 : undefined);
	fs.writeFileSync(
		launchSettingsPath,
		launchPort !== undefined ? buildLaunchSettingsJson(template, launchPort) : buildLaunchSettingsJson(template),
		'utf8',
	);
	// Register the new csproj in the .sfproj. ASP.NET kinds get the
	// ServiceLaunchUrl child for VS-canonical parity.
	const sfprojDir = path.dirname(sfprojPath);
	const sfprojRelToCsproj = toMsbuildRelativePath(sfprojDir, csprojPath);
	const sfprojXml = fs.readFileSync(sfprojPath, 'utf8');
	const patched = patchSfprojForProjectReference(sfprojXml, sfprojRelToCsproj, { kind: template.kind });
	if (patched !== sfprojXml) {
		fs.writeFileSync(sfprojPath, patched, 'utf8');
	}
	return { csprojPath, launchSettingsPath, appsettingsDevelopmentPath };
}

/**
 * Computes a relative path between two absolute filesystem paths and converts
 * forward-slashes to back-slashes so it can be embedded directly in MSBuild
 * `Include="..."` attributes (which expect Windows-style separators on Windows
 * and tolerate forward slashes elsewhere).
 */
function toMsbuildRelativePath(fromDir: string, toPath: string): string {
	return path.relative(fromDir, toPath).split('/').join('\\');
}

function writeEnvFile(dir: string, env: EnvironmentName, content: string): string {
	const p = path.join(dir, `${env}.xml`);
	fs.writeFileSync(p, content, 'utf8');
	return p;
}
