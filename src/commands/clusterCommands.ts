// @ts-nocheck
import * as vscode from 'vscode';
import { runPowerShell } from '../cluster/powerShellRunner';

async function pickNodeCount(e) {
	let t = vscode.workspace.getConfiguration('serviceFabric').get('localCluster.nodeCount') ?? '5',
		r = [
			{
				label: '1-node',
				description: 'Fastest startup, no failover testing',
				detail: 'Single replica per stateful service. Good for inner-loop development.',
				value: '1',
				picked: t === '1',
			},
			{
				label: '5-node',
				description: 'Failover, placement constraints, rolling upgrades',
				detail: 'Five-replica primary cluster. Closer to production behaviour.',
				value: '5',
				picked: t === '5',
			},
		];
	return (
		await vscode.window.showQuickPick(r, {
			placeHolder: `${e} 1-node or 5-node mode (current default: ${t}-node)`,
		})
	)?.value;
}

async function connectLocalCluster(e) {
	await e.connect();
}

async function connectRemoteCluster(e, t) {
	let r = await vscode.window.showInputBox({
		prompt: 'Enter Service Fabric HTTP gateway endpoint',
		placeHolder: 'https://my-cluster.eastus.cloudapp.azure.com:19080',
		validateInput: (o) => (/^https?:\/\//.test(o) ? null : 'Must start with http:// or https://'),
	});
	if (!r) return;
	let n = await vscode.window.showInputBox({
		prompt: 'Display name for this cluster',
		value: new URL(r).hostname,
	});
	if (!n) return;
	let i = {
		id: `remote:${r}`,
		label: n,
		endpoint: r,
		kind: 'remote',
		connected: !1,
	};
	(await e.upsert(i), await e.setActive(i.id), await t.refresh(i));
}

async function disconnectCluster(e, t) {
	let r = t ?? e.getActive();
	r && (await e.remove(r.id));
}

async function selectActiveCluster(e) {
	let t = e.list();
	if (t.length === 0) {
		vscode.window.showInformationMessage('No clusters configured. Use "Connect to Local Cluster" first.');
		return;
	}
	let r = await vscode.window.showQuickPick(
		t.map((n) => ({
			label: n.label,
			description: n.endpoint,
			detail: n.connected ? 'Connected' : 'Disconnected',
			id: n.id,
		})),
		{
			placeHolder: 'Select active Service Fabric cluster',
		},
	);
	r && (await e.setActive(r.id));
}

async function startLocalCluster(e, t) {
	if (process.platform !== 'win32') {
		vscode.window.showWarningMessage('Local Service Fabric clusters are supported on Windows only.');
		return;
	}
	let r = t ?? (await pickNodeCount('Start cluster as'));
	if (!r) return;
	let i = `
$ErrorActionPreference = 'Stop'
$sdk = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Service Fabric SDK' -ErrorAction SilentlyContinue).FabricSDKInstallPath
if (-not $sdk) { Write-Error 'Service Fabric SDK is not installed.'; exit 2 }
$cluster = Join-Path $sdk 'ClusterSetup\\DevClusterSetup.ps1'
& $cluster ${r === '1' ? '-CreateOneNodeCluster' : ''}
`;
	(e.show(), e.info(`Starting ${r}-node local cluster...`), await runPowerShell(e, i, {}));
}

async function stopLocalCluster(e) {
	if (process.platform !== 'win32') return;
	let t = `
$ErrorActionPreference = 'Stop'
Stop-Service FabricHostSvc -Force -ErrorAction SilentlyContinue
`;
	(e.show(), await runPowerShell(e, t, {}));
}

async function resetLocalCluster(e, t) {
	if (
		process.platform !== 'win32' ||
		((vscode.workspace.getConfiguration('serviceFabric').get('confirmDestructiveActions') ?? !0) &&
			(await vscode.window.showWarningMessage(
				'Reset the local Service Fabric cluster? All deployed applications will be removed.',
				{
					modal: !0,
				},
				'Reset',
			)) !== 'Reset')
	)
		return;
	let n = t ?? (await pickNodeCount('Reset and restart cluster as'));
	if (!n) return;
	let o = `
$ErrorActionPreference = 'Stop'
$sdk = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Service Fabric SDK' -ErrorAction SilentlyContinue).FabricSDKInstallPath
if (-not $sdk) { Write-Error 'Service Fabric SDK is not installed.'; exit 2 }
$clean = Join-Path $sdk 'ClusterSetup\\CleanCluster.ps1'
$setup = Join-Path $sdk 'ClusterSetup\\DevClusterSetup.ps1'
& $clean
& $setup ${n === '1' ? '-CreateOneNodeCluster' : ''}
`;
	(e.show(), e.info(`Resetting cluster to ${n}-node mode...`), await runPowerShell(e, o, {}));
}

async function switchLocalClusterMode(e) {
	if (process.platform !== 'win32') {
		vscode.window.showWarningMessage('Local Service Fabric clusters are supported on Windows only.');
		return;
	}
	let t = await pickNodeCount('Switch local cluster to');
	!t ||
		((vscode.workspace.getConfiguration('serviceFabric').get('confirmDestructiveActions') ?? !0) &&
			(await vscode.window.showWarningMessage(
				`Recreate local cluster as ${t}-node? All currently deployed applications will be removed.`,
				{
					modal: !0,
				},
				'Recreate',
			)) !== 'Recreate') ||
		(await resetLocalCluster(e, t),
		await vscode.workspace.getConfiguration('serviceFabric').update('localCluster.nodeCount', t, vscode.ConfigurationTarget.Global));
}

async function openClusterExplorer(e, t) {
	let r = t ?? e.getActive();
	if (!r) {
		vscode.window.showInformationMessage('No active cluster.');
		return;
	}
	let n = `${r.endpoint.replace(/\/$/, '')}/Explorer/index.html`;
	await vscode.env.openExternal(vscode.Uri.parse(n));
}

export {
	connectLocalCluster,
	connectRemoteCluster,
	disconnectCluster,
	openClusterExplorer,
	resetLocalCluster,
	selectActiveCluster,
	startLocalCluster,
	stopLocalCluster,
	switchLocalClusterMode,
};
