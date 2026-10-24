import * as vscode from 'vscode';

import type { ClusterNodeInfo, DeployedApplicationInfo } from './sfRestClient';
import type { EntraClusterAuth } from './clusterAuth';
import type { ServerCertPin } from './tlsPinning';
import type { ClientCertRef } from './clientCert';

export type { ClusterNodeInfo, DeployedApplicationInfo };

export type ClusterKind = 'local' | 'remote';

/** A saved cluster connection plus the last probe results. */
export interface ClusterConnection {
	id: string;
	label: string;
	endpoint: string;
	kind: ClusterKind;
	connected: boolean;
	/** Set by Disconnect: background refreshes leave the cluster alone until an interactive refresh (Reconnect). */
	userDisconnected?: boolean;
	aggregatedHealthState?: string;
	deployedApplications?: DeployedApplicationInfo[];
	nodes?: ClusterNodeInfo[];
	/** Set for clusters secured with Microsoft Entra ID. */
	auth?: EntraClusterAuth;
	/** Pinned gateway certificate for https clusters. */
	serverCert?: ServerCertPin;
	/** X.509 client certificate file (path and thumbprint only; the passphrase is in SecretStorage). */
	clientCert?: ClientCertRef;
}

const STORE_KEY = 'serviceFabric.connections';
const ACTIVE_KEY = 'serviceFabric.activeClusterId';

export class ConnectionStore implements vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.emitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	list(): ClusterConnection[] {
		return this.context.workspaceState.get<ClusterConnection[]>(STORE_KEY, []);
	}

	get(id: string): ClusterConnection | undefined {
		return this.list().find((c) => c.id === id);
	}

	getActive(): ClusterConnection | undefined {
		const id = this.context.workspaceState.get<string>(ACTIVE_KEY);
		return id ? this.get(id) : this.list()[0];
	}

	async setActive(id: string): Promise<void> {
		await this.context.workspaceState.update(ACTIVE_KEY, id);
		this.emitter.fire();
	}

	/** Saves `conn`. With `ifChanged`, an identical saved connection is left alone and no change event fires. */
	async upsert(conn: ClusterConnection, opts: { ifChanged?: boolean } = {}): Promise<void> {
		const all = this.list();
		const idx = all.findIndex((c) => c.id === conn.id);
		if (opts.ifChanged && idx >= 0 && JSON.stringify(all[idx]) === JSON.stringify(conn)) return;
		if (idx >= 0) all[idx] = conn;
		else all.push(conn);
		await this.context.workspaceState.update(STORE_KEY, all);
		if (!this.context.workspaceState.get(ACTIVE_KEY)) {
			await this.context.workspaceState.update(ACTIVE_KEY, conn.id);
		}
		this.emitter.fire();
	}

	async remove(id: string): Promise<void> {
		const all = this.list().filter((c) => c.id !== id);
		await this.context.workspaceState.update(STORE_KEY, all);
		if (this.context.workspaceState.get(ACTIVE_KEY) === id) {
			await this.context.workspaceState.update(ACTIVE_KEY, all[0]?.id);
		}
		this.emitter.fire();
	}

	dispose(): void {
		this.emitter.dispose();
	}
}
