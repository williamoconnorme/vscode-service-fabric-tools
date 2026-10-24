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
exports.locateNuget = locateNuget;
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs_js_1 = require("../util/fs.js");
// `vscode` is loaded lazily so that callers running outside VS Code (notably
// the unit-test harness) can import this module without `Cannot find module
// 'vscode'`. The override setting is a no-op when vscode isn't available.
function tryGetNugetPathOverride() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const v = require('vscode');
        const cfg = v?.workspace?.getConfiguration?.('serviceFabric');
        const value = cfg?.get?.('nugetPath');
        return typeof value === 'string' ? value : '';
    }
    catch {
        return '';
    }
}
/**
 * Discover a `nuget.exe` capable of restoring `packages.config` style projects.
 *
 * Resolution order:
 *   1. `serviceFabric.nugetPath` setting (override).
 *   2. `vswhere -latest -find Common7\IDE\CommonExtensions\Microsoft\NuGet\NuGet.exe`
 *      (Windows-only — picks up the NuGet.exe that ships with Visual Studio).
 *   3. `nuget` / `nuget.exe` on PATH (`where.exe` on Windows, `which` elsewhere).
 *   4. `%USERPROFILE%\.nuget\nuget.exe` (the profile-cached download many users
 *      have from prior `dotnet tool` or manual installs).
 *
 * Returns `undefined` when no candidate is found; callers fall through to
 * MSBuild-driven restore (strategy C) or the direct nupkg fetch (strategy F).
 */
async function locateNuget() {
    const overridden = tryGetNugetPathOverride();
    if (overridden && (await (0, fs_js_1.pathExists)(overridden))) {
        return { executable: overridden, description: `override: ${overridden}`, kind: 'override' };
    }
    if (process.platform === 'win32') {
        const fromVswhere = await locateViaVswhere();
        if (fromVswhere) {
            return { executable: fromVswhere, description: `vswhere: ${fromVswhere}`, kind: 'vswhere' };
        }
    }
    const onPath = await locateOnPath();
    if (onPath) {
        return { executable: onPath, description: `PATH: ${onPath}`, kind: 'path' };
    }
    const profile = await locateInUserProfile();
    if (profile) {
        return { executable: profile, description: `profile: ${profile}`, kind: 'profile' };
    }
    return undefined;
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
            '-find', 'Common7\\IDE\\CommonExtensions\\Microsoft\\NuGet\\NuGet.exe'
        ], { windowsHide: true });
        let out = '';
        child.stdout.on('data', d => (out += d.toString()));
        child.on('error', () => resolve(undefined));
        child.on('close', () => {
            const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            resolve(lines[0]);
        });
    });
}
async function locateOnPath() {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const arg = process.platform === 'win32' ? 'nuget.exe' : 'nuget';
    return new Promise(resolve => {
        const child = (0, child_process_1.spawn)(cmd, [arg], { windowsHide: true });
        let out = '';
        child.stdout.on('data', d => (out += d.toString()));
        child.on('error', () => resolve(undefined));
        child.on('close', code => {
            if (code !== 0)
                return resolve(undefined);
            const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            resolve(lines[0]);
        });
    });
}
async function locateInUserProfile() {
    const home = process.env['USERPROFILE'] ?? process.env['HOME'];
    if (!home)
        return undefined;
    const candidate = path.join(home, '.nuget', 'nuget.exe');
    return (await (0, fs_js_1.pathExists)(candidate)) ? candidate : undefined;
}
//# sourceMappingURL=nugetLocator.js.map