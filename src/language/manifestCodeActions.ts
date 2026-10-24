// @ts-nocheck
import * as vscode from 'vscode';
import { findAttributeOccurrences, findParameterRefs } from '../util/xmlText';

var ManifestCodeActionProvider = class {
	constructor(t) {
		this.watcher = t;
	}
	static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
	provideCodeActions(t, r, n) {
		let i = [];
		for (let o of n.diagnostics)
			if (o.source === 'service-fabric') {
				if (o.code === 'SFD001') i.push(this.addParameterFix(t, o));
				else if (o.code === 'SFD004') {
					let s = this.syncVersionFix(t, o);
					s && i.push(s);
				}
			}
		return i;
	}
	addParameterFix(t, r) {
		let n = t.getText(),
			i = findParameterRefs(n),
			o = t.offsetAt(r.range.start),
			a = i.find((v) => o >= v.range.start && o <= v.range.end)?.name ?? t.getText(r.range).replace(/[\[\]]/g, ''),
			c = new vscode.CodeAction(`Add parameter '${a}' to <Parameters>`, vscode.CodeActionKind.QuickFix);
		((c.diagnostics = [r]), (c.isPreferred = !0));
		let l = new vscode.WorkspaceEdit(),
			u = `
    <Parameter Name="${a}" DefaultValue="" />`,
			p = /<Parameters\s*>/i,
			d = /<\/Parameters>/i,
			f = p.exec(n),
			m = d.exec(n);
		if (f && m) {
			let v = m.index,
				h = t.positionAt(v);
			l.insert(
				t.uri,
				h,
				u.trimStart() +
					`
  `,
			);
		} else {
			let v = /<ApplicationManifest[^>]*>/.exec(n);
			if (v) {
				let h = v.index + v[0].length,
					P = t.positionAt(h);
				l.insert(
					t.uri,
					P,
					`
  <Parameters>
    <Parameter Name="${a}" DefaultValue="" />
  </Parameters>`,
				);
			}
		}
		return ((c.edit = l), c);
	}
	syncVersionFix(t, r) {
		let n = this.watcher.getProjects().find((p) => p.applicationManifest?.path === t.uri.fsPath);
		if (!n) return;
		let i = t.getText(),
			o = findAttributeOccurrences(i, 'ServiceManifestRef', 'ServiceManifestName'),
			s = t.offsetAt(r.range.start),
			a = o.find((p) => s >= p.elementRange.start && s <= p.elementRange.end);
		if (!a) return;
		let c = n.serviceManifests.find((p) => p.name === a.value);
		if (!c || !c.version) return;
		let l = new vscode.CodeAction(`Sync ServiceManifestVersion to '${c.version}'`, vscode.CodeActionKind.QuickFix);
		((l.diagnostics = [r]), (l.isPreferred = !0));
		let u = new vscode.WorkspaceEdit();
		return (u.replace(t.uri, r.range, c.version), (l.edit = u), l);
	}
};

export { ManifestCodeActionProvider };
