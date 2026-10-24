/**
 * Tier 2 package-path resolution: ask MSBuild itself for the values of
 * `OutputPath`, `PackageLocation` and `BuildOutputPath`, so properties that
 * come from imported targets (`Microsoft.ServiceFabric.targets`,
 * `Directory.Build.props`, ...) are expanded the same way a real build would.
 *
 * Strategy:
 *  1. `MSBuild.exe <sfproj> -getProperty:...` (MSBuild 17.8+), which prints
 *     JSON for multiple properties (or `Name=Value` lines on some hosts).
 *  2. Fallback for older MSBuild: inject a tiny `.targets` file through
 *     `CustomAfterMicrosoftCommonTargets` whose target echoes each property
 *     with a sentinel prefix, then scrape stdout.
 *
 * Results are cached per (sfproj path, mtime, configuration, platform) for
 * the lifetime of the extension host. Every failure degrades to `[]` with a
 * log line; this module never throws to the deploy flow.
 */
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import { locateMsBuild, type MsBuildInvocation } from '../build/msbuildLocator';
import type { PackageRootCandidate } from '../deploy/packageResolver';

/** Logging surface used by the evaluator (satisfied by the extension's Logger). */
export interface EvaluatorLogger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
}

export interface EvaluateOptions {
	/** MSBuild `Platform` property. Defaults to `AnyCPU`. */
	platform?: string;
	/** Per-invocation timeout. Defaults to 15 s. */
	timeoutMs?: number;
}

interface EvaluatedProperties {
	OutputPath?: string;
	PackageLocation?: string;
	BuildOutputPath?: string;
}

interface CacheKeyInput {
	sfprojPath: string;
	mtimeMs: number;
	configuration: string;
	platform: string;
}

interface CacheEntry {
	key: CacheKeyInput;
	candidates: PackageRootCandidate[];
}

interface SpawnResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

const evaluatorCache = new Map<string, CacheEntry>();

function evaluatorCacheKey(key: CacheKeyInput): string {
	return `${key.sfprojPath.toLowerCase()}::${key.mtimeMs}::${key.configuration}::${key.platform}`;
}

/**
 * Evaluate the `.sfproj` with MSBuild and return package-root candidates
 * derived from `PackageLocation`, `OutputPath` and `BuildOutputPath`
 * (relative values are resolved against the `.sfproj` directory). Returns
 * `[]` when MSBuild can't be found or run.
 */
export async function evaluateMsbuildPackageCandidates(
	sfprojPath: string,
	configuration: string,
	logger: EvaluatorLogger,
	options: EvaluateOptions = {},
): Promise<PackageRootCandidate[]> {
	const platform = options.platform ?? 'AnyCPU';
	const timeoutMs = options.timeoutMs ?? 15000;
	let mtimeMs: number;
	try {
		mtimeMs = (await fsp.stat(sfprojPath)).mtimeMs;
	} catch (err) {
		logger.warn(`MSBuild evaluator skipped: cannot stat ${sfprojPath}: ${(err as Error).message}`);
		return [];
	}
	const key: CacheKeyInput = { sfprojPath, mtimeMs, configuration, platform };
	const cached = evaluatorCache.get(evaluatorCacheKey(key));
	if (cached) {
		logger.debug(`MSBuild evaluator cache hit for ${path.basename(sfprojPath)} (${configuration}|${platform}).`);
		return cached.candidates;
	}
	let msbuild: MsBuildInvocation | undefined;
	try {
		msbuild = await locateMsBuild();
	} catch (err) {
		logger.warn(`MSBuild evaluator skipped: ${(err as Error).message}.`);
		return [];
	}
	if (!msbuild || !msbuild.executable) {
		logger.warn('MSBuild evaluator skipped: MSBuild.exe not found.');
		return [];
	}
	const sfprojDir = path.dirname(sfprojPath);
	const props =
		(await evaluateViaGetProperty(msbuild, sfprojPath, configuration, platform, timeoutMs, logger)) ??
		(await evaluateViaInlineTarget(msbuild, sfprojPath, configuration, platform, timeoutMs, logger));
	if (!props) {
		evaluatorCache.set(evaluatorCacheKey(key), { key, candidates: [] });
		return [];
	}
	const candidates: PackageRootCandidate[] = [];
	const push = (raw: string | undefined, source: string): void => {
		if (!raw) return;
		const value = raw.trim();
		if (!value) return;
		const norm = (path.isAbsolute(value) ? value : path.join(sfprojDir, value)).replace(/[\\/]+$/, '');
		if (!candidates.some((c) => c.path.toLowerCase() === norm.toLowerCase())) {
			candidates.push({ path: norm, source });
		}
	};
	push(props.PackageLocation, 'MSBuild -getProperty:PackageLocation');
	push(props.OutputPath, 'MSBuild -getProperty:OutputPath');
	push(props.BuildOutputPath, 'MSBuild -getProperty:BuildOutputPath');
	evaluatorCache.set(evaluatorCacheKey(key), { key, candidates });
	if (candidates.length > 0) {
		logger.info(
			`MSBuild evaluator produced ${candidates.length} package-path candidate(s): ${candidates.map((c) => `${c.source}=${c.path}`).join('; ')}`,
		);
	} else {
		logger.warn(`MSBuild evaluator returned no usable values for ${path.basename(sfprojPath)} (${configuration}|${platform}).`);
	}
	return candidates;
}

/** Strategy 1: `-getProperty:`. Returns `undefined` to signal "try the fallback". */
async function evaluateViaGetProperty(
	msbuild: MsBuildInvocation,
	sfprojPath: string,
	configuration: string,
	platform: string,
	timeoutMs: number,
	logger: EvaluatorLogger,
): Promise<EvaluatedProperties | undefined> {
	const args = [
		...msbuild.leadingArgs,
		sfprojPath,
		'-nologo',
		'-noconlog',
		'-getProperty:OutputPath,PackageLocation,BuildOutputPath',
		`-p:Configuration=${configuration}`,
		`-p:Platform=${platform}`,
	];
	const result = await spawnCapture(msbuild.executable, args, timeoutMs);
	if (!result) {
		logger.warn('MSBuild evaluator: spawn failed for -getProperty: invocation.');
		return undefined;
	}
	if (result.exitCode !== 0) {
		logger.debug(
			`MSBuild -getProperty: failed with exit ${result.exitCode}; will try inline-target fallback. stderr: ${truncateForLog(result.stderr, 240)}`,
		);
		return undefined;
	}
	return parseGetPropertyOutput(result.stdout);
}

/**
 * Parse `-getProperty:` output: either JSON (`{"Properties": {...}}`) or
 * `Name=Value` lines.
 */
function parseGetPropertyOutput(stdout: string): EvaluatedProperties {
	const text = stdout.trim();
	if (!text) return {};
	if (text.startsWith('{')) {
		try {
			// Parsed JSON blob from MSBuild; shape checked field by field below.
			const parsed: any = JSON.parse(text);
			const props = parsed?.Properties ?? parsed;
			if (props && typeof props == 'object') {
				return {
					OutputPath: typeof props.OutputPath == 'string' ? props.OutputPath : undefined,
					PackageLocation: typeof props.PackageLocation == 'string' ? props.PackageLocation : undefined,
					BuildOutputPath: typeof props.BuildOutputPath == 'string' ? props.BuildOutputPath : undefined,
				};
			}
		} catch {
			// Not JSON after all — fall through to line parsing.
		}
	}
	const out: EvaluatedProperties = {};
	for (const line of text.split(/\r?\n/)) {
		const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (!m) continue;
		const name = m[1];
		const value = m[2];
		if (name === 'OutputPath') out.OutputPath = value;
		else if (name === 'PackageLocation') out.PackageLocation = value;
		else if (name === 'BuildOutputPath') out.BuildOutputPath = value;
	}
	return out;
}

/** Strategy 2: inject a temporary `.targets` file that echoes the properties. */
async function evaluateViaInlineTarget(
	msbuild: MsBuildInvocation,
	sfprojPath: string,
	configuration: string,
	platform: string,
	timeoutMs: number,
	logger: EvaluatorLogger,
): Promise<EvaluatedProperties | undefined> {
	const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sfproj-eval-'));
	const targetsPath = path.join(tempDir, 'SfProjEval.targets');
	const sentinel = '__SFPROJ_EVAL__';
	const targetsXml = `<?xml version="1.0" encoding="utf-8"?>
<Project>
  <Target Name="SfProjEvalGetProps">
    <Message Importance="High" Text="${sentinel}|OutputPath=$(OutputPath)" />
    <Message Importance="High" Text="${sentinel}|PackageLocation=$(PackageLocation)" />
    <Message Importance="High" Text="${sentinel}|BuildOutputPath=$(BuildOutputPath)" />
  </Target>
</Project>
`;
	try {
		await fsp.writeFile(targetsPath, targetsXml, 'utf8');
		const args = [
			...msbuild.leadingArgs,
			sfprojPath,
			'-nologo',
			'-noconlog',
			'-target:SfProjEvalGetProps',
			`-p:Configuration=${configuration}`,
			`-p:Platform=${platform}`,
			`-p:CustomAfterMicrosoftCommonTargets=${targetsPath}`,
			`-p:CustomAfterMicrosoftCommonCrossTargetingTargets=${targetsPath}`,
		];
		const result = await spawnCapture(msbuild.executable, args, timeoutMs);
		if (!result) {
			logger.warn('MSBuild evaluator: inline-target spawn failed.');
			return undefined;
		}
		if (result.exitCode !== 0) {
			logger.warn(`MSBuild inline-target evaluator failed (exit ${result.exitCode}). stderr: ${truncateForLog(result.stderr, 240)}`);
			return undefined;
		}
		const out: EvaluatedProperties = {};
		for (const line of result.stdout.split(/\r?\n/)) {
			const m = new RegExp(`${sentinel}\\|([A-Za-z_][A-Za-z0-9_]*)=(.*)$`).exec(line);
			if (!m) continue;
			const value = m[2].trim();
			if (m[1] === 'OutputPath') out.OutputPath = value;
			else if (m[1] === 'PackageLocation') out.PackageLocation = value;
			else if (m[1] === 'BuildOutputPath') out.BuildOutputPath = value;
		}
		return out;
	} catch (err) {
		logger.warn(`MSBuild inline-target evaluator failed: ${(err as Error).message}`);
		return undefined;
	} finally {
		try {
			await fsp.rm(tempDir, { recursive: true, force: true });
		} catch {
			// best effort
		}
	}
}

/**
 * Spawn a process and capture stdout/stderr. Resolves `undefined` when the
 * process can't be spawned, and `exitCode: -1` (with `[timed out]` appended
 * to stderr) when it outlives `timeoutMs`. Never rejects.
 */
function spawnCapture(executable: string, args: readonly string[], timeoutMs: number): Promise<SpawnResult | undefined> {
	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let settled = false;
		const child = cp.spawn(executable, [...args], { windowsHide: true });
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				try {
					child.kill();
				} catch {
					// already gone
				}
				resolve({ exitCode: -1, stdout, stderr: stderr + '\n[timed out]' });
			}
		}, timeoutMs);
		child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
		child.on('error', () => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve(undefined);
			}
		});
		child.on('close', (code) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve({ exitCode: code ?? 0, stdout, stderr });
			}
		});
	});
}

function truncateForLog(text: string | undefined, max: number): string {
	return text ? (text.length <= max ? text : text.slice(0, max) + '\u2026') : '';
}
