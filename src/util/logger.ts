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
			this.channel.appendLine(`[error] ${message}${err ? ' :: ' + formatError(err) : ''}`);
		}
	}

	warn(message: string): void {
		if (this.level >= LEVEL_RANK.warn) this.channel.appendLine(`[warn] ${message}`);
	}

	info(message: string): void {
		if (this.level >= LEVEL_RANK.info) this.channel.appendLine(`[info] ${message}`);
	}

	debug(message: string): void {
		if (this.level >= LEVEL_RANK.debug) this.channel.appendLine(`[debug] ${message}`);
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
	const channel = vscode.window.createOutputChannel('Service Fabric');
	return {
		logger: new Logger(channel),
		channel,
	};
}
