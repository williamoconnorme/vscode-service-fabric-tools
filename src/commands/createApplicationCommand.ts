// @ts-nocheck
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { pickServiceKind } from './addServiceCommand';
import { isAspNetKind, isCsharpKind } from '../scaffold/addServiceTemplates';
import { applyCreateApplication } from '../scaffold/createApplicationApply';
import { newProjectGuid } from '../scaffold/createApplicationTemplates';
import { ensureNugetRestored } from '../build/nugetRestore';

async function runCreateApplicationCommand(e) {
	let t = vscode.workspace.workspaceFolders;
	if (!t || t.length === 0) {
		vscode.window.showErrorMessage('Open a folder before creating a Service Fabric application.');
		return;
	}
	let r =
		t.length === 1
			? t[0]
			: await vscode.window.showWorkspaceFolderPick({
					placeHolder: 'Select a workspace folder',
				});
	if (!r) return;
	let n = await vscode.window.showInputBox({
		prompt: 'Application type name',
		value: 'MyApp',
		validateInput: (d) => (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(d) ? null : 'Use letters, digits, dot, dash or underscore.'),
	});
	if (!n) return;
	let i = await vscode.window.showInputBox({
		prompt: 'Initial service name',
		value: `${n}.Service1`,
		validateInput: (d) => (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(d) ? null : 'Use letters, digits, dot, dash or underscore.'),
	});
	if (!i) return;
	let o = await pickServiceKind();
	if (!o) return;
	let { kind: s, runtime: a } = o,
		c;
	if (isCsharpKind(s)) {
		let d =
				isAspNetKind(s) || a === 'netcore'
					? [
							{
								label: 'net8.0',
								description: 'Recommended (LTS)',
								value: 'net8.0',
							},
							{
								label: 'net6.0',
								description: 'LTS',
								value: 'net6.0',
							},
						]
					: [
							{
								label: 'net472',
								description: '.NET Framework 4.7.2 (classic Service Fabric SDK)',
								value: 'net472',
							},
							{
								label: 'net48',
								description: '.NET Framework 4.8',
								value: 'net48',
							},
						],
			f = await vscode.window.showQuickPick(d, {
				placeHolder: 'Target framework for the seeded service',
			});
		if (!f) return;
		c = f.value;
	}
	let l = path.join(r.uri.fsPath, n);
	if (fs.existsSync(l)) {
		vscode.window.showErrorMessage(`Folder already exists: ${l}`);
		return;
	}
	if (isCsharpKind(s)) {
		let d = path.join(r.uri.fsPath, i);
		if (fs.existsSync(d)) {
			vscode.window.showErrorMessage(
				`Cannot create the application: a folder named '${i}' already exists next to the new application directory (${d}). Choose a different service name or remove the folder first.`,
			);
			return;
		}
	}
	let u;
	try {
		u = applyCreateApplication({
			targetDirectory: l,
			applicationName: n,
			serviceName: i,
			projectGuid: newProjectGuid(),
			kind: s,
			runtime: a,
			targetFramework: c,
		});
	} catch (d) {
		let f = d instanceof Error ? d.message : String(d);
		(e.error(`Create Application failed: ${f}`), vscode.window.showErrorMessage(`Create Application failed: ${f}`));
		return;
	}
	if ((e.info(`Scaffolded application at ${l}`), vscode.workspace.getConfiguration('serviceFabric').get('scaffoldAutoRestore', !0)))
		try {
			let d = await ensureNugetRestored(u.sfprojPath, {
				output: e.outputChannel,
			});
			d.ok && d.strategy !== 'skipped'
				? e.info(`Auto-restore succeeded via ${d.strategy}.`)
				: d.ok || e.warn(`Auto-restore failed: ${d.message ?? 'no details'}. Run 'Service Fabric: Restore NuGet Packages' to retry.`);
		} catch (d) {
			e.warn(`Auto-restore threw: ${d instanceof Error ? d.message : String(d)}`);
		}
	let p = await vscode.window.showInformationMessage(`Created '${n}'.`, 'Open .sfproj', 'Reveal');
	if (p === 'Open .sfproj') {
		let d = await vscode.workspace.openTextDocument(u.sfprojPath);
		await vscode.window.showTextDocument(d);
	} else p === 'Reveal' && (await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(l)));
}

export { runCreateApplicationCommand };
