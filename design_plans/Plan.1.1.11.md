# Plan — 1.1.11 (Remove project-wide recursive search; generalize candidate-bounded scan up to `searchMaxDepth`)

## 0. Scope summary

Remove the **project-wide** recursive `ApplicationManifest.xml` search from the package-path resolver (the Tier 3 walk rooted at `project.sfproj.directory`). Replace its fallback role with an actionable error. At the same time, **generalize the existing depth-1 single-immediate-child probe** so that every declared candidate path (`serviceFabric.deploy.packagePath`, `<PackageLocation>`, `<OutputPath>`, `pkg\<Configuration>\`, the legacy `bin\<Configuration>\…` paths) is scanned up to `serviceFabric.deploy.searchMaxDepth` levels deep — not just one. This preserves support for layouts in which multiple service projects share a common output folder and land their `ApplicationManifest.xml` two or three levels under the declared root, while eliminating the cross-tree blast radius of the project-wide walk.

After this change, [`resolveApplicationPackageRoot`](src/deploy/packageResolver.ts) probes only the explicit, project-declared candidate ladder:

1. `serviceFabric.deploy.packagePath` setting (with Tier 1 / Tier 2 property expansion as today).
2. `<PackageLocation>` declared in the `.sfproj`.
3. `<OutputPath>` declared in the `.sfproj`.
4. Default `pkg\<Configuration>\`.
5. Legacy `bin\<Configuration>\pkg\` and `bin\<Configuration>\`.

For **each** candidate, the resolver:

- Accepts a direct depth-0 match (`<candidate>/ApplicationManifest.xml`).
- Otherwise scans **up to `searchMaxDepth` levels deep** under the candidate, applying the existing `disambiguateHits` machinery on multi-hit (auto-match by `ApplicationTypeName`, then quick-pick via `onAmbiguous`) and the existing `confirmOverrideTypeMatch` on single-hit-under-override-with-type-mismatch.

The setting `serviceFabric.deploy.searchMaxDepth` (introduced in Plan 1.1.9, retained in this plan; range `1–16`) gets a **new default of `2`** (lowered from `4`) and shifted semantics: it now governs the per-candidate scan depth instead of a project-wide walk depth. The lower default reflects the canonical layouts (depth-0 direct, depth-1 immediate-child, depth-2 nested-`Pkg`) covered by the SDK and common monorepo conventions; deeper drops can opt up. Existing user `settings.json` values continue to work unchanged.

When every candidate misses *and* the optional Tier 2 MSBuild evaluator (when enabled) also produces no match, the resolver throws a single actionable error:

> *Could not locate `ApplicationManifest.xml`. Probed: `<list of candidate paths>`. The Package build may not have produced any output, or the package is in a non-standard location. Set `serviceFabric.deploy.packagePath` to the package folder, or enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` if your `<OutputPath>` / `<PackageLocation>` references properties defined in `Directory.Build.props` or imported `.targets`.*

The motivation is correctness, not minimalism. The project-wide walk has a single-hit blind spot ([packageResolver.ts L274-L277](src/deploy/packageResolver.ts#L274)) where one stray `ApplicationManifest.xml` anywhere under the `.sfproj` directory — a sibling sample, an older app's `Pkg/` folder, an extracted `.sfpkg` backup, a test fixture under a non-skipped folder name like `bin`, `out`, or `artifacts` — is silently accepted without `ApplicationTypeName` validation. With `packagePath` + `<PackageLocation>` + `<OutputPath>` + the `pkg\<Configuration>\` default + Tier 2 in place, a project either declares where its package goes or accepts the SDK default. There is no fourth way for `Microsoft.ServiceFabric.targets` to drop a package somewhere the project doesn't reference, so the project-wide rescue is solving a non-problem and introducing a real footgun. The cross-tree walk goes; the per-candidate-bounded walk stays (and is generalized to cover the legitimate nested-layout case).

The Plan 1.1.9 Objective 3 *override-rooted recursive search* — a special case in which only `serviceFabric.deploy.packagePath` candidates received a deep scan — is **subsumed** by this change. Every declared candidate (override or auto-discovered) now gets the same uniform depth-N treatment. The asymmetry "auto-discovered candidates skip recursion" goes away; symmetric semantics are easier to document, test, and reason about. The `confirmOverrideTypeMatch` hook (the override-mismatch warning prompt) still runs on single-hit override accepts as today.

The Tier 2 in-flight prompt (Plan 1.1.10) is simplified in the same change. The third button **"No, fall back to recursive search"** no longer has a meaningful outcome (there *is* no project-wide recursive search to fall back to; per-candidate scanning happens automatically), so it is removed. The modal becomes a two-button + Cancel choice: **Use for this Publish** / **Always use (save setting)** / Cancel. The per-`.sfproj` "decline" Memento entries become inert and are no longer written or read; the **Service Fabric: Reset Tier 2 Property-Evaluator Prompt** command stays as a one-shot cleanup helper that clears any legacy `tier2PromptSuppressedFor:*` entries left over from 1.1.10.

This is a **minor** release (1.1.11). The user-visible Publish behavior changes for one specific configuration combination — `useMsbuildPropertyEvaluator: false` AND a project where neither `<OutputPath>` nor `<PackageLocation>` resolves to a candidate root containing the manifest within `searchMaxDepth` levels AND `packagePath` is unset — which previously sometimes worked via the project-wide rescue and now fails with an actionable error pointing at the two fixes. The release script ([scripts/release.ps1](scripts/release.ps1)) handles the `package.json` version bump at tag time; we do not edit it.

## 1. Background — why this exists

### 1.1 The blind spot in the project-wide walk

After Plan 1.1.9 / 1.1.10 shipped, the resolver had three tiers and a per-Publish prompt:

1. **Tier 1 — pure in-process expander.** Substitutes `$(Property)` tokens declared in the `.sfproj`'s own `<PropertyGroup>`. Always on.
2. **Tier 2 — MSBuild `-getProperty:` evaluator.** Opt-in via `serviceFabric.deploy.useMsbuildPropertyEvaluator`. When enabled and every Tier 1 candidate misses, spawns MSBuild to evaluate properties defined in imported targets / `Directory.Build.props`.
3. **Tier 3 — bounded recursive search.** Walks under `project.sfproj.directory` (and under the `serviceFabric.deploy.packagePath` override per Plan 1.1.9 Obj 3) up to `serviceFabric.deploy.searchMaxDepth` levels deep, returning the unique `ApplicationManifest.xml` it finds.

The Tier-3 single-hit accept ([packageResolver.ts L274](src/deploy/packageResolver.ts#L274)) is the bug — but only for the project-wide walk:

```ts
if (found.length === 1) {
    return { path: found[0], source: 'recursive search' };
}
```

`disambiguateHits` (which type-validates against `expectedApplicationTypeName`) only runs when there are 2+ hits. So a workspace that contains:

- The `.sfproj` for `MyApp` (declares `ApplicationTypeName=MyAppType`), and
- A sibling `samples/OtherApp/pkg/Debug/ApplicationManifest.xml` left over from a previous experiment, an extracted backup, a fixture, etc., declaring a *different* `ApplicationTypeName=OtherAppType`

…will silently deploy `OtherAppType` whenever Tiers 1+2 miss. The `SKIP_DIRS` list ([packageResolver.ts L549-L555](src/deploy/packageResolver.ts#L549)) excludes `node_modules`, `.git`, `.vs`, `.vscode`, `obj`, and `packages` — but **not** `bin`, `out`, `artifacts`, `Backup`, `_published`, `TestResults`, or any user-named folder. Expanding the skip list is whack-a-mole. The principled fix is to remove the project-wide rescue entirely. The same single-hit blind spot exists in the override-rooted recursive search and in the depth-1 single-immediate-child probe today — but those are bounded by the user's / project's explicit declaration of where the package goes, so the residual blast radius is bounded to "stale outputs under the declared root", which is dramatically narrower than "anywhere under the .sfproj".

### 1.2 Why the project-wide rescue is unnecessary

`Microsoft.ServiceFabric.targets` lands the staged package at exactly one of:

| Source | Lands at |
|---|---|
| `<PackageLocation>` declared | the declared path |
| `<OutputPath>` declared | the declared path |
| Neither declared | `pkg\<Configuration>\` (SDK default) |

Plus the user override (`serviceFabric.deploy.packagePath`) and the legacy `bin\<cfg>\pkg` / `bin\<cfg>` fallbacks for older templates. There is no documented path by which the SDK drops a package somewhere the project doesn't declare and the user hasn't pointed at. If all five candidates miss — including a deep scan under each — **the project is genuinely misconfigured** (or the build hasn't produced output yet) and rescuing that case via project-wide filesystem walk substitutes the wrong package as easily as the right one.

### 1.3 Why depth-1 isn't enough

The existing single-immediate-child probe handles two layouts:

- `<candidate>/ApplicationManifest.xml` (direct, depth 0).
- `<candidate>/<AppTypeName>/ApplicationManifest.xml` (nested, depth 1 — older VS template).

It does **not** handle layouts in which multiple service projects share a common output folder and produce deeper-nested manifests, e.g.:

- `out\sfpkg\<App>\Pkg\ApplicationManifest.xml` (depth 2)
- `out\sfpkg\<App1>\<App1Type>\<Pkg>\ApplicationManifest.xml` (depth 3)
- `<repo>\artifacts\bin\<App>\<cfg>\sfpkg\<AppType>\ApplicationManifest.xml` (depth 5+ under a top-level monorepo output folder)

In 1.1.9, the override-rooted recursive search (Plan 1.1.9 Obj 3) was added precisely because the depth-1 probe wasn't enough for monorepo layouts — but only for user-set overrides. Auto-discovered candidates kept the depth-1 limit, on the grounds that *"a stale `<OutputPath>` shouldn't be 'rescued' by recursing under it"*. Real-world feedback (the conversation that motivated this plan) is that this asymmetry is exactly backwards: the legitimate case the user is trying to support is *the project's own `<OutputPath>` pointing at a shared monorepo drop folder with deeper-nested manifests*. Forcing every monorepo `.sfproj` to also set `packagePath` to get past depth-1 is busywork; the candidate path is already a declared signal of intent.

Generalizing the depth-1 probe to a depth-N probe under every declared candidate makes the resolver's behavior uniform across user-set and project-declared roots. The `searchMaxDepth` setting (already documented, already plumbed through `ResolveOptions`) gains a clearer purpose: it's the per-candidate scan depth, with sensible default `2` (covers depth-0 direct + depth-1 immediate-child + depth-2 nested-`Pkg` layouts — the shapes the SDK templates produce) and tunable up to `16` for very deep monorepo drops.

### 1.4 The case Tier 3 was solving

The one real-world flow that Tier 3 rescued in 1.1.9 was the `Directory.Build.props`-defined `$(BuildOutputPath)` case (per Plan 1.1.10 §1.2): a monorepo `.sfproj` declares `<PackageLocation>$(BuildOutputPath)\bin\$(Configuration)\…</PackageLocation>`, the Tier 1 expander cannot see the imported `Directory.Build.props`, so the candidate string still contains `$(BuildOutputPath)` and fails its existence probe — meaning the candidate root never gets scanned at all (deep or not). Pre-1.1.10 the user got a silent rescue by project-wide search. Post-1.1.10, the in-flight prompt offers Tier 2 explicitly. Post-1.1.11, the user gets one of:

- The Tier-2 prompt fires and they pick **Use for this Publish** or **Always use** → MSBuild evaluates the property, the candidate path now resolves to an existing folder, the per-candidate depth-N scan finds the manifest, deploy succeeds.
- The Tier-2 prompt fires and they Cancel → Publish aborts (existing 1.1.10 behavior).
- The Tier-2 prompt is suppressed (`suppressMsbuildEvaluatorPrompt: true`) AND `useMsbuildPropertyEvaluator: false` → the actionable error fires, pointing at the two fixes.

The third bullet is the only behavior regression versus 1.1.9 + 1.1.10. The user who configured `suppressMsbuildEvaluatorPrompt: true` explicitly opted into "no UI"; the prior silent project-wide rescue was masking the `useMsbuildPropertyEvaluator` toggle they should have flipped. The clear failure with the actionable message is a strict improvement in observability.

### 1.5 Why simplify the Tier 2 prompt at the same time

The Plan 1.1.10 modal has three buttons + Cancel:

- **Use for this Publish** — enable Tier 2 for this run only.
- **Always use (save setting)** — persist `useMsbuildPropertyEvaluator: true`.
- **No, fall back to recursive search** — set `useEvaluator = false`, persist a per-`.sfproj` Memento entry to skip this prompt forever.
- **Cancel** (or Escape) — abort the Publish.

After the project-wide walk is gone, the third button is incoherent. There is no project-wide search to fall back to; per-candidate scanning happens unconditionally. Picking it would set `useEvaluator = false` and let the resolver fall through to the actionable-error path — but it would *also* persist a Memento entry that suppresses this prompt for the same `.sfproj` forever, so subsequent Publishes silently hit the same actionable error with no offer to enable Tier 2. That is a footgun-by-design.

The clean shape is to drop the third button entirely. The two-button + Cancel modal is the minimal information-preserving form: enable Tier 2 (this Publish or persisted), or abort. Users who want the prompt silenced workspace-wide already have `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt: true`.

## 2. Goals

Acceptance:

1. **The project-wide recursive search is removed.** The Tier 3 block in `resolveApplicationPackageRoot` ([packageResolver.ts L268-L291](src/deploy/packageResolver.ts#L268)) is deleted. `ResolveOptions.searchRoot` is removed from the public type. The `'recursive search'` source label (the plain Tier 3 variant) no longer appears in any returned `ResolveResult.source`. Any deeper-than-direct accept now carries a per-candidate source label (e.g. `'sfproj <OutputPath> (nested depth 2)'`).
2. **The candidate sweep gains a depth-N scan.** The depth-1 single-immediate-child probe ([packageResolver.ts L356-L372](src/deploy/packageResolver.ts#L356)) is generalized to scan up to `searchMaxDepth` levels deep under every candidate. The existing `searchForManifest` helper is reused (renamed if its scope changes; see §5.1). `SKIP_DIRS` is retained and gains `bin`, `obj`, `out`, `artifacts`, `_published`, `TestResults`, `node_modules` to keep the per-candidate scan fast in shared-output folders; the existing `.git`, `.vs`, `.vscode`, `packages` entries stay.
3. **The Plan 1.1.9 Obj 3 override-rooted special case is removed (because it's subsumed).** The dedicated override-only recursive block ([packageResolver.ts L373-L424](src/deploy/packageResolver.ts#L373)) is deleted. Override candidates now follow the same depth-N path as auto-discovered candidates. The `confirmOverrideTypeMatch` hook still fires on single-hit override accepts at any depth (existing Plan 1.1.9 Obj 2 behavior, preserved).
4. **`serviceFabric.deploy.searchMaxDepth` is retained; default lowered from `4` to `2`.** The `package.json` `contributes.configuration.properties` entry stays, with range (`1–16`) unchanged, the `default` lowered to `2`, and the `description` updated to reflect the new per-candidate scope: *"Maximum directory depth for the per-candidate `ApplicationManifest.xml` search applied to each declared package-root candidate (`serviceFabric.deploy.packagePath`, `<PackageLocation>`, `<OutputPath>`, `pkg\<Configuration>\`, …). Default `2` covers the depth-0 direct, depth-1 immediate-child, and depth-2 nested-`Pkg` layouts produced by the SDK templates and common monorepo conventions; increase for deep monorepo drops (e.g. `<repo>\artifacts\bin\<App>\<cfg>\sfpkg\<AppType>\`). Values outside `1–16` fall back to the default and emit a warning."* Existing user `settings.json` entries continue to work unchanged.
5. **`ResolveOptions.searchMaxDepth` is retained.** Same field name, same meaning at the resolver API surface (per-candidate depth limit). Default in code becomes `2` when the option is omitted (was `4` in 1.1.9 / 1.1.10).
6. **The Tier 2 evaluator path remains intact.** `ResolveOptions.evaluateMsbuildProperties` and the `sweepCandidates` re-run after Tier 2 returns extra candidates ([L260-L266](src/deploy/packageResolver.ts#L260)) stay exactly as today. Only the post-Tier-2 project-wide-search block is removed.
7. **The final error is actionable.** When every candidate (and Tier-2 candidates, when enabled) misses, the resolver throws a single `Error` whose message:
    - Lists the probed paths verbatim (preserves the Plan 1.1.9 `"Probed: …"` diagnostic).
    - Names **both** escape hatches in priority order: `serviceFabric.deploy.packagePath` first (the direct override), then `serviceFabric.deploy.useMsbuildPropertyEvaluator` (the imported-target rescue).
    - Mentions the imported-targets / `Directory.Build.props` context for the Tier 2 hint so users without that complexity don't waste time investigating it.
8. **The Tier 2 prompt becomes a 2-button modal.** [`tier2PromptState.ts`](src/deploy/tier2PromptState.ts) `TIER2_PROMPT_BUTTONS` becomes `['Use for this Publish', 'Always use (save setting)']`. `resolveTier2PromptDecision` no longer recognizes `'No, fall back to recursive search'`; it returns `'use-once'`, `'use-persist'`, or `'cancel'`. The `Tier2PromptDecision` and `Tier2PromptOutcome` tagged unions drop the `'decline'` variant. The modal's message body keeps the unresolved-token list and the `Directory.Build.props` context and ends with: *"Cancel to abort this Publish; you can also set `serviceFabric.deploy.packagePath` directly."*
9. **The Memento read/write paths in the prompt are removed.** `Tier2PromptHost.getMementoFlag` / `setMementoFlag`, the `runTier2Prompt` suppression check ([tier2PromptState.ts L162-L177](src/deploy/tier2PromptState.ts#L162)), and the `'suppressed-memento'` / `'declined'` outcomes are deleted. `tier2SuppressKey` and `TIER2_PROMPT_SUPPRESS_KEY_PREFIX` stay exported (with a `@deprecated` JSDoc) because the legacy-cleanup command still uses the prefix to identify stale entries.
10. **`serviceFabric.deploy.suppressMsbuildEvaluatorPrompt` survives but loses its `searchMaxDepth` reference.** The setting still silences the prompt; its description is rewritten to: *"Skip the modal prompt that offers to enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` when Tier 1 expansion leaves unresolved MSBuild properties (e.g. `$(BuildOutputPath)` defined in `Directory.Build.props`). Power users and CI configurations can set this to `true` to keep Publish behavior strictly governed by `useMsbuildPropertyEvaluator`. Does not affect projects whose Tier 1 expansion resolves every token."*
11. **`serviceFabric.deploy.useMsbuildPropertyEvaluator` description is rewritten** to drop the "AND the recursive search is missing the package" qualifier: *"When true, fall back to invoking `MSBuild.exe -getProperty:` to resolve `<OutputPath>` / `<PackageLocation>` values that reference properties defined in imported targets (e.g. `Microsoft.ServiceFabric.targets`, `Directory.Build.props`). The in-extension expander handles all properties declared in the `.sfproj`'s own `<PropertyGroup>` blocks; enable this only when your build relies on imported-property expansion. Adds 1–3 s per Publish on cold cache."*
12. **`serviceFabric.deploy.packagePath` description is rewritten** to reflect that the override path is scanned up to `searchMaxDepth` levels (was: documented separately as "override-rooted recursive search" in 1.1.9): *"Override the application package path passed to `Deploy-FabricApplication.ps1`. Useful when MSBuild outputs the package somewhere other than the project's `<OutputPath>` / `<PackageLocation>` and the standard `pkg\<Configuration>\` location — e.g. monorepo drops to a sibling folder. Accepts an absolute path or a path relative to the `.sfproj` directory. The resolver looks for `ApplicationManifest.xml` directly under this path, and (bounded by `serviceFabric.deploy.searchMaxDepth`) under nested subdirectories. MSBuild property references (`$(MSBuildProjectName)`, `$(Configuration)`, etc.) are expanded against the `.sfproj`'s `<PropertyGroup>` values. When this setting resolves to a package whose `ApplicationTypeName` does not match the project's declared type, a modal warning prompts before deploy (not persisted). Leave empty to auto-detect."*
13. **`serviceFabric.resetTier2Prompt` becomes a one-shot legacy-cleanup command.** Its handler walks `workspaceState.keys()` for the `serviceFabric.deploy.tier2PromptSuppressedFor:` prefix, clears every match, and shows the toast as today. The command's `title` becomes *"Reset Tier 2 Property-Evaluator Prompt (legacy cleanup)"* and the help text notes that "decline" is no longer a prompt option, so the command exists only to wipe stale 1.1.10 entries. The command is **not** deleted in 1.1.11 — that's deferred to a future release once entries are sufficiently aged out.
14. **`deployFlow.ts` plumbing simplifies.** The `searchRoot` field drops from the `resolveApplicationPackageRoot` call ([L292](src/deploy/deployFlow.ts#L292)). `searchMaxDepth` is still read from configuration and passed through (the existing range-check + warning at [L178-L188](src/deploy/deployFlow.ts#L178) stays; the `getConfiguration().get<number>(..., 4)` default-fallback is lowered to `2` to match the new `package.json` default). The Tier 1 unresolved-tokens diagnostic line ([L249-L253](src/deploy/deployFlow.ts#L249)) — currently *"Falling back to … recursive search."* — is rewritten to: *"Resolution will `${useEvaluator ? 'attempt MSBuild -getProperty' : 'fail unless serviceFabric.deploy.useMsbuildPropertyEvaluator is enabled or serviceFabric.deploy.packagePath is set'}`."*
15. **Pure-resolver guarantee preserved.** [`packageResolver.ts`](src/deploy/packageResolver.ts) does not import `vscode`, does not gain new fs operations, and the `ProbeFs` interface is unchanged (`pathExists` / `readDirectories` / `readApplicationTypeName` all still used). `searchForManifest` is retained (renamed `scanForManifestUnder(candidate, maxDepth)` if a rename clarifies the scope; see §5.1). `SKIP_DIRS` is retained and expanded.
16. **Tests:** baseline net change is **−4 to −8** unit tests. Four are removed (the four pure project-wide recursive-search cases at [packageResolver.test.ts L336, L383, L405, L428](test/unit/packageResolver.test.ts)). The override-rooted-recursive-search `describe` block ([L851-L1066](test/unit/packageResolver.test.ts#L851)) is largely **repurposed** rather than deleted — its cases assert the *same* depth-N behavior under override candidates that now applies to all candidates, so they survive with minor relabels. New tests cover the depth-N scan under auto-discovered (`<OutputPath>` / `pkg\<Configuration>\`) candidates and the new actionable-error message. The Tier 2 prompt decline cases are removed.
17. **No package-version bump in `package.json`.** Stays at the current release until the release script bumps it.
18. **`CHANGELOG.md`** has a new `## 1.1.11` section above the existing `## 1.1.10`. The first two bullets are labelled **Breaking change** in bold so users skimming the changelog notice both the project-wide-search removal and the override-special-case removal.
19. **Existing tests stay green.** The Tier 1 expander, candidate-collection, Tier 2 evaluator, override-type-mismatch, and ambiguous-disambiguation tests pass unchanged.

## 3. Non-goals

- **Removing `serviceFabric.deploy.searchMaxDepth`.** The setting is retained because the per-candidate depth-N scan is a real user-facing feature, not legacy noise. Users with deep monorepo layouts can tune it; the default of `2` covers the SDK template layouts and the common monorepo cases.
- **Type-validating every single-hit deep accept under auto-discovered candidates.** The existing rule — single hits under override candidates get `confirmOverrideTypeMatch`, single hits under auto-discovered candidates don't — is preserved. Auto-discovered candidates derive from the project's own declarations and "cannot mismatch by construction" (per Plan 1.1.9 §5.7). Tightening this would also affect the existing depth-1 single-immediate-child probe and is a separate decision.
- **Deleting `serviceFabric.resetTier2Prompt` outright.** Existing 1.1.10 workspaces may have written `tier2PromptSuppressedFor:*` entries the user wants to clear. Keeping the command for at least one release lets us schedule its removal once the entries are demonstrably aged out.
- **Rewriting the candidate ladder.** Steps 1–5 in §0 stay in their current order. The legacy `bin\<Configuration>\pkg` and `bin\<Configuration>` candidates remain.
- **Changing the SDK-required folder shape.** The resolver still returns the folder that *directly* contains `ApplicationManifest.xml`. Deep accepts return the deeper folder, not the candidate root.
- **Telemetry for the actionable-error path.** Out of scope. The output channel logs the error message verbatim. A follow-up plan can wire `extension.deploy.resolution.actionableErrorShown` if usage data is needed.
- **Migrating existing decline Memento entries to a new shape.** They become inert; the legacy-cleanup command exists for users who want to wipe them. We do not auto-clear on extension startup.
- **Adding a "validate `<OutputPath>` / `<PackageLocation>` declarations against MSBuild ground truth" preflight.** Tier 2 already covers this when enabled; pre-validating without the user opting into Tier 2 would re-introduce the implicit-spawn behavior Plan 1.1.9 §0 rejected.
- **Surfacing the Tier 2 prompt for any reason other than unresolved tokens.** No change from 1.1.10 — the precondition is `unresolvedTokens.size > 0`.
- **Adding a sixth candidate for "the SDK changed its default."** If `Microsoft.ServiceFabric.targets` ever moves the default landing zone, that's a follow-up plan that updates step 4 of the candidate ladder.
- **Reintroducing project-wide recursive search behind a setting.** No `serviceFabric.deploy.enableProjectWideFallback` escape valve. The project-wide blast radius is exactly the bug being fixed; preserving it as a setting just hides the risk behind discoverability rather than fixing it. (Users with truly non-standard layouts have `serviceFabric.deploy.packagePath` — pointing at any folder they choose, with depth-N scan applied automatically.)

## 4. Surface area at a glance

| Change | Where | Notes |
|---|---|---|
| Delete project-wide recursive-search block | [packageResolver.ts L268-L291](src/deploy/packageResolver.ts#L268) | Removes the `if (options.searchRoot) { … }` clause inside `resolveApplicationPackageRoot`. |
| Delete override-only recursive-search block | [packageResolver.ts L373-L424](src/deploy/packageResolver.ts#L373) | Subsumed by the generalized per-candidate depth-N scan. |
| Generalize per-candidate scan from depth-1 to depth-N | [packageResolver.ts L356-L372](src/deploy/packageResolver.ts#L356) | Replace the immediate-children loop with `scanForManifestUnder(candidate.path, maxDepth)` followed by the existing `disambiguateHits` flow. Source label gains `(nested depth N)` suffix. |
| Retain `searchForManifest`; rename to `scanForManifestUnder` | [packageResolver.ts L559-L580](src/deploy/packageResolver.ts#L559) | Same algorithm; rename clarifies the per-candidate scope. Returns up to `maxDepth` levels deep. |
| Expand `SKIP_DIRS` | [packageResolver.ts L549-L555](src/deploy/packageResolver.ts#L549) | Add `bin`, `obj`, `out`, `artifacts`, `_published`, `TestResults`, `node_modules`. |
| Drop `searchRoot` from `ResolveOptions` | [packageResolver.ts L131-L135](src/deploy/packageResolver.ts#L131) | Field deleted; JSDoc updated to describe the per-candidate scope. |
| Retain `searchMaxDepth` on `ResolveOptions`; lower default to `2` | [packageResolver.ts L136-L137](src/deploy/packageResolver.ts#L136) | JSDoc rewritten: "Per-candidate recursion depth limit (default 2)". In-code fallback `options.searchMaxDepth ?? 2`. |
| Rewrite final actionable error | [packageResolver.ts L295-L297](src/deploy/packageResolver.ts#L295) | New message names both escape hatches. |
| Update opening guard | [packageResolver.ts L240-L243](src/deploy/packageResolver.ts#L240) | Drop the `!options.searchRoot` clause; the guard becomes `if (candidates.length === 0 && !options.evaluateMsbuildProperties)`. |
| Drop `searchRoot` arg from resolver call | [deployFlow.ts L292](src/deploy/deployFlow.ts#L292) | One-line removal. `searchMaxDepth: searchMaxDepth` stays. |
| Retain `searchMaxDepth` config read + warning | [deployFlow.ts L178-L188](src/deploy/deployFlow.ts#L178) | No change. |
| Rewrite Tier 1 unresolved-tokens diagnostic | [deployFlow.ts L249-L253](src/deploy/deployFlow.ts#L249) | Message no longer references "recursive search". |
| Two-button Tier 2 prompt | [tier2PromptState.ts L122-L128](src/deploy/tier2PromptState.ts#L122) | `TIER2_PROMPT_BUTTONS` shrinks to two entries; modal message body updated. |
| Drop `'decline'` from `Tier2PromptDecision` | [tier2PromptState.ts L16-L37](src/deploy/tier2PromptState.ts#L16) | `resolveTier2PromptDecision` returns `'use-once' \| 'use-persist' \| 'cancel'`. |
| Drop Memento read/write from prompt | [tier2PromptState.ts L40-L55, L162-L177](src/deploy/tier2PromptState.ts#L40) | `Tier2PromptHost` loses `getMementoFlag` / `setMementoFlag`; `runTier2Prompt` skips the suppression check. |
| Drop `'suppressed-memento'` / `'declined'` from `Tier2PromptOutcome` | [tier2PromptState.ts L57-L72](src/deploy/tier2PromptState.ts#L57) | Two enum members gone. |
| Mark `tier2SuppressKey` `@deprecated` | [tier2PromptState.ts L40-L55](src/deploy/tier2PromptState.ts#L40) | Retained for the legacy-cleanup command; not used by `runTier2Prompt`. |
| Update `serviceFabric.resetTier2Prompt` UX strings | [extension.ts](src/extension.ts) (registration site), [package.json](package.json) `contributes.commands` | Title gains `(legacy cleanup)`; toast mentions "stale entries from 1.1.10". |
| Rewrite `searchMaxDepth` description + lower default | [package.json](package.json) line 576 onward | New scope: per-candidate. Default lowered from `4` to `2`; range `1–16` unchanged. |
| Rewrite `suppressMsbuildEvaluatorPrompt` description | [package.json](package.json) line 574 | Drop `searchMaxDepth` reference. |
| Rewrite `useMsbuildPropertyEvaluator` description | [package.json](package.json) line 568 | Drop "recursive search is missing the package" phrase. |
| Rewrite `deploy.packagePath` description | [package.json](package.json) line 562 | Note depth-N scan applies (replaces "recursive search" subsection in HOWTO). |
| Tests (deletions) | [test/unit/packageResolver.test.ts](test/unit/packageResolver.test.ts) | Four project-wide-search `it(…)` blocks removed; the `'Tier 2 evaluator throws'` / `'evaluator returns empty'` cases re-anchor to the actionable error. |
| Tests (relabels / minor edits) | [test/unit/packageResolver.test.ts L851-L1066](test/unit/packageResolver.test.ts#L851) | Override-rooted-recursive-search `describe` block becomes the generalized per-candidate depth-N suite; the override-specific assertions stay (single-hit gets `confirmOverrideTypeMatch`, multi-hit goes through `disambiguateHits`). |
| Tests (additions) | [test/unit/packageResolver.test.ts](test/unit/packageResolver.test.ts) | Three new `it(…)`: (a) depth-2 manifest under `<OutputPath>` is found; (b) depth-N multi-hit under `<OutputPath>` disambiguates by type; (c) the actionable-error message names both setting names. |
| Tests (deletions) | [test/unit/tier2PromptState.test.ts](test/unit/tier2PromptState.test.ts) | The `'No, fall back …'` decision-mapping case, the `'declined'` outcome cases, the Memento round-trip cases, the case-insensitive `tier2SuppressKey` cases. |
| Tests (additions) | [test/unit/tier2PromptState.test.ts](test/unit/tier2PromptState.test.ts) | One `it(…)` asserting `TIER2_PROMPT_BUTTONS.length === 2`; one asserting `resolveTier2PromptDecision('No, fall back to recursive search') === 'cancel'` (forward-compat). |
| Docs | [docs/HOWTO.md](docs/HOWTO.md) §8.1 (resolution + override-rooted blocks); [docs/HOWTO.md §12](docs/HOWTO.md) settings + commands rows; [CHANGELOG.md](CHANGELOG.md); [README.md](README.md) Features bullet refresh | See §9. |

## 5. Implementation

Order chosen to keep the working tree compilable at every step. Run the test suite between each substep.

### 5.1 Refactor `packageResolver.ts`

The core change inside `sweepCandidates` is to replace the "depth-1 single-immediate-child probe" with a uniform "depth-N scan" applied to every candidate. The override-only recursive block is deleted because its behavior is now the default.

Step-by-step in the resolver:

1. Delete the Tier 3 block at [packageResolver.ts L268-L291](src/deploy/packageResolver.ts#L268) (the `if (options.searchRoot) { … }` clause).
2. Delete the override-only recursive-search block at [packageResolver.ts L373-L424](src/deploy/packageResolver.ts#L373) (the `if (candidate.source.startsWith('serviceFabric.deploy.packagePath') && options.searchMaxDepth !== undefined && …)` clause).
3. Replace the depth-1 single-immediate-child probe ([L356-L372](src/deploy/packageResolver.ts#L356)) with the depth-N scan. The new shape:

   ```ts
   // After the depth-0 direct match, scan up to `maxDepth` levels deep
   // under THIS candidate. Applies uniformly to user-set overrides AND
   // auto-discovered candidates — the candidate path is already a
   // declared signal that "look under here" is acceptable.
   const maxDepth = options.searchMaxDepth ?? 2;
   const hits = await scanForManifestUnder(fs, candidate.path, maxDepth);

   if (hits.length === 1) {
       await confirmOverrideTypeMatch(fs, candidate, hits[0], options);
       const suffix = hits[0] === candidate.path ? '' : ' (nested)';
       return { path: hits[0], source: `${candidate.source}${suffix}` };
   }
   if (hits.length > 1) {
       const disambiguated = await disambiguateHits(
           fs,
           hits,
           options.expectedApplicationTypeName,
           options.onAmbiguous
       );
       if (disambiguated) {
           return {
               path: disambiguated.path,
               source: `${candidate.source} ${disambiguated.sourceSuffix}`
           };
       }
       const labelled = await describeHits(fs, hits);
       throw new Error(
           `Multiple application type folders contain ApplicationManifest.xml under ${candidate.path}: ${labelled}.${
               options.expectedApplicationTypeName
                   ? ` None matched expected ApplicationTypeName '${options.expectedApplicationTypeName}'.`
                   : ''
           } Set serviceFabric.deploy.packagePath to disambiguate.`
       );
   }
   // zero hits — fall through to the next candidate.
   ```

   Note: the existing `scanForManifestUnder` (renamed from `searchForManifest`) is reused. The depth-0 case is *included* in the hits — when `containsManifest(candidate.path)` returns true, the scan returns `[candidate.path]` and the single-hit branch accepts it with no `(nested)` suffix. This collapses the explicit depth-0 check + depth-1 immediate-child check + override deep scan into a single uniform path.

4. Delete the now-unused explicit depth-0 check ([L351-L355](src/deploy/packageResolver.ts#L351)) since the depth-N scan handles depth 0 too. Alternatively, keep the depth-0 fast-path for the common case (one `pathExists` call vs. a full scan); §11 Q1 weighs the tradeoff. **Verdict (taken in §11): keep depth-0 as an explicit fast-path** — preserves the existing `'default pkg\\Debug'` source label without the `(nested)` suffix for the typical case, and avoids a `readDirectories` call on every Publish for the 99% case where the manifest is directly under the candidate.
5. Rename `searchForManifest` → `scanForManifestUnder` ([L559-L580](src/deploy/packageResolver.ts#L559)). Update the JSDoc to clarify per-candidate scope. Algorithm unchanged.
6. Expand `SKIP_DIRS` ([L549-L555](src/deploy/packageResolver.ts#L549)) to:

   ```ts
   const SKIP_DIRS = new Set([
       'node_modules',
       '.git',
       '.vs',
       '.vscode',
       'obj',
       'bin',
       'out',
       'artifacts',
       '_published',
       'TestResults',
       'packages'
   ]);
   ```

   Note: `bin`, `obj`, `out`, `artifacts` are *common* output folder names, but a user's `<OutputPath>` may legitimately point inside one (e.g. `<OutputPath>=bin\Debug\sfpkg\` for older templates). `SKIP_DIRS` is consulted by `scanForManifestUnder` only when descending into a *child* directory whose name matches — the candidate root itself is always probed. So `<OutputPath>=bin\Debug\sfpkg` works because the scan starts at `bin\Debug\sfpkg`, never recurses into a *nested* `bin\`.
7. Delete `ResolveOptions.searchRoot` ([L131-L135](src/deploy/packageResolver.ts#L131)). Retain `ResolveOptions.searchMaxDepth` ([L136-L137](src/deploy/packageResolver.ts#L136)) — rewrite its JSDoc:

   ```ts
   /**
    * Per-candidate recursion depth limit for the `ApplicationManifest.xml`
    * scan applied to each declared candidate (default 2 — covers depth-0
    * direct, depth-1 immediate-child, and depth-2 nested-Pkg layouts).
    * Set to 0 to restrict scanning to depth-0 (direct match only).
    * Sensible upper bound for monorepo drops is around 16; beyond that,
    * prefer `serviceFabric.deploy.packagePath` to point directly at the
    * package folder.
    */
   readonly searchMaxDepth?: number;
   ```

8. Edit the opening guard ([L240-L243](src/deploy/packageResolver.ts#L240)):

   ```ts
   // before:
   if (candidates.length === 0 && !options.searchRoot && !options.evaluateMsbuildProperties) {
       throw new Error(
           'No candidate package roots to probe. Configure serviceFabric.deploy.packagePath or rebuild the project.'
       );
   }

   // after:
   if (candidates.length === 0 && !options.evaluateMsbuildProperties) {
       throw new Error(
           'No candidate package roots to probe. Configure serviceFabric.deploy.packagePath or rebuild the project.'
       );
   }
   ```

9. Rewrite the final throw ([L295-L297](src/deploy/packageResolver.ts#L295)):

   ```ts
   throw new Error(
       `Could not locate ApplicationManifest.xml. Probed: ${probed.join(', ')}. ` +
           `The Package build may not have produced any output, or the package is in a non-standard location. ` +
           `Set serviceFabric.deploy.packagePath to the package folder, or enable ` +
           `serviceFabric.deploy.useMsbuildPropertyEvaluator if your <OutputPath>/<PackageLocation> references ` +
           `properties defined in Directory.Build.props or imported .targets.`
   );
   ```

10. Update the function-level JSDoc for `resolveApplicationPackageRoot` ([L226-L234](src/deploy/packageResolver.ts#L226)):

    ```
     * Walk the candidate list in order. For each candidate, accept it if it
     * directly contains `ApplicationManifest.xml`, or scan up to
     * `searchMaxDepth` levels deep for nested layouts (handled by
     * `scanForManifestUnder`). On multi-hit, `disambiguateHits` auto-matches
     * by ApplicationTypeName or surfaces the `onAmbiguous` quick-pick.
     *
     * When no candidate matches and `evaluateMsbuildProperties` is supplied,
     * await it for additional candidates and re-run the sweep. When that also
     * misses (or the callback wasn't supplied), throw an actionable Error
     * pointing at the two real escape hatches: `serviceFabric.deploy.packagePath`
     * and `serviceFabric.deploy.useMsbuildPropertyEvaluator`.
    ```

11. Confirm `ProbeFs.readDirectories` is still used (yes — by `scanForManifestUnder`). Do not remove it.

### 5.2 Trim `deployFlow.ts`

The only resolver-call change is dropping `searchRoot`. `searchMaxDepth` keeps flowing through unchanged.

```ts
// before:
const resolved = await resolveApplicationPackageRoot(
    candidates,
    createProbeFs(),
    {
        searchRoot: project.sfproj.directory,
        searchMaxDepth,
        expectedApplicationTypeName: project.applicationManifest?.applicationTypeName,
        onAmbiguous: hits => promptForPackageRoot(hits, logger),
        evaluateMsbuildProperties,
        onOverrideTypeMismatch
    }
);

// after:
const resolved = await resolveApplicationPackageRoot(
    candidates,
    createProbeFs(),
    {
        searchMaxDepth,
        expectedApplicationTypeName: project.applicationManifest?.applicationTypeName,
        onAmbiguous: hits => promptForPackageRoot(hits, logger),
        evaluateMsbuildProperties,
        onOverrideTypeMismatch
    }
);
```

The `searchMaxDepth` config read + range-check + warning ([L178-L188](src/deploy/deployFlow.ts#L178)) keeps its existing range-check and clamp-to-default-with-warning behavior. Two small edits: the surrounding comment is rewritten from the 1.1.9-vintage "configurable recursive-search depth" wording to "configurable per-candidate scan depth", and the `getConfiguration(...).get<number>(...)` default-fallback argument is lowered from `4` to `2` (matches the new `package.json` default):

```ts
// before:
// 1.1.9 Objective 3 — read configurable recursive-search depth.
const configuredDepth = vscode.workspace
    .getConfiguration('serviceFabric')
    .get<number>('deploy.searchMaxDepth', 4);

// after:
// Per-candidate scan depth (Plan 1.1.9 setting; Plan 1.1.11 generalized
// from override-only to all declared candidates; default lowered 4 → 2).
const configuredDepth = vscode.workspace
    .getConfiguration('serviceFabric')
    .get<number>('deploy.searchMaxDepth', 2);
```

Rewrite the Tier 1 unresolved-tokens diagnostic ([L249-L253](src/deploy/deployFlow.ts#L249)):

```ts
logger.info(
    `Unresolved MSBuild properties in package-path candidates: ${[...unresolvedTokens]
        .map(t => `$(${t})`)
        .join(', ')}. ${
            useEvaluator
                ? 'Tier 2 (MSBuild -getProperty) will attempt to resolve them.'
                : 'Resolution will fail unless serviceFabric.deploy.useMsbuildPropertyEvaluator is enabled or serviceFabric.deploy.packagePath is set to the package folder.'
        }`
);
```

The Plan 1.1.10 prompt-host wires `getMementoFlag` / `setMementoFlag` ([L218-L222](src/deploy/deployFlow.ts#L218)). Remove those two host members from the construction site (they're deleted from the `Tier2PromptHost` interface in §5.3).

### 5.3 Simplify the Tier 2 prompt

In [tier2PromptState.ts](src/deploy/tier2PromptState.ts):

```ts
export type Tier2PromptDecision = 'use-once' | 'use-persist' | 'cancel';

export function resolveTier2PromptDecision(answer: string | undefined): Tier2PromptDecision {
    switch (answer) {
        case 'Use for this Publish':
            return 'use-once';
        case 'Always use (save setting)':
            return 'use-persist';
        default:
            // Includes the legacy 'No, fall back to recursive search' label
            // (removed in 1.1.11) — fall-through to cancel is safe if a stale
            // serialized answer ever surfaces.
            return 'cancel';
    }
}
```

Drop the `'declined'` and `'suppressed-memento'` variants from `Tier2PromptOutcome`:

```ts
export type Tier2PromptOutcome =
    | 'use-once'
    | 'use-persist'
    | 'persist-failed'
    | 'cancelled'
    | 'suppressed-setting';
```

Trim `Tier2PromptHost`:

```ts
export interface Tier2PromptHost {
    isPromptSuppressedBySetting(): boolean;
    showPrompt(message: string, buttons: readonly string[]): Promise<string | undefined>;
    persistEvaluatorSetting(): Promise<void>;
    readonly logger: Tier2PromptLogger;
}
```

Update buttons + message:

```ts
export const TIER2_PROMPT_BUTTONS = [
    'Use for this Publish',
    'Always use (save setting)'
] as const;

export function buildTier2PromptMessage(unresolvedTokens: ReadonlySet<string>): {
    readonly message: string;
    readonly sampleText: string;
} {
    const tokens = [...unresolvedTokens];
    const sample = tokens.slice(0, 3).map(t => `$(${t})`);
    const more = tokens.length - sample.length;
    const sampleText = sample.join(', ') + (more > 0 ? ` (+${more} more)` : '');
    const message =
        `The .sfproj's package paths reference MSBuild properties that aren't declared in the project itself ` +
        `(${sampleText}). These typically come from Directory.Build.props or imported .targets files.\n\n` +
        `Enable MSBuild property evaluation (serviceFabric.deploy.useMsbuildPropertyEvaluator) so this Publish ` +
        `can resolve them by spawning MSBuild?\n\n` +
        `Cancel to abort this Publish; you can also set serviceFabric.deploy.packagePath directly to the package folder.`;
    return { message, sampleText };
}
```

Rewrite `runTier2Prompt` to drop the Memento check and the `'decline'` switch arm. The simplified orchestrator:

```ts
export async function runTier2Prompt(
    host: Tier2PromptHost,
    input: Tier2PromptInput
): Promise<Tier2PromptResult> {
    if (host.isPromptSuppressedBySetting()) {
        host.logger.info('Tier 2 prompt suppressed by serviceFabric.deploy.suppressMsbuildEvaluatorPrompt.');
        return { useEvaluator: false, cancelled: false, outcome: 'suppressed-setting' };
    }

    host.logger.info(
        `Unresolved MSBuild properties in package-path candidates: ${[...input.unresolvedTokens]
            .map(t => `$(${t})`)
            .join(', ')}.`
    );

    const { message } = buildTier2PromptMessage(input.unresolvedTokens);
    const answer = await host.showPrompt(message, TIER2_PROMPT_BUTTONS);
    const decision = resolveTier2PromptDecision(answer);

    switch (decision) {
        case 'use-once':
            host.logger.info('Tier 2 enabled for this Publish (user choice; setting not persisted).');
            return { useEvaluator: true, cancelled: false, outcome: 'use-once' };

        case 'use-persist':
            try {
                await host.persistEvaluatorSetting();
                host.logger.info('Tier 2 enabled and persisted to workspace settings.');
                return { useEvaluator: true, cancelled: false, outcome: 'use-persist' };
            } catch (err) {
                host.logger.warn(
                    `Could not persist serviceFabric.deploy.useMsbuildPropertyEvaluator=true (${
                        (err as Error).message
                    }). Tier 2 still enabled for this Publish.`
                );
                return { useEvaluator: true, cancelled: false, outcome: 'persist-failed' };
            }

        case 'cancel':
            host.logger.info('Publish cancelled by user — declined MSBuild property evaluator prompt.');
            return { useEvaluator: false, cancelled: true, outcome: 'cancelled' };
    }
}
```

Keep `tier2SuppressKey` + `TIER2_PROMPT_SUPPRESS_KEY_PREFIX` exported with `@deprecated` JSDoc tags (used only by the legacy-cleanup command).

### 5.4 Update the legacy-cleanup command

In [extension.ts](src/extension.ts) (or wherever `serviceFabric.resetTier2Prompt` is registered):

```ts
context.subscriptions.push(
    vscode.commands.registerCommand('serviceFabric.resetTier2Prompt', async () => {
        const keys = context.workspaceState.keys().filter(k =>
            k.startsWith(TIER2_PROMPT_SUPPRESS_KEY_PREFIX)
        );
        for (const k of keys) {
            await context.workspaceState.update(k, undefined);
        }
        const noun = keys.length === 1 ? 'entry' : 'entries';
        logger.info(
            `Reset Tier 2 property-evaluator prompt: cleared ${keys.length} legacy ${noun} from 1.1.10.`
        );
        vscode.window.showInformationMessage(
            `Service Fabric: Cleared ${keys.length} legacy Tier 2 prompt ${noun}. ` +
                `(In 1.1.11+ the prompt no longer remembers per-project decisions; this command only ` +
                `clears stale entries from 1.1.10.)`
        );
    })
);
```

Update the command's `package.json` entry:

```jsonc
{
    "command": "serviceFabric.resetTier2Prompt",
    "title": "Reset Tier 2 Property-Evaluator Prompt (legacy cleanup)",
    "category": "Service Fabric"
}
```

### 5.5 `package.json` updates

Four description rewrites; **no removals**.

```jsonc
{
    "serviceFabric.deploy.packagePath": {
        "type": "string",
        "default": "",
        "description": "Override the application package path passed to Deploy-FabricApplication.ps1. Useful when MSBuild outputs the package somewhere other than the project's <OutputPath>/<PackageLocation> and the standard 'pkg\\<Configuration>\\' location — e.g. monorepo drops to a sibling folder. Accepts an absolute path or a path relative to the .sfproj directory. The resolver looks for ApplicationManifest.xml directly under this path, and (bounded by serviceFabric.deploy.searchMaxDepth) under nested subdirectories. MSBuild property references ($(MSBuildProjectName), $(Configuration), etc.) are expanded against the .sfproj's <PropertyGroup> values. When this setting resolves to a package whose ApplicationTypeName does not match the project's declared type, a modal warning prompts before deploy (not persisted). Leave empty to auto-detect."
    },
    "serviceFabric.deploy.useMsbuildPropertyEvaluator": {
        "type": "boolean",
        "default": false,
        "description": "When true, fall back to invoking MSBuild.exe -getProperty: to resolve <OutputPath>/<PackageLocation> values that reference properties defined in imported targets (e.g. Microsoft.ServiceFabric.targets, Directory.Build.props). The in-extension expander handles all properties declared in the .sfproj's own <PropertyGroup> blocks; enable this only when your build relies on imported-property expansion. Adds 1–3 s per Publish on cold cache."
    },
    "serviceFabric.deploy.suppressMsbuildEvaluatorPrompt": {
        "type": "boolean",
        "default": false,
        "description": "Skip the modal prompt that offers to enable serviceFabric.deploy.useMsbuildPropertyEvaluator when Tier 1 expansion leaves unresolved MSBuild properties (e.g. $(BuildOutputPath) defined in Directory.Build.props). Power users and CI configurations can set this to true to keep Publish behavior strictly governed by useMsbuildPropertyEvaluator. Does not affect projects whose Tier 1 expansion resolves every token."
    },
    "serviceFabric.deploy.searchMaxDepth": {
        "type": "integer",
        "default": 2,
        "minimum": 1,
        "maximum": 16,
        "description": "Maximum directory depth for the per-candidate ApplicationManifest.xml search applied to each declared package-root candidate (serviceFabric.deploy.packagePath, <PackageLocation>, <OutputPath>, pkg\\<Configuration>\\, ...). Default 2 covers the depth-0 direct, depth-1 immediate-child, and depth-2 nested-Pkg layouts produced by the SDK templates and common monorepo conventions; increase for deep monorepo drops (e.g. <repo>\\artifacts\\bin\\<App>\\<cfg>\\sfpkg\\<AppType>\\). Values outside [1, 16] fall back to the default and emit a warning."
    }
}
```

Confirm no other `package.json` location references "recursive search" (walkthrough markdown, etc.). Update any matches to "per-candidate scan" or remove the phrase outright.

### 5.6 Test updates

`test/unit/packageResolver.test.ts`:

- **Delete** the four pure project-wide-search `it(…)` blocks (line numbers per the grep at §1):
  - L336 `'auto-matches by ApplicationTypeName during recursive search'`
  - L383 `'falls back to recursive search when no candidate matches'`
  - L405 `'skips node_modules / .git / obj during recursive search'`
  - L428 `'throws when recursive search returns multiple matches'`
- **Rewrite** `it('falls through to recursive search when the evaluator throws', …)` ([L594](test/unit/packageResolver.test.ts#L594)) to assert `throws actionable error` instead of `recursive search` source.
- **Rewrite** `it('handles empty evaluator output gracefully', …)` ([L618](test/unit/packageResolver.test.ts#L618)) similarly.
- **Repurpose** the `describe('resolveApplicationPackageRoot override-rooted recursive search (Plan 1.1.9 Obj 3)', …)` block ([L851-L1066](test/unit/packageResolver.test.ts#L851)) → rename to `describe('resolveApplicationPackageRoot per-candidate depth-N scan (Plan 1.1.11)')`. The override-specific cases (single hit + override + type-mismatch prompt, multi-hit + disambiguate) stay; their setup blocks are simplified (no more "auto-discovered candidates skip recursion" carve-out test — that's gone with the change).
- **Add** three new `it(…)`:

  ```ts
  it('finds a depth-2 manifest under an auto-discovered <OutputPath>', async () => {
      // <OutputPath>=bin\Debug\sfpkg; manifest at bin\Debug\sfpkg\MyApp\Pkg\ApplicationManifest.xml.
      // Plan 1.1.11 — auto-discovered candidates now get the same depth-N
      // treatment that override candidates had in 1.1.9 Obj 3.
      const fs = makeFs({
          'C:\\repo\\sf\\bin\\Debug\\sfpkg': [],
          'C:\\repo\\sf\\bin\\Debug\\sfpkg\\MyApp': [],
          'C:\\repo\\sf\\bin\\Debug\\sfpkg\\MyApp\\Pkg': [],
          'C:\\repo\\sf\\bin\\Debug\\sfpkg\\MyApp\\Pkg\\ApplicationManifest.xml': true
      });
      const result = await resolveApplicationPackageRoot(
          [{ path: 'C:\\repo\\sf\\bin\\Debug\\sfpkg', source: 'sfproj <OutputPath>' }],
          fs,
          { searchMaxDepth: 2 }
      );
      assert.equal(result.path, 'C:\\repo\\sf\\bin\\Debug\\sfpkg\\MyApp\\Pkg');
      assert.match(result.source, /sfproj <OutputPath>.*nested/);
  });

  it('disambiguates a depth-N multi-hit under <OutputPath> by ApplicationTypeName', async () => {
      // Two apps share out\sfpkg\; each at depth 2 with different ApplicationTypeNames.
      // … (test body modeled on the existing 1.1.9 override-multi-hit case).
  });

  it('actionable error message names both serviceFabric.deploy.packagePath and useMsbuildPropertyEvaluator', async () => {
      const fs = makeFs({});
      const candidates = [{ path: 'C:\\repo\\sf\\pkg\\Debug', source: 'default pkg\\Debug' }];
      try {
          await resolveApplicationPackageRoot(candidates, fs, { searchMaxDepth: 2 });
          assert.fail('expected throw');
      } catch (err) {
          const msg = (err as Error).message;
          assert.match(msg, /serviceFabric\.deploy\.packagePath/);
          assert.match(msg, /serviceFabric\.deploy\.useMsbuildPropertyEvaluator/);
          assert.match(msg, /Directory\.Build\.props/);
          assert.match(msg, /Probed:/);
      }
  });
  ```

`test/unit/tier2PromptState.test.ts`:

- **Delete** the cases tied to the `'decline'` decision, the `'declined'` outcome, the Memento round-trip, the case-insensitive `tier2SuppressKey` suite (full list per the grep at §1).
- **Update** the buttons-array assertion ([L225](test/unit/tier2PromptState.test.ts#L225)) to:

  ```ts
  assert.deepStrictEqual(seen, ['Use for this Publish', 'Always use (save setting)']);
  ```

- **Add** `it('TIER2_PROMPT_BUTTONS contains exactly two labels', …)` (regression guard).
- **Add** `it('legacy "No, fall back to recursive search" label maps to cancel', …)` (forward-compat).

Run `npm run test` after each substep. Expected total test-count delta vs. the post-1.1.10 baseline: **−4 to −8** tests (depending on how many decline-flavored cases existed), partially offset by the three new per-candidate-depth-N cases.

### 5.7 Verify integration test stubs

Search [test/unit/deployFlow.tier2Prompt.test.ts](test/unit/deployFlow.tier2Prompt.test.ts) (if present per Plan 1.1.10's §8) for `Tier2PromptHost` stubs that wire `getMementoFlag` / `setMementoFlag`. Remove those two stub members. Any test asserting the `'declined'` outcome flow is deleted.

Verify (via grep) that no production source still imports `searchForManifest` (renamed to `scanForManifestUnder`) or references `searchRoot`. Expected: zero matches after the §5.1 / §5.2 trims.

## 6. Edge cases

- **User has `useMsbuildPropertyEvaluator: true` from 1.1.10.** No prompt fires. Tier 2 runs as today. Publish behavior unchanged.
- **User has `useMsbuildPropertyEvaluator: false` AND `suppressMsbuildEvaluatorPrompt: true` AND a project that previously survived only via project-wide search.** First Publish after upgrade fails with the actionable error. The error names both fixes; the user enables Tier 2 (or sets `packagePath`) and proceeds. **Documented behavioral regression** — call out in the CHANGELOG breaking-change bullet.
- **User has a project whose `<OutputPath>` points at a shared monorepo drop with manifests at depth 2.** Pre-1.1.11: depth-1 probe misses; project-wide search rescues (if it found a unique manifest), often picking the wrong package. Post-1.1.11: depth-N scan under `<OutputPath>` finds all manifests; `disambiguateHits` selects the one matching the `.sfproj`'s declared `ApplicationTypeName`; deploy succeeds. **This is the canonical case the depth-N generalization enables.**
- **User has `serviceFabric.deploy.searchMaxDepth: 8` in `settings.json`.** Honored as today (range-checked to `[1, 16]`); the per-candidate scan now uses depth 8 under every declared candidate.
- **User has a project's `<OutputPath>` that points at a folder whose immediate child contains a *stale* manifest at depth 2 (from a previous app).** Single-hit accept under auto-discovered candidate, no type validation. The same blind spot as today's depth-1 single-immediate-child probe; not worse. Mitigation in the (out-of-scope) future plan: type-validate every single-hit accept regardless of override status.
- **User has `<OutputPath>` pointing at a folder with multiple manifests at depth 2 and one of them matches the `.sfproj`'s declared `ApplicationTypeName`.** `disambiguateHits` silently picks the matching one. No prompt.
- **User has `<OutputPath>` pointing at a folder with multiple manifests, none matching the type.** `onAmbiguous` quick-pick fires (existing 1.1.9 behavior).
- **User has stale `serviceFabric.deploy.searchMaxDepth` value beyond range.** Existing range-check in [deployFlow.ts L181-L188](src/deploy/deployFlow.ts#L181) clamps to default and warns. No change.
- **User has stale `tier2PromptSuppressedFor:*` entries in `workspaceState` from 1.1.10.** Inert. `runTier2Prompt` no longer reads them. The user can run **Service Fabric: Reset Tier 2 Property-Evaluator Prompt (legacy cleanup)** to clear them.
- **A project's `<OutputPath>` is set to a path that exists but contains no manifest at any depth.** Candidate fails. Resolver continues. If all candidates fail, the actionable error fires.
- **A test fixture has its own `ApplicationPackageRoot/ApplicationManifest.xml`.** Pre-1.1.11, project-wide search could pick it up. Post-1.1.11, only picked up if it falls under a *declared* candidate (which it doesn't, unless the user explicitly configures `packagePath` to point at the fixture). Fixture safe.
- **A monorepo user runs Publish with `<PackageLocation>$(BuildOutputPath)\…</PackageLocation>` and no Tier 2 enabled.** Tier 1 prompt fires (per Plan 1.1.10); user picks **Always use** → Tier 2 resolves the property → the depth-N scan finds the manifest under the now-existent candidate root → deploy succeeds.
- **CI Publish with `suppressMsbuildEvaluatorPrompt: true` AND `useMsbuildPropertyEvaluator: true`.** No prompt; Tier 2 runs; deploy succeeds. CI configurations should pin both settings explicitly.
- **A user clicks the Tier 2 prompt's third button before realizing it's gone.** It's gone — only two buttons declared. The legacy label still maps to `'cancel'` in `resolveTier2PromptDecision` for forward-compat.
- **`SKIP_DIRS` expansion accidentally excludes a legitimately-named user folder.** Mitigation: `SKIP_DIRS` is consulted only when *descending* into a child. The candidate root itself is always scanned. So `<OutputPath>=bin\Debug\sfpkg` still works even though `bin` is in `SKIP_DIRS` — the scan starts at `bin\Debug\sfpkg`, not at the project root. A user-named `bin\` *inside* a declared candidate root (e.g. `<OutputPath>\bin\` containing a manifest) would be skipped — extremely uncommon, and the user can always set `packagePath` to point at the manifest folder directly.

## 7. Telemetry

Out of scope. Existing `extension.deploy.*` events (per Plan 1.1.8) continue to fire. The actionable error and the simplified prompt outcomes are observable via the output channel; if usage data on the actionable-error frequency or per-candidate scan depth distribution becomes interesting, a follow-up plan can add corresponding events.

## 8. Tests

Net delta: roughly **−4 to −8** unit tests across [test/unit/packageResolver.test.ts](test/unit/packageResolver.test.ts) and [test/unit/tier2PromptState.test.ts](test/unit/tier2PromptState.test.ts), partially offset by **+3** new contract-locking assertions and the survival/repurposing of the Plan 1.1.9 Obj 3 cases.

`packageResolver.test.ts` — deletions:

1. ✗ `'auto-matches by ApplicationTypeName during recursive search'` ([L336](test/unit/packageResolver.test.ts#L336))
2. ✗ `'falls back to recursive search when no candidate matches'` ([L383](test/unit/packageResolver.test.ts#L383))
3. ✗ `'skips node_modules / .git / obj during recursive search'` ([L405](test/unit/packageResolver.test.ts#L405))
4. ✗ `'throws when recursive search returns multiple matches'` ([L428](test/unit/packageResolver.test.ts#L428))

`packageResolver.test.ts` — rewrites:

5. ✎ `'falls through to recursive search when the evaluator throws'` → `'throws actionable error when the evaluator throws and no candidates match'`
6. ✎ `'handles empty evaluator output gracefully'` → assert actionable error instead of recursive-search source.
7. ✎ Repurpose the `describe('… override-rooted recursive search (Plan 1.1.9 Obj 3)', …)` block to `describe('… per-candidate depth-N scan (Plan 1.1.11)')`. Keep the existing single-hit-with-override-type-mismatch and multi-hit-disambiguate cases; delete the "does NOT recursively search under auto-discovered candidates" case ([L973](test/unit/packageResolver.test.ts#L973)) — that's exactly the behavior being reversed.

`packageResolver.test.ts` — additions:

8. ➕ `'finds a depth-2 manifest under an auto-discovered <OutputPath>'` (covers the canonical case the depth-N generalization enables).
9. ➕ `'disambiguates a depth-N multi-hit under <OutputPath> by ApplicationTypeName'` (covers shared-monorepo-output multi-app case).
10. ➕ `'actionable error message names both serviceFabric.deploy.packagePath and useMsbuildPropertyEvaluator'`.

`tier2PromptState.test.ts` — deletions:

11. ✗ `'"No, fall back to recursive search" maps to decline'` ([L24](test/unit/tier2PromptState.test.ts#L24))
12. ✗ `'"No, fall back to recursive search" → memento entry written; useEvaluator false'` ([L202](test/unit/tier2PromptState.test.ts#L202))
13. ✗ Memento round-trip cases (~4) — every test asserting `setMementoFlag` was called.
14. ✗ `tier2SuppressKey` casing suite (~3).
15. ✗ `'declined'` outcome cases.

`tier2PromptState.test.ts` — additions:

16. ➕ `'TIER2_PROMPT_BUTTONS contains exactly two labels'` (regression guard).
17. ➕ `'legacy "No, fall back to recursive search" label maps to cancel'` (forward-compat).

Existing 1.1.9 / 1.1.10 tests for Tier 1 expansion, candidate collection, Tier 2 evaluator wiring, override-type-mismatch, and ambiguous disambiguation are unchanged.

Run `npm run test` after each §5.x substep.

## 9. Documentation

### 9.1 `CHANGELOG.md`

New section above `## 1.1.10`:

```md
## 1.1.11

Removes the project-wide recursive `ApplicationManifest.xml` search. Generalizes the per-candidate scan from depth-1 to depth-N (governed by `serviceFabric.deploy.searchMaxDepth`) so every declared candidate — not just `serviceFabric.deploy.packagePath` — supports deep monorepo layouts.

- **Breaking change: project-wide recursive search removed.** The deploy flow no longer falls back to walking the `.sfproj` directory tree for `ApplicationManifest.xml` when every declared candidate misses. When that happens (and Tier 2 — when enabled — also misses), Publish fails with an actionable error pointing at the two real fixes: set `serviceFabric.deploy.packagePath` to the package folder, or enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` if your `<OutputPath>` / `<PackageLocation>` references properties defined in imported targets / `Directory.Build.props`.
- **Breaking change: override-rooted special case removed (subsumed).** The Plan 1.1.9 *override-rooted recursive search* (a special depth-N scan only for `serviceFabric.deploy.packagePath` candidates) is unified with the general candidate sweep. **All** declared candidates — `<PackageLocation>`, `<OutputPath>`, the default `pkg\<Configuration>\`, and the legacy `bin\<Configuration>\…` paths — now get the same depth-N scan, bounded by `serviceFabric.deploy.searchMaxDepth` (default lowered from `4` to `2`, range `1–16`). This supports the common monorepo case where multiple service projects share a common output folder and produce manifests two or three levels under the declared root.
- **`serviceFabric.deploy.searchMaxDepth` retained, default lowered, semantics clarified.** The setting now governs *per-candidate* scan depth instead of project-wide-walk depth, and its default drops from `4` to `2` (which still covers the SDK template layouts: depth-0 direct, depth-1 immediate-child, depth-2 nested-`Pkg`). Existing user `settings.json` values continue to work; the description has been updated. Users with deeper monorepo drops should set the value explicitly (commonly `4`–`8`).
- **Tier 2 prompt simplified to two buttons.** The in-flight prompt that offers to enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` (Plan 1.1.10) drops the third *No, fall back to recursive search* option — it no longer has a meaningful outcome. The modal is now: **Use for this Publish** / **Always use (save setting)** / Cancel. Per-`.sfproj` "decline" Memento entries are no longer written or read.
- **Legacy cleanup command retained.** **Service Fabric: Reset Tier 2 Property-Evaluator Prompt (legacy cleanup)** still works — its only job is to wipe stale `tier2PromptSuppressedFor:*` entries left over from 1.1.10. Safe to run on workspaces that never used 1.1.10.
- **Why.** The project-wide recursive search's single-hit accept (`packageResolver.ts`) bypassed the `ApplicationTypeName` validation that protects multi-hit cases. A workspace containing one stray `ApplicationManifest.xml` (a sibling sample, an extracted backup, a fixture under a non-skipped folder name like `bin` / `out` / `artifacts`) could deploy the wrong application without warning. With `<OutputPath>` / `<PackageLocation>` / `packagePath` / Tier 2 in place — plus the now-uniform depth-N scan under each declared candidate — every supported package layout is reachable explicitly. The project-wide walk was solving a non-problem and creating a real footgun.
- **Tests:** baseline shrinks by ~4–8 unit tests (removed coverage for the deleted project-wide-search path). Three new tests lock the per-candidate depth-N scan under auto-discovered candidates and the actionable-error message text.
```

### 9.2 `README.md` — Features bullet

Find the existing 1.1.10 line in the Features section and append:

> *(1.1.11)* The project-wide recursive `ApplicationManifest.xml` fallback is removed. Each declared candidate (`serviceFabric.deploy.packagePath`, `<PackageLocation>`, `<OutputPath>`, `pkg\<Configuration>\`) is now scanned up to `serviceFabric.deploy.searchMaxDepth` levels deep — supporting shared monorepo output folders. When every candidate misses, Publish fails with an actionable error naming the two real fixes.

### 9.3 `docs/HOWTO.md` §8.1 — "How `$(Property)` references are expanded" subsection

Replace step 6 in the candidate-ladder list ([HOWTO.md L291](docs/HOWTO.md#L291)) by **deleting** it entirely. The list ends at step 5 (`bin\<Configuration>\pkg\` and `bin\<Configuration>\`).

After step 5 add a new paragraph:

> **Per-candidate scan depth.** For every declared candidate above, the resolver looks for `ApplicationManifest.xml` directly under the candidate path, and (bounded by **`serviceFabric.deploy.searchMaxDepth`**, default `2`, range `1–16`) under nested subdirectories. The default `2` covers the depth-0 direct, depth-1 immediate-child, and depth-2 nested-`Pkg` layouts produced by the SDK templates. On multi-hit, the resolver auto-matches against the `.sfproj`'s declared `ApplicationTypeName`; if no unique match exists, a quick-pick lets you choose. For shared monorepo output folders where multiple apps land their packages 3+ levels under a common root (e.g. `<repo>\artifacts\bin\<App>\<cfg>\sfpkg\<AppType>\`), raise `searchMaxDepth` to match.

Replace the "Override-rooted recursive search (1.1.9)" paragraph ([HOWTO.md L304](docs/HOWTO.md#L304)) with:

> **Per-candidate depth scan (1.1.11).** In 1.1.9 only the `serviceFabric.deploy.packagePath` override got a deep scan; auto-discovered candidates were limited to depth 1. In 1.1.11 every declared candidate gets the same depth-N treatment, bounded by `serviceFabric.deploy.searchMaxDepth`. Set the depth to `0` to require direct-match-only behavior.

Update the Tier 2 prompt subsection (§8.1, "In-flight prompt to enable Tier 2") to drop the four-button list and the *No, fall back* row. The new list:

> - **Use for this Publish** — enable Tier 2 for the current Publish only; setting is not written.
> - **Always use (save setting)** — enable Tier 2 AND write `"serviceFabric.deploy.useMsbuildPropertyEvaluator": true` to the workspace settings.
> - **Cancel** (or Escape) — abort the Publish. (Set `serviceFabric.deploy.packagePath` directly if Tier 2 isn't the right answer for your project.)

Update the closing sentence to replace the *"reset command clears the per-project Memento entries written by *No, fall back to recursive search*"* phrase with: *"The reset command (now labelled **legacy cleanup**) clears any per-project Memento entries written by 1.1.10's prompt; 1.1.11+ does not write them."*

### 9.4 `docs/HOWTO.md` §12 — settings + commands tables

- **Update** the `serviceFabric.deploy.useMsbuildPropertyEvaluator` row description ([L648](docs/HOWTO.md#L648)) to match the new `package.json` description (drop the "AND the recursive search is missing the package" qualifier).
- **Update** the `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt` row ([L649](docs/HOWTO.md#L649)) — drop the `searchMaxDepth` reference.
- **Update** the `serviceFabric.deploy.searchMaxDepth` row ([L650](docs/HOWTO.md#L650)) — replace the "recursive `ApplicationManifest.xml` search used as a last resort" phrase with "per-candidate `ApplicationManifest.xml` search applied to each declared candidate". Note this is the *only* mention of "recursive search" in §12 that survives; everything else in the table no longer references it.
- **Update** the `serviceFabric.deploy.packagePath` row to match the new `package.json` description (note the override's depth-N scan).
- **Update** the **Reset Tier 2 Property-Evaluator Prompt** row ([L687](docs/HOWTO.md#L687)) to: *"(Legacy cleanup.) Clears any per-`.sfproj` Memento entries written by 1.1.10's Tier 2 prompt. 1.1.11+ does not write these entries; the command exists only to wipe stale state. Safe to run on workspaces that never used 1.1.10."*

### 9.5 [design_plans/PLAN.md](design_plans/PLAN.md) — high-level roadmap

Add a one-line entry under the appropriate phase noting that 1.1.11 removes the project-wide recursive walk and generalizes the per-candidate scan. (Skip if the high-level roadmap doesn't track per-patch changes.)

## 10. Rollout

- **Phase 1 (this plan).** Implement everything in §5. Tag and ship 1.1.11. The CHANGELOG breaking-change bullets warn users; the actionable error message tells affected users exactly which setting to flip.
- **Phase 2 (deferred, future patch).** Once telemetry / time confirms the legacy `tier2PromptSuppressedFor:*` Memento entries are sufficiently aged out, remove `serviceFabric.resetTier2Prompt` and `tier2SuppressKey` entirely. Suggested guard: 6–12 months after 1.1.11 ships.
- **Phase 3 (deferred, optional).** Consider type-validating every single-hit deep accept under auto-discovered candidates (current behavior: type-validate only under override candidates). Tradeoff: closes the last "stale leftover at depth > 1" blind spot at the cost of an extra `disambiguateHits` call per deep accept. Evidence-driven — only ship if real-world support cases show the blind spot biting users.

## 11. Open questions

1. **Keep the explicit depth-0 fast-path, or fold it into `scanForManifestUnder`?** Keeping it preserves the existing `'default pkg\\Debug'` source label without a `(nested)` suffix for the common case, and avoids one `readDirectories` call per Publish when the manifest is directly under the candidate. Folding it simplifies the resolver code by one branch. **Verdict: keep the depth-0 fast-path.** The label-stability argument outweighs the small code-clarity gain; existing tests asserting `source === 'default pkg\\Debug'` continue to pass without relabeling.
2. **Should single-hit deep accepts under auto-discovered candidates require `ApplicationTypeName` validation?** Currently no (preserves the Plan 1.1.9 §5.7 contract). Tightening would close the "stale leftover at depth > 1" blind spot for auto-discovered candidates. **Verdict: defer to Phase 3.** This plan keeps the existing single-hit-accept behavior to avoid bundling two behavior changes into one release; revisit if real-world cases warrant.
3. **Should `SKIP_DIRS` include `Backup`, `_old`, or other common stale-output names?** Cheap to add, low risk (only consulted when *descending into a child*, never at the candidate root). **Verdict: add `bin`, `obj`, `out`, `artifacts`, `_published`, `TestResults` as listed in §5.1; defer `Backup` / `_old` until needed.** The chosen set covers VS / .NET output conventions; less-common names can be added in follow-ups based on user reports.
4. **Should the actionable-error message also mention `serviceFabric.deploy.searchMaxDepth` as a third hint** (e.g. "increase the depth if your manifest lives more than 4 levels under the candidate root")? Adds noise to the error for the 99% case where the depth isn't the issue (the path simply doesn't exist). **Verdict: no.** The two fixes named are the actionable ones; depth-tuning is documented in the setting's description.
5. **Should the resolver log the chosen depth at the top of each Publish** for support transcripts? Cheap (`logger.info(\`Per-candidate scan depth: ${searchMaxDepth}\`)` once per Publish). **Verdict: yes — add to the existing `Resolved application package root: …` log line area.** Helps support reproduce monorepo issues without asking the user to share `settings.json`.
6. **Does any other production source still hold a reference to the renamed `searchForManifest` (now `scanForManifestUnder`) or to `searchRoot`?** Per the §1 grep, no. Re-run the grep at PR review time to confirm nothing snuck in between plan acceptance and implementation.
