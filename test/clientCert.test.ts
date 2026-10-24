import { test, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { spawnSync } from 'node:child_process';
import { inspectClientCert, matchesFindCriteria } from '../src/cluster/clientCert';
import { PinnedCertAgent, probeServerCertificate } from '../src/cluster/tlsPinning';
import { SfAuthError, SfRestClient } from '../src/cluster/sfRestClient';

// Fixtures are generated with openssl at test time; the suite skips without it.
const hasOpenssl = spawnSync('openssl', ['version']).status === 0;
let dir = '';

function openssl(...args: string[]): void {
	const r = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`openssl ${args.join(' ')} failed: ${r.stderr}`);
}

function selfSigned(name: string, cn: string): void {
	openssl(
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-keyout',
		`${name}.key`,
		'-out',
		`${name}.crt`,
		'-days',
		'2',
		'-subj',
		`/CN=${cn}`,
	);
}

function sha1(name: string): string {
	const r = spawnSync('openssl', ['x509', '-in', `${name}.crt`, '-noout', '-fingerprint', '-sha1'], { cwd: dir, encoding: 'utf8' });
	return r.stdout.split('=')[1].trim().replace(/:/g, '');
}

before(() => {
	if (!hasOpenssl) return;
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-clientcert-'));
	selfSigned('server', 'localhost');
	selfSigned('admin', 'sf-admin');
	selfSigned('other', 'someone-else');
	fs.writeFileSync(
		path.join(dir, 'admin-combined.pem'),
		fs.readFileSync(path.join(dir, 'admin.crt')) + '\n' + fs.readFileSync(path.join(dir, 'admin.key')),
	);
	const pbe = ['-keypbe', 'AES-256-CBC', '-certpbe', 'AES-256-CBC'];
	openssl('pkcs12', '-export', '-in', 'admin.crt', '-inkey', 'admin.key', '-out', 'admin.pfx', '-passout', 'pass:s3cret', ...pbe);
	openssl('pkcs12', '-export', '-in', 'admin.crt', '-inkey', 'admin.key', '-out', 'admin-nopass.pfx', '-passout', 'pass:', ...pbe);
	openssl('pkcs12', '-export', '-in', 'other.crt', '-inkey', 'other.key', '-out', 'other.pfx', '-passout', 'pass:', ...pbe);
});

after(() => {
	if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const file = (name: string): string => path.join(dir, name);

test('inspectClientCert: PEM with key in the same file or a separate key file', { skip: !hasOpenssl }, async () => {
	const combined = await inspectClientCert({ path: file('admin-combined.pem') });
	assert.equal(combined.info.thumbprint, sha1('admin'));
	assert.equal(combined.info.subjectCommonName, 'sf-admin');
	const separate = await inspectClientCert({ path: file('admin.crt'), keyPath: file('admin.key') });
	assert.equal(separate.info.thumbprint, sha1('admin'));
	await assert.rejects(inspectClientCert({ path: file('admin.crt') }), /contains no PEM private key/);
});

test('inspectClientCert: PFX with and without a passphrase', { skip: !hasOpenssl }, async () => {
	const { info, material } = await inspectClientCert({ path: file('admin.pfx') }, 's3cret');
	assert.equal(info.thumbprint, sha1('admin'));
	assert.equal(material.passphrase, 's3cret');
	assert.ok(material.pfx);
	await assert.rejects(inspectClientCert({ path: file('admin.pfx') }, 'wrong'), /Wrong passphrase/);
	await assert.rejects(inspectClientCert({ path: file('admin.pfx') }), /protected by a passphrase/);
	assert.equal((await inspectClientCert({ path: file('admin-nopass.pfx') })).info.thumbprint, sha1('admin'));
});

test('matchesFindCriteria: thumbprint and subject name', { skip: !hasOpenssl }, async () => {
	const { info } = await inspectClientCert({ path: file('admin-combined.pem') });
	const spaced = info.thumbprint.match(/../g)!.join(' ').toLowerCase();
	assert.equal(matchesFindCriteria(info, 'FindByThumbprint', spaced), true);
	assert.equal(matchesFindCriteria(info, undefined, info.thumbprint), true);
	assert.equal(matchesFindCriteria(info, 'FindBySubjectName', 'CN=sf-admin'), true);
	assert.equal(matchesFindCriteria(info, 'FindBySubjectName', 'sf-admin'), true);
	assert.equal(matchesFindCriteria(info, 'FindBySubjectName', 'other'), false);
	assert.equal(matchesFindCriteria(info, 'FindByThumbprint', undefined), false);
});

test('SfRestClient presents the client certificate through the pinned agent', { skip: !hasOpenssl }, async () => {
	const adminThumbprint = sha1('admin');
	// A gateway that answers 403 unless the admin certificate is presented, like Service Fabric.
	const server = https.createServer(
		{ key: fs.readFileSync(file('server.key')), cert: fs.readFileSync(file('server.crt')), requestCert: true, rejectUnauthorized: false },
		(req, res) => {
			const peer = (req.socket as TLSSocket).getPeerCertificate();
			const thumbprint = (peer?.fingerprint ?? '').replace(/:/g, '');
			res.writeHead(thumbprint === adminThumbprint ? 200 : 403, { 'Content-Type': 'application/json' });
			res.end(thumbprint === adminThumbprint ? JSON.stringify({ AggregatedHealthState: 'Ok' }) : '');
		},
	);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		const endpoint = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const pin = { thumbprints: [(await probeServerCertificate(endpoint)).thumbprint] };

		const { material } = await inspectClientCert({ path: file('admin.pfx') }, 's3cret');
		const ok = new SfRestClient(endpoint, { agent: new PinnedCertAgent(pin, material) });
		assert.deepEqual(await ok.getClusterHealth(), { aggregatedHealthState: 'Ok' });

		// Lazy agents (how saved connections load the passphrase) are resolved once.
		let loads = 0;
		const lazy = new SfRestClient(endpoint, {
			agent: async () => {
				loads++;
				return new PinnedCertAgent(pin, material);
			},
		});
		await lazy.getClusterHealth();
		await lazy.getClusterHealth();
		assert.equal(loads, 1);

		const wrong = (await inspectClientCert({ path: file('other.pfx') })).material;
		await assert.rejects(new SfRestClient(endpoint, { agent: new PinnedCertAgent(pin, wrong) }).getClusterHealth(), SfAuthError);
		await assert.rejects(new SfRestClient(endpoint, { agent: new PinnedCertAgent(pin) }).getClusterHealth(), SfAuthError);
	} finally {
		server.close();
	}
});
