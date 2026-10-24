// @ts-nocheck
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { buildScriptWithParameters } from './powerShellScript';

async function runPowerShell(e, t, r, n, i = {}) {
	let o = resolvePowerShellExecutable(),
		s = buildScriptWithParameters(t, r),
		a = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', s];
	e.info(`Running ${o} (script length ${s.length} chars)`);
	let c = i.capture ? [] : void 0;
	return new Promise((l, u) => {
		let p = (0, cp.spawn)(o, a, {
			windowsHide: !0,
		});
		n?.onCancellationRequested(() => p.kill('SIGTERM'));
		let d = (f) => {
			let m = f.toString();
			(e.raw(m), c?.push(m));
		};
		(p.stdout.on('data', d),
			p.stderr.on('data', d),
			p.on('error', (f) => u(f)),
			p.on('close', (f, m) => {
				if (m) {
					u(new Error(`PowerShell terminated by signal ${m}`));
					return;
				}
				l({
					exitCode: f ?? -1,
					output: c ? c.join('') : void 0,
				});
			}));
	});
}

function resolvePowerShellExecutable() {
	let e = vscode.workspace.getConfiguration('serviceFabric').get('powerShell.executable') ?? 'auto';
	return e === 'pwsh' ? 'pwsh' : e === 'powershell' || process.platform === 'win32' ? 'powershell' : 'pwsh';
}

export { runPowerShell };
