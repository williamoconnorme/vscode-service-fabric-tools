import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { ApplicationProject } from '../project/sfprojModel';
import type { Logger } from '../util/logger';
import { addActorUnixFix, isNetFrameworkTfm, needsActorUnixFix, targetFrameworksOf } from './serviceProjects';

/**
 * Before Build / Package / Publish: checks the application's service projects
 * can be built on this machine. Off Windows, .NET Framework projects stop the
 * build with an explanation, and actor projects without the FabActUtil fix
 * get it added (after asking). Returns `false` to abort.
 */
export async function preflightServiceProjects(project: ApplicationProject, logger: Logger): Promise<boolean> {
	if (process.platform === 'win32') return true;
	const netfx: string[] = [];
	const actorsToFix: { file: string; xml: string }[] = [];
	for (const csproj of project.sfproj.projectReferences.filter((p) => /\.csproj$/i.test(p))) {
		let xml: string;
		try {
			xml = await fsp.readFile(csproj, 'utf8');
		} catch {
			continue;
		}
		const frameworks = targetFrameworksOf(xml);
		if (frameworks.length > 0 && frameworks.every(isNetFrameworkTfm)) netfx.push(`${path.basename(csproj)} (${frameworks.join(', ')})`);
		else if (needsActorUnixFix(xml)) actorsToFix.push({ file: csproj, xml });
	}
	if (netfx.length > 0) {
		const message = `.NET Framework services can only be built on Windows: ${netfx.join(', ')}. Build this application on Windows, or move these services to .NET (net8.0 or later).`;
		logger.error(message);
		vscode.window.showErrorMessage(message, { modal: true });
		return false;
	}
	if (actorsToFix.length === 0) return true;
	const names = actorsToFix.map((a) => path.basename(a.file)).join(', ');
	const choice = await vscode.window.showWarningMessage(
		`Actor services don't build on ${process.platform === 'darwin' ? 'macOS' : 'Linux'} as generated: ${names}.`,
		{
			modal: true,
			detail:
				"The Service Fabric Actors build targets write FabActUtil.runtimeconfig.json with a Windows-only command, so generating the actor service manifest fails. Add a small MSBuild target to the project that writes the file correctly? It does nothing on Windows.",
		},
		'Fix and Continue',
		'Continue Without Fixing',
	);
	if (choice === undefined) return false;
	if (choice === 'Fix and Continue') {
		for (const { file, xml } of actorsToFix) {
			await fsp.writeFile(file, addActorUnixFix(xml), 'utf8');
			logger.info(`Added the FabActUtil macOS / Linux fix to ${file}.`);
		}
	}
	return true;
}
