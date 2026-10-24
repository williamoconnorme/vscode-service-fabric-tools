import * as vscode from 'vscode';
import type { Logger } from './logger';

/** Raw event properties as supplied by callers; values are sanitized before logging. */
export type TelemetryProperties = Record<string, string | number | boolean | undefined>;

/** Properties after redaction: numbers/booleans pass through, strings are redacted or kept if short and safe. */
export type SanitizedTelemetryProperties = Record<string, string | number | boolean>;

/**
 * Local-only telemetry. Events are written to the Service Fabric output channel at
 * debug verbosity; nothing leaves the machine. Enabled only when
 * `serviceFabric.telemetry.enabled` is true and VS Code's `telemetry.telemetryLevel`
 * is not `off`.
 */
export class Telemetry implements vscode.Disposable {
	private enabled = false;
	private readonly disposable: vscode.Disposable;

	constructor(private readonly logger: Logger) {
		this.recompute();
		this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('telemetry.telemetryLevel') || e.affectsConfiguration('serviceFabric.telemetry.enabled')) {
				this.recompute();
			}
		});
	}

	private recompute(): void {
		const level = vscode.workspace.getConfiguration('telemetry').get<string>('telemetryLevel') ?? 'all';
		const optedIn = vscode.workspace.getConfiguration('serviceFabric').get<boolean>('telemetry.enabled') ?? false;
		this.enabled = optedIn && level !== 'off';
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	event(name: string, properties?: TelemetryProperties): void {
		if (!this.enabled) return;
		const sanitized = properties ? sanitizeTelemetryProperties(properties) : {};
		this.logger.debug(`[telemetry] ${name} ${JSON.stringify(sanitized)}`);
	}

	/** Logs an error event. Only the error's `name` is recorded, never its message. */
	error(name: string, err: unknown, properties?: TelemetryProperties): void {
		if (!this.enabled) return;
		const merged: TelemetryProperties = {
			...(properties ?? {}),
			error: err instanceof Error ? err.name : 'unknown',
		};
		this.logger.debug(`[telemetry] error:${name} ${JSON.stringify(sanitizeTelemetryProperties(merged))}`);
	}

	dispose(): void {
		this.disposable.dispose();
	}
}

/**
 * Redacts property values: undefined values are dropped, numbers/booleans kept,
 * keys that look identifying are `<redacted>`, URLs become `http://<redacted>`,
 * short identifier-like strings are kept, anything else is replaced by its length.
 */
function sanitizeTelemetryProperties(properties: TelemetryProperties): SanitizedTelemetryProperties {
	const out: SanitizedTelemetryProperties = {};
	for (const [key, value] of Object.entries(properties)) {
		if (value === undefined) continue;
		if (typeof value == 'number' || typeof value == 'boolean') {
			out[key] = value;
			continue;
		}
		const text = String(value);
		if (isSensitiveKey(key)) {
			out[key] = '<redacted>';
			continue;
		}
		if (looksLikeUrl(text)) {
			out[key] = 'http://<redacted>';
		} else if (text.length <= 32 && /^[a-zA-Z0-9_.-]+$/.test(text)) {
			out[key] = text;
		} else {
			out[key] = `<len:${text.length}>`;
		}
	}
	return out;
}

function isSensitiveKey(key: string): boolean {
	return /name|user|host|endpoint|path|app|cluster|node/i.test(key);
}

function looksLikeUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}
