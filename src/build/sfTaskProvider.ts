import * as vscode from 'vscode';
import * as path from 'path';
import type { SfProjectWatcher } from '../project/projectWatcher';
import { locateMsBuild } from './msbuildLocator';

/** `tasks.json` definition for the `servicefabric` task type. */
export interface SfTaskDefinition extends vscode.TaskDefinition {
	type: string;
	/** Absolute or workspace-relative path to the .sfproj. */
	project: string;
	target: string;
	configuration?: string;
	platform?: string;
}

/** Provides Build/Rebuild/Clean/Package tasks for every Service Fabric project in the workspace. */
export class ServiceFabricTaskProvider implements vscode.TaskProvider {
	static type = 'servicefabric';

	constructor(private readonly watcher: SfProjectWatcher) {}

	async provideTasks(_token?: vscode.CancellationToken): Promise<vscode.Task[]> {
		const tasks: vscode.Task[] = [];
		for (const project of this.watcher.getProjects()) {
			for (const target of ['Build', 'Rebuild', 'Clean', 'Package']) {
				tasks.push(await createSfBuildTask(project.sfproj.path, target));
			}
		}
		return tasks;
	}

	async resolveTask(task: vscode.Task, _token?: vscode.CancellationToken): Promise<vscode.Task | undefined> {
		const definition = task.definition as SfTaskDefinition;
		if (definition.type !== ServiceFabricTaskProvider.type || !definition.project || !definition.target) return undefined;
		const projectPath = resolveProjectPath(definition.project);
		if (projectPath) {
			return createSfBuildTask(projectPath, definition.target, definition.configuration, definition.platform, task.scope);
		}
		return undefined;
	}
}

/** Resolves a task's `project` against the first workspace folder when it isn't absolute. */
function resolveProjectPath(project: string): string | undefined {
	if (path.isAbsolute(project)) return project;
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder) return path.join(folder.uri.fsPath, project);
	return undefined;
}

/** Builds a `vscode.Task` that runs MSBuild `target` on `sfprojPath`. */
export async function createSfBuildTask(
	sfprojPath: string,
	target: string,
	configuration = 'Debug',
	platform = 'x64',
	scope?: vscode.WorkspaceFolder | vscode.TaskScope,
): Promise<vscode.Task> {
	const msbuild = await locateMsBuild();
	// Command-line MSBuild (MSBuild.exe or `dotnet msbuild`) doesn't restore the service
	// projects' PackageReferences on its own (the Visual Studio IDE does); `-restore`
	// runs Restore over the project graph first.
	const restoreFirst = target !== 'Clean';
	const args = [
		...msbuild.leadingArgs,
		sfprojPath,
		...(restoreFirst ? ['-restore'] : []),
		`/t:${target}`,
		`/p:Configuration=${configuration}`,
		`/p:Platform=${platform}`,
		'/nologo',
		'/v:minimal',
	];
	const execution = new vscode.ProcessExecution(msbuild.executable, args);
	const definition: SfTaskDefinition = {
		type: ServiceFabricTaskProvider.type,
		project: sfprojPath,
		target,
		configuration,
		platform,
	};
	const task = new vscode.Task(
		definition,
		scope ?? vscode.TaskScope.Workspace,
		`${target} ${path.basename(sfprojPath)}`,
		'servicefabric',
		execution,
		['$msCompile'],
	);
	task.detail = `${msbuild.description}`;
	task.group =
		target === 'Build' || target === 'Rebuild'
			? vscode.TaskGroup.Build
			: target === 'Clean'
				? vscode.TaskGroup.Clean
				: vscode.TaskGroup.Build;
	task.presentationOptions = {
		echo: true,
		reveal: vscode.TaskRevealKind.Always,
		focus: false,
		panel: vscode.TaskPanelKind.Dedicated,
		clear: true,
	};
	return task;
}
