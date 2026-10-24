import * as vscode from 'vscode';
import type { ClusterKind } from '../cluster/connectionStore';
import { createClusterClient, type ClusterSecurity } from '../cluster/clusterAuth';
import { ensureDebuggerAvailable } from './attachCommand';
import {
	runAutoAttach,
	type AutoAttachContext,
	type AutoAttachHost,
	type AutoAttachLogger,
	type AutoAttachSetting,
	type AutoAttachTelemetry,
	type AutoAttachTelemetryProperties,
	type FirstDeployPromptChoice,
} from './autoAttachState';

/** What the Publish command knows about the application it just deployed. */
export interface AutoAttachDeployInfo {
	applicationName: string;
	applicationTypeName: string;
	clusterEndpoint: string;
	clusterKind: ClusterKind;
	/** Pinned certificate and Entra ID settings of the cluster, if any. */
	clusterSecurity?: ClusterSecurity;
	/** Workspace-state Memento holding the one-shot and prompt-shown flags. */
	memento: vscode.Memento;
}

/** The slice of the extension logger the auto-attach glue uses. */
export interface AutoAttachDeployLogger extends AutoAttachLogger {
	readonly outputChannel: vscode.OutputChannel;
}

const AUTO_ATTACH_SETTING_KEY = 'debug.autoAttachOnPublish';
const AUTO_ATTACH_MAX_SESSIONS_KEY = 'debug.autoAttachMaxSessions';
const AUTO_ATTACH_READY_TIMEOUT_KEY = 'debug.autoAttachReadyTimeoutSec';
const DEFAULT_AUTO_ATTACH_MAX_SESSIONS = 5;
const DEFAULT_AUTO_ATTACH_READY_TIMEOUT_SEC = 30;
const AUTO_ATTACH_POLL_INTERVAL_MS = 1000;
const FIRST_DEPLOY_PROMPT_YES = 'Yes';
const FIRST_DEPLOY_PROMPT_NOT_NOW = 'Not now';
const FIRST_DEPLOY_PROMPT_DONT_ASK = "Don't ask again";

/**
 * Called after a successful Publish: binds `runAutoAttach` to the live VS Code
 * settings, Memento, UI and the cluster gateway. Never throws — orchestrator
 * failures are logged as warnings.
 */
export async function maybeAutoAttachAfterDeploy(
	info: AutoAttachDeployInfo,
	logger: AutoAttachDeployLogger,
	telemetry: AutoAttachTelemetry,
): Promise<void> {
	const config = vscode.workspace.getConfiguration('serviceFabric');
	const readyTimeoutSec = clampNumber(
		config.get<number>(AUTO_ATTACH_READY_TIMEOUT_KEY) ?? DEFAULT_AUTO_ATTACH_READY_TIMEOUT_SEC,
		5,
		300,
		DEFAULT_AUTO_ATTACH_READY_TIMEOUT_SEC,
	);
	const maxSessions = clampNumber(
		config.get<number>(AUTO_ATTACH_MAX_SESSIONS_KEY) ?? DEFAULT_AUTO_ATTACH_MAX_SESSIONS,
		1,
		50,
		DEFAULT_AUTO_ATTACH_MAX_SESSIONS,
	);
	const client = createClusterClient(info.clusterEndpoint, info.clusterSecurity, { interactive: true });
	const ctx: AutoAttachContext = {
		applicationName: info.applicationName,
		applicationTypeName: info.applicationTypeName,
		clusterEndpoint: info.clusterEndpoint,
		clusterKind: info.clusterKind,
	};
	const host: AutoAttachHost = {
		readyTimeoutMs: readyTimeoutSec * 1000,
		maxSessions,
		pollIntervalMs: AUTO_ATTACH_POLL_INTERVAL_MS,
		getSetting: () => readAutoAttachSetting(),
		updateSetting: async (value) => {
			await vscode.workspace.getConfiguration('serviceFabric').update(AUTO_ATTACH_SETTING_KEY, value, vscode.ConfigurationTarget.Workspace);
		},
		getMementoFlag: (key) => info.memento.get(key) === true,
		setMementoFlag: async (key, value) => {
			await info.memento.update(key, value);
		},
		showFirstDeployPrompt: () => showFirstDeployAutoAttachPrompt(),
		showInfo: (message) => {
			vscode.window.showInformationMessage(message);
		},
		showWarning: async (message, ...items) => vscode.window.showWarningMessage(message, ...items),
		showOutputChannel: () => logger.outputChannel.show(true),
		ensureDebuggerAvailable: () => ensureDebuggerAvailable('coreclr', logger),
		listServices: (applicationName) => client.listServices(applicationName),
		listReplicas: (serviceId) => client.listReplicas(serviceId),
		getNodeNames: async () => {
			try {
				return (await client.getNodes()).map((n) => n.name);
			} catch (err) {
				logger.warn(`Auto-attach: failed to enumerate cluster nodes: ${err instanceof Error ? err.message : String(err)}`);
				return [];
			}
		},
		getDeployedCodePackages: (applicationName, nodeNames) => client.getDeployedCodePackages(applicationName, nodeNames),
		startDebugging: (debugConfig) => Promise.resolve(vscode.debug.startDebugging(undefined, debugConfig)),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	};
	const telemetryAdapter: AutoAttachTelemetry = {
		event: (name: string, properties?: AutoAttachTelemetryProperties) => telemetry.event(name, properties),
	};
	const loggerAdapter: AutoAttachLogger = {
		info: (message) => logger.info(message),
		warn: (message) => logger.warn(message),
		error: (message, err) => logger.error(message, err),
		debug: (message) => logger.debug(message),
	};
	try {
		await runAutoAttach(host, ctx, loggerAdapter, telemetryAdapter);
	} catch (err) {
		logger.warn(`Auto-attach orchestrator threw: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function readAutoAttachSetting(): AutoAttachSetting {
	return vscode.workspace.getConfiguration('serviceFabric').get(AUTO_ATTACH_SETTING_KEY) === 'localOnly' ? 'localOnly' : 'never';
}

/** Clamps `value` to `[min, max]`; non-finite values fall back to `fallback`. */
function clampNumber(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return value < min ? min : value > max ? max : value;
}

async function showFirstDeployAutoAttachPrompt(): Promise<FirstDeployPromptChoice | undefined> {
	const pick = await vscode.window.showInformationMessage(
		'Service Fabric: Publish completed. Auto-attach the debugger after future local-cluster Publishes?',
		{ modal: true },
		FIRST_DEPLOY_PROMPT_YES,
		FIRST_DEPLOY_PROMPT_NOT_NOW,
		FIRST_DEPLOY_PROMPT_DONT_ASK,
	);
	switch (pick) {
		case FIRST_DEPLOY_PROMPT_YES:
			return 'attach-once-localOnly';
		case FIRST_DEPLOY_PROMPT_DONT_ASK:
			return 'dont-ask-again';
		case FIRST_DEPLOY_PROMPT_NOT_NOW:
			return 'never-this-time';
		default:
			return undefined;
	}
}
