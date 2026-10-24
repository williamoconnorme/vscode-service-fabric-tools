/**
 * Chooses how Publish / Remove talk to the cluster. Pure; no `vscode` imports.
 */

/** `serviceFabric.deploy.engine`. */
export type DeployEngineSetting = 'auto' | 'powershell' | 'rest';

/** The engine a deploy actually uses. */
export type DeployEngine = 'powershell' | 'rest';

/**
 * `auto` is PowerShell (`Deploy-FabricApplication.ps1`, same as Visual Studio)
 * on Windows and REST elsewhere. `powershell` off Windows is an error: the
 * Service Fabric SDK's PowerShell module only exists on Windows.
 */
export function resolveDeployEngine(setting: string | undefined, platform: NodeJS.Platform): { engine: DeployEngine } | { error: string } {
	const value = (setting ?? 'auto').trim().toLowerCase();
	if (value === 'rest') return { engine: 'rest' };
	if (value === 'powershell') {
		if (platform === 'win32') return { engine: 'powershell' };
		return {
			error:
				'serviceFabric.deploy.engine is "powershell", but the Service Fabric SDK PowerShell module only exists on Windows. Set it to "rest" (or "auto") to deploy over the cluster\'s HTTP gateway.',
		};
	}
	return { engine: platform === 'win32' ? 'powershell' : 'rest' };
}
