import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

export const SERVICE_FABRIC_SCHEMA_FILE = 'ServiceFabricServiceModel.xsd';

export const DEFAULT_SCHEMA_PROBE: readonly string[] = [
	'C:\\Program Files\\Microsoft SDKs\\Service Fabric\\schemas',
	'C:\\Program Files (x86)\\Microsoft SDKs\\Service Fabric\\schemas',
	'C:\\Program Files\\Microsoft Service Fabric\\bin\\Fabric\\Fabric.Code',
	// macOS / Linux: no SDK installer; drop the XSD here (or set serviceFabric.xmlSchemaPath).
	nodePath.join(nodeOs.homedir(), '.servicefabric', 'schemas'),
];

export interface SchemaProbeOptions {
	/** User override (`serviceFabric.xmlSchemaPath`): a folder or a direct `.xsd` path. */
	override?: string;
	/** Folders (or `.xsd` paths) to probe; defaults to {@link DEFAULT_SCHEMA_PROBE}. */
	probe?: readonly string[];
	/** Existence check, injectable for tests. Defaults to `fs.existsSync`. */
	exists?: (p: string) => boolean;
}

/**
 * Returns the path of the first ServiceFabricServiceModel.xsd that exists,
 * checking the override first and then each probe folder. Returns `undefined`
 * if none is found.
 */
export function findServiceFabricSchema(opts: SchemaProbeOptions = {}): string | undefined {
	const exists = opts.exists ?? ((p: string) => nodeFs.existsSync(p));
	const candidates: string[] = [];
	if (opts.override && opts.override.trim().length > 0) {
		const o = opts.override.trim();
		if (o.toLowerCase().endsWith('.xsd')) {
			candidates.push(o);
		} else {
			candidates.push(nodePath.join(o, SERVICE_FABRIC_SCHEMA_FILE));
		}
	}
	for (const probe of opts.probe ?? DEFAULT_SCHEMA_PROBE) {
		if (probe.toLowerCase().endsWith('.xsd')) {
			candidates.push(probe);
		} else {
			candidates.push(nodePath.join(probe, SERVICE_FABRIC_SCHEMA_FILE));
		}
	}
	for (const c of candidates) {
		if (exists(c)) return c;
	}
	return undefined;
}
