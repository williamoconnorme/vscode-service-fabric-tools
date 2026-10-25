import * as vscode from 'vscode';

import type { ClusterNodeInfo, DeployedApplicationInfo } from './sfRestClient';
import type { EntraClusterAuth } from './clusterAuth';
import type { ServerCertPin } from './tlsPinning';
import type { ClientCertRef } from './clientCert';
import {
	definitionOf,
	mergeConnections,
	migrateWorkspaceConnections,
	runtimeOf,
	type ClusterDefinition,
	type ClusterRuntimeState,
} from './connectionRecords';

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

/** `globalState`: the saved cluster definitions, shared by every workspace (and synced when enabled). */
const DEFINITIONS_KEY = 'serviceFabric.clusters';
/** `globalState`: the cluster last made active in any workspace, for workspaces that haven't picked one. */
const LAST_ACTIVE_KEY = 'serviceFabric.lastActiveClusterId';
/** `workspaceState`: this workspace's probe results and Disconnect flags, by cluster id. */
const RUNTIME_KEY = 'serviceFabric.clusterState';
const ACTIVE_KEY = 'serviceFabric.activeClusterId';
/** `workspaceState`: where 1.2.x kept whole connections, per workspace. */
const LEGACY_KEY = 'serviceFabric.connections';

/**
 * Saved cluster connections. The clusters themselves (endpoint, label, security settings) are
 * shared by all workspaces and, with `serviceFabric.clusters.syncSavedClusters`, synced by Settings
 * Sync; client certificate passphrases stay in SecretStorage and never sync. Each workspace keeps
 * its own active cluster, probe results and Disconnect state.
 */
export class ConnectionStore implements vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.emitter.event;
	private readonly disposables: vscode.Disposable[] = [this.emitter];

	constructor(private readonly context: vscode.ExtensionContext) {
		this.applySyncSetting();
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('serviceFabric.clusters.syncSavedClusters')) this.applySyncSetting();
			}),
		);
	}

	/** Moves connections this workspace saved before clusters were shared into the shared list. Run once on activation. */
	async migrate(): Promise<void> {
		const legacy = this.context.workspaceState.get<ClusterConnection[]>(LEGACY_KEY);
		if (!legacy) return;
		const { definitions, runtime } = migrateWorkspaceConnections(this.definitions(), legacy);
		await this.context.globalState.update(DEFINITIONS_KEY, definitions);
		await this.context.workspaceState.update(RUNTIME_KEY, { ...runtime, ...this.runtime() });
		await this.context.workspaceState.update(LEGACY_KEY, undefined);
		this.emitter.fire();
	}

	list(): ClusterConnection[] {
		return mergeConnections(this.definitions(), this.runtime());
	}

	get(id: string): ClusterConnection | undefined {
		return this.list().find((c) => c.id === id);
	}

	/** This workspace's active cluster, else the one last made active anywhere, else the first. */
	getActive(): ClusterConnection | undefined {
		const all = this.list();
		const ids = [this.context.workspaceState.get<string>(ACTIVE_KEY), this.context.globalState.get<string>(LAST_ACTIVE_KEY)];
		for (const id of ids) {
			const found = id ? all.find((c) => c.id === id) : undefined;
			if (found) return found;
		}
		return all[0];
	}

	async setActive(id: string): Promise<void> {
		await this.context.workspaceState.update(ACTIVE_KEY, id);
		await this.context.globalState.update(LAST_ACTIVE_KEY, id);
		this.emitter.fire();
	}

	/** Saves `conn`. With `ifChanged`, an identical saved connection is left alone and no change event fires. */
	async upsert(conn: ClusterConnection, opts: { ifChanged?: boolean } = {}): Promise<void> {
		const definition = definitionOf(conn);
		const state = runtimeOf(conn);
		if (opts.ifChanged) {
			// Compare in stored form, so fields left undefined don't count as a change.
			const existing = this.get(conn.id);
			const next = mergeConnections([definition], { [conn.id]: state })[0];
			if (existing && JSON.stringify(existing) === JSON.stringify(next)) return;
		}
		// Only write the shared list when the definition changed: probes would otherwise churn Settings Sync.
		const definitions = this.definitions();
		const idx = definitions.findIndex((d) => d.id === conn.id);
		if (idx < 0 || JSON.stringify(definitions[idx]) !== JSON.stringify(definition)) {
			if (idx >= 0) definitions[idx] = definition;
			else definitions.push(definition);
			await this.context.globalState.update(DEFINITIONS_KEY, definitions);
		}
		await this.context.workspaceState.update(RUNTIME_KEY, { ...this.runtime(), [conn.id]: state });
		if (!this.context.workspaceState.get(ACTIVE_KEY)) await this.context.workspaceState.update(ACTIVE_KEY, conn.id);
		this.emitter.fire();
	}

	/** Removes the cluster from every workspace. */
	async remove(id: string): Promise<void> {
		const definitions = this.definitions().filter((d) => d.id !== id);
		await this.context.globalState.update(DEFINITIONS_KEY, definitions);
		const { [id]: _removed, ...runtime } = this.runtime();
		await this.context.workspaceState.update(RUNTIME_KEY, runtime);
		if (this.context.workspaceState.get(ACTIVE_KEY) === id) await this.context.workspaceState.update(ACTIVE_KEY, definitions[0]?.id);
		if (this.context.globalState.get(LAST_ACTIVE_KEY) === id) await this.context.globalState.update(LAST_ACTIVE_KEY, undefined);
		this.emitter.fire();
	}

	private definitions(): ClusterDefinition[] {
		return [...this.context.globalState.get<ClusterDefinition[]>(DEFINITIONS_KEY, [])];
	}

	private runtime(): Record<string, ClusterRuntimeState> {
		return this.context.workspaceState.get<Record<string, ClusterRuntimeState>>(RUNTIME_KEY, {});
	}

	private applySyncSetting(): void {
		const sync = vscode.workspace.getConfiguration('serviceFabric').get<boolean>('clusters.syncSavedClusters') ?? true;
		this.context.globalState.setKeysForSync(sync ? [DEFINITIONS_KEY] : []);
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
	}
}
