import * as vscode from 'vscode';
import type { ConnectionStore } from '../cluster/connectionStore';
import { SfRestClient } from '../cluster/sfRestClient';
import type { Logger } from '../util/logger';

/** One EventStore record as returned by `/EventsStore/Cluster/Events` (parsed JSON, rendered by the webview as-is). */
export type DiagnosticEvent = Record<string, unknown>;

/** The state message posted to the webview. */
interface DiagnosticEventsState {
	connected: boolean;
	endpoint?: string;
	label?: string;
	events: DiagnosticEvent[];
	message?: string;
}

/** Messages the webview sends back to the extension. */
interface PanelMessage {
	type?: string;
}

const POLL_INTERVAL_MS = 15e3;
const LOOKBACK_MS = 60 * 60 * 1e3;
const REQUEST_TIMEOUT_MS = 6e3;
const MAX_EVENTS = 200;

/**
 * Webview for `serviceFabric.diagnostics.showEvents`: polls the active cluster's
 * EventStore for the last hour of cluster events, newest first.
 */
export class DiagnosticEventsPanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly store: ConnectionStore,
		private readonly logger: Logger,
	) {}

	show(extensionUri: vscode.Uri): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'serviceFabric.diagnosticEvents',
			'Service Fabric: Diagnostic Events',
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			},
		);
		this.panel = panel;
		panel.webview.html = getDiagnosticEventsHtml();
		panel.onDidDispose(() => {
			this.panel = undefined;
			if (this.timer) {
				clearInterval(this.timer);
				this.timer = undefined;
			}
		});
		panel.webview.onDidReceiveMessage((msg: PanelMessage | undefined) => {
			if (msg?.type === 'refresh') this.poll();
		});
		this.poll();
		this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
	}

	/** Posts state to the webview; a no-op if the panel was closed while a poll was in flight. */
	private postState(state: DiagnosticEventsState): void {
		this.panel?.webview.postMessage({ type: 'state', state });
	}

	async poll(): Promise<void> {
		if (!this.panel) return;
		const active = this.store.getActive();
		if (!active?.connected) {
			this.postState({ connected: false, events: [], message: 'No active cluster connection.' });
			return;
		}
		const client = new SfRestClient(active.endpoint);
		const start = new Date(Date.now() - LOOKBACK_MS).toISOString();
		const end = new Date().toISOString();
		try {
			const pathAndQuery = `/EventsStore/Cluster/Events?StartTimeUtc=${encodeURIComponent(start)}&EndTimeUtc=${encodeURIComponent(end)}`;
			const body: unknown = await client.rawGet(pathAndQuery, REQUEST_TIMEOUT_MS);
			const events: DiagnosticEvent[] = Array.isArray(body) ? body.slice().reverse() : [];
			this.postState({
				connected: true,
				endpoint: active.endpoint,
				label: active.label,
				events: events.slice(0, MAX_EVENTS),
			});
		} catch (err) {
			const message = (err as Error).message;
			this.logger.warn(`Diagnostic events poll failed: ${message}`);
			this.postState({
				connected: true,
				endpoint: active.endpoint,
				label: active.label,
				events: [],
				message: `Failed to fetch /EventsStore. Most local dev clusters do not enable EventStore — this view is best used with clusters that have EventStore configured. (${message})`,
			});
		}
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.panel?.dispose();
	}
}

function getDiagnosticEventsHtml(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Diagnostic Events</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
  header h2 { margin: 0; font-size: 1.05em; }
  header span.endpoint { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  button { padding: 4px 10px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; vertical-align: top; }
  th { position: sticky; top: 0; background: var(--vscode-editor-background); }
  tr:hover { background: var(--vscode-list-hoverBackground); }
  .kind { font-weight: 600; }
  .category-Health { color: var(--vscode-charts-green); }
  .category-StateTransition { color: var(--vscode-charts-blue); }
  .category-Operational { color: var(--vscode-charts-yellow); }
  .meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 32px 0; text-align: center; }
  details { margin-top: 4px; }
  details > summary { cursor: pointer; color: var(--vscode-textLink-foreground); }
  pre { margin: 4px 0; white-space: pre-wrap; word-break: break-all; font-size: 11px; }
</style>
</head>
<body>
<header>
  <h2>Service Fabric Diagnostic Events</h2>
  <span class="endpoint" id="endpoint">disconnected</span>
  <button id="refresh">Refresh</button>
</header>
<div id="content"><div class="empty">Loading\u2026</div></div>
<script>
const vscode = acquireVsCodeApi();
document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type !== 'state') return;
  const s = msg.state;
  document.getElementById('endpoint').textContent = s.connected ? (s.label + ' \u2022 ' + s.endpoint) : 'disconnected';
  const root = document.getElementById('content');
  if (!s.events?.length) {
    root.innerHTML = '<div class="empty">' + (s.message || 'No events in the last hour.') + '</div>';
    return;
  }
  const rows = s.events.map((e) => {
    const kind = escapeHtml(e.Kind || '');
    const cat = escapeHtml(e.Category || '');
    const ts = escapeHtml(e.TimeStamp || '');
    const id = escapeHtml(e.EventInstanceId || '');
    const props = Object.entries(e)
      .filter(([k]) => !['Kind','Category','TimeStamp','EventInstanceId','HasCorrelatedEvents'].includes(k))
      .map(([k,v]) => k + ': ' + escapeHtml(JSON.stringify(v)))
      .join('\\n');
    return '<tr><td><span class="kind">' + kind + '</span><div class="meta">' + id + '</div></td>' +
           '<td><span class="category-' + cat + '">' + cat + '</span></td>' +
           '<td>' + ts + '</td>' +
           '<td><details><summary>details</summary><pre>' + escapeHtml(props) + '</pre></details></td></tr>';
  }).join('');
  root.innerHTML = '<table><thead><tr><th>Kind</th><th>Category</th><th>Timestamp (UTC)</th><th>Properties</th></tr></thead><tbody>' + rows + '</tbody></table>';
});
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
</script>
</body>
</html>`;
}
