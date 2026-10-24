// @ts-nocheck

function requirementFor(e) {
	return e === 'coreclr'
		? {
				extensionId: 'ms-dotnettools.csharp',
				extensionName: 'C# (ms-dotnettools.csharp)',
			}
		: {
				extensionId: 'ms-dotnettools.csharp',
				extensionName: 'C# (ms-dotnettools.csharp)',
				platformRestricted: {
					allowedPlatform: 'win32',
					reason: '.NET Framework (clr) debugging is Windows-only.',
				},
				additionalAdvice:
					'Native CLR debugging may also require the Visual Studio Remote Debugger components on the host running the service.',
			};
}

function checkAvailability(e, t) {
	let r = requirementFor(e);
	return r.platformRestricted && t.platform !== r.platformRestricted.allowedPlatform
		? {
				kind: 'platform-blocked',
				reason: r.platformRestricted.reason,
			}
		: t.isExtensionInstalled(r.extensionId)
			? {
					kind: 'available',
				}
			: {
					kind: 'extension-missing',
					requirement: r,
				};
}

function classifyInstallPromptResult(e) {
	return e === INSTALL_BUTTON_LABEL ? 'install' : e === MARKETPLACE_BUTTON_LABEL ? 'marketplace' : 'cancel';
}

function formatExtensionMissingMessage(e, t) {
	let r = e === 'coreclr' ? '.NET (coreclr)' : '.NET Framework (clr)';
	return `The ${t.extensionName} extension is required to attach the ${r} debugger.`;
}

function formatPlatformBlockedMessage(e, t) {
	return e === 'clr' ? `${t} Pick coreclr instead, or move to a Windows host.` : t;
}

let INSTALL_BUTTON_LABEL, MARKETPLACE_BUTTON_LABEL, CANCEL_BUTTON_LABEL;

INSTALL_BUTTON_LABEL = 'Install C# Extension';

MARKETPLACE_BUTTON_LABEL = 'Open Marketplace';

CANCEL_BUTTON_LABEL = 'Cancel';

export {
	CANCEL_BUTTON_LABEL,
	INSTALL_BUTTON_LABEL,
	MARKETPLACE_BUTTON_LABEL,
	checkAvailability,
	classifyInstallPromptResult,
	formatExtensionMissingMessage,
	formatPlatformBlockedMessage,
};
