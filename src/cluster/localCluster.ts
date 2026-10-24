import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from './connectionStore';
import { SfRestClient } from './sfRestClient';

/** Minimal logger surface used here (structurally matches util/logger's Logger). */
interface LocalClusterLogger {
	info(message: string): void;
	warn(message: string): void;
}

const LOCAL_CLUSTER_ID = 'local';

/**
 * Manages the connection entry for the local dev cluster: registers it in the
 * {@link ConnectionStore} and refreshes its health, nodes and applications.
 */
export class LocalClusterManager {
	constructor(
		private readonly store: ConnectionStore,
		private readonly logger: LocalClusterLogger,
	) {}

	async connect(): Promise<ClusterConnection> {
		const endpoint = vscode.workspace.getConfiguration('serviceFabric').get<string>('localCluster.endpoint') ?? 'http://localhost:19080';
		const conn: ClusterConnection = {
			id: LOCAL_CLUSTER_ID,
			label: 'Local Cluster',
			endpoint,
			kind: 'local',
			connected: false,
		};
		await this.store.upsert(conn);
		await this.store.setActive(conn.id);
		const refreshed = await this.refresh(conn);
		if (refreshed?.connected) {
			vscode.window.showInformationMessage(`Connected to local Service Fabric cluster at ${endpoint}.`);
		} else {
			vscode.window.showWarningMessage(`Could not reach local cluster at ${endpoint}. Make sure the dev cluster is running.`);
		}
		return refreshed;
	}

	/** Probes the cluster, stores the updated connection and returns it. Never throws for probe failures. */
	async refresh(conn: ClusterConnection): Promise<ClusterConnection> {
		const client = new SfRestClient(conn.endpoint);
		try {
			const health = await client.getClusterHealth(5000);
			const apps = await client.getDeployedApplications(5000).catch(() => []);
			const nodes = await client.getNodes(5000).catch(() => []);
			const updated: ClusterConnection = {
				...conn,
				connected: true,
				aggregatedHealthState: health.aggregatedHealthState,
				deployedApplications: apps,
				nodes,
			};
			this.logger.info(`Cluster ${conn.endpoint} health=${health.aggregatedHealthState} nodes=${nodes.length} apps=${apps.length}`);
			await this.store.upsert(updated);
			return updated;
		} catch (err) {
			this.logger.warn(`Cluster probe failed: ${(err as Error).message}`);
			const disconnected: ClusterConnection = {
				...conn,
				connected: false,
				deployedApplications: [],
				nodes: [],
				aggregatedHealthState: undefined,
			};
			await this.store.upsert(disconnected);
			return disconnected;
		}
	}
}
