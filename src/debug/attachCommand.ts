// @ts-nocheck
import * as vscode from 'vscode';
import { SfRestClient } from '../cluster/sfRestClient';
import { buildAttachConfig } from './attachConfig';
import {
	CANCEL_BUTTON_LABEL,
	INSTALL_BUTTON_LABEL,
	MARKETPLACE_BUTTON_LABEL,
	checkAvailability,
	classifyInstallPromptResult,
	formatExtensionMissingMessage,
	formatPlatformBlockedMessage,
} from './debuggerAvailability';

async function attachToDeployedService(e, t, r) {
	let n = r?.connection ?? e.getActive();
	if (!n || !n.connected) {
		vscode.window.showWarningMessage('Connect to a Service Fabric cluster before attaching a debugger.');
		return;
	}
	let i = new SfRestClient(n.endpoint),
		o = n.deployedApplications ?? (await i.getDeployedApplications().catch(() => []));
	if (o.length === 0) {
		vscode.window.showWarningMessage('No deployed applications were found on the active cluster.');
		return;
	}
	let s = r?.appName,
		a = s ? o.find((P) => P.name === s.replace(/^fabric:\//, '')) : void 0;
	if (
		(a ||
			(a = (
				await vscode.window.showQuickPick(
					o.map((g) => ({
						label: g.name,
						description: `${g.typeName} v${g.typeVersion}`,
						detail: g.status,
						app: g,
					})),
					{
						placeHolder: 'Select the application that hosts the service to attach to',
					},
				)
			)?.app),
		!a)
	)
		return;
	let c = n.nodes?.map((P) => P.name) ?? [],
		l = c.length > 0 ? c : (await i.getNodes()).map((P) => P.name);
	if (l.length === 0) {
		vscode.window.showWarningMessage('No cluster nodes were reported.');
		return;
	}
	let u = a.name.startsWith('fabric:/') ? a.name : `fabric:/${a.name}`,
		d = (
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Locating processes for ${a.name}\u2026`,
				},
				() => i.getDeployedCodePackages(u, l),
			)
		).filter((P) => P.processId);
	if (d.length === 0) {
		vscode.window.showWarningMessage(
			`No running code packages with a known PID were found for ${a.name}. Containers and Guest Executables may not expose a PID via the SF gateway.`,
		);
		return;
	}
	let f = await pickCodePackage(d);
	if (!f) return;
	let m = await pickAttachRuntime();
	if (!m || !(await ensureDebuggerAvailable(m, t))) return;
	let v = buildAttachConfig(f, m);
	(t.info(`Attaching ${m} debugger to PID ${f.processId} (${f.serviceManifestName}/${f.codePackageName} on ${f.nodeName})`),
		(await vscode.debug.startDebugging(void 0, v)) ||
			((await vscode.window.showErrorMessage(
				`VS Code refused to start the ${m} debugger for PID ${f.processId}. Possible causes: the process exited, the C# extension did not activate, or another extension claimed the debug type. Check the Service Fabric output channel for details.`,
				'Open Output Channel',
			)) === 'Open Output Channel' &&
				t.outputChannel.show(!0)));
}

async function ensureDebuggerAvailable(e, t) {
	if (vscode.workspace.getConfiguration('serviceFabric').get('debug.suppressInstallPrompt') === !0) return !0;
	let n = checkAvailability(e, {
		platform: process.platform,
		isExtensionInstalled: (l) => !!vscode.extensions.getExtension(l),
	});
	if (n.kind === 'available') return !0;
	if (n.kind === 'platform-blocked') return (await vscode.window.showErrorMessage(formatPlatformBlockedMessage(e, n.reason)), !1);
	let i = n.requirement,
		o = formatExtensionMissingMessage(e, i),
		s = await vscode.window.showErrorMessage(
			o,
			{
				modal: !0,
			},
			INSTALL_BUTTON_LABEL,
			MARKETPLACE_BUTTON_LABEL,
			CANCEL_BUTTON_LABEL,
		),
		a = classifyInstallPromptResult(s);
	return a === 'cancel'
		? !1
		: a === 'marketplace'
			? (await vscode.commands.executeCommand('workbench.extensions.search', `@id:${i.extensionId}`), !1)
			: (await installExtensionWithProgress(i.extensionId, t),
				(await waitForExtensionInstalled(i.extensionId))
					? (i.additionalAdvice && vscode.window.showInformationMessage(i.additionalAdvice), !0)
					: (vscode.window.showErrorMessage(
							`Install of ${i.extensionId} did not complete. Open the Extensions view and install it manually, then re-run Attach Debugger to Deployed Service\u2026`,
						),
						!1));
}

async function installExtensionWithProgress(e, t) {
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Installing ${e}\u2026`,
			cancellable: !1,
		},
		async () => {
			try {
				(await vscode.commands.executeCommand('workbench.extensions.installExtension', e), t.info(`Installed extension ${e}`));
			} catch (r) {
				t.error(`Failed to install ${e}: ${r instanceof Error ? r.message : String(r)}`);
			}
		},
	);
}

async function waitForExtensionInstalled(e) {
	let t = Date.now() + EXTENSION_INSTALL_TIMEOUT_MS;
	for (; Date.now() < t;) {
		if (vscode.extensions.getExtension(e)) return !0;
		await new Promise((r) => setTimeout(r, EXTENSION_INSTALL_POLL_MS));
	}
	return !!vscode.extensions.getExtension(e);
}

function pickCodePackage(e) {
	return vscode.window
		.showQuickPick(
			e.map((t) => ({
				label: `$(debug-alt) ${t.serviceManifestName} / ${t.codePackageName}`,
				description: `pid ${t.processId} \u2022 ${t.nodeName}`,
				detail: `${t.hostType || 'host'} \u2022 v${t.codePackageVersion} \u2022 ${t.entryPointStatus}`,
				pkg: t,
			})),
			{
				placeHolder: 'Select the code package replica to attach to',
			},
		)
		.then((t) => t?.pkg);
}

function pickAttachRuntime() {
	return vscode.window
		.showQuickPick(
			[
				{
					label: '.NET (coreclr)',
					description: 'Modern .NET / .NET Core. Requires C# extension.',
					value: 'coreclr',
				},
				{
					label: '.NET Framework (clr)',
					description: 'Windows-only legacy CLR. Requires Visual Studio for Windows debugger or compatible.',
					value: 'clr',
				},
			],
			{
				placeHolder: 'Select the runtime to attach (Service Fabric services typically use coreclr)',
			},
		)
		.then((e) => e?.value);
}

let EXTENSION_INSTALL_POLL_MS, EXTENSION_INSTALL_TIMEOUT_MS, ServiceFabricDebugConfigurationProvider;

EXTENSION_INSTALL_POLL_MS = 200;

EXTENSION_INSTALL_TIMEOUT_MS = 5e3;

ServiceFabricDebugConfigurationProvider = class {
	constructor(t) {
		this.store = t;
	}
	provideDebugConfigurations() {
		return [
			{
				type: 'servicefabric',
				request: 'attach',
				name: 'Service Fabric: Attach to Deployed Service',
				runtime: 'coreclr',
			},
		];
	}
	async resolveDebugConfiguration(t, r) {
		if (r.type !== 'servicefabric') return r;
		if (!this.store.getActive()?.connected) {
			(await vscode.window.showWarningMessage(
				'No Service Fabric cluster is connected. Connect first?',
				'Connect Local Cluster',
				'Cancel',
			)) === 'Connect Local Cluster' && (await vscode.commands.executeCommand('serviceFabric.cluster.connectLocal'));
			return;
		}
		await vscode.commands.executeCommand('serviceFabric.debug.attachToService');
	}
};

export { ServiceFabricDebugConfigurationProvider, attachToDeployedService, ensureDebuggerAvailable };
