import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { applyAddService, collectExistingServiceNames } from '../scaffold/addServiceApply';
import {
	isAspNetKind,
	isCsharpKind,
	type AddServiceTemplate,
	type ServiceKind,
	type ServiceRuntime,
} from '../scaffold/addServiceTemplates';
import { ensureNugetRestored } from '../build/nugetRestore';
import type { ApplicationProject } from '../project/sfprojModel';
import type { SfProjectWatcher } from '../project/projectWatcher';
import type { Logger } from '../util/logger';
import type { CommandTarget } from './commandTarget';

/** A service kind + runtime pair selected in {@link pickServiceKind}. */
export interface ServiceKindChoice {
	kind: ServiceKind;
	runtime: ServiceRuntime;
}

interface ValueQuickPickItem<T extends string> extends vscode.QuickPickItem {
	value: T;
}

/** `serviceFabric.addService`: adds a new service package to an existing application. */
export async function runAddServiceCommand(projects: SfProjectWatcher, logger: Logger, target?: CommandTarget): Promise<void> {
	const candidates = projects.getProjects();
	if (candidates.length === 0) {
		vscode.window.showErrorMessage('No Service Fabric application projects (.sfproj) are open. Add Service requires an existing project.');
		return;
	}
	const project = await pickProjectForAddService(candidates, target);
	if (!project) return;
	if (!project.applicationManifest) {
		vscode.window.showErrorMessage(`Cannot add a service: ${path.basename(project.sfproj.path)} has no readable ApplicationManifest.xml.`);
		return;
	}
	const choice = await pickServiceKind();
	if (!choice) return;
	const { kind, runtime } = choice;
	const existing = collectExistingServiceNames(project);
	const serviceName = await promptServiceName(project, existing);
	if (!serviceName) return;
	const serviceTypeName = await vscode.window.showInputBox({
		prompt: 'Service type name',
		value: `${serviceName}Type`,
		validateInput: (value) => (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) ? null : 'Use letters, digits, dot, dash or underscore.'),
	});
	if (!serviceTypeName) return;
	const version = await vscode.window.showInputBox({
		prompt: 'Initial package version',
		value: '1.0.0',
		validateInput: (value) => (/^\d+\.\d+\.\d+(\.\d+)?$/.test(value) ? null : 'Use a valid version like 1.0.0.'),
	});
	if (!version) return;
	let template: AddServiceTemplate = { serviceName, serviceTypeName, kind, runtime, version };
	let guestSourcePath: string | undefined;
	if (kind === 'guest') {
		guestSourcePath = await pickGuestPayload();
		if (!guestSourcePath) return;
		const args = await vscode.window.showInputBox({
			prompt: 'Optional command-line arguments for the guest executable (leave blank for none)',
			value: '',
		});
		if (args === undefined) return;
		if (args.trim() !== '') {
			template = { ...template, guestArguments: args.trim() };
		}
	} else if (isCsharpKind(kind)) {
		const frameworks: ValueQuickPickItem<string>[] =
			isAspNetKind(kind) || runtime === 'netcore'
				? [
						{ label: 'net10.0', description: 'Recommended (current LTS, until Nov 2028)', value: 'net10.0' },
						{ label: 'net9.0', description: 'STS — reaches end-of-support May 12, 2026', value: 'net9.0' },
						{ label: 'net8.0', description: 'LTS (until Nov 2026)', value: 'net8.0' },
					]
				: [
						{ label: 'net472', description: '.NET Framework 4.7.2 (classic Service Fabric SDK)', value: 'net472' },
						{ label: 'net48', description: '.NET Framework 4.8', value: 'net48' },
					];
		const framework = await vscode.window.showQuickPick(frameworks, {
			placeHolder: 'Target framework for the generated C# project',
		});
		if (!framework) return;
		template = { ...template, targetFramework: framework.value };
		if (isAspNetKind(kind)) {
			const https = await promptHttpsEndpoint();
			if (https === 'cancel') return;
			if (https) {
				const port = await vscode.window.showInputBox({
					prompt: 'HTTPS port (Kestrel listen port for the https endpoint)',
					value: '8443',
					validateInput: (value) => (/^[1-9]\d{2,4}$/.test(value) && +value <= 65535 ? null : 'Use a valid TCP port (1–65535).'),
				});
				if (port === undefined) return;
				template = { ...template, httpsEndpoint: { port: parseInt(port, 10) } };
			}
		}
		const sfprojDir = path.dirname(project.sfproj.path);
		const repoDir = path.dirname(sfprojDir);
		const csprojDir = path.join(repoDir, serviceName);
		if (fs.existsSync(csprojDir)) {
			vscode.window.showErrorMessage(
				`Cannot scaffold the C# project: a folder named '${serviceName}' already exists next to the .sfproj (${csprojDir}). Choose a different service name or remove the folder first.`,
			);
			return;
		}
	}
	try {
		const result = await applyAddService(project, template, { guestSourcePath });
		const summary = formatAddServiceSummary(kind, serviceName, project, result.csprojPath, result.guestExePath);
		logger.info(summary);
		if (isCsharpKind(kind) && vscode.workspace.getConfiguration('serviceFabric').get('scaffoldAutoRestore', true)) {
			try {
				const restore = await ensureNugetRestored(project.sfproj.path, { output: logger.outputChannel });
				if (restore.ok && restore.strategy !== 'skipped') {
					logger.info(`Auto-restore succeeded via ${restore.strategy}.`);
				} else if (!restore.ok) {
					logger.warn(`Auto-restore failed: ${restore.message ?? 'no details'}. Run 'Service Fabric: Restore NuGet Packages' to retry.`);
				}
			} catch (err) {
				logger.warn(`Auto-restore threw: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		const actions = ['Open ServiceManifest.xml', 'Open ApplicationManifest.xml'];
		if (result.csprojPath) actions.unshift('Open generated .csproj');
		const picked = await vscode.window.showInformationMessage(summary, ...actions);
		if (picked === 'Open ServiceManifest.xml') {
			await openFileInEditor(result.serviceManifestPath);
		} else if (picked === 'Open ApplicationManifest.xml') {
			await openFileInEditor(project.applicationManifest.path);
		} else if (picked === 'Open generated .csproj' && result.csprojPath) {
			await openFileInEditor(result.csprojPath);
		}
		if (template.httpsEndpoint && isAspNetKind(kind)) {
			await offerDevCertTrust();
		}
	} catch (err) {
		const message = (err as Error).message;
		logger.error(`Add Service failed: ${message}`);
		vscode.window.showErrorMessage(`Add Service failed: ${message}`);
	}
}

async function pickProjectForAddService(
	projects: ApplicationProject[],
	target: CommandTarget | undefined,
): Promise<ApplicationProject | undefined> {
	if (target?.resource) {
		const wanted = target.resource.fsPath.toLowerCase();
		const match = projects.find((p) => p.sfproj.path.toLowerCase() === wanted);
		if (match) return match;
	}
	if (projects.length === 1) return projects[0];
	const items = projects.map((p) => ({
		label: path.basename(p.sfproj.path),
		description: p.applicationManifest?.applicationTypeName,
		detail: p.sfproj.path,
		project: p,
	}));
	return (
		await vscode.window.showQuickPick(items, {
			placeHolder: 'Select the Service Fabric application to add a service to',
		})
	)?.project;
}

/**
 * Shows the grouped service-kind picker shared by Add Service and Create
 * Application. Resolves to `undefined` when the user dismisses it.
 */
export async function pickServiceKind(): Promise<ServiceKindChoice | undefined> {
	const items: (vscode.QuickPickItem & { choice?: ServiceKindChoice })[] = [
		{ kind: vscode.QuickPickItemKind.Separator, label: '.NET Core' },
		{
			label: 'Stateless Service',
			description: 'Reliable Stateless service (.NET Core)',
			detail: 'Generates a Reliable Stateless service host + .csproj + ProjectReference.',
			choice: { kind: 'stateless', runtime: 'netcore' },
		},
		{
			label: 'Stateful Service',
			description: 'Reliable Stateful service with persistent internal state (.NET Core)',
			detail: 'Generates a Reliable Stateful service host that demos a reliable dictionary.',
			choice: { kind: 'stateful', runtime: 'netcore' },
		},
		{
			label: 'Actor Service',
			description: 'Virtual-actor pattern (.NET Core)',
			detail: 'Generates an actor + actor interface + ActorRuntime registration.',
			choice: { kind: 'actor', runtime: 'netcore' },
		},
		{
			label: 'Stateless ASP.NET Core',
			description: 'Stateless service hosting an ASP.NET Core pipeline (Kestrel + controllers)',
			detail: 'Generates a stateless service + Controllers/ValuesController.cs + appsettings.json.',
			choice: { kind: 'aspNetStateless', runtime: 'netcore' },
		},
		{
			label: 'Stateful ASP.NET Core',
			description: 'Stateful service hosting an ASP.NET Core pipeline with reliable collections',
			detail: 'Generates a stateful service + Controllers/ValuesController.cs + appsettings.json.',
			choice: { kind: 'aspNetStateful', runtime: 'netcore' },
		},
		{ kind: vscode.QuickPickItemKind.Separator, label: '.NET Framework' },
		{
			label: 'Stateless Service',
			description: 'Reliable Stateless service (.NET Framework)',
			detail: 'SDK-style csproj targeting net472.',
			choice: { kind: 'stateless', runtime: 'netfx' },
		},
		{
			label: 'Stateful Service',
			description: 'Reliable Stateful service (.NET Framework)',
			detail: 'SDK-style csproj targeting net472, demos a reliable dictionary.',
			choice: { kind: 'stateful', runtime: 'netfx' },
		},
		{
			label: 'Actor Service',
			description: 'Virtual-actor pattern (.NET Framework)',
			detail: 'SDK-style csproj targeting net472 with the ActorRuntime registration.',
			choice: { kind: 'actor', runtime: 'netfx' },
		},
		{ kind: vscode.QuickPickItemKind.Separator, label: 'Hosted Containers and Applications' },
		{
			label: 'Guest Executable',
			description: 'Wraps an existing binary as a Service Fabric guest exe',
			detail: 'No code generated; copies the supplied binary or folder into Code/.',
			choice: { kind: 'guest', runtime: 'netcore' },
		},
	];
	return (
		await vscode.window.showQuickPick(items, {
			placeHolder: 'Choose the service kind',
			matchOnDescription: true,
			matchOnDetail: true,
		})
	)?.choice;
}

async function promptServiceName(project: ApplicationProject, existing: Set<string>): Promise<string | undefined> {
	const suggested = `${(project.applicationManifest?.applicationTypeName ?? 'MyApp').replace(/Type$/, '')}.Service${existing.size + 1}`;
	return vscode.window.showInputBox({
		prompt: 'Service name (also used as the package folder and, for C# kinds, the .csproj name)',
		value: suggested,
		validateInput: (value) =>
			/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)
				? existing.has(value.toLowerCase())
					? `A service named '${value}' already exists in this application.`
					: existing.has(`${value.toLowerCase()}pkg`)
						? `A service package '${value}Pkg' already exists.`
						: null
				: 'Use letters, digits, dot, dash or underscore (must start with a letter).',
	});
}

/** Asks for the guest payload (single file or folder); resolves to its path. */
async function pickGuestPayload(): Promise<string | undefined> {
	const mode = await vscode.window.showQuickPick<ValueQuickPickItem<'file' | 'folder'>>(
		[
			{ label: 'Pick a single executable', description: 'Recommended for self-contained binaries.', value: 'file' },
			{
				label: 'Pick a folder of payload files',
				description: "Copies the entire folder contents into the service's Code/.",
				value: 'folder',
			},
		],
		{ placeHolder: 'How should the guest payload be staged?' },
	);
	if (!mode) return undefined;
	return (
		await vscode.window.showOpenDialog({
			canSelectFiles: mode.value === 'file',
			canSelectFolders: mode.value === 'folder',
			canSelectMany: false,
			openLabel: mode.value === 'file' ? 'Use this executable' : 'Use this folder',
			title: mode.value === 'file' ? 'Select the guest executable' : 'Select the payload folder',
		})
	)?.[0]?.fsPath;
}

function formatAddServiceSummary(
	kind: ServiceKind,
	serviceName: string,
	project: ApplicationProject,
	csprojPath: string | undefined,
	guestExePath: string | undefined,
): string {
	const sfprojName = path.basename(project.sfproj.path);
	if (kind === 'guest') {
		return (
			`Added guest service '${serviceName}' to ${sfprojName}` +
			(guestExePath ? ` (staged ${path.basename(guestExePath)} into Code/)` : '') +
			'.'
		);
	}
	return csprojPath
		? `Added ${kind} service '${serviceName}' to ${sfprojName}; generated ${path.basename(csprojPath)} and added a ProjectReference.`
		: `Added ${kind} service '${serviceName}' to ${sfprojName}.`;
}

async function openFileInEditor(filePath: string): Promise<void> {
	const doc = await vscode.workspace.openTextDocument(filePath);
	await vscode.window.showTextDocument(doc, { preview: false });
}

/**
 * Asks whether to add an HTTPS endpoint. Resolves to `'cancel'` when dismissed,
 * `{}` for "yes" (the port is prompted separately), `undefined` for "no".
 */
async function promptHttpsEndpoint(): Promise<'cancel' | {} | undefined> {
	const picked = await vscode.window.showQuickPick<ValueQuickPickItem<'no' | 'yes'>>(
		[
			{ label: 'No (HTTP only)', description: 'Default. Kestrel binds http://+:<port>.', value: 'no' },
			{ label: 'Yes (HTTP + HTTPS)', description: 'Adds a second https endpoint and binds Kestrel to both.', value: 'yes' },
		],
		{ placeHolder: 'Generate an HTTPS endpoint in addition to HTTP?', matchOnDescription: true },
	);
	if (!picked) return 'cancel';
	if (picked.value !== 'no') return {};
	return undefined;
}

/** Offers to run `serviceFabric.devCert.trust` after scaffolding an HTTPS endpoint. */
async function offerDevCertTrust(): Promise<void> {
	const config = vscode.workspace.getConfiguration();
	const suppressKey = 'serviceFabric.scaffold.suppressDevCertPrompt';
	if (config.get(suppressKey, false)) return;
	const yes = 'Yes';
	const later = 'No (I will run it later)';
	const never = "Don't ask again";
	const picked = await vscode.window.showInformationMessage(
		'The scaffolded service requires the ASP.NET Core HTTPS development certificate to start its HTTPS endpoint. Trust it now?',
		yes,
		later,
		never,
	);
	if (picked === yes) {
		await vscode.commands.executeCommand('serviceFabric.devCert.trust');
	} else if (picked === never) {
		await config.update(suppressKey, true, vscode.ConfigurationTarget.Workspace);
	}
}
