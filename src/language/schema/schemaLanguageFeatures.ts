import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import type { Logger } from '../../util/logger';
import { findServiceFabricSchema } from '../schemaProbe';
import bundledSchema from './serviceFabricSchema.json';
import { FABRIC_NAMESPACE, isSchemaDocument, resolveElement, type SchemaAttribute, type SchemaChild, type SchemaModel } from './schemaModel';
import { validateDocument } from './schemaValidator';
import { compileXsd } from './xsdCompiler';
import { completionContextAt, hoverTargetAt } from './xmlContext';

const DIAGNOSTIC_SOURCE = 'service-fabric';
const VALIDATE_DELAY_MS = 300;

/** Files that get a root-element suggestion while still empty. */
const ROOT_FOR_FILE: Record<string, string> = {
	'applicationmanifest.xml': 'ApplicationManifest',
	'servicemanifest.xml': 'ServiceManifest',
};

export const SCHEMA_SELECTOR: vscode.DocumentFilter[] = [
	{ language: 'xml', scheme: 'file' },
	{ language: 'xml', scheme: 'untitled' },
];

/**
 * Loads the schema model: the XSD from `serviceFabric.xmlSchemaPath` or the
 * installed SDK when there is one (so a newer SDK's additions show up), else
 * the model bundled with the extension.
 */
export function loadSchemaModel(logger: Logger): { model: SchemaModel; xsdPath?: string } {
	const override = vscode.workspace.getConfiguration('serviceFabric').get<string>('xmlSchemaPath') ?? '';
	const xsdPath = findServiceFabricSchema({ override });
	if (xsdPath) {
		try {
			const model = compileXsd(nodeFs.readFileSync(xsdPath, 'utf8'));
			logger.info(`Manifest IntelliSense uses the Service Fabric XSD at ${xsdPath}.`);
			return { model, xsdPath };
		} catch (err) {
			logger.warn(`Couldn't read ${xsdPath} (${(err as Error).message}); using the bundled Service Fabric schema.`);
		}
	} else if (override.trim()) {
		logger.warn(`serviceFabric.xmlSchemaPath "${override}" has no ServiceFabricServiceModel.xsd; using the bundled Service Fabric schema.`);
	}
	return { model: bundledSchema as unknown as SchemaModel };
}

/** Service Fabric XML files the language status item shows on. */
const STATUS_SELECTOR: vscode.DocumentFilter[] = [
	{ language: 'xml', pattern: '**/{ApplicationManifest,ServiceManifest,StartupServices,ClusterManifest*}.xml' },
	{ language: 'xml', pattern: '**/{ApplicationParameters,PublishProfiles,StartupServiceParameters}/*.xml' },
];

/** Escapes text for a snippet body (`\$}`) and, inside a `${1|a,b|}` choice, `,|` as well. */
function snippetEscape(s: string, inChoice = false): string {
	return s.replace(inChoice ? /[\\$}|,]/g : /[\\$}]/g, '\\$&');
}

function attributeSnippet(a: SchemaAttribute, tabstop: number): string {
	if (a.values && a.values.length > 0) return `${a.name}="\${${tabstop}|${a.values.map((v) => snippetEscape(v, true)).join(',')}|}"`;
	return a.default !== undefined ? `${a.name}="\${${tabstop}:${snippetEscape(a.default)}}"` : `${a.name}="$${tabstop}"`;
}

function attributeMarkdown(a: SchemaAttribute): vscode.MarkdownString {
	const md = new vscode.MarkdownString();
	md.appendMarkdown(`**${a.name}** attribute${a.required ? ' (required)' : ''}`);
	if (a.type) md.appendMarkdown(` · \`${a.type}\``);
	if (a.doc) md.appendMarkdown(`\n\n${a.doc}`);
	if (a.values) md.appendMarkdown(`\n\nAllowed values: ${a.values.map((v) => `\`${v}\``).join(', ')}`);
	if (a.default !== undefined) md.appendMarkdown(`\n\nDefault: \`${a.default}\``);
	return md;
}

/**
 * Schema-driven IntelliSense for Service Fabric XML (application and service
 * manifests, application parameter files, cluster manifests): element,
 * attribute and value completion, hover documentation and validation. Applies
 * to any XML document whose root element is in the Service Fabric namespace.
 */
export class SchemaLanguageFeatures implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.Disposable {
	private model: SchemaModel;
	/** XSD the model came from; `undefined` for the bundled model. */
	private xsdPath: string | undefined;
	private enabled = true;
	/** Language status item for Service Fabric XML files: which schema is in use, and whether validation runs. */
	private readonly status = vscode.languages.createLanguageStatusItem('serviceFabric.schema', STATUS_SELECTOR);
	private readonly collection = vscode.languages.createDiagnosticCollection('serviceFabric.schema');
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly disposables: vscode.Disposable[] = [this.collection, this.status];

	constructor(private readonly logger: Logger) {
		({ model: this.model, xsdPath: this.xsdPath } = loadSchemaModel(logger));
		this.status.name = 'Service Fabric schema';
		this.updateStatus();
		this.disposables.push(
			vscode.languages.registerCompletionItemProvider(SCHEMA_SELECTOR, this, '<', ' ', '"', '/'),
			vscode.languages.registerHoverProvider(SCHEMA_SELECTOR, this),
			vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d, 0)),
			vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document, VALIDATE_DELAY_MS)),
			vscode.workspace.onDidCloseTextDocument((d) => {
				this.cancel(d.uri);
				this.collection.delete(d.uri);
			}),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('serviceFabric.xmlSchemaPath')) {
					({ model: this.model, xsdPath: this.xsdPath } = loadSchemaModel(this.logger));
					this.updateStatus();
					this.validateAll();
				}
			}),
		);
		this.validateAll();
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		this.updateStatus();
		if (enabled) this.validateAll();
		else this.collection.clear();
	}

	/** Shows which schema IntelliSense uses and whether validation runs; the link opens the settings. */
	private updateStatus(): void {
		this.status.text = this.xsdPath ? '$(file-code) SF schema: SDK' : '$(file-code) SF schema: bundled';
		this.status.detail = [this.xsdPath ?? 'bundled with the extension', this.enabled ? 'validation on' : 'validation off'].join(' · ');
		this.status.severity = this.enabled ? vscode.LanguageStatusSeverity.Information : vscode.LanguageStatusSeverity.Warning;
		this.status.command = {
			title: 'Configure',
			command: 'workbench.action.openSettings',
			arguments: ['serviceFabric.xmlSchemaPath serviceFabric.diagnostics.enableSchemaValidation'],
		};
	}

	// ---- diagnostics ----------------------------------------------------------

	private validateAll(): void {
		for (const doc of vscode.workspace.textDocuments) this.schedule(doc, 0);
	}

	private cancel(uri: vscode.Uri): void {
		const key = uri.toString();
		const t = this.timers.get(key);
		if (t) clearTimeout(t);
		this.timers.delete(key);
	}

	private schedule(doc: vscode.TextDocument, delay: number): void {
		if (doc.languageId !== 'xml') return;
		this.cancel(doc.uri);
		this.timers.set(
			doc.uri.toString(),
			setTimeout(() => {
				this.timers.delete(doc.uri.toString());
				this.validate(doc);
			}, delay),
		);
	}

	private validate(doc: vscode.TextDocument): void {
		if (doc.isClosed) return;
		const text = doc.getText();
		if (!this.enabled || !isSchemaDocument(this.model, text)) {
			this.collection.delete(doc.uri);
			return;
		}
		const diagnostics = validateDocument(text, this.model).map((issue) => {
			const d = new vscode.Diagnostic(
				new vscode.Range(doc.positionAt(issue.range.start), doc.positionAt(issue.range.end)),
				issue.message,
				issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
			);
			d.code = issue.code;
			d.source = DIAGNOSTIC_SOURCE;
			return d;
		});
		this.collection.set(doc.uri, diagnostics);
	}

	// ---- completion -----------------------------------------------------------

	provideCompletionItems(
		doc: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
		context: vscode.CompletionContext,
	): vscode.CompletionItem[] | undefined {
		const text = doc.getText();
		const offset = doc.offsetAt(position);
		if (!isSchemaDocument(this.model, text)) return this.rootCompletions(doc, text, offset);
		const trigger = context.triggerCharacter;
		const ctx = completionContextAt(text, offset);
		const rangeFrom = (start: number, extendOverName = false): vscode.Range => {
			let end = offset;
			if (extendOverName) while (end < text.length && /[\w.:-]/.test(text[end])) end++;
			return new vscode.Range(doc.positionAt(start), doc.positionAt(end));
		};
		switch (ctx.kind) {
			case 'elementName': {
				if (trigger && trigger !== '<') return undefined;
				const range = rangeFrom(ctx.start, true);
				const restOfLine = text.slice(doc.offsetAt(range.end)).split(/\r?\n/, 1)[0];
				const nameOnly = restOfLine.trim().length > 0 && !restOfLine.trimStart().startsWith('<');
				const items = this.elementItems(ctx.path, range, nameOnly ? 'name' : 'tag');
				if (ctx.path.length > 0 && !nameOnly) {
					const parent = ctx.path[ctx.path.length - 1];
					const close = new vscode.CompletionItem(`/${parent}`, vscode.CompletionItemKind.Keyword);
					close.insertText = `/${parent}>`;
					close.range = range;
					close.sortText = '~';
					items.push(close);
				}
				return items;
			}
			case 'content': {
				if (trigger) return undefined;
				return this.elementItems(ctx.path, rangeFrom(ctx.start), 'bracketed');
			}
			case 'endTag': {
				if (trigger && trigger !== '/') return undefined;
				const parent = ctx.path[ctx.path.length - 1];
				if (!parent) return undefined;
				const item = new vscode.CompletionItem(parent, vscode.CompletionItemKind.Keyword);
				item.insertText = text[offset] === '>' ? parent : `${parent}>`;
				item.range = rangeFrom(ctx.start, true);
				return [item];
			}
			case 'attributeName': {
				if (trigger && trigger !== ' ') return undefined;
				const resolved = resolveElement(this.model, ctx.path);
				if (!resolved) return undefined;
				const range = rangeFrom(ctx.start, true);
				const nextChar = text[doc.offsetAt(range.end)];
				const hasValue = nextChar === '=';
				const items: vscode.CompletionItem[] = [];
				resolved.type.attributes.forEach((a, i) => {
					if (ctx.existing.includes(a.name)) return;
					const item = new vscode.CompletionItem(a.name, vscode.CompletionItemKind.Property);
					item.insertText = hasValue ? a.name : new vscode.SnippetString(attributeSnippet(a, 1));
					item.range = range;
					item.detail = a.required ? 'required' : undefined;
					item.documentation = attributeMarkdown(a);
					item.sortText = `${a.required ? 0 : 1}${String(i).padStart(3, '0')}`;
					items.push(item);
				});
				return items;
			}
			case 'attributeValue': {
				if (trigger && trigger !== '"') return undefined;
				const decl = resolveElement(this.model, ctx.path)?.type.attributes.find((a) => a.name === ctx.attribute);
				if (!decl?.values) return undefined;
				const range = rangeFrom(ctx.start);
				return decl.values.map((v, i) => {
					const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember);
					item.insertText = ctx.quoted ? v : `"${v}"`;
					item.range = range;
					item.sortText = String(i).padStart(3, '0');
					if (v === decl.default) item.detail = 'default';
					return item;
				});
			}
			default:
				return undefined;
		}
	}

	/**
	 * Child elements of the element at `path`. `mode` decides what is inserted:
	 * the name only (renaming an existing tag), the whole tag after a typed `<`,
	 * or the tag including `<` (in content).
	 */
	private elementItems(path: string[], range: vscode.Range, mode: 'name' | 'tag' | 'bracketed'): vscode.CompletionItem[] {
		const children: SchemaChild[] = path.length === 0 ? [] : (resolveElement(this.model, path)?.type.children ?? []);
		return children.map((child, i) => {
			const childType = this.model.types[child.type];
			const item = new vscode.CompletionItem(child.name, vscode.CompletionItemKind.Class);
			item.range = range;
			item.detail = child.required ? 'required' : undefined;
			const doc = child.doc ?? childType?.doc;
			if (doc) item.documentation = new vscode.MarkdownString(doc);
			item.sortText = `${child.required ? 0 : 1}${String(i).padStart(3, '0')}`;
			if (mode === 'name') {
				item.insertText = child.name;
				return item;
			}
			let body = child.name;
			let tabstop = 1;
			for (const a of childType?.attributes ?? []) if (a.required) body += ` ${attributeSnippet(a, tabstop++)}`;
			const hasContent = !!childType && (childType.children.length > 0 || childType.text || childType.anyChildren);
			body += hasContent ? `>$0</${child.name}>` : ' />$0';
			item.insertText = new vscode.SnippetString(mode === 'bracketed' ? `<${body}` : body);
			if (mode === 'bracketed') item.filterText = `<${child.name}`;
			return item;
		});
	}

	/** In an empty ApplicationManifest.xml / ServiceManifest.xml, offers the root element with its namespace. */
	private rootCompletions(doc: vscode.TextDocument, text: string, offset: number): vscode.CompletionItem[] | undefined {
		if (doc.uri.scheme !== 'file') return undefined;
		const rootName = ROOT_FOR_FILE[nodePath.basename(doc.uri.fsPath).toLowerCase()];
		if (!rootName) return undefined;
		// Only while the document holds nothing but an XML declaration, comments and what is being typed.
		const strip = (s: string): string => s.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '');
		const before = strip(text.slice(0, offset));
		const typed = /<?[A-Za-z]*$/.exec(before)![0];
		if (before.slice(0, before.length - typed.length).trim() || strip(text.slice(offset)).trim()) return undefined;
		const root = this.model.roots.find((r) => r.name === rootName);
		const type = root && this.model.types[root.type];
		if (!root || !type) return undefined;
		let tabstop = 1;
		const attrs = type.attributes.filter((a) => a.required).map((a) => ` ${attributeSnippet(a, tabstop++)}`);
		const item = new vscode.CompletionItem(rootName, vscode.CompletionItemKind.Class);
		item.insertText = new vscode.SnippetString(
			`<${rootName} xmlns="${FABRIC_NAMESPACE}" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"${attrs.join('')}>\n\t$0\n</${rootName}>`,
		);
		item.range = new vscode.Range(doc.positionAt(offset - typed.length), doc.positionAt(offset));
		item.filterText = `<${rootName}`;
		if (root.doc ?? type.doc) item.documentation = new vscode.MarkdownString(root.doc ?? type.doc);
		return [item];
	}

	// ---- hover ----------------------------------------------------------------

	provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const text = doc.getText();
		if (!isSchemaDocument(this.model, text)) return undefined;
		const target = hoverTargetAt(text, doc.offsetAt(position));
		if (!target) return undefined;
		const resolved = resolveElement(this.model, target.path);
		if (!resolved) return undefined;
		const range = new vscode.Range(doc.positionAt(target.range.start), doc.positionAt(target.range.end));
		if (target.kind === 'attribute') {
			const decl = resolved.type.attributes.find((a) => a.name === target.attribute.name);
			return decl ? new vscode.Hover(attributeMarkdown(decl), range) : undefined;
		}
		const md = new vscode.MarkdownString(`**<${target.element.localName}>**`);
		const docText = resolved.decl?.doc ?? resolved.type.doc;
		if (docText) md.appendMarkdown(`\n\n${docText}`);
		const required = resolved.type.attributes.filter((a) => a.required).map((a) => `\`${a.name}\``);
		if (required.length) md.appendMarkdown(`\n\nRequired attributes: ${required.join(', ')}`);
		return new vscode.Hover(md, range);
	}

	dispose(): void {
		for (const t of this.timers.values()) clearTimeout(t);
		for (const d of this.disposables) d.dispose();
	}
}
