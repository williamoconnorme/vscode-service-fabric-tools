import * as vscode from 'vscode';
import type { SfProjectWatcher } from '../project/projectWatcher';
import type { ApplicationProject } from '../project/sfprojModel';
import { findAttributeOccurrences, findParameterRefs, type TextRange } from '../util/xmlText';

const DIAGNOSTIC_SOURCE = 'service-fabric';

/**
 * Manifest lint rules, published to the `serviceFabric` diagnostic collection:
 *
 * - SFD001 (error)   `[Param]` referenced in ApplicationManifest but not declared in `<Parameters>`.
 * - SFD002 (info)    `<Parameter>` declared but never referenced in any manifest.
 * - SFD003 (warning) `<ServiceManifestRef>` names a service with no ServiceManifest.xml on disk.
 * - SFD004 (warning) `ServiceManifestVersion` differs from the on-disk ServiceManifest `Version`.
 */
export class ManifestDiagnostics implements vscode.Disposable {
	private readonly collection: vscode.DiagnosticCollection;
	private readonly disposables: vscode.Disposable[] = [];
	private enabled = true;

	constructor(private readonly watcher: SfProjectWatcher) {
		this.collection = vscode.languages.createDiagnosticCollection('serviceFabric');
		this.disposables.push(this.collection);
		this.disposables.push(watcher.onDidChange(() => this.refreshAll()));
		this.disposables.push(vscode.workspace.onDidSaveTextDocument((doc) => this.refreshDocument(doc)));
		this.disposables.push(vscode.workspace.onDidChangeTextDocument((e) => this.refreshDocument(e.document)));
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (enabled) this.refreshAll();
		else this.collection.clear();
	}

	refreshAll(): void {
		if (!this.enabled) return;
		this.collection.clear();
		for (const project of this.watcher.getProjects()) this.diagnoseProject(project).catch(() => {});
	}

	private refreshDocument(document: vscode.TextDocument): void {
		if (!this.enabled) return;
		const lower = document.uri.fsPath.toLowerCase();
		if (!lower.endsWith('applicationmanifest.xml') && !lower.endsWith('servicemanifest.xml')) return;
		for (const project of this.watcher.getProjects()) {
			if (
				project.applicationManifest?.path === document.uri.fsPath ||
				project.serviceManifests.some((sm) => sm.path === document.uri.fsPath)
			) {
				this.diagnoseProject(project).catch(() => {});
				return;
			}
		}
	}

	private async diagnoseProject(project: ApplicationProject): Promise<void> {
		const manifest = project.applicationManifest;
		if (!manifest) return;
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(manifest.path));
		const text = doc.getText();
		const diagnostics: vscode.Diagnostic[] = [];
		const declared = new Set(manifest.parameters.map((p) => p.name));
		const refs = findParameterRefs(text);

		// SFD001: referenced but not declared.
		for (const ref of refs) {
			if (!declared.has(ref.name)) {
				diagnostics.push(
					this.diag(
						doc,
						ref.range,
						vscode.DiagnosticSeverity.Error,
						'SFD001',
						`Parameter '${ref.name}' is referenced but not declared in <Parameters>.`,
					),
				);
			}
		}

		// SFD003 / SFD004: ServiceManifestRef checks.
		const nameAttrs = findAttributeOccurrences(text, 'ServiceManifestRef', 'ServiceManifestName');
		const versionAttrs = findAttributeOccurrences(text, 'ServiceManifestRef', 'ServiceManifestVersion');
		for (const nameAttr of nameAttrs) {
			const sm = project.serviceManifests.find((s) => s.name === nameAttr.value);
			if (!sm) {
				diagnostics.push(
					this.diag(
						doc,
						nameAttr.valueRange,
						vscode.DiagnosticSeverity.Warning,
						'SFD003',
						`No ServiceManifest.xml found for service '${nameAttr.value}' under '${project.sfproj.applicationPackageRootFolder}/'.`,
					),
				);
			} else {
				const versionAttr = versionAttrs.find((v) => v.elementRange.start === nameAttr.elementRange.start);
				if (versionAttr && sm.version && versionAttr.value !== sm.version) {
					diagnostics.push(
						this.diag(
							doc,
							versionAttr.valueRange,
							vscode.DiagnosticSeverity.Warning,
							'SFD004',
							`Version '${versionAttr.value}' in ApplicationManifest does not match on-disk ServiceManifest version '${sm.version}'.`,
						),
					);
				}
			}
		}

		// SFD002: declared but never referenced (in the app manifest or any service manifest).
		const referenced = new Set(refs.map((r) => r.name));
		for (const sm of project.serviceManifests) {
			const smDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(sm.path));
			const smText = smDoc.getText();
			const smDiagnostics: vscode.Diagnostic[] = [];
			for (const ref of findParameterRefs(smText)) referenced.add(ref.name);
			this.collection.set(smDoc.uri, smDiagnostics);
		}
		for (const param of manifest.parameters) {
			if (!referenced.has(param.name)) {
				const decl = findAttributeOccurrences(text, 'Parameter', 'Name').find((a) => a.value === param.name);
				if (decl) {
					diagnostics.push(
						this.diag(
							doc,
							decl.valueRange,
							vscode.DiagnosticSeverity.Information,
							'SFD002',
							`Parameter '${param.name}' is declared but never referenced.`,
						),
					);
				}
			}
		}
		this.collection.set(doc.uri, diagnostics);
	}

	private diag(
		doc: vscode.TextDocument,
		range: TextRange,
		severity: vscode.DiagnosticSeverity,
		code: string,
		message: string,
	): vscode.Diagnostic {
		const vsRange = new vscode.Range(doc.positionAt(range.start), doc.positionAt(range.end));
		const d = new vscode.Diagnostic(vsRange, message, severity);
		d.code = code;
		d.source = DIAGNOSTIC_SOURCE;
		return d;
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
	}
}
