/**
 * In-flight prompt offering to enable the Tier-2 MSBuild property evaluator
 * (`serviceFabric.deploy.useMsbuildPropertyEvaluator`) when Tier-1 expansion
 * leaves `$(Property)` tokens unresolved in the package-path candidates.
 *
 * Kept free of any `vscode` import: the Publish command injects a host that
 * binds the prompt, setting reads/writes and logger.
 */

/** Button labels, in display order. */
export const TIER2_PROMPT_BUTTONS = ['Use for this Publish', 'Always use (save setting)'];

/**
 * Prefix of the per-project Memento keys the 1.1.10 prompt wrote to suppress
 * itself. No longer written; kept so the legacy-cleanup command can find them.
 */
export const TIER2_PROMPT_SUPPRESS_KEY_PREFIX = 'serviceFabric.deploy.tier2PromptSuppressedFor:';

export type Tier2PromptDecision = 'use-once' | 'use-persist' | 'cancel';

export type Tier2PromptOutcome = 'suppressed-setting' | 'use-once' | 'use-persist' | 'persist-failed' | 'cancelled';

export interface Tier2PromptResult {
	/** Run the Tier-2 MSBuild evaluator for this Publish. */
	useEvaluator: boolean;
	/** The user cancelled; abort the Publish. */
	cancelled: boolean;
	outcome: Tier2PromptOutcome;
}

export interface Tier2PromptLogger {
	info(message: string): void;
	warn(message: string): void;
}

export interface Tier2PromptHost {
	isPromptSuppressedBySetting(): boolean;
	/** Shows the modal; resolves with the chosen button label, or `undefined` when dismissed. */
	showPrompt(message: string, buttons: readonly string[]): Promise<string | undefined>;
	persistEvaluatorSetting(): Promise<void>;
	logger: Tier2PromptLogger;
}

export interface Tier2PromptRequest {
	sfprojPath: string;
	unresolvedTokens: ReadonlySet<string>;
}

export function resolveTier2PromptDecision(pick: string | undefined): Tier2PromptDecision {
	switch (pick) {
		case 'Use for this Publish':
			return 'use-once';
		case 'Always use (save setting)':
			return 'use-persist';
		default:
			return 'cancel';
	}
}

/** Legacy per-project suppression key; the path is case-folded on Windows. */
export function tier2SuppressKey(sfprojPath: string, platform: NodeJS.Platform = process.platform): string {
	const normalized = platform === 'win32' ? sfprojPath.toLowerCase() : sfprojPath;
	return `${TIER2_PROMPT_SUPPRESS_KEY_PREFIX}${normalized}`;
}

/** Builds the modal text, naming at most three unresolved tokens. */
export function buildTier2PromptMessage(unresolvedTokens: Iterable<string>): { message: string; sampleText: string } {
	const tokens = [...unresolvedTokens];
	const shown = tokens.slice(0, 3).map((token) => `$(${token})`);
	const remaining = tokens.length - shown.length;
	const sampleText = shown.join(', ') + (remaining > 0 ? ` (+${remaining} more)` : '');
	return {
		message: `The .sfproj's package paths reference MSBuild properties that aren't declared in the project itself (${sampleText}). These typically come from Directory.Build.props or imported .targets files.

Enable MSBuild property evaluation (serviceFabric.deploy.useMsbuildPropertyEvaluator) so this Publish can resolve them by spawning MSBuild?

Cancel to abort this Publish; you can also set serviceFabric.deploy.packagePath directly to the package folder.`,
		sampleText,
	};
}

export async function runTier2Prompt(host: Tier2PromptHost, request: Tier2PromptRequest): Promise<Tier2PromptResult> {
	if (host.isPromptSuppressedBySetting()) {
		host.logger.info('Tier 2 prompt suppressed by serviceFabric.deploy.suppressMsbuildEvaluatorPrompt.');
		return { useEvaluator: false, cancelled: false, outcome: 'suppressed-setting' };
	}
	// Log the full token list before prompting so support transcripts carry the diagnostic.
	host.logger.info(
		`Unresolved MSBuild properties in package-path candidates: ${[...request.unresolvedTokens].map((token) => `$(${token})`).join(', ')}.`,
	);
	const { message } = buildTier2PromptMessage(request.unresolvedTokens);
	const pick = await host.showPrompt(message, TIER2_PROMPT_BUTTONS);
	switch (resolveTier2PromptDecision(pick)) {
		case 'use-once':
			host.logger.info('Tier 2 enabled for this Publish (user choice; setting not persisted).');
			return { useEvaluator: true, cancelled: false, outcome: 'use-once' };
		case 'use-persist':
			try {
				await host.persistEvaluatorSetting();
				host.logger.info('Tier 2 enabled and persisted to workspace settings.');
				return { useEvaluator: true, cancelled: false, outcome: 'use-persist' };
			} catch (err) {
				host.logger.warn(
					`Could not persist serviceFabric.deploy.useMsbuildPropertyEvaluator=true (${err instanceof Error ? err.message : String(err)}). Tier 2 still enabled for this Publish.`,
				);
				return { useEvaluator: true, cancelled: false, outcome: 'persist-failed' };
			}
		case 'cancel':
			host.logger.info('Publish cancelled by user — declined MSBuild property evaluator prompt.');
			return { useEvaluator: false, cancelled: true, outcome: 'cancelled' };
	}
}
