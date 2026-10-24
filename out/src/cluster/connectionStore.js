"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionStore = void 0;
const vscode = __importStar(require("vscode"));
const STORE_KEY = 'serviceFabric.connections';
const ACTIVE_KEY = 'serviceFabric.activeClusterId';
class ConnectionStore {
    context;
    emitter = new vscode.EventEmitter();
    onDidChange = this.emitter.event;
    constructor(context) {
        this.context = context;
    }
    list() {
        return this.context.workspaceState.get(STORE_KEY, []);
    }
    get(id) {
        return this.list().find(c => c.id === id);
    }
    getActive() {
        const id = this.context.workspaceState.get(ACTIVE_KEY);
        return id ? this.get(id) : this.list()[0];
    }
    async setActive(id) {
        await this.context.workspaceState.update(ACTIVE_KEY, id);
        this.emitter.fire();
    }
    async upsert(conn) {
        const all = this.list();
        const idx = all.findIndex(c => c.id === conn.id);
        if (idx >= 0)
            all[idx] = conn;
        else
            all.push(conn);
        await this.context.workspaceState.update(STORE_KEY, all);
        if (!this.context.workspaceState.get(ACTIVE_KEY)) {
            await this.context.workspaceState.update(ACTIVE_KEY, conn.id);
        }
        this.emitter.fire();
    }
    async remove(id) {
        const all = this.list().filter(c => c.id !== id);
        await this.context.workspaceState.update(STORE_KEY, all);
        const active = this.context.workspaceState.get(ACTIVE_KEY);
        if (active === id) {
            await this.context.workspaceState.update(ACTIVE_KEY, all[0]?.id);
        }
        this.emitter.fire();
    }
    dispose() {
        this.emitter.dispose();
    }
}
exports.ConnectionStore = ConnectionStore;
//# sourceMappingURL=connectionStore.js.map