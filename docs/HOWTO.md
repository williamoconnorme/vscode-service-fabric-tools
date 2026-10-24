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
| Authoring (tree, manifest validation, F12, code actions) | VS Code 1.90+. No other extensions. Cross-platform. |
| Build / Package | **Windows:** Visual Studio 2022 **or** Build Tools for VS 2022 with the *Azure development* workload + *Service Fabric Tools* component. **macOS / Linux:** the .NET SDK (8 or later); the extension falls back to `dotnet msbuild`. `.NET Framework` services can't be built off Windows. |
| Deploy / Remove — PowerShell engine | Windows. Service Fabric SDK (the `ServiceFabricSDK` PowerShell module is installed by the SDK setup), and the cluster's client TCP port (usually 19000) must be reachable. Opt-in with `serviceFabric.deploy.engine: "powershell"`. |
| Deploy / Remove — REST engine | Any OS. Only network access to the cluster's HTTP gateway (default port 19080); no PowerShell or Service Fabric SDK. The default on every OS. The cluster's image store must be `fabric:ImageStore`. See §8.4. |
| Local dev cluster | Windows. Service Fabric SDK (provides `FabricHostSvc` and the `Microsoft.ServiceFabric.ClusterSetup` PS modules). On macOS / Linux see §6.4. |
| Debug attach | Windows, with the service running on this machine (local cluster). `ms-dotnettools.csharp` (or another CoreCLR debug adapter) for `.NET`; classic CLR debugger for `.NET Framework` services. |

### 1.2 Install

- **From the marketplace**: search for *"Service Fabric Tools"* and install.
- **From a VSIX**: open the command palette and run **Extensions: Install from VSIX…**, then pick the `vscode-service-fabric-*.vsix` file.

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

Every saved connection (local + remote) appears here. The icon shows its state, and the row its node and application counts; hover for the endpoint, security settings and health:

| Icon | Meaning |
|---|---|
| Server, green | Connected, cluster health `Ok` |
| Server, yellow | Connected, health `Warning` |
| Server, red | Connected, health `Error` |
| Disconnect, dimmed | Disconnected / unreachable |

Expanding a connected cluster shows the same hierarchy as Service Fabric Explorer, fetched live from the gateway as you expand each level:

```
Local Cluster
├─ Application Types (N)        provisioned types → one child per version
├─ Applications (N)             application → service → partition → replica / instance
├─ Nodes (N)                    node → deployed application → service package → Code Packages / Replicas
├─ System (N)                   fabric:/System services → partitions → replicas
└─ Repair Jobs (N)              Repair Manager tasks (state, action, target nodes, result)
```

Icons are coloured by health state (green `Ok`, yellow `Warning`, red `Error`) and each row's description shows status, kind and placement (for example `Primary • Ready • _Node_2`). Hover for the full record. Groups and entities carry an inline **Refresh** button; the view's toolbar **Refresh Clusters** re-probes every saved connection.

**Filtering and sorting.** The funnel button in the view's title bar opens a **Filter** menu. **Filter and Sort…** opens a multi-select picker with every option; the individual toggles **Hide Healthy**, **Hide Warning**, **Hide Unhealthy** (health `Error`), **Hide Completed Repair Jobs** and **Sort by Health (Unhealthy First)** can also be flipped one at a time, and **Clear Filters** resets everything. Sorting by health orders every list `Error` → `Warning` → `Ok` → rows without a health state, keeping the gateway's order within each band. Hidden rows are replaced by a single `N hidden by filter` note at the end of each list (click it to clear the filter), group counts stay unfiltered, and the active filter is shown next to the view title. Rows without a health state (application types, code packages) are never hidden. The filter is remembered per workspace. The same commands are in the palette under **Service Fabric: Clusters View: …**.

Right-click menus follow the entity:

| Entity | Actions |
|---|---|
| Cluster | **Open in Service Fabric Explorer**, **Show Details** (version, health, upgrade progress, load), **Show Health**, **Show Cluster Manifest**, **Show Diagnostic Events**, **Disconnect** |
| Application type / version | **Show Details** (default parameters, service types), **Unprovision Application Type…** |
| Application | **Attach Debugger to Deployed Service…**, **Auto-attach Debugger Next Deploy**, **Show Details**, **Show Health**, **Delete Application…** |
| Upgrading application | **Show Upgrade Progress**, **Resume Upgrade (Next Upgrade Domain)** (also an inline button; for `UnmonitoredManual` upgrades waiting between domains), **Change Upgrade Mode…** (Monitored / UnmonitoredAuto / UnmonitoredManual), **Roll Back Upgrade…** |
| Service | **Show Details** (description), **Show Health**, **Scale Service…** (instance count / target replica set size), **Delete Service…** |
| Partition | **Show Details** (load), **Show Health**, **Reset Partition Load**, **Recover Partition from Quorum Loss…** (stateful) |
| Replica / instance | **Show Details** (host-side detail), **Show Health**, **Restart Replica** (stateful), **Remove Replica / Instance…** |
| Node | **Show Details** (load), **Show Health**, **Activate Node** / **Deactivate Node…** (Pause / Restart / RemoveData / RemoveNode), **Restart Node…**, **Remove Node State…** (down nodes) |
| Deployed application / service package | **Show Details**, **Show Health** |
| Repair job | **Show Details** (full task incl. impact and history), **Cancel Repair Task…** (cancel or abort; not on completed tasks), **Force Approve Repair Task…** (Preparing tasks), **Delete Repair Task…** (completed tasks). The group reports when the cluster has no Repair Manager add-on. |
| Code package | **Attach Debugger to Deployed Service…** (when a PID is known), **Show Details**, **Restart Code Package…**, **Show Container Logs…** (container hosts) |
| Everything | **Copy Name** (the `fabric:/` name, partition GUID, replica id, node name…), **Open in Service Fabric Explorer** (deep-links to the same entity) |

**Show Details** / **Show Health** open the gateway's JSON in a read-only editor. Destructive actions ask for confirmation first; actions that can lose data (delete, unprovision, remove replica, remove node state, recover partition, deactivate with RemoveData) always ask, while restarts and load resets honour `serviceFabric.confirmDestructiveActions`. All of this works on remote clusters too, including Microsoft Entra ID secured ones.

### 3.3 Status bar

Once a cluster is added, the status bar shows the active cluster with the Service Fabric icon (or a disconnected icon) and its node count (e.g. `1-node`/`5-node`). Hover for its health, nodes and applications; click it to switch the active cluster.

---

## 4. Authoring application & service manifests

### 4.1 Schema IntelliSense and validation

The extension has its own Service Fabric schema support; no XML extension is needed. It applies to any `.xml` file whose root element is in the `http://schemas.microsoft.com/2011/01/fabric` namespace: `ApplicationManifest.xml`, `ServiceManifest.xml`, `ApplicationParameters/*.xml`, cluster manifests and so on.

- **Completion.** Type `<` for the child elements allowed at that point (required ones first, inserted with their required attributes), or press Ctrl+Space on an empty line. A space inside a start tag lists the remaining attributes, and `"` lists enumerated values (`true`/`false`, `ExclusiveProcess`/`SharedProcess`, …). `</` closes the current element. In an empty `ApplicationManifest.xml` or `ServiceManifest.xml` the root element is offered with its namespace declarations.
- **Hover.** Element and attribute names show the schema documentation, allowed values and defaults.
- **Validation (`SFXxxx`).** Malformed XML (`SFX001`), elements not allowed in their parent (`SFX101`), unknown attributes (`SFX102`), missing required attributes (`SFX103`) or child elements (`SFX105`), and values outside an enumeration (`SFX104`) are errors. Elements repeated more often than allowed (`SFX106`) and text where none is allowed (`SFX107`) are warnings. Values containing `[Parameter]` references aren't checked, since they're substituted at deployment. An empty root element (the actor `ServiceManifest.xml` stub that the build fills in) isn't flagged for missing children. Child **order** inside a sequence isn't checked. Turn validation off with `serviceFabric.diagnostics.enableSchemaValidation: false`.

**Which schema is used.** The extension bundles a model of `ServiceFabricServiceModel.xsd`. When a Service Fabric SDK is installed (`C:\Program Files\Microsoft SDKs\Service Fabric\schemas\`, with `C:\Program Files\Microsoft Service Fabric\bin\Fabric\Fabric.Code\` as a fallback, or `~/.servicefabric/schemas/` on macOS / Linux), that XSD is used instead, so a newer SDK's additions show up. Set `serviceFabric.xmlSchemaPath` to a folder or `.xsd` file to choose one explicitly. The **Service Fabric** output channel logs which one is in use.

If you also have `redhat.vscode-xml` installed and have associated the Service Fabric XSD with it yourself (`xml.fileAssociations`), you'll see duplicate completions and errors; remove that association.

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

### 4.5 Encrypting secrets

**Service Fabric: Encrypt Value with Certificate…** (command palette, or right-click in an XML file) encrypts a value for `IsEncrypted="true"` settings and parameters, or a container registry password with `PasswordEncrypted="true"`, on any OS. It does what `Invoke-ServiceFabricEncryptText` does on Windows: the value is encrypted for the cluster's secrets certificate (CMS / PKCS#7, AES-256), and the cluster decrypts it with the certificate's private key.

1. Pick the certificate's **public** file (`.cer`, `.crt` or `.pem`, PEM or DER). The last one used is remembered. If the application manifest declares a `<SecretsCertificate>` with a different thumbprint, you're warned.
2. Type the value (it's masked and never logged).
3. In an XML editor the encrypted text replaces the selection; elsewhere it's copied to the clipboard.

```xml
<Parameter Name="DbPassword" IsEncrypted="true" Value="MIIB…" />
```

The certificate must be installed on the cluster nodes, and declared in `ApplicationManifest.xml` (`<Certificates><SecretsCertificate X509FindValue="…" Name="…" /></Certificates>`) so the service can read it.

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
3. `dotnet msbuild` from the .NET SDK. This is the path on macOS / Linux. The Service Fabric MSBuild targets (`Microsoft.VisualStudio.Azure.Fabric.MSBuild` 1.7.9) load and run under .NET MSBuild, so **Package** works. The extension adds `-restore` so the service projects' `PackageReference`s are restored first (Visual Studio does that implicitly). The package lands in `pkg\<Configuration>\<AppName>\`.

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

On macOS / Linux the order differs. Strategy 1 runs only when `mono` is on `PATH`, since `nuget.exe` is a .NET Framework program. Strategy 3 runs **before** strategy 2, because .NET MSBuild's Restore skips `packages.config` projects silently, so strategy 2 exits 0 without restoring anything.

If all three fail, you'll see a modal error pointing at the install / manual restore / connectivity remediations. Subprocess output streams to the **Service Fabric** output channel.

### 5.5 Building on macOS and Linux

Before Build, Rebuild, Package and Publish off Windows, the extension checks the application's service projects:

- **.NET Framework services** (`net4x`) only build on Windows. The build stops and names them. Scaffolding one off Windows warns first.
- **Actor services** generate their service manifest with `FabActUtil` during the build. The Service Fabric Actors build targets write `FabActUtil.runtimeconfig.json` with a `cmd.exe`-style `echo` whose quotes `sh` strips, so the file isn't valid JSON and the build fails on macOS and Linux. New .NET actor projects include a small `SfFixFabActUtilRuntimeConfig` target that rewrites the file correctly (it does nothing on Windows). For existing actor projects the extension offers **Fix and Continue**, which adds the same target to the `.csproj`.

---

## 6. Local development cluster lifecycle

The local SDK cluster is driven through PowerShell modules shipped with the Service Fabric SDK, so these commands are Windows-only and hidden from the command palette elsewhere (see §6.4 for macOS / Linux).

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

### 6.3 Open in Service Fabric Explorer

Right-click a cluster → **Open in Service Fabric Explorer** opens the SF web UI in your default browser (`http://localhost:19080/Explorer/index.html` for local, or the saved gateway endpoint for remote). On any other row in the **Clusters** view the same command deep-links to that application, service, partition, replica, node or code package in Explorer.

### 6.4 macOS, Linux and Windows on ARM

The local dev cluster needs the Service Fabric SDK, which only exists for Windows x64. On macOS, Linux and Windows on ARM the local-cluster commands are hidden, and running one anyway explains this and offers **Add Cluster…**: publish to a remote (dev) cluster instead. Docker "onebox" clusters aren't supported.

---

## 7. Connecting to clusters (local & remote)

You can save any number of clusters. Click **+** (**Add Cluster…**) in the **Clusters** view title bar to add another local or remote connection; **Select Active Cluster** picks the one commands target by default.

### 7.1 Local cluster

**Service Fabric: Connect to Local Cluster** registers the connection at `http://localhost:19080`. The connection is stored in workspace state and survives reloads.

### 7.2 Remote cluster

**Service Fabric: Connect to Remote Cluster…** prompts for the **endpoint** (e.g. `https://mycluster.westus.cloudapp.azure.com:19080`) and then works out the cluster's security on its own:

1. **Server certificate.** If the gateway's certificate isn't trusted by this machine (Service Fabric clusters usually use self-signed ones), a modal shows its subject, issuer and thumbprint and offers to **trust** (pin) it for this connection.
2. **Microsoft Entra ID.** If the cluster publishes an Entra ID configuration, you sign in with the Azure CLI login or VS Code's Microsoft account (`serviceFabric.entra.*`).
3. **X.509 client certificate.** Otherwise, if the gateway answers `403`, it needs a client certificate. Pick a `.pfx` / `.p12` file, or a PEM certificate (plus its key file when the PEM has no key). If the file has a passphrase you're asked for it. The extension shows the thumbprint, retries with the certificate, and offers to pick another one if the cluster still rejects it.
4. **Display name** for the tree.

Only the certificate's **path and thumbprint** are saved with the connection. The passphrase goes to VS Code's SecretStorage, which is the Keychain on macOS, Credential Manager on Windows and libsecret on Linux. It never appears in settings, workspace state, logs or a command line, and it survives restarts.

Right-click a cluster → **Change Client Certificate…** to switch certificates (e.g. after a rotation). If a request is rejected with `403`, the error message offers the same action.

Export a certificate from the Windows store with `certutil -exportPFX`, or build a PFX from PEM files with OpenSSL:

```bash
openssl pkcs12 -export -in admin.crt -inkey admin.key -out sf-admin.pfx -keypbe AES-256-CBC -certpbe AES-256-CBC
```

Older PFX exports encrypted with RC2/3DES can't be read by current Node/OpenSSL; re-export them with AES as above.

Connections are persisted **per workspace** so different repos can carry distinct cluster lists.

### 7.3 Switching the active cluster

The status-bar item, **Service Fabric: Select Active Cluster**, and the **Clusters** tree all let you change which connection is the target for **Deploy**, **Remove**, **Attach Debugger**, and **Show Diagnostic Events**.

---

## 8. Deploying & removing applications

### 8.1 Publish

1. Right-click a `.sfproj` → **Publish Application…**, or run **Service Fabric: Publish Application…** from the command palette.
2. Pick a publish profile from `PublishProfiles\\*.xml`, or one of your saved clusters (see *Publishing to a saved cluster* below). With a single profile and no saved clusters, the profile is used without asking.
3. The extension restores, packages, and then deploys with the engine chosen by **`serviceFabric.deploy.engine`**:
   - **REST** (the default, `auto`, on every OS): uploads, provisions and creates/upgrades the application over the HTTP gateway. No PowerShell or Service Fabric SDK is needed. See §8.4.
   - **PowerShell** (opt-in with `"powershell"`, Windows only): invokes `Deploy-FabricApplication.ps1` from the project's `Scripts` folder, exactly as Visual Studio does. Use it for `xstore:` image stores or a customised deploy script. It connects through the cluster's client TCP port (usually 19000), so it fails with *Could not ping any of the provided Service Fabric gateway endpoints* when only the HTTP gateway is reachable (for example, a gateway on port 443).
4. Output streams live to the **Service Fabric** output channel. Errors are surfaced as a toast.

The connection sent to the script matches the active cluster — for local clusters it's a no-creds call; for remote clusters it includes the server thumbprint and (if supplied) client thumbprint.

**Publishing to a saved cluster.** The picker also lists the clusters in the **Clusters** view, with the active one first. Choosing one deploys to it using its saved security settings: trusted server certificate, client certificate, or Microsoft Entra ID sign-in.

- It always uses the **REST engine**, on Windows too, because `Deploy-FabricApplication.ps1` needs a profile.
- You pick an `ApplicationParameters\*.xml` file, or *None* for the manifest defaults. `Cloud.xml` is suggested for remote clusters and `Local.1Node.xml` for the local one. The `StartupServiceParameters` file with the same name is used with it.
- Without a profile there is no `<UpgradeDeployment>` block. An existing application is upgraded with **`serviceFabric.deploy.upgradeMode`** (`Monitored` by default, with rollback on failure; also `UnmonitoredAuto`, `UnmonitoredManual`). Set it to `Disabled` to replace the application according to **`serviceFabric.deploy.overwriteBehavior`** instead (see §8.4).

After a successful publish to a cluster that none of the project's profiles point at, a notification offers **Save…** a publish profile for it (or **Don't Ask Again for This Cluster**). You can also right-click a cluster → **Create Publish Profile from Cluster…** at any time.

The generated profile:

- uses the client connection endpoint Visual Studio expects (`host:19000`);
- marks Entra ID clusters with `AzureActiveDirectory="true"`;
- references a client certificate by thumbprint (`FindByThumbprint` in `CurrentUser\My`);
- pairs the parameter files you picked;
- upgrades existing applications (`<UpgradeDeployment Mode="Monitored" Enabled="true">`), matching what publishing to the saved cluster does.

It never contains secrets: no passphrases, tokens or certificate file paths. A gateway that isn't on port 19080 (or an https gateway with no client credentials) is written as its URL, with a comment that Visual Studio and `Deploy-FabricApplication.ps1` need the client endpoint instead. The new file is added to the `.sfproj` so Visual Studio shows it.

**Upgrades and automatic version bumping.** An existing application is upgraded in place when the publish profile has `<UpgradeDeployment Enabled="true">`, or, for a saved cluster, when `serviceFabric.deploy.upgradeMode` isn't `Disabled`. Service Fabric only upgrades to a new `ApplicationTypeVersion`, and it rejects a package whose content changed while its version didn't. Before such an upgrade, Publish checks the cluster:

- If the cluster already runs the version being published, a prompt offers **Bump Versions and Upgrade**, or **Redeploy Anyway** (remove and recreate, per `overwriteBehavior`).
- If you raised the application version but left a changed package at its old version, it offers to bump those packages (**Publish As Is** skips that).

Bumping raises the last number of each version (`1.0.0` → `1.0.1`):

- every code / config / data package whose files changed since the **last successful publish to that cluster**, plus its service manifest (also when only the manifest itself changed);
- the `ServiceManifestVersion` references and the `ApplicationTypeVersion`.

Versions you raised by hand are kept. The new versions are written to the source manifests and to the built package, so no repackaging is needed; commit them with your change. Publish records the package's content hashes per project and cluster after every successful publish. Without that record (the first publish from this workspace, or a cluster that was upgraded elsewhere), every service is bumped and restarts. Set **`serviceFabric.deploy.autoBumpVersions`** to `always` to bump without asking, or `never` to turn this off.

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

Right-click a `.sfproj` → **Remove Application**, then pick where to remove it from: a publish profile's cluster or a saved cluster, the same list as Publish (the active cluster first). A confirmation dialog appears unless `serviceFabric.confirmDestructiveActions: false`.

With the REST engine (the default) Remove talks to that cluster's HTTP gateway with the profile's or connection's security settings. With the PowerShell engine it needs a saved connection for the cluster. The PowerShell engine uses the same client-TCP-port translation as the deploy flow (HTTP `19080` → client `19000`) and the same pre-flight cluster probe, then runs the SDK PowerShell teardown strictly bottom-up:

1. **Replicas / instances** — `Get-ServiceFabricPartition` → `Get-ServiceFabricReplica` → `Remove-ServiceFabricReplica -ForceRemove` per replica/instance, evicting stuck replicas so the service-level remove doesn't time out.
2. **Services** — `Remove-ServiceFabricService -Force -ForceRemove` per service.
3. **Application instance(s)** — found via `Get-ServiceFabricApplication -ApplicationTypeName` (so every instance of the type is removed, not just the one named `fabric:/<TypeName>`), then `Remove-ServiceFabricApplication -Force` for each.
4. **Wait for eviction** — polls `Get-ServiceFabricApplication -ApplicationTypeName` until empty or until `serviceFabric.remove.waitSeconds` (default `30`) elapses. `Remove-ServiceFabricApplication` is async; unregistering before the cluster has finished reaping replicas raises *"Application type and version is still in use"*.
5. **Unregister** every version of the application type. When the wait times out the unregister is skipped and a warning names the still-present instances rather than failing loudly.

Per-step progress is logged to the **Service Fabric** output channel.

With the REST engine, Remove does the same over the gateway. It force-deletes every application of the type, waits up to `serviceFabric.remove.waitSeconds` for them to go away, then unprovisions every version of the type.

### 8.3 What gets uploaded

The deploy uploads the contents of `pkg\\<Configuration>\\<ApplicationTypeName>` (output of the `Package` target). Publish always runs **Package** first.

### 8.4 The REST engine

The REST engine reproduces `Publish-NewServiceFabricApplication` / `Publish-UpgradedServiceFabricApplication` with gateway calls, so the same publish profile works from any OS:

1. **Image store.** Reads `ImageStoreConnectionString` from the cluster manifest:
   - `fabric:ImageStore` (the default for Azure clusters): uploaded through the HTTP gateway.
   - `file:<folder>`: copied straight into the folder when this machine can reach it (typically an older local dev cluster).
   - `xstore:` (Azure Storage): uploaded to the storage container with the account key (Blob service, Shared Key; files over 8 MB in blocks). When the cluster manifest encrypts the connection string, Publish asks for it (it isn't saved).
   - Anything else stops with a message suggesting the PowerShell engine (Windows) or `sfctl application upload`.
2. **Decide.** If the type version isn't registered, upload and provision it. If the application doesn't exist, create it. If it exists at the same version, apply **`serviceFabric.deploy.overwriteBehavior`** (default `SameAppTypeAndVersion`: delete the application, re-register the version, recreate). If it exists at an older version, upgrade when the profile has `<UpgradeDeployment Enabled="true">`; otherwise `Always` replaces it and the other values fail with an explanation.
3. **Upload** to `/ImageStore/<Type>_<Version>_<random>`, four files at a time. Files over 4 MB go in 4 MB chunks through an upload session. The progress notification is cancellable. The overall time limit is the profile's `CopyPackageTimeoutSec`, else `serviceFabric.deploy.copyPackageTimeoutSec` (600 s). With the profile's `<CopyPackageParameters CompressPackage="true">`, each code / config / data package folder is uploaded as `<Name>.zip`, as `Copy-ServiceFabricApplicationPackage -CompressPackage` does (packages up to 4 GB).
4. **Provision**, then **create** or **upgrade**. For upgrades, the profile's `<UpgradeDeployment Mode>` and `<Parameters>` (`FailureAction`, `HealthCheck*Sec`, `UpgradeDomainTimeoutSec`, `UpgradeTimeoutSec`, `UpgradeReplicaSetCheckTimeoutSec`, `ForceRestart`, `ConsiderWarningAsError`, `MaxPercentUnhealthyDeployedApplications`, `DefaultServiceTypeHealthPolicy`) map onto the REST upgrade description. Unsupported keys are logged and ignored. Upgrade-domain progress streams to the output channel, and a rollback is reported as a failure.
5. **StartupServices.xml.** After a fresh create, each `<Service>` in `StartupServices.xml` (parameters from the profile's `StartupServiceParameterFile`) that doesn't exist yet is created, matching the PowerShell script. Default services in `ApplicationManifest.xml` are created by the cluster.
6. **Clean up.** The uploaded package is deleted from the image store on success, failure and cancellation. A version that was registered by a deploy that then failed is unregistered.

**Application name and parameters** follow the PowerShell script: `<Application Name>` from the profile's `ApplicationParameterFile` (else `fabric:/<Type without "Type">`), with that file's parameters, overlaid by the file picked when `serviceFabric.deploy.promptForApplicationParameters` is on.

**Certificates.** For an `https` gateway the server certificate is pinned from the profile's `ServerCertThumbprint` (or you're asked to trust it). For `X509Credential="true"` the client certificate named by `FindType` / `FindValue` is looked up in this order:

1. The saved cluster connection's certificate, when its thumbprint (or subject CN for `FindBySubjectName`) matches.
2. **`serviceFabric.clientCertificates`**, a map from `FindValue` to a file path:
   ```json
   "serviceFabric.clientCertificates": { "A1B2C3…": "~/certs/sf-admin.pfx" }
   ```
3. A file prompt, after which you're offered the option to save the choice to that setting.

Entra ID profiles sign in as usual. With the REST engine, the token is used in-process and never passed to a child process.

**Runtime identifier.** A Mac can build packages for either cluster OS. Services scaffolded with the default *Windows* target publish `win-x64` (`<Program>Svc.exe</Program>`), which is right for most Azure clusters. Choose *Linux* when scaffolding (§11.1) for Linux clusters. That sets `<RuntimeIdentifier>linux-x64</RuntimeIdentifier>` and a `<Program>` without `.exe`. For existing services, change both by hand.

---

## 9. Debugging a deployed service

### 9.1 The two-step model

Service Fabric services are long-running host processes. Debugging means **attaching** to that process while the cluster is running, not launching a new one. The extension handles the discovery + attach for you.

Attach works by process ID, so the service has to run on this machine: the local dev cluster on Windows. For remote clusters the command explains that instead of starting a failing session.

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
3. **Service kind** — the **Add Service** picker (see §11.2) without **Container**. Defaults to *Stateless Service (.NET Core)* to match historical behaviour.
4. **Target framework** *(C# kinds only)* — `net10.0` / `net8.0` for `.NET Core` and ASP.NET, `net472` / `net48` for `.NET Framework`.
5. **Target cluster OS** *(.NET Core and ASP.NET kinds)* — **Windows** (`win-x64`, `<Program><Svc>.exe</Program>`) or **Linux** (`linux-x64`, `<Program><Svc></Program>`). **Add New Service…** asks the same question.
6. **Target folder** — defaults to the workspace root.

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

**Service Fabric: Add New Service…** adds a new service package to an existing application project, mirroring Visual Studio's *Add → New Service Fabric Service…* dialog (the same grouped layout, plus **Container**). You can run it from the command palette or right-click a `.sfproj` in the **Applications** view.

What the wizard prompts for:

1. **Target project** — skipped when there is exactly one `.sfproj` in the workspace, or when invoked from a tree node.
2. **Service kind** — 10-item grouped picker (Container is described in §11.2.1):

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

### 11.2.1 Container services

Pick **Container** under *Hosted Containers and Applications* to run a Docker image as a stateless service. The wizard asks for:

1. **Image**, e.g. `myregistry.azurecr.io/web:1.0.0`.
2. **Port** the container listens on (blank if it serves nothing). It becomes a `ServiceEndpoint` with a `<PortBinding>`.
3. **Registry credentials**: for a private registry, `<RepositoryCredentials>` reads `<Service>_RegistryUserName` and `<Service>_RegistryPassword` application parameters. Set them in `ApplicationParameters/*.xml`; encrypt the password with **Encrypt Value with Certificate…** (§4.5) and set `PasswordEncrypted="true"`.

No code is generated and the package has no `Code/` folder: the image is the code.

**Build and Push Container Images…** (right-click a `.sfproj`, or the palette) builds each container service's image with `docker build` and pushes it with `docker push`. Azure Container Registry images sign in first with `az acr login`. You're asked once which Dockerfile builds each image (the build context is the Dockerfile's folder). Set **`serviceFabric.containers.buildBeforePublish`** to do this before every Publish. It needs Docker (and the Azure CLI for ACR) on this machine.

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
| `serviceFabric.powerShell.executable` | `auto` | `auto` (Windows PowerShell on Windows), `pwsh`, or `powershell`. The SDK's PowerShell module only exists on Windows; on macOS / Linux Publish and Remove use the REST engine. |
| `serviceFabric.clientCertificates` | `{}` | Client certificate files for X.509-secured clusters, keyed by the publish profile's `FindValue` (thumbprint, or subject name for `FindBySubjectName`). Values are `.pfx`/`.p12` or PEM paths; `~` expands to the home folder. Used by the REST engine. Passphrases are kept in SecretStorage. See §8.4. |
| `serviceFabric.confirmDestructiveActions` | `true` | Confirm before Remove / Reset Local Cluster. |
| `serviceFabric.tree.showDeploymentStatus` | `true` | Badge applications that are deployed on the active cluster. |
| `serviceFabric.diagnostics.enableManifestRules` | `true` | Enable `SFD00x` rules. |
| `serviceFabric.diagnostics.enableSchemaValidation` | `true` | Enable `SFXxxx` schema validation. Completion and hover stay on. See §4.1. |
| `serviceFabric.deploy.packagePath` | `""` | Override the application package path passed to `Deploy-FabricApplication.ps1`. Absolute, or relative to the `.sfproj` directory. Use when MSBuild outputs the package somewhere other than `pkg\<Configuration>\` and the `.sfproj`'s `<OutputPath>`/`<PackageLocation>` (e.g. monorepo drops to a sibling folder). **1.1.9:** MSBuild `$(Property)` references (`$(MSBuildProjectName)`, `$(Configuration)`, etc.) are expanded against the `.sfproj`'s PropertyGroup values. **1.1.11:** the override path is now scanned to `serviceFabric.deploy.searchMaxDepth` levels deep (same as every other declared candidate) when the manifest is not directly under it. When this setting resolves to a package whose `ApplicationTypeName` does not match the project's declared type, a modal warning prompts before deploy (not persisted). |
| `serviceFabric.deploy.useMsbuildPropertyEvaluator` | `false` | When `true`, fall back to invoking `MSBuild.exe -getProperty:` to resolve `<OutputPath>` / `<PackageLocation>` values that reference properties defined in imported targets (e.g. `Microsoft.ServiceFabric.targets`, `Directory.Build.props`). The in-extension expander handles all properties declared in the `.sfproj`'s own `<PropertyGroup>` blocks; enable this only when your build relies on imported-property expansion. Adds 1–3 s per Publish on cold cache. See §8.1. |
| `serviceFabric.deploy.suppressMsbuildEvaluatorPrompt` | `false` | Skip the modal prompt (1.2.0) that offers to enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` when Tier 1 expansion leaves unresolved MSBuild properties. Power users / CI configurations can set this to `true` to keep Publish behavior strictly governed by `useMsbuildPropertyEvaluator`. Does not affect projects whose Tier 1 expansion resolves every token. See §8.1. |
| `serviceFabric.deploy.searchMaxDepth` | `2` | Maximum directory depth for the per-candidate `ApplicationManifest.xml` search applied to each declared candidate (`serviceFabric.deploy.packagePath`, `<PackageLocation>`, `<OutputPath>`, `pkg\<Configuration>`, `bin\<Configuration>\pkg`, `bin\<Configuration>`). Default `2` covers the SDK template layouts; raise for shared monorepo output folders where manifests live 3+ levels under a common root. Range `1–16`; values outside the range fall back to the default and emit a warning. Set to `0` programmatically to require direct-match-only. See §8.1. |
| `serviceFabric.deploy.promptForApplicationParameters` | `false` | When `true`, Publish asks which `ApplicationParameters\<env>.xml` to splat over the profile's defaults. When `false` (default), Publish uses the file paired with the publish profile via its `<ApplicationParameterFile>` element — a 5-node profile automatically pulls the 5-node parameters. See §8.1. |
| `serviceFabric.deploy.engine` | `auto` | `auto` (PowerShell on Windows, REST elsewhere), `powershell` (Windows only), or `rest` (HTTP gateway, no SDK). See §8.1 / §8.4. |
| `serviceFabric.deploy.overwriteBehavior` | `SameAppTypeAndVersion` | REST engine: what Publish does when the application exists and isn't being upgraded. `SameAppTypeAndVersion` replaces it only at the same version, `Always` replaces it whenever, `Never` fails. The PowerShell engine keeps the behavior of `Deploy-FabricApplication.ps1`. |
| `serviceFabric.containers.buildBeforePublish` | `false` | Build and push container service images before Publish. See §11.2.1. |
| `serviceFabric.deploy.autoBumpVersions` | `prompt` | `prompt` / `always` / `never`. Before an upgrade, raise the versions of changed packages, their service manifests and the application type when needed. See §8.1. |
| `serviceFabric.deploy.upgradeMode` | `Monitored` | Upgrade mode for publishes to a saved cluster (no profile): `Monitored`, `UnmonitoredAuto`, `UnmonitoredManual`, or `Disabled` to replace instead. See §8.1. |
| `serviceFabric.deploy.copyPackageTimeoutSec` | `600` | REST engine: overall time limit for the image-store upload. The profile's `CopyPackageTimeoutSec` takes precedence. |
| `serviceFabric.remove.waitSeconds` | `30` | Maximum seconds to wait for the cluster to finish tearing down application instances of a type before unregistering it. `Remove-ServiceFabricApplication` is async — unregistering too soon produces *"Application type and version is still in use"*. Set to `0` to skip the wait (and accept the unregister may fail); raise it for slow remote clusters. See §8.2. |
| `serviceFabric.xmlSchemaPath` | `""` | Service Fabric XSD for completion, hover and validation. Folder containing `ServiceFabricServiceModel.xsd`, or a direct `.xsd` file. Empty tries the standard SDK install locations and `~/.servicefabric/schemas`, then the bundled schema. See §4.1. |
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
| Refresh / Refresh Clusters | Re-scans the workspace / re-probes every saved cluster connection. |
| Build / Rebuild / Clean / Package Application | MSBuild target on the selected `.sfproj`. |
| Publish Application… / Remove Application | Deploys / removes through the SDK scripts (PowerShell engine) or the HTTP gateway (REST engine). Publish can also target a saved cluster directly. See §8. |
| Add Cluster… | `+` in the Clusters view title bar; asks local or remote, then adds the connection. |
| Connect to Local Cluster / Connect to Remote Cluster… | Adds a connection. |
| Disconnect | Removes a saved connection. |
| Change Client Certificate… | Picks a new X.509 client certificate for a cluster, checks the gateway accepts it, and saves it. See §7.2. |
| Encrypt Value with Certificate… | Encrypts a value for `IsEncrypted` / `PasswordEncrypted` with the cluster's secrets certificate. See §4.5. |
| Build and Push Container Images… | `docker build` + `docker push` (with `az acr login` for ACR) for container services. See §11.2.1. |
| Show Upgrade Progress / Resume Upgrade / Change Upgrade Mode… / Roll Back Upgrade… | Controls for an application that is upgrading (Clusters view). See §3.2. |
| Create Publish Profile from Cluster… | Writes a `PublishProfiles\*.xml` for a saved cluster (endpoint, certificate thumbprints or Entra ID flag, paired parameter files) and adds it to the `.sfproj`. See §8.1. |
| Select Active Cluster | Picks which connection drives deploy/attach/events. |
| Start / Stop / Reset Local Cluster | Local SDK cluster lifecycle (Windows only). |
| Switch Local Cluster Mode (1-node ↔ 5-node)… | Reset + recreate at the chosen size. |
| Open in Service Fabric Explorer | Opens the SFX web UI in the default browser, deep-linked to the right-clicked entity. |
| Refresh (Clusters view rows) | Re-fetches one group or entity and its children from the gateway. On a cluster row it re-probes the connection. |
| Show Details / Show Health | Opens the gateway's JSON for the right-clicked cluster, application type, application, service, partition, replica, node, deployed application, service package or code package in a read-only editor. |
| Show Cluster Manifest | Opens the cluster manifest XML. |
| Copy Name | Copies the entity's `fabric:/` name or id. |
| Unprovision Application Type… | `POST /ApplicationTypes/{name}/$/Unprovision` for the picked version. |
| Delete Application… / Delete Service… | `POST …/$/Delete`, optionally with `ForceRemove`. |
| Scale Service… | `POST /Services/{id}/$/Update` setting `InstanceCount` (stateless, `-1` = all nodes) or `TargetReplicaSetSize` (stateful). |
| Reset Partition Load / Recover Partition from Quorum Loss… | `POST /Partitions/{id}/$/ResetLoad` / `$/Recover`. |
| Restart Replica / Remove Replica / Instance… | `POST /Nodes/{node}/$/GetPartitions/{partition}/$/GetReplicas/{replica}/$/Restart` / `$/Delete`. |
| Activate Node / Deactivate Node… / Restart Node… / Remove Node State… | `POST /Nodes/{node}/$/Activate` / `$/Deactivate` (Pause, Restart, RemoveData, RemoveNode) / `$/Restart` / `$/RemoveNodeState`. |
| Restart Code Package… | `POST /Nodes/{node}/$/GetApplications/{app}/$/GetCodePackages/$/Restart` with the current entry-point instance id. |
| Show Container Logs… | `GET …/$/GetCodePackages/$/ContainerLogs` for a containerised code package (tail or all; current or previous container). |
| Clusters View: Filter and Sort… | Multi-select picker for all hide options plus sort-by-health. Persisted per workspace. |
| Clusters View: Hide / Show Healthy, Warning, Unhealthy, Completed Repair Jobs; Sort by Health / Default Order; Clear Filters | Toggle one filter or sort option at a time. |
| Cancel Repair Task… / Force Approve Repair Task… / Delete Repair Task… | `POST /$/CancelRepairTask` (optionally `RequestAbort`) / `$/ForceApproveRepairTask` / `$/DeleteRepairTask` with the task's id and version. Repair Jobs are listed from `GET /$/GetRepairTaskList`. |
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

- On macOS / Linux, set `serviceFabric.deploy.engine` back to `auto` or `rest`; the SDK module only exists on Windows.
- On Windows without the SDK, set `serviceFabric.deploy.engine` to `rest`.

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
Yes, for everything except the local dev cluster and debug attach. Authoring works everywhere. Build and Package use `dotnet msbuild` (.NET services only). Publish and Remove use the REST engine against a remote cluster's HTTP gateway, with unsecured, server-certificate, X.509 client-certificate and Entra ID clusters all supported (§8.4). The local dev cluster and attaching the debugger need Windows x64 (§6.4). .NET Framework services only build on Windows; .NET actor services build everywhere (§5.5).

**Do I need an XML extension?**
No. Manifest completion, hover and validation are built in (§4.1), so `redhat.vscode-xml` (and its Java / native language server) is no longer installed as a dependency. You can still install it for general XML editing.

**Can I use a non-default Service Fabric runtime port?**
Yes — set `serviceFabric.localCluster.endpoint` for local, and supply the full URL when adding a remote connection.

**How does this differ from the Visual Studio experience?**
Feature parity targets: project tree, manifest validation, build/package/deploy, local cluster lifecycle, and 5-node testing. Not yet implemented: full project conversion wizard, integrated load-test runner, .NET Framework "F5 → deploy + attach" macro (use **Deploy** then **Attach Debugger**).

**What's the licence?**
MIT. See `LICENSE` in the source repository.

---

*See [CHANGELOG.md](../CHANGELOG.md) for the per-release history.*
