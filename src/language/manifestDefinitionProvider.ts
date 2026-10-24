import * as vscode from 'vscode';
import type { SfProjectWatcher } from '../project/projectWatcher';
import { findAttributeOccurrences } from '../util/xmlText';

/**
 * Go-to-definition from `<ServiceManifestRef ServiceManifestName="...">` in
 * ApplicationManifest.xml to the matching on-disk ServiceManifest.xml.
 */
export class ManifestDefinitionProvider implements vscode.DefinitionProvider {
	constructor(private readonly watcher: SfProjectWatcher) {}

	provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location | undefined {
		if (!document.uri.fsPath.toLowerCase().endsWith('applicationmanifest.xml')) return undefined;
		const project = this.watcher.getProjects().find((p) => p.applicationManifest?.path === document.uri.fsPath);
		if (!project) return undefined;
		const text = document.getText();
		const refs = findAttributeOccurrences(text, 'ServiceManifestRef', 'ServiceManifestName');
		const offset = document.offsetAt(position);
		const hit = refs.find((r) => offset >= r.valueRange.start && offset <= r.valueRange.end);
		if (!hit) return undefined;
		const sm = project.serviceManifests.find((s) => s.name === hit.value);
		if (sm) return new vscode.Location(vscode.Uri.file(sm.path), new vscode.Position(0, 0));
		return undefined;
	}
}
