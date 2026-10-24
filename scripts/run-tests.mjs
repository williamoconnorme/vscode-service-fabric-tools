// Bundles each test/**/*.test.ts with esbuild and runs them with Node's
// built-in test runner. Tests cover the pure modules only (no `vscode`).
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const outdir = 'out-test';
const collect = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? collect(join(dir, e.name)) : e.name.endsWith('.test.ts') ? [join(dir, e.name)] : [],
	);
const entryPoints = collect('test');
rmSync(outdir, { recursive: true, force: true });
await esbuild.build({
	entryPoints,
	outdir,
	outbase: 'test',
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	sourcemap: 'inline',
	external: ['vscode'],
	logLevel: 'warning',
});
const files = entryPoints.map((f) => join(outdir, f.slice('test/'.length).replace(/\.ts$/, '.js')));
const result = spawnSync(process.execPath, ['--enable-source-maps', '--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
