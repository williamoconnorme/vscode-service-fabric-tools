import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import type { LocalClusterManager } from '../cluster/localCluster';
import { createClientForConnection } from '../cluster/clusterAuth';
import { reportClusterAuthFailure } from './clusterCommands';
import type { NodeDeactivationIntent, SfRestClient } from '../cluster/sfRestClient';
import type { ClusterDocumentProvider } from '../views/clusterDocuments';
import type { ClusterEntityRef, ClustersTreeProvider, ClusterTreeItem } from '../views/clustersTreeProvider';
import type { Logger } from '../util/logger';

/** Everything the entity commands need from the extension host. */
export interface ClusterCommandContext {
	store: ConnectionStore;
	local: LocalClusterManager;
	tree: ClustersTreeProvider;
	documents: ClusterDocumentProvider;
	logger: Logger;
}

/** A command handler bound to a Clusters-tree item. Palette invocations (no item) are rejected with a hint. */
type EntityHandler = (ctx: ClusterCommandContext, item: ClusterTreeItem, client: SfRestClient, conn: ClusterConnection) => Promise<void>;

/**
 * Builds the `serviceFabric.cluster.*` entity commands for the Clusters view.
 * Each handler receives the right-clicked tree item plus a client for its cluster.
 */
export function clusterEntityCommands(ctx: ClusterCommandContext): [string, (item?: ClusterTreeItem) => Promise<void>][] {
	const bind =
		(handler: EntityHandler, needsConnection = true) =>
		async (item?: ClusterTreeItem): Promise<void> => {
			if (!item?.connection) {
				vscode.window.showInformationMessage('Right-click an item in the Service Fabric Clusters view to run this command.');
				return;
			}
			if (needsConnection && !item.connection.connected && item.kind === 'cluster') {
				vscode.window.showWarningMessage(
					`${item.connection.label} is disconnected. Refresh the Clusters view once the cluster is reachable.`,
				);
				return;
			}
			try {
				await handler(ctx, item, createClientForConnection(item.connection, { interactive: true }), item.connection);
			} catch (err) {
				if (!(await reportClusterAuthFailure(err, item.connection))) throw err;
			}
		};
	return [
		['serviceFabric.cluster.refreshNode', bind(refreshNode, false)],
		['serviceFabric.cluster.showDetails', bind(showDetails)],
		['serviceFabric.cluster.showHealth', bind(showHealth)],
		['serviceFabric.cluster.showManifest', bind(showClusterManifest)],
		['serviceFabric.cluster.copyName', bind(copyName, false)],
		['serviceFabric.cluster.unprovisionType', bind(unprovisionApplicationType)],
		['serviceFabric.cluster.deleteApplication', bind(deleteApplication)],
		['serviceFabric.cluster.showUpgradeProgress', bind(showUpgradeProgress)],
		['serviceFabric.cluster.resumeUpgrade', bind(resumeUpgrade)],
		['serviceFabric.cluster.rollbackUpgrade', bind(rollbackUpgrade)],
		['serviceFabric.cluster.changeUpgradeMode', bind(changeUpgradeMode)],
		['serviceFabric.cluster.deleteService', bind(deleteService)],
		['serviceFabric.cluster.scaleService', bind(scaleService)],
		['serviceFabric.cluster.resetPartitionLoad', bind(resetPartitionLoad)],
		['serviceFabric.cluster.recoverPartition', bind(recoverPartition)],
		['serviceFabric.cluster.restartReplica', bind(restartReplica)],
		['serviceFabric.cluster.removeReplica', bind(removeReplica)],
		['serviceFabric.cluster.activateNode', bind(activateNode)],
		['serviceFabric.cluster.deactivateNode', bind(deactivateNode)],
		['serviceFabric.cluster.restartNode', bind(restartNode)],
		['serviceFabric.cluster.removeNodeState', bind(removeNodeState)],
		['serviceFabric.cluster.restartCodePackage', bind(restartCodePackage)],
		['serviceFabric.cluster.showContainerLogs', bind(showContainerLogs)],
		['serviceFabric.cluster.cancelRepairTask', bind(cancelRepairTask)],
		['serviceFabric.cluster.forceApproveRepairTask', bind(forceApproveRepairTask)],
		['serviceFabric.cluster.deleteRepairTask', bind(deleteRepairTask)],
	];
}

// ---- Navigation ---------------------------------------------------------------------

const refreshNode: EntityHandler = async (ctx, item) => {
	if (item.kind === 'cluster' && item.connection) {
		// Re-probe so the health/status on the cluster row updates too; the store change refreshes the tree.
		await ctx.local.refresh(item.connection, { interactive: true });
		return;
	}
	ctx.tree.refresh(item);
};

const copyName: EntityHandler = async (_ctx, item) => {
	const text = entityIdentifier(item);
	if (!text) return;
	await vscode.env.clipboard.writeText(text);
	vscode.window.setStatusBarMessage(`Copied ${text}`, 3000);
};

/** The most useful identifier for an item: `fabric:/` names for apps and services, ids for partitions and replicas. */
function entityIdentifier(item: ClusterTreeItem): string | undefined {
	const e = item.entity;
	switch (item.kind) {
		case 'cluster':
			return item.connection?.endpoint;
		case 'appType':
			return e.typeName;
		case 'appTypeVersion':
			return `${e.typeName} ${e.typeVersion}`;
		case 'app':
		case 'deployedApp':
			return e.appName ? `fabric:/${e.appName}` : undefined;
		case 'service':
			return e.serviceName;
		case 'partition':
			return e.partitionId;
		case 'replica':
		case 'deployedReplica':
			return e.replicaId;
		case 'node':
			return e.nodeName;
		case 'deployedServicePackage':
			return e.serviceManifestName;
		case 'codePackage':
			return e.codePackageName;
		case 'repairTask':
			return e.repairTaskId;
		default:
			return typeof item.label === 'string' ? item.label : item.label?.label;
	}
}

/**
 * Service Fabric Explorer deep link for a tree item, e.g.
 * `…/Explorer/index.html#/apptype/MyType/app/MyApp/service/MyApp~MySvc`.
 */
export function explorerUrlFor(connection: ClusterConnection, item?: ClusterTreeItem): string {
	const base = `${connection.endpoint.replace(/\/$/, '')}/Explorer/index.html`;
	const e = item?.entity ?? {};
	const route = explorerRoute(item?.kind, e);
	return route ? `${base}#${route}` : base;
}

function explorerRoute(kind: ClusterTreeItem['kind'] | undefined, e: ClusterEntityRef): string | undefined {
	const type = e.typeName ? `/apptype/${encodeURIComponent(e.typeName)}` : undefined;
	const app = type && e.appId ? `${type}/app/${e.appId}` : undefined;
	const service = app && e.serviceId ? `${app}/service/${e.serviceId}` : undefined;
	const partition = service && e.partitionId ? `${service}/partition/${e.partitionId}` : undefined;
	const node = e.nodeName ? `/node/${encodeURIComponent(e.nodeName)}` : undefined;
	const deployedApp = node && e.appId ? `${node}/deployedapp/${e.appId}` : undefined;
	const deployedPackage =
		deployedApp && e.serviceManifestName ? `${deployedApp}/deployedservice/${encodeURIComponent(e.serviceManifestName)}` : undefined;
	switch (kind) {
		case 'group': {
			const top: Partial<Record<string, string>> = {
				appTypes: '/apptypes',
				apps: '/apps',
				nodes: '/nodes',
				system: '/system',
				repairTasks: '/repairtasks',
			};
			return top[e.group ?? ''] ?? deployedPackage;
		}
		case 'appType':
		case 'appTypeVersion':
			return type;
		case 'app':
			return app;
		case 'service':
			return e.isSystemService ? '/system' : service;
		case 'partition':
			return e.isSystemService ? '/system' : partition;
		case 'replica':
			return e.isSystemService ? '/system' : partition && e.replicaId ? `${partition}/replica/${e.replicaId}` : undefined;
		case 'node':
			return node;
		case 'deployedApp':
			return deployedApp;
		case 'deployedServicePackage':
			return deployedPackage;
		case 'codePackage':
			return deployedPackage && e.codePackageName ? `${deployedPackage}/codepackage/${encodeURIComponent(e.codePackageName)}` : undefined;
		case 'deployedReplica':
			return deployedPackage && e.replicaId ? `${deployedPackage}/replica/${e.replicaId}` : undefined;
		case 'repairTask':
			return '/repairtasks';
		default:
			return undefined;
	}
}

// ---- Inspection ---------------------------------------------------------------------

const showDetails: EntityHandler = async (ctx, item, client, conn) => {
	const e = item.entity;
	const title = `${conn.label} - ${entityIdentifier(item) ?? item.kind}`;
	await withGatewayProgress(`Loading details for ${entityIdentifier(item) ?? item.kind}…`, ctx.logger, async () => {
		switch (item.kind) {
			case 'cluster': {
				const [version, health, upgrade, load] = await Promise.all([
					client.getClusterVersion(),
					client.getClusterHealthDetail().catch(errorValue),
					client.getClusterUpgradeProgress().catch(errorValue),
					client.getClusterLoadInformation().catch(errorValue),
				]);
				return ctx.documents.showJson(title, {
					Endpoint: conn.endpoint,
					Version: version,
					Health: health,
					UpgradeProgress: upgrade,
					LoadInformation: load,
				});
			}
			case 'appType':
				return ctx.documents.showJson(title, e.raw);
			case 'appTypeVersion':
				return ctx.documents.showJson(title, {
					ApplicationType: e.raw,
					ServiceTypes: await client.getServiceTypes(e.typeName ?? '', e.typeVersion ?? '').catch(errorValue),
				});
			case 'app':
				return ctx.documents.showJson(title, {
					Application: await client.rawGet(`/Applications/${e.appId}`),
					UpgradeProgress: await client.getApplicationUpgradeProgress(e.appId ?? '').catch(errorValue),
				});
			case 'service':
				return ctx.documents.showJson(title, {
					Service: await client.rawGet(`/Services/${e.serviceId}`),
					Description: await client.getServiceDescription(e.serviceId ?? '').catch(errorValue),
				});
			case 'partition':
				return ctx.documents.showJson(title, {
					Partition: await client.rawGet(`/Partitions/${encodeURIComponent(e.partitionId ?? '')}`),
					LoadInformation: await client.getPartitionLoadInformation(e.partitionId ?? '').catch(errorValue),
				});
			case 'replica':
				return ctx.documents.showJson(title, {
					Replica: await client.rawGet(
						`/Partitions/${encodeURIComponent(e.partitionId ?? '')}/$/GetReplicas/${encodeURIComponent(e.replicaId ?? '')}`,
					),
					Detail: e.nodeName
						? await client.getReplicaDetail(e.nodeName, e.partitionId ?? '', e.replicaId ?? '').catch(errorValue)
						: undefined,
				});
			case 'node':
				return ctx.documents.showJson(title, {
					Node: await client.rawGet(`/Nodes/${encodeURIComponent(e.nodeName ?? '')}`),
					LoadInformation: await client.getNodeLoadInformation(e.nodeName ?? '').catch(errorValue),
				});
			case 'deployedApp':
				return ctx.documents.showJson(
					title,
					await client.rawGet(`/Nodes/${encodeURIComponent(e.nodeName ?? '')}/$/GetApplications/${e.appId}`),
				);
			case 'deployedServicePackage':
				return ctx.documents.showJson(
					title,
					await client.rawGet(
						`/Nodes/${encodeURIComponent(e.nodeName ?? '')}/$/GetApplications/${e.appId}/$/GetServicePackages/${encodeURIComponent(e.serviceManifestName ?? '')}`,
					),
				);
			case 'deployedReplica':
				return ctx.documents.showJson(title, {
					Replica: e.raw,
					Detail: await client.getReplicaDetail(e.nodeName ?? '', e.partitionId ?? '', e.replicaId ?? '').catch(errorValue),
				});
			default:
				return ctx.documents.showJson(title, e.raw ?? e);
		}
	});
};

const showHealth: EntityHandler = async (ctx, item, client, conn) => {
	const e = item.entity;
	const name = entityIdentifier(item) ?? item.kind;
	await withGatewayProgress(`Loading health for ${name}…`, ctx.logger, async () => {
		const health = await (() => {
			switch (item.kind) {
				case 'cluster':
					return client.getClusterHealthDetail();
				case 'app':
					return client.getApplicationHealth(e.appId ?? '');
				case 'service':
					return client.getServiceHealth(e.serviceId ?? '');
				case 'partition':
					return client.getPartitionHealth(e.partitionId ?? '');
				case 'replica':
				case 'deployedReplica':
					return client.getReplicaHealth(e.partitionId ?? '', e.replicaId ?? '');
				case 'node':
					return client.getNodeHealth(e.nodeName ?? '');
				case 'deployedApp':
					return client.getDeployedApplicationHealth(e.nodeName ?? '', e.appId ?? '');
				case 'deployedServicePackage':
					return client.getDeployedServicePackageHealth(e.nodeName ?? '', e.appId ?? '', e.serviceManifestName ?? '');
				default:
					throw new Error(`Health is not available for ${item.kind} items.`);
			}
		})();
		await ctx.documents.showJson(`${conn.label} - ${name} health`, health);
	});
};

const showClusterManifest: EntityHandler = async (ctx, _item, client, conn) => {
	await withGatewayProgress(`Loading cluster manifest for ${conn.label}…`, ctx.logger, async () => {
		const manifest = await client.getClusterManifest();
		await ctx.documents.show(`${conn.label} - ClusterManifest`, manifest, 'xml');
	});
};

const showContainerLogs: EntityHandler = async (ctx, item, client, conn) => {
	const e = item.entity;
	const tail = await vscode.window.showInputBox({
		prompt: 'Number of log lines to show from the end (or "all")',
		value: '100',
		validateInput: (v) => (/^(all|\d+)$/i.test(v.trim()) ? null : 'Enter a number or "all"'),
	});
	if (tail === undefined) return;
	const which = await vscode.window.showQuickPick(
		[
			{ label: 'Current container', previous: false },
			{ label: 'Previous (exited) container', previous: true },
		],
		{ placeHolder: 'Which container instance?' },
	);
	if (!which) return;
	await withGatewayProgress(`Fetching container logs for ${e.codePackageName}…`, ctx.logger, async () => {
		const logs = await client.getContainerLogs(e.nodeName ?? '', e.appId ?? '', e.serviceManifestName ?? '', e.codePackageName ?? '', {
			tail: tail.trim().toLowerCase(),
			previous: which.previous,
		});
		await ctx.documents.show(`${conn.label} - ${e.nodeName} - ${e.serviceManifestName}-${e.codePackageName}`, logs || '(no output)', 'log');
	});
};

// ---- Application types ----------------------------------------------------------------

const unprovisionApplicationType: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	let version = e.typeVersion;
	if (!version) {
		const versions = Array.isArray(e.raw) ? (e.raw as { version: string; status: string }[]) : [];
		const picked = await vscode.window.showQuickPick(
			versions.map((v) => ({ label: v.version, description: v.status })),
			{ placeHolder: `Which version of ${e.typeName} should be unprovisioned?` },
		);
		version = picked?.label;
	}
	if (!version) return;
	if (
		!(await confirmDestructive(
			`Unprovision application type ${e.typeName} ${version}?`,
			'Fails if any application of this version still exists. The package is removed from the image store.',
			'Unprovision',
			'data',
		))
	) {
		return;
	}
	await runMutation(ctx, `Unprovisioning ${e.typeName} ${version}…`, () =>
		client.unprovisionApplicationType(e.typeName ?? '', version ?? ''),
	);
};

// ---- Applications and services --------------------------------------------------------

const deleteApplication: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	const choice = await vscode.window.showWarningMessage(
		`Delete application fabric:/${e.appName}?`,
		{ modal: true, detail: 'All of its services, partitions and replicas are removed. State held by stateful services is lost.' },
		'Delete',
		'Force Delete',
	);
	if (!choice) return;
	await runMutation(ctx, `Deleting fabric:/${e.appName}…`, () => client.deleteApplication(e.appId ?? '', choice === 'Force Delete'));
};

// ---- Upgrades in progress ---------------------------------------------------------------

/** The application's upgrade progress, or `undefined` (with a message) when it isn't upgrading. */
async function upgradeInProgress(item: ClusterTreeItem, client: SfRestClient): Promise<any | undefined> {
	const progress = await client.getApplicationUpgradeProgress(item.entity.appId ?? '');
	const state = String(progress?.UpgradeState ?? '');
	if (!/InProgress|Pending/.test(state)) {
		vscode.window.showInformationMessage(`fabric:/${item.entity.appName} isn't upgrading${state ? ` (upgrade state: ${state})` : ''}.`);
		return undefined;
	}
	return progress;
}

const showUpgradeProgress: EntityHandler = async (ctx, item, client) => {
	const progress = await client.getApplicationUpgradeProgress(item.entity.appId ?? '');
	await ctx.documents.showJson(`Upgrade progress: fabric:/${item.entity.appName}`, progress);
};

const resumeUpgrade: EntityHandler = async (ctx, item, client) => {
	const progress = await upgradeInProgress(item, client);
	if (!progress) return;
	const next = String(progress.NextUpgradeDomain ?? '');
	if (progress.UpgradeState !== 'RollingForwardPending' || !next) {
		vscode.window.showInformationMessage(
			`fabric:/${item.entity.appName} isn't waiting to start an upgrade domain (state: ${progress.UpgradeState}). Resuming only applies to UnmonitoredManual upgrades between domains.`,
		);
		return;
	}
	await runMutation(ctx, `Starting upgrade domain ${next} for fabric:/${item.entity.appName}…`, () =>
		client.moveToNextUpgradeDomain(item.entity.appId ?? '', next),
	);
};

const rollbackUpgrade: EntityHandler = async (ctx, item, client) => {
	const progress = await upgradeInProgress(item, client);
	if (!progress) return;
	const target = progress.TargetApplicationTypeVersion ? ` to ${progress.TargetApplicationTypeVersion}` : '';
	if (
		!(await confirmDestructive(
			`Roll back the upgrade of fabric:/${item.entity.appName}${target}?`,
			'Upgrade domains already upgraded go back to the previous version. The rollback runs as UnmonitoredAuto.',
			'Roll Back',
			'soft',
		))
	) {
		return;
	}
	await runMutation(ctx, `Rolling back the upgrade of fabric:/${item.entity.appName}…`, () =>
		client.rollbackApplicationUpgrade(item.entity.appId ?? ''),
	);
};

const changeUpgradeMode: EntityHandler = async (ctx, item, client) => {
	const progress = await upgradeInProgress(item, client);
	if (!progress) return;
	const current = String(progress.RollingUpgradeMode ?? '');
	const modes = [
		{ label: 'Monitored', description: 'Health checks after each upgrade domain; rolls back on failure', value: 'Monitored' },
		{ label: 'UnmonitoredAuto', description: 'Moves through upgrade domains without health checks', value: 'UnmonitoredAuto' },
		{ label: 'UnmonitoredManual', description: 'Waits for "Resume Upgrade" before each upgrade domain', value: 'UnmonitoredManual' },
	].map((m) => ({ ...m, detail: m.value === current ? 'Current mode' : undefined }));
	const picked = await vscode.window.showQuickPick(modes, { placeHolder: `Upgrade mode for fabric:/${item.entity.appName} (now ${current || 'unknown'})` });
	if (!picked || picked.value === current) return;
	await runMutation(ctx, `Switching the upgrade of fabric:/${item.entity.appName} to ${picked.value}…`, () =>
		client.updateApplicationUpgrade(item.entity.appId ?? '', {
			Name: `fabric:/${item.entity.appName}`,
			UpgradeKind: 'Rolling',
			UpdateDescription: { RollingUpgradeMode: picked.value, ...(picked.value === 'Monitored' ? { FailureAction: 'Rollback' } : {}) },
		}),
	);
};

const deleteService: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	const choice = await vscode.window.showWarningMessage(
		`Delete service ${e.serviceName}?`,
		{ modal: true, detail: 'All partitions and replicas are removed. State held by a stateful service is lost.' },
		'Delete',
		'Force Delete',
	);
	if (!choice) return;
	await runMutation(ctx, `Deleting ${e.serviceName}…`, () => client.deleteService(e.serviceId ?? '', choice === 'Force Delete'));
};

const scaleService: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	const stateless = e.serviceKind === 'Stateless';
	const description = (await client.getServiceDescription(e.serviceId ?? '').catch(() => undefined)) as
		{ InstanceCount?: number; TargetReplicaSetSize?: number; MinReplicaSetSize?: number } | undefined;
	const current = stateless ? description?.InstanceCount : description?.TargetReplicaSetSize;
	const min = stateless ? -1 : Math.max(1, description?.MinReplicaSetSize ?? 1);
	const value = await vscode.window.showInputBox({
		prompt: stateless
			? `New instance count for ${e.serviceName} (-1 = one instance on every node)`
			: `New target replica set size for ${e.serviceName} (minimum ${min})`,
		value: current !== undefined ? String(current) : '',
		validateInput: (v) => {
			const n = Number(v.trim());
			if (!Number.isInteger(n)) return 'Enter a whole number';
			if (stateless && (n === 0 || n < -1)) return 'Use -1 (all nodes) or a positive count';
			if (!stateless && n < min) return `Must be at least ${min} (the service's MinReplicaSetSize)`;
			return null;
		},
	});
	if (value === undefined) return;
	const count = Number(value.trim());
	await runMutation(ctx, `Scaling ${e.serviceName} to ${count}…`, () => client.scaleService(e.serviceId ?? '', e.serviceKind ?? '', count));
};

// ---- Partitions -----------------------------------------------------------------------

const resetPartitionLoad: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	if (
		!(await confirmDestructive(
			`Reset the reported load of partition ${e.partitionId}?`,
			'The balancer falls back to default load values.',
			'Reset Load',
			'soft',
		))
	)
		return;
	await runMutation(ctx, `Resetting load for partition ${e.partitionId}…`, () => client.resetPartitionLoad(e.partitionId ?? ''));
};

const recoverPartition: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	if (
		!(await confirmDestructive(
			`Recover partition ${e.partitionId} from quorum loss?`,
			'Only use this when the partition is stuck in quorum loss and the lost replicas cannot be recovered. Data since the last quorum may be lost.',
			'Recover',
			'data',
		))
	) {
		return;
	}
	await runMutation(ctx, `Recovering partition ${e.partitionId}…`, () => client.recoverPartition(e.partitionId ?? ''));
};

// ---- Replicas -------------------------------------------------------------------------

const restartReplica: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	if (
		!(await confirmDestructive(
			`Restart replica ${e.replicaId} on ${e.nodeName}?`,
			'Simulates a transient failure; the replica is closed and rebuilt in place.',
			'Restart',
			'soft',
		))
	) {
		return;
	}
	await runMutation(ctx, `Restarting replica ${e.replicaId}…`, () =>
		client.restartReplica(e.nodeName ?? '', e.partitionId ?? '', e.replicaId ?? ''),
	);
};

const removeReplica: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	const noun = e.serviceKind === 'Stateful' ? 'replica' : 'instance';
	const choice = await vscode.window.showWarningMessage(
		`Remove ${noun} ${e.replicaId} from ${e.nodeName}?`,
		{
			modal: true,
			detail:
				'Simulates a permanent failure: the replica is closed, dropped and its local state deleted. The cluster builds a replacement elsewhere. Force Remove skips graceful close and affects every replica in the same host process.',
		},
		'Remove',
		'Force Remove',
	);
	if (!choice) return;
	await runMutation(ctx, `Removing ${noun} ${e.replicaId}…`, () =>
		client.removeReplica(e.nodeName ?? '', e.partitionId ?? '', e.replicaId ?? '', choice === 'Force Remove'),
	);
};

// ---- Nodes ----------------------------------------------------------------------------

const activateNode: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	await runMutation(ctx, `Activating node ${e.nodeName}…`, () => client.activateNode(e.nodeName ?? ''));
};

const deactivateNode: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	const intents: (vscode.QuickPickItem & { intent: NodeDeactivationIntent })[] = [
		{
			label: 'Pause',
			description: 'Keep replicas in place, stop new placements',
			detail: 'Short maintenance where the node stays up.',
			intent: 'Pause',
		},
		{ label: 'Restart', description: 'Move replicas off, node will come back', detail: 'Reboots and OS patching.', intent: 'Restart' },
		{
			label: 'Remove Data',
			description: 'Move replicas off and rebuild them elsewhere',
			detail: 'Node will return with its disks wiped.',
			intent: 'RemoveData',
		},
		{
			label: 'Remove Node',
			description: 'Node is leaving the cluster for good',
			detail: 'Scale-in. Follow with Remove Node State once it is down.',
			intent: 'RemoveNode',
		},
	];
	const picked = await vscode.window.showQuickPick(intents, { placeHolder: `Why is ${e.nodeName} being deactivated?` });
	if (!picked) return;
	if (
		!(await confirmDestructive(
			`Deactivate node ${e.nodeName} (${picked.label})?`,
			'The node stops accepting new replicas. Intents stronger than Pause move existing replicas to other nodes, which may take a while on a busy cluster.',
			'Deactivate',
			picked.intent === 'Pause' ? 'soft' : 'data',
		))
	) {
		return;
	}
	await runMutation(ctx, `Deactivating node ${e.nodeName}…`, () => client.deactivateNode(e.nodeName ?? '', picked.intent));
};

const restartNode: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	if (
		!(await confirmDestructive(
			`Restart node ${e.nodeName}?`,
			'The Fabric runtime on the node restarts; every replica hosted there fails over. Services with a single replica on this node are briefly unavailable.',
			'Restart',
			'soft',
		))
	) {
		return;
	}
	const instanceId = (await client.getNode(e.nodeName ?? '').catch(() => undefined))?.instanceId ?? '0';
	await runMutation(ctx, `Restarting node ${e.nodeName}…`, () => client.restartNode(e.nodeName ?? '', instanceId));
};

const removeNodeState: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	if (
		!(await confirmDestructive(
			`Remove node state for ${e.nodeName}?`,
			'Tells the cluster the node is gone for good and its replicas will never return. Only use on a node that is Down and not coming back; otherwise data loss can occur.',
			'Remove Node State',
			'data',
		))
	) {
		return;
	}
	await runMutation(ctx, `Removing node state for ${e.nodeName}…`, () => client.removeNodeState(e.nodeName ?? ''));
};

// ---- Code packages ---------------------------------------------------------------------

const restartCodePackage: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	if (
		!(await confirmDestructive(
			`Restart code package ${e.serviceManifestName}/${e.codePackageName} on ${e.nodeName}?`,
			'The host process is killed and restarted; every replica it hosts fails over.',
			'Restart',
			'soft',
		))
	) {
		return;
	}
	await runMutation(ctx, `Restarting ${e.codePackageName} on ${e.nodeName}…`, () =>
		client.restartDeployedCodePackage(e.nodeName ?? '', e.appId ?? '', {
			serviceManifestName: e.serviceManifestName ?? '',
			codePackageName: e.codePackageName ?? '',
			codePackageInstanceId: e.codePackageInstanceId ?? '0',
			servicePackageActivationId: e.servicePackageActivationId,
		}),
	);
};

// ---- Repair tasks -----------------------------------------------------------------------

const cancelRepairTask: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	const choice = await vscode.window.showWarningMessage(
		`Cancel repair task ${e.repairTaskId}?`,
		{
			modal: true,
			detail:
				'Cancel asks the executor to stop before it starts work. Abort also interrupts a repair that is already executing; the executor decides whether that is safe.',
		},
		'Cancel Task',
		'Abort Task',
	);
	if (!choice) return;
	await runMutation(ctx, `Cancelling repair task ${e.repairTaskId}…`, () =>
		client.cancelRepairTask(e.repairTaskId ?? '', e.repairTaskVersion ?? '0', choice === 'Abort Task'),
	);
};

const forceApproveRepairTask: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	if (
		!(await confirmDestructive(
			`Force approval of repair task ${e.repairTaskId}?`,
			'Skips the Repair Manager safety checks (node deactivation and health). The repair proceeds even if that causes availability or data loss.',
			'Force Approve',
			'data',
		))
	) {
		return;
	}
	await runMutation(ctx, `Approving repair task ${e.repairTaskId}…`, () =>
		client.forceApproveRepairTask(e.repairTaskId ?? '', e.repairTaskVersion ?? '0'),
	);
};

const deleteRepairTask: EntityHandler = async (ctx, item, client) => {
	const e = item.entity;
	if (
		!(await confirmDestructive(
			`Delete repair task ${e.repairTaskId}?`,
			'Removes the completed task and its history from the Repair Manager.',
			'Delete',
			'soft',
		))
	) {
		return;
	}
	await runMutation(ctx, `Deleting repair task ${e.repairTaskId}…`, () =>
		client.deleteRepairTask(e.repairTaskId ?? '', e.repairTaskVersion ?? '0'),
	);
};

// ---- Helpers --------------------------------------------------------------------------

/**
 * Modal confirmation for destructive actions. `soft` actions (restarts, load resets) honour
 * `serviceFabric.confirmDestructiveActions`; `data` actions always ask, because they can lose state.
 */
async function confirmDestructive(message: string, detail: string, button: string, severity: 'soft' | 'data'): Promise<boolean> {
	const confirmSetting = vscode.workspace.getConfiguration('serviceFabric').get<boolean>('confirmDestructiveActions') ?? true;
	if (severity === 'soft' && !confirmSetting) return true;
	return (await vscode.window.showWarningMessage(message, { modal: true, detail }, button)) === button;
}

/** Runs a mutating gateway call with progress, reports the outcome and refreshes the tree. */
async function runMutation(ctx: ClusterCommandContext, title: string, action: () => Promise<void>): Promise<void> {
	const ok = await withGatewayProgress(title, ctx.logger, action);
	if (ok) {
		ctx.logger.info(`${title} done.`);
		vscode.window.setStatusBarMessage(`$(check) ${title.replace(/…$/, '')} requested`, 5000);
	}
	// Entities move between nodes on most actions, so refresh everything rather than one branch.
	ctx.tree.refresh();
}

/** Shows `title` as a notification progress while `action` runs; surfaces failures and returns whether it succeeded. */
async function withGatewayProgress(title: string, logger: Logger, action: () => Promise<unknown>): Promise<boolean> {
	try {
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => action());
		return true;
	} catch (err) {
		const message = (err as Error).message;
		logger.error(`${title} failed: ${message}`);
		vscode.window.showErrorMessage(`Service Fabric: ${title.replace(/…$/, '')} failed. ${message}`);
		return false;
	}
}

function errorValue(err: Error): { Error: string } {
	return { Error: err.message };
}
