// @ts-nocheck

var PARAM_RE = /<Parameter\b[^>]*\bName\s*=\s*"([^"]+)"[^>]*\bValue\s*=\s*"([^"]*)"[^>]*\/?>/gi,
	PARAM_RE_VALUE_FIRST = /<Parameter\b[^>]*\bValue\s*=\s*"([^"]*)"[^>]*\bName\s*=\s*"([^"]+)"[^>]*\/?>/gi;

function parseApplicationParameterFile(e) {
	let t = {};
	PARAM_RE.lastIndex = 0;
	let r;
	for (; (r = PARAM_RE.exec(e)) !== null;) t[r[1]] = r[2];
	for (PARAM_RE_VALUE_FIRST.lastIndex = 0; (r = PARAM_RE_VALUE_FIRST.exec(e)) !== null;) r[2] in t || (t[r[2]] = r[1]);
	return t;
}

function toPowerShellHashtableLiteral(e) {
	let t = Object.keys(e);
	return t.length === 0 ? '@{}' : `@{ ${t.map((n) => `'${escape(n)}' = '${escape(e[n])}'`).join('; ')} }`;
}

function escape(e) {
	return e.replace(/'/g, "''");
}

function buildDeployWrapper(e = {}) {
	let t = [
			"$ErrorActionPreference = 'Stop'",
			'try {',
			'    Import-Module ServiceFabric -Global -ErrorAction Stop',
			'} catch {',
			`    throw "The 'ServiceFabric' PowerShell module isn't available. Install the Service Fabric SDK and restart VS Code so it picks up the updated PSModulePath. Inner error: $($_.Exception.Message)"`,
			'}',
			'$splat = @{',
			'    ApplicationPackagePath = $PackagePath',
			'    PublishProfileFile = $PublishProfile',
			'}',
		],
		r = e.applicationParameter;
	return (
		r && Object.keys(r).length > 0 && t.push(`$splat['ApplicationParameter'] = ${toPowerShellHashtableLiteral(r)}`),
		e.startupServicesFile && e.startupServicesFile.trim().length > 0 && t.push("$splat['StartupServicesFile'] = $StartupServicesFile"),
		t.push('. $DeployScript @splat'),
		t.join(`
`)
	);
}

var CONNECTION_ENDPOINT_RE = /<ClusterConnectionParameters\b([^>]*)>/i,
	ATTR_RE = (e) => new RegExp(`\\b${e}\\s*=\\s*"([^"]*)"`, 'i');

function parsePublishProfile(e) {
	let t = extractPathAttr(e, 'ApplicationParameterFile'),
		r = extractPathAttr(e, 'StartupServiceParameterFile'),
		n = CONNECTION_ENDPOINT_RE.exec(e);
	if (!n)
		return {
			isLocal: !0,
			httpGatewayUrl: 'http://localhost:19080',
			applicationParameterFile: t,
			startupServiceParameterFile: r,
		};
	let i = n[1] ?? '',
		s = ATTR_RE('ConnectionEndpoint').exec(i)?.[1]?.trim();
	if (!s)
		return {
			isLocal: !0,
			httpGatewayUrl: 'http://localhost:19080',
			applicationParameterFile: t,
			startupServiceParameterFile: r,
		};
	let a = inferHttpGateway(s, i);
	return {
		isLocal: !1,
		connectionEndpoint: s,
		httpGatewayUrl: a,
		applicationParameterFile: t,
		startupServiceParameterFile: r,
	};
}

function extractPathAttr(e, t) {
	let n = new RegExp(`<${t}\\b([^>]*)/?>`, 'i').exec(e);
	if (!n) return;
	let i = n[1] ?? '',
		s = ATTR_RE('Path').exec(i)?.[1]?.trim();
	return s && s.length > 0 ? s : void 0;
}

function inferHttpGateway(e, t) {
	if (/^https?:\/\//i.test(e))
		try {
			return new URL(e).toString().replace(/\/$/, '');
		} catch {
			return;
		}
	let r = /^([^:\s]+):(\d+)$/.exec(e);
	if (!r) return;
	let n = r[1];
	return `${/\bX509Credential\s*=\s*"true"/i.test(t) || /\bAadCredential\s*=\s*"true"/i.test(t) ? 'https' : 'http'}://${n}:19080`;
}

var CONNECTION_ERROR_PATTERNS = [
	/Cluster connection instance is null/i,
	/FabricObjectClosedException/i,
	/Service Fabric cluster may not be connected/i,
	/Could not ping any of the provided Service Fabric gateway endpoints/i,
];

function detectClusterConnectionFailure(e) {
	for (let t of CONNECTION_ERROR_PATTERNS)
		if (t.test(e))
			return "The deploy script could not reach the Service Fabric cluster. For local profiles, start the dev cluster first (Service Fabric: Start Local Cluster). For remote profiles, verify the publish profile's ClusterConnectionParameters and certificate settings.";
}

export { buildDeployWrapper, detectClusterConnectionFailure, parseApplicationParameterFile, parsePublishProfile };
