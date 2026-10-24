# Plan — 1.1.7 (HTTPS option for ASP.NET service scaffolding + ASP.NET Core dev-cert helper)

## 0. Scope summary

Two interlocked, additive features layered on top of the existing **Add New Service…** flow and the extension's command surface. Both target the ASP.NET Core service kinds (`aspNetStateless`, `aspNetStateful`) — the only kinds where HTTPS in-process via Kestrel makes sense.

1. **HTTPS option in *Add New Service…*** (`aspNet*` kinds only). When the user opts in:
   - The generated `ServiceManifest.xml` declares **two** endpoints — one `http`, one `https` — with distinct names (`ServiceEndpoint`, `ServiceHttpsEndpoint`).
   - `Properties/launchSettings.json` adds an `applicationUrl` that combines both schemes (`https://localhost:8443;http://localhost:8559`) plus `ASPNETCORE_HTTPS_PORT`.
   - The `KestrelCommunicationListener` factory in the generated `*.cs` file binds **both** URLs via a single listener using `UseUrls(httpUrl, httpsUrl)` so the dev-cert path is exercised at startup.
2. **New command — `Service Fabric: Trust ASP.NET Core Dev Certificate`** that:
   - Validates an `ms-aspnetcore-https-dev-cert`-tagged certificate exists in `CurrentUser\My`, is not expired (and not within a configurable warning window), and is currently trusted.
   - When missing / expired / untrusted: shells out to `dotnet dev-certs https --clean` then `dotnet dev-certs https --trust` (Windows / macOS only — Linux trust is distro-specific; falls back to bare `--check` + a manual-trust message on Linux).
   - Surfaced as a standalone command **and** offered as an inline opt-in checkbox during *Add New Service…* whenever the HTTPS option is selected.

The change is fully additive. Existing http-only flows are untouched (HTTPS opt-in defaults to **off**); unrelated service kinds (`stateless`, `stateful`, `actor`, `guest`) ignore the prompt entirely. No package-version bump in `package.json` — the release pipeline (`scripts/release.ps1`) sets that automatically at tag time. The CHANGELOG entry under §9 *is* added so the release script can stitch it into the tag body.

## 1. Background — why this exists

Per the conversation thread on dev certs, an ASP.NET Core service that binds an HTTPS Kestrel listener with no explicit certificate triggers ASP.NET Core's HTTPS dev-cert resolution path. The cert is:

- looked up in `CurrentUser\My` by the OID `1.3.6.1.4.1.311.84.1.1`,
- if absent → Kestrel **fails to start** (it does not auto-create on startup — that's a `dotnet dev-certs https --trust` step),
- if present-but-untrusted → browsers / SF runtime present TLS warnings.

The current scaffolder ([src/scaffold/addServiceTemplates.ts](src/scaffold/addServiceTemplates.ts)) emits `Protocol="http"` only, never wires `UseHttps()`, and never references the dev cert. There is no built-in path for a user to opt into HTTPS without hand-editing `ServiceManifest.xml`, `launchSettings.json`, and the `*.cs` listener factory.

This plan closes that gap end-to-end and bundles a one-click trust step so users don't have to learn `dotnet dev-certs` syntax to make the scaffolded service runnable.

## 2. Goals

Acceptance:

1. **HTTPS opt-in surfaces only for ASP.NET kinds.** Picking `aspNetStateless` or `aspNetStateful` in *Add New Service…* now prompts: *"Generate an HTTPS endpoint in addition to HTTP?"* (Yes / No, default No). Picking `stateless` / `stateful` / `actor` / `guest` skips the prompt entirely — the wizard is unchanged for those.
2. **HTTPS=Yes** produces a service whose `ServiceManifest.xml` declares both endpoints (different names), whose `launchSettings.json` exposes both URLs, and whose Kestrel listener binds both. `dotnet build` of the generated csproj succeeds without further edits. `F5` inside VS Code (PowerShell-launched local cluster) brings up both schemes.
3. **HTTPS=Yes** also surfaces a follow-up prompt: *"Trust the ASP.NET Core HTTPS development certificate now?"* (Yes / No / Don't ask again). Yes → run the new trust command immediately. No → continue with scaffolding only. Don't ask again → set a workspace-state flag suppressing the follow-up for that workspace.
4. **`Service Fabric: Trust ASP.NET Core Dev Certificate`** is invocable standalone from the command palette at any time. It always reports a structured outcome via toast (already-trusted / regenerated-and-trusted / failed). Idempotent: running it twice in a row is a no-op the second time.
5. **No package-version bump in `package.json`.** `version` stays at `1.1.6` until the release script bumps it as part of `npm run release`.
6. **`CHANGELOG.md`** has a new `## 1.1.7` section above the existing `## 1.1.6`, documenting both features and the new setting(s).
7. All existing flows (`http`-only ASP.NET, plain Reliable Services, actors, guest exes) continue to work byte-identically — confirmed by the existing 295+ unit tests staying green.

## 3. Non-goals

- **HTTPS for non-ASP.NET kinds.** Plain Reliable Services and actors don't host Kestrel; they expose endpoints via `FabricTransport` / custom listeners where TLS is configured very differently (cluster cert refs in `ApplicationManifest.xml`'s `<EndpointBindingPolicy>`). Out of scope.
- **Production cert binding.** Generating `<EndpointBindingPolicy>` / `<CertificateRef>` in `ApplicationManifest.xml` is not part of this plan — that's a real-cert-thumbprint workflow and belongs to a future production-deployment plan.
- **HTTPS for guest executables.** Guest exes manage their own listeners; no scaffolding hook exists or is added.
- **Auto-generating a `<EndpointBindingPolicy>` referencing the dev cert by thumbprint.** Not needed — Kestrel manages the dev cert in-process; SF's `<EndpointBindingPolicy>` only matters for HTTP.sys / WebListener.
- **Cross-distro Linux trust.** `dotnet dev-certs https --trust` is a no-op on most Linux distros (Microsoft documented). On Linux we run `--check` only and surface a docs link.
- **Changing the existing http-only listener factory shape.** The dual-URL path is gated entirely on the new HTTPS opt-in.

## 4. Surface area at a glance

| New / changed | Where | Responsibility |
|---|---|---|
| `AddServiceTemplate.httpsEndpoint` (new optional field) | [src/scaffold/addServiceTemplates.ts](src/scaffold/addServiceTemplates.ts) | Carries the opt-in flag + (optional) port override end-to-end. |
| `buildServiceManifestXml` | same file | Emit a second `<Endpoint Protocol="https" .../>` row when `httpsEndpoint` is set. |
| `buildLaunchSettingsJson` | same file | Combine `https://localhost:{httpsPort};http://localhost:{httpPort}` and add `sslPort`. |
| `buildAspNetStatelessServiceCs` / `buildAspNetStatefulServiceCs` | same file | Emit dual-URL listener factory (single `KestrelCommunicationListener` returning a `WebApplication` whose `Urls` collection contains both URLs). |
| HTTPS prompt | [src/scaffold/addService.ts](src/scaffold/addService.ts) | New `pickHttpsOption()` helper, called only when `isAspNetKind(kind)` is true. |
| Trust-cert prompt | same file | After `applyAddService` returns, if `httpsEndpoint` was selected and not suppressed, offer to run the trust command. |
| `src/devcert/devCertCommand.ts` | **new file** | Pure orchestration: parse `dotnet dev-certs https --check` output, decide actions, run subprocesses, return a structured `DevCertOutcome`. |
| `src/devcert/devCertProbe.ts` | **new file** | Pure helpers (no `vscode` import) that interpret stdout/stderr from `dotnet dev-certs`. Unit-testable against captured fixture strings. |
| `serviceFabric.devCert.trust` command | [src/extension.ts](src/extension.ts) + `package.json` `contributes.commands` | Wire it up. |
| `serviceFabric.scaffold.suppressDevCertPrompt` setting | `package.json` | Workspace-scope flag for the *Don't ask again* path. |
| `serviceFabric.devCert.expirationWarningDays` setting | `package.json` | Default `30`. Used by the probe to decide *expired* vs *expiring soon*. |
| Tests | `test/unit/devCert.test.ts` (**new**), `test/unit/addService.test.ts` (augment) | See §8. |
| Docs | `docs/HOWTO.md`, `README.md`, `CHANGELOG.md` | New §11.x subsection on HTTPS scaffolding + §12 settings rows + §13 command row. |

## 5. Implementation

### 5.1 Template-side changes — `addServiceTemplates.ts`

#### 5.1.1 `AddServiceTemplate` — new optional field

```ts
export interface HttpsEndpointOptions {
    /** Endpoint name written into ServiceManifest.xml. Defaults to `ServiceHttpsEndpoint`. */
    readonly name?: string;
    /** HTTPS listen port. Defaults to 8443. */
    readonly port?: number;
}

export interface AddServiceTemplate {
    // …existing fields…
    /**
     * For ASP.NET kinds only: when set, also emit an https endpoint in
     * ServiceManifest.xml, add an https URL to launchSettings.json, and
     * configure the Kestrel listener factory to bind both schemes.
     * Ignored for non-ASP.NET kinds (callers should not set it).
     */
    readonly httpsEndpoint?: HttpsEndpointOptions;
}
```

Default values are computed at the call site, **not** sprinkled across builders, so the builder functions stay deterministic given the template. Defaults:

- `httpsEndpoint.name` → `'ServiceHttpsEndpoint'`
- `httpsEndpoint.port` → `8443`

A new helper `effectiveHttpsEndpoint(t)` returns `{ name, port } | undefined` and is the only thing builders call.

#### 5.1.2 `buildServiceManifestXml` — second endpoint row

In the existing `aspNetStateless` branch (currently emits one http endpoint), when `httpsEndpoint` is set, append:

```xml
      <Endpoint Protocol="https" Name="ServiceHttpsEndpoint" Type="Input" Port="8443" />
```

In the `aspNetStateful` branch (currently emits no `<Resources>` block — Kestrel binds at runtime), HTTPS still does not require a `<Resources>` block at the manifest level (replicas open per-partition listeners). **However**, for symmetry with stateless and to make port allocation explicit, when `httpsEndpoint` is set on `aspNetStateful` we **do** start emitting a `<Resources>` block with both endpoints — this matches what VS does when the user explicitly adds an HTTPS endpoint to a stateful ASP.NET service. The existing http-only stateful path (no `httpsEndpoint`) is unchanged.

Pseudocode for the new resources block:

```ts
if (t.kind === 'aspNetStateless' || (t.kind === 'aspNetStateful' && httpsOpts)) {
    const httpPort = t.endpointPort ?? 8559;
    const lines = [
        `      <Endpoint Protocol="http" Name="${endpoint}" Type="Input" Port="${httpPort}" />`
    ];
    if (httpsOpts) {
        lines.push(
            `      <Endpoint Protocol="https" Name="${httpsOpts.name}" Type="Input" Port="${httpsOpts.port}" />`
        );
    }
    resourcesBlock = `\n  <Resources>\n    <Endpoints>\n${lines.join('\n')}\n    </Endpoints>\n  </Resources>`;
}
```

The existing `aspNetStateful` http-only branch (no `httpsOpts`) keeps emitting `''` for `resourcesBlock` to preserve the VS-canonical no-`<Resources>` shape on the http-only case.

#### 5.1.3 `buildLaunchSettingsJson` — combined `applicationUrl`

When `httpsEndpoint` is set on an ASP.NET kind, change the profile body from:

```jsonc
"applicationUrl": "http://localhost:8559"
```

to:

```jsonc
"applicationUrl": "https://localhost:8443;http://localhost:8559",
"environmentVariables": {
    "ASPNETCORE_ENVIRONMENT": "Development",
    "ASPNETCORE_HTTPS_PORT": "8443"
}
```

`sslPort` (the IIS-style discriminator) is intentionally **not** added — it's only honored when `commandName: "IISExpress"`, which we don't generate.

The existing port-defaulting (`port` parameter, default `8080` today; called with `8559` for ASP.NET) becomes a `{ http: number; https?: number }` shape:

```ts
export function buildLaunchSettingsJson(
    t: AddServiceTemplate,
    ports: { http: number; https?: number } = { http: 8080 }
): string
```

Existing callers pass `{ http: 8559 }`. The new HTTPS branch passes `{ http: 8559, https: 8443 }`.

#### 5.1.4 `buildAspNetStatelessServiceCs` / `buildAspNetStatefulServiceCs` — dual-URL listener

The current shape (single `app.Urls.Add(url)`) gets a small surgical change. The `KestrelCommunicationListener` constructor's third arg (`(url, listener) => …`) receives the **http** URL because we pass `"ServiceEndpoint"` as the endpoint name. We need to ALSO add the https URL inside the same `WebApplication`'s `Urls` collection.

Two constraints:

- We cannot create a *second* `KestrelCommunicationListener` for the https endpoint and return both — `KestrelCommunicationListener` registers a single endpoint with the SF runtime, but a `WebApplication` happily binds multiple URLs from its own `Urls` collection.
- The https port comes from `CodePackageActivationContext.GetEndpoint("ServiceHttpsEndpoint").Port` — we resolve it inside the listener factory at runtime (not from the http URL string).

New listener body for `aspNetStateless` when `httpsOpts` is set:

```cs
return new[]
{
    new ServiceInstanceListener(serviceContext =>
        new KestrelCommunicationListener(serviceContext, "ServiceEndpoint", (url, listener) =>
        {
            var builder = WebApplication.CreateBuilder();

            builder.Services.AddSingleton(serviceContext);
            builder.Services.AddControllers();

            var app = builder.Build();

            app.UseRouting();
            app.MapControllers();

            // HTTP URL surfaced by the KestrelCommunicationListener.
            app.Urls.Add(url);

            // HTTPS URL resolved from the second SF endpoint.
            var httpsEndpoint = serviceContext.CodePackageActivationContext
                .GetEndpoint("ServiceHttpsEndpoint");
            app.Urls.Add($"https://+:{httpsEndpoint.Port}");

            return app;
        }))
};
```

For `aspNetStateful`, the same surgery against `CreateServiceReplicaListeners` / `ServiceReplicaListener`. Only the `httpsEndpoint` string and the listener-collection type differ — extract a private `appendHttpsUrlSnippet()` template helper to avoid duplication.

The `using` block at the top of the .cs file does **not** need new imports — `WebApplication.Urls.Add(string)` is already in scope via `Microsoft.AspNetCore.Builder`.

Optional: when `httpsOpts` is *not* set, the listener body is unchanged (existing tests stay green).

### 5.2 Wizard-side changes — `addService.ts`

#### 5.2.1 `pickHttpsOption()`

New helper, called **only** when `isAspNetKind(pick.kind)` is true. Inserted after the `serviceTypeName` / `version` prompts and before the TFM picker:

```ts
async function pickHttpsOption(): Promise<HttpsEndpointOptions | undefined | 'cancel'> {
    const result = await vscode.window.showQuickPick(
        [
            { label: 'No (HTTP only)', description: 'Default. Kestrel binds http://+:<port>.', value: 'no' },
            { label: 'Yes (HTTP + HTTPS)', description: 'Adds a second https endpoint and binds Kestrel to both.', value: 'yes' }
        ],
        { placeHolder: 'Generate an HTTPS endpoint in addition to HTTP?', matchOnDescription: true }
    );
    if (!result) return 'cancel';
    if (result.value === 'no') return undefined;
    return {};   // defaults are applied at template time
}
```

The `'cancel'` sentinel preserves the wizard's existing convention that returning `undefined` from any prompt aborts cleanly.

Optional follow-up prompt for the HTTPS port (only when `Yes` is chosen):

```ts
const httpsPort = await vscode.window.showInputBox({
    prompt: 'HTTPS port (Kestrel listen port for the https endpoint)',
    value: '8443',
    validateInput: v => /^[1-9]\d{2,4}$/.test(v) && +v <= 65535 ? null : 'Use a valid TCP port (1–65535).'
});
if (httpsPort === undefined) return;
```

This is an inline tweak in `addServiceCommand`, not in `pickHttpsOption` — keeps the helper focused on Yes/No.

#### 5.2.2 Threading the option through

After the existing `template = { …, targetFramework: tfm.value }` assignment in `addServiceCommand`, splice in:

```ts
if (isAspNetKind(kind)) {
    const https = await pickHttpsOption();
    if (https === 'cancel') return;
    if (https) {
        template = { ...template, httpsEndpoint: { port: parsedHttpsPort } };
    }
}
```

`applyAddService` already accepts the full `AddServiceTemplate`, so no signature change there — it just passes through to `buildServiceManifestXml` / `buildLaunchSettingsJson` / the .cs builders.

#### 5.2.3 Trust-cert follow-up prompt

After `applyAddService` returns successfully **and** `template.httpsEndpoint` is set:

```ts
if (template.httpsEndpoint) {
    const suppressKey = 'serviceFabric.scaffold.suppressDevCertPrompt';
    const suppressed = vscode.workspace.getConfiguration().get<boolean>(suppressKey, false);
    if (!suppressed) {
        const pick = await vscode.window.showInformationMessage(
            'The scaffolded service will require the ASP.NET Core HTTPS development certificate to start its HTTPS endpoint. ' +
            'Trust it now?',
            'Yes',
            'No (I will run it later)',
            "Don't ask again"
        );
        if (pick === 'Yes') {
            await vscode.commands.executeCommand('serviceFabric.devCert.trust');
        } else if (pick === "Don't ask again") {
            await vscode.workspace.getConfiguration().update(
                suppressKey,
                true,
                vscode.ConfigurationTarget.Workspace
            );
        }
    }
}
```

Non-modal info toast (not modal) so the user can dismiss without acting if they're scripting / batching. The trust command itself is fully idempotent (§5.3.4) so a "Yes" on a system that's already trusted is a no-op + a happy toast.

### 5.3 New module — `src/devcert/devCertCommand.ts`

Owns the runtime side of the trust flow. Imports `vscode` only for messaging + `child_process` for shelling out.

#### 5.3.1 Subprocess shape

All work goes through `dotnet dev-certs https <verb>`. Verbs we use:

| Verb | Purpose |
|---|---|
| `--check --verbose` | Detect presence + trust + expiry. Stdout / exit code drive the decision tree. |
| `--clean` | Remove all dev certs from `CurrentUser\My`. |
| `--trust` | Generate (if missing) + register in trust stores. Includes UAC elevation prompt on Windows; plays into the OS keychain on macOS. |

`--export` / `--import` / password-protected variants are out of scope.

#### 5.3.2 Decision tree

```
runCheck()
 ├─ "valid certificate" + not within warning window
 │      → outcome: "already-trusted"   (no action; happy toast)
 ├─ "valid certificate" + within warning window
 │      → ask: "expires in N days, regenerate?"
 │           Yes → runClean(); runTrust(); → "regenerated"
 │           No  → "warning-acknowledged"
 ├─ "expired" / "untrusted" / "no valid certificate"
 │      → ask: "regenerate and trust?"
 │           Yes → runClean(); runTrust(); → "regenerated" or "failed"
 │           No  → "declined"
 └─ "dotnet not on PATH" / spawn failure
        → "tooling-missing"
```

`runClean()` is best-effort — failure is logged but does not abort `runTrust()` (the cert may simply not exist).

#### 5.3.3 Platform branches

| Platform | `--trust` behavior | What we do |
|---|---|---|
| `win32` | Triggers UAC; adds to `CurrentUser\Root` | Standard flow. Warn user that a UAC prompt will appear. |
| `darwin` | Adds to login keychain via `security` cmd | Standard flow; prompts for keychain password. |
| `linux` | No-op (per Microsoft docs); user must trust manually per distro | Run `--check` only. If missing, run `--clean` + a non-`--trust` regenerate (`dotnet dev-certs https`). Surface a docs link to the per-distro trust instructions. |

Linux's docs link: `https://learn.microsoft.com/en-us/aspnet/core/security/enforcing-ssl#trust-the-aspnet-core-https-development-certificate`. Hardcoded constant; no runtime URL discovery.

#### 5.3.4 Idempotency

`runCheck()` runs first on every invocation. If the result is `valid + trusted + not-expiring`, the command short-circuits with a single toast: *"ASP.NET Core HTTPS dev certificate is valid and trusted."* No subprocess beyond `--check` runs. Calling the command twice in succession is therefore a single `--check` round-trip the second time.

#### 5.3.5 Surfacing

- Standalone command: `serviceFabric.devCert.trust` registered in `extension.ts`.
- `package.json` `contributes.commands` row:

  ```json
  {
      "command": "serviceFabric.devCert.trust",
      "title": "Trust ASP.NET Core Dev Certificate",
      "category": "Service Fabric"
  }
  ```

- Output goes to the existing **Service Fabric** output channel via `logger.outputChannel.appendLine(...)` for stdout/stderr capture; toast carries the high-level outcome.
- Telemetry event `extension.devcert.trust` with payload `{ outcome, platform }`.

### 5.4 New module — `src/devcert/devCertProbe.ts`

Pure helpers, no `vscode` / `child_process` import. Take captured strings; return structured results. Lets us unit-test the parser without spawning `dotnet`.

```ts
export type DevCertProbeResult =
    | { kind: 'missing' }
    | { kind: 'untrusted' }
    | { kind: 'expired'; daysOverdue: number }
    | { kind: 'expiring'; daysRemaining: number }
    | { kind: 'valid'; daysRemaining: number }
    | { kind: 'unparseable'; raw: string };

export function parseDevCertCheckOutput(
    stdout: string,
    stderr: string,
    exitCode: number,
    nowIso: string,
    warningWindowDays: number
): DevCertProbeResult;
```

Parser logic targets the well-known phrases emitted by `dotnet dev-certs https --check --verbose`:

- `"A valid HTTPS certificate is already present."` → exit 0 → look for `"Trusted: True"` / `"Trusted: False"` and `"NotAfter:"` to compute remaining days.
- `"No valid certificate found."` → exit 1 → `missing`.
- `"The HTTPS developer certificate is not trusted."` → exit 1 → `untrusted`.
- Anything else → `unparseable` with the raw stdout for the user-facing toast.

### 5.5 Settings additions (`package.json`)

Add to `contributes.configuration.properties`, immediately under the existing `serviceFabric.scaffoldAutoRestore` block:

```json
"serviceFabric.scaffold.suppressDevCertPrompt": {
    "type": "boolean",
    "default": false,
    "description": "When true, suppress the post-scaffold prompt to trust the ASP.NET Core HTTPS development certificate after Add New Service. The standalone 'Service Fabric: Trust ASP.NET Core Dev Certificate' command is still available."
},
"serviceFabric.devCert.expirationWarningDays": {
    "type": "number",
    "default": 30,
    "minimum": 0,
    "maximum": 365,
    "description": "Number of days before expiration when 'Service Fabric: Trust ASP.NET Core Dev Certificate' should warn that the cert is expiring soon. Set to 0 to disable expiry warnings."
}
```

### 5.6 Command registration (`extension.ts`)

Append to the `cmds` array:

```ts
['serviceFabric.devCert.trust', async () => {
    telemetry.event('devcert.trust.invoked');
    const { runDevCertTrust } = await import('./devcert/devCertCommand.js');
    await runDevCertTrust(logger, telemetry);
}]
```

Lazy-imported to keep the activation path lean — the dev-cert module is only paged in when the user actually invokes the command.

### 5.7 Walkthrough hint

`media/walkthrough/build-deploy.md` (or a new `media/walkthrough/dev-cert.md`) — a one-paragraph callout: *"If you generated an ASP.NET Core service with HTTPS enabled, run **Service Fabric: Trust ASP.NET Core Dev Certificate** once per machine before pressing F5."* Decided at implementation time whether to add a new walkthrough step or fold into existing.

## 6. UX details

### 6.1 The wizard ordering

| Order | Prompt | New? |
|---|---|---|
| 1 | Service kind (existing grouped picker) | no |
| 2 | Service name | no |
| 3 | Service type name | no |
| 4 | Version | no |
| 5 | TFM (only for C# kinds) | no |
| 6 | **HTTPS endpoint?** | **yes** (ASP.NET kinds only) |
| 7 | **HTTPS port** (only when HTTPS=Yes) | **yes** |
| 8 | Guest source / arguments (only for guest) | no |
| 9 | Confirm + scaffold | no |
| 10 | **Trust dev cert now?** (only when HTTPS=Yes, post-scaffold) | **yes** |

Steps 6/7/10 are gated entirely on `isAspNetKind(kind) && (user opted in)`. Other paths see no change.

### 6.2 Cancellation semantics

- Cancelling step 6 (user hits Esc on the HTTPS Yes/No picker) **aborts the wizard** — consistent with every other Esc throughout the existing flow.
- Cancelling step 7 (port input) **aborts the wizard** — same reason.
- Step 10 is a non-modal toast; dismissing it == picking *No*. The scaffold has already happened; nothing is rolled back.

### 6.3 The trust command's toast variants

| Outcome | Toast |
|---|---|
| `already-trusted` | *"ASP.NET Core HTTPS dev certificate is valid and trusted (NotAfter: yyyy-MM-dd)."* (info) |
| `expiring` (within warning window, declined) | *"ASP.NET Core HTTPS dev certificate expires in N days. Re-run **Service Fabric: Trust ASP.NET Core Dev Certificate** to regenerate."* (warning) |
| `regenerated` | *"ASP.NET Core HTTPS dev certificate generated and trusted."* (info) |
| `declined` | *"ASP.NET Core HTTPS dev certificate not regenerated."* (warning, no follow-up) |
| `tooling-missing` | *"Could not run 'dotnet dev-certs'. Install the .NET SDK and ensure 'dotnet' is on PATH."* (error, with **Open .NET Download** button) |
| `failed` | *"Failed to trust the ASP.NET Core HTTPS dev certificate. See the Service Fabric output channel for details."* (error, with **Open Output Channel** button — same pattern as `attachToService.ts` post-1.1.5) |
| Linux untrusted | *"Trust on Linux is distro-specific. Cert generated; follow the docs link to trust it manually."* (warning, with **Open Docs** button) |

### 6.4 Telemetry

Two new events:

```
extension.scaffold.https.opted_in
{ kind: 'aspNetStateless' | 'aspNetStateful', portHttp: number, portHttps: number }
```

```
extension.devcert.trust
{
  trigger: 'manual' | 'post-scaffold',
  platform: NodeJS.Platform,
  outcome: 'already-trusted' | 'regenerated' | 'declined' | 'expiring-acknowledged' | 'tooling-missing' | 'failed' | 'linux-manual'
}
```

Both routed via the existing `Telemetry` shim.

## 7. File-by-file change list

| File | Change |
|---|---|
| [src/scaffold/addServiceTemplates.ts](src/scaffold/addServiceTemplates.ts) | Add `HttpsEndpointOptions`, extend `AddServiceTemplate`, helper `effectiveHttpsEndpoint`, second-endpoint emission in `buildServiceManifestXml`, dual-URL branch in `buildLaunchSettingsJson` (signature change: `port: number` → `ports: { http: number; https?: number }`), dual-URL listener factories in `buildAspNetStatelessServiceCs` / `buildAspNetStatefulServiceCs`. |
| [src/scaffold/addServiceApply.ts](src/scaffold/addServiceApply.ts) | Pass `{ http: launchPort!, https: template.httpsEndpoint?.port ?? 8443 }` to `buildLaunchSettingsJson` when `template.httpsEndpoint` set. No on-disk path changes. |
| [src/scaffold/addService.ts](src/scaffold/addService.ts) | Insert `pickHttpsOption()` + port input (ASP.NET kinds only) after the TFM picker. Insert post-scaffold trust-cert prompt when `template.httpsEndpoint` is set. |
| `src/devcert/devCertProbe.ts` | **New.** Pure parser per §5.4. |
| `src/devcert/devCertCommand.ts` | **New.** Orchestrator per §5.3 — spawns `dotnet dev-certs https …`, calls into the parser, drives prompts, emits toasts + telemetry. |
| [src/extension.ts](src/extension.ts) | Register `serviceFabric.devCert.trust` per §5.6. No other change. |
| [package.json](package.json) | `contributes.commands` += `serviceFabric.devCert.trust`. `contributes.configuration.properties` += two new settings per §5.5. **No `version` change.** |
| [docs/HOWTO.md](docs/HOWTO.md) | New §11.x *HTTPS scaffolding for ASP.NET Core services* explaining the opt-in, the dev-cert prompt, what gets generated, where to run the trust command. New §12 rows for both new settings. New §13 row for the trust command. |
| [README.md](README.md) | One-line bullet under *Features* mentioning the HTTPS scaffold option + dev-cert helper. |
| [CHANGELOG.md](CHANGELOG.md) | New `## 1.1.7` section above `## 1.1.6` per §9. |
| `media/walkthrough/build-deploy.md` | Append a paragraph per §5.7. |
| `test/unit/addService.test.ts` | Augment per §8. |
| `test/unit/devCert.test.ts` | **New** test file per §8. |

## 8. Tests

### 8.1 Unit — pure templates (`test/unit/addService.test.ts`, ~12 new)

- `buildServiceManifestXml({ kind: 'aspNetStateless', httpsEndpoint: {} })` produces a `<Resources>` block with two `<Endpoint>` rows, http first then https with name `ServiceHttpsEndpoint` port `8443`.
- Custom `httpsEndpoint.port = 9443` is honored verbatim.
- `buildServiceManifestXml({ kind: 'aspNetStateful', httpsEndpoint: {} })` now emits a `<Resources>` block (where the http-only stateful path emits none).
- `buildServiceManifestXml({ kind: 'aspNetStateful' })` (no `httpsEndpoint`) still emits no `<Resources>` block — regression guard for the VS-canonical http-only stateful shape.
- `buildServiceManifestXml({ kind: 'stateless', httpsEndpoint: {} })` ignores `httpsEndpoint` (defensive — non-ASP.NET kinds should never set it, but the builder shouldn't crash).
- `buildLaunchSettingsJson({ kind: 'aspNetStateless' }, { http: 8559, https: 8443 })` produces `applicationUrl: "https://localhost:8443;http://localhost:8559"` and an `ASPNETCORE_HTTPS_PORT: "8443"` env var.
- Same with `https` undefined → unchanged single-scheme `applicationUrl`.
- `buildLaunchSettingsJson({ kind: 'stateless' }, ...)` throws on `https` set (defensive).
- `buildAspNetStatelessServiceCs` with `httpsEndpoint` set contains the literal `GetEndpoint("ServiceHttpsEndpoint")` and a `app.Urls.Add($"https://+:{httpsEndpoint.Port}")` line.
- Same for `buildAspNetStatefulServiceCs`.
- The http-only path of both .cs builders is unchanged byte-for-byte (use existing snapshot assertions; do not regress).
- `effectiveHttpsEndpoint` returns `undefined` for non-ASP.NET kinds even when `httpsEndpoint` is set in the template.

### 8.2 Unit — `applyAddService` (`test/unit/addService.test.ts`, ~4 new)

- Round-trip: `applyAddService` with `httpsEndpoint: {}` writes a `ServiceManifest.xml` containing both endpoints, a `launchSettings.json` containing both URLs, and a generated .cs file containing the HTTPS URL append.
- `Add Service` then `Remove Service` round-trip with HTTPS opt-in cleans up everything (the existing recursive folder-delete handles the new files automatically — sanity-check, not a code change).
- HTTPS opt-in on `aspNetStateful` produces a manifest with a `<Resources>` block.
- HTTPS opt-in does not affect plain Reliable Services round-trips (sanity guard against accidental cross-pollination — assert the existing http-only `stateless` path emits a manifest byte-identical to the 1.1.6 snapshot).

### 8.3 Unit — dev-cert probe (`test/unit/devCert.test.ts`, **new**, ~10 tests)

Fixtures are captured stdout strings from `dotnet dev-certs https --check --verbose` on each platform, stored inline in the test file as multi-line string literals (no separate fixture files).

- Valid + trusted + 200 days remaining → `{ kind: 'valid', daysRemaining: 200 }`.
- Valid + trusted + 10 days remaining + warning window 30 → `{ kind: 'expiring', daysRemaining: 10 }`.
- Valid + trusted + 35 days remaining + warning window 30 → `{ kind: 'valid' }` (still valid; not within window).
- `daysRemaining: 0` boundary (expires today) → `{ kind: 'expiring', daysRemaining: 0 }`.
- `daysRemaining: -5` (already expired) → `{ kind: 'expired', daysOverdue: 5 }`.
- Stdout containing *"No valid certificate found"* + exit 1 → `{ kind: 'missing' }`.
- Stdout containing *"is not trusted"* + exit 1 → `{ kind: 'untrusted' }`.
- Empty stdout + exit 127 (dotnet not on PATH would surface elsewhere; this is a defensive case) → `{ kind: 'unparseable' }`.
- Garbled stdout → `{ kind: 'unparseable', raw: <stdout> }`.
- `warningWindowDays: 0` disables the `expiring` branch entirely (always either `valid` / `expired`).

### 8.4 Unit — dev-cert command orchestration (skip)

`devCertCommand.ts` shells out to `dotnet` and integrates with `vscode.window`; we do **not** unit-test it directly. The pure parser (§8.3) covers the decision-tree inputs; everything else is exercised by manual smoke (§8.5). This matches the existing convention from 1.1.5's `attachToService` (orchestrator is mocked in integration tests, not unit-tested in isolation).

### 8.5 Manual smoke

1. Windows: Add ASP.NET Stateless service with HTTPS=Yes. Click *Yes* on the dev-cert prompt → confirm UAC prompt fires, cert appears in `CurrentUser\My`, F5 to local cluster brings up both schemes (browser to `https://localhost:8443/api/values` and `http://localhost:8559/api/values`).
2. Windows: Add ASP.NET Stateful service with HTTPS=Yes. Same checks; partition split should not impact endpoint binding.
3. Windows: Run trust command standalone twice. Second run is a fast no-op with the *valid + trusted* toast.
4. Windows: `dotnet dev-certs https --clean` between runs; re-run trust command. Should succeed and produce a fresh cert.
5. Windows: `serviceFabric.devCert.expirationWarningDays: 365` → trust command should immediately surface the *expiring* warning on a fresh cert (forced into the warning branch).
6. macOS: trust command flow → confirm keychain prompt fires.
7. Linux: trust command → confirm Linux-manual toast with docs link button.
8. Add ASP.NET Stateless with HTTPS=Yes, click *Don't ask again* → confirm `serviceFabric.scaffold.suppressDevCertPrompt = true` written into `.vscode/settings.json`. Add a second HTTPS service → no follow-up prompt.
9. Existing http-only ASP.NET scaffold (HTTPS=No) → confirm generated artifacts are byte-identical to a 1.1.6 baseline (regression guard).

## 9. CHANGELOG entry (`CHANGELOG.md`)

Insert above the existing `## 1.1.6`:

```md
## 1.1.7

ASP.NET Core HTTPS scaffolding option + new **Trust ASP.NET Core Dev Certificate** helper command.

- **HTTPS opt-in for ASP.NET Core service kinds.** *Add New Service…* now asks *"Generate an HTTPS endpoint in addition to HTTP?"* whenever `aspNetStateless` or `aspNetStateful` is picked. When **Yes** is chosen, the generated `ServiceManifest.xml` declares two endpoints (`ServiceEndpoint` + `ServiceHttpsEndpoint`), `Properties/launchSettings.json` exposes both URLs (`applicationUrl: "https://localhost:8443;http://localhost:8559"`) plus `ASPNETCORE_HTTPS_PORT`, and the `KestrelCommunicationListener` factory in the generated `*.cs` file binds both URLs via `app.Urls.Add(...)`. The HTTPS port defaults to `8443` and is overridable per-scaffold. Non-ASP.NET kinds (`stateless`, `stateful`, `actor`, `guest`) do not see the prompt — their flow is unchanged.
- **`Service Fabric: Trust ASP.NET Core Dev Certificate`** — new top-level command that wraps `dotnet dev-certs https --check / --clean / --trust` with structured outcome detection. Idempotent (already-trusted certs short-circuit on `--check` alone). Detects expired / expiring (within `serviceFabric.devCert.expirationWarningDays`, default 30 days) / untrusted certs and offers a regenerate-and-trust path. Fully cross-platform: Windows surfaces a UAC prompt; macOS surfaces a keychain prompt; Linux runs `--check` and surfaces a docs-link toast (per-distro trust is manual on Linux).
- **Inline dev-cert prompt during scaffold.** When the HTTPS opt-in is chosen, the wizard immediately offers to run the new trust command after on-disk writes complete (info toast with **Yes** / **No** / **Don't ask again**). Picking **Don't ask again** writes `serviceFabric.scaffold.suppressDevCertPrompt: true` into the workspace settings.
- **New settings.** `serviceFabric.scaffold.suppressDevCertPrompt` (default `false`); `serviceFabric.devCert.expirationWarningDays` (default `30`).
- **Tests:** existing baseline +~26. New file `test/unit/devCert.test.ts` exercises `parseDevCertCheckOutput` against captured `dotnet dev-certs https --check --verbose` outputs covering valid / trusted / expired / expiring / missing / untrusted / unparseable paths plus the warning-window boundary. `test/unit/addService.test.ts` augmented with HTTPS opt-in coverage for the manifest, launchSettings, and listener-factory builders, plus a regression guard asserting http-only output is byte-identical to the 1.1.6 baseline.
```

`package.json` `version` is **not** bumped — the release script (`scripts/release.ps1`) handles it at `npm run release` time.

## 10. Acceptance gate

Before tagging 1.1.7:

1. `npm run typecheck` clean.
2. `npm run lint` clean.
3. `npm run test:unit` clean — baseline +~26 (new + augmented tests).
4. **Manual smoke #1–#3 from §8.5 on Windows** mandatory; #6 (macOS) and #7 (Linux) optional but recommended if hardware available.
5. **Regression guard:** scaffolding an http-only ASP.NET Stateless service produces a `ServiceManifest.xml` and a `launchSettings.json` byte-identical to a 1.1.6 baseline (compared via the existing snapshot test).
6. `npm run package` produces `artifacts/service-fabric-project-tools-vscode-1.1.7.vsix` (the version pinned by the release script). The 1.1.6 / 1.1.5 / 1.1.4 / 1.1.3 .vsix files in `artifacts/` are preserved.

## 11. Open questions / out of scope

- **Auto-running trust on first F5 of a generated HTTPS service** — out of scope. The post-scaffold prompt is the only opt-in surface; we do not hook the debug-launch path. Risk of side-effects on shared dev machines without consent is too high.
- **Reading the existing dev cert's NotAfter via Node's `crypto` module** instead of parsing `--check` output — explored and rejected. The dev cert lives in the OS keystore (Windows cert store / macOS keychain / Linux NSS DB), not on disk; only `dotnet dev-certs` knows how to query it portably. Parsing stdout is the supported contract.
- **Generating an `<EndpointBindingPolicy>` referencing the dev cert by thumbprint** — out of scope. Kestrel handles the dev cert in-process; `<EndpointBindingPolicy>` is for HTTP.sys / WebListener / production cert workflows.
- **Two listeners (one http, one https) returned from a single service** — explored and rejected. `KestrelCommunicationListener` registers a single endpoint with the SF runtime; binding two URLs inside the same `WebApplication.Urls` collection is the supported pattern and matches what `dotnet new webapi` produces.
- **Configurable HTTPS endpoint name** (currently hardcoded to `ServiceHttpsEndpoint`) — accepted as an `httpsEndpoint.name` field on the template type but **not** surfaced in the wizard. If a user renames the endpoint in the manifest after scaffolding, the listener factory's `GetEndpoint("ServiceHttpsEndpoint")` call will throw at runtime — explicit comment added at the call site warning about this.
- **Bundling `dotnet` ourselves / using `ms-dotnettools.vscode-dotnet-runtime` to acquire it** — out of scope. The existing scaffolder already assumes the .NET SDK is on PATH (the `serviceFabric.restore` flow has the same prerequisite). The `tooling-missing` toast points users at the .NET download page.
- **Detecting whether the dev cert is bound to a specific port via `netsh http show sslcert`** — Windows-only, out of scope. Kestrel manages the binding itself in-process for our generated services; HTTP.sys-based hosts (which we don't generate) would need this.
