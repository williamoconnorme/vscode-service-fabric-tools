import * as vscode from 'vscode';
import type { SfProjectWatcher } from '../project/projectWatcher';
import { findAttributeOccurrences, findParameterRefs } from '../util/xmlText';

/** Quick fixes for the `service-fabric` manifest diagnostics (SFD001, SFD004). */
export class ManifestCodeActionProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	constructor(private readonly watcher: SfProjectWatcher) {}

	provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		for (const diagnostic of context.diagnostics) {
			if (diagnostic.source !== 'service-fabric') continue;
			if (diagnostic.code === 'SFD001') {
				actions.push(this.addParameterFix(document, diagnostic));
			} else if (diagnostic.code === 'SFD004') {
				const fix = this.syncVersionFix(document, diagnostic);
				if (fix) actions.push(fix);
			}
		}
		return actions;
	}

	/** SFD001: declare the referenced `[Param]` in `<Parameters>` (creating the block if needed). */
	private addParameterFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
		const text = document.getText();
		const refs = findParameterRefs(text);
		const offset = document.offsetAt(diagnostic.range.start);
		const name =
			refs.find((r) => offset >= r.range.start && offset <= r.range.end)?.name ?? document.getText(diagnostic.range).replace(/[\[\]]/g, '');
		const action = new vscode.CodeAction(`Add parameter '${name}' to <Parameters>`, vscode.CodeActionKind.QuickFix);
		action.diagnostics = [diagnostic];
		action.isPreferred = true;
		const edit = new vscode.WorkspaceEdit();
		const paramLine = `
    <Parameter Name="${name}" DefaultValue="" />`;
		const openRe = /<Parameters\s*>/i;
		const closeRe = /<\/Parameters>/i;
		const openMatch = openRe.exec(text);
		const closeMatch = closeRe.exec(text);
		if (openMatch && closeMatch) {
			// Insert just before </Parameters>.
			const insertAt = document.positionAt(closeMatch.index);
			edit.insert(
				document.uri,
				insertAt,
				paramLine.trimStart() +
					`
  `,
			);
		} else {
			// No <Parameters> block: create one right after the <ApplicationManifest ...> opening tag.
			const rootMatch = /<ApplicationManifest[^>]*>/.exec(text);
			if (rootMatch) {
				const insertAt = document.positionAt(rootMatch.index + rootMatch[0].length);
				edit.insert(
					document.uri,
					insertAt,
					`
  <Parameters>
    <Parameter Name="${name}" DefaultValue="" />
  </Parameters>`,
				);
			}
		}
		action.edit = edit;
		return action;
	}

	/** SFD004: rewrite `ServiceManifestVersion` to the on-disk ServiceManifest version. */
	private syncVersionFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | undefined {
		const project = this.watcher.getProjects().find((p) => p.applicationManifest?.path === document.uri.fsPath);
		if (!project) return undefined;
		const text = document.getText();
		const nameAttrs = findAttributeOccurrences(text, 'ServiceManifestRef', 'ServiceManifestName');
		const offset = document.offsetAt(diagnostic.range.start);
		const nameAttr = nameAttrs.find((a) => offset >= a.elementRange.start && offset <= a.elementRange.end);
		if (!nameAttr) return undefined;
		const sm = project.serviceManifests.find((s) => s.name === nameAttr.value);
		if (!sm || !sm.version) return undefined;
		const action = new vscode.CodeAction(`Sync ServiceManifestVersion to '${sm.version}'`, vscode.CodeActionKind.QuickFix);
		action.diagnostics = [diagnostic];
		action.isPreferred = true;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, diagnostic.range, sm.version);
		action.edit = edit;
		return action;
	}
}
