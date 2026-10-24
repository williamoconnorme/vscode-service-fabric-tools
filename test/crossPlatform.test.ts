import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
	ACTOR_UNIX_FIX_TARGET,
	actorUnixFixTarget,
	addActorUnixFix,
	isNetFrameworkTfm,
	localClusterUnsupportedReason,
	needsActorUnixFix,
	targetFrameworksOf,
} from '../src/build/serviceProjects';
import { encryptForServiceFabric, loadEncryptionCertificate } from '../src/cluster/encryptSecret';
import { AzureBlobStore, BLOCK_BYTES, parseXstoreConnectionString, sharedKeyAuthorization, type BlobRequester } from '../src/deploy/azureBlobStore';
import { compressApplicationPackage, crc32, createZip } from '../src/deploy/packageCompression';
import { isImageStoreConnectionStringEncrypted } from '../src/deploy/restDeploy';
import { buildCsharpCsproj } from '../src/scaffold/addServiceTemplates';

// ---- unsupported setups -----------------------------------------------------------

test('localClusterUnsupportedReason: Windows x64 only', () => {
	assert.equal(localClusterUnsupportedReason('win32', 'x64'), undefined);
	assert.match(localClusterUnsupportedReason('win32', 'arm64')!, /Windows on ARM/);
	assert.match(localClusterUnsupportedReason('darwin', 'arm64')!, /On macOS, publish to a remote cluster/);
	assert.match(localClusterUnsupportedReason('linux', 'x64')!, /On Linux/);
});

test('targetFrameworksOf and isNetFrameworkTfm', () => {
	assert.deepEqual(targetFrameworksOf('<TargetFramework>net8.0</TargetFramework>'), ['net8.0']);
	assert.deepEqual(targetFrameworksOf('<TargetFrameworks>net48;net8.0</TargetFrameworks>'), ['net48', 'net8.0']);
	assert.deepEqual(targetFrameworksOf('<TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion>'), ['net472']);
	for (const t of ['net48', 'net472', 'net462', 'net4.8']) assert.equal(isNetFrameworkTfm(t), true, t);
	for (const t of ['net8.0', 'net10.0', 'netcoreapp3.1', 'netstandard2.0']) assert.equal(isNetFrameworkTfm(t), false, t);
});

// ---- actors on macOS / Linux --------------------------------------------------------

const ACTOR_CSPROJ = [
	'<Project Sdk="Microsoft.NET.Sdk">',
	'  <PropertyGroup>',
	'    <TargetFramework>net8.0</TargetFramework>',
	'    <UpdateServiceFabricManifestEnabled>True</UpdateServiceFabricManifestEnabled>',
	'  </PropertyGroup>',
	'</Project>',
	'',
].join('\r\n');

test('the actor fix writes valid FabActUtil runtimeconfig JSON once MSBuild expands it', () => {
	// The XML parser decodes &quot; before MSBuild sees the value.
	const lines = /Lines="([^"]+)"/.exec(actorUnixFixTarget())![1].replace(/&quot;/g, '"');
	assert.ok(!lines.includes(';'), 'no semicolons: WriteLinesToFile would split the line');
	const expanded = lines.replace('$(TargetFramework)', 'net8.0').replace('$(_TargetFrameworkVersionWithoutV)', '8.0');
	assert.deepEqual(JSON.parse(expanded), { runtimeOptions: { tfm: 'net8.0', framework: { name: 'Microsoft.NETCore.App', version: '8.0.0' } } });
	assert.match(actorUnixFixTarget(), /AfterTargets="_CopyAssembliesToFabActUtilWorkingDir" Condition=" '\$\(OS\)' != 'Windows_NT' "/);
});

test('addActorUnixFix patches actor projects once, keeping CRLF', () => {
	assert.equal(needsActorUnixFix(ACTOR_CSPROJ), true);
	const fixed = addActorUnixFix(ACTOR_CSPROJ);
	assert.ok(fixed.includes(ACTOR_UNIX_FIX_TARGET));
	assert.ok(fixed.endsWith('</Target>\r\n</Project>\r\n'));
	assert.ok(!/[^\r]\n/.test(fixed), 'only CRLF line endings');
	assert.equal(needsActorUnixFix(fixed), false);
	assert.equal(addActorUnixFix(fixed), fixed);
	assert.equal(needsActorUnixFix('<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'), false);
});

test('new .NET actor projects include the fix; .NET Framework ones and other kinds do not', () => {
	const t = { serviceName: 'Act', serviceTypeName: 'ActType', version: '1.0.0', targetFramework: 'net8.0' };
	assert.equal(needsActorUnixFix(buildCsharpCsproj({ ...t, kind: 'actor', runtime: 'netcore' })), false);
	assert.ok(buildCsharpCsproj({ ...t, kind: 'actor', runtime: 'netcore' }).includes(ACTOR_UNIX_FIX_TARGET));
	assert.ok(!buildCsharpCsproj({ ...t, kind: 'actor', runtime: 'netfx', targetFramework: 'net472' }).includes(ACTOR_UNIX_FIX_TARGET));
	assert.ok(!buildCsharpCsproj({ ...t, kind: 'stateless', runtime: 'netcore' }).includes(ACTOR_UNIX_FIX_TARGET));
});

// ---- secrets encryption ---------------------------------------------------------------

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

test('encryptForServiceFabric produces CMS that openssl decrypts to the UTF-16LE text', { skip: !hasOpenssl && 'openssl not available' }, () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-enc-'));
	try {
		const run = (...args: string[]) => {
			const r = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
			if (r.status !== 0) throw new Error(`openssl ${args.join(' ')}: ${r.stderr}`);
		};
		run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '2', '-subj', '/CN=sf-secrets');
		const cert = loadEncryptionCertificate(fs.readFileSync(path.join(dir, 'c.pem')));
		assert.match(cert.thumbprint, /^[0-9A-F]{40}$/);
		const secret = 'P@ss wörd ✓ "quoted"';
		fs.writeFileSync(path.join(dir, 'enc.der'), Buffer.from(encryptForServiceFabric(secret, cert), 'base64'));
		run('cms', '-decrypt', '-inform', 'DER', '-in', 'enc.der', '-inkey', 'k.pem', '-recip', 'c.pem', '-out', 'out.bin');
		assert.equal(fs.readFileSync(path.join(dir, 'out.bin')).toString('utf16le'), secret);
		// A DER (.cer) copy of the certificate loads too.
		run('x509', '-in', 'c.pem', '-outform', 'DER', '-out', 'c.cer');
		assert.equal(loadEncryptionCertificate(fs.readFileSync(path.join(dir, 'c.cer'))).thumbprint, cert.thumbprint);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('loadEncryptionCertificate rejects non-certificates', () => {
	assert.throws(() => loadEncryptionCertificate('not a cert'), /Not an X\.509 certificate/);
});

// ---- CompressPackage ----------------------------------------------------------------

/** Minimal zip reader for the tests: name → bytes, via the central directory. */
function readZip(zip: Buffer): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	const count = zip.readUInt16LE(end + 10);
	let p = zip.readUInt32LE(end + 16);
	for (let i = 0; i < count; i++) {
		const method = zip.readUInt16LE(p + 10);
		const crc = zip.readUInt32LE(p + 16);
		const size = zip.readUInt32LE(p + 20);
		const nameLen = zip.readUInt16LE(p + 28);
		const local = zip.readUInt32LE(p + 42);
		const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
		const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
		const raw = zip.subarray(dataStart, dataStart + size);
		const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
		assert.equal(crc32(data), crc, `CRC of ${name}`);
		out.set(name, data);
		p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
	}
	return out;
}

test('crc32 matches the standard check value', () => {
	assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('createZip round-trips stored and deflated entries', () => {
	const entries = [
		{ name: 'a.txt', data: Buffer.from('hello hello hello hello hello') },
		{ name: 'sub/b.bin', data: Buffer.from([1, 2, 3]) },
	];
	const files = readZip(createZip(entries));
	assert.deepEqual([...files.keys()], ['a.txt', 'sub/b.bin']);
	assert.equal(files.get('a.txt')!.toString(), 'hello hello hello hello hello');
	assert.deepEqual([...files.get('sub/b.bin')!], [1, 2, 3]);
	assert.deepEqual(createZip(entries), createZip(entries), 'reproducible');
});

test('compressApplicationPackage zips each package folder and keeps the manifests', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pkg-'));
	let out: string | undefined;
	try {
		fs.writeFileSync(path.join(root, 'ApplicationManifest.xml'), '<ApplicationManifest/>');
		fs.mkdirSync(path.join(root, 'WebPkg', 'Code', 'runtimes'), { recursive: true });
		fs.mkdirSync(path.join(root, 'WebPkg', 'Config'));
		fs.writeFileSync(path.join(root, 'WebPkg', 'ServiceManifest.xml'), '<ServiceManifest/>');
		fs.writeFileSync(path.join(root, 'WebPkg', 'Code', 'Web.dll'), 'binary');
		fs.writeFileSync(path.join(root, 'WebPkg', 'Code', 'runtimes', 'x.so'), 'native');
		fs.writeFileSync(path.join(root, 'WebPkg', 'Config', 'Settings.xml'), '<Settings/>');
		out = await compressApplicationPackage(root);
		assert.deepEqual(fs.readdirSync(out).sort(), ['ApplicationManifest.xml', 'WebPkg']);
		assert.deepEqual(fs.readdirSync(path.join(out, 'WebPkg')).sort(), ['Code.zip', 'Config.zip', 'ServiceManifest.xml']);
		const code = readZip(fs.readFileSync(path.join(out, 'WebPkg', 'Code.zip')));
		assert.deepEqual([...code.keys()], ['runtimes/x.so', 'Web.dll']);
		assert.equal(code.get('Web.dll')!.toString(), 'binary');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		if (out) fs.rmSync(out, { recursive: true, force: true });
	}
});

// ---- xstore: image stores --------------------------------------------------------------

const KEY = Buffer.from('test-key-0123456789').toString('base64');

test('parseXstoreConnectionString reads account, key (with = padding), container and endpoint', () => {
	const cfg = parseXstoreConnectionString(`xstore:DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=${KEY};Container=images`);
	assert.deepEqual(cfg, { accountName: 'acct', accountKey: KEY, container: 'images', blobEndpoint: 'https://acct.blob.core.windows.net' });
	assert.equal(
		parseXstoreConnectionString(`xstore:AccountName=a;AccountKey=${KEY};Container=c;EndpointSuffix=core.chinacloudapi.cn`).blobEndpoint,
		'https://a.blob.core.chinacloudapi.cn',
	);
	assert.throws(() => parseXstoreConnectionString('xstore:AccountName=a'), /AccountName, AccountKey and Container/);
});

test('sharedKeyAuthorization signs the documented string-to-sign', () => {
	const url = new URL('https://acct.blob.core.windows.net/images/App_1.0.0/Code%201/a.dll?comp=block&blockid=QUJD');
	const headers = { 'x-ms-version': '2021-08-06', 'x-ms-date': 'Sat, 24 Oct 2026 12:00:00 GMT', 'Content-Length': '5' };
	const expected = [
		'PUT', '', '', '5', '', '', '', '', '', '', '', '',
		'x-ms-date:Sat, 24 Oct 2026 12:00:00 GMT\nx-ms-version:2021-08-06\n/acct/images/App_1.0.0/Code%201/a.dll\nblockid:QUJD\ncomp:block',
	].join('\n');
	const sig = createHmac('sha256', Buffer.from(KEY, 'base64')).update(expected, 'utf8').digest('base64');
	assert.equal(sharedKeyAuthorization('PUT', url, headers, 5, 'acct', KEY), `SharedKey acct:${sig}`);
});

test('AzureBlobStore uploads small files whole, large files in blocks, and deletes by prefix', async () => {
	const calls: string[] = [];
	const send: BlobRequester = async (method, url, headers, body) => {
		assert.match(headers.Authorization, /^SharedKey acct:/);
		calls.push(`${method} ${url.pathname}${url.search} ${body?.length ?? 0}`);
		if (method === 'GET') {
			return url.searchParams.has('marker')
				? { status: 200, body: '<EnumerationResults><Blobs><Blob><Name>root/b</Name></Blob></Blobs><NextMarker/></EnumerationResults>' }
				: { status: 200, body: '<EnumerationResults><Blobs><Blob><Name>root/a</Name></Blob></Blobs><NextMarker>m1</NextMarker></EnumerationResults>' };
		}
		return { status: 201, body: '' };
	};
	const store = new AzureBlobStore(parseXstoreConnectionString(`xstore:AccountName=acct;AccountKey=${KEY};Container=c`), send);
	const read = async (start: number, end: number) => Buffer.alloc(end - start);
	await store.uploadBlob('root/small.txt', read, 10);
	await store.uploadBlob('root/big.bin', read, BLOCK_BYTES + 1);
	await store.deletePrefix('root');
	assert.equal(calls[0], 'PUT /c/root/small.txt 10');
	assert.match(calls[1], /^PUT \/c\/root\/big\.bin\?comp=block&blockid=.+ 8388608$/);
	assert.match(calls[2], /^PUT \/c\/root\/big\.bin\?comp=block&blockid=.+ 1$/);
	assert.match(calls[3], /^PUT \/c\/root\/big\.bin\?comp=blocklist \d+$/);
	assert.deepEqual(calls.slice(4).map((c) => c.replace(/ \d+$/, '')), [
		'GET /c?restype=container&comp=list&prefix=root%2F',
		'DELETE /c/root/a',
		'GET /c?restype=container&comp=list&prefix=root%2F&marker=m1',
		'DELETE /c/root/b',
	]);
});

test('AzureBlobStore reports storage errors with their code', async () => {
	const send: BlobRequester = async () => ({ status: 403, body: '<Error><Code>AuthenticationFailed</Code><Message>Server failed to authenticate.\nmore</Message></Error>' });
	const store = new AzureBlobStore(parseXstoreConnectionString(`xstore:AccountName=acct;AccountKey=${KEY};Container=c`), send);
	await assert.rejects(store.uploadBlob('x', async () => Buffer.alloc(1), 1), /HTTP 403 AuthenticationFailed \(Server failed to authenticate\.\)/);
});

test('isImageStoreConnectionStringEncrypted', () => {
	assert.equal(isImageStoreConnectionStringEncrypted('<Parameter Name="ImageStoreConnectionString" Value="MIIB..." IsEncrypted="true" />'), true);
	assert.equal(isImageStoreConnectionStringEncrypted('<Parameter Name="ImageStoreConnectionString" Value="fabric:ImageStore" />'), false);
});
