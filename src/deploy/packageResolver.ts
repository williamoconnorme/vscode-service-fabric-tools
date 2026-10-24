/**
 * Locate the application-package root that the Service Fabric SDK's
 * `Test-ServiceFabricApplicationPackage` should be pointed at.
 *
 * The SDK helper requires the folder that *directly* contains
 * `ApplicationManifest.xml`. If we hand it any other folder, it falls back to
 * treating the leaf segment as an *image-store* path and tries to download
 * a package by that name — surfacing a misleading
 * `Failed to download application package '<leaf>' from the store.` error.
 *
 * MSBuild output landing zones in the wild:
 *
 *  1. **Default flat:**   `<sfprojDir>\pkg\<Configuration>\ApplicationManifest.xml`
 *  2. **Default nested:** `<sfprojDir>\pkg\<Configuration>\<AppTypeName>\ApplicationManifest.xml`
 *     (older VS template; `Microsoft.ServiceFabric.targets` for some
 *     `ProjectVersion`s nests by application type name)
 *  3. **Custom `<OutputPath>`:** declared inside the `.sfproj`'s
 *     `PropertyGroup`, e.g. `..\out\sfpkg`. Common in monorepo layouts.
 *  4. **Custom `<PackageLocation>`:** an alternative SF Tools property that
 *     points directly at the staged-package folder.
 *  5. **User override** via `serviceFabric.deploy.packagePath` setting.
 *
 * This module is pure: all filesystem access is injected via `ProbeFs` so
 * the resolver can be exhaustively unit-tested.
 */
import type { ExpandResult } from '../project/msbuildPropertyExpander';

/** One candidate package root, with a human-readable label for logs. */
export interface PackageRootCandidate {
	path: string;
	source: string;
}

export interface CollectCandidatesInput {
	sfprojDir: string;
	configuration?: string;
	outputPath?: string;
	packageLocation?: string;
	/** Value of `serviceFabric.deploy.packagePath`, if set. */
	settingOverride?: string;
	/** Optional `$(Property)` expander applied to every raw value. */
	expand?: (value: string) => ExpandResult;
}

/** Filesystem surface the resolver needs. Injected so tests can fake it. */
export interface ProbeFs {
	pathExists(p: string): Promise<boolean>;
	/** Names (not paths) of immediate subdirectories; `[]` on error. */
	readDirectories(p: string): Promise<string[]>;
	/** `ApplicationTypeName` declared by an `ApplicationManifest.xml`, or `undefined` if unreadable. */
	readApplicationTypeName?(manifestPath: string): Promise<string | undefined>;
}

/** A discovered package folder annotated with its declared application type. */
export interface AnnotatedHit {
	path: string;
	applicationTypeName: string | undefined;
}

export interface OverrideTypeMismatch {
	path: string;
	declaredApplicationTypeName: string;
	expectedApplicationTypeName: string;
}

export interface ResolveOptions {
	/** Depth of the per-candidate manifest search. Defaults to 2; `< 1` disables it. */
	searchMaxDepth?: number;
	/** ApplicationTypeName declared by the .sfproj's ApplicationManifest. */
	expectedApplicationTypeName?: string;
	/** UI hook to pick among multiple hits; returns the chosen path. */
	onAmbiguous?: (hits: AnnotatedHit[]) => Promise<string | undefined>;
	/** Tier 2: produce extra candidates by asking MSBuild itself. */
	evaluateMsbuildProperties?: () => Promise<PackageRootCandidate[]>;
	/** Called when the override's manifest declares a different type; return `false` to cancel. */
	onOverrideTypeMismatch?: (info: OverrideTypeMismatch) => Promise<boolean>;
}

export interface ResolveResult {
	path: string;
	source: string;
}

/**
 * Build the ordered list of candidate roots to probe. Highest priority first.
 * Duplicates are removed (case-insensitive on Windows-style paths) but
 * `source` of the *first* hit is preserved so logs explain the choice.
 *
 * Pure — no fs access; the caller is expected to feed each entry into
 * `resolveApplicationPackageRoot` for actual probing.
 */
export function collectPackageRootCandidates(
	input: CollectCandidatesInput,
	join: (...parts: string[]) => string,
	isAbsolute: (p: string) => boolean,
): PackageRootCandidate[] {
	const cfg = (input.configuration ?? 'Debug').trim() || 'Debug';
	const out: PackageRootCandidate[] = [];
	const push = (raw: string | undefined, source: string): void => {
		if (!raw) return;
		let value = raw.trim();
		if (!value) return;
		let suffix = '';
		if (input.expand) {
			const r = input.expand(value);
			if (r.value !== value) {
				value = r.value;
				suffix = ' (expanded)';
			}
			// Unresolved tokens are NOT a hard error here — the candidate
			// path will simply fail its existence probe. The deploy flow
			// logs the aggregated unresolved set once per Publish.
		}
		const abs = isAbsolute(value) ? value : join(input.sfprojDir, value);
		const norm = abs.replace(/[\\/]+$/, '');
		// Dedup case-insensitively to handle path-comparison on Windows.
		const exists = out.some((c) => c.path.toLowerCase() === norm.toLowerCase());
		if (!exists) {
			out.push({ path: norm, source: source + suffix });
		}
	};
	push(input.settingOverride, 'serviceFabric.deploy.packagePath');
	push(input.packageLocation, 'sfproj <PackageLocation>');
	push(input.outputPath, 'sfproj <OutputPath>');
	const sep = process.platform === 'win32' ? '\\' : '/';
	push(join('pkg', cfg), `default pkg${sep}${cfg}`);
	push(join('bin', cfg, 'pkg'), `bin${sep}${cfg}${sep}pkg`);
	push(join('bin', cfg), `bin${sep}${cfg}`);
	return out;
}

/**
 * Thrown by `resolveApplicationPackageRoot` when the caller's
 * `onOverrideTypeMismatch` hook returns `false`. Named subclass so deploy-flow
 * callers can distinguish a deliberate cancellation from a true resolution
 * failure (and skip telemetry-fail accordingly).
 */
export class PublishCancelledByUserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PublishCancelledByUserError';
	}
}

/**
 * Walk the candidate list in order. For each candidate, accept it if it
 * directly contains `ApplicationManifest.xml`, or if a bounded search beneath
 * it (`searchMaxDepth`, default 2) finds exactly one folder that does (e.g.
 * the nested-by-app-type-name layout).
 *
 * When every candidate misses and `evaluateMsbuildProperties` is supplied,
 * re-run the same sweep over the candidates it produces (Tier 2).
 *
 * Throws an actionable Error when nothing can be located.
 */
export async function resolveApplicationPackageRoot(
	candidates: PackageRootCandidate[],
	fs: ProbeFs,
	options: ResolveOptions = {},
): Promise<ResolveResult> {
	if (candidates.length === 0 && !options.evaluateMsbuildProperties) {
		throw new Error('No candidate package roots to probe. Configure serviceFabric.deploy.packagePath or rebuild the project.');
	}
	const probed: string[] = [];
	// First pass over the supplied candidates.
	const firstPass = await sweepCandidates(candidates, fs, options, probed);
	if (firstPass) return firstPass;
	// Tier 2 fallback (Plan 1.1.9): when every candidate's probe missed AND
	// the caller plumbed a MSBuild evaluator, ask it for additional candidates
	// and re-run the sweep. Failures inside the evaluator degrade silently.
	if (options.evaluateMsbuildProperties) {
		let extra: PackageRootCandidate[] = [];
		try {
			extra = await options.evaluateMsbuildProperties();
		} catch {
			extra = [];
		}
		if (extra.length > 0) {
			const secondPass = await sweepCandidates(extra, fs, options, probed);
			if (secondPass) return secondPass;
		}
	}
	throw new Error(
		`Could not locate ApplicationManifest.xml. Probed: ${probed.join(', ')}. Set serviceFabric.deploy.packagePath to the folder that directly contains ApplicationManifest.xml, or enable serviceFabric.deploy.useMsbuildPropertyEvaluator if your <OutputPath>/<PackageLocation> references properties defined in Directory.Build.props or imported .targets.`,
	);
}

/**
 * Single pass over a candidate list — extracted so Tier 2 can re-run the
 * exact same probe logic against MSBuild-evaluator-produced candidates
 * without duplicating the nested search / disambiguation handling.
 *
 * Returns the chosen `ResolveResult` when this pass found one, or `undefined`
 * to signal "continue to the next phase". Pushes every probed candidate path
 * into the caller's `probed` array for the final "Could not locate ..." log.
 *
 * May throw:
 *   - `PublishCancelledByUserError` when the override-type-mismatch hook
 *     returned `false`.
 *   - The standard "Multiple application type folders ..." error when a
 *     multi-hit candidate cannot be disambiguated.
 */
async function sweepCandidates(
	candidates: PackageRootCandidate[],
	fs: ProbeFs,
	options: ResolveOptions,
	probed: string[],
): Promise<ResolveResult | undefined> {
	for (const candidate of candidates) {
		probed.push(candidate.path);
		if (!(await fs.pathExists(candidate.path))) continue;
		// 1) Direct match.
		if (await containsManifest(fs, candidate.path)) {
			await confirmOverrideTypeMatch(fs, candidate, candidate.path, options);
			return { path: candidate.path, source: candidate.source };
		}
		// 2) Bounded search beneath the candidate (nested-by-app-type-name
		//    layout, or a drop folder hosting one or more packaged app types).
		const maxDepth = options.searchMaxDepth ?? 2;
		if (maxDepth < 1) continue;
		const hits = await searchForManifest(fs, candidate.path, maxDepth);
		if (hits.length === 1) {
			await confirmOverrideTypeMatch(fs, candidate, hits[0], options);
			return { path: hits[0], source: `${candidate.source} (nested)` };
		}
		if (hits.length > 1) {
			const disambiguated = await disambiguateHits(fs, hits, options.expectedApplicationTypeName, options.onAmbiguous);
			if (disambiguated) {
				return { path: disambiguated.path, source: `${candidate.source} ${disambiguated.sourceSuffix}` };
			}
			const labelled = await describeHits(fs, hits);
			throw new Error(
				`Multiple application type folders contain ApplicationManifest.xml under ${candidate.path}: ${labelled}.${
					options.expectedApplicationTypeName ? ` None matched expected ApplicationTypeName '${options.expectedApplicationTypeName}'.` : ''
				} Set serviceFabric.deploy.packagePath to disambiguate.`,
			);
		}
		// zero hits — fall through to the next candidate.
	}
	return undefined;
}

/**
 * Objective 2 (Plan 1.1.9). Validate the chosen single-manifest candidate's
 * declared ApplicationTypeName against the source .sfproj's expected type,
 * but ONLY when the candidate came from the user's explicit
 * `serviceFabric.deploy.packagePath` override. Auto-discovered candidates
 * are exempt by design — they're derived from the .sfproj's own properties
 * and cannot mismatch by construction.
 *
 * Behavior matrix:
 *   - candidate.source not the override          -> no-op
 *   - options.expectedApplicationTypeName unset  -> no-op
 *   - options.onOverrideTypeMismatch unset       -> no-op
 *   - manifest type unreadable                   -> no-op (no double-fail)
 *   - types match (case-sensitive)               -> no-op
 *   - types differ AND hook returns true         -> proceed
 *   - types differ AND hook returns false        -> throw PublishCancelledByUserError
 */
async function confirmOverrideTypeMatch(
	fs: ProbeFs,
	candidate: PackageRootCandidate,
	resolvedPath: string,
	options: ResolveOptions,
): Promise<void> {
	if (
		!options.onOverrideTypeMismatch ||
		!options.expectedApplicationTypeName ||
		!candidate.source.startsWith('serviceFabric.deploy.packagePath') ||
		!fs.readApplicationTypeName
	) {
		return;
	}
	const manifestPath = joinPosix(resolvedPath, 'ApplicationManifest.xml');
	const declared = await fs.readApplicationTypeName(manifestPath);
	if (declared === undefined || declared === options.expectedApplicationTypeName) return;
	const proceed = await options.onOverrideTypeMismatch({
		path: resolvedPath,
		declaredApplicationTypeName: declared,
		expectedApplicationTypeName: options.expectedApplicationTypeName,
	});
	if (!proceed) {
		throw new PublishCancelledByUserError(
			`Publish cancelled \u2014 serviceFabric.deploy.packagePath resolved to a package with ApplicationTypeName '${declared}', expected '${options.expectedApplicationTypeName}'. Path: ${resolvedPath}.`,
		);
	}
}

/**
 * Resolve a "multiple manifests in the same drop" collision.
 *
 * 1. If `expected` is set and the `ProbeFs` exposes `readApplicationTypeName`,
 *    look up each hit's declared `ApplicationTypeName` and silently choose
 *    the unique match (the user's preferred behaviour: a 5-node deploy from
 *    a folder containing both `MyApp` and `MyOtherApp` packages "just works"
 *    because the .sfproj already declares which type it is).
 * 2. Otherwise, if `onAmbiguous` is supplied, hand the discovered hits to
 *    the caller's UI hook and trust whatever path it returns.
 * 3. If neither produces a unique answer, return `undefined` so the caller
 *    can throw the standard error.
 */
async function disambiguateHits(
	fs: ProbeFs,
	hits: string[],
	expected: string | undefined,
	onAmbiguous: ResolveOptions['onAmbiguous'],
): Promise<{ path: string; sourceSuffix: string } | undefined> {
	const annotated = await annotateHits(fs, hits);
	if (expected) {
		const matches = annotated.filter((h) => h.applicationTypeName !== undefined && h.applicationTypeName === expected);
		if (matches.length === 1) {
			return { path: matches[0].path, sourceSuffix: `(matched ApplicationTypeName ${expected})` };
		}
	}
	if (onAmbiguous) {
		const chosen = await onAmbiguous(annotated);
		if (chosen && hits.includes(chosen)) {
			return { path: chosen, sourceSuffix: '(picked by user)' };
		}
	}
	return undefined;
}

async function annotateHits(fs: ProbeFs, hits: string[]): Promise<AnnotatedHit[]> {
	const reader = fs.readApplicationTypeName?.bind(fs);
	const out: AnnotatedHit[] = [];
	for (const dir of hits) {
		let typeName: string | undefined;
		if (reader) {
			try {
				typeName = await reader(joinPosix(dir, 'ApplicationManifest.xml'));
			} catch {
				typeName = undefined;
			}
		}
		out.push({ path: dir, applicationTypeName: typeName });
	}
	return out;
}

async function describeHits(fs: ProbeFs, hits: string[]): Promise<string> {
	const annotated = await annotateHits(fs, hits);
	return annotated.map((h) => (h.applicationTypeName ? `${baseName(h.path)} [${h.applicationTypeName}]` : baseName(h.path))).join(', ');
}

async function containsManifest(fs: ProbeFs, dir: string): Promise<boolean> {
	return fs.pathExists(joinPosix(dir, 'ApplicationManifest.xml'));
}

const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.vs',
	'.vscode',
	'obj',
	'packages',
	'bin',
	'out',
	'artifacts',
	'_published',
	'TestResults',
]);

async function searchForManifest(fs: ProbeFs, root: string, maxDepth: number): Promise<string[]> {
	const results: string[] = [];
	const queue: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
	while (queue.length > 0) {
		const { path: dir, depth } = queue.shift()!;
		if (await containsManifest(fs, dir)) {
			results.push(dir);
			// Don't recurse into a folder we already accepted — the manifest's
			// own child packages don't represent additional application roots.
			continue;
		}
		if (depth >= maxDepth) continue;
		const children = await fs.readDirectories(dir);
		for (const child of children) {
			if (SKIP_DIRS.has(child)) continue;
			queue.push({ path: joinPosix(dir, child), depth: depth + 1 });
		}
	}
	return results;
}

// We keep our own tiny path helpers here so this module stays free of
// `path`/`fs` imports and runs identically under any test harness. Joins with
// the separator the base path already uses: `\` for Windows paths (drive
// letter or backslashes), `/` otherwise, so POSIX hosts get real paths.
function joinPosix(...parts: string[]): string {
	const kept = parts.filter((p) => p && p.length > 0);
	const sep = /^[A-Za-z]:|\\/.test(kept[0] ?? '') ? '\\' : '/';
	return kept.join(sep).replace(/[\\/]+/g, sep);
}

function baseName(p: string): string {
	const m = /[^\\/]+$/.exec(p);
	return m ? m[0] : p;
}
