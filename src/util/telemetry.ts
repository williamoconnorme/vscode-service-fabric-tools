// @ts-nocheck
import * as vscode from 'vscode';

var Telemetry = class {
	constructor(t) {
		this.logger = t;
		(this.recompute(),
			(this.disposable = vscode.workspace.onDidChangeConfiguration((r) => {
				(r.affectsConfiguration('telemetry.telemetryLevel') || r.affectsConfiguration('serviceFabric.telemetry.enabled')) &&
					this.recompute();
			})));
	}
	enabled = !1;
	disposable;
	recompute() {
		let t = vscode.workspace.getConfiguration('telemetry').get('telemetryLevel') ?? 'all',
			r = vscode.workspace.getConfiguration('serviceFabric').get('telemetry.enabled') ?? !1;
		this.enabled = r && t !== 'off';
	}
	isEnabled() {
		return this.enabled;
	}
	event(t, r) {
		if (!this.enabled) return;
		let n = r ? sanitizeTelemetryProperties(r) : {};
		this.logger.debug(`[telemetry] ${t} ${JSON.stringify(n)}`);
	}
	error(t, r, n) {
		if (!this.enabled) return;
		let i = {
			...(n ?? {}),
			error: r instanceof Error ? r.name : 'unknown',
		};
		this.logger.debug(`[telemetry] error:${t} ${JSON.stringify(sanitizeTelemetryProperties(i))}`);
	}
	dispose() {
		this.disposable.dispose();
	}
};

function sanitizeTelemetryProperties(e) {
	let t = {};
	for (let [r, n] of Object.entries(e)) {
		if (n === void 0) continue;
		if (typeof n == 'number' || typeof n == 'boolean') {
			t[r] = n;
			continue;
		}
		let i = String(n);
		if (isSensitiveKey(r)) {
			t[r] = '<redacted>';
			continue;
		}
		looksLikeUrl(i)
			? (t[r] = 'http://<redacted>')
			: i.length <= 32 && /^[a-zA-Z0-9_.-]+$/.test(i)
				? (t[r] = i)
				: (t[r] = `<len:${i.length}>`);
	}
	return t;
}

function isSensitiveKey(e) {
	return /name|user|host|endpoint|path|app|cluster|node/i.test(e);
}

function looksLikeUrl(e) {
	return /^https?:\/\//i.test(e);
}

export { Telemetry };
