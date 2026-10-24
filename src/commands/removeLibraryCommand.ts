import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { applyRemoveLibrary } from '../scaffold/removeLibraryApply';
import { isServiceFabricServiceProject } from '../scaffold/addLibraryTemplates';

import type { ApplicationProject } from '../project/sfprojModel';
import type { SfProjectWatcher } from '../project/projectWatcher';
import type { Logger } from '../util/logger';

/** Command argument: an Explorer URI or a tree item / wrapper carrying a `resource` URI. */
export type RemoveLibraryTarget = vscode.Uri | { resource?: vscode.Uri } | undefined;

/** A workspace library: a non-service csproj referenced by at least one other csproj. */
interface DiscoveredLibrary {
	libraryCsprojPath: string;
	consumers: string[];
}

const CSPROJ_GLOB = '**/*.csproj';
const CSPROJ_EXCLUDE_GLOB = '**/{node_modules,bin,obj,packages}/**';

/**
 * `serviceFabric.removeLibrary`. Invoked on a library `.csproj` it unwires
 * picked consumers from that library; otherwise (on a `.sfproj` or from the
 * palette) it lists every workspace library and optionally deletes the folder.
 */
export async function removeLibraryCommand(watcher: SfProjectWatcher, logger: Logger, target: RemoveLibraryTarget): Promise<void> {
	const uri = resolveTargetUri(target);
	if ((uri ? path.extname(uri.fsPath).toLowerCase() : '') === '.csproj' && uri) {
		await removeLibraryFromCsproj(logger, uri.fsPath);
		return;
	}
	await removeLibraryFromApplication(watcher, logger, uri);
}

function resolveTargetUri(target: RemoveLibraryTarget): vscode.Uri | undefined {
	if (target) return target instanceof vscode.Uri ? target : target.resource;
	return undefined;
}

/** `.sfproj` / palette flow: pick library, pick consumers, optionally delete the folder. */
async function removeLibraryFromApplication(watcher: SfProjectWatcher, logger: Logger, uri: vscode.Uri | undefined): Promise<void> {
	const projects = watcher.getProjects();
	if (projects.length === 0) {
		vscode.window.showErrorMessage('No Service Fabric application projects (.sfproj) are open.');
		return;
	}
	const project = await pickApplicationProject(projects, uri);
	if (!project) return;
	const libraries = await discoverLibraries(project);
	if (libraries.length === 0) {
		vscode.window.showInformationMessage(
			'No library projects found in the workspace (a library is a non-service .csproj that is referenced by at least one service).',
		);
		return;
	}
	const libraryItems = libraries.map((library) => ({
		label: path.basename(library.libraryCsprojPath, '.csproj'),
		description: `${library.consumers.length} consumer(s)`,
		detail: library.libraryCsprojPath,
		library,
	}));
	const pickedLibrary = await vscode.window.showQuickPick(libraryItems, {
		placeHolder: 'Select the library project to remove',
	});
	if (!pickedLibrary) return;
	const { library } = pickedLibrary;
	const consumerItems = library.consumers.map((consumer) => ({
		label: path.basename(consumer, '.csproj'),
		description: consumer,
		consumer,
		picked: true,
	}));
	const pickedConsumers = await vscode.window.showQuickPick(consumerItems, {
		placeHolder: 'Pick which consumers should drop their reference (defaults to all)',
		canPickMany: true,
	});
	if (pickedConsumers === undefined) return;
	const allConsumersPicked = pickedConsumers.length === library.consumers.length;
	let deleteFolder = false;
	if (allConsumersPicked) {
		const choice = await vscode.window.showWarningMessage(
			`All consumers will be unwired from '${path.basename(library.libraryCsprojPath)}'. Also delete the library folder from disk?`,
			{ modal: true },
			'Unwire only',
			'Unwire and delete folder',
		);
		if (choice === undefined) return;
		deleteFolder = choice === 'Unwire and delete folder';
	} else {
		const choice = await vscode.window.showInformationMessage(
			`Unwire ${pickedConsumers.length} of ${library.consumers.length} consumer(s) from '${path.basename(library.libraryCsprojPath)}'?`,
			{ modal: true },
			'Unwire selected',
		);
		if (choice !== 'Unwire selected') return;
	}
	try {
		const result = await applyRemoveLibrary({
			libraryCsprojPath: library.libraryCsprojPath,
			consumers: pickedConsumers.map((item) => item.consumer),
			deleteFolder,
		});
		logger.info(
			`Removed library references from ${result.unwiredConsumers.length} consumer(s).` +
				(result.folderDeleted ? ` Library folder deleted: ${result.libraryDirectory}` : ''),
		);
		const folderNote = result.folderDeleted ? ' Folder deleted.' : '';
		vscode.window.showInformationMessage(
			`Library '${path.basename(library.libraryCsprojPath, '.csproj')}' unwired from ${result.unwiredConsumers.length} consumer(s).${folderNote}`,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Remove Library Project failed: ${message}`);
		vscode.window.showErrorMessage(`Remove Library Project failed: ${message}`);
	}
}

/** Library `.csproj` flow: unwire picked consumers; folder deletion is never offered here. */
async function removeLibraryFromCsproj(logger: Logger, libraryCsprojPath: string): Promise<void> {
	if (!fs.existsSync(libraryCsprojPath)) {
		vscode.window.showErrorMessage(`csproj not found: ${libraryCsprojPath}`);
		return;
	}
	const xml = fs.readFileSync(libraryCsprojPath, 'utf8');
	if (isServiceFabricServiceProject(xml)) {
		vscode.window.showErrorMessage(
			`'${path.basename(libraryCsprojPath)}' is a Service Fabric service project. Use 'Service Fabric: Remove Service…' instead.`,
		);
		return;
	}
	const consumers = await findLibraryConsumers(libraryCsprojPath);
	if (consumers.length === 0) {
		vscode.window.showInformationMessage(`No consumers reference '${path.basename(libraryCsprojPath)}' in the workspace.`);
		return;
	}
	const consumerItems = consumers.map((consumer) => ({
		label: path.basename(consumer, '.csproj'),
		description: consumer,
		consumer,
		picked: true,
	}));
	const pickedConsumers = await vscode.window.showQuickPick(consumerItems, {
		placeHolder: `Drop the reference to '${path.basename(libraryCsprojPath, '.csproj')}' from which consumer(s)?`,
		canPickMany: true,
	});
	if (pickedConsumers === undefined || pickedConsumers.length === 0) return;
	const confirm = await vscode.window.showWarningMessage(
		`Unwire ${pickedConsumers.length} consumer(s) from '${path.basename(libraryCsprojPath)}'?`,
		{ modal: true },
		'Unwire',
	);
	if (confirm !== 'Unwire') return;
	try {
		const result = await applyRemoveLibrary({
			libraryCsprojPath,
			consumers: pickedConsumers.map((item) => item.consumer),
			deleteFolder: false,
		});
		logger.info(`Unwired ${result.unwiredConsumers.length} consumer(s) from ${path.basename(libraryCsprojPath)}.`);
		vscode.window.showInformationMessage(
			`Library '${path.basename(libraryCsprojPath, '.csproj')}' unwired from ${result.unwiredConsumers.length} consumer(s).`,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Remove Library Project failed: ${message}`);
		vscode.window.showErrorMessage(`Remove Library Project failed: ${message}`);
	}
}

/**
 * Resolves the target application: the project whose `.sfproj` is the URI, or
 * whose directory contains it; else the only project; else a quick pick.
 */
async function pickApplicationProject(
	projects: ApplicationProject[],
	uri: vscode.Uri | undefined,
): Promise<ApplicationProject | undefined> {
	if (uri) {
		const target = uri.fsPath.toLowerCase();
		const exact = projects.find((p) => p.sfproj.path.toLowerCase() === target);
		if (exact) return exact;
		const containing = projects.find((p) => target.startsWith(p.sfproj.directory.toLowerCase()));
		if (containing) return containing;
	}
	if (projects.length === 1) return projects[0];
	const items = projects.map((project) => ({
		label: path.basename(project.sfproj.path),
		description: project.applicationManifest?.applicationTypeName,
		detail: project.sfproj.path,
		project,
	}));
	return (
		await vscode.window.showQuickPick(items, {
			placeHolder: 'Select the Service Fabric application',
		})
	)?.project;
}

/**
 * Every non-service csproj in the workspace that at least one other csproj references.
 * The scan is workspace-wide; the selected application is not used to narrow it.
 */
async function discoverLibraries(_project: ApplicationProject): Promise<DiscoveredLibrary[]> {
	const csprojPaths = (await vscode.workspace.findFiles(CSPROJ_GLOB, CSPROJ_EXCLUDE_GLOB)).map((uri) => uri.fsPath);
	const libraries: DiscoveredLibrary[] = [];
	for (const candidate of csprojPaths) {
		try {
			const xml = fs.readFileSync(candidate, 'utf8');
			if (isServiceFabricServiceProject(xml)) continue;
			const consumers: string[] = [];
			for (const other of csprojPaths) {
				if (other.toLowerCase() !== candidate.toLowerCase() && csprojReferences(other, candidate)) consumers.push(other);
			}
			if (consumers.length === 0) continue;
			libraries.push({ libraryCsprojPath: candidate, consumers });
		} catch {
			// unreadable csproj: skip
		}
	}
	return libraries.sort((a, b) => a.libraryCsprojPath.localeCompare(b.libraryCsprojPath));
}

/** Every workspace csproj (other than the library itself) that references `libraryCsprojPath`. */
async function findLibraryConsumers(libraryCsprojPath: string): Promise<string[]> {
	const csprojUris = await vscode.workspace.findFiles(CSPROJ_GLOB, CSPROJ_EXCLUDE_GLOB);
	const consumers: string[] = [];
	for (const uri of csprojUris) {
		if (uri.fsPath.toLowerCase() !== libraryCsprojPath.toLowerCase() && csprojReferences(uri.fsPath, libraryCsprojPath)) {
			consumers.push(uri.fsPath);
		}
	}
	return consumers.sort((a, b) => a.localeCompare(b));
}

/** True when `consumerCsprojPath` has a `<ProjectReference>` resolving to `libraryCsprojPath`. */
function csprojReferences(consumerCsprojPath: string, libraryCsprojPath: string): boolean {
	let xml: string;
	try {
		xml = fs.readFileSync(consumerCsprojPath, 'utf8');
	} catch {
		return false;
	}
	const consumerDir = path.dirname(consumerCsprojPath);
	const re = /<ProjectReference\s+Include="([^"]+)"/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml)) !== null) {
		const include = m[1].replace(/\\/g, path.sep).replace(/\//g, path.sep);
		if (path.resolve(consumerDir, include).toLowerCase() === libraryCsprojPath.toLowerCase()) return true;
	}
	return false;
}
