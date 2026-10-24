import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

/** Result of `SfRestClient.getClusterHealth`. */
export interface ClusterHealthSummary {
	/** `Ok` / `Warning` / `Error` / `Unknown` as reported by the gateway (`Unknown` when absent). */
	aggregatedHealthState: string;
}

/** A cluster node as returned by `SfRestClient.getNodes`. */
export interface ClusterNodeInfo {
	name: string;
	status: string;
	healthState: string;
	nodeType: string;
}

/**
 * A deployed application as returned by `SfRestClient.getDeployedApplications`.
 * `name` has its `fabric:/` prefix stripped.
 */
export interface DeployedApplicationInfo {
	name: string;
	typeName: string;
	typeVersion: string;
	status: string;
}

/** A service of a deployed application as returned by `SfRestClient.listServices`. */
export interface ServiceSummary {
	/** URL-encoded service `Id`, ready to splice into partition lookups. */
	id: string;
	manifestName: string;
}

/** A replica/instance as returned by `SfRestClient.listReplicas`. */
export interface ReplicaSummary {
	replicaStatus: string;
	nodeName: string;
}

/** A deployed code package as returned by `SfRestClient.getDeployedCodePackages`. */
export interface DeployedCodePackageInfo {
	nodeName: string;
	serviceManifestName: string;
	codePackageName: string;
	codePackageVersion: string;
	status: string;
	entryPointStatus: string;
	/** Host process id; `undefined` when the gateway reports none (containers, guest executables). */
	processId: number | undefined;
	hostType: string;
}

/**
 * Minimal Service Fabric HTTP gateway client.
 * Uses native http/https — no external deps.
 *
 * For HTTPS clusters (X.509/AAD) the caller would need to inject TLS options;
 * the local dev cluster runs on http://localhost:19080 by default which makes
 * an immediate end-to-end smoke test trivial.
 */
export class SfRestClient {
	constructor(readonly endpoint: string) {}

	apiVersion = '6.0';

	async getClusterHealth(timeoutMs = 5000): Promise<ClusterHealthSummary> {
		const json = await this.get('/$/GetClusterHealth', timeoutMs);
		return { aggregatedHealthState: String(json?.AggregatedHealthState ?? 'Unknown') };
	}

	async getNodes(timeoutMs = 5000): Promise<ClusterNodeInfo[]> {
		const json = await this.get('/Nodes', timeoutMs);
		const items: any[] = json?.Items ?? [];
		return items.map((n) => ({
			name: String(n?.Name ?? ''),
			status: String(n?.NodeStatus ?? ''),
			healthState: String(n?.HealthState ?? ''),
			nodeType: String(n?.Type ?? ''),
		}));
	}

	async getDeployedApplications(timeoutMs = 5000): Promise<DeployedApplicationInfo[]> {
		// ApplicationsList endpoint.
		const json = await this.get('/Applications/', timeoutMs);
		const items: any[] = json?.Items ?? [];
		return items.map((it) => ({
			name: String(it?.Name ?? '').replace(/^fabric:\//, ''),
			typeName: String(it?.TypeName ?? ''),
			typeVersion: String(it?.TypeVersion ?? ''),
			status: String(it?.Status ?? ''),
		}));
	}

	/**
	 * Lists nodes that currently host any replica/instance of the given application.
	 */
	async getApplicationNodes(applicationName: string, timeoutMs = 5000): Promise<string[]> {
		const appId = encodeURIComponent(applicationName.replace(/^fabric:\//, ''));
		const services: any[] = (await this.get(`/Applications/${appId}/$/GetServices`, timeoutMs))?.Items ?? [];
		const nodeNames = new Set<string>();
		for (const svc of services) {
			const svcId = encodeURIComponent(String(svc?.Id ?? ''));
			if (!svcId) continue;
			const partitions = await this.get(`/Services/${svcId}/$/GetPartitions`, timeoutMs).catch(() => ({ Items: [] }));
			for (const part of partitions?.Items ?? []) {
				const partId = encodeURIComponent(String(part?.PartitionInformation?.Id ?? ''));
				if (!partId) continue;
				const replicas = await this.get(`/Partitions/${partId}/$/GetReplicas`, timeoutMs).catch(() => ({ Items: [] }));
				for (const r of replicas?.Items ?? []) {
					if (r?.NodeName) nodeNames.add(String(r.NodeName));
				}
			}
		}
		return Array.from(nodeNames);
	}

	/**
	 * Lists the services that belong to a deployed application.
	 *
	 * Wraps `/Applications/{id}/$/GetServices`. Returns the URL-encoded service
	 * `Id` (needed for partition lookups) and the originating `ServiceManifestName`.
	 * Used by the post-Publish auto-attach orchestrator to wait for a
	 * `Ready` replica before resolving PIDs.
	 */
	async listServices(applicationName: string, timeoutMs = 5000): Promise<ServiceSummary[]> {
		const appId = encodeURIComponent(applicationName.replace(/^fabric:\//, ''));
		const items: any[] = (await this.get(`/Applications/${appId}/$/GetServices`, timeoutMs))?.Items ?? [];
		return items.map((svc) => ({
			id: encodeURIComponent(String(svc?.Id ?? '')),
			manifestName: String(svc?.ServiceManifestName ?? svc?.TypeName ?? ''),
		}));
	}

	/**
	 * Walks `GetPartitions` → `GetReplicas` for a single service and returns
	 * the flattened replica list.
	 *
	 * `serviceId` must already be URL-encoded (as returned by `listServices`).
	 */
	async listReplicas(serviceId: string, timeoutMs = 5000): Promise<ReplicaSummary[]> {
		const partitions = await this.get(`/Services/${serviceId}/$/GetPartitions`, timeoutMs).catch(() => ({ Items: [] }));
		const out: ReplicaSummary[] = [];
		for (const part of partitions?.Items ?? []) {
			const partId = encodeURIComponent(String(part?.PartitionInformation?.Id ?? ''));
			if (!partId) continue;
			const replicas = await this.get(`/Partitions/${partId}/$/GetReplicas`, timeoutMs).catch(() => ({ Items: [] }));
			for (const r of replicas?.Items ?? []) {
				out.push({
					replicaStatus: String(r?.ReplicaStatus ?? ''),
					nodeName: String(r?.NodeName ?? ''),
				});
			}
		}
		return out;
	}

	/**
	 * Returns deployed code packages (with PID when available) for an application
	 * across the supplied list of node names.
	 */
	async getDeployedCodePackages(
		applicationName: string,
		nodeNames: readonly string[],
		timeoutMs = 5000,
	): Promise<DeployedCodePackageInfo[]> {
		const appId = applicationName.replace(/^fabric:\//, '');
		const out: DeployedCodePackageInfo[] = [];
		for (const node of nodeNames) {
			const path = `/Nodes/${encodeURIComponent(node)}/$/GetApplications/${encodeURIComponent(appId)}/$/GetCodePackages`;
			// GetCodePackages returns a bare JSON array (no Items envelope).
			const raw = await this.get(path, timeoutMs).catch(() => undefined);
			const items: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.Items) ? raw.Items : [];
			for (const cp of items) {
				const rawPid = cp?.MainEntryPoint?.ProcessId ?? cp?.SetupEntryPoint?.ProcessId;
				const entryPid = Number(rawPid);
				out.push({
					nodeName: node,
					serviceManifestName: String(cp?.ServiceManifestName ?? ''),
					codePackageName: String(cp?.Name ?? ''),
					codePackageVersion: String(cp?.Version ?? ''),
					status: String(cp?.Status ?? cp?.HostType ?? ''),
					entryPointStatus: String(cp?.MainEntryPoint?.Status ?? cp?.MainEntryPoint?.EntryPointStatus ?? ''),
					processId: Number.isFinite(entryPid) && entryPid > 0 ? entryPid : undefined,
					hostType: String(cp?.HostType ?? ''),
				});
			}
		}
		return out;
	}

	/**
	 * Issues a raw GET against the cluster gateway. Path may contain query.
	 * Used by webviews and other callers that need ad-hoc endpoints
	 * (e.g. `/EventsStore/Cluster/Events?StartTimeUtc=…`).
	 */
	rawGet(pathAndQuery: string, timeoutMs = 5000): Promise<unknown> {
		return this.get(pathAndQuery, timeoutMs);
	}

	// Resolves with the parsed JSON body (or undefined for an empty body). Typed `any`
	// because gateway payloads are untyped JSON that callers probe with optional chaining.
	private get(pathAndQuery: string, timeoutMs: number): Promise<any> {
		const sep = pathAndQuery.includes('?') ? '&' : '?';
		const requestUrl = new url.URL(`${this.endpoint}${pathAndQuery}${sep}api-version=${this.apiVersion}`);
		const lib = requestUrl.protocol === 'https:' ? https : http;
		return new Promise((resolve, reject) => {
			const req = lib.request(
				{
					method: 'GET',
					hostname: requestUrl.hostname,
					port: requestUrl.port || (requestUrl.protocol === 'https:' ? 443 : 80),
					path: `${requestUrl.pathname}${requestUrl.search}`,
					headers: { Accept: 'application/json' },
					timeout: timeoutMs,
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on('data', (c) => chunks.push(Buffer.from(c)));
					res.on('end', () => {
						const body = Buffer.concat(chunks).toString('utf8');
						if (!res.statusCode || res.statusCode >= 400) {
							reject(new Error(`HTTP ${res.statusCode} from ${requestUrl.href}: ${body}`));
							return;
						}
						try {
							resolve(body ? JSON.parse(body) : undefined);
						} catch (err) {
							reject(err);
						}
					});
				},
			);
			req.on('error', (err) => reject(wrapError(err, requestUrl.href)));
			req.on('timeout', () => req.destroy(new Error(`Request to ${requestUrl.href} timed out after ${timeoutMs}ms`)));
			req.end();
		});
	}
}

function wrapError(err: unknown, url: string): Error {
	if (err instanceof Error) {
		const code = (err as NodeJS.ErrnoException).code;
		const msg = err.message || code || 'unknown error';
		return new Error(`Request to ${url} failed: ${msg}${code && !err.message?.includes(code) ? ` (${code})` : ''}`);
	}
	return new Error(`Request to ${url} failed: ${String(err)}`);
}
