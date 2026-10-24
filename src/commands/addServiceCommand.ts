// @ts-nocheck
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { applyAddService, collectExistingServiceNames } from '../scaffold/addServiceApply';
import { isAspNetKind, isCsharpKind } from '../scaffold/addServiceTemplates';
import { ensureNugetRestored } from '../build/nugetRestore';

async function runAddServiceCommand(e, t, r) {
	let n = e.getProjects();
	if (n.length === 0) {
		vscode.window.showErrorMessage('No Service Fabric application projects (.sfproj) are open. Add Service requires an existing project.');
		return;
	}
	let i = await pickProjectForAddService(n, r);
	if (!i) return;
	if (!i.applicationManifest) {
		vscode.window.showErrorMessage(`Cannot add a service: ${path.basename(i.sfproj.path)} has no readable ApplicationManifest.xml.`);
		return;
	}
	let o = await pickServiceKind();
	if (!o) return;
	let { kind: s, runtime: a } = o,
		c = collectExistingServiceNames(i),
		l = await promptServiceName(i, c);
	if (!l) return;
	let u = await vscode.window.showInputBox({
		prompt: 'Service type name',
		value: `${l}Type`,
		validateInput: (m) => (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(m) ? null : 'Use letters, digits, dot, dash or underscore.'),
	});
	if (!u) return;
	let p = await vscode.window.showInputBox({
		prompt: 'Initial package version',
		value: '1.0.0',
		validateInput: (m) => (/^\d+\.\d+\.\d+(\.\d+)?$/.test(m) ? null : 'Use a valid version like 1.0.0.'),
	});
	if (!p) return;
	let d = {
			serviceName: l,
			serviceTypeName: u,
			kind: s,
			runtime: a,
			version: p,
		},
		f;
	if (s === 'guest') {
		if (((f = await pickGuestPayload()), !f)) return;
		let m = await vscode.window.showInputBox({
			prompt: 'Optional command-line arguments for the guest executable (leave blank for none)',
			value: '',
		});
		if (m === void 0) return;
		m.trim() !== '' &&
			(d = {
				...d,
				guestArguments: m.trim(),
			});
	} else if (isCsharpKind(s)) {
		let m =
				isAspNetKind(s) || a === 'netcore'
					? [
							{
								label: 'net10.0',
								description: 'Recommended (current LTS, until Nov 2028)',
								value: 'net10.0',
							},
							{
								label: 'net9.0',
								description: 'STS \u2014 reaches end-of-support May 12, 2026',
								value: 'net9.0',
							},
							{
								label: 'net8.0',
								description: 'LTS (until Nov 2026)',
								value: 'net8.0',
							},
						]
					: [
							{
								label: 'net472',
								description: '.NET Framework 4.7.2 (classic Service Fabric SDK)',
								value: 'net472',
							},
							{
								label: 'net48',
								description: '.NET Framework 4.8',
								value: 'net48',
							},
						],
			v = await vscode.window.showQuickPick(m, {
				placeHolder: 'Target framework for the generated C# project',
			});
		if (!v) return;
		if (
			((d = {
				...d,
				targetFramework: v.value,
			}),
			isAspNetKind(s))
		) {
			let w = await promptHttpsEndpoint();
			if (w === 'cancel') return;
			if (w) {
				let b = await vscode.window.showInputBox({
					prompt: 'HTTPS port (Kestrel listen port for the https endpoint)',
					value: '8443',
					validateInput: (S) => (/^[1-9]\d{2,4}$/.test(S) && +S <= 65535 ? null : 'Use a valid TCP port (1\u201365535).'),
				});
				if (b === void 0) return;
				d = {
					...d,
					httpsEndpoint: {
						port: parseInt(b, 10),
					},
				};
			}
		}
		let h = path.dirname(i.sfproj.path),
			P = path.dirname(h),
			g = path.join(P, l);
		if (fs.existsSync(g)) {
			vscode.window.showErrorMessage(
				`Cannot scaffold the C# project: a folder named '${l}' already exists next to the .sfproj (${g}). Choose a different service name or remove the folder first.`,
			);
			return;
		}
	}
	try {
		let m = await applyAddService(i, d, {
				guestSourcePath: f,
			}),
			v = formatAddServiceSummary(s, l, i, m.csprojPath, m.guestExePath);
		if ((t.info(v), isCsharpKind(s) && vscode.workspace.getConfiguration('serviceFabric').get('scaffoldAutoRestore', !0)))
			try {
				let g = await ensureNugetRestored(i.sfproj.path, {
					output: t.outputChannel,
				});
				g.ok && g.strategy !== 'skipped'
					? t.info(`Auto-restore succeeded via ${g.strategy}.`)
					: g.ok || t.warn(`Auto-restore failed: ${g.message ?? 'no details'}. Run 'Service Fabric: Restore NuGet Packages' to retry.`);
			} catch (g) {
				t.warn(`Auto-restore threw: ${g instanceof Error ? g.message : String(g)}`);
			}
		let h = ['Open ServiceManifest.xml', 'Open ApplicationManifest.xml'];
		m.csprojPath && h.unshift('Open generated .csproj');
		let P = await vscode.window.showInformationMessage(v, ...h);
		(P === 'Open ServiceManifest.xml'
			? await openFileInEditor(m.serviceManifestPath)
			: P === 'Open ApplicationManifest.xml'
				? await openFileInEditor(i.applicationManifest.path)
				: P === 'Open generated .csproj' && m.csprojPath && (await openFileInEditor(m.csprojPath)),
			d.httpsEndpoint && isAspNetKind(s) && (await offerDevCertTrust()));
	} catch (m) {
		let v = m.message;
		(t.error(`Add Service failed: ${v}`), vscode.window.showErrorMessage(`Add Service failed: ${v}`));
	}
}

async function pickProjectForAddService(e, t) {
	if (t?.resource) {
		let i = t.resource.fsPath.toLowerCase(),
			o = e.find((s) => s.sfproj.path.toLowerCase() === i);
		if (o) return o;
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
			placeHolder: 'Select the Service Fabric application to add a service to',
		})
	)?.project;
}

async function pickServiceKind() {
	let e = [
		{
			kind: vscode.QuickPickItemKind.Separator,
			label: '.NET Core',
		},
		{
			label: 'Stateless Service',
			description: 'Reliable Stateless service (.NET Core)',
			detail: 'Generates a Reliable Stateless service host + .csproj + ProjectReference.',
			choice: {
				kind: 'stateless',
				runtime: 'netcore',
			},
		},
		{
			label: 'Stateful Service',
			description: 'Reliable Stateful service with persistent internal state (.NET Core)',
			detail: 'Generates a Reliable Stateful service host that demos a reliable dictionary.',
			choice: {
				kind: 'stateful',
				runtime: 'netcore',
			},
		},
		{
			label: 'Actor Service',
			description: 'Virtual-actor pattern (.NET Core)',
			detail: 'Generates an actor + actor interface + ActorRuntime registration.',
			choice: {
				kind: 'actor',
				runtime: 'netcore',
			},
		},
		{
			label: 'Stateless ASP.NET Core',
			description: 'Stateless service hosting an ASP.NET Core pipeline (Kestrel + controllers)',
			detail: 'Generates a stateless service + Controllers/ValuesController.cs + appsettings.json.',
			choice: {
				kind: 'aspNetStateless',
				runtime: 'netcore',
			},
		},
		{
			label: 'Stateful ASP.NET Core',
			description: 'Stateful service hosting an ASP.NET Core pipeline with reliable collections',
			detail: 'Generates a stateful service + Controllers/ValuesController.cs + appsettings.json.',
			choice: {
				kind: 'aspNetStateful',
				runtime: 'netcore',
			},
		},
		{
			kind: vscode.QuickPickItemKind.Separator,
			label: '.NET Framework',
		},
		{
			label: 'Stateless Service',
			description: 'Reliable Stateless service (.NET Framework)',
			detail: 'SDK-style csproj targeting net472.',
			choice: {
				kind: 'stateless',
				runtime: 'netfx',
			},
		},
		{
			label: 'Stateful Service',
			description: 'Reliable Stateful service (.NET Framework)',
			detail: 'SDK-style csproj targeting net472, demos a reliable dictionary.',
			choice: {
				kind: 'stateful',
				runtime: 'netfx',
			},
		},
		{
			label: 'Actor Service',
			description: 'Virtual-actor pattern (.NET Framework)',
			detail: 'SDK-style csproj targeting net472 with the ActorRuntime registration.',
			choice: {
				kind: 'actor',
				runtime: 'netfx',
			},
		},
		{
			kind: vscode.QuickPickItemKind.Separator,
			label: 'Hosted Containers and Applications',
		},
		{
			label: 'Guest Executable',
			description: 'Wraps an existing binary as a Service Fabric guest exe',
			detail: 'No code generated; copies the supplied binary or folder into Code/.',
			choice: {
				kind: 'guest',
				runtime: 'netcore',
			},
		},
	];
	return (
		await vscode.window.showQuickPick(e, {
			placeHolder: 'Choose the service kind',
			matchOnDescription: !0,
			matchOnDetail: !0,
		})
	)?.choice;
}

async function promptServiceName(e, t) {
	let n = `${(e.applicationManifest?.applicationTypeName ?? 'MyApp').replace(/Type$/, '')}.Service${t.size + 1}`;
	return vscode.window.showInputBox({
		prompt: 'Service name (also used as the package folder and, for C# kinds, the .csproj name)',
		value: n,
		validateInput: (i) =>
			/^[A-Za-z][A-Za-z0-9_.-]*$/.test(i)
				? t.has(i.toLowerCase())
					? `A service named '${i}' already exists in this application.`
					: t.has(`${i.toLowerCase()}pkg`)
						? `A service package '${i}Pkg' already exists.`
						: null
				: 'Use letters, digits, dot, dash or underscore (must start with a letter).',
	});
}

async function pickGuestPayload() {
	let e = await vscode.window.showQuickPick(
		[
			{
				label: 'Pick a single executable',
				description: 'Recommended for self-contained binaries.',
				value: 'file',
			},
			{
				label: 'Pick a folder of payload files',
				description: "Copies the entire folder contents into the service's Code/.",
				value: 'folder',
			},
		],
		{
			placeHolder: 'How should the guest payload be staged?',
		},
	);
	return e
		? (
				await vscode.window.showOpenDialog({
					canSelectFiles: e.value === 'file',
					canSelectFolders: e.value === 'folder',
					canSelectMany: !1,
					openLabel: e.value === 'file' ? 'Use this executable' : 'Use this folder',
					title: e.value === 'file' ? 'Select the guest executable' : 'Select the payload folder',
				})
			)?.[0]?.fsPath
		: void 0;
}

function formatAddServiceSummary(e, t, r, n, i) {
	let o = path.basename(r.sfproj.path);
	return e === 'guest'
		? `Added guest service '${t}' to ${o}` + (i ? ` (staged ${path.basename(i)} into Code/)` : '') + '.'
		: n
			? `Added ${e} service '${t}' to ${o}; generated ${path.basename(n)} and added a ProjectReference.`
			: `Added ${e} service '${t}' to ${o}.`;
}

async function openFileInEditor(e) {
	let t = await vscode.workspace.openTextDocument(e);
	await vscode.window.showTextDocument(t, {
		preview: !1,
	});
}

async function promptHttpsEndpoint() {
	let e = await vscode.window.showQuickPick(
		[
			{
				label: 'No (HTTP only)',
				description: 'Default. Kestrel binds http://+:<port>.',
				value: 'no',
			},
			{
				label: 'Yes (HTTP + HTTPS)',
				description: 'Adds a second https endpoint and binds Kestrel to both.',
				value: 'yes',
			},
		],
		{
			placeHolder: 'Generate an HTTPS endpoint in addition to HTTP?',
			matchOnDescription: !0,
		},
	);
	if (!e) return 'cancel';
	if (e.value !== 'no') return {};
}

async function offerDevCertTrust() {
	let e = vscode.workspace.getConfiguration(),
		t = 'serviceFabric.scaffold.suppressDevCertPrompt';
	if (e.get(t, !1)) return;
	let r = 'Yes',
		n = 'No (I will run it later)',
		i = "Don't ask again",
		o = await vscode.window.showInformationMessage(
			'The scaffolded service requires the ASP.NET Core HTTPS development certificate to start its HTTPS endpoint. Trust it now?',
			r,
			n,
			i,
		);
	o === r
		? await vscode.commands.executeCommand('serviceFabric.devCert.trust')
		: o === i && (await e.update(t, !0, vscode.ConfigurationTarget.Workspace));
}

export { pickServiceKind, runAddServiceCommand };
