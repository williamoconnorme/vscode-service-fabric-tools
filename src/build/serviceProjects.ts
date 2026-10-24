/**
 * Checks on an application's service projects (`.csproj`) that decide whether
 * they can be built on this machine. Pure (no `vscode` imports).
 */

/** Why the local dev cluster can't run on this machine, or `undefined` when it can (Windows x64). */
export function localClusterUnsupportedReason(platform: NodeJS.Platform, arch: string): string | undefined {
	if (platform !== 'win32') {
		return `The local Service Fabric dev cluster needs the Service Fabric SDK, which only exists for Windows x64. On ${platform === 'darwin' ? 'macOS' : 'Linux'}, publish to a remote cluster instead.`;
	}
	if (arch === 'arm64') {
		return 'The local Service Fabric dev cluster needs the Service Fabric SDK, which only exists for Windows x64; it can\'t run on Windows on ARM. Publish to a remote cluster instead.';
	}
	return undefined;
}

/** The target frameworks a project builds for (`<TargetFramework>` or `<TargetFrameworks>`). */
export function targetFrameworksOf(csprojXml: string): string[] {
	const single = /<TargetFramework>\s*([^<]+?)\s*<\/TargetFramework>/i.exec(csprojXml)?.[1];
	const multi = /<TargetFrameworks>\s*([^<]+?)\s*<\/TargetFrameworks>/i.exec(csprojXml)?.[1];
	const legacy = /<TargetFrameworkVersion>\s*v?([\d.]+)\s*<\/TargetFrameworkVersion>/i.exec(csprojXml)?.[1];
	const list = [...(multi?.split(';') ?? []), ...(single ? [single] : []), ...(legacy ? [`net${legacy.replace(/\./g, '')}`] : [])];
	return [...new Set(list.map((t) => t.trim()).filter(Boolean))];
}

/** True for .NET Framework monikers (`net48`, `net472`, `net4.8`), which only build on Windows. */
export function isNetFrameworkTfm(tfm: string): boolean {
	return /^net\d{2,3}$/i.test(tfm) || /^net4\.\d/i.test(tfm);
}

/** Name of the target {@link addActorUnixFix} adds; its presence marks a patched project. */
export const ACTOR_UNIX_FIX_TARGET = 'SfFixFabActUtilRuntimeConfig';

/**
 * The Microsoft.ServiceFabric.Actors build targets write
 * `FabActUtil.runtimeconfig.json` with `echo { %22runtimeOptions%22 … } > file`.
 * `cmd.exe` keeps those quotes; `sh` strips them, so on macOS and Linux the
 * file isn't valid JSON and `dotnet FabActUtil.dll` (which generates the actor
 * service manifest) fails. This target rewrites the file properly before
 * FabActUtil runs, and does nothing on Windows.
 */
export function actorUnixFixTarget(indent = '  '): string {
	const q = '&quot;';
	const json = `{ ${q}runtimeOptions${q}: { ${q}tfm${q}: ${q}$(TargetFramework)${q}, ${q}framework${q}: { ${q}name${q}: ${q}Microsoft.NETCore.App${q}, ${q}version${q}: ${q}$(_TargetFrameworkVersionWithoutV).0${q} } } }`;
	return [
		`${indent}<!-- macOS / Linux: the Actors targets write FabActUtil.runtimeconfig.json with "echo", whose quotes sh strips. Rewrite it as valid JSON before FabActUtil runs. -->`,
		`${indent}<Target Name="${ACTOR_UNIX_FIX_TARGET}" AfterTargets="_CopyAssembliesToFabActUtilWorkingDir" Condition=" '$(OS)' != 'Windows_NT' ">`,
		`${indent}  <WriteLinesToFile File="$(FabActUtilWorkingDir)/FabActUtil.runtimeconfig.json" Lines="${json}" Overwrite="true" />`,
		`${indent}</Target>`,
	].join('\n');
}

/** True for an actor service project (FabActUtil manifest generation on) that lacks {@link actorUnixFixTarget}. */
export function needsActorUnixFix(csprojXml: string): boolean {
	return /<UpdateServiceFabricManifestEnabled>\s*true\s*<\/UpdateServiceFabricManifestEnabled>/i.test(csprojXml) && !csprojXml.includes(ACTOR_UNIX_FIX_TARGET);
}

/** Adds {@link actorUnixFixTarget} before `</Project>`, keeping the file's line endings. */
export function addActorUnixFix(csprojXml: string): string {
	if (!needsActorUnixFix(csprojXml)) return csprojXml;
	const close = csprojXml.lastIndexOf('</Project>');
	if (close < 0) return csprojXml;
	const eol = csprojXml.includes('\r\n') ? '\r\n' : '\n';
	const block = actorUnixFixTarget().replace(/\n/g, eol);
	const before = csprojXml.slice(0, close).replace(/[ \t]*$/, '');
	return `${before}${before.endsWith(eol) ? '' : eol}${block}${eol}${csprojXml.slice(close)}`;
}
