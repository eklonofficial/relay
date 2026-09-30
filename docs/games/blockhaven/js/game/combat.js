// Shared combat rules (Java Edition 1.9+ numbers). Mobs, the local player and — once multiplayer
// lands — remote players all resolve hits through these functions, so PvE and PvP behave the same:
// attack cooldown, crits, sweeps, knockback, armor and toughness, and invulnerability frames.
import { I } from '../data/items.js?v=munkt0s5';

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

export const isSword = key => !!(key && I[key] && I[key].tool && I[key].tool.type === 'sword');
export const isAxe = key => !!(key && I[key] && I[key].tool && I[key].tool.type === 'axe');
