import * as vscode from 'vscode';
import type { ClusterConnection } from './connectionStore';
import { SfRestClient, type AadMetadata } from './sfRestClient';
import { PinnedCertAgent, probeServerCertificate, type ServerCertPin } from './tlsPinning';
import type { Logger } from '../util/logger';

/** Microsoft Entra ID settings for a cluster, taken from its `/$/GetAadMetadata`. */
export interface EntraClusterAuth extends AadMetadata {
	type: 'entra';
}

/** A cluster's security settings as stored on its {@link ClusterConnection}. */
export interface ClusterSecurity {
	auth?: EntraClusterAuth;
	serverCert?: ServerCertPin;
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
 * Gets an Entra ID access token for the cluster through VS Code's Microsoft
 * authentication provider. With `interactive`, prompts the user to sign in when
 * needed; otherwise only uses an existing session and throws if there is none.
 */
export async function getEntraAccessToken(auth: AadMetadata, interactive: boolean): Promise<string> {
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

/**
 * Builds a REST client for a cluster with its pinned certificate and Entra ID
 * token applied. `interactive` controls whether a missing sign-in prompts the
 * user (commands) or fails quietly (background refreshes).
 */
export function createClusterClient(endpoint: string, security: ClusterSecurity = {}, opts: { interactive?: boolean } = {}): SfRestClient {
	const { auth, serverCert } = security;
	return new SfRestClient(endpoint, {
		agent: serverCert && serverCert.thumbprints.length > 0 ? new PinnedCertAgent(serverCert) : undefined,
		getAccessToken: auth ? () => getEntraAccessToken(auth, opts.interactive ?? false) : undefined,
	});
}

/** {@link createClusterClient} for a saved connection. */
export function createClientForConnection(conn: ClusterConnection, opts: { interactive?: boolean } = {}): SfRestClient {
	return createClusterClient(conn.endpoint, { auth: conn.auth, serverCert: conn.serverCert }, opts);
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
	knownThumbprints: string[] = [],
): Promise<ClusterSecurity | undefined> {
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
			// Clusters without Entra ID answer 404 or a non-aad type; only surface real transport failures.
			if (/HTTP 404/.test(err.message)) return undefined;
			throw err;
		});
	if (metadata) {
		if (!security.serverCert) {
			throw new Error('This cluster uses Microsoft Entra ID, which requires an https:// endpoint.');
		}
		security.auth = { type: 'entra', ...metadata };
		logger.info(`Cluster uses Microsoft Entra ID (tenant ${metadata.tenantId}, cluster app ${metadata.clusterApplicationId}).`);
		await getEntraAccessToken(security.auth, true);
	}
	return security;
}
