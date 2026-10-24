/**
 * Reuses an existing Azure CLI login (`az login`) to get Entra ID tokens for
 * clusters. Pure Node (no `vscode` imports).
 */
import * as cp from 'child_process';

/** An access token from `az account get-access-token`. */
export interface AzureCliToken {
	accessToken: string;
	/** Expiry, in milliseconds since the epoch. */
	expiresAt: number;
}

/** Runs `az` with the given arguments and resolves with stdout. Injectable for tests. */
export type AzRunner = (args: string[], timeoutMs: number) => Promise<string>;

// Values come from the cluster's /$/GetAadMetadata, so only accept plain
// GUIDs, domain names and api:// style URIs before they reach a shell.
const SAFE_ARG = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

// Reuse a token until it is this close to expiring.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
// After a failure (CLI missing, not logged in, no consent), don't spawn `az` again for this long.
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

const cache = new Map<string, AzureCliToken>();
const failures = new Map<string, { at: number; reason: string }>();

/**
 * Default runner. On Windows `az` is a `.cmd` script, which Node only runs
 * through a shell; arguments are validated against {@link SAFE_ARG} first.
 */
export const runAz: AzRunner = (args, timeoutMs) =>
	new Promise((resolve, reject) => {
		// Flags and validated values only: no spaces, quotes or cmd.exe metacharacters.
		const unsafe = args.find((a) => !/^[A-Za-z0-9._:/-]+$/.test(a));
		if (unsafe !== undefined) {
			reject(new Error(`Refusing to pass '${unsafe}' to the Azure CLI.`));
			return;
		}
		const options = { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' as const };
		const done = (err: Error | null, stdout: string, stderr: string): void => {
			if (err) {
				const notFound = (err as NodeJS.ErrnoException).code === 'ENOENT' || /not recognized|not found/i.test(stderr);
				reject(new Error(notFound ? 'Azure CLI (az) is not installed or not on PATH.' : (stderr || err.message).trim()));
				return;
			}
			resolve(stdout);
		};
		// Every argument passed the check above, so joining them into a cmd.exe command line is safe.
		if (process.platform === 'win32') cp.exec(`az ${args.join(' ')}`, options, done);
		else cp.execFile('az', args, options, done);
	});

function parseExpiry(json: { expires_on?: unknown; expiresOn?: unknown }): number {
	// Newer CLIs give `expires_on` (epoch seconds); older ones only a local-time `expiresOn` string.
	const epoch = Number(json.expires_on);
	if (Number.isFinite(epoch) && epoch > 0) return epoch * 1000;
	const parsed = Date.parse(String(json.expiresOn ?? ''));
	return Number.isFinite(parsed) ? parsed : Date.now() + 10 * 60 * 1000;
}

/**
 * Gets a token for `resource` in `tenant` from the Azure CLI's login, caching it
 * until shortly before it expires. Throws with the CLI's reason when it can't
 * (not installed, not logged in, consent missing); repeated calls within the
 * back-off window throw the cached reason without running `az` again.
 */
export async function getAzureCliToken(
	resource: string,
	tenant: string,
	opts: { run?: AzRunner; timeoutMs?: number; now?: () => number } = {},
): Promise<AzureCliToken> {
	const now = opts.now ?? Date.now;
	if (!SAFE_ARG.test(resource) || !SAFE_ARG.test(tenant)) {
		throw new Error(`Not asking the Azure CLI for a token: unexpected resource '${resource}' or tenant '${tenant}'.`);
	}
	const key = `${tenant}|${resource}`;
	const cached = cache.get(key);
	if (cached && cached.expiresAt - now() > EXPIRY_MARGIN_MS) return cached;
	const failed = failures.get(key);
	if (failed && now() - failed.at < FAILURE_BACKOFF_MS) throw new Error(failed.reason);
	try {
		const stdout = await (opts.run ?? runAz)(
			['account', 'get-access-token', '--resource', resource, '--tenant', tenant, '--output', 'json'],
			opts.timeoutMs ?? 20000,
		);
		const json = JSON.parse(stdout) as { accessToken?: unknown; expires_on?: unknown; expiresOn?: unknown };
		if (typeof json.accessToken !== 'string' || !json.accessToken) throw new Error('Azure CLI returned no access token.');
		const token = { accessToken: json.accessToken, expiresAt: parseExpiry(json) };
		cache.set(key, token);
		failures.delete(key);
		return token;
	} catch (err) {
		const reason = (err as Error).message.split(/\r?\n/).find((l) => l.trim()) ?? 'unknown error';
		failures.set(key, { at: now(), reason });
		throw new Error(reason);
	}
}

/** Forgets cached tokens and failures, e.g. after the user runs `az login`. */
export function clearAzureCliTokenCache(): void {
	cache.clear();
	failures.clear();
}
