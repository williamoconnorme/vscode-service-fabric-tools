/** Element tree of XML text, for outlines and parameter scoping. Pure: no VS Code dependency. */

import { findAttributeOccurrences, type AttributeOccurrence } from './xmlText';

/** Attributes that name an element, most specific first; the first one present becomes the symbol name. */
const NAME_ATTRIBUTES = ['Name', 'ServiceTypeName', 'ServiceManifestName', 'ApplicationTypeName', 'CodePackageRef', 'Path'];

/** One element of a manifest, as found by {@link parseXmlOutline}. Offsets are into the document text. */
export interface XmlOutlineNode {
	/** Local element name (namespace prefix dropped). */
	element: string;
	/** Value of the first {@link NAME_ATTRIBUTES} attribute present. */
	nameValue?: string;
	start: number;
	end: number;
	/** The opening tag, used as the selection range. */
	tagStart: number;
	tagEnd: number;
	children: XmlOutlineNode[];
}

/**
 * Element tree of an XML document, skipping comments, CDATA, processing instructions and
 * declarations. Tolerant of unclosed tags (they end at their parent's end) so it works while typing.
 */
export function parseXmlOutline(text: string): XmlOutlineNode[] {
	const roots: XmlOutlineNode[] = [];
	const stack: XmlOutlineNode[] = [];
	const re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[?!][^>]*>?|<\/\s*([\w.\-:]+)\s*>|<([\w.\-:]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const [whole, closeName, openName, attrs, selfClose] = m;
		if (closeName !== undefined) {
			const local = localName(closeName);
			// Pop to the matching open element; ignore a stray close tag.
			const idx = findLastIndex(stack, (n) => n.element === local);
			if (idx < 0) continue;
			while (stack.length > idx) {
				const node = stack.pop()!;
				node.end = m.index + whole.length;
			}
			continue;
		}
		if (openName === undefined) continue;
		const node: XmlOutlineNode = {
			element: localName(openName),
			nameValue: nameAttribute(attrs ?? ''),
			start: m.index,
			end: m.index + whole.length,
			tagStart: m.index,
			tagEnd: m.index + whole.length,
			children: [],
		};
		(stack.length ? stack[stack.length - 1].children : roots).push(node);
		if (!selfClose) stack.push(node);
	}
	// Unclosed elements run to the end of the document.
	for (const node of stack) node.end = text.length;
	return roots;
}

function localName(name: string): string {
	const colon = name.indexOf(':');
	return colon >= 0 ? name.slice(colon + 1) : name;
}

function nameAttribute(attrs: string): string | undefined {
	for (const attr of NAME_ATTRIBUTES) {
		const m = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
		if (m) return m[1] ?? m[2];
	}
	return undefined;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
	for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i])) return i;
	return -1;
}

/**
 * `<Parameter Name>` attributes inside ApplicationManifest.xml's top-level `<Parameters>`. Other
 * `<Parameter>` elements (ConfigOverrides settings) are config names, not application parameters.
 */
export function applicationParameterDeclarations(text: string): AttributeOccurrence[] {
	const root = parseXmlOutline(text).find((n) => n.element === 'ApplicationManifest');
	const block = root?.children.find((n) => n.element === 'Parameters');
	if (!block) return [];
	return findAttributeOccurrences(text, 'Parameter', 'Name').filter(
		(a) => a.elementRange.start >= block.start && a.elementRange.start < block.end,
	);
}
