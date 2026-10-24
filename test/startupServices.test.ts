import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseStartupServices, toServiceDescription } from '../src/deploy/startupServices';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<StartupServicesManifest xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters>
    <Parameter Name="Web_InstanceCount" DefaultValue="-1" />
    <Parameter Name="Data_TargetReplicaSetSize" DefaultValue="3" />
    <Parameter Name="Data_MinReplicaSetSize" DefaultValue="3" />
    <Parameter Name="Data_PartitionCount" DefaultValue="1" />
  </Parameters>
  <Services>
    <Service Name="Web" ServicePackageActivationMode="ExclusiveProcess">
      <StatelessService ServiceTypeName="WebType" InstanceCount="[Web_InstanceCount]">
        <SingletonPartition />
      </StatelessService>
    </Service>
    <Service Name="Data" ServicePackageActivationMode="ExclusiveProcess">
      <StatefulService ServiceTypeName="DataType" TargetReplicaSetSize="[Data_TargetReplicaSetSize]" MinReplicaSetSize="[Data_MinReplicaSetSize]">
        <UniformInt64Partition PartitionCount="[Data_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />
      </StatefulService>
    </Service>
    <Service Name="Named">
      <StatefulService ServiceTypeName="NamedType" TargetReplicaSetSize="1" MinReplicaSetSize="1">
        <NamedPartition><Partition Name="a" /><Partition Name="b" /></NamedPartition>
      </StatefulService>
    </Service>
  </Services>
</StartupServicesManifest>`;

test('parseStartupServices resolves defaults overlaid with the parameter file', () => {
	const specs = parseStartupServices(XML, { Web_InstanceCount: '1', Data_PartitionCount: '4' });
	assert.equal(specs.length, 3);
	assert.deepEqual(specs[0], {
		name: 'Web',
		kind: 'Stateless',
		serviceTypeName: 'WebType',
		servicePackageActivationMode: 'ExclusiveProcess',
		instanceCount: 1,
		partition: { scheme: 'Singleton' },
	});
	assert.equal(specs[1].targetReplicaSetSize, 3);
	assert.deepEqual(specs[1].partition, {
		scheme: 'UniformInt64Range',
		count: 4,
		lowKey: '-9223372036854775808',
		highKey: '9223372036854775807',
	});
	assert.deepEqual(specs[2].partition, { scheme: 'Named', names: ['a', 'b'] });
});

test('parseStartupServices rejects unknown parameters and non-integers', () => {
	assert.throws(() => parseStartupServices(XML.replace('[Web_InstanceCount]', '[Nope]')), /parameter \[Nope\]/);
	assert.throws(() => parseStartupServices(XML, { Web_InstanceCount: 'many' }), /isn't an integer/);
});

test('toServiceDescription builds the REST body', () => {
	const [web, data, named] = parseStartupServices(XML);
	assert.deepEqual(toServiceDescription(web, 'fabric:/App'), {
		ServiceKind: 'Stateless',
		ApplicationName: 'fabric:/App',
		ServiceName: 'fabric:/App/Web',
		ServiceTypeName: 'WebType',
		PartitionDescription: { PartitionScheme: 'Singleton' },
		ServicePackageActivationMode: 'ExclusiveProcess',
		InstanceCount: -1,
	});
	const d = toServiceDescription(data, 'fabric:/App');
	assert.equal(d.HasPersistedState, true);
	assert.deepEqual(d.PartitionDescription, {
		PartitionScheme: 'UniformInt64Range',
		Count: 1,
		LowKey: '-9223372036854775808',
		HighKey: '9223372036854775807',
	});
	assert.deepEqual(toServiceDescription(named, 'fabric:/App').PartitionDescription, {
		PartitionScheme: 'Named',
		Count: 2,
		Names: ['a', 'b'],
	});
});

test('parseStartupServices: empty manifest', () => {
	assert.deepEqual(parseStartupServices('<StartupServicesManifest><Parameters /><Services /></StartupServicesManifest>'), []);
});
