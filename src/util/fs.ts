// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';

async function readTextFile(e) {
	return fs.promises.readFile(e, 'utf8');
}

async function pathExists(e) {
	try {
		return (await fs.promises.access(e), !0);
	} catch {
		return !1;
	}
}

async function listDirectories(e) {
	try {
		return (
			await fs.promises.readdir(e, {
				withFileTypes: !0,
			})
		)
			.filter((r) => r.isDirectory())
			.map((r) => path.join(e, r.name));
	} catch {
		return [];
	}
}

async function listFiles(e, t) {
	try {
		return (
			await fs.promises.readdir(e, {
				withFileTypes: !0,
			})
		)
			.filter((n) => n.isFile() && (!t || n.name.toLowerCase().endsWith(t.toLowerCase())))
			.map((n) => path.join(e, n.name));
	} catch {
		return [];
	}
}

function resolveAgainst(e, t) {
	return path.isAbsolute(t) ? path.normalize(t) : path.normalize(path.resolve(e, t.replace(/\\/g, path.sep)));
}

export { listDirectories, listFiles, pathExists, readTextFile, resolveAgainst };
