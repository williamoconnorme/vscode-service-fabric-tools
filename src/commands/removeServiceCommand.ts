// @ts-nocheck
import * as vscode from 'vscode';
import * as path from 'path';
import { applyRemoveService, findGeneratedCsproj, findServiceManifest } from '../scaffold/removeServiceApply';

async function runRemoveServiceCommand(e, t, r) {
	let n = e.getProjects();
	if (n.length === 0) {
		vscode.window.showErrorMessage(
			'No Service Fabric application projects (.sfproj) are open. Remove Service requires an existing project.',
		);
		return;
	}
	let i = await pickProjectForRemoveService(n, r);
	if (!i) return;
	if (!i.applicationManifest) {
		vscode.window.showErrorMessage(`Cannot remove a service: ${path.basename(i.sfproj.path)} has no readable ApplicationManifest.xml.`);
		return;
	}
	if (i.serviceManifests.length === 0) {
		vscode.window.showInformationMessage(`${path.basename(i.sfproj.path)} has no service packages to remove.`);
		return;
	}
	let o = await pickServicePackageToRemove(i);
	if (!o) return;
	if (vscode.workspace.getConfiguration('serviceFabric').get('confirmDestructiveActions') ?? !0) {
		let c = describeRemovalPlan(i, o);
		if (
			(await vscode.window.showWarningMessage(
				`Remove service '${o}' from ${path.basename(i.sfproj.path)}?`,
				{
					modal: !0,
					detail: c,
				},
				'Remove',
			)) !== 'Remove'
		)
			return;
	}
	try {
		let c = await applyRemoveService(i, o),
			l = [
				`Removed '${c.packageName}'`,
				`${c.removedServiceBlocks} default service block(s)`,
				`${c.removedParameters.length} parameter(s)`,
				`${c.patchedParameterFiles.length} parameter file(s) updated`,
				c.patchedStartupServicesManifest ? 'StartupServices.xml patched' : null,
				c.patchedStartupParameterFiles.length > 0
					? `${c.patchedStartupParameterFiles.length} StartupServiceParameters file(s) updated`
					: null,
				c.removedCsprojPath ? `companion project ${path.basename(c.removedCsprojPath)} deleted` : null,
				c.removedProjectReference ? 'ProjectReference stripped from .sfproj' : null,
			]
				.filter(Boolean)
				.join('; ');
		t.info(l);
		let u = c.removedCsprojPath
			? `Removed service '${c.packageName}' and companion project ${path.basename(c.removedCsprojPath)} from ${path.basename(i.sfproj.path)}.`
			: `Removed service '${c.packageName}' from ${path.basename(i.sfproj.path)}.`;
		if ((await vscode.window.showInformationMessage(u, 'Open ApplicationManifest.xml')) === 'Open ApplicationManifest.xml') {
			let d = await vscode.workspace.openTextDocument(c.applicationManifestPath);
			await vscode.window.showTextDocument(d, {
				preview: !1,
			});
		}
	} catch (c) {
		let l = c.message;
		(t.error(`Remove Service failed: ${l}`), vscode.window.showErrorMessage(`Remove Service failed: ${l}`));
	}
}

function describeRemovalPlan(e, t) {
	let r = findServiceManifest(e, t),
		n = [];
	if (r) {
		n.push(`Delete: ${r.packageDirectory}`);
		let i = findGeneratedCsproj(e, r.packageDirectory);
		i && (n.push(`Delete: ${i.csprojDirectory}`), n.push(`Update: ${path.basename(e.sfproj.path)} (remove <ProjectReference>)`));
	}
	return (
		e.applicationManifest && n.push(`Update: ${path.basename(e.applicationManifest.path)}`),
		e.applicationParameters.length > 0 && n.push(`Update: ${e.applicationParameters.length} ApplicationParameters file(s)`),
		e.startupServicesManifest && n.push(`Update: ${path.basename(e.startupServicesManifest)}`),
		e.startupServiceParameters.length > 0 && n.push(`Update: ${e.startupServiceParameters.length} StartupServiceParameters file(s)`),
		n.push('The change is on disk only \u2014 you may need to redeploy.'),
		n.join(`
`)
	);
}

async function pickProjectForRemoveService(e, t) {
	if (t?.resource) {
		let i = t.resource.fsPath.toLowerCase(),
			o = e.find((s) => s.sfproj.path.toLowerCase() === i);
		if (o) return o;
	}
	if (e.length === 1) return e[0];
	let r = e.map((i) => ({
		label: path.basename(i.sfproj.path),
		description: i.applicationManifest?.applicationTypeName,
		detail: i.sfproj.path,
		project: i,
	}));
	return (
		await vscode.window.showQuickPick(r, {
			placeHolder: 'Select the Service Fabric application to remove a service from',
		})
	)?.project;
}

async function pickServicePackageToRemove(e) {
	let t = e.serviceManifests.map((n) => {
		let i = findGeneratedCsproj(e, n.packageDirectory);
		return {
			label: n.name,
			description: i ? `v${n.version} \xB7 companion: ${path.basename(i.csprojPath)}` : `v${n.version}`,
			detail: n.packageDirectory,
			value: n.name,
		};
	});
	return (
		await vscode.window.showQuickPick(t, {
			placeHolder: 'Choose a service package to remove',
		})
	)?.value;
}

export { runRemoveServiceCommand };
