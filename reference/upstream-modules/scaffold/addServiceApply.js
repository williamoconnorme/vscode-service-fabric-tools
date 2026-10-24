"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAddService = applyAddService;
exports.collectExistingServiceNames = collectExistingServiceNames;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const addServiceTemplates_js_1 = require("./addServiceTemplates.js");
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
async function applyAddService(project, template, options) {
    if (!project.applicationManifest) {
        throw new Error('Application manifest is missing.');
    }
    const existing = collectExistingServiceNames(project);
    if (existing.has(template.serviceName.toLowerCase())) {
        throw new Error(`A service named '${template.serviceName}' already exists in this application.`);
    }
    if (existing.has(`${template.serviceName.toLowerCase()}pkg`)) {
        throw new Error(`A service package '${template.serviceName}Pkg' already exists.`);
    }
    if (template.kind === 'guest' && !options?.guestSourcePath) {
        throw new Error('Guest executable scaffold requires options.guestSourcePath.');
    }
    const projectDir = path.dirname(project.sfproj.path);
    const apkgDir = path.join(projectDir, project.sfproj.applicationPackageRootFolder);
    const repoDir = path.dirname(projectDir);
    // Layout decision: C# kinds host PackageRoot inside their csproj folder
    // (sibling-project layout, matching the VS canonical Application1 shape);
    // guest kinds continue to live under <App>/ApplicationPackageRoot/<Service>Pkg/.
    const csharp = (0, addServiceTemplates_js_1.isCsharpKind)(template.kind);
    const settings = csharp ? (0, addServiceTemplates_js_1.resolveCsharpSettings)(template) : undefined;
    const csprojDir = csharp && settings
        ? path.join(repoDir, settings.csprojDirName)
        : undefined;
    const svcDir = csharp && csprojDir
        ? path.join(csprojDir, 'PackageRoot')
        : path.join(apkgDir, `${template.serviceName}Pkg`);
    if (csharp && csprojDir && fs.existsSync(csprojDir)) {
        throw new Error(`Cannot scaffold C# project: directory already exists: ${csprojDir}`);
    }
    if (!csharp && fs.existsSync(svcDir)) {
        throw new Error(`Service folder already exists on disk: ${svcDir}`);
    }
    // For guest kinds, derive the program name from the source binary so the
    // manifest's <Program> element matches the file we actually copied in.
    let effectiveTemplate = template;
    if (template.kind === 'guest' && options?.guestSourcePath) {
        const src = options.guestSourcePath;
        const stat = fs.statSync(src);
        const programName = stat.isDirectory()
            ? template.exeProgram ?? `${template.serviceName}.exe`
            : path.basename(src);
        effectiveTemplate = { ...template, exeProgram: programName };
    }
    // Create the package-root directory tree. C# kinds (physical layout) only
    // need <csprojDir>/PackageRoot/Config/; guest kinds also need a Code/ to
    // receive the staged executable.
    fs.mkdirSync(path.join(svcDir, 'Config'), { recursive: true });
    if (!csharp) {
        fs.mkdirSync(path.join(svcDir, 'Code'), { recursive: true });
    }
    const serviceManifestPath = path.join(svcDir, 'ServiceManifest.xml');
    fs.writeFileSync(serviceManifestPath, (0, addServiceTemplates_js_1.buildServiceManifestXml)(effectiveTemplate), 'utf8');
    fs.writeFileSync(path.join(svcDir, 'Config', 'Settings.xml'), (0, addServiceTemplates_js_1.buildSettingsXml)(), 'utf8');
    let guestExePath;
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
    const patchedAppManifest = useStartupServices
        ? (0, addServiceTemplates_js_1.patchApplicationManifestImports)(original, effectiveTemplate)
        : (0, addServiceTemplates_js_1.patchApplicationManifest)(original, effectiveTemplate);
    fs.writeFileSync(appManifestPath, patchedAppManifest, 'utf8');
    let startupServicesManifestPath;
    if (useStartupServices && project.startupServicesManifest) {
        startupServicesManifestPath = project.startupServicesManifest;
        const before = fs.readFileSync(startupServicesManifestPath, 'utf8');
        const after = (0, addServiceTemplates_js_1.patchStartupServicesXml)(before, effectiveTemplate);
        if (after !== before) {
            fs.writeFileSync(startupServicesManifestPath, after, 'utf8');
        }
    }
    const patchedParamFiles = [];
    for (const paramFile of project.applicationParameters) {
        try {
            const flavor = (0, addServiceTemplates_js_1.classifyEnvironment)(path.basename(paramFile));
            const before = fs.readFileSync(paramFile, 'utf8');
            const after = (0, addServiceTemplates_js_1.patchApplicationParametersXml)(before, effectiveTemplate, flavor);
            if (after !== before) {
                fs.writeFileSync(paramFile, after, 'utf8');
                patchedParamFiles.push(paramFile);
            }
        }
        catch {
            // best-effort
        }
    }
    const patchedStartupParamFiles = [];
    if (useStartupServices) {
        for (const paramFile of project.startupServiceParameters) {
            try {
                const flavor = (0, addServiceTemplates_js_1.classifyEnvironment)(path.basename(paramFile));
                const before = fs.readFileSync(paramFile, 'utf8');
                const after = (0, addServiceTemplates_js_1.patchStartupServiceParametersXml)(before, effectiveTemplate, flavor);
                if (after !== before) {
                    fs.writeFileSync(paramFile, after, 'utf8');
                    patchedStartupParamFiles.push(paramFile);
                }
            }
            catch {
                // best-effort
            }
        }
    }
    let csprojPath;
    let launchSettingsPath;
    let appsettingsDevelopmentPath;
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
        guestExePath
    };
}
function collectExistingServiceNames(project) {
    const names = new Set();
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
function scaffoldCsharpProject(project, template, csprojDir, settings) {
    const sfprojPath = project.sfproj.path;
    const sfprojDir = path.dirname(sfprojPath);
    const repoDir = path.dirname(sfprojDir);
    // Make sure the csproj folder exists. applyAddService already created
    // <csprojDir>/PackageRoot/Config so this is normally a no-op; defensively
    // re-create in case a different caller wires us up.
    fs.mkdirSync(csprojDir, { recursive: true });
    const csprojPath = path.join(csprojDir, `${settings.csprojDirName}.csproj`);
    fs.writeFileSync(csprojPath, (0, addServiceTemplates_js_1.buildCsharpCsproj)(template, undefined, settings), 'utf8');
    fs.writeFileSync(path.join(csprojDir, 'Program.cs'), (0, addServiceTemplates_js_1.buildCsharpProgramCs)(template, settings), 'utf8');
    if (template.kind === 'actor') {
        // Sibling-project layout: actor host lives at <csprojDir>; the public
        // interface contract lives in a separate <Folder>.Interfaces project
        // next to it, matching the VS canonical Application1 shape.
        const interfacesDir = `${csprojDir}.Interfaces`;
        fs.mkdirSync(interfacesDir, { recursive: true });
        fs.writeFileSync(path.join(interfacesDir, `${settings.csprojDirName}.Interfaces.csproj`), (0, addServiceTemplates_js_1.buildActorInterfacesCsproj)(template, settings), 'utf8');
        fs.writeFileSync(path.join(interfacesDir, `${settings.actorInterfaceName}.cs`), (0, addServiceTemplates_js_1.buildActorInterfaceCs)(template, settings), 'utf8');
        fs.writeFileSync(path.join(csprojDir, `${settings.actorTypeName}.cs`), (0, addServiceTemplates_js_1.buildActorCs)(template, settings), 'utf8');
    }
    else {
        fs.writeFileSync(path.join(csprojDir, `${settings.className}.cs`), (0, addServiceTemplates_js_1.buildCsharpServiceCs)(template, settings), 'utf8');
    }
    let appsettingsDevelopmentPath;
    if ((0, addServiceTemplates_js_1.isAspNetKind)(template.kind)) {
        const controllersDir = path.join(csprojDir, 'Controllers');
        fs.mkdirSync(controllersDir, { recursive: true });
        fs.writeFileSync(path.join(controllersDir, 'ValuesController.cs'), (0, addServiceTemplates_js_1.buildAspNetValuesControllerCs)(template, settings), 'utf8');
        fs.writeFileSync(path.join(csprojDir, 'appsettings.json'), (0, addServiceTemplates_js_1.buildAspNetAppsettingsJson)(), 'utf8');
        appsettingsDevelopmentPath = path.join(csprojDir, 'appsettings.Development.json');
        fs.writeFileSync(appsettingsDevelopmentPath, (0, addServiceTemplates_js_1.buildAspNetAppsettingsDevelopmentJson)(), 'utf8');
    }
    // Properties/launchSettings.json — enables F5 / dotnet run for every C# kind.
    const propertiesDir = path.join(csprojDir, 'Properties');
    fs.mkdirSync(propertiesDir, { recursive: true });
    const launchSettingsPath = path.join(propertiesDir, 'launchSettings.json');
    const launchPort = template.endpointPort ?? ((0, addServiceTemplates_js_1.isAspNetKind)(template.kind) ? 8559 : undefined);
    // ASP.NET kinds with HTTPS opt-in get a dual-scheme applicationUrl.
    const httpsPort = (0, addServiceTemplates_js_1.isAspNetKind)(template.kind) && template.httpsEndpoint
        ? template.httpsEndpoint.port ?? 8443
        : undefined;
    fs.writeFileSync(launchSettingsPath, launchPort !== undefined
        ? (0, addServiceTemplates_js_1.buildLaunchSettingsJson)(template, { http: launchPort, https: httpsPort })
        : (0, addServiceTemplates_js_1.buildLaunchSettingsJson)(template), 'utf8');
    // Register the new csproj in the .sfproj. ASP.NET kinds get a
    // <ServiceLaunchUrl> child for VS-canonical parity.
    const sfprojRelToCsproj = toMsbuildRelativePath(sfprojDir, csprojPath);
    const sfprojXml = fs.readFileSync(sfprojPath, 'utf8');
    const patched = (0, addServiceTemplates_js_1.patchSfprojForProjectReference)(sfprojXml, sfprojRelToCsproj, { kind: template.kind });
    if (patched !== sfprojXml) {
        fs.writeFileSync(sfprojPath, patched, 'utf8');
    }
    // Reference the unused `repoDir` so type-narrowing keeps it in scope —
    // a future iteration may need it for sibling-project lookups.
    void repoDir;
    return { csprojPath, launchSettingsPath, appsettingsDevelopmentPath };
}
/**
 * Computes a Windows-style relative path (using backslashes) from `fromDir` to
 * `toPath`, suitable for embedding directly in a `.csproj` / `.sfproj`.
 */
function toMsbuildRelativePath(fromDir, toPath) {
    return path.relative(fromDir, toPath).replace(/\//g, '\\');
}
/**
 * Copies the user-provided guest-executable payload into the service's `Code/`
 * folder. Accepts either a single file or a directory; in the directory case
 * the *contents* are copied (recursively).
 *
 * Returns the absolute path of the primary executable inside `Code/`.
 */
function stageGuestExecutable(sourcePath, codeDir) {
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
        copyDirectoryRecursive(sourcePath, codeDir);
        // Pick a sensible "primary" exe — first .exe found, else the source folder name.
        const exe = findFirstByExtension(codeDir, '.exe');
        return exe ?? path.join(codeDir, path.basename(sourcePath));
    }
    const dest = path.join(codeDir, path.basename(sourcePath));
    fs.copyFileSync(sourcePath, dest);
    return dest;
}
function copyDirectoryRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory())
            copyDirectoryRecursive(s, d);
        else if (entry.isFile())
            fs.copyFileSync(s, d);
    }
}
function findFirstByExtension(dir, ext) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(ext.toLowerCase())) {
            return path.join(dir, entry.name);
        }
    }
    return undefined;
}
//# sourceMappingURL=addServiceApply.js.map