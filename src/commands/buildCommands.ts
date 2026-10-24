import * as vscode from 'vscode';
import { ensureNugetRestored } from '../build/nugetRestore';
import { createSfBuildTask } from '../build/sfTaskProvider';
import type { ApplicationProject } from '../project/sfprojModel';
import type { Logger } from '../util/logger';

/** The parts of the project watcher used to resolve a command's target project. */
export interface ProjectLookup {
	getProjects(): ApplicationProject[];
	getProjectByPath(sfprojPath: string): ApplicationProject | undefined;
}

/**
 * What a command was invoked on: a tree item carrying a project, an explorer
 * resource (`resourceUri`), or a plain `Uri` from the explorer context menu.
 */
export type ProjectCommandTarget = vscode.Uri | { project?: ApplicationProject; resourceUri?: vscode.Uri };

/**
 * Resolves the project a command applies to: the invocation target when it is
 * (or lies inside) a known project, else the only project, else a QuickPick.
 * Returns `undefined` if there are no projects or the user dismisses the pick.
 */
export async function resolveTargetProject(watcher: ProjectLookup, target?: ProjectCommandTarget): Promise<ApplicationProject | undefined> {
	if (target) {
		const hint = target as { project?: ApplicationProject; resourceUri?: vscode.Uri };
		const targetPath = hint.project
			? hint.project.sfproj.path
			: (hint.resourceUri?.fsPath ?? (target instanceof vscode.Uri ? target.fsPath : undefined));
		if (targetPath) {
			const exact = watcher.getProjectByPath(targetPath);
			if (exact) return exact;
			const containing = watcher.getProjects().find((p) => targetPath.toLowerCase().startsWith(p.sfproj.directory.toLowerCase()));
			if (containing) return containing;
		}
	}
	const projects = watcher.getProjects();
	if (projects.length === 0) {
		vscode.window.showInformationMessage('No Service Fabric projects in this workspace.');
		return undefined;
	}
	if (projects.length === 1) return projects[0];
	const picked = await vscode.window.showQuickPick(
		projects.map((p) => ({
			label: p.applicationManifest?.applicationTypeName ?? p.sfproj.path,
			description: p.sfproj.path,
			project: p,
		})),
		{ placeHolder: 'Select a Service Fabric application project' },
	);
	return picked?.project;
}

/**
 * `serviceFabric.build` / `rebuild` / `clean` / `package`: restores NuGet
 * packages (with progress), then runs the MSBuild `target` as a VS Code task.
 */
export async function runBuildTarget(
	watcher: ProjectLookup,
	logger: Logger,
	target: string,
	invokedOn?: ProjectCommandTarget,
): Promise<void> {
	const project = await resolveTargetProject(watcher, invokedOn);
	if (!project) return;
	const output = logger.outputChannel;
	const restore = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Restoring NuGet packages for ${project.sfproj.path}…`,
		},
		(progress) => ensureNugetRestored(project.sfproj.path, { output, progress }),
	);
	if (!restore.ok) {
		logger.error(`NuGet restore failed (${restore.strategy}): ${restore.message ?? 'no details'}`);
		await vscode.window.showErrorMessage(`Service Fabric: NuGet restore failed. ${restore.message ?? ''}`, { modal: true });
		return;
	}
	if (restore.strategy !== 'skipped') logger.info(`NuGet restore succeeded via ${restore.strategy}.`);
	else logger.debug('NuGet restore skipped (already up to date).');
	logger.info(`Running ${target} on ${project.sfproj.path}`);
	const task = await createSfBuildTask(project.sfproj.path, target);
	await vscode.tasks.executeTask(task);
}
