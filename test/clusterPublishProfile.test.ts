import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
	addSfprojNoneItem,
	buildPublishProfileForCluster,
	gatewayKey,
	profileFileNameFor,
	profileTargetsConnection,
	type ProfileConnection,
} from '../src/deploy/clusterPublishProfile';
import { parsePublishProfile } from '../src/deploy/deployScript';

const entra: ProfileConnection = {
	endpoint: 'https://prod.westeurope.cloudapp.azure.com:19080',
	kind: 'remote',
	auth: { type: 'entra', authority: 'https://login.microsoftonline.com', tenantId: 't', clusterApplicationId: 'c', clientApplicationId: 'n' } as ProfileConnection['auth'],
	serverCert: { thumbprints: ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'] },
};

test('Entra ID connection: VS-style endpoint, AAD flag and server thumbprints round-trip', () => {
	const xml = buildPublishProfileForCluster(entra, { applicationParameterFile: '..\\ApplicationParameters\\Cloud.xml' });
	assert.match(xml, /ConnectionEndpoint="prod\.westeurope\.cloudapp\.azure\.com:19000"/);
	const p = parsePublishProfile(xml);
	assert.equal(p.isLocal, false);
	assert.equal(p.httpGatewayUrl, entra.endpoint);
	assert.equal(p.usesEntra, true);
	assert.deepEqual(p.serverCertThumbprints, ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB']);
	assert.equal(p.applicationParameterFile, '..\\ApplicationParameters\\Cloud.xml');
	assert.deepEqual(p.upgrade, { enabled: true, mode: 'Monitored', parameters: { FailureAction: 'Rollback', Force: 'True' } });
	assert.equal(profileTargetsConnection(xml, entra), true);
});

test('client-certificate connection references the certificate by thumbprint only', () => {
	const conn: ProfileConnection = {
		endpoint: 'https://test.example.com:19080',
		kind: 'remote',
		serverCert: { thumbprints: ['CC33'] },
		clientCert: { path: 'C:\\secret\\admin.pfx', thumbprint: 'DD44', hasPassphrase: true } as ProfileConnection['clientCert'],
	};
	const xml = buildPublishProfileForCluster(conn);
	assert.doesNotMatch(xml, /admin\.pfx|secret/);
	const p = parsePublishProfile(xml);
	assert.equal(p.usesX509, true);
	assert.equal(p.clientCertFindType, 'FindByThumbprint');
	assert.equal(p.clientCertFindValue, 'DD44');
	assert.equal(p.httpGatewayUrl, conn.endpoint);
	assert.equal(profileTargetsConnection(xml, conn), true);
});

test('gateways the host:19000 form cannot express are written as URLs with a note', () => {
	for (const endpoint of ['https://pinned.example.com:19080', 'http://dev.example.com:8080', 'https://custom.example.com:443']) {
		const conn: ProfileConnection = { endpoint, kind: 'remote', serverCert: { thumbprints: ['EE55'] } };
		const xml = buildPublishProfileForCluster(conn);
		assert.match(xml, /HTTP gateway URL/, endpoint);
		assert.equal(gatewayKey(parsePublishProfile(xml).httpGatewayUrl!), gatewayKey(endpoint), endpoint);
	}
	const plain = buildPublishProfileForCluster({ endpoint: 'http://dev.example.com:19080', kind: 'remote' });
	assert.match(plain, /ConnectionEndpoint="dev\.example\.com:19000"/);
	assert.doesNotMatch(plain, /HTTP gateway URL/);
});

test('local connection writes an empty ClusterConnectionParameters and matches local profiles only', () => {
	const local: ProfileConnection = { endpoint: 'http://localhost:19080', kind: 'local' };
	const xml = buildPublishProfileForCluster(local, { startupServiceParameterFile: '..\\StartupServiceParameters\\Local.1Node.xml' });
	assert.match(xml, /<ClusterConnectionParameters \/>/);
	assert.equal(parsePublishProfile(xml).isLocal, true);
	assert.equal(profileTargetsConnection(xml, local), true);
	assert.equal(profileTargetsConnection(xml, entra), false);
	assert.equal(profileTargetsConnection(buildPublishProfileForCluster(entra), local), false);
});

test('profileTargetsConnection compares gateways ignoring host case and default ports', () => {
	const xml = `<PublishProfile><ClusterConnectionParameters ConnectionEndpoint="https://PROD.example.com:443" /></PublishProfile>`;
	assert.equal(profileTargetsConnection(xml, { endpoint: 'https://prod.example.com', kind: 'remote' }), true);
	assert.equal(profileTargetsConnection(xml, { endpoint: 'https://prod.example.com:19080', kind: 'remote' }), false);
	assert.equal(profileTargetsConnection('not xml', { endpoint: 'https://prod.example.com', kind: 'remote' }), false);
});

test('profileFileNameFor makes a safe file name from a cluster label', () => {
	assert.equal(profileFileNameFor('prod-westeu'), 'prod-westeu');
	assert.equal(profileFileNameFor('My Cluster: prod/eu'), 'My-Cluster-prod-eu');
	assert.equal(profileFileNameFor('  ...  '), 'Cluster');
});

test('addSfprojNoneItem inserts next to the folder\'s items, keeps CRLF and is idempotent', () => {
	const xml = [
		'<Project>',
		'  <ItemGroup>',
		'    <None Include="ApplicationParameters\\Cloud.xml" />',
		'    <None Include="PublishProfiles\\Cloud.xml" />',
		'    <None Include="PublishProfiles\\Local.1Node.xml" />',
		'    <None Include="Scripts\\Deploy-FabricApplication.ps1" />',
		'  </ItemGroup>',
		'</Project>',
		'',
	].join('\r\n');
	const out = addSfprojNoneItem(xml, 'PublishProfiles\\prod.xml');
	assert.match(out, /Local\.1Node\.xml" \/>\r\n    <None Include="PublishProfiles\\prod\.xml" \/>\r\n    <None Include="Scripts/);
	assert.equal(addSfprojNoneItem(out, 'PublishProfiles\\PROD.xml'), out);
});

test('addSfprojNoneItem adds an ItemGroup when the project lists no files', () => {
	const out = addSfprojNoneItem('<Project>\n</Project>\n', 'PublishProfiles\\prod.xml');
	assert.equal(out, '<Project>\n  <ItemGroup>\n    <None Include="PublishProfiles\\prod.xml" />\n  </ItemGroup>\n</Project>\n');
});
