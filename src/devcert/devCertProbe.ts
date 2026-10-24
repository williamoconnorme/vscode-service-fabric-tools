/**
 * Pure helpers for parsing `dotnet dev-certs https --check --verbose` output.
 *
 * Kept free of any `vscode` / `child_process` import so they can be exercised
 * from the node test runner against captured fixture strings — no real
 * subprocess required.
 *
 * The parser targets the stable phrases emitted by `dotnet dev-certs https`
 * since at least .NET 6: messages may be reformatted across SDK versions but
 * the substrings we match (`"valid"`, `"trusted"`, `"NotAfter"`,
 * `"No valid certificate"`, `"is not trusted"`) have been stable in
 * Microsoft's dotnet/aspnetcore source for the last several releases.
 */

/** Structured result of a `dotnet dev-certs https --check` probe. */
export type DevCertProbeResult =
	| { kind: 'missing' }
	| { kind: 'untrusted' }
	| { kind: 'expired'; daysOverdue: number }
	| { kind: 'expiring'; daysRemaining: number }
	/** `daysRemaining` is `Number.POSITIVE_INFINITY` when the expiry date could not be read. */
	| { kind: 'valid'; daysRemaining: number }
	| { kind: 'unparseable'; raw: string };

/**
 * Parses captured `dotnet dev-certs https --check --verbose` output into a
 * structured result. Pure — does not spawn anything; safe to call repeatedly.
 *
 * @param stdout Captured standard output of the subprocess.
 * @param stderr Captured standard error of the subprocess (currently unused
 *   but accepted so the orchestrator does not have to drop it on the floor).
 * @param exitCode Exit code of the subprocess.
 * @param nowIso ISO-8601 timestamp used as "now" for expiry math. Pass
 *   `new Date().toISOString()` from production callers; tests inject a
 *   fixed value for determinism.
 * @param warningWindowDays Days before expiry to surface the `expiring`
 *   result instead of `valid`. `0` disables the warning branch.
 */
export function parseDevCertCheckOutput(
	stdout: string | undefined,
	stderr: string | undefined,
	exitCode: number,
	nowIso: string,
	warningWindowDays: number,
): DevCertProbeResult {
	const text = stdout ?? '';
	const lower = text.toLowerCase();
	// The dotnet CLI prints "No valid certificate found" when neither a
	// present-and-trusted nor a present-but-untrusted cert exists.
	if (/no\s+valid\s+certificate/i.test(text)) {
		return { kind: 'missing' };
	}
	// "is not trusted" / "trust the certificate" appear when a cert exists
	// in CurrentUser\\My but has not been registered with the OS trust store.
	if (/is\s+not\s+trusted/i.test(text) || /trust\s+the\s+certificate/i.test(lower)) {
		return { kind: 'untrusted' };
	}
	// Try to extract a NotAfter date so we can compute daysRemaining.
	// The CLI prints lines like "NotAfter: 2026-09-01T00:00:00Z" or
	// "Expires: 2026-09-01" depending on SDK version; accept either.
	const notAfterMatch = /(?:NotAfter|Expires?)\s*[:=]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[Tt][0-9:.+\-Zz]*)?)/.exec(text);
	if (notAfterMatch) {
		const expiresMs = Date.parse(notAfterMatch[1]);
		const nowMs = Date.parse(nowIso);
		if (!Number.isNaN(expiresMs) && !Number.isNaN(nowMs)) {
			const dayMs = 24 * 60 * 60 * 1000;
			const diffDays = Math.floor((expiresMs - nowMs) / dayMs);
			if (diffDays < 0) {
				return { kind: 'expired', daysOverdue: -diffDays };
			}
			if (warningWindowDays > 0 && diffDays <= warningWindowDays) {
				return { kind: 'expiring', daysRemaining: diffDays };
			}
			return { kind: 'valid', daysRemaining: diffDays };
		}
	}
	// Cert is reported valid but we couldn't read NotAfter — still useful to
	// distinguish from the truly-missing case, so report `valid` with an
	// infinite daysRemaining. Anything else is unparseable and the
	// orchestrator surfaces the raw output to the user.
	if (exitCode === 0 && /valid/i.test(text)) {
		return { kind: 'valid', daysRemaining: Number.POSITIVE_INFINITY };
	}
	return { kind: 'unparseable', raw: text };
}
