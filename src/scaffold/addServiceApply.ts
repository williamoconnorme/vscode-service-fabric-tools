// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import {
	buildActorCs,
	buildActorInterfaceCs,
	buildActorInterfacesCsproj,
	buildAspNetAppsettingsDevelopmentJson,
	buildAspNetAppsettingsJson,
	buildAspNetValuesControllerCs,
	buildCsharpCsproj,
	buildCsharpProgramCs,
	buildCsharpServiceCs,
	buildLaunchSettingsJson,
	buildServiceManifestXml,
	buildSettingsXml,
	classifyEnvironment,
	isAspNetKind,
	isCsharpKind,
	patchApplicationManifest,
	patchApplicationManifestImports,
	patchApplicationParametersXml,
	patchSfprojForProjectReference,
	patchStartupServiceParametersXml,
	patchStartupServicesXml,
	resolveCsharpSettings,
} from './addServiceTemplates';

async function applyAddService(e, t, r) {
	if (!e.applicationManifest) throw new Error('Application manifest is missing.');
	let n = collectExistingServiceNames(e);
	if (n.has(t.serviceName.toLowerCase())) throw new Error(`A service named '${t.serviceName}' already exists in this application.`);
	if (n.has(`${t.serviceName.toLowerCase()}pkg`)) throw new Error(`A service package '${t.serviceName}Pkg' already exists.`);
	if (t.kind === 'guest' && !r?.guestSourcePath) throw new Error('Guest executable scaffold requires options.guestSourcePath.');
	let i = path.dirname(e.sfproj.path),
		o = path.join(i, e.sfproj.applicationPackageRootFolder),
		s = path.dirname(i),
		a = isCsharpKind(t.kind),
		c = a ? resolveCsharpSettings(t) : void 0,
		l = a && c ? path.join(s, c.csprojDirName) : void 0,
		u = a && l ? path.join(l, 'PackageRoot') : path.join(o, `${t.serviceName}Pkg`);
	if (a && l && fs.existsSync(l)) throw new Error(`Cannot scaffold C# project: directory already exists: ${l}`);
	if (!a && fs.existsSync(u)) throw new Error(`Service folder already exists on disk: ${u}`);
	let p = t;
	if (t.kind === 'guest' && r?.guestSourcePath) {
		let j = r.guestSourcePath,
			se = fs.statSync(j).isDirectory() ? (t.exeProgram ?? `${t.serviceName}.exe`) : path.basename(j);
		p = {
			...t,
			exeProgram: se,
		};
	}
	(fs.mkdirSync(path.join(u, 'Config'), {
		recursive: !0,
	}),
		a ||
			fs.mkdirSync(path.join(u, 'Code'), {
				recursive: !0,
			}));
	let d = path.join(u, 'ServiceManifest.xml');
	(fs.writeFileSync(d, buildServiceManifestXml(p), 'utf8'),
		fs.writeFileSync(path.join(u, 'Config', 'Settings.xml'), buildSettingsXml(), 'utf8'));
	let f;
	p.kind === 'guest' && r?.guestSourcePath && (f = stageGuestExecutable(r.guestSourcePath, path.join(u, 'Code')));
	let m = e.applicationManifest.path,
		v = fs.readFileSync(m, 'utf8'),
		h = !!e.startupServicesManifest,
		P = h ? patchApplicationManifestImports(v, p) : patchApplicationManifest(v, p);
	fs.writeFileSync(m, P, 'utf8');
	let g;
	if (h && e.startupServicesManifest) {
		g = e.startupServicesManifest;
		let j = fs.readFileSync(g, 'utf8'),
			le = patchStartupServicesXml(j, p);
		le !== j && fs.writeFileSync(g, le, 'utf8');
	}
	let w = [];
	for (let j of e.applicationParameters)
		try {
			let le = classifyEnvironment(path.basename(j)),
				se = fs.readFileSync(j, 'utf8'),
				Z = patchApplicationParametersXml(se, p, le);
			Z !== se && (fs.writeFileSync(j, Z, 'utf8'), w.push(j));
		} catch {}
	let b = [];
	if (h)
		for (let j of e.startupServiceParameters)
			try {
				let le = classifyEnvironment(path.basename(j)),
					se = fs.readFileSync(j, 'utf8'),
					Z = patchStartupServiceParametersXml(se, p, le);
				Z !== se && (fs.writeFileSync(j, Z, 'utf8'), b.push(j));
			} catch {}
	let S, z, O;
	if (a && l && c) {
		let j = scaffoldCsharpProject(e, p, l, c);
		((S = j.csprojPath), (z = j.launchSettingsPath), (O = j.appsettingsDevelopmentPath));
	}
	return {
		serviceManifestPath: d,
		applicationManifestPath: m,
		patchedParameterFiles: w,
		patchedStartupParameterFiles: b,
		startupServicesManifestPath: g,
		csprojPath: S,
		launchSettingsPath: z,
		appsettingsDevelopmentPath: O,
		guestExePath: f,
	};
}

function collectExistingServiceNames(e) {
	let t = new Set();
	for (let r of e.serviceManifests) (t.add(r.name.toLowerCase()), t.add(r.name.replace(/Pkg$/i, '').toLowerCase()));
	for (let r of e.applicationManifest?.serviceManifestRefs ?? [])
		(t.add(r.name.toLowerCase()), t.add(r.name.replace(/Pkg$/i, '').toLowerCase()));
	return t;
}

function scaffoldCsharpProject(e, t, r, n) {
	let i = e.sfproj.path,
		o = path.dirname(i),
		s = path.dirname(o);
	fs.mkdirSync(r, {
		recursive: !0,
	});
	let a = path.join(r, `${n.csprojDirName}.csproj`);
	if (
		(fs.writeFileSync(a, buildCsharpCsproj(t, void 0, n), 'utf8'),
		fs.writeFileSync(path.join(r, 'Program.cs'), buildCsharpProgramCs(t, n), 'utf8'),
		t.kind === 'actor')
	) {
		let h = `${r}.Interfaces`;
		(fs.mkdirSync(h, {
			recursive: !0,
		}),
			fs.writeFileSync(path.join(h, `${n.csprojDirName}.Interfaces.csproj`), buildActorInterfacesCsproj(t, n), 'utf8'),
			fs.writeFileSync(path.join(h, `${n.actorInterfaceName}.cs`), buildActorInterfaceCs(t, n), 'utf8'),
			fs.writeFileSync(path.join(r, `${n.actorTypeName}.cs`), buildActorCs(t, n), 'utf8'));
	} else fs.writeFileSync(path.join(r, `${n.className}.cs`), buildCsharpServiceCs(t, n), 'utf8');
	let c;
	if (isAspNetKind(t.kind)) {
		let h = path.join(r, 'Controllers');
		(fs.mkdirSync(h, {
			recursive: !0,
		}),
			fs.writeFileSync(path.join(h, 'ValuesController.cs'), buildAspNetValuesControllerCs(t, n), 'utf8'),
			fs.writeFileSync(path.join(r, 'appsettings.json'), buildAspNetAppsettingsJson(), 'utf8'),
			(c = path.join(r, 'appsettings.Development.json')),
			fs.writeFileSync(c, buildAspNetAppsettingsDevelopmentJson(), 'utf8'));
	}
	let l = path.join(r, 'Properties');
	fs.mkdirSync(l, {
		recursive: !0,
	});
	let u = path.join(l, 'launchSettings.json'),
		p = t.endpointPort ?? (isAspNetKind(t.kind) ? 8559 : void 0),
		d = isAspNetKind(t.kind) && t.httpsEndpoint ? (t.httpsEndpoint.port ?? 8443) : void 0;
	fs.writeFileSync(
		u,
		p !== void 0
			? buildLaunchSettingsJson(t, {
					http: p,
					https: d,
				})
			: buildLaunchSettingsJson(t),
		'utf8',
	);
	let f = toMsbuildRelativePath(o, a),
		m = fs.readFileSync(i, 'utf8'),
		v = patchSfprojForProjectReference(m, f, {
			kind: t.kind,
		});
	return (
		v !== m && fs.writeFileSync(i, v, 'utf8'),
		{
			csprojPath: a,
			launchSettingsPath: u,
			appsettingsDevelopmentPath: c,
		}
	);
}

function toMsbuildRelativePath(e, t) {
	return path.relative(e, t).replace(/\//g, '\\');
}

function stageGuestExecutable(e, t) {
	if (fs.statSync(e).isDirectory())
		return (copyDirectoryRecursive(e, t), findFirstByExtension(t, '.exe') ?? path.join(t, path.basename(e)));
	let n = path.join(t, path.basename(e));
	return (fs.copyFileSync(e, n), n);
}

function copyDirectoryRecursive(e, t) {
	fs.mkdirSync(t, {
		recursive: !0,
	});
	for (let r of fs.readdirSync(e, {
		withFileTypes: !0,
	})) {
		let n = path.join(e, r.name),
			i = path.join(t, r.name);
		r.isDirectory() ? copyDirectoryRecursive(n, i) : r.isFile() && fs.copyFileSync(n, i);
	}
}

function findFirstByExtension(e, t) {
	for (let r of fs.readdirSync(e, {
		withFileTypes: !0,
	}))
		if (r.isFile() && r.name.toLowerCase().endsWith(t.toLowerCase())) return path.join(e, r.name);
}

export { applyAddService, collectExistingServiceNames };
