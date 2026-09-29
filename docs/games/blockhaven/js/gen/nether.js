import { B, CHUNK } from '../data/blocks.js';
import { ChunkBuilder, CI } from './chunk.js';
import { BI } from './biomes.js';
export function createNether(seed) {
  return {
    generateChunk(cx, cz) { const w = new ChunkBuilder(cx, cz); for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) { for (let y = 0; y < 40; y++) w.ids[CI(x, y, z)] = y === 0 ? B.BEDROCK : B.NETHERRACK; w.biomes[x + z * 16] = BI.NETHER_WASTES; w.heights[x + z * 16] = 39; } return w; },
    findSpawn: () => ({ x: 0.5, y: 41, z: 0.5 }), biomeAt: () => BI.NETHER_WASTES,
  };
}
