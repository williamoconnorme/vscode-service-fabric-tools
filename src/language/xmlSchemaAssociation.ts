// @ts-nocheck
import * as vscode from 'vscode';
import { findServiceFabricSchema } from './schemaProbe';

async function registerXmlSchemaAssociations(e, t) {
	let r = vscode.extensions.getExtension('redhat.vscode-xml');
	if (!r) {
		t.warn('redhat.vscode-xml is not installed; XML schema features will be limited.');
		return;
	}
	let n;
	try {
		(await r.activate(), (n = r.exports));
	} catch (c) {
		t.warn(`Failed to activate redhat.vscode-xml: ${c.message}`);
		return;
	}
	if (!n || typeof n.addXMLFileAssociations != 'function') {
		t.debug('redhat.vscode-xml does not expose addXMLFileAssociations; relying on user settings.');
		return;
	}
	let o = vscode.workspace.getConfiguration('serviceFabric').get('xmlSchemaPath') ?? '',
		s = findServiceFabricSchema({
			override: o,
		});
	if (!s) {
		t.warn(
			`Service Fabric XSDs not found. Install the Service Fabric SDK (typically under "C:\\Program Files\\Microsoft SDKs\\Service Fabric\\schemas") or set "serviceFabric.xmlSchemaPath" to a folder containing ServiceFabricServiceModel.xsd. Manifest validation will fall back to the extension's in-house diagnostics only.`,
		);
		return;
	}
	let a = vscode.Uri.file(s).toString();
	try {
		(n.addXMLFileAssociations([
			{
				systemId: a,
				pattern: '**/ApplicationManifest.xml',
			},
			{
				systemId: a,
				pattern: '**/ServiceManifest.xml',
			},
		]),
			t.info(`Registered Service Fabric XSD with redhat.vscode-xml: ${s}`));
	} catch (c) {
		t.warn(`Failed to register XML associations: ${c.message}`);
	}
}

export { registerXmlSchemaAssociations };
