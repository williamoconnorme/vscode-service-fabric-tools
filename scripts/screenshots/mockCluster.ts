/**
 * A fake Service Fabric HTTP gateway serving made-up "Contoso" data, for the
 * Marketplace screenshots. Answers the GET calls the Clusters view, status bar
 * and Publish picker make; everything else is 404.
 */
import * as http from 'http';

type Health = 'Ok' | 'Warning' | 'Error';

interface App {
	name: string;
	typeName: string;
	typeVersion: string;
	status: string;
	health: Health;
	services: Svc[];
}

interface Svc {
	name: string;
	typeName: string;
	kind: 'Stateless' | 'Stateful';
	health: Health;
	partitions: number;
}

const NODES: { name: string; type: string; health: Health }[] = [
	{ name: '_FrontEnd_0', type: 'FrontEnd', health: 'Ok' },
	{ name: '_FrontEnd_1', type: 'FrontEnd', health: 'Ok' },
	{ name: '_BackEnd_0', type: 'BackEnd', health: 'Ok' },
	{ name: '_BackEnd_1', type: 'BackEnd', health: 'Warning' },
	{ name: '_BackEnd_2', type: 'BackEnd', health: 'Ok' },
];

const APPS: App[] = [
	{
		name: 'Contoso.Store',
		typeName: 'Contoso.StoreType',
		typeVersion: '1.4.0',
		status: 'Upgrading',
		health: 'Ok',
		services: [
			{ name: 'Web', typeName: 'WebType', kind: 'Stateless', health: 'Ok', partitions: 1 },
			{ name: 'Catalog', typeName: 'CatalogType', kind: 'Stateful', health: 'Ok', partitions: 3 },
			{ name: 'Cart', typeName: 'CartActorServiceType', kind: 'Stateful', health: 'Ok', partitions: 2 },
			{ name: 'Gateway', typeName: 'GatewayType', kind: 'Stateless', health: 'Ok', partitions: 1 },
		],
	},
	{
		name: 'Contoso.Analytics',
		typeName: 'Contoso.AnalyticsType',
		typeVersion: '2.1.0',
		status: 'Ready',
		health: 'Warning',
		services: [
			{ name: 'Ingest', typeName: 'IngestType', kind: 'Stateless', health: 'Ok', partitions: 1 },
			{ name: 'Aggregator', typeName: 'AggregatorType', kind: 'Stateful', health: 'Warning', partitions: 2 },
		],
	},
	{
		name: 'Contoso.Notifications',
		typeName: 'Contoso.NotificationsType',
		typeVersion: '1.2.3',
		status: 'Ready',
		health: 'Error',
		services: [{ name: 'Sender', typeName: 'SenderType', kind: 'Stateless', health: 'Error', partitions: 1 }],
	},
	{
		name: 'Contoso.Identity',
		typeName: 'Contoso.IdentityType',
		typeVersion: '3.0.1',
		status: 'Ready',
		health: 'Ok',
		services: [{ name: 'Tokens', typeName: 'TokensType', kind: 'Stateful', health: 'Ok', partitions: 1 }],
	},
];

const SYSTEM = ['ClusterManagerService', 'FailoverManagerService', 'ImageStoreService', 'NamingService', 'RepairManagerService', 'UpgradeService'];

const appId = (name: string): string => name.replace(/\//g, '~');
const guid = (seed: string): string => {
	let h = 0;
	for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	const hex = (n: number, len: number): string => ((h * (n + 7)) >>> 0).toString(16).padStart(8, '0').slice(0, len);
	return `${hex(1, 8)}-${hex(2, 4)}-4${hex(3, 3)}-a${hex(4, 3)}-${hex(5, 8)}${hex(6, 4)}`;
};

function partitionsOf(app: App, svc: Svc): unknown[] {
	return Array.from({ length: svc.partitions }, (_, i) => {
		const id = guid(`${app.name}/${svc.name}/${i}`);
		const info =
			svc.partitions === 1
				? { ServicePartitionKind: 'Singleton', Id: id }
				: { ServicePartitionKind: 'Int64Range', Id: id, LowKey: String(i * 1000), HighKey: String(i * 1000 + 999) };
		return {
			ServiceKind: svc.kind,
			PartitionInformation: info,
			PartitionStatus: 'Ready',
			HealthState: i === 1 && svc.health === 'Warning' ? 'Warning' : svc.health === 'Error' ? 'Error' : 'Ok',
			...(svc.kind === 'Stateful' ? { TargetReplicaSetSize: 3, MinReplicaSetSize: 2 } : { InstanceCount: -1 }),
		};
	});
}

function replicasOf(partitionId: string): unknown[] {
	for (const app of APPS) {
		for (const svc of app.services) {
			const parts = partitionsOf(app, svc) as { PartitionInformation: { Id: string } }[];
			const index = parts.findIndex((p) => p.PartitionInformation.Id === partitionId);
			if (index < 0) continue;
			const count = svc.kind === 'Stateful' ? 3 : NODES.length;
			return Array.from({ length: count }, (_, i) => ({
				ServiceKind: svc.kind,
				ReplicaId: String(132000000000000000 + index * 10 + i),
				InstanceId: String(132000000000000000 + index * 10 + i),
				ReplicaRole: svc.kind === 'Stateful' ? (i === 0 ? 'Primary' : 'ActiveSecondary') : undefined,
				ReplicaStatus: 'Ready',
				HealthState: svc.health === 'Error' && i === 0 ? 'Error' : 'Ok',
				NodeName: NODES[(index + i) % NODES.length].name,
				Address: '{"Endpoints":{"":"http://10.0.0.4:8080"}}',
			}));
		}
	}
	return [];
}

const UPGRADE = {
	Name: 'fabric:/Contoso.Store',
	TypeName: 'Contoso.StoreType',
	TargetApplicationTypeVersion: '1.5.0',
	UpgradeState: 'RollingForwardInProgress',
	RollingUpgradeMode: 'Monitored',
	NextUpgradeDomain: '3',
	CurrentUpgradeDomainProgress: { DomainName: '2', NodeUpgradeProgressList: [] },
	UpgradeDomains: ['0', '1', '2', '3', '4'].map((n, i) => ({ Name: n, State: i < 2 ? 'Completed' : i === 2 ? 'InProgress' : 'Pending' })),
	StartTimestampUtc: '2026-10-24T09:12:00.000Z',
};

const list = (items: unknown[]): unknown => ({ ContinuationToken: '', Items: items });

function route(pathname: string): unknown | undefined {
	const p = decodeURIComponent(pathname).replace(/\/$/, '') || '/';
	if (p === '/$/GetClusterHealth') return { AggregatedHealthState: 'Ok', HealthEvents: [] };
	if (p === '/$/GetClusterVersion') return { Version: '10.1.2493.9590' };
	if (p === '/$/GetClusterManifest') {
		return {
			Manifest:
				'<ClusterManifest><FabricSettings><Section Name="Management"><Parameter Name="ImageStoreConnectionString" Value="fabric:ImageStore" /></Section></FabricSettings></ClusterManifest>',
		};
	}
	if (p === '/$/GetRepairTaskList') {
		return [
			{ TaskId: 'Azure/PlatformUpdate/7c1e', Version: '12', State: 'Executing', Action: 'System.Azure.Job.PlatformUpdate', Target: { Kind: 'Node', NodeNames: ['_BackEnd_1'] }, Executor: 'fabric:/System/InfrastructureService', History: { CreatedUtcTimestamp: '2026-10-24T08:40:00Z' } },
			{ TaskId: 'Azure/TenantUpdate/31aa', Version: '9', State: 'Completed', ResultStatus: 'Succeeded', Action: 'System.Azure.Job.TenantUpdate', Target: { Kind: 'Node', NodeNames: ['_FrontEnd_0'] }, Executor: 'fabric:/System/InfrastructureService', History: { CreatedUtcTimestamp: '2026-10-22T03:10:00Z', CompletedUtcTimestamp: '2026-10-22T03:31:00Z' } },
		];
	}
	if (p === '/Nodes') return list(NODES.map((n) => ({ Name: n.name, NodeStatus: 'Up', HealthState: n.health, Type: n.type, IpAddressOrFQDN: '10.0.0.4', UpgradeDomain: n.name.slice(-1), FaultDomain: `fd:/${n.name.slice(-1)}` })));
	if (p === '/ApplicationTypes') {
		return list([
			...APPS.map((a) => ({ Name: a.typeName, Version: a.typeVersion, Status: 'Available', ApplicationTypeDefinitionKind: 'ServiceFabricApplicationPackage' })),
			{ Name: 'Contoso.StoreType', Version: '1.5.0', Status: 'Available', ApplicationTypeDefinitionKind: 'ServiceFabricApplicationPackage' },
		]);
	}
	const appJson = (a: App): unknown => ({
		Id: appId(a.name),
		Name: `fabric:/${a.name}`,
		TypeName: a.typeName,
		TypeVersion: a.typeVersion,
		Status: a.status,
		HealthState: a.health,
		Parameters: [{ Key: 'Web_InstanceCount', Value: '-1' }],
	});
	if (p === '/Applications') return list(APPS.map(appJson));
	let m = /^\/Applications\/([^/]+)$/.exec(p);
	if (m) {
		const a = APPS.find((x) => appId(x.name) === m![1]);
		return a ? appJson(a) : undefined;
	}
	m = /^\/Applications\/([^/]+)\/\$\/GetUpgradeProgress$/.exec(p);
	if (m) return m[1] === 'Contoso.Store' ? UPGRADE : { UpgradeState: 'RollingForwardCompleted' };
	m = /^\/Applications\/([^/]+)\/\$\/GetServices$/.exec(p);
	if (m) {
		if (m[1] === 'System') {
			return list(SYSTEM.map((s) => ({ Id: `System~${s}`, Name: `fabric:/System/${s}`, ServiceKind: 'Stateful', TypeName: `${s}Type`, HealthState: 'Ok', ServiceStatus: 'Active', HasPersistedState: true })));
		}
		const a = APPS.find((x) => appId(x.name) === m![1]);
		if (!a) return undefined;
		return list(
			a.services.map((s) => ({
				Id: `${appId(a.name)}~${s.name}`,
				Name: `fabric:/${a.name}/${s.name}`,
				ServiceKind: s.kind,
				TypeName: s.typeName,
				ManifestVersion: a.typeVersion,
				HealthState: s.health,
				ServiceStatus: 'Active',
				HasPersistedState: s.kind === 'Stateful',
			})),
		);
	}
	m = /^\/Services\/([^/]+)\/\$\/GetPartitions$/.exec(p);
	if (m) {
		for (const a of APPS) for (const s of a.services) if (`${appId(a.name)}~${s.name}` === m[1]) return list(partitionsOf(a, s));
		if (m[1].startsWith('System~')) return list([{ ServiceKind: 'Stateful', PartitionInformation: { ServicePartitionKind: 'Singleton', Id: guid(m[1]) }, PartitionStatus: 'Ready', HealthState: 'Ok', TargetReplicaSetSize: 5, MinReplicaSetSize: 3 }]);
		return undefined;
	}
	m = /^\/Partitions\/([^/]+)\/\$\/GetReplicas$/.exec(p);
	if (m) return list(replicasOf(m[1]));
	m = /^\/Nodes\/([^/]+)\/\$\/GetApplications$/.exec(p);
	if (m) return list(APPS.slice(0, 3).map((a) => ({ Id: appId(a.name), Name: `fabric:/${a.name}`, TypeName: a.typeName, Status: 'Active', HealthState: a.health })));
	return undefined;
}

/** Starts the fake gateway on `port`; resolves with a function that stops it. */
export function startMockCluster(port: number): Promise<() => Promise<void>> {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://localhost:${port}`);
		const body = req.method === 'GET' ? route(url.pathname) : undefined;
		if (body === undefined) {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ Error: { Code: 'FABRIC_E_DOES_NOT_EXIST', Message: 'Not found' } }));
			return;
		}
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(body));
	});
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(() => new Promise((r) => server.close(() => r())))));
}
