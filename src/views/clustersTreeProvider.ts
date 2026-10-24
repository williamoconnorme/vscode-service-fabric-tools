import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import { createClientForConnection } from '../cluster/clusterAuth';
import type {
	ApplicationInfo,
	ApplicationTypeInfo,
	ClusterNodeInfo,
	DeployedApplicationOnNodeInfo,
	DeployedCodePackageDetail,
	DeployedReplicaInfo,
	DeployedServicePackageInfo,
	PartitionInfo,
	RepairTaskInfo,
	ReplicaInfo,
	ServiceInfo,
	SfRestClient,
} from '../cluster/sfRestClient';

/**
 * Node kinds in the `serviceFabric.clusters` view. The tree mirrors Service Fabric
 * Explorer: cluster → Application Types / Applications / Nodes / System, then
 * application → service → partition → replica, and node → deployed application →
 * service package → code packages and replicas.
 */
export type ClusterNodeKind =
	| 'cluster'
	| 'group'
	| 'appType'
	| 'appTypeVersion'
	| 'app'
	| 'service'
	| 'partition'
	| 'replica'
	| 'node'
	| 'deployedApp'
	| 'deployedServicePackage'
	| 'codePackage'
	| 'deployedReplica'
	| 'repairTask'
	| 'message';

/** Which top-level or per-package group a `group` node is. */
export type ClusterGroupKind = 'appTypes' | 'apps' | 'nodes' | 'system' | 'repairTasks' | 'codePackages' | 'deployedReplicas';

/**
 * Identifiers a tree node carries for the commands that act on it. Every field is
 * optional; a node sets the ones that describe its own entity and its ancestors
 * (a replica knows its partition, service and application, for example).
 */
export interface ClusterEntityRef {
	group?: ClusterGroupKind;
	/** Application type name (type, version, application, service, partition, replica nodes). */
	typeName?: string;
	typeVersion?: string;
	/** Display name without `fabric:/`. */
	appName?: string;
	/** URL-encoded gateway application id (`My~App`). */
	appId?: string;
	/** URL-encoded gateway service id. */
	serviceId?: string;
	/** Full `fabric:/` service name. */
	serviceName?: string;
	/** `Stateful` / `Stateless`. */
	serviceKind?: string;
	/** True for services of `fabric:/System`. */
	isSystemService?: boolean;
	partitionId?: string;
	replicaId?: string;
	nodeName?: string;
	/** Node status (`Up`, `Down`, `Disabled`, …) for `node` items. */
	nodeStatus?: string;
	serviceManifestName?: string;
	servicePackageActivationId?: string;
	codePackageName?: string;
	codePackageInstanceId?: string;
	/** `ExeHost` / `ContainerHost`. */
	hostType?: string;
	/** Host process id of a code package or deployed replica, when the gateway reports one. */
	processId?: number;
	/** Repair task id and version (`repairTask` items). */
	repairTaskId?: string;
	repairTaskVersion?: string;
	repairTaskState?: string;
	/** Health state used by the view filter (set by {@link ClusterTreeItem.withHealth}). */
	healthState?: string;
	/** The record this node was built from, for "Show Details". */
	raw?: unknown;
}

/** A node in the `serviceFabric.clusters` view. */
export class ClusterTreeItem extends vscode.TreeItem {
	/** Set on `app` nodes: the deployed application name (without `fabric:/`). Kept for the debug commands. */
	appName: string | undefined;
	/** Entity identifiers for the context-menu commands. */
	readonly entity: ClusterEntityRef;

	constructor(
		readonly kind: ClusterNodeKind,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		readonly connection?: ClusterConnection,
		/** Pre-fetched children; cleared by {@link ClustersTreeProvider.refresh} so the node reloads. */
		public children?: ClusterTreeItem[],
		entity: ClusterEntityRef = {},
	) {
		super(label, collapsibleState);
		this.entity = entity;
		this.appName = entity.appName;
		switch (kind) {
			case 'cluster':
				this.iconPath = new vscode.ThemeIcon('server', healthColor(connection?.connected ? connection.aggregatedHealthState : undefined));
				this.contextValue = connection ? (connection.connected ? 'cluster.connected' : 'cluster.disconnected') : 'cluster';
				break;
			case 'group':
				this.iconPath = new vscode.ThemeIcon(GROUP_ICONS[entity.group ?? 'apps']);
				this.contextValue = `cluster.group.${entity.group ?? ''}`;
				break;
			case 'appType':
				this.iconPath = new vscode.ThemeIcon('symbol-class');
				this.contextValue = 'cluster.appType';
				break;
			case 'appTypeVersion':
				this.iconPath = new vscode.ThemeIcon('tag');
				this.contextValue = 'cluster.appTypeVersion';
				break;
			case 'app':
				this.iconPath = new vscode.ThemeIcon('package');
				this.contextValue = 'cluster.app';
				break;
			case 'service':
				this.iconPath = new vscode.ThemeIcon(entity.serviceKind === 'Stateful' ? 'database' : 'symbol-method');
				this.contextValue = `cluster.service.${(entity.serviceKind ?? 'unknown').toLowerCase()}${entity.isSystemService ? '.system' : ''}`;
				break;
			case 'partition':
				this.iconPath = new vscode.ThemeIcon('layers');
				this.contextValue = `cluster.partition.${(entity.serviceKind ?? 'unknown').toLowerCase()}`;
				break;
			case 'replica':
				this.iconPath = new vscode.ThemeIcon('circle-filled');
				this.contextValue = `cluster.replica.${(entity.serviceKind ?? 'unknown').toLowerCase()}`;
				break;
			case 'node':
				this.iconPath = new vscode.ThemeIcon('vm');
				this.contextValue = `cluster.node.${(entity.nodeStatus ?? 'unknown').toLowerCase()}`;
				break;
			case 'deployedApp':
				this.iconPath = new vscode.ThemeIcon('package');
				this.contextValue = 'cluster.deployedApp';
				break;
			case 'deployedServicePackage':
				this.iconPath = new vscode.ThemeIcon('archive');
				this.contextValue = 'cluster.deployedServicePackage';
				break;
			case 'codePackage':
				this.iconPath = new vscode.ThemeIcon('file-binary');
				this.contextValue = `cluster.codePackage${entity.hostType === 'ContainerHost' ? '.container' : ''}${entity.processId ? '.pid' : ''}`;
				break;
			case 'deployedReplica':
				this.iconPath = new vscode.ThemeIcon('circle-filled');
				this.contextValue = `cluster.deployedReplica.${(entity.serviceKind ?? 'unknown').toLowerCase()}`;
				break;
			case 'repairTask':
				this.iconPath = new vscode.ThemeIcon('tools');
				this.contextValue = `cluster.repairTask.${(entity.repairTaskState ?? 'unknown').toLowerCase()}`;
				break;
			case 'message':
				this.iconPath = new vscode.ThemeIcon('info');
				this.contextValue = 'cluster.message';
				break;
		}
	}

	/** Recolours the icon by health state (`Warning` yellow, `Error` red, otherwise default). */
	withHealth(healthState: string | undefined): this {
		this.entity.healthState = healthState;
		const icon = this.iconPath;
		if (icon instanceof vscode.ThemeIcon) this.iconPath = new vscode.ThemeIcon(icon.id, healthColor(healthState));
		return this;
	}
}

const GROUP_ICONS: Record<ClusterGroupKind, string> = {
	appTypes: 'symbol-class',
	apps: 'folder-library',
	nodes: 'server-environment',
	system: 'gear',
	repairTasks: 'tools',
	codePackages: 'file-binary',
	deployedReplicas: 'circle-filled',
};

/** Theme colour for a Service Fabric health state; `undefined` keeps the default icon colour. */
export function healthColor(healthState: string | undefined): vscode.ThemeColor | undefined {
	switch (healthState) {
		case 'Warning':
			return new vscode.ThemeColor('charts.yellow');
		case 'Error':
			return new vscode.ThemeColor('charts.red');
		case 'Ok':
			return new vscode.ThemeColor('charts.green');
		default:
			return undefined;
	}
}

/** Which rows the Clusters view hides. Persisted per workspace. */
export interface ClusterTreeFilter {
	/** Hide rows whose health is `Ok` (and repair jobs that succeeded). */
	hideOk: boolean;
	hideWarning: boolean;
	/** Hide rows whose health is `Error` (and repair jobs that failed). */
	hideError: boolean;
	/** Hide repair jobs in the `Completed` state. */
	hideCompletedRepairs: boolean;
	/** Order rows by health: `Error`, then `Warning`, then `Ok`, then rows without a health state. */
	sortByHealth: boolean;
}

export const EMPTY_FILTER: ClusterTreeFilter = {
	hideOk: false,
	hideWarning: false,
	hideError: false,
	hideCompletedRepairs: false,
	sortByHealth: false,
};

/** `workspaceState` key the filter is saved under. */
export const FILTER_STATE_KEY = 'serviceFabric.clusters.filter';

/** Human-readable summary of the active filter, e.g. `Hiding: healthy, completed repair jobs`; empty when nothing is hidden. */
export function describeFilter(filter: ClusterTreeFilter): string {
	const parts = [
		filter.hideOk ? 'healthy' : '',
		filter.hideWarning ? 'warning' : '',
		filter.hideError ? 'unhealthy' : '',
		filter.hideCompletedRepairs ? 'completed repair jobs' : '',
	].filter(Boolean);
	const hiding = parts.length ? `Hiding: ${parts.join(', ')}` : '';
	const sorting = filter.sortByHealth ? 'Sorted by health' : '';
	return [hiding, sorting].filter(Boolean).join(' • ');
}

/** Sort rank for {@link ClusterTreeFilter.sortByHealth}: unhealthy first, rows without health last. */
export function healthRank(item: ClusterTreeItem): number {
	switch (item.entity.healthState) {
		case 'Error':
			return 0;
		case 'Warning':
			return 1;
		case 'Ok':
			return 2;
		default:
			return 3;
	}
}

/** Stable sort by {@link healthRank}; rows of equal rank keep the gateway's order. Message rows stay at the end. */
export function sortByHealth(items: ClusterTreeItem[]): ClusterTreeItem[] {
	return items
		.map((item, index) => ({ item, index, rank: item.kind === 'message' ? Number.MAX_SAFE_INTEGER : healthRank(item) }))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((x) => x.item);
}

/** Whether `item` should stay visible under `filter`. Rows without a health state (types, code packages, messages) always stay. */
export function passesFilter(item: ClusterTreeItem, filter: ClusterTreeFilter): boolean {
	if (item.kind === 'message' || item.kind === 'cluster' || item.kind === 'group') return true;
	if (item.kind === 'repairTask' && filter.hideCompletedRepairs && item.entity.repairTaskState === 'Completed') return false;
	switch (item.entity.healthState) {
		case 'Ok':
			return !filter.hideOk;
		case 'Warning':
			return !filter.hideWarning;
		case 'Error':
			return !filter.hideError;
		default:
			return true;
	}
}

/** Request timeout for tree expansions; long enough for a slow remote gateway, short enough to not hang the view. */
const TREE_TIMEOUT_MS = 10000;

/**
 * Tree data for the `serviceFabric.clusters` view. Saved connections come from the
 * {@link ConnectionStore}; everything beneath a cluster is fetched from the gateway
 * when the node is expanded, so the view shows the same live entities as Service
 * Fabric Explorer.
 */
export class ClustersTreeProvider implements vscode.TreeDataProvider<ClusterTreeItem> {
	private readonly emitter = new vscode.EventEmitter<ClusterTreeItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<ClusterTreeItem | undefined> = this.emitter.event;

	private filter: ClusterTreeFilter;

	constructor(
		private readonly store: ConnectionStore,
		private readonly state?: vscode.Memento,
	) {
		this.filter = { ...EMPTY_FILTER, ...(state?.get<Partial<ClusterTreeFilter>>(FILTER_STATE_KEY) ?? {}) };
		store.onDidChange(() => this.emitter.fire(undefined));
	}

	getFilter(): ClusterTreeFilter {
		return { ...this.filter };
	}

	/** Replaces the filter, persists it and redraws the tree. */
	async setFilter(filter: ClusterTreeFilter): Promise<void> {
		this.filter = { ...filter };
		await this.state?.update(FILTER_STATE_KEY, this.filter);
		this.emitter.fire(undefined);
	}

	/** Pending Applications-group refreshes, one per connection. */
	private readonly busyTimers = new Map<string, ReturnType<typeof setTimeout>>();

	/** While an application is upgrading, creating or deleting, refreshes its group every few seconds so the row stays current. */
	private refreshWhileBusy(conn: ClusterConnection, group: ClusterTreeItem, items: ClusterTreeItem[]): void {
		const pending = this.busyTimers.get(conn.id);
		if (pending) clearTimeout(pending);
		this.busyTimers.delete(conn.id);
		if (!items.some(isBusyApp)) return;
		this.busyTimers.set(
			conn.id,
			setTimeout(() => {
				this.busyTimers.delete(conn.id);
				if (this.store.get(conn.id)) this.refresh(group);
			}, BUSY_APP_REFRESH_MS),
		);
	}

	/** Re-fetches `element` and its descendants, or the whole tree when omitted. */
	refresh(element?: ClusterTreeItem): void {
		if (element && element.kind !== 'cluster') element.children = undefined;
		this.emitter.fire(element);
	}

	getTreeItem(element: ClusterTreeItem): ClusterTreeItem {
		return element;
	}

	async getChildren(element?: ClusterTreeItem): Promise<ClusterTreeItem[]> {
		if (!element) {
			return this.store.list().map((conn) => {
				const item = new ClusterTreeItem('cluster', conn.label, vscode.TreeItemCollapsibleState.Collapsed, conn);
				item.description = describeCluster(conn);
				item.tooltip = clusterTooltip(conn);
				return item;
			});
		}
		if (element.children) return this.applyFilter(element.children);
		const conn = element.connection;
		if (!conn) return [];
		try {
			return this.applyFilter(await this.loadChildren(element, conn, createClientForConnection(conn)));
		} catch (err) {
			return [messageItem(`Couldn't load: ${(err as Error).message}`, 'error')];
		}
	}

	/** Drops rows hidden by the filter, sorts by health when asked, and appends a note saying how many were hidden. */
	private applyFilter(items: ClusterTreeItem[]): ClusterTreeItem[] {
		const visible = items.filter((item) => passesFilter(item, this.filter));
		const kept = this.filter.sortByHealth ? sortByHealth(visible) : visible;
		const hidden = items.length - kept.length;
		if (hidden === 0) return kept;
		const note = messageItem(`${hidden} hidden by filter`, 'filter');
		note.description = describeFilter(this.filter).replace(/^Hiding: /, '');
		note.command = { command: 'serviceFabric.cluster.filter.clear', title: 'Clear Filters' };
		note.tooltip = 'Click to clear the Clusters view filter';
		return [...kept, note];
	}

	private async loadChildren(element: ClusterTreeItem, conn: ClusterConnection, client: SfRestClient): Promise<ClusterTreeItem[]> {
		const e = element.entity;
		switch (element.kind) {
			case 'cluster':
				return this.loadClusterGroups(conn, client);
			case 'group':
				return this.loadGroup(element, conn, client);
			case 'appType':
				return appTypeItems(
					conn,
					(await client.getApplicationTypes(TREE_TIMEOUT_MS)).filter((t) => t.name === e.typeName),
				).flatMap((t) => t.children ?? []);
			case 'app':
				return (await client.getServices(e.appId ?? '', TREE_TIMEOUT_MS)).map((svc) => serviceItem(conn, svc, e, false));
			case 'service':
				return (await client.getPartitions(e.serviceId ?? '', TREE_TIMEOUT_MS)).map((p) => partitionItem(conn, p, e));
			case 'partition':
				return (await client.getReplicas(e.partitionId ?? '', TREE_TIMEOUT_MS)).map((r) => replicaItem(conn, r, e));
			case 'node':
				return (await client.getDeployedApplicationsOnNode(e.nodeName ?? '', TREE_TIMEOUT_MS)).map((a) => deployedAppItem(conn, a, e));
			case 'deployedApp':
				return (await client.getDeployedServicePackages(e.nodeName ?? '', e.appId ?? '', TREE_TIMEOUT_MS)).map((p) =>
					deployedServicePackageItem(conn, p, e),
				);
			case 'deployedServicePackage':
				return this.loadServicePackageGroups(conn, client, e);
			default:
				return [];
		}
	}

	/** Cluster children: the five top-level groups, each pre-filled so the labels can carry counts. */
	private async loadClusterGroups(conn: ClusterConnection, client: SfRestClient): Promise<ClusterTreeItem[]> {
		// Probe health first so an unreachable cluster yields one clear message instead of four.
		await client.getClusterHealth(TREE_TIMEOUT_MS);
		const [appTypes, apps, nodes, system, repairs] = await Promise.all([
			settle(client.getApplicationTypes(TREE_TIMEOUT_MS)),
			settle(client.getApplications(TREE_TIMEOUT_MS)),
			settle(client.getNodes(TREE_TIMEOUT_MS)),
			settle(client.getServices('System', TREE_TIMEOUT_MS)),
			settle(client.getRepairTasks(TREE_TIMEOUT_MS)),
		]);
		const appItems = apps.ok ? apps.value.map((a) => appItem(conn, a)) : [];
		await addUpgradeProgress(appItems, client);
		const appsGroup = groupItem(conn, 'apps', 'Applications', apps, () => appItems, 'No deployed applications');
		this.refreshWhileBusy(conn, appsGroup, appItems);
		return [
			groupItem(conn, 'appTypes', 'Application Types', appTypes, (types) => appTypeItems(conn, types), 'No application types provisioned'),
			appsGroup,
			groupItem(conn, 'nodes', 'Nodes', nodes, (items) => items.map((n) => nodeItem(conn, n)), 'No nodes reported'),
			groupItem(
				conn,
				'system',
				'System',
				system,
				(items) => items.map((s) => serviceItem(conn, s, { appId: 'System', appName: 'System' }, true)),
				'No system services reported',
			),
			groupItem(conn, 'repairTasks', 'Repair Jobs', repairs, (items) => items.map((t) => repairTaskItem(conn, t)), 'No repair jobs'),
		];
	}

	/** Group nodes refreshed on their own (after the parent-level prefill) re-fetch their own list. */
	private async loadGroup(element: ClusterTreeItem, conn: ClusterConnection, client: SfRestClient): Promise<ClusterTreeItem[]> {
		const e = element.entity;
		switch (e.group) {
			case 'codePackages':
				return orEmpty(
					(
						await client.getDeployedCodePackagesForManifest(e.nodeName ?? '', e.appId ?? '', e.serviceManifestName ?? '', TREE_TIMEOUT_MS)
					).map((cp) => codePackageItem(conn, cp, e)),
					'No code packages',
				);
			case 'deployedReplicas':
				return orEmpty(
					(await client.getDeployedReplicas(e.nodeName ?? '', e.appId ?? '', e.serviceManifestName ?? '', TREE_TIMEOUT_MS)).map((r) =>
						deployedReplicaItem(conn, r, e),
					),
					'No replicas hosted',
				);
			case 'appTypes':
				return orEmpty(appTypeItems(conn, await client.getApplicationTypes(TREE_TIMEOUT_MS)), 'No application types provisioned');
			case 'apps': {
				const items = (await client.getApplications(TREE_TIMEOUT_MS)).map((a) => appItem(conn, a));
				await addUpgradeProgress(items, client);
				this.refreshWhileBusy(conn, element, items);
				return orEmpty(items, 'No deployed applications');
			}
			case 'nodes':
				return orEmpty(
					(await client.getNodes(TREE_TIMEOUT_MS)).map((n) => nodeItem(conn, n)),
					'No nodes reported',
				);
			case 'system':
				return orEmpty(
					(await client.getServices('System', TREE_TIMEOUT_MS)).map((s) =>
						serviceItem(conn, s, { appId: 'System', appName: 'System' }, true),
					),
					'No system services reported',
				);
			case 'repairTasks':
				return orEmpty(
					(await client.getRepairTasks(TREE_TIMEOUT_MS)).map((t) => repairTaskItem(conn, t)),
					'No repair jobs',
				);
			default:
				return [];
		}
	}

	private async loadServicePackageGroups(conn: ClusterConnection, client: SfRestClient, e: ClusterEntityRef): Promise<ClusterTreeItem[]> {
		const nodeName = e.nodeName ?? '';
		const appId = e.appId ?? '';
		const manifest = e.serviceManifestName ?? '';
		const [codePackages, replicas] = await Promise.all([
			settle(client.getDeployedCodePackagesForManifest(nodeName, appId, manifest, TREE_TIMEOUT_MS)),
			settle(client.getDeployedReplicas(nodeName, appId, manifest, TREE_TIMEOUT_MS)),
		]);
		return [
			groupItem(
				conn,
				'codePackages',
				'Code Packages',
				codePackages,
				(items) => items.map((cp) => codePackageItem(conn, cp, e)),
				'No code packages',
				e,
			),
			groupItem(
				conn,
				'deployedReplicas',
				'Replicas',
				replicas,
				(items) => items.map((r) => deployedReplicaItem(conn, r, e)),
				'No replicas hosted',
				e,
			),
		];
	}
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: Error };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
	return promise.then(
		(value) => ({ ok: true as const, value }),
		(error: Error) => ({ ok: false as const, error }),
	);
}

function messageItem(text: string, icon = 'info'): ClusterTreeItem {
	const item = new ClusterTreeItem('message', text, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon(icon);
	item.tooltip = text;
	return item;
}

function orEmpty(items: ClusterTreeItem[], emptyMessage: string): ClusterTreeItem[] {
	return items.length === 0 ? [messageItem(emptyMessage)] : items;
}

/** A collapsible group node pre-filled from a settled fetch; a failed fetch shows the error as its only child. */
function groupItem<T>(
	conn: ClusterConnection,
	group: ClusterGroupKind,
	label: string,
	result: Settled<T[]>,
	build: (items: T[]) => ClusterTreeItem[],
	emptyMessage: string,
	parent: ClusterEntityRef = {},
): ClusterTreeItem {
	const children = result.ok
		? orEmpty(build(result.value), emptyMessage)
		: [messageItem(`Couldn't load: ${result.error.message}`, 'error')];
	const count = result.ok ? ` (${result.value.length})` : '';
	return new ClusterTreeItem('group', `${label}${count}`, vscode.TreeItemCollapsibleState.Collapsed, conn, children, { ...parent, group });
}

/** One node per application type, holding one child per provisioned version. */
function appTypeItems(conn: ClusterConnection, types: ApplicationTypeInfo[]): ClusterTreeItem[] {
	const byName = new Map<string, ApplicationTypeInfo[]>();
	for (const t of types) byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
	return Array.from(byName.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, versions]) => {
			const versionItems = versions.map((v) => {
				const item = new ClusterTreeItem('appTypeVersion', v.version, vscode.TreeItemCollapsibleState.None, conn, undefined, {
					typeName: v.name,
					typeVersion: v.version,
					raw: v,
				});
				item.description = v.status;
				item.tooltip = [
					`${v.name} ${v.version}`,
					`Status: ${v.status}${v.statusDetails ? ` (${v.statusDetails})` : ''}`,
					v.definitionKind ? `Kind: ${v.definitionKind}` : '',
					v.defaultParameters.length ? `Parameters: ${v.defaultParameters.map((p) => `${p.key}=${p.value}`).join(', ')}` : '',
				]
					.filter(Boolean)
					.join('\n');
				return item;
			});
			const item = new ClusterTreeItem('appType', name, vscode.TreeItemCollapsibleState.Collapsed, conn, versionItems, {
				typeName: name,
				typeVersion: versions.length === 1 ? versions[0].version : undefined,
				raw: versions,
			});
			item.description = versions.length === 1 ? versions[0].version : `${versions.length} versions`;
			return item;
		});
}

/** Spinning icons for applications the cluster is working on. */
const BUSY_APP_ICONS: Record<string, string> = { Upgrading: 'sync~spin', Creating: 'loading~spin', Deleting: 'loading~spin' };

/** How often the Applications group refreshes while an application is upgrading, creating or deleting. */
const BUSY_APP_REFRESH_MS = 10000;

const UPGRADE_STATES: Record<string, string> = {
	RollingForwardInProgress: 'Upgrading',
	RollingForwardPending: 'Waiting to start the next upgrade domain',
	RollingBackInProgress: 'Rolling back',
	RollingBackCompleted: 'Rolled back',
	RollingForwardCompleted: 'Upgrade completed',
	Failed: 'Upgrade failed',
};

function isBusyApp(item: ClusterTreeItem): boolean {
	const status = (item.entity.raw as ApplicationInfo | undefined)?.status;
	return item.kind === 'app' && status !== undefined && status in BUSY_APP_ICONS;
}

/** Adds the target version, upgrade state and current upgrade domain to upgrading application rows. */
async function addUpgradeProgress(items: ClusterTreeItem[], client: SfRestClient): Promise<void> {
	await Promise.all(
		items.map(async (item) => {
			const app = item.entity.raw as ApplicationInfo | undefined;
			if (item.kind !== 'app' || app?.status !== 'Upgrading') return;
			const progress = await client.getApplicationUpgradeProgress(app.id, TREE_TIMEOUT_MS).catch(() => undefined);
			if (!progress) return;
			const target = String(progress.TargetApplicationTypeVersion ?? '');
			const rawState = String(progress.UpgradeState ?? '');
			const state = UPGRADE_STATES[rawState] ?? (rawState || 'Upgrading');
			const domain = progress.CurrentUpgradeDomainProgress?.DomainName as string | undefined;
			const mode = progress.RollingUpgradeMode as string | undefined;
			const version = target && target !== app.typeVersion ? `${app.typeVersion} → ${target}` : app.typeVersion;
			item.description = [`${app.typeName} ${version}`, state, domain ? `UD ${domain}` : ''].filter(Boolean).join(' • ');
			item.tooltip = [
				item.tooltip,
				`Upgrade: ${state}${mode ? ` (${mode})` : ''}`,
				target ? `Target version: ${target}` : '',
				domain ? `Current upgrade domain: ${domain}` : '',
			]
				.filter(Boolean)
				.join('\n');
			if (rawState === 'RollingBackInProgress') item.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.orange'));
		}),
	);
}

function appItem(conn: ClusterConnection, app: ApplicationInfo): ClusterTreeItem {
	const item = new ClusterTreeItem('app', app.name, vscode.TreeItemCollapsibleState.Collapsed, conn, undefined, {
		appName: app.name,
		appId: app.id,
		typeName: app.typeName,
		typeVersion: app.typeVersion,
		raw: app,
	}).withHealth(app.healthState);
	const busyIcon = BUSY_APP_ICONS[app.status];
	if (busyIcon) item.iconPath = new vscode.ThemeIcon(busyIcon, healthColor(app.healthState));
	item.description = `${app.typeName} ${app.typeVersion} • ${app.status}`;
	item.tooltip = [
		`fabric:/${app.name}`,
		`Type: ${app.typeName} ${app.typeVersion}`,
		`Status: ${app.status}`,
		`Health: ${app.healthState || 'Unknown'}`,
		app.parameters.length ? `Parameters: ${app.parameters.map((p) => `${p.key}=${p.value}`).join(', ')}` : '',
	]
		.filter(Boolean)
		.join('\n');
	return item;
}

function serviceItem(conn: ClusterConnection, svc: ServiceInfo, parent: ClusterEntityRef, isSystem: boolean): ClusterTreeItem {
	const shortName = svc.name.replace(/^fabric:\//, '').replace(new RegExp(`^${escapeRegExp(parent.appName ?? '')}/`), '');
	const item = new ClusterTreeItem('service', shortName, vscode.TreeItemCollapsibleState.Collapsed, conn, undefined, {
		...parent,
		serviceId: svc.id,
		serviceName: svc.name,
		serviceKind: svc.kind,
		isSystemService: isSystem,
		raw: svc,
	}).withHealth(svc.healthState);
	item.description = `${svc.kind} • ${svc.status}${svc.healthState ? ` • ${svc.healthState}` : ''}`;
	item.tooltip = [
		svc.name,
		`Type: ${svc.typeName}${svc.manifestVersion ? ` ${svc.manifestVersion}` : ''}`,
		`Kind: ${svc.kind}${svc.kind === 'Stateful' ? (svc.hasPersistedState ? ' (persisted)' : ' (volatile)') : ''}`,
		`Status: ${svc.status}`,
		`Health: ${svc.healthState || 'Unknown'}`,
	].join('\n');
	return item;
}

function partitionItem(conn: ClusterConnection, p: PartitionInfo, parent: ClusterEntityRef): ClusterTreeItem {
	const item = new ClusterTreeItem('partition', p.id, vscode.TreeItemCollapsibleState.Collapsed, conn, undefined, {
		...parent,
		serviceKind: p.serviceKind || parent.serviceKind,
		partitionId: p.id,
		raw: p,
	}).withHealth(p.healthState);
	const size =
		p.serviceKind === 'Stateful'
			? `${p.targetReplicaSetSize ?? '?'} target / ${p.minReplicaSetSize ?? '?'} min`
			: p.instanceCount !== undefined
				? `${p.instanceCount === -1 ? 'all nodes' : `${p.instanceCount} instance${p.instanceCount === 1 ? '' : 's'}`}`
				: '';
	item.description = [p.schemeKind, p.keyDescription, p.status, p.healthState].filter(Boolean).join(' • ');
	item.tooltip = [
		`Partition ${p.id}`,
		`Scheme: ${p.schemeKind}${p.keyDescription ? ` ${p.keyDescription}` : ''}`,
		`Status: ${p.status}`,
		`Health: ${p.healthState || 'Unknown'}`,
		size ? `Replica set: ${size}` : '',
	]
		.filter(Boolean)
		.join('\n');
	return item;
}

function replicaItem(conn: ClusterConnection, r: ReplicaInfo, parent: ClusterEntityRef): ClusterTreeItem {
	const kind = r.serviceKind || parent.serviceKind;
	const item = new ClusterTreeItem('replica', r.id, vscode.TreeItemCollapsibleState.None, conn, undefined, {
		...parent,
		serviceKind: kind,
		replicaId: r.id,
		nodeName: r.nodeName,
		raw: r,
	}).withHealth(r.healthState);
	item.description = [kind === 'Stateful' ? r.role : 'Instance', r.status, r.nodeName, r.healthState].filter(Boolean).join(' • ');
	item.tooltip = [
		`${kind === 'Stateful' ? 'Replica' : 'Instance'} ${r.id}`,
		kind === 'Stateful' ? `Role: ${r.role}` : '',
		`Status: ${r.status}`,
		`Health: ${r.healthState || 'Unknown'}`,
		`Node: ${r.nodeName}`,
		r.address ? `Address: ${r.address}` : '',
	]
		.filter(Boolean)
		.join('\n');
	return item;
}

function nodeItem(conn: ClusterConnection, n: ClusterNodeInfo): ClusterTreeItem {
	const item = new ClusterTreeItem('node', n.name, vscode.TreeItemCollapsibleState.Collapsed, conn, undefined, {
		nodeName: n.name,
		nodeStatus: n.status,
		raw: n,
	}).withHealth(n.healthState);
	item.description = `${n.status} • ${n.healthState}`;
	item.tooltip = `Type: ${n.nodeType}\nStatus: ${n.status}\nHealth: ${n.healthState}`;
	return item;
}

function deployedAppItem(conn: ClusterConnection, a: DeployedApplicationOnNodeInfo, parent: ClusterEntityRef): ClusterTreeItem {
	const item = new ClusterTreeItem('deployedApp', a.name, vscode.TreeItemCollapsibleState.Collapsed, conn, undefined, {
		...parent,
		appName: a.name,
		appId: a.id,
		typeName: a.typeName,
		raw: a,
	}).withHealth(a.healthState);
	item.description = `${a.typeName} • ${a.status}`;
	item.tooltip = [
		`fabric:/${a.name} on ${parent.nodeName}`,
		`Type: ${a.typeName}`,
		`Status: ${a.status}`,
		`Health: ${a.healthState || 'Unknown'}`,
		a.workDirectory ? `Work: ${a.workDirectory}` : '',
		a.logDirectory ? `Log: ${a.logDirectory}` : '',
	]
		.filter(Boolean)
		.join('\n');
	return item;
}

function deployedServicePackageItem(conn: ClusterConnection, p: DeployedServicePackageInfo, parent: ClusterEntityRef): ClusterTreeItem {
	const item = new ClusterTreeItem('deployedServicePackage', p.name, vscode.TreeItemCollapsibleState.Collapsed, conn, undefined, {
		...parent,
		serviceManifestName: p.name,
		servicePackageActivationId: p.servicePackageActivationId,
		raw: p,
	}).withHealth(p.healthState);
	item.description = `${p.version} • ${p.status}${p.healthState ? ` • ${p.healthState}` : ''}`;
	item.tooltip = [
		`Service package ${p.name} ${p.version}`,
		`Status: ${p.status}`,
		`Health: ${p.healthState || 'Unknown'}`,
		p.servicePackageActivationId ? `Activation: ${p.servicePackageActivationId}` : 'Activation: SharedProcess',
	].join('\n');
	return item;
}

function codePackageItem(conn: ClusterConnection, cp: DeployedCodePackageDetail, parent: ClusterEntityRef): ClusterTreeItem {
	const item = new ClusterTreeItem('codePackage', cp.codePackageName, vscode.TreeItemCollapsibleState.None, conn, undefined, {
		...parent,
		codePackageName: cp.codePackageName,
		codePackageInstanceId: cp.codePackageInstanceId,
		servicePackageActivationId: cp.servicePackageActivationId || parent.servicePackageActivationId,
		hostType: cp.hostType,
		processId: cp.processId,
		raw: cp.raw,
	});
	item.description = [cp.codePackageVersion, cp.entryPointStatus || cp.status, cp.processId ? `pid ${cp.processId}` : '', cp.hostType]
		.filter(Boolean)
		.join(' • ');
	item.tooltip = [
		`Code package ${cp.codePackageName} ${cp.codePackageVersion}`,
		`Status: ${cp.status}`,
		`Entry point: ${cp.entryPointStatus || 'Unknown'}${cp.processId ? ` (pid ${cp.processId})` : ''}`,
		cp.setupEntryPointStatus ? `Setup entry point: ${cp.setupEntryPointStatus}` : '',
		`Host: ${cp.hostType || 'Unknown'}`,
	]
		.filter(Boolean)
		.join('\n');
	return item;
}

function deployedReplicaItem(conn: ClusterConnection, r: DeployedReplicaInfo, parent: ClusterEntityRef): ClusterTreeItem {
	const shortService = r.serviceName.replace(/^fabric:\//, '');
	const item = new ClusterTreeItem('deployedReplica', r.id, vscode.TreeItemCollapsibleState.None, conn, undefined, {
		...parent,
		serviceName: r.serviceName,
		serviceId: encodeURIComponent(shortService.replace(/\//g, '~')),
		serviceKind: r.serviceKind,
		partitionId: r.partitionId,
		replicaId: r.id,
		codePackageName: r.codePackageName,
		servicePackageActivationId: r.servicePackageActivationId || parent.servicePackageActivationId,
		processId: Number(r.hostProcessId) > 0 ? Number(r.hostProcessId) : undefined,
		raw: r,
	});
	item.description = [shortService, r.serviceKind === 'Stateful' ? r.role : 'Instance', r.status].filter(Boolean).join(' • ');
	item.tooltip = [
		`${r.serviceKind === 'Stateful' ? 'Replica' : 'Instance'} ${r.id}`,
		`Service: ${r.serviceName} (${r.serviceTypeName})`,
		`Partition: ${r.partitionId}`,
		r.serviceKind === 'Stateful' ? `Role: ${r.role}` : '',
		`Status: ${r.status}`,
		r.codePackageName ? `Code package: ${r.codePackageName}` : '',
		r.hostProcessId && r.hostProcessId !== '0' ? `Host pid: ${r.hostProcessId}` : '',
		r.address ? `Address: ${r.address}` : '',
	]
		.filter(Boolean)
		.join('\n');
	return item;
}

function repairTaskItem(conn: ClusterConnection, t: RepairTaskInfo): ClusterTreeItem {
	const item = new ClusterTreeItem('repairTask', t.taskId, vscode.TreeItemCollapsibleState.None, conn, undefined, {
		repairTaskId: t.taskId,
		repairTaskVersion: t.version,
		repairTaskState: t.state,
		nodeName: t.targetNodes.length === 1 ? t.targetNodes[0] : undefined,
		raw: t.raw,
	}).withHealth(repairTaskHealth(t));
	const flags = [t.flags & 1 ? 'cancel requested' : '', t.flags & 2 ? 'abort requested' : '', t.flags & 4 ? 'force approved' : ''].filter(
		Boolean,
	);
	item.description = [
		t.state,
		t.action,
		t.targetNodes.join(', '),
		t.resultStatus && t.resultStatus !== 'Pending' ? t.resultStatus : '',
		...flags,
	]
		.filter(Boolean)
		.join(' • ');
	item.tooltip = [
		`Repair task ${t.taskId}`,
		`State: ${t.state}${flags.length ? ` (${flags.join(', ')})` : ''}`,
		`Action: ${t.action}`,
		t.targetNodes.length ? `Target: ${t.targetNodes.join(', ')}` : '',
		t.executor ? `Executor: ${t.executor}` : '',
		t.resultStatus ? `Result: ${t.resultStatus}${t.resultDetails ? ` - ${t.resultDetails}` : ''}` : '',
		t.description ? `Description: ${t.description}` : '',
		t.createdUtc ? `Created: ${t.createdUtc}` : '',
		t.completedUtc ? `Completed: ${t.completedUtc}` : '',
	]
		.filter(Boolean)
		.join('\n');
	return item;
}

/** Maps a repair task to a health-like colour: failures red, in-flight work yellow, finished green. */
function repairTaskHealth(t: RepairTaskInfo): string | undefined {
	if (t.resultStatus === 'Failed' || t.resultStatus === 'Interrupted') return 'Error';
	if (t.state === 'Completed') return t.resultStatus === 'Succeeded' ? 'Ok' : undefined;
	return 'Warning';
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describeCluster(conn: ClusterConnection): string {
	if (!conn.connected) return `${conn.endpoint} (disconnected)`;
	const nodeCount = conn.nodes?.length ?? 0;
	const appCount = conn.deployedApplications?.length ?? 0;
	const topology = nodeCount === 1 ? '1-node' : nodeCount === 5 ? '5-node' : `${nodeCount}-node`;
	return `${conn.endpoint} • ${topology} • ${conn.aggregatedHealthState ?? 'Unknown'} • ${appCount} app${appCount === 1 ? '' : 's'}`;
}

function clusterTooltip(conn: ClusterConnection): string {
	const lines = [`${conn.kind} cluster — ${conn.endpoint}`];
	if (conn.auth) lines.push(`Sign-in: Microsoft Entra ID (tenant ${conn.auth.tenantId})`);
	if (conn.serverCert?.thumbprints.length) lines.push(`Server certificate: ${conn.serverCert.thumbprints.join(', ')}`);
	if (conn.clientCert) lines.push(`Client certificate: ${conn.clientCert.thumbprint} (${conn.clientCert.path})`);
	if (conn.connected) {
		lines.push(`Health: ${conn.aggregatedHealthState ?? 'Unknown'}`);
		lines.push(`Nodes: ${conn.nodes?.length ?? 0}`);
		lines.push(`Applications: ${conn.deployedApplications?.length ?? 0}`);
	} else {
		lines.push('Disconnected');
	}
	return lines.join('\n');
}
