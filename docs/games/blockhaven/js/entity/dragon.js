// The Ender Dragon, after the original's phase machine: it circles the island on a ring of path
// nodes, breaks off to strafe a player with fireballs or charge at them, lands on the exit portal
// to scan, roar and breathe, then takes off again. End crystals heal it through a beam; hits on
// its head do full damage, hits on its body a quarter. Dying, it rises in light for ten seconds,
// sheds its experience and leaves the exit portal behind.
import { B, BLOCKS } from '../data/blocks.js?v=mush3u38';
import { UNLOADED } from '../world/world.js?v=mush3u38';
import { Projectile } from './objects.js?v=mush3u38';
import { AreaCloud } from './cloud.js?v=mush3u38';

const rnd = (a, b) => a + Math.random() * (b - a);
const rint = n => Math.floor(Math.random() * n);
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SITTING = new Set(['scanning', 'roar', 'flame']);
// Blocks the dragon can't break (the original's dragon_immune tag).
const IMMUNE = new Set([B.AIR, B.END_STONE, B.OBSIDIAN, B.BEDROCK, B.END_PORTAL, B.END_PORTAL_FRAME, B.WATER, B.LAVA, B.DRAGON_EGG]);

export function dragonInit(m) {
  m.phase = 'holding'; m.phaseT = 0; m.node = -1; m.clockwise = Math.random() < 0.5;
  m.flames = 0; m.sitDamage = 0; m.headTurn = 0; m.perch = 0; m.charge = 0; m.hitCd = new Map();
  m.crystal = null; m.crystalT = 0; m.healT = 0;
}
export const dragonSitting = m => SITTING.has(m.phase);

// Where the dragon lands: the top of the exit-portal podium at the island's centre.
function podiumY(g) {
  const w = g.world;
  let y = 0;
  for (const [x, z] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) y = Math.max(y, w.heightAt(x, z));
  return (y > 0 && y < 200 ? y : 62) + 1;
}
// Path nodes: 12 on an outer ring, 8 high above the pillars, 4 close in.
function node(g, i) {
  const base = podiumY(g);
  if (i < 12) { const a = i / 12 * Math.PI * 2; return [Math.cos(a) * 60, base + 20 + (i % 3) * 6, Math.sin(a) * 60]; }
  if (i < 20) { const a = (i - 12) / 8 * Math.PI * 2 + 0.2; return [Math.cos(a) * 40, Math.max(base + 30, 112), Math.sin(a) * 40]; }
  const a = (i - 20) / 4 * Math.PI * 2 + 0.4; return [Math.cos(a) * 20, base + 14, Math.sin(a) * 20];
}
function nearestOuter(m) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < 12; i++) { const n = node(m.game, i), d = Math.hypot(n[0] - m.pos[0], n[2] - m.pos[2]); if (d < bd) { bd = d; best = i; } }
  return best;
}
function crystals(g) { return g.entities.list.filter(e => e.type === 'end_crystal' && !e.dead); }

// Steering like a big glider: the heading turns at a limited rate towards the goal.
function fly(m, goal, speed, turn, dt) {
  const dx = goal[0] - m.pos[0], dy = goal[1] - m.pos[1], dz = goal[2] - m.pos[2];
  const want = Math.atan2(-dx, -dz);
  m.yaw += clamp(wrap(want - m.yaw), -turn * dt, turn * dt);
  const k = Math.min(1, dt * 3);
  m.vel[0] += (-Math.sin(m.yaw) * speed - m.vel[0]) * k;
  m.vel[2] += (-Math.cos(m.yaw) * speed - m.vel[2]) * k;
  m.vel[1] += (clamp(dy * 1.2, -speed * 0.6, speed * 0.6) - m.vel[1]) * k;
  m.bodyYaw = m.yaw;
  return Math.hypot(dx, dy, dz);
}
function setPhase(m, phase) {
  m.phase = phase; m.phaseT = 0; m.charge = 0;
  if (phase === 'scanning' && m.flames === 0) m.sitDamage = 0;
  if (phase === 'holding') m.node = -1;
}

// World position of the head (follows the neck pose in pose()).
export function dragonHead(m) {
  const t = m.headTurn || 0, p = m.perch || 0;
  const s = 48, hx = -Math.sin(t) * (s + 14), hz = -32 - Math.cos(t) * (s + 14), hy = 34 - p * 16;
  const c = Math.cos(m.bodyYaw), sn = Math.sin(m.bodyYaw), sc = (m.scale || 1) / 16;
  return [m.pos[0] + (hx * c + hz * sn) * sc, m.pos[1] + hy * sc, m.pos[2] + (-hx * sn + hz * c) * sc];
}
function forwardOf(m) { return [-Math.sin(m.bodyYaw), 0, -Math.cos(m.bodyYaw)]; }

function shootFireball(m, t) {
  const g = m.game, h = dragonHead(m), tp = [t.pos[0], t.pos[1] + 0.8, t.pos[2]];
  const d = [tp[0] - h[0], tp[1] - h[1], tp[2] - h[2]], n = Math.hypot(...d) || 1;
  g.entities.add(new Projectile(g, 'dragon_fireball', h[0], h[1], h[2], d.map(v => v / n * 18), m));
  g.sound.play('fireball', h, 1);
}

export function dragonAI(m, dt) {
  const g = m.game, t = m.focus, tp = t.pos;
  const canTarget = m.playerTargetable(t);
  m.phaseT += dt;
  checkCrystals(m, dt);
  m.perch += ((SITTING.has(m.phase) ? 1 : 0) - m.perch) * Math.min(1, dt * 3);
  const want = SITTING.has(m.phase) && canTarget ? clamp(wrap(Math.atan2(-(tp[0] - m.pos[0]), -(tp[2] - m.pos[2])) - m.bodyYaw), -1.1, 1.1) : 0;
  m.headTurn += (want - m.headTurn) * Math.min(1, dt * 4);
  const distP = Math.hypot(tp[0] - m.pos[0], tp[1] - m.pos[1], tp[2] - m.pos[2]);
  const pod = podiumY(g);

  switch (m.phase) {
    case 'holding': {
      if (m.node < 0) m.node = nearestOuter(m);
      const goal = node(g, m.node);
      if (fly(m, goal, 14, 1.4, dt) < 8) {
        // Choosing what to do next, with the original's odds: fewer crystals mean more landings.
        const n = crystals(g).length;
        if (rint(n + 3) === 0) { setPhase(m, 'landing_approach'); break; }
        const d0 = Math.abs(Math.floor((distP * distP) / 512));
        if (canTarget && distP < 150 && (rint(d0 + 2) === 0 || rint(n + 2) === 0)) { setPhase(m, 'strafe'); break; }
        if (rint(8) === 0) m.clockwise = !m.clockwise;
        if (m.node < 12 && rint(5) === 0) m.node = 12 + ((Math.round(m.node * 8 / 12) + (m.clockwise ? 1 : 7)) % 8);
        else if (m.node >= 12 && m.node < 20 && rint(3) === 0) m.node = 20 + rint(4);
        else m.node = ((m.node < 12 ? m.node : nearestOuter(m)) + (m.clockwise ? 1 : 11)) % 12;
      }
      break;
    }
    case 'strafe': {
      if (!canTarget || m.phaseT > 20) { setPhase(m, 'holding'); break; }
      fly(m, [tp[0], tp[1] + 8, tp[2]], 16, 1.6, dt);
      const f = forwardOf(m), dx = tp[0] - m.pos[0], dz = tp[2] - m.pos[2], hd = Math.hypot(dx, dz) || 1;
      const aligned = (f[0] * dx + f[2] * dz) / hd > Math.cos(10 * Math.PI / 180);
      if (distP < 64 && aligned && m.canSee(t)) {
        m.charge += dt;
        if (m.charge >= 0.25) { shootFireball(m, t); setPhase(m, 'holding'); }
      } else m.charge = 0;
      if (distP < 12) setPhase(m, 'holding');
      break;
    }
    case 'charge': {
      if (!canTarget || m.phaseT > 8 || fly(m, [tp[0], tp[1] + 1, tp[2]], 24, 3, dt) < 4) setPhase(m, 'holding');
      break;
    }
    case 'landing_approach': {
      if (fly(m, [0, pod + 16, 0], 14, 1.8, dt) < 10 || m.phaseT > 25) setPhase(m, 'landing');
      break;
    }
    case 'landing': {
      // Hover down onto the podium, turning to face the nearest player.
      const k = Math.min(1, dt * 2);
      m.vel[0] += (clamp(-m.pos[0] * 1.5, -6, 6) - m.vel[0]) * k;
      m.vel[2] += (clamp(-m.pos[2] * 1.5, -6, 6) - m.vel[2]) * k;
      m.vel[1] += (clamp((pod - m.pos[1]) * 1.5, -6, 2) - m.vel[1]) * k;
      if (canTarget) { m.yaw += clamp(wrap(Math.atan2(-(tp[0] - m.pos[0]), -(tp[2] - m.pos[2])) - m.yaw), -dt, dt); m.bodyYaw = m.yaw; }
      if (m.pos[1] - pod < 0.4 && Math.hypot(m.pos[0], m.pos[2]) < 1.5) { m.pos[1] = pod; m.flames = 0; m.sitDamage = 0; setPhase(m, 'scanning'); }
      else if (m.phaseT > 12) setPhase(m, 'takeoff');
      break;
    }
    case 'scanning': {
      m.vel = [0, 0, 0];
      if (canTarget && distP < 20) {
        m.yaw += clamp(wrap(Math.atan2(-(tp[0] - m.pos[0]), -(tp[2] - m.pos[2])) - m.yaw), -0.8 * dt, 0.8 * dt); m.bodyYaw = m.yaw;
        if (m.phaseT > 1.25) setPhase(m, 'roar');
      } else if (m.phaseT >= 5) { m.afterTakeoff = canTarget && distP < 150 ? 'charge' : null; setPhase(m, 'takeoff'); }
      break;
    }
    case 'roar': {
      m.vel = [0, 0, 0];
      if (m.phaseT - dt <= 0) g.sound.mob('ender_dragon', 'ambient', m.pos, m);
      if (m.phaseT >= 2) setPhase(m, 'flame');
      break;
    }
    case 'flame': {
      m.vel = [0, 0, 0];
      const h = dragonHead(m), f = forwardOf(m);
      if (m.phaseT < 0.5) { g.particles.fx('portal', h, 3, 0.4, 0.5); break; }
      if (!m.breath) {
        // The breath pools on the ground a few blocks in front of the head.
        const x = h[0] + f[0] * 4, z = h[2] + f[2] * 4, y = Math.max(1, g.world.heightAt(Math.floor(x), Math.floor(z))) + 1;
        m.breath = g.entities.add(new AreaCloud(g, x, y, z, { radius: 5, duration: 10, owner: m }));
        g.sound.play('fireball', h, 0.8);
      }
      // A stream of breath from the mouth down to the cloud.
      const b = m.breath.pos;
      for (let i = 0; i < 4; i++) { const s = Math.random(); g.particles.fx('portal', [h[0] + (b[0] - h[0]) * s, h[1] + (b[1] - h[1]) * s, h[2] + (b[2] - h[2]) * s], 1, 0.3, 0.3); }
      if (m.phaseT >= 10.5) { m.breath = null; m.flames++; setPhase(m, m.flames >= 4 ? 'takeoff' : 'scanning'); }
      break;
    }
    case 'takeoff': {
      const out = [m.pos[0] - Math.sin(m.yaw) * 20, pod + 26, m.pos[2] - Math.cos(m.yaw) * 20];
      fly(m, out, 10, 1.2, dt);
      if (m.pos[1] > pod + 20 || m.phaseT > 8) { const next = m.afterTakeoff; m.afterTakeoff = null; setPhase(m, next || 'holding'); }
      break;
    }
    default: setPhase(m, 'holding');
  }
  contact(m, dt);
  if (!SITTING.has(m.phase)) breakBlocks(m);
}

// End crystals heal 1 health every half second through a beam; the dragon picks the nearest one
// in range every so often.
function checkCrystals(m, dt) {
  const g = m.game;
  if (m.crystal && m.crystal.dead) m.crystal = null;
  m.crystalT -= dt;
  if (m.crystalT <= 0) {
    m.crystalT = rnd(0.2, 1);
    let best = null, bd = 32;
    for (const c of crystals(g)) { const d = m.distTo(c.pos); if (d < bd) { bd = d; best = c; } }
    m.crystal = best;
  }
  m.beam = m.crystal;
  if (m.crystal && m.health < m.maxHealth) {
    m.healT += dt;
    while (m.healT >= 0.5) { m.healT -= 0.5; m.health = Math.min(m.maxHealth, m.health + 1); }
  } else m.healT = 0;
}
// The healing crystal was destroyed: the dragon takes 10 damage to the head.
export function dragonCrystalLost(g, crystal, attacker) {
  for (const m of g.entities.list) {
    if (m.mobType !== 'ender_dragon' || m.dead || m.crystal !== crystal) continue;
    m.crystal = null; m.beam = null;
    m.hurt(10, { kind: 'explosion', attacker, crystalHit: true });
  }
}

// Wings fling anything they sweep through (5 damage); the head and neck bite for 10.
function contact(m, dt) {
  const g = m.game;
  for (const [e, t] of m.hitCd) if (t - dt <= 0) m.hitCd.delete(e); else m.hitCd.set(e, t - dt);
  const sit = SITTING.has(m.phase), h = dragonHead(m), c = Math.cos(m.bodyYaw), s = Math.sin(m.bodyYaw);
  const list = [...g.entities.near(m.pos, 14, e => e.isLiving && e !== m && e.type !== 'end_crystal' && !e.dead && !(e.deathT > 0)), ...(g.alive && m.playerTargetable(g.playerEntity) ? [g.playerEntity] : [])];
  for (const e of list) {
    if (m.hitCd.has(e)) continue;
    const ex = e.pos[0], ey = e.pos[1] + (e.h || 1.8) / 2, ez = e.pos[2];
    // Head and neck.
    const hr = sit ? 1.5 : 2.5;
    const nk = [(m.pos[0] + h[0]) / 2, (m.pos[1] + 2 + h[1]) / 2, (m.pos[2] + h[2]) / 2];
    if (Math.hypot(ex - h[0], ey - h[1], ez - h[2]) < hr || (!sit && Math.hypot(ex - nk[0], ey - nk[1], ez - nk[2]) < 2)) {
      m.hitCd.set(e, 0.5);
      e.hurt(10, { kind: 'mob', attacker: m });
      continue;
    }
    if (sit) continue;
    // Wings: either side of the body, out to the wingtips.
    const dx = ex - m.pos[0], dz = ez - m.pos[2], dy = ey - (m.pos[1] + 2.4);
    const side = dx * c - dz * s, along = -(dx * s + dz * c);
    if (Math.abs(side) > 1.5 && Math.abs(side) < 7.5 && along > -3 && along < 4 && dy > -1.5 && dy < 3) {
      m.hitCd.set(e, 0.5);
      const n = Math.hypot(dx, dz) || 1;
      e.hurt(5, { kind: 'mob', attacker: m, knock: [dx / n, dz / n], knockStrength: 22 });
      if (e.vel) e.vel[1] = Math.max(e.vel[1], 6);
    }
  }
}

// It smashes through anything but end stone, obsidian and bedrock as it flies.
function breakBlocks(m) {
  const g = m.game;
  if (!g.rules.mobGriefing || Math.random() > 0.35) return;
  const w = g.world, c = Math.cos(m.bodyYaw), s = Math.sin(m.bodyYaw);
  for (let k = 0; k < 6; k++) {
    const side = rnd(-6, 6), along = rnd(-3, 4), up = rnd(0, 4);
    const x = Math.floor(m.pos[0] + side * c - along * s), y = Math.floor(m.pos[1] + up), z = Math.floor(m.pos[2] - side * s - along * c);
    const id = w.getBlock(x, y, z);
    if (id === UNLOADED || IMMUNE.has(id) || BLOCKS[id].hardness === Infinity || BLOCKS[id].key === 'iron_bars') continue;
    g.setBlock(x, y, z, B.AIR, 0);
    if (Math.random() < 0.2) g.particles.explosion([x + 0.5, y + 0.5, z + 0.5], 0.5);
  }
}

// Damage rules. Returns the damage to apply (0 = ignored).
export function dragonDamage(m, amount, src) {
  const g = m.game, a = src.attacker;
  const byPlayer = a && (a === g.playerEntity || a.remote);
  if (src.kind === 'kill' || src.crystalHit) return amount;
  if (src.kind === 'explosion' && !byPlayer) return 0;
  if (src.kind !== 'player' && src.kind !== 'projectile' && src.kind !== 'explosion') return 0;
  // Perched, it shrugs off arrows (they glance off in flames).
  if (SITTING.has(m.phase) && src.kind === 'projectile') { if (src.projectile) src.projectile.fire = Math.max(src.projectile.fire || 0, 1); return 0; }
  let head = !!src.crystalHit;
  const h = dragonHead(m);
  if (!head) {
    if (src.projectile) head = Math.hypot(...src.projectile.pos.map((v, i) => v - h[i])) < 3;
    else if (a === g.playerEntity) {
      const e = g.player.eyePos(), d = g.lookDir(), v = [h[0] - e[0], h[1] - e[1], h[2] - e[2]];
      const along = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
      const off = Math.hypot(v[0] - d[0] * along, v[1] - d[1] * along, v[2] - d[2] * along);
      head = along > 0 && off < 2.2;
    } else if (src.pos) head = Math.hypot(...src.pos.map((v, i) => v - h[i])) < 4;
  }
  if (!head) amount = amount / 4 + Math.min(amount, 1);
  if (SITTING.has(m.phase)) {
    m.sitDamage += amount;
    if (m.sitDamage > m.maxHealth * 0.25) { m.sitDamage = 0; m.afterTakeoff = null; setPhase(m, 'takeoff'); }
  }
  return amount;
}

// The death: ten seconds rising over the island in beams of light, experience pouring out
// over the last few seconds, then the exit portal.
export function dragonDying(m, dt) {
  const g = m.game, t = m.deathT;
  m.pos[0] += -m.pos[0] * Math.min(1, dt * 0.5); m.pos[2] += -m.pos[2] * Math.min(1, dt * 0.5);
  m.pos[1] += dt * 2; m.vel = [0, 0, 0];
  if (Math.random() < 0.6) g.particles.explosion([m.pos[0] + rnd(-4, 4), m.pos[1] + rnd(0, 4), m.pos[2] + rnd(-4, 4)], 1);
  const total = g.dragonKilled ? 500 : 12000;
  if (t > 7.5) {
    m.xpT = (m.xpT || 0) + dt;
    while (m.xpT >= 0.25) { m.xpT -= 0.25; g.spawnXp([m.pos[0], m.pos[1] + 2, m.pos[2]], Math.floor(total * 0.08)); }
  }
  if (t >= 10) {
    g.spawnXp([m.pos[0], m.pos[1] + 2, m.pos[2]], Math.floor(total * 0.2));
    m.dead = true;
    g.onDragonDeath(m);
  }
}
