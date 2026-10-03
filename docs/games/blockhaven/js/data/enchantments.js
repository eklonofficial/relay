// Enchantments, after Java 1.20.1: levels, rarity weights, the cost window each level can be
// rolled in, which items take them, which ones exclude each other, and the enchanting-table
// and anvil arithmetic. A stack's enchantments live in stack.tag.ench ({ id: level }); an
// enchanted book keeps them in stack.tag.stored. stack.tag.rc is the anvil's prior-work cost.
import { I } from './items.js?v=mush3uwi';
import { mulberry32 } from '../core/noise.js?v=mush3uwi';

const W = { common: 10, uncommon: 5, rare: 2, very_rare: 1 };
// [id, max level, rarity, category, minCost(level), maxCost(level), flags]
const lin = (a, b, span) => [l => a + (l - 1) * b, l => a + (l - 1) * b + span];
const DEFS = [
  ['protection', 4, 'common', 'armor', ...lin(1, 11, 11), { group: 'protection' }],
  ['fire_protection', 4, 'uncommon', 'armor', ...lin(10, 8, 8), { group: 'protection' }],
  ['feather_falling', 4, 'uncommon', 'armor_feet', ...lin(5, 6, 6)],
  ['blast_protection', 4, 'rare', 'armor', ...lin(5, 8, 8), { group: 'protection' }],
  ['projectile_protection', 4, 'uncommon', 'armor', ...lin(3, 6, 6), { group: 'protection' }],
  ['respiration', 3, 'rare', 'armor_head', l => 10 * l, l => 10 * l + 30],
  ['aqua_affinity', 1, 'rare', 'armor_head', () => 1, () => 41],
  ['thorns', 3, 'very_rare', 'armor_chest', ...lin(10, 20, 50), { anvil: 'armor' }],
  ['depth_strider', 3, 'rare', 'armor_feet', l => 10 * l, l => 10 * l + 15, { group: 'boots_fluid' }],
  ['frost_walker', 2, 'rare', 'armor_feet', l => 10 * l, l => 10 * l + 15, { treasure: true, group: 'boots_fluid' }],
  ['binding_curse', 1, 'very_rare', 'wearable', () => 25, () => 50, { treasure: true, curse: true }],
  ['soul_speed', 3, 'very_rare', 'armor_feet', l => 10 * l, l => 10 * l + 15, { treasure: true, noTrade: true }],
  ['swift_sneak', 3, 'very_rare', 'armor_legs', l => 25 * l, l => 25 * l + 50, { treasure: true, noTrade: true }],
  ['sharpness', 5, 'common', 'weapon', ...lin(1, 11, 20), { group: 'damage', anvil: 'axe' }],
  ['smite', 5, 'uncommon', 'weapon', ...lin(5, 8, 20), { group: 'damage', anvil: 'axe' }],
  ['bane_of_arthropods', 5, 'uncommon', 'weapon', ...lin(5, 8, 20), { group: 'damage', anvil: 'axe' }],
  ['knockback', 2, 'uncommon', 'weapon', ...lin(5, 20, 50)],
  ['fire_aspect', 2, 'rare', 'weapon', ...lin(10, 20, 50)],
  ['looting', 3, 'rare', 'weapon', ...lin(15, 9, 50)],
  ['sweeping', 3, 'rare', 'weapon', ...lin(5, 9, 15), { name: 'Sweeping Edge' }],
  ['efficiency', 5, 'common', 'digger', ...lin(1, 10, 50), { anvil: 'shears' }],
  ['silk_touch', 1, 'very_rare', 'digger', () => 15, () => 65, { group: 'drops' }],
  ['unbreaking', 3, 'uncommon', 'breakable', ...lin(5, 8, 50)],
  ['fortune', 3, 'rare', 'digger', ...lin(15, 9, 50), { group: 'drops' }],
  ['power', 5, 'common', 'bow', ...lin(1, 10, 15)],
  ['punch', 2, 'rare', 'bow', ...lin(12, 20, 25)],
  ['flame', 1, 'rare', 'bow', () => 20, () => 50],
  ['infinity', 1, 'very_rare', 'bow', () => 20, () => 50, { group: 'infinity' }],
  ['luck_of_the_sea', 3, 'rare', 'fishing_rod', ...lin(15, 9, 50)],
  ['lure', 3, 'rare', 'fishing_rod', ...lin(15, 9, 50)],
  ['loyalty', 3, 'uncommon', 'trident', l => 5 + l * 7, () => 50, { group: 'loyalty' }],
  ['impaling', 5, 'rare', 'trident', ...lin(1, 8, 20)],
  ['riptide', 3, 'rare', 'trident', l => 10 + l * 7, () => 50, { group: 'riptide' }],
  ['channeling', 1, 'very_rare', 'trident', () => 25, () => 50, { group: 'channeling' }],
  ['multishot', 1, 'rare', 'crossbow', () => 20, () => 50, { group: 'multishot' }],
  ['quick_charge', 3, 'uncommon', 'crossbow', ...lin(12, 20, 38)],
  ['piercing', 4, 'common', 'crossbow', l => 1 + (l - 1) * 10, () => 50, { group: 'multishot_p' }],
  ['mending', 1, 'rare', 'breakable', l => l * 25, l => l * 25 + 50, { treasure: true, group: 'infinity' }],
  ['vanishing_curse', 1, 'very_rare', 'vanishable', () => 25, () => 50, { treasure: true, curse: true }],
];
const title = s => s.split('_').map(w => (w === 'of' || w === 'the' ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
export const ENCHANTS = {};
export const ENCHANT_LIST = DEFS.map(([id, max, rarity, cat, minCost, maxCost, o = {}]) => {
  const name = o.name || (o.curse ? `Curse of ${title(id.replace('_curse', ''))}` : title(id));
  return (ENCHANTS[id] = { id, max, rarity, weight: W[rarity], cat, minCost, maxCost, name, treasure: !!o.treasure, curse: !!o.curse, group: o.group, anvil: o.anvil, noTrade: !!o.noTrade });
});
// Pairs that can't share an item besides the same-group rule.
const CLASH = new Set(['riptide|loyalty', 'riptide|channeling', 'multishot|piercing', 'silk_touch|fortune', 'depth_strider|frost_walker', 'infinity|mending']);
export function compatible(a, b) {
  if (a === b) return false;
  const A = ENCHANTS[a], Bd = ENCHANTS[b];
  if (CLASH.has(`${a}|${b}`) || CLASH.has(`${b}|${a}`)) return false;
  // Protection types exclude each other, as do the damage types.
  if (A.group && A.group === Bd.group && (A.group === 'protection' || A.group === 'damage')) return false;
  return true;
}

// ---------------- items ----------------
const TOOLS = ['pickaxe', 'axe', 'shovel', 'hoe'];
function itemKinds(key) {
  const it = I[key];
  if (!it) return new Set();
  const k = new Set();
  if (it.durability) k.add('breakable'), k.add('vanishable');
  if (it.armor) {
    k.add('wearable');
    if (it.armor.material !== 'elytra') { k.add('armor'); k.add(['armor_head', 'armor_chest', 'armor_legs', 'armor_feet'][it.armor.slot]); }
  }
  if (key.endsWith('_head') || key.endsWith('_skull') || key === 'carved_pumpkin') k.add('wearable'), k.add('vanishable');
  if (key === 'compass' || key === 'recovery_compass') k.add('vanishable');
  const t = it.tool && it.tool.type;
  if (t === 'sword') k.add('weapon');
  if (TOOLS.includes(t)) k.add('digger');
  if (t === 'axe') k.add('axe');
  if (t === 'shears') k.add('shears');
  if (key === 'bow') k.add('bow');
  if (key === 'crossbow') k.add('crossbow');
  if (key === 'trident') k.add('trident');
  if (key === 'fishing_rod') k.add('fishing_rod');
  return k;
}
// The original's enchantability: how generous the enchanting table is with each material.
const ENCHANTABILITY = {
  wooden: 15, stone: 5, iron: 14, golden: 22, diamond: 10, netherite: 15,
  leather: 15, chainmail: 12, iron_armor: 9, golden_armor: 25, diamond_armor: 10, netherite_armor: 15, turtle: 9,
};
export function enchantability(key) {
  const it = I[key];
  if (!it) return 0;
  if (key === 'book') return 1;
  if (it.armor) { const m = it.armor.material; return m === 'elytra' ? 0 : ENCHANTABILITY[m in { iron: 1, golden: 1, diamond: 1, netherite: 1 } ? `${m}_armor` : m] || 0; }
  if (it.tool && it.tool.material) return ENCHANTABILITY[it.tool.material] || 0;
  if (['bow', 'crossbow', 'trident', 'fishing_rod'].includes(key)) return 1;
  return 0;
}
// Can `id` go on this item at the enchanting table (primary) or the anvil (anything it supports)?
export function canEnchant(id, key, { anvil = false } = {}) {
  const e = ENCHANTS[id], k = itemKinds(key);
  if (key === 'book' || key === 'enchanted_book') return true;
  if (k.has(e.cat)) return true;
  if (anvil && e.anvil && k.has(e.anvil)) return true;
  return false;
}
export const isEnchantable = key => enchantability(key) > 0 && (I[key].stack || 64) === 1;

// ---------------- stacks ----------------
export const enchantsOf = s => (s && s.tag && (s.key === 'enchanted_book' ? s.tag.stored : s.tag.ench)) || {};
export const enchLevel = (s, id) => (s && s.tag && s.tag.ench && s.tag.ench[id]) || 0;
export const hasGlint = s => !!s && (s.key === 'enchanted_book' || s.key === 'enchanted_golden_apple' || s.key === 'experience_bottle' || s.key === 'nether_star' || (!!s.tag && !!s.tag.ench && Object.keys(s.tag.ench).length > 0));
export function setEnchants(s, ench) {
  const tag = { ...(s.tag || {}) };
  const k = s.key === 'enchanted_book' ? 'stored' : 'ench';
  if (Object.keys(ench).length) tag[k] = { ...ench }; else delete tag[k];
  s.tag = Object.keys(tag).length ? tag : undefined;
  if (!s.tag) delete s.tag;
  return s;
}
export function enchantedBook(id, level) { return { key: 'enchanted_book', count: 1, tag: { stored: { [id]: level } } }; }
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = n => ROMAN[n] || String(n);
export function enchantName(id, level) {
  const e = ENCHANTS[id];
  if (!e) return id;
  return e.max === 1 && level === 1 ? e.name : `${e.name} ${roman(level)}`;
}

// ---------------- the enchanting table ----------------
// A seeded RNG with Java's Random shape (nextInt, nextFloat).
export function rng(seed) { const r = mulberry32(seed >>> 0); return { float: r, int: n => Math.floor(r() * n) }; }
// Level requirement for each of the three offers.
export function tableCost(r, slot, shelves, key) {
  if (enchantability(key) <= 0) return 0;
  const power = Math.min(shelves, 15);
  const i = r.int(8) + 1 + (power >> 1) + r.int(power + 1);
  if (slot === 0) return Math.max(Math.floor(i / 3), 1);
  if (slot === 1) return Math.floor(i * 2 / 3) + 1;
  return Math.max(i, power * 2);
}
// Every enchantment that can be rolled at this modified level, at its highest fitting level.
function available(level, key, treasure) {
  const book = key === 'book';
  const out = [];
  for (const e of ENCHANT_LIST) {
    if (e.treasure && !treasure) continue;
    if (!book && !canEnchant(e.id, key)) continue;
    for (let l = e.max; l >= 1; l--) if (level >= e.minCost(l) && level <= e.maxCost(l)) { out.push({ id: e.id, level: l, weight: e.weight }); break; }
  }
  return out;
}
function weighted(r, list) {
  let total = 0;
  for (const x of list) total += x.weight;
  let n = r.int(total);
  for (const x of list) { n -= x.weight; if (n < 0) return x; }
  return list[list.length - 1];
}
export function selectEnchantments(r, key, level, treasure = false) {
  const ench = enchantability(key);
  if (ench <= 0) return [];
  level += 1 + r.int(Math.floor(ench / 4) + 1) + r.int(Math.floor(ench / 4) + 1);
  const f = (r.float() + r.float() - 1) * 0.15;
  level = Math.max(1, Math.round(level + level * f));
  const out = [];
  let pool = available(level, key, treasure);
  if (!pool.length) return out;
  out.push(weighted(r, pool));
  while (r.int(50) <= level) {
    pool = pool.filter(x => out.every(o => compatible(o.id, x.id)));
    if (!pool.length) break;
    out.push(weighted(r, pool));
    level = Math.floor(level / 2);
  }
  return out;
}
// The three offers for an item: { costs, clues: [{ id, level }|null], picks: [[...]] }.
export function tableOffers(seed, key, shelves) {
  const r = rng(seed), costs = [0, 0, 0], picks = [null, null, null], clues = [null, null, null];
  for (let i = 0; i < 3; i++) { costs[i] = tableCost(r, i, shelves, key); if (costs[i] < i + 1) costs[i] = 0; }
  for (let i = 0; i < 3; i++) {
    if (!costs[i]) continue;
    const rr = rng((seed + i) * 2654435761);
    const list = selectEnchantments(rr, key, costs[i]);
    if (key === 'book' && list.length > 1) list.splice(rr.int(list.length), 1);
    if (!list.length) { costs[i] = 0; continue; }
    picks[i] = list;
    clues[i] = list[rng(seed ^ (i * 0x9e3779b9)).int(list.length)];
  }
  return { costs, clues, picks };
}

// ---------------- the anvil ----------------
const RARITY_COST = { common: 1, uncommon: 2, rare: 4, very_rare: 8 };
export const repairCost = s => (s && s.tag && s.tag.rc) || 0;
export const repairMaterial = key => {
  const it = I[key];
  if (!it) return null;
  const m = (it.tool && it.tool.material) || (it.armor && it.armor.material);
  return { wooden: 'planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond', netherite: 'netherite_ingot',
    leather: 'leather', chainmail: 'iron_ingot', turtle: 'scute', elytra: 'phantom_membrane' }[m] || (key === 'shield' ? 'planks' : null);
};
// Anvil result for left + right (+ new name). Returns { result, cost, used (items taken from the
// right slot), tooExpensive } or null when nothing would happen.
export function anvilResult(left, right, name, { creative = false, isPlanks = k => /_planks$/.test(k) } = {}) {
  if (!left) return null;
  const out = { ...left, tag: left.tag ? JSON.parse(JSON.stringify(left.tag)) : undefined };
  if (!out.tag) delete out.tag;
  const lit = I[left.key];
  let cost = 0, used = 0, renameCost = 0;
  const base = repairCost(left) + repairCost(right);
  if (right) {
    const book = right.key === 'enchanted_book' && right.tag && right.tag.stored;
    const mat = repairMaterial(left.key);
    const matches = mat && (right.key === mat || (mat === 'planks' && isPlanks(right.key)));
    if (lit.durability && left.dmg && matches) {
      let k = Math.min(left.dmg, Math.floor(lit.durability / 4));
      if (k <= 0) return null;
      let dmg = left.dmg, m = 0;
      while (k > 0 && m < right.count) { dmg -= k; cost++; k = Math.min(dmg, Math.floor(lit.durability / 4)); m++; }
      out.dmg = dmg; if (!out.dmg) delete out.dmg;
      used = m;
    } else {
      if (!book && (left.key !== right.key || !lit.durability)) return null;
      if (lit.durability && !book && (left.dmg || right.dmg)) {
        const a = lit.durability - (left.dmg || 0), b = lit.durability - (right.dmg || 0);
        const sum = a + b + Math.floor(lit.durability * 12 / 100);
        const dmg = Math.max(0, lit.durability - sum);
        if (dmg < (left.dmg || 0)) { out.dmg = dmg; if (!out.dmg) delete out.dmg; cost += 2; }
      }
      const mine = { ...enchantsOf(left) }, theirs = enchantsOf(right);
      let any = false, blocked = false;
      for (const [id, lv2] of Object.entries(theirs)) {
        const e = ENCHANTS[id];
        if (!e) continue;
        const lv1 = mine[id] || 0;
        let lv = lv1 === lv2 ? lv2 + 1 : Math.max(lv1, lv2);
        let ok = creative || canEnchant(id, left.key, { anvil: true });
        for (const other of Object.keys(mine)) if (other !== id && !compatible(id, other)) { ok = false; cost++; }
        if (!ok) { blocked = true; continue; }
        any = true;
        lv = Math.min(lv, e.max);
        mine[id] = lv;
        let c = RARITY_COST[e.rarity];
        if (book) c = Math.max(1, Math.floor(c / 2));
        cost += c * lv;
        if (left.count > 1) cost = 40;
      }
      if (blocked && !any) return null;
      setEnchants(out, mine);
      used = 1;
    }
  }
  const oldName = left.tag && left.tag.name;
  if (name !== undefined && name !== null) {
    const want = name.trim();
    const current = oldName || '';
    const def = lit.name;
    if (want && want !== current && !(want === def && !oldName)) { renameCost = 1; cost += 1; out.tag = { ...(out.tag || {}), name: want }; }
    else if (!want && oldName) { renameCost = 1; cost += 1; delete out.tag.name; if (!Object.keys(out.tag).length) delete out.tag; }
  }
  if (cost <= 0) return null;
  let total = base + cost;
  if (renameCost === cost && renameCost > 0 && total >= 40) total = 39;
  const tooExpensive = total >= 40 && !creative;
  let rc = Math.max(repairCost(left), repairCost(right));
  if (renameCost !== cost || renameCost === 0) rc = rc * 2 + 1;
  out.tag = { ...(out.tag || {}), rc };
  return { result: out, cost: total, used, tooExpensive };
}

// ---------------- loot ----------------
// A random enchantment at a random level, as on books in chests and from librarians.
export function randomBookEnchant(r = Math.random, { treasure = true, trade = false } = {}) {
  const list = ENCHANT_LIST.filter(e => (treasure || !e.treasure) && !(trade && e.noTrade));
  const e = list[Math.floor(r() * list.length)];
  return { id: e.id, level: 1 + Math.floor(r() * e.max) };
}
// Enchant an item as if at the table with `levels` levels ("enchant_with_levels" in loot tables).
export function enchantWithLevels(s, levels, r = Math.random, treasure = false) {
  const rr = { float: r, int: n => Math.floor(r() * n) };
  const key = s.key === 'enchanted_book' ? 'book' : s.key;
  const list = selectEnchantments(rr, key, levels, treasure);
  if (s.key === 'book' && list.length) { s.key = 'enchanted_book'; }
  return setEnchants(s, Object.fromEntries(list.map(x => [x.id, x.level])));
}
