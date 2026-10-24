/**
 * X.509 client certificates for Service Fabric HTTP gateways, loaded from
 * files (PFX/PKCS#12 or PEM). Pure Node (no `vscode` imports).
 *
 * Certificate-secured clusters authenticate admin clients by the TLS client
 * certificate. On Windows the SDK reads it from the certificate store; here it
 * comes from a file so the same flow works on macOS and Linux. Only the path
 * and thumbprint are persisted; passphrases live in VS Code's SecretStorage.
 */
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as tls from 'tls';
import { X509Certificate } from 'crypto';
import { normalizeThumbprint } from './tlsPinning';

/** A client certificate loaded from a file (PFX or PEM). Never holds the passphrase. */
export interface ClientCertRef {
	/** Absolute path to a .pfx/.p12, or to a PEM file containing the cert (and optionally the key). */
	path: string;
	/** For PEM: separate private-key file, when the cert file has no key. */
	keyPath?: string;
	/** SHA-1 thumbprint of the leaf, computed at load time; shown in the UI and matched against publish profiles. */
	thumbprint: string;
	/** True when a passphrase is stored in SecretStorage under {@link passphraseSecretKey}. */
	hasPassphrase: boolean;
}

/** TLS options for presenting a client certificate, ready to spread into `tls.connect`. */
export interface ClientCertMaterial {
	pfx?: Buffer;
	cert?: Buffer;
	key?: Buffer;
	passphrase?: string;
}

/** What {@link inspectClientCert} learned about a certificate file. */
export interface ClientCertInfo {
	/** SHA-1 thumbprint, uppercase hex without separators. */
	thumbprint: string;
	subject: string;
	/** Subject common name, matched against `FindBySubjectName` in publish profiles. */
	subjectCommonName: string;
	validTo: string;
}

/** SecretStorage key holding the passphrase for a client certificate. */
export function passphraseSecretKey(thumbprint: string): string {
	return `serviceFabric.clientCert.${normalizeThumbprint(thumbprint)}`;
}

/** True for `.pfx` / `.p12` files; everything else is treated as PEM. */
export function isPfxPath(file: string): boolean {
	return /\.(pfx|p12)$/i.test(file);
}

/** Expands a leading `~` to the home directory (settings often use `~/certs/...`). */
export function expandHome(file: string): string {
	if (file === '~') return os.homedir();
	if (file.startsWith('~/') || file.startsWith('~\\')) return path.join(os.homedir(), file.slice(2));
	return file;
}

/**
 * Reads a certificate file and validates it by building a throwaway TLS
 * context, so a wrong passphrase or unsupported format fails here with a clear
 * message instead of mid-handshake.
 */
export async function loadClientCert(ref: Pick<ClientCertRef, 'path' | 'keyPath'>, passphrase?: string): Promise<ClientCertMaterial> {
	const file = expandHome(ref.path);
	const data = await readCertFile(file);
	let material: ClientCertMaterial;
	if (isPfxPath(file)) {
		material = { pfx: data };
	} else {
		const key = ref.keyPath ? await readCertFile(expandHome(ref.keyPath)) : data;
		if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key.toString('utf8'))) {
			throw new Error(
				`${ref.keyPath ? path.basename(ref.keyPath) : path.basename(file)} contains no PEM private key. Pick the key file as well, or use a .pfx that includes the key.`,
			);
		}
		material = { cert: data, key };
	}
	if (passphrase) material.passphrase = passphrase;
	createContext(material, file);
	return material;
}

/** Loads a certificate file and reports its thumbprint and subject. */
export async function inspectClientCert(
	ref: Pick<ClientCertRef, 'path' | 'keyPath'>,
	passphrase?: string,
): Promise<{ info: ClientCertInfo; material: ClientCertMaterial }> {
	const material = await loadClientCert(ref, passphrase);
	const der = material.pfx ? leafFromPfx(material, ref.path) : material.cert!;
	let x509: X509Certificate;
	try {
		x509 = new X509Certificate(der);
	} catch (err) {
		throw new Error(`Couldn't read the certificate in ${path.basename(ref.path)}: ${(err as Error).message}`);
	}
	return {
		info: {
			thumbprint: normalizeThumbprint(x509.fingerprint),
			subject: x509.subject.replace(/\n/g, ', '),
			subjectCommonName: /(?:^|\n)CN=([^\n]*)/.exec(x509.subject)?.[1] ?? '',
			validTo: x509.validTo,
		},
		material,
	};
}

/** True when a loaded certificate satisfies a publish profile's `FindType` / `FindValue`. */
export function matchesFindCriteria(info: ClientCertInfo, findType: string | undefined, findValue: string | undefined): boolean {
	if (!findValue) return false;
	if (/^FindBySubjectName$/i.test(findType ?? '')) {
		const wanted = findValue.replace(/^CN=/i, '').trim().toLowerCase();
		return info.subjectCommonName.toLowerCase() === wanted;
	}
	return normalizeThumbprint(findValue) === info.thumbprint;
}

async function readCertFile(file: string): Promise<Buffer> {
	try {
		return await fsp.readFile(file);
	} catch (err) {
		throw new Error(`Couldn't read certificate file ${file}: ${(err as Error).message}`);
	}
}

function createContext(material: ClientCertMaterial, file: string): tls.SecureContext {
	try {
		return tls.createSecureContext(material);
	} catch (err) {
		throw describeLoadError(err as Error & { code?: string }, file, Boolean(material.passphrase));
	}
}

// `SecureContext.context.getCertificate()` isn't in the typings, but it is
// how Node exposes the leaf certificate a PFX was loaded with.
function leafFromPfx(material: ClientCertMaterial, file: string): Buffer {
	const ctx = createContext(material, file) as tls.SecureContext & { context?: { getCertificate?: () => Buffer | null } };
	const der = ctx.context?.getCertificate?.();
	if (!der) throw new Error(`${path.basename(file)} doesn't contain a certificate this version of Node can read.`);
	return der;
}

/** Turns OpenSSL's terse errors into something a user can act on. */
export function describeLoadError(err: Error & { code?: string }, file: string, hadPassphrase: boolean): Error {
	const name = path.basename(file);
	const message = err.message ?? '';
	if (/mac verify failure|bad decrypt|wrong password/i.test(message)) {
		return new Error(hadPassphrase ? `Wrong passphrase for ${name}.` : `${name} is protected by a passphrase.`);
	}
	if (/Unsupported PKCS12|unsupported/i.test(message) || err.code === 'ERR_CRYPTO_UNSUPPORTED_OPERATION') {
		return new Error(
			`${name} uses legacy encryption (RC2/3DES) that this version of Node can't read. Re-export it with AES, e.g. ` +
				'`openssl pkcs12 -export -in cert.pem -inkey key.pem -out cert.pfx -keypbe AES-256-CBC -certpbe AES-256-CBC`.',
		);
	}
	if (/wrong tag|not enough data|asn1/i.test(message)) {
		return new Error(`${name} isn't a valid PFX/PKCS#12 file. Use a .pem file for PEM certificates.`);
	}
	if (/key values mismatch/i.test(message)) {
		return new Error(`The private key doesn't belong to the certificate in ${name}.`);
	}
	return new Error(`Couldn't load the client certificate ${name}: ${message}`);
}
