import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';

export type ClusterNodeKind = 'cluster' | 'group' | 'app' | 'node' | 'message';

/** A node in the `serviceFabric.clusters` view. */
export class ClusterTreeItem extends vscode.TreeItem {
	/** Set on `app` nodes: the deployed application name (without `fabric:/`). */
	appName: string | undefined;

	constructor(
		readonly kind: ClusterNodeKind,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		readonly connection?: ClusterConnection,
		readonly children?: ClusterTreeItem[],
	) {
		super(label, collapsibleState);
		switch (kind) {
			case 'cluster':
				this.iconPath = new vscode.ThemeIcon('server');
				this.contextValue = connection ? (connection.connected ? 'cluster.connected' : 'cluster.disconnected') : 'cluster';
				break;
			case 'group':
				this.iconPath = new vscode.ThemeIcon('folder');
				this.contextValue = 'cluster.group';
				break;
			case 'app':
				this.iconPath = new vscode.ThemeIcon('package');
				this.contextValue = 'cluster.app';
				break;
			case 'node':
				this.iconPath = new vscode.ThemeIcon('vm');
				this.contextValue = 'cluster.node';
				break;
			case 'message':
				this.iconPath = new vscode.ThemeIcon('info');
				break;
		}
	}
}

/** Tree data for the `serviceFabric.clusters` view: saved connections → Nodes / Applications. */
export class ClustersTreeProvider implements vscode.TreeDataProvider<ClusterTreeItem> {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData: vscode.Event<void> = this.emitter.event;

	constructor(private readonly store: ConnectionStore) {
		store.onDidChange(() => this.emitter.fire());
	}

	refresh(): void {
		this.emitter.fire();
	}

	getTreeItem(element: ClusterTreeItem): ClusterTreeItem {
		return element;
	}

	async getChildren(element?: ClusterTreeItem): Promise<ClusterTreeItem[]> {
		if (!element) {
			const connections = this.store.list();
			return connections.length === 0
				? []
				: connections.map((conn) => {
						const item = new ClusterTreeItem('cluster', conn.label, vscode.TreeItemCollapsibleState.Collapsed, conn);
						item.description = describeCluster(conn);
						item.tooltip = clusterTooltip(conn);
						return item;
					});
		}
		if (element.kind === 'cluster' && element.connection) {
			const conn = element.connection;
			const groups: ClusterTreeItem[] = [];
			const nodeItems = (conn.nodes ?? []).map((n) => {
				const item = new ClusterTreeItem('node', n.name, vscode.TreeItemCollapsibleState.None, conn);
				item.description = `${n.status} • ${n.healthState}`;
				item.tooltip = `Type: ${n.nodeType}
Status: ${n.status}
Health: ${n.healthState}`;
				return item;
			});
			groups.push(makeClusterGroupNode(`Nodes (${nodeItems.length})`, conn, nodeItems, 'No nodes reported'));
			const appItems = (conn.deployedApplications ?? []).map((app) => {
				const item = new ClusterTreeItem('app', app.name, vscode.TreeItemCollapsibleState.None, conn);
				item.description = `${app.typeName} v${app.typeVersion} • ${app.status}`;
				item.appName = app.name;
				return item;
			});
			groups.push(makeClusterGroupNode(`Applications (${appItems.length})`, conn, appItems, 'No deployed applications'));
			return groups;
		}
		return element.children ?? [];
	}
}

/** A collapsible group node; shows `emptyMessage` as a single info child when `items` is empty. */
function makeClusterGroupNode(
	label: string,
	connection: ClusterConnection,
	items: ClusterTreeItem[],
	emptyMessage: string,
): ClusterTreeItem {
	const children = items.length === 0 ? [new ClusterTreeItem('message', emptyMessage, vscode.TreeItemCollapsibleState.None)] : items;
	return new ClusterTreeItem('group', label, vscode.TreeItemCollapsibleState.Collapsed, connection, children);
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
	if (conn.connected) {
		lines.push(`Health: ${conn.aggregatedHealthState ?? 'Unknown'}`);
		lines.push(`Nodes: ${conn.nodes?.length ?? 0}`);
		lines.push(`Applications: ${conn.deployedApplications?.length ?? 0}`);
	} else {
		lines.push('Disconnected');
	}
	return lines.join(`
`);
}
