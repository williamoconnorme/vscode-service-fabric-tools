import * as vscode from 'vscode';
import type { ConnectionStore } from '../cluster/connectionStore';
import type { LocalClusterManager } from '../cluster/localCluster';
import type { ClustersTreeProvider, ClusterTreeItem } from './clustersTreeProvider';

/**
 * Refreshes the Clusters view every `serviceFabric.clusters.autoRefreshSeconds` while it is
 * visible and the window is focused: re-probes saved clusters (skipping ones the user
 * disconnected), then reloads the expanded rows so application, partition, replica and node
 * states stay current.
 */
export class ClustersAutoRefresh implements vscode.Disposable {
	private timer: ReturnType<typeof setInterval> | undefined;
	private running = false;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly store: ConnectionStore,
		private readonly local: LocalClusterManager,
		private readonly tree: ClustersTreeProvider,
		private readonly view: vscode.TreeView<ClusterTreeItem>,
	) {
		this.disposables.push(
			view.onDidChangeVisibility(() => this.reschedule(view.visible)),
			vscode.window.onDidChangeWindowState((state) => {
				if (state.focused) this.reschedule(true);
			}),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('serviceFabric.clusters.autoRefreshSeconds')) this.reschedule(false);
			}),
		);
		this.reschedule(false);
	}

	/** Restarts the timer; `now` also refreshes straight away (the view just appeared or the window regained focus). */
	private reschedule(now: boolean): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		const seconds = vscode.workspace.getConfiguration('serviceFabric').get<number>('clusters.autoRefreshSeconds') ?? 30;
		if (seconds <= 0 || !this.view.visible) return;
		this.timer = setInterval(() => void this.tick(), Math.max(seconds, 5) * 1000);
		if (now) void this.tick();
	}

	private async tick(): Promise<void> {
		if (this.running || !this.view.visible || !vscode.window.state.focused) return;
		const connections = this.store.list().filter((c) => !c.userDisconnected);
		if (connections.length === 0) return;
		this.running = true;
		try {
			// Background probes save (and redraw) only when the cluster's state changed.
			await Promise.all(connections.map((c) => this.local.refresh(c, { background: true })));
			// Entity states below a cluster aren't in the probe, so reload the expanded rows.
			if (this.store.list().some((c) => c.connected)) this.tree.refresh();
		} finally {
			this.running = false;
		}
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		for (const d of this.disposables) d.dispose();
	}
}
