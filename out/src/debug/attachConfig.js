"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAttachConfig = buildAttachConfig;
function buildAttachConfig(pkg, debugType) {
    return {
        type: debugType,
        name: `Attach: ${pkg.serviceManifestName}/${pkg.codePackageName} (pid ${pkg.processId})`,
        request: 'attach',
        processId: pkg.processId ?? 0,
        justMyCode: true
    };
}
//# sourceMappingURL=attachConfig.js.map