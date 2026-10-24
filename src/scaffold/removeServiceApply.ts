// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import {
	extractServiceTypeNames,
	patchApplicationManifestForRemove,
	patchApplicationParametersForRemove,
	patchSfprojRemoveProjectReference,
	patchStartupServicesXmlForRemove,
} from './removeServiceTemplates';

async function applyRemoveService(e, t) {
	if (!e.applicationManifest) throw new Error('Application manifest is missing.');
	let r = findServiceManifest(e, t);
	if (!r) throw new Error(`No service-manifest package named '${t}' was found in this application.`);
	let n = [];
	try {
		let w = fs.readFileSync(r.path, 'utf8');
		n = extractServiceTypeNames(w);
	} catch {}
	let i = new Set(n),
		o = findGeneratedCsproj(e, r.packageDirectory),
		s = e.applicationManifest.path,
		a = fs.readFileSync(s, 'utf8'),
		c = patchApplicationManifestForRemove(a, r.name, i);
	fs.writeFileSync(s, c.xml, 'utf8');
	let l,
		u = new Set();
	if (e.startupServicesManifest)
		try {
			let w = fs.readFileSync(e.startupServicesManifest, 'utf8'),
				b = patchStartupServicesXmlForRemove(w, i);
			b.xml !== w && (fs.writeFileSync(e.startupServicesManifest, b.xml, 'utf8'), (l = e.startupServicesManifest));
			for (let S of b.removedParameters) u.add(S);
		} catch {}
	let p = [];
	for (let w of e.applicationParameters)
		try {
			let b = fs.readFileSync(w, 'utf8'),
				S = patchApplicationParametersForRemove(b, c.removedParameters);
			S !== b && (fs.writeFileSync(w, S, 'utf8'), p.push(w));
		} catch {}
	let d = u.size > 0 ? [...u] : c.removedParameters,
		f = [];
	for (let w of e.startupServiceParameters)
		try {
			let b = fs.readFileSync(w, 'utf8'),
				S = patchApplicationParametersForRemove(b, d);
			S !== b && (fs.writeFileSync(w, S, 'utf8'), f.push(w));
		} catch {}
	let m,
		v,
		h,
		P = !1;
	if (o) {
		let w = path.dirname(e.sfproj.path),
			b = path.relative(w, o.csprojPath).replace(/\//g, '\\');
		try {
			let z = fs.readFileSync(e.sfproj.path, 'utf8'),
				O = patchSfprojRemoveProjectReference(z, b);
			O.removed && (fs.writeFileSync(e.sfproj.path, O.xml, 'utf8'), (P = !0));
		} catch {}
		let S = `${o.csprojDirectory}.Interfaces`;
		if (fs.existsSync(S) && fs.statSync(S).isDirectory())
			try {
				(fs.rmSync(S, {
					recursive: !0,
					force: !0,
				}),
					(h = S));
			} catch {}
		try {
			fs.existsSync(o.csprojDirectory) &&
				(fs.rmSync(o.csprojDirectory, {
					recursive: !0,
					force: !0,
				}),
				(m = o.csprojPath),
				(v = o.csprojDirectory));
		} catch {}
	}
	let g = r.packageDirectory;
	return (
		fs.existsSync(g) &&
			fs.rmSync(g, {
				recursive: !0,
				force: !0,
			}),
		{
			packageName: r.name,
			removedDirectory: g,
			applicationManifestPath: s,
			removedParameters: c.removedParameters,
			removedServiceBlocks: c.removedServiceBlocks,
			patchedParameterFiles: p,
			removedCsprojPath: m,
			removedCsprojDirectory: v,
			removedActorInterfacesDirectory: h,
			removedProjectReference: P,
			patchedStartupServicesManifest: l,
			patchedStartupParameterFiles: f,
		}
	);
}

function findServiceManifest(e, t) {
	let r = t.toLowerCase(),
		n = e.serviceManifests.find((o) => o.name.toLowerCase() === r);
	if (n) return n;
	let i = r.endsWith('pkg') ? r : `${r}pkg`;
	return e.serviceManifests.find((o) => o.name.toLowerCase() === i);
}

function findGeneratedCsproj(e, t) {
	let r = path.normalize(t).toLowerCase();
	for (let n of e.sfproj.projectReferences) {
		if (!fs.existsSync(n)) continue;
		let i = path.dirname(n);
		if (path.normalize(path.join(i, 'PackageRoot')).toLowerCase() === r)
			return {
				csprojPath: n,
				csprojDirectory: i,
			};
		let s;
		try {
			s = fs.readFileSync(n, 'utf8');
		} catch {
			continue;
		}
		if (!/<IsServiceFabricServiceProject>\s*true\s*<\/IsServiceFabricServiceProject>/i.test(s)) continue;
		let a = /<SfPackageRoot>([\s\S]*?)<\/SfPackageRoot>/i.exec(s);
		if (!a) continue;
		let c = a[1]
				.replace(/\$\(MSBuildThisFileDirectory\)/gi, i + path.sep)
				.replace(/\\/g, path.sep)
				.replace(/\//g, path.sep)
				.trim(),
			l = path.resolve(i, c);
		if (path.normalize(l).toLowerCase() === r)
			return {
				csprojPath: n,
				csprojDirectory: i,
			};
	}
}

export { applyRemoveService, findGeneratedCsproj, findServiceManifest };
