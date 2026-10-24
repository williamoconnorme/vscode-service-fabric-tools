/**
 * A small, tolerant XML parser that keeps character offsets for every element
 * and attribute. It never throws: malformed input is reported as problems and
 * parsing carries on, so it works on documents that are being typed. It also
 * reports the construct left open at the end of the text, which is how
 * completion works out what the cursor is inside (parse `text.slice(0, offset)`).
 *
 * Not a conforming XML processor: entities, DTDs and namespaces are not
 * interpreted (names keep their prefix; see {@link localName}).
 */
import type { TextRange } from '../../util/xmlText';

export type { TextRange };

export interface XmlAttribute {
	name: string;
	value: string;
	nameRange: TextRange;
	/** Range inside the quotes; `undefined` when the attribute has no value. */
	valueRange?: TextRange;
}

export interface XmlElement {
	/** Qualified name as written, e.g. `xs:element`. */
	name: string;
	localName: string;
	attributes: XmlAttribute[];
	children: XmlElement[];
	parent?: XmlElement;
	/** Offset of `<`. */
	start: number;
	nameRange: TextRange;
	/** Offset just past the start tag's `>` (or where the broken start tag stops). */
	startTagEnd: number;
	selfClosing: boolean;
	/** Offset of the closing tag's `</`; `undefined` while the element is unclosed. */
	contentEnd?: number;
	closeNameRange?: TextRange;
	/** Offset just past the closing tag (or the self-closing `/>`). */
	end?: number;
	/** Non-whitespace text (and CDATA) directly inside this element. */
	text: TextRange[];
}

export interface XmlProblem {
	message: string;
	range: TextRange;
}

/** Where an unterminated start tag stopped; drives completion. */
export type StartTagState =
	/** Still in the element name. */
	| 'tagName'
	/** After whitespace, where an attribute name can start. */
	| 'betweenAttrs'
	/** In an attribute name. */
	| 'attrName'
	/** After an attribute name, before `=`. */
	| 'afterAttrName'
	/** After `=`, before the opening quote. */
	| 'beforeValue'
	/** Inside a quoted attribute value. */
	| 'attrValue';

export type XmlIncomplete =
	| { kind: 'startTag'; element: XmlElement; state: StartTagState; attribute?: XmlAttribute }
	| { kind: 'endTag'; start: number; nameStart: number; name: string }
	| { kind: 'comment' | 'cdata' | 'pi' | 'declaration'; start: number };

export interface XmlDocument {
	/** Top-level elements; well-formed documents have exactly one. */
	elements: XmlElement[];
	root?: XmlElement;
	problems: XmlProblem[];
	/** Elements still open at the end of the text, outermost first. */
	open: XmlElement[];
	/** The construct the text ends inside, if any. */
	incomplete?: XmlIncomplete;
}

const NAME_STOP = /[\s/>"'=<]/;

export function localName(name: string): string {
	const i = name.indexOf(':');
	return i < 0 ? name : name.slice(i + 1);
}

function isSpace(ch: string): boolean {
	return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function readName(text: string, p: number): number {
	while (p < text.length && !NAME_STOP.test(text[p])) p++;
	return p;
}

export interface StartTagScan {
	element: XmlElement;
	/** True when the tag ended with `>` or `/>`. */
	complete: boolean;
	/** For incomplete tags: where scanning stopped. */
	state?: StartTagState;
	/** The attribute being written when `state` is about one. */
	attribute?: XmlAttribute;
	problems: XmlProblem[];
}

/** Scans the start tag whose `<` is at `lt`. */
export function scanStartTag(text: string, lt: number): StartTagScan {
	const n = text.length;
	const problems: XmlProblem[] = [];
	const nameEnd = readName(text, lt + 1);
	const name = text.slice(lt + 1, nameEnd);
	const element: XmlElement = {
		name,
		localName: localName(name),
		attributes: [],
		children: [],
		start: lt,
		nameRange: { start: lt + 1, end: nameEnd },
		startTagEnd: n,
		selfClosing: false,
		text: [],
	};
	const incomplete = (state: StartTagState, attribute?: XmlAttribute, end = n): StartTagScan => {
		element.startTagEnd = end;
		return { element, complete: false, state, attribute, problems };
	};
	let p = nameEnd;
	if (p >= n) return incomplete('tagName');
	if (!name) problems.push({ message: 'Expected an element name after "<".', range: { start: lt, end: lt + 1 } });
	for (;;) {
		const wsStart = p;
		while (p < n && isSpace(text[p])) p++;
		if (p >= n) return incomplete(p > wsStart ? 'betweenAttrs' : 'tagName');
		const ch = text[p];
		if (ch === '>') {
			element.startTagEnd = p + 1;
			return { element, complete: true, problems };
		}
		if (ch === '/' && text[p + 1] === '>') {
			element.selfClosing = true;
			element.startTagEnd = element.end = p + 2;
			return { element, complete: true, problems };
		}
		if (ch === '/' && p + 1 >= n) return incomplete('betweenAttrs');
		if (ch === '<') {
			problems.push({ message: `Start tag <${name}> is not closed with ">".`, range: element.nameRange });
			return incomplete('betweenAttrs', undefined, p);
		}
		const attrStart = p;
		p = readName(text, p);
		if (p === attrStart) {
			problems.push({ message: `Unexpected character "${ch}" in start tag <${name}>.`, range: { start: p, end: p + 1 } });
			p++;
			continue;
		}
		const attr: XmlAttribute = { name: text.slice(attrStart, p), value: '', nameRange: { start: attrStart, end: p } };
		element.attributes.push(attr);
		if (p >= n) return incomplete('attrName', attr);
		while (p < n && isSpace(text[p])) p++;
		if (p >= n) return incomplete('afterAttrName', attr);
		if (text[p] !== '=') {
			problems.push({ message: `Attribute "${attr.name}" has no value.`, range: attr.nameRange });
			continue;
		}
		p++;
		while (p < n && isSpace(text[p])) p++;
		if (p >= n) return incomplete('beforeValue', attr);
		const quote = text[p];
		if (quote === '"' || quote === "'") {
			const close = text.indexOf(quote, p + 1);
			const lessThan = text.indexOf('<', p + 1);
			if (close < 0 || (lessThan >= 0 && lessThan < close)) {
				const stop = lessThan >= 0 ? lessThan : n;
				attr.value = text.slice(p + 1, stop);
				attr.valueRange = { start: p + 1, end: stop };
				if (stop >= n && close < 0) return incomplete('attrValue', attr);
				problems.push({ message: `Value of attribute "${attr.name}" is not closed.`, range: attr.nameRange });
				return incomplete('betweenAttrs', undefined, stop);
			}
			attr.value = text.slice(p + 1, close);
			attr.valueRange = { start: p + 1, end: close };
			p = close + 1;
		} else {
			const valueStart = p;
			while (p < n && !isSpace(text[p]) && text[p] !== '>' && text[p] !== '<' && !(text[p] === '/' && text[p + 1] === '>')) p++;
			attr.value = text.slice(valueStart, p);
			attr.valueRange = { start: valueStart, end: p };
			problems.push({ message: `Value of attribute "${attr.name}" must be quoted.`, range: attr.valueRange });
		}
	}
}

/** Parses `text`, recovering from errors. */
export function parseXml(text: string): XmlDocument {
	const n = text.length;
	const elements: XmlElement[] = [];
	const problems: XmlProblem[] = [];
	const stack: XmlElement[] = [];
	let incomplete: XmlIncomplete | undefined;

	const addText = (start: number, end: number): void => {
		let s = start;
		let e = end;
		while (s < e && isSpace(text[s])) s++;
		while (e > s && isSpace(text[e - 1])) e--;
		if (s === e) return;
		const top = stack[stack.length - 1];
		if (top) top.text.push({ start: s, end: e });
		else problems.push({ message: 'Text is not allowed outside the root element.', range: { start: s, end: e } });
	};
	const skipTo = (from: number, terminator: string, kind: 'comment' | 'cdata' | 'pi' | 'declaration', what: string): number => {
		const end = text.indexOf(terminator, from);
		if (end < 0) {
			incomplete = { kind, start: from };
			problems.push({ message: `${what} is not closed.`, range: { start: from, end: Math.min(n, from + 4) } });
			return -1;
		}
		return end + terminator.length;
	};

	let i = 0;
	while (i < n) {
		const lt = text.indexOf('<', i);
		if (lt < 0) {
			addText(i, n);
			break;
		}
		addText(i, lt);
		if (text.startsWith('<!--', lt)) {
			i = skipTo(lt, '-->', 'comment', 'Comment');
		} else if (text.startsWith('<![CDATA[', lt)) {
			const next = skipTo(lt, ']]>', 'cdata', 'CDATA section');
			const top = stack[stack.length - 1];
			if (top) top.text.push({ start: lt, end: next < 0 ? n : next });
			i = next;
		} else if (text.startsWith('<?', lt)) {
			i = skipTo(lt, '?>', 'pi', 'Processing instruction');
		} else if (text.startsWith('<!', lt)) {
			i = skipTo(lt, '>', 'declaration', 'Declaration');
		} else if (text[lt + 1] === '/') {
			const nameStart = lt + 2;
			const nameEnd = readName(text, nameStart);
			const name = text.slice(nameStart, nameEnd);
			const gt = text.indexOf('>', nameEnd);
			const nextLt = text.indexOf('<', nameEnd);
			if (gt < 0 || (nextLt >= 0 && nextLt < gt)) {
				if (gt < 0 && nextLt < 0) {
					incomplete = { kind: 'endTag', start: lt, nameStart, name };
					if (nameEnd < n || name) problems.push({ message: `Closing tag </${name}> is not closed with ">".`, range: { start: lt, end: nameEnd } });
					break;
				}
				problems.push({ message: `Closing tag </${name}> is not closed with ">".`, range: { start: lt, end: nameEnd } });
			}
			const tagEnd = gt < 0 || (nextLt >= 0 && nextLt < gt) ? nameEnd : gt + 1;
			const closeNameRange = { start: nameStart, end: nameEnd };
			const at = stack.map((e) => e.name).lastIndexOf(name);
			if (at < 0) {
				problems.push({ message: `Unexpected closing tag </${name}>.`, range: closeNameRange });
			} else {
				while (stack.length - 1 > at) {
					const unclosed = stack.pop()!;
					problems.push({ message: `Element <${unclosed.name}> is not closed.`, range: unclosed.nameRange });
				}
				const el = stack.pop()!;
				el.contentEnd = lt;
				el.closeNameRange = closeNameRange;
				el.end = tagEnd;
			}
			i = tagEnd;
		} else {
			const scan = scanStartTag(text, lt);
			problems.push(...scan.problems);
			const el = scan.element;
			const parent = stack[stack.length - 1];
			if (parent) {
				el.parent = parent;
				parent.children.push(el);
			} else {
				if (elements.length === 1) problems.push({ message: 'A document can have only one root element.', range: el.nameRange });
				elements.push(el);
			}
			if (!scan.complete && el.startTagEnd >= n) {
				incomplete = { kind: 'startTag', element: el, state: scan.state!, attribute: scan.attribute };
				break;
			}
			if (!el.selfClosing) stack.push(el);
			i = el.startTagEnd;
		}
		if (i < 0) break;
	}
	if (!incomplete) {
		for (const el of stack) problems.push({ message: `Element <${el.name}> is not closed.`, range: el.nameRange });
	}
	return { elements, root: elements[0], problems, open: stack, incomplete };
}

/** Text between the start and closing tags, with nested tags stripped and whitespace collapsed. */
export function innerText(text: string, el: XmlElement): string {
	if (el.contentEnd === undefined) return '';
	return text
		.slice(el.startTagEnd, el.contentEnd)
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The first element of `text` (its start tag only), without parsing the rest. */
export function scanRootElement(text: string): XmlElement | undefined {
	let i = 0;
	for (;;) {
		const lt = text.indexOf('<', i);
		if (lt < 0) return undefined;
		if (text.startsWith('<!--', lt)) i = text.indexOf('-->', lt);
		else if (text.startsWith('<?', lt)) i = text.indexOf('?>', lt);
		else if (text.startsWith('<!', lt)) i = text.indexOf('>', lt);
		else if (text[lt + 1] === '/') return undefined;
		else return scanStartTag(text, lt).element;
		if (i < 0) return undefined;
	}
}
