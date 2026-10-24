// @ts-nocheck
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

var SERVICE_FABRIC_SCHEMA_FILE = 'ServiceFabricServiceModel.xsd',
	DEFAULT_SCHEMA_PROBE = [
		'C:\\Program Files\\Microsoft SDKs\\Service Fabric\\schemas',
		'C:\\Program Files (x86)\\Microsoft SDKs\\Service Fabric\\schemas',
		'C:\\Program Files\\Microsoft Service Fabric\\bin\\Fabric\\Fabric.Code',
	];

function findServiceFabricSchema(e = {}) {
	let t = e.exists ?? ((n) => nodeFs.existsSync(n)),
		r = [];
	if (e.override && e.override.trim().length > 0) {
		let n = e.override.trim();
		n.toLowerCase().endsWith('.xsd') ? r.push(n) : r.push(nodePath.join(n, SERVICE_FABRIC_SCHEMA_FILE));
	}
	for (let n of e.probe ?? DEFAULT_SCHEMA_PROBE)
		n.toLowerCase().endsWith('.xsd') ? r.push(n) : r.push(nodePath.join(n, SERVICE_FABRIC_SCHEMA_FILE));
	for (let n of r) if (t(n)) return n;
}

export { findServiceFabricSchema };
