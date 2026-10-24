// @ts-nocheck
import * as vscode from 'vscode';
import { SfRestClient } from './sfRestClient';

var LOCAL_CLUSTER_ID = 'local',
	LocalClusterManager = class {
		constructor(t, r) {
			this.store = t;
			this.logger = r;
		}
		async connect() {
			let t = vscode.workspace.getConfiguration('serviceFabric').get('localCluster.endpoint') ?? 'http://localhost:19080',
				r = {
					id: LOCAL_CLUSTER_ID,
					label: 'Local Cluster',
					endpoint: t,
					kind: 'local',
					connected: !1,
				};
			(await this.store.upsert(r), await this.store.setActive(r.id));
			let n = await this.refresh(r);
			return (
				n?.connected
					? vscode.window.showInformationMessage(`Connected to local Service Fabric cluster at ${t}.`)
					: vscode.window.showWarningMessage(`Could not reach local cluster at ${t}. Make sure the dev cluster is running.`),
				n
			);
		}
		async refresh(t) {
			let r = new SfRestClient(t.endpoint);
			try {
				let n = await r.getClusterHealth(5e3),
					i = await r.getDeployedApplications(5e3).catch(() => []),
					o = await r.getNodes(5e3).catch(() => []),
					s = {
						...t,
						connected: !0,
						aggregatedHealthState: n.aggregatedHealthState,
						deployedApplications: i,
						nodes: o,
					};
				return (
					this.logger.info(`Cluster ${t.endpoint} health=${n.aggregatedHealthState} nodes=${o.length} apps=${i.length}`),
					await this.store.upsert(s),
					s
				);
			} catch (n) {
				this.logger.warn(`Cluster probe failed: ${n.message}`);
				let i = {
					...t,
					connected: !1,
					deployedApplications: [],
					nodes: [],
					aggregatedHealthState: void 0,
				};
				return (await this.store.upsert(i), i);
			}
		}
	};

export { LocalClusterManager };
