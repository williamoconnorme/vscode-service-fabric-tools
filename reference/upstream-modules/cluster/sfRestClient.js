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
exports.SfRestClient = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url_1 = require("url");
/**
 * Minimal Service Fabric HTTP gateway client.
 * Uses native http/https — no external deps.
 *
 * For HTTPS clusters (X.509/AAD) the caller would need to inject TLS options;
 * the local dev cluster runs on http://localhost:19080 by default which makes
 * an immediate end-to-end smoke test trivial.
 */
class SfRestClient {
    endpoint;
    apiVersion = '6.0';
    constructor(endpoint) {
        this.endpoint = endpoint;
    }
    async getClusterHealth(timeoutMs = 5000) {
        const json = await this.get('/$/GetClusterHealth', timeoutMs);
        return { aggregatedHealthState: String(json?.AggregatedHealthState ?? 'Unknown') };
    }
    async getNodes(timeoutMs = 5000) {
        const json = await this.get('/Nodes', timeoutMs);
        const items = (json?.Items ?? []);
        return items.map(n => ({
            name: String(n?.Name ?? ''),
            status: String(n?.NodeStatus ?? ''),
            healthState: String(n?.HealthState ?? ''),
            nodeType: String(n?.Type ?? '')
        }));
    }
    async getDeployedApplications(timeoutMs = 5000) {
        // ApplicationsList endpoint.
        const json = await this.get('/Applications/', timeoutMs);
        const items = (json?.Items ?? []);
        return items.map(it => ({
            name: String(it?.Name ?? '').replace(/^fabric:\//, ''),
            typeName: String(it?.TypeName ?? ''),
            typeVersion: String(it?.TypeVersion ?? ''),
            status: String(it?.Status ?? '')
        }));
    }
    /**
     * Lists nodes that currently host any replica/instance of the given application.
     */
    async getApplicationNodes(applicationName, timeoutMs = 5000) {
        const appId = encodeURIComponent(applicationName.replace(/^fabric:\//, ''));
        const json = await this.get(`/Applications/${appId}/$/GetServices`, timeoutMs);
        const services = (json?.Items ?? []);
        const nodeNames = new Set();
        for (const svc of services) {
            const svcId = encodeURIComponent(String(svc?.Id ?? ''));
            if (!svcId)
                continue;
            const partitions = await this.get(`/Services/${svcId}/$/GetPartitions`, timeoutMs).catch(() => ({ Items: [] }));
            for (const part of (partitions?.Items ?? [])) {
                const partId = encodeURIComponent(String(part?.PartitionInformation?.Id ?? ''));
                if (!partId)
                    continue;
                const replicas = await this.get(`/Partitions/${partId}/$/GetReplicas`, timeoutMs).catch(() => ({ Items: [] }));
                for (const r of (replicas?.Items ?? [])) {
                    if (r?.NodeName)
                        nodeNames.add(String(r.NodeName));
                }
            }
        }
        return Array.from(nodeNames);
    }
    /**
     * Lists the services that belong to a deployed application.
     *
     * Wraps `/Applications/{id}/$/GetServices`. Returns the URL-encoded service
     * `Id` (needed for partition lookups) and the originating `ServiceManifestName`.
     * Used by the post-Publish auto-attach orchestrator to wait for a
     * `Ready` replica before resolving PIDs.
     */
    async listServices(applicationName, timeoutMs = 5000) {
        const appId = encodeURIComponent(applicationName.replace(/^fabric:\//, ''));
        const json = await this.get(`/Applications/${appId}/$/GetServices`, timeoutMs);
        const items = (json?.Items ?? []);
        return items.map(svc => ({
            id: encodeURIComponent(String(svc?.Id ?? '')),
            manifestName: String(svc?.ServiceManifestName ?? svc?.TypeName ?? '')
        }));
    }
    /**
     * Walks `GetPartitions` → `GetReplicas` for a single service and returns
     * the flattened replica list.
     *
     * `serviceId` must already be URL-encoded (as returned by `listServices`).
     */
    async listReplicas(serviceId, timeoutMs = 5000) {
        const partitions = await this.get(`/Services/${serviceId}/$/GetPartitions`, timeoutMs).catch(() => ({ Items: [] }));
        const out = [];
        for (const part of (partitions?.Items ?? [])) {
            const partId = encodeURIComponent(String(part?.PartitionInformation?.Id ?? ''));
            if (!partId)
                continue;
            const replicas = await this.get(`/Partitions/${partId}/$/GetReplicas`, timeoutMs).catch(() => ({ Items: [] }));
            for (const r of (replicas?.Items ?? [])) {
                out.push({
                    replicaStatus: String(r?.ReplicaStatus ?? ''),
                    nodeName: String(r?.NodeName ?? '')
                });
            }
        }
        return out;
    }
    /**
     * Returns deployed code packages (with PID when available) for an application
     * across the supplied list of node names.
     */
    async getDeployedCodePackages(applicationName, nodeNames, timeoutMs = 5000) {
        const appId = applicationName.replace(/^fabric:\//, '');
        const out = [];
        for (const node of nodeNames) {
            const url = `/Nodes/${encodeURIComponent(node)}/$/GetApplications/${encodeURIComponent(appId)}/$/GetCodePackages`;
            // GetCodePackages returns a bare JSON array (no Items envelope).
            const raw = await this.get(url, timeoutMs).catch(() => undefined);
            const items = Array.isArray(raw) ? raw : Array.isArray(raw?.Items) ? raw.Items : [];
            for (const cp of items) {
                const rawPid = cp?.MainEntryPoint?.ProcessId ?? cp?.SetupEntryPoint?.ProcessId;
                const entryPid = Number(rawPid);
                out.push({
                    nodeName: node,
                    serviceManifestName: String(cp?.ServiceManifestName ?? ''),
                    codePackageName: String(cp?.Name ?? ''),
                    codePackageVersion: String(cp?.Version ?? ''),
                    status: String(cp?.Status ?? cp?.HostType ?? ''),
                    entryPointStatus: String(cp?.MainEntryPoint?.Status ?? cp?.MainEntryPoint?.EntryPointStatus ?? ''),
                    processId: Number.isFinite(entryPid) && entryPid > 0 ? entryPid : undefined,
                    hostType: String(cp?.HostType ?? '')
                });
            }
        }
        return out;
    }
    /**
     * Issues a raw GET against the cluster gateway. Path may contain query.
     * Used by webviews and other callers that need ad-hoc endpoints
     * (e.g. `/EventsStore/Cluster/Events?StartTimeUtc=…`).
     */
    rawGet(pathAndQuery, timeoutMs = 5000) {
        return this.get(pathAndQuery, timeoutMs);
    }
    get(pathAndQuery, timeoutMs) {
        const sep = pathAndQuery.includes('?') ? '&' : '?';
        const url = new url_1.URL(`${this.endpoint}${pathAndQuery}${sep}api-version=${this.apiVersion}`);
        const lib = url.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const req = lib.request({
                method: 'GET',
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                headers: { Accept: 'application/json' },
                timeout: timeoutMs
            }, res => {
                const chunks = [];
                res.on('data', c => chunks.push(Buffer.from(c)));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    if (!res.statusCode || res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode} from ${url.href}: ${body}`));
                        return;
                    }
                    try {
                        resolve(body ? JSON.parse(body) : undefined);
                    }
                    catch (err) {
                        reject(err);
                    }
                });
            });
            req.on('error', err => reject(wrapError(err, url.href)));
            req.on('timeout', () => req.destroy(new Error(`Request to ${url.href} timed out after ${timeoutMs}ms`)));
            req.end();
        });
    }
}
exports.SfRestClient = SfRestClient;
function wrapError(err, url) {
    if (err instanceof Error) {
        const code = err.code;
        const msg = err.message || code || 'unknown error';
        return new Error(`Request to ${url} failed: ${msg}${code && !err.message?.includes(code) ? ` (${code})` : ''}`);
    }
    return new Error(`Request to ${url} failed: ${String(err)}`);
}
//# sourceMappingURL=sfRestClient.js.map