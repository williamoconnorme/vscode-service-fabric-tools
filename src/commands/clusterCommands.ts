import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import type { LocalClusterManager } from '../cluster/localCluster';
import { chooseClientCertificate, configureClusterSecurity, securityOf, type ClusterSecurity } from '../cluster/clusterAuth';
import { getClientCertManager } from '../cluster/clientCertStore';
import { SfAuthError } from '../cluster/sfRestClient';
import { runPowerShell } from '../cluster/powerShellRunner';
import type { Logger } from '../util/logger';
import type { ClusterTreeItem } from '../views/clustersTreeProvider';
import { explorerUrlFor } from './clusterEntityCommands';
import { localClusterUnsupportedReason } from '../build/serviceProjects';

/** Local dev cluster size, as stored in `serviceFabric.localCluster.nodeCount`. */
export type LocalClusterNodeCount = '1' | '5';

interface NodeCountPickItem extends vscode.QuickPickItem {
	value: LocalClusterNodeCount;
}

/** Asks for 1-node vs 5-node mode, preselecting the `localCluster.nodeCount` setting. */
async function pickNodeCount(prompt: string): Promise<LocalClusterNodeCount | undefined> {
	const current = vscode.workspace.getConfiguration('serviceFabric').get<string>('localCluster.nodeCount') ?? '5';
	const items: NodeCountPickItem[] = [
		{
			label: '1-node',
			description: 'Fastest startup, no failover testing',
			detail: 'Single replica per stateful service. Good for inner-loop development.',
			value: '1',
			picked: current === '1',
		},
		{
			label: '5-node',
			description: 'Failover, placement constraints, rolling upgrades',
			detail: 'Five-replica primary cluster. Closer to production behaviour.',
			value: '5',
			picked: current === '5',
		},
	];
	return (
		await vscode.window.showQuickPick(items, {
			placeHolder: `${prompt} 1-node or 5-node mode (current default: ${current}-node)`,
		})
	)?.value;
}

/** `serviceFabric.cluster.connectLocal` */
export async function connectLocalCluster(local: LocalClusterManager): Promise<void> {
	await local.connect();
}

/** `serviceFabric.cluster.add`: the Clusters view's `+` button; asks local or remote, then connects. */
export async function addCluster(store: ConnectionStore, local: LocalClusterManager, logger: Logger): Promise<void> {
	const picked = await vscode.window.showQuickPick(
		[
			{ label: '$(vm) Local Cluster', detail: 'The dev cluster on this machine (serviceFabric.localCluster.endpoint)', remote: false },
			{ label: '$(globe) Remote Cluster…', detail: 'Any cluster reachable through its HTTP gateway endpoint', remote: true },
		],
		{ placeHolder: 'Add a Service Fabric cluster' },
	);
	if (!picked) return;
	if (picked.remote) await connectRemoteCluster(store, local, logger);
	else await connectLocalCluster(local);
}

/**
 * `serviceFabric.cluster.connectRemote`: saves a remote cluster connection. For https
 * endpoints it offers to pin an untrusted server certificate, and for clusters secured
 * with Microsoft Entra ID it signs in through VS Code's Microsoft account provider.
 */
export async function connectRemoteCluster(store: ConnectionStore, local: LocalClusterManager, logger: Logger): Promise<void> {
	const endpoint = await vscode.window.showInputBox({
		prompt: 'Enter Service Fabric HTTP gateway endpoint',
		placeHolder: 'https://my-cluster.eastus.cloudapp.azure.com:19080',
		validateInput: (value) => {
			if (!/^https?:\/\//.test(value)) return 'Must start with http:// or https://';
			try {
				return new URL(value).hostname ? null : 'Must include a host name';
			} catch {
				return 'Not a valid URL';
			}
		},
	});
	if (!endpoint) return;
	let security: ClusterSecurity | undefined;
	try {
		security = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `Checking security settings of ${new URL(endpoint).host}…` },
			() => configureClusterSecurity(endpoint, logger),
		);
	} catch (err) {
		logger.warn(`Cluster security check failed: ${(err as Error).message}`);
		vscode.window.showErrorMessage(`Couldn't connect to ${endpoint}: ${(err as Error).message}`);
		return;
	}
	if (!security) return;
	const label = await vscode.window.showInputBox({
		prompt: 'Display name for this cluster',
		value: new URL(endpoint).hostname,
	});
	if (!label) return;
	const conn: ClusterConnection = {
		id: `remote:${endpoint}`,
		label,
		endpoint,
		kind: 'remote',
		connected: false,
		...security,
	};
	await store.upsert(conn);
	await store.setActive(conn.id);
	// LocalClusterManager.refresh probes any endpoint, not only the local one.
	const refreshed = await local.refresh(conn, { interactive: true });
	const via = conn.auth ? ' using Microsoft Entra ID' : conn.clientCert ? ` with client certificate ${conn.clientCert.thumbprint}` : '';
	if (refreshed.connected) vscode.window.showInformationMessage(`Connected to ${label}${via}.`);
	else vscode.window.showWarningMessage(`Saved ${label}, but couldn't reach it${via}. See the Service Fabric output channel.`);
}

/**
 * `serviceFabric.cluster.changeClientCertificate`: picks a new X.509 client
 * certificate for the given (or active) cluster, checks the gateway accepts it
 * and saves it on the connection.
 */
export async function changeClientCertificate(
	store: ConnectionStore,
	local: LocalClusterManager,
	logger: Logger,
	connection?: ClusterConnection,
): Promise<void> {
	const target = connection ?? store.getActive();
	if (!target) {
		vscode.window.showInformationMessage('No active cluster. Use "Connect to Remote Cluster…" first.');
		return;
	}
	if (new URL(target.endpoint).protocol !== 'https:') {
		vscode.window.showWarningMessage(`${target.label} uses http://; client certificates need an https:// endpoint.`);
		return;
	}
	let clientCert;
	try {
		clientCert = await chooseClientCertificate(target.endpoint, { ...securityOf(target), clientCert: undefined }, logger, {
			pickImmediately: true,
		});
	} catch (err) {
		vscode.window.showErrorMessage(`Couldn't check the client certificate against ${target.label}: ${(err as Error).message}`);
		return;
	}
	if (!clientCert) return;
	if (target.clientCert) getClientCertManager().forget(target.clientCert.thumbprint);
	const updated: ClusterConnection = { ...target, clientCert };
	await store.upsert(updated);
	const refreshed = await local.refresh(updated, { interactive: true });
	if (refreshed.connected) vscode.window.showInformationMessage(`${target.label} now uses client certificate ${clientCert.thumbprint}.`);
}

/**
 * Shows a gateway error. A 401/403 from a certificate-secured (non-Entra)
 * https cluster offers "Change Client Certificate…". Returns `true` when `err`
 * was an auth failure.
 */
export async function reportClusterAuthFailure(err: unknown, connection: ClusterConnection): Promise<boolean> {
	if (!(err instanceof SfAuthError)) return false;
	if (connection.auth || !connection.endpoint.startsWith('https:')) {
		vscode.window.showErrorMessage(err.message);
		return true;
	}
	const hint = connection.clientCert
		? `The cluster rejected client certificate ${connection.clientCert.thumbprint}.`
		: 'The cluster may require a client certificate.';
	const choice = await vscode.window.showErrorMessage(`${err.message} ${hint}`, 'Change Client Certificate…');
	if (choice) await vscode.commands.executeCommand('serviceFabric.cluster.changeClientCertificate', { connection });
	return true;
}

/** `serviceFabric.cluster.disconnect` / `serviceFabric.cluster.remove`: removes the given (or active) connection. */
export async function disconnectCluster(store: ConnectionStore, connection?: ClusterConnection): Promise<void> {
	const target = connection ?? store.getActive();
	if (target) await store.remove(target.id);
}

/** `serviceFabric.cluster.selectActive` */
export async function selectActiveCluster(store: ConnectionStore): Promise<void> {
	const connections = store.list();
	if (connections.length === 0) {
		vscode.window.showInformationMessage('No clusters configured. Use "Connect to Local Cluster" first.');
		return;
	}
	const picked = await vscode.window.showQuickPick(
		connections.map((c) => ({
			label: c.label,
			description: c.endpoint,
			detail: c.connected ? 'Connected' : 'Disconnected',
			id: c.id,
		})),
		{ placeHolder: 'Select active Service Fabric cluster' },
	);
	if (picked) await store.setActive(picked.id);
}

/**
 * Says why the local dev cluster can't run here (not Windows, or Windows on
 * ARM) and offers to add a remote cluster. Returns `true` when it can't, so
 * callers stop. Runtime fallback for the `isWindows`-gated commands.
 */
function localClusterUnsupported(): boolean {
	const reason = localClusterUnsupportedReason(process.platform, process.arch);
	if (!reason) return false;
	void vscode.window.showWarningMessage(reason, 'Add Cluster…').then((choice) => {
		if (choice) void vscode.commands.executeCommand('serviceFabric.cluster.add');
	});
	return true;
}

/** `serviceFabric.cluster.startLocal`: runs the SDK's DevClusterSetup.ps1 (Windows only). */
export async function startLocalCluster(logger: Logger, nodeCount?: LocalClusterNodeCount): Promise<void> {
	if (localClusterUnsupported()) return;
	const mode = nodeCount ?? (await pickNodeCount('Start cluster as'));
	if (!mode) return;
	const script = `
$ErrorActionPreference = 'Stop'
$sdk = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Service Fabric SDK' -ErrorAction SilentlyContinue).FabricSDKInstallPath
if (-not $sdk) { Write-Error 'Service Fabric SDK is not installed.'; exit 2 }
$cluster = Join-Path $sdk 'ClusterSetup\\DevClusterSetup.ps1'
& $cluster ${mode === '1' ? '-CreateOneNodeCluster' : ''}
`;
	logger.show();
	logger.info(`Starting ${mode}-node local cluster...`);
	await runPowerShell(logger, script, {});
}

/** `serviceFabric.cluster.stopLocal`: stops FabricHostSvc (Windows only). */
export async function stopLocalCluster(logger: Logger): Promise<void> {
	if (localClusterUnsupported()) return;
	const script = `
$ErrorActionPreference = 'Stop'
Stop-Service FabricHostSvc -Force -ErrorAction SilentlyContinue
`;
	logger.show();
	await runPowerShell(logger, script, {});
}

/**
 * `serviceFabric.cluster.resetLocal`: cleans the dev cluster and sets it up again.
 * Asks for confirmation when `serviceFabric.confirmDestructiveActions` is on. `nodeCount`
 * skips the mode prompt and `confirmed` skips the confirmation; {@link switchLocalClusterMode}
 * passes both because it has already asked.
 */
export async function resetLocalCluster(logger: Logger, nodeCount?: LocalClusterNodeCount, confirmed = false): Promise<void> {
	if (localClusterUnsupported()) return;
	if (
		!confirmed &&
		(vscode.workspace.getConfiguration('serviceFabric').get<boolean>('confirmDestructiveActions') ?? true) &&
		(await vscode.window.showWarningMessage(
			'Reset the local Service Fabric cluster? All deployed applications will be removed.',
			{ modal: true },
			'Reset',
		)) !== 'Reset'
	) {
		return;
	}
	const mode = nodeCount ?? (await pickNodeCount('Reset and restart cluster as'));
	if (!mode) return;
	const script = `
$ErrorActionPreference = 'Stop'
$sdk = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Service Fabric SDK' -ErrorAction SilentlyContinue).FabricSDKInstallPath
if (-not $sdk) { Write-Error 'Service Fabric SDK is not installed.'; exit 2 }
$clean = Join-Path $sdk 'ClusterSetup\\CleanCluster.ps1'
$setup = Join-Path $sdk 'ClusterSetup\\DevClusterSetup.ps1'
& $clean
& $setup ${mode === '1' ? '-CreateOneNodeCluster' : ''}
`;
	logger.show();
	logger.info(`Resetting cluster to ${mode}-node mode...`);
	await runPowerShell(logger, script, {});
}

/** `serviceFabric.cluster.switchLocalMode`: recreates the cluster in the other mode and saves it as the default. */
export async function switchLocalClusterMode(logger: Logger): Promise<void> {
	if (localClusterUnsupported()) return;
	const mode = await pickNodeCount('Switch local cluster to');
	if (!mode) return;
	if (
		(vscode.workspace.getConfiguration('serviceFabric').get<boolean>('confirmDestructiveActions') ?? true) &&
		(await vscode.window.showWarningMessage(
			`Recreate local cluster as ${mode}-node? All currently deployed applications will be removed.`,
			{ modal: true },
			'Recreate',
		)) !== 'Recreate'
	) {
		return;
	}
	await resetLocalCluster(logger, mode, true);
	await vscode.workspace.getConfiguration('serviceFabric').update('localCluster.nodeCount', mode, vscode.ConfigurationTarget.Global);
}

/**
 * `serviceFabric.cluster.openExplorer`: opens Service Fabric Explorer for the given (or active)
 * cluster. Invoked on an entity in the Clusters tree, it deep-links to that entity's page.
 */
export async function openClusterExplorer(store: ConnectionStore, item?: ClusterTreeItem): Promise<void> {
	const target = item?.connection ?? store.getActive();
	if (!target) {
		vscode.window.showInformationMessage('No active cluster.');
		return;
	}
	await vscode.env.openExternal(vscode.Uri.parse(explorerUrlFor(target, item)));
}
