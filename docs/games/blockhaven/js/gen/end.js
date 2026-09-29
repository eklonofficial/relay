import { B, CHUNK } from '../data/blocks.js';
import { ChunkBuilder, CI } from './chunk.js';
import { BI } from './biomes.js';
export function createEnd(seed) {
  return {
    generateChunk(cx, cz) { const w = new ChunkBuilder(cx, cz); for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) { w.biomes[x + z * 16] = BI.THE_END; if (Math.hypot(cx * 16 + x, cz * 16 + z) < 60) for (let y = 40; y < 60; y++) w.ids[CI(x, y, z)] = B.END_STONE; } return w; },
    findSpawn: () => ({ x: 0.5, y: 61, z: 0.5 }), biomeAt: () => BI.THE_END,
  };
}
