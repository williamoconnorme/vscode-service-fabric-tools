// @ts-nocheck

function buildScriptWithParameters(e, t) {
	let r = [];
	for (let [n, i] of Object.entries(t))
		if (i !== void 0) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new Error(`Invalid PowerShell parameter name: ${n}`);
			r.push(`$${n} = ${literal(i)}`);
		}
	return r.length === 0
		? e
		: r.join(`
`) +
				`
` +
				e;
}

function literal(e) {
	return typeof e == 'boolean'
		? e
			? '$true'
			: '$false'
		: typeof e == 'number' && Number.isFinite(e)
			? String(e)
			: `'${(typeof e == 'string' ? e : String(e)).replace(/'/g, "''")}'`;
}

export { buildScriptWithParameters };
