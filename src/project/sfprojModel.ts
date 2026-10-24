/**
 * Strongly-typed model of a parsed Service Fabric application project.
 * Pure data: no VS Code or fs dependencies.
 */
import type { RawPropertyGroup } from './msbuildPropertyExpander';

export type { RawPropertyGroup };

/** A parsed `.sfproj` file. */
export interface SfProjFile {
	/** Absolute path of the .sfproj. */
	path: string;
	/** Directory containing the .sfproj. */
	directory: string;
	projectGuid?: string;
	projectVersion?: string;
	/** `<ApplicationPackageRootFolder>`, defaulting to `ApplicationPackageRoot`. */
	applicationPackageRootFolder: string;
	/** `$(OutputPath)` expanded against the Debug-configuration property map. */
	outputPath?: string;
	/** `$(PackageLocation)` expanded against the Debug-configuration property map. */
	packageLocation?: string;
	/** Absolute paths of `<ProjectReference Include>` targets. */
	projectReferences: string[];
	/** Every `<PropertyGroup>` with its Condition, for re-evaluation with another Configuration. */
	propertyGroups: RawPropertyGroup[];
	/** Effective property map (Configuration=Debug). */
	properties: Map<string, string>;
	/** MSBuild intrinsic properties (MSBuildProjectName, MSBuildProjectDirectory, ...). */
	intrinsics: Map<string, string>;
	/** `$(Name)` tokens still unresolved in outputPath/packageLocation, if any. */
	unresolvedProperties?: string[];
}

/** A `<Parameter>` declared in ApplicationManifest `<Parameters>`. */
export interface ApplicationParameter {
	name: string;
	defaultValue?: string;
}

/** A `<ServiceManifestImport><ServiceManifestRef>` entry in ApplicationManifest.xml. */
export interface ServiceManifestRef {
	name: string;
	version: string;
}

export interface ApplicationManifest {
	path: string;
	applicationTypeName: string;
	applicationTypeVersion: string;
	parameters: ApplicationParameter[];
	serviceManifestRefs: ServiceManifestRef[];
}

/** A `<Resources><Endpoints><Endpoint>` entry in ServiceManifest.xml. */
export interface ServiceEndpoint {
	name: string;
	protocol?: string;
	type?: string;
	port?: string;
}

export interface ServiceManifest {
	path: string;
	/** Directory containing ServiceManifest.xml (the service package folder). */
	packageDirectory: string;
	name: string;
	version: string;
	endpoints: ServiceEndpoint[];
	codePackages: string[];
	configPackages: string[];
	dataPackages: string[];
}

/** A .sfproj plus all the manifests and support files around it. */
export interface ApplicationProject {
	sfproj: SfProjFile;
	applicationManifest?: ApplicationManifest;
	serviceManifests: ServiceManifest[];
	publishProfiles: string[];
	applicationParameters: string[];
	startupServiceParameters: string[];
	startupServicesManifest?: string;
	scripts: string[];
}
