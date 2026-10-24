# Plan — 1.1.10 (Interactive Tier 2 prompt: offer to enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` when Tier 1 leaves unresolved tokens)

## 0. Scope summary

One narrowly-scoped, additive UX change to the **deploy flow** ([src/deploy/deployFlow.ts](src/deploy/deployFlow.ts)). When Tier 1 property expansion (Plan 1.1.9) leaves unresolved `$(Property)` tokens in *any* of the package-path candidates produced from `<OutputPath>`, `<PackageLocation>`, or `serviceFabric.deploy.packagePath`, **and** the user has not already opted into Tier 2 via `serviceFabric.deploy.useMsbuildPropertyEvaluator`, surface a modal prompt **before** the resolver runs:

> *The `.sfproj`'s package paths reference MSBuild properties that aren't declared in the project itself (e.g. `$(BuildOutputPath)`). These typically come from `Directory.Build.props` or imported `*.targets`. Enable MSBuild property evaluation (`serviceFabric.deploy.useMsbuildPropertyEvaluator`) so this Publish can resolve them by spawning MSBuild?*
>
> Buttons: **Use for this Publish** / **Always use (save setting)** / **No, fall back to recursive search** / **Cancel Publish**

The four-way modal lets the user decide per-Publish or persist the choice (workspace-scoped). The decision is acted on **for the current Publish in flight** (no need to re-trigger after settings change), and — when "Always use" is chosen — the setting is written to the workspace `settings.json` via `vscode.workspace.getConfiguration('serviceFabric').update('deploy.useMsbuildPropertyEvaluator', true, ConfigurationTarget.Workspace)`. A "remembered no" answer (per-workspace, per-`.sfproj`) suppresses re-prompting for projects where the user has explicitly declined; it lives in the `Memento` and never blocks a future Publish, only the prompt.

The change is purely additive. The Tier 1 expander ([src/project/msbuildPropertyExpander.ts](src/project/msbuildPropertyExpander.ts)) and Tier 2 evaluator ([src/build/msbuildEvaluator.ts](src/build/msbuildEvaluator.ts)) are unchanged. The resolver ([src/deploy/packageResolver.ts](src/deploy/packageResolver.ts)) is unchanged. The only behavioral surface that grows is `deployFlow.ts`: between "build the property map" and "call `collectPackageRootCandidates`" a new step `maybePromptForMsbuildEvaluator(...)` runs. Its outcome flows into the existing `useEvaluator` boolean, which already gates the `evaluateMsbuildProperties` callback passed to `resolveApplicationPackageRoot`.

This is a 1.1.10 (minor) bump because the prompt becomes part of the user-facing Publish UX. The release script ([scripts/release.ps1](scripts/release.ps1)) handles the `package.json` version bump at tag time; we do not edit it.

## 1. Background — why this exists

After Plan 1.1.9 shipped, the resolver supports three tiers:

1. **Tier 1 — pure in-process expander.** Reads the `.sfproj`'s own `<PropertyGroup>` children, seeds intrinsics (`MSBuildProjectName`, `MSBuildProjectDirectory`, `Configuration`, `Platform`, etc.), and substitutes `$(Name)` tokens. Always on, no spawn.
2. **Tier 2 — MSBuild `-getProperty:` evaluator.** Opt-in via `serviceFabric.deploy.useMsbuildPropertyEvaluator` (boolean, default `false`). When enabled AND every Tier 1 candidate fails, spawns `MSBuild.exe -getProperty:OutputPath,PackageLocation,BuildOutputPath`, parses the JSON / `Name = Value` output, and re-runs the candidate sweep. Cached per `(sfproj, mtime, configuration, platform)` for the lifetime of the extension host.
3. **Tier 3 — bounded recursive search.** Walks under `project.sfproj.directory` (and under the override path, per Plan 1.1.9 Objective 3) up to `serviceFabric.deploy.searchMaxDepth` levels deep.

**The gap this plan closes.** Real-world monorepo `.sfproj` files routinely declare:

```xml
<PackageLocation>$(BuildOutputPath)\bin\$(Configuration)\AzCPFoundationPkgs\$(MSBuildProjectName)</PackageLocation>
```

`$(BuildOutputPath)` is defined in a sibling `Directory.Build.props`, not in the `.sfproj`. Tier 1 cannot see imported files (per Plan 1.1.9 §3 non-goals), so the expanded candidate becomes literally `<sfprojDir>\$(BuildOutputPath)\bin\Debug\AzCPFoundationPkgs\<Name>` — never exists, falls through. The deploy then either succeeds (if the recursive search happens to find the manifest within `searchMaxDepth=4` of the .sfproj) or fails with `"Could not locate ApplicationManifest.xml"`.

In *both* cases, the path that the user actually wanted — Tier 2's MSBuild-evaluated answer — is unused. Tier 2 exists precisely for this case but is locked behind a boolean the user has to discover, read the docs for, and toggle on manually. Worse, the only signal pointing at Tier 2 today is a single `logger.info` line in the output channel (`"Unresolved MSBuild properties in package-path candidates: $(BuildOutputPath). Falling back to recursive search."`) that most users will never see unless they're already debugging the deploy.

**The fix.** Detect the precondition in-line during the Publish flow and ask the user, modal, before the resolver runs. This converts an obscure config knob into a discoverable, one-click remediation that the user encounters in the exact moment they need it. The four-button modal lets the user trade off latency (Tier 2 adds 1–3 s on cold cache) against convenience (recursive search may miss, requiring an override) and to persist the choice when they've made an informed decision.

## 2. Goals

Acceptance:

1. **Detection is precondition-only, fast, and deterministic.** The deploy flow already builds the property map and runs the candidates through `probeExpand` (per Plan 1.1.9 §5.4). The new code reuses the existing `unresolvedTokens: Set<string>` aggregation. The prompt is shown *only* when **all** of the following hold:
    - `unresolvedTokens.size > 0` (Tier 1 left tokens unresolved in at least one candidate)
    - `serviceFabric.deploy.useMsbuildPropertyEvaluator` is `false` (or unset → `false`) — explicitly enabled is silently honored, no double prompt
    - The workspace `Memento` does NOT carry `tier2PromptSuppressedFor[<sfprojPath>] === true` (a previous "No, fall back to recursive search" answer)
    - The deploy flow has access to `vscode.window` (i.e. not in a scripted / headless context — guarded by the standard `vscode` import check)
2. **The prompt is modal and lists the unresolved tokens.** The message text names up to three unresolved tokens verbatim (e.g. `$(BuildOutputPath), $(ArtifactsBin)`); a 4th-and-beyond is summarized as `... (+N more)`. The full list is logged to the output channel before the prompt is shown so the user can review it without scrolling the modal.
3. **Four explicit choices** (per the §0 verbatim text):
    - **Use for this Publish** → set `useEvaluator = true` for this Publish only. Setting is NOT written.
    - **Always use (save setting)** → set `useEvaluator = true` AND `await config.update('deploy.useMsbuildPropertyEvaluator', true, ConfigurationTarget.Workspace)`. On `update` failure (e.g. read-only `.vscode/settings.json`), the error is logged and the Publish still proceeds with Tier 2 enabled for the current run.
    - **No, fall back to recursive search** → set `useEvaluator = false` (Tier 2 skipped) AND record `tier2PromptSuppressedFor[<sfprojPath>] = true` in the workspace `Memento` so subsequent Publishes of the same `.sfproj` don't re-prompt. **The user can clear this** by running the new command **Service Fabric: Reset Tier 2 Property-Evaluator Prompt** (see §5.5).
    - **Cancel Publish** → throw the existing `PublishCancelledByUserError` and abort. Output channel logs `"Publish cancelled by user — declined MSBuild property evaluator prompt."`.
    - **Dismiss (Escape / close)** → treated as **Cancel Publish** (safest default). NOT treated as "No" — dismissal is ambiguous and should not silently suppress future prompts.
4. **No double-prompt within a single Publish.** The prompt runs exactly once per Publish, before `collectPackageRootCandidates`. If Tier 2 is then unable to resolve either (network failure, MSBuild crash, parse error), the existing Tier 3 (recursive search) runs as today. The user is NOT re-asked.
5. **Memento entry is per-`.sfproj`, workspace-scoped.** Keyed by the absolute `.sfproj` path (case-insensitive on Windows, case-sensitive elsewhere — matched against `process.platform === 'win32'`). The entry is a `boolean`; absence ≡ `false`. Stored via `ExtensionContext.workspaceState.update(...)` using the dedicated key constant `TIER2_PROMPT_SUPPRESS_KEY_PREFIX + <normalizedPath>`. The `Memento` is workspace-scoped already, so a different workspace re-prompts even for the same file path.
6. **`serviceFabric.deploy.suppressMsbuildEvaluatorPrompt` exists as a fast-path opt-out.** Boolean, workspace setting, default `false`. When `true`, the prompt is silently skipped (Tier 2 stays off unless the user has *also* set `useMsbuildPropertyEvaluator: true`). Power users / CI configurations that want predictable behavior without the modal can flip this once.
7. **Reset command.** New command **Service Fabric: Reset Tier 2 Property-Evaluator Prompt** (`serviceFabric.resetTier2Prompt`) clears every `tier2PromptSuppressedFor[*]` entry in the current workspace's `Memento`. Surfaced in the command palette only; no menu entries. Logs a single info line listing the count of cleared entries.
8. **Pure-resolver guarantee preserved.** `packageResolver.ts` does not import `vscode`, does not call the prompt, does not know the user's answer. The deploy flow does all the work; the resolver's `evaluateMsbuildProperties` callback is the existing seam.
9. **Tests:** baseline +~10. New `test/unit/deployFlow.tier2Prompt.test.ts` covers the precondition matrix (unresolved present / absent, setting already on / off, suppress-setting on / off, Memento entry present / absent), the four button outcomes (per-Publish / persist / decline / cancel), the dismiss-equals-cancel rule, and the persist-failure-still-proceeds path. Reset command exercised with a stub `Memento`.
10. **No package-version bump in `package.json`.** Stays at the current release until the release script bumps it.
11. **`CHANGELOG.md`** has a new `## 1.1.10` section above the existing `## 1.1.9`.
12. **Existing Plan-1.1.9 tests stay green** (410 unit tests as of 1.1.9 ship). The Tier-1-only test paths add Memento-stubs that report "no suppression" so existing test fixtures don't accidentally trip the prompt.

## 3. Non-goals

- **Auto-enabling Tier 2 without consent.** The prompt is the only way `useMsbuildPropertyEvaluator` flips from `false` to `true` automatically. Silently enabling it would violate the "no surprising spawns of MSBuild" contract Plan 1.1.9 §0 established.
- **Per-token prompts.** When 5 distinct unresolved tokens are detected, the user is asked *one* question, not five. Naming the tokens in the modal text is sufficient context; finer-grained UX (per-token enable / ignore) is over-engineered for the actual frequency of occurrence.
- **Detecting which tokens MSBuild itself could resolve.** The Tier 2 evaluator is "trusted to know better" — if it can't resolve them either, the user sees the existing `"Could not locate ApplicationManifest.xml"` error and the prompt has done its job (offered the best available remediation). Pre-validating against `MSBuild.exe` before the prompt would defeat the prompt's purpose (saving the user from a manual Tier 2 toggle).
- **Persisting "No, fall back" globally / per-machine.** The Memento entry is workspace-scoped on purpose. A user who has multiple workspaces sharing the same monorepo deliberately gets re-prompted in each — different workspaces may have different `Directory.Build.props` chains, different `.vscode/settings.json`, and the prompt should respect that.
- **Coupling the prompt to other settings.** No "Always use Tier 2 for this user" global setting. The `User`-scoped flavor of `useMsbuildPropertyEvaluator` already exists (VS Code surfaces every setting at User scope by default); the prompt's persist path writes Workspace-scope deliberately so the choice tracks the project's MSBuild import chain, not the user's machine.
- **Surfacing the prompt for Tier 3 misses unrelated to unresolved tokens.** If Tier 1 resolves everything but the manifest still isn't at the expected path (stale build, deleted output folder), the prompt does NOT fire — the unresolved-token precondition fails, and the existing "Could not locate" error guides the user instead.
- **Modifying the existing Plan-1.1.9 modal warning** for `ApplicationTypeName` mismatch (the override-type prompt). That modal stays as-is; the new prompt fires earlier in the flow and is orthogonal.
- **Adding telemetry for prompt outcomes.** The existing `serviceFabric.telemetry.enabled` infrastructure could host `extension.deploy.tier2Prompt.outcome`, but Plan 1.1.10 is scoped to the user-visible behavior. Telemetry can land in a follow-up if usage data is ever needed; the prompt itself is fully observable via the output channel logs the user can already see.
- **Disabling the prompt when Tier 2 itself fails.** The prompt fires *before* Tier 2 runs. If MSBuild then fails (no MSBuild installed, parse error, timeout), control falls through to Tier 3 as today. The user is NOT re-prompted within the same Publish to revise their choice — the modal-storm cure is worse than the disease.
- **Custom rendering of the unresolved-token list.** The modal uses VS Code's built-in `showInformationMessage({ modal: true })` shape; we do not introduce a webview or `QuickInput`. Modal API is the right tool for a four-way decision blocking the deploy.

## 4. Surface area at a glance

| New / changed | Where | Responsibility |
|---|---|---|
| `maybePromptForMsbuildEvaluator(...)` | **new function** in [src/deploy/deployFlow.ts](src/deploy/deployFlow.ts) | Reads `unresolvedTokens`, the current setting, the suppress setting, and the Memento. Returns `{ useEvaluator: boolean }` or throws `PublishCancelledByUserError`. Side-effects (when applicable): writes to workspace config; writes to `workspaceState`. |
| `resolveTier2PromptDecision(...)` | **new pure helper** in the same file | Maps the modal's `string \| undefined` answer to a tagged union: `'use-once' \| 'use-persist' \| 'decline' \| 'cancel'`. Fully testable without `vscode`. |
| `TIER2_PROMPT_SUPPRESS_KEY_PREFIX` | new exported const in `deployFlow.ts` (or a small `src/deploy/tier2PromptState.ts` helper if test isolation needs it) | `'serviceFabric.deploy.tier2PromptSuppressedFor:'` |
| Wiring in `runDeployFlow` (or equivalent entry point) | same file | Between "build property map / aggregate `unresolvedTokens`" and "build `evaluateMsbuildProperties` callback", call `maybePromptForMsbuildEvaluator(...)` and use its `useEvaluator` to gate the callback construction. |
| `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt` | `package.json` `contributes.configuration.properties` | Boolean, default `false`. Description: "Skip the modal prompt that offers to enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` when Tier 1 expansion leaves unresolved MSBuild properties. Power users / CI configurations can set this to `true` to keep Publish behavior strictly governed by `useMsbuildPropertyEvaluator` and `searchMaxDepth` alone." |
| `serviceFabric.resetTier2Prompt` | `package.json` `contributes.commands` + registration in [src/extension.ts](src/extension.ts) | Clears every `tier2PromptSuppressedFor:*` entry from `workspaceState`. Logs the count cleared. Surfaced in the command palette as **Service Fabric: Reset Tier 2 Property-Evaluator Prompt**. |
| Tests | `test/unit/deployFlow.tier2Prompt.test.ts` (**new**) | Precondition matrix + 4 button outcomes + dismiss + persist-failure-tolerated + Memento round-trip. See §8. |
| Docs | [docs/HOWTO.md](docs/HOWTO.md) §8.1 (deploy/resolution), §12 (new settings + command rows); [CHANGELOG.md](CHANGELOG.md); [README.md](README.md) *Features* bullet refresh | See §9. |

## 5. Implementation

### 5.1 Wiring in `deployFlow.ts`

Drop-in between the existing `unresolvedTokens` aggregation and the `useEvaluator` boolean assignment. The current code (Plan 1.1.9) looks like:

```ts
// Tier 2 (opt-in).
const useEvaluator = vscode.workspace
    .getConfiguration('serviceFabric')
    .get<boolean>('deploy.useMsbuildPropertyEvaluator', false);
const evaluateMsbuildProperties = useEvaluator
    ? (): Promise<PackageRootCandidate[]> => evaluateViaMsbuild(project.sfproj.path, configuration, logger)
    : undefined;
```

Replace with:

```ts
// Tier 2 — read the stored preference, then offer to enable it on the fly
// when Tier 1 left $(Property) tokens unresolved. The prompt is silent when:
//   * the user already enabled the setting (we trust their explicit choice)
//   * the user disabled the prompt via suppressMsbuildEvaluatorPrompt
//   * the user previously chose "No, fall back to recursive search" for this sfproj
//   * Tier 1 resolved every token (no remediation to offer)
let useEvaluator = vscode.workspace
    .getConfiguration('serviceFabric')
    .get<boolean>('deploy.useMsbuildPropertyEvaluator', false);

if (!useEvaluator && unresolvedTokens.size > 0) {
    useEvaluator = await maybePromptForMsbuildEvaluator({
        sfprojPath: project.sfproj.path,
        unresolvedTokens,
        context,                  // ExtensionContext — caller threads it in
        logger
    });
}

const evaluateMsbuildProperties = useEvaluator
    ? (): Promise<PackageRootCandidate[]> => evaluateViaMsbuild(project.sfproj.path, configuration, logger)
    : undefined;
```

`maybePromptForMsbuildEvaluator` is a thin wrapper:

```ts
async function maybePromptForMsbuildEvaluator(opts: {
    readonly sfprojPath: string;
    readonly unresolvedTokens: ReadonlySet<string>;
    readonly context: vscode.ExtensionContext;
    readonly logger: Logger;
}): Promise<boolean> {
    const { sfprojPath, unresolvedTokens, context, logger } = opts;

    const config = vscode.workspace.getConfiguration('serviceFabric');
    const suppressed = config.get<boolean>('deploy.suppressMsbuildEvaluatorPrompt', false);
    if (suppressed) {
        logger.info('Tier 2 prompt suppressed by serviceFabric.deploy.suppressMsbuildEvaluatorPrompt.');
        return false;
    }

    const memKey = tier2SuppressKey(sfprojPath);
    if (context.workspaceState.get<boolean>(memKey) === true) {
        logger.info(
            `Tier 2 prompt suppressed for ${sfprojPath} (previous "fall back to recursive search" answer). ` +
                `Run "Service Fabric: Reset Tier 2 Property-Evaluator Prompt" to re-enable.`
        );
        return false;
    }

    // Log the full list of unresolved tokens BEFORE the prompt so the user
    // can correlate the modal's summary with the full set without scrolling
    // the dialog (which truncates).
    logger.info(
        `Unresolved MSBuild properties in package-path candidates: ${[...unresolvedTokens]
            .map(t => `$(${t})`)
            .join(', ')}.`
    );

    const sampleTokens = [...unresolvedTokens].slice(0, 3).map(t => `$(${t})`);
    const moreCount = unresolvedTokens.size - sampleTokens.length;
    const sampleText =
        sampleTokens.join(', ') + (moreCount > 0 ? ` (+${moreCount} more)` : '');

    const message =
        `The .sfproj's package paths reference MSBuild properties that aren't declared in the project itself ` +
        `(${sampleText}). These typically come from Directory.Build.props or imported .targets files.\n\n` +
        `Enable MSBuild property evaluation (serviceFabric.deploy.useMsbuildPropertyEvaluator) so this Publish ` +
        `can resolve them by spawning MSBuild?`;

    const choice = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Use for this Publish',
        'Always use (save setting)',
        'No, fall back to recursive search'
        // No explicit 'Cancel Publish' button — modal Cancel + Escape map to
        // `undefined` which we treat as cancel. Adding a 4th button would
        // make the modal taller; the modal's own Cancel affordance suffices.
    );

    const decision = resolveTier2PromptDecision(choice);

    switch (decision) {
        case 'use-once':
            logger.info('Tier 2 enabled for this Publish (user choice; setting not persisted).');
            return true;

        case 'use-persist':
            try {
                await config.update(
                    'deploy.useMsbuildPropertyEvaluator',
                    true,
                    vscode.ConfigurationTarget.Workspace
                );
                logger.info('Tier 2 enabled and persisted to workspace settings.');
            } catch (err) {
                logger.warn(
                    `Could not persist serviceFabric.deploy.useMsbuildPropertyEvaluator=true (${
                        (err as Error).message
                    }). Tier 2 still enabled for this Publish.`
                );
            }
            return true;

        case 'decline':
            await context.workspaceState.update(memKey, true);
            logger.info(
                `Tier 2 declined for ${sfprojPath}. Suppressing the prompt for this project ` +
                    `until "Service Fabric: Reset Tier 2 Property-Evaluator Prompt" is run.`
            );
            return false;

        case 'cancel':
            throw new PublishCancelledByUserError(
                'Publish cancelled by user — declined MSBuild property evaluator prompt.'
            );
    }
}
```

The pure helper:

```ts
type Tier2PromptDecision = 'use-once' | 'use-persist' | 'decline' | 'cancel';

export function resolveTier2PromptDecision(
    answer: string | undefined
): Tier2PromptDecision {
    switch (answer) {
        case 'Use for this Publish':
            return 'use-once';
        case 'Always use (save setting)':
            return 'use-persist';
        case 'No, fall back to recursive search':
            return 'decline';
        default:
            // Includes `undefined` (Escape / dismiss / Cancel button), any
            // unrecognized label, and the modal-close case. Cancel is the
            // safest default — silently treating dismiss as "decline" would
            // permanently suppress the prompt and is the surprising case
            // Plan-1.1.8 prompt history taught us to avoid.
            return 'cancel';
    }
}
```

### 5.2 Memento key helper

```ts
const TIER2_PROMPT_SUPPRESS_KEY_PREFIX = 'serviceFabric.deploy.tier2PromptSuppressedFor:';

function tier2SuppressKey(sfprojPath: string): string {
    // Normalize to lowercase on Windows so `C:\Repo\App.sfproj` and
    // `c:\repo\app.sfproj` resolve to the same Memento entry. Other
    // platforms keep case as-is (case-sensitive file systems).
    const normalized = process.platform === 'win32' ? sfprojPath.toLowerCase() : sfprojPath;
    return `${TIER2_PROMPT_SUPPRESS_KEY_PREFIX}${normalized}`;
}
```

### 5.3 `serviceFabric.resetTier2Prompt` command

In `package.json`:

```jsonc
{
    "command": "serviceFabric.resetTier2Prompt",
    "title": "Reset Tier 2 Property-Evaluator Prompt",
    "category": "Service Fabric"
}
```

Registration in [src/extension.ts](src/extension.ts):

```ts
context.subscriptions.push(
    vscode.commands.registerCommand('serviceFabric.resetTier2Prompt', async () => {
        const keys = context.workspaceState.keys().filter(k =>
            k.startsWith(TIER2_PROMPT_SUPPRESS_KEY_PREFIX)
        );
        for (const k of keys) {
            await context.workspaceState.update(k, undefined);
        }
        logger.info(
            `Reset Tier 2 property-evaluator prompt: cleared ${keys.length} suppressed entr${
                keys.length === 1 ? 'y' : 'ies'
            }.`
        );
        vscode.window.showInformationMessage(
            `Service Fabric: Reset Tier 2 prompt for ${keys.length} project${keys.length === 1 ? '' : 's'}.`
        );
    })
);
```

`workspaceState.keys()` requires VS Code engine ≥ 1.68 — well below our existing `^1.90.0` engine. No engine bump needed.

### 5.4 `package.json` additions

Two new entries under `contributes.configuration.properties`:

```jsonc
{
    "serviceFabric.deploy.suppressMsbuildEvaluatorPrompt": {
        "type": "boolean",
        "default": false,
        "description": "Skip the modal prompt that offers to enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` when Tier 1 expansion leaves unresolved MSBuild properties (e.g. `$(BuildOutputPath)` defined in `Directory.Build.props`). Power users and CI configurations can set this to `true` to keep Publish behavior strictly governed by `useMsbuildPropertyEvaluator` and `searchMaxDepth`. Does not affect projects whose Tier 1 expansion resolves every token."
    }
}
```

One new entry under `contributes.commands` (per §5.3). No new menu contributions — command-palette only.

### 5.5 Thread `ExtensionContext` to `runDeployFlow`

The `maybePromptForMsbuildEvaluator` helper needs `vscode.ExtensionContext.workspaceState`. The existing deploy entry point already runs inside `activate(context)` so threading the context through to `runDeployFlow` is a one-line plumbing change — either as an explicit parameter or via a module-scope `let` populated in `activate`. Prefer an explicit parameter (cleaner for tests) — pattern matches `runAutoAttach` from Plan 1.1.8.

## 6. Edge cases

- **Tier 1 resolves every token, but the deploy still fails.** Precondition (`unresolvedTokens.size > 0`) is false; prompt does not fire. Resolver throws its standard "Could not locate" error. Correct: Tier 2 wouldn't help here, the value already resolved to a path that simply doesn't exist on disk.
- **User has `useMsbuildPropertyEvaluator: true` AND `suppressMsbuildEvaluatorPrompt: true`.** Both settings respected: Tier 2 runs, prompt doesn't fire. The suppress setting is independent of whether Tier 2 is on; it gates the modal only.
- **User has `useMsbuildPropertyEvaluator: true` and the prompt would have fired.** No prompt — `useEvaluator` is already `true`, the prompt block is skipped (per the `if (!useEvaluator && ...)` guard).
- **User chooses "Always use" but the workspace settings file is read-only.** `config.update(...)` throws; the `try/catch` logs a warning and `useEvaluator` stays `true` for this Publish. Next Publish goes through the prompt again — better than silently failing or aborting the Publish.
- **User chooses "No, fall back" then later moves the package back to a Tier-1-resolvable location.** Memento entry is still set, but the precondition (`unresolvedTokens.size > 0`) no longer holds — prompt is skipped naturally. The entry sits harmlessly until the user runs the reset command or the workspace is removed.
- **Multiple `.sfproj` files in one workspace.** Memento entries are per-path. Declining for `AppA.sfproj` does NOT suppress the prompt for `AppB.sfproj`.
- **Workspace rename / .sfproj rename.** Memento entry keyed by the old path becomes stale (re-prompts the user, which is correct — different file, different decision).
- **`vscode.workspace.getConfiguration('serviceFabric').update(...)` writes to a folder-scope (multi-root workspace) without a clearly-active folder.** VS Code resolves Workspace target to the first folder by default; if that's wrong for the user's setup, they can move the setting manually. This is a multi-root workspace footgun, not unique to this prompt.
- **`workspaceState.update(key, undefined)` to "delete" a key.** Documented VS Code behavior; equivalent to removing the entry. Used by the reset command.
- **`unresolvedTokens` includes only tokens that ARE resolvable by Tier 1 in a different `<PropertyGroup>` (e.g. a conditional block that didn't activate for `Configuration=Debug`).** False positive — Tier 2 wouldn't actually help. Acceptable: the user picks "No, fall back" (or "Always use" — Tier 2 will still spawn but produce the same answer as Tier 1, just slower). Either way the deploy succeeds. Detecting this case pre-prompt would require a second expander pass against every conditional and is over-engineering for a corner case.
- **Headless / scripted callers.** `vscode.window.showWarningMessage` always exists in the extension host. There's no "no UI" mode short of running outside the extension host (e.g. in unit tests, where the call is mocked). The new code does not introduce a new dependency on UI presence beyond what `deployFlow.ts` already has.

## 7. Telemetry

Out of scope for 1.1.10 (per §3 non-goal). The output channel logs every prompt outcome via `logger.info` / `logger.warn`, which is sufficient for support diagnostics without introducing a new event schema. A follow-up plan can add `extension.deploy.tier2Prompt.outcome` if usage data is needed.

## 8. Tests

New file: `test/unit/deployFlow.tier2Prompt.test.ts`.

The deploy flow is harder to unit-test than pure modules because it imports `vscode`. Pattern matches existing tests like [test/unit/attachToService.test.ts](test/unit/attachToService.test.ts) (factor out the pure decision logic; test the pure piece exhaustively; cover the wrapper with one or two integration-style tests using stubbed `vscode` shims).

Pure helper coverage (`resolveTier2PromptDecision`):

1. ✔ `'Use for this Publish'` → `'use-once'`
2. ✔ `'Always use (save setting)'` → `'use-persist'`
3. ✔ `'No, fall back to recursive search'` → `'decline'`
4. ✔ `undefined` (dismiss / Escape) → `'cancel'`
5. ✔ Arbitrary unrecognized string → `'cancel'`
6. ✔ Empty string → `'cancel'`

Precondition matrix for `maybePromptForMsbuildEvaluator` (using a fake `vscode.window.showWarningMessage` injected via a small abstraction or a global stub):

7. ✔ `unresolvedTokens` empty → prompt NOT shown; returns `false` (Tier 2 stays off)
8. ✔ `unresolvedTokens` non-empty + setting `useMsbuildPropertyEvaluator: true` → prompt NOT shown; returns `true` (path is never entered — guarded upstream; sanity check)
9. ✔ `unresolvedTokens` non-empty + `suppressMsbuildEvaluatorPrompt: true` → prompt NOT shown; returns `false`; output channel says "suppressed by setting"
10. ✔ `unresolvedTokens` non-empty + Memento has `tier2PromptSuppressedFor:<path>: true` → prompt NOT shown; returns `false`; output channel says "suppressed for <path>"
11. ✔ `unresolvedTokens` non-empty + all preconditions met + user picks "Use for this Publish" → returns `true`; setting NOT written; Memento unchanged
12. ✔ Same + user picks "Always use" → returns `true`; `config.update(...)` called once with `(key, true, Workspace)`; Memento unchanged
13. ✔ Same + user picks "Always use" but `config.update` rejects → returns `true` anyway; warning logged
14. ✔ Same + user picks "No, fall back" → returns `false`; `workspaceState.update(memKey, true)` called once; setting NOT written
15. ✔ Same + user dismisses (`undefined`) → throws `PublishCancelledByUserError`; Memento + setting unchanged

Memento key helper:

16. ✔ `tier2SuppressKey` lowercases on `win32`, preserves case otherwise (mock `process.platform`)
17. ✔ Two paths differing only in casing produce the same key on `win32`
18. ✔ Two paths differing in casing produce different keys on `linux`

Reset command:

19. ✔ With no suppressed entries → logs "cleared 0 entries"; toast shows "0 projects"
20. ✔ With 3 suppressed entries (mixed with unrelated `workspaceState` keys) → clears exactly the 3 prefix-matching keys, leaves others intact; toast shows "3 projects"

Token-list rendering in the modal message:

21. ✔ 1 unresolved token → message contains `$(Foo)`
22. ✔ 3 unresolved tokens → message contains all three, no "(+N more)"
23. ✔ 5 unresolved tokens → message contains first 3 + `(+2 more)`; output channel logs all 5

Aim: 23 new test cases, ~+8 ms total per Plan 1.1.9's runtime baseline.

## 9. Documentation

### 9.1 `CHANGELOG.md`

New section above `## 1.1.9`:

```md
## 1.1.10

Interactive prompt to enable MSBuild property evaluation when Tier 1 leaves unresolved `$(Property)` tokens.

- **In-flight prompt during Publish.** When the .sfproj's `<OutputPath>` / `<PackageLocation>` / `serviceFabric.deploy.packagePath` contain MSBuild property references that the in-process expander cannot resolve (typically because they're defined in `Directory.Build.props` or an imported `.targets`), Publish now surfaces a modal offering to spawn MSBuild for evaluation. Choices: **Use for this Publish**, **Always use (save setting)**, **No, fall back to recursive search**, or Cancel.
- **Per-project decline is remembered.** Picking "No, fall back" stores a workspace-scoped Memento entry keyed by the .sfproj path; subsequent Publishes of the same project skip the prompt until you run the new **Service Fabric: Reset Tier 2 Property-Evaluator Prompt** command.
- **Workspace-level opt-out.** New setting `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt` (boolean, default `false`) silences the prompt entirely for power users / CI environments that want behavior strictly governed by `useMsbuildPropertyEvaluator` and `searchMaxDepth`.
- **No telemetry, no spawn without consent.** The prompt fires only when Tier 1 has left tokens unresolved AND `useMsbuildPropertyEvaluator` is `false`. MSBuild is never spawned silently. Output channel logs every prompt outcome.
- **Tests:** baseline +~23. New `test/unit/deployFlow.tier2Prompt.test.ts` covers the precondition matrix, all four button outcomes, the persist-failure-tolerated path, the dismiss-equals-cancel rule, and the reset command.
```

### 9.2 `README.md` — Features bullet refresh

Append to the existing 1.1.9 line:

> When the .sfproj references properties defined only in `Directory.Build.props` or imported `.targets`, Publish now offers an in-flight prompt to enable the MSBuild evaluator for the current run (or persist the choice).

### 9.3 `docs/HOWTO.md` §8.1 — extend the "How `$(Property)` references are expanded" subsection

After the existing Tier 2 paragraph add:

> **Tier 1.5 — in-flight prompt (1.1.10).** When Tier 1 leaves any `$(Property)` token unresolved and `serviceFabric.deploy.useMsbuildPropertyEvaluator` is `false`, Publish surfaces a modal naming the unresolved tokens and offering to spawn MSBuild for evaluation. The four choices are:
>
> - **Use for this Publish** — enable Tier 2 for the current Publish only; setting is not written.
> - **Always use (save setting)** — enable Tier 2 AND write `"serviceFabric.deploy.useMsbuildPropertyEvaluator": true` to the workspace settings.
> - **No, fall back to recursive search** — skip Tier 2 for this Publish AND remember the choice for this .sfproj until **Service Fabric: Reset Tier 2 Property-Evaluator Prompt** is run.
> - **Cancel** (or Escape) — abort the Publish.
>
> The prompt is silent when `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt: true`, when the user has already opted into Tier 2, or when every token resolved via Tier 1. The reset command clears the per-project Memento entries written by "No, fall back to recursive search".

### 9.4 `docs/HOWTO.md` §12 — settings + commands table additions

New settings row:

| `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt` | `false` | Skip the modal prompt that offers to enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` when Tier 1 expansion leaves unresolved MSBuild properties. Power users / CI configurations can set this to `true` to keep Publish behavior strictly governed by `useMsbuildPropertyEvaluator` and `searchMaxDepth`. Does not affect projects whose Tier 1 expansion resolves every token. See §8.1. |

New commands row:

| **Service Fabric: Reset Tier 2 Property-Evaluator Prompt** (`serviceFabric.resetTier2Prompt`) | Clears every per-.sfproj "No, fall back to recursive search" answer stored in the current workspace's Memento, so the next affected Publish re-prompts. Useful after the workspace's MSBuild import chain changes (e.g. `Directory.Build.props` added or removed) and you want a fresh decision. |

## 10. Rollout

- **Phase 1 (this plan).** Implement everything in §5. The new prompt is on by default but can be silenced workspace-wide via `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt`. No CI / scripted-Publish flow should hit the modal because those paths typically already pin `useMsbuildPropertyEvaluator` explicitly (or run without the extension host).
- **Phase 2 (deferred).** Telemetry — only if the feature sees enough adoption to make outcome data interesting. Schema would mirror Plan 1.1.8's auto-attach telemetry shape (`extension.deploy.tier2Prompt.{outcome, durationMs}` where `outcome ∈ 'use-once' | 'use-persist' | 'decline' | 'cancel' | 'suppressed-setting' | 'suppressed-memento'`).
- **Phase 3 (deferred).** Per-token enable / ignore quick-pick (replace the modal with a multi-select), only if real usage shows users want per-token control. Plan 1.1.10 deliberately ships the simpler shape first.

## 11. Open questions

1. **Should "Use for this Publish" also set the Memento entry to `false`?** Currently it leaves the entry alone (so a previous decline isn't cleared). Tradeoff: the user's most recent answer overrides older history. The current behavior preserves the older decline; a future Publish that hits the precondition will respect it. Verdict: leave as-is. Picking "Use for this Publish" once doesn't communicate "I want to be re-prompted forever," it communicates "use it this time" — the prior decline still represents the user's standing preference.
2. **Should the modal show the path of one example candidate that contains the unresolved token?** Adds context but lengthens the modal. Verdict: no — the output channel already logs the full candidate list before the prompt, and the modal stays focused on the actionable question. If user feedback shows confusion about which property goes with which path, revisit.
3. **Should the prompt fire for the `serviceFabric.deploy.packagePath` override specifically (in addition to `<OutputPath>` / `<PackageLocation>`)?** Yes — the existing `unresolvedTokens` set already aggregates across all three sources (per Plan 1.1.9 §5.4's `probeExpand` wrapper). No code change needed.
4. **Should we offer a "Don't ask again for any project in this workspace" button?** That would duplicate `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt: true`. A user who wants that scope flips the setting once; we don't need a fifth modal button for it.
