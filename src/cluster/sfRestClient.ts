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

/** One provisioned application type version, as returned by `SfRestClient.getApplicationTypes`. */
export interface ApplicationTypeInfo {
	name: string;
	version: string;
	/** `Provisioning` / `Available` / `Unprovisioning` / `Failed`. */
	status: string;
	statusDetails: string;
	defaultParameters: { key: string; value: string }[];
	/** `ServiceFabricApplicationPackage` / `Compose` / `MeshApplicationDescription`. */
	definitionKind: string;
}

/** An application as returned by `SfRestClient.getApplications`. */
export interface ApplicationInfo {
	/** Gateway identity (`fabric:/` stripped, `/` → `~`), URL-encoded for path use. */
	id: string;
	/** Display name without the `fabric:/` prefix. */
	name: string;
	typeName: string;
	typeVersion: string;
	status: string;
	healthState: string;
	parameters: { key: string; value: string }[];
}

/** A service as returned by `SfRestClient.getServices`. */
export interface ServiceInfo {
	/** URL-encoded service `Id` (e.g. `MyApp~MyService`). */
	id: string;
	/** Full `fabric:/` name. */
	name: string;
	/** `Stateful` / `Stateless`. */
	kind: string;
	typeName: string;
	manifestVersion: string;
	healthState: string;
	status: string;
	hasPersistedState: boolean;
	isServiceGroup: boolean;
}

/** A partition as returned by `SfRestClient.getPartitions`. */
export interface PartitionInfo {
	id: string;
	/** `Stateful` / `Stateless`. */
	serviceKind: string;
	/** `Singleton` / `Int64Range` / `Named`. */
	schemeKind: string;
	/** Named-partition name or `[low, high]` for ranged partitions; empty for singletons. */
	keyDescription: string;
	status: string;
	healthState: string;
	targetReplicaSetSize: number | undefined;
	minReplicaSetSize: number | undefined;
	instanceCount: number | undefined;
}

/** A replica (stateful) or instance (stateless) as returned by `SfRestClient.getReplicas`. */
export interface ReplicaInfo {
	/** `ReplicaId` for stateful services, `InstanceId` for stateless ones. */
	id: string;
	serviceKind: string;
	/** `Primary` / `ActiveSecondary` / `IdleSecondary` / `None`; empty for instances. */
	role: string;
	status: string;
	healthState: string;
	nodeName: string;
	address: string;
	lastInBuildDurationInSeconds: string;
}

/** Full node record (`/Nodes/{name}`), a superset of {@link ClusterNodeInfo}. */
export interface ClusterNodeDetail extends ClusterNodeInfo {
	id: string;
	instanceId: string;
	ipAddressOrFqdn: string;
	codeVersion: string;
	configVersion: string;
	isSeedNode: boolean;
	upgradeDomain: string;
	faultDomain: string;
	nodeDeactivationInfo: unknown;
}

/** An application deployed on a specific node (`/Nodes/{name}/$/GetApplications`). */
export interface DeployedApplicationOnNodeInfo {
	id: string;
	name: string;
	typeName: string;
	status: string;
	healthState: string;
	workDirectory: string;
	logDirectory: string;
	tempDirectory: string;
}

/** A service package deployed on a node (`/Nodes/{name}/$/GetApplications/{app}/$/GetServicePackages`). */
export interface DeployedServicePackageInfo {
	name: string;
	version: string;
	status: string;
	healthState: string;
	/** Empty for `SharedProcess` activation. */
	servicePackageActivationId: string;
}

/** A code package deployed on one node, with the fields needed to restart it. */
export interface DeployedCodePackageDetail extends DeployedCodePackageInfo {
	servicePackageActivationId: string;
	/** Current entry-point instance id; `0` when unknown. */
	codePackageInstanceId: string;
	setupEntryPointStatus: string;
	raw: unknown;
}

/** A replica/instance deployed on a node (`/Nodes/{name}/$/GetApplications/{app}/$/GetReplicas`). */
export interface DeployedReplicaInfo {
	serviceKind: string;
	serviceName: string;
	serviceTypeName: string;
	serviceManifestName: string;
	codePackageName: string;
	partitionId: string;
	/** `ReplicaId` or `InstanceId`. */
	id: string;
	role: string;
	status: string;
	address: string;
	servicePackageActivationId: string;
	hostProcessId: string;
}

/** A Repair Manager task (`/$/GetRepairTaskList`), as shown under "Repair Jobs" in Service Fabric Explorer. */
export interface RepairTaskInfo {
	taskId: string;
	/** Optimistic-concurrency version; required by cancel / approve / delete. */
	version: string;
	description: string;
	/** `Created` / `Claimed` / `Preparing` / `Approved` / `Executing` / `Restoring` / `Completed`. */
	state: string;
	/** Bitwise flags: 1 cancel requested, 2 abort requested, 4 approval forced. */
	flags: number;
	action: string;
	/** Target node names (`Target.Kind === 'Node'`); empty for other kinds. */
	targetNodes: string[];
	executor: string;
	/** `Succeeded` / `Cancelled` / `Interrupted` / `Failed` / `Pending`; empty before Restoring. */
	resultStatus: string;
	resultDetails: string;
	createdUtc: string;
	completedUtc: string;
	raw: unknown;
}

/** `Pause` / `Restart` / `RemoveData` / `RemoveNode`, see the DeactivateNode REST API. */
export type NodeDeactivationIntent = 'Pause' | 'Restart' | 'RemoveData' | 'RemoveNode';

/** Entra ID configuration a cluster publishes at `/$/GetAadMetadata`. */
export interface AadMetadata {
	authority: string;
	/** Client (native/public) application ID registered for the cluster. */
	clientApplicationId: string;
	/** Cluster (web API) application ID: the token audience. */
	clusterApplicationId: string;
	tenantId: string;
}

/** Transport and auth hooks for {@link SfRestClient}. */
export interface SfRestClientOptions {
	/**
	 * Agent for https requests, e.g. one that pins the server certificate or
	 * presents a client certificate. A function is called once, on the first
	 * https request, so material that needs async loading (a passphrase from
	 * SecretStorage) doesn't force every caller to await client creation.
	 */
	agent?: https.Agent | (() => Promise<https.Agent | undefined>);
	/** Returns a bearer token for Entra-secured clusters, or `undefined` for none. */
	getAccessToken?: () => Promise<string | undefined>;
}

/**
 * Minimal Service Fabric HTTP gateway client.
 * Uses native http/https — no external deps.
 *
 * Secured clusters are reached through {@link SfRestClientOptions}: an agent
 * that pins the cluster's (usually self-signed) server certificate, and a
 * token callback for Entra ID. Use `createClusterClient` rather than building
 * one by hand for a saved connection.
 */
export class SfRestClient {
	constructor(
		readonly endpoint: string,
		private readonly options: SfRestClientOptions = {},
	) {}

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

	/**
	 * Reads the cluster's Entra ID configuration. The endpoint is anonymous, so no
	 * token is sent. Returns `undefined` for clusters that don't use Entra ID.
	 */
	async getAadMetadata(timeoutMs = 5000): Promise<AadMetadata | undefined> {
		const json = await this.get('/$/GetAadMetadata', timeoutMs, { apiVersion: '1.0', anonymous: true });
		const meta = json?.metadata;
		if (String(json?.type ?? '').toLowerCase() !== 'aad' || !meta?.cluster || !meta?.tenant) return undefined;
		return {
			authority: String(meta.authority ?? ''),
			clientApplicationId: String(meta.client ?? ''),
			clusterApplicationId: String(meta.cluster),
			tenantId: String(meta.tenant),
		};
	}

	// ---- Cluster -----------------------------------------------------------------

	/** `/$/GetClusterManifest`: the cluster manifest XML as a string. */
	async getClusterManifest(timeoutMs = 10000): Promise<string> {
		const json = await this.get('/$/GetClusterManifest', timeoutMs);
		return String(json?.Manifest ?? '');
	}

	/** `/$/GetClusterVersion` (6.4+); `undefined` on older runtimes. */
	async getClusterVersion(timeoutMs = 5000): Promise<string | undefined> {
		const json = await this.get('/$/GetClusterVersion', timeoutMs, { apiVersion: '6.4' }).catch(() => undefined);
		return json?.Version ? String(json.Version) : undefined;
	}

	/** Full `/$/GetClusterHealth` payload (events, node and application health states). */
	getClusterHealthDetail(timeoutMs = 10000): Promise<unknown> {
		return this.get('/$/GetClusterHealth', timeoutMs);
	}

	/** `/$/GetUpgradeProgress`: the cluster upgrade state. */
	getClusterUpgradeProgress(timeoutMs = 10000): Promise<unknown> {
		return this.get('/$/GetUpgradeProgress', timeoutMs);
	}

	/** `/$/GetLoadInformation`: cluster-wide load metrics. */
	getClusterLoadInformation(timeoutMs = 10000): Promise<unknown> {
		return this.get('/$/GetLoadInformation', timeoutMs);
	}

	// ---- Application types -------------------------------------------------------

	/** `/ApplicationTypes`: every provisioned type version, following continuation tokens. */
	async getApplicationTypes(timeoutMs = 10000): Promise<ApplicationTypeInfo[]> {
		const items = await this.getAllPages('/ApplicationTypes', timeoutMs);
		return items.map((t) => ({
			name: String(t?.Name ?? ''),
			version: String(t?.Version ?? ''),
			status: String(t?.Status ?? ''),
			statusDetails: String(t?.StatusDetails ?? ''),
			defaultParameters: toParameterList(t?.DefaultParameterList),
			definitionKind: String(t?.ApplicationTypeDefinitionKind ?? ''),
		}));
	}

	/** `/ApplicationTypes/{name}/$/GetServiceTypes?ApplicationTypeVersion=…`: raw service type list. */
	getServiceTypes(typeName: string, typeVersion: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(
			`/ApplicationTypes/${encodeURIComponent(typeName)}/$/GetServiceTypes?ApplicationTypeVersion=${encodeURIComponent(typeVersion)}`,
			timeoutMs,
		);
	}

	/** `/ApplicationTypes/{name}/$/Unprovision`: unregisters one version of an application type. */
	async unprovisionApplicationType(typeName: string, typeVersion: string, timeoutMs = 60000): Promise<void> {
		await this.post(`/ApplicationTypes/${encodeURIComponent(typeName)}/$/Unprovision`, timeoutMs, {
			body: { ApplicationTypeVersion: typeVersion, Async: true },
		});
	}

	// ---- Applications ------------------------------------------------------------

	/** `/Applications`: every application with its health state, following continuation tokens. */
	async getApplications(timeoutMs = 10000): Promise<ApplicationInfo[]> {
		const items = await this.getAllPages('/Applications', timeoutMs);
		return items.map(toApplicationInfo);
	}

	/** `/Applications/{id}`: one application, or `undefined` when it no longer exists. */
	async getApplication(applicationId: string, timeoutMs = 10000): Promise<ApplicationInfo | undefined> {
		const json = await this.get(`/Applications/${applicationId}`, timeoutMs);
		return json ? toApplicationInfo(json) : undefined;
	}

	getApplicationHealth(applicationId: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`/Applications/${applicationId}/$/GetHealth`, timeoutMs);
	}

	getApplicationUpgradeProgress(applicationId: string, timeoutMs = 10000): Promise<any> {
		return this.get(`/Applications/${applicationId}/$/GetUpgradeProgress`, timeoutMs);
	}

	/** `/Applications/{id}/$/Delete`: deletes an application and all its services. */
	async deleteApplication(applicationId: string, forceRemove = false, timeoutMs = 60000): Promise<void> {
		await this.post(`/Applications/${applicationId}/$/Delete${forceRemove ? '?ForceRemove=true' : ''}`, timeoutMs);
	}

	/** `/Applications/$/Create`: creates an application from a provisioned type version. */
	async createApplication(description: ApplicationCreateDescription, timeoutMs = 60000): Promise<void> {
		await this.post('/Applications/$/Create', timeoutMs, { body: description });
	}

	/** `/Applications/{id}/$/Upgrade`: starts a rolling upgrade to another provisioned type version. */
	async upgradeApplication(applicationId: string, description: ApplicationUpgradeDescription, timeoutMs = 60000): Promise<void> {
		await this.post(`/Applications/${applicationId}/$/Upgrade`, timeoutMs, { body: description });
	}

	/** `/Applications/{id}/$/MoveToNextUpgradeDomain`: resumes an `UnmonitoredManual` upgrade in the given upgrade domain. */
	async moveToNextUpgradeDomain(applicationId: string, upgradeDomainName: string, timeoutMs = 60000): Promise<void> {
		await this.post(`/Applications/${applicationId}/$/MoveToNextUpgradeDomain`, timeoutMs, { body: { UpgradeDomainName: upgradeDomainName } });
	}

	/** `/Applications/{id}/$/RollbackUpgrade`: rolls an in-progress upgrade back to the previous version. */
	async rollbackApplicationUpgrade(applicationId: string, timeoutMs = 60000): Promise<void> {
		await this.post(`/Applications/${applicationId}/$/RollbackUpgrade`, timeoutMs);
	}

	/** `/Applications/{id}/$/UpdateUpgrade`: changes the parameters of an in-progress upgrade. */
	async updateApplicationUpgrade(applicationId: string, description: Record<string, unknown>, timeoutMs = 60000): Promise<void> {
		await this.post(`/Applications/${applicationId}/$/UpdateUpgrade`, timeoutMs, { body: description });
	}

	/** `/Applications/{id}/$/GetServices/$/Create`: creates a service in an application. */
	async createService(applicationId: string, description: Record<string, unknown>, timeoutMs = 60000): Promise<void> {
		await this.post(`/Applications/${applicationId}/$/GetServices/$/Create`, timeoutMs, { body: description });
	}

	// ---- Image store -------------------------------------------------------------

	/** `PUT /ImageStore/{path}`: uploads one file in a single request. `contentPath` uses `/` separators. */
	async uploadFile(contentPath: string, body: Buffer, timeoutMs = 60000): Promise<void> {
		await this.request('PUT', `/ImageStore/${encodeContentPath(contentPath)}`, timeoutMs, { rawBody: body });
	}

	/**
	 * `PUT /ImageStore/{path}/$/UploadChunk`: uploads bytes `start`..`end`
	 * (inclusive) of a `total`-byte file into an upload session.
	 */
	async uploadChunk(
		contentPath: string,
		sessionId: string,
		start: number,
		end: number,
		total: number,
		body: Buffer,
		timeoutMs = 60000,
	): Promise<void> {
		await this.request(
			'PUT',
			`/ImageStore/${encodeContentPath(contentPath)}/$/UploadChunk?session-id=${encodeURIComponent(sessionId)}`,
			timeoutMs,
			{ rawBody: body, headers: { 'Content-Range': `bytes ${start}-${end}/${total}` } },
		);
	}

	/** `POST /ImageStore/$/CommitUploadSession`: assembles an upload session's chunks into the file. */
	async commitUploadSession(sessionId: string, timeoutMs = 60000): Promise<void> {
		await this.post(`/ImageStore/$/CommitUploadSession?session-id=${encodeURIComponent(sessionId)}`, timeoutMs);
	}

	/** `DELETE /ImageStore/$/DeleteUploadSession`: discards an unfinished upload session. */
	async deleteUploadSession(sessionId: string, timeoutMs = 30000): Promise<void> {
		await this.request('DELETE', `/ImageStore/$/DeleteUploadSession?session-id=${encodeURIComponent(sessionId)}`, timeoutMs);
	}

	/** `DELETE /ImageStore/{path}`: removes a file or folder from the image store. */
	async deleteImageStoreContent(contentPath: string, timeoutMs = 60000): Promise<void> {
		await this.request('DELETE', `/ImageStore/${encodeContentPath(contentPath)}`, timeoutMs);
	}

	/**
	 * `/ApplicationTypes/$/Provision` for a package already in the image store.
	 * The `Kind` discriminator needs api-version 6.2.
	 */
	async provisionApplicationType(buildPath: string, async = false, timeoutMs = 300000): Promise<void> {
		await this.post('/ApplicationTypes/$/Provision', timeoutMs, {
			apiVersion: '6.2',
			body: { Kind: 'ImageStorePath', ApplicationTypeBuildPath: buildPath, Async: async },
		});
	}

	// ---- Services ----------------------------------------------------------------

	/** `/Applications/{id}/$/GetServices`: the services of an application. Use `System` for system services. */
	async getServices(applicationId: string, timeoutMs = 10000): Promise<ServiceInfo[]> {
		const items = await this.getAllPages(`/Applications/${applicationId}/$/GetServices`, timeoutMs);
		return items.map((svc) => ({
			id: encodeURIComponent(String(svc?.Id ?? '')),
			name: String(svc?.Name ?? ''),
			kind: String(svc?.ServiceKind ?? ''),
			typeName: String(svc?.TypeName ?? ''),
			manifestVersion: String(svc?.ManifestVersion ?? ''),
			healthState: String(svc?.HealthState ?? ''),
			status: String(svc?.ServiceStatus ?? ''),
			hasPersistedState: Boolean(svc?.HasPersistedState),
			isServiceGroup: Boolean(svc?.IsServiceGroup),
		}));
	}

	getServiceDescription(serviceId: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`/Services/${serviceId}/$/GetDescription`, timeoutMs);
	}

	getServiceHealth(serviceId: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`/Services/${serviceId}/$/GetHealth`, timeoutMs);
	}

	/** `/Services/{id}/$/Delete`. */
	async deleteService(serviceId: string, forceRemove = false, timeoutMs = 60000): Promise<void> {
		await this.post(`/Services/${serviceId}/$/Delete${forceRemove ? '?ForceRemove=true' : ''}`, timeoutMs);
	}

	/**
	 * `/Services/{id}/$/Update` with only the replica/instance count flag set:
	 * `InstanceCount` for stateless services (-1 = every node), `TargetReplicaSetSize` for stateful ones.
	 */
	async scaleService(serviceId: string, serviceKind: string, count: number, timeoutMs = 60000): Promise<void> {
		const body =
			serviceKind === 'Stateless'
				? { ServiceKind: 'Stateless', Flags: '1', InstanceCount: count }
				: { ServiceKind: 'Stateful', Flags: '1', TargetReplicaSetSize: count };
		await this.post(`/Services/${serviceId}/$/Update`, timeoutMs, { body });
	}

	// ---- Partitions --------------------------------------------------------------

	/** `/Services/{id}/$/GetPartitions`. `serviceId` must already be URL-encoded. */
	async getPartitions(serviceId: string, timeoutMs = 10000): Promise<PartitionInfo[]> {
		const items = await this.getAllPages(`/Services/${serviceId}/$/GetPartitions`, timeoutMs);
		return items.map((p) => {
			const info = p?.PartitionInformation ?? {};
			const scheme = String(info?.ServicePartitionKind ?? '');
			const keyDescription =
				scheme === 'Named' ? String(info?.Name ?? '') : scheme === 'Int64Range' ? `[${info?.LowKey ?? '?'}, ${info?.HighKey ?? '?'}]` : '';
			return {
				id: String(info?.Id ?? ''),
				serviceKind: String(p?.ServiceKind ?? ''),
				schemeKind: scheme,
				keyDescription,
				status: String(p?.PartitionStatus ?? ''),
				healthState: String(p?.HealthState ?? ''),
				targetReplicaSetSize: toOptionalNumber(p?.TargetReplicaSetSize),
				minReplicaSetSize: toOptionalNumber(p?.MinReplicaSetSize),
				instanceCount: toOptionalNumber(p?.InstanceCount),
			};
		});
	}

	getPartitionHealth(partitionId: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`/Partitions/${encodeURIComponent(partitionId)}/$/GetHealth`, timeoutMs);
	}

	getPartitionLoadInformation(partitionId: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`/Partitions/${encodeURIComponent(partitionId)}/$/GetLoadInformation`, timeoutMs);
	}

	/** `/Partitions/{id}/$/ResetLoad`: clears reported load so the balancer uses defaults. */
	async resetPartitionLoad(partitionId: string, timeoutMs = 30000): Promise<void> {
		await this.post(`/Partitions/${encodeURIComponent(partitionId)}/$/ResetLoad`, timeoutMs);
	}

	/** `/Partitions/{id}/$/Recover`: forces a quorum-lost partition to recover (potential data loss). */
	async recoverPartition(partitionId: string, timeoutMs = 30000): Promise<void> {
		await this.post(`/Partitions/${encodeURIComponent(partitionId)}/$/Recover`, timeoutMs);
	}

	// ---- Replicas ----------------------------------------------------------------

	/** `/Partitions/{id}/$/GetReplicas`. */
	async getReplicas(partitionId: string, timeoutMs = 10000): Promise<ReplicaInfo[]> {
		const items = await this.getAllPages(`/Partitions/${encodeURIComponent(partitionId)}/$/GetReplicas`, timeoutMs);
		return items.map((r) => ({
			id: String(r?.ReplicaId ?? r?.InstanceId ?? ''),
			serviceKind: String(r?.ServiceKind ?? ''),
			role: String(r?.ReplicaRole ?? ''),
			status: String(r?.ReplicaStatus ?? ''),
			healthState: String(r?.HealthState ?? ''),
			nodeName: String(r?.NodeName ?? ''),
			address: String(r?.Address ?? ''),
			lastInBuildDurationInSeconds: String(r?.LastInBuildDurationInSeconds ?? ''),
		}));
	}

	getReplicaHealth(partitionId: string, replicaId: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`/Partitions/${encodeURIComponent(partitionId)}/$/GetReplicas/${encodeURIComponent(replicaId)}/$/GetHealth`, timeoutMs);
	}

	/** `/Nodes/{node}/$/GetPartitions/{partition}/$/GetReplicas/{replica}/$/GetDetail`: host-side replica detail. */
	getReplicaDetail(nodeName: string, partitionId: string, replicaId: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`${replicaOnNodePath(nodeName, partitionId, replicaId)}/$/GetDetail`, timeoutMs);
	}

	/** Restarts a persisted stateful replica in place (simulated transient failure). */
	async restartReplica(nodeName: string, partitionId: string, replicaId: string, timeoutMs = 30000): Promise<void> {
		await this.post(`${replicaOnNodePath(nodeName, partitionId, replicaId)}/$/Restart`, timeoutMs);
	}

	/** Removes a replica or instance (simulated permanent failure). */
	async removeReplica(nodeName: string, partitionId: string, replicaId: string, forceRemove = false, timeoutMs = 30000): Promise<void> {
		await this.post(`${replicaOnNodePath(nodeName, partitionId, replicaId)}/$/Delete${forceRemove ? '?ForceRemove=true' : ''}`, timeoutMs);
	}

	// ---- Nodes -------------------------------------------------------------------

	/** `/Nodes/{name}`: full node record. */
	async getNode(nodeName: string, timeoutMs = 10000): Promise<ClusterNodeDetail> {
		const n = await this.get(`/Nodes/${encodeURIComponent(nodeName)}`, timeoutMs);
		return {
			name: String(n?.Name ?? nodeName),
			status: String(n?.NodeStatus ?? ''),
			healthState: String(n?.HealthState ?? ''),
			nodeType: String(n?.Type ?? ''),
			id: String(n?.Id?.Id ?? ''),
			instanceId: String(n?.InstanceId ?? '0'),
			ipAddressOrFqdn: String(n?.IpAddressOrFQDN ?? ''),
			codeVersion: String(n?.CodeVersion ?? ''),
			configVersion: String(n?.ConfigVersion ?? ''),
			isSeedNode: Boolean(n?.IsSeedNode),
			upgradeDomain: String(n?.UpgradeDomain ?? ''),
			faultDomain: String(n?.FaultDomain ?? ''),
			nodeDeactivationInfo: n?.NodeDeactivationInfo,
		};
	}

	getNodeHealth(nodeName: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`/Nodes/${encodeURIComponent(nodeName)}/$/GetHealth`, timeoutMs);
	}

	getNodeLoadInformation(nodeName: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`/Nodes/${encodeURIComponent(nodeName)}/$/GetLoadInformation`, timeoutMs);
	}

	async activateNode(nodeName: string, timeoutMs = 30000): Promise<void> {
		await this.post(`/Nodes/${encodeURIComponent(nodeName)}/$/Activate`, timeoutMs);
	}

	async deactivateNode(nodeName: string, intent: NodeDeactivationIntent, timeoutMs = 30000): Promise<void> {
		await this.post(`/Nodes/${encodeURIComponent(nodeName)}/$/Deactivate`, timeoutMs, { body: { DeactivationIntent: intent } });
	}

	/** Restarts the Fabric process on a node. `nodeInstanceId` `"0"` matches any instance. */
	async restartNode(nodeName: string, nodeInstanceId = '0', timeoutMs = 30000): Promise<void> {
		await this.post(`/Nodes/${encodeURIComponent(nodeName)}/$/Restart`, timeoutMs, {
			body: { NodeInstanceId: nodeInstanceId, CreateFabricDump: 'False' },
		});
	}

	/** Tells the cluster a down node's state is gone for good. */
	async removeNodeState(nodeName: string, timeoutMs = 30000): Promise<void> {
		await this.post(`/Nodes/${encodeURIComponent(nodeName)}/$/RemoveNodeState`, timeoutMs);
	}

	// ---- Repair tasks --------------------------------------------------------------

	/**
	 * `/$/GetRepairTaskList`: every repair task, newest first. Clusters without the
	 * RepairManager add-on drop the connection; that is reported as a clear error.
	 */
	async getRepairTasks(timeoutMs = 10000): Promise<RepairTaskInfo[]> {
		let raw: unknown;
		try {
			raw = await this.get('/$/GetRepairTaskList', timeoutMs);
		} catch (err) {
			const message = (err as Error).message;
			if (/socket hang up|ECONNRESET|HTTP 404|FABRIC_E_SERVICE_DOES_NOT_EXIST|RepairManager/i.test(message)) {
				throw new Error(`Repair Manager is not enabled on this cluster (the RepairManager add-on feature is missing). ${message}`);
			}
			throw err;
		}
		return toArray(raw)
			.map((t): RepairTaskInfo => {
				const target = t?.Target;
				return {
					taskId: String(t?.TaskId ?? ''),
					version: String(t?.Version ?? '0'),
					description: String(t?.Description ?? ''),
					state: String(t?.State ?? ''),
					flags: Number(t?.Flags ?? 0) || 0,
					action: String(t?.Action ?? ''),
					targetNodes: String(target?.Kind ?? '') === 'Node' ? toArray(target?.NodeNames).map(String) : [],
					executor: String(t?.Executor ?? ''),
					resultStatus: String(t?.ResultStatus ?? ''),
					resultDetails: String(t?.ResultDetails ?? ''),
					createdUtc: String(t?.History?.CreatedUtcTimestamp ?? ''),
					completedUtc: String(t?.History?.CompletedUtcTimestamp ?? ''),
					raw: t,
				};
			})
			.sort((a, b) => b.createdUtc.localeCompare(a.createdUtc));
	}

	/** `/$/CancelRepairTask`: asks the executor to cancel (or, with `requestAbort`, abort) a task. */
	async cancelRepairTask(taskId: string, version: string, requestAbort = false, timeoutMs = 30000): Promise<void> {
		await this.post('/$/CancelRepairTask', timeoutMs, { body: { TaskId: taskId, Version: version, RequestAbort: requestAbort } });
	}

	/** `/$/ForceApproveRepairTask`: approves a Preparing task without waiting for the safety checks. */
	async forceApproveRepairTask(taskId: string, version: string, timeoutMs = 30000): Promise<void> {
		await this.post('/$/ForceApproveRepairTask', timeoutMs, { body: { TaskId: taskId, Version: version } });
	}

	/** `/$/DeleteRepairTask`: removes a Completed task from the Repair Manager's list. */
	async deleteRepairTask(taskId: string, version: string, timeoutMs = 30000): Promise<void> {
		await this.post('/$/DeleteRepairTask', timeoutMs, { body: { TaskId: taskId, Version: version } });
	}

	// ---- Deployed (per-node) entities ---------------------------------------------

	/** `/Nodes/{name}/$/GetApplications`: applications with code deployed on the node. */
	async getDeployedApplicationsOnNode(nodeName: string, timeoutMs = 10000): Promise<DeployedApplicationOnNodeInfo[]> {
		const items = await this.getAllPages(`/Nodes/${encodeURIComponent(nodeName)}/$/GetApplications`, timeoutMs);
		return items.map((a) => ({
			id: encodeURIComponent(String(a?.Id ?? '')),
			name: String(a?.Name ?? '').replace(/^fabric:\//, ''),
			typeName: String(a?.TypeName ?? ''),
			status: String(a?.Status ?? ''),
			healthState: String(a?.HealthState ?? ''),
			workDirectory: String(a?.WorkDirectory ?? ''),
			logDirectory: String(a?.LogDirectory ?? ''),
			tempDirectory: String(a?.TempDirectory ?? ''),
		}));
	}

	getDeployedApplicationHealth(nodeName: string, applicationId: string, timeoutMs = 10000): Promise<unknown> {
		return this.get(`${deployedAppPath(nodeName, applicationId)}/$/GetHealth`, timeoutMs);
	}

	/** `/Nodes/{name}/$/GetApplications/{app}/$/GetServicePackages`. Returns a bare array. */
	async getDeployedServicePackages(nodeName: string, applicationId: string, timeoutMs = 10000): Promise<DeployedServicePackageInfo[]> {
		const raw = await this.get(`${deployedAppPath(nodeName, applicationId)}/$/GetServicePackages`, timeoutMs);
		return toArray(raw).map((p) => ({
			name: String(p?.Name ?? ''),
			version: String(p?.Version ?? ''),
			status: String(p?.Status ?? ''),
			healthState: String(p?.HealthState ?? ''),
			servicePackageActivationId: String(p?.ServicePackageActivationId ?? ''),
		}));
	}

	getDeployedServicePackageHealth(
		nodeName: string,
		applicationId: string,
		servicePackageName: string,
		timeoutMs = 10000,
	): Promise<unknown> {
		return this.get(
			`${deployedAppPath(nodeName, applicationId)}/$/GetServicePackages/${encodeURIComponent(servicePackageName)}/$/GetHealth`,
			timeoutMs,
		);
	}

	/** Code packages of one service manifest on one node, with the instance ids needed to restart them. */
	async getDeployedCodePackagesForManifest(
		nodeName: string,
		applicationId: string,
		serviceManifestName: string,
		timeoutMs = 10000,
	): Promise<DeployedCodePackageDetail[]> {
		const raw = await this.get(
			`${deployedAppPath(nodeName, applicationId)}/$/GetCodePackages?ServiceManifestName=${encodeURIComponent(serviceManifestName)}`,
			timeoutMs,
		);
		return toArray(raw).map((cp) => {
			const rawPid = cp?.MainEntryPoint?.ProcessId ?? cp?.SetupEntryPoint?.ProcessId;
			const entryPid = Number(rawPid);
			return {
				nodeName,
				serviceManifestName: String(cp?.ServiceManifestName ?? serviceManifestName),
				codePackageName: String(cp?.Name ?? ''),
				codePackageVersion: String(cp?.Version ?? ''),
				status: String(cp?.Status ?? ''),
				entryPointStatus: String(cp?.MainEntryPoint?.Status ?? ''),
				processId: Number.isFinite(entryPid) && entryPid > 0 ? entryPid : undefined,
				hostType: String(cp?.HostType ?? ''),
				servicePackageActivationId: String(cp?.ServicePackageActivationId ?? ''),
				codePackageInstanceId: String(cp?.MainEntryPoint?.InstanceId ?? '0'),
				setupEntryPointStatus: String(cp?.SetupEntryPoint?.Status ?? ''),
				raw: cp,
			};
		});
	}

	/** Restarts a code package host process (`/$/GetCodePackages/$/Restart`). */
	async restartDeployedCodePackage(
		nodeName: string,
		applicationId: string,
		pkg: { serviceManifestName: string; codePackageName: string; codePackageInstanceId: string; servicePackageActivationId?: string },
		timeoutMs = 30000,
	): Promise<void> {
		await this.post(`${deployedAppPath(nodeName, applicationId)}/$/GetCodePackages/$/Restart`, timeoutMs, {
			body: {
				ServiceManifestName: pkg.serviceManifestName,
				CodePackageName: pkg.codePackageName,
				CodePackageInstanceId: pkg.codePackageInstanceId || '0',
				...(pkg.servicePackageActivationId ? { ServicePackageActivationId: pkg.servicePackageActivationId } : {}),
			},
		});
	}

	/** Container stdout/stderr for a containerised code package (`/$/GetCodePackages/$/ContainerLogs`, 6.2+). */
	async getContainerLogs(
		nodeName: string,
		applicationId: string,
		serviceManifestName: string,
		codePackageName: string,
		opts: { tail?: string; previous?: boolean } = {},
		timeoutMs = 30000,
	): Promise<string> {
		const query = new URLSearchParams({ ServiceManifestName: serviceManifestName, CodePackageName: codePackageName });
		if (opts.tail) query.set('Tail', opts.tail);
		if (opts.previous) query.set('Previous', 'true');
		const json = await this.get(`${deployedAppPath(nodeName, applicationId)}/$/GetCodePackages/$/ContainerLogs?${query}`, timeoutMs, {
			apiVersion: '6.2',
		});
		return String(json?.Content ?? '');
	}

	/** Replicas/instances of one service manifest hosted on one node. */
	async getDeployedReplicas(
		nodeName: string,
		applicationId: string,
		serviceManifestName: string,
		timeoutMs = 10000,
	): Promise<DeployedReplicaInfo[]> {
		const raw = await this.get(
			`${deployedAppPath(nodeName, applicationId)}/$/GetReplicas?ServiceManifestName=${encodeURIComponent(serviceManifestName)}`,
			timeoutMs,
		);
		return toArray(raw).map((r) => ({
			serviceKind: String(r?.ServiceKind ?? ''),
			serviceName: String(r?.ServiceName ?? ''),
			serviceTypeName: String(r?.ServiceTypeName ?? ''),
			serviceManifestName: String(r?.ServiceManifestName ?? serviceManifestName),
			codePackageName: String(r?.CodePackageName ?? ''),
			partitionId: String(r?.PartitionId ?? ''),
			id: String(r?.ReplicaId ?? r?.InstanceId ?? ''),
			role: String(r?.ReplicaRole ?? ''),
			status: String(r?.ReplicaStatus ?? ''),
			address: String(r?.Address ?? ''),
			servicePackageActivationId: String(r?.ServicePackageActivationId ?? ''),
			hostProcessId: String(r?.HostProcessId ?? ''),
		}));
	}

	/** Follows `ContinuationToken` on a paged list endpoint and returns the concatenated `Items`. */
	private async getAllPages(pathAndQuery: string, timeoutMs: number): Promise<any[]> {
		const items: any[] = [];
		let token: string | undefined;
		for (let page = 0; page < 50; page++) {
			const sep = pathAndQuery.includes('?') ? '&' : '?';
			const json = await this.get(token ? `${pathAndQuery}${sep}ContinuationToken=${encodeURIComponent(token)}` : pathAndQuery, timeoutMs);
			items.push(...toArray(json));
			token = json?.ContinuationToken ? String(json.ContinuationToken) : undefined;
			if (!token) break;
		}
		return items;
	}

	/** Issues a POST against the gateway. `body` (if any) is sent as JSON; an empty response resolves to `undefined`. */
	rawPost(pathAndQuery: string, body?: unknown, timeoutMs = 30000, opts: RequestOptions = {}): Promise<unknown> {
		return this.request('POST', pathAndQuery, timeoutMs, { ...opts, body });
	}

	// Resolves with the parsed JSON body (or undefined for an empty body). Typed `any`
	// because gateway payloads are untyped JSON that callers probe with optional chaining.
	private get(pathAndQuery: string, timeoutMs: number, opts: RequestOptions = {}): Promise<any> {
		return this.request('GET', pathAndQuery, timeoutMs, opts);
	}

	private post(pathAndQuery: string, timeoutMs: number, opts: RequestOptions = {}): Promise<any> {
		return this.request('POST', pathAndQuery, timeoutMs, opts);
	}

	private async request(method: HttpMethod, pathAndQuery: string, timeoutMs: number, opts: RequestOptions = {}): Promise<any> {
		const sep = pathAndQuery.includes('?') ? '&' : '?';
		const requestUrl = new url.URL(`${this.endpoint}${pathAndQuery}${sep}api-version=${opts.apiVersion ?? this.apiVersion}`);
		const isHttps = requestUrl.protocol === 'https:';
		const lib = isHttps ? https : http;
		const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
		let payload: Buffer | undefined;
		if (opts.rawBody) {
			payload = opts.rawBody;
			headers['Content-Type'] = 'application/octet-stream';
		} else if (opts.body !== undefined) {
			payload = Buffer.from(JSON.stringify(opts.body), 'utf8');
			headers['Content-Type'] = 'application/json';
		}
		// Bodiless POST/PUT/DELETE still send a length so the gateway doesn't wait for one.
		if (payload || method !== 'GET') headers['Content-Length'] = String(payload?.length ?? 0);
		const agent = isHttps ? await this.resolveAgent() : undefined;
		const token = opts.anonymous ? undefined : await this.options.getAccessToken?.();
		if (token) {
			// Never send a bearer token in clear text.
			if (!isHttps) throw new Error(`Refusing to send an Entra ID token over plain HTTP to ${requestUrl.host}; use an https:// endpoint.`);
			headers.Authorization = `Bearer ${token}`;
		}
		return new Promise((resolve, reject) => {
			const req = lib.request(
				{
					method,
					hostname: requestUrl.hostname,
					port: requestUrl.port || (requestUrl.protocol === 'https:' ? 443 : 80),
					path: `${requestUrl.pathname}${requestUrl.search}`,
					headers,
					timeout: timeoutMs,
					...(agent ? { agent } : {}),
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on('data', (c) => chunks.push(Buffer.from(c)));
					res.on('end', () => {
						const body = Buffer.concat(chunks).toString('utf8');
						if (res.statusCode === 401 || res.statusCode === 403) {
							reject(new SfAuthError(res.statusCode, requestUrl.href, body));
							return;
						}
						if (!res.statusCode || res.statusCode >= 400) {
							reject(new SfGatewayError(res.statusCode ?? 0, requestUrl.href, body));
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
			if (payload) req.write(payload);
			req.end();
		});
	}

	private agentPromise: Promise<https.Agent | undefined> | undefined;

	private resolveAgent(): Promise<https.Agent | undefined> {
		const agent = this.options.agent;
		if (typeof agent !== 'function') return Promise.resolve(agent);
		// Retry after a failure (e.g. a cancelled passphrase prompt) instead of caching the rejection.
		this.agentPromise ??= agent().catch((err) => {
			this.agentPromise = undefined;
			throw err;
		});
		return this.agentPromise;
	}
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Body of `/Applications/$/Create`. */
export interface ApplicationCreateDescription {
	/** Full `fabric:/` name. */
	Name: string;
	TypeName: string;
	TypeVersion: string;
	ParameterList?: { Key: string; Value: string }[];
}

/** Body of `/Applications/{id}/$/Upgrade` (the subset this extension sends). */
export interface ApplicationUpgradeDescription {
	Name: string;
	TargetApplicationTypeVersion: string;
	Parameters: { Key: string; Value: string }[];
	UpgradeKind: 'Rolling';
	RollingUpgradeMode: 'Monitored' | 'UnmonitoredAuto' | 'UnmonitoredManual';
	UpgradeReplicaSetCheckTimeoutInSeconds?: number;
	ForceRestart?: boolean;
	InstanceCloseDelayDurationInSeconds?: number;
	/** Durations are milliseconds as strings (the gateway also accepts ISO 8601). */
	MonitoringPolicy?: Record<string, string>;
	ApplicationHealthPolicy?: Record<string, unknown>;
}

/** Encodes an image-store relative path segment by segment, keeping `/` separators. */
export function encodeContentPath(contentPath: string): string {
	return contentPath
		.split(/[\\/]+/)
		.filter(Boolean)
		.map(encodeURIComponent)
		.join('/');
}

/** Per-request overrides for {@link SfRestClient}. */
interface RequestOptions {
	/** Overrides the client's default `api-version` query value. */
	apiVersion?: string;
	/** Skips the bearer token (for endpoints that are anonymous by design). */
	anonymous?: boolean;
	/** JSON request body. */
	body?: unknown;
	/** Binary request body, sent as `application/octet-stream`. Takes precedence over `body`. */
	rawBody?: Buffer;
	/** Extra request headers. */
	headers?: Record<string, string>;
}

/**
 * The gateway answered with an HTTP error. `code` and `detail` carry the
 * `FabricError` payload (e.g. `FABRIC_E_APPLICATION_NOT_FOUND`) when present.
 */
export class SfGatewayError extends Error {
	readonly code: string | undefined;
	readonly detail: string | undefined;

	constructor(
		readonly statusCode: number,
		requestUrl: string,
		body: string,
	) {
		let code: string | undefined;
		let detail: string | undefined;
		try {
			const parsed = JSON.parse(body);
			code = parsed?.Error?.Code ? String(parsed.Error.Code) : undefined;
			detail = parsed?.Error?.Message ? String(parsed.Error.Message) : undefined;
		} catch {
			/* not a FabricError payload */
		}
		const summary = detail ? `${code ? `${code}: ` : ''}${detail}` : body;
		super(`HTTP ${statusCode} from ${requestUrl}${summary ? `: ${summary}` : ''}`);
		this.name = 'SfGatewayError';
		this.code = code;
		this.detail = detail;
	}
}

/** The gateway rejected the request's credentials (HTTP 401/403). */
export class SfAuthError extends Error {
	constructor(
		readonly statusCode: number,
		requestUrl: string,
		body: string,
	) {
		super(
			statusCode === 401
				? `The cluster at ${new url.URL(requestUrl).host} requires authentication (HTTP 401).${body ? ` ${body}` : ''}`
				: `Access denied by the cluster at ${new url.URL(requestUrl).host} (HTTP 403). Your account may not have a role on this cluster.${body ? ` ${body}` : ''}`,
		);
		this.name = 'SfAuthError';
	}
}

function toArray(raw: any): any[] {
	return Array.isArray(raw) ? raw : Array.isArray(raw?.Items) ? raw.Items : [];
}

function toParameterList(raw: any): { key: string; value: string }[] {
	return toArray(raw).map((p) => ({ key: String(p?.Key ?? ''), value: String(p?.Value ?? '') }));
}

function toOptionalNumber(raw: unknown): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

function toApplicationInfo(it: any): ApplicationInfo {
	return {
		id: encodeURIComponent(String(it?.Id ?? '')),
		name: String(it?.Name ?? '').replace(/^fabric:\//, ''),
		typeName: String(it?.TypeName ?? ''),
		typeVersion: String(it?.TypeVersion ?? ''),
		status: String(it?.Status ?? ''),
		healthState: String(it?.HealthState ?? ''),
		parameters: toParameterList(it?.Parameters),
	};
}

function deployedAppPath(nodeName: string, applicationId: string): string {
	return `/Nodes/${encodeURIComponent(nodeName)}/$/GetApplications/${applicationId}`;
}

function replicaOnNodePath(nodeName: string, partitionId: string, replicaId: string): string {
	return `/Nodes/${encodeURIComponent(nodeName)}/$/GetPartitions/${encodeURIComponent(partitionId)}/$/GetReplicas/${encodeURIComponent(replicaId)}`;
}

function wrapError(err: unknown, url: string): Error {
	if (err instanceof Error) {
		const code = (err as NodeJS.ErrnoException).code;
		const msg = err.message || code || 'unknown error';
		return new Error(`Request to ${url} failed: ${msg}${code && !err.message?.includes(code) ? ` (${code})` : ''}`);
	}
	return new Error(`Request to ${url} failed: ${String(err)}`);
}
