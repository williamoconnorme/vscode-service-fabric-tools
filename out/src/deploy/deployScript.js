"use strict";
/**
 * Pure helpers for invoking the Visual Studio-generated
 * `Deploy-FabricApplication.ps1` wrapper. Lives in its own module (no
 * `vscode` imports) so it can be unit-tested under `tsx`.
 *
 * Contract notes — distilled from the script that VS scaffolds:
 *
 *  - The script's `Param(...)` block is plain (no `[CmdletBinding()]`), so
 *    common parameters like `-ErrorAction` are NOT recognized at the call
 *    site. Set `$ErrorActionPreference` in the wrapper instead.
 *  - `-ApplicationParameter` is a `[Hashtable]`, NOT a path. There is no
 *    `-ApplicationParameterFilePath` on the wrapper (that one belongs to
 *    `Publish-NewServiceFabricApplication`). The script reads the file
 *    referenced by the publish profile and overlays the hashtable on top.
 *  - The publish profile drives cluster-connection params, the application
 *    parameter file path, and upgrade settings.
 *  - `-ApplicationPackagePath` and `-PublishProfileFile` are the only two
 *    inputs we need to pass for a default deploy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseApplicationParameterFile = parseApplicationParameterFile;
exports.toPowerShellHashtableLiteral = toPowerShellHashtableLiteral;
exports.buildDeployWrapper = buildDeployWrapper;
exports.parsePublishProfile = parsePublishProfile;
exports.detectClusterConnectionFailure = detectClusterConnectionFailure;
const PARAM_RE = /<Parameter\b[^>]*\bName\s*=\s*"([^"]+)"[^>]*\bValue\s*=\s*"([^"]*)"[^>]*\/?>/gi;
const PARAM_RE_VALUE_FIRST = /<Parameter\b[^>]*\bValue\s*=\s*"([^"]*)"[^>]*\bName\s*=\s*"([^"]+)"[^>]*\/?>/gi;
/**
 * Parse a Service Fabric `ApplicationParameters\*.xml` file into a
 * `Name → Value` map. Tolerates both attribute orders.
 *
 * Returns an ordered object — keys are added in document order so the
 * generated PowerShell hashtable literal is stable for tests.
 */
function parseApplicationParameterFile(xml) {
    const out = {};
    PARAM_RE.lastIndex = 0;
    let m;
    while ((m = PARAM_RE.exec(xml)) !== null) {
        out[m[1]] = m[2];
    }
    PARAM_RE_VALUE_FIRST.lastIndex = 0;
    while ((m = PARAM_RE_VALUE_FIRST.exec(xml)) !== null) {
        if (!(m[2] in out))
            out[m[2]] = m[1];
    }
    return out;
}
/**
 * Render a JS object as a PowerShell hashtable literal:
 *   { Foo: 'bar', Count: '3' }  →  @{ 'Foo' = 'bar'; 'Count' = '3' }
 *
 * Both keys and values are emitted as single-quoted PowerShell strings so
 * `$variable` and backticks inside workspace data are treated as literals.
 * Single quotes within values are doubled to `''` per PowerShell rules.
 */
function toPowerShellHashtableLiteral(values) {
    const keys = Object.keys(values);
    if (keys.length === 0)
        return '@{}';
    const entries = keys.map(k => `'${escape(k)}' = '${escape(values[k])}'`);
    return `@{ ${entries.join('; ')} }`;
}
function escape(s) {
    return s.replace(/'/g, "''");
}
/**
 * Build the wrapper PowerShell script that invokes
 * `Deploy-FabricApplication.ps1` with the inputs Visual Studio passes:
 *
 *   - `-ApplicationPackagePath $PackagePath`
 *   - `-PublishProfileFile    $PublishProfile`
 *   - `-ApplicationParameter  @{ ... }`   (only when overrides were supplied)
 *
 * The `$DeployScript`, `$PackagePath`, and `$PublishProfile` variables are
 * supplied by `runPowerShell` (via `buildScriptWithParameters`).
 *
 * The wrapper does TWO things to keep the cluster connection visible to the
 * SDK helper that ultimately calls `Test-ServiceFabricClusterConnection`:
 *
 *  1. **Pre-imports `ServiceFabric -Global`** so the cmdlets aren't lazily
 *     auto-loaded into a nested module scope.
 *  2. **Dot-sources** (`. $DeployScript @splat`) the VS-generated script
 *     instead of using `& $DeployScript @splat`. The `&` operator runs the
 *     script in a child scope; `Connect-ServiceFabricCluster` then stores
 *     its connection state in that child scope, so when
 *     `Publish-NewServiceFabricApplication` (a function defined in the
 *     `ServiceFabricSDK.psm1` module loaded later by the script) calls
 *     `Test-ServiceFabricClusterConnection`, the connection lookup returns
 *     `$null` — surfacing as
 *     `"Cluster connection instance is null"`. Dot-sourcing runs the script
 *     in the wrapper's own scope so the connection state is preserved.
 *     The VS-generated script's own `.EXAMPLE` block uses dot-sourcing for
 *     the same reason; Visual Studio's deploy host invokes it the same way.
 */
function buildDeployWrapper(opts = {}) {
    const lines = [
        `$ErrorActionPreference = 'Stop'`,
        `try {`,
        `    Import-Module ServiceFabric -Global -ErrorAction Stop`,
        `} catch {`,
        `    throw "The 'ServiceFabric' PowerShell module isn't available. Install the Service Fabric SDK and restart VS Code so it picks up the updated PSModulePath. Inner error: $($_.Exception.Message)"`,
        `}`,
        `$splat = @{`,
        `    ApplicationPackagePath = $PackagePath`,
        `    PublishProfileFile = $PublishProfile`,
        `}`
    ];
    const ap = opts.applicationParameter;
    if (ap && Object.keys(ap).length > 0) {
        lines.push(`$splat['ApplicationParameter'] = ${toPowerShellHashtableLiteral(ap)}`);
    }
    if (opts.startupServicesFile && opts.startupServicesFile.trim().length > 0) {
        // Pass through to the VS-generated script's `-StartupServicesFile`
        // parameter. The wrapper sources the actual path from
        // `$StartupServicesFile`, supplied as a PowerShell parameter by
        // `runPowerShell`, so the value isn't embedded in the literal here.
        lines.push(`$splat['StartupServicesFile'] = $StartupServicesFile`);
    }
    // Dot-source — NOT &-invoke — so Connect-ServiceFabricCluster's state
    // lives in the same scope as the SDK helper's connection lookup.
    lines.push(`. $DeployScript @splat`);
    return lines.join('\n');
}
// ---------------------------------------------------------------------------
// Publish profile parsing + cluster pre-flight
// ---------------------------------------------------------------------------
const CONNECTION_ENDPOINT_RE = /<ClusterConnectionParameters\b([^>]*)>/i;
const ATTR_RE = (name) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i');
/**
 * Parse a `PublishProfiles\<env>.xml` file into a small summary used by the
 * deploy command's pre-flight check. Pure; no I/O.
 */
function parsePublishProfile(xml) {
    // <ApplicationParameterFile> / <StartupServiceParameterFile> are flat,
    // self-closing elements with a single `Path` attribute. Capture the path
    // verbatim — the caller resolves it against the profile's directory.
    const appParamFile = extractPathAttr(xml, 'ApplicationParameterFile');
    const startupParamFile = extractPathAttr(xml, 'StartupServiceParameterFile');
    const m = CONNECTION_ENDPOINT_RE.exec(xml);
    if (!m) {
        // No <ClusterConnectionParameters> at all: treat as local.
        return {
            isLocal: true,
            httpGatewayUrl: 'http://localhost:19080',
            applicationParameterFile: appParamFile,
            startupServiceParameterFile: startupParamFile
        };
    }
    const attrs = m[1] ?? '';
    const endpointMatch = ATTR_RE('ConnectionEndpoint').exec(attrs);
    const endpoint = endpointMatch?.[1]?.trim();
    if (!endpoint) {
        return {
            isLocal: true,
            httpGatewayUrl: 'http://localhost:19080',
            applicationParameterFile: appParamFile,
            startupServiceParameterFile: startupParamFile
        };
    }
    const httpGatewayUrl = inferHttpGateway(endpoint, attrs);
    return {
        isLocal: false,
        connectionEndpoint: endpoint,
        httpGatewayUrl,
        applicationParameterFile: appParamFile,
        startupServiceParameterFile: startupParamFile
    };
}
/**
 * Extract `<{tag} Path="..." />` from a publish-profile XML blob. Returns
 * the trimmed `Path` attribute value, or `undefined` if the tag/attribute
 * is missing or empty. Tolerant of extra whitespace, attribute reordering,
 * and self-closing variants.
 */
function extractPathAttr(xml, tag) {
    const tagRe = new RegExp(`<${tag}\\b([^>]*)/?>`, 'i');
    const m = tagRe.exec(xml);
    if (!m)
        return undefined;
    const attrs = m[1] ?? '';
    const pathMatch = ATTR_RE('Path').exec(attrs);
    const value = pathMatch?.[1]?.trim();
    return value && value.length > 0 ? value : undefined;
}
function inferHttpGateway(endpoint, attrs) {
    // Already an http(s) URL — use as is.
    if (/^https?:\/\//i.test(endpoint)) {
        try {
            return new URL(endpoint).toString().replace(/\/$/, '');
        }
        catch {
            return undefined;
        }
    }
    // host:port → swap to gateway port 19080. X509-secured clusters → https.
    const hostPort = /^([^:\s]+):(\d+)$/.exec(endpoint);
    if (!hostPort)
        return undefined;
    const host = hostPort[1];
    const isSecure = /\bX509Credential\s*=\s*"true"/i.test(attrs)
        || /\bAadCredential\s*=\s*"true"/i.test(attrs);
    const scheme = isSecure ? 'https' : 'http';
    return `${scheme}://${host}:19080`;
}
/**
 * Patterns produced by the Service Fabric SDK PowerShell module when the
 * deploy script can't establish or use a cluster connection. Used to
 * post-process the raw script output into an actionable diagnostic.
 */
const CONNECTION_ERROR_PATTERNS = [
    /Cluster connection instance is null/i,
    /FabricObjectClosedException/i,
    /Service Fabric cluster may not be connected/i,
    /Could not ping any of the provided Service Fabric gateway endpoints/i
];
/**
 * Inspects raw stdout/stderr from `Deploy-FabricApplication.ps1` and returns
 * a one-line actionable diagnostic when the failure looks like a cluster
 * connectivity problem. Returns `undefined` when the output doesn't match a
 * known pattern.
 */
function detectClusterConnectionFailure(output) {
    for (const re of CONNECTION_ERROR_PATTERNS) {
        if (re.test(output)) {
            return 'The deploy script could not reach the Service Fabric cluster. '
                + 'For local profiles, start the dev cluster first '
                + '(Service Fabric: Start Local Cluster). '
                + 'For remote profiles, verify the publish profile\'s '
                + 'ClusterConnectionParameters and certificate settings.';
        }
    }
    return undefined;
}
//# sourceMappingURL=deployScript.js.map