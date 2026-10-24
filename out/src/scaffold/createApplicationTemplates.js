"use strict";
/**
 * Pure XML/text templates for the "Create Application" command.
 *
 * Mirrors the file layout that Visual Studio's "Service Fabric Application"
 * project template produces, so an application bootstrapped here can be
 * opened later in VS (or vice-versa) with no friction:
 *
 *   <AppName>/
 *     <AppName>.sfproj
 *     packages.config
 *     StartupServices.xml
 *     ApplicationPackageRoot/
 *       ApplicationManifest.xml
 *       <ServiceName>Pkg/
 *         ServiceManifest.xml
 *         Code/                      (empty)
 *         Config/Settings.xml
 *     ApplicationParameters/{Cloud,Local.1Node,Local.5Node}.xml
 *     PublishProfiles/{Cloud,Local.1Node,Local.5Node}.xml
 *     StartupServiceParameters/{Cloud,Local.1Node,Local.5Node}.xml
 *     Scripts/Deploy-FabricApplication.ps1
 *
 * No `vscode` or `fs` imports — everything here is unit-testable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENVIRONMENT_NAMES = void 0;
exports.buildSfprojXml = buildSfprojXml;
exports.buildPackagesConfigXml = buildPackagesConfigXml;
exports.buildApplicationManifestXml = buildApplicationManifestXml;
exports.buildServiceManifestXml = buildServiceManifestXml;
exports.buildSettingsXml = buildSettingsXml;
exports.buildPublishProfileXml = buildPublishProfileXml;
exports.instanceCountFor = instanceCountFor;
exports.buildApplicationParametersXml = buildApplicationParametersXml;
exports.buildStartupServicesXml = buildStartupServicesXml;
exports.buildStartupServiceParametersXml = buildStartupServiceParametersXml;
exports.buildDeployFabricApplicationScript = buildDeployFabricApplicationScript;
exports.newProjectGuid = newProjectGuid;
const deployFabricApplicationScript_js_1 = require("./deployFabricApplicationScript.js");
const addServiceTemplates_js_1 = require("./addServiceTemplates.js");
exports.ENVIRONMENT_NAMES = [
    'Cloud',
    'Local.1Node',
    'Local.5Node'
];
function resolve(t) {
    const serviceTypeName = t.serviceTypeName ?? `${t.serviceName}Type`;
    const kind = t.kind ?? 'stateless';
    const runtime = t.runtime ?? 'netcore';
    return {
        ...t,
        serviceTypeName,
        serviceVersion: t.serviceVersion ?? '1.0.0',
        applicationVersion: t.applicationVersion ?? '1.0.0',
        instanceCountParameter: parameterNameForKind(kind, t.serviceName),
        kind,
        runtime
    };
}
/**
 * Stateless services use `<ServiceName>_InstanceCount`; stateful and actor
 * services use `<ServiceName>_TargetReplicaSetSize` (and pair it with a
 * `_MinReplicaSetSize` parameter). The picked name lines up with the
 * conventions baked into `addServiceTemplates.defaultParametersFor` so that
 * later edits via Add Service interleave cleanly.
 */
function parameterNameForKind(kind, serviceName) {
    return (0, addServiceTemplates_js_1.isStatefulKind)(kind) ? `${serviceName}_TargetReplicaSetSize` : `${serviceName}_InstanceCount`;
}
// ---------------------------------------------------------------------------
// .sfproj
// ---------------------------------------------------------------------------
/**
 * Visual Studio-style `.sfproj`. Imports the
 * `Microsoft.VisualStudio.Azure.Fabric.MSBuild` NuGet package targets and
 * carries a `<Target Name="ValidateMSBuildFiles">` early-failure block that
 * mirrors the VS canonical template — building without first running `nuget
 * restore` produces a clear actionable error rather than an obscure missing-
 * targets failure.
 *
 * Pinned to MSBuild package version 1.7.9 to match the current Application1
 * VS template.
 */
function buildSfprojXml(t) {
    const guid = t.projectGuid.toUpperCase();
    return `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="14.0" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <Import Project="..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.props" Condition="Exists('..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.props')" />
  <PropertyGroup Label="Globals">
    <ProjectGuid>{${guid}}</ProjectGuid>
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
// ---------------------------------------------------------------------------
// packages.config
// ---------------------------------------------------------------------------
function buildPackagesConfigXml() {
    return `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Microsoft.VisualStudio.Azure.Fabric.MSBuild" version="1.7.9" targetFramework="net472" />
</packages>
`;
}
// ---------------------------------------------------------------------------
// ApplicationManifest.xml
// ---------------------------------------------------------------------------
function buildApplicationManifestXml(t) {
    const r = resolve(t);
    // Per the VS canonical (Application1) shape, <Parameters> in the
    // ApplicationManifest carries ONLY ASP.NET env overrides — instance and
    // replica counts live in StartupServices.xml. Plain stateless/stateful
    // applications produce an empty `<Parameters>` block.
    const parametersInner = (0, addServiceTemplates_js_1.isAspNetKind)(r.kind)
        ? `\n    <Parameter Name="${r.serviceName}_ASPNETCORE_ENVIRONMENT" DefaultValue="" />\n  `
        : '';
    // Per-kind <ServiceManifestImport> body:
    //   actor   -> bare <ServiceManifestRef>
    //   plain   -> <ConfigOverrides />
    //   ASP.NET -> <ConfigOverrides /> + <EnvironmentOverrides>
    let importBody;
    if (r.kind === 'actor') {
        importBody = '';
    }
    else if ((0, addServiceTemplates_js_1.isAspNetKind)(r.kind)) {
        importBody =
            `\n    <ConfigOverrides />\n` +
                `    <EnvironmentOverrides CodePackageRef="code">\n` +
                `      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value="[${r.serviceName}_ASPNETCORE_ENVIRONMENT]" />\n` +
                `    </EnvironmentOverrides>\n  `;
    }
    else {
        importBody = `\n    <ConfigOverrides />\n  `;
    }
    return `<?xml version="1.0" encoding="utf-8"?>
<ApplicationManifest xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                     ApplicationTypeName="${r.applicationName}Type"
                     ApplicationTypeVersion="${r.applicationVersion}"
                     xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters>${parametersInner}</Parameters>
  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="${r.serviceName}Pkg" ServiceManifestVersion="${r.serviceVersion}" />${importBody}</ServiceManifestImport>
</ApplicationManifest>
`;
}
/**
 * Renders the `<Service>` block for the seeded service inside
 * `<DefaultServices>` (legacy projects) and `<Services>` (StartupServices.xml).
 * Indentation is 4 spaces; callers wrap the output in their own tags.
 */
function buildSeededDefaultServiceBlock(r) {
    if ((0, addServiceTemplates_js_1.isStatefulKind)(r.kind)) {
        return `    <Service Name="${r.serviceName}" ServicePackageActivationMode="ExclusiveProcess">
      <StatefulService ServiceTypeName="${r.serviceTypeName}" TargetReplicaSetSize="[${r.serviceName}_TargetReplicaSetSize]" MinReplicaSetSize="[${r.serviceName}_MinReplicaSetSize]">
        <UniformInt64Partition PartitionCount="[${r.serviceName}_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />
      </StatefulService>
    </Service>`;
    }
    return `    <Service Name="${r.serviceName}" ServicePackageActivationMode="ExclusiveProcess">
      <StatelessService ServiceTypeName="${r.serviceTypeName}" InstanceCount="[${r.instanceCountParameter}]">
        <SingletonPartition />
      </StatelessService>
    </Service>`;
}
// ---------------------------------------------------------------------------
// ServiceManifest.xml + Settings.xml
// ---------------------------------------------------------------------------
function buildServiceManifestXml(t) {
    const r = resolve(t);
    // Actors emit an empty stub manifest; the real content is generated at
    // build time by the Service Fabric Actors targets.
    if (r.kind === 'actor') {
        return `<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${r.serviceName}Pkg"
                 Version="${r.serviceVersion}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <!-- The content will be generated during build -->
</ServiceManifest>
`;
    }
    const serviceTypesBlock = (0, addServiceTemplates_js_1.isStatefulKind)(r.kind)
        ? `    <StatefulServiceType ServiceTypeName="${r.serviceTypeName}" HasPersistedState="true" />`
        : `    <StatelessServiceType ServiceTypeName="${r.serviceTypeName}" />`;
    // ASP.NET env block: surface ASPNETCORE_ENVIRONMENT so per-environment
    // ApplicationParameters can drive it.
    const aspNetEnvBlock = (0, addServiceTemplates_js_1.isAspNetKind)(r.kind)
        ? `\n    <EnvironmentVariables>\n      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value=""/>\n    </EnvironmentVariables>`
        : '';
    const aspNetWorkingFolder = (0, addServiceTemplates_js_1.isAspNetKind)(r.kind)
        ? `\n        <WorkingFolder>CodePackage</WorkingFolder>`
        : '';
    // Resources block:
    //   stateful ASP.NET — no Resources block (Kestrel binds at runtime).
    //   stateless ASP.NET — http endpoint with explicit Port=8559.
    //   stateful — ServiceEndpoint + ReplicatorEndpoint.
    //   stateless — ServiceEndpoint only.
    let resourcesBlock;
    if (r.kind === 'aspNetStateful') {
        resourcesBlock = '';
    }
    else if (r.kind === 'aspNetStateless') {
        resourcesBlock =
            `\n  <Resources>\n` +
                `    <Endpoints>\n` +
                `      <Endpoint Protocol="http" Name="ServiceEndpoint" Type="Input" Port="8559" />\n` +
                `    </Endpoints>\n` +
                `  </Resources>`;
    }
    else if (r.kind === 'stateful') {
        resourcesBlock =
            `\n  <Resources>\n` +
                `    <Endpoints>\n` +
                `      <Endpoint Name="ServiceEndpoint" />\n` +
                `      <Endpoint Name="ReplicatorEndpoint" />\n` +
                `    </Endpoints>\n` +
                `  </Resources>`;
    }
    else {
        resourcesBlock =
            `\n  <Resources>\n` +
                `    <Endpoints>\n` +
                `      <Endpoint Name="ServiceEndpoint" />\n` +
                `    </Endpoints>\n` +
                `  </Resources>`;
    }
    return `<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${r.serviceName}Pkg"
                 Version="${r.serviceVersion}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ServiceTypes>
${serviceTypesBlock}
  </ServiceTypes>
  <CodePackage Name="Code" Version="${r.serviceVersion}">
    <EntryPoint>
      <ExeHost>
        <Program>${r.serviceName}.exe</Program>${aspNetWorkingFolder}
      </ExeHost>
    </EntryPoint>${aspNetEnvBlock}
  </CodePackage>
  <ConfigPackage Name="Config" Version="${r.serviceVersion}" />${resourcesBlock}
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
// ---------------------------------------------------------------------------
// PublishProfiles/{env}.xml
// ---------------------------------------------------------------------------
function buildPublishProfileXml(env) {
    if (env === 'Cloud') {
        return `<?xml version="1.0" encoding="utf-8"?>
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
`;
    }
    return `<?xml version="1.0" encoding="utf-8"?>
<PublishProfile xmlns="http://schemas.microsoft.com/2015/05/fabrictools">
  <ClusterConnectionParameters />
  <ApplicationParameterFile Path="..\\ApplicationParameters\\${env}.xml" />
  <StartupServiceParameterFile Path="..\\StartupServiceParameters\\${env}.xml" />
</PublishProfile>
`;
}
// ---------------------------------------------------------------------------
// ApplicationParameters/{env}.xml
// ---------------------------------------------------------------------------
/**
 * Per-environment instance counts that match the VS canonical
 * (Application1) `StartupServiceParameters/*.xml` values:
 *  - Local.1Node → 1
 *  - Local.5Node → 3
 *  - Cloud       → -1 (stateless: scale-to-node), 3 (stateful)
 *
 * For stateful kinds, every environment uses the same fixed value of 3 to
 * mirror the VS template (which seeds `_TargetReplicaSetSize=3` everywhere
 * except 1-node clusters, which scale to 1).
 */
function instanceCountFor(env, kind = 'stateless') {
    if ((0, addServiceTemplates_js_1.isStatefulKind)(kind)) {
        return env === 'Local.1Node' ? '1' : '3';
    }
    if (env === 'Local.1Node')
        return '1';
    if (env === 'Local.5Node')
        return '3';
    return '-1';
}
function buildApplicationParametersXml(t, env) {
    const r = resolve(t);
    // Per the VS canonical (Application1) shape, ApplicationParameters/*.xml
    // carries ONLY ASP.NET env overrides; instance/replica counts live in
    // StartupServiceParameters/*.xml. Cloud.xml stays empty for ASP.NET so
    // the operator sets the env per cluster; Local.* defaults to Development.
    const params = (0, addServiceTemplates_js_1.isAspNetKind)(r.kind)
        ? `    <Parameter Name="${r.serviceName}_ASPNETCORE_ENVIRONMENT" Value="${env === 'Cloud' ? '' : 'Development'}" />`
        : '';
    const inner = params ? `\n${params}\n  ` : '';
    return `<?xml version="1.0" encoding="utf-8"?>
<Application Name="fabric:/${r.applicationName}"
             xmlns="http://schemas.microsoft.com/2011/01/fabric"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Parameters>${inner}</Parameters>
</Application>
`;
}
// ---------------------------------------------------------------------------
// StartupServices.xml + StartupServiceParameters/{env}.xml
// ---------------------------------------------------------------------------
function buildStartupServicesXml(t) {
    const r = resolve(t);
    // Actors are registered with ActorRuntime at process start and do not
    // appear in StartupServices.xml. Emit an empty manifest skeleton so the
    // file exists for the workspace contract; subsequent Add Service calls
    // for non-actor kinds populate the body.
    if (r.kind === 'actor') {
        return `<?xml version="1.0" encoding="utf-8"?>
<StartupServicesManifest xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                         xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters />
  <Services />
</StartupServicesManifest>
`;
    }
    const stateful = (0, addServiceTemplates_js_1.isStatefulKind)(r.kind);
    const parametersBlock = stateful
        ? `    <Parameter Name="${r.serviceName}_TargetReplicaSetSize" DefaultValue="3" />
    <Parameter Name="${r.serviceName}_MinReplicaSetSize" DefaultValue="3" />
    <Parameter Name="${r.serviceName}_PartitionCount" DefaultValue="1" />`
        : `    <Parameter Name="${r.instanceCountParameter}" DefaultValue="-1" />`;
    return `<?xml version="1.0" encoding="utf-8"?>
<StartupServicesManifest xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                         xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters>
${parametersBlock}
  </Parameters>
  <Services>
${buildSeededDefaultServiceBlock(r)}
  </Services>
</StartupServicesManifest>
`;
}
function buildStartupServiceParametersXml(t, env) {
    const r = resolve(t);
    // Actors don't carry instance/replica params.
    if (r.kind === 'actor') {
        return `<?xml version="1.0" encoding="utf-8"?>
<StartupServices xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Parameters />
</StartupServices>
`;
    }
    const params = (0, addServiceTemplates_js_1.isStatefulKind)(r.kind)
        ? `    <Parameter Name="${r.serviceName}_TargetReplicaSetSize" Value="${instanceCountFor(env, r.kind)}" />
    <Parameter Name="${r.serviceName}_MinReplicaSetSize" Value="${instanceCountFor(env, r.kind)}" />
    <Parameter Name="${r.serviceName}_PartitionCount" Value="1" />`
        : `    <Parameter Name="${r.instanceCountParameter}" Value="${instanceCountFor(env, r.kind)}" />`;
    return `<?xml version="1.0" encoding="utf-8"?>
<StartupServices xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Parameters>
${params}
  </Parameters>
</StartupServices>
`;
}
// ---------------------------------------------------------------------------
// Scripts/Deploy-FabricApplication.ps1
// ---------------------------------------------------------------------------
function buildDeployFabricApplicationScript() {
    return deployFabricApplicationScript_js_1.DEPLOY_FABRIC_APPLICATION_PS1;
}
// ---------------------------------------------------------------------------
// GUID generator
// ---------------------------------------------------------------------------
/**
 * Generates a v4 GUID using `crypto.randomUUID` when available, falling back
 * to `Math.random` only when running under a host that lacks WebCrypto. The
 * return value is upper-case and *does not* include surrounding braces.
 */
function newProjectGuid() {
    const cryptoAny = globalThis.crypto;
    if (cryptoAny && typeof cryptoAny.randomUUID === 'function') {
        return cryptoAny.randomUUID().toUpperCase();
    }
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return (hex.slice(0, 8) + '-' +
        hex.slice(8, 12) + '-' +
        hex.slice(12, 16) + '-' +
        hex.slice(16, 20) + '-' +
        hex.slice(20)).toUpperCase();
}
//# sourceMappingURL=createApplicationTemplates.js.map