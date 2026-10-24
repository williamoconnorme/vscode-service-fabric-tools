"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublishCancelledByUserError = void 0;
exports.collectPackageRootCandidates = collectPackageRootCandidates;
exports.resolveApplicationPackageRoot = resolveApplicationPackageRoot;
/**
 * Build the ordered list of candidate roots to probe. Highest priority first.
 * Duplicates are removed (case-insensitive on Windows-style paths) but
 * `source` of the *first* hit is preserved so logs explain the choice.
 *
 * Pure — no fs access; the caller is expected to feed each entry into
 * `resolveApplicationPackageRoot` for actual probing.
 */
function collectPackageRootCandidates(input, join, isAbsolute) {
    const cfg = (input.configuration ?? 'Debug').trim() || 'Debug';
    const out = [];
    const push = (raw, source) => {
        if (!raw)
            return;
        let value = raw.trim();
        if (!value)
            return;
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
        const exists = out.some(c => c.path.toLowerCase() === norm.toLowerCase());
        if (!exists) {
            out.push({ path: norm, source: source + suffix });
        }
    };
    push(input.settingOverride, 'serviceFabric.deploy.packagePath');
    push(input.packageLocation, 'sfproj <PackageLocation>');
    push(input.outputPath, 'sfproj <OutputPath>');
    push(join('pkg', cfg), `default pkg\\${cfg}`);
    push(join('bin', cfg, 'pkg'), `bin\\${cfg}\\pkg`);
    push(join('bin', cfg), `bin\\${cfg}`);
    return out;
}
/**
 * Thrown by `resolveApplicationPackageRoot` when the caller's
 * `onOverrideTypeMismatch` hook returns `false`. Named subclass so deploy-flow
 * callers can distinguish a deliberate cancellation from a true resolution
 * failure (and skip telemetry-fail accordingly).
 */
class PublishCancelledByUserError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PublishCancelledByUserError';
    }
}
exports.PublishCancelledByUserError = PublishCancelledByUserError;
/**
 * Walk the candidate list in order. For each candidate, accept it if it
 * directly contains `ApplicationManifest.xml`, or if exactly one immediate
 * subdirectory contains it (the nested-by-app-type-name layout).
 *
 * When *no* candidate matches and `searchRoot` is provided, fall back to a
 * bounded recursive search under `searchRoot`. If exactly one match is found,
 * return it; if multiple, throw with the list so the caller can ask the user
 * to disambiguate (or set `serviceFabric.deploy.packagePath`).
 *
 * Throws an actionable Error when nothing can be located.
 */
async function resolveApplicationPackageRoot(candidates, fs, options = {}) {
    if (candidates.length === 0 && !options.searchRoot && !options.evaluateMsbuildProperties) {
        throw new Error('No candidate package roots to probe. Configure serviceFabric.deploy.packagePath or rebuild the project.');
    }
    const probed = [];
    // First pass over the supplied candidates.
    const firstPass = await sweepCandidates(candidates, fs, options, probed);
    if (firstPass)
        return firstPass;
    // Tier 2 fallback (Plan 1.1.9): when every candidate's probe missed AND
    // the caller plumbed a MSBuild evaluator, ask it for additional candidates
    // and re-run the sweep. Failures inside the evaluator degrade silently.
    if (options.evaluateMsbuildProperties) {
        let extra = [];
        try {
            extra = await options.evaluateMsbuildProperties();
        }
        catch {
            extra = [];
        }
        if (extra.length > 0) {
            const secondPass = await sweepCandidates(extra, fs, options, probed);
            if (secondPass)
                return secondPass;
        }
    }
    // 3) Last-resort: bounded recursive search rooted at the .sfproj dir.
    if (options.searchRoot) {
        const found = await searchForManifest(fs, options.searchRoot, options.searchMaxDepth ?? 4);
        if (found.length === 1) {
            return { path: found[0], source: 'recursive search' };
        }
        if (found.length > 1) {
            const disambiguated = await disambiguateHits(fs, found, options.expectedApplicationTypeName, options.onAmbiguous);
            if (disambiguated) {
                return {
                    path: disambiguated.path,
                    source: `recursive search ${disambiguated.sourceSuffix}`
                };
            }
            throw new Error(`Multiple ApplicationManifest.xml files found under ${options.searchRoot}: ${found.join(', ')}.${options.expectedApplicationTypeName
                ? ` None matched expected ApplicationTypeName '${options.expectedApplicationTypeName}'.`
                : ''} Set serviceFabric.deploy.packagePath to the correct application package root.`);
        }
    }
    throw new Error(`Could not locate ApplicationManifest.xml. Probed: ${probed.join(', ')}. The Package build may not have produced any output, or the package is in a non-standard location \u2014 set serviceFabric.deploy.packagePath to override.`);
}
/**
 * Single pass over a candidate list — extracted so Tier 2 can re-run the
 * exact same probe logic against MSBuild-evaluator-produced candidates
 * without duplicating the disambiguation / single-immediate-child / override-
 * rooted recursive-search handling.
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
async function sweepCandidates(candidates, fs, options, probed) {
    for (const candidate of candidates) {
        probed.push(candidate.path);
        if (!(await fs.pathExists(candidate.path)))
            continue;
        // 1) Direct match.
        if (await containsManifest(fs, candidate.path)) {
            await confirmOverrideTypeMatch(fs, candidate, candidate.path, options);
            return { path: candidate.path, source: candidate.source };
        }
        // 2) Single immediate child with the manifest (older VS layout, OR
        //    a single drop-folder hosting one packaged app type).
        const children = await fs.readDirectories(candidate.path);
        const hits = [];
        for (const child of children) {
            const childPath = joinPosix(candidate.path, child);
            if (await containsManifest(fs, childPath)) {
                hits.push(childPath);
            }
        }
        if (hits.length === 1) {
            await confirmOverrideTypeMatch(fs, candidate, hits[0], options);
            return { path: hits[0], source: `${candidate.source} (nested)` };
        }
        if (hits.length > 1) {
            const disambiguated = await disambiguateHits(fs, hits, options.expectedApplicationTypeName, options.onAmbiguous);
            if (disambiguated) {
                return {
                    path: disambiguated.path,
                    source: `${candidate.source} ${disambiguated.sourceSuffix}`
                };
            }
            const labelled = await describeHits(fs, hits);
            throw new Error(`Multiple application type folders contain ApplicationManifest.xml under ${candidate.path}: ${labelled}.${options.expectedApplicationTypeName
                ? ` None matched expected ApplicationTypeName '${options.expectedApplicationTypeName}'.`
                : ''} Set serviceFabric.deploy.packagePath to disambiguate.`);
        }
        // 2b) Objective 3 (Plan 1.1.9). The user's explicit override gets a
        //     bounded recursive search rooted at its own path before we move
        //     on to the next candidate. Auto-discovered candidates skip this
        //     to keep MSBuild output-path bugs visible (a stale <OutputPath>
        //     shouldn't be "rescued" by recursing under it).
        if (candidate.source.startsWith('serviceFabric.deploy.packagePath') &&
            options.searchMaxDepth !== undefined &&
            options.searchMaxDepth >= 1) {
            const recursiveHits = await searchForManifest(fs, candidate.path, options.searchMaxDepth);
            if (recursiveHits.length === 1) {
                await confirmOverrideTypeMatch(fs, candidate, recursiveHits[0], options);
                return {
                    path: recursiveHits[0],
                    source: `${candidate.source} (recursive search)`
                };
            }
            if (recursiveHits.length > 1) {
                const disambiguated = await disambiguateHits(fs, recursiveHits, options.expectedApplicationTypeName, options.onAmbiguous);
                if (disambiguated) {
                    // Type-validated by disambiguateHits already; no separate
                    // confirmOverrideTypeMatch call needed.
                    return {
                        path: disambiguated.path,
                        source: `${candidate.source} (recursive search ${disambiguated.sourceSuffix})`
                    };
                }
                const labelled = await describeHits(fs, recursiveHits);
                throw new Error(`Multiple ApplicationManifest.xml files found under override ${candidate.path}: ${labelled}.${options.expectedApplicationTypeName
                    ? ` None matched expected ApplicationTypeName '${options.expectedApplicationTypeName}'.`
                    : ''} Narrow serviceFabric.deploy.packagePath or reduce serviceFabric.deploy.searchMaxDepth.`);
            }
            // zero hits — fall through to the next candidate as today.
        }
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
async function confirmOverrideTypeMatch(fs, candidate, resolvedPath, options) {
    if (!options.onOverrideTypeMismatch)
        return;
    if (!options.expectedApplicationTypeName)
        return;
    if (!candidate.source.startsWith('serviceFabric.deploy.packagePath'))
        return;
    if (!fs.readApplicationTypeName)
        return;
    const manifestPath = joinPosix(resolvedPath, 'ApplicationManifest.xml');
    const declared = await fs.readApplicationTypeName(manifestPath);
    if (declared === undefined) {
        // Couldn't parse — don't block the deploy on a check we can't perform.
        // The SDK will surface its own parse error downstream if relevant.
        return;
    }
    if (declared === options.expectedApplicationTypeName)
        return;
    const proceed = await options.onOverrideTypeMismatch({
        path: resolvedPath,
        declaredApplicationTypeName: declared,
        expectedApplicationTypeName: options.expectedApplicationTypeName
    });
    if (!proceed) {
        throw new PublishCancelledByUserError(`Publish cancelled \u2014 serviceFabric.deploy.packagePath resolved to a package with ApplicationTypeName '${declared}', expected '${options.expectedApplicationTypeName}'. Path: ${resolvedPath}.`);
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
async function disambiguateHits(fs, hits, expected, onAmbiguous) {
    const annotated = await annotateHits(fs, hits);
    if (expected) {
        const matches = annotated.filter(h => h.applicationTypeName !== undefined && h.applicationTypeName === expected);
        if (matches.length === 1) {
            return {
                path: matches[0].path,
                sourceSuffix: `(matched ApplicationTypeName ${expected})`
            };
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
async function annotateHits(fs, hits) {
    const reader = fs.readApplicationTypeName?.bind(fs);
    const out = [];
    for (const dir of hits) {
        let typeName;
        if (reader) {
            try {
                typeName = await reader(joinPosix(dir, 'ApplicationManifest.xml'));
            }
            catch {
                typeName = undefined;
            }
        }
        out.push({ path: dir, applicationTypeName: typeName });
    }
    return out;
}
async function describeHits(fs, hits) {
    const annotated = await annotateHits(fs, hits);
    return annotated
        .map(h => (h.applicationTypeName ? `${baseName(h.path)} [${h.applicationTypeName}]` : baseName(h.path)))
        .join(', ');
}
async function containsManifest(fs, dir) {
    return fs.pathExists(joinPosix(dir, 'ApplicationManifest.xml'));
}
const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.vs',
    '.vscode',
    'obj',
    'packages'
]);
async function searchForManifest(fs, root, maxDepth) {
    const results = [];
    const queue = [{ path: root, depth: 0 }];
    while (queue.length > 0) {
        const { path: dir, depth } = queue.shift();
        if (await containsManifest(fs, dir)) {
            results.push(dir);
            // Don't recurse into a folder we already accepted \u2014 the manifest's
            // own child packages don't represent additional application roots.
            continue;
        }
        if (depth >= maxDepth)
            continue;
        const children = await fs.readDirectories(dir);
        for (const child of children) {
            if (SKIP_DIRS.has(child))
                continue;
            queue.push({ path: joinPosix(dir, child), depth: depth + 1 });
        }
    }
    return results;
}
// We keep our own tiny path helpers here so this module stays free of
// `path`/`fs` imports and runs identically under any test harness.
function joinPosix(...parts) {
    return parts
        .filter(p => p && p.length > 0)
        .join('\\')
        .replace(/[\\/]+/g, '\\');
}
function baseName(p) {
    const m = /[^\\/]+$/.exec(p);
    return m ? m[0] : p;
}
//# sourceMappingURL=packageResolver.js.map