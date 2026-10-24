/**
 * The REST deploy engine: uploads, provisions and creates/upgrades an
 * application over the Service Fabric HTTP gateway, so Publish and Remove work
 * without the Service Fabric SDK (macOS, Linux, or Windows without the SDK).
 *
 * Mirrors what `Deploy-FabricApplication.ps1` → `Publish-NewServiceFabricApplication`
 * / `Publish-UpgradedServiceFabricApplication` do. Pure apart from the injected
 * client, file system and logger (no `vscode` imports), so it is unit-tested
 * against a fake client.
 */
import * as fsp from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ApplicationUpgradeDescription, SfRestClient } from '../cluster/sfRestClient';
import type { PublishProfileUpgrade, UpgradeMode } from './deployScript';
import { toServiceDescription, type StartupServiceSpec } from './startupServices';

/** The gateway calls the engine makes. A structural subset of {@link SfRestClient}, so tests can fake it. */
export type RestDeployClient = Pick<
	SfRestClient,
	| 'getClusterManifest'
	| 'getApplicationTypes'
	| 'getApplication'
	| 'getApplications'
	| 'getServices'
	| 'uploadFile'
	| 'uploadChunk'
	| 'commitUploadSession'
	| 'deleteUploadSession'
	| 'deleteImageStoreContent'
	| 'provisionApplicationType'
	| 'unprovisionApplicationType'
	| 'createApplication'
	| 'upgradeApplication'
	| 'getApplicationUpgradeProgress'
	| 'deleteApplication'
	| 'createService'
>;

/** Logger surface used here (structurally matches util/logger's Logger). */
export interface DeployLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

/** Structural `vscode.CancellationToken`. */
export interface DeployCancellation {
	readonly isCancellationRequested: boolean;
}

/** What to do when the application already exists at the same type version (`-OverwriteBehavior`). */
export type OverwriteBehavior = 'Never' | 'Always' | 'SameAppTypeAndVersion';

/** Publish-profile settings that drive the REST engine. */
export interface PublishProfileDeploySettings {
	/** Not in the profile: the script's `-OverwriteBehavior`, from `serviceFabric.deploy.overwriteBehavior`. */
	overwriteBehavior: OverwriteBehavior;
	upgrade?: PublishProfileUpgrade;
	/** `<CopyPackageParameters CopyPackageTimeoutSec>`; overall ceiling for the upload. */
	copyPackageTimeoutSec?: number;
	/** `<CopyPackageParameters CompressPackage>`; not supported yet (uploads uncompressed). */
	compressPackage?: boolean;
	/** `<RegisterApplicationParameters RegisterApplicationTypeTimeoutSec>`. */
	registerApplicationTypeTimeoutSec?: number;
}

export interface RestDeployOptions {
	/** Resolved `pkg/<Config>` folder holding ApplicationManifest.xml. */
	packageRoot: string;
	applicationTypeName: string;
	applicationTypeVersion: string;
	/** `fabric:/<Name>`, see `resolveApplicationName`. */
	applicationName: string;
	/** Application parameters sent to the cluster (from the parameter file; manifest defaults are implicit). */
	parameters: Record<string, string>;
	profile: PublishProfileDeploySettings;
	/** Services from StartupServices.xml, created after a fresh create. */
	startupServices?: StartupServiceSpec[];
	token?: DeployCancellation;
	progress?: (message: string, increment?: number) => void;
	/** File system access; defaults to Node's. */
	fs?: PackageFs;
	/** Polling interval for provision / upgrade / delete waits. Default 2000 ms. */
	pollIntervalMs?: number;
	/** Wait limit for deletes and unprovisions to finish. Default 120 s. */
	waitSeconds?: number;
}

/** A file in the application package, relative path with `/` separators. */
export interface PackageFile {
	relativePath: string;
	absolutePath: string;
	size: number;
}

/** File-system access the engine needs; injectable for tests. */
export interface PackageFs {
	/** Every file under `root` plus every directory (relative, `/`-separated; the root itself is `''`). */
	walk(root: string): Promise<{ files: PackageFile[]; directories: string[] }>;
	/** Bytes `start` (inclusive) to `end` (exclusive) of a file. */
	read(file: string, start: number, end: number): Promise<Buffer>;
}

/** Thrown when the user cancels; the deploy cleans up before rethrowing it. */
export class DeployCancelledError extends Error {
	constructor() {
		super('Deployment cancelled.');
		this.name = 'DeployCancelledError';
	}
}

/** Files at or below this size are uploaded in one request; larger ones in chunks of this size. */
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;
const DEFAULT_COPY_TIMEOUT_SEC = 600;

// ---------------------------------------------------------------------------
// Pure planning helpers
// ---------------------------------------------------------------------------

/** `ImageStoreConnectionString` from a cluster manifest, or `undefined` when absent. */
export function parseImageStoreConnectionString(clusterManifestXml: string): string | undefined {
	const m =
		/<Parameter\b[^>]*\bName\s*=\s*"ImageStoreConnectionString"[^>]*\bValue\s*=\s*"([^"]*)"/i.exec(clusterManifestXml) ??
		/<Parameter\b[^>]*\bValue\s*=\s*"([^"]*)"[^>]*\bName\s*=\s*"ImageStoreConnectionString"/i.exec(clusterManifestXml);
	return m?.[1];
}

/** Gateway application id for a `fabric:/` name (`fabric:/a/b` → `a~b`), URL-encoded. */
export function applicationIdOf(applicationName: string): string {
	return encodeURIComponent(applicationName.replace(/^fabric:\//, '').replace(/\//g, '~'));
}

/** What the cluster has now, as far as the decision table cares. */
export interface ClusterDeployState {
	/** The type version being deployed is already provisioned. */
	typeVersionProvisioned: boolean;
	/** The application, when it exists. */
	existingApp?: { typeName: string; typeVersion: string };
}

/** The steps a deploy takes, in order. */
export interface DeployPlan {
	/** Delete the existing application first (overwrite). */
	deleteExistingApp: boolean;
	/** Unprovision the same type version first, so changed package contents get registered. */
	unprovisionFirst: boolean;
	/** Upload and provision the package. */
	provision: boolean;
	action: 'create' | 'upgrade';
	/** One-line explanation for the log. */
	reason: string;
}

/**
 * The deploy decision table (§4.2 step 2 of the 1.2.0 plan), matching
 * `Publish-NewServiceFabricApplication` / `Publish-UpgradedServiceFabricApplication`.
 * Throws when the overwrite behavior forbids the deploy.
 */
export function planDeploy(
	state: ClusterDeployState,
	target: { applicationName: string; typeName: string; typeVersion: string },
	settings: Pick<PublishProfileDeploySettings, 'overwriteBehavior' | 'upgrade'>,
): DeployPlan {
	const app = state.existingApp;
	const overwrite = settings.overwriteBehavior;
	if (!app) {
		return {
			deleteExistingApp: false,
			unprovisionFirst: false,
			provision: !state.typeVersionProvisioned,
			action: 'create',
			reason: `${target.applicationName} doesn't exist; creating it.`,
		};
	}
	const describeApp = `${target.applicationName} (type ${app.typeName} ${app.typeVersion})`;
	if (app.typeName !== target.typeName) {
		if (overwrite !== 'Always') {
			throw new Error(
				`An application named ${describeApp} already exists with a different application type than ${target.typeName}. Remove it first, or set serviceFabric.deploy.overwriteBehavior to "Always".`,
			);
		}
		return {
			deleteExistingApp: true,
			unprovisionFirst: false,
			provision: !state.typeVersionProvisioned,
			action: 'create',
			reason: `${describeApp} has a different type; OverwriteBehavior=Always removes and recreates it.`,
		};
	}
	if (app.typeVersion === target.typeVersion) {
		if (overwrite === 'Never') {
			throw new Error(
				`${describeApp} already exists at version ${target.typeVersion}. Bump ApplicationTypeVersion and enable upgrade in the publish profile, remove the application first, or set serviceFabric.deploy.overwriteBehavior to "SameAppTypeAndVersion".`,
			);
		}
		return {
			deleteExistingApp: true,
			unprovisionFirst: state.typeVersionProvisioned,
			provision: true,
			action: 'create',
			reason: `${describeApp} is already at ${target.typeVersion}; OverwriteBehavior=${overwrite} removes it and redeploys.`,
		};
	}
	if (settings.upgrade?.enabled) {
		return {
			deleteExistingApp: false,
			unprovisionFirst: false,
			provision: !state.typeVersionProvisioned,
			action: 'upgrade',
			reason: `${describeApp} will be upgraded to ${target.typeVersion} (${settings.upgrade.mode}).`,
		};
	}
	if (overwrite !== 'Always') {
		throw new Error(
			`${describeApp} already exists at another version. Enable <UpgradeDeployment Enabled="true"> in the publish profile to upgrade it, remove it first, or set serviceFabric.deploy.overwriteBehavior to "Always".`,
		);
	}
	return {
		deleteExistingApp: true,
		unprovisionFirst: false,
		provision: !state.typeVersionProvisioned,
		action: 'create',
		reason: `${describeApp} is at another version and upgrade is disabled; OverwriteBehavior=Always removes and recreates it.`,
	};
}

/** One gateway call of an upload. */
export type UploadStep =
	| { kind: 'file'; file: PackageFile; storePath: string }
	| { kind: 'chunked'; file: PackageFile; storePath: string; chunks: { start: number; end: number }[] }
	| { kind: 'dirMarker'; storePath: string };

/**
 * Orders an upload the way the native image store expects (as `sfctl
 * application upload` does): every file, then a `_.dir` marker per folder,
 * deepest folders first and the package root last. Files above
 * {@link UPLOAD_CHUNK_BYTES} are split into chunks with inclusive end offsets.
 */
export function planUpload(
	files: PackageFile[],
	directories: string[],
	storeRoot: string,
	chunkBytes = UPLOAD_CHUNK_BYTES,
): { fileSteps: UploadStep[]; markerSteps: UploadStep[] } {
	const join = (rel: string): string => (rel ? `${storeRoot}/${rel}` : storeRoot);
	const fileSteps: UploadStep[] = files.map((file) => {
		const storePath = join(file.relativePath);
		if (file.size <= chunkBytes) return { kind: 'file', file, storePath };
		const chunks: { start: number; end: number }[] = [];
		for (let start = 0; start < file.size; start += chunkBytes) {
			chunks.push({ start, end: Math.min(start + chunkBytes, file.size) - 1 });
		}
		return { kind: 'chunked', file, storePath, chunks };
	});
	const depth = (rel: string): number => (rel ? rel.split('/').length : 0);
	const markerSteps: UploadStep[] = [...new Set(['', ...directories])]
		.sort((a, b) => depth(b) - depth(a) || a.localeCompare(b))
		.map((dir) => ({ kind: 'dirMarker', storePath: `${join(dir)}/_.dir` }));
	return { fileSteps, markerSteps };
}

const SECONDS_TO_MS_PARAMS: Record<string, string> = {
	HealthCheckWaitDurationSec: 'HealthCheckWaitDurationInMilliseconds',
	HealthCheckStableDurationSec: 'HealthCheckStableDurationInMilliseconds',
	HealthCheckRetryTimeoutSec: 'HealthCheckRetryTimeoutInMilliseconds',
	UpgradeTimeoutSec: 'UpgradeTimeoutInMilliseconds',
	UpgradeDomainTimeoutSec: 'UpgradeDomainTimeoutInMilliseconds',
};

/** Profile keys that mean something only to PowerShell (`-Force` skips a confirmation) or are the mode switch. */
const IGNORED_UPGRADE_PARAMS = new Set(['force', 'monitored', 'unmonitoredauto', 'unmonitoredmanual', 'mode']);

function isTrue(value: string | undefined): boolean {
	return /^\s*true\s*$/i.test(value ?? '');
}

function toNumber(value: string, key: string): number {
	const n = Number(value);
	if (!Number.isFinite(n)) throw new Error(`Upgrade parameter ${key}="${value}" in the publish profile isn't a number.`);
	return n;
}

/**
 * Maps a profile's `<UpgradeDeployment>` onto the REST upgrade description.
 * Parameter names are those of `Start-ServiceFabricApplicationUpgrade`
 * (`HealthCheckWaitDurationSec`, `FailureAction`, …). Unknown keys are returned
 * in `warnings` and otherwise ignored.
 */
export function buildUpgradeDescription(
	applicationName: string,
	targetVersion: string,
	parameters: Record<string, string>,
	upgrade: PublishProfileUpgrade,
): { description: ApplicationUpgradeDescription; warnings: string[] } {
	const warnings: string[] = [];
	const description: ApplicationUpgradeDescription = {
		Name: applicationName,
		TargetApplicationTypeVersion: targetVersion,
		Parameters: Object.entries(parameters).map(([Key, Value]) => ({ Key, Value })),
		UpgradeKind: 'Rolling',
		RollingUpgradeMode: upgrade.mode,
	};
	const monitoring: Record<string, string> = {};
	const health: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(upgrade.parameters)) {
		const lower = key.toLowerCase();
		if (IGNORED_UPGRADE_PARAMS.has(lower)) continue;
		const msKey = Object.entries(SECONDS_TO_MS_PARAMS).find(([k]) => k.toLowerCase() === lower)?.[1];
		if (msKey) {
			monitoring[msKey] = String(Math.round(toNumber(value, key) * 1000));
		} else if (lower === 'failureaction') {
			monitoring.FailureAction = /^manual$/i.test(value.trim()) ? 'Manual' : 'Rollback';
		} else if (lower === 'forcerestart') {
			description.ForceRestart = isTrue(value);
		} else if (lower === 'upgradereplicasetchecktimeoutsec' || lower === 'replicaquorumtimeoutsec') {
			description.UpgradeReplicaSetCheckTimeoutInSeconds = toNumber(value, key);
		} else if (lower === 'instanceclosedelaydurationsec') {
			description.InstanceCloseDelayDurationInSeconds = toNumber(value, key);
		} else if (lower === 'considerwarningaserror') {
			health.ConsiderWarningAsError = isTrue(value);
		} else if (lower === 'maxpercentunhealthydeployedapplications') {
			health.MaxPercentUnhealthyDeployedApplications = toNumber(value, key);
		} else if (lower === 'defaultservicetypehealthpolicy') {
			// "MaxPercentUnhealthyServices,MaxPercentUnhealthyPartitionsPerService,MaxPercentUnhealthyReplicasPerPartition"
			const parts = value.split(',').map((p) => toNumber(p.trim(), key));
			if (parts.length !== 3) {
				warnings.push(`DefaultServiceTypeHealthPolicy="${value}" should be three comma-separated percentages; ignored.`);
			} else {
				health.DefaultServiceTypeHealthPolicy = {
					MaxPercentUnhealthyServices: parts[0],
					MaxPercentUnhealthyPartitionsPerService: parts[1],
					MaxPercentUnhealthyReplicasPerPartition: parts[2],
				};
			}
		} else {
			warnings.push(`Upgrade parameter ${key} isn't supported by the REST engine; ignored.`);
		}
	}
	if (upgrade.mode === 'Monitored') {
		description.MonitoringPolicy = { FailureAction: 'Rollback', ...monitoring };
		if (Object.keys(health).length > 0) description.ApplicationHealthPolicy = health;
	} else if (Object.keys(monitoring).length > 0 || Object.keys(health).length > 0) {
		warnings.push(`Health-check and failure-action parameters only apply to Monitored upgrades; ignored for ${upgrade.mode}.`);
	}
	return { description, warnings };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const nodeFs: PackageFs = {
	async walk(root) {
		const files: PackageFile[] = [];
		const directories: string[] = [];
		const visit = async (dir: string, rel: string): Promise<void> => {
			for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
				const abs = path.join(dir, entry.name);
				const childRel = rel ? `${rel}/${entry.name}` : entry.name;
				if (entry.isDirectory()) {
					directories.push(childRel);
					await visit(abs, childRel);
				} else if (entry.isFile()) {
					files.push({ relativePath: childRel, absolutePath: abs, size: (await fsp.stat(abs)).size });
				}
			}
		};
		await visit(root, '');
		return { files, directories };
	},
	async read(file, start, end) {
		const handle = await fsp.open(file, 'r');
		try {
			const buffer = Buffer.alloc(end - start);
			let offset = 0;
			while (offset < buffer.length) {
				const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, start + offset);
				if (bytesRead === 0) break;
				offset += bytesRead;
			}
			return buffer.subarray(0, offset);
		} finally {
			await handle.close();
		}
	},
};

function checkCancelled(token: DeployCancellation | undefined): void {
	if (token?.isCancellationRequested) throw new DeployCancelledError();
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(n: number): string {
	return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Deploys an application package over the HTTP gateway. Throws on failure (after cleaning up). */
export async function deployViaRest(client: RestDeployClient, opts: RestDeployOptions, logger: DeployLogger): Promise<void> {
	const { applicationName, applicationTypeName: typeName, applicationTypeVersion: typeVersion, token } = opts;
	const appId = applicationIdOf(applicationName);
	const pollMs = opts.pollIntervalMs ?? 2000;
	const waitSeconds = opts.waitSeconds ?? 120;
	const report = (message: string, increment?: number): void => {
		logger.info(message);
		opts.progress?.(message, increment);
	};

	// 1. Image store check.
	await checkImageStore(client, logger);
	checkCancelled(token);

	// 2. Decide what to do.
	const types = await client.getApplicationTypes();
	const existing = await client.getApplication(appId);
	const plan = planDeploy(
		{
			typeVersionProvisioned: types.some((t) => t.name === typeName && t.version === typeVersion),
			existingApp: existing ? { typeName: existing.typeName, typeVersion: existing.typeVersion } : undefined,
		},
		{ applicationName, typeName, typeVersion },
		opts.profile,
	);
	logger.info(plan.reason);

	if (plan.deleteExistingApp) {
		report(`Removing ${applicationName}...`);
		await client.deleteApplication(appId);
		await waitFor(async () => !(await client.getApplication(appId)), waitSeconds, pollMs, token, `${applicationName} to be removed`);
	}
	if (plan.unprovisionFirst) {
		report(`Unregistering ${typeName} ${typeVersion} so the new package contents are registered...`);
		await client.unprovisionApplicationType(typeName, typeVersion);
		await waitFor(
			async () => !(await client.getApplicationTypes()).some((t) => t.name === typeName && t.version === typeVersion),
			waitSeconds,
			pollMs,
			token,
			`${typeName} ${typeVersion} to be unregistered`,
		);
	}

	let provisionedHere = false;
	let storeRoot: string | undefined;
	let succeeded = false;
	try {
		if (plan.provision) {
			storeRoot = `${typeName}_${typeVersion}_${randomUUID().slice(0, 8)}`.replace(/[^\w.-]/g, '_');
			await uploadPackage(client, opts, storeRoot, logger, report);
			checkCancelled(token);
			report(`Registering application type ${typeName} ${typeVersion}...`, 5);
			const registerTimeoutMs = (opts.profile.registerApplicationTypeTimeoutSec ?? 300) * 1000;
			await client.provisionApplicationType(storeRoot, true, Math.min(registerTimeoutMs, 300000));
			provisionedHere = true;
			await waitForProvisioned(client, typeName, typeVersion, opts.profile.registerApplicationTypeTimeoutSec ?? 600, pollMs, token);
			logger.info(`Application type ${typeName} ${typeVersion} registered.`);
			// The package is no longer needed once provisioned (as in Publish-NewServiceFabricApplication).
			await removeFromImageStore(client, storeRoot, logger);
			storeRoot = undefined;
		} else {
			logger.info(`Application type ${typeName} ${typeVersion} is already registered; skipping upload.`);
		}
		checkCancelled(token);

		if (plan.action === 'create') {
			report(`Creating application ${applicationName}...`, 5);
			await client.createApplication({
				Name: applicationName,
				TypeName: typeName,
				TypeVersion: typeVersion,
				ParameterList: Object.entries(opts.parameters).map(([Key, Value]) => ({ Key, Value })),
			});
			logger.info(`Created ${applicationName}.`);
			await createStartupServices(client, appId, applicationName, opts.startupServices ?? [], logger);
		} else {
			await runUpgrade(client, appId, opts, logger, report, pollMs);
		}
		succeeded = true;
	} finally {
		if (storeRoot) await removeFromImageStore(client, storeRoot, logger);
		if (!succeeded && provisionedHere) await unprovisionIfUnused(client, typeName, typeVersion, logger);
	}
}

async function checkImageStore(client: RestDeployClient, logger: DeployLogger): Promise<void> {
	let manifest: string;
	try {
		manifest = await client.getClusterManifest();
	} catch (err) {
		logger.warn(`Couldn't read the cluster manifest to check the image store; assuming fabric:ImageStore. ${(err as Error).message}`);
		return;
	}
	const store = parseImageStoreConnectionString(manifest);
	if (!store) {
		logger.warn('The cluster manifest has no ImageStoreConnectionString; assuming fabric:ImageStore.');
		return;
	}
	if (!/^fabric:ImageStore$/i.test(store.trim())) {
		const scheme = /^([a-z]+:)/i.exec(store.trim())?.[1] ?? store;
		throw new Error(
			`This cluster's image store (\`${scheme}\`) can't be uploaded to over the HTTP gateway. Use the PowerShell engine on Windows, or \`sfctl application upload\`.`,
		);
	}
}

async function uploadPackage(
	client: RestDeployClient,
	opts: RestDeployOptions,
	storeRoot: string,
	logger: DeployLogger,
	report: (message: string, increment?: number) => void,
): Promise<void> {
	const fs = opts.fs ?? nodeFs;
	const { files, directories } = await fs.walk(opts.packageRoot);
	if (!files.some((f) => f.relativePath === 'ApplicationManifest.xml')) {
		throw new Error(`${opts.packageRoot} has no ApplicationManifest.xml; it isn't an application package.`);
	}
	if (opts.profile.compressPackage) logger.warn('CompressPackage is not supported by the REST engine; uploading uncompressed.');
	const { fileSteps, markerSteps } = planUpload(files, directories, storeRoot);
	const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
	report(`Uploading ${files.length} file(s) (${formatBytes(totalBytes)}) to the image store at ${storeRoot}...`);
	const ceilingSec = opts.profile.copyPackageTimeoutSec ?? DEFAULT_COPY_TIMEOUT_SEC;
	const deadline = Date.now() + ceilingSec * 1000;
	const timeoutFor = (bytes: number): number => {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error(`Uploading the package took longer than ${ceilingSec}s (CopyPackageTimeoutSec).`);
		// 30 s plus 1 s per 256 KB, capped by what's left of the overall budget.
		return Math.min(remaining, 30000 + Math.ceil(bytes / (256 * 1024)) * 1000);
	};
	// The upload accounts for 80% of the progress bar.
	const incrementPerByte = totalBytes > 0 ? 80 / totalBytes : 0;
	let uploaded = 0;
	const runStep = async (step: UploadStep): Promise<void> => {
		checkCancelled(opts.token);
		if (step.kind === 'file') {
			const body = await fs.read(step.file.absolutePath, 0, step.file.size);
			await client.uploadFile(step.storePath, body, timeoutFor(step.file.size));
		} else if (step.kind === 'chunked') {
			const sessionId = randomUUID();
			try {
				for (const chunk of step.chunks) {
					checkCancelled(opts.token);
					const body = await fs.read(step.file.absolutePath, chunk.start, chunk.end + 1);
					await client.uploadChunk(step.storePath, sessionId, chunk.start, chunk.end, step.file.size, body, timeoutFor(body.length));
				}
				await client.commitUploadSession(sessionId, timeoutFor(step.file.size));
			} catch (err) {
				await client.deleteUploadSession(sessionId).catch(() => undefined);
				throw err;
			}
		} else {
			await client.uploadFile(step.storePath, Buffer.alloc(0), timeoutFor(0));
			return;
		}
		uploaded += step.file.size;
		opts.progress?.(
			`Uploaded ${step.file.relativePath} (${formatBytes(uploaded)} of ${formatBytes(totalBytes)})`,
			step.file.size * incrementPerByte,
		);
	};
	await runWithConcurrency(fileSteps, UPLOAD_CONCURRENCY, runStep);
	for (const marker of markerSteps) await runStep(marker);
	logger.info(`Upload complete (${files.length} file(s), ${formatBytes(totalBytes)}).`);
}

/** Runs `work` over `items` with at most `limit` in flight; the first failure stops new work and is rethrown. */
async function runWithConcurrency<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	let failure: unknown;
	const worker = async (): Promise<void> => {
		while (failure === undefined && next < items.length) {
			const item = items[next++];
			try {
				await work(item);
			} catch (err) {
				failure ??= err;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	if (failure !== undefined) throw failure;
}

async function removeFromImageStore(client: RestDeployClient, storeRoot: string, logger: DeployLogger): Promise<void> {
	try {
		await client.deleteImageStoreContent(storeRoot);
		logger.info(`Removed ${storeRoot} from the image store.`);
	} catch (err) {
		logger.warn(`Couldn't remove ${storeRoot} from the image store: ${(err as Error).message}`);
	}
}

async function waitFor(
	condition: () => Promise<boolean>,
	timeoutSec: number,
	pollMs: number,
	token: DeployCancellation | undefined,
	what: string,
): Promise<void> {
	const deadline = Date.now() + timeoutSec * 1000;
	for (;;) {
		if (await condition()) return;
		checkCancelled(token);
		if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutSec}s waiting for ${what}.`);
		await delay(pollMs);
	}
}

async function waitForProvisioned(
	client: RestDeployClient,
	typeName: string,
	typeVersion: string,
	timeoutSec: number,
	pollMs: number,
	token: DeployCancellation | undefined,
): Promise<void> {
	let failure: string | undefined;
	await waitFor(
		async () => {
			const type = (await client.getApplicationTypes()).find((t) => t.name === typeName && t.version === typeVersion);
			if (type?.status === 'Failed') {
				failure = type.statusDetails || 'no details';
				return true;
			}
			return type?.status === 'Available';
		},
		timeoutSec,
		pollMs,
		token,
		`${typeName} ${typeVersion} to be registered`,
	);
	if (failure) throw new Error(`Registering ${typeName} ${typeVersion} failed: ${failure}`);
}

async function createStartupServices(
	client: RestDeployClient,
	appId: string,
	applicationName: string,
	services: StartupServiceSpec[],
	logger: DeployLogger,
): Promise<void> {
	if (services.length === 0) return;
	const existing = new Set((await client.getServices(appId)).map((s) => s.name));
	for (const spec of services) {
		const description = toServiceDescription(spec, applicationName);
		const serviceName = String(description.ServiceName);
		if (existing.has(serviceName)) {
			logger.info(`Service ${serviceName} already exists (default service); skipping.`);
			continue;
		}
		logger.info(`Creating service ${serviceName} (${spec.kind}, type ${spec.serviceTypeName})...`);
		await client.createService(appId, description);
	}
}

const UPGRADE_DONE = new Set(['RollingForwardCompleted']);
const UPGRADE_FAILED = new Set(['RollingBackCompleted', 'Failed']);

async function runUpgrade(
	client: RestDeployClient,
	appId: string,
	opts: RestDeployOptions,
	logger: DeployLogger,
	report: (message: string, increment?: number) => void,
	pollMs: number,
): Promise<void> {
	const upgrade = opts.profile.upgrade!;
	const { description, warnings } = buildUpgradeDescription(opts.applicationName, opts.applicationTypeVersion, opts.parameters, upgrade);
	for (const w of warnings) logger.warn(w);
	report(`Starting ${upgrade.mode} upgrade of ${opts.applicationName} to ${opts.applicationTypeVersion}...`, 5);
	await client.upgradeApplication(appId, description);
	let lastLine = '';
	for (;;) {
		if (opts.token?.isCancellationRequested) {
			logger.warn(`Stopped watching the upgrade of ${opts.applicationName}; it continues on the cluster.`);
			throw new DeployCancelledError();
		}
		const progress = await client.getApplicationUpgradeProgress(appId);
		const state = String(progress?.UpgradeState ?? '');
		const line = describeUpgradeProgress(progress);
		if (line !== lastLine) {
			report(line);
			lastLine = line;
		}
		if (String(progress?.TargetApplicationTypeVersion ?? opts.applicationTypeVersion) === opts.applicationTypeVersion) {
			if (UPGRADE_DONE.has(state)) {
				logger.info(`Upgrade of ${opts.applicationName} to ${opts.applicationTypeVersion} completed.`);
				return;
			}
			if (UPGRADE_FAILED.has(state)) {
				const reason = [progress?.FailureReason, progress?.UpgradeStatusDetails].filter(Boolean).join(': ');
				throw new Error(
					`Upgrade of ${opts.applicationName} to ${opts.applicationTypeVersion} ${state === 'Failed' ? 'failed' : 'was rolled back'}${reason ? ` (${reason})` : ''}.`,
				);
			}
			if (state === 'RollingForwardPending' && upgrade.mode === 'UnmonitoredManual') {
				logger.warn(
					`The UnmonitoredManual upgrade is waiting for the next upgrade domain to be resumed manually (Resume-ServiceFabricApplicationUpgrade or Service Fabric Explorer).`,
				);
				return;
			}
		}
		await delay(pollMs);
	}
}

/** One log line for an application upgrade progress payload. */
export function describeUpgradeProgress(progress: any): string {
	const state = String(progress?.UpgradeState ?? 'Unknown');
	const domains: any[] = Array.isArray(progress?.UpgradeDomains) ? progress.UpgradeDomains : [];
	const done = domains.filter((d) => String(d?.State ?? '') === 'Completed').length;
	const current = progress?.CurrentUpgradeDomainProgress?.DomainName
		? ` — upgrading domain ${progress.CurrentUpgradeDomainProgress.DomainName}`
		: '';
	return `Upgrade ${state}${domains.length ? ` (${done}/${domains.length} upgrade domains done)` : ''}${current}`;
}

async function unprovisionIfUnused(client: RestDeployClient, typeName: string, typeVersion: string, logger: DeployLogger): Promise<void> {
	try {
		const inUse = (await client.getApplications()).some((a) => a.typeName === typeName && a.typeVersion === typeVersion);
		if (inUse) return;
		logger.info(`Unregistering unused ${typeName} ${typeVersion} after the failed deploy...`);
		await client.unprovisionApplicationType(typeName, typeVersion);
	} catch (err) {
		logger.warn(`Couldn't unregister ${typeName} ${typeVersion}: ${(err as Error).message}`);
	}
}

/** Options for {@link removeViaRest}. */
export interface RestRemoveOptions {
	/** How long to wait for application instances to be deleted before unregistering. */
	waitSeconds: number;
	pollIntervalMs?: number;
	token?: DeployCancellation;
}

/**
 * Removes every application of `typeName` and unregisters every version of
 * the type, like the PowerShell Remove script. Returns `false` when instances
 * were still being deleted after `waitSeconds` (the type is then left registered).
 */
export async function removeViaRest(
	client: RestDeployClient,
	typeName: string,
	logger: DeployLogger,
	opts: RestRemoveOptions,
): Promise<boolean> {
	const pollMs = opts.pollIntervalMs ?? 2000;
	const instances = (await client.getApplications()).filter((a) => a.typeName === typeName);
	if (instances.length === 0) logger.info(`No live application instances of type '${typeName}' found.`);
	else logger.info(`Found ${instances.length} application instance(s) of type '${typeName}'.`);
	for (const app of instances) {
		checkCancelled(opts.token);
		logger.info(`Deleting fabric:/${app.name} (force remove)...`);
		try {
			await client.deleteApplication(app.id, true);
		} catch (err) {
			logger.warn(`Delete of fabric:/${app.name} failed: ${(err as Error).message}. Will still try to unregister the type.`);
		}
	}
	const remaining = async (): Promise<string[]> =>
		(await client.getApplications()).filter((a) => a.typeName === typeName).map((a) => `fabric:/${a.name}`);
	try {
		await waitFor(
			async () => (await remaining()).length === 0,
			opts.waitSeconds,
			pollMs,
			opts.token,
			`instances of ${typeName} to be deleted`,
		);
	} catch (err) {
		if (err instanceof DeployCancelledError) throw err;
		logger.warn(
			`Application instance(s) still present after ${opts.waitSeconds} s: ${(await remaining()).join(', ')}. Skipping unregister to avoid a 'still in use' error.`,
		);
		return false;
	}
	for (const t of (await client.getApplicationTypes()).filter((t) => t.name === typeName)) {
		logger.info(`Unregistering ${typeName} ${t.version}...`);
		try {
			await client.unprovisionApplicationType(typeName, t.version);
		} catch (err) {
			logger.warn(`Unregister failed for version '${t.version}': ${(err as Error).message}`);
		}
	}
	logger.info(`Application type '${typeName}' removed.`);
	return true;
}
