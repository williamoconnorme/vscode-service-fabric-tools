import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { SfRestClient } from '../cluster/sfRestClient';
import { gatewayKey } from '../deploy/clusterPublishProfile';
import { applicationIdOf } from '../deploy/restDeploy';
import {
	applyApplicationBump,
	applyServiceBump,
	describeVersionBump,
	planHasChanges,
	planVersionBump,
	readPackageState,
	type ApplicationPackageState,
} from '../deploy/versionBump';
import type { ApplicationProject } from '../project/sfprojModel';
import type { Logger } from '../util/logger';

/** `workspaceState` key: package state at the last successful publish, by `.sfproj` and cluster. */
const BASELINES_KEY = 'serviceFabric.publishBaselines';

type AutoBump = 'prompt' | 'always' | 'never';

function baselineKey(project: ApplicationProject, endpoint: string): string {
	return `${path.normalize(project.sfproj.path).toLowerCase()}|${gatewayKey(endpoint)}`;
}

export interface VersionBumpContext {
	project: ApplicationProject;
	packagePath: string;
	client: SfRestClient;
	applicationName: string | undefined;
	/** Whether this publish upgrades an existing application (profile `<UpgradeDeployment Enabled>` or `deploy.upgradeMode`). */
	upgradeEnabled: boolean;
	memento: vscode.Memento | undefined;
	logger: Logger;
}

/**
 * Before an upgrade: if the cluster already runs the application at the
 * version being published, or packages changed without a version bump, offers
 * to raise the versions (per `serviceFabric.deploy.autoBumpVersions`). Bumps
 * are written to the source manifests and to the built package, so no
 * repackaging is needed. Returns `false` when the user cancels the publish.
 */
export async function bumpVersionsBeforeUpgrade(ctx: VersionBumpContext): Promise<boolean> {
	const { project, packagePath, client, applicationName, logger } = ctx;
	const mode = vscode.workspace.getConfiguration('serviceFabric').get<AutoBump>('deploy.autoBumpVersions') ?? 'prompt';
	if (!ctx.upgradeEnabled || !applicationName || mode === 'never') return true;
	let existing;
	try {
		existing = await client.getApplication(applicationIdOf(applicationName));
	} catch (err) {
		logger.warn(`Skipping the version check: couldn't read ${applicationName} from the cluster (${(err as Error).message}).`);
		return true;
	}
	let current: ApplicationPackageState;
	try {
		current = await readPackageState(packagePath);
	} catch (err) {
		logger.warn(`Skipping the version check: ${(err as Error).message}`);
		return true;
	}
	if (!existing || existing.typeName !== current.applicationTypeName) return true;
	const baseline = ctx.memento?.get<Record<string, ApplicationPackageState>>(BASELINES_KEY, {})[baselineKey(project, client.endpoint)];
	const plan = planVersionBump(current, baseline, existing.typeVersion);
	if (!planHasChanges(plan)) return true;

	const lines = describeVersionBump(plan, current.applicationTypeName);
	const sameVersion = plan.application !== undefined;
	if (mode === 'prompt') {
		const bump = 'Bump Versions and Upgrade';
		const skip = sameVersion ? 'Redeploy Anyway' : 'Publish As Is';
		const message = sameVersion
			? `${existing.name} is already at ${existing.typeVersion} on the cluster. Bump versions and upgrade it?`
			: `Some packages changed since the last publish to this cluster but kept their versions, so the upgrade would be rejected. Bump them?`;
		const note = plan.changedOnly
			? ''
			: '\n\nThere is no record of the last publish of this version to this cluster, so every service is bumped and will restart.';
		const skipNote = sameVersion ? `\n\n"${skip}" removes and recreates the application instead (serviceFabric.deploy.overwriteBehavior).` : '';
		const choice = await vscode.window.showInformationMessage(message, { modal: true, detail: `${lines.join('\n')}${note}${skipNote}` }, bump, skip);
		if (choice === undefined) {
			logger.info('Publish cancelled at the version bump prompt.');
			return false;
		}
		if (choice === skip) return true;
	}

	logger.info(`Bumping versions${plan.changedOnly ? ' of changed packages' : ' (no baseline for this cluster: every service)'}:`);
	for (const line of lines) logger.info(`  ${line}`);
	const rewrite = async (files: string[], apply: (xml: string) => string): Promise<void> => {
		for (const file of new Set(files.map((f) => path.normalize(f)))) {
			try {
				const xml = await fsp.readFile(file, 'utf8');
				const updated = apply(xml);
				if (updated !== xml) await fsp.writeFile(file, updated, 'utf8');
			} catch (err) {
				logger.warn(`Couldn't update versions in ${file}: ${(err as Error).message}`);
			}
		}
	};
	for (const svc of plan.services) {
		const source = project.serviceManifests.find((s) => s.name === svc.name)?.path;
		await rewrite([path.join(packagePath, svc.name, 'ServiceManifest.xml'), ...(source ? [source] : [])], (xml) => applyServiceBump(xml, svc));
	}
	const appSource = project.applicationManifest?.path;
	await rewrite([path.join(packagePath, 'ApplicationManifest.xml'), ...(appSource ? [appSource] : [])], (xml) => applyApplicationBump(xml, plan));
	return true;
}

/** Records the published package's state as the baseline for the next publish to the same cluster. */
export async function savePublishBaseline(
	project: ApplicationProject,
	packagePath: string,
	endpoint: string,
	memento: vscode.Memento | undefined,
	logger: Logger,
): Promise<void> {
	if (!memento) return;
	try {
		const state = await readPackageState(packagePath);
		const all = memento.get<Record<string, ApplicationPackageState>>(BASELINES_KEY, {});
		await memento.update(BASELINES_KEY, { ...all, [baselineKey(project, endpoint)]: state });
	} catch (err) {
		logger.warn(`Couldn't record the published package versions: ${(err as Error).message}`);
	}
}
