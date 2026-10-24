/**
 * Validates an XML document against a {@link SchemaModel}:
 *
 * - SFX001 (error)   XML is not well-formed.
 * - SFX101 (error)   Element is not allowed here.
 * - SFX102 (error)   Attribute is not allowed on this element.
 * - SFX103 (error)   Required attribute is missing.
 * - SFX104 (error)   Attribute value is not one of the enumerated values.
 * - SFX105 (error)   Required child element is missing (not reported on an empty root element).
 * - SFX106 (warning) Element appears more times than allowed.
 * - SFX107 (warning) Element does not allow text content.
 *
 * Child order inside `xs:sequence` and value formats other than enumerations
 * are not checked. Values containing `[Parameter]` references are not checked
 * either, since they are substituted at deployment.
 */
import { parseXml, type TextRange, type XmlElement } from './xmlScanner';
import { isInfrastructureAttribute, isSchemaRoot, resolveElement, type SchemaModel, type SchemaType } from './schemaModel';

export interface SchemaIssue {
	code: string;
	severity: 'error' | 'warning';
	message: string;
	range: TextRange;
}

/**
 * Returns the problems in `text`. Schema checks only run when the root element
 * is a global element of `model` in its namespace; well-formedness is always checked.
 */
export function validateDocument(text: string, model: SchemaModel): SchemaIssue[] {
	const doc = parseXml(text);
	const issues: SchemaIssue[] = doc.problems.map((p) => ({ code: 'SFX001', severity: 'error', message: p.message, range: p.range }));
	const root = doc.root;
	if (!root || !isSchemaRoot(model, root)) return issues;
	const resolved = resolveElement(model, [root.localName]);
	if (resolved) validateElement(root, resolved.type, model, issues);
	return issues;
}

function isBoolean(value: string): boolean {
	return value === 'true' || value === 'false' || value === '1' || value === '0';
}

function validateElement(el: XmlElement, type: SchemaType, model: SchemaModel, issues: SchemaIssue[]): void {
	const tag = `<${el.localName}>`;

	for (const attr of el.attributes) {
		if (isInfrastructureAttribute(attr.name)) continue;
		const decl = type.attributes.find((a) => a.name === attr.name);
		if (!decl) {
			if (!type.anyAttributes) {
				issues.push({ code: 'SFX102', severity: 'error', message: `Attribute '${attr.name}' is not allowed on ${tag}.`, range: attr.nameRange });
			}
			continue;
		}
		if (!decl.values || !attr.valueRange || attr.value.includes('[')) continue;
		const ok = decl.type === 'boolean' ? isBoolean(attr.value) : decl.values.includes(attr.value);
		if (!ok) {
			issues.push({
				code: 'SFX104',
				severity: 'error',
				message: `'${attr.value}' is not a valid value for '${attr.name}'. Expected one of: ${decl.values.join(', ')}.`,
				range: attr.valueRange,
			});
		}
	}
	for (const decl of type.attributes) {
		if (decl.required && !el.attributes.some((a) => a.name === decl.name)) {
			issues.push({ code: 'SFX103', severity: 'error', message: `${tag} is missing required attribute '${decl.name}'.`, range: el.nameRange });
		}
	}

	const counts = new Map<string, number>();
	for (const child of el.children) {
		const decl = type.children.find((c) => c.name === child.localName);
		if (!decl) {
			if (!type.anyChildren) {
				const allowed = type.children.map((c) => c.name);
				const hint = allowed.length ? ` Allowed: ${allowed.join(', ')}.` : ` ${tag} has no child elements.`;
				issues.push({ code: 'SFX101', severity: 'error', message: `Element <${child.localName}> is not allowed in ${tag}.${hint}`, range: child.nameRange });
			}
			continue;
		}
		const count = (counts.get(decl.name) ?? 0) + 1;
		counts.set(decl.name, count);
		const max = decl.max ?? 1;
		if (max !== 'unbounded' && count > max) {
			issues.push({
				code: 'SFX106',
				severity: 'warning',
				message: `<${decl.name}> can appear at most ${max} time${max === 1 ? '' : 's'} in ${tag}.`,
				range: child.nameRange,
			});
		}
		const childType = model.types[decl.type];
		if (childType) validateElement(child, childType, model, issues);
	}
	// An empty root is a placeholder (the actor ServiceManifest stub is filled in at build time).
	const placeholder = !el.parent && el.children.length === 0 && el.text.length === 0;
	for (const decl of type.children) {
		if (decl.required && !placeholder && !counts.has(decl.name)) {
			issues.push({ code: 'SFX105', severity: 'error', message: `${tag} is missing required child element <${decl.name}>.`, range: el.nameRange });
		}
	}

	if (!type.text && !type.anyChildren && el.text.length > 0) {
		issues.push({ code: 'SFX107', severity: 'warning', message: `${tag} does not allow text content.`, range: el.text[0] });
	}
}
