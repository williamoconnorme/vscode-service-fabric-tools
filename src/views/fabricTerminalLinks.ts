import * as vscode from 'vscode';
import type { ClusterConnection, ConnectionStore } from '../cluster/connectionStore';
import { createClientForConnection } from '../cluster/clusterAuth';
import { explorerUrlFor } from '../commands/clusterEntityCommands';
import { ClusterTreeItem } from './clustersTreeProvider';

/** `fabric:/App` or `fabric:/App/Service[/…]`; stops at quotes, brackets, whitespace and trailing punctuation. */
const FABRIC_NAME = /fabric:\/[\w.\-~]+(?:\/[\w.\-~]+)*/g;

interface FabricLink extends vscode.TerminalLink {
	name: string;
}

/**
 * Makes `fabric:/…` application and service names in terminals (build and publish tasks,
 * PowerShell, `sfctl`) clickable: Open in Service Fabric Explorer on the active cluster,
 * Show Deployment History, or Copy.
 */
export class FabricTerminalLinkProvider implements vscode.TerminalLinkProvider<FabricLink> {
	constructor(private readonly store: ConnectionStore) {}

	provideTerminalLinks(context: vscode.TerminalLinkContext): FabricLink[] {
		const links: FabricLink[] = [];
		for (const m of context.line.matchAll(FABRIC_NAME)) {
			const name = m[0].replace(/[.\-]+$/, '');
			if (name === 'fabric:/' || m.index === undefined) continue;
			links.push({ startIndex: m.index, length: name.length, tooltip: 'Service Fabric: open or inspect', name });
		}
		return links;
	}

	handleTerminalLink(link: FabricLink): Promise<void> {
		return pickFabricNameAction(this.store.getActive(), link.name);
	}
}

/**
 * Offers what can be done with a `fabric:/App[/Service]` name on `active`: Open in Service Fabric
 * Explorer, Show Deployment History, or Copy. Used by terminal links and the `vscode://` handler.
 */
export async function pickFabricNameAction(active: ClusterConnection | undefined, name: string): Promise<void> {
	const [appName, ...rest] = name.replace(/^fabric:\//, '').split('/');
	const picked = await vscode.window.showQuickPick(
		[
			...(active?.connected
				? [
						{ label: '$(link-external) Open in Service Fabric Explorer', description: active.label, action: 'explorer' },
						{ label: '$(history) Show Deployment History', description: `fabric:/${appName}`, action: 'history' },
					]
				: []),
			{ label: '$(copy) Copy', description: name, action: 'copy' },
		],
		{ placeHolder: name },
	);
	if (!picked) return;
	if (picked.action === 'copy' || !active) {
		await vscode.env.clipboard.writeText(name);
		return;
	}
	const appId = encodeURIComponent(appName.replace(/\//g, '~'));
	if (picked.action === 'history') {
		const item = new ClusterTreeItem('app', appName, vscode.TreeItemCollapsibleState.None, active, undefined, { appName, appId });
		await vscode.commands.executeCommand('serviceFabric.showDeploymentHistory', item);
		return;
	}
	// Explorer routes go through the application type, so look the application up first.
	let typeName: string | undefined;
	try {
		typeName = (await createClientForConnection(active).getApplication(appId))?.typeName;
	} catch {
		typeName = undefined;
	}
	const service = rest.length ? `fabric:/${appName}/${rest.join('/')}` : undefined;
	const item = new ClusterTreeItem(service ? 'service' : 'app', name, vscode.TreeItemCollapsibleState.None, active, undefined, {
		appName,
		appId,
		typeName,
		serviceName: service,
		serviceId: service ? encodeURIComponent(`${appName}/${rest.join('/')}`.replace(/\//g, '~')) : undefined,
	});
	await vscode.env.openExternal(vscode.Uri.parse(explorerUrlFor(active, typeName ? item : undefined)));
}
