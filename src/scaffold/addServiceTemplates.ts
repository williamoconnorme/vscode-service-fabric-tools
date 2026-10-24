// @ts-nocheck

function effectiveHttpsEndpoint(e) {
	if (e.httpsEndpoint && isAspNetKind(e.kind))
		return {
			name: e.httpsEndpoint.name ?? 'ServiceHttpsEndpoint',
			port: e.httpsEndpoint.port ?? 8443,
		};
}

function isCsharpKind(e) {
	return e !== 'guest';
}

function isStatefulKind(e) {
	return e === 'stateful' || e === 'actor' || e === 'aspNetStateful';
}

function isAspNetKind(e) {
	return e === 'aspNetStateless' || e === 'aspNetStateful';
}

function effectiveRuntime(e) {
	return isAspNetKind(e.kind) ? 'netcore' : (e.runtime ?? 'netcore');
}

function defaultParametersFor(e) {
	let t = e.serviceName;
	return isStatefulKind(e.kind)
		? [
				{
					name: `${t}_PartitionCount`,
					defaultValue: '1',
				},
				{
					name: `${t}_MinReplicaSetSize`,
					defaultValue: '3',
				},
				{
					name: `${t}_TargetReplicaSetSize`,
					defaultValue: '3',
				},
			]
		: [
				{
					name: `${t}_InstanceCount`,
					defaultValue: '-1',
				},
			];
}

function buildServiceManifestXml(e) {
	let t = e.endpointName ?? 'ServiceEndpoint',
		r = e.exeProgram ?? `${e.serviceName}.exe`,
		n;
	switch (e.kind) {
		case 'stateful':
		case 'aspNetStateful':
			n = `<StatefulServiceType ServiceTypeName="${e.serviceTypeName}" HasPersistedState="true" />`;
			break;
		case 'actor':
			return `<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${e.serviceName}Pkg"
                 Version="${e.version}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <!-- The content will be generated during build -->
</ServiceManifest>
`;
		case 'guest':
			n = `<StatelessServiceType ServiceTypeName="${e.serviceTypeName}" UseImplicitHost="true" />`;
			break;
		case 'aspNetStateless':
		case 'stateless':
		default:
			n = `<StatelessServiceType ServiceTypeName="${e.serviceTypeName}" />`;
			break;
	}
	let i = [`        <Program>${r}</Program>`];
	(e.kind === 'guest' &&
		e.guestArguments &&
		e.guestArguments.trim() !== '' &&
		i.push(`        <Arguments>${escapeXml(e.guestArguments)}</Arguments>`),
		e.kind === 'guest'
			? i.push(`        <WorkingFolder>${e.guestWorkingFolder ?? 'CodePackage'}</WorkingFolder>`)
			: isAspNetKind(e.kind) && i.push('        <WorkingFolder>CodePackage</WorkingFolder>'));
	let o = isAspNetKind(e.kind)
			? `
    <EnvironmentVariables>
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value=""/>
    </EnvironmentVariables>`
			: '',
		s,
		a = effectiveHttpsEndpoint(e);
	if (e.kind === 'aspNetStateful' && !a) s = '';
	else if (e.kind === 'aspNetStateless' || e.kind === 'aspNetStateful') {
		let c = e.endpointPort ?? 8559,
			l = [`      <Endpoint Protocol="http" Name="${t}" Type="Input" Port="${c}" />`];
		(a && l.push(`      <Endpoint Protocol="https" Name="${a.name}" Type="Input" Port="${a.port}" />`),
			(s = `
  <Resources>
    <Endpoints>
${l.join(`
`)}
    </Endpoints>
  </Resources>`));
	} else
		e.kind === 'stateful'
			? (s = `
  <Resources>
    <Endpoints>
      <Endpoint Name="${t}" />
      <Endpoint Name="ReplicatorEndpoint" />
    </Endpoints>
  </Resources>`)
			: (s = `
  <Resources>
    <Endpoints>
      <Endpoint Name="${t}" />
    </Endpoints>
  </Resources>`);
	return `<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${e.serviceName}Pkg" Version="${e.version}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ServiceTypes>
    ${n}
  </ServiceTypes>
  <CodePackage Name="Code" Version="${e.version}">
    <EntryPoint>
      <ExeHost>
${i.join(`
`)}
      </ExeHost>
    </EntryPoint>${o}
  </CodePackage>
  <ConfigPackage Name="Config" Version="${e.version}" />${s}
</ServiceManifest>
`;
}

function buildSettingsXml() {
	return `<?xml version="1.0" encoding="utf-8"?>
<Settings xmlns="http://schemas.microsoft.com/2011/01/fabric"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
</Settings>
`;
}

function patchApplicationManifest(e, t) {
	let r = patchApplicationManifestImports(e, t),
		n = injectLegacyDefaultServiceParameters(r, t);
	return appendDefaultServiceBlock(n, t);
}

function injectLegacyDefaultServiceParameters(e, t) {
	let r = e,
		i = defaultParametersFor(t).filter((s) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(s.name)}"`, 'i').test(r));
	if (i.length === 0) return r;
	let o = i.map((s) => `    <Parameter Name="${s.name}" DefaultValue="${s.defaultValue}" />`).join(`
`);
	return (
		/<Parameters\s*\/>/.test(r)
			? (r = r.replace(
					/<Parameters\s*\/>/,
					`<Parameters>
${o}
  </Parameters>`,
				))
			: /<Parameters\b[^>]*>[\s\S]*?<\/Parameters>/.test(r)
				? (r = r.replace(
						/(<\/Parameters>)/,
						`${o}
  $1`,
					))
				: (r = r.replace(
						/(<ApplicationManifest\b[^>]*>)/,
						`$1
  <Parameters>
${o}
  </Parameters>`,
					)),
		r
	);
}

function patchApplicationManifestImports(e, t) {
	let r = e,
		i = (
			isAspNetKind(t.kind)
				? [
						{
							name: `${t.serviceName}_ASPNETCORE_ENVIRONMENT`,
							defaultValue: '',
						},
					]
				: []
		).filter((c) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(c.name)}"`, 'i').test(r));
	if (i.length > 0) {
		let c = i.map((l) => `    <Parameter Name="${l.name}" DefaultValue="${l.defaultValue}" />`).join(`
`);
		/<Parameters\s*\/>/.test(r)
			? (r = r.replace(
					/<Parameters\s*\/>/,
					`<Parameters>
${c}
  </Parameters>`,
				))
			: /<Parameters\b[^>]*>[\s\S]*?<\/Parameters>/.test(r)
				? (r = r.replace(
						/(<\/Parameters>)/,
						`${c}
  $1`,
					))
				: (r = r.replace(
						/(<ApplicationManifest\b[^>]*>)/,
						`$1
  <Parameters>
${c}
  </Parameters>`,
					));
	}
	let o;
	t.kind === 'actor'
		? (o = '')
		: isAspNetKind(t.kind)
			? (o = `
    <ConfigOverrides />
    <EnvironmentOverrides CodePackageRef="code">
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value="[${t.serviceName}_ASPNETCORE_ENVIRONMENT]" />
    </EnvironmentOverrides>
  `)
			: (o = `
    <ConfigOverrides />
  `);
	let s = `  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="${t.serviceName}Pkg" ServiceManifestVersion="${t.version}" />${o}</ServiceManifestImport>`;
	return (
		new RegExp(`<ServiceManifestRef\\s+ServiceManifestName="${escapeRegex(t.serviceName)}Pkg"`, 'i').test(r) ||
			(/<\/ServiceManifestImport>/.test(r)
				? (r = replaceLastMatch(
						r,
						/<\/ServiceManifestImport>/g,
						(c) => `${c}
${s}`,
					))
				: /<DefaultServices\b/.test(r)
					? (r = r.replace(
							/(\s*<DefaultServices\b)/,
							`
${s}$1`,
						))
					: (r = r.replace(
							/(\s*<\/ApplicationManifest>)/,
							`
${s}$1`,
						))),
		r
	);
}

function appendDefaultServiceBlock(e, t) {
	let r = e;
	if (new RegExp(`<Service\\s+Name="${escapeRegex(t.serviceName)}"`, 'i').test(r)) return r;
	let i = buildDefaultServiceBlock(t);
	return (
		/<DefaultServices\b[^>]*\/>/.test(r)
			? (r = r.replace(
					/<DefaultServices\b[^>]*\/>/,
					`<DefaultServices>
${i}
  </DefaultServices>`,
				))
			: /<\/DefaultServices>/.test(r)
				? (r = r.replace(
						/(<\/DefaultServices>)/,
						`${i}
  $1`,
					))
				: (r = r.replace(
						/(\s*<\/ApplicationManifest>)/,
						`
  <DefaultServices>
${i}
  </DefaultServices>$1`,
					)),
		r
	);
}

function patchStartupServicesXml(e, t) {
	if (t.kind === 'actor') return e;
	let r = e,
		n = defaultParametersFor(t).filter((o) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(o.name)}"`).test(r));
	if (n.length > 0) {
		let o = n.map((s) => `    <Parameter Name="${s.name}" DefaultValue="${s.defaultValue}" />`).join(`
`);
		/<Parameters\s*\/>/.test(r)
			? (r = r.replace(
					/<Parameters\s*\/>/,
					`<Parameters>
${o}
  </Parameters>`,
				))
			: /<\/Parameters>/.test(r)
				? (r = r.replace(
						/(<\/Parameters>)/,
						`${o}
  $1`,
					))
				: (r = r.replace(
						/(<StartupServicesManifest\b[^>]*>)/,
						`$1
  <Parameters>
${o}
  </Parameters>`,
					));
	}
	if (!new RegExp(`<Service\\s+Name="${escapeRegex(t.serviceName)}"`, 'i').test(r)) {
		let o = buildStartupServiceBlock(t);
		/<Services\s*\/>/.test(r)
			? (r = r.replace(
					/<Services\s*\/>/,
					`<Services>
${o}
  </Services>`,
				))
			: /<\/Services>/.test(r)
				? (r = r.replace(
						/(<\/Services>)/,
						`${o}
  $1`,
					))
				: (r = r.replace(
						/(\s*<\/StartupServicesManifest>)/,
						`
  <Services>
${o}
  </Services>$1`,
					));
	}
	return r;
}

function patchStartupServiceParametersXml(e, t, r) {
	if (t.kind === 'actor') return e;
	let n = [];
	if (isStatefulKind(t.kind)) {
		let a = r === 'oneNode' ? '1' : '3',
			c = r === 'oneNode' ? '1' : '3';
		n.push(
			{
				name: `${t.serviceName}_PartitionCount`,
				defaultValue: '1',
			},
			{
				name: `${t.serviceName}_MinReplicaSetSize`,
				defaultValue: a,
			},
			{
				name: `${t.serviceName}_TargetReplicaSetSize`,
				defaultValue: c,
			},
		);
	} else
		n.push({
			name: `${t.serviceName}_InstanceCount`,
			defaultValue: r === 'oneNode' ? '1' : r === 'fiveNode' ? '3' : '-1',
		});
	let i = e,
		o = n.filter((a) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(a.name)}"`).test(i));
	if (o.length === 0) return i;
	let s = o.map((a) => `    <Parameter Name="${a.name}" Value="${a.defaultValue}" />`).join(`
`);
	return (
		/<Parameters\s*\/>/.test(i)
			? (i = i.replace(
					/<Parameters\s*\/>/,
					`<Parameters>
${s}
  </Parameters>`,
				))
			: /<\/Parameters>/.test(i)
				? (i = i.replace(
						/(<\/Parameters>)/,
						`${s}
  $1`,
					))
				: (i = i.replace(
						/(<StartupServices\b[^>]*>)/,
						`$1
  <Parameters>
${s}
  </Parameters>`,
					)),
		i
	);
}

function buildStartupServiceBlock(e) {
	let t = e.serviceName;
	return isStatefulKind(e.kind)
		? [
				`    <Service Name="${t}" ServicePackageActivationMode="ExclusiveProcess">`,
				`      <StatefulService ServiceTypeName="${e.serviceTypeName}" TargetReplicaSetSize="[${t}_TargetReplicaSetSize]" MinReplicaSetSize="[${t}_MinReplicaSetSize]">`,
				`        <UniformInt64Partition PartitionCount="[${t}_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />`,
				'      </StatefulService>',
				'    </Service>',
			].join(`
`)
		: [
				`    <Service Name="${t}" ServicePackageActivationMode="ExclusiveProcess">`,
				`      <StatelessService ServiceTypeName="${e.serviceTypeName}" InstanceCount="[${t}_InstanceCount]">`,
				'        <SingletonPartition />',
				'      </StatelessService>',
				'    </Service>',
			].join(`
`);
}

function buildDefaultServiceBlock(e) {
	let t = e.serviceName;
	return isStatefulKind(e.kind)
		? [
				`    <Service Name="${t}">`,
				`      <StatefulService ServiceTypeName="${e.serviceTypeName}" TargetReplicaSetSize="[${t}_TargetReplicaSetSize]" MinReplicaSetSize="[${t}_MinReplicaSetSize]">`,
				`        <UniformInt64Partition PartitionCount="[${t}_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />`,
				'      </StatefulService>',
				'    </Service>',
			].join(`
`)
		: [
				`    <Service Name="${t}">`,
				`      <StatelessService ServiceTypeName="${e.serviceTypeName}" InstanceCount="[${t}_InstanceCount]">`,
				'        <SingletonPartition />',
				'      </StatelessService>',
				'    </Service>',
			].join(`
`);
}

function patchApplicationParametersXml(e, t, r) {
	let n = [];
	if (isAspNetKind(t.kind)) {
		let a = r === 'cloud' ? '' : 'Development';
		n.push({
			name: `${t.serviceName}_ASPNETCORE_ENVIRONMENT`,
			defaultValue: a,
		});
	}
	let i = e,
		o = n.filter((a) => !new RegExp(`<Parameter\\s+Name="${escapeRegex(a.name)}"`).test(i));
	if (o.length === 0) return i;
	let s = o.map((a) => `    <Parameter Name="${a.name}" Value="${a.defaultValue}" />`).join(`
`);
	return (
		/<Parameters\s*\/>/.test(i)
			? (i = i.replace(
					/<Parameters\s*\/>/,
					`<Parameters>
${s}
  </Parameters>`,
				))
			: /<\/Parameters>/.test(i)
				? (i = i.replace(
						/(<\/Parameters>)/,
						`${s}
  $1`,
					))
				: (i = i.replace(
						/(<Application\b[^>]*>)/,
						`$1
  <Parameters>
${s}
  </Parameters>`,
					)),
		i
	);
}

function classifyEnvironment(e) {
	let t = e.toLowerCase();
	return t.includes('1node') || t.includes('one') || t.includes('local.dev')
		? 'oneNode'
		: t.includes('5node') || t.includes('five')
			? 'fiveNode'
			: 'cloud';
}

function escapeRegex(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(e) {
	return e.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function replaceLastMatch(e, t, r) {
	let n = -1,
		i = null;
	t.lastIndex = 0;
	let o;
	for (; (o = t.exec(e)) !== null && ((n = o.index), (i = o), !!t.global););
	return i === null || n < 0 ? e : e.slice(0, n) + r(i[0]) + e.slice(n + i[0].length);
}

function resolveCsharpSettings(e) {
	let t = effectiveRuntime(e),
		r = sanitizeClassName(e.serviceName),
		n = e.rootNamespace?.trim() || sanitizeNamespace(e.serviceName),
		i = e.exeProgram?.replace(/\.exe$/i, '') ?? e.serviceName,
		o = t === 'netfx' ? 'net472' : 'net10.0',
		s = t === 'netcore' ? 'win-x64' : void 0;
	return {
		className: r,
		rootNamespace: n,
		assemblyName: i,
		targetFramework: e.targetFramework ?? o,
		sdkVersion: e.serviceFabricSdkVersion ?? '8.1.208',
		csprojDirName: e.csprojDirName ?? e.serviceName,
		runtime: t,
		runtimeIdentifier: s,
		actorTypeName: r,
		actorInterfaceName: `I${r}`,
	};
}

function sanitizeClassName(e) {
	let t = e.replace(/[^A-Za-z0-9]/g, '');
	return t ? (/^[0-9]/.test(t) ? `_${t}` : t) : 'Service';
}

function sanitizeNamespace(e) {
	return (
		e
			.split('.')
			.map((t) => t.replace(/[^A-Za-z0-9_]/g, ''))
			.filter((t) => t.length > 0)
			.map((t) => (/^[0-9]/.test(t) ? `_${t}` : t))
			.join('.') || 'Service'
	);
}

function buildCsharpProgramCs(e, t) {
	if (!isCsharpKind(e.kind)) throw new Error(`buildCsharpProgramCs is only valid for C# kinds, got '${e.kind}'.`);
	let r = t ?? resolveCsharpSettings(e);
	return e.kind === 'actor'
		? `using System;
using System.Threading;
using Microsoft.ServiceFabric.Actors.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// Entry point for the '${e.serviceName}' Service Fabric actor service.
    /// Generated by the VS Code Service Fabric extension.
    /// </summary>
    internal static class Program
    {
        private static void Main()
        {
            try
            {
                ActorRuntime.RegisterActorAsync<${r.actorTypeName}>(
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
`
		: isAspNetKind(e.kind)
			? `using System;
using System.Threading;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// Entry point for the '${e.serviceName}' Service Fabric ${describeKindForComment(e.kind)} service.
    /// Generated by the VS Code Service Fabric extension.
    /// </summary>
    internal static class Program
    {
        private static void Main()
        {
            try
            {
                ServiceRuntime.RegisterServiceAsync(
                    "${e.serviceTypeName}",
                    context => new ${r.className}(context))
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
`
			: `using System;
using System.Threading;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// Entry point for the '${e.serviceName}' Service Fabric ${describeKindForComment(e.kind)} service.
    /// Generated by the VS Code Service Fabric extension.
    /// </summary>
    internal static class Program
    {
        private static void Main()
        {
            try
            {
                ServiceRuntime.RegisterServiceAsync(
                    "${e.serviceTypeName}",
                    context => new ${r.className}(context))
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

function describeKindForComment(e) {
	switch (e) {
		case 'aspNetStateless':
			return 'stateless ASP.NET Core';
		case 'aspNetStateful':
			return 'stateful ASP.NET Core';
		default:
			return e;
	}
}

function buildCsharpServiceCs(e, t) {
	if (!isCsharpKind(e.kind)) throw new Error(`buildCsharpServiceCs is only valid for C# kinds, got '${e.kind}'.`);
	if (e.kind === 'actor') throw new Error("buildCsharpServiceCs does not handle the 'actor' kind; use buildActorCs instead.");
	let r = t ?? resolveCsharpSettings(e);
	return e.kind === 'aspNetStateless'
		? buildAspNetStatelessServiceCs(e, r)
		: e.kind === 'aspNetStateful'
			? buildAspNetStatefulServiceCs(e, r)
			: e.kind === 'stateful'
				? `using System;
using System.Collections.Generic;
using System.Fabric;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.ServiceFabric.Data.Collections;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// A minimal stateful Reliable Service. Replace <c>RunAsync</c> with your own logic.
    /// </summary>
    internal sealed class ${r.className} : StatefulService
    {
        public ${r.className}(StatefulServiceContext context) : base(context) { }

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
`
				: `using System;
using System.Collections.Generic;
using System.Fabric;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// A minimal stateless Reliable Service. Replace <c>RunAsync</c> with your own logic.
    /// </summary>
    internal sealed class ${r.className} : StatelessService
    {
        public ${r.className}(StatelessServiceContext context) : base(context) { }

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

function buildActorInterfaceCs(e, t) {
	if (e.kind !== 'actor') throw new Error(`buildActorInterfaceCs is only valid for the 'actor' kind, got '${e.kind}'.`);
	let r = t ?? resolveCsharpSettings(e);
	return `using System.Threading.Tasks;
using Microsoft.ServiceFabric.Actors;

namespace ${r.rootNamespace}.Interfaces
{
    /// <summary>
    /// Public actor contract for ${r.actorTypeName}. Add the methods callers
    /// will invoke on a proxy obtained via
    /// <c>ActorProxy.Create&lt;${r.actorInterfaceName}&gt;(...)</c>.
    /// </summary>
    public interface ${r.actorInterfaceName} : IActor
    {
        Task<long> GetCountAsync();

        Task SetCountAsync(long count);
    }
}
`;
}

function buildActorCs(e, t) {
	if (e.kind !== 'actor') throw new Error(`buildActorCs is only valid for the 'actor' kind, got '${e.kind}'.`);
	let r = t ?? resolveCsharpSettings(e);
	return `using System.Threading.Tasks;
using Microsoft.ServiceFabric.Actors;
using Microsoft.ServiceFabric.Actors.Runtime;
using ${r.rootNamespace}.Interfaces;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// Default virtual-actor implementation. Replace the demo state with the
    /// fields and methods your application needs.
    /// </summary>
    [StatePersistence(StatePersistence.Persisted)]
    internal sealed class ${r.actorTypeName} : Actor, ${r.actorInterfaceName}
    {
        public ${r.actorTypeName}(ActorService actorService, ActorId actorId)
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

function buildAspNetStatelessServiceCs(e, t) {
	let r = effectiveHttpsEndpoint(e),
		n = r
			? `

                        // HTTPS URL resolved from the second SF endpoint.
                        var httpsEndpoint = serviceContext.CodePackageActivationContext
                            .GetEndpoint("${r.name}");
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

namespace ${t.rootNamespace}
{
    /// <summary>
    /// Stateless ASP.NET Core Reliable Service. The Kestrel host returned from
    /// <see cref="CreateServiceInstanceListeners"/> exposes the controllers
    /// declared under <c>Controllers/</c>.
    /// </summary>
    internal sealed class ${t.className} : StatelessService
    {
        public ${t.className}(StatelessServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceInstanceListener> CreateServiceInstanceListeners()
        {
            return new[]
            {
                new ServiceInstanceListener(serviceContext =>
                    new KestrelCommunicationListener(serviceContext, "ServiceEndpoint", (url, listener) =>
                    {
                        var builder = WebApplication.CreateBuilder();

                        builder.Services.AddSingleton(serviceContext);
                        builder.Services.AddControllers();

                        var app = builder.Build();

                        app.UseRouting();
                        app.MapControllers();

                        app.Urls.Add(url);${n}
                        return app;
                    }))
            };
        }
    }
}
`;
}

function buildAspNetStatefulServiceCs(e, t) {
	let r = effectiveHttpsEndpoint(e),
		n = r
			? `

                        // HTTPS URL resolved from the second SF endpoint.
                        var httpsEndpoint = serviceContext.CodePackageActivationContext
                            .GetEndpoint("${r.name}");
                        app.Urls.Add($"https://+:{httpsEndpoint.Port}");`
			: '';
	return `using System.Collections.Generic;
using System.Fabric;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.ServiceFabric.Services.Communication.AspNetCore;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${t.rootNamespace}
{
    /// <summary>
    /// Stateful ASP.NET Core Reliable Service. The Kestrel host returned from
    /// <see cref="CreateServiceReplicaListeners"/> exposes the controllers
    /// declared under <c>Controllers/</c>; reliable collections are reachable
    /// via <c>this.StateManager</c>.
    /// </summary>
    internal sealed class ${t.className} : StatefulService
    {
        public ${t.className}(StatefulServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceReplicaListener> CreateServiceReplicaListeners()
        {
            return new[]
            {
                new ServiceReplicaListener(serviceContext =>
                    new KestrelCommunicationListener(serviceContext, "ServiceEndpoint", (url, listener) =>
                    {
                        var builder = WebApplication.CreateBuilder();

                        builder.Services.AddSingleton(serviceContext);
                        builder.Services.AddSingleton(this.StateManager);
                        builder.Services.AddControllers();

                        var app = builder.Build();

                        app.UseRouting();
                        app.MapControllers();

                        app.Urls.Add(url);${n}
                        return app;
                    }))
            };
        }
    }
}
`;
}

function buildAspNetValuesControllerCs(e, t) {
	if (!isAspNetKind(e.kind)) throw new Error(`buildAspNetValuesControllerCs is only valid for ASP.NET kinds, got '${e.kind}'.`);
	return `using Microsoft.AspNetCore.Mvc;

namespace ${(t ?? resolveCsharpSettings(e)).rootNamespace}.Controllers
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

function buildAspNetAppsettingsJson() {
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

function buildAspNetAppsettingsDevelopmentJson() {
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

function buildLaunchSettingsJson(e, t = 8080) {
	if (!isCsharpKind(e.kind)) throw new Error(`buildLaunchSettingsJson is only valid for C# kinds, got '${e.kind}'.`);
	let r =
		typeof t == 'number'
			? {
					http: t,
				}
			: t;
	if (r.https !== void 0 && !isAspNetKind(e.kind))
		throw new Error(`buildLaunchSettingsJson received an https port for non-ASP.NET kind '${e.kind}'.`);
	let n = e.serviceName;
	if (isAspNetKind(e.kind)) {
		let i = r.https !== void 0 ? `https://localhost:${r.https};http://localhost:${r.http}` : `http://localhost:${r.http}`,
			o = {
				ASPNETCORE_ENVIRONMENT: 'Development',
			};
		return (
			r.https !== void 0 && (o.ASPNETCORE_HTTPS_PORT = String(r.https)),
			JSON.stringify(
				{
					profiles: {
						[n]: {
							commandName: 'Project',
							launchBrowser: !0,
							launchUrl: 'api/values',
							applicationUrl: i,
							environmentVariables: o,
						},
					},
				},
				void 0,
				2,
			) +
				`
`
		);
	}
	return (
		JSON.stringify(
			{
				profiles: {
					[n]: {
						commandName: 'Project',
						environmentVariables: {
							DOTNET_ENVIRONMENT: 'Development',
						},
					},
				},
			},
			void 0,
			2,
		) +
		`
`
	);
}

function buildCsharpCsproj(e, t, r) {
	if (!isCsharpKind(e.kind)) throw new Error(`buildCsharpCsproj is only valid for C# kinds, got '${e.kind}'.`);
	let n = r ?? resolveCsharpSettings(e),
		i = isAspNetKind(e.kind) ? 'Microsoft.NET.Sdk.Web' : 'Microsoft.NET.Sdk',
		o = isAspNetKind(e.kind)
			? ''
			: `
    <OutputType>Exe</OutputType>`,
		s = n.csprojDirName,
		c = /[^A-Za-z0-9_]/.test(s)
			? `
    <RootNamespace>${sanitizeNamespace(s)}</RootNamespace>`
			: '',
		l =
			n.runtime === 'netcore'
				? `
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>`
				: '',
		u =
			n.runtime === 'netcore'
				? `
    <ServerGarbageCollection>True</ServerGarbageCollection>
    <RuntimeIdentifier>${n.runtimeIdentifier ?? 'win-x64'}</RuntimeIdentifier>
    <SelfContained>True</SelfContained>`
				: '',
		p = `
    <IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>`,
		d =
			e.kind === 'actor'
				? `
    <UpdateServiceFabricManifestEnabled>True</UpdateServiceFabricManifestEnabled>
    <ServicePackagePath>PackageRoot</ServicePackagePath>
    <ServicePackagePrefix>$(MSBuildProjectName)</ServicePackagePrefix>
    <FabActUtilWorkingDir>$(BaseIntermediateOutputPath)\\FabActUtilTemp</FabActUtilWorkingDir>
    <GenerateRuntimeConfigDevFile>true</GenerateRuntimeConfigDevFile>`
				: '',
		f = [];
	e.kind === 'actor'
		? f.push(`    <PackageReference Include="Microsoft.ServiceFabric.Actors" Version="${n.sdkVersion}" />`)
		: isAspNetKind(e.kind)
			? (f.push('    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="9.0.15" />'),
				f.push(`    <PackageReference Include="Microsoft.ServiceFabric.AspNetCore.Kestrel" Version="${n.sdkVersion}" />`))
			: f.push(`    <PackageReference Include="Microsoft.ServiceFabric.Services" Version="${n.sdkVersion}" />`);
	let m =
		e.kind === 'actor'
			? `
  <ItemGroup>
    <ProjectReference Include="${t?.actorInterfacesProjectRelativePath ?? `..\\${s}.Interfaces\\${s}.Interfaces.csproj`}" />
  </ItemGroup>
`
			: '';
	return `<Project Sdk="${i}">

  <PropertyGroup>${o}
    <TargetFramework>${n.targetFramework}</TargetFramework>${c}${l}${p}${u}${d}
  </PropertyGroup>

  <ItemGroup>
${f.join(`
`)}
  </ItemGroup>${m}
</Project>
`;
}

function buildActorInterfacesCsproj(e, t) {
	if (e.kind !== 'actor') throw new Error(`buildActorInterfacesCsproj is only valid for the 'actor' kind, got '${e.kind}'.`);
	let r = t ?? resolveCsharpSettings(e),
		n =
			r.runtime === 'netcore'
				? `
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>`
				: '',
		i =
			r.runtime === 'netcore'
				? `
    <RuntimeIdentifier>${r.runtimeIdentifier ?? 'win-x64'}</RuntimeIdentifier>
    <SelfContained>True</SelfContained>`
				: '';
	return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>${r.targetFramework}</TargetFramework>${n}${i}
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.ServiceFabric.Actors" Version="${r.sdkVersion}" />
  </ItemGroup>

</Project>
`;
}

function patchSfprojForProjectReference(e, t, r) {
	let n = t.replace(/\//g, '\\'),
		i = n.replace(/\\/g, '\\\\').replace(/\./g, '\\.');
	if (new RegExp(`<ProjectReference\\s+Include="(?:${i}|${t.replace(/[.\\/]/g, (d) => '\\' + d)})"`, 'i').test(e)) return e;
	let a = (r?.kind ? isAspNetKind(r.kind) : !1)
			? `    <ProjectReference Include="${n}">
      <ServiceLaunchUrl>http://localhost:{ServicePort}/</ServiceLaunchUrl>
    </ProjectReference>`
			: `    <ProjectReference Include="${n}" />`,
		c = /<ItemGroup[^>]*>([\s\S]*?)<\/ItemGroup>/g,
		l,
		u = null;
	for (; (l = c.exec(e)) !== null;)
		if (/<ProjectReference\b/.test(l[1])) {
			u = {
				start: l.index,
				end: l.index + l[0].length,
			};
			break;
		}
	if (u) {
		let f = e.slice(u.start, u.end).replace(
			/(\s*<\/ItemGroup>)/,
			`
${a}$1`,
		);
		return e.slice(0, u.start) + f + e.slice(u.end);
	}
	let p = `  <ItemGroup>
${a}
  </ItemGroup>
`;
	return /<Import\b[^>]*\/>/.test(e)
		? e.replace(
				/(\s*<Import\b[^>]*\/>)/,
				`
${p}$1`,
			)
		: e.replace(
				/(\s*<\/Project>)/,
				`
${p}$1`,
			);
}

export {
	buildActorCs,
	buildActorInterfaceCs,
	buildActorInterfacesCsproj,
	buildAspNetAppsettingsDevelopmentJson,
	buildAspNetAppsettingsJson,
	buildAspNetValuesControllerCs,
	buildCsharpCsproj,
	buildCsharpProgramCs,
	buildCsharpServiceCs,
	buildLaunchSettingsJson,
	buildServiceManifestXml,
	buildSettingsXml,
	classifyEnvironment,
	isAspNetKind,
	isCsharpKind,
	isStatefulKind,
	patchApplicationManifest,
	patchApplicationManifestImports,
	patchApplicationParametersXml,
	patchSfprojForProjectReference,
	patchStartupServiceParametersXml,
	patchStartupServicesXml,
	resolveCsharpSettings,
};
