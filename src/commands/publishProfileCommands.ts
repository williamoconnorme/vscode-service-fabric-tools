import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import type { ApplicationProject } from '../project/sfprojModel';
import { addSfprojNoneItem, buildPublishProfileForCluster, profileFileNameFor, profileTargetsConnection } from '../deploy/clusterPublishProfile';
import { pathExists } from '../util/fs';
import type { Logger } from '../util/logger';
import { resolveTargetProject, type ProjectLookup } from './buildCommands';

/** Parameter files to publish with when there is no publish profile to pair them. */
export interface ClusterParameterFiles {
	applicationParameterFileAbs?: string;
	startupServiceParameterFileAbs?: string;
}

/** `workspaceState` key: ids of connections the user said not to offer a profile for. */
const NO_PROFILE_OFFER_KEY = 'serviceFabric.publishProfileOffer.declined';

/**
 * Asks which `ApplicationParameters/*.xml` to publish to `conn` with,
 * preselecting `Cloud.xml` for remote clusters and `Local.*` for the local one.
 * The `StartupServiceParameters` file with the same name is paired with it.
 * `undefined` when the user cancels.
 */
export async function pickParameterFilesForCluster(
	project: ApplicationProject,
	conn: ClusterConnection,
): Promise<ClusterParameterFiles | undefined> {
	const files = project.applicationParameters;
	const preferred =
		conn.kind === 'local'
			? (files.find((f) => /^Local\.1Node\.xml$/i.test(path.basename(f))) ?? files.find((f) => /^Local\./i.test(path.basename(f))))
			: files.find((f) => /^Cloud\.xml$/i.test(path.basename(f)));
	let appParam: string | undefined;
	if (files.length === 1) {
		appParam = files[0];
	} else if (files.length > 1) {
		const ordered = preferred ? [preferred, ...files.filter((f) => f !== preferred)] : files;
		const items: (vscode.QuickPickItem & { value: string | undefined })[] = [
			...ordered.map((f) => ({ label: path.basename(f), description: f === preferred ? 'suggested' : undefined, value: f })),
			{ label: '$(circle-slash) None', description: 'Use the defaults in ApplicationManifest.xml', value: undefined },
		];
		const picked = await vscode.window.showQuickPick(items, { placeHolder: `Application parameters for ${conn.label}` });
		if (!picked) return undefined;
		appParam = picked.value;
	}
	const startup = appParam
		? project.startupServiceParameters.find((f) => path.basename(f).toLowerCase() === path.basename(appParam!).toLowerCase())
		: undefined;
	return { applicationParameterFileAbs: appParam, startupServiceParameterFileAbs: startup };
}

/** True when one of the project's publish profiles already deploys to `conn`. */
export async function hasProfileForConnection(project: ApplicationProject, conn: ClusterConnection): Promise<boolean> {
	for (const profile of project.publishProfiles) {
		try {
			if (profileTargetsConnection(await fsp.readFile(profile, 'utf8'), conn)) return true;
		} catch {
			// Unreadable profile: ignore.
		}
	}
	return false;
}

/** `..\ApplicationParameters\Cloud.xml`-style path from the PublishProfiles folder, as Visual Studio writes them. */
function relativeFromProfiles(profilesDir: string, file: string | undefined): string | undefined {
	return file ? path.relative(profilesDir, file).split(path.sep).join('\\') : undefined;
}

/**
 * Asks for a file name and writes a publish profile for `conn` into the
 * project's `PublishProfiles` folder, lists it in the `.sfproj` and opens it.
 * Returns the new profile's path, or `undefined` if the user cancels.
 */
export async function writePublishProfileForCluster(
	project: ApplicationProject,
	conn: ClusterConnection,
	files: ClusterParameterFiles,
	logger: Logger,
): Promise<string | undefined> {
	const profilesDir = path.join(project.sfproj.directory, 'PublishProfiles');
	const name = await vscode.window.showInputBox({
		prompt: `Publish profile name for ${conn.label}`,
		value: profileFileNameFor(conn.label),
		validateInput: (v) => (!v.trim() ? 'Enter a name' : /[<>:"/\\|?*]/.test(v) ? 'Not a valid file name' : null),
	});
	if (!name) return undefined;
	const fileName = /\.xml$/i.test(name.trim()) ? name.trim() : `${name.trim()}.xml`;
	const target = path.join(profilesDir, fileName);
	if (await pathExists(target)) {
		const overwrite = await vscode.window.showWarningMessage(`${fileName} already exists. Replace it?`, { modal: true }, 'Replace');
		if (overwrite !== 'Replace') return undefined;
	}
	const xml = buildPublishProfileForCluster(conn, {
		applicationParameterFile: relativeFromProfiles(profilesDir, files.applicationParameterFileAbs),
		startupServiceParameterFile: relativeFromProfiles(profilesDir, files.startupServiceParameterFileAbs),
	});
	await fsp.mkdir(profilesDir, { recursive: true });
	await fsp.writeFile(target, xml, 'utf8');
	logger.info(`Wrote publish profile ${target} for ${conn.label} (${conn.endpoint}).`);
	try {
		const sfprojXml = await fsp.readFile(project.sfproj.path, 'utf8');
		const patched = addSfprojNoneItem(sfprojXml, `PublishProfiles\\${fileName}`);
		if (patched !== sfprojXml) await fsp.writeFile(project.sfproj.path, patched, 'utf8');
	} catch (err) {
		logger.warn(`Couldn't add ${fileName} to ${path.basename(project.sfproj.path)}: ${(err as Error).message}`);
	}
	await vscode.window.showTextDocument(vscode.Uri.file(target), { preview: false });
	return target;
}

/**
 * After a publish to a saved cluster that no profile targets, offers to save
 * one, unless the user declined for this cluster before.
 */
export async function offerToSavePublishProfile(
	project: ApplicationProject,
	conn: ClusterConnection,
	files: ClusterParameterFiles,
	memento: vscode.Memento | undefined,
	logger: Logger,
): Promise<void> {
	const declined = memento?.get<string[]>(NO_PROFILE_OFFER_KEY, []) ?? [];
	if (declined.includes(conn.id) || (await hasProfileForConnection(project, conn))) return;
	const choice = await vscode.window.showInformationMessage(
		`Save a publish profile for ${conn.label}? It lets Visual Studio, CI and teammates publish to the same cluster.`,
		'Save…',
		"Don't Ask Again for This Cluster",
	);
	if (choice === 'Save…') await writePublishProfileForCluster(project, conn, files, logger);
	else if (choice && memento) await memento.update(NO_PROFILE_OFFER_KEY, [...declined, conn.id]);
}

/** `serviceFabric.cluster.createPublishProfile`: the given (or a picked) cluster → a new publish profile. */
export async function createPublishProfileFromCluster(
	watcher: ProjectLookup,
	connections: ConnectionStore,
	logger: Logger,
	connection?: ClusterConnection,
): Promise<void> {
	let conn = connection;
	if (!conn) {
		const all = connections.list();
		if (all.length === 0) {
			vscode.window.showInformationMessage('No clusters configured. Use "Add Cluster…" in the Clusters view first.');
			return;
		}
		const active = connections.getActive();
		const picked = await vscode.window.showQuickPick(
			all.map((c) => ({ label: c.label, description: c.endpoint, detail: c.id === active?.id ? 'Active cluster' : undefined, conn: c })),
			{ placeHolder: 'Create a publish profile for which cluster?' },
		);
		if (!picked) return;
		conn = picked.conn;
	}
	const project = await resolveTargetProject(watcher, undefined);
	if (!project) return;
	const files = await pickParameterFilesForCluster(project, conn);
	if (!files) return;
	await writePublishProfileForCluster(project, conn, files, logger);
}
