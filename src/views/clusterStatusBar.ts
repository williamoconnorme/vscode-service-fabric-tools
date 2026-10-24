// @ts-nocheck
import * as vscode from 'vscode';

var ClusterStatusBar = class {
	constructor(t, r, n) {
		this.store = t;
		this.local = r;
		this.logger = n;
		((this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80)),
			(this.item.command = 'serviceFabric.cluster.selectActive'),
			t.onDidChange(() => this.update()),
			this.update(),
			(this.timer = setInterval(() => this.poll(), 3e4)));
	}
	item;
	timer;
	update() {
		let t = this.store.getActive();
		if (!t) {
			((this.item.text = '$(server) SF: not connected'),
				(this.item.tooltip = 'Click to select a Service Fabric cluster'),
				this.item.show());
			return;
		}
		let r = t.connected ? '$(pass-filled)' : '$(circle-slash)',
			n = t.nodes?.length ?? 0,
			i = t.connected ? (n === 1 ? '1-node' : n === 5 ? '5-node' : n ? `${n}-node` : '') : '',
			o = i ? ` (${i})` : '';
		this.item.text = `${r} SF: ${t.label}${o}`;
		let s = [t.endpoint];
		(t.connected
			? (s.push(`Health: ${t.aggregatedHealthState ?? 'Unknown'}`),
				s.push(`Nodes: ${n}`),
				s.push(`Applications: ${t.deployedApplications?.length ?? 0}`))
			: s.push('Disconnected'),
			s.push('Click to switch cluster'),
			(this.item.tooltip = s.join(`
`)),
			this.item.show());
	}
	async poll() {
		let t = this.store.getActive();
		if (!(!t || t.kind !== 'local'))
			try {
				await this.local.refresh(t);
			} catch (r) {
				this.logger.debug(`Status poll failed: ${r.message}`);
			}
	}
	dispose() {
		(this.timer && clearInterval(this.timer), this.item.dispose());
	}
};

export { ClusterStatusBar };
