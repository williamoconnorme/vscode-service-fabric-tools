import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { ApplicationProject } from '../project/sfprojModel';
import type { SfProjectWatcher } from '../project/projectWatcher';
import type { Logger } from '../util/logger';
import { compareNetcoreTfm, extractTargetFramework, isServiceFabricServiceProject } from '../scaffold/addLibraryTemplates';
import { applyAddLibrary, applyAddLibraryReferenceOnly, type AddLibraryResult } from '../scaffold/addLibraryApply';
import { ensureNugetRestored } from '../build/nugetRestore';
import type { CommandTarget } from './commandTarget';

/** A service csproj that can consume the new library. */
interface LibraryConsumer {
	csprojPath: string;
	targetFramework: string | undefined;
}

/**
 * `serviceFabric.addLibrary`. Invoked on a `.csproj`, it offers to create a new
 * library or reference an existing one from that project; otherwise it creates
 * a library for an application and wires it into the chosen service csprojs.
 */
export async function runAddLibraryCommand(projects: SfProjectWatcher, logger: Logger, target?: vscode.Uri | CommandTarget): Promise<void> {
	const uri = resolveCommandUri(target);
	if ((uri ? path.extname(uri.fsPath).toLowerCase() : '') === '.csproj' && uri) {
		await addLibraryFromCsproj(projects, logger, uri.fsPath);
		return;
	}
	await addLibraryFromApplication(projects, logger, uri);
}

function resolveCommandUri(target: vscode.Uri | CommandTarget | undefined): vscode.Uri | undefined {
	if (target) return target instanceof vscode.Uri ? target : target.resource;
	return undefined;
}

/** Application-context flow: create a library and reference it from selected services. */
async function addLibraryFromApplication(projects: SfProjectWatcher, logger: Logger, uri: vscode.Uri | undefined): Promise<void> {
	const candidates = projects.getProjects();
	if (candidates.length === 0) {
		vscode.window.showErrorMessage(
			'No Service Fabric application projects (.sfproj) are open. Add Library Project requires an existing project.',
		);
		return;
	}
	const project = await pickProjectForAddLibrary(candidates, uri);
	if (!project) return;
	const workspaceRoot = resolveWorkspaceRootForProject(project);
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('Cannot determine workspace root for the new library.');
		return;
	}
	const consumers = collectServiceConsumers(project);
	const name = await promptLibraryName(workspaceRoot, project, consumers, suggestLibraryNameForProject(project, workspaceRoot));
	if (!name) return;
	const defaultTfm =
		consumers.length > 0 ? lowestTargetFramework(consumers.map((c) => c.targetFramework).filter((tfm): tfm is string => !!tfm)) : undefined;
	const targetFramework = await pickLibraryTargetFramework(defaultTfm);
	if (!targetFramework) return;
	const selected = await pickLibraryConsumers(consumers);
	if (selected === undefined) return;
	if (selected.length > 0) {
		const lower = selected.filter((c) => {
			if (!c.targetFramework) return false;
			const cmp = compareNetcoreTfm(c.targetFramework, targetFramework);
			return cmp !== undefined && cmp < 0;
		});
		if (lower.length > 0) {
			const list = lower.map((c) => `${path.basename(c.csprojPath, '.csproj')} (${c.targetFramework})`).join(', ');
			if (
				(await vscode.window.showWarningMessage(
					`Library targets ${targetFramework} but ${list} target a lower TFM. Build will fail with NU1201. Continue anyway?`,
					{ modal: true },
					'Continue',
					'Cancel',
				)) !== 'Continue'
			)
				return;
		}
	}
	let result: AddLibraryResult;
	try {
		result = await applyAddLibrary({ workspaceRoot, name, targetFramework, consumers: selected.map((c) => c.csprojPath) });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Add Library Project failed: ${message}`);
		vscode.window.showErrorMessage(`Add Library Project failed: ${message}`);
		return;
	}
	logger.info(`Created library '${name}' at ${result.libraryDirectory}, referenced from ${result.patchedConsumers.length} consumer(s).`);
	if (vscode.workspace.getConfiguration('serviceFabric').get('scaffoldAutoRestore', true)) {
		try {
			await ensureNugetRestored(project.sfproj.path, { output: logger.outputChannel });
		} catch {
			// best-effort; the user can run Restore NuGet Packages manually
		}
	}
	if (
		(await vscode.window.showInformationMessage(
			`Library '${name}' created and referenced from ${result.patchedConsumers.length} service(s).`,
			'Open csproj',
		)) === 'Open csproj'
	) {
		const doc = await vscode.workspace.openTextDocument(result.libraryCsprojPath);
		await vscode.window.showTextDocument(doc, { preview: false });
	}
}

/** `.csproj`-context flow: create a new library for this csproj, or reference an existing one. */
async function addLibraryFromCsproj(projects: SfProjectWatcher, logger: Logger, csprojPath: string): Promise<void> {
	if (!fs.existsSync(csprojPath)) {
		vscode.window.showErrorMessage(`csproj not found: ${csprojPath}`);
		return;
	}
	const mode = await vscode.window.showQuickPick(
		[
			{
				label: 'Create new library project…',
				description: 'Scaffold a new class library and reference it from this csproj.',
				value: 'new',
			},
			{
				label: 'Reference existing library project…',
				description: 'Add a <ProjectReference> to an existing library csproj in the workspace.',
				value: 'existing',
			},
		],
		{ placeHolder: 'Add Library Project' },
	);
	if (!mode) return;
	if (mode.value === 'existing') {
		await referenceExistingLibrary(csprojPath, logger);
		return;
	}
	const workspaceRoot = resolveWorkspaceRootForCsproj(csprojPath);
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('Cannot determine workspace root for the new library.');
		return;
	}
	const consumers: LibraryConsumer[] = [{ csprojPath, targetFramework: readTargetFrameworkFromFile(csprojPath) }];
	const suggested = suggestLibraryNameForCsproj(csprojPath, workspaceRoot);
	const name = await promptLibraryName(workspaceRoot, undefined, consumers, suggested);
	if (!name) return;
	const targetFramework = await pickLibraryTargetFramework(consumers[0].targetFramework ?? undefined);
	if (!targetFramework) return;
	let result: AddLibraryResult;
	try {
		result = await applyAddLibrary({ workspaceRoot, name, targetFramework, consumers: [csprojPath] });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Add Library Project failed: ${message}`);
		vscode.window.showErrorMessage(`Add Library Project failed: ${message}`);
		return;
	}
	logger.info(`Created library '${name}' at ${result.libraryDirectory}, referenced from ${path.basename(csprojPath)}.`);
	if (
		(await vscode.window.showInformationMessage(
			`Library '${name}' created and referenced from '${path.basename(csprojPath)}'.`,
			'Open csproj',
		)) === 'Open csproj'
	) {
		const doc = await vscode.workspace.openTextDocument(result.libraryCsprojPath);
		await vscode.window.showTextDocument(doc, { preview: false });
	}
}

/** Adds a `<ProjectReference>` from `consumerCsproj` to a picked existing library csproj. */
async function referenceExistingLibrary(consumerCsproj: string, logger: Logger): Promise<void> {
	const libraries = await findEligibleLibraryProjects(consumerCsproj);
	if (libraries.length === 0) {
		vscode.window.showInformationMessage(
			'No eligible library projects found in the workspace (must be a non-service .csproj that is not already referenced by this project).',
		);
		return;
	}
	const items = libraries.map((lib) => ({ label: path.basename(lib, '.csproj'), description: lib, value: lib }));
	const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Pick the library project to reference' });
	if (!picked) return;
	try {
		if ((await applyAddLibraryReferenceOnly({ consumerCsproj, targetCsproj: picked.value })).changed) {
			logger.info(`Added <ProjectReference> to ${path.basename(picked.value)} from ${path.basename(consumerCsproj)}`);
			vscode.window.showInformationMessage(`Reference added: ${path.basename(consumerCsproj)} → ${path.basename(picked.value)}`);
		} else {
			vscode.window.showInformationMessage(`${path.basename(consumerCsproj)} already references ${path.basename(picked.value)}.`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Add Library Project (reference existing) failed: ${message}`);
		vscode.window.showErrorMessage(`Add Library Project failed: ${message}`);
	}
}

async function pickProjectForAddLibrary(
	projects: ApplicationProject[],
	uri: vscode.Uri | undefined,
): Promise<ApplicationProject | undefined> {
	if (uri) {
		const wanted = uri.fsPath.toLowerCase();
		const exact = projects.find((p) => p.sfproj.path.toLowerCase() === wanted);
		if (exact) return exact;
		const containing = projects.find((p) => wanted.startsWith(p.sfproj.directory.toLowerCase()));
		if (containing) return containing;
	}
	if (projects.length === 1) return projects[0];
	const items = projects.map((p) => ({
		label: path.basename(p.sfproj.path),
		description: p.applicationManifest?.applicationTypeName,
		detail: p.sfproj.path,
		project: p,
	}));
	return (await vscode.window.showQuickPick(items, { placeHolder: 'Select the Service Fabric application to add a library to' }))?.project;
}

/** The workspace folder containing the .sfproj (else the first folder, else the .sfproj's parent directory). */
function resolveWorkspaceRootForProject(project: ApplicationProject): string {
	const folders = vscode.workspace.workspaceFolders;
	return folders && folders.length > 0
		? (folders.find((f) => project.sfproj.path.toLowerCase().startsWith(f.uri.fsPath.toLowerCase()))?.uri.fsPath ?? folders[0].uri.fsPath)
		: path.dirname(project.sfproj.directory);
}

/** The workspace folder containing the csproj (else the first folder, else the csproj folder's parent). */
function resolveWorkspaceRootForCsproj(csprojPath: string): string {
	const folders = vscode.workspace.workspaceFolders;
	return folders && folders.length > 0
		? (folders.find((f) => csprojPath.toLowerCase().startsWith(f.uri.fsPath.toLowerCase()))?.uri.fsPath ?? folders[0].uri.fsPath)
		: path.dirname(path.dirname(csprojPath));
}

/** The application's Service Fabric service csprojs (from the .sfproj's ProjectReferences). */
function collectServiceConsumers(project: ApplicationProject): LibraryConsumer[] {
	const sfprojDir = project.sfproj.directory;
	const consumers: LibraryConsumer[] = [];
	for (const ref of project.sfproj.projectReferences) {
		const csprojPath = path.isAbsolute(ref) ? ref : path.resolve(sfprojDir, ref.replace(/\\/g, path.sep));
		try {
			const xml = fs.readFileSync(csprojPath, 'utf8');
			if (!isServiceFabricServiceProject(xml)) continue;
			consumers.push({ csprojPath, targetFramework: extractTargetFramework(xml) });
		} catch {
			// unreadable reference — skip
		}
	}
	return consumers;
}

/** Workspace csprojs that are not SF services, not the consumer itself, and not already referenced by it. */
async function findEligibleLibraryProjects(consumerCsproj: string): Promise<string[]> {
	const files = await vscode.workspace.findFiles('**/*.csproj', '**/{node_modules,bin,obj,packages}/**');
	const consumerXml = fs.existsSync(consumerCsproj) ? fs.readFileSync(consumerCsproj, 'utf8') : '';
	const consumerDir = path.dirname(consumerCsproj);
	const alreadyReferenced = new Set<string>();
	const refRe = /<ProjectReference\s+Include="([^"]+)"/gi;
	let m: RegExpExecArray | null;
	while ((m = refRe.exec(consumerXml)) !== null) {
		const rel = m[1].replace(/\//g, path.sep).replace(/\\/g, path.sep);
		alreadyReferenced.add(path.resolve(consumerDir, rel).toLowerCase());
	}
	const eligible: string[] = [];
	for (const file of files) {
		const filePath = file.fsPath;
		if (filePath.toLowerCase() === consumerCsproj.toLowerCase() || alreadyReferenced.has(filePath.toLowerCase())) continue;
		try {
			const xml = fs.readFileSync(filePath, 'utf8');
			if (isServiceFabricServiceProject(xml)) continue;
			eligible.push(filePath);
		} catch {
			// unreadable — skip
		}
	}
	return eligible.sort((a, b) => a.localeCompare(b));
}

async function promptLibraryName(
	workspaceRoot: string,
	_project: ApplicationProject | undefined,
	consumers: LibraryConsumer[],
	suggested: string,
): Promise<string | undefined> {
	return vscode.window.showInputBox({
		prompt: 'Library project name (also used as the folder and .csproj filename)',
		value: suggested,
		validateInput: (value) => {
			if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)) return 'Use letters, digits, dot, dash or underscore (must start with a letter).';
			const dir = path.join(workspaceRoot, value);
			if (fs.existsSync(dir)) {
				try {
					const entries = fs.readdirSync(dir);
					if (entries.length > 0 && entries.some((e) => e.toLowerCase().endsWith('.csproj')))
						return 'A project already exists at this path.';
				} catch {
					// unreadable — let applyAddLibrary report it
				}
			}
			for (const c of consumers) {
				if (path.basename(path.dirname(c.csprojPath)).toLowerCase() === value.toLowerCase())
					return `Name '${value}' collides with an existing service folder.`;
			}
			return null;
		},
	});
}

/** TFM picker; `preferred` (when one of the offered TFMs) is moved to the top. */
async function pickLibraryTargetFramework(preferred: string | undefined): Promise<string | undefined> {
	const tfms = ['net10.0', 'net9.0', 'net8.0'];
	const items = tfms.map((tfm) => ({
		label: tfm,
		description:
			tfm === 'net10.0'
				? 'Recommended (current LTS, until Nov 2028)'
				: tfm === 'net9.0'
					? 'STS — reaches end-of-support May 12, 2026'
					: 'LTS (until Nov 2026)',
		value: tfm,
	}));
	if (preferred && tfms.includes(preferred)) {
		const index = items.findIndex((item) => item.value === preferred);
		if (index > 0) {
			const [item] = items.splice(index, 1);
			items.unshift(item);
		}
	}
	return (await vscode.window.showQuickPick(items, { placeHolder: 'Target framework for the library project' }))?.value;
}

/**
 * Multi-select picker for which service csprojs reference the new library.
 * Resolves to `undefined` on cancel; `[]` means scaffold without consumers.
 */
async function pickLibraryConsumers(consumers: LibraryConsumer[]): Promise<LibraryConsumer[] | undefined> {
	if (consumers.length === 0) {
		return (await vscode.window.showInformationMessage(
			'This application has no service C# projects to wire the library into. Scaffold the library anyway?',
			{ modal: true },
			'Scaffold without consumers',
			'Cancel',
		)) !== 'Scaffold without consumers'
			? undefined
			: [];
	}
	const items = consumers.map((c) => ({
		label: path.basename(c.csprojPath, '.csproj'),
		description: c.targetFramework ?? '(unknown TFM)',
		detail: c.csprojPath,
		consumer: c,
		picked: false,
	}));
	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Pick which service csprojs should reference the new library (leave empty to skip wiring)',
		canPickMany: true,
	});
	if (picked !== undefined) return picked.map((item) => item.consumer);
	return undefined;
}

/** `<AppName>.Shared`, or `<AppName>.Shared2`… when that folder is taken. */
function suggestLibraryNameForProject(project: ApplicationProject, workspaceRoot: string): string {
	const base = project.applicationManifest?.applicationTypeName?.replace(/Type$/, '') ?? path.basename(project.sfproj.path, '.sfproj');
	const first = `${base}.Shared`;
	if (!fs.existsSync(path.join(workspaceRoot, first))) return first;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base}.Shared${i}`;
		if (!fs.existsSync(path.join(workspaceRoot, candidate))) return candidate;
	}
	return first;
}

/** `<CsprojName minus "Service">.Shared`, or with a numeric suffix when that folder is taken. */
function suggestLibraryNameForCsproj(csprojPath: string, workspaceRoot: string): string {
	const base = path.basename(csprojPath, '.csproj').replace(/Service$/, '') + '.Shared';
	if (!fs.existsSync(path.join(workspaceRoot, base))) return base;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base}${i}`;
		if (!fs.existsSync(path.join(workspaceRoot, candidate))) return candidate;
	}
	return base;
}

function readTargetFrameworkFromFile(csprojPath: string): string | undefined {
	try {
		return extractTargetFramework(fs.readFileSync(csprojPath, 'utf8'));
	} catch {
		return undefined;
	}
}

/** The lowest `netN.M` TFM in the list (non-`netN.M` entries are ignored). */
function lowestTargetFramework(tfms: string[]): string | undefined {
	let lowest: string | undefined;
	for (const tfm of tfms) {
		if (!/^net\d+\.\d+$/.test(tfm)) continue;
		if (lowest === undefined) {
			lowest = tfm;
			continue;
		}
		const cmp = compareNetcoreTfm(tfm, lowest);
		if (cmp !== undefined && cmp < 0) lowest = tfm;
	}
	return lowest;
}
