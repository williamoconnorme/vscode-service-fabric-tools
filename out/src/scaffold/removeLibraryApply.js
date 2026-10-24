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
exports.applyRemoveLibrary = applyRemoveLibrary;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const addLibraryTemplates_js_1 = require("./addLibraryTemplates.js");
/**
 * Pure (no `vscode` import) on-disk apply step for `serviceFabric.removeLibrary`.
 *
 * Per Plan §6.9.2:
 *   1. For each picked consumer, remove the matching `<ProjectReference>`
 *      row from its csproj (idempotent — already-absent references are a no-op).
 *   2. Empty `<ItemGroup>` containers left behind by the removal are dropped.
 *   3. If `deleteFolder: true` AND no other csproj in the workspace still
 *      references the library, recursively delete the library directory.
 *      Folder-deletion failures surface in the result message but do NOT
 *      revert the consumer-csproj edits — they are committed before the
 *      delete is even attempted.
 *   4. NEVER touches `.sfproj`, ApplicationManifest.xml, StartupServices.xml,
 *      or any per-environment parameter file.
 *
 * Refuses to operate on a service csproj (`<IsServiceFabricServiceProject>True</…>`).
 */
async function applyRemoveLibrary(opts) {
    const libraryDir = path.dirname(opts.libraryCsprojPath);
    if (!fs.existsSync(opts.libraryCsprojPath)) {
        throw new Error(`Library csproj does not exist: ${opts.libraryCsprojPath}`);
    }
    const libXml = fs.readFileSync(opts.libraryCsprojPath, 'utf8');
    if ((0, addLibraryTemplates_js_1.isServiceFabricServiceProject)(libXml)) {
        throw new Error(`Refusing to remove '${path.basename(opts.libraryCsprojPath)}': it is a Service Fabric service project. ` +
            `Use 'Service Fabric: Remove Service…' for services.`);
    }
    const unwired = [];
    for (const consumer of opts.consumers) {
        if (!fs.existsSync(consumer))
            continue;
        const consumerDir = path.dirname(consumer);
        const xml = fs.readFileSync(consumer, 'utf8');
        const variants = computeRelativePathVariants(consumerDir, opts.libraryCsprojPath);
        let patchedXml = xml;
        let changed = false;
        for (const rel of variants) {
            const r = (0, addLibraryTemplates_js_1.patchCsprojRemoveProjectReference)(patchedXml, rel);
            if (r.changed) {
                patchedXml = r.xml;
                changed = true;
            }
        }
        if (changed) {
            fs.writeFileSync(consumer, patchedXml, 'utf8');
            unwired.push(consumer);
        }
    }
    let folderDeleted = false;
    if (opts.deleteFolder) {
        // Folder deletion is only safe when no other csproj in the workspace
        // still references the library. The caller is expected to have
        // verified this (the `.sfproj`-context flow passes the union of all
        // consumers), but we re-check by scanning the parent directory.
        // The plain check here is intentionally simple: scan siblings of the
        // library folder for csprojs and look for the library reference.
        const anyRemaining = await anyConsumerStillReferences(opts.libraryCsprojPath, libraryDir);
        if (!anyRemaining) {
            try {
                fs.rmSync(libraryDir, { recursive: true, force: true });
                folderDeleted = true;
            }
            catch (err) {
                // Surface the failure but do NOT revert consumer edits.
                throw new Error(`Consumers were unwired but the library folder could not be deleted: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    return {
        unwiredConsumers: unwired,
        folderDeleted,
        libraryDirectory: libraryDir
    };
}
/**
 * Scans `<libraryDir>/..` recursively for csprojs that still contain a
 * `<ProjectReference>` to the library. Bounded to keep it cheap on large
 * workspaces; we don't recurse below 4 levels deep (the realistic worst case
 * for SF apps).
 */
async function anyConsumerStillReferences(libraryCsprojPath, libraryDir) {
    const root = path.dirname(libraryDir);
    const libName = path.basename(libraryCsprojPath).toLowerCase();
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length > 0) {
        const { dir, depth } = stack.pop();
        if (depth > 4)
            continue;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries) {
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === 'node_modules' || e.name === '.git' || e.name === 'bin' || e.name === 'obj' || e.name === 'packages')
                    continue;
                if (abs === libraryDir)
                    continue;
                stack.push({ dir: abs, depth: depth + 1 });
                continue;
            }
            if (!e.isFile())
                continue;
            if (!e.name.toLowerCase().endsWith('.csproj'))
                continue;
            try {
                const xml = fs.readFileSync(abs, 'utf8');
                const re = /<ProjectReference\s+Include="([^"]+)"/gi;
                let m;
                while ((m = re.exec(xml)) !== null) {
                    const includePath = m[1].toLowerCase().replace(/\//g, '\\');
                    if (includePath.endsWith(`\\${libName}`) || includePath === libName) {
                        return true;
                    }
                }
            }
            catch {
                // best-effort
            }
        }
    }
    return false;
}
function computeRelativePathVariants(fromDir, toPath) {
    const rel = path.relative(fromDir, toPath);
    const back = rel.split('/').join('\\');
    const fwd = rel.split('\\').join('/');
    return Array.from(new Set([back, fwd, rel]));
}
//# sourceMappingURL=removeLibraryApply.js.map