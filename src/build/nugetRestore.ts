import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import * as zlib from 'zlib';
import * as cp from 'child_process';
import type * as vscodeTypes from 'vscode';
import { locateNuget } from './nugetLocator';
import { locateMsBuild } from './msbuildLocator';

/** A `<package id="…" version="…" />` row from packages.config. */
export interface PackageRef {
	id: string;
	version: string;
}

export type RestoreStrategy = 'skipped' | 'nuget-exe' | 'msbuild-restorepkgconfig' | 'http-fallback' | 'failed';

export interface RestoreResult {
	ok: boolean;
	strategy: RestoreStrategy;
	message?: string;
	/** The `packages/` directory that was checked / restored into. */
	packagesDirectory: string;
	/** Packages that were missing when the restore started. */
	missingOnEntry: PackageRef[];
}

/** Minimal output sink (structurally a `vscode.OutputChannel`). */
export interface RestoreOutput {
	append(text: string): void;
	appendLine(text: string): void;
}

export interface RestoreOptions {
	output?: RestoreOutput;
	progress?: vscodeTypes.Progress<{ message?: string; increment?: number }>;
}

/** The package that provides the `.sfproj` build targets; the one restore must not skip. */
const SF_MSBUILD_PACKAGE_ID = 'Microsoft.VisualStudio.Azure.Fabric.MSBuild';

function isSfMsbuildPackage(pkg: PackageRef): boolean {
	return pkg.id.toLowerCase() === SF_MSBUILD_PACKAGE_ID.toLowerCase();
}

/**
 * Ensure every package referenced by `<sfprojDir>/packages.config` is present
 * under the `packages/` folder the `.sfproj` imports from (see
 * {@link computePackagesDirectory}). Idempotent: returns immediately with
 * `strategy:'skipped'` when every required directory already exists.
 *
 * Resolution chain:
 *   B. `nuget.exe restore` (when `locateNuget()` finds an executable).
 *   C. `msbuild /t:Restore /p:RestorePackagesConfig=true /p:RestorePackagesPath=…`.
 *   F. Direct `https://api.nuget.org/v3-flatcontainer/<id>/<ver>/<id>.<ver>.nupkg`
 *      fetch + in-process unzip — used only when the missing set is small.
 *      On Windows it runs after B and C fail. Elsewhere it replaces C: .NET
 *      (Core) MSBuild's Restore silently skips `packages.config` projects, so
 *      C exits 0 there without restoring anything.
 *
 * Off Windows, packages that only exist on a private feed can't be fetched
 * (F only knows api.nuget.org). As long as the Service Fabric MSBuild package
 * itself is present, restore succeeds and names the skipped packages.
 *
 * Returns `{ ok: false, strategy: 'failed', message }` with an actionable error
 * when every strategy fails. Never throws (callers can safely await without try/catch).
 */
export async function ensureNugetRestored(sfprojPath: string, options?: RestoreOptions): Promise<RestoreResult> {
	const output = options?.output;
	const progress = options?.progress;
	const sfprojDir = path.dirname(sfprojPath);
	const packagesConfigPath = path.join(sfprojDir, 'packages.config');
	const packagesDirectory = computePackagesDirectory(sfprojPath);
	let required: PackageRef[];
	try {
		const xml = fs.readFileSync(packagesConfigPath, 'utf8');
		required = parsePackagesConfig(xml);
	} catch {
		// No packages.config → nothing to restore (e.g. project authored
		// entirely against PackageReference). Treat as success/skipped.
		return {
			ok: true,
			strategy: 'skipped',
			message: `No packages.config alongside ${path.basename(sfprojPath)}; nothing to restore.`,
			packagesDirectory,
			missingOnEntry: [],
		};
	}
	const missing = required.filter((p) => !packageDirectoryComplete(packagesDirectory, p));
	const offWindows = process.platform !== 'win32';
	if (offWindows && missing.length > 0 && !missing.some(isSfMsbuildPackage) && required.some(isSfMsbuildPackage)) {
		// Already warned on the restore that left these behind; don't re-fetch on every build.
		output?.appendLine(`[nuget-restore] Service Fabric targets present; not restoring ${describe(missing)} (not available off Windows).`);
		return {
			ok: true,
			strategy: 'skipped',
			message: 'Service Fabric MSBuild targets are restored.',
			packagesDirectory,
			missingOnEntry: [],
		};
	}
	if (missing.length === 0) {
		return {
			ok: true,
			strategy: 'skipped',
			message: 'NuGet packages are already restored.',
			packagesDirectory,
			missingOnEntry: [],
		};
	}
	progress?.report({ message: `Restoring ${missing.length} NuGet package(s)…` });
	output?.appendLine(`[nuget-restore] Missing: ${describe(missing)} (restoring into ${packagesDirectory})`);

	// Strategy B — nuget.exe.
	const nuget = await locateNuget();
	if (nuget) {
		output?.appendLine(`[nuget-restore] Strategy B: ${nuget.description}`);
		const ok = await runNugetExeRestore(nuget.executable, sfprojPath, packagesDirectory, output);
		if (ok && stillMissing(packagesDirectory, required).length === 0) {
			return success('nuget-exe', packagesDirectory, missing);
		}
	} else {
		output?.appendLine('[nuget-restore] Strategy B: nuget.exe not found; skipping.');
	}

	// Strategy F — HTTP fallback (only when remaining set is small enough to be sane).
	const tryHttpFallback = async (): Promise<boolean> => {
		const remaining = stillMissing(packagesDirectory, required);
		if (remaining.length === 0 || remaining.length > 4) return false;
		output?.appendLine(`[nuget-restore] Strategy F: HTTP fetch from api.nuget.org for ${remaining.length} package(s)`);
		// One package that isn't on nuget.org (a private-feed package) mustn't stop the others.
		for (const pkg of remaining) {
			progress?.report({ message: `Fetching ${pkg.id} ${pkg.version}…` });
			try {
				await fetchAndExtract(pkg, packagesDirectory, output);
			} catch (err) {
				output?.appendLine(
					`[nuget-restore] Strategy F: ${pkg.id} ${pkg.version} failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
		return stillMissing(packagesDirectory, required).length === 0;
	};
	if (offWindows) {
		if (await tryHttpFallback()) return success('http-fallback', packagesDirectory, missing);
		const left = stillMissing(packagesDirectory, required);
		if (!left.some(isSfMsbuildPackage)) {
			output?.appendLine(
				`[nuget-restore] Warning: couldn't restore ${describe(left)} from api.nuget.org. packages.config packages from private feeds can't be restored off Windows; the Service Fabric targets are in place, so the build continues. If the .sfproj imports one of these packages, copy it into ${packagesDirectory}.`,
			);
			return success('http-fallback', packagesDirectory, missing);
		}
		return {
			ok: false,
			strategy: 'failed',
			message: `Could not download ${SF_MSBUILD_PACKAGE_ID} from api.nuget.org into ${packagesDirectory}. Check network access to api.nuget.org (see the Service Fabric output channel for the error).`,
			packagesDirectory,
			missingOnEntry: missing,
		};
	}

	// Strategy C — msbuild /t:Restore /p:RestorePackagesConfig=true.
	output?.appendLine('[nuget-restore] Strategy C: msbuild /t:Restore /p:RestorePackagesConfig=true');
	const msbuildOk = await runMsbuildRestore(sfprojPath, packagesDirectory, output);
	if (msbuildOk && stillMissing(packagesDirectory, required).length === 0) {
		return success('msbuild-restorepkgconfig', packagesDirectory, missing);
	}

	if (process.platform === 'win32' && (await tryHttpFallback())) return success('http-fallback', packagesDirectory, missing);
	return {
		ok: false,
		strategy: 'failed',
		message:
			"Could not restore the Service Fabric MSBuild targets. Install Visual Studio 2022 (any edition with the .NET workload), or run 'nuget restore <App>.sfproj -PackagesDirectory packages' manually, or check network connectivity to api.nuget.org.",
		packagesDirectory,
		missingOnEntry: missing,
	};
}

/**
 * The `packages/` folder the `.sfproj` imports its Service Fabric targets
 * from: the folder in `<Import Project="…\packages\Microsoft.VisualStudio.Azure.Fabric.MSBuild.<ver>\build\…">`,
 * resolved against the project. Defaults to `<sfprojDir>/../packages`, the
 * Visual Studio convention (the solution folder's `packages/`).
 */
export function computePackagesDirectory(sfprojPath: string, sfprojXml?: string): string {
	const sfprojDir = path.dirname(sfprojPath);
	let xml = sfprojXml;
	if (xml === undefined) {
		try {
			xml = fs.readFileSync(sfprojPath, 'utf8');
		} catch {
			xml = '';
		}
	}
	const m = /<Import\b[^>]*\bProject\s*=\s*"([^"]*?)[\\/]?Microsoft\.VisualStudio\.Azure\.Fabric\.MSBuild\.[^\\/"]+[\\/]build[\\/]/i.exec(
		xml,
	);
	if (m && !m[1].includes('$(')) {
		const relative = m[1].replace(/[\\/]+/g, path.sep);
		return path.resolve(sfprojDir, relative || '.');
	}
	return path.join(path.dirname(sfprojDir), 'packages');
}

function describe(packages: PackageRef[]): string {
	return packages.map((p) => `${p.id}.${p.version}`).join(', ');
}

/**
 * Parses `packages.config` to extract `<package id="…" version="…" />` rows.
 * Tolerant of XML attribute order and whitespace.
 */
function parsePackagesConfig(xml: string): PackageRef[] {
	const out: PackageRef[] = [];
	const re = /<package\b([^/>]*)\/>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml)) !== null) {
		const attrs = m[1];
		const idMatch = /\bid\s*=\s*"([^"]+)"/i.exec(attrs);
		const verMatch = /\bversion\s*=\s*"([^"]+)"/i.exec(attrs);
		if (idMatch && verMatch) {
			out.push({ id: idMatch[1], version: verMatch[1] });
		}
	}
	return out;
}

/**
 * Idempotency probe: a package is "complete" when the canonical
 * `<id>.<ver>/build/` subtree exists (the only thing the SF Application
 * targets actually require — the `.props` / `.targets` files that the
 * `<Import>` elements in the `.sfproj` resolve to).
 *
 * For non-SF packages where `build/` is absent we fall back to checking the
 * package directory itself, since that means a different package-shape
 * (lib-only, content-only) and the directory's existence is enough.
 */
function packageDirectoryComplete(packagesDir: string, pkg: PackageRef): boolean {
	const dir = path.join(packagesDir, `${pkg.id}.${pkg.version}`);
	if (!fs.existsSync(dir)) return false;
	const buildDir = path.join(dir, 'build');
	if (fs.existsSync(buildDir)) return true;
	// Non-build-bearing package — directory existence is sufficient.
	try {
		return fs.readdirSync(dir).length > 0;
	} catch {
		return false;
	}
}

function stillMissing(packagesDir: string, required: PackageRef[]): PackageRef[] {
	return required.filter((p) => !packageDirectoryComplete(packagesDir, p));
}

function success(strategy: RestoreStrategy, packagesDirectory: string, missingOnEntry: PackageRef[]): RestoreResult {
	return { ok: true, strategy, packagesDirectory, missingOnEntry };
}

async function runNugetExeRestore(nugetExe: string, sfprojPath: string, packagesDir: string, output?: RestoreOutput): Promise<boolean> {
	return new Promise((resolve) => {
		const child = cp.spawn(nugetExe, ['restore', sfprojPath, '-PackagesDirectory', packagesDir, '-NonInteractive', '-Verbosity', 'quiet'], {
			windowsHide: true,
		});
		child.stdout?.on('data', (d) => output?.append(d.toString()));
		child.stderr?.on('data', (d) => output?.append(d.toString()));
		child.on('error', (err) => {
			output?.appendLine(`[nuget-restore] nuget.exe error: ${err.message}`);
			resolve(false);
		});
		child.on('close', (code) => resolve(code === 0));
	});
}

async function runMsbuildRestore(sfprojPath: string, packagesDir: string, output?: RestoreOutput): Promise<boolean> {
	const ms = await locateMsBuild();
	return new Promise((resolve) => {
		const args = [
			...ms.leadingArgs,
			sfprojPath,
			'/t:Restore',
			'/p:RestorePackagesConfig=true',
			`/p:RestorePackagesPath=${packagesDir}`,
			'/nologo',
			'/v:minimal',
		];
		const child = cp.spawn(ms.executable, args, { windowsHide: true });
		child.stdout?.on('data', (d) => output?.append(d.toString()));
		child.stderr?.on('data', (d) => output?.append(d.toString()));
		child.on('error', (err) => {
			output?.appendLine(`[nuget-restore] msbuild error: ${err.message}`);
			resolve(false);
		});
		child.on('close', (code) => resolve(code === 0));
	});
}

// ---------------------------------------------------------------------------
// Strategy F — direct nupkg fetch + in-process unzip
// ---------------------------------------------------------------------------

async function fetchAndExtract(pkg: PackageRef, packagesDir: string, output?: RestoreOutput): Promise<void> {
	const url = `https://api.nuget.org/v3-flatcontainer/${pkg.id.toLowerCase()}/${pkg.version}/${pkg.id.toLowerCase()}.${pkg.version}.nupkg`;
	output?.appendLine(`[nuget-restore]   GET ${url}`);
	const tmpFile = path.join(os.tmpdir(), `sf-restore-${pkg.id}-${pkg.version}-${Date.now()}.nupkg`);
	try {
		await downloadToFile(url, tmpFile);
		const targetDir = path.join(packagesDir, `${pkg.id}.${pkg.version}`);
		fs.mkdirSync(targetDir, { recursive: true });
		await extractNupkg(tmpFile, targetDir);
	} finally {
		try {
			fs.unlinkSync(tmpFile);
		} catch {
			/* best-effort */
		}
	}
}

function downloadToFile(url: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const doRequest = (currentUrl: string, redirectsLeft: number): void => {
			https
				.get(currentUrl, (res) => {
					const status = res.statusCode ?? 0;
					if ((status === 301 || status === 302 || status === 307 || status === 308) && res.headers.location) {
						if (redirectsLeft <= 0) {
							reject(new Error(`Too many redirects fetching ${url}`));
							return;
						}
						res.resume();
						doRequest(res.headers.location, redirectsLeft - 1);
						return;
					}
					if (status !== 200) {
						reject(new Error(`HTTP ${status} fetching ${url}`));
						return;
					}
					const file = fs.createWriteStream(dest);
					res.pipe(file);
					file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())));
					file.on('error', reject);
				})
				.on('error', reject);
		};
		doRequest(url, 5);
	});
}

/**
 * Extracts a `.nupkg` (a ZIP file) into `targetDir`. We only need the canonical
 * archive shape that NuGet emits — a ZIP with stored / deflated entries — so a
 * minimal in-process reader suffices and avoids pulling in `adm-zip`.
 *
 * Reads the End-of-Central-Directory record, walks the central directory,
 * and decompresses each file entry via `zlib.inflateRawSync`. Only stored
 * (method 0) and deflated (method 8) entries are supported, which covers
 * 100% of nupkg files in practice.
 */
async function extractNupkg(nupkgPath: string, targetDir: string): Promise<void> {
	const buf = fs.readFileSync(nupkgPath);
	// Locate End-of-Central-Directory (EOCD) signature 0x06054b50.
	const eocdSig = 0x06054b50;
	let eocdOffset = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
		if (buf.readUInt32LE(i) === eocdSig) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) throw new Error('Invalid nupkg: missing End-of-Central-Directory record.');
	const cdEntries = buf.readUInt16LE(eocdOffset + 10);
	const cdSize = buf.readUInt32LE(eocdOffset + 12);
	const cdOffset = buf.readUInt32LE(eocdOffset + 16);
	if (cdOffset + cdSize > buf.length) throw new Error('Invalid nupkg: central directory bounds out of range.');
	let p = cdOffset;
	for (let i = 0; i < cdEntries; i++) {
		if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`Invalid nupkg: bad central-directory header at offset ${p}.`);
		const method = buf.readUInt16LE(p + 10);
		const compSize = buf.readUInt32LE(p + 20);
		const uncompSize = buf.readUInt32LE(p + 24);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const localHeaderOffset = buf.readUInt32LE(p + 42);
		const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
		p += 46 + nameLen + extraLen + commentLen;
		// Read the local file header to find the actual data offset.
		if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error(`Invalid nupkg: bad local file header for ${name}.`);
		const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
		const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
		const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
		const compressed = buf.slice(dataStart, dataStart + compSize);
		// Skip directory entries (NuGet packs them as zero-length entries with trailing slashes).
		// Sanitize the entry name to prevent zip-slip.
		const safeRel = sanitizeEntryName(name);
		if (name.endsWith('/')) {
			if (safeRel) fs.mkdirSync(path.join(targetDir, safeRel), { recursive: true });
			continue;
		}
		if (!safeRel) continue;
		const fileAbs = path.join(targetDir, safeRel);
		fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
		let content: Buffer;
		if (method === 0) content = compressed;
		else if (method === 8) content = zlib.inflateRawSync(compressed);
		else throw new Error(`Unsupported nupkg compression method ${method} for ${name}.`);
		if (content.length !== uncompSize) throw new Error(`Length mismatch extracting ${name}: ${content.length} != ${uncompSize}.`);
		fs.writeFileSync(fileAbs, content);
	}
}

/**
 * Drops absolute / parent-traversal segments from a zip entry name so writing
 * the file can never escape `targetDir`. Returns `undefined` when the entry
 * name is empty after sanitisation (e.g. the zip-internal `_rels/` empty
 * placeholders NuGet sometimes emits).
 */
function sanitizeEntryName(name: string): string | undefined {
	const segments = name.split(/[\\/]+/).filter((s) => s !== '' && s !== '.' && s !== '..');
	if (segments.length === 0) return undefined;
	return segments.join(path.sep);
}
