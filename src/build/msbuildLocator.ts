// @ts-nocheck
import * as path from 'path';
import * as cp from 'child_process';
import { pathExists } from '../util/fs';

function tryGetMsbuildPathOverride() {
	try {
		let r = require('vscode')?.workspace?.getConfiguration?.('serviceFabric')?.get?.('msbuildPath');
		return typeof r == 'string' ? r : '';
	} catch {
		return '';
	}
}

async function locateMsBuild() {
	let e = tryGetMsbuildPathOverride();
	if (e && (await pathExists(e)))
		return {
			executable: e,
			leadingArgs: [],
			description: `override: ${e}`,
		};
	if (process.platform === 'win32') {
		let t = await locateViaVswhere();
		if (t)
			return {
				executable: t,
				leadingArgs: [],
				description: `vswhere: ${t}`,
			};
	}
	return {
		executable: 'dotnet',
		leadingArgs: ['msbuild'],
		description: 'dotnet msbuild (fallback)',
	};
}

async function locateViaVswhere() {
	let e = process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles ?? 'C:\\Program Files (x86)',
		t = path.join(e, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
	if (await pathExists(t))
		return new Promise((r) => {
			let n = (0, cp.spawn)(
					t,
					['-latest', '-products', '*', '-requires', 'Microsoft.Component.MSBuild', '-find', 'MSBuild\\**\\Bin\\MSBuild.exe'],
					{
						windowsHide: !0,
					},
				),
				i = '';
			(n.stdout.on('data', (o) => (i += o.toString())),
				n.on('error', () => r(void 0)),
				n.on('close', () => {
					let o = i
							.split(/\r?\n/)
							.map((a) => a.trim())
							.filter(Boolean),
						s = o.find((a) => /amd64\\MSBuild\.exe$/i.test(a)) ?? o.find((a) => /Current\\Bin\\MSBuild\.exe$/i.test(a)) ?? o[0];
					r(s);
				}));
		});
}

export { locateMsBuild };
