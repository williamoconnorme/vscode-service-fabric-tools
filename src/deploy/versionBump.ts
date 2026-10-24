/**
 * Automatic version bumping for upgrades, like Visual Studio's "Automatically
 * update application and service versions". After packaging, each code /
 * config / data package folder is hashed and compared with the hashes recorded
 * at the last successful publish to the same cluster. Only packages whose
 * content changed (and whose version wasn't raised by hand) are bumped, along
 * with their service manifest and the application type version, so an upgrade
 * restarts only the services that changed.
 *
 * Pure apart from file reads (no `vscode` imports).
 */
import { createHash } from 'crypto';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { parseXml, type XmlElement } from '../language/schema/xmlScanner';

export type PackageKind = 'Code' | 'Config' | 'Data';

export interface PackageState {
	kind: PackageKind;
	version: string;
	/** SHA-256 of the package folder's files (relative paths and contents). */
	hash: string;
}

export interface ServiceState {
	version: string;
	/** SHA-256 of ServiceManifest.xml with its version numbers blanked out. */
	manifestHash: string;
	packages: Record<string, PackageState>;
}

/** The versions and content hashes of a built application package. */
export interface ApplicationPackageState {
	applicationTypeName: string;
	applicationTypeVersion: string;
	services: Record<string, ServiceState>;
}

export interface VersionChange {
	from: string;
	to: string;
}

export interface ServiceBump extends VersionChange {
	name: string;
	/** Packages to bump (may be empty when only the manifest changed). */
	packages: (VersionChange & { name: string; kind: PackageKind })[];
}

export interface VersionBumpPlan {
	/** Set when the application type version must change (it equals the deployed one). */
	application?: VersionChange;
	services: ServiceBump[];
	/** True when a baseline for the deployed version was available, so only changed packages are bumped. */
	changedOnly: boolean;
}

const PACKAGE_ELEMENTS: Record<string, PackageKind> = { CodePackage: 'Code', ConfigPackage: 'Config', DataPackage: 'Data' };

/** Raises the last numeric part of a version: `1.0.0` → `1.0.1`, `2.3` → `2.4`, `1.0-beta` → `1.0-beta.1`. */
export function incrementVersion(version: string): string {
	const m = /^(.*?)(\d+)(\D*)$/.exec(version);
	if (!m || m[3]) return `${version}.1`;
	return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}`;
}

const attr = (el: XmlElement, name: string): string | undefined => el.attributes.find((a) => a.name === name)?.value;
const kids = (el: XmlElement | undefined, name: string): XmlElement[] => (el?.children ?? []).filter((c) => c.localName === name);

/** Hash of the files under `dir` (sorted relative paths and contents); `''` when it doesn't exist. */
async function hashFolder(dir: string): Promise<string> {
	const files: string[] = [];
	const walk = async (d: string, rel: string): Promise<void> => {
		let entries;
		try {
			entries = await fsp.readdir(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const childRel = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) await walk(path.join(d, e.name), childRel);
			else if (e.isFile()) files.push(childRel);
		}
	};
	await walk(dir, '');
	if (files.length === 0) return '';
	files.sort();
	const hash = createHash('sha256');
	for (const rel of files) {
		hash.update(`${rel}\0`);
		hash.update(await fsp.readFile(path.join(dir, ...rel.split('/'))));
		hash.update('\0');
	}
	return hash.digest('hex');
}

/** ServiceManifest.xml hash that ignores the version numbers this module rewrites. */
export function manifestContentHash(xml: string): string {
	return createHash('sha256')
		.update(xml.replace(/\bVersion\s*=\s*"[^"]*"/g, 'Version=""').replace(/\s+/g, ' '))
		.digest('hex');
}

/** Reads the versions and content hashes of the package at `packageRoot` (the folder with ApplicationManifest.xml). */
export async function readPackageState(packageRoot: string): Promise<ApplicationPackageState> {
	const appXml = await fsp.readFile(path.join(packageRoot, 'ApplicationManifest.xml'), 'utf8');
	const app = parseXml(appXml).root;
	if (!app || app.localName !== 'ApplicationManifest') throw new Error(`${packageRoot}/ApplicationManifest.xml isn't an application manifest.`);
	const state: ApplicationPackageState = {
		applicationTypeName: attr(app, 'ApplicationTypeName') ?? '',
		applicationTypeVersion: attr(app, 'ApplicationTypeVersion') ?? '',
		services: {},
	};
	for (const imp of kids(app, 'ServiceManifestImport')) {
		const name = kids(imp, 'ServiceManifestRef').map((r) => attr(r, 'ServiceManifestName'))[0];
		if (!name) continue;
		const serviceDir = path.join(packageRoot, name);
		let smXml: string;
		try {
			smXml = await fsp.readFile(path.join(serviceDir, 'ServiceManifest.xml'), 'utf8');
		} catch {
			continue;
		}
		const sm = parseXml(smXml).root;
		if (!sm) continue;
		const service: ServiceState = { version: attr(sm, 'Version') ?? '', manifestHash: manifestContentHash(smXml), packages: {} };
		for (const child of sm.children) {
			const kind = PACKAGE_ELEMENTS[child.localName];
			const pkgName = attr(child, 'Name');
			if (!kind || !pkgName) continue;
			service.packages[pkgName] = { kind, version: attr(child, 'Version') ?? '', hash: await hashFolder(path.join(serviceDir, pkgName)) };
		}
		state.services[name] = service;
	}
	return state;
}

/**
 * Works out which versions an upgrade from `deployedVersion` needs raised.
 * With a baseline recorded for `deployedVersion`, only packages whose content
 * changed and whose version is unchanged are bumped; without one, every
 * service and package is.
 */
export function planVersionBump(
	current: ApplicationPackageState,
	baseline: ApplicationPackageState | undefined,
	deployedVersion: string,
): VersionBumpPlan {
	const useBaseline = baseline !== undefined && baseline.applicationTypeVersion === deployedVersion;
	const services: ServiceBump[] = [];
	for (const [name, svc] of Object.entries(current.services)) {
		const base = useBaseline ? baseline!.services[name] : undefined;
		if (useBaseline && !base) continue; // A new service: any version is fine.
		const packages: ServiceBump['packages'] = [];
		let manualPackageBump = false;
		for (const [pkgName, pkg] of Object.entries(svc.packages)) {
			const before = base?.packages[pkgName];
			if (useBaseline && !before) continue; // A new package.
			if (before && before.version !== pkg.version) {
				manualPackageBump = true;
				continue;
			}
			if (!before || before.hash !== pkg.hash) packages.push({ name: pkgName, kind: pkg.kind, from: pkg.version, to: incrementVersion(pkg.version) });
		}
		const serviceUnbumped = !base || base.version === svc.version;
		const manifestChanged = !base || base.manifestHash !== svc.manifestHash;
		if (serviceUnbumped && (packages.length > 0 || manifestChanged || manualPackageBump)) {
			services.push({ name, from: svc.version, to: incrementVersion(svc.version), packages });
		} else if (packages.length > 0) {
			// Service version already raised by hand; still bump the changed packages.
			services.push({ name, from: svc.version, to: svc.version, packages });
		}
	}
	// An upgrade needs a new application type version; one raised by hand is kept.
	const application =
		current.applicationTypeVersion === deployedVersion
			? { from: current.applicationTypeVersion, to: incrementVersion(current.applicationTypeVersion) }
			: undefined;
	return { application, services, changedOnly: useBaseline };
}

/** True when the plan changes anything. */
export function planHasChanges(plan: VersionBumpPlan): boolean {
	return plan.application !== undefined || plan.services.some((s) => s.from !== s.to || s.packages.length > 0);
}

/** One-line descriptions of a plan's changes, for prompts and the log. */
export function describeVersionBump(plan: VersionBumpPlan, applicationTypeName: string): string[] {
	const lines: string[] = [];
	if (plan.application) lines.push(`${applicationTypeName}: ${plan.application.from} → ${plan.application.to}`);
	for (const s of plan.services) {
		const pkgs = s.packages.map((p) => `${p.name} ${p.from} → ${p.to}`).join(', ');
		const head = s.from !== s.to ? `${s.name}: ${s.from} → ${s.to}` : `${s.name}:`;
		lines.push(pkgs ? `${head} (${pkgs})` : head);
	}
	return lines;
}

/** Replaces attribute values by offset, last first so earlier offsets stay valid. */
function replaceValues(xml: string, edits: { start: number; end: number; value: string }[]): string {
	let out = xml;
	for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.value + out.slice(e.end);
	return out;
}

function valueEdit(el: XmlElement, name: string, value: string): { start: number; end: number; value: string } | undefined {
	const a = el.attributes.find((x) => x.name === name);
	return a?.valueRange ? { ...a.valueRange, value } : undefined;
}

/** Applies a service's bump to its ServiceManifest.xml text. */
export function applyServiceBump(xml: string, bump: ServiceBump): string {
	const root = parseXml(xml).root;
	if (!root) return xml;
	const edits = [valueEdit(root, 'Version', bump.to)];
	for (const child of root.children) {
		const pkg = bump.packages.find((p) => PACKAGE_ELEMENTS[child.localName] === p.kind && attr(child, 'Name') === p.name);
		if (pkg) edits.push(valueEdit(child, 'Version', pkg.to));
	}
	return replaceValues(xml, edits.filter((e) => e !== undefined));
}

/** Applies a plan to ApplicationManifest.xml text: the type version and the bumped services' `ServiceManifestVersion`. */
export function applyApplicationBump(xml: string, plan: VersionBumpPlan): string {
	const root = parseXml(xml).root;
	if (!root) return xml;
	const edits = plan.application ? [valueEdit(root, 'ApplicationTypeVersion', plan.application.to)] : [];
	for (const imp of kids(root, 'ServiceManifestImport')) {
		for (const ref of kids(imp, 'ServiceManifestRef')) {
			const svc = plan.services.find((s) => s.name === attr(ref, 'ServiceManifestName'));
			if (svc) edits.push(valueEdit(ref, 'ServiceManifestVersion', svc.to));
		}
	}
	return replaceValues(xml, edits.filter((e) => e !== undefined));
}
