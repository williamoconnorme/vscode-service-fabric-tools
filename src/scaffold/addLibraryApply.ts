import * as fs from 'fs';
import * as path from 'path';
import {
	buildLibraryClassStub,
	buildLibraryCsproj,
	isServiceFabricServiceProject,
	patchCsprojAddProjectReference,
} from './addLibraryTemplates';

export interface AddLibraryOptions {
	/** Folder the new `<name>/` library directory is created in. */
	workspaceRoot: string;
	name: string;
	targetFramework: string;
	/** Absolute paths of consumer csprojs that should reference the new library. */
	consumers: string[];
	/** Allow scaffolding into an existing non-empty folder. */
	allowExistingEmptyFolder?: boolean;
}

export interface AddLibraryResult {
	libraryDirectory: string;
	libraryCsprojPath: string;
	classStubPath: string;
	patchedConsumers: string[];
}

export interface AddLibraryReferenceOnlyOptions {
	consumerCsproj: string;
	targetCsproj: string;
}

export interface AddLibraryReferenceOnlyResult {
	changed: boolean;
	relativePath: string;
}

/**
 * Pure (no `vscode` import) on-disk apply step for `serviceFabric.addLibrary`.
 * Per Plan §6.3:
 *   1. Create `<workspaceRoot>/<name>/<name>.csproj` (minimal SDK shape).
 *   2. Create `<name>/Class1.cs`.
 *   3. For each consumer csproj, append a `<ProjectReference>` row to it.
 *      Idempotent — already-referenced consumers are left untouched.
 *   4. NEVER touch `<App>.sfproj`, ApplicationManifest.xml, StartupServices.xml,
 *      or any `*Parameters/*.xml` file. Libraries are not part of the SF
 *      manifest model.
 *
 * Rollback semantics: if any step throws, the library directory is removed
 * (best-effort) so a re-run starts from a clean slate. Already-patched
 * consumer csprojs remain patched — adding the same reference twice is a
 * no-op via `patchCsprojAddProjectReference`'s idempotency.
 */
export async function applyAddLibrary(opts: AddLibraryOptions): Promise<AddLibraryResult> {
	if (!opts.name || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(opts.name)) throw new Error(`Invalid library name: '${opts.name}'.`);
	if (!opts.workspaceRoot || !fs.existsSync(opts.workspaceRoot)) throw new Error(`Workspace root does not exist: '${opts.workspaceRoot}'.`);
	const libraryDirectory = path.join(opts.workspaceRoot, opts.name);
	const libraryCsprojPath = path.join(libraryDirectory, `${opts.name}.csproj`);
	const classStubPath = path.join(libraryDirectory, 'Class1.cs');
	if (fs.existsSync(libraryDirectory)) {
		if (fs.readdirSync(libraryDirectory).length > 0 && !opts.allowExistingEmptyFolder)
			throw new Error(`Cannot create library: folder already exists and is non-empty: ${libraryDirectory}`);
	} else {
		fs.mkdirSync(libraryDirectory, { recursive: true });
	}
	let scaffoldedFiles = false;
	try {
		fs.writeFileSync(libraryCsprojPath, buildLibraryCsproj({ name: opts.name, targetFramework: opts.targetFramework }), 'utf8');
		fs.writeFileSync(classStubPath, buildLibraryClassStub(opts.name), 'utf8');
		scaffoldedFiles = true;
		const patched: string[] = [];
		for (const consumer of opts.consumers) {
			if (!fs.existsSync(consumer)) throw new Error(`Consumer csproj does not exist: ${consumer}`);
			const xml = fs.readFileSync(consumer, 'utf8');
			if (isServiceFabricServiceProject(xml)) {
				// Service csproj — fine, this is the typical case (a service consuming a library).
			}
			const consumerDir = path.dirname(consumer);
			const rel = toMsbuildRelativePath(consumerDir, libraryCsprojPath);
			const result = patchCsprojAddProjectReference(xml, rel);
			if (result.changed) {
				fs.writeFileSync(consumer, result.xml, 'utf8');
				patched.push(consumer);
			}
		}
		return { libraryDirectory, libraryCsprojPath, classStubPath, patchedConsumers: patched };
	} catch (err) {
		// Best-effort rollback of just the scaffolded files; consumer patches
		// are kept (they're idempotent on retry).
		if (scaffoldedFiles) {
			try {
				fs.unlinkSync(libraryCsprojPath);
			} catch {
				/* best-effort */
			}
			try {
				fs.unlinkSync(classStubPath);
			} catch {
				/* best-effort */
			}
		}
		try {
			if (fs.existsSync(libraryDirectory) && fs.readdirSync(libraryDirectory).length === 0) {
				fs.rmdirSync(libraryDirectory);
			}
		} catch {
			/* best-effort */
		}
		throw err;
	}
}

/**
 * "Reference existing library" path (Plan §6.2.b — `.csproj`-context invocation).
 * Adds a single `<ProjectReference>` row in the right-clicked csproj that points
 * at an already-existing library csproj. Does not create any new files.
 *
 * Returns `{ changed: true }` when the consumer was patched, or
 * `{ changed: false }` when the reference already existed (idempotent).
 */
export async function applyAddLibraryReferenceOnly(opts: AddLibraryReferenceOnlyOptions): Promise<AddLibraryReferenceOnlyResult> {
	if (!fs.existsSync(opts.consumerCsproj)) throw new Error(`Consumer csproj does not exist: ${opts.consumerCsproj}`);
	if (!fs.existsSync(opts.targetCsproj)) throw new Error(`Target csproj does not exist: ${opts.targetCsproj}`);
	const targetXml = fs.readFileSync(opts.targetCsproj, 'utf8');
	if (isServiceFabricServiceProject(targetXml))
		throw new Error(
			`Refusing to add a reference to '${path.basename(opts.targetCsproj)}': it is a Service Fabric service project. Use 'Service Fabric: Add Service…' for service-to-service references.`,
		);
	const consumerDir = path.dirname(opts.consumerCsproj);
	const rel = toMsbuildRelativePath(consumerDir, opts.targetCsproj);
	const consumerXml = fs.readFileSync(opts.consumerCsproj, 'utf8');
	const result = patchCsprojAddProjectReference(consumerXml, rel);
	if (result.changed) {
		fs.writeFileSync(opts.consumerCsproj, result.xml, 'utf8');
	}
	return { changed: result.changed, relativePath: rel };
}

/**
 * Computes a relative path between two absolute filesystem paths and converts
 * forward-slashes to back-slashes so it can be embedded directly in MSBuild
 * `Include="..."` attributes.
 */
function toMsbuildRelativePath(fromDir: string, toPath: string): string {
	return path.relative(fromDir, toPath).split('/').join('\\');
}
