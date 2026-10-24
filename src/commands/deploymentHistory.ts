import * as vscode from 'vscode';
import type { ConnectionStore, ClusterConnection } from '../cluster/connectionStore';
import { createClientForConnection } from '../cluster/clusterAuth';
import type { ClusterDocumentProvider } from '../views/clusterDocuments';

/** EventStore keeps a limited window; ask for this much and show whatever it has. */
const LOOKBACK_DAYS = 30;
const TIMEOUT_MS = 20000;

/** Application events that make up its deployment history, with a short label each. */
const HISTORY_KINDS: Record<string, string> = {
	ApplicationCreated: 'Created',
	ApplicationDeleted: 'Deleted',
	ApplicationUpgradeStarted: 'Upgrade started',
	ApplicationUpgradeDomainCompleted: 'Upgrade domain completed',
	ApplicationUpgradeCompleted: 'Upgrade completed',
	ApplicationUpgradeRollbackStarted: 'Rollback started',
	ApplicationUpgradeRollbackCompleted: 'Rollback completed',
	ApplicationNewHealthReport: 'Health report',
	ApplicationHealthReportExpired: 'Health report expired',
	ApplicationProcessExited: 'Process exited',
	ApplicationContainerInstanceExited: 'Container exited',
};

interface ApplicationEvent {
	Kind?: string;
	TimeStamp?: string;
	ApplicationTypeVersion?: string;
	CurrentApplicationTypeVersion?: string;
	ApplicationTypeName?: string;
	UpgradeState?: string;
	RollingUpgradeMode?: string;
	FailureReason?: string;
	OverallUpgradeElapsedTimeInMs?: number;
	UpgradeDomains?: string;
	HealthState?: string;
	Description?: string;
	ServiceName?: string;
	ExitCode?: number;
	[key: string]: unknown;
}

/**
 * `serviceFabric.showDeploymentHistory`: the active (or given) cluster's EventStore history for one
 * application (creates, upgrades with versions, rollbacks, deletes, health reports, process exits),
 * newest first, in a read-only document. `appName` comes from a Clusters-tree application; without
 * it, `typeName` (from a manifest) or a picker chooses the application.
 */
export async function showDeploymentHistory(
	store: ConnectionStore,
	documents: ClusterDocumentProvider,
	opts: { connection?: ClusterConnection; appName?: string; typeName?: string } = {},
): Promise<void> {
	const conn = opts.connection ?? store.getActive();
	if (!conn?.connected) {
		vscode.window.showWarningMessage('No connected cluster. Select or reconnect a cluster in the Clusters view first.');
		return;
	}
	const client = createClientForConnection(conn, { interactive: true });
	let appName = opts.appName?.replace(/^fabric:\//, '');
	if (!appName) {
		const apps = (await client.getApplications()).filter((a) => !opts.typeName || a.typeName === opts.typeName);
		if (apps.length === 0) {
			vscode.window.showInformationMessage(`No ${opts.typeName ? `${opts.typeName} ` : ''}applications on ${conn.label}.`);
			return;
		}
		appName =
			apps.length === 1
				? apps[0].name
				: (
						await vscode.window.showQuickPick(
							apps.map((a) => ({ label: `fabric:/${a.name}`, description: `${a.typeName} ${a.typeVersion}`, name: a.name })),
							{ placeHolder: 'Show the deployment history of' },
						)
					)?.name;
		if (!appName) return;
	}
	const appId = encodeURIComponent(appName.replace(/\//g, '~'));
	const end = new Date();
	const start = new Date(end.getTime() - LOOKBACK_DAYS * 86400000);
	let events: ApplicationEvent[];
	try {
		const body = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `Reading the history of fabric:/${appName}…` },
			() =>
				client.rawGet(
					`/EventsStore/Applications/${appId}/$/Events?StartTimeUtc=${encodeURIComponent(start.toISOString())}&EndTimeUtc=${encodeURIComponent(end.toISOString())}`,
					TIMEOUT_MS,
				),
		);
		events = Array.isArray(body) ? (body as ApplicationEvent[]) : [];
	} catch (err) {
		vscode.window.showErrorMessage(
			`Couldn't read events for fabric:/${appName} from ${conn.label}. The cluster needs EventStore, which most local dev clusters don't run. (${(err as Error).message})`,
		);
		return;
	}
	const rows = events
		.filter((e) => e.Kind && e.Kind in HISTORY_KINDS)
		.sort((a, b) => String(b.TimeStamp).localeCompare(String(a.TimeStamp)))
		.map(formatEvent);
	const header = [
		`Deployment history of fabric:/${appName} on ${conn.label} (${conn.endpoint})`,
		`EventStore, last ${LOOKBACK_DAYS} days, newest first. ${rows.length} event${rows.length === 1 ? '' : 's'}.`,
		'',
	];
	await documents.show(`History fabric_${appName} (${conn.label})`, [...header, ...(rows.length ? rows : ['No events in this window.'])].join('\n'), 'log');
}

function formatEvent(e: ApplicationEvent): string {
	const time = String(e.TimeStamp ?? '').replace('T', ' ').replace(/\.\d+Z$|Z$/, 'Z');
	const version =
		e.CurrentApplicationTypeVersion && e.ApplicationTypeVersion && e.CurrentApplicationTypeVersion !== e.ApplicationTypeVersion
			? `${e.CurrentApplicationTypeVersion} → ${e.ApplicationTypeVersion}`
			: (e.ApplicationTypeVersion ?? '');
	const details = [
		version,
		e.RollingUpgradeMode,
		e.UpgradeDomains ? `UD ${e.UpgradeDomains}` : '',
		e.OverallUpgradeElapsedTimeInMs ? `${Math.round(e.OverallUpgradeElapsedTimeInMs / 1000)}s` : '',
		e.FailureReason && e.FailureReason !== 'None' ? `failure: ${e.FailureReason}` : '',
		e.HealthState,
		e.ServiceName,
		e.ExitCode !== undefined ? `exit code ${e.ExitCode}` : '',
		e.Description ? String(e.Description).replace(/\s+/g, ' ') : '',
	].filter(Boolean);
	const level = /Rollback|Exited|Deleted/.test(String(e.Kind)) || e.HealthState === 'Error' ? 'WARN' : 'INFO';
	return `${time} ${level} ${HISTORY_KINDS[String(e.Kind)].padEnd(25)} ${details.join(' • ')}`;
}
