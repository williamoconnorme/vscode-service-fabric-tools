# Changelog

## 1.4.0

- **Service Fabric icons for the Applications and Clusters views.** They replace the generic box and server icons, so a view moved out of the Service Fabric sidebar (to the panel, the secondary sidebar or its own activity-bar slot) still looks like Service Fabric.
- **Seed nodes are marked in the Clusters view**: their node icon carries the seed from Service Fabric Explorer (coloured by health like other nodes), and the tooltip says "(seed node)".
- **Node rows in the Clusters view no longer show status and health beside the name**; they're in the tooltip, and health still colours the icon.

## 1.3.1

- **Saved clusters are shared by all workspaces.** Add a cluster once and it's in every folder's Clusters view; with Settings Sync on it also reaches your other machines (setting **`serviceFabric.clusters.syncSavedClusters`**; passphrases never sync). Each workspace keeps its own active cluster (new ones start with the last used), Disconnect state and probe results. Clusters saved per workspace by 1.3.0 and earlier move into the shared list automatically.

## 1.3.0

Deeper VS Code integration: cluster health in the Problems panel, rename and references across manifests, Copilot tools, and a Clusters view that stays current on its own.

### Clusters

- **Auto-refresh.** While the Clusters view is visible and the window is focused, saved clusters are re-probed and expanded rows reloaded, so application, partition, replica and node states stay current. New setting **`serviceFabric.clusters.autoRefreshSeconds`** (default `30`, `0` = off). Nothing reloads while the view is hidden; pending refreshes run once when it's shown. Expanded rows stay expanded across refreshes.
- **Disconnect keeps the cluster.** It used to delete the saved connection; now it keeps it (with its security settings) and stops probing it. New **Reconnect**. **Remove Cluster…** deletes a connection after confirming, from the right-click menu, an inline button on disconnected clusters, or the **Delete** key. Rows say `disconnected` or `unreachable`.
- **Cluster health in the Problems panel.** The active cluster's unhealthy applications and services show on the `ApplicationManifest.xml` / `ServiceManifest.xml` they come from (`SFH001`, `SFH002`), linked to Service Fabric Explorer, with **Show health** quick fixes. Setting: **`serviceFabric.diagnostics.showClusterHealth`**.
- **Deployment history.** **Show Deployment History** lists an application's creates, upgrades (with versions), rollbacks, deletes, health reports and exits from EventStore.
- **Status bar** turns red for cluster health `Error`, yellow for `Warning` or an unreachable cluster.

### Editing manifests

- **Rename and Find All References** for application parameters (declaration, `[Name]` references, every parameter file), service type names (manifests and the C# registration string) and service package names. **F12** on a `[Parameter]` goes to its declaration; on a `ServiceTypeName`, to its service manifest.
- **Outline, breadcrumbs and Go to Symbol** for manifests, `StartupServices.xml`, parameter files and publish profiles.
- **CodeLens** on `ApplicationManifest.xml`: **Publish…**, **Compare with *cluster*** (diff against the manifest provisioned there; also on `ServiceManifest.xml` and the editor's right-click menu), **History**, and **Values: *file***.
- **Inline parameter values.** Each `[Parameter]` shows the value it gets from the chosen parameter file, or the manifest default.
- **Schema status** in the status bar's language area: SDK XSD or bundled schema, and whether validation is on.

### Copilot and agents

- Read-only **language model tools** for the workspace's projects, saved clusters, cluster health, applications, an application's services, partitions and replicas, and EventStore events: `#sfProjects`, `#sfClusters`, `#sfHealth`, `#sfApps`, `#sfApp`, `#sfEvents`. They never change a cluster or prompt for sign-in. VS Code 1.95 or later.

### Workspace, links and remote

- **Restricted Mode.** In an untrusted workspace, commands that run MSBuild, NuGet or project scripts (build, restore, package, publish, remove, container images, scaffolding) are disabled and explain why; views, IntelliSense and validation keep working. Tool-path and certificate settings come from user settings only until the workspace is trusted.
- **Links.** `fabric:/…` names in terminals are clickable (Service Fabric Explorer, deployment history, copy). `vscode://williamoconnor.service-fabric-tools/openCluster`, `/openApplication` and `/addCluster` links for runbooks; a link never contacts a cluster that isn't saved.
- **Remote development.** The extension runs on the workspace host (SSH, WSL, Dev Containers, Codespaces).
- **Empty views.** The Applications view asks you to open a folder when none is open, shows that it's scanning, and offers **Create New Application** only with a folder open. Off Windows, the Clusters view offers only a remote connection.
- **Output channel** lines are timestamped and coloured by level.

## 1.2.1

- **Fix: Build failed with `NETSDK1004` (`project.assets.json` not found) on a freshly created application.** The Build / Rebuild / Package tasks passed `-restore` only to `dotnet msbuild`; they now pass it to Visual Studio's `MSBuild.exe` too, which also doesn't restore the service projects' `PackageReference`s from the command line.

## 1.2.0

First release as **Service Fabric Tools**, a fork of [Service Fabric Project (sfproj) Tools](https://marketplace.visualstudio.com/items?itemName=sfproj-tools.service-fabric-project-tools-vscode) 1.1.11.

Cross-platform publish: connect → build → package → publish → remove now works from macOS and Linux against a remote cluster. Publish and Remove now use the REST engine by default on every OS, Windows included; `Deploy-FabricApplication.ps1` is opt-in.

- **REST deploy engine.** New setting **`serviceFabric.deploy.engine`** (`auto` / `powershell` / `rest`). `auto` uses REST everywhere: it needs only the HTTP gateway, whereas PowerShell's `Connect-ServiceFabricCluster` also needs the client TCP port, which clusters behind a gateway on 443 don't expose. Set `powershell` to run `Deploy-FabricApplication.ps1` as Visual Studio does (Windows; needed for `xstore:` image stores). The REST engine checks the image store is `fabric:ImageStore`, uploads the package (4 MB chunked upload sessions, 4 files in parallel, cancellable), provisions it, then creates or upgrades the application. It honours the publish profile's `<UpgradeDeployment>` mode and health parameters, `CopyPackageTimeoutSec` and the paired parameter files. It creates `StartupServices.xml` services after a fresh create and cleans the image store on success, failure and cancellation. Remove force-deletes every application of the type and unprovisions every version. New settings **`serviceFabric.deploy.overwriteBehavior`** (default `SameAppTypeAndVersion`) and **`serviceFabric.deploy.copyPackageTimeoutSec`** (600).
- **X.509 client certificates.** Connecting to a cluster that answers `403` now asks for a client certificate (`.pfx`/`.p12`, or PEM with an optional separate key). The passphrase is stored in VS Code SecretStorage (Keychain / Credential Manager / libsecret), never in workspace state or logs. Every REST call (Clusters view, entity actions, diagnostics, attach, publish) presents it. New **Change Client Certificate…** action on clusters, also offered when a request is rejected with `403`. Publish profiles with `X509Credential="true"` resolve their `FindValue` (thumbprint or `FindBySubjectName`) through the saved connection, then the new **`serviceFabric.clientCertificates`** setting, then a file prompt.
- **Build / Package on macOS / Linux.** The `dotnet msbuild` fallback now passes `-restore` so service projects' packages are restored. On non-Windows, NuGet restore of `packages.config` downloads the Service Fabric MSBuild package directly (.NET MSBuild's Restore silently skips `packages.config`), and `nuget.exe` is only tried when Mono is installed.
- **Fix: package discovery on macOS / Linux.** The package resolver joined paths with `\`, so nested `pkg/<Config>/<App>/` packages were never found off Windows.
- **Scaffolding:** **Create New Application…** and **Add New Service…** ask for the target cluster OS. *Linux* sets `<RuntimeIdentifier>linux-x64</RuntimeIdentifier>` and a `<Program>` without `.exe`.
- **Platform gating.** Local-cluster commands (and the walkthrough step) are hidden off Windows; running them anyway explains that the dev cluster needs Windows x64 and offers **Add Cluster…**. **Attach Debugger to Deployed Service…** refuses remote clusters with a clear message instead of a failed attach. `powerShell.executable: auto` warns when it has to fall back to `pwsh`. Auto-attach after Publish now uses the application name from the parameter file. Schema probe also checks `~/.servicefabric/schemas`. Project paths are only case-folded on Windows.
- **Built-in manifest IntelliSense; `redhat.vscode-xml` is no longer a dependency.** Completion for elements (with their required attributes), attributes and enumerated values, hover documentation, and schema validation (`SFX001`–`SFX107`) now come from the extension itself. They work in any XML file whose root is in the Service Fabric namespace (application and service manifests, application parameter files, cluster manifests). The schema model is bundled (regenerate with `npm run schema` after an SDK update); an installed SDK's XSD or `serviceFabric.xmlSchemaPath` takes precedence. New setting **`serviceFabric.diagnostics.enableSchemaValidation`**. No Java or native language server is downloaded any more.
- **Fix: scaffolding layout.** Services in their own project show their package name (`CatalogPkg`) instead of `PackageRoot` in the Applications view. Parameters added to `ApplicationManifest.xml` and parameter files are indented consistently, and actor service imports close on their own line. Publish pickers show workspace-relative paths.
- **Encrypt secrets on any OS.** **Encrypt Value with Certificate…** encrypts a value for `IsEncrypted="true"` settings and parameters (or `PasswordEncrypted="true"` registry passwords) with the cluster's public secrets certificate, the way `Invoke-ServiceFabricEncryptText` does (CMS / PKCS#7, AES-256, UTF-16 text), without PowerShell. It inserts the result into the XML editor or copies it.
- **Controls for upgrades in progress.** Upgrading applications in the Clusters view get **Resume Upgrade (Next Upgrade Domain)** for `UnmonitoredManual` upgrades, **Change Upgrade Mode…**, **Roll Back Upgrade…** and **Show Upgrade Progress**.
- **Remove picks its target like Publish.** **Remove Application** lists publish profiles and saved clusters instead of always using the active cluster.
- **Container services.** **Add New Service…** has a **Container** kind: image, optional port binding and optional registry credentials from application parameters. **Build and Push Container Images…** runs `docker build` / `docker push` (with `az acr login` for Azure Container Registry). New setting **`serviceFabric.containers.buildBeforePublish`** runs it before Publish.
- **REST engine: `CompressPackage`, `file:` and `xstore:` image stores.** Compressed packages are uploaded as `<Package>.zip` like `Copy-ServiceFabricApplicationPackage -CompressPackage`. `file:` image stores reachable from this machine are copied to directly, and `xstore:` (Azure Storage) image stores are uploaded to with the account key, asking for the connection string when the cluster manifest encrypts it.
- **Actor services build on macOS and Linux.** The Actors build targets write `FabActUtil.runtimeconfig.json` with an `echo` whose quotes `sh` strips, which broke actor manifest generation off Windows. New .NET actor projects include a fix target, and Build / Package / Publish offer to add it to existing ones.
- **Clear messages for unsupported setups.** .NET Framework services stop the build off Windows with an explanation (and scaffolding one warns first). The local dev cluster explains it needs Windows x64, including on Windows on ARM. Docker "onebox" references are gone; it isn't supported.
- **Publish to a saved cluster.** **Publish Application…** lists your saved clusters alongside the publish profiles, with the active cluster first. Picking one deploys over the HTTP gateway (REST engine) with the connection's saved certificate or Entra ID settings and the `ApplicationParameters` file you choose. If no profile targets that cluster, a notification then offers to save one.
- **Automatic version bumping for upgrades.** When Publish upgrades an application and the cluster already runs that version, or packages changed without a version bump, it offers to raise the versions. Changes are detected by hashing each code / config / data package against the last successful publish to the same cluster. Only changed packages, their service manifests and the application type version are bumped, in the source manifests and the built package. New setting **`serviceFabric.deploy.autoBumpVersions`** (`prompt` / `always` / `never`).
- **Application rows in the Clusters view** no longer spell out the health state; the icon colour shows it (green healthy, yellow warning, red error). Versions are shown without a `v` prefix.
- **Upgrading applications stand out in the Clusters view.**
  - **Icons:** an upgrading application shows a spinning sync icon, orange while rolling back. Creating and deleting applications show a spinner too.
  - **Row details:** the row shows the version it's moving to, the upgrade state and the current upgrade domain (e.g. `MyAppType 1.0.0 → 1.0.1 • Upgrading • UD 2`).
  - **Refresh:** the Applications group refreshes every 10 seconds until it's done.
- **Saved-cluster publishes upgrade existing applications**, using the new **`serviceFabric.deploy.upgradeMode`** (`Monitored` by default; `Disabled` replaces instead).
- **Create Publish Profile from Cluster…** (Clusters view right-click, command palette). It writes a Visual Studio-compatible profile: `host:19000` endpoint, `AzureActiveDirectory="true"` or a `FindByThumbprint` client certificate, server thumbprints, paired parameter files, and a Monitored upgrade block that's switched on. It adds the profile to the `.sfproj` and never writes secrets.
- **Fix: `.sfproj` files had no syntax colouring.** The grammar was registered under the built-in XML grammar's scope name (`text.xml`) and so included itself; it also stopped other XML files being coloured while the extension was active. `.sfproj` files now get full XML colouring, plus highlighting for MSBuild `$(Property)`, `@(Item)` and `%(Metadata)` references.
- **Add more clusters from the Clusters view.** A **+** (**Add Cluster…**) button in the Clusters view title bar adds another local or remote connection at any time, not only from the empty view. The Help Guide book icon and welcome link were removed from the Clusters view (still available from the Applications view and the command palette).
- **Tests and CI.** `npm test` runs `node:test` suites for the REST engine (decision table, upload ordering and chunking, cleanup, upgrade and rollback, remove), publish-profile parsing, `StartupServices.xml`, client-certificate loading (including an end-to-end mutual-TLS check) and the platform helpers. A GitHub Actions workflow runs typecheck, tests and build on Windows, macOS and Ubuntu.


Clusters view mirrors Service Fabric Explorer.

- **Full entity tree.** A connected cluster now expands to **Application Types** (one child per provisioned version), **Applications** (application → service → partition → replica/instance), **Nodes** (node → deployed application → service package → **Code Packages** / **Replicas**) **System** (`fabric:/System` services) and **Repair Jobs** (Repair Manager tasks with state, action, target nodes and result; the group says so when the cluster has no RepairManager add-on). Every level is fetched from the gateway on expand, icons are coloured by health state, and rows describe status, kind, role and placement. Groups and entities have an inline **Refresh**; **Refresh Clusters** re-probes every saved connection.
- **Right-click actions per entity.** Show Details / Show Health (gateway JSON in a read-only editor), Show Cluster Manifest, Copy Name, Unprovision Application Type…, Delete Application…, Delete Service…, Scale Service…, Reset Partition Load, Recover Partition from Quorum Loss…, Restart Replica, Remove Replica / Instance…, Activate / Deactivate / Restart Node, Remove Node State…, Restart Code Package…, Show Container Logs…, Cancel / Force Approve / Delete Repair Task…. Data-losing actions always confirm; restarts and load resets honour `serviceFabric.confirmDestructiveActions`.
- **View filter and sort.** A **Filter** menu on the Clusters view (with a multi-select **Filter and Sort…** picker) hides healthy, warning or unhealthy rows and completed repair jobs, and can sort every list by health (Error → Warning → Ok); hidden rows collapse into a clickable `N hidden by filter` note and the active filter is shown next to the view title. Persisted per workspace.
- **Open in Service Fabric Explorer** (renamed from *Open Service Fabric Explorer*) deep-links to the right-clicked application, service, partition, replica, node or code package.
- **Attach Debugger to Deployed Service…** is also offered on code packages with a known PID and skips the package picker.
- **`SfRestClient`** gains POST support with `FabricError` parsing (`SfGatewayError`) and typed wrappers for the application-type, application, service, partition, replica, node, deployed-entity and repair-task REST APIs (`api-version` 6.0, container logs 6.2, cluster version 6.4).

## 1.1.11

Removes the project-wide recursive `ApplicationManifest.xml` search. Generalizes the per-candidate scan from depth-1 to depth-N (governed by `serviceFabric.deploy.searchMaxDepth`) so every declared candidate — not just `serviceFabric.deploy.packagePath` — supports deep monorepo layouts.

- **Breaking change: project-wide recursive search removed.** The deploy flow no longer falls back to walking the `.sfproj` directory tree for `ApplicationManifest.xml` when every declared candidate misses. When that happens (and Tier 2 — when enabled — also misses), Publish fails with an actionable error pointing at the two real fixes: set `serviceFabric.deploy.packagePath` to the package folder, or enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` if your `<OutputPath>` / `<PackageLocation>` references properties defined in imported targets / `Directory.Build.props`.
- **Breaking change: override-rooted special case removed (subsumed).** The Plan 1.1.9 *override-rooted recursive search* (a special depth-N scan only for `serviceFabric.deploy.packagePath` candidates) is unified with the general candidate sweep. **All** declared candidates — `<PackageLocation>`, `<OutputPath>`, the default `pkg\<Configuration>\`, and the legacy `bin\<Configuration>\…` paths — now get the same depth-N scan, bounded by `serviceFabric.deploy.searchMaxDepth` (default lowered from `4` to `2`, range `1–16`). This supports the common monorepo case where multiple service projects share a common output folder and produce manifests two or three levels under the declared root.
- **`serviceFabric.deploy.searchMaxDepth` retained, default lowered, semantics clarified.** The setting now governs *per-candidate* scan depth instead of project-wide-walk depth, and its default drops from `4` to `2` (which still covers the SDK template layouts: depth-0 direct, depth-1 immediate-child, depth-2 nested-`Pkg`). Existing user `settings.json` values continue to work; the description has been updated. Users with deeper monorepo drops should set the value explicitly (commonly `4`–`8`).
- **Tier 2 prompt simplified to two buttons.** The in-flight prompt that offers to enable `serviceFabric.deploy.useMsbuildPropertyEvaluator` (Plan 1.1.10) drops the third *No, fall back to recursive search* option — it no longer has a meaningful outcome. The modal is now: **Use for this Publish** / **Always use (save setting)** / Cancel. Per-`.sfproj` "decline" Memento entries are no longer written or read.
- **Legacy cleanup command retained.** **Service Fabric: Reset Tier 2 Property-Evaluator Prompt (legacy cleanup)** still works — its only job is to wipe stale `tier2PromptSuppressedFor:*` entries left over from 1.1.10. Safe to run on workspaces that never used 1.1.10.
- **Why.** The project-wide recursive search's single-hit accept (`packageResolver.ts`) bypassed the `ApplicationTypeName` validation that protects multi-hit cases. A workspace containing one stray `ApplicationManifest.xml` (a sibling sample, an extracted backup, a fixture under a non-skipped folder name like `bin` / `out` / `artifacts`) could deploy the wrong application without warning. With `<OutputPath>` / `<PackageLocation>` / `packagePath` / Tier 2 in place — plus the now-uniform depth-N scan under each declared candidate — every supported package layout is reachable explicitly. The project-wide walk was solving a non-problem and creating a real footgun.
- **Tests:** baseline shrinks by ~4–8 unit tests (removed coverage for the deleted project-wide-search path). Three new tests lock the per-candidate depth-N scan under auto-discovered candidates and the actionable-error message text.

## 1.1.10

Interactive prompt to enable MSBuild property evaluation when Tier 1 leaves unresolved `$(Property)` tokens.

- **In-flight prompt during Publish.** When the .sfproj's `<OutputPath>` / `<PackageLocation>` / `serviceFabric.deploy.packagePath` contain MSBuild property references that the in-process expander cannot resolve (typically because they're defined in `Directory.Build.props` or an imported `.targets` — e.g. `$(BuildOutputPath)` in monorepo layouts), Publish surfaces a modal offering to spawn MSBuild for evaluation. Choices: **Use for this Publish** / **Always use (save setting)** / **No, fall back to recursive search** / Cancel.
- **Per-project decline is remembered.** Picking *No, fall back to recursive search* stores a workspace-scoped Memento entry keyed by the .sfproj path; subsequent Publishes of the same project skip the prompt until you run the new **Service Fabric: Reset Tier 2 Property-Evaluator Prompt** command.
- **Workspace-level opt-out.** New setting **`serviceFabric.deploy.suppressMsbuildEvaluatorPrompt`** (boolean, default `false`) silences the prompt entirely for power users / CI environments that want behavior strictly governed by `useMsbuildPropertyEvaluator` and `searchMaxDepth`.
- **No telemetry, no spawn without consent.** The prompt fires only when Tier 1 has left tokens unresolved AND `useMsbuildPropertyEvaluator` is `false`. MSBuild is never spawned silently. Output channel logs every prompt outcome.
- **Unresolved-token aggregation now covers all three sources.** Tokens left unresolved by `<OutputPath>` and `<PackageLocation>` are now aggregated into the same diagnostic set as the user's `serviceFabric.deploy.packagePath` override, so the prompt (and the existing 1.1.9 fallback log line) reflect the true Tier 1 state.
- **Tests:** baseline +~23. New `test/unit/tier2PromptState.test.ts` covers the precondition matrix (suppress setting / Memento entry / unresolved-token presence), all four button outcomes (per-Publish / persist / decline / cancel), the persist-failure-tolerated path, the dismiss-equals-cancel rule, the case-insensitive Windows Memento lookup, the truncated token-list rendering, and the canonical button labels.

## 1.1.9

Package-path resolution now understands MSBuild `$(Property)` references, can fall back to MSBuild itself when imported targets define the OutputPath, recursively searches under an explicit `serviceFabric.deploy.packagePath` override, and warns when the override points at a package whose `ApplicationTypeName` does not match the .sfproj's declared type.

- **MSBuild `$(Property)` expansion (Tier 1, always on).** A new pure expander (`src/project/msbuildPropertyExpander.ts`) resolves `$(MSBuildProjectName)`, `$(Configuration)`, `$(Platform)`, and any property defined in the .sfproj's own `<PropertyGroup>` blocks — honoring `Condition="'$(Configuration)' == '...'"` clauses — before the resolver probes a candidate. The .sfproj's `<OutputPath>` / `<PackageLocation>` and the `serviceFabric.deploy.packagePath` setting all flow through the expander. Candidate labels gain a ` (expanded)` suffix in diagnostic logs so the substitution is visible.
- **MSBuild evaluator fallback (Tier 2, opt-in).** New setting **`serviceFabric.deploy.useMsbuildPropertyEvaluator`** (default `false`). When enabled AND every in-process candidate fails its existence probe, the deploy flow spawns `MSBuild.exe -getProperty:OutputPath,PackageLocation,BuildOutputPath` (with a 17.4-compatible inline-target fallback) and re-runs the candidate sweep against the values MSBuild itself reports. Per-`(sfproj, mtime, configuration, platform)` cached for the lifetime of the extension host. Adds 1–3 s per cold Publish.
- **Override-rooted recursive search.** When `serviceFabric.deploy.packagePath` is set and its direct/single-nested probe misses, the resolver recurses under the override path (bounded by `serviceFabric.deploy.searchMaxDepth`) before falling to the next candidate. Auto-discovered candidates (`<OutputPath>`, `<PackageLocation>`, the default `pkg\<Configuration>` layout) skip this so stale build outputs stay visible. New setting **`serviceFabric.deploy.searchMaxDepth`** (default `4`, range `1–16`) is honored both here and in the project-wide last-resort search.
- **Application-type mismatch warning.** When the override resolves to a package whose `ApplicationManifest.xml` declares an `ApplicationTypeName` that differs from the source .sfproj's, Publish shows a modal — **Continue Publish** / **Cancel Publish** — quoting both names and the path. The choice is **not** persisted; every Publish re-asks. Unreadable manifests, multi-hit auto-matches, and auto-discovered candidates are exempt by design.
- **Tests:** baseline +~30. New `test/unit/msbuildPropertyExpander.test.ts` (token expansion, condition evaluation, property-map walking with intrinsics + conditioned groups + last-write-wins ordering); new `test/unit/packageResolver.test.ts` suites for the expand callback, the Tier 2 evaluator hook (invocation gating, throw / empty / replacement behavior), the override application-type-mismatch matrix (match / mismatch+proceed / mismatch+cancel / nested / auto-exempt / unreadable / no-double-prompt), and the override-rooted recursive search (single / depth-too-shallow / multi+match / multi+ambiguous / auto-exempt / opt-out / `(expanded) (recursive search)` label). `test/unit/sfprojParser.test.ts` extended with 3 fixture cases (intrinsics-driven `<OutputPath>` expansion, conditional-PropertyGroup honoring, unresolved-token reporting).

## 1.1.8

Auto-attach the debugger after successful **Publish Application…** to a local cluster.

- **`serviceFabric.debug.autoAttachOnPublish`** — new setting (`never` / `localOnly`, default `never`). When set to `localOnly`, every successful Publish to the active *local* dev cluster waits for at least one service replica to reach `Ready` and then starts a `coreclr` debug session per host PID resolved via the SF gateway. Container and Guest-Executable hosts (no managed PID) are silently filtered out.
- **First-deploy prompt.** The first successful Publish in a workspace surfaces a one-time modal — **Yes** / **Not now** / **Don't ask again** — that writes the chosen setting and remembers that the prompt was shown. Subsequent Publishes silently honor the setting.
- **Per-deploy override.** Right-click an application in the **Service Fabric: Clusters** view → **Auto-attach Debugger Next Deploy** to arm a one-shot attach for the very next successful Publish. Workspace-scoped, one-shot, consumed regardless of cluster kind so it never leaks across cluster switches.
- **Remote-cluster scope.** 1.1.8 is local-only by design. Auto-attach short-circuits to skip on any non-local active cluster, regardless of setting or one-shot. A future release will extend the flow with the remote-attach prerequisites (Visual Studio Remote Debugger, port-forward / RDP, Bastion).
- **New settings.** `serviceFabric.debug.autoAttachOnPublish`, `serviceFabric.debug.autoAttachMaxSessions` (default 5, range 1–50), `serviceFabric.debug.autoAttachReadyTimeoutSec` (default 30, range 5–300).
- **New SF gateway helpers.** `SfRestClient.listServices` and `SfRestClient.listReplicas` wrap `/Applications/{id}/$/GetServices` and `/Services/{id}/$/GetPartitions` → `/Partitions/{id}/$/GetReplicas` to drive the readiness-poll loop.
- **Telemetry.** Local-only events `extension.debug.autoAttach.decision` and `extension.debug.autoAttach.result` (outcome / attachedCount / droppedCount / clusterKind / durationMs) — see Help → §15.
- **Tests:** baseline +~34. New `test/unit/autoAttachState.test.ts` (decision matrix, plan/cap math, prompt classification, and host-driven orchestrator covering remote-cluster short-circuit + one-shot consumption + ready-timeout + preflight-decline + partial / no-eligible-PIDs outcomes); new `test/unit/sfRestClient.test.ts` (in-process http server fixture validating `listServices` / `listReplicas` URL shape, api-version query, URL-encoding of service ids, partition-walk flatten).

## 1.1.7

ASP.NET Core HTTPS scaffolding option + new **Trust ASP.NET Core Dev Certificate** helper command.

- **HTTPS opt-in for ASP.NET Core service kinds.** *Add New Service…* now asks *"Generate an HTTPS endpoint in addition to HTTP?"* whenever `aspNetStateless` or `aspNetStateful` is picked. When **Yes** is chosen, the generated `ServiceManifest.xml` declares two endpoints (`ServiceEndpoint` + `ServiceHttpsEndpoint`), `Properties/launchSettings.json` exposes both URLs (`applicationUrl: "https://localhost:8443;http://localhost:8559"`) plus `ASPNETCORE_HTTPS_PORT`, and the `KestrelCommunicationListener` factory in the generated `*.cs` file binds both URLs via `app.Urls.Add(...)`. The HTTPS port defaults to `8443` and is overridable per-scaffold. Non-ASP.NET kinds (`stateless`, `stateful`, `actor`, `guest`) do not see the prompt — their flow is unchanged.
- **`Service Fabric: Trust ASP.NET Core Dev Certificate`** — new top-level command that wraps `dotnet dev-certs https --check / --clean / --trust` with structured outcome detection. Idempotent (already-trusted certs short-circuit on `--check` alone). Detects expired / expiring (within `serviceFabric.devCert.expirationWarningDays`, default 30 days) / untrusted certs and offers a regenerate-and-trust path. Cross-platform: Windows surfaces a UAC prompt; macOS surfaces a keychain prompt; Linux runs `--check` plus a non-`--trust` regenerate and surfaces a docs-link toast (per-distro trust is manual on Linux).
- **Inline dev-cert prompt during scaffold.** When the HTTPS opt-in is chosen, the wizard immediately offers to run the new trust command after on-disk writes complete (info toast with **Yes** / **No** / **Don't ask again**). Picking **Don't ask again** writes `serviceFabric.scaffold.suppressDevCertPrompt: true` into the workspace settings.
- **New settings.** `serviceFabric.scaffold.suppressDevCertPrompt` (default `false`); `serviceFabric.devCert.expirationWarningDays` (default `30`).
- **Tests:** baseline +~26. New file `test/unit/devCert.test.ts` exercises `parseDevCertCheckOutput` against captured `dotnet dev-certs https --check --verbose` outputs covering valid / trusted / expired / expiring / missing / untrusted / unparseable paths plus the warning-window boundary. `test/unit/addService.test.ts` augmented with HTTPS opt-in coverage for the manifest, launchSettings, and listener-factory builders, plus a regression guard asserting http-only output is unchanged.

## 1.1.5

Focused UX fix for **Attach Debugger to Deployed Service…**.

- **Pre-flight check.** Before delegating to `vscode.debug.startDebugging`, the attach flow now verifies the matching debugger extension (`ms-dotnettools.csharp` for both `coreclr` and `clr`) is installed. When missing, surfaces a modal with **Install C# Extension** / **Open Marketplace** / **Cancel**. Selecting *Install* runs `workbench.extensions.installExtension`, polls the activation state for up to 5 s, then continues into the same attach session against the already-resolved PID — no need to re-pick application / node / code package / runtime. Selecting *Open Marketplace* opens the Extensions view filtered to `@id:ms-dotnettools.csharp`. The pre-check eliminates the most common confusion where users hunt for *C# Dev Kit* (which does not ship a debugger) instead of the plain *C#* extension.
- **Platform-aware messaging for `clr`.** Picking the **.NET Framework (clr)** runtime on a non-Windows host now fast-fails with a clear *“clr debugging is Windows-only. Pick coreclr instead, or move to a Windows host”* message instead of falling through into a generic refusal. On Windows with the C# extension installed (or just installed), surfaces a one-time informational toast about Visual Studio Remote Debugger components possibly being needed on the host running the service.
- **Diagnostic post-failure toast.** When `vscode.debug.startDebugging` returns `false` for any other reason (process exited mid-flow, extension didn't activate, debug type was claimed by an unrelated extension), the new error message names the likely causes and offers an **Open Output Channel** button to surface the *Service Fabric* output channel.
- **New setting.** `serviceFabric.debug.suppressInstallPrompt` (default `false`) bypasses the pre-flight check for CI / sandboxed environments where the prompt is undesirable.
- **Tests:** 281 → ~295 (+14, no regressions). New file `test/unit/debuggerAvailability.test.ts` exercises `requirementFor`, `checkAvailability` (platform-precedence and exhaustive runtime/platform/installed matrix), `classifyInstallPromptResult`, `formatExtensionMissingMessage`, and `formatPlatformBlockedMessage`.

## 1.1.4

Restore-fix release plus library-project commands and TFM modernization.

- **`Service Fabric: Restore NuGet Packages` actually works now.** The 1.1.3 implementation drove `MSBuild /t:Restore` against a `packages.config`-style `.sfproj`, which is a documented no-op on the modern MSBuild restore target. Restore is now a top-level non-task code path that probes `<workspace>/packages/<id>.<ver>/build/` for idempotency and, when packages are missing, walks a three-strategy chain: (B) `nuget.exe restore <App>.sfproj -PackagesDirectory packages -NonInteractive -Verbosity quiet`, located via the new `serviceFabric.nugetPath` setting → `vswhere.exe` (`Common7\IDE\CommonExtensions\Microsoft\NuGet\NuGet.exe`) → `where.exe nuget` → `%USERPROFILE%/.nuget/nuget.exe`; (C) `MSBuild.exe /t:Restore /p:RestorePackagesConfig=true /p:RestorePackagesPath=<workspace>/packages` against the `.sfproj`; (F) HTTPS download from `https://api.nuget.org/v3-flatcontainer/<id>/<ver>/<id>.<ver>.nupkg` followed by an in-process ZIP extraction (Node `zlib.inflateRawSync`, no native deps) — bounded to ≤4 missing packages so the fallback can't hang on a large workspace. Build / Rebuild / Clean / Package and `Publish` all run restore first via the same code path; the deploy flow no longer relies on the previously-broken `buildRestoreTask`. Failure messages now name a concrete next step (install VS 2022 with the Azure dev workload, run `nuget restore` manually, or check connectivity to api.nuget.org).
- **Auto-restore on scaffold.** `Create New Application…` and the C#-kind branch of `Add New Service…` now invoke the same restore code path immediately after scaffolding so freshly-emitted projects build on first F5 / first **Build**. Best-effort: a restore failure is logged but does not block the scaffold. Controlled by the new `serviceFabric.scaffoldAutoRestore` setting (default `true`).
- **Pre-build error message rewritten.** The two `<Error>` rows in the generated `<ValidateMSBuildFiles>` target (1.1.3 still shipped the legacy *"Unable to find … Please restore the 'Microsoft.VisualStudio.Azure.Fabric.MSBuild' Nuget package"* text) now point at the right command: *"Microsoft.VisualStudio.Azure.Fabric.MSBuild not restored. Run 'Service Fabric: Restore NuGet Packages' from the Command Palette, or 'nuget restore <App>.sfproj -PackagesDirectory packages' from a terminal."*
- **Add Library Project / Remove Library Project.** Two new commands fill the long-standing gap where a workspace needed shared code between services. *Add Library Project* scaffolds a vanilla SDK-style class library next to the `.sfproj` (no `<IsServiceFabricServiceProject>`, no `PackageRoot/`, no SF runtime references) and writes `<ProjectReference>` rows into the picked consumer csprojs — never into the `.sfproj`. *Remove Library Project* is the inverse: drop the `<ProjectReference>` from picked consumers, optionally delete the library folder when no consumers remain. Both commands reach via the `9_modify@1.5/1.6` group on the **Applications** tree's `.sfproj` node *and* the File Explorer's `.csproj` and `.sfproj` surfaces. The `.csproj`-context invocation pre-locks the consumer and adds a *Reference existing library project…* mode that just appends a `<ProjectReference>` (no scaffold).
- **netcore TFM picker modernized.** *Add Service* and *Add Library Project* now offer **net10.0** (LTS, recommended), **net9.0** (STS, end-of-support May 12 2026), and **net8.0** (LTS until Nov 2026). `net6.0` is dropped — out of support since Nov 2024. The default for *Add Service* netcore is `net10.0` for both ASP.NET and plain/Actor branches (1.1.3's split between net8.0 / net9.0 collapsed into a single default).
- **New settings.** `serviceFabric.nugetPath` (override `nuget.exe` location); `serviceFabric.scaffoldAutoRestore` (auto-restore after scaffold, default `true`).
- **`Logger.outputChannel` is public.** Restore subprocesses (and future commands that need to stream child-process output) now write into the *Service Fabric* output channel via the new public getter — previously this required leaking the channel from `createLogger()`.
- **`SfTarget` no longer includes `'Restore'`.** The task provider only emits Build / Rebuild / Clean / Package tasks; Restore is exclusively a command-driven, top-level operation. The deprecated `buildRestoreTask` export is removed (callers were `runMsBuildTarget` and `deployFlow.deployCommand`, both updated).
- **Tests:** 236 → ~272 (+36, no regressions). New coverage: `nugetRestore` (parse, idempotency probe, sanitizeEntryName), `addLibrary` (csproj shape, class stub, `<ProjectReference>` insertion + idempotency, namespace sanitization, TFM compatibility), `removeLibrary` (idempotent removal, empty-`<ItemGroup>` collapse, service-project guard, folder-deletion gate), and updated assertions for the modernized TFM defaults across `addService.test.ts`.

## 1.1.3

VS-canonical layout overhaul. Generated C# services now live under `<csprojDir>/PackageRoot/` (matching Visual Studio's *Service Fabric Service* template byte-for-byte) instead of being linked into `<App>/ApplicationPackageRoot/<Service>Pkg/`. The on-disk shape, NuGet pins, and runtime entry points all line up with what `Application1` (the canonical reference) emits, so a project scaffolded by this extension is interchangeable with one created in VS.

- **Physical PackageRoot, sibling project layout.** *Add Service* and *Create Application* now write `ServiceManifest.xml` and `Config/Settings.xml` as physical files inside the C# project folder (`<csprojDir>/PackageRoot/...`). Guest executables and legacy projects continue to use the old `<App>/ApplicationPackageRoot/<Service>Pkg/` location for back-compat. The `.sfproj`'s `<ProjectReference>`-walk + `Package` target see both layouts via the parser's dual-mode discovery (modern path first, legacy fallback).
- **Sibling `.Interfaces/` project for actors.** Actor scaffolds now produce `<Service>.Interfaces/I<Actor>.cs` + `<Service>.Interfaces.csproj` next to the host project, mirroring the VS Actor template. Both projects are referenced from the `.sfproj`. Remove Service deletes the sibling automatically.
- **Trimmed-down VS-canonical csproj.** Generated csprojs now omit `<SfPackageRoot>`, `CopyToServiceFabricPackageRoot`, `TargetLatestRuntimePatch`, `PublishSingleFile`, `PublishReadyToRun`, `<FrameworkReference Include="Microsoft.AspNetCore.App" />`, the linked `<None Include="$(SfPackageRoot)\...">` ItemGroup, and the explicit `<None Update="appsettings*.json">` ItemGroup (the Web SDK handles them implicitly). Capitalized boolean values (`<SelfContained>True</SelfContained>`, `<IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>`, `<ServerGarbageCollection>True</ServerGarbageCollection>`) match the VS canonical exactly.
- **Pinned MSBuild SDK + package versions.** `Microsoft.VisualStudio.Azure.Fabric.MSBuild` is pinned to `1.7.9`. Service Fabric runtime packages (`Microsoft.ServiceFabric.Services`, `.Actors`, `.AspNetCore.Kestrel`) are pinned to `8.1.208`. ASP.NET kinds also pin `Microsoft.AspNetCore.OpenApi 9.0.15`. These values match VS canonical Application1.
- **Thin ASP.NET Program.cs.** ASP.NET hosts now emit a single, simple `ServiceRuntime.RegisterServiceAsync` entry point (the VS-canonical shape). The 1.1.2 dual-mode standalone-Kestrel branch was removed — the host always runs inside Service Fabric, matching VS templates. ASP.NET kinds bind to port 8559 (matches the manifest's `<Endpoint Port="8559" />`).
- **`<Endpoint>` attribute order matches VS.** ASP.NET service manifests now emit `<Endpoint Protocol="http" Name="ServiceEndpoint" Type="Input" Port="8559" />` (Protocol-first), matching the VS-canonical attribute ordering. ASP.NET stateful services no longer publish a `<Resources>/<Endpoints>` block — replicas open per-partition listeners at runtime instead.
- **Restore is now a first-class build target.** `serviceFabric.restore` runs `MSBuild /t:Restore` against the .sfproj. Build / Rebuild / Package now run Restore implicitly first (matching VS's behavior). `deployCommand` runs Restore before Package.
- **Application manifest split.** When a project has `StartupServices.xml` (the modern VS template), `<Parameter>` declarations for instance/replica counts now live exclusively in `StartupServices.xml`, never in `ApplicationManifest.xml`. ASP.NET kinds still declare a single `<Folder>_ASPNETCORE_ENVIRONMENT` parameter in the application manifest's `<Parameters>` block (because it's referenced by `<EnvironmentOverrides>` in the import). Legacy projects without `StartupServices.xml` keep the unified `<DefaultServices>` shape.
- **Actors are not registered in StartupServices.xml.** Per VS canonical, actor services register at process start via `ActorRuntime.RegisterActorAsync` and have no `<Service>` entry in StartupServices.xml. Add Service skips StartupServices for actors; Remove Service treats their absence as expected.
- **Smarter `<ProjectReference>` removal.** `patchSfprojRemoveProjectReference` now handles both self-closing (`<ProjectReference Include="..." />`) and open/close forms (`<ProjectReference Include="...">...child elements...</ProjectReference>`) — needed for ASP.NET kinds that carry a `<ServiceLaunchUrl>` child.
- **Per-environment parameter scope tightening.** `patchApplicationParametersXml` is now ASP.NET-only — it writes `<Folder>_ASPNETCORE_ENVIRONMENT=Development` for Local environments and `=""` for Cloud. Instance counts moved to `StartupServiceParameters/*.xml`.
- **Tests:** 235 → 236 (+1, no regressions). Test assertions extensively updated to track the new VS-canonical shapes; production behavior was verified against `Application1` byte-for-byte.

## 1.1.2

Runnable-shell follow-up to 1.1.1: every C# service generated by *Add Service* (and the seeded service from *Create Application*) is now immediately runnable in Visual Studio (F5) and on the command line (`dotnet run`) — no extra hand-editing required.

- **`Properties/launchSettings.json` is generated for every C# kind.** ASP.NET kinds get a profile that opens `http://localhost:8080/api/values` with `ASPNETCORE_ENVIRONMENT=Development`. Non-ASP.NET kinds get a profile that runs the host exe with `DOTNET_ENVIRONMENT=Development` (note: Reliable Services hosts still require FabricHost to register the service runtime — the profile is for VS debugger attach + working-directory setup, not for `dotnet run`).
- **`appsettings.Development.json` is generated for ASP.NET kinds** with `DetailedErrors=true` and verbose `Logging`, mirroring what Visual Studio's *ASP.NET Core* templates emit.
- **ASP.NET `Program.cs` is now dual-mode.** When the host detects it is *not* running inside a Service Fabric cluster (`Fabric_NodeName` env-var unset), it short-circuits to a Kestrel-only `WebApplication.CreateBuilder(args)` host that wires up the same controllers — so `dotnet run` and Visual Studio's *F5 on the C# project* produce a working endpoint immediately. Inside SF the original `ServiceRuntime.RegisterServiceAsync` path is taken, unchanged. State-management dependencies (`StateManager`, Reliable Collections) are not available in the standalone branch — exercise those paths by deploying.
- **`PackageRoot/` shows up in Visual Studio's Solution Explorer.** Generated csprojs now declare `<None Include="$(SfPackageRoot)\ServiceManifest.xml" Link="PackageRoot\ServiceManifest.xml" />` (and the same for `Config\Settings.xml`) so VS renders the manifest + Settings.xml under the C# project node — matching the layout VS's own *Service Fabric Service* template emits — without physically moving the canonical files. The `.sfproj`'s `Package` target keeps reading them from `<App>/ApplicationPackageRoot/<Service>Pkg/` exactly as before.
- **ASP.NET csprojs declare `<None Update="appsettings*.json">`** with `CopyToOutputDirectory=PreserveNewest` and `appsettings.Development.json` nested under `appsettings.json` (`<DependentUpon>`). VS Solution Explorer hides the dev variant inside the parent like every other ASP.NET project.
- **No `.sln` file is generated.** Visual Studio creates one automatically when a user opens a `.sfproj` for the first time, so we deliberately don't ship one — avoiding format-version drift across VS releases. Every artifact required for VS to render the project tree, run F5, deploy to a local cluster, and inner-loop ASP.NET endpoints is now in place at the project level.
- **Remove Service is unchanged in code path** — the existing recursive C# project-folder deletion picks up the new `Properties/` and `appsettings.Development.json` files automatically.
- **Tests:** 222 → 235 (+13). New coverage: `buildLaunchSettingsJson` (ASP.NET + non-ASP.NET shapes, custom port, throws on guest), `buildAspNetAppsettingsDevelopmentJson`, the linked `PackageRoot` ItemGroup + ASP.NET `appsettings*.json` ItemGroup in `buildCsharpCsproj`, dual-mode ASP.NET `Program.cs`, Add+Remove round-trip cleanup of `Properties/launchSettings.json` + `appsettings.Development.json` for ASP.NET, and apply-step assertions for both `applyAddService` and `applyCreateApplication`.

## 1.1.1

Follow-up patch for two gaps shipped in 1.1.0.

- **Add Service / Remove Service are now reachable from the right-click menu.** The 1.1.0 ship lost both menu bindings: `serviceFabric.addService` was missing from `view/item/context` entirely, and neither command was wired into `explorer/context`. They're now contributed in the `9_modify` group on both surfaces — the **Applications** tree's `.sfproj` node and the regular File Explorer for `*.sfproj` files. Command-palette invocation was unaffected. The argument normaliser in `extension.ts` also accepts the raw `vscode.Uri` that `explorer/context` delivers (in addition to the `SfTreeNode` shape the tree uses), so the project is auto-resolved without a second prompt.
- **Remove Service cleans the StartupServices.xml-first wiring.** When the project has a `StartupServices.xml`, *Remove Service* now also strips the matching `<Service>` block and orphan `<Parameter>` declarations from `StartupServices.xml` and from every `StartupServiceParameters/<env>.xml`. Before this fix, an Add+Remove round-trip on a 1.1.0-style project left stale entries pointing at the deleted package, which `Publish-NewServiceFabricApplication` would then attempt to instantiate against a missing service type. Legacy projects without `StartupServices.xml` keep the original `<DefaultServices>`-only cleanup path. The summary log + confirmation modal now report the additional patched files. `RemoveServiceResult` gains `patchedStartupServicesManifest?` and `patchedStartupParameterFiles`. New helper `patchStartupServicesXmlForRemove` mirrors `patchApplicationManifestForRemove`'s `<Service>`-block + orphan-parameter strategy minus the `<ServiceManifestImport>` step.
- **Tests:** 213 → 222 (+9). New coverage: `patchStartupServicesXmlForRemove` (single removal, stateful triplet cleanup, empty-block collapse, no-op, idempotency) and Add+Remove round-trips on stateful, actor, and ASP.NET kinds proving every per-environment `StartupServiceParameters/<env>.xml` is cleaned. Sibling-service preservation and legacy fallback are also covered.

## 1.1.0

Expansion of the scaffolding command surface to match the full Visual Studio *Add → New Service Fabric Service…* matrix and to seed projects ready for self-contained publish.

- **Six service kinds, two runtime axes.** *Add Service* and *Create Application* now offer a 9-item grouped picker mirroring Visual Studio:
  - **.NET Core**: Stateless / Stateful / Actor / Stateless ASP.NET Core / Stateful ASP.NET Core.
  - **.NET Framework**: Stateless / Stateful / Actor.
  - **Hosted Containers and Applications**: Guest Executable.
  Picker uses `vscode.QuickPickItemKind.Separator` to render the three section headers exactly as the VS dialog does.
- **New service-kind scaffolds.**
  - *Actor* emits a `Stateful` service-type with `HasPersistedState="true"`, registers the actor with `ActorRuntime.RegisterActorAsync<T>`, and writes `Interfaces/I<Actor>.cs` plus `<Actor>.cs` (`[StatePersistence(StatePersistence.Persisted)]`, demo `GetCount`/`SetCount` API backed by `StateManager.TryGetStateAsync`/`SetStateAsync`).
  - *ASP.NET Core stateless / stateful* emit an `<Endpoint Name="ServiceEndpoint" Protocol="http" Type="Input" />` in the manifest, a Kestrel-hosted `<Service>.cs`, a `Controllers/ValuesController.cs`, and `appsettings.json`. The csproj adds `Microsoft.ServiceFabric.AspNetCore.Kestrel` and a `<FrameworkReference Include="Microsoft.AspNetCore.App" />`.
  - *Actor* csproj references `Microsoft.ServiceFabric.Actors` (which transitively pulls `.Services` and `.Data`); other kinds keep referencing `.Services` (and `.Data` for stateful).
- **Self-contained publish by default for .NET Core.** Generated csprojs targeting `net8.0` / `net6.0` now include `<SelfContained>true</SelfContained>`, `<RuntimeIdentifier>win-x64</RuntimeIdentifier>`, `<TargetLatestRuntimePatch>true</TargetLatestRuntimePatch>`, `<PublishSingleFile>false</PublishSingleFile>`, `<PublishReadyToRun>false</PublishReadyToRun>`. .NET Framework csprojs (`net472` / `net48`) deliberately omit these props — `net472` always uses the framework-installed runtime. Net result: `dotnet publish -c Release` produces an exe that runs on a clean Service Fabric node without a separately-installed runtime.
- **StartupServices.xml-first wiring.** When the application has a `StartupServices.xml` (every project produced by recent Visual Studio templates does, including those produced by **Create New Application…**), *Add Service* now patches `StartupServices.xml` + the per-environment `StartupServiceParameters/<env>.xml` files and *only* writes the `<Parameter>` declarations + the `<ServiceManifestImport>` block into `ApplicationManifest.xml`. Legacy projects without `StartupServices.xml` keep the original `<DefaultServices>` path. Both paths are idempotent (re-running the same scaffold is a no-op).
- **Create Application now matches the same matrix.** The wizard prompts for kind, runtime, and TFM between the service-name prompt and the apply step; the seeded application gets a kind-correct manifest (stateful/actor get `_TargetReplicaSetSize` / `_MinReplicaSetSize` / `_PartitionCount` parameters and a `<StatefulService>` block; ASP.NET kinds get the HTTP endpoint), and a sibling C# project is generated alongside the `.sfproj` for every C# kind. Defaults preserve the historical *Stateless / .NET Core / net8.0* behaviour byte-for-byte so existing automation still produces the same output.
- **Tests:** baseline 155 → 213 passing. New coverage: kind/runtime predicates (`isAspNetKind`, `isStatefulKind`, `isCsharpKind`, `effectiveRuntime`), new manifest variants, new parameter defaults, `patchApplicationManifestImports` idempotency, `appendDefaultServiceBlock`, `patchStartupServicesXml`, `patchStartupServiceParametersXml`, runtime-aware `resolveCsharpSettings`, all six new builders, self-contained csproj props (netcore vs netfx), and apply-step integration tests for the StartupServices.xml-first decision tree.

## 1.0.0

First stable major release. No new features beyond 0.2.22 — the bump signals API and command-surface stability after the 0.2.x cycle settled the deploy/remove flows, the publish/deploy de-duplication, and the multi-package auto-disambiguation work.

- **Marketplace identifiers finalised.** Manifest now publishes as `sfproj-tools.service-fabric-project-tools-vscode` with display name *Service Fabric Project (sfproj) Tools*. The independent-project disclaimer is added to the README so there is no ambiguity that this is not a Microsoft product.
- **No breaking changes.** Settings keys (`serviceFabric.deploy.packagePath`, `serviceFabric.deploy.promptForApplicationParameters`, `serviceFabric.remove.waitSeconds`, …) are unchanged. Command IDs (`serviceFabric.publish`, `serviceFabric.remove`, `serviceFabric.cluster.*`, …) are unchanged. Existing workspace state survives the upgrade.

## 0.2.22

- **Multi-package output folders — auto-disambiguate by `ApplicationTypeName`.** When more than one `ApplicationManifest.xml` is found under the resolver's candidate roots (typical for monorepos that share an `out\sfpkg\` drop, or for a single configured `<OutputPath>` that hosts several packaged Service Fabric apps), the deploy flow now reads each candidate manifest and silently selects the folder whose `<ApplicationManifest ApplicationTypeName="...">` matches the type declared by the source `.sfproj`'s own manifest. The chosen folder is logged as `Resolved application package root: <path> (via <source> (matched ApplicationTypeName <Name>))` so the choice is auditable.
- **Quick-pick fallback when auto-match cannot decide.** When the source project has no manifest, or none of the candidates declared the expected type, Publish now surfaces a quick-pick listing each candidate folder annotated with its declared `ApplicationTypeName` and absolute path — instead of aborting deploy with a `Multiple ApplicationManifest.xml found` error. Cancelling the picker still aborts and the standard "set `serviceFabric.deploy.packagePath` to disambiguate" message is shown.
- **Resolver internals:** `ProbeFs` gains an optional `readApplicationTypeName` method (regex-based parse — no XML dependency, no allocations). `ResolveOptions` gains `expectedApplicationTypeName` and `onAmbiguous`. The resolver remains pure — the quick-pick lives entirely in `deployFlow.ts` and is fully unit-tested via the hook.

## 0.2.21

- **Removed the `serviceFabric.deploy` command** ("Deploy Application") to eliminate user confusion with `serviceFabric.publish` ("Publish Application…"). The two commands were aliases pointing at the same handler, so dropping one is a no-op behaviourally; `Publish Application…` keeps the `$(rocket)` icon and is the only entry shown in the command palette, the **Applications** view's right-click menu, and the file-explorer context menu for `.sfproj` files. Setting names (`serviceFabric.deploy.packagePath`, `serviceFabric.deploy.promptForApplicationParameters`) keep their existing namespace — they're configuration keys, not commands, so renaming them would be a breaking change for users who already have settings persisted.
- **Walkthrough + HOWTO + setting descriptions** now uniformly say "Publish" where they used to mix "Deploy" and "Publish". Section §8.1 is renamed from "Deploy" to "Publish". Historical CHANGELOG entries are left intact for forensics.

## 0.2.20

- **Deploy auto-pairs `ApplicationParameters` and `StartupServiceParameters` with the chosen publish profile.** Picking `Local.5Node.xml` now deploys with `ApplicationParameters\Local.5Node.xml` *and* `StartupServiceParameters\Local.5Node.xml`; picking `Local.1Node.xml` uses the 1-node pair. Same for `Cloud.xml`. Previously the deploy flow showed a separate quick-pick listing every `ApplicationParameters\*.xml`, inviting the user to mismatch a 5-node profile with 1-node parameters. The verbatim VS-generated `Deploy-FabricApplication.ps1` already reads both `<ApplicationParameterFile Path=...>` and `<StartupServiceParameterFile Path=...>` from the publish profile and forwards them to `Publish-NewServiceFabricApplication`; the prompt was redundant and now defers to that resolution.
- **Pre-flight validation + logging of the paired files.** Deploy parses the publish profile up front, resolves both parameter-file paths to absolutes (relative to the profile's directory), and writes them to the output channel:
  ```
  Publish profile pairs with ApplicationParameterFile: Local.5Node.xml (..\ApplicationParameters\Local.5Node.xml).
  Publish profile pairs with StartupServiceParameterFile: Local.5Node.xml (..\StartupServiceParameters\Local.5Node.xml).
  ```
  Missing files are logged as warnings naming the offending path so a renamed/mismatched profile is obvious before the SDK throws a generic error.
- **New `serviceFabric.deploy.promptForApplicationParameters` setting** (default `false`). Setting it to `true` restores the quick-pick — useful for ad-hoc debug runs where you want to splat custom parameters over the profile's defaults. The picker now pre-selects the file paired with the chosen profile and labels the *do nothing* choice as `(none — use publish profile default)`. The startup-service-parameter file is always taken from the profile (no override path).
- **`PublishProfileSummary` gains `applicationParameterFile` and `startupServiceParameterFile`.** Consumers parsing publish profiles can read both pointers without rolling their own regex. 5 new unit tests cover absent elements, empty `Path` attributes, attribute reordering, and Cloud profiles. Existing pre-flight tests are unchanged.

## 0.2.19

- **`serviceFabric.remove.waitSeconds` default is now `30` (was `60`).** Local dev clusters typically reap an application instance well within ten seconds; thirty is a comfortable margin without making a stuck remove appear hung. Slow remote clusters can still raise the value.
- **HOWTO documents the post-remove wait.** §8.2 is rewritten to describe the strict bottom-up teardown order (replicas → services → application → wait → unregister) added in 0.2.18, and §12's settings table now lists `serviceFabric.remove.waitSeconds` alongside the other deploy/remove settings.

## 0.2.18

- **Fixes "Application type and version is still in use" during Remove Application.** The PowerShell payload now tears the deployment down strictly bottom-up:
  1. **Replicas/instances** — `Get-ServiceFabricPartition` → `Get-ServiceFabricReplica` → `Remove-ServiceFabricReplica -ForceRemove` for every replica/instance under every partition. Evicts stuck replicas so the service-level remove doesn't time out.
  2. **Services** — `Remove-ServiceFabricService -Force -ForceRemove` per service.
  3. **Application instance(s)** — enumerated via `Get-ServiceFabricApplication -ApplicationTypeName`, *not* `-ApplicationName`, so every instance of the type (including ones with custom names) is torn down. A leftover instance is the most common cause of the "still in use" error.
  4. **Wait for cluster eviction** — polls `Get-ServiceFabricApplication -ApplicationTypeName` until empty (or a timeout) before attempting unregister. `Remove-ServiceFabricApplication` is async: it returns once the request is accepted while the cluster is still reaping replicas. Unregistering during that window is exactly what produces "Application type and version is still in use."
  5. **Unregister** every version of the type. When the wait times out the unregister is skipped with a clear warning naming the still-present instances, instead of failing loudly.
- **New `serviceFabric.remove.waitSeconds` setting** (default `60`, minimum `0`). Configures the post-remove polling timeout described above. Set to `0` to skip the wait entirely and accept that unregister may fail; raise it for slow remote clusters where eviction takes longer than a minute.

## 0.2.17

- **Deploy now honours `StartupServices.xml` (modern VS template parity).** The wrapper now threads `-StartupServicesFile <path>` into the verbatim `Deploy-FabricApplication.ps1` whenever `StartupServices.xml` is present at the project root. The VS-generated script in turn passes both `StartupServicesFilePath` and the publish profile's `StartupServiceParameterFile` to `Publish-NewServiceFabricApplication`, so the SDK helper creates the default service instances declared in `<StartupServicesManifest>` after registering the application — exactly like Visual Studio's "Deploy → Service Fabric application" gesture against SF SDK 8.2+ templates. Legacy projects without `StartupServices.xml` continue to work unchanged: the wrapper omits the parameter, only the application type is registered, and an empty application instance is created. The output channel surfaces which path was taken.
- **Remove now deletes services explicitly before tearing down the application.** The remove flow enumerates `Get-ServiceFabricService -ApplicationName` and issues `Remove-ServiceFabricService -Force -ForceRemove` for each one (logged per-service) before invoking `Remove-ServiceFabricApplication -Force`. `Remove-ServiceFabricApplication -Force` already tears services down implicitly; the explicit pre-pass surfaces per-service progress in the output channel and converts a stuck individual service into a tractable warning rather than the generic application-level timeout.
- **Audit of every PowerShell call site for the 0.2.16 client-endpoint fix.** Confirmed `Connect-ServiceFabricCluster -ConnectionEndpoint` is only built from `active.endpoint` in the remove flow (already fixed). Deploy reads `<ClusterConnectionParameters>` from the publish profile, so it never hits the HTTP/TCP port confusion. Cluster start/stop/reset/switch commands invoke the SDK's `DevClusterSetup.ps1`/`CleanCluster.ps1` directly and don't connect to the cluster's client gateway at all.

## 0.2.16

- **Fixes "Could not ping any of the provided Service Fabric gateway endpoints" during Remove Application.** The remove flow was feeding `Connect-ServiceFabricCluster -ConnectionEndpoint` the cluster's HTTP gateway port (`localhost:19080`), but that cmdlet speaks the binary client protocol and expects the TCP client port (`localhost:19000`) — the two are distinct services on distinct ports per the standard cluster manifest. The flow now translates the stored HTTP gateway URL into a `host:19000` client endpoint via a new pure helper before invoking PowerShell, mirroring the `<ClusterConnectionParameters>` defaults that VS's `Deploy-FabricApplication.ps1` relies on. Custom non-default ports are passed through verbatim so operators with bespoke topologies retain control via `serviceFabric.localCluster.endpoint`.
- **Remove Application gains the same pre-flight cluster probe deploy uses (added in 0.2.9).** Before invoking PowerShell the flow hits `/$/GetClusterHealth`; when the local cluster isn't responding the user sees an actionable modal (Start Local Cluster / Continue Anyway) instead of the SDK's misleading "Could not ping…" error coming back as raw output.
- **Remove Application now `Import-Module ServiceFabric -Global` upfront** (parity with the deploy hardening shipped in 0.2.11/0.2.12), with a clearer error when the SDK PowerShell module isn't on `PSModulePath` at all.
- **New `clusterEndpoints.ts` helper.** `httpGatewayToClientEndpoint(httpUrl)` is a pure function (7 unit tests, no I/O) that any future flow needing TCP client connectivity can reuse.

## 0.2.15

- **Docs.** The §12 settings table in the bundled HOWTO now lists every contributed setting, including the previously-undocumented `serviceFabric.deploy.packagePath` (added in 0.2.14) and `serviceFabric.xmlSchemaPath`. §8.1 "Deploy" gains a description of the cluster pre-flight probe (added in 0.2.9) and the prioritized package-path resolution chain (added in 0.2.14), so the inner-loop deploy story is fully discoverable from the offline help guide.

## 0.2.14

- **Deploy now handles arbitrary MSBuild output locations.** The deploy flow probes a prioritized list of candidate package roots before invoking `Deploy-FabricApplication.ps1`, so the SDK never gets pointed at a folder that lacks `ApplicationManifest.xml`. Sources, highest priority first:
  1. New `serviceFabric.deploy.packagePath` setting (workspace string — absolute, or relative to the .sfproj directory).
  2. `<PackageLocation>` declared in the .sfproj.
  3. `<OutputPath>` declared in the .sfproj.
  4. Standard `pkg\<Configuration>\` (with the existing nested `<AppTypeName>` probe from 0.2.13).
  5. `bin\<Configuration>\pkg\` and `bin\<Configuration>\` (common alternative layouts).
  6. Last-resort recursive search under the .sfproj directory (bounded depth 4, skips `node_modules`, `.git`, `obj`, `.vs`, `packages`).
  When multiple candidates contain `ApplicationManifest.xml`, deploy now surfaces a clear error pointing at the new setting for disambiguation.
- **`SfProjFile` model gains optional `outputPath` and `packageLocation` fields.** Reflects what the parser reads out of the .sfproj's `PropertyGroup` elements; consumers other than deploy can use these to follow custom build conventions.

## 0.2.13

- **Fixes "Failed to download application package 'Debug' from the store" during deploy.** The deploy flow now probes the MSBuild output directory and passes the actual application-type root — the folder that *directly* contains `ApplicationManifest.xml` — rather than always passing `pkg\<Configuration>`. Some `.sfproj` configurations output a nested layout (`pkg\Debug\<AppTypeName>\ApplicationManifest.xml`); previously we passed `pkg\Debug` to `Test-ServiceFabricApplicationPackage`, it couldn't find the manifest, and fell back to interpreting the leaf segment (`Debug`) as an image-store path — producing the misleading "Failed to download" error. Direct layouts (`pkg\Debug\ApplicationManifest.xml`) continue to work unchanged. When neither layout matches the deploy now surfaces an actionable error pointing at the build output instead of bouncing through the SDK's confusing message.

## 0.2.12

- **Actually fixes "Cluster connection instance is null" during deploy.** The wrapper now **dot-sources** (`. $DeployScript @splat`) the VS-generated `Deploy-FabricApplication.ps1` instead of `&`-invoking it. The `&` operator runs the script in a child scope; `Connect-ServiceFabricCluster`'s connection state then lived in that child scope, so when `Publish-NewServiceFabricApplication` (a function inside `ServiceFabricSDK.psm1`) called `Test-ServiceFabricClusterConnection`, the connection lookup returned `$null`. Dot-sourcing keeps the connect call and the publish call in the same scope. The VS-generated script's own `.EXAMPLE` block uses dot-sourcing for exactly this reason. The 0.2.11 `Import-Module ServiceFabric -Global` pre-import is retained as belt-and-braces.

## 0.2.11

- **Fixes "Test-ServiceFabricClusterConnection : Cluster connection instance is null" during deploy.** The deploy wrapper now pre-imports the **ServiceFabric** PowerShell module with `-Global` before invoking `Deploy-FabricApplication.ps1`. Without this, `Connect-ServiceFabricCluster`'s auto-load placed `$global:ClusterConnection` in the deploy script's own session state, so the SDK helper module's `Test-ServiceFabricClusterConnection` saw `$null` and failed inside `Publish-NewServiceFabricApplication`. Visual Studio's PowerShell host pre-imports the module into global state implicitly; our spawned `powershell.exe -Command` didn't — now it does. Surfaces a clearer error message when the Service Fabric SDK isn't installed at all.

## 0.2.10

- **Service Fabric Applications view now surfaces `StartupServiceParameters/` and `StartupServices.xml`.** Projects authored against Visual Studio's modern `StartupServicesManifest` template (ProjectVersion 2.6+) get a dedicated **StartupServiceParameters** group with the per-environment parameter files, and the top-level **StartupServices.xml** appears alongside `ApplicationManifest.xml`. Both nodes open the underlying file when clicked. Projects without these artifacts (legacy `<DefaultServices>`-only layout) are unaffected.

## 0.2.9

- **Fix — `Test-ServiceFabricClusterConnection : Cluster connection instance is null`.** The verbatim Visual Studio `Deploy-FabricApplication.ps1` calls `Connect-ServiceFabricCluster` and then `Publish-NewServiceFabricApplication`; the latter aborts with the null-connection error when there is no live cluster. The deploy command now performs a **pre-flight HTTP-gateway probe** before invoking the script:
  - Local profiles (empty `<ClusterConnectionParameters />`) are probed at `http://localhost:19080`. When the cluster isn't responding, deploy surfaces a modal with **Start Local Cluster** / **Continue Anyway** options. Choosing *Start* runs `Service Fabric: Start Local Cluster` and re-probes once before continuing.
  - Remote profiles infer the gateway from `ConnectionEndpoint="host:port"` (swapping the port to `19080`, with `https://` when `X509Credential="true"` or `AadCredential="true"`). Failures show an actionable error and offer **Continue Anyway** for offline scenarios.
- **Friendlier post-mortem.** When the deploy script exits non-zero with output containing `Cluster connection instance is null`, `FabricObjectClosedException`, or `Service Fabric cluster may not be connected`, the failure notification now explains the cause and points at the local-cluster Start command instead of just "see the output channel".
- Internal: `runPowerShell` gained an opt-in `{ capture: true }` mode that accumulates stdout+stderr in addition to streaming to the channel. Used by the deploy and remove flows for post-mortem analysis. **10 new tests** for `parsePublishProfile` and `detectClusterConnectionFailure`; **120/120 tests passing.**

## 0.2.8

- **Create Application now scaffolds the full Visual Studio project layout.** Previously the command emitted a skeleton with only `Local.1Node.xml` profiles and an empty `Scripts/` folder. As of 0.2.8 it produces the same files Visual Studio's "Service Fabric Application" project template creates, so a project bootstrapped here can be opened later in Visual Studio (and projects authored in Visual Studio open here) without manual fix-up:
  - Three publish profiles: `PublishProfiles/{Cloud,Local.1Node,Local.5Node}.xml`. The `Cloud.xml` profile includes the secured `ClusterConnectionParameters` and `UpgradeDeployment` scaffolding VS emits; the local profiles reference both an `ApplicationParameterFile` and a `StartupServiceParameterFile`.
  - Three application parameter files: `ApplicationParameters/{Cloud,Local.1Node,Local.5Node}.xml`, with environment-appropriate instance counts (`Local.5Node` → `3`, others → `1`) that match `Add Service`'s defaults.
  - Three startup-service parameter files: `StartupServiceParameters/{Cloud,Local.1Node,Local.5Node}.xml`, paired with a `StartupServices.xml` at the project root.
  - `packages.config` declaring `Microsoft.VisualStudio.Azure.Fabric.MSBuild` 1.7.6, plus the matching conditional `<Import>` blocks in the `.sfproj`. The hard-error `ValidateMSBuildFiles` target VS emits is intentionally omitted so the project still builds without first running `nuget restore`.
- **`Scripts/Deploy-FabricApplication.ps1` is now generated as the verbatim Visual Studio template.** Previously the directory was created empty, leaving `serviceFabric.deployApplication` to fail with "Deploy-FabricApplication.ps1 not found". The script ships with the full VS parameter contract (`PublishProfileFile`, `StartupServicesFile`, `ApplicationPackagePath`, `[Hashtable] ApplicationParameter`, `OverrideUpgradeBehavior`, `OverwriteBehavior`, `SecurityToken`, `CopyPackageTimeoutSec`, `RegisterApplicationTypeTimeoutSec`, …), reads both `ApplicationParameterFile` and `StartupServiceParameterFile` from the publish profile, and dispatches via splatting to `Publish-NewServiceFabricApplication` / `Publish-UpgradedServiceFabricApplication`.
- **Project model now exposes `startupServiceParameters` and `startupServicesManifest`.** The parser scans `<sfprojDir>/StartupServiceParameters/*.xml` and `<sfprojDir>/StartupServices.xml`, and the file-system watcher refreshes the project on changes to either.
- Internal: pure templates extracted to `src/scaffold/createApplicationTemplates.ts` (with the embedded VS deploy script in `deployFabricApplicationScript.ts`); on-disk apply logic moved to `src/scaffold/createApplicationApply.ts`. **18 new unit tests** for the templates, the apply step, and a parser round-trip; **110/110 tests passing.**

## 0.2.7

- **Fix — Deploy Application now matches the Visual Studio contract for `Deploy-FabricApplication.ps1`.** The previous wrapper passed three arguments the VS-generated script does not accept, so deploy aborted at parameter binding even after the 0.2.6 fix:
  - `-ApplicationParameterFilePath` does not exist on the wrapper script (it belongs to `Publish-NewServiceFabricApplication` internally). The script's `[Hashtable] $ApplicationParameter` is the actual override knob.
  - `-ErrorAction Stop` is rejected because the wrapper script does not declare `[CmdletBinding()]` and so does not accept common parameters.
  - `-DeployOnly:$false` was a no-op (already the default).
- The wrapper now uses splatting (`& $DeployScript @splat`) and only passes `-ApplicationPackagePath` and `-PublishProfileFile`. When the user picks an `ApplicationParameters\*.xml` override, the file is parsed client-side into a hashtable and passed as `-ApplicationParameter @{ Name = 'Value'; … }`, exactly mirroring Visual Studio's deploy semantics.
- Logs now report how many parameters were overridden from the picked file.

## 0.2.6

- **Fix — Deploy Application failed with `BadExpression: The expression after '&' in a pipeline element produced an object that was not valid.`** Caused by `runPowerShell` passing parameters as `-Name Value` arguments after `-Command <script>`, which `powershell.exe` does not bind into `$Name` variables. The wrapper script's `& "$DeployScript"` therefore evaluated to `& ""` and aborted before contacting the cluster. Parameters are now prepended to the script body as `$Name = '<literal>'` declarations (with single-quote escaping, boolean and number support, and identifier validation).
- The same bug silently affected **Remove Application** — it is fixed in the same change.

## 0.2.5

- **XSD-driven manifest validation.** When the Service Fabric SDK is installed locally, the extension now discovers `ServiceFabricServiceModel.xsd` (probed at `C:\Program Files\Microsoft SDKs\Service Fabric\schemas\` and the `Microsoft Service Fabric\bin\Fabric\Fabric.Code\` fallback) and registers it with `redhat.vscode-xml` for `ApplicationManifest.xml` and `ServiceManifest.xml`. This replaces the previous namespace-only registration, which produced spurious "Element type … must be declared" warnings when a strict XML validator was running.
- New setting **`serviceFabric.xmlSchemaPath`** — override the discovered location. Accepts a folder containing the schema or a direct `.xsd` path.
- When the SDK is not installed, the extension logs an actionable hint on the **Service Fabric** output channel and falls back to the in-house diagnostics (`SFD001`–`SFD004`).

## 0.2.4

- **Remove Service… now performs full cleanup.** When a service was originally created with the Add Service C# scaffold, Remove Service additionally:
  - Strips the matching `<ProjectReference>` from the `.sfproj` and collapses an emptied `<ItemGroup>`.
  - Deletes the generated sibling `<ServiceName>/` folder (`Program.cs`, `<Service>.cs`, `<Service>.csproj`, and any build output produced under it).
  - Detection is conservative — only `.csproj` files containing `<IsServiceFabricServiceProject>true</IsServiceFabricServiceProject>` AND whose `<SfPackageRoot>` resolves to the package being removed are eligible. User-authored project references and hand-written code are left strictly untouched.
- The destructive-action confirmation modal now enumerates every artifact that will be deleted (package folder, companion C# project folder, `.sfproj` patch, application manifest, parameters files), and the service picker shows a `companion: <Service>.csproj` hint when a generated project exists.

## 0.2.3

- **Add New Service…** is no longer a manifest-only shell — it now closes the friction gap with Visual Studio's *Add → New Service Fabric Service…*:
  - **Stateless / stateful (C#)** — in addition to the manifest scaffold, a sibling `<ServiceName>/` folder is created next to the `.sfproj`'s directory containing an SDK-style `<ServiceName>.csproj` (with `Microsoft.ServiceFabric.Services` / `Microsoft.ServiceFabric.Data` package references and an `AfterTargets="Build"` target that copies build output into `ApplicationPackageRoot/<Service>Pkg/Code/`), a `Program.cs` that calls `ServiceRuntime.RegisterServiceAsync`, and a minimal `StatelessService` / `StatefulService` derivation. The new project is wired into the `.sfproj` via `<ProjectReference>`. Target framework is selectable (`net8.0` / `net6.0` / `net472`).
  - **Guest executable** — a new kind in the picker. Prompts for either a single binary or a folder of payload files, copies it into the service's `Code/`, and emits a manifest with `UseImplicitHost="true"` plus optional `<Arguments>` and `<WorkingFolder>`.
  - Default-service block, parameter declarations, and per-environment parameter values are wired correctly for all three kinds.
  - Refuses to scaffold over an existing sibling C# project folder.

## 0.2.2

- **Remove Service…** is now implemented — picker for any service-manifest package in the application, then on disk: removes the matching `<ServiceManifestImport>`, every `<Service>` block whose `ServiceTypeName` is declared in that package, drops orphaned `<Parameter>` declarations (parameters still referenced by other services are left alone), patches every `ApplicationParameters/*.xml` to drop the matching values, and finally deletes the `<Service>Pkg/` folder. Confirmation respects `serviceFabric.confirmDestructiveActions`. Available from the command palette and the `.sfproj` tree context menu.

## 0.2.1

- **Add New Service…** is now fully implemented — picker for stateless / stateful, scaffolds `ApplicationPackageRoot/<Service>Pkg/{ServiceManifest.xml, Code/, Config/Settings.xml}`, patches `ApplicationManifest.xml` (parameters + import + default-service block), and updates every `ApplicationParameters/*.xml` with environment-appropriate defaults (1-node vs 5-node). Available from the command palette and the `.sfproj` tree context menu.

## 0.2.0

### Phase 7 — Debugging glue

- New command **Service Fabric: Attach Debugger to Deployed Service…** resolves the host PID via SF REST (`/Nodes/{n}/$/GetApplications/{id}/$/GetCodePackages`) and starts an attach session against the chosen runtime.
- New `servicefabric` debug type with `initialConfigurations` and `configurationSnippets` for `launch.json`.
- `DebugConfigurationProvider` resolves an `attach` request by deferring to the picker.
- Tree action: right-click any deployed application in the Cluster view → **Attach Debugger…**.
- New REST helpers `getApplicationNodes()` and `getDeployedCodePackages()`.

### Phase 8 — Diagnostics & polish

- New command **Service Fabric: Show Diagnostic Events** opens a webview polling `/EventsStore/Cluster/Events`.
- Opt-in local telemetry (`serviceFabric.telemetry.enabled`, default `false`); events are logged to the output channel at debug verbosity. No data is transmitted off-machine. Honors VS Code's `telemetry.telemetryLevel`.
- First-run **Get Started** walkthrough with four steps (open project → start cluster → build/deploy → attach debugger).
- Marketplace assets: 128×128 icon, repository field, expanded README with feature list and telemetry disclosure.
- `serviceFabric.hasProject` context key drives walkthrough completion + future "when" clauses.
- Bundled offline how-to guide (`docs/HOWTO.md`); new command **Service Fabric: Open Help Guide** opens it in a markdown preview. Surfaced via the book icon on both view title bars, the empty-view welcome links, and a final walkthrough step. Also fixed `getDeployedCodePackages()` to handle the bare-array response shape returned by the SF gateway.

## 0.1.1

- Fixed cluster health probe parsing (`AggregatedHealthState` → `aggregatedHealthState`); status bar and tree now show real health.
- Added 5-node test cluster support: new `serviceFabric.localCluster.nodeCount` setting (`"1"` | `"5"`, default `"5"`).
- `Start Local Cluster` and `Reset Local Cluster` now prompt for 1-node vs 5-node mode (pre-selecting the configured default).
- New command `Service Fabric: Switch Local Cluster Mode (1-node ↔ 5-node)…` recreates the cluster in the chosen topology and persists the selection.
- Cluster tree now exposes `Nodes (N)` and `Applications (N)` folders, displaying topology, status, and health per node.
- Status bar shows live mode (`SF: Local Cluster (5-node)`), aggregated health, node count, and app count in the tooltip.
- New REST helper `getNodes()` (`/Nodes` endpoint).

## 0.1.0 (unreleased)

- Initial scaffold (Phase 0).
- Project recognition + tree view (Phase 1).
- Manifest XML schema associations + cross-file diagnostics (Phase 2).
- MSBuild task provider for Build / Rebuild / Clean / Package (Phase 3).
- Cluster connection store + status bar + local cluster commands (Phase 4).
- Deploy / Remove flows via Service Fabric SDK PowerShell modules (Phase 5).
