// Progress: eggs, and what they unlock. Eggs are earned by playing well (points in a match, placing,
// winning, challenges; main.js) and are never spent, so whatever a player has unlocked stays
// unlocked. Every weapon is free from the start; every gun skin has a rarity that opens at an egg
// total; colours, patterns, stamps and almost every hat are free from the start.
import { WEAPON_ASSETS } from '../render/asset-catalog.js?v=muzsrlxh';
import { HATS } from './cosmetics.js?v=muzsrlxh';
import { ECONOMY } from '../sim/tuning.js?v=muzsrlxh';

// Eggs needed for each weapon: none, every weapon is open from the start (skins are what unlock).
export const WEAPON_UNLOCK = { yolk47: 0, peck9mm: 0, beater: 0, doubleYolker: 0, triBoil: 0, cageFree: 0, poacher: 0, yolkzooka: 0 };
// Gun skin rarities and the eggs that open each (asset-catalog.js gives every skin its rarity).
export const TIERS = [
  { name: 'Common', eggs: 0, color: '#d6dde3' }, { name: 'Uncommon', eggs: 300, color: '#5ed37a' }, { name: 'Rare', eggs: 1000, color: '#4aa8ff' },
  { name: 'Epic', eggs: 3000, color: '#c070ff' }, { name: 'Legendary', eggs: 7000, color: '#ffb52e' },
];
export const skinTier = (weapon, skin) => WEAPON_ASSETS[weapon]?.tiers[skin] ?? 0;
const HAT_EGGS = new Map(HATS.map(h => [h.id, h.price || 0]));

// Eggs a thing needs: kind 'weapon' (id), 'skin' (id = skin index of weapon) or a shop tab (id).
export function eggsFor(kind, id, weapon) {
  if (kind === 'weapon') return WEAPON_UNLOCK[id] ?? 0;
  if (kind === 'skin') return TIERS[skinTier(weapon, id)].eggs;
  if (kind === 'hat') return HAT_EGGS.get(id) ?? 0;
  return 0;
}
// Whether a profile has it: enough eggs, or bought back when eggs were spent ('tab:id' in owned).
export const unlocked = (profile, kind, id, weapon) => profile.coins >= eggsFor(kind, id, weapon) || profile.owned.includes(`${kind}:${id}`);

// Eggs for points scored, carried as a fraction between awards so nothing is lost to rounding.
export function eggsForPoints(ledger, points, mult = 1) {
  ledger.carry = (ledger.carry || 0) + points * mult;
  const whole = Math.floor(ledger.carry / ECONOMY.pointsPerEgg);
  ledger.carry -= whole * ECONOMY.pointsPerEgg;
  return whole;
}
