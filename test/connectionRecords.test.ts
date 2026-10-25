import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { definitionOf, mergeConnections, migrateWorkspaceConnections, runtimeOf } from '../src/cluster/connectionRecords';
import type { ClusterConnection } from '../src/cluster/connectionStore';

const PROD: ClusterConnection = {
	id: 'remote:https://prod:19080',
	label: 'Prod',
	endpoint: 'https://prod:19080',
	kind: 'remote',
	connected: true,
	aggregatedHealthState: 'Ok',
	nodes: [],
	clientCert: { path: '/certs/prod.pfx', thumbprint: 'AB12' } as ClusterConnection['clientCert'],
};

test('definitionOf keeps only the cluster description, runtimeOf only the probe state', () => {
	assert.deepEqual(definitionOf(PROD), {
		id: PROD.id,
		label: 'Prod',
		endpoint: PROD.endpoint,
		kind: 'remote',
		clientCert: PROD.clientCert,
	});
	assert.deepEqual(runtimeOf(PROD), { connected: true, aggregatedHealthState: 'Ok', nodes: [] });
});

test('mergeConnections round-trips a connection and starts unseen clusters disconnected', () => {
	const merged = mergeConnections([definitionOf(PROD)], { [PROD.id]: runtimeOf(PROD) });
	assert.deepEqual(merged, [PROD]);
	const unseen = mergeConnections([definitionOf(PROD)], {});
	assert.equal(unseen[0].connected, false);
	assert.equal(unseen[0].aggregatedHealthState, undefined);
});

test('migrateWorkspaceConnections adds new clusters, keeps shared definitions, and keeps the workspace state', () => {
	const shared = [{ ...definitionOf(PROD), label: 'Production' }];
	const local: ClusterConnection = { id: 'local', label: 'Local Cluster', endpoint: 'http://localhost:19080', kind: 'local', connected: false };
	const { definitions, runtime } = migrateWorkspaceConnections(shared, [PROD, { ...local, userDisconnected: true }]);
	assert.deepEqual(
		definitions.map((d) => d.label),
		['Production', 'Local Cluster'],
	);
	assert.deepEqual(runtime[PROD.id], runtimeOf(PROD));
	assert.equal(runtime.local.userDisconnected, true);
});
