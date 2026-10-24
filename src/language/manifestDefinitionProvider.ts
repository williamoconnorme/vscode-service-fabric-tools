// @ts-nocheck
import * as vscode from 'vscode';
import { findAttributeOccurrences } from '../util/xmlText';

var ManifestDefinitionProvider = class {
	constructor(t) {
		this.watcher = t;
	}
	provideDefinition(t, r) {
		if (!t.uri.fsPath.toLowerCase().endsWith('applicationmanifest.xml')) return;
		let i = this.watcher.getProjects().find((u) => u.applicationManifest?.path === t.uri.fsPath);
		if (!i) return;
		let o = t.getText(),
			s = findAttributeOccurrences(o, 'ServiceManifestRef', 'ServiceManifestName'),
			a = t.offsetAt(r),
			c = s.find((u) => a >= u.valueRange.start && a <= u.valueRange.end);
		if (!c) return;
		let l = i.serviceManifests.find((u) => u.name === c.value);
		if (l) return new vscode.Location(vscode.Uri.file(l.path), new vscode.Position(0, 0));
	}
};

export { ManifestDefinitionProvider };
