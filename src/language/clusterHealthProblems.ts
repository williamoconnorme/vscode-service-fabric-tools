import * as vscode from 'vscode';
import type { ConnectionStore, ClusterConnection } from '../cluster/connectionStore';
import { createClientForConnection } from '../cluster/clusterAuth';
import type { ApplicationInfo, ServiceInfo, SfRestClient } from '../cluster/sfRestClient';
import type { SfProjectWatcher } from '../project/projectWatcher';
import type { ApplicationProject } from '../project/sfprojModel';
import { findAttributeOccurrences } from '../util/xmlText';
import { ClusterTreeItem } from '../views/clustersTreeProvider';
import { explorerUrlFor } from '../commands/clusterEntityCommands';
import type { Logger } from '../util/logger';

const SOURCE = 'service-fabric (cluster)';
const TIMEOUT_MS = 10000;
/** Also re-checks on this interval while the window is focused; health below the cluster level isn't in the probe. */
const POLL_MS = 60000;

/**
 * Publishes the active cluster's unhealthy applications and services to the Problems panel,
 * on the workspace manifests they come from:
 *
 * - SFH001 an application of this manifest's type is Warning/Error → `ApplicationTypeName` in ApplicationManifest.xml.
 * - SFH002 a service of a type declared here is Warning/Error → `ServiceTypeName` in ServiceManifest.xml.
 *
 * Each diagnostic links to the entity in Service Fabric Explorer and has a "Show Health" quick fix.
 */
export class ClusterHealthProblems implements vscode.Disposable, vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	private readonly collection = vscode.languages.createDiagnosticCollection('serviceFabric.clusterHealth');
	private readonly disposables: vscode.Disposable[] = [this.collection];
	/** The tree item each diagnostic refers to, for the "Show Health" quick fix. */
	private readonly items = new WeakMap<vscode.Diagnostic, ClusterTreeItem>();
	private timer: ReturnType<typeof setInterval> | undefined;
	private pending: ReturnType<typeof setTimeout> | undefined;
	private running = false;
	/** Last active-cluster state the problems were computed for; store changes that don't touch it are ignored. */
	private lastKey = '';

	constructor(
		private readonly store: ConnectionStore,
		private readonly watcher: SfProjectWatcher,
		private readonly logger: Logger,
	) {
		this.disposables.push(
			store.onDidChange(() => {
				if (this.activeKey() !== this.lastKey) this.schedule();
			}),
			watcher.onDidChange(() => this.schedule()),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('serviceFabric.diagnostics.showClusterHealth')) this.schedule();
			}),
			vscode.languages.registerCodeActionsProvider({ scheme: 'file', pattern: '**/{ApplicationManifest,ServiceManifest}.xml' }, this, {
				providedCodeActionKinds: ClusterHealthProblems.providedCodeActionKinds,
			}),
		);
		this.timer = setInterval(() => {
			if (vscode.window.state.focused) this.schedule();
		}, POLL_MS);
		this.schedule();
	}

	private enabled(): boolean {
		return vscode.workspace.getConfiguration('serviceFabric').get<boolean>('diagnostics.showClusterHealth') ?? true;
	}

	private activeKey(): string {
		const a = this.store.getActive();
		return a ? `${a.id}|${a.connected}|${a.aggregatedHealthState}|${a.deployedApplications?.length ?? 0}` : '';
	}

	/** Debounces refreshes (store changes arrive in bursts). */
	private schedule(): void {
		if (this.pending) clearTimeout(this.pending);
		this.pending = setTimeout(() => {
			this.pending = undefined;
			void this.refresh();
		}, 500);
	}

	async refresh(): Promise<void> {
		if (this.running) return this.schedule();
		this.running = true;
		this.lastKey = this.activeKey();
		try {
			const active = this.store.getActive();
			const projects = this.watcher.getProjects().filter((p) => p.applicationManifest);
			if (!this.enabled() || !active?.connected || projects.length === 0) {
				this.collection.clear();
				return;
			}
			const client = createClientForConnection(active);
			const apps = await client.getApplications(TIMEOUT_MS);
			const next = new Map<string, vscode.Diagnostic[]>();
			for (const project of projects) await this.diagnoseProject(project, active, client, apps, next);
			this.collection.clear();
			for (const [file, diagnostics] of next) this.collection.set(vscode.Uri.file(file), diagnostics);
		} catch (err) {
			// Keep the last results on a transient failure; an unreachable cluster clears them via the store change.
			this.logger.debug(`Cluster health problems: ${(err as Error).message}`);
		} finally {
			this.running = false;
		}
	}

	private async diagnoseProject(
		project: ApplicationProject,
		conn: ClusterConnection,
		client: SfRestClient,
		apps: ApplicationInfo[],
		out: Map<string, vscode.Diagnostic[]>,
	): Promise<void> {
		const manifest = project.applicationManifest;
		if (!manifest) return;
		const ofType = apps.filter((a) => a.typeName === manifest.applicationTypeName);
		const unhealthyApps = ofType.filter((a) => isUnhealthy(a.healthState));
		if (unhealthyApps.length === 0) return;

		const appText = (await vscode.workspace.openTextDocument(vscode.Uri.file(manifest.path))).getText();
		const typeAttr = findAttributeOccurrences(appText, 'ApplicationManifest', 'ApplicationTypeName')[0];
		const serviceTypes = await this.serviceTypeLocations(project);

		for (const app of unhealthyApps) {
			const appItem = new ClusterTreeItem('app', app.name, vscode.TreeItemCollapsibleState.None, conn, undefined, {
				appName: app.name,
				appId: app.id,
				typeName: app.typeName,
				typeVersion: app.typeVersion,
			});
			if (typeAttr) {
				const reason = await describeHealth(() => client.getApplicationHealth(app.id, TIMEOUT_MS));
				const message = `fabric:/${app.name} on ${conn.label} is ${app.healthState}${reason ? `: ${reason}` : '.'}`;
				this.push(out, manifest.path, appText, typeAttr.valueRange, app.healthState, 'SFH001', message, conn, appItem);
			}
			let services: ServiceInfo[] = [];
			try {
				services = await client.getServices(app.id, TIMEOUT_MS);
			} catch {
				continue;
			}
			for (const svc of services.filter((s) => isUnhealthy(s.healthState))) {
				const location = serviceTypes.get(svc.typeName);
				if (!location) continue;
				const svcItem = new ClusterTreeItem('service', svc.name, vscode.TreeItemCollapsibleState.None, conn, undefined, {
					...appItem.entity,
					serviceId: svc.id,
					serviceName: svc.name,
					serviceKind: svc.kind,
				});
				const reason = await describeHealth(() => client.getServiceHealth(svc.id, TIMEOUT_MS));
				const message = `${svc.name} on ${conn.label} is ${svc.healthState}${reason ? `: ${reason}` : '.'}`;
				this.push(out, location.file, location.text, location.range, svc.healthState, 'SFH002', message, conn, svcItem);
			}
		}
	}

	/** Service type name → where its `ServiceTypeName` attribute is, across the project's service manifests. */
	private async serviceTypeLocations(
		project: ApplicationProject,
	): Promise<Map<string, { file: string; text: string; range: { start: number; end: number } }>> {
		const result = new Map<string, { file: string; text: string; range: { start: number; end: number } }>();
		for (const sm of project.serviceManifests) {
			const text = (await vscode.workspace.openTextDocument(vscode.Uri.file(sm.path))).getText();
			for (const element of ['StatefulServiceType', 'StatelessServiceType']) {
				for (const attr of findAttributeOccurrences(text, element, 'ServiceTypeName')) {
					result.set(attr.value, { file: sm.path, text, range: attr.valueRange });
				}
			}
		}
		return result;
	}

	private push(
		out: Map<string, vscode.Diagnostic[]>,
		file: string,
		text: string,
		range: { start: number; end: number },
		healthState: string,
		code: string,
		message: string,
		conn: ClusterConnection,
		item: ClusterTreeItem,
	): void {
		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(positionAt(text, range.start), positionAt(text, range.end)),
			message,
			healthState === 'Error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
		);
		diagnostic.source = SOURCE;
		diagnostic.code = { value: code, target: vscode.Uri.parse(explorerUrlFor(conn, item)) };
		this.items.set(diagnostic, item);
		out.set(file, [...(out.get(file) ?? []), diagnostic]);
	}

	provideCodeActions(_document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		for (const diagnostic of context.diagnostics) {
			const item = this.items.get(diagnostic);
			if (!item) continue;
			const show = new vscode.CodeAction(`Show health of ${item.label}`, vscode.CodeActionKind.QuickFix);
			show.command = { command: 'serviceFabric.cluster.showHealth', title: 'Show Health', arguments: [item] };
			show.diagnostics = [diagnostic];
			const explorer = new vscode.CodeAction('Open in Service Fabric Explorer', vscode.CodeActionKind.QuickFix);
			explorer.command = { command: 'serviceFabric.cluster.openExplorer', title: 'Open in Service Fabric Explorer', arguments: [item] };
			explorer.diagnostics = [diagnostic];
			actions.push(show, explorer);
		}
		return actions;
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		if (this.pending) clearTimeout(this.pending);
		for (const d of this.disposables) d.dispose();
	}
}

function isUnhealthy(state: string | undefined): boolean {
	return state === 'Warning' || state === 'Error';
}

/** The first unhealthy evaluation's description, flattened to one line. */
async function describeHealth(load: () => Promise<unknown>): Promise<string | undefined> {
	try {
		const health = (await load()) as { UnhealthyEvaluations?: { HealthEvaluation?: { Description?: string } }[] } | undefined;
		const description = health?.UnhealthyEvaluations?.[0]?.HealthEvaluation?.Description;
		return description ? description.replace(/\s+/g, ' ').trim() : undefined;
	} catch {
		return undefined;
	}
}

function positionAt(text: string, offset: number): vscode.Position {
	const before = text.slice(0, offset);
	const line = before.split('\n').length - 1;
	return new vscode.Position(line, offset - (before.lastIndexOf('\n') + 1));
}
