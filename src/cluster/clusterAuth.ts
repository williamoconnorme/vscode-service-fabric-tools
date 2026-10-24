import * as vscode from 'vscode';
import * as https from 'https';
import type { ClusterConnection } from './connectionStore';
import { SfAuthError, SfRestClient, type AadMetadata } from './sfRestClient';
import { PinnedCertAgent, probeServerCertificate, type ServerCertPin } from './tlsPinning';
import type { ClientCertMaterial, ClientCertRef } from './clientCert';
import { getClientCertManager, type ClientCertCriteria, type LoadedClientCert } from './clientCertStore';
import { getAzureCliToken } from './azureCliToken';
import type { Logger } from '../util/logger';

/** Microsoft Entra ID settings for a cluster, taken from its `/$/GetAadMetadata`. */
export interface EntraClusterAuth extends AadMetadata {
	type: 'entra';
}

/** A cluster's security settings as stored on its {@link ClusterConnection}. */
export interface ClusterSecurity {
	auth?: EntraClusterAuth;
	serverCert?: ServerCertPin;
	/** X.509 client certificate presented to the gateway. The passphrase lives in SecretStorage. */
	clientCert?: ClientCertRef;
}

/**
 * The client application ID to sign in with, from `serviceFabric.entra.clientId`:
 * empty means VS Code's own Microsoft sign-in, `cluster` means the client app
 * registered in the cluster's Entra configuration, anything else is used as is.
 */
function signInClientId(auth: AadMetadata): string | undefined {
	const setting = (vscode.workspace.getConfiguration('serviceFabric').get<string>('entra.clientId') ?? '').trim();
	if (!setting) return undefined;
	if (setting.toLowerCase() === 'cluster') return auth.clientApplicationId || undefined;
	return setting;
}

function entraScopes(auth: AadMetadata): string[] {
	const scopes = [`${auth.clusterApplicationId}/.default`, `VSCODE_TENANT:${auth.tenantId}`];
	const clientId = signInClientId(auth);
	if (clientId) scopes.push(`VSCODE_CLIENT_ID:${clientId}`);
	return scopes;
}

/**
 * Gets an Entra ID access token for the cluster. Tries the Azure CLI's login
 * first (when `serviceFabric.entra.useAzureCli` is on), then VS Code's Microsoft
 * authentication provider. With `interactive`, the latter prompts the user to
 * sign in when needed; otherwise it only uses an existing session and throws if
 * there is none.
 */
export async function getEntraAccessToken(auth: AadMetadata, interactive: boolean, logger?: Logger): Promise<string> {
	if (vscode.workspace.getConfiguration('serviceFabric').get<boolean>('entra.useAzureCli') ?? true) {
		try {
			const token = await getAzureCliToken(auth.clusterApplicationId, auth.tenantId);
			logger?.info(`Using Azure CLI token for cluster app ${auth.clusterApplicationId}.`);
			return token.accessToken;
		} catch (err) {
			logger?.info(`Azure CLI token unavailable, falling back to VS Code sign-in: ${(err as Error).message}`);
		}
	}
	const scopes = entraScopes(auth);
	const session = interactive
		? await vscode.authentication.getSession('microsoft', scopes, { createIfNone: true })
		: await vscode.authentication.getSession('microsoft', scopes, { silent: true });
	if (!session) {
		throw new Error(
			'Sign-in to Microsoft Entra ID is required. Run "Service Fabric: Connect to Remote Cluster" for this cluster to sign in again.',
		);
	}
	return session.accessToken;
}

/** Options for {@link createClusterClient}. */
export interface ClusterClientOptions {
	/** Whether a missing sign-in or passphrase prompts the user (commands) or fails quietly (background refreshes). */
	interactive?: boolean;
	/** Already-loaded client certificate material, used instead of loading `security.clientCert`. */
	clientCertMaterial?: ClientCertMaterial;
}

function buildAgent(serverCert: ServerCertPin | undefined, clientCert: ClientCertMaterial | undefined): https.Agent | undefined {
	if (serverCert && serverCert.thumbprints.length > 0) return new PinnedCertAgent(serverCert, clientCert);
	// Chain-trusted gateway: normal verification, but still present the client certificate.
	return clientCert ? new https.Agent({ keepAlive: false, ...clientCert }) : undefined;
}

/**
 * Builds a REST client for a cluster with its pinned certificate, client
 * certificate and Entra ID token applied. A client certificate is loaded on the
 * first request (its passphrase comes from SecretStorage), so callers don't
 * need to await anything here.
 */
export function createClusterClient(endpoint: string, security: ClusterSecurity = {}, opts: ClusterClientOptions = {}): SfRestClient {
	const { auth, serverCert, clientCert } = security;
	let agent: https.Agent | (() => Promise<https.Agent | undefined>) | undefined;
	if (opts.clientCertMaterial) agent = buildAgent(serverCert, opts.clientCertMaterial);
	else if (clientCert)
		agent = async () => buildAgent(serverCert, await getClientCertManager().getMaterial(clientCert, opts.interactive ?? false));
	else agent = buildAgent(serverCert, undefined);
	return new SfRestClient(endpoint, {
		agent,
		getAccessToken: auth ? () => getEntraAccessToken(auth, opts.interactive ?? false) : undefined,
	});
}

/** {@link createClusterClient} for a saved connection. */
export function createClientForConnection(conn: ClusterConnection, opts: ClusterClientOptions = {}): SfRestClient {
	return createClusterClient(conn.endpoint, securityOf(conn), opts);
}

/** The {@link ClusterSecurity} fields of a saved connection. */
export function securityOf(conn: ClusterConnection): ClusterSecurity {
	return { auth: conn.auth, serverCert: conn.serverCert, clientCert: conn.clientCert };
}

/** Options for {@link configureClusterSecurity}. */
export interface ConfigureSecurityOptions {
	/** Server thumbprints (e.g. from a publish profile) accepted without prompting. */
	knownThumbprints?: string[];
	/** The publish profile's client certificate criteria, when it sets `X509Credential="true"`. */
	clientCertCriteria?: ClientCertCriteria;
	/** A previously saved client certificate to try first. */
	savedClientCert?: ClientCertRef;
}

/** Probes the gateway with a client certificate; `true` on success, `false` on 401/403. Other failures throw. */
async function probeWithClientCert(endpoint: string, security: ClusterSecurity, cert: LoadedClientCert | undefined): Promise<boolean> {
	try {
		await createClusterClient(endpoint, { ...security, clientCert: undefined }, { clientCertMaterial: cert?.material }).getClusterHealth(
			10000,
		);
		return true;
	} catch (err) {
		if (err instanceof SfAuthError) return false;
		throw err;
	}
}

/**
 * Finds a client certificate the gateway accepts: the saved or profile-mapped
 * one first, then the user's pick, re-prompting after each 403. Saves the
 * passphrase of the accepted certificate. `undefined` when the user cancels.
 */
export async function chooseClientCertificate(
	endpoint: string,
	security: ClusterSecurity,
	logger: Logger,
	opts: { criteria?: ClientCertCriteria; saved?: ClientCertRef; reason?: string; pickImmediately?: boolean } = {},
): Promise<ClientCertRef | undefined> {
	const manager = getClientCertManager();
	let candidate: LoadedClientCert | undefined =
		opts.criteria || opts.saved ? await manager.resolveForProfile(opts.criteria ?? {}, opts.saved) : undefined;
	if (!candidate && opts.pickImmediately) {
		candidate = await manager.pick(`Client certificate for ${new URL(endpoint).host}`);
		if (!candidate) return undefined;
	}
	if (!candidate) {
		const reason = opts.reason ?? `${new URL(endpoint).host} requires a client certificate.`;
		const choice = await vscode.window.showWarningMessage(
			reason,
			{ modal: true, detail: 'Select a PFX/P12 file or a PEM certificate (with its private key) that has access to this cluster.' },
			'Select Certificate…',
		);
		if (choice !== 'Select Certificate…') return undefined;
		candidate = await manager.pick(`Client certificate for ${new URL(endpoint).host}`);
	}
	while (candidate) {
		logger.info(`Trying client certificate ${candidate.ref.path} (thumbprint ${candidate.info.thumbprint}, ${candidate.info.subject}).`);
		if (await probeWithClientCert(endpoint, security, candidate)) {
			await manager.remember(candidate);
			logger.info(`Cluster accepted client certificate ${candidate.info.thumbprint}.`);
			return candidate.ref;
		}
		logger.warn(`Cluster rejected client certificate ${candidate.info.thumbprint} (HTTP 403).`);
		const retry = await vscode.window.showErrorMessage(
			`The cluster rejected the client certificate ${candidate.info.thumbprint} (CN=${candidate.info.subjectCommonName}). It may not be registered as an admin or read-only client certificate on this cluster.`,
			{ modal: true },
			'Select Another…',
		);
		candidate = retry === 'Select Another…' ? await manager.pick(`Client certificate for ${new URL(endpoint).host}`) : undefined;
	}
	return undefined;
}

/**
 * Works out how to talk to a remote cluster before it is saved: offers to pin an
 * untrusted (typically self-signed) server certificate, then detects Entra ID
 * and signs in. `knownThumbprints` (e.g. from a publish profile) are accepted
 * without prompting. Returns `undefined` if the user cancels.
 */
export async function configureClusterSecurity(
	endpoint: string,
	logger: Logger,
	options: ConfigureSecurityOptions = {},
): Promise<ClusterSecurity | undefined> {
	const knownThumbprints = options.knownThumbprints ?? [];
	const security: ClusterSecurity = {};
	if (new URL(endpoint).protocol === 'https:') {
		const cert = await probeServerCertificate(endpoint);
		logger.info(`Gateway certificate: ${cert.subject} (thumbprint ${cert.thumbprint}, trusted=${cert.trusted})`);
		if (knownThumbprints.includes(cert.thumbprint)) {
			security.serverCert = { thumbprints: knownThumbprints };
		} else if (cert.trusted) {
			// Chain-trusted: no pin needed for REST, but PowerShell's Entra ID sign-in still needs the thumbprint.
			security.serverCert = { thumbprints: [cert.thumbprint] };
		} else {
			const choice = await vscode.window.showWarningMessage(
				`The cluster's certificate isn't trusted by this machine (${cert.trustError}). Service Fabric clusters often use self-signed certificates. Trust this certificate for this cluster?`,
				{
					modal: true,
					detail: `Subject: ${cert.subject}\nIssuer: ${cert.issuer}\nExpires: ${cert.validTo}\nThumbprint: ${cert.thumbprint}\n\nCompare the thumbprint with your cluster's certificate before trusting it.`,
				},
				'Trust Certificate',
			);
			if (choice !== 'Trust Certificate') return undefined;
			security.serverCert = { thumbprints: [cert.thumbprint] };
		}
	}
	const metadata = await createClusterClient(endpoint, security)
		.getAadMetadata()
		.catch((err: Error) => {
			// Clusters without Entra ID answer 404 or a non-aad type (certificate-secured
			// ones may also refuse it outright); only surface real transport failures.
			if (/HTTP 404/.test(err.message) || err instanceof SfAuthError) return undefined;
			throw err;
		});
	if (metadata) {
		if (!security.serverCert) {
			throw new Error('This cluster uses Microsoft Entra ID, which requires an https:// endpoint.');
		}
		security.auth = { type: 'entra', ...metadata };
		logger.info(`Cluster uses Microsoft Entra ID (tenant ${metadata.tenantId}, cluster app ${metadata.clusterApplicationId}).`);
		await getEntraAccessToken(security.auth, true, logger);
		return security;
	}
	if (!security.serverCert) return security;
	// No Entra ID: a 401/403 on a plain read means the gateway wants an X.509 client certificate.
	let needsClientCert = Boolean(options.clientCertCriteria);
	if (!needsClientCert) {
		try {
			await createClusterClient(endpoint, security).getClusterHealth(10000);
		} catch (err) {
			if (err instanceof SfAuthError) needsClientCert = true;
			else logger.warn(`Cluster health probe failed: ${(err as Error).message}`);
		}
	}
	if (needsClientCert) {
		logger.info('Cluster requires an X.509 client certificate.');
		const clientCert = await chooseClientCertificate(endpoint, security, logger, {
			criteria: options.clientCertCriteria,
			saved: options.savedClientCert,
		});
		if (!clientCert) return undefined;
		security.clientCert = clientCert;
	}
	return security;
}
