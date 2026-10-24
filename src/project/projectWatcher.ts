import * as vscode from 'vscode';
import type { Logger } from '../util/logger';
import type { ApplicationProject } from './sfprojModel';
import { loadApplicationProject } from './sfprojParser';

/**
 * Discovers every `.sfproj` in the workspace, keeps a parsed
 * {@link ApplicationProject} for each, and re-parses when project files,
 * manifests or support folders change.
 */
export class SfProjectWatcher implements vscode.Disposable {
	/** Keyed by {@link normalizeProjectKey} of the .sfproj path. */
	private readonly cache = new Map<string, ApplicationProject>();
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChange: vscode.Event<void> = this.emitter.event;
	private readonly watchers: vscode.FileSystemWatcher[] = [];
	private inflight: Promise<void> | undefined;

	constructor(private readonly logger: Logger) {}

	async initialize(): Promise<void> {
		await this.refreshAll();
		const sfprojWatcher = vscode.workspace.createFileSystemWatcher('**/*.sfproj');
		const manifestWatcher = vscode.workspace.createFileSystemWatcher('**/{ApplicationManifest.xml,ServiceManifest.xml}');
		const supportFilesWatcher = vscode.workspace.createFileSystemWatcher(
			'**/{PublishProfiles,ApplicationParameters,StartupServiceParameters,Scripts}/**',
		);
		const startupServicesWatcher = vscode.workspace.createFileSystemWatcher('**/StartupServices.xml');
		for (const w of [sfprojWatcher, manifestWatcher, supportFilesWatcher, startupServicesWatcher]) {
			w.onDidChange(() => this.scheduleRefresh());
			w.onDidCreate(() => this.scheduleRefresh());
			w.onDidDelete(() => this.scheduleRefresh());
			this.watchers.push(w);
		}
		vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh());
	}

	getProjects(): ApplicationProject[] {
		return [...this.cache.values()];
	}

	getProjectByPath(sfprojPath: string): ApplicationProject | undefined {
		return this.cache.get(normalizeProjectKey(sfprojPath));
	}

	/** Coalesce bursts of change events: at most one refresh runs at a time. */
	scheduleRefresh(): void {
		if (this.inflight) return;
		this.inflight = (async () => {
			try {
				await this.refreshAll();
			} finally {
				this.inflight = undefined;
			}
		})();
	}

	async refreshAll(): Promise<void> {
		const uris = await vscode.workspace.findFiles('**/*.sfproj', '**/node_modules/**');
		const seen = new Set<string>();
		for (const uri of uris) {
			const key = normalizeProjectKey(uri.fsPath);
			seen.add(key);
			try {
				const project = await loadApplicationProject(uri.fsPath);
				this.cache.set(key, project);
			} catch (err) {
				this.logger.warn(`Failed to load ${uri.fsPath}: ${(err as Error).message}`);
				this.cache.delete(key);
			}
		}
		for (const key of [...this.cache.keys()]) {
			if (!seen.has(key)) this.cache.delete(key);
		}
		this.emitter.fire();
	}

	dispose(): void {
		for (const w of this.watchers) w.dispose();
		this.emitter.dispose();
	}
}

/** Map key for a project path: `/` separators, and case-folded only where the file system is (Windows). */
function normalizeProjectKey(p: string): string {
	const slashed = p.replace(/\\/g, '/');
	return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}
