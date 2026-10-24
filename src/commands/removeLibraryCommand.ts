// @ts-nocheck
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { applyRemoveLibrary } from '../scaffold/removeLibraryApply';
import { isServiceFabricServiceProject } from '../scaffold/addLibraryTemplates';

async function removeLibraryCommand(e, t, r) {
	let n = resolveTargetUri(r);
	if ((n ? path.extname(n.fsPath).toLowerCase() : '') === '.csproj' && n) {
		await removeLibraryFromCsproj(t, n.fsPath);
		return;
	}
	await removeLibraryFromApplication(e, t, n);
}

function resolveTargetUri(e) {
	if (e) return e instanceof vscode.Uri ? e : e.resource;
}

async function removeLibraryFromApplication(e, t, r) {
	let n = e.getProjects();
	if (n.length === 0) {
		vscode.window.showErrorMessage('No Service Fabric application projects (.sfproj) are open.');
		return;
	}
	let i = await pickApplicationProject(n, r);
	if (!i) return;
	let o = await discoverLibraries(i);
	if (o.length === 0) {
		vscode.window.showInformationMessage(
			'No library projects found in the workspace (a library is a non-service .csproj that is referenced by at least one service).',
		);
		return;
	}
	let s = o.map((d) => ({
			label: path.basename(d.libraryCsprojPath, '.csproj'),
			description: `${d.consumers.length} consumer(s)`,
			detail: d.libraryCsprojPath,
			library: d,
		})),
		a = await vscode.window.showQuickPick(s, {
			placeHolder: 'Select the library project to remove',
		});
	if (!a) return;
	let c = a.library.consumers.map((d) => ({
			label: path.basename(d, '.csproj'),
			description: d,
			consumer: d,
			picked: !0,
		})),
		l = await vscode.window.showQuickPick(c, {
			placeHolder: 'Pick which consumers should drop their reference (defaults to all)',
			canPickMany: !0,
		});
	if (l === void 0) return;
	let u = l.length === a.library.consumers.length,
		p = !1;
	if (u) {
		let d = await vscode.window.showWarningMessage(
			`All consumers will be unwired from '${path.basename(a.library.libraryCsprojPath)}'. Also delete the library folder from disk?`,
			{
				modal: !0,
			},
			'Unwire only',
			'Unwire and delete folder',
		);
		if (d === void 0) return;
		p = d === 'Unwire and delete folder';
	} else if (
		(await vscode.window.showInformationMessage(
			`Unwire ${l.length} of ${a.library.consumers.length} consumer(s) from '${path.basename(a.library.libraryCsprojPath)}'?`,
			{
				modal: !0,
			},
			'Unwire selected',
		)) !== 'Unwire selected'
	)
		return;
	try {
		let d = await applyRemoveLibrary({
			libraryCsprojPath: a.library.libraryCsprojPath,
			consumers: l.map((m) => m.consumer),
			deleteFolder: p,
		});
		t.info(
			`Removed library references from ${d.unwiredConsumers.length} consumer(s).` +
				(d.folderDeleted ? ` Library folder deleted: ${d.libraryDirectory}` : ''),
		);
		let f = d.folderDeleted ? ' Folder deleted.' : '';
		vscode.window.showInformationMessage(
			`Library '${path.basename(a.library.libraryCsprojPath, '.csproj')}' unwired from ${d.unwiredConsumers.length} consumer(s).${f}`,
		);
	} catch (d) {
		let f = d instanceof Error ? d.message : String(d);
		(t.error(`Remove Library Project failed: ${f}`), vscode.window.showErrorMessage(`Remove Library Project failed: ${f}`));
	}
}

async function removeLibraryFromCsproj(e, t) {
	if (!fs.existsSync(t)) {
		vscode.window.showErrorMessage(`csproj not found: ${t}`);
		return;
	}
	let r = fs.readFileSync(t, 'utf8');
	if (isServiceFabricServiceProject(r)) {
		vscode.window.showErrorMessage(
			`'${path.basename(t)}' is a Service Fabric service project. Use 'Service Fabric: Remove Service\u2026' instead.`,
		);
		return;
	}
	let n = await findLibraryConsumers(t);
	if (n.length === 0) {
		vscode.window.showInformationMessage(`No consumers reference '${path.basename(t)}' in the workspace.`);
		return;
	}
	let i = n.map((a) => ({
			label: path.basename(a, '.csproj'),
			description: a,
			consumer: a,
			picked: !0,
		})),
		o = await vscode.window.showQuickPick(i, {
			placeHolder: `Drop the reference to '${path.basename(t, '.csproj')}' from which consumer(s)?`,
			canPickMany: !0,
		});
	if (!(
		o === void 0 ||
		o.length === 0 ||
		(await vscode.window.showWarningMessage(
			`Unwire ${o.length} consumer(s) from '${path.basename(t)}'?`,
			{
				modal: !0,
			},
			'Unwire',
		)) !== 'Unwire'
	))
		try {
			let a = await applyRemoveLibrary({
				libraryCsprojPath: t,
				consumers: o.map((c) => c.consumer),
				deleteFolder: !1,
			});
			(e.info(`Unwired ${a.unwiredConsumers.length} consumer(s) from ${path.basename(t)}.`),
				vscode.window.showInformationMessage(
					`Library '${path.basename(t, '.csproj')}' unwired from ${a.unwiredConsumers.length} consumer(s).`,
				));
		} catch (a) {
			let c = a instanceof Error ? a.message : String(a);
			(e.error(`Remove Library Project failed: ${c}`), vscode.window.showErrorMessage(`Remove Library Project failed: ${c}`));
		}
}

async function pickApplicationProject(e, t) {
	if (t) {
		let i = t.fsPath.toLowerCase(),
			o = e.find((a) => a.sfproj.path.toLowerCase() === i);
		if (o) return o;
		let s = e.find((a) => i.startsWith(a.sfproj.directory.toLowerCase()));
		if (s) return s;
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
			placeHolder: 'Select the Service Fabric application',
		})
	)?.project;
}

async function discoverLibraries(e) {
	let r = (await vscode.workspace.findFiles('**/*.csproj', '**/{node_modules,bin,obj,packages}/**')).map((i) => i.fsPath),
		n = [];
	for (let i of r)
		try {
			let o = fs.readFileSync(i, 'utf8');
			if (isServiceFabricServiceProject(o)) continue;
			let s = [];
			for (let a of r) a.toLowerCase() !== i.toLowerCase() && csprojReferences(a, i) && s.push(a);
			if (s.length === 0) continue;
			n.push({
				libraryCsprojPath: i,
				consumers: s,
			});
		} catch {}
	return n.sort((i, o) => i.libraryCsprojPath.localeCompare(o.libraryCsprojPath));
}

async function findLibraryConsumers(e) {
	let t = await vscode.workspace.findFiles('**/*.csproj', '**/{node_modules,bin,obj,packages}/**'),
		r = [];
	for (let n of t) n.fsPath.toLowerCase() !== e.toLowerCase() && csprojReferences(n.fsPath, e) && r.push(n.fsPath);
	return r.sort((n, i) => n.localeCompare(i));
}

function csprojReferences(e, t) {
	let r;
	try {
		r = fs.readFileSync(e, 'utf8');
	} catch {
		return !1;
	}
	let n = path.dirname(e),
		i = /<ProjectReference\s+Include="([^"]+)"/gi,
		o;
	for (; (o = i.exec(r)) !== null;) {
		let s = o[1].replace(/\\/g, path.sep).replace(/\//g, path.sep);
		if (path.resolve(n, s).toLowerCase() === t.toLowerCase()) return !0;
	}
	return !1;
}

export { removeLibraryCommand };
