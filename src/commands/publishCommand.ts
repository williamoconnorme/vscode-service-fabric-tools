import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { resolveTargetProject, type ProjectCommandTarget, type ProjectLookup } from './buildCommands';
import { ensureNugetRestored } from '../build/nugetRestore';
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
	type PublishProfileSummary,
} from '../deploy/deployScript';
import { runPowerShell } from '../cluster/powerShellRunner';
import { SfAuthError, type SfRestClient } from '../cluster/sfRestClient';
import { configureClusterSecurity, createClusterClient, getEntraAccessToken } from '../cluster/clusterAuth';
import type { ConnectionStore } from '../cluster/connectionStore';
import type { LocalClusterManager } from '../cluster/localCluster';
import type { AutoAttachTelemetry } from '../debug/autoAttachState';
import type { Logger } from '../util/logger';

/** Absolute paths of the parameter files a publish profile pairs with. */
interface ProfileParameterFiles {
	applicationParameterFileAbs?: string;
	startupServiceParameterFileAbs?: string;
}

/**
 * `serviceFabric.publish`: restore NuGet packages, run the `Package` target,
 * locate the application package, probe the cluster and invoke the project's
 * `Deploy-FabricApplication.ps1` the way Visual Studio does. On success,
 * optionally hands off to the auto-attach flow.
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
	if (process.platform !== 'win32') {
		vscode.window.showWarningMessage('Deploy is supported on Windows only \u2014 the Service Fabric SDK is required.');
		return;
	}
	const project = await resolveTargetProject(watcher, target);
	if (!project) return;
	const publishProfile = await pickPublishProfile(project.publishProfiles);
	if (!publishProfile) return;
	const pairedFiles = await validatePublishProfileParameterFiles(publishProfile, logger);
	const appParamFile = await pickApplicationParameterFile(project.applicationParameters, pairedFiles.applicationParameterFileAbs);

	logger.show();
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
	if (!deployScript || !(await pathExists(deployScript))) {
		vscode.window.showErrorMessage(
			'Deploy-FabricApplication.ps1 not found under Scripts/. Restore the script from a Visual Studio template.',
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
	const preflight = await ensureClusterReachableForDeploy(publishProfile, localCluster, logger);
	if (!preflight) return;
	const wrapper = buildDeployWrapper({
		applicationParameter,
		startupServicesFile: project.startupServicesManifest,
		useSecurityToken: preflight.securityToken !== undefined,
	});
	if (project.startupServicesManifest) {
		logger.info('StartupServices.xml found \u2014 services declared in it will be created after the application is registered.');
	} else {
		logger.info(
			'No StartupServices.xml \u2014 only the application type will be registered and an empty application instance created. Add services in StartupServices.xml (or via "Add Service") to deploy them automatically.',
		);
	}
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
		{ capture: true, ...(preflight.securityToken ? { env: { SF_VSCODE_SECURITY_TOKEN: preflight.securityToken } } : {}) },
	);
	if (result.exitCode === 0) {
		vscode.window.showInformationMessage('Service Fabric deployment completed successfully.');
		const active = connections.getActive();
		if (active) await localCluster.refresh(active, { interactive: true });
		if (active && workspaceState && telemetry && project.applicationManifest) {
			try {
				const { maybeAutoAttachAfterDeploy } = await import('../debug/autoAttachAfterDeploy');
				const applicationTypeName = project.applicationManifest.applicationTypeName;
				const applicationName = `fabric:/${applicationTypeName.replace(/Type$/, '')}`;
				await maybeAutoAttachAfterDeploy(
					{
						applicationName,
						applicationTypeName,
						clusterEndpoint: active.endpoint,
						clusterSecurity: { auth: active.auth, serverCert: active.serverCert },
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
	} else {
		const diagnostic = detectClusterConnectionFailure(result.output ?? '');
		if (diagnostic) {
			vscode.window.showErrorMessage(`Deployment failed (exit code ${result.exitCode}). ${diagnostic}`);
			logger.error(diagnostic);
		} else {
			vscode.window.showErrorMessage(`Deployment failed (exit code ${result.exitCode}). See the Service Fabric output channel.`);
		}
	}
}

/**
 * Pre-flight: probe the HTTP gateway inferred from the publish profile. A
 * profile that can't be parsed, or has no inferable gateway, skips the probe.
 * Profiles that use Microsoft Entra ID (`AzureActiveDirectory="true"`) sign in
 * first and return the token for the deploy script. On failure, local profiles
 * get a "Start Local Cluster" offer; any profile can be force-continued.
 * Returns `undefined` to abort the deploy.
 */
async function ensureClusterReachableForDeploy(
	publishProfile: string,
	_localCluster: LocalClusterManager,
	logger: Logger,
): Promise<{ securityToken?: string } | undefined> {
	let profile: PublishProfileSummary;
	try {
		const xml = await fsp.readFile(publishProfile, 'utf8');
		profile = parsePublishProfile(xml);
	} catch (err) {
		logger.warn(`Skipping cluster probe — failed to parse publish profile: ${(err as Error).message}`);
		return {};
	}
	const gateway = profile.httpGatewayUrl;
	if (!gateway) {
		logger.warn('Skipping cluster probe — no HTTP gateway could be inferred from the publish profile.');
		return {};
	}
	let client: SfRestClient = createClusterClient(gateway);
	let securityToken: string | undefined;
	if (profile.usesEntra) {
		try {
			const security = await configureClusterSecurity(gateway, logger, profile.serverCertThumbprints);
			if (!security) return undefined;
			if (!security.auth) {
				vscode.window.showErrorMessage(
					`The publish profile uses Microsoft Entra ID, but the cluster at ${gateway} doesn't report an Entra ID configuration.`,
				);
				return undefined;
			}
			securityToken = await getEntraAccessToken(security.auth, true);
			client = createClusterClient(gateway, security, { interactive: true });
		} catch (err) {
			logger.error(`Microsoft Entra ID sign-in for ${gateway} failed: ${(err as Error).message}`);
			vscode.window.showErrorMessage(`Microsoft Entra ID sign-in for ${gateway} failed: ${(err as Error).message}`);
			return undefined;
		}
	}
	logger.info(`Probing cluster gateway ${gateway}...`);
	try {
		await client.getClusterHealth(5000);
		logger.info('Cluster probe ok.');
		return { securityToken };
	} catch (err) {
		logger.warn(`Cluster probe failed: ${(err as Error).message}`);
		if (err instanceof SfAuthError) {
			const proceed =
				(await vscode.window.showErrorMessage(
					`${err.message} Check the publish profile's ClusterConnectionParameters and your access to the cluster.`,
					{ modal: true },
					'Continue Anyway',
				)) === 'Continue Anyway';
			return proceed ? { securityToken } : undefined;
		}
	}
	if (profile.isLocal) {
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
				return {};
			} catch (err) {
				vscode.window.showErrorMessage(`Cluster still unreachable after start: ${(err as Error).message}. Aborting deploy.`);
				return undefined;
			}
		}
		if (choice === 'Continue Anyway') {
			logger.warn('Continuing deploy despite cluster probe failure (user override).');
			return {};
		}
		return undefined;
	}
	return (await vscode.window.showErrorMessage(
		`Service Fabric cluster at ${gateway} isn't responding. Verify the publish profile's ClusterConnectionParameters and certificate settings.`,
		{ modal: true },
		'Continue Anyway',
	)) === 'Continue Anyway'
		? { securityToken }
		: undefined;
}

/** The only profile when there is one; otherwise a QuickPick. */
async function pickPublishProfile(profiles: string[]): Promise<string | undefined> {
	if (profiles.length === 0) {
		vscode.window.showErrorMessage('No publish profiles found under PublishProfiles/.');
		return undefined;
	}
	if (profiles.length === 1) return profiles[0];
	const picked = await vscode.window.showQuickPick(
		profiles.map((p) => ({ label: path.basename(p), description: p, value: p })),
		{ placeHolder: 'Select a publish profile' },
	);
	return picked?.value;
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
			description: f,
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
