// A match as this browser sees it. The host's session owns the real Match (and its bots); a guest's
// session mirrors the host's snapshots and predicts only its own egg (net/client.js). Either way the
// view reads players, objects and events from here.
import { Match } from '../sim/match.js?v=muunn3ao';
import { NavGraph } from '../bots/nav.js?v=muunn3ao';
import { BotManager, BOT_NAMES } from '../bots/bot.js?v=muunn3ao';
import { getMap } from '../maps/index.js?v=muunn3ao';
import { TICK } from '../sim/tuning.js?v=muunn3ao';

const navCache = new Map();
export function navFor(mapId, map) { if (!navCache.has(mapId)) navCache.set(mapId, new NavGraph(map.grid)); return navCache.get(mapId); }

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
    this.fillBots();
    this.acc = 0; this.prev = new Map();
  }
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
      this.bots.tick();
      this.match.step();
      this.bots.events(this.match.events.slice(this.evMark || 0));
      this.evMark = this.match.events.length;
      n++;
    }
    return n;
  }
  takeEvents() { const e = this.match.events; this.match.events = []; this.evMark = 0; return e; }
  snapshotPrev() { for (const p of this.match.players.values()) { let s = this.prev.get(p.id); if (!s) this.prev.set(p.id, s = [0, 0, 0]); s[0] = p.body.x; s[1] = p.body.y; s[2] = p.body.z; } }
  // Interpolated position between the last two ticks.
  lerpPos(p, out) {
    const a = this.acc / TICK, s = this.prev.get(p.id);
    if (!s) { out[0] = p.body.x; out[1] = p.body.y; out[2] = p.body.z; return out; }
    out[0] = s[0] + (p.body.x - s[0]) * a; out[1] = s[1] + (p.body.y - s[1]) * a; out[2] = s[2] + (p.body.z - s[2]) * a;
    return out;
  }
}
