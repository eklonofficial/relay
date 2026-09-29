import { CHUNK, HEIGHT, SEA, B } from './blocks.js';
import { Simplex, hash2, hash3, mulberry32 } from './noise.js';

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, SNOWY: 5, MOUNTAINS: 6 };
export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Snowy Tundra', 'Mountains'];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createGenerator(seed) {
  seed |= 0;
  const nCont = new Simplex(seed ^ 0x1a2b3c), nHill = new Simplex(seed ^ 0x2b3c4d), nMtn = new Simplex(seed ^ 0x3c4d5e);
  const nRidge = new Simplex(seed ^ 0x4d5e6f), nTemp = new Simplex(seed ^ 0x5e6f70), nHum = new Simplex(seed ^ 0x6f7081);
  const nCaveA = new Simplex(seed ^ 0x708192), nCaveB = new Simplex(seed ^ 0x8192a3), nCheese = new Simplex(seed ^ 0x92a3b4);
  const nFloor = new Simplex(seed ^ 0xa3b4c5);

  function column(x, z) {
    const cont = nCont.fbm2(x * 0.0011, z * 0.0011, 4);
    const hills = nHill.fbm2(x * 0.009, z * 0.009, 4);
    const mtn = smooth(0.12, 0.5, nMtn.fbm2(x * 0.0024, z * 0.0024, 3));
    const r = 1 - Math.abs(nRidge.fbm2(x * 0.0055, z * 0.0055, 3));
    let h = SEA + 3 + cont * 26 + hills * (4 + Math.max(0, cont) * 10) + mtn * (r * r * 48 + 6);
    h = Math.max(6, Math.min(HEIGHT - 12, Math.floor(h)));
    const temp = nTemp.fbm2(x * 0.0016, z * 0.0016, 2) - Math.max(0, h - SEA - 20) * 0.012;
    const hum = nHum.fbm2(x * 0.0016 + 40, z * 0.0016, 2);
    let biome;
    if (h < SEA - 1) biome = BIOME.OCEAN;
    else if (temp < -0.25) biome = BIOME.SNOWY;
    else if (h <= SEA + 1) biome = BIOME.BEACH;
    else if (h > SEA + 34) biome = BIOME.MOUNTAINS;
    else if (temp > 0.28 && hum < 0.1) biome = BIOME.DESERT;
    else if (hum > 0.12) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;
    return { h, biome };
  }

  function caveAt(x, y, z, h) {
    if (y < 1) return false;
    if (h <= SEA + 3 && y > SEA - 12) return false; // keep sea floors sealed
    const s = 0.045;
    const a = nCaveA.noise3(x * s, y * s * 1.4, z * s);
    if (a > -0.075 && a < 0.075) {
      const b = nCaveB.noise3(x * s, y * s * 1.4, z * s);
      if (b > -0.075 && b < 0.075) return true;
    }
    if (y > 6 && y < h - 6 && nCheese.noise3(x * 0.022, y * 0.04, z * 0.022) > 0.6) return true;
    return false;
  }

  function generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const idx = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const heights = new Int16Array(CHUNK * CHUNK);
    const biomes = new Uint8Array(CHUNK * CHUNK);

    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const wx = ox + x, wz = oz + z;
        const { h, biome } = column(wx, wz);
        heights[x + z * CHUNK] = h;
        biomes[x + z * CHUNK] = biome;
        const soil = 3 + Math.floor(hash2(wx, wz, seed) * 2);
        const floorGravel = nFloor.noise2(wx * 0.05, wz * 0.05) > 0.25;

        for (let y = 0; y <= h; y++) {
          let id = B.STONE;
          const depth = h - y;
          if (y === 0 || (y <= 3 && hash3(wx, y, wz, seed) < 0.6 - y * 0.18)) id = B.BEDROCK;
          else if (biome === BIOME.DESERT) { if (depth < 4) id = B.SAND; else if (depth < 8) id = B.SANDSTONE; }
          else if (biome === BIOME.BEACH) { if (depth < 4) id = B.SAND; }
          else if (biome === BIOME.OCEAN) { if (depth < 3) id = floorGravel ? B.GRAVEL : B.SAND; }
          else if (biome === BIOME.SNOWY) { if (depth === 0) id = B.SNOWY_GRASS; else if (depth < soil) id = B.DIRT; }
          else if (biome === BIOME.MOUNTAINS) {
            if (h > SEA + 54) { if (depth === 0) id = B.SNOW; }
            else if (h < SEA + 44) { if (depth === 0) id = B.GRASS; else if (depth < soil) id = B.DIRT; }
          } else if (depth === 0) id = B.GRASS;
          else if (depth < soil) id = B.DIRT;
          blocks[idx(x, y, z)] = id;
        }
        for (let y = h + 1; y <= SEA; y++) {
          blocks[idx(x, y, z)] = biome === BIOME.SNOWY && y === SEA ? B.ICE : B.WATER;
        }
        for (let y = 1; y <= h; y++) {
          const i = idx(x, y, z);
          if (blocks[i] === B.BEDROCK) continue;
          if (caveAt(wx, y, wz, h)) blocks[i] = y <= 10 ? B.LAVA : B.AIR;
        }
      }
    }

    // Ore veins: random walks through stone.
    const rand = mulberry32(Math.floor(hash2(cx, cz, seed ^ 0x0e0e) * 4294967296));
    const veins = [[B.COAL_ORE, 18, 9, 5, 110], [B.IRON_ORE, 12, 6, 5, 64], [B.GOLD_ORE, 3, 5, 5, 32], [B.DIAMOND_ORE, 2, 4, 3, 16]];
    for (const [ore, count, size, minY, maxY] of veins) {
      for (let v = 0; v < count; v++) {
        let x = Math.floor(rand() * CHUNK), y = minY + Math.floor(rand() * (maxY - minY)), z = Math.floor(rand() * CHUNK);
        for (let k = 0; k < size; k++) {
          if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 0 && y < HEIGHT) {
            const i = idx(x, y, z);
            if (blocks[i] === B.STONE) blocks[i] = ore;
          }
          const d = Math.floor(rand() * 6);
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) z++; else z--;
        }
      }
    }

    // Ground plants on the chunk's own columns.
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const h = heights[x + z * CHUNK], biome = biomes[x + z * CHUNK];
        if (h + 1 >= HEIGHT) continue;
        const ground = blocks[idx(x, h, z)], above = blocks[idx(x, h + 1, z)];
        if (above !== B.AIR) continue;
        const r = hash2(ox + x, oz + z, seed ^ 0x5555);
        let plant = 0;
        if (ground === B.GRASS) {
          if (biome === BIOME.FOREST) plant = r < 0.14 ? B.TALL_GRASS : r < 0.152 ? B.POPPY : r < 0.16 ? B.DANDELION : 0;
          else if (biome === BIOME.MOUNTAINS) plant = r < 0.05 ? B.TALL_GRASS : 0;
          else plant = r < 0.1 ? B.TALL_GRASS : r < 0.112 ? B.DANDELION : r < 0.122 ? B.POPPY : r < 0.127 ? B.BLUE_ORCHID : r < 0.1285 ? B.PUMPKIN : 0;
        } else if (ground === B.SAND && biome === BIOME.DESERT && r < 0.012) plant = B.DEAD_BUSH;
        if (plant) blocks[idx(x, h + 1, z)] = plant;
      }
    }

    // Trees, including ones rooted in neighbouring chunks whose leaves reach into this one.
    const set = (wx, y, wz, id, onlyAir) => {
      const x = wx - ox, z = wz - oz;
      if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || y < 0 || y >= HEIGHT) return;
      const i = idx(x, y, z);
      if (blocks[i] === B.BEDROCK) return;
      if (onlyAir && blocks[i] !== B.AIR && blocks[i] !== B.TALL_GRASS) return;
      blocks[i] = id;
    };
    const blob = (wx, y, wz, r, id, trim) => {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (trim && Math.abs(dx) === r && Math.abs(dz) === r && hash3(wx + dx, y, wz + dz, seed) < 0.6) continue;
          set(wx + dx, y, wz + dz, id, true);
        }
      }
    };

    for (let wz = oz - 3; wz < oz + CHUNK + 3; wz++) {
      for (let wx = ox - 3; wx < ox + CHUNK + 3; wx++) {
        const r = hash2(wx, wz, seed ^ 0x7777);
        if (r >= 0.035) continue;
        const { h, biome } = column(wx, wz);
        if (h <= SEA + 1 || h + 12 >= HEIGHT) continue;
        let chance = 0;
        if (biome === BIOME.FOREST) chance = 0.035;
        else if (biome === BIOME.PLAINS) chance = 0.0035;
        else if (biome === BIOME.SNOWY) chance = 0.012;
        else if (biome === BIOME.MOUNTAINS && h < SEA + 50) chance = 0.006;
        else if (biome === BIOME.DESERT) chance = 0.006;
        if (r >= chance || caveAt(wx, h, wz, h)) continue;

        const r2 = hash2(wx, wz, seed ^ 0x9999);
        const y0 = h + 1;
        if (biome === BIOME.DESERT) {
          const ht = 1 + Math.floor(r2 * 3);
          for (let y = y0; y < y0 + ht; y++) set(wx, y, wz, B.CACTUS, false);
          continue;
        }
        if (biome === BIOME.SNOWY || biome === BIOME.MOUNTAINS) {
          const th = 6 + Math.floor(r2 * 4), top = y0 + th - 1;
          set(wx, top + 1, wz, B.SPRUCE_LEAVES, true);
          set(wx, top + 2, wz, B.SPRUCE_LEAVES, true);
          let rad = 1;
          for (let y = top; y >= y0 + 2; y--) {
            blob(wx, y, wz, rad, B.SPRUCE_LEAVES, rad === 2);
            rad = rad === 1 ? 2 : 1;
          }
          for (let y = y0; y <= top; y++) set(wx, y, wz, B.SPRUCE_LOG, false);
          continue;
        }
        const birch = biome === BIOME.FOREST && r2 > 0.7;
        const th = (birch ? 5 : 4) + Math.floor(r2 * 3), top = y0 + th - 1;
        const leaves = birch ? B.BIRCH_LEAVES : B.OAK_LEAVES;
        blob(wx, top - 1, wz, 2, leaves, true);
        blob(wx, top, wz, 2, leaves, true);
        blob(wx, top + 1, wz, 1, leaves, true);
        set(wx, top + 2, wz, leaves, true);
        set(wx + 1, top + 2, wz, leaves, true);
        set(wx - 1, top + 2, wz, leaves, true);
        set(wx, top + 2, wz + 1, leaves, true);
        set(wx, top + 2, wz - 1, leaves, true);
        for (let y = y0; y <= top; y++) set(wx, y, wz, birch ? B.BIRCH_LOG : B.OAK_LOG, false);
      }
    }

    return blocks;
  }

  function findSpawn() {
    for (let r = 0; r < 400; r += 4) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        const { h, biome } = column(x, z);
        if ((biome === BIOME.PLAINS || biome === BIOME.FOREST) && h > SEA + 2 && !caveAt(x, h, z, h)) return { x: x + 0.5, y: h + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: column(0, 0).h + 2, z: 0.5 };
  }

  return { column, generateChunk, findSpawn };
}
