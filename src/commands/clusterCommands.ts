import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import type { LocalClusterManager } from '../cluster/localCluster';
import { configureClusterSecurity, type ClusterSecurity } from '../cluster/clusterAuth';
import { runPowerShell } from '../cluster/powerShellRunner';
import type { Logger } from '../util/logger';

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

/** `serviceFabric.cluster.connectRemote` */
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
	const via = conn.auth ? ' using Microsoft Entra ID' : '';
	if (refreshed.connected) vscode.window.showInformationMessage(`Connected to ${label}${via}.`);
	else vscode.window.showWarningMessage(`Saved ${label}, but couldn't reach it${via}. See the Service Fabric output channel.`);
}

/** `serviceFabric.cluster.disconnect`: removes the given (or active) connection. */
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

/** `serviceFabric.cluster.startLocal`: runs the SDK's DevClusterSetup.ps1 (Windows only). */
export async function startLocalCluster(logger: Logger, nodeCount?: LocalClusterNodeCount): Promise<void> {
	if (process.platform !== 'win32') {
		vscode.window.showWarningMessage('Local Service Fabric clusters are supported on Windows only.');
		return;
	}
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

/** `serviceFabric.cluster.stopLocal`: stops FabricHostSvc (Windows only; silently a no-op elsewhere). */
export async function stopLocalCluster(logger: Logger): Promise<void> {
	if (process.platform !== 'win32') return;
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
	if (process.platform !== 'win32') return;
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
	if (process.platform !== 'win32') {
		vscode.window.showWarningMessage('Local Service Fabric clusters are supported on Windows only.');
		return;
	}
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

/** `serviceFabric.cluster.openExplorer`: opens `<endpoint>/Explorer/index.html` for the given (or active) cluster. */
export async function openClusterExplorer(store: ConnectionStore, connection?: ClusterConnection): Promise<void> {
	const target = connection ?? store.getActive();
	if (!target) {
		vscode.window.showInformationMessage('No active cluster.');
		return;
	}
	const explorerUrl = `${target.endpoint.replace(/\/$/, '')}/Explorer/index.html`;
	await vscode.env.openExternal(vscode.Uri.parse(explorerUrl));
}
