// Block states between Blockhaven and Java Edition (1.20.1 names), both directions.
//
// toJava(id, meta, nb) -> { name, props }  (nb(dx, dy, dz) gives a neighbour's id, for fences
//                                           and panes, whose connections Java stores in the state)
// fromJava(name, props) -> state (id | meta << 8); unknown blocks fall back to the closest family
//                          we have (stairs to stairs, logs to logs, ...), then to stone or air.
import { BLOCKS, B, STATE, SHAPE, SHAPE_OF, OPAQUE, CROP_STAGES, CROP_AGE_SHIFT, COLORS } from '../data/blocks.js?v=muujmd4c';

const H = ['south', 'west', 'north', 'east'];                       // our 2D facing order
const D6 = ['down', 'up', 'north', 'south', 'west', 'east'];         // Java's six-way order
const OPP2 = f => (f + 2) & 3;
const h2 = name => Math.max(0, H.indexOf(name));
const d6 = name => Math.max(0, D6.indexOf(name));
const bool = v => v === true || v === 'true';
const S = (id, m) => id | (m << 8);

// Our keys that are not Java names, and Java names that are ours under another name.
const OUT_NAME = {
  short_grass: 'grass', grass_block_snowy: 'grass_block', farmland_moist: 'farmland', lit_furnace: 'furnace',
  redstone_lamp_on: 'redstone_lamp', redstone_torch_off: 'redstone_torch', legacy_note_block: 'note_block',
  legacy_redstone_lamp: 'redstone_lamp', legacy_target: 'target', legacy_redstone_block: 'redstone_block',
};
const IN_ALIAS = {
  grass: 'short_grass', tall_grass: 'short_grass', large_fern: 'fern', tall_seagrass: 'seagrass', kelp_plant: 'kelp',
  sunflower: 'dandelion', lilac: 'allium', rose_bush: 'poppy', peony: 'pink_tulip', pitcher_plant: 'allium', pink_petals: 'pink_tulip',
  cave_air: 'air', void_air: 'air', bubble_column: 'water', bamboo_sapling: 'bamboo', twisting_vines: 'vine', weeping_vines: 'vine',
  twisting_vines_plant: 'vine', weeping_vines_plant: 'vine', cave_vines_plant: 'cave_vines', sugar_cane: 'sugar_cane',
  dirt_path: 'dirt_path', grass_path: 'dirt_path', chiseled_stone_bricks: 'chiseled_stone_bricks', snow_block: 'snow_block',
  azalea: 'oak_sapling', flowering_azalea: 'oak_sapling', mangrove_propagule: 'mangrove_sapling', spore_blossom: 'air',
  hanging_roots: 'air', small_dripleaf: 'fern', big_dripleaf: 'lily_pad', big_dripleaf_stem: 'air', glow_berries: 'cave_vines',
  bamboo_block: 'oak_log', stripped_bamboo_block: 'oak_log', bamboo_mosaic: 'oak_planks', muddy_mangrove_roots: 'mangrove_roots',
  cobbled_deepslate: 'cobbled_deepslate', smooth_basalt: 'basalt', reinforced_deepslate: 'deepslate', budding_amethyst: 'amethyst_block',
  small_amethyst_bud: 'amethyst_cluster', medium_amethyst_bud: 'amethyst_cluster', large_amethyst_bud: 'amethyst_cluster',
  respawn_anchor: 'crying_obsidian', lodestone: 'stone_bricks', smithing_table: 'crafting_table', fletching_table: 'crafting_table',
  cartography_table: 'crafting_table', loom: 'crafting_table', stonecutter: 'smooth_stone', grindstone: 'smooth_stone',
  blast_furnace: 'furnace', smoker: 'furnace', composter: 'barrel', beehive: 'barrel', bee_nest: 'barrel', lectern: 'bookshelf',
  chiseled_bookshelf: 'bookshelf', trapped_chest: 'chest', ender_chest: 'chest',
  cauldron: 'iron_block', water_cauldron: 'iron_block', lava_cauldron: 'iron_block',
  powder_snow_cauldron: 'iron_block', beacon: 'glass', conduit: 'glass', tinted_glass: 'black_stained_glass', powder_snow: 'snow_block',
  frosted_ice: 'ice', soul_campfire: 'campfire', mud_bricks: 'mud_bricks', sculk: 'black_concrete', sculk_catalyst: 'black_concrete',
  sculk_shrieker: 'black_concrete', sculk_sensor: 'black_concrete', calibrated_sculk_sensor: 'black_concrete', sculk_vein: 'air',
  observer: 'observer', honeycomb_block: 'honey_block', packed_mud: 'packed_mud', dried_kelp_block: 'moss_block', target: 'target',
  sea_pickle: 'air', decorated_pot: 'terracotta', suspicious_sand: 'sand', suspicious_gravel: 'gravel', pearlescent_froglight: 'shroomlight',
  verdant_froglight: 'shroomlight', ochre_froglight: 'shroomlight', crafter: 'crafting_table', jigsaw: 'air', structure_block: 'air',
  structure_void: 'air', barrier: 'air', light: 'air', command_block: 'iron_block', chain_command_block: 'iron_block', repeating_command_block: 'iron_block',
  netherite_block: 'netherite_block', crimson_hyphae: 'crimson_stem', warped_hyphae: 'warped_stem',
  quartz_pillar: 'quartz_block', chiseled_quartz_block: 'quartz_block', smooth_quartz: 'quartz_block', chiseled_nether_bricks: 'nether_bricks',
  cracked_nether_bricks: 'nether_bricks', chiseled_polished_blackstone: 'polished_blackstone', cracked_polished_blackstone_bricks: 'polished_blackstone_bricks',
  chiseled_deepslate: 'polished_deepslate', cracked_deepslate_bricks: 'deepslate_bricks', cracked_deepslate_tiles: 'deepslate_tiles',
  smooth_red_sandstone: 'smooth_red_sandstone', end_gateway: 'end_portal', piston_extension: 'air', moving_piston: 'air',
  melon_stem: 'melon_stem', attached_melon_stem: 'melon_stem', attached_pumpkin_stem: 'pumpkin_stem', cocoa: 'air', torchflower_crop: 'wheat',
  pitcher_crop: 'wheat', frogspawn: 'air', turtle_egg: 'air', sniffer_egg: 'air', dragon_head: 'skeleton_skull', zombie_head: 'skeleton_skull',
  creeper_head: 'skeleton_skull', piglin_head: 'skeleton_skull', player_head: 'skeleton_skull',
};
const WOOD_WORDS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'mangrove', 'bamboo', 'crimson', 'warped'];

// ---------------- Blockhaven -> Java ----------------
const FENCE_LIKE = new Set([SHAPE.FENCE, SHAPE.PANE]);
function connects(id, nid) {
  if (nid === undefined || nid < 0) return false;
  if (OPAQUE[nid]) return true;
  const a = SHAPE_OF[id], b = SHAPE_OF[nid];
  if (a === SHAPE.FENCE) return b === SHAPE.FENCE;
  if (a === SHAPE.PANE) return b === SHAPE.PANE || nid === B.GLASS || nid === B.STAINED_GLASS;
  return false;
}
const NOTE_INSTRUMENT = id => {
  if (id === B.PLANKS || id === B.LOG || id === B.BOOKSHELF || id === B.CRAFTING_TABLE || id === B.CHEST) return 'bass';
  if (id === B.SAND || id === B.GRAVEL || id === B.SOUL_SAND) return 'snare';
  if (id === B.GLASS || id === B.STAINED_GLASS || id === B.GLOWSTONE) return 'hat';
  if (id === B.STONE || id === B.COBBLESTONE || id === B.BRICKS || id === B.OBSIDIAN || id === B.NETHERRACK || id === B.ORE || id === B.SANDSTONE) return 'basedrum';
  if (id === B.WOOL) return 'guitar';
  if (id === B.PACKED_ICE) return 'chime';
  if (id === B.DIRT) return 'flute';
  return 'harp';
};
const JAVA_CROP_MAX = [7, 7, 7, 3, 7, 7, 3];

export function toJava(id, m, nb = () => -1) {
  const b = BLOCKS[id];
  if (!b || id === B.AIR || id === B.MOVING_PISTON) return { name: 'air', props: null };
  const vb = b.variantBits, vi = m & ((1 << vb) - 1);
  const key = (b.variants[vi] || b.variants[0]).key;
  let name = OUT_NAME[key] || key;
  const p = {};
  switch (b.shape) {
    case SHAPE.SLAB: p.type = ['bottom', 'top', 'double'][(m >> 4) & 3] || 'bottom'; p.waterlogged = 'false'; break;
    case SHAPE.STAIRS: p.facing = H[(m >> 4) & 3]; p.half = m & 64 ? 'top' : 'bottom'; p.shape = 'straight'; p.waterlogged = 'false'; break;
    case SHAPE.DOOR: p.facing = H[(m >> 3) & 3]; p.half = m & 64 ? 'upper' : 'lower'; p.open = String(!!(m & 32)); p.powered = String(!!(m & 128)); p.hinge = 'left'; break;
    case SHAPE.TRAPDOOR: p.facing = H[OPP2((m >> 3) & 3)]; p.half = m & 64 ? 'top' : 'bottom'; p.open = String(!!(m & 32)); p.powered = String(!!(m & 128)); p.waterlogged = 'false'; break;
    case SHAPE.LADDER: p.facing = H[OPP2(m & 3)]; p.waterlogged = 'false'; break;
    case SHAPE.BED: p.facing = H[(m >> 4) & 3]; p.part = m & 64 ? 'head' : 'foot'; p.occupied = 'false'; break;
    case SHAPE.LANTERN: p.hanging = String(!!(m & 2)); p.waterlogged = 'false'; break;
    case SHAPE.RAIL: p.shape = m & 1 ? 'east_west' : 'north_south'; p.waterlogged = 'false'; break;
    case SHAPE.SNOW: p.layers = String((m & 7) + 1); break;
    case SHAPE.LIQUID: p.level = String(m & 15); break;
    case SHAPE.CACTUS: case SHAPE.FIRE: p.age = '0'; break;
    case SHAPE.CHEST: p.facing = H[m & 3]; p.type = 'single'; p.waterlogged = 'false'; break;
    case SHAPE.CAMPFIRE: p.facing = 'north'; p.lit = 'true'; p.signal_fire = 'false'; p.waterlogged = 'false'; break;
    case SHAPE.FENCE: case SHAPE.PANE:
      p.north = String(connects(id, nb(0, 0, -1))); p.south = String(connects(id, nb(0, 0, 1)));
      p.west = String(connects(id, nb(-1, 0, 0))); p.east = String(connects(id, nb(1, 0, 0))); p.waterlogged = 'false';
      break;
    case SHAPE.CROP: {
      const v = Math.min(vi, CROP_STAGES.length - 1), age = (m >> CROP_AGE_SHIFT) & 7, max = Math.max(1, CROP_STAGES[v] - 1);
      p.age = String(Math.min(JAVA_CROP_MAX[v], Math.round(age / max * JAVA_CROP_MAX[v])));
      break;
    }
    case SHAPE.TORCH:
      if (id === B.REDSTONE_TORCH) { name = 'redstone_torch'; p.lit = String(!(m & 1)); }
      if ((m >> 1) & 7) { name = name.replace('torch', 'wall_torch'); p.facing = H[OPP2((((m >> 1) & 7) - 1) & 3)]; }
      break;
    case SHAPE.VINE: { const side = H[m & 3]; for (const d of ['north', 'south', 'east', 'west']) p[d] = String(d === side); if (id === B.VINE) p.up = 'false'; else { p.up = 'false'; p.down = 'false'; p.waterlogged = 'false'; } break; }
    case SHAPE.SKULL: p.rotation = String([0, 4, 8, 12][(m >> 1) & 3]); break;
    case SHAPE.ENDFRAME: p.facing = H[m & 3]; p.eye = 'false'; break;
    case SHAPE.DUST: {
      const mask = m >> 4;
      for (let f = 0; f < 4; f++) p[H[f]] = mask & (1 << f) ? 'side' : 'none';
      p.power = String(m & 15);
      break;
    }
    case SHAPE.DIODE:
      p.facing = H[m & 3];
      if (id === B.REPEATER) { p.delay = String(((m >> 2) & 3) + 1); p.powered = String(!!(m & 16)); p.locked = String(!!(m & 32)); }
      else { p.mode = m & 4 ? 'subtract' : 'compare'; p.powered = String(!!(m & 8)); }
      break;
    case SHAPE.LEVER: p.face = ['floor', 'wall', 'ceiling'][m & 3] || 'floor'; p.facing = H[(m >> 2) & 3]; p.powered = String(!!(m & 16)); break;
    case SHAPE.BUTTON: p.face = ['floor', 'wall', 'ceiling'][(m >> 3) & 3] || 'floor'; p.facing = H[(m >> 5) & 3]; p.powered = String(!!(m & 128)); break;
    case SHAPE.PLATE: { const pw = (m >> 2) & 15; if (/weighted/.test(name)) p.power = String(pw); else p.powered = String(pw > 0); break; }
    case SHAPE.DIRCUBE: p.facing = D6[m & 7] || 'north'; if (id === B.OBSERVER) p.powered = String(!!(m & 8)); else p.triggered = String(!!(m & 8)); break;
    case SHAPE.DAYLIGHT: p.power = String(m & 15); p.inverted = String(!!(m & 16)); break;
    case SHAPE.PISTON: p.facing = D6[(m >> 1) & 7] || 'up'; p.extended = String(!!(m & 16)); break;
    case SHAPE.PISTON_HEAD: name = 'piston_head'; p.type = m & 1 ? 'sticky' : 'normal'; p.facing = D6[(m >> 1) & 7] || 'up'; p.short = 'false'; break;
    case SHAPE.HOPPER: p.facing = D6[m & 7] === 'up' ? 'down' : D6[m & 7] || 'down'; p.enabled = String(!(m & 8)); break;
    default: break;
  }
  // Families described by our facing / axis bits.
  if (b.axisShift >= 0 && ['log', 'hay_block', 'basalt', 'purpur'].includes(b.key) && (b.key !== 'basalt' || /basalt|bone/.test(key)) && (b.key !== 'purpur' || key === 'purpur_pillar')) p.axis = ['y', 'x', 'z'][(m >> b.axisShift) & 3] || 'y';
  if (b.facingShift >= 0 && ['furnace', 'pumpkin', 'anvil'].includes(b.key) && key !== 'pumpkin') p.facing = H[(m >> b.facingShift) & 3];
  if (key === 'grass_block_snowy') p.snowy = 'true';
  if (key === 'farmland_moist') p.moisture = '7'; else if (key === 'farmland') p.moisture = '0';
  if (key === 'lit_furnace') p.lit = 'true'; else if (key === 'furnace') p.lit = 'false';
  if (id === B.REDSTONE_LAMP) p.lit = String(key === 'redstone_lamp_on');
  if (id === B.LEAVES) { p.distance = '1'; p.persistent = 'false'; p.waterlogged = 'false'; }
  if (id === B.NOTE_BLOCK) { p.note = String(m & 31); p.powered = String(!!(m & 32)); p.instrument = NOTE_INSTRUMENT(nb(0, -1, 0)); }
  if (key === 'legacy_note_block') { p.note = '0'; p.powered = 'false'; p.instrument = NOTE_INSTRUMENT(nb(0, -1, 0)); }
  if (id === B.TARGET || key === 'legacy_target') p.power = '0';
  if (key === 'legacy_redstone_lamp') p.lit = 'false';
  if (id === B.TNT) p.unstable = 'false';
  if (id === B.END_ROD) p.facing = 'up';
  if (id === B.BAMBOO) { p.age = '0'; p.leaves = 'small'; p.stage = '0'; }
  if (id === B.SUGAR_CANE) p.age = '0';
  if (id === B.SWEET_BERRY_BUSH) p.age = '3';
  if (id === B.CAVE_VINES) p.berries = 'false';
  if (id === B.AMETHYST_CLUSTER) { p.facing = 'up'; p.waterlogged = 'false'; }
  if (id === B.POINTED_DRIPSTONE) { p.thickness = 'tip'; p.vertical_direction = 'up'; p.waterlogged = 'false'; }
  if (key === 'kelp') p.age = '0';
  if (id === B.NETHER_PORTAL) p.axis = m & 1 ? 'z' : 'x';
  if (key === 'barrel') { p.facing = 'up'; p.open = 'false'; }
  if (key === 'chorus_flower') p.age = '0';
  if (id === B.MUSHROOM_BLOCK) for (const d of ['north', 'south', 'east', 'west', 'up', 'down']) p[d] = 'true';
  if (id === B.SAPLING) p.stage = '0';
  if (id === B.MANGROVE_ROOTS) p.waterlogged = 'false';
  return { name, props: Object.keys(p).length ? p : null };
}

// ---------------- Java -> Blockhaven ----------------
const cache = new Map();
const AIR_WORDS = /sign|banner|candle|flower_pot|potted_|_head$|_skull$|button|lever|tripwire|string|scaffolding|cake|chain$|bell$|item_frame|coral$|coral_fan|_fan$|lichen|petals|dripleaf|roots$|sprouts$|sea_pickle|vine|carpet$|^light$|frogspawn|egg$/;

export function fromJava(rawName, props) {
  const name = rawName.replace(/^minecraft:/, '');
  const pk = props ? name + JSON.stringify(props) : name;
  let s = cache.get(pk);
  if (s === undefined) { s = resolve(name, props || {}); cache.set(pk, s); }
  return s;
}

function baseState(name) {
  if (STATE[name]) return STATE[name];
  const a = IN_ALIAS[name];
  if (a && STATE[a]) return STATE[a];
  return null;
}
// The closest family we have for a Java block we lack.
function fallback(name) {
  let n = name.replace(/^(waxed_|infested_|stripped_)/, '').replace(/^(exposed|weathered|oxidized)_/, '');
  if (STATE[n]) return [STATE[n], n];
  if (/copper/.test(n)) return [STATE.copper_block, 'copper_block'];
  if (/_concrete_powder$/.test(n)) n = n.replace('_powder', '');
  if (/_glazed_terracotta$/.test(n)) n = n.replace('_glazed', '');
  if (/_stained_glass_pane$/.test(n)) return [STATE.glass_pane, 'glass_pane'];
  if (/_(wood|hyphae)$/.test(n)) n = n.replace(/_(wood|hyphae)$/, n.includes('crimson') || n.includes('warped') ? '_stem' : '_log');
  if (STATE[n]) return [STATE[n], n];
  const isWood = WOOD_WORDS.some(w => n.startsWith(w + '_'));
  for (const suf of ['stairs', 'slab', 'fence', 'door', 'trapdoor', 'button', 'pressure_plate', 'log', 'planks', 'leaves', 'sapling', 'bed', 'wool', 'carpet', 'terracotta', 'concrete']) {
    if (!n.endsWith('_' + suf) && n !== suf) continue;
    // Drop words from the front until we have the block ("polished_granite_stairs" -> "granite_stairs" -> ...).
    const words = n.split('_');
    for (let i = 1; i < words.length; i++) { const t = words.slice(i).join('_'); if (STATE[t]) return [STATE[t], t]; }
    // Then a member of the family in a similar material.
    const MAT = [['deepslate', 'deepslate_brick'], ['blackstone', 'deepslate_brick'], ['sandstone', 'sandstone'], ['quartz', 'quartz'], ['purpur', 'quartz'],
      ['nether', 'nether_brick'], ['stone_brick', 'stone_brick'], ['cobble', 'cobblestone'], ['brick', 'brick'], ['prismarine', 'stone_brick'], ['end_stone', 'sandstone']];
    for (const [w, mat] of MAT) if (n.includes(w) && STATE[`${mat}_${suf}`]) return [STATE[`${mat}_${suf}`], `${mat}_${suf}`];
    const def = {
      stairs: isWood ? 'oak_stairs' : 'stone_stairs', slab: isWood ? 'oak_slab' : 'stone_slab', fence: isWood ? 'oak_fence' : 'nether_brick_fence',
      door: isWood ? 'oak_door' : 'iron_door', trapdoor: isWood ? 'oak_trapdoor' : 'iron_trapdoor', button: isWood ? 'oak_button' : 'stone_button',
      pressure_plate: isWood ? 'oak_pressure_plate' : 'stone_pressure_plate', log: 'oak_log', planks: 'oak_planks', leaves: 'oak_leaves',
      sapling: 'oak_sapling', bed: 'red_bed', wool: 'white_wool', carpet: 'white_carpet', terracotta: 'terracotta', concrete: 'white_concrete',
    }[suf];
    if (STATE[def]) return [STATE[def], def];
  }
  if (n.endsWith('_fence_gate')) { const w = n.replace('_fence_gate', '_fence'); return [STATE[w] || STATE.oak_fence, w]; }
  if (n.endsWith('_wall')) {
    const m = n.replace(/_wall$/, ''), full = [m, m + 's', m.replace(/brick$/, 'bricks'), m.replace(/tile$/, 'tiles')].find(k => STATE[k]);
    return [STATE[full] || STATE.cobblestone, full || 'cobblestone'];
  }
  if (/_ore$/.test(n)) return [STATE.stone, 'stone'];
  if (AIR_WORDS.test(n)) return [STATE.air, 'air'];
  return [STATE.stone, 'stone'];
}

function resolve(name, p) {
  let st = baseState(name), key = st ? (STATE[name] ? name : IN_ALIAS[name]) : null;
  // Java names we split into variants.
  if (name === 'grass_block' && bool(p.snowy)) { st = STATE.grass_block_snowy; key = 'grass_block_snowy'; }
  if (name === 'farmland' && Number(p.moisture) > 0) { st = STATE.farmland_moist; key = 'farmland_moist'; }
  if (name === 'furnace' && bool(p.lit)) { st = STATE.lit_furnace; key = 'lit_furnace'; }
  if (name === 'redstone_lamp') { st = bool(p.lit) ? STATE.redstone_lamp_on : STATE.redstone_lamp; key = 'redstone_lamp'; }
  if (name === 'redstone_torch' || name === 'redstone_wall_torch') { st = p.lit === 'false' ? STATE.redstone_torch_off : STATE.redstone_torch; key = 'redstone_torch'; }
  if (name === 'wall_torch') { st = STATE.torch; key = 'torch'; }
  if (name === 'soul_wall_torch') { st = STATE.soul_torch; key = 'soul_torch'; }
  if (name === 'piston_head') { st = p.type === 'sticky' ? STATE.sticky_piston_head : STATE.piston_head; key = 'piston_head'; }
  if (!st) [st, key] = fallback(name);
  const [id, variant] = st;
  let m = variant;
  const b = BLOCKS[id];
  switch (b.shape) {
    case SHAPE.SLAB: m |= (p.type === 'top' ? 1 : p.type === 'double' ? 2 : 0) << 4; break;
    case SHAPE.STAIRS: m |= h2(p.facing) << 4; if (p.half === 'top') m |= 64; break;
    case SHAPE.DOOR: m |= h2(p.facing) << 3; if (p.half === 'upper') m |= 64; if (bool(p.open)) m |= 32; if (bool(p.powered)) m |= 128; break;
    case SHAPE.TRAPDOOR: m |= OPP2(h2(p.facing)) << 3; if (p.half === 'top') m |= 64; if (bool(p.open)) m |= 32; if (bool(p.powered)) m |= 128; break;
    case SHAPE.LADDER: m |= OPP2(h2(p.facing)); break;
    case SHAPE.BED: m |= h2(p.facing) << 4 | (p.part === 'head' ? 64 : 0); break;
    case SHAPE.LANTERN: if (bool(p.hanging)) m |= 2; break;
    case SHAPE.RAIL: if (/east_west|ascending_east|ascending_west|south_east|north_west/.test(p.shape || '')) m |= 1; break;
    case SHAPE.SNOW: m |= Math.max(0, Math.min(7, (Number(p.layers) || 1) - 1)); break;
    case SHAPE.LIQUID: m = Number(p.level) & 15; break;
    case SHAPE.CHEST: m |= h2(p.facing); break;
    case SHAPE.CROP: {
      const v = m & 7, max = Math.max(1, CROP_STAGES[v] - 1);
      m |= Math.round((Number(p.age) || 0) / JAVA_CROP_MAX[v] * max) << CROP_AGE_SHIFT;
      break;
    }
    case SHAPE.TORCH:
      if (/wall_torch$/.test(name)) m |= ((OPP2(h2(p.facing)) + 1) & 7) << 1;
      break;
    case SHAPE.VINE: { const side = ['south', 'west', 'north', 'east'].findIndex(d => bool(p[d])); m |= Math.max(0, side); break; }
    case SHAPE.SKULL: m |= ([0, 1, 2, 3][Math.round((Number(p.rotation) || 0) / 4) & 3]) << 1; break;
    case SHAPE.ENDFRAME: m |= h2(p.facing); break;
    case SHAPE.DUST: {
      let mask = 0;
      for (let f = 0; f < 4; f++) if (p[H[f]] && p[H[f]] !== 'none') mask |= 1 << f;
      m = (Number(p.power) & 15) | (mask << 4);
      break;
    }
    case SHAPE.DIODE:
      m = h2(p.facing);
      if (id === B.REPEATER) { m |= ((Math.max(1, Number(p.delay) || 1) - 1) & 3) << 2; if (bool(p.powered)) m |= 16; if (bool(p.locked)) m |= 32; }
      else { if (p.mode === 'subtract') m |= 4; if (bool(p.powered)) m |= 8; }
      break;
    case SHAPE.LEVER: m = Math.max(0, ['floor', 'wall', 'ceiling'].indexOf(p.face)) | (h2(p.facing) << 2) | (bool(p.powered) ? 16 : 0); break;
    case SHAPE.BUTTON: m |= (Math.max(0, ['floor', 'wall', 'ceiling'].indexOf(p.face)) << 3) | (h2(p.facing) << 5) | (bool(p.powered) ? 128 : 0); break;
    case SHAPE.PLATE: m |= ((p.power !== undefined ? Number(p.power) : bool(p.powered) ? 15 : 0) & 15) << 2; break;
    case SHAPE.DIRCUBE: m = d6(p.facing) | (bool(p.powered) || bool(p.triggered) ? 8 : 0); break;
    case SHAPE.DAYLIGHT: m = (Number(p.power) & 15) | (bool(p.inverted) ? 16 : 0); break;
    case SHAPE.PISTON: m |= (d6(p.facing) << 1) | (bool(p.extended) ? 16 : 0); break;
    case SHAPE.PISTON_HEAD: m = (p.type === 'sticky' ? 1 : 0) | (d6(p.facing) << 1); break;
    case SHAPE.HOPPER: m = d6(p.facing) | (p.enabled === 'false' ? 8 : 0); break;
    default: break;
  }
  if (b.axisShift >= 0 && p.axis) m |= Math.max(0, ['y', 'x', 'z'].indexOf(p.axis)) << b.axisShift;
  if (b.facingShift >= 0 && p.facing && (b.key === 'furnace' || b.key === 'pumpkin' || b.key === 'anvil')) m |= h2(p.facing) << b.facingShift;
  if (id === B.NOTE_BLOCK) m = (Number(p.note) & 31) | (bool(p.powered) ? 32 : 0);
  if (id === B.NETHER_PORTAL && p.axis === 'z') m |= 1;
  return S(id, m & 255);
}

// ---------------- biomes ----------------
export const biomeToJava = key => (key === 'floating_isles' ? 'small_end_islands' : key);
export const COLOR_NAMES = COLORS;
