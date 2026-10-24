import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { Logger } from '../util/logger';
import { pickServiceKind } from './addServiceCommand';
import { isAspNetKind, isCsharpKind } from '../scaffold/addServiceTemplates';
import { applyCreateApplication, type CreateApplicationResult } from '../scaffold/createApplicationApply';
import { newProjectGuid } from '../scaffold/createApplicationTemplates';
import { ensureNugetRestored } from '../build/nugetRestore';

interface FrameworkQuickPickItem extends vscode.QuickPickItem {
	value: string;
}

/**
 * `serviceFabric.createApplication`: scaffolds a new Service Fabric application
 * (plus one seeded service) in a workspace folder.
 */
export async function runCreateApplicationCommand(logger: Logger): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		vscode.window.showErrorMessage('Open a folder before creating a Service Fabric application.');
		return;
	}
	const folder =
		folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select a workspace folder' });
	if (!folder) return;
	const applicationName = await vscode.window.showInputBox({
		prompt: 'Application type name',
		value: 'MyApp',
		validateInput: (value) => (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) ? null : 'Use letters, digits, dot, dash or underscore.'),
	});
	if (!applicationName) return;
	const serviceName = await vscode.window.showInputBox({
		prompt: 'Initial service name',
		value: `${applicationName}.Service1`,
		validateInput: (value) => (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) ? null : 'Use letters, digits, dot, dash or underscore.'),
	});
	if (!serviceName) return;
	const choice = await pickServiceKind();
	if (!choice) return;
	const { kind, runtime } = choice;
	let targetFramework: string | undefined;
	if (isCsharpKind(kind)) {
		const frameworks: FrameworkQuickPickItem[] =
			isAspNetKind(kind) || runtime === 'netcore'
				? [
						{ label: 'net10.0', description: 'Recommended (current LTS, until Nov 2028)', value: 'net10.0' },
						{ label: 'net8.0', description: 'LTS (until Nov 2026)', value: 'net8.0' },
					]
				: [
						{ label: 'net472', description: '.NET Framework 4.7.2 (classic Service Fabric SDK)', value: 'net472' },
						{ label: 'net48', description: '.NET Framework 4.8', value: 'net48' },
					];
		const framework = await vscode.window.showQuickPick(frameworks, { placeHolder: 'Target framework for the seeded service' });
		if (!framework) return;
		targetFramework = framework.value;
	}
	const targetDirectory = path.join(folder.uri.fsPath, applicationName);
	if (fs.existsSync(targetDirectory)) {
		vscode.window.showErrorMessage(`Folder already exists: ${targetDirectory}`);
		return;
	}
	if (isCsharpKind(kind)) {
		const serviceDir = path.join(folder.uri.fsPath, serviceName);
		if (fs.existsSync(serviceDir)) {
			vscode.window.showErrorMessage(
				`Cannot create the application: a folder named '${serviceName}' already exists next to the new application directory (${serviceDir}). Choose a different service name or remove the folder first.`,
			);
			return;
		}
	}
	let result: CreateApplicationResult;
	try {
		result = applyCreateApplication({
			targetDirectory,
			applicationName,
			serviceName,
			projectGuid: newProjectGuid(),
			kind,
			runtime,
			targetFramework,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Create Application failed: ${message}`);
		vscode.window.showErrorMessage(`Create Application failed: ${message}`);
		return;
	}
	logger.info(`Scaffolded application at ${targetDirectory}`);
	if (vscode.workspace.getConfiguration('serviceFabric').get('scaffoldAutoRestore', true)) {
		try {
			const restore = await ensureNugetRestored(result.sfprojPath, { output: logger.outputChannel });
			if (restore.ok && restore.strategy !== 'skipped') {
				logger.info(`Auto-restore succeeded via ${restore.strategy}.`);
			} else if (!restore.ok) {
				logger.warn(`Auto-restore failed: ${restore.message ?? 'no details'}. Run 'Service Fabric: Restore NuGet Packages' to retry.`);
			}
		} catch (err) {
			logger.warn(`Auto-restore threw: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	const picked = await vscode.window.showInformationMessage(`Created '${applicationName}'.`, 'Open .sfproj', 'Reveal');
	if (picked === 'Open .sfproj') {
		const doc = await vscode.workspace.openTextDocument(result.sfprojPath);
		await vscode.window.showTextDocument(doc);
	} else if (picked === 'Reveal') {
		await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(targetDirectory));
	}
}
