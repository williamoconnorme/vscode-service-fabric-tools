import * as vscode from 'vscode';
import * as cp from 'child_process';
import { parseDevCertCheckOutput, type DevCertProbeResult } from './devCertProbe';

/** The slice of the extension logger the dev-cert flow uses. */
export interface DevCertLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string, err?: unknown): void;
	readonly outputChannel: vscode.OutputChannel;
}

export interface DevCertTelemetry {
	event(name: string, properties?: Record<string, string | number | boolean | undefined>): void;
}

/** Final outcome of a trust run; also reported as the `devcert.trust` telemetry outcome. */
export type DevCertTrustOutcome =
	'tooling-missing' | 'already-trusted' | 'expiring-acknowledged' | 'declined' | 'regenerated' | 'failed' | 'linux-manual';

interface DevCertsCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	/** Set when the process could not be spawned (e.g. `dotnet` not on PATH). */
	spawnError?: boolean;
}

const LINUX_TRUST_DOCS_URL =
	'https://learn.microsoft.com/en-us/aspnet/core/security/enforcing-ssl#trust-the-aspnet-core-https-development-certificate';
const DOTNET_DOWNLOAD_URL = 'https://dotnet.microsoft.com/download';

/**
 * `serviceFabric.devCert.trust`: probes the ASP.NET Core HTTPS development
 * certificate with `dotnet dev-certs https --check`, then offers to
 * (re)generate and trust it as needed. On Linux, trust is distro-specific, so
 * the cert is only (re)generated and the user is pointed at the docs.
 *
 * @param trigger Recorded in telemetry (`'manual'` for the command palette).
 */
export async function runDevCertTrust(
	logger: DevCertLogger,
	telemetry: DevCertTelemetry,
	trigger = 'manual',
): Promise<DevCertTrustOutcome> {
	const platform = process.platform;
	const warningDays = vscode.workspace.getConfiguration('serviceFabric').get<number>('devCert.expirationWarningDays', 30);
	logger.info(`Dev-cert trust: starting (platform=${platform}, trigger=${trigger}).`);
	const check = await runDevCertsCommand('dotnet', ['dev-certs', 'https', '--check', '--verbose'], logger);
	if (check.spawnError) {
		vscode.window
			.showErrorMessage("Could not run 'dotnet dev-certs'. Install the .NET SDK and ensure 'dotnet' is on PATH.", 'Open .NET Download')
			.then((pick) => {
				if (pick === 'Open .NET Download') vscode.env.openExternal(vscode.Uri.parse(DOTNET_DOWNLOAD_URL));
			});
		emitDevCertTrustTelemetry(telemetry, trigger, platform, 'tooling-missing');
		return 'tooling-missing';
	}
	const probe = parseDevCertCheckOutput(check.stdout, check.stderr, check.exitCode ?? 0, new Date().toISOString(), warningDays);
	logger.info(`Dev-cert probe: ${probe.kind}`);
	if (platform === 'linux') return await handleLinuxDevCert(probe, logger, telemetry, trigger);

	if (probe.kind === 'valid') {
		const remaining = Number.isFinite(probe.daysRemaining) ? `${probe.daysRemaining} day(s)` : 'long';
		vscode.window.showInformationMessage(`ASP.NET Core HTTPS dev certificate is valid and trusted (${remaining} remaining).`);
		emitDevCertTrustTelemetry(telemetry, trigger, platform, 'already-trusted');
		return 'already-trusted';
	}
	if (probe.kind === 'expiring') {
		const pick = await vscode.window.showWarningMessage(
			`ASP.NET Core HTTPS dev certificate expires in ${probe.daysRemaining} day(s). Regenerate now?`,
			'Regenerate',
			'Not now',
		);
		if (pick !== 'Regenerate') {
			emitDevCertTrustTelemetry(telemetry, trigger, platform, 'expiring-acknowledged');
			return 'expiring-acknowledged';
		}
		return await regenerateAndTrust(logger, telemetry, trigger, platform);
	}
	if (probe.kind === 'expired' || probe.kind === 'missing' || probe.kind === 'untrusted') {
		const state =
			probe.kind === 'expired' ? `expired ${probe.daysOverdue} day(s) ago` : probe.kind === 'missing' ? 'is not present' : 'is not trusted';
		const pick = await vscode.window.showInformationMessage(
			`ASP.NET Core HTTPS dev certificate ${state}. Generate and trust it now?`,
			'Yes',
			'No',
		);
		if (pick !== 'Yes') {
			emitDevCertTrustTelemetry(telemetry, trigger, platform, 'declined');
			return 'declined';
		}
		return await regenerateAndTrust(logger, telemetry, trigger, platform);
	}
	logger.warn(`Dev-cert --check produced unparseable output:
${probe.raw}`);
	vscode.window
		.showErrorMessage(
			"Could not interpret 'dotnet dev-certs https --check' output. See the Service Fabric output channel.",
			'Open Output Channel',
		)
		.then((pick) => {
			if (pick === 'Open Output Channel') logger.outputChannel.show();
		});
	emitDevCertTrustTelemetry(telemetry, trigger, platform, 'failed');
	return 'failed';
}

/** `--clean` then `--trust`; a failed `--clean` is logged but does not stop the trust step. */
async function regenerateAndTrust(
	logger: DevCertLogger,
	telemetry: DevCertTelemetry,
	trigger: string,
	platform: NodeJS.Platform,
): Promise<DevCertTrustOutcome> {
	const clean = await runDevCertsCommand('dotnet', ['dev-certs', 'https', '--clean'], logger);
	if (clean.exitCode !== 0) logger.warn(`dotnet dev-certs https --clean exited ${clean.exitCode}; continuing to --trust.`);
	const trust = await runDevCertsCommand('dotnet', ['dev-certs', 'https', '--trust'], logger);
	if (trust.spawnError || (trust.exitCode ?? 1) !== 0) {
		vscode.window
			.showErrorMessage(
				'Failed to trust the ASP.NET Core HTTPS dev certificate. See the Service Fabric output channel for details.',
				'Open Output Channel',
			)
			.then((pick) => {
				if (pick === 'Open Output Channel') logger.outputChannel.show();
			});
		emitDevCertTrustTelemetry(telemetry, trigger, platform, 'failed');
		return 'failed';
	}
	vscode.window.showInformationMessage('ASP.NET Core HTTPS dev certificate generated and trusted.');
	emitDevCertTrustTelemetry(telemetry, trigger, platform, 'regenerated');
	return 'regenerated';
}

async function handleLinuxDevCert(
	probe: DevCertProbeResult,
	logger: DevCertLogger,
	telemetry: DevCertTelemetry,
	trigger: string,
): Promise<DevCertTrustOutcome> {
	if (probe.kind === 'valid') {
		vscode.window.showInformationMessage('ASP.NET Core HTTPS dev certificate is present.');
		emitDevCertTrustTelemetry(telemetry, trigger, 'linux', 'already-trusted');
		return 'already-trusted';
	}
	if (probe.kind === 'missing' || probe.kind === 'expired') {
		await runDevCertsCommand('dotnet', ['dev-certs', 'https', '--clean'], logger);
		await runDevCertsCommand('dotnet', ['dev-certs', 'https'], logger);
	}
	vscode.window
		.showWarningMessage(
			'Trust on Linux is distro-specific. The dev certificate has been (re)generated; follow the Microsoft docs to trust it manually.',
			'Open Docs',
		)
		.then((pick) => {
			if (pick === 'Open Docs') vscode.env.openExternal(vscode.Uri.parse(LINUX_TRUST_DOCS_URL));
		});
	emitDevCertTrustTelemetry(telemetry, trigger, 'linux', 'linux-manual');
	return 'linux-manual';
}

/** Spawns a command, teeing stdout/stderr to the output channel while capturing both. Never rejects. */
function runDevCertsCommand(command: string, args: string[], logger: DevCertLogger): Promise<DevCertsCommandResult> {
	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let child: cp.ChildProcess;
		try {
			child = cp.spawn(command, args, { shell: false });
		} catch (err) {
			logger.error(`Failed to spawn ${command} ${args.join(' ')}`, err);
			resolve({ stdout: '', stderr: '', exitCode: null, spawnError: true });
			return;
		}
		child.stdout?.on('data', (data: Buffer) => {
			const text = data.toString('utf8');
			stdout += text;
			logger.outputChannel.append(text);
		});
		child.stderr?.on('data', (data: Buffer) => {
			const text = data.toString('utf8');
			stderr += text;
			logger.outputChannel.append(text);
		});
		child.on('error', (err) => {
			logger.error(`Subprocess ${command} errored`, err);
			resolve({ stdout, stderr, exitCode: null, spawnError: true });
		});
		child.on('close', (code) => {
			resolve({ stdout, stderr, exitCode: code });
		});
	});
}

function emitDevCertTrustTelemetry(
	telemetry: DevCertTelemetry,
	trigger: string,
	platform: NodeJS.Platform,
	outcome: DevCertTrustOutcome,
): void {
	telemetry.event('devcert.trust', { trigger, platform, outcome });
}
