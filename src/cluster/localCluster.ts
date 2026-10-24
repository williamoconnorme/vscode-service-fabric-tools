import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from './connectionStore';
import { createClientForConnection } from './clusterAuth';

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

	/**
	 * Probes the cluster, stores the updated connection and returns it. Never throws for probe failures.
	 * `interactive` lets an Entra ID cluster prompt for sign-in; background refreshes leave it off.
	 * A cluster the user disconnected is only probed (and reconnected) by an interactive refresh.
	 * `background` (timers) only saves, and so only redraws the Clusters view, when something changed.
	 */
	async refresh(conn: ClusterConnection, opts: { interactive?: boolean; background?: boolean } = {}): Promise<ClusterConnection> {
		const save = { ifChanged: opts.background };
		if (conn.userDisconnected && !opts.interactive) return conn;
		const client = createClientForConnection(conn, opts);
		try {
			const health = await client.getClusterHealth(5000);
			const apps = await client.getDeployedApplications(5000).catch(() => []);
			const nodes = await client.getNodes(5000).catch(() => []);
			const updated: ClusterConnection = {
				...conn,
				connected: true,
				userDisconnected: undefined,
				aggregatedHealthState: health.aggregatedHealthState,
				deployedApplications: apps,
				nodes,
			};
			if (!opts.background || !conn.connected || conn.aggregatedHealthState !== health.aggregatedHealthState) {
				this.logger.info(`Cluster ${conn.endpoint} health=${health.aggregatedHealthState} nodes=${nodes.length} apps=${apps.length}`);
			}
			await this.store.upsert(updated, save);
			return updated;
		} catch (err) {
			// Timers would repeat the same failure every tick; log it once, when the cluster becomes unreachable.
			if (!opts.background || conn.connected) this.logger.warn(`Cluster probe failed: ${(err as Error).message}`);
			const disconnected: ClusterConnection = {
				...conn,
				connected: false,
				userDisconnected: undefined,
				deployedApplications: [],
				nodes: [],
				aggregatedHealthState: undefined,
			};
			await this.store.upsert(disconnected, save);
			return disconnected;
		}
	}
}
