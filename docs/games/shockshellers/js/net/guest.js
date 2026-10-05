// A guest's view of a match hosted in a friend's browser. The host runs the real game; this keeps a
// mirror Match that the renderer and HUD read like the host's own. Only our egg is simulated here:
// each tick our input is predicted with exactly the host's code (Match.stepPlayer), and when a
// snapshot says which input the host last used, we rewind to the host's state and replay the newer
// inputs (reconciliation), easing any correction over a couple of ticks. Everyone else is drawn
// 100 ms in the past, interpolated between snapshots (Blockhaven's remote players do the same).
import { Match } from '../sim/match.js?v=muv84lw6';
import { getMap } from '../maps/index.js?v=muv84lw6';
import { TICK, SYNC_EVERY } from '../sim/tuning.js?v=muv84lw6';
import { Net } from './net.js?v=muv84lw6';
import { applyPlayer, applyOwn } from './protocol.js?v=muv84lw6';

const DELAY = 100; // ms behind the newest snapshot for other players
const OWN = new Set(['shot', 'fire', 'reload', 'reloaded', 'dry', 'swap', 'swing', 'charge', 'jump', 'land']);

export class GuestSession {
  static async join(code, hello, status) {
    const s = new GuestSession();
    const { net, welcome } = await Net.join(s, code, hello, status);
    s.start(net, welcome);
    return s;
  }
  constructor() { this.host = false; this.events = []; this.ping = 0; this.snaps = []; this.inputs = new Map(); this.frame = 0; this.acc = 0; this.offset = [0, 0, 0]; this.prevMe = [0, 0, 0]; }
  start(net, w) {
    this.net = net; this.code = w.code || net.code; this.myId = w.id;
    this.mapId = w.map; this.map = getMap(w.map);
    this.cfg = { private: true, mode: w.mode, map: w.map };
    this.match = new Match(this.map, { mode: w.mode, options: w.options });
    this.modeState = this.match.mode.state();
    this.match.mode.state = () => this.modeState; // the host decides the objective
    for (const r of w.roster) this.addRoster(r);
    this.me = this.match.players.get(this.myId);
    this.match.tick = w.tick;
  }
  addRoster(r) {
    if (this.match.players.has(r.id)) return this.match.players.get(r.id);
    const p = this.match.addPlayer({ id: r.id, name: r.name, bot: r.bot, team: r.team, primary: r.primary || 'yolk47', cosmetics: r.cosmetics });
    p.team = r.team;
    this.match.events.length = 0;
    return p;
  }
  // ---- actions ----
  respawn() { this.net.send({ t: 'resp' }); return true; }
  pauseMe() { this.net.send({ t: 'pause' }); }
  setPrimary(w) { this.me.nextPrimary = w; this.net.send({ t: 'prim', w }); }
  switchTeam() { this.net.send({ t: 'team' }); return null; }
  canRespawn() { const m = this.match, p = this.me; return !p.alive && m.tick >= p.respawnAt && m.tick >= p.pauseCooldownUntil; }
  sendChat(msg, team) { this.net.send({ t: 'chat', msg, team }); }
  kick() { this.onChat?.('Only the host can do that.', '#ffd23f'); }
  close() { this.net?.close(); }
  onPong(ts) { const r = performance.now() - ts; this.ping = Math.round(this.ping ? this.ping * 0.7 + r * 0.3 : r); }

  // ---- ticks ----
  advance(dt, input) {
    this.acc = Math.min(this.acc + dt, 0.25);
    let n = 0;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.frame++;
      const me = this.me;
      this.prevMe[0] = me.body.x; this.prevMe[1] = me.body.y; this.prevMe[2] = me.body.z;
      const inp = [input.ctrl | 0, input.yaw, input.pitch];
      this.inputs.set(this.frame, inp);
      this.inputs.delete(this.frame - 120);
      me.input.ctrl = inp[0]; me.input.yaw = inp[1]; me.input.pitch = inp[2];
      if (me.alive) this.match.stepPlayer(me, true);
      this.match.tick++;
      if (this.frame % SYNC_EVERY === 0) {
        const c = []; for (let f = this.frame - SYNC_EVERY + 1; f <= this.frame; f++) c.push(this.inputs.get(f) || inp);
        this.net.send({ t: 'in', f: this.frame - SYNC_EVERY + 1, c: c.map(x => [x[0], Math.round(x[1] * 1000) / 1000, Math.round(x[2] * 1000) / 1000]), l: this.ping });
      }
      for (let i = 0; i < 3; i++) this.offset[i] *= 0.6; // ease corrections away
      n++;
    }
    return n;
  }
  takeEvents() { const e = this.match.events.concat(this.events); this.match.events = []; this.events = []; return e; }

  onHostMessage(m) {
    switch (m.t) {
      case 'st': this.snapshot(m); break;
      case 'chat': { const p = this.match.players.get(m.id); if (p && m.msg) this.onChat?.(`${p.name}: ${String(m.msg).slice(0, 200)}`, m.team ? '#7fd3ff' : '#fff'); break; }
      case 'leave': break; // the roster change arrives as an event in the next snapshot
      case 'note': this.onChat?.(String(m.msg || '').slice(0, 200), '#ffd23f'); break;
      case 'boot': this.net.closed = true; this.onDisconnected?.(String(m.reason || 'You were removed from the game.').slice(0, 200)); break;
    }
  }
  snapshot(s) {
    const m = this.match, now = performance.now();
    // Roster changes first, so events can name everyone.
    for (const e of s.e || []) {
      if (e.t === 'join' && e.r) this.addRoster(e.r);
      if (e.t === 'leave' && e.id !== this.myId) m.players.delete(e.id);
    }
    const frame = new Map();
    for (const r of s.p) {
      const p = m.players.get(r[0]); if (!p || r[0] === this.myId) continue;
      applyPlayer(p, r);
      p.body.x = r[1]; p.body.y = r[2]; p.body.z = r[3]; p.body.yaw = r[4]; p.body.pitch = r[5];
      frame.set(r[0], [r[1], r[2], r[3], r[4], r[5]]);
    }
    this.snaps.push({ t: now, pos: frame });
    while (this.snaps.length > 30) this.snaps.shift();
    m.tick = s.k;
    // Items, objective, rockets and grenades as the host has them.
    [...(s.i || '')].forEach((c, i) => { if (m.items[i]) m.items[i].active = c === '1'; });
    this.modeState = s.m;
    if (s.m.k === 'spatula' && m.mode.spat) { const sp = m.mode.spat; [sp.x, sp.y, sp.z] = s.m.p; sp.carrier = s.m.c; sp.held = s.m.h; }
    if (s.m.k === 'roost') { m.mode.zone = s.m.z; m.mode.owner = s.m.o; m.mode.progress = s.m.p; }
    m.rockets = (s.r || []).map(r => ({ id: r[0], x: r[1], y: r[2], z: r[3], dx: r[4], dy: r[5], dz: r[6] }));
    m.grenades = (s.g || []).map(g => ({ id: g[0], x: g[1], y: g[2], z: g[3], fuse: g[4], team: g[5] }));
    // Our own egg: rewind to the host's state after input frame s.a, replay what came after.
    if (s.me) {
      const me = this.me, before = [me.body.x, me.body.y, me.body.z];
      applyOwn(me, s.me);
      if (s.a >= 0 && me.alive) {
        const keep = m.events; m.events = [];
        for (let f = s.a + 1; f <= this.frame; f++) {
          const inp = this.inputs.get(f); if (!inp) continue;
          me.input.ctrl = inp[0]; me.input.yaw = inp[1]; me.input.pitch = inp[2];
          m.stepPlayer(me, true);
        }
        m.events = keep;
      }
      const dx = before[0] - me.body.x, dy = before[1] - me.body.y, dz = before[2] - me.body.z;
      // Small differences are eased away; a respawn or a big correction snaps.
      if (dx * dx + dy * dy + dz * dz < 4) { this.offset[0] += dx; this.offset[1] += dy; this.offset[2] += dz; }
      else this.offset.fill(0);
    }
    for (const e of s.e || []) {
      if (e.id === this.myId && OWN.has(e.t)) continue; // already shown by our prediction
      this.events.push(e);
    }
  }
  // Render positions: ours predicted (plus the easing offset), others 100 ms in the past.
  lerpPos(p, out) {
    if (p.id === this.myId) {
      const a = this.acc / TICK;
      out[0] = this.prevMe[0] + (p.body.x - this.prevMe[0]) * a + this.offset[0];
      out[1] = this.prevMe[1] + (p.body.y - this.prevMe[1]) * a + this.offset[1];
      out[2] = this.prevMe[2] + (p.body.z - this.prevMe[2]) * a + this.offset[2];
      return out;
    }
    const t = performance.now() - DELAY, S = this.snaps;
    let i = S.length - 1;
    while (i > 0 && S[i - 1].t > t) i--;
    const b = S[i], a0 = S[i - 1];
    const pb = b?.pos.get(p.id), pa = a0?.pos.get(p.id);
    if (!pb) { out[0] = p.body.x; out[1] = p.body.y; out[2] = p.body.z; return out; }
    if (!pa || t >= b.t) { out[0] = pb[0]; out[1] = pb[1]; out[2] = pb[2]; return out; }
    const k = Math.max(0, Math.min(1, (t - a0.t) / (b.t - a0.t || 1)));
    // A jump of several units between snapshots is a respawn: don't slide across the map.
    if (Math.abs(pb[0] - pa[0]) + Math.abs(pb[2] - pa[2]) > 3) { out[0] = pb[0]; out[1] = pb[1]; out[2] = pb[2]; return out; }
    out[0] = pa[0] + (pb[0] - pa[0]) * k; out[1] = pa[1] + (pb[1] - pa[1]) * k; out[2] = pa[2] + (pb[2] - pa[2]) * k;
    return out;
  }
}
