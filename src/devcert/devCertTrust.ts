// @ts-nocheck
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { parseDevCertCheckOutput } from './devCertProbe';

async function runDevCertTrust(e, t, r = 'manual') {
	let n = process.platform,
		o = vscode.workspace.getConfiguration('serviceFabric').get('devCert.expirationWarningDays', 30);
	e.info(`Dev-cert trust: starting (platform=${n}, trigger=${r}).`);
	let s = await runDevCertsCommand('dotnet', ['dev-certs', 'https', '--check', '--verbose'], e);
	if (s.spawnError)
		return (
			vscode.window
				.showErrorMessage("Could not run 'dotnet dev-certs'. Install the .NET SDK and ensure 'dotnet' is on PATH.", 'Open .NET Download')
				.then((c) => {
					c === 'Open .NET Download' && vscode.env.openExternal(vscode.Uri.parse(DOTNET_DOWNLOAD_URL));
				}),
			emitDevCertTrustTelemetry(t, r, n, 'tooling-missing'),
			'tooling-missing'
		);
	let a = parseDevCertCheckOutput(s.stdout, s.stderr, s.exitCode ?? 0, new Date().toISOString(), o);
	if ((e.info(`Dev-cert probe: ${a.kind}`), n === 'linux')) return await handleLinuxDevCert(a, e, t, r);
	if (a.kind === 'valid') {
		let c = Number.isFinite(a.daysRemaining) ? `${a.daysRemaining} day(s)` : 'long';
		return (
			vscode.window.showInformationMessage(`ASP.NET Core HTTPS dev certificate is valid and trusted (${c} remaining).`),
			emitDevCertTrustTelemetry(t, r, n, 'already-trusted'),
			'already-trusted'
		);
	}
	if (a.kind === 'expiring')
		return (await vscode.window.showWarningMessage(
			`ASP.NET Core HTTPS dev certificate expires in ${a.daysRemaining} day(s). Regenerate now?`,
			'Regenerate',
			'Not now',
		)) !== 'Regenerate'
			? (emitDevCertTrustTelemetry(t, r, n, 'expiring-acknowledged'), 'expiring-acknowledged')
			: await regenerateAndTrust(e, t, r, n);
	if (a.kind === 'expired' || a.kind === 'missing' || a.kind === 'untrusted') {
		let c = a.kind === 'expired' ? `expired ${a.daysOverdue} day(s) ago` : a.kind === 'missing' ? 'is not present' : 'is not trusted';
		return (await vscode.window.showInformationMessage(
			`ASP.NET Core HTTPS dev certificate ${c}. Generate and trust it now?`,
			'Yes',
			'No',
		)) !== 'Yes'
			? (emitDevCertTrustTelemetry(t, r, n, 'declined'), 'declined')
			: await regenerateAndTrust(e, t, r, n);
	}
	return (
		e.warn(`Dev-cert --check produced unparseable output:
${a.raw}`),
		vscode.window
			.showErrorMessage(
				"Could not interpret 'dotnet dev-certs https --check' output. See the Service Fabric output channel.",
				'Open Output Channel',
			)
			.then((c) => {
				c === 'Open Output Channel' && e.outputChannel.show();
			}),
		emitDevCertTrustTelemetry(t, r, n, 'failed'),
		'failed'
	);
}

async function regenerateAndTrust(e, t, r, n) {
	let i = await runDevCertsCommand('dotnet', ['dev-certs', 'https', '--clean'], e);
	i.exitCode !== 0 && e.warn(`dotnet dev-certs https --clean exited ${i.exitCode}; continuing to --trust.`);
	let o = await runDevCertsCommand('dotnet', ['dev-certs', 'https', '--trust'], e);
	return o.spawnError || (o.exitCode ?? 1) !== 0
		? (vscode.window
				.showErrorMessage(
					'Failed to trust the ASP.NET Core HTTPS dev certificate. See the Service Fabric output channel for details.',
					'Open Output Channel',
				)
				.then((s) => {
					s === 'Open Output Channel' && e.outputChannel.show();
				}),
			emitDevCertTrustTelemetry(t, r, n, 'failed'),
			'failed')
		: (vscode.window.showInformationMessage('ASP.NET Core HTTPS dev certificate generated and trusted.'),
			emitDevCertTrustTelemetry(t, r, n, 'regenerated'),
			'regenerated');
}

async function handleLinuxDevCert(e, t, r, n) {
	return e.kind === 'valid'
		? (vscode.window.showInformationMessage('ASP.NET Core HTTPS dev certificate is present.'),
			emitDevCertTrustTelemetry(r, n, 'linux', 'already-trusted'),
			'already-trusted')
		: ((e.kind === 'missing' || e.kind === 'expired') &&
				(await runDevCertsCommand('dotnet', ['dev-certs', 'https', '--clean'], t),
				await runDevCertsCommand('dotnet', ['dev-certs', 'https'], t)),
			vscode.window
				.showWarningMessage(
					'Trust on Linux is distro-specific. The dev certificate has been (re)generated; follow the Microsoft docs to trust it manually.',
					'Open Docs',
				)
				.then((i) => {
					i === 'Open Docs' && vscode.env.openExternal(vscode.Uri.parse(LINUX_TRUST_DOCS_URL));
				}),
			emitDevCertTrustTelemetry(r, n, 'linux', 'linux-manual'),
			'linux-manual');
}

function runDevCertsCommand(e, t, r) {
	return new Promise((n) => {
		let i = '',
			o = '',
			s;
		try {
			s = (0, cp.spawn)(e, t, {
				shell: !1,
			});
		} catch (a) {
			(r.error(`Failed to spawn ${e} ${t.join(' ')}`, a),
				n({
					stdout: '',
					stderr: '',
					exitCode: null,
					spawnError: !0,
				}));
			return;
		}
		(s.stdout?.on('data', (a) => {
			let c = a.toString('utf8');
			((i += c), r.outputChannel.append(c));
		}),
			s.stderr?.on('data', (a) => {
				let c = a.toString('utf8');
				((o += c), r.outputChannel.append(c));
			}),
			s.on('error', (a) => {
				(r.error(`Subprocess ${e} errored`, a),
					n({
						stdout: i,
						stderr: o,
						exitCode: null,
						spawnError: !0,
					}));
			}),
			s.on('close', (a) => {
				n({
					stdout: i,
					stderr: o,
					exitCode: a,
				});
			}));
	});
}

function emitDevCertTrustTelemetry(e, t, r, n) {
	e.event('devcert.trust', {
		trigger: t,
		platform: r,
		outcome: n,
	});
}

let LINUX_TRUST_DOCS_URL, DOTNET_DOWNLOAD_URL;

LINUX_TRUST_DOCS_URL =
	'https://learn.microsoft.com/en-us/aspnet/core/security/enforcing-ssl#trust-the-aspnet-core-https-development-certificate';

DOTNET_DOWNLOAD_URL = 'https://dotnet.microsoft.com/download';

export { runDevCertTrust };
