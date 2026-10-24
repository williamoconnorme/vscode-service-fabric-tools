import * as vscode from 'vscode';
import * as path from 'path';
import type { ApplicationProject } from '../project/sfprojModel';
import type { SfProjectWatcher } from '../project/projectWatcher';
import type { Logger } from '../util/logger';
import { applyRemoveService, findGeneratedCsproj, findServiceManifest } from '../scaffold/removeServiceApply';
import type { CommandTarget } from './commandTarget';

/** `serviceFabric.removeService`: removes a service package (and its generated C# project) from an application. */
export async function runRemoveServiceCommand(projects: SfProjectWatcher, logger: Logger, target?: CommandTarget): Promise<void> {
	const candidates = projects.getProjects();
	if (candidates.length === 0) {
		vscode.window.showErrorMessage(
			'No Service Fabric application projects (.sfproj) are open. Remove Service requires an existing project.',
		);
		return;
	}
	const project = await pickProjectForRemoveService(candidates, target);
	if (!project) return;
	if (!project.applicationManifest) {
		vscode.window.showErrorMessage(
			`Cannot remove a service: ${path.basename(project.sfproj.path)} has no readable ApplicationManifest.xml.`,
		);
		return;
	}
	if (project.serviceManifests.length === 0) {
		vscode.window.showInformationMessage(`${path.basename(project.sfproj.path)} has no service packages to remove.`);
		return;
	}
	const packageName = await pickServicePackageToRemove(project);
	if (!packageName) return;
	if (vscode.workspace.getConfiguration('serviceFabric').get<boolean>('confirmDestructiveActions') ?? true) {
		const detail = describeRemovalPlan(project, packageName);
		const confirmed = await vscode.window.showWarningMessage(
			`Remove service '${packageName}' from ${path.basename(project.sfproj.path)}?`,
			{ modal: true, detail },
			'Remove',
		);
		if (confirmed !== 'Remove') return;
	}
	try {
		const result = await applyRemoveService(project, packageName);
		const logLine = [
			`Removed '${result.packageName}'`,
			`${result.removedServiceBlocks} default service block(s)`,
			`${result.removedParameters.length} parameter(s)`,
			`${result.patchedParameterFiles.length} parameter file(s) updated`,
			result.patchedStartupServicesManifest ? 'StartupServices.xml patched' : null,
			result.patchedStartupParameterFiles.length > 0
				? `${result.patchedStartupParameterFiles.length} StartupServiceParameters file(s) updated`
				: null,
			result.removedCsprojPath ? `companion project ${path.basename(result.removedCsprojPath)} deleted` : null,
			result.removedProjectReference ? 'ProjectReference stripped from .sfproj' : null,
		]
			.filter(Boolean)
			.join('; ');
		logger.info(logLine);
		const message = result.removedCsprojPath
			? `Removed service '${result.packageName}' and companion project ${path.basename(result.removedCsprojPath)} from ${path.basename(project.sfproj.path)}.`
			: `Removed service '${result.packageName}' from ${path.basename(project.sfproj.path)}.`;
		if ((await vscode.window.showInformationMessage(message, 'Open ApplicationManifest.xml')) === 'Open ApplicationManifest.xml') {
			const doc = await vscode.workspace.openTextDocument(result.applicationManifestPath);
			await vscode.window.showTextDocument(doc, { preview: false });
		}
	} catch (err) {
		const message = (err as Error).message;
		logger.error(`Remove Service failed: ${message}`);
		vscode.window.showErrorMessage(`Remove Service failed: ${message}`);
	}
}

/** Builds the multi-line "what will change on disk" detail for the confirmation dialog. */
function describeRemovalPlan(project: ApplicationProject, packageName: string): string {
	const manifest = findServiceManifest(project, packageName);
	const lines: string[] = [];
	if (manifest) {
		lines.push(`Delete: ${manifest.packageDirectory}`);
		const generated = findGeneratedCsproj(project, manifest.packageDirectory);
		if (generated) {
			lines.push(`Delete: ${generated.csprojDirectory}`);
			lines.push(`Update: ${path.basename(project.sfproj.path)} (remove <ProjectReference>)`);
		}
	}
	if (project.applicationManifest) lines.push(`Update: ${path.basename(project.applicationManifest.path)}`);
	if (project.applicationParameters.length > 0) lines.push(`Update: ${project.applicationParameters.length} ApplicationParameters file(s)`);
	if (project.startupServicesManifest) lines.push(`Update: ${path.basename(project.startupServicesManifest)}`);
	if (project.startupServiceParameters.length > 0)
		lines.push(`Update: ${project.startupServiceParameters.length} StartupServiceParameters file(s)`);
	lines.push('The change is on disk only — you may need to redeploy.');
	return lines.join('\n');
}

async function pickProjectForRemoveService(
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
			placeHolder: 'Select the Service Fabric application to remove a service from',
		})
	)?.project;
}

async function pickServicePackageToRemove(project: ApplicationProject): Promise<string | undefined> {
	const items = project.serviceManifests.map((sm) => {
		const generated = findGeneratedCsproj(project, sm.packageDirectory);
		return {
			label: sm.name,
			description: generated ? `v${sm.version} \xB7 companion: ${path.basename(generated.csprojPath)}` : `v${sm.version}`,
			detail: sm.packageDirectory,
			value: sm.name,
		};
	});
	return (await vscode.window.showQuickPick(items, { placeHolder: 'Choose a service package to remove' }))?.value;
}
