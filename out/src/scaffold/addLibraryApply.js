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
exports.applyAddLibrary = applyAddLibrary;
exports.applyAddLibraryReferenceOnly = applyAddLibraryReferenceOnly;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const addLibraryTemplates_js_1 = require("./addLibraryTemplates.js");
/**
 * Pure (no `vscode` import) on-disk apply step for `serviceFabric.addLibrary`.
 * Per Plan §6.3:
 *   1. Create `<workspaceRoot>/<name>/<name>.csproj` (minimal SDK shape).
 *   2. Create `<name>/Class1.cs`.
 *   3. For each consumer csproj, append a `<ProjectReference>` row to it.
 *      Idempotent — already-referenced consumers are left untouched.
 *   4. NEVER touch `<App>.sfproj`, ApplicationManifest.xml, StartupServices.xml,
 *      or any `*Parameters/*.xml` file. Libraries are not part of the SF
 *      manifest model.
 *
 * Rollback semantics: if any step throws, the library directory is removed
 * (best-effort) so a re-run starts from a clean slate. Already-patched
 * consumer csprojs remain patched — adding the same reference twice is a
 * no-op via `patchCsprojAddProjectReference`'s idempotency.
 */
async function applyAddLibrary(opts) {
    if (!opts.name || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(opts.name)) {
        throw new Error(`Invalid library name: '${opts.name}'.`);
    }
    if (!opts.workspaceRoot || !fs.existsSync(opts.workspaceRoot)) {
        throw new Error(`Workspace root does not exist: '${opts.workspaceRoot}'.`);
    }
    const libraryDirectory = path.join(opts.workspaceRoot, opts.name);
    const libraryCsprojPath = path.join(libraryDirectory, `${opts.name}.csproj`);
    const classStubPath = path.join(libraryDirectory, 'Class1.cs');
    if (fs.existsSync(libraryDirectory)) {
        const entries = fs.readdirSync(libraryDirectory);
        if (entries.length > 0 && !opts.allowExistingEmptyFolder) {
            throw new Error(`Cannot create library: folder already exists and is non-empty: ${libraryDirectory}`);
        }
    }
    else {
        fs.mkdirSync(libraryDirectory, { recursive: true });
    }
    let scaffoldedFiles = false;
    try {
        fs.writeFileSync(libraryCsprojPath, (0, addLibraryTemplates_js_1.buildLibraryCsproj)({ name: opts.name, targetFramework: opts.targetFramework }), 'utf8');
        fs.writeFileSync(classStubPath, (0, addLibraryTemplates_js_1.buildLibraryClassStub)(opts.name), 'utf8');
        scaffoldedFiles = true;
        const patched = [];
        for (const consumer of opts.consumers) {
            if (!fs.existsSync(consumer)) {
                throw new Error(`Consumer csproj does not exist: ${consumer}`);
            }
            const xml = fs.readFileSync(consumer, 'utf8');
            if ((0, addLibraryTemplates_js_1.isServiceFabricServiceProject)(xml)) {
                // Service csproj — fine, this is the typical case (a service consuming a library).
            }
            const consumerDir = path.dirname(consumer);
            const rel = toMsbuildRelativePath(consumerDir, libraryCsprojPath);
            const result = (0, addLibraryTemplates_js_1.patchCsprojAddProjectReference)(xml, rel);
            if (result.changed) {
                fs.writeFileSync(consumer, result.xml, 'utf8');
                patched.push(consumer);
            }
        }
        return {
            libraryDirectory,
            libraryCsprojPath,
            classStubPath,
            patchedConsumers: patched
        };
    }
    catch (err) {
        // Best-effort rollback of just the scaffolded files; consumer patches
        // are kept (they're idempotent on retry).
        if (scaffoldedFiles) {
            try {
                fs.unlinkSync(libraryCsprojPath);
            }
            catch { /* best-effort */ }
            try {
                fs.unlinkSync(classStubPath);
            }
            catch { /* best-effort */ }
        }
        try {
            if (fs.existsSync(libraryDirectory) && fs.readdirSync(libraryDirectory).length === 0) {
                fs.rmdirSync(libraryDirectory);
            }
        }
        catch { /* best-effort */ }
        throw err;
    }
}
/**
 * "Reference existing library" path (Plan §6.2.b — `.csproj`-context invocation).
 * Adds a single `<ProjectReference>` row in the right-clicked csproj that points
 * at an already-existing library csproj. Does not create any new files.
 *
 * Returns `{ changed: true }` when the consumer was patched, or
 * `{ changed: false }` when the reference already existed (idempotent).
 */
async function applyAddLibraryReferenceOnly(opts) {
    if (!fs.existsSync(opts.consumerCsproj)) {
        throw new Error(`Consumer csproj does not exist: ${opts.consumerCsproj}`);
    }
    if (!fs.existsSync(opts.targetCsproj)) {
        throw new Error(`Target csproj does not exist: ${opts.targetCsproj}`);
    }
    const targetXml = fs.readFileSync(opts.targetCsproj, 'utf8');
    if ((0, addLibraryTemplates_js_1.isServiceFabricServiceProject)(targetXml)) {
        throw new Error(`Refusing to add a reference to '${path.basename(opts.targetCsproj)}': it is a Service Fabric service project. ` +
            `Use 'Service Fabric: Add Service…' for service-to-service references.`);
    }
    const consumerDir = path.dirname(opts.consumerCsproj);
    const rel = toMsbuildRelativePath(consumerDir, opts.targetCsproj);
    const consumerXml = fs.readFileSync(opts.consumerCsproj, 'utf8');
    const result = (0, addLibraryTemplates_js_1.patchCsprojAddProjectReference)(consumerXml, rel);
    if (result.changed) {
        fs.writeFileSync(opts.consumerCsproj, result.xml, 'utf8');
    }
    return { changed: result.changed, relativePath: rel };
}
/**
 * Computes a relative path between two absolute filesystem paths and converts
 * forward-slashes to back-slashes so it can be embedded directly in MSBuild
 * `Include="..."` attributes.
 */
function toMsbuildRelativePath(fromDir, toPath) {
    const rel = path.relative(fromDir, toPath);
    return rel.split('/').join('\\');
}
//# sourceMappingURL=addLibraryApply.js.map