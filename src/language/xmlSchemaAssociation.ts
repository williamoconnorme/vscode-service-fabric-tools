import * as vscode from 'vscode';
import type { Logger } from '../util/logger';
import { findServiceFabricSchema } from './schemaProbe';

/** One `systemId` ↔ glob association accepted by redhat.vscode-xml. */
interface XmlFileAssociation {
	systemId: string;
	pattern: string;
}

/** The part of redhat.vscode-xml's exported API that we use. */
interface RedHatXmlApi {
	addXMLFileAssociations?: (associations: XmlFileAssociation[]) => void;
}

/**
 * Registers the Service Fabric service-model XSD with redhat.vscode-xml for
 * ApplicationManifest.xml and ServiceManifest.xml. Logs and returns if the XML
 * extension or the XSD can't be found.
 */
export async function registerXmlSchemaAssociations(_context: vscode.ExtensionContext, logger: Logger): Promise<void> {
	const xmlExtension = vscode.extensions.getExtension<RedHatXmlApi | undefined>('redhat.vscode-xml');
	if (!xmlExtension) {
		logger.warn('redhat.vscode-xml is not installed; XML schema features will be limited.');
		return;
	}
	let api: RedHatXmlApi | undefined;
	try {
		await xmlExtension.activate();
		api = xmlExtension.exports;
	} catch (err) {
		logger.warn(`Failed to activate redhat.vscode-xml: ${(err as Error).message}`);
		return;
	}
	if (!api || typeof api.addXMLFileAssociations != 'function') {
		logger.debug('redhat.vscode-xml does not expose addXMLFileAssociations; relying on user settings.');
		return;
	}
	const override = vscode.workspace.getConfiguration('serviceFabric').get<string>('xmlSchemaPath') ?? '';
	const schemaPath = findServiceFabricSchema({ override });
	if (!schemaPath) {
		logger.warn(
			`Service Fabric XSDs not found. Install the Service Fabric SDK (typically under "C:\\Program Files\\Microsoft SDKs\\Service Fabric\\schemas") or set "serviceFabric.xmlSchemaPath" to a folder containing ServiceFabricServiceModel.xsd. Manifest validation will fall back to the extension's in-house diagnostics only.`,
		);
		return;
	}
	const systemId = vscode.Uri.file(schemaPath).toString();
	try {
		api.addXMLFileAssociations([
			{ systemId, pattern: '**/ApplicationManifest.xml' },
			{ systemId, pattern: '**/ServiceManifest.xml' },
		]);
		logger.info(`Registered Service Fabric XSD with redhat.vscode-xml: ${schemaPath}`);
	} catch (err) {
		logger.warn(`Failed to register XML associations: ${(err as Error).message}`);
	}
}
