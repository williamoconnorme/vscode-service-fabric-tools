// @ts-nocheck

function parseDevCertCheckOutput(e, t, r, n, i) {
	let o = e ?? '',
		s = o.toLowerCase();
	if (/no\s+valid\s+certificate/i.test(o))
		return {
			kind: 'missing',
		};
	if (/is\s+not\s+trusted/i.test(o) || /trust\s+the\s+certificate/i.test(s))
		return {
			kind: 'untrusted',
		};
	let a = /(?:NotAfter|Expires?)\s*[:=]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[Tt][0-9:.+\-Zz]*)?)/.exec(o);
	if (a) {
		let c = Date.parse(a[1]),
			l = Date.parse(n);
		if (!Number.isNaN(c) && !Number.isNaN(l)) {
			let p = Math.floor((c - l) / 864e5);
			return p < 0
				? {
						kind: 'expired',
						daysOverdue: -p,
					}
				: i > 0 && p <= i
					? {
							kind: 'expiring',
							daysRemaining: p,
						}
					: {
							kind: 'valid',
							daysRemaining: p,
						};
		}
	}
	return r === 0 && /valid/i.test(o)
		? {
				kind: 'valid',
				daysRemaining: Number.POSITIVE_INFINITY,
			}
		: {
				kind: 'unparseable',
				raw: o,
			};
}

export { parseDevCertCheckOutput };
