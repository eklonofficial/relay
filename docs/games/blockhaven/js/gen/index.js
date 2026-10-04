// Picks the generator for a dimension and runs structure placement after terrain.
import { DIM } from '../data/blocks.js?v=mutb2tbl';
import { columnTops } from './chunk.js?v=mutb2tbl';
import { createOverworld } from './overworld.js?v=mutb2tbl';
import { createNether } from './nether.js?v=mutb2tbl';
import { createEnd } from './end.js?v=mutb2tbl';
import { createStructures } from './structures.js?v=mutb2tbl';

export function createGenerator(seed, dim = DIM.OVERWORLD, type = 'default') {
  const terrain = dim === DIM.NETHER ? createNether(seed) : dim === DIM.END ? createEnd(seed) : createOverworld(seed, type);
  const structures = createStructures(seed, dim, terrain);
  return {
    terrain, structures, dim,
    generateChunk(cx, cz) {
      const w = terrain.generateChunk(cx, cz);
      if (structures.place(w) && dim !== DIM.NETHER) columnTops(w.ids, w.heights);
      return w;
    },
    findSpawn: () => terrain.findSpawn(),
    biomeAt: (x, z) => terrain.biomeAt(x, z),
    locate: (kind, x, z) => structures.locate(kind, x, z),
  };
}
