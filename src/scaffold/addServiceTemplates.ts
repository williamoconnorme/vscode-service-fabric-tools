/**
 * Pure XML/template helpers for the "Add Service" command.
 *
 * Kept free of any `vscode` or `fs` imports so they can be unit-tested under
 * the node test runner.
 */

/** The service kinds the scaffolder knows how to generate. */
export type ServiceKind = 'stateless' | 'stateful' | 'actor' | 'guest' | 'aspNetStateless' | 'aspNetStateful';

/** Kinds that generate a companion C# project (everything except `guest`). */
export type CsharpServiceKind = Exclude<ServiceKind, 'guest'>;

/** Kinds that host an ASP.NET Core (Kestrel) pipeline. */
export type AspNetServiceKind = 'aspNetStateless' | 'aspNetStateful';

/** .NET runtime flavour of a generated C# project. */
export type ServiceRuntime = 'netcore' | 'netfx';

/** Cluster size classification of a per-environment parameters file. */
export type EnvironmentFlavor = 'oneNode' | 'fiveNode' | 'cloud';

/** Opt-in HTTPS endpoint for ASP.NET kinds. Missing fields get defaults. */
export interface HttpsEndpointOptions {
	name?: string;
	port?: number;
}

/** {@link HttpsEndpointOptions} with defaults applied. */
export interface EffectiveHttpsEndpoint {
	name: string;
	port: number;
}

/** Everything the Add Service templates need to know about the new service. */
export interface AddServiceTemplate {
	serviceName: string;
	serviceTypeName: string;
	kind: ServiceKind;
	/** Service package / code package version. */
	version: string;
	/** Ignored for ASP.NET kinds (always `netcore`) and for `guest`. */
	runtime?: ServiceRuntime;
	/** Defaults to `ServiceEndpoint`. */
	endpointName?: string;
	/** HTTP port for ASP.NET kinds; defaults to 8559. */
	endpointPort?: number;
	/** Defaults to `<serviceName>.exe`. */
	exeProgram?: string;
	/** `guest` only: `<Arguments>` for the exe host. */
	guestArguments?: string;
	/** `guest` only: `<WorkingFolder>`; defaults to `CodePackage`. */
	guestWorkingFolder?: string;
	/** ASP.NET kinds only: adds a second, https endpoint. */
	httpsEndpoint?: HttpsEndpointOptions;
	rootNamespace?: string;
	targetFramework?: string;
	serviceFabricSdkVersion?: string;
	/** Folder (and project) name of the generated csproj; defaults to `serviceName`. */
	csprojDirName?: string;
}

/** A `<Parameter Name=".." DefaultValue=".." />` declaration. */
export interface ParameterDeclaration {
	name: string;
	defaultValue: string;
}

/** Resolved naming/version settings shared by the C# template builders. */
export interface CsharpSettings {
	className: string;
	rootNamespace: string;
	assemblyName: string;
	targetFramework: string;
	sdkVersion: string;
	csprojDirName: string;
	runtime: ServiceRuntime;
	runtimeIdentifier: string | undefined;
	actorTypeName: string;
	actorInterfaceName: string;
}

/** Optional relative paths used by {@link buildCsharpCsproj}. */
export interface CsharpProjectPaths {
	/** Actor host only: MSBuild path to the sibling `.Interfaces` csproj. */
	actorInterfacesProjectRelativePath?: string;
}

/** Ports for {@link buildLaunchSettingsJson}. */
export interface LaunchSettingsPorts {
	http: number;
	https?: number;
}

/** Options for {@link patchSfprojForProjectReference}. */
export interface SfprojProjectReferenceOptions {
	kind?: ServiceKind;
}

/**
 * Returns the effective HTTPS endpoint options for the given template, or
 * `undefined` when HTTPS is not opted-in or the kind doesn't host Kestrel.
 * Defaults `name` and `port` so callers don't have to repeat the fallbacks.
 */
function effectiveHttpsEndpoint(t: AddServiceTemplate): EffectiveHttpsEndpoint | undefined {
	if (t.httpsEndpoint && isAspNetKind(t.kind)) {
		return {
			name: t.httpsEndpoint.name ?? 'ServiceHttpsEndpoint',
			port: t.httpsEndpoint.port ?? 8443,
		};
	}
	return undefined;
}

/**
 * Returns true when the kind generates a companion C# project (i.e. anything
 * except `guest`). Acts as a discriminating type guard so callers can pass
 * the template into the C# template builders without further narrowing.
 */
export function isCsharpKind(kind: ServiceKind): kind is CsharpServiceKind {
	return kind !== 'guest';
}

/** Returns true when the kind uses a stateful service type at the manifest level. */
export function isStatefulKind(kind: ServiceKind): boolean {
	return kind === 'stateful' || kind === 'actor' || kind === 'aspNetStateful';
}

/** Returns true when the kind hosts an ASP.NET Core pipeline. */
export function isAspNetKind(kind: ServiceKind): kind is AspNetServiceKind {
	return kind === 'aspNetStateless' || kind === 'aspNetStateful';
}

/**
 * Returns the effective runtime for a template, accounting for ASP.NET kinds
 * (which always run on `netcore`) and guest services (which have no runtime
 * axis — callers should not call this for guest).
 */
function effectiveRuntime(t: AddServiceTemplate): ServiceRuntime {
	return isAspNetKind(t.kind) ? 'netcore' : (t.runtime ?? 'netcore');
}

/**
 * Returns the parameter declarations that a service of the given kind expects
 * to exist in the application manifest. Used by both the manifest patcher and
 * the per-environment `ApplicationParameters/*.xml` patcher.
 */
function defaultParametersFor(template: AddServiceTemplate): ParameterDeclaration[] {
	const n = template.serviceName;
	if (isStatefulKind(template.kind)) {
		return [
			{ name: `${n}_PartitionCount`, defaultValue: '1' },
			{ name: `${n}_MinReplicaSetSize`, defaultValue: '3' },
			{ name: `${n}_TargetReplicaSetSize`, defaultValue: '3' },
		];
	}
	// stateless, aspNetStateless, and guest all surface as a single InstanceCount parameter.
	return [{ name: `${n}_InstanceCount`, defaultValue: '-1' }];
}

/**
 * Generates a new ServiceManifest.xml body for the chosen service kind.
 */
export function buildServiceManifestXml(t: AddServiceTemplate): string {
	const endpoint = t.endpointName ?? 'ServiceEndpoint';
	const exe = t.exeProgram ?? `${t.serviceName}.exe`;
	let typeElem: string;
	switch (t.kind) {
		case 'stateful':
		case 'aspNetStateful':
			typeElem = `<StatefulServiceType ServiceTypeName="${t.serviceTypeName}" HasPersistedState="true" />`;
			break;
		case 'actor':
			// Actor host manifest is generated at build time by the Actors
			// build target. We emit the empty stub VS uses verbatim.
			return `<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${t.serviceName}Pkg"
                 Version="${t.version}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <!-- The content will be generated during build -->
</ServiceManifest>
`;
		case 'guest':
			// UseImplicitHost is the standard SF marker for guest executables.
			typeElem = `<StatelessServiceType ServiceTypeName="${t.serviceTypeName}" UseImplicitHost="true" />`;
			break;
		case 'aspNetStateless':
		case 'stateless':
		default:
			typeElem = `<StatelessServiceType ServiceTypeName="${t.serviceTypeName}" />`;
			break;
	}
	const exeHostInner = [`        <Program>${exe}</Program>`];
	if (t.kind === 'guest' && t.guestArguments && t.guestArguments.trim() !== '') {
		exeHostInner.push(`        <Arguments>${escapeXml(t.guestArguments)}</Arguments>`);
	}
	if (t.kind === 'guest') {
		exeHostInner.push(`        <WorkingFolder>${t.guestWorkingFolder ?? 'CodePackage'}</WorkingFolder>`);
	} else if (isAspNetKind(t.kind)) {
		// ASP.NET kinds run from the code package working directory so the
		// hosting bundle's `appsettings.json` and content root resolution
		// work out-of-the-box.
		exeHostInner.push('        <WorkingFolder>CodePackage</WorkingFolder>');
	}
	// ASP.NET kinds: an `ASPNETCORE_ENVIRONMENT` environment variable is
	// surfaced so per-environment ApplicationParameters can drive
	// Development/Staging/Production runtime behavior.
	const aspNetEnvBlock = isAspNetKind(t.kind)
		? `
    <EnvironmentVariables>
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value=""/>
    </EnvironmentVariables>`
		: '';
	let resourcesBlock: string;
	const httpsOpts = effectiveHttpsEndpoint(t);
	if (t.kind === 'aspNetStateful' && !httpsOpts) {
		// VS-canonical http-only stateful ASP.NET ships *without* a <Resources>
		// block — Kestrel picks the listen port at runtime and the cluster
		// does not need a published endpoint for replication. Preserve that
		// shape exactly when HTTPS is not opted in.
		resourcesBlock = '';
	} else if (t.kind === 'aspNetStateless' || t.kind === 'aspNetStateful') {
		// Stateless ASP.NET always emits a <Resources> block; stateful only
		// emits one when HTTPS is opted in (so the https port is explicit).
		const httpPort = t.endpointPort ?? 8559;
		const lines = [`      <Endpoint Protocol="http" Name="${endpoint}" Type="Input" Port="${httpPort}" />`];
		if (httpsOpts) {
			lines.push(`      <Endpoint Protocol="https" Name="${httpsOpts.name}" Type="Input" Port="${httpsOpts.port}" />`);
		}
		resourcesBlock = `
  <Resources>
    <Endpoints>
${lines.join(`
`)}
    </Endpoints>
  </Resources>`;
	} else if (t.kind === 'stateful') {
		// Stateful Reliable Services need both ServiceEndpoint and
		// ReplicatorEndpoint per the VS canonical template.
		resourcesBlock = `
  <Resources>
    <Endpoints>
      <Endpoint Name="${endpoint}" />
      <Endpoint Name="ReplicatorEndpoint" />
    </Endpoints>
  </Resources>`;
	} else {
		resourcesBlock = `
  <Resources>
    <Endpoints>
      <Endpoint Name="${endpoint}" />
    </Endpoints>
  </Resources>`;
	}
	return `<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${t.serviceName}Pkg" Version="${t.version}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ServiceTypes>
    ${typeElem}
  </ServiceTypes>
  <CodePackage Name="Code" Version="${t.version}">
    <EntryPoint>
      <ExeHost>
${exeHostInner.join(`
`)}
      </ExeHost>
    </EntryPoint>${aspNetEnvBlock}
  </CodePackage>
  <ConfigPackage Name="Config" Version="${t.version}" />${resourcesBlock}
</ServiceManifest>
`;
}

/**
 * Empty Settings.xml stub used by the new Config package.
 */
export function buildSettingsXml(): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<Settings xmlns="http://schemas.microsoft.com/2011/01/fabric"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
</Settings>
`;
}

/**
 * Legacy combo of {@link patchApplicationManifestImports} +
 * {@link appendDefaultServiceBlock}. Used by `applyAddService` only when the
 * project has no `StartupServices.xml` (an extremely old VS template).
 *
 * Differs from the modern path in two ways:
 *  - It registers the new service via a `<Service>` block in `<DefaultServices>`
 *    (modern path uses `<Service>` in StartupServices.xml).
 *  - It declares the legacy `_InstanceCount` / partition / replica parameters
 *    in the application manifest's `<Parameters>` block (modern path declares
 *    them in StartupServices.xml).
 *
 * Operates on the raw XML text to preserve formatting and comments — the
 * round-trip cost of fast-xml-parser would mangle the file otherwise.
 */
export function patchApplicationManifest(xml: string, t: AddServiceTemplate): string {
	const withImports = patchApplicationManifestImports(xml, t);
	const withLegacyParams = injectLegacyDefaultServiceParameters(withImports, t);
	return appendDefaultServiceBlock(withLegacyParams, t);
}

/**
 * Adds the legacy InstanceCount / partition / replica `<Parameter>`
 * declarations to the application manifest's `<Parameters>` block. These
 * are referenced by the legacy `<DefaultServices>` `<Service>` block that
 * `appendDefaultServiceBlock` writes — without them the manifest would be
 * malformed at deploy time.
 *
 * The modern path (StartupServices.xml-aware) declares these parameters in
 * StartupServices.xml instead and so never calls this helper.
 */
function injectLegacyDefaultServiceParameters(xml: string, t: AddServiceTemplate): string {
	let out = xml;
	const fresh = defaultParametersFor(t).filter((p) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(p.name)}"`, 'i').test(out));
	if (fresh.length === 0) return out;
	const newParamLines = fresh.map((p) => `    <Parameter Name="${p.name}" DefaultValue="${p.defaultValue}" />`).join(`
`);
	if (/<Parameters\s*\/>/.test(out)) {
		out = out.replace(
			/<Parameters\s*\/>/,
			`<Parameters>
${newParamLines}
  </Parameters>`,
		);
	} else if (/<Parameters\b[^>]*>[\s\S]*?<\/Parameters>/.test(out)) {
		out = out.replace(
			/(<\/Parameters>)/,
			`${newParamLines}
  $1`,
		);
	} else {
		out = out.replace(
			/(<ApplicationManifest\b[^>]*>)/,
			`$1
  <Parameters>
${newParamLines}
  </Parameters>`,
		);
	}
	return out;
}

/**
 * Subset of {@link patchApplicationManifest} that adds the
 * `<Parameter>` declarations and the `<ServiceManifestImport>` block but
 * leaves `<DefaultServices>` untouched.
 *
 * Per the VS canonical (Application1) shape:
 *  - `<Parameters>` is *only* extended for ASP.NET kinds with a single
 *    `<Folder>_ASPNETCORE_ENVIRONMENT` parameter; instance/replica counts
 *    live in StartupServices.xml, not here.
 *  - `<ServiceManifestImport>` shape varies by kind:
 *      * `actor` — bare `<ServiceManifestRef>` only.
 *      * `stateless` / `stateful` — adds `<ConfigOverrides />`.
 *      * ASP.NET kinds — adds `<ConfigOverrides />` plus an
 *        `<EnvironmentOverrides CodePackageRef="code">` block referencing
 *        the new `<Folder>_ASPNETCORE_ENVIRONMENT` parameter.
 *  - `guest` matches the plain stateless/stateful shape (`<ConfigOverrides />`)
 *    so the import block is well-formed even though guest services don't
 *    typically need overrides.
 */
export function patchApplicationManifestImports(xml: string, t: AddServiceTemplate): string {
	let out = xml;
	// 1. Patch <Parameters>. Only ASP.NET kinds contribute a parameter here
	//    (`<Folder>_ASPNETCORE_ENVIRONMENT`); instance/replica counts go to
	//    StartupServices.xml.
	const aspNetParam: ParameterDeclaration[] = isAspNetKind(t.kind)
		? [{ name: `${t.serviceName}_ASPNETCORE_ENVIRONMENT`, defaultValue: '' }]
		: [];
	const fresh = aspNetParam.filter((p) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(p.name)}"`, 'i').test(out));
	if (fresh.length > 0) {
		const newParamLines = fresh.map((p) => `    <Parameter Name="${p.name}" DefaultValue="${p.defaultValue}" />`).join(`
`);
		if (/<Parameters\s*\/>/.test(out)) {
			// Self-closed empty -> expand.
			out = out.replace(
				/<Parameters\s*\/>/,
				`<Parameters>
${newParamLines}
  </Parameters>`,
			);
		} else if (/<Parameters\b[^>]*>[\s\S]*?<\/Parameters>/.test(out)) {
			out = out.replace(
				/(<\/Parameters>)/,
				`${newParamLines}
  $1`,
			);
		} else {
			// No <Parameters> block: insert one right after the opening tag.
			out = out.replace(
				/(<ApplicationManifest\b[^>]*>)/,
				`$1
  <Parameters>
${newParamLines}
  </Parameters>`,
			);
		}
	}
	// 2. Add <ServiceManifestImport> block — kind-specific.
	let importBody: string;
	if (t.kind === 'actor') {
		importBody = '';
	} else if (isAspNetKind(t.kind)) {
		importBody = `
    <ConfigOverrides />
    <EnvironmentOverrides CodePackageRef="code">
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value="[${t.serviceName}_ASPNETCORE_ENVIRONMENT]" />
    </EnvironmentOverrides>
  `;
	} else {
		// stateless / stateful / guest
		importBody = `
    <ConfigOverrides />
  `;
	}
	const importBlock = `  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="${t.serviceName}Pkg" ServiceManifestVersion="${t.version}" />${importBody}</ServiceManifestImport>`;
	// Idempotent: skip if a ServiceManifestRef with the same name is already present.
	const existingRef = new RegExp(`<ServiceManifestRef\\s+ServiceManifestName="${escapeRegex(t.serviceName)}Pkg"`, 'i');
	if (!existingRef.test(out)) {
		if (/<\/ServiceManifestImport>/.test(out)) {
			// Append after the last existing </ServiceManifestImport>.
			out = replaceLastMatch(
				out,
				/<\/ServiceManifestImport>/g,
				(match) => `${match}
${importBlock}`,
			);
		} else if (/<DefaultServices\b/.test(out)) {
			out = out.replace(
				/(\s*<DefaultServices\b)/,
				`
${importBlock}$1`,
			);
		} else {
			out = out.replace(
				/(\s*<\/ApplicationManifest>)/,
				`
${importBlock}$1`,
			);
		}
	}
	return out;
}

/**
 * Adds the new service's `<Service>` block to `<DefaultServices>`,
 * creating the block if it does not exist. Idempotent: a `<Service Name="..."`
 * with the same name is left untouched.
 */
function appendDefaultServiceBlock(xml: string, t: AddServiceTemplate): string {
	let out = xml;
	// Idempotent: skip if the service is already present.
	const existing = new RegExp(`<Service\\s+Name="${escapeRegex(t.serviceName)}"`, 'i');
	if (existing.test(out)) return out;
	const serviceBlock = buildDefaultServiceBlock(t);
	if (/<DefaultServices\b[^>]*\/>/.test(out)) {
		out = out.replace(
			/<DefaultServices\b[^>]*\/>/,
			`<DefaultServices>
${serviceBlock}
  </DefaultServices>`,
		);
	} else if (/<\/DefaultServices>/.test(out)) {
		out = out.replace(
			/(<\/DefaultServices>)/,
			`${serviceBlock}
  $1`,
		);
	} else {
		out = out.replace(
			/(\s*<\/ApplicationManifest>)/,
			`
  <DefaultServices>
${serviceBlock}
  </DefaultServices>$1`,
		);
	}
	return out;
}

/**
 * Patches a `StartupServices.xml` file to register the new service:
 *  - Adds `<Parameter>` declarations to `<Parameters>` (creating it if absent).
 *  - Adds the `<Service>` block to `<Services>` (creating it if absent).
 *
 * Idempotent: skips parameters already declared and skips the service block
 * when a `<Service Name="...">` with the same name is already present.
 *
 * Actors are intentionally skipped: per the VS canonical (Application1)
 * shape, actor services are registered with `ActorRuntime.RegisterActorAsync`
 * at process start and have no `<Service>` entry in StartupServices.xml.
 */
export function patchStartupServicesXml(xml: string, t: AddServiceTemplate): string {
	if (t.kind === 'actor') return xml;
	let out = xml;
	// 1. Add parameter declarations.
	const fresh = defaultParametersFor(t).filter((p) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(p.name)}"`).test(out));
	if (fresh.length > 0) {
		const lines = fresh.map((p) => `    <Parameter Name="${p.name}" DefaultValue="${p.defaultValue}" />`).join(`
`);
		if (/<Parameters\s*\/>/.test(out)) {
			out = out.replace(
				/<Parameters\s*\/>/,
				`<Parameters>
${lines}
  </Parameters>`,
			);
		} else if (/<\/Parameters>/.test(out)) {
			out = out.replace(
				/(<\/Parameters>)/,
				`${lines}
  $1`,
			);
		} else {
			out = out.replace(
				/(<StartupServicesManifest\b[^>]*>)/,
				`$1
  <Parameters>
${lines}
  </Parameters>`,
			);
		}
	}
	// 2. Add <Service> block to <Services>.
	const existingService = new RegExp(`<Service\\s+Name="${escapeRegex(t.serviceName)}"`, 'i');
	if (!existingService.test(out)) {
		const serviceBlock = buildStartupServiceBlock(t);
		if (/<Services\s*\/>/.test(out)) {
			out = out.replace(
				/<Services\s*\/>/,
				`<Services>
${serviceBlock}
  </Services>`,
			);
		} else if (/<\/Services>/.test(out)) {
			out = out.replace(
				/(<\/Services>)/,
				`${serviceBlock}
  $1`,
			);
		} else {
			out = out.replace(
				/(\s*<\/StartupServicesManifest>)/,
				`
  <Services>
${serviceBlock}
  </Services>$1`,
			);
		}
	}
	return out;
}

/**
 * Patches a `StartupServiceParameters/<Env>.xml` file to register
 * environment-specific values for the new service. Mirrors the conventions of
 * {@link patchApplicationParametersXml}: 1-node clusters scale replica
 * counts down to 1; 5-node clusters keep the declared `3`; cloud uses `-1`
 * for stateless `InstanceCount` and `3` for stateful replica sets.
 *
 * If a parameter is already present, it is left untouched.
 */
export function patchStartupServiceParametersXml(xml: string, t: AddServiceTemplate, flavor: EnvironmentFlavor): string {
	if (t.kind === 'actor') return xml;
	const additions: ParameterDeclaration[] = [];
	if (isStatefulKind(t.kind)) {
		const min = flavor === 'oneNode' ? '1' : '3';
		const target = flavor === 'oneNode' ? '1' : '3';
		additions.push(
			{ name: `${t.serviceName}_PartitionCount`, defaultValue: '1' },
			{ name: `${t.serviceName}_MinReplicaSetSize`, defaultValue: min },
			{ name: `${t.serviceName}_TargetReplicaSetSize`, defaultValue: target },
		);
	} else {
		additions.push({
			name: `${t.serviceName}_InstanceCount`,
			defaultValue: flavor === 'oneNode' ? '1' : flavor === 'fiveNode' ? '3' : '-1',
		});
	}
	let out = xml;
	const fresh = additions.filter((a) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(a.name)}"`).test(out));
	if (fresh.length === 0) return out;
	const lines = fresh.map((p) => `    <Parameter Name="${p.name}" Value="${p.defaultValue}" />`).join(`
`);
	if (/<Parameters\s*\/>/.test(out)) {
		out = out.replace(
			/<Parameters\s*\/>/,
			`<Parameters>
${lines}
  </Parameters>`,
		);
	} else if (/<\/Parameters>/.test(out)) {
		out = out.replace(
			/(<\/Parameters>)/,
			`${lines}
  $1`,
		);
	} else {
		// Fall back to inserting after the root tag (which is <StartupServices ...>
		// in the VS template).
		out = out.replace(
			/(<StartupServices\b[^>]*>)/,
			`$1
  <Parameters>
${lines}
  </Parameters>`,
		);
	}
	return out;
}

function buildStartupServiceBlock(t: AddServiceTemplate): string {
	const n = t.serviceName;
	if (isStatefulKind(t.kind)) {
		return [
			`    <Service Name="${n}" ServicePackageActivationMode="ExclusiveProcess">`,
			`      <StatefulService ServiceTypeName="${t.serviceTypeName}" TargetReplicaSetSize="[${n}_TargetReplicaSetSize]" MinReplicaSetSize="[${n}_MinReplicaSetSize]">`,
			`        <UniformInt64Partition PartitionCount="[${n}_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />`,
			'      </StatefulService>',
			'    </Service>',
		].join(`
`);
	}
	return [
		`    <Service Name="${n}" ServicePackageActivationMode="ExclusiveProcess">`,
		`      <StatelessService ServiceTypeName="${t.serviceTypeName}" InstanceCount="[${n}_InstanceCount]">`,
		'        <SingletonPartition />',
		'      </StatelessService>',
		'    </Service>',
	].join(`
`);
}

function buildDefaultServiceBlock(t: AddServiceTemplate): string {
	const n = t.serviceName;
	if (isStatefulKind(t.kind)) {
		return [
			`    <Service Name="${n}">`,
			`      <StatefulService ServiceTypeName="${t.serviceTypeName}" TargetReplicaSetSize="[${n}_TargetReplicaSetSize]" MinReplicaSetSize="[${n}_MinReplicaSetSize]">`,
			`        <UniformInt64Partition PartitionCount="[${n}_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />`,
			'      </StatefulService>',
			'    </Service>',
		].join(`
`);
	}
	// stateless, aspNetStateless, and guest share the stateless default-service shape.
	return [
		`    <Service Name="${n}">`,
		`      <StatelessService ServiceTypeName="${t.serviceTypeName}" InstanceCount="[${n}_InstanceCount]">`,
		'        <SingletonPartition />',
		'      </StatelessService>',
		'    </Service>',
	].join(`
`);
}

/**
 * Adds the new service's parameters to a per-environment
 * `ApplicationParameters/*.xml` file with environment-appropriate values.
 *
 * Per the VS canonical (Application1) shape, this file carries *only*
 * ASP.NET-related environment overrides (`<Folder>_ASPNETCORE_ENVIRONMENT`):
 *  - `Local.1Node.xml` / `Local.5Node.xml`: `Development`.
 *  - `Cloud.xml`: empty value (left for the operator to set per environment).
 *
 * Instance/replica counts live in `StartupServiceParameters/*.xml`, not here.
 *
 * If a parameter is already present, it is left untouched. Non-ASP.NET kinds
 * are no-ops.
 */
export function patchApplicationParametersXml(xml: string, t: AddServiceTemplate, flavor: EnvironmentFlavor): string {
	const additions: ParameterDeclaration[] = [];
	if (isAspNetKind(t.kind)) {
		const value = flavor === 'cloud' ? '' : 'Development';
		additions.push({ name: `${t.serviceName}_ASPNETCORE_ENVIRONMENT`, defaultValue: value });
	}
	let out = xml;
	const fresh = additions.filter((a) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(a.name)}"`).test(out));
	if (fresh.length === 0) return out;
	const lines = fresh.map((p) => `    <Parameter Name="${p.name}" Value="${p.defaultValue}" />`).join(`
`);
	if (/<Parameters\s*\/>/.test(out)) {
		out = out.replace(
			/<Parameters\s*\/>/,
			`<Parameters>
${lines}
  </Parameters>`,
		);
	} else if (/<\/Parameters>/.test(out)) {
		out = out.replace(
			/(<\/Parameters>)/,
			`${lines}
  $1`,
		);
	} else {
		out = out.replace(
			/(<Application\b[^>]*>)/,
			`$1
  <Parameters>
${lines}
  </Parameters>`,
		);
	}
	return out;
}

/**
 * Classifies a per-environment parameters/publish profile by file name.
 * Heuristic only — falls back to `cloud` for unknown names.
 */
export function classifyEnvironment(fileName: string): EnvironmentFlavor {
	const lower = fileName.toLowerCase();
	if (lower.includes('1node') || lower.includes('one') || lower.includes('local.dev')) return 'oneNode';
	if (lower.includes('5node') || lower.includes('five')) return 'fiveNode';
	return 'cloud';
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function replaceLastMatch(src: string, pattern: RegExp, replacer: (match: string) => string): string {
	let lastIndex = -1;
	let lastMatch: RegExpExecArray | null = null;
	pattern.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = pattern.exec(src)) !== null) {
		lastIndex = m.index;
		lastMatch = m;
		if (!pattern.global) break;
	}
	if (lastMatch === null || lastIndex < 0) return src;
	return src.slice(0, lastIndex) + replacer(lastMatch[0]) + src.slice(lastIndex + lastMatch[0].length);
}

/**
 * Resolves the class / namespace / assembly / framework / SDK naming used by
 * every C# template builder, applying the template's overrides on top of the
 * defaults.
 */
export function resolveCsharpSettings(t: AddServiceTemplate): CsharpSettings {
	const runtime = effectiveRuntime(t);
	const className = sanitizeClassName(t.serviceName);
	const rootNamespace = t.rootNamespace?.trim() || sanitizeNamespace(t.serviceName);
	const assemblyName = t.exeProgram?.replace(/\.exe$/i, '') ?? t.serviceName;
	// Plan §5.8.2 (1.1.4): unify the netcore default to `net10.0` for both
	// ASP.NET and plain/Actor branches. Single default keeps the interactive
	// picker (§5.8.1) and programmatic callers in lock-step. netfx still
	// resolves to net472 — the netfx Service Fabric SDK doesn't support
	// net8+, and the SF Application targets only ship net472 assets there.
	const defaultTfm = runtime === 'netfx' ? 'net472' : 'net10.0';
	const runtimeIdentifier = runtime === 'netcore' ? 'win-x64' : undefined;
	return {
		className,
		rootNamespace,
		assemblyName,
		targetFramework: t.targetFramework ?? defaultTfm,
		sdkVersion: t.serviceFabricSdkVersion ?? '8.1.208',
		csprojDirName: t.csprojDirName ?? t.serviceName,
		runtime,
		runtimeIdentifier,
		actorTypeName: className,
		actorInterfaceName: `I${className}`,
	};
}

function sanitizeClassName(name: string): string {
	const cleaned = name.replace(/[^A-Za-z0-9]/g, '');
	if (!cleaned) return 'Service';
	return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function sanitizeNamespace(name: string): string {
	// Allow dots but split each part on non-identifier chars.
	return (
		name
			.split('.')
			.map((segment) => segment.replace(/[^A-Za-z0-9_]/g, ''))
			.filter((segment) => segment.length > 0)
			.map((segment) => (/^[0-9]/.test(segment) ? `_${segment}` : segment))
			.join('.') || 'Service'
	);
}

/**
 * Returns the body of `Program.cs` for the chosen C# kind.
 *
 * - `stateless` / `stateful` register a Reliable Service via
 *   `ServiceRuntime.RegisterServiceAsync`.
 * - `actor` registers a virtual actor via `ActorRuntime.RegisterActorAsync`.
 * - `aspNetStateless` / `aspNetStateful` register a Reliable Service whose
 *   `<Service>.cs` stands up a Kestrel-based ASP.NET Core pipeline.
 */
export function buildCsharpProgramCs(t: AddServiceTemplate, settings?: CsharpSettings): string {
	if (!isCsharpKind(t.kind)) {
		throw new Error(`buildCsharpProgramCs is only valid for C# kinds, got '${t.kind}'.`);
	}
	const s = settings ?? resolveCsharpSettings(t);
	if (t.kind === 'actor') {
		return `using System;
using System.Threading;
using Microsoft.ServiceFabric.Actors.Runtime;

namespace ${s.rootNamespace}
{
    /// <summary>
    /// Entry point for the '${t.serviceName}' Service Fabric actor service.
    /// Generated by the VS Code Service Fabric extension.
    /// </summary>
    internal static class Program
    {
        private static void Main()
        {
            try
            {
                ActorRuntime.RegisterActorAsync<${s.actorTypeName}>(
                    (context, actorType) => new ActorService(context, actorType))
                    .GetAwaiter().GetResult();

                Thread.Sleep(Timeout.Infinite);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Actor host failed: {ex}");
                throw;
            }
        }
    }
}
`;
	}
	if (isAspNetKind(t.kind)) {
		// Service Fabric ASP.NET Core entry point. The hosting bundle picks
		// up Kestrel via the service's CreateServiceInstanceListeners /
		// CreateServiceReplicaListeners override; Program.cs is a thin
		// ServiceRuntime.RegisterServiceAsync wrapper to match the VS
		// canonical template.
		return `using System;
using System.Threading;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${s.rootNamespace}
{
    /// <summary>
    /// Entry point for the '${t.serviceName}' Service Fabric ${describeKindForComment(t.kind)} service.
    /// Generated by the VS Code Service Fabric extension.
    /// </summary>
    internal static class Program
    {
        private static void Main()
        {
            try
            {
                ServiceRuntime.RegisterServiceAsync(
                    "${t.serviceTypeName}",
                    context => new ${s.className}(context))
                    .GetAwaiter().GetResult();

                Thread.Sleep(Timeout.Infinite);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Service host failed: {ex}");
                throw;
            }
        }
    }
}
`;
	}
	return `using System;
using System.Threading;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${s.rootNamespace}
{
    /// <summary>
    /// Entry point for the '${t.serviceName}' Service Fabric ${describeKindForComment(t.kind)} service.
    /// Generated by the VS Code Service Fabric extension.
    /// </summary>
    internal static class Program
    {
        private static void Main()
        {
            try
            {
                ServiceRuntime.RegisterServiceAsync(
                    "${t.serviceTypeName}",
                    context => new ${s.className}(context))
                    .GetAwaiter().GetResult();

                Thread.Sleep(Timeout.Infinite);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Service host failed: {ex}");
                throw;
            }
        }
    }
}
`;
}

function describeKindForComment(kind: ServiceKind): string {
	switch (kind) {
		case 'aspNetStateless':
			return 'stateless ASP.NET Core';
		case 'aspNetStateful':
			return 'stateful ASP.NET Core';
		default:
			return kind;
	}
}

/**
 * Returns the body of `<Service>.cs` — a minimal compilable derivation for
 * the chosen kind.
 *
 * - `stateful` / `aspNetStateful` derive from `StatefulService`.
 * - `stateless` / `aspNetStateless` derive from `StatelessService`.
 * - ASP.NET kinds wire up a `KestrelCommunicationListener` returning the
 *   provided host builder.
 * - Actor kinds use a separate {@link buildActorCs} builder, not this one.
 */
export function buildCsharpServiceCs(t: AddServiceTemplate, settings?: CsharpSettings): string {
	if (!isCsharpKind(t.kind)) {
		throw new Error(`buildCsharpServiceCs is only valid for C# kinds, got '${t.kind}'.`);
	}
	if (t.kind === 'actor') {
		throw new Error("buildCsharpServiceCs does not handle the 'actor' kind; use buildActorCs instead.");
	}
	const s = settings ?? resolveCsharpSettings(t);
	if (t.kind === 'aspNetStateless') {
		return buildAspNetStatelessServiceCs(t, s);
	}
	if (t.kind === 'aspNetStateful') {
		return buildAspNetStatefulServiceCs(t, s);
	}
	if (t.kind === 'stateful') {
		return `using System;
using System.Collections.Generic;
using System.Fabric;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.ServiceFabric.Data.Collections;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${s.rootNamespace}
{
    /// <summary>
    /// A minimal stateful Reliable Service. Replace <c>RunAsync</c> with your own logic.
    /// </summary>
    internal sealed class ${s.className} : StatefulService
    {
        public ${s.className}(StatefulServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceReplicaListener> CreateServiceReplicaListeners()
            => new ServiceReplicaListener[0];

        protected override async Task RunAsync(CancellationToken cancellationToken)
        {
            var counter = await this.StateManager.GetOrAddAsync<IReliableDictionary<string, long>>("counter");

            while (!cancellationToken.IsCancellationRequested)
            {
                using (var tx = this.StateManager.CreateTransaction())
                {
                    var current = await counter.TryGetValueAsync(tx, "value");
                    var next = current.HasValue ? current.Value + 1 : 0L;
                    await counter.SetAsync(tx, "value", next);
                    await tx.CommitAsync();
                }

                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            }
        }
    }
}
`;
	}
	return `using System;
using System.Collections.Generic;
using System.Fabric;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${s.rootNamespace}
{
    /// <summary>
    /// A minimal stateless Reliable Service. Replace <c>RunAsync</c> with your own logic.
    /// </summary>
    internal sealed class ${s.className} : StatelessService
    {
        public ${s.className}(StatelessServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceInstanceListener> CreateServiceInstanceListeners()
            => new ServiceInstanceListener[0];

        protected override async Task RunAsync(CancellationToken cancellationToken)
        {
            long iterations = 0;
            while (!cancellationToken.IsCancellationRequested)
            {
                iterations++;
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            }
        }
    }
}
`;
}

// ---------------------------------------------------------------------------
// Actor templates
// ---------------------------------------------------------------------------

/**
 * Returns the body of the actor's interface file (`I<Actor>.cs`).
 */
export function buildActorInterfaceCs(t: AddServiceTemplate, settings?: CsharpSettings): string {
	if (t.kind !== 'actor') {
		throw new Error(`buildActorInterfaceCs is only valid for the 'actor' kind, got '${t.kind}'.`);
	}
	const s = settings ?? resolveCsharpSettings(t);
	return `using System.Threading.Tasks;
using Microsoft.ServiceFabric.Actors;

namespace ${s.rootNamespace}.Interfaces
{
    /// <summary>
    /// Public actor contract for ${s.actorTypeName}. Add the methods callers
    /// will invoke on a proxy obtained via
    /// <c>ActorProxy.Create&lt;${s.actorInterfaceName}&gt;(...)</c>.
    /// </summary>
    public interface ${s.actorInterfaceName} : IActor
    {
        Task<long> GetCountAsync();

        Task SetCountAsync(long count);
    }
}
`;
}

/**
 * Returns the body of `<Actor>.cs` — a minimal compilable virtual-actor
 * implementation backed by the default `KvsActorStateProvider`.
 */
export function buildActorCs(t: AddServiceTemplate, settings?: CsharpSettings): string {
	if (t.kind !== 'actor') {
		throw new Error(`buildActorCs is only valid for the 'actor' kind, got '${t.kind}'.`);
	}
	const s = settings ?? resolveCsharpSettings(t);
	return `using System.Threading.Tasks;
using Microsoft.ServiceFabric.Actors;
using Microsoft.ServiceFabric.Actors.Runtime;
using ${s.rootNamespace}.Interfaces;

namespace ${s.rootNamespace}
{
    /// <summary>
    /// Default virtual-actor implementation. Replace the demo state with the
    /// fields and methods your application needs.
    /// </summary>
    [StatePersistence(StatePersistence.Persisted)]
    internal sealed class ${s.actorTypeName} : Actor, ${s.actorInterfaceName}
    {
        public ${s.actorTypeName}(ActorService actorService, ActorId actorId)
            : base(actorService, actorId) { }

        public async Task<long> GetCountAsync()
        {
            var count = await this.StateManager.TryGetStateAsync<long>("count");
            return count.HasValue ? count.Value : 0L;
        }

        public Task SetCountAsync(long count)
        {
            return this.StateManager.SetStateAsync("count", count);
        }
    }
}
`;
}

// ---------------------------------------------------------------------------
// ASP.NET Core templates
// ---------------------------------------------------------------------------

function buildAspNetStatelessServiceCs(t: AddServiceTemplate, s: CsharpSettings): string {
	const httpsOpts = effectiveHttpsEndpoint(t);
	// When HTTPS is opted in, the listener factory resolves the second SF
	// endpoint by name at runtime. The literal name must match what
	// buildServiceManifestXml emits — see effectiveHttpsEndpoint default.
	// If a user renames the endpoint in ServiceManifest.xml after scaffolding,
	// GetEndpoint("<name>") will throw at runtime; rename in both places.
	const httpsAppendSnippet = httpsOpts
		? `

                        // HTTPS URL resolved from the second SF endpoint.
                        var httpsEndpoint = serviceContext.CodePackageActivationContext
                            .GetEndpoint("${httpsOpts.name}");
                        app.Urls.Add($"https://+:{httpsEndpoint.Port}");`
		: '';
	return `using System.Collections.Generic;
using System.Fabric;
using System.IO;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.ServiceFabric.Services.Communication.AspNetCore;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${s.rootNamespace}
{
    /// <summary>
    /// Stateless ASP.NET Core Reliable Service. The Kestrel host returned from
    /// <see cref="CreateServiceInstanceListeners"/> exposes the controllers
    /// declared under <c>Controllers/</c>.
    /// </summary>
    internal sealed class ${s.className} : StatelessService
    {
        public ${s.className}(StatelessServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceInstanceListener> CreateServiceInstanceListeners()
        {
            return new[]
            {
                new ServiceInstanceListener(serviceContext =>
                    new KestrelCommunicationListener(serviceContext, "${t.endpointName ?? 'ServiceEndpoint'}", (url, listener) =>
                    {
                        var builder = WebApplication.CreateBuilder();

                        builder.Services.AddSingleton(serviceContext);
                        builder.Services.AddControllers();

                        var app = builder.Build();

                        app.UseRouting();
                        app.MapControllers();

                        app.Urls.Add(url);${httpsAppendSnippet}
                        return app;
                    }))
            };
        }
    }
}
`;
}

function buildAspNetStatefulServiceCs(t: AddServiceTemplate, s: CsharpSettings): string {
	const httpsOpts = effectiveHttpsEndpoint(t);
	const httpsAppendSnippet = httpsOpts
		? `

                        // HTTPS URL resolved from the second SF endpoint.
                        var httpsEndpoint = serviceContext.CodePackageActivationContext
                            .GetEndpoint("${httpsOpts.name}");
                        app.Urls.Add($"https://+:{httpsEndpoint.Port}");`
		: '';
	return `using System.Collections.Generic;
using System.Fabric;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.ServiceFabric.Services.Communication.AspNetCore;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${s.rootNamespace}
{
    /// <summary>
    /// Stateful ASP.NET Core Reliable Service. The Kestrel host returned from
    /// <see cref="CreateServiceReplicaListeners"/> exposes the controllers
    /// declared under <c>Controllers/</c>; reliable collections are reachable
    /// via <c>this.StateManager</c>.
    /// </summary>
    internal sealed class ${s.className} : StatefulService
    {
        public ${s.className}(StatefulServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceReplicaListener> CreateServiceReplicaListeners()
        {
            return new[]
            {
                new ServiceReplicaListener(serviceContext =>
                    new KestrelCommunicationListener(serviceContext, "${t.endpointName ?? 'ServiceEndpoint'}", (url, listener) =>
                    {
                        var builder = WebApplication.CreateBuilder();

                        builder.Services.AddSingleton(serviceContext);
                        builder.Services.AddSingleton(this.StateManager);
                        builder.Services.AddControllers();

                        var app = builder.Build();

                        app.UseRouting();
                        app.MapControllers();

                        app.Urls.Add(url);${httpsAppendSnippet}
                        return app;
                    }))
            };
        }
    }
}
`;
}

/**
 * Returns the body of the default `Controllers/ValuesController.cs` for an
 * ASP.NET Core service. Mirrors the controller VS emits in the equivalent
 * project template.
 */
export function buildAspNetValuesControllerCs(t: AddServiceTemplate, settings?: CsharpSettings): string {
	if (!isAspNetKind(t.kind)) {
		throw new Error(`buildAspNetValuesControllerCs is only valid for ASP.NET kinds, got '${t.kind}'.`);
	}
	const s = settings ?? resolveCsharpSettings(t);
	return `using Microsoft.AspNetCore.Mvc;

namespace ${s.rootNamespace}.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public sealed class ValuesController : ControllerBase
    {
        // GET api/values
        [HttpGet]
        public IEnumerable<string> Get()
        {
            return new[] { "value1", "value2" };
        }

        // GET api/values/5
        [HttpGet("{id}")]
        public string Get(int id)
        {
            return $"value-{id}";
        }
    }
}
`;
}

/**
 * Returns the body of the default `appsettings.json` for an ASP.NET Core
 * service.
 */
export function buildAspNetAppsettingsJson(): string {
	return `{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  }
}
`;
}

/**
 * Returns the body of `appsettings.Development.json` for an ASP.NET Core
 * service. Mirrors the development overrides VS emits for new ASP.NET
 * projects: verbose logging + detailed errors so `dotnet run` produces
 * useful output during inner-loop authoring.
 */
export function buildAspNetAppsettingsDevelopmentJson(): string {
	return `{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Information",
      "Microsoft.Hosting.Lifetime": "Information"
    }
  },
  "DetailedErrors": true
}
`;
}

/**
 * Returns the body of `Properties/launchSettings.json` for a generated C#
 * service project. The contents differ by kind:
 *
 * - **Non-ASP.NET kinds** emit a single `Project` profile that runs the host
 *   exe with `DOTNET_ENVIRONMENT=Development`. Note that running outside an
 *   SF cluster will still fail at `ServiceRuntime.RegisterServiceAsync` —
 *   the profile is for debugger attach + F5 inside Visual Studio, not for
 *   `dotnet run`. The Reliable Services runtime requires the host process to
 *   be started by FabricHost.
 * - **ASP.NET kinds** add `applicationUrl=http://localhost:<port>`,
 *   `launchUrl="api/values"` and `launchBrowser=true`, plus
 *   `ASPNETCORE_ENVIRONMENT=Development`.
 *
 * @param ports HTTP port for ASP.NET kinds (legacy `number` form retained for
 *   back-compat) or `{ http, https? }` to opt into the dual-scheme
 *   `applicationUrl` shape used when the template's `httpsEndpoint` is set.
 *   Defaults to `{ http: 8080 }`. Throws when `https` is supplied for a
 *   non-ASP.NET kind — such templates have no Kestrel listener to host TLS.
 */
export function buildLaunchSettingsJson(t: AddServiceTemplate, ports: number | LaunchSettingsPorts = 8080): string {
	if (!isCsharpKind(t.kind)) {
		throw new Error(`buildLaunchSettingsJson is only valid for C# kinds, got '${t.kind}'.`);
	}
	const norm: LaunchSettingsPorts = typeof ports === 'number' ? { http: ports } : ports;
	if (norm.https !== undefined && !isAspNetKind(t.kind)) {
		throw new Error(`buildLaunchSettingsJson received an https port for non-ASP.NET kind '${t.kind}'.`);
	}
	const profileName = t.serviceName;
	if (isAspNetKind(t.kind)) {
		const applicationUrl =
			norm.https !== undefined ? `https://localhost:${norm.https};http://localhost:${norm.http}` : `http://localhost:${norm.http}`;
		const env: Record<string, string> = { ASPNETCORE_ENVIRONMENT: 'Development' };
		if (norm.https !== undefined) {
			env.ASPNETCORE_HTTPS_PORT = String(norm.https);
		}
		return (
			JSON.stringify(
				{
					profiles: {
						[profileName]: {
							commandName: 'Project',
							launchBrowser: true,
							launchUrl: 'api/values',
							applicationUrl,
							environmentVariables: env,
						},
					},
				},
				undefined,
				2,
			) +
			`
`
		);
	}
	return (
		JSON.stringify(
			{ profiles: { [profileName]: { commandName: 'Project', environmentVariables: { DOTNET_ENVIRONMENT: 'Development' } } } },
			undefined,
			2,
		) +
		`
`
	);
}

/**
 * Generates the SDK-style `.csproj` body for the chosen C# kind, matching
 * the Visual Studio canonical template (Application1) verbatim:
 *
 *  - `Microsoft.NET.Sdk.Web` for ASP.NET kinds; `Microsoft.NET.Sdk` otherwise.
 *  - `<TargetFramework>` comes from {@link resolveCsharpSettings}
 *    (`net10.0` by default for netcore, `net472` for legacy NetFramework).
 *  - `<RootNamespace>` is emitted only when the folder name contains
 *    characters that aren't valid C# identifier chars (e.g. `-`); otherwise
 *    the SDK derives it from the project name.
 *  - Self-contained publish props (`<ServerGarbageCollection>`,
 *    `<RuntimeIdentifier>`, `<SelfContained>`) are emitted for netcore.
 *  - Actor host adds `<UpdateServiceFabricManifestEnabled>`,
 *    `<ServicePackagePath>`, `<ServicePackagePrefix>`,
 *    `<FabActUtilWorkingDir>`, `<GenerateRuntimeConfigDevFile>` plus a
 *    `<ProjectReference>` to the sibling `.Interfaces` project.
 *  - Kind-specific NuGet `<PackageReference>` set:
 *      * plain stateless/stateful: `Microsoft.ServiceFabric.Services`.
 *      * `actor`: `Microsoft.ServiceFabric.Actors`.
 *      * ASP.NET: `Microsoft.AspNetCore.OpenApi 9.0.15` plus
 *        `Microsoft.ServiceFabric.AspNetCore.Kestrel`.
 *
 * No `<SfPackageRoot>`, `linkedPackageRoot` ItemGroup, `appsettings*`
 * `<None Update>` ItemGroup, or `CopyToServiceFabricPackageRoot` AfterBuild
 * target is emitted — the .sfproj's `Package` target reads
 * `<csprojDir>/PackageRoot/` directly.
 */
export function buildCsharpCsproj(t: AddServiceTemplate, paths?: CsharpProjectPaths, settings?: CsharpSettings): string {
	if (!isCsharpKind(t.kind)) {
		throw new Error(`buildCsharpCsproj is only valid for C# kinds, got '${t.kind}'.`);
	}
	const s = settings ?? resolveCsharpSettings(t);
	// SDK selection: ASP.NET kinds use Sdk.Web for the implicit FrameworkReference.
	const sdk = isAspNetKind(t.kind) ? 'Microsoft.NET.Sdk.Web' : 'Microsoft.NET.Sdk';
	// OutputType: ASP.NET csprojs (Sdk.Web) imply Exe; plain/Actor explicitly emit it.
	const outputTypeProp = isAspNetKind(t.kind)
		? ''
		: `
    <OutputType>Exe</OutputType>`;
	// RootNamespace: only emit when the folder name contains characters
	// illegal in a C# identifier (e.g. `-`). Otherwise the SDK derives it
	// from the project filename automatically.
	const folderName = s.csprojDirName;
	const rootNsProp = /[^A-Za-z0-9_]/.test(folderName)
		? `
    <RootNamespace>${sanitizeNamespace(folderName)}</RootNamespace>`
		: '';
	// Modern netcore props: Nullable + ImplicitUsings (off on net472).
	const modernProps =
		s.runtime === 'netcore'
			? `
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>`
			: '';
	// Self-contained publish props for netcore kinds.
	const selfContainedProps =
		s.runtime === 'netcore'
			? `
    <ServerGarbageCollection>True</ServerGarbageCollection>
    <RuntimeIdentifier>${s.runtimeIdentifier ?? 'win-x64'}</RuntimeIdentifier>
    <SelfContained>True</SelfContained>`
			: '';
	// Service-Fabric build integration marker.
	const sfMarker = `
    <IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>`;
	// Actor-only properties (FabActUtil + ServicePackage*).
	const actorProps =
		t.kind === 'actor'
			? `
    <UpdateServiceFabricManifestEnabled>True</UpdateServiceFabricManifestEnabled>
    <ServicePackagePath>PackageRoot</ServicePackagePath>
    <ServicePackagePrefix>$(MSBuildProjectName)</ServicePackagePrefix>
    <FabActUtilWorkingDir>$(BaseIntermediateOutputPath)\\FabActUtilTemp</FabActUtilWorkingDir>
    <GenerateRuntimeConfigDevFile>true</GenerateRuntimeConfigDevFile>`
			: '';
	// Kind-specific package references (Application1-canonical versions).
	const packageRefs: string[] = [];
	if (t.kind === 'actor') {
		packageRefs.push(`    <PackageReference Include="Microsoft.ServiceFabric.Actors" Version="${s.sdkVersion}" />`);
	} else if (isAspNetKind(t.kind)) {
		packageRefs.push('    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="9.0.15" />');
		packageRefs.push(`    <PackageReference Include="Microsoft.ServiceFabric.AspNetCore.Kestrel" Version="${s.sdkVersion}" />`);
	} else {
		// stateless / stateful — plain Reliable Services
		packageRefs.push(`    <PackageReference Include="Microsoft.ServiceFabric.Services" Version="${s.sdkVersion}" />`);
	}
	// Sibling Actor interfaces project reference.
	const actorInterfacesRef =
		t.kind === 'actor'
			? `
  <ItemGroup>
    <ProjectReference Include="${paths?.actorInterfacesProjectRelativePath ?? `..\\${folderName}.Interfaces\\${folderName}.Interfaces.csproj`}" />
  </ItemGroup>
`
			: '';
	return `<Project Sdk="${sdk}">

  <PropertyGroup>${outputTypeProp}
    <TargetFramework>${s.targetFramework}</TargetFramework>${rootNsProp}${modernProps}${sfMarker}${selfContainedProps}${actorProps}
  </PropertyGroup>

  <ItemGroup>
${packageRefs.join(`
`)}
  </ItemGroup>${actorInterfacesRef}
</Project>
`;
}

/**
 * Generates the SDK-style `.csproj` body for the sibling Actor interfaces
 * project (`<Folder>.Interfaces/<Folder>.Interfaces.csproj`). This is a
 * library project with a single `Microsoft.ServiceFabric.Actors` reference
 * — it carries the public actor interface(s) consumed by clients and by the
 * actor host project.
 */
export function buildActorInterfacesCsproj(t: AddServiceTemplate, settings?: CsharpSettings): string {
	if (t.kind !== 'actor') {
		throw new Error(`buildActorInterfacesCsproj is only valid for the 'actor' kind, got '${t.kind}'.`);
	}
	const s = settings ?? resolveCsharpSettings(t);
	const modernProps =
		s.runtime === 'netcore'
			? `
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>`
			: '';
	const selfContainedProps =
		s.runtime === 'netcore'
			? `
    <RuntimeIdentifier>${s.runtimeIdentifier ?? 'win-x64'}</RuntimeIdentifier>
    <SelfContained>True</SelfContained>`
			: '';
	return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>${s.targetFramework}</TargetFramework>${modernProps}${selfContainedProps}
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.ServiceFabric.Actors" Version="${s.sdkVersion}" />
  </ItemGroup>

</Project>
`;
}

// ---------------------------------------------------------------------------
// .sfproj <ProjectReference> patcher
// ---------------------------------------------------------------------------

/**
 * Adds a `<ProjectReference Include="..." />` line to the .sfproj.
 *
 * - If an existing `<ItemGroup>` already contains `<ProjectReference>` entries,
 *   the new line is appended to that group.
 * - Otherwise a fresh `<ItemGroup>` is inserted just before the `<Import ...>`
 *   element (or before `</Project>` if no Import is present).
 * - For ASP.NET kinds (when `options.kind` is `aspNetStateless` /
 *   `aspNetStateful`), the reference becomes a multi-line element with a
 *   nested `<ServiceLaunchUrl>http://localhost:{ServicePort}/</ServiceLaunchUrl>`
 *   child to mirror the VS canonical sfproj.
 *
 * No-op (returns the original text) when an identical reference is already
 * present, regardless of slash direction or case.
 */
export function patchSfprojForProjectReference(xml: string, csprojRelativePath: string, options?: SfprojProjectReferenceOptions): string {
	const normalized = csprojRelativePath.replace(/\//g, '\\');
	const escapedNormalized = normalized.replace(/\\/g, '\\\\').replace(/\./g, '\\.');
	const existing = new RegExp(
		`<ProjectReference\\s+Include="(?:${escapedNormalized}|${csprojRelativePath.replace(/[.\\/]/g, (m) => '\\' + m)})"`,
		'i',
	);
	if (existing.test(xml)) return xml;
	const isAspNet = options?.kind ? isAspNetKind(options.kind) : false;
	const newLine = isAspNet
		? `    <ProjectReference Include="${normalized}">
      <ServiceLaunchUrl>http://localhost:{ServicePort}/</ServiceLaunchUrl>
    </ProjectReference>`
		: `    <ProjectReference Include="${normalized}" />`;
	// Look for an ItemGroup that already contains <ProjectReference>.
	const itemGroupRe = /<ItemGroup[^>]*>([\s\S]*?)<\/ItemGroup>/g;
	let match: RegExpExecArray | null;
	let targetMatch: { start: number; end: number } | null = null;
	while ((match = itemGroupRe.exec(xml)) !== null) {
		if (/<ProjectReference\b/.test(match[1])) {
			targetMatch = { start: match.index, end: match.index + match[0].length };
			break;
		}
	}
	if (targetMatch) {
		const block = xml.slice(targetMatch.start, targetMatch.end);
		const patched = block.replace(
			/(\s*<\/ItemGroup>)/,
			`
${newLine}$1`,
		);
		return xml.slice(0, targetMatch.start) + patched + xml.slice(targetMatch.end);
	}
	const newGroup = `  <ItemGroup>
${newLine}
  </ItemGroup>
`;
	if (/<Import\b[^>]*\/>/.test(xml)) {
		return xml.replace(
			/(\s*<Import\b[^>]*\/>)/,
			`
${newGroup}$1`,
		);
	}
	return xml.replace(
		/(\s*<\/Project>)/,
		`
${newGroup}$1`,
	);
}
