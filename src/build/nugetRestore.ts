// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import * as zlib from 'zlib';
import * as cp from 'child_process';
import { locateNuget } from './nugetLocator';
import { locateMsBuild } from './msbuildLocator';

function tryGetVscodeWorkspaceFolders() {
	try {
		return require('vscode')?.workspace?.workspaceFolders;
	} catch {
		return;
	}
}

async function ensureNugetRestored(e, t) {
	let r = t?.output,
		n = t?.progress,
		i = path.dirname(e),
		o = path.join(i, 'packages.config'),
		s = computePackagesDirectory(i),
		a;
	try {
		let d = fs.readFileSync(o, 'utf8');
		a = parsePackagesConfig(d);
	} catch {
		return {
			ok: !0,
			strategy: 'skipped',
			message: `No packages.config alongside ${path.basename(e)}; nothing to restore.`,
			packagesDirectory: s,
			missingOnEntry: [],
		};
	}
	let c = a.filter((d) => !packageDirectoryComplete(s, d));
	if (c.length === 0)
		return {
			ok: !0,
			strategy: 'skipped',
			message: 'NuGet packages are already restored.',
			packagesDirectory: s,
			missingOnEntry: [],
		};
	(n?.report({
		message: `Restoring ${c.length} NuGet package(s)\u2026`,
	}),
		r?.appendLine(`[nuget-restore] Missing: ${c.map((d) => `${d.id}.${d.version}`).join(', ')}`));
	let l = await locateNuget();
	if (l) {
		if (
			(r?.appendLine(`[nuget-restore] Strategy B: ${l.description}`),
			(await runNugetExeRestore(l.executable, e, s, r)) && stillMissing(s, a).length === 0)
		)
			return success('nuget-exe', s, c);
	} else r?.appendLine('[nuget-restore] Strategy B: nuget.exe not found; skipping.');
	if (
		(r?.appendLine('[nuget-restore] Strategy C: msbuild /t:Restore /p:RestorePackagesConfig=true'),
		(await runMsbuildRestore(e, s, r)) && stillMissing(s, a).length === 0)
	)
		return success('msbuild-restorepkgconfig', s, c);
	let p = stillMissing(s, a);
	if (p.length > 0 && p.length <= 4) {
		r?.appendLine(`[nuget-restore] Strategy F: HTTP fetch from api.nuget.org for ${p.length} package(s)`);
		try {
			for (let d of p)
				(n?.report({
					message: `Fetching ${d.id} ${d.version}\u2026`,
				}),
					await fetchAndExtract(d, s, r));
			if (stillMissing(s, a).length === 0) return success('http-fallback', s, c);
		} catch (d) {
			let f = d instanceof Error ? d.message : String(d);
			r?.appendLine(`[nuget-restore] Strategy F failed: ${f}`);
		}
	}
	return {
		ok: !1,
		strategy: 'failed',
		message:
			"Could not restore the Service Fabric MSBuild targets. Install Visual Studio 2022 (any edition with the .NET workload), or run 'nuget restore <App>.sfproj -PackagesDirectory packages' manually, or check network connectivity to api.nuget.org.",
		packagesDirectory: s,
		missingOnEntry: c,
	};
}

function computePackagesDirectory(e) {
	let t = tryGetVscodeWorkspaceFolders();
	return t && t.length > 0 ? path.join(t[0].uri.fsPath, 'packages') : path.join(path.dirname(e), 'packages');
}

function parsePackagesConfig(e) {
	let t = [],
		r = /<package\b([^/>]*)\/>/g,
		n;
	for (; (n = r.exec(e)) !== null;) {
		let i = n[1],
			o = /\bid\s*=\s*"([^"]+)"/i.exec(i),
			s = /\bversion\s*=\s*"([^"]+)"/i.exec(i);
		o &&
			s &&
			t.push({
				id: o[1],
				version: s[1],
			});
	}
	return t;
}

function packageDirectoryComplete(e, t) {
	let r = path.join(e, `${t.id}.${t.version}`);
	if (!fs.existsSync(r)) return !1;
	let n = path.join(r, 'build');
	if (fs.existsSync(n)) return !0;
	try {
		return fs.readdirSync(r).length > 0;
	} catch {
		return !1;
	}
}

function stillMissing(e, t) {
	return t.filter((r) => !packageDirectoryComplete(e, r));
}

function success(e, t, r) {
	return {
		ok: !0,
		strategy: e,
		packagesDirectory: t,
		missingOnEntry: r,
	};
}

async function runNugetExeRestore(e, t, r, n) {
	return new Promise((i) => {
		let o = (0, cp.spawn)(e, ['restore', t, '-PackagesDirectory', r, '-NonInteractive', '-Verbosity', 'quiet'], {
			windowsHide: !0,
		});
		(o.stdout?.on('data', (s) => n?.append(s.toString())),
			o.stderr?.on('data', (s) => n?.append(s.toString())),
			o.on('error', (s) => {
				(n?.appendLine(`[nuget-restore] nuget.exe error: ${s.message}`), i(!1));
			}),
			o.on('close', (s) => i(s === 0)));
	});
}

async function runMsbuildRestore(e, t, r) {
	let n = await locateMsBuild();
	return new Promise((i) => {
		let o = [...n.leadingArgs, e, '/t:Restore', '/p:RestorePackagesConfig=true', `/p:RestorePackagesPath=${t}`, '/nologo', '/v:minimal'],
			s = (0, cp.spawn)(n.executable, o, {
				windowsHide: !0,
			});
		(s.stdout?.on('data', (a) => r?.append(a.toString())),
			s.stderr?.on('data', (a) => r?.append(a.toString())),
			s.on('error', (a) => {
				(r?.appendLine(`[nuget-restore] msbuild error: ${a.message}`), i(!1));
			}),
			s.on('close', (a) => i(a === 0)));
	});
}

async function fetchAndExtract(e, t, r) {
	let n = `https://api.nuget.org/v3-flatcontainer/${e.id.toLowerCase()}/${e.version}/${e.id.toLowerCase()}.${e.version}.nupkg`;
	r?.appendLine(`[nuget-restore]   GET ${n}`);
	let i = path.join(os.tmpdir(), `sf-restore-${e.id}-${e.version}-${Date.now()}.nupkg`);
	try {
		await downloadToFile(n, i);
		let o = path.join(t, `${e.id}.${e.version}`);
		(fs.mkdirSync(o, {
			recursive: !0,
		}),
			await extractNupkg(i, o));
	} finally {
		try {
			fs.unlinkSync(i);
		} catch {}
	}
}

function downloadToFile(e, t) {
	return new Promise((r, n) => {
		let i = (o, s) => {
			https
				.get(o, (a) => {
					let c = a.statusCode ?? 0;
					if ((c === 301 || c === 302 || c === 307 || c === 308) && a.headers.location) {
						if (s <= 0) {
							n(new Error(`Too many redirects fetching ${e}`));
							return;
						}
						(a.resume(), i(a.headers.location, s - 1));
						return;
					}
					if (c !== 200) {
						n(new Error(`HTTP ${c} fetching ${e}`));
						return;
					}
					let l = fs.createWriteStream(t);
					(a.pipe(l), l.on('finish', () => l.close((u) => (u ? n(u) : r()))), l.on('error', n));
				})
				.on('error', n);
		};
		i(e, 5);
	});
}

async function extractNupkg(e, t) {
	let r = fs.readFileSync(e),
		n = 101010256,
		i = -1;
	for (let l = r.length - 22; l >= Math.max(0, r.length - 65557); l--)
		if (r.readUInt32LE(l) === n) {
			i = l;
			break;
		}
	if (i < 0) throw new Error('Invalid nupkg: missing End-of-Central-Directory record.');
	let o = r.readUInt16LE(i + 10),
		s = r.readUInt32LE(i + 12),
		a = r.readUInt32LE(i + 16);
	if (a + s > r.length) throw new Error('Invalid nupkg: central directory bounds out of range.');
	let c = a;
	for (let l = 0; l < o; l++) {
		if (r.readUInt32LE(c) !== 33639248) throw new Error(`Invalid nupkg: bad central-directory header at offset ${c}.`);
		let u = r.readUInt16LE(c + 10),
			p = r.readUInt32LE(c + 20),
			d = r.readUInt32LE(c + 24),
			f = r.readUInt16LE(c + 28),
			m = r.readUInt16LE(c + 30),
			v = r.readUInt16LE(c + 32),
			h = r.readUInt32LE(c + 42),
			P = r.slice(c + 46, c + 46 + f).toString('utf8');
		if (((c += 46 + f + m + v), r.readUInt32LE(h) !== 67324752)) throw new Error(`Invalid nupkg: bad local file header for ${P}.`);
		let g = r.readUInt16LE(h + 26),
			w = r.readUInt16LE(h + 28),
			b = h + 30 + g + w,
			S = r.slice(b, b + p);
		if (P.endsWith('/')) {
			let le = path.join(t, ...P.split('/').filter(Boolean));
			fs.mkdirSync(le, {
				recursive: !0,
			});
			continue;
		}
		let z = sanitizeEntryName(P);
		if (!z) continue;
		let O = path.join(t, z);
		fs.mkdirSync(path.dirname(O), {
			recursive: !0,
		});
		let j;
		if (u === 0) j = S;
		else if (u === 8) j = zlib.inflateRawSync(S);
		else throw new Error(`Unsupported nupkg compression method ${u} for ${P}.`);
		if (j.length !== d) throw new Error(`Length mismatch extracting ${P}: ${j.length} != ${d}.`);
		fs.writeFileSync(O, j);
	}
}

function sanitizeEntryName(e) {
	let t = e.split(/[\\/]+/).filter((r) => r !== '' && r !== '.' && r !== '..');
	if (t.length !== 0) return t.join(path.sep);
}

export { ensureNugetRestored };
