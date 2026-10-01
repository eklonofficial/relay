// Shared combat rules (Java Edition 1.9+ numbers). Mobs, the local player and — once multiplayer
// lands — remote players all resolve hits through these functions, so PvE and PvP behave the same:
// attack cooldown, crits, sweeps, knockback, armor and toughness, and invulnerability frames.
import { I } from '../data/items.js?v=mupht1t9';

// Damage kinds that ignore armor.
export const ARMOR_BYPASS = new Set(['fall', 'drown', 'fire', 'starve', 'magic', 'void', 'kill', 'wither', 'poison', 'lava', 'suffocate']);

export function armorStats(stacks) {
  let pts = 0, tough = 0;
  for (const s of stacks) {
    const a = s && I[s.key] && I[s.key].armor;
    if (a) { pts += a.points; tough += a.tough; }
  }
  return { pts, tough };
}

// Armor reduction: each point blocks 4%, softened against big hits unless backed by toughness.
export function armorReduce(dmg, pts, tough = 0) {
  if (pts <= 0) return dmg;
  return dmg * (1 - Math.min(20, Math.max(pts / 5, pts - dmg / (2 + tough / 4))) / 25);
}

// Invulnerability frames: for half a second after a hit only a harder hit lands, and only for
// the difference. Returns the damage to apply (0 = ignored) and whether it's a fresh hit
// (fresh hits play the hurt animation and deal knockback).
export const INVUL_TIME = 0.5;
export function applyInvul(target, amount) {
  if (target.invul > 0) {
    const last = target.lastHurtAmount || 0;
    if (amount <= last) return { amount: 0, fresh: false };
    target.lastHurtAmount = amount;
    return { amount: amount - last, fresh: false };
  }
  target.lastHurtAmount = amount;
  target.invul = INVUL_TIME;
  return { amount, fresh: true };
}

// Melee damage for a weapon and a 0..1 attack-cooldown charge.
export function meleeDamage(weaponKey, charge, { crit = false, strength = 0, weakness = 0 } = {}) {
  const it = weaponKey && I[weaponKey];
  let dmg = it && it.damage ? it.damage : 1;
  dmg += strength * 3 - weakness * 4;
  dmg *= 0.2 + charge * charge * 0.8;
  if (crit) dmg *= 1.5;
  return Math.max(0, dmg);
}

// A jump-attack while falling, fully charged, not in water or on a ladder, and not sprinting.
export function isCrit(p, charge) {
  return charge > 0.9 && !p.onGround && p.vel[1] < 0 && !p.inWater && !p.climbing && !p.flying;
}

// Knockback strength in blocks/second: sprint hits knock harder.
export function knockStrength(sprintHit) { return sprintHit ? 9 : 5; }
// Sweeping a sword (no enchantment) deals 1 damage to everything around the target.
export const SWEEP_DAMAGE = 1;
// Seconds a raised shield needs before it blocks, and how long an axe hit disables it.
export const SHIELD_DELAY = 0.25, SHIELD_DISABLE = 5;
// Netherite armour resists knockback (10% per piece).
export function knockbackResist(stacks) { let r = 0; for (const s of stacks) if (s && I[s.key] && I[s.key].material === 'netherite') r += 0.1; return Math.min(1, r); }
// Minecraft's LivingEntity.knockback in blocks/second: halve the current motion, push away from
// the source; only a grounded target is also lifted.
export function applyKnockback(vel, dir, strength, onGround, resist = 0) {
  const s = strength * (1 - resist) * 20;
  if (s <= 0) return;
  const n = Math.hypot(dir[0], dir[1]) || 1;
  vel[0] = vel[0] / 2 + dir[0] / n * s;
  vel[2] = vel[2] / 2 + dir[1] / n * s;
  if (onGround) vel[1] = Math.min(8, vel[1] / 2 + s);
}
// Whether a shield held by someone at pos looking along look faces the source (within 90°).
export function shieldFaces(pos, look, src) {
  const dx = src[0] - pos[0], dz = src[2] - pos[2], n = Math.hypot(dx, dz);
  if (n < 1e-6) return true;
  return (dx * look[0] + dz * look[2]) / (n * (Math.hypot(look[0], look[2]) || 1)) > 0;
}

export const isSword = key => !!(key && I[key] && I[key].tool && I[key].tool.type === 'sword');
export const isAxe = key => !!(key && I[key] && I[key].tool && I[key].tool.type === 'axe');
