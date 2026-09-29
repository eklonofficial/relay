// Block registry shared by the main thread and the workers.

export const CHUNK = 16;
export const HEIGHT = 128;
export const SEA = 50;
export const PAD = 14;             // border copied around a chunk so meshing and light see its neighbours
export const PS = CHUNK + PAD * 2; // padded width

export const R_NONE = 0, R_CUBE = 1, R_CROSS = 2, R_TORCH = 3, R_LIQUID = 4;

// Vertex flags consumed by the shaders.
export const F_NONE = 0, F_LEAVES = 1, F_PLANT = 2, F_WATER_TOP = 3, F_LAVA = 4, F_WATER = 5, F_EMISSIVE = 7, F_ICE = 8;

export const TEXTURES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone', 'sand', 'gravel', 'bedrock',
  'log_oak', 'log_oak_top', 'leaves_oak', 'log_birch', 'log_birch_top', 'leaves_birch',
  'log_spruce', 'log_spruce_top', 'leaves_spruce', 'planks_oak', 'glass', 'water', 'snow',
  'grass_snowed', 'ice', 'sandstone', 'sandstone_top', 'cactus_side', 'cactus_top',
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'bricks', 'glowstone', 'torch', 'torch_top',
  'tall_grass', 'poppy', 'dandelion', 'dead_bush', 'stone_bricks', 'mossy_cobblestone',
  'bookshelf', 'pumpkin_side', 'pumpkin_top', 'wool_white', 'wool_red', 'wool_blue', 'wool_yellow',
  'lava', 'obsidian', 'blue_orchid',
  'destroy_0', 'destroy_1', 'destroy_2', 'destroy_3', 'destroy_4',
  'destroy_5', 'destroy_6', 'destroy_7', 'destroy_8', 'destroy_9',
];
export const TEX = Object.fromEntries(TEXTURES.map((n, i) => [n, i]));

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLESTONE: 4, SAND: 5, GRAVEL: 6, BEDROCK: 7,
  OAK_LOG: 8, OAK_LEAVES: 9, BIRCH_LOG: 10, BIRCH_LEAVES: 11, SPRUCE_LOG: 12, SPRUCE_LEAVES: 13,
  PLANKS: 14, GLASS: 15, WATER: 16, SNOW: 17, SNOWY_GRASS: 18, ICE: 19, SANDSTONE: 20, CACTUS: 21,
  COAL_ORE: 22, IRON_ORE: 23, GOLD_ORE: 24, DIAMOND_ORE: 25, BRICKS: 26, GLOWSTONE: 27, TORCH: 28,
  TALL_GRASS: 29, POPPY: 30, DANDELION: 31, DEAD_BUSH: 32, STONE_BRICKS: 33, MOSSY_COBBLESTONE: 34,
  BOOKSHELF: 35, PUMPKIN: 36, WOOL_WHITE: 37, WOOL_RED: 38, WOOL_BLUE: 39, WOOL_YELLOW: 40,
  LAVA: 41, OBSIDIAN: 42, BLUE_ORCHID: 43,
};

export const BLOCKS = [];

function def(id, name, o = {}) {
  const render = o.render ?? R_CUBE;
  const t = o.tex ?? name.toLowerCase().replace(/ /g, '_');
  const tex = typeof t === 'string' ? { top: t, bottom: t, side: t } : { side: t.side, top: t.top ?? t.side, bottom: t.bottom ?? t.top ?? t.side };
  BLOCKS[id] = {
    id, name, render, tex,
    opaque: o.opaque ?? (render === R_CUBE && !o.cutout && !o.translucent),
    cutout: !!o.cutout,
    translucent: !!o.translucent,
    solid: o.solid ?? (render === R_CUBE),
    light: o.light ?? 0,
    atten: o.atten ?? 0,
    hardness: o.hardness ?? 1,
    sound: o.sound ?? 'stone',
    flags: o.flags ?? F_NONE,
    cullSame: !!o.cullSame,
    inventory: o.inventory ?? true,
  };
}

def(B.AIR, 'Air', { render: R_NONE, opaque: false, solid: false, inventory: false });
def(B.GRASS, 'Grass Block', { tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.45, sound: 'grass' });
def(B.DIRT, 'Dirt', { hardness: 0.4, sound: 'gravel' });
def(B.STONE, 'Stone', { hardness: 1.1 });
def(B.COBBLESTONE, 'Cobblestone', { hardness: 1.3 });
def(B.SAND, 'Sand', { hardness: 0.4, sound: 'sand' });
def(B.GRAVEL, 'Gravel', { hardness: 0.45, sound: 'gravel' });
def(B.BEDROCK, 'Bedrock', { hardness: Infinity, inventory: false });
def(B.OAK_LOG, 'Oak Log', { tex: { side: 'log_oak', top: 'log_oak_top' }, hardness: 0.9, sound: 'wood' });
def(B.OAK_LEAVES, 'Oak Leaves', { tex: 'leaves_oak', cutout: true, atten: 1, hardness: 0.15, sound: 'grass', flags: F_LEAVES });
def(B.BIRCH_LOG, 'Birch Log', { tex: { side: 'log_birch', top: 'log_birch_top' }, hardness: 0.9, sound: 'wood' });
def(B.BIRCH_LEAVES, 'Birch Leaves', { tex: 'leaves_birch', cutout: true, atten: 1, hardness: 0.15, sound: 'grass', flags: F_LEAVES });
def(B.SPRUCE_LOG, 'Spruce Log', { tex: { side: 'log_spruce', top: 'log_spruce_top' }, hardness: 0.9, sound: 'wood' });
def(B.SPRUCE_LEAVES, 'Spruce Leaves', { tex: 'leaves_spruce', cutout: true, atten: 1, hardness: 0.15, sound: 'grass', flags: F_LEAVES });
def(B.PLANKS, 'Oak Planks', { tex: 'planks_oak', hardness: 0.8, sound: 'wood' });
def(B.GLASS, 'Glass', { cutout: true, hardness: 0.25, sound: 'glass', cullSame: true });
def(B.WATER, 'Water', { render: R_LIQUID, translucent: true, solid: false, atten: 2, flags: F_WATER, inventory: false, cullSame: true });
def(B.SNOW, 'Snow', { hardness: 0.3, sound: 'snow' });
def(B.SNOWY_GRASS, 'Snowy Grass', { tex: { top: 'snow', side: 'grass_snowed', bottom: 'dirt' }, hardness: 0.45, sound: 'snow' });
def(B.ICE, 'Ice', { translucent: true, atten: 1, hardness: 0.4, sound: 'glass', flags: F_ICE, cullSame: true });
def(B.SANDSTONE, 'Sandstone', { tex: { side: 'sandstone', top: 'sandstone_top' }, hardness: 0.9 });
def(B.CACTUS, 'Cactus', { tex: { side: 'cactus_side', top: 'cactus_top' }, hardness: 0.3, sound: 'cloth' });
def(B.COAL_ORE, 'Coal Ore', { hardness: 1.4 });
def(B.IRON_ORE, 'Iron Ore', { hardness: 1.6 });
def(B.GOLD_ORE, 'Gold Ore', { hardness: 1.6 });
def(B.DIAMOND_ORE, 'Diamond Ore', { hardness: 1.8 });
def(B.BRICKS, 'Bricks', { hardness: 1.2 });
def(B.GLOWSTONE, 'Glowstone', { light: 15, hardness: 0.4, sound: 'glass', flags: F_EMISSIVE });
def(B.TORCH, 'Torch', { render: R_TORCH, tex: { side: 'torch', top: 'torch_top' }, opaque: false, solid: false, light: 14, hardness: 0, sound: 'wood', flags: F_EMISSIVE });
def(B.TALL_GRASS, 'Tall Grass', { render: R_CROSS, opaque: false, solid: false, hardness: 0, sound: 'grass', flags: F_PLANT });
def(B.POPPY, 'Poppy', { render: R_CROSS, opaque: false, solid: false, hardness: 0, sound: 'grass', flags: F_PLANT });
def(B.DANDELION, 'Dandelion', { render: R_CROSS, opaque: false, solid: false, hardness: 0, sound: 'grass', flags: F_PLANT });
def(B.DEAD_BUSH, 'Dead Bush', { render: R_CROSS, opaque: false, solid: false, hardness: 0, sound: 'grass', flags: F_PLANT });
def(B.STONE_BRICKS, 'Stone Bricks', { hardness: 1.2 });
def(B.MOSSY_COBBLESTONE, 'Mossy Cobblestone', { hardness: 1.3 });
def(B.BOOKSHELF, 'Bookshelf', { tex: { side: 'bookshelf', top: 'planks_oak' }, hardness: 0.6, sound: 'wood' });
def(B.PUMPKIN, 'Pumpkin', { tex: { side: 'pumpkin_side', top: 'pumpkin_top' }, hardness: 0.5, sound: 'wood' });
def(B.WOOL_WHITE, 'White Wool', { tex: 'wool_white', hardness: 0.3, sound: 'cloth' });
def(B.WOOL_RED, 'Red Wool', { tex: 'wool_red', hardness: 0.3, sound: 'cloth' });
def(B.WOOL_BLUE, 'Blue Wool', { tex: 'wool_blue', hardness: 0.3, sound: 'cloth' });
def(B.WOOL_YELLOW, 'Yellow Wool', { tex: 'wool_yellow', hardness: 0.3, sound: 'cloth' });
def(B.LAVA, 'Lava', { render: R_LIQUID, translucent: true, solid: false, light: 15, flags: F_LAVA, inventory: false, cullSame: true });
def(B.OBSIDIAN, 'Obsidian', { hardness: 3.0 });
def(B.BLUE_ORCHID, 'Blue Orchid', { render: R_CROSS, opaque: false, solid: false, hardness: 0, sound: 'grass', flags: F_PLANT });

// Flat lookup tables for the hot loops in the workers.
export const OPAQUE = new Uint8Array(256);
export const RENDER = new Uint8Array(256);
export const TRANSLUCENT = new Uint8Array(256);
export const EMIT = new Uint8Array(256);
export const ATTEN = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const VFLAGS = new Uint8Array(256);
export const CULL_SAME = new Uint8Array(256);
export const FACE_TEX = new Uint8Array(256 * 6); // faces: +X -X +Y -Y +Z -Z

for (const b of BLOCKS) {
  if (!b) continue;
  OPAQUE[b.id] = b.opaque ? 1 : 0;
  RENDER[b.id] = b.render;
  TRANSLUCENT[b.id] = b.translucent ? 1 : 0;
  EMIT[b.id] = b.light;
  ATTEN[b.id] = b.atten;
  SOLID[b.id] = b.solid ? 1 : 0;
  VFLAGS[b.id] = b.flags;
  CULL_SAME[b.id] = b.cullSame ? 1 : 0;
  if (b.render !== R_NONE) {
    for (const t of [b.tex.side, b.tex.top, b.tex.bottom]) if (!(t in TEX)) throw new Error(`Block ${b.name} uses unknown texture ${t}`);
    const side = TEX[b.tex.side], top = TEX[b.tex.top], bottom = TEX[b.tex.bottom];
    FACE_TEX.set([side, side, top, bottom, side, side], b.id * 6);
  }
}

export const INVENTORY = BLOCKS.filter(b => b && b.inventory).map(b => b.id);
