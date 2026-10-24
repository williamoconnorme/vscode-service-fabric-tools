"use strict";
/**
 * Tiny helpers that operate on raw XML text without the heavy
 * formatter machinery — used when we need to find positions
 * (for diagnostics / definition / code actions) rather than mutate.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAttributeOccurrences = findAttributeOccurrences;
exports.findParameterRefs = findParameterRefs;
exports.offsetToLineCol = offsetToLineCol;
/** Locate every occurrence of an attribute value on a given element name. */
function findAttributeOccurrences(text, elementLocalName, attribute) {
    const results = [];
    // Match opening tags. Non-greedy attribute scan; supports namespaces.
    const tagRe = new RegExp(`<(?:[A-Za-z_][\\w\\-.]*:)?${escapeRe(elementLocalName)}\\b([^>]*?)/?>`, 'g');
    let m;
    while ((m = tagRe.exec(text)) !== null) {
        const tagStart = m.index;
        const tagEnd = m.index + m[0].length;
        const attrs = m[1];
        const attrRe = new RegExp(`\\b${escapeRe(attribute)}\\s*=\\s*"([^"]*)"`);
        const am = attrRe.exec(attrs);
        if (am) {
            const valueIndexInAttrs = am.index + am[0].indexOf('"') + 1;
            const valueStart = tagStart + 1 /* < */ + (m[0].indexOf(attrs)) + valueIndexInAttrs;
            // The above is brittle if element has namespace. Recompute by searching whole tag text.
            const fullTag = m[0];
            const attrInTag = new RegExp(`\\b${escapeRe(attribute)}\\s*=\\s*"`).exec(fullTag);
            if (attrInTag) {
                const start = tagStart + attrInTag.index + attrInTag[0].length;
                const end = start + am[1].length;
                results.push({
                    value: am[1],
                    valueRange: { start, end },
                    elementRange: { start: tagStart, end: tagEnd }
                });
            }
            else {
                results.push({
                    value: am[1],
                    valueRange: { start: valueStart, end: valueStart + am[1].length },
                    elementRange: { start: tagStart, end: tagEnd }
                });
            }
        }
    }
    return results;
}
/** Find every `[ParameterName]` substitution in the text. */
function findParameterRefs(text) {
    const results = [];
    const re = /\[([A-Za-z_][\w\-.]*)\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        results.push({
            name: m[1],
            range: { start: m.index, end: m.index + m[0].length }
        });
    }
    return results;
}
function offsetToLineCol(text, offset) {
    let line = 0;
    let lastNl = -1;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
            line++;
            lastNl = i;
        }
    }
    return { line, col: offset - lastNl - 1 };
}
function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=xmlText.js.map