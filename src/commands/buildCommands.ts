// @ts-nocheck
import * as vscode from 'vscode';
import { ensureNugetRestored } from '../build/nugetRestore';
import { createSfBuildTask } from '../build/sfTaskProvider';

async function resolveTargetProject(e, t) {
	if (t) {
		let i = t.project ? t.project.sfproj.path : (t.resourceUri?.fsPath ?? (t instanceof vscode.Uri ? t.fsPath : void 0));
		if (i) {
			let o = e.getProjectByPath(i);
			if (o) return o;
			let s = e.getProjects().find((a) => i.toLowerCase().startsWith(a.sfproj.directory.toLowerCase()));
			if (s) return s;
		}
	}
	let r = e.getProjects();
	if (r.length === 0) {
		vscode.window.showInformationMessage('No Service Fabric projects in this workspace.');
		return;
	}
	return r.length === 1
		? r[0]
		: (
				await vscode.window.showQuickPick(
					r.map((i) => ({
						label: i.applicationManifest?.applicationTypeName ?? i.sfproj.path,
						description: i.sfproj.path,
						project: i,
					})),
					{
						placeHolder: 'Select a Service Fabric application project',
					},
				)
			)?.project;
}

async function runBuildTarget(e, t, r, n) {
	let i = await resolveTargetProject(e, n);
	if (!i) return;
	let o = t.outputChannel,
		s = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Restoring NuGet packages for ${i.sfproj.path}\u2026`,
			},
			(c) =>
				ensureNugetRestored(i.sfproj.path, {
					output: o,
					progress: c,
				}),
		);
	if (!s.ok) {
		(t.error(`NuGet restore failed (${s.strategy}): ${s.message ?? 'no details'}`),
			await vscode.window.showErrorMessage(`Service Fabric: NuGet restore failed. ${s.message ?? ''}`, {
				modal: !0,
			}));
		return;
	}
	(s.strategy !== 'skipped' ? t.info(`NuGet restore succeeded via ${s.strategy}.`) : t.debug('NuGet restore skipped (already up to date).'),
		t.info(`Running ${r} on ${i.sfproj.path}`));
	let a = await createSfBuildTask(i.sfproj.path, r);
	await vscode.tasks.executeTask(a);
}

export { resolveTargetProject, runBuildTarget };
