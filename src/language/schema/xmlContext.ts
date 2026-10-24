/**
 * Works out what the cursor is on in an XML document: where completion would
 * insert (element name, attribute name, attribute value, closing tag, content)
 * and which element or attribute a hover is over.
 */
import { parseXml, type XmlAttribute, type XmlElement } from './xmlScanner';
import { elementPath } from './schemaModel';

export type CompletionContext =
	/** After `<`: `path` is the parent's path; `start` is where the typed name begins. */
	| { kind: 'elementName'; path: string[]; start: number }
	/** After `</`. */
	| { kind: 'endTag'; path: string[]; start: number }
	/** Inside a start tag where an attribute name goes; `path` ends with the element. */
	| { kind: 'attributeName'; path: string[]; start: number; existing: string[] }
	/** Inside an attribute value; `start` is the value's first character. `quoted` is false right after `=`. */
	| { kind: 'attributeValue'; path: string[]; attribute: string; start: number; quoted: boolean }
	/** Element content, outside any tag; `start` is the start of the word being typed. */
	| { kind: 'content'; path: string[]; start: number }
	/** In a comment, CDATA section, processing instruction or declaration. */
	| { kind: 'none' };

function wordStart(text: string, offset: number): number {
	let s = offset;
	while (s > 0 && /[\w.:-]/.test(text[s - 1])) s--;
	return s;
}

/** Completion context at `offset`. */
export function completionContextAt(text: string, offset: number): CompletionContext {
	const doc = parseXml(text.slice(0, offset));
	const path = doc.open.map((e) => e.localName);
	const inc = doc.incomplete;
	if (!inc) return { kind: 'content', path, start: wordStart(text, offset) };
	switch (inc.kind) {
		case 'endTag':
			return { kind: 'endTag', path, start: inc.nameStart };
		case 'startTag': {
			const el = inc.element;
			const elPath = [...path, el.localName];
			const existing = el.attributes.filter((a) => a !== inc.attribute).map((a) => a.name);
			switch (inc.state) {
				case 'tagName':
					return { kind: 'elementName', path, start: el.nameRange.start };
				case 'betweenAttrs':
					return { kind: 'attributeName', path: elPath, start: offset, existing };
				case 'attrName':
					return { kind: 'attributeName', path: elPath, start: inc.attribute!.nameRange.start, existing };
				case 'beforeValue':
					return { kind: 'attributeValue', path: elPath, attribute: inc.attribute!.name, start: offset, quoted: false };
				case 'attrValue':
					return { kind: 'attributeValue', path: elPath, attribute: inc.attribute!.name, start: inc.attribute!.valueRange!.start, quoted: true };
				default:
					return { kind: 'none' };
			}
		}
		default:
			return { kind: 'none' };
	}
}

export type HoverTarget =
	| { kind: 'element'; element: XmlElement; path: string[]; range: { start: number; end: number } }
	| { kind: 'attribute'; element: XmlElement; attribute: XmlAttribute; path: string[]; range: { start: number; end: number } };

const within = (r: { start: number; end: number } | undefined, offset: number): boolean => !!r && offset >= r.start && offset <= r.end;

/** The element or attribute name under `offset`. */
export function hoverTargetAt(text: string, offset: number): HoverTarget | undefined {
	const doc = parseXml(text);
	const visit = (el: XmlElement): HoverTarget | undefined => {
		if (offset < el.start || (el.end !== undefined && offset > el.end)) return undefined;
		if (within(el.nameRange, offset)) return { kind: 'element', element: el, path: elementPath(el), range: el.nameRange };
		if (within(el.closeNameRange, offset)) return { kind: 'element', element: el, path: elementPath(el), range: el.closeNameRange! };
		for (const a of el.attributes) {
			if (within(a.nameRange, offset)) return { kind: 'attribute', element: el, attribute: a, path: elementPath(el), range: a.nameRange };
		}
		for (const c of el.children) {
			const hit = visit(c);
			if (hit) return hit;
		}
		return undefined;
	};
	for (const el of doc.elements) {
		const hit = visit(el);
		if (hit) return hit;
	}
	return undefined;
}
