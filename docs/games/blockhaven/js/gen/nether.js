// Nether generator: a 128-high cavern world over a lava sea, with five biomes (nether wastes,
// crimson and warped forests, soul sand valleys and basalt deltas), glowstone clusters hanging
// from the ceiling, quartz/gold ore, ancient debris and huge fungi.
import { Simplex, hash2, hash3, mulberry32 } from '../core/noise.js?v=mut7vbyz';
import { B, st, CHUNK } from '../data/blocks.js?v=mut7vbyz';
import { ChunkBuilder, CI } from './chunk.js?v=mut7vbyz';
import { BI } from './biomes.js?v=mut7vbyz';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export const NETHER_TOP = 128;
export const NETHER_LAVA = 31;
const GX = 4, GY = 8, NY = NETHER_TOP / GY + 1;
const S = k => st(k);

export function createNether(seed) {
  seed |= 0;
  const N = k => new Simplex((seed ^ k) >>> 0);
  const nD = N(0x1001), nD2 = N(0x1002), nBa = N(0x1003), nBb = N(0x1004), nPatch = N(0x1005), nDelta = N(0x1006);

  const [NYL, CRIMSON_NYL_M] = S('crimson_nylium'), WARPED_NYL_M = S('warped_nylium')[1];
  const SOUL_SAND = S('soul_sand'), SOUL_SOIL = S('soul_soil');
  const BASALT = S('basalt'), BLACKSTONE = S('blackstone'), MAGMA = S('magma_block'), BONE = S('bone_block');
  const QUARTZ = S('nether_quartz_ore'), GOLD = S('nether_gold_ore'), DEBRIS = S('ancient_debris');
  const WART = S('nether_wart_block'), WWART = S('warped_wart_block'), SHROOM = S('shroomlight');
  const CSTEM = S('crimson_stem'), WSTEM = S('warped_stem');
  const CROOTS = S('crimson_roots'), WROOTS = S('warped_roots'), CFUNGUS = S('crimson_fungus'), WFUNGUS = S('warped_fungus'), SPROUTS = S('nether_sprouts');
  const RED_MUSH = S('red_mushroom'), BROWN_MUSH = S('brown_mushroom');
  const SOUL_FIRE = S('soul_fire'), FIRE = S('fire'), GRAVEL = [B.GRAVEL, 0];

  function biomeAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const a = nBa.fbm2(x / 260, z / 260, 3), b = nBb.fbm2(x / 260 + 91, z / 260 - 37, 3);
    if (a > 0.22) return b > 0 ? BI.CRIMSON_FOREST : BI.WARPED_FOREST;
    if (a < -0.25) return b > 0.05 ? BI.SOUL_SAND_VALLEY : BI.BASALT_DELTAS;
    return BI.NETHER_WASTES;
  }
  const biomeOffset = b => (b === BI.SOUL_SAND_VALLEY ? -0.12 : b === BI.CRIMSON_FOREST || b === BI.WARPED_FOREST ? -0.06 : b === BI.BASALT_DELTAS ? 0.02 : 0);

  const cache = new Map();
  function gridColumn(gx, gz) {
    const key = gx * 65537 + gz;
    let s = cache.get(key);
    if (s) return s;
    const x = gx * GX, z = gz * GX, off = biomeOffset(biomeAt(x, z));
    s = new Float32Array(NY);
    for (let gy = 0; gy < NY; gy++) {
      const y = gy * GY;
      let d = nD.fbm3(x / 100, y / 42, z / 100, 3) * 1.1 + nD2.noise3(x / 34, y / 22, z / 34) * 0.3 - 0.1 + off;
      d += smooth(100, 126, y) * 1.8;       // ceiling
      d += smooth(24, 2, y) * 1.4;          // floor under the lava sea
      d -= smooth(40, 60, y) * smooth(96, 76, y) * 0.12; // open up the middle band
      s[gy] = d;
    }
    if (cache.size > 20000) cache.clear();
    cache.set(key, s);
    return s;
  }
  function densityAt(x, y, z) {
    const gx = Math.floor(x / GX), gz = Math.floor(z / GX), gy = Math.min(NY - 2, Math.floor(y / GY));
    const fx = (x - gx * GX) / GX, fz = (z - gz * GX) / GX, fy = (y - gy * GY) / GY;
    const a = gridColumn(gx, gz), b = gridColumn(gx + 1, gz), c = gridColumn(gx, gz + 1), d = gridColumn(gx + 1, gz + 1);
    const v = s => s[gy] + (s[gy + 1] - s[gy]) * fy;
    return lerp(lerp(v(a), v(b), fx), lerp(v(c), v(d), fx), fz);
  }
  const solidAt = (x, y, z) => y <= 0 || y >= NETHER_TOP - 1 || densityAt(x, y, z) > 0;

  // First walkable floor at or below `from` (air above solid, above the lava sea).
  function floorY(x, z, from = 100, to = NETHER_LAVA + 1) {
    for (let y = from; y > to; y--) if (!solidAt(x, y, z) && !solidAt(x, y + 1, z) && solidAt(x, y - 1, z)) return y;
    return -1;
  }

  function generateChunk(cx, cz) {
    const w = new ChunkBuilder(cx, cz);
    const r = mulberry32((seed ^ Math.imul(cx, 0x51ed27) ^ Math.imul(cz, 0x2c1b3c6d)) >>> 0);
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const colBiome = new Uint8Array(256);
    // Terrain.
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = ox + x, wz = oz + z, bio = biomeAt(wx, wz);
      colBiome[x + z * 16] = bio;
      w.biomes[x + z * 16] = bio;
      w.heights[x + z * 16] = NETHER_TOP - 1;
      const base = bio === BI.BASALT_DELTAS ? B.BASALT : B.NETHERRACK;
      const baseM = bio === BI.BASALT_DELTAS ? BLACKSTONE[1] : 0;
      for (let y = 0; y < NETHER_TOP; y++) {
        const i = CI(x, y, z);
        if (y === 0 || y === NETHER_TOP - 1 || (y < 5 && hash3(wx, y, wz, seed) < (5 - y) / 5) || (y > NETHER_TOP - 6 && hash3(wx, y, wz, seed ^ 7) < (y - (NETHER_TOP - 6)) / 5)) { w.ids[i] = B.BEDROCK; continue; }
        if (densityAt(wx, y, wz) > 0) { w.ids[i] = base; w.meta[i] = baseM; }
        else if (y <= NETHER_LAVA) w.ids[i] = B.LAVA;
      }
    }
    // Surfaces.
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = ox + x, wz = oz + z, bio = colBiome[x + z * 16];
      const patch = nPatch.noise2(wx / 14, wz / 14);
      for (let y = NETHER_TOP - 6; y > 1; y--) {
        const i = CI(x, y, z), id = w.ids[i];
        if (id === B.AIR || id === B.LAVA || id === B.BEDROCK) continue;
        const above = w.ids[CI(x, y + 1, z)];
        if (above !== B.AIR && above !== B.LAVA) continue;
        if (above === B.LAVA) { if (hash3(wx, y, wz, seed ^ 0x33) < 0.12) { w.ids[i] = MAGMA[0]; w.meta[i] = MAGMA[1]; } continue; }
        // A floor block with air above.
        const set = (yy, s) => { const k = CI(x, yy, z); if (w.ids[k] !== B.AIR && w.ids[k] !== B.BEDROCK && w.ids[k] !== B.LAVA) { w.ids[k] = s[0]; w.meta[k] = s[1]; } };
        if (bio === BI.CRIMSON_FOREST) { w.ids[i] = NYL; w.meta[i] = CRIMSON_NYL_M; }
        else if (bio === BI.WARPED_FOREST) { w.ids[i] = NYL; w.meta[i] = WARPED_NYL_M; }
        else if (bio === BI.SOUL_SAND_VALLEY) { const s = patch > 0 ? SOUL_SAND : SOUL_SOIL; set(y, s); set(y - 1, SOUL_SOIL); set(y - 2, SOUL_SOIL); }
        else if (bio === BI.BASALT_DELTAS) { set(y, patch > 0.2 ? BLACKSTONE : BASALT); }
        else if (y >= NETHER_LAVA - 1 && y <= NETHER_LAVA + 4) { if (patch > 0.35) { set(y, SOUL_SAND); set(y - 1, SOUL_SAND); } else if (patch < -0.4) { set(y, GRAVEL); set(y - 1, GRAVEL); } }
        // Decoration on top.
        if (y + 1 >= NETHER_TOP - 6) continue;
        const h = hash3(wx, y, wz, seed ^ 0x77);
        const top = CI(x, y + 1, z);
        if (bio === BI.CRIMSON_FOREST) { if (h < 0.1) { w.ids[top] = CROOTS[0]; w.meta[top] = CROOTS[1]; } else if (h < 0.125) { w.ids[top] = CFUNGUS[0]; w.meta[top] = CFUNGUS[1]; } }
        else if (bio === BI.WARPED_FOREST) { if (h < 0.1) { w.ids[top] = WROOTS[0]; w.meta[top] = WROOTS[1]; } else if (h < 0.18) { w.ids[top] = SPROUTS[0]; w.meta[top] = SPROUTS[1]; } else if (h < 0.2) { w.ids[top] = WFUNGUS[0]; w.meta[top] = WFUNGUS[1]; } }
        else if (bio === BI.SOUL_SAND_VALLEY) { if (h < 0.006 && w.ids[i] === B.SOUL_SAND) { w.ids[top] = SOUL_FIRE[0]; w.meta[top] = SOUL_FIRE[1]; } }
        else if (bio === BI.NETHER_WASTES) { if (h < 0.004 && w.ids[i] === B.NETHERRACK) { w.ids[top] = FIRE[0]; w.meta[top] = FIRE[1]; } else if (h < 0.01 && w.ids[i] === B.NETHERRACK) { const m = h < 0.007 ? RED_MUSH : BROWN_MUSH; w.ids[top] = m[0]; w.meta[top] = m[1]; } }
      }
    }
    // Basalt deltas: lava pools in the floor and basalt spikes.
    for (let k = 0; k < 10; k++) {
      const x = Math.floor(r() * 16), z = Math.floor(r() * 16), rr = r();
      if (colBiome[x + z * 16] !== BI.BASALT_DELTAS) continue;
      const y = topFloor(w, x, z, 100);
      if (y < 0) continue;
      if (rr < 0.55) { // pool
        const rad = 1 + Math.floor(r() * 3);
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dz * dz > rad * rad + 1) continue;
          const px = x + dx, pz = z + dz;
          if (px < 1 || px > 14 || pz < 1 || pz > 14) continue;
          if (w.ids[CI(px, y - 1, pz)] === B.AIR || w.ids[CI(px, y, pz)] !== B.AIR) continue;
          const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => w.ids[CI(px + a, y - 1, pz + b)] !== B.AIR);
          if (!ok) continue;
          w.ids[CI(px, y - 1, pz)] = B.LAVA; w.meta[CI(px, y - 1, pz)] = 0;
          w.ids[CI(px, y - 2, pz)] = MAGMA[0]; w.meta[CI(px, y - 2, pz)] = MAGMA[1];
        }
      } else { // column
        const hgt = 2 + Math.floor(r() * 7), rad = r() < 0.3 ? 1 : 0;
        for (let yy = y; yy < y + hgt; yy++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          const px = x + dx, pz = z + dz;
          if (px < 0 || px > 15 || pz < 0 || pz > 15 || yy >= NETHER_TOP - 6) continue;
          if (rad && Math.abs(dx) + Math.abs(dz) === 2 && yy > y + hgt / 2) continue;
          if (w.ids[CI(px, yy, pz)] === B.AIR) { w.ids[CI(px, yy, pz)] = BASALT[0]; w.meta[CI(px, yy, pz)] = BASALT[1]; }
        }
      }
    }
    // Soul sand valleys: basalt pillars and fossils.
    for (let k = 0; k < 2; k++) {
      const x = 3 + Math.floor(r() * 10), z = 3 + Math.floor(r() * 10), rr = r();
      if (colBiome[x + z * 16] !== BI.SOUL_SAND_VALLEY) continue;
      const y = topFloor(w, x, z, 100);
      if (y < 0) continue;
      if (rr < 0.5) { // fossil: a small ribcage arc
        const len = 3 + Math.floor(r() * 4), ax = r() < 0.5;
        for (let t = 0; t < len; t++) {
          for (let a = 0; a <= 4; a++) {
            const px = ax ? x + t - 2 : x + (a - 2), pz = ax ? z + (a - 2) : z + t - 2, py = y + (a === 0 || a === 4 ? 0 : a === 2 ? 3 : 2);
            if (px < 0 || px > 15 || pz < 0 || pz > 15) continue;
            if (t % 2 === 0 || a === 2) { w.ids[CI(px, py, pz)] = BONE[0]; w.meta[CI(px, py, pz)] = BONE[1]; }
          }
        }
      } else {
        for (let yy = y; yy < NETHER_TOP - 6; yy++) { const k2 = CI(x, yy, z); if (w.ids[k2] !== B.AIR) break; w.ids[k2] = BASALT[0]; w.meta[k2] = S('polished_basalt')[1]; }
      }
    }
    // Huge fungi in the forests.
    for (let k = 0; k < 8; k++) {
      const x = 2 + Math.floor(r() * 12), z = 2 + Math.floor(r() * 12), hgt = 5 + Math.floor(r() * 8), big = r() < 0.15;
      const bio = colBiome[x + z * 16];
      if (bio !== BI.CRIMSON_FOREST && bio !== BI.WARPED_FOREST) continue;
      const y = topFloor(w, x, z, 100);
      if (y < 0 || w.ids[CI(x, y - 1, z)] !== B.NYLIUM) continue;
      hugeFungus(w, r, ox + x, y, oz + z, hgt + (big ? 6 : 0), bio === BI.CRIMSON_FOREST);
    }
    // Glowstone clusters under ceilings.
    for (let k = 0; k < 7; k++) {
      const x = 2 + Math.floor(r() * 12), z = 2 + Math.floor(r() * 12);
      let y = -1;
      for (let yy = 40 + Math.floor(r() * 70); yy < NETHER_TOP - 2; yy++) if (w.ids[CI(x, yy, z)] === B.AIR && w.ids[CI(x, yy + 1, z)] === B.NETHERRACK) { y = yy; break; }
      if (y < 0) continue;
      w.ids[CI(x, y, z)] = B.GLOWSTONE;
      for (let n = 0; n < 60; n++) {
        const px = x + Math.floor(r() * 7) - 3, py = y - Math.floor(r() * 6), pz = z + Math.floor(r() * 7) - 3;
        if (px < 0 || px > 15 || pz < 0 || pz > 15 || py < 2) continue;
        if (w.ids[CI(px, py, pz)] !== B.AIR) continue;
        let adj = 0;
        for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const qx = px + a, qy = py + b, qz = pz + c;
          if (qx < 0 || qx > 15 || qz < 0 || qz > 15) continue;
          if (w.ids[CI(qx, qy, qz)] === B.GLOWSTONE) adj++;
        }
        if (adj === 1) w.ids[CI(px, py, pz)] = B.GLOWSTONE;
      }
    }
    // Ores.
    const vein = (s, count, size, y0, y1, host) => {
      for (let v = 0; v < count; v++) {
        let x = Math.floor(r() * 16), y = y0 + Math.floor(r() * (y1 - y0)), z = Math.floor(r() * 16);
        for (let n = 0; n < size; n++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < NETHER_TOP) {
            const i = CI(x, y, z);
            if (w.ids[i] === host && w.meta[i] === 0) { w.ids[i] = s[0]; w.meta[i] = s[1]; }
          }
          x += Math.floor(r() * 3) - 1; y += Math.floor(r() * 3) - 1; z += Math.floor(r() * 3) - 1;
        }
      }
    };
    vein(QUARTZ, 14, 8, 10, 118, B.NETHERRACK);
    vein(GOLD, 9, 6, 10, 118, B.NETHERRACK);
    vein(MAGMA, 3, 10, 26, 37, B.NETHERRACK);
    if (r() < 0.5) vein(DEBRIS, 1, 2, 8, 24, B.NETHERRACK);
    if (r() < 0.25) vein(DEBRIS, 1, 3, 8, 119, B.NETHERRACK);
    vein(BLACKSTONE, 2, 14, 5, 35, B.NETHERRACK);
    vein(SOUL_SOIL, 1, 12, 20, 100, B.NETHERRACK);
    return w;
  }

  function topFloor(w, x, z, from) {
    for (let y = Math.min(from, NETHER_TOP - 7); y > NETHER_LAVA; y--) {
      const id = w.ids[CI(x, y - 1, z)];
      if (w.ids[CI(x, y, z)] === B.AIR && id !== B.AIR && id !== B.LAVA && w.ids[CI(x, y + 1, z)] === B.AIR) return y;
    }
    return -1;
  }

  function hugeFungus(w, r, x, y, z, h, crimson) {
    const stem = crimson ? CSTEM : WSTEM, cap = crimson ? WART : WWART;
    const capR = Math.max(2, Math.min(4, Math.floor(h / 4)));
    const capY0 = y + h - Math.min(h - 2, capR + 2);
    for (let dy = capY0; dy <= y + h; dy++) {
      const t = (dy - capY0) / Math.max(1, y + h - capY0);
      const rad = dy === y + h ? capR - 1 : capR - (t > 0.8 ? 1 : 0);
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        const edge = Math.abs(dx) === rad || Math.abs(dz) === rad || dy === y + h;
        if (Math.abs(dx) === rad && Math.abs(dz) === rad && dy !== y + h) continue;
        if (!edge && dy < y + h - 1) continue; // hollow-ish underside
        const hh = hash3(x + dx, dy, z + dz, seed ^ 0x5151);
        if (hh < 0.08) w.soft(x + dx, dy, z + dz, SHROOM[0], SHROOM[1]);
        else w.soft(x + dx, dy, z + dz, cap[0], cap[1]);
        // Hanging vines of wart under the rim.
        if (crimson && edge && dy === capY0 && hh > 0.8) for (let v = 1; v <= 1 + Math.floor(hh * 10) % 3; v++) w.soft(x + dx, dy - v, z + dz, cap[0], cap[1]);
      }
    }
    for (let dy = 0; dy < h; dy++) w.set(x, y + dy, z, stem[0], stem[1]);
    if (h > 12) for (const [a, b] of [[1, 0], [0, 1], [1, 1]]) for (let dy = 0; dy < h - 3; dy++) w.set(x + a, y + dy, z + b, stem[0], stem[1]);
  }

  function findSpawn() {
    for (let rad = 0; rad < 200; rad += 4) for (let a = 0; a < 12; a++) {
      const x = Math.round(Math.cos(a / 12 * Math.PI * 2) * rad), z = Math.round(Math.sin(a / 12 * Math.PI * 2) * rad);
      const y = floorY(x, z, 90, NETHER_LAVA + 3);
      if (y > 0) return { x: x + 0.5, y, z: z + 0.5 };
    }
    return { x: 0.5, y: 70, z: 0.5 };
  }

  return { seed, generateChunk, findSpawn, biomeAt, densityAt, floorY, solidAt, hugeFungus };
}
