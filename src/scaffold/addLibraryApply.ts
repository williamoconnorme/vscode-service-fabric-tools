// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import {
	buildLibraryClassStub,
	buildLibraryCsproj,
	isServiceFabricServiceProject,
	patchCsprojAddProjectReference,
} from './addLibraryTemplates';

async function applyAddLibrary(e) {
	if (!e.name || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(e.name)) throw new Error(`Invalid library name: '${e.name}'.`);
	if (!e.workspaceRoot || !fs.existsSync(e.workspaceRoot)) throw new Error(`Workspace root does not exist: '${e.workspaceRoot}'.`);
	let t = path.join(e.workspaceRoot, e.name),
		r = path.join(t, `${e.name}.csproj`),
		n = path.join(t, 'Class1.cs');
	if (fs.existsSync(t)) {
		if (fs.readdirSync(t).length > 0 && !e.allowExistingEmptyFolder)
			throw new Error(`Cannot create library: folder already exists and is non-empty: ${t}`);
	} else
		fs.mkdirSync(t, {
			recursive: !0,
		});
	let i = !1;
	try {
		(fs.writeFileSync(
			r,
			buildLibraryCsproj({
				name: e.name,
				targetFramework: e.targetFramework,
			}),
			'utf8',
		),
			fs.writeFileSync(n, buildLibraryClassStub(e.name), 'utf8'),
			(i = !0));
		let o = [];
		for (let s of e.consumers) {
			if (!fs.existsSync(s)) throw new Error(`Consumer csproj does not exist: ${s}`);
			let a = fs.readFileSync(s, 'utf8');
			isServiceFabricServiceProject(a);
			let c = path.dirname(s),
				l = toMsbuildRelativePath(c, r),
				u = patchCsprojAddProjectReference(a, l);
			u.changed && (fs.writeFileSync(s, u.xml, 'utf8'), o.push(s));
		}
		return {
			libraryDirectory: t,
			libraryCsprojPath: r,
			classStubPath: n,
			patchedConsumers: o,
		};
	} catch (o) {
		if (i) {
			try {
				fs.unlinkSync(r);
			} catch {}
			try {
				fs.unlinkSync(n);
			} catch {}
		}
		try {
			fs.existsSync(t) && fs.readdirSync(t).length === 0 && fs.rmdirSync(t);
		} catch {}
		throw o;
	}
}

async function applyAddLibraryReferenceOnly(e) {
	if (!fs.existsSync(e.consumerCsproj)) throw new Error(`Consumer csproj does not exist: ${e.consumerCsproj}`);
	if (!fs.existsSync(e.targetCsproj)) throw new Error(`Target csproj does not exist: ${e.targetCsproj}`);
	let t = fs.readFileSync(e.targetCsproj, 'utf8');
	if (isServiceFabricServiceProject(t))
		throw new Error(
			`Refusing to add a reference to '${path.basename(e.targetCsproj)}': it is a Service Fabric service project. Use 'Service Fabric: Add Service\u2026' for service-to-service references.`,
		);
	let r = path.dirname(e.consumerCsproj),
		n = toMsbuildRelativePath(r, e.targetCsproj),
		i = fs.readFileSync(e.consumerCsproj, 'utf8'),
		o = patchCsprojAddProjectReference(i, n);
	return (
		o.changed && fs.writeFileSync(e.consumerCsproj, o.xml, 'utf8'),
		{
			changed: o.changed,
			relativePath: n,
		}
	);
}

function toMsbuildRelativePath(e, t) {
	return path.relative(e, t).split('/').join('\\');
}

export { applyAddLibrary, applyAddLibraryReferenceOnly };
