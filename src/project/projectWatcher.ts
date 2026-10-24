// @ts-nocheck
import * as vscode from 'vscode';
import { loadApplicationProject } from './sfprojParser';

var SfProjectWatcher = class {
	constructor(t) {
		this.logger = t;
	}
	cache = new Map();
	emitter = new vscode.EventEmitter();
	onDidChange = this.emitter.event;
	watchers = [];
	inflight;
	async initialize() {
		await this.refreshAll();
		let t = vscode.workspace.createFileSystemWatcher('**/*.sfproj'),
			r = vscode.workspace.createFileSystemWatcher('**/{ApplicationManifest.xml,ServiceManifest.xml}'),
			n = vscode.workspace.createFileSystemWatcher('**/{PublishProfiles,ApplicationParameters,StartupServiceParameters,Scripts}/**'),
			i = vscode.workspace.createFileSystemWatcher('**/StartupServices.xml');
		for (let o of [t, r, n, i])
			(o.onDidChange(() => this.scheduleRefresh()),
				o.onDidCreate(() => this.scheduleRefresh()),
				o.onDidDelete(() => this.scheduleRefresh()),
				this.watchers.push(o));
		vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh());
	}
	getProjects() {
		return [...this.cache.values()];
	}
	getProjectByPath(t) {
		return this.cache.get(normalizeProjectKey(t));
	}
	scheduleRefresh() {
		this.inflight ||
			(this.inflight = (async () => {
				try {
					await this.refreshAll();
				} finally {
					this.inflight = void 0;
				}
			})());
	}
	async refreshAll() {
		let t = await vscode.workspace.findFiles('**/*.sfproj', '**/node_modules/**'),
			r = new Set();
		for (let n of t) {
			let i = normalizeProjectKey(n.fsPath);
			r.add(i);
			try {
				let o = await loadApplicationProject(n.fsPath);
				this.cache.set(i, o);
			} catch (o) {
				(this.logger.warn(`Failed to load ${n.fsPath}: ${o.message}`), this.cache.delete(i));
			}
		}
		for (let n of [...this.cache.keys()]) r.has(n) || this.cache.delete(n);
		this.emitter.fire();
	}
	dispose() {
		for (let t of this.watchers) t.dispose();
		this.emitter.dispose();
	}
};

function normalizeProjectKey(e) {
	return e.replace(/\\/g, '/').toLowerCase();
}

export { SfProjectWatcher };
