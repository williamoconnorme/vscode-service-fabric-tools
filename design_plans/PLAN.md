# VS Code Extension — Service Fabric Project (`.sfproj`) Support

> Implementation plan for a Visual Studio Code extension that delivers
> Visual Studio-equivalent authoring, build, debug, package, and deploy
> support for Service Fabric Application projects (`.sfproj`).

---

## 1. Executive Summary

Visual Studio supports Service Fabric Applications through a dedicated
project system (`Microsoft.VisualStudio.Azure.Fabric.MSBuild`) that
ships `.sfproj` MSBuild logic, an ApplicationManifest/ServiceManifest
designer, PowerShell-based packaging and deployment scripts, and
integration with Azure Service Fabric SDK tooling. None of this is
available in Visual Studio Code today — `.sfproj` files are treated as
opaque XML and the `dotnet` CLI cannot build them.

This plan describes a VS Code extension — working title
**`vscode-service-fabric`** — that closes the gap by providing:

- Recognition of `.sfproj` files as first-class workspace projects.
- An Explorer-style tree of the application package
  (`ApplicationManifest.xml`, services, code/config/data packages).
- Build, Package, Deploy, Upgrade, Remove, and Publish commands that
  shell out to MSBuild + the Service Fabric SDK PowerShell modules.
- Schema-driven editing, diagnostics, IntelliSense, and quick fixes
  for `ApplicationManifest.xml` and `ServiceManifest.xml`.
- Cluster connection management (local dev cluster + remote clusters
  via PublishProfiles) with status bar indicators.
- Templates and code generation for new applications, services, and
  parameter / publish profiles.
- Debugging glue that attaches to running service host processes.

The extension targets parity with the Visual Studio "Service Fabric
Tools" experience while staying within VS Code idioms (commands,
contributions, Tree/Custom editors, Tasks, Debug adapters).

---

## 2. Goals and Non-Goals

### 2.1 Goals (MVP → GA)

1. **Project recognition** for `.sfproj` and the surrounding solution
   structure (`.sln`, `ApplicationPackageRoot/`, `Scripts/`,
   `PublishProfiles/`, `ApplicationParameters/`).
2. **Tree view** mirroring VS's Solution Explorer node layout.
3. **Build & Package** via MSBuild (`msbuild /t:Package`) with
   problem-matcher integration.
4. **Local cluster lifecycle** (start / stop / reset / connect) on
   Windows where the Service Fabric SDK is installed.
5. **Deploy / Upgrade / Remove** application against connected
   cluster, using the SDK's `Deploy-FabricApplication.ps1` flow.
6. **Manifest editing**: XML schema validation, completion, hover,
   go-to-definition between `ApplicationManifest.xml` →
   `ServiceManifest.xml` → `Settings.xml`/endpoints.
7. **Publish profiles** create / edit / select with secure parameter
   handling.
8. **Templates**: new application, new stateless / stateful /
   actor / guest-executable / container service.
9. **Debugging**: attach configurations for managed and native
   service hosts; remote diagnostics via ETW/EventFlow log channel.
10. **Cross-platform awareness**: full feature set on Windows;
    graceful degradation on macOS/Linux (build + manifest editing
    only, since the SDK is Windows-centric).

### 2.2 Non-Goals

- Replacing or re-implementing MSBuild or the Service Fabric runtime.
- Shipping a managed Service Fabric SDK; the extension *requires*
  the user-installed SDK on Windows for deployment features.
- Supporting Service Fabric Mesh (deprecated) or Azure Service
  Fabric Managed Clusters control-plane operations (out of scope —
  use the Azure CLI / Bicep extensions).
- Kubernetes / AKS workflows.

---

## 3. Background

### 3.1 What `.sfproj` Is

`.sfproj` is an MSBuild project file. A minimal example:

```xml
<Project Sdk="Microsoft.NET.Sdk" ToolsVersion="15.0">
  <PropertyGroup>
    <ProjectGuid>{...}</ProjectGuid>
    <ProjectVersion>2.7</ProjectVersion>
    <TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion>
    <ApplicationPackageRootFolder>ApplicationPackageRoot</ApplicationPackageRootFolder>
  </PropertyGroup>
  <ItemGroup>
    <None Include="ApplicationPackageRoot\ApplicationManifest.xml" />
    <None Include="PublishProfiles\Local.1Node.xml" />
    <None Include="ApplicationParameters\Local.1Node.xml" />
    <None Include="Scripts\Deploy-FabricApplication.ps1" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\Stateless1\Stateless1.csproj" />
  </ItemGroup>
  <Import Project="$(MSBuildExtensionsPath32)\Microsoft\VisualStudio\v$(VisualStudioVersion)\Service Fabric Tools\Microsoft.VisualStudio.Azure.Fabric.ApplicationProject.targets" />
</Project>
```

Key facts:

- Targets file lives under `Program Files (x86)\Microsoft Visual
  Studio\…\MSBuild\Microsoft\VisualStudio\v17.0\Service Fabric Tools\`.
- It defines `Package`, `Deploy`, `Publish`, `Upgrade`, `Remove`
  targets that orchestrate copying code/config/data packages into
  `pkg/<Configuration>/` and invoking the SDK's PowerShell modules
  (`ServiceFabricSDK.psm1`, `Microsoft.ServiceFabric.Powershell.dll`).
- Application & Service manifests are XSD-validated XML
  (`ServiceFabricServiceModel.xsd`).
- Project references to service `.csproj` files are followed so each
  service's build output and `ServiceManifest.xml` flow into the
  package.

### 3.2 Visual Studio Experience We Are Mirroring

| VS Feature                                       | VS Code Equivalent We Will Build              |
|--------------------------------------------------|-----------------------------------------------|
| Solution Explorer tree of the sfproj             | `TreeDataProvider` (Activity Bar view)        |
| New Service Fabric Application wizard            | Command + multi-step `QuickPick` + templates  |
| Add → New Service Fabric Service                 | Command + template scaffolding                |
| ApplicationManifest XML designer                 | Schema-backed XML LS + custom commands        |
| Publish… dialog                                  | Webview or multi-step `QuickPick`             |
| Connect to Local/Remote Cluster                  | Command + status bar item + secret storage    |
| Right-click → Package / Deploy / Remove          | Tree context menu commands → tasks            |
| Cluster Manager view                             | Webview backed by SF REST/PowerShell          |
| Diagnostic Events viewer                         | Webview tailing ETW / EventFlow output        |
| Debug → Attach to service host                   | `launch.json` snippets + debug providers      |

### 3.3 Pre-existing VS Code Building Blocks We Will Reuse

- **Red Hat XML extension** (`redhat.vscode-xml`) for XSD-driven
  validation/completion. We contribute schema associations rather
  than ship a new language server.
- **PowerShell extension** (`ms-vscode.PowerShell`) for editing the
  Deploy scripts.
- **C# Dev Kit / C#** (`ms-dotnettools.csharp`) for service code.
- **MSBuild** — invoked, not bundled. MSBuild is available
  independently of the Visual Studio IDE through any of:
  - The **.NET SDK** (`dotnet msbuild`), cross-platform.
  - **Build Tools for Visual Studio** (free standalone installer,
    Windows-only) with the *Azure development* workload, which
    additionally installs the Service Fabric Tools targets file
    and SDK PowerShell modules.
  The full Visual Studio IDE is **not** a prerequisite. However
  the `.sfproj` targets file and the SF SDK modules are only
  distributed inside the *Azure development* workload of the VS
  IDE / VS Build Tools — both of which are Windows-only. See
  §10 for the cross-platform implications.
- **VS Code Tasks API**, **Debug API**, **Custom Editor API**,
  **Tree View API**, **Authentication API**, **Secret Storage API**.

---

## 4. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      VS Code Extension Host                     │
│                                                                 │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ Project System │  │  Manifest Lang   │  │  Cluster Mgmt   │  │
│  │   (sfproj)     │  │   contributions  │  │   service       │  │
│  └───────┬────────┘  └────────┬─────────┘  └────────┬────────┘  │
│          │                    │                     │           │
│  ┌───────▼────────┐  ┌────────▼─────────┐  ┌────────▼────────┐  │
│  │  Tree Provider │  │  Schema registry │  │ Connection store│  │
│  │  + decorations │  │  (XSD bundle)    │  │ (SecretStorage) │  │
│  └───────┬────────┘  └──────────────────┘  └────────┬────────┘  │
│          │                                          │           │
│  ┌───────▼─────────────────────────────────────────▼────────┐   │
│  │                Task / Process Orchestrator              │   │
│  │  - MSBuild runner   - PowerShell host   - SF REST client│   │
│  └───────┬─────────────────────────────────────────────────┘   │
└──────────┼──────────────────────────────────────────────────────┘
           │
   ┌───────▼────────┐    ┌──────────────────┐    ┌────────────────┐
   │  MSBuild.exe / │    │  pwsh / Windows  │    │ Service Fabric │
   │ dotnet msbuild │    │   PowerShell     │    │ HTTP Gateway   │
   └────────────────┘    └──────────────────┘    └────────────────┘
```

**Core principles**

- **Thin extension, fat tools.** We do not re-implement build or
  packaging. Every action ultimately becomes an MSBuild target
  invocation, a PowerShell script call, or a REST request.
- **Workspace-aware, multi-root safe.** Every API takes the owning
  `WorkspaceFolder` so multiple `.sfproj`s coexist.
- **Stateless commands.** All state lives in
  `ExtensionContext.workspaceState` / `globalState` /
  `SecretStorage`; no module-level singletons holding cluster
  credentials.
- **Cancellation everywhere.** All long-running operations accept
  `CancellationToken` and surface progress through
  `withProgress({ location: Notification })`.

---

## 5. Feature Breakdown

### 5.1 Project Discovery & Tree View

- **Discovery**: `vscode.workspace.findFiles('**/*.sfproj')` on
  activation + `FileSystemWatcher` for live changes.
- **Parser**: lightweight XML reader (`fast-xml-parser`) to extract
  `ProjectGuid`, `ApplicationPackageRootFolder`,
  `ProjectReference`, and `Import` paths. Cached per file with a
  content hash.
- **Tree nodes** (top-down):
  1. Application node (named after `ApplicationManifest.xml`'s
     `ApplicationTypeName`).
  2. `ApplicationPackageRoot/` virtual folder.
     - `ApplicationManifest.xml` (validated, badge if errors).
     - One node per `ApplicationPackageRoot/<ServiceTypeName>Pkg/`:
       - `ServiceManifest.xml`.
       - `Code/`, `Config/`, `Data/` subfolders.
  3. `ApplicationParameters/` (one node per `*.xml`).
  4. `PublishProfiles/` (one node per `*.xml`, active profile
     decoration).
  5. `Scripts/` (Deploy/Undeploy PS1s).
  6. `References/` — service `ProjectReference`s, click → open
     `.csproj`.
- **Decorations**: error/warning badges from diagnostics, "active
  publish profile" badge, "deployed" indicator when cluster
  reports the application as installed.
- **Context menu** entries map to commands defined in §5.4.

### 5.2 Manifest Language Support

- Bundle the official XSDs:
  - `ServiceFabricServiceModel.xsd`
  - `ServiceFabricApplicationParameters.xsd`
  - `ServiceFabricPublishProfile.xsd`
- On activation, contribute schema associations to
  `redhat.vscode-xml` via its `xml.fileAssociations` setting using
  the workspace `configurationDefaults` mechanism *and* via
  `vscode-xml`'s extension API (`getApi().addXMLFileAssociation`).
- Provide cross-file features ourselves (XML LS does not know about
  semantics):
  - **Definition provider**: `ServiceManifestRef@Name` →
    `ServiceManifest.xml` `ServiceManifest@Name`.
  - **Reference provider**: parameter usage across application +
    parameter files.
  - **Code actions**:
    - "Add parameter to ApplicationManifest".
    - "Promote literal to parameter".
    - "Add missing endpoint reference".
    - "Sync version with ServiceManifest".
  - **Hover**: parameter resolved value per active profile.
  - **Diagnostics** (in-house, not duplicated by XSD):
    - Parameter declared but unused.
    - Parameter referenced but undeclared.
    - Version mismatch between Application/Service manifests and
      `.sfproj` `ApplicationTypeVersion`.
    - Endpoint declared in `ServiceManifest` but missing in
      `Code\Settings.xml` policies.

### 5.3 Build, Package, and Clean

- Implement a `TaskProvider` for the `servicefabric` task type:

```jsonc
{
  "type": "servicefabric",
  "project": "MyApp/MyApp.sfproj",
  "target": "Package",          // Build | Rebuild | Package | Publish | Clean
  "configuration": "Debug",     // Debug | Release
  "platform": "x64",
  "publishProfile": "PublishProfiles/Local.1Node.xml" // Publish only
}
```

- Resolve the MSBuild executable in this order:
  1. Setting `serviceFabric.msbuildPath`.
  2. `vswhere.exe -find MSBuild\\**\\Bin\\MSBuild.exe` on Windows.
  3. `dotnet msbuild` (works only when targets file is locatable).
- Surface a problem matcher
  (`$msCompile` plus a custom matcher for SF's `pkg validation`
  warnings emitted as `warning : SFC1234: …`).
- Provide command **Service Fabric: Package Application** that
  creates / runs the appropriate task.

### 5.4 Cluster Connections

- **Connection model** stored per workspace:
  ```ts
  interface ClusterConnection {
    id: string;
    label: string;
    endpoint: string;            // tcp://… or https://…:19080
    kind: 'local' | 'remote';
    auth:
      | { type: 'none' }
      | { type: 'windows' }
      | { type: 'x509'; thumbprint: string; storeLocation: string }
      | { type: 'aad';  tenantId: string; clusterAppId: string };
  }
  ```
- Credentials and AAD tokens live in `SecretStorage`. Thumbprints
  are not secret; private keys never leave the user's cert store.
- Commands:
  - `serviceFabric.cluster.connect`
  - `serviceFabric.cluster.disconnect`
  - `serviceFabric.cluster.selectActive`
  - `serviceFabric.cluster.startLocal` / `stopLocal` / `resetLocal`
- **Status bar** item shows active connection and click-target to
  switch.

### 5.5 Deploy / Upgrade / Remove / Publish

- `Deploy` (dev inner loop): runs `Scripts\Deploy-FabricApplication
  .ps1` with the selected publish profile. Streams output to a
  dedicated `OutputChannel` (`Service Fabric`).
- `Publish` (full flow): multi-step UI lets the user pick:
  1. Publish profile (or create one).
  2. Target cluster connection.
  3. Application parameter file.
  4. Upgrade mode: `None` / `Monitored` / `UnmonitoredAuto` /
     `UnmonitoredManual`.
  5. Optional: register application type only.
- `Upgrade`: convenience over Publish with upgrade mode forced.
- `Remove`: invokes `Remove-ServiceFabricApplication` +
  `Unregister-ServiceFabricApplicationType`.
- All flows confirm before destructive ops and respect a workspace
  setting `serviceFabric.confirmDestructiveActions`.

### 5.6 Templates / Scaffolding

- Embed templates as files under `templates/` in the extension
  (no Yeoman dependency). Each template ships a
  `template.json` describing prompts & token replacements (similar
  to `dotnet new` template engine, simplified).
- Commands:
  - **Service Fabric: Create New Application**
  - **Service Fabric: Add New Service…** with sub-templates:
    - Stateless Service (.NET)
    - Stateful Service (.NET)
    - Actor Service (.NET)
    - Guest Executable
    - Container
- After scaffolding, the extension automatically:
  - Adds a `<ProjectReference>` (and `ServiceManifestImport`) to
    the `.sfproj` and `ApplicationManifest.xml`.
  - Copies the `ServiceManifest.xml` into
    `ApplicationPackageRoot/<ServiceName>Pkg/`.
  - Updates the tree view.

### 5.7 Debugging

- Contribute `launch.json` snippets that wrap the existing
  `coreclr` / `clr` debug type with the right `processName`
  filters (`<ServiceName>.exe` for managed, `FabricGuestSvc.exe`
  for guest exes).
- A `DebugConfigurationProvider` resolves
  `${command:serviceFabric.pickServiceProcess}` to the PID by
  querying the local cluster's running replicas.
- Out of scope for MVP: launching services standalone outside the
  cluster (Visual Studio does not really support this either).

### 5.8 Diagnostic Events / Logs

- Phase 2 webview that tails:
  - Local cluster: `%LOCALAPPDATA%\\Microsoft\\Service Fabric\\log
    \\Traces\\` ETL files via `tracerpt` or PerfView.
  - Remote cluster: REST `EventsStore` API.
- Filterable by service / partition / replica.

### 5.9 Settings (`contributes.configuration`)

| Setting                                          | Default     | Purpose                                |
|--------------------------------------------------|-------------|----------------------------------------|
| `serviceFabric.msbuildPath`                      | `""`        | Override MSBuild discovery             |
| `serviceFabric.sdkPath`                          | `""`        | Override SDK discovery                 |
| `serviceFabric.powerShell.executable`            | auto        | `pwsh` vs `powershell`                 |
| `serviceFabric.activeClusterId`                  | `""`        | Currently selected cluster             |
| `serviceFabric.activePublishProfile`             | per-project | Default profile for publish            |
| `serviceFabric.confirmDestructiveActions`        | `true`      | Confirm Remove/Reset                   |
| `serviceFabric.tree.showDeploymentStatus`        | `true`      | Poll cluster for deployment badges     |
| `serviceFabric.diagnostics.enableManifestRules`  | `true`      | Toggle in-house manifest diagnostics   |
| `serviceFabric.logLevel`                         | `info`      | `error` / `warn` / `info` / `debug`    |

### 5.10 Commands (Public Surface)

All commands are namespaced under `serviceFabric.*`. They appear in
the Command Palette filtered by activation context (`sfproj` in
workspace, `Windows`, etc.).

---

## 6. Tech Stack

- **Language**: TypeScript 5.x, `strict` mode on.
- **Bundler**: `esbuild` (single `dist/extension.js` for fast
  activation).
- **Target**: VS Code engine `^1.90.0`, Node 20 (matches current
  VS Code Electron runtime).
- **Test runner**: `@vscode/test-cli` + Mocha for integration;
  `vitest` for pure unit tests.
- **Lint/format**: ESLint flat config + `@typescript-eslint`,
  Prettier.
- **Key npm dependencies**:
  - `fast-xml-parser` — manifest parsing.
  - `xml2js` only if we need writing with format preservation
    (TBD; prefer text-edit based mutations).
  - `node-powershell` or hand-rolled child-process wrapper for
    PowerShell invocation (we will roll our own to avoid abandoned
    deps).
  - `axios` (or built-in `undici`) for SF REST.
  - `semver` for manifest version logic.
  - `@vscode/extension-telemetry` (opt-in only).

---

## 7. Repository Layout

```
VS_Code_SfProj/
├─ PLAN.md                     ← (this file)
├─ README.md
├─ CHANGELOG.md
├─ LICENSE
├─ package.json                ← extension manifest
├─ tsconfig.json
├─ esbuild.config.mjs
├─ .vscode/
│  ├─ launch.json              ← Extension Development Host
│  └─ tasks.json
├─ .vscodeignore
├─ assets/
│  ├─ icons/                   ← tree + activity bar SVGs
│  └─ schemas/                 ← bundled XSDs
├─ media/                      ← webview HTML/CSS/JS
├─ templates/
│  ├─ application/
│  ├─ stateless-service/
│  ├─ stateful-service/
│  ├─ actor-service/
│  ├─ guest-executable/
│  └─ container/
├─ src/
│  ├─ extension.ts             ← activate / deactivate
│  ├─ logging.ts
│  ├─ telemetry.ts
│  ├─ project/
│  │  ├─ sfprojModel.ts
│  │  ├─ sfprojParser.ts
│  │  ├─ projectWatcher.ts
│  │  └─ applicationManifest.ts
│  ├─ tree/
│  │  ├─ applicationTreeProvider.ts
│  │  └─ nodes/
│  ├─ language/
│  │  ├─ schemaRegistry.ts
│  │  ├─ definitionProvider.ts
│  │  ├─ codeActionProvider.ts
│  │  └─ diagnostics.ts
│  ├─ build/
│  │  ├─ msbuildLocator.ts
│  │  ├─ taskProvider.ts
│  │  └─ problemMatchers.ts
│  ├─ cluster/
│  │  ├─ connectionStore.ts
│  │  ├─ localCluster.ts
│  │  ├─ remoteCluster.ts
│  │  ├─ powerShellHost.ts
│  │  └─ sfRestClient.ts
│  ├─ deploy/
│  │  ├─ deployFlow.ts
│  │  ├─ publishFlow.ts
│  │  ├─ upgradeFlow.ts
│  │  └─ removeFlow.ts
│  ├─ debug/
│  │  ├─ debugConfigProvider.ts
│  │  └─ processPicker.ts
│  ├─ scaffold/
│  │  ├─ templateEngine.ts
│  │  └─ projectMutations.ts
│  ├─ ui/
│  │  ├─ statusBar.ts
│  │  ├─ webviews/
│  │  └─ multiStepInput.ts
│  └─ util/
│     ├─ async.ts
│     ├─ fs.ts
│     └─ xmlText.ts
└─ test/
   ├─ unit/
   └─ integration/
```

---

## 8. Implementation Phases

The plan is staged so each phase delivers user-visible value and is
independently shippable.

### Phase 0 — Bootstrap (foundation)

- `npm` workspace, `package.json` manifest skeleton, esbuild,
  ESLint, CI pipeline (GitHub Actions: `lint`, `unit`, `vsce
  package`).
- `extension.ts` activation on `workspaceContains:**/*.sfproj`.
- Output channel + structured logger.
- Smoke test in Extension Development Host.

**Exit criteria**: extension installs from `.vsix`, activates on
opening a folder containing a `.sfproj`, prints a log line.

### Phase 1 — Project Recognition & Tree

- `sfprojParser`, `applicationManifest` model.
- `applicationTreeProvider` with read-only nodes.
- File icons via `contributes.iconThemes` (or
  `resourceLanguageId`).
- Open file on click; reveal-in-tree command.

**Exit criteria**: opening any sfproj-bearing workspace shows the
full tree matching VS's layout for the official samples
(`Voting`, `WordCount`, `MeshHelloWorld` legacy).

### Phase 2 — Manifest Language Layer

- Bundle XSDs, register associations with
  `redhat.vscode-xml` (declared as an extension dependency in
  `extensionDependencies`).
- Implement Definition / Reference / Hover / CodeAction providers.
- Implement custom diagnostics (rule engine).
- Tests: golden-file diagnostics on a fixture set.

**Exit criteria**: red squiggles for missing parameters,
F12-navigation between manifests works, "Promote literal to
parameter" code action functional.

### Phase 3 — Build & Package

- `msbuildLocator`, `taskProvider`, problem matcher.
- Commands: Build, Rebuild, Clean, Package.
- Convert Tree context-menu entries.
- Cancellation through `Task.execution.kill()`.

**Exit criteria**: right-click sfproj → Package produces
`pkg/Debug/` identical (byte-for-byte where deterministic) to
Visual Studio output for the same source.

### Phase 4 — Cluster Connections & Local Cluster

- `connectionStore` with secret handling.
- Local cluster start/stop/reset by invoking
  `WindowsFabricRuntime\\…\\DevClusterSetup.ps1`.
- Status bar item.
- REST client for `/$/GetClusterHealth` to drive status.

**Exit criteria**: user can start the local cluster, connect, and
see green health in the status bar; AAD-secured remote cluster
connect works end-to-end.

### Phase 5 — Deploy / Publish / Upgrade / Remove

- `powerShellHost` (long-lived `pwsh` child) with structured I/O.
- Multi-step Publish flow.
- Application type registration / unregistration.
- Per-target progress + cancellation.

**Exit criteria**: matches VS's *Publish…* dialog functionally for
both local and AAD-secured clusters.

### Phase 6 — Templates & Scaffolding

- Template engine (token replace + post-actions).
- Six initial templates.
- Mutation utilities that edit `.sfproj` and
  `ApplicationManifest.xml` while preserving XML formatting (use
  text-range edits, not full re-serialisation).

**Exit criteria**: `Add New Service → Stateless` produces a
buildable, deployable application equivalent to VS's template.

### Phase 7 — Debugging Glue

- DebugConfigurationProvider, process picker.
- Snippets for `launch.json`.
- Documentation page.

**Exit criteria**: F5-attach to a running stateless service hits a
breakpoint.

### Phase 8 — Diagnostics & Polish

- Diagnostic Events webview.
- Telemetry (opt-in).
- Walkthrough (`contributes.walkthroughs`) for first-run.
- Documentation site under `docs/` (VitePress or plain Markdown).
- Marketplace listing + icon + screenshots.

**Exit criteria**: GA release on the VS Code Marketplace.

---

## 9. `package.json` Contribution Sketch

```jsonc
{
  "name": "vscode-service-fabric",
  "displayName": "Service Fabric Tools",
  "publisher": "<TBD>",
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Programming Languages", "Azure", "Other"],
  "activationEvents": [
    "workspaceContains:**/*.sfproj",
    "onCommand:serviceFabric.createApplication"
  ],
  "extensionDependencies": ["redhat.vscode-xml"],
  "extensionPack": [],
  "contributes": {
    "languages": [
      { "id": "sfproj", "extensions": [".sfproj"], "aliases": ["Service Fabric Project"] }
    ],
    "grammars": [
      { "language": "sfproj", "scopeName": "text.xml", "path": "./syntaxes/xml.tmLanguage.json" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "serviceFabric", "title": "Service Fabric", "icon": "assets/icons/sf.svg" }
      ]
    },
    "views": {
      "serviceFabric": [
        { "id": "serviceFabric.applications", "name": "Applications" },
        { "id": "serviceFabric.clusters",     "name": "Clusters" }
      ]
    },
    "commands": [ /* see §5.10 */ ],
    "menus": {
      "view/item/context": [ /* package, deploy, remove, … */ ],
      "explorer/context":  [ /* "Service Fabric: Package" on .sfproj */ ]
    },
    "taskDefinitions": [
      {
        "type": "servicefabric",
        "required": ["project", "target"],
        "properties": {
          "project":        { "type": "string" },
          "target":         { "type": "string", "enum": ["Build","Rebuild","Clean","Package","Publish"] },
          "configuration":  { "type": "string" },
          "platform":       { "type": "string" },
          "publishProfile": { "type": "string" }
        }
      }
    ],
    "configuration": { /* see §5.9 */ },
    "jsonValidation": [
      { "fileMatch": "*.sfproj", "url": "./assets/schemas/sfproj.json" }
    ]
  }
}
```

---

## 10. Cross-Platform Strategy

**Bottom line:** the full inner loop (build → package → deploy →
debug) is **Windows-only**, because the Service Fabric Tools
targets file and SDK PowerShell modules are only distributed via
the *Azure development* workload of Visual Studio / VS Build
Tools, which is a Windows-only payload. macOS/Linux support is
limited to authoring (XML editing, validation, scaffolding,
project browsing).

This is not a constraint imposed by MSBuild itself — `dotnet
msbuild` would happily run a `.sfproj` on Linux **if** the SF
targets and SDK were present, but Microsoft does not ship them
for those platforms. Until that changes, parity with Visual
Studio's experience implies a Windows host.

### 10.1 Supported Host Matrix

| Capability                                | Windows + SF Tools workload | macOS  | Linux  |
|-------------------------------------------|-----------------------------|--------|--------|
| Recognise `.sfproj`, tree view            | ✅                          | ✅     | ✅     |
| Manifest XML editing / validation         | ✅                          | ✅     | ✅     |
| Code actions, cross-file diagnostics      | ✅                          | ✅     | ✅     |
| Scaffolding (templates)                   | ✅                          | ✅     | ✅     |
| MSBuild build / package                   | ✅                          | ❌¹    | ❌¹    |
| Local cluster (start/stop/reset)          | ✅                          | ❌     | ❌     |
| Deploy / Publish / Upgrade / Remove       | ✅                          | ❌¹    | ❌¹    |
| Debug attach to service host              | ✅                          | ❌     | ❌     |

¹ Blocked by absence of the SF Tools targets file and the SDK
PowerShell modules on these OSes — not by MSBuild.

### 10.2 Minimum Windows Prerequisites

We support either of the following on the user's machine:

- **Visual Studio 2022** (any edition) with the *Azure
  development* workload and the *Service Fabric Tools*
  individual component, **or**
- **Build Tools for Visual Studio 2022** (no IDE) with the same
  workload and component.

The .NET SDK alone is **not** sufficient because it does not
include the SF Tools targets file. The extension will detect
this and surface a one-click link to the Build Tools installer
rather than failing silently.

### 10.3 Behaviour on Non-Windows Hosts

- Activation still occurs and authoring features remain enabled.
- All build/deploy commands are visibly disabled (`when` clause
  on `isWindows && serviceFabric.sdkAvailable`) with hover text
  explaining the requirement.
- A workspace notice on first activation summarises what works
  and links to the prerequisites doc, shown once and dismissible.
- We do **not** attempt a partial REST-only deploy path on
  macOS/Linux for MVP; the remote-cluster REST API can register
  and copy a package but cannot replace `Deploy-FabricApplication
  .ps1`'s parameter resolution and version logic without
  effectively re-implementing it. Reconsider post-GA only if
  there is demand.

---

## 11. Testing Strategy

- **Unit tests** (`vitest`): parsers, model, rule engine,
  multi-step input reducers, MSBuild locator.
- **Golden tests**: parsing fixture sfproj/manifest pairs into
  expected JSON snapshots.
- **Integration tests** (`@vscode/test-cli`):
  - Activation against a fixture workspace.
  - Tree provider snapshot.
  - Code action application & resulting text.
  - Task execution against a no-op MSBuild stub.
- **End-to-end (Windows-only)** in CI matrix:
  - Spin up local SF cluster on a Windows-2022 runner with the
    SDK pre-installed.
  - Deploy `Voting` sample, query health, undeploy.
  - Gated behind a `e2e` workflow due to runtime cost.
- **Manual test plan** documented per release in `test/manual/`.

---

## 12. Security & Privacy

- All cluster credentials (AAD tokens, optional client cert
  passwords if ever required) stored only via `SecretStorage`.
- No tokens are logged. The PowerShell host scrubs argument
  arrays before tracing.
- The extension never auto-deploys; every destructive command
  requires explicit user confirmation by default.
- Telemetry is opt-in, follows VS Code's global telemetry setting,
  and never includes manifest contents, paths, cluster endpoints,
  or user identifiers — only command names and high-level
  outcomes.
- Schema/XSD bundle is shipped as static read-only assets; no
  network fetch on activation.
- The extension does not execute scripts from the workspace
  automatically. `Deploy-FabricApplication.ps1` is run only on
  explicit user command and inside a sandboxed PowerShell
  invocation that receives the script path through arguments
  (no shell interpolation of workspace strings).

---

## 13. Risks and Mitigations

| Risk                                                                   | Mitigation                                                                 |
|------------------------------------------------------------------------|----------------------------------------------------------------------------|
| MSBuild targets file not present on user machine                       | Detect, show actionable error linking to SF SDK installer.                 |
| SDK PowerShell modules differ across versions                          | Probe `Get-Module -ListAvailable ServiceFabricSDK` and gate features.      |
| `redhat.vscode-xml` API changes                                        | Pin minimum version; fall back to `xml.fileAssociations` setting.          |
| `.sfproj` schema variations (older Tools 1.x vs 2.x vs 3.x)            | Schema registry keyed by `ProjectVersion`.                                 |
| Local cluster start is slow and fragile                                | Long timeouts, progress UI, link to reset command on failure.              |
| Service Fabric being deprecated for new workloads                      | Position extension as maintenance/modernisation tool; minimal-cost design. |
| Cross-platform parity expectations                                     | Clear documentation of Windows-only features; graceful UI degradation.    |
| Custom XML mutation breaking VS round-trip                             | Use text-range edits, preserve whitespace; round-trip tests in CI.         |
| Secrets accidentally written to settings.json                          | All secrets routed through `SecretStorage`; lint rule forbids cluster types in plain config. |

---

## 14. Open Questions

1. **Publisher identity**: ship under `microsoft` publisher or a
   community publisher? (Affects Marketplace verification badge.)
2. **License**: MIT vs Microsoft Reference Source. Default
   recommendation: MIT.
3. **AAD auth library**: `@azure/identity` is heavy. Consider
   `@azure/msal-node` directly for device code flow.
4. **Should we ship a thin .NET helper** (single-file `dotnet`
   tool) for tasks that are awkward in PowerShell (e.g. ETW log
   parsing)? Defer until a concrete need surfaces.
5. **Marketplace name collision** with any existing community
   extension; check before reserving.
6. **Localization scope**: ship `en-US` only initially; structure
   strings via `vscode-nls` so localisation can be added later.

---

## 15. Success Metrics

- Phase-1 install on a representative SF sample workspace shows
  the same node count/labels as Visual Studio's Solution Explorer
  for that project (validated by automated comparison harness).
- Phase-3 packaging produces an `ApplicationPackage` that
  `Test-ServiceFabricApplicationPackage` reports as valid.
- Phase-5 deployment of the `Voting` sample to a local cluster
  succeeds on a clean Windows-2022 runner in under
  the time Visual Studio takes for the same operation + 30 %.
- End-to-end "edit → F5-attach → hit breakpoint" loop completes
  without leaving VS Code.
- ≥ 80 % unit-test coverage on `src/project`, `src/language`,
  `src/build`, `src/cluster`.

---

## 16. References

- Microsoft Docs — *Service Fabric application and service manifests*.
- Microsoft Docs — *Package and deploy a Service Fabric application*.
- Microsoft Docs — *Service Fabric SDK PowerShell reference*.
- Microsoft Docs — *Service Fabric REST API*.
- VS Code API — *TreeView*, *Tasks*, *Custom Editor*,
  *Authentication*, *Secret Storage*, *Debug*.
- `redhat.vscode-xml` — schema association extension API.
- VSIX samples in `microsoft/vscode-extension-samples`.

---

## 17. Next Action

Create the Phase 0 scaffold (`package.json`, `tsconfig.json`,
`esbuild.config.mjs`, `src/extension.ts`, CI workflow) so that
`vsce package` succeeds against an empty extension. Track work
items per phase as GitHub Issues with the `phase/<n>` label and
link them back to this document.
