// Block registry, shared by the main thread and the workers.
// A block is an id (0-255) plus a meta byte: low bits pick the variant (wood type, colour...),
// the rest hold state (facing, open, age, layers...). Tables below are indexed by id or (id << 4 | variant).

export const CHUNK = 16;
export const HEIGHT = 256;
export const SEA = 64;
export const PAD = 14;
export const PS = CHUNK + PAD * 2;
export const DIM = { OVERWORLD: 0, NETHER: 1, END: 2 };
export const DIM_NAMES = ['overworld', 'the_nether', 'the_end'];

export const SHAPE = {
  NONE: 0, CUBE: 1, CROSS: 2, TORCH: 3, LIQUID: 4, SLAB: 5, STAIRS: 6, FENCE: 7, PANE: 8, DOOR: 9, TRAPDOOR: 10,
  LADDER: 11, CROP: 12, SNOW: 13, CARPET: 14, FARMLAND: 15, CACTUS: 16, CHEST: 17, BED: 18, LANTERN: 19, FLAT: 20,
  PORTAL: 21, END_PORTAL: 22, ENDFRAME: 23, FIRE: 24, VINE: 25, ROD: 26, RAIL: 27, CAMPFIRE: 28, SKULL: 29,
  DUST: 30, DIODE: 31, LEVER: 32, BUTTON: 33, PLATE: 34, DIRCUBE: 35, PISTON: 36, PISTON_HEAD: 37, DAYLIGHT: 38, HOPPER: 39,
  ENCHANTER: 40, ANVIL: 41,
};

// Vertex flags read by the shaders.
export const VF = { NONE: 0, LEAVES: 1, PLANT: 2, WATER_TOP: 3, LAVA: 4, WATER: 5, PORTAL: 6, EMISSIVE: 7, ICE: 8, END_PORTAL: 9, FIRE: 10, GLASS: 11 };

export const TINT = { NONE: 0, GRASS: 1, FOLIAGE: 2, WATER: 3 };

export const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
export const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'mangrove', 'crimson', 'warped'];
const title = s => s.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

export const TEXTURES = [];
export const TEX = {};
function tex(name) {
  if (!(name in TEX)) { TEX[name] = TEXTURES.length; TEXTURES.push(name); }
  return TEX[name];
}

export const B = {};
export const BLOCKS = [];
let nextId = 0;

// def(key, props, variants?) — each variant: { key, name, tex, ...overrides }.
function def(key, o = {}, variants = null) {
  const id = nextId++;
  const shape = o.shape ?? SHAPE.CUBE;
  const vs = (variants || [{ key, name: o.name }]).map(v => ({ ...v }));
  const b = {
    id, key, name: o.name || title(key), shape,
    variants: vs,
    variantBits: vs.length <= 1 ? 0 : Math.ceil(Math.log2(vs.length)),
    opaque: o.opaque ?? (shape === SHAPE.CUBE && !o.cutout && !o.translucent),
    cutout: !!o.cutout, translucent: !!o.translucent,
    solid: o.solid ?? ![SHAPE.NONE, SHAPE.CROSS, SHAPE.TORCH, SHAPE.LIQUID, SHAPE.PORTAL, SHAPE.END_PORTAL, SHAPE.FIRE, SHAPE.VINE, SHAPE.RAIL, SHAPE.CARPET, SHAPE.LADDER].includes(shape),
    light: o.light ?? 0, atten: o.atten ?? 0,
    hardness: o.hardness ?? 1, tool: o.tool ?? null, tier: o.tier ?? 0,
    sound: o.sound ?? 'stone', flags: o.flags ?? VF.NONE, tint: o.tint ?? TINT.NONE,
    cullSame: !!o.cullSame, replaceable: !!o.replaceable, gravity: !!o.gravity, climbable: !!o.climbable,
    slow: o.slow ?? 0, damage: o.damage ?? 0, slippery: !!o.slippery, waterlogged: !!o.waterlogged,
    facingShift: o.facingShift ?? -1, axisShift: o.axisShift ?? -1,
    flammable: !!o.flammable, drop: o.drop, noItem: !!o.noItem, tab: o.tab || 'building',
    resistance: o.resistance ?? (o.hardness ?? 1) * 3,
  };
  b.variants.forEach((v, i) => {
    v.index = i;
    v.name = v.name || (variants ? title(v.key) : b.name);
    const t = v.tex ?? o.tex ?? v.key;
    v.tex = typeof t === 'string' ? { side: t, top: t, bottom: t } : { ...t, top: t.top ?? t.side, bottom: t.bottom ?? t.top ?? t.side };
    for (const k of Object.keys(v.tex)) tex(v.tex[k]);
  });
  BLOCKS[id] = b;
  B[key.toUpperCase()] = id;
  return id;
}

const woodTex = w => w === 'crimson' || w === 'warped' ? { side: `stem_${w}`, top: `stem_${w}_top` } : { side: `log_${w}`, top: `log_${w}_top` };
const OVERWORLD_WOODS = WOODS.slice(0, 8);

def('air', { shape: SHAPE.NONE, opaque: false, solid: false, noItem: true, replaceable: true });
def('stone', { hardness: 1.5, tool: 'pickaxe', tier: 1, tab: 'natural' }, [
  { key: 'stone', drop: 'cobblestone' }, { key: 'granite' }, { key: 'polished_granite' }, { key: 'diorite' },
  { key: 'polished_diorite' }, { key: 'andesite' }, { key: 'polished_andesite' }, { key: 'smooth_stone', tex: { side: 'smooth_stone_side', top: 'smooth_stone' } },
  { key: 'deepslate', tex: { side: 'deepslate', top: 'deepslate_top' }, hardness: 3, drop: 'cobbled_deepslate' }, { key: 'cobbled_deepslate', hardness: 3.5 },
  { key: 'polished_deepslate', hardness: 3.5 }, { key: 'deepslate_bricks', hardness: 3.5 }, { key: 'deepslate_tiles', hardness: 3.5 },
  { key: 'tuff' }, { key: 'calcite', hardness: 0.75 }, { key: 'dripstone_block' },
]);
def('grass_block', { hardness: 0.6, tool: 'shovel', sound: 'grass', tint: TINT.GRASS, tab: 'natural', drop: 'dirt' }, [
  { key: 'grass_block', tex: { side: 'grass_block_side', top: 'grass_block_top', bottom: 'dirt' } },
  { key: 'grass_block_snowy', name: 'Grass Block', tex: { side: 'grass_block_snow', top: 'snow', bottom: 'dirt' }, noItem: true },
]);
def('dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel', tab: 'natural' }, [
  { key: 'dirt' }, { key: 'coarse_dirt' }, { key: 'podzol', tex: { side: 'podzol_side', top: 'podzol_top', bottom: 'dirt' }, drop: 'dirt' },
  { key: 'rooted_dirt' }, { key: 'mud' }, { key: 'packed_mud' }, { key: 'clay', drop: 'clay_ball*4' },
  { key: 'mycelium', tex: { side: 'mycelium_side', top: 'mycelium_top', bottom: 'dirt' }, drop: 'dirt' },
]);
def('cobblestone', { hardness: 2, tool: 'pickaxe', tier: 1 }, [{ key: 'cobblestone' }, { key: 'mossy_cobblestone' }]);
def('sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true, tab: 'natural' }, [{ key: 'sand' }, { key: 'red_sand' }]);
def('gravel', { hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true, tab: 'natural', drop: 'gravel|flint:0.1' });
def('bedrock', { hardness: Infinity, resistance: 1e9, tab: 'natural' });
def('log', { hardness: 2, tool: 'axe', sound: 'wood', axisShift: 4, flammable: true, tab: 'natural' },
  WOODS.map(w => ({ key: w === 'crimson' || w === 'warped' ? `${w}_stem` : `${w}_log`, tex: woodTex(w) })));
def('planks', { hardness: 2, tool: 'axe', sound: 'wood', flammable: true }, WOODS.map(w => ({ key: `${w}_planks`, tex: `planks_${w}` })));
def('leaves', { cutout: true, atten: 1, hardness: 0.2, tool: 'hoe', sound: 'grass', flags: VF.LEAVES, tint: TINT.FOLIAGE, flammable: true, tab: 'natural' },
  ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'mangrove', 'azalea', 'flowering_azalea'].map(w => ({ key: `${w}_leaves`, tex: `leaves_${w}`, drop: `${w}_leaves_drop` })));
def('sapling', { shape: SHAPE.CROSS, hardness: 0, sound: 'grass', flags: VF.PLANT, tab: 'natural' }, OVERWORLD_WOODS.map(w => ({ key: `${w}_sapling`, tex: `sapling_${w}` })));
def('glass', { cutout: true, hardness: 0.3, sound: 'glass', cullSame: true, flags: VF.GLASS, drop: 'none' });
def('stained_glass', { translucent: true, hardness: 0.3, sound: 'glass', cullSame: true, flags: VF.GLASS, drop: 'none', tab: 'colored' },
  COLORS.map(c => ({ key: `${c}_stained_glass`, tex: `stained_glass_${c}` })));
def('water', { shape: SHAPE.LIQUID, translucent: true, atten: 2, flags: VF.WATER, tint: TINT.WATER, cullSame: true, replaceable: true, noItem: true, hardness: Infinity });
def('lava', { shape: SHAPE.LIQUID, translucent: true, light: 15, flags: VF.LAVA, cullSame: true, replaceable: true, noItem: true, damage: 4, hardness: Infinity });
def('snow', { shape: SHAPE.SNOW, opaque: false, hardness: 0.1, tool: 'shovel', sound: 'snow', tab: 'natural', drop: 'snowball' });
def('snow_block', { hardness: 0.2, tool: 'shovel', sound: 'snow', tab: 'natural' });
def('ice', { translucent: true, atten: 1, hardness: 0.5, tool: 'pickaxe', sound: 'glass', flags: VF.ICE, cullSame: true, slippery: true, drop: 'none', tab: 'natural' });
def('packed_ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', slippery: true, tab: 'natural' }, [{ key: 'packed_ice' }, { key: 'blue_ice', hardness: 2.8 }]);
def('sandstone', { hardness: 0.8, tool: 'pickaxe', tier: 1 }, [
  { key: 'sandstone', tex: { side: 'sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' } },
  { key: 'cut_sandstone', tex: { side: 'cut_sandstone', top: 'sandstone_top' } },
  { key: 'chiseled_sandstone', tex: { side: 'chiseled_sandstone', top: 'sandstone_top' } },
  { key: 'smooth_sandstone', tex: 'sandstone_top' },
  { key: 'red_sandstone', tex: { side: 'red_sandstone', top: 'red_sandstone_top', bottom: 'red_sandstone_bottom' } },
  { key: 'cut_red_sandstone', tex: { side: 'cut_red_sandstone', top: 'red_sandstone_top' } },
  { key: 'chiseled_red_sandstone', tex: { side: 'chiseled_red_sandstone', top: 'red_sandstone_top' } },
  { key: 'smooth_red_sandstone', tex: 'red_sandstone_top' },
]);
def('cactus', { shape: SHAPE.CACTUS, opaque: false, hardness: 0.4, sound: 'cloth', damage: 1, tex: { side: 'cactus_side', top: 'cactus_top', bottom: 'cactus_bottom' }, tab: 'natural' });
const ORES = [['coal', 1, 'coal'], ['iron', 2, 'raw_iron'], ['copper', 2, 'raw_copper*3'], ['gold', 3, 'raw_gold'], ['redstone', 3, 'redstone*4'], ['lapis', 2, 'lapis_lazuli*5'], ['emerald', 3, 'emerald'], ['diamond', 3, 'diamond']];
def('ore', { hardness: 3, tool: 'pickaxe', tab: 'natural' }, [
  ...ORES.map(([o, tier, drop]) => ({ key: `${o}_ore`, tex: `ore_${o}`, tier, drop })),
  ...ORES.map(([o, tier, drop]) => ({ key: `deepslate_${o}_ore`, tex: `deepslate_ore_${o}`, tier, drop, hardness: 4.5 })),
]);
def('nether_ore', { hardness: 3, tool: 'pickaxe', tier: 1, tab: 'natural' }, [
  { key: 'nether_gold_ore', drop: 'gold_nugget*4' }, { key: 'nether_quartz_ore', drop: 'quartz' },
  { key: 'ancient_debris', tex: { side: 'ancient_debris_side', top: 'ancient_debris_top' }, hardness: 30, tier: 4, resistance: 1200 },
]);
def('mineral_block', { hardness: 5, tool: 'pickaxe', tier: 2, sound: 'metal' }, [
  { key: 'coal_block', tier: 1 }, { key: 'iron_block' }, { key: 'gold_block', tier: 3 }, { key: 'diamond_block', tier: 3 },
  { key: 'emerald_block', tier: 3 }, { key: 'lapis_block' }, { key: 'legacy_redstone_block', tex: 'redstone_block', tier: 1, noItem: true, drop: 'redstone_block' }, { key: 'copper_block' },
  { key: 'amethyst_block', tier: 0, hardness: 1.5, sound: 'glass' }, { key: 'quartz_block', tier: 1, hardness: 0.8 },
  { key: 'netherite_block', tier: 4, hardness: 50 }, { key: 'raw_iron_block' }, { key: 'raw_gold_block', tier: 3 }, { key: 'raw_copper_block' },
]);
def('bricks', { hardness: 2, tool: 'pickaxe', tier: 1 }, [
  { key: 'bricks' }, { key: 'stone_bricks' }, { key: 'mossy_stone_bricks' }, { key: 'cracked_stone_bricks' }, { key: 'chiseled_stone_bricks' },
  { key: 'nether_bricks' }, { key: 'red_nether_bricks' }, { key: 'end_stone_bricks', hardness: 3 }, { key: 'mud_bricks' },
  { key: 'polished_blackstone_bricks' }, { key: 'quartz_bricks' }, { key: 'prismarine' }, { key: 'prismarine_bricks' }, { key: 'dark_prismarine' },
]);
def('glowstone', { light: 15, hardness: 0.3, sound: 'glass', flags: VF.EMISSIVE, drop: 'glowstone_dust*3', tab: 'natural' });
def('torch', { shape: SHAPE.TORCH, opaque: false, solid: false, hardness: 0, sound: 'wood', flags: VF.EMISSIVE, tab: 'functional' }, [
  { key: 'torch', light: 14, tex: { side: 'torch', top: 'torch_top' } },
  { key: 'soul_torch', light: 10, tex: { side: 'soul_torch', top: 'soul_torch_top' } },
]);
def('flower', { shape: SHAPE.CROSS, hardness: 0, sound: 'grass', flags: VF.PLANT, replaceable: false, tab: 'natural' },
  ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
    'cornflower', 'lily_of_the_valley', 'wither_rose', 'red_mushroom', 'brown_mushroom', 'torchflower'].map(f => ({ key: f, light: f === 'brown_mushroom' ? 1 : 0 })));
def('plant', { shape: SHAPE.CROSS, hardness: 0, sound: 'grass', flags: VF.PLANT, tint: TINT.GRASS, replaceable: true, tab: 'natural' }, [
  { key: 'short_grass', drop: 'wheat_seeds:0.12' }, { key: 'fern', drop: 'wheat_seeds:0.12' }, { key: 'dead_bush', drop: 'stick:0.5' },
  { key: 'crimson_roots' }, { key: 'warped_roots' }, { key: 'crimson_fungus' }, { key: 'warped_fungus' }, { key: 'nether_sprouts', drop: 'none' },
]);
def('sugar_cane', { shape: SHAPE.CROSS, hardness: 0, sound: 'grass', tint: TINT.GRASS, flags: VF.PLANT, tab: 'natural' });
def('wool', { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: true, tab: 'colored' }, COLORS.map(c => ({ key: `${c}_wool`, tex: `wool_${c}` })));
def('concrete', { hardness: 1.8, tool: 'pickaxe', tier: 1, tab: 'colored' }, COLORS.map(c => ({ key: `${c}_concrete`, tex: `concrete_${c}` })));
def('terracotta_colored', { hardness: 1.25, tool: 'pickaxe', tier: 1, tab: 'colored' }, COLORS.map(c => ({ key: `${c}_terracotta`, tex: `terracotta_${c}` })));
def('terracotta', { hardness: 1.25, tool: 'pickaxe', tier: 1, tab: 'colored' });
def('carpet', { shape: SHAPE.CARPET, opaque: false, hardness: 0.1, sound: 'cloth', flammable: true, tab: 'colored' }, COLORS.map(c => ({ key: `${c}_carpet`, tex: `wool_${c}` })));
def('moss_block', { hardness: 0.1, tool: 'hoe', sound: 'grass', tab: 'natural' });
def('moss_carpet', { shape: SHAPE.CARPET, opaque: false, hardness: 0.1, sound: 'grass', tex: 'moss_block', tab: 'natural' });
def('pumpkin', { hardness: 1, tool: 'axe', sound: 'wood', facingShift: 2, tab: 'natural' }, [
  { key: 'pumpkin', tex: { side: 'pumpkin_side', top: 'pumpkin_top' } },
  { key: 'carved_pumpkin', tex: { side: 'pumpkin_side', top: 'pumpkin_top', front: 'carved_pumpkin' } },
  { key: 'jack_o_lantern', light: 15, tex: { side: 'pumpkin_side', top: 'pumpkin_top', front: 'jack_o_lantern' } },
]);
def('melon', { hardness: 1, tool: 'axe', sound: 'wood', tex: { side: 'melon_side', top: 'melon_top' }, drop: 'melon_slice*5', tab: 'natural' });
def('hay_block', { hardness: 0.5, tool: 'hoe', sound: 'grass', axisShift: 0, tex: { side: 'hay_block_side', top: 'hay_block_top' }, flammable: true });
def('bookshelf', { hardness: 1.5, tool: 'axe', sound: 'wood', tex: { side: 'bookshelf', top: 'planks_oak' }, drop: 'book*3', flammable: true });
def('crafting_table', { hardness: 2.5, tool: 'axe', sound: 'wood', facingShift: 0, tex: { side: 'crafting_table_side', top: 'crafting_table_top', bottom: 'planks_oak', front: 'crafting_table_front' }, tab: 'functional' });
def('furnace', { hardness: 3.5, tool: 'pickaxe', tier: 1, facingShift: 1, tab: 'functional' }, [
  { key: 'furnace', tex: { side: 'furnace_side', top: 'furnace_top', front: 'furnace_front' } },
  { key: 'lit_furnace', light: 13, noItem: true, drop: 'furnace', tex: { side: 'furnace_side', top: 'furnace_top', front: 'furnace_front_on' } },
]);
def('chest', { shape: SHAPE.CHEST, opaque: false, hardness: 2.5, tool: 'axe', sound: 'wood', facingShift: 0, tex: { side: 'chest_side', top: 'chest_top', front: 'chest_front' }, tab: 'functional' });
// Beds in Java's 16 colours: the colour is the variant (low 4 bits), facing (foot to head) bits 4-5,
// the head half bit 6.
def('bed', { shape: SHAPE.BED, opaque: false, hardness: 0.2, sound: 'wood', facingShift: 4, tex: { side: 'bed_side', top: 'bed_top_foot', bottom: 'planks_oak' }, tab: 'functional' },
  COLORS.map(c => ({ key: `${c}_bed` })));
def('ladder', { shape: SHAPE.LADDER, opaque: false, cutout: true, hardness: 0.4, tool: 'axe', sound: 'wood', facingShift: 0, climbable: true, tab: 'functional' });
const DOOR_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'iron'];
def('door', { shape: SHAPE.DOOR, opaque: false, cutout: true, hardness: 3, tool: 'axe', sound: 'wood', facingShift: 3, tab: 'functional' },
  DOOR_WOODS.map(w => ({ key: `${w}_door`, tex: { side: `door_${w}_bottom`, top: `door_${w}_top` }, ...(w === 'iron' ? { tool: 'pickaxe', hardness: 5, sound: 'metal' } : {}) })));
def('trapdoor', { shape: SHAPE.TRAPDOOR, opaque: false, cutout: true, hardness: 3, tool: 'axe', sound: 'wood', facingShift: 3, tab: 'functional' },
  DOOR_WOODS.map(w => ({ key: `${w}_trapdoor`, tex: `trapdoor_${w}`, ...(w === 'iron' ? { tool: 'pickaxe', hardness: 5, sound: 'metal' } : {}) })));
export const SHAPED_MATERIALS = [
  ['oak', 'planks_oak', 'wood'], ['spruce', 'planks_spruce', 'wood'], ['birch', 'planks_birch', 'wood'], ['jungle', 'planks_jungle', 'wood'],
  ['acacia', 'planks_acacia', 'wood'], ['dark_oak', 'planks_dark_oak', 'wood'], ['cherry', 'planks_cherry', 'wood'], ['stone', 'stone', 'stone'],
  ['cobblestone', 'cobblestone', 'stone'], ['stone_brick', 'stone_bricks', 'stone'], ['sandstone', { side: 'sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' }, 'stone'],
  ['brick', 'bricks', 'stone'], ['nether_brick', 'nether_bricks', 'stone'], ['smooth_stone', { side: 'smooth_stone_side', top: 'smooth_stone' }, 'stone'],
  ['deepslate_brick', 'deepslate_bricks', 'stone'], ['quartz', 'block_quartz', 'stone'],
];
const shapedOpts = ([m, t, kind]) => ({ tex: t, ...(kind === 'wood' ? { tool: 'axe', sound: 'wood', hardness: 2, flammable: true } : { tool: 'pickaxe', tier: 1, hardness: 2 }) });
def('slab', { shape: SHAPE.SLAB, opaque: false, hardness: 2 }, SHAPED_MATERIALS.map(s => ({ key: `${s[0]}_slab`, ...shapedOpts(s) })));
def('stairs', { shape: SHAPE.STAIRS, opaque: false, hardness: 2, facingShift: 4 }, SHAPED_MATERIALS.map(s => ({ key: `${s[0]}_stairs`, ...shapedOpts(s) })));
def('fence', { shape: SHAPE.FENCE, opaque: false, hardness: 2, tool: 'axe', sound: 'wood', tab: 'building' },
  [...OVERWORLD_WOODS.slice(0, 7).map(w => ({ key: `${w}_fence`, tex: `planks_${w}` })), { key: 'nether_brick_fence', tex: 'nether_bricks', tool: 'pickaxe', sound: 'stone' }]);
def('pane', { shape: SHAPE.PANE, opaque: false, cutout: true, hardness: 0.3, sound: 'glass', tab: 'building' }, [
  { key: 'glass_pane', tex: 'glass', drop: 'none' }, { key: 'iron_bars', tex: 'iron_bars', hardness: 5, tool: 'pickaxe', sound: 'metal' },
]);
def('tnt', { hardness: 0, sound: 'grass', tex: { side: 'tnt_side', top: 'tnt_top', bottom: 'tnt_bottom' }, tab: 'functional' });
def('farmland', { shape: SHAPE.FARMLAND, opaque: false, hardness: 0.6, tool: 'shovel', sound: 'gravel', drop: 'dirt', noItem: true }, [
  { key: 'farmland', tex: { side: 'dirt', top: 'farmland' } }, { key: 'farmland_moist', tex: { side: 'dirt', top: 'farmland_moist' } },
]);
def('dirt_path', { shape: SHAPE.FARMLAND, opaque: false, hardness: 0.65, tool: 'shovel', sound: 'gravel', tex: { side: 'dirt_path_side', top: 'dirt_path_top', bottom: 'dirt' }, drop: 'dirt' });
def('crops', { shape: SHAPE.CROP, hardness: 0, sound: 'grass', flags: VF.PLANT, noItem: true }, [
  { key: 'wheat', tex: 'wheat_stage7', drop: 'wheat_crop' }, { key: 'carrots', tex: 'carrots_stage3', drop: 'carrot_crop' },
  { key: 'potatoes', tex: 'potatoes_stage3', drop: 'potato_crop' }, { key: 'beetroots', tex: 'beetroots_stage3', drop: 'beetroot_crop' },
  { key: 'pumpkin_stem', tex: 'pumpkin_stem_stage7', drop: 'pumpkin_seeds' }, { key: 'melon_stem', tex: 'melon_stem_stage7', drop: 'melon_seeds' },
  { key: 'nether_wart', tex: 'nether_wart_stage3', drop: 'nether_wart_crop' },
]);
def('lantern', { shape: SHAPE.LANTERN, opaque: false, hardness: 3.5, tool: 'pickaxe', sound: 'metal', flags: VF.EMISSIVE, tab: 'functional' }, [
  { key: 'lantern', light: 15 }, { key: 'soul_lantern', light: 10 },
]);
def('cobweb', { shape: SHAPE.CROSS, hardness: 4, tool: 'sword', slow: 0.25, drop: 'string', tab: 'natural' });
def('spawner', { cutout: true, hardness: 5, tool: 'pickaxe', tier: 1, sound: 'metal', drop: 'none', tab: 'functional' });
def('obsidian', { hardness: 50, tool: 'pickaxe', tier: 4, resistance: 1200, tab: 'natural' }, [{ key: 'obsidian' }, { key: 'crying_obsidian', light: 10 }]);
def('netherrack', { hardness: 0.4, tool: 'pickaxe', tier: 1, tab: 'natural' });
def('soul_sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', tab: 'natural' }, [{ key: 'soul_sand', slow: 0.4 }, { key: 'soul_soil' }]);
def('nylium', { hardness: 0.4, tool: 'pickaxe', tier: 1, drop: 'netherrack', tab: 'natural' }, [
  { key: 'crimson_nylium', tex: { side: 'crimson_nylium_side', top: 'crimson_nylium', bottom: 'netherrack' } },
  { key: 'warped_nylium', tex: { side: 'warped_nylium_side', top: 'warped_nylium', bottom: 'netherrack' } },
]);
def('wart_block', { hardness: 1, tool: 'hoe', sound: 'grass', tab: 'natural' }, [{ key: 'nether_wart_block' }, { key: 'warped_wart_block' }, { key: 'shroomlight', light: 15 }]);
def('basalt', { hardness: 1.25, tool: 'pickaxe', tier: 1, axisShift: 4, tab: 'natural' }, [
  { key: 'basalt', tex: { side: 'basalt_side', top: 'basalt_top' } }, { key: 'polished_basalt', tex: { side: 'polished_basalt_side', top: 'polished_basalt_top' } },
  { key: 'blackstone', tex: { side: 'blackstone', top: 'blackstone_top' } }, { key: 'polished_blackstone' }, { key: 'magma_block', light: 3, damage: 1 },
  { key: 'bone_block', tex: { side: 'bone_block_side', top: 'bone_block_top' }, hardness: 2 }, { key: 'gilded_blackstone' },
]);
def('nether_portal', { shape: SHAPE.PORTAL, translucent: true, light: 11, hardness: Infinity, flags: VF.PORTAL, noItem: true, cullSame: true });
def('end_stone', { hardness: 3, tool: 'pickaxe', tier: 1, tab: 'natural' });
def('purpur', { hardness: 1.5, tool: 'pickaxe', tier: 1, axisShift: 4 }, [{ key: 'purpur_block' }, { key: 'purpur_pillar', tex: { side: 'purpur_pillar', top: 'purpur_pillar_top' } }]);
def('end_portal_frame', { shape: SHAPE.ENDFRAME, opaque: false, hardness: Infinity, facingShift: 0, tex: { side: 'end_portal_frame_side', top: 'end_portal_frame_top', bottom: 'end_stone' }, tab: 'functional' });
def('end_portal', { shape: SHAPE.END_PORTAL, light: 15, hardness: Infinity, flags: VF.END_PORTAL, noItem: true });
def('chorus', { cutout: true, hardness: 0.4, tool: 'axe', sound: 'wood', tab: 'natural' }, [{ key: 'chorus_plant', drop: 'chorus_fruit:0.5' }, { key: 'chorus_flower' }]);
def('dragon_egg', { hardness: 3, gravity: true, light: 1, tab: 'functional' });
def('end_rod', { shape: SHAPE.ROD, opaque: false, light: 14, hardness: 0, sound: 'glass', flags: VF.EMISSIVE, solid: false, tab: 'functional' });
def('fire', { shape: SHAPE.FIRE, light: 15, hardness: 0, damage: 1, replaceable: true, flags: VF.FIRE, noItem: true, sound: 'grass' }, [{ key: 'fire' }, { key: 'soul_fire', light: 10 }]);
def('lily_pad', { shape: SHAPE.FLAT, opaque: false, cutout: true, hardness: 0, sound: 'grass', solid: true, tab: 'natural' });
def('vine', { shape: SHAPE.VINE, opaque: false, cutout: true, hardness: 0.2, tool: 'shears', sound: 'grass', tint: TINT.FOLIAGE, climbable: true, replaceable: true, facingShift: 0, flags: VF.LEAVES, drop: 'none', tab: 'natural' });
def('mushroom_block', { hardness: 0.2, tool: 'axe', sound: 'wood', tab: 'natural', drop: 'none' }, [
  { key: 'red_mushroom_block' }, { key: 'brown_mushroom_block' }, { key: 'mushroom_stem' },
]);
def('amethyst_cluster', { shape: SHAPE.CROSS, light: 5, hardness: 1.5, tool: 'pickaxe', sound: 'glass', flags: VF.EMISSIVE, tab: 'natural', drop: 'amethyst_shard*4' });
def('pointed_dripstone', { shape: SHAPE.CROSS, hardness: 1.5, tool: 'pickaxe', tab: 'natural', damage: 0 });
def('campfire', { shape: SHAPE.CAMPFIRE, opaque: false, light: 15, hardness: 2, tool: 'axe', sound: 'wood', damage: 1, tab: 'functional', drop: 'charcoal*2' });
def('misc', { hardness: 1, tab: 'building' }, [
  { key: 'jukebox', tex: { side: 'jukebox_side', top: 'jukebox_top' }, sound: 'wood', tool: 'axe' },
  { key: 'legacy_note_block', tex: 'note_block', sound: 'wood', tool: 'axe', noItem: true, drop: 'note_block' },
  { key: 'barrel', tex: { side: 'barrel_side', top: 'barrel_top' }, sound: 'wood', tool: 'axe' },
  { key: 'sea_lantern', light: 15, sound: 'glass', hardness: 0.3, drop: 'prismarine_crystals*2' },
  { key: 'legacy_redstone_lamp', tex: 'redstone_lamp', light: 15, sound: 'glass', hardness: 0.3, noItem: true, drop: 'redstone_lamp' },
  { key: 'sponge', sound: 'grass', hardness: 0.6 }, { key: 'wet_sponge', sound: 'grass', hardness: 0.6 },
  { key: 'legacy_target', tex: { side: 'target_side', top: 'target_top' }, sound: 'grass', hardness: 0.5, noItem: true, drop: 'target' },
]);
def('rail', { shape: SHAPE.RAIL, opaque: false, cutout: true, hardness: 0.7, tool: 'pickaxe', sound: 'metal', facingShift: 0, tab: 'functional' });
def('seagrass', { shape: SHAPE.CROSS, hardness: 0, sound: 'grass', flags: VF.PLANT, waterlogged: true, replaceable: true, drop: 'none', tab: 'natural' }, [{ key: 'seagrass' }, { key: 'kelp' }]);
def('coral_block', { hardness: 1.5, tool: 'pickaxe', tier: 1, tab: 'natural' }, ['tube', 'brain', 'bubble', 'fire', 'horn'].map(c => ({ key: `${c}_coral_block`, tex: `coral_block_${c}` })));
def('mangrove_roots', { cutout: true, hardness: 0.7, tool: 'axe', sound: 'wood', tab: 'natural' });
def('bamboo', { shape: SHAPE.ROD, opaque: false, hardness: 1, tool: 'axe', sound: 'wood', flags: VF.NONE, tex: 'bamboo_stalk', tab: 'natural' });
def('sweet_berry_bush', { shape: SHAPE.CROSS, hardness: 0, sound: 'grass', flags: VF.PLANT, slow: 0.6, damage: 0.5, drop: 'sweet_berries*2', tab: 'natural' });
def('glow_lichen', { shape: SHAPE.VINE, opaque: false, cutout: true, light: 7, hardness: 0.2, sound: 'grass', facingShift: 0, replaceable: true, drop: 'none', flags: VF.EMISSIVE, tab: 'natural' });
def('cave_vines', { shape: SHAPE.CROSS, light: 14, hardness: 0, sound: 'grass', climbable: true, flags: VF.PLANT, drop: 'glow_berries', tab: 'natural' });
// Mob heads (new ids go last so saved worlds keep their block ids).
def('skull', { shape: SHAPE.SKULL, opaque: false, hardness: 1, sound: 'stone', facingShift: 1, tab: 'functional' }, [
  { key: 'skeleton_skull', tex: { side: 'skeleton_skull_side', top: 'skeleton_skull_top', front: 'skeleton_skull_front' } },
  { key: 'wither_skeleton_skull', tex: { side: 'wither_skull_side', top: 'wither_skull_top', front: 'wither_skull_front' } },
]);

// ----- redstone (behaviour after Java Edition lives in game/redstone.js) -----
// Wire: power in bits 0-3, connected sides (by horizontal facing index) in bits 4-7.
def('redstone_wire', { shape: SHAPE.DUST, opaque: false, solid: false, hardness: 0, sound: 'stone', noItem: true, drop: 'redstone', tex: 'redstone_dust_dot', tab: 'redstone' });
// Torch: variant 0 lit / 1 unlit, attachment in bits 1-3 like the torch.
def('redstone_torch', { shape: SHAPE.TORCH, opaque: false, solid: false, hardness: 0, sound: 'wood', drop: 'redstone_torch', tab: 'redstone' }, [
  { key: 'redstone_torch', light: 7, tex: { side: 'redstone_torch', top: 'rs_torch_head_on' } },
  { key: 'redstone_torch_off', light: 0, noItem: true, tex: { side: 'redstone_torch_off', top: 'rs_torch_head_off' } },
]);
// Repeater: facing (towards its input) bits 0-1, delay-1 bits 2-3, powered bit 4, locked bit 5.
def('repeater', { shape: SHAPE.DIODE, opaque: false, solid: true, hardness: 0, sound: 'stone', tex: { side: 'smooth_stone', top: 'repeater' }, tab: 'redstone' });
// Comparator: facing bits 0-1, subtract mode bit 2, powered bit 3 (its output lives in a block entity).
def('comparator', { shape: SHAPE.DIODE, opaque: false, solid: true, hardness: 0, sound: 'stone', tex: { side: 'smooth_stone', top: 'comparator' }, tab: 'redstone' });
// Lever and buttons: face (0 floor, 1 wall, 2 ceiling), facing and powered.
def('lever', { shape: SHAPE.LEVER, opaque: false, solid: false, hardness: 0.5, sound: 'wood', tex: 'lever', tab: 'redstone' });
def('button', { shape: SHAPE.BUTTON, opaque: false, solid: false, hardness: 0.5, sound: 'stone', tab: 'redstone' }, [
  { key: 'stone_button', tex: 'stone' }, { key: 'oak_button', tex: 'planks_oak', sound: 'wood' }, { key: 'spruce_button', tex: 'planks_spruce', sound: 'wood' },
  { key: 'birch_button', tex: 'planks_birch', sound: 'wood' }, { key: 'jungle_button', tex: 'planks_jungle', sound: 'wood' }, { key: 'acacia_button', tex: 'planks_acacia', sound: 'wood' },
  { key: 'dark_oak_button', tex: 'planks_dark_oak', sound: 'wood' }, { key: 'polished_blackstone_button', tex: 'polished_blackstone' },
]);
// Pressure plates: variant bits 0-1, power bits 2-5.
def('pressure_plate', { shape: SHAPE.PLATE, opaque: false, solid: false, hardness: 0.5, tool: 'pickaxe', tab: 'redstone' }, [
  { key: 'stone_pressure_plate', tex: 'stone' }, { key: 'oak_pressure_plate', tex: 'planks_oak', sound: 'wood', tool: 'axe' },
  { key: 'light_weighted_pressure_plate', tex: 'gold_block', sound: 'metal' }, { key: 'heavy_weighted_pressure_plate', tex: 'iron_block', sound: 'metal' },
]);
def('redstone_block', { hardness: 5, tool: 'pickaxe', tier: 1, sound: 'metal', tab: 'redstone' });
def('redstone_lamp', { hardness: 0.3, sound: 'glass', drop: 'redstone_lamp', tab: 'redstone' }, [{ key: 'redstone_lamp' }, { key: 'redstone_lamp_on', light: 15, noItem: true }]);
// Note block: note bits 0-4, powered bit 5.
def('note_block', { hardness: 0.8, tool: 'axe', sound: 'wood', tab: 'redstone' });
// Target: power bits 0-3.
def('target', { hardness: 0.5, tool: 'hoe', sound: 'grass', tex: { side: 'target_side', top: 'target_top' }, tab: 'redstone' });
// Observer, dispenser, dropper: six-way facing (Java order: down up north south west east) bits 0-2, powered/triggered bit 3.
def('observer', { shape: SHAPE.DIRCUBE, opaque: true, hardness: 3, tool: 'pickaxe', tier: 1, tex: { side: 'observer_side', top: 'observer_top', front: 'observer_front' }, tab: 'redstone' });
// Daylight detector: power bits 0-3, inverted bit 4.
def('daylight_detector', { shape: SHAPE.DAYLIGHT, opaque: false, solid: true, hardness: 0.2, tool: 'axe', sound: 'wood', flammable: true, tex: { side: 'daylight_detector_side', top: 'daylight_detector_top' }, tab: 'redstone' });
// Pistons: variant 0 normal / 1 sticky, six-way facing bits 1-3, extended bit 4. The head adds "short" in bit 4.
def('piston', { shape: SHAPE.PISTON, opaque: false, solid: true, hardness: 1.5, tool: 'pickaxe', tab: 'redstone' }, [
  { key: 'piston', tex: { side: 'piston_side', top: 'piston_top', bottom: 'piston_bottom' } },
  { key: 'sticky_piston', tex: { side: 'piston_side', top: 'piston_top_sticky', bottom: 'piston_bottom' } },
]);
def('piston_head', { shape: SHAPE.PISTON_HEAD, opaque: false, solid: true, hardness: 1.5, tool: 'pickaxe', noItem: true, drop: 'none' }, [
  { key: 'piston_head', tex: { side: 'piston_side', top: 'piston_top' } }, { key: 'sticky_piston_head', tex: { side: 'piston_side', top: 'piston_top_sticky' } },
]);
// A block in motion: drawn from its block entity, like the original's moving_piston.
def('moving_piston', { shape: SHAPE.NONE, opaque: false, solid: false, hardness: Infinity, noItem: true, drop: 'none', tex: 'piston_side' });
def('slime_block', { translucent: true, hardness: 0, sound: 'slime', cullSame: true, tab: 'redstone' });
def('honey_block', { translucent: true, hardness: 0, sound: 'slime', cullSame: true, slow: 0.6, tex: { side: 'honey_block_side', top: 'honey_block_top' }, tab: 'redstone' });
// Hopper: facing (0 down, 2-5 sideways; Java order) bits 0-2, disabled (powered) bit 3.
def('hopper', { shape: SHAPE.HOPPER, opaque: false, solid: true, hardness: 3, tool: 'pickaxe', tier: 1, sound: 'metal', tex: { side: 'hopper_outside', top: 'hopper_top', bottom: 'hopper_outside' }, tab: 'redstone' });
def('dispenser', { shape: SHAPE.DIRCUBE, opaque: true, hardness: 3.5, tool: 'pickaxe', tier: 1, tex: { side: 'furnace_side', top: 'furnace_top', front: 'dispenser_front' }, tab: 'redstone' });
def('dropper', { shape: SHAPE.DIRCUBE, opaque: true, hardness: 3.5, tool: 'pickaxe', tier: 1, tex: { side: 'furnace_side', top: 'furnace_top', front: 'dropper_front' }, tab: 'redstone' });
// Enchanting: the table (12 px tall) and the anvil, which wears from intact to chipped to damaged.
def('enchanting_table', { shape: SHAPE.ENCHANTER, opaque: false, solid: true, hardness: 5, resistance: 1200, tool: 'pickaxe', tier: 1, light: 7, tex: { side: 'enchanting_table_side', top: 'enchanting_table_top', bottom: 'enchanting_table_bottom' }, tab: 'functional' });
def('anvil', { shape: SHAPE.ANVIL, opaque: false, solid: true, hardness: 5, resistance: 1200, tool: 'pickaxe', tier: 1, sound: 'metal', gravity: true, facingShift: 2, tab: 'functional' }, [
  { key: 'anvil', tex: { side: 'anvil', top: 'anvil_top', bottom: 'anvil' } },
  { key: 'chipped_anvil', tex: { side: 'anvil', top: 'chipped_anvil_top', bottom: 'anvil' } },
  { key: 'damaged_anvil', tex: { side: 'anvil', top: 'damaged_anvil_top', bottom: 'anvil' } },
]);

// Textures reached through state rather than a variant's default faces.
for (let i = 0; i < 8; i++) tex(`wheat_stage${i}`);
for (const c of ['carrots', 'potatoes', 'beetroots', 'nether_wart']) for (let i = 0; i < 4; i++) tex(`${c}_stage${i}`);
for (const c of ['pumpkin_stem', 'melon_stem']) for (let i = 0; i < 8; i++) tex(`${c}_stage${i}`);
for (let i = 0; i < 10; i++) tex(`destroy_${i}`);
// Chests, beds and skulls wear Java's block-entity texture sheets ([width, height, pack image,
// tiles used]), cut into 16x16 layers named <sheet>_sheet_<n> (row by row; the models use the first
// n), so a pack's sheet maps onto them texel for texel (see mesh/mesher.js).
export const SHEETS = { chest: [64, 64, 'entity/chest/normal', 12], skeleton_skull: [64, 32, 'entity/skeleton/skeleton', 2], wither_skull: [64, 32, 'entity/skeleton/wither_skeleton', 2] };
for (const c of COLORS) SHEETS[`${c}_bed`] = [64, 64, `entity/bed/${c}`, 11];
for (const [k, [, , , n]] of Object.entries(SHEETS)) for (let i = 0; i < n; i++) tex(`${k}_sheet_${i}`);
for (const t of ['bed_top_head', 'end_portal_frame_eye', 'water_flow', 'lava_flow', 'lantern_hanging', 'campfire_log', 'campfire_log_lit', 'glass_pane_top']) tex(t);
// Flowing liquid tops: the whole (twice as large) flow frame, turned along the current like Java's.
for (const t of ['water_flow_top', 'lava_flow_top', 'water_overlay']) tex(t);
for (const t of ['redstone_dust_line', 'repeater_on', 'comparator_on', 'lever_base', 'observer_back', 'observer_back_on', 'daylight_detector_inverted_top',
  'piston_inner', 'hopper_inside', 'dispenser_front_vertical', 'dropper_front_vertical', 'bedrock', 'cobblestone']) tex(t);
export const CROP_STAGES = [8, 4, 4, 4, 8, 8, 4];
export const CROP_TEX = ['wheat', 'carrots', 'potatoes', 'beetroots', 'pumpkin_stem', 'melon_stem', 'nether_wart'].map(c => TEX[`${c}_stage0`]);
export const CROP_AGE_SHIFT = 3;

// ----- lookup tables -----
export const MAX_ID = nextId;
export const OPAQUE = new Uint8Array(256);
export const SHAPE_OF = new Uint8Array(256);
export const TRANSLUCENT = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const ATTEN = new Uint8Array(256);
export const VFLAGS = new Uint8Array(256);
export const CULL_SAME = new Uint8Array(256);
export const TINT_OF = new Uint8Array(256);
export const WATERLOGGED = new Uint8Array(256);
export const VARIANT_MASK = new Uint8Array(256);
export const FACING_SHIFT = new Int8Array(256).fill(-1);
export const AXIS_SHIFT = new Int8Array(256).fill(-1);
export const EMIT = new Uint8Array(4096);        // [(id << 4) | variant]
export const FACE_TEX = new Uint16Array(4096 * 7); // faces +X -X +Y -Y +Z -Z front

for (const b of BLOCKS) {
  const id = b.id;
  OPAQUE[id] = b.opaque ? 1 : 0;
  SHAPE_OF[id] = b.shape;
  TRANSLUCENT[id] = b.translucent ? 1 : 0;
  SOLID[id] = b.solid ? 1 : 0;
  ATTEN[id] = b.atten;
  VFLAGS[id] = b.flags;
  CULL_SAME[id] = b.cullSame ? 1 : 0;
  TINT_OF[id] = b.tint;
  WATERLOGGED[id] = b.waterlogged ? 1 : 0;
  VARIANT_MASK[id] = (1 << b.variantBits) - 1;
  FACING_SHIFT[id] = b.facingShift;
  AXIS_SHIFT[id] = b.axisShift;
  for (const v of b.variants) {
    const k = (id << 4) | v.index;
    EMIT[k] = v.light ?? b.light;
    const t = v.tex;
    FACE_TEX.set([TEX[t.side], TEX[t.side], TEX[t.top], TEX[t.bottom], TEX[t.side], TEX[t.side], TEX[t.front ?? t.side]], k * 7);
  }
}

// Merged properties for one block state.
export function props(id, meta = 0) {
  const b = BLOCKS[id];
  if (!b) return BLOCKS[0];
  const v = b.variants[meta & VARIANT_MASK[id]] || b.variants[0];
  return {
    id, b, v, name: v.name, key: v.key,
    hardness: v.hardness ?? b.hardness, tool: v.tool ?? b.tool, tier: v.tier ?? b.tier,
    sound: v.sound ?? b.sound, drop: v.drop ?? b.drop, light: v.light ?? b.light,
    slow: v.slow ?? b.slow, damage: v.damage ?? b.damage, resistance: v.resistance ?? b.resistance,
  };
}

export const variantOf = (id, meta) => meta & VARIANT_MASK[id];
export const facingOf = (id, meta) => FACING_SHIFT[id] < 0 ? 0 : (meta >> FACING_SHIFT[id]) & 3;

// Every variant key -> [id, meta] (world generation and commands).
export const STATE = {};
for (const b of BLOCKS) for (const v of b.variants) STATE[v.key] = [b.id, v.index];
export const st = key => { const s = STATE[key]; if (!s) throw new Error(`Unknown block state ${key}`); return s; };

// Block states that can exist as items: key -> [id, meta].
export const BLOCK_ITEMS = [];
for (const b of BLOCKS) {
  if (b.noItem) continue;
  for (const v of b.variants) if (!v.noItem) BLOCK_ITEMS.push({ key: v.key, name: v.name, id: b.id, meta: v.index, tab: b.tab });
}
