/**
 * Encrypts application parameter / setting values for Service Fabric's
 * `IsEncrypted="true"` and `PasswordEncrypted="true"`, the way
 * `Invoke-ServiceFabricEncryptText` (Windows) and the documented
 * `openssl smime -encrypt` recipe (Linux) do: the text as UTF-16LE, in a CMS
 * EnvelopedData (PKCS#7) for the certificate's RSA key, AES-256-CBC, DER,
 * base64. The cluster decrypts it with the certificate's private key, so only
 * the public certificate is needed here. Pure Node (no `vscode` imports, no
 * dependencies).
 */
import * as crypto from 'crypto';

/** A DER element: tag byte, and the offsets of its content and of the whole element. */
interface Der {
	tag: number;
	start: number;
	contentStart: number;
	end: number;
}

function readDer(buf: Buffer, offset: number): Der {
	const tag = buf[offset];
	let len = buf[offset + 1];
	let p = offset + 2;
	if (len & 0x80) {
		const n = len & 0x7f;
		if (n === 0 || n > 4) throw new Error('Unsupported DER length in certificate.');
		len = 0;
		for (let i = 0; i < n; i++) len = len * 256 + buf[p++];
	}
	if (p + len > buf.length) throw new Error('Truncated certificate.');
	return { tag, start: offset, contentStart: p, end: p + len };
}

function children(buf: Buffer, el: Der): Der[] {
	const out: Der[] = [];
	for (let p = el.contentStart; p < el.end; ) {
		const c = readDer(buf, p);
		out.push(c);
		p = c.end;
	}
	return out;
}

function derLength(n: number): Buffer {
	if (n < 0x80) return Buffer.from([n]);
	const bytes: number[] = [];
	for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
	return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, ...content: Buffer[]): Buffer {
	const body = Buffer.concat(content);
	return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const seq = (...c: Buffer[]): Buffer => tlv(0x30, ...c);
const set = (...c: Buffer[]): Buffer => tlv(0x31, ...c);
const int = (n: number): Buffer => tlv(0x02, Buffer.from([n]));
const octets = (b: Buffer): Buffer => tlv(0x04, b);
const NULL = Buffer.from([0x05, 0x00]);

function oid(dotted: string): Buffer {
	const parts = dotted.split('.').map(Number);
	const bytes = [parts[0] * 40 + parts[1]];
	for (const part of parts.slice(2)) {
		const enc: number[] = [];
		let v = part;
		do {
			enc.unshift((v & 0x7f) | (enc.length ? 0x80 : 0));
			v = Math.floor(v / 128);
		} while (v > 0);
		bytes.push(...enc);
	}
	return tlv(0x06, Buffer.from(bytes));
}

const OID_ENVELOPED_DATA = '1.2.840.113549.1.7.3';
const OID_DATA = '1.2.840.113549.1.7.1';
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const OID_AES256_CBC = '2.16.840.1.101.3.4.1.42';

/** What {@link loadEncryptionCertificate} found. */
export interface EncryptionCertificate {
	certificate: crypto.X509Certificate;
	/** Upper-case SHA-1 thumbprint, as Service Fabric shows it. */
	thumbprint: string;
	subject: string;
	validTo: string;
}

/** Reads a public certificate (PEM `.pem`/`.crt`/`.cer`, or DER `.cer`). Throws for non-RSA keys, which Service Fabric can't use. */
export function loadEncryptionCertificate(data: Buffer | string): EncryptionCertificate {
	let certificate: crypto.X509Certificate;
	try {
		certificate = new crypto.X509Certificate(data);
	} catch (err) {
		throw new Error(`Not an X.509 certificate (PEM or DER): ${(err as Error).message}`);
	}
	if (certificate.publicKey.asymmetricKeyType !== 'rsa') {
		throw new Error(`The certificate has a ${certificate.publicKey.asymmetricKeyType} key; Service Fabric encryption needs an RSA certificate.`);
	}
	return {
		certificate,
		thumbprint: certificate.fingerprint.replace(/:/g, '').toUpperCase(),
		subject: certificate.subject.replace(/\n/g, ', '),
		validTo: certificate.validTo,
	};
}

/** The raw issuer Name and serialNumber INTEGER from a certificate's TBSCertificate. */
function issuerAndSerial(certDer: Buffer): Buffer {
	const cert = readDer(certDer, 0);
	const tbs = children(certDer, cert)[0];
	const fields = children(certDer, tbs);
	// TBSCertificate: [0] version (optional), serialNumber, signature, issuer, …
	const i = fields[0].tag === 0xa0 ? 1 : 0;
	const serial = fields[i];
	const issuer = fields[i + 2];
	return seq(certDer.subarray(issuer.start, issuer.end), certDer.subarray(serial.start, serial.end));
}

/** Encrypts `text` for the certificate; returns the base64 value for a parameter or setting. */
export function encryptForServiceFabric(text: string, cert: EncryptionCertificate): string {
	const key = crypto.randomBytes(32);
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
	const encryptedContent = Buffer.concat([cipher.update(Buffer.from(text, 'utf16le')), cipher.final()]);
	const encryptedKey = crypto.publicEncrypt({ key: cert.certificate.publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, key);
	const recipient = seq(int(0), issuerAndSerial(cert.certificate.raw), seq(oid(OID_RSA_ENCRYPTION), NULL), octets(encryptedKey));
	const encryptedContentInfo = seq(oid(OID_DATA), seq(oid(OID_AES256_CBC), octets(iv)), tlv(0x80, encryptedContent));
	const envelopedData = seq(int(0), set(recipient), encryptedContentInfo);
	return seq(oid(OID_ENVELOPED_DATA), tlv(0xa0, envelopedData)).toString('base64');
}
