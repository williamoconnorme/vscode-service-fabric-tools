// @ts-nocheck
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { compareNetcoreTfm, extractTargetFramework, isServiceFabricServiceProject } from '../scaffold/addLibraryTemplates';
import { applyAddLibrary, applyAddLibraryReferenceOnly } from '../scaffold/addLibraryApply';
import { ensureNugetRestored } from '../build/nugetRestore';

async function runAddLibraryCommand(e, t, r) {
	let n = resolveCommandUri(r);
	if ((n ? path.extname(n.fsPath).toLowerCase() : '') === '.csproj' && n) {
		await addLibraryFromCsproj(e, t, n.fsPath);
		return;
	}
	await addLibraryFromApplication(e, t, n);
}

function resolveCommandUri(e) {
	if (e) return e instanceof vscode.Uri ? e : e.resource;
}

async function addLibraryFromApplication(e, t, r) {
	let n = e.getProjects();
	if (n.length === 0) {
		vscode.window.showErrorMessage(
			'No Service Fabric application projects (.sfproj) are open. Add Library Project requires an existing project.',
		);
		return;
	}
	let i = await pickProjectForAddLibrary(n, r);
	if (!i) return;
	let o = resolveWorkspaceRootForProject(i);
	if (!o) {
		vscode.window.showErrorMessage('Cannot determine workspace root for the new library.');
		return;
	}
	let s = collectServiceConsumers(i),
		a = await promptLibraryName(o, i, s, suggestLibraryNameForProject(i, o));
	if (!a) return;
	let c = s.length > 0 ? lowestTargetFramework(s.map((f) => f.targetFramework).filter((f) => !!f)) : void 0,
		l = await pickLibraryTargetFramework(c);
	if (!l) return;
	let u = await pickLibraryConsumers(s);
	if (u === void 0) return;
	if (u.length > 0) {
		let f = u.filter((m) => {
			if (!m.targetFramework) return !1;
			let v = compareNetcoreTfm(m.targetFramework, l);
			return v !== void 0 && v < 0;
		});
		if (f.length > 0) {
			let m = f.map((h) => `${path.basename(h.csprojPath, '.csproj')} (${h.targetFramework})`).join(', ');
			if (
				(await vscode.window.showWarningMessage(
					`Library targets ${l} but ${m} target a lower TFM. Build will fail with NU1201. Continue anyway?`,
					{
						modal: !0,
					},
					'Continue',
					'Cancel',
				)) !== 'Continue'
			)
				return;
		}
	}
	let p;
	try {
		p = await applyAddLibrary({
			workspaceRoot: o,
			name: a,
			targetFramework: l,
			consumers: u.map((f) => f.csprojPath),
		});
	} catch (f) {
		let m = f instanceof Error ? f.message : String(f);
		(t.error(`Add Library Project failed: ${m}`), vscode.window.showErrorMessage(`Add Library Project failed: ${m}`));
		return;
	}
	if (
		(t.info(`Created library '${a}' at ${p.libraryDirectory}, referenced from ${p.patchedConsumers.length} consumer(s).`),
		vscode.workspace.getConfiguration('serviceFabric').get('scaffoldAutoRestore', !0))
	)
		try {
			await ensureNugetRestored(i.sfproj.path, {
				output: t.outputChannel,
			});
		} catch {}
	if (
		(await vscode.window.showInformationMessage(
			`Library '${a}' created and referenced from ${p.patchedConsumers.length} service(s).`,
			'Open csproj',
		)) === 'Open csproj'
	) {
		let f = await vscode.workspace.openTextDocument(p.libraryCsprojPath);
		await vscode.window.showTextDocument(f, {
			preview: !1,
		});
	}
}

async function addLibraryFromCsproj(e, t, r) {
	if (!fs.existsSync(r)) {
		vscode.window.showErrorMessage(`csproj not found: ${r}`);
		return;
	}
	let n = await vscode.window.showQuickPick(
		[
			{
				label: 'Create new library project\u2026',
				description: 'Scaffold a new class library and reference it from this csproj.',
				value: 'new',
			},
			{
				label: 'Reference existing library project\u2026',
				description: 'Add a <ProjectReference> to an existing library csproj in the workspace.',
				value: 'existing',
			},
		],
		{
			placeHolder: 'Add Library Project',
		},
	);
	if (!n) return;
	if (n.value === 'existing') {
		await referenceExistingLibrary(r, t);
		return;
	}
	let i = resolveWorkspaceRootForCsproj(r);
	if (!i) {
		vscode.window.showErrorMessage('Cannot determine workspace root for the new library.');
		return;
	}
	let o = [
			{
				csprojPath: r,
				targetFramework: readTargetFrameworkFromFile(r),
			},
		],
		s = suggestLibraryNameForCsproj(r, i),
		a = await promptLibraryName(i, void 0, o, s);
	if (!a) return;
	let c = await pickLibraryTargetFramework(o[0].targetFramework ?? void 0);
	if (!c) return;
	let l;
	try {
		l = await applyAddLibrary({
			workspaceRoot: i,
			name: a,
			targetFramework: c,
			consumers: [r],
		});
	} catch (p) {
		let d = p instanceof Error ? p.message : String(p);
		(t.error(`Add Library Project failed: ${d}`), vscode.window.showErrorMessage(`Add Library Project failed: ${d}`));
		return;
	}
	if (
		(t.info(`Created library '${a}' at ${l.libraryDirectory}, referenced from ${path.basename(r)}.`),
		(await vscode.window.showInformationMessage(`Library '${a}' created and referenced from '${path.basename(r)}'.`, 'Open csproj')) ===
			'Open csproj')
	) {
		let p = await vscode.workspace.openTextDocument(l.libraryCsprojPath);
		await vscode.window.showTextDocument(p, {
			preview: !1,
		});
	}
}

async function referenceExistingLibrary(e, t) {
	let r = await findEligibleLibraryProjects(e);
	if (r.length === 0) {
		vscode.window.showInformationMessage(
			'No eligible library projects found in the workspace (must be a non-service .csproj that is not already referenced by this project).',
		);
		return;
	}
	let n = r.map((o) => ({
			label: path.basename(o, '.csproj'),
			description: o,
			value: o,
		})),
		i = await vscode.window.showQuickPick(n, {
			placeHolder: 'Pick the library project to reference',
		});
	if (i)
		try {
			(
				await applyAddLibraryReferenceOnly({
					consumerCsproj: e,
					targetCsproj: i.value,
				})
			).changed
				? (t.info(`Added <ProjectReference> to ${path.basename(i.value)} from ${path.basename(e)}`),
					vscode.window.showInformationMessage(`Reference added: ${path.basename(e)} \u2192 ${path.basename(i.value)}`))
				: vscode.window.showInformationMessage(`${path.basename(e)} already references ${path.basename(i.value)}.`);
		} catch (o) {
			let s = o instanceof Error ? o.message : String(o);
			(t.error(`Add Library Project (reference existing) failed: ${s}`),
				vscode.window.showErrorMessage(`Add Library Project failed: ${s}`));
		}
}

async function pickProjectForAddLibrary(e, t) {
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
			placeHolder: 'Select the Service Fabric application to add a library to',
		})
	)?.project;
}

function resolveWorkspaceRootForProject(e) {
	let t = vscode.workspace.workspaceFolders;
	return t && t.length > 0
		? (t.find((n) => e.sfproj.path.toLowerCase().startsWith(n.uri.fsPath.toLowerCase()))?.uri.fsPath ?? t[0].uri.fsPath)
		: path.dirname(e.sfproj.directory);
}

function resolveWorkspaceRootForCsproj(e) {
	let t = vscode.workspace.workspaceFolders;
	return t && t.length > 0
		? (t.find((n) => e.toLowerCase().startsWith(n.uri.fsPath.toLowerCase()))?.uri.fsPath ?? t[0].uri.fsPath)
		: path.dirname(path.dirname(e));
}

function collectServiceConsumers(e) {
	let t = e.sfproj.directory,
		r = [];
	for (let n of e.sfproj.projectReferences) {
		let i = path.isAbsolute(n) ? n : path.resolve(t, n.replace(/\\/g, path.sep));
		try {
			let o = fs.readFileSync(i, 'utf8');
			if (!isServiceFabricServiceProject(o)) continue;
			r.push({
				csprojPath: i,
				targetFramework: extractTargetFramework(o),
			});
		} catch {}
	}
	return r;
}

async function findEligibleLibraryProjects(e) {
	let t = await vscode.workspace.findFiles('**/*.csproj', '**/{node_modules,bin,obj,packages}/**'),
		r = fs.existsSync(e) ? fs.readFileSync(e, 'utf8') : '',
		n = path.dirname(e),
		i = new Set(),
		o = /<ProjectReference\s+Include="([^"]+)"/gi,
		s;
	for (; (s = o.exec(r)) !== null;) {
		let c = s[1].replace(/\//g, path.sep).replace(/\\/g, path.sep);
		i.add(path.resolve(n, c).toLowerCase());
	}
	let a = [];
	for (let c of t) {
		let l = c.fsPath;
		if (l.toLowerCase() !== e.toLowerCase() && !i.has(l.toLowerCase()))
			try {
				let u = fs.readFileSync(l, 'utf8');
				if (isServiceFabricServiceProject(u)) continue;
				a.push(l);
			} catch {}
	}
	return a.sort((c, l) => c.localeCompare(l));
}

async function promptLibraryName(e, t, r, n) {
	return vscode.window.showInputBox({
		prompt: 'Library project name (also used as the folder and .csproj filename)',
		value: n,
		validateInput: (i) => {
			if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(i)) return 'Use letters, digits, dot, dash or underscore (must start with a letter).';
			let o = path.join(e, i);
			if (fs.existsSync(o))
				try {
					let s = fs.readdirSync(o);
					if (s.length > 0 && s.some((c) => c.toLowerCase().endsWith('.csproj'))) return 'A project already exists at this path.';
				} catch {}
			for (let s of r)
				if (path.basename(path.dirname(s.csprojPath)).toLowerCase() === i.toLowerCase())
					return `Name '${i}' collides with an existing service folder.`;
			return null;
		},
	});
}

async function pickLibraryTargetFramework(e) {
	let t = ['net10.0', 'net9.0', 'net8.0'],
		r = t.map((i) => ({
			label: i,
			description:
				i === 'net10.0'
					? 'Recommended (current LTS, until Nov 2028)'
					: i === 'net9.0'
						? 'STS \u2014 reaches end-of-support May 12, 2026'
						: 'LTS (until Nov 2026)',
			value: i,
		}));
	if (e && t.includes(e)) {
		let i = r.findIndex((o) => o.value === e);
		if (i > 0) {
			let [o] = r.splice(i, 1);
			r.unshift(o);
		}
	}
	return (
		await vscode.window.showQuickPick(r, {
			placeHolder: 'Target framework for the library project',
		})
	)?.value;
}

async function pickLibraryConsumers(e) {
	if (e.length === 0)
		return (await vscode.window.showInformationMessage(
			'This application has no service C# projects to wire the library into. Scaffold the library anyway?',
			{
				modal: !0,
			},
			'Scaffold without consumers',
			'Cancel',
		)) !== 'Scaffold without consumers'
			? void 0
			: [];
	let t = e.map((n) => ({
			label: path.basename(n.csprojPath, '.csproj'),
			description: n.targetFramework ?? '(unknown TFM)',
			detail: n.csprojPath,
			consumer: n,
			picked: !1,
		})),
		r = await vscode.window.showQuickPick(t, {
			placeHolder: 'Pick which service csprojs should reference the new library (leave empty to skip wiring)',
			canPickMany: !0,
		});
	if (r !== void 0) return r.map((n) => n.consumer);
}

function suggestLibraryNameForProject(e, t) {
	let r = e.applicationManifest?.applicationTypeName?.replace(/Type$/, '') ?? path.basename(e.sfproj.path, '.sfproj'),
		n = `${r}.Shared`;
	if (!fs.existsSync(path.join(t, n))) return n;
	for (let i = 2; i < 100; i++) {
		let o = `${r}.Shared${i}`;
		if (!fs.existsSync(path.join(t, o))) return o;
	}
	return n;
}

function suggestLibraryNameForCsproj(e, t) {
	let r = path.basename(e, '.csproj').replace(/Service$/, '') + '.Shared';
	if (!fs.existsSync(path.join(t, r))) return r;
	for (let n = 2; n < 100; n++) {
		let i = `${r}${n}`;
		if (!fs.existsSync(path.join(t, i))) return i;
	}
	return r;
}

function readTargetFrameworkFromFile(e) {
	try {
		return extractTargetFramework(fs.readFileSync(e, 'utf8'));
	} catch {
		return;
	}
}

function lowestTargetFramework(e) {
	let t;
	for (let r of e) {
		if (!/^net\d+\.\d+$/.test(r)) continue;
		if (t === void 0) {
			t = r;
			continue;
		}
		let n = compareNetcoreTfm(r, t);
		n !== void 0 && n < 0 && (t = r);
	}
	return t;
}

export { runAddLibraryCommand };
