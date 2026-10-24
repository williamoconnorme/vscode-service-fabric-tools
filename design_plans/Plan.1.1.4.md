# Plan — 1.1.4 (Restore Pre-step Fix + Add Library Project)

## 0. Scope summary

1.1.4 ships **three related improvements** that together close the most common "this looks like Visual Studio but doesn't behave like it" complaints in 1.1.3:

1. **Restore pre-step fix** — the 1.1.3 `msbuild /t:Restore` pre-step is a silent no-op against `packages.config`-style `.sfproj` files; replace it with a strategy chain that uses `nuget.exe` (or an HTTP fallback) so Build / Rebuild / Clean / Package / Publish all *just work* on a fresh clone. Detailed in §1–§5.
2. **Library project commands (Add + Remove)** — expose first-class **Service Fabric: Add Library Project…** *and* **Service Fabric: Remove Library Project…** commands, reachable from the palette, right-click on `.sfproj` (Applications view *and* File Explorer), *and* right-click on `.csproj` (File Explorer). The Add command scaffolds a sibling SDK-style class library and wires it as a `<ProjectReference>` into selected consuming services; the Remove command unwires (and optionally deletes) an existing sibling library. Detailed in §6. Libraries are *not* added to the `.sfproj`'s `<ProjectReference>` graph (libraries aren't services); see §6.1.
3. **Modernize the netcore TFM picker** — the current Add Service flow offers `net8.0` and `net6.0` (the latter is out of support since Nov 2024). Replace with `net10.0` / `net9.0` / `net8.0` to match the currently-supported .NET releases. Detailed in §5.8.

All three changes are additive and orthogonal. The restore work is the priority bug fix; the library commands and TFM refresh are UX gaps that have come up repeatedly.

## 1. Problem statement

1.1.3 added a NuGet "Restore" pre-step (`buildRestoreTask` in `src/build/taskProvider.ts`) that runs **`msbuild <App>.sfproj /t:Restore`** before Package / Publish. The intent was to let a freshly-cloned project resolve `Microsoft.VisualStudio.Azure.Fabric.MSBuild 1.7.9` automatically so the `<Import>`-driven `Package` target becomes defined.

In practice, this pre-step is a **silent no-op** for our `.sfproj` shape, and on a fresh clone the user still has to run one of these manually before the extension's Package / Publish commands work:

```pwsh
# Option A (works) — packages.config-aware tool, with explicit dest folder.
nuget restore MyApp\MyApp.sfproj -PackagesDirectory packages

# Option B (works on MSBuild 17.x with the opt-in flag)
msbuild MyApp\MyApp.sfproj /t:Restore /p:RestorePackagesConfig=true
```

### Why `msbuild /t:Restore` doesn't restore the `.sfproj`

The `.sfproj` we author is a **classic-style csproj** (`<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">`) with a sibling `packages.config` that pins `Microsoft.VisualStudio.Azure.Fabric.MSBuild 1.7.9`. Two facts about MSBuild's `Restore` target make it inappropriate here:

1. **`msbuild /t:Restore` only restores `<PackageReference>`-style projects by default.** Restoration of `packages.config` requires the opt-in `/p:RestorePackagesConfig=true` flag *and* MSBuild 17.x or newer (the implementation lives in `NuGet.Build.Tasks.Pack` shipped with VS 2022 17.x). On MSBuild 16.x or earlier, the flag is silently ignored.
2. **Package destination differs.** `<PackageReference>`-style restore targets the user-global cache (`%USERPROFILE%\.nuget\packages\`). `packages.config` restore targets a *workspace-relative* `packages\` folder (the path our `<Import>` blocks expect: `..\packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\build\…`). MSBuild's `Restore` target chooses the destination based on the project format; even with the opt-in flag, it can install elsewhere when `nuget.config` settings, `<RestorePackagesPath>`, or `RestorePackagesDirectory` are not authored, leading to packages on disk that don't satisfy our `<Import Condition="Exists(...)">`.

Net result: `msbuild /t:Restore` against our `.sfproj` either does nothing (older MSBuild) or installs packages where our imports won't see them (newer MSBuild without the right config). Either way, the next build still fails with `MSB4057: The target "Package" does not exist in the project` — or, with the 1.1.3 `<ValidateMSBuildFiles>` block, the friendlier *"Please restore the 'Microsoft.VisualStudio.Azure.Fabric.MSBuild' Nuget package"* message.

### Why `nuget.exe restore … -PackagesDirectory packages` works

`nuget.exe` is the original CLI for the `packages.config` format. It:

1. Reads `packages.config` next to the `.sfproj`.
2. Honors `-PackagesDirectory` (or `<solution>` `<repositoryPath>` in `nuget.config`) to install into the workspace-relative `packages\` folder.
3. Resolves to `<workspace>\packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\build\{Application.props, Application.targets}` — exactly the path our `<Import>` blocks reference.

This is what Visual Studio invokes implicitly on first solution open (via its bundled NuGet restore engine — same engine, embedded). Our extension must mirror VS's behavior.

### Other 1.1.3 gaps in scope for this fix

- **Restore only fires on Package / Publish.** A user who opens the project for the first time and chooses *Build* rather than *Package* will hit the same error. Restore must fire before *every* MSBuild target invoked through the extension (Build / Rebuild / Clean / Package / Publish).
- **No proactive restore at project load.** The tree-view / parser load path doesn't notice missing-targets. We could surface it earlier with a one-line status-bar prompt or auto-fire restore when the package directory is absent.
- **No public command for users to invoke restore manually** in a way that uses the right tool. The existing `serviceFabric.restore` command (1.1.3) calls the broken `buildRestoreTask` and is functionally a no-op for users hitting this issue.

## 2. Goal

Make `Service Fabric: Package Application`, `Service Fabric: Publish Application…`, `Service Fabric: Build`, `Service Fabric: Rebuild`, `Service Fabric: Clean`, and `Service Fabric: Restore` all *just work* on a fresh clone, exactly as they do in Visual Studio — no manual `nuget restore` step, no shell-out to `nuget.exe` from the user's terminal.

Concrete acceptance:

1. `git clone <repo with .sfproj>` then **F5 / Service Fabric: Publish Application** in VS Code → succeeds without any prior manual step.
2. The same flow works on a machine where VS is **not** installed, as long as the .NET SDK is installed (because `dotnet` ships a copy of NuGet client logic via `dotnet nuget` which we can use as a portable fallback).
3. Restoring is **idempotent** (no-op when packages are already present) and **fast** (sub-second on a populated cache).
4. When restore fails (network down, package not found), the user gets a clear actionable error pointing at what to do next — not `MSB4057`.

## 3. Strategies & decision matrix

| # | Strategy | Pros | Cons | Reachability |
|---|---|---|---|---|
| A | Bundled `nuget.exe` (vendored in extension) | Always works on Windows; no machine state required | Adds ~6 MB to .vsix; bundled binary needs occasional updates for security; cross-platform story is awkward (need separate `nuget` / `mono nuget.exe`) | Excluded — too much weight |
| B | Locate `nuget.exe` on disk (VS install / Build Tools install / PATH) | Uses what's already on the machine; no extra payload | Requires the user to have VS or Build Tools (most do, but not guaranteed) | Primary path |
| C | `msbuild <project> /t:Restore /p:RestorePackagesConfig=true /p:RestorePackagesPath=…` | Reuses the MSBuild we already locate via `vswhere` | Requires MSBuild 17.x+; behavior of the opt-in flag is finicky; package destination path needs to be forced explicitly | Fallback when (B) fails |
| D | `dotnet nuget add source` + `dotnet restore` | Cross-platform; ships with .NET SDK | `dotnet restore` doesn't support `packages.config` without the same MSBuild-17 opt-in path | Not viable for this format |
| E | Eager .nupkg download via HTTP at scaffold time | Scaffold result builds offline at the user's first try | Requires network at scaffold (not at fresh-clone, which is what hurts); doesn't help users who clone an existing repo | Auxiliary — see §5.5 |
| F | Direct .nupkg fetch in extension (HTTP HEAD/GET to `api.nuget.org/v3-flatcontainer/...`) at restore time | No external dependency; works on machines with neither VS nor `nuget.exe`; tight control over destination layout | Re-implements a small slice of NuGet; need to handle proxies / private feeds / TLS | Last-resort fallback when (B) and (C) both fail |

**Decision:** implement (B) → (C) → (F) as a fallback chain inside a new `nugetRestore.ts` module. (E) is added as a *nice-to-have* scaffold-time optimization but is not on the critical path. (A) and (D) are excluded.

## 4. Reference points

- **Where VS finds `nuget.exe`:** `<VS install root>\Common7\IDE\CommonExtensions\Microsoft\NuGet\NuGet.exe`. Located via `vswhere.exe` (already used by `msbuildLocator.ts`).
- **Where VS Build Tools finds `nuget.exe`:** same path under the Build Tools install (`Microsoft Visual Studio\<year>\BuildTools`). Same `vswhere` query finds both.
- **Where users install `nuget.exe` manually:** `%USERPROFILE%\.nuget\nuget.exe`, or `C:\Tools\nuget.exe`, or anywhere on `PATH`. We support all of these.
- **Reference flat-container URL** for direct .nupkg fetch: `https://api.nuget.org/v3-flatcontainer/microsoft.visualstudio.azure.fabric.msbuild/1.7.9/microsoft.visualstudio.azure.fabric.msbuild.1.7.9.nupkg`. The .nupkg is a ZIP; we extract the `build/` subtree only.

## 5. Implementation

### 5.1 New module — `src/build/nugetLocator.ts`

Symmetrical to `msbuildLocator.ts`. Returns the first viable `nuget.exe` location, falling back through a defined priority chain:

```ts
export interface NugetInvocation {
    executable: string;            // "nuget.exe" or absolute path
    description: string;
    kind: 'override' | 'vswhere' | 'path' | 'profile' | 'none';
}

export async function locateNuget(): Promise<NugetInvocation | undefined>;
```

Resolution order:

1. `serviceFabric.nugetPath` setting (new — see §5.4).
2. `vswhere -latest -find Common7\IDE\CommonExtensions\Microsoft\NuGet\NuGet.exe` (Windows only).
3. `nuget` / `nuget.exe` on `PATH` (use `where.exe` on Windows, `which` on POSIX).
4. `%USERPROFILE%\.nuget\nuget.exe`.
5. Return `undefined` (caller falls through to strategy C/F).

All filesystem checks use existing `pathExists` helper for consistency.

### 5.2 New module — `src/build/nugetRestore.ts`

Implements the strategy chain documented in §3.

```ts
export interface RestoreOutcome {
    ok: boolean;
    strategy: 'nuget-exe' | 'msbuild-restorepkgconfig' | 'http-fallback' | 'skipped';
    message?: string;
    packagesDirectory: string;     // <workspace>/packages absolute
}

/**
 * Ensures every package in `<sfprojDir>/packages.config` is present under
 * the workspace-relative `packages/` folder. Idempotent: returns immediately
 * with strategy:'skipped' when every required package directory already
 * exists at the expected version.
 */
export async function ensureNugetRestored(
    sfprojPath: string,
    output?: vscode.OutputChannel,
    progress?: vscode.Progress<{ message?: string }>
): Promise<RestoreOutcome>;
```

Algorithm:

1. **Idempotency check.** Read `packages.config`, then for each `<package id="…" version="…" />`, compute `<workspace>/packages/<id>.<version>/build/`. If every required folder exists, return `{ ok: true, strategy: 'skipped' }` without spawning anything.
2. **Strategy B — `nuget.exe restore`.** If `locateNuget()` returns a path:
   ```text
   nuget.exe restore "<sfprojPath>" -PackagesDirectory "<workspace>\packages" -NonInteractive -Verbosity quiet
   ```
   Spawn via `child_process.spawn`, stream stdout/stderr to `output`. On exit code 0, re-run the idempotency check; if it now passes, return success. Otherwise fall through.
3. **Strategy C — `msbuild /t:Restore /p:RestorePackagesConfig=true /p:RestorePackagesPath=…`.** If `nuget.exe` couldn't be found *or* its run failed:
   ```text
   msbuild.exe "<sfprojPath>" /t:Restore /p:RestorePackagesConfig=true /p:RestorePackagesPath="<workspace>\packages" /nologo /v:minimal
   ```
   Re-run idempotency check after exit. Some MSBuild versions accept the flag silently and do nothing — that's why we re-check rather than trust exit code.
4. **Strategy F — direct .nupkg fetch.** If both B and C failed *and* the only missing package is `Microsoft.VisualStudio.Azure.Fabric.MSBuild` (the only one our scaffolder pins), fetch:
   ```
   https://api.nuget.org/v3-flatcontainer/microsoft.visualstudio.azure.fabric.msbuild/<ver>/microsoft.visualstudio.azure.fabric.msbuild.<ver>.nupkg
   ```
   into a temp file via `https.get`. Open as a zip (use `node:zlib` + a minimal in-process zip reader, or pull `adm-zip` into deps — TBD in §7). Extract the `build/` subtree to `<workspace>/packages/Microsoft.VisualStudio.Azure.Fabric.MSBuild.<ver>/build/`. Idempotency check. Return success or surface the network error.
5. **Failure path.** If all three strategies fail, return `{ ok: false, ... }` with an actionable message: *"Could not restore the Service Fabric MSBuild targets. Install Visual Studio 2022 (any edition with the .NET workload), or run `nuget restore <App>.sfproj -PackagesDirectory packages` manually, or check network connectivity to api.nuget.org."*

### 5.3 Wire `ensureNugetRestored` into the build/deploy flows

Replace the existing `buildRestoreTask` machinery in three places:

| File | Change |
|---|---|
| `src/build/taskProvider.ts` | Remove `'Restore'` from `SfTarget`. Remove `buildRestoreTask`. Restore is no longer modeled as an MSBuild VS Code Task because MSBuild isn't running it — `nuget.exe` is. The new `ensureNugetRestored` runs as a `withProgress` notification, not a task. |
| `src/deploy/deployFlow.ts::deployCommand` | Replace `await vscode.tasks.executeTask(restoreTask)` block with `await ensureNugetRestored(project.sfproj.path, output, progress)`. Bail out on `!ok` with a modal error citing the returned `message`. |
| `src/extension.ts::runMsBuildTarget` | Run `ensureNugetRestored(...)` *before* dispatching to `buildTask(... 'Build' / 'Rebuild' / 'Clean' / 'Package')`. Currently we only Restore before Package — extend to all four. |
| `src/extension.ts` (`serviceFabric.restore` command) | Re-implement: call `ensureNugetRestored(...)` directly, surface success/failure as an information / error message. |
| `package.json` `commands` | Update `serviceFabric.restore` title to *"Service Fabric: Restore NuGet Packages"* (was *"Service Fabric: Restore"*). |
| `package.json` `view/item/context` + `explorer/context` | Add `serviceFabric.restore` entries on `.sfproj` rows (Applications view *and* File Explorer) so users can trigger it manually. Group `1_build@0` (sorts above Build / Rebuild / Clean). |

### 5.4 New configuration setting

```json
"serviceFabric.nugetPath": {
    "type": "string",
    "default": "",
    "description": "Optional override for the NuGet executable used by 'Service Fabric: Restore NuGet Packages'. Leave empty to auto-detect via Visual Studio Installer or PATH."
}
```

Added to `contributes.configuration.properties` in `package.json`. Read from `nugetLocator.ts` step 1.

### 5.5 Auto-restore on first project open (deferred — see §9)

Hook the `.sfproj` parser (`loadApplicationProject` in `src/project/sfprojParser.ts`) so that on the first parse it checks whether `<workspace>/packages/Microsoft.VisualStudio.Azure.Fabric.MSBuild.<ver>/` exists. If not, surface a one-shot status-bar message *"Service Fabric: NuGet packages need to be restored. [Restore]"* with a button that runs `serviceFabric.restore`. **Not auto-fired** — the user clicks. This avoids surprising the user with a network call on workspace open.

This gives us a clean "did you forget to restore?" UX without coupling the parser to network IO.

### 5.6 Scaffold-time eager restore (auxiliary)

In `applyCreateApplication` and the `.sfproj`-emitting path in `applyAddService` (which occasionally runs against a brand-new workspace), call `ensureNugetRestored(sfprojPath)` after writing the project files but before returning. This means:

- **Online users get a ready-to-build project at scaffold time** (the same UX as VS's *New Project* flow).
- **Offline users see the message returned by `ensureNugetRestored`** — they can re-run later.
- **Strictly opt-out via setting `serviceFabric.scaffoldAutoRestore`** (default `true`).

```json
"serviceFabric.scaffoldAutoRestore": {
    "type": "boolean",
    "default": true,
    "description": "When true, automatically run NuGet restore after Create Application / Add Service so the project is immediately buildable. Disable in offline/sandboxed environments."
}
```

### 5.7 Update `<ValidateMSBuildFiles>` message

The 1.1.3 message reads *"Please restore the 'Microsoft.VisualStudio.Azure.Fabric.MSBuild' Nuget package"*. After 1.1.4 ships the friendlier flow, point users at the command directly:

```xml
<Error Condition="…"
       Text="Microsoft.VisualStudio.Azure.Fabric.MSBuild not restored. Run 'Service Fabric: Restore NuGet Packages' from the Command Palette, or 'nuget restore &lt;App&gt;.sfproj -PackagesDirectory packages' from a terminal." />
```

Updated in `src/scaffold/createApplicationTemplates.ts::buildSfprojValidateTargetXml` (or wherever the target is currently authored).

### 5.8 Modernize netcore TFM picker (net10.0 / net9.0 / net8.0)

The Add Service flow's TFM QuickPick in `src/scaffold/addService.ts` (the `isAspNetKind(kind) || runtime === 'netcore'` branch) currently offers:

```ts
[ { label: 'net8.0', description: 'Recommended (LTS)', value: 'net8.0' },
  { label: 'net6.0', description: 'LTS',               value: 'net6.0' } ]
```

This is **stale as of May 2026**:

- `net6.0` reached end-of-support on **November 12, 2024** — advertising it as *LTS* is misleading and lets users scaffold projects that ship without security patches.
- `net10.0` (the current LTS, released Nov 2025) is **absent**. New users on the latest .NET SDK get a default that's a full LTS generation behind their tooling.
- `net9.0` (STS, Nov 2024 → May 12, 2026) is also absent from the picker but is what `addServiceTemplates.ts::resolveTemplate` *defaults* to for ASP.NET kinds when no `targetFramework` is supplied. That asymmetry means programmatic callers and interactive users land on different TFMs.

#### 5.8.1 New picker contents

```ts
const tfmChoices = isAspNetKind(kind) || runtime === 'netcore'
    ? [
        { label: 'net10.0', description: 'Recommended (current LTS, until Nov 2028)', value: 'net10.0' },
        { label: 'net9.0',  description: 'STS — reaches end-of-support May 12, 2026',  value: 'net9.0'  },
        { label: 'net8.0',  description: 'LTS (until Nov 2026)',                       value: 'net8.0'  }
      ]
    : [
        { label: 'net472', description: '.NET Framework 4.7.2 (classic Service Fabric SDK)', value: 'net472' },
        { label: 'net48',  description: '.NET Framework 4.8',                                 value: 'net48'  }
      ];
```

- **`net10.0` first** — it's the recommended default and the QuickPick preselects the first item.
- **`net9.0` retained** — explicit user request; description honestly flags the imminent EOL so users opt-in with eyes open. No additional confirmation modal is added (the description string carries the warning).
- **`net8.0` retained** — still the long LTS for users on older SDKs or who want the most-conservative pin.
- **`net6.0` removed** — out-of-support TFMs do not appear. Users with existing `net6.0` services keep them by hand-editing the csproj; the scaffolder won't propose new ones.
- The netfx branch is **unchanged** (`net472` / `net48`) — see the separate netfx scope note in §13.

#### 5.8.2 Realign the default-TFM helper

In `src/scaffold/addServiceTemplates.ts::resolveTemplate`:

```ts
// Before
const defaultTfm = runtime === 'netfx'
    ? 'net472'
    : isAspNetKind(t.kind) ? 'net9.0' : 'net8.0';

// After
const defaultTfm = runtime === 'netfx'
    ? 'net472'
    : 'net10.0';   // Both ASP.NET and plain/Actor netcore default to the current LTS.
```

The ASP.NET branch is no longer special: the SF Application targets, the `Microsoft.ServiceFabric.AspNetCore.*` 7.x packages, and the `Microsoft.ServiceFabric.Actors` 7.x packages all ship `net10.0` assets. Single default keeps interactive (picker) and programmatic (default) callers in sync.

#### 5.8.3 Documentation

- **`docs/HOWTO.md`** — the *Add Service* walkthrough section gains a one-line note: *"Pick the lowest TFM your services need to interop on — a `net8.0` library can be referenced by `net10.0` services, but not the reverse."* This restates the same compatibility rule used by Add Library Project (§6.5) so users see it consistently.
- **`CHANGELOG.md`** — the 1.1.4 entry calls out the TFM list change explicitly so users notice on upgrade.

## 6. Library project commands (Add and Remove)

### 6.1 Why a library is not a `<ProjectReference>` in the `.sfproj`

The Service Fabric Application targets walk the `.sfproj`'s `<ProjectReference>` graph to discover **services**, identified by `<IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>` in the referenced csproj. Anything else in the graph confuses those targets (they look for a `PackageRoot/ServiceManifest.xml` and either crash or silently skip).

Libraries therefore follow the same convention the actor `.Interfaces` scaffold already uses: they live as **sibling folders** next to the `.sfproj`'s parent and are referenced from each consuming **service csproj**, never from the `.sfproj` itself. MSBuild's standard project-graph build picks them up transparently — each consumer gets its own copy of the library DLL in its `bin/<Cfg>/<TFM>/`, which the SF Application targets then copy into `pkg/<Cfg>/<App>/<Service>Pkg/Code/`.

### 6.2 Add Library Project — user flow

**Invocation context determines the consumer-selection step.** The same `serviceFabric.addLibrary` command behaves slightly differently depending on which surface invoked it:

#### 6.2.a Invoked from `.sfproj` (palette, Applications view, File Explorer on `.sfproj`)

Full multi-consumer flow. Prompts the user for:

1. **Library name** — default suggestion `<App>.Shared` (or `<App>.<NextSuffix>` when `<App>.Shared` already exists). Validation: must be a legal C# identifier-ish path segment (letters, digits, `.`, `_`, `-`), not collide with an existing folder, not collide with an existing `.sfproj`-level `<ProjectReference>` target.
2. **Target framework** — picker showing the same netcore TFMs as Add Service (§5.8.1: `net10.0`, `net9.0`, `net8.0`). The default is the **lowest TFM among existing service csprojs** to guarantee compatibility (a `net8.0` library can be referenced by both `net8.0` and `net10.0` consumers; the reverse isn't true). When no services exist yet, default to `net10.0`.
3. **Consumers** — multi-pick QuickPick listing every C# service csproj currently referenced by the `.sfproj` (one entry per `<ProjectReference>` target). The user can pick zero or more. Default selection: none (the user opts in per-consumer; this avoids surprise edits to user-managed code). A separator labelled *— No consumers —* lets the user explicitly skip wiring; the library is still scaffolded but no consumer csproj is touched.

#### 6.2.b Invoked from `.csproj` (File Explorer right-click on a service csproj)

The right-clicked csproj is **pre-locked as the single consumer** — the multi-pick step is skipped. Instead, the first prompt is a binary mode picker:

1. **Mode** — QuickPick with two items:
   - *Create new library project…* (default)
   - *Reference existing library project…*
2. If **Create new** is chosen: same name + TFM prompts as §6.2.a (TFM default is *this csproj's* TFM, not the workspace minimum, since this csproj is the only consumer); the new library is scaffolded and the right-clicked csproj is the only one patched.
3. If **Reference existing** is chosen: a QuickPick lists every sibling csproj in the workspace that is **not** a service (no `<IsServiceFabricServiceProject>True</…>`) and is **not** already referenced by this csproj. Picking one appends a `<ProjectReference>` row to the right-clicked csproj. No new library is scaffolded.

This matches Visual Studio's *Add → Project Reference…* dialog while keeping the SF-aware *Add → New Library Project…* shortcut a single click away.

### 6.3 What Add Library Project does on disk

1. **Create** `<workspace>/<Name>/<Name>.csproj` with the minimal SDK-style class-library shape:
   ```xml
   <Project Sdk="Microsoft.NET.Sdk">
     <PropertyGroup>
       <TargetFramework>net8.0</TargetFramework>
       <ImplicitUsings>enable</ImplicitUsings>
       <Nullable>enable</Nullable>
     </PropertyGroup>
   </Project>
   ```
   No `<OutputType>Exe</OutputType>`, no `<RuntimeIdentifier>`, no `<SelfContained>`, no `<IsServiceFabricServiceProject>`, no `<ServerGarbageCollection>`, no `PackageRoot/`. A library is a vanilla class library; SF-specific properties would mis-classify it.
2. **Create** `<Name>/Class1.cs` with a one-line stub class declaration (`namespace <Name>; public class Class1 { }`) so the project compiles immediately. Users delete it as they add real code.
3. **For each picked consumer**, append a `<ProjectReference>` row to its csproj, inside an existing `<ItemGroup>` containing other `<ProjectReference>` items (or a fresh group above the closing `</Project>`):
   ```xml
   <ProjectReference Include="..\<Name>\<Name>.csproj" />
   ```
   Idempotent: if the reference already exists, the consumer's csproj is left untouched.
4. **Do NOT** touch `<App>.sfproj`, `ApplicationManifest.xml`, `StartupServices.xml`, `StartupServiceParameters/*.xml`, or `ApplicationParameters/*.xml`. Libraries have no manifest, no service type, and no per-environment parameters.
5. **Optionally run `ensureNugetRestored()`** afterward so any new `<PackageReference>`s the user later adds restore on the next build. (No-op for an empty library, but cheap and consistent with scaffold-time behavior in §5.6.)
6. **Surface a follow-up toast** *"Library `<Name>` created and referenced from N service(s). Open csproj?"* with an *Open* button that does `vscode.window.showTextDocument` on the new csproj.

### 6.4 Surfaces (where each command appears)

#### 6.4.a Add Library Project

| Surface | When | Group |
|---|---|---|
| Command palette | Always (`when: true` in `commandPalette` block) | n/a |
| Applications view (`view/item/context`) | `view == serviceFabric.applications && viewItem == sfproj` | `9_modify@1.5` (between Add Service — `9_modify@1` — and Remove Service — `9_modify@2`) |
| File Explorer (`explorer/context`) on `.sfproj` | `resourceExtname == .sfproj` | `9_modify@1.5` |
| File Explorer (`explorer/context`) on `.csproj` | `resourceExtname == .csproj` | `9_modify@1.5` |

When invoked on a `.csproj`, the command runs the §6.2.b flow (mode picker + single-consumer wiring). When invoked on a `.sfproj` or from the palette, it runs the §6.2.a flow.

#### 6.4.b Remove Library Project

| Surface | When | Group |
|---|---|---|
| Command palette | Always | n/a |
| Applications view (`view/item/context`) | `view == serviceFabric.applications && viewItem == sfproj` | `9_modify@1.6` (immediately below Add Library Project) |
| File Explorer (`explorer/context`) on `.sfproj` | `resourceExtname == .sfproj` | `9_modify@1.6` |
| File Explorer (`explorer/context`) on `.csproj` | `resourceExtname == .csproj` | `9_modify@1.6` |

The `.csproj` invocation unwires the picked library from *that csproj only* (no folder deletion); the `.sfproj` / palette invocation runs the full removal flow including optional folder deletion. See §6.9.

### 6.5 Detection logic

- **Existing-folder collision** (Add only): the prompt re-validates after each keystroke; if `<workspace>/<Name>/` already exists *and* contains a `.csproj`, the prompt shows *"A project already exists at this path."* and disables the *Enter* binding. If the folder exists but is empty / contains only stray files, the prompt warns *"Folder exists but is empty; the library will be created inside it."* and allows confirmation.
- **Consumer enumeration** (Add from `.sfproj`): the `.sfproj`'s `<ProjectReference>` items are filtered to those whose target csproj parses cleanly and contains `<IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>`. Non-service references (e.g. an existing library you've already added) are filtered out so the picker only shows services.
- **Existing-library enumeration** (Add from `.csproj`, *Reference existing* mode): every csproj under the workspace folder is parsed; the picker shows those that (a) do **not** have `<IsServiceFabricServiceProject>True</…>`, (b) are **not** the right-clicked csproj itself, and (c) are **not** already referenced by it. Cached per-invocation; large workspaces are scanned via `vscode.workspace.findFiles('**/*.csproj')` with the standard ignore patterns.
- **Library enumeration** (Remove): the right-clicked csproj's existing `<ProjectReference>` items are listed, then filtered to those whose target csproj is **not** a service (same `<IsServiceFabricServiceProject>` check inverted) — service-to-service references are not removable through this command. `.sfproj`-context invocation enumerates every consumer csproj's `<ProjectReference>` and unions the set of unique library targets.
- **TFM compatibility check** (Add): when the picked TFM is *higher* than any selected consumer's TFM, surface a confirmation modal *"`<Library>` targets net10.0 but `<Service>` targets net8.0; build will fail with NU1201. Continue anyway?"* with *Cancel* / *Continue* buttons. Default is *Cancel*.

### 6.6 Implementation modules (new + edited)

| File | Change |
|---|---|
| `src/scaffold/addLibraryTemplates.ts` | **New.** Pure builders: `buildLibraryCsproj({ name, targetFramework })`, `buildLibraryClassStub(name)`, `patchCsprojAddProjectReference(csprojXml, relativePath)` (with idempotency — no duplicate insertion), `patchCsprojRemoveProjectReference(csprojXml, relativePath)` (idempotent removal — no-op when reference is absent; cleans up empty `<ItemGroup>` left behind). |
| `src/scaffold/addLibraryApply.ts` | **New.** `applyAddLibrary({ project, name, targetFramework, consumers })` orchestrates the disk writes per §6.3, returning `AddLibraryResult { libraryDirectory, libraryCsprojPath, patchedConsumers: string[] }`. Mirrors the all-or-nothing semantics of `applyAddService` with rollback on partial failure. |
| `src/scaffold/removeLibraryApply.ts` | **New.** `applyRemoveLibrary({ project, libraryCsprojPath, consumers, deleteFolder })` orchestrates the disk writes per §6.9.2, returning `RemoveLibraryResult { unwiredConsumers: string[], folderDeleted: boolean }`. Rollback semantics: if folder deletion fails after consumers were already unwired, the consumer csprojs stay unwired (consistent with VS's *Remove*) and the failure surfaces in the toast. |
| `src/commands/addLibraryCommand.ts` | **New.** UI flow per §6.2 + §6.5. Branches on the invocation context to run §6.2.a (`.sfproj` / palette) or §6.2.b (`.csproj`). |
| `src/commands/removeLibraryCommand.ts` | **New.** UI flow per §6.9. Branches on invocation context: `.sfproj` / palette runs the multi-consumer + folder-deletion flow; `.csproj` runs the single-consumer unwire flow. |
| `src/extension.ts` | Register `serviceFabric.addLibrary` *and* `serviceFabric.removeLibrary` commands. |
| `src/project/sfprojParser.ts` | No changes required — the parser already exposes `<ProjectReference>` items, and libraries are silent here (they are not in the `.sfproj` graph). |
| `package.json` `commands` | Add `serviceFabric.addLibrary` (*"Service Fabric: Add Library Project…"*) and `serviceFabric.removeLibrary` (*"Service Fabric: Remove Library Project…"*), both under category *"Service Fabric"*. |
| `package.json` `view/item/context` + `explorer/context` | Add both commands per §6.4 (entries for `.sfproj` and `.csproj` in `explorer/context`). |

### 6.7 Test plan additions

Unit (`test/unit/addLibrary.test.ts`):

- `buildLibraryCsproj(net10.0)` emits the minimal SDK-style shape (no `<OutputType>`, no `<IsServiceFabricServiceProject>`).
- `buildLibraryCsproj(net9.0)` and `buildLibraryCsproj(net8.0)` only differ in `<TargetFramework>`.
- `patchCsprojAddProjectReference` appends inside an existing `<ItemGroup>` containing other `<ProjectReference>` items.
- `patchCsprojAddProjectReference` creates a fresh `<ItemGroup>` when none exists.
- `patchCsprojAddProjectReference` is idempotent — second call with the same relative path is a no-op.
- `patchCsprojRemoveProjectReference` removes a reference and leaves the surrounding XML byte-clean (no orphan whitespace, no broken indent).
- `patchCsprojRemoveProjectReference` is idempotent — calling it for an absent reference is a no-op (no exception, returns *unchanged*).
- `patchCsprojRemoveProjectReference` removes the surrounding `<ItemGroup>` when it becomes empty after the removal.
- `applyAddLibrary` writes csproj + `Class1.cs` and patches each picked consumer.
- `applyAddLibrary` does **not** touch `<App>.sfproj`, `ApplicationManifest.xml`, `StartupServices.xml`, or any parameter file (assert via SHA256 of those files before/after).
- `applyAddLibrary` with empty `consumers` array still scaffolds the library and leaves all csprojs untouched.
- `applyAddLibrary` rejects a name that collides with an existing service folder.
- `applyAddLibrary` invoked from `.csproj` context (single consumer pre-locked) patches only that csproj.
- `applyAddLibrary` *Reference existing* mode adds a `<ProjectReference>` to the right-clicked csproj without creating any new files.

Unit (`test/unit/removeLibrary.test.ts`):

- `applyRemoveLibrary` unwires the picked consumers' `<ProjectReference>` rows and leaves all other csprojs untouched.
- `applyRemoveLibrary` does **not** touch `<App>.sfproj`, `ApplicationManifest.xml`, `StartupServices.xml`, or any parameter file (SHA256 assert).
- `applyRemoveLibrary` with `deleteFolder: true` removes the library folder *only after* every consumer csproj has been successfully unwired (rollback safety: a partial failure on consumer N leaves earlier consumers unwired but folder intact).
- `applyRemoveLibrary` with `deleteFolder: false` leaves the library folder on disk for users who want to keep the source but stop building it.
- `applyRemoveLibrary` from `.csproj` context (single consumer) never deletes the folder regardless of the flag (the flag is forced to `false`).
- `applyRemoveLibrary` refuses to operate on a service csproj (one with `<IsServiceFabricServiceProject>True</…>`) and returns a clear error.

Integration (`test/unit/addLibrary.test.ts` + `test/unit/removeLibrary.test.ts` end-of-file):

- Round-trip: scaffold a library + reference it from one service + Package the application; verify the library DLL ends up under that service's `bin/` (mocked at the MSBuild boundary).
- Round-trip: scaffold a library, reference from two services, then **Remove Library Project** with `deleteFolder: true` — both consumer csprojs unwired, library folder deleted, `.sfproj` / manifest files untouched.

Manual / E2E (added to §9.3 below):

- Right-click `.sfproj` in Applications view → **Add Library Project…** → fill in name, TFM, pick two consumers → confirm both consumer csprojs gain a `<ProjectReference>`, the library folder exists with the canonical csproj, and `.sfproj` / `ApplicationManifest.xml` / `StartupServices.xml` are byte-identical before and after.

### 6.8 Documentation

- **`docs/HOWTO.md`** — add a new section **§11.4 Add a library project** (between the existing Add Service and Remove Service sections) describing the user flow on both `.sfproj` and `.csproj` surfaces, the *Reference existing* mode, the per-consumer wiring, the *libraries are not in the `.sfproj`* invariant (§6.1), the TFM compatibility rule, and the *libraries don't appear in the Applications tree* note (they're sibling C# projects, not SF artifacts). Add a sibling section **§11.5 Remove a library project** documenting both the `.sfproj`-context (multi-consumer + optional folder deletion) and `.csproj`-context (single-consumer unwire) flows, plus the *folder is preserved by default unless you tick "Delete folder too"* note.
- **`README.md`** — add **Add Library Project…** *and* **Remove Library Project…** to the bullet list of commands under *Features*.
- **Walkthroughs** — update `media/walkthrough/build-deploy.md` to mention sharing code via libraries as the canonical pattern, with a callout to both Add and Remove commands.

### 6.9 Remove Library Project — user flow + disk operations

#### 6.9.1 Invocation contexts

- **From `.sfproj` (palette, Applications view, File Explorer on `.sfproj`).** Multi-consumer flow:
  1. **Pick library to remove** — QuickPick listing every sibling library currently `<ProjectReference>`d by *any* of the `.sfproj`'s consumer csprojs. Each entry shows the library name and the count of consumers that reference it (e.g. *MyApp.Shared (referenced by 2 services)*). Filter rule: target csproj must not have `<IsServiceFabricServiceProject>True</…>` (services are not removable here).
  2. **Pick consumers to unwire** — multi-pick of the consumers that currently reference the picked library. Default selection: **all** of them (the typical case is full removal). Deselecting some leaves them still referencing the library; selecting all unwires the library application-wide.
  3. **Folder deletion modal** — only when *all* consumers have been unwired (i.e. the library will become unreferenced after the operation). Modal asks: *"`<Library>` is no longer referenced by any service. Delete the folder `<workspace>/<Library>/` too?"* with three buttons: *Delete folder*, *Keep folder*, *Cancel*. Default is *Keep folder* (preserves user code).
- **From `.csproj` (File Explorer on `.csproj`).** Single-consumer unwire:
  1. **Pick library reference to remove** — QuickPick listing this csproj's `<ProjectReference>` rows whose target is a non-service csproj.
  2. **No folder deletion** — other csprojs may still reference the library; the command never deletes folders in `.csproj`-context invocations.

#### 6.9.2 What Remove Library Project does on disk

1. **For each picked consumer**, remove the matching `<ProjectReference>` row from its csproj using `patchCsprojRemoveProjectReference`. Idempotent: an already-absent reference is a no-op for that consumer.
2. **Clean up empty `<ItemGroup>` containers** — if removing the reference leaves an empty group, the group is removed too (matches VS's *Remove Reference* behavior; keeps the csproj tidy).
3. **If `deleteFolder: true`** *and* the library is now fully unreferenced workspace-wide, recursively delete `<workspace>/<Library>/`. Failure here surfaces the OS error in the toast but does **not** revert the consumer-csproj edits (they are committed).
4. **Do NOT** touch `<App>.sfproj`, `ApplicationManifest.xml`, `StartupServices.xml`, `StartupServiceParameters/*.xml`, or `ApplicationParameters/*.xml`. Same invariant as Add (§6.3 step 4).
5. **Surface a follow-up toast** — *"Library `<Library>` unwired from N service(s)"* (folder kept) or *"Library `<Library>` unwired from N service(s) and folder deleted"* (folder deleted) or *"Library `<Library>` unwired from this service"* (`.csproj` context).

#### 6.9.3 Safety properties

- **Idempotent.** Re-invoking the command after a successful run is a no-op for the already-unwired consumers; if the folder was already deleted, the picker simply won't list the library anymore.
- **No service-to-service breakage.** The library picker filters out service csprojs, so users cannot accidentally remove a service `<ProjectReference>` (which would silently drop the service from packaging — use *Service Fabric: Remove Service…* for that).
- **No accidental folder loss.** Folder deletion is opt-in per invocation; the default is *Keep folder*, and the deletion only fires when no consumers reference the library after the unwire. A user who clicks *Delete folder* sees a second OS-confirmation dialog with the absolute path before any disk operation.

## 7. File-by-file change list

| File | Change |
|---|---|
| `src/build/nugetLocator.ts` | **New.** `locateNuget()` per §5.1. |
| `src/build/nugetRestore.ts` | **New.** `ensureNugetRestored()` per §5.2 — implements idempotency check, strategy B / C / F chain. |
| `src/build/taskProvider.ts` | Drop `'Restore'` from `SfTarget` union. Remove `buildRestoreTask`. Remove the `'Restore'` entry from `provideTasks`. |
| `src/deploy/deployFlow.ts::deployCommand` | Replace task-based restore with `await ensureNugetRestored(...)`. Bail with modal error on failure. |
| `src/extension.ts::runMsBuildTarget` | Call `ensureNugetRestored(...)` before *every* MSBuild target dispatch (not just Package). Plumb the existing OutputChannel so users see restore progress in the same panel. |
| `src/extension.ts` (`serviceFabric.restore` command handler) | Re-implement to call `ensureNugetRestored(...)` with a `vscode.window.withProgress` wrapper and a final info/error toast. |
| `src/extension.ts` (`serviceFabric.addLibrary` command handler) | **New.** Register the command per §6.6. |
| `src/scaffold/addServiceApply.ts` + `src/scaffold/createApplicationApply.ts` | After all on-disk writes, conditionally call `ensureNugetRestored(...)` honoring the new `serviceFabric.scaffoldAutoRestore` setting. |
| `src/scaffold/addLibraryTemplates.ts` | **New.** Per §6.6 — builders + idempotent `<ProjectReference>` add/remove patchers. |
| `src/scaffold/addLibraryApply.ts` | **New.** Per §6.6 — Add orchestrator with rollback semantics. |
| `src/scaffold/removeLibraryApply.ts` | **New.** Per §6.6 + §6.9.2 — Remove orchestrator (per-consumer unwire + optional folder deletion). |
| `src/commands/addLibraryCommand.ts` | **New.** UI flow per §6.2 + §6.5. |
| `src/commands/removeLibraryCommand.ts` | **New.** UI flow per §6.9.1 + §6.9.3. |
| `src/scaffold/addService.ts` | Per §5.8.1 — replace netcore TFM choices with `net10.0` / `net9.0` / `net8.0`. Drop `net6.0`. |
| `src/scaffold/addServiceTemplates.ts` | Per §5.8.2 — unify the netcore `defaultTfm` to `net10.0` for both ASP.NET and plain/Actor branches. |
| `src/scaffold/createApplicationTemplates.ts` | Update the `<ValidateMSBuildFiles>` `<Error Text=…>` per §5.7. |
| `src/project/sfprojParser.ts` (deferred — §5.5) | Optional one-shot status-bar nudge when the targets package directory is missing. |
| `package.json` `contributes.configuration.properties` | Add `serviceFabric.nugetPath`, `serviceFabric.scaffoldAutoRestore`. |
| `package.json` `commands` | Rename `serviceFabric.restore` title. Add `serviceFabric.addLibrary` and `serviceFabric.removeLibrary`. |
| `package.json` `menus.view/item/context` + `menus.explorer/context` | Add `serviceFabric.restore` (§5.3) on `.sfproj` rows in both surfaces; add `serviceFabric.addLibrary` and `serviceFabric.removeLibrary` (§6.4) on `.sfproj` rows in both surfaces *and* on `.csproj` rows in `explorer/context`. |
| `package.json` version | Bump `1.1.3 → 1.1.4`. |
| `CHANGELOG.md` | New `## 1.1.4` entry covering both Restore fix *and* Add Library Project. |
| `docs/HOWTO.md` §11 + §12 | Document the new restore flow, `serviceFabric.nugetPath`, `serviceFabric.scaffoldAutoRestore`. **Add new §11.4 Add a library project** per §6.8. |
| `README.md` | Add the new command to the *Features* bullet list. |
| `media/walkthrough/build-deploy.md` | Mention the library command as the canonical code-sharing pattern. |
| `artifacts/` (packaging step) | Run `npm run package` to produce `service-fabric-project-tools-vscode-1.1.4.vsix` *alongside* any pre-existing .vsix files. **Do NOT delete or overwrite stale .vsix files in `artifacts/`** — they are preserved as historical builds. The new .vsix sits beside them in the same folder. If `vsce` refuses because the target filename already exists (it shouldn't, since the version is unique per release), bump the patch version rather than removing the older artifact. |

## 8. Open implementation question — zip extraction in strategy F

Strategy F (direct .nupkg fetch) needs a ZIP reader. Two viable paths:

1. **Add `adm-zip` to `dependencies`** — small (~30 KB), well-tested, sync API. Ships in the .vsix payload.
2. **In-process minimal ZIP reader** using `node:zlib` (`inflateRawSync`) over the .nupkg's central directory. ~80 lines of code, zero deps. The ZIP format is stable and we only need to extract one subtree.

**Decision:** option 2 if Phase F is implemented at all. Adding a dep for a fallback path that fires for <1% of users is unnecessary weight. Implementation lives in `nugetRestore.ts::extractNupkgBuildSubtree`.

If Phase F implementation cost is too high, defer it to a 1.1.5 follow-up and ship 1.1.4 with strategies B+C only — that already covers 100% of users with VS or Build Tools installed (which is everyone running Service Fabric workloads anyway, since they need the SF SDK).

## 9. Test plan

### 9.1 Unit-level

- **`locateNuget()`** — parameterized fixture that mocks the filesystem + child-process `where.exe` to confirm each resolution path returns the expected executable (override → vswhere → PATH → profile → undefined).
- **`ensureNugetRestored()` idempotency** — given a fixture where `<workspace>/packages/Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9/build/` already exists, asserts no child process is spawned and `strategy === 'skipped'`.
- **`ensureNugetRestored()` strategy B success** — mocks `locateNuget` to return a fake path, mocks `child_process.spawn` to succeed and create the expected directory; asserts `strategy === 'nuget-exe'`.
- **`ensureNugetRestored()` strategy B fails → strategy C runs** — first spawn returns nonzero; second (msbuild) succeeds and creates the directory; asserts `strategy === 'msbuild-restorepkgconfig'`.
- **`ensureNugetRestored()` all strategies fail** — `ok: false` with an actionable message; no exception leaks.
- **`ensureNugetRestored()` strategy F (extract)** — local fixture .nupkg in `test/fixtures/`; asserts `build/` subtree extracted to the right location.
- **`buildSfprojValidateTargetXml()`** — emitted `<Error Text>` mentions the new command name.
- **`runMsBuildTarget()` calls `ensureNugetRestored` before each target** — asserts via spy on the mocked module.
- **Add Library Project unit tests** — see §6.7 (csproj shape, idempotent reference patching, no edits to `.sfproj` / ApplicationManifest / StartupServices, name-collision rejection, empty-consumers path, `.csproj`-context single-consumer flow, *Reference existing* mode).
- **Remove Library Project unit tests** — see §6.7 (idempotent reference removal, empty `<ItemGroup>` cleanup, no edits to manifests, optional folder deletion only when fully unreferenced, `.csproj`-context never deletes folder, refusal on service csproj).
- **Netcore TFM picker contents** — assert the picker offered for `isAspNetKind(kind) || runtime === 'netcore'` returns exactly `['net10.0', 'net9.0', 'net8.0']` in that order, with `net10.0` carrying the *Recommended (current LTS…)* description. Snapshot-style test in `test/unit/addService.test.ts`.
- **Default TFM** — `resolveTemplate({ runtime: 'netcore', kind: 'stateless', targetFramework: undefined })` returns `'net10.0'`. Repeat for `kind: 'aspnet'` (also `'net10.0'` post-§5.8.2) and `kind: 'actor'` (`'net10.0'`). Update existing tests that asserted the old `'net8.0'` / `'net9.0'` defaults.
- **`net6.0` is no longer offered** — negative assertion that the picker list does not contain a `value === 'net6.0'` entry.

### 9.2 Integration-level

- **deploy flow** — replace the existing 1.1.3 task-based restore step expectation; assert `ensureNugetRestored` is awaited before `vscode.tasks.executeTask(buildTask)`.
- **scaffold + restore round-trip** — `applyCreateApplication` writes the project, `ensureNugetRestored` is called (mocked to skip the actual install), the returned outcome is propagated.
- **package.json menus** — assert `serviceFabric.restore`, `serviceFabric.addLibrary`, *and* `serviceFabric.removeLibrary` appear in `view/item/context` (Applications view) *and* `explorer/context`. Verify the library commands also appear on `.csproj` rows in `explorer/context`.
- **Add Library Project end-to-end** — scaffold a library, wire it as a `<ProjectReference>` from one service, then run **Service Fabric: Package Application**; assert (mocked at the MSBuild boundary) that the library DLL is in the consumer's `bin/`.
- **Remove Library Project end-to-end** — scaffold + reference + remove with `deleteFolder: true`; assert all consumer csprojs unwired, folder deleted, `.sfproj` / `ApplicationManifest.xml` / `StartupServices.xml` byte-identical before and after the round-trip.

### 9.3 End-to-end (manual)

1. On a machine with VS 2022 installed: clone a fresh repo with a `.sfproj` (1.1.4-scaffolded). Run **Service Fabric: Package Application**. Expect: progress notification *"Restoring NuGet packages…"* (sub-second on populated cache), then Package succeeds.
2. Same machine: delete `<workspace>/packages/`. Run **Service Fabric: Restore NuGet Packages** from the command palette. Expect: progress, success toast, packages folder repopulated.
3. Same machine: delete `<workspace>/packages/`. Right-click `.sfproj` in **File Explorer** → **Service Fabric: Restore NuGet Packages**. Expect: same as #2.
4. On a VM with **only the .NET SDK** (no VS, no Build Tools): clone the repo. Run **Service Fabric: Package Application**. Expect: strategy B fails (no `nuget.exe`), strategy C fails or no-ops (no `msbuild.exe` from VS — only `dotnet msbuild`), strategy F kicks in, downloads the .nupkg, extracts. Package succeeds.
5. With network disabled: delete `<workspace>/packages/`. Run **Service Fabric: Restore NuGet Packages**. Expect: clear error message pointing at the manual `nuget restore` workaround. No `MSB4057`.
6. Verify `serviceFabric.scaffoldAutoRestore: false` setting bypasses the scaffold-time auto-restore.
7. Right-click `.sfproj` in Applications view → **Service Fabric: Add Library Project…** → enter `MyApp.Shared`, accept `net8.0`, multi-pick two service csprojs. Expect: `<workspace>/MyApp.Shared/MyApp.Shared.csproj` created; both picked consumer csprojs gain a `<ProjectReference Include="..\MyApp.Shared\MyApp.Shared.csproj" />`; `.sfproj`, `ApplicationManifest.xml`, `StartupServices.xml`, and all parameter files unchanged. Then run **Service Fabric: Package Application** and confirm the library DLL appears under each consumer's `pkg/.../<Service>Pkg/Code/`.
8. Repeat #7 from File Explorer right-click on the same `.sfproj`. Expect identical result.
9. Repeat #7 with a TFM mismatch (library `net9.0`, consumer `net8.0`). Expect the confirmation modal from §6.5; clicking *Cancel* aborts cleanly with no disk writes.
10. Run **Service Fabric: Add Service…** for any netcore kind. Expect the TFM picker to show **net10.0 / net9.0 / net8.0** in that order; `net10.0` highlighted as *Recommended*; `net6.0` not offered. Pick `net9.0` and verify the resulting csproj has `<TargetFramework>net9.0</TargetFramework>`.
11. Right-click a service `.csproj` in File Explorer → **Add Library Project…** → *Create new library project…* → enter `MyApp.Util`, accept `net10.0`. Expect: `<workspace>/MyApp.Util/MyApp.Util.csproj` created; the right-clicked csproj gains a `<ProjectReference>` row; no other csprojs touched.
12. Right-click the same service `.csproj` again → **Add Library Project…** → *Reference existing library project…* → pick `MyApp.Shared` (created in #7). Expect: only the right-clicked csproj is patched; no folder created; `MyApp.Shared` already-referenced state is preserved on its other consumers.
13. Right-click `.sfproj` in Applications view → **Remove Library Project…** → pick `MyApp.Shared` → accept *all* consumers → click *Delete folder* on the modal. Expect: both consumer csprojs unwired, `<workspace>/MyApp.Shared/` recursively deleted, manifests untouched.
14. Repeat #13 but click *Keep folder*. Expect: consumers unwired, folder preserved on disk for the user to clean up later.
15. Right-click a service `.csproj` in File Explorer → **Remove Library Project…** → pick a non-service `<ProjectReference>` target. Expect: only that csproj's reference is removed; no folder deletion modal appears; other consumers retain their reference.

## 10. Acceptance criteria

- [ ] On a fresh clone with VS or Build Tools installed, **F5 / Service Fabric: Publish Application** succeeds without any manual `nuget restore` step.
- [ ] On a machine without VS or Build Tools but with .NET SDK, the same flow succeeds via strategy F.
- [ ] **Service Fabric: Restore NuGet Packages** is reachable from (a) the command palette, (b) right-click on `.sfproj` in the **Applications** view, (c) right-click on `.sfproj` in the **File Explorer**.
- [ ] Restore is idempotent — re-invoking when packages are present is a no-op (logged at debug verbosity, not surfaced as a notification).
- [ ] Restore failures surface a *clear* error message with two suggested manual workarounds (install VS Build Tools, or run `nuget restore … -PackagesDirectory packages`).
- [ ] All previous 1.1.3 tests pass.
- [ ] Estimated final test count: **236 → ~272** (~12 for restore work, ~10 for Add Library Project, ~10 for Remove Library Project + `.csproj`-context flows, ~4 for TFM picker).
- [ ] No regression for existing builds — the existing `buildTask`-based Build/Rebuild/Clean/Package surfaces continue to work; restore is purely additive.
- [ ] **Add Library Project** is reachable from (a) the command palette, (b) right-click on `.sfproj` in the **Applications** view, (c) right-click on `.sfproj` in the **File Explorer**, (d) right-click on `.csproj` in the **File Explorer**.
- [ ] **Remove Library Project** is reachable from the same four surfaces.
- [ ] **Add / Remove Library Project** never modify `.sfproj`, `ApplicationManifest.xml`, `StartupServices.xml`, `StartupServiceParameters/*.xml`, or `ApplicationParameters/*.xml`. Verified by per-test SHA256 snapshots.
- [ ] **Remove Library Project folder deletion is opt-in** — folder is preserved by default; deletion fires only when the library becomes fully unreferenced *and* the user explicitly clicks *Delete folder*; `.csproj`-context invocations never delete folders.
- [ ] **Remove Library Project refuses service csprojs** — the picker filters out `<IsServiceFabricServiceProject>True</…>` targets, and `applyRemoveLibrary` rejects any service-csproj target with a clear error.
- [ ] **Netcore TFM picker** offers exactly `net10.0`, `net9.0`, `net8.0` in that order; `net10.0` is the preselected default; `net6.0` is no longer offered. The default-TFM helper returns `net10.0` for every netcore kind (no ASP.NET vs plain/Actor asymmetry). Existing tests that pinned `net8.0` / `net9.0` defaults are updated.
- [ ] **`artifacts/` preserves historical .vsix files.** The 1.1.4 packaging step adds `service-fabric-project-tools-vscode-1.1.4.vsix` alongside any pre-existing .vsix (including the 1.1.3 build) without deleting them. Verify by listing `artifacts/` after `npm run package` and confirming all prior .vsix files are still present.

## 11. Tracking

| Phase | Files touched | Tests added | Tests adjusted |
|---|---|---|---|
| A — `nugetLocator.ts` + `nugetRestore.ts` | 2 new files | ~6 | 0 |
| B — Wire restore into deploy + extension dispatch | `deployFlow.ts`, `extension.ts`, `taskProvider.ts` | ~3 | ~2 (replace 1.1.3 task-based assertions) |
| C — Settings + menus | `package.json` | 0 | 0 |
| D — Scaffold-time auto-restore | `addServiceApply.ts`, `createApplicationApply.ts` | ~2 | ~1 |
| E — `<ValidateMSBuildFiles>` message refresh | `createApplicationTemplates.ts` | ~1 | ~1 |
| F — Modernize netcore TFM picker (net10.0 / net9.0 / net8.0) | `addService.ts`, `addServiceTemplates.ts` | ~4 | ~3 (rebase tests pinned to old `net8.0` / `net9.0` defaults) |
| G1 — Add Library Project (templates + apply + command + UI; `.sfproj` *and* `.csproj` surfaces) | `addLibraryTemplates.ts`, `addLibraryApply.ts`, `commands/addLibraryCommand.ts`, `extension.ts`, `package.json` | ~12 | 0 |
| G2 — Remove Library Project (apply + command + UI; `.sfproj` *and* `.csproj` surfaces) | `removeLibraryApply.ts`, `commands/removeLibraryCommand.ts`, `extension.ts`, `package.json`, `addLibraryTemplates.ts` (remove patcher) | ~10 | 0 |
| H — Docs + version bump | `HOWTO.md` (§11.4 + §11.5), `README.md`, `media/walkthrough/build-deploy.md`, `CHANGELOG.md`, `package.json` | 0 | 0 |

## 12. Out of scope

- **Bundling `nuget.exe` in the .vsix.** Adds payload weight without meaningful coverage gain — strategy F (direct .nupkg fetch) covers the same machines for the only package we actually need.
- **Authenticated NuGet feeds.** Strategy F talks only to `api.nuget.org` (anonymous). Users on private feeds must rely on strategies B / C, which honor the user's `nuget.config` chain naturally. We document the limitation but don't add credential-provider integration.
- **Restoring transitive `<PackageReference>` dependencies of companion C# csprojs.** Modern `dotnet build` / `msbuild /t:Build` on `<PackageReference>` projects restores automatically (`<RestoreOnBuild>true</…>` is on by default). No manual step required for those projects. This plan covers only the `.sfproj` restore, which is the missing piece.
- **Migrating the `.sfproj` to `<PackageReference>`.** The Service Fabric MSBuild targets package isn't published in a way that supports `<PackageReference>` consumption (the `build/` subtree is what we need, and `<PackageReference>` only auto-imports `build/<PackageId>.props` / `.targets` if the package author declares them as such — `Microsoft.VisualStudio.Azure.Fabric.MSBuild` does not). VS itself uses `packages.config` for this. Out of scope.
- **NetFramework service kinds (1.1.0 deferred work).** Tracked separately for 1.2.0; no overlap with this fix.
- **Add Library Project: `<PackageReference>` wiring.** The new command scaffolds a class library and adds `<ProjectReference>` rows in selected consumers; it does *not* prompt for NuGet `<PackageReference>` items to add to the library. Users edit the library's csproj manually for that. A future *Add Package Reference…* command could wrap `dotnet add package` per-csproj but is out of scope here.
- **`net6.0` retention.** The picker drops `net6.0` because it's been out of support since Nov 2024. Users with existing `net6.0` services keep them — the scaffolder doesn't migrate or rewrite already-authored csprojs. If a future user genuinely needs to scaffold against an out-of-support runtime they can edit `<TargetFramework>` after creation.
- **Older .NET Framework TFMs (`net46`, `net462`, `net471`).** The netfx picker stays at `net472` / `net48` to mirror Visual Studio's *Service Fabric Stateless / Stateful / Actor* templates. Older TFMs are not offered. Tracked under the broader 1.2.0 netfx polish.
- **TFM-mismatch warnings inside the Add Service flow.** Unlike Add Library Project (§6.5), the Add Service flow does not check the picked TFM against existing service TFMs in the same `.sfproj`. Mixed-TFM applications are valid (each service runs its own process), so no warning is needed. Add Library Project is special because the *library* is statically referenced by *consumer csprojs*, where the C# / NuGet TFM-compatibility rules apply.
