// Bots that play like a person at a keyboard: they only know what they could see or hear, react
// after a human delay, turn with a limited, damped mouse hand, lead moving targets by the weapon's
// bullet speed (bullets are projectiles), tap-fire to let bloom recover, stop to snipe, strafe and
// jump in fights, fall back to cover to reload or heal, check corners where enemies were last seen,
// throw grenades solved with the real grenade physics, collect ammo, and play the objective.
//
// Bots drive the match through the same input struct as humans (control bits + yaw/pitch), so the
// simulation holds them to identical movement, fire-rate, spread and damage rules. Difficulty only
// changes human limits (reaction, aim error, turn speed, leading, decision noise), never knowledge.
import { CTRL, WEAPONS, PLAYER, GRENADE, PRIMARIES, TICK } from '../sim/tuning.js?v=muwqd5r4';
import { currentSpread, weaponOf, slotOf } from '../sim/combat.js?v=muwqd5r4';
import { forward } from '../sim/movement.js?v=muwqd5r4';
import { STRATEGIES, strategyProfile, choose } from './strategies.js?v=muwqd5r4';
import { EDGE } from './nav.js?v=muwqd5r4';

// Skill is a number from 0 (a first-time player) to 1 (a top player). Every trait is interpolated
// between those two anchors; reaction time and aim error interpolate geometrically, since people are
// spread out on a ratio scale there. Each bot also gets its own small offset per trait, so two bots
// of the same skill still play differently (one reacts fast but aims loosely, another the reverse).
const ANCHORS = {
  reaction: [0.95, 0.15, 'geo'], aimErr: [0.14, 0.012, 'geo'], turn: [3.5, 20], settle: [5, 22], ff: [0.1, 0.92], track: [0.8, 4.5],
  // Hand wobble that never settles (radians, typical size): the reason people miss a still egg at range.
  wobble: [0.035, 0.0035, 'geo'],
  lead: [0.0, 0.95], fovMul: [0.8, 1.15], discipline: [0.12, 1], strafe: [0.25, 1], jump: [0.01, 0.1], nade: [0.08, 0.92],
  cover: [0.2, 0.92], hearing: [0.5, 1], flinch: [1.8, 0.6, 'geo'],
};
// A difficulty is a range of skills, not one value: a lobby on Normal has some sharper and some
// weaker bots, like a lobby of real people. Draws cluster towards the middle of the range.
// Normal is an average public-lobby player; Hard a good regular; Expert the top of the leaderboard.
export const SKILL_RANGES = { easy: [0, 0.22], normal: [0.12, 0.42], hard: [0.38, 0.68], expert: [0.68, 1], mixed: [0, 1], public: [0.05, 0.55] };
// A standard normal draw (sum of uniforms; good enough for hand noise).
const gauss = rnd => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;
export function drawSkill(difficulty, rnd) {
  if (typeof difficulty === 'number') return Math.max(0, Math.min(1, difficulty));
  const [lo, hi] = SKILL_RANGES[difficulty] || SKILL_RANGES.normal;
  return lo + (hi - lo) * (rnd() + rnd()) / 2;
}
export function traits(skill, rnd = Math.random, spread = 0.16) {
  const out = {};
  for (const [k, [a, b, mode]] of Object.entries(ANCHORS)) {
    const t = Math.max(0, Math.min(1, skill + (rnd() - 0.5) * spread));
    out[k] = mode === 'geo' ? a * Math.pow(b / a, t) : a + (b - a) * t;
  }
  return out;
}
// Where each weapon likes to fight from (units).
const RANGE = { yolk47: [4, 12], doubleYolker: [0, 4.5], cageFree: [10, 30], yolkzooka: [5, 16], beater: [0, 8], poacher: [14, 45], triBoil: [5, 14], peck9mm: [0, 10] };

// How each weapon is played. perch: hold exposed high ground with long sightlines; ambush: wait in cover
// next to busy areas and flank through covered routes; hunt: chase last-known positions; avoidOpen:
// how much paths avoid exposed ground; hop: duel-hopping tendency; rushHurt: close in on enemies that
// are hurt or reloading.
const STYLE = {
  poacher: { perch: true, hunt: 0.15, avoidOpen: 0, hop: 0, rushHurt: 0 },
  cageFree: { perch: true, hunt: 0.35, avoidOpen: 0, hop: 0.2, rushHurt: 0.2 },
  doubleYolker: { ambush: true, hunt: 1, avoidOpen: 3, hop: 1.6, rushHurt: 1 },
  beater: { hunt: 0.9, avoidOpen: 1.5, hop: 1.3, rushHurt: 0.8 },
  yolk47: { hunt: 0.6, avoidOpen: 0.5, hop: 0.8, rushHurt: 0.5 },
  triBoil: { hunt: 0.5, avoidOpen: 0.5, hop: 0.6, rushHurt: 0.4 },
  yolkzooka: { hunt: 0.4, avoidOpen: 0.8, hop: 0.5, rushHurt: 0.2 },
  peck9mm: { hunt: 0.6, avoidOpen: 1, hop: 1, rushHurt: 0.6 },
};
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export class Bot {
  constructor(manager, player, difficulty = 'normal', personality = {}) {
    this.mgr = manager; this.m = manager.match; this.p = player; this.nav = manager.nav;
    this.rnd = manager.rng;
    this.skill = drawSkill(difficulty, this.rnd);
    this.d = traits(this.skill, this.rnd);
    this.pref = strategyProfile(this.rnd); // this bot's own playstyle
    this.strategy = null; this.stratSince = 0;
    this.per = { aggression: 0.3 + this.rnd() * 0.7, patience: this.rnd(), hopper: Math.pow(this.rnd(), 1.6), chatty: this.rnd() < 0.3 ? 0 : this.rnd(), ...personality };
    this.mem = new Map(); // enemy id → { x, y, z, vx, vy, vz, tick, seen, react, firstSeen, hp }
    this.target = null; this.path = null; this.pi = 0; this.goal = null;
    this.yaw = player.body.yaw; this.pitch = 0; this.yawV = 0; this.pitchV = 0;
    this.errYaw = 0; this.errPitch = 0; this.wobY = 0; this.wobP = 0; this.intendYaw = 0; this.intendPitch = 0;
    this.strafe = 1; this.strafeT = 0; this.ctrl = 0; this.prevFire = false;
    this.thinkT = (player.id * 7) % 9; this.senseT = player.id % 3;
    this.stuckT = 0; this.lastPos = { x: 0, z: 0 }; this.progressT = 0;
    this.nadeCooldown = 0; this.nadePlan = null; this.burst = 0; this.burstRest = 0; this.phase = 'move'; this.phaseT = 0; this.hopT = 0; this.hopCool = 0; this.orbit = 1;
    this.spawnDelay = 0; this.lookAround = 0; this.glance = null;
  }
  get body() { return this.p.body; }

  // ---------------- perception ----------------
  sense() {
    const m = this.m, me = this.p, b = me.body, ex = b.x, ey = b.y + PLAYER.eyeY, ez = b.z;
    const fovHalf = 1.15 * this.d.fovMul;
    for (const q of m.players.values()) {
      if (q === me || !m.enemies(me, q)) continue;
      const mem = this.mem.get(q.id);
      if (!q.alive) { if (mem) mem.dead = true; continue; }
      const qb = q.body, cy = qb.y + m.hitY(q);
      const dx = qb.x - ex, dy = cy - ey, dz = qb.z - ez, dist = Math.hypot(dx, dy, dz);
      if (dist > 80) continue;
      const off = Math.abs(wrap(yawTo(dx, dz) - this.yaw));
      const vOff = Math.abs(Math.atan2(dy, Math.hypot(dx, dz)) - this.pitch);
      const close = dist < 2.2;
      if (!close && (off > fovHalf || vOff > 1.0)) continue;
      // Spatula carriers are visible to everyone; anyone else needs a clear line to some of the egg.
      const reveal = m.mode.spat?.carrier === q.id;
      const vis = reveal || m.grid.visible(ex, ey, ez, qb.x, cy, qb.z) || m.grid.visible(ex, ey, ez, qb.x, qb.y + 0.55, qb.z);
      if (!vis) continue;
      const seenNow = vis && (!reveal || m.grid.visible(ex, ey, ez, qb.x, cy, qb.z));
      this.see(q, seenNow, off > fovHalf * 0.6 ? 1.5 : 1, dist);
    }
  }
  see(q, clear, peripheral, dist) {
    const t = this.m.tick, qb = q.body;
    let mem = this.mem.get(q.id);
    if (!mem) { mem = { x: qb.x, y: qb.y, z: qb.z, vx: 0, vy: 0, vz: 0, tick: -999, seen: false, react: 0, firstSeen: t }; this.mem.set(q.id, mem); }
    const fresh = t - mem.tick > 45 || !mem.seen || mem.dead;
    if (fresh) {
      // Human reaction time, longer in the corner of the eye or at long range.
      const r = this.d.reaction * peripheral * (1 + Math.min(1, dist / 40) * 0.5) * (0.8 + this.rnd() * 0.5);
      mem.react = t + Math.round(r / TICK); mem.firstSeen = t;
      // Fresh aim error each time the target appears.
      this.newError(dist, 1.6);
    } else if (t > mem.tick) {
      // Velocity estimate from what was seen, smoothed (no reading the true velocity).
      const k = 1 / Math.max(1, t - mem.tick), a = 0.5;
      mem.vx = mem.vx * (1 - a) + (qb.x - mem.x) * k * a; mem.vy = mem.vy * (1 - a) + (qb.y - mem.y) * k * a; mem.vz = mem.vz * (1 - a) + (qb.z - mem.z) * k * a;
    }
    mem.x = qb.x; mem.y = qb.y; mem.z = qb.z; mem.tick = t; mem.seen = clear; mem.dead = false; mem.hp = q.hp; mem.heard = false;
  }
  // Sounds: gunfire and explosions carry far, footsteps and reloads only close (GDD §24: cracks on
  // hit are audible and give fights away).
  hear(src, x, y, z, radius) {
    const b = this.body, dist = Math.hypot(x - b.x, y - b.y, z - b.z);
    if (dist > radius * this.d.hearing) return;
    const q = this.m.players.get(src); if (!q || q === this.p || !this.m.enemies(this.p, q)) return;
    let mem = this.mem.get(src);
    const err = dist * 0.08;
    if (!mem) { mem = { x, y, z, vx: 0, vy: 0, vz: 0, tick: -999, seen: false, react: 0, firstSeen: this.m.tick }; this.mem.set(src, mem); }
    if (this.m.tick - mem.tick < 10 && mem.seen) return; // already watching them
    mem.x = x + (this.rnd() - 0.5) * err; mem.y = y; mem.z = z + (this.rnd() - 0.5) * err; mem.tick = this.m.tick; mem.seen = false; mem.heard = true; mem.dead = false;
  }
  hurtBy(src, dmg) {
    const q = this.m.players.get(src); if (!q || q === this.p) return;
    this.hear(src, q.body.x, q.body.y, q.body.z, 200);
    // Getting shot shakes the aim (flinch), scaled by difficulty.
    this.errYaw += (this.rnd() - 0.5) * 0.05 * this.d.flinch; this.errPitch += (this.rnd() - 0.5) * 0.04 * this.d.flinch;
    this.underFire = this.m.tick;
    if (!this.target || !this.visible(this.target)) this.target = src;
  }
  newError(dist, mul = 1) {
    const e = this.d.aimErr * mul * (0.5 + this.rnd());
    const a = this.rnd() * Math.PI * 2;
    this.errYaw = Math.cos(a) * e; this.errPitch = Math.sin(a) * e * 0.6;
  }
  visible(id) { const mem = this.mem.get(id); return !!mem && mem.seen && this.m.tick - mem.tick <= 4 && !mem.dead; }

  // ---------------- decisions ----------------
  pickTarget() {
    const t = this.m.tick, b = this.body;
    let best = null, bs = -Infinity;
    for (const [id, mem] of this.mem) {
      const q = this.m.players.get(id);
      if (!q || !q.alive || mem.dead || t - mem.tick > 150) { if (!q) this.mem.delete(id); continue; }
      const dist = Math.hypot(mem.x - b.x, mem.z - b.z);
      let s = -dist * 0.15;
      if (this.visible(id)) s += 10;
      else s -= (t - mem.tick) / 30;
      if (id === this.target) s += 3;
      if (this.underFire && t - this.underFire < 30 && id === this.lastAttacker) s += 4;
      s += (100 - (mem.hp ?? 100)) * 0.03;
      if (s > bs) { bs = s; best = id; }
    }
    if (best !== this.target) this.newError(30, 1);
    this.target = best;
  }
  // What this bot knows right now, for choosing and running a strategy.
  context() {
    const m = this.m, me = this.p, h = me.hands, s = slotOf(h), w = WEAPONS[s.id], b = me.body;
    const tmem = this.target !== null ? this.mem.get(this.target) : null;
    const seeing = this.target !== null && this.visible(this.target);
    const distMem = tmem ? Math.hypot(tmem.x - b.x, tmem.z - b.z) : Infinity;
    const [near, far] = RANGE[s.id] || [3, 12];
    let closeFoes = 0; for (const mem of this.mem.values()) if (!mem.dead && m.tick - mem.tick < 60 && Math.hypot(mem.x - b.x, mem.z - b.z) < 10) closeFoes++;
    const tq = this.target !== null ? m.players.get(this.target) : null;
    const hpFrac = (me.hp + me.shield) / 100;
    const enemyWid = tq ? tq.hands.slots[tq.hands.cur].id : null; // their gun is visible in their hands
    return {
      tick: m.tick, seeing, tmem, tq, dist: distMem, distMem, near, far, wid: s.id, w, scoped: !!w.scoped && !w.rocket,
      hpFrac, lowHp: hpFrac < 0.4, losing: !!tmem && (tmem.hp ?? 100) > me.hp + me.shield,
      enemyWeak: !!tmem && ((tmem.hp ?? 100) < 45 || this.enemyReloading(this.target)),
      enemyShortRange: enemyWid === 'doubleYolker' || enemyWid === 'beater',
      reloading: h.reload > 0 || (s.mag === 0 && s.store > 0), storeFrac: s.store / w.store,
      underFire: !!this.underFire && m.tick - this.underFire < 30, closeFoes,
      recent: !!tmem && !tmem.dead && m.tick - tmem.tick < 150,
      item: this.wantItem(), objective: this.objective(),
    };
  }
  // Every ~0.3 s: pick (or keep) a strategy and let it steer.
  think() {
    this.pickTarget();
    const c = this.context();
    const next = choose(this, c);
    if (!next) return;
    if (next !== this.strategy || !this.goal) { this.strategy = next; this.stratSince = c.tick; next.enter(this, c); }
    else next.update?.(this, c);
    this.tactic = next.tactic;
  }
  // A spot a few steps away with a clear line to where the enemy was (the peek), nearest first.
  peekNode(mem) {
    const N = this.nav.nodes, start = this.nav.nearest(this.body.x, this.body.y, this.body.z);
    if (start === null) return null;
    const seen = new Set([start]), queue = [[start, 0]];
    while (queue.length) {
      const [id, depth] = queue.shift(), n = N[id];
      if (depth > 0 && this.m.grid.visible(n.x, n.y + PLAYER.eyeY, n.z, mem.x, mem.y + 0.3, mem.z)) return id;
      if (depth >= 4) continue;
      for (const e of n.edges) if (!seen.has(e.to) && e.kind === EDGE.walk) { seen.add(e.to); queue.push([e.to, depth + 1]); }
    }
    return null;
  }
  // A spot beside where the enemy was, off their likely line of sight (we came from the other way).
  flankNode(mem) {
    const b = this.body, dx = mem.x - b.x, dz = mem.z - b.z, l = Math.hypot(dx, dz) || 1, side = this.rnd() < 0.5 ? -1 : 1;
    const px = mem.x + (-dz / l) * side * 5 - (dx / l) * 1.5, pz = mem.z + (dx / l) * side * 5 - (dz / l) * 1.5;
    return this.nodeNear(px, mem.y, pz, 2);
  }
  enemyReloading(id) { const q = this.m.players.get(id); return !!q && q.hands.reload > 0; }
  // Snipers: exposed, high, long sightlines, and not right next to known enemies.
  perchNode() {
    const N = this.nav.nodes; let best = null, bs = -Infinity;
    for (let k = 0; k < 24; k++) {
      const n = N[Math.floor(this.rnd() * N.length)];
      if (this.nav.comp[n.id] !== this.nav.main) continue;
      let sc = n.sight * 0.15 + n.exposure * 2 + n.height * 3 + this.rnd();
      for (const [, mem] of this.mem) if (!mem.dead) { const d = Math.hypot(mem.x - n.x, mem.z - n.z); if (d < 10) sc -= (10 - d) * 0.4; }
      if (sc > bs) { bs = sc; best = n.id; }
    }
    return best;
  }
  // Shotguns: a covered spot right next to busy ground (or next to where the enemy was).
  ambushNode(mem) {
    const N = this.nav.nodes; let best = null, bs = -Infinity;
    for (let k = 0; k < 24; k++) {
      const n = N[Math.floor(this.rnd() * N.length)];
      if (this.nav.comp[n.id] !== this.nav.main) continue;
      let sc = (1 - n.exposure) * 2 + n.busy * 2 + this.rnd() * 0.5;
      if (mem) sc -= Math.abs(Math.hypot(mem.x - n.x, mem.z - n.z) - 3) * 0.4;
      if (sc > bs) { bs = sc; best = n.id; }
    }
    return best;
  }
  objectiveUrgent() { const k = this.m.mode.state().k; return k === 'roost' || k === 'spatula'; }
  objective() {
    const m = this.m, st = m.mode, me = this.p;
    if (st.zones && st.zone >= 0) {
      const z = st.zones[st.zone];
      // Most of the team plays the zone; a few guard the approaches.
      const role = (me.id * 2654435761 >>> 0) % 4;
      if (role !== 3 || st.owner !== me.team) {
        if (st.inZone(me) && this.goal?.k === 'zone') return this.rnd() < 0.15 ? { k: 'zone', node: this.zoneNode(z) } : this.goal;
        return { k: 'zone', node: this.zoneNode(z) };
      }
      return { k: 'roam', node: this.nodeNear(z.cx, z.cy, z.cz, 8) };
    }
    if (st.spat) {
      const s = st.spat;
      if (s.carrier === me.id) return { k: 'carry', node: this.safeNode() };
      if (s.carrier < 0) return { k: 'spatula', node: this.nav.nearest(s.x, s.y - 0.3, s.z) };
      const c = m.players.get(s.carrier);
      if (c && c.team === me.team) return { k: 'escort', node: this.nodeNear(c.body.x, c.body.y, c.body.z, 3) };
      if (c) { this.hear(c.id, c.body.x, c.body.y, c.body.z, 1e9); return { k: 'hunt', node: this.nav.nearest(c.body.x, c.body.y, c.body.z), target: c.id }; }
    }
    return null;
  }
  zoneNode(z) {
    const ids = [];
    for (let x = Math.floor(z.x0); x < z.x1; x++) for (let zz = Math.floor(z.z0); zz < z.z1; zz++) { const id = this.nav.at(x, z.y0, zz, 0.8); if (id !== null) ids.push(id); }
    return ids.length ? ids[Math.floor(this.rnd() * ids.length)] : this.nav.nearest(z.cx, z.cy, z.cz);
  }
  nodeNear(x, y, z, r) {
    for (let k = 0; k < 12; k++) {
      const id = this.nav.nearest(x + (this.rnd() - 0.5) * r * 2, y, z + (this.rnd() - 0.5) * r * 2);
      if (id !== null && this.nav.comp[id] === this.nav.main) return id;
    }
    return this.nav.nearest(x, y, z);
  }
  // Somewhere away from enemies (spatula carrier keeps alive; kills while holding score).
  safeNode() {
    let best = null, bs = -Infinity;
    for (let k = 0; k < 10; k++) {
      const n = this.nav.nodes[Math.floor(this.rnd() * this.nav.nodes.length)];
      if (this.nav.comp[n.id] !== this.nav.main) continue;
      let s = n.exposure ? -n.exposure * 2 : 0;
      for (const [, mem] of this.mem) if (!mem.dead) s += Math.min(20, Math.hypot(mem.x - n.x, mem.z - n.z)) * 0.2;
      if (s > bs) { bs = s; best = n.id; }
    }
    return best;
  }
  roamNode() {
    // Head for where fights are likely: towards enemies' last positions or busy areas, spreading out from teammates.
    const nodes = this.nav.nodes;
    let best = null, bs = -Infinity;
    for (let k = 0; k < 14; k++) {
      const n = nodes[Math.floor(this.rnd() * nodes.length)];
      if (this.nav.comp[n.id] !== this.nav.main) continue;
      let s = (n.exposure || 0) * (0.5 + this.per.aggression) + this.rnd() * 3;
      // Towards where enemies were last seen or heard (never where they really are), away from teammates.
      for (const [, mem] of this.mem) if (!mem.dead && this.m.tick - mem.tick < 600) s += this.per.aggression * Math.max(0, 15 - Math.hypot(mem.x - n.x, mem.z - n.z)) * 0.15;
      for (const q of this.m.players.values()) if (q !== this.p && q.alive && !this.m.enemies(this.p, q)) s -= Math.max(0, 6 - Math.hypot(q.body.x - n.x, q.body.z - n.z)) * 0.5;
      s += n.busy * 2;
      if (s > bs) { bs = s; best = n.id; }
    }
    return best;
  }
  wantItem() {
    const h = this.p.hands, s = slotOf(h), w = WEAPONS[s.id];
    const needAmmo = s.store < w.store * 0.35, needNade = h.grenades < GRENADE.max;
    if (!needAmmo && !(needNade && this.rnd() < 0.5)) return null;
    const b = this.body;
    let best = null, bd = needAmmo ? 22 : 10;
    for (const it of this.m.items) {
      if (!it.active || (it.kind === 'ammo' ? !needAmmo : !needNade)) continue;
      const d = Math.hypot(it.x - b.x, it.z - b.z) + Math.abs(it.y - b.y) * 2;
      if (d < bd) { bd = d; best = it; }
    }
    return best ? { id: best.id, node: this.nav.nearest(best.x, best.y - 0.3, best.z) } : null;
  }
  // Nearest reachable node an enemy at `from` can't see (breadth-first over the nav graph).
  findCover(from) {
    const N = this.nav.nodes, start = this.nav.nearest(this.body.x, this.body.y, this.body.z);
    if (start === null) return null;
    const seen = new Set([start]), queue = [[start, 0]];
    const ex = from.x, ey = from.y + PLAYER.eyeY, ez = from.z;
    let checked = 0;
    while (queue.length && checked < 80) {
      const [id, depth] = queue.shift(); checked++;
      const n = N[id];
      if (depth > 0 && !this.m.grid.visible(ex, ey, ez, n.x, n.y + 0.3, n.z) && !this.m.grid.visible(ex, ey, ez, n.x, n.y + 0.6, n.z)) return id;
      if (depth > 10) continue;
      for (const e of n.edges) if (!seen.has(e.to) && e.kind !== EDGE.ladder) { seen.add(e.to); queue.push([e.to, depth + 1]); }
    }
    return null;
  }
  retreatNode(from, want) {
    const N = this.nav.nodes, start = this.nav.nearest(this.body.x, this.body.y, this.body.z);
    if (start === null) return null;
    let best = start, bs = -Infinity;
    for (const e of N[start].edges) {
      if (e.kind !== EDGE.walk) continue;
      const n = N[e.to], d = Math.hypot(n.x - from.x, n.z - from.z);
      const s = -Math.abs(d - want) + this.rnd() * 0.3;
      if (s > bs) { bs = s; best = e.to; }
    }
    return best;
  }
  setGoal(g) {
    if (g.node === null || g.node === undefined) { this.goal = { ...g, node: null }; this.path = null; return; }
    const same = this.goal && this.goal.node === g.node && this.path;
    this.goal = g;
    if (same) return;
    const start = this.nav.nearest(this.body.x, this.body.y, this.body.z);
    // Paths avoid known enemy sightlines a little when not looking for a fight.
    const open = g.avoidOpen ?? (STYLE[slotOf(this.p.hands).id] || STYLE.yolk47).avoidOpen;
    const avoid = n => (g.k === 'hunt' || g.k === 'close' ? 0 : this.danger(n)) + n.exposure * open;
    this.path = this.nav.path(start, g.node, avoid);
    this.pi = 0; this.progressT = 0;
  }
  danger(n) {
    let c = 0;
    for (const [id, mem] of this.mem) {
      if (this.m.tick - mem.tick > 200 || mem.dead) continue;
      const d = Math.hypot(mem.x - n.x, mem.z - n.z);
      if (d < 18) c += (18 - d) * 0.08;
    }
    return c;
  }
  arrived() { return !this.path || this.pi >= this.path.length; }

  // ---------------- per tick ----------------
  tick() {
    const m = this.m, me = this.p;
    if (!me.alive) {
      this.path = null; this.goal = null; this.target = null; this.mem.clear();
      if (m.canRespawn(me)) {
        if (this.spawnDelay <= 0) this.spawnDelay = Math.round((0.3 + this.rnd() * 1.2) / TICK);
        else if (--this.spawnDelay <= 0) { this.choosePrimary(); m.requestRespawn(me.id); this.yaw = me.body.yaw; this.pitch = 0; }
      }
      m.setInput(me.id, 0, this.yaw, this.pitch);
      return;
    }
    if (++this.senseT >= 3) { this.senseT = 0; this.sense(); }
    if (++this.thinkT >= 9) { this.thinkT = 0; this.think(); }
    if (this.nadeCooldown > 0) this.nadeCooldown--;
    let ctrl = 0;
    const h = me.hands, s = slotOf(h), w = WEAPONS[s.id], b = me.body;
    const tmem = this.target !== null ? this.mem.get(this.target) : null;
    const seeing = this.target !== null && this.visible(this.target) && m.tick >= tmem.react;
    const tq = this.target !== null ? m.players.get(this.target) : null;

    // --- where to look ---
    let wantYaw = this.yaw, wantPitch = 0, aimingAt = false;
    if (this.nadePlan) { wantYaw = this.nadePlan.yaw; wantPitch = this.nadePlan.pitch; }
    else if (seeing && tq) {
      const aim = this.aimPoint(tq, tmem, w);
      // The hand's wobble (a slow random wander that never settles), bigger when the target slides across
      // the view or when this egg is moving or in the air.
      const rel = Math.hypot(tq.body.vx - b.vx, tq.body.vz - b.vz) * 30 / Math.max(1, aim.dist);
      const amp = this.d.wobble * (1 + Math.min(2.5, rel * 1.5) + Math.hypot(b.vx, b.vz) * 15 + (b.onGround === 0 ? 1.2 : 0));
      const th = 4 * TICK, sg = amp * Math.sqrt(2 * th);
      this.wobY += -this.wobY * th + sg * gauss(this.rnd); this.wobP += -this.wobP * th + sg * 0.7 * gauss(this.rnd);
      wantYaw = aim.yaw + this.errYaw + this.wobY; wantPitch = aim.pitch + this.errPitch + this.wobP; aimingAt = aim;
      // Tracking tightens the error; a change of direction by the target loosens it again.
      const decay = Math.exp(-this.d.track * TICK);
      this.errYaw *= decay; this.errPitch *= decay;
      const tv = Math.hypot(tq.body.vx, tq.body.vz);
      if (tq.body.onGround === 0 && this.rnd() < 0.05) this.newError(aim.dist, 0.6);
      else if (tv > 0.03 && this.rnd() < 0.02) this.newError(aim.dist, 0.4);
    } else if (tmem && m.tick - tmem.tick < 120 && !tmem.dead) {
      // Pre-aim where they were (corner check), at head height.
      wantYaw = yawTo(tmem.x - b.x, tmem.z - b.z);
      wantPitch = Math.atan2(tmem.y + 0.3 - (b.y + PLAYER.eyeY), Math.hypot(tmem.x - b.x, tmem.z - b.z));
    } else {
      const look = this.lookAhead();
      if (look) { wantYaw = look.yaw; wantPitch = look.pitch; }
    }
    this.intendYaw = wantYaw; this.intendPitch = wantPitch;
    this.turn(wantYaw, wantPitch);

    // --- movement ---
    const move = this.steer();
    let mx = move.x, mz = move.z;
    const inFight = seeing && tq;
    if (inFight) {
      const dist = Math.hypot(tq.body.x - b.x, tq.body.z - b.z);
      const sniping = (s.id === 'poacher' || s.id === 'cageFree') && dist > 9;
      // Counter-strafing: move a little, stop, shoot while the spread is tight, move again. Weapons that
      // barely care about movement (the shotgun) or point-blank fights keep moving the whole time.
      const moveTolerant = (w.moveMod ?? 1) < 0.5 || dist < 3.5;
      if (--this.phaseT <= 0) {
        this.phase = this.phase === 'shoot' ? 'move' : 'shoot';
        const skill = this.d.discipline;
        this.phaseT = Math.round((this.phase === 'shoot' ? 0.35 + this.rnd() * 0.45 : (0.22 + this.rnd() * 0.35) * (1.4 - skill * 0.5)) / TICK);
      }
      // Duel hopping, only when it's the right call: a close fight (roughly one on one), the opponent
      // aiming at us or shooting at us, and a weapon that still shoots straight while moving. Never with
      // a sniper, a scope, or at range. It lasts as long as that situation does; personality and skill
      // only decide how readily a bot sees the situation as a hopping one.
      const tb = tq.body, aimErr = Math.abs(wrap(tb.yaw - yawTo(b.x - tb.x, b.z - tb.z)));
      const aimedAt = aimErr < 0.25, shotAt = this.underFire && m.tick - this.underFire < 20;
      let closeFoes = 0; for (const [id, mem] of this.mem) if (!mem.dead && m.tick - mem.tick < 20 && Math.hypot(mem.x - b.x, mem.z - b.z) < 10) closeFoes++;
      const style = STYLE[s.id] || STYLE.yolk47, tactic = this.tactic || { strafe: true, stand: 'counter', hop: 'duel' };
      // The current strategy says how to fight. Escaping hops away from a pusher (any weapon, unscoped);
      // duel hopping needs a weapon that shoots straight on the move; some strategies never hop.
      const escaping = tactic.hop === 'escape' && this.goal?.k === 'escape' && dist < 8 && !h.ads;
      const canHop = escaping || (tactic.hop === 'duel' && style.hop > 0 && !style.perch && !h.ads && !w.scoped && h.melee === 0);
      const urge = escaping ? 1 : canHop ? (1 - Math.min(1, dist / 8)) * (aimedAt || shotAt ? 1 : 0.3) * (closeFoes <= 2 ? 1 : 0.5) * style.hop : 0;
      const threshold = 0.65 - this.per.hopper * 0.35 - this.skill * 0.15;
      const hop = urge > threshold;
      if (hop && !this.hopping) { this.orbit = wrap(yawTo(b.x - tb.x, b.z - tb.z) - tb.yaw) > 0 ? 1 : -1; } // circle away from their aim
      this.hopping = hop; this.hopWeapon = s.id;
      this.hopT = hop ? 2 : 0;
      const standing = !this.hopT && tactic.stand !== 'never' && (tactic.stand === 'always' || sniping || (!moveTolerant && this.phase === 'shoot' && h.reload === 0 && s.mag > 0));
      if (this.hopT > 0 && escaping) {
        // Run for cover along the path, hopping to spoil their aim, sidestepping when it catches up.
        if (b.onGround === 0 && aimErr < 0.06 && m.tick - (this.flipT || 0) > 12) { this.orbit = -this.orbit; this.flipT = m.tick; }
        const f = forward(b.yaw), rx = -f[2], rz = f[0];
        mx = move.x * 0.8 + rx * this.orbit * 0.4; mz = move.z * 0.8 + rz * this.orbit * 0.4;
        if (b.onGround > 0 && !(this.ctrl & CTRL.jump)) ctrl |= CTRL.jump;
      } else if (this.hopT > 0) {
        // Circle them: mostly sideways, drifting towards our preferred range.
        const tx = tb.x - b.x, tz = tb.z - b.z, l = Math.hypot(tx, tz) || 1, [near, far] = RANGE[s.id] || [3, 12];
        const radial = dist > far ? 0.5 : dist < near ? -0.5 : 0;
        // Change direction in the air when their aim catches up with us (not at random).
        if (b.onGround === 0 && aimErr < 0.06 && m.tick - (this.flipT || 0) > 12) { this.orbit = -this.orbit; this.flipT = m.tick; }
        mx = (-tz / l) * this.orbit + (tx / l) * radial; mz = (tx / l) * this.orbit + (tz / l) * radial;
        // Jump is a press: tap it on each landing.
        if (b.onGround > 0 && !(this.ctrl & CTRL.jump)) ctrl |= CTRL.jump;
      } else if (standing && h.reload === 0) { mx = 0; mz = 0; }
      else if (tactic.strafe && (this.rnd() < this.d.strafe || this.strafeT > 0)) {
        // Strafe across their line of fire, changing direction at irregular intervals.
        if (--this.strafeT <= 0) { this.strafe = this.rnd() < 0.5 ? -1 : 1; this.strafeT = Math.round((0.18 + this.rnd() * 0.5) / TICK); }
        const f = forward(b.yaw), rx = -f[2], rz = f[0];
        const k = this.goal?.k === 'hold' ? 1 : 0.7;
        mx = mx * (1 - k) + rx * this.strafe * k; mz = mz * (1 - k) + rz * this.strafe * k;
      }
      this.standing = standing;
    } else { this.standing = false; this.hopping = false; this.hopT = 0; }
    ctrl |= this.moveBits(mx, mz, b.yaw);
    if (move.jump) ctrl |= CTRL.jump;
    if (move.ladder) { ctrl = (ctrl & ~(CTRL.left | CTRL.right | CTRL.down)) | CTRL.up; }

    // --- weapons ---
    ctrl |= this.weapons(seeing, tq, tmem, aimingAt);
    // Reload, swap and melee act on a fresh press (as for a person): tap them, don't hold them, so a
    // press that came while the gun was still recovering gets another go next tick.
    ctrl &= ~(this.ctrl & (CTRL.reload | CTRL.swap | CTRL.melee));
    this.ctrl = ctrl;
    m.setInput(me.id, ctrl, this.yaw, this.pitch);
  }
  // Where to point to hit `q` with weapon w: the egg's centre, led by its velocity × flight time.
  aimPoint(q, mem, w) {
    const b = this.body, ex = b.x, ey = b.y + PLAYER.eyeY, ez = b.z;
    let tx = q.body.x, ty = q.body.y + this.m.hitY(q), tz = q.body.z;
    if (w.rocket) ty = q.body.y + 0.05; // splash at the feet
    const dist = Math.hypot(tx - ex, ty - ey, tz - ez);
    const flight = dist / w.vel;
    const L = this.d.lead * flight;
    tx += mem.vx * L; tz += mem.vz * L;
    if (q.body.onGround === 0) ty += mem.vy * L * 0.5;
    return { yaw: yawTo(tx - ex, tz - ez), pitch: Math.atan2(ty - ey, Math.hypot(tx - ex, tz - ez)), dist };
  }
  // A damped "hand" on the mouse: fast for big flicks, settling for the last bit, capped speed.
  turn(wy, wp) {
    // Track a moving aim point the way a player does: match its motion (feed-forward, by skill), then
    // close the remaining gap with a damped, speed-capped correction.
    const ffY = this.lastWantYaw === undefined ? 0 : wrap(wy - this.lastWantYaw), ffP = this.lastWantPitch === undefined ? 0 : wp - this.lastWantPitch;
    this.lastWantYaw = wy; this.lastWantPitch = wp;
    const ff = Math.abs(ffY) < 0.1 ? this.d.ff : 0; // not on flicks to a new target
    this.yaw = wrap(this.yaw + ffY * ff); this.pitch += (Math.abs(ffP) < 0.1 ? ffP * ff : 0);
    const dy = wrap(wy - this.yaw), dp = wp - this.pitch, max = this.d.turn * TICK;
    const k = 1 - Math.exp(-this.d.settle * TICK);
    this.yaw = wrap(this.yaw + Math.max(-max, Math.min(max, dy * k)));
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + Math.max(-max, Math.min(max, dp * k))));
  }
  lookAhead() {
    const b = this.body;
    // On a perch: sweep between busy spots it can see, a few seconds on each.
    if (this.goal?.k === 'perch' && this.arrived()) {
      if (!this.watch || --this.watchT <= 0) {
        this.watchT = Math.round((1.5 + this.rnd() * 2.5) / TICK); this.watch = null;
        let bs = -Infinity;
        for (let k = 0; k < 16; k++) {
          const n = this.nav.nodes[Math.floor(this.rnd() * this.nav.nodes.length)], d = Math.hypot(n.x - b.x, n.z - b.z);
          if (d < 6 || !this.m.grid.visible(b.x, b.y + 0.3, b.z, n.x, n.y + 0.3, n.z)) continue;
          const sc = n.busy * 3 + Math.min(d, 30) * 0.05 + this.rnd();
          if (sc > bs) { bs = sc; this.watch = n; }
        }
      }
      if (this.watch) { const n = this.watch; return { yaw: yawTo(n.x - b.x, n.z - b.z), pitch: Math.atan2(n.y + 0.3 - (b.y + PLAYER.eyeY), Math.hypot(n.x - b.x, n.z - b.z)) }; }
    }
    if (this.path && this.pi < this.path.length) {
      const n = this.nav.nodes[this.path[Math.min(this.path.length - 1, this.pi + 2)]];
      // Now and then glance off the path towards open ground (where people come from).
      if (--this.lookAround <= 0) { this.lookAround = Math.round((1 + this.rnd() * 2) / TICK); this.glance = this.rnd() < 0.35 ? (this.rnd() - 0.5) * 2.2 : null; }
      const yaw = yawTo(n.x - b.x, n.z - b.z) + (this.glance ?? 0) * 0.5;
      return { yaw, pitch: Math.atan2(n.y - b.y, Math.max(1, Math.hypot(n.x - b.x, n.z - b.z))) * 0.5 };
    }
    return null;
  }
  // Follow the path; returns the wanted world direction and any jump/ladder action.
  steer() {
    const b = this.body, out = { x: 0, z: 0, jump: false, ladder: false };
    if (!this.path || this.pi >= this.path.length) return out;
    const N = this.nav.nodes;
    let n = N[this.path[this.pi]];
    const prev = this.pi > 0 ? this.path[this.pi - 1] : this.nav.nearest(b.x, b.y, b.z);
    const e = prev !== null ? this.nav.edge(prev, this.path[this.pi]) : null;
    const dx = n.x - b.x, dz = n.z - b.z, d = Math.hypot(dx, dz);
    // A jump pad launches whoever touches it, usually before they reach its middle: once we're flying up
    // off it, it counts as reached.
    const launched = n.pad && b.onGround === 0 && b.vy > 0.05 && d < 1.3;
    const reached = launched || (e?.kind === EDGE.ladder ? (Math.abs(n.y - b.y) < 0.3 && d < 0.6) : (d < 0.35 && Math.abs(n.y - b.y) < 0.6));
    if (reached) { this.pi++; this.progressT = 0; return this.steer(); }
    if (e?.kind === EDGE.ladder && !e.down) {
      // Face the wall and climb.
      const lx = e.lx + 0.5 - b.x, lz = e.lz + 0.5 - b.z;
      if (b.climbing || Math.hypot(lx, lz) < 0.6) { this.yaw = yawTo(e.fx, e.fz); out.ladder = true; out.x = e.fx; out.z = e.fz; return out; }
      out.x = lx; out.z = lz; return out;
    }
    // In the air off a pad: steer for the landing spot (air control corrects an off-centre launch).
    if (e?.kind === EDGE.pad && b.onGround === 0) { if (d > 0.25) { out.x = dx / d; out.z = dz / d; } else { const f = forward(e.yaw); out.x = f[0] * 0.2; out.z = f[2] * 0.2; } return out; }
    out.x = dx / (d || 1); out.z = dz / (d || 1);
    if (e?.kind === EDGE.jump && d < 0.9 && b.onGround > 0) out.jump = true;
    // Stuck? Jump, then re-plan.
    this.progressT++;
    if (this.progressT > 30 && Math.hypot(b.x - this.lastPos.x, b.z - this.lastPos.z) < 0.15) { out.jump = true; }
    if (this.progressT % 30 === 0) { this.lastPos.x = b.x; this.lastPos.z = b.z; }
    if (this.progressT > 90) { this.path = null; this.goal = null; this.thinkT = 9; }
    return out;
  }
  moveBits(x, z, yaw) {
    const l = Math.hypot(x, z); if (l < 1e-3) return 0;
    x /= l; z /= l;
    const f = -Math.sin(yaw) * x + -Math.cos(yaw) * z, r = Math.cos(yaw) * x - Math.sin(yaw) * z;
    let c = 0;
    if (f > 0.38) c |= CTRL.up; else if (f < -0.38) c |= CTRL.down;
    if (r > 0.38) c |= CTRL.right; else if (r < -0.38) c |= CTRL.left;
    return c;
  }

  // Fire, aim, reload, swap, melee, grenades.
  weapons(seeing, q, mem, aim) {
    const me = this.p, h = me.hands, s = slotOf(h), w = WEAPONS[s.id], b = me.body, m = this.m;
    let c = 0;
    // A grenade plan in progress: hold until the planned power, then let go.
    if (this.nadePlan) {
      const p = this.nadePlan;
      if (h.charging && h.power >= p.power) { this.nadePlan = null; this.nadeCooldown = Math.round(7 / TICK); return 0; }
      if (!h.charging && p.started && --p.wait <= 0) { this.nadePlan = null; return 0; }
      p.started = true;
      return CTRL.grenade;
    }
    if (!seeing || !q) {
      // Out of the fight: reload, or plan a grenade at a remembered position.
      if (s.mag < w.mag && s.store > 0 && h.reload === 0 && (s.mag < w.mag * 0.6 || this.rnd() < 0.02)) c |= CTRL.reload;
      if (mem && !mem.dead && m.tick - mem.tick < 60 && this.nadeCooldown === 0 && h.grenades > 0 && this.rnd() < this.d.nade * 0.08) this.planGrenade(mem);
      // A good sniper holding a perch watches through the scope.
      if (w.scoped && !w.rocket && this.goal?.k === 'perch' && this.arrived() && this.skill > 0.4 && h.reload === 0) c |= CTRL.scope;
      if (s.id === 'peck9mm' && h.slots.length > 1 && h.slots[0].store + h.slots[0].mag > 0 && h.swap === 0 && this.rnd() < 0.05) c |= CTRL.swap;
      return c;
    }
    const dist = aim.dist;
    // Melee point-blank.
    if (dist < 0.95 && h.melee === 0 && (s.mag === 0 || this.rnd() < 0.15)) return CTRL.melee;
    // Out of rounds mid-fight: finish with the pistol if they're cracked, else reload.
    if (s.mag === 0) {
      if (s.id !== 'peck9mm' && (mem.hp ?? 100) < 50 && dist < 14 && h.slots[1]?.mag > 0 && h.swap === 0) return CTRL.swap;
      return s.store > 0 ? CTRL.reload : (h.slots.length > 1 && h.swap === 0 ? CTRL.swap : 0);
    }
    // Grenade at a group, or at someone holding still behind cover.
    if (this.nadeCooldown === 0 && h.grenades > 0 && dist > 5 && dist < 16 && this.rnd() < this.d.nade * 0.03) { this.planGrenade(mem); if (this.nadePlan) return CTRL.grenade; }
    const [near, far] = RANGE[s.id] || [3, 12];
    // Aim down sights at range with scoped/precise weapons.
    const ads = (w.scoped && !w.rocket && (dist > 7 || (this.tactic?.ads && dist > 3))) || (dist > far * 0.8 && w.ads < 0.7);
    if (ads) c |= CTRL.scope;
    if (s.id === 'doubleYolker' && dist > 6.5) { return c; }
    if (w.rocket && dist < w.minRange + 0.6) { return (h.slots.length > 1 && h.swap === 0) ? CTRL.swap : c; }
    if (dist > w.range * 0.98) { return c; }
    if (ads && h.ads === false && w.scoped) { return c; } // wait for the scope to settle
    // On target? Compare the aim's angular error with the egg's angular size.
    // Against where it *means* to aim: a person can't see their own error, only whether the crosshair
    // is where they put it, so errors turn into misses rather than into perfect patience.
    const offYaw = Math.abs(wrap(this.yaw - this.intendYaw)), offPitch = Math.abs(this.pitch - this.intendPitch);
    const size = Math.atan2(m.hitR(q), dist);
    const off = Math.hypot(offYaw, offPitch);
    const spread = currentSpread(h, w);
    const tolerance = w.pellets ? size * 3 + 0.08 : size * (1.1 + (1 - this.d.discipline) * 1.5);
    if (off > tolerance) { this.burst = 0; return c; }
    // Snipers wait until they've actually stopped.
    if ((s.id === 'poacher' || s.id === 'cageFree') && dist > 9 && Math.hypot(b.vx, b.vz) > 0.012 * (2 - this.d.discipline)) { return c; }
    // Bloom discipline: at range, only shoot when the spread has recovered enough to land.
    const close = dist < 6;
    const bloomOk = close || spread < size * (2.2 + (1 - this.d.discipline) * 4) || w.pellets;
    if (w.auto) {
      if (this.burstRest > 0) { this.burstRest--; return c; }
      if (bloomOk) {
        c |= CTRL.fire; this.burst++;
        const maxBurst = close ? 99 : Math.max(2, Math.round(6 - dist / 4));
        if (this.burst >= maxBurst) { this.burst = 0; this.burstRest = Math.round((0.12 + dist / 60) / TICK * this.d.discipline); }
      }
      return c;
    }
    // Semi-auto/burst: a click per shot.
    if (bloomOk && h.rof <= 0 && !this.prevFire) { this.prevFire = true; return c | CTRL.fire; }
    this.prevFire = false;
    return c;
  }
  // Solve a throw with the real grenade physics: try pitches and powers, keep the best landing.
  planGrenade(mem) {
    const b = this.body, tx = mem.x, ty = mem.y, tz = mem.z;
    const yaw = yawTo(tx - b.x, tz - b.z);
    let best = null, bd = 2.2;
    for (const power of [0.35, 0.55, 0.75, 1]) for (let pitch = -0.2; pitch <= 1.0; pitch += 0.15) {
      const end = this.simGrenade(yaw, pitch, power);
      if (!end) continue;
      const d = Math.hypot(end.x - tx, end.y - ty, end.z - tz);
      if (d < bd) { bd = d; best = { yaw, pitch, power }; }
    }
    // Never throw it at our own feet.
    if (best && Math.hypot(tx - b.x, tz - b.z) > GRENADE.radius + 0.8) {
      const err = (1 - this.d.nade) * 0.06;
      this.nadePlan = { yaw: best.yaw + (this.rnd() - 0.5) * err, pitch: best.pitch + (this.rnd() - 0.5) * err, power: Math.max(0, best.power - 0.01), started: false, wait: 60 };
    }
  }
  simGrenade(yaw, pitch, power) {
    const b = this.body, f = forward(yaw, pitch), g = this.m.grid;
    const sp = GRENADE.throwSpeed[0] + (GRENADE.throwSpeed[1] - GRENADE.throwSpeed[0]) * power;
    let x = b.x + f[0] * 0.3, y = b.y + PLAYER.eyeY + f[1] * 0.3, z = b.z + f[2] * 0.3;
    let vx = f[0] * sp + b.vx, vy = f[1] * sp + GRENADE.upBias * sp + b.vy, vz = f[2] * sp + b.vz;
    const grav = 0.012 * this.m.options.gravity;
    for (let t = 0; t < GRENADE.fuse; t++) {
      vy = Math.max(vy - grav, -0.29); vx *= GRENADE.drag; vz *= GRENADE.drag;
      x += vx; y += vy; z += vz;
      g.overlaps(x, y, z, GRENADE.radiusBody, (nx, ny, nz, depth) => {
        x += nx * depth; y += ny * depth; z += nz * depth;
        const vn = vx * nx + vy * ny + vz * nz;
        if (vn < 0) { vx -= 1.6 * vn * nx; vy -= 1.6 * vn * ny; vz -= 1.6 * vn * nz; vx *= 0.98; vz *= 0.98; }
        return false;
      });
      if (y < -10) return null;
    }
    return { x, y, z };
  }
  // Loadout: personality and map size decide (snipers on big open maps, shotguns in close quarters).
  choosePrimary() {
    const disabled = this.m.options.disabled, size = Math.max(this.m.grid.w, this.m.grid.d);
    if (!this.per.primary) {
      const w = { yolk47: 3, doubleYolker: size < 30 ? 3 : 1.5, cageFree: size > 28 ? 2.5 : 1, yolkzooka: 1, beater: size < 30 ? 2.5 : 1.5, poacher: size > 28 ? 3 : 1.5, triBoil: 2 };
      let total = 0; for (const k of PRIMARIES) if (!disabled.includes(k)) total += w[k];
      let r = this.rnd() * total;
      for (const k of PRIMARIES) { if (disabled.includes(k)) continue; r -= w[k]; if (r <= 0) { this.per.primary = k; break; } }
    }
    if (this.per.primary) this.m.setPrimary(this.p.id, this.per.primary);
  }
}

// Every bot in a match: builds nothing itself (the nav graph is shared), relays heard events.
export class BotManager {
  constructor(match, nav, seed = 1) {
    this.match = match; this.nav = nav; this.bots = new Map(); this.chatQueue = [];
    let s = seed >>> 0 || 1;
    this.rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  add(player, difficulty, personality) { const b = new Bot(this, player, difficulty, personality); this.bots.set(player.id, b); b.choosePrimary(); return b; }
  remove(id) { this.bots.delete(id); }
  // Feed this tick's sim events to the bots' senses.
  events(list) {
    if (!this.bots.size) return;
    const m = this.match;
    for (const e of list) {
      switch (e.t) {
        case 'fire': { const p = m.players.get(e.id); if (p) for (const b of this.bots.values()) b.hear(e.id, p.body.x, p.body.y, p.body.z, 40); break; }
        case 'hit': {
          const bot = this.bots.get(e.id); if (bot && e.by >= 0) { bot.hurtBy(e.by, e.dmg); bot.lastAttacker = e.by; }
          // The crack of a hit is audible nearby.
          for (const b of this.bots.values()) if (b.p.id !== e.id) b.hear(e.id, e.x, e.y, e.z, 16);
          break;
        }
        case 'boom': for (const b of this.bots.values()) b.hear(-1, e.x, e.y, e.z, 30); break;
        case 'jump': case 'land': { const p = m.players.get(e.id); if (p) for (const b of this.bots.values()) b.hear(e.id, p.body.x, p.body.y, p.body.z, 7); break; }
        case 'reload': { const p = m.players.get(e.id); if (p) for (const b of this.bots.values()) b.hear(e.id, p.body.x, p.body.y, p.body.z, 6); break; }
        case 'join': { const p = m.players.get(e.id); if (p && !p.bot) for (const id of this.bots.keys()) this.say(id, 'hello'); break; }
        case 'kill': {
          const bot = this.bots.get(e.id); if (bot) bot.mem.clear();
          if (bot && e.by >= 0) this.say(e.id, e.w === 'poacher' || e.w === 'cageFree' ? 'niceShot' : 'died');
          const killer = this.bots.get(e.by);
          if (killer) { killer.lastKill = m.tick; const k = m.players.get(e.by); if (k && k.streak >= 5 && k.streak % 5 === 0) this.say(e.by, 'streak'); else if (!m.players.get(e.id)?.bot) this.say(e.by, 'kill'); }
          for (const b of this.bots.values()) { const mem = b.mem.get(e.id); if (mem) mem.dead = true; if (b.target === e.id) b.target = null; }
          break;
        }
      }
    }
  }
  tick() {
    for (const b of this.bots.values()) b.tick();
    // Queued chat lines go out after a human typing delay.
    for (let i = this.chatQueue.length - 1; i >= 0; i--) {
      const q = this.chatQueue[i];
      if (--q.wait > 0) continue;
      this.chatQueue.splice(i, 1);
      if (this.bots.has(q.id)) this.onChat?.(q.id, q.msg);
    }
  }
  // Bots talk now and then, like people: a greeting for newcomers, a groan after dying, a "nice shot"
  // for a good kill. Rare, varied, never spammy (per-bot and lobby-wide cooldowns), and polite.
  say(id, kind) {
    if (this.match.options.botChat === false) return; // the host turned bot chat off
    const t = this.match.tick, b = this.bots.get(id);
    if (!b || t - (b.lastChat ?? -1e9) < 30 * 45 || t - (this.lastChat ?? -1e9) < 30 * 6) return;
    const lines = BOT_LINES[kind]; if (!lines) return;
    // Chattiness is personal: some bots never talk.
    if (this.rng() > (b.per.chatty ?? 0) * (BOT_CHANCE[kind] || 0.1)) return;
    b.lastChat = t; this.lastChat = t;
    let msg = lines[Math.floor(this.rng() * lines.length)];
    if (this.rng() < 0.4) msg = msg.toLowerCase();
    this.chatQueue.push({ id, msg, wait: Math.round(30 * (0.8 + msg.length * 0.08 + this.rng() * 1.5)) });
  }
}
const BOT_LINES = {
  hello: ['hi', 'hey', 'yo', 'hello!', 'hi all', 'sup'],
  died: ['ugh', 'how', 'so close', 'lag', 'nooo', 'whatt', 'that hurt', 'my yolk'],
  niceShot: ['nice shot', 'ns', 'good shot', 'wow', 'clean'],
  kill: ['gg', 'got em', 'lol', 'sorry!', 'oops'],
  streak: ['im on fire', 'lets goo', 'cant stop me', 'egg-cellent'],
  bye: ['gg all', 'gtg', 'bye'],
};
const BOT_CHANCE = { hello: 0.35, died: 0.12, niceShot: 0.15, kill: 0.06, streak: 0.4, bye: 0.5 };

export const BOT_NAMES = ['NoobBird34', 'Yolkster', 'SirCrackalot', 'EggsterBunny', 'ShellShock99', 'HardBoiledHal', 'Scrambles', 'OmeletteYou', 'SunnySide', 'PoachedPete', 'BenedictArnold', 'CluckNorris', 'EggcellentAim', 'YolkOnYou', 'ShellRaiser', 'Eggward', 'FryDay', 'QuicheMe', 'BeatIt', 'Eggzecutioner', 'TheYolkFather', 'Crackers', 'Deviled', 'Huevos', 'Shelldon', 'Albumen', 'Nesty', 'Frittata', 'Brunch', 'EggSalad'];
