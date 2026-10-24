# Service Fabric Tools for VS Code — How-to Guide

This guide walks through every feature of the **Service Fabric Tools** extension: project recognition, manifest authoring, building & packaging, local-cluster lifecycle, deploying, debugging a running service, and inspecting cluster diagnostic events. Open this file at any time with **Service Fabric: Open Help Guide** from the command palette.

---

## Table of contents

1. [Install & prerequisites](#1-install--prerequisites)
2. [Open a Service Fabric project](#2-open-a-service-fabric-project)
3. [Tour: the Service Fabric activity-bar view](#3-tour-the-service-fabric-activity-bar-view)
4. [Authoring application & service manifests](#4-authoring-application--service-manifests)
5. [Building, rebuilding, cleaning, packaging](#5-building-rebuilding-cleaning-packaging)
6. [Local development cluster lifecycle](#6-local-development-cluster-lifecycle)
7. [Connecting to clusters (local & remote)](#7-connecting-to-clusters-local--remote)
8. [Deploying & removing applications](#8-deploying--removing-applications)
9. [Debugging a deployed service](#9-debugging-a-deployed-service)
10. [Diagnostic events](#10-diagnostic-events)
11. [Scaffolding new applications & services](#11-scaffolding-new-applications--services)
12. [Settings reference](#12-settings-reference)
13. [Commands reference](#13-commands-reference)
14. [Troubleshooting](#14-troubleshooting)
15. [Telemetry & privacy](#15-telemetry--privacy)
16. [FAQ](#16-faq)

---

## 1. Install & prerequisites

### 1.1 Requirements

| Capability | Requires |
|---|---|
| Authoring (tree, manifest validation, F12, code actions) | VS Code 1.90+, the `redhat.vscode-xml` extension (auto-installed as a dependency). Cross-platform. |
| Build / Package | Windows. Visual Studio 2022 **or** Build Tools for VS 2022 with the *Azure development* workload + *Service Fabric Tools* component. |
| Deploy / Remove | Windows. Service Fabric SDK (the `ServiceFabricSDK` PowerShell module is installed by the SDK setup). |
| Local dev cluster | Windows. Service Fabric SDK (provides `FabricHostSvc` and the `Microsoft.ServiceFabric.ClusterSetup` PS modules). |
| Debug attach | `ms-dotnettools.csharp` (or another CoreCLR debug adapter) for `.NET`. Windows + classic CLR debugger for `.NET Framework` services. |

### 1.2 Install

- **From the marketplace**: search for *"Service Fabric Tools"* and install.
- **From a VSIX**: open the command palette and run **Extensions: Install from VSIX…**, then pick the `vscode-service-fabric-*.vsix` file.

When the extension activates it automatically pulls in `redhat.vscode-xml` for schema-aware XML editing.

---

## 2. Open a Service Fabric project

The extension activates when:

- You open a folder that contains a `*.sfproj` file (anywhere in the workspace).
- You run any **Service Fabric: …** command.

After activation:

1. The **Service Fabric** view appears in the activity bar (`$(server-environment)` icon).
2. The **Applications** view lists every `.sfproj` discovered in the workspace.
3. The **Clusters** view shows the saved cluster connections (initially empty until you run **Connect to Local Cluster**).
4. A status-bar item (`$(server) Service Fabric: …`) reports the active connection's health.

> Tip: **Service Fabric: Get Started** opens the in-product walkthrough, which mirrors the first half of this guide.

---

## 3. Tour: the Service Fabric activity-bar view

### 3.1 Applications view

Each `.sfproj` shows up as a top-level node. Expanding it produces a Solution-Explorer-style tree:

```
MyApp.sfproj
├── References
├── ApplicationPackageRoot
│   ├── ApplicationManifest.xml
│   ├── MyService1Pkg
│   │   ├── ServiceManifest.xml
│   │   ├── Code (1.0.0)            ← Code package
│   │   ├── Config (1.0.0)          ← Config package, with Settings.xml children
│   │   └── Endpoints
│   └── MyService2Pkg / …
├── ApplicationParameters
│   ├── Local.1Node.xml
│   ├── Local.5Node.xml
│   └── Cloud.xml
├── PublishProfiles
│   ├── Local.1Node.xml
│   ├── Local.5Node.xml
│   └── Cloud.xml
├── StartupServiceParameters
│   ├── Local.1Node.xml
│   ├── Local.5Node.xml
│   └── Cloud.xml
├── StartupServices.xml
└── Scripts
    ├── Deploy-FabricApplication.ps1
    └── …
```

- Right-click any **package** node to open it.
- Right-click the `.sfproj` for the **Build / Rebuild / Clean / Package / Deploy / Publish… / Remove / Add Service…** menu.
- The toolbar of the view exposes **Refresh** and **Create New Application…**.

### 3.2 Clusters view

Every saved connection (local + remote) appears here, with status icons:

| Icon | Meaning |
|---|---|
| `$(check)` green | Connected, cluster health = `Ok` |
| `$(warning)` yellow | Connected, health = `Warning` |
| `$(error)` red | Connected, health = `Error` |
| `$(circle-slash)` | Disconnected / unreachable |

Expanding a connected cluster reveals two groups: **Nodes (N)** and **Applications (N)**.

- Right-click a cluster to **Open Service Fabric Explorer**, **Show Diagnostic Events**, or **Disconnect**.
- Right-click a **deployed application** node to **Attach Debugger to Deployed Service…**.

### 3.3 Status bar

The right-aligned status-bar item shows the active cluster, its node count (e.g. `1-node`/`5-node`), and a coloured health glyph. Click it to switch the active cluster.

---

## 4. Authoring application & service manifests

### 4.1 Schema validation

When opening any `ApplicationManifest.xml` or `ServiceManifest.xml`, the extension associates the file with the official Service Fabric XSD via `redhat.vscode-xml`. Errors and IntelliSense come from the schema for free.

The schema is **discovered at runtime** from the locally installed Service Fabric SDK — typically `C:\Program Files\Microsoft SDKs\Service Fabric\schemas\ServiceFabricServiceModel.xsd`, with `C:\Program Files\Microsoft Service Fabric\bin\Fabric\Fabric.Code\` as a secondary fallback. If your install is in an unusual location, set `serviceFabric.xmlSchemaPath` to either the schemas folder or the `.xsd` file directly.

If neither the SDK nor an override is present, the extension logs a one-time hint on the **Service Fabric** output channel and falls back to the in-house diagnostics described below — XSD validation will be unavailable but everything else continues to work. If you see a "must be declared" error from a third-party DTD-based XML extension, disable it for the workspace; only `redhat.vscode-xml` (LemMinX) is supported.

### 4.2 In-house diagnostics (`SFDxxx`)

Beyond schema validation, the extension surfaces these problems in the *Problems* panel:

| Code | Severity | Trigger |
|---|---|---|
| `SFD001` | Warning | The `ServiceManifestImport.Version` in `ApplicationManifest.xml` does not match the declared `ServiceManifest` version. |
| `SFD002` | Warning | A `[Parameter]` is referenced in a publish profile or `Settings.xml` but never declared in `ApplicationManifest.xml/Parameters`. |
| `SFD003` | Hint | A declared `Parameter` is never referenced. |
| `SFD004` | Error | Two `<Parameter>` elements share the same `Name`. |

Disable the in-house pass with `serviceFabric.diagnostics.enableManifestRules: false` if you want pure schema-only behaviour.

### 4.3 Go to definition (F12)

Place the caret on a `[Parameter]` reference (e.g. `"[MyService_InstanceCount]"`) and press **F12** — the editor jumps to the `<Parameter Name="MyService_InstanceCount" …/>` declaration in the application manifest, even when split across files.

### 4.4 Code actions

- **Promote literal to parameter** — Hover a literal value (e.g. `InstanceCount="3"`) and apply the lightbulb action. The extension adds a `<Parameter>` to the manifest and rewrites the literal as `[MyService_InstanceCount]`.

---

## 5. Building, rebuilding, cleaning, packaging

The extension contributes a `servicefabric` task type and four MSBuild targets.

### 5.1 From the tree

Right-click a `.sfproj` in **Applications** → **Build / Rebuild / Clean / Package**. Output streams to the **Service Fabric** output channel. A summary toast indicates success or failure.

### 5.2 From `tasks.json`

Add a custom task:

```jsonc
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "servicefabric",
            "project": "MyApp/MyApp.sfproj",
            "target": "Package",
            "configuration": "Release",
            "platform": "x64",
            "label": "SF: Package (Release)",
            "group": "build"
        }
    ]
}
```

`target` accepts `Build`, `Rebuild`, `Clean`, or `Package`.

### 5.3 Toolchain discovery

The extension picks the first available MSBuild in this order:

1. `serviceFabric.msbuildPath` setting, if non-empty.
2. `vswhere.exe -latest -find MSBuild\\**\\Bin\\MSBuild.exe` (Visual Studio 2022 / Build Tools).
3. `dotnet msbuild` from the .NET SDK (works for most targets but **cannot** drive the Service Fabric `Package` target).

Check the **Service Fabric** output channel after a build to see which path was used.

### 5.4 NuGet restore

A Service Fabric `.sfproj` carries a top-level `packages.config` pinning `Microsoft.VisualStudio.Azure.Fabric.MSBuild` (1.7.9). The pinned `.props` / `.targets` must be restored to `<workspace>/packages/<id>.<ver>/build/` *before* MSBuild can resolve the `Package` / `Build` targets. The extension restores automatically:

- **Implicitly:** Build / Rebuild / Clean / Package and **Publish Application…** all run restore first as a no-op when packages are already on disk. If a package is missing, you'll see a *"Restoring NuGet packages…"* progress notification.
- **Explicitly:** **Service Fabric: Restore NuGet Packages** (right-click a `.sfproj`, or run from the command palette).
- **On scaffold:** **Create New Application…** and the C#-kind branch of **Add New Service…** also run restore — controlled by `serviceFabric.scaffoldAutoRestore`.

Restore tries three strategies in order:

1. **`nuget.exe restore <App>.sfproj -PackagesDirectory packages -NonInteractive -Verbosity quiet`** — `nuget.exe` is located via `serviceFabric.nugetPath` → `vswhere`-discovered VS NuGet (`Common7\\IDE\\CommonExtensions\\Microsoft\\NuGet\\NuGet.exe`) → `where.exe nuget` (or `which nuget`) → `%USERPROFILE%/.nuget/nuget.exe`.
2. **`MSBuild.exe /t:Restore /p:RestorePackagesConfig=true /p:RestorePackagesPath=<workspace>/packages`** — uses the same MSBuild discovered for build.
3. **HTTPS download from `https://api.nuget.org/v3-flatcontainer/<id>/<ver>/<id>.<ver>.nupkg`** with in-process ZIP extraction (Node `zlib`, no native deps). Bounded to ≤4 missing packages.

If all three fail, you'll see a modal error pointing at the install / manual restore / connectivity remediations. Subprocess output streams to the **Service Fabric** output channel.

---

## 6. Local development cluster lifecycle

The local SDK cluster is driven through PowerShell modules shipped with the Service Fabric SDK.

### 6.1 Start

Run **Service Fabric: Start Local Cluster**. You'll be prompted to pick **1-node** (fast) or **5-node** (failover, placement, rolling-upgrade testing). If you don't want to be prompted every time, set a default with `serviceFabric.localCluster.nodeCount`.

The command:

1. Locates `DevClusterSetup.ps1` in the SDK install.
2. Invokes it with `-CreateOneNodeCluster` or `-CreateMachineCluster` accordingly.
3. Polls `http://localhost:19080/$/GetClusterHealth` until the gateway responds, then auto-creates a "Local Cluster" connection.

### 6.2 Stop, reset, switch mode

| Command | Effect |
|---|---|
| **Stop Local Cluster** | Stops `FabricHostSvc`. |
| **Reset Local Cluster** | Removes data, redeploys the cluster manifest. Prompts for confirmation by default — toggle with `serviceFabric.confirmDestructiveActions`. |
| **Switch Local Cluster Mode (1-node ↔ 5-node)…** | Resets and recreates the cluster in the chosen mode. |

### 6.3 Open Service Fabric Explorer

Right-click a cluster → **Open Service Fabric Explorer** opens the SF web UI in your default browser (`http://localhost:19080/Explorer/index.html` for local, or the saved gateway endpoint for remote).

---

## 7. Connecting to clusters (local & remote)

### 7.1 Local cluster

**Service Fabric: Connect to Local Cluster** registers the connection at `http://localhost:19080`. The connection is stored in workspace state and survives reloads.

### 7.2 Remote cluster (X.509 thumbprint)

**Service Fabric: Connect to Remote Cluster…** prompts for:

1. **Endpoint** — e.g. `https://mycluster.westus.cloudapp.azure.com:19080`.
2. **Server certificate thumbprint** — used for HTTPS validation pinning.
3. **Client certificate thumbprint** (optional) — used for mutual TLS auth. The certificate must already be installed in `Cert:\\CurrentUser\\My`.
4. **Friendly name** — what shows up in the tree.

Connections are persisted **per workspace** so different repos can carry distinct cluster lists.

### 7.3 Switching the active cluster

The status-bar item, **Service Fabric: Select Active Cluster**, and the **Clusters** tree all let you change which connection is the target for **Deploy**, **Remove**, **Attach Debugger**, and **Show Diagnostic Events**.

---

## 8. Deploying & removing applications

### 8.1 Publish

1. Right-click a `.sfproj` → **Publish Application…**, or run **Service Fabric: Publish Application…** from the command palette.
2. Pick a publish profile from `PublishProfiles\\*.xml`.
3. The extension invokes `Deploy-FabricApplication.ps1` from the project's `Scripts` folder, passing the chosen profile and the active cluster's connection settings.
4. PowerShell output streams live to the **Service Fabric** output channel. Errors in the host process are surfaced as a toast.

The connection sent to the script matches the active cluster — for local clusters it's a no-creds call; for remote clusters it includes the server thumbprint and (if supplied) client thumbprint.

**Pre-flight cluster probe.** Before invoking the deploy script the extension hits the publish profile's HTTP gateway (`/$/GetClusterHealth`). If the gateway doesn't respond and the profile is local, a modal lets you **Start Local Cluster** (auto-runs `DevClusterSetup.ps1`) or **Continue Anyway**; remote profiles get **Continue Anyway** only. This avoids the SDK's misleading `"Cluster connection instance is null"` error when the cluster simply isn't running.

**Resolving the package path.** The deploy flow probes a prioritized list of locations to find the folder that *directly* contains `ApplicationManifest.xml` (the SDK's `Test-ServiceFabricApplicationPackage` requires that exact folder; pointing it elsewhere yields a misleading `"Failed to download application package '<leaf>' from the store."`):

  1. `serviceFabric.deploy.packagePath` setting (workspace string — absolute, or relative to the `.sfproj` directory).
  2. `<PackageLocation>` declared in the `.sfproj`.
  3. `<OutputPath>` declared in the `.sfproj`.
  4. Standard `pkg\<Configuration>\` (with the older nested `pkg\<Configuration>\<AppTypeName>\` layout probed automatically).
  5. `bin\<Configuration>\pkg\` and `bin\<Configuration>\` (alternative MSBuild conventions).

**Per-candidate scan depth.** For every declared candidate above, the resolver looks for `ApplicationManifest.xml` directly under the candidate path, and (bounded by **`serviceFabric.deploy.searchMaxDepth`**, default `2`, range `1–16`) under nested subdirectories. The default `2` covers the depth-0 direct, depth-1 immediate-child, and depth-2 nested-`Pkg` layouts produced by the SDK templates. On multi-hit, the resolver auto-matches against the `.sfproj`'s declared `ApplicationTypeName`; if no unique match exists, a quick-pick lets you choose. For shared monorepo output folders where multiple apps land their packages 3+ levels under a common root (e.g. `<repo>\artifacts\bin\<App>\<cfg>\sfpkg\<AppType>\`), raise `searchMaxDepth` to match.

**How `$(Property)` references are expanded (1.1.9).** Steps 1, 2, and 3 above accept MSBuild `$(Property)` tokens — `$(MSBuildProjectName)`, `$(Configuration)`, `$(Platform)`, and any property defined in the `.sfproj`'s own `<PropertyGroup>` blocks. `Condition="'$(Configuration)' == 'Debug'"`-style guards are honored when selecting which group's value wins. Expanded candidates are labelled `(expanded)` in the resolver log so the substitution is visible. Tokens defined exclusively in imported targets (e.g. `Microsoft.ServiceFabric.targets`, `Directory.Build.props`) stay unresolved and surface as an actionable error — set **`serviceFabric.deploy.useMsbuildPropertyEvaluator: true`** to insert a Tier-2 fallback that spawns `MSBuild.exe -getProperty:` and re-runs the candidate sweep against the values MSBuild itself reports. Tier 2 adds 1–3 s per cold Publish; results are cached for the lifetime of the extension host.

**In-flight prompt to enable Tier 2 (1.2.0).** When Tier 1 leaves any `$(Property)` token unresolved AND `serviceFabric.deploy.useMsbuildPropertyEvaluator` is `false`, Publish surfaces a modal naming the unresolved tokens and offering to spawn MSBuild for evaluation. The choices are:

- **Use for this Publish** — enable Tier 2 for the current Publish only; setting is not written.
- **Always use (save setting)** — enable Tier 2 AND write `"serviceFabric.deploy.useMsbuildPropertyEvaluator": true` to the workspace settings.
- **Cancel** (or Escape) — abort the Publish. (Set `serviceFabric.deploy.packagePath` directly if Tier 2 isn't the right answer for your project.)

The prompt is silent when **`serviceFabric.deploy.suppressMsbuildEvaluatorPrompt: true`**, when the user has already opted into Tier 2, or when every token resolved via Tier 1. The reset command (now labelled **legacy cleanup**) clears any per-project Memento entries written by 1.1.10's prompt; 1.1.11+ does not write them. The full list of unresolved tokens is logged to the output channel before the prompt is shown so support transcripts always carry the diagnostic.

**Per-candidate depth scan (1.1.11).** In 1.1.9 only the `serviceFabric.deploy.packagePath` override got a deep scan; auto-discovered candidates were limited to depth 1. In 1.1.11 every declared candidate gets the same depth-N treatment, bounded by `serviceFabric.deploy.searchMaxDepth`. Set the depth to `0` to require direct-match-only behavior.

**Safety: override application-type check (1.1.9).** When `serviceFabric.deploy.packagePath` resolves to a package whose `ApplicationManifest.xml` declares an `ApplicationTypeName` that differs from the source `.sfproj`'s manifest, Publish surfaces a modal — **Continue Publish** / **Cancel Publish** — quoting both names and the resolved path. The choice is **not** persisted; every Publish re-asks. Unreadable manifests, multi-hit auto-matches (which already disambiguate by type), and auto-discovered candidates are exempt by design.

The chosen source is logged (`Resolved application package root: … (via …)`). When multiple candidates each contain an `ApplicationManifest.xml` — typical when one drop folder hosts more than one packaged app, e.g. monorepos that share `out\sfpkg\` — the resolver tries to pick the right one automatically:

  - It reads each candidate's `ApplicationManifest.xml` and matches its `ApplicationTypeName` attribute against the type declared by the `.sfproj`'s own manifest. A unique match is selected silently and logged as `(matched ApplicationTypeName <Name>)`.
  - When no expected type can be inferred (or none of the candidates declared it), Publish surfaces a quick-pick listing each candidate folder labelled by its `ApplicationTypeName` so you can pick the package to deploy.
  - Cancel the picker (or set `serviceFabric.deploy.packagePath` to the desired folder) to abort with the standard "Multiple `ApplicationManifest.xml` found" error.

**Pairing the parameter files with the publish profile.** The publish profile contains two pointers:

```xml
<ApplicationParameterFile      Path="..\ApplicationParameters\Local.5Node.xml" />
<StartupServiceParameterFile   Path="..\StartupServiceParameters\Local.5Node.xml" />
```

The verbatim VS-generated `Deploy-FabricApplication.ps1` reads both paths *out of the profile* and forwards them to `Publish-NewServiceFabricApplication`. So picking `Local.5Node.xml` automatically uses the 5-node application parameters **and** the 5-node startup-service parameters; picking `Local.1Node.xml` uses the 1-node files. There is no separate "which parameters?" prompt.

The output channel logs which files the active profile pairs with, e.g.

```
Publish profile pairs with ApplicationParameterFile: Local.5Node.xml (..\ApplicationParameters\Local.5Node.xml).
Publish profile pairs with StartupServiceParameterFile: Local.5Node.xml (..\StartupServiceParameters\Local.5Node.xml).
```

If a referenced file is missing on disk a warning names it so you can spot a mismatched (e.g. renamed) profile immediately.

To override the application parameters (advanced — useful for ad-hoc debug runs), set `serviceFabric.deploy.promptForApplicationParameters: true`. Publish will then show a quick-pick listing every `ApplicationParameters\*.xml`; the file paired with the chosen profile is pre-selected. The extension parses the picked file client-side and splats its values as `-ApplicationParameter @{...}` over whatever the publish profile names. The startup-service-parameter file is always taken from the profile.

### 8.2 Remove

Right-click a `.sfproj` → **Remove Application**. A confirmation dialog appears unless `serviceFabric.confirmDestructiveActions: false`.

The extension uses the same client-TCP-port translation as the deploy flow (HTTP `19080` → client `19000`) and the same pre-flight cluster probe, then runs the SDK PowerShell teardown strictly bottom-up:

1. **Replicas / instances** — `Get-ServiceFabricPartition` → `Get-ServiceFabricReplica` → `Remove-ServiceFabricReplica -ForceRemove` per replica/instance, evicting stuck replicas so the service-level remove doesn't time out.
2. **Services** — `Remove-ServiceFabricService -Force -ForceRemove` per service.
3. **Application instance(s)** — found via `Get-ServiceFabricApplication -ApplicationTypeName` (so every instance of the type is removed, not just the one named `fabric:/<TypeName>`), then `Remove-ServiceFabricApplication -Force` for each.
4. **Wait for eviction** — polls `Get-ServiceFabricApplication -ApplicationTypeName` until empty or until `serviceFabric.remove.waitSeconds` (default `30`) elapses. `Remove-ServiceFabricApplication` is async; unregistering before the cluster has finished reaping replicas raises *"Application type and version is still in use"*.
5. **Unregister** every version of the application type. When the wait times out the unregister is skipped and a warning names the still-present instances rather than failing loudly.

Per-step progress is logged to the **Service Fabric** output channel.

### 8.3 What gets uploaded

The deploy script uploads the contents of `pkg\\<Configuration>\\<ApplicationTypeName>` (output of the `Package` target). If you've changed manifests but not run **Package**, the deploy runs against the previous package — re-package first.

---

## 9. Debugging a deployed service

### 9.1 The two-step model

Service Fabric services are long-running host processes. Debugging means **attaching** to that process while the cluster is running, not launching a new one. The extension handles the discovery + attach for you.

### 9.2 From the Clusters tree (recommended)

1. Expand the active cluster → **Applications (N)**.
2. Right-click the deployed application → **Attach Debugger to Deployed Service…**.
3. Pick a code package from the QuickPick. The list shows: `node • service-manifest / code-package vN.N.N pid=NNNNN`.
4. Pick **.NET (coreclr)** or **.NET Framework (clr)**.
5. The CoreCLR debugger attaches and you can hit breakpoints, view threads, etc.

Under the hood the extension calls the SF gateway:

```
GET /Nodes/{node}/$/GetApplications/{appId}/$/GetCodePackages?api-version=6.0
```

…then resolves `MainEntryPoint.ProcessId` and constructs a `vscode.debug.startDebugging` invocation with `type: coreclr|clr, request: attach, processId: NNN`.

### 9.3 From `launch.json`

Add a configuration via the snippet **Service Fabric: Attach to Deployed Service**:

```jsonc
{
    "type": "servicefabric",
    "request": "attach",
    "name": "Service Fabric: Attach (coreclr)",
    "runtime": "coreclr"
}
```

When you press F5 with this config selected, the extension shows the same picker before delegating to `coreclr` (or `clr`).

### 9.4 Debugging tips

- The host process must already be running on the cluster — deploy first.
- **No C# extension installed?** The flow surfaces a modal with **Install C# Extension** / **Open Marketplace** / **Cancel**. Pick *Install* to acquire `ms-dotnettools.csharp` and continue into the attach session in one step — you do not need to re-pick the application or runtime. **C# Dev Kit** (`ms-dotnettools.csdevkit`) is *not* required and does not ship a debugger; the plain **C#** extension is sufficient.
- For .NET Framework guest executables, install the Visual Studio Remote Debugger components or the legacy CLR debug engine; not all C# extensions ship a `clr` adapter.
- After a service failover, the PID changes. Re-attach to the new node.
- To skip the pre-flight install prompt entirely (CI / sandboxed environments), set `serviceFabric.debug.suppressInstallPrompt: true`.

### 9.5 Auto-attach after Publish (local cluster)

The extension can attach the debugger automatically after every successful **Publish Application…** to a local dev cluster. This is the inner-loop equivalent of *F5 → break in your service code, edit, redeploy, break again*.

- The first successful Publish in a workspace surfaces a one-time modal asking whether to enable auto-attach. Picking **Yes** sets `serviceFabric.debug.autoAttachOnPublish` to `localOnly`. Picking **Don't ask again** sets it to `never`. Either choice is remembered per workspace.
- When enabled, every successful Publish to the *active local cluster* waits for at least one service replica to reach the `Ready` state (timeout: `serviceFabric.debug.autoAttachReadyTimeoutSec`, default 30s), then enumerates host PIDs via the SF gateway and starts a `coreclr` debug session per host process — capped at `serviceFabric.debug.autoAttachMaxSessions` (default 5). Excess hosts are reported in the success toast.
- **Remote clusters are out of scope for 1.1.8.** Auto-attach short-circuits to skip on any non-local active cluster, regardless of setting.
- The pre-flight C# extension check from §9 still runs; if the user declines, the deploy outcome is preserved and a warning is logged.
- Containers and Guest Executables don't expose a managed PID via the gateway — those services are silently filtered out. If *all* hosts are container/guest-exe, an info toast notes that no eligible PIDs were found.

**Per-deploy override.** Right-click an application in the **Service Fabric: Clusters** view → **Auto-attach Debugger Next Deploy** to arm a one-shot attach for the next successful Publish. The flag is consumed regardless of cluster kind (so it does not leak across cluster switches), but only fires the attach on a local cluster.

---

## 10. Diagnostic events

**Service Fabric: Show Diagnostic Events** opens a webview that polls the cluster's `/EventsStore/Cluster/Events` endpoint over the last 60 minutes (configurable in the panel).

The view shows:

- A sortable, sticky-header table of events.
- An expandable details row per event with the full JSON payload.
- An auto-refresh toggle (15 s by default) and a manual **Refresh** button.

Diagnostic events require the `EventStoreService` system service to be enabled on the target cluster. Local SDK clusters have it on by default; remote production clusters may not — confirm with the SF Explorer's *Cluster → System Services* page.

---

## 11. Scaffolding new applications & services

### 11.1 Create a new application

**Service Fabric: Create New Application…** prompts for:

1. **Application type name** — e.g. `Voting`. Becomes the folder + project + manifest name.
2. **Initial service name** — e.g. `Voting.Web`. Becomes the package folder name (`<name>Pkg`) and the service type name (`<name>Type`).
3. **Service kind** — same 9-item grouped picker as **Add Service** (see §11.2). Defaults to *Stateless Service (.NET Core)* to match historical behaviour.
4. **Target framework** *(C# kinds only)* — `net8.0` / `net6.0` for `.NET Core` and ASP.NET, `net472` / `net48` for `.NET Framework`.
5. **Target folder** — defaults to the workspace root.

The wizard produces a project tree that mirrors Visual Studio's "Service Fabric Application" template byte-for-byte, so the result can be opened later in Visual Studio (or projects authored in Visual Studio open here) without manual fix-up:

```
<AppName>/
├── <AppName>.sfproj
├── packages.config
├── StartupServices.xml
├── ApplicationPackageRoot/
│   └── ApplicationManifest.xml
├── ApplicationParameters/
│   ├── Cloud.xml
│   ├── Local.1Node.xml
│   └── Local.5Node.xml
├── PublishProfiles/
│   ├── Cloud.xml
│   ├── Local.1Node.xml
│   └── Local.5Node.xml
├── StartupServiceParameters/
│   ├── Cloud.xml
│   ├── Local.1Node.xml
│   └── Local.5Node.xml
└── Scripts/
    └── Deploy-FabricApplication.ps1
```

For each C# service the wizard also creates a sibling `<ServiceName>/` project folder next to the `.sfproj` containing the generated `.csproj`, `Program.cs`, the kind-specific source files (see §11.2 for the full file matrix), `Properties/launchSettings.json`, `PackageRoot/{ServiceManifest.xml, Config/Settings.xml}` (physical files — VS-canonical layout), and — for ASP.NET kinds — `appsettings.json` + `appsettings.Development.json`. Actor kinds additionally produce a sibling `<ServiceName>.Interfaces/` project folder containing `<ServiceName>.Interfaces.csproj` and `I<Actor>.cs`. Guest executables retain the legacy `<App>/ApplicationPackageRoot/<ServiceName>Pkg/` location for back-compat.

Notes:

- `Scripts/Deploy-FabricApplication.ps1` is the verbatim Visual Studio template — same parameter contract (`PublishProfileFile`, `StartupServicesFile`, `ApplicationPackagePath`, `[Hashtable] ApplicationParameter`, `OverrideUpgradeBehavior`, `OverwriteBehavior`, `SecurityToken`, …), same dispatch to `Publish-NewServiceFabricApplication` / `Publish-UpgradedServiceFabricApplication` via splatting. The extension's **Publish Application…** command (§8) calls it with the same conventions Visual Studio uses.
- The `.sfproj` declares `Microsoft.VisualStudio.Azure.Fabric.MSBuild` 1.7.6 in `packages.config` and imports its `.props` / `.targets` conditionally (`Condition="Exists(...)"`), so the project still builds when only the SDK-installed `Microsoft.VisualStudio.Azure.Fabric.ApplicationProject.targets` is available — i.e. without needing to run `nuget restore` first.
- The `Cloud.xml` publish profile ships with the standard secured-cluster scaffolding (`X509Credential="true"`, empty `ConnectionEndpoint` / `ServerCertThumbprint`, `UpgradeDeployment Mode="UnmonitoredAuto"`); fill in your cluster's values before deploying to it.
- For stateless seeds, `Local.5Node.xml` initializes `<Service>_InstanceCount` to `3`; the other environments default to `1`. For stateful and actor seeds, every environment seeds `<Service>_TargetReplicaSetSize` to `3`.

### 11.2 Add a service

**Service Fabric: Add New Service…** adds a new service package to an existing application project, mirroring Visual Studio's *Add → New Service Fabric Service…* dialog (same grouped 9-item layout). You can run it from the command palette or right-click a `.sfproj` in the **Applications** view.

What the wizard prompts for:

1. **Target project** — skipped when there is exactly one `.sfproj` in the workspace, or when invoked from a tree node.
2. **Service kind** — 9-item grouped picker:

   | Group | Kind | Generated artifacts |
   |---|---|---|
   | **.NET Core** | Stateless Service | C# project + `<Service>.cs` deriving from `StatelessService`. |
   | **.NET Core** | Stateful Service | C# project + `<Service>.cs` deriving from `StatefulService` (demos a reliable dictionary). |
   | **.NET Core** | Actor Service | C# project + `Interfaces/I<Actor>.cs` + `<Actor>.cs` registered via `ActorRuntime.RegisterActorAsync`. |
   | **.NET Core** | Stateless ASP.NET Core | C# project + `<Service>.cs` (Kestrel-hosted) + `Controllers/ValuesController.cs` + `appsettings.json`. |
   | **.NET Core** | Stateful ASP.NET Core | Same as above plus `StateManager` injected into the request pipeline. |
   | **.NET Framework** | Stateless Service | SDK-style csproj targeting `net472`. |
   | **.NET Framework** | Stateful Service | SDK-style csproj targeting `net472`. |
   | **.NET Framework** | Actor Service | SDK-style csproj targeting `net472`. |
   | **Hosted Containers and Applications** | Guest Executable | Wraps an existing binary; no code is generated. |

3. **Service name** — also becomes the package folder (`<name>Pkg`) and, for C# kinds, the `.csproj` folder and assembly name.
4. **Service type name** — defaults to `<name>Type`.
5. **Initial package version** — defaults to `1.0.0`.
6. **Target framework** *(C# kinds only)* — for `.NET Core`/ASP.NET kinds: `net8.0` (default) / `net6.0`. For `.NET Framework` kinds: `net472` (default) / `net48`. ASP.NET Core kinds always force a netcore TFM regardless of the picked group.
7. **Guest payload source** *(guest only)* — either a single executable file or a folder of payload files. The chosen file/folder is copied into `ApplicationPackageRoot/<Service>Pkg/Code/`.
8. **Guest arguments** *(guest only, optional)* — surfaced as `<ExeHost><Arguments>` in the generated manifest.

**StartupServices.xml-first decision tree.** When the application has a `StartupServices.xml` (every `.sfproj` produced by recent Visual Studio templates does, including those produced by **Create New Application…**), the wizard wires the new service into `StartupServices.xml` + the per-environment `StartupServiceParameters/<env>.xml` files, *not* into `<DefaultServices>` inside `ApplicationManifest.xml`. The `<ApplicationManifest>` only gets the `<Parameter>` declarations and the `<ServiceManifestImport>` block. This matches how the VS designer populates the same artifacts.

When `StartupServices.xml` is absent (legacy projects), the wizard falls back to the original behaviour and writes the `<Service>` block under `<DefaultServices>` instead.

What the command does on disk:

- For **C# kinds** (Stateless / Stateful / Actor / ASP.NET Stateless / ASP.NET Stateful), creates `<csprojDir>/PackageRoot/{ServiceManifest.xml, Config/Settings.xml}` *physically* (matching VS-canonical Service Fabric Service template layout). For **Guest executables**, creates `<App>/ApplicationPackageRoot/<Service>Pkg/{ServiceManifest.xml, Code/, Config/Settings.xml}` (legacy back-compat layout — guests ship pre-built payloads, not built C# projects).
  - **Stateless / Stateful (C#)** — `<Program>` is the assembly name (e.g. `<Service>.exe`); the `Code/` directory is empty until you build the generated C# project (the AfterBuild target copies the build output into `Code/`).
  - **Actor (C#)** — `<StatefulServiceType HasPersistedState="true" />`; runtime registration uses `ActorRuntime.RegisterActorAsync<TActor>` from `Program.cs`. Actors register at process start so they don't appear in `StartupServices.xml`.
  - **ASP.NET Core (stateless / stateful)** — `<Endpoint Protocol="http" Name="ServiceEndpoint" Type="Input" Port="8559" />` (matching VS-canonical attribute order); the generated service stands up a Kestrel-hosted ASP.NET Core pipeline (controllers + DI + appsettings). ASP.NET *stateful* services do **not** publish a `<Resources>/<Endpoints>` block — replicas open per-partition listeners at runtime.
  - **Guest** — the chosen payload is copied into `Code/`. The service type is marked with `UseImplicitHost="true"` and the `<Program>` element points at the staged binary.
- For **C# kinds**, also generates a sibling `<ServiceName>/` project folder next to the `.sfproj`'s directory containing:
  - `<ServiceName>.csproj` — SDK-style, `OutputType=Exe`, with `<IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>` and `<ServerGarbageCollection>True</ServerGarbageCollection>`. Package references depend on the kind:
    - All kinds reference `Microsoft.ServiceFabric.Services 8.1.208` (except actor, which references `Microsoft.ServiceFabric.Actors 8.1.208` instead — `.Actors` transitively pulls in `.Services` and `.Data`).
    - Stateful and ASP.NET stateful kinds add `Microsoft.ServiceFabric.Data 8.1.208`.
    - ASP.NET kinds add `Microsoft.ServiceFabric.AspNetCore.Kestrel 8.1.208` and `Microsoft.AspNetCore.OpenApi 9.0.15`. The Web SDK provides `Microsoft.AspNetCore.App` implicitly, so no explicit `<FrameworkReference>` is emitted.
  - For `.NET Core` kinds, the csproj enables **self-contained publish by default** so the binaries Service Fabric copies into `Code/` carry the runtime alongside the app:
    ```xml
    <SelfContained>True</SelfContained>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    ```
    These props are *omitted* for `.NET Framework` kinds (where `net472` always uses the framework-installed runtime).
  - `Program.cs` — registers the service / actor with the appropriate runtime and blocks on `Thread.Sleep(Timeout.Infinite)`. ASP.NET kinds emit a thin `ServiceRuntime.RegisterServiceAsync` wrapper (matching the VS-canonical Program.cs) — they do not run standalone outside a cluster.
  - `<ClassName>.cs` — a minimal service derivation. **For actor kind** an additional sibling `<ServiceName>.Interfaces/` project is generated alongside `<ServiceName>/`, containing `<ServiceName>.Interfaces.csproj` and `I<Actor>.cs` (the actor interface).
  - For ASP.NET kinds, additionally emits `Controllers/ValuesController.cs`, `appsettings.json`, and `appsettings.Development.json` (verbose Logging + `DetailedErrors=true`). The Web SDK includes `appsettings*.json` in the build output implicitly, so no explicit `<None Update>` ItemGroup is emitted.
  - **`Properties/launchSettings.json`** is generated for every C# kind so Visual Studio's *F5 on the C# project* and `dotnet run` know how to launch. ASP.NET kinds ship a profile that opens `http://localhost:8559/api/values` with `ASPNETCORE_ENVIRONMENT=Development`. Non-ASP.NET kinds get a profile that runs the host exe with `DOTNET_ENVIRONMENT=Development` (note: Reliable Services hosts still require FabricHost to register the runtime — the profile is for VS debugger attach + working-directory setup, not for `dotnet run`).
  - **Visual Studio interop** — `PackageRoot/{ServiceManifest.xml, Config/Settings.xml}` are physically present inside the C# project folder (matching VS's own *Service Fabric Service* template byte-for-byte). VS Solution Explorer renders them naturally without `<Link>` mappings. The `.sfproj`'s `Package` target reads them via the parser's `<ProjectReference>` walk + `<csprojDir>/PackageRoot` discovery (with legacy `<App>/ApplicationPackageRoot/<Service>Pkg/` fallback for guests). **No `.sln` file is generated** — Visual Studio creates one automatically when a user opens the `.sfproj` for the first time, so we don't ship one (avoiding format-version drift across VS releases).
- For **C# kinds**, registers the new project in the `.sfproj` as `<ProjectReference Include="..\<ServiceName>\<ServiceName>.csproj" />` (appended to the existing `<ItemGroup>` containing `<ProjectReference>` entries when one exists; otherwise a fresh group is inserted before the `<Import>` line). For ASP.NET kinds, the reference also carries a child `<ServiceLaunchUrl>` element (so VS's *F5 on .sfproj* opens the service URL after deploy). For actors, an additional reference for `<ServiceName>.Interfaces.csproj` is added.
- Patches `ApplicationManifest.xml`:
  - **When `StartupServices.xml` is present (modern VS template):** the application manifest only gains a `<ServiceManifestImport>` block referring to the new package. ASP.NET kinds additionally declare a single `<Folder>_ASPNETCORE_ENVIRONMENT` parameter (referenced by `<EnvironmentOverrides>` inside the import). Instance/replica counts live exclusively in `StartupServices.xml`.
  - **When `StartupServices.xml` is absent (legacy projects):** the manifest gets the full Parameter declarations + a `<Service>` block under `<DefaultServices>`.
    - **Stateless / Guest / ASP.NET Stateless**: `<Service>_InstanceCount` (`-1`).
    - **Stateful / Actor / ASP.NET Stateful**: `<Service>_PartitionCount` (`1`), `<Service>_MinReplicaSetSize` (`3`), `<Service>_TargetReplicaSetSize` (`3`).
- **When `StartupServices.xml` is present:** patches it with `<Parameter>` and `<Service>` declarations for the new service (except for actors, which register at process start via `ActorRuntime` and are not listed); patches every `StartupServiceParameters/*.xml` with environment-appropriate values (Local.1Node → `1`, Local.5Node → `3`, Cloud → `-1` for stateless / `3` for stateful).
- Patches every `ApplicationParameters/*.xml` with environment-appropriate defaults for **ASP.NET kinds only**: Local.* environments set `<Folder>_ASPNETCORE_ENVIRONMENT=Development`; Cloud sets it to `""` (empty). Non-ASP.NET kinds make no per-environment parameter file changes (their counts live in `StartupServiceParameters/*.xml` instead).
- Offers to open the new `ServiceManifest.xml`, the patched `ApplicationManifest.xml`, or (for C# kinds) the generated `.csproj`.

**Going from zero to running:**

- *ASP.NET Core kinds* — generate the project, run **Service Fabric: Restore** then **Service Fabric: Build**, then **Service Fabric: Publish Application…** to push to a local cluster. The `<Endpoint Port="8559" />` plus the `<ServiceLaunchUrl>` ensures VS's *F5 on the .sfproj* opens the service URL after deploy.
- *Other C# kinds* (Stateless / Stateful / Actor) — **Service Fabric: Restore** then **Service Fabric: Build** produces the runnable package automatically (the AfterBuild target copies the binaries into `<csprojDir>/PackageRoot/Code/`). Then run **Service Fabric: Publish Application…** to push it to a cluster.
- *Guest* — the payload is staged at scaffold time under `<App>/ApplicationPackageRoot/<Service>Pkg/Code/`, so the application is immediately deployable.
- *Visual Studio* — open the `.sfproj` (or its parent folder) in Visual Studio. VS prompts to create a `.sln` and saves it next to the `.sfproj`. The companion C# project shows up as a referenced project (via the `<ProjectReference>` already inserted into the `.sfproj`) and Solution Explorer renders `PackageRoot/{ServiceManifest.xml, Config/Settings.xml}` natively under it (because they are physical files in `<csprojDir>/PackageRoot/`). F5 on the `.sfproj` runs Restore → Build → Package → Deploy to the local cluster.

#### HTTPS opt-in for ASP.NET Core service kinds

When the picked kind is **Stateless ASP.NET Core** or **Stateful ASP.NET Core**, the wizard also asks *"Generate an HTTPS endpoint in addition to HTTP?"* (default: No).

Picking **Yes** changes three things in the generated artifacts:

- **`ServiceManifest.xml`** declares two `<Endpoint>` rows — `Protocol="http" Name="ServiceEndpoint"` and `Protocol="https" Name="ServiceHttpsEndpoint"` — both wrapped in a `<Resources>` block (stateful ASP.NET also gains a `<Resources>` block in this case, where the http-only stateful flow keeps emitting none).
- **`Properties/launchSettings.json`** uses `applicationUrl: "https://localhost:8443;http://localhost:8559"` and adds an `ASPNETCORE_HTTPS_PORT` env var — so `dotnet run` and Visual Studio F5 outside SF expose both schemes.
- The generated `*Service.cs` listener factory binds **both** URLs from a single `KestrelCommunicationListener`, resolving the HTTPS port at runtime via `serviceContext.CodePackageActivationContext.GetEndpoint("ServiceHttpsEndpoint")`.

Kestrel resolves the ASP.NET Core HTTPS development certificate the first time the HTTPS listener starts. To keep that path working, the wizard immediately offers to run **Service Fabric: Trust ASP.NET Core Dev Certificate** (info toast with **Yes** / **No** / **Don't ask again**). Picking **Don't ask again** writes `serviceFabric.scaffold.suppressDevCertPrompt: true` into the workspace settings; the standalone command remains available for later.

The standalone command is idempotent — already-trusted certs short-circuit on `dotnet dev-certs https --check` alone. It detects expired / expiring (within `serviceFabric.devCert.expirationWarningDays`, default 30 days) / untrusted certs and offers a regenerate-and-trust path. On Windows this surfaces a UAC prompt; on macOS a keychain prompt; on Linux trust is per-distro manual (the command generates the cert and surfaces a docs link).

If you rename `ServiceHttpsEndpoint` in the generated `ServiceManifest.xml`, also update the `GetEndpoint("ServiceHttpsEndpoint")` literal in the listener factory — otherwise the host throws at startup.

### 11.3 Remove a service

**Service Fabric: Remove Service…** is the inverse of Add Service. Run it from the command palette or right-click a `.sfproj` in the **Applications** view.

What the wizard prompts for:

1. **Target project** — skipped when there is exactly one `.sfproj` open, or when invoked from a tree node.
2. **Service package** — picker showing every package referenced by the application (e.g. `Voting.WebPkg v1.0.0`, located at `<csprojDir>/PackageRoot/` for modern C# services or `<App>/ApplicationPackageRoot/<Service>Pkg/` for guests / legacy projects). When a generated companion C# project exists, the picker shows `companion: <Service>.csproj` next to the version.
3. **Confirmation** — a modal warning unless `serviceFabric.confirmDestructiveActions: false`. The detail block enumerates every artifact that will be deleted.

What the command does on disk:

- Reads the package's `ServiceManifest.xml` to discover every `ServiceTypeName` it declares.
- Patches `ApplicationManifest.xml`:
  - Removes the matching `<ServiceManifestImport>` block.
  - Removes every `<Service>` block (under `<DefaultServices>`) whose `ServiceTypeName` is declared in the package.
  - Drops `<Parameter>` declarations whose names were referenced *only* inside the removed `<Service>` blocks. Parameters still used by another service are left alone.
  - Collapses now-empty `<Parameters></Parameters>` and `<DefaultServices></DefaultServices>` blocks to self-closing tags.
- Patches every `ApplicationParameters/*.xml` to drop the same parameter names.
- **When `StartupServices.xml` is present:** also patches it with the same `<Service>`-block + orphan-parameter cleanup, and patches every `StartupServiceParameters/<env>.xml` to drop the same names. This mirrors the StartupServices.xml-first wiring used by Add Service (§11.2). Empty `<Services></Services>` and `<Parameters></Parameters>` blocks collapse to self-closing tags. Legacy projects without `StartupServices.xml` skip this step entirely.
- For services originally created with the **Add Service C# scaffold**, also:
  - Strips the matching `<ProjectReference Include="..\<Service>\<Service>.csproj" />` from the `.sfproj` and collapses any emptied `<ItemGroup>`. Both self-closing and open/close (`<ProjectReference>...<ServiceLaunchUrl>...</ProjectReference>`) forms are handled.
  - Deletes the generated sibling `<ServiceName>/` project folder (`Program.cs`, `<Service>.cs`, `<Service>.csproj`, `Properties/launchSettings.json`, the physical `PackageRoot/{ServiceManifest.xml, Config/Settings.xml}`, plus any build output produced under it). For actor scaffolds, this *also* deletes the sibling `<ServiceName>.Interfaces/` project folder. For ASP.NET scaffolds, this includes `Controllers/ValuesController.cs`, `appsettings.json`, and `appsettings.Development.json`.
  - Detection is conservative: only `.csproj` files inside `<csprojDir>/PackageRoot/...` whose path resolves to the package being removed are eligible. User-authored project references and hand-written C# code are never touched.
- Deletes the package directory last (so a patch failure leaves the disk recoverable). Modern C# kinds delete `<csprojDir>/PackageRoot/`; guest executables delete `<App>/ApplicationPackageRoot/<Service>Pkg/`.

The change is *on disk only*. The deployed application still runs against the cluster until you redeploy. After running Remove Service, run **Service Fabric: Publish Application…** to apply the change to a connected cluster, or **Service Fabric: Remove Application** to take the whole application down first.

### 11.4 Add a library project

**Service Fabric: Add Library Project…** scaffolds a vanilla SDK-style **class library** project next to the `.sfproj` and wires it into the picked consumer service csprojs. A library is plain netcore code shared between services — *not* a Service Fabric service. It carries no `<IsServiceFabricServiceProject>` flag, no `PackageRoot/`, and no `Microsoft.ServiceFabric.*` package references. The library is **never** added to the `.sfproj`'s `<ProjectReference>` graph; only the consuming services see it.

Two ways to invoke:

- **From the `.sfproj` (palette / Applications-view right-click / File Explorer right-click on `*.sfproj`)** — the wizard prompts:
  1. **Library name** — also used as the folder and `.csproj` filename. Default suggestion is `<AppType>.Shared`. Validated against existing folder collisions.
  2. **Target framework** — `net10.0` (recommended), `net9.0`, or `net8.0`. Defaults to the lowest netcore TFM among the application's services so the library can be referenced without an `NU1201` build error.
  3. **Consumers** — multi-pick from the application's service csprojs. Picking nothing scaffolds the library without wiring (you can add references later from the consumer's `.csproj` context).

- **From a `.csproj` (File Explorer right-click on `*.csproj`)** — a binary mode picker:
  - **Create new library project…** scaffolds a fresh library and pre-locks the right-clicked csproj as the only consumer. Default TFM is the consumer's TFM.
  - **Reference existing library project…** opens a picker of every non-service `.csproj` in the workspace that the consumer doesn't already reference, and adds a single `<ProjectReference>` row to the consumer. No new files are created.

What the command does on disk:

- **Library scaffold:** writes `<workspaceRoot>/<Name>/<Name>.csproj` (minimal `<Project Sdk="Microsoft.NET.Sdk">` with `<TargetFramework>`, `<ImplicitUsings>enable</ImplicitUsings>`, `<Nullable>enable</Nullable>`) and a `Class1.cs` stub with a sanitized namespace.
- **Consumer wiring:** appends `<ProjectReference Include="..\<Name>\<Name>.csproj" />` to each picked consumer's first `<ItemGroup>` containing other `<ProjectReference>` rows, or creates a new `<ItemGroup>` immediately before `</Project>` when none exists. Idempotent — already-referenced consumers are left untouched.
- **Auto-restore (when `serviceFabric.scaffoldAutoRestore: true`):** runs the same NuGet restore code path used by **Service Fabric: Restore NuGet Packages**. Best-effort: a restore failure is logged but does not block the scaffold.

The command **never** touches `ApplicationManifest.xml`, `StartupServices.xml`, `*Parameters/*.xml`, or the `.sfproj`. Libraries are not part of the Service Fabric application model.

### 11.5 Remove a library project

**Service Fabric: Remove Library Project…** is the inverse of *Add Library Project*. Two ways to invoke:

- **From the `.sfproj`** — picker shows every library in the workspace (a non-service `.csproj` referenced by at least one other csproj) along with its consumer count. After picking the library, a multi-pick lets you choose which consumers should drop their reference. When you pick **all** consumers, a modal asks whether to also delete the library folder from disk.
- **From a `.csproj`** (right-click on the **library** csproj) — multi-pick of every consumer that currently references it. Folder deletion is **not** offered from this surface — only the `.sfproj` flow surfaces the modal.

What the command does on disk:

- For each picked consumer: removes the matching `<ProjectReference Include="..\<Library>\<Library>.csproj" />` row (both self-closing and open/close forms, slash direction, and case insensitive). Empty `<ItemGroup></ItemGroup>` blocks left behind are collapsed.
- When the *Unwire and delete folder* path is taken **and** no other csproj in the workspace still references the library: recursively deletes `<Library>/`. Folder-deletion failures are surfaced as an error message — but the consumer-csproj edits are committed before the delete is attempted, so they remain in place.
- Refuses to operate on a Service Fabric service project (`<IsServiceFabricServiceProject>True</…>`) — use **Service Fabric: Remove Service…** for those.

Idempotent — running it twice is safe; the second run reports zero consumers updated.

---

## 12. Settings reference

| Setting | Default | Description |
|---|---|---|
| `serviceFabric.msbuildPath` | `""` | Override path to `MSBuild.exe`. |
| `serviceFabric.nugetPath` | `""` | Override path to `nuget.exe` used by **Service Fabric: Restore NuGet Packages**. Falls back to `vswhere`-discovered VS NuGet → `where.exe nuget` (`which nuget` on macOS/Linux) → `%USERPROFILE%/.nuget/nuget.exe`. |
| `serviceFabric.scaffoldAutoRestore` | `true` | Auto-run NuGet restore after **Create New Application…** and the C#-kind branch of **Add New Service…**. Failures are logged but never block the scaffold. |
| `serviceFabric.scaffold.suppressDevCertPrompt` | `false` | Suppress the post-scaffold prompt to trust the ASP.NET Core HTTPS development certificate after **Add New Service…** picks the HTTPS opt-in. The standalone **Service Fabric: Trust ASP.NET Core Dev Certificate** command remains available. |
| `serviceFabric.devCert.expirationWarningDays` | `30` | Days before expiration when **Service Fabric: Trust ASP.NET Core Dev Certificate** warns the cert is expiring soon. Set to `0` to disable expiry warnings. |
| `serviceFabric.debug.suppressInstallPrompt` | `false` | Skip the pre-flight check that prompts to install the C# extension before attaching to a deployed service. Use in CI / sandboxed environments. |
| `serviceFabric.debug.autoAttachOnPublish` | `never` | `never` / `localOnly`. Whether a successful **Publish Application…** auto-starts a `coreclr` debug session per host PID. The first successful Publish surfaces a one-time prompt; afterwards the prompt is silenced. Remote clusters are deferred to a future release. See §9.5. |
| `serviceFabric.debug.autoAttachMaxSessions` | `5` | Maximum debug sessions auto-attach starts in a single Publish. Excess hosts are reported in the toast. Range 1–50. |
| `serviceFabric.debug.autoAttachReadyTimeoutSec` | `30` | Seconds auto-attach waits for at least one replica to reach `Ready` before giving up. Range 5–300. |
| `serviceFabric.sdkPath` | `""` | Override path to the SF SDK install root. |
| `serviceFabric.powerShell.executable` | `auto` | `auto` (Windows PowerShell on Windows, `pwsh` elsewhere), `pwsh`, or `powershell`. |
| `serviceFabric.confirmDestructiveActions` | `true` | Confirm before Remove / Reset Local Cluster. |
| `serviceFabric.tree.showDeploymentStatus` | `true` | Badge applications that are deployed on the active cluster. |
| `serviceFabric.diagnostics.enableManifestRules` | `true` | Enable `SFD00x` rules. |
| `serviceFabric.deploy.packagePath` | `""` | Override the application package path passed to `Deploy-FabricApplication.ps1`. Absolute, or relative to the `.sfproj` directory. Use when MSBuild outputs the package somewhere other than `pkg\<Configuration>\` and the `.sfproj`'s `<OutputPath>`/`<PackageLocation>` (e.g. monorepo drops to a sibling folder). **1.1.9:** MSBuild `$(Property)` references (`$(MSBuildProjectName)`, `$(Configuration)`, etc.) are expanded against the `.sfproj`'s PropertyGroup values. **1.1.11:** the override path is now scanned to `serviceFabric.deploy.searchMaxDepth` levels deep (same as every other declared candidate) when the manifest is not directly under it. When this setting resolves to a package whose `ApplicationTypeName` does not match the project's declared type, a modal warning prompts before deploy (not persisted). |
| `serviceFabric.deploy.useMsbuildPropertyEvaluator` | `false` | When `true`, fall back to invoking `MSBuild.exe -getProperty:` to resolve `<OutputPath>` / `<PackageLocation>` values that reference properties defined in imported targets (e.g. `Microsoft.ServiceFabric.targets`, `Directory.Build.props`). The in-extension expander handles all properties declared in the `.sfproj`'s own `<PropertyGroup>` blocks; enable this only when your build relies on imported-property expansion. Adds 1–3 s per Publish on cold cache. See §8.1. |
| `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt` | `false` | Skip the modal prompt (1.2.0) that offers to enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` when Tier 1 expansion leaves unresolved MSBuild properties. Power users / CI configurations can set this to `true` to keep Publish behavior strictly governed by `useMsbuildPropertyEvaluator`. Does not affect projects whose Tier 1 expansion resolves every token. See §8.1. |
| `serviceFabric.deploy.searchMaxDepth` | `2` | Maximum directory depth for the per-candidate `ApplicationManifest.xml` search applied to each declared candidate (`serviceFabric.deploy.packagePath`, `<PackageLocation>`, `<OutputPath>`, `pkg\<Configuration>`, `bin\<Configuration>\pkg`, `bin\<Configuration>`). Default `2` covers the SDK template layouts; raise for shared monorepo output folders where manifests live 3+ levels under a common root. Range `1–16`; values outside the range fall back to the default and emit a warning. Set to `0` programmatically to require direct-match-only. See §8.1. |
| `serviceFabric.deploy.promptForApplicationParameters` | `false` | When `true`, Publish asks which `ApplicationParameters\<env>.xml` to splat over the profile's defaults. When `false` (default), Publish uses the file paired with the publish profile via its `<ApplicationParameterFile>` element — a 5-node profile automatically pulls the 5-node parameters. See §8.1. |
| `serviceFabric.remove.waitSeconds` | `30` | Maximum seconds to wait for the cluster to finish tearing down application instances of a type before unregistering it. `Remove-ServiceFabricApplication` is async — unregistering too soon produces *"Application type and version is still in use"*. Set to `0` to skip the wait (and accept the unregister may fail); raise it for slow remote clusters. See §8.2. |
| `serviceFabric.xmlSchemaPath` | `""` | Override path to the Service Fabric XSDs. Folder containing `ServiceFabricServiceModel.xsd`, or a direct `.xsd` file. Empty falls back to the standard SDK install locations. See §6. |
| `serviceFabric.logLevel` | `info` | `error` / `warn` / `info` / `debug`. |
| `serviceFabric.localCluster.endpoint` | `http://localhost:19080` | HTTP gateway endpoint for the local dev cluster. |
| `serviceFabric.localCluster.nodeCount` | `5` | Default for **Start Local Cluster**. `1` or `5`. |
| `serviceFabric.telemetry.enabled` | `false` | Local-only telemetry events. See §15. |

---

## 13. Commands reference

All commands live under the **Service Fabric** category in the command palette.

| Command | What it does |
|---|---|
| Get Started | Opens the in-product walkthrough. |
| Open Help Guide | Opens this document in a side-by-side preview. |
| Refresh / Refresh Clusters | Re-scans the workspace / re-queries the cluster. |
| Build / Rebuild / Clean / Package Application | MSBuild target on the selected `.sfproj`. |
| Publish Application… / Remove Application | Wraps the SDK deploy/remove scripts. |
| Connect to Local Cluster / Connect to Remote Cluster… | Adds a connection. |
| Disconnect | Removes a saved connection. |
| Select Active Cluster | Picks which connection drives deploy/attach/events. |
| Start / Stop / Reset Local Cluster | Local SDK cluster lifecycle. |
| Switch Local Cluster Mode (1-node ↔ 5-node)… | Reset + recreate at the chosen size. |
| Open Service Fabric Explorer | Opens the SFX web UI in the default browser. |
| Create New Application… | Scaffolding wizard. |
| Add New Service… | Picker-driven scaffold for a new stateless or stateful service inside an existing `.sfproj`. Patches the application manifest and per-environment parameter files. |
| Add Library Project… | Scaffolds a vanilla SDK-style class library next to the `.sfproj` and adds a `<ProjectReference>` to the picked consumer service csprojs. From a `.csproj` context, also offers a *Reference existing library project…* mode. See §11.4. |
| Remove Library Project… | Drops the `<ProjectReference>` to the picked library from picked consumers. Optionally deletes the library folder when no consumers remain (`.sfproj` context only). See §11.5. |
| Remove Service… | Picker-driven removal of an existing service package: cleans up the application manifest, parameter files, deletes the `<csprojDir>/PackageRoot/` (or legacy `<Service>Pkg/`) folder, and deletes the sibling C# project (and `<ServiceName>.Interfaces/` for actors). Respects `serviceFabric.confirmDestructiveActions`. |
| Restore NuGet Packages | Restores NuGet packages for the selected `.sfproj` via the resolution chain in §5.4. Auto-runs before Build / Rebuild / Clean / Package / Publish. |
| Attach Debugger to Deployed Service… | Picker → `vscode.debug.startDebugging`. |
| Auto-attach Debugger Next Deploy | Available from a right-click on an application in the **Clusters** view. Arms a one-shot auto-attach for the next successful Publish of that application — useful when the global setting is `never` but you want one targeted attach. See §9.5. |
| Trust ASP.NET Core Dev Certificate | Validates the ASP.NET Core HTTPS development certificate via `dotnet dev-certs https --check`; regenerates and trusts it when missing / expired / untrusted (or expiring within `serviceFabric.devCert.expirationWarningDays`). Idempotent. Cross-platform: Windows surfaces a UAC prompt, macOS a keychain prompt, Linux generates the cert and surfaces a docs link for per-distro manual trust. |
| Reset Tier 2 Property-Evaluator Prompt (legacy cleanup) | (Legacy cleanup.) Clears any per-`.sfproj` Memento entries written by 1.1.10's Tier 2 prompt. 1.1.11+ does not write these entries; the command exists only to wipe stale state. Safe to run on workspaces that never used 1.1.10. |
| Show Diagnostic Events | Opens the diagnostic events webview. |

---

## 14. Troubleshooting

### 14.1 The Service Fabric view is empty

- Confirm the workspace contains a `*.sfproj` file. The extension only auto-activates on workspaces with one.
- Run **Developer: Show Running Extensions** and verify *Service Fabric Tools* is active.
- Check the **Service Fabric** output channel for "Found 0 Service Fabric project(s) in this workspace." messages.

### 14.2 Build fails with `MSBuild.exe not found`

- Install Visual Studio 2022 or VS 2022 Build Tools with the *Azure development* workload (which adds Service Fabric Tools).
- Or set `serviceFabric.msbuildPath` to an explicit path.
- The fallback `dotnet msbuild` will compile but cannot drive the SF `Package` target.

### 14.3 Deploy fails with `ServiceFabricSDK module not found`

- Install the Service Fabric SDK (Windows Web Platform Installer or the runtime + SDK MSIs).
- Verify `Get-Module -ListAvailable ServiceFabricSDK` returns a result in the same PowerShell host the extension uses.
- Override `serviceFabric.sdkPath` if the SDK is in a non-standard location.

### 14.4 Local cluster won't start

1. Run `Get-Service FabricHostSvc` — if absent, the SDK isn't installed.
2. Check `C:\\SfDevCluster\\Log\\Traces\\` for fabric host logs.
3. Try **Reset Local Cluster** — this is destructive but recovers from most corrupted state.
4. Run the SDK's `DevClusterSetup.ps1` directly from an elevated PowerShell to see raw output.

### 14.5 Cluster shows "unreachable"

- Confirm the gateway endpoint with `curl http://localhost:19080/$/GetClusterHealth?api-version=6.0`.
- For remote clusters, confirm the firewall allows port 19080 (HTTP) or 19000 (HTTPS).
- Verify the certificate thumbprints in the connection. The status-bar tooltip shows the last error.

### 14.6 Attach Debugger says "no debuggable code packages"

- The application uses guest-executable or container hosting and the gateway doesn't expose a host PID. Use the standard **Attach to Process** command and pick the host by name.
- The service hasn't started yet; wait until the SF Explorer shows the replica as `Ready`.
- The PID resolved 0 — the host crashed; check **Diagnostic Events**.

### 14.7 Where are the logs?

- **Service Fabric** output channel — every action the extension performs.
- `%TEMP%\\vscode-service-fabric\\*.log` — rolling extension log when `serviceFabric.logLevel: debug`.
- `C:\\SfDevCluster\\Log\\Traces\\` — local cluster traces.

---

## 15. Telemetry & privacy

**This extension does not transmit any telemetry off your machine.**

Setting `serviceFabric.telemetry.enabled: true` only writes structured events to the **Service Fabric** output channel at `debug` verbosity, scrubbed of cluster endpoints, certificate thumbprints, application names, and file paths. It is intended for diagnosing extension behaviour, not for analytics. The setting is **off** by default and is also gated by VS Code's global `telemetry.telemetryLevel`.

No network calls beyond:

- The cluster gateway you've explicitly connected to (`http://localhost:19080` for local, or a configured remote endpoint).
- Marketplace requests made by VS Code itself.

---

## 16. FAQ

**Does this work on macOS / Linux?**
Authoring features (project recognition, manifests, F12, code actions) work everywhere. Build / package / deploy / local cluster / debug attach require Windows because the underlying tooling does.

**Why does it depend on `redhat.vscode-xml`?**
Microsoft does not ship a first-party XML extension for VS Code. `redhat.vscode-xml` is the industry-standard LemMinX-based language server, and it powers schema validation, hover, and IntelliSense for both manifests and `.sfproj` files. The dependency is automatic.

**Can I use a non-default Service Fabric runtime port?**
Yes — set `serviceFabric.localCluster.endpoint` for local, and supply the full URL when adding a remote connection.

**How does this differ from the Visual Studio experience?**
Feature parity targets: project tree, manifest validation, build/package/deploy, local cluster lifecycle, and 5-node testing. Not yet implemented: full project conversion wizard, integrated load-test runner, .NET Framework "F5 → deploy + attach" macro (use **Deploy** then **Attach Debugger**).

**What's the licence?**
MIT. See `LICENSE` in the source repository.

---

*See [CHANGELOG.md](../CHANGELOG.md) for the per-release history.*
