/**
 * Server-certificate pinning for Service Fabric HTTP gateways. Pure Node (no
 * `vscode` imports).
 *
 * Secured clusters usually present a self-signed cluster certificate, which
 * Node's default trust store rejects. Service Fabric tooling identifies that
 * certificate by its SHA-1 thumbprint (`ServerCertThumbprint` in publish
 * profiles and `Connect-ServiceFabricCluster`), so connections pin by
 * thumbprint instead of chain trust.
 */
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import type { ClientCertMaterial } from './clientCert';

/** A pinned gateway certificate. */
export interface ServerCertPin {
	/** Accepted SHA-1 thumbprints: uppercase hex, no separators. More than one during certificate rollover. */
	thumbprints: string[];
}

/** What a TLS probe learned about a gateway's certificate. */
export interface ServerCertInfo {
	/** SHA-1 thumbprint, uppercase hex without separators. */
	thumbprint: string;
	subject: string;
	issuer: string;
	validTo: string;
	/** True when the chain is trusted by Node's CA store and matches the host name. */
	trusted: boolean;
	/** Why the chain isn't trusted (e.g. `DEPTH_ZERO_SELF_SIGNED_CERT`); `undefined` when it is. */
	trustError?: string;
}

/** Normalizes a thumbprint typed by a user or read from XML: drops spaces/colons, uppercases. */
export function normalizeThumbprint(value: string): string {
	return value.replace(/[\s:]/g, '').toUpperCase();
}

/** Splits a `ServerCertThumbprint` attribute (comma-separated during rollover) into normalized thumbprints. */
export function parseThumbprintList(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map(normalizeThumbprint)
		.filter((t) => /^[0-9A-F]{40}$/.test(t));
}

function describeName(name: tls.PeerCertificate['subject'] | undefined): string {
	if (!name) return '';
	return Object.entries(name)
		.map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : v}`)
		.join(', ');
}

function thumbprintOf(cert: tls.PeerCertificate): string {
	return normalizeThumbprint(cert.fingerprint ?? '');
}

function connectOptions(host: string, port: number): tls.ConnectionOptions {
	return { host, port, rejectUnauthorized: false, ...(net.isIP(host) ? {} : { servername: host }) };
}

/** Opens a TLS connection to `endpoint` (no HTTP request is sent) and reports the server certificate. */
export function probeServerCertificate(endpoint: string, timeoutMs = 5000): Promise<ServerCertInfo> {
	const u = new URL(endpoint);
	const port = Number(u.port || 443);
	return new Promise((resolve, reject) => {
		const socket = tls.connect(connectOptions(u.hostname, port), () => {
			const cert = socket.getPeerCertificate();
			socket.end();
			if (!cert || !cert.fingerprint) {
				reject(new Error(`${u.host} did not present a TLS certificate.`));
				return;
			}
			const trustError = socket.authorized ? undefined : String(socket.authorizationError ?? 'untrusted');
			resolve({
				thumbprint: thumbprintOf(cert),
				subject: describeName(cert.subject),
				issuer: describeName(cert.issuer),
				validTo: cert.valid_to,
				trusted: socket.authorized && !trustError,
				trustError,
			});
		});
		socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`TLS handshake with ${u.host} timed out after ${timeoutMs}ms`)));
		socket.on('error', (err) => reject(new Error(`TLS connection to ${u.host} failed: ${err.message}`)));
	});
}

/**
 * An https agent that accepts a server certificate only if its thumbprint is
 * pinned. The check runs after the TLS handshake and before the socket is
 * handed to the request, so no request bytes (including bearer tokens) reach an
 * unpinned server. `clientCert`, when given, is presented to the gateway.
 */
export class PinnedCertAgent extends https.Agent {
	private readonly pinned: Set<string>;

	constructor(
		pin: ServerCertPin,
		private readonly clientCert?: ClientCertMaterial,
	) {
		super({ keepAlive: false });
		this.pinned = new Set(pin.thumbprints.map(normalizeThumbprint));
	}

	// Node's Agent accepts a socket either as the return value or via `callback`;
	// returning undefined makes it wait for the callback.
	createConnection(options: tls.ConnectionOptions, callback: (err: Error | null, socket?: net.Socket) => void): undefined {
		const host = String(options.host ?? 'localhost');
		const socket = tls.connect({ ...connectOptions(host, Number(options.port ?? 443)), ...this.clientCert, timeout: options.timeout });
		const onError = (err: Error): void => callback(err);
		socket.once('error', onError);
		socket.once('secureConnect', () => {
			socket.removeListener('error', onError);
			const thumbprint = thumbprintOf(socket.getPeerCertificate());
			if (!this.pinned.has(thumbprint)) {
				socket.destroy();
				callback(
					new Error(
						`The server certificate of ${host} (thumbprint ${thumbprint || 'none'}) doesn't match the pinned thumbprint${this.pinned.size > 1 ? 's' : ''} ${[...this.pinned].join(', ')}. Reconnect to the cluster to review the new certificate.`,
					),
				);
				return;
			}
			callback(null, socket);
		});
		return undefined;
	}
}
