import * as vscode from 'vscode';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

/** Leveled logger that writes to the "Service Fabric" output channel. */
export class Logger {
	level: number = LEVEL_RANK.info;

	constructor(private readonly channel: vscode.OutputChannel) {}

	setLevel(level: LogLevel): void {
		this.level = LEVEL_RANK[level];
	}

	error(message: string, err?: unknown): void {
		if (this.level >= LEVEL_RANK.error) {
			this.channel.appendLine(`${timestamp()} [error] ${message}${err ? ' :: ' + formatError(err) : ''}`);
		}
	}

	warn(message: string): void {
		if (this.level >= LEVEL_RANK.warn) this.channel.appendLine(`${timestamp()} [warn] ${message}`);
	}

	info(message: string): void {
		if (this.level >= LEVEL_RANK.info) this.channel.appendLine(`${timestamp()} [info] ${message}`);
	}

	debug(message: string): void {
		if (this.level >= LEVEL_RANK.debug) this.channel.appendLine(`${timestamp()} [debug] ${message}`);
	}

	show(): void {
		this.channel.show(true);
	}

	/** Append text verbatim (no level prefix, no newline). */
	raw(text: string): void {
		this.channel.append(text);
	}

	get outputChannel(): vscode.OutputChannel {
		return this.channel;
	}
}

/** Local time as `YYYY-MM-DD HH:mm:ss.SSS`, the format VS Code's own log channels use. */
function timestamp(): string {
	const d = new Date();
	const pad = (n: number, w = 2) => String(n).padStart(w, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatError(err: unknown): string {
	if (err instanceof Error)
		return `${err.message}
${err.stack ?? ''}`;
	try {
		return JSON.stringify(err);
	} catch {
		return String(err);
	}
}

export function createLogger(): { logger: Logger; channel: vscode.OutputChannel } {
	// The `log` language colours levels, timestamps, URLs and GUIDs.
	const channel = vscode.window.createOutputChannel('Service Fabric', 'log');
	return {
		logger: new Logger(channel),
		channel,
	};
}
