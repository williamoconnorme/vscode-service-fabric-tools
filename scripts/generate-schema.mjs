// Regenerates src/language/schema/serviceFabricSchema.json from the Service
// Fabric SDK's ServiceFabricServiceModel.xsd. Run after an SDK update:
//   npm run schema [-- path/to/ServiceFabricServiceModel.xsd]
import * as esbuild from 'esbuild';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'src/language/schema/serviceFabricSchema.json';
const candidates = [
	process.argv[2],
	'C:\\Program Files\\Microsoft SDKs\\Service Fabric\\schemas\\ServiceFabricServiceModel.xsd',
	'C:\\Program Files (x86)\\Microsoft SDKs\\Service Fabric\\schemas\\ServiceFabricServiceModel.xsd',
].filter(Boolean);
const xsd = candidates.find((p) => existsSync(p));
if (!xsd) {
	console.error(`ServiceFabricServiceModel.xsd not found. Pass its path: npm run schema -- <path>`);
	process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'sf-schema-'));
try {
	const outfile = join(dir, 'xsdCompiler.cjs');
	await esbuild.build({
		entryPoints: ['src/language/schema/xsdCompiler.ts'],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'warning',
	});
	const { compileXsd } = createRequire(import.meta.url)(outfile);
	const model = compileXsd(readFileSync(xsd, 'utf8'));
	writeFileSync(OUT, JSON.stringify(model, null, '\t') + '\n');
	console.log(`Wrote ${OUT} from ${xsd}: ${model.roots.length} roots, ${Object.keys(model.types).length} types.`);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
