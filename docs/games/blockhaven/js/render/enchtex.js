// Textures for the enchanting blocks and the enchanted book, kept apart from the main block and
// item texture files. Each painter gets the Painter and a function returning another texture's
// pixels by name (so the table can sit on our own obsidian).
import { ramp, shade } from './paint.js?v=mush3opu';

const copy = (p, d) => { p.d.set(d); return p; };

// Deep red cloth with a woven shimmer.
function cloth(p, x, y, w, h) {
  p.dither(ramp('#b0262a', 0.16), [18, 34, 34, 14], { cells: 3, grain: 0.35, x0: x, y0: y, w, h });
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (((i + j) & 3) === 0) p.shadePx(i, j, 0.86);
}
// Brushed dark iron with soft highlights.
function iron(p, base) {
  p.dither(ramp(base, 0.1), [16, 34, 34, 16], { cells: 4, grain: 0.25 });
  for (let k = 0; k < 7; k++) { const x = p.rand(16), y = p.rand(16); p.put(x, y, shade(base, 1.25)); }
}

export const EXTRA_BLOCK_TEX = {
  // Obsidian rim, a red cloth spread over the top with gold trim, turquoise gems at the corners.
  enchanting_table_top: (p, other) => {
    copy(p, other('obsidian'));
    cloth(p, 2, 2, 12, 12);
    p.frame(2, 2, 12, 12, '#d8b048');
    p.frame(3, 3, 10, 10, '#7a1416');
    for (const [x, y] of [[1, 1], [13, 1], [1, 13], [13, 13]]) { p.rect(x, y, 2, 2, '#3ec8c0'); p.put(x, y, '#a8fff6'); }
    // A faint glyph circle in the cloth.
    for (let a = 0; a < 16; a++) { const t = a / 16 * Math.PI * 2, x = Math.round(7.5 + Math.cos(t) * 3.2), y = Math.round(7.5 + Math.sin(t) * 3.2); if (a % 2 === 0) p.put(x, y, '#e0546a'); }
  },
  // The cloth hangs over the upper edge; obsidian below, with a few teal glints.
  enchanting_table_side: (p, other) => {
    copy(p, other('obsidian'));
    cloth(p, 0, 4, 16, 5);
    p.hline(0, 8, 16, '#d8b048');
    for (let x = 1; x < 16; x += 3) p.put(x, 9, '#d8b048');
    p.hline(0, 4, 16, '#7a1416');
    for (const [x, y] of [[3, 12], [10, 13], [13, 11]]) p.put(x, y, '#3ec8c0');
  },
  enchanting_table_bottom: (p, other) => copy(p, other('obsidian')),
  // Anvil body: dark worked iron with a rim of light along the edges.
  anvil: p => {
    iron(p, '#4a4a4a');
    p.hline(0, 0, 16, '#5e5e5e'); p.hline(0, 15, 16, '#333333');
  },
  // The working face: lighter steel inside a dark border; wear adds cracks.
  anvil_top: p => anvilTop(p, 0),
  chipped_anvil_top: p => anvilTop(p, 1),
  damaged_anvil_top: p => anvilTop(p, 2),
};
function anvilTop(p, wear) {
  iron(p, '#4a4a4a');
  p.dither(ramp('#6e6e6e', 0.08), [14, 36, 36, 14], { cells: 4, grain: 0.2, x0: 4, y0: 1, w: 8, h: 14 });
  p.frame(3, 0, 10, 16, '#3a3a3a');
  for (let y = 2; y < 14; y += 4) p.hline(5, y, 6, '#7c7c7c');
  const cracks = [[[5, 3], [6, 4], [6, 5], [7, 6]], [[10, 9], [9, 10], [9, 11], [8, 12], [8, 13]], [[6, 10], [7, 9], [7, 8]], [[9, 2], [10, 3], [10, 4]]];
  const n = wear === 0 ? 0 : wear === 1 ? 2 : 4;
  for (let c = 0; c < n; c++) for (const [x, y] of cracks[c]) p.put(x, y, '#1e1e1e');
}

// The enchanted book: the book's shape with a violet cover and gold edging.
export const EXTRA_ITEM_TEX = {
  enchanted_book: (p, sil, px) => {
    sil(p, px`
.
..33333333331
..s2222222221p
..s2222222221pq
..s22yyyyy221pq
..s2y22222y21pq
..s22yyyyy221pq
..s2222222221pq
..s2222y22221pq
..s222yyy2221pq
..s2222y22221pq
..s2222222221pq
..s1111111111pq
...pppppppppppq
....qqqqqqqqqq`, ['#2a1040', '#4a2070', '#6a3098', '#8c48c0'], { s: '#200a34', p: '#f0ece0', q: '#b8b0a0', y: '#f0c858' });
  },
};
