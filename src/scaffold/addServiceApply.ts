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
	buildServiceManifestXml,
	buildSettingsXml,
	classifyEnvironment,
	isAspNetKind,
	isCsharpKind,
	patchApplicationManifest,
	patchApplicationManifestImports,
	patchApplicationParametersXml,
	patchSfprojForProjectReference,
	patchStartupServiceParametersXml,
	patchStartupServicesXml,
	resolveCsharpSettings,
} from './addServiceTemplates';
import type { AddServiceTemplate, CsharpSettings } from './addServiceTemplates';
import type { ApplicationProject } from '../project/sfprojModel';

export interface AddServiceOptions {
	/** Guest kinds only: the executable file or payload folder to stage into `Code/`. */
	guestSourcePath?: string;
}

export interface AddServiceResult {
	serviceManifestPath: string;
	applicationManifestPath: string;
	patchedParameterFiles: string[];
	patchedStartupParameterFiles: string[];
	startupServicesManifestPath: string | undefined;
	csprojPath: string | undefined;
	launchSettingsPath: string | undefined;
	appsettingsDevelopmentPath: string | undefined;
	guestExePath: string | undefined;
}

interface CsharpScaffoldResult {
	csprojPath: string;
	launchSettingsPath: string;
	appsettingsDevelopmentPath: string | undefined;
}

/**
 * Pure (no `vscode` import) on-disk apply step for the Add Service command.
 * Throws on conflict so the caller can surface a friendly error.
 *
 * For C# kinds, also generates a sibling `<ServiceName>.csproj` (with
 * `Program.cs` and `<ServiceName>.cs`) and registers it as a
 * `<ProjectReference>` in the `.sfproj` so the resulting project mirrors the
 * Visual Studio "Add → New Service Fabric Service…" experience.
 *
 * For `kind === 'guest'`, copies the user-provided source binary into
 * `Code/` (or copies the source directory contents when the path is a folder).
 */
export async function applyAddService(
	project: ApplicationProject,
	template: AddServiceTemplate,
	options?: AddServiceOptions,
): Promise<AddServiceResult> {
	if (!project.applicationManifest) throw new Error('Application manifest is missing.');
	const existing = collectExistingServiceNames(project);
	if (existing.has(template.serviceName.toLowerCase()))
		throw new Error(`A service named '${template.serviceName}' already exists in this application.`);
	if (existing.has(`${template.serviceName.toLowerCase()}pkg`))
		throw new Error(`A service package '${template.serviceName}Pkg' already exists.`);
	if (template.kind === 'guest' && !options?.guestSourcePath)
		throw new Error('Guest executable scaffold requires options.guestSourcePath.');
	const projectDir = path.dirname(project.sfproj.path);
	const apkgDir = path.join(projectDir, project.sfproj.applicationPackageRootFolder);
	const repoDir = path.dirname(projectDir);
	// Layout decision: C# kinds host PackageRoot inside their csproj folder
	// (sibling-project layout, matching the VS canonical Application1 shape);
	// guest kinds continue to live under <App>/ApplicationPackageRoot/<Service>Pkg/.
	const csharp = isCsharpKind(template.kind);
	const settings = csharp ? resolveCsharpSettings(template) : undefined;
	const csprojDir = csharp && settings ? path.join(repoDir, settings.csprojDirName) : undefined;
	const svcDir = csharp && csprojDir ? path.join(csprojDir, 'PackageRoot') : path.join(apkgDir, `${template.serviceName}Pkg`);
	if (csharp && csprojDir && fs.existsSync(csprojDir))
		throw new Error(`Cannot scaffold C# project: directory already exists: ${csprojDir}`);
	if (!csharp && fs.existsSync(svcDir)) throw new Error(`Service folder already exists on disk: ${svcDir}`);
	// For guest kinds, derive the program name from the source binary so the
	// manifest's <Program> element matches the file we actually copied in.
	let effectiveTemplate = template;
	if (template.kind === 'guest' && options?.guestSourcePath) {
		const src = options.guestSourcePath;
		const programName = fs.statSync(src).isDirectory() ? (template.exeProgram ?? `${template.serviceName}.exe`) : path.basename(src);
		effectiveTemplate = { ...template, exeProgram: programName };
	}
	// Create the package-root directory tree. C# kinds (physical layout) only
	// need <csprojDir>/PackageRoot/Config/; guest kinds also need a Code/ to
	// receive the staged executable. Container kinds have no Code/: the image is the code.
	fs.mkdirSync(path.join(svcDir, 'Config'), { recursive: true });
	if (!csharp && template.kind !== 'container') {
		fs.mkdirSync(path.join(svcDir, 'Code'), { recursive: true });
	}
	const serviceManifestPath = path.join(svcDir, 'ServiceManifest.xml');
	fs.writeFileSync(serviceManifestPath, buildServiceManifestXml(effectiveTemplate), 'utf8');
	fs.writeFileSync(path.join(svcDir, 'Config', 'Settings.xml'), buildSettingsXml(), 'utf8');
	let guestExePath: string | undefined;
	if (effectiveTemplate.kind === 'guest' && options?.guestSourcePath) {
		guestExePath = stageGuestExecutable(options.guestSourcePath, path.join(svcDir, 'Code'));
	}
	// Wire the new service into ApplicationManifest.xml. Two routing paths:
	//   - StartupServices.xml-first (modern VS template): only patch the
	//     <Parameters> + <ServiceManifestImport> halves of the application
	//     manifest; the runtime <Service> placement lives in StartupServices.xml.
	//   - Legacy <DefaultServices>-only: patch every section, mirroring the
	//     original behaviour for projects without StartupServices.xml.
	const appManifestPath = project.applicationManifest.path;
	const original = fs.readFileSync(appManifestPath, 'utf8');
	const useStartupServices = !!project.startupServicesManifest;
	const patchedAppManifest: string = useStartupServices
		? patchApplicationManifestImports(original, effectiveTemplate)
		: patchApplicationManifest(original, effectiveTemplate);
	fs.writeFileSync(appManifestPath, patchedAppManifest, 'utf8');
	let startupServicesManifestPath: string | undefined;
	if (useStartupServices && project.startupServicesManifest) {
		startupServicesManifestPath = project.startupServicesManifest;
		const before = fs.readFileSync(startupServicesManifestPath, 'utf8');
		const after: string = patchStartupServicesXml(before, effectiveTemplate);
		if (after !== before) {
			fs.writeFileSync(startupServicesManifestPath, after, 'utf8');
		}
	}
	const patchedParamFiles: string[] = [];
	for (const paramFile of project.applicationParameters) {
		try {
			const flavor = classifyEnvironment(path.basename(paramFile));
			const before = fs.readFileSync(paramFile, 'utf8');
			const after: string = patchApplicationParametersXml(before, effectiveTemplate, flavor);
			if (after !== before) {
				fs.writeFileSync(paramFile, after, 'utf8');
				patchedParamFiles.push(paramFile);
			}
		} catch {
			// best-effort
		}
	}
	const patchedStartupParamFiles: string[] = [];
	if (useStartupServices) {
		for (const paramFile of project.startupServiceParameters) {
			try {
				const flavor = classifyEnvironment(path.basename(paramFile));
				const before = fs.readFileSync(paramFile, 'utf8');
				const after: string = patchStartupServiceParametersXml(before, effectiveTemplate, flavor);
				if (after !== before) {
					fs.writeFileSync(paramFile, after, 'utf8');
					patchedStartupParamFiles.push(paramFile);
				}
			} catch {
				// best-effort
			}
		}
	}
	let csprojPath: string | undefined;
	let launchSettingsPath: string | undefined;
	let appsettingsDevelopmentPath: string | undefined;
	if (csharp && csprojDir && settings) {
		const cs = scaffoldCsharpProject(project, effectiveTemplate, csprojDir, settings);
		csprojPath = cs.csprojPath;
		launchSettingsPath = cs.launchSettingsPath;
		appsettingsDevelopmentPath = cs.appsettingsDevelopmentPath;
	}
	return {
		serviceManifestPath,
		applicationManifestPath: appManifestPath,
		patchedParameterFiles: patchedParamFiles,
		patchedStartupParameterFiles: patchedStartupParamFiles,
		startupServicesManifestPath,
		csprojPath,
		launchSettingsPath,
		appsettingsDevelopmentPath,
		guestExePath,
	};
}

/**
 * Lower-cased names of every service package already in the application, both
 * with and without the `Pkg` suffix, so callers can reject collisions.
 */
export function collectExistingServiceNames(project: ApplicationProject): Set<string> {
	const names = new Set<string>();
	for (const sm of project.serviceManifests) {
		names.add(sm.name.toLowerCase());
		names.add(sm.name.replace(/Pkg$/i, '').toLowerCase());
	}
	for (const ref of project.applicationManifest?.serviceManifestRefs ?? []) {
		names.add(ref.name.toLowerCase());
		names.add(ref.name.replace(/Pkg$/i, '').toLowerCase());
	}
	return names;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * Generates the companion C# project (Program.cs, <Service>.cs, .csproj) in a
 * sibling folder of the .sfproj's directory and registers it as a
 * `<ProjectReference>` in the .sfproj. The csproj folder must already exist
 * (the caller — `applyAddService` — also writes the `PackageRoot/` shape
 * inside it before calling this).
 *
 * For actor kinds, additionally writes a sibling `<Folder>.Interfaces/`
 * project (`I<Actor>.cs` + `<Folder>.Interfaces.csproj`) and the host
 * project's actor implementation file.
 *
 * For ASP.NET kinds, additionally writes `Controllers/ValuesController.cs`,
 * `appsettings.json`, and `appsettings.Development.json`.
 *
 * Every C# kind also gets `Properties/launchSettings.json` so
 * `dotnet run` / Visual Studio F5 know how to launch the service.
 */
function scaffoldCsharpProject(
	project: ApplicationProject,
	template: AddServiceTemplate,
	csprojDir: string,
	settings: CsharpSettings,
): CsharpScaffoldResult {
	const sfprojPath = project.sfproj.path;
	const sfprojDir = path.dirname(sfprojPath);
	// Computed but unused, kept for parity with upstream (a future iteration
	// may need it for sibling-project lookups).
	const repoDir = path.dirname(sfprojDir);
	void repoDir;
	// Make sure the csproj folder exists. applyAddService already created
	// <csprojDir>/PackageRoot/Config so this is normally a no-op; defensively
	// re-create in case a different caller wires us up.
	fs.mkdirSync(csprojDir, { recursive: true });
	const csprojPath = path.join(csprojDir, `${settings.csprojDirName}.csproj`);
	fs.writeFileSync(csprojPath, buildCsharpCsproj(template, undefined, settings), 'utf8');
	fs.writeFileSync(path.join(csprojDir, 'Program.cs'), buildCsharpProgramCs(template, settings), 'utf8');
	if (template.kind === 'actor') {
		// Sibling-project layout: actor host lives at <csprojDir>; the public
		// interface contract lives in a separate <Folder>.Interfaces project
		// next to it, matching the VS canonical Application1 shape.
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
	// ASP.NET kinds with HTTPS opt-in get a dual-scheme applicationUrl.
	const httpsPort = isAspNetKind(template.kind) && template.httpsEndpoint ? (template.httpsEndpoint.port ?? 8443) : undefined;
	fs.writeFileSync(
		launchSettingsPath,
		launchPort !== undefined
			? buildLaunchSettingsJson(template, { http: launchPort, https: httpsPort })
			: buildLaunchSettingsJson(template),
		'utf8',
	);
	// Register the new csproj in the .sfproj. ASP.NET kinds get a
	// <ServiceLaunchUrl> child for VS-canonical parity.
	const sfprojRelToCsproj = toMsbuildRelativePath(sfprojDir, csprojPath);
	const sfprojXml = fs.readFileSync(sfprojPath, 'utf8');
	const patched: string = patchSfprojForProjectReference(sfprojXml, sfprojRelToCsproj, { kind: template.kind });
	if (patched !== sfprojXml) {
		fs.writeFileSync(sfprojPath, patched, 'utf8');
	}
	return { csprojPath, launchSettingsPath, appsettingsDevelopmentPath };
}

/**
 * Computes a Windows-style relative path (using backslashes) from `fromDir` to
 * `toPath`, suitable for embedding directly in a `.csproj` / `.sfproj`.
 */
function toMsbuildRelativePath(fromDir: string, toPath: string): string {
	return path.relative(fromDir, toPath).replace(/\//g, '\\');
}

/**
 * Copies the user-provided guest-executable payload into the service's `Code/`
 * folder. Accepts either a single file or a directory; in the directory case
 * the *contents* are copied (recursively).
 *
 * Returns the absolute path of the primary executable inside `Code/`.
 */
function stageGuestExecutable(sourcePath: string, codeDir: string): string {
	if (fs.statSync(sourcePath).isDirectory()) {
		copyDirectoryRecursive(sourcePath, codeDir);
		// Pick a sensible "primary" exe — first .exe found, else the source folder name.
		return findFirstByExtension(codeDir, '.exe') ?? path.join(codeDir, path.basename(sourcePath));
	}
	const dest = path.join(codeDir, path.basename(sourcePath));
	fs.copyFileSync(sourcePath, dest);
	return dest;
}

function copyDirectoryRecursive(src: string, dest: string): void {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const s = path.join(src, entry.name);
		const d = path.join(dest, entry.name);
		if (entry.isDirectory()) copyDirectoryRecursive(s, d);
		else if (entry.isFile()) fs.copyFileSync(s, d);
	}
}

function findFirstByExtension(dir: string, ext: string): string | undefined {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.toLowerCase().endsWith(ext.toLowerCase())) {
			return path.join(dir, entry.name);
		}
	}
	return undefined;
}
