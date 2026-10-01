// The startup splash. On a deep red field, BLOCKHAVEN is set in its own geometric display face
// (thick strokes, rounded outer corners, square counters and small notches). The word assembles
// from hundreds of white tiles that fly up out of the depth, letter by letter, then resolve into
// the crisp vector logo with a flash of light, a shine sweeping across it and a burst of sparks;
// the subtitle eases in with its tracking closing up, and a slim loading bar runs underneath.
// When the game is ready, the logo swells slightly as a circle opens from the centre onto the
// title screen.
//
// Timeline (kept from the loading-screen mod this follows): the letters take 1.6 s, at double
// speed when loading races ahead; finished loading holds the bar at 90% until the letters are in;
// then the bar fades over 1 s and everything else over the next.
//
// Pure 2D-canvas drawing and timing, so it runs in a worker (render/splashworker.js) and keeps
// moving while the page is busy starting the game.

export const SPLASH_BG = '#dc1f3d';
const WORD = 'BLOCKHAVEN', SUBTITLE = 'RANDOM AHH EDITION';
const ANIM_SECONDS = 1.6;
const H = 10, S = 3.1, GAP = 1.45; // cap height, stroke width and letter gap, in glyph units
const CELL = 0.5; // tile size, in glyph units

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeOutBack = t => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------- the typeface ----------------
// Each glyph is a list of closed polygons in glyph units (y down); outlines run clockwise and
// counters counter-clockwise so a nonzero fill (or winding test) cuts the holes.
function rounded(pts, radii) {
  // Rounds each corner of a polygon by its radius (an arc approximated with short segments).
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], r = Array.isArray(radii) ? radii[i] : radii;
    if (!r) { out.push(p); continue; }
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const rr = Math.min(r, da / 2, db / 2);
    const u = [(a[0] - p[0]) / da, (a[1] - p[1]) / da], v = [(b[0] - p[0]) / db, (b[1] - p[1]) / db];
    const p0 = [p[0] + u[0] * rr, p[1] + u[1] * rr], p1 = [p[0] + v[0] * rr, p[1] + v[1] * rr];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, s = 1 - t; // quadratic Bezier through the corner
      out.push([s * s * p0[0] + 2 * s * t * p[0] + t * t * p1[0], s * s * p0[1] + 2 * s * t * p[1] + t * t * p1[1]]);
    }
  }
  return out;
}
const rect = (x, y, w, h, r = 0) => rounded([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r);
const hole = pts => pts.slice().reverse();

const GLYPHS = {
  B: { w: 9.6, parts: () => [rect(0, 0, 9.6, H, [0.5, 2.3, 2.3, 0.5]), hole(rect(S, 2.3, 3.4, 1.9, 0.35)), hole(rect(S, 5.8, 3.4, 1.9, 0.35)), hole(rect(8.15, 4.55, 1.45, 0.9))] },
  L: { w: 8, parts: () => [rounded([[0, 0], [S, 0], [S, 6.9], [8, 6.9], [8, H], [0, H]], [0.5, 0.5, 0.25, 0.5, 0.5, 0.5])] },
  O: { w: 10, parts: () => [rect(0, 0, 10, H, 1.9), hole(rect(S, S, 10 - 2 * S, H - 2 * S, 0.35))] },
  C: { w: 9.4, parts: () => [rect(0, 0, 9.4, H, [1.9, 0.5, 0.5, 1.9]), hole(rect(S, S, 9.4 - S, H - 2 * S, [0.35, 0, 0, 0.35]))] },
  K: { w: 9.8, parts: () => [rounded([[0, 0], [S, 0], [S, 3.55], [6.15, 0], [9.8, 0], [5.55, 5], [9.8, H], [6.15, H], [S, 6.45], [S, H], [0, H]], [0.5, 0.5, 0, 0.3, 0.3, 0, 0.3, 0.3, 0, 0.5, 0.5])] },
  H: { w: 9.6, parts: () => [rounded([[0, 0], [S, 0], [S, 3.5], [9.6 - S, 3.5], [9.6 - S, 0], [9.6, 0], [9.6, H], [9.6 - S, H], [9.6 - S, 6.5], [S, 6.5], [S, H], [0, H]], [0.5, 0.5, 0.2, 0.2, 0.5, 0.5, 0.5, 0.5, 0.2, 0.2, 0.5, 0.5])] },
  A: { w: 10, parts: () => [rect(0, 0, 10, H, [4.4, 4.4, 0.5, 0.5]), hole(rect(S, S, 10 - 2 * S, 2.25, [1.3, 1.3, 0.2, 0.2])), hole(rect(S, 7.35, 10 - 2 * S, H - 7.35, [0.2, 0.2, 0, 0])), hole(rect(0, 5.85, 0.9, 0.9))] },
  V: { w: 10, parts: () => [rounded([[0, 0], [3.2, 0], [5, 5.7], [6.8, 0], [10, 0], [6.9, H], [3.1, H]], [0.4, 0.4, 0.3, 0.4, 0.4, 0.5, 0.5])] },
  E: { w: 8.6, parts: () => [rounded([[0, 0], [8.6, 0], [8.6, 2.9], [S, 2.9], [S, 3.55], [7.5, 3.55], [7.5, 6.45], [S, 6.45], [S, 7.1], [8.6, 7.1], [8.6, H], [0, H]], [0.5, 0.5, 0.4, 0, 0, 0.4, 0.4, 0, 0, 0.4, 0.5, 0.5])] },
  N: { w: 9.8, parts: () => [rect(0, 0, 9.8, H, [0.5, 4.2, 0.5, 0.5]), hole(rect(S, S, 9.8 - 2 * S, H - S, [0.2, 1.2, 0, 0])), hole(rect(0, 4.55, 0.9, 0.9))] },
};

// Nonzero winding test for the tiles.
function inside(polys, x, y) {
  let wn = 0;
  for (const P of polys) for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    if (a[1] <= y) { if (b[1] > y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0) wn++; }
    else if (b[1] <= y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0) wn--;
  }
  return wn !== 0;
}

// Small deterministic random numbers, so every launch looks the same.
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class SplashArt {
  constructor({ reduced = false } = {}) {
    this.reduced = reduced;
    // Lay the word out, centred on (0, 0) in glyph units.
    let x = 0;
    this.letters = [...WORD].map(ch => { const g = GLYPHS[ch], l = { ch, x, w: g.w, polys: g.parts() }; x += g.w + GAP; return l; });
    this.span = x - GAP;
    for (const l of this.letters) { const dx = l.x - this.span / 2; l.polys = l.polys.map(P => P.map(([a, b]) => [a + dx, b - H / 2])); l.cx = dx + l.w / 2; }
    // Tiles: every cell whose centre is inside a letter; each flies in on its own path.
    const r = rng(1312);
    this.tiles = [];
    this.letters.forEach((l, li) => {
      for (let gy = 0; gy < H / CELL; gy++) for (let gx = 0; gx < Math.ceil(l.w / CELL); gx++) {
        const hx = l.x - this.span / 2 + (gx + 0.5) * CELL, hy = -H / 2 + (gy + 0.5) * CELL;
        if (!inside(l.polys, hx, hy)) continue;
        // Each letter's tiles rise from a loose cloud beneath it, columns sweeping left to right.
        const col = (hx + this.span / 2) / this.span;
        this.tiles.push({
          hx, hy, li,
          sx: hx + (r() - 0.5) * 7, sy: hy + 7 + r() * 9,
          z: 0.25 + r() * 0.8, rot: (r() - 0.5) * 5,
          delay: col * 0.42 + r() * 0.1 + (1 - gy * CELL / H) * 0.05,
        });
      }
    });
    // Ambient squares drifting behind everything.
    this.motes = Array.from({ length: 18 }, () => ({ x: r() * 2 - 1, y: r() * 2 - 1, s: 0.03 + r() * 0.09, sp: 0.01 + r() * 0.03, rot: r() * 6, vr: (r() - 0.5) * 0.3, a: 0.02 + r() * 0.04 }));
    this.sparks = [];
    this.anim = reduced ? 1 : 0;
    this.fast = false;
    this.actual = 0; this.shown = 0;
    this.ready = false;
    this.sub = 0;
    this.fade = -1;
    this.t = 0;
    this.burst = reduced;
    this.w = 1; this.h = 1; this.dpr = 1; this.cssW = 1; this.cssH = 1;
  }
  resize({ w, h, dpr, cssW, cssH }) { Object.assign(this, { w, h, dpr, cssW, cssH }); }
  setProgress(p) { this.actual = Math.max(this.actual, clamp01(p)); }
  setReady() { this.ready = true; this.actual = 1; }
  get done() { return this.fade >= 2; }

  step(dt) {
    this.t += dt;
    for (const m of this.motes) { m.y -= m.sp * dt; m.rot += m.vr * dt; if (m.y < -1.2) m.y += 2.4; }
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.9 ** (dt * 60); s.vy = s.vy * 0.9 ** (dt * 60) + 6 * dt; s.life -= dt; }
    this.sparks = this.sparks.filter(s => s.life > 0);
    if (this.shown >= 0.8) this.sub = Math.min(1, this.sub + dt * 4);
    if (this.fade >= 0) { this.fade += dt; return; }
    if ((this.actual >= 0.6 && this.anim < 0.5) || this.ready) this.fast = true;
    this.anim = Math.min(1, this.anim + dt / ANIM_SECONDS * (this.fast ? 2 : 1));
    if (!this.burst && this.anim >= 0.78) { this.burst = true; this.spawnBurst(); }
    const target = this.ready && this.anim < 1 ? Math.min(this.actual, 0.9) : this.actual;
    this.shown += (target - this.shown) * (1 - 0.95 ** (dt * 60));
    if (this.ready && this.anim >= 1) this.fade = 0;
  }
  spawnBurst() {
    const r = rng(77);
    for (let i = 0; i < 70; i++) {
      const l = this.letters[Math.floor(r() * this.letters.length)];
      const a = r() * Math.PI * 2, sp = 6 + r() * 18;
      this.sparks.push({ x: l.cx + (r() - 0.5) * l.w, y: (r() - 0.5) * H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 4, s: 0.18 + r() * 0.3, life: 0.6 + r() * 0.8, max: 1.4 });
    }
  }

  draw(ctx) {
    const { w, h } = this, fade = Math.max(0, this.fade);
    ctx.clearRect(0, 0, w, h);
    if (this.done) return;
    const barAlpha = 1 - clamp01(fade), out = clamp01(fade - 1), iris = easeInOut(out);
    ctx.globalAlpha = 1;
    this.drawBackground(ctx);
    // Logo layout: the word spans 62% of the width (or the height allows), centred a little high.
    const unit = Math.min(w * 0.62, h * 1.25) / this.span;
    const cx = w / 2, cy = h * 0.46;
    const swell = 1 + 0.06 * easeOutCubic(out) + 0.012 * Math.sin(this.t * 1.6) * (this.anim >= 1 ? 1 : 0);
    const u = unit * swell, logoA = 1 - out;
    ctx.globalAlpha = logoA;
    this.drawWord(ctx, cx, cy, u);
    this.drawSparks(ctx, cx, cy, u, logoA);
    if (this.sub > 0) this.drawSubtitle(ctx, cx, cy + u * (H / 2 + 3.9), u, logoA * this.sub);
    if (barAlpha > 0) this.drawBar(ctx, cx, h * 0.82, Math.min(w * 0.34, unit * this.span * 0.6), barAlpha * logoA);
    // Exit: a circle opens from the centre onto the title screen underneath.
    if (iris > 0) {
      const rad = Math.hypot(w, h) * 0.5 * iris;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI * 2; const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  drawBackground(ctx) {
    const { w, h } = this;
    ctx.fillStyle = SPLASH_BG; ctx.fillRect(0, 0, w, h);
    // A soft light behind the logo and darker corners.
    if (ctx.createRadialGradient) {
      const g = ctx.createRadialGradient(w / 2, h * 0.46, 0, w / 2, h * 0.46, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, 'rgba(255,120,130,0.30)'); g.addColorStop(0.45, 'rgba(255,60,80,0.06)'); g.addColorStop(1, 'rgba(70,0,15,0.45)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    // Large, faint squares drifting up behind everything.
    const m = Math.min(w, h);
    ctx.fillStyle = '#ffffff';
    for (const q of this.motes) {
      const x = w / 2 + q.x * w * 0.55, y = h / 2 + q.y * h * 0.6, s = q.s * m;
      ctx.globalAlpha = q.a;
      this.square(ctx, x, y, s, q.rot);
    }
    ctx.globalAlpha = 1;
  }
  square(ctx, x, y, s, rot) {
    const c = Math.cos(rot) * s / 2, sn = Math.sin(rot) * s / 2;
    ctx.beginPath();
    ctx.moveTo(x - c + sn, y - sn - c); ctx.lineTo(x + c + sn, y + sn - c); ctx.lineTo(x + c - sn, y + sn + c); ctx.lineTo(x - c - sn, y - sn + c);
    ctx.closePath(); ctx.fill();
  }

  // Tiles flying in until ~78% of the animation, then the vector word fading up over them.
  drawWord(ctx, cx, cy, u) {
    const a = this.anim, vector = this.reduced ? 1 : clamp01((a - 0.74) / 0.12);
    const base = ctx.globalAlpha;
    if (vector < 1) {
      ctx.fillStyle = '#ffffff';
      for (const t of this.tiles) {
        const p = clamp01((a / 0.8 - t.delay) / 0.38);
        if (p <= 0) continue;
        const e = easeOutBack(p), k = 1 + t.z * (1 - easeOutCubic(p)); // nearer the camera while in flight
        const x = cx + lerp(t.sx, t.hx, e) * u * k + (k - 1) * (cx - cx), y = cy + lerp(t.sy, t.hy, e) * u * k;
        const s = CELL * u * Math.min(1, 0.25 + p) * k * 1.06;
        ctx.globalAlpha = base * Math.min(1, p * 3) * (1 - vector);
        this.square(ctx, x, y, s, t.rot * (1 - easeOutCubic(p)));
      }
      ctx.globalAlpha = base;
    }
    if (vector > 0) {
      ctx.globalAlpha = base * vector;
      ctx.fillStyle = '#ffffff';
      this.wordPath(ctx, cx, cy, u);
      ctx.fill();
      // A brief flash as the word resolves, then a shine sweeping across it.
      const flash = this.reduced ? 0 : clamp01(1 - Math.abs(a - 0.86) / 0.08) * 0.7;
      const sweep = this.reduced ? -1 : (a - 0.84) / 0.16;
      if ((flash > 0 || (sweep > 0 && sweep < 1)) && ctx.save) {
        ctx.save();
        this.wordPath(ctx, cx, cy, u);
        ctx.clip();
        if (flash > 0) { ctx.globalAlpha = base * flash; ctx.fillStyle = '#ffe6ea'; ctx.fillRect(0, 0, this.w, this.h); }
        if (sweep > 0 && sweep < 1 && ctx.createLinearGradient) {
          const span = this.span * u, x0 = cx - span / 2 - span * 0.3 + sweep * span * 1.6;
          const g = ctx.createLinearGradient(x0 - u * 6, cy - u * 6, x0 + u * 6, cy + u * 6);
          g.addColorStop(0, 'rgba(255,200,210,0)'); g.addColorStop(0.5, 'rgba(255,190,200,0.9)'); g.addColorStop(1, 'rgba(255,200,210,0)');
          ctx.globalAlpha = base; ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = base;
  }
  wordPath(ctx, cx, cy, u) {
    ctx.beginPath();
    for (const l of this.letters) for (const P of l.polys) {
      P.forEach(([x, y], k) => (k ? ctx.lineTo(cx + x * u, cy + y * u) : ctx.moveTo(cx + x * u, cy + y * u)));
      ctx.closePath();
    }
  }
  drawSparks(ctx, cx, cy, u, a) {
    ctx.fillStyle = '#ffffff';
    for (const s of this.sparks) {
      ctx.globalAlpha = a * clamp01(s.life / s.max) * 0.9;
      const sz = s.s * u;
      ctx.fillRect(cx + s.x * u - sz / 2, cy + s.y * u - sz / 2, sz, sz);
    }
    ctx.globalAlpha = a;
  }

  // The subtitle in a heavy geometric sans, widely tracked like a studio name; the tracking
  // closes up as it fades in.
  drawSubtitle(ctx, cx, y, u, a) {
    const t = easeOutCubic(this.sub), px = Math.max(9, u * 2.05), track = px * (0.55 + 0.5 * (1 - t));
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    if (ctx.fillText) {
      ctx.font = `800 ${px.toFixed(1)}px "Minecraft", "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      const widths = [...SUBTITLE].map(ch => (ctx.measureText ? ctx.measureText(ch).width : px * 0.7));
      const total = widths.reduce((s, v) => s + v, 0) + track * (SUBTITLE.length - 1);
      let x = cx - total / 2;
      [...SUBTITLE].forEach((ch, i) => { ctx.fillText(ch, x, y + (1 - t) * px * 0.6); x += widths[i] + track; });
    } else ctx.fillRect(cx - px * 6, y - px / 2, px * 12, px);
  }

  // A slim rounded loading bar with a faint track.
  drawBar(ctx, cx, y, half, a) {
    const th = Math.max(2, Math.round(3 * this.dpr)), x0 = Math.round(cx - half), x1 = Math.round(cx + half);
    ctx.globalAlpha = a * 0.28; ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0, y - th / 2, x1 - x0, th);
    ctx.globalAlpha = a;
    const fw = Math.max(0, (x1 - x0) * this.shown);
    ctx.fillRect(x0, y - th / 2, fw, th);
    // A glint at the bar's leading edge.
    ctx.globalAlpha = a * 0.6;
    ctx.fillRect(x0 + fw - th * 3, y - th, th * 3, th * 2);
  }
}
