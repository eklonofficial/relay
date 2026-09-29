// Biome table shared by world generation (surface rules, features, spawns) and the mesher (tint colours).

const BIOME_DEFS = [
  // key, name, temperature, grass, foliage, water, extra
  ['ocean', 'Ocean', 0.5, 0x8eb971, 0x71a74d, 0x3f76e4],
  ['deep_ocean', 'Deep Ocean', 0.5, 0x8eb971, 0x71a74d, 0x3a6ad8],
  ['warm_ocean', 'Warm Ocean', 0.9, 0x8eb971, 0x71a74d, 0x43d5ee],
  ['cold_ocean', 'Cold Ocean', 0.2, 0x8eb971, 0x71a74d, 0x3d57d6],
  ['frozen_ocean', 'Frozen Ocean', -0.2, 0x80b497, 0x60a17b, 0x3938c9],
  ['beach', 'Beach', 0.8, 0x91bd59, 0x77ab2f, 0x3f76e4],
  ['snowy_beach', 'Snowy Beach', -0.1, 0x80b497, 0x60a17b, 0x3d57d6],
  ['stony_shore', 'Stony Shore', 0.2, 0x8ab689, 0x6da36b, 0x3f76e4],
  ['river', 'River', 0.5, 0x8eb971, 0x71a74d, 0x3f76e4],
  ['frozen_river', 'Frozen River', -0.2, 0x80b497, 0x60a17b, 0x3938c9],
  ['plains', 'Plains', 0.8, 0x91bd59, 0x77ab2f, 0x3f76e4],
  ['sunflower_plains', 'Sunflower Plains', 0.8, 0x91bd59, 0x77ab2f, 0x3f76e4],
  ['forest', 'Forest', 0.7, 0x79c05a, 0x59ae30, 0x3f76e4],
  ['flower_forest', 'Flower Forest', 0.7, 0x79c05a, 0x59ae30, 0x3f76e4],
  ['birch_forest', 'Birch Forest', 0.6, 0x88bb67, 0x6ba941, 0x3f76e4],
  ['dark_forest', 'Dark Forest', 0.7, 0x507a32, 0x59ae30, 0x3f76e4],
  ['taiga', 'Taiga', 0.25, 0x86b783, 0x68a464, 0x3d57d6],
  ['snowy_taiga', 'Snowy Taiga', -0.5, 0x80b497, 0x60a17b, 0x3d57d6],
  ['snowy_plains', 'Snowy Plains', 0.0, 0x80b497, 0x60a17b, 0x3d57d6],
  ['ice_spikes', 'Ice Spikes', 0.0, 0x80b497, 0x60a17b, 0x3938c9],
  ['desert', 'Desert', 2.0, 0xbfb755, 0xaea42a, 0x32a598],
  ['savanna', 'Savanna', 2.0, 0xbfb755, 0xaea42a, 0x2c8b9c],
  ['badlands', 'Badlands', 2.0, 0x90814d, 0x9e814d, 0x4e7f81],
  ['jungle', 'Jungle', 0.95, 0x59c93c, 0x30bb0b, 0x14a2c5],
  ['swamp', 'Swamp', 0.8, 0x6a7039, 0x6a7039, 0x617b64],
  ['mangrove_swamp', 'Mangrove Swamp', 0.8, 0x6a7039, 0x8db127, 0x3a7a6a],
  ['cherry_grove', 'Cherry Grove', 0.5, 0xb6db61, 0xb6db61, 0x5db7ef],
  ['meadow', 'Meadow', 0.5, 0x83bb6d, 0x63a948, 0x0e4ecf],
  ['grove', 'Grove', -0.2, 0x80b497, 0x60a17b, 0x3d57d6],
  ['snowy_slopes', 'Snowy Slopes', -0.3, 0x80b497, 0x60a17b, 0x3d57d6],
  ['jagged_peaks', 'Jagged Peaks', -0.7, 0x80b497, 0x60a17b, 0x3d57d6],
  ['frozen_peaks', 'Frozen Peaks', -0.7, 0x80b497, 0x60a17b, 0x3d57d6],
  ['stony_peaks', 'Stony Peaks', 1.0, 0x9abe4b, 0x82ac1e, 0x3f76e4],
  ['mushroom_fields', 'Mushroom Fields', 0.9, 0x55c93f, 0x2bbb0f, 0x3f76e4],
  ['windswept_hills', 'Windswept Hills', 0.2, 0x8ab689, 0x6da36b, 0x3f76e4],
  ['old_growth_taiga', 'Old Growth Spruce Taiga', 0.25, 0x86b87f, 0x68a55f, 0x3d57d6],
  ['bamboo_jungle', 'Bamboo Jungle', 0.95, 0x59c93c, 0x30bb0b, 0x14a2c5],
  ['eroded_badlands', 'Eroded Badlands', 2.0, 0x90814d, 0x9e814d, 0x4e7f81],
  ['lush_caves', 'Lush Caves', 0.5, 0x91bd59, 0x77ab2f, 0x3f76e4],
  ['dripstone_caves', 'Dripstone Caves', 0.8, 0x91bd59, 0x77ab2f, 0x3f76e4],
  ['nether_wastes', 'Nether Wastes', 2.0, 0xbfb755, 0xaea42a, 0x3f76e4],
  ['crimson_forest', 'Crimson Forest', 2.0, 0xbfb755, 0xaea42a, 0x3f76e4],
  ['warped_forest', 'Warped Forest', 2.0, 0xbfb755, 0xaea42a, 0x3f76e4],
  ['soul_sand_valley', 'Soul Sand Valley', 2.0, 0xbfb755, 0xaea42a, 0x3f76e4],
  ['basalt_deltas', 'Basalt Deltas', 2.0, 0xbfb755, 0xaea42a, 0x3f76e4],
  ['the_end', 'The End', 0.5, 0x8eb971, 0x71a74d, 0x3f76e4],
  ['end_highlands', 'End Highlands', 0.5, 0x8eb971, 0x71a74d, 0x3f76e4],
  ['floating_isles', 'Floating Isles', 0.6, 0x7fd15c, 0x5cc238, 0x3fa0e4],
];

export const BIOMES = BIOME_DEFS.map(([key, name, temp, grass, foliage, water], id) => ({ id, key, name, temp, grass, foliage, water }));
export const BI = {};
for (const b of BIOMES) BI[b.key.toUpperCase()] = b.id;

export const BIOME_COLORS = new Uint8Array(256 * 9); // grass rgb, foliage rgb, water rgb
for (const b of BIOMES) {
  [b.grass, b.foliage, b.water].forEach((c, k) => {
    BIOME_COLORS[b.id * 9 + k * 3] = (c >> 16) & 255;
    BIOME_COLORS[b.id * 9 + k * 3 + 1] = (c >> 8) & 255;
    BIOME_COLORS[b.id * 9 + k * 3 + 2] = c & 255;
  });
}

export const COLD = new Set(['frozen_ocean', 'snowy_beach', 'frozen_river', 'snowy_taiga', 'snowy_plains', 'ice_spikes', 'grove', 'snowy_slopes', 'jagged_peaks', 'frozen_peaks'].map(k => BI[k.toUpperCase()]));
export const OCEANS = new Set(['ocean', 'deep_ocean', 'warm_ocean', 'cold_ocean', 'frozen_ocean'].map(k => BI[k.toUpperCase()]));
export const DRY = new Set(['desert', 'savanna', 'badlands', 'eroded_badlands', 'nether_wastes', 'crimson_forest', 'warped_forest', 'soul_sand_valley', 'basalt_deltas'].map(k => BI[k.toUpperCase()]));
