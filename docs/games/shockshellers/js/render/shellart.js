// What is painted on a shell: its colour with a few speckles, a pattern in a second colour, and a
// stamp on the front (the cracks that grow with damage are the egg mesh's own: egg.js). Drawn with the 2D canvas into
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

export const PATTERN_IDS = Object.keys(PATTERN);

// The shell: base colour, speckles, pattern, stamp. look: { color, pattern, pcolor } as hex colours
// and ids, stamp: the stamp's image (or none), drawn on the front.
export function paintShell(x, S, look, stamp = null) {
  const c = look.color, pc = look.pcolor ?? 0x2e2e34;
  x.fillStyle = hex(c); x.fillRect(0, 0, S, S);
  const r = rng(7 + c % 97);
  x.fillStyle = 'rgba(0,0,0,0.04)';
  for (let i = 0; i < 120; i++) { x.beginPath(); x.arc(r() * S, r() * S, (2 + r() * 4) * S / 512, 0, 7); x.fill(); }
  const pat = PATTERN[look.pattern];
  if (pat) { x.save(); pat(x, S, hex(c), hex(pc), rng(1234 + (look.pattern || '').length * 77), pc); x.restore(); }
  if (stamp) at(x, S, AROUND / 2, 5.6, 1, () => x.drawImage(stamp, -1.9, -1.9, 3.8, 3.8));
}

// A flat preview of a shell look (for the shop): the egg's front half unrolled into an egg shape.
export function previewShell(x, w, h, look, stamp = null) {
  const S = 256, c = new OffscreenCanvas(S, S), cx = c.getContext('2d');
  paintShell(cx, S, look, stamp);
  x.save(); x.beginPath(); x.ellipse(w / 2, h * 0.54, w * 0.36, h * 0.44, 0, 0, Math.PI * 2); x.clip();
  // The middle half of the texture (the side facing us), stretched to the egg's outline.
  x.drawImage(c, S * 0.25, 0, S * 0.5, S, w * 0.14, h * 0.1, w * 0.72, h * 0.88);
  const g = x.createRadialGradient(w * 0.4, h * 0.36, 0, w / 2, h * 0.54, w * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
  x.fillStyle = g; x.fillRect(0, 0, w, h); x.restore();
}
