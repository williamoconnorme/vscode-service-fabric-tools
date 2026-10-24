import * as vscode from 'vscode';
import * as cp from 'child_process';
import type { Logger } from '../util/logger';
import { buildScriptWithParameters, type PowerShellParameterValue } from './powerShellScript';

export interface RunPowerShellOptions {
	/** Also collect stdout+stderr into {@link PowerShellResult.output}. */
	capture?: boolean;
}

export interface PowerShellResult {
	/** Process exit code, or -1 when none was reported. */
	exitCode: number;
	/** Combined stdout+stderr, only when `capture` was requested. */
	output?: string;
}

/**
 * Runs `script` in PowerShell (`-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command`),
 * with `parameters` bound as `$Name` variables. Output streams live to the logger's channel.
 * Rejects if the process can't be spawned or is killed by a signal (e.g. on cancellation).
 */
export async function runPowerShell(
	logger: Logger,
	script: string,
	parameters: Record<string, PowerShellParameterValue>,
	token?: vscode.CancellationToken,
	options: RunPowerShellOptions = {},
): Promise<PowerShellResult> {
	const executable = resolvePowerShellExecutable();
	const command = buildScriptWithParameters(script, parameters);
	const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];
	logger.info(`Running ${executable} (script length ${command.length} chars)`);
	const captured: string[] | undefined = options.capture ? [] : undefined;
	return new Promise((resolve, reject) => {
		const child = cp.spawn(executable, args, { windowsHide: true });
		token?.onCancellationRequested(() => child.kill('SIGTERM'));
		const onData = (chunk: Buffer): void => {
			const text = chunk.toString();
			logger.raw(text);
			captured?.push(text);
		};
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);
		child.on('error', (err) => reject(err));
		child.on('close', (code, signal) => {
			if (signal) {
				reject(new Error(`PowerShell terminated by signal ${signal}`));
				return;
			}
			resolve({ exitCode: code ?? -1, output: captured ? captured.join('') : undefined });
		});
	});
}

/** `serviceFabric.powerShell.executable`: `auto` means Windows PowerShell on Windows, `pwsh` elsewhere. */
function resolvePowerShellExecutable(): string {
	const setting = vscode.workspace.getConfiguration('serviceFabric').get<string>('powerShell.executable') ?? 'auto';
	return setting === 'pwsh' ? 'pwsh' : setting === 'powershell' || process.platform === 'win32' ? 'powershell' : 'pwsh';
}
