import * as vscode from 'vscode';
import type { ConnectionStore } from '../cluster/connectionStore';
import type { LocalClusterManager } from '../cluster/localCluster';

/** Minimal logger surface used here (structurally matches util/logger's Logger). */
interface StatusBarLogger {
	debug(message: string): void;
}

/** Status bar entry showing the active cluster; polls the local cluster every 30s. */
export class ClusterStatusBar implements vscode.Disposable {
	private item: vscode.StatusBarItem;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly store: ConnectionStore,
		private readonly local: LocalClusterManager,
		private readonly logger: StatusBarLogger,
	) {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
		this.item.command = 'serviceFabric.cluster.selectActive';
		store.onDidChange(() => this.update());
		this.update();
		this.timer = setInterval(() => this.poll(), 30000);
	}

	update(): void {
		const active = this.store.getActive();
		if (!active) {
			this.item.text = '$(server) SF: not connected';
			this.item.tooltip = 'Click to select a Service Fabric cluster';
			this.item.show();
			return;
		}
		const icon = active.connected ? '$(pass-filled)' : '$(circle-slash)';
		const nodeCount = active.nodes?.length ?? 0;
		const mode = active.connected ? (nodeCount === 1 ? '1-node' : nodeCount === 5 ? '5-node' : nodeCount ? `${nodeCount}-node` : '') : '';
		const suffix = mode ? ` (${mode})` : '';
		this.item.text = `${icon} SF: ${active.label}${suffix}`;
		const tooltip = [active.endpoint];
		if (active.connected) {
			tooltip.push(`Health: ${active.aggregatedHealthState ?? 'Unknown'}`);
			tooltip.push(`Nodes: ${nodeCount}`);
			tooltip.push(`Applications: ${active.deployedApplications?.length ?? 0}`);
		} else {
			tooltip.push('Disconnected');
		}
		tooltip.push('Click to switch cluster');
		this.item.tooltip = tooltip.join('\n');
		this.item.show();
	}

	async poll(): Promise<void> {
		const active = this.store.getActive();
		if (!active || active.kind !== 'local') return;
		try {
			await this.local.refresh(active);
		} catch (err) {
			this.logger.debug(`Status poll failed: ${(err as Error).message}`);
		}
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.item.dispose();
	}
}
