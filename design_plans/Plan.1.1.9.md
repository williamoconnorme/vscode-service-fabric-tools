# Plan — 1.1.9 (Package-path resolution: MSBuild property expansion + override application-type safety check + configurable recursive-search depth)

## 0. Scope summary

Three co-objectives, all narrowly scoped to the **package-root resolver** ([src/deploy/packageResolver.ts](src/deploy/packageResolver.ts)) and the surrounding deploy flow:

**Objective 1 — MSBuild `$(Property)` expansion in package-path resolution.** A pure, additive enhancement to the resolver and the **.sfproj parser** ([src/project/sfprojParser.ts](src/project/sfprojParser.ts)) so that `<OutputPath>` and `<PackageLocation>` values containing MSBuild property references — `$(BuildOutputPath)`, `$(MSBuildProjectName)`, `$(Configuration)`, `$(MSBuildProjectDirectory)`, etc. — are evaluated before being probed. Today the resolver treats those values as opaque strings, which causes the `<OutputPath>`/`<PackageLocation>` candidates to silently fail their existence check (the candidate path literally contains the unresolved `$(...)` token) and the deploy succeeds only because the recursive-search fallback finds the manifest anyway. The fallback is bounded (`searchMaxDepth = 4`) and brittle in monorepos with deep drop folders.

Three layered tiers, each independently shippable but designed to compose:

1. **Tier 1 — pure expander (always on, no spawn).** Collect *all* scalar `<PropertyGroup>` children from the .sfproj into a `Map<string, string>`, seed it with the well-known intrinsic and context properties (`MSBuildProjectName`, `MSBuildProjectDirectory`, `MSBuildProjectFile`, `MSBuildProjectExtension`, `Configuration`, `Platform`), then iteratively substitute `$(Name)` tokens with a depth cap until either the value resolves or no further substitutions can be made. Honors `<PropertyGroup Condition="'$(Configuration)' == 'Debug'">`-style conditions for the simple `==`/`!=` equality cases.
2. **Tier 2 — opt-in MSBuild evaluator (off by default).** When Tier 1 leaves unresolved `$(...)` tokens *and* every candidate's existence probe fails, optionally invoke `MSBuild.exe -getProperty:OutputPath,PackageLocation,BuildOutputPath -p:Configuration=<cfg>` (MSBuild 17.4+, already located by [src/build/msbuildLocator.ts](src/build/msbuildLocator.ts)) and add the returned absolute paths as additional candidates with source `"MSBuild -getProperty"`. Cached by `(sfprojPath, mtime, Configuration)` to avoid repeated 1–3 s spawns.
3. **Tier 3 — existing recursive search.** Unchanged. Final safety net.

**Objective 2 — Application-type confirmation when `serviceFabric.deploy.packagePath` resolves to a single manifest.** Today the resolver short-circuits any candidate that contains exactly one `ApplicationManifest.xml` (direct match, or single immediate child) without consulting its declared `ApplicationTypeName`. That's the right default for the auto-discovered candidates (`<PackageLocation>`, `<OutputPath>`, `pkg\<cfg>`, ...) — they're derived from the .sfproj itself, so a mismatch is effectively impossible. It is *not* the right default for the **user-supplied `serviceFabric.deploy.packagePath` override**, which is a free-form string that the user could easily aim at a sibling app's drop folder (especially common in monorepos that reuse one output root). The change: when the resolver accepts the *override* candidate and the chosen folder's `ApplicationTypeName` does **not** match the .sfproj's own declared type, surface a modal warning with **"Continue Publish" / "Cancel Publish"** buttons. The choice is **not** persisted — every Publish that resolves through a mismatched override re-prompts. When types match, or when the manifest type cannot be read, the resolver stays silent (existing behavior). Auto-discovered candidates are exempt — they cannot mismatch by construction.

**Objective 3 — Expose `searchMaxDepth` as a setting; honor it under the override.** Today the last-resort recursive search depth is a hardcoded `4` ([deployFlow.ts](src/deploy/deployFlow.ts#L157)). That is too shallow for monorepos that drop packages 5+ levels under the .sfproj (`<repo>\artifacts\bin\<App>\<cfg>\sfpkg\<AppType>\` is already six segments). Worse, the recursive search runs **only** under `project.sfproj.directory` — even when the user has set `serviceFabric.deploy.packagePath`, the resolver does not recurse *under that override*: it only probes the override at depth 0 and 1, and on miss drops through to the project-wide search. The change has two parts: (a) introduce `serviceFabric.deploy.searchMaxDepth` (integer, default `4`, range `1–16`) and plumb it through `ResolveOptions.searchMaxDepth`, and (b) when the override is configured and its direct + single-nested probes miss, run a bounded recursive search rooted **at the override path** (using the same depth) before continuing to the auto-discovered candidates and the existing project-wide fallback. The override is the user's explicit intent — "look under here" — so honoring it as a search root is the principle of least surprise. Auto-discovered candidates keep their existing tight depth-0+1 semantics; widening them would mask MSBuild output-path bugs.

The combined change is fully additive. The resolver's public signature does not change; one new optional field on `CollectCandidatesInput` (`properties?: ReadonlyMap<string, string>`) carries the pre-expanded property map, one new optional callback on `ResolveOptions` (`onOverrideTypeMismatch`) handles the Objective 2 prompt, and `ResolveOptions.searchMaxDepth` (already on the interface, currently defaulted in the resolver) is now driven by Objective 3's setting. The three new / changed settings default to backward-compatible behavior (Tier 1 on, Tier 2 off, depth `4`). No new setting is introduced for Objective 2 — the prompt is unconditional whenever the precondition holds, which is the explicit user-safety promise. No package-version bump in `package.json` — the release pipeline ([scripts/release.ps1](scripts/release.ps1)) sets that automatically at tag time.

## 1. Background — why this exists

### 1.1 Objective 1 — unresolved `$(Property)` tokens

Per the resolver source ([src/deploy/packageResolver.ts](src/deploy/packageResolver.ts#L78-L106)) and parser ([src/project/sfprojParser.ts](src/project/sfprojParser.ts#L48-L52)), the current flow:

1. `firstScalar(propertyGroups, 'OutputPath')` returns the verbatim string from the XML — e.g. `$(BuildOutputPath)\bin\$(MSBuildProjectName)\$(Configuration)\`.
2. `collectPackageRootCandidates` runs `isAbsolute(trimmed)` (false — leading `$(...)` is not absolute), joins to `sfprojDir`, and produces a candidate like `Q:\Repos\MyApp\$(BuildOutputPath)\bin\$(MSBuildProjectName)\$(Configuration)`.
3. `fs.pathExists(candidate.path)` returns false; the candidate is silently skipped.
4. The bounded recursive search ([src/deploy/packageResolver.ts](src/deploy/packageResolver.ts#L322-L344)) walks up to 4 levels deep under `sfprojDir` looking for `ApplicationManifest.xml` and usually finds the real, MSBuild-evaluated drop.

This works for the common Visual-Studio-template layout (`pkg\Debug\` next to the .sfproj) because that path is already in the default candidate list. It breaks down — or pays an unnecessary recursive walk over `node_modules`-sized trees — when:

- A monorepo declares `<BuildOutputPath>$(MSBuildThisFileDirectory)..\..\out\</BuildOutputPath>` in a `Directory.Build.props` and overrides `<OutputPath>` accordingly. The drop lives well outside `searchMaxDepth=4`.
- Centralized output redirection via `<ArtifactsPath>` (the modern .NET SDK pattern) places packages at `<repo>\artifacts\bin\<projectname>\<configuration>\`. Same out-of-reach problem.
- Two .sfproj files share an output folder via `$(MSBuildProjectName)` interpolation. The recursive search finds *both* manifests and relies on `expectedApplicationTypeName` disambiguation — fine, but slow on large repos.
- The user has set `serviceFabric.deploy.packagePath` to a value that *itself* uses `$(...)` placeholders (a reasonable expectation if they cribbed it from the .sfproj). Today that override is also passed through verbatim and silently misses.

A small, pure expander closes ≈90% of the gap with no MSBuild dependency. The optional MSBuild fallback closes the remaining cases (imports from `Microsoft.ServiceFabric.targets`, `Directory.Build.props`, deeply nested transitive substitutions) without making it a hard requirement for deploy.

### 1.2 Objective 2 — silent acceptance of the wrong app under an override

The disambiguation logic in `resolveApplicationPackageRoot` ([src/deploy/packageResolver.ts](src/deploy/packageResolver.ts#L171-L227)) reads each candidate's `ApplicationTypeName` *only* when two or more `ApplicationManifest.xml` files are found in the same probe scope. A single hit — direct match in the candidate folder, or exactly one immediate child holding the manifest — is returned unconditionally. That is correct for the auto-discovered sources because every one of them is derived from the .sfproj being deployed:

- `<PackageLocation>` / `<OutputPath>` come from the .sfproj's own `<PropertyGroup>`.
- `pkg\<cfg>` / `bin\<cfg>\pkg` / `bin\<cfg>` are defaults pinned to the .sfproj's directory.
- The recursive search runs under `project.sfproj.directory` and is gated by `expectedApplicationTypeName` already (via `disambiguateHits`).

For the **user-supplied `serviceFabric.deploy.packagePath` override** the assumption breaks down. The setting is a free-form workspace string the user typed (often months ago), and a real-world monorepo will routinely have several drop folders side-by-side — `out\sfpkg\AppA\`, `out\sfpkg\AppB\`, `out\sfpkg\AppC\` — each containing exactly one `ApplicationManifest.xml`. If the user typed the wrong leaf, or copy-pasted from another .sfproj's launch profile, the resolver silently hands the SDK a perfectly-formed package for the **wrong application type**. `Deploy-FabricApplication.ps1` then:

- Registers the *other* app's application type (if it isn't already registered), or
- Worse: upgrades the wrong app on the cluster, because Service Fabric's upgrade API is keyed by `ApplicationTypeName` parsed from the package — not by anything in the .sfproj.

Neither outcome surfaces an error from Service Fabric: the deploy completes "successfully" and the user is left wondering why the just-published service didn't change. The fix is cheap and high-signal: when the override path is the chosen candidate AND its declared type differs from the .sfproj's, prompt the user with a modal warning before invoking `Deploy-FabricApplication.ps1`. The prompt is one-shot (not persisted) so silencing it for the current Publish doesn't bake in a permanent override of the safety check — every Publish revalidates.

### 1.3 Objective 3 — hardcoded `searchMaxDepth = 4` and the override blind-spot

Two distinct shortcomings of the current recursive-search fallback ([src/deploy/packageResolver.ts](src/deploy/packageResolver.ts#L229-L260)) motivate this objective:

1. **The depth literal is hardcoded.** [deployFlow.ts](src/deploy/deployFlow.ts#L157) passes `searchMaxDepth: 4` and `packageResolver.ts` defaults to `4` when the option is omitted. There is no way for a user with a legitimately-deep monorepo layout (e.g. `<repo>\artifacts\bin\<App>\<Configuration>\sfpkg\<AppType>\ApplicationManifest.xml` — six segments below the .sfproj) to nudge the resolver. Today their only escape hatch is `serviceFabric.deploy.packagePath`, but that hatch has its own blind spot (see (2)). Exposing the depth as a per-workspace setting closes the gap without re-architecting the resolver, and the existing `4` default is preserved so default-layout projects continue to resolve in O(1) sub-tree size.

2. **The override is never used as a search root.** When the user sets `serviceFabric.deploy.packagePath`, the resolver probes that path at depth 0 and depth 1 only (`// 1) Direct match.` and `// 2) Single immediate child ...`). On miss, control drops through to the next candidate (`<PackageLocation>`, `<OutputPath>`, defaults), and then — if all auto-discovered candidates also miss — to the recursive search rooted at `project.sfproj.directory`. The user's explicit "look here" hint is **discarded** for the recursive phase. The user-visible symptom is that setting `serviceFabric.deploy.packagePath` to `<repo>\artifacts\bin\<App>\<Configuration>` (where the manifest is two levels down at `sfpkg\<AppType>\ApplicationManifest.xml`) silently fails — the resolver never looks below depth 1 under the override, even though the user explicitly pointed at the right subtree.

The fix for (1) is purely plumbing: a new `serviceFabric.deploy.searchMaxDepth` setting wired into the resolver's existing `searchMaxDepth` option, defaulting to `4`. The fix for (2) is a small, focused resolver change: when the override candidate's direct + single-nested probes miss, treat the override path as the `searchRoot` for an additional bounded recursive search (using the same configurable depth) BEFORE continuing to the remaining candidates. Auto-discovered candidates keep their depth-0+1 semantics to preserve fast O(N) scanning of small drop trees and to avoid masking misconfigured `<OutputPath>` values.

## 2. Goals

Acceptance:

1. **Tier 1 expansion is always on.** A .sfproj declaring `<OutputPath>$(MSBuildProjectDirectory)\out\$(Configuration)\</OutputPath>` produces a probed candidate of `<sfprojDir>\out\Debug` (when `Configuration=Debug`), *before* the default `pkg\Debug` candidate is tried. The candidate's `source` label is `"sfproj <OutputPath> (expanded)"` so logs make the substitution visible.
2. **Conditional `<PropertyGroup>` blocks are evaluated.** `<PropertyGroup Condition="'$(Configuration)|$(Platform)' == 'Debug|AnyCPU'">` is honored for the simple equality / inequality cases against already-known properties. Unsupported / un-evaluable conditions cause the group to be **skipped** (not throw) and a single `logger.debug` line records the unresolved condition.
3. **Unresolved tokens are tolerated, not fatal.** A value like `$(NotKnown)\bin` after expansion still has a literal `$(NotKnown)` segment. The expander returns the partially-substituted string AND a `unresolved: string[]` array; the resolver passes such candidates through to the existence probe (which will simply return false — same as today) but logs `Unresolved MSBuild properties in <OutputPath>: $(NotKnown). Falling back to recursive search.` exactly once per Publish.
4. **Setting override is also expanded.** `serviceFabric.deploy.packagePath` accepts the same `$(...)` syntax against the same property map. Documented in the setting description.
5. **Tier 2 (MSBuild evaluator) is opt-in.** New setting `serviceFabric.deploy.useMsbuildPropertyEvaluator` (default `false`). When `true`, *and* Tier 1 leaves unresolved tokens in any candidate, *and* every existence probe fails, the resolver invokes `MSBuild.exe -getProperty:OutputPath,PackageLocation,BuildOutputPath -p:Configuration=<cfg>` and adds the returned values as additional candidates before the recursive-search fallback. Failing or missing MSBuild silently degrades to Tier 3 (current behavior). Telemetry records the spawn outcome.
6. **MSBuild evaluator results are cached.** Keyed by `(sfprojPath, sfprojMtimeMs, Configuration, Platform)`. Cache lifetime = process. A subsequent Publish of the same project / configuration in the same VS Code session reuses the cached property map. Cache is dropped when the .sfproj `mtime` changes.
7. **Pure module, fully unit-tested.** A new `src/project/msbuildPropertyExpander.ts` has zero dependencies on `vscode` / `fs` / `child_process`; the spawn lives in `src/build/msbuildEvaluator.ts` which depends on the existing `findMsBuild` from [src/build/msbuildLocator.ts](src/build/msbuildLocator.ts). Test coverage matches the existing [test/unit/packageResolver.test.ts](test/unit/packageResolver.test.ts) pattern: an in-memory property map + injected substitution-callback for the spawn boundary.
8. **No regression in existing flows.** All existing 295+ unit tests stay green. The default-layout case (`pkg\Debug\ApplicationManifest.xml`) still resolves via the default candidate without ever reaching the expander's substitution loop (because no `<OutputPath>` is declared in the typical .sfproj at all).
9. **No package-version bump in `package.json`.** Stays at the current release until the release script bumps it as part of `npm run release`.
10. **`CHANGELOG.md`** has a new `## 1.1.9` section above the existing `## 1.1.8`.
11. **Override application-type confirmation (Objective 2).** When all of the following hold, the resolver invokes a caller-supplied confirmation hook *before* returning the path:
    - The accepted candidate's `source` starts with `"serviceFabric.deploy.packagePath"` (covers both the bare label and its `" (expanded)"` / `" (nested)"` variants — see §5.7).
    - Exactly **one** `ApplicationManifest.xml` was located via that candidate (the resolver's existing single-hit paths: direct match, or single immediate child).
    - `ResolveOptions.expectedApplicationTypeName` is set (i.e. the deploy flow successfully parsed the .sfproj's source manifest).
    - The manifest at the chosen path is readable AND its `ApplicationTypeName` ≠ `expectedApplicationTypeName` (case-sensitive — Service Fabric application type names are case-sensitive on the cluster).

    The hook receives `{ path, declaredApplicationTypeName, expectedApplicationTypeName }` and returns a `Promise<boolean>` — `true` proceeds, `false` aborts the Publish with a clear "cancelled by user" error. The deploy flow's implementation is a modal `vscode.window.showWarningMessage` with buttons **"Continue Publish"** and **"Cancel Publish"** (default = Cancel, dismiss = Cancel). The decision is **not** persisted; every Publish that hits the same precondition re-prompts. When the manifest cannot be read, the resolver logs a single `debug` line and proceeds (existing behavior). When the hook is not supplied (e.g. unit tests, scripted callers), the resolver also proceeds — the safety net is purely a deploy-flow concern.
12. **Configurable recursive-search depth (Objective 3, part A).** New setting `serviceFabric.deploy.searchMaxDepth` (integer, default `4`, JSON-schema `minimum: 1`, `maximum: 16`). The deploy flow reads it via `vscode.workspace.getConfiguration('serviceFabric').get<number>('deploy.searchMaxDepth', 4)`, clamps it to the `[1, 16]` range (out-of-range values log a single `warn` line and fall back to `4`), and passes the result to `resolveApplicationPackageRoot` via the already-existing `ResolveOptions.searchMaxDepth`. With the default value, project-wide recursive-search behavior is byte-identical to today.
13. **Override path becomes a recursive-search root (Objective 3, part B).** When `serviceFabric.deploy.packagePath` is configured and that candidate's direct + single-immediate-child probes both miss, the resolver runs a bounded recursive search rooted **at the override path** (depth = `searchMaxDepth`) before continuing to the next auto-discovered candidate. Behavior on the result set:
    - **One hit** → return it with `source` label `"serviceFabric.deploy.packagePath (recursive search)"` (or `"serviceFabric.deploy.packagePath (expanded, recursive search)"` when Objective 1 expansion applied). Objective 2's `confirmOverrideTypeMatch` check then runs against this hit — the recursive walk does not bypass type validation.
    - **Multiple hits** → fed through `disambiguateHits` (the existing type-match → prompt → throw pipeline). Source labels carry through `"... (recursive search ...)"` so logs are self-explanatory.
    - **Zero hits** → continue to the next candidate; on full exhaustion, the project-wide recursive search (rooted at `searchRoot`, also using `searchMaxDepth`) runs as today. Auto-discovered candidates are NOT used as recursive-search roots — this objective is scoped to the user's explicit override.

## 3. Non-goals

- **Full MSBuild evaluation.** No item evaluation (`@(...)`), no metadata (`%(...)`), no `Choose/When/Otherwise`, no target execution, no transforms (`@(X->'%(Y)')`), no functions (`$([System.IO.Path]::Combine(...))`). Tier 1 is property-substitution only. The Tier 2 fallback delegates the full job to MSBuild itself.
- **Following `<Import Project="...">` chains.** Tier 1 does not parse `Microsoft.ServiceFabric.targets`, `Directory.Build.props`, or any other imported file. Properties defined exclusively in imports are unresolved by Tier 1 and surface as `unresolved` (which Tier 2 / Tier 3 then handles). Following imports recursively in pure TS is brittle (conditional imports, wildcard imports, SDK-resolved imports) and is the exact problem MSBuild itself solves — that's why Tier 2 exists.
- **Resolving SDK-style implicit properties.** `$(BaseOutputPath)`, `$(BaseIntermediateOutputPath)`, `$(IntermediateOutputPath)` come from the .NET SDK and only exist after target evaluation. Out of scope for Tier 1; covered by Tier 2 if the user opts in.
- **Cross-project property inheritance.** A .sfproj that depends on a sibling .csproj that defines `$(Foo)` does not get `$(Foo)` propagated into the .sfproj's property scope (MSBuild itself doesn't do this either — properties are per-project).
- **Mutating the .sfproj.** Read-only. The expander never writes back resolved values.
- **Supporting non-`==`/`!=` condition operators.** `<` `>` `And`/`Or` `Exists()` `HasTrailingSlash()` etc. are unsupported in Tier 1 — groups with such conditions are skipped (logged once at `debug`). The user can opt into Tier 2 if they need them.
- **Live property updates from `tasks.json` / launch profile.** Tier 1 reads the .sfproj only; it does not honor `-p:` overrides the user has wired into a custom Build task. Documented as a known limitation.
- **Other MSBuild project types.** The expander is invoked exclusively from the .sfproj resolver path. .csproj parsing for other features (e.g. service-host attach) is unchanged.
- **Application-type validation for auto-discovered candidates.** Objective 2 deliberately limits the type-mismatch prompt to the `serviceFabric.deploy.packagePath` override. The auto-discovered candidates (`<PackageLocation>`, `<OutputPath>`, `pkg\<cfg>`, etc.) cannot mismatch by construction — they're derived from the .sfproj's own properties. Adding the prompt there would generate false positives for projects whose source `ApplicationManifest.xml` is mid-edit (declared type renamed, package not yet rebuilt) and create alarm fatigue.
- **Persisting the user's "Continue Publish" choice.** The mismatch warning is intentionally re-prompted every Publish. Persisting (per-workspace or per-override) would defeat the safety check the first time the user changes apps without updating the setting, which is exactly the scenario the prompt exists to catch.
- **Auto-rewriting the setting on "Cancel Publish".** The prompt is a stop-gap, not a config editor. The user fixes the setting themselves in the resulting cancellation message (which surfaces the resolved path and the mismatch). A future "open settings" affordance is out of scope.
- **Validating against the live cluster's registered types.** The check is purely against the local source manifest's declared type; it does not query Service Fabric for the registered `ApplicationTypeName` list. Cluster-side validation is the SDK's job.
- **(Objective 3) Per-candidate recursive search for auto-discovered candidates.** `<PackageLocation>`, `<OutputPath>`, `pkg\<cfg>`, `bin\<cfg>\pkg`, `bin\<cfg>` keep their existing depth-0+1 probe semantics. Widening them would mask MSBuild output-path drift (a developer who renamed `<OutputPath>` and forgot to rebuild would see the resolver "find" the stale package from the old location) and would slow O(1) probes on small projects.
- **(Objective 3) Unbounded recursion.** `searchMaxDepth` is clamped to `[1, 16]`. Sixteen is a deliberately-loose upper bound — enough for any plausible monorepo, far below the level at which an accidental `node_modules`-style explosion becomes a real performance problem. Values outside the range emit a `warn` log and fall back to the default `4`; the resolver never executes an unbounded walk.
- **(Objective 3) Honoring depth `0`.** A literal `0` would mean "never recurse," which is already the per-candidate default and is not a useful new behavior. `minimum: 1` in the JSON schema rules it out; users wanting that behavior should leave `serviceFabric.deploy.packagePath` empty and let the auto-discovered candidates do their job.
- **(Objective 3) Different depths for the project-wide and override-rooted searches.** A single setting governs both. Splitting into two would expose a configuration cliff ("why do I have two depth settings?") with no concrete user demand. The override-rooted search is bounded by the override path the user typed, so the same `4` default that suffices for the project-wide search is even more conservative under an override.

## 4. Surface area at a glance

| New / changed | Where | Responsibility |
|---|---|---|
| `src/project/msbuildPropertyExpander.ts` | **new file** | Pure expander. Exports `expandMsbuildValue(value, properties, opts?)`, `buildPropertyMap(propertyGroups, intrinsics, configuration, platform)`, `evaluateSimpleCondition(expr, properties)`. Zero `vscode`/`fs`/`child_process` imports. |
| `src/build/msbuildEvaluator.ts` | **new file** | Tier 2 thin wrapper. Spawns `MSBuild.exe -getProperty:...`, parses the output, caches by `(sfprojPath, mtime, Configuration, Platform)`. Uses `findMsBuild` from [src/build/msbuildLocator.ts](src/build/msbuildLocator.ts). |
| `parseSfProj` | [src/project/sfprojParser.ts](src/project/sfprojParser.ts) | Collect *all* scalar children of every `<PropertyGroup>` (with their `Condition` attribute) into a new `propertyGroups: RawPropertyGroup[]` field on `SfProjFile`. The four currently-named scalars (`ProjectGuid`, `ProjectVersion`, `ApplicationPackageRootFolder`, `OutputPath`, `PackageLocation`) keep their dedicated fields — populated from the *expanded* map so existing call sites get expansion for free. |
| `SfProjFile` | [src/project/sfprojModel.ts](src/project/sfprojModel.ts) | Add `propertyGroups: RawPropertyGroup[]`, `properties: ReadonlyMap<string, string>` (post-expansion), `unresolvedProperties: string[]`. |
| `CollectCandidatesInput` | [src/deploy/packageResolver.ts](src/deploy/packageResolver.ts) | Add optional `properties?: ReadonlyMap<string, string>` and `expand?: (value: string) => { value: string; unresolved: string[] }`. When supplied, `outputPath` / `packageLocation` / `settingOverride` are run through `expand` before `isAbsolute` / `join`. Source labels gain `" (expanded)"` when substitution actually happened. Backward-compatible: omit and behavior is byte-identical to today. |
| `resolveApplicationPackageRoot` | same file | When the candidate sweep finishes with no hit *and* `options.evaluateMsbuildProperties` is set, await the supplied callback to add Tier 2 candidates and re-run the sweep before falling through to the recursive search. **Objective 2:** after a single-hit accept, when the candidate came from the `serviceFabric.deploy.packagePath` source AND `expectedApplicationTypeName` is set AND the chosen manifest's declared type differs, await `options.onOverrideTypeMismatch` and throw `PublishCancelledByUserError` when it returns `false`. **Objective 3:** when the override candidate's direct + nested probes miss, run a bounded recursive search rooted at the override path (depth = `options.searchMaxDepth`) before continuing; single hit returns with `"serviceFabric.deploy.packagePath (recursive search)"`-style source, multi-hit goes through `disambiguateHits`. |
| `ResolveOptions.onOverrideTypeMismatch` | same file | **Objective 2** confirmation hook. Optional; resolver proceeds silently when omitted. See §5.7 for the full contract. |
| `ResolveOptions.searchMaxDepth` | same file | **Objective 3** — already declared; now driven end-to-end by `serviceFabric.deploy.searchMaxDepth` and also consumed by the new override-rooted recursive search. Default remains `4`. |
| `deployFlow.ts` | [src/deploy/deployFlow.ts](src/deploy/deployFlow.ts) | Build the property map from the parsed .sfproj + `Configuration` and pass it (plus an `expand` callback) into `collectPackageRootCandidates`. When the `useMsbuildPropertyEvaluator` setting is on, plumb a Tier-2 `evaluateMsbuildProperties` callback that delegates to `msbuildEvaluator.ts`. **Objective 2:** wire `onOverrideTypeMismatch` to a modal `vscode.window.showWarningMessage` and convert `PublishCancelledByUserError` into the existing "Publish cancelled" UX (output-channel line + early return, no telemetry-fail). **Objective 3:** read `serviceFabric.deploy.searchMaxDepth`, clamp to `[1, 16]`, and pass through `ResolveOptions.searchMaxDepth` (replacing today's hardcoded `4`). |
| `serviceFabric.deploy.useMsbuildPropertyEvaluator` | package.json `contributes.configuration.properties` | Boolean, default `false`. Documented per §2.5. |
| `serviceFabric.deploy.searchMaxDepth` | same | **Objective 3.** Integer, default `4`, range `[1, 16]`. Description: "Maximum directory depth for the recursive `ApplicationManifest.xml` search used as a last resort when explicit candidates don't resolve. Also applied when `serviceFabric.deploy.packagePath` is set and its direct/single-nested probes miss — in that case the resolver recurses under the override path itself. Increase this for deep monorepo layouts where the package drop lives many levels under the .sfproj or the override." |
| `serviceFabric.deploy.packagePath` | same | Description amended: "Accepts MSBuild property references like `$(MSBuildProjectName)` and `$(Configuration)`; they are expanded against the project's PropertyGroup values." |
| Tests | `test/unit/msbuildPropertyExpander.test.ts` (**new**), additions to [test/unit/packageResolver.test.ts](test/unit/packageResolver.test.ts) and [test/unit/sfprojParser.test.ts](test/unit/sfprojParser.test.ts) | See §8. Objective 2 adds at least 6 new cases to `packageResolver.test.ts`. |
| Docs | [docs/HOWTO.md](docs/HOWTO.md) §10 (Deployment), §12 settings rows; [CHANGELOG.md](CHANGELOG.md); [README.md](README.md) *Features* bullet | See §9. |

## 5. Implementation

### 5.1 New module — `src/project/msbuildPropertyExpander.ts`

Pure (no `vscode` / `fs` / `child_process` imports). Drives Tier 1.

```ts
/**
 * Pure MSBuild $(Property) expander for .sfproj `<PropertyGroup>` scalars.
 *
 * Tier 1 of the package-root resolution chain (Plan 1.1.9). Handles the
 * common shapes seen in real-world .sfproj files:
 *
 *   <OutputPath>$(MSBuildProjectDirectory)\out\$(Configuration)\</OutputPath>
 *   <PackageLocation>$(BuildOutputPath)\bin\$(MSBuildProjectName)\$(Configuration)\</PackageLocation>
 *
 * Does NOT handle: item refs (@(X)), metadata (%(X)), functions
 * ($([System.IO.Path]::Combine(...))), Choose/When/Otherwise, target
 * execution, or properties defined exclusively in imported targets files.
 * Those cases are the responsibility of Tier 2 (MSBuild -getProperty).
 */

export interface RawPropertyGroup {
    /** Verbatim Condition="..." attribute, or undefined when unconditional. */
    readonly condition?: string;
    /**
     * Scalar child elements of the PropertyGroup, preserving source order so
     * later definitions override earlier ones (matching MSBuild semantics).
     */
    readonly properties: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

export interface PropertyMapInput {
    /** All <PropertyGroup> blocks from the .sfproj, in source order. */
    readonly propertyGroups: readonly RawPropertyGroup[];
    /** Intrinsic properties seeded by the caller (MSBuildProjectName, etc.). */
    readonly intrinsics: ReadonlyMap<string, string>;
    /** Active configuration (drives condition evaluation + $(Configuration) seed). */
    readonly configuration: string;
    /** Active platform (default 'AnyCPU' for .sfproj). */
    readonly platform?: string;
}

export interface ExpandResult {
    readonly value: string;
    /** Distinct $(Name) tokens left after `maxIterations`. Empty on full success. */
    readonly unresolved: readonly string[];
}

const TOKEN_RE = /\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g;

/**
 * Build the effective property map by walking PropertyGroup blocks in source
 * order, skipping conditional groups whose condition does not evaluate to true
 * against the properties known so far. Intrinsics + Configuration + Platform
 * are seeded first so they're visible to every group's condition.
 */
export function buildPropertyMap(input: PropertyMapInput): ReadonlyMap<string, string> {
    const map = new Map<string, string>();
    for (const [k, v] of input.intrinsics) map.set(k, v);
    map.set('Configuration', input.configuration);
    map.set('Platform', input.platform ?? 'AnyCPU');

    for (const pg of input.propertyGroups) {
        if (pg.condition !== undefined) {
            const verdict = evaluateSimpleCondition(pg.condition, map);
            if (verdict !== true) continue; // false OR unevaluable → skip
        }
        for (const { name, value } of pg.properties) {
            // Property values can themselves reference earlier properties;
            // expand them as we set so downstream lookups see resolved text.
            map.set(name, expandMsbuildValue(value, map).value);
        }
    }
    return map;
}

/**
 * Iteratively expand $(Name) tokens against `properties`. Bounded by
 * `maxIterations` (default 16) to defeat pathological cycles. Returns the
 * distinct unresolved tokens so callers can log a single actionable line.
 */
export function expandMsbuildValue(
    value: string,
    properties: ReadonlyMap<string, string>,
    opts: { readonly maxIterations?: number } = {}
): ExpandResult {
    const max = opts.maxIterations ?? 16;
    let current = value;
    for (let i = 0; i < max; i++) {
        let changed = false;
        const next = current.replace(TOKEN_RE, (match, name: string) => {
            const v = properties.get(name);
            if (v === undefined) return match;
            changed = true;
            return v;
        });
        if (!changed) break;
        current = next;
    }
    const unresolved = new Set<string>();
    for (const m of current.matchAll(TOKEN_RE)) unresolved.add(m[1]);
    return { value: current, unresolved: [...unresolved] };
}

/**
 * Evaluate the subset of MSBuild Condition expressions we support:
 *   '<lhs>' == '<rhs>'
 *   '<lhs>' != '<rhs>'
 * where each side may be a literal or a $(Property) ref. Both sides are
 * expanded against `properties` before comparison; comparison is
 * case-insensitive (MSBuild semantics for `==`/`!=`).
 *
 * Returns:
 *   true  → group should be applied
 *   false → group should be skipped (condition is well-formed and false)
 *   'unevaluable' → unsupported syntax; caller should skip + log debug
 */
export function evaluateSimpleCondition(
    condition: string,
    properties: ReadonlyMap<string, string>
): true | false | 'unevaluable' {
    const trimmed = condition.trim();
    const m = /^'([^']*)'\s*(==|!=)\s*'([^']*)'$/.exec(trimmed);
    if (!m) return 'unevaluable';
    const lhs = expandMsbuildValue(m[1], properties).value.toLowerCase();
    const rhs = expandMsbuildValue(m[3], properties).value.toLowerCase();
    return m[2] === '==' ? lhs === rhs : lhs !== rhs;
}

/**
 * Convenience for callers that already have the expanded property map and
 * want a one-shot expander callback to hand to `collectPackageRootCandidates`.
 */
export function makeExpander(
    properties: ReadonlyMap<string, string>
): (value: string) => ExpandResult {
    return (value: string) => expandMsbuildValue(value, properties);
}
```

### 5.2 Parser changes — `src/project/sfprojParser.ts`

Add a single helper plus three new fields on the parsed model. The dedicated `outputPath` / `packageLocation` fields are populated from the *expanded* map, so existing consumers (the resolver, project view, etc.) get expansion transparently.

```ts
function collectRawPropertyGroups(propertyGroups: any[]): RawPropertyGroup[] {
    const out: RawPropertyGroup[] = [];
    for (const pg of propertyGroups) {
        const condition = typeof pg['@_Condition'] === 'string' ? pg['@_Condition'] : undefined;
        const properties: { name: string; value: string }[] = [];
        for (const [key, raw] of Object.entries(pg)) {
            if (key.startsWith('@_') || key === '#text') continue;
            // PropertyGroup scalars are always strings; skip nested elements
            // (which fast-xml-parser materializes as objects) — they aren't
            // properties in the MSBuild sense.
            if (typeof raw === 'string') properties.push({ name: key, value: raw });
        }
        out.push({ condition, properties });
    }
    return out;
}
```

In `parseSfProj`:

```ts
const rawPropertyGroups = collectRawPropertyGroups(propertyGroups);
const intrinsics = new Map<string, string>([
    ['MSBuildProjectName', path.basename(absPath, path.extname(absPath))],
    ['MSBuildProjectFile', path.basename(absPath)],
    ['MSBuildProjectExtension', path.extname(absPath)],
    ['MSBuildProjectDirectory', directory],
    ['MSBuildThisFileDirectory', directory + path.sep],
    ['MSBuildThisFileFullPath', absPath]
]);
// Configuration is unknown at parse time — seed with `Debug` so PropertyGroup
// conditions that gate on it have a sensible default. Callers that need
// per-configuration expansion (the deploy flow) re-invoke `buildPropertyMap`
// with the user's chosen configuration before resolving package paths.
const properties = buildPropertyMap({
    propertyGroups: rawPropertyGroups,
    intrinsics,
    configuration: 'Debug'
});

const outputPathRaw = firstScalar(propertyGroups, 'OutputPath');
const packageLocationRaw = firstScalar(propertyGroups, 'PackageLocation');
const outputPath = outputPathRaw ? expandMsbuildValue(outputPathRaw, properties).value : undefined;
const packageLocation = packageLocationRaw ? expandMsbuildValue(packageLocationRaw, properties).value : undefined;
```

The unresolved-token aggregation lives in the deploy flow (§5.4), not the parser, so the parser stays side-effect-free.

### 5.3 Resolver changes — `src/deploy/packageResolver.ts`

Two surgical additions, both backward-compatible:

```ts
export interface CollectCandidatesInput {
    readonly sfprojDir: string;
    readonly configuration?: string;
    readonly outputPath?: string;
    readonly packageLocation?: string;
    readonly settingOverride?: string;
    /**
     * Optional MSBuild $(Property) expander applied to outputPath /
     * packageLocation / settingOverride before the absolute-vs-relative
     * decision. When omitted, values are passed through verbatim (current
     * behavior). When supplied and substitution actually changed the value,
     * the resulting candidate's `source` gains a " (expanded)" suffix so
     * resolver logs make the substitution visible.
     */
    readonly expand?: (value: string) => { value: string; unresolved: readonly string[] };
}
```

The `push` helper inside `collectPackageRootCandidates` is updated to apply `input.expand` once per source:

```ts
const push = (raw: string | undefined, source: string): void => {
    if (!raw) return;
    let value = raw.trim();
    if (!value) return;
    let suffix = '';
    if (input.expand) {
        const { value: expanded, unresolved } = input.expand(value);
        if (expanded !== value) {
            value = expanded;
            suffix = ' (expanded)';
        }
        // Unresolved tokens are NOT a hard error here — the candidate path
        // will simply fail its existence probe. The deploy flow logs the
        // aggregated unresolved set once per Publish (see §5.4).
        void unresolved;
    }
    const abs = isAbsolute(value) ? value : join(input.sfprojDir, value);
    const norm = abs.replace(/[\\/]+$/, '');
    const exists = out.some(c => c.path.toLowerCase() === norm.toLowerCase());
    if (!exists) out.push({ path: norm, source: source + suffix });
};
```

And one new optional field on `ResolveOptions` for Tier 2:

```ts
export interface ResolveOptions {
    // ...existing fields...
    /**
     * Tier 2 hook (Plan 1.1.9). When supplied AND every passed-in candidate
     * fails its existence probe, the resolver awaits this callback to obtain
     * additional candidates (typically from `MSBuild -getProperty:`) and
     * re-runs the candidate sweep before falling through to `searchRoot`.
     * Failing or returning `[]` is non-fatal — the recursive search still
     * runs.
     */
    readonly evaluateMsbuildProperties?: () => Promise<readonly PackageRootCandidate[]>;
}
```

The sweep is refactored into a private `sweepCandidates(candidates, fs, options): Promise<ResolveResult | undefined>` so it can be invoked twice — once with the original candidates, once with the appended Tier 2 candidates — without duplicating the disambiguation logic.

### 5.4 Wiring into `deployFlow.ts`

```ts
// 1.1.9 — build the post-expansion property map for THIS Publish, scoped
// to the user's chosen configuration. parseSfProj seeded its own map with
// `Debug` so the parsed `outputPath` / `packageLocation` strings are
// already resolved for the Debug case; we re-resolve here so a Release
// publish sees its own Configuration-conditioned PropertyGroups.
const configuration = 'Debug'; // unchanged for now; tracked separately
const properties = buildPropertyMap({
    propertyGroups: project.sfproj.propertyGroups,
    intrinsics: project.sfproj.intrinsics,
    configuration
});
const expand = makeExpander(properties);

// Aggregate any unresolved tokens across the three opt-in sources; log once.
const unresolvedTokens = new Set<string>();
const probe = (raw: string | undefined): string | undefined => {
    if (!raw) return raw;
    const r = expand(raw);
    for (const u of r.unresolved) unresolvedTokens.add(u);
    return r.value;
};

const settingOverride = vscode.workspace
    .getConfiguration('serviceFabric')
    .get<string>('deploy.packagePath');
const candidates = collectPackageRootCandidates(
    {
        sfprojDir: project.sfproj.directory,
        configuration,
        outputPath: project.sfproj.outputPath,    // already expanded by parser for Debug
        packageLocation: project.sfproj.packageLocation,
        settingOverride: probe(settingOverride),  // expand the user's override
        expand                                     // Re-applied by the resolver as a safety net
    },
    path.join,
    path.isAbsolute
);
if (unresolvedTokens.size > 0) {
    logger.info(
        `Unresolved MSBuild properties in package-path candidates: ${[...unresolvedTokens]
            .map(t => `$(${t})`)
            .join(', ')}. Falling back to recursive search${
                vscode.workspace.getConfiguration('serviceFabric').get<boolean>('deploy.useMsbuildPropertyEvaluator')
                    ? ' (after MSBuild -getProperty)'
                    : ''
            }.`
    );
}

// Tier 2 (opt-in)
const useEvaluator = vscode.workspace
    .getConfiguration('serviceFabric')
    .get<boolean>('deploy.useMsbuildPropertyEvaluator', false);
const evaluateMsbuildProperties = useEvaluator
    ? () => evaluateViaMsbuild(project.sfproj.path, configuration, logger)
    : undefined;

const resolved = await resolveApplicationPackageRoot(
    candidates,
    createProbeFs(),
    {
        searchRoot: project.sfproj.directory,
        searchMaxDepth: 4,
        expectedApplicationTypeName: project.applicationManifest?.applicationTypeName,
        onAmbiguous: hits => promptForPackageRoot(hits, logger),
        evaluateMsbuildProperties
    }
);
```

`evaluateViaMsbuild` lives in `src/build/msbuildEvaluator.ts` (§5.5). The `onOverrideTypeMismatch` wiring for Objective 2 follows below the existing options call (see §5.7).

Additional wiring in `deployFlow.ts` for Objective 2:

```ts
// 1.1.9 Objective 2 — modal confirmation when the user's explicit
// serviceFabric.deploy.packagePath override resolves to a single manifest
// whose ApplicationTypeName differs from the .sfproj's own. Not persisted —
// every Publish re-asks so a wrong-app deploy can't be silently re-confirmed.
const onOverrideTypeMismatch = async (info: {
    path: string;
    declaredApplicationTypeName?: string;
    expectedApplicationTypeName: string;
}): Promise<boolean> => {
    const declared = info.declaredApplicationTypeName ?? '<unreadable>';
    const choice = await vscode.window.showWarningMessage(
        `serviceFabric.deploy.packagePath points at a package whose ApplicationTypeName is '${declared}', ` +
        `but the project declares '${info.expectedApplicationTypeName}'.\n\n` +
        `Path: ${info.path}\n\n` +
        `Continuing will publish the wrong application. This choice is not remembered.`,
        { modal: true },
        'Continue Publish',
        'Cancel Publish'
    );
    const proceed = choice === 'Continue Publish';
    logger.info(
        `Override application-type mismatch (declared='${declared}', expected='${info.expectedApplicationTypeName}'): ` +
            (proceed ? 'user chose Continue Publish.' : 'user chose Cancel Publish (or dismissed).')
    );
    return proceed;
};
```

And append it to the resolver options:

```ts
const resolved = await resolveApplicationPackageRoot(
    candidates,
    createProbeFs(),
    {
        searchRoot: project.sfproj.directory,
        searchMaxDepth: 4,
        expectedApplicationTypeName: project.applicationManifest?.applicationTypeName,
        onAmbiguous: hits => promptForPackageRoot(hits, logger),
        evaluateMsbuildProperties,
        onOverrideTypeMismatch
    }
);
```

The `PublishCancelledByUserError` thrown by the resolver (see §5.7) is caught by the existing deploy-flow `try/catch`, logged at `info` (not `error`) and surfaced as `Publish cancelled by user — application type did not match.` in the output channel. No `vscode.window.showErrorMessage`; cancellation isn't a failure.

### 5.5 New module — `src/build/msbuildEvaluator.ts`

Tier 2 wrapper. Spawns `MSBuild.exe` with `-getProperty:` (MSBuild 17.4+; falls back to `-t:GetProperty` inline target generation on older MSBuild — implementation note, not a separate code path the user needs to know about).

Responsibilities:

- Locate `MSBuild.exe` via the existing `findMsBuild()` helper.
- Build args: `[sfprojPath, '-nologo', '-noconlog', '-getProperty:OutputPath,PackageLocation,BuildOutputPath', '-p:Configuration=' + cfg, '-p:Platform=AnyCPU']`.
- Capture stdout JSON-or-line output, parse the three properties.
- Cache by `(sfprojPath, mtimeMs, configuration, platform)` for the lifetime of the extension host. Cache hit returns synchronously.
- Convert each non-empty property value to a `PackageRootCandidate`:
  - Absolute → use as-is, source `"MSBuild -getProperty:OutputPath"` (etc.).
  - Relative → joined to `sfprojDir`.
- Timeout: 15 s per spawn; hard-killed past that. Logs a warning and returns `[]` so the recursive search still runs.

The module exports a single function:

```ts
export async function evaluateViaMsbuild(
    sfprojPath: string,
    configuration: string,
    logger: Logger,
    options?: { readonly platform?: string; readonly timeoutMs?: number }
): Promise<PackageRootCandidate[]>;
```

A small process-scoped cache map keyed by the tuple above. Cache invalidation = stat the .sfproj on each call; mtime change drops the entry.

### 5.6 Settings additions — `package.json`

*(No new setting is introduced for Objective 2 — see §0 rationale.)*

Objective 3 introduces one setting:

```json
"serviceFabric.deploy.searchMaxDepth": {
    "type": "integer",
    "default": 4,
    "minimum": 1,
    "maximum": 16,
    "description": "Maximum directory depth for the recursive ApplicationManifest.xml search used as a last resort when explicit candidates (serviceFabric.deploy.packagePath, <PackageLocation>, <OutputPath>, pkg\\<Configuration>, ...) do not resolve. Also applied when serviceFabric.deploy.packagePath is set and its direct/single-nested probes miss \u2014 in that case the resolver recurses under the override path itself. Default is 4. Increase this for deep monorepo layouts (e.g. <repo>\\artifacts\\bin\\<App>\\<Configuration>\\sfpkg\\<AppType>\\). Values outside [1, 16] fall back to the default and emit a warning."
}
```


```json
"serviceFabric.deploy.useMsbuildPropertyEvaluator": {
    "type": "boolean",
    "default": false,
    "description": "When true, fall back to invoking MSBuild.exe -getProperty: to resolve <OutputPath>/<PackageLocation> values that reference properties defined in imported targets (e.g. Microsoft.ServiceFabric.targets, Directory.Build.props). The simple in-extension expander handles all properties declared in the .sfproj's own <PropertyGroup> blocks; enable this only when your build relies on imported-property expansion AND the recursive search is missing the package. Adds 1–3 s per Publish on cold cache."
}
```

`serviceFabric.deploy.packagePath` description amended:

> Override the application package path passed to Deploy-FabricApplication.ps1. Useful when MSBuild outputs the package somewhere other than the standard 'pkg\\<Configuration>\\' (and the .sfproj's <OutputPath>/<PackageLocation>) location — e.g. monorepo drops to a sibling folder. Accepts an absolute path or a path relative to the .sfproj directory. **MSBuild property references (`$(MSBuildProjectName)`, `$(Configuration)`, etc.) are expanded against the .sfproj's PropertyGroup values.** When this setting resolves to a package whose ApplicationTypeName does not match the project's declared type, a modal warning prompts before deploy (not persisted). Leave empty to auto-detect.

### 5.7 Override application-type confirmation (Objective 2)

The behavior change is concentrated in `resolveApplicationPackageRoot` ([src/deploy/packageResolver.ts](src/deploy/packageResolver.ts)) and a single new options field. Everything else (the `ProbeFs.readApplicationTypeName` shim, the source-label prefix check, the deploy-flow modal) is wiring.

**New option on `ResolveOptions`:**

```ts
export interface ResolveOptions {
    // ...existing fields...

    /**
     * Confirmation hook invoked when the resolver accepts a candidate sourced
     * from `serviceFabric.deploy.packagePath` (the user's explicit override),
     * exactly one ApplicationManifest.xml was found (direct match or single
     * immediate child), AND the manifest's declared `ApplicationTypeName`
     * does NOT match `expectedApplicationTypeName`.
     *
     * Receives the resolved path, the declared type (undefined when the
     * manifest could not be parsed — in which case the hook is NOT invoked
     * and the resolver proceeds), and the expected type. Returns `true` to
     * proceed with the resolved path, `false` to abort.
     *
     * On `false`, the resolver throws `PublishCancelledByUserError` — a
     * named subclass of `Error` so deploy-flow callers can distinguish a
     * deliberate cancellation from a true resolution failure.
     *
     * Skipped silently when:
     *   - `expectedApplicationTypeName` is undefined,
     *   - the manifest's type cannot be read (logged at debug),
     *   - the declared type equals the expected type (case-sensitive),
     *   - the accepted candidate's source does not start with
     *     'serviceFabric.deploy.packagePath',
     *   - this hook is undefined (e.g. scripted callers, unit tests).
     */
    readonly onOverrideTypeMismatch?: (info: {
        readonly path: string;
        readonly declaredApplicationTypeName?: string;
        readonly expectedApplicationTypeName: string;
    }) => Promise<boolean>;
}

export class PublishCancelledByUserError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PublishCancelledByUserError';
    }
}
```

**Resolver loop change.** Both single-hit return points (`// 1) Direct match.` and `// 2) Single immediate child ...`) gain a single pre-return call to a new private helper. The multi-hit path is unchanged — `disambiguateHits` already enforces type match, and a forced re-prompt on top of its auto-select would defeat the user's prior disambiguation.

```ts
// 1) Direct match.
if (await containsManifest(fs, candidate.path)) {
    await confirmOverrideTypeMatch(
        fs,
        candidate,
        candidate.path,
        options
    );
    return { path: candidate.path, source: candidate.source };
}

// 2) Single immediate child with the manifest.
// ...existing hit-collection loop...
if (hits.length === 1) {
    await confirmOverrideTypeMatch(
        fs,
        candidate,
        hits[0],
        options
    );
    return { path: hits[0], source: `${candidate.source} (nested)` };
}
```

**New private helper** (in the same file, alongside `disambiguateHits`):

```ts
/**
 * Objective 2 (Plan 1.1.9). Validate the chosen single-manifest candidate's
 * declared ApplicationTypeName against the source .sfproj's expected type,
 * but ONLY when the candidate came from the user's explicit
 * serviceFabric.deploy.packagePath override. Auto-discovered candidates are
 * exempt by design (see Plan 1.1.9 §3).
 *
 * Behavior matrix:
 *   - candidate.source not the override         -> no-op
 *   - options.expectedApplicationTypeName unset  -> no-op
 *   - options.onOverrideTypeMismatch unset       -> no-op
 *   - manifest type unreadable                   -> log debug, no-op
 *   - types match (case-sensitive)               -> no-op
 *   - types differ AND hook returns true         -> proceed
 *   - types differ AND hook returns false        -> throw PublishCancelledByUserError
 */
async function confirmOverrideTypeMatch(
    fs: ProbeFs,
    candidate: PackageRootCandidate,
    resolvedPath: string,
    options: ResolveOptions
): Promise<void> {
    if (!options.onOverrideTypeMismatch) return;
    if (!options.expectedApplicationTypeName) return;
    if (!candidate.source.startsWith('serviceFabric.deploy.packagePath')) return;
    if (!fs.readApplicationTypeName) return;

    const manifestPath = joinPosix(resolvedPath, 'ApplicationManifest.xml');
    const declared = await fs.readApplicationTypeName(manifestPath);
    if (declared === undefined) {
        // Couldn't parse — don't block the deploy on a check we can't perform.
        // The SDK will surface its own parse error downstream if relevant.
        return;
    }
    if (declared === options.expectedApplicationTypeName) return;

    const proceed = await options.onOverrideTypeMismatch({
        path: resolvedPath,
        declaredApplicationTypeName: declared,
        expectedApplicationTypeName: options.expectedApplicationTypeName
    });
    if (!proceed) {
        throw new PublishCancelledByUserError(
            `Publish cancelled — serviceFabric.deploy.packagePath resolved to a package with ApplicationTypeName '${declared}', expected '${options.expectedApplicationTypeName}'. Path: ${resolvedPath}.`
        );
    }
}
```

**Source-label prefix check** — the comparison is `startsWith('serviceFabric.deploy.packagePath')` rather than strict equality because Objective 1 may append `" (expanded)"` to the label when MSBuild property substitution rewrote the override before probing, and the single-immediate-child path appends `" (nested)"`. Both rewritten forms still represent the user's override and must be validated.

**Why `confirmOverrideTypeMatch` lives in the resolver, not the deploy flow** — the resolver is the only place that knows which candidate won. Hoisting the check to the deploy flow would require leaking the chosen `source` (already done — returned in `ResolveResult`) *and* reading the manifest a second time. Keeping the check inline avoids the duplicate parse and naturally extends to non-VSCode callers (e.g. the smoke-test harness in [scripts/smoke-cluster.ts](scripts/smoke-cluster.ts)) which can supply their own non-interactive `onOverrideTypeMismatch` for CI use.

### 5.8 Configurable depth + override-rooted recursive search (Objective 3)

**Setting plumbing (deploy flow).** Add to the top of the deploy flow's resolver setup:

```ts
// 1.1.9 Objective 3 — read configurable recursive-search depth.
const configuredDepth = vscode.workspace
    .getConfiguration('serviceFabric')
    .get<number>('deploy.searchMaxDepth', 4);
const searchMaxDepth =
    Number.isInteger(configuredDepth) && configuredDepth >= 1 && configuredDepth <= 16
        ? configuredDepth
        : (logger.warn(
              `serviceFabric.deploy.searchMaxDepth=${configuredDepth} is out of range [1, 16]; using default 4.`
          ),
          4);
```

Replace the existing hardcoded `searchMaxDepth: 4` in the `resolveApplicationPackageRoot` options with the computed value. No other deploy-flow changes for part A.

**Resolver change for part B — override as a search root.** Inside the per-candidate `for` loop in `resolveApplicationPackageRoot`, after the existing hit-collection block falls through with `hits.length === 0`, add a guarded recursive-search step that fires only for the override candidate:

```ts
// ...inside the per-candidate loop, after the `hits.length === 0` fallthrough...

// 2b) Objective 3 — the user's explicit override gets a bounded recursive
//     search rooted at its own path before we move on to the next candidate.
//     Auto-discovered candidates intentionally skip this to keep MSBuild
//     output-path bugs visible (a stale <OutputPath> shouldn't be "rescued"
//     by recursing under it).
if (
    candidate.source.startsWith('serviceFabric.deploy.packagePath') &&
    options.searchMaxDepth !== undefined && options.searchMaxDepth >= 1
) {
    const recursiveHits = await searchForManifest(
        fs,
        candidate.path,
        options.searchMaxDepth
    );
    if (recursiveHits.length === 1) {
        await confirmOverrideTypeMatch(
            fs,
            candidate,
            recursiveHits[0],
            options
        );
        return {
            path: recursiveHits[0],
            source: `${candidate.source} (recursive search)`
        };
    }
    if (recursiveHits.length > 1) {
        const disambiguated = await disambiguateHits(
            fs,
            recursiveHits,
            options.expectedApplicationTypeName,
            options.onAmbiguous
        );
        if (disambiguated) {
            // Type-validated by disambiguateHits already; no separate
            // confirmOverrideTypeMatch call needed.
            return {
                path: disambiguated.path,
                source: `${candidate.source} (recursive search ${disambiguated.sourceSuffix})`
            };
        }
        const labelled = await describeHits(fs, recursiveHits);
        throw new Error(
            `Multiple ApplicationManifest.xml files found under override ${candidate.path}: ${labelled}.${
                options.expectedApplicationTypeName
                    ? ` None matched expected ApplicationTypeName '${options.expectedApplicationTypeName}'.`
                    : ''
            } Narrow serviceFabric.deploy.packagePath or reduce serviceFabric.deploy.searchMaxDepth.`
        );
    }
    // zero hits — fall through to the next candidate as today.
}
```

**Why the source-label prefix check?** The same `startsWith('serviceFabric.deploy.packagePath')` test used by Objective 2 (§5.7) is reused. It correctly matches the bare label and the Objective-1 `" (expanded)"` rewrite. Strict equality would miss the expanded form; substring match (`includes(...)`) would over-match a hypothetical future candidate whose source description happened to mention the setting name.

**Why pre-flight `options.searchMaxDepth !== undefined && >= 1`?** Belt-and-suspenders for non-VSCode callers (unit tests, scripted harnesses) who omit `searchMaxDepth`. The deploy-flow always supplies it, but a missing value should be a no-op rather than a recursion at the resolver's default `4` (which would be a surprising new behavior for callers that haven't opted in). When the deploy flow sets it, it's always `>= 1`.

**Project-wide recursive-search depth.** The existing last-resort search at the bottom of `resolveApplicationPackageRoot` already reads `options.searchMaxDepth ?? 4` ([src/deploy/packageResolver.ts](src/deploy/packageResolver.ts#L234)). With Objective 3's plumbing, the deploy flow passes the configured value through unchanged. No code change in that block.

**Interaction with Objective 2.** The override-rooted recursive search calls `confirmOverrideTypeMatch` on its single-hit return, exactly like the direct and single-nested return paths in §5.7. The multi-hit path goes through `disambiguateHits`, which already enforces type match — no additional `confirmOverrideTypeMatch` call (would be redundant and would risk double-prompting).

**Interaction with Objective 1.** When `serviceFabric.deploy.packagePath` uses `$(...)` syntax, Objective 1 expands it before `collectPackageRootCandidates` produces the candidate. The candidate's `source` becomes `"serviceFabric.deploy.packagePath (expanded)"`, and the `startsWith` check still matches. The combined label after a successful recursive search is `"serviceFabric.deploy.packagePath (expanded) (recursive search)"` — verbose but self-documenting in logs.

## 6. Algorithm walk-through (end-to-end)

For a .sfproj declaring:

```xml
<PropertyGroup>
  <BuildOutputPath>$(MSBuildProjectDirectory)\..\out\</BuildOutputPath>
</PropertyGroup>
<PropertyGroup Condition="'$(Configuration)' == 'Debug'">
  <OutputPath>$(BuildOutputPath)bin\$(MSBuildProjectName)\$(Configuration)\</OutputPath>
</PropertyGroup>
<PropertyGroup Condition="'$(Configuration)' == 'Release'">
  <OutputPath>$(BuildOutputPath)bin\$(MSBuildProjectName)\Rel\</OutputPath>
</PropertyGroup>
```

Publish with `Configuration=Debug`, sfproj at `Q:\Repos\MyApp\MyApp.sfproj`:

1. **Parser** seeds intrinsics: `MSBuildProjectName=MyApp`, `MSBuildProjectDirectory=Q:\Repos\MyApp`, etc. Walks groups in order:
   - PG #1 (unconditional): sets `BuildOutputPath = Q:\Repos\MyApp\..\out\`.
   - PG #2 (`Configuration == Debug` → true): sets `OutputPath = Q:\Repos\MyApp\..\out\bin\MyApp\Debug\`.
   - PG #3 (`Configuration == Release` → false): skipped.
2. **Resolver** receives `outputPath = Q:\Repos\MyApp\..\out\bin\MyApp\Debug\` (already absolute after expansion → `isAbsolute = true` → used verbatim, no join).
3. Candidate `[Q:\Repos\MyApp\..\out\bin\MyApp\Debug, source="sfproj <OutputPath> (expanded)"]` is probed first.
4. `pathExists(...)` returns true → direct manifest match → resolved with source `"sfproj <OutputPath> (expanded)"`.

The recursive search never fires. Log line:

```
Resolved application package root: Q:\Repos\MyApp\..\out\bin\MyApp\Debug (via sfproj <OutputPath> (expanded))
```

For a .sfproj that pulls `BuildOutputPath` from `Directory.Build.props` (not parsed by Tier 1):

1. Parser leaves `OutputPath = $(BuildOutputPath)\bin\MyApp\Debug` (only `MSBuildProjectName` and `Configuration` got substituted).
2. Resolver candidate has unresolved `$(BuildOutputPath)` → `pathExists` returns false → candidate skipped.
3. Aggregated unresolved log line: `Unresolved MSBuild properties in package-path candidates: $(BuildOutputPath). Falling back to recursive search.`
4. With `useMsbuildPropertyEvaluator=true`: spawn MSBuild → returns `BuildOutputPath=Q:\Repos\MyApp\..\out\` and `OutputPath=Q:\Repos\MyApp\..\out\bin\MyApp\Debug\` → added as candidates → resolved on rerun. Log: `Resolved application package root: ... (via MSBuild -getProperty:OutputPath)`.
5. With `useMsbuildPropertyEvaluator=false` (default): falls through to the recursive search. Same outcome as today.

### 6.1 Objective 2 walk-through

Monorepo with two .sfproj files producing packages to a shared drop root:

```
Q:\Repos\Monorepo\
  apps\
    Voting.sfproj          (ApplicationTypeName = 'VotingType')
    Counter.sfproj         (ApplicationTypeName = 'CounterType')
  out\sfpkg\
    Voting\
      ApplicationManifest.xml   (ApplicationTypeName = 'VotingType')
    Counter\
      ApplicationManifest.xml   (ApplicationTypeName = 'CounterType')
```

User is publishing `Voting.sfproj` and `serviceFabric.deploy.packagePath` is set to `..\..\out\sfpkg\Counter` (stale value, last edited when they were debugging the Counter app).

1. `collectPackageRootCandidates` returns `[{ path: 'Q:\Repos\Monorepo\out\sfpkg\Counter', source: 'serviceFabric.deploy.packagePath' }, ...]`.
2. `resolveApplicationPackageRoot` probes the override first. Direct match: `Q:\Repos\Monorepo\out\sfpkg\Counter\ApplicationManifest.xml` exists.
3. Before returning, `confirmOverrideTypeMatch` fires:
   - Candidate source starts with `serviceFabric.deploy.packagePath` ✓
   - `expectedApplicationTypeName = 'VotingType'` (from Voting.sfproj's source manifest) ✓
   - Reads `Q:\Repos\Monorepo\out\sfpkg\Counter\ApplicationManifest.xml` → declared = `'CounterType'` ✓
   - `'CounterType' !== 'VotingType'` → invoke hook.
4. `vscode.window.showWarningMessage` (modal):
   > `serviceFabric.deploy.packagePath` points at a package whose ApplicationTypeName is `'CounterType'`, but the project declares `'VotingType'`. Path: `Q:\Repos\Monorepo\out\sfpkg\Counter`. Continuing will publish the wrong application. This choice is not remembered.  
   > [Continue Publish] [Cancel Publish]
5. User clicks **Cancel Publish**. Resolver throws `PublishCancelledByUserError`. Deploy flow catches → output channel: `Publish cancelled by user — application type did not match.` → returns; no telemetry-fail event.
6. User edits `serviceFabric.deploy.packagePath` to `..\..\out\sfpkg\Voting`, retries Publish. Steps 1–3 repeat; declared = `'VotingType'` = expected → silent return. Deploy proceeds.

A scripted caller (smoke test, CI) supplies `onOverrideTypeMismatch: async () => true` to bypass the prompt while keeping the warning in the log. A test omits the hook entirely to assert the legacy "always proceed" semantics still hold.

### 6.2 Objective 3 walk-through

Monorepo with .NET SDK "artifacts output" layout:

```
Q:\Repos\Monorepo\
  apps\
    Voting\
      Voting.sfproj                                    (ApplicationTypeName = 'VotingType')
  artifacts\
    bin\
      Voting\
        Debug\
          sfpkg\
            VotingType\
              ApplicationManifest.xml                  (ApplicationTypeName = 'VotingType')
```

The manifest sits six segments below `Voting.sfproj`. With the default `searchMaxDepth=4`, the existing project-wide recursive search misses entirely.

**Scenario A — user sets the depth only.** User configures `serviceFabric.deploy.searchMaxDepth: 8`. No `packagePath` override. Resolver:

1. Auto-discovered candidates (`<OutputPath>`, `<PackageLocation>`, `pkg\Debug`, `bin\Debug\pkg`, `bin\Debug`) all miss — either non-existent or no manifest at depth 0/1.
2. Last-resort recursive search under `Q:\Repos\Monorepo\apps\Voting` with depth `8` finds the manifest at relative depth 6 (`..\..\artifacts\bin\Voting\Debug\sfpkg\VotingType\` — wait, the recursive search walks DOWN from `searchRoot`, not up, so it would NOT find a sibling-tree manifest).

   Therefore Scenario A alone is **not** sufficient when the drop lives outside the .sfproj's subtree (the common case for `artifacts\` redirection). User still needs to either set `packagePath` to point into the drop tree (Scenario B) or rely on Tier 2 (MSBuild evaluator, Objective 1). The depth setting helps when the drop is *deep but inside* the .sfproj subtree (e.g. `<sfprojDir>\nested\nested\nested\nested\nested\sfpkg\ApplicationManifest.xml`).

3. Resolver falls through with the existing `Could not locate ApplicationManifest.xml` error — unchanged behavior; the new setting widened the search but the manifest is in a different subtree.

**Scenario B — user sets `packagePath` to the artifacts root.** User configures `serviceFabric.deploy.packagePath: ..\..\artifacts\bin\Voting\Debug` and `searchMaxDepth` stays at the default `4`. Resolver:

1. Candidate `[Q:\Repos\Monorepo\artifacts\bin\Voting\Debug, source="serviceFabric.deploy.packagePath"]` exists. Direct-match probe: no manifest at depth 0. Single-immediate-child probe: the only child is `sfpkg`, which itself does not contain the manifest — hits = 0.
2. **Objective 3 part B kicks in.** `source.startsWith('serviceFabric.deploy.packagePath')` ✓; `searchMaxDepth=4` ✓. Recursive search rooted at `Q:\Repos\Monorepo\artifacts\bin\Voting\Debug` with depth `4` walks `sfpkg\` (depth 1) → `sfpkg\VotingType\` (depth 2) → finds `ApplicationManifest.xml` (depth 2 from the override). Result: single hit at `Q:\Repos\Monorepo\artifacts\bin\Voting\Debug\sfpkg\VotingType`.
3. **Objective 2 confirmation runs.** `confirmOverrideTypeMatch` reads the manifest's `ApplicationTypeName = 'VotingType'`; matches the .sfproj's expected `'VotingType'`; silent return.
4. Resolver returns `{ path: 'Q:\Repos\Monorepo\artifacts\bin\Voting\Debug\sfpkg\VotingType', source: 'serviceFabric.deploy.packagePath (recursive search)' }`.

Log line:

```
Resolved application package root: Q:\Repos\Monorepo\artifacts\bin\Voting\Debug\sfpkg\VotingType (via serviceFabric.deploy.packagePath (recursive search))
```

**Scenario C — multi-app drop under the override.** Same as B but `artifacts\bin\Voting\Debug\sfpkg\` contains both `VotingType\ApplicationManifest.xml` AND `LegacyVotingType\ApplicationManifest.xml` (an orphaned package from a rename refactor). Resolver:

1. Override candidate exists; depth-0+1 probes miss (the manifest is at depth 2 under the override).
2. Objective 3 recursive search finds both manifests — multi-hit branch.
3. `disambiguateHits` reads each manifest's `ApplicationTypeName`, finds exactly one match for `'VotingType'`, silently returns it. Source: `"serviceFabric.deploy.packagePath (recursive search (matched ApplicationTypeName VotingType))"`.
4. Objective 2's `confirmOverrideTypeMatch` is **not** invoked on this path — the disambiguation already validated the type.

If the user's `.sfproj` declared `'LegacyVotingType'` instead, the resolver would silently select that one; no prompt because the disambiguation matched the expected type. If the user's source manifest is in a transitional state (`expectedApplicationTypeName` undefined), `disambiguateHits` falls through to `onAmbiguous` — the existing quick-pick UX — same as today.

## 7. Edge cases

| Case | Behavior |
|---|---|
| `<OutputPath>$(Foo)$(Foo)$(Foo)</OutputPath>` where `Foo` itself contains `$(Foo)` | Expander caps at 16 iterations; remaining `$(Foo)` tokens reported as unresolved. No infinite loop. |
| Property name with hyphens / dots | Token regex matches `[A-Za-z_][A-Za-z0-9_]*` only — hyphenated names (rare; not valid MSBuild identifiers) are not substituted. Tested. |
| Empty `<OutputPath />` | `firstScalar` returns `undefined` → unchanged behavior. |
| Whitespace-only `<OutputPath>   </OutputPath>` | Trimmed to `''` in `push` → skipped silently — same as today. |
| `<OutputPath>$(Configuration)</OutputPath>` with `Configuration=Debug` | Expands to `Debug` → joined to `sfprojDir` → probes `<sfprojDir>\Debug`. Identical to today's `pkg\<cfg>` candidate; deduped if it overlaps. |
| Conditional PG with `And` / `Or` / `Exists()` | `evaluateSimpleCondition` returns `'unevaluable'` → group skipped; one `logger.debug` line per Publish: `Skipping PropertyGroup with unsupported condition: <expr>`. Tier 2 (if enabled) recovers via the real MSBuild evaluator. |
| Setting override `$(MSBuildProjectName)\out` | Expanded against the same property map; if the user typed `$(NotKnown)`, the unresolved token is logged and the override silently misses (same fallthrough as a wrong absolute path today). |
| MSBuild not installed (Tier 2 enabled) | `findMsBuild()` returns `undefined` → `evaluateViaMsbuild` returns `[]` and logs `MSBuild evaluator skipped: MSBuild.exe not found.`. Recursive search runs. |
| MSBuild evaluator crashes / times out | Caught; warning logged with truncated stderr; returns `[]`. Recursive search runs. Telemetry event `deploy.msbuildEvaluator.failed`. |
| .sfproj parsed with Configuration='Debug' but Publish runs with Configuration='Release' | Deploy flow rebuilds the property map with `Release` before calling `collectPackageRootCandidates`; the parser-level `outputPath` is bypassed in favor of the freshly-expanded value. |
| Cache staleness | `evaluateViaMsbuild` stats the .sfproj on every call; mtime change drops the cached entry. Edits to imported props files (`Directory.Build.props`) do NOT invalidate — known limitation; the user can run `Developer: Reload Window` to flush. Documented in HOWTO §10. |
| **Obj 2:** override resolves to a package with a manifest that cannot be parsed | `readApplicationTypeName` returns `undefined` → `confirmOverrideTypeMatch` returns without invoking the hook; resolver returns the path. The SDK's own parse error will surface downstream if the manifest is truly broken — we don't double-fail on what may be a transient FS state. Logged at `debug`. |
| **Obj 2:** override resolves via the recursive-search fallback (multi-hit auto-selected by type) | `disambiguateHits` already enforces type match — no extra prompt. `confirmOverrideTypeMatch` is invoked only on the single-hit paths, so the fallback's correctness gate (existing) and the override's correctness gate (new) compose without double-prompting. |
| **Obj 2:** `expectedApplicationTypeName` is undefined (source manifest unreadable) | `confirmOverrideTypeMatch` no-ops — we have no expected type to compare against. The user can still trip the existing multi-hit ambiguity prompt if there are multiple manifests; if there's a single hit, the resolver proceeds silently (same as today). Logged at `debug`: `Override type check skipped: expected ApplicationTypeName unknown.` |
| **Obj 2:** user dismisses modal (Esc / clicks-away) | `showWarningMessage` returns `undefined` → hook returns `false` → resolver throws `PublishCancelledByUserError`. Equivalent to explicit Cancel. |
| **Obj 2:** override path is case-different from on-disk on Windows | The check operates on the manifest's *content* (declared type string), not the path — so case-only differences in the candidate path are irrelevant. Type comparison itself is case-sensitive because Service Fabric application type names are case-sensitive on the cluster. |
| **Obj 2:** override resolves to a package belonging to *the same* application type as the .sfproj | Types match → `confirmOverrideTypeMatch` returns without invoking the hook. User sees no prompt. This is the common "output redirected to a sibling folder" case and must stay silent. |
| **Obj 3:** `searchMaxDepth` set to `0` or negative | Out-of-range; clamp logic emits a `warn` log (`serviceFabric.deploy.searchMaxDepth=0 is out of range [1, 16]; using default 4.`) and proceeds with `4`. The override-rooted recursive search and the project-wide last-resort both run with the default value. |
| **Obj 3:** `searchMaxDepth` set to a string / `null` / non-integer (configuration tampering) | `Number.isInteger` guard fails; same warn + default-`4` path as out-of-range. The resolver never sees the bad value. |
| **Obj 3:** `searchMaxDepth` set to `16` on a project with a `node_modules` subtree under `sfprojDir` | The recursive walk is bounded but unfiltered — it WILL descend into `node_modules`. Slow but bounded (walk capped at `16` levels, returns when manifest count satisfies single-hit or multi-hit branches). Documented as a known limit in HOWTO §10; users who hit this should either narrow `serviceFabric.deploy.packagePath` (cuts the search root) or lower the depth (cuts the walk). A future enhancement could honor `.gitignore` / a dedicated `serviceFabric.deploy.searchIgnore` list — explicitly out of scope here. |
| **Obj 3:** override-rooted recursive search finds zero manifests | Same as today's per-candidate miss: fall through to the next candidate. The new step is a strict superset of the old probe — anything found before is still found; the new step only ADDS hits, never removes them. |
| **Obj 3:** override-rooted recursive search finds the manifest at the override path itself (depth 0) | This case is already caught by the existing direct-match probe (`// 1) Direct match.`) before the recursive step. The recursive search starts at the override and includes depth 0; even if the direct-match check were skipped, the recursive search would return the same path, just labelled `"(recursive search)"` instead of bare. No double-counting because we only reach the recursive step when the direct-match probe returned false. |
| **Obj 3:** override is misspelled (path doesn't exist) | Candidate fails `pathExists` → `continue`. The recursive-search step is never reached for that candidate. Same behavior as today for a non-existent override; the new objective doesn't change the early-exit pattern. |
| **Obj 3:** project-wide last-resort search has `searchMaxDepth=1` (user lowered the setting) | Project-wide recursive search runs with depth 1 — narrower than today's default 4 — and may miss manifests that the default-depth resolver would find. This is user-initiated; the setting description warns to increase, not decrease, for deep layouts. Default-layout projects (`pkg\Debug` next to .sfproj) still resolve via the default-candidate probe and don't touch the recursive search. |

## 8. Tests

New file `test/unit/msbuildPropertyExpander.test.ts` with at least:

- `expandMsbuildValue` — single-token substitution, multi-token, nested (`$(A)` resolves to `$(B)` resolves to `value`), unresolved-token reporting, depth cap behavior, no-op on empty string, no-op on string with no tokens.
- `evaluateSimpleCondition` — `'==' true / false`, `'!=' true / false`, case-insensitivity, property substitution on both sides, `'unevaluable'` for `And`/`Or`/`Exists()`/missing quotes.
- `buildPropertyMap` — group ordering, later definitions override earlier, conditional groups skipped when condition false, unconditional groups always applied, intrinsics seeded before any group runs, `Configuration` / `Platform` overridable by an explicit `<Configuration>...</Configuration>` PG (matches MSBuild semantics).

Additions to `test/unit/packageResolver.test.ts`:

- `collectPackageRootCandidates` with an `expand` callback — verify substitution applied to `outputPath`, `packageLocation`, `settingOverride`; verify the `(expanded)` source-label suffix appears only when substitution actually changed the value; verify `expand` returning unresolved tokens is non-fatal (candidate still added).
- `resolveApplicationPackageRoot` with `evaluateMsbuildProperties` — verify the callback is invoked only when the original sweep finds nothing; verify candidates from the callback are appended and re-swept; verify a callback that returns `[]` (or throws) falls through to the recursive search without duplicating errors.
- **Objective 2:** `resolveApplicationPackageRoot` with `onOverrideTypeMismatch`:
  1. Override candidate, direct manifest match, declared type **matches** expected → hook is **not** invoked; resolver returns the path. (Silent-success path is the most-traveled; locking it down with a test guards against accidental over-prompting.)
  2. Override candidate, direct manifest match, declared type **differs** → hook **is** invoked with `{ path, declaredApplicationTypeName, expectedApplicationTypeName }`; hook returns `true` → resolver returns the path.
  3. Same as (2) but hook returns `false` → resolver throws `PublishCancelledByUserError` with a message containing both type names and the path.
  4. Override candidate, single-immediate-child match (nested layout), types differ → hook is invoked with the **child** path (not the override root); resolver throws on `false`. Locks down that the resolved path reported to the user is the actual manifest folder, not the override.
  5. **Auto-discovered** candidate (`<OutputPath>`, `<PackageLocation>`, default `pkg\Debug`), single-hit, types differ → hook is **not** invoked; resolver returns silently. Guards Objective 2's auto-discovered-exemption (§3).
  6. Override candidate, single-hit, `expectedApplicationTypeName` is **undefined** → hook is **not** invoked; resolver returns silently. Guards the "source manifest unreadable" degraded path.
  7. Override candidate, single-hit, `ProbeFs.readApplicationTypeName` returns `undefined` (unparseable manifest) → hook is **not** invoked; resolver returns the path. Guards the "don't double-fail on FS state" rule.
  8. Multi-hit path with override candidate → `disambiguateHits` runs as today and `confirmOverrideTypeMatch` is **not** invoked on top (no double-prompt). Type validation continues to happen exactly once per hit set.

**Objective 3** — additions to `test/unit/packageResolver.test.ts`:

1. Override candidate with manifest at depth 2 under the override (direct + single-child probes miss), `searchMaxDepth=4` → recursive-search step finds the single manifest; resolver returns `source === 'serviceFabric.deploy.packagePath (recursive search)'`.
2. Same as (1) but with `searchMaxDepth=1` → recursive search finds zero (manifest is at depth 2); resolver falls through to next candidate, then to project-wide search.
3. Override candidate with TWO manifests under it at varying depths — `disambiguateHits` picks the one matching `expectedApplicationTypeName`; source label includes both `(recursive search` and `matched ApplicationTypeName ...)`.
4. Override candidate with TWO manifests, neither matching expected type → `onAmbiguous` is invoked; on `undefined` return, resolver throws with the "Multiple ApplicationManifest.xml files found under override" error message.
5. **Auto-discovered** candidate (`<OutputPath>`) with manifest at depth 2 → recursive-search step is **NOT** invoked (auto-discovered candidates keep depth-0+1 probes); resolver falls through to next candidate / project-wide search. Guards the auto-discovered exemption.
6. `searchMaxDepth=undefined` on `ResolveOptions` → override-rooted recursive search is **NOT** invoked (legacy non-VSCode caller protection); behavior matches today's resolver.
7. **Objective-2 interaction:** override recursive-search single-hit, declared type differs → `onOverrideTypeMismatch` invoked with the *resolved (deeper)* path, NOT the override root. On hook returning `false`, throws `PublishCancelledByUserError` with the deep path in the message.
8. **Objective-1 interaction:** `serviceFabric.deploy.packagePath = '$(MSBuildProjectName)\out'` with expansion supplying `MSBuildProjectName=Voting`; manifest at `out\sfpkg\Voting\ApplicationManifest.xml`; recursive step kicks in. Final `source === 'serviceFabric.deploy.packagePath (expanded) (recursive search)'` — locks down label composition.

Deploy-flow setting clamp (in a new lightweight test or in an existing deploy-flow integration test):

9. `searchMaxDepth` setting values: `0`, `-1`, `17`, `'abc'`, `null`, `undefined` (default), `4`, `1`, `16` — verify the clamp logic produces `4`, `4`, `4`, `4`, `4`, `4`, `4`, `1`, `16` respectively and emits a `warn` only for the out-of-range / non-integer cases.

Additions to `test/unit/sfprojParser.test.ts`:

- A fixture .sfproj with `<OutputPath>$(MSBuildProjectName)\out\$(Configuration)\</OutputPath>` parses with `outputPath === '<sfprojName>\\out\\Debug\\'` (Debug-seeded by the parser).
- A fixture with two conditional PGs (one for Debug, one for Release) — the Debug-conditioned `<OutputPath>` wins after parser-level expansion.

All existing 295+ tests stay green.

## 9. Documentation

- `CHANGELOG.md` — new `## 1.1.9` section above `## 1.1.8`:
  ```markdown
  ## 1.1.9
  - Package-root resolver now expands MSBuild `$(Property)` references in `<OutputPath>`, `<PackageLocation>`, and `serviceFabric.deploy.packagePath` against the .sfproj's own `<PropertyGroup>` values (including conditional groups for the simple `'$(X)' == '...'` form). Eliminates a class of "package not found" misses for monorepo layouts that interpolate `$(MSBuildProjectName)` or `$(Configuration)` into the drop path.
  - New opt-in setting `serviceFabric.deploy.useMsbuildPropertyEvaluator` (default off). When enabled, the resolver falls back to `MSBuild.exe -getProperty:OutputPath,PackageLocation,BuildOutputPath` for properties defined in imported targets files (e.g. `Microsoft.ServiceFabric.targets`, `Directory.Build.props`). Cached per `(sfproj, mtime, Configuration)`.
  - Resolver log lines now annotate expanded candidates with `(expanded)` so it's obvious which substitution rule won.
  - **Safety:** When `serviceFabric.deploy.packagePath` resolves to a package whose `ApplicationTypeName` differs from the project's declared type, Publish now prompts with a modal **Continue Publish / Cancel Publish** warning before invoking the SDK. The choice is not persisted — every Publish revalidates — preventing accidental upgrade of the wrong application from a stale override.
  - New setting `serviceFabric.deploy.searchMaxDepth` (default `4`, range `1–16`) controls the recursive `ApplicationManifest.xml` search depth. When `serviceFabric.deploy.packagePath` is set and its direct probe misses, the resolver now also recurses under the override path itself — honoring the same depth setting — so deep monorepo drops like `<repo>\artifacts\bin\<App>\<cfg>\sfpkg\<AppType>\` resolve from a top-level override.
  ```
- `README.md` — under *Features*, append: "Package-root resolution understands MSBuild `$(Property)` references in `<OutputPath>` / `<PackageLocation>`, warns before deploying when `serviceFabric.deploy.packagePath` points at a different application type, and supports a configurable recursive-search depth (`serviceFabric.deploy.searchMaxDepth`) that also applies under the override."
- `docs/HOWTO.md` §10 (Deployment) — new subsection *"How package paths are resolved"* describing the three tiers, the supported subset of MSBuild syntax, and the cache-invalidation note for imported props files. Also document the override-application-type confirmation prompt under a new bullet *"Safety: override application-type check"* — when it fires, what the user is choosing, and that the decision is not persisted. Document `serviceFabric.deploy.searchMaxDepth` semantics (project-wide last-resort AND under-the-override recursion) with the `node_modules` warning.
- `docs/HOWTO.md` §12 (Settings) — new rows for `serviceFabric.deploy.useMsbuildPropertyEvaluator` and `serviceFabric.deploy.searchMaxDepth`; amended row for `serviceFabric.deploy.packagePath` (mention the type-mismatch prompt and the under-the-override recursion).

## 10. Rollout / risk

- **Risk profile: low.** All Tier 1 changes are additive and gated by the presence of new optional fields; the resolver's existing 100% test pass continues to hold for any caller that omits them. Tier 2 is opt-in. Objective 2 is also gated on the new optional `onOverrideTypeMismatch` hook — callers that omit it (every existing test, every scripted caller) see byte-identical resolver behavior. Objective 3 part A is plumbing only (default `4` matches today); part B is gated on the source-label prefix check, so non-override candidates are completely unaffected.
- **Performance:** Tier 1 adds one O(N·M) regex pass per probed candidate (N = candidate count ≤ 6, M = expansion iterations ≤ 16). Sub-millisecond. Tier 2 adds 1–3 s on cold cache (only when explicitly enabled), 0 ms thereafter for the lifetime of the extension host. Objective 2 adds at most one `ApplicationManifest.xml` parse per single-hit override resolution (same parse the SDK is about to do anyway) — sub-millisecond, no I/O amplification. Objective 3 part B adds a recursive walk under the override only when the cheap depth-0+1 probes miss — zero cost on the happy path; bounded by `searchMaxDepth` (default `4`) on the slow path.
- **Telemetry:** existing `deploy.packageResolver.*` events gain a `viaExpander: boolean` and `viaMsbuildEvaluator: boolean` boolean — no new event types. Objective 2 emits two new events: `deploy.overrideTypeMismatch.prompted` (declared type, expected type — paths NOT included) and `deploy.overrideTypeMismatch.cancelled` (no payload). User-initiated cancellation is success-flavored telemetry; it confirms the safety net caught a real mismatch. Objective 3 adds two booleans to the existing `deploy.packageResolver.resolved` event: `viaOverrideRecursive: boolean` and `searchMaxDepth: number` (the effective clamped value).
- **Backout:** revert is straightforward — every callsite passes the new fields explicitly; deleting them and the new modules removes the feature without touching the resolver's core algorithm. Objective 2's backout is even simpler: delete `confirmOverrideTypeMatch` and the two call sites; the resolver returns to today's silent-on-single-hit behavior. Objective 3's backout is mechanical: drop the setting from package.json, restore the hardcoded `4` in deployFlow, delete the `// 2b)` block in the resolver. Three localized changes, all in files already touched by Objectives 1–2.

## 11. Open questions

1. **Configuration plumbing.** Today the deploy flow hardcodes `'Debug'` ([src/deploy/deployFlow.ts](src/deploy/deployFlow.ts#L141)). Plan 1.1.9 keeps that hardcode for the *resolver* path (it's what the existing default-candidate logic assumes), but the new property map honors whatever `configuration` the deploy flow passes. Adding a configuration picker is out of scope here — tracked separately. **Decision: leave hardcoded `'Debug'` for 1.1.9; revisit when the picker lands.**
2. **`Directory.Build.props` parsing.** Tier 1 deliberately skips imports. If user-reported issues show this as the dominant cause of resolver misses, a 1.1.10 follow-up could parse `Directory.Build.props` walking up from the .sfproj — much smaller blast radius than implementing full `<Import>` recursion. **Decision: defer; revisit if telemetry shows >5% of Publishes hit the unresolved-token log line.**
3. **Tier 2 default.** Currently `useMsbuildPropertyEvaluator` defaults to `false` to keep Publish snappy and to avoid taking a hard MSBuild dependency at deploy time. After a release of bake-in, consider flipping the default to `true` if the cold-cache cost is acceptable. **Decision: default `false` for 1.1.9; reassess after one release cycle.**
4. **MSBuild older than 17.4.** `-getProperty:` lands in MSBuild 17.4 (VS 2022 17.4, .NET SDK 7.0.100). Older MSBuilds are still in the wild on long-LTS dev boxes. The thin wrapper detects unsupported `-getProperty:` from the exit-code-1-with-help-text response and falls back to writing a tiny inline target file (`<Target Name="GetProp"><Message Importance="High" Text="$(OutputPath)|$(PackageLocation)|$(BuildOutputPath)" /></Target>`) into a temp dir, invoking it, and parsing the message line. **Decision: implement the inline-target fallback as part of 1.1.9 to support VS 2022 ≥17.0 / MSBuild ≥17.0.**
5. **(Objective 2) Case-sensitivity of `ApplicationTypeName` comparison.** Service Fabric application type names are case-sensitive on the cluster (`StoreService-StoreType` ≠ `storeservice-storetype`). The naive `String.equals` comparison in `confirmOverrideTypeMatch` honors this, which is correct for cluster fidelity but may produce a surprising prompt if the user's source manifest casing has drifted from the package's casing. **Decision: keep case-sensitive; document the comparison rule in HOWTO §10. A future enhancement could surface a hint when types differ only by case ("types match if you ignore case — check your source manifest for a typo").**
6. **(Objective 2) Telemetry payload caution.** `deploy.overrideTypeMismatch.prompted` emits `declaredApplicationTypeName` and `expectedApplicationTypeName`. Application type names are not PII in the GDPR sense, but they ARE customer-defined strings that may leak product names. **Decision: emit only the *hash* (SHA-256 first-8-chars) of each type name, plus a `mismatch: true` boolean. Investigators can correlate by hash without leaking names. Documented in the telemetry table.**
7. **(Objective 2) Should the prompt mention the .sfproj path?** Currently the prompt shows the resolved package path but not the .sfproj path. In multi-root workspaces with similarly-named projects this might be ambiguous. **Decision: show only the package path for now — the .sfproj is implicit from the Publish command's invocation context (status bar / quick pick already disambiguates). Revisit if user feedback suggests otherwise.**
8. **(Objective 3) Should `searchMaxDepth` be a single setting or split into project-wide + override-rooted?** A single shared setting is simpler, but a project-wide `node_modules`-laden tree might warrant a tighter depth than the user's explicit-and-narrow override. **Decision: ship as one setting for 1.1.9. If telemetry shows the override-rooted search consistently completing faster than the project-wide search, a follow-up could split into `serviceFabric.deploy.searchMaxDepthOverride` with a higher default. Defer until evidence justifies the configuration cliff.**
9. **(Objective 3) Should the resolver honor `.gitignore` or a dedicated `serviceFabric.deploy.searchIgnore` list to skip `node_modules`, `bin`, `obj`, etc., during recursive search?** Today's recursive walker is unfiltered. With `searchMaxDepth=16` and a deeply-nested `node_modules`, the walk could be slow even though it's bounded. **Decision: defer to 1.1.10. The depth bound is sufficient for the immediate use-case (deep monorepo drops); `.gitignore` integration is a separate, larger feature with its own UX surface (e.g. "why didn't my package get found?" when an ignore rule was unexpectedly applied).**
