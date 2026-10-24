/**
 * Compiles an XSD into a {@link SchemaModel}. Handles the constructs the
 * Service Fabric service-model schema uses: named and anonymous complex and
 * simple types, sequence / choice / all, groups and attribute groups, element
 * refs, complex- and simple-content extension and restriction, enumerations,
 * unions, `xs:any` and `xs:anyAttribute`. Imports, includes and substitution
 * groups are not supported.
 *
 * "Required" is only set when it is certain: an element inside a choice
 * between several options is never required, and maximum occurrences inside
 * a repeating compositor are treated as unbounded.
 */
import { innerText, parseXml, type XmlElement } from './xmlScanner';
import { ANY_TYPE, TEXT_TYPE, type SchemaAttribute, type SchemaChild, type SchemaModel, type SchemaType } from './schemaModel';

const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';

interface SimpleInfo {
	values?: string[];
	type?: string;
}

export function compileXsd(text: string): SchemaModel {
	const doc = parseXml(text);
	const schema = doc.root;
	if (!schema || schema.localName !== 'schema') throw new Error('Not an XML schema: the root element is not <xs:schema>.');

	const xsPrefix = schema.attributes.find((a) => a.name.startsWith('xmlns:') && a.value === XSD_NAMESPACE)?.name.slice('xmlns:'.length);
	const attr = (el: XmlElement, name: string): string | undefined => el.attributes.find((a) => a.name === name)?.value;
	const kids = (el: XmlElement): XmlElement[] => el.children.filter((c) => c.localName !== 'annotation');
	const split = (qname: string): { prefix?: string; local: string } => {
		const i = qname.indexOf(':');
		return i < 0 ? { local: qname } : { prefix: qname.slice(0, i), local: qname.slice(i + 1) };
	};
	const isBuiltin = (qname: string): boolean => {
		const { prefix } = split(qname);
		return prefix !== undefined && prefix === xsPrefix;
	};
	const docOf = (el: XmlElement | undefined): string | undefined => {
		const annotation = el?.children.find((c) => c.localName === 'annotation');
		const parts = (annotation?.children ?? []).filter((c) => c.localName === 'documentation').map((d) => innerText(text, d));
		const joined = parts.filter(Boolean).join('\n\n');
		return joined || undefined;
	};

	const index = (kind: string): Map<string, XmlElement> => {
		const map = new Map<string, XmlElement>();
		for (const c of schema.children) {
			const name = attr(c, 'name');
			if (c.localName === kind && name) map.set(name, c);
		}
		return map;
	};
	const complexTypes = index('complexType');
	const simpleTypes = index('simpleType');
	const elements = index('element');
	const groups = index('group');
	const attributeGroups = index('attributeGroup');

	const types: Record<string, SchemaType> = {
		[ANY_TYPE]: { attributes: [], children: [], anyChildren: true, anyAttributes: true, text: true },
		[TEXT_TYPE]: { attributes: [], children: [], text: true },
	};

	// ---- simple types -------------------------------------------------------
	const simpleMemo = new Map<string, SimpleInfo>();
	const simpleFromName = (qname: string): SimpleInfo => {
		const { local } = split(qname);
		if (isBuiltin(qname)) return { type: local };
		const st = simpleTypes.get(local);
		if (!st) return {};
		let info = simpleMemo.get(local);
		if (!info) {
			simpleMemo.set(local, {});
			info = simpleFromNode(st);
			simpleMemo.set(local, info);
		}
		return info;
	};
	const simpleFromNode = (st: XmlElement): SimpleInfo => {
		for (const c of kids(st)) {
			if (c.localName === 'restriction') {
				const base = attr(c, 'base');
				const inline = c.children.find((x) => x.localName === 'simpleType');
				const baseInfo = base ? simpleFromName(base) : inline ? simpleFromNode(inline) : {};
				const values = c.children.filter((x) => x.localName === 'enumeration').map((x) => attr(x, 'value') ?? '');
				return values.length ? { values, type: baseInfo.type } : baseInfo;
			}
			if (c.localName === 'union') {
				const members = [
					...(attr(c, 'memberTypes') ?? '').split(/\s+/).filter(Boolean).map(simpleFromName),
					...c.children.filter((x) => x.localName === 'simpleType').map(simpleFromNode),
				];
				if (members.length && members.every((m) => m.values)) return { values: [...new Set(members.flatMap((m) => m.values!))] };
				return { type: 'string' };
			}
			if (c.localName === 'list') return { type: 'list' };
		}
		return {};
	};

	// ---- attributes ---------------------------------------------------------
	const addAttributes = (node: XmlElement, type: SchemaType, seenGroups = new Set<string>()): void => {
		switch (node.localName) {
			case 'attribute': {
				const name = attr(node, 'name') ?? (attr(node, 'ref') ? split(attr(node, 'ref')!).local : undefined);
				if (!name) return;
				if (attr(node, 'use') === 'prohibited') {
					type.attributes = type.attributes.filter((a) => a.name !== name);
					return;
				}
				const typeName = attr(node, 'type');
				const inline = node.children.find((c) => c.localName === 'simpleType');
				const info = typeName ? simpleFromName(typeName) : inline ? simpleFromNode(inline) : {};
				const a: SchemaAttribute = { name };
				const doc = docOf(node);
				if (doc) a.doc = doc;
				if (attr(node, 'use') === 'required') a.required = true;
				if (info.type) a.type = info.type;
				if (info.values) a.values = info.values;
				else if (info.type === 'boolean') a.values = ['true', 'false'];
				const dflt = attr(node, 'default') ?? attr(node, 'fixed');
				if (dflt !== undefined) a.default = dflt;
				const at = type.attributes.findIndex((x) => x.name === name);
				if (at >= 0) type.attributes[at] = a;
				else type.attributes.push(a);
				return;
			}
			case 'attributeGroup': {
				const ref = attr(node, 'ref');
				const group = ref ? attributeGroups.get(split(ref).local) : node;
				if (!group || (ref && seenGroups.has(ref))) return;
				if (ref) seenGroups.add(ref);
				for (const c of kids(group)) addAttributes(c, type, seenGroups);
				return;
			}
			case 'anyAttribute':
				type.anyAttributes = true;
				return;
		}
	};

	// ---- complex types ------------------------------------------------------
	const uniqueKey = (base: string): string => {
		if (!(base in types)) return base;
		let i = 2;
		while (`${base}#${i}` in types) i++;
		return `${base}#${i}`;
	};
	const namedTypeKey = (qname: string): string => {
		if (isBuiltin(qname)) return split(qname).local === 'anyType' ? ANY_TYPE : TEXT_TYPE;
		const { local } = split(qname);
		const ct = complexTypes.get(local);
		if (ct) {
			if (!(local in types)) compileComplex(local, ct);
			return local;
		}
		return simpleTypes.has(local) ? TEXT_TYPE : ANY_TYPE;
	};
	/** Type key for an element declaration (named type, inline type, or anyType). */
	const elementTypeKey = (el: XmlElement, anonKey: string): string => {
		const typeName = attr(el, 'type');
		if (typeName) return namedTypeKey(typeName);
		const inlineComplex = el.children.find((c) => c.localName === 'complexType');
		if (inlineComplex) {
			const key = uniqueKey(anonKey);
			compileComplex(key, inlineComplex);
			return key;
		}
		if (el.children.some((c) => c.localName === 'simpleType')) return TEXT_TYPE;
		return ANY_TYPE;
	};
	const globalElementKeys = new Map<string, string>();
	const globalElementKey = (name: string): string => {
		let key = globalElementKeys.get(name);
		if (!key) {
			const el = elements.get(name);
			key = el ? elementTypeKey(el, `#element:${name}`) : ANY_TYPE;
			globalElementKeys.set(name, key);
		}
		return key;
	};

	const occurs = (node: XmlElement): { min: number; max: number | 'unbounded' } => {
		const min = Number(attr(node, 'minOccurs') ?? '1');
		const maxRaw = attr(node, 'maxOccurs') ?? '1';
		return { min, max: maxRaw === 'unbounded' ? 'unbounded' : Number(maxRaw) };
	};

	const addChild = (type: SchemaType, ownerKey: string, el: XmlElement, required: boolean, repeated: boolean): void => {
		const { min, max } = occurs(el);
		const ref = attr(el, 'ref');
		let name: string;
		let typeKey: string;
		let doc = docOf(el);
		if (ref) {
			name = split(ref).local;
			typeKey = globalElementKey(name);
			doc ??= docOf(elements.get(name));
		} else {
			name = attr(el, 'name') ?? '';
			if (!name) return;
			typeKey = elementTypeKey(el, `${ownerKey}/${name}`);
		}
		const existing = type.children.find((c) => c.name === name);
		if (existing) {
			// Same name in two branches: neither is required and the count is open.
			delete existing.required;
			existing.max = 'unbounded';
			return;
		}
		const child: SchemaChild = { name, type: typeKey };
		if (doc) child.doc = doc;
		if (required && min > 0) child.required = true;
		const effectiveMax = repeated ? 'unbounded' : max;
		if (effectiveMax !== 1) child.max = effectiveMax;
		type.children.push(child);
	};

	const addParticles = (type: SchemaType, ownerKey: string, node: XmlElement, required: boolean, repeated: boolean): void => {
		const { min, max } = occurs(node);
		const rep = repeated || max !== 1;
		switch (node.localName) {
			case 'sequence':
			case 'all':
				for (const c of kids(node)) addParticles(type, ownerKey, c, required && min > 0, rep);
				return;
			case 'choice': {
				const options = kids(node);
				for (const c of options) addParticles(type, ownerKey, c, required && min > 0 && options.length === 1, rep);
				return;
			}
			case 'group': {
				const ref = attr(node, 'ref');
				const group = ref ? groups.get(split(ref).local) : undefined;
				for (const c of group ? kids(group) : []) addParticles(type, ownerKey, c, required && min > 0, rep);
				return;
			}
			case 'element':
				addChild(type, ownerKey, node, required, repeated);
				return;
			case 'any':
				type.anyChildren = true;
				return;
		}
	};

	const addContent = (type: SchemaType, key: string, node: XmlElement): void => {
		for (const c of kids(node)) {
			switch (c.localName) {
				case 'sequence':
				case 'choice':
				case 'all':
				case 'group':
					addParticles(type, key, c, true, false);
					break;
				case 'attribute':
				case 'attributeGroup':
				case 'anyAttribute':
					addAttributes(c, type);
					break;
			}
		}
	};

	function compileComplex(key: string, node: XmlElement): void {
		const type: SchemaType = { attributes: [], children: [] };
		types[key] = type;
		const doc = docOf(node);
		if (doc) type.doc = doc;
		if (attr(node, 'mixed') === 'true') type.text = true;
		for (const c of kids(node)) {
			if (c.localName !== 'complexContent' && c.localName !== 'simpleContent') continue;
			if (c.localName === 'simpleContent') type.text = true;
			if (attr(c, 'mixed') === 'true') type.text = true;
			for (const derivation of kids(c)) {
				const base = attr(derivation, 'base');
				const baseType = base && !isBuiltin(base) && complexTypes.has(split(base).local) ? types[namedTypeKey(base)] : undefined;
				if (baseType) {
					type.attributes.push(...baseType.attributes.map((a) => ({ ...a })));
					if (baseType.anyAttributes) type.anyAttributes = true;
					if (baseType.text) type.text = true;
					if (derivation.localName === 'extension') {
						type.children.push(...baseType.children.map((ch) => ({ ...ch })));
						if (baseType.anyChildren) type.anyChildren = true;
					}
				}
				addContent(type, key, derivation);
			}
		}
		addContent(type, key, node);
	}

	const roots: SchemaChild[] = [];
	for (const [name, el] of elements) {
		const root: SchemaChild = { name, type: globalElementKey(name) };
		const doc = docOf(el);
		if (doc) root.doc = doc;
		roots.push(root);
	}
	return { namespace: attr(schema, 'targetNamespace') ?? '', roots, types };
}
