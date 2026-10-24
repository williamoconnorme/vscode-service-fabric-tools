/**
 * `CompressPackage` for the REST engine, matching
 * `Copy-ServiceFabricApplicationPackage -CompressPackage`: every code / config /
 * data package folder in each service package is replaced by `<Name>.zip`
 * holding the folder's contents. Manifests stay uncompressed. Pure Node
 * (no `vscode` imports, no dependencies).
 */
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { deflateRawSync } from 'zlib';

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(data: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** A file to put in a zip: `/`-separated path inside the archive, and its bytes. */
export interface ZipEntry {
	name: string;
	data: Buffer;
}

const ZIP_LIMIT = 0xffffffff;

/** Builds a zip archive (deflate, or stored when deflating doesn't help). No ZIP64: entries and the archive must stay under 4 GB. */
export function createZip(entries: ZipEntry[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	// 1980-01-01 00:00 in DOS time: reproducible archives, so unchanged packages hash the same.
	const dosTime = 0;
	const dosDate = (0 << 9) | (1 << 5) | 1;
	for (const entry of entries) {
		if (entry.data.length >= ZIP_LIMIT) throw new Error(`${entry.name} is too large to compress (over 4 GB); turn CompressPackage off.`);
		const name = Buffer.from(entry.name, 'utf8');
		const deflated = deflateRawSync(entry.data);
		const stored = deflated.length >= entry.data.length;
		const body = stored ? entry.data : deflated;
		const crc = crc32(entry.data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(stored ? 0 : 8, 8);
		local.writeUInt16LE(dosTime, 10);
		local.writeUInt16LE(dosDate, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4); // version made by
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(stored ? 0 : 8, 10);
		central.writeUInt16LE(dosTime, 12);
		central.writeUInt16LE(dosDate, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(entry.data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, name, body);
		centrals.push(central, name);
		offset += local.length + name.length + body.length;
		if (offset >= ZIP_LIMIT) throw new Error('The package is too large to compress (over 4 GB); turn CompressPackage off.');
	}
	const centralSize = centrals.reduce((n, b) => n + b.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, ...centrals, end]);
}

async function filesUnder(dir: string, rel = ''): Promise<ZipEntry[]> {
	const out: ZipEntry[] = [];
	const entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true });
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const e of entries) {
		const childRel = rel ? `${rel}/${e.name}` : e.name;
		if (e.isDirectory()) out.push(...(await filesUnder(dir, childRel)));
		else if (e.isFile()) out.push({ name: childRel, data: await fsp.readFile(path.join(dir, ...childRel.split('/'))) });
	}
	return out;
}

/**
 * Writes a compressed copy of the package at `packageRoot` to a new temporary
 * folder and returns its path; the caller deletes it. Top-level files
 * (ApplicationManifest.xml) and each service package's files (ServiceManifest.xml)
 * are copied; each folder inside a service package becomes `<folder>.zip`.
 */
export async function compressApplicationPackage(packageRoot: string): Promise<string> {
	const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'sf-compressed-'));
	try {
		for (const top of await fsp.readdir(packageRoot, { withFileTypes: true })) {
			const src = path.join(packageRoot, top.name);
			if (top.isFile()) {
				await fsp.copyFile(src, path.join(out, top.name));
				continue;
			}
			if (!top.isDirectory()) continue;
			const serviceOut = path.join(out, top.name);
			await fsp.mkdir(serviceOut);
			for (const item of await fsp.readdir(src, { withFileTypes: true })) {
				const itemPath = path.join(src, item.name);
				if (item.isFile()) await fsp.copyFile(itemPath, path.join(serviceOut, item.name));
				else if (item.isDirectory()) await fsp.writeFile(path.join(serviceOut, `${item.name}.zip`), createZip(await filesUnder(itemPath)));
			}
		}
		return out;
	} catch (err) {
		await fsp.rm(out, { recursive: true, force: true });
		throw err;
	}
}
