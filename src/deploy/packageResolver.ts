// @ts-nocheck

function collectPackageRootCandidates(e, t, r) {
	let n = (e.configuration ?? 'Debug').trim() || 'Debug',
		i = [],
		o = (s, a) => {
			if (!s) return;
			let c = s.trim();
			if (!c) return;
			let l = '';
			if (e.expand) {
				let f = e.expand(c);
				f.value !== c && ((c = f.value), (l = ' (expanded)'));
			}
			let p = (r(c) ? c : t(e.sfprojDir, c)).replace(/[\\/]+$/, '');
			i.some((f) => f.path.toLowerCase() === p.toLowerCase()) ||
				i.push({
					path: p,
					source: a + l,
				});
		};
	return (
		o(e.settingOverride, 'serviceFabric.deploy.packagePath'),
		o(e.packageLocation, 'sfproj <PackageLocation>'),
		o(e.outputPath, 'sfproj <OutputPath>'),
		o(t('pkg', n), `default pkg\\${n}`),
		o(t('bin', n, 'pkg'), `bin\\${n}\\pkg`),
		o(t('bin', n), `bin\\${n}`),
		i
	);
}

var PublishCancelledByUserError = class extends Error {
	constructor(t) {
		(super(t), (this.name = 'PublishCancelledByUserError'));
	}
};

async function resolveApplicationPackageRoot(e, t, r = {}) {
	if (e.length === 0 && !r.evaluateMsbuildProperties)
		throw new Error('No candidate package roots to probe. Configure serviceFabric.deploy.packagePath or rebuild the project.');
	let n = [],
		i = await sweepCandidates(e, t, r, n);
	if (i) return i;
	if (r.evaluateMsbuildProperties) {
		let o = [];
		try {
			o = await r.evaluateMsbuildProperties();
		} catch {
			o = [];
		}
		if (o.length > 0) {
			let s = await sweepCandidates(o, t, r, n);
			if (s) return s;
		}
	}
	throw new Error(
		`Could not locate ApplicationManifest.xml. Probed: ${n.join(', ')}. Set serviceFabric.deploy.packagePath to the folder that directly contains ApplicationManifest.xml, or enable serviceFabric.deploy.useMsbuildPropertyEvaluator if your <OutputPath>/<PackageLocation> references properties defined in Directory.Build.props or imported .targets.`,
	);
}

async function sweepCandidates(e, t, r, n) {
	for (let i of e) {
		if ((n.push(i.path), !(await t.pathExists(i.path)))) continue;
		if (await containsManifest(t, i.path))
			return (
				await confirmOverrideTypeMatch(t, i, i.path, r),
				{
					path: i.path,
					source: i.source,
				}
			);
		let o = r.searchMaxDepth ?? 2;
		if (o < 1) continue;
		let s = await searchForManifest(t, i.path, o);
		if (s.length === 1)
			return (
				await confirmOverrideTypeMatch(t, i, s[0], r),
				{
					path: s[0],
					source: `${i.source} (nested)`,
				}
			);
		if (s.length > 1) {
			let a = await disambiguateHits(t, s, r.expectedApplicationTypeName, r.onAmbiguous);
			if (a)
				return {
					path: a.path,
					source: `${i.source} ${a.sourceSuffix}`,
				};
			let c = await describeHits(t, s);
			throw new Error(
				`Multiple application type folders contain ApplicationManifest.xml under ${i.path}: ${c}.${r.expectedApplicationTypeName ? ` None matched expected ApplicationTypeName '${r.expectedApplicationTypeName}'.` : ''} Set serviceFabric.deploy.packagePath to disambiguate.`,
			);
		}
	}
}

async function confirmOverrideTypeMatch(e, t, r, n) {
	if (
		!n.onOverrideTypeMismatch ||
		!n.expectedApplicationTypeName ||
		!t.source.startsWith('serviceFabric.deploy.packagePath') ||
		!e.readApplicationTypeName
	)
		return;
	let i = joinPosix(r, 'ApplicationManifest.xml'),
		o = await e.readApplicationTypeName(i);
	if (o === void 0 || o === n.expectedApplicationTypeName) return;
	if (
		!(await n.onOverrideTypeMismatch({
			path: r,
			declaredApplicationTypeName: o,
			expectedApplicationTypeName: n.expectedApplicationTypeName,
		}))
	)
		throw new PublishCancelledByUserError(
			`Publish cancelled \u2014 serviceFabric.deploy.packagePath resolved to a package with ApplicationTypeName '${o}', expected '${n.expectedApplicationTypeName}'. Path: ${r}.`,
		);
}

async function disambiguateHits(e, t, r, n) {
	let i = await annotateHits(e, t);
	if (r) {
		let o = i.filter((s) => s.applicationTypeName !== void 0 && s.applicationTypeName === r);
		if (o.length === 1)
			return {
				path: o[0].path,
				sourceSuffix: `(matched ApplicationTypeName ${r})`,
			};
	}
	if (n) {
		let o = await n(i);
		if (o && t.includes(o))
			return {
				path: o,
				sourceSuffix: '(picked by user)',
			};
	}
}

async function annotateHits(e, t) {
	let r = e.readApplicationTypeName?.bind(e),
		n = [];
	for (let i of t) {
		let o;
		if (r)
			try {
				o = await r(joinPosix(i, 'ApplicationManifest.xml'));
			} catch {
				o = void 0;
			}
		n.push({
			path: i,
			applicationTypeName: o,
		});
	}
	return n;
}

async function describeHits(e, t) {
	return (await annotateHits(e, t))
		.map((n) => (n.applicationTypeName ? `${baseName(n.path)} [${n.applicationTypeName}]` : baseName(n.path)))
		.join(', ');
}

async function containsManifest(e, t) {
	return e.pathExists(joinPosix(t, 'ApplicationManifest.xml'));
}

var SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.vs',
	'.vscode',
	'obj',
	'packages',
	'bin',
	'out',
	'artifacts',
	'_published',
	'TestResults',
]);

async function searchForManifest(e, t, r) {
	let n = [],
		i = [
			{
				path: t,
				depth: 0,
			},
		];
	for (; i.length > 0;) {
		let { path: o, depth: s } = i.shift();
		if (await containsManifest(e, o)) {
			n.push(o);
			continue;
		}
		if (s >= r) continue;
		let a = await e.readDirectories(o);
		for (let c of a)
			SKIP_DIRS.has(c) ||
				i.push({
					path: joinPosix(o, c),
					depth: s + 1,
				});
	}
	return n;
}

function joinPosix(...e) {
	return e
		.filter((t) => t && t.length > 0)
		.join('\\')
		.replace(/[\\/]+/g, '\\');
}

function baseName(e) {
	let t = /[^\\/]+$/.exec(e);
	return t ? t[0] : e;
}

export { PublishCancelledByUserError, collectPackageRootCandidates, resolveApplicationPackageRoot };
