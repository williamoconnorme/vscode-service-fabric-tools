# Plan — 1.2.0 (Cross-platform publish: macOS / Linux hosts)

## 0. Scope summary

Make **connect → build → package → publish → remove** work from a macOS (and, by extension, Linux) VS Code host against a remote Service Fabric cluster. Windows behavior stays the default and stays byte-for-byte compatible with Visual Studio (PowerShell + `Deploy-FabricApplication.ps1`).

Today on macOS:

| Area | State | Why |
|---|---|---|
| Authoring (tree, manifests, F12, code actions) | Works | Pure TS. XSD validation falls back to in-house diagnostics (no SDK schemas). |
| Clusters view — unsecured / Entra ID / server-cert-only | Works | `SfRestClient` + `PinnedCertAgent` + VS Code / Azure CLI auth are pure Node. |
| Clusters view — **X.509 client-cert clusters** | **Broken** | No client-certificate support anywhere ([sfRestClient.ts:224](../src/cluster/sfRestClient.ts#L224), [clusterAuth.ts:14](../src/cluster/clusterAuth.ts#L14)). Gateway answers 403. |
| Build / Package | **Unverified** | Falls back to `dotnet msbuild` ([msbuildLocator.ts:40](../src/build/msbuildLocator.ts#L40)); the `.sfproj` imports `Microsoft.VisualStudio.Azure.Fabric.MSBuild` 1.7.9 whose tasks target net472. |
| NuGet restore | Partially | `nuget.exe` fallbacks need Mono; the `dotnet msbuild /t:Restore /p:RestorePackagesConfig=true` strategy should work. |
| Publish / Remove | **Blocked** | Hard `win32` gates ([publishCommand.ts:59](../src/commands/publishCommand.ts#L59), [removeCommand.ts:41](../src/commands/removeCommand.ts#L41)); both drive the SF SDK PowerShell module, which does not exist for macOS (`pwsh` does not help). |
| Local dev cluster | Blocked (by design) | Windows SF SDK only. |
| Debug attach | Local PIDs only | Can't reach processes on remote nodes. |

Deliverables, in order:

1. **Phase 0 — macOS packaging spike** (manual, ~1 hour, on a Mac). Decides whether Phase 3 is needed.
2. **Phase 1 — X.509 client-certificate authentication** for every REST call.
3. **Phase 2 — REST deploy engine** (`serviceFabric.deploy.engine: auto | powershell | rest`) for Publish and Remove.
4. **Phase 3 — In-extension packager** (only if Phase 0 shows `/t:Package` fails under `dotnet msbuild`).
5. **Phase 4 — Platform gating and UX polish.**
6. **Phase 5 — Docs, tests, CI.**

Non-goals: a macOS local cluster (documented Docker `onebox` workaround only), remote-node debugging, `.NET Framework` services on non-Windows, `file:` / `xstore:` image stores in the REST engine.

## 1. Where to do the work

Phases 1, 2, 4 and 5 are platform-agnostic TypeScript and are **fastest to build and verify on Windows**: the REST engine can be forced with `serviceFabric.deploy.engine: "rest"`, and the PowerShell engine is right there for side-by-side comparison against the same cluster and publish profile. Client-cert auth can be tested on Windows with a PFX file exported from the cert store.

Only **Phase 0** and **Phase 3** need a Mac, plus a final acceptance pass (§8). Recommended split:

- **Mac, first:** run the Phase 0 spike and record the result in §3.3 of this file.
- **Windows:** Phases 1, 2, 4, 5.
- **Mac:** Phase 3 (if required) and the §8 acceptance checklist.

## 2. Phase 1 — X.509 client-certificate authentication

### 2.1 Model

Extend [`ClusterSecurity`](../src/cluster/clusterAuth.ts) and [`ClusterConnection`](../src/cluster/connectionStore.ts):

```ts
/** A client certificate loaded from a file (PFX or PEM). Never stored in workspaceState. */
export interface ClientCertRef {
	/** Absolute path to a .pfx/.p12, or to a PEM file containing cert (and optionally key). */
	path: string;
	/** For PEM: separate private-key file, when the cert file has no key. */
	keyPath?: string;
	/** SHA-1 thumbprint of the leaf, computed at load time; shown in UI and matched against publish profiles. */
	thumbprint: string;
	/** True when a passphrase is stored in SecretStorage under `serviceFabric.clientCert.<thumbprint>`. */
	hasPassphrase: boolean;
}

export interface ClusterSecurity {
	auth?: EntraClusterAuth;
	serverCert?: ServerCertPin;
	clientCert?: ClientCertRef;   // new
}
```

Passphrases go to `context.secrets` (Keychain on macOS, Credential Manager on Windows, libsecret on Linux). Only the path and thumbprint live in `workspaceState`.

### 2.2 New module `src/cluster/clientCert.ts` (pure Node)

- `loadClientCert(ref, passphrase): Promise<{ pfx?: Buffer; cert?: Buffer; key?: Buffer; passphrase?: string }>`: reads the files and validates them by creating a throwaway `tls.createSecureContext`. Bad passphrases and unsupported formats raise clear errors.
- `thumbprintOfCertFile(path, passphrase)`: uses `crypto.X509Certificate` for PEM. For PFX, use `tls.createSecureContext({ pfx, passphrase })` and then `new X509Certificate(ctx.context.getCertificate())`. If that API turns out to be unavailable in VS Code's Electron Node, fall back to asking the user to confirm the thumbprint from the first successful handshake.
- Thumbprints are normalized with the existing `normalizeThumbprint`.

### 2.3 TLS plumbing

- [`PinnedCertAgent`](../src/cluster/tlsPinning.ts#L96): accept an optional `ClientCertMaterial` and spread `pfx` / `cert` / `key` / `passphrase` into `tls.connect`.
- Chain-trusted clusters that need a client cert have no pin today, so they get no agent. Add a plain `https.Agent({ pfx, ... })` in [`createClusterClient`](../src/cluster/clusterAuth.ts#L75) when there is a `clientCert` and no `serverCert`.
- `createClusterClient` becomes async, or takes pre-loaded material, because loading needs the passphrase from SecretStorage. Prefer a small `ClusterClientFactory` built in `extension.ts` with access to `context.secrets`, so callers don't change shape. Cache loaded material per thumbprint for the session.

### 2.4 Connect flow

In [`configureClusterSecurity`](../src/cluster/clusterAuth.ts#L96), after the server-cert step:

1. Probe `GET /$/GetClusterHealth`. A 403 with no Entra metadata means the cluster needs a client cert.
2. Prompt with a file picker for `.pfx`, `.p12` or `.pem`. Then prompt for the passphrase (password input, optional). Show the computed thumbprint.
3. Retry the probe with the cert. On success, save the `ClientCertRef` and passphrase.
4. Add a **Change Client Certificate…** context action on `cluster.connected` / `cluster.disconnected`.

### 2.5 Publish-profile mapping

`<ClusterConnectionParameters X509Credential="true" FindType="FindByThumbprint" FindValue="…" StoreLocation="CurrentUser" StoreName="My" />` refers to the Windows cert store.

- Extend [`parsePublishProfile`](../src/deploy/deployScript.ts#L170) with `usesX509`, `clientCertFindType` and `clientCertFindValue`.
- New setting `serviceFabric.clientCertificates`, an object mapping a thumbprint to a path:

```json
"serviceFabric.clientCertificates": { "A1B2…": "~/certs/sf-admin.pfx" }
```

- Resolution order for a profile that sets `X509Credential="true"`:
  1. The saved connection's `clientCert`, if its thumbprint matches `FindValue`.
  2. The `serviceFabric.clientCertificates[FindValue]` entry.
  3. Prompt for a file. Offer to save it to the setting.
  
  `FindBySubjectName` is matched against the loaded cert's subject CN.
- On Windows with the PowerShell engine, nothing changes: the script still reads the cert store.

### 2.6 Acceptance

- Connect, browse and run entity actions against a cert-secured cluster using a PFX file, with and without a passphrase. Also using a PEM cert with a separate key file.
- A wrong cert produces a 403, which becomes a message offering *Change Client Certificate…*.
- The passphrase never appears in `workspaceState`, logs or the process command line.

## 3. Phase 0 — macOS packaging spike (manual, on a Mac)

### 3.1 Steps

Prerequisites: .NET 8 SDK and a scaffolded app (**Create Application** with one stateless .NET service).

```bash
cd MyApp
dotnet msbuild MyApp/MyApp.sfproj -t:Restore -p:RestorePackagesConfig=true -p:RestorePackagesPath=../packages
ls packages/Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9/build
dotnet msbuild MyApp/MyApp.sfproj -t:Package -p:Configuration=Debug -p:Platform=x64 -v:n
find MyApp/pkg/Debug -maxdepth 3
```

### 3.2 Outcomes

- **A — Package succeeds.** `pkg/Debug` holds `ApplicationManifest.xml` plus `<Svc>Pkg/{ServiceManifest.xml,Code,Config}`, and `Code` has the published service. Phase 3 is skipped. Only make sure `RestorePackagesConfig` is the first strategy on non-Windows.
- **B — Fails on task loading** (`MSB4062`, `MSB4216`, or "could not load file or assembly" errors). The SF tasks need .NET Framework, so Phase 3 is required.
- **C — Fails later** (for example, service publish targets). Record the error and decide whether a property override fixes it before falling back to Phase 3.

### 3.3 Result

**Outcome A — `/t:Package` succeeds; Phase 3 is not needed.** Run on 2026-10-24 on macOS arm64 with `dotnet` 10.0.400 (MSBuild 18.9.6), with SDKs 8.0.419 and 10.0.400 installed and no Mono or SF SDK. The app was a stateless .NET (`net10.0`) service scaffolded with `applyCreateApplication`.

- `dotnet msbuild <App>.sfproj -t:Package -p:Configuration=Debug -p:Platform=x64` built with 0 warnings and 0 errors. The SF build tasks (`Microsoft.VisualStudio.Azure.Fabric.BuildTasks.dll`) load under .NET MSBuild, and no property overrides were needed.
- The package lands in `pkg/Debug/<App>/` (the sfproj sets `PackageLocation=pkg\$(Configuration)\$(MSBuildProjectName)`). It holds `ApplicationManifest.xml` and `<Svc>Pkg/{ServiceManifest.xml,Config,Code}`. `Code` has a self-contained **win-x64** publish (`MyService.exe`), so a Mac cross-builds Windows packages. Linux clusters need `linux-x64` and a `Program` without `.exe` (now a scaffolding choice).
- **Restore, as written in §3.1, does not work.** `-t:Restore -p:RestorePackagesConfig=true` exits 0, but .NET's RestoreTask skips the `packages.config` sfproj ("All projects are up-to-date"). `RestorePackagesPath` also resolves against the cwd and becomes the csproj's global packages folder. What works is fetching the nupkg from api.nuget.org (strategy F, now first on non-Windows) plus restoring the service csproj, which the Package task now does with `-restore`.
- The package resolver joined nested paths with `\`, so the extension couldn't find `pkg/Debug/<App>` on POSIX. This is fixed.

## 4. Phase 2 — REST deploy engine

### 4.1 Setting and dispatch

```json
"serviceFabric.deploy.engine": {
  "type": "string",
  "enum": ["auto", "powershell", "rest"],
  "default": "auto",
  "markdownDescription": "How Publish / Remove talk to the cluster. `auto`: PowerShell (Deploy-FabricApplication.ps1, same as Visual Studio) on Windows, REST elsewhere. `rest`: the extension uploads, provisions and creates/upgrades the application over the HTTP gateway — no Service Fabric SDK required."
}
```

[`publishApplication`](../src/commands/publishCommand.ts#L49):
- Remove the `win32` gate.
- Keep restore → package → resolve package root unchanged.
- Branch at the current `runPowerShell` call into `deployViaPowerShell(...)`, which is today's code moved, or `deployViaRest(...)`.
- The `win32` check moves into the engine resolver: `powershell` on non-Windows gives a clear error suggesting `rest`.

[`removeCommand.ts`](../src/commands/removeCommand.ts#L41) gets the same treatment.

### 4.2 New module `src/deploy/restDeploy.ts`

Pure apart from an injected `SfRestClient` and logger, so it can be unit-tested with a fake client.

```ts
export interface RestDeployOptions {
	packageRoot: string;                       // resolved pkg/<Config>
	applicationTypeName: string;               // from ApplicationManifest.xml
	applicationTypeVersion: string;
	applicationName: string;                   // fabric:/<Name>, see §4.5
	parameters: Record<string, string>;        // merged from ApplicationParameters/*.xml
	profile: PublishProfileDeploySettings;     // §4.4
	startupServices?: StartupServiceSpec[];    // §4.6
	token?: vscode.CancellationToken;
	progress?: (message: string, increment?: number) => void;
}
export async function deployViaRest(client: SfRestClient, opts: RestDeployOptions, logger: Logger): Promise<void>;
export async function removeViaRest(client: SfRestClient, appName: string, typeName: string, typeVersion: string, logger: Logger): Promise<void>;
```

Steps:

1. **Image store check.** Read `ImageStoreConnectionString` from `getClusterManifest()`. Continue only for `fabric:ImageStore`. For `file:` or `xstore:`, fail with: *"This cluster's image store (`xstore:`) can't be uploaded to over the HTTP gateway. Use the PowerShell engine on Windows, or `sfctl application upload`."*
2. **Decide the action** from `getApplicationTypes()` and `getApplication()`:
   - Type and version not provisioned → upload and provision.
   - App absent → create.
   - App present at the same type version → apply `OverwriteBehavior` (`Never` fails; `Always` or `SameAppTypeAndVersion` deletes, then creates).
   - App present at an older version → upgrade if `UpgradeDeployment Enabled="true"`. Otherwise apply `OverwriteBehavior`.
3. **Upload** to `/ImageStore/<TypeName>_<Version>_<random>`:
   - Walk the package. Files ≤ 4 MB go up with `PUT /ImageStore/{path}`. Larger files go through `UploadChunk` (4 MB chunks, `Content-Range`) and then `CommitUploadSession`.
   - Write each folder's `_.dir` marker after that folder's files, deepest first.
   - Run with bounded concurrency (4), report progress per file and honour cancellation.
   - Honour `CopyPackageParameters CompressPackage` later. v1 logs "compression not supported by REST engine; uploading uncompressed".
4. **Provision:** `POST /ApplicationTypes/$/Provision` with `{ Kind: "ImageStorePath", ApplicationTypeBuildPath }`. Poll `getApplicationTypes` until `Status == Available`, or fail on `Failed` with `StatusDetails`.
5. **Create** (`POST /Applications/$/Create`) or **upgrade** (`POST /Applications/{id}/$/Upgrade`). For an upgrade, poll `GetUpgradeProgress` and stream domain progress to the output channel. Stop on `RollingBackCompleted` or `Failed`.
6. **Clean up:** `DELETE /ImageStore/<path>` on both success and failure, as in `Publish-NewServiceFabricApplication`.
7. On failure after provisioning a new version that never got used, unprovision it. Same in spirit as the script's `-UnregisterUnusedApplicationVersionsAfterUpgrade`, which is honoured from the profile.

### 4.3 `SfRestClient` additions

Add `PUT` and `DELETE` to `request()`, plus a raw-body path (`Buffer`, `Content-Type: application/octet-stream`, extra headers) next to the JSON body. Then add:

- `uploadFile(path, body)`, `uploadChunk(path, sessionId, start, end, total, body)`, `commitUploadSession(sessionId)`, `deleteUploadSession(sessionId)`, `deleteImageStoreContent(path)`
- `provisionApplicationType(buildPath, async = false)`
- `createApplication({ Name, TypeName, TypeVersion, ParameterList })`
- `upgradeApplication(appId, { TargetApplicationTypeVersion, Parameters, RollingUpgradeMode, UpgradeKind: "Rolling", MonitoringPolicy, ForceRestart, UpgradeReplicaSetCheckTimeoutInSeconds })`
- `getApplicationUpgradeProgress(appId)`
- `createService(appId, ServiceDescription)` for §4.6

Use api-version 6.0 throughout, matching the existing wrappers. Upload timeouts scale with file size, with `serviceFabric.deploy.copyPackageTimeoutSec` as the overall ceiling (default 600).

### 4.4 Publish-profile deploy settings

Extend `parsePublishProfile` (pure, tested) with:

```ts
interface PublishProfileDeploySettings {
	overwriteBehavior: 'Never' | 'Always' | 'SameAppTypeAndVersion';      // not in the profile: the script's -OverwriteBehavior (default SameAppTypeAndVersion), surfaced as setting serviceFabric.deploy.overwriteBehavior
	upgrade?: { enabled: boolean; mode: 'Monitored' | 'UnmonitoredAuto' | 'UnmonitoredManual'; parameters: Record<string, string> }; // <UpgradeDeployment Mode Enabled><Parameters .../>
	copyPackageTimeoutSec?: number;   // <CopyPackageParameters CopyPackageTimeoutSec>
	compressPackage?: boolean;        // <CopyPackageParameters CompressPackage>
	unregisterUnusedVersions?: boolean;
}
```

Map the profile's `UpgradeDeployment` parameters (`FailureAction`, `Force`, `UpgradeReplicaSetCheckTimeoutSec`, `HealthCheckWaitDurationSec`, `HealthCheckStableDurationSec`, `HealthCheckRetryTimeoutSec`, `UpgradeTimeoutSec`, `UpgradeDomainTimeoutSec`, `ConsiderWarningAsError`, `MaxPercentUnhealthyDeployedApplications`, …) onto the REST `MonitoringPolicy` and `ApplicationHealthPolicy` fields. A pure mapping function makes them easy to unit-test. Unknown keys get a logged warning.

### 4.5 Parameters and application name

- Application name: the `<Application Name="fabric:/…">` attribute of the selected `ApplicationParameters/<file>.xml` when present, else `fabric:/<TypeName without "Type">`. That's the same rule `Deploy-FabricApplication.ps1` / `Publish-NewServiceFabricApplication` use. Centralize it in `deployScript.ts`, and have auto-attach in [publishCommand.ts:286](../src/commands/publishCommand.ts#L286) use the shared helper.
- Parameter merge: manifest defaults ← parameter file. Reuse `parseApplicationParameterFile`.

### 4.6 StartupServices.xml

When `project.startupServicesManifest` exists, the PowerShell wrapper creates those services after the app. In the REST engine, parse `StartupServices.xml` (`<Services><Service Name><StatelessService|StatefulService ServiceTypeName InstanceCount|TargetReplicaSetSize|MinReplicaSetSize><SingletonPartition|UniformInt64Partition|NamedPartition>`). Resolve `[Param]` tokens against the merged parameters, then call `createService` for each service that doesn't already exist. Default services declared in `ApplicationManifest.xml` are created by the cluster and need nothing.

### 4.7 Entra and client cert

Both come from the Phase 1 client factory, so no token reaches a process command line or environment. The `SF_VSCODE_SECURITY_TOKEN` env path stays for the PowerShell engine only.

### 4.8 Acceptance

Against an unsecured local/dev cluster, a cert-secured cluster and an Entra cluster, with `engine: rest` on Windows and `auto` on macOS:

- fresh deploy
- redeploy at the same version (`SameAppTypeAndVersion`)
- monitored upgrade to version+1
- upgrade failure that rolls back and is reported
- cancellation mid-upload, which cleans up the image store
- Remove

Results must match the PowerShell engine: same app name, parameters and services.

## 5. Phase 3 — In-extension packager (only if Phase 0 = B/C)

New `src/build/sfPackager.ts`, registered as a `servicefabric` task target **`PackageNative`**. On non-Windows, `Package` resolves to it automatically when `MSBuild` is the `dotnet` fallback.

1. Read the `.sfproj` via the existing `sfprojParser`: the `ApplicationPackageRoot` folder and the `<ProjectReference>` items for services.
2. Wipe `pkg/<Config>/`. Copy `ApplicationPackageRoot/ApplicationManifest.xml` there.
3. For each service project:
   - Find `PackageRoot/ServiceManifest.xml` and read `ServiceManifest Name`.
   - Run `dotnet publish <csproj> -c <Config> -r <rid> --self-contained true -o pkg/<Config>/<ManifestName>/Code` (or `<CodePackage Name>` when it isn't `Code`).
   - Copy `PackageRoot/{ServiceManifest.xml, Config, Data}`. Any other `PackageRoot` subfolder is copied as-is.
4. `<rid>` comes from the csproj `<RuntimeIdentifier>`. Override it with the new setting `serviceFabric.package.runtimeIdentifier`, so a Mac can build `linux-x64` for Linux clusters.
5. Validate that each manifest `EntryPoint/ExeHost/Program` exists in `Code`. Fail with a precise message otherwise.

Scaffolding (also useful even with outcome A):
- Add a **Target cluster OS** pick (`Windows` default / `Linux`) to Create Application and Add Service.
- Linux sets `<RuntimeIdentifier>linux-x64</RuntimeIdentifier>` and `<Program>` without `.exe` ([addServiceTemplates.ts:1428](../src/scaffold/addServiceTemplates.ts#L1428), [1499](../src/scaffold/addServiceTemplates.ts#L1499), [createApplicationTemplates.ts:320](../src/scaffold/createApplicationTemplates.ts#L320)).

## 6. Phase 4 — Platform gating and UX

- **Local cluster commands** (`startLocal`, `stopLocal`, `resetLocal`, `toggleNodeCount`): add `isWindows` to their `commandPalette` and menu `when` clauses in `package.json`. Keep the runtime check in [clusterCommands.ts:129](../src/commands/clusterCommands.ts#L129) as a fallback, and make its message link to a new HOWTO section on Docker `onebox` (x86 only, Linux cluster, poor on Apple Silicon).
- **PowerShell runner:** `auto` on non-Windows should not silently pick `pwsh` for SF scripts ([powerShellRunner.ts:65](../src/cluster/powerShellRunner.ts#L65)). Callers on non-Windows only get there via an explicit `engine: powershell`, which errors early (§4.1).
- **NuGet:** on non-Windows, skip the `nuget.exe` profile and `which nuget` strategies unless `mono` is on PATH ([nugetLocator.ts:87-110](../src/build/nugetLocator.ts#L87-L110)). Put `msbuild-restorepkgconfig` first.
- **Debug attach:** if the active cluster is remote, or its node addresses aren't local, refuse with a clear message ("Attach requires the service to run on this machine") instead of a failed `processId` attach. Applies to [attachCommand.ts](../src/debug/attachCommand.ts) and auto-attach.
- **XSDs:** extend [schemaProbe.ts:7](../src/language/schemaProbe.ts#L7) with `~/.servicefabric/schemas`. Bundle `ServiceFabricServiceModel.xsd` in `resources/schemas/` only after confirming the source license (microsoft/service-fabric, MIT). Otherwise document `serviceFabric.xmlSchemaPath`.
- **Path casing:** [projectWatcher.ts:85](../src/project/projectWatcher.ts#L85) should lowercase on `win32` only, as `tier2SuppressKey` does.
- **Cosmetic:** [packageResolver.ts:125-127,389](../src/deploy/packageResolver.ts#L125) should build labels with `path.sep`.

## 7. Phase 5 — Docs, tests, CI

- **Tests:** none exist today. Add `node:test` + `tsx` (or esbuild-compiled) unit tests for the pure modules:
  - `restDeploy` against a fake client: decision table, upload ordering with `_.dir` last, chunking boundaries, cleanup on failure
  - profile parsing and upgrade-parameter mapping
  - `StartupServices.xml` parsing
  - `clientCert` load and thumbprint, using a fixture PFX/PEM generated in the test
  - `sfPackager` layout, if built
  
  Add an `npm test` script.
- **CI:** add a GitHub Actions workflow with `typecheck` + `test` on `windows-latest`, `macos-latest` and `ubuntu-latest`.
- **Docs:**
  - [HOWTO.md:34-38](../docs/HOWTO.md#L34-L38): the platform matrix becomes per-engine.
  - Add a new "Publishing from macOS / Linux" section covering client certs (exporting a PFX: `openssl pkcs12 -export …`), `serviceFabric.clientCertificates`, image-store limits and the RID choice.
  - Update the FAQ at line 797, the readme and the changelog.
  - Document new settings: `deploy.engine`, `deploy.overwriteBehavior`, `clientCertificates`, `deploy.copyPackageTimeoutSec`, `package.runtimeIdentifier`.

## 8. macOS acceptance checklist

Run on a Mac (Apple Silicon and Intel if available), VS Code stable, .NET 8 SDK, no Mono, no SF SDK:

- [ ] Extension activates. Local-cluster commands are hidden.
- [ ] Create Application (Linux target) → restore → Package produces a valid `pkg/Debug`.
- [ ] Connect to an Entra cluster through the Azure CLI and through VS Code sign-in.
- [ ] Connect to a cert-secured cluster with a PFX that has a passphrase. The passphrase survives a VS Code restart (Keychain).
- [ ] Publish (fresh), Publish (same version), Publish (upgrade) and Remove all succeed against both clusters.
- [ ] Publish against an `xstore:` cluster fails with the documented message.
- [ ] Attach on a remote cluster shows the "must be local" message.
- [ ] Manifest validation works with `xmlSchemaPath` (or the bundled XSD).

## 9. Risks

- **`dotnet msbuild` + SF targets.** This is the unknown that drives Phase 3's size. Phase 0 resolves it first.
- **Behavior drift from `Deploy-FabricApplication.ps1`.** Mitigation: compare against the PowerShell engine on Windows (§4.8) and keep it the Windows default.
- **PFX via Node/OpenSSL 3.** Legacy RC2/3DES-encrypted PFX exports fail to load. Catch `unsupported` errors and suggest re-exporting with AES (`openssl pkcs12 -export -keypbe AES-256-CBC -certpbe AES-256-CBC`).
- **Large packages over the gateway.** Chunked upload and the configurable timeout cover this. Compression is deferred.
