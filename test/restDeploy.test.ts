import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
	DeployCancelledError,
	applicationIdOf,
	buildUpgradeDescription,
	deployViaRest,
	parseImageStoreConnectionString,
	planDeploy,
	planUpload,
	removeViaRest,
	type PackageFile,
	type PackageFs,
	type RestDeployClient,
	type RestDeployOptions,
} from '../src/deploy/restDeploy';
import type { ApplicationInfo, ApplicationTypeInfo } from '../src/cluster/sfRestClient';

// ---------------------------------------------------------------------------
// Fake gateway
// ---------------------------------------------------------------------------

interface FakeState {
	imageStore: string;
	types: ApplicationTypeInfo[];
	apps: ApplicationInfo[];
	services: Record<string, string[]>;
	/** Upgrade states returned by successive GetUpgradeProgress calls (last one repeats). */
	upgradeStates: string[];
	failCreate?: boolean;
	failUploadOf?: string;
}

function typeInfo(name: string, version: string, status = 'Available'): ApplicationTypeInfo {
	return { name, version, status, statusDetails: '', defaultParameters: [], definitionKind: 'ServiceFabricApplicationPackage' };
}

function appInfo(name: string, typeName: string, typeVersion: string): ApplicationInfo {
	return { id: applicationIdOf(`fabric:/${name}`), name, typeName, typeVersion, status: 'Ready', healthState: 'Ok', parameters: [] };
}

function fakeClient(initial: Partial<FakeState> = {}): { client: RestDeployClient; calls: string[]; state: FakeState } {
	const state: FakeState = {
		imageStore: 'fabric:ImageStore',
		types: [],
		apps: [],
		services: {},
		upgradeStates: ['RollingForwardCompleted'],
		...initial,
	};
	const calls: string[] = [];
	const uploaded = new Map<string, number>();
	const client: RestDeployClient = {
		async getClusterManifest() {
			return `<ClusterManifest><FabricSettings><Section Name="Management"><Parameter Name="ImageStoreConnectionString" Value="${state.imageStore}" /></Section></FabricSettings></ClusterManifest>`;
		},
		async getApplicationTypes() {
			return state.types.map((t) => ({ ...t }));
		},
		async getApplication(id) {
			return state.apps.find((a) => a.id === id);
		},
		async getApplications() {
			return [...state.apps];
		},
		async getServices(id) {
			return (state.services[id] ?? []).map((name) => ({
				id: encodeURIComponent(name),
				name,
				kind: 'Stateless',
				typeName: '',
				manifestVersion: '',
				healthState: 'Ok',
				status: 'Active',
				hasPersistedState: false,
				isServiceGroup: false,
			}));
		},
		async uploadFile(p, body) {
			calls.push(`upload ${p} ${body.length}`);
			if (state.failUploadOf && p.endsWith(state.failUploadOf)) throw new Error(`upload of ${p} failed`);
			uploaded.set(p, body.length);
		},
		async uploadChunk(p, session, start, end, total) {
			calls.push(`chunk ${p} ${start}-${end}/${total}`);
		},
		async commitUploadSession(session) {
			calls.push(`commit ${session.length > 0}`);
		},
		async deleteUploadSession() {
			calls.push('deleteSession');
		},
		async deleteImageStoreContent(p) {
			calls.push(`deleteStore ${p}`);
		},
		async provisionApplicationType(buildPath) {
			calls.push(`provision ${buildPath}`);
			const [name, version] = buildPath.split('_');
			state.types.push(typeInfo(name, version));
		},
		async unprovisionApplicationType(name, version) {
			calls.push(`unprovision ${name} ${version}`);
			state.types = state.types.filter((t) => !(t.name === name && t.version === version));
		},
		async createApplication(d) {
			calls.push(`create ${d.Name} ${d.TypeVersion} ${JSON.stringify(d.ParameterList)}`);
			if (state.failCreate) throw new Error('create failed');
			state.apps.push(appInfo(d.Name.replace(/^fabric:\//, ''), d.TypeName, d.TypeVersion));
		},
		async upgradeApplication(id, d) {
			calls.push(`upgrade ${id} ${d.TargetApplicationTypeVersion} ${d.RollingUpgradeMode}`);
		},
		async getApplicationUpgradeProgress() {
			const state0 = state.upgradeStates.length > 1 ? state.upgradeStates.shift()! : state.upgradeStates[0];
			return { UpgradeState: state0, FailureReason: state0 === 'RollingBackCompleted' ? 'HealthCheck' : undefined };
		},
		async deleteApplication(id, force) {
			calls.push(`deleteApp ${id}${force ? ' force' : ''}`);
			state.apps = state.apps.filter((a) => a.id !== id);
		},
		async createService(id, d) {
			calls.push(`createService ${String(d.ServiceName)}`);
		},
	};
	return { client, calls, state };
}

const silent = { info() {}, warn() {}, error() {} };

function memoryFs(files: Record<string, number>): PackageFs {
	const list: PackageFile[] = Object.entries(files).map(([rel, size]) => ({ relativePath: rel, absolutePath: `/pkg/${rel}`, size }));
	const dirs = new Set<string>();
	for (const f of list) {
		const parts = f.relativePath.split('/');
		for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
	}
	return {
		async walk() {
			return { files: list, directories: [...dirs] };
		},
		async read(_file, start, end) {
			return Buffer.alloc(end - start);
		},
	};
}

const PACKAGE = {
	'ApplicationManifest.xml': 100,
	'SvcPkg/ServiceManifest.xml': 50,
	'SvcPkg/Code/Svc.dll': 2000,
	'SvcPkg/Config/Settings.xml': 10,
};

function options(overrides: Partial<RestDeployOptions> = {}): RestDeployOptions {
	return {
		packageRoot: '/pkg',
		applicationTypeName: 'MyAppType',
		applicationTypeVersion: '1.0.0',
		applicationName: 'fabric:/MyApp',
		parameters: { Svc_InstanceCount: '1' },
		profile: { overwriteBehavior: 'SameAppTypeAndVersion' },
		fs: memoryFs(PACKAGE),
		pollIntervalMs: 1,
		waitSeconds: 1,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('planDeploy: decision table', () => {
	const target = { applicationName: 'fabric:/MyApp', typeName: 'T', typeVersion: '2' };
	const sameVersion = { typeVersionProvisioned: true, existingApp: { typeName: 'T', typeVersion: '2' } };
	const olderVersion = { typeVersionProvisioned: false, existingApp: { typeName: 'T', typeVersion: '1' } };

	assert.deepEqual(
		{ ...planDeploy({ typeVersionProvisioned: false }, target, { overwriteBehavior: 'Never' }), reason: '' },
		{ deleteExistingApp: false, unprovisionFirst: false, provision: true, action: 'create', reason: '' },
	);
	assert.equal(planDeploy({ typeVersionProvisioned: true }, target, { overwriteBehavior: 'Never' }).provision, false);

	assert.throws(() => planDeploy(sameVersion, target, { overwriteBehavior: 'Never' }), /already exists at version 2/);
	const redeploy = planDeploy(sameVersion, target, { overwriteBehavior: 'SameAppTypeAndVersion' });
	assert.equal(redeploy.deleteExistingApp, true);
	assert.equal(redeploy.unprovisionFirst, true);
	assert.equal(redeploy.provision, true);
	assert.equal(redeploy.action, 'create');

	const upgrade = { enabled: true, mode: 'Monitored' as const, parameters: {} };
	assert.equal(planDeploy(olderVersion, target, { overwriteBehavior: 'Never', upgrade }).action, 'upgrade');
	assert.equal(planDeploy(olderVersion, target, { overwriteBehavior: 'Never', upgrade }).deleteExistingApp, false);
	assert.throws(() => planDeploy(olderVersion, target, { overwriteBehavior: 'SameAppTypeAndVersion' }), /UpgradeDeployment/);
	const replace = planDeploy(olderVersion, target, { overwriteBehavior: 'Always' });
	assert.equal(replace.deleteExistingApp, true);
	assert.equal(replace.action, 'create');

	const otherType = { typeVersionProvisioned: false, existingApp: { typeName: 'Other', typeVersion: '2' } };
	assert.throws(() => planDeploy(otherType, target, { overwriteBehavior: 'SameAppTypeAndVersion' }), /different application type/);
	assert.equal(planDeploy(otherType, target, { overwriteBehavior: 'Always' }).deleteExistingApp, true);
});

test('planUpload: files first, then _.dir markers deepest first with the root last', () => {
	const files: PackageFile[] = [
		{ relativePath: 'ApplicationManifest.xml', absolutePath: '/a', size: 1 },
		{ relativePath: 'S/Code/x.dll', absolutePath: '/b', size: 1 },
	];
	const { fileSteps, markerSteps } = planUpload(files, ['S', 'S/Code', 'S/Config'], 'Root');
	assert.deepEqual(
		fileSteps.map((s) => s.storePath),
		['Root/ApplicationManifest.xml', 'Root/S/Code/x.dll'],
	);
	assert.deepEqual(
		markerSteps.map((s) => s.storePath),
		['Root/S/Code/_.dir', 'Root/S/Config/_.dir', 'Root/S/_.dir', 'Root/_.dir'],
	);
});

test('planUpload: chunking boundaries use inclusive end offsets', () => {
	const at = (size: number) => planUpload([{ relativePath: 'f', absolutePath: '/f', size }], [], 'R', 10).fileSteps[0];
	assert.equal(at(10).kind, 'file');
	const step = at(25);
	assert.equal(step.kind, 'chunked');
	assert.deepEqual(step.kind === 'chunked' ? step.chunks : [], [
		{ start: 0, end: 9 },
		{ start: 10, end: 19 },
		{ start: 20, end: 24 },
	]);
	const exact = at(20);
	assert.deepEqual(exact.kind === 'chunked' ? exact.chunks : [], [
		{ start: 0, end: 9 },
		{ start: 10, end: 19 },
	]);
});

test('buildUpgradeDescription maps profile parameters onto the REST body', () => {
	const { description, warnings } = buildUpgradeDescription(
		'fabric:/MyApp',
		'2.0.0',
		{ A: '1' },
		{
			enabled: true,
			mode: 'Monitored',
			parameters: {
				FailureAction: 'Rollback',
				Force: 'True',
				UpgradeReplicaSetCheckTimeoutSec: '1',
				HealthCheckWaitDurationSec: '30',
				HealthCheckRetryTimeoutSec: '60.5',
				ConsiderWarningAsError: 'true',
				DefaultServiceTypeHealthPolicy: '0,10,20',
				ForceRestart: 'true',
				Bogus: 'x',
			},
		},
	);
	assert.equal(description.RollingUpgradeMode, 'Monitored');
	assert.equal(description.UpgradeKind, 'Rolling');
	assert.deepEqual(description.Parameters, [{ Key: 'A', Value: '1' }]);
	assert.equal(description.UpgradeReplicaSetCheckTimeoutInSeconds, 1);
	assert.equal(description.ForceRestart, true);
	assert.deepEqual(description.MonitoringPolicy, {
		FailureAction: 'Rollback',
		HealthCheckWaitDurationInMilliseconds: '30000',
		HealthCheckRetryTimeoutInMilliseconds: '60500',
	});
	assert.deepEqual(description.ApplicationHealthPolicy, {
		ConsiderWarningAsError: true,
		DefaultServiceTypeHealthPolicy: {
			MaxPercentUnhealthyServices: 0,
			MaxPercentUnhealthyPartitionsPerService: 10,
			MaxPercentUnhealthyReplicasPerPartition: 20,
		},
	});
	assert.deepEqual(warnings, ["Upgrade parameter Bogus isn't supported by the REST engine; ignored."]);
});

test('buildUpgradeDescription: unmonitored upgrades carry no monitoring policy', () => {
	const { description, warnings } = buildUpgradeDescription(
		'fabric:/A',
		'2',
		{},
		{
			enabled: true,
			mode: 'UnmonitoredAuto',
			parameters: { UpgradeReplicaSetCheckTimeoutSec: '1', Force: 'true' },
		},
	);
	assert.equal(description.MonitoringPolicy, undefined);
	assert.equal(description.UpgradeReplicaSetCheckTimeoutInSeconds, 1);
	assert.deepEqual(warnings, []);
});

test('parseImageStoreConnectionString and applicationIdOf', () => {
	assert.equal(
		parseImageStoreConnectionString('<Parameter Name="ImageStoreConnectionString" Value="fabric:ImageStore" />'),
		'fabric:ImageStore',
	);
	assert.equal(parseImageStoreConnectionString('<Parameter Value="xstore:x" Name="ImageStoreConnectionString" />'), 'xstore:x');
	assert.equal(parseImageStoreConnectionString('<x/>'), undefined);
	assert.equal(applicationIdOf('fabric:/MyApp'), 'MyApp');
	assert.equal(applicationIdOf('fabric:/a/b'), 'a~b');
});

// ---------------------------------------------------------------------------
// Engine against the fake gateway
// ---------------------------------------------------------------------------

test('deployViaRest: fresh deploy uploads, provisions, creates, makes startup services and cleans up', async () => {
	const { client, calls } = fakeClient();
	await deployViaRest(
		client,
		options({
			startupServices: [
				{ name: 'Svc', kind: 'Stateless', serviceTypeName: 'SvcType', instanceCount: 1, partition: { scheme: 'Singleton' } },
			],
		}),
		silent,
	);
	const uploads = calls.filter((c) => c.startsWith('upload '));
	assert.equal(uploads.length, 4 + 4); // 4 files + 4 markers (root, SvcPkg, Code, Config)
	assert.ok(uploads.slice(-1)[0].includes('/_.dir 0'));
	const storeRoot = /^upload (MyAppType_1\.0\.0_[0-9a-f]+)\//.exec(uploads[0])?.[1];
	assert.ok(storeRoot);
	const provisionAt = calls.indexOf(`provision ${storeRoot}`);
	const lastUpload = calls.lastIndexOf(uploads.slice(-1)[0]);
	assert.ok(provisionAt > lastUpload, 'provision after all uploads');
	assert.ok(calls.includes(`deleteStore ${storeRoot}`));
	assert.ok(calls.includes('create fabric:/MyApp 1.0.0 [{"Key":"Svc_InstanceCount","Value":"1"}]'));
	assert.equal(calls.at(-1), 'createService fabric:/MyApp/Svc');
});

test('deployViaRest: same version redeploy deletes, unprovisions and re-registers', async () => {
	const { client, calls } = fakeClient({ types: [typeInfo('MyAppType', '1.0.0')], apps: [appInfo('MyApp', 'MyAppType', '1.0.0')] });
	await deployViaRest(client, options(), silent);
	const order = ['deleteApp MyApp', 'unprovision MyAppType 1.0.0'];
	assert.deepEqual(calls.slice(0, 2), order);
	assert.ok(calls.some((c) => c.startsWith('provision ')));
	assert.ok(calls.some((c) => c.startsWith('create fabric:/MyApp 1.0.0')));
});

test('deployViaRest: monitored upgrade to version+1', async () => {
	const { client, calls } = fakeClient({
		types: [typeInfo('MyAppType', '1.0.0')],
		apps: [appInfo('MyApp', 'MyAppType', '1.0.0')],
		upgradeStates: ['RollingForwardInProgress', 'RollingForwardCompleted'],
	});
	await deployViaRest(
		client,
		options({
			applicationTypeVersion: '1.1.0',
			profile: { overwriteBehavior: 'Never', upgrade: { enabled: true, mode: 'Monitored', parameters: {} } },
		}),
		silent,
	);
	assert.ok(calls.includes('upgrade MyApp 1.1.0 Monitored'));
	assert.ok(!calls.some((c) => c.startsWith('create ')));
	assert.ok(!calls.some((c) => c.startsWith('deleteApp')));
});

test('deployViaRest: a rolled-back upgrade is reported and the unused version unprovisioned', async () => {
	const { client, calls } = fakeClient({
		types: [typeInfo('MyAppType', '1.0.0')],
		apps: [appInfo('MyApp', 'MyAppType', '1.0.0')],
		upgradeStates: ['RollingBackInProgress', 'RollingBackCompleted'],
	});
	await assert.rejects(
		deployViaRest(
			client,
			options({
				applicationTypeVersion: '1.1.0',
				profile: { overwriteBehavior: 'Never', upgrade: { enabled: true, mode: 'Monitored', parameters: {} } },
			}),
			silent,
		),
		/was rolled back \(HealthCheck\)/,
	);
	assert.ok(calls.includes('unprovision MyAppType 1.1.0'));
});

test('deployViaRest: failed create unprovisions the version it registered', async () => {
	const { client, calls } = fakeClient({ failCreate: true });
	await assert.rejects(deployViaRest(client, options(), silent), /create failed/);
	assert.ok(calls.includes('unprovision MyAppType 1.0.0'));
});

test('deployViaRest: cancellation mid-upload cleans up the image store', async () => {
	const { client, calls } = fakeClient();
	let uploads = 0;
	const token = {
		get isCancellationRequested() {
			return uploads >= 2;
		},
	};
	const counting: RestDeployClient = {
		...client,
		async uploadFile(p, b) {
			uploads++;
			return client.uploadFile(p, b);
		},
	};
	await assert.rejects(deployViaRest(counting, options({ token }), silent), DeployCancelledError);
	assert.ok(calls.some((c) => c.startsWith('deleteStore MyAppType_1.0.0_')));
	assert.ok(!calls.some((c) => c.startsWith('provision')));
});

test('deployViaRest: an upload failure deletes the partial package', async () => {
	const { client, calls } = fakeClient({ failUploadOf: 'Svc.dll' });
	await assert.rejects(deployViaRest(client, options(), silent), /upload of .*Svc\.dll failed/);
	assert.ok(calls.some((c) => c.startsWith('deleteStore ')));
	assert.ok(!calls.some((c) => c.startsWith('provision')));
});

test('deployViaRest: large files go through an upload session', async () => {
	const { client, calls } = fakeClient();
	await deployViaRest(client, options({ fs: memoryFs({ 'ApplicationManifest.xml': 10, 'big.bin': 9 * 1024 * 1024 }) }), silent);
	assert.equal(calls.filter((c) => c.startsWith('chunk ')).length, 3);
	assert.ok(calls.includes('commit true'));
});

test('deployViaRest: xstore image stores are rejected with the documented message', async () => {
	const { client, calls } = fakeClient({ imageStore: 'xstore:DefaultEndpointsProtocol=https;AccountName=x' });
	await assert.rejects(deployViaRest(client, options(), silent), /image store \(`xstore:`\) can't be uploaded to over the HTTP gateway/);
	assert.deepEqual(calls, []);
});

test('removeViaRest deletes every instance, then unregisters every version', async () => {
	const { client, calls } = fakeClient({
		types: [typeInfo('MyAppType', '1.0.0'), typeInfo('MyAppType', '1.1.0'), typeInfo('Other', '1')],
		apps: [appInfo('MyApp', 'MyAppType', '1.1.0'), appInfo('MyApp2', 'MyAppType', '1.0.0'), appInfo('X', 'Other', '1')],
	});
	assert.equal(await removeViaRest(client, 'MyAppType', silent, { waitSeconds: 1, pollIntervalMs: 1 }), true);
	assert.deepEqual(calls, [
		'deleteApp MyApp force',
		'deleteApp MyApp2 force',
		'unprovision MyAppType 1.0.0',
		'unprovision MyAppType 1.1.0',
	]);
});
