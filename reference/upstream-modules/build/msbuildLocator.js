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
exports.locateMsBuild = locateMsBuild;
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs_js_1 = require("../util/fs.js");
// `vscode` is loaded lazily so callers running outside VS Code (the unit-test
// harness) can import this module without `Cannot find module 'vscode'`. The
// override setting is treated as empty when vscode isn't available.
function tryGetMsbuildPathOverride() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const v = require('vscode');
        const cfg = v?.workspace?.getConfiguration?.('serviceFabric');
        const value = cfg?.get?.('msbuildPath');
        return typeof value === 'string' ? value : '';
    }
    catch {
        return '';
    }
}
/**
 * Discover an MSBuild that can build .sfproj files. Resolution order:
 *  1. serviceFabric.msbuildPath setting.
 *  2. vswhere -find MSBuild\\**\\Bin\\MSBuild.exe (Windows-only).
 *  3. `dotnet msbuild` (cross-platform, build-only — packaging targets may
 *     still require the SF Tools targets which only ship on Windows).
 */
async function locateMsBuild() {
    const overridden = tryGetMsbuildPathOverride();
    if (overridden && (await (0, fs_js_1.pathExists)(overridden))) {
        return { executable: overridden, leadingArgs: [], description: `override: ${overridden}` };
    }
    if (process.platform === 'win32') {
        const fromVswhere = await locateViaVswhere();
        if (fromVswhere) {
            return { executable: fromVswhere, leadingArgs: [], description: `vswhere: ${fromVswhere}` };
        }
    }
    return { executable: 'dotnet', leadingArgs: ['msbuild'], description: 'dotnet msbuild (fallback)' };
}
async function locateViaVswhere() {
    const programFiles = process.env['ProgramFiles(x86)'] ?? process.env['ProgramFiles'] ?? 'C:\\Program Files (x86)';
    const vswhere = path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!(await (0, fs_js_1.pathExists)(vswhere)))
        return undefined;
    return new Promise(resolve => {
        const child = (0, child_process_1.spawn)(vswhere, [
            '-latest',
            '-products', '*',
            '-requires', 'Microsoft.Component.MSBuild',
            '-find', 'MSBuild\\**\\Bin\\MSBuild.exe'
        ], { windowsHide: true });
        let out = '';
        child.stdout.on('data', d => (out += d.toString()));
        child.on('error', () => resolve(undefined));
        child.on('close', () => {
            const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            // Prefer the 64-bit / Current build first.
            const preferred = lines.find(l => /amd64\\MSBuild\.exe$/i.test(l)) ??
                lines.find(l => /Current\\Bin\\MSBuild\.exe$/i.test(l)) ??
                lines[0];
            resolve(preferred);
        });
    });
}
//# sourceMappingURL=msbuildLocator.js.map