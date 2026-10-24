/**
 * Compact form of an XSD, as produced by `xsdCompiler` and bundled as
 * `serviceFabricSchema.json`. Only what completion, hover and validation
 * need is kept: which children and attributes an element allows, which are
 * required, enumerated values and documentation. Sequence order is not.
 */
import { localName, scanRootElement, type XmlElement } from './xmlScanner';

export const FABRIC_NAMESPACE = 'http://schemas.microsoft.com/2011/01/fabric';

/** Type key for elements that accept anything (`xs:anyType`, `xs:any`). */
export const ANY_TYPE = '#any';
/** Type key for text-only elements (simple types). */
export const TEXT_TYPE = '#text';

export interface SchemaAttribute {
	name: string;
	doc?: string;
	required?: boolean;
	/** Enumerated values (`xs:enumeration`, or `true`/`false` for booleans). */
	values?: string[];
	default?: string;
	/** Built-in XSD type at the bottom of the derivation, e.g. `boolean`, `string`. */
	type?: string;
}

export interface SchemaChild {
	name: string;
	/** Key into {@link SchemaModel.types}. */
	type: string;
	doc?: string;
	required?: boolean;
	/** Maximum occurrences; omitted means 1. */
	max?: number | 'unbounded';
}

export interface SchemaType {
	doc?: string;
	attributes: SchemaAttribute[];
	children: SchemaChild[];
	/** Accepts child elements not listed in {@link children}. */
	anyChildren?: boolean;
	/** Accepts attributes not listed in {@link attributes}. */
	anyAttributes?: boolean;
	/** Accepts text content. */
	text?: boolean;
}

export interface SchemaModel {
	namespace: string;
	/** Global elements: the valid document roots. */
	roots: SchemaChild[];
	types: Record<string, SchemaType>;
}

export interface ResolvedElement {
	/** The declaration of the last element of the path (`undefined` under `xs:any`). */
	decl?: SchemaChild;
	type: SchemaType;
}

const ANY: SchemaType = { attributes: [], children: [], anyChildren: true, anyAttributes: true, text: true };

/** Resolves a path of local element names, root first. `undefined` when the path leaves the schema. */
export function resolveElement(model: SchemaModel, path: readonly string[]): ResolvedElement | undefined {
	if (path.length === 0) return undefined;
	let decl: SchemaChild | undefined = model.roots.find((r) => r.name === path[0]);
	if (!decl) return undefined;
	let type = model.types[decl.type] ?? ANY;
	for (const name of path.slice(1)) {
		const child: SchemaChild | undefined = type.children.find((c) => c.name === name);
		if (!child) return type.anyChildren ? { type: ANY } : undefined;
		decl = child;
		type = model.types[child.type] ?? ANY;
	}
	return { decl, type };
}

/** Local names from the root down to `el`. */
export function elementPath(el: XmlElement): string[] {
	const path: string[] = [];
	for (let e: XmlElement | undefined = el; e; e = e.parent) path.unshift(e.localName);
	return path;
}

/** The namespace `el`'s name is in, looking at `xmlns` declarations on it and its ancestors. */
export function namespaceOf(el: XmlElement): string | undefined {
	const i = el.name.indexOf(':');
	const attr = i < 0 ? 'xmlns' : `xmlns:${el.name.slice(0, i)}`;
	for (let e: XmlElement | undefined = el; e; e = e.parent) {
		const decl = e.attributes.find((a) => a.name === attr);
		if (decl) return decl.value;
	}
	return undefined;
}

/**
 * True when `root` is a global element of `model` in the model's namespace,
 * i.e. the document is one the schema describes (application and service
 * manifests, application parameter files, cluster manifests, …).
 */
export function isSchemaRoot(model: SchemaModel, root: XmlElement | undefined): boolean {
	return !!root && namespaceOf(root) === model.namespace && model.roots.some((r) => r.name === root.localName);
}

/** {@link isSchemaRoot} for a whole document, reading only its first start tag. */
export function isSchemaDocument(model: SchemaModel, text: string): boolean {
	return isSchemaRoot(model, scanRootElement(text));
}

/** True for XML infrastructure attributes (`xmlns`, `xmlns:x`, `xsi:…`) that schemas don't declare. */
export function isInfrastructureAttribute(name: string): boolean {
	return name === 'xmlns' || name.includes(':');
}

export { localName };
