// Title-screen art generated at startup: the blocky stone logo, its subtitle banner, and the
// noise tile behind every menu button. Drawn at 1 canvas px per GUI px and scaled up pixelated.
const GLYPHS = {
  A: ['.###.', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#....', '#####'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '###'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  ' ': ['...', '...', '...', '...', '...', '...'],
};
// Glyph cells of a string as a boolean grid (1-cell gap between letters).
function cells(text, gap = 1) {
  const rows = Array.from({ length: 6 }, () => []);
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let y = 0; y < 6; y++) { if (i) for (let k = 0; k < gap; k++) rows[y].push(false); for (const c of g[y]) rows[y].push(c === '#'); }
  });
  return rows;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const hex = v => `rgb(${v[0] | 0},${v[1] | 0},${v[2] | 0})`;

// Stone letters: every glyph cell is a CELL x CELL chunk of speckled stone, bevelled against empty
// neighbours, standing on a dark extruded side and wrapped in a black outline.
export function buildLogo(title, subtitle) {
  const CELL = 4, DEPTH = 4, g = cells(title), gw = g[0].length, gh = 6;
  const sub = cells(subtitle, 2), SC = 2, sw = sub[0].length * SC;
  const W = Math.max(gw * CELL, sw + 8) + DEPTH + 4, top = 2, H = top + gh * CELL + DEPTH + 2 + SC * 6 - 2 + 4;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const ox = ((W - DEPTH - gw * CELL) >> 1) + 1, on = (cx, cy) => cy >= 0 && cy < gh && cx >= 0 && cx < gw && g[cy][cx];
  const px = (X, Y, c) => { x.fillStyle = c; x.fillRect(X, Y, 1, 1); };
  const solid = new Uint8Array(W * H);
  const mark = (X, Y) => { if (X >= 0 && Y >= 0 && X < W && Y < H) solid[Y * W + X] = 1; };
  // Extrusion, back to front.
  for (let d = DEPTH; d >= 1; d--) for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) if (on(cx, cy)) {
    const v = 58 + (DEPTH - d) * 10;
    for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) { const X = ox + cx * CELL + i + (d >> 1), Y = top + cy * CELL + j + d; const n = v + rnd() * 10; px(X, Y, hex([n, n, n + 2])); mark(X, Y); }
  }
  // Front faces.
  for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) if (on(cx, cy)) {
    for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) {
      let n = 150 + rnd() * 40 - (rnd() < 0.12 ? 38 : 0);
      if (j === 0 && !on(cx, cy - 1)) n = 222 + rnd() * 14;
      else if (i === 0 && !on(cx - 1, cy)) n = 200 + rnd() * 12;
      else if (j === CELL - 1 && !on(cx, cy + 1)) n = 112 + rnd() * 10;
      else if (i === CELL - 1 && !on(cx + 1, cy)) n = 128 + rnd() * 10;
      const X = ox + cx * CELL + i, Y = top + cy * CELL + j;
      px(X, Y, hex([n, n, n])); mark(X, Y);
    }
  }
  // Black outline around the whole silhouette.
  const img = x.getImageData(0, 0, W, H);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    if (solid[Y * W + X]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const a = X + dx, b = Y + dy; return a >= 0 && b >= 0 && a < W && b < H && solid[b * W + a]; })) {
      const o = (Y * W + X) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 12; img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  // Subtitle plate lettering: light letters with a dark rim, overlapping the logo's base.
  const sy = top + gh * CELL + DEPTH - 2, sx = (W - sw) >> 1;
  const sOn = (cx, cy) => cy >= 0 && cy < 6 && cx >= 0 && cx < sub[0].length && sub[cy][cx];
  const subPx = [];
  for (let Y = -1; Y <= 6 * SC; Y++) for (let X = -1; X <= sw; X++) {
    const inside = sOn(Math.floor(X / SC), Math.floor(Y / SC));
    if (inside) subPx.push([X, Y, Y < SC ? '#f4f4f4' : Y >= 5 * SC ? '#a8a8a8' : '#d8d8d8']);
  }
  const subSet = new Set(subPx.map(([X, Y]) => `${X},${Y}`));
  for (const [X, Y] of subPx) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    if (!subSet.has(`${X + dx},${Y + dy}`)) { px(sx + X + dx, sy + Y + dy, '#2a2a2a'); mark(sx + X + dx, sy + Y + dy); }
  }
  for (const [X, Y, c] of subPx) px(sx + X, sy + Y, c);
  return cv;
}

// 16x16 speckled grey tile used as the button face.
export function buttonTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const x = cv.getContext('2d');
  for (let y = 0; y < 16; y++) for (let i = 0; i < 16; i++) { const n = 106 + rnd() * 16 + (rnd() < 0.08 ? -12 : 0); x.fillStyle = hex([n, n, n]); x.fillRect(i, y, 1, 1); }
  return cv.toDataURL();
}

// Tiny pixel icons for the square side buttons.
export function iconDataURL(kind) {
  const art = {
    sound: ['........', '...#..#.', '..##...#', '####.#.#', '####.#.#', '..##...#', '...#..#.', '........'],
    mute: ['........', '...#....', '..##.#.#', '####..#.', '####..#.', '..##.#.#', '...#....', '........'],
    full: ['###..###', '#......#', '#......#', '........', '........', '#......#', '#......#', '###..###'],
  }[kind];
  const cv = document.createElement('canvas'); cv.width = cv.height = 8;
  const x = cv.getContext('2d');
  art.forEach((r, y) => [...r].forEach((c, i) => { if (c === '#') { x.fillStyle = '#e0e0e0'; x.fillRect(i, y, 1, 1); } }));
  return cv.toDataURL();
}
