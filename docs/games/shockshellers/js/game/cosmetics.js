// The cosmetic catalogue (GDD §22): shell colours, shell patterns and their colour, stamps (a
// decal on the front of the shell), hats and gun skins. Pure data, shared by the shop, the renderer,
// the bots and the host's check of what guests send (cosmetics are only ever drawn, never
// interpreted). Almost everything is free; a few hats are earned with yolks.

// Shell colours. The first fourteen keep their old numbers (saved profiles and the wire use them).
export const COLORS = [
  0xfff6e5, 0xf2d0a4, 0xc98e5a, 0x8a5a3b, 0x5b3a26, 0xe9e1ff, 0xd7f0ff, 0xff9eb5, 0x9ee6a0, 0xffd34e, 0x7fb6ff, 0xb98cff, 0xff7a59, 0x2e2e34,
  0xffffff, 0xffe3c2, 0xff5a5a, 0xff9a3c, 0xfff27a, 0xc6ff6b, 0x3ccf7a, 0x48d6c8, 0x3ab0ff, 0x3a5bff, 0x7a4dff, 0xe05cff, 0xff4fa0, 0xa0a8b4,
  0x5d6470, 0x1a1b22, 0xd4a017, 0x8b1e3f,
];
export const PATTERNS = [
  { id: 'none', name: 'Plain' }, { id: 'spots', name: 'Spots' }, { id: 'stripes', name: 'Stripes' }, { id: 'zigzag', name: 'Zigzag' },
  { id: 'polka', name: 'Polka' }, { id: 'hearts', name: 'Hearts' }, { id: 'stars', name: 'Stars' }, { id: 'checker', name: 'Checker' },
  { id: 'split', name: 'Two-Tone' }, { id: 'band', name: 'Racing Band' }, { id: 'freckles', name: 'Freckles' }, { id: 'camo', name: 'Camo' },
  { id: 'flames', name: 'Flames' }, { id: 'bolts', name: 'Lightning' }, { id: 'scales', name: 'Scales' }, { id: 'swirl', name: 'Swirl' },
  { id: 'tiger', name: 'Tiger' }, { id: 'galaxy', name: 'Galaxy' },
];
export const STAMPS = [
  { id: 'none', name: 'None' }, { id: 'smile', name: 'Smile' }, { id: 'googly', name: 'Googly Eyes' }, { id: 'shades', name: 'Shades' },
  { id: 'mustache', name: 'Mustache' }, { id: 'angry', name: 'Grumpy' }, { id: 'blush', name: 'Blush' }, { id: 'star', name: 'Star' },
  { id: 'heart', name: 'Heart' }, { id: 'bolt', name: 'Bolt' }, { id: 'flame', name: 'Flame' }, { id: 'paw', name: 'Paw' },
  { id: 'yolk', name: 'Sunny Side' }, { id: 'clover', name: 'Clover' }, { id: 'target', name: 'Target' }, { id: 'number', name: 'Lucky 7' },
  { id: 'skull', name: 'Skull' }, { id: 'patch', name: 'Eye Patch' },
];
// price 0 = free.
export const HATS = [
  { id: 'none', name: 'No Hat', price: 0 }, { id: 'cap', name: 'Ball Cap', price: 0 }, { id: 'beanie', name: 'Beanie', price: 0 },
  { id: 'chef', name: 'Chef', price: 0 }, { id: 'cowboy', name: 'Cowboy', price: 0 }, { id: 'viking', name: 'Viking', price: 0 },
  { id: 'wizard', name: 'Wizard', price: 0 }, { id: 'party', name: 'Party', price: 0 }, { id: 'propeller', name: 'Propeller', price: 0 },
  { id: 'headphones', name: 'Headphones', price: 0 }, { id: 'bunny', name: 'Bunny Ears', price: 0 }, { id: 'pirate', name: 'Pirate', price: 0 },
  { id: 'sombrero', name: 'Sombrero', price: 0 }, { id: 'beret', name: 'Beret', price: 0 }, { id: 'bucket', name: 'Bucket Hat', price: 0 },
  { id: 'flower', name: 'Flower', price: 0 }, { id: 'antenna', name: 'Antennae', price: 0 }, { id: 'horns', name: 'Devil Horns', price: 0 },
  { id: 'santa', name: 'Santa', price: 0 }, { id: 'hardhat', name: 'Hard Hat', price: 0 }, { id: 'bow', name: 'Bow', price: 0 },
  { id: 'fez', name: 'Fez', price: 0 }, { id: 'grad', name: 'Graduate', price: 0 }, { id: 'mohawk', name: 'Mohawk', price: 0 },
  { id: 'chick', name: 'Baby Chick', price: 0 }, { id: 'sprout', name: 'Sprout', price: 0 },
  { id: 'tophat', name: 'Top Hat', price: 6000 }, { id: 'halo', name: 'Halo', price: 12000 }, { id: 'crown', name: 'Crown', price: 25000 },
];
// Gun skins (palettes in render/guns.js).
export const SKINS = [
  { id: 'factory', name: 'Factory' }, { id: 'arctic', name: 'Arctic' }, { id: 'midnight', name: 'Midnight' }, { id: 'gold', name: 'Gold Rush' },
  { id: 'candy', name: 'Candy' }, { id: 'toxic', name: 'Toxic' }, { id: 'lava', name: 'Lava' }, { id: 'ocean', name: 'Ocean' },
  { id: 'sunset', name: 'Sunset' }, { id: 'bubblegum', name: 'Bubblegum' }, { id: 'chrome', name: 'Chrome' }, { id: 'tiger', name: 'Tiger' },
  { id: 'mint', name: 'Mint' }, { id: 'royal', name: 'Royal' }, { id: 'ghost', name: 'Ghost' }, { id: 'zebra', name: 'Zebra' },
];
const ids = list => new Set(list.map(x => x.id));
const PATTERN_IDS = ids(PATTERNS), STAMP_IDS = ids(STAMPS), HAT_IDS = ids(HATS), SKIN_IDS = ids(SKINS);
export const DEFAULT_LOOK = { color: 0, hat: 'none', pattern: 'none', pcolor: 13, stamp: 'none', skin: 'factory' };

// Only known values (anything else falls back to the default).
export function sanitizeCosmetics(c) {
  const idx = v => Number.isInteger(v) && v >= 0 && v < COLORS.length;
  return {
    color: idx(c?.color) ? c.color : 0, pcolor: idx(c?.pcolor) ? c.pcolor : DEFAULT_LOOK.pcolor,
    hat: HAT_IDS.has(c?.hat) ? c.hat : 'none', pattern: PATTERN_IDS.has(c?.pattern) ? c.pattern : 'none',
    stamp: STAMP_IDS.has(c?.stamp) ? c.stamp : 'none', skin: SKIN_IDS.has(c?.skin) ? c.skin : 'factory',
  };
}

// A bot's look: a plain egg in a natural shell colour (white, cream, tan, the browns), with no
// pattern, stamp or hat and a factory gun, so real players (who dress up) stand out from bots.
export const NATURAL = [14, 0, 1, 2, 3, 4];
export function botCosmetics(rnd = Math.random) {
  return { color: NATURAL[Math.floor(rnd() * NATURAL.length)], pcolor: 13, hat: 'none', pattern: 'none', stamp: 'none', skin: 'factory' };
}
