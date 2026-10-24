# Plan — Corrected Service Fabric Project Layout (1.1.3)

## 1. Goal

Make **Add Service** (and the seeded service produced by **Create Application**) scaffold a service project that is **byte-equivalent to what Visual Studio's *Add → New Service Fabric Service…* wizard generates** for each of the eight C# kinds VS supports:

| #  | Kind                              | csproj Sdk / TargetFramework                | Notes                                                  |
|----|-----------------------------------|---------------------------------------------|--------------------------------------------------------|
| 1  | Stateless service (.NET Core)     | `Microsoft.NET.Sdk` / `net8.0` Exe          | Plain stateless service.                                |
| 2  | Stateful service (.NET Core)      | `Microsoft.NET.Sdk` / `net8.0` Exe          | `HasPersistedState=true`.                               |
| 3  | Stateless ASP.NET Core            | `Microsoft.NET.Sdk.Web` / `net9.0`          | Manifest endpoint `Port="…"` Type=Input.                 |
| 4  | Stateful ASP.NET Core             | `Microsoft.NET.Sdk.Web` / `net9.0`          | `HasPersistedState=true`. **No `<Resources>` block.**   |
| 5  | Actor (.NET Core)                 | `Microsoft.NET.Sdk` / `net8.0` Exe          | Manifest is auto-generated at build by `Microsoft.ServiceFabric.Actors.targets`. Adds a sibling `<Folder>.Interfaces/` SDK-style class library. |
| 6  | Actor (.NET Framework)            | Classic MSBuild csproj / `v4.7.2`           | Same auto-generated manifest, but uses `packages.config`-style references. **Deferred** — see §9. |
| 7  | Stateless service (.NET Framework)| Classic MSBuild csproj / `v4.7.2`           | `packages.config`-style references. **Deferred** — see §9. |
| 8  | Stateful service (.NET Framework) | Classic MSBuild csproj / `v4.7.2`           | `packages.config`-style references. **Deferred** — see §9. |

Kinds 1–5 are in scope for 1.1.3. Kinds 6–8 (NetFramework) are out of scope and tracked in §9.

When any of these is added — alone or alongside an existing `.sfproj` — the resulting project must:

1. Build successfully out of the box (`/t:Build`, `/t:Package`) **without** manual NuGet restore or SDK fix-ups.
2. Publish successfully via `Service Fabric: Publish Application…` immediately after creation.
3. Open cleanly in Visual Studio (VS auto-creates the `.sln`) and render the same Solution Explorer tree VS itself would render — each service appears as a sibling C# project containing a real `PackageRoot/` folder, the `.sfproj` carries one `<ProjectReference>` per service, and `ApplicationPackageRoot/` contains only `ApplicationManifest.xml`.
4. Round-trip through the existing parser, tree view, package, and publish flows without regressions.

The 1.1.1 → 1.1.2 work (linked-file `PackageRoot/`, `Properties/launchSettings.json`, `appsettings.Development.json`, dual-mode ASP.NET `Program.cs`) was on the right track conceptually, but the layout it produces does not match VS's. Two concrete bugs were observed in 1.1.2:

- **`error MSB4057: The target "Package" does not exist in the project.`** — the Service Fabric MSBuild targets (`Microsoft.VisualStudio.Azure.Fabric.Application.targets`) are not loaded at build time. They live in either the VS-installed SDK path *or* under `packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.<ver>\build\`, and neither is present on a fresh machine until NuGet restore runs.
- **`PackageRoot/` folder + contents missing from the Service folder.** 1.1.2 deliberately put the canonical manifest under `<App>/ApplicationPackageRoot/<Service>Pkg/` and only *linked* the files into the csproj. VS's template does the opposite: the canonical files live under `<Service>/PackageRoot/` and the SF Application targets walk `<ProjectReference>` entries to discover them. Our linked-file approach is invisible to those targets and to VS Solution Explorer's expected behaviour.

## 2. Reference scaffolding

The single source of truth for what we emit is the **vanilla VS template output** in:

> `Q:\Repos\VSIX_Examples\Application1\`

This workspace was produced by clicking through *File → New Project → Service Fabric Application* in Visual Studio 2022 and then *Add → New Service Fabric Service…* eight times — once per C# kind. No subsequent hand-edits. Every value the scaffolder emits (csproj `<PropertyGroup>` entries, `PackageReference` versions, `<TargetFramework>`, `<RootNamespace>` rules, `ServiceManifest.xml` shape, `ApplicationManifest.xml` patches, `<ServiceLaunchUrl>` metadata, `packages.config` pin, `.sfproj` `<Import>` paths, `<ValidateMSBuildFiles>` target) **must come verbatim from this reference**.

For each scaffolded kind we should be able to point at the corresponding folder under Application1 and say *"this is what we produce"*:

| Kind                       | Reference folder(s) in Application1                                                |
|----------------------------|------------------------------------------------------------------------------------|
| Stateless .NET Core        | `Stateless1/`                                                                      |
| Stateful .NET Core         | `Stateful1/`                                                                       |
| Stateless ASP.NET Core     | `Web1-Stateless-AspNetCore/`                                                       |
| Stateful ASP.NET Core      | `Web2-Stateful-AspNetCore/`                                                        |
| Actor .NET Core            | `Actor1/` **+** sibling interfaces project `Actor1.Interfaces/`                    |
| Actor .NET Framework       | `Actor1-NetFramework/` **+** sibling `Actor1-NetFramework.Interfaces/`             |
| Stateless .NET Framework   | `Stateless2-NetFramework/`                                                         |
| Stateful .NET Framework    | `Stateful2-NetFramework/`                                                          |
| Application (`.sfproj`)    | `Application1.sfproj`, `ApplicationPackageRoot/`, `StartupServices.xml`, `ApplicationParameters/`, `PublishProfiles/`, `StartupServiceParameters/`, `Scripts/`, `packages.config` |

### 2.0 Sparrow is informational only

`Q:\Repos\Sparrow-ReverseProxy\src\Sparrow.ReverseProxy\` was originally generated from the same VS templates but has been **heavily hand-modified since** (added a `<ValidateMSBuildFiles>` target with `[BuildVersion]` token substitution, decoupled csproj name from folder name, added `TargetLatestRuntimePatch` / `PublishSingleFile=false` / `PublishReadyToRun=false`, added `<ServiceLaunchUrl>` to scalar/v1, etc.). Sparrow is useful as a *real-world example of what users do to a generated project*, and it confirms the layout shape (nested `<root>/<App>/<App>.sfproj` + sibling `<root>/<Service>/`), but **none of Sparrow's hand-edits are template-default values and should not be copied into the scaffolder.** Where Sparrow and Application1 disagree, Application1 wins.

```
<workspace>/
├── packages/                                      ← NuGet-restored MSBuild targets
│   └── Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.6/
│       └── build/
│           ├── Microsoft.VisualStudio.Azure.Fabric.Application.props
│           └── Microsoft.VisualStudio.Azure.Fabric.Application.targets
├── <AppName>/                                     ← .sfproj folder
│   ├── <AppName>.sfproj
│   ├── packages.config
│   ├── ApplicationPackageRoot/
│   │   └── ApplicationManifest.xml                ← ONLY this; no per-service Pkg subfolder
│   ├── ApplicationParameters/{Cloud,Local.1Node,Local.5Node}.xml
│   ├── PublishProfiles/{Cloud,Local.1Node,Local.5Node}.xml
│   ├── StartupServiceParameters/{Cloud,Local.1Node,Local.5Node}.xml
│   ├── StartupServices.xml
│   └── Scripts/
│       └── Deploy-FabricApplication.ps1
└── <ServiceFolder>/                               ← C# project sibling
    ├── <ServiceFolder>.csproj                     ← (or any csproj name; Sparrow uses Sparrow.ReverseProxy.csproj)
    ├── Program.cs
    ├── <ServiceClass>.cs
    ├── Properties/launchSettings.json             ← ASP.NET / regular C#
    ├── appsettings.json                           ← ASP.NET only
    ├── appsettings.Development.json               ← ASP.NET only
    ├── Controllers/ValuesController.cs            ← ASP.NET only
    └── PackageRoot/                               ← canonical manifest + config — physical, not linked
        ├── ServiceManifest.xml
        └── Config/
            └── Settings.xml
```

### 2.1 Naming convention extracted from VS

From Application1's `Stateless1` (default VS-template values):

| Concept                  | Value                                          |
|--------------------------|------------------------------------------------|
| Service folder           | `Stateless1`                                   |
| Service name (VS sense)  | `Stateless1`                                   |
| `<ServiceManifest Name>` | `Stateless1Pkg`                                |
| `ServiceTypeName`        | `Stateless1Type`                               |
| csproj filename          | `Stateless1.csproj`                            |
| Assembly / `<Program>`   | `Stateless1.exe`                               |
| `ProjectReference`       | `Stateless1\Stateless1.csproj`                 |
| App-manifest import      | `<ServiceManifestRef ServiceManifestName="Stateless1Pkg" ServiceManifestVersion="1.0.0" />` |
| `StartupServices.xml`    | `<Service Name="Stateless1" ServicePackageActivationMode="ExclusiveProcess">` |

This is the *default* VS template shape: csproj name = folder name = service name = `<Folder>Pkg` minus the `Pkg` suffix. Continue to use this simple shape in the scaffolder.

Versions are emitted as literal `"1.0.0"` (matches Application1). Sparrow's `[BuildVersion]` token is a hand-edit and is **not** part of the VS template default — do not emit it.

### 2.2 Build-time MSBuild targets discovery

The `.sfproj` imports its targets in this order (taken verbatim from `Application1.sfproj`, with the `..\` prefix added for the nested shape we author):

```xml
<Import Project="..\packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\build\Microsoft.VisualStudio.Azure.Fabric.Application.props"
        Condition="Exists('..\packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\build\Microsoft.VisualStudio.Azure.Fabric.Application.props')" />
…
<Import Project="$(MSBuildToolsPath)\Microsoft.Common.targets" />
<PropertyGroup>
  <ApplicationProjectTargetsPath>$(MSBuildExtensionsPath32)\Microsoft\VisualStudio\v$(VisualStudioVersion)\Service Fabric Tools\Microsoft.VisualStudio.Azure.Fabric.ApplicationProject.targets</ApplicationProjectTargetsPath>
</PropertyGroup>
<Import Project="$(ApplicationProjectTargetsPath)" Condition="Exists('$(ApplicationProjectTargetsPath)')" />
<Import Project="..\packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\build\Microsoft.VisualStudio.Azure.Fabric.Application.targets"
        Condition="Exists('..\packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\build\Microsoft.VisualStudio.Azure.Fabric.Application.targets')" />
<Target Name="ValidateMSBuildFiles" BeforeTargets="PrepareForBuild">
  <Error Condition="!Exists('..\packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\build\Microsoft.VisualStudio.Azure.Fabric.Application.props')"
         Text="Unable to find the '…' file. Please restore the 'Microsoft.VisualStudio.Azure.Fabric.MSBuild' Nuget package." />
  <Error Condition="!Exists('..\packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\build\Microsoft.VisualStudio.Azure.Fabric.Application.targets')"
         Text="Unable to find the '…' file. Please restore the 'Microsoft.VisualStudio.Azure.Fabric.MSBuild' Nuget package." />
</Target>
```

Application1 itself uses the bare `packages\…` form because it's flat-layout. Our scaffolder authors nested-layout so we prepend `..\` consistently in all four locations (two `<Import>` + two `<Error Condition>`). The package-version pin must match `packages.config`.

If neither path exists at build time, the `Package` target is undefined → MSB4057. The `<ValidateMSBuildFiles>` target turns that into an actionable *"Please restore the 'Microsoft.VisualStudio.Azure.Fabric.MSBuild' Nuget package"* message.

### 2.4 Layout shape — flat vs nested

VS supports both shapes. The .sfproj's `<ProjectReference>` paths and `<Import Project="…packages…">` paths are the only differences:

| Shape   | .sfproj at                | Service folders          | `packages\…` import      | `<ProjectReference>` path                |
|---------|---------------------------|--------------------------|---------------------------|------------------------------------------|
| Flat    | `<workspace>/<App>.sfproj`| `<workspace>/<Service>/` | `packages\…`              | `<Service>\<Service>.csproj`             |
| Nested  | `<workspace>/<App>/<App>.sfproj` | `<workspace>/<Service>/` (sibling of `<App>/`) | `..\packages\…` | `..\<Service>\<Service>.csproj` |

The extension already authors the **nested** shape (and Sparrow uses it too). Keep that — it cleanly separates the App project's auxiliary files (PublishProfiles, Scripts, ApplicationParameters) from the workspace root, and produces the same `<App>/` + `<Service>/` siblings the user expects. The parser must still recognise both shapes when loading existing projects (Application1 demonstrates the flat shape exists in the wild).

### 2.3 What the MSBuild `Package` target actually does

When the SF Application targets are imported and the `.sfproj` runs `/t:Package`:

1. For every `<ProjectReference>` in the `.sfproj` whose target project sets `<IsServiceFabricServiceProject>true</IsServiceFabricServiceProject>`:
   - Read the referenced csproj's *output* directory (`bin/<Cfg>/<TFM>/`).
   - Read the referenced csproj's *folder* `PackageRoot/` directory.
   - Compose `pkg/<Cfg>/<App>/<Folder>Pkg/` from `bin/...` (→ `Code/`) + `PackageRoot/...` (→ `ServiceManifest.xml` + `Config/`).
2. Write `pkg/<Cfg>/<App>/ApplicationManifest.xml` from `<App>/ApplicationPackageRoot/ApplicationManifest.xml`.
3. If `[BuildVersion]` tokens are present, substitute them with the value MSBuild computes from project metadata. Application1 uses literal `"1.0.0"` strings instead and that works just as well — the scaffolder emits literal `"1.0.0"` to match the VS template default.

This is why `<Service>/PackageRoot/` must be physical: the SF Application targets glob the file system at `<ProjectDir>/PackageRoot/**` to populate the per-service Pkg slot. Our 1.1.2 linked-file approach (`<None Include="$(SfPackageRoot)\..."`) is invisible to that glob.

## 3. Concrete output target for 1.1.3

### 3.1 Create Application: `MyApp` + seeded `MyApp.Service1` (stateless ASP.NET Core)

```
MyApp/
├── MyApp.sfproj                                   ← updated (see §4.1)
├── packages.config                                ← unchanged from 1.1.2
├── ApplicationPackageRoot/
│   └── ApplicationManifest.xml                    ← unchanged content; only this file in folder
├── ApplicationParameters/{Cloud,Local.1Node,Local.5Node}.xml
├── PublishProfiles/{Cloud,Local.1Node,Local.5Node}.xml
├── StartupServiceParameters/{Cloud,Local.1Node,Local.5Node}.xml
├── StartupServices.xml
└── Scripts/Deploy-FabricApplication.ps1
MyApp.Service1/
├── MyApp.Service1.csproj                          ← Microsoft.NET.Sdk.Web for ASP.NET; no <SfPackageRoot>; no AfterBuild target
├── Program.cs                                     ← dual-mode for ASP.NET (unchanged from 1.1.2)
├── MyAppService1.cs
├── Properties/launchSettings.json
├── appsettings.json
├── appsettings.Development.json
├── Controllers/ValuesController.cs
└── PackageRoot/                                   ← NEW: physical, not linked
    ├── ServiceManifest.xml                        ← <ServiceManifest Name="MyApp.Service1Pkg" Version="1.0.0">
    └── Config/
        └── Settings.xml
```

Plus, at the workspace root (sibling of `MyApp/`), a `packages/` folder will appear after the first NuGet-restore step (§4.5). The `.sfproj` references it via `..\packages\…`. The package version pinned in `packages.config` is **1.7.9** (current VS-default; the older 1.7.6 referenced earlier from Sparrow is also valid but stale).

### 3.2 Add Service: `MyApp.Service2` (any kind) added to existing `MyApp`

Identical layout — a new `MyApp.Service2/` sibling folder is created with its own `PackageRoot/`. The App folder's `ApplicationPackageRoot/` still holds only `ApplicationManifest.xml`; we no longer create a per-service `<Service>Pkg/` subfolder there.

### 3.4 Per-kind csproj + manifest shape (verified from Application1)

VS authors four distinct csproj/ServiceManifest pairings. Our scaffolder must match them:

#### 3.4.1 Stateless .NET Core (kind = `stateless-csharp`)

```xml
<!-- Stateless1.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>
    <ServerGarbageCollection>True</ServerGarbageCollection>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>True</SelfContained>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.ServiceFabric.Services" Version="8.1.208" />
  </ItemGroup>
</Project>
```

ServiceManifest.xml: `<StatelessServiceType ServiceTypeName="<Folder>Type" />`, `<ExeHost><Program><Folder>.exe</Program></ExeHost>` (no `<WorkingFolder>`), `<ConfigPackage Name="Config" Version="1.0.0" />`, and a single endpoint `<Endpoint Name="ServiceEndpoint" />` (no Port/Protocol/Type).

#### 3.4.2 Stateful .NET Core (kind = `stateful-csharp`)

Identical csproj to §3.4.1 (only difference is the package reference may add `Microsoft.ServiceFabric.Data` if state is used; baseline scaffold uses just `Microsoft.ServiceFabric.Services`).

ServiceManifest.xml: `<StatefulServiceType ServiceTypeName="<Folder>Type" HasPersistedState="true" />`. Same `<ExeHost>` shape. `<Endpoint Name="ServiceEndpoint" />` only.

#### 3.4.3 Stateless ASP.NET Core (kind = `stateless-aspnet`)

```xml
<!-- Web1-Stateless-AspNetCore.csproj -->
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>Web1_Stateless_AspNetCore</RootNamespace> <!-- only when folder name has '-' -->
    <IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>
    <ServerGarbageCollection>True</ServerGarbageCollection>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>True</SelfContained>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="9.0.15" />
    <PackageReference Include="Microsoft.ServiceFabric.AspNetCore.Kestrel" Version="8.1.208" />
  </ItemGroup>
</Project>
```

Key points:
- **No** `<None Update="appsettings*.json">` ItemGroup. `Sdk.Web` includes `appsettings*.json` automatically. The 1.1.2 `appsettingsItems` ItemGroup must be **removed**.
- `<RootNamespace>` is only emitted when the folder name contains characters illegal in a C# identifier (e.g. `-`). For folder names like `MyApp.Service1`, the implicit root namespace `MyApp.Service1` is valid (dots are allowed in namespaces) and `<RootNamespace>` can be omitted.
- `TargetFramework` is `net9.0` for current VS templates (1.1.2 used `net8.0` — bump to `net9.0` to match).

ServiceManifest.xml additions vs §3.4.1:
- `<ExeHost>` adds `<WorkingFolder>CodePackage</WorkingFolder>`.
- `<CodePackage>` adds `<EnvironmentVariables><EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value=""/></EnvironmentVariables>`.
- `<Endpoint Protocol="http" Name="ServiceEndpoint" Type="Input" Port="8559" />` — explicit port (VS picks 8000–8999 range; we already pick from `getNextServicePort()`).

#### 3.4.4 Stateful ASP.NET Core (kind = `stateful-aspnet`)

Same csproj as §3.4.3.

ServiceManifest.xml differs from §3.4.3:
- `<StatefulServiceType ServiceTypeName="<Folder>Type" HasPersistedState="true" />`.
- **No `<Resources>` block at all** — stateful services don't expose an input endpoint at the manifest level (the gateway is built per-replica via custom listeners).
- `<ExeHost>` + `<EnvironmentVariables>` block as in §3.4.3.

#### 3.4.5 Actor .NET Core (kind = `actor-csharp`)

VS authors **two** sibling projects for an actor: the host (`<Folder>/<Folder>.csproj`) and an interfaces class library (`<Folder>.Interfaces/<Folder>.Interfaces.csproj`). Only the host appears as a `<ProjectReference>` in the `.sfproj`; the host csproj `<ProjectReference>`'s the interfaces project.

```xml
<!-- Actor1.csproj (host) -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>
    <ServerGarbageCollection>True</ServerGarbageCollection>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>True</SelfContained>
    <UpdateServiceFabricManifestEnabled>True</UpdateServiceFabricManifestEnabled>
    <ServicePackagePath>PackageRoot</ServicePackagePath>
    <ServicePackagePrefix>$(MSBuildProjectName)</ServicePackagePrefix>
    <FabActUtilWorkingDir>$(BaseIntermediateOutputPath)\FabActUtilTemp</FabActUtilWorkingDir>
    <GenerateRuntimeConfigDevFile>true</GenerateRuntimeConfigDevFile>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.ServiceFabric.Actors" Version="8.1.208" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\<Folder>.Interfaces\<Folder>.Interfaces.csproj" />
  </ItemGroup>
</Project>
```

```xml
<!-- Actor1.Interfaces.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>True</SelfContained>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.ServiceFabric.Actors" Version="8.1.208" />
  </ItemGroup>
</Project>
```

**Key actor mechanics:**

- `<UpdateServiceFabricManifestEnabled>True</UpdateServiceFabricManifestEnabled>` triggers `Microsoft.ServiceFabric.Actors.targets` (auto-imported by the package) to regenerate `ServiceManifest.xml` at build time using the `FabActUtil.exe` tool. The on-disk template is a stub:

  ```xml
  <?xml version="1.0" encoding="utf-8"?>
  <ServiceManifest Name="<Folder>Pkg" Version="1.0.0"
                   xmlns="http://schemas.microsoft.com/2011/01/fabric"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <!-- The content will be generated during build -->
  </ServiceManifest>
  ```

- `Settings.xml` under `PackageRoot/Config/` is still emitted (same default empty `<Sections />` shape).
- The actor host's `Program.cs` uses `ActorRuntime.RegisterActorAsync<<Folder>>(…)` instead of `ServiceRuntime.RegisterServiceAsync(…)`.
- The interfaces csproj contains a single `IActor1.cs` and an assembly-level `[FabricTransportActorRemotingProvider(… V2_1 …)]` attribute.
- **Actors are NOT added to `StartupServices.xml`** — their lifecycle is managed by the Actor runtime itself, not by SF startup. The `ApplicationManifest.xml` `<ServiceManifestImport>` for an actor also has **no `<ConfigOverrides>`** (compare to the regular `<ConfigOverrides />` empty element on other kinds). See §3.5 / §3.6.
- The `.sfproj` carries a single `<ProjectReference Include="..\<Folder>\<Folder>.csproj" />` for the host. The interfaces project is **not** referenced from the .sfproj — only from the host csproj.

#### 3.4.6 / 3.4.7 / 3.4.8 — NetFramework kinds (Actor / Stateless / Stateful)

**Deferred to a later release.** The classic `<Project ToolsVersion="14.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">` shape with explicit `<Reference Include="…"><HintPath>…</HintPath></Reference>` blocks for the entire SF transitive closure (~25 references), per-Configuration `<PropertyGroup>` blocks, and a sibling `packages.config` enumerating ~12 NuGet packages plus targets-import stanzas (`Microsoft.ServiceFabric.Actors.targets` for actors) is substantially more complex than the SDK-style csproj. The reference shapes in Application1 are:

- `Stateless2-NetFramework/Stateless2-NetFramework.csproj` (~23 `<Reference>`s, 4 `<Compile>`, 4 `<None>` items, no `<Import>` of SF targets)
- `Stateful2-NetFramework/Stateful2-NetFramework.csproj` (similar)
- `Actor1-NetFramework/Actor1-NetFramework.csproj` (adds `<UpdateServiceFabricManifestEnabled>` + `<ServicePackagePath>` + `<ServicePackagePrefix>` properties and imports `Microsoft.ServiceFabric.Actors.targets` with an `EnsureNuGetPackageBuildImports` validation target)
- `Actor1-NetFramework.Interfaces/Actor1-NetFramework.Interfaces.csproj`

Noted in §9 as the next-release scaffolder work.

### 3.5 ApplicationManifest.xml — per-kind import shape

The `<ServiceManifestImport>` block patched into `ApplicationManifest.xml` differs by kind:

| Kind                              | `<ConfigOverrides />`? | `<EnvironmentOverrides>`?                | Adds `<Parameter>` to `<Parameters>`?         |
|-----------------------------------|------------------------|------------------------------------------|------------------------------------------------|
| Stateless / Stateful (.NET Core)  | yes (empty element)    | no                                       | no                                             |
| Stateless / Stateful ASP.NET Core | yes (empty element)    | yes (`ASPNETCORE_ENVIRONMENT`)           | yes (`<Folder>_ASPNETCORE_ENVIRONMENT`)        |
| Actor (.NET Core)                 | **no** (omitted)       | no                                       | no                                             |

For ASP.NET kinds:

```xml
<Parameters>
  <Parameter Name="<Folder>_ASPNETCORE_ENVIRONMENT" DefaultValue="" />
  …
</Parameters>
…
<ServiceManifestImport>
  <ServiceManifestRef ServiceManifestName="<Folder>Pkg" ServiceManifestVersion="1.0.0" />
  <ConfigOverrides />
  <EnvironmentOverrides CodePackageRef="code">
    <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value="[<Folder>_ASPNETCORE_ENVIRONMENT]" />
  </EnvironmentOverrides>
</ServiceManifestImport>
```

For Actor kinds (verbatim from Application1):

```xml
<ServiceManifestImport>
  <ServiceManifestRef ServiceManifestName="<Folder>Pkg" ServiceManifestVersion="1.0.0" />
</ServiceManifestImport>
```

For plain .NET Core stateless / stateful:

```xml
<ServiceManifestImport>
  <ServiceManifestRef ServiceManifestName="<Folder>Pkg" ServiceManifestVersion="1.0.0" />
  <ConfigOverrides />
</ServiceManifestImport>
```

Note `CodePackageRef="code"` is lowercase (matches VS verbatim despite the manifest declaring `<CodePackage Name="Code">` capitalised — SF's manifest lookup is case-insensitive but VS canonicalises the override to lowercase).

### 3.6 StartupServices.xml — per-kind entry shape

| Kind                             | Adds `<Service>` entry?          | Parameters to add                                                            |
|----------------------------------|----------------------------------|------------------------------------------------------------------------------|
| Stateless (any)                  | yes, `<StatelessService>`        | `<Folder>_InstanceCount` (default `-1`)                                      |
| Stateful (any)                   | yes, `<StatefulService>`         | `<Folder>_MinReplicaSetSize`=3, `_TargetReplicaSetSize`=3, `_PartitionCount`=1 |
| Actor (any)                      | **no entry**                     | no parameters                                                                |

Actors are activated by the actor runtime when an actor proxy resolves; they do not appear in `StartupServices.xml`.

**Critical separation of concerns** (verified from Application1):

- `ApplicationManifest.xml`'s top-level `<Parameters>` carries **only ASP.NET environment overrides** (`<Folder>_ASPNETCORE_ENVIRONMENT`). It never carries instance-count or replica-set parameters.
- `StartupServices.xml`'s top-level `<Parameters>` carries **only instance-count / replica-set / partition-count parameters**. It never carries ASP.NET environment parameters.

The scaffolder must respect this split: Add Service patches the *correct* parameter into the *correct* file (and Remove Service strips it from the *correct* file).

### 3.7 Per-environment parameter files

For every kind that contributes a `StartupServices.xml` entry (i.e. all *non-actor* kinds), each Add Service operation must also patch three sibling parameter files under `<App>/StartupServiceParameters/`:

| File                                              | Stateless `<Folder>_InstanceCount`     | Stateful `<Folder>_TargetReplicaSetSize` / `_MinReplicaSetSize` / `_PartitionCount` |
|---------------------------------------------------|----------------------------------------|--------------------------------------------------------------------------------------|
| `StartupServiceParameters/Local.1Node.xml`        | `Value="1"`                            | `1` / `1` / `1`                                                                      |
| `StartupServiceParameters/Local.5Node.xml`        | `Value="1"`                            | `3` / `3` / `1`                                                                      |
| `StartupServiceParameters/Cloud.xml`              | `Value="-1"`                           | `3` / `3` / `1`                                                                      |

For every ASP.NET kind, each Add Service operation must additionally patch one sibling parameter file under `<App>/ApplicationParameters/`:

| File                                              | `<Folder>_ASPNETCORE_ENVIRONMENT`       |
|---------------------------------------------------|-----------------------------------------|
| `ApplicationParameters/Local.1Node.xml`           | `Value="Development"`                   |
| `ApplicationParameters/Local.5Node.xml`           | `Value="Development"`                   |
| `ApplicationParameters/Cloud.xml`                 | (no entry — Cloud profile leaves it default-empty) |

These values come straight from Application1's actual files and match what VS's *Add → New Service Fabric Service…* wizard emits.

### 3.8 Operation matrix — what changes per command

The scaffolder offers two entry-points; both must produce identical results to running `Add → New SF Service…` in Visual Studio:

#### 3.8.A `Service Fabric: Create New Application…` (which always seeds one service)

Writes the entire `<App>/` skeleton (`<App>.sfproj`, `ApplicationPackageRoot/ApplicationManifest.xml`, `ApplicationParameters/{Cloud,Local.1Node,Local.5Node}.xml`, `StartupServiceParameters/{Cloud,Local.1Node,Local.5Node}.xml`, `PublishProfiles/{Cloud,Local.1Node,Local.5Node}.xml`, `StartupServices.xml`, `Scripts/Deploy-FabricApplication.ps1`, `packages.config`) **then** invokes the same Add Service code path (§3.8.B) to seed the chosen service. The seeded service must be byte-equivalent to a service produced by Add Service alone.

#### 3.8.B `Service Fabric: Add New Service…` (against an existing `.sfproj`)

For every supported kind (1–5 in scope), the operation must atomically:

1. **Create the service folder** at `<repoDir>/<Folder>/` containing:
   - `<Folder>.csproj` (per-kind shape from §3.4)
   - `Program.cs`, `<Folder>.cs`, `ServiceEventSource.cs` (or `ActorEventSource.cs` for actors)
   - `Properties/launchSettings.json` (ASP.NET only)
   - `appsettings.json` + `appsettings.Development.json` (ASP.NET only — plus `Controllers/WeatherForecastController.cs`, `WeatherForecast.cs`, `<Folder>.http`)
   - `PackageRoot/ServiceManifest.xml` (full per-kind shape — or stub for actors)
   - `PackageRoot/Config/Settings.xml` (empty `<Settings>` skeleton)
2. **For actor kinds only**, also create the sibling interfaces project at `<repoDir>/<Folder>.Interfaces/{<Folder>.Interfaces.csproj, IActor1.cs}`.
3. **Patch `<App>/<App>.sfproj`** — append `<ProjectReference Include="..\<Folder>\<Folder>.csproj" />` (with `<ServiceLaunchUrl>` child for ASP.NET kinds; bare for others). For actors, only the host appears — not the interfaces project.
4. **Patch `<App>/ApplicationPackageRoot/ApplicationManifest.xml`** — append `<ServiceManifestImport>` per §3.5; for ASP.NET kinds also append `<Parameter Name="<Folder>_ASPNETCORE_ENVIRONMENT" DefaultValue=""/>` to top-level `<Parameters>`.
5. **Patch `<App>/StartupServices.xml`** (skip for actor kinds) — append `<Service>` block per §3.6 plus the corresponding instance-count / replica-set parameters in top-level `<Parameters>`.
6. **Patch `<App>/StartupServiceParameters/{Local.1Node,Local.5Node,Cloud}.xml`** (skip for actor kinds) — add the three (stateful) or one (stateless) parameter to each, with per-environment values from §3.7.
7. **Patch `<App>/ApplicationParameters/{Local.1Node,Local.5Node}.xml`** (ASP.NET kinds only) — add `<Folder>_ASPNETCORE_ENVIRONMENT` with `Value="Development"`. Do not patch `Cloud.xml`.

All seven steps must be **transactional within the operation** (the helper either succeeds completely or rolls back). The existing `applyAddService` already follows this pattern; the new patches are added without changing the all-or-nothing semantics.

#### 3.8.C `Service Fabric: Remove Service…` (the inverse of §3.8.B)

The inverse must strip every artifact step 1–7 produced. Concretely, for the service identified by `<Folder>` (or by `<ServiceManifest Name="<Folder>Pkg">`):

1. **Delete** `<repoDir>/<Folder>/` recursively (csproj, sources, `PackageRoot/`, `Properties/`, `Controllers/`, `appsettings*.json`, etc.).
2. **For actor kinds only**, also delete `<repoDir>/<Folder>.Interfaces/` recursively.
3. **Strip from `<App>.sfproj`** — remove the matching `<ProjectReference Include="..\<Folder>\<Folder>.csproj" …/>` (and its child `<ServiceLaunchUrl>` if present).
4. **Strip from `ApplicationManifest.xml`**:
   - Remove the `<ServiceManifestImport>` whose `<ServiceManifestRef ServiceManifestName="<Folder>Pkg"/>` matches.
   - For ASP.NET kinds: remove the `<Parameter Name="<Folder>_ASPNETCORE_ENVIRONMENT"…/>` from top-level `<Parameters>`.
5. **Strip from `StartupServices.xml`** (when the kind contributed an entry):
   - Remove the `<Service Name="<Folder>">` block.
   - Remove the corresponding `<Folder>_InstanceCount` / `<Folder>_MinReplicaSetSize` / `<Folder>_TargetReplicaSetSize` / `<Folder>_PartitionCount` parameters from top-level `<Parameters>`.
6. **Strip from `StartupServiceParameters/{Local.1Node,Local.5Node,Cloud}.xml`** — remove the same per-folder parameters from each.
7. **Strip from `ApplicationParameters/{Local.1Node,Local.5Node}.xml`** (ASP.NET kinds only) — remove the `<Folder>_ASPNETCORE_ENVIRONMENT` entry from each. (`Cloud.xml` already had no entry; nothing to strip.)

Detection of the kind during Remove Service uses the on-disk `ServiceManifest.xml`: `<StatelessServiceType>` vs `<StatefulServiceType>` distinguishes stateless vs stateful, and the host csproj's `<UpdateServiceFabricManifestEnabled>` + sibling `<Folder>.Interfaces/` directory identifies actors. The presence of a `<EnvironmentOverrides>` block in the Application manifest's import (or `Microsoft.NET.Sdk.Web` in the csproj `<Project Sdk="…">`) identifies ASP.NET kinds.

Application1's `StartupServices.xml` and `ApplicationManifest.xml` contain a stale `Web1` set of references (parameters and a `<Service>` entry, plus a `Web1Pkg` import) for which no `Web1/` folder exists — a cautionary example of what happens when Remove Service forgets to strip across all five files. Our 1.1.3 implementation must guarantee no such orphans.

### 3.3 Migration from 1.1.x layout

**Out of scope for 1.1.3.** Projects scaffolded by 1.1.0 / 1.1.1 / 1.1.2 may not load cleanly into 1.1.3's tree view, but the user has explicitly de-prioritised migration: *"DO NOT WORRY ABOUT PROJECTS SCAFFOLDED WITH EARLY VERSIONS. THESE CAN BE IGNORED AT THIS TIME."* The parser may still implement a best-effort fallback (§4.6) but no test coverage or migration command is required.

## 4. Implementation

### 4.1 Service manifest builder — drop the `Code/` subfolder creation

`src/scaffold/addServiceTemplates.ts::buildServiceManifestXml` already produces the right XML. No content changes needed. The bytes go into a different on-disk location (see §4.4).

### 4.2 csproj builder — match `Microsoft.NET.Sdk.Web`, drop `<SfPackageRoot>`, drop `CopyToServiceFabricPackageRoot`, drop linked-file ItemGroup

`src/scaffold/addServiceTemplates.ts::buildCsharpCsproj` rewrites:

| 1.1.2 (current)                          | 1.1.3 (target)                                           |
|---|---|
| `<Project Sdk="Microsoft.NET.Sdk">`      | `<Project Sdk="Microsoft.NET.Sdk.Web">` for ASP.NET kinds; `Microsoft.NET.Sdk` for non-ASP.NET (unchanged for those) |
| `<SfPackageRoot>$(MSBuildThisFileDirectory)..\…</SfPackageRoot>` | **removed** |
| `<None Include="$(SfPackageRoot)\ServiceManifest.xml" Link="PackageRoot\…">` ItemGroup | **removed** — `PackageRoot/` is physical now, MSBuild sees it without help |
| `<Target Name="CopyToServiceFabricPackageRoot" AfterTargets="Build">` | **removed** — the SF Application targets pull `bin/` output directly via the `<ProjectReference>` graph |
| `<None Update="appsettings.json">` ItemGroup (ASP.NET)                                | **removed** — `Sdk.Web` already includes `appsettings*.json` with the right copy semantics; the explicit ItemGroup duplicates and diverges from VS |
| `<IsServiceFabricServiceProject>true</…>` PropertyGroup entry | **kept** — drives the SF Application targets' service-project detection |
| Self-contained props (`SelfContained`, `RuntimeIdentifier`, etc.) for `.NET Core` | **kept** |

Use the canonical shapes documented in §3.4 (verified verbatim from Application1) as the source of truth. The Sparrow csproj contains a few hand-edits (`TargetLatestRuntimePatch`, `PublishSingleFile=false`, `PublishReadyToRun=false`) that are not part of VS's template output — **do not emit those**. Match the §3.4 shape exactly.

### 4.3 Apply step — write `<Service>/PackageRoot/{ServiceManifest.xml, Config/Settings.xml}`

`src/scaffold/addServiceApply.ts::applyAddService` and `src/scaffold/createApplicationApply.ts::applyCreateApplication`:

1. Compute `<csprojDir> = <repoDir>/<ServiceFolder>` exactly as today.
2. **New** — write the canonical manifest to `<csprojDir>/PackageRoot/ServiceManifest.xml` and `<csprojDir>/PackageRoot/Config/Settings.xml`.
3. **Removed** — no longer create `<App>/ApplicationPackageRoot/<Service>Pkg/{ServiceManifest.xml, Config/Settings.xml, Code/}`. The application's `ApplicationPackageRoot/` only ever contains `ApplicationManifest.xml`.
4. `AddServiceResult.serviceManifestPath` now points at `<csprojDir>/PackageRoot/ServiceManifest.xml`.
5. The `<ProjectReference>` patch in `<App>/<App>.sfproj` is unchanged: `<ProjectReference Include="..\<ServiceFolder>\<csproj>.csproj" />`.

For non-C# kinds (Guest):

- The Guest case is special — there is no companion C# project, so the canonical `PackageRoot/` has nowhere to live as a sibling. Keep guest-only behaviour as today (write under `<App>/ApplicationPackageRoot/<Service>Pkg/`) and document the carve-out. Guests are a small minority of users; mixing their layout with the C# layout doesn't break VS opens.

### 4.4 Apply step — drop the `Code/` directory writes

`<App>/ApplicationPackageRoot/<Service>Pkg/Code/` is no longer pre-created. The SF Application targets compose `pkg/.../<Service>Pkg/Code/` at build time from the C# project's `bin/` output via the `<ProjectReference>` graph; an empty `Code/` next to `ServiceManifest.xml` is just visual clutter and conflicts with VS's behaviour.

### 4.4a ASP.NET Program.cs — drop dual-mode, align with VS

1.1.2 emits a dual-mode `Program.cs` so `dotnet run` works as a standalone Kestrel host *and* the assembly registers as an SF service when activated by the runtime. VS's template does **not** do this — the canonical `Program.cs` only calls `ServiceRuntime.RegisterServiceAsync("<Folder>Type", context => new <FolderClassName>(context))` and the web host is created inside the service class via `CreateServiceInstanceListeners` returning `KestrelCommunicationListener`.

Decision: **drop dual-mode.** Match VS exactly so:
- The scaffolded ASP.NET project is recognisable to VS users.
- F5 from VS hits the same code path as `Service Fabric: Publish Application…`.
- We don't carry an extra entry-point branch through future maintenance.

If a user wants standalone `dotnet run` for inner-loop development, they add a launchProfile pointing at a separate `dev` project or use F5 against the SF cluster (1-node local cluster is the canonical inner-loop story).

`Properties/launchSettings.json` for ASP.NET kinds is still emitted (matches VS — single `http` profile with `applicationUrl` and `ASPNETCORE_ENVIRONMENT=Development`).

### 4.4b `<ServiceLaunchUrl>` metadata on ASP.NET ProjectReferences

For every ASP.NET kind added via Add Service / Create Application, the `<ProjectReference>` patched into `<App>.sfproj` carries a `<ServiceLaunchUrl>` child element:

```xml
<ProjectReference Include="..\<Folder>\<Folder>.csproj">
  <ServiceLaunchUrl>http://localhost:{ServicePort}/</ServiceLaunchUrl>
</ProjectReference>
```

The `{ServicePort}` token is replaced by VS at F5 time with the port from the ServiceManifest's `<Endpoint Port="…">`. Non-ASP.NET kinds use the bare `<ProjectReference Include="…" />` with no metadata.

### 4.5 Auto-restore NuGet packages so MSBuild finds the Application targets

Three viable strategies; pick #2 for 1.1.3:

1. **Run `nuget.exe restore <App>.sfproj`** before every `Package` target. Pros: matches VS's behaviour exactly. Cons: requires `nuget.exe` on PATH; the extension would have to bundle or locate it.
2. **Run `msbuild <App>.sfproj /t:Restore`** as a pre-step before every `Package` task. MSBuild understands `<packages.config>` via the `Microsoft.Build.NuGetSdkResolver` / `RestoreUseLegacyImports` machinery in modern MSBuild (17+), and the `nuget restore` shim is exposed via the `/t:Restore` target. The same `msbuild.exe` we already locate handles it. **Chosen** — no new dependency, leverages the locator we already have.
3. **Eagerly populate `<workspace>/packages/Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.6/`** during scaffold by downloading the .nupkg from `https://api.nuget.org/v3-flatcontainer/microsoft.visualstudio.azure.fabric.msbuild/1.7.6/microsoft.visualstudio.azure.fabric.msbuild.1.7.6.nupkg`, unzipping `build/` into the right path. Pros: scaffold result builds with no internet at build time. Cons: requires network at scaffold time and adds a download surface to the extension.

**Decision:** implement strategy #2 in `src/build/taskProvider.ts`. Concretely:

- Add a new helper `buildRestoreTask(projectPath)` that returns a `vscode.Task` running `msbuild <project> /t:Restore`.
- In `src/deploy/deployFlow.ts::deployCommand`, run the restore task *before* the existing `buildTask(... 'Package')` task. Reuse the existing `vscode.tasks.onDidEndTaskProcess` plumbing.
- In `src/extension.ts`, the `serviceFabric.package` command also runs Restore first. Restore is idempotent — when packages are present it exits in <1s.
- Restore output streams into the same task panel as `Package`.

Sparrow's `<ValidateMSBuildFiles>` target is also added to the generated `.sfproj` so a future fresh-clone failure surfaces *"Please restore the Microsoft.VisualStudio.Azure.Fabric.MSBuild Nuget package"* instead of the cryptic MSB4057.

### 4.6 Parser, tree, remove — accept both old + new layouts

`src/project/sfprojParser.ts::loadApplicationProject` already discovers service manifests by reading `<ApplicationManifest>`'s `<ServiceManifestImport>` blocks and resolving `<ServiceManifestRef ServiceManifestName="..."/>` against on-disk `ServiceManifest.xml`. Today it looks under `<App>/ApplicationPackageRoot/<Pkg>/ServiceManifest.xml` *only*. New behaviour:

1. For each `<ServiceManifestImport>`, attempt to locate `ServiceManifest.xml` in this priority order:
   - Walk every `<ProjectReference>` in `<App>/<App>.sfproj`. For each referenced csproj's directory, check `<csprojDir>/PackageRoot/ServiceManifest.xml`. If its `<ServiceManifest Name="…">` matches the imported package name, bind it.
   - Fall back to `<App>/ApplicationPackageRoot/<Pkg>/ServiceManifest.xml` (legacy 1.1.x layout).
   - Fall back to `<App>/ApplicationPackageRoot/<Pkg.replace(/Pkg$/,'')>/ServiceManifest.xml` (defensive).
2. The parsed `ServiceManifest` model surfaces `packageDirectory` pointing at the *parent of `ServiceManifest.xml`* — for new projects this is `<csprojDir>/PackageRoot/`, for legacy projects this is `<App>/ApplicationPackageRoot/<Pkg>/`. The remove-service / settings-edit / publish flows all key off `packageDirectory` and continue to work unchanged.

`src/scaffold/removeServiceApply.ts` must guarantee the **comprehensive cleanup** described in §3.8.C \u2014 every artifact created by Add Service is reversed. The current 1.1.2 implementation strips the `<ServiceManifestImport>` and `<ProjectReference>` and deletes the package folder; that is *insufficient*. The new behaviour, driven off the parsed `ServiceManifest` model and the kind detected from disk:

1. Delete `<csprojDir>/` recursively (covers the C# project + `PackageRoot/` in the new layout).
2. **For actor kinds**, additionally delete `<csprojDir>.Interfaces/` recursively. Detection: presence of `<UpdateServiceFabricManifestEnabled>True</…>` in the host csproj or presence of the sibling `<Folder>.Interfaces/` directory.
3. Strip the matching `<ProjectReference>` from `<App>.sfproj`.
4. Strip the matching `<ServiceManifestImport>` from `<App>/ApplicationPackageRoot/ApplicationManifest.xml`. **For ASP.NET kinds**, also strip `<Parameter Name="<Folder>_ASPNETCORE_ENVIRONMENT" \u2026/>` from the manifest's top-level `<Parameters>`. Detection: the import's `<EnvironmentOverrides>` block presence, or the host csproj's `Sdk="Microsoft.NET.Sdk.Web"`.
5. **Skipped for actors.** Strip the matching `<Service Name="<Folder>">` block from `<App>/StartupServices.xml` and remove its `<Folder>_InstanceCount` (stateless) or `<Folder>_MinReplicaSetSize`/`_TargetReplicaSetSize`/`_PartitionCount` (stateful) parameters from top-level `<Parameters>`.
6. **Skipped for actors.** Strip the same per-folder parameters from each of `<App>/StartupServiceParameters/{Local.1Node,Local.5Node,Cloud}.xml`.
7. **ASP.NET kinds only.** Strip the `<Folder>_ASPNETCORE_ENVIRONMENT` parameter from each of `<App>/ApplicationParameters/{Local.1Node,Local.5Node}.xml`. (`Cloud.xml` had no entry to begin with.)

Acceptance: after removing every service from a multi-service application, *all five* files (`<App>.sfproj`, `ApplicationManifest.xml`, `StartupServices.xml`, plus the three `StartupServiceParameters/*.xml` and the two `ApplicationParameters/*.xml`) have **empty** top-level `<Parameters>` blocks and **no** `<ServiceManifestImport>` / `<Service>` / `<ProjectReference>` entries. No orphan parameters, no orphan service entries, no orphan project references \u2014 contrast with Application1's stale `Web1` orphans which must not be reproducible by our scaffolder.

The tree-view (`src/views/explorerView.ts`) renders services from the parsed model, so no changes needed there once the parser handles both layouts.

### 4.7 Settings.xml authoring helper

`<csprojDir>/PackageRoot/Config/Settings.xml` is created with the existing `buildSettingsXml(t)`. No template change.

### 4.8 ApplicationManifest.xml seed — drop the empty service-package directory creation

`createApplicationApply.ts` currently creates `<App>/ApplicationPackageRoot/<Service>Pkg/{ServiceManifest.xml, Code/, Config/Settings.xml}` for the seeded service. Delete those lines. The seeded service's manifest goes to `<csprojDir>/PackageRoot/` per §4.3.

### 4.9 Edit-service helpers (Settings.xml / ServiceManifest.xml)

Wherever the existing flow opens or rewrites `ServiceManifest.xml` / `Settings.xml`, the path comes from `ServiceManifest.path` / `ServiceManifest.packageDirectory`. The parser change in §4.6 means these continue to point at the right files for both layouts.

## 5. Detailed file-by-file change list

| File | Change |
|---|---|
| `src/scaffold/addServiceTemplates.ts` | `buildCsharpCsproj`: switch `Microsoft.NET.Sdk.Web` for ASP.NET; remove `<SfPackageRoot>`; remove `linkedPackageRoot` ItemGroup; remove `CopyToServiceFabricPackageRoot` AfterBuild target; **remove `<None Update="appsettings*.json">` ItemGroup** (Sdk.Web auto-includes); add `<RootNamespace>` only when folder name contains `-`; bump ASP.NET TFM to `net9.0`; pin `Microsoft.AspNetCore.OpenApi 9.0.15` + `Microsoft.ServiceFabric.AspNetCore.Kestrel 8.1.208` for ASP.NET, `Microsoft.ServiceFabric.Services 8.1.208` for plain C#. |
| `src/scaffold/addServiceTemplates.ts` | `buildServiceManifestXml`: add `<WorkingFolder>CodePackage</WorkingFolder>` + `<EnvironmentVariables>ASPNETCORE_ENVIRONMENT</EnvironmentVariables>` for ASP.NET kinds. Stateful ASP.NET emits **no** `<Resources>` block. |
| `src/scaffold/addServiceTemplates.ts` | `buildCsharpProgramCs`: drop dual-mode for ASP.NET; emit the VS-canonical single-purpose `ServiceRuntime.RegisterServiceAsync` shape. |
| `src/scaffold/addServiceTemplates.ts` | `patchSfprojForProjectReference`: emit `<ServiceLaunchUrl>http://localhost:{ServicePort}/</ServiceLaunchUrl>` child on `<ProjectReference>` for ASP.NET kinds only. |
| `src/scaffold/addServiceTemplates.ts` (or new `applicationManifestPatch.ts`) | When adding an ASP.NET kind, append `<Parameter Name="<Folder>_ASPNETCORE_ENVIRONMENT" DefaultValue=""/>` to `<Parameters>` and emit `<EnvironmentOverrides CodePackageRef="code"><EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value="[<Folder>_ASPNETCORE_ENVIRONMENT]"/></EnvironmentOverrides>` inside the new `<ServiceManifestImport>`. **For Actor kinds**, omit `<ConfigOverrides />` from the `<ServiceManifestImport>` and skip the `StartupServices.xml` patch entirely. |
| `src/scaffold/addServiceTemplates.ts` | **New** `buildActorHostCsproj` + `buildActorInterfacesCsproj` + `buildActorProgramCs` + `buildActorClassCs` + `buildActorInterfaceCs` + `buildActorEventSourceCs` builders. Host csproj adds `<UpdateServiceFabricManifestEnabled>True</…>`, `<ServicePackagePath>PackageRoot</…>`, `<ServicePackagePrefix>$(MSBuildProjectName)</…>`, `<FabActUtilWorkingDir>…</…>`, `<GenerateRuntimeConfigDevFile>true</…>` and `Microsoft.ServiceFabric.Actors 8.1.208` PackageReference; references the sibling `<Folder>.Interfaces` project. Manifest stub is the empty `<!-- The content will be generated during build -->` shell. |
| `src/scaffold/addServiceApply.ts::scaffoldActorProject` | **New** sibling-pair scaffold: writes `<Folder>/{<Folder>.csproj, Program.cs, <Folder>.cs, ActorEventSource.cs, PackageRoot/ServiceManifest.xml (stub), PackageRoot/Config/Settings.xml}` AND `<Folder>.Interfaces/{<Folder>.Interfaces.csproj, IActor1.cs}`. Patches the `.sfproj` with a single `<ProjectReference>` for the host (interfaces csproj is referenced from the host, not from the .sfproj). |
| `src/scaffold/createApplicationTemplates.ts` | Bump `packages.config` pin to `Microsoft.VisualStudio.Azure.Fabric.MSBuild` `1.7.9` (was 1.7.6). Update `<Import>` paths in the `.sfproj` template to match. |
| `src/scaffold/addServiceTemplates.ts` | Add `buildSfprojValidateTargetXml()` helper for the `<Target Name="ValidateMSBuildFiles">` block (shared with `createApplicationTemplates`). |
| `src/scaffold/createApplicationTemplates.ts` | Append `<Target Name="ValidateMSBuildFiles" BeforeTargets="PrepareForBuild">…` to the `.sfproj` body so MSB4057 becomes a friendlier message on fresh clones. |
| `src/scaffold/addServiceApply.ts::scaffoldCsharpProject` | Write `<csprojDir>/PackageRoot/ServiceManifest.xml` + `<csprojDir>/PackageRoot/Config/Settings.xml`. Stop writing `<App>/ApplicationPackageRoot/<Service>Pkg/`. Update `AddServiceResult.serviceManifestPath` to the new location. |
| `src/scaffold/addServiceApply.ts::applyAddService` | Move guest-vs-csharp branch up: Guests still write under `<App>/ApplicationPackageRoot/<Service>Pkg/`. C# kinds skip the App-side write entirely. |
| `src/scaffold/createApplicationApply.ts::applyCreateApplication` | Same physical-PackageRoot move for the seeded service. Remove the `<App>/ApplicationPackageRoot/<Service>Pkg/` directory creation for C# kinds. |
| `src/scaffold/createApplicationApply.ts::scaffoldSeededCsharpProject` | Mirror of the addServiceApply change. |
| `src/project/sfprojParser.ts` | Locate `ServiceManifest.xml` via `<ProjectReference>`-walk first, then fall back to `<App>/ApplicationPackageRoot/<Pkg>/`. |
| `src/build/taskProvider.ts` | Add `buildRestoreTask(projectPath)` returning `msbuild <project> /t:Restore`. |
| `src/deploy/deployFlow.ts::deployCommand` | Run `buildRestoreTask` before the existing `buildTask(... 'Package')`. |
| `src/extension.ts::runMsBuildTarget` | When the requested target is `Package`, run Restore first (idempotent). |
| `src/scaffold/removeServiceApply.ts` | **Major rewrite.** Implement comprehensive cleanup per §3.8.C / §4.6: delete `<csprojDir>/` (and `<csprojDir>.Interfaces/` for actors), strip `<ProjectReference>` from `.sfproj`, strip `<ServiceManifestImport>` + `<Folder>_ASPNETCORE_ENVIRONMENT` parameter from ApplicationManifest, strip `<Service>` block + instance/replica parameters from StartupServices.xml (skip for actors), strip per-folder parameters from each `StartupServiceParameters/{Local.1Node,Local.5Node,Cloud}.xml` (skip for actors), strip `<Folder>_ASPNETCORE_ENVIRONMENT` from each `ApplicationParameters/{Local.1Node,Local.5Node}.xml` (ASP.NET only). |
| `src/scaffold/addServiceApply.ts::applyAddService` | After steps 1–5 (folder + manifest + sfproj + ApplicationManifest + StartupServices), add **step 6/7**: patch each `StartupServiceParameters/*.xml` with per-environment instance/replica values from §3.7 (skip for actors); patch `ApplicationParameters/{Local.1Node,Local.5Node}.xml` with `<Folder>_ASPNETCORE_ENVIRONMENT` `Value="Development"` (ASP.NET only). |
| `src/scaffold/createApplicationApply.ts::applyCreateApplication` | Mirror the new step 6/7 patches for the seeded service so Create Application + seeded service is byte-equivalent to Create Application (empty) + Add Service. |
| `src/scaffold/applicationManifestPatch.ts` (new helper, or extend existing) | Functions: `addServiceImport(kind, folder)`, `removeServiceImport(folder)`, `addAspNetEnvParam(folder)`, `removeAspNetEnvParam(folder)`. |
| `src/scaffold/startupServicesPatch.ts` (new helper) | Functions: `addServiceEntry(kind, folder)`, `removeServiceEntry(folder)`, `addInstanceCountParams(kind, folder)`, `removeInstanceCountParams(folder)`. Operates on `<App>/StartupServices.xml`. |
| `src/scaffold/parameterFilesPatch.ts` (new helper) | Functions: `patchStartupServiceParameters(folder, kind, env, action: 'add'|'remove')` and `patchApplicationParameters(folder, env, action)`. Operates on each of the three `StartupServiceParameters/*.xml` and two `ApplicationParameters/*.xml` files. |
| `docs/HOWTO.md` §11.1 + §11.2 + §11.3 | Update project-tree diagrams. Document the layout, the `<ValidateMSBuildFiles>` target, and the implicit Restore. |
| `CHANGELOG.md` | New `## 1.1.3` entry. |
| `package.json` / `package-lock.json` | Bump `1.1.2 → 1.1.3`. |

## 6. Test plan

### 6.1 Unit-level

- `buildCsharpCsproj` ASP.NET kind asserts `Sdk="Microsoft.NET.Sdk.Web"`, no `<SfPackageRoot>`, no `linkedPackageRoot` ItemGroup, no `CopyToServiceFabricPackageRoot` target, still has `<IsServiceFabricServiceProject>`.
- `buildCsharpCsproj` non-ASP.NET kinds keep `Microsoft.NET.Sdk` and no `<SfPackageRoot>`/AfterBuild target either.
- `buildSfprojXml` includes the `<ValidateMSBuildFiles>` target.
- `applyAddService` (stateless C#) writes `MyApp.Service1/PackageRoot/ServiceManifest.xml` + `MyApp.Service1/PackageRoot/Config/Settings.xml`. Asserts the App-side `<App>/ApplicationPackageRoot/<Service>Pkg/` was **not** created.
- `applyAddService` (stateless ASP.NET Core) ditto plus appsettings.* + Properties/launchSettings.json + Controllers/ValuesController.cs (carry-over from 1.1.2).
- `applyAddService` (guest) keeps writing under `<App>/ApplicationPackageRoot/<Service>Pkg/` and asserts no sibling C# folder.
- `applyAddService` patches the **three** `StartupServiceParameters/*.xml` files with the per-environment values from \u00a73.7 (stateless = 1 entry, stateful = 3 entries).\n- `applyAddService` (ASP.NET kinds) patches `ApplicationParameters/Local.1Node.xml` and `Local.5Node.xml` with `<Folder>_ASPNETCORE_ENVIRONMENT` `Value=\"Development\"` and leaves `Cloud.xml` untouched.\n- `applyAddService` (actor kinds) makes **no** edits to `StartupServices.xml`, `StartupServiceParameters/*.xml`, or `ApplicationParameters/*.xml`. Sibling `<Folder>.Interfaces/` folder is created with its own csproj.\n- `applyCreateApplication` (stateless ASP.NET Core seed) writes the seeded service's `PackageRoot/` under the sibling csproj folder. Asserts the App's `ApplicationPackageRoot/` contains *only* `ApplicationManifest.xml`. **Asserts byte-equivalence**: produces the same on-disk state as Create Application (empty) + Add Service of the same kind.\n- `loadApplicationProject` parses a fixture using the new layout and surfaces `serviceManifests[i].path === <csprojDir>/PackageRoot/ServiceManifest.xml` and `packageDirectory === <csprojDir>/PackageRoot`.\n- `loadApplicationProject` parses a 1.1.2-style legacy fixture (manifest under `<App>/ApplicationPackageRoot/<Pkg>/`) and binds it via the fallback path.\n- `applyRemoveService` round-trips Add+Remove on the new layout per \u00a73.8.C: after remove, every one of the seven mutation sites (\u00a73.8.B) is byte-identical to its pre-Add state. Specifically: the `<ServiceManifestImport>` is gone; the `<Folder>_ASPNETCORE_ENVIRONMENT` parameter is gone from ApplicationManifest *and* both `ApplicationParameters/Local.*.xml` (ASP.NET cases); the `<Service>` block + instance/replica parameters are gone from StartupServices.xml; the per-folder parameters are gone from all three `StartupServiceParameters/*.xml`; the `<ProjectReference>` is gone from `.sfproj`; the `<csprojDir>/` is deleted; the `<csprojDir>.Interfaces/` is also deleted for actors.\n- `applyRemoveService` round-trips on a legacy fixture (synthesised in-test) and still cleans `<App>/ApplicationPackageRoot/<Pkg>/` *and* the `<ServiceFolder>/`.\n- **Multi-service round-trip**: scaffold an Application with three services (one stateless, one stateful, one ASP.NET), then Remove all three in random order, asserting that all five App-level XML files end with empty `<Parameters>` blocks and no service-related entries (no orphans \u00e0 la Application1's stale `Web1`).

### 6.2 Existing tests to update

- 1.1.2's csproj-shape tests (`linkedPackageRoot`, `appsettingsItems`, `<SfPackageRoot>`) — drop the linked-file assertions, keep the appsettings ones, drop `<SfPackageRoot>`.
- 1.1.2's apply tests asserting `<App>/ApplicationPackageRoot/<Service>Pkg/ServiceManifest.xml` exists — update path expectation to `<ServiceFolder>/PackageRoot/ServiceManifest.xml`.
- Existing parser tests for `Voting` fixture — fixture is legacy-style, must keep passing via the fallback path.

### 6.3 End-to-end (manual, on Windows with VS workloads installed)

Per `docs/HOWTO.md`'s ✅-acceptance list (revised in §7 below):

1. `Service Fabric: Create New Application…` → kind *Stateless ASP.NET Core*, app `Demo`, service `Demo.Web`.
2. From `Demo/`, run **Service Fabric: Package Application**. Expect: succeeds. The Restore pre-step downloads `Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.6` into `<workspace>/packages/`. The `Package` target produces `Demo/pkg/Debug/Demo/Demo.WebPkg/{ServiceManifest.xml, Code/Demo.Web.exe, Config/Settings.xml}`.
3. From `Demo.Web/`, run `dotnet run`. Expect: Kestrel binds `http://localhost:8080`; `curl http://localhost:8080/api/values` → `["value1","value2"]`.
4. From `Demo/`, run **Service Fabric: Publish Application…** → *Local.1Node*. Expect: succeeds; the deployed app's gateway URL serves `/api/values`.
5. **Service Fabric: Add New Service…** with kind *Stateful*, name `Demo.Audit`. Expect: a new `Demo.Audit/` folder with its own `PackageRoot/` exists; `Demo/.sfproj` has a new `<ProjectReference>`; `StartupServices.xml` has a new `<Service Name="Demo.Audit">` block + three new `<Parameter>` entries; each of `StartupServiceParameters/{Cloud,Local.1Node,Local.5Node}.xml` has the three new instance/replica parameters with the per-environment values from §3.7; the App's `ApplicationPackageRoot/` still contains only `ApplicationManifest.xml`.
6. **Service Fabric: Remove Service…** on `Demo.Web`. Expect: the `Demo.Web/` folder is gone; `Demo.sfproj`'s `<ProjectReference>` for `Demo.Web` is gone; `ApplicationManifest.xml`'s `<ServiceManifestImport ServiceManifestRef="Demo.WebPkg">` is gone *and* the `Demo.Web_ASPNETCORE_ENVIRONMENT` parameter is gone from its top-level `<Parameters>`; `StartupServices.xml` no longer has `<Service Name="Demo.Web">` and its `Demo.Web_InstanceCount` parameter is gone; each of `StartupServiceParameters/{Cloud,Local.1Node,Local.5Node}.xml` no longer has `Demo.Web_InstanceCount`; `ApplicationParameters/{Local.1Node,Local.5Node}.xml` no longer has `Demo.Web_ASPNETCORE_ENVIRONMENT`; the App's `ApplicationPackageRoot/` is unchanged.
7. **Service Fabric: Remove Service…** on `Demo.Audit` (the only remaining service). Expect: every one of the five App-level XML files (`ApplicationManifest.xml`, `StartupServices.xml`, three `StartupServiceParameters/*.xml`, two `ApplicationParameters/*.xml`) has an *empty* `<Parameters>` block — no orphan parameters left behind.
8. Open `Demo/Demo.sfproj` in Visual Studio 2022. Expect: VS prompts to create a `.sln`, and once created the Solution Explorer shows a real `PackageRoot/{ServiceManifest.xml, Config/Settings.xml}` folder under each surviving C# service project (no virtual links).

## 7. Acceptance criteria

- [ ] `Service Fabric: Create New Application…` (ASP.NET kind) produces the §3.1 layout exactly.
- [ ] The seeded service's manifest is at `<ServiceFolder>/PackageRoot/ServiceManifest.xml`. `<App>/ApplicationPackageRoot/` contains only `ApplicationManifest.xml`.
- [ ] **Service Fabric: Package Application** succeeds out of the box on a fresh-cloned workspace (Restore runs first; SF Application targets resolve; `pkg/<Cfg>/<App>/` is populated).
- [ ] **Service Fabric: Publish Application…** to a local cluster succeeds.
- [ ] **Service Fabric: Add New Service…** appends a new sibling folder with its own `PackageRoot/`. The App-side `ApplicationPackageRoot/` is not modified. **All seven mutation sites in §3.8.B are patched** (sfproj, ApplicationManifest, StartupServices, three StartupServiceParameters/*.xml, plus two ApplicationParameters/*.xml for ASP.NET kinds). Actor kinds skip StartupServices.xml + StartupServiceParameters + ApplicationParameters and additionally create a sibling `<Folder>.Interfaces/` project.
- [ ] **Create Application + seeded service** is *byte-equivalent* to **Create Application (empty) + Add Service** of the same kind/name (verified by automated diff in tests).
- [ ] **Service Fabric: Remove Service…** reverses *every* artifact created by Add Service per §3.8.C. After removing every service from a multi-service application, all five App-level XML files (`ApplicationManifest.xml`, `StartupServices.xml`, three `StartupServiceParameters/*.xml`, two `ApplicationParameters/*.xml`) have empty `<Parameters>` blocks and no `<ServiceManifestImport>` / `<Service>` / `<ProjectReference>` entries. Legacy 1.1.x projects continue to clean their App-side `<Service>Pkg/` folders too.
- [ ] Opening the `.sfproj` in Visual Studio 2022 shows the same tree VS would produce from its own *Service Fabric Application* template, including the `PackageRoot/` node under each C# service project.
- [ ] All unit tests pass. Estimated final count: **235 → ~248**.
- [ ] No regression for projects that were scaffolded under 1.1.0 / 1.1.1 / 1.1.2 — they still load, build, package, publish, add-service, remove-service.

## 8. Tracking

| Phase | Files touched | Tests added | Tests adjusted |
|---|---|---|---|
| A — csproj + sfproj template rewrite | `addServiceTemplates.ts`, `createApplicationTemplates.ts` | ~4 | ~3 |
| B — apply step file-layout move | `addServiceApply.ts`, `createApplicationApply.ts` | ~4 | ~4 |
| C — parser fallback | `sfprojParser.ts` | ~2 | 0 |
| D — Restore pre-step | `taskProvider.ts`, `deployFlow.ts`, `extension.ts` | ~1 (locator/task shape) | 0 |
| E — Remove-service legacy/new dual coverage | (no source changes) | ~2 | ~2 |
| F — Docs + version bump | `HOWTO.md`, `CHANGELOG.md`, `package.json`, `package-lock.json` | 0 | 0 |

Estimated final count: **235 → ~248 tests** after Phase F, all passing.

## 9. Out of scope

- Generating a `.sln` file (1.1.2 decision stands — VS auto-creates one on open).
- **.NET Framework service kinds** — Actor-NetFramework, Stateless-NetFramework, Stateful-NetFramework (kinds 6, 7, 8 in §1). Each requires emitting a classic `<Project ToolsVersion="14.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">` csproj with ~25 explicit `<Reference><HintPath>..\packages\…</HintPath></Reference>` items, per-Configuration `<PropertyGroup>` blocks for Debug|x64 and Release|x64, a sibling `packages.config`, an `App.config` with binding redirects, a `Properties/AssemblyInfo.cs`, and (for actors) the `Microsoft.ServiceFabric.Actors.targets` import + `EnsureNuGetPackageBuildImports` validation target. The scaffolder currently has no code path for emitting classic csprojs; adding it is a substantial separate effort (~6 additional templates, ~20 additional tests) and is tracked for **1.2.0**.
- `.NET Framework` ASP.NET parity (still no VS template for this combination — not in current Add Service matrix).
- Bundling NuGet/MSBuild assets — we rely on the user's installed MSBuild (already located by `locateMsBuild`) and on `nuget.org` reachability for the Restore step.
- Sparrow-specific extras (`[BuildVersion]` token substitution, `Directory.Build.props`, decoupled csproj/folder names, multi-project sub-trees, scalar `<ServiceLaunchUrl>`). These are hand-edits the Sparrow author made post-generation and are not part of the VS template default.
- Migration of pre-1.1.3 generated projects (per user direction — see §3.3).
