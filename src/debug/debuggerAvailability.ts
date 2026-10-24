/**
 * Pure helpers describing which debug-adapter extension a given Service Fabric
 * debug runtime needs, and computing whether the user can attach right now.
 *
 * Kept free of any `vscode` import so unit tests can exercise the logic
 * directly. The orchestrator in `attachCommand.ts` injects an adapter that
 * binds these helpers to the live `vscode.extensions` / `process.platform`
 * APIs at runtime.
 */

/** Debug runtime a Service Fabric attach session can target. */
export type DebugRuntime = 'coreclr' | 'clr';

/** The debug-adapter extension (and platform constraints) a runtime needs. */
export interface DebuggerRequirement {
	extensionId: string;
	extensionName: string;
	platformRestricted?: {
		allowedPlatform: NodeJS.Platform;
		reason: string;
	};
	additionalAdvice?: string;
}

/** Live facts about the host, injected so the check stays pure. */
export interface AvailabilityHost {
	platform: NodeJS.Platform;
	isExtensionInstalled(extensionId: string): boolean;
}

export type AvailabilityResult =
	{ kind: 'available' } | { kind: 'platform-blocked'; reason: string } | { kind: 'extension-missing'; requirement: DebuggerRequirement };

export type InstallPromptChoice = 'install' | 'marketplace' | 'cancel';

/**
 * Returns a fresh `DebuggerRequirement` for a given runtime. The result is a
 * new object each call so callers cannot mutate shared state.
 */
export function requirementFor(runtime: DebugRuntime): DebuggerRequirement {
	if (runtime === 'coreclr') {
		return {
			extensionId: 'ms-dotnettools.csharp',
			extensionName: 'C# (ms-dotnettools.csharp)',
		};
	}
	// clr — Windows-only, plus an advisory about VS Remote Debugger.
	return {
		extensionId: 'ms-dotnettools.csharp',
		extensionName: 'C# (ms-dotnettools.csharp)',
		platformRestricted: {
			allowedPlatform: 'win32',
			reason: '.NET Framework (clr) debugging is Windows-only.',
		},
		additionalAdvice: 'Native CLR debugging may also require the Visual Studio Remote Debugger components on the host running the service.',
	};
}

/**
 * Computes whether the user can attach right now. Platform restriction is
 * checked *before* extension presence so an unsupported platform produces a
 * `platform-blocked` result regardless of whether the extension happens to be
 * installed.
 */
export function checkAvailability(runtime: DebugRuntime, host: AvailabilityHost): AvailabilityResult {
	const requirement = requirementFor(runtime);
	if (requirement.platformRestricted && host.platform !== requirement.platformRestricted.allowedPlatform) {
		return { kind: 'platform-blocked', reason: requirement.platformRestricted.reason };
	}
	if (!host.isExtensionInstalled(requirement.extensionId)) {
		return { kind: 'extension-missing', requirement };
	}
	return { kind: 'available' };
}

/**
 * Maps a button label returned by `vscode.window.showErrorMessage` (or
 * `undefined` when the modal was dismissed) to a stable `InstallPromptChoice`.
 * Centralizing this means the orchestrator and the tests agree on which
 * button label means what.
 */
export function classifyInstallPromptResult(pick: string | undefined): InstallPromptChoice {
	if (pick === INSTALL_BUTTON_LABEL) return 'install';
	if (pick === MARKETPLACE_BUTTON_LABEL) return 'marketplace';
	return 'cancel';
}

export const INSTALL_BUTTON_LABEL = 'Install C# Extension';
export const MARKETPLACE_BUTTON_LABEL = 'Open Marketplace';
export const CANCEL_BUTTON_LABEL = 'Cancel';

/**
 * Builds the modal message a user sees when an extension is missing. Pure so
 * tests can pin the exact wording.
 */
export function formatExtensionMissingMessage(runtime: DebugRuntime, requirement: DebuggerRequirement): string {
	const runtimeLabel = runtime === 'coreclr' ? '.NET (coreclr)' : '.NET Framework (clr)';
	return `The ${requirement.extensionName} extension is required to attach the ${runtimeLabel} debugger.`;
}

/**
 * Builds the platform-blocked message. Adds a hint to switch runtime when the
 * user picked `clr` so they have a concrete recovery path.
 */
export function formatPlatformBlockedMessage(runtime: DebugRuntime, reason: string): string {
	if (runtime === 'clr') {
		return `${reason} Pick coreclr instead, or move to a Windows host.`;
	}
	return reason;
}
