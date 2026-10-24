import * as path from 'path';
import * as cp from 'child_process';
import { pathExists } from '../util/fs';

/** Where a nuget.exe was found. */
export type NugetSource = 'override' | 'vswhere' | 'path' | 'profile';

export interface NugetLocation {
	executable: string;
	/** Human-readable source, for logs. */
	description: string;
	kind: NugetSource;
}

// `vscode` is loaded lazily so that callers running outside VS Code (notably
// the unit-test harness) can import this module without `Cannot find module
// 'vscode'`. The override setting is a no-op when vscode isn't available.
function tryGetNugetPathOverride(): string {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const v = require('vscode') as typeof import('vscode') | undefined;
		const value = v?.workspace?.getConfiguration?.('serviceFabric')?.get?.('nugetPath');
		return typeof value == 'string' ? value : '';
	} catch {
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
export async function locateNuget(): Promise<NugetLocation | undefined> {
	const overridden = tryGetNugetPathOverride();
	if (overridden && (await pathExists(overridden))) {
		return { executable: overridden, description: `override: ${overridden}`, kind: 'override' };
	}
	if (process.platform === 'win32') {
		const fromVswhere = await locateViaVswhere();
		if (fromVswhere) {
			return { executable: fromVswhere, description: `vswhere: ${fromVswhere}`, kind: 'vswhere' };
		}
	} else if (!(await which('mono'))) {
		// nuget.exe is a .NET Framework program: off Windows it only runs under Mono.
		return undefined;
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

async function locateViaVswhere(): Promise<string | undefined> {
	const programFiles = process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles ?? 'C:\\Program Files (x86)';
	const vswhere = path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
	if (!(await pathExists(vswhere))) return undefined;
	return new Promise((resolve) => {
		const child = cp.spawn(vswhere, ['-latest', '-products', '*', '-find', 'Common7\\IDE\\CommonExtensions\\Microsoft\\NuGet\\NuGet.exe'], {
			windowsHide: true,
		});
		let out = '';
		child.stdout.on('data', (d) => (out += d.toString()));
		child.on('error', () => resolve(undefined));
		child.on('close', () => {
			const lines = out
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean);
			resolve(lines[0]);
		});
	});
}

function locateOnPath(): Promise<string | undefined> {
	return which(process.platform === 'win32' ? 'nuget.exe' : 'nuget');
}

/** First match of `where.exe` (Windows) / `which` (elsewhere) for `name`. */
async function which(name: string): Promise<string | undefined> {
	const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
	const arg = name;
	return new Promise((resolve) => {
		const child = cp.spawn(cmd, [arg], { windowsHide: true });
		let out = '';
		child.stdout.on('data', (d) => (out += d.toString()));
		child.on('error', () => resolve(undefined));
		child.on('close', (code) => {
			if (code !== 0) return resolve(undefined);
			const lines = out
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean);
			resolve(lines[0]);
		});
	});
}

async function locateInUserProfile(): Promise<string | undefined> {
	const home = process.env.USERPROFILE ?? process.env.HOME;
	if (!home) return undefined;
	const candidate = path.join(home, '.nuget', 'nuget.exe');
	return (await pathExists(candidate)) ? candidate : undefined;
}
