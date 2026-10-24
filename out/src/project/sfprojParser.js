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
exports.parseSfProj = parseSfProj;
exports.parseApplicationManifest = parseApplicationManifest;
exports.parseServiceManifest = parseServiceManifest;
exports.loadApplicationProject = loadApplicationProject;
const path = __importStar(require("path"));
const fast_xml_parser_1 = require("fast-xml-parser");
const fs_js_1 = require("../util/fs.js");
const msbuildPropertyExpander_js_1 = require("./msbuildPropertyExpander.js");
const xml = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    isArray: (name, _jpath, _isLeaf, _isAttr) => MULTI_ELEMENTS.has(name)
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
    'Content'
]);
async function parseSfProj(absPath) {
    const text = await (0, fs_js_1.readTextFile)(absPath);
    const directory = path.dirname(absPath);
    const tree = xml.parse(text);
    const project = tree?.Project ?? {};
    const propertyGroups = ensureArray(project.PropertyGroup);
    const itemGroups = ensureArray(project.ItemGroup);
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
    const intrinsics = new Map([
        ['MSBuildProjectName', path.basename(absPath, path.extname(absPath))],
        ['MSBuildProjectFile', path.basename(absPath)],
        ['MSBuildProjectExtension', path.extname(absPath)],
        ['MSBuildProjectDirectory', directory],
        ['MSBuildThisFileDirectory', directory + path.sep],
        ['MSBuildThisFileFullPath', absPath]
    ]);
    const properties = (0, msbuildPropertyExpander_js_1.buildPropertyMap)({
        propertyGroups: rawPropertyGroups,
        intrinsics,
        configuration: 'Debug'
    });
    // Read post-expansion values from the property map (honors Conditioned
    // <PropertyGroup>s — `firstScalar` is document-order-first and would
    // silently ignore Condition="'$(Configuration)' == ..."). Track any
    // tokens still unresolved after the map walk so callers can log a single
    // actionable line.
    const outputPath = properties.get('OutputPath');
    const packageLocation = properties.get('PackageLocation');
    const unresolved = new Set();
    const scanUnresolved = (s) => {
        if (!s)
            return;
        for (const m of s.matchAll(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g))
            unresolved.add(m[1]);
    };
    scanUnresolved(outputPath);
    scanUnresolved(packageLocation);
    const projectReferences = [];
    for (const ig of itemGroups) {
        for (const pr of ensureArray(ig.ProjectReference)) {
            const inc = pr['@_Include'];
            if (typeof inc === 'string' && inc.length > 0) {
                projectReferences.push((0, fs_js_1.resolveAgainst)(directory, inc));
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
        unresolvedProperties: unresolved.size > 0 ? [...unresolved] : undefined
    };
}
async function parseApplicationManifest(filePath) {
    if (!(await (0, fs_js_1.pathExists)(filePath)))
        return undefined;
    const text = await (0, fs_js_1.readTextFile)(filePath);
    const tree = xml.parse(text);
    const am = tree?.ApplicationManifest;
    if (!am)
        return undefined;
    const params = [];
    const paramsNode = am.Parameters;
    if (paramsNode) {
        for (const p of ensureArray(paramsNode.Parameter)) {
            if (typeof p['@_Name'] === 'string') {
                params.push({ name: p['@_Name'], defaultValue: p['@_DefaultValue'] });
            }
        }
    }
    const refs = [];
    for (const imp of ensureArray(am.ServiceManifestImport)) {
        const ref = imp.ServiceManifestRef;
        if (ref && typeof ref['@_ServiceManifestName'] === 'string') {
            refs.push({
                name: ref['@_ServiceManifestName'],
                version: ref['@_ServiceManifestVersion'] ?? ''
            });
        }
    }
    return {
        path: filePath,
        applicationTypeName: am['@_ApplicationTypeName'] ?? '',
        applicationTypeVersion: am['@_ApplicationTypeVersion'] ?? '',
        parameters: params,
        serviceManifestRefs: refs
    };
}
async function parseServiceManifest(filePath) {
    if (!(await (0, fs_js_1.pathExists)(filePath)))
        return undefined;
    const text = await (0, fs_js_1.readTextFile)(filePath);
    const tree = xml.parse(text);
    const sm = tree?.ServiceManifest;
    if (!sm)
        return undefined;
    const endpoints = [];
    const resources = sm.Resources;
    if (resources?.Endpoints) {
        for (const ep of ensureArray(resources.Endpoints.Endpoint)) {
            if (typeof ep['@_Name'] === 'string') {
                endpoints.push({
                    name: ep['@_Name'],
                    protocol: ep['@_Protocol'],
                    type: ep['@_Type'],
                    port: ep['@_Port']
                });
            }
        }
    }
    const codePackages = ensureArray(sm.CodePackage)
        .map((c) => c['@_Name'])
        .filter((n) => typeof n === 'string');
    const configPackages = ensureArray(sm.ConfigPackage)
        .map((c) => c['@_Name'])
        .filter((n) => typeof n === 'string');
    const dataPackages = ensureArray(sm.DataPackage)
        .map((c) => c['@_Name'])
        .filter((n) => typeof n === 'string');
    return {
        path: filePath,
        packageDirectory: path.dirname(filePath),
        name: sm['@_Name'] ?? '',
        version: sm['@_Version'] ?? '',
        endpoints,
        codePackages,
        configPackages,
        dataPackages
    };
}
async function loadApplicationProject(sfprojPath) {
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
    const serviceManifests = [];
    const seenPaths = new Set();
    for (const ref of sfproj.projectReferences) {
        const csprojDir = path.dirname(ref);
        const candidate = path.join(csprojDir, 'PackageRoot', 'ServiceManifest.xml');
        if (seenPaths.has(candidate))
            continue;
        const sm = await parseServiceManifest(candidate);
        if (sm) {
            serviceManifests.push(sm);
            seenPaths.add(candidate);
        }
    }
    for (const dir of await (0, fs_js_1.listDirectories)(apkgRoot)) {
        const candidate = path.join(dir, 'ServiceManifest.xml');
        if (seenPaths.has(candidate))
            continue;
        const sm = await parseServiceManifest(candidate);
        if (sm) {
            serviceManifests.push(sm);
            seenPaths.add(candidate);
        }
    }
    const publishProfiles = await (0, fs_js_1.listFiles)(path.join(sfproj.directory, 'PublishProfiles'), '.xml');
    const applicationParameters = await (0, fs_js_1.listFiles)(path.join(sfproj.directory, 'ApplicationParameters'), '.xml');
    const startupServiceParameters = await (0, fs_js_1.listFiles)(path.join(sfproj.directory, 'StartupServiceParameters'), '.xml');
    const startupServicesPath = path.join(sfproj.directory, 'StartupServices.xml');
    const startupServicesManifest = (await (0, fs_js_1.pathExists)(startupServicesPath)) ? startupServicesPath : undefined;
    const scripts = await (0, fs_js_1.listFiles)(path.join(sfproj.directory, 'Scripts'), '.ps1');
    return {
        sfproj,
        applicationManifest,
        serviceManifests,
        publishProfiles,
        applicationParameters,
        startupServiceParameters,
        startupServicesManifest,
        scripts
    };
}
function ensureArray(v) {
    if (v === undefined || v === null)
        return [];
    return Array.isArray(v) ? v : [v];
}
function firstScalar(propertyGroups, name) {
    for (const pg of propertyGroups) {
        const v = pg?.[name];
        if (typeof v === 'string')
            return v;
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
function collectRawPropertyGroups(propertyGroups) {
    const out = [];
    for (const pg of propertyGroups) {
        if (!pg || typeof pg !== 'object')
            continue;
        const condition = typeof pg['@_Condition'] === 'string' ? pg['@_Condition'] : undefined;
        const properties = [];
        for (const [key, raw] of Object.entries(pg)) {
            if (key.startsWith('@_') || key === '#text')
                continue;
            if (typeof raw === 'string') {
                properties.push({ name: key, value: raw });
            }
            else if (raw && typeof raw === 'object' && '#text' in raw && typeof raw['#text'] === 'string') {
                properties.push({ name: key, value: raw['#text'] });
            }
        }
        out.push({ condition, properties });
    }
    return out;
}
//# sourceMappingURL=sfprojParser.js.map