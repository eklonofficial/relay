// What a broken block drops, given the tool used.
import { props, CROP_STAGES, CROP_AGE_SHIFT, B } from '../data/blocks.js?v=mupp7m39';
import { I, canHarvest } from '../data/items.js?v=mupp7m39';

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const ORE_XP = { coal: [0, 2], diamond: [3, 7], emerald: [3, 7], lapis: [2, 5], redstone: [1, 5], nether_quartz: [2, 5], nether_gold: [0, 1] };

function parse(spec) {
  const out = [];
  if (!spec || spec === 'none') return out;
  const options = spec.split('|');
  // "a|b:0.1": b with probability 0.1, otherwise a.
  if (options.length > 1) {
    const [k, p] = options[1].split(':');
    return parse(Math.random() < Number(p) ? k : options[0]);
  }
  let [k, chance] = spec.split(':');
  if (chance !== undefined && Math.random() >= Number(chance)) return out;
  let n = 1;
  if (k.includes('*')) { const [a, b] = k.split('*'); k = a; n = Number(b); }
  if (I[k]) out.push({ key: k, count: n });
  return out;
}

// Returns { items: [{key,count}], xp }.
export function blockDrops(id, meta, heldItem, { creative = false, shears = false } = {}) {
  if (creative) return { items: [], xp: 0 };
  const p = props(id, meta);
  const item = heldItem ? I[heldItem.key] : null;
  if (!canHarvest(p, item)) return { items: [], xp: 0 };
  const key = p.key;
  let xp = 0;
  for (const [ore, [a, b]] of Object.entries(ORE_XP)) if (key === `${ore}_ore` || key === `deepslate_${ore}_ore`) xp = rint(a, b);
  const drop = p.drop;
  if (shears || (item && item.tool && item.tool.type === 'shears')) {
    if (id === B.LEAVES || id === B.VINE || id === B.COBWEB || key === 'short_grass' || key === 'fern' || id === B.SEAGRASS || id === B.GLOW_LICHEN) {
      const k = key === 'cobweb' ? 'cobweb' : key;
      return { items: I[k] ? [{ key: k, count: 1 }] : [], xp };
    }
  }
  // Silk Touch takes the block itself (ores, glass, ice, grass, bookshelves...) and no experience.
  const ench = (heldItem && heldItem.tag && heldItem.tag.ench) || {};
  if (ench.silk_touch && I[key] && !(drop && drop.endsWith('_crop')) && !/_door$|_bed$|^bed$/.test(key)) return { items: [{ key, count: 1 }], xp: 0 };
  if (drop && drop.endsWith('_leaves_drop')) {
    const wood = drop.slice(0, -'_leaves_drop'.length);
    const items = [];
    const fo = ench.fortune || 0;
    if (Math.random() < [0.05, 0.0625, 0.083, 0.1][Math.min(3, fo)] && I[`${wood}_sapling`]) items.push({ key: `${wood}_sapling`, count: 1 });
    if (Math.random() < 0.02) items.push({ key: 'stick', count: rint(1, 2) });
    if ((wood === 'oak' || wood === 'dark_oak') && Math.random() < 0.005) items.push({ key: 'apple', count: 1 });
    return { items, xp };
  }
  if (drop && drop.endsWith('_crop')) {
    const v = meta & 7, age = (meta >> CROP_AGE_SHIFT) & 7, ripe = age >= CROP_STAGES[v] - 1;
    const items = [];
    switch (drop) {
      case 'wheat_crop': if (ripe) items.push({ key: 'wheat', count: 1 }); items.push({ key: 'wheat_seeds', count: ripe ? rint(1, 3) : 1 }); break;
      case 'carrot_crop': items.push({ key: 'carrot', count: ripe ? rint(2, 5) : 1 }); break;
      case 'potato_crop': items.push({ key: 'potato', count: ripe ? rint(2, 5) : 1 }); if (ripe && Math.random() < 0.02) items.push({ key: 'poisonous_potato', count: 1 }); break;
      case 'beetroot_crop': if (ripe) items.push({ key: 'beetroot', count: 1 }); items.push({ key: 'beetroot_seeds', count: ripe ? rint(1, 3) : 1 }); break;
      case 'nether_wart_crop': items.push({ key: 'nether_wart', count: ripe ? rint(2, 4) : 1 }); break;
      default: break;
    }
    return { items, xp };
  }
  if (drop !== undefined) {
    const items = parse(drop), fo = ench.fortune || 0;
    // Fortune: ores multiply their drop by 1..level+1, weighted towards 1 (the original's ore formula).
    if (fo && (/_ore$/.test(key) || key === 'amethyst_cluster')) for (const s of items) s.count *= Math.max(0, rint(0, fo + 1) - 1) + 1;
    else if (fo && (key === 'glowstone' || key === 'melon' || key === 'sea_lantern')) for (const s of items) s.count = Math.min(key === 'glowstone' ? 4 : key === 'melon' ? 9 : 5, s.count + rint(0, fo));
    return { items, xp };
  }
  // Default: the block's own item.
  if (I[key]) return { items: [{ key, count: 1 }], xp };
  return { items: [], xp };
}
