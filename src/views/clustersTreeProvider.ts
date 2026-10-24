// @ts-nocheck
import * as vscode from 'vscode';

var ClusterTreeItem = class extends vscode.TreeItem {
		constructor(r, n, i, o, s) {
			super(n, i);
			this.kind = r;
			this.connection = o;
			this.children = s;
			switch (r) {
				case 'cluster':
					((this.iconPath = new vscode.ThemeIcon('server')),
						(this.contextValue = o ? (o.connected ? 'cluster.connected' : 'cluster.disconnected') : 'cluster'));
					break;
				case 'group':
					((this.iconPath = new vscode.ThemeIcon('folder')), (this.contextValue = 'cluster.group'));
					break;
				case 'app':
					((this.iconPath = new vscode.ThemeIcon('package')), (this.contextValue = 'cluster.app'));
					break;
				case 'node':
					((this.iconPath = new vscode.ThemeIcon('vm')), (this.contextValue = 'cluster.node'));
					break;
				case 'message':
					this.iconPath = new vscode.ThemeIcon('info');
					break;
			}
		}
		appName;
	},
	ClustersTreeProvider = class {
		constructor(t) {
			this.store = t;
			t.onDidChange(() => this.emitter.fire());
		}
		emitter = new vscode.EventEmitter();
		onDidChangeTreeData = this.emitter.event;
		refresh() {
			this.emitter.fire();
		}
		getTreeItem(t) {
			return t;
		}
		async getChildren(t) {
			if (!t) {
				let r = this.store.list();
				return r.length === 0
					? []
					: r.map((n) => {
							let i = new ClusterTreeItem('cluster', n.label, vscode.TreeItemCollapsibleState.Collapsed, n);
							return ((i.description = describeCluster(n)), (i.tooltip = clusterTooltip(n)), i);
						});
			}
			if (t.kind === 'cluster' && t.connection) {
				let r = t.connection,
					n = [],
					i = (r.nodes ?? []).map((a) => {
						let c = new ClusterTreeItem('node', a.name, vscode.TreeItemCollapsibleState.None, r);
						return (
							(c.description = `${a.status} \u2022 ${a.healthState}`),
							(c.tooltip = `Type: ${a.nodeType}
Status: ${a.status}
Health: ${a.healthState}`),
							c
						);
					});
				n.push(makeClusterGroupNode(`Nodes (${i.length})`, r, i, 'No nodes reported'));
				let s = (r.deployedApplications ?? []).map((a) => {
					let c = new ClusterTreeItem('app', a.name, vscode.TreeItemCollapsibleState.None, r);
					return ((c.description = `${a.typeName} v${a.typeVersion} \u2022 ${a.status}`), (c.appName = a.name), c);
				});
				return (n.push(makeClusterGroupNode(`Applications (${s.length})`, r, s, 'No deployed applications')), n);
			}
			return t.children ?? [];
		}
	};

function makeClusterGroupNode(e, t, r, n) {
	let i = r.length === 0 ? [new ClusterTreeItem('message', n, vscode.TreeItemCollapsibleState.None)] : r;
	return new ClusterTreeItem('group', e, vscode.TreeItemCollapsibleState.Collapsed, t, i);
}

function describeCluster(e) {
	if (!e.connected) return `${e.endpoint} (disconnected)`;
	let t = e.nodes?.length ?? 0,
		r = e.deployedApplications?.length ?? 0,
		n = t === 1 ? '1-node' : t === 5 ? '5-node' : `${t}-node`;
	return `${e.endpoint} \u2022 ${n} \u2022 ${e.aggregatedHealthState ?? 'Unknown'} \u2022 ${r} app${r === 1 ? '' : 's'}`;
}

function clusterTooltip(e) {
	let t = [`${e.kind} cluster \u2014 ${e.endpoint}`];
	return (
		e.connected
			? (t.push(`Health: ${e.aggregatedHealthState ?? 'Unknown'}`),
				t.push(`Nodes: ${e.nodes?.length ?? 0}`),
				t.push(`Applications: ${e.deployedApplications?.length ?? 0}`))
			: t.push('Disconnected'),
		t.join(`
`)
	);
}

export { ClustersTreeProvider };
