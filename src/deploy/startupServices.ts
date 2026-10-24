/**
 * Parses `StartupServices.xml` (the Visual Studio 2019+ replacement for
 * `<DefaultServices>`) into REST `ServiceDescription` bodies. Pure; no I/O.
 *
 * Shape:
 *
 *   <StartupServicesManifest>
 *     <Parameters><Parameter Name DefaultValue /></Parameters>
 *     <Services>
 *       <Service Name ServicePackageActivationMode>
 *         <StatelessService ServiceTypeName InstanceCount>
 *         | <StatefulService ServiceTypeName TargetReplicaSetSize MinReplicaSetSize>
 *           <SingletonPartition /> | <UniformInt64Partition PartitionCount LowKey HighKey />
 *           | <NamedPartition><Partition Name /></NamedPartition>
 *     ...
 *
 * `[Param]` tokens resolve against the file's `<Parameters>` defaults
 * overlaid with the publish profile's `StartupServiceParameterFile`.
 */
import { parseApplicationParameterFile } from './deployScript';

/** One `<Service>` from StartupServices.xml, with parameters resolved. */
export interface StartupServiceSpec {
	/** Service name relative to the application (`MyService`), or a full `fabric:/` name. */
	name: string;
	kind: 'Stateless' | 'Stateful';
	serviceTypeName: string;
	servicePackageActivationMode?: string;
	instanceCount?: number;
	targetReplicaSetSize?: number;
	minReplicaSetSize?: number;
	partition:
		| { scheme: 'Singleton' }
		| { scheme: 'UniformInt64Range'; count: number; lowKey: string; highKey: string }
		| { scheme: 'Named'; names: string[] };
}

/** `<Parameters><Parameter Name DefaultValue/>` of a StartupServices.xml. */
export function parseStartupServiceDefaults(xml: string): Record<string, string> {
	const out: Record<string, string> = {};
	const block = /<Parameters\b[^>]*>([\s\S]*?)<\/Parameters>/i.exec(xml)?.[1] ?? '';
	const re = /<Parameter\b([^>]*?)\/?>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(block)) !== null) {
		const attrs = m[1] ?? '';
		const name = /\bName\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
		const value = /\bDefaultValue\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
		if (name) out[name] = value ?? '';
	}
	return out;
}

/** Replaces `[Name]` tokens with parameter values. Throws on an unknown parameter. */
export function resolveParameterTokens(value: string, parameters: Record<string, string>, where: string): string {
	return value.replace(/\[([^\]]+)\]/g, (_, name: string) => {
		if (!(name in parameters)) throw new Error(`${where} references parameter [${name}], which isn't declared or set.`);
		return parameters[name];
	});
}

function attr(attrs: string, name: string): string | undefined {
	return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs)?.[1];
}

function intAttr(attrs: string, name: string, parameters: Record<string, string>, where: string): number | undefined {
	const raw = attr(attrs, name);
	if (raw === undefined) return undefined;
	const resolved = resolveParameterTokens(raw, parameters, where).trim();
	const n = Number(resolved);
	if (!Number.isInteger(n)) throw new Error(`${where}: ${name}="${raw}" resolves to '${resolved}', which isn't an integer.`);
	return n;
}

/**
 * Parses the services of a StartupServices.xml. `overrides` is the
 * `StartupServiceParameters/<env>.xml` content (name → value), applied on top
 * of the file's own defaults.
 */
export function parseStartupServices(xml: string, overrides: Record<string, string> = {}): StartupServiceSpec[] {
	const parameters = { ...parseStartupServiceDefaults(xml), ...overrides };
	const servicesBlock = /<Services\b[^>]*>([\s\S]*?)<\/Services>/i.exec(xml)?.[1] ?? '';
	const out: StartupServiceSpec[] = [];
	const serviceRe = /<Service\b([^>]*)>([\s\S]*?)<\/Service>/gi;
	let m: RegExpExecArray | null;
	while ((m = serviceRe.exec(servicesBlock)) !== null) {
		const serviceAttrs = m[1] ?? '';
		const body = m[2] ?? '';
		const name = attr(serviceAttrs, 'Name');
		if (!name) continue;
		const where = `StartupServices.xml service '${name}'`;
		const kindMatch = /<(StatelessService|StatefulService)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/i.exec(body);
		if (!kindMatch) throw new Error(`${where} has no <StatelessService> or <StatefulService>.`);
		const stateful = /^StatefulService$/i.test(kindMatch[1]);
		const kindAttrs = kindMatch[2] ?? '';
		const inner = kindMatch[4] ?? '';
		const serviceTypeName = attr(kindAttrs, 'ServiceTypeName');
		if (!serviceTypeName) throw new Error(`${where} has no ServiceTypeName.`);
		const spec: StartupServiceSpec = {
			name,
			kind: stateful ? 'Stateful' : 'Stateless',
			serviceTypeName: resolveParameterTokens(serviceTypeName, parameters, where),
			partition: parsePartition(inner, parameters, where),
		};
		const activation = attr(serviceAttrs, 'ServicePackageActivationMode');
		if (activation) spec.servicePackageActivationMode = resolveParameterTokens(activation, parameters, where);
		if (stateful) {
			spec.targetReplicaSetSize = intAttr(kindAttrs, 'TargetReplicaSetSize', parameters, where) ?? 1;
			spec.minReplicaSetSize = intAttr(kindAttrs, 'MinReplicaSetSize', parameters, where) ?? 1;
		} else {
			spec.instanceCount = intAttr(kindAttrs, 'InstanceCount', parameters, where) ?? 1;
		}
		out.push(spec);
	}
	return out;
}

function parsePartition(inner: string, parameters: Record<string, string>, where: string): StartupServiceSpec['partition'] {
	const uniform = /<UniformInt64Partition\b([^>]*?)\/?>/i.exec(inner);
	if (uniform) {
		const attrs = uniform[1] ?? '';
		return {
			scheme: 'UniformInt64Range',
			count: intAttr(attrs, 'PartitionCount', parameters, where) ?? 1,
			lowKey: resolveParameterTokens(attr(attrs, 'LowKey') ?? '-9223372036854775808', parameters, where),
			highKey: resolveParameterTokens(attr(attrs, 'HighKey') ?? '9223372036854775807', parameters, where),
		};
	}
	const named = /<NamedPartition\b[^>]*>([\s\S]*?)<\/NamedPartition>/i.exec(inner);
	if (named) {
		const names: string[] = [];
		const re = /<Partition\b([^>]*?)\/?>/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(named[1] ?? '')) !== null) {
			const n = attr(m[1] ?? '', 'Name');
			if (n) names.push(resolveParameterTokens(n, parameters, where));
		}
		return { scheme: 'Named', names };
	}
	return { scheme: 'Singleton' };
}

/** The REST `ServiceDescription` for a startup service in `applicationName` (`fabric:/App`). */
export function toServiceDescription(spec: StartupServiceSpec, applicationName: string): Record<string, unknown> {
	const serviceName = spec.name.startsWith('fabric:/') ? spec.name : `${applicationName}/${spec.name}`;
	const partition =
		spec.partition.scheme === 'UniformInt64Range'
			? {
					PartitionScheme: 'UniformInt64Range',
					Count: spec.partition.count,
					LowKey: spec.partition.lowKey,
					HighKey: spec.partition.highKey,
				}
			: spec.partition.scheme === 'Named'
				? { PartitionScheme: 'Named', Count: spec.partition.names.length, Names: spec.partition.names }
				: { PartitionScheme: 'Singleton' };
	return {
		ServiceKind: spec.kind,
		ApplicationName: applicationName,
		ServiceName: serviceName,
		ServiceTypeName: spec.serviceTypeName,
		PartitionDescription: partition,
		...(spec.servicePackageActivationMode ? { ServicePackageActivationMode: spec.servicePackageActivationMode } : {}),
		...(spec.kind === 'Stateful'
			? { TargetReplicaSetSize: spec.targetReplicaSetSize, MinReplicaSetSize: spec.minReplicaSetSize, HasPersistedState: true }
			: { InstanceCount: spec.instanceCount }),
	};
}

/** `StartupServiceParameters/<env>.xml` → name/value map (same `<Parameter Name Value>` shape as application parameters). */
export const parseStartupServiceParameterFile = parseApplicationParameterFile;
