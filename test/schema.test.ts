import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseXml, scanRootElement } from '../src/language/schema/xmlScanner';
import { compileXsd } from '../src/language/schema/xsdCompiler';
import { isSchemaDocument, resolveElement, type SchemaModel } from '../src/language/schema/schemaModel';
import { validateDocument } from '../src/language/schema/schemaValidator';
import { completionContextAt, hoverTargetAt } from '../src/language/schema/xmlContext';
import bundled from '../src/language/schema/serviceFabricSchema.json';
import {
	ENVIRONMENT_NAMES,
	buildApplicationManifestXml,
	buildApplicationParametersXml,
	buildServiceManifestXml as buildAppServiceManifestXml,
} from '../src/scaffold/createApplicationTemplates';
import { buildServiceManifestXml, patchApplicationManifest, type ServiceKind } from '../src/scaffold/addServiceTemplates';

const model = bundled as unknown as SchemaModel;
const NS = 'http://schemas.microsoft.com/2011/01/fabric';

// ---- scanner ----------------------------------------------------------------

test('parseXml keeps offsets for elements and attributes', () => {
	const text = '<a x="1"><b y=\'2\'/>hi</a>';
	const doc = parseXml(text);
	assert.deepEqual(doc.problems, []);
	const a = doc.root!;
	assert.equal(a.name, 'a');
	assert.equal(text.slice(a.attributes[0].valueRange!.start, a.attributes[0].valueRange!.end), '1');
	assert.equal(a.children[0].name, 'b');
	assert.equal(a.children[0].selfClosing, true);
	assert.equal(text.slice(a.text[0].start, a.text[0].end), 'hi');
	assert.equal(text.slice(a.closeNameRange!.start, a.closeNameRange!.end), 'a');
});

test('parseXml skips comments, CDATA, declarations and processing instructions', () => {
	const doc = parseXml('<?xml version="1.0"?><!DOCTYPE a><!-- <x> --><a><![CDATA[<y>]]></a>');
	assert.deepEqual(doc.problems, []);
	assert.equal(doc.root!.children.length, 0);
	assert.equal(doc.root!.text.length, 1);
});

test('parseXml recovers from mismatched and unclosed tags', () => {
	const doc = parseXml('<a><b><c></b></a><d>');
	const messages = doc.problems.map((p) => p.message);
	assert.ok(messages.some((m) => m.includes('<c> is not closed')));
	assert.ok(messages.some((m) => m.includes('only one root')));
	assert.ok(messages.some((m) => m.includes('<d> is not closed')));
	assert.equal(doc.root!.children[0].name, 'b');
});

test('parseXml ends a start tag at the next "<" and reports it', () => {
	const doc = parseXml('<a>\n  <b x="1"\n  <c/>\n</a>');
	assert.ok(doc.problems.some((p) => p.message.includes('<b> is not closed with ">"')));
	assert.deepEqual(
		doc.root!.children.map((c) => c.name),
		['b'],
	);
});

test('scanRootElement reads only the first start tag', () => {
	const root = scanRootElement(`<?xml version="1.0"?>\n<!-- c -->\n<ServiceManifest xmlns="${NS}" Name="x"><broken`);
	assert.equal(root?.name, 'ServiceManifest');
	assert.equal(root?.attributes.find((a) => a.name === 'Name')?.value, 'x');
});

// ---- compiler ----------------------------------------------------------------

const MINI_XSD = `<?xml version="1.0"?>
<xs:schema xmlns="urn:t" xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:t" elementFormDefault="qualified">
  <xs:element name="Root" type="RootType"><xs:annotation><xs:documentation>The <b>root</b>.</xs:documentation></xs:annotation></xs:element>
  <xs:complexType name="BaseType">
    <xs:sequence><xs:element name="Inherited" type="xs:string" minOccurs="0"/></xs:sequence>
    <xs:attribute name="Id" type="xs:string" use="required"/>
  </xs:complexType>
  <xs:complexType name="RootType">
    <xs:complexContent>
      <xs:extension base="BaseType">
        <xs:sequence>
          <xs:element name="Must" type="xs:string"/>
          <xs:choice>
            <xs:element name="A"><xs:complexType><xs:attribute name="Flag" type="xs:boolean"/></xs:complexType></xs:element>
            <xs:element name="B" type="xs:string"/>
          </xs:choice>
          <xs:element name="Many" minOccurs="0" maxOccurs="unbounded"><xs:complexType/></xs:element>
          <xs:group ref="G"/>
          <xs:element ref="Global" minOccurs="0"/>
        </xs:sequence>
        <xs:attribute name="Mode" type="ModeType" default="Fast"/>
        <xs:attributeGroup ref="AG"/>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
  <xs:group name="G"><xs:sequence><xs:element name="FromGroup" type="xs:string"/></xs:sequence></xs:group>
  <xs:attributeGroup name="AG"><xs:attribute name="FromGroup" type="xs:string"/></xs:attributeGroup>
  <xs:element name="Global"><xs:complexType><xs:sequence><xs:any namespace="##other"/></xs:sequence></xs:complexType></xs:element>
  <xs:simpleType name="ModeType"><xs:restriction base="xs:string"><xs:enumeration value="Fast"/><xs:enumeration value="Slow"/></xs:restriction></xs:simpleType>
</xs:schema>`;

test('compileXsd resolves extension, choice, groups, refs, enums and docs', () => {
	const m = compileXsd(MINI_XSD);
	assert.equal(m.namespace, 'urn:t');
	const root = m.roots.find((r) => r.name === 'Root')!;
	assert.equal(root.doc, 'The root.');
	const t = m.types[root.type];
	const child = (n: string) => t.children.find((c) => c.name === n);
	assert.deepEqual(
		t.children.map((c) => c.name),
		['Inherited', 'Must', 'A', 'B', 'Many', 'FromGroup', 'Global'],
	);
	assert.equal(child('Must')!.required, true);
	assert.equal(child('A')!.required, undefined, 'choice options are not required');
	assert.equal(child('Many')!.max, 'unbounded');
	assert.equal(child('FromGroup')!.required, true);
	assert.equal(m.types[child('Global')!.type].anyChildren, true);
	const attr = (n: string) => t.attributes.find((a) => a.name === n);
	assert.equal(attr('Id')!.required, true);
	assert.deepEqual(attr('Mode')!.values, ['Fast', 'Slow']);
	assert.equal(attr('Mode')!.default, 'Fast');
	assert.ok(attr('FromGroup'));
	assert.deepEqual(m.types[child('A')!.type].attributes[0].values, ['true', 'false']);
});

// ---- bundled model -------------------------------------------------------------

test('bundled model describes application and service manifests', () => {
	const app = resolveElement(model, ['ApplicationManifest'])!;
	assert.ok(app.type.attributes.some((a) => a.name === 'ApplicationTypeName' && a.required));
	const sm = resolveElement(model, ['ApplicationManifest', 'ServiceManifestImport', 'ServiceManifestRef'])!;
	assert.ok(sm.type.attributes.some((a) => a.name === 'ServiceManifestName' && a.required));
	const stateless = resolveElement(model, ['ApplicationManifest', 'DefaultServices', 'Service', 'StatelessService'])!;
	assert.ok(stateless.type.children.some((c) => c.name === 'SingletonPartition'));
	assert.ok(resolveElement(model, ['ServiceManifest', 'CodePackage', 'EntryPoint', 'ExeHost', 'Program']));
	assert.ok(resolveElement(model, ['Application', 'Parameters', 'Parameter']));
});

test('isSchemaDocument requires the fabric namespace and a known root', () => {
	assert.equal(isSchemaDocument(model, `<ApplicationManifest xmlns="${NS}"/>`), true);
	assert.equal(isSchemaDocument(model, `<ApplicationManifest/>`), false);
	assert.equal(isSchemaDocument(model, `<StartupServicesManifest xmlns="${NS}"/>`), false);
	assert.equal(isSchemaDocument(model, `<PublishProfile xmlns="http://schemas.microsoft.com/2015/05/fabrictools"/>`), false);
});

// ---- validator ------------------------------------------------------------------

const codes = (text: string): string[] => validateDocument(text, model).map((i) => i.code);

test('scaffolded manifests and parameter files are schema-valid', () => {
	const kinds: ServiceKind[] = ['stateless', 'stateful', 'actor', 'guest', 'aspNetStateless', 'aspNetStateful'];
	for (const kind of kinds) {
		for (const targetOs of ['windows', 'linux'] as const) {
			const t = { applicationName: 'App', serviceName: 'Svc', projectGuid: '00000000-0000-0000-0000-000000000000', kind, targetOs };
			const label = `${kind}/${targetOs}`;
			const appManifest = buildApplicationManifestXml(t);
			assert.deepEqual(validateDocument(appManifest, model), [], `ApplicationManifest ${label}`);
			assert.deepEqual(validateDocument(buildAppServiceManifestXml(t), model), [], `ServiceManifest ${label}`);
			for (const env of ENVIRONMENT_NAMES) {
				assert.deepEqual(validateDocument(buildApplicationParametersXml(t, env), model), [], `ApplicationParameters ${env} ${label}`);
			}
			const added = { serviceName: 'Added', serviceTypeName: 'AddedType', kind, version: '1.0.0', targetOs };
			assert.deepEqual(validateDocument(buildServiceManifestXml(added), model), [], `added ServiceManifest ${label}`);
			assert.deepEqual(validateDocument(patchApplicationManifest(appManifest, added), model), [], `patched ApplicationManifest ${label}`);
		}
	}
});

test('container service scaffolds are schema-valid, with and without port and registry credentials', () => {
	const app = buildApplicationManifestXml({ applicationName: 'App', serviceName: 'Svc', projectGuid: '00000000-0000-0000-0000-000000000000' });
	const variants = [
		{ containerPort: 80, registryCredentials: true },
		{ containerPort: 8080, hostPort: 18080, registryCredentials: false },
		{ registryCredentials: false },
	];
	for (const v of variants) {
		const t = { serviceName: 'Web', serviceTypeName: 'WebType', kind: 'container' as const, version: '1.0.0', containerImage: 'reg.azurecr.io/web:1', ...v };
		const label = JSON.stringify(v);
		const sm = buildServiceManifestXml(t);
		assert.deepEqual(validateDocument(sm, model), [], `ServiceManifest ${label}`);
		assert.match(sm, /<ContainerHost>\s*<ImageName>reg\.azurecr\.io\/web:1<\/ImageName>/);
		const patched = patchApplicationManifest(app, t);
		assert.deepEqual(validateDocument(patched, model), [], `ApplicationManifest ${label}`);
		assert.equal(/<RepositoryCredentials AccountName="\[Web_RegistryUserName\]" Password="\[Web_RegistryPassword\]"/.test(patched), v.registryCredentials, label);
		assert.equal(/<Parameter Name="Web_RegistryPassword"/.test(patched), v.registryCredentials, label);
		assert.equal(/<PortBinding ContainerPort="\d+" EndpointRef="ServiceEndpoint" \/>/.test(patched), v.containerPort !== undefined, label);
	}
});

test('added parameters and imports are indented like the rest of the manifest', () => {
	let xml = buildApplicationManifestXml({ applicationName: 'App', serviceName: 'Web', projectGuid: '0', kind: 'aspNetStateless' });
	xml = patchApplicationManifest(xml, { serviceName: 'Gw', serviceTypeName: 'GwType', kind: 'container', version: '1.0.0', containerImage: 'x', registryCredentials: true });
	xml = patchApplicationManifest(xml, { serviceName: 'Cart', serviceTypeName: 'CartType', kind: 'actor', version: '1.0.0', runtime: 'netcore' });
	for (const line of xml.split('\n').filter((l) => /<Parameter Name=/.test(l))) assert.match(line, /^ {4}<Parameter /, line);
	assert.match(xml, /<ServiceManifestRef ServiceManifestName="CartPkg" ServiceManifestVersion="1\.0\.0" \/>\n {2}<\/ServiceManifestImport>/);
	const empty = patchApplicationManifest(buildApplicationManifestXml({ applicationName: 'A', serviceName: 'S', projectGuid: '0' }), {
		serviceName: 'Gw',
		serviceTypeName: 'GwType',
		kind: 'container',
		version: '1.0.0',
		containerImage: 'x',
		registryCredentials: true,
	});
	assert.match(empty, /<Parameters>\n {4}<Parameter Name="Gw_RegistryUserName"[^\n]*\n {4}<Parameter Name="Gw_RegistryPassword"[^\n]*\n( {4}<Parameter [^\n]*\n)* {2}<\/Parameters>/);
});

test('validator reports unknown elements and attributes, missing required ones and bad enum values', () => {
	// ServiceManifest itself accepts any attribute (xs:anyAttribute); CodePackage does not.
	const text = `<ServiceManifest xmlns="${NS}" Name="S" Custom="ok">
  <ServiceTypes><StatelessServiceType ServiceTypeName="T" /></ServiceTypes>
  <CodePackage Name="Code" Bogus="1">
    <EntryPoint><ExeHost IsExternalExecutable="maybe"><Program>a.exe</Program></ExeHost></EntryPoint>
    <Nope/>
  </CodePackage>
</ServiceManifest>`;
	const issues = validateDocument(text, model);
	const byCode = (c: string) => issues.filter((i) => i.code === c);
	assert.ok(byCode('SFX102').some((i) => i.message.includes("'Bogus'")));
	assert.ok(byCode('SFX103').some((i) => i.message.includes("'Version'")));
	assert.ok(byCode('SFX101').some((i) => i.message.includes('<Nope>')));
	assert.equal(text.slice(byCode('SFX104')[0].range.start, byCode('SFX104')[0].range.end), 'maybe');
});

test('validator skips values with [Parameter] references and reports missing children and text', () => {
	assert.deepEqual(
		codes(`<ApplicationManifest xmlns="${NS}" ApplicationTypeName="A" ApplicationTypeVersion="1"><ServiceManifestImport><ServiceManifestRef ServiceManifestName="S" ServiceManifestVersion="1"/><Policies><RunAsPolicy CodePackageRef="C" UserRef="U" EntryPointType="[Ep]"/></Policies></ServiceManifestImport></ApplicationManifest>`),
		[],
	);
	assert.deepEqual(codes(`<ApplicationManifest xmlns="${NS}" ApplicationTypeName="A" ApplicationTypeVersion="1">x</ApplicationManifest>`), ['SFX105', 'SFX107']);
	assert.deepEqual(codes(`<ServiceManifest xmlns="${NS}" Name="S" Version="1"><!-- generated during build --></ServiceManifest>`), []);
	assert.deepEqual(codes(`<ServiceManifest xmlns="${NS}" Name="S" Version="1"><Description/></ServiceManifest>`), ['SFX105', 'SFX105']);
});

test('validator reports XML errors but skips schema checks for foreign documents', () => {
	assert.deepEqual(codes(`<Foo Bar="1"><Baz/></Foo>`), []);
	assert.deepEqual(codes(`<Foo><Baz></Foo>`), ['SFX001']);
});

// ---- completion / hover context -----------------------------------------------------

const ctxAt = (marked: string) => completionContextAt(marked.replace('|', ''), marked.indexOf('|'));

test('completionContextAt classifies the cursor position', () => {
	const head = `<ServiceManifest xmlns="${NS}">\n  <CodePackage Name="C">\n    `;
	assert.deepEqual(ctxAt(`${head}<Ent|`), { kind: 'elementName', path: ['ServiceManifest', 'CodePackage'], start: head.length + 1 });
	assert.deepEqual(ctxAt(`${head}|`), { kind: 'content', path: ['ServiceManifest', 'CodePackage'], start: head.length });
	assert.deepEqual(ctxAt(`${head}</|`), { kind: 'endTag', path: ['ServiceManifest', 'CodePackage'], start: head.length + 2 });
	const attr = ctxAt(`${head}<ExeHost Is|`);
	assert.equal(attr.kind, 'attributeName');
	assert.deepEqual(attr.kind === 'attributeName' && attr.path, ['ServiceManifest', 'CodePackage', 'ExeHost']);
	const value = ctxAt(`${head}<ExeHost IsExternalExecutable="t|`);
	assert.equal(value.kind, 'attributeValue');
	assert.equal(value.kind === 'attributeValue' && value.attribute, 'IsExternalExecutable');
	assert.equal(ctxAt(`${head}<!-- <Ent|`).kind, 'none');
});

test('hoverTargetAt finds element and attribute names', () => {
	const text = `<ServiceManifest xmlns="${NS}" Name="S"><CodePackage Name="C"></CodePackage></ServiceManifest>`;
	const el = hoverTargetAt(text, text.indexOf('CodePackage') + 2);
	assert.equal(el?.kind, 'element');
	assert.deepEqual(el?.path, ['ServiceManifest', 'CodePackage']);
	const closing = hoverTargetAt(text, text.lastIndexOf('CodePackage') + 2);
	assert.deepEqual(closing?.path, ['ServiceManifest', 'CodePackage']);
	const attr = hoverTargetAt(text, text.indexOf('Name="C"') + 1);
	assert.equal(attr?.kind === 'attribute' && attr.attribute.value, 'C');
});
