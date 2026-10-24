import * as path from 'path';
import * as cp from 'child_process';
import { pathExists } from '../util/fs';

/** How to invoke MSBuild: `executable ...leadingArgs <project> <switches>`. */
export interface MsBuildInvocation {
	executable: string;
	/** Arguments placed before the project path (e.g. `['msbuild']` for `dotnet msbuild`). */
	leadingArgs: string[];
	/** Human-readable source of the executable, for logs and task details. */
	description: string;
}

// `vscode` is loaded lazily so callers running outside VS Code (the unit-test
// harness) can import this module without `Cannot find module 'vscode'`. The
// override setting is treated as empty when vscode isn't available.
function tryGetMsbuildPathOverride(): string {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const v = require('vscode') as typeof import('vscode') | undefined;
		const value = v?.workspace?.getConfiguration?.('serviceFabric')?.get?.('msbuildPath');
		return typeof value == 'string' ? value : '';
	} catch {
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
export async function locateMsBuild(): Promise<MsBuildInvocation> {
	const overridden = tryGetMsbuildPathOverride();
	if (overridden && (await pathExists(overridden))) {
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

async function locateViaVswhere(): Promise<string | undefined> {
	const programFiles = process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles ?? 'C:\\Program Files (x86)';
	const vswhere = path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
	if (!(await pathExists(vswhere))) return undefined;
	return new Promise((resolve) => {
		const child = cp.spawn(
			vswhere,
			['-latest', '-products', '*', '-requires', 'Microsoft.Component.MSBuild', '-find', 'MSBuild\\**\\Bin\\MSBuild.exe'],
			{ windowsHide: true },
		);
		let out = '';
		child.stdout.on('data', (d) => (out += d.toString()));
		child.on('error', () => resolve(undefined));
		child.on('close', () => {
			const lines = out
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean);
			// Prefer the 64-bit / Current build first.
			const preferred =
				lines.find((l) => /amd64\\MSBuild\.exe$/i.test(l)) ?? lines.find((l) => /Current\\Bin\\MSBuild\.exe$/i.test(l)) ?? lines[0];
			resolve(preferred);
		});
	});
}
