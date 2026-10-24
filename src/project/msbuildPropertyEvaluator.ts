// @ts-nocheck
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import { locateMsBuild } from '../build/msbuildLocator';

var evaluatorCache = new Map();

function evaluatorCacheKey(e) {
	return `${e.sfprojPath.toLowerCase()}::${e.mtimeMs}::${e.configuration}::${e.platform}`;
}

async function evaluateMsbuildPackageCandidates(e, t, r, n = {}) {
	let i = n.platform ?? 'AnyCPU',
		o = n.timeoutMs ?? 15e3,
		s;
	try {
		s = (await fsp.stat(e)).mtimeMs;
	} catch (m) {
		return (r.warn(`MSBuild evaluator skipped: cannot stat ${e}: ${m.message}`), []);
	}
	let a = {
			sfprojPath: e,
			mtimeMs: s,
			configuration: t,
			platform: i,
		},
		c = evaluatorCache.get(evaluatorCacheKey(a));
	if (c) return (r.debug(`MSBuild evaluator cache hit for ${path.basename(e)} (${t}|${i}).`), c.candidates);
	let l;
	try {
		l = await locateMsBuild();
	} catch (m) {
		return (r.warn(`MSBuild evaluator skipped: ${m.message}.`), []);
	}
	if (!l || !l.executable) return (r.warn('MSBuild evaluator skipped: MSBuild.exe not found.'), []);
	let u = path.dirname(e),
		p = (await evaluateViaGetProperty(l, e, t, i, o, r)) ?? (await evaluateViaInlineTarget(l, e, t, i, o, r));
	if (!p)
		return (
			evaluatorCache.set(evaluatorCacheKey(a), {
				key: a,
				candidates: [],
			}),
			[]
		);
	let d = [],
		f = (m, v) => {
			if (!m) return;
			let h = m.trim();
			if (!h) return;
			let g = (path.isAbsolute(h) ? h : path.join(u, h)).replace(/[\\/]+$/, '');
			d.some((w) => w.path.toLowerCase() === g.toLowerCase()) ||
				d.push({
					path: g,
					source: v,
				});
		};
	return (
		f(p.PackageLocation, 'MSBuild -getProperty:PackageLocation'),
		f(p.OutputPath, 'MSBuild -getProperty:OutputPath'),
		f(p.BuildOutputPath, 'MSBuild -getProperty:BuildOutputPath'),
		evaluatorCache.set(evaluatorCacheKey(a), {
			key: a,
			candidates: d,
		}),
		d.length > 0
			? r.info(`MSBuild evaluator produced ${d.length} package-path candidate(s): ${d.map((m) => `${m.source}=${m.path}`).join('; ')}`)
			: r.warn(`MSBuild evaluator returned no usable values for ${path.basename(e)} (${t}|${i}).`),
		d
	);
}

async function evaluateViaGetProperty(e, t, r, n, i, o) {
	let s = [
			...e.leadingArgs,
			t,
			'-nologo',
			'-noconlog',
			'-getProperty:OutputPath,PackageLocation,BuildOutputPath',
			`-p:Configuration=${r}`,
			`-p:Platform=${n}`,
		],
		a = await spawnCapture(e.executable, s, i);
	if (!a) {
		o.warn('MSBuild evaluator: spawn failed for -getProperty: invocation.');
		return;
	}
	if (a.exitCode !== 0) {
		o.debug(
			`MSBuild -getProperty: failed with exit ${a.exitCode}; will try inline-target fallback. stderr: ${truncateForLog(a.stderr, 240)}`,
		);
		return;
	}
	return parseGetPropertyOutput(a.stdout);
}

function parseGetPropertyOutput(e) {
	let t = e.trim();
	if (!t) return {};
	if (t.startsWith('{'))
		try {
			let n = JSON.parse(t),
				i = n?.Properties ?? n;
			if (i && typeof i == 'object')
				return {
					OutputPath: typeof i.OutputPath == 'string' ? i.OutputPath : void 0,
					PackageLocation: typeof i.PackageLocation == 'string' ? i.PackageLocation : void 0,
					BuildOutputPath: typeof i.BuildOutputPath == 'string' ? i.BuildOutputPath : void 0,
				};
		} catch {}
	let r = {};
	for (let n of t.split(/\r?\n/)) {
		let i = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(n);
		if (!i) continue;
		let o = i[1],
			s = i[2];
		o === 'OutputPath'
			? (r.OutputPath = s)
			: o === 'PackageLocation'
				? (r.PackageLocation = s)
				: o === 'BuildOutputPath' && (r.BuildOutputPath = s);
	}
	return r;
}

async function evaluateViaInlineTarget(e, t, r, n, i, o) {
	let s = await fsp.mkdtemp(path.join(os.tmpdir(), 'sfproj-eval-')),
		a = path.join(s, 'SfProjEval.targets'),
		c = '__SFPROJ_EVAL__',
		l = `<?xml version="1.0" encoding="utf-8"?>
<Project>
  <Target Name="SfProjEvalGetProps">
    <Message Importance="High" Text="${c}|OutputPath=$(OutputPath)" />
    <Message Importance="High" Text="${c}|PackageLocation=$(PackageLocation)" />
    <Message Importance="High" Text="${c}|BuildOutputPath=$(BuildOutputPath)" />
  </Target>
</Project>
`;
	try {
		await fsp.writeFile(a, l, 'utf8');
		let u = [
				...e.leadingArgs,
				t,
				'-nologo',
				'-noconlog',
				'-target:SfProjEvalGetProps',
				`-p:Configuration=${r}`,
				`-p:Platform=${n}`,
				`-p:CustomAfterMicrosoftCommonTargets=${a}`,
				`-p:CustomAfterMicrosoftCommonCrossTargetingTargets=${a}`,
			],
			p = await spawnCapture(e.executable, u, i);
		if (!p) {
			o.warn('MSBuild evaluator: inline-target spawn failed.');
			return;
		}
		if (p.exitCode !== 0) {
			o.warn(`MSBuild inline-target evaluator failed (exit ${p.exitCode}). stderr: ${truncateForLog(p.stderr, 240)}`);
			return;
		}
		let d = {};
		for (let f of p.stdout.split(/\r?\n/)) {
			let m = new RegExp(`${c}\\|([A-Za-z_][A-Za-z0-9_]*)=(.*)$`).exec(f);
			if (!m) continue;
			let v = m[2].trim();
			m[1] === 'OutputPath'
				? (d.OutputPath = v)
				: m[1] === 'PackageLocation'
					? (d.PackageLocation = v)
					: m[1] === 'BuildOutputPath' && (d.BuildOutputPath = v);
		}
		return d;
	} catch (u) {
		o.warn(`MSBuild inline-target evaluator failed: ${u.message}`);
		return;
	} finally {
		try {
			await fsp.rm(s, {
				recursive: !0,
				force: !0,
			});
		} catch {}
	}
}

function spawnCapture(e, t, r) {
	return new Promise((n) => {
		let i = '',
			o = '',
			s = !1,
			a = (0, cp.spawn)(e, [...t], {
				windowsHide: !0,
			}),
			c = setTimeout(() => {
				if (!s) {
					s = !0;
					try {
						a.kill();
					} catch {}
					n({
						exitCode: -1,
						stdout: i,
						stderr:
							o +
							`
[timed out]`,
					});
				}
			}, r);
		(a.stdout?.on('data', (l) => (i += l.toString())),
			a.stderr?.on('data', (l) => (o += l.toString())),
			a.on('error', () => {
				s || ((s = !0), clearTimeout(c), n(void 0));
			}),
			a.on('close', (l) => {
				s ||
					((s = !0),
					clearTimeout(c),
					n({
						exitCode: l ?? 0,
						stdout: i,
						stderr: o,
					}));
			}));
	});
}

function truncateForLog(e, t) {
	return e ? (e.length <= t ? e : e.slice(0, t) + '\u2026') : '';
}

export { evaluateMsbuildPackageCandidates };
