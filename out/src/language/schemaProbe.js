"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SCHEMA_PROBE = exports.SERVICE_FABRIC_SCHEMA_FILE = void 0;
exports.findServiceFabricSchema = findServiceFabricSchema;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
exports.SERVICE_FABRIC_SCHEMA_FILE = 'ServiceFabricServiceModel.xsd';
exports.DEFAULT_SCHEMA_PROBE = [
    'C:\\Program Files\\Microsoft SDKs\\Service Fabric\\schemas',
    'C:\\Program Files (x86)\\Microsoft SDKs\\Service Fabric\\schemas',
    'C:\\Program Files\\Microsoft Service Fabric\\bin\\Fabric\\Fabric.Code'
];
function findServiceFabricSchema(opts = {}) {
    const exists = opts.exists ?? ((p) => fs.existsSync(p));
    const candidates = [];
    if (opts.override && opts.override.trim().length > 0) {
        const o = opts.override.trim();
        if (o.toLowerCase().endsWith('.xsd')) {
            candidates.push(o);
        }
        else {
            candidates.push(path.join(o, exports.SERVICE_FABRIC_SCHEMA_FILE));
        }
    }
    for (const probe of opts.probe ?? exports.DEFAULT_SCHEMA_PROBE) {
        if (probe.toLowerCase().endsWith('.xsd')) {
            candidates.push(probe);
        }
        else {
            candidates.push(path.join(probe, exports.SERVICE_FABRIC_SCHEMA_FILE));
        }
    }
    for (const c of candidates) {
        if (exists(c))
            return c;
    }
    return undefined;
}
//# sourceMappingURL=schemaProbe.js.map