// @ts-nocheck
import * as vscode from 'vscode';
import { SfRestClient } from '../cluster/sfRestClient';
import { ensureDebuggerAvailable } from './attachCommand';
import { runAutoAttach } from './autoAttachState';

async function maybeAutoAttachAfterDeploy(e, t, r) {
	let n = vscode.workspace.getConfiguration('serviceFabric'),
		i = clampNumber(
			n.get(AUTO_ATTACH_READY_TIMEOUT_KEY) ?? DEFAULT_AUTO_ATTACH_READY_TIMEOUT_SEC,
			5,
			300,
			DEFAULT_AUTO_ATTACH_READY_TIMEOUT_SEC,
		),
		o = clampNumber(n.get(AUTO_ATTACH_MAX_SESSIONS_KEY) ?? DEFAULT_AUTO_ATTACH_MAX_SESSIONS, 1, 50, DEFAULT_AUTO_ATTACH_MAX_SESSIONS),
		s = new SfRestClient(e.clusterEndpoint),
		a = {
			applicationName: e.applicationName,
			applicationTypeName: e.applicationTypeName,
			clusterEndpoint: e.clusterEndpoint,
			clusterKind: e.clusterKind,
		},
		c = {
			readyTimeoutMs: i * 1e3,
			maxSessions: o,
			pollIntervalMs: AUTO_ATTACH_POLL_INTERVAL_MS,
			getSetting: () => readAutoAttachSetting(),
			updateSetting: async (p) => {
				await vscode.workspace.getConfiguration('serviceFabric').update(AUTO_ATTACH_SETTING_KEY, p, vscode.ConfigurationTarget.Workspace);
			},
			getMementoFlag: (p) => e.memento.get(p) === !0,
			setMementoFlag: async (p, d) => {
				await e.memento.update(p, d);
			},
			showFirstDeployPrompt: () => showFirstDeployAutoAttachPrompt(),
			showInfo: (p) => {
				vscode.window.showInformationMessage(p);
			},
			showWarning: async (p, ...d) => vscode.window.showWarningMessage(p, ...d),
			showOutputChannel: () => t.outputChannel.show(!0),
			ensureDebuggerAvailable: () => ensureDebuggerAvailable('coreclr', t),
			listServices: (p) => s.listServices(p),
			listReplicas: (p) => s.listReplicas(p),
			getNodeNames: async () => {
				try {
					return (await s.getNodes()).map((d) => d.name);
				} catch (p) {
					return (t.warn(`Auto-attach: failed to enumerate cluster nodes: ${p instanceof Error ? p.message : String(p)}`), []);
				}
			},
			getDeployedCodePackages: (p, d) => s.getDeployedCodePackages(p, d),
			startDebugging: (p) => Promise.resolve(vscode.debug.startDebugging(void 0, p)),
			sleep: (p) => new Promise((d) => setTimeout(d, p)),
		},
		l = {
			event: (p, d) => r.event(p, d),
		},
		u = {
			info: (p) => t.info(p),
			warn: (p) => t.warn(p),
			error: (p, d) => t.error(p, d),
			debug: (p) => t.debug(p),
		};
	try {
		await runAutoAttach(c, a, u, l);
	} catch (p) {
		t.warn(`Auto-attach orchestrator threw: ${p instanceof Error ? p.message : String(p)}`);
	}
}

function readAutoAttachSetting() {
	return vscode.workspace.getConfiguration('serviceFabric').get(AUTO_ATTACH_SETTING_KEY) === 'localOnly' ? 'localOnly' : 'never';
}

function clampNumber(e, t, r, n) {
	return Number.isFinite(e) ? (e < t ? t : e > r ? r : e) : n;
}

async function showFirstDeployAutoAttachPrompt() {
	switch (
		await vscode.window.showInformationMessage(
			'Service Fabric: Publish completed. Auto-attach the debugger after future local-cluster Publishes?',
			{
				modal: !0,
			},
			FIRST_DEPLOY_PROMPT_YES,
			FIRST_DEPLOY_PROMPT_NOT_NOW,
			FIRST_DEPLOY_PROMPT_DONT_ASK,
		)
	) {
		case FIRST_DEPLOY_PROMPT_YES:
			return 'attach-once-localOnly';
		case FIRST_DEPLOY_PROMPT_DONT_ASK:
			return 'dont-ask-again';
		case FIRST_DEPLOY_PROMPT_NOT_NOW:
			return 'never-this-time';
		default:
			return;
	}
}

let AUTO_ATTACH_SETTING_KEY,
	AUTO_ATTACH_MAX_SESSIONS_KEY,
	AUTO_ATTACH_READY_TIMEOUT_KEY,
	DEFAULT_AUTO_ATTACH_MAX_SESSIONS,
	DEFAULT_AUTO_ATTACH_READY_TIMEOUT_SEC,
	AUTO_ATTACH_POLL_INTERVAL_MS,
	FIRST_DEPLOY_PROMPT_YES,
	FIRST_DEPLOY_PROMPT_NOT_NOW,
	FIRST_DEPLOY_PROMPT_DONT_ASK;

AUTO_ATTACH_SETTING_KEY = 'debug.autoAttachOnPublish';

AUTO_ATTACH_MAX_SESSIONS_KEY = 'debug.autoAttachMaxSessions';

AUTO_ATTACH_READY_TIMEOUT_KEY = 'debug.autoAttachReadyTimeoutSec';

DEFAULT_AUTO_ATTACH_MAX_SESSIONS = 5;

DEFAULT_AUTO_ATTACH_READY_TIMEOUT_SEC = 30;

AUTO_ATTACH_POLL_INTERVAL_MS = 1e3;

FIRST_DEPLOY_PROMPT_YES = 'Yes';

FIRST_DEPLOY_PROMPT_NOT_NOW = 'Not now';

FIRST_DEPLOY_PROMPT_DONT_ASK = "Don't ask again";

export { maybeAutoAttachAfterDeploy };
