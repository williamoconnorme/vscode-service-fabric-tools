// @ts-nocheck

var TOKEN_RE = /\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g;

function buildPropertyMap(e) {
	let t = new Map();
	for (let [r, n] of e.intrinsics) t.set(r, n);
	(t.set('Configuration', e.configuration), t.set('Platform', e.platform ?? 'AnyCPU'));
	for (let r of e.propertyGroups)
		if (!(r.condition !== void 0 && evaluateSimpleCondition(r.condition, t) !== !0))
			for (let { name: n, value: i } of r.properties) t.set(n, expandMsbuildValue(i, t).value);
	return t;
}

function expandMsbuildValue(e, t, r = {}) {
	let n = r.maxIterations ?? 16,
		i = e;
	for (let s = 0; s < n; s++) {
		let a = !1,
			c = i.replace(TOKEN_RE, (l, u) => {
				let p = t.get(u);
				return p === void 0 ? l : ((a = !0), p);
			});
		if (!a) break;
		i = c;
	}
	let o = new Set();
	for (let s of i.matchAll(TOKEN_RE)) o.add(s[1]);
	return {
		value: i,
		unresolved: [...o],
	};
}

function evaluateSimpleCondition(e, t) {
	let r = e.trim(),
		n = /^'([^']*)'\s*(==|!=)\s*'([^']*)'$/.exec(r);
	if (!n) return 'unevaluable';
	let i = expandMsbuildValue(n[1], t).value.toLowerCase(),
		o = expandMsbuildValue(n[3], t).value.toLowerCase();
	return n[2] === '==' ? i === o : i !== o;
}

function makeExpander(e) {
	return (t) => expandMsbuildValue(t, e);
}

export { buildPropertyMap, makeExpander };
