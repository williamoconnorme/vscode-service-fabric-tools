# Plan — 1.1.8 (Auto-attach debugger after Publish)

## 0. Scope summary

A single, focused feature layered on top of the existing **Publish Application…** flow and the existing **Attach Debugger to Deployed Service…** plumbing. When the user opts in, a successful Publish to a **local development cluster** automatically resolves the freshly-deployed application's host PID(s) and starts a CoreCLR (or CLR on Windows) debug session against them — eliminating the manual quick-pick chain after every deploy.

**Local-only scope.** This plan covers local clusters exclusively. Remote-cluster auto-attach is deliberately deferred to a later plan (likely 1.2.x) — see §3 *Non-goals* and §11 *Open questions*. Publishing to a remote cluster is unchanged from 1.1.7: no prompt, no attach, no warning.

Three opt-in surfaces:

1. **Workspace setting** `serviceFabric.debug.autoAttachOnPublish` (default `'never'`, two-valued: `'never' | 'localOnly'`). Drives the post-publish behavior globally for local clusters.
2. **Per-publish prompt** the *first* time a deploy completes against a **local** cluster on a workspace where the setting is `'never'` and the debug-extension prerequisite is satisfied: *"Auto-attach the debugger after publish completes? (Yes / Not now / Don't ask again)"*. Persisting the choice updates the setting.
3. **Tree-context one-shot toggle** on the Application node — *Auto-attach next deploy* — captured in `Memento` for a single subsequent deploy regardless of the global setting. Still no-ops for remote clusters.

The change is fully additive. No existing flow is removed; the manual **Attach Debugger to Deployed Service…** command is unchanged. No package-version bump in package.json — the release pipeline (scripts/release.ps1) sets that automatically at tag time.

## 1. Background — why this exists

Per the conversation thread following the 1.1.7 release, the extension has manual attach only ([src/debug/attachToService.ts](src/debug/attachToService.ts#L34)). Every deploy → debug cycle today requires the user to:

1. Run **Service Fabric: Publish Application…** and wait for completion.
2. Run **Service Fabric: Attach Debugger to Deployed Service…**.
3. Pick the application (1 quick-pick).
4. Pick the code package replica (1 quick-pick — there's typically only one for stateless after a fresh deploy, but it's still a click).
5. Pick the debug runtime (`coreclr` / `clr`) (1 quick-pick).

Steps 3–5 are zero-information clicks the *first time after a deploy* — there's exactly one freshly-published app, exactly one host PID per service, and the runtime is always `coreclr` for modern .NET projects. Auto-attach removes those clicks for the most common inner-loop shape:

> Edit code → Publish → Set breakpoint → Hit it.

The existing pre-flight check (1.1.5) for the `ms-dotnettools.csharp` debugger extension already protects the auto-attach path for free — the orchestrator below calls the same `ensureDebuggerAvailable` function as the manual command.

## 2. Goals

Acceptance:

1. **Setting honored — local only.** `serviceFabric.debug.autoAttachOnPublish: 'localOnly'` causes a successful Publish to a `kind: 'local'` cluster to launch the debugger automatically against every host PID in the application. **Any non-local active connection** is a no-op for the entire feature: no prompt, no attach, no warning, no telemetry distinct from a 1.1.7 Publish. The orchestrator short-circuits at the first `clusterKind !== 'local'` check.
2. **One-shot tree toggle (local only).** Right-click an `Application` node → **Auto-attach next deploy** flips an in-memory flag on the application name; the next Publish targeting that application auto-attaches even if the setting is `'never'` — provided the active cluster is local at deploy time. If the user arms the one-shot and then publishes against a remote cluster, the flag is consumed silently with no attach (same rule as the global setting). The flag is consumed (cleared) after one Publish, success or failure.
3. **Multi-PID fan-out.** When the published application has more than one running host PID (e.g. ASP.NET service + actor service in the same app, or a stateful service with several replicas across nodes), auto-attach **starts one debug session per PID**, named distinctly so VS Code's CALL STACK panel shows them grouped. A configurable cap `serviceFabric.debug.autoAttachMaxSessions` (default `5`) prevents accidentally spinning up dozens of sessions on a 5-node cluster.
4. **Failure modes are non-fatal.** If PID resolution fails, if the debugger extension is missing and the user declines install, or if `vscode.debug.startDebugging` returns `false` for any single PID, the *Publish completed successfully* toast still fires — auto-attach errors are surfaced as a warning toast (with **Open Output Channel**) but never undo the deploy outcome.
5. **PID race protection.** Between Publish completion and PID resolution, SF may still be transitioning replicas to `Ready`. The orchestrator polls `/Applications/<id>/$/GetServices/.../GetReplicas` for up to `serviceFabric.debug.autoAttachReadyTimeoutSec` seconds (default `30`) waiting for at least one `Ready` replica per service before resolving PIDs.
6. **Manual flow unchanged.** The existing **Attach Debugger to Deployed Service…** command is untouched — auto-attach is a *new* code path that calls the same low-level helpers. The manual command continues to work for both local *and* remote clusters as it always has.
7. **No package-version bump in `package.json`.** `version` stays at the current release until the release script bumps it as part of `npm run release`.

## 3. Non-goals

- **Remote-cluster auto-attach.** Out of scope for 1.1.8. Even with `'localOnly'`, a non-local active connection causes Publish to skip auto-attach silently — the entire feature is a no-op for remote clusters. A future plan (likely 1.2.x) will add explicit remote support, including `pipeTransport` configuration, `vsdbg` deployment helper, source/symbol mapping, stale-session detection on replica failover, and an explicit "this attaches to live traffic" guard. None of that scaffolding is built now — keeping 1.1.8 narrowly focused on the inner-loop edit/publish/breakpoint cycle against a local dev cluster.
- **Auto-reattach on replica failover / restart.** Out of scope. The first Publish-triggered attach is the entire feature; a separate plan can later wire `vscode.debug.onDidTerminateDebugSession` + a `getReplicas` poll to re-attach on recycle.
- **Auto-attach on `dotnet run` / `F5` outside SF.** Out of scope. ASP.NET Core's standalone `WebApplication.CreateBuilder` path scaffolded in 1.1.7 is debuggable via the C# extension's normal launch config — no extension involvement needed.
- **Production cluster safeguards.** No guard rails are needed because production clusters are remote, and remote is unconditionally skipped for 1.1.8. When remote support lands in a future plan, the warning/guard rails will be designed there.
- **Attach to Setup entry point processes.** Only `MainEntryPoint.ProcessId` from `getDeployedCodePackages` is targeted. Setup entry points are typically short-lived bootstrap scripts.
- **Container or Guest Executable services.** SF does not surface a managed PID for these via the gateway today, so they're skipped silently — same behavior as the manual command.
- **CLR runtime auto-detection.** Auto-attach always uses `coreclr`. Users who need `clr` auto-attach can leave the setting on `'never'` and use the manual command. (Real-world data: 1.1.7 telemetry shows ~2% of attaches pick `clr`; not worth the complexity.)

## 4. Surface area at a glance

| New / changed | Where | Responsibility |
|---|---|---|
| `serviceFabric.debug.autoAttachOnPublish` | package.json `contributes.configuration.properties` | Two-valued enum (`never` / `localOnly`). |
| `serviceFabric.debug.autoAttachMaxSessions` | same | Cap on simultaneous auto-attach sessions per Publish. |
| `serviceFabric.debug.autoAttachReadyTimeoutSec` | same | Replica readiness poll timeout. |
| `serviceFabric.debug.autoAttachPromptShown` (workspace state, not a setting) | `Memento` key | Suppresses the first-deploy "do you want auto-attach?" prompt after the user has answered once. Set only on local-cluster deploys. |
| `Service Fabric: Auto-attach next deploy` command | package.json `contributes.commands` | Tree-context one-shot toggle. |
| `src/debug/autoAttach.ts` | **new file** | Pure orchestration: poll for `Ready`, resolve PIDs, build N debug configs, call `vscode.debug.startDebugging` once per PID, surface aggregated outcome. Uses existing `SfRestClient` + `buildAttachConfig` + `ensureDebuggerAvailable`. Short-circuits at the first non-local cluster check. |
| `src/debug/autoAttachState.ts` | **new file** | Pure helpers (no `vscode` import) for the state machine: deciding whether to attach given (setting, cluster kind, one-shot flag, prompt-shown flag) and computing the post-deploy plan from a list of `DeployedCodePackageSummary`. Unit-testable. |
| `src/deploy/deployFlow.ts` | post-success hook | After the successful `Publish-NewServiceFabricApplication` PowerShell call, dispatch into `autoAttach.ts` (best-effort, async-but-awaited so the success toast appears after auto-attach decides). |
| `src/extension.ts` | command registration | Register `serviceFabric.debug.autoAttachNext` (one-shot) + plumb `Memento` access into the deploy flow. |
| `src/tree/applicationTreeProvider.ts` | context-menu wiring | Add the `serviceFabric.debug.autoAttachNext` menu item to the application node's context menu (group `9_modify@2`). |
| Tests | `test/unit/autoAttachState.test.ts` (**new**), `test/unit/autoAttach.test.ts` (**new**, light orchestration coverage with mocked SfRestClient) | See §8. |
| Docs | docs/HOWTO.md §9 (Debugging), §12 settings rows, §13 command row; CHANGELOG.md; README.md *Features* bullet | See §9. |

## 5. Implementation

### 5.1 New module — `src/debug/autoAttachState.ts`

Pure (no `vscode` import) decision helpers. The orchestrator in §5.2 wires them to `vscode` APIs.

```ts
export type AutoAttachSetting = 'never' | 'localOnly';
export type ClusterKind = 'local' | 'remote';

export interface AutoAttachDecisionInput {
    setting: AutoAttachSetting;
    clusterKind: ClusterKind;
    oneShotPending: boolean;
    promptShownBefore: boolean;
}

export type AutoAttachDecision =
    | { kind: 'attach' }
    | { kind: 'skip' }
    | { kind: 'prompt-then-decide' };

export function decideAutoAttach(input: AutoAttachDecisionInput): AutoAttachDecision {
    // Hard guard: remote clusters are out of scope for 1.1.8.
    // Skip silently — no prompt, no attach — even if a one-shot is pending.
    if (input.clusterKind !== 'local') return { kind: 'skip' };

    // One-shot wins everything else (only fires for local clusters per the guard above).
    if (input.oneShotPending) return { kind: 'attach' };

    if (input.setting === 'localOnly') return { kind: 'attach' };

    // setting === 'never'
    if (!input.promptShownBefore) return { kind: 'prompt-then-decide' };
    return { kind: 'skip' };
}

/** Plan one debug session per host PID, capped. Returns the slice that will
 *  be attached and the count that was dropped due to the cap. */
export function planAutoAttach(
    pkgs: ReadonlyArray<DeployedCodePackageSummary>,
    cap: number
): { selected: DeployedCodePackageSummary[]; droppedCount: number } {
    const eligible = pkgs.filter(p => typeof p.processId === 'number' && p.processId > 0);
    if (eligible.length <= cap) return { selected: [...eligible], droppedCount: 0 };
    return { selected: eligible.slice(0, cap), droppedCount: eligible.length - cap };
}
```

A second helper translates the user's answer to the first-deploy prompt into a setting value:

```ts
export type FirstDeployPromptChoice =
    | 'attach-once-localOnly'
    | 'never-this-time'
    | 'dont-ask-again';

export interface PromptOutcome {
    settingUpdate?: AutoAttachSetting;
    attachThisTime: boolean;
}

export function classifyFirstDeployPrompt(
    choice: FirstDeployPromptChoice
): PromptOutcome {
    switch (choice) {
        case 'attach-once-localOnly':
            return { settingUpdate: 'localOnly', attachThisTime: true };
        case 'never-this-time':
            return { settingUpdate: undefined, attachThisTime: false };
        case 'dont-ask-again':
            return { settingUpdate: 'never', attachThisTime: false };
    }
}
```

### 5.2 New module — `src/debug/autoAttach.ts`

Owns the runtime side: gathers state, makes the decision, polls for replica readiness, fans out attach calls, surfaces outcome.

Key entry point:

```ts
export interface AutoAttachContext {
    readonly applicationName: string;          // e.g. "fabric:/MyApp"
    readonly applicationTypeName: string;      // helps with log messages
    readonly clusterEndpoint: string;          // for SfRestClient
    readonly clusterKind: ClusterKind;
    readonly memento: vscode.Memento;          // workspaceState — one-shot + prompt-shown flags
}

export async function maybeAutoAttachAfterDeploy(
    ctx: AutoAttachContext,
    logger: Logger,
    telemetry: Telemetry
): Promise<void>;
```

Flow:

1. Read setting + Memento → call `decideAutoAttach`. The hard `clusterKind !== 'local'` guard inside `decideAutoAttach` short-circuits the entire feature for remote clusters — the orchestrator never proceeds past this step on a remote deploy. (One-shot Memento entries are *still* consumed on a remote deploy so they don't leak across cluster switches.)
2. If `prompt-then-decide`: surface modal `showInformationMessage` with the three choices in §5.1; persist `promptShownBefore` regardless; if `settingUpdate` returned, call `cfg.update(ConfigurationTarget.Workspace)`. If `attachThisTime` is false, return.
3. Pre-flight: call existing `ensureDebuggerAvailable('coreclr', logger)`. On `false`, log + bail.
4. Poll for replica readiness (§5.3).
5. Resolve PIDs via existing `SfRestClient.getDeployedCodePackages`.
6. Apply `planAutoAttach` to enforce the cap.
7. For each selected `pkg`: build a config via existing `buildAttachConfig(pkg, 'coreclr')`, then await `vscode.debug.startDebugging(undefined, config)` sequentially (NOT in parallel — VS Code's debug-session UI gets confused by simultaneous starts; sequential takes ~200 ms per session).
8. Aggregate outcome → toast: *"Auto-attached debugger to N service(s) of `<appName>`."* On any single failure, *"Auto-attached debugger to N of M service(s) — see Service Fabric output channel for details."*
9. Telemetry event `extension.debug.autoAttach` with `{ outcome, attachedCount, droppedCount, clusterKind }`.

### 5.3 Replica-readiness poll

New helper inside `autoAttach.ts`:

```ts
async function waitForAtLeastOneReadyReplica(
    client: SfRestClient,
    appFullName: string,
    timeoutMs: number,
    pollIntervalMs: number = 1000
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const services = await client.listServices(appFullName).catch(() => []);
        if (services.length === 0) {
            await sleep(pollIntervalMs);
            continue;
        }
        // For each service, ask for replicas, accept once any one shows Ready.
        let anyReady = false;
        for (const svc of services) {
            const replicas = await client.listReplicas(svc.id).catch(() => []);
            if (replicas.some(r => r.replicaStatus === 'Ready')) {
                anyReady = true;
                break;
            }
        }
        if (anyReady) return true;
        await sleep(pollIntervalMs);
    }
    return false;
}
```

This requires two **new** thin methods on `SfRestClient`:

- `listServices(appFullName: string): Promise<{ id: string; manifestName: string }[]>` — wraps `/Applications/{id}/$/GetServices` (returning the URL-encoded service ID needed for partition lookups).
- `listReplicas(serviceId: string): Promise<{ replicaStatus: string; nodeName: string }[]>` — wraps `/Services/{id}/$/GetPartitions` then per-partition `/Partitions/{id}/$/GetReplicas`.

Both are minimal additions; the existing `getApplicationNodes` (which already walks the same chain to collect nodes) can stay — it's used by other call sites.

### 5.4 Wiring into `deployFlow.ts`

The current success branch ([src/deploy/deployFlow.ts](src/deploy/deployFlow.ts)) is a single `if (result.exitCode === 0)`. The hook is one new call:

```ts
if (result.exitCode === 0) {
    vscode.window.showInformationMessage('Service Fabric deployment completed successfully.');
    const a = store.getActive();
    if (a) await local.refresh(a);

    // 1.1.8 — best-effort post-deploy auto-attach.
    if (a && project.applicationManifest) {
        try {
            const { maybeAutoAttachAfterDeploy } = await import('../debug/autoAttach.js');
            await maybeAutoAttachAfterDeploy(
                {
                    applicationName: `fabric:/${project.applicationManifest.applicationTypeName.replace(/Type$/, '')}`,
                    applicationTypeName: project.applicationManifest.applicationTypeName,
                    clusterEndpoint: a.endpoint,
                    clusterKind: a.kind === 'local' ? 'local' : 'remote',
                    memento: workspaceState
                },
                logger,
                telemetry
            );
        } catch (err) {
            logger.warn(`Auto-attach hook threw: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
```

**Open question — `applicationName` derivation.** The current deploy flow does NOT receive the deployed application's `fabric:/` name; it's whatever the publish profile + StartupServices.xml end up creating. Two options:

- **Option A (chosen for this plan).** Derive from `applicationTypeName` by stripping the `Type` suffix — matches the convention `Add Application` / `Create Application` enforce. Wrong only if the user has hand-edited `StartupServices.xml` to use a non-conventional name.
- **Option B (deferred).** After `Publish-NewServiceFabricApplication` returns, query `/Applications/` and find the newest entry whose `TypeName` matches. Requires an extra round-trip; deferred to a follow-up iff Option A surfaces user-reported mismatches.

`workspaceState` (the `Memento`) is plumbed from `extension.ts` into `deployCommand` via a new optional parameter (defaulted to a no-op stub for any test-only callers).

### 5.5 The one-shot tree toggle

New command + new context-menu wiring:

- `package.json` `contributes.commands` row:

  ```json
  {
      "command": "serviceFabric.debug.autoAttachNext",
      "title": "Auto-attach Debugger Next Deploy",
      "category": "Service Fabric"
  }
  ```

- `package.json` `contributes.menus.view/item/context` row:

  ```json
  {
      "command": "serviceFabric.debug.autoAttachNext",
      "when": "view == serviceFabric.applications && viewItem == sfApplication",
      "group": "9_modify@2"
  }
  ```

- `extension.ts` registration:

  ```ts
  ['serviceFabric.debug.autoAttachNext', (n?: SfTreeNode) => {
      const appName = n?.application?.name;
      if (!appName) {
          vscode.window.showWarningMessage(
              'Right-click an application in the Service Fabric tree to enable auto-attach for the next deploy.'
          );
          return;
      }
      const key = `serviceFabric.autoAttachNext:${appName}`;
      void context.workspaceState.update(key, true);
      vscode.window.showInformationMessage(
          `Auto-attach armed for ${appName}. The next successful Publish will attach the debugger.`
      );
  }]
  ```

- The `autoAttach.ts` orchestrator reads the same key and clears it (`update(key, undefined)`) before deciding, regardless of subsequent attach outcome.

### 5.6 Settings additions (`package.json`)

Append to `contributes.configuration.properties`, right after the existing `serviceFabric.debug.suppressInstallPrompt`:

```json
"serviceFabric.debug.autoAttachOnPublish": {
    "type": "string",
    "enum": ["never", "localOnly"],
    "enumDescriptions": [
        "Never auto-attach the debugger after a successful Publish (default).",
        "Auto-attach the debugger after a successful Publish to a local development cluster. Publishes to remote clusters are unaffected and do not auto-attach in this release."
    ],
    "default": "never",
    "description": "Whether 'Service Fabric: Publish Application…' should automatically attach the debugger to every host PID of the deployed application when publishing to a local cluster. Remote-cluster auto-attach is not yet supported. The first successful local-cluster Publish on a workspace surfaces an interactive prompt offering to set this value."
},
"serviceFabric.debug.autoAttachMaxSessions": {
    "type": "number",
    "default": 5,
    "minimum": 1,
    "maximum": 50,
    "description": "Cap on the number of debug sessions auto-attach starts per Publish. Excess host PIDs are skipped (the count is surfaced in the post-deploy toast)."
},
"serviceFabric.debug.autoAttachReadyTimeoutSec": {
    "type": "number",
    "default": 30,
    "minimum": 5,
    "maximum": 300,
    "description": "Maximum seconds to wait after Publish for at least one replica per service to report 'Ready' before resolving host PIDs and attaching."
}
```

### 5.7 Telemetry

Two new events:

```
extension.debug.autoAttach.decision
{ setting, clusterKind, oneShot: boolean, decision: 'attach' | 'skip' | 'prompt' }
```

```
extension.debug.autoAttach.result
{
  outcome: 'success' | 'partial' | 'failed' | 'no-eligible-pids' | 'preflight-declined' | 'ready-timeout' | 'skipped-remote',
  attachedCount: number,
  droppedCount: number,
  clusterKind: 'local' | 'remote',
  durationMs: number
}
```

`'skipped-remote'` is the explicit outcome when the orchestrator short-circuits because the active cluster is non-local — useful telemetry for sizing demand for the remote follow-up plan.

Both routed via the existing `Telemetry` shim.

## 6. UX details

### 6.1 The first-deploy prompt

Modal `showInformationMessage` (modal so the deploy outcome doesn't get buried), shown only when:

- the active cluster is **local** (remote deploys never trigger the prompt — the orchestrator short-circuits before reaching the prompt step),
- `setting === 'never'`,
- `promptShownBefore === false`,
- the deploy succeeded.

```
"Service Fabric: Publish completed. Auto-attach the debugger after future local-cluster Publishes?"
[ Yes ]   [ Not now ]   [ Don't ask again ]
```

| Button | Effect on setting | Attach this time |
|---|---|---|
| Yes | Write `'localOnly'` | Yes |
| Not now | (unchanged) | No |
| Don't ask again | Write `'never'` | No |

Dismissing the modal (Esc) is treated as **Not now**. The `promptShownBefore` `Memento` key is set in **all three cases** — once a user has answered, we never re-prompt unless the setting is reset.

### 6.2 Remote clusters

There is no remote-cluster UX in 1.1.8. Publishing to a remote cluster behaves identically to a 1.1.7 Publish: success toast, no auto-attach, no prompt, no warning. The `autoAttachOnPublish` setting is ignored on remote deploys regardless of value, and the one-shot tree toggle is consumed silently without attaching. The manual **Attach Debugger to Deployed Service…** command continues to work for remote clusters as it always has.

A future plan (likely 1.2.x) will introduce explicit remote support with the warning/guard rails appropriate to attaching against live traffic.

### 6.3 The post-attach toast

| Outcome | Toast | Buttons |
|---|---|---|
| Single PID, success | *"Auto-attached debugger to {service}/{codePackage} (pid {n})."* | (none) |
| Multi-PID, all succeeded | *"Auto-attached debugger to {N} service(s) of {appName}."* | (none) |
| Multi-PID, partial | *"Auto-attached debugger to {N} of {M} service(s). See Service Fabric output channel for failures."* | **Open Output Channel** |
| Cap dropped some | append: *"({K} additional host(s) skipped — raise `serviceFabric.debug.autoAttachMaxSessions` to include them.)"* | (none) |
| No eligible PIDs | *"No host processes were available to attach. Containers and Guest Executables do not expose a managed PID."* (info, not warning) | (none) |
| Preflight (debugger ext) declined | (no toast — the ext-missing modal is its own UX) | n/a |
| Ready timeout | *"Auto-attach skipped — no service replica became Ready within {N}s."* (warning) | **Retry** (re-runs the orchestrator with a fresh poll budget) |

### 6.4 Telemetry surfaces

Per §5.7. Both routed through the existing `Telemetry` shim — local-only logging by default, no network egress.

## 7. File-by-file change list

| File | Change |
|---|---|
| `src/debug/autoAttachState.ts` | **New.** Pure decision helpers per §5.1. No `vscode` import. |
| `src/debug/autoAttach.ts` | **New.** Orchestrator per §5.2 — reads setting + Memento, drives prompts, polls readiness, fans out `vscode.debug.startDebugging`, aggregates outcome. |
| `src/cluster/sfRestClient.ts` | Add `listServices` and `listReplicas` per §5.3. Keep existing helpers untouched. |
| `src/deploy/deployFlow.ts` | Insert the post-success hook per §5.4. Add an optional `workspaceState` parameter on `deployCommand`. |
| `src/extension.ts` | Pass `context.workspaceState` into `deployCommand`. Register `serviceFabric.debug.autoAttachNext` per §5.5. |
| `src/tree/applicationTreeProvider.ts` | (No code change — the menu wiring is in `package.json`. Verify the existing `viewItem == sfApplication` context value is still emitted by `getTreeItem`.) |
| `package.json` | Add command + menu row + 3 settings per §5.5–§5.6. **No `version` change.** |
| `docs/HOWTO.md` | New §9.5 *Auto-attach the debugger after Publish* (under existing §9 Debugging). New rows in §12 Settings reference. New row in §13 Commands reference. |
| `README.md` | One-line bullet under *Features* mentioning auto-attach. |
| `CHANGELOG.md` | New `## 1.1.8` section above the existing `## 1.1.7` per §9. |
| `test/unit/autoAttachState.test.ts` | **New** — exhaustive matrix coverage of `decideAutoAttach`, `planAutoAttach`, `classifyFirstDeployPrompt`. |
| `test/unit/autoAttach.test.ts` | **New** — light orchestration tests against a mocked `SfRestClient` covering: success, partial-failure, ready-timeout, cap-dropped, no-eligible-PIDs, prompt-cancel, remote-skip-short-circuit. |
| `test/unit/sfRestClient.test.ts` | **Augment** (or new if not present) — verify `listServices` / `listReplicas` URL shape + JSON parsing against captured fixtures. |

## 8. Tests

### 8.1 Unit — pure decision helpers (`test/unit/autoAttachState.test.ts`, ~12 tests)

`decideAutoAttach` matrix:

- `setting='never', clusterKind='local', oneShot=false, promptShown=false` → `prompt-then-decide`.
- `setting='never', clusterKind='local', oneShot=false, promptShown=true` → `skip`.
- `setting='never', clusterKind='local', oneShot=true, promptShown=false` → `attach` (one-shot wins).
- `setting='never', clusterKind='local', oneShot=true, promptShown=true` → `attach`.
- `setting='localOnly', clusterKind='local'` → `attach`.
- `setting='localOnly', clusterKind='remote'` → `skip` (remote guard).
- `setting='localOnly', clusterKind='remote', oneShot=true` → `skip` (remote guard wins over one-shot — enforces the local-only scope of 1.1.8).
- `setting='never', clusterKind='remote', promptShown=false` → `skip` (no prompt on remote).
- `setting='never', clusterKind='remote', oneShot=true` → `skip` (one-shot still consumed by orchestrator but no attach).

`planAutoAttach`:

- Empty input → `selected: [], droppedCount: 0`.
- All-PIDs-present, count ≤ cap → returns all, `droppedCount: 0`.
- Count > cap → returns first `cap`, `droppedCount: count - cap`.
- Mixed (some `processId === undefined`) → undefineds filtered first, then capped.
- Cap of `1` with 5 eligible → 1 selected, 4 dropped.

`classifyFirstDeployPrompt`:

- All three choices → expected `(settingUpdate, attachThisTime)` pairs.

### 8.2 Unit — orchestration (`test/unit/autoAttach.test.ts`, ~8 tests)

Mock `SfRestClient` with stubbed `listServices` / `listReplicas` / `getDeployedCodePackages`. Mock `vscode.debug.startDebugging` via the existing test shim. Inject a fake `Memento`.

- Successful attach against single PID (local cluster) → `startDebugging` called once with the expected config; success toast.
- Multi-PID success (local cluster) → `startDebugging` called N times sequentially; aggregated success toast.
- Cap drops excess (local cluster) → only `cap` calls; toast includes the dropped-count suffix.
- Ready timeout (local cluster) → orchestrator returns without calling `startDebugging`; warning toast; telemetry `outcome: 'ready-timeout'`.
- Pre-flight declined (debugger extension missing, user canceled install) → no `startDebugging`; no toast (the modal is its own surface); telemetry `outcome: 'preflight-declined'`.
- One-shot consumption — local cluster → Memento key for the application is cleared after the orchestrator runs, regardless of attach outcome.
- Remote-cluster short-circuit → orchestrator returns immediately with no prompt, no `startDebugging`, no toast; telemetry `outcome: 'skipped-remote'`. Verifies the local-only scope of 1.1.8 holds even when a one-shot Memento entry is present (the entry is still consumed).
- No eligible PIDs → info toast; telemetry `outcome: 'no-eligible-pids'`; no `startDebugging` calls.

### 8.3 Unit — `SfRestClient` additions (`test/unit/sfRestClient.test.ts`)

If the file doesn't exist yet (none in tree as of 1.1.7), create it. Otherwise augment with:

- `listServices` issues `/Applications/{encoded}/$/GetServices`, parses `Items[].Id` and `Items[].ServiceManifestName`.
- `listReplicas` walks `GetPartitions` → `GetReplicas`, returns `{ replicaStatus, nodeName }` per replica.
- URL-encoding of an application name containing `/` or `:`.

### 8.4 Manual smoke

1. Local cluster, fresh workspace: Publish a simple `aspNetStateless` app → first-deploy prompt fires → pick **Yes** → confirm setting written (`localOnly`) + debugger attaches.
2. Local cluster, second Publish on same workspace → no prompt; auto-attach fires silently.
3. Local cluster with `'never'` setting (and `promptShownBefore` set) → no prompt, no attach.
4. Local cluster, right-click app → **Auto-attach Debugger Next Deploy** → Publish → auto-attach fires; one-shot Memento cleared.
5. **Remote cluster, any setting value, any one-shot state** → no prompt, no attach, no warning. Toast is identical to a 1.1.7 deploy. Telemetry records `outcome: 'skipped-remote'`. Confirms the 1.1.8 local-only scope.
6. Multi-service app on local cluster (ASP.NET stateless + plain stateless) → cap of `5` covers both; toast says "2 service(s)".
7. Local cluster, cap of `1`, two services → first attaches, toast says "1 of 2 — 1 host(s) skipped".
8. Container service published to local cluster → no eligible PIDs toast.
9. Local cluster, disconnect mid-deploy (force ready timeout) → warning toast with **Retry** button → click Retry → re-runs poll + attach.
10. Local cluster, debugger extension uninstalled mid-deploy → install modal fires; cancel → no attach, no error toast.

## 9. CHANGELOG entry (`CHANGELOG.md`)

Insert above the existing `## 1.1.7`:

```md
## 1.1.8

Auto-attach the .NET debugger after a successful **Service Fabric: Publish Application…** to a local development cluster.

- **New setting `serviceFabric.debug.autoAttachOnPublish`** with two values: `never` (default) and `localOnly`. When set to `localOnly`, a successful Publish to a local dev cluster resolves every host PID of the deployed application via the SF gateway and starts a `coreclr` debug session against each — eliminating the manual *Attach Debugger to Deployed Service…* picker chain after every deploy. Sessions are started sequentially and named distinctly so VS Code's CALL STACK panel groups them naturally. **Remote clusters are unaffected** in this release; the manual command remains the path for remote attach.
- **First-deploy prompt.** The first successful local-cluster Publish on a workspace where the setting is `never` surfaces a modal: *"Auto-attach the debugger after future local-cluster Publishes?"* with **Yes** / **Not now** / **Don't ask again**. Selecting *Yes* writes `localOnly` and attaches this Publish; selecting *Don't ask again* leaves the setting at `never`. The prompt fires only once per workspace and never on remote-cluster deploys.
- **One-shot tree toggle.** Right-click an `Application` node in the **Service Fabric** view → **Auto-attach Debugger Next Deploy**. The next successful Publish targeting that application auto-attaches even when the global setting is `never`. The flag is consumed after a single Publish; it is also consumed (without attaching) if the next Publish targets a remote cluster, matching the local-only scope of this feature.
- **Multi-PID fan-out, capped.** Multi-service applications attach one debug session per host PID, sequentially. Capped by `serviceFabric.debug.autoAttachMaxSessions` (default `5`); excess PIDs are skipped and surfaced in the post-deploy toast.
- **Replica-readiness poll.** After Publish completes, the orchestrator polls `/Services/.../GetReplicas` for up to `serviceFabric.debug.autoAttachReadyTimeoutSec` seconds (default `30`) waiting for at least one replica per service to report `Ready` before resolving PIDs.
- **Failure-mode isolation.** Any auto-attach failure (PID resolution, debugger-extension missing, `startDebugging` returning `false`, ready timeout) surfaces a warning toast with **Open Output Channel** but never undoes the *Publish completed successfully* outcome. The existing `serviceFabric.debug.suppressInstallPrompt` setting still gates the C# extension install prompt for the auto-attach pre-flight.
- **Remote-cluster behavior unchanged.** Publishing to a non-local cluster is identical to a 1.1.7 Publish: success toast, no prompt, no attach, no warning. Remote-cluster auto-attach is deferred to a future release.
- **New settings.** `serviceFabric.debug.autoAttachOnPublish` (default `never`); `serviceFabric.debug.autoAttachMaxSessions` (default `5`); `serviceFabric.debug.autoAttachReadyTimeoutSec` (default `30`).
- **New command.** `Service Fabric: Auto-attach Debugger Next Deploy` — surfaced from the application context menu on the **Applications** tree.
- **Tests:** baseline +~22. New file `test/unit/autoAttachState.test.ts` covers the decision matrix (including the local-only guard), planning, and prompt classification exhaustively. New file `test/unit/autoAttach.test.ts` covers the orchestrator end-to-end against a mocked `SfRestClient`, including the remote-cluster short-circuit path. `test/unit/sfRestClient.test.ts` adds coverage for the new `listServices` / `listReplicas` helpers.
```

`package.json` `version` is **not** bumped — the release script (`scripts/release.ps1`) handles it at `npm run release` time.

## 10. Acceptance gate

Before tagging 1.1.8:

1. `npm run typecheck` clean.
2. `npm run lint` clean.
3. `npm run test:unit` clean — baseline +~25 (new + augmented tests).
4. **Manual smoke #1–#5 from §8.4 on Windows** mandatory; #6–#10 strongly recommended.
5. **Regression guard:** Publish on a workspace with `serviceFabric.debug.autoAttachOnPublish: 'never'` and `promptShownBefore` already set is identical to a 1.1.7 Publish (no extra UI, no debug session).
6. **`CHANGELOG.md` updated** with the new `## 1.1.8` section verbatim from §9, inserted above the existing `## 1.1.7` entry. Confirms the release-notes summary will land in the GitHub release / Marketplace listing produced by `npm run release`.
7. `npm run package` produces `artifacts/service-fabric-project-tools-vscode-1.1.8.vsix` (the version pinned by the release script). Prior `.vsix` files in `artifacts/` are preserved.

## 11. Open questions / out of scope

- **Remote-cluster auto-attach (the obvious follow-up).** Deferred to a future plan, likely 1.2.x. That plan will need to design: (a) `pipeTransport` configuration for SSH-tunneled `vsdbg`, (b) a helper that ships/locates `vsdbg` on the cluster nodes, (c) source/symbol mapping (the workspace's `bin/Debug` paths won't match the cluster's deployed paths), (d) the warning UX for attaching to a process serving live traffic, (e) re-attach behavior when the active connection switches from local to remote mid-session, and (f) an explicit downgrade path back to `'localOnly'`. None of that is built now — 1.1.8 ships a complete, well-scoped local-cluster feature and explicitly defers the remote story.
- **Application-name derivation from `applicationTypeName`.** Per §5.4 Option A. If user reports surface mismatches with hand-edited `StartupServices.xml`, fall back to Option B (post-deploy `/Applications/` query) in a follow-up.
- **Re-attach on replica failover / restart.** Out of scope. A separate `autoReattach` plan can wire `vscode.debug.onDidTerminateDebugSession` + a periodic `getReplicas` poll later.
- **Auto-attach for `clr` runtime.** Out of scope per §3 — manual command remains the path for the ~2% of users who need it.
- **Custom debug-config template.** A future setting `serviceFabric.debug.autoAttachConfigTemplate` could let advanced users override `justMyCode`, `symbolOptions`, etc. Out of scope here; the current `buildAttachConfig` defaults are the right starting point.
- **Detecting whether the active VS Code window is the one that ran the Publish.** When two windows of the same workspace are open, both currently see the deploy succeed. Auto-attach would fire from whichever window invoked Publish — which is the desired behavior. No additional disambiguation needed.
- **Debugging from a *fresh-clone* workspace where `applicationManifest` is unparseable.** The hook short-circuits silently when `project.applicationManifest` is undefined (§5.4). The Publish itself wouldn't have made it past the existing manifest checks, so this is defensive only.
- **Sessions for the same PID across rapid re-deploys.** VS Code does not auto-detach previous sessions when a process is recycled; users will see two sessions in CALL STACK after a second auto-attached Publish, the older one with a dead PID. Acceptable for v1; a follow-up could call `vscode.debug.stopDebugging` on stale sessions before re-attaching.
- **Surfacing a Status Bar indicator** while the orchestrator is polling for replica readiness. Out of scope for v1; a single notification with a progress spinner would be the obvious next step if users report ambiguity.
