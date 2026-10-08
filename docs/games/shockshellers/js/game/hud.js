// The in-game HUD (GDD §19.6). During play almost all of it is drawn into two offscreen canvases
// that the renderer lays over the 3D frame itself (any change to the page's text makes the
// compositor repaint the whole page, which a Chromebook feels as a stutter):
// - the panel: what changes now and then (leaderboard and best streak, yolks, kill feed, ammo,
//   frame rate and ping), redrawn and re-uploaded only when one of them changes;
// - the live layer: what moves (crosshair, health ring, hit markers and damage numbers, the kill
//   banner, enemy health bars, damage arcs, grenade charge, scope, markers, the death recap),
//   skipped on frames where nothing on it changed.
// Page text is left for what is rare or needs the keyboard: chat, banners and toasts, the
// objective bar, and the leaderboard on the respawn screen.
import { surfaceDocument as document } from '../surface.js?v=muyu9h16';
import { WEAPONS, GRENADE, ROOST, STREAKS } from '../sim/tuning.js?v=muyu9h16';
import { currentSpread, weaponOf, slotOf } from '../sim/combat.js?v=muyu9h16';

const $ = id => document.getElementById(id);
const POWER_NAMES = { hardBoiled: 'HARD BOILED!', shellBreaker: 'SHELL BREAKER!', restock: 'RESTOCK!', overheal: 'OVERHEAL!', doubleYolks: 'DOUBLE YOLKS!', quailEgg: 'QUAIL EGG!' };
const TEAM = ['', '#4aa3ff', '#ff6a5c'];
const STREAK_NAMES = ['', '', 'DOUBLE CRACK!', 'TRIPLE CRACK!', 'OVER EASY!', 'SCRAMBLER!', 'HARD BOILED!', 'EGGSTERMINATOR!', 'YOLKAGEDDON!'];

export class Hud {
  constructor(settings) {
    this.settings = settings;
    this.canvas = new OffscreenCanvas(1, 1); this.ctx = this.canvas.getContext('2d');
    this.panel = new OffscreenCanvas(1, 1); this.pctx = this.panel.getContext('2d'); this.panelDirty = true; this.panelSig = '';
    this.board = null; this.coins = 0; this.best = 0;
    this.dirty = true; this.sig = ''; this.ammo = { mag: 0, store: 0, nades: 0, id: '' }; this.fps = 0; this.ping = 0;
    this.kills = []; this.nums = []; this.barShown = new Map();
    this.cache = {}; this.feed = []; this.hitT = 0; this.hitKill = false; this.dmgArcs = [];
    this.bannerT = 0; this.toastT = 0; this.chatLines = [];
    this.weaponIcons = {}; this.iconImgs = {};
    this.gap = 8; this.hpShown = 100; this.hpTrail = 100; this.t = 0; this.death = null; this.popups = [];
  }
  // A weapon icon as an image the canvas can draw (decoded once from its data: URL).
  icon(id) {
    if (this.iconImgs[id]) return this.iconImgs[id].complete ? this.iconImgs[id] : null;
    const src = this.weaponIcons[id]; if (!src) return null;
    const img = new Image(); img.src = src; this.iconImgs[id] = img; return null;
  }
  // We cracked someone: a banner under the crosshair names them (in their shell colour), with the
  // streak and the reward.
  confirmKill(name, streak, yolks, color = 0xfff6e5) {
    this.kills = [{ name, streak, yolks, color: '#' + color.toString(16).padStart(6, '0'), t: 0 }];
    if (yolks) this.popups.push({ text: '+' + yolks, t: 0 });
  }
  // Damage we dealt, floating up from where it landed; quick hits on the same egg add up in one number.
  damageNumber(id, x, y, z, dmg, kill) {
    const n = this.nums.find(q => q.id === id && q.t < 0.55);
    if (n) { n.dmg += dmg; n.t = 0.04; n.kill = n.kill || kill; n.x = x; n.y = y; n.z = z; return; }
    this.nums.push({ id, x, y, z, dmg, kill, t: 0, dx: (Math.random() - 0.5) * 24 });
    if (this.nums.length > 8) this.nums.shift();
  }
  // We got cracked: who did it, with what, and how much they had left.
  died(killer, weapon, hp) { this.death = { killer, weapon, hp, t: 0 }; }
  set(id, key, value, fn) { if (this.cache[key] === value) return; this.cache[key] = value; fn($(id), value); }
  text(id, value) { this.set(id, id + ':t', value, (e, v) => { e.textContent = v; }); }
  // Drawn at the renderer's final-image sharpness (maxDpr, at most 1.5 device pixels per CSS pixel).
  resize() {
    const d = Math.min(this.maxDpr || 1.5, devicePixelRatio || 1), w = Math.max(1, Math.round(innerWidth * d)), h = Math.max(1, Math.round(innerHeight * d));
    for (const c of [this.canvas, this.panel]) { c.width = w; c.height = h; }
    this.dpr = d; this.sig = ''; this.panelSig = ''; this.resized = true;
    this.placeNav();
  }

  // The top ten, for the panel; the page's copy is only kept up to date on the respawn screen.
  leaderboard(players, myId, teams) {
    const top = players.slice(0, 10);
    const key = top.map(p => `${p.id}:${p.name}:${p.score}:${p.team}`).join('|') + myId + (teams ? 't' : '');
    if (this.board?.key !== key) { this.board = { key, myId, teams, rows: top.map(p => ({ id: p.id, name: p.name, score: p.score, team: p.team })) }; }
    if (!$('hud').classList.contains('menu') || this.cache.board === key) return;
    this.cache.board = key;
    const list = $('board-list'); list.replaceChildren();
    const row = p => {
      const d = document.createElement('div'); d.className = 'lb' + (p.id === myId ? ' me' : '') + (teams ? ' t' + p.team : '');
      const a = document.createElement('span'); a.textContent = p.name; const b = document.createElement('span'); b.textContent = p.score;
      d.append(a, b); list.append(d);
    };
    if (teams) for (const t of [1, 2]) { const h = document.createElement('div'); h.className = 'lb-head'; h.style.color = TEAM[t]; h.textContent = t === 1 ? 'BLUE TEAM' : 'RED TEAM'; list.append(h); top.filter(p => p.team === t).forEach(row); }
    else top.forEach(row);
    this.placeNav();
  }
  // The respawn screen's buttons (top left) go below the leaderboard, however long it is, and get
  // more compact when the screen is short.
  placeNav() {
    if (!$('hud').classList.contains('menu')) return;
    const u = this.u || 1, r = $('board-list').getBoundingClientRect();
    if (!r.height) return;
    const top = Math.max(150, Math.ceil(r.bottom / u) + 14);
    const sig = top + ':' + Math.round(innerHeight / u);
    if (this.navSig === sig) return; this.navSig = sig;
    const nav = $('rs-left');
    nav.style.top = `calc(var(--u)*${top})`;
    nav.classList.toggle('tight', innerHeight / u - top < 330);
  }
  stats(me, coins, fps, ping) {
    if ($('hud').classList.contains('menu')) this.text('best-streak', 'x' + me.bestStreak);
    this.coins = coins; this.best = me.bestStreak;
    const h = me.hands, s = slotOf(h);
    this.ammo.mag = s.mag; this.ammo.store = s.store; this.ammo.nades = h.grenades; this.ammo.id = s.id;
    this.fps = fps; this.ping = ping;
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
  // The kill feed (newest on top, five at most, each for five seconds).
  kill(killerName, victimName, weapon, killerTeam, victimTeam, mine = false) {
    this.feed.unshift({ killer: killerName || '', victim: victimName, weapon, kTeam: killerTeam, vTeam: victimTeam, mine, t: 5, n: (this.feedN = (this.feedN || 0) + 1) });
    if (this.feed.length > 5) this.feed.pop();
  }
  // (Hidden and shown again so its entrance animation replays even if one is already up.)
  banner(text, seconds = 2.5) { const e = $('banner'); e.classList.add('hidden'); void e.offsetWidth; e.textContent = text; e.classList.remove('hidden'); this.bannerT = seconds; }
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
  hit(kill) { this.hitT = kill ? 0.5 : 0.28; this.hitMax = this.hitT; this.hitKill = kill; this.gapKick = Math.min(10, (this.gapKick || 0) + 4); }
  damageFrom(angle) { this.dmgArcs.push({ a: angle, t: 1 }); if (this.dmgArcs.length > 6) this.dmgArcs.shift(); this.vignette = 0.6; }
  tick(dt) {
    for (const f of this.feed) f.t -= dt;
    this.feed = this.feed.filter(f => f.t > 0);
    for (const c of this.chatLines) if ((c.t -= dt) <= 0 && c.d.isConnected) c.d.remove();
    this.chatLines = this.chatLines.filter(c => c.t > 0 || this.chatOpen);
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) $('banner').classList.add('hidden');
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $('toast').classList.add('hidden');
  }

  // The kill banner: "CRACKED" over the victim's name on a dark ribbon, a little egg in their colour
  // with a crack through it, the streak above and the reward beside it. Pops in, holds, slides away.
  drawKills(c, cx, y, dt) {
    const k = this.kills[0]; if (!k) return;
    k.t += dt;
    if (k.t > 2.4) { this.kills.length = 0; return; }
    const pop = Math.min(1, k.t / 0.14), out = k.t > 2.05 ? Math.max(0, 1 - (k.t - 2.05) / 0.35) : 1;
    const s = (1 + (1 - pop) * 0.5 + Math.sin(Math.min(1, k.t / 0.3) * Math.PI) * 0.06) * (0.92 + out * 0.08);
    const u = this.u || 1;
    c.save(); c.globalAlpha = pop * out; c.translate(cx, y + (1 - out) * 10); c.scale(s * u, s * u);
    c.font = '900 26px n, sans-serif';
    const nw = Math.max(110, c.measureText(k.name).width), W = nw + 118, H = 62, x0 = -W / 2;
    // Ribbon (slanted ends) with a red edge.
    c.beginPath(); c.moveTo(x0 + 14, -H / 2); c.lineTo(x0 + W, -H / 2); c.lineTo(x0 + W - 14, H / 2); c.lineTo(x0, H / 2); c.closePath();
    const g = c.createLinearGradient(0, -H / 2, 0, H / 2); g.addColorStop(0, 'rgba(14,30,44,.88)'); g.addColorStop(1, 'rgba(8,18,28,.92)');
    c.fillStyle = g; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255,85,69,.9)'; c.stroke();
    c.fillStyle = '#ff5545'; c.beginPath(); c.moveTo(x0 + 14, -H / 2); c.lineTo(x0 + 22, -H / 2); c.lineTo(x0 + 8, H / 2); c.lineTo(x0, H / 2); c.closePath(); c.fill();
    // The victim's egg, cracked.
    const ex = x0 + 48;
    c.fillStyle = k.color; c.beginPath(); c.ellipse(ex, 2, 15, 19, 0, 0, Math.PI * 2); c.fill();
    c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.55)'; c.stroke();
    c.strokeStyle = '#2b1a10'; c.lineWidth = 2.2; c.lineJoin = 'round'; c.beginPath(); c.moveTo(ex - 14, -1); c.lineTo(ex - 6, 4); c.lineTo(ex - 1, -4); c.lineTo(ex + 5, 5); c.lineTo(ex + 14, -2); c.stroke();
    c.fillStyle = '#ffc531'; c.beginPath(); c.moveTo(ex - 6, 5); c.lineTo(ex - 1, -2); c.lineTo(ex + 5, 6); c.lineTo(ex, 10); c.closePath(); c.fill();
    // Text.
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    const tx = x0 + 74;
    c.font = '400 17px s, sans-serif'; c.fillStyle = '#ff5545'; c.fillText('CRACKED', tx, -14);
    c.font = '900 26px n, sans-serif'; c.fillStyle = '#fff'; c.fillText(k.name, tx, 11);
    if (k.streak > 1) {
      const label = STREAK_NAMES[Math.min(k.streak, STREAK_NAMES.length - 1)] || `${k.streak} STREAK`;
      c.textAlign = 'center'; c.font = '400 19px s, sans-serif'; c.lineWidth = 6; c.strokeStyle = '#0b4560';
      c.strokeText(label, 0, -H / 2 - 16); c.fillStyle = '#ffd23f'; c.fillText(label, 0, -H / 2 - 16);
    }
    c.restore();
  }
  // Damage numbers at the spot each hit landed (projected each frame), rising and fading.
  drawNumbers(c, dt, project) {
    for (const n of this.nums) {
      n.t += dt; if (n.t > 0.95) continue;
      const p = project(n.x, n.y, n.z); if (p.behind) continue;
      const a = n.t < 0.65 ? 1 : 1 - (n.t - 0.65) / 0.3, pop = 1 + Math.max(0, 0.12 - n.t) * 4;
      const size = Math.round((n.kill ? 30 : 22 + Math.min(8, n.dmg / 12)) * pop);
      c.globalAlpha = Math.max(0, a); c.font = `900 ${size}px n, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
      const x = p.x + n.dx + 18, y = p.y - 26 - n.t * 46, txt = String(Math.round(n.dmg));
      c.lineWidth = 5; c.strokeStyle = 'rgba(20,10,4,.85)'; c.strokeText(txt, x, y);
      c.fillStyle = n.kill ? '#ff3b2a' : n.dmg >= 50 ? '#ffd23f' : '#ffffff'; c.fillText(txt, x, y);
    }
    c.globalAlpha = 1;
    this.nums = this.nums.filter(n => n.t <= 0.95);
  }
  // Health bars over eggs we've hurt (only while we can see them): white chunk trails the loss.
  drawBars(c, dt, bars, project) {
    const seen = new Set();
    for (const b of bars) {
      const p = project(b.x, b.y, b.z); if (p.behind) continue;
      seen.add(b.id);
      let st = this.barShown.get(b.id); if (!st) this.barShown.set(b.id, st = { hp: b.hp, trail: b.hp });
      st.hp = b.hp; st.trail = st.trail < b.hp ? b.hp : Math.max(b.hp, st.trail - dt * 70);
      const scale = Math.max(0.6, Math.min(1.2, 9 / Math.max(1, b.dist))), W = 54 * scale, H = 7 * scale, x = p.x - W / 2, y = p.y - H - 4;
      c.globalAlpha = Math.min(1, b.fade);
      c.fillStyle = 'rgba(10,14,20,.75)'; c.fillRect(x - 2, y - 2, W + 4, H + 4);
      c.fillStyle = 'rgba(255,240,200,.9)'; c.fillRect(x, y, W * Math.min(1, st.trail / 100), H);
      c.fillStyle = b.hp < 35 ? '#ff3b2f' : b.hp < 70 ? '#ffb02e' : '#7dff6a'; c.fillRect(x, y, W * Math.min(1, b.hp / 100), H);
      if (b.shield > 0) { c.fillStyle = '#7fd3ff'; c.fillRect(x, y - 3 * scale, W * Math.min(1, b.shield / STREAKS.hardBoiledHp), 2 * scale); }
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1; for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(x + W * i / 4, y); c.lineTo(x + W * i / 4, y + H); c.stroke(); }
    }
    c.globalAlpha = 1;
    for (const id of this.barShown.keys()) if (!seen.has(id)) this.barShown.delete(id);
  }
  // The panel layer (see the header): redrawn only when something on it changed.
  drawPanel(v) {
    const me = v.me, alive = !!me?.alive, w = innerWidth, h = innerHeight, b = this.board, u = this.u || 1;
    const feedSig = this.feed.map(f => f.n + ':' + Math.ceil(Math.min(1, f.t / 0.4) * 8) + (this.icon(f.weapon) ? 'i' : '')).join(',');
    const a = this.ammo, sig = `${!!this.replay}|${!!this.podium}|${this.clock}|${w}x${h}|${u}|${b?.key}|${this.best}|${this.coins}|${this.fps}|${this.ping}|${feedSig}|${alive ? `${a.id}|${a.mag}|${a.store}|${a.nades}` : '-'}`;
    if (sig === this.panelSig) return;
    this.panelSig = sig; this.panelDirty = true;
    const c = this.pctx, d = this.dpr || 1;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.panel.width, this.panel.height);
    c.setTransform(d * u, 0, 0, d * u, 0, 0);
    const W = w / u;
    if (this.replay || this.podium) return;   // (the instant replay and the podium have the screen to themselves)
    if (b) this.drawBoard(c, b);
    if (this.clock) this.drawClock(c, W);
    this.drawCoins(c, W);
    this.drawPerf(c, W);
    this.drawFeed(c, W);
    if (alive) { c.setTransform(d, 0, 0, d, 0, 0); this.drawAmmo(c, w, h, weaponOf(me.hands)); }
  }
  // Leaderboard (top left): the top ten, our row in orange, team colours and headers; the best streak
  // beside it. Laid out like the page's own on the respawn screen.
  drawBoard(c, b) {
    let y = 6;
    c.textBaseline = 'middle'; c.font = '800 14px n, sans-serif';
    const row = p => {
      const me = p.id === b.myId;
      c.fillStyle = me ? 'rgba(247,148,29,.9)' : 'rgba(40,40,40,.35)'; c.beginPath(); c.roundRect(8, y, 200, 18, 2); c.fill();
      c.fillStyle = me ? '#fff' : b.teams ? (p.team === 1 ? '#a8d6ff' : '#ffb4ac') : 'rgba(255,255,255,.78)';
      c.textAlign = 'left'; c.fillText(p.name, 16, y + 9.5, 150); c.textAlign = 'right'; c.fillText(String(p.score), 200, y + 9.5);
      y += 20;
    };
    if (b.teams) for (const t of [1, 2]) {
      c.font = '400 13px s, sans-serif'; c.textAlign = 'left'; c.fillStyle = TEAM[t]; c.fillText(t === 1 ? 'BLUE TEAM' : 'RED TEAM', 14, y + 8); y += 18;
      c.font = '800 14px n, sans-serif'; b.rows.filter(p => p.team === t).forEach(row);
    }
    else b.rows.forEach(row);
    // Best streak.
    c.textAlign = 'left'; c.font = '400 34px s, sans-serif'; c.fillStyle = '#0b4560'; c.fillText('x' + this.best, 221, 30);
    c.fillStyle = '#ffd23f'; c.fillText('x' + this.best, 220, 27);
    const sw = c.measureText('x' + this.best).width;
    c.font = '400 13px s, sans-serif'; c.fillStyle = '#0b4560'; c.fillText('BEST', 225 + sw, 23); c.fillText('STREAK', 225 + sw, 36);
    c.fillStyle = '#fff'; c.fillText('BEST', 224 + sw, 21); c.fillText('STREAK', 224 + sw, 34);
  }
  // Golden Yolks (top right).
  drawCoins(c, w) {
    c.font = '900 24px n, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
    const s = String(this.coins), tw = c.measureText(s).width, x = w - 12, y = 19;
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillText(s, x + 1, y + 2); c.fillStyle = '#fff'; c.fillText(s, x, y);
    const cx = x - tw - 16;
    c.fillStyle = '#f2a500'; c.beginPath(); c.ellipse(cx, y + 1, 9, 10, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffd23f'; c.beginPath(); c.ellipse(cx, y, 8, 9, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff6c4'; c.beginPath(); c.ellipse(cx - 3, y - 4, 2.5, 3.5, 0, 0, Math.PI * 2); c.fill();
  }
  // Kill feed (top right, under the frame rate): killer, the weapon's icon, victim; ours in orange.
  drawFeed(c, w) {
    let y = 62;
    c.font = '800 14px n, sans-serif'; c.textBaseline = 'middle';
    for (const f of this.feed) {
      const img = this.icon(f.weapon === 'melee' ? 'whisk' : f.weapon) || this.icon('yolk47'), iw = img ? 30 : 0;
      const kw = f.killer ? c.measureText(f.killer).width + 6 : 0, vw = c.measureText(f.victim).width, W = kw + iw + 6 + vw + 16, x = w - 12 - W;
      c.globalAlpha = Math.min(1, f.t / 0.4);
      c.fillStyle = f.mine ? 'rgba(247,148,29,.6)' : 'rgba(0,0,0,.35)'; c.beginPath(); c.roundRect(x, y, W, 21, 4); c.fill();
      c.textAlign = 'left';
      if (f.killer) { c.fillStyle = TEAM[f.kTeam] || '#fff'; c.fillText(f.killer, x + 8, y + 11); }
      if (img) c.drawImage(img, x + 8 + kw, y + 3, iw, 15);
      c.fillStyle = TEAM[f.vTeam] || '#fff'; c.fillText(f.victim, x + 8 + kw + iw + 6, y + 11);
      y += 24;
    }
    c.globalAlpha = 1;
  }
  // Ammo (bottom right): the gun's name, rounds in the magazine large over the reserve, a tick per
  // round, and the Cluck Bombs. Red when empty.
  drawAmmo(c, w, h, wpn) {
    c.save(); const u = this.u || 1; c.scale(u, u); w /= u; h /= u;
    const a = this.ammo, x = w - 20, y = h - 18;
    c.textAlign = 'right'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
    c.font = '900 22px n, sans-serif'; const sw = c.measureText('/' + a.store).width;
    c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowOffsetY = 3; c.shadowBlur = 2;
    c.fillStyle = 'rgba(255,255,255,.72)'; c.fillText('/' + a.store, x, y - 22);
    c.font = '900 50px n, sans-serif'; c.fillStyle = a.mag === 0 ? '#ff5545' : a.mag <= Math.max(1, Math.floor(wpn.mag * 0.25)) ? '#ffd23f' : '#fff';
    c.fillText(String(a.mag), x - sw - 4, y - 22);
    c.shadowColor = 'transparent';
    c.font = '400 14px s, sans-serif'; c.fillStyle = '#ffd23f'; c.fillText(wpn.name.toUpperCase(), x, y - 78);
    // Round ticks (up to 40), newest on the right.
    const n = Math.min(40, wpn.mag), tw = n > 20 ? 3 : 5, gap = n > 20 ? 1.6 : 2.5;
    for (let i = 0; i < n; i++) { c.fillStyle = i < a.mag ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.18)'; c.fillRect(x - (n - i) * (tw + gap), y - 12, tw, 12); }
    // Cluck Bombs.
    for (let i = 0; i < 3; i++) {
      const gx = x - 10 - i * 22, gy = y - 104;
      c.fillStyle = i < a.nades ? '#fff' : 'rgba(20,70,85,.85)';
      c.beginPath(); c.ellipse(gx, gy, 8, 10, 0, 0, Math.PI * 2); c.fill(); c.fillRect(gx - 3, gy - 15, 6, 5);
    }
    c.restore();
  }
  // Frame rate and ping, top right under the yolks.
  drawPerf(c, w) {
    c.save();
    c.font = '800 12px n, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'top'; c.lineJoin = 'round';
    const ping = this.ping, pc = ping < 80 ? '#5cff7a' : ping < 160 ? '#ffd23f' : '#ff5545', ps = ping + ' MS', fs = this.fps + ' FPS  ';
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.55)'; c.strokeText(ps, w - 14, 40); c.fillStyle = pc; c.fillText(ps, w - 14, 40);
    const pw = c.measureText(ps).width; c.strokeText(fs, w - 14 - pw, 40); c.fillStyle = '#fff'; c.fillText(fs, w - 14 - pw, 40);
    c.restore();
  }
  // The round clock, top centre: red in the last half minute.
  drawClock(c, W) {
    const t = this.clock, low = this.clockLow;
    c.save(); c.font = '400 26px s, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top';
    c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,.55)'; c.strokeText(t, W / 2, 8);
    c.fillStyle = low ? '#ff5545' : '#fff'; c.fillText(t, W / 2, 8);
    c.restore();
  }
  // The end-of-round podium over its 3D scene: who won, each place's name over their egg, everyone's
  // results (objective time in objective modes), and where the next round is going.
  drawPodium(dt, v) {
    this.t += dt; this.drawPanel({ me: null });
    const c = this.ctx, d = this.dpr || 1, w = innerWidth, h = innerHeight, r = v.r, u = Math.max(0.6, Math.min(1, w / 1100, h / 700));
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.canvas.width, this.canvas.height); c.setTransform(d, 0, 0, d, 0, 0);
    this.dirty = true;
    const byId = new Map(r.rows.map(x => [x.id, x])), first = byId.get(r.podium[0]);
    const text = (s, x, y, size, fill, align = 'center', font = 's') => {
      c.font = `${font === 's' ? 400 : 800} ${Math.round(size * u)}px ${font}, sans-serif`; c.textAlign = align; c.textBaseline = 'middle';
      c.lineWidth = Math.max(3, size * u * 0.16); c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeText(s, x, y); c.fillStyle = fill; c.fillText(s, x, y);
    };
    const pop = Math.min(1, this.t / 0.35), title = r.team ? `${r.team === 1 ? 'BLUE' : 'RED'} TEAM WINS!` : first ? `${first.name.toUpperCase()} WINS!` : 'ROUND OVER';
    c.save(); c.translate(w / 2, 52 * u); c.scale(0.6 + pop * 0.4, 0.6 + pop * 0.4);
    text(title, 0, 0, 48, r.team ? TEAM[r.team] : '#ffd23f'); c.restore();
    if (r.scores) text(`BLUE ${r.scores[0]}  —  ${r.scores[1]} RED`, w / 2, 98 * u, 22, '#fff');
    const medal = ['#ffd23f', '#e3e8ee', '#e6a26a'];
    for (const l of v.labels) {
      const row = byId.get(r.podium[l.place]); if (!row) continue;
      const ly = Math.max(l.y, (r.scores ? 150 : 124) * u);   // (never up into the title)
      text(`${l.place + 1}. ${row.name}`, l.x, ly - 26 * u, 22, row.id === v.myId ? '#ff9a3c' : medal[l.place], 'center', 'n');
      text(`${row.score} pts · ${row.kills} cracks`, l.x, ly - 4 * u, 15, '#fff', 'center', 'n');
    }
    // The table: the top seven, plus our own row if we're further down.
    let rows = r.rows.slice(0, 7); const mine = r.rows.findIndex(x => x.id === v.myId);
    if (mine >= 7) rows = [...rows.slice(0, 6), r.rows[mine]];
    const cols = [['#', 26], ['NAME', 170], ['SCORE', 70], ['CRACKS', 70], ['CRACKED', 76], ['STREAK', 70], ...(r.obj ? [[r.obj.toUpperCase(), 120]] : [])];
    const tw = cols.reduce((s, x) => s + x[1], 0) * u, rh = 21 * u, th = (rows.length + 1) * rh + 12 * u;
    const x0 = (w - tw) / 2, y0 = h - th - 44 * u;
    c.fillStyle = 'rgba(8,20,40,.72)'; c.beginPath(); c.roundRect(x0 - 12 * u, y0 - 6 * u, tw + 24 * u, th, 10 * u); c.fill();
    c.font = `800 ${Math.round(12 * u)}px n, sans-serif`; c.textBaseline = 'middle'; c.textAlign = 'left';
    let x = x0; for (const [name, cw] of cols) { c.fillStyle = 'rgba(255,255,255,.55)'; c.fillText(name, x, y0 + rh / 2); x += cw * u; }
    c.font = `800 ${Math.round(14 * u)}px n, sans-serif`;
    rows.forEach((row, i) => {
      const y = y0 + rh * (i + 1.5), rank = r.rows.indexOf(row) + 1;
      if (row.id === v.myId) { c.fillStyle = 'rgba(255,154,60,.22)'; c.fillRect(x0 - 8 * u, y - rh / 2, tw + 16 * u, rh); }
      const vals = [String(rank), row.name, String(row.score), String(row.kills), String(row.deaths), String(row.best), ...(r.obj ? [`${row.obj}s`] : [])];
      let xx = x0; vals.forEach((val, k) => { c.fillStyle = k === 1 ? (row.team ? TEAM[row.team] : '#fff') : '#fff'; c.fillText(val, xx, y); xx += cols[k][1] * u; });
    });
    const left = Math.max(0, Math.ceil(v.left));
    text(v.nextName ? `Next round: ${v.nextName} in ${left}` : `Next round in ${left}`, w / 2, h - 20 * u, 18, '#ffd23f', 'center', 'n');
    return true;
  }
  // The instant replay: cinema bars, a REPLAY tag, and SLOW-MO while the shot is in the air.
  drawReplay(c, w, h) {
    const bar = Math.round(h * 0.09);
    c.fillStyle = '#000'; c.fillRect(0, 0, w, bar); c.fillRect(0, h - bar, w, bar);
    c.save(); c.font = '400 20px s, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
    const blink = 0.6 + 0.4 * Math.sin(this.t * 6);
    c.fillStyle = `rgba(255,59,42,${blink})`; c.beginPath(); c.arc(28, bar / 2, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.fillText('REPLAY', 44, bar / 2 + 1);
    if (this.replay.slow) { c.textAlign = 'right'; c.fillStyle = '#ffd23f'; c.fillText('SLOW-MO', w - 24, bar / 2 + 1); }
    c.font = '800 13px n, sans-serif'; c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.6)'; c.fillText('Click or Space to skip', w / 2, h - bar / 2);
    // The killcam card: who did it, with what, from how far (until the shot lands).
    const card = this.replay.card;
    if (card && card.name) {
      const a = Math.min(1, (this.replay.age || 0) / 0.3), x = 24 - (1 - a) * 40, y = bar + 22;
      c.globalAlpha = a; c.textAlign = 'left';
      c.font = '800 12px n, sans-serif'; c.fillStyle = 'rgba(255,255,255,.75)'; c.fillText('KILLCAM', x, y);
      c.font = '400 30px s, sans-serif'; c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,.6)';
      c.strokeText(card.name, x, y + 28); c.fillStyle = TEAM[card.team] || '#ffd23f'; c.fillText(card.name, x, y + 28);
      c.font = '800 15px n, sans-serif'; c.lineWidth = 3; const sub = `${card.weapon}${card.dist > 1 ? ` · ${card.dist} m` : ''}`;
      c.strokeText(sub, x, y + 56); c.fillStyle = '#fff'; c.fillText(sub, x, y + 56);
      c.globalAlpha = 1;
    }
    // The hit-stop flash.
    if (this.replay.flash > 0) { c.fillStyle = `rgba(255,250,235,${this.replay.flash * 0.55})`; c.fillRect(0, bar, w, h - bar * 2); }
    c.restore();
  }
  drawDeath(c, w, h) {
    const d = this.death, f = Math.min(1, d.t / 0.25), out = d.t > 1.75 ? Math.max(0, 1 - (d.t - 1.75) / 0.25) : 1;
    const y = h * 0.3;
    c.save(); c.globalAlpha = f * out;
    const bw = Math.min(460, w - 40), bh = 92, x = (w - bw) / 2;
    const g = c.createLinearGradient(x, 0, x + bw, 0); g.addColorStop(0, 'rgba(11,69,96,0)'); g.addColorStop(0.15, 'rgba(11,69,96,.82)'); g.addColorStop(0.85, 'rgba(11,69,96,.82)'); g.addColorStop(1, 'rgba(11,69,96,0)');
    c.fillStyle = g; c.fillRect(x, y - bh / 2, bw, bh);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.font = '400 28px s, sans-serif'; c.lineWidth = 7; c.strokeStyle = '#0b4560';
    const title = d.killer ? 'YOU GOT CRACKED' : 'YOU CRACKED';
    c.strokeText(title, w / 2, y - 18); c.fillStyle = '#ff5545'; c.fillText(title, w / 2, y - 18);
    if (d.killer) {
      c.font = '900 17px n, sans-serif'; c.fillStyle = '#fff';
      const label = `by ${d.killer}` + (d.hp > 0 ? `  ·  ${Math.ceil(d.hp)} HP left` : '');
      const img = this.icon(d.weapon), iw = img ? 46 : 0, tw = c.measureText(label).width;
      c.fillText(label, w / 2 + iw / 2, y + 20);
      if (img) c.drawImage(img, w / 2 - tw / 2 - iw / 2 - 8, y + 9, iw, 23);
    }
    c.restore();
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

  // The HUD canvas for this frame. v: { me (null when not playing), yaw, pitch, speed, air, fov,
  // markers, aimDist, reload, project(x, y, z) → screen point, bars (hurt eggs in view), enemy (the
  // crosshair is on an enemy: 1, a teammate: 2) }. Returns whether the canvas changed.
  draw(dt, v) {
    const c = this.ctx, d = this.dpr || 1, W = this.canvas.width, H = this.canvas.height;
    const w = innerWidth, h = innerHeight, cx = w / 2, cy = h / 2;
    const me = v.me, hands = me?.hands, alive = !!me?.alive;
    this.t += dt;
    this.drawPanel(v);
    if (this.death) { this.death.t += dt; if (this.death.t > 2.1 || me?.alive) this.death = null; }
    // Skip the frame when nothing on it moves and nothing it shows has changed.
    const wpn = alive ? weaponOf(hands) : null, s = alive ? slotOf(hands) : null;
    const target = alive ? Math.max(4, Math.tan(currentSpread(hands, wpn) / 2) * (h / 2 / Math.tan(v.fov / 2 * Math.PI / 180))) : this.gap;
    const busy = alive && (hands.swap > 0 || hands.melee > 0), scoped = alive && hands.ads && wpn.scoped;
    const lowMag = alive && s.mag <= Math.max(1, Math.floor(wpn.mag * 0.25));
    const val = alive ? (me.shield > 0 && !(me.overheal > 0) ? me.shield : me.hp) : 0;
    const moving = this.replay || this.death || this.kills.length || this.popups.length || this.nums.length || this.dmgArcs.length || this.vignette > 0 || this.hitT > 0 ||
      (alive && (scoped || this.scopeA > 0 || (me.hp < 35 && !(me.shield > 0)) || (lowMag && !busy && !hands.charging) || hands.charging || v.reload > 0 || (v.markers && v.markers.length) || (v.bars && v.bars.length) ||
        this.gapKick > 0 || Math.abs(target - this.gap) > 0.05 || Math.abs(val - this.hpShown) > 0.05 || Math.abs(this.hpTrail - this.hpShown) > 0.05));
    const sig = alive ? `${w}x${h}|${val}|${s.id}|${s.mag}|${busy}|${v.enemy || 0}|${me.spawnShield > 0}|${me.power.shellBreaker > 0}|${this.settings.centerDot}` : `${w}x${h}|dead`;
    if (!moving && sig === this.sig) { this.dirty = false; return false; }
    this.sig = sig; this.dirty = true;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    c.setTransform(d, 0, 0, d, 0, 0);
    if (this.replay) this.drawReplay(c, w, h);
    if (this.death) this.drawDeath(c, w, h);
    if (!alive) { this.kills.length = 0; this.nums.length = 0; return true; }
    if (v.project) { if (v.bars?.length) this.drawBars(c, dt, v.bars, v.project); else this.barShown.clear(); this.drawNumbers(c, dt, v.project); }
    // Damage vignette and arcs.
    if (this.vignette > 0) {
      this.vignette = Math.max(0, this.vignette - dt * 1.2);
      const g = c.createRadialGradient(cx, cy, Math.min(w, h) * 0.35, cx, cy, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(200,0,0,0)'); g.addColorStop(1, `rgba(200,0,0,${this.vignette * 0.55})`);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
    for (const a of this.dmgArcs) {
      a.t -= dt; if (a.t <= 0) continue;
      // A tapered red wedge on a ring around the crosshair, pointing at whoever shot us.
      const ang = -Math.PI / 2 - (a.a - v.yaw), r = Math.min(w, h) * 0.2;
      c.save(); c.translate(cx, cy); c.rotate(ang);
      const g = c.createLinearGradient(r - 14, 0, r + 10, 0); g.addColorStop(0, `rgba(255,60,40,0)`); g.addColorStop(1, `rgba(255,40,30,${Math.min(1, a.t) * 0.9})`);
      c.fillStyle = g; c.beginPath(); c.moveTo(r + 12, 0); c.arc(0, 0, r, -0.32, 0.32); c.closePath(); c.fill();
      c.restore();
    }
    this.dmgArcs = this.dmgArcs.filter(a => a.t > 0);
    // Scope overlay (Cage Free, Poacher, Yolkzooka when aiming): fades in as the gun comes up, sways
    // against mouse movement and bobs while walking, a darkened lens rim, and a reticle per gun.
    this.scopeA = scoped ? Math.min(1, (this.scopeA || 0) + dt * 9) : 0;
    if (this.scopeA > 0) this.drawScope(c, w, h, dt, v, s.id);
    else { this.sway = null; }
    // Crosshair: four lines whose gap follows the real spread; hidden while swapping or meleeing. Over
    // an enemy it turns red (a teammate: blue), so you know a shot will land before you take it.
    this.gapKick = Math.max(0, (this.gapKick || 0) - dt * 40);
    this.gap += (target - this.gap) * Math.min(1, dt * 22);
    if (Math.abs(target - this.gap) <= 0.05) this.gap = target;
    if (!busy && !scoped) {
      const gap = this.gap + this.gapKick;
      c.strokeStyle = v.enemy === 1 ? 'rgba(255,74,61,.98)' : v.enemy === 2 ? 'rgba(120,200,255,.95)' : 'rgba(255,255,255,.95)'; c.lineWidth = 2; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 2;
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
      if (this.settings.centerDot) { c.fillStyle = v.enemy === 1 ? '#ff4a3d' : '#fff'; c.fillRect(cx - 1.5, cy - 1.5, 3, 3); }
      c.shadowBlur = 0;
    }
    // Hit marker.
    if (this.hitT > 0 && this.settings.hitMarkers) {
      this.hitT -= dt;
      // Pops out a little then settles; a kill is red, bigger, and lingers.
      const f = 1 - this.hitT / this.hitMax, pop = 1 + Math.sin(Math.min(1, f * 3) * Math.PI) * 0.4, k = this.hitKill ? 1.45 : 1;
      c.globalAlpha = Math.min(1, this.hitT / this.hitMax * 2.5);
      c.lineCap = 'round';
      const a = 7 * pop * k, b = 17 * pop * k;
      if (this.hitKill) { c.strokeStyle = `rgba(255,59,42,${(1 - f) * 0.8})`; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 12 + f * 34, 0, Math.PI * 2); c.stroke(); }
      c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = this.hitKill ? 5.5 : 4.5; c.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { c.moveTo(cx + sx * a, cy + sy * a); c.lineTo(cx + sx * b, cy + sy * b); }
      c.stroke();
      c.strokeStyle = this.hitKill ? '#ff3b2a' : '#ffffff'; c.lineWidth = this.hitKill ? 3 : 2.5; c.stroke();
      c.globalAlpha = 1;
    }
    // Reloading: a thin ring around the crosshair fills with the reload.
    if (v.reload && !scoped) {
      const R = 22;
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#ffd23f'; c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v.reload); c.stroke();
    } else if (!busy && !hands.charging) {
      // Running low: a nudge to reload (or to find ammo).
      if (lowMag) {
        const out = s.mag === 0 && s.store === 0, label = out ? 'NO AMMO' : 'RELOAD';
        c.globalAlpha = 0.65 + 0.35 * Math.sin(this.t * 7);
        c.font = '900 15px n, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeText(label, cx, cy + 46);
        c.fillStyle = out || s.mag === 0 ? '#ff5545' : '#ffd23f'; c.fillText(label, cx, cy + 46);
        c.globalAlpha = 1;
      }
    }
    this.drawKills(c, cx, cy + 118 * (this.u || 1), dt);
    // Grenade charge meter beside the crosshair.
    if (hands.charging) {
      const p = Math.max(0, hands.power), x = cx + 42, y = cy - 30;
      c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(x, y, 10, 60);
      c.fillStyle = p > 0.95 ? '#ff5545' : '#ffd23f'; c.fillRect(x, y + 60 * (1 - p), 10, 60 * p);
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(x, y, 10, 60);
    }
    // Health meter: white disc, teal outline, draining orange ring (blue shield / cracked timer). Damage
    // leaves a pale chunk that catches up a moment later; low health beats red.
    const hx = cx, hy = h - 56, R = 34;
    const shield = me.shield > 0 && !(me.overheal > 0);
    const frac = shield ? me.shield / STREAKS.hardBoiledHp : Math.min(1, me.hp / 100);
    if (val < this.hpShown) this.hpShown = val; else this.hpShown += (val - this.hpShown) * Math.min(1, dt * 6);
    if (this.hpTrail < this.hpShown) this.hpTrail = this.hpShown; else this.hpTrail = Math.max(this.hpShown, this.hpTrail - dt * 60);
    const low = !shield && me.hp < 35, beat = low ? Math.pow(Math.max(0, Math.sin(this.t * 6.5)), 6) : 0;
    const scale = 1 + beat * 0.06;
    c.save(); c.translate(hx, hy); c.scale(scale, scale);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.arc(0, 3, R + 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = low ? `rgb(255,${235 - beat * 80 | 0},${235 - beat * 80 | 0})` : '#fff'; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.lineWidth = 6; c.strokeStyle = low ? '#7a1d16' : '#174e5e'; c.beginPath(); c.arc(0, 0, R + 3, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 9; c.strokeStyle = 'rgba(23,78,94,.12)'; c.beginPath(); c.arc(0, 0, R - 9, 0, Math.PI * 2); c.stroke();
    const max = shield ? STREAKS.hardBoiledHp : 100, trail = Math.min(1, this.hpTrail / max);
    if (trail > frac + 0.005) { c.strokeStyle = 'rgba(255,240,200,.95)'; c.beginPath(); c.arc(0, 0, R - 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * trail); c.stroke(); }
    c.strokeStyle = shield ? '#7fd3ff' : me.hp > 100 ? '#ff4fb0' : low ? '#ff3b2f' : '#f39a25';
    c.beginPath(); c.arc(0, 0, R - 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.hpShown / max)); c.stroke();
    if (me.power.shellBreaker > 0) { c.lineWidth = 4; c.strokeStyle = '#ff3b2f'; c.beginPath(); c.arc(0, 0, R - 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * me.power.shellBreaker / STREAKS.shellBreaker.cap); c.stroke(); }
    c.fillStyle = low ? '#9b1d16' : '#174e5e'; c.font = '900 20px n, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(Math.ceil(val)), 0, 1);
    c.restore();
    // Yolk rewards float up beside the meter.
    for (const p of this.popups) {
      p.t += dt; const a = Math.max(0, 1 - p.t / 1.4);
      c.globalAlpha = a; c.font = '900 22px n, sans-serif'; c.lineWidth = 5; c.strokeStyle = 'rgba(11,69,96,.85)';
      c.strokeText(p.text, hx + 70, hy - 10 - p.t * 30); c.fillStyle = '#ffd23f'; c.fillText(p.text, hx + 70, hy - 10 - p.t * 30);
    }
    c.globalAlpha = 1; this.popups = this.popups.filter(p => p.t < 1.4);
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
    return true;
  }
}
