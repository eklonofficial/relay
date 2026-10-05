// Bots that play like a person at a keyboard: they only know what they could see or hear, react
// after a human delay, turn with a limited, damped mouse hand, lead moving targets by the weapon's
// bullet speed (bullets are projectiles), tap-fire to let bloom recover, stop to snipe, strafe and
// jump in fights, fall back to cover to reload or heal, check corners where enemies were last seen,
// throw grenades solved with the real grenade physics, collect ammo, and play the objective.
//
// Bots drive the match through the same input struct as humans (control bits + yaw/pitch), so the
// simulation holds them to identical movement, fire-rate, spread and damage rules. Difficulty only
// changes human limits (reaction, aim error, turn speed, leading, decision noise), never knowledge.
import { CTRL, WEAPONS, PLAYER, GRENADE, PRIMARIES, TICK } from '../sim/tuning.js?v=muunn3ao';
import { currentSpread, weaponOf, slotOf } from '../sim/combat.js?v=muunn3ao';
import { forward } from '../sim/movement.js?v=muunn3ao';
import { EDGE } from './nav.js?v=muunn3ao';

export const DIFFICULTY = {
  easy: { reaction: 0.6, aimErr: 0.11, turn: 4.5, settle: 6, track: 0.9, lead: 0.3, fovMul: 0.85, discipline: 0.3, strafe: 0.35, jump: 0.02, nade: 0.15, cover: 0.3, hearing: 0.6, flinch: 1.6 },
  normal: { reaction: 0.36, aimErr: 0.06, turn: 7.5, settle: 9, track: 1.6, lead: 0.7, fovMul: 1, discipline: 0.65, strafe: 0.7, jump: 0.05, nade: 0.45, cover: 0.65, hearing: 0.85, flinch: 1.2 },
  hard: { reaction: 0.24, aimErr: 0.035, turn: 11, settle: 13, track: 2.5, lead: 0.9, fovMul: 1.1, discipline: 0.85, strafe: 0.9, jump: 0.08, nade: 0.7, cover: 0.85, hearing: 1, flinch: 0.9 },
  expert: { reaction: 0.16, aimErr: 0.02, turn: 16, settle: 18, track: 3.6, lead: 1, fovMul: 1.15, discipline: 1, strafe: 1, jump: 0.1, nade: 0.9, cover: 1, hearing: 1, flinch: 0.7 },
};
// Where each weapon likes to fight from (units).
const RANGE = { yolk47: [4, 12], doubleYolker: [0, 4.5], cageFree: [10, 30], yolkzooka: [5, 16], beater: [0, 8], poacher: [14, 45], triBoil: [5, 14], peck9mm: [0, 10] };

const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export class Bot {
  constructor(manager, player, difficulty = 'normal', personality = {}) {
    this.mgr = manager; this.m = manager.match; this.p = player; this.nav = manager.nav;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.rnd = manager.rng;
    this.per = { aggression: 0.3 + this.rnd() * 0.7, patience: this.rnd(), ...personality };
    this.mem = new Map(); // enemy id → { x, y, z, vx, vy, vz, tick, seen, react, firstSeen, hp }
    this.target = null; this.path = null; this.pi = 0; this.goal = null;
    this.yaw = player.body.yaw; this.pitch = 0; this.yawV = 0; this.pitchV = 0;
    this.errYaw = 0; this.errPitch = 0;
    this.strafe = 1; this.strafeT = 0; this.ctrl = 0; this.prevFire = false;
    this.thinkT = (player.id * 7) % 9; this.senseT = player.id % 3;
    this.stuckT = 0; this.lastPos = { x: 0, z: 0 }; this.progressT = 0;
    this.nadeCooldown = 0; this.nadePlan = null; this.burst = 0; this.burstRest = 0;
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
  // Every ~0.3 s: where to go and why.
  think() {
    const m = this.m, me = this.p, h = me.hands, w = weaponOf(h), s = slotOf(h), b = me.body;
    this.pickTarget();
    const tmem = this.target !== null ? this.mem.get(this.target) : null;
    const seeing = this.target !== null && this.visible(this.target);
    const dist = tmem ? Math.hypot(tmem.x - b.x, tmem.z - b.z) : Infinity;
    const [near, far] = RANGE[s.id] || [3, 12];
    const lowHp = me.hp + me.shield < 40 && (tmem?.hp ?? 100) > me.hp;
    const reloading = h.reload > 0 || (s.mag === 0 && s.store > 0);
    // 1. Fall back to cover: hurt and losing, or reloading with someone close.
    if (tmem && seeing && this.rnd() < this.d.cover && ((lowHp && dist < far + 6) || (reloading && dist < 12 && s.id !== 'doubleYolker'))) {
      const c = this.findCover(tmem);
      if (c !== null) { this.setGoal({ k: 'cover', node: c, until: m.tick + 75 }); return; }
    }
    if (this.goal?.k === 'cover' && m.tick < this.goal.until && (h.reload > 0 || me.hp < 60)) return;
    // 2. Fight: keep to the weapon's preferred range.
    if (tmem && seeing) {
      if (dist > far) this.setGoal({ k: 'close', node: this.nav.nearest(tmem.x, tmem.y, tmem.z), target: this.target });
      else if (dist < near && s.id !== 'doubleYolker' && s.id !== 'beater') this.setGoal({ k: 'backoff', node: this.retreatNode(tmem, near + 2), target: this.target });
      else this.setGoal({ k: 'hold', node: null, target: this.target });
      return;
    }
    // 3. Hunt the last known position (and pre-aim there: checking the corner).
    if (tmem && m.tick - tmem.tick < 150 && this.per.aggression > 0.25 && !this.objectiveUrgent()) {
      this.setGoal({ k: 'hunt', node: this.nav.nearest(tmem.x, tmem.y, tmem.z), target: this.target });
      return;
    }
    // 4. Restock if short.
    const item = this.wantItem();
    if (item) { this.setGoal({ k: 'item', node: item.node, item: item.id }); return; }
    // 5. Objective, else roam to likely fights.
    const obj = this.objective();
    if (obj) { this.setGoal(obj); return; }
    if (!this.goal || this.goal.k !== 'roam' || this.arrived()) this.setGoal({ k: 'roam', node: this.roamNode() });
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
      for (const q of this.m.players.values()) if (q.alive && this.m.enemies(this.p, q)) s += Math.min(20, Math.hypot(q.body.x - n.x, q.body.z - n.z)) * 0.2;
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
      for (const q of this.m.players.values()) {
        if (q === this.p || !q.alive) continue;
        const d = Math.hypot(q.body.x - n.x, q.body.z - n.z);
        if (this.m.enemies(this.p, q)) s += this.per.aggression * Math.max(0, 15 - d) * 0.15;
        else s -= Math.max(0, 6 - d) * 0.5; // spread across lanes
      }
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
    const avoid = g.k === 'hunt' || g.k === 'close' ? null : n => this.danger(n);
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
      wantYaw = aim.yaw + this.errYaw; wantPitch = aim.pitch + this.errPitch; aimingAt = aim;
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
    this.turn(wantYaw, wantPitch);

    // --- movement ---
    const move = this.steer();
    let mx = move.x, mz = move.z;
    const inFight = seeing && tq;
    if (inFight) {
      const dist = Math.hypot(tq.body.x - b.x, tq.body.z - b.z);
      const sniping = (s.id === 'poacher' || s.id === 'cageFree') && dist > 9;
      if (sniping && h.reload === 0) { mx = 0; mz = 0; } // stand still to shoot (GDD tip)
      else if (this.rnd() < this.d.strafe || this.strafeT > 0) {
        // Strafe across their line of fire, changing direction at irregular intervals.
        if (--this.strafeT <= 0) { this.strafe = this.rnd() < 0.5 ? -1 : 1; this.strafeT = Math.round((0.18 + this.rnd() * 0.5) / TICK); }
        const f = forward(b.yaw), rx = -f[2], rz = f[0];
        const k = this.goal?.k === 'hold' ? 1 : 0.7;
        mx = mx * (1 - k) + rx * this.strafe * k; mz = mz * (1 - k) + rz * this.strafe * k;
        if (b.onGround > 0 && this.rnd() < this.d.jump * (s.id === 'doubleYolker' ? 2 : 1) && !sniping) ctrl |= CTRL.jump;
      }
    }
    ctrl |= this.moveBits(mx, mz, b.yaw);
    if (move.jump) ctrl |= CTRL.jump;
    if (move.ladder) { ctrl = (ctrl & ~(CTRL.left | CTRL.right | CTRL.down)) | CTRL.up; }

    // --- weapons ---
    ctrl |= this.weapons(seeing, tq, tmem, aimingAt);
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
    const dy = wrap(wy - this.yaw), dp = wp - this.pitch, max = this.d.turn * TICK;
    const k = 1 - Math.exp(-this.d.settle * TICK);
    this.yaw = wrap(this.yaw + Math.max(-max, Math.min(max, dy * k)));
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + Math.max(-max, Math.min(max, dp * k))));
  }
  lookAhead() {
    const b = this.body;
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
    const reached = e?.kind === EDGE.ladder ? (Math.abs(n.y - b.y) < 0.3 && d < 0.6) : (d < 0.35 && Math.abs(n.y - b.y) < 0.6);
    if (reached) { this.pi++; this.progressT = 0; return this.steer(); }
    if (e?.kind === EDGE.ladder && !e.down) {
      // Face the wall and climb.
      const lx = e.lx + 0.5 - b.x, lz = e.lz + 0.5 - b.z;
      if (b.climbing || Math.hypot(lx, lz) < 0.6) { this.yaw = yawTo(e.fx, e.fz); out.ladder = true; out.x = e.fx; out.z = e.fz; return out; }
      out.x = lx; out.z = lz; return out;
    }
    if (e?.kind === EDGE.pad && b.onGround === 0) { const f = forward(e.yaw); out.x = f[0]; out.z = f[2]; return out; }
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
    const ads = (w.scoped && !w.rocket && dist > 7) || (dist > far * 0.8 && w.ads < 0.7);
    if (ads) c |= CTRL.scope;
    if (s.id === 'doubleYolker' && dist > 6.5) return c;
    if (w.rocket && dist < w.minRange + 0.6) { return (h.slots.length > 1 && h.swap === 0) ? CTRL.swap : c; }
    if (dist > w.range * 0.98) return c;
    if (ads && h.ads === false && w.scoped) return c; // wait for the scope to settle
    // On target? Compare the aim's angular error with the egg's angular size.
    const offYaw = Math.abs(wrap(this.yaw - aim.yaw)), offPitch = Math.abs(this.pitch - aim.pitch);
    const size = Math.atan2(m.hitR(q), dist);
    const off = Math.hypot(offYaw, offPitch);
    const spread = currentSpread(h, w);
    const tolerance = w.pellets ? size * 3 + 0.08 : size * (1.1 + (1 - this.d.discipline) * 1.5);
    if (off > tolerance) { this.burst = 0; return c; }
    // Snipers wait until they've actually stopped.
    if ((s.id === 'poacher' || s.id === 'cageFree') && dist > 9 && Math.hypot(b.vx, b.vz) > 0.012 * (2 - this.d.discipline)) return c;
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
    this.match = match; this.nav = nav; this.bots = new Map();
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
        case 'kill': {
          const bot = this.bots.get(e.id); if (bot) bot.mem.clear();
          for (const b of this.bots.values()) { const mem = b.mem.get(e.id); if (mem) mem.dead = true; if (b.target === e.id) b.target = null; }
          break;
        }
      }
    }
  }
  tick() { for (const b of this.bots.values()) b.tick(); }
}

export const BOT_NAMES = ['NoobBird34', 'Yolkster', 'SirCrackalot', 'EggsterBunny', 'ShellShock99', 'HardBoiledHal', 'Scrambles', 'OmeletteYou', 'SunnySide', 'PoachedPete', 'BenedictArnold', 'CluckNorris', 'EggcellentAim', 'YolkOnYou', 'ShellRaiser', 'Eggward', 'FryDay', 'QuicheMe', 'BeatIt', 'Eggzecutioner', 'TheYolkFather', 'Crackers', 'Deviled', 'Huevos', 'Shelldon', 'Albumen', 'Nesty', 'Frittata', 'Brunch', 'EggSalad'];
