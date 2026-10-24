import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from './cluster/connectionStore';
import { pickFabricNameAction } from './views/fabricTerminalLinks';

/**
 * Handles `vscode://williamoconnor.service-fabric-tools/<path>?<query>` links, for runbooks,
 * wikis and alerts:
 *
 * - `/openCluster?endpoint=<gateway>`: makes that saved cluster active and shows the Clusters view.
 * - `/openApplication?app=fabric:/App[/Service]&endpoint=<gateway>`: offers Open in Service Fabric
 *   Explorer / Show Deployment History for it, on that cluster (or the active one).
 * - `/addCluster?endpoint=<gateway>`: starts Connect to Remote Cluster with the endpoint pre-filled.
 *
 * A cluster the link names but that isn't saved is never contacted; the user is offered to add
 * it, which goes through the normal connect prompts.
 */
export class ServiceFabricUriHandler implements vscode.UriHandler {
	constructor(
		private readonly store: ConnectionStore,
		private readonly addCluster: (endpoint: string) => Promise<void>,
	) {}

	async handleUri(uri: vscode.Uri): Promise<void> {
		const query = new URLSearchParams(uri.query);
		const endpoint = query.get('endpoint')?.trim() || undefined;
		switch (uri.path.replace(/\/+$/, '')) {
			case '/addCluster':
				if (endpoint) await this.addCluster(endpoint);
				else vscode.window.showWarningMessage('The Service Fabric link has no endpoint to add.');
				return;
			case '/openCluster': {
				const conn = await this.savedCluster(endpoint);
				if (!conn) return;
				await this.store.setActive(conn.id);
				await vscode.commands.executeCommand('serviceFabric.clusters.focus');
				return;
			}
			case '/openApplication': {
				const app = query.get('app')?.trim();
				if (!app) {
					vscode.window.showWarningMessage('The Service Fabric link has no application name.');
					return;
				}
				const conn = endpoint ? await this.savedCluster(endpoint) : this.store.getActive();
				if (endpoint && !conn) return;
				await pickFabricNameAction(conn, app.startsWith('fabric:/') ? app : `fabric:/${app}`);
				return;
			}
			default:
				vscode.window.showWarningMessage(`Unknown Service Fabric link: ${uri.path}`);
		}
	}

	/** The saved cluster with `endpoint` (the active one when omitted); offers to add an unknown one. */
	private async savedCluster(endpoint: string | undefined): Promise<ClusterConnection | undefined> {
		if (!endpoint) return this.store.getActive();
		const normalized = endpoint.replace(/\/+$/, '').toLowerCase();
		const conn = this.store.list().find((c) => c.endpoint.replace(/\/+$/, '').toLowerCase() === normalized);
		if (conn) return conn;
		const choice = await vscode.window.showInformationMessage(`The link refers to ${endpoint}, which isn't a saved cluster.`, 'Add Cluster…');
		if (choice) await this.addCluster(endpoint);
		return undefined;
	}
}
