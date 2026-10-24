"use strict";
/**
 * Pure helpers for translating between Service Fabric's two endpoint flavors:
 *
 *  - **HTTP gateway endpoint** (`http(s)://host:19080`) — the REST surface used
 *    by every browser-style API call (`/$/GetClusterHealth`, `/Nodes`, ...).
 *    This is the URL the extension stores in `ClusterConnection.endpoint`.
 *
 *  - **Client TCP endpoint** (`host:19000`) — the binary protocol that the
 *    Service Fabric SDK PowerShell module's `Connect-ServiceFabricCluster`
 *    cmdlet expects via its `-ConnectionEndpoint` parameter.
 *
 * Pointing `Connect-ServiceFabricCluster` at the HTTP port (19080) produces
 * the error
 *   "Could not ping any of the provided Service Fabric gateway endpoints."
 * because the cmdlet's transient ping uses the binary protocol, which the
 * HTTP gateway does not speak.
 *
 * Default port mapping is per the standard Service Fabric local-cluster
 * configuration; both ports are configurable per cluster manifest, but the
 * 19080→19000 swap covers every default install (DevCluster, Azure SF
 * managed cluster, standalone) we've encountered.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpGatewayToClientEndpoint = httpGatewayToClientEndpoint;
const HTTP_GATEWAY_PORT = 19080;
const CLIENT_TCP_PORT = 19000;
/**
 * Convert a Service Fabric HTTP gateway URL into the matching client TCP
 * `host:port` string accepted by `Connect-ServiceFabricCluster -ConnectionEndpoint`.
 *
 * Rules:
 *  - `http://host:19080` → `host:19000` (default swap).
 *  - `https://host:19080` → `host:19000` (scheme is dropped; secured-cluster
 *    clients pass certificate parameters separately).
 *  - When the input port is anything other than the default HTTP gateway
 *    port the value is returned verbatim (as `host:port`) — operators with
 *    a custom port configuration are responsible for matching it themselves
 *    via `serviceFabric.localCluster.endpoint`.
 *  - Trailing slashes and paths are stripped.
 *  - Throws when the input cannot be parsed as a URL with an explicit host,
 *    so callers surface a clear error instead of dispatching to PowerShell
 *    with a malformed endpoint.
 */
function httpGatewayToClientEndpoint(httpUrl) {
    if (!httpUrl || typeof httpUrl !== 'string') {
        throw new Error(`Invalid Service Fabric endpoint: ${JSON.stringify(httpUrl)}`);
    }
    let u;
    try {
        u = new URL(httpUrl.trim());
    }
    catch {
        throw new Error(`Invalid Service Fabric endpoint: '${httpUrl}'. Expected an http(s) URL like 'http://localhost:19080'.`);
    }
    if (!u.hostname) {
        throw new Error(`Invalid Service Fabric endpoint: '${httpUrl}' has no host.`);
    }
    const portStr = u.port || (u.protocol === 'https:' ? '443' : '80');
    const port = Number.parseInt(portStr, 10);
    const clientPort = port === HTTP_GATEWAY_PORT ? CLIENT_TCP_PORT : port;
    return `${u.hostname}:${clientPort}`;
}
//# sourceMappingURL=clusterEndpoints.js.map