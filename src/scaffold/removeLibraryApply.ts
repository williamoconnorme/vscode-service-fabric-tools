// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import { isServiceFabricServiceProject, patchCsprojRemoveProjectReference } from './addLibraryTemplates';

async function applyRemoveLibrary(e) {
	let t = path.dirname(e.libraryCsprojPath);
	if (!fs.existsSync(e.libraryCsprojPath)) throw new Error(`Library csproj does not exist: ${e.libraryCsprojPath}`);
	let r = fs.readFileSync(e.libraryCsprojPath, 'utf8');
	if (isServiceFabricServiceProject(r))
		throw new Error(
			`Refusing to remove '${path.basename(e.libraryCsprojPath)}': it is a Service Fabric service project. Use 'Service Fabric: Remove Service\u2026' for services.`,
		);
	let n = [];
	for (let o of e.consumers) {
		if (!fs.existsSync(o)) continue;
		let s = path.dirname(o),
			a = fs.readFileSync(o, 'utf8'),
			c = computeRelativePathVariants(s, e.libraryCsprojPath),
			l = a,
			u = !1;
		for (let p of c) {
			let d = patchCsprojRemoveProjectReference(l, p);
			d.changed && ((l = d.xml), (u = !0));
		}
		u && (fs.writeFileSync(o, l, 'utf8'), n.push(o));
	}
	let i = !1;
	if (e.deleteFolder && !(await anyConsumerStillReferences(e.libraryCsprojPath, t)))
		try {
			(fs.rmSync(t, {
				recursive: !0,
				force: !0,
			}),
				(i = !0));
		} catch (s) {
			throw new Error(`Consumers were unwired but the library folder could not be deleted: ${s instanceof Error ? s.message : String(s)}`);
		}
	return {
		unwiredConsumers: n,
		folderDeleted: i,
		libraryDirectory: t,
	};
}

async function anyConsumerStillReferences(e, t) {
	let r = path.dirname(t),
		n = path.basename(e).toLowerCase(),
		i = [
			{
				dir: r,
				depth: 0,
			},
		];
	for (; i.length > 0;) {
		let { dir: o, depth: s } = i.pop();
		if (s > 4) continue;
		let a;
		try {
			a = fs.readdirSync(o, {
				withFileTypes: !0,
			});
		} catch {
			continue;
		}
		for (let c of a) {
			let l = path.join(o, c.name);
			if (c.isDirectory()) {
				if (c.name === 'node_modules' || c.name === '.git' || c.name === 'bin' || c.name === 'obj' || c.name === 'packages' || l === t)
					continue;
				i.push({
					dir: l,
					depth: s + 1,
				});
				continue;
			}
			if (c.isFile() && c.name.toLowerCase().endsWith('.csproj'))
				try {
					let u = fs.readFileSync(l, 'utf8'),
						p = /<ProjectReference\s+Include="([^"]+)"/gi,
						d;
					for (; (d = p.exec(u)) !== null;) {
						let f = d[1].toLowerCase().replace(/\//g, '\\');
						if (f.endsWith(`\\${n}`) || f === n) return !0;
					}
				} catch {}
		}
	}
	return !1;
}

function computeRelativePathVariants(e, t) {
	let r = path.relative(e, t),
		n = r.split('/').join('\\'),
		i = r.split('\\').join('/');
	return Array.from(new Set([n, i, r]));
}

export { applyRemoveLibrary };
