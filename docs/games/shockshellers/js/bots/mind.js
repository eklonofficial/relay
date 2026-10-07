// A bot's long-term memory of the match, the part that makes it feel like a person who has been
// playing the same lobby for a while rather than a fresh opponent every life. Sightings are forgotten
// on death (bot.js keeps those); this is not:
// - each opponent: how often they've cracked us and we them (grudges, a nemesis), with what weapons,
//   and from where (a sniper's favourite perch);
// - where we keep dying (a heat map that fades over a minute or two), which routes then avoid;
// - how the night is going: a run of deaths (tilt) or kills (confidence), which changes how boldly
//   the bot plays, and makes it rethink its loadout.
const CELL = 4, FADE = 30 * 100; // heat cells of 4×4 units, fading over ~100 s

export class Mind {
  constructor() {
    this.foes = new Map(); this.heat = new Map();
    this.deaths = 0; this.kills = 0; this.deathRun = 0; this.killRun = 0; this.recent = []; // last deaths: { by, w, tick }
  }
  foe(id) {
    let f = this.foes.get(id);
    if (!f) this.foes.set(id, f = { killedMe: 0, iKilled: 0, weapons: {}, perch: null, lastKilledMe: -1e9, lastIKilled: -1e9 });
    return f;
  }
  // We were cracked at `at` by `by` (with `w`, from `from` when known).
  died(tick, by, w, at, from) {
    this.deaths++; this.deathRun++; this.killRun = 0;
    this.addHeat(at.x, at.z, 1, tick);
    this.recent.push({ by, w, tick }); if (this.recent.length > 6) this.recent.shift();
    if (by === null || by === undefined || by < 0) return;
    const f = this.foe(by); f.killedMe++; f.lastKilledMe = tick; f.weapons[w] = (f.weapons[w] || 0) + 1;
    // A long shot: remember where they shot from (their perch), and that the way there was deadly.
    if (from && Math.hypot(from.x - at.x, from.z - at.z) > 12) { f.perch = { x: from.x, y: from.y, z: from.z, tick }; this.addHeat((from.x + at.x) / 2, (from.z + at.z) / 2, 0.4, tick); }
  }
  cracked(tick, victim) {
    this.kills++; this.killRun++; this.deathRun = 0;
    const f = this.foe(victim); f.iKilled++; f.lastIKilled = tick;
  }
  addHeat(x, z, v, tick) {
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`, c = this.heat.get(k);
    const now = c ? c.v * Math.exp(-(tick - c.t) / FADE) : 0;
    this.heat.set(k, { v: Math.min(4, now + v), t: tick });
  }
  // How deadly this spot has been for us lately (0 = never died near here).
  heatAt(x, z, tick) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let h = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = this.heat.get(`${cx + i},${cz + j}`); if (!c) continue;
      h += c.v * Math.exp(-(tick - c.t) / FADE) * (i || j ? 0.35 : 1);
    }
    return h;
  }
  // How much we want this one back: their kills on us beyond ours on them, and how recent.
  grudge(id, tick) {
    const f = this.foes.get(id); if (!f) return 0;
    const owe = f.killedMe - f.iKilled;
    return owe > 0 ? Math.min(3, owe) * (tick - f.lastKilledMe < 30 * 60 ? 1.3 : 1) : 0;
  }
  // The one who keeps getting us (at least two more kills on us than we have on them).
  nemesis() {
    let best = null, bs = 1;
    for (const [id, f] of this.foes) { const s = f.killedMe - f.iKilled; if (s > bs) { bs = s; best = id; } }
    return best;
  }
  // What has been killing us lately: 'sniper', 'close', 'rocket', 'rifle' or null.
  threat() {
    const n = { sniper: 0, close: 0, rocket: 0, rifle: 0 };
    for (const d of this.recent.slice(-4)) n[KIND[d.w] || 'rifle']++;
    let best = null, bs = 1;
    for (const k in n) if (n[k] > bs) { bs = n[k]; best = k; }
    return best;
  }
  // Recently a sniper's perch we know of (and still care about).
  perches(tick) { const out = []; for (const f of this.foes.values()) if (f.perch && tick - f.perch.tick < 30 * 120) out.push(f.perch); return out; }
  // Into the next round (a new map): who's who stays, where things happened doesn't.
  carry() {
    const m = new Mind();
    for (const [id, f] of this.foes) m.foes.set(id, { ...f, weapons: { ...f.weapons }, perch: null, lastKilledMe: -1e9, lastIKilled: -1e9 });
    m.deaths = this.deaths; m.kills = this.kills;
    return m;
  }
  get tilted() { return this.deathRun >= 3; }
  get confident() { return this.killRun >= 3; }
}
export const KIND = { poacher: 'sniper', cageFree: 'sniper', doubleYolker: 'close', beater: 'close', melee: 'close', yolkzooka: 'rocket', grenade: 'rocket', yolk47: 'rifle', triBoil: 'rifle', peck9mm: 'rifle' };
// A loadout that answers what keeps killing us (bold players rush a sniper, careful ones out-snipe it).
export function counterPick(threat, bold, bigMap, rnd) {
  switch (threat) {
    case 'sniper': return bold ? (rnd() < 0.5 ? 'doubleYolker' : 'beater') : (bigMap ? 'poacher' : 'cageFree');
    case 'close': return bigMap ? (rnd() < 0.5 ? 'triBoil' : 'cageFree') : (rnd() < 0.5 ? 'yolk47' : 'doubleYolker');
    case 'rocket': return rnd() < 0.5 ? 'yolk47' : 'triBoil';
    case 'rifle': return bold ? 'doubleYolker' : bigMap ? 'cageFree' : 'beater';
    default: return null;
  }
}
