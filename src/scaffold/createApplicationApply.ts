// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import {
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
	isAspNetKind,
	isCsharpKind,
	patchSfprojForProjectReference,
	resolveCsharpSettings,
} from './addServiceTemplates';
import {
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
} from './createApplicationTemplates';

function applyCreateApplication(e) {
	if (fs.existsSync(e.targetDirectory)) throw new Error(`Folder already exists: ${e.targetDirectory}`);
	if (!e.applicationName || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(e.applicationName))
		throw new Error(`Invalid application name: '${e.applicationName}'.`);
	if (!e.serviceName || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(e.serviceName)) throw new Error(`Invalid service name: '${e.serviceName}'.`);
	if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(e.projectGuid))
		throw new Error(`Invalid project GUID: '${e.projectGuid}'.`);
	let t = e.targetDirectory,
		r = path.join(t, 'ApplicationPackageRoot'),
		n = path.join(t, 'ApplicationParameters'),
		i = path.join(t, 'PublishProfiles'),
		o = path.join(t, 'StartupServiceParameters'),
		s = path.join(t, 'Scripts'),
		a = e.kind ?? 'stateless',
		c = isCsharpKind(a),
		l = path.dirname(t),
		u = {
			serviceName: e.serviceName,
			serviceTypeName: e.serviceTypeName ?? `${e.serviceName}Type`,
			kind: a,
			runtime: e.runtime ?? 'netcore',
			version: e.serviceVersion ?? '1.0.0',
			targetFramework: e.targetFramework,
		},
		p = c ? resolveCsharpSettings(u) : void 0,
		d = c && p ? path.join(l, p.csprojDirName) : void 0,
		f = c && d ? path.join(d, 'PackageRoot') : path.join(r, `${e.serviceName}Pkg`);
	if (c && d && fs.existsSync(d)) throw new Error(`Cannot scaffold C# project: directory already exists: ${d}`);
	(fs.mkdirSync(r, {
		recursive: !0,
	}),
		c
			? fs.mkdirSync(path.join(f, 'Config'), {
					recursive: !0,
				})
			: (fs.mkdirSync(path.join(f, 'Code'), {
					recursive: !0,
				}),
				fs.mkdirSync(path.join(f, 'Config'), {
					recursive: !0,
				})),
		fs.mkdirSync(n, {
			recursive: !0,
		}),
		fs.mkdirSync(i, {
			recursive: !0,
		}),
		fs.mkdirSync(o, {
			recursive: !0,
		}),
		fs.mkdirSync(s, {
			recursive: !0,
		}));
	let m = path.join(t, `${e.applicationName}.sfproj`);
	fs.writeFileSync(m, buildSfprojXml(e), 'utf8');
	let v = path.join(t, 'packages.config');
	fs.writeFileSync(v, buildPackagesConfigXml(), 'utf8');
	let h = path.join(r, 'ApplicationManifest.xml');
	fs.writeFileSync(h, buildApplicationManifestXml(e), 'utf8');
	let P = path.join(f, 'ServiceManifest.xml');
	fs.writeFileSync(P, buildServiceManifestXml(e), 'utf8');
	let g = path.join(f, 'Config', 'Settings.xml');
	fs.writeFileSync(g, buildSettingsXml(), 'utf8');
	let w = [],
		b = [],
		S = [];
	for (let Z of ENVIRONMENT_NAMES)
		(w.push(writeEnvFile(i, Z, buildPublishProfileXml(Z))),
			b.push(writeEnvFile(n, Z, buildApplicationParametersXml(e, Z))),
			S.push(writeEnvFile(o, Z, buildStartupServiceParametersXml(e, Z))));
	let z = path.join(t, 'StartupServices.xml');
	fs.writeFileSync(z, buildStartupServicesXml(e), 'utf8');
	let O = path.join(s, 'Deploy-FabricApplication.ps1');
	fs.writeFileSync(O, buildDeployFabricApplicationScript(), 'utf8');
	let j, le, se;
	if (c && d && p) {
		let Z = scaffoldSeededCsharpProject(u, p, d, m);
		((j = Z.csprojPath), (le = Z.launchSettingsPath), (se = Z.appsettingsDevelopmentPath));
	}
	return {
		sfprojPath: m,
		applicationManifestPath: h,
		serviceManifestPath: P,
		settingsXmlPath: g,
		publishProfilePaths: w,
		applicationParameterPaths: b,
		startupServiceParameterPaths: S,
		startupServicesPath: z,
		deployScriptPath: O,
		packagesConfigPath: v,
		csprojPath: j,
		launchSettingsPath: le,
		appsettingsDevelopmentPath: se,
	};
}

function scaffoldSeededCsharpProject(e, t, r, n) {
	fs.mkdirSync(r, {
		recursive: !0,
	});
	let i = path.join(r, `${t.csprojDirName}.csproj`);
	if (
		(fs.writeFileSync(i, buildCsharpCsproj(e, void 0, t), 'utf8'),
		fs.writeFileSync(path.join(r, 'Program.cs'), buildCsharpProgramCs(e, t), 'utf8'),
		e.kind === 'actor')
	) {
		let f = `${r}.Interfaces`;
		(fs.mkdirSync(f, {
			recursive: !0,
		}),
			fs.writeFileSync(path.join(f, `${t.csprojDirName}.Interfaces.csproj`), buildActorInterfacesCsproj(e, t), 'utf8'),
			fs.writeFileSync(path.join(f, `${t.actorInterfaceName}.cs`), buildActorInterfaceCs(e, t), 'utf8'),
			fs.writeFileSync(path.join(r, `${t.actorTypeName}.cs`), buildActorCs(e, t), 'utf8'));
	} else fs.writeFileSync(path.join(r, `${t.className}.cs`), buildCsharpServiceCs(e, t), 'utf8');
	let o;
	if (isAspNetKind(e.kind)) {
		let f = path.join(r, 'Controllers');
		(fs.mkdirSync(f, {
			recursive: !0,
		}),
			fs.writeFileSync(path.join(f, 'ValuesController.cs'), buildAspNetValuesControllerCs(e, t), 'utf8'),
			fs.writeFileSync(path.join(r, 'appsettings.json'), buildAspNetAppsettingsJson(), 'utf8'),
			(o = path.join(r, 'appsettings.Development.json')),
			fs.writeFileSync(o, buildAspNetAppsettingsDevelopmentJson(), 'utf8'));
	}
	let s = path.join(r, 'Properties');
	fs.mkdirSync(s, {
		recursive: !0,
	});
	let a = path.join(s, 'launchSettings.json'),
		c = e.endpointPort ?? (isAspNetKind(e.kind) ? 8559 : void 0);
	fs.writeFileSync(a, c !== void 0 ? buildLaunchSettingsJson(e, c) : buildLaunchSettingsJson(e), 'utf8');
	let l = path.dirname(n),
		u = toMsbuildRelativePath(l, i),
		p = fs.readFileSync(n, 'utf8'),
		d = patchSfprojForProjectReference(p, u, {
			kind: e.kind,
		});
	return (
		d !== p && fs.writeFileSync(n, d, 'utf8'),
		{
			csprojPath: i,
			launchSettingsPath: a,
			appsettingsDevelopmentPath: o,
		}
	);
}

function toMsbuildRelativePath(e, t) {
	return path.relative(e, t).split('/').join('\\');
}

function writeEnvFile(e, t, r) {
	let n = path.join(e, `${t}.xml`);
	return (fs.writeFileSync(n, r, 'utf8'), n);
}

export { applyCreateApplication };
