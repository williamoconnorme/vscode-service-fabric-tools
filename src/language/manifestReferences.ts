import * as vscode from 'vscode';
import * as path from 'path';
import type { SfProjectWatcher } from '../project/projectWatcher';
import type { ApplicationProject } from '../project/sfprojModel';
import { samePath } from '../util/paths';
import { findAttributeOccurrences, findParameterRefs, type TextRange } from '../util/xmlText';
import { applicationParameterDeclarations } from '../util/xmlOutline';

/** What a position in a manifest refers to. */
type ManifestSymbol = { kind: 'parameter' | 'serviceType' | 'package'; name: string };

interface Occurrence {
	uri: vscode.Uri;
	range: vscode.Range;
	/** Whether this is where the symbol is declared (for Go to Definition). */
	declaration: boolean;
}

const NAME_PATTERN = /^[A-Za-z_][\w\-.]*$/;
const SERVICE_TYPE_DECLARATIONS = ['StatefulServiceType', 'StatelessServiceType'];
const SERVICE_TYPE_USES = ['StatefulService', 'StatelessService'];

/**
 * Find All References, Rename and Go to Definition across a project's manifests for:
 *
 * - application parameters: the `<Parameters>` declaration in ApplicationManifest.xml, every
 *   `[Name]` reference, and `<Parameter Name>` in ApplicationParameters/*.xml;
 * - service types: `ServiceTypeName` in ServiceManifest.xml, ApplicationManifest.xml and
 *   StartupServices.xml, plus the matching string literal in the service projects' C# code
 *   (`ServiceRuntime.RegisterServiceAsync("…")`);
 * - service package names: `<ServiceManifest Name>` and `ServiceManifestRef ServiceManifestName`.
 *   The package folder isn't renamed.
 */
export class ManifestReferenceProvider implements vscode.ReferenceProvider, vscode.RenameProvider, vscode.DefinitionProvider {
	constructor(private readonly watcher: SfProjectWatcher) {}

	async provideReferences(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
		const hit = this.symbolAt(document, position);
		if (!hit) return [];
		return (await this.occurrences(hit.project, hit.symbol)).map((o) => new vscode.Location(o.uri, o.range));
	}

	async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[] | undefined> {
		const hit = this.symbolAt(document, position);
		// Package names already go to ServiceManifest.xml through ManifestDefinitionProvider.
		if (!hit || hit.symbol.kind === 'package') return undefined;
		const declarations = (await this.occurrences(hit.project, hit.symbol)).filter((o) => o.declaration);
		return declarations.map((o) => new vscode.Location(o.uri, o.range));
	}

	prepareRename(document: vscode.TextDocument, position: vscode.Position): { range: vscode.Range; placeholder: string } {
		const hit = this.symbolAt(document, position);
		if (!hit) throw new Error('Rename works on application parameters, service type names and service package names.');
		return { range: hit.range, placeholder: hit.symbol.name };
	}

	async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string): Promise<vscode.WorkspaceEdit | undefined> {
		const hit = this.symbolAt(document, position);
		if (!hit) return undefined;
		if (!NAME_PATTERN.test(newName)) throw new Error(`'${newName}' isn't a valid name: use letters, digits, '_', '-' and '.', starting with a letter or '_'.`);
		const edit = new vscode.WorkspaceEdit();
		for (const o of await this.occurrences(hit.project, hit.symbol)) edit.replace(o.uri, o.range, newName);
		return edit;
	}

	/** The symbol under `position`, the project it belongs to, and the range of its name. */
	private symbolAt(
		document: vscode.TextDocument,
		position: vscode.Position,
	): { project: ApplicationProject; symbol: ManifestSymbol; range: vscode.Range } | undefined {
		const file = document.uri.fsPath;
		const project = this.watcher.getProjects().find((p) => projectFiles(p).some((f) => samePath(f, file)));
		if (!project) return undefined;
		const text = document.getText();
		const offset = document.offsetAt(position);
		const inside = (r: TextRange): boolean => offset >= r.start && offset <= r.end;
		const toRange = (r: TextRange): vscode.Range => new vscode.Range(document.positionAt(r.start), document.positionAt(r.end));
		const isAppManifest = project.applicationManifest && samePath(project.applicationManifest.path, file);
		const isParameterFile = project.applicationParameters.some((f) => samePath(f, file));
		const isServiceManifest = project.serviceManifests.some((sm) => samePath(sm.path, file));

		for (const ref of findParameterRefs(text)) {
			const name = { start: ref.range.start + 1, end: ref.range.end - 1 };
			if (inside(name)) return { project, symbol: { kind: 'parameter', name: ref.name }, range: toRange(name) };
		}
		const parameterNames = isAppManifest
			? applicationParameterDeclarations(text)
			: isParameterFile
				? findAttributeOccurrences(text, 'Parameter', 'Name')
				: [];
		for (const decl of parameterNames) {
			if (inside(decl.valueRange)) return { project, symbol: { kind: 'parameter', name: decl.value }, range: toRange(decl.valueRange) };
		}
		const typeElements = isServiceManifest ? SERVICE_TYPE_DECLARATIONS : SERVICE_TYPE_USES;
		for (const element of typeElements) {
			for (const attr of findAttributeOccurrences(text, element, 'ServiceTypeName')) {
				if (inside(attr.valueRange)) return { project, symbol: { kind: 'serviceType', name: attr.value }, range: toRange(attr.valueRange) };
			}
		}
		const packageNames = isServiceManifest
			? findAttributeOccurrences(text, 'ServiceManifest', 'Name')
			: isAppManifest
				? findAttributeOccurrences(text, 'ServiceManifestRef', 'ServiceManifestName')
				: [];
		for (const attr of packageNames) {
			if (inside(attr.valueRange)) return { project, symbol: { kind: 'package', name: attr.value }, range: toRange(attr.valueRange) };
		}
		return undefined;
	}

	private async occurrences(project: ApplicationProject, symbol: ManifestSymbol): Promise<Occurrence[]> {
		const out: Occurrence[] = [];
		const add = async (file: string, find: (text: string) => { range: TextRange; declaration: boolean }[]): Promise<void> => {
			let document: vscode.TextDocument;
			try {
				document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			} catch {
				return;
			}
			for (const hit of find(document.getText())) {
				out.push({
					uri: document.uri,
					range: new vscode.Range(document.positionAt(hit.range.start), document.positionAt(hit.range.end)),
					declaration: hit.declaration,
				});
			}
		};
		const appManifest = project.applicationManifest?.path;
		const name = symbol.name;
		switch (symbol.kind) {
			case 'parameter': {
				const refs = (text: string) =>
					findParameterRefs(text)
						.filter((r) => r.name === name)
						.map((r) => ({ range: { start: r.range.start + 1, end: r.range.end - 1 }, declaration: false }));
				if (appManifest) {
					await add(appManifest, (text) => [
						...applicationParameterDeclarations(text)
							.filter((d) => d.value === name)
							.map((d) => ({ range: d.valueRange, declaration: true })),
						...refs(text),
					]);
				}
				for (const file of project.applicationParameters) {
					await add(file, (text) =>
						findAttributeOccurrences(text, 'Parameter', 'Name')
							.filter((a) => a.value === name)
							.map((a) => ({ range: a.valueRange, declaration: false })),
					);
				}
				for (const sm of project.serviceManifests) await add(sm.path, refs);
				break;
			}
			case 'serviceType': {
				const attrs = (elements: string[], declaration: boolean) => (text: string) =>
					elements.flatMap((element) =>
						findAttributeOccurrences(text, element, 'ServiceTypeName')
							.filter((a) => a.value === name)
							.map((a) => ({ range: a.valueRange, declaration })),
					);
				for (const sm of project.serviceManifests) await add(sm.path, attrs(SERVICE_TYPE_DECLARATIONS, true));
				if (appManifest) await add(appManifest, attrs(SERVICE_TYPE_USES, false));
				if (project.startupServicesManifest) await add(project.startupServicesManifest, attrs(SERVICE_TYPE_USES, false));
				for (const file of await this.csharpFilesMentioning(project, name)) await add(file, (text) => stringLiterals(text, name));
				break;
			}
			case 'package': {
				for (const sm of project.serviceManifests) {
					await add(sm.path, (text) =>
						findAttributeOccurrences(text, 'ServiceManifest', 'Name')
							.filter((a) => a.value === name)
							.map((a) => ({ range: a.valueRange, declaration: true })),
					);
				}
				if (appManifest) {
					await add(appManifest, (text) =>
						findAttributeOccurrences(text, 'ServiceManifestRef', 'ServiceManifestName')
							.filter((a) => a.value === name)
							.map((a) => ({ range: a.valueRange, declaration: false })),
					);
				}
				break;
			}
		}
		return out;
	}

	/** C# files in the project's referenced service projects that contain `"name"`. */
	private async csharpFilesMentioning(project: ApplicationProject, name: string): Promise<string[]> {
		const literal = Buffer.from(`"${name}"`);
		const files: string[] = [];
		for (const ref of project.sfproj.projectReferences) {
			const dir = path.dirname(ref);
			const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '**/*.cs'), '**/{bin,obj}/**', 500);
			for (const uri of uris) {
				try {
					if (Buffer.from(await vscode.workspace.fs.readFile(uri)).includes(literal)) files.push(uri.fsPath);
				} catch {
					// Unreadable file: skip it.
				}
			}
		}
		return files;
	}
}

/** Every file a project's references can live in. */
function projectFiles(project: ApplicationProject): string[] {
	return [
		...(project.applicationManifest ? [project.applicationManifest.path] : []),
		...project.applicationParameters,
		...project.serviceManifests.map((sm) => sm.path),
		...(project.startupServicesManifest ? [project.startupServicesManifest] : []),
	];
}

/** Ranges of the text inside each `"name"` string literal. */
function stringLiterals(text: string, name: string): { range: TextRange; declaration: boolean }[] {
	const out: { range: TextRange; declaration: boolean }[] = [];
	const needle = `"${name}"`;
	for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
		out.push({ range: { start: i + 1, end: i + 1 + name.length }, declaration: false });
	}
	return out;
}
