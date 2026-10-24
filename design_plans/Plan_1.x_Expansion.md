# Plan — 1.x Expansion: Service Fabric template matrix + StartupServices.xml-first wiring

Reference document for the work tracked under the **Add Service template expansion** feature. Captures scope, design decisions, and open questions so the implementation can be picked up across sessions without re-deriving context.

> Status: **planning**. No code has been written yet against this plan; the goal of this document is to ratify the shape before implementation.

## 1. Goal

Bring **Add Service** and **Create New Application…** to feature-parity with Visual Studio's *New Service Fabric Service…* dialog by expanding the supported service kinds, splitting the runtime axis (.NET Core vs .NET Framework), and switching new services to wire into `StartupServices.xml` by default.

Verbatim user request:

> Visual Studio has a few templates for Stateful and stateless services. There are the simple ones we have right now. There are web-api-based templates.
>
> Plan then create built-in scaffolding (where applicable) when **Add Service** is invoked for the following:
>
> **.NET Core**
> 1. Stateless Service — build a .NET Core stateless service.
> 2. Stateful Service — build a stateful .NET Core service with persistent internal state using the reliable-collections framework.
> 3. Actor Service — build a .NET Core service using the virtual-actor pattern.
> 4. Stateless ASP.NET Core (with default controllers).
> 5. Stateful ASP.NET Core — build a stateful ASP.NET Core service with persistent internal state using the reliable-collections framework (with default controllers).
>
> **.NET Framework**
> 1. Stateless Service — build a .NET Framework stateless service.
> 2. Stateful Service — build a stateful .NET Framework service with persistent internal state using the reliable-collections framework.
> 3. Actor Service — build a .NET Core (sic) service using the virtual-actor pattern.
>
> **Hosted Containers and Applications**
> 1. Guest Executable — run a self-contained application (such as Node.js, Java, or a native application) in your Service Fabric cluster.
>
> When **Create Application** is called, it should also prompt for what type of service should be added and wired up.
>
> When a new service is added it should get wired up into `StartupServices.xml` by default.

## 2. Type system

Expand `ServiceKind` (currently `'stateless' | 'stateful' | 'guest'`) to cover all VS templates and add an orthogonal runtime axis:

```ts
type ServiceKind =
  | 'stateless'         // Reliable Stateless service
  | 'stateful'          // Reliable Stateful service (reliable collections)
  | 'actor'             // Virtual-actor service (Actors framework)
  | 'aspNetStateless'   // Stateless ASP.NET Core (Kestrel + controllers)
  | 'aspNetStateful'    // Stateful ASP.NET Core (Kestrel + controllers, reliable collections)
  | 'guest';            // Guest executable (no runtime axis)

type ServiceRuntime = 'netcore' | 'netfx';

// Valid combinations (matches VS):
// netcore × { stateless, stateful, actor, aspNetStateless, aspNetStateful }
// netfx   × { stateless, stateful, actor }
// (guest has no runtime axis)
```

The pick-list shown in **Add Service** mirrors the VS *New Service Fabric Service* dialog grouping:

```
.NET Core
   • Stateless Service
   • Stateful Service
   • Actor Service
   • Stateless ASP.NET Core
   • Stateful ASP.NET Core

.NET Framework
   • Stateless Service
   • Stateful Service
   • Actor Service

Hosted Containers and Applications
   • Guest Executable
```

Implementation note: the existing `isCsharpKind` helper becomes `isCsharpKind(kind: ServiceKind): kind is 'stateless' | 'stateful' | 'actor' | 'aspNetStateless' | 'aspNetStateful'` (everything except `guest`). Existing call sites need a recompile but no logic changes — the boolean answer is the same for the three kinds we already ship.

## 3. Templates — what each kind produces

| Kind | Generated files | NuGet refs | Manifest service block | Note |
|---|---|---|---|---|
| `stateless` (netcore/netfx) | `Program.cs` + `<Name>.cs` (subclasses `StatelessService`) | `Microsoft.ServiceFabric.Services` | `<StatelessServiceType>` + default service | Already exists; re-skin with runtime axis. |
| `stateful` (netcore/netfx) | `Program.cs` + `<Name>.cs` (subclasses `StatefulService`, demos `IReliableDictionary`) | `Microsoft.ServiceFabric.Services` + `Microsoft.ServiceFabric.Data` | `<StatefulServiceType HasPersistedState="true">` | Already exists; re-skin. |
| `actor` (netcore/netfx) | `Program.cs` + `<Actor>.cs` (subclasses `Actor`, implements `I<Actor>`) + `I<Actor>.cs` (interface) | `Microsoft.ServiceFabric.Actors` | `<StatefulServiceType ServiceTypeName="<Actor>ActorServiceType" HasPersistedState="true">` (registered via `ActorRuntime.RegisterActorAsync`) | New. Single-project layout for simplicity (VS produces a separate `<Actor>.Interfaces` csproj). |
| `aspNetStateless` | `Program.cs` (Kestrel host) + `<Name>.cs` (`StatelessService` returning a `KestrelCommunicationListener`) + `Controllers/ValuesController.cs` + `appsettings.json` | `Microsoft.ServiceFabric.AspNetCore.Kestrel` + `Microsoft.AspNetCore.App` framework ref | `<StatelessServiceType>` + `<Endpoint Name="ServiceEndpoint" Protocol="http">` | New. |
| `aspNetStateful` | `Program.cs` + `<Name>.cs` (subclasses `StatefulService`) + `Controllers/ValuesController.cs` | + `Microsoft.ServiceFabric.Data` | `<StatefulServiceType HasPersistedState="true">` | New. |
| `guest` | Copies user payload into `Code/` | none | `<StatelessServiceType UseImplicitHost="true">` | Already exists; unchanged. |

For `.NET Framework` runtime: emit the **same C#** but set the `.csproj` `<TargetFramework>` to `net472`. The csproj stays SDK-style — VS itself emits legacy csprojs for SF .NET Framework projects, but the SDK-style equivalent compiles the same code with the same NuGet refs and is dramatically less template noise. We already accept `net472` as a TFM choice today, so this is a small extension of an existing convention.

### 3.1. Self-contained publish by default

Every generated `.csproj` for the C# kinds (`stateless`, `stateful`, `actor`, `aspNetStateless`, `aspNetStateful` — both runtimes) ships with self-contained deployment turned on so the target Service Fabric node does **not** need the matching .NET runtime pre-installed. The csproj `<PropertyGroup>` will include:

```xml
<SelfContained>true</SelfContained>
<RuntimeIdentifier>win-x64</RuntimeIdentifier>
<TargetLatestRuntimePatch>true</TargetLatestRuntimePatch>
<PublishSingleFile>false</PublishSingleFile>
<PublishReadyToRun>false</PublishReadyToRun>
```

Notes:

- **Why `win-x64`?** Service Fabric production clusters are overwhelmingly Windows (the only fully-supported standalone target today). Linux clusters exist but are rarer; users targeting them can flip the RID — we surface this in HOWTO §11. We *do not* emit `<RuntimeIdentifiers>` (plural) — multi-RID restore slows builds and the Service Fabric AfterBuild target only stages one RID into `<SfPackageRoot>/Code` anyway.
- **Why `<SelfContained>true</SelfContained>` rather than just `<RuntimeIdentifier>`?** The two together make the intent explicit and survive future SDK behaviour changes. With only `<RuntimeIdentifier>` set, recent SDKs default to **framework-dependent** publish, which is exactly the footgun this change is trying to remove.
- **`<TargetLatestRuntimePatch>true</TargetLatestRuntimePatch>`** — pulls the newest runtime patch on the matching feature band (e.g. `net8.0` → latest `8.0.x`) at restore time, so self-contained packages always ship with current security fixes rather than whatever patch was current when the SDK was released. Pairs naturally with `<SelfContained>true</SelfContained>` because the cluster will only ever run the runtime version we bake in.
- **`<PublishSingleFile>false</PublishSingleFile>`** — explicit because Service Fabric's package layout expects the host `.exe` plus its dependencies as separate files; single-file publishing breaks the `EntryPoint/ExeHost/Program` resolution in the service manifest.
- **`<PublishReadyToRun>false</PublishReadyToRun>`** — opt-in only. R2R bloats the package and most SF services don't need the cold-start gain.
- **.NET Framework (`net472`) services are unaffected.** Self-contained doesn't apply — `net472` projects already pull the framework from the GAC on the target node, which is the Windows Server default.
- **Guest Executables are unaffected** — they're already self-contained by definition (the user provides the payload).
- **The existing AfterBuild target** that copies output to `<SfPackageRoot>/Code` keeps working unchanged; with `<SelfContained>true</SelfContained>` the build output directory contains the runtime DLLs alongside the service binary, and they all land in `Code/` together.

The csproj builder gains a single new flag `selfContainedRid?: string` (default `'win-x64'` for `netcore` C# kinds, `undefined` for `netfx` and guest). Templates set it; users can override via a workspace setting in a future release if needed (out of scope for 1.1.0).

## 4. StartupServices.xml-first wiring (behaviour change)

Today, [src/scaffold/addServiceApply.ts](src/scaffold/addServiceApply.ts) calls `patchApplicationManifest`, which appends a `<Service>` block to `<DefaultServices>` in `ApplicationManifest.xml`. Modern VS templates instead leave `<DefaultServices>` empty and put the new service into `StartupServices.xml` plus per-environment `StartupServiceParameters/*.xml`.

### New behaviour

- **If `StartupServices.xml` exists** in the project: wire the new service into it, plus the per-environment `StartupServiceParameters/*.xml` files. `<DefaultServices>` in the application manifest stays untouched.
- **If `StartupServices.xml` is absent** (older VS template / hand-rolled project): keep current behaviour — patch `<DefaultServices>` in the application manifest.

### Pure helpers to add (templates module)

- `patchStartupServicesXml(xml, template)` — adds `<Parameter>` declarations to `<Parameters>`, adds the `<Service>` block to `<Services>`. Idempotent (no-op if the same `<Service Name="…">` already exists).
- `patchStartupServiceParametersXml(xml, template, flavor)` — same shape as the existing `patchApplicationParametersXml`.
- `patchApplicationManifestImports(xml, template)` — split out of the current `patchApplicationManifest`. Adds the `<Parameter>` declarations and the `<ServiceManifestImport>` block, but **not** the `<Service>` block in `<DefaultServices>`. Used in the new StartupServices.xml-first path.

### Decision matrix the apply step uses

```
project.startupServicesManifest defined?
├── yes → patchApplicationManifestImports + patchStartupServicesXml
│         + patch every StartupServiceParameters/*.xml
└── no  → patchApplicationManifest (existing behaviour, unchanged)
```

## 5. Create Application UX

Add a service-kind quickpick (same 9-item list as Add Service) before scaffolding. The chosen kind drives the seeded service's templates + the manifest/StartupServices.xml content. Default selection: **Stateless Service (.NET Core)** to match current behaviour.

Implementation notes:

- The new prompt is inserted between the *initial stateless service name* prompt and the on-disk apply step in [src/scaffold/createApplication.ts](src/scaffold/createApplication.ts).
- `applyCreateApplication` already produces a `StartupServices.xml`. It will continue to, but seeded with whatever service kind the user picked.
- `CreateApplicationTemplate` gains optional `kind` and `runtime` fields, defaulting to `'stateless'`/`'netcore'` so existing callers keep working.

## 6. Tests

- Unit tests for every new template builder (manifest XML, csproj, Program.cs/Service.cs/interface).
- `patchStartupServicesXml` tests:
  - Empty StartupServicesManifest → adds `<Parameters>` and `<Services>` blocks.
  - Existing `<Parameters>` and `<Services>` → appends without disturbing siblings.
  - Idempotency — running twice with the same service is a no-op.
  - Self-closing `<Parameters />` and `<Services />` are expanded.
- `patchStartupServiceParametersXml` tests with the same matrix.
- `applyAddService` integration tests for each new kind, verifying:
  - StartupServices.xml is patched when present.
  - `<DefaultServices>` is patched when StartupServices.xml is absent.
  - The csproj/program/service files exist and contain the expected hooks.
  - **Generated `.csproj` for `netcore` C# kinds contains `<SelfContained>true</SelfContained>` + `<RuntimeIdentifier>win-x64</RuntimeIdentifier>` + `<TargetLatestRuntimePatch>true</TargetLatestRuntimePatch>`; `netfx` csprojs do not.**
  - `<ProjectReference>` is added to the .sfproj.
- Create-application tests covering the new "kind + runtime" prompts.

Target: **+30–40 new tests** on top of the existing 155.

## 7. Docs + release

- [docs/HOWTO.md](docs/HOWTO.md) §11 rewritten to describe the new template matrix + StartupServices.xml-first wiring.
- [CHANGELOG.md](CHANGELOG.md) entry.
- Bump `1.0.0` → **`1.1.0`** (new feature, no breaking changes — workspaces with the existing `stateless`/`stateful`/`guest` kinds keep working because `runtime` defaults to `netcore` and existing manifests/startup files are detected case-by-case).

## 8. Three design decisions worth flagging

1. **Actor services as a single project, not VS's two-project (`<Actor>` + `<Actor>.Interfaces`) layout.** The interface lives in `I<Actor>.cs` in the same csproj. Same compile output, same runtime behaviour, half the scaffolding. *Push-back option:* strict VS parity (two csprojs, two `<ProjectReference>` lines in the .sfproj).

2. **.NET Framework projects use SDK-style csprojs, not legacy.** Targets `net472`, references SF NuGets via `<PackageReference>`. Compiles identically. Legacy-format csprojs would add ~150 lines of XML per template for no functional benefit.

3. **The expanded kind list lives in [src/scaffold/addServiceTemplates.ts](src/scaffold/addServiceTemplates.ts) rather than splitting into a `serviceTemplates/` folder.** The file will grow from ~750 to ~1500 lines but stays one file with section dividers. *Push-back option:* split into `src/scaffold/serviceTemplates/{stateless,stateful,actor,aspnet,guest}.ts` with `addServiceTemplates.ts` as the barrel.

## 9. Out of scope (deferred to a later release)

- Container service template (`Hosted Containers and Applications` → *Container*). VS supports it, but it requires a Docker-based image-build workflow that's a bigger lift than the rest of this plan combined.
- Reliable Actors with **state providers other than the default `KvsActorStateProvider`** (volatile, custom). The generated actor uses the default; users can swap it manually.
- VS's "two-csproj" Actor layout (see §8.1 above).
- Auto-update of `Microsoft.ServiceFabric.*` package versions. The templates pin a single SDK version family controlled by `serviceFabricSdkVersion`; users bump it post-scaffold like they do today.

## 10. File-by-file change footprint (estimate)

| File | Lines added (approx) | Purpose |
|---|---|---|
| [src/scaffold/addServiceTemplates.ts](src/scaffold/addServiceTemplates.ts) | +700 | New template builders for actor + ASP.NET + StartupServices.xml patcher. |
| [src/scaffold/addServiceApply.ts](src/scaffold/addServiceApply.ts) | +120 | StartupServices.xml-first decision branch. |
| [src/scaffold/addService.ts](src/scaffold/addService.ts) | +80 | Two-step pick (group → kind) + runtime axis prompt. |
| [src/scaffold/createApplicationTemplates.ts](src/scaffold/createApplicationTemplates.ts) | +60 | Thread kind/runtime through. |
| [src/scaffold/createApplicationApply.ts](src/scaffold/createApplicationApply.ts) | +30 | Same. |
| [src/scaffold/createApplication.ts](src/scaffold/createApplication.ts) | +40 | Kind/runtime prompts. |
| [test/unit/addService.test.ts](test/unit/addService.test.ts) | +400 | Coverage for new kinds. |
| [test/unit/createApplication.test.ts](test/unit/createApplication.test.ts) | +120 | Kind-driven tests. |
| [docs/HOWTO.md](docs/HOWTO.md) | +80 | §11 rewrite. |
| [CHANGELOG.md](CHANGELOG.md) | +20 | 1.1.0 entry. |

Total: **~1.6k LoC** added, ~50 LoC modified. No deletions.

## 11. Implementation order

1. Add `ServiceRuntime` axis + expand `ServiceKind` in templates module. Compile-fail every call site, fix to default `runtime: 'netcore'`. Tests stay green.
2. Add `patchStartupServicesXml` + `patchStartupServiceParametersXml` with full unit-test coverage. No callers yet.
3. Split `patchApplicationManifest` → `patchApplicationManifestImports` + `appendDefaultServiceBlock`. Existing behaviour preserved via a tiny façade.
4. Switch `applyAddService` to the new decision matrix. Existing tests must still pass; new tests cover the StartupServices.xml-first path.
5. Implement actor templates end-to-end (add kind to pick-list, builders, apply, tests).
6. Implement `aspNetStateless` end-to-end.
7. Implement `aspNetStateful` end-to-end.
8. Wire `.NET Framework` runtime axis (`net472` TFM, framework-package adjustments).
9. **Switch the csproj builder to emit `<SelfContained>true</SelfContained>` + `<RuntimeIdentifier>win-x64</RuntimeIdentifier>` + `<TargetLatestRuntimePatch>true</TargetLatestRuntimePatch>` for `netcore` C# kinds (see §3.1). Update existing csproj-builder tests; add a new test confirming `netfx` csprojs do not emit these properties.**
10. Plumb kind/runtime prompt into Create Application.
11. Docs + CHANGELOG + version bump + package.

Each step ships a green test suite.

---

*Last updated: when 1.0.0 was the latest stable release.*
