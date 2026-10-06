// A match as this browser sees it. The host's session owns the real Match (and its bots); a guest's
// session mirrors the host's snapshots and predicts only its own egg (net/guest.js). Either way the
// view reads players, objects and events from here.
import { Match } from '../sim/match.js?v=muw89qdu';
import { NavGraph } from '../bots/nav.js?v=muw89qdu';
import { BotManager, BOT_NAMES } from '../bots/bot.js?v=muw89qdu';
import { getMap } from '../maps/index.js?v=muw89qdu';
import { TICK, PRIMARIES } from '../sim/tuning.js?v=muw89qdu';
import { Net, cleanName } from '../net/net.js?v=muw89qdu';
import { encodePlayer, ownState, rosterEntry, sendable, trimEvent } from '../net/protocol.js?v=muw89qdu';

const navCache = new Map();
export function navFor(mapId, map) { if (!navCache.has(mapId)) navCache.set(mapId, new NavGraph(map.grid, map.meta.gravity || 1)); return navCache.get(mapId); }

export class HostSession {
  // cfg: { map, mode, options, bots (target total players), difficulty, name, primary, cosmetics, private }
  constructor(cfg) {
    this.cfg = cfg; this.host = true;
    this.mapId = cfg.map; this.map = getMap(cfg.map);
    const seed = (Math.random() * 1e9) | 0;
    this.match = new Match(this.map, { mode: cfg.mode, options: { ...cfg.options, private: !!cfg.private }, seed });
    this.nav = navFor(cfg.map, this.map);
    this.bots = new BotManager(this.match, this.nav, seed ^ 0x5bd1e995);
    this.myId = 1; this.nextId = 2;
    this.me = this.match.addPlayer({ id: 1, name: cfg.name, primary: cfg.primary, cosmetics: cfg.cosmetics });
    this.usedNames = new Set([cfg.name.toLowerCase()]);
    this.bots.onChat = (id, msg) => { const p = this.match.players.get(id); if (!p) return; this.onChat?.(`${p.name}: ${msg}`, '#fff'); this.net?.broadcast({ t: 'chat', id, msg }); };
    this.fillBots();
    this.acc = 0; this.prev = new Map();
    this.guests = new Map(); // player id → { queue: [[frame, ctrl, yaw, pitch]], frame, rtt }
    this.outbox = []; this.snapT = 0;
  }
  // ---- actions (the same API a guest session offers) ----
  respawn() { return this.match.requestRespawn(this.myId); }
  pauseMe() { this.match.pause(this.myId); }
  setPrimary(w) { this.match.setPrimary(this.myId, w); }
  switchTeam() { return this.match.mode.switchTeam(this.me); }
  canRespawn() { return this.match.canRespawn(this.me); }
  sendChat(msg, team) { this.net?.broadcast({ t: 'chat', id: this.myId, msg, team }); }
  kick(id) { if (this.guests.has(id)) this.net.kick(id); else if (this.match.players.get(id)?.bot) { this.removeBot(id); this.fillBots(); } }

  // ---- hosting ----
  async openRoom() {
    this.net = new Net(this, 'host');
    this.code = await this.net.host();
    return this.code;
  }
  // A guest says hello: they take a bot's place (Net has checked the protocol and the name).
  admit({ name, primary, cosmetics }) {
    if (this.match.options.locked) return { reason: 'This game is locked.' };
    let n = cleanName(name) || 'Egg', k = 2;
    while (this.usedNames.has(n.toLowerCase())) n = cleanName(name).slice(0, 14) + k++;
    const p = this.admitHuman({ name: n, primary: PRIMARIES.includes(primary) ? primary : 'yolk47', cosmetics: sanitizeCosmetics(cosmetics) });
    if (!p) return { reason: 'This game is full.' };
    this.guests.set(p.id, { queue: [], frame: -1, rtt: 100 });
    this.onChat?.(`${p.name} joined the game`, '#ffd23f');
    return { id: p.id, name: n, welcome: { map: this.mapId, mode: this.match.modeId, options: this.match.options, code: this.code, tick: this.match.tick, roster: [...this.match.players.values()].map(rosterEntry), host: this.myId } };
  }
  onGuestMessage(m, id) {
    const g = this.guests.get(id), p = this.match.players.get(id); if (!g || !p) return;
    switch (m.t) {
      case 'in': {
        if (!Array.isArray(m.c) || !Number.isSafeInteger(m.f)) return;
        m.c.slice(0, 6).forEach((c, i) => {
          const f = m.f + i;
          if (f <= g.frame || !Array.isArray(c)) return;
          g.queue.push([f, c[0] | 0, +c[1] || 0, +c[2] || 0]);
        });
        if (Number.isFinite(m.l)) g.rtt = Math.max(0, Math.min(1000, m.l));
        // Rewind window for this shooter: what they saw was ~100 ms of interpolation plus half the round trip.
        p.lag = Math.min(6, Math.round((100 + g.rtt / 2) / 1000 / TICK));
        break;
      }
      case 'resp': this.match.requestRespawn(id); break;
      case 'prim': if (PRIMARIES.includes(m.w)) this.match.setPrimary(id, m.w); break;
      case 'pause': this.match.pause(id); break;
      case 'team': { const err = this.match.mode.switchTeam(p); if (err) this.net.sendTo(id, { t: 'note', msg: err }); break; }
      case 'chat': this.onChat?.(`${p.name}: ${m.msg}`, m.team ? '#7fd3ff' : '#fff', p.team, m.team); break;
    }
  }
  onGuestLeft(id, why) {
    const p = this.match.players.get(id);
    if (p) this.onChat?.(`${p.name} ${why}`, '#ffd23f');
    this.guests.delete(id); this.removeHuman(id);
  }
  // One queued input per tick for each guest; a backlog (clock drift, a burst after a stall) is trimmed.
  feedGuests() {
    for (const [id, g] of this.guests) {
      while (g.queue.length > 4) g.queue.shift();
      const next = g.queue.shift();
      if (next) { g.frame = next[0]; this.match.setInput(id, next[1], next[2], next[3]); }
    }
  }
  snapshot() {
    if (!this.net || !this.guests.size) { this.outbox.length = 0; return; }
    const m = this.match, players = [...m.players.values()].map(encodePlayer);
    const ev = this.outbox.filter(sendable).map(e => e.t === 'join' ? { ...e, r: rosterEntry(m.players.get(e.id) || { id: e.id, name: '?' }) } : trimEvent(e));
    this.outbox.length = 0;
    const base = { t: 'st', k: m.tick, p: players, i: m.items.map(it => it.active ? 1 : 0).join(''), m: m.mode.state(), r: m.rockets.map(r => [r.id, +r.x.toFixed(3), +r.y.toFixed(3), +r.z.toFixed(3), +r.dx.toFixed(3), +r.dy.toFixed(3), +r.dz.toFixed(3)]), g: m.grenades.map(g => [g.id, +g.x.toFixed(3), +g.y.toFixed(3), +g.z.toFixed(3), g.fuse, g.team]), e: ev };
    for (const [id, g] of this.guests) {
      const p = m.players.get(id); if (!p) continue;
      this.net.sendTo(id, { ...base, a: g.frame, me: ownState(p) });
    }
  }
  close() { this.net?.close(); this.net = null; }
  get capacity() { return this.cfg.slots || this.map.meta.maxPlayers; }
  botCount() { let n = 0; for (const p of this.match.players.values()) if (p.bot) n++; return n; }
  // Keep the room at its target size with bots (GDD: bots fill empty lobbies).
  fillBots() {
    const target = Math.min(this.capacity, this.cfg.bots ?? this.capacity);
    while (this.match.players.size < target) this.addBot();
  }
  addBot(team = 0) {
    const names = BOT_NAMES.filter(n => !this.usedNames.has(n.toLowerCase()));
    const name = names[Math.floor(Math.random() * names.length)] || 'Bot' + this.nextId;
    this.usedNames.add(name.toLowerCase());
    const p = this.match.addPlayer({ id: this.nextId++, name, bot: true, team, cosmetics: { color: Math.floor(Math.random() * 7), hat: ['none', 'none', 'cap', 'beanie', 'chef', 'tophat'][Math.floor(Math.random() * 6)] } });
    this.bots.add(p, this.cfg.difficulty || 'normal');
    return p;
  }
  // A friend joins: they take a bot's place (smaller team first, the bot with the lowest score).
  admitHuman({ name, primary, cosmetics }) {
    const m = this.match;
    let victim = null;
    const counts = [0, 0, 0]; for (const p of m.players.values()) counts[p.team]++;
    const team = m.mode.teams ? (counts[1] <= counts[2] ? 1 : 2) : 0;
    for (const p of m.players.values()) {
      if (!p.bot) continue;
      if (team && p.team !== team) continue;
      if (!victim || p.score < victim.score) victim = p;
    }
    if (!victim) for (const p of m.players.values()) if (p.bot && (!victim || p.score < victim.score)) victim = p;
    if (victim) this.removeBot(victim.id);
    else if (m.players.size >= this.capacity) return null;
    const id = this.nextId++;
    this.usedNames.add(name.toLowerCase());
    return m.addPlayer({ id, name, primary, cosmetics, team: victim?.team || team });
  }
  removeBot(id) { const p = this.match.players.get(id); if (p) this.usedNames.delete(p.name.toLowerCase()); this.bots.remove(id); this.match.removePlayer(id); }
  removeHuman(id) { const p = this.match.players.get(id); if (!p) return; this.usedNames.delete(p.name.toLowerCase()); this.match.removePlayer(id); this.fillBots(); }
  // Advance by real time; returns the number of ticks run. Events accumulate in match.events.
  advance(dt, localInput) {
    this.acc = Math.min(this.acc + dt, 0.25);
    let n = 0;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.snapshotPrev();
      if (localInput) this.match.setInput(this.myId, localInput.ctrl, localInput.yaw, localInput.pitch);
      this.feedGuests();
      this.bots.tick();
      this.match.step();
      // Everything since the last tick, including joins/leaves that happened between ticks.
      const fresh = this.match.events.slice(this.evSeen || 0); this.evSeen = this.match.events.length;
      this.bots.events(fresh);
      if (this.net) this.outbox.push(...fresh);
      if (++this.snapT >= 2) { this.snapT = 0; this.snapshot(); }
      n++;
    }
    return n;
  }
  takeEvents() { const e = this.match.events; this.match.events = []; this.evSeen = 0; return e; }
  snapshotPrev() { for (const p of this.match.players.values()) { let s = this.prev.get(p.id); if (!s) this.prev.set(p.id, s = [0, 0, 0]); s[0] = p.body.x; s[1] = p.body.y; s[2] = p.body.z; } }
  // Interpolated position between the last two ticks.
  lerpPos(p, out) {
    const a = this.acc / TICK, s = this.prev.get(p.id);
    if (!s) { out[0] = p.body.x; out[1] = p.body.y; out[2] = p.body.z; return out; }
    out[0] = s[0] + (p.body.x - s[0]) * a; out[1] = s[1] + (p.body.y - s[1]) * a; out[2] = s[2] + (p.body.z - s[2]) * a;
    return out;
  }
}

// Only known cosmetic values from a guest (they are drawn, never interpreted).
export function sanitizeCosmetics(c) {
  const color = Number.isInteger(c?.color) && c.color >= 0 && c.color < 14 ? c.color : 0;
  const hat = ['none', 'cap', 'beanie', 'chef', 'tophat', 'crown'].includes(c?.hat) ? c.hat : 'none';
  return { color, hat };
}
