// Picks the generator for a dimension and runs structure placement after terrain.
import { DIM, CHUNK, HEIGHT, B } from '../data/blocks.js?v=murm7eyf';
import { CI } from './chunk.js?v=murm7eyf';
import { createOverworld } from './overworld.js?v=murm7eyf';
import { createNether } from './nether.js?v=murm7eyf';
import { createEnd } from './end.js?v=murm7eyf';
import { createStructures } from './structures.js?v=murm7eyf';

export function createGenerator(seed, dim = DIM.OVERWORLD, type = 'default') {
  const terrain = dim === DIM.NETHER ? createNether(seed) : dim === DIM.END ? createEnd(seed) : createOverworld(seed, type);
  const structures = createStructures(seed, dim, terrain);
  return {
    terrain, structures, dim,
    generateChunk(cx, cz) {
      const w = terrain.generateChunk(cx, cz);
      if (structures.place(w) && dim !== DIM.NETHER) {
        for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
          let y = HEIGHT - 1;
          while (y > 0 && w.ids[CI(x, y, z)] === B.AIR) y--;
          w.heights[x + z * CHUNK] = y;
        }
      }
      return w;
    },
    findSpawn: () => terrain.findSpawn(),
    biomeAt: (x, z) => terrain.biomeAt(x, z),
    locate: (kind, x, z) => structures.locate(kind, x, z),
  };
}
