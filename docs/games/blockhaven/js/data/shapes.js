// Collision and selection boxes per block state, in block units (0..1, fences reach 1.5).
import { SHAPE, SHAPE_OF, SOLID, B } from './blocks.js?v=munmlnfa';

const P = 1 / 16;
// Rotate a canonical (+Z-facing) box by `facing` quarter turns about the block centre.
function rot(b, facing) {
  let [x0, y0, z0, x1, y1, z1] = b;
  for (let r = 0; r < facing; r++) { const a = x0, c = x1; x0 = 1 - z1; x1 = 1 - z0; z0 = a; z1 = c; }
  return [x0, y0, z0, x1, y1, z1];
}
const FULL = [0, 0, 0, 1, 1, 1];

export function collisionBoxes(id, m, out = []) {
  out.length = 0;
  if (!SOLID[id]) return out;
  switch (SHAPE_OF[id]) {
    case SHAPE.CUBE: out.push(FULL); break;
    case SHAPE.SLAB: { const t = (m >> 4) & 3; out.push(t === 0 ? [0, 0, 0, 1, 0.5, 1] : t === 1 ? [0, 0.5, 0, 1, 1, 1] : FULL); break; }
    case SHAPE.STAIRS: {
      const f = (m >> 4) & 3, up = (m >> 6) & 1;
      out.push(up ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]);
      out.push(rot([0, up ? 0 : 0.5, 0.5, 1, up ? 0.5 : 1, 1], f));
      break;
    }
    case SHAPE.FENCE: out.push([0.375, 0, 0.375, 0.625, 1.5, 0.625], [0, 0, 0, 1, 1.5, 1]); out.shift(); break;
    case SHAPE.PANE: out.push([0, 0, 0, 1, 1, 1]); break;
    case SHAPE.DOOR: {
      const f = (m >> 3) & 3, open = (m >> 5) & 1;
      out.push(rot([0, 0, 0, 1, 1, 3 * P], (f + open) & 3));
      break;
    }
    case SHAPE.TRAPDOOR: {
      const f = (m >> 3) & 3, open = (m >> 5) & 1, top = (m >> 6) & 1;
      out.push(open ? rot([0, 0, 13 * P, 1, 1, 1], f) : top ? [0, 13 * P, 0, 1, 1, 1] : [0, 0, 0, 1, 3 * P, 1]);
      break;
    }
    case SHAPE.SNOW: { const l = m & 7; if (l > 0) out.push([0, 0, 0, 1, l * 2 * P, 1]); break; }
    case SHAPE.CARPET: out.push([0, 0, 0, 1, P, 1]); break;
    case SHAPE.FARMLAND: out.push([0, 0, 0, 1, 15 * P, 1]); break;
    case SHAPE.CACTUS: out.push([P, 0, P, 15 * P, 1, 15 * P]); break;
    case SHAPE.CHEST: out.push([P, 0, P, 15 * P, 14 * P, 15 * P]); break;
    case SHAPE.BED: out.push([0, 0, 0, 1, 9 * P, 1]); break;
    case SHAPE.LANTERN: { const h = (m >> 1) & 1; out.push(h ? [5 * P, 7 * P, 5 * P, 11 * P, 16 * P, 11 * P] : [5 * P, 0, 5 * P, 11 * P, 9 * P, 11 * P]); break; }
    case SHAPE.ENDFRAME: out.push([0, 0, 0, 1, 13 * P, 1]); break;
    case SHAPE.FLAT: out.push([0, 0, 0, 1, 1.5 * P, 1]); break;
    case SHAPE.CAMPFIRE: out.push([0, 0, 0, 1, 7 * P, 1]); break;
    case SHAPE.SKULL: out.push([4 * P, 0, 4 * P, 12 * P, 8 * P, 12 * P]); break;
    case SHAPE.CROSS: if (id === B.COBWEB) break; out.push([2 * P, 0, 2 * P, 14 * P, 14 * P, 14 * P]); break;
    case SHAPE.CROP: break;
    default: out.push(FULL);
  }
  return out;
}

export function selectionBoxes(id, m, out = []) {
  out.length = 0;
  const shape = SHAPE_OF[id];
  switch (shape) {
    case SHAPE.NONE: case SHAPE.LIQUID: case SHAPE.FIRE: case SHAPE.PORTAL: case SHAPE.END_PORTAL: return out;
    case SHAPE.CROSS: out.push([2 * P, 0, 2 * P, 14 * P, 13 * P, 14 * P]); return out;
    case SHAPE.CROP: out.push([0, 0, 0, 1, 4 * P, 1]); return out;
    case SHAPE.TORCH: {
      const a = (m >> 1) & 7;
      out.push(a ? rot([5.5 * P, 3 * P, 11 * P, 10.5 * P, 13 * P, 1], a - 1) : [6 * P, 0, 6 * P, 10 * P, 10 * P, 10 * P]);
      return out;
    }
    case SHAPE.LADDER: case SHAPE.VINE: out.push(rot([0, 0, 13 * P, 1, 1, 1], m & 3)); return out;
    case SHAPE.RAIL: out.push([0, 0, 0, 1, 2 * P, 1]); return out;
    case SHAPE.ROD: out.push([6 * P, 0, 6 * P, 10 * P, 1, 10 * P]); return out;
    case SHAPE.FENCE: out.push([6 * P, 0, 6 * P, 10 * P, 1, 10 * P]); return out;
    case SHAPE.PANE: out.push([7 * P, 0, 7 * P, 9 * P, 1, 9 * P]); return out;
    default: {
      const saved = SOLID[id];
      if (!saved) { out.push(FULL); return out; }
      collisionBoxes(id, m, out);
      if (!out.length) out.push(FULL);
      return out;
    }
  }
}
