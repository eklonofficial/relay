// The in-game HUD (GDD §19.6). Text elements only change when their value changes (each DOM change
// repaints the compositor); everything that moves every frame (crosshair, health ring, hit markers,
// damage arcs, grenade charge, scope, off-screen markers) is drawn on the HUD canvas.
import { surfaceDocument as document } from '../surface.js?v=muvmfsft';
import { WEAPONS, GRENADE, ROOST, STREAKS } from '../sim/tuning.js?v=muvmfsft';
import { currentSpread, weaponOf, slotOf } from '../sim/combat.js?v=muvmfsft';

const $ = id => document.getElementById(id);
const POWER_NAMES = { hardBoiled: 'HARD BOILED!', shellBreaker: 'SHELL BREAKER!', restock: 'RESTOCK!', overheal: 'OVERHEAL!', doubleYolks: 'DOUBLE YOLKS!', quailEgg: 'QUAIL EGG!' };
const TEAM = ['', '#4aa3ff', '#ff6a5c'];

export class Hud {
  constructor(settings) {
    this.settings = settings;
    this.canvas = $('hud-canvas'); this.ctx = this.canvas.getContext('2d');
    this.cache = {}; this.feed = []; this.hitT = 0; this.hitKill = false; this.dmgArcs = [];
    this.bannerT = 0; this.toastT = 0; this.chatLines = [];
    this.weaponIcons = {};
  }
  set(id, key, value, fn) { if (this.cache[key] === value) return; this.cache[key] = value; fn($(id), value); }
  text(id, value) { this.set(id, id + ':t', value, (e, v) => { e.textContent = v; }); }
  resize() { const d = Math.min(2, devicePixelRatio || 1); this.canvas.width = Math.round(innerWidth * d); this.canvas.height = Math.round(innerHeight * d); this.dpr = d; }

  leaderboard(players, myId, teams) {
    const top = players.slice(0, 10);
    const key = top.map(p => `${p.id}:${p.name}:${p.score}:${p.team}`).join('|') + myId;
    if (this.cache.board === key) return;
    this.cache.board = key;
    const list = $('board-list'); list.replaceChildren();
    const row = p => {
      const d = document.createElement('div'); d.className = 'lb' + (p.id === myId ? ' me' : '') + (teams ? ' t' + p.team : '');
      const a = document.createElement('span'); a.textContent = p.name; const b = document.createElement('span'); b.textContent = p.score;
      d.append(a, b); list.append(d);
    };
    if (teams) for (const t of [1, 2]) { const h = document.createElement('div'); h.className = 'lb-head'; h.style.color = TEAM[t]; h.textContent = t === 1 ? 'BLUE TEAM' : 'RED TEAM'; list.append(h); top.filter(p => p.team === t).forEach(row); }
    else top.forEach(row);
  }
  stats(me, coins, fps, ping) {
    this.text('best-streak', 'x' + me.bestStreak);
    this.text('hud-coin-n', String(coins));
    this.text('fps', String(fps));
    this.set('ping', 'ping', ping, (e, v) => { e.textContent = v + 'MS'; e.style.color = v < 80 ? '#5cff7a' : v < 160 ? '#ffd23f' : '#ff5545'; });
    const h = me.hands, s = slotOf(h);
    const ammo = `${s.mag}/${s.store}`;
    this.text('ammo-n', ammo);
    this.set('ammo-n', 'empty', s.mag === 0, (e, v) => e.classList.toggle('empty', v));
    this.set('nades', 'nades', h.grenades, (e, v) => [...e.children].forEach((c, i) => c.classList.toggle('off', i >= v)));
  }
  objective(state, teams) {
    const on = state.k !== 'ffa';
    this.set('objective', 'objOn', on, (e, v) => e.classList.toggle('hidden', !v));
    if (!on) return;
    this.text('score-b', String(state.s[0])); this.text('score-r', String(state.s[1]));
    let text = '', fill = 0, color = '#4aa3ff';
    if (state.k === 'teams') { text = 'TEAM KILLS'; fill = 0; }
    else if (state.k === 'spatula') {
      text = state.h ? `${state.h === 1 ? 'BLUE' : 'RED'} TEAM HAS THE SPATULA!` : 'GRAB THE SPATULA!'; color = TEAM[state.h] || '#ffd23f'; fill = state.h ? 1 : 0;
    } else if (state.k === 'roost') {
      const owner = state.o === 1 ? 'BLUE' : 'RED';
      const label = { waiting: 'WAITING FOR PLAYERS', contested: 'CONTESTED', takeover: 'TAKEOVER', capturing: `${owner} CAPTURING`, abandoned: `${owner} ROOST`, unclaimed: 'CLAIM THE ROOST', win: `${state.s[0] >= ROOST.goal ? 'BLUE' : 'RED'} TEAM WINS!`, start: 'CLAIM THE ROOST' }[state.st] || '';
      text = label + (state.st === 'capturing' && this.capturers > 1 ? ` (${this.capturers}X)` : '');
      fill = state.st === 'takeover' ? state.tk / ROOST.takeover : state.p / ROOST.max;
      color = state.st === 'takeover' ? TEAM[state.tt] : state.st === 'contested' ? '#ffd23f' : TEAM[state.o] || '#bbbbbb';
    }
    this.text('obj-text', text);
    this.set('obj-fill', 'objFill', Math.round(fill * 100) + color, e => { e.style.width = Math.round(fill * 100) + '%'; e.style.background = color; });
  }
  kill(killerName, victimName, weapon, killerTeam, victimTeam) {
    const row = document.createElement('div');
    const a = document.createElement('span'); a.textContent = killerName || ''; a.style.color = TEAM[killerTeam] || '#fff';
    const w = document.createElement('img'); w.src = this.weaponIcons[weapon] || this.weaponIcons.yolk47 || '';
    const b = document.createElement('span'); b.textContent = victimName; b.style.color = TEAM[victimTeam] || '#fff';
    if (killerName) row.append(a, w, b); else row.append(w, b);
    if (!this.weaponIcons[weapon]) w.remove();
    const feed = $('feed'); feed.prepend(row);
    this.feed.push({ row, t: 5 });
    while (feed.children.length > 5) { feed.lastChild.remove(); this.feed.shift(); }
  }
  banner(text, seconds = 2.5) { const e = $('banner'); e.textContent = text; e.classList.remove('hidden'); this.bannerT = seconds; }
  power(k) { this.banner(POWER_NAMES[k] || k); }
  toast(text, seconds = 3) { const e = $('toast'); e.textContent = text; e.classList.remove('hidden'); this.toastT = seconds; }
  chat(text, color = '#fff') {
    const lines = $('chat-lines'), d = document.createElement('div'); d.style.color = color;
    // "Name: message" lines show the name in bold.
    const i = text.indexOf(': ');
    if (i > 0 && i < 20) { const n = document.createElement('span'); n.className = 'name'; n.textContent = text.slice(0, i + 1) + ' '; d.append(n, document.createTextNode(text.slice(i + 2))); }
    else d.textContent = text;
    lines.append(d); this.chatLines.push({ d, t: 20 });
    while (lines.children.length > 7) { lines.firstChild.remove(); this.chatLines.shift(); }
  }
  hit(kill) { this.hitT = 0.25; this.hitKill = kill; }
  damageFrom(angle) { this.dmgArcs.push({ a: angle, t: 1 }); if (this.dmgArcs.length > 6) this.dmgArcs.shift(); this.vignette = 0.6; }
  tick(dt) {
    for (const f of this.feed) if ((f.t -= dt) <= 0 && f.row.isConnected) f.row.remove();
    this.feed = this.feed.filter(f => f.t > 0);
    for (const c of this.chatLines) if ((c.t -= dt) <= 0 && c.d.isConnected) c.d.remove();
    this.chatLines = this.chatLines.filter(c => c.t > 0 || this.chatOpen);
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) $('banner').classList.add('hidden');
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $('toast').classList.add('hidden');
  }

  drawScope(c, w, h, dt, v, id) {
    const A = this.scopeA, r = Math.min(w, h) * 0.46;
    // Sway: the lens lags behind the view (a damped spring fed by turning), plus a walk bob and breathing.
    const sw = this.sway || (this.sway = { x: 0, y: 0, vx: 0, vy: 0, yaw: v.yaw, pitch: v.pitch, t: 0 });
    let dy = v.yaw - sw.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    sw.vx += dy * 900; sw.vy -= (v.pitch - sw.pitch) * 900; sw.yaw = v.yaw; sw.pitch = v.pitch;
    const k = Math.min(1, dt * 60);
    sw.vx -= (sw.x * 0.9 + sw.vx * 0.35) * k; sw.vy -= (sw.y * 0.9 + sw.vy * 0.35) * k;
    sw.x = Math.max(-r * 0.25, Math.min(r * 0.25, sw.x + sw.vx * dt * 6)); sw.y = Math.max(-r * 0.25, Math.min(r * 0.25, sw.y + sw.vy * dt * 6));
    sw.t += dt * (1 + Math.min(1, v.speed / 3) * 4);
    const bob = Math.min(1, v.speed / 3) * (v.air ? 0 : 1);
    const ox = sw.x + Math.sin(sw.t * 1.1) * (1.5 + bob * 6), oy = sw.y + Math.sin(sw.t * 2.2) * (1 + bob * 4) + (1 - A) * r * 0.5;
    let cx = w / 2 + ox, cy = h / 2 + oy;
    c.save(); c.globalAlpha = A;
    // The tube: everything outside the lens is black.
    c.fillStyle = '#000'; c.beginPath(); c.rect(0, 0, w, h); c.arc(cx, cy, r, 0, Math.PI * 2, true); c.fill();
    // Lens rim: a soft dark falloff, a thin bright edge and a faint blue coating glint up and left.
    let g = c.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,.85)');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    g = c.createRadialGradient(cx - r * 0.45, cy - r * 0.5, 0, cx - r * 0.45, cy - r * 0.5, r * 0.6);
    g.addColorStop(0, 'rgba(150,200,255,.10)'); g.addColorStop(1, 'rgba(150,200,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#111'; c.lineWidth = 7; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, r - 4, Math.PI * 1.05, Math.PI * 1.6); c.stroke();
    // Reticles stay on the true aim point (the tube drifts around them), so the sway never lies.
    cx = w / 2; cy = h / 2 + (1 - A) * r * 0.5;
    c.strokeStyle = '#000'; c.fillStyle = '#000';
    if (id === 'poacher') {
      // Duplex: heavy posts from the rim that thin to fine hairs near the centre, with mil dots.
      const post = r * 0.5;
      c.lineWidth = 5; c.beginPath();
      c.moveTo(cx - r, cy); c.lineTo(cx - post, cy); c.moveTo(cx + post, cy); c.lineTo(cx + r, cy);
      c.moveTo(cx, cy + post); c.lineTo(cx, cy + r); c.stroke();
      c.lineWidth = 1.25; c.beginPath(); c.moveTo(cx - post, cy); c.lineTo(cx + post, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + post); c.stroke();
      for (let i = 1; i <= 4; i++) for (const sgn of [-1, 1]) {
        c.beginPath(); c.arc(cx + sgn * i * post / 5, cy, 1.8, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(cx, cy + sgn * i * post / 5, 1.8, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = 'rgba(230,30,20,.95)'; c.beginPath(); c.arc(cx, cy, 1.6, 0, Math.PI * 2); c.fill();
    } else if (id === 'yolkzooka') {
      // Rangefinder: a square sight (green beyond arming range) with stadia ticks for drop.
      const ok = v.aimDist > WEAPONS.yolkzooka.minRange;
      c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx - 22, cy); c.moveTo(cx + 22, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy + 22); c.lineTo(cx, cy + r); c.stroke();
      for (let i = 1; i <= 4; i++) { const y = cy + 22 + i * r * 0.11, L = 14 - i * 2; c.beginPath(); c.moveTo(cx - L, y); c.lineTo(cx + L, y); c.stroke(); }
      c.strokeStyle = ok ? 'rgba(70,240,110,.95)' : 'rgba(255,60,50,.95)'; c.lineWidth = 2.5; c.strokeRect(cx - 16, cy - 16, 32, 32);
      c.fillStyle = c.strokeStyle; c.font = '800 13px n, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(v.aimDist < 99 ? v.aimDist.toFixed(1) + 'u' : '--', cx + 24, cy - 24);
    } else {
      // Cage Free: fine crosshair with a centre gap, a ring and stadia ticks.
      c.lineWidth = 1.5; c.beginPath();
      c.moveTo(cx - r, cy); c.lineTo(cx - 6, cy); c.moveTo(cx + 6, cy); c.lineTo(cx + r, cy);
      c.moveTo(cx, cy - r); c.lineTo(cx, cy - 6); c.moveTo(cx, cy + 6); c.lineTo(cx, cy + r); c.stroke();
      c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, r * 0.16, 0, Math.PI * 2); c.stroke();
      for (let i = 1; i <= 5; i++) { const d = r * 0.16 + i * r * 0.12, L = i % 2 ? 5 : 9; c.beginPath(); c.moveTo(cx - L, cy + d); c.lineTo(cx + L, cy + d); c.moveTo(cx + d, cy - L); c.lineTo(cx + d, cy + L); c.moveTo(cx - d, cy - L); c.lineTo(cx - d, cy + L); c.stroke(); }
      c.fillStyle = 'rgba(230,30,20,.95)'; c.beginPath(); c.arc(cx, cy, 1.5, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  // Per-frame canvas: crosshair, scope, health ring, grenade charge, hit marker, damage, markers.
  draw(dt, v) {
    const c = this.ctx, d = this.dpr || 1, W = this.canvas.width, H = this.canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    c.setTransform(d, 0, 0, d, 0, 0);
    const w = innerWidth, h = innerHeight, cx = w / 2, cy = h / 2;
    const me = v.me, hands = me?.hands;
    if (!me || !me.alive) return;
    const wpn = weaponOf(hands), s = slotOf(hands);
    // Damage vignette and arcs.
    if (this.vignette > 0) {
      this.vignette = Math.max(0, this.vignette - dt * 1.2);
      const g = c.createRadialGradient(cx, cy, Math.min(w, h) * 0.35, cx, cy, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(200,0,0,0)'); g.addColorStop(1, `rgba(200,0,0,${this.vignette * 0.55})`);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
    for (const a of this.dmgArcs) {
      a.t -= dt; if (a.t <= 0) continue;
      const ang = a.a - v.yaw;
      c.strokeStyle = `rgba(255,40,30,${a.t * 0.8})`; c.lineWidth = 10; c.lineCap = 'round';
      c.beginPath(); c.arc(cx, cy, Math.min(w, h) * 0.18, -Math.PI / 2 - ang - 0.35, -Math.PI / 2 - ang + 0.35); c.stroke();
    }
    this.dmgArcs = this.dmgArcs.filter(a => a.t > 0);
    // Scope overlay (Cage Free, Poacher, Yolkzooka when aiming): fades in as the gun comes up, sways
    // against mouse movement and bobs while walking, a darkened lens rim, and a reticle per gun.
    const scoped = hands.ads && wpn.scoped;
    this.scopeA = scoped ? Math.min(1, (this.scopeA || 0) + dt * 9) : 0;
    if (this.scopeA > 0) this.drawScope(c, w, h, dt, v, s.id);
    else { this.sway = null; }
    // Crosshair: four lines whose gap follows the real spread; hidden while swapping or meleeing.
    const busy = hands.swap > 0 || hands.melee > 0;
    if (!busy && !scoped) {
      const spread = currentSpread(hands, wpn);
      const fovPx = h / 2 / Math.tan(v.fov / 2 * Math.PI / 180);
      const gap = Math.max(4, Math.tan(spread / 2) * fovPx);
      c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 2; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 2;
      if (s.id === 'doubleYolker') {
        c.beginPath(); c.ellipse(cx, cy, gap * 1.0, gap * WEAPONS.doubleYolker.vSpreadMul, 0, 0, Math.PI * 2); c.stroke();
      } else if (s.id === 'yolkzooka') {
        c.strokeStyle = v.aimDist > WEAPONS.yolkzooka.minRange ? 'rgba(80,255,110,.95)' : 'rgba(255,60,50,.95)';
        const q = Math.max(12, gap); c.strokeRect(cx - q, cy - q, q * 2, q * 2);
      } else {
        const L = 9;
        c.beginPath();
        c.moveTo(cx - gap - L, cy); c.lineTo(cx - gap, cy); c.moveTo(cx + gap, cy); c.lineTo(cx + gap + L, cy);
        c.moveTo(cx, cy - gap - L); c.lineTo(cx, cy - gap); c.moveTo(cx, cy + gap); c.lineTo(cx, cy + gap + L);
        c.stroke();
      }
      if (this.settings.centerDot) { c.fillStyle = '#fff'; c.fillRect(cx - 1.5, cy - 1.5, 3, 3); }
      c.shadowBlur = 0;
    }
    // Hit marker.
    if (this.hitT > 0 && this.settings.hitMarkers) {
      this.hitT -= dt;
      c.strokeStyle = this.hitKill ? 'rgba(255,70,50,.95)' : 'rgba(255,255,255,.95)'; c.lineWidth = 2.5;
      const a = 6, b = 14; c.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { c.moveTo(cx + sx * a, cy + sy * a); c.lineTo(cx + sx * b, cy + sy * b); }
      c.stroke();
    }
    // Grenade charge meter beside the crosshair.
    if (hands.charging) {
      const p = Math.max(0, hands.power), x = cx + 42, y = cy - 30;
      c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(x, y, 10, 60);
      c.fillStyle = p > 0.95 ? '#ff5545' : '#ffd23f'; c.fillRect(x, y + 60 * (1 - p), 10, 60 * p);
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(x, y, 10, 60);
    }
    // Health meter: white disc, teal outline, draining orange ring (blue shield / cracked timer).
    const hx = cx, hy = h - 56, R = 34;
    c.fillStyle = '#fff'; c.beginPath(); c.arc(hx, hy, R, 0, Math.PI * 2); c.fill();
    c.lineWidth = 6; c.strokeStyle = '#174e5e'; c.beginPath(); c.arc(hx, hy, R + 3, 0, Math.PI * 2); c.stroke();
    const shield = me.shield > 0 && !(me.overheal > 0);
    const frac = shield ? me.shield / STREAKS.hardBoiledHp : Math.min(1, me.hp / 100);
    c.lineWidth = 9; c.strokeStyle = shield ? '#7fd3ff' : me.hp > 100 ? '#ff4fb0' : '#f39a25';
    c.beginPath(); c.arc(hx, hy, R - 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); c.stroke();
    if (me.power.shellBreaker > 0) { c.lineWidth = 4; c.strokeStyle = '#ff3b2f'; c.beginPath(); c.arc(hx, hy, R - 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * me.power.shellBreaker / STREAKS.shellBreaker.cap); c.stroke(); }
    c.fillStyle = '#174e5e'; c.font = '900 20px n, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(Math.ceil(shield ? me.shield : me.hp)), hx, hy + 1);
    // Spawn shield hint.
    if (me.spawnShield > 0) { c.fillStyle = 'rgba(120,255,140,.9)'; c.font = '800 15px n, sans-serif'; c.fillText('SPAWN SHIELD', hx, hy - R - 16); }
    // Off-screen markers: roost crown and the spatula carrier (shown through walls).
    for (const mk of v.markers || []) {
      const p = mk.screen; if (!p) continue;
      let x = p.x, y = p.y;
      const off = p.behind || x < 30 || x > w - 30 || y < 30 || y > h - 30;
      if (off) { const ang = Math.atan2(y - cy, x - cx) + (p.behind ? Math.PI : 0); x = cx + Math.cos(ang) * (Math.min(w, h) * 0.42); y = cy + Math.sin(ang) * (Math.min(w, h) * 0.42); }
      c.fillStyle = mk.color; c.strokeStyle = '#000'; c.lineWidth = 3; c.font = '800 14px n, sans-serif';
      c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.fillText(mk.label, x, y - 18);
    }
  }
}
