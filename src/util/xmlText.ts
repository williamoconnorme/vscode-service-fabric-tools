// @ts-nocheck

function findAttributeOccurrences(e, t, r) {
	let n = [],
		i = new RegExp(`<(?:[A-Za-z_][\\w\\-.]*:)?${escapeRe(t)}\\b([^>]*?)/?>`, 'g'),
		o;
	for (; (o = i.exec(e)) !== null;) {
		let s = o.index,
			a = o.index + o[0].length,
			c = o[1],
			u = new RegExp(`\\b${escapeRe(r)}\\s*=\\s*"([^"]*)"`).exec(c);
		if (u) {
			let p = u.index + u[0].indexOf('"') + 1,
				d = s + 1 + o[0].indexOf(c) + p,
				f = o[0],
				m = new RegExp(`\\b${escapeRe(r)}\\s*=\\s*"`).exec(f);
			if (m) {
				let v = s + m.index + m[0].length,
					h = v + u[1].length;
				n.push({
					value: u[1],
					valueRange: {
						start: v,
						end: h,
					},
					elementRange: {
						start: s,
						end: a,
					},
				});
			} else
				n.push({
					value: u[1],
					valueRange: {
						start: d,
						end: d + u[1].length,
					},
					elementRange: {
						start: s,
						end: a,
					},
				});
		}
	}
	return n;
}

function findParameterRefs(e) {
	let t = [],
		r = /\[([A-Za-z_][\w\-.]*)\]/g,
		n;
	for (; (n = r.exec(e)) !== null;)
		t.push({
			name: n[1],
			range: {
				start: n.index,
				end: n.index + n[0].length,
			},
		});
	return t;
}

function escapeRe(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { findAttributeOccurrences, findParameterRefs };
