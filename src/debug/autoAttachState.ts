// @ts-nocheck
import { buildAttachConfig } from './attachConfig';

function decideAutoAttach(e) {
	return e.clusterKind !== 'local'
		? {
				kind: 'skip',
			}
		: e.oneShotPending
			? {
					kind: 'attach',
				}
			: e.setting === 'localOnly'
				? {
						kind: 'attach',
					}
				: e.promptShownBefore
					? {
							kind: 'skip',
						}
					: {
							kind: 'prompt-then-decide',
						};
}

function planAutoAttach(e, t) {
	let r = e.filter((n) => typeof n.processId == 'number' && n.processId > 0);
	return r.length <= t
		? {
				selected: [...r],
				droppedCount: 0,
			}
		: {
				selected: r.slice(0, t),
				droppedCount: r.length - t,
			};
}

function classifyFirstDeployPrompt(e) {
	switch (e) {
		case 'attach-once-localOnly':
			return {
				settingUpdate: 'localOnly',
				attachThisTime: !0,
			};
		case 'never-this-time':
			return {
				settingUpdate: void 0,
				attachThisTime: !1,
			};
		case 'dont-ask-again':
			return {
				settingUpdate: 'never',
				attachThisTime: !1,
			};
	}
}

function oneShotMementoKey(e) {
	return `${ONE_SHOT_KEY_PREFIX}${e}`;
}

async function runAutoAttach(e, t, r, n) {
	let i = Date.now(),
		o = oneShotMementoKey(t.applicationName),
		s = e.getMementoFlag(o);
	s && (await e.setMementoFlag(o, void 0));
	let a = e.getSetting(),
		c = e.getMementoFlag(PROMPT_SHOWN_KEY),
		l = decideAutoAttach({
			setting: a,
			clusterKind: t.clusterKind,
			oneShotPending: s,
			promptShownBefore: c,
		});
	if (
		(n.event('extension.debug.autoAttach.decision', {
			setting: a,
			clusterKind: t.clusterKind,
			oneShot: s,
			decision: l.kind === 'prompt-then-decide' ? 'prompt' : l.kind,
		}),
		l.kind === 'skip')
	) {
		t.clusterKind !== 'local' &&
			(r.debug(
				`Auto-attach skipped \u2014 active cluster is ${t.clusterKind}; remote-cluster auto-attach is deferred to a future release.`,
			),
			n.event('extension.debug.autoAttach.result', {
				outcome: 'skipped-remote',
				attachedCount: 0,
				droppedCount: 0,
				clusterKind: t.clusterKind,
				durationMs: Date.now() - i,
			}));
		return;
	}
	let u = l.kind === 'attach';
	if (l.kind === 'prompt-then-decide') {
		let S = await e.showFirstDeployPrompt();
		await e.setMementoFlag(PROMPT_SHOWN_KEY, !0);
		let z = classifyFirstDeployPrompt(S ?? 'never-this-time');
		if (z.settingUpdate)
			try {
				await e.updateSetting(z.settingUpdate);
			} catch (O) {
				r.warn(`Auto-attach: failed to persist setting '${z.settingUpdate}': ${O instanceof Error ? O.message : String(O)}`);
			}
		if (((u = z.attachThisTime), !u)) return;
	}
	if (!u) return;
	if (!(await e.ensureDebuggerAvailable())) {
		(r.warn('Auto-attach skipped \u2014 debugger pre-flight declined or failed.'),
			n.event('extension.debug.autoAttach.result', {
				outcome: 'preflight-declined',
				attachedCount: 0,
				droppedCount: 0,
				clusterKind: t.clusterKind,
				durationMs: Date.now() - i,
			}));
		return;
	}
	if (!(await waitForAtLeastOneReadyReplica(e, t.applicationName))) {
		(r.warn(`Auto-attach skipped \u2014 no service replica became Ready within ${Math.round(e.readyTimeoutMs / 1e3)}s.`),
			n.event('extension.debug.autoAttach.result', {
				outcome: 'ready-timeout',
				attachedCount: 0,
				droppedCount: 0,
				clusterKind: t.clusterKind,
				durationMs: Date.now() - i,
			}),
			(await e.showWarning(
				`Auto-attach skipped \u2014 no service replica became Ready within ${Math.round(e.readyTimeoutMs / 1e3)}s.`,
				'Retry',
			)) === 'Retry' && (await runAutoAttach(e, t, r, n)));
		return;
	}
	let f = [];
	try {
		f = await e.getNodeNames();
	} catch (S) {
		r.warn(`Auto-attach: failed to list nodes for PID resolution: ${S instanceof Error ? S.message : String(S)}`);
	}
	let m = [];
	try {
		m = await e.getDeployedCodePackages(t.applicationName, f);
	} catch (S) {
		r.warn(`Auto-attach: failed to list deployed code packages: ${S instanceof Error ? S.message : String(S)}`);
	}
	let { selected: v, droppedCount: h } = planAutoAttach(m, e.maxSessions);
	if (v.length === 0) {
		(e.showInfo(
			'Auto-attach: no host processes were available to attach. Containers and Guest Executables do not expose a managed PID via the SF gateway.',
		),
			n.event('extension.debug.autoAttach.result', {
				outcome: 'no-eligible-pids',
				attachedCount: 0,
				droppedCount: h,
				clusterKind: t.clusterKind,
				durationMs: Date.now() - i,
			}));
		return;
	}
	let P = 0;
	for (let S of v) {
		let z = buildAttachConfig(S, 'coreclr');
		r.info(
			`Auto-attach: starting coreclr debugger against PID ${S.processId} (${S.serviceManifestName}/${S.codePackageName} on ${S.nodeName}).`,
		);
		try {
			(await e.startDebugging(z))
				? P++
				: r.warn(
						`Auto-attach: vscode.debug.startDebugging returned false for PID ${S.processId} (${S.serviceManifestName}/${S.codePackageName}).`,
					);
		} catch (O) {
			r.error(`Auto-attach: vscode.debug.startDebugging threw for PID ${S.processId} (${S.serviceManifestName}/${S.codePackageName})`, O);
		}
	}
	let g = v.length,
		w = h > 0 ? ` (${h} additional host(s) skipped \u2014 raise serviceFabric.debug.autoAttachMaxSessions to include them.)` : '';
	if (P === g && g === 1) {
		let S = v[0];
		e.showInfo(`Auto-attached debugger to ${S.serviceManifestName}/${S.codePackageName} (pid ${S.processId}).${w}`);
	} else
		P === g
			? e.showInfo(`Auto-attached debugger to ${P} service(s) of ${t.applicationName}.${w}`)
			: (await e.showWarning(
					`Auto-attached debugger to ${P} of ${g} service(s). See Service Fabric output channel for failures.${w}`,
					'Open Output Channel',
				)) === 'Open Output Channel' && e.showOutputChannel();
	let b = P === g ? 'success' : P === 0 ? 'failed' : 'partial';
	n.event('extension.debug.autoAttach.result', {
		outcome: b,
		attachedCount: P,
		droppedCount: h,
		clusterKind: t.clusterKind,
		durationMs: Date.now() - i,
	});
}

async function waitForAtLeastOneReadyReplica(e, t) {
	let r = Date.now() + e.readyTimeoutMs;
	for (; Date.now() < r;) {
		let n = [];
		try {
			n = await e.listServices(t);
		} catch {
			n = [];
		}
		if (n.length === 0) {
			await e.sleep(e.pollIntervalMs);
			continue;
		}
		let i = !1;
		for (let o of n) {
			let s = [];
			try {
				s = await e.listReplicas(o.id);
			} catch {
				s = [];
			}
			if (s.some((a) => a.replicaStatus === 'Ready')) {
				i = !0;
				break;
			}
		}
		if (i) return !0;
		await e.sleep(e.pollIntervalMs);
	}
	return !1;
}

let PROMPT_SHOWN_KEY, ONE_SHOT_KEY_PREFIX;

PROMPT_SHOWN_KEY = 'serviceFabric.debug.autoAttachPromptShown';

ONE_SHOT_KEY_PREFIX = 'serviceFabric.autoAttachNext:';

export { runAutoAttach };
