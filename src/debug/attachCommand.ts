import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import { SfRestClient, type DeployedApplicationInfo, type DeployedCodePackageInfo } from '../cluster/sfRestClient';
import { buildAttachConfig } from './attachConfig';
import {
	CANCEL_BUTTON_LABEL,
	INSTALL_BUTTON_LABEL,
	MARKETPLACE_BUTTON_LABEL,
	checkAvailability,
	classifyInstallPromptResult,
	formatExtensionMissingMessage,
	formatPlatformBlockedMessage,
	type DebugRuntime,
} from './debuggerAvailability';

/** The slice of the extension logger the attach flow uses. */
export interface DebugAttachLogger {
	info(message: string): void;
	error(message: string, err?: unknown): void;
	readonly outputChannel: vscode.OutputChannel;
}

/** Optional arguments for `serviceFabric.debug.attachToService` (e.g. from a tree item). */
export interface AttachToServiceArgs {
	connection?: ClusterConnection;
	appName?: string;
}

/** Interval between `vscode.extensions.getExtension` polls after an install. */
const EXTENSION_INSTALL_POLL_MS = 200;
/** How long to wait for a freshly installed extension to register. */
const EXTENSION_INSTALL_TIMEOUT_MS = 5000;

/**
 * `serviceFabric.debug.attachToService`: picks a deployed application, one of
 * its code packages with a known host PID, and a runtime, then starts an
 * attach session against that process.
 */
export async function attachToDeployedService(
	store: ConnectionStore,
	logger: DebugAttachLogger,
	args?: AttachToServiceArgs,
): Promise<void> {
	const connection = args?.connection ?? store.getActive();
	if (!connection || !connection.connected) {
		vscode.window.showWarningMessage('Connect to a Service Fabric cluster before attaching a debugger.');
		return;
	}
	const client = new SfRestClient(connection.endpoint);
	const apps: DeployedApplicationInfo[] = connection.deployedApplications ?? (await client.getDeployedApplications().catch(() => []));
	if (apps.length === 0) {
		vscode.window.showWarningMessage('No deployed applications were found on the active cluster.');
		return;
	}
	const requestedName = args?.appName;
	let app = requestedName ? apps.find((a) => a.name === requestedName.replace(/^fabric:\//, '')) : undefined;
	if (!app) {
		const picked = await vscode.window.showQuickPick(
			apps.map((a) => ({
				label: a.name,
				description: `${a.typeName} v${a.typeVersion}`,
				detail: a.status,
				app: a,
			})),
			{ placeHolder: 'Select the application that hosts the service to attach to' },
		);
		app = picked?.app;
	}
	if (!app) return;

	const cachedNodeNames = connection.nodes?.map((n) => n.name) ?? [];
	const nodeNames = cachedNodeNames.length > 0 ? cachedNodeNames : (await client.getNodes()).map((n) => n.name);
	if (nodeNames.length === 0) {
		vscode.window.showWarningMessage('No cluster nodes were reported.');
		return;
	}
	const appFullName = app.name.startsWith('fabric:/') ? app.name : `fabric:/${app.name}`;
	const packages = (
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Locating processes for ${app.name}…` }, () =>
			client.getDeployedCodePackages(appFullName, nodeNames),
		)
	).filter((p) => p.processId);
	if (packages.length === 0) {
		vscode.window.showWarningMessage(
			`No running code packages with a known PID were found for ${app.name}. Containers and Guest Executables may not expose a PID via the SF gateway.`,
		);
		return;
	}
	const pkg = await pickCodePackage(packages);
	if (!pkg) return;
	const runtime = await pickAttachRuntime();
	if (!runtime || !(await ensureDebuggerAvailable(runtime, logger))) return;

	const config = buildAttachConfig(pkg, runtime);
	logger.info(
		`Attaching ${runtime} debugger to PID ${pkg.processId} (${pkg.serviceManifestName}/${pkg.codePackageName} on ${pkg.nodeName})`,
	);
	const started = await vscode.debug.startDebugging(undefined, config);
	if (!started) {
		const pick = await vscode.window.showErrorMessage(
			`VS Code refused to start the ${runtime} debugger for PID ${pkg.processId}. Possible causes: the process exited, the C# extension did not activate, or another extension claimed the debug type. Check the Service Fabric output channel for details.`,
			'Open Output Channel',
		);
		if (pick === 'Open Output Channel') logger.outputChannel.show(true);
	}
}

/**
 * Pre-flight check that the debug adapter for `runtime` is installed, offering
 * to install it (or open the Marketplace) when it is not. Resolves `true` when
 * attaching can proceed. Skipped entirely when
 * `serviceFabric.debug.suppressInstallPrompt` is `true`.
 */
export async function ensureDebuggerAvailable(runtime: DebugRuntime, logger: Pick<DebugAttachLogger, 'info' | 'error'>): Promise<boolean> {
	if (vscode.workspace.getConfiguration('serviceFabric').get('debug.suppressInstallPrompt') === true) return true;
	const availability = checkAvailability(runtime, {
		platform: process.platform,
		isExtensionInstalled: (id) => !!vscode.extensions.getExtension(id),
	});
	if (availability.kind === 'available') return true;
	if (availability.kind === 'platform-blocked') {
		await vscode.window.showErrorMessage(formatPlatformBlockedMessage(runtime, availability.reason));
		return false;
	}
	const requirement = availability.requirement;
	const message = formatExtensionMissingMessage(runtime, requirement);
	const pick = await vscode.window.showErrorMessage(
		message,
		{ modal: true },
		INSTALL_BUTTON_LABEL,
		MARKETPLACE_BUTTON_LABEL,
		CANCEL_BUTTON_LABEL,
	);
	const choice = classifyInstallPromptResult(pick);
	if (choice === 'cancel') return false;
	if (choice === 'marketplace') {
		await vscode.commands.executeCommand('workbench.extensions.search', `@id:${requirement.extensionId}`);
		return false;
	}
	await installExtensionWithProgress(requirement.extensionId, logger);
	if (await waitForExtensionInstalled(requirement.extensionId)) {
		if (requirement.additionalAdvice) vscode.window.showInformationMessage(requirement.additionalAdvice);
		return true;
	}
	vscode.window.showErrorMessage(
		`Install of ${requirement.extensionId} did not complete. Open the Extensions view and install it manually, then re-run Attach Debugger to Deployed Service…`,
	);
	return false;
}

async function installExtensionWithProgress(extensionId: string, logger: Pick<DebugAttachLogger, 'info' | 'error'>): Promise<void> {
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Installing ${extensionId}…`, cancellable: false },
		async () => {
			try {
				await vscode.commands.executeCommand('workbench.extensions.installExtension', extensionId);
				logger.info(`Installed extension ${extensionId}`);
			} catch (err) {
				logger.error(`Failed to install ${extensionId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	);
}

/** Polls until the extension host reports the extension, or the timeout elapses. */
async function waitForExtensionInstalled(extensionId: string): Promise<boolean> {
	const deadline = Date.now() + EXTENSION_INSTALL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (vscode.extensions.getExtension(extensionId)) return true;
		await new Promise((resolve) => setTimeout(resolve, EXTENSION_INSTALL_POLL_MS));
	}
	return !!vscode.extensions.getExtension(extensionId);
}

function pickCodePackage(packages: DeployedCodePackageInfo[]): Thenable<DeployedCodePackageInfo | undefined> {
	return vscode.window
		.showQuickPick(
			packages.map((p) => ({
				label: `$(debug-alt) ${p.serviceManifestName} / ${p.codePackageName}`,
				description: `pid ${p.processId} • ${p.nodeName}`,
				detail: `${p.hostType || 'host'} • v${p.codePackageVersion} • ${p.entryPointStatus}`,
				pkg: p,
			})),
			{ placeHolder: 'Select the code package replica to attach to' },
		)
		.then((picked) => picked?.pkg);
}

function pickAttachRuntime(): Thenable<DebugRuntime | undefined> {
	const items: (vscode.QuickPickItem & { value: DebugRuntime })[] = [
		{ label: '.NET (coreclr)', description: 'Modern .NET / .NET Core. Requires C# extension.', value: 'coreclr' },
		{
			label: '.NET Framework (clr)',
			description: 'Windows-only legacy CLR. Requires Visual Studio for Windows debugger or compatible.',
			value: 'clr',
		},
	];
	return vscode.window
		.showQuickPick(items, { placeHolder: 'Select the runtime to attach (Service Fabric services typically use coreclr)' })
		.then((picked) => picked?.value);
}

/**
 * Provides the `servicefabric` launch configuration. Resolving it never starts
 * a session itself: it forwards to the attach command (or offers to connect
 * the local cluster first) and returns `undefined` to cancel the launch.
 */
export class ServiceFabricDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	constructor(private readonly store: ConnectionStore) {}

	provideDebugConfigurations(): vscode.DebugConfiguration[] {
		return [
			{
				type: 'servicefabric',
				request: 'attach',
				name: 'Service Fabric: Attach to Deployed Service',
				runtime: 'coreclr',
			},
		];
	}

	async resolveDebugConfiguration(
		_folder: vscode.WorkspaceFolder | undefined,
		debugConfiguration: vscode.DebugConfiguration,
	): Promise<vscode.DebugConfiguration | undefined> {
		if (debugConfiguration.type !== 'servicefabric') return debugConfiguration;
		if (!this.store.getActive()?.connected) {
			const pick = await vscode.window.showWarningMessage(
				'No Service Fabric cluster is connected. Connect first?',
				'Connect Local Cluster',
				'Cancel',
			);
			if (pick === 'Connect Local Cluster') await vscode.commands.executeCommand('serviceFabric.cluster.connectLocal');
			return undefined;
		}
		await vscode.commands.executeCommand('serviceFabric.debug.attachToService');
		return undefined;
	}
}
