import * as vscode from 'vscode';
import { createLogger, type LogLevel } from './util/logger';
import { SfProjectWatcher } from './project/projectWatcher';
import { ApplicationsTreeProvider } from './views/applicationsTreeProvider';
import { ConnectionStore } from './cluster/connectionStore';
import { LocalClusterManager } from './cluster/localCluster';
import {
	ClustersTreeProvider,
	describeFilter,
	EMPTY_FILTER,
	type ClusterTreeFilter,
	type ClusterTreeItem,
} from './views/clustersTreeProvider';
import { ClusterDocumentProvider } from './views/clusterDocuments';
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
import { clusterEntityCommands } from './commands/clusterEntityCommands';
import { runCreateApplicationCommand } from './commands/createApplicationCommand';
import { runAddServiceCommand } from './commands/addServiceCommand';
import { runRemoveServiceCommand } from './commands/removeServiceCommand';
import { runAddLibraryCommand } from './commands/addLibraryCommand';
import { removeLibraryCommand } from './commands/removeLibraryCommand';

/**
 * A registered command handler. VS Code passes menu/palette arguments untyped,
 * so handlers take `any` here; each handler narrows its own argument.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommandHandler = (...args: any[]) => unknown;

/** The manifests that get definition and code-action providers. */
const MANIFEST_SELECTOR: vscode.DocumentFilter[] = [
	{ language: 'xml', scheme: 'file', pattern: '**/ApplicationManifest.xml' },
	{ language: 'xml', scheme: 'file', pattern: '**/ServiceManifest.xml' },
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const { logger, channel } = createLogger();
	context.subscriptions.push(channel);
	const config = vscode.workspace.getConfiguration('serviceFabric');
	logger.setLevel(config.get<LogLevel>('logLevel') ?? 'info');
	logger.info(`Service Fabric extension activating on ${process.platform}`);

	const projects = new SfProjectWatcher(logger);
	await projects.initialize();
	context.subscriptions.push(projects);

	const applicationsTree = new ApplicationsTreeProvider(projects);
	const applicationsView = vscode.window.createTreeView('serviceFabric.applications', {
		treeDataProvider: applicationsTree,
	});
	context.subscriptions.push(applicationsView);

	const connections = new ConnectionStore(context);
	context.subscriptions.push(connections);
	const localCluster = new LocalClusterManager(connections, logger);
	const clustersTree = new ClustersTreeProvider(connections, context.workspaceState);
	const clustersView = vscode.window.createTreeView('serviceFabric.clusters', {
		treeDataProvider: clustersTree,
	});
	context.subscriptions.push(clustersView);
	// Mirror the filter into context keys (drives the Filter menu) and the view description.
	const publishClusterFilter = (): void => {
		const filter = clustersTree.getFilter();
		for (const key of Object.keys(filter) as (keyof ClusterTreeFilter)[]) {
			vscode.commands.executeCommand('setContext', `serviceFabric.clusters.${key}`, filter[key]);
		}
		vscode.commands.executeCommand('setContext', 'serviceFabric.clusters.filtered', Object.values(filter).some(Boolean));
		clustersView.description = describeFilter(filter);
	};
	publishClusterFilter();
	const toggleClusterFilter = (key: keyof ClusterTreeFilter) => async (): Promise<void> => {
		await clustersTree.setFilter({ ...clustersTree.getFilter(), [key]: !clustersTree.getFilter()[key] });
		publishClusterFilter();
	};
	/** Multi-select picker covering every filter and sort option at once. */
	const pickClusterFilter = async (): Promise<void> => {
		const current = clustersTree.getFilter();
		const options: (vscode.QuickPickItem & { key: keyof ClusterTreeFilter })[] = [
			{ key: 'hideOk', label: '$(pass) Hide healthy', description: 'Rows whose health is Ok, and repair jobs that succeeded' },
			{ key: 'hideWarning', label: '$(warning) Hide warning', description: 'Rows whose health is Warning' },
			{ key: 'hideError', label: '$(error) Hide unhealthy', description: 'Rows whose health is Error, and repair jobs that failed' },
			{
				key: 'hideCompletedRepairs',
				label: '$(tools) Hide completed repair jobs',
				description: 'Repair Manager tasks in the Completed state',
			},
			{
				key: 'sortByHealth',
				label: '$(sort-precedence) Sort by health',
				description: 'Unhealthy first, then warning, then healthy',
				kind: vscode.QuickPickItemKind.Default,
			},
		];
		for (const option of options) option.picked = current[option.key];
		const picked = await vscode.window.showQuickPick(options, {
			canPickMany: true,
			title: 'Filter and sort the Service Fabric Clusters view',
			placeHolder: 'Select what to hide and how to order rows (none selected = show everything in gateway order)',
		});
		if (!picked) return;
		const chosen = new Set(picked.map((p) => p.key));
		const next = { ...EMPTY_FILTER };
		for (const option of options) next[option.key] = chosen.has(option.key);
		await clustersTree.setFilter(next);
		publishClusterFilter();
	};
	const clusterDocuments = new ClusterDocumentProvider();
	context.subscriptions.push(clusterDocuments);
	const statusBar = new ClusterStatusBar(connections, localCluster, logger);
	context.subscriptions.push(statusBar);

	const telemetry = new Telemetry(logger);
	context.subscriptions.push(telemetry);
	telemetry.event('extension.activated', { platform: process.platform });

	const diagnosticEvents = new DiagnosticEventsPanel(connections, logger);
	context.subscriptions.push(diagnosticEvents);
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('servicefabric', new ServiceFabricDebugConfigurationProvider(connections)),
	);

	const updateHasProjectContext = (): void => {
		vscode.commands.executeCommand('setContext', 'serviceFabric.hasProject', projects.getProjects().length > 0);
	};
	updateHasProjectContext();
	context.subscriptions.push(projects.onDidChange(updateHasProjectContext));
	await registerXmlSchemaAssociations(context, logger);

	const manifestDiagnostics = new ManifestDiagnostics(projects);
	manifestDiagnostics.setEnabled(config.get<boolean>('diagnostics.enableManifestRules') ?? true);
	context.subscriptions.push(manifestDiagnostics);

	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(MANIFEST_SELECTOR, new ManifestDefinitionProvider(projects)),
		vscode.languages.registerCodeActionsProvider(MANIFEST_SELECTOR, new ManifestCodeActionProvider(projects), {
			providedCodeActionKinds: ManifestCodeActionProvider.providedCodeActionKinds,
		}),
	);
	context.subscriptions.push(vscode.tasks.registerTaskProvider(ServiceFabricTaskProvider.type, new ServiceFabricTaskProvider(projects)));
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('serviceFabric.logLevel')) {
				const level = vscode.workspace.getConfiguration('serviceFabric').get<LogLevel>('logLevel') ?? 'info';
				logger.setLevel(level);
			}
			if (e.affectsConfiguration('serviceFabric.diagnostics.enableManifestRules')) {
				const enabled = vscode.workspace.getConfiguration('serviceFabric').get<boolean>('diagnostics.enableManifestRules') ?? true;
				manifestDiagnostics.setEnabled(enabled);
			}
		}),
	);

	const commands: [string, CommandHandler][] = [
		['serviceFabric.refreshApplications', () => applicationsTree.refresh()],
		[
			'serviceFabric.refreshClusters',
			async () => {
				// Re-probe every saved connection so status and health update; the store change redraws the tree.
				const probes = connections.list().map((conn) => localCluster.refresh(conn));
				if (probes.length === 0) clustersTree.refresh();
				await Promise.all(probes);
			},
		],
		[
			'serviceFabric.openFile',
			async (uri: vscode.Uri | undefined) => {
				if (!uri) return;
				let stat: vscode.FileStat | undefined;
				try {
					stat = await vscode.workspace.fs.stat(uri);
				} catch {
					stat = undefined;
				}
				if (stat?.type === vscode.FileType.Directory) {
					await vscode.commands.executeCommand('revealInExplorer', uri);
				} else {
					const doc = await vscode.workspace.openTextDocument(uri);
					await vscode.window.showTextDocument(doc, { preview: false });
				}
			},
		],
		['serviceFabric.build', (arg) => runBuildTarget(projects, logger, 'Build', arg)],
		['serviceFabric.rebuild', (arg) => runBuildTarget(projects, logger, 'Rebuild', arg)],
		['serviceFabric.clean', (arg) => runBuildTarget(projects, logger, 'Clean', arg)],
		['serviceFabric.package', (arg) => runBuildTarget(projects, logger, 'Package', arg)],
		[
			'serviceFabric.restore',
			async (arg) => {
				const project = await resolveTargetProject(projects, arg);
				if (!project) return;
				const result = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Service Fabric: restoring NuGet packages for ${project.sfproj.path}…`,
					},
					(progress) => ensureNugetRestored(project.sfproj.path, { output: logger.outputChannel, progress }),
				);
				if (!result.ok) {
					logger.error(`NuGet restore failed (${result.strategy}): ${result.message ?? 'no details'}`);
					await vscode.window.showErrorMessage(`Service Fabric: NuGet restore failed. ${result.message ?? ''}`, { modal: true });
					return;
				}
				if (result.strategy === 'skipped') {
					logger.debug('NuGet restore skipped (already up to date).');
					vscode.window.showInformationMessage('Service Fabric: NuGet packages are already restored.');
				} else {
					logger.info(`NuGet restore succeeded via ${result.strategy}.`);
					vscode.window.showInformationMessage(`Service Fabric: NuGet packages restored (${result.strategy}).`);
				}
			},
		],
		[
			'serviceFabric.publish',
			(arg) => publishApplication(projects, connections, localCluster, logger, arg, context.workspaceState, telemetry),
		],
		['serviceFabric.remove', (arg) => removeApplication(projects, connections, localCluster, logger, arg)],
		['serviceFabric.cluster.connectLocal', () => connectLocalCluster(localCluster)],
		['serviceFabric.cluster.connectRemote', () => connectRemoteCluster(connections, localCluster, logger)],
		['serviceFabric.cluster.disconnect', (node?: ClusterTreeItem) => disconnectCluster(connections, node?.connection)],
		['serviceFabric.cluster.selectActive', () => selectActiveCluster(connections)],
		['serviceFabric.cluster.startLocal', () => startLocalCluster(logger)],
		['serviceFabric.cluster.stopLocal', () => stopLocalCluster(logger)],
		['serviceFabric.cluster.resetLocal', () => resetLocalCluster(logger)],
		['serviceFabric.cluster.switchLocalMode', () => switchLocalClusterMode(logger)],
		['serviceFabric.cluster.openExplorer', (node?: ClusterTreeItem) => openClusterExplorer(connections, node)],
		['serviceFabric.cluster.filter.hideOk', toggleClusterFilter('hideOk')],
		['serviceFabric.cluster.filter.showOk', toggleClusterFilter('hideOk')],
		['serviceFabric.cluster.filter.hideWarning', toggleClusterFilter('hideWarning')],
		['serviceFabric.cluster.filter.showWarning', toggleClusterFilter('hideWarning')],
		['serviceFabric.cluster.filter.hideError', toggleClusterFilter('hideError')],
		['serviceFabric.cluster.filter.showError', toggleClusterFilter('hideError')],
		['serviceFabric.cluster.filter.hideCompletedRepairs', toggleClusterFilter('hideCompletedRepairs')],
		['serviceFabric.cluster.filter.showCompletedRepairs', toggleClusterFilter('hideCompletedRepairs')],
		['serviceFabric.cluster.filter.sortByHealth', toggleClusterFilter('sortByHealth')],
		['serviceFabric.cluster.filter.sortDefault', toggleClusterFilter('sortByHealth')],
		['serviceFabric.cluster.filter.pick', pickClusterFilter],
		[
			'serviceFabric.cluster.filter.clear',
			async () => {
				await clustersTree.setFilter(EMPTY_FILTER);
				publishClusterFilter();
			},
		],
		...clusterEntityCommands({ store: connections, local: localCluster, tree: clustersTree, documents: clusterDocuments, logger }),
		['serviceFabric.createApplication', () => runCreateApplicationCommand(logger)],
		['serviceFabric.addService', (arg) => runAddServiceCommand(projects, logger, toCommandTarget(arg))],
		['serviceFabric.removeService', (arg) => runRemoveServiceCommand(projects, logger, toCommandTarget(arg))],
		['serviceFabric.addLibrary', (arg) => runAddLibraryCommand(projects, logger, toCommandTarget(arg))],
		['serviceFabric.removeLibrary', (arg) => removeLibraryCommand(projects, logger, toCommandTarget(arg))],
		[
			'serviceFabric.debug.attachToService',
			(arg) => {
				telemetry.event('debug.attach.invoked');
				return attachToDeployedService(connections, logger, arg);
			},
		],
		[
			'serviceFabric.debug.autoAttachNext',
			async (node?: ClusterTreeItem) => {
				const appName = node?.appName;
				if (!appName) {
					vscode.window.showWarningMessage('Right-click an application in the Clusters tree to enable auto-attach for the next deploy.');
					return;
				}
				const fullName = appName.startsWith('fabric:/') ? appName : `fabric:/${appName}`;
				const stateKey = `serviceFabric.autoAttachNext:${fullName}`;
				await context.workspaceState.update(stateKey, true);
				telemetry.event('debug.autoAttachNext.armed');
				vscode.window.showInformationMessage(`Auto-attach armed for ${fullName}. The next successful Publish will attach the debugger.`);
			},
		],
		[
			'serviceFabric.devCert.trust',
			async () => {
				telemetry.event('devcert.trust.invoked');
				const { runDevCertTrust } = await import('./devcert/devCertTrust');
				await runDevCertTrust(logger, telemetry, 'manual');
			},
		],
		[
			'serviceFabric.diagnostics.showEvents',
			() => {
				telemetry.event('diagnostics.events.opened');
				diagnosticEvents.show(context.extensionUri);
			},
		],
		[
			'serviceFabric.openWalkthrough',
			() =>
				vscode.commands.executeCommand(
					'workbench.action.openWalkthrough',
					{ category: `${context.extension.id}#serviceFabric.gettingStarted` },
					false,
				),
		],
		[
			'serviceFabric.openHelp',
			async () => {
				telemetry.event('help.opened');
				const helpUri = vscode.Uri.joinPath(context.extensionUri, 'docs', 'HOWTO.md');
				try {
					await vscode.commands.executeCommand('markdown.showPreview', helpUri);
				} catch {
					const doc = await vscode.workspace.openTextDocument(helpUri);
					await vscode.window.showTextDocument(doc, { preview: false });
				}
			},
		],
		[
			'serviceFabric.resetTier2Prompt',
			async () => {
				const { TIER2_PROMPT_SUPPRESS_KEY_PREFIX } = await import('./deploy/tier2Prompt');
				const staleKeys = context.workspaceState.keys().filter((key) => key.startsWith(TIER2_PROMPT_SUPPRESS_KEY_PREFIX));
				for (const key of staleKeys) await context.workspaceState.update(key, undefined);
				const noun = staleKeys.length === 1 ? 'entry' : 'entries';
				logger.info(`Reset Tier 2 property-evaluator prompt: cleared ${staleKeys.length} legacy ${noun} from 1.1.10.`);
				vscode.window.showInformationMessage(
					`Service Fabric: Cleared ${staleKeys.length} legacy Tier 2 prompt ${noun}. (In 1.1.11+ the prompt no longer remembers per-project decisions; this command only clears stale entries from 1.1.10.)`,
				);
			},
		],
	];
	for (const [id, handler] of commands) context.subscriptions.push(vscode.commands.registerCommand(id, handler));

	logger.info(`Found ${projects.getProjects().length} Service Fabric project(s) in this workspace.`);
	manifestDiagnostics.refreshAll();
}

export function deactivate(): void {}

/**
 * Normalizes a scaffold-command argument: an Explorer `Uri` becomes `{ resource }`,
 * a tree item (which already carries `resource`) passes through.
 */
function toCommandTarget<T extends object>(arg: vscode.Uri | T | undefined): { resource: vscode.Uri } | T | undefined {
	if (arg) return arg instanceof vscode.Uri ? { resource: arg } : arg;
	return undefined;
}
