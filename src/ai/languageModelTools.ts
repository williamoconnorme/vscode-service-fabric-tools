import * as vscode from 'vscode';
import * as path from 'path';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import { createClientForConnection } from '../cluster/clusterAuth';
import type { SfProjectWatcher } from '../project/projectWatcher';

/** Read-only gateway calls made by the tools; short so a slow cluster doesn't stall the chat turn. */
const TIMEOUT_MS = 15000;
/** Results are trimmed to this many characters so a large cluster doesn't flood the model's context. */
const MAX_RESULT_CHARS = 60000;

interface ClusterInput {
	/** Saved cluster label or endpoint; the active cluster when omitted. */
	cluster?: string;
}

interface ApplicationInput extends ClusterInput {
	/** Application name, with or without `fabric:/`. */
	application: string;
}

interface EventsInput extends ClusterInput {
	minutes?: number;
}

/** The parts of `/$/GetClusterHealth` the health tool reports. */
interface GatewayClusterHealth {
	AggregatedHealthState?: string;
	UnhealthyEvaluations?: { HealthEvaluation?: { Description?: string } }[];
	NodeHealthStates?: { Name?: string; AggregatedHealthState?: string }[];
	ApplicationHealthStates?: { Name?: string; AggregatedHealthState?: string }[];
}

/**
 * Registers read-only language model tools (Copilot agent mode and other chat agents) that
 * describe the workspace's Service Fabric projects and the saved clusters: health,
 * applications, services, partitions, replicas and recent cluster events. They never change
 * anything on a cluster. Names match `contributes.languageModelTools` in package.json.
 * No-op on VS Code builds without the language model tools API.
 */
export function registerLanguageModelTools(store: ConnectionStore, watcher: SfProjectWatcher): vscode.Disposable[] {
	if (typeof vscode.lm?.registerTool !== 'function') return [];
	const resolve = (input: ClusterInput): ClusterConnection => {
		const all = store.list();
		const wanted = input.cluster?.trim().toLowerCase();
		const conn = wanted ? all.find((c) => c.label.toLowerCase() === wanted || c.endpoint.toLowerCase() === wanted) : store.getActive();
		if (!conn) {
			throw new Error(
				wanted
					? `No saved cluster named '${input.cluster}'. Saved clusters: ${all.map((c) => c.label).join(', ') || 'none'}.`
					: 'No cluster is configured. Add one in the Service Fabric Clusters view.',
			);
		}
		if (conn.userDisconnected) throw new Error(`${conn.label} is disconnected. Reconnect it in the Service Fabric Clusters view first.`);
		return conn;
	};
	// Background-style clients: a tool call never opens a sign-in prompt.
	const clientFor = (conn: ClusterConnection) => createClientForConnection(conn);

	return [
		tool<Record<string, never>>('servicefabric_listProjects', 'Reading Service Fabric projects', async () =>
			watcher.getProjects().map((p) => ({
				sfproj: vscode.workspace.asRelativePath(p.sfproj.path),
				applicationType: p.applicationManifest?.applicationTypeName,
				version: p.applicationManifest?.applicationTypeVersion,
				parameters: p.applicationManifest?.parameters.map((x) => ({ name: x.name, default: x.defaultValue })),
				services: p.serviceManifests.map((sm) => ({
					package: sm.name,
					version: sm.version,
					manifest: vscode.workspace.asRelativePath(sm.path),
					codePackages: sm.codePackages,
					endpoints: sm.endpoints,
				})),
				parameterFiles: p.applicationParameters.map((f) => path.basename(f)),
				publishProfiles: p.publishProfiles.map((f) => path.basename(f)),
			})),
		),
		tool<Record<string, never>>('servicefabric_listClusters', 'Listing saved Service Fabric clusters', async () => {
			const active = store.getActive()?.id;
			return store.list().map((c) => ({
				label: c.label,
				endpoint: c.endpoint,
				kind: c.kind,
				active: c.id === active,
				state: c.connected ? 'connected' : c.userDisconnected ? 'disconnected' : 'unreachable',
				health: c.aggregatedHealthState,
				nodes: c.nodes?.length,
				applications: c.deployedApplications?.length,
			}));
		}),
		tool<ClusterInput>(
			'servicefabric_getClusterHealth',
			(input) => `Checking health of ${input.cluster ?? 'the active cluster'}`,
			async (input) => {
				const conn = resolve(input);
				const health = (await clientFor(conn).rawGet('/$/GetClusterHealth', TIMEOUT_MS)) as GatewayClusterHealth | undefined;
				return {
					cluster: conn.label,
					aggregatedHealthState: health?.AggregatedHealthState,
					unhealthyEvaluations: (health?.UnhealthyEvaluations ?? []).map((e) => e.HealthEvaluation?.Description),
					nodes: (health?.NodeHealthStates ?? []).map((n) => ({ name: n.Name, health: n.AggregatedHealthState })),
					applications: (health?.ApplicationHealthStates ?? []).map((a) => ({ name: a.Name, health: a.AggregatedHealthState })),
				};
			},
		),
		tool<ClusterInput>(
			'servicefabric_listApplications',
			(input) => `Listing applications on ${input.cluster ?? 'the active cluster'}`,
			async (input) => {
				const conn = resolve(input);
				const client = clientFor(conn);
				const [apps, types] = await Promise.all([client.getApplications(TIMEOUT_MS), client.getApplicationTypes(TIMEOUT_MS)]);
				return {
					cluster: conn.label,
					applications: apps.map((a) => ({
						name: `fabric:/${a.name}`,
						type: a.typeName,
						version: a.typeVersion,
						status: a.status,
						health: a.healthState,
						parameters: Object.fromEntries(a.parameters.map((p) => [p.key, p.value])),
					})),
					applicationTypes: types.map((t) => ({ name: t.name, version: t.version, status: t.status })),
				};
			},
		),
		tool<ApplicationInput>(
			'servicefabric_getApplication',
			(input) => `Reading ${input.application} on ${input.cluster ?? 'the active cluster'}`,
			async (input) => {
				const conn = resolve(input);
				const client = clientFor(conn);
				const name = input.application.replace(/^fabric:\//, '');
				const app = (await client.getApplications(TIMEOUT_MS)).find((a) => a.name.toLowerCase() === name.toLowerCase());
				if (!app) throw new Error(`No application fabric:/${name} on ${conn.label}.`);
				const services = await client.getServices(app.id, TIMEOUT_MS);
				return {
					cluster: conn.label,
					name: `fabric:/${app.name}`,
					type: app.typeName,
					version: app.typeVersion,
					status: app.status,
					health: app.healthState,
					services: await Promise.all(
						services.map(async (s) => ({
							name: s.name,
							type: s.typeName,
							kind: s.kind,
							status: s.status,
							health: s.healthState,
							partitions: await Promise.all(
								(await client.getPartitions(s.id, TIMEOUT_MS)).map(async (p) => ({
									id: p.id,
									status: p.status,
									health: p.healthState,
									replicas: (await client.getReplicas(p.id, TIMEOUT_MS)).map((r) => ({
										id: r.id,
										role: s.kind === 'Stateful' ? r.role : 'Instance',
										status: r.status,
										health: r.healthState,
										node: r.nodeName,
									})),
								})),
							),
						})),
					),
				};
			},
		),
		tool<EventsInput>(
			'servicefabric_getClusterEvents',
			(input) => `Reading recent events from ${input.cluster ?? 'the active cluster'}`,
			async (input) => {
				const conn = resolve(input);
				const minutes = Math.min(Math.max(input.minutes ?? 60, 1), 24 * 60);
				const start = new Date(Date.now() - minutes * 60000).toISOString();
				const end = new Date().toISOString();
				const body = await clientFor(conn).rawGet(
					`/EventsStore/Cluster/Events?StartTimeUtc=${encodeURIComponent(start)}&EndTimeUtc=${encodeURIComponent(end)}`,
					TIMEOUT_MS,
				);
				const events = Array.isArray(body) ? body.slice(-200).reverse() : [];
				return { cluster: conn.label, minutes, count: events.length, events };
			},
		),
	];
}

/** A read-only tool whose result is `run`'s value as JSON; failures are reported to the model as text. */
function tool<T>(name: string, message: string | ((input: T) => string), run: (input: T) => Promise<unknown>): vscode.Disposable {
	return vscode.lm.registerTool<T>(name, {
		prepareInvocation: (options) => ({ invocationMessage: typeof message === 'string' ? message : message(options.input) }),
		async invoke(options) {
			let text: string;
			try {
				text = JSON.stringify(await run(options.input), null, 1);
				if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n… (truncated)`;
			} catch (err) {
				text = `Error: ${(err as Error).message}`;
			}
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
		},
	});
}
