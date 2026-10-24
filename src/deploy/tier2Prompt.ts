// @ts-nocheck

function resolveTier2PromptDecision(e) {
	switch (e) {
		case 'Use for this Publish':
			return 'use-once';
		case 'Always use (save setting)':
			return 'use-persist';
		default:
			return 'cancel';
	}
}

function tier2SuppressKey(e, t = process.platform) {
	let r = t === 'win32' ? e.toLowerCase() : e;
	return `${TIER2_PROMPT_SUPPRESS_KEY_PREFIX}${r}`;
}

function buildTier2PromptMessage(e) {
	let t = [...e],
		r = t.slice(0, 3).map((s) => `$(${s})`),
		n = t.length - r.length,
		i = r.join(', ') + (n > 0 ? ` (+${n} more)` : '');
	return {
		message: `The .sfproj's package paths reference MSBuild properties that aren't declared in the project itself (${i}). These typically come from Directory.Build.props or imported .targets files.

Enable MSBuild property evaluation (serviceFabric.deploy.useMsbuildPropertyEvaluator) so this Publish can resolve them by spawning MSBuild?

Cancel to abort this Publish; you can also set serviceFabric.deploy.packagePath directly to the package folder.`,
		sampleText: i,
	};
}

async function runTier2Prompt(e, t) {
	if (e.isPromptSuppressedBySetting())
		return (
			e.logger.info('Tier 2 prompt suppressed by serviceFabric.deploy.suppressMsbuildEvaluatorPrompt.'),
			{
				useEvaluator: !1,
				cancelled: !1,
				outcome: 'suppressed-setting',
			}
		);
	e.logger.info(`Unresolved MSBuild properties in package-path candidates: ${[...t.unresolvedTokens].map((o) => `$(${o})`).join(', ')}.`);
	let { message: r } = buildTier2PromptMessage(t.unresolvedTokens),
		n = await e.showPrompt(r, TIER2_PROMPT_BUTTONS);
	switch (resolveTier2PromptDecision(n)) {
		case 'use-once':
			return (
				e.logger.info('Tier 2 enabled for this Publish (user choice; setting not persisted).'),
				{
					useEvaluator: !0,
					cancelled: !1,
					outcome: 'use-once',
				}
			);
		case 'use-persist':
			try {
				return (
					await e.persistEvaluatorSetting(),
					e.logger.info('Tier 2 enabled and persisted to workspace settings.'),
					{
						useEvaluator: !0,
						cancelled: !1,
						outcome: 'use-persist',
					}
				);
			} catch (o) {
				return (
					e.logger.warn(
						`Could not persist serviceFabric.deploy.useMsbuildPropertyEvaluator=true (${o instanceof Error ? o.message : String(o)}). Tier 2 still enabled for this Publish.`,
					),
					{
						useEvaluator: !0,
						cancelled: !1,
						outcome: 'persist-failed',
					}
				);
			}
		case 'cancel':
			return (
				e.logger.info('Publish cancelled by user \u2014 declined MSBuild property evaluator prompt.'),
				{
					useEvaluator: !1,
					cancelled: !0,
					outcome: 'cancelled',
				}
			);
	}
}

let TIER2_PROMPT_SUPPRESS_KEY_PREFIX, TIER2_PROMPT_BUTTONS;

TIER2_PROMPT_SUPPRESS_KEY_PREFIX = 'serviceFabric.deploy.tier2PromptSuppressedFor:';

TIER2_PROMPT_BUTTONS = ['Use for this Publish', 'Always use (save setting)'];

export {
	TIER2_PROMPT_BUTTONS,
	TIER2_PROMPT_SUPPRESS_KEY_PREFIX,
	buildTier2PromptMessage,
	resolveTier2PromptDecision,
	runTier2Prompt,
	tier2SuppressKey,
};
