"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONE_SHOT_KEY_PREFIX = exports.PROMPT_SHOWN_KEY = void 0;
exports.decideAutoAttach = decideAutoAttach;
exports.planAutoAttach = planAutoAttach;
exports.classifyFirstDeployPrompt = classifyFirstDeployPrompt;
exports.oneShotMementoKey = oneShotMementoKey;
exports.runAutoAttach = runAutoAttach;
const attachConfig_js_1 = require("./attachConfig.js");
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
function decideAutoAttach(input) {
    if (input.clusterKind !== 'local')
        return { kind: 'skip' };
    if (input.oneShotPending)
        return { kind: 'attach' };
    if (input.setting === 'localOnly')
        return { kind: 'attach' };
    if (!input.promptShownBefore)
        return { kind: 'prompt-then-decide' };
    return { kind: 'skip' };
}
/**
 * Plan one debug session per host PID, capped by `cap`. Returns the slice that
 * will be attached and the count that was dropped due to the cap. Code packages
 * without a usable PID (containers, guest executables, setup-only entry points)
 * are filtered out before the cap is applied.
 */
function planAutoAttach(pkgs, cap) {
    const eligible = pkgs.filter(p => typeof p.processId === 'number' && p.processId > 0);
    if (eligible.length <= cap)
        return { selected: [...eligible], droppedCount: 0 };
    return { selected: eligible.slice(0, cap), droppedCount: eligible.length - cap };
}
/**
 * Translates the user's answer to the first-deploy prompt into a desired
 * setting update plus a flag indicating whether to attach this Publish.
 */
function classifyFirstDeployPrompt(choice) {
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
exports.PROMPT_SHOWN_KEY = 'serviceFabric.debug.autoAttachPromptShown';
/** Memento key prefix for the per-application one-shot toggle. */
exports.ONE_SHOT_KEY_PREFIX = 'serviceFabric.autoAttachNext:';
function oneShotMementoKey(applicationName) {
    return `${exports.ONE_SHOT_KEY_PREFIX}${applicationName}`;
}
/**
 * Drives one auto-attach attempt. Idempotent and side-effect-free aside from
 * what the host does. Returns nothing — outcomes are routed via toasts and
 * telemetry on the host.
 */
async function runAutoAttach(host, ctx, logger, telemetry) {
    const startTime = Date.now();
    const oneShotKey = oneShotMementoKey(ctx.applicationName);
    const oneShotPending = host.getMementoFlag(oneShotKey);
    // Always consume the one-shot flag — even on remote — so it does not leak
    // across subsequent deploys against a different cluster.
    if (oneShotPending) {
        await host.setMementoFlag(oneShotKey, undefined);
    }
    const setting = host.getSetting();
    const promptShownBefore = host.getMementoFlag(exports.PROMPT_SHOWN_KEY);
    const decision = decideAutoAttach({
        setting,
        clusterKind: ctx.clusterKind,
        oneShotPending,
        promptShownBefore
    });
    telemetry.event('extension.debug.autoAttach.decision', {
        setting,
        clusterKind: ctx.clusterKind,
        oneShot: oneShotPending,
        decision: decision.kind === 'prompt-then-decide' ? 'prompt' : decision.kind
    });
    if (decision.kind === 'skip') {
        if (ctx.clusterKind !== 'local') {
            logger.debug(`Auto-attach skipped — active cluster is ${ctx.clusterKind}; remote-cluster auto-attach is deferred to a future release.`);
            telemetry.event('extension.debug.autoAttach.result', {
                outcome: 'skipped-remote',
                attachedCount: 0,
                droppedCount: 0,
                clusterKind: ctx.clusterKind,
                durationMs: Date.now() - startTime
            });
        }
        return;
    }
    let attachThisTime = decision.kind === 'attach';
    if (decision.kind === 'prompt-then-decide') {
        const choice = await host.showFirstDeployPrompt();
        // Always remember we asked, regardless of the answer.
        await host.setMementoFlag(exports.PROMPT_SHOWN_KEY, true);
        const outcome = classifyFirstDeployPrompt(choice ?? 'never-this-time');
        if (outcome.settingUpdate) {
            try {
                await host.updateSetting(outcome.settingUpdate);
            }
            catch (err) {
                logger.warn(`Auto-attach: failed to persist setting '${outcome.settingUpdate}': ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        attachThisTime = outcome.attachThisTime;
        if (!attachThisTime)
            return;
    }
    if (!attachThisTime)
        return;
    // Pre-flight: debugger extension presence.
    const debuggerOk = await host.ensureDebuggerAvailable();
    if (!debuggerOk) {
        logger.warn('Auto-attach skipped — debugger pre-flight declined or failed.');
        telemetry.event('extension.debug.autoAttach.result', {
            outcome: 'preflight-declined',
            attachedCount: 0,
            droppedCount: 0,
            clusterKind: ctx.clusterKind,
            durationMs: Date.now() - startTime
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
            durationMs: Date.now() - startTime
        });
        const retryPick = await host.showWarning(`Auto-attach skipped — no service replica became Ready within ${Math.round(host.readyTimeoutMs / 1000)}s.`, 'Retry');
        if (retryPick === 'Retry') {
            // One re-run with a fresh poll budget. Avoids unbounded recursion.
            await runAutoAttach(host, ctx, logger, telemetry);
        }
        return;
    }
    // Resolve PIDs.
    let nodeNames = [];
    try {
        nodeNames = await host.getNodeNames();
    }
    catch (err) {
        logger.warn(`Auto-attach: failed to list nodes for PID resolution: ${err instanceof Error ? err.message : String(err)}`);
    }
    let codePkgs = [];
    try {
        codePkgs = await host.getDeployedCodePackages(ctx.applicationName, nodeNames);
    }
    catch (err) {
        logger.warn(`Auto-attach: failed to list deployed code packages: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { selected, droppedCount } = planAutoAttach(codePkgs, host.maxSessions);
    if (selected.length === 0) {
        host.showInfo('Auto-attach: no host processes were available to attach. Containers and Guest Executables do not expose a managed PID via the SF gateway.');
        telemetry.event('extension.debug.autoAttach.result', {
            outcome: 'no-eligible-pids',
            attachedCount: 0,
            droppedCount,
            clusterKind: ctx.clusterKind,
            durationMs: Date.now() - startTime
        });
        return;
    }
    let attachedCount = 0;
    for (const pkg of selected) {
        const config = (0, attachConfig_js_1.buildAttachConfig)(pkg, 'coreclr');
        logger.info(`Auto-attach: starting coreclr debugger against PID ${pkg.processId} (${pkg.serviceManifestName}/${pkg.codePackageName} on ${pkg.nodeName}).`);
        try {
            const ok = await host.startDebugging(config);
            if (ok)
                attachedCount++;
            else {
                logger.warn(`Auto-attach: vscode.debug.startDebugging returned false for PID ${pkg.processId} (${pkg.serviceManifestName}/${pkg.codePackageName}).`);
            }
        }
        catch (err) {
            logger.error(`Auto-attach: vscode.debug.startDebugging threw for PID ${pkg.processId} (${pkg.serviceManifestName}/${pkg.codePackageName})`, err);
        }
    }
    const total = selected.length;
    const droppedSuffix = droppedCount > 0
        ? ` (${droppedCount} additional host(s) skipped — raise serviceFabric.debug.autoAttachMaxSessions to include them.)`
        : '';
    if (attachedCount === total && total === 1) {
        const p = selected[0];
        host.showInfo(`Auto-attached debugger to ${p.serviceManifestName}/${p.codePackageName} (pid ${p.processId}).${droppedSuffix}`);
    }
    else if (attachedCount === total) {
        host.showInfo(`Auto-attached debugger to ${attachedCount} service(s) of ${ctx.applicationName}.${droppedSuffix}`);
    }
    else {
        const pick = await host.showWarning(`Auto-attached debugger to ${attachedCount} of ${total} service(s). See Service Fabric output channel for failures.${droppedSuffix}`, 'Open Output Channel');
        if (pick === 'Open Output Channel')
            host.showOutputChannel();
    }
    const outcome = attachedCount === total ? 'success' :
        attachedCount === 0 ? 'failed' :
            'partial';
    telemetry.event('extension.debug.autoAttach.result', {
        outcome,
        attachedCount,
        droppedCount,
        clusterKind: ctx.clusterKind,
        durationMs: Date.now() - startTime
    });
}
async function waitForAtLeastOneReadyReplica(host, appFullName) {
    const deadline = Date.now() + host.readyTimeoutMs;
    while (Date.now() < deadline) {
        let services = [];
        try {
            services = await host.listServices(appFullName);
        }
        catch {
            services = [];
        }
        if (services.length === 0) {
            await host.sleep(host.pollIntervalMs);
            continue;
        }
        let anyReady = false;
        for (const svc of services) {
            let replicas = [];
            try {
                replicas = await host.listReplicas(svc.id);
            }
            catch {
                replicas = [];
            }
            if (replicas.some(r => r.replicaStatus === 'Ready')) {
                anyReady = true;
                break;
            }
        }
        if (anyReady)
            return true;
        await host.sleep(host.pollIntervalMs);
    }
    return false;
}
//# sourceMappingURL=autoAttachState.js.map