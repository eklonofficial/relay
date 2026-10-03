// Villager trade tables: [level, buy, buy2?, sell, maxUses, xp]. Emerald economy like the original.
import { randomBookEnchant, ENCHANTS } from '../data/enchantments.js?v=mush3nyu';
const E = n => ({ key: 'emerald', count: n });
const K = (key, count = 1) => ({ key, count });
// Librarians sell a random enchanted book (rolled when the trade unlocks): 2 + rand(5 + 10*level)
// + 3*level emeralds plus a book, doubled for treasure enchantments, at most 64.
const BOOK = { key: 'enchanted_book', count: 1, random: true };
function concrete([l, buy, buy2, sell]) {
  if (!sell.random) return [l, buy, buy2, sell];
  const b = randomBookEnchant(Math.random, { trade: true });
  const cost = Math.min(64, (2 + Math.floor(Math.random() * (5 + b.level * 10)) + 3 * b.level) * (ENCHANTS[b.id].treasure ? 2 : 1));
  return [l, E(cost), K('book'), { key: 'enchanted_book', count: 1, tag: { stored: { [b.id]: b.level } } }];
}
const T = {
  farmer: [[1, K('wheat', 20), null, E(1)], [1, K('potato', 26), null, E(1)], [1, E(1), null, K('bread', 6)], [2, K('pumpkin', 6), null, E(1)], [2, E(1), null, K('pumpkin_pie', 4)], [3, K('melon', 4), null, E(1)], [3, E(3), null, K('cookie', 18)], [4, E(1), null, K('golden_carrot', 3)], [5, E(4), null, K('enchanted_golden_apple', 1)]],
  librarian: [[1, K('paper', 24), null, E(1)], [1, E(9), null, K('bookshelf', 1)], [1, null, null, BOOK], [2, null, null, BOOK], [3, null, null, BOOK], [4, null, null, BOOK], [2, K('book', 4), null, E(1)], [2, E(1), null, K('lantern', 1)], [3, K('ink_sac', 5), null, E(1)], [3, E(1), null, K('glass', 4)], [4, E(5), null, K('clock', 1)], [4, E(4), null, K('compass', 1)], [5, E(20), null, K('name_tag', 1)]],
  armorer: [[1, K('coal', 15), null, E(1)], [1, E(7), null, K('iron_helmet', 1)], [1, E(9), null, K('iron_chestplate', 1)], [2, K('iron_ingot', 4), null, E(1)], [2, E(4), null, K('chainmail_boots', 1)], [2, E(7), null, K('chainmail_leggings', 1)], [3, K('lava_bucket', 1), null, E(1)], [3, E(5), null, K('shield', 1)], [4, E(15), null, K('diamond_helmet', 1)], [5, E(24), null, K('diamond_chestplate', 1)]],
  weaponsmith: [[1, K('coal', 15), null, E(1)], [1, E(3), null, K('iron_axe', 1)], [2, K('iron_ingot', 4), null, E(1)], [2, E(5), null, K('iron_sword', 1)], [3, K('flint', 24), null, E(1)], [4, E(12), null, K('diamond_axe', 1)], [5, E(18), null, K('diamond_sword', 1)]],
  toolsmith: [[1, K('coal', 15), null, E(1)], [1, E(1), null, K('stone_axe', 1)], [1, E(1), null, K('stone_pickaxe', 1)], [2, K('iron_ingot', 4), null, E(1)], [3, E(4), null, K('iron_pickaxe', 1)], [3, K('flint', 30), null, E(1)], [4, E(12), null, K('diamond_shovel', 1)], [5, E(18), null, K('diamond_pickaxe', 1)]],
  butcher: [[1, K('chicken', 14), null, E(1)], [1, K('porkchop', 7), null, E(1)], [1, E(1), null, K('rabbit_stew', 1)], [2, K('coal', 15), null, E(1)], [2, E(1), null, K('cooked_porkchop', 5)], [3, K('mutton', 7), null, E(1)], [3, K('beef', 10), null, E(1)], [4, K('dried_kelp', 10), null, E(1)], [5, K('sweet_berries', 10), null, E(1)]],
  cleric: [[1, K('rotten_flesh', 32), null, E(1)], [1, E(1), null, K('redstone', 2)], [2, K('gold_ingot', 3), null, E(1)], [2, E(1), null, K('lapis_lazuli', 1)], [3, K('rabbit_foot', 2), null, E(1)], [3, E(4), null, K('glowstone', 1)], [4, K('scute', 4), null, E(1)], [4, K('glass_bottle', 9), null, E(1)], [5, K('nether_wart', 22), null, E(1)], [5, E(3), null, K('experience_bottle', 1)]],
  fletcher: [[1, K('stick', 32), null, E(1)], [1, E(1), null, K('arrow', 16)], [1, E(1), K('gravel', 10), K('flint', 10)], [2, K('flint', 26), null, E(1)], [2, E(2), null, K('bow', 1)], [3, K('string', 14), null, E(1)], [3, E(3), null, K('crossbow', 1)], [4, K('feather', 24), null, E(1)], [5, E(2), K('arrow', 5), K('spectral_arrow', 5)]],
  leatherworker: [[1, K('leather', 6), null, E(1)], [1, E(3), null, K('leather_leggings', 1)], [1, E(7), null, K('leather_chestplate', 1)], [2, K('flint', 26), null, E(1)], [2, E(5), null, K('leather_helmet', 1)], [3, K('rabbit_hide', 9), null, E(1)], [3, E(4), null, K('leather_boots', 1)], [5, E(6), null, K('saddle', 1)]],
  shepherd: [[1, K('white_wool', 18), null, E(1)], [1, K('brown_wool', 18), null, E(1)], [1, E(2), null, K('shears', 1)], [2, K('white_dye', 12), null, E(1)], [2, E(1), null, K('white_wool', 1)], [3, E(1), null, K('red_wool', 1)], [4, E(3), null, K('white_bed' in {} ? 'white_bed' : 'bed', 1)], [5, E(1), null, K('painting' in {} ? 'painting' : 'cyan_wool', 3)]],
  fisherman: [[1, K('string', 20), null, E(1)], [1, K('coal', 10), null, E(1)], [1, E(1), K('cod', 6), K('cooked_cod', 6)], [2, K('cod', 15), null, E(1)], [2, E(1), K('salmon', 6), K('cooked_salmon', 6)], [3, K('salmon', 13), null, E(1)], [3, E(3), null, K('fishing_rod', 1)], [4, K('tropical_fish', 6), null, E(1)], [5, K('pufferfish', 4), null, E(1)]],
  mason: [[1, K('clay_ball', 10), null, E(1)], [1, E(1), null, K('bricks', 10)], [2, K('stone', 20), null, E(1)], [2, E(1), null, K('chiseled_stone_bricks', 4)], [3, K('granite', 16), null, E(1)], [3, E(1), null, K('polished_andesite', 4)], [4, K('quartz', 12), null, E(1)], [4, E(1), null, K('white_terracotta', 1)], [5, E(1), null, K('quartz_block', 1)]],
  cartographer: [[1, K('paper', 24), null, E(1)], [1, E(7), null, K('compass', 1)], [2, K('glass_pane', 11), null, E(1)], [3, K('compass', 1), null, E(1)], [4, E(7), null, K('clock', 1)], [5, E(8), null, K('name_tag', 1)]],
  trader: [[1, E(1), null, K('sea_pickle' in {} ? 'kelp' : 'kelp', 1)], [1, E(3), null, K('glowstone', 1)], [1, E(1), null, K('fern', 1)], [1, E(5), null, K('blue_ice', 1)], [1, E(1), null, K('cactus', 1)], [1, E(1), null, K('dandelion', 1)], [1, E(3), null, K('slime_ball', 1)], [1, E(5), null, K('packed_ice', 1)], [1, E(1), null, K('cherry_sapling', 1)], [1, E(1), null, K('bamboo', 1)], [1, E(3), null, K('nautilus_shell', 1)], [1, E(1), null, K('red_sand', 4)]],
  nitwit: [],
};
export function villagerTrades(prof, level, fresh) {
  const list = T[prof] || [];
  const out = [];
  if (prof === 'trader') {
    const pick = list.slice().sort(() => Math.random() - 0.5).slice(0, 6);
    for (const [, buy, buy2, sell] of pick) out.push({ buy, buy2, sell, uses: 0, maxUses: 6, xp: 1, level: 1 });
    return out;
  }
  for (let lv = 1; lv <= (fresh ? 1 : level); lv++) {
    const tier = list.filter(t => t[0] === lv).sort(() => Math.random() - 0.5).slice(0, 2);
    for (const [l, buy, buy2, sell] of tier.map(concrete)) out.push({ buy, buy2, sell, uses: 0, maxUses: 12, xp: [0, 2, 10, 20, 30, 30][l], level: l });
  }
  return out;
}
export function unlockLevel(prof, level) {
  const list = (T[prof] || []).filter(t => t[0] === level).sort(() => Math.random() - 0.5).slice(0, 2);
  return list.map(concrete).map(([l, buy, buy2, sell]) => ({ buy, buy2, sell, uses: 0, maxUses: 12, xp: [0, 2, 10, 20, 30, 30][l], level: l }));
}
