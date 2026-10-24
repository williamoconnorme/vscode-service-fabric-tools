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
exports.applyCreateApplication = applyCreateApplication;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const addServiceTemplates_js_1 = require("./addServiceTemplates.js");
const createApplicationTemplates_js_1 = require("./createApplicationTemplates.js");
/**
 * Pure (no `vscode` import) on-disk apply step for `serviceFabric.createApplication`.
 *
 * Lays out the same directory shape that Visual Studio's "Service Fabric
 * Application" project template produces — including
 * `Scripts/Deploy-FabricApplication.ps1`, `StartupServices.xml`, and the
 * three-environment `{Cloud,Local.1Node,Local.5Node}` triads under
 * `ApplicationParameters/`, `PublishProfiles/`, and `StartupServiceParameters/`.
 */
function applyCreateApplication(opts) {
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
    const seededIsCsharp = (0, addServiceTemplates_js_1.isCsharpKind)(seededKind);
    const repoDir = path.dirname(root);
    const seededTemplate = {
        serviceName: opts.serviceName,
        serviceTypeName: opts.serviceTypeName ?? `${opts.serviceName}Type`,
        kind: seededKind,
        runtime: opts.runtime ?? 'netcore',
        version: opts.serviceVersion ?? '1.0.0',
        targetFramework: opts.targetFramework
    };
    const seededSettings = seededIsCsharp ? (0, addServiceTemplates_js_1.resolveCsharpSettings)(seededTemplate) : undefined;
    const seededCsprojDir = seededIsCsharp && seededSettings
        ? path.join(repoDir, seededSettings.csprojDirName)
        : undefined;
    const svcPkg = seededIsCsharp && seededCsprojDir
        ? path.join(seededCsprojDir, 'PackageRoot')
        : path.join(apkg, `${opts.serviceName}Pkg`);
    if (seededIsCsharp && seededCsprojDir && fs.existsSync(seededCsprojDir)) {
        throw new Error(`Cannot scaffold C# project: directory already exists: ${seededCsprojDir}`);
    }
    // Base directories.
    fs.mkdirSync(apkg, { recursive: true });
    if (seededIsCsharp) {
        // Physical PackageRoot lives under csprojDir.
        fs.mkdirSync(path.join(svcPkg, 'Config'), { recursive: true });
    }
    else {
        fs.mkdirSync(path.join(svcPkg, 'Code'), { recursive: true });
        fs.mkdirSync(path.join(svcPkg, 'Config'), { recursive: true });
    }
    fs.mkdirSync(appParamsDir, { recursive: true });
    fs.mkdirSync(publishDir, { recursive: true });
    fs.mkdirSync(startupParamsDir, { recursive: true });
    fs.mkdirSync(scriptsDir, { recursive: true });
    // .sfproj (root file).
    const sfprojPath = path.join(root, `${opts.applicationName}.sfproj`);
    fs.writeFileSync(sfprojPath, (0, createApplicationTemplates_js_1.buildSfprojXml)(opts), 'utf8');
    // packages.config (root).
    const packagesConfigPath = path.join(root, 'packages.config');
    fs.writeFileSync(packagesConfigPath, (0, createApplicationTemplates_js_1.buildPackagesConfigXml)(), 'utf8');
    // ApplicationManifest.xml + ServiceManifest.xml + Settings.xml.
    const applicationManifestPath = path.join(apkg, 'ApplicationManifest.xml');
    fs.writeFileSync(applicationManifestPath, (0, createApplicationTemplates_js_1.buildApplicationManifestXml)(opts), 'utf8');
    const serviceManifestPath = path.join(svcPkg, 'ServiceManifest.xml');
    fs.writeFileSync(serviceManifestPath, (0, createApplicationTemplates_js_1.buildServiceManifestXml)(opts), 'utf8');
    const settingsXmlPath = path.join(svcPkg, 'Config', 'Settings.xml');
    fs.writeFileSync(settingsXmlPath, (0, createApplicationTemplates_js_1.buildSettingsXml)(), 'utf8');
    // Per-environment triads.
    const publishProfilePaths = [];
    const applicationParameterPaths = [];
    const startupServiceParameterPaths = [];
    for (const env of createApplicationTemplates_js_1.ENVIRONMENT_NAMES) {
        publishProfilePaths.push(writeEnvFile(publishDir, env, (0, createApplicationTemplates_js_1.buildPublishProfileXml)(env)));
        applicationParameterPaths.push(writeEnvFile(appParamsDir, env, (0, createApplicationTemplates_js_1.buildApplicationParametersXml)(opts, env)));
        startupServiceParameterPaths.push(writeEnvFile(startupParamsDir, env, (0, createApplicationTemplates_js_1.buildStartupServiceParametersXml)(opts, env)));
    }
    // StartupServices.xml (root).
    const startupServicesPath = path.join(root, 'StartupServices.xml');
    fs.writeFileSync(startupServicesPath, (0, createApplicationTemplates_js_1.buildStartupServicesXml)(opts), 'utf8');
    // Scripts/Deploy-FabricApplication.ps1.
    const deployScriptPath = path.join(scriptsDir, 'Deploy-FabricApplication.ps1');
    fs.writeFileSync(deployScriptPath, (0, createApplicationTemplates_js_1.buildDeployFabricApplicationScript)(), 'utf8');
    // Companion C# project for the seeded service (when kind is C#).
    let csprojPath;
    let launchSettingsPath;
    let appsettingsDevelopmentPath;
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
        appsettingsDevelopmentPath
    };
}
/**
 * Scaffolds the C# project that backs the seeded service, mirroring the
 * layout `addServiceApply.scaffoldCsharpProject` produces. Lives in a sibling
 * folder of the .sfproj's directory and is registered as a `<ProjectReference>`
 * in the .sfproj.
 */
function scaffoldSeededCsharpProject(template, settings, csprojDir, sfprojPath) {
    fs.mkdirSync(csprojDir, { recursive: true });
    const csprojPath = path.join(csprojDir, `${settings.csprojDirName}.csproj`);
    fs.writeFileSync(csprojPath, (0, addServiceTemplates_js_1.buildCsharpCsproj)(template, undefined, settings), 'utf8');
    fs.writeFileSync(path.join(csprojDir, 'Program.cs'), (0, addServiceTemplates_js_1.buildCsharpProgramCs)(template, settings), 'utf8');
    if (template.kind === 'actor') {
        // Sibling-project layout: actor host + interfaces project side-by-side.
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
    fs.writeFileSync(launchSettingsPath, launchPort !== undefined
        ? (0, addServiceTemplates_js_1.buildLaunchSettingsJson)(template, launchPort)
        : (0, addServiceTemplates_js_1.buildLaunchSettingsJson)(template), 'utf8');
    // Register the new csproj in the .sfproj. ASP.NET kinds get the
    // ServiceLaunchUrl child for VS-canonical parity.
    const sfprojDir = path.dirname(sfprojPath);
    const sfprojRelToCsproj = toMsbuildRelativePath(sfprojDir, csprojPath);
    const sfprojXml = fs.readFileSync(sfprojPath, 'utf8');
    const patched = (0, addServiceTemplates_js_1.patchSfprojForProjectReference)(sfprojXml, sfprojRelToCsproj, { kind: template.kind });
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
function toMsbuildRelativePath(fromDir, toPath) {
    const rel = path.relative(fromDir, toPath);
    return rel.split('/').join('\\');
}
function writeEnvFile(dir, env, content) {
    const p = path.join(dir, `${env}.xml`);
    fs.writeFileSync(p, content, 'utf8');
    return p;
}
//# sourceMappingURL=createApplicationApply.js.map