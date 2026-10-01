// Item registry: every block item plus tools, weapons, armor, food and materials.
import { BLOCK_ITEMS, BLOCKS, COLORS, SHAPE, st } from './blocks.js?v=mupq37b9';
import { EGG_MOBS } from './mobs.js?v=mupq37b9';

export const ITEMS = [];
export const I = {};          // key -> item
const title = s => s.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

function add(key, o = {}) {
  if (I[key]) return I[key];
  const it = { id: ITEMS.length, key, name: o.name || title(key), stack: o.stack ?? 64, tab: o.tab || 'ingredients', ...o };
  ITEMS.push(it); I[key] = it;
  return it;
}

// ---- block items ----
for (const b of BLOCK_ITEMS) {
  const blk = BLOCKS[b.id];
  const flat = [SHAPE.CROSS, SHAPE.TORCH, SHAPE.DOOR, SHAPE.LADDER, SHAPE.VINE, SHAPE.RAIL, SHAPE.PANE, SHAPE.LANTERN, SHAPE.FIRE, SHAPE.ROD, SHAPE.FLAT, SHAPE.CAMPFIRE, SHAPE.DIODE, SHAPE.LEVER, SHAPE.HOPPER].includes(blk.shape);
  add(b.key, { name: b.name, block: [b.id, b.meta], tab: b.tab, flat, kind: 'block' });
}
I.bed.stack = 1;
// Pistons, observers and the like show their front in the hand.
for (const k of ['piston', 'sticky_piston']) I[k].block = [I[k].block[0], (I[k].block[1] & 1) | (1 << 1)];
for (const k of ['observer', 'dispenser', 'dropper']) I[k].block = [I[k].block[0], 3];

// ---- tools ----
export const TIERS = {
  wooden: { tier: 1, speed: 2, dur: 59, dmg: 0, color: 'wood', repair: 'planks' },
  stone: { tier: 2, speed: 4, dur: 131, dmg: 1, color: 'stone', repair: 'cobblestone' },
  iron: { tier: 3, speed: 6, dur: 250, dmg: 2, color: 'iron', repair: 'iron_ingot' },
  golden: { tier: 1, speed: 12, dur: 32, dmg: 0, color: 'gold', repair: 'gold_ingot' },
  diamond: { tier: 4, speed: 8, dur: 1561, dmg: 3, color: 'diamond', repair: 'diamond' },
  netherite: { tier: 5, speed: 9, dur: 2031, dmg: 4, color: 'netherite', repair: 'netherite_ingot' },
};
const TOOL_DMG = { sword: 4, axe: [7, 9, 9, 7, 9, 10], pickaxe: 2, shovel: 2.5, hoe: 1 };
const ATTACK_SPEED = { sword: 1.6, axe: [0.8, 0.8, 0.9, 1.0, 1.0, 1.0], pickaxe: 1.2, shovel: 1.0, hoe: [1, 2, 3, 1, 4, 4] };
Object.entries(TIERS).forEach(([mat, t], ti) => {
  for (const type of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) {
    const base = TOOL_DMG[type], dmg = Array.isArray(base) ? base[ti] : type === 'sword' ? base + t.dmg : base + t.dmg * (type === 'hoe' ? 0 : 1);
    const as = ATTACK_SPEED[type];
    add(`${mat}_${type}`, {
      stack: 1, tab: type === 'sword' || type === 'axe' ? 'combat' : 'tools', kind: 'tool',
      tool: { type, tier: t.tier, speed: t.speed, material: mat }, durability: t.dur, damage: dmg,
      attackSpeed: Array.isArray(as) ? as[ti] : as, tex: `${type}`, material: mat, fuel: mat === 'wooden' ? 10 : 0,
    });
  }
});
add('shears', { stack: 1, tab: 'tools', kind: 'tool', tool: { type: 'shears', tier: 0, speed: 5 }, durability: 238, damage: 1 });
add('flint_and_steel', { stack: 1, tab: 'tools', kind: 'use', use: 'ignite', durability: 64 });
add('fire_charge', { tab: 'combat', kind: 'use', use: 'ignite_once' });
add('firework_rocket', { tab: 'tools', kind: 'use', use: 'firework' });
add('bow', { stack: 1, tab: 'combat', kind: 'bow', durability: 384, damage: 1, fuel: 15 });
add('crossbow', { stack: 1, tab: 'combat', kind: 'bow', durability: 465, damage: 1, crossbow: true });
add('arrow', { tab: 'combat' });
add('spectral_arrow', { tab: 'combat' });
add('shield', { stack: 1, tab: 'combat', kind: 'shield', durability: 336 });
add('trident', { stack: 1, tab: 'combat', kind: 'trident', durability: 250, damage: 9, attackSpeed: 1.1 });
add('bucket', { stack: 16, tab: 'tools', kind: 'use', use: 'bucket' });
add('water_bucket', { stack: 1, tab: 'tools', kind: 'use', use: 'place_liquid', liquid: 'water' });
add('lava_bucket', { stack: 1, tab: 'tools', kind: 'use', use: 'place_liquid', liquid: 'lava', fuel: 1000 });
add('milk_bucket', { stack: 1, tab: 'food', kind: 'food', food: { hunger: 0, sat: 0, milk: true }, drink: true });
add('fishing_rod', { stack: 1, tab: 'tools', kind: 'use', use: 'fish', durability: 64 });
add('compass', { stack: 1, tab: 'tools' });
add('clock', { stack: 1, tab: 'tools' });
add('ender_pearl', { stack: 16, tab: 'combat', kind: 'use', use: 'throw', projectile: 'ender_pearl' });
add('ender_eye', { name: 'Eye of Ender', tab: 'ingredients', kind: 'use', use: 'eye' });
add('snowball', { stack: 16, tab: 'combat', kind: 'use', use: 'throw', projectile: 'snowball' });
add('egg', { stack: 16, tab: 'ingredients', kind: 'use', use: 'throw', projectile: 'egg' });
add('bone_meal', { tab: 'ingredients', kind: 'use', use: 'bone_meal' });
add('totem_of_undying', { stack: 1, tab: 'combat' });
add('name_tag', { tab: 'tools' });
add('saddle', { stack: 1, tab: 'tools' });
add('lead', { tab: 'tools' });
add('elytra', { stack: 1, tab: 'combat', kind: 'armor', armor: { slot: 1, points: 0, tough: 0, material: 'elytra' }, durability: 432 });

// ---- armor ----
export const ARMOR = {
  leather: { pts: [1, 3, 2, 1], mult: 5, tough: 0 }, chainmail: { pts: [2, 5, 4, 1], mult: 15, tough: 0 },
  iron: { pts: [2, 6, 5, 2], mult: 15, tough: 0 }, golden: { pts: [2, 5, 3, 1], mult: 7, tough: 0 },
  diamond: { pts: [3, 8, 6, 3], mult: 33, tough: 2 }, netherite: { pts: [3, 8, 6, 3], mult: 37, tough: 3 },
};
export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_BASE = [11, 16, 15, 13];
for (const [mat, a] of Object.entries(ARMOR)) {
  ARMOR_SLOTS.forEach((piece, slot) => add(`${mat}_${piece}`, {
    stack: 1, tab: 'combat', kind: 'armor', armor: { slot, points: a.pts[slot], tough: a.tough, material: mat },
    durability: ARMOR_BASE[slot] * a.mult, tex: piece, material: mat,
  }));
}
add('turtle_helmet', { stack: 1, tab: 'combat', kind: 'armor', armor: { slot: 0, points: 2, tough: 0, material: 'turtle' }, durability: 275, tex: 'helmet', material: 'turtle' });

// ---- food: hunger, saturation ----
const FOOD = {
  apple: [4, 2.4], bread: [5, 6], porkchop: [3, 1.8], cooked_porkchop: [8, 12.8], beef: [3, 1.8], cooked_beef: [8, 12.8],
  chicken: [2, 1.2, { hunger: 0.3 }], cooked_chicken: [6, 7.2], mutton: [2, 1.2], cooked_mutton: [6, 9.6], rabbit: [3, 1.8], cooked_rabbit: [5, 6],
  cod: [2, 0.4], cooked_cod: [5, 6], salmon: [2, 0.4], cooked_salmon: [6, 9.6], tropical_fish: [1, 0.2], pufferfish: [1, 0.2, { poison: 1 }],
  carrot: [3, 3.6], potato: [1, 0.6], baked_potato: [5, 6], poisonous_potato: [2, 1.2, { poison: 0.6 }], beetroot: [1, 1.2], beetroot_soup: [6, 7.2],
  melon_slice: [2, 1.2], sweet_berries: [2, 0.4], glow_berries: [2, 0.4], cookie: [2, 0.4], pumpkin_pie: [8, 4.8],
  golden_apple: [4, 9.6, { regen: 5, absorption: 4 }], enchanted_golden_apple: [4, 9.6, { regen: 20, absorption: 16, resistance: 300, fire: 300 }],
  golden_carrot: [6, 14.4], mushroom_stew: [6, 7.2], rabbit_stew: [10, 12], rotten_flesh: [4, 0.8, { hunger: 0.8 }], spider_eye: [2, 3.2, { poison: 1 }],
  dried_kelp: [1, 0.6], chorus_fruit: [4, 2.4, { teleport: 1 }], honey_bottle: [6, 1.2],
};
for (const [k, [hunger, sat, fx]] of Object.entries(FOOD)) {
  add(k, { tab: 'food', kind: 'food', food: { hunger, sat, ...(fx || {}) }, stack: /stew|soup/.test(k) ? 1 : 64 });
}
// Seeds and berries also plant crops.
I.carrot.place = 'carrots'; I.potato.place = 'potatoes'; I.sweet_berries.place = 'sweet_berry_bush'; I.glow_berries.place = 'cave_vines';
add('wheat_seeds', { tab: 'natural', place: 'wheat' });
add('beetroot_seeds', { tab: 'natural', place: 'beetroots' });
add('pumpkin_seeds', { tab: 'natural', place: 'pumpkin_stem' });
add('melon_seeds', { tab: 'natural', place: 'melon_stem' });

// ---- materials ----
for (const k of ['stick', 'coal', 'charcoal', 'raw_iron', 'raw_gold', 'raw_copper', 'iron_ingot', 'gold_ingot', 'copper_ingot', 'netherite_scrap',
  'netherite_ingot', 'iron_nugget', 'gold_nugget', 'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'quartz', 'amethyst_shard', 'flint', 'string',
  'feather', 'leather', 'rabbit_hide', 'rabbit_foot', 'gunpowder', 'bone', 'slime_ball', 'blaze_rod', 'blaze_powder', 'ghast_tear', 'magma_cream',
  'nether_wart', 'glowstone_dust', 'clay_ball', 'brick', 'nether_brick', 'paper', 'book', 'sugar', 'wheat', 'bowl', 'glass_bottle', 'prismarine_crystals',
  'prismarine_shard', 'ink_sac', 'glow_ink_sac', 'phantom_membrane', 'shulker_shell', 'nautilus_shell', 'heart_of_the_sea', 'scute', 'honeycomb',
  'nether_star', 'dragon_breath', 'echo_shard', 'disc_fragment', 'experience_bottle']) add(k);
// Redstone dust is an item that places a block.
I.redstone.placeBlock = [BLOCKS.find(b => b && b.key === 'redstone_wire').id, 0]; I.redstone.tab = 'redstone';
I.stick.fuel = 5; I.coal.fuel = 80; I.charcoal.fuel = 80; I.blaze_rod.fuel = 120; I.bowl.fuel = 5; I.lava_bucket.fuel = 1000;
I.nether_wart.place = 'nether_wart';
I.glass_bottle.use = 'bottle'; I.glass_bottle.tab = 'tools';
add('enchanted_book', { stack: 1, tab: 'ingredients' });
for (const c of COLORS) add(`${c}_dye`, { tab: 'ingredients', dye: c });

// ---- spawn eggs (filled in by the mob registry) ----
export function addSpawnEgg(mob, name, colors) {
  return add(`${mob}_spawn_egg`, { name: `${name} Spawn Egg`, tab: 'spawn_eggs', kind: 'use', use: 'spawn_egg', mob, eggColors: colors });
}

for (const m of EGG_MOBS) addSpawnEgg(m.key, m.name, m.egg);

export const TABS = [
  ['building', 'Building Blocks'], ['colored', 'Colored Blocks'], ['natural', 'Natural Blocks'], ['functional', 'Functional Blocks'], ['redstone', 'Redstone Blocks'],
  ['tools', 'Tools & Utilities'], ['combat', 'Combat'], ['food', 'Food & Drinks'], ['ingredients', 'Ingredients'], ['spawn_eggs', 'Spawn Eggs'],
];

export const itemOf = key => I[key];
export const blockItem = (id, meta) => ITEMS.find(it => it.block && it.block[0] === id && it.block[1] === meta);

// Maximum stack for an item key; tools and armor never stack.
// The icon a stack shows: a charged crossbow shows what it holds.
export const iconKey = s => (s.key === 'crossbow' && s.tag && s.tag.loaded ? (s.tag.rocket ? 'crossbow_firework' : 'crossbow_arrow') : s.key);
export const maxStack = key => (I[key] ? I[key].stack : 64);

// Mining: seconds to break a block state with an item (null item = hand).
export function breakTime(p, item, { onGround = true, inWater = false, efficiency = 0, haste = 0 } = {}) {
  if (p.hardness === Infinity) return Infinity;
  if (p.hardness === 0) return 0;
  const t = item && item.tool;
  let speed = 1;
  const right = t && (t.type === p.tool || (t.type === 'sword' && p.tool === 'sword') || (t.type === 'shears' && (p.tool === 'shears' || p.b.key === 'leaves' || p.b.key === 'wool')));
  if (right) speed = t.speed;
  if (t && t.type === 'sword' && p.b.key === 'cobweb') speed = 15;
  if (right && efficiency) speed += efficiency * efficiency + 1;
  if (haste) speed *= 1 + 0.2 * haste;
  if (inWater) speed /= 5;
  if (!onGround) speed /= 5;
  const harvest = canHarvest(p, item);
  return p.hardness * (harvest ? 1.5 : 5) / speed;
}

export function canHarvest(p, item) {
  if (!p.tool || p.tier === 0) return p.b.key !== 'cobweb' || !!(item && item.tool && (item.tool.type === 'shears' || item.tool.type === 'sword'));
  const t = item && item.tool;
  if (!t || t.type !== p.tool) return p.tool === 'sword' ? true : false;
  return t.tier >= p.tier;
}

export { st };
