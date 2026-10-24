import * as vscode from 'vscode';
import { parseXmlOutline, type XmlOutlineNode } from '../util/xmlOutline';

const SYMBOL_KINDS: Record<string, vscode.SymbolKind> = {
	ApplicationManifest: vscode.SymbolKind.Module,
	ServiceManifest: vscode.SymbolKind.Module,
	Application: vscode.SymbolKind.Module,
	PublishProfile: vscode.SymbolKind.Module,
	StartupServices: vscode.SymbolKind.Module,
	Parameters: vscode.SymbolKind.Namespace,
	Parameter: vscode.SymbolKind.Variable,
	Section: vscode.SymbolKind.Namespace,
	ServiceManifestImport: vscode.SymbolKind.Package,
	ServiceManifestRef: vscode.SymbolKind.Package,
	DefaultServices: vscode.SymbolKind.Namespace,
	Service: vscode.SymbolKind.Class,
	StatefulService: vscode.SymbolKind.Class,
	StatelessService: vscode.SymbolKind.Class,
	ServiceTypes: vscode.SymbolKind.Namespace,
	StatefulServiceType: vscode.SymbolKind.Class,
	StatelessServiceType: vscode.SymbolKind.Class,
	CodePackage: vscode.SymbolKind.Package,
	ConfigPackage: vscode.SymbolKind.Package,
	DataPackage: vscode.SymbolKind.Package,
	Endpoint: vscode.SymbolKind.Interface,
	Policies: vscode.SymbolKind.Namespace,
	Principals: vscode.SymbolKind.Namespace,
	Certificates: vscode.SymbolKind.Namespace,
	ClusterConnectionParameters: vscode.SymbolKind.Property,
	ApplicationParameterFile: vscode.SymbolKind.File,
	EntryPoint: vscode.SymbolKind.Function,
	SetupEntryPoint: vscode.SymbolKind.Function,
};

/**
 * Outline, breadcrumbs and Go to Symbol for Service Fabric manifests, parameter files,
 * publish profiles and StartupServices.xml: each element is a symbol named after its
 * `Name` (or `ServiceTypeName`, …) attribute, with the element name as detail.
 */
export class ManifestSymbolProvider implements vscode.DocumentSymbolProvider {
	provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
		const toSymbol = (node: XmlOutlineNode): vscode.DocumentSymbol => {
			const range = new vscode.Range(document.positionAt(node.start), document.positionAt(node.end));
			const selection = new vscode.Range(document.positionAt(node.tagStart), document.positionAt(node.tagEnd));
			const symbol = new vscode.DocumentSymbol(
				node.nameValue || node.element,
				node.nameValue ? node.element : '',
				SYMBOL_KINDS[node.element] ?? vscode.SymbolKind.Field,
				range,
				selection,
			);
			symbol.children = node.children.map(toSymbol);
			return symbol;
		};
		return parseXmlOutline(document.getText()).map(toSymbol);
	}
}
