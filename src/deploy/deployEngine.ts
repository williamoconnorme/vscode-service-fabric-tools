/**
 * Chooses how Publish / Remove talk to the cluster. Pure; no `vscode` imports.
 */

/** `serviceFabric.deploy.engine`. */
export type DeployEngineSetting = 'auto' | 'powershell' | 'rest';

/** The engine a deploy actually uses. */
export type DeployEngine = 'powershell' | 'rest';

/**
 * `auto` is REST on every platform: it only needs the HTTP gateway, whereas
 * PowerShell's `Connect-ServiceFabricCluster` also needs the client TCP port
 * (often not exposed, e.g. behind a gateway on 443). `powershell`
 * (`Deploy-FabricApplication.ps1`, as Visual Studio does) is opt-in, and an
 * error off Windows: the Service Fabric SDK's PowerShell module only exists there.
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
	return { engine: 'rest' };
}
