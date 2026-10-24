import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isAttachableCluster } from '../src/debug/attachConfig';
import { resolveApplicationPackageRoot, type ProbeFs } from '../src/deploy/packageResolver';
import { buildCsharpCsproj, buildServiceManifestXml } from '../src/scaffold/addServiceTemplates';
import { buildServiceManifestXml as buildSeededManifest } from '../src/scaffold/createApplicationTemplates';

test('isAttachableCluster: local or loopback on Windows only', () => {
	assert.equal(isAttachableCluster({ kind: 'local', endpoint: 'http://localhost:19080' }, 'me', 'win32'), true);
	assert.equal(isAttachableCluster({ kind: 'remote', endpoint: 'http://127.0.0.1:19080' }, 'me', 'win32'), true);
	assert.equal(isAttachableCluster({ kind: 'remote', endpoint: 'https://me:19080' }, 'ME', 'win32'), true);
	assert.equal(isAttachableCluster({ kind: 'remote', endpoint: 'https://c.westus.cloudapp.azure.com:19080' }, 'me', 'win32'), false);
	assert.equal(isAttachableCluster({ kind: 'local', endpoint: 'http://localhost:19080' }, 'me', 'darwin'), false);
});

test('resolveApplicationPackageRoot finds a nested package on POSIX paths', async () => {
	// `dotnet msbuild /t:Package` lays the package out as pkg/Debug/<App>/.
	const manifest = '/repo/MyApp/pkg/Debug/MyApp/ApplicationManifest.xml';
	const fs: ProbeFs = {
		async pathExists(p) {
			return p === manifest || p === '/repo/MyApp/pkg/Debug' || p === '/repo/MyApp/pkg/Debug/MyApp';
		},
		async readDirectories(p) {
			return p === '/repo/MyApp/pkg/Debug' ? ['MyApp'] : [];
		},
	};
	const resolved = await resolveApplicationPackageRoot([{ path: '/repo/MyApp/pkg/Debug', source: 'default' }], fs, { searchMaxDepth: 2 });
	assert.equal(resolved.path, '/repo/MyApp/pkg/Debug/MyApp');
});

test('scaffolding: Linux target uses linux-x64 and a Program without .exe', () => {
	const t = { serviceName: 'Svc', serviceTypeName: 'SvcType', kind: 'stateless' as const, version: '1.0.0', runtime: 'netcore' as const };
	assert.match(buildCsharpCsproj({ ...t, targetOs: 'linux' }), /<RuntimeIdentifier>linux-x64<\/RuntimeIdentifier>/);
	assert.match(buildCsharpCsproj(t), /<RuntimeIdentifier>win-x64<\/RuntimeIdentifier>/);
	assert.match(buildServiceManifestXml({ ...t, targetOs: 'linux' }), /<Program>Svc<\/Program>/);
	assert.match(buildServiceManifestXml(t), /<Program>Svc\.exe<\/Program>/);
	const seeded = { applicationName: 'App', serviceName: 'Svc', projectGuid: '00000000-0000-0000-0000-000000000000' };
	assert.match(buildSeededManifest({ ...seeded, targetOs: 'linux' }), /<Program>Svc<\/Program>/);
	assert.match(buildSeededManifest(seeded), /<Program>Svc\.exe<\/Program>/);
});
