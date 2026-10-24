import type { DeployedCodePackageInfo } from '../cluster/sfRestClient';
import type { DebugRuntime } from './debuggerAvailability';

/**
 * Attach configuration handed to `vscode.debug.startDebugging`. A type alias
 * (not an interface) so it stays assignable to `vscode.DebugConfiguration`.
 */
export type AttachDebugConfiguration = {
	type: DebugRuntime;
	name: string;
	request: 'attach';
	processId: number;
	justMyCode: boolean;
};

/** The code-package fields an attach configuration is built from. */
export type AttachTarget = Pick<DeployedCodePackageInfo, 'serviceManifestName' | 'codePackageName' | 'processId'>;

export function buildAttachConfig(pkg: AttachTarget, debugType: DebugRuntime): AttachDebugConfiguration {
	return {
		type: debugType,
		name: `Attach: ${pkg.serviceManifestName}/${pkg.codePackageName} (pid ${pkg.processId})`,
		request: 'attach',
		processId: pkg.processId ?? 0,
		justMyCode: true,
	};
}
