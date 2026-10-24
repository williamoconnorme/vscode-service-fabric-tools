// @ts-nocheck
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { resolveTargetProject } from './buildCommands';
import { ensureNugetRestored } from '../build/nugetRestore';
import { createSfBuildTask } from '../build/sfTaskProvider';
import { pathExists } from '../util/fs';
import { buildPropertyMap, makeExpander } from '../project/msbuildPropertyExpander';
import { PublishCancelledByUserError, collectPackageRootCandidates, resolveApplicationPackageRoot } from '../deploy/packageResolver';
import { runTier2Prompt } from '../deploy/tier2Prompt';
import { evaluateMsbuildPackageCandidates } from '../project/msbuildPropertyEvaluator';
import {
	buildDeployWrapper,
	detectClusterConnectionFailure,
	parseApplicationParameterFile,
	parsePublishProfile,
} from '../deploy/deployScript';
import { runPowerShell } from '../cluster/powerShellRunner';
import { SfRestClient } from '../cluster/sfRestClient';

async function publishApplication(e, t, r, n, i, o, s) {
	if (process.platform !== 'win32') {
		vscode.window.showWarningMessage('Deploy is supported on Windows only \u2014 the Service Fabric SDK is required.');
		return;
	}
	let a = await resolveTargetProject(e, i);
	if (!a) return;
	let c = await pickPublishProfile(a.publishProfiles);
	if (!c) return;
	let l = await validatePublishProfileParameterFiles(c, n),
		u = await pickApplicationParameterFile(a.applicationParameters, l.applicationParameterFileAbs);
	(n.show(), n.info('Restoring NuGet packages...'));
	let p = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Service Fabric: restoring NuGet packages\u2026',
		},
		(x) =>
			ensureNugetRestored(a.sfproj.path, {
				output: n.outputChannel,
				progress: x,
			}),
	);
	if (!p.ok) {
		(n.error(`NuGet restore failed (${p.strategy}): ${p.message ?? 'no details'}`),
			await vscode.window.showErrorMessage(`Service Fabric: NuGet restore failed. ${p.message ?? ''}`, {
				modal: !0,
			}));
		return;
	}
	(p.strategy !== 'skipped' && n.info(`NuGet restore succeeded via ${p.strategy}.`), n.info('Packaging application...'));
	let d = await createSfBuildTask(a.sfproj.path, 'Package'),
		f = await vscode.tasks.executeTask(d);
	await new Promise((x, V) => {
		let Se = vscode.tasks.onDidEndTaskProcess((Ee) => {
			Ee.execution === f && (Se.dispose(), Ee.exitCode === 0 ? x() : V(new Error(`Package failed with exit code ${Ee.exitCode}.`)));
		});
	});
	let m = a.scripts.find((x) => /Deploy-FabricApplication\.ps1$/i.test(x));
	if (!m || !(await pathExists(m))) {
		vscode.window.showErrorMessage(
			'Deploy-FabricApplication.ps1 not found under Scripts/. Restore the script from a Visual Studio template.',
		);
		return;
	}
	let v = path.join(a.sfproj.directory, 'pkg', 'Debug'),
		h = 'Debug',
		P = buildPropertyMap({
			propertyGroups: a.sfproj.propertyGroups,
			intrinsics: a.sfproj.intrinsics,
			configuration: h,
		}),
		g = makeExpander(P),
		w = new Set(),
		b = (x) => {
			if (!x) return x;
			let V = g(x);
			for (let Se of V.unresolved) w.add(Se);
			return V.value;
		},
		S = (x) => {
			let V = g(x);
			for (let Se of V.unresolved) w.add(Se);
			return V;
		},
		z = vscode.workspace.getConfiguration('serviceFabric').get('deploy.packagePath'),
		O = vscode.workspace.getConfiguration('serviceFabric').get('deploy.searchMaxDepth', 2),
		j = 2;
	Number.isInteger(O) && O >= 1 && O <= 16
		? (j = O)
		: O !== 2 && O !== void 0 && n.warn(`serviceFabric.deploy.searchMaxDepth=${O} is out of range [1, 16]; using default 2.`);
	let le = collectPackageRootCandidates(
			{
				sfprojDir: a.sfproj.directory,
				configuration: h,
				outputPath: a.sfproj.outputPath,
				packageLocation: a.sfproj.packageLocation,
				settingOverride: b(z),
				expand: S,
			},
			path.join,
			path.isAbsolute,
		),
		se = vscode.workspace.getConfiguration('serviceFabric').get('deploy.useMsbuildPropertyEvaluator', !1);
	if (w.size > 0 && !se && o) {
		let V = await runTier2Prompt(
			{
				isPromptSuppressedBySetting: () =>
					vscode.workspace.getConfiguration('serviceFabric').get('deploy.suppressMsbuildEvaluatorPrompt', !1),
				showPrompt: async (Se, Ee) =>
					vscode.window.showWarningMessage(
						Se,
						{
							modal: !0,
						},
						...Ee,
					),
				persistEvaluatorSetting: async () => {
					await vscode.workspace
						.getConfiguration('serviceFabric')
						.update('deploy.useMsbuildPropertyEvaluator', !0, vscode.ConfigurationTarget.Workspace);
				},
				logger: n,
			},
			{
				sfprojPath: a.sfproj.path,
				unresolvedTokens: w,
			},
		);
		if (V.cancelled) {
			n.info('Publish cancelled by user \u2014 declined MSBuild property evaluator prompt.');
			return;
		}
		se = V.useEvaluator;
	} else
		w.size > 0 &&
			n.info(
				`Unresolved MSBuild properties in package-path candidates: ${[...w].map((x) => `$(${x})`).join(', ')}. ${se ? 'Tier 2 (MSBuild -getProperty) will attempt to resolve them.' : 'Resolution will fail unless serviceFabric.deploy.useMsbuildPropertyEvaluator is enabled or serviceFabric.deploy.packagePath is set to the package folder.'}`,
			);
	let Z = se ? () => evaluateMsbuildPackageCandidates(a.sfproj.path, h, n) : void 0,
		ds = async (x) => {
			let V = x.declaredApplicationTypeName ?? '<unreadable>',
				Ee =
					(await vscode.window.showWarningMessage(
						`serviceFabric.deploy.packagePath points at a package whose ApplicationTypeName is '${V}', but the project declares '${x.expectedApplicationTypeName}'.

Path: ${x.path}

Continuing will publish the wrong application. This choice is not remembered.`,
						{
							modal: !0,
						},
						'Continue Publish',
						'Cancel Publish',
					)) === 'Continue Publish';
			return (
				n.info(
					`Override application-type mismatch (declared='${V}', expected='${x.expectedApplicationTypeName}'): ` +
						(Ee ? 'user chose Continue Publish.' : 'user chose Cancel Publish (or dismissed).'),
				),
				Ee
			);
		},
		rn;
	try {
		let x = await resolveApplicationPackageRoot(le, createPackageResolverFs(), {
			searchMaxDepth: j,
			expectedApplicationTypeName: a.applicationManifest?.applicationTypeName,
			onAmbiguous: (V) => pickAmbiguousPackage(V, n),
			evaluateMsbuildProperties: Z,
			onOverrideTypeMismatch: ds,
		});
		((rn = x.path), x.path !== v && n.info(`Resolved application package root: ${x.path} (via ${x.source})`));
	} catch (x) {
		if (x instanceof PublishCancelledByUserError) {
			n.info('Publish cancelled by user \u2014 application type did not match.');
			return;
		}
		(vscode.window.showErrorMessage(x.message), n.error(x.message));
		return;
	}
	let tr = t.getActive();
	tr && tr.kind === 'local' && (await r.refresh(tr));
	let nn;
	if (u)
		try {
			let x = await fsp.readFile(u, 'utf8'),
				V = parseApplicationParameterFile(x);
			Object.keys(V).length > 0 &&
				((nn = V), n.info(`Overriding ${Object.keys(V).length} application parameter(s) from ${path.basename(u)}.`));
		} catch (x) {
			vscode.window.showErrorMessage(`Failed to read application parameters from ${path.basename(u)}: ${x.message}`);
			return;
		}
	let us = buildDeployWrapper({
		applicationParameter: nn,
		startupServicesFile: a.startupServicesManifest,
	});
	if (!(await ensureClusterReachableForDeploy(c, r, n))) return;
	(a.startupServicesManifest
		? n.info('StartupServices.xml found \u2014 services declared in it will be created after the application is registered.')
		: n.info(
				'No StartupServices.xml \u2014 only the application type will be registered and an empty application instance created. Add services in StartupServices.xml (or via "Add Service") to deploy them automatically.',
			),
		n.info(`Invoking ${m}`));
	let St = await runPowerShell(
		n,
		us,
		{
			DeployScript: m,
			PackagePath: rn,
			PublishProfile: c,
			...(a.startupServicesManifest
				? {
						StartupServicesFile: a.startupServicesManifest,
					}
				: {}),
		},
		void 0,
		{
			capture: !0,
		},
	);
	if (St.exitCode === 0) {
		vscode.window.showInformationMessage('Service Fabric deployment completed successfully.');
		let x = t.getActive();
		if ((x && (await r.refresh(x)), x && o && s && a.applicationManifest))
			try {
				let { maybeAutoAttachAfterDeploy: V } = await import('../debug/autoAttachAfterDeploy'),
					Se = a.applicationManifest.applicationTypeName,
					Ee = `fabric:/${Se.replace(/Type$/, '')}`;
				await V(
					{
						applicationName: Ee,
						applicationTypeName: Se,
						clusterEndpoint: x.endpoint,
						clusterKind: x.kind === 'local' ? 'local' : 'remote',
						memento: o,
					},
					n,
					s,
				);
			} catch (V) {
				n.warn(`Auto-attach hook threw: ${V instanceof Error ? V.message : String(V)}`);
			}
	} else {
		let x = detectClusterConnectionFailure(St.output ?? '');
		x
			? (vscode.window.showErrorMessage(`Deployment failed (exit code ${St.exitCode}). ${x}`), n.error(x))
			: vscode.window.showErrorMessage(`Deployment failed (exit code ${St.exitCode}). See the Service Fabric output channel.`);
	}
}

async function ensureClusterReachableForDeploy(e, t, r) {
	let n;
	try {
		let a = await fsp.readFile(e, 'utf8');
		n = parsePublishProfile(a);
	} catch (a) {
		return (r.warn(`Skipping cluster probe \u2014 failed to parse publish profile: ${a.message}`), !0);
	}
	let i = n.httpGatewayUrl;
	if (!i) return (r.warn('Skipping cluster probe \u2014 no HTTP gateway could be inferred from the publish profile.'), !0);
	r.info(`Probing cluster gateway ${i}...`);
	let o = new SfRestClient(i);
	try {
		return (await o.getClusterHealth(5e3), r.info('Cluster probe ok.'), !0);
	} catch (a) {
		r.warn(`Cluster probe failed: ${a.message}`);
	}
	if (n.isLocal) {
		let a = await vscode.window.showErrorMessage(
			`Local Service Fabric cluster at ${i} isn't responding. The deploy script needs an active cluster connection.`,
			{
				modal: !0,
			},
			'Start Local Cluster',
			'Continue Anyway',
		);
		if (a === 'Start Local Cluster') {
			await vscode.commands.executeCommand('serviceFabric.cluster.startLocal');
			try {
				return (await o.getClusterHealth(1e4), r.info('Cluster probe ok after start.'), !0);
			} catch (c) {
				return (vscode.window.showErrorMessage(`Cluster still unreachable after start: ${c.message}. Aborting deploy.`), !1);
			}
		}
		return a === 'Continue Anyway' ? (r.warn('Continuing deploy despite cluster probe failure (user override).'), !0) : !1;
	}
	return (
		(await vscode.window.showErrorMessage(
			`Service Fabric cluster at ${i} isn't responding. Verify the publish profile's ClusterConnectionParameters and certificate settings.`,
			{
				modal: !0,
			},
			'Continue Anyway',
		)) === 'Continue Anyway'
	);
}

async function pickPublishProfile(e) {
	if (e.length === 0) {
		vscode.window.showErrorMessage('No publish profiles found under PublishProfiles/.');
		return;
	}
	return e.length === 1
		? e[0]
		: (
				await vscode.window.showQuickPick(
					e.map((r) => ({
						label: path.basename(r),
						description: r,
						value: r,
					})),
					{
						placeHolder: 'Select a publish profile',
					},
				)
			)?.value;
}

async function pickApplicationParameterFile(e, t) {
	if (e.length === 0) return;
	let r = vscode.workspace.getConfiguration('serviceFabric').get('deploy.promptForApplicationParameters') ?? !1;
	if (t && !r) return;
	if (e.length === 1 && !r) return e[0];
	let n = [
		{
			label: '$(circle-slash) (none \u2014 use publish profile default)',
			description: t ? `From profile: ${path.basename(t)}` : 'Use ApplicationParameterFile referenced by the publish profile',
			value: void 0,
			picked: !0,
		},
		...e.map((o) => ({
			label: path.basename(o),
			description: o,
			value: o,
			picked: t !== void 0 && path.normalize(o).toLowerCase() === path.normalize(t).toLowerCase(),
		})),
	];
	return (
		await vscode.window.showQuickPick(n, {
			placeHolder: 'Override application parameter file (advanced \u2014 leave default to use the file paired with the publish profile)',
		})
	)?.value;
}

async function validatePublishProfileParameterFiles(e, t) {
	let r;
	try {
		r = await fsp.readFile(e, 'utf8');
	} catch (c) {
		return (t.warn(`Could not read publish profile ${path.basename(e)} for parameter-file validation: ${c.message}`), {});
	}
	let n = parsePublishProfile(r),
		i = path.dirname(e),
		o = (c) => {
			if (c) return path.isAbsolute(c) ? c : path.resolve(i, c);
		},
		s = o(n.applicationParameterFile),
		a = o(n.startupServiceParameterFile);
	return (
		n.applicationParameterFile
			? (s ? await pathExists(s) : !1)
				? t.info(`Publish profile pairs with ApplicationParameterFile: ${path.basename(s)} (${n.applicationParameterFile}).`)
				: t.warn(
						`Publish profile references missing ApplicationParameterFile: ${n.applicationParameterFile} (resolved to ${s}). Deploy will likely fail or fall back to manifest defaults.`,
					)
			: t.info('Publish profile has no <ApplicationParameterFile> \u2014 manifest defaults will be used.'),
		n.startupServiceParameterFile &&
			((a ? await pathExists(a) : !1)
				? t.info(`Publish profile pairs with StartupServiceParameterFile: ${path.basename(a)} (${n.startupServiceParameterFile}).`)
				: t.warn(
						`Publish profile references missing StartupServiceParameterFile: ${n.startupServiceParameterFile} (resolved to ${a}). StartupServices.xml defaults will be used.`,
					)),
		{
			applicationParameterFileAbs: s,
			startupServiceParameterFileAbs: a,
		}
	);
}

function createPackageResolverFs() {
	return {
		async pathExists(e) {
			return pathExists(e);
		},
		async readDirectories(e) {
			try {
				return (
					await fsp.readdir(e, {
						withFileTypes: !0,
					})
				)
					.filter((r) => r.isDirectory())
					.map((r) => r.name);
			} catch {
				return [];
			}
		},
		async readApplicationTypeName(e) {
			try {
				let t = await fsp.readFile(e, 'utf8');
				return /<ApplicationManifest\b[^>]*\bApplicationTypeName\s*=\s*["']([^"']+)["']/i.exec(t)?.[1];
			} catch {
				return;
			}
		},
	};
}

async function pickAmbiguousPackage(e, t) {
	t.info(
		`Multiple application packages found \u2014 prompting user to pick: ${e.map((i) => `${path.basename(i.path)}${i.applicationTypeName ? ` [${i.applicationTypeName}]` : ''}`).join(', ')}`,
	);
	let r = e.map((i) => ({
		label: path.basename(i.path),
		description: i.applicationTypeName ? `ApplicationTypeName: ${i.applicationTypeName}` : 'ApplicationTypeName: (unreadable)',
		detail: i.path,
		value: i.path,
	}));
	return (
		await vscode.window.showQuickPick(r, {
			placeHolder: 'Multiple application packages found \u2014 pick the one to deploy',
			matchOnDescription: !0,
			matchOnDetail: !0,
		})
	)?.value;
}

export { publishApplication };
