// @ts-nocheck
import * as path from 'path';
import * as cp from 'child_process';
import { pathExists } from '../util/fs';

function tryGetNugetPathOverride() {
	try {
		let r = require('vscode')?.workspace?.getConfiguration?.('serviceFabric')?.get?.('nugetPath');
		return typeof r == 'string' ? r : '';
	} catch {
		return '';
	}
}

async function locateNuget() {
	let e = tryGetNugetPathOverride();
	if (e && (await pathExists(e)))
		return {
			executable: e,
			description: `override: ${e}`,
			kind: 'override',
		};
	if (process.platform === 'win32') {
		let n = await locateViaVswhere();
		if (n)
			return {
				executable: n,
				description: `vswhere: ${n}`,
				kind: 'vswhere',
			};
	}
	let t = await locateOnPath();
	if (t)
		return {
			executable: t,
			description: `PATH: ${t}`,
			kind: 'path',
		};
	let r = await locateInUserProfile();
	if (r)
		return {
			executable: r,
			description: `profile: ${r}`,
			kind: 'profile',
		};
}

async function locateViaVswhere() {
	let e = process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles ?? 'C:\\Program Files (x86)',
		t = path.join(e, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
	if (await pathExists(t))
		return new Promise((r) => {
			let n = (0, cp.spawn)(t, ['-latest', '-products', '*', '-find', 'Common7\\IDE\\CommonExtensions\\Microsoft\\NuGet\\NuGet.exe'], {
					windowsHide: !0,
				}),
				i = '';
			(n.stdout.on('data', (o) => (i += o.toString())),
				n.on('error', () => r(void 0)),
				n.on('close', () => {
					let o = i
						.split(/\r?\n/)
						.map((s) => s.trim())
						.filter(Boolean);
					r(o[0]);
				}));
		});
}

async function locateOnPath() {
	let e = process.platform === 'win32' ? 'where.exe' : 'which',
		t = process.platform === 'win32' ? 'nuget.exe' : 'nuget';
	return new Promise((r) => {
		let n = (0, cp.spawn)(e, [t], {
				windowsHide: !0,
			}),
			i = '';
		(n.stdout.on('data', (o) => (i += o.toString())),
			n.on('error', () => r(void 0)),
			n.on('close', (o) => {
				if (o !== 0) return r(void 0);
				let s = i
					.split(/\r?\n/)
					.map((a) => a.trim())
					.filter(Boolean);
				r(s[0]);
			}));
	});
}

async function locateInUserProfile() {
	let e = process.env.USERPROFILE ?? process.env.HOME;
	if (!e) return;
	let t = path.join(e, '.nuget', 'nuget.exe');
	return (await pathExists(t)) ? t : void 0;
}

export { locateNuget };
