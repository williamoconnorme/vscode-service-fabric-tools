// @ts-nocheck
import * as vscode from 'vscode';
import { createLogger } from './util/logger';
import { SfProjectWatcher } from './project/projectWatcher';
import { ApplicationsTreeProvider } from './views/applicationsTreeProvider';
import { ConnectionStore } from './cluster/connectionStore';
import { LocalClusterManager } from './cluster/localCluster';
import { ClustersTreeProvider } from './views/clustersTreeProvider';
import { ClusterStatusBar } from './views/clusterStatusBar';
import { Telemetry } from './util/telemetry';
import { DiagnosticEventsPanel } from './views/diagnosticEventsPanel';
import { ServiceFabricDebugConfigurationProvider, attachToDeployedService } from './debug/attachCommand';
import { registerXmlSchemaAssociations } from './language/xmlSchemaAssociation';
import { ManifestDiagnostics } from './language/manifestDiagnostics';
import { ManifestDefinitionProvider } from './language/manifestDefinitionProvider';
import { ManifestCodeActionProvider } from './language/manifestCodeActions';
import { ServiceFabricTaskProvider } from './build/sfTaskProvider';
import { resolveTargetProject, runBuildTarget } from './commands/buildCommands';
import { ensureNugetRestored } from './build/nugetRestore';
import { publishApplication } from './commands/publishCommand';
import { removeApplication } from './commands/removeCommand';
import {
	connectLocalCluster,
	connectRemoteCluster,
	disconnectCluster,
	openClusterExplorer,
	resetLocalCluster,
	selectActiveCluster,
	startLocalCluster,
	stopLocalCluster,
	switchLocalClusterMode,
} from './commands/clusterCommands';
import { runCreateApplicationCommand } from './commands/createApplicationCommand';
import { runAddServiceCommand } from './commands/addServiceCommand';
import { runRemoveServiceCommand } from './commands/removeServiceCommand';
import { runAddLibraryCommand } from './commands/addLibraryCommand';
import { removeLibraryCommand } from './commands/removeLibraryCommand';

async function activate(e) {
	let { logger: t, channel: r } = createLogger();
	e.subscriptions.push(r);
	let n = vscode.workspace.getConfiguration('serviceFabric');
	(t.setLevel(n.get('logLevel') ?? 'info'), t.info(`Service Fabric extension activating on ${process.platform}`));
	let i = new SfProjectWatcher(t);
	(await i.initialize(), e.subscriptions.push(i));
	let o = new ApplicationsTreeProvider(i),
		s = vscode.window.createTreeView('serviceFabric.applications', {
			treeDataProvider: o,
		});
	e.subscriptions.push(s);
	let a = new ConnectionStore(e);
	e.subscriptions.push(a);
	let c = new LocalClusterManager(a, t),
		l = new ClustersTreeProvider(a),
		u = vscode.window.createTreeView('serviceFabric.clusters', {
			treeDataProvider: l,
		});
	e.subscriptions.push(u);
	let p = new ClusterStatusBar(a, c, t);
	e.subscriptions.push(p);
	let d = new Telemetry(t);
	(e.subscriptions.push(d),
		d.event('extension.activated', {
			platform: process.platform,
		}));
	let f = new DiagnosticEventsPanel(a, t);
	(e.subscriptions.push(f),
		e.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('servicefabric', new ServiceFabricDebugConfigurationProvider(a))));
	let m = () => {
		vscode.commands.executeCommand('setContext', 'serviceFabric.hasProject', i.getProjects().length > 0);
	};
	(m(), e.subscriptions.push(i.onDidChange(m)), await registerXmlSchemaAssociations(e, t));
	let v = new ManifestDiagnostics(i);
	(v.setEnabled(n.get('diagnostics.enableManifestRules') ?? !0), e.subscriptions.push(v));
	let h = [
		{
			language: 'xml',
			scheme: 'file',
			pattern: '**/ApplicationManifest.xml',
		},
		{
			language: 'xml',
			scheme: 'file',
			pattern: '**/ServiceManifest.xml',
		},
	];
	(e.subscriptions.push(
		vscode.languages.registerDefinitionProvider(h, new ManifestDefinitionProvider(i)),
		vscode.languages.registerCodeActionsProvider(h, new ManifestCodeActionProvider(i), {
			providedCodeActionKinds: ManifestCodeActionProvider.providedCodeActionKinds,
		}),
	),
		e.subscriptions.push(vscode.tasks.registerTaskProvider(ServiceFabricTaskProvider.type, new ServiceFabricTaskProvider(i))),
		e.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((g) => {
				if (g.affectsConfiguration('serviceFabric.logLevel')) {
					let w = vscode.workspace.getConfiguration('serviceFabric').get('logLevel') ?? 'info';
					t.setLevel(w);
				}
				if (g.affectsConfiguration('serviceFabric.diagnostics.enableManifestRules')) {
					let w = vscode.workspace.getConfiguration('serviceFabric').get('diagnostics.enableManifestRules') ?? !0;
					v.setEnabled(w);
				}
			}),
		));
	let P = [
		['serviceFabric.refreshApplications', () => o.refresh()],
		['serviceFabric.refreshClusters', () => l.refresh()],
		[
			'serviceFabric.openFile',
			async (g) => {
				if (!g) return;
				let w;
				try {
					w = await vscode.workspace.fs.stat(g);
				} catch {
					w = void 0;
				}
				if (w?.type === vscode.FileType.Directory) await vscode.commands.executeCommand('revealInExplorer', g);
				else {
					let b = await vscode.workspace.openTextDocument(g);
					await vscode.window.showTextDocument(b, {
						preview: !1,
					});
				}
			},
		],
		['serviceFabric.build', (g) => runBuildTarget(i, t, 'Build', g)],
		['serviceFabric.rebuild', (g) => runBuildTarget(i, t, 'Rebuild', g)],
		['serviceFabric.clean', (g) => runBuildTarget(i, t, 'Clean', g)],
		['serviceFabric.package', (g) => runBuildTarget(i, t, 'Package', g)],
		[
			'serviceFabric.restore',
			async (g) => {
				let w = await resolveTargetProject(i, g);
				if (!w) return;
				let b = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Service Fabric: restoring NuGet packages for ${w.sfproj.path}\u2026`,
					},
					(S) =>
						ensureNugetRestored(w.sfproj.path, {
							output: t.outputChannel,
							progress: S,
						}),
				);
				if (!b.ok) {
					(t.error(`NuGet restore failed (${b.strategy}): ${b.message ?? 'no details'}`),
						await vscode.window.showErrorMessage(`Service Fabric: NuGet restore failed. ${b.message ?? ''}`, {
							modal: !0,
						}));
					return;
				}
				b.strategy === 'skipped'
					? (t.debug('NuGet restore skipped (already up to date).'),
						vscode.window.showInformationMessage('Service Fabric: NuGet packages are already restored.'))
					: (t.info(`NuGet restore succeeded via ${b.strategy}.`),
						vscode.window.showInformationMessage(`Service Fabric: NuGet packages restored (${b.strategy}).`));
			},
		],
		['serviceFabric.publish', (g) => publishApplication(i, a, c, t, g, e.workspaceState, d)],
		['serviceFabric.remove', (g) => removeApplication(i, a, c, t, g)],
		['serviceFabric.cluster.connectLocal', () => connectLocalCluster(c)],
		['serviceFabric.cluster.connectRemote', () => connectRemoteCluster(a, c)],
		['serviceFabric.cluster.disconnect', (g) => disconnectCluster(a, g?.connection)],
		['serviceFabric.cluster.selectActive', () => selectActiveCluster(a)],
		['serviceFabric.cluster.startLocal', () => startLocalCluster(t)],
		['serviceFabric.cluster.stopLocal', () => stopLocalCluster(t)],
		['serviceFabric.cluster.resetLocal', () => resetLocalCluster(t)],
		['serviceFabric.cluster.switchLocalMode', () => switchLocalClusterMode(t)],
		['serviceFabric.cluster.openExplorer', (g) => openClusterExplorer(a, g?.connection)],
		['serviceFabric.createApplication', () => runCreateApplicationCommand(t)],
		['serviceFabric.addService', (g) => runAddServiceCommand(i, t, toCommandTarget(g))],
		['serviceFabric.removeService', (g) => runRemoveServiceCommand(i, t, toCommandTarget(g))],
		['serviceFabric.addLibrary', (g) => runAddLibraryCommand(i, t, toCommandTarget(g))],
		['serviceFabric.removeLibrary', (g) => removeLibraryCommand(i, t, toCommandTarget(g))],
		['serviceFabric.debug.attachToService', (g) => (d.event('debug.attach.invoked'), attachToDeployedService(a, t, g))],
		[
			'serviceFabric.debug.autoAttachNext',
			async (g) => {
				let w = g?.appName;
				if (!w) {
					vscode.window.showWarningMessage('Right-click an application in the Clusters tree to enable auto-attach for the next deploy.');
					return;
				}
				let b = w.startsWith('fabric:/') ? w : `fabric:/${w}`,
					S = `serviceFabric.autoAttachNext:${b}`;
				(await e.workspaceState.update(S, !0),
					d.event('debug.autoAttachNext.armed'),
					vscode.window.showInformationMessage(`Auto-attach armed for ${b}. The next successful Publish will attach the debugger.`));
			},
		],
		[
			'serviceFabric.devCert.trust',
			async () => {
				d.event('devcert.trust.invoked');
				let { runDevCertTrust: g } = await import('./devcert/devCertTrust');
				await g(t, d, 'manual');
			},
		],
		[
			'serviceFabric.diagnostics.showEvents',
			() => {
				(d.event('diagnostics.events.opened'), f.show(e.extensionUri));
			},
		],
		[
			'serviceFabric.openWalkthrough',
			() =>
				vscode.commands.executeCommand(
					'workbench.action.openWalkthrough',
					{
						category: `${e.extension.id}#serviceFabric.gettingStarted`,
					},
					!1,
				),
		],
		[
			'serviceFabric.openHelp',
			async () => {
				d.event('help.opened');
				let g = vscode.Uri.joinPath(e.extensionUri, 'docs', 'HOWTO.md');
				try {
					await vscode.commands.executeCommand('markdown.showPreview', g);
				} catch {
					let w = await vscode.workspace.openTextDocument(g);
					await vscode.window.showTextDocument(w, {
						preview: !1,
					});
				}
			},
		],
		[
			'serviceFabric.resetTier2Prompt',
			async () => {
				let { TIER2_PROMPT_SUPPRESS_KEY_PREFIX: g } = await import('./deploy/tier2Prompt'),
					w = e.workspaceState.keys().filter((S) => S.startsWith(g));
				for (let S of w) await e.workspaceState.update(S, void 0);
				let b = w.length === 1 ? 'entry' : 'entries';
				(t.info(`Reset Tier 2 property-evaluator prompt: cleared ${w.length} legacy ${b} from 1.1.10.`),
					vscode.window.showInformationMessage(
						`Service Fabric: Cleared ${w.length} legacy Tier 2 prompt ${b}. (In 1.1.11+ the prompt no longer remembers per-project decisions; this command only clears stale entries from 1.1.10.)`,
					));
			},
		],
	];
	for (let [g, w] of P) e.subscriptions.push(vscode.commands.registerCommand(g, w));
	(t.info(`Found ${i.getProjects().length} Service Fabric project(s) in this workspace.`), v.refreshAll());
}

function deactivate() {}

function toCommandTarget(e) {
	if (e)
		return e instanceof vscode.Uri
			? {
					resource: e,
				}
			: e;
}

export { activate, deactivate };
