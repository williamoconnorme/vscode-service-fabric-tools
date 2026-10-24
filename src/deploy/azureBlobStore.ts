/**
 * Uploads application packages to an Azure Storage `xstore:` image store, the
 * way `Copy-ServiceFabricApplicationPackage` does for clusters whose
 * `ImageStoreConnectionString` is
 * `xstore:DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…;Container=…`.
 * Blob service REST with Shared Key auth. Pure Node (no `vscode` imports, no dependencies).
 */
import { createHmac, randomUUID } from 'crypto';
import * as https from 'https';
import * as http from 'http';

export interface XstoreConfig {
	accountName: string;
	/** Base64 account key. */
	accountKey: string;
	container: string;
	/** Blob service endpoint, e.g. `https://acct.blob.core.windows.net`. */
	blobEndpoint: string;
}

/** Parses the part after `xstore:`. Throws when the account, key or container is missing. */
export function parseXstoreConnectionString(connectionString: string): XstoreConfig {
	const body = connectionString.trim().replace(/^xstore:/i, '');
	const fields = new Map<string, string>();
	for (const part of body.split(';')) {
		const eq = part.indexOf('=');
		if (eq > 0) fields.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
	}
	const accountName = fields.get('accountname');
	const accountKey = fields.get('accountkey');
	const container = fields.get('container');
	if (!accountName || !accountKey || !container) {
		throw new Error('The xstore: connection string needs AccountName, AccountKey and Container.');
	}
	const protocol = fields.get('defaultendpointsprotocol') ?? 'https';
	const suffix = fields.get('endpointsuffix') ?? 'core.windows.net';
	const blobEndpoint = (fields.get('blobendpoint') ?? `${protocol}://${accountName}.blob.${suffix}`).replace(/\/$/, '');
	return { accountName, accountKey, container, blobEndpoint };
}

const API_VERSION = '2021-08-06';

/**
 * The Shared Key `Authorization` header for a request
 * (https://learn.microsoft.com/rest/api/storageservices/authorize-with-shared-key).
 * `headers` must include every `x-ms-*` header sent; `contentLength` is 0 for no body.
 */
export function sharedKeyAuthorization(
	method: string,
	url: URL,
	headers: Record<string, string>,
	contentLength: number,
	accountName: string,
	accountKey: string,
): string {
	const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
	const canonicalHeaders = Object.keys(h)
		.filter((k) => k.startsWith('x-ms-'))
		.sort()
		.map((k) => `${k}:${h[k].trim()}\n`)
		.join('');
	const params = [...url.searchParams.entries()].map(([k, v]) => [k.toLowerCase(), v] as const).sort(([a], [b]) => a.localeCompare(b));
	const canonicalResource = `/${accountName}${url.pathname}${params.map(([k, v]) => `\n${k}:${v}`).join('')}`;
	const stringToSign = [
		method,
		h['content-encoding'] ?? '',
		h['content-language'] ?? '',
		contentLength > 0 ? String(contentLength) : '',
		h['content-md5'] ?? '',
		h['content-type'] ?? '',
		'', // Date (x-ms-date is used instead)
		h['if-modified-since'] ?? '',
		h['if-match'] ?? '',
		h['if-none-match'] ?? '',
		h['if-unmodified-since'] ?? '',
		h['range'] ?? '',
		canonicalHeaders + canonicalResource,
	].join('\n');
	const signature = createHmac('sha256', Buffer.from(accountKey, 'base64')).update(stringToSign, 'utf8').digest('base64');
	return `SharedKey ${accountName}:${signature}`;
}

/** Sends one request; injectable for tests. Resolves with the status and body, rejects on network errors. */
export type BlobRequester = (
	method: string,
	url: URL,
	headers: Record<string, string>,
	body: Buffer | undefined,
	timeoutMs: number,
) => Promise<{ status: number; body: string }>;

const nodeRequester: BlobRequester = (method, url, headers, body, timeoutMs) =>
	new Promise((resolve, reject) => {
		const lib = url.protocol === 'http:' ? http : https;
		const req = lib.request(url, { method, headers, timeout: timeoutMs }, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (c: Buffer) => chunks.push(c));
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
		});
		req.on('timeout', () => req.destroy(new Error(`Request to ${url.host} timed out after ${timeoutMs} ms.`)));
		req.on('error', reject);
		if (body && body.length > 0) req.write(body);
		req.end();
	});

/** Files above this size go up in blocks of this size. */
export const BLOCK_BYTES = 8 * 1024 * 1024;

function encodePath(p: string): string {
	return p.split('/').map(encodeURIComponent).join('/');
}

/** Blob operations an `xstore:` deploy needs. */
export class AzureBlobStore {
	constructor(
		private readonly cfg: XstoreConfig,
		private readonly send: BlobRequester = nodeRequester,
	) {}

	private async call(method: string, blobPath: string | undefined, query: Record<string, string>, body?: Buffer, extra: Record<string, string> = {}, timeoutMs = 120000): Promise<string> {
		const url = new URL(`${this.cfg.blobEndpoint}/${encodeURIComponent(this.cfg.container)}${blobPath ? `/${encodePath(blobPath)}` : ''}`);
		for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
		const headers: Record<string, string> = { 'x-ms-date': new Date().toUTCString(), 'x-ms-version': API_VERSION, ...extra };
		const length = body?.length ?? 0;
		headers['Content-Length'] = String(length);
		headers.Authorization = sharedKeyAuthorization(method, url, headers, length, this.cfg.accountName, this.cfg.accountKey);
		const res = await this.send(method, url, headers, body, timeoutMs);
		if (res.status >= 300) {
			const code = /<Code>([^<]+)<\/Code>/.exec(res.body)?.[1];
			const message = /<Message>([^<]+)<\/Message>/.exec(res.body)?.[1]?.split('\n')[0];
			throw new Error(`Azure Storage ${method} ${url.pathname} failed: HTTP ${res.status}${code ? ` ${code}` : ''}${message ? ` (${message})` : ''}.`);
		}
		return res.body;
	}

	/** Uploads `data` as a block blob, in blocks when it is large. */
	async uploadBlob(blobPath: string, read: (start: number, end: number) => Promise<Buffer>, size: number): Promise<void> {
		if (size <= BLOCK_BYTES) {
			await this.call('PUT', blobPath, {}, await read(0, size), { 'x-ms-blob-type': 'BlockBlob' });
			return;
		}
		const prefix = randomUUID().replace(/-/g, '').slice(0, 16);
		const ids: string[] = [];
		for (let start = 0, n = 0; start < size; start += BLOCK_BYTES, n++) {
			const id = Buffer.from(`${prefix}-${String(n).padStart(6, '0')}`).toString('base64');
			ids.push(id);
			await this.call('PUT', blobPath, { comp: 'block', blockid: id }, await read(start, Math.min(size, start + BLOCK_BYTES)));
		}
		const list = Buffer.from(`<?xml version="1.0" encoding="utf-8"?><BlockList>${ids.map((id) => `<Latest>${id}</Latest>`).join('')}</BlockList>`);
		await this.call('PUT', blobPath, { comp: 'blocklist' }, list, { 'Content-Type': 'application/xml' });
	}

	/** Deletes every blob under `prefix/`. */
	async deletePrefix(prefix: string): Promise<void> {
		let marker: string | undefined;
		do {
			const xml = await this.call('GET', undefined, { restype: 'container', comp: 'list', prefix: `${prefix}/`, ...(marker ? { marker } : {}) });
			for (const m of xml.matchAll(/<Blob>\s*<Name>([^<]+)<\/Name>/g)) await this.call('DELETE', decodeXml(m[1]), {});
			marker = /<NextMarker>([^<]+)<\/NextMarker>/.exec(xml)?.[1];
		} while (marker);
	}
}

function decodeXml(s: string): string {
	return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
