// @ts-nocheck
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

function wrapError(e, t) {
	if (e instanceof Error) {
		let r = e.code,
			n = e.message || r || 'unknown error';
		return new Error(`Request to ${t} failed: ${n}${r && !e.message?.includes(r) ? ` (${r})` : ''}`);
	}
	return new Error(`Request to ${t} failed: ${String(e)}`);
}

let SfRestClient;

SfRestClient = class {
	constructor(t) {
		this.endpoint = t;
	}
	apiVersion = '6.0';
	async getClusterHealth(t = 5e3) {
		let r = await this.get('/$/GetClusterHealth', t);
		return {
			aggregatedHealthState: String(r?.AggregatedHealthState ?? 'Unknown'),
		};
	}
	async getNodes(t = 5e3) {
		return ((await this.get('/Nodes', t))?.Items ?? []).map((i) => ({
			name: String(i?.Name ?? ''),
			status: String(i?.NodeStatus ?? ''),
			healthState: String(i?.HealthState ?? ''),
			nodeType: String(i?.Type ?? ''),
		}));
	}
	async getDeployedApplications(t = 5e3) {
		return ((await this.get('/Applications/', t))?.Items ?? []).map((i) => ({
			name: String(i?.Name ?? '').replace(/^fabric:\//, ''),
			typeName: String(i?.TypeName ?? ''),
			typeVersion: String(i?.TypeVersion ?? ''),
			status: String(i?.Status ?? ''),
		}));
	}
	async getApplicationNodes(t, r = 5e3) {
		let n = encodeURIComponent(t.replace(/^fabric:\//, '')),
			o = (await this.get(`/Applications/${n}/$/GetServices`, r))?.Items ?? [],
			s = new Set();
		for (let a of o) {
			let c = encodeURIComponent(String(a?.Id ?? ''));
			if (!c) continue;
			let l = await this.get(`/Services/${c}/$/GetPartitions`, r).catch(() => ({
				Items: [],
			}));
			for (let u of l?.Items ?? []) {
				let p = encodeURIComponent(String(u?.PartitionInformation?.Id ?? ''));
				if (!p) continue;
				let d = await this.get(`/Partitions/${p}/$/GetReplicas`, r).catch(() => ({
					Items: [],
				}));
				for (let f of d?.Items ?? []) f?.NodeName && s.add(String(f.NodeName));
			}
		}
		return Array.from(s);
	}
	async listServices(t, r = 5e3) {
		let n = encodeURIComponent(t.replace(/^fabric:\//, ''));
		return ((await this.get(`/Applications/${n}/$/GetServices`, r))?.Items ?? []).map((s) => ({
			id: encodeURIComponent(String(s?.Id ?? '')),
			manifestName: String(s?.ServiceManifestName ?? s?.TypeName ?? ''),
		}));
	}
	async listReplicas(t, r = 5e3) {
		let n = await this.get(`/Services/${t}/$/GetPartitions`, r).catch(() => ({
				Items: [],
			})),
			i = [];
		for (let o of n?.Items ?? []) {
			let s = encodeURIComponent(String(o?.PartitionInformation?.Id ?? ''));
			if (!s) continue;
			let a = await this.get(`/Partitions/${s}/$/GetReplicas`, r).catch(() => ({
				Items: [],
			}));
			for (let c of a?.Items ?? [])
				i.push({
					replicaStatus: String(c?.ReplicaStatus ?? ''),
					nodeName: String(c?.NodeName ?? ''),
				});
		}
		return i;
	}
	async getDeployedCodePackages(t, r, n = 5e3) {
		let i = t.replace(/^fabric:\//, ''),
			o = [];
		for (let s of r) {
			let a = `/Nodes/${encodeURIComponent(s)}/$/GetApplications/${encodeURIComponent(i)}/$/GetCodePackages`,
				c = await this.get(a, n).catch(() => {}),
				l = Array.isArray(c) ? c : Array.isArray(c?.Items) ? c.Items : [];
			for (let u of l) {
				let p = u?.MainEntryPoint?.ProcessId ?? u?.SetupEntryPoint?.ProcessId,
					d = Number(p);
				o.push({
					nodeName: s,
					serviceManifestName: String(u?.ServiceManifestName ?? ''),
					codePackageName: String(u?.Name ?? ''),
					codePackageVersion: String(u?.Version ?? ''),
					status: String(u?.Status ?? u?.HostType ?? ''),
					entryPointStatus: String(u?.MainEntryPoint?.Status ?? u?.MainEntryPoint?.EntryPointStatus ?? ''),
					processId: Number.isFinite(d) && d > 0 ? d : void 0,
					hostType: String(u?.HostType ?? ''),
				});
			}
		}
		return o;
	}
	rawGet(t, r = 5e3) {
		return this.get(t, r);
	}
	get(t, r) {
		let n = t.includes('?') ? '&' : '?',
			i = new url.URL(`${this.endpoint}${t}${n}api-version=${this.apiVersion}`),
			o = i.protocol === 'https:' ? https : http;
		return new Promise((s, a) => {
			let c = o.request(
				{
					method: 'GET',
					hostname: i.hostname,
					port: i.port || (i.protocol === 'https:' ? 443 : 80),
					path: `${i.pathname}${i.search}`,
					headers: {
						Accept: 'application/json',
					},
					timeout: r,
				},
				(l) => {
					let u = [];
					(l.on('data', (p) => u.push(Buffer.from(p))),
						l.on('end', () => {
							let p = Buffer.concat(u).toString('utf8');
							if (!l.statusCode || l.statusCode >= 400) {
								a(new Error(`HTTP ${l.statusCode} from ${i.href}: ${p}`));
								return;
							}
							try {
								s(p ? JSON.parse(p) : void 0);
							} catch (d) {
								a(d);
							}
						}));
				},
			);
			(c.on('error', (l) => a(wrapError(l, i.href))),
				c.on('timeout', () => c.destroy(new Error(`Request to ${i.href} timed out after ${r}ms`))),
				c.end());
		});
	}
};

export { SfRestClient };
