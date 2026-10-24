import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { ApplicationProject } from '../project/sfprojModel';
import type { Logger } from '../util/logger';
import { resolveTargetProject, type ProjectCommandTarget, type ProjectLookup } from './buildCommands';

/** `workspaceState` key: image name → Dockerfile it is built from. */
const DOCKERFILES_KEY = 'serviceFabric.containers.dockerfiles';

export interface ContainerImageRef {
	image: string;
	/** Service package (ServiceManifest Name) that runs it. */
	servicePackage: string;
}

/** The `<ContainerHost><ImageName>` of each container service in the project. Parameterised names (`[Image]`) are skipped. */
export async function containerImagesOf(project: ApplicationProject): Promise<ContainerImageRef[]> {
	const out: ContainerImageRef[] = [];
	for (const sm of project.serviceManifests) {
		const xml = await fsp.readFile(sm.path, 'utf8').catch(() => '');
		for (const m of xml.matchAll(/<ContainerHost>[\s\S]*?<ImageName>\s*([^<\s]+)\s*<\/ImageName>/g)) {
			if (!m[1].includes('[')) out.push({ image: m[1], servicePackage: sm.name });
		}
	}
	return out;
}

/** `myregistry.azurecr.io` for ACR images, else `undefined`. */
export function acrRegistryOf(image: string): string | undefined {
	const host = image.split('/')[0];
	return /\.azurecr\.(io|cn|us)$/i.test(host) ? host : undefined;
}

/** Runs a process as a VS Code task (output in the terminal); resolves with its exit code, or `undefined` if it couldn't start. */
function runProcess(name: string, command: string, args: string[], cwd: string): Promise<number | undefined> {
	const task = new vscode.Task(
		{ type: 'servicefabric-container', step: name },
		vscode.TaskScope.Workspace,
		name,
		'Service Fabric',
		new vscode.ProcessExecution(command, args, { cwd }),
	);
	task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared, clear: false };
	return new Promise((resolve) => {
		let exitCode: number | undefined;
		const subs: vscode.Disposable[] = [];
		void vscode.tasks.executeTask(task).then((execution) => {
			subs.push(
				vscode.tasks.onDidEndTaskProcess((e) => {
					if (e.execution === execution) exitCode = e.exitCode;
				}),
				vscode.tasks.onDidEndTask((e) => {
					if (e.execution !== execution) return;
					subs.forEach((s) => s.dispose());
					resolve(exitCode);
				}),
			);
		}, () => resolve(undefined));
	});
}

async function pickDockerfile(image: string, memento: vscode.Memento): Promise<string | undefined> {
	const saved = memento.get<Record<string, string>>(DOCKERFILES_KEY, {});
	const known = saved[image];
	if (known && (await fsp.stat(known).then(() => true, () => false))) return known;
	const found = await vscode.workspace.findFiles('**/{Dockerfile,Dockerfile.*,*.Dockerfile,*.dockerfile}', '**/{node_modules,bin,obj}/**', 50);
	type Item = vscode.QuickPickItem & { file?: string };
	const items: Item[] = [
		...found.map((u) => ({ label: path.basename(u.fsPath), description: vscode.workspace.asRelativePath(u), file: u.fsPath })),
		{ label: '$(folder-opened) Browse…' },
	];
	const picked = await vscode.window.showQuickPick(items, { placeHolder: `Dockerfile that builds ${image}` });
	if (!picked) return undefined;
	let file = picked.file;
	if (!file) file = (await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Use Dockerfile', title: `Dockerfile for ${image}` }))?.[0]?.fsPath;
	if (!file) return undefined;
	await memento.update(DOCKERFILES_KEY, { ...saved, [image]: file });
	return file;
}

/**
 * Builds and pushes the given images: `az acr login` for Azure Container
 * Registry images, then `docker build` (context: the Dockerfile's folder) and
 * `docker push`. Returns `false` if a step failed or was cancelled.
 */
export async function buildAndPushImages(images: ContainerImageRef[], memento: vscode.Memento, logger: Logger): Promise<boolean> {
	const loggedIn = new Set<string>();
	for (const { image, servicePackage } of images) {
		const dockerfile = await pickDockerfile(image, memento);
		if (!dockerfile) return false;
		const context = path.dirname(dockerfile);
		const registry = acrRegistryOf(image);
		if (registry && !loggedIn.has(registry)) {
			const code = await runProcess(`az acr login ${registry}`, 'az', ['acr', 'login', '--name', registry.split('.')[0]], context);
			if (code !== 0) {
				vscode.window.showErrorMessage(
					code === undefined
						? `Couldn't run the Azure CLI (az) to sign in to ${registry}. Install it, or run "docker login ${registry}" yourself and try again.`
						: `"az acr login" for ${registry} failed (exit code ${code}). See the terminal; run "az login" first if you aren't signed in.`,
				);
				return false;
			}
			loggedIn.add(registry);
		}
		logger.info(`Building ${image} for ${servicePackage} from ${dockerfile}.`);
		const build = await runProcess(`docker build ${image}`, 'docker', ['build', '-t', image, '-f', dockerfile, context], context);
		if (build !== 0) {
			vscode.window.showErrorMessage(
				build === undefined ? "Couldn't run docker. Install Docker and make sure it is on PATH and running." : `docker build of ${image} failed (exit code ${build}). See the terminal.`,
			);
			return false;
		}
		const push = await runProcess(`docker push ${image}`, 'docker', ['push', image], context);
		if (push !== 0) {
			vscode.window.showErrorMessage(`docker push of ${image} failed (exit code ${push}). Check you're signed in to the registry (docker login).`);
			return false;
		}
		logger.info(`Pushed ${image}.`);
	}
	return true;
}

/** `serviceFabric.containers.buildAndPush`: picks container images of a project and builds and pushes them. */
export async function buildAndPushContainerImages(
	projects: ProjectLookup,
	memento: vscode.Memento,
	logger: Logger,
	target?: ProjectCommandTarget,
): Promise<void> {
	const project = await resolveTargetProject(projects, target);
	if (!project) return;
	const images = await containerImagesOf(project);
	if (images.length === 0) {
		vscode.window.showInformationMessage(`${path.basename(project.sfproj.path)} has no container services with a literal <ImageName>.`);
		return;
	}
	let chosen = images;
	if (images.length > 1) {
		const picked = await vscode.window.showQuickPick(
			images.map((i) => ({ label: i.image, description: i.servicePackage, picked: true, ref: i })),
			{ canPickMany: true, placeHolder: 'Images to build and push' },
		);
		if (!picked || picked.length === 0) return;
		chosen = picked.map((p) => p.ref);
	}
	if (await buildAndPushImages(chosen, memento, logger)) {
		vscode.window.showInformationMessage(`Pushed ${chosen.map((c) => c.image).join(', ')}.`);
	}
}
