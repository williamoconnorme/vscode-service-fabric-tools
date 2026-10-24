"use strict";
/**
 * Pure helpers describing which debug-adapter extension a given Service Fabric
 * debug runtime needs, and computing whether the user can attach right now.
 *
 * Kept free of any `vscode` import so unit tests can exercise the logic
 * directly. The orchestrator in `attachToService.ts` injects an adapter that
 * binds these helpers to the live `vscode.extensions` / `process.platform`
 * APIs at runtime.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANCEL_BUTTON_LABEL = exports.MARKETPLACE_BUTTON_LABEL = exports.INSTALL_BUTTON_LABEL = void 0;
exports.requirementFor = requirementFor;
exports.checkAvailability = checkAvailability;
exports.classifyInstallPromptResult = classifyInstallPromptResult;
exports.formatExtensionMissingMessage = formatExtensionMissingMessage;
exports.formatPlatformBlockedMessage = formatPlatformBlockedMessage;
/**
 * Returns a fresh `DebuggerRequirement` for a given runtime. The result is a
 * new object each call so callers cannot mutate shared state.
 */
function requirementFor(runtime) {
    if (runtime === 'coreclr') {
        return {
            extensionId: 'ms-dotnettools.csharp',
            extensionName: 'C# (ms-dotnettools.csharp)'
        };
    }
    // clr — Windows-only, plus an advisory about VS Remote Debugger.
    return {
        extensionId: 'ms-dotnettools.csharp',
        extensionName: 'C# (ms-dotnettools.csharp)',
        platformRestricted: {
            allowedPlatform: 'win32',
            reason: '.NET Framework (clr) debugging is Windows-only.'
        },
        additionalAdvice: 'Native CLR debugging may also require the Visual Studio Remote Debugger components on the host running the service.'
    };
}
/**
 * Computes whether the user can attach right now. Platform restriction is
 * checked *before* extension presence so an unsupported platform produces a
 * `platform-blocked` result regardless of whether the extension happens to be
 * installed.
 */
function checkAvailability(runtime, host) {
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
function classifyInstallPromptResult(pick) {
    if (pick === exports.INSTALL_BUTTON_LABEL)
        return 'install';
    if (pick === exports.MARKETPLACE_BUTTON_LABEL)
        return 'marketplace';
    return 'cancel';
}
exports.INSTALL_BUTTON_LABEL = 'Install C# Extension';
exports.MARKETPLACE_BUTTON_LABEL = 'Open Marketplace';
exports.CANCEL_BUTTON_LABEL = 'Cancel';
/**
 * Builds the modal message a user sees when an extension is missing. Pure so
 * tests can pin the exact wording.
 */
function formatExtensionMissingMessage(runtime, requirement) {
    const runtimeLabel = runtime === 'coreclr' ? '.NET (coreclr)' : '.NET Framework (clr)';
    return `The ${requirement.extensionName} extension is required to attach the ${runtimeLabel} debugger.`;
}
/**
 * Builds the platform-blocked message. Adds a hint to switch runtime when the
 * user picked `clr` so they have a concrete recovery path.
 */
function formatPlatformBlockedMessage(runtime, reason) {
    if (runtime === 'clr') {
        return `${reason} Pick coreclr instead, or move to a Windows host.`;
    }
    return reason;
}
//# sourceMappingURL=debuggerAvailability.js.map