// @ts-nocheck
import * as vscode from 'vscode';

var LEVEL_RANK = {
		error: 0,
		warn: 1,
		info: 2,
		debug: 3,
	},
	Logger = class {
		constructor(t) {
			this.channel = t;
		}
		level = LEVEL_RANK.info;
		setLevel(t) {
			this.level = LEVEL_RANK[t];
		}
		error(t, r) {
			this.level >= LEVEL_RANK.error && this.channel.appendLine(`[error] ${t}${r ? ' :: ' + formatError(r) : ''}`);
		}
		warn(t) {
			this.level >= LEVEL_RANK.warn && this.channel.appendLine(`[warn] ${t}`);
		}
		info(t) {
			this.level >= LEVEL_RANK.info && this.channel.appendLine(`[info] ${t}`);
		}
		debug(t) {
			this.level >= LEVEL_RANK.debug && this.channel.appendLine(`[debug] ${t}`);
		}
		show() {
			this.channel.show(!0);
		}
		raw(t) {
			this.channel.append(t);
		}
		get outputChannel() {
			return this.channel;
		}
	};

function formatError(e) {
	if (e instanceof Error)
		return `${e.message}
${e.stack ?? ''}`;
	try {
		return JSON.stringify(e);
	} catch {
		return String(e);
	}
}

function createLogger() {
	let e = vscode.window.createOutputChannel('Service Fabric');
	return {
		logger: new Logger(e),
		channel: e,
	};
}

export { createLogger };
