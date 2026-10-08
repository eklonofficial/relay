// The cosmetic catalogue (GDD §22): shell colours, shell patterns and their colour, stamps (a
// decal on the front of the shell), hats and per-weapon gun skins. Pure data, shared by the shop,
// the renderer, the bots and the host's check of what guests send (cosmetics are only ever drawn,
// never interpreted). Almost everything is free; gun skins and a few hats open up with eggs
// (game/progress.js).

import { HAT_NODES, STAMP_IDS, WEAPON_ASSETS } from '../render/asset-catalog.js?v=muzischz';

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
// Stamps: the imported decals, drawn on the front of the shell.
export const STAMPS = [{ id: 'none', name: 'None' }, ...STAMP_IDS.map((id, i) => ({ id, name: `Stamp ${i + 1}` }))];
// Hats: the imported hats and accessories. The named ones keep the ids saved profiles use (and the
// prices of the rare few); the rest follow, numbered. node: the hat's mesh in the character bundle.
const NAMED_HATS = [
  ['cap', 'Ball Cap', 537], ['beanie', 'Beanie', 528], ['chef', 'Chef', 476], ['cowboy', 'Cowboy', 521], ['viking', 'Viking', 237],
  ['wizard', 'Wizard', 478], ['party', 'Party', 458], ['headphones', 'Headphones', 512], ['bunny', 'Bunny Ears', 498], ['pirate', 'Pirate', 508],
  ['sombrero', 'Sombrero', 625], ['beret', 'Beret', 312], ['bucket', 'Bucket Hat', 212], ['antenna', 'Antennae', 21], ['horns', 'Devil Horns', 491],
  ['santa', 'Santa', 454], ['bow', 'Bow', 525], ['fez', 'Fez', 470], ['mohawk', 'Mohawk', 511],
  ['tophat', 'Top Hat', 502, 6000], ['halo', 'Halo', 494, 12000], ['crown', 'Crown', 520, 25000],
];
const named = new Set(NAMED_HATS.map(h => h[2]));
export const HATS = [
  { id: 'none', name: 'No Hat', price: 0 },
  ...NAMED_HATS.map(([id, name, node, price = 0]) => ({ id, name, node, price })),
  ...HAT_NODES.filter(n => !named.has(n)).map((node, i) => ({ id: `h${node}`, name: `Hat ${i + 1}`, node, price: 0 })),
];
// Gun skins: each weapon has its own set (skin 0 is its standard finish). A look keeps one per weapon.
export const SKIN_COUNTS = Object.fromEntries(Object.entries(WEAPON_ASSETS).map(([id, w]) => [id, w.skins.length]));
export const skinName = i => i === 0 ? 'Standard' : `Skin ${i}`;
const ids = list => new Set(list.map(x => x.id));
const PATTERN_IDS = ids(PATTERNS), STAMP_SET = ids(STAMPS), HAT_SET = ids(HATS);
export const DEFAULT_LOOK = { color: 0, hat: 'none', pattern: 'none', pcolor: 13, stamp: 'none', skins: {} };
// A look's skin for one weapon.
export const skinOf = (look, weapon) => look?.skins?.[weapon] ?? 0;

// Only known values (anything else falls back to the default).
export function sanitizeCosmetics(c) {
  const idx = v => Number.isInteger(v) && v >= 0 && v < COLORS.length;
  return {
    color: idx(c?.color) ? c.color : 0, pcolor: idx(c?.pcolor) ? c.pcolor : DEFAULT_LOOK.pcolor,
    hat: HAT_SET.has(c?.hat) ? c.hat : 'none', pattern: PATTERN_IDS.has(c?.pattern) ? c.pattern : 'none',
    stamp: STAMP_SET.has(c?.stamp) ? c.stamp : 'none', skins: sanitizeSkins(c?.skins),
  };
}

function sanitizeSkins(skins) {
  const out = {};
  if (skins && typeof skins === 'object') for (const [id, n] of Object.entries(SKIN_COUNTS)) {
    const v = skins[id];
    if (Number.isInteger(v) && v > 0 && v < n) out[id] = v;
  }
  return out;
}

// A bot's look: a plain egg in a natural shell colour (white, cream, tan, the browns), with no
// pattern, stamp or hat and standard guns, so real players (who dress up) stand out from bots.
export const NATURAL = [14, 0, 1, 2, 3, 4];
export function botCosmetics(rnd = Math.random) {
  return { color: NATURAL[Math.floor(rnd() * NATURAL.length)], pcolor: 13, hat: 'none', pattern: 'none', stamp: 'none', skins: {} };
}
