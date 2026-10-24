// @ts-nocheck

function buildAttachConfig(e, t) {
	return {
		type: t,
		name: `Attach: ${e.serviceManifestName}/${e.codePackageName} (pid ${e.processId})`,
		request: 'attach',
		processId: e.processId ?? 0,
		justMyCode: !0,
	};
}

export { buildAttachConfig };
