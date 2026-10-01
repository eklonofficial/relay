// The startup splash, in the manner of the "Animated Loading Screen" mod (which plays Minecraft
// Dungeons' logo animation over Minecraft's loading overlay): on a flat brand colour, the letters of
// BLOCKHAVEN, thick white 3D blocks built from the title logo's glyphs, start turned every which way
// and flip into place one after another; the subtitle fades in once loading is 80% along; below them
// runs Minecraft's loading bar. Like the mod, the animation doubles its speed when loading races ahead,
// holds the bar at 90% if loading finishes first, and only then fades out as Minecraft's overlay does:
// the bar over one second, then everything over the next.
//
// Pure drawing and timing on a 2D context, so it runs in a worker (render/splashworker.js) and keeps
// moving while the page is busy starting the game.
import { GLYPHS } from './logo.js?v=muot26c6';

export const SPLASH_BG = '#44892c';
const WORD = 'BLOCKHAVEN', SUBTITLE = 'RANDOM AHH EDITION';
const ANIM_SECONDS = 1.6; // the mod's 96 frames at 60 fps
const THICK = 1.5; // letter depth, in glyph cells
const CAMERA = 70; // perspective distance, in glyph cells
// Where each letter starts, as turns (degrees) about x, y and z that unwind to nothing.
const START = [[0, 90, 0], [-90, 0, 0], [0, -90, 30], [90, 30, 0], [0, 180, 0], [-90, 0, 90], [0, 90, -30], [180, 0, 0], [0, -90, 0], [90, 0, -90]];
const LIGHT = norm([-0.35, 0.55, 0.75]);

function norm(v) { const l = Math.hypot(...v); return v.map(c => c / l); }
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutBack = t => { const c = 1.2; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

// A glyph as an extruded solid: its front and back caps (one rectangle per cell, filled as one path
// so they show no seams) and its side walls, merged into runs, with outward normals.
function solid(ch) {
  const g = GLYPHS[ch], w = g[0].length, h = g.length, on = (c, r) => r >= 0 && r < h && g[r][c] === '#';
  const X = c => c - w / 2, Y = r => h / 2 - r, z = THICK / 2;
  const cells = [], walls = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (on(c, r)) cells.push([X(c), Y(r + 1), X(c + 1), Y(r)]);
  const wall = (n, a, b) => walls.push({ n, pts: [[...a, -z], [...b, -z], [...b, z], [...a, z]] });
  for (let c = 0; c < w; c++) for (const [dc, n, xe] of [[-1, [-1, 0, 0], c], [1, [1, 0, 0], c + 1]]) {
    for (let r = 0; r < h; r++) {
      if (!on(c, r) || on(c + dc, r)) continue;
      let e = r; while (on(c, e + 1) && !on(c + dc, e + 1)) e++;
      wall(n, [X(xe), Y(r)], [X(xe), Y(e + 1)]);
      r = e;
    }
  }
  for (let r = 0; r < h; r++) for (const [dr, n, ye] of [[-1, [0, 1, 0], r], [1, [0, -1, 0], r + 1]]) {
    for (let c = 0; c < w; c++) {
      if (!on(c, r) || on(c, r + dr)) continue;
      let e = c; while (on(e + 1, r) && !on(e + 1, r + dr)) e++;
      wall(n, [X(c), Y(ye)], [X(e + 1), Y(ye)]);
      c = e;
    }
  }
  return { cells, walls, width: w, height: h };
}

function rotation([ax, ay, az]) {
  const r = Math.PI / 180, [cx, sx, cy, sy, cz, sz] = [Math.cos(ax * r), Math.sin(ax * r), Math.cos(ay * r), Math.sin(ay * r), Math.cos(az * r), Math.sin(az * r)];
  // Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}
const apply = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];

export class SplashArt {
  constructor({ reduced = false } = {}) {
    this.reduced = reduced;
    this.letters = [...WORD].map((ch, i) => ({ ...solid(ch), start: START[i % START.length] }));
    this.span = this.letters.reduce((a, l) => a + l.width, 0) + WORD.length - 1; // cells, with 1-cell gaps
    this.anim = reduced ? 1 : 0; // 0..1 through the letters' animation
    this.fast = false;
    this.actual = 0; this.shown = 0; // loading progress, and the bar's eased copy of it
    this.ready = false;
    this.sub = 0; // subtitle opacity
    this.fade = -1; // seconds since fading out began
    this.w = 1; this.h = 1; this.dpr = 1; this.cssW = 1; this.cssH = 1;
  }
  resize({ w, h, dpr, cssW, cssH }) { Object.assign(this, { w, h, dpr, cssW, cssH }); }
  setProgress(p) { this.actual = Math.max(this.actual, clamp01(p)); }
  setReady() { this.ready = true; this.actual = 1; }
  get done() { return this.fade >= 2; }

  // Advances the timeline by dt seconds.
  step(dt) {
    if (this.fade >= 0) { this.fade += dt; return; }
    // Loading well along with the animation not yet halfway: double speed from here on (the mod's
    // rule), and the same once loading is finished, so the wait never outlasts it by much.
    if ((this.actual >= 0.6 && this.anim < 0.5) || this.ready) this.fast = true;
    this.anim = Math.min(1, this.anim + dt / ANIM_SECONDS * (this.fast ? 2 : 1));
    // Minecraft eases the bar 5% of the way to the real progress each frame; finished loading is
    // held at 90% until the animation is through.
    const target = this.ready && this.anim < 1 ? Math.min(this.actual, 0.9) : this.actual;
    this.shown += (target - this.shown) * (1 - 0.95 ** (dt * 60));
    if (this.shown >= 0.8) this.sub = Math.min(1, this.sub + dt * 4);
    if (this.ready && this.anim >= 1) this.fade = 0;
  }

  draw(ctx) {
    const { w, h } = this, fade = Math.max(0, this.fade);
    const alpha = 1 - clamp01(fade - 1), barAlpha = 1 - clamp01(fade);
    ctx.clearRect(0, 0, w, h);
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = SPLASH_BG; ctx.fillRect(0, 0, w, h);
    // LoadingOverlay's layout: a logo box min(0.75 w, h) wide centred on the screen.
    const logoW = Math.min(w * 0.75, h), cell = logoW / this.span, cx = w / 2, cy = h / 2;
    this.drawLetters(ctx, cx, cy, cell);
    if (this.sub > 0) this.drawSubtitle(ctx, cx, cy + cell * 4.8, cell, alpha * this.sub);
    if (barAlpha > 0) this.drawBar(ctx, cx, logoW / 2, h * 0.8325, barAlpha * alpha);
    ctx.globalAlpha = 1;
  }

  drawLetters(ctx, cx, cy, cell) {
    const project = ([x, y, z]) => { const k = CAMERA / (CAMERA - z); return [cx + x * cell * k, cy - y * cell * k]; };
    let left = -this.span / 2;
    // Each letter turns about its own centre, so neighbours at most brush past each other, left to right.
    this.letters.forEach((l, i) => {
      const ox = left + l.width / 2; left += l.width + 1;
      // Letters flip one after another, left to right.
      const t = clamp01((this.anim - i * 0.06) / 0.42), u = this.reduced ? 0 : 1 - easeOutBack(t);
      const m = rotation(l.start.map(a => a * u));
      const at = p => { const q = apply(m, p); return [q[0] + ox, q[1], q[2]]; };
      const faces = [];
      for (const wl of l.walls) {
        const n = apply(m, wl.n), pts = wl.pts.map(at);
        if (!this.facing(n, pts[0])) continue;
        faces.push({ n, pts, z: pts.reduce((a, p) => a + p[2], 0) / 4 });
      }
      faces.sort((a, b) => a.z - b.z);
      for (const f of faces) {
        ctx.fillStyle = shade(f.n);
        ctx.beginPath(); f.pts.map(project).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
      }
      // The cap that faces the camera, all cells in one path.
      for (const side of [1, -1]) {
        const n = apply(m, [0, 0, side]), z = side * THICK / 2;
        if (!this.facing(n, at([0, 0, z]))) continue;
        ctx.fillStyle = shade(n);
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of l.cells) {
          [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => project(at([x, y, z]))).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.closePath();
        }
        ctx.fill();
      }
    });
  }
  facing(n, p) { return n[0] * -p[0] + n[1] * -p[1] + n[2] * (CAMERA - p[2]) > 0; }

  // The subtitle in the logo's own pixel letters, widely spaced like the mod's "STUDIOS".
  drawSubtitle(ctx, cx, top, cell, a) {
    const s = Math.max(1, Math.round(cell * 0.28)), adv = (ch) => (ch === ' ' ? 4 : (GLYPHS[ch] || GLYPHS[' '])[0].length + 3);
    const width = [...SUBTITLE].reduce((t, ch) => t + adv(ch), 0) - 3;
    let x = Math.round(cx - width * s / 2);
    const y = Math.round(top);
    ctx.globalAlpha = a; ctx.fillStyle = '#ffffff';
    for (const ch of SUBTITLE) {
      const g = GLYPHS[ch];
      if (g && ch !== ' ') g.forEach((row, r) => [...row].forEach((c, k) => { if (c === '#') ctx.fillRect(x + k * s, y + r * s, s, s); }));
      x += adv(ch) * s;
    }
  }

  // Minecraft's drawProgressBar, in GUI pixels: a 1-px white outline with cut corners, filled 2 px in.
  drawBar(ctx, cx, half, barY, a) {
    const gs = Math.max(1, Math.min(4, Math.floor(Math.min(this.cssW / 320, this.cssH / 240)))), u = gs * this.dpr;
    const minX = Math.round(cx - half), maxX = Math.round(cx + half), minY = Math.round(barY - 5 * u), maxY = Math.round(barY + 5 * u);
    const fill = Math.ceil((maxX - minX - 2 * u) * this.shown);
    ctx.globalAlpha = a; ctx.fillStyle = '#ffffff';
    ctx.fillRect(minX + 2 * u, minY + 2 * u, Math.max(0, fill - 2 * u), maxY - minY - 4 * u);
    ctx.fillRect(minX + u, minY, maxX - minX - 2 * u, u);
    ctx.fillRect(minX + u, maxY - u, maxX - minX - 2 * u, u);
    ctx.fillRect(minX, minY, u, maxY - minY);
    ctx.fillRect(maxX - u, minY, u, maxY - minY);
  }
}

function shade(n) {
  const d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
  const v = Math.round(255 * Math.min(1, 0.62 + 0.5 * Math.max(0, d)));
  return `rgb(${v},${v},${v})`;
}
