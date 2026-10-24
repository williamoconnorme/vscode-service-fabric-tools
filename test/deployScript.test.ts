import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parsePublishProfile, resolveApplicationName } from '../src/deploy/deployScript';
import { resolveDeployEngine } from '../src/deploy/deployEngine';

const CLOUD = `<?xml version="1.0" encoding="utf-8"?>
<PublishProfile xmlns="http://schemas.microsoft.com/2015/05/fabrictools">
  <ClusterConnectionParameters ConnectionEndpoint="mycluster.westus.cloudapp.azure.com:19000"
                               X509Credential="true"
                               ServerCertThumbprint="aa bb cc dd ee ff 00 11 22 33 44 55 66 77 88 99 aa bb cc dd"
                               FindType="FindByThumbprint"
                               FindValue="A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
                               StoreLocation="CurrentUser"
                               StoreName="My" />
  <ApplicationParameterFile Path="..\\ApplicationParameters\\Cloud.xml" />
  <StartupServiceParameterFile Path="..\\StartupServiceParameters\\Cloud.xml" />
  <CopyPackageParameters CompressPackage="true" CopyPackageTimeoutSec="900" />
  <UpgradeDeployment Mode="Monitored" Enabled="true">
    <Parameters FailureAction="Rollback" HealthCheckWaitDurationSec="30" Force="True" />
  </UpgradeDeployment>
</PublishProfile>`;

test('parsePublishProfile: X.509 client certificate criteria', () => {
	const p = parsePublishProfile(CLOUD);
	assert.equal(p.isLocal, false);
	assert.equal(p.httpGatewayUrl, 'https://mycluster.westus.cloudapp.azure.com:19080');
	assert.equal(p.usesX509, true);
	assert.equal(p.usesEntra, false);
	assert.equal(p.clientCertFindType, 'FindByThumbprint');
	assert.equal(p.clientCertFindValue, 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678');
	assert.deepEqual(p.serverCertThumbprints, ['AABBCCDDEEFF00112233445566778899AABBCCDD']);
});

test('parsePublishProfile: upgrade and copy settings', () => {
	const p = parsePublishProfile(CLOUD);
	assert.deepEqual(p.upgrade, {
		enabled: true,
		mode: 'Monitored',
		parameters: { FailureAction: 'Rollback', HealthCheckWaitDurationSec: '30', Force: 'True' },
	});
	assert.equal(p.copyPackageTimeoutSec, 900);
	assert.equal(p.compressPackage, true);
});

test('parsePublishProfile: self-closing and missing upgrade blocks, local profiles', () => {
	const local = parsePublishProfile(
		`<PublishProfile><ClusterConnectionParameters /><UpgradeDeployment Mode="UnmonitoredAuto" Enabled="false" /></PublishProfile>`,
	);
	assert.equal(local.isLocal, true);
	assert.equal(local.httpGatewayUrl, 'http://localhost:19080');
	assert.deepEqual(local.upgrade, { enabled: false, mode: 'UnmonitoredAuto', parameters: {} });
	assert.equal(local.usesX509, undefined);
	const none = parsePublishProfile('<PublishProfile />');
	assert.equal(none.upgrade, undefined);
	assert.equal(none.copyPackageTimeoutSec, undefined);
});

test('parsePublishProfile: FindBySubjectName', () => {
	const p = parsePublishProfile(
		`<PublishProfile><ClusterConnectionParameters ConnectionEndpoint="h:19000" X509Credential="true" FindType="FindBySubjectName" FindValue="CN=sf-admin" /></PublishProfile>`,
	);
	assert.equal(p.clientCertFindType, 'FindBySubjectName');
	assert.equal(p.clientCertFindValue, 'CN=sf-admin');
});

test('resolveApplicationName: parameter file name wins, else the type name without "Type"', () => {
	assert.equal(resolveApplicationName('MyAppType'), 'fabric:/MyApp');
	assert.equal(resolveApplicationName('MyApp'), 'fabric:/MyApp');
	assert.equal(
		resolveApplicationName('MyAppType', '<Application Name="fabric:/Custom/Name" xmlns="x"><Parameters /></Application>'),
		'fabric:/Custom/Name',
	);
	assert.equal(resolveApplicationName('MyAppType', '<Application xmlns="x" />'), 'fabric:/MyApp');
});

test('resolveDeployEngine', () => {
	assert.deepEqual(resolveDeployEngine('auto', 'win32'), { engine: 'rest' });
	assert.deepEqual(resolveDeployEngine(undefined, 'win32'), { engine: 'rest' });
	assert.deepEqual(resolveDeployEngine(undefined, 'darwin'), { engine: 'rest' });
	assert.deepEqual(resolveDeployEngine('rest', 'win32'), { engine: 'rest' });
	assert.deepEqual(resolveDeployEngine('powershell', 'win32'), { engine: 'powershell' });
	const err = resolveDeployEngine('powershell', 'linux');
	assert.ok('error' in err && /rest/.test(err.error));
});
