/**
 * Publish profiles from saved cluster connections: generating one, telling
 * whether an existing profile already targets a cluster, and listing a new
 * profile in the `.sfproj`. Pure (no `vscode` imports).
 */
import type { ClusterConnection } from '../cluster/connectionStore';
import { parsePublishProfile } from './deployScript';

/** The default HTTP gateway port; the client connection port (19000) is assumed alongside it. */
const DEFAULT_GATEWAY_PORT = '19080';
const DEFAULT_CLIENT_PORT = '19000';

/** `scheme://host:port` with the host lower-cased and default ports filled in, for comparing gateway URLs. */
export function gatewayKey(url: string): string {
	try {
		const u = new URL(url);
		return `${u.protocol}//${u.hostname.toLowerCase()}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
	} catch {
		return url;
	}
}

/** The parts of a saved connection a profile is built from. */
export type ProfileConnection = Pick<ClusterConnection, 'endpoint' | 'kind' | 'auth' | 'serverCert' | 'clientCert'>;

export interface ClusterProfileOptions {
	/** `<ApplicationParameterFile Path>`, relative to the PublishProfiles folder (e.g. `..\ApplicationParameters\Cloud.xml`). */
	applicationParameterFile?: string;
	/** `<StartupServiceParameterFile Path>`, relative to the PublishProfiles folder. */
	startupServiceParameterFile?: string;
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * The `ConnectionEndpoint` for a gateway URL. Visual Studio and
 * `Deploy-FabricApplication.ps1` expect the client connection endpoint
 * (`host:19000`), which {@link parsePublishProfile} maps back to the gateway
 * on 19080 (https when the profile carries credentials). Any other gateway is
 * written as its URL, which the REST engine understands but PowerShell does not.
 */
function connectionEndpointFor(gateway: string, hasCredentials: boolean): { value: string; powerShellCompatible: boolean } {
	const u = new URL(gateway);
	const port = u.port || (u.protocol === 'https:' ? '443' : '80');
	if (port === DEFAULT_GATEWAY_PORT && (u.protocol === 'https:') === hasCredentials) {
		return { value: `${u.hostname}:${DEFAULT_CLIENT_PORT}`, powerShellCompatible: true };
	}
	return { value: gateway.replace(/\/$/, ''), powerShellCompatible: false };
}

/**
 * A publish profile for a saved connection, in the shape of the scaffolded
 * ones. Credentials are referenced, never embedded: Entra ID as
 * `AzureActiveDirectory="true"`, a client certificate by thumbprint in
 * `CurrentUser\My` (as Visual Studio expects; the REST engine resolves it
 * through the saved connection). Existing applications are upgraded (Monitored, with
 * rollback), matching what publishing to the saved cluster does.
 */
export function buildPublishProfileForCluster(conn: ProfileConnection, opts: ClusterProfileOptions = {}): string {
	const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<PublishProfile xmlns="http://schemas.microsoft.com/2015/05/fabrictools">'];
	if (conn.kind === 'local') {
		lines.push('  <ClusterConnectionParameters />');
	} else {
		const endpoint = connectionEndpointFor(conn.endpoint, Boolean(conn.auth || conn.clientCert));
		if (!endpoint.powerShellCompatible) {
			lines.push(
				'  <!--',
				'    ConnectionEndpoint holds the HTTP gateway URL. The REST deploy engine uses it as is; for',
				'    Visual Studio or Deploy-FabricApplication.ps1, replace it with the cluster\'s client',
				'    connection endpoint (host:port, usually port 19000).',
				'  -->',
			);
		}
		const attrs: [string, string][] = [['ConnectionEndpoint', endpoint.value]];
		const thumbprints = conn.serverCert?.thumbprints.join(',');
		if (conn.auth) {
			attrs.push(['AzureActiveDirectory', 'true']);
			if (thumbprints) attrs.push(['ServerCertThumbprint', thumbprints]);
		} else if (conn.clientCert) {
			attrs.push(['X509Credential', 'true']);
			if (thumbprints) attrs.push(['ServerCertThumbprint', thumbprints]);
			attrs.push(['FindType', 'FindByThumbprint'], ['FindValue', conn.clientCert.thumbprint], ['StoreLocation', 'CurrentUser'], ['StoreName', 'My']);
		}
		const indent = ' '.repeat('  <ClusterConnectionParameters '.length);
		lines.push(`  <ClusterConnectionParameters ${attrs.map(([k, v], i) => `${i ? indent : ''}${k}="${escapeAttr(v)}"`).join('\n')} />`);
	}
	if (opts.applicationParameterFile) lines.push(`  <ApplicationParameterFile Path="${escapeAttr(opts.applicationParameterFile)}" />`);
	if (opts.startupServiceParameterFile) lines.push(`  <StartupServiceParameterFile Path="${escapeAttr(opts.startupServiceParameterFile)}" />`);
	lines.push(
		'  <UpgradeDeployment Mode="Monitored" Enabled="true">',
		'    <Parameters FailureAction="Rollback" Force="True" />',
		'  </UpgradeDeployment>',
		'</PublishProfile>',
		'',
	);
	return lines.join('\n');
}

/** True when the publish profile `xml` deploys to `conn` (same gateway, or both local). */
export function profileTargetsConnection(xml: string, conn: Pick<ClusterConnection, 'endpoint' | 'kind'>): boolean {
	let profile;
	try {
		profile = parsePublishProfile(xml);
	} catch {
		return false;
	}
	if (profile.isLocal) return conn.kind === 'local';
	return profile.httpGatewayUrl !== undefined && gatewayKey(profile.httpGatewayUrl) === gatewayKey(conn.endpoint);
}

/** A file name (without `.xml`) for a profile named after a cluster label. */
export function profileFileNameFor(label: string): string {
	const name = label
		.trim()
		.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
		.replace(/\s+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[.-]+|[.-]+$/g, '');
	return name || 'Cluster';
}

/**
 * Adds `<None Include="{include}" />` to the `.sfproj`, next to the other items
 * in the same folder (or the other `<None>` items), so Visual Studio shows the
 * file. Returns `xml` unchanged when the item is already listed.
 */
export function addSfprojNoneItem(xml: string, include: string): string {
	const eol = xml.includes('\r\n') ? '\r\n' : '\n';
	const escaped = include.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	if (new RegExp(`<(?:None|Content)\\s+Include="${escaped}"`, 'i').test(xml)) return xml;
	const folder = include.includes('\\') ? include.slice(0, include.lastIndexOf('\\') + 1) : '';
	const noneRe = /^([ \t]*)<None\s+Include="([^"]*)"[^>]*\/>[ \t]*$/gim;
	let anchor: { end: number; indent: string } | undefined;
	let sameFolder: { end: number; indent: string } | undefined;
	let m: RegExpExecArray | null;
	while ((m = noneRe.exec(xml)) !== null) {
		const hit = { end: m.index + m[0].length, indent: m[1] };
		anchor = hit;
		if (folder && m[2].toLowerCase().startsWith(folder.toLowerCase())) sameFolder = hit;
	}
	const at = sameFolder ?? anchor;
	const line = `<None Include="${include}" />`;
	if (at) return `${xml.slice(0, at.end)}${eol}${at.indent}${line}${xml.slice(at.end)}`;
	const close = xml.lastIndexOf('</Project>');
	if (close < 0) return xml;
	return `${xml.slice(0, close)}  <ItemGroup>${eol}    ${line}${eol}  </ItemGroup>${eol}${xml.slice(close)}`;
}
