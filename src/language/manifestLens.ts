import * as vscode from 'vscode';
import * as path from 'path';
import type { ConnectionStore } from '../cluster/connectionStore';
import { createClientForConnection } from '../cluster/clusterAuth';
import type { SfProjectWatcher } from '../project/projectWatcher';
import type { ApplicationProject } from '../project/sfprojModel';
import type { ClusterDocumentProvider } from '../views/clusterDocuments';
import { samePath } from '../util/paths';
import { findAttributeOccurrences, findParameterRefs } from '../util/xmlText';
import { applicationParameterDeclarations } from '../util/xmlOutline';

/** workspaceState key prefix: the parameter file whose values the hints show, per .sfproj. */
const HINT_FILE_KEY = 'serviceFabric.hintParameterFile:';
const MAX_HINT_LENGTH = 40;

/**
 * Editor integrations for ApplicationManifest.xml and ServiceManifest.xml:
 *
 * - CodeLens on the root element: **Publish…**, **Compare with Deployed** (diff against the
 *   manifest provisioned on the active cluster) and the parameter file the hints use.
 * - Inlay hints after each `[Parameter]` reference and declaration with its value from the
 *   chosen parameter file, or the manifest default.
 */
export class ManifestLens implements vscode.CodeLensProvider, vscode.InlayHintsProvider, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.changed.event;
	readonly onDidChangeInlayHints = this.changed.event;
	private readonly disposables: vscode.Disposable[] = [this.changed];

	constructor(
		private readonly watcher: SfProjectWatcher,
		private readonly store: ConnectionStore,
		private readonly documents: ClusterDocumentProvider,
		private readonly state: vscode.Memento,
	) {
		this.disposables.push(
			watcher.onDidChange(() => this.changed.fire()),
			// "Compare with <cluster>" follows the active cluster.
			store.onDidChange(() => this.changed.fire()),
			// Parameter file edits change the hint values.
			vscode.workspace.onDidSaveTextDocument((doc) => {
				if (/[\\/]ApplicationParameters[\\/][^\\/]+\.xml$/i.test(doc.uri.fsPath)) this.changed.fire();
			}),
		);
	}

	/** Commands this class implements, for registration in extension.ts. */
	commands(): [string, (...args: never[]) => unknown][] {
		return [
			['serviceFabric.compareWithDeployed', (uri?: vscode.Uri) => this.compareWithDeployed(uri)],
			['serviceFabric.selectHintParameterFile', (sfproj?: string) => this.selectHintParameterFile(sfproj)],
		];
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const target = this.lookup(document.uri);
		if (!target) return [];
		const text = document.getText();
		const rootElement = target.kind === 'application' ? 'ApplicationManifest' : 'ServiceManifest';
		const root = findAttributeOccurrences(text, rootElement, 'xmlns')[0] ?? findAttributeOccurrences(text, rootElement, 'Name')[0];
		const at = new vscode.Range(document.positionAt(root?.elementRange.start ?? 0), document.positionAt(root?.elementRange.start ?? 0));
		const lenses: vscode.CodeLens[] = [];
		if (target.kind === 'application') {
			lenses.push(
				new vscode.CodeLens(at, {
					title: '$(rocket) Publish…',
					command: 'serviceFabric.publish',
					arguments: [vscode.Uri.file(target.project.sfproj.path)],
				}),
			);
		}
		const active = this.store.getActive();
		if (active?.connected) {
			lenses.push(
				new vscode.CodeLens(at, {
					title: `$(diff) Compare with ${active.label}`,
					tooltip: `Diff against the manifest provisioned on ${active.label}`,
					command: 'serviceFabric.compareWithDeployed',
					arguments: [document.uri],
				}),
			);
			if (target.kind === 'application') {
				lenses.push(
					new vscode.CodeLens(at, {
						title: '$(history) History',
						tooltip: `Deployment history on ${active.label} (EventStore)`,
						command: 'serviceFabric.showDeploymentHistory',
						arguments: [document.uri],
					}),
				);
			}
		}
		if (target.kind === 'application' && target.project.applicationParameters.length) {
			const file = this.hintFile(target.project);
			lenses.push(
				new vscode.CodeLens(at, {
					title: `$(symbol-variable) Values: ${file ? path.basename(file) : 'defaults'}`,
					tooltip: 'Choose which parameter file the inline parameter values come from',
					command: 'serviceFabric.selectHintParameterFile',
					arguments: [target.project.sfproj.path],
				}),
			);
		}
		return lenses;
	}

	async provideInlayHints(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.InlayHint[]> {
		const target = this.lookup(document.uri);
		if (target?.kind !== 'application') return [];
		const text = document.getText();
		const defaults = new Map(target.project.applicationManifest?.parameters.map((p) => [p.name, p.defaultValue ?? '']) ?? []);
		const file = this.hintFile(target.project);
		const overrides = file ? await readParameterFile(file) : new Map<string, string>();
		const source = file ? path.basename(file) : undefined;
		const hint = (offset: number, name: string): vscode.InlayHint | undefined => {
			const position = document.positionAt(offset);
			if (!range.contains(position)) return undefined;
			const fromFile = overrides.has(name);
			const value = fromFile ? overrides.get(name)! : defaults.get(name);
			if (value === undefined) return undefined;
			const shown = value.length > MAX_HINT_LENGTH ? `${value.slice(0, MAX_HINT_LENGTH)}…` : value;
			const h = new vscode.InlayHint(position, `= ${shown || '""'}`, vscode.InlayHintKind.Parameter);
			h.paddingLeft = true;
			h.tooltip = fromFile ? `${name} from ${source}` : `${name}: manifest default${source ? ` (not set in ${source})` : ''}`;
			return h;
		};
		const hints: vscode.InlayHint[] = [];
		for (const ref of findParameterRefs(text)) {
			const h = hint(ref.range.end, ref.name);
			if (h) hints.push(h);
		}
		// Declarations show the chosen file's value only when it overrides the default.
		if (file) {
			for (const decl of applicationParameterDeclarations(text)) {
				if (!overrides.has(decl.value)) continue;
				const h = hint(decl.elementRange.end, decl.value);
				if (h) hints.push(h);
			}
		}
		return hints;
	}

	private lookup(uri: vscode.Uri): { kind: 'application' | 'service'; project: ApplicationProject; serviceManifest?: string } | undefined {
		const file = uri.fsPath;
		for (const project of this.watcher.getProjects()) {
			if (project.applicationManifest && samePath(project.applicationManifest.path, file)) return { kind: 'application', project };
			const sm = project.serviceManifests.find((s) => samePath(s.path, file));
			if (sm) return { kind: 'service', project, serviceManifest: sm.name };
		}
		return undefined;
	}

	private hintFile(project: ApplicationProject): string | undefined {
		const saved = this.state.get<string>(HINT_FILE_KEY + project.sfproj.path);
		return saved && project.applicationParameters.includes(saved) ? saved : undefined;
	}

	/** `serviceFabric.selectHintParameterFile`: picks the parameter file whose values the inlay hints show. */
	private async selectHintParameterFile(sfproj?: string): Promise<void> {
		const project = sfproj ? this.watcher.getProjectByPath(sfproj) : this.watcher.getProjects()[0];
		if (!project) return;
		const current = this.hintFile(project);
		const picked = await vscode.window.showQuickPick(
			[
				{ label: 'Manifest defaults', description: 'DefaultValue in ApplicationManifest.xml', file: undefined as string | undefined },
				...project.applicationParameters.map((f) => ({
					label: path.basename(f),
					description: vscode.workspace.asRelativePath(f),
					file: f as string | undefined,
				})),
			].map((item) => ({ ...item, picked: item.file === current })),
			{ placeHolder: 'Show parameter values from' },
		);
		if (!picked) return;
		await this.state.update(HINT_FILE_KEY + project.sfproj.path, picked.file);
		this.changed.fire();
	}

	/** `serviceFabric.compareWithDeployed`: diffs a manifest against the version provisioned on the active cluster. */
	private async compareWithDeployed(uri?: vscode.Uri): Promise<void> {
		const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
		const target = fileUri && this.lookup(fileUri);
		const typeName = target?.project.applicationManifest?.applicationTypeName;
		if (!fileUri || !target || !typeName) {
			vscode.window.showInformationMessage('Open an ApplicationManifest.xml or ServiceManifest.xml of a Service Fabric project to compare it.');
			return;
		}
		const active = this.store.getActive();
		if (!active?.connected) {
			vscode.window.showWarningMessage('No connected cluster. Select or reconnect a cluster in the Clusters view first.');
			return;
		}
		const client = createClientForConnection(active, { interactive: true });
		try {
			const [apps, types] = await Promise.all([client.getApplications(), client.getApplicationTypes()]);
			const deployed = new Set(apps.filter((a) => a.typeName === typeName).map((a) => a.typeVersion));
			const versions = types.filter((t) => t.name === typeName).map((t) => t.version);
			if (versions.length === 0) {
				vscode.window.showInformationMessage(`${typeName} isn't provisioned on ${active.label}.`);
				return;
			}
			const version =
				versions.length === 1
					? versions[0]
					: (
							await vscode.window.showQuickPick(
								versions.map((v) => ({ label: v, description: deployed.has(v) ? 'in use' : 'provisioned' })),
								{ placeHolder: `Compare with which ${typeName} version on ${active.label}?` },
							)
						)?.label;
			if (!version) return;
			const manifest =
				target.kind === 'application'
					? await client.getApplicationManifest(typeName, version)
					: await client.getServiceManifest(typeName, version, target.serviceManifest ?? '');
			const name = path.basename(fileUri.fsPath);
			await this.documents.showDiff(`${name} (${active.label} ${typeName} ${version}) ↔ workspace`, manifest, fileUri);
		} catch (err) {
			vscode.window.showErrorMessage(`Couldn't read the deployed manifest from ${active.label}: ${(err as Error).message}`);
		}
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
	}
}

/** `Name` → `Value` of every `<Parameter>` in an application parameter file. */
async function readParameterFile(file: string): Promise<Map<string, string>> {
	let text: string;
	try {
		text = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(file))).toString('utf8');
	} catch {
		return new Map();
	}
	const values = findAttributeOccurrences(text, 'Parameter', 'Value');
	const result = new Map<string, string>();
	for (const name of findAttributeOccurrences(text, 'Parameter', 'Name')) {
		const value = values.find((v) => v.elementRange.start === name.elementRange.start);
		if (value) result.set(name.value, value.value);
	}
	return result;
}
