// @ts-nocheck
import { isAspNetKind, isStatefulKind } from './addServiceTemplates';
import { DEPLOY_FABRIC_APPLICATION_PS1 } from './deployFabricApplicationScript';

var ENVIRONMENT_NAMES = ['Cloud', 'Local.1Node', 'Local.5Node'];

function resolve(e) {
	let t = e.serviceTypeName ?? `${e.serviceName}Type`,
		r = e.kind ?? 'stateless',
		n = e.runtime ?? 'netcore';
	return {
		...e,
		serviceTypeName: t,
		serviceVersion: e.serviceVersion ?? '1.0.0',
		applicationVersion: e.applicationVersion ?? '1.0.0',
		instanceCountParameter: parameterNameForKind(r, e.serviceName),
		kind: r,
		runtime: n,
	};
}

function parameterNameForKind(e, t) {
	return isStatefulKind(e) ? `${t}_TargetReplicaSetSize` : `${t}_InstanceCount`;
}

function buildSfprojXml(e) {
	return `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="14.0" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <Import Project="..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.props" Condition="Exists('..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.props')" />
  <PropertyGroup Label="Globals">
    <ProjectGuid>{${e.projectGuid.toUpperCase()}}</ProjectGuid>
    <ProjectVersion>2.6</ProjectVersion>
    <MinToolsVersion>16.10</MinToolsVersion>
    <SupportedMSBuildNuGetPackageVersion>1.7.9</SupportedMSBuildNuGetPackageVersion>
  </PropertyGroup>
  <PropertyGroup>
    <Configuration Condition=" '$(Configuration)' == '' ">Debug</Configuration>
    <Platform Condition=" '$(Platform)' == '' ">x64</Platform>
    <ApplicationPackageRootFolder>ApplicationPackageRoot</ApplicationPackageRootFolder>
    <TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion>
    <OutputPath>bin\\$(Configuration)</OutputPath>
    <PackageLocation>pkg\\$(Configuration)\\$(MSBuildProjectName)</PackageLocation>
  </PropertyGroup>
  <ItemGroup Label="ProjectConfigurations">
    <ProjectConfiguration Include="Debug|x64">
      <Configuration>Debug</Configuration>
      <Platform>x64</Platform>
    </ProjectConfiguration>
    <ProjectConfiguration Include="Release|x64">
      <Configuration>Release</Configuration>
      <Platform>x64</Platform>
    </ProjectConfiguration>
  </ItemGroup>
  <ItemGroup>
    <None Include="ApplicationPackageRoot\\ApplicationManifest.xml" />
    <None Include="ApplicationParameters\\Cloud.xml" />
    <None Include="ApplicationParameters\\Local.1Node.xml" />
    <None Include="ApplicationParameters\\Local.5Node.xml" />
    <None Include="PublishProfiles\\Cloud.xml" />
    <None Include="PublishProfiles\\Local.1Node.xml" />
    <None Include="PublishProfiles\\Local.5Node.xml" />
    <None Include="Scripts\\Deploy-FabricApplication.ps1" />
    <None Include="StartupServiceParameters\\Cloud.xml" />
    <None Include="StartupServiceParameters\\Local.1Node.xml" />
    <None Include="StartupServiceParameters\\Local.5Node.xml" />
    <None Include="StartupServices.xml" />
  </ItemGroup>
  <ItemGroup>
    <Content Include="packages.config" />
  </ItemGroup>
  <Import Project="$(MSBuildToolsPath)\\Microsoft.Common.targets" />
  <Target Name="ValidateMSBuildFiles" BeforeTargets="PrepareForBuild">
    <Error Condition="!Exists('..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.props')" Text="Microsoft.VisualStudio.Azure.Fabric.MSBuild not restored. Run 'Service Fabric: Restore NuGet Packages' from the Command Palette, or 'nuget restore &lt;App&gt;.sfproj -PackagesDirectory packages' from a terminal." />
    <Error Condition="!Exists('..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.targets')" Text="Microsoft.VisualStudio.Azure.Fabric.MSBuild not restored. Run 'Service Fabric: Restore NuGet Packages' from the Command Palette, or 'nuget restore &lt;App&gt;.sfproj -PackagesDirectory packages' from a terminal." />
  </Target>
  <PropertyGroup>
    <ApplicationProjectTargetsPath>$(MSBuildExtensionsPath32)\\Microsoft\\VisualStudio\\v$(VisualStudioVersion)\\Service Fabric Tools\\Microsoft.VisualStudio.Azure.Fabric.ApplicationProject.targets</ApplicationProjectTargetsPath>
  </PropertyGroup>
  <Import Project="$(ApplicationProjectTargetsPath)" Condition="Exists('$(ApplicationProjectTargetsPath)')" />
  <Import Project="..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.targets" Condition="Exists('..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.targets')" />
</Project>
`;
}

function buildPackagesConfigXml() {
	return `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Microsoft.VisualStudio.Azure.Fabric.MSBuild" version="1.7.9" targetFramework="net472" />
</packages>
`;
}

function buildApplicationManifestXml(e) {
	let t = resolve(e),
		r = isAspNetKind(t.kind)
			? `
    <Parameter Name="${t.serviceName}_ASPNETCORE_ENVIRONMENT" DefaultValue="" />
  `
			: '',
		n;
	return (
		t.kind === 'actor'
			? (n = '')
			: isAspNetKind(t.kind)
				? (n = `
    <ConfigOverrides />
    <EnvironmentOverrides CodePackageRef="code">
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value="[${t.serviceName}_ASPNETCORE_ENVIRONMENT]" />
    </EnvironmentOverrides>
  `)
				: (n = `
    <ConfigOverrides />
  `),
		`<?xml version="1.0" encoding="utf-8"?>
<ApplicationManifest xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                     ApplicationTypeName="${t.applicationName}Type"
                     ApplicationTypeVersion="${t.applicationVersion}"
                     xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters>${r}</Parameters>
  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="${t.serviceName}Pkg" ServiceManifestVersion="${t.serviceVersion}" />${n}</ServiceManifestImport>
</ApplicationManifest>
`
	);
}

function buildSeededDefaultServiceBlock(e) {
	return isStatefulKind(e.kind)
		? `    <Service Name="${e.serviceName}" ServicePackageActivationMode="ExclusiveProcess">
      <StatefulService ServiceTypeName="${e.serviceTypeName}" TargetReplicaSetSize="[${e.serviceName}_TargetReplicaSetSize]" MinReplicaSetSize="[${e.serviceName}_MinReplicaSetSize]">
        <UniformInt64Partition PartitionCount="[${e.serviceName}_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />
      </StatefulService>
    </Service>`
		: `    <Service Name="${e.serviceName}" ServicePackageActivationMode="ExclusiveProcess">
      <StatelessService ServiceTypeName="${e.serviceTypeName}" InstanceCount="[${e.instanceCountParameter}]">
        <SingletonPartition />
      </StatelessService>
    </Service>`;
}

function buildServiceManifestXml(e) {
	let t = resolve(e);
	if (t.kind === 'actor')
		return `<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${t.serviceName}Pkg"
                 Version="${t.serviceVersion}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <!-- The content will be generated during build -->
</ServiceManifest>
`;
	let r = isStatefulKind(t.kind)
			? `    <StatefulServiceType ServiceTypeName="${t.serviceTypeName}" HasPersistedState="true" />`
			: `    <StatelessServiceType ServiceTypeName="${t.serviceTypeName}" />`,
		n = isAspNetKind(t.kind)
			? `
    <EnvironmentVariables>
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value=""/>
    </EnvironmentVariables>`
			: '',
		i = isAspNetKind(t.kind)
			? `
        <WorkingFolder>CodePackage</WorkingFolder>`
			: '',
		o;
	return (
		t.kind === 'aspNetStateful'
			? (o = '')
			: t.kind === 'aspNetStateless'
				? (o = `
  <Resources>
    <Endpoints>
      <Endpoint Protocol="http" Name="ServiceEndpoint" Type="Input" Port="8559" />
    </Endpoints>
  </Resources>`)
				: t.kind === 'stateful'
					? (o = `
  <Resources>
    <Endpoints>
      <Endpoint Name="ServiceEndpoint" />
      <Endpoint Name="ReplicatorEndpoint" />
    </Endpoints>
  </Resources>`)
					: (o = `
  <Resources>
    <Endpoints>
      <Endpoint Name="ServiceEndpoint" />
    </Endpoints>
  </Resources>`),
		`<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${t.serviceName}Pkg"
                 Version="${t.serviceVersion}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ServiceTypes>
${r}
  </ServiceTypes>
  <CodePackage Name="Code" Version="${t.serviceVersion}">
    <EntryPoint>
      <ExeHost>
        <Program>${t.serviceName}.exe</Program>${i}
      </ExeHost>
    </EntryPoint>${n}
  </CodePackage>
  <ConfigPackage Name="Config" Version="${t.serviceVersion}" />${o}
</ServiceManifest>
`
	);
}

function buildSettingsXml() {
	return `<?xml version="1.0" encoding="utf-8"?>
<Settings xmlns="http://schemas.microsoft.com/2011/01/fabric"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
</Settings>
`;
}

function buildPublishProfileXml(e) {
	return e === 'Cloud'
		? `<?xml version="1.0" encoding="utf-8"?>
<PublishProfile xmlns="http://schemas.microsoft.com/2015/05/fabrictools">
  <!--
    Replace the connection endpoint and certificate fields below with the values
    for your remote cluster. See https://aka.ms/sfpublishprofile for the full
    reference.
  -->
  <ClusterConnectionParameters ConnectionEndpoint=""
                               X509Credential="true"
                               ServerCertThumbprint=""
                               FindType="FindByThumbprint"
                               FindValue=""
                               StoreLocation="CurrentUser"
                               StoreName="My" />
  <ApplicationParameterFile Path="..\\ApplicationParameters\\Cloud.xml" />
  <StartupServiceParameterFile Path="..\\StartupServiceParameters\\Cloud.xml" />
  <UpgradeDeployment Mode="UnmonitoredAuto" Enabled="false">
    <Parameters UpgradeReplicaSetCheckTimeoutSec="1" Force="true" />
  </UpgradeDeployment>
</PublishProfile>
`
		: `<?xml version="1.0" encoding="utf-8"?>
<PublishProfile xmlns="http://schemas.microsoft.com/2015/05/fabrictools">
  <ClusterConnectionParameters />
  <ApplicationParameterFile Path="..\\ApplicationParameters\\${e}.xml" />
  <StartupServiceParameterFile Path="..\\StartupServiceParameters\\${e}.xml" />
</PublishProfile>
`;
}

function instanceCountFor(e, t = 'stateless') {
	return isStatefulKind(t) ? (e === 'Local.1Node' ? '1' : '3') : e === 'Local.1Node' ? '1' : e === 'Local.5Node' ? '3' : '-1';
}

function buildApplicationParametersXml(e, t) {
	let r = resolve(e),
		n = isAspNetKind(r.kind)
			? `    <Parameter Name="${r.serviceName}_ASPNETCORE_ENVIRONMENT" Value="${t === 'Cloud' ? '' : 'Development'}" />`
			: '',
		i = n
			? `
${n}
  `
			: '';
	return `<?xml version="1.0" encoding="utf-8"?>
<Application Name="fabric:/${r.applicationName}"
             xmlns="http://schemas.microsoft.com/2011/01/fabric"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Parameters>${i}</Parameters>
</Application>
`;
}

function buildStartupServicesXml(e) {
	let t = resolve(e);
	return t.kind === 'actor'
		? `<?xml version="1.0" encoding="utf-8"?>
<StartupServicesManifest xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                         xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters />
  <Services />
</StartupServicesManifest>
`
		: `<?xml version="1.0" encoding="utf-8"?>
<StartupServicesManifest xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                         xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters>
${
	isStatefulKind(t.kind)
		? `    <Parameter Name="${t.serviceName}_TargetReplicaSetSize" DefaultValue="3" />
    <Parameter Name="${t.serviceName}_MinReplicaSetSize" DefaultValue="3" />
    <Parameter Name="${t.serviceName}_PartitionCount" DefaultValue="1" />`
		: `    <Parameter Name="${t.instanceCountParameter}" DefaultValue="-1" />`
}
  </Parameters>
  <Services>
${buildSeededDefaultServiceBlock(t)}
  </Services>
</StartupServicesManifest>
`;
}

function buildStartupServiceParametersXml(e, t) {
	let r = resolve(e);
	return r.kind === 'actor'
		? `<?xml version="1.0" encoding="utf-8"?>
<StartupServices xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Parameters />
</StartupServices>
`
		: `<?xml version="1.0" encoding="utf-8"?>
<StartupServices xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Parameters>
${
	isStatefulKind(r.kind)
		? `    <Parameter Name="${r.serviceName}_TargetReplicaSetSize" Value="${instanceCountFor(t, r.kind)}" />
    <Parameter Name="${r.serviceName}_MinReplicaSetSize" Value="${instanceCountFor(t, r.kind)}" />
    <Parameter Name="${r.serviceName}_PartitionCount" Value="1" />`
		: `    <Parameter Name="${r.instanceCountParameter}" Value="${instanceCountFor(t, r.kind)}" />`
}
  </Parameters>
</StartupServices>
`;
}

function buildDeployFabricApplicationScript() {
	return DEPLOY_FABRIC_APPLICATION_PS1;
}

function newProjectGuid() {
	let e = globalThis.crypto;
	if (e && typeof e.randomUUID == 'function') return e.randomUUID().toUpperCase();
	let t = new Uint8Array(16);
	for (let n = 0; n < t.length; n++) t[n] = Math.floor(Math.random() * 256);
	((t[6] = (t[6] & 15) | 64), (t[8] = (t[8] & 63) | 128));
	let r = Array.from(t, (n) => n.toString(16).padStart(2, '0')).join('');
	return (r.slice(0, 8) + '-' + r.slice(8, 12) + '-' + r.slice(12, 16) + '-' + r.slice(16, 20) + '-' + r.slice(20)).toUpperCase();
}

export {
	ENVIRONMENT_NAMES,
	buildApplicationManifestXml,
	buildApplicationParametersXml,
	buildDeployFabricApplicationScript,
	buildPackagesConfigXml,
	buildPublishProfileXml,
	buildServiceManifestXml,
	buildSettingsXml,
	buildSfprojXml,
	buildStartupServiceParametersXml,
	buildStartupServicesXml,
	newProjectGuid,
};
