import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	applyApplicationBump,
	applyServiceBump,
	describeVersionBump,
	incrementVersion,
	manifestContentHash,
	planHasChanges,
	planVersionBump,
	readPackageState,
	type ApplicationPackageState,
} from '../src/deploy/versionBump';

test('incrementVersion raises the last number', () => {
	assert.equal(incrementVersion('1.0.0'), '1.0.1');
	assert.equal(incrementVersion('2.3'), '2.4');
	assert.equal(incrementVersion('1.0.9'), '1.0.10');
	assert.equal(incrementVersion('1.0.09'), '1.0.10');
	assert.equal(incrementVersion('1.0-beta'), '1.0-beta.1');
	assert.equal(incrementVersion('v7'), 'v8');
});

const state = (appVersion: string, web: [string, string, string], api: [string, string]): ApplicationPackageState => ({
	applicationTypeName: 'AppType',
	applicationTypeVersion: appVersion,
	services: {
		WebPkg: {
			version: web[0],
			manifestHash: 'web-manifest',
			packages: {
				Code: { kind: 'Code', version: web[1], hash: web[2] },
				Config: { kind: 'Config', version: '1.0.0', hash: 'web-config' },
			},
		},
		ApiPkg: { version: api[0], manifestHash: 'api-manifest', packages: { Code: { kind: 'Code', version: '1.0.0', hash: api[1] } } },
	},
});

test('with a baseline, only the changed package, its service and the application are bumped', () => {
	const baseline = state('1.0.0', ['1.0.0', '1.0.0', 'web-v1'], ['1.0.0', 'api-v1']);
	const current = state('1.0.0', ['1.0.0', '1.0.0', 'web-v2'], ['1.0.0', 'api-v1']);
	const plan = planVersionBump(current, baseline, '1.0.0');
	assert.equal(plan.changedOnly, true);
	assert.deepEqual(plan.application, { from: '1.0.0', to: '1.0.1' });
	assert.deepEqual(plan.services, [{ name: 'WebPkg', from: '1.0.0', to: '1.0.1', packages: [{ name: 'Code', kind: 'Code', from: '1.0.0', to: '1.0.1' }] }]);
	assert.deepEqual(describeVersionBump(plan, 'AppType'), ['AppType: 1.0.0 → 1.0.1', 'WebPkg: 1.0.0 → 1.0.1 (Code 1.0.0 → 1.0.1)']);
});

test('nothing changed: only the application version moves (a config-free upgrade)', () => {
	const baseline = state('1.0.0', ['1.0.0', '1.0.0', 'web-v1'], ['1.0.0', 'api-v1']);
	const plan = planVersionBump(structuredClone(baseline), baseline, '1.0.0');
	assert.deepEqual(plan.services, []);
	assert.deepEqual(plan.application, { from: '1.0.0', to: '1.0.1' });
	assert.equal(planHasChanges(plan), true);
});

test('versions raised by hand are kept; changed packages left behind are still bumped', () => {
	const baseline = state('1.0.0', ['1.0.0', '1.0.0', 'web-v1'], ['1.0.0', 'api-v1']);
	// App and Web bumped by hand; Api's code changed but nobody bumped it.
	const current = state('1.1.0', ['1.1.0', '1.1.0', 'web-v2'], ['1.0.0', 'api-v2']);
	const plan = planVersionBump(current, baseline, '1.0.0');
	assert.equal(plan.application, undefined);
	assert.deepEqual(plan.services, [{ name: 'ApiPkg', from: '1.0.0', to: '1.0.1', packages: [{ name: 'Code', kind: 'Code', from: '1.0.0', to: '1.0.1' }] }]);
	// Everything raised by hand: nothing to do.
	assert.equal(planHasChanges(planVersionBump(state('1.1.0', ['1.1.0', '1.1.0', 'web-v2'], ['1.1.0', 'api-v1']), baseline, '1.0.0')), false);
});

test('a package bumped by hand still needs its service manifest bumped', () => {
	const baseline = state('1.0.0', ['1.0.0', '1.0.0', 'web-v1'], ['1.0.0', 'api-v1']);
	const current = state('1.0.0', ['1.0.0', '1.0.5', 'web-v2'], ['1.0.0', 'api-v1']);
	const plan = planVersionBump(current, baseline, '1.0.0');
	assert.deepEqual(plan.services, [{ name: 'WebPkg', from: '1.0.0', to: '1.0.1', packages: [] }]);
});

test('without a baseline for the deployed version, every service and package is bumped', () => {
	const current = state('1.0.0', ['1.0.0', '1.0.0', 'web-v1'], ['1.0.0', 'api-v1']);
	const stale = state('0.9.0', ['1.0.0', '1.0.0', 'web-v1'], ['1.0.0', 'api-v1']);
	for (const baseline of [undefined, stale]) {
		const plan = planVersionBump(current, baseline, '1.0.0');
		assert.equal(plan.changedOnly, false);
		assert.deepEqual(
			plan.services.map((s) => [s.name, s.to, s.packages.map((p) => p.name)]),
			[
				['WebPkg', '1.0.1', ['Code', 'Config']],
				['ApiPkg', '1.0.1', ['Code']],
			],
		);
	}
});

test('new services and packages are left alone', () => {
	const baseline = state('1.0.0', ['1.0.0', '1.0.0', 'web-v1'], ['1.0.0', 'api-v1']);
	delete baseline.services.ApiPkg;
	delete baseline.services.WebPkg.packages.Config;
	const plan = planVersionBump(state('1.0.0', ['1.0.0', '1.0.0', 'web-v1'], ['1.0.0', 'api-v1']), baseline, '1.0.0');
	assert.deepEqual(plan.services, []);
});

const SM = `<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="WebPkg" Version="1.0.0" xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <ServiceTypes><StatelessServiceType ServiceTypeName="WebType" /></ServiceTypes>
  <CodePackage Name="Code" Version="1.0.0">
    <EntryPoint><ExeHost><Program>Web.exe</Program></ExeHost></EntryPoint>
  </CodePackage>
  <ConfigPackage Name="Config" Version="1.0.0" />
</ServiceManifest>
`;
const AM = `<?xml version="1.0" encoding="utf-8"?>
<ApplicationManifest ApplicationTypeName="AppType" ApplicationTypeVersion="1.0.0" xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="WebPkg" ServiceManifestVersion="1.0.0" />
  </ServiceManifestImport>
  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="ApiPkg" ServiceManifestVersion="1.0.0" />
  </ServiceManifestImport>
</ApplicationManifest>
`;

test('applyServiceBump and applyApplicationBump rewrite only the versions, keeping formatting', () => {
	const svc = { name: 'WebPkg', from: '1.0.0', to: '1.0.1', packages: [{ name: 'Code', kind: 'Code' as const, from: '1.0.0', to: '1.0.1' }] };
	const sm = applyServiceBump(SM, svc);
	assert.equal(sm, SM.replace('Name="WebPkg" Version="1.0.0"', 'Name="WebPkg" Version="1.0.1"').replace('Name="Code" Version="1.0.0"', 'Name="Code" Version="1.0.1"'));
	const am = applyApplicationBump(AM, { application: { from: '1.0.0', to: '1.0.1' }, services: [svc], changedOnly: true });
	assert.equal(
		am,
		AM.replace('ApplicationTypeVersion="1.0.0"', 'ApplicationTypeVersion="1.0.1"').replace(
			'ServiceManifestName="WebPkg" ServiceManifestVersion="1.0.0"',
			'ServiceManifestName="WebPkg" ServiceManifestVersion="1.0.1"',
		),
	);
	assert.equal(manifestContentHash(sm), manifestContentHash(SM), 'version edits do not change the manifest hash');
});

test('readPackageState reads versions and hashes package folders from disk', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pkg-'));
	try {
		fs.writeFileSync(path.join(root, 'ApplicationManifest.xml'), AM);
		fs.mkdirSync(path.join(root, 'WebPkg', 'Code', 'sub'), { recursive: true });
		fs.mkdirSync(path.join(root, 'WebPkg', 'Config'), { recursive: true });
		fs.writeFileSync(path.join(root, 'WebPkg', 'ServiceManifest.xml'), SM);
		fs.writeFileSync(path.join(root, 'WebPkg', 'Code', 'Web.exe'), 'v1');
		fs.writeFileSync(path.join(root, 'WebPkg', 'Code', 'sub', 'lib.dll'), 'lib');
		fs.writeFileSync(path.join(root, 'WebPkg', 'Config', 'Settings.xml'), '<Settings/>');
		const first = await readPackageState(root);
		assert.equal(first.applicationTypeVersion, '1.0.0');
		assert.deepEqual(Object.keys(first.services), ['WebPkg'], 'ApiPkg has no folder and is skipped');
		assert.equal(first.services.WebPkg.packages.Code.kind, 'Code');
		assert.match(first.services.WebPkg.packages.Code.hash, /^[0-9a-f]{64}$/);

		fs.writeFileSync(path.join(root, 'WebPkg', 'Code', 'Web.exe'), 'v2');
		const second = await readPackageState(root);
		assert.notEqual(second.services.WebPkg.packages.Code.hash, first.services.WebPkg.packages.Code.hash);
		assert.equal(second.services.WebPkg.packages.Config.hash, first.services.WebPkg.packages.Config.hash);
		const plan = planVersionBump(second, first, '1.0.0');
		assert.deepEqual(describeVersionBump(plan, 'AppType'), ['AppType: 1.0.0 → 1.0.1', 'WebPkg: 1.0.0 → 1.0.1 (Code 1.0.0 → 1.0.1)']);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
