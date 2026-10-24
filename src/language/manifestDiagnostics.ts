// @ts-nocheck
import * as vscode from 'vscode';
import { findAttributeOccurrences, findParameterRefs } from '../util/xmlText';

var DIAGNOSTIC_SOURCE = 'service-fabric',
	ManifestDiagnostics = class {
		constructor(t) {
			this.watcher = t;
			((this.collection = vscode.languages.createDiagnosticCollection('serviceFabric')),
				this.disposables.push(this.collection),
				this.disposables.push(t.onDidChange(() => this.refreshAll())),
				this.disposables.push(vscode.workspace.onDidSaveTextDocument((r) => this.refreshDocument(r))),
				this.disposables.push(vscode.workspace.onDidChangeTextDocument((r) => this.refreshDocument(r.document))));
		}
		collection;
		disposables = [];
		enabled = !0;
		setEnabled(t) {
			((this.enabled = t), t ? this.refreshAll() : this.collection.clear());
		}
		refreshAll() {
			if (this.enabled) {
				this.collection.clear();
				for (let t of this.watcher.getProjects()) this.diagnoseProject(t).catch(() => {});
			}
		}
		refreshDocument(t) {
			if (!this.enabled) return;
			let r = t.uri.fsPath.toLowerCase();
			if (!(!r.endsWith('applicationmanifest.xml') && !r.endsWith('servicemanifest.xml'))) {
				for (let n of this.watcher.getProjects())
					if (n.applicationManifest?.path === t.uri.fsPath || n.serviceManifests.some((o) => o.path === t.uri.fsPath)) {
						this.diagnoseProject(n).catch(() => {});
						return;
					}
			}
		}
		async diagnoseProject(t) {
			let r = t.applicationManifest;
			if (!r) return;
			let n = await vscode.workspace.openTextDocument(vscode.Uri.file(r.path)),
				i = n.getText(),
				o = [],
				s = new Set(r.parameters.map((p) => p.name)),
				a = findParameterRefs(i);
			for (let p of a)
				s.has(p.name) ||
					o.push(
						this.diag(
							n,
							p.range,
							vscode.DiagnosticSeverity.Error,
							'SFD001',
							`Parameter '${p.name}' is referenced but not declared in <Parameters>.`,
						),
					);
			let c = findAttributeOccurrences(i, 'ServiceManifestRef', 'ServiceManifestName'),
				l = findAttributeOccurrences(i, 'ServiceManifestRef', 'ServiceManifestVersion');
			for (let p of c) {
				let d = t.serviceManifests.find((f) => f.name === p.value);
				if (!d)
					o.push(
						this.diag(
							n,
							p.valueRange,
							vscode.DiagnosticSeverity.Warning,
							'SFD003',
							`No ServiceManifest.xml found for service '${p.value}' under '${t.sfproj.applicationPackageRootFolder}/'.`,
						),
					);
				else {
					let f = l.find((m) => m.elementRange.start === p.elementRange.start);
					f &&
						d.version &&
						f.value !== d.version &&
						o.push(
							this.diag(
								n,
								f.valueRange,
								vscode.DiagnosticSeverity.Warning,
								'SFD004',
								`Version '${f.value}' in ApplicationManifest does not match on-disk ServiceManifest version '${d.version}'.`,
							),
						);
				}
			}
			let u = new Set(a.map((p) => p.name));
			for (let p of t.serviceManifests) {
				let d = await vscode.workspace.openTextDocument(vscode.Uri.file(p.path)),
					f = d.getText(),
					m = [];
				for (let v of findParameterRefs(f)) u.add(v.name);
				this.collection.set(d.uri, m);
			}
			for (let p of r.parameters)
				if (!u.has(p.name)) {
					let f = findAttributeOccurrences(i, 'Parameter', 'Name').find((m) => m.value === p.name);
					f &&
						o.push(
							this.diag(
								n,
								f.valueRange,
								vscode.DiagnosticSeverity.Information,
								'SFD002',
								`Parameter '${p.name}' is declared but never referenced.`,
							),
						);
				}
			this.collection.set(n.uri, o);
		}
		diag(t, r, n, i, o) {
			let s = new vscode.Range(t.positionAt(r.start), t.positionAt(r.end)),
				a = new vscode.Diagnostic(s, o, n);
			return ((a.code = i), (a.source = DIAGNOSTIC_SOURCE), a);
		}
		dispose() {
			for (let t of this.disposables) t.dispose();
		}
	};

export { ManifestDiagnostics };
