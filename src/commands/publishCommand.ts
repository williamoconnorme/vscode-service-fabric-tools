import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { resolveTargetProject, type ProjectCommandTarget, type ProjectLookup } from './buildCommands';
import { ensureNugetRestored } from '../build/nugetRestore';
import { preflightServiceProjects } from '../build/serviceProjectPreflight';
import { createSfBuildTask } from '../build/sfTaskProvider';
import { pathExists } from '../util/fs';
import { buildPropertyMap, makeExpander, type ExpandResult } from '../project/msbuildPropertyExpander';
import {
	PublishCancelledByUserError,
	collectPackageRootCandidates,
	resolveApplicationPackageRoot,
	type AnnotatedHit,
	type OverrideTypeMismatch,
	type PackageRootCandidate,
	type ProbeFs,
} from '../deploy/packageResolver';
import { runTier2Prompt } from '../deploy/tier2Prompt';
import { evaluateMsbuildPackageCandidates } from '../project/msbuildPropertyEvaluator';
import {
	buildDeployWrapper,
	detectClusterConnectionFailure,
	parseApplicationParameterFile,
	parsePublishProfile,
	resolveApplicationName,
	type PublishProfileSummary,
	type PublishProfileUpgrade,
} from '../deploy/deployScript';
import { resolveDeployEngine, type DeployEngine } from '../deploy/deployEngine';
import { DeployCancelledError, deployViaRest, type OverwriteBehavior } from '../deploy/restDeploy';
import { parseStartupServiceParameterFile, parseStartupServices, type StartupServiceSpec } from '../deploy/startupServices';
import { runPowerShell } from '../cluster/powerShellRunner';
import { SfAuthError, type SfRestClient } from '../cluster/sfRestClient';
import { configureClusterSecurity, createClientForConnection, createClusterClient, getEntraAccessToken, securityOf } from '../cluster/clusterAuth';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import type { ApplicationProject } from '../project/sfprojModel';
import type { LocalClusterManager } from '../cluster/localCluster';
import type { AutoAttachTelemetry } from '../debug/autoAttachState';
import type { Logger } from '../util/logger';
import { reportClusterAuthFailure } from './clusterCommands';
import { offerToSavePublishProfile, pickParameterFilesForCluster } from './publishProfileCommands';
import { bumpVersionsBeforeUpgrade, savePublishBaseline } from './versionBumpFlow';
import { buildAndPushImages, containerImagesOf } from './containerCommands';

/** Absolute paths of the parameter files a publish profile pairs with. */
interface ProfileParameterFiles {
	applicationParameterFileAbs?: string;
	startupServiceParameterFileAbs?: string;
}

/**
 * `serviceFabric.publish`: restore NuGet packages, run the `Package` target,
 * locate the application package, probe the cluster and deploy it, either by
 * invoking the project's `Deploy-FabricApplication.ps1` the way Visual Studio
 * does (PowerShell engine) or over the HTTP gateway (REST engine, see
 * `serviceFabric.deploy.engine`). On success, optionally hands off to the
 * auto-attach flow.
 *
 * `workspaceState` gates both the Tier 2 prompt and auto-attach; `telemetry`
 * is only needed for auto-attach.
 */
export async function publishApplication(
	watcher: ProjectLookup,
	connections: ConnectionStore,
	localCluster: LocalClusterManager,
	logger: Logger,
	target?: ProjectCommandTarget,
	workspaceState?: vscode.Memento,
	telemetry?: AutoAttachTelemetry,
): Promise<void> {
	const engineChoice = resolveDeployEngine(
		vscode.workspace.getConfiguration('serviceFabric').get<string>('deploy.engine'),
		process.platform,
	);
	const project = await resolveTargetProject(watcher, target);
	if (!project) return;
	const publishTarget = await pickPublishTarget(project.publishProfiles, connections);
	if (!publishTarget) return;
	// A saved cluster has no profile for Deploy-FabricApplication.ps1, so it always deploys over REST.
	const cluster = publishTarget.kind === 'cluster' ? publishTarget.connection : undefined;
	const publishProfile = publishTarget.kind === 'profile' ? publishTarget.path : undefined;
	if (!cluster && 'error' in engineChoice) {
		vscode.window.showErrorMessage(engineChoice.error);
		return;
	}
	const engine: DeployEngine = cluster || 'error' in engineChoice ? 'rest' : engineChoice.engine;
	let pairedFiles: ProfileParameterFiles;
	let appParamFile: string | undefined;
	if (cluster) {
		const files = await pickParameterFilesForCluster(project, cluster);
		if (!files) return;
		pairedFiles = files;
	} else {
		pairedFiles = await validatePublishProfileParameterFiles(publishProfile!, logger);
		appParamFile = await pickApplicationParameterFile(project.applicationParameters, pairedFiles.applicationParameterFileAbs);
	}

	logger.show();
	if (cluster) {
		const params = pairedFiles.applicationParameterFileAbs ? path.basename(pairedFiles.applicationParameterFileAbs) : 'manifest defaults';
		logger.info(`Publishing to saved cluster ${cluster.label} (${cluster.endpoint}) with ${params}.`);
	}
	logger.info(`Deploy engine: ${engine === 'rest' ? 'REST (HTTP gateway)' : 'PowerShell (Deploy-FabricApplication.ps1)'}.`);
	logger.info('Restoring NuGet packages...');
	const restore = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Service Fabric: restoring NuGet packages\u2026' },
		(progress) => ensureNugetRestored(project.sfproj.path, { output: logger.outputChannel, progress }),
	);
	if (!restore.ok) {
		logger.error(`NuGet restore failed (${restore.strategy}): ${restore.message ?? 'no details'}`);
		await vscode.window.showErrorMessage(`Service Fabric: NuGet restore failed. ${restore.message ?? ''}`, { modal: true });
		return;
	}
	if (restore.strategy !== 'skipped') logger.info(`NuGet restore succeeded via ${restore.strategy}.`);

	if (!(await preflightServiceProjects(project, logger))) return;
	if (vscode.workspace.getConfiguration('serviceFabric').get<boolean>('containers.buildBeforePublish') && workspaceState) {
		const images = await containerImagesOf(project);
		if (images.length > 0) {
			logger.info(`Building and pushing ${images.length} container image(s) before publishing...`);
			if (!(await buildAndPushImages(images, workspaceState, logger))) return;
		}
	}
	logger.info('Packaging application...');
	const packageTask = await createSfBuildTask(project.sfproj.path, 'Package');
	const execution = await vscode.tasks.executeTask(packageTask);
	await new Promise<void>((resolve, reject) => {
		const done = () => {
			processSub.dispose();
			taskSub.dispose();
		};
		const processSub = vscode.tasks.onDidEndTaskProcess((e) => {
			if (e.execution !== execution) return;
			done();
			if (e.exitCode === 0) resolve();
			else reject(new Error(`Package failed with exit code ${e.exitCode}.`));
		});
		// A task that fails to start (or is terminated before its process
		// exits) ends without an onDidEndTaskProcess event.
		const taskSub = vscode.tasks.onDidEndTask((e) => {
			if (e.execution !== execution) return;
			done();
			reject(new Error('Package task ended without its process completing.'));
		});
	});

	const deployScript = project.scripts.find((s) => /Deploy-FabricApplication\.ps1$/i.test(s));
	if (engine === 'powershell' && (!deployScript || !(await pathExists(deployScript)))) {
		vscode.window.showErrorMessage(
			'Deploy-FabricApplication.ps1 not found under Scripts/. Restore the script from a Visual Studio template, or set serviceFabric.deploy.engine to "rest".',
		);
		return;
	}

	// --- Locate the application package root ---------------------------------
	const defaultPackageRoot = path.join(project.sfproj.directory, 'pkg', 'Debug');
	const configuration = 'Debug';
	const properties = buildPropertyMap({
		propertyGroups: project.sfproj.propertyGroups,
		intrinsics: project.sfproj.intrinsics,
		configuration,
	});
	const expander = makeExpander(properties);
	// Tier 1: `$(Property)` tokens the in-extension expander couldn't resolve.
	const unresolved = new Set<string>();
	const expandValue = (value: string | undefined): string | undefined => {
		if (!value) return value;
		const r = expander(value);
		for (const token of r.unresolved) unresolved.add(token);
		return r.value;
	};
	const expandForCandidate = (value: string): ExpandResult => {
		const r = expander(value);
		for (const token of r.unresolved) unresolved.add(token);
		return r;
	};
	const packagePathSetting = vscode.workspace.getConfiguration('serviceFabric').get<string>('deploy.packagePath');
	const searchMaxDepthSetting = vscode.workspace.getConfiguration('serviceFabric').get<number>('deploy.searchMaxDepth', 2);
	let searchMaxDepth = 2;
	if (Number.isInteger(searchMaxDepthSetting) && searchMaxDepthSetting >= 1 && searchMaxDepthSetting <= 16) {
		searchMaxDepth = searchMaxDepthSetting;
	} else if (searchMaxDepthSetting !== 2 && searchMaxDepthSetting !== undefined) {
		logger.warn(`serviceFabric.deploy.searchMaxDepth=${searchMaxDepthSetting} is out of range [1, 16]; using default 2.`);
	}
	const candidates = collectPackageRootCandidates(
		{
			sfprojDir: project.sfproj.directory,
			configuration,
			outputPath: project.sfproj.outputPath,
			packageLocation: project.sfproj.packageLocation,
			settingOverride: expandValue(packagePathSetting),
			expand: expandForCandidate,
		},
		path.join,
		path.isAbsolute,
	);

	// Tier 2: offer to spawn MSBuild when Tier 1 left tokens unresolved.
	let useEvaluator = vscode.workspace.getConfiguration('serviceFabric').get<boolean>('deploy.useMsbuildPropertyEvaluator', false);
	if (unresolved.size > 0 && !useEvaluator && workspaceState) {
		const decision = await runTier2Prompt(
			{
				isPromptSuppressedBySetting: () =>
					vscode.workspace.getConfiguration('serviceFabric').get<boolean>('deploy.suppressMsbuildEvaluatorPrompt', false),
				showPrompt: async (message, buttons) => vscode.window.showWarningMessage(message, { modal: true }, ...buttons),
				persistEvaluatorSetting: async () => {
					await vscode.workspace
						.getConfiguration('serviceFabric')
						.update('deploy.useMsbuildPropertyEvaluator', true, vscode.ConfigurationTarget.Workspace);
				},
				logger,
			},
			{ sfprojPath: project.sfproj.path, unresolvedTokens: unresolved },
		);
		if (decision.cancelled) {
			logger.info('Publish cancelled by user \u2014 declined MSBuild property evaluator prompt.');
			return;
		}
		useEvaluator = decision.useEvaluator;
	} else if (unresolved.size > 0) {
		logger.info(
			`Unresolved MSBuild properties in package-path candidates: ${[...unresolved].map((t) => `$(${t})`).join(', ')}. ${useEvaluator ? 'Tier 2 (MSBuild -getProperty) will attempt to resolve them.' : 'Resolution will fail unless serviceFabric.deploy.useMsbuildPropertyEvaluator is enabled or serviceFabric.deploy.packagePath is set to the package folder.'}`,
		);
	}
	const evaluateMsbuildProperties = useEvaluator
		? (): Promise<PackageRootCandidate[]> => evaluateMsbuildPackageCandidates(project.sfproj.path, configuration, logger)
		: undefined;
	const onOverrideTypeMismatch = async (info: OverrideTypeMismatch): Promise<boolean> => {
		const declared = info.declaredApplicationTypeName ?? '<unreadable>';
		const proceed =
			(await vscode.window.showWarningMessage(
				`serviceFabric.deploy.packagePath points at a package whose ApplicationTypeName is '${declared}', but the project declares '${info.expectedApplicationTypeName}'.

Path: ${info.path}

Continuing will publish the wrong application. This choice is not remembered.`,
				{ modal: true },
				'Continue Publish',
				'Cancel Publish',
			)) === 'Continue Publish';
		logger.info(
			`Override application-type mismatch (declared='${declared}', expected='${info.expectedApplicationTypeName}'): ` +
				(proceed ? 'user chose Continue Publish.' : 'user chose Cancel Publish (or dismissed).'),
		);
		return proceed;
	};
	let packagePath: string;
	try {
		const resolved = await resolveApplicationPackageRoot(candidates, createPackageResolverFs(), {
			searchMaxDepth,
			expectedApplicationTypeName: project.applicationManifest?.applicationTypeName,
			onAmbiguous: (hits) => pickAmbiguousPackage(hits, logger),
			evaluateMsbuildProperties,
			onOverrideTypeMismatch,
		});
		packagePath = resolved.path;
		if (resolved.path !== defaultPackageRoot) {
			logger.info(`Resolved application package root: ${resolved.path} (via ${resolved.source})`);
		}
	} catch (err) {
		if (err instanceof PublishCancelledByUserError) {
			logger.info('Publish cancelled by user \u2014 application type did not match.');
			return;
		}
		vscode.window.showErrorMessage((err as Error).message);
		logger.error((err as Error).message);
		return;
	}

	const activeBeforeDeploy = connections.getActive();
	if (activeBeforeDeploy && activeBeforeDeploy.kind === 'local') await localCluster.refresh(activeBeforeDeploy);

	let applicationParameter: Record<string, string> | undefined;
	if (appParamFile) {
		try {
			const xml = await fsp.readFile(appParamFile, 'utf8');
			const parsed = parseApplicationParameterFile(xml);
			if (Object.keys(parsed).length > 0) {
				applicationParameter = parsed;
				logger.info(`Overriding ${Object.keys(parsed).length} application parameter(s) from ${path.basename(appParamFile)}.`);
			}
		} catch (err) {
			vscode.window.showErrorMessage(
				`Failed to read application parameters from ${path.basename(appParamFile)}: ${(err as Error).message}`,
			);
			return;
		}
	}
	const preflight = cluster
		? await ensureSavedClusterReachable(cluster, logger)
		: await ensureClusterReachableForDeploy(publishProfile!, localCluster, logger, engine, connections);
	if (!preflight) return;
	const applicationTypeName = project.applicationManifest?.applicationTypeName;
	const applicationName = applicationTypeName
		? resolveApplicationName(
				applicationTypeName,
				(await readOptional(pairedFiles.applicationParameterFileAbs)) ?? (await readOptional(appParamFile)),
			)
		: undefined;
	// Saved clusters have no profile: their upgrade settings come from serviceFabric.deploy.upgradeMode.
	const clusterUpgrade = cluster ? clusterUpgradeSettings() : undefined;
	const profileXml = publishProfile ? await readOptional(publishProfile) : undefined;
	const upgradeEnabled = cluster ? clusterUpgrade !== undefined : Boolean(profileXml && parsePublishProfile(profileXml).upgrade?.enabled);
	const proceed = await bumpVersionsBeforeUpgrade({
		project,
		packagePath,
		client: preflight.client,
		applicationName,
		upgradeEnabled,
		memento: workspaceState,
		logger,
	});
	if (!proceed) return;
	const deployed =
		engine === 'powershell'
			? await deployViaPowerShell(
					project,
					deployScript!,
					packagePath,
					publishProfile!,
					applicationParameter,
					preflight.securityToken,
					logger,
				)
			: await deployViaRestEngine(
					project,
					packagePath,
					publishProfile,
					pairedFiles,
					applicationParameter,
					preflight.client,
					logger,
					clusterUpgrade,
				);
	if (!deployed) return;
	await savePublishBaseline(project, packagePath, preflight.client.endpoint, workspaceState, logger);
	vscode.window.showInformationMessage('Service Fabric deployment completed successfully.');
	const active = cluster ?? connections.getActive();
	if (active) await localCluster.refresh(active, { interactive: true });
	// Not awaited: the offer is a notification and shouldn't hold up auto-attach.
	if (cluster) void offerToSavePublishProfile(project, cluster, pairedFiles, workspaceState, logger);
	if (active && workspaceState && telemetry && applicationTypeName && applicationName) {
		try {
			const { maybeAutoAttachAfterDeploy } = await import('../debug/autoAttachAfterDeploy');
			await maybeAutoAttachAfterDeploy(
				{
					applicationName,
					applicationTypeName,
					clusterEndpoint: active.endpoint,
					clusterSecurity: securityOf(active),
					clusterKind: active.kind === 'local' ? 'local' : 'remote',
					memento: workspaceState,
				},
				logger,
				telemetry,
			);
		} catch (err) {
			logger.warn(`Auto-attach hook threw: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

/** Today's (and Visual Studio's) deploy: dot-source `Deploy-FabricApplication.ps1` in Windows PowerShell. */
async function deployViaPowerShell(
	project: ApplicationProject,
	deployScript: string,
	packagePath: string,
	publishProfile: string,
	applicationParameter: Record<string, string> | undefined,
	securityToken: string | undefined,
	logger: Logger,
): Promise<boolean> {
	const wrapper = buildDeployWrapper({
		applicationParameter,
		startupServicesFile: project.startupServicesManifest,
		useSecurityToken: securityToken !== undefined,
	});
	logStartupServicesMode(project, logger);
	logger.info(`Invoking ${deployScript}`);
	const result = await runPowerShell(
		logger,
		wrapper,
		{
			DeployScript: deployScript,
			PackagePath: packagePath,
			PublishProfile: publishProfile,
			...(project.startupServicesManifest ? { StartupServicesFile: project.startupServicesManifest } : {}),
		},
		undefined,
		{ capture: true, ...(securityToken ? { env: { SF_VSCODE_SECURITY_TOKEN: securityToken } } : {}) },
	);
	if (result.exitCode === 0) return true;
	const diagnostic = detectClusterConnectionFailure(result.output ?? '');
	if (diagnostic) {
		vscode.window.showErrorMessage(`Deployment failed (exit code ${result.exitCode}). ${diagnostic}`);
		logger.error(diagnostic);
	} else {
		vscode.window.showErrorMessage(`Deployment failed (exit code ${result.exitCode}). See the Service Fabric output channel.`);
	}
	return false;
}

function logStartupServicesMode(project: ApplicationProject, logger: Logger): void {
	if (project.startupServicesManifest) {
		logger.info('StartupServices.xml found \u2014 services declared in it will be created after the application is registered.');
	} else {
		logger.info(
			'No StartupServices.xml \u2014 only the application type will be registered and an empty application instance created. Add services in StartupServices.xml (or via "Add Service") to deploy them automatically.',
		);
	}
}

/**
 * The REST engine: reads the package, parameters, StartupServices.xml and the
 * profile's upgrade settings, then uploads, provisions and creates/upgrades the
 * application over the HTTP gateway with a cancellable progress notification.
 */
async function deployViaRestEngine(
	project: ApplicationProject,
	packagePath: string,
	publishProfile: string | undefined,
	pairedFiles: ProfileParameterFiles,
	applicationParameter: Record<string, string> | undefined,
	client: SfRestClient,
	logger: Logger,
	/** Upgrade settings when there is no publish profile (saved-cluster publishes). */
	upgradeWithoutProfile?: PublishProfileUpgrade,
): Promise<boolean> {
	const fail = (message: string): false => {
		logger.error(message);
		vscode.window.showErrorMessage(`Deployment failed. ${message}`);
		return false;
	};
	let manifestXml: string;
	try {
		manifestXml = await fsp.readFile(path.join(packagePath, 'ApplicationManifest.xml'), 'utf8');
	} catch (err) {
		return fail(`Couldn't read ApplicationManifest.xml from ${packagePath}: ${(err as Error).message}`);
	}
	const typeName = /<ApplicationManifest\b[^>]*\bApplicationTypeName\s*=\s*"([^"]+)"/i.exec(manifestXml)?.[1];
	const typeVersion = /<ApplicationManifest\b[^>]*\bApplicationTypeVersion\s*=\s*"([^"]+)"/i.exec(manifestXml)?.[1];
	if (!typeName || !typeVersion) return fail(`${packagePath}/ApplicationManifest.xml has no ApplicationTypeName/ApplicationTypeVersion.`);

	const profileXml = await readOptional(publishProfile);
	const profile = profileXml ? parsePublishProfile(profileXml) : undefined;
	const profileParamXml = await readOptional(pairedFiles.applicationParameterFileAbs);
	// Profile's parameter file, overlaid with the picked file's values (like -ApplicationParameter).
	const parameters = { ...(profileParamXml ? parseApplicationParameterFile(profileParamXml) : {}), ...applicationParameter };
	const applicationName = resolveApplicationName(typeName, profileParamXml);

	let startupServices: StartupServiceSpec[] = [];
	logStartupServicesMode(project, logger);
	if (project.startupServicesManifest) {
		try {
			const startupXml = await fsp.readFile(project.startupServicesManifest, 'utf8');
			const overridesXml = await readOptional(pairedFiles.startupServiceParameterFileAbs);
			startupServices = parseStartupServices(startupXml, overridesXml ? parseStartupServiceParameterFile(overridesXml) : {});
		} catch (err) {
			return fail(`Couldn't read StartupServices.xml: ${(err as Error).message}`);
		}
	}

	const config = vscode.workspace.getConfiguration('serviceFabric');
	const overwriteBehavior = config.get<OverwriteBehavior>('deploy.overwriteBehavior') ?? 'SameAppTypeAndVersion';
	logger.info(
		`Deploying ${applicationName} (${typeName} ${typeVersion}) to ${client.endpoint} over the HTTP gateway; ${Object.keys(parameters).length} parameter(s), ${startupServices.length} startup service(s), OverwriteBehavior=${overwriteBehavior}.`,
	);
	try {
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `Service Fabric: publishing ${applicationName}`, cancellable: true },
			(progress, token) =>
				deployViaRest(
					client,
					{
						packageRoot: packagePath,
						applicationTypeName: typeName,
						applicationTypeVersion: typeVersion,
						applicationName,
						parameters,
						startupServices,
						profile: {
							overwriteBehavior,
							upgrade: profile ? profile.upgrade : upgradeWithoutProfile,
							copyPackageTimeoutSec: profile?.copyPackageTimeoutSec ?? config.get<number>('deploy.copyPackageTimeoutSec') ?? 600,
							compressPackage: profile?.compressPackage,
							registerApplicationTypeTimeoutSec: profile?.registerApplicationTypeTimeoutSec,
						},
						token,
						progress: (message, increment) => progress.report({ message, increment }),
						resolveXstoreConnectionString: (reason) =>
							Promise.resolve(
								vscode.window.showInputBox({
									prompt: `${reason} Enter the image store's connection string (xstore:DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…;Container=…). It isn't saved.`,
									password: true,
									ignoreFocusOut: true,
									validateInput: (v) => (/AccountName=.+AccountKey=.+Container=/i.test(v) ? null : 'Needs AccountName, AccountKey and Container.'),
								}),
							),
					},
					logger,
				),
		);
		return true;
	} catch (err) {
		if (err instanceof DeployCancelledError) {
			logger.warn('Deployment cancelled.');
			vscode.window.showWarningMessage('Service Fabric deployment cancelled.');
			return false;
		}
		return fail((err as Error).message);
	}
}

/** Upgrade settings for saved-cluster publishes, from `serviceFabric.deploy.upgradeMode`; `undefined` when disabled. */
function clusterUpgradeSettings(): PublishProfileUpgrade | undefined {
	const mode = vscode.workspace.getConfiguration('serviceFabric').get<string>('deploy.upgradeMode') ?? 'Monitored';
	if (mode !== 'Monitored' && mode !== 'UnmonitoredAuto' && mode !== 'UnmonitoredManual') return undefined;
	return { enabled: true, mode, parameters: mode === 'Monitored' ? { FailureAction: 'Rollback' } : {} };
}

async function readOptional(file: string | undefined): Promise<string | undefined> {
	if (!file) return undefined;
	try {
		return await fsp.readFile(file, 'utf8');
	} catch {
		return undefined;
	}
}

/** The saved connection for a gateway URL (same scheme, host and port), if any. */
export function findSavedConnection(connections: ConnectionStore, gateway: string): ClusterConnection | undefined {
	const key = (u: string): string => {
		try {
			const parsed = new URL(u);
			return `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`;
		} catch {
			return u;
		}
	};
	return connections.list().find((c) => key(c.endpoint) === key(gateway));
}

/**
 * Pre-flight: probe the HTTP gateway inferred from the publish profile. A
 * profile that can't be parsed, or has no inferable gateway, skips the probe.
 * Profiles that use Microsoft Entra ID (`AzureActiveDirectory="true"`) sign in
 * first and return the token for the deploy script. On failure, local profiles
 * get a "Start Local Cluster" offer; any profile can be force-continued.
 * Returns `undefined` to abort the deploy.
 */
export async function ensureClusterReachableForDeploy(
	publishProfile: string,
	_localCluster: LocalClusterManager,
	logger: Logger,
	engine: DeployEngine,
	connections: ConnectionStore,
): Promise<{ securityToken?: string; client: SfRestClient } | undefined> {
	// The REST engine needs a gateway even when the probe is skipped.
	const localClient = (): SfRestClient => createClusterClient('http://localhost:19080');
	let profile: PublishProfileSummary;
	try {
		const xml = await fsp.readFile(publishProfile, 'utf8');
		profile = parsePublishProfile(xml);
	} catch (err) {
		logger.warn(`Skipping cluster probe — failed to parse publish profile: ${(err as Error).message}`);
		return { client: localClient() };
	}
	const gateway = profile.httpGatewayUrl;
	if (!gateway) {
		if (engine === 'rest') {
			vscode.window.showErrorMessage(
				`Couldn't work out the cluster's HTTP gateway from ${path.basename(publishProfile)}'s ConnectionEndpoint (${profile.connectionEndpoint ?? 'none'}). Use host:port or an http(s):// URL.`,
			);
			return undefined;
		}
		logger.warn('Skipping cluster probe — no HTTP gateway could be inferred from the publish profile.');
		return { client: localClient() };
	}
	let client: SfRestClient = createClusterClient(gateway);
	let securityToken: string | undefined;
	// The REST engine talks to the gateway itself, so it needs the pinned server
	// certificate and client certificate that PowerShell would get from the profile.
	const restNeedsSecurity = engine === 'rest' && !profile.isLocal && (gateway.startsWith('https:') || Boolean(profile.usesX509));
	if (profile.usesEntra || restNeedsSecurity) {
		const saved = findSavedConnection(connections, gateway);
		try {
			const security = await configureClusterSecurity(gateway, logger, {
				knownThumbprints: [...new Set([...(profile.serverCertThumbprints ?? []), ...(saved?.serverCert?.thumbprints ?? [])])],
				clientCertCriteria:
					engine === 'rest' && profile.usesX509
						? { findType: profile.clientCertFindType, findValue: profile.clientCertFindValue }
						: undefined,
				savedClientCert: saved?.clientCert,
			});
			if (!security) return undefined;
			if (profile.usesEntra && !security.auth) {
				vscode.window.showErrorMessage(
					`The publish profile uses Microsoft Entra ID, but the cluster at ${gateway} doesn't report an Entra ID configuration.`,
				);
				return undefined;
			}
			// Only the PowerShell engine needs the raw token (passed via the environment).
			if (security.auth && engine === 'powershell') securityToken = await getEntraAccessToken(security.auth, true, logger);
			client = createClusterClient(gateway, security, { interactive: true });
		} catch (err) {
			const what = profile.usesEntra ? 'Microsoft Entra ID sign-in' : 'Connecting';
			logger.error(`${what} for ${gateway} failed: ${(err as Error).message}`);
			vscode.window.showErrorMessage(`${what} for ${gateway} failed: ${(err as Error).message}`);
			return undefined;
		}
	}
	logger.info(`Probing cluster gateway ${gateway}...`);
	try {
		await client.getClusterHealth(5000);
		logger.info('Cluster probe ok.');
		return { securityToken, client };
	} catch (err) {
		logger.warn(`Cluster probe failed: ${(err as Error).message}`);
		if (err instanceof SfAuthError) {
			const proceed =
				(await vscode.window.showErrorMessage(
					`${err.message} Check the publish profile's ClusterConnectionParameters and your access to the cluster.`,
					{ modal: true },
					'Continue Anyway',
				)) === 'Continue Anyway';
			return proceed ? { securityToken, client } : undefined;
		}
	}
	return handleUnreachableCluster(
		client,
		gateway,
		profile.isLocal,
		securityToken,
		"Verify the publish profile's ClusterConnectionParameters and certificate settings.",
		logger,
	);
}

/**
 * After a failed probe: a local cluster gets a "Start Local Cluster" offer, and
 * any cluster can be force-continued. Returns `undefined` to abort the deploy.
 */
async function handleUnreachableCluster(
	client: SfRestClient,
	gateway: string,
	isLocal: boolean,
	securityToken: string | undefined,
	remoteHint: string,
	logger: Logger,
): Promise<{ securityToken?: string; client: SfRestClient } | undefined> {
	if (isLocal) {
		const choice = await vscode.window.showErrorMessage(
			`Local Service Fabric cluster at ${gateway} isn't responding. The deploy script needs an active cluster connection.`,
			{ modal: true },
			'Start Local Cluster',
			'Continue Anyway',
		);
		if (choice === 'Start Local Cluster') {
			await vscode.commands.executeCommand('serviceFabric.cluster.startLocal');
			try {
				await client.getClusterHealth(10000);
				logger.info('Cluster probe ok after start.');
				return { client };
			} catch (err) {
				vscode.window.showErrorMessage(`Cluster still unreachable after start: ${(err as Error).message}. Aborting deploy.`);
				return undefined;
			}
		}
		if (choice === 'Continue Anyway') {
			logger.warn('Continuing deploy despite cluster probe failure (user override).');
			return { client };
		}
		return undefined;
	}
	return (await vscode.window.showErrorMessage(
		`Service Fabric cluster at ${gateway} isn't responding. ${remoteHint}`,
		{ modal: true },
		'Continue Anyway',
	)) === 'Continue Anyway'
		? { securityToken, client }
		: undefined;
}

/**
 * Pre-flight for publishing to a saved cluster: builds a client from the
 * connection's saved security settings (signing in or asking for a certificate
 * passphrase if needed) and probes the gateway.
 */
export async function ensureSavedClusterReachable(
	conn: ClusterConnection,
	logger: Logger,
): Promise<{ securityToken?: string; client: SfRestClient } | undefined> {
	const client = createClientForConnection(conn, { interactive: true });
	logger.info(`Probing cluster gateway ${conn.endpoint}...`);
	try {
		await client.getClusterHealth(5000);
		logger.info('Cluster probe ok.');
		return { client };
	} catch (err) {
		logger.warn(`Cluster probe failed: ${(err as Error).message}`);
		if (await reportClusterAuthFailure(err, conn)) return undefined;
	}
	return handleUnreachableCluster(
		client,
		conn.endpoint,
		conn.kind === 'local',
		undefined,
		'Check the connection in the Clusters view.',
		logger,
	);
}

export type PublishTarget = { kind: 'profile'; path: string } | { kind: 'cluster'; connection: ClusterConnection };

/**
 * Publish profiles and saved clusters in one QuickPick, the active cluster
 * first. With no saved clusters and a single profile, that profile is used
 * without asking.
 */
export async function pickPublishTarget(
	profiles: string[],
	connections: ConnectionStore,
	placeHolder = 'Publish to a publish profile or a saved cluster',
): Promise<PublishTarget | undefined> {
	const clusters = connections.list();
	if (profiles.length === 0 && clusters.length === 0) {
		vscode.window.showErrorMessage(
			'There are no publish profiles under PublishProfiles/ and no saved clusters. Add a cluster in the Clusters view, or add a publish profile.',
		);
		return undefined;
	}
	if (clusters.length === 0 && profiles.length === 1) return { kind: 'profile', path: profiles[0] };
	const active = connections.getActive();
	const ordered = active ? [active, ...clusters.filter((c) => c.id !== active.id)] : clusters;
	type Item = vscode.QuickPickItem & { target?: PublishTarget };
	const items: Item[] = [];
	if (profiles.length > 0) {
		items.push({ label: 'Publish profiles', kind: vscode.QuickPickItemKind.Separator });
		for (const p of profiles) items.push({ label: `$(file) ${path.basename(p)}`, description: vscode.workspace.asRelativePath(p), target: { kind: 'profile', path: p } });
	}
	if (ordered.length > 0) {
		items.push({ label: 'Saved clusters', kind: vscode.QuickPickItemKind.Separator });
		for (const c of ordered) {
			items.push({
				label: `$(server) ${c.label}`,
				description: c.endpoint,
				detail: c.id === active?.id ? 'Active cluster · deploys over the HTTP gateway' : 'Deploys over the HTTP gateway',
				target: { kind: 'cluster', connection: c },
			});
		}
	}
	const picked = await vscode.window.showQuickPick(items, { placeHolder });
	return picked?.target;
}

/**
 * Optional override of the publish profile's own ApplicationParameterFile.
 * Only prompts when `serviceFabric.deploy.promptForApplicationParameters` is
 * on, or when the profile pairs with no file and there are several to choose
 * from. `undefined` means "use the profile default".
 */
async function pickApplicationParameterFile(files: string[], pairedFile: string | undefined): Promise<string | undefined> {
	if (files.length === 0) return undefined;
	const alwaysPrompt = vscode.workspace.getConfiguration('serviceFabric').get<boolean>('deploy.promptForApplicationParameters') ?? false;
	if (pairedFile && !alwaysPrompt) return undefined;
	if (files.length === 1 && !alwaysPrompt) return files[0];
	const items: (vscode.QuickPickItem & { value: string | undefined })[] = [
		{
			label: '$(circle-slash) (none \u2014 use publish profile default)',
			description: pairedFile
				? `From profile: ${path.basename(pairedFile)}`
				: 'Use ApplicationParameterFile referenced by the publish profile',
			value: undefined,
			picked: true,
		},
		...files.map((f) => ({
			label: path.basename(f),
			description: vscode.workspace.asRelativePath(f),
			value: f,
			picked: pairedFile !== undefined && path.normalize(f).toLowerCase() === path.normalize(pairedFile).toLowerCase(),
		})),
	];
	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Override application parameter file (advanced \u2014 leave default to use the file paired with the publish profile)',
	});
	return picked?.value;
}

/**
 * Resolve the publish profile's `<ApplicationParameterFile>` /
 * `<StartupServiceParameterFile>` against its directory and log whether
 * each exists. Returns `{}` when the profile can't be read.
 */
async function validatePublishProfileParameterFiles(publishProfile: string, logger: Logger): Promise<ProfileParameterFiles> {
	let xml: string;
	try {
		xml = await fsp.readFile(publishProfile, 'utf8');
	} catch (err) {
		logger.warn(`Could not read publish profile ${path.basename(publishProfile)} for parameter-file validation: ${(err as Error).message}`);
		return {};
	}
	const profile = parsePublishProfile(xml);
	const profileDir = path.dirname(publishProfile);
	const toAbs = (p: string | undefined): string | undefined => {
		if (p) return path.isAbsolute(p) ? p : path.resolve(profileDir, p);
		return undefined;
	};
	const appParamAbs = toAbs(profile.applicationParameterFile);
	const startupParamAbs = toAbs(profile.startupServiceParameterFile);
	if (profile.applicationParameterFile) {
		if (appParamAbs ? await pathExists(appParamAbs) : false) {
			logger.info(
				`Publish profile pairs with ApplicationParameterFile: ${path.basename(appParamAbs!)} (${profile.applicationParameterFile}).`,
			);
		} else {
			logger.warn(
				`Publish profile references missing ApplicationParameterFile: ${profile.applicationParameterFile} (resolved to ${appParamAbs}). Deploy will likely fail or fall back to manifest defaults.`,
			);
		}
	} else {
		logger.info('Publish profile has no <ApplicationParameterFile> \u2014 manifest defaults will be used.');
	}
	if (profile.startupServiceParameterFile) {
		if (startupParamAbs ? await pathExists(startupParamAbs) : false) {
			logger.info(
				`Publish profile pairs with StartupServiceParameterFile: ${path.basename(startupParamAbs!)} (${profile.startupServiceParameterFile}).`,
			);
		} else {
			logger.warn(
				`Publish profile references missing StartupServiceParameterFile: ${profile.startupServiceParameterFile} (resolved to ${startupParamAbs}). StartupServices.xml defaults will be used.`,
			);
		}
	}
	return { applicationParameterFileAbs: appParamAbs, startupServiceParameterFileAbs: startupParamAbs };
}

/** Real-filesystem `ProbeFs` for the package resolver. */
function createPackageResolverFs(): ProbeFs {
	return {
		async pathExists(p) {
			return pathExists(p);
		},
		async readDirectories(p) {
			try {
				return (await fsp.readdir(p, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
			} catch {
				return [];
			}
		},
		async readApplicationTypeName(manifestPath) {
			try {
				const xml = await fsp.readFile(manifestPath, 'utf8');
				return /<ApplicationManifest\b[^>]*\bApplicationTypeName\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1];
			} catch {
				return undefined;
			}
		},
	};
}

/** `onAmbiguous` hook: let the user pick among several discovered packages. */
async function pickAmbiguousPackage(hits: AnnotatedHit[], logger: Logger): Promise<string | undefined> {
	logger.info(
		`Multiple application packages found \u2014 prompting user to pick: ${hits.map((h) => `${path.basename(h.path)}${h.applicationTypeName ? ` [${h.applicationTypeName}]` : ''}`).join(', ')}`,
	);
	const items = hits.map((h) => ({
		label: path.basename(h.path),
		description: h.applicationTypeName ? `ApplicationTypeName: ${h.applicationTypeName}` : 'ApplicationTypeName: (unreadable)',
		detail: h.path,
		value: h.path,
	}));
	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Multiple application packages found \u2014 pick the one to deploy',
		matchOnDescription: true,
		matchOnDetail: true,
	});
	return picked?.value;
}
