import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { applicationParameterDeclarations, parseXmlOutline } from '../src/util/xmlOutline';

const APP = `<?xml version="1.0" encoding="utf-8"?>
<!-- <Parameters><Parameter Name="Commented" /></Parameters> -->
<ApplicationManifest xmlns="http://schemas.microsoft.com/2011/01/fabric" ApplicationTypeName="ShopType" ApplicationTypeVersion="1.0.0">
  <Parameters>
    <Parameter Name="Web_InstanceCount" DefaultValue="-1" />
    <Parameter Name="Data_PartitionCount" DefaultValue="1" />
  </Parameters>
  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="WebPkg" ServiceManifestVersion="1.0.0" />
    <ConfigOverrides>
      <ConfigOverride Name="Config">
        <Settings>
          <Section Name="Web">
            <Parameter Name="InstanceCount" Value="[Web_InstanceCount]" />
          </Section>
        </Settings>
      </ConfigOverride>
    </ConfigOverrides>
  </ServiceManifestImport>
</ApplicationManifest>
`;

test('parseXmlOutline builds the element tree and names elements by their Name-like attribute', () => {
	const roots = parseXmlOutline(APP);
	assert.equal(roots.length, 1);
	const root = roots[0];
	assert.equal(root.element, 'ApplicationManifest');
	assert.equal(root.nameValue, 'ShopType');
	assert.deepEqual(
		root.children.map((c) => c.element),
		['Parameters', 'ServiceManifestImport'],
	);
	const params = root.children[0];
	assert.deepEqual(
		params.children.map((c) => c.nameValue),
		['Web_InstanceCount', 'Data_PartitionCount'],
	);
	const ref = root.children[1].children[0];
	assert.equal(ref.element, 'ServiceManifestRef');
	assert.equal(ref.nameValue, 'WebPkg');
	assert.equal(APP.slice(root.end - '</ApplicationManifest>'.length, root.end), '</ApplicationManifest>');
});

test('parseXmlOutline tolerates unclosed elements and drops namespace prefixes', () => {
	const roots = parseXmlOutline('<a:Root><Child Name="x"><Grand />');
	assert.equal(roots[0].element, 'Root');
	assert.equal(roots[0].children[0].nameValue, 'x');
	assert.equal(roots[0].children[0].children[0].element, 'Grand');
	assert.equal(roots[0].end, '<a:Root><Child Name="x"><Grand />'.length);
});

test('applicationParameterDeclarations ignores commented and ConfigOverride <Parameter> elements', () => {
	const decls = applicationParameterDeclarations(APP);
	assert.deepEqual(
		decls.map((d) => d.value),
		['Web_InstanceCount', 'Data_PartitionCount'],
	);
	for (const d of decls) assert.equal(APP.slice(d.valueRange.start, d.valueRange.end), d.value);
});
