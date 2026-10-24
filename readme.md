# Service Fabric Tools for VS Code

VS Code extension that brings first-class support for Azure Service Fabric
application projects (`.sfproj`) — recognising the project, showing a
Solution-Explorer-style tree, validating manifests, building/packaging via
MSBuild, deploying to a connected cluster, attaching the .NET debugger to a
running service, and inspecting cluster diagnostic events.

## Features

- **Project recognition & tree** — Auto-activates on workspaces containing `*.sfproj`. The **Service Fabric** activity-bar view shows applications, service-manifest packages, code/config/data packages, endpoints, default services, parameters, publish profiles, startup-service parameters, `StartupServices.xml`, and scripts.
- **Manifest authoring** — Built-in schema IntelliSense (element / attribute / value completion, hover docs, XSD validation; no XML extension needed), F12 navigation between manifests, custom diagnostics (parameter usage SFD002/SFD003, version drift SFD001, duplicates SFD004), and "Promote literal to parameter" code action.
- **Build & package** — MSBuild task provider with auto-discovered toolchain (`vswhere.exe` or `dotnet msbuild`). Right-click `.sfproj` → Build / Rebuild / Clean / Package. **NuGet restore** runs automatically before each target via a three-strategy fallback (`nuget.exe` → `MSBuild /t:Restore` → in-process HTTPS download from api.nuget.org).
- **Local cluster lifecycle** — Start / Stop / Reset / Switch-mode commands for the SDK dev cluster. **1-node** for fast inner loop, **5-node** for failover and rolling-upgrade testing.
- **Cluster connections** — Local and remote connections, persisted per-workspace, with status-bar health/node/app indicator. Remote clusters can be unsecured, use a pinned (self-signed) server certificate, Microsoft Entra ID, or an X.509 client certificate loaded from a `.pfx`/PEM file (passphrase kept in the OS keychain).
- **Cluster explorer tree** — The **Clusters** view mirrors Service Fabric Explorer: application types and versions, applications → services → partitions → replicas, nodes → deployed applications → service packages → code packages and replicas, plus the `fabric:/System` services and Repair Manager jobs, all health-coloured and fetched live, with a filter to hide healthy / warning / unhealthy rows and completed repair jobs and a sort-by-health option. Right-click to show details/health JSON, scale or delete services, delete applications, unprovision types, restart or remove replicas, activate/deactivate/restart nodes, restart code packages, read container logs, cancel/approve/delete repair jobs, or deep-link into Explorer.
- **Deploy / Remove** — Pick a publish profile and watch logs stream live. On Windows this runs the project's `Deploy-FabricApplication.ps1` through the Service Fabric SDK, as Visual Studio does. On macOS / Linux (or anywhere with `serviceFabric.deploy.engine: "rest"`) the extension uploads, provisions and creates or upgrades the application over the cluster's HTTP gateway, with no SDK required.
- **Scaffolding** — **Create New Application…** produces the same project layout Visual Studio's *Service Fabric Application* template emits: `{Cloud,Local.1Node,Local.5Node}` triads under `ApplicationParameters/`, `PublishProfiles/`, and `StartupServiceParameters/`, a top-level `StartupServices.xml`, a `packages.config`, and the verbatim VS `Scripts/Deploy-FabricApplication.ps1`. **Add Service** offers the full VS *.NET Core (net10.0/9.0/8.0) / .NET Framework / Guest Executable* matrix; **Add / Remove Library Project** scaffolds and unwires shared class libraries between services without polluting the SF application model.
- **HTTPS scaffolding option** — *Add Service* with an ASP.NET Core kind can also generate a second `<Endpoint Protocol="https">`, dual-scheme `launchSettings.json`, and a Kestrel listener that binds both schemes. The bundled **Trust ASP.NET Core Dev Certificate** command wraps `dotnet dev-certs https` so the first F5 *just works*.
- **Debug attach** — **Attach Debugger to Deployed Service…** resolves the host PID via the SF gateway and attaches the .NET (coreclr) or .NET Framework (clr) debugger. A pre-flight check offers a one-click install of the C# extension when it's missing.
- **Auto-attach after Publish (local)** — Opt-in setting (`serviceFabric.debug.autoAttachOnPublish: localOnly`) auto-starts a debug session per host PID after every successful Publish to a local cluster. Per-app one-shot via right-click → **Auto-attach Debugger Next Deploy**. Remote clusters skip cleanly.
- **Package-path resolution understands MSBuild `$(Property)` references.** `<OutputPath>`, `<PackageLocation>`, and the `serviceFabric.deploy.packagePath` setting all expand `$(MSBuildProjectName)`, `$(Configuration)`, `$(Platform)`, and any property defined in the .sfproj's own `<PropertyGroup>` blocks (with `Condition="..."` honored). Opt-in `serviceFabric.deploy.useMsbuildPropertyEvaluator` falls back to spawning MSBuild itself for properties defined only in imported targets. When the explicit override resolves to a package whose `ApplicationTypeName` differs from the .sfproj's, a modal warns before deploy. When the .sfproj references properties defined only in `Directory.Build.props` or imported `.targets` (e.g. `$(BuildOutputPath)` in monorepo layouts), Publish offers an in-flight prompt to enable the MSBuild evaluator for the current run, or persist the choice (1.2.0).
- *(1.1.11)* The project-wide recursive `ApplicationManifest.xml` fallback is removed. Each declared candidate (`serviceFabric.deploy.packagePath`, `<PackageLocation>`, `<OutputPath>`, `pkg\<Configuration>\`) is now scanned up to `serviceFabric.deploy.searchMaxDepth` levels deep — supporting shared monorepo output folders. When every candidate misses, Publish fails with an actionable error naming the two real fixes.
- **Diagnostic Events webview** — Polls `/EventsStore` and renders cluster events in a sortable, refreshing panel.
- **Bundled how-to guide** — Run **Service Fabric: Open Help Guide** for an offline, end-to-end walkthrough of every feature, setting, command, and troubleshooting tip.

## Requirements

- VS Code 1.90+
- **Windows:** Visual Studio 2022 **or** Build Tools for VS 2022 with the *Azure development* workload + *Service Fabric Tools* component, and the Service Fabric SDK for the local cluster and the PowerShell deploy engine.
- **macOS / Linux:** the .NET SDK (8+). Build, package, publish and remove work against remote clusters whose image store is `fabric:ImageStore`. The local dev cluster and debug attach are Windows-only.
- For debug attach: `ms-dotnettools.csharp` (or compatible CoreCLR debugger).

## Get started

1. Install the extension from the Marketplace (or `code --install-extension <path>.vsix`).
2. Open a folder containing a `*.sfproj`.
3. Run **Service Fabric: Get Started** for the in-product walkthrough, or jump straight in with **Service Fabric: Connect to Local Cluster**.
4. For an end-to-end reference, run **Service Fabric: Open Help Guide** (also reachable from the book icon in the **Service Fabric** view title bar).

## Documentation

- **In-product:** **Service Fabric: Open Help Guide** (HOWTO.md).
- **Release notes:** [CHANGELOG.md](https://github.com/coyesiku_microsoft/vscode-sfproj-tools/blob/HEAD/CHANGELOG.md).

## Contributing

Issues and pull requests welcome — see [CONTRIBUTING.md](https://github.com/coyesiku_microsoft/vscode-sfproj-tools/blob/HEAD/CONTRIBUTING.md) for development setup, project layout, and coding conventions.

## Telemetry

This extension does not transmit telemetry. The optional `serviceFabric.telemetry.enabled` setting only logs structured events to the local **Service Fabric** output channel at debug verbosity, and is off by default. VS Code's global `telemetry.telemetryLevel` is also honored.

## Disclaimer

This extension is an independent project and is not affiliated with or endorsed by Microsoft.

## License

[MIT](https://github.com/coyesiku_microsoft/vscode-sfproj-tools/blob/HEAD/LICENSE)
