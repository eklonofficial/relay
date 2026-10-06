// One match room, 30 ticks a second (GDD §4–16). The host runs this for real; clients run the same
// code for their own prediction. Deterministic given the same inputs: every random roll comes from a
// seeded LCG, never Math.random.
//
// Players are humans or bots alike: each tick every player supplies { ctrl, yaw, pitch } (bots
// through the same input struct, so they obey identical movement, fire-rate and spread rules).
import { PLAYER, WEAPONS, MELEE, GRENADE, PICKUPS, STREAKS, DAMAGE, DEFAULT_OPTIONS, PRIMARIES, CTRL, TICK_HZ } from './tuning.js?v=muwq6u6m';
import { makeBody, stepBody, movementInput, forward } from './movement.js?v=muwq6u6m';
import { makeHands, stepHands, readyHands, refill, HandEvents, weaponOf, slotOf, grenadeLaunch, lcg } from './combat.js?v=muwq6u6m';
import { makeMode } from './modes.js?v=muwq6u6m';
import { HIT } from '../maps/grid.js?v=muwq6u6m';

const HISTORY = 256;
// Hit-angle damage (GDD §8.2): s = 0.2 + 0.8·dot(−d, n); mult = s^(4 + s^4).
export function angleMultiplier(dot) {
  const s = DAMAGE.angleBase + (1 - DAMAGE.angleBase) * Math.max(0, Math.min(1, dot));
  return Math.pow(s, DAMAGE.angleExp + Math.pow(s, 4));
}
// Ray (o + t·d, |d| = 1) against a sphere: entry t, or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - r * r;
  if (c < 0) return 0; // starting inside
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

export class Match {
  constructor(map, { mode = 'ffa', options = {}, seed = 1 } = {}) {
    this.map = map; this.grid = map.grid;
    this.options = { ...DEFAULT_OPTIONS, ...(map.meta.gravity ? { gravity: map.meta.gravity } : {}), ...options };
    this.tick = 0; this.seed = (seed >>> 0) % 233280 || 1;
    this.players = new Map();
    this.bullets = []; this.rockets = []; this.grenades = [];
    this.events = []; // drained by the owner each tick (render, sound, network, stats)
    this.items = map.items.map((it, i) => ({ id: i, kind: it.kind, x: it.x, y: it.y, z: it.z, active: true, timer: 0 }));
    this.nextObj = 1;
    this.modeId = mode;
    this.mode = makeMode(mode, this);
    this.paused = false;
  }
  rnd() { this.seed = lcg(this.seed); return this.seed / 233280; }
  emit(e) { e.tick = this.tick; this.events.push(e); return e; }

  // ---------------- players ----------------
  addPlayer({ id, name, bot = false, primary = 'yolk47', team = 0, cosmetics = null }) {
    const p = {
      id, name, bot, team, primary, nextPrimary: primary, cosmetics,
      body: makeBody(), hands: null, alive: false, joined: this.tick,
      hp: PLAYER.maxHp, shield: 0, overheal: 0, lastHurt: -999, spawnShield: 0,
      respawnAt: this.tick, pausedAt: -1, pauseCooldownUntil: 0,
      kills: 0, deaths: 0, streak: 0, bestStreak: 0, score: 0, teamSwitches: 0,
      power: { shellBreaker: 0, doubleYolks: 0, quailEgg: 0 },
      input: { ctrl: 0, yaw: 0, pitch: 0 }, prevCtrl: 0, lag: 0,
      hist: new Float32Array(HISTORY * 4), // x, y, z, alive per tick
      killedBy: null, deadAt: -1,
    };
    p.hands = makeHands(primary, (this.seed + id * 7919) % 233280, this.options.disabled);
    if (!team) p.team = this.mode.assignTeam(p);
    this.players.set(id, p);
    this.emit({ t: 'join', id });
    return p;
  }
  removePlayer(id) {
    const p = this.players.get(id); if (!p) return;
    this.mode.onLeave?.(p);
    this.players.delete(id);
    this.emit({ t: 'leave', id });
  }
  setInput(id, ctrl, yaw, pitch) {
    const p = this.players.get(id); if (!p) return;
    p.input.ctrl = ctrl | 0; p.input.yaw = yaw; p.input.pitch = Math.max(-1.5, Math.min(1.5, pitch));
  }
  // Hit-sphere radius and centre height (Quail Egg halves the egg).
  hitR(p) { return PLAYER.hitRadius * (p.power.quailEgg > 0 ? STREAKS.quailEgg.scale : 1); }
  hitY(p) { return PLAYER.hitCenterY * (p.power.quailEgg > 0 ? STREAKS.quailEgg.scale : 1); }
  enemies(a, b) { return a !== b && (a.team === 0 || a.team !== b.team); }

  canRespawn(p) { return !p.alive && this.tick >= p.respawnAt && this.tick >= p.pauseCooldownUntil && this.mode.canSpawn(p); }
  requestRespawn(id) {
    const p = this.players.get(id);
    // Back from a pause inside the grace window: just carry on.
    if (p && p.alive && p.pausedAt >= 0) { p.pausedAt = -1; return true; }
    if (!p || !this.canRespawn(p)) return false;
    this.spawn(p);
    return true;
  }
  // Spawn point farthest from living enemies (GDD §16.2 [DESIGN]).
  pickSpawn(p) {
    const pts = this.mode.spawnPoints(p);
    let best = null, bestD = -1;
    for (const s of pts) {
      let near = Infinity;
      for (const q of this.players.values()) if (q.alive && this.enemies(p, q)) near = Math.min(near, (q.body.x - s.x) ** 2 + (q.body.z - s.z) ** 2 + (q.body.y - s.y) ** 2);
      const score = near + this.rnd() * 4;
      if (score > bestD) { bestD = score; best = s; }
    }
    return best || { x: this.grid.w / 2, y: this.grid.h, z: this.grid.d / 2 };
  }
  spawn(p) {
    const s = this.pickSpawn(p), b = p.body;
    const withoutDying = p.deadAt < p.pausedAt; // a pause, not a death
    Object.assign(b, makeBody(s.x, s.y, s.z));
    b.yaw = s.yaw ?? this.rnd() * Math.PI * 2;
    p.alive = true; p.spawnShield = PLAYER.spawnShield; p.pausedAt = -1;
    if (p.nextPrimary !== p.primary || !p.hands.slots.some(sl => sl.id === p.nextPrimary)) {
      const g = p.hands.grenades;
      p.primary = p.nextPrimary; p.hands = makeHands(p.primary, p.hands.seed, this.options.disabled); p.hands.grenades = g;
    }
    if (!withoutDying) {
      p.hp = PLAYER.maxHp; p.overheal = 0; p.shield = 0;
      refill(p.hands, Math.max(p.hands.grenades, 1));
    } else p.shield = 0; // respawning after a pause keeps nothing but the shield, and loses Hard Boiled
    readyHands(p.hands);
    p.lastHurt = -999;
    this.emit({ t: 'spawn', id: p.id, x: b.x, y: b.y, z: b.z });
  }
  // Leaving the game view (Esc): the egg stays vulnerable for a grace window, then despawns.
  pause(id) {
    const p = this.players.get(id); if (!p || !p.alive || p.pausedAt >= 0) return;
    p.pausedAt = this.tick; p.pauseCooldownUntil = this.tick + PLAYER.pauseCooldownTicks;
    p.input.ctrl = 0;
  }
  setPrimary(id, primary) {
    const p = this.players.get(id);
    if (p && PRIMARIES.includes(primary) && !this.options.disabled.includes(primary)) p.nextPrimary = primary;
  }

  // ---------------- the tick ----------------
  step() {
    if (this.paused) { this.tick++; return; }
    for (const p of this.players.values()) {
      if (p.pausedAt >= 0 && p.alive && this.tick - p.pausedAt >= PLAYER.pauseGraceTicks) { p.alive = false; this.emit({ t: 'despawn', id: p.id }); }
      if (p.alive) this.stepPlayer(p, false);
      this.record(p);
    }
    this.stepBullets();
    this.stepRockets();
    this.stepGrenades();
    this.stepItems();
    this.mode.step();
    this.tick++;
  }
  // One player's tick: movement, hands and what they cause. A guest's prediction runs this for its own
  // egg with predict = true: everything it sees immediately (its movement, its shots leaving the gun)
  // happens, but nothing that only the host may decide (damage, pickups, deaths, objects in the world).
  stepPlayer(p, predict) {
    const b = p.body, h = p.hands, ctrl = p.pausedAt >= 0 ? 0 : p.input.ctrl;
    b.yaw = p.input.yaw; b.pitch = p.input.pitch;
    if (p.spawnShield > 0) {
      p.spawnShield = Math.max(0, p.spawnShield - 2);
      if (movementInput(ctrl) || ((ctrl & CTRL.grenade) && h.grenades > 0)) p.spawnShield = 0;
    }
    const prev = p.prevCtrl;
    const moveEv = stepBody(this.grid, b, ctrl, { gravity: this.options.gravity, ads: h.ads });
    const ev = stepHands(h, b, ctrl, prev, p.spawnShield > 0, HANDS);
    p.prevCtrl = ctrl;
    if (moveEv === 'fall') { if (!predict) this.kill(p, null, 'fall'); return; }
    if (moveEv) this.emit({ t: moveEv, id: p.id });
    if (ev.broke) p.spawnShield = 0;
    if (ev.fired) this.emit({ t: 'fire', id: p.id, w: slotOf(h).id, n: ev.shots.length });
    for (const s of ev.shots) {
      if (!predict) this.addShot(p, s);
      else if (!WEAPONS[s.weapon].rocket) {
        // The local tracer, stopped by the first wall like the real bullet.
        const range = this.grid.raycast(s.x, s.y, s.z, s.dx, s.dy, s.dz, WEAPONS[s.weapon].range, HIT) ? HIT.t : WEAPONS[s.weapon].range;
        this.emit({ t: 'shot', id: p.id, w: s.weapon, x: s.x, y: s.y, z: s.z, dx: s.dx, dy: s.dy, dz: s.dz, len: range, tracer: s.tracer, wall: null, predicted: true });
      }
    }
    if (ev.dry) this.emit({ t: 'dry', id: p.id });
    if (ev.reloadDone) this.emit({ t: 'reloaded', id: p.id, long: h.reloadWasLong });
    if (ev.reloadStart) this.emit({ t: 'reload', id: p.id, w: slotOf(h).id, long: h.reload === weaponOf(h).reload[1] && weaponOf(h).reload[0] !== weaponOf(h).reload[1] });
    if (ev.swapped) this.emit({ t: 'swap', id: p.id, w: slotOf(h).id });
    if (ev.meleeSwing) this.emit({ t: 'swing', id: p.id });
    if (ev.chargeStart) this.emit({ t: 'charge', id: p.id });
    if (predict) return;
    if (ev.meleeHit) this.melee(p);
    if (ev.thrown !== null) this.throwGrenade(p, ev.thrown);
    this.vitals(p);
    this.pickups(p);
  }
  record(p) {
    const i = (this.tick % HISTORY) * 4;
    p.hist[i] = p.body.x; p.hist[i + 1] = p.body.y; p.hist[i + 2] = p.body.z; p.hist[i + 3] = p.alive ? 1 : 0;
  }
  // Where a player was `ago` ticks back (lag compensation, ≤ 200 ms).
  past(p, ago, out) {
    ago = Math.max(0, Math.min(6, ago | 0));
    if (ago === 0 || this.tick - ago < p.joined) { out[0] = p.body.x; out[1] = p.body.y; out[2] = p.body.z; out[3] = p.alive ? 1 : 0; return out; }
    const i = (((this.tick - ago) % HISTORY + HISTORY) % HISTORY) * 4;
    out[0] = p.hist[i]; out[1] = p.hist[i + 1]; out[2] = p.hist[i + 2]; out[3] = p.alive && p.hist[i + 3] ? 1 : 0; return out;
  }

  vitals(p) {
    const regen = this.options.regen;
    if (p.overheal > 0) { p.hp = Math.max(PLAYER.maxHp, p.hp - STREAKS.overheal.decayPerTick); if (p.hp <= PLAYER.maxHp) p.overheal = 0; }
    else if (p.hp < PLAYER.maxHp && this.tick - p.lastHurt >= PLAYER.regenDelayTicks) p.hp = Math.min(PLAYER.maxHp, p.hp + PLAYER.regenPerTick * regen);
    for (const k of ['shellBreaker', 'doubleYolks', 'quailEgg']) if (p.power[k] > 0 && --p.power[k] === 0) this.emit({ t: 'powerEnd', id: p.id, k });
  }

  // ---------------- shooting ----------------
  addShot(p, s) {
    const w = WEAPONS[s.weapon];
    if (w.rocket) {
      this.rockets.push({ id: this.nextObj++, owner: p.id, team: p.team, x: s.x, y: s.y, z: s.z, dx: s.dx, dy: s.dy, dz: s.dz, travelled: 0, lag: p.lag });
      this.emit({ t: 'rocket', id: p.id, x: s.x, y: s.y, z: s.z, dx: s.dx, dy: s.dy, dz: s.dz });
      return;
    }
    // Bullets stop at the first wall (and leave an impact there).
    let range = w.range, wall = null;
    if (this.grid.raycast(s.x, s.y, s.z, s.dx, s.dy, s.dz, w.range, HIT)) { range = HIT.t; wall = { x: HIT.x, y: HIT.y, z: HIT.z, nx: HIT.nx, ny: HIT.ny, nz: HIT.nz }; }
    const mult = p.power.shellBreaker > 0 ? STREAKS.shellBreaker.bulletMult : 1;
    const bullet = { owner: p.id, team: p.team, x: s.x, y: s.y, z: s.z, dx: s.dx, dy: s.dy, dz: s.dz, left: range, w: s.weapon, mult, wall, lag: p.lag, tracer: s.tracer };
    this.emit({ t: 'shot', id: p.id, w: s.weapon, x: s.x, y: s.y, z: s.z, dx: s.dx, dy: s.dy, dz: s.dz, len: range, tracer: s.tracer, wall });
    this.bullets.push(bullet);
    this.moveBullet(bullet); // it flies on its first tick
  }
  stepBullets() {
    for (let i = this.bullets.length - 1; i >= 0; i--) if (this.bullets[i].dead || this.moveBullet(this.bullets[i])) this.bullets.splice(i, 1);
  }
  // Returns true when the bullet is finished.
  moveBullet(bl) {
    if (bl.dead) return true;
    const w = WEAPONS[bl.w], seg = Math.min(w.vel, bl.left);
    let best = null, bestT = Infinity;
    for (const q of this.players.values()) {
      if (q.id === bl.owner || !this.enemiesById(bl, q)) continue;
      const pos = this.past(q, bl.lag, POS);
      if (!pos[3]) continue;
      const r = this.hitR(q), cy = pos[1] + this.hitY(q);
      const t = raySphere(bl.x, bl.y, bl.z, bl.dx, bl.dy, bl.dz, pos[0], cy, pos[2], r);
      if (t >= 0 && t <= seg && t < bestT) { bestT = t; best = { q, cx: pos[0], cy, cz: pos[2], r }; }
    }
    if (best) {
      const hx = bl.x + bl.dx * bestT, hy = bl.y + bl.dy * bestT, hz = bl.z + bl.dz * bestT;
      const nx = (hx - best.cx) / best.r, ny = (hy - best.cy) / best.r, nz = (hz - best.cz) / best.r;
      const dot = -(bl.dx * nx + bl.dy * ny + bl.dz * nz);
      const dmg = w.dmg * angleMultiplier(dot) * bl.mult * this.options.damage;
      const shooter = this.players.get(bl.owner);
      this.damage(best.q, dmg, shooter, bl.w, { x: hx, y: hy, z: hz, dx: bl.dx, dy: bl.dy, dz: bl.dz });
      bl.dead = true;
      return true;
    }
    bl.x += bl.dx * seg; bl.y += bl.dy * seg; bl.z += bl.dz * seg; bl.left -= seg;
    if (bl.left <= 1e-6) { if (bl.wall) this.emit({ t: 'impact', ...bl.wall, w: bl.w, by: bl.owner }); return true; }
    return false;
  }
  enemiesById(obj, q) { return obj.team === 0 || q.team !== obj.team; }

  stepRockets() {
    const w = WEAPONS.yolkzooka;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      const seg = Math.min(w.vel, w.range - r.travelled);
      let hitT = Infinity, victim = null;
      for (const q of this.players.values()) {
        if (q.id === r.owner || !this.enemiesById(r, q)) continue;
        const pos = this.past(q, r.lag, POS); if (!pos[3]) continue;
        const t = raySphere(r.x, r.y, r.z, r.dx, r.dy, r.dz, pos[0], pos[1] + this.hitY(q), pos[2], this.hitR(q));
        if (t >= 0 && t <= seg && t < hitT) { hitT = t; victim = q; }
      }
      const wallHit = this.grid.raycast(r.x, r.y, r.z, r.dx, r.dy, r.dz, seg, HIT);
      const wallT = wallHit ? HIT.t : Infinity;
      const t = Math.min(hitT, wallT);
      if (t <= seg) {
        const x = r.x + r.dx * t, y = r.y + r.dy * t, z = r.z + r.dz * t;
        const armed = r.travelled + t >= w.minRange;
        const owner = this.players.get(r.owner);
        if (!armed) {
          if (hitT <= wallT && victim) this.damage(victim, w.dudDmg * this.options.damage, owner, 'yolkzooka', { x, y, z, dx: r.dx, dy: r.dy, dz: r.dz });
          this.emit({ t: 'dud', x, y, z });
        } else {
          if (hitT <= wallT && victim) this.damage(victim, w.directDmg * this.options.damage, owner, 'yolkzooka', { x, y, z, dx: r.dx, dy: r.dy, dz: r.dz });
          const off = wallT < hitT ? 0.05 : 0;
          this.explode(x + HIT.nx * off, y + HIT.ny * off, z + HIT.nz * off, w.dmg, w.radius, owner, 'yolkzooka', victim);
        }
        this.rockets.splice(i, 1); continue;
      }
      r.x += r.dx * seg; r.y += r.dy * seg; r.z += r.dz * seg; r.travelled += seg;
      if (r.travelled >= w.range - 1e-6) { this.explode(r.x, r.y, r.z, w.dmg, w.radius, this.players.get(r.owner), 'yolkzooka', null); this.rockets.splice(i, 1); }
    }
  }
  // Linear falloff to 0 at the edge; walls shield; self-damage yes, teammates no.
  explode(x, y, z, dmg, radius, owner, weapon, skip) {
    this.emit({ t: 'boom', x, y, z, r: radius, w: weapon, team: owner ? owner.team : 0 });
    const victims = [];
    for (const q of this.players.values()) {
      if (!q.alive || q === skip) continue;
      if (owner && q !== owner && !this.enemies(owner, q)) continue;
      const cx = q.body.x, cy = q.body.y + this.hitY(q), cz = q.body.z;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d >= radius) continue;
      if (!this.grid.visible(x, y, z, cx, cy, cz)) continue;
      const amount = dmg * (1 - d / radius) * this.options.damage;
      victims.push(q);
      this.damage(q, amount, owner, weapon, { x, y, z, dx: cx - x, dy: cy - y, dz: cz - z, splash: true });
    }
    return victims;
  }

  // ---------------- melee & grenades ----------------
  melee(p) {
    const b = p.body, f = forward(b.yaw, b.pitch);
    const ox = b.x - f[0] * MELEE.back, oy = b.y + PLAYER.eyeY - f[1] * MELEE.back, oz = b.z - f[2] * MELEE.back;
    const dmg = (p.power.shellBreaker > 0 ? MELEE.shellBreakerDmg : MELEE.dmg) * this.options.damage;
    let any = false;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || !this.enemies(p, q)) continue;
      const pos = this.past(q, p.lag, POS); if (!pos[3]) continue;
      // The ray starting inside the target misses (keep the quirk, GDD §10).
      const t = raySphere(ox, oy, oz, f[0], f[1], f[2], pos[0], pos[1] + this.hitY(q), pos[2], MELEE.radius);
      if (t > 0 && t <= MELEE.reach) { any = true; this.damage(q, dmg, p, 'melee', { x: ox + f[0] * t, y: oy + f[1] * t, z: oz + f[2] * t, dx: f[0], dy: f[1], dz: f[2] }); }
    }
    this.emit({ t: 'meleeHit', id: p.id, hit: any });
  }
  throwGrenade(p, power) {
    const l = grenadeLaunch(p.body, power);
    const g = { id: this.nextObj++, owner: p.id, team: p.team, ...l, fuse: GRENADE.fuse, rest: false };
    this.grenades.push(g);
    this.emit({ t: 'throw', id: p.id, g: g.id, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz });
  }
  stepGrenades() {
    const grav = 0.012 * this.options.gravity, r = GRENADE.radiusBody;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (--g.fuse <= 0) {
        this.explode(g.x, g.y, g.z, GRENADE.dmg, GRENADE.radius, this.players.get(g.owner), 'grenade', null);
        this.grenades.splice(i, 1); continue;
      }
      if (g.rest) continue;
      g.vy = Math.max(g.vy - grav, -0.29);
      g.vx *= GRENADE.drag; g.vz *= GRENADE.drag;
      // Sub-step so a fast grenade doesn't skip thin walls.
      const n = Math.max(1, Math.ceil(Math.hypot(g.vx, g.vy, g.vz) / 0.1));
      for (let s = 0; s < n; s++) {
        g.x += g.vx / n; g.y += g.vy / n; g.z += g.vz / n;
        this.grid.overlaps(g.x, g.y, g.z, r, (nx, ny, nz, depth) => {
          g.x += nx * depth; g.y += ny * depth; g.z += nz * depth;
          const vn = g.vx * nx + g.vy * ny + g.vz * nz;
          if (vn < 0) {
            g.vx -= (1 + GRENADE.restitution) * vn * nx; g.vy -= (1 + GRENADE.restitution) * vn * ny; g.vz -= (1 + GRENADE.restitution) * vn * nz;
            g.vx *= GRENADE.tangential; g.vz *= GRENADE.tangential;
            if (-vn > 0.03) this.emit({ t: 'bounce', g: g.id, x: g.x, y: g.y, z: g.z });
          }
          if (ny > 0.7 && Math.hypot(g.vx, g.vy, g.vz) < GRENADE.restSpeed) { g.vx = g.vy = g.vz = 0; g.rest = true; }
          return false;
        });
      }
      g.x = Math.max(0.05, Math.min(this.grid.w - 0.05, g.x)); g.z = Math.max(0.05, Math.min(this.grid.d - 0.05, g.z));
      if (g.y < PLAYER.killPlaneY) this.grenades.splice(i, 1);
    }
  }

  // ---------------- damage, death, streaks ----------------
  damage(q, amount, from, weapon, at) {
    if (!q.alive || amount <= 0) return;
    if (q.spawnShield > 0) { this.emit({ t: 'shielded', id: q.id }); return; }
    q.lastHurt = this.tick;
    let left = amount;
    if (q.shield > 0) { const take = Math.min(q.shield, left); q.shield -= take; left -= take; if (q.shield <= 0) this.emit({ t: 'shieldBreak', id: q.id }); }
    const before = q.hp;
    q.hp = Math.max(0, Math.floor(q.hp - left));
    this.emit({ t: 'hit', id: q.id, by: from ? from.id : -1, w: weapon, dmg: amount, hp: q.hp, x: at.x, y: at.y, z: at.z, dx: at.dx, dy: at.dy, dz: at.dz });
    if (from && from !== q) this.mode.onDamage?.(from, q, Math.min(before, left));
    if (q.hp <= 0) this.kill(q, from, weapon);
  }
  kill(q, from, weapon) {
    if (!q.alive) return;
    q.alive = false; q.hp = 0; q.shield = 0; q.overheal = 0; q.deaths++; q.deadAt = this.tick;
    q.power.shellBreaker = 0; q.power.doubleYolks = 0; q.power.quailEgg = 0;
    q.respawnAt = this.tick + PLAYER.respawnTicks; q.killedBy = from && from !== q ? from.id : null;
    q.hands.charging = false;
    const suicide = !from || from === q;
    this.emit({ t: 'kill', id: q.id, by: suicide ? -1 : from.id, w: weapon, x: q.body.x, y: q.body.y, z: q.body.z, streak: q.streak });
    q.streak = 0;
    if (!suicide) {
      from.kills++; from.streak++; from.bestStreak = Math.max(from.bestStreak, from.streak); from.score = from.streak;
      if (from.power.shellBreaker > 0) from.power.shellBreaker = Math.min(STREAKS.shellBreaker.cap, from.power.shellBreaker + STREAKS.shellBreaker.perKill);
      if (from.streak % STREAKS.every === 0) this.grantPower(from);
      this.mode.onKill(from, q, weapon);
    }
    q.score = 0;
  }
  grantPower(p) {
    const n = p.streak / STREAKS.every, list = STREAKS.order;
    const k = n <= list.length ? list[n - 1] : list[Math.floor(this.rnd() * list.length)];
    switch (k) {
      case 'hardBoiled': p.shield = STREAKS.hardBoiledHp; break;
      case 'shellBreaker': p.power.shellBreaker = STREAKS.shellBreaker.ticks; break;
      case 'restock': refill(p.hands, GRENADE.max); break;
      case 'overheal': p.hp = STREAKS.overheal.hp; p.overheal = 1; break;
      case 'doubleYolks': p.power.doubleYolks = STREAKS.doubleYolks.ticks; break;
      case 'quailEgg': p.power.quailEgg = STREAKS.quailEgg.ticks; break;
    }
    this.emit({ t: 'power', id: p.id, k, streak: p.streak });
  }

  // ---------------- pickups (GDD §12) ----------------
  pickups(p) {
    const h = p.hands, R2 = PICKUPS.radius * PICKUPS.radius;
    for (const it of this.items) {
      if (!it.active) continue;
      const dx = it.x - p.body.x, dy = it.y - (p.body.y + 0.3), dz = it.z - p.body.z;
      if (dx * dx + dz * dz > R2 || Math.abs(dy) > 0.8) continue;
      if (it.kind === 'ammo') {
        const s = slotOf(h), w = WEAPONS[s.id];
        if (s.store >= w.store) continue;
        s.store = Math.min(w.store, s.store + w.pickup);
      } else {
        if (h.grenades >= GRENADE.max) continue;
        h.grenades++;
      }
      it.active = false;
      const base = it.kind === 'ammo' ? PICKUPS.ammoRespawnTicks : PICKUPS.grenadeRespawnTicks;
      it.timer = Math.round(base * (1 + (this.rnd() * 2 - 1) * PICKUPS.jitter));
      this.emit({ t: 'collect', id: p.id, item: it.id, kind: it.kind });
    }
  }
  stepItems() {
    for (const it of this.items) if (!it.active && --it.timer <= 0) { it.active = true; this.emit({ t: 'item', item: it.id }); }
  }
  // Ranked players (score = current streak, GDD §13.1).
  standings() { return [...this.players.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || a.id - b.id); }
}
const POS = [0, 0, 0, 0];
const HANDS = new HandEvents();
export { TICK_HZ };
