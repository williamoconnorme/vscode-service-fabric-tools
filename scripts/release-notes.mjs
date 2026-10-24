// Prints the CHANGELOG.md section for a version (the text under "## <version>"
// up to the next "## " heading), for the GitHub release notes.
// Usage: node scripts/release-notes.mjs 1.2.0
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
	console.error('Usage: node scripts/release-notes.mjs <version>');
	process.exit(1);
}
const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => new RegExp(`^##\\s+\\[?v?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(l));
if (start < 0) {
	console.error(`CHANGELOG.md has no "## ${version}" section.`);
	process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
if (end < 0) end = lines.length;
console.log(lines.slice(start + 1, end).join('\n').trim());
