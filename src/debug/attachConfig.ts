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

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * True when the cluster's services run on this machine, so their PIDs can be
 * attached to: the local dev cluster, or any connection whose gateway is a
 * loopback address. Remote clusters' processes live on other nodes. Off
 * Windows nothing qualifies: there is no local dev cluster there.
 */
export function isAttachableCluster(
	connection: { kind: string; endpoint: string },
	hostName?: string,
	platform: NodeJS.Platform = process.platform,
): boolean {
	if (platform !== 'win32') return false;
	if (connection.kind === 'local') return true;
	try {
		const host = new URL(connection.endpoint).hostname.toLowerCase();
		return LOOPBACK_HOSTS.has(host) || (hostName !== undefined && host === hostName.toLowerCase());
	} catch {
		return false;
	}
}

export function buildAttachConfig(pkg: AttachTarget, debugType: DebugRuntime): AttachDebugConfiguration {
	return {
		type: debugType,
		name: `Attach: ${pkg.serviceManifestName}/${pkg.codePackageName} (pid ${pkg.processId})`,
		request: 'attach',
		processId: pkg.processId ?? 0,
		justMyCode: true,
	};
}
