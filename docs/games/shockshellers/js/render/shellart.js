// What is painted on a shell: its colour with a few speckles, a pattern in a second colour, a stamp
// on the front, and the cracks that grow as it takes damage (GDD §5). Drawn with the 2D canvas into
// the shell's texture (u wraps once around the egg, v runs from the bottom up), and into the shop's
// little previews, so this module has no 3D in it.
//
// The shell is about 2.8 times wider around than it is tall, so drawing happens in "shell units":
// one unit is a tenth of the egg's height horizontally and vertically alike (sx, sy below), and
// shapes come out round on the egg rather than squashed.

const hex = c => '#' + c.toString(16).padStart(6, '0');
// A darker (k < 0) or lighter (k > 0) shade of a colour.
function shade(c, k) {
  const ch = s => { const v = (c >> s) & 255; return Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k); };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
function rng(seed) { let s = seed % 2147483647 || 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// Units: the texture is S×S; u spans the circumference (28.4 units at the widest) and v the height
// (10 units). sx/sy convert units to pixels.
const AROUND = 28.4, TALL = 10;
function frame(x, S) { return { sx: S / AROUND, sy: S / TALL }; }
// Run fn three times, shifted a full turn left and right, so shapes that cross the seam wrap.
function wrap(x, S, fn) { for (const off of [-S, 0, S]) { x.save(); x.translate(off, 0); fn(); x.restore(); } }
// An ellipse at (u, v) in units (v up from the bottom), radii in units.
function blob(x, S, u, v, rx, ry, rot = 0) {
  const { sx, sy } = frame(x, S);
  x.beginPath(); x.ellipse(u * sx, S - v * sy, rx * sx, ry * sy, rot, 0, Math.PI * 2); x.fill();
}
// Place a unit-space drawing at (u, v) with scale k: inside fn, (0,0) is that point, +y is down.
function at(x, S, u, v, k, fn) {
  const { sx, sy } = frame(x, S);
  x.save(); x.translate(u * sx, S - v * sy); x.scale(sx * k, sy * k); fn(); x.restore();
}
function star(x, cx, cy, r1, r2, n = 5) {
  x.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? r2 : r1; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  x.closePath();
}
function heart(x, cx, cy, r) {
  x.beginPath(); x.moveTo(cx, cy + r * 0.9);
  x.bezierCurveTo(cx - r * 1.4, cy - r * 0.1, cx - r * 0.7, cy - r * 1.1, cx, cy - r * 0.45);
  x.bezierCurveTo(cx + r * 0.7, cy - r * 1.1, cx + r * 1.4, cy - r * 0.1, cx, cy + r * 0.9); x.closePath();
}
function bolt(x, cx, cy, s) {
  x.beginPath(); for (const [px, py] of [[0.2, -1], [-0.45, 0.1], [0, 0.1], [-0.25, 1], [0.5, -0.2], [0.05, -0.2], [0.35, -1]]) x.lineTo(cx + px * s, cy + py * s); x.closePath();
}
function flame(x, cx, cy, s) {
  x.beginPath(); x.moveTo(cx, cy + s);
  x.bezierCurveTo(cx - s * 0.9, cy + s * 0.9, cx - s * 0.7, cy - s * 0.1, cx - s * 0.2, cy - s * 0.4);
  x.bezierCurveTo(cx - s * 0.2, cy - s * 0.1, cx, cy, cx + s * 0.05, cy - s * 0.15);
  x.bezierCurveTo(cx + s * 0.1, cy - s * 0.6, cx + s * 0.05, cy - s * 0.8, cx + s * 0.2, cy - s * 1.1);
  x.bezierCurveTo(cx + s * 0.9, cy - s * 0.5, cx + s * 0.9, cy + s * 0.8, cx, cy + s); x.closePath();
}

// Patterns, drawn in the pattern colour p over the base colour c.
const PATTERN = {
  spots(x, S, c, p, r) { x.fillStyle = p; wrap(x, S, () => { for (let i = 0; i < 9; i++) { const u = r() * AROUND, v = 1 + r() * 8; for (let j = 0; j < 4; j++) blob(x, S, u + (r() - 0.5) * 1.6, v + (r() - 0.5) * 1.2, 0.5 + r() * 0.9, 0.4 + r() * 0.7, r() * 3); } }); },
  stripes(x, S, c, p) { x.fillStyle = p; for (const v of [2.2, 4.2, 6.2, 8.1]) x.fillRect(0, S - (v + 0.45) * frame(x, S).sy, S, 0.9 * frame(x, S).sy); },
  zigzag(x, S, c, p) {
    const { sy } = frame(x, S), n = 14, w = S / n;
    x.fillStyle = p;
    for (const v of [3.6, 6.4]) { x.beginPath(); for (let i = 0; i <= n; i++) x.lineTo(i * w, S - (v + (i % 2 ? 0.9 : -0.9)) * sy); for (let i = n; i >= 0; i--) x.lineTo(i * w, S - (v + (i % 2 ? 0.9 : -0.9) - 0.8) * sy); x.fill(); }
  },
  polka(x, S, c, p) { x.fillStyle = p; for (let row = 0; row < 7; row++) for (let i = 0; i < 12; i++) blob(x, S, (i + (row % 2) * 0.5) * AROUND / 12, 1.2 + row * 1.35, 0.42, 0.42); },
  hearts(x, S, c, p) { x.fillStyle = p; for (let row = 0; row < 5; row++) for (let i = 0; i < 9; i++) at(x, S, (i + (row % 2) * 0.5) * AROUND / 9, 1.6 + row * 1.75, 1, () => { heart(x, 0, 0, 0.55); x.fill(); }); },
  stars(x, S, c, p) { x.fillStyle = p; for (let row = 0; row < 5; row++) for (let i = 0; i < 9; i++) at(x, S, (i + (row % 2) * 0.5) * AROUND / 9, 1.5 + row * 1.8, 1, () => { star(x, 0, 0, 0.7, 0.3); x.fill(); }); },
  checker(x, S, c, p) { x.fillStyle = p; const n = 20, w = AROUND / n; for (let row = 0; row < Math.ceil(TALL / w); row++) for (let i = 0; i < n; i++) if ((i + row) % 2) x.fillRect(i * w * frame(x, S).sx, S - (row + 1) * w * frame(x, S).sy, w * frame(x, S).sx + 0.5, w * frame(x, S).sy + 0.5); },
  split(x, S, c, p) { const { sy } = frame(x, S); x.fillStyle = p; x.beginPath(); x.moveTo(0, S); for (let i = 0; i <= 32; i++) x.lineTo(i / 32 * S, S - (4.4 + Math.sin(i / 32 * Math.PI * 8) * 0.25) * sy); x.lineTo(S, S); x.fill(); },
  band(x, S, c, p) { const { sx } = frame(x, S); x.fillStyle = p; for (const u of [AROUND / 2, 0, AROUND]) { x.fillRect((u - 1.1) * sx, 0, 2.2 * sx, S); } x.fillStyle = c; for (const u of [AROUND / 2, 0, AROUND]) for (const d of [-0.55, 0.55]) x.fillRect((u + d - 0.12) * sx, 0, 0.24 * sx, S); },
  freckles(x, S, c, p, r) { x.fillStyle = p; for (let i = 0; i < 70; i++) blob(x, S, AROUND / 2 + (r() - 0.5) * 9, 4 + r() * 3, 0.12 + r() * 0.1, 0.12 + r() * 0.1); },
  camo(x, S, c, p, r, pc) {
    for (const [col, n] of [[shade(pc, -0.35), 10], [p, 12], [shade(pc, 0.35), 8]]) { x.fillStyle = col; wrap(x, S, () => { for (let i = 0; i < n; i++) { const u = r() * AROUND, v = r() * TALL; for (let j = 0; j < 5; j++) blob(x, S, u + (r() - 0.5) * 2.2, v + (r() - 0.5) * 1.2, 0.6 + r() * 0.8, 0.45 + r() * 0.5, r() * 3); } }); }
  },
  flames(x, S, c, p, r, pc) { for (const [col, k] of [[p, 1], [shade(pc, 0.55), 0.6]]) { x.fillStyle = col; for (let i = 0; i < 10; i++) at(x, S, (i + 0.5) * AROUND / 10, 1.6 * k + 0.4, 1.0, () => { flame(x, 0, 0, 2.2 * k); x.fill(); }); } },
  bolts(x, S, c, p) { x.fillStyle = p; for (let i = 0; i < 7; i++) at(x, S, (i + 0.5) * AROUND / 7, 5, 1, () => { bolt(x, 0, 0, 2.4); x.fill(); }); },
  scales(x, S, c, p) {
    const { sx, sy } = frame(x, S); x.strokeStyle = p; x.lineWidth = Math.max(1, sx * 0.22);
    for (let row = 0; row < 12; row++) for (let i = 0; i <= 16; i++) { x.beginPath(); x.ellipse((i + (row % 2) * 0.5) * AROUND / 16 * sx, S - (row * 0.9 + 0.4) * sy, 0.88 * sx, 0.9 * sy, 0, 0, Math.PI); x.stroke(); }
  },
  swirl(x, S, c, p) { const { sx } = frame(x, S); x.fillStyle = p; for (let i = 0; i < 6; i++) { const u = i * AROUND / 6; x.beginPath(); x.moveTo((u - 1) * sx, S); x.lineTo((u + 1) * sx, S); x.lineTo((u + 1 + 6) * sx, 0); x.lineTo((u - 1 + 6) * sx, 0); x.fill(); x.save(); x.translate(-S, 0); x.fill(); x.restore(); } },
  tiger(x, S, c, p, r) {
    const { sx, sy } = frame(x, S); x.fillStyle = p;
    for (let i = 0; i < 16; i++) { const u = (i + r() * 0.4) * AROUND / 16, top = r() < 0.5; const v0 = top ? TALL : 0, v1 = top ? 5.5 - r() * 2 : 4.5 + r() * 2;
      x.beginPath(); x.moveTo((u - 0.55) * sx, S - v0 * sy); x.quadraticCurveTo((u + 0.5) * sx, S - (v0 + v1) / 2 * sy, (u + 0.1) * sx, S - v1 * sy); x.quadraticCurveTo((u + 0.15) * sx, S - (v0 + v1) / 2 * sy, (u + 0.55) * sx, S - v0 * sy); x.fill(); }
  },
  galaxy(x, S, c, p, r, pc) {
    x.fillStyle = shade(pc, -0.6); x.fillRect(0, 0, S, S);
    const { sx, sy } = frame(x, S);
    for (let i = 0; i < 14; i++) { const u = r() * AROUND, v = r() * TALL, g = x.createRadialGradient(u * sx, S - v * sy, 0, u * sx, S - v * sy, (2 + r() * 3) * sx); g.addColorStop(0, i % 2 ? p : shade(pc, 0.4)); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.globalAlpha = 0.55; x.fillRect(0, 0, S, S); x.globalAlpha = 1; }
    x.fillStyle = '#fff'; for (let i = 0; i < 90; i++) blob(x, S, r() * AROUND, r() * TALL, 0.06 + r() * 0.08, 0.06 + r() * 0.08);
  },
};

// Stamps, drawn on the front of the shell (in units, centred on the face, +y down).
const INK = '#1b1b1f';
const STAMP = {
  smile(x) { x.fillStyle = INK; x.beginPath(); x.ellipse(-0.7, -0.6, 0.22, 0.32, 0, 0, 7); x.ellipse(0.7, -0.6, 0.22, 0.32, 0, 0, 7); x.fill(); x.lineWidth = 0.22; x.lineCap = 'round'; x.strokeStyle = INK; x.beginPath(); x.arc(0, -0.2, 0.95, 0.35, Math.PI - 0.35); x.stroke(); },
  googly(x) { for (const s of [-1, 1]) { x.fillStyle = '#fff'; x.strokeStyle = INK; x.lineWidth = 0.12; x.beginPath(); x.arc(s * 0.62, -0.6, 0.55, 0, 7); x.fill(); x.stroke(); x.fillStyle = INK; x.beginPath(); x.arc(s * 0.62 + 0.15 * s, -0.42, 0.26, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(s * 0.62 + 0.22 * s, -0.5, 0.07, 0, 7); x.fill(); } },
  shades(x) {
    x.fillStyle = INK; for (const s of [-1, 1]) { x.beginPath(); x.roundRect(s * 0.75 - 0.6, -0.95, 1.2, 0.7, [0.1, 0.1, 0.35, 0.35]); x.fill(); }
    x.fillRect(-0.2, -0.85, 0.4, 0.14); x.fillRect(-2.2, -0.9, 0.8, 0.12); x.fillRect(1.4, -0.9, 0.8, 0.12);
    x.fillStyle = 'rgba(255,255,255,.55)'; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(s * 0.75 - 0.4, -0.85); x.lineTo(s * 0.75 - 0.15, -0.85); x.lineTo(s * 0.75 - 0.45, -0.45); x.lineTo(s * 0.75 - 0.55, -0.6); x.fill(); }
  },
  mustache(x) {
    x.fillStyle = '#3a2416'; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(0, 0.0); x.bezierCurveTo(s * 0.5, -0.45, s * 1.1, -0.25, s * 1.3, -0.05); x.bezierCurveTo(s * 1.6, 0.15, s * 1.75, -0.2, s * 1.6, -0.35); x.bezierCurveTo(s * 1.9, -0.1, s * 1.6, 0.45, s * 1.1, 0.3); x.bezierCurveTo(s * 0.7, 0.2, s * 0.3, 0.25, 0, 0.15); x.fill(); }
    x.fillStyle = INK; x.beginPath(); x.ellipse(-0.6, -1.0, 0.18, 0.26, 0, 0, 7); x.ellipse(0.6, -1.0, 0.18, 0.26, 0, 0, 7); x.fill();
  },
  angry(x) { x.fillStyle = INK; x.beginPath(); x.ellipse(-0.65, -0.5, 0.2, 0.28, 0, 0, 7); x.ellipse(0.65, -0.5, 0.2, 0.28, 0, 0, 7); x.fill(); x.lineWidth = 0.22; x.lineCap = 'round'; x.strokeStyle = INK; x.beginPath(); x.moveTo(-1.05, -1.15); x.lineTo(-0.3, -0.85); x.moveTo(1.05, -1.15); x.lineTo(0.3, -0.85); x.stroke(); x.beginPath(); x.arc(0, 0.75, 0.6, Math.PI + 0.5, -0.5); x.stroke(); },
  blush(x) { x.fillStyle = 'rgba(255,110,140,.6)'; x.beginPath(); x.ellipse(-1.1, 0.05, 0.45, 0.25, 0, 0, 7); x.ellipse(1.1, 0.05, 0.45, 0.25, 0, 0, 7); x.fill(); x.lineWidth = 0.16; x.lineCap = 'round'; x.strokeStyle = INK; x.beginPath(); x.moveTo(-0.9, -0.5); x.lineTo(-0.6, -0.75); x.lineTo(-0.3, -0.5); x.moveTo(0.3, -0.5); x.lineTo(0.6, -0.75); x.lineTo(0.9, -0.5); x.stroke(); x.beginPath(); x.arc(0, -0.05, 0.25, 0.2, Math.PI - 0.2); x.stroke(); },
  star(x) { star(x, 0, -0.2, 1.2, 0.5); x.fillStyle = '#ffd23f'; x.fill(); x.lineWidth = 0.14; x.strokeStyle = '#8a5a00'; x.stroke(); },
  heart(x) { heart(x, 0, -0.2, 1.0); x.fillStyle = '#ff3b5c'; x.fill(); x.lineWidth = 0.12; x.strokeStyle = '#7a0f22'; x.stroke(); },
  bolt(x) { bolt(x, 0, -0.2, 1.3); x.fillStyle = '#ffd23f'; x.fill(); x.lineWidth = 0.12; x.strokeStyle = '#8a5a00'; x.stroke(); },
  flame(x) { flame(x, 0, -0.1, 1.2); x.fillStyle = '#ff6a1f'; x.fill(); flame(x, 0.05, 0.15, 0.65); x.fillStyle = '#ffd23f'; x.fill(); },
  paw(x) { x.fillStyle = INK; x.beginPath(); x.ellipse(0, 0.1, 0.62, 0.5, 0, 0, 7); x.fill(); for (const [px, py] of [[-0.75, -0.55], [-0.27, -0.95], [0.27, -0.95], [0.75, -0.55]]) { x.beginPath(); x.ellipse(px, py, 0.22, 0.28, 0, 0, 7); x.fill(); } },
  yolk(x) { x.fillStyle = '#fff'; x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 0.08; x.beginPath(); for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2, r = 1.1 + Math.sin(i * 2.7) * 0.18; x.lineTo(Math.cos(a) * r, -0.2 + Math.sin(a) * r * 0.85); } x.fill(); x.stroke(); x.fillStyle = '#ffb21f'; x.beginPath(); x.arc(0.1, -0.25, 0.45, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.arc(0, -0.38, 0.12, 0, 7); x.fill(); },
  clover(x) { x.fillStyle = '#3ccf7a'; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; heart(x, Math.cos(a) * 0.5, -0.2 + Math.sin(a) * 0.5, 0.5); x.fill(); } x.strokeStyle = '#2a8a50'; x.lineWidth = 0.14; x.beginPath(); x.moveTo(0, -0.2); x.quadraticCurveTo(0.2, 0.6, 0.5, 0.9); x.stroke(); },
  target(x) { for (const [r, c] of [[1.2, '#ff3b2a'], [0.9, '#fff'], [0.6, '#ff3b2a'], [0.3, '#fff']]) { x.fillStyle = c; x.beginPath(); x.arc(0, -0.2, r, 0, 7); x.fill(); } },
  number(x) { x.fillStyle = '#fff'; x.strokeStyle = INK; x.lineWidth = 0.14; x.beginPath(); x.arc(0, -0.2, 1.1, 0, 7); x.fill(); x.stroke(); x.fillStyle = INK; x.font = '900 1.5px n, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('7', 0, -0.12); },
  skull(x) { x.fillStyle = '#f6f4ee'; x.strokeStyle = INK; x.lineWidth = 0.1; x.beginPath(); x.arc(0, -0.45, 0.85, Math.PI * 0.85, Math.PI * 0.15); x.lineTo(0.5, 0.45); x.lineTo(-0.5, 0.45); x.closePath(); x.fill(); x.stroke(); x.fillStyle = INK; x.beginPath(); x.ellipse(-0.35, -0.4, 0.22, 0.25, 0, 0, 7); x.ellipse(0.35, -0.4, 0.22, 0.25, 0, 0, 7); x.fill(); x.beginPath(); x.moveTo(0, -0.1); x.lineTo(-0.1, 0.08); x.lineTo(0.1, 0.08); x.fill(); for (const d of [-0.25, 0, 0.25]) x.fillRect(d - 0.04, 0.2, 0.08, 0.25); },
  patch(x) { x.strokeStyle = INK; x.lineWidth = 0.14; x.beginPath(); x.moveTo(-2.4, -1.6); x.lineTo(2.4, 0.2); x.stroke(); x.fillStyle = INK; x.beginPath(); x.ellipse(0.65, -0.55, 0.45, 0.4, 0.3, 0, 7); x.fill(); x.beginPath(); x.ellipse(-0.65, -0.55, 0.2, 0.28, 0, 0, 7); x.fill(); x.lineWidth = 0.16; x.lineCap = 'round'; x.beginPath(); x.moveTo(-0.4, 0.3); x.quadraticCurveTo(0, 0.5, 0.4, 0.25); x.stroke(); },
};
export const PATTERN_IDS = Object.keys(PATTERN), STAMP_IDS = Object.keys(STAMP);

// The undamaged shell: base colour, speckles, pattern, stamp. look: { color, pattern, pcolor, stamp }
// as hex colours and ids.
export function paintShell(x, S, look) {
  const c = look.color, pc = look.pcolor ?? 0x2e2e34;
  x.fillStyle = hex(c); x.fillRect(0, 0, S, S);
  const r = rng(7 + c % 97);
  x.fillStyle = 'rgba(0,0,0,0.04)';
  for (let i = 0; i < 120; i++) { x.beginPath(); x.arc(r() * S, r() * S, (2 + r() * 4) * S / 512, 0, 7); x.fill(); }
  const pat = PATTERN[look.pattern];
  if (pat) { x.save(); pat(x, S, hex(c), hex(pc), rng(1234 + (look.pattern || '').length * 77), pc); x.restore(); }
  const st = STAMP[look.stamp];
  if (st) { x.save(); x.lineJoin = 'round'; at(x, S, AROUND / 2, 6.0, 1.7, () => st(x)); x.restore(); }
}

// Cracks (they grow at 80/60/40/20 HP): jagged, branching lines from seeds spread evenly around the
// shell, drawn as a dark groove with a pale lip beside it so they read at a distance. Later stages
// add seeds and lengthen the old ones; at the last stage flakes of shell are chipped out. Fixed seeds
// keep the cracks the same from stage to stage.
export function paintCracks(x, S, stage) {
  if (stage <= 0) return;
  const k = S / 512, paths = [];
  let s = 1;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 2 + stage * 2; n++) {
    s = 1000 + n * 7919;
    const Y = 2.8, pts = [[((n * 0.382) % 1) * S, S * (0.25 + ((n * 0.618) % 1) * 0.5)]];
    let a = r() * Math.PI * 2;
    const len = 4 + stage * 3;
    for (let j = 0; j < len; j++) {
      a += (r() - 0.5) * 1.6;
      const [px, py] = pts[pts.length - 1], d = (14 + r() * 16) * k;
      pts.push([px + Math.cos(a) * d * 0.7, py + Math.sin(a) * d * Y * 0.7]);
      if (r() < 0.35) { const b = a + (r() < 0.5 ? 1 : -1) * (0.7 + r() * 0.6), bd = (10 + r() * 18) * k; paths.push([[px, py], [px + Math.cos(b) * bd * 0.7, py + Math.sin(b) * bd * Y * 0.7], [px + Math.cos(b + 0.4) * bd * 1.2, py + Math.sin(b + 0.4) * bd * Y * 1.2]]); }
    }
    paths.unshift(pts);
  }
  const stroke = (style, w, dx, dy) => {
    x.strokeStyle = style; x.lineWidth = w * k;
    for (const off of [-S, 0, S]) for (const pts of paths) {
      x.beginPath(); x.moveTo(pts[0][0] + off + dx * k, pts[0][1] + dy * k);
      for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0] + off + dx * k, pts[i][1] + dy * k);
      x.stroke();
    }
  };
  x.lineCap = 'round'; x.lineJoin = 'round';
  stroke('rgba(255,255,255,0.45)', 5, 1.5, 2);
  stroke('rgba(45,28,16,0.9)', 4.5, 0, 0);
  stroke('rgba(20,12,6,0.95)', 1.6, 0, 0);
  if (stage >= 4) {
    s = 4242;
    for (let i = 0; i < 6; i++) {
      const cx = r() * S, cy = S * (0.3 + r() * 0.45), n = 6 + Math.floor(r() * 3), R = (8 + r() * 10) * k;
      x.beginPath();
      for (let j = 0; j < n; j++) { const a = j / n * Math.PI * 2, rr = R * (0.6 + r() * 0.6); x.lineTo(cx + Math.cos(a) * rr * 0.6, cy + Math.sin(a) * rr * 1.7); }
      x.closePath(); x.fillStyle = 'rgba(255,214,60,0.95)'; x.fill();
      x.strokeStyle = 'rgba(45,28,16,0.9)'; x.lineWidth = 2.5 * k; x.stroke();
    }
  }
}

// A flat preview of a shell look (for the shop): the egg's front half unrolled into an egg shape.
export function previewShell(x, w, h, look) {
  const S = 256, c = new OffscreenCanvas(S, S), cx = c.getContext('2d');
  paintShell(cx, S, look);
  x.save(); x.beginPath(); x.ellipse(w / 2, h * 0.54, w * 0.36, h * 0.44, 0, 0, Math.PI * 2); x.clip();
  // The middle half of the texture (the side facing us), stretched to the egg's outline.
  x.drawImage(c, S * 0.25, 0, S * 0.5, S, w * 0.14, h * 0.1, w * 0.72, h * 0.88);
  const g = x.createRadialGradient(w * 0.4, h * 0.36, 0, w / 2, h * 0.54, w * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
  x.fillStyle = g; x.fillRect(0, 0, w, h); x.restore();
}
