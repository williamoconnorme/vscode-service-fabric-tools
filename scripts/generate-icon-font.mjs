// Builds media/sf-icons.woff: an icon font with the Service Fabric mark
// (the activity-bar icon) so it can be used as $(service-fabric) in the
// status bar. Font glyphs must be filled, so the pentagon's stroked edges are
// turned into thin bars and the nodes into filled circles.
// Usage: npm run icon-font
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const svg2ttf = require('svg2ttf');
const ttf2woff = require('ttf2woff');

// Geometry of media/activitybar.svg (24×24 view box).
const VERTICES = [
	[12, 5.03],
	[19.323, 10.351],
	[16.526, 18.959],
	[7.474, 18.959],
	[4.677, 10.351],
];
const NODE_R = 3.2;
const STROKE = 1.6;

const EM = 1000;
const scale = EM / 24;
// SVG fonts are y-up with the baseline at 0; map the 24×24 box onto 0..EM.
const pt = ([x, y]) => [x * scale, (24 - y) * scale];
const fmt = (n) => n.toFixed(2);

/** Signed area in font (y-up) space; positive means counter-clockwise. */
function area(points) {
	let a = 0;
	for (let i = 0; i < points.length; i++) {
		const [x1, y1] = points[i];
		const [x2, y2] = points[(i + 1) % points.length];
		a += x1 * y2 - x2 * y1;
	}
	return a / 2;
}

/** A closed polygon contour, wound clockwise (all contours share one direction for the non-zero rule). */
function polygon(points) {
	const pts = area(points) > 0 ? [...points].reverse() : points;
	return `M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`;
}

/** A filled circle as two clockwise arcs (y-up: sweep flag 0 is clockwise). */
function circle([cx, cy], r) {
	return `M${fmt(cx - r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)}Z`;
}

/** The stroke of segment a→b as a thin rectangle. */
function bar(a, b, width) {
	const [ax, ay] = pt(a);
	const [bx, by] = pt(b);
	const len = Math.hypot(bx - ax, by - ay);
	const nx = (-(by - ay) / len) * (width / 2);
	const ny = ((bx - ax) / len) * (width / 2);
	return polygon([
		[ax + nx, ay + ny],
		[bx + nx, by + ny],
		[bx - nx, by - ny],
		[ax - nx, ay - ny],
	]);
}

const w = STROKE * scale;
const glyph = [
	...VERTICES.map((v, i) => bar(v, VERTICES[(i + 1) % VERTICES.length], w)),
	...VERTICES.map((v) => circle(pt(v), NODE_R * scale)),
].join('');

const svgFont = `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg">
<defs>
<font id="sf-icons" horiz-adv-x="${EM}">
<font-face font-family="sf-icons" units-per-em="${EM}" ascent="${EM}" descent="0" />
<missing-glyph horiz-adv-x="0" />
<glyph glyph-name="service-fabric" unicode="&#xE001;" horiz-adv-x="${EM}" d="${glyph}" />
</font>
</defs>
</svg>`;

const ttf = svg2ttf(svgFont, { ts: 0, description: 'Service Fabric Tools icons', url: '' });
const woff = ttf2woff(new Uint8Array(ttf.buffer));
writeFileSync('media/sf-icons.woff', Buffer.from(woff.buffer ?? woff));
console.log('Wrote media/sf-icons.woff (U+E001 service-fabric).');
