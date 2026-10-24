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
exports.readTextFile = readTextFile;
exports.pathExists = pathExists;
exports.listDirectories = listDirectories;
exports.listFiles = listFiles;
exports.resolveAgainst = resolveAgainst;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function readTextFile(p) {
    return fs.promises.readFile(p, 'utf8');
}
async function pathExists(p) {
    try {
        await fs.promises.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function listDirectories(p) {
    try {
        const entries = await fs.promises.readdir(p, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => path.join(p, e.name));
    }
    catch {
        return [];
    }
}
async function listFiles(p, ext) {
    try {
        const entries = await fs.promises.readdir(p, { withFileTypes: true });
        return entries
            .filter(e => e.isFile() && (!ext || e.name.toLowerCase().endsWith(ext.toLowerCase())))
            .map(e => path.join(p, e.name));
    }
    catch {
        return [];
    }
}
/** Resolve a possibly-relative path against a base, normalizing separators. */
function resolveAgainst(base, p) {
    if (path.isAbsolute(p))
        return path.normalize(p);
    return path.normalize(path.resolve(base, p.replace(/\\/g, path.sep)));
}
//# sourceMappingURL=fs.js.map