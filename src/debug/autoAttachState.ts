import type { ClusterKind } from '../cluster/connectionStore';
import type { DeployedCodePackageInfo, ReplicaSummary, ServiceSummary } from '../cluster/sfRestClient';
import { buildAttachConfig, type AttachDebugConfiguration } from './attachConfig';

/** Value of the `serviceFabric.debug.autoAttachOnPublish` setting. */
export type AutoAttachSetting = 'never' | 'localOnly';

export interface AutoAttachDecisionInput {
	setting: AutoAttachSetting;
	clusterKind: ClusterKind;
	oneShotPending: boolean;
	promptShownBefore: boolean;
}

export type AutoAttachDecision = { kind: 'skip' } | { kind: 'attach' } | { kind: 'prompt-then-decide' };

/** The user's answer to the first-deploy auto-attach prompt. */
export type FirstDeployPromptChoice = 'attach-once-localOnly' | 'never-this-time' | 'dont-ask-again';

export interface FirstDeployPromptOutcome {
	settingUpdate: AutoAttachSetting | undefined;
	attachThisTime: boolean;
}

export interface AutoAttachPlan<T> {
	selected: T[];
	droppedCount: number;
}

/** The deployed application a Publish just produced. */
export interface AutoAttachContext {
	applicationName: string;
	applicationTypeName: string;
	clusterEndpoint: string;
	clusterKind: ClusterKind;
}

/**
 * Everything the orchestrator needs from VS Code and the cluster, injected so
 * `runAutoAttach` stays free of any `vscode` import.
 */
export interface AutoAttachHost {
	readyTimeoutMs: number;
	maxSessions: number;
	pollIntervalMs: number;
	getSetting(): AutoAttachSetting;
	updateSetting(value: AutoAttachSetting): Promise<void>;
	getMementoFlag(key: string): boolean;
	setMementoFlag(key: string, value: boolean | undefined): Promise<void>;
	showFirstDeployPrompt(): Promise<FirstDeployPromptChoice | undefined>;
	showInfo(message: string): void;
	showWarning(message: string, ...items: string[]): Promise<string | undefined>;
	showOutputChannel(): void;
	ensureDebuggerAvailable(): Promise<boolean>;
	listServices(applicationName: string): Promise<Pick<ServiceSummary, 'id'>[]>;
	listReplicas(serviceId: string): Promise<Pick<ReplicaSummary, 'replicaStatus'>[]>;
	getNodeNames(): Promise<string[]>;
	getDeployedCodePackages(applicationName: string, nodeNames: string[]): Promise<DeployedCodePackageInfo[]>;
	startDebugging(config: AttachDebugConfiguration): Promise<boolean>;
	sleep(ms: number): Promise<void>;
}

export interface AutoAttachLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string, err?: unknown): void;
	debug(message: string): void;
}

export type AutoAttachTelemetryProperties = Record<string, string | number | boolean | undefined>;

export interface AutoAttachTelemetry {
	event(name: string, properties?: AutoAttachTelemetryProperties): void;
}

/**
 * Decides whether a successful Publish should auto-attach the debugger.
 *
 * Rules (1.1.8 — local-only scope):
 * - **Remote clusters are out of scope.** Any non-local cluster short-circuits
 *   to `skip` regardless of setting or one-shot flag. The orchestrator still
 *   *consumes* a pending one-shot Memento entry on remote deploys (so the
 *   flag does not leak across cluster switches), but no attach happens.
 * - One-shot wins over the global setting on local clusters.
 * - `'localOnly'` on a local cluster ⇒ attach.
 * - `'never'` on a local cluster ⇒ surface the first-deploy prompt the first
 *   time, then `skip` thereafter.
 */
export function decideAutoAttach(input: AutoAttachDecisionInput): AutoAttachDecision {
	if (input.clusterKind !== 'local') return { kind: 'skip' };
	if (input.oneShotPending) return { kind: 'attach' };
	if (input.setting === 'localOnly') return { kind: 'attach' };
	if (!input.promptShownBefore) return { kind: 'prompt-then-decide' };
	return { kind: 'skip' };
}

/**
 * Plan one debug session per host PID, capped by `cap`. Returns the slice that
 * will be attached and the count that was dropped due to the cap. Code packages
 * without a usable PID (containers, guest executables, setup-only entry points)
 * are filtered out before the cap is applied.
 */
export function planAutoAttach<T extends { processId?: number }>(pkgs: readonly T[], cap: number): AutoAttachPlan<T> {
	const eligible = pkgs.filter((p) => typeof p.processId == 'number' && p.processId > 0);
	if (eligible.length <= cap) return { selected: [...eligible], droppedCount: 0 };
	return { selected: eligible.slice(0, cap), droppedCount: eligible.length - cap };
}

/**
 * Translates the user's answer to the first-deploy prompt into a desired
 * setting update plus a flag indicating whether to attach this Publish.
 */
export function classifyFirstDeployPrompt(choice: FirstDeployPromptChoice): FirstDeployPromptOutcome {
	switch (choice) {
		case 'attach-once-localOnly':
			return { settingUpdate: 'localOnly', attachThisTime: true };
		case 'never-this-time':
			return { settingUpdate: undefined, attachThisTime: false };
		case 'dont-ask-again':
			return { settingUpdate: 'never', attachThisTime: false };
	}
}

// ---------------------------------------------------------------------------
// Orchestration loop
// ---------------------------------------------------------------------------

/** Memento key that suppresses the first-deploy prompt after the user has answered once. */
export const PROMPT_SHOWN_KEY = 'serviceFabric.debug.autoAttachPromptShown';
/** Memento key prefix for the per-application one-shot toggle. */
export const ONE_SHOT_KEY_PREFIX = 'serviceFabric.autoAttachNext:';

export function oneShotMementoKey(applicationName: string): string {
	return `${ONE_SHOT_KEY_PREFIX}${applicationName}`;
}

/**
 * Drives one auto-attach attempt. Idempotent and side-effect-free aside from
 * what the host does. Returns nothing — outcomes are routed via toasts and
 * telemetry on the host.
 */
export async function runAutoAttach(
	host: AutoAttachHost,
	ctx: AutoAttachContext,
	logger: AutoAttachLogger,
	telemetry: AutoAttachTelemetry,
): Promise<void> {
	const startTime = Date.now();
	const oneShotKey = oneShotMementoKey(ctx.applicationName);
	const oneShotPending = host.getMementoFlag(oneShotKey);
	// Always consume the one-shot flag — even on remote — so it does not leak
	// across subsequent deploys against a different cluster.
	if (oneShotPending) {
		await host.setMementoFlag(oneShotKey, undefined);
	}
	const setting = host.getSetting();
	const promptShownBefore = host.getMementoFlag(PROMPT_SHOWN_KEY);
	const decision = decideAutoAttach({
		setting,
		clusterKind: ctx.clusterKind,
		oneShotPending,
		promptShownBefore,
	});
	telemetry.event('extension.debug.autoAttach.decision', {
		setting,
		clusterKind: ctx.clusterKind,
		oneShot: oneShotPending,
		decision: decision.kind === 'prompt-then-decide' ? 'prompt' : decision.kind,
	});
	if (decision.kind === 'skip') {
		if (ctx.clusterKind !== 'local') {
			logger.debug(
				`Auto-attach skipped — active cluster is ${ctx.clusterKind}; remote-cluster auto-attach is deferred to a future release.`,
			);
			telemetry.event('extension.debug.autoAttach.result', {
				outcome: 'skipped-remote',
				attachedCount: 0,
				droppedCount: 0,
				clusterKind: ctx.clusterKind,
				durationMs: Date.now() - startTime,
			});
		}
		return;
	}
	let attachThisTime = decision.kind === 'attach';
	if (decision.kind === 'prompt-then-decide') {
		const choice = await host.showFirstDeployPrompt();
		// Always remember we asked, regardless of the answer.
		await host.setMementoFlag(PROMPT_SHOWN_KEY, true);
		const outcome = classifyFirstDeployPrompt(choice ?? 'never-this-time');
		if (outcome.settingUpdate) {
			try {
				await host.updateSetting(outcome.settingUpdate);
			} catch (err) {
				logger.warn(
					`Auto-attach: failed to persist setting '${outcome.settingUpdate}': ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
		attachThisTime = outcome.attachThisTime;
		if (!attachThisTime) return;
	}
	if (!attachThisTime) return;

	// Pre-flight: debugger extension presence.
	const debuggerOk = await host.ensureDebuggerAvailable();
	if (!debuggerOk) {
		logger.warn('Auto-attach skipped — debugger pre-flight declined or failed.');
		telemetry.event('extension.debug.autoAttach.result', {
			outcome: 'preflight-declined',
			attachedCount: 0,
			droppedCount: 0,
			clusterKind: ctx.clusterKind,
			durationMs: Date.now() - startTime,
		});
		return;
	}

	// Wait for at least one Ready replica per the configured timeout.
	const ready = await waitForAtLeastOneReadyReplica(host, ctx.applicationName);
	if (!ready) {
		logger.warn(`Auto-attach skipped — no service replica became Ready within ${Math.round(host.readyTimeoutMs / 1000)}s.`);
		telemetry.event('extension.debug.autoAttach.result', {
			outcome: 'ready-timeout',
			attachedCount: 0,
			droppedCount: 0,
			clusterKind: ctx.clusterKind,
			durationMs: Date.now() - startTime,
		});
		const retryPick = await host.showWarning(
			`Auto-attach skipped — no service replica became Ready within ${Math.round(host.readyTimeoutMs / 1000)}s.`,
			'Retry',
		);
		if (retryPick === 'Retry') {
			// Re-run with a fresh poll budget; each further retry needs another explicit click.
			await runAutoAttach(host, ctx, logger, telemetry);
		}
		return;
	}

	// Resolve PIDs.
	let nodeNames: string[] = [];
	try {
		nodeNames = await host.getNodeNames();
	} catch (err) {
		logger.warn(`Auto-attach: failed to list nodes for PID resolution: ${err instanceof Error ? err.message : String(err)}`);
	}
	let codePkgs: DeployedCodePackageInfo[] = [];
	try {
		codePkgs = await host.getDeployedCodePackages(ctx.applicationName, nodeNames);
	} catch (err) {
		logger.warn(`Auto-attach: failed to list deployed code packages: ${err instanceof Error ? err.message : String(err)}`);
	}
	const { selected, droppedCount } = planAutoAttach(codePkgs, host.maxSessions);
	if (selected.length === 0) {
		host.showInfo(
			'Auto-attach: no host processes were available to attach. Containers and Guest Executables do not expose a managed PID via the SF gateway.',
		);
		telemetry.event('extension.debug.autoAttach.result', {
			outcome: 'no-eligible-pids',
			attachedCount: 0,
			droppedCount,
			clusterKind: ctx.clusterKind,
			durationMs: Date.now() - startTime,
		});
		return;
	}

	let attachedCount = 0;
	for (const pkg of selected) {
		const config = buildAttachConfig(pkg, 'coreclr');
		logger.info(
			`Auto-attach: starting coreclr debugger against PID ${pkg.processId} (${pkg.serviceManifestName}/${pkg.codePackageName} on ${pkg.nodeName}).`,
		);
		try {
			const ok = await host.startDebugging(config);
			if (ok) attachedCount++;
			else {
				logger.warn(
					`Auto-attach: vscode.debug.startDebugging returned false for PID ${pkg.processId} (${pkg.serviceManifestName}/${pkg.codePackageName}).`,
				);
			}
		} catch (err) {
			logger.error(
				`Auto-attach: vscode.debug.startDebugging threw for PID ${pkg.processId} (${pkg.serviceManifestName}/${pkg.codePackageName})`,
				err,
			);
		}
	}

	const total = selected.length;
	const droppedSuffix =
		droppedCount > 0
			? ` (${droppedCount} additional host(s) skipped — raise serviceFabric.debug.autoAttachMaxSessions to include them.)`
			: '';
	if (attachedCount === total && total === 1) {
		const p = selected[0];
		host.showInfo(`Auto-attached debugger to ${p.serviceManifestName}/${p.codePackageName} (pid ${p.processId}).${droppedSuffix}`);
	} else if (attachedCount === total) {
		host.showInfo(`Auto-attached debugger to ${attachedCount} service(s) of ${ctx.applicationName}.${droppedSuffix}`);
	} else {
		const pick = await host.showWarning(
			`Auto-attached debugger to ${attachedCount} of ${total} service(s). See Service Fabric output channel for failures.${droppedSuffix}`,
			'Open Output Channel',
		);
		if (pick === 'Open Output Channel') host.showOutputChannel();
	}
	const outcome = attachedCount === total ? 'success' : attachedCount === 0 ? 'failed' : 'partial';
	telemetry.event('extension.debug.autoAttach.result', {
		outcome,
		attachedCount,
		droppedCount,
		clusterKind: ctx.clusterKind,
		durationMs: Date.now() - startTime,
	});
}

async function waitForAtLeastOneReadyReplica(host: AutoAttachHost, appFullName: string): Promise<boolean> {
	const deadline = Date.now() + host.readyTimeoutMs;
	while (Date.now() < deadline) {
		let services: Pick<ServiceSummary, 'id'>[] = [];
		try {
			services = await host.listServices(appFullName);
		} catch {
			services = [];
		}
		if (services.length === 0) {
			await host.sleep(host.pollIntervalMs);
			continue;
		}
		let anyReady = false;
		for (const svc of services) {
			let replicas: Pick<ReplicaSummary, 'replicaStatus'>[] = [];
			try {
				replicas = await host.listReplicas(svc.id);
			} catch {
				replicas = [];
			}
			if (replicas.some((r) => r.replicaStatus === 'Ready')) {
				anyReady = true;
				break;
			}
		}
		if (anyReady) return true;
		await host.sleep(host.pollIntervalMs);
	}
	return false;
}
