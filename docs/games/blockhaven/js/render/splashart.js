// The startup splash. On a deep red field, BLOCKHAVEN is set in its own geometric display face
// (thick strokes, rounded outer corners, square counters and small notches) and shown as solid
// 3D letters in perspective. Each letter arrives as a tumbling white block that spins into place
// while it morphs into its glyph: corners round off, counters and notches open, and the block
// thins into a slab. The whole word turns to face the camera, flashes as it lands with a shine
// sweeping across and a burst of sparks, then sways gently while the game finishes loading. On
// exit the word turns away and swells as a circle opens from the centre onto the title screen.
//
// Timeline (kept from the loading-screen mod this follows): the letters take 1.6 s, at double
// speed when loading races ahead; finished loading holds the bar at 90% until the letters are in;
// then the bar fades over 1 s and everything else over the next.
//
// Pure 2D-canvas drawing (the 3D is projected by hand, the extrusion drawn as stacked slices) and
// timing, so it runs in a worker (render/splashworker.js) and keeps moving while the page is busy.

export const SPLASH_BG = '#dc1f3d';
const WORD = 'BLOCKHAVEN', SUBTITLE = 'RANDOM AHH EDITION';
const ANIM_SECONDS = 1.6;
const H = 10, S = 3.1, GAP = 1.45; // cap height, stroke width and letter gap, in glyph units
const CAM = 70; // camera distance, in glyph units
const DEPTH = 3.6; // slab thickness of the finished letters

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

// Small deterministic random numbers, so every launch looks the same.
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }


// 3x3 rotation (yaw about y, then pitch about x, then roll about z), row-major.
function rot(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // Rz * Rx * Ry
  const a = [cy, 0, sy, sx * sy, cx, -sx * cy, -cx * sy, sx, cx * cy];
  return [cz * a[0] - sz * a[3], cz * a[1] - sz * a[4], cz * a[2] - sz * a[5],
    sz * a[0] + cz * a[3], sz * a[1] + cz * a[4], sz * a[2] + cz * a[5], a[6], a[7], a[8]];
}
const mul = (A, B) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]));
const app = (M, x, y, z) => [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
const LIGHT = (() => { const v = [-0.35, -0.6, -1], l = Math.hypot(...v); return v.map(c => c / l); })();

export class SplashArt {
  constructor({ reduced = false } = {}) {
    this.reduced = reduced;
    // Lay the word out along x, centred on 0. Each letter keeps its polygons around its own
    // centre, with the block it starts as: every outline point pushed out along its ray to the
    // letter's bounding box, and every counter or notch shrunk to its centre.
    let x = 0;
    this.letters = [...WORD].map((ch, i) => {
      const g = GLYPHS[ch], hw = g.w / 2, hh = H / 2;
      const polys = g.parts().map((P, k) => {
        const pts = P.map(([a, b]) => [a - hw, b - hh]);
        let from;
        if (k === 0) from = pts.map(([a, b]) => { const s = Math.min(Math.abs(a) > 1e-6 ? hw / Math.abs(a) : 1e9, Math.abs(b) > 1e-6 ? hh / Math.abs(b) : 1e9); return [a * s, b * s]; });
        else { const c = pts.reduce((s, [a, b]) => [s[0] + a / pts.length, s[1] + b / pts.length], [0, 0]); from = pts.map(() => c.slice()); }
        return { pts, from };
      });
      const l = { ch, i, x, w: g.w, polys };
      x += g.w + GAP;
      return l;
    });
    this.span = x - GAP;
    for (const l of this.letters) l.cx = l.x + l.w / 2 - this.span / 2;
    const r = rng(1312);
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
    this.idle = reduced ? 9 : 0; // seconds since the letters landed
    this.burst = reduced;
    this.w = 1; this.h = 1; this.dpr = 1; this.cssW = 1; this.cssH = 1;
  }
  resize({ w, h, dpr, cssW, cssH }) { Object.assign(this, { w, h, dpr, cssW, cssH }); }
  setProgress(p) { this.actual = Math.max(this.actual, clamp01(p)); }
  setReady() { this.ready = true; this.actual = 1; }
  get done() { return this.fade >= 2; }

  step(dt) {
    this.t += dt;
    if (this.anim >= 1) this.idle += dt;
    for (const m of this.motes) { m.y -= m.sp * dt; m.rot += m.vr * dt; if (m.y < -1.2) m.y += 2.4; }
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.9 ** (dt * 60); s.vy = s.vy * 0.9 ** (dt * 60) + 6 * dt; s.life -= dt; }
    this.sparks = this.sparks.filter(s => s.life > 0);
    if (this.shown >= 0.8) this.sub = Math.min(1, this.sub + dt * 4);
    if (this.fade >= 0) { this.fade += dt; return; }
    if ((this.actual >= 0.6 && this.anim < 0.5) || this.ready) this.fast = true;
    this.anim = Math.min(1, this.anim + dt / ANIM_SECONDS * (this.fast ? 2 : 1));
    if (!this.burst && this.anim >= 0.97) { this.burst = true; this.spawnBurst(); }
    const target = this.ready && this.anim < 1 ? Math.min(this.actual, 0.9) : this.actual;
    this.shown += (target - this.shown) * (1 - 0.95 ** (dt * 60));
    if (this.ready && this.anim >= 1) this.fade = 0;
  }
  spawnBurst() {
    const r = rng(77);
    for (let i = 0; i < 80; i++) {
      const l = this.letters[Math.floor(r() * this.letters.length)];
      const a = r() * Math.PI * 2, sp = 6 + r() * 20;
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
    const u = unit * (1 + 0.08 * easeOutCubic(out)), logoA = 1 - out;
    ctx.globalAlpha = logoA;
    this.drawWord(ctx, cx, cy, u, out);
    this.drawSparks(ctx, cx, cy, u, logoA);
    if (this.sub > 0) this.drawSubtitle(ctx, cx, cy + u * (H / 2 + 4.2), u, logoA * this.sub);
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

  // Where each letter is in its flight: position offset, spin, morph (0 block .. 1 glyph), depth.
  letterState(l) {
    const a = this.anim, i = l.i, si = i * 0.04;
    const p = clamp01((a - si) / 0.45), e = easeOutCubic(p);
    const er = easeOutBack(clamp01((a - si) / 0.62));
    const sgn = i % 2 ? 1 : -1;
    const m = easeInOut(clamp01((a - si - 0.22) / 0.38));
    return {
      px: l.cx * 0.7 * (1 - e), py: (-24 - (i % 3) * 4) * (1 - e), pz: 40 * (1 - e),
      rx: 1.7 * sgn * (1 - er), ry: (-2.6 - 0.5 * (i % 3)) * (1 - er), rz: 0.6 * ((i % 4) - 1.5) / 1.5 * (1 - er),
      m, dep: lerp(l.w * 0.95, DEPTH, m), sc: 0.35 + 0.65 * easeOutBack(clamp01(p * 1.5)), alpha: clamp01(p * 5),
    };
  }

  // The word as solid letters: each extruded slab drawn as stacked slices from the far face to
  // the near one, the near face lit, letters painted far to near.
  drawWord(ctx, cx, cy, u, out) {
    const base = ctx.globalAlpha, idle = this.idle;
    const g = easeInOut(clamp01(this.anim / 0.97));
    const sway = this.reduced ? 0 : 0.1 * clamp01(idle / 1.2);
    const G = rot(0.32 * (1 - g) + 0.2 * g + sway * 0.35 * Math.sin(this.t * 0.53 + 1), -0.45 * (1 - g) + sway * Math.sin(this.t * 0.7) + 0.9 * out * out, 0);
    const proj = (v) => { const z = v[2] + CAM; const k = u * CAM / Math.max(1, z); return [cx + v[0] * k, cy + v[1] * k]; };
    const items = this.letters.map(l => {
      const st = this.letterState(l), M = mul(G, rot(st.rx, st.ry, st.rz));
      const T = app(G, l.cx + st.px, st.py, st.pz), dz = app(M, 0, 0, 1);
      // Morphed outline points, in world space at the slab's mid-plane.
      const polys = l.polys.map(P => P.pts.map((q, k) => {
        const f = P.from[k], x = lerp(f[0], q[0], st.m) * st.sc, y = lerp(f[1], q[1], st.m) * st.sc;
        const v = app(M, x, y, 0); return [v[0] + T[0], v[1] + T[1], v[2] + T[2]];
      }));
      const half = st.dep * st.sc / 2;
      // Does the front (-z) face look at the camera, which sits at (0, 0, -CAM)?
      const fc = [T[0] - dz[0] * half, T[1] - dz[1] * half, T[2] - dz[2] * half];
      const front = -(dz[0] * -fc[0] + dz[1] * -fc[1] + dz[2] * (-CAM - fc[2])) > 0;
      return { l, st, polys, dz, half, front, depth: T[2] };
    }).sort((A, B) => B.depth - A.depth);
    const faces = [];
    for (const it of items) {
      const { st, polys, dz, half, front } = it;
      if (st.alpha <= 0) continue;
      // Slices from the far face to the near one; enough that the side walls read as solid.
      const near = front ? -1 : 1, kz = u * CAM / Math.max(1, it.depth + CAM);
      const n = Math.max(2, Math.min(96, Math.ceil(Math.hypot(dz[0], dz[1]) * half * 2 * kz / 0.9)));
      const nf = front ? [-dz[0], -dz[1], -dz[2]] : dz;
      const lit = Math.max(0, nf[0] * LIGHT[0] + nf[1] * LIGHT[1] + nf[2] * LIGHT[2]);
      for (let s = 0; s <= n; s++) {
        const t = s / n, z = -near * half + near * 2 * half * t; // far face .. near face
        ctx.beginPath();
        let face = s === n ? [] : null;
        for (const P of polys) {
          P.forEach((v, k) => {
            const q = proj([v[0] + dz[0] * z, v[1] + dz[1] * z, v[2] + dz[2] * z]);
            if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
            if (face) (face[face.length - 1] && k ? face[face.length - 1].push(q) : face.push([q]));
          });
          ctx.closePath();
        }
        if (s < n) {
          const c = 0.25 + 0.6 * t;
          ctx.fillStyle = `rgb(${Math.round(lerp(150, 238, c))},${Math.round(lerp(52, 200, c))},${Math.round(lerp(70, 208, c))})`;
        } else {
          const v = Math.round(222 + 33 * lit);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          faces.push(face);
        }
        ctx.globalAlpha = base * st.alpha;
        ctx.fill();
      }
    }
    ctx.globalAlpha = base;
    // As the letters land: a flash, then a shine sweeping across the faces.
    const flash = this.reduced ? 0 : clamp01(1 - idle / 0.3) * (idle > 0 ? 0.75 : 0);
    const sweep = this.reduced ? -1 : (idle - 0.15) / 0.8;
    if ((flash > 0 || (sweep > 0 && sweep < 1)) && ctx.save && faces.length) {
      ctx.save();
      ctx.beginPath();
      for (const f of faces) for (const P of f) { P.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); }
      ctx.clip();
      if (flash > 0) { ctx.globalAlpha = base * flash; ctx.fillStyle = '#ffe6ea'; ctx.fillRect(0, 0, this.w, this.h); }
      if (sweep > 0 && sweep < 1 && ctx.createLinearGradient) {
        const span = this.span * u, x0 = cx - span / 2 - span * 0.3 + sweep * span * 1.6;
        const gr = ctx.createLinearGradient(x0 - u * 6, cy - u * 6, x0 + u * 6, cy + u * 6);
        gr.addColorStop(0, 'rgba(255,170,185,0)'); gr.addColorStop(0.5, 'rgba(255,160,175,0.85)'); gr.addColorStop(1, 'rgba(255,170,185,0)');
        ctx.globalAlpha = base; ctx.fillStyle = gr; ctx.fillRect(0, 0, this.w, this.h);
      }
      ctx.restore();
    }
    ctx.globalAlpha = base;
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
