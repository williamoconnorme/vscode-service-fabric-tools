# Plan — 1.1.x: Make Add Service output immediately buildable and (where applicable) runnable

Reference document for the work tracked under the **Add Service runnability** feature. Captures scope, design decisions, and open questions so the implementation can be picked up across sessions without re-deriving context.

> Status: **planning**. No code has been written yet against this plan; the goal of this document is to ratify the shape before implementation.

## 1. Goal

Bring the **Add Service** wizard's on-disk output to feature parity with Visual Studio's *Add → New Service Fabric Service…* dialog so that:

1. Opening the generated workspace in Visual Studio works without any manual fix-up (build, F5, package, deploy all work immediately).
2. Running `dotnet build` in the generated `<ServiceName>/` folder produces a packaged service that the `.sfproj`'s `Package` target can ingest without any user-side wiring.
3. For **ASP.NET Core** kinds, running `dotnet run` (or VS Code's *C#: launch* configuration) starts Kestrel locally and the controller endpoint at `http://localhost:<port>/api/values` responds with `["value1","value2"]` — no Service Fabric cluster required.
4. For **Reliable** (non-ASP.NET) kinds, the service builds cleanly and packages cleanly; "running" still requires `Publish Application…` to a local cluster (the SF runtime cannot host outside a cluster — this is a Service Fabric constraint, not an extension limitation).

Verbatim user request:

> Develop a plan to fill in missing pieces of new service added with Add Service. When a new service was added, the following are missing:
>
> 1. PackageRoot folder which includes (A) service manifest and (B) the config folder that includes the settings.xml file
> 2. Properties folder which include the launchSettings.json
> 3. appsettings.Development.json files in the service folder root alongside appsettings.json
>
> Analyze any other missing components? The idea is that when a simple shell of a project is added, it can be run immediately. For example, the asp.net core stateless service adds a controller, the service should be runnable immediately and the controller endpoint reached.

## 2. Current state vs Visual Studio template

### 2.1 What Add Service produces today (1.1.1)

For a C# kind invoked on application `Voting/` with service name `Voting.Web`:

```
Voting/
├── Voting.sfproj
├── ApplicationPackageRoot/
│   └── Voting.WebPkg/                  ← manifest + config live HERE
│       ├── ServiceManifest.xml
│       ├── Code/                       ← AfterBuild target copies bits in here
│       └── Config/
│           └── Settings.xml
└── ...

Voting.Web/                             ← sibling C# project
├── Voting.Web.csproj                   ← <SfPackageRoot> points at ../Voting/ApplicationPackageRoot/Voting.WebPkg
├── Program.cs
├── Voting.Web.cs                       ← (or Voting.WebService.cs by class name)
├── (ASP.NET only) Controllers/ValuesController.cs
└── (ASP.NET only) appsettings.json
```

The csproj declares an `AfterBuild` target named `CopyToServiceFabricPackageRoot` that copies `$(OutputPath)**\*` into `<SfPackageRoot>\Code\`. `<SfPackageRoot>` resolves to the application's `ApplicationPackageRoot/<Service>Pkg`.

### 2.2 What Visual Studio's template produces

For the same kind in VS:

```
Voting/
├── Voting.sfproj
├── ApplicationPackageRoot/
│   └── ApplicationManifest.xml         ← only the application manifest lives here
└── ...

Voting.Web/                             ← sibling C# project
├── Voting.Web.csproj                   ← <SfPackageRoot> points at ./PackageRoot
├── PackageRoot/                        ← manifest + config live HERE (inside the C# project)
│   ├── ServiceManifest.xml
│   └── Config/
│       └── Settings.xml
├── Properties/
│   └── launchSettings.json             ← debug/run profile for `dotnet run` and VS F5
├── Program.cs
├── Voting.Web.cs
├── (ASP.NET only) Controllers/ValuesController.cs
├── (ASP.NET only) appsettings.json
└── (ASP.NET only) appsettings.Development.json
```

Key differences:

| Aspect | Today (1.1.1) | VS template |
|---|---|---|
| **Manifest location** | `<App>/ApplicationPackageRoot/<Service>Pkg/ServiceManifest.xml` | `<Service>/PackageRoot/ServiceManifest.xml` |
| **Settings.xml location** | `<App>/ApplicationPackageRoot/<Service>Pkg/Config/Settings.xml` | `<Service>/PackageRoot/Config/Settings.xml` |
| **`<SfPackageRoot>`** | `$(MSBuildThisFileDirectory)..\<App>\ApplicationPackageRoot\<Service>Pkg` | `$(MSBuildThisFileDirectory)PackageRoot` |
| **AfterBuild target** | Copies build output → `<SfPackageRoot>\Code\` (in the application's tree) | None on the service project. The `.sfproj`'s `Package` target copies `<SfPackageRoot>` *and* the service build output into `pkg\<Cfg>\<AppType>\<Service>Pkg\` |
| **`Properties/launchSettings.json`** | Missing | Present. Defines a `Project` profile with environment variables, plus a `Service Fabric Local Cluster` profile that delegates to the SDK debug host. |
| **`appsettings.Development.json`** | Missing (ASP.NET) | Present. Verbose logging + detailed errors. |
| **`<None Include="PackageRoot\**\*" />`** | N/A (no PackageRoot folder) | Present. Surfaces manifest + config in Solution Explorer; `CopyToOutputDirectory=Never` so they don't ship in `bin/`. |
| **`<None Update="appsettings*.json" />`** | Missing (ASP.NET) | Present. `CopyToOutputDirectory=PreserveNewest` so the JSON travels to `bin/` for `dotnet run`. |

### 2.3 Why this matters

**Build correctness.** The current AfterBuild target writes back into the source tree (`ApplicationPackageRoot/<Service>Pkg/Code/`). That's the cause of two real problems:

- The repository accumulates uncommitted build output during `dotnet build`, polluting `git status` until cleaned.
- A second `Package` step on the `.sfproj` copies *that* directory (now containing build output that may be older than what's currently in `bin/`) — so a clean `dotnet build` followed by a `Package` invokes the SF MSBuild target with stale `Code/` content if the AfterBuild target hadn't run yet for the current configuration. The ordering is implicit and brittle.

**Runnability.** Without `Properties/launchSettings.json`, neither VS Code's C# debugger nor `dotnet run` knows what to launch — the user gets no immediately useful F5 experience. ASP.NET kinds advertise a controller in the README but the controller can't actually be reached without spinning up an SF cluster (which is the wrong workflow for "fix-and-iterate" inner-loop authoring).

**VS interop.** Opening the generated project in Visual Studio reveals the missing `PackageRoot/` immediately — the *Service Fabric* node is absent in Solution Explorer, the *Package* command on the service project does the wrong thing, and developers paid for this product expect the layout to "just work."

## 3. Scope

### 3.1 In scope (this plan)

- **Surface a virtual `PackageRoot/` folder under the C# project** via MSBuild linked-file items. The canonical manifest + Settings.xml stay in `<App>/ApplicationPackageRoot/<Service>Pkg/`, but the csproj declares `<None Include="..\<App>\ApplicationPackageRoot\<Service>Pkg\ServiceManifest.xml" Link="PackageRoot\ServiceManifest.xml" CopyToOutputDirectory="Never" />` (and the same for `Config\Settings.xml`). VS Solution Explorer renders these under the C# project's *PackageRoot* node — visually indistinguishable from a real folder — without changing where the files actually live.

  > **Why this approach (vs physically moving the manifest):** A physical move would force a rewrite of the `.sfproj` parser (which today scans `ApplicationPackageRoot/*Pkg/ServiceManifest.xml`), the tree view (which mirrors the parser), and the package-resolution logic in `Publish Application…`. The linked-file path achieves the user-visible goal — *VS Solution Explorer shows manifest + Config under the C# project* — without disturbing any of those subsystems, the existing tests, or v1.1.0/1.1.1 projects on disk.

- **Keep `<SfPackageRoot>`** pointing at the application's `<Service>Pkg/` folder so the existing `Package` flow is unchanged.
- **Keep the AfterBuild copy target.** It is the contract that lets `dotnet build` populate the application's `<Service>Pkg/Code/` so that subsequent `Service Fabric: Package Application` works without a separate `dotnet publish` step. The output directory pollution noted earlier is the trade-off the .sfproj toolchain has always made.
- **Add `Properties/launchSettings.json`** to every C# kind, with two profiles:
  - `Project` profile (for `dotnet run` / F5): launches the exe with `DOTNET_ENVIRONMENT=Development` (or `ASPNETCORE_ENVIRONMENT=Development` for ASP.NET).
  - For ASP.NET kinds only: an `applicationUrl` of `http://localhost:8080` so Kestrel can bind locally without colliding with the SF cluster's gateway port.
- **For ASP.NET kinds**: also add `appsettings.Development.json` with verbose logging + detailed errors, plus a `<None Update="appsettings*.json" CopyToOutputDirectory="PreserveNewest" />` ItemGroup in the csproj so the JSON travels into `bin/` for `dotnet run`.
- **For ASP.NET kinds**: add a "local-only" branch in `Program.cs` that detects "no SF runtime" (e.g. `Environment.GetEnvironmentVariable("Fabric_NodeName") == null`) and runs Kestrel + controllers directly via `WebApplication.CreateBuilder().Run()`. This makes `dotnet run` and Visual Studio's F5-on-the-csproj produce a working endpoint at `http://localhost:8080/api/values`. Inside SF, the existing `ServiceRuntime.RegisterServiceAsync` path is taken.
- **Add the linked-file items + `Properties/` + `appsettings.Development.json` to `Create New Application`'s seeded service** for parity with Add Service.
- **Update existing csproj tests** to assert the new linked-file ItemGroup + the new `<None Update="appsettings*.json">` block for ASP.NET.

**Visual Studio interop:** No `.sln` file is generated by the extension. Visual Studio creates one automatically when the user opens the `.sfproj` (or the workspace folder) for the first time. The artifacts this plan adds (linked `PackageRoot/`, `Properties/launchSettings.json`, `appsettings.Development.json`, dual-mode `Program.cs`) are everything VS needs to render the project tree correctly, run F5 against the C# project, and deploy the application to a local SF cluster.

### 3.2 Out of scope (explicitly)

- **Making Reliable (non-ASP.NET) services runnable as `dotnet run`.** They cannot run outside a Service Fabric cluster — `ServiceRuntime.RegisterServiceAsync` requires `FabricRuntime`, which only exists on a cluster node. Documenting that they are *cluster-runnable only* is sufficient.
- **Actor service local runner.** Same reason as Reliable services. Actors require the `ActorRuntime`, which requires `FabricRuntime`.
- **Guest executable.** No C# project, no `PackageRoot/` relocation, no launchSettings.json. The current layout is correct for guest.
- **.NET Framework kinds.** Same VS-template parity work applies in principle, but `net472` / `net48` developers typically use VS proper, not `dotnet run`. We will still relocate the manifest to `PackageRoot/` for parity, but `Properties/launchSettings.json` is a stretch for net472 and gated behind a separate phase if requested.
- **Solution (`.sln`) file generation.** The extension already does not produce one; this plan does not change that.

## 4. Design

### 4.1 Linked-file `PackageRoot/` in the C# csproj

The csproj-side `PackageRoot/` is a **virtual** folder produced via MSBuild linked-file items. The canonical files stay where the parser, tree view, and Publish flow already expect them — at `<App>/ApplicationPackageRoot/<Service>Pkg/`. VS Solution Explorer renders them under the C# project's *PackageRoot* node anyway, because the `Link="PackageRoot\..."` attribute drives the display path.

Generated csproj (deltas relative to 1.1.1, ASP.NET-stateless example):

```xml
<!-- Existing PropertyGroup is unchanged; <SfPackageRoot> still points at the
     application's <Service>Pkg/ folder. -->

<!-- New: surface manifest + Settings.xml under a virtual PackageRoot/ folder
     in Solution Explorer. The actual files live at the path the .sfproj's
     Package target reads them from; Link= controls the display only. -->
<ItemGroup>
  <None Include="$(SfPackageRoot)\ServiceManifest.xml">
    <Link>PackageRoot\ServiceManifest.xml</Link>
    <CopyToOutputDirectory>Never</CopyToOutputDirectory>
  </None>
  <None Include="$(SfPackageRoot)\Config\Settings.xml">
    <Link>PackageRoot\Config\Settings.xml</Link>
    <CopyToOutputDirectory>Never</CopyToOutputDirectory>
  </None>
</ItemGroup>

<!-- New, ASP.NET kinds only: ship appsettings*.json next to the exe -->
<ItemGroup>
  <None Update="appsettings.json">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </None>
  <None Update="appsettings.Development.json">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    <DependentUpon>appsettings.json</DependentUpon>
  </None>
</ItemGroup>

<!-- AfterBuild target unchanged: still copies $(OutputPath) into $(SfPackageRoot)\Code -->
```

The actual on-disk layout for a C# stateless service named `Voting.Web` becomes:

```
Voting/                                  ← .sfproj
├── Voting.sfproj
├── ApplicationPackageRoot/
│   ├── ApplicationManifest.xml
│   └── Voting.WebPkg/                   ← canonical service package (unchanged)
│       ├── ServiceManifest.xml
│       ├── Code/                        ← AfterBuild fills this
│       └── Config/Settings.xml
└── ...

Voting.Web/                              ← sibling C# project (new layout)
├── Voting.Web.csproj                    ← <SfPackageRoot> = ..\Voting\ApplicationPackageRoot\Voting.WebPkg
├── Properties/
│   └── launchSettings.json              ← NEW
├── Program.cs
├── Voting.Web.cs
├── Controllers/                         ← ASP.NET only
│   └── ValuesController.cs
├── appsettings.json                     ← ASP.NET only
└── appsettings.Development.json         ← ASP.NET only, NEW
```

VS Solution Explorer renders an additional virtual `PackageRoot/{ServiceManifest.xml, Config/Settings.xml}` under `Voting.Web/` because of the linked-file declarations.

### 4.3 launchSettings.json

For **non-ASP.NET C# kinds** (stateless / stateful / actor):

```json
{
  "profiles": {
    "<ServiceName>": {
      "commandName": "Project",
      "environmentVariables": {
        "DOTNET_ENVIRONMENT": "Development"
      }
    }
  }
}
```

For **ASP.NET kinds** (aspNetStateless / aspNetStateful), a profile that binds Kestrel to a fixed local port so the controllers can be hit immediately:

```json
{
  "profiles": {
    "<ServiceName>": {
      "commandName": "Project",
      "launchBrowser": true,
      "launchUrl": "api/values",
      "applicationUrl": "http://localhost:8080",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    }
  }
}
```

### 4.4 ASP.NET `Program.cs` — local-mode dual path

Replace the current ASP.NET `Program.cs` (which only registers with `ServiceRuntime`) with a dual-mode entry point. When `Fabric_NodeName` is *not* set in the environment we know we are not inside an SF runtime container, so run Kestrel directly:

```csharp
using System;
using System.Threading;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.ServiceFabric.Services.Runtime;

namespace <RootNamespace>
{
    internal static class Program
    {
        private static void Main(string[] args)
        {
            // When invoked under `dotnet run` outside a Service Fabric cluster,
            // run Kestrel + controllers directly so the endpoints are reachable
            // for inner-loop authoring. Inside the SF runtime, register with the
            // Reliable Services runtime as normal.
            if (Environment.GetEnvironmentVariable("Fabric_NodeName") == null)
            {
                RunLocal(args);
                return;
            }

            try
            {
                ServiceRuntime.RegisterServiceAsync(
                    "<ServiceTypeName>",
                    context => new <ClassName>(context))
                    .GetAwaiter().GetResult();

                Thread.Sleep(Timeout.Infinite);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Service host failed: {ex}");
                throw;
            }
        }

        private static void RunLocal(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddControllers();
            var app = builder.Build();
            app.UseRouting();
            app.MapControllers();
            app.Run();
        }
    }
}
```

The `RunLocal` path uses the same controllers (`Controllers/ValuesController.cs`) so behaviour is consistent across modes. State-management dependencies (`StateManager` for stateful kinds) cannot be honoured locally — the `RunLocal` path does **not** register them. This is acceptable for stateful ASP.NET because:

- Local-mode is for endpoint-shape verification, not state correctness.
- A stateful service in local mode trying to use `StateManager` would crash with a clear NRE telling the developer to deploy to a cluster.
- Documenting this in §11.2 of `HOWTO.md` is sufficient.

### 4.5 appsettings.Development.json (ASP.NET kinds)

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Information",
      "Microsoft.Hosting.Lifetime": "Information"
    }
  },
  "DetailedErrors": true
}
```

The existing `appsettings.json` (production-style) stays as-is.

### 4.6 Apply-step changes

`applyAddService`'s file-creation logic is **additive only** — no existing file moves. New writes for C# kinds:

| File | When |
|---|---|
| `<Service>/Properties/launchSettings.json` | Every C# kind (stateless / stateful / actor / aspNetStateless / aspNetStateful). Written into a new `Properties/` directory created next to the csproj. |
| `<Service>/appsettings.Development.json` | ASP.NET kinds only (alongside the existing `appsettings.json`). |

Optional fields added to `AddServiceResult`:

```ts
readonly launchSettingsPath?: string;            // C# kinds
readonly appsettingsDevelopmentPath?: string;    // aspNet kinds
```

For **guest** kind, no changes — it has no csproj to host launchSettings/appsettings.

### 4.7 Remove Service

No changes required for the manifest cleanup. The existing `applyRemoveService` already deletes the entire `<Service>/` directory recursively when it detects a generated companion C# project. The new `Properties/` and `appsettings.Development.json` files ride along automatically.

### 4.8 Visual Studio interop (no `.sln` generated)

Visual Studio creates a `.sln` automatically when a user opens a `.sfproj` (or its parent folder) directly. We deliberately do **not** generate one ourselves so:

- VS users get the solution file VS itself wants — no risk of format-version drift between versions.
- Workspaces that mix sfproj-style scaffolds with hand-authored solutions don't accumulate stray `.sln` files.
- The implementation stays focused: the gap the user actually feels ("open in VS and run") is closed by the *project-level* artifacts (linked `PackageRoot/`, `Properties/launchSettings.json`, `appsettings.Development.json`, dual-mode `Program.cs`), not by a solution wrapper.

What the user does today:

1. Run `Service Fabric: Create New Application…` (or `Add New Service…`).
2. Open `<AppName>\<AppName>.sfproj` in Visual Studio. VS prompts to create a `.sln` and saves it next to the `.sfproj`.
3. The companion C# project shows up as a referenced project (via the `<ProjectReference>` already inserted into the `.sfproj`); VS adds it to the solution on first build.
4. F5 on the `.sfproj` deploys to the local SF cluster (existing behaviour).
5. F5 on the C# project runs it standalone (new behaviour: ASP.NET kinds use Kestrel and `Properties/launchSettings.json`).

## 5. Phases

Each phase is a self-contained PR-shaped slice that keeps the test suite green and the extension shippable.

### Phase A — Pure-template plumbing

1. Add `buildLaunchSettingsJson(t)` returning either the ASP.NET or non-ASP.NET variant.
2. Add `buildAspNetAppsettingsDevelopmentJson()` for ASP.NET kinds.
3. Update `buildCsharpCsproj` to:
   - Add the linked-file `<None Include="$(SfPackageRoot)\...">` ItemGroup with `Link="PackageRoot\..."` for `ServiceManifest.xml` + `Config\Settings.xml`.
   - Add the `<None Update="appsettings*.json">` ItemGroup for ASP.NET kinds.
   - Leave `<SfPackageRoot>` and the `CopyToServiceFabricPackageRoot` AfterBuild target untouched.
4. Update `buildCsharpProgramCs` for ASP.NET kinds to emit the dual-mode `Main` shown in §4.4.

Test additions: ~6 new unit tests (each builder + the linked-file ItemGroup assertion).

### Phase B — Apply-step writes

1. In `applyAddService`, for every C# kind:
   - Create `<csprojDir>/Properties/launchSettings.json`.
   - For ASP.NET: also write `<csprojDir>/appsettings.Development.json`.
2. Update `AddServiceResult` to surface `launchSettingsPath?` and `appsettingsDevelopmentPath?`.
3. In `applyCreateApplication`, for the seeded C# kind: same launchSettings / appsettings.Development writes.
4. Update `CreateApplicationResult` to surface `launchSettingsPath?`.

Test updates: a couple of Add+Remove round-trip tests assert the new files exist and (for Remove) that they get cleaned up with the rest of the C# project directory.

### Phase C — Remove Service

No code changes — the existing recursive C# project directory deletion picks up the new `Properties/` and `appsettings.Development.json` files automatically. Add one regression test that asserts both are gone after Remove Service for an ASP.NET kind.

### Phase D — Documentation & release

1. `HOWTO.md` §11.1: update the project-tree diagram to show `<Service>/PackageRoot/`, `<Service>/Properties/launchSettings.json`, and (ASP.NET only) `<Service>/appsettings.Development.json`.
2. `HOWTO.md` §11.2: rewrite the *"Going from zero to running"* block:
   - For ASP.NET kinds: `dotnet run` → browser opens to `http://localhost:8080/api/values` and shows `["value1","value2"]`.
   - For Reliable kinds: `dotnet build` → output flows into `<Service>/bin/`; package + publish to a local cluster to actually run.
   - Note the local-mode dual path for ASP.NET (works without a cluster) vs the SF-only path for Reliable kinds.
3. `CHANGELOG.md` entry: bump to **1.1.2**, document the layout move + new files. Note that any service generated under 1.1.0 / 1.1.1 stays buildable but does not gain the new files retroactively.
4. Re-run `npm test` (expect the test count to grow — Phase A adds 5–6, Phase B adjusts 4–5 existing).
5. Re-run `npm run build` + `npm run package` to refresh the vsix.

### Phase E — (deferred) .NET Framework parity

Optional follow-up for a separate plan. Same `PackageRoot/` move, no `Properties/launchSettings.json` (net472 services typically don't `dotnet run`), no `appsettings*.json`. Skipped from this plan unless explicitly requested.

## 6. Open questions

1. **Should the dual-mode `Program.cs` for stateful ASP.NET include a warning when running locally?** The state-manager path is unavailable; controllers that try to use it will crash. Options: (a) emit a `Console.WriteLine` warning to stderr; (b) document only; (c) skip the local-mode dual path for *stateful* ASP.NET. **Recommendation: (a)** — visible warning, no behavioural surprise.

2. **Local Kestrel port collisions.** If the developer has more than one ASP.NET service in the same workspace, both `launchSettings.json` files default to `http://localhost:8080`. **Mitigation:** offer `8080` for the first ASP.NET service in the project and `8080 + N` for subsequent ones, where `N` is the count of pre-existing ASP.NET services discovered in `<App>/ApplicationManifest.xml` at scaffold time.

3. **Migration of pre-1.1.2 projects.** Should there be a `Service Fabric: Migrate Service Layout to VS Template` command to move the manifest from the old to the new location for users who scaffolded under 1.1.0/1.1.1? **Recommendation: defer** — the legacy layout still works, and we don't want to add a one-off migration command for a niche case. Users who care can move the files manually following §11.2 of the updated HOWTO.

4. **Should `<None Include="PackageRoot\**\*" />` use `CopyToOutputDirectory=Never` or `=PreserveNewest`?** VS template uses `Never` (the SF MSBuild package target reads them from the source location). **Recommendation: match VS exactly — `Never`.**

5. **`Properties/PublishProfiles/*.pubxml` files.** VS optionally generates these for ASP.NET kinds. They aren't useful in the SF context (deployment goes through `Deploy-FabricApplication.ps1`, not `dotnet publish`'s pubxml). **Recommendation: skip.** Document under §16 if a user asks.

## 7. Acceptance criteria

A scaffold-then-build round trip succeeds without manual intervention:

- [ ] `Service Fabric: Create New Application…` → kind **Stateless ASP.NET Core**, app name `Demo`, service name `Demo.Web`. Result: `Demo/Demo.sfproj` exists, `Demo.Web/Demo.Web.csproj` exists, `Demo.Web/Properties/launchSettings.json` exists, `Demo.Web/appsettings.Development.json` exists.
- [ ] Opening `Demo/Demo.sfproj` in Visual Studio 2022 succeeds — VS prompts to create a `.sln` and Solution Explorer ends up showing the `.sfproj` plus the referenced `Demo.Web` project. Under `Demo.Web` the virtual `PackageRoot/{ServiceManifest.xml, Config/Settings.xml}` linked nodes appear, and **Build Solution** succeeds.
- [ ] In `Demo.Web/`, `dotnet run` starts Kestrel on `http://localhost:8080`, no SF errors, `curl http://localhost:8080/api/values` returns `["value1","value2"]`. Visual Studio F5 on the `.csproj` does the same.
- [ ] In `Demo.Web/`, `dotnet build` produces `bin/<Cfg>/<TFM>/Demo.Web.exe` + `appsettings.json` + `appsettings.Development.json`. The application's `Demo/ApplicationPackageRoot/Demo.WebPkg/Code/` is populated by the AfterBuild target as today.
- [ ] On the application, **Service Fabric: Package Application** produces `pkg/<Cfg>/<AppType>/Demo.WebPkg/{ServiceManifest.xml, Code/, Config/}` correctly populated.
- [ ] **Service Fabric: Publish Application…** to a local cluster succeeds and `GET http://<cluster>/api/values` (via the SF reverse proxy) returns the expected payload.
- [ ] **Service Fabric: Remove Service…** on `Demo.Web` cleans up everything: the application manifest, the application parameter files, the StartupServices.xml, the StartupServiceParameters files, the `<ProjectReference>` in the `.sfproj`, and the entire `Demo.Web/` directory (including `Properties/`, `appsettings.Development.json`, and the source files).
- [ ] All 222+ unit tests pass.
- [ ] No regression in legacy-project handling: a project scaffolded under 1.1.1 still loads, builds, and removes services correctly.

## 8. Tracking

| Phase | Files touched | Tests added | Tests adjusted |
|---|---|---|---|
| A | `addServiceTemplates.ts` | ~6 | 1 (csproj test asserting linked-file ItemGroup) |
| B | `addServiceApply.ts`, `createApplicationApply.ts` | ~3 | ~2 |
| C | none (regression test only) | ~1 | 0 |
| D | `HOWTO.md`, `CHANGELOG.md`, `package.json` (version bump to 1.1.2) | 0 | 0 |
| E (deferred) | (.NET FX parity, separate plan) | TBD | TBD |

Estimated final count: **222 → ~232 tests** after Phase D, all passing.

---

*Drafted for v1.1.2. See [CHANGELOG.md](CHANGELOG.md) for the canonical history once the work lands.*
