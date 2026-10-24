// @ts-nocheck
import * as vscode from 'vscode';

var STORE_KEY = 'serviceFabric.connections',
	ACTIVE_KEY = 'serviceFabric.activeClusterId',
	ConnectionStore = class {
		constructor(t) {
			this.context = t;
		}
		emitter = new vscode.EventEmitter();
		onDidChange = this.emitter.event;
		list() {
			return this.context.workspaceState.get(STORE_KEY, []);
		}
		get(t) {
			return this.list().find((r) => r.id === t);
		}
		getActive() {
			let t = this.context.workspaceState.get(ACTIVE_KEY);
			return t ? this.get(t) : this.list()[0];
		}
		async setActive(t) {
			(await this.context.workspaceState.update(ACTIVE_KEY, t), this.emitter.fire());
		}
		async upsert(t) {
			let r = this.list(),
				n = r.findIndex((i) => i.id === t.id);
			(n >= 0 ? (r[n] = t) : r.push(t),
				await this.context.workspaceState.update(STORE_KEY, r),
				this.context.workspaceState.get(ACTIVE_KEY) || (await this.context.workspaceState.update(ACTIVE_KEY, t.id)),
				this.emitter.fire());
		}
		async remove(t) {
			let r = this.list().filter((i) => i.id !== t);
			(await this.context.workspaceState.update(STORE_KEY, r),
				this.context.workspaceState.get(ACTIVE_KEY) === t && (await this.context.workspaceState.update(ACTIVE_KEY, r[0]?.id)),
				this.emitter.fire());
		}
		dispose() {
			this.emitter.dispose();
		}
	};

export { ConnectionStore };
