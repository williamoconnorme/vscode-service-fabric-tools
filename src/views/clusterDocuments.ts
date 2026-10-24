import * as vscode from 'vscode';

/** Scheme for the read-only documents that show cluster entity details, health and logs. */
export const CLUSTER_DOCUMENT_SCHEME = 'sf-cluster';

/** Oldest documents are dropped past this many so closed tabs don't pin their content forever. */
const MAX_DOCUMENTS = 50;

/**
 * Serves the virtual documents opened by the "Show Details" / "Show Health" /
 * "Show Container Logs" commands. Content is kept in memory per URI; each `show`
 * creates a fresh URI so re-running a command opens the latest snapshot.
 */
export class ClusterDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private readonly contents = new Map<string, string>();
	private readonly registration: vscode.Disposable;

	constructor() {
		this.registration = vscode.workspace.registerTextDocumentContentProvider(CLUSTER_DOCUMENT_SCHEME, this);
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? '';
	}

	/** Opens `content` in a new read-only editor titled `title` with the given language. */
	async show(title: string, content: string, language: 'json' | 'xml' | 'log'): Promise<void> {
		const ext = language === 'log' ? 'log' : language;
		const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
		const uri = vscode.Uri.from({ scheme: CLUSTER_DOCUMENT_SCHEME, path: `/${safeTitle}.${ext}`, query: `t=${Date.now()}` });
		this.contents.set(uri.toString(), content);
		while (this.contents.size > MAX_DOCUMENTS) {
			const oldest = this.contents.keys().next().value;
			if (oldest === undefined) break;
			this.contents.delete(oldest);
		}
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.languages.setTextDocumentLanguage(doc, language);
		await vscode.window.showTextDocument(doc, { preview: false });
	}

	/** {@link show} for a JSON payload. */
	showJson(title: string, data: unknown): Promise<void> {
		return this.show(title, JSON.stringify(data ?? null, null, 2), 'json');
	}

	dispose(): void {
		this.registration.dispose();
		this.contents.clear();
	}
}
