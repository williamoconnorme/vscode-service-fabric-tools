import * as fs from 'fs';
import * as path from 'path';

export async function readTextFile(p: string): Promise<string> {
	return fs.promises.readFile(p, 'utf8');
}

export async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.promises.access(p);
		return true;
	} catch {
		return false;
	}
}

/** Absolute paths of the immediate subdirectories of `p` (empty on error). */
export async function listDirectories(p: string): Promise<string[]> {
	try {
		const entries = await fs.promises.readdir(p, { withFileTypes: true });
		return entries.filter((d) => d.isDirectory()).map((d) => path.join(p, d.name));
	} catch {
		return [];
	}
}

/** Absolute paths of the files directly in `p`, optionally filtered by a case-insensitive extension (empty on error). */
export async function listFiles(p: string, ext?: string): Promise<string[]> {
	try {
		const entries = await fs.promises.readdir(p, { withFileTypes: true });
		return entries.filter((d) => d.isFile() && (!ext || d.name.toLowerCase().endsWith(ext.toLowerCase()))).map((d) => path.join(p, d.name));
	} catch {
		return [];
	}
}

/** Resolve a possibly-relative path against a base, normalizing separators. */
export function resolveAgainst(base: string, p: string): string {
	return path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.resolve(base, p.replace(/\\/g, path.sep)));
}
