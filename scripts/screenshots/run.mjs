// Bundles capture.ts (it imports the extension's scaffolding) and runs it.
// Usage: npm run screenshots
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sf-capture-'));
const outfile = join(dir, 'capture.cjs');
await esbuild.build({
	entryPoints: ['scripts/screenshots/capture.ts'],
	outfile,
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	external: ['playwright-core', 'vscode'],
	define: { __dirname: JSON.stringify(join(process.cwd(), 'scripts', 'screenshots')) },
	logLevel: 'warning',
});
const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit', env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') } });
rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
