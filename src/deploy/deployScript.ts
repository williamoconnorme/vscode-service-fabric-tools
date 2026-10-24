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

import { parseThumbprintList } from '../cluster/tlsPinning';

const PARAM_RE = /<Parameter\b[^>]*\bName\s*=\s*"([^"]+)"[^>]*\bValue\s*=\s*"([^"]*)"[^>]*\/?>/gi;
const PARAM_RE_VALUE_FIRST = /<Parameter\b[^>]*\bValue\s*=\s*"([^"]*)"[^>]*\bName\s*=\s*"([^"]+)"[^>]*\/?>/gi;

/**
 * Parse a Service Fabric `ApplicationParameters\*.xml` file into a
 * `Name → Value` map. Tolerates both attribute orders.
 *
 * Returns an ordered object — keys are added in document order so the
 * generated PowerShell hashtable literal is stable for tests.
 */
export function parseApplicationParameterFile(xml: string): Record<string, string> {
	const out: Record<string, string> = {};
	PARAM_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = PARAM_RE.exec(xml)) !== null) {
		out[m[1]] = m[2];
	}
	PARAM_RE_VALUE_FIRST.lastIndex = 0;
	while ((m = PARAM_RE_VALUE_FIRST.exec(xml)) !== null) {
		if (!(m[2] in out)) out[m[2]] = m[1];
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
function toPowerShellHashtableLiteral(values: Record<string, string>): string {
	const keys = Object.keys(values);
	if (keys.length === 0) return '@{}';
	const entries = keys.map((k) => `'${escape(k)}' = '${escape(values[k])}'`);
	return `@{ ${entries.join('; ')} }`;
}

function escape(s: string): string {
	return s.replace(/'/g, "''");
}

export interface DeployWrapperOptions {
	/** Overrides passed as `-ApplicationParameter @{ ... }`. */
	applicationParameter?: Record<string, string>;
	/** When set, the wrapper forwards `$StartupServicesFile` as `-StartupServicesFile`. */
	startupServicesFile?: string;
	/**
	 * When set, the wrapper forwards `$env:SF_VSCODE_SECURITY_TOKEN` as `-SecurityToken`
	 * so an Entra ID profile connects without the SDK's interactive sign-in dialog.
	 */
	useSecurityToken?: boolean;
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
export function buildDeployWrapper(opts: DeployWrapperOptions = {}): string {
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
		`}`,
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
	if (opts.useSecurityToken) {
		// Read from the environment, not a script parameter, so the token never
		// appears on the PowerShell command line.
		lines.push(`$splat['SecurityToken'] = $env:SF_VSCODE_SECURITY_TOKEN`);
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
const ATTR_RE = (name: string): RegExp => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i');

/** Summary of a `PublishProfiles\<env>.xml` file. */
export interface PublishProfileSummary {
	/** True when the profile has no usable `<ClusterConnectionParameters ConnectionEndpoint>`. */
	isLocal: boolean;
	/** Raw `ConnectionEndpoint` attribute (remote profiles only). */
	connectionEndpoint?: string;
	/** HTTP gateway inferred from the endpoint; `undefined` when it can't be inferred. */
	httpGatewayUrl: string | undefined;
	/** `<ApplicationParameterFile Path>` verbatim (relative to the profile's directory). */
	applicationParameterFile: string | undefined;
	/** `<StartupServiceParameterFile Path>` verbatim (relative to the profile's directory). */
	startupServiceParameterFile: string | undefined;
	/** True when the profile connects with `AzureActiveDirectory="true"` (Microsoft Entra ID). */
	usesEntra?: boolean;
	/** Normalized `ServerCertThumbprint` values (comma-separated in the profile during rollover). */
	serverCertThumbprints?: string[];
	/** True when the profile connects with `X509Credential="true"` (client certificate). */
	usesX509?: boolean;
	/** `FindType` of the client certificate (`FindByThumbprint` / `FindBySubjectName`). */
	clientCertFindType?: string;
	/** `FindValue` of the client certificate (a thumbprint or a subject name). */
	clientCertFindValue?: string;
	/** `<UpgradeDeployment>`, when present. */
	upgrade?: PublishProfileUpgrade;
	/** `<CopyPackageParameters CopyPackageTimeoutSec>`. */
	copyPackageTimeoutSec?: number;
	/** `<CopyPackageParameters CompressPackage>`. */
	compressPackage?: boolean;
	/** `<RegisterApplicationParameters RegisterApplicationTypeTimeoutSec>`. */
	registerApplicationTypeTimeoutSec?: number;
}

/** Rolling upgrade mode, from `<UpgradeDeployment Mode>`. */
export type UpgradeMode = 'Monitored' | 'UnmonitoredAuto' | 'UnmonitoredManual';

/** A publish profile's `<UpgradeDeployment Mode Enabled><Parameters .../></UpgradeDeployment>`. */
export interface PublishProfileUpgrade {
	enabled: boolean;
	mode: UpgradeMode;
	/** `<Parameters>` attributes verbatim (names as `Start-ServiceFabricApplicationUpgrade` parameters). */
	parameters: Record<string, string>;
}

/**
 * Parse a `PublishProfiles\<env>.xml` file into a small summary used by the
 * deploy command's pre-flight check. Pure; no I/O.
 */
export function parsePublishProfile(xml: string): PublishProfileSummary {
	// <ApplicationParameterFile> / <StartupServiceParameterFile> are flat,
	// self-closing elements with a single `Path` attribute. Capture the path
	// verbatim — the caller resolves it against the profile's directory.
	const common = {
		applicationParameterFile: extractPathAttr(xml, 'ApplicationParameterFile'),
		startupServiceParameterFile: extractPathAttr(xml, 'StartupServiceParameterFile'),
		...parseDeploySettings(xml),
	};
	const m = CONNECTION_ENDPOINT_RE.exec(xml);
	const attrs = m?.[1] ?? '';
	const endpoint = ATTR_RE('ConnectionEndpoint').exec(attrs)?.[1]?.trim();
	if (!endpoint) {
		// No <ClusterConnectionParameters>, or one without an endpoint: treat as local.
		return { isLocal: true, httpGatewayUrl: 'http://localhost:19080', ...common };
	}
	const usesX509 = /\bX509Credential\s*=\s*"true"/i.test(attrs);
	return {
		isLocal: false,
		connectionEndpoint: endpoint,
		httpGatewayUrl: inferHttpGateway(endpoint, attrs),
		...common,
		usesEntra: /\bAzureActiveDirectory\s*=\s*"true"/i.test(attrs),
		serverCertThumbprints: parseThumbprintList(ATTR_RE('ServerCertThumbprint').exec(attrs)?.[1]),
		usesX509,
		...(usesX509
			? {
					clientCertFindType: ATTR_RE('FindType').exec(attrs)?.[1]?.trim() || 'FindByThumbprint',
					clientCertFindValue: ATTR_RE('FindValue').exec(attrs)?.[1]?.trim() || undefined,
				}
			: {}),
	};
}

/** Attributes of the first `<{tag}>` element in `xml`, or `undefined` when there is none. */
function elementAttributes(xml: string, tag: string): Record<string, string> | undefined {
	const m = new RegExp(`<${tag}\\b([^>]*?)/?>`, 'i').exec(xml);
	if (!m) return undefined;
	const out: Record<string, string> = {};
	const attrRe = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;
	let a: RegExpExecArray | null;
	while ((a = attrRe.exec(m[1] ?? '')) !== null) out[a[1]] = a[2];
	return out;
}

function toPositiveInt(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === '') return undefined;
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** The upgrade / copy / register settings of a publish profile. */
function parseDeploySettings(
	xml: string,
): Pick<PublishProfileSummary, 'upgrade' | 'copyPackageTimeoutSec' | 'compressPackage' | 'registerApplicationTypeTimeoutSec'> {
	const out: Pick<PublishProfileSummary, 'upgrade' | 'copyPackageTimeoutSec' | 'compressPackage' | 'registerApplicationTypeTimeoutSec'> =
		{};
	const upgradeBlock = /<UpgradeDeployment\b[\s\S]*?(?:\/>|<\/UpgradeDeployment>)/i.exec(xml)?.[0];
	if (upgradeBlock) {
		const attrs = elementAttributes(upgradeBlock, 'UpgradeDeployment') ?? {};
		const modeText = (attrs.Mode ?? '').trim();
		const mode: UpgradeMode = /^Monitored$/i.test(modeText)
			? 'Monitored'
			: /^UnmonitoredManual$/i.test(modeText)
				? 'UnmonitoredManual'
				: 'UnmonitoredAuto';
		out.upgrade = {
			enabled: /^true$/i.test((attrs.Enabled ?? '').trim()),
			mode,
			parameters: elementAttributes(upgradeBlock.replace(/^<UpgradeDeployment\b[^>]*>/i, ''), 'Parameters') ?? {},
		};
	}
	const copy = elementAttributes(xml, 'CopyPackageParameters');
	if (copy) {
		out.copyPackageTimeoutSec = toPositiveInt(copy.CopyPackageTimeoutSec);
		if (copy.CompressPackage !== undefined) out.compressPackage = /^true$/i.test(copy.CompressPackage.trim());
	}
	out.registerApplicationTypeTimeoutSec = toPositiveInt(
		elementAttributes(xml, 'RegisterApplicationParameters')?.RegisterApplicationTypeTimeoutSec,
	);
	return out;
}

/**
 * The application name a deploy creates: `<Application Name="fabric:/…">` from
 * the application parameter file when present, else `fabric:/<TypeName>` with a
 * trailing `Type` removed. Same rule as `Publish-NewServiceFabricApplication`.
 */
export function resolveApplicationName(applicationTypeName: string, applicationParameterXml?: string): string {
	const fromFile = applicationParameterXml
		? /<Application\b[^>]*\bName\s*=\s*"([^"]+)"/i.exec(applicationParameterXml)?.[1]?.trim()
		: undefined;
	if (fromFile) return fromFile.startsWith('fabric:/') ? fromFile : `fabric:/${fromFile}`;
	return `fabric:/${applicationTypeName.replace(/Type$/, '')}`;
}

/**
 * Extract `<{tag} Path="..." />` from a publish-profile XML blob. Returns
 * the trimmed `Path` attribute value, or `undefined` if the tag/attribute
 * is missing or empty. Tolerant of extra whitespace, attribute reordering,
 * and self-closing variants.
 */
function extractPathAttr(xml: string, tag: string): string | undefined {
	const tagRe = new RegExp(`<${tag}\\b([^>]*)/?>`, 'i');
	const m = tagRe.exec(xml);
	if (!m) return undefined;
	const attrs = m[1] ?? '';
	const value = ATTR_RE('Path').exec(attrs)?.[1]?.trim();
	return value && value.length > 0 ? value : undefined;
}

function inferHttpGateway(endpoint: string, attrs: string): string | undefined {
	// Already an http(s) URL — use as is.
	if (/^https?:\/\//i.test(endpoint)) {
		try {
			return new URL(endpoint).toString().replace(/\/$/, '');
		} catch {
			return undefined;
		}
	}
	// host:port → swap to gateway port 19080. X509- and Entra ID-secured clusters → https.
	const hostPort = /^([^:\s]+):(\d+)$/.exec(endpoint);
	if (!hostPort) return undefined;
	const host = hostPort[1];
	const isSecure =
		/\bX509Credential\s*=\s*"true"/i.test(attrs) ||
		/\bAzureActiveDirectory\s*=\s*"true"/i.test(attrs) ||
		/\bAadCredential\s*=\s*"true"/i.test(attrs);
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
	/Could not ping any of the provided Service Fabric gateway endpoints/i,
];

/**
 * Inspects raw stdout/stderr from `Deploy-FabricApplication.ps1` and returns
 * a one-line actionable diagnostic when the failure looks like a cluster
 * connectivity problem. Returns `undefined` when the output doesn't match a
 * known pattern.
 */
export function detectClusterConnectionFailure(output: string): string | undefined {
	for (const re of CONNECTION_ERROR_PATTERNS) {
		if (re.test(output)) {
			return "The deploy script could not reach the Service Fabric cluster. For local profiles, start the dev cluster first (Service Fabric: Start Local Cluster). For remote profiles, verify the publish profile's ClusterConnectionParameters and certificate settings.";
		}
	}
	return undefined;
}
