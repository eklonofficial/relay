// What a broken block drops, given the tool used.
import { props, CROP_STAGES, CROP_AGE_SHIFT, B } from '../data/blocks.js?v=muono2ew';
import { I, canHarvest } from '../data/items.js?v=muono2ew';

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
  if (drop && drop.endsWith('_leaves_drop')) {
    const wood = drop.slice(0, -'_leaves_drop'.length);
    const items = [];
    if (Math.random() < 0.05 && I[`${wood}_sapling`]) items.push({ key: `${wood}_sapling`, count: 1 });
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
  if (drop !== undefined) return { items: parse(drop), xp };
  // Default: the block's own item.
  if (I[key]) return { items: [{ key, count: 1 }], xp };
  return { items: [], xp };
}
