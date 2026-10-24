// Generates the extension's icons: a woven lattice of four strands (the "fabric"),
// each strand ending in a cluster node, with a service node at the centre.
// Usage: npm run icons  (writes into media/)
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const outDir = path.join(__dirname, '..', 'media');

// Lattice geometry in a frame rotated 45°, centred on (0,0).
function weave({ s, L, w, gap, nodeR }) {
	// Horizontal strands at y = ±s, vertical at x = ±s, each running from -L to +L.
	// Over/under alternates around the square: H over at (-s,-s) and (s,s); V over elsewhere.
	const cut = w / 2 + gap;
	const hUnder = [[s, -s], [-s, s]]; // where V passes over H
	const vUnder = [[-s, -s], [s, s]]; // where H passes over V
	const hMask = hUnder.map(([x, y]) => `<rect x="${x - cut}" y="${y - w}" width="${2 * cut}" height="${2 * w}" fill="#000"/>`).join('');
	const vMask = vUnder.map(([x, y]) => `<rect x="${x - w}" y="${y - cut}" width="${2 * w}" height="${2 * cut}" fill="#000"/>`).join('');
	const big = L + nodeR + 4;
	const h = [-s, s].map((y) => `<line x1="${-L}" y1="${y}" x2="${L}" y2="${y}"/>`).join('');
	const v = [-s, s].map((x) => `<line x1="${x}" y1="${-L}" x2="${x}" y2="${L}"/>`).join('');
	const ends = [-s, s].flatMap((o) => [[-L, o], [L, o], [o, -L], [o, L]]);
	return { hMask, vMask, big, h, v, ends };
}

function marketplaceSvg() {
	const g = weave({ s: 30, L: 70, w: 15, gap: 7, nodeR: 13 });
	const nodes = g.ends.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13"/>`).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b8cf2"/>
      <stop offset="1" stop-color="#0a3d8f"/>
    </linearGradient>
    <radialGradient id="core" cx="0.5" cy="0.4" r="0.6">
      <stop offset="0" stop-color="#b8fff0"/>
      <stop offset="1" stop-color="#2fd3b0"/>
    </radialGradient>
    <mask id="hm" maskUnits="userSpaceOnUse" x="${-g.big}" y="${-g.big}" width="${2 * g.big}" height="${2 * g.big}">
      <rect x="${-g.big}" y="${-g.big}" width="${2 * g.big}" height="${2 * g.big}" fill="#fff"/>${g.hMask}
    </mask>
    <mask id="vm" maskUnits="userSpaceOnUse" x="${-g.big}" y="${-g.big}" width="${2 * g.big}" height="${2 * g.big}">
      <rect x="${-g.big}" y="${-g.big}" width="${2 * g.big}" height="${2 * g.big}" fill="#fff"/>${g.vMask}
    </mask>
  </defs>
  <rect width="256" height="256" rx="52" fill="url(#bg)"/>
  <g transform="translate(128 128) rotate(45)">
    <g stroke="#e9f4ff" stroke-width="15" stroke-linecap="round" fill="none">
      <g mask="url(#hm)">${g.h}</g>
      <g mask="url(#vm)">${g.v}</g>
    </g>
    <g fill="#ffffff">${nodes}</g>
    <circle r="20" fill="#0a3d8f" opacity="0.35"/>
    <circle r="15" fill="url(#core)"/>
  </g>
</svg>
`;
}

// Single-colour glyph for the activity bar and file icons (VS Code tints it).
function glyphSvg(color) {
	const g = weave({ s: 3.4, L: 7.4, w: 1.4, gap: 1.1, nodeR: 1.5 });
	const nodes = g.ends.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.5"/>`).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <defs>
    <mask id="hm" maskUnits="userSpaceOnUse" x="${-g.big}" y="${-g.big}" width="${2 * g.big}" height="${2 * g.big}">
      <rect x="${-g.big}" y="${-g.big}" width="${2 * g.big}" height="${2 * g.big}" fill="#fff"/>${g.hMask}
    </mask>
    <mask id="vm" maskUnits="userSpaceOnUse" x="${-g.big}" y="${-g.big}" width="${2 * g.big}" height="${2 * g.big}">
      <rect x="${-g.big}" y="${-g.big}" width="${2 * g.big}" height="${2 * g.big}" fill="#fff"/>${g.vMask}
    </mask>
  </defs>
  <g transform="translate(12 12) rotate(45)">
    <g stroke="${color}" stroke-width="1.4" stroke-linecap="round" fill="none">
      <g mask="url(#hm)">${g.h}</g>
      <g mask="url(#vm)">${g.v}</g>
    </g>
    <g fill="${color}">${nodes}<circle r="1.5"/></g>
  </g>
</svg>
`;
}

fs.mkdirSync(outDir, { recursive: true });
const write = (name, svg) => fs.writeFileSync(path.join(outDir, name), svg);
write('icon.svg', marketplaceSvg());
write('activitybar.svg', glyphSvg('#c5c5c5'));
write('sfproj-light.svg', glyphSvg('#0a5bbf'));
write('sfproj-dark.svg', glyphSvg('#5fb0ff'));
const png = new Resvg(marketplaceSvg(), { fitTo: { mode: 'width', value: 256 } }).render().asPng();
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
// previews for review
console.log('icons written to media/');
