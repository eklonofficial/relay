// Crafting (shaped / shapeless) and smelting recipes, with ingredient tags.
import { WOODS, COLORS, SHAPED_MATERIALS } from './blocks.js?v=muso40ud';
import { I } from './items.js?v=muso40ud';

const has = k => !!I[k];
export const TAGS = {
  planks: WOODS.map(w => `${w}_planks`),
  logs: WOODS.map(w => w === 'crimson' || w === 'warped' ? `${w}_stem` : `${w}_log`),
  wool: COLORS.map(c => `${c}_wool`),
  coals: ['coal', 'charcoal'],
  stone_tool: ['cobblestone', 'cobbled_deepslate', 'blackstone'],
  sand: ['sand', 'red_sand'],
  leaves: ['oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'cherry_leaves', 'mangrove_leaves'],
  slabs_wood: SHAPED_MATERIALS.slice(0, 7).map(m => `${m[0]}_slab`),
  soul: ['soul_sand', 'soul_soil'],
};
export const matches = (spec, key) => spec === key || (spec[0] === '#' && TAGS[spec.slice(1)].includes(key));

export const SHAPED = [];
export const SHAPELESS = [];
export const SMELTING = {};

// shaped(['XX', 'XX'], { X: 'planks' }, 'crafting_table', 1)
function shaped(pattern, key, out, count = 1) {
  for (const k of Object.values(key)) if (k[0] !== '#' && !has(k)) throw new Error(`recipe ingredient ${k}`);
  if (!has(out)) throw new Error(`recipe output ${out}`);
  SHAPED.push({ pattern, key, out, count, w: pattern[0].length, h: pattern.length });
}
function shapeless(ings, out, count = 1) {
  for (const k of ings) if (k[0] !== '#' && !has(k)) throw new Error(`recipe ingredient ${k}`);
  if (!has(out)) throw new Error(`recipe output ${out}`);
  SHAPELESS.push({ ings, out, count });
}
function smelt(input, out, xp = 0.1, count = 1) {
  if (!has(input) || !has(out)) throw new Error(`smelt ${input} -> ${out}`);
  SMELTING[input] = { out, xp, count };
}

// ---- wood ----
WOODS.forEach((w, i) => {
  const log = TAGS.logs[i], planks = `${w}_planks`;
  shapeless([log], planks, 4);
  shapeless(['paper', 'gunpowder'], 'firework_rocket', 3);
  if (has(`${w}_door`)) shaped(['XX', 'XX', 'XX'], { X: planks }, `${w}_door`, 3);
  if (has(`${w}_trapdoor`)) shaped(['XXX', 'XXX'], { X: planks }, `${w}_trapdoor`, 2);
  if (has(`${w}_fence`)) shaped(['X#X', 'X#X'], { X: planks, '#': 'stick' }, `${w}_fence`, 3);
  if (has(`${w}_slab`)) shaped(['XXX'], { X: planks }, `${w}_slab`, 6);
  if (has(`${w}_stairs`)) shaped(['X  ', 'XX ', 'XXX'], { X: planks }, `${w}_stairs`, 4);
});
shaped(['X', 'X'], { X: '#planks' }, 'stick', 4);
shaped(['XX', 'XX'], { X: '#planks' }, 'crafting_table');
shaped(['XXX', 'X X', 'XXX'], { X: '#planks' }, 'chest');
shaped(['X X', ' X '], { X: '#planks' }, 'bowl', 4);
shaped(['X X', 'XXX', 'X X'], { X: 'stick' }, 'ladder', 3);
shaped(['WWW', 'PPP'], { W: '#wool', P: '#planks' }, 'bed');
shaped(['PPP', 'BBB', 'PPP'], { P: '#planks', B: 'book' }, 'bookshelf');
shaped([' B ', 'DOD', 'OOO'], { B: 'book', D: 'diamond', O: 'obsidian' }, 'enchanting_table');
shaped(['III', ' i ', 'iii'], { I: 'iron_block', i: 'iron_ingot' }, 'anvil');
shaped(['PPP', 'PDP', 'PPP'], { P: '#planks', D: 'diamond' }, 'jukebox');
shaped(['PPP', 'PRP', 'PPP'], { P: '#planks', R: 'redstone' }, 'note_block');
shaped(['PSP', 'P P', 'PSP'], { P: '#planks', S: '#slabs_wood' }, 'barrel');
shaped([' S ', 'SCS', 'LLL'], { S: 'stick', C: '#coals', L: '#logs' }, 'campfire');

// ---- tools, weapons, armor ----
const TOOL_PATTERNS = {
  pickaxe: ['XXX', ' # ', ' # '], axe: ['XX', 'X#', ' #'], shovel: ['X', '#', '#'], hoe: ['XX', ' #', ' #'], sword: ['X', 'X', '#'],
};
const TOOL_MATS = { wooden: '#planks', stone: '#stone_tool', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [mat, ing] of Object.entries(TOOL_MATS)) for (const [type, pat] of Object.entries(TOOL_PATTERNS)) shaped(pat, { X: ing, '#': 'stick' }, `${mat}_${type}`);
for (const type of Object.keys(TOOL_PATTERNS)) shapeless([`diamond_${type}`, 'netherite_ingot'], `netherite_${type}`);
const ARMOR_PATTERNS = { helmet: ['XXX', 'X X'], chestplate: ['X X', 'XXX', 'XXX'], leggings: ['XXX', 'X X', 'X X'], boots: ['X X', 'X X'] };
for (const [mat, ing] of Object.entries({ leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' })) {
  for (const [piece, pat] of Object.entries(ARMOR_PATTERNS)) shaped(pat, { X: ing }, `${mat}_${piece}`);
}
for (const piece of Object.keys(ARMOR_PATTERNS)) shapeless([`diamond_${piece}`, 'netherite_ingot'], `netherite_${piece}`);
shaped(['XXX', 'X X'], { X: 'scute' }, 'turtle_helmet');
shaped([' #S', '# S', ' #S'], { '#': 'stick', S: 'string' }, 'bow');
shaped(['#I#', 'S S', ' # '], { '#': 'stick', I: 'iron_ingot', S: 'string' }, 'crossbow');
shaped(['F', '#', 'E'], { F: 'flint', '#': 'stick', E: 'feather' }, 'arrow', 4);
shaped([' G ', 'GAG', ' G '], { G: 'glowstone_dust', A: 'arrow' }, 'spectral_arrow', 2);
shaped(['PIP', 'PPP', ' P '], { P: '#planks', I: 'iron_ingot' }, 'shield');
shaped(['  #', ' #S', '# S'], { '#': 'stick', S: 'string' }, 'fishing_rod');
shaped([' I', 'I '], { I: 'iron_ingot' }, 'shears');
shapeless(['iron_ingot', 'flint'], 'flint_and_steel');
shaped(['I I', ' I '], { I: 'iron_ingot' }, 'bucket');
shaped([' I ', 'IRI', ' I '], { I: 'iron_ingot', R: 'redstone' }, 'compass');
shaped([' G ', 'GRG', ' G '], { G: 'gold_ingot', R: 'redstone' }, 'clock');
shapeless(['blaze_powder', 'gunpowder', '#coals'], 'fire_charge', 3);
shaped(['LLL', 'L L'], { L: 'leather' }, 'saddle');
shaped(['SS ', 'SB ', '  S'], { S: 'string', B: 'slime_ball' }, 'lead', 2);

// ---- light & functional ----
shaped(['C', '#'], { C: '#coals', '#': 'stick' }, 'torch', 4);
shaped(['C', '#', 'S'], { C: '#coals', '#': 'stick', S: '#soul' }, 'soul_torch', 4);
shaped(['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'torch' }, 'lantern');
shaped(['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'soul_torch' }, 'soul_lantern');
shaped(['XXX', 'X X', 'XXX'], { X: '#stone_tool' }, 'furnace');
shaped(['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: '#sand' }, 'tnt');
shaped(['I I', 'I#I', 'I I'], { I: 'iron_ingot', '#': 'stick' }, 'rail', 16);
// ---- redstone ----
shaped(['R', '#'], { R: 'redstone', '#': 'stick' }, 'redstone_torch');
shaped(['TRT', 'SSS'], { T: 'redstone_torch', R: 'redstone', S: 'stone' }, 'repeater');
shaped([' T ', 'TQT', 'SSS'], { T: 'redstone_torch', Q: 'quartz', S: 'stone' }, 'comparator');
shaped(['#', 'C'], { '#': 'stick', C: 'cobblestone' }, 'lever');
shapeless(['stone'], 'stone_button');
shapeless(['polished_blackstone'], 'polished_blackstone_button');
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) { shapeless([`${w}_planks`], `${w}_button`); }
shaped(['SS'], { S: 'stone' }, 'stone_pressure_plate');
shaped(['PP'], { P: '#planks' }, 'oak_pressure_plate');
shaped(['GG'], { G: 'gold_ingot' }, 'light_weighted_pressure_plate');
shaped(['II'], { I: 'iron_ingot' }, 'heavy_weighted_pressure_plate');
shaped([' R ', 'RHR', ' R '], { R: 'redstone', H: 'hay_block' }, 'target');
shaped(['CCC', 'RRQ', 'CCC'], { C: 'cobblestone', R: 'redstone', Q: 'quartz' }, 'observer');
shaped(['GGG', 'QQQ', 'WWW'], { G: 'glass', Q: 'quartz', W: '#slabs_wood' }, 'daylight_detector');
shaped(['PPP', 'CIC', 'CRC'], { P: '#planks', C: 'cobblestone', I: 'iron_ingot', R: 'redstone' }, 'piston');
shaped(['S', 'P'], { S: 'slime_ball', P: 'piston' }, 'sticky_piston');
shaped(['I I', 'ICI', ' I '], { I: 'iron_ingot', C: 'chest' }, 'hopper');
shaped(['CCC', 'CBC', 'CRC'], { C: 'cobblestone', B: 'bow', R: 'redstone' }, 'dispenser');
shaped(['CCC', 'C C', 'CRC'], { C: 'cobblestone', R: 'redstone' }, 'dropper');
shaped([' R ', 'RGR', ' R '], { R: 'redstone', G: 'glowstone' }, 'redstone_lamp');
shaped(['SCS', 'CCC', 'SCS'], { S: 'prismarine_shard', C: 'prismarine_crystals' }, 'sea_lantern');
shaped(['B', 'C'], { B: 'blaze_rod', C: 'chorus_fruit' }, 'end_rod', 4);
shapeless(['ender_pearl', 'blaze_powder'], 'ender_eye');
shapeless(['blaze_rod'], 'blaze_powder', 2);
shapeless(['blaze_powder', 'slime_ball'], 'magma_cream');
shaped(['XX', 'XX'], { X: 'glowstone_dust' }, 'glowstone');

// ---- storage blocks ----
const STORAGE = [['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'], ['diamond', 'diamond_block'], ['emerald', 'emerald_block'],
  ['lapis_lazuli', 'lapis_block'], ['redstone', 'redstone_block'], ['coal', 'coal_block'], ['copper_ingot', 'copper_block'], ['netherite_ingot', 'netherite_block'],
  ['raw_iron', 'raw_iron_block'], ['raw_gold', 'raw_gold_block'], ['raw_copper', 'raw_copper_block'], ['wheat', 'hay_block'], ['bone_meal', 'bone_block'], ['melon_slice', 'melon'], ['slime_ball', 'slime_block']];
for (const [item, block] of STORAGE) {
  shaped(['XXX', 'XXX', 'XXX'], { X: item }, block);
  if (block !== 'melon') shapeless([block], item, 9);
}
shaped(['XXX', 'XXX', 'XXX'], { X: 'iron_nugget' }, 'iron_ingot');
shaped(['XXX', 'XXX', 'XXX'], { X: 'gold_nugget' }, 'gold_ingot');
shapeless(['iron_ingot'], 'iron_nugget', 9);
shapeless(['gold_ingot'], 'gold_nugget', 9);
shapeless(['netherite_scrap', 'netherite_scrap', 'netherite_scrap', 'netherite_scrap', 'gold_ingot', 'gold_ingot', 'gold_ingot', 'gold_ingot'], 'netherite_ingot');
shaped(['XX', 'XX'], { X: 'amethyst_shard' }, 'amethyst_block');
shaped(['XX', 'XX'], { X: 'quartz' }, 'quartz_block');
shaped(['XX', 'XX'], { X: 'quartz_block' }, 'quartz_bricks', 4);

// ---- stone & masonry ----
shaped(['XX', 'XX'], { X: 'stone' }, 'stone_bricks', 4);
shaped(['XX', 'XX'], { X: 'brick' }, 'bricks');
shaped(['XX', 'XX'], { X: 'nether_brick' }, 'nether_bricks');
shaped(['NW', 'WN'], { N: 'nether_brick', W: 'nether_wart' }, 'red_nether_bricks');
shaped(['XX', 'XX'], { X: 'sand' }, 'sandstone');
shaped(['XX', 'XX'], { X: 'red_sand' }, 'red_sandstone');
shaped(['XX', 'XX'], { X: 'sandstone' }, 'cut_sandstone', 4);
shaped(['XX', 'XX'], { X: 'red_sandstone' }, 'cut_red_sandstone', 4);
shaped(['XX', 'XX'], { X: 'granite' }, 'polished_granite', 4);
shaped(['XX', 'XX'], { X: 'diorite' }, 'polished_diorite', 4);
shaped(['XX', 'XX'], { X: 'andesite' }, 'polished_andesite', 4);
shaped(['XX', 'XX'], { X: 'cobbled_deepslate' }, 'polished_deepslate', 4);
shaped(['XX', 'XX'], { X: 'polished_deepslate' }, 'deepslate_bricks', 4);
shaped(['XX', 'XX'], { X: 'deepslate_bricks' }, 'deepslate_tiles', 4);
shaped(['XX', 'XX'], { X: 'end_stone' }, 'end_stone_bricks', 4);
shaped(['XX', 'XX'], { X: 'chorus_fruit' }, 'purpur_block', 4);
shaped(['X', 'X'], { X: 'purpur_block' }, 'purpur_pillar');
shaped(['XX', 'XX'], { X: 'blackstone' }, 'polished_blackstone', 4);
shaped(['XX', 'XX'], { X: 'polished_blackstone' }, 'polished_blackstone_bricks', 4);
shaped(['XX', 'XX'], { X: 'prismarine_shard' }, 'prismarine');
shaped(['XXX', 'XXX', 'XXX'], { X: 'prismarine_shard' }, 'prismarine_bricks');
shapeless(['cobblestone', 'vine'], 'mossy_cobblestone');
shapeless(['stone_bricks', 'vine'], 'mossy_stone_bricks');
shapeless(['cobblestone', 'moss_block'], 'mossy_cobblestone');
shapeless(['diorite', 'cobblestone'], 'andesite', 2);
shapeless(['diorite', 'quartz'], 'granite');
shaped(['CQ', 'QC'], { C: 'cobblestone', Q: 'quartz' }, 'diorite', 2);
shaped(['XX', 'XX'], { X: 'clay_ball' }, 'clay');
shaped(['XX', 'XX'], { X: 'snowball' }, 'snow_block');
shaped(['XXX'], { X: 'snow_block' }, 'snow', 6);
shaped(['XX', 'XX'], { X: 'string' }, 'white_wool');
shaped(['XX'], { X: 'moss_block' }, 'moss_carpet', 3);
shaped(['XXX', 'XXX'], { X: 'glass' }, 'glass_pane', 16);
shaped(['XXX', 'XXX'], { X: 'iron_ingot' }, 'iron_bars', 16);
shaped(['XX', 'XX'], { X: 'packed_ice' }, 'packed_ice');
shaped(['XXX', 'XXX', 'XXX'], { X: 'ice' }, 'packed_ice');
shaped(['XXX', 'XXX', 'XXX'], { X: 'packed_ice' }, 'blue_ice');
shaped(['XX', 'XX'], { X: 'dripstone_block' }, 'dripstone_block');
for (const [m] of SHAPED_MATERIALS.slice(7)) {
  const base = { stone: 'stone', cobblestone: 'cobblestone', stone_brick: 'stone_bricks', sandstone: 'sandstone', brick: 'bricks', nether_brick: 'nether_bricks',
    smooth_stone: 'smooth_stone', deepslate_brick: 'deepslate_bricks', quartz: 'quartz_block' }[m];
  shaped(['XXX'], { X: base }, `${m}_slab`, 6);
  shaped(['X  ', 'XX ', 'XXX'], { X: base }, `${m}_stairs`, 4);
}
shaped(['X#X', 'X#X'], { X: 'nether_bricks', '#': 'nether_brick' }, 'nether_brick_fence', 6);

// ---- food & farming ----
shaped(['WWW'], { W: 'wheat' }, 'bread');
shapeless(['pumpkin', 'sugar', 'egg'], 'pumpkin_pie');
shaped(['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' }, 'golden_apple');
shaped(['GGG', 'GAG', 'GGG'], { G: 'gold_block', A: 'apple' }, 'enchanted_golden_apple');
shaped(['GGG', 'GCG', 'GGG'], { G: 'gold_nugget', C: 'carrot' }, 'golden_carrot');
shapeless(['red_mushroom', 'brown_mushroom', 'bowl'], 'mushroom_stew');
shapeless(['beetroot', 'beetroot', 'beetroot', 'beetroot', 'beetroot', 'beetroot', 'bowl'], 'beetroot_soup');
shapeless(['cooked_rabbit', 'carrot', 'baked_potato', 'brown_mushroom', 'bowl'], 'rabbit_stew');
shapeless(['wheat', 'wheat', 'sugar'], 'cookie', 8);
shapeless(['sugar_cane'], 'sugar');
shaped(['XXX'], { X: 'sugar_cane' }, 'paper', 3);
shapeless(['paper', 'paper', 'paper', 'leather'], 'book');
shapeless(['bone'], 'bone_meal', 3);
shapeless(['pumpkin'], 'pumpkin_seeds', 4);
shapeless(['melon_slice'], 'melon_seeds');
shaped(['XXX', 'XXX', 'XXX'], { X: 'dried_kelp' }, 'hay_block');
shapeless(['carved_pumpkin', 'torch'], 'jack_o_lantern');
shaped(['XX', 'XX'], { X: 'rabbit_hide' }, 'leather');

// ---- dyes and colouring ----
const FLOWER_DYES = {
  dandelion: 'yellow', poppy: 'red', blue_orchid: 'light_blue', allium: 'magenta', azure_bluet: 'light_gray', red_tulip: 'red', orange_tulip: 'orange',
  white_tulip: 'light_gray', pink_tulip: 'pink', oxeye_daisy: 'light_gray', cornflower: 'blue', lily_of_the_valley: 'white', wither_rose: 'black', torchflower: 'orange',
};
for (const [f, c] of Object.entries(FLOWER_DYES)) shapeless([f], `${c}_dye`);
shapeless(['bone_meal'], 'white_dye');
shapeless(['ink_sac'], 'black_dye');
shapeless(['lapis_lazuli'], 'blue_dye');
shapeless(['beetroot'], 'red_dye');
shapeless(['red_dye', 'yellow_dye'], 'orange_dye', 2);
shapeless(['blue_dye', 'white_dye'], 'light_blue_dye', 2);
shapeless(['red_dye', 'white_dye'], 'pink_dye', 2);
shapeless(['black_dye', 'white_dye'], 'gray_dye', 2);
shapeless(['gray_dye', 'white_dye'], 'light_gray_dye', 2);
shapeless(['blue_dye', 'green_dye'], 'cyan_dye', 2);
shapeless(['blue_dye', 'red_dye'], 'purple_dye', 2);
shapeless(['purple_dye', 'pink_dye'], 'magenta_dye', 2);
shapeless(['green_dye', 'white_dye'], 'lime_dye', 2);
for (const c of COLORS) {
  if (c !== 'white') shapeless([`${c}_dye`, 'white_wool'], `${c}_wool`);
  shaped(['WW'], { W: `${c}_wool` }, `${c}_carpet`, 3);
  shaped(['GGG', 'GDG', 'GGG'], { G: 'glass', D: `${c}_dye` }, `${c}_stained_glass`, 8);
  shaped(['TTT', 'TDT', 'TTT'], { T: 'terracotta', D: `${c}_dye` }, `${c}_terracotta`, 8);
  shapeless([`${c}_dye`, 'sand', 'sand', 'sand', 'sand', 'gravel', 'gravel', 'gravel', 'gravel'], `${c}_concrete`, 8);
}

// ---- smelting ----
for (const o of ['iron', 'gold', 'copper']) { smelt(`raw_${o}`, `${o}_ingot`, 0.7); smelt(`${o}_ore`, `${o}_ingot`, 0.7); smelt(`deepslate_${o}_ore`, `${o}_ingot`, 0.7); }
for (const [o, out] of [['coal', 'coal'], ['diamond', 'diamond'], ['emerald', 'emerald'], ['lapis', 'lapis_lazuli'], ['redstone', 'redstone']]) { smelt(`${o}_ore`, out, 1); smelt(`deepslate_${o}_ore`, out, 1); }
smelt('nether_gold_ore', 'gold_ingot', 1); smelt('nether_quartz_ore', 'quartz', 0.2); smelt('ancient_debris', 'netherite_scrap', 2);
for (const k of ['sand', 'red_sand']) smelt(k, 'glass', 0.1);
smelt('cobblestone', 'stone'); smelt('stone', 'smooth_stone'); smelt('cobbled_deepslate', 'deepslate'); smelt('stone_bricks', 'cracked_stone_bricks');
smelt('sandstone', 'smooth_sandstone'); smelt('red_sandstone', 'smooth_red_sandstone'); smelt('clay_ball', 'brick', 0.3); smelt('clay', 'terracotta', 0.35);
smelt('netherrack', 'nether_brick'); smelt('basalt', 'polished_basalt'); smelt('wet_sponge', 'sponge'); smelt('cactus', 'green_dye', 1);
smelt('kelp', 'dried_kelp'); smelt('chorus_fruit', 'purpur_block'); smelt('sea_pickle' in I ? 'sea_pickle' : 'kelp', 'dried_kelp');
for (const l of TAGS.logs) smelt(l, 'charcoal', 0.15);
for (const [raw, cooked] of [['porkchop', 'cooked_porkchop'], ['beef', 'cooked_beef'], ['chicken', 'cooked_chicken'], ['mutton', 'cooked_mutton'], ['rabbit', 'cooked_rabbit'],
  ['cod', 'cooked_cod'], ['salmon', 'cooked_salmon'], ['potato', 'baked_potato']]) smelt(raw, cooked, 0.35);
for (const c of COLORS) if (I[`${c}_terracotta`]) { /* glazed terracotta not included */ }

// ---- matching ----
function normalize(grid, size) {
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (grid[y * size + x]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  if (maxX < 0) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1, cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(grid[(y + minY) * size + x + minX]);
  return { w, h, cells };
}
function shapedMatch(r, n, mirror) {
  if (r.w !== n.w || r.h !== n.h) return false;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const ch = r.pattern[y][mirror ? r.w - 1 - x : x];
    const cell = n.cells[y * n.w + x];
    if (ch === ' ') { if (cell) return false; continue; }
    if (!cell || !matches(r.key[ch], cell)) return false;
  }
  return true;
}
// grid: array of item keys (or null), size 2 or 3. Returns { out, count } or null.
export function findRecipe(grid, size) {
  const n = normalize(grid, size);
  if (!n) return null;
  for (const r of SHAPED) if (r.w <= size && r.h <= size && (shapedMatch(r, n, false) || shapedMatch(r, n, true))) return r;
  const items = grid.filter(Boolean);
  for (const r of SHAPELESS) {
    if (r.ings.length !== items.length || r.ings.length > size * size) continue;
    const left = items.slice();
    let ok = true;
    for (const spec of r.ings) {
      const i = left.findIndex(k => matches(spec, k));
      if (i < 0) { ok = false; break; }
      left.splice(i, 1);
    }
    if (ok) return r;
  }
  return null;
}

// For the recipe book: every recipe as a list of ingredient specs with grid positions.
export function allRecipes() {
  const out = [];
  for (const r of SHAPED) {
    const cells = [];
    r.pattern.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') cells.push({ x, y, spec: r.key[ch] }); }));
    out.push({ out: r.out, count: r.count, cells, w: r.w, h: r.h, shaped: true });
  }
  for (const r of SHAPELESS) out.push({ out: r.out, count: r.count, cells: r.ings.map((spec, i) => ({ x: i % 3, y: (i / 3) | 0, spec })), w: Math.min(3, r.ings.length), h: Math.ceil(r.ings.length / 3), shaped: false });
  return out;
}
