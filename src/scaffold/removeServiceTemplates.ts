// @ts-nocheck

function patchApplicationManifestForRemove(e, t, r) {
	let n = e,
		i = !1,
		o = [];
	n = n.replace(/\r?\n?\s*<ServiceManifestImport\b[^>]*>[\s\S]*?<\/ServiceManifestImport>/g, (l) =>
		new RegExp(`ServiceManifestName="${escapeRegex(t)}"`).test(l) ? ((i = !0), o.push(l), '') : l,
	);
	let s = [];
	n = n.replace(/\r?\n?\s*<Service\b[^>]*>[\s\S]*?<\/Service>/g, (l) =>
		[...r].some((p) => new RegExp(`ServiceTypeName="${escapeRegex(p)}"`).test(l)) ? (s.push(l), '') : l,
	);
	let a = new Set();
	for (let l of [...s, ...o]) {
		let u = l.matchAll(/\[([A-Za-z_][A-Za-z0-9_.-]*)\]/g);
		for (let p of u) a.add(p[1]);
	}
	let c = [];
	for (let l of a) {
		if (new RegExp(`\\[${escapeRegex(l)}\\]`).test(n)) continue;
		let p = new RegExp(`\\r?\\n?\\s*<Parameter\\s+Name="${escapeRegex(l)}"[^>]*\\/>`, 'g'),
			d = n;
		((n = n.replace(p, '')), n !== d && c.push(l));
	}
	return (
		(n = n.replace(/<Parameters>\s*<\/Parameters>/g, '<Parameters />')),
		(n = n.replace(/<DefaultServices>\s*<\/DefaultServices>/g, '<DefaultServices />')),
		{
			xml: n,
			removedParameters: c,
			removedServiceBlocks: s.length,
			removedImport: i,
		}
	);
}

function patchApplicationParametersForRemove(e, t) {
	if (t.length === 0) return e;
	let r = e;
	for (let n of t) {
		let i = new RegExp(`\\r?\\n?\\s*<Parameter\\s+Name="${escapeRegex(n)}"[^>]*\\/>`, 'g');
		r = r.replace(i, '');
	}
	return ((r = r.replace(/<Parameters>\s*<\/Parameters>/g, '<Parameters />')), r);
}

function patchStartupServicesXmlForRemove(e, t) {
	let r = e,
		n = [];
	r = r.replace(/\r?\n?\s*<Service\b[^>]*>[\s\S]*?<\/Service>/g, (s) =>
		[...t].some((c) => new RegExp(`ServiceTypeName="${escapeRegex(c)}"`).test(s)) ? (n.push(s), '') : s,
	);
	let i = new Set();
	for (let s of n) {
		let a = s.matchAll(/\[([A-Za-z_][A-Za-z0-9_.-]*)\]/g);
		for (let c of a) i.add(c[1]);
	}
	let o = [];
	for (let s of i) {
		if (new RegExp(`\\[${escapeRegex(s)}\\]`).test(r)) continue;
		let c = new RegExp(`\\r?\\n?\\s*<Parameter\\s+Name="${escapeRegex(s)}"[^>]*\\/>`, 'g'),
			l = r;
		((r = r.replace(c, '')), r !== l && o.push(s));
	}
	return (
		(r = r.replace(/<Parameters>\s*<\/Parameters>/g, '<Parameters />')),
		(r = r.replace(/<Services>\s*<\/Services>/g, '<Services />')),
		{
			xml: r,
			removedParameters: o,
			removedServiceBlocks: n.length,
		}
	);
}

function extractServiceTypeNames(e) {
	let t = new Set(),
		r = /<(?:[A-Za-z]+ServiceType|ServiceType)\s+[^>]*?ServiceTypeName="([^"]+)"/g;
	for (let n of e.matchAll(r)) t.add(n[1]);
	return [...t];
}

function patchSfprojRemoveProjectReference(e, t) {
	let r = new Set([t, t.replace(/\//g, '\\'), t.replace(/\\/g, '/')]),
		n = e,
		i = !1;
	for (let o of r) {
		let s = new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${escapeRegex(o)}"\\s*\\/>`, 'gi'),
			a = new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${escapeRegex(o)}"\\s*>[\\s\\S]*?<\\/ProjectReference>`, 'gi'),
			c = n;
		((n = n.replace(s, '').replace(a, '')), n !== c && (i = !0));
	}
	return i
		? ((n = n.replace(/\r?\n?\s*<ItemGroup\b[^>]*>\s*<\/ItemGroup>/g, '')),
			{
				xml: n,
				removed: !0,
			})
		: {
				xml: e,
				removed: !1,
			};
}

function escapeRegex(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export {
	extractServiceTypeNames,
	patchApplicationManifestForRemove,
	patchApplicationParametersForRemove,
	patchSfprojRemoveProjectReference,
	patchStartupServicesXmlForRemove,
};
