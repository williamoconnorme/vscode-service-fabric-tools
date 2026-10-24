// @ts-nocheck
import * as vscode from 'vscode';
import { SfRestClient } from '../cluster/sfRestClient';

var DiagnosticEventsPanel = class {
	constructor(t, r) {
		this.store = t;
		this.logger = r;
	}
	panel;
	timer;
	show(t) {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			return;
		}
		let r = vscode.window.createWebviewPanel(
			'serviceFabric.diagnosticEvents',
			'Service Fabric: Diagnostic Events',
			vscode.ViewColumn.Active,
			{
				enableScripts: !0,
				retainContextWhenHidden: !0,
				localResourceRoots: [t],
			},
		);
		((this.panel = r),
			(r.webview.html = getDiagnosticEventsHtml()),
			r.onDidDispose(() => {
				((this.panel = void 0), this.timer && (clearInterval(this.timer), (this.timer = void 0)));
			}),
			r.webview.onDidReceiveMessage((n) => {
				n?.type === 'refresh' && this.poll();
			}),
			this.poll(),
			(this.timer = setInterval(() => this.poll(), 15e3)));
	}
	async poll() {
		if (!this.panel) return;
		let t = this.store.getActive();
		if (!t?.connected) {
			this.panel.webview.postMessage({
				type: 'state',
				state: {
					connected: !1,
					events: [],
					message: 'No active cluster connection.',
				},
			});
			return;
		}
		let r = new SfRestClient(t.endpoint),
			n = new Date(Date.now() - 60 * 60 * 1e3).toISOString(),
			i = new Date().toISOString();
		try {
			let o = `/EventsStore/Cluster/Events?StartTimeUtc=${encodeURIComponent(n)}&EndTimeUtc=${encodeURIComponent(i)}`,
				s = await r.rawGet(o, 6e3),
				a = Array.isArray(s) ? s.slice().reverse() : [];
			this.panel.webview.postMessage({
				type: 'state',
				state: {
					connected: !0,
					endpoint: t.endpoint,
					label: t.label,
					events: a.slice(0, 200),
				},
			});
		} catch (o) {
			(this.logger.warn(`Diagnostic events poll failed: ${o.message}`),
				this.panel.webview.postMessage({
					type: 'state',
					state: {
						connected: !0,
						endpoint: t.endpoint,
						label: t.label,
						events: [],
						message: `Failed to fetch /EventsStore. Most local dev clusters do not enable EventStore \u2014 this view is best used with clusters that have EventStore configured. (${o.message})`,
					},
				}));
		}
	}
	dispose() {
		(this.timer && clearInterval(this.timer), this.panel?.dispose());
	}
};

function getDiagnosticEventsHtml() {
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

export { DiagnosticEventsPanel };
