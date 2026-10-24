# Plan — 1.1.5 (Debugger Pre-flight Check)

## 0. Scope summary

A single, contained UX fix for **Attach Debugger to Deployed Service…**.

Today, when a user invokes the attach flow without a managed-debug adapter installed, they get one of two unhelpful outcomes:

1. VS Code's generic *"There is no debugger extension that supports this debug type"* picker — which **does not surface `ms-dotnettools.csharp`** prominently because the marketplace recommendation is keyed off the debug `type` and the prompt's wording is generic.
2. A toast from our extension saying *"VS Code refused to start the coreclr debugger"* (after the fact — at [src/debug/attachToService.ts](src/debug/attachToService.ts#L93-L98)).

Neither leads the user to the right place: *install **C#** (`ms-dotnettools.csharp`)*. Reports from the field show users hunting for *C# Dev Kit* (the wrong extension — Dev Kit does not ship a debugger; it depends on the C# extension for that).

1.1.5 ships:

- A **pre-flight check** that runs *before* `vscode.debug.startDebugging`, detects the required adapter extension, and offers a **one-click Install** action.
- Coverage for **both** `coreclr` and `clr` runtimes (see §3 + §6 for the differences).
- Improved post-failure messaging (the existing toast becomes a fallback, not the primary surface).
- A new `serviceFabric.debug.suppressInstallPrompt` setting for environments where the prompt is not desired (CI / sandboxed testing).

The change is fully additive. No existing flow is removed; no schema changes; no version-bump implications for other features.

## 1. Problem statement

The right-click → **Attach Debugger to Deployed Service…** flow:

1. Picks application + node + code package.
2. Resolves PID via the SF gateway.
3. Picks debug runtime (`coreclr` or `clr`).
4. Calls `vscode.debug.startDebugging(undefined, { type: 'coreclr', request: 'attach', processId, … })`.

If no extension has registered a `debuggers` contribution for `type: 'coreclr'`, step 4 returns `false`. We currently surface:

```
VS Code refused to start the coreclr debugger.
Ensure the matching debugger extension is installed (e.g. ms-dotnettools.csharp for coreclr).
```

Three problems:

1. **The user has already gone through 4 quick-picks** before discovering the install gap. They have to start over after fixing it.
2. **The message is text-only** — no button to install the extension, no way to open the marketplace listing.
3. **It implies any extension that supplies `coreclr`** would do. In practice, the only Microsoft-supported choice in the public VS Code marketplace is `ms-dotnettools.csharp`. Forks/alternatives do not redistribute `vsdbg` (license restriction). Pointing at the canonical extension by ID is more useful than the generic phrasing.

Real-world report (verbatim):

> *"when I right click and attach debugger, it tells me I don't have the debugger available and I should install it. I just don't see the C# Dev Kit as an option though?"*

— a clean illustration of the confusion: the user looked for **C# Dev Kit** because it sounds richer, but Dev Kit doesn't ship a debugger. The right answer is the plain **C#** extension. The extension can and should make this unambiguous.

## 2. Goal

Make the *first* time a user attaches to a deployed service end either in **a working debug session** or in **one click + reload to install the right extension, then a working debug session**, with no false trails.

Acceptance:

1. Fresh VS Code with no `ms-dotnettools.*` extensions installed → right-click → *Attach Debugger…* → after the runtime pick, a modal appears: *"The C# extension (ms-dotnettools.csharp) is required to attach the .NET (coreclr) debugger."* with **Install C# Extension**, **Open Marketplace**, and **Cancel** buttons. *Install* runs the install command, waits, then continues into the existing attach flow against the already-resolved PID. No re-pick.
2. Same scenario but the user has `ms-dotnettools.csharp` installed → no prompt; flow is identical to today.
3. `clr` runtime selected on non-Windows → fail-fast modal *".NET Framework (`clr`) debugging is Windows-only. Pick `coreclr` instead."* (no install offer — the install wouldn't help).
4. `clr` on Windows, C# extension missing → same install prompt as `coreclr`. Plus a one-time-per-session informational toast: *"Native CLR debugging may also require the Visual Studio Remote Debugger components on the host running the service."* (informational only — we don't try to install VS Remote Debugger).
5. `clr` on Windows, C# extension installed → continue (same as today).
6. `serviceFabric.debug.suppressInstallPrompt: true` → bypass the precheck entirely; rely on existing post-failure toast (current 1.1.4 behavior).

## 3. Background — what registers each debug type

| Debug type | Registered by | Ships the engine? | Platform |
|---|---|---|---|
| `coreclr` | **`ms-dotnettools.csharp`** (via `contributes.debuggers`) | Yes — `vsdbg`, cross-platform | Windows / macOS / Linux |
| `clr` | **`ms-dotnettools.csharp`** (same extension declares both) | Engine ships, but full *.NET Framework* attach also requires Windows + a CLRv4 process + (commonly) VS Remote Debugger components for symbol/JIT plumbing on remote hosts | Windows-only in practice |

There is **no separate "C# Dev Kit debugger"**:

- `ms-dotnettools.csdevkit` (C# Dev Kit) declares no `debuggers` contribution. It ships solution-explorer / test-runner UI and *depends on* `ms-dotnettools.csharp` for everything else, including debug.
- `ms-dotnettools.vscode-dotnet-runtime` (.NET Install Tool) only acquires runtimes; no debugger.

So for both `coreclr` and `clr`, **the answer is the same single extension ID: `ms-dotnettools.csharp`**.

The `clr` story has one extra wrinkle — Windows-only + (often) VS Remote Debugger — covered in §6.3.

## 4. Should we add `extensionDependencies`?

No. Decision matrix:

| Mechanism | Behavior | Verdict |
|---|---|---|
| `extensionDependencies: ["ms-dotnettools.csharp"]` | Auto-installs at our extension's install time. Cannot be uninstalled separately. Activation blocks if unavailable. | ❌ Forces ~200 MB + .NET runtime acquisition on every user, including those who never debug (build-only, manifest-author, package-only workflows). |
| `extensionPack` | Auto-installs as a bundle but each piece is independently manageable. | ❌ Same forced-install concern. |
| **Lazy precheck at point-of-use** (this plan) | Only nags users who actually try to attach. Offers Install button. | ✅ Targeted, lightweight. |
| Workspace recommendations (`.vscode/extensions.json`) | For workspace authors, not extension authors. | n/a |

Additional reasons against the hard dependency:

- **`ms-dotnettools.csharp` is not on Open VSX** — making it an `extensionDependencies` entry breaks our extension on VSCodium / Cursor / code-server installs that point at OpenVSX. `redhat.vscode-xml` (our existing dep) works because it *is* mirrored to OpenVSX.
- **The `clr` runtime needs more than a marketplace install** (Windows + VS Remote Debugger). A blanket dep over-promises.
- **Most users don't debug from VS Code** — they build, package, deploy, and view diagnostic events. Forcing the C# extension on them is wrong for their workflow.

## 5. Implementation

### 5.1 New module — `src/debug/debuggerAvailability.ts`

Pure-helper module (no `vscode` runtime import) for unit-testability. The orchestrator in `attachToService.ts` injects an adapter for the actual `vscode.extensions.getExtension` / `vscode.commands.executeCommand` calls.

```ts
export type DebugRuntime = 'coreclr' | 'clr';

export interface DebuggerRequirement {
    /** The extension ID that registers this debug type. */
    extensionId: string;
    /** Display name for prompts. */
    extensionName: string;
    /** True when the runtime is platform-restricted (clr → Windows). */
    platformRestricted?: { allowedPlatform: NodeJS.Platform; reason: string };
    /** Optional follow-up advice rendered as an informational toast on first use. */
    additionalAdvice?: string;
}

export function requirementFor(runtime: DebugRuntime): DebuggerRequirement {
    if (runtime === 'coreclr') {
        return {
            extensionId: 'ms-dotnettools.csharp',
            extensionName: 'C# (ms-dotnettools.csharp)'
        };
    }
    // clr
    return {
        extensionId: 'ms-dotnettools.csharp',
        extensionName: 'C# (ms-dotnettools.csharp)',
        platformRestricted: {
            allowedPlatform: 'win32',
            reason: '.NET Framework (clr) debugging is Windows-only.'
        },
        additionalAdvice:
            'Native CLR debugging may also require the Visual Studio Remote Debugger components on the host running the service.'
    };
}

export interface AvailabilityCheckHost {
    isExtensionInstalled(id: string): boolean;
    platform: NodeJS.Platform;
}

export type AvailabilityResult =
    | { kind: 'available' }
    | { kind: 'platform-blocked'; reason: string }
    | { kind: 'extension-missing'; requirement: DebuggerRequirement };

export function checkAvailability(
    runtime: DebugRuntime,
    host: AvailabilityCheckHost
): AvailabilityResult {
    const req = requirementFor(runtime);
    if (req.platformRestricted && host.platform !== req.platformRestricted.allowedPlatform) {
        return { kind: 'platform-blocked', reason: req.platformRestricted.reason };
    }
    if (!host.isExtensionInstalled(req.extensionId)) {
        return { kind: 'extension-missing', requirement: req };
    }
    return { kind: 'available' };
}
```

This stays free of the `vscode` import — same convention as `attachConfig.ts` already uses (see [src/debug/attachConfig.ts](src/debug/attachConfig.ts)).

### 5.2 Wire the precheck into `attachToService.ts`

In the existing flow at [src/debug/attachToService.ts](src/debug/attachToService.ts#L83-L98), insert the precheck **after** `pickDebugType` but **before** `buildAttachConfig` / `startDebugging`:

```ts
const debugType = await pickDebugType();
if (!debugType) return;

if (!await ensureDebuggerAvailable(debugType, logger)) return;

const config = buildAttachConfig(pkg, debugType);
// … unchanged …
```

Where `ensureDebuggerAvailable` is a new function in the same file:

```ts
async function ensureDebuggerAvailable(
    runtime: DebugRuntime,
    logger: Logger
): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration('serviceFabric');
    if (cfg.get<boolean>('debug.suppressInstallPrompt') === true) return true;

    const result = checkAvailability(runtime, {
        platform: process.platform,
        isExtensionInstalled: id => !!vscode.extensions.getExtension(id)
    });

    if (result.kind === 'available') return true;

    if (result.kind === 'platform-blocked') {
        await vscode.window.showErrorMessage(
            result.reason +
            (runtime === 'clr' ? ' Pick coreclr instead, or move to a Windows host.' : '')
        );
        return false;
    }

    // extension-missing
    const req = result.requirement;
    const pick = await vscode.window.showErrorMessage(
        `The ${req.extensionName} extension is required to attach the ${runtime === 'coreclr' ? '.NET (coreclr)' : '.NET Framework (clr)'} debugger.`,
        { modal: true },
        'Install C# Extension',
        'Open Marketplace',
        'Cancel'
    );
    if (pick === 'Install C# Extension') {
        await installExtensionWithProgress(req.extensionId, logger);
        const installed = !!vscode.extensions.getExtension(req.extensionId);
        if (!installed) {
            vscode.window.showErrorMessage(
                `Install of ${req.extensionId} did not complete. Try installing manually from the Extensions view.`
            );
            return false;
        }
        if (req.additionalAdvice) {
            vscode.window.showInformationMessage(req.additionalAdvice);
        }
        return true;
    }
    if (pick === 'Open Marketplace') {
        await vscode.commands.executeCommand(
            'workbench.extensions.search',
            `@id:${req.extensionId}`
        );
    }
    return false;
}

async function installExtensionWithProgress(id: string, logger: Logger): Promise<void> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Installing ${id}…`,
            cancellable: false
        },
        async () => {
            try {
                await vscode.commands.executeCommand(
                    'workbench.extensions.installExtension',
                    id
                );
                logger.info(`Installed extension ${id}`);
            } catch (e) {
                logger.error(`Failed to install ${id}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    );
}
```

### 5.3 Wire the same precheck into the F5 / `launch.json` path

`ServiceFabricDebugConfigurationProvider.resolveDebugConfiguration` ([src/debug/attachToService.ts](src/debug/attachToService.ts#L138-L168)) already delegates to `serviceFabric.debug.attachToService` — so as long as the command-handler runs `ensureDebuggerAvailable`, the F5 path is automatically covered. **No additional change needed there.**

### 5.4 Improve the post-failure toast (defensive)

Even with the precheck, `startDebugging` can still return `false` for unrelated reasons (PID disappeared, debugger ran but the attach failed, custom user-installed adapter that registers the type but barfs on this particular config). Replace the existing post-failure toast at [src/debug/attachToService.ts](src/debug/attachToService.ts#L93-L98) with something more diagnostic:

```ts
if (!ok) {
    vscode.window.showErrorMessage(
        `VS Code refused to start the ${debugType} debugger for PID ${pkg.processId}. ` +
        `Possible causes: the process exited, the C# extension didn't activate, or another extension claimed the debug type. ` +
        `Run "Developer: Show Running Extensions" or check the Service Fabric output channel for details.`,
        'Open Output Channel'
    ).then(pick => {
        if (pick === 'Open Output Channel') logger.outputChannel.show();
    });
}
```

### 5.5 New configuration setting

```json
"serviceFabric.debug.suppressInstallPrompt": {
    "type": "boolean",
    "default": false,
    "description": "When true, skip the pre-flight check that prompts to install the C# extension before attaching to a deployed service. Use in CI / sandboxed environments where the prompt is not desired."
}
```

Added to `contributes.configuration.properties` in `package.json`. Read from `ensureDebuggerAvailable` (§5.2).

## 6. UX details

### 6.1 The install prompt

Modal `showErrorMessage` with three buttons. Modal (rather than non-modal toast) is intentional: the user is mid-flow and will lose the captured PID context if they walk away without acting.

| Button | Action |
|---|---|
| **Install C# Extension** | `executeCommand('workbench.extensions.installExtension', 'ms-dotnettools.csharp')` wrapped in `withProgress`. Re-checks installation on completion; if successful, continues into `startDebugging` against the already-resolved PID. If unsuccessful, surfaces a non-modal error pointing at the Extensions view. |
| **Open Marketplace** | `executeCommand('workbench.extensions.search', '@id:ms-dotnettools.csharp')` to open the Extensions view filtered to just that extension. The user can install + reload manually; on next *Attach…* invocation, the precheck passes. |
| **Cancel** | Returns to caller; no toast. |

### 6.2 Continuity across the install

`workbench.extensions.installExtension` returns once the extension is downloaded *and* installed but **before activation events have fully fired**. To give the just-installed extension a moment to register its debug-type contribution, we re-poll `vscode.extensions.getExtension(id)` for up to 5 seconds with a 200 ms backoff before giving up. Implementation detail in `installExtensionWithProgress` — *not* in the pure helper.

### 6.3 The `clr` story

Per §3, `clr` is the same extension ID but two extra rules:

1. **Non-Windows fast-fail.** If `process.platform !== 'win32'`, do not even ask; show the platform-blocked error and return.
2. **Additional advice toast.** When the extension is installed (or just got installed) and the runtime is `clr`, show a one-time **informational** (not modal) toast: *"Native CLR debugging may also require the Visual Studio Remote Debugger components on the host running the service."* Track *one-time* via `Memento` (`globalState.get('serviceFabric.clrAdviceShown')`) so we don't pester repeat users. We do **not** try to install or detect VS Remote Debugger ourselves — out of scope.

### 6.4 Telemetry

Single new event:

```
extension.debug.preflight
{
  runtime: 'coreclr' | 'clr',
  result: 'available' | 'platform-blocked' | 'install-prompted-accepted' | 'install-prompted-declined' | 'install-failed' | 'suppressed'
}
```

Routed through the existing `Telemetry` shim. Lets us see in the field whether the prompt is converting to installs or being declined.

## 7. File-by-file change list

| File | Change |
|---|---|
| `src/debug/debuggerAvailability.ts` | **New.** Pure helpers per §5.1 — `requirementFor`, `checkAvailability`, types. No vscode import. |
| `src/debug/attachToService.ts` | Add `ensureDebuggerAvailable` + `installExtensionWithProgress` per §5.2. Insert call between `pickDebugType` and `buildAttachConfig`. Replace post-failure toast per §5.4. Surface telemetry per §6.4. |
| `src/extension.ts` | No code change to debug wiring (the `DebugConfigurationProvider` already delegates to the command). Pass the existing `Telemetry` instance into `attachToServiceCommand` if not already plumbed (review at implementation time). |
| `package.json` | Add `serviceFabric.debug.suppressInstallPrompt` to `contributes.configuration.properties`. Bump `version` `1.1.4` → `1.1.5`. |
| `CHANGELOG.md` | New `## 1.1.5` section above the existing `## 1.1.4` describing the precheck, the new setting, the `clr` advice toast, and the documentation updates. |
| `docs/HOWTO.md` | §9.4 *Debugging tips* — insert a new bullet about the precheck and what to do if you decline the install. §12 *Settings reference* — add row for `serviceFabric.debug.suppressInstallPrompt`. |
| `README.md` | Troubleshooting bullet under *Features* / *Known Issues* mentioning the precheck. |
| `media/walkthrough/attach-debugger.md` | Append paragraph: *"If the C# extension is missing, the extension will offer a one-click install."* |

## 8. Tests

Unit (`test/unit/debuggerAvailability.test.ts`, **new**, ~12 tests):

- `requirementFor('coreclr')` returns `ms-dotnettools.csharp` and no platform restriction.
- `requirementFor('clr')` returns `ms-dotnettools.csharp` with `platformRestricted.allowedPlatform === 'win32'` and a non-empty `additionalAdvice`.
- `checkAvailability('coreclr', {platform: 'win32', isExtensionInstalled: () => true})` → `available`.
- `checkAvailability('coreclr', {platform: 'linux', isExtensionInstalled: () => false})` → `extension-missing` (no platform check for coreclr).
- `checkAvailability('clr', {platform: 'linux', isExtensionInstalled: () => true})` → `platform-blocked` (platform takes precedence over extension presence).
- `checkAvailability('clr', {platform: 'darwin', isExtensionInstalled: () => false})` → `platform-blocked` (platform check fires first).
- `checkAvailability('clr', {platform: 'win32', isExtensionInstalled: () => false})` → `extension-missing`.
- `checkAvailability('clr', {platform: 'win32', isExtensionInstalled: () => true})` → `available`.
- `checkAvailability` host adapter is consulted for the **exact** extension ID returned by `requirementFor` (not a substring match).
- The result objects are tagged unions — TypeScript exhaustiveness check via `never` in a `switch` body compiles.
- Idempotency: two consecutive `checkAvailability` calls with the same host produce structurally equal results.
- Returned `requirement` reference in `extension-missing` is a fresh object per call (no shared mutable state).

Unit (`test/unit/attachToService.test.ts`, **augment existing**, ~6 new tests):

- `ensureDebuggerAvailable` returns `true` when the extension is present (no prompt fired).
- `ensureDebuggerAvailable` returns `true` when `serviceFabric.debug.suppressInstallPrompt` is `true` (no prompt fired regardless of extension presence).
- `ensureDebuggerAvailable` shows modal with `Install C# Extension` and `Open Marketplace` buttons when extension missing.
- Selecting `Install C# Extension` triggers `executeCommand('workbench.extensions.installExtension', 'ms-dotnettools.csharp')`.
- Selecting `Open Marketplace` triggers `executeCommand('workbench.extensions.search', '@id:ms-dotnettools.csharp')` and returns `false` (does not continue into attach).
- `clr` on non-Windows surfaces the platform-blocked message and never queries `vscode.extensions`.

Mocking strategy: the existing `attachToService.test.ts` already shims `vscode.window.showQuickPick` / `vscode.debug.startDebugging`. Extend the shim with `vscode.extensions.getExtension`, `vscode.workspace.getConfiguration`, `vscode.window.showErrorMessage` (modal variant), and `vscode.commands.executeCommand`. No actual extension install happens during tests.

Manual / E2E:

- Fresh VS Code with no `ms-dotnettools.csharp` installed → click *Attach Debugger…* → confirm modal appears with the three buttons → click *Install* → confirm download progress notification → confirm the attach session starts after install completes (without re-picking app/PID/runtime).
- Same as above, then click *Open Marketplace* → confirm the Extensions view opens filtered to `@id:ms-dotnettools.csharp` and the attach flow does *not* continue.
- Linux (Codespaces / WSL): pick `clr` → confirm platform-blocked message and no install offer.

## 9. Documentation

- **`docs/HOWTO.md` §9.4 Debugging tips** — append: *"If the **C#** extension (`ms-dotnettools.csharp`) is missing, the **Attach Debugger to Deployed Service…** flow surfaces a modal with **Install C# Extension** / **Open Marketplace** / **Cancel**. Choose *Install* to acquire the debugger and continue into the attach session in one step. **C# Dev Kit** is *not* required — Dev Kit ships solution-explorer UI and depends on the C# extension for debugging. The C# extension alone is sufficient."*
- **`docs/HOWTO.md` §12 Settings reference** — add a row:

  | Setting | Type | Default | Description |
  |---|---|---|---|
  | `serviceFabric.debug.suppressInstallPrompt` | `boolean` | `false` | Skip the pre-flight check that prompts to install the C# extension before attaching to a deployed service. Use in CI / sandboxed environments. |

- **`README.md`** — under *Features* / *Known Issues* add: *"If you don't have the C# extension installed, the *Attach Debugger* flow will offer to install it for you."*
- **`media/walkthrough/attach-debugger.md`** — append the install-nudge paragraph as in §7.
- **`CHANGELOG.md`** — new `## 1.1.5` section above `## 1.1.4`:

  ```md
  ## 1.1.5

  ### Added
  - Pre-flight check on **Attach Debugger to Deployed Service…**: when `ms-dotnettools.csharp` is not installed, surface a modal with **Install C# Extension** / **Open Marketplace** / **Cancel** *before* asking VS Code to start the debugger. Selecting *Install* acquires the extension and continues into the attach session in one step (no need to re-pick application / PID / runtime).
  - Platform-aware messaging for `.NET Framework (clr)` runtime — fast-fails on non-Windows with a clear reason; on Windows surfaces a one-time informational toast about VS Remote Debugger when applicable.
  - New setting `serviceFabric.debug.suppressInstallPrompt` (default `false`) to bypass the precheck.

  ### Changed
  - Post-failure debugger toast is now diagnostic rather than generic — surfaces possible causes (process exited, extension didn't activate, type was claimed by another extension) and offers a button to open the Service Fabric output channel.

  ### Tests
  - 281 → ~293 passing (+12, no regressions).
  ```

## 10. Acceptance gate

Before tagging 1.1.5:

1. `npm run typecheck` clean.
2. `npm run lint` clean.
3. `npm run test:unit` clean — ~293 tests passing (+12 vs 281 baseline).
4. **Manual smoke** on Windows VS Code: uninstall `ms-dotnettools.csharp`, run *Attach Debugger…*, install via the modal, verify the session attaches without re-pick.
5. **Manual smoke** on Linux VS Code: select `clr` runtime, verify platform-blocked message fires and no install is offered.
6. **Manual smoke** with `serviceFabric.debug.suppressInstallPrompt: true`: precheck is bypassed; falls back to the post-failure toast.
7. `npm run package` produces `artifacts/service-fabric-project-tools-vscode-1.1.5.vsix`. The 1.1.4 and 1.1.3 .vsix files in `artifacts/` are preserved.

## 11. Open questions / out of scope

- **Auto-install without confirmation** — explicitly out of scope. Always show the modal; never side-effect-install an extension on the user's machine.
- **Detecting / installing Visual Studio Remote Debugger components** — out of scope. The `clr` advice toast is informational only; we do not probe for VS Remote Debugger presence (no reliable workspace-side detection) and we do not attempt installation (out-of-band installer, requires admin elevation, machine-wide).
- **Offering `ms-dotnettools.csdevkit` (C# Dev Kit) as an alternative** — out of scope. Dev Kit doesn't ship a debugger; offering it would re-introduce the very confusion this plan eliminates. Users who want Dev Kit will install it independently.
- **Bundling our own `vsdbg`** — not legally viable. `vsdbg` is licensed for use only with Microsoft tooling and cannot be redistributed by third-party extensions.
- **Native (`cppvsdbg` / `cppdbg`) host attach for guest executables** — currently out of scope for the picker. The `runtime` quick-pick today only offers `coreclr` / `clr`. If we ever add native, this same precheck pattern will extend cleanly: the requirement table grows by one entry pointing at `ms-vscode.cpptools`, and `checkAvailability` works unchanged.
- **Probing whether the C# extension's *activation* (not just install) actually completed before continuing** — partially handled by the 5-second poll in `installExtensionWithProgress` but not deeply (an extension can be installed-and-active yet still racy on first debug-type registration). If reports of "installed but startDebugging still returns false" appear in the field, follow up with a tighter activation-event wait.
