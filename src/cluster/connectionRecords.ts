/**
 * How a {@link ClusterConnection} is split for storage. The saved definition (endpoint, label,
 * security) is shared by every workspace and can sync between machines; the probe results
 * and the Disconnect flag stay with the workspace. Pure: no VS Code dependency.
 */
import type { ClusterConnection } from './connectionStore';

/** The fields of a connection that describe the cluster itself. */
export type ClusterDefinition = Pick<ClusterConnection, 'id' | 'label' | 'endpoint' | 'kind' | 'auth' | 'serverCert' | 'clientCert'>;

/** Last known state of a connection in one workspace. */
export type ClusterRuntimeState = Pick<
	ClusterConnection,
	'connected' | 'userDisconnected' | 'aggregatedHealthState' | 'deployedApplications' | 'nodes'
>;

export function definitionOf(conn: ClusterConnection): ClusterDefinition {
	const { id, label, endpoint, kind, auth, serverCert, clientCert } = conn;
	return dropUndefined({ id, label, endpoint, kind, auth, serverCert, clientCert });
}

export function runtimeOf(conn: ClusterConnection): ClusterRuntimeState {
	const { connected, userDisconnected, aggregatedHealthState, deployedApplications, nodes } = conn;
	return dropUndefined({ connected, userDisconnected, aggregatedHealthState, deployedApplications, nodes });
}

/** Saved definitions with this workspace's state; clusters never probed here start disconnected. */
export function mergeConnections(definitions: ClusterDefinition[], runtime: Record<string, ClusterRuntimeState>): ClusterConnection[] {
	return definitions.map((d) => ({ ...d, ...(runtime[d.id] ?? { connected: false }) }));
}

/**
 * Folds connections a workspace saved before clusters were shared (1.2.x) into the
 * shared definitions. A cluster already shared keeps its shared definition; the workspace's
 * probe state is kept either way.
 */
export function migrateWorkspaceConnections(
	shared: ClusterDefinition[],
	legacy: ClusterConnection[],
): { definitions: ClusterDefinition[]; runtime: Record<string, ClusterRuntimeState> } {
	const definitions = [...shared];
	const runtime: Record<string, ClusterRuntimeState> = {};
	for (const conn of legacy) {
		if (!definitions.some((d) => d.id === conn.id)) definitions.push(definitionOf(conn));
		runtime[conn.id] = runtimeOf(conn);
	}
	return { definitions, runtime };
}

function dropUndefined<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
