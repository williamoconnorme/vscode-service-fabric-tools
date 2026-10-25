// Builds media/sf-icons.woff: an icon font with the Service Fabric mark
// (the activity-bar icon) so it can be used as $(service-fabric) in the
// status bar, and the seed-node glyph used as $(service-fabric-seed-node) in the
// Clusters view. Font glyphs must be filled, so the pentagon's stroked edges are
// turned into thin bars and the nodes into filled circles.
// Usage: npm run icon-font
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const svg2ttf = require('svg2ttf');
const ttf2woff = require('ttf2woff');
const svgpath = require('svgpath');

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

// Seed-node icon from Service Fabric Explorer (src/SfxWeb/src/assets/seed.svg,
// MIT License, Copyright (c) Microsoft Corporation), 24×24 view box.
const SEED =
	'M22 7v2.5c0 3.59-2.91 6.5-6.5 6.5H13v5h-2v-7l.019-1c.255-3.356 3.06-6 6.481-6H22zM6 3c3.092 0 5.716 2.005 6.643 4.786-1.5 1.275-2.49 3.128-2.627 5.214H9c-3.866 0-7-3.134-7-7V3h4z';
// The codicon `vm` (CC BY 4.0, Microsoft Corporation) in its 16×16 view box,
// redrawn with its bottom-right corner cut away (x ≥ 8, y ≥ 7) to make room
// for the seed: the screen's outline as one C-shaped contour, the left post of
// the stand, and the left half of the foot.
const VM_CUT = [
	'M3 1H13A2 2 0 0 1 15 3V7H14V3A1 1 0 0 0 13 2H3A1 1 0 0 0 2 3V10A1 1 0 0 0 3 11H8V12H3A2 2 0 0 1 1 10V3A2 2 0 0 1 3 1Z',
	'M5 12H6V14H5Z',
	'M3.5 14H8V15H3.5A0.5 0.5 0 0 1 3.5 14Z',
].join('');
// A seed node: the vm icon with the seed in the cut-away corner (seed box
// x 2..22, y 3..21 scaled to 7.5 wide at x 8.5, y 8.25).
const SEED_K = 7.5 / 20;
const seedNode =
	svgpath(VM_CUT).scale(EM / 16, -EM / 16).translate(0, EM).abs().round(2).toString() +
	svgpath(SEED)
		.translate(-2, -3)
		.scale(SEED_K)
		.translate(8.5, 8.25)
		.scale(EM / 16, -EM / 16)
		.translate(0, EM)
		.abs()
		.round(2)
		.toString();

const svgFont = `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg">
<defs>
<font id="sf-icons" horiz-adv-x="${EM}">
<font-face font-family="sf-icons" units-per-em="${EM}" ascent="${EM}" descent="0" />
<missing-glyph horiz-adv-x="0" />
<glyph glyph-name="service-fabric" unicode="&#xE001;" horiz-adv-x="${EM}" d="${glyph}" />
<glyph glyph-name="service-fabric-seed-node" unicode="&#xE002;" horiz-adv-x="${EM}" d="${seedNode}" />
</font>
</defs>
</svg>`;

const ttf = svg2ttf(svgFont, { ts: 0, description: 'Service Fabric Tools icons', url: '' });
const woff = ttf2woff(new Uint8Array(ttf.buffer));
writeFileSync('media/sf-icons.woff', Buffer.from(woff.buffer ?? woff));
console.log('Wrote media/sf-icons.woff (U+E001 service-fabric, U+E002 service-fabric-seed-node).');
