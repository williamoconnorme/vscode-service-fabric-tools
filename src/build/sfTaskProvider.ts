// @ts-nocheck
import * as vscode from 'vscode';
import * as path from 'path';
import { locateMsBuild } from './msbuildLocator';

var ServiceFabricTaskProvider = class e {
	constructor(t) {
		this.watcher = t;
	}
	static type = 'servicefabric';
	async provideTasks(t) {
		let r = [];
		for (let n of this.watcher.getProjects())
			for (let i of ['Build', 'Rebuild', 'Clean', 'Package']) r.push(await createSfBuildTask(n.sfproj.path, i));
		return r;
	}
	async resolveTask(t, r) {
		let n = t.definition;
		if (n.type !== e.type || !n.project || !n.target) return;
		let i = resolveProjectPath(n.project);
		if (i) return createSfBuildTask(i, n.target, n.configuration, n.platform, t.scope);
	}
};

function resolveProjectPath(e) {
	if (path.isAbsolute(e)) return e;
	let t = vscode.workspace.workspaceFolders?.[0];
	if (t) return path.join(t.uri.fsPath, e);
}

async function createSfBuildTask(e, t, r = 'Debug', n = 'x64', i) {
	let o = await locateMsBuild(),
		s = [...o.leadingArgs, e, `/t:${t}`, `/p:Configuration=${r}`, `/p:Platform=${n}`, '/nologo', '/v:minimal'],
		a = new vscode.ProcessExecution(o.executable, s),
		c = {
			type: ServiceFabricTaskProvider.type,
			project: e,
			target: t,
			configuration: r,
			platform: n,
		},
		l = new vscode.Task(c, i ?? vscode.TaskScope.Workspace, `${t} ${path.basename(e)}`, 'servicefabric', a, ['$msCompile']);
	return (
		(l.detail = `${o.description}`),
		(l.group = t === 'Build' || t === 'Rebuild' ? vscode.TaskGroup.Build : t === 'Clean' ? vscode.TaskGroup.Clean : vscode.TaskGroup.Build),
		(l.presentationOptions = {
			echo: !0,
			reveal: vscode.TaskRevealKind.Always,
			focus: !1,
			panel: vscode.TaskPanelKind.Dedicated,
			clear: !0,
		}),
		l
	);
}

export { ServiceFabricTaskProvider, createSfBuildTask };
