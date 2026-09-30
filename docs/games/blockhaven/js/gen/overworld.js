// Overworld generator: climate-driven biomes, 3D density terrain, noise + worm caves, underground
// biomes, ores, surface rules, trees and vegetation. World types: 'default', 'wild' (amplified,
// floating islands, stone pillars and arches) and 'flat'.
import { Simplex, hash2, hash3, mulberry32 } from '../core/noise.js?v=munf5yfg';
import { B, st, CHUNK, HEIGHT, SEA, COLORS } from '../data/blocks.js?v=munf5yfg';
import { BI, OCEANS, COLD } from './biomes.js?v=munf5yfg';
import { ChunkBuilder, CI } from './chunk.js?v=munf5yfg';
import * as T from './trees.js?v=munf5yfg';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

const S_ = key => st(key);
const [STONE, STONE_M] = [B.STONE, 0];
const DEEPSLATE_M = S_('deepslate')[1], TUFF_M = S_('tuff')[1], CALCITE_M = S_('calcite')[1], DRIPSTONE_M = S_('dripstone_block')[1];
const GRANITE_M = S_('granite')[1], DIORITE_M = S_('diorite')[1], ANDESITE_M = S_('andesite')[1];
const SNOWY_GRASS_M = S_('grass_block_snowy')[1];
const DIRT = B.DIRT, COARSE_M = S_('coarse_dirt')[1], PODZOL_M = S_('podzol')[1], MUD_M = S_('mud')[1], CLAY_M = S_('clay')[1], MYCELIUM_M = S_('mycelium')[1];
const RED_SAND_M = S_('red_sand')[1];
const SANDSTONE_M = 0, RED_SANDSTONE_M = S_('red_sandstone')[1];
const FLOWER = k => S_(k)[1];
const PLANT = k => S_(k)[1];
const ORE = k => S_(k)[1];
const COLOR_INDEX = c => COLORS.indexOf(c);

export function createOverworld(seed, type = 'default') {
  seed |= 0;
  const wild = type === 'wild', flat = type === 'flat';
  const N = k => new Simplex((seed ^ k) >>> 0);
  const nWarpX = N(0x1111), nWarpZ = N(0x2222), nCont = N(0x3333), nEro = N(0x4444), nWeird = N(0x5555);
  const nTemp = N(0x6666), nHum = N(0x7777), nRiver = N(0x8888), nRidge = N(0x9999), nHill = N(0xaaaa), nMush = N(0xbbbb);
  const n3 = N(0xcccc), nCheese = N(0xdddd), nSpagA = N(0xeeee), nSpagB = N(0xf0f0), nNoodA = N(0x1212), nNoodB = N(0x2323);
  const nLush = N(0x3434), nDrip = N(0x4545), nIsl = N(0x5656), nIslY = N(0x6767), nArch = N(0x7878), nPatch = N(0x8989);
  const nHoodoo = N(0x9a9a), nBand = N(0xabab);

  // Badlands terracotta bands.
  const bands = (() => {
    const r = mulberry32(seed ^ 0xbadd), out = [];
    const pal = [[B.TERRACOTTA, 0], [B.TERRACOTTA_COLORED, COLOR_INDEX('orange')], [B.TERRACOTTA_COLORED, COLOR_INDEX('yellow')], [B.TERRACOTTA_COLORED, COLOR_INDEX('brown')],
      [B.TERRACOTTA_COLORED, COLOR_INDEX('red')], [B.TERRACOTTA_COLORED, COLOR_INDEX('white')], [B.TERRACOTTA_COLORED, COLOR_INDEX('light_gray')], [B.TERRACOTTA, 0], [B.TERRACOTTA_COLORED, COLOR_INDEX('orange')]];
    for (let i = 0; i < 64; i++) { const c = pal[Math.floor(r() * pal.length)]; const len = 1 + Math.floor(r() * 3); for (let k = 0; k < len && out.length < 64; k++) out.push(c); }
    while (out.length < 64) out.push(pal[0]);
    return out;
  })();

  // ---------------- climate and 2D terrain ----------------
  function climate(x, z) {
    const wx = x + nWarpX.fbm2(x / 420, z / 420, 3) * 70, wz = z + nWarpZ.fbm2(x / 420, z / 420, 3) * 70;
    const C = nCont.fbm2(wx / 1600, wz / 1600, 5) * 1.5 + 0.2;
    const E = nEro.fbm2(wx / 1000, wz / 1000, 4) * 1.4;
    const W = nWeird.fbm2(wx / 520, wz / 520, 3) * 1.5;
    const Tm = nTemp.fbm2(x / 1050, z / 1050, 3) * 1.6;
    const Hm = nHum.fbm2(x / 950 + 50, z / 950, 3) * 1.6;
    const R = Math.abs(nRiver.fbm2(wx / 900, wz / 900, 4));
    return { C, E, W, T: Tm, H: Hm, R };
  }

  function terrain2(x, z, cl) {
    const { C, E, W, R } = cl;
    let h;
    if (C < -0.25) h = SEA - 7 - smooth(-0.25, -0.75, C) * 34;
    else if (C < -0.05) h = lerp(SEA - 7, SEA + 1, (C + 0.25) / 0.2);
    else h = SEA + 1 + (C + 0.05) * 28;
    const inland = smooth(-0.12, 0.1, C);
    const mtn = smooth(-0.02, -0.6, E) * inland;
    const ridge = 1 - Math.abs(nRidge.fbm2(x / 440, z / 440, 4) * 1.4);
    const pv = 1 - Math.abs(3 * Math.abs(W) - 2);
    const hills = nHill.fbm2(x / 150, z / 150, 4);
    let peak = mtn * (Math.pow(clamp(ridge, 0, 1), 2.1) * 105 + 10 + Math.max(0, pv) * 28);
    h += hills * (3 + 11 * smooth(0.25, -0.3, E)) * inland;
    if (wild) { peak *= 1.85; h = h > SEA ? SEA + (h - SEA) * 1.7 : h; }
    h += peak;
    // Rivers cut valleys through everything inland.
    const valley = smooth(0.24, 0.07, R) * inland;
    h = lerp(h, Math.min(h, SEA + 5 + (h - SEA) * 0.2), valley * 0.85);
    const riverK = smooth(0.055, 0.018, R) * smooth(-0.22, -0.06, C);
    h = lerp(h, wild ? SEA - 9 : SEA - 5, riverK);
    // Rare mushroom islands far out at sea.
    let mush = 0;
    if (C < -0.45) { const m = nMush.fbm2(x / 260, z / 260, 3); if (m > 0.42) { mush = smooth(0.42, 0.55, m); h = lerp(h, SEA + 3 + (m - 0.42) * 30, mush); } }
    const amp = wild ? 7 + mtn * 42 + Math.abs(hills) * 8 : 1.2 + mtn * 13 + Math.abs(hills) * 2;
    return { h: clamp(h, 6, HEIGHT - 8), amp, mtn, riverK, mush, pv, inland };
  }

  function pickBiome(cl, t) {
    const { C, W, T: Tm, H: Hm } = cl;
    const h = t.h;
    if (t.mush > 0.5) return BI.MUSHROOM_FIELDS;
    if (h < SEA - 1 && C < -0.2) {
      const deep = h < SEA - 22;
      if (Tm < -0.62) return BI.FROZEN_OCEAN;
      if (Tm < -0.18) return BI.COLD_OCEAN;
      if (Tm > 0.5) return BI.WARM_OCEAN;
      return deep ? BI.DEEP_OCEAN : BI.OCEAN;
    }
    if (t.riverK > 0.45) return Tm < -0.62 ? BI.FROZEN_RIVER : BI.RIVER;
    if (h <= SEA + 2 && C < -0.03) {
      if (t.mtn > 0.25) return BI.STONY_SHORE;
      if (Tm < -0.45) return BI.SNOWY_BEACH;
      if (!(Tm > 0.6 && Hm < 0)) return BI.BEACH;
    }
    const rel = h - SEA;
    if (t.mtn > 0.35 && rel > (wild ? 120 : 70)) return Tm < -0.1 ? (W > 0 ? BI.JAGGED_PEAKS : BI.FROZEN_PEAKS) : BI.STONY_PEAKS;
    if (t.mtn > 0.3 && rel > (wild ? 80 : 45)) return Tm < -0.25 ? BI.SNOWY_SLOPES : Tm < 0 ? BI.GROVE : Hm > 0.2 ? BI.CHERRY_GROVE : BI.MEADOW;
    if (t.mtn > 0.35 && rel > 25) return Hm > 0.3 && Tm > 0 ? BI.CHERRY_GROVE : BI.WINDSWEPT_HILLS;
    if (Tm < -0.62) return W > 0.55 ? BI.ICE_SPIKES : Hm > 0.1 ? BI.SNOWY_TAIGA : BI.SNOWY_PLAINS;
    if (Tm < -0.3) return Hm > 0.35 && W > 0 ? BI.OLD_GROWTH_TAIGA : Hm > -0.2 ? BI.TAIGA : BI.PLAINS;
    if (Tm < 0.3) {
      if (Hm > 0.45 && rel < 5) return BI.SWAMP;
      if (Hm < -0.4) return W > 0.4 ? BI.SUNFLOWER_PLAINS : BI.PLAINS;
      if (Hm < -0.05) return W > 0.5 ? BI.FLOWER_FOREST : BI.PLAINS;
      if (Hm < 0.28) return W < -0.35 ? BI.BIRCH_FOREST : W > 0.55 ? BI.FLOWER_FOREST : BI.FOREST;
      return BI.DARK_FOREST;
    }
    if (Tm < 0.62) {
      if (Hm > 0.5 && rel < 5) return BI.MANGROVE_SWAMP;
      if (Hm < -0.25) return BI.SAVANNA;
      if (Hm < 0.25) return W > 0.3 ? BI.BIRCH_FOREST : BI.FOREST;
      return W > 0.45 ? BI.BAMBOO_JUNGLE : BI.JUNGLE;
    }
    if (Hm < 0.05) return BI.DESERT;
    if (Hm < 0.45) return W > 0.35 ? BI.ERODED_BADLANDS : BI.BADLANDS;
    return BI.JUNGLE;
  }

  const climCache = new Map();
  function column(x, z) {
    const key = x * 131071 + z;
    let c = climCache.get(key);
    if (c) return c;
    const cl = climate(x, z), t = terrain2(x, z, cl);
    c = { cl, t, biome: pickBiome(cl, t) };
    if (climCache.size > 60000) climCache.clear();
    climCache.set(key, c);
    return c;
  }

  // ---------------- 3D density ----------------
  const GX = 4, GY = 8, NY = HEIGHT / GY + 1;
  const pillarAt = (px, pz) => {
    const h = hash2(px, pz, seed ^ 0x9111);
    if (h > 0.4) return null;
    return {
      x: px * 64 + 12 + hash2(px, pz, seed ^ 0x9222) * 40, z: pz * 64 + 12 + hash2(px, pz, seed ^ 0x9333) * 40,
      r: 5 + hash2(px, pz, seed ^ 0x9444) * 8, top: SEA + 70 + hash2(px, pz, seed ^ 0x9555) * 110,
    };
  };
  function wildColumn(x, z) {
    const out = { isl: 0, islC: 0, pil: -30, pilTop: 0 };
    const m = nIsl.fbm2(x / 270, z / 270, 3) * 1.4;
    if (m > 0.3) { out.isl = m - 0.3; out.islC = 172 + nIslY.noise2(x / 220, z / 220) * 24; }
    const px = Math.floor(x / 64), pz = Math.floor(z / 64);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const p = pillarAt(px + dx, pz + dz);
      if (!p) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      const v = (p.r - d) * 2.2;
      if (v > out.pil) { out.pil = v; out.pilTop = p.top; }
    }
    return out;
  }

  const sampleCache = new Map();
  function gridColumn(gx, gz) {
    const key = 'c' + gx + ',' + gz;
    let c = sampleCache.get(key);
    if (c) return c;
    const x = gx * GX, z = gz * GX, col = column(x, z);
    const samples = new Float32Array(NY);
    const w = wild ? wildColumn(x, z) : null;
    for (let gy = 0; gy < NY; gy++) {
      const y = gy * GY;
      let d = col.t.h - y;
      const band = col.t.amp * 2 + 12;
      if (d > -band && d < band) d += col.t.amp * n3.fbm3(x / 64, y / 40, z / 64, 2) * 1.4 * (1 - Math.abs(d) / band);
      if (w) {
        if (w.isl > 0) {
          const top = w.isl * 40 - 1.5, bot = w.isl * 130 - 4;
          const di = y >= w.islC ? top - (y - w.islC) : bot - (w.islC - y) * 1.0;
          d = Math.max(d, di + n3.noise3(x / 30, y / 20, z / 30) * 7);
        }
        if (w.pil > -8 && y < w.pilTop + 6) {
          const dp = Math.min(w.pil + n3.noise3(x / 22, y / 30, z / 22) * 5, (w.pilTop - y) * 0.9);
          d = Math.max(d, dp);
        }
        if (y > col.t.h - 10 && y < col.t.h + 80) {
          const a = Math.abs(nArch.noise3(x / 120, y / 80, z / 120));
          if (a < 0.16) {
            const b = Math.abs(nIslY.noise3(x / 120, y / 80, z / 120));
            const fade = Math.min(1, (y - col.t.h + 10) / 15, (col.t.h + 80 - y) / 25);
            if (b < 0.16) d = Math.max(d, (0.16 - Math.max(a, b)) * 120 * fade - 3);
          }
        }
      }
      samples[gy] = d;
    }
    if (sampleCache.size > 20000) sampleCache.clear();
    sampleCache.set(key, samples);
    return samples;
  }

  function densityAt(x, y, z) {
    const gx = Math.floor(x / GX), gz = Math.floor(z / GX), gy = Math.min(NY - 2, Math.floor(y / GY));
    const fx = (x - gx * GX) / GX, fz = (z - gz * GX) / GX, fy = (y - gy * GY) / GY;
    const a = gridColumn(gx, gz), b = gridColumn(gx + 1, gz), c = gridColumn(gx, gz + 1), d = gridColumn(gx + 1, gz + 1);
    const v = (s) => s[gy] + (s[gy + 1] - s[gy]) * fy;
    return lerp(lerp(v(a), v(b), fx), lerp(v(c), v(d), fx), fz);
  }

  function surfaceY(x, z) {
    if (flat) return 3;
    const col = column(x, z);
    let top = wild ? HEIGHT - 2 : Math.min(HEIGHT - 2, Math.ceil(col.t.h + col.t.amp * 1.5 + 6));
    for (let y = top; y > 0; y--) if (densityAt(x, y, z) > 0) return y;
    return 0;
  }

  // ---------------- caves ----------------
  function noiseCave(x, y, z, surf) {
    if (y < 5) return false;
    const depth = surf - y;
    let t = 0.6;
    if (depth < 12) t += (12 - depth) * 0.035;
    if (nCheese.fbm3(x / 95, y / 58, z / 95, 2) > t) return true;
    const a = nSpagA.noise3(x / 60, y / 42, z / 60);
    if (Math.abs(a) < 0.06) {
      const b = nSpagB.noise3(x / 60, y / 42, z / 60);
      if (Math.abs(b) < 0.06 - Math.max(0, 6 - depth) * 0.01) return true;
    }
    if (y < 60 && depth > 8) {
      const c = nNoodA.noise3(x / 30, y / 24, z / 30);
      if (Math.abs(c) < 0.035) { const d = nNoodB.noise3(x / 30, y / 24, z / 30); if (Math.abs(d) < 0.035) return true; }
    }
    return false;
  }

  function wormCarve(w) {
    const R = 8;
    const x0 = w.ox, z0 = w.oz, x1 = x0 + CHUNK, z1 = z0 + CHUNK;
    for (let sz = w.cz - R; sz <= w.cz + R; sz++) for (let sx = w.cx - R; sx <= w.cx + R; sx++) {
      const r = mulberry32((Math.imul(sx, 341873128) ^ Math.imul(sz, 132897987) ^ seed) >>> 0);
      if (r() > 0.14) continue;
      const count = 1 + Math.floor(r() * 3);
      for (let k = 0; k < count; k++) {
        const ravine = r() < 0.07;
        let px = sx * CHUNK + r() * 16, pz = sz * CHUNK + r() * 16, py = ravine ? 22 + r() * 36 : 10 + r() * 80;
        let yaw = r() * Math.PI * 2, pitch = (r() - 0.5) * (ravine ? 0.1 : 0.5);
        const len = ravine ? 70 + r() * 50 : 60 + r() * 110, base = ravine ? 2.2 + r() * 2 : 1.4 + r() * 2.4;
        let dyaw = 0, dpitch = 0;
        for (let s = 0; s < len; s++) {
          const rad = base * (0.6 + Math.sin(s / len * Math.PI) * 0.8);
          const ry = ravine ? rad * 3.2 : rad * 0.8;
          px += Math.cos(yaw) * Math.cos(pitch); pz += Math.sin(yaw) * Math.cos(pitch); py += Math.sin(pitch);
          pitch *= ravine ? 0.7 : 0.92; pitch += dpitch * 0.1; yaw += dyaw * 0.1;
          dpitch = dpitch * 0.9 + (r() - r()) * r() * 2; dyaw = dyaw * 0.75 + (r() - r()) * r() * 4;
          if (px + rad + 1 < x0 || px - rad - 1 > x1 || pz + rad + 1 < z0 || pz - rad - 1 > z1) continue;
          for (let y = Math.max(5, Math.floor(py - ry)); y <= Math.min(HEIGHT - 2, Math.ceil(py + ry)); y++) {
            for (let z = Math.max(z0, Math.floor(pz - rad)); z < Math.min(z1, Math.ceil(pz + rad) + 1); z++) {
              for (let x = Math.max(x0, Math.floor(px - rad)); x < Math.min(x1, Math.ceil(px + rad) + 1); x++) {
                const dx = (x + 0.5 - px) / rad, dy = (y + 0.5 - py) / ry, dz = (z + 0.5 - pz) / rad;
                if (dx * dx + dy * dy + dz * dz >= 1) continue;
                carve(w, x, y, z);
              }
            }
          }
        }
      }
    }
  }

  function carve(w, x, y, z) {
    const i = w.index(x, y, z);
    if (i < 0) return;
    const id = w.ids[i];
    if (id === B.AIR || id === B.WATER || id === B.LAVA || id === B.BEDROCK) return;
    // Never open into water: check the neighbours we can see.
    const lx = x - w.ox, lz = z - w.oz;
    if (w.ids[i + 256] === B.WATER) return;
    if (lx > 0 && w.ids[i - 1] === B.WATER) return;
    if (lx < 15 && w.ids[i + 1] === B.WATER) return;
    if (lz > 0 && w.ids[i - 16] === B.WATER) return;
    if (lz < 15 && w.ids[i + 16] === B.WATER) return;
    if (y <= 10) { w.ids[i] = B.LAVA; w.meta[i] = 0; }
    else { w.ids[i] = B.AIR; w.meta[i] = 0; }
  }

  // ---------------- ores and blobs ----------------
  const ORES = [
    ['coal', 20, 12, 5, 150], ['iron', 12, 8, 2, 80], ['copper', 8, 9, 20, 95], ['gold', 4, 8, 2, 34],
    ['redstone', 6, 7, 2, 18], ['lapis', 3, 6, 2, 34], ['diamond', 4, 6, 2, 16],
  ];
  function veins(w, r, cols) {
    const put = (x, y, z, ore) => {
      const i = w.index(x, y, z);
      if (i < 0 || w.ids[i] !== B.STONE) return;
      const m = w.meta[i];
      if (m === 0) { w.ids[i] = B.ORE; w.meta[i] = ORE(`${ore}_ore`); }
      else if (m === DEEPSLATE_M) { w.ids[i] = B.ORE; w.meta[i] = ORE(`deepslate_${ore}_ore`); }
    };
    const walk = (ore, size, y0, y1) => {
      let x = w.ox + Math.floor(r() * 16), y = y0 + Math.floor(r() * (y1 - y0)), z = w.oz + Math.floor(r() * 16);
      for (let k = 0; k < size; k++) {
        put(x, y, z, ore);
        const d = Math.floor(r() * 6);
        if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) z++; else z--;
      }
    };
    for (const [ore, count, size, y0, y1] of ORES) for (let v = 0; v < count; v++) walk(ore, size, y0, y1);
    if (cols.mountain) {
      for (let v = 0; v < 8; v++) walk('iron', 9, 80, 200);
      for (let v = 0; v < 6; v++) walk('emerald', 1, 50, 220);
    }
    const blob = (id, m, n, rad, y0, y1, onlyStone = true) => {
      for (let k = 0; k < n; k++) {
        const cx = w.ox + r() * 16, cy = y0 + r() * (y1 - y0), cz = w.oz + r() * 16, rr = rad * (0.6 + r() * 0.6);
        for (let y = Math.floor(cy - rr); y <= cy + rr; y++) for (let z = Math.floor(cz - rr); z <= cz + rr; z++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 * 1.3 + (z - cz) ** 2 > rr * rr) continue;
          const i = w.index(x, y, z);
          if (i < 0) continue;
          if (w.ids[i] === B.STONE && (!onlyStone || w.meta[i] === 0)) { w.ids[i] = id; w.meta[i] = m; }
        }
      }
    };
    blob(B.STONE, GRANITE_M, 1, 4.5, 10, 120); blob(B.STONE, DIORITE_M, 1, 4.5, 10, 120); blob(B.STONE, ANDESITE_M, 1, 4.5, 10, 120);
    blob(B.STONE, TUFF_M, 1, 4, 2, 20, false); blob(B.GRAVEL, 0, 1, 3.5, 10, 150); blob(B.DIRT, 0, 1, 3.5, 30, 160);
  }

  // ---------------- surface ----------------
  const WET = new Set([B.WATER]);
  function topBlocks(biome, y, underwater, slope, x, z, depthToSea) {
    // returns [topId, topMeta, fillerId, fillerMeta, fillerDepth]
    const patch = nPatch.noise2(x / 12, z / 12);
    if (underwater) {
      if (biome === BI.SWAMP || biome === BI.MANGROVE_SWAMP) return [B.DIRT, MUD_M, B.DIRT, 0, 3];
      if (biome === BI.COLD_OCEAN || biome === BI.FROZEN_OCEAN || biome === BI.DEEP_OCEAN || biome === BI.STONY_SHORE) return patch > 0.3 ? [B.SAND, 0, B.SAND, 0, 3] : [B.GRAVEL, 0, B.GRAVEL, 0, 3];
      if (biome === BI.RIVER || biome === BI.FROZEN_RIVER) return patch > 0.45 ? [B.DIRT, CLAY_M, B.DIRT, CLAY_M, 2] : patch < -0.3 ? [B.GRAVEL, 0, B.GRAVEL, 0, 2] : [B.SAND, 0, B.SAND, 0, 3];
      if (biome === BI.BADLANDS || biome === BI.ERODED_BADLANDS) return [B.SAND, RED_SAND_M, B.TERRACOTTA, 0, 3];
      if (depthToSea > 3 && patch > 0.55) return [B.DIRT, CLAY_M, B.DIRT, CLAY_M, 2];
      return [B.SAND, 0, B.SAND, 0, 3];
    }
    const steep = slope >= 4;
    switch (biome) {
      case BI.DESERT: return [B.SAND, 0, B.SAND, 0, 4];
      case BI.BEACH: return [B.SAND, 0, B.SAND, 0, 4];
      case BI.SNOWY_BEACH: return [B.SAND, 0, B.SAND, 0, 3];
      case BI.STONY_SHORE: return [B.STONE, 0, B.STONE, 0, 1];
      case BI.BADLANDS: case BI.ERODED_BADLANDS:
        return steep || y > SEA + 30 ? [-1, 0, -1, 0, 40] : [B.SAND, RED_SAND_M, -1, 0, 40];
      case BI.MUSHROOM_FIELDS: return [B.DIRT, MYCELIUM_M, B.DIRT, 0, 3];
      case BI.SNOWY_PLAINS: case BI.SNOWY_TAIGA: case BI.SNOWY_BEACH + 1000: return [B.GRASS_BLOCK, SNOWY_GRASS_M, B.DIRT, 0, 3];
      case BI.ICE_SPIKES: return [B.SNOW_BLOCK, 0, B.DIRT, 0, 3];
      case BI.FROZEN_PEAKS: return steep ? [B.PACKED_ICE, 0, B.STONE, 0, 1] : [B.SNOW_BLOCK, 0, B.SNOW_BLOCK, 0, 3];
      case BI.JAGGED_PEAKS: return steep ? [B.STONE, 0, B.STONE, 0, 1] : [B.SNOW_BLOCK, 0, B.SNOW_BLOCK, 0, 2];
      case BI.SNOWY_SLOPES: return steep ? [B.STONE, 0, B.STONE, 0, 1] : [B.SNOW_BLOCK, 0, B.DIRT, 0, 2];
      case BI.GROVE: return [B.GRASS_BLOCK, SNOWY_GRASS_M, B.DIRT, 0, 3];
      case BI.STONY_PEAKS: return patch > 0.3 ? [B.STONE, CALCITE_M, B.STONE, CALCITE_M, 3] : [B.STONE, 0, B.STONE, 0, 1];
      case BI.WINDSWEPT_HILLS: return steep ? [B.STONE, 0, B.STONE, 0, 1] : patch > 0.5 ? [B.GRAVEL, 0, B.GRAVEL, 0, 2] : [B.GRASS_BLOCK, 0, B.DIRT, 0, 3];
      case BI.OLD_GROWTH_TAIGA: return patch > 0.25 ? [B.DIRT, PODZOL_M, B.DIRT, 0, 3] : patch < -0.4 ? [B.DIRT, COARSE_M, B.DIRT, 0, 3] : [B.GRASS_BLOCK, 0, B.DIRT, 0, 3];
      case BI.TAIGA: return patch > 0.55 ? [B.DIRT, PODZOL_M, B.DIRT, 0, 3] : [B.GRASS_BLOCK, 0, B.DIRT, 0, 3];
      case BI.SAVANNA: return patch > 0.5 ? [B.DIRT, COARSE_M, B.DIRT, 0, 3] : [B.GRASS_BLOCK, 0, B.DIRT, 0, 3];
      case BI.MANGROVE_SWAMP: return [B.DIRT, MUD_M, B.DIRT, MUD_M, 4];
      case BI.JUNGLE: case BI.BAMBOO_JUNGLE: return patch > 0.6 ? [B.DIRT, PODZOL_M, B.DIRT, 0, 3] : [B.GRASS_BLOCK, 0, B.DIRT, 0, 3];
      default:
        if (steep && y > SEA + 30) return [B.STONE, 0, B.STONE, 0, 1];
        return [B.GRASS_BLOCK, 0, B.DIRT, 0, 3 + (patch > 0 ? 1 : 0)];
    }
  }

  // ---------------- chunk generation ----------------
  function generateChunk(cx, cz) {
    const w = new ChunkBuilder(cx, cz);
    const r = mulberry32((Math.imul(cx, 0x2f6b3d) ^ Math.imul(cz, 0x7a4c1b) ^ seed) >>> 0);
    if (flat) return generateFlat(w);
    const ox = w.ox, oz = w.oz;
    const cols = new Array(256);
    let mountain = false;
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const c = column(ox + x, oz + z);
      cols[x + z * 16] = c;
      w.biomes[x + z * 16] = c.biome;
      if (c.t.mtn > 0.3) mountain = true;
    }

    // Density -> stone / water / air, interpolated from a coarse grid.
    const gx0 = Math.floor(ox / GX), gz0 = Math.floor(oz / GX);
    const grid = [];
    for (let gz = 0; gz <= 4; gz++) for (let gx = 0; gx <= 4; gx++) grid.push(gridColumn(gx0 + gx, gz0 + gz));
    const ids = w.ids, meta = w.meta;
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const gx = x >> 2, gz = z >> 2, fx = (x & 3) / 4, fz = (z & 3) / 4;
      const a = grid[gx + gz * 5], b = grid[gx + 1 + gz * 5], c = grid[gx + (gz + 1) * 5], d = grid[gx + 1 + (gz + 1) * 5];
      const deep = 8 + Math.floor(hash2(ox + x, oz + z, seed ^ 0xdee9) * 5);
      for (let gy = 0; gy < NY - 1; gy++) {
        const d0 = lerp(lerp(a[gy], b[gy], fx), lerp(c[gy], d[gy], fx), fz);
        const d1 = lerp(lerp(a[gy + 1], b[gy + 1], fx), lerp(c[gy + 1], d[gy + 1], fx), fz);
        if (d0 <= 0 && d1 <= 0 && gy * GY > SEA) continue;
        for (let k = 0; k < GY; k++) {
          const y = gy * GY + k;
          const dens = d0 + (d1 - d0) * (k / GY);
          const i = CI(x, y, z);
          if (dens > 0) { ids[i] = B.STONE; meta[i] = y < deep ? DEEPSLATE_M : y < deep + 6 && hash3(ox + x, y, oz + z, seed) < 0.4 ? DEEPSLATE_M : 0; }
          else if (y <= SEA) ids[i] = B.WATER;
        }
      }
      ids[CI(x, 0, z)] = B.BEDROCK;
      for (let y = 1; y <= 4; y++) if (hash3(ox + x, y, oz + z, seed ^ 0xbed) < 0.8 - y * 0.2) ids[CI(x, y, z)] = B.BEDROCK;
    }

    // Surface rules, walking down each column so overhangs and islands get soil too.
    const tops = new Int16Array(256);
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      let y = HEIGHT - 1;
      while (y > 0 && (ids[CI(x, y, z)] === B.AIR)) y--;
      tops[x + z * 16] = y;
    }
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const c = cols[x + z * 16], biome = c.biome;
      const hx0 = tops[Math.max(0, x - 1) + z * 16], hx1 = tops[Math.min(15, x + 1) + z * 16];
      const hz0 = tops[x + Math.max(0, z - 1) * 16], hz1 = tops[x + Math.min(15, z + 1) * 16];
      const slope = Math.max(Math.abs(hx1 - hx0), Math.abs(hz1 - hz0));
      const wx = ox + x, wz = oz + z;
      let depth = -1, underwater = false, spec = null;
      const badlands = biome === BI.BADLANDS || biome === BI.ERODED_BADLANDS;
      // Eroded badlands hoodoos: terracotta spires rising from the surface.
      if (biome === BI.ERODED_BADLANDS) {
        const hv = nHoodoo.fbm2(wx / 16, wz / 16, 2);
        if (hv > 0.3) {
          const top = tops[x + z * 16], rise = Math.floor((hv - 0.3) * (wild ? 130 : 60));
          for (let y = top + 1; y <= Math.min(HEIGHT - 2, top + rise); y++) { const i = CI(x, y, z); ids[i] = B.STONE; }
          tops[x + z * 16] = Math.min(HEIGHT - 2, top + rise);
        }
      }
      for (let y = Math.min(HEIGHT - 1, tops[x + z * 16] + 1); y > 0; y--) {
        const i = CI(x, y, z), id = ids[i];
        if (id !== B.STONE) {
          if (id === B.AIR || id === B.WATER) { depth = -1; underwater = id === B.WATER; }
          continue;
        }
        if (meta[i] !== 0 && meta[i] !== DEEPSLATE_M) continue;
        depth++;
        if (depth === 0) {
          spec = topBlocks(biome, y, underwater, slope, wx, wz, SEA - y);
          if (spec[0] < 0 && !(badlands && !underwater && y > SEA - 4)) spec = [B.TERRACOTTA, 0, B.TERRACOTTA, 0, 6];
        }
        if (badlands && !underwater && y > SEA - 4) {
          if (depth === 0 && spec[0] > 0) { ids[i] = spec[0]; meta[i] = spec[1]; continue; }
          if (depth < 40) {
            const band = bands[(((y + Math.floor(nBand.noise2(wx / 60, wz / 60) * 3)) % 64) + 64) % 64];
            ids[i] = band[0]; meta[i] = band[1];
            continue;
          }
        }
        if (depth === 0) {
          if (spec[0] === B.STONE && spec[1] === 0) continue;
          // Grass never grows under water.
          if (underwater && spec[0] === B.GRASS_BLOCK) { ids[i] = B.DIRT; meta[i] = 0; continue; }
          ids[i] = spec[0]; meta[i] = spec[1];
        } else if (depth < spec[4]) {
          if (spec[2] === B.STONE && spec[3] === 0) continue;
          ids[i] = spec[2]; meta[i] = spec[3];
          if (biome === BI.DESERT && depth >= 3) { ids[i] = B.SANDSTONE; meta[i] = SANDSTONE_M; }
          if ((biome === BI.BEACH || biome === BI.SNOWY_BEACH) && depth >= 3) { ids[i] = B.SANDSTONE; meta[i] = SANDSTONE_M; }
        } else if (biome === BI.DESERT && depth < 8) { ids[i] = B.SANDSTONE; meta[i] = SANDSTONE_M; }
      }
    }

    // Caves.
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const top = tops[x + z * 16];
      const submerged = ids[CI(x, Math.min(HEIGHT - 1, Math.max(top, SEA) + 0), z)] === B.WATER || top < SEA;
      const limit = submerged ? top - 5 : top;
      for (let y = 5; y <= limit; y++) {
        const i = CI(x, y, z);
        const id = ids[i];
        if (id === B.AIR || id === B.WATER || id === B.BEDROCK) continue;
        if (noiseCave(ox + x, y, oz + z, top)) carve(w, ox + x, y, oz + z);
      }
    }
    wormCarve(w);

    veins(w, r, { mountain });
    underground(w, r, tops);
    geode(w, r);
    springs(w, r, tops, cols);

    // Heightmap after carving.
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      let y = HEIGHT - 1;
      while (y > 0 && ids[CI(x, y, z)] === B.AIR) y--;
      w.heights[x + z * 16] = y;
    }
    trees(w, cols);
    vegetation(w, r, cols);
    snowAndIce(w, cols);
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      let y = HEIGHT - 1;
      while (y > 0 && ids[CI(x, y, z)] === B.AIR) y--;
      w.heights[x + z * 16] = y;
    }
    animals(w, r, cols);
    return w;
  }

  function generateFlat(w) {
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      w.ids[CI(x, 0, z)] = B.BEDROCK;
      w.ids[CI(x, 1, z)] = B.DIRT; w.ids[CI(x, 2, z)] = B.DIRT;
      w.ids[CI(x, 3, z)] = B.GRASS_BLOCK;
      w.biomes[x + z * 16] = BI.PLAINS; w.heights[x + z * 16] = 3;
    }
    const r = mulberry32((Math.imul(w.cx, 0x2f6b3d) ^ Math.imul(w.cz, 0x7a4c1b) ^ seed) >>> 0);
    animals(w, r, null);
    return w;
  }

  // Lush caves, dripstone caves and glow lichen.
  function underground(w, r, tops) {
    const ids = w.ids, meta = w.meta;
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = w.ox + x, wz = w.oz + z, top = tops[x + z * 16];
      const lush = nLush.fbm2(wx / 190, wz / 190, 2) > 0.28, drip = !lush && nDrip.fbm2(wx / 170, wz / 170, 2) > 0.3;
      for (let y = 6; y < top - 10; y++) {
        const i = CI(x, y, z);
        if (ids[i] !== B.AIR) continue;
        const below = ids[i - 256], above = ids[i + 256];
        const stoneLike = id => id === B.STONE || id === B.DIRT || id === B.GRAVEL;
        if (lush) {
          if (stoneLike(below)) {
            ids[i - 256] = B.MOSS_BLOCK; meta[i - 256] = 0;
            const h = hash3(wx, y, wz, seed ^ 0x1a5);
            if (h < 0.25) ids[i] = B.MOSS_CARPET;
            else if (h < 0.3) { ids[i] = B.PLANT; meta[i] = PLANT('short_grass'); }
            else if (h < 0.312) { ids[i] = B.LEAVES; meta[i] = T.LEAF.azalea; }
          }
          if (stoneLike(above)) {
            ids[i + 256] = B.MOSS_BLOCK; meta[i + 256] = 0;
            if (hash3(wx, y, wz, seed ^ 0x2b6) < 0.1) {
              const len = 1 + Math.floor(hash3(wx, y, wz, seed ^ 0x3c7) * 5);
              for (let k = 0; k < len; k++) { const j = i - k * 256; if (j < 0 || ids[j] !== B.AIR) break; ids[j] = B.CAVE_VINES; }
            }
          }
        } else if (drip) {
          if (stoneLike(below)) {
            ids[i - 256] = B.STONE; meta[i - 256] = DRIPSTONE_M;
            if (hash3(wx, y, wz, seed ^ 0x4d8) < 0.12) ids[i] = B.POINTED_DRIPSTONE;
          }
          if (stoneLike(above)) { ids[i + 256] = B.STONE; meta[i + 256] = DRIPSTONE_M; }
        }
        if (ids[i] === B.AIR && hash3(wx, y, wz, seed ^ 0x5e9) < (lush ? 0.05 : 0.012)) {
          for (let d = 0; d < 4; d++) {
            const dx = [0, -1, 0, 1][d], dz = [1, 0, -1, 0][d];
            if (x + dx < 0 || x + dx > 15 || z + dz < 0 || z + dz > 15) continue;
            if (ids[i + dx + dz * 16] === B.STONE) { ids[i] = B.GLOW_LICHEN; meta[i] = d; break; }
          }
        }
      }
    }
  }

  function geode(w, r) {
    if (r() > 0.035) return;
    const cx = w.ox + 5 + r() * 6, cy = 12 + r() * 30, cz = w.oz + 5 + r() * 6, R = 4.5 + r() * 1.2;
    const ex = cx, ey = cy, ez = cz;
    for (let y = Math.floor(ey - R - 1); y <= ey + R + 1; y++) for (let z = Math.floor(ez - R - 1); z <= ez + R + 1; z++) for (let x = Math.floor(ex - R - 1); x <= ex + R + 1; x++) {
      const d = Math.hypot(x - ex, (y - ey) * 1.1, z - ez);
      if (d > R + 0.8) continue;
      if (d > R) w.set(x, y, z, B.BASALT, 1);
      else if (d > R - 1) w.set(x, y, z, B.STONE, CALCITE_M);
      else if (d > R - 2) w.set(x, y, z, B.MINERAL_BLOCK, S_('amethyst_block')[1]);
      else w.set(x, y, z, B.AIR);
    }
    for (let y = Math.floor(ey - R); y <= ey + R; y++) for (let z = Math.floor(ez - R); z <= ez + R; z++) for (let x = Math.floor(ex - R); x <= ex + R; x++) {
      if (w.get(x, y, z) === B.AIR && w.get(x, y - 1, z) === B.MINERAL_BLOCK && hash3(x, y, z, seed ^ 0xa3e) < 0.35) w.set(x, y, z, B.AMETHYST_CLUSTER);
    }
  }

  // Waterfalls pouring out of cliffs (and off floating islands in wild worlds).
  function springs(w, r, tops, cols) {
    const tries = wild ? 26 : 10;
    for (let k = 0; k < tries; k++) {
      const x = 1 + Math.floor(r() * 14), z = 1 + Math.floor(r() * 14);
      const top = tops[x + z * 16];
      if (top < SEA + 12) continue;
      const y = SEA + 8 + Math.floor(r() * (top - SEA - 10));
      const wx = w.ox + x, wz = w.oz + z;
      if (w.get(wx, y, wz) !== B.STONE || w.get(wx, y + 1, wz) !== B.STONE) continue;
      const lava = r() < 0.08;
      for (let d = 0; d < 4; d++) {
        const dx = [0, -1, 0, 1][d], dz = [1, 0, -1, 0][d];
        const fx = wx + dx, fz = wz + dz;
        if (!w.inside(fx, fz) || w.get(fx, y, fz) !== B.AIR) continue;
        const liquid = lava ? B.LAVA : B.WATER;
        w.set(wx, y, wz, liquid, 0);
        w.set(fx, y, fz, liquid, 1);
        let yy = y - 1;
        while (yy > 1 && w.get(fx, yy, fz) === B.AIR) { w.set(fx, yy, fz, liquid, 8); yy--; }
        const landed = yy + 1;
        if (w.get(fx, yy, fz) !== B.WATER && w.get(fx, yy, fz) !== B.LAVA) {
          for (let dz2 = -3; dz2 <= 3; dz2++) for (let dx2 = -3; dx2 <= 3; dx2++) {
            const dist = Math.abs(dx2) + Math.abs(dz2);
            if (dist === 0 || dist > 3) continue;
            const px = fx + dx2, pz = fz + dz2;
            if (w.get(px, landed, pz) === B.AIR && w.get(px, landed - 1, pz) > 0 && w.get(px, landed - 1, pz) !== B.AIR) w.set(px, landed, pz, liquid, Math.min(7, dist * (lava ? 2 : 1) + 1));
          }
        }
        break;
      }
    }
  }

  // ---------------- trees ----------------
  const TREE_DENSITY = {
    [BI.FOREST]: 0.055, [BI.FLOWER_FOREST]: 0.025, [BI.BIRCH_FOREST]: 0.055, [BI.DARK_FOREST]: 0.1, [BI.TAIGA]: 0.05,
    [BI.SNOWY_TAIGA]: 0.045, [BI.OLD_GROWTH_TAIGA]: 0.05, [BI.PLAINS]: 0.0035, [BI.SUNFLOWER_PLAINS]: 0.002, [BI.SAVANNA]: 0.009,
    [BI.JUNGLE]: 0.09, [BI.BAMBOO_JUNGLE]: 0.03, [BI.SWAMP]: 0.014, [BI.MANGROVE_SWAMP]: 0.04, [BI.CHERRY_GROVE]: 0.02,
    [BI.MEADOW]: 0.0025, [BI.WINDSWEPT_HILLS]: 0.008, [BI.GROVE]: 0.03, [BI.SNOWY_PLAINS]: 0.0025, [BI.MUSHROOM_FIELDS]: 0.005,
    [BI.RIVER]: 0.0, [BI.ICE_SPIKES]: 0.012, [BI.STONY_PEAKS]: 0, [BI.SNOWY_SLOPES]: 0.002,
  };
  function trees(w, cols) {
    const M = 8;
    for (let z = w.oz - M; z < w.oz + CHUNK + M; z++) for (let x = w.ox - M; x < w.ox + CHUNK + M; x++) {
      const h = hash2(x, z, seed ^ 0x7ee5);
      if (h > 0.12) continue;
      const col = column(x, z), biome = col.biome;
      const dens = TREE_DENSITY[biome] || 0;
      if (h >= dens) continue;
      if (col.t.h < SEA - 1) continue;
      const y = surfaceY(x, z) + 1;
      if (y <= SEA + 1 && biome !== BI.MANGROVE_SWAMP && biome !== BI.SWAMP) continue;
      if (y >= HEIGHT - 32) continue;
      if (noiseCave(x, y - 1, z, y - 1)) continue;
      const r = mulberry32((Math.imul(x, 0x1b873593) ^ Math.imul(z, 0x5bd1e995) ^ seed) >>> 0);
      const k = r();
      switch (biome) {
        case BI.FOREST: case BI.FLOWER_FOREST:
          if (k < 0.12) T.fancyOak(w, x, y, z, r); else if (k < 0.3) T.birch(w, x, y, z, r); else T.oak(w, x, y, z, r);
          break;
        case BI.BIRCH_FOREST: T.birch(w, x, y, z, r, k < 0.35); break;
        case BI.DARK_FOREST:
          if (k < 0.06) T.hugeMushroom(w, x, y, z, r, r() < 0.5); else if (k < 0.75) T.darkOak(w, x, y, z, r); else if (k < 0.85) T.birch(w, x, y, z, r); else T.oak(w, x, y, z, r);
          break;
        case BI.TAIGA: case BI.GROVE: case BI.WINDSWEPT_HILLS: case BI.SNOWY_SLOPES:
          if (biome === BI.WINDSWEPT_HILLS && k < 0.3) T.oak(w, x, y, z, r);
          else if (k < 0.35) T.pine(w, x, y, z, r); else T.spruce(w, x, y, z, r, biome === BI.GROVE || biome === BI.SNOWY_SLOPES);
          break;
        case BI.SNOWY_TAIGA: case BI.SNOWY_PLAINS: case BI.ICE_SPIKES:
          if (biome === BI.ICE_SPIKES) T.iceSpike(w, x, y - 1, z, r); else T.spruce(w, x, y, z, r, true);
          break;
        case BI.OLD_GROWTH_TAIGA:
          if (k < 0.35) T.megaSpruce(w, x, y, z, r); else if (k < 0.45) T.boulder(w, x, y, z, r); else if (k < 0.5) T.fallenLog(w, x, y, z, r, T.WOOD.spruce); else T.spruce(w, x, y, z, r);
          break;
        case BI.PLAINS: case BI.SUNFLOWER_PLAINS: case BI.MEADOW:
          if (k < 0.2) T.fancyOak(w, x, y, z, r); else if (biome === BI.MEADOW && k < 0.5) T.birch(w, x, y, z, r); else T.oak(w, x, y, z, r);
          break;
        case BI.SAVANNA: if (k < 0.8) T.acacia(w, x, y, z, r); else T.oak(w, x, y, z, r); break;
        case BI.JUNGLE: case BI.BAMBOO_JUNGLE:
          if (k < 0.18) T.megaJungle(w, x, y, z, r); else if (k < 0.55) T.jungle(w, x, y, z, r); else if (k < 0.65) T.fancyOak(w, x, y, z, r); else T.bush(w, x, y, z, r);
          break;
        case BI.SWAMP: T.oak(w, x, y, z, r, { vines: true }); break;
        case BI.MANGROVE_SWAMP: T.mangrove(w, x, y, z, r); break;
        case BI.CHERRY_GROVE: T.cherry(w, x, y, z, r); break;
        case BI.MUSHROOM_FIELDS: T.hugeMushroom(w, x, y, z, r, k < 0.5); break;
        default: break;
      }
    }
  }

  // ---------------- vegetation ----------------
  const F = {
    dandelion: FLOWER('dandelion'), poppy: FLOWER('poppy'), blue_orchid: FLOWER('blue_orchid'), allium: FLOWER('allium'), azure_bluet: FLOWER('azure_bluet'),
    red_tulip: FLOWER('red_tulip'), orange_tulip: FLOWER('orange_tulip'), white_tulip: FLOWER('white_tulip'), pink_tulip: FLOWER('pink_tulip'),
    oxeye_daisy: FLOWER('oxeye_daisy'), cornflower: FLOWER('cornflower'), lily_of_the_valley: FLOWER('lily_of_the_valley'),
    red_mushroom: FLOWER('red_mushroom'), brown_mushroom: FLOWER('brown_mushroom'), torchflower: FLOWER('torchflower'),
  };
  const P = { grass: PLANT('short_grass'), fern: PLANT('fern'), dead_bush: PLANT('dead_bush') };
  const FLOWERS_BY_BIOME = {
    [BI.PLAINS]: ['dandelion', 'poppy', 'azure_bluet', 'oxeye_daisy', 'red_tulip', 'white_tulip', 'orange_tulip', 'pink_tulip', 'cornflower'],
    [BI.SUNFLOWER_PLAINS]: ['dandelion', 'dandelion', 'oxeye_daisy', 'poppy', 'cornflower'],
    [BI.FLOWER_FOREST]: Object.keys(F).filter(k => !k.includes('mushroom') && k !== 'blue_orchid' && k !== 'torchflower'),
    [BI.FOREST]: ['dandelion', 'poppy', 'lily_of_the_valley'],
    [BI.BIRCH_FOREST]: ['dandelion', 'poppy', 'lily_of_the_valley'],
    [BI.MEADOW]: ['dandelion', 'poppy', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'torchflower'],
    [BI.CHERRY_GROVE]: ['pink_tulip', 'allium', 'azure_bluet', 'pink_tulip'],
    [BI.SWAMP]: ['blue_orchid'],
    [BI.DARK_FOREST]: ['red_mushroom', 'brown_mushroom', 'poppy'],
    [BI.MUSHROOM_FIELDS]: ['red_mushroom', 'brown_mushroom'],
    [BI.TAIGA]: ['brown_mushroom'],
    [BI.OLD_GROWTH_TAIGA]: ['brown_mushroom', 'red_mushroom'],
  };
  const GRASS_CHANCE = {
    [BI.PLAINS]: 0.3, [BI.SUNFLOWER_PLAINS]: 0.3, [BI.MEADOW]: 0.45, [BI.FOREST]: 0.18, [BI.FLOWER_FOREST]: 0.1, [BI.BIRCH_FOREST]: 0.18,
    [BI.DARK_FOREST]: 0.1, [BI.TAIGA]: 0.2, [BI.OLD_GROWTH_TAIGA]: 0.25, [BI.JUNGLE]: 0.35, [BI.BAMBOO_JUNGLE]: 0.3, [BI.SAVANNA]: 0.35,
    [BI.SWAMP]: 0.15, [BI.WINDSWEPT_HILLS]: 0.1, [BI.CHERRY_GROVE]: 0.25, [BI.SNOWY_TAIGA]: 0.05, [BI.GROVE]: 0.05, [BI.MANGROVE_SWAMP]: 0.05,
    [BI.RIVER]: 0.1, [BI.BEACH]: 0,
  };
  const FLOWER_CHANCE = { [BI.FLOWER_FOREST]: 0.25, [BI.MEADOW]: 0.12, [BI.PLAINS]: 0.025, [BI.SUNFLOWER_PLAINS]: 0.06, [BI.CHERRY_GROVE]: 0.08, [BI.FOREST]: 0.012, [BI.BIRCH_FOREST]: 0.012, [BI.SWAMP]: 0.02, [BI.DARK_FOREST]: 0.02, [BI.MUSHROOM_FIELDS]: 0.03, [BI.TAIGA]: 0.004, [BI.OLD_GROWTH_TAIGA]: 0.01 };

  function vegetation(w, r, cols) {
    const ids = w.ids, meta = w.meta;
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const biome = cols[x + z * 16].biome, top = w.heights[x + z * 16];
      if (top <= 0 || top >= HEIGHT - 4) continue;
      const wx = w.ox + x, wz = w.oz + z;
      const i = CI(x, top, z), ground = ids[i], gm = meta[i];
      const h = hash2(wx, wz, seed ^ 0x6a55), h2 = hash2(wx, wz, seed ^ 0x7b66);
      const above = i + 256;
      if (ground === B.WATER) {
        // Seafloor plants and lily pads.
        let fy = top;
        while (fy > 1 && ids[CI(x, fy, z)] === B.WATER) fy--;
        const floor = ids[CI(x, fy, z)], depth = top - fy;
        if (OCEANS.has(biome) || biome === BI.RIVER) {
          if (biome === BI.WARM_OCEAN && depth > 3 && h < 0.18) {
            const cm = Math.floor(h2 * 5);
            for (let k = 1; k <= 1 + Math.floor(h * 20) % 3; k++) w.set(wx, fy + k, wz, B.CORAL_BLOCK, cm);
          } else if (biome !== BI.FROZEN_OCEAN && floor !== B.AIR && h < 0.3) {
            if (h2 < 0.35 && depth > 4 && biome !== BI.WARM_OCEAN) {
              const len = Math.min(depth - 1, 2 + Math.floor(h * 60) % Math.max(1, depth - 2));
              for (let k = 1; k <= len; k++) w.set(wx, fy + k, wz, B.SEAGRASS, 1);
            } else if (depth > 1) w.set(wx, fy + 1, wz, B.SEAGRASS, 0);
          }
        }
        if ((biome === BI.SWAMP || biome === BI.MANGROVE_SWAMP) && top === SEA && h < 0.05 && ids[above] === B.AIR) w.set(wx, SEA + 1, wz, B.LILY_PAD);
        continue;
      }
      if (ids[above] !== B.AIR) continue;
      const grassy = ground === B.GRASS_BLOCK || (ground === B.DIRT && (gm === PODZOL_M || gm === COARSE_M || gm === MYCELIUM_M || gm === 0));
      // Sugar cane on shores.
      if ((ground === B.GRASS_BLOCK || ground === B.SAND || ground === B.DIRT) && top === SEA && h < 0.12) {
        let wet = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && ids[CI(nx, top, nz)] === B.WATER) wet = true; }
        if (wet && !COLD.has(biome)) { const len = 1 + Math.floor(h2 * 3); for (let k = 1; k <= len; k++) ids[CI(x, top + k, z)] = B.SUGAR_CANE; continue; }
      }
      if (ground === B.SAND && (biome === BI.DESERT || biome === BI.BADLANDS || biome === BI.ERODED_BADLANDS)) {
        if (h < 0.006 && x > 0 && x < 15 && z > 0 && z < 15) { const len = 1 + Math.floor(h2 * 3); for (let k = 1; k <= len; k++) ids[CI(x, top + k, z)] = B.CACTUS; }
        else if (h < 0.018) { ids[above] = B.PLANT; meta[above] = P.dead_bush; }
        continue;
      }
      if (ground === B.TERRACOTTA || ground === B.TERRACOTTA_COLORED) { if (h < 0.01) { ids[above] = B.PLANT; meta[above] = P.dead_bush; } continue; }
      if (!grassy) continue;
      if (biome === BI.BAMBOO_JUNGLE && h < 0.25) { const len = 4 + Math.floor(h2 * 10); for (let k = 1; k <= len; k++) if (ids[CI(x, top + k, z)] === B.AIR) ids[CI(x, top + k, z)] = B.BAMBOO; continue; }
      if ((biome === BI.TAIGA || biome === BI.SNOWY_TAIGA || biome === BI.OLD_GROWTH_TAIGA) && h < 0.012) { ids[above] = B.SWEET_BERRY_BUSH; continue; }
      if ((biome === BI.PLAINS || biome === BI.SAVANNA) && h < 0.0008) { ids[above] = B.PUMPKIN; meta[above] = Math.floor(h2 * 4) << 2; continue; }
      if (biome === BI.JUNGLE && h < 0.004) { ids[above] = B.MELON; continue; }
      const fc = FLOWER_CHANCE[biome] || 0;
      if (h < fc) {
        const list = FLOWERS_BY_BIOME[biome] || FLOWERS_BY_BIOME[BI.PLAINS];
        // Flowers cluster by type.
        const pick = list[Math.floor(Math.abs(nPatch.noise2(wx / 9, wz / 9) * 7 + h2 * 2) * list.length) % list.length];
        ids[above] = B.FLOWER; meta[above] = F[pick];
        continue;
      }
      const gc = GRASS_CHANCE[biome] ?? 0.12;
      if (h < fc + gc) {
        const fern = (biome === BI.TAIGA || biome === BI.OLD_GROWTH_TAIGA || biome === BI.JUNGLE || biome === BI.BAMBOO_JUNGLE || biome === BI.SNOWY_TAIGA) && h2 < 0.45;
        ids[above] = B.PLANT; meta[above] = fern ? P.fern : P.grass;
      }
    }
  }

  function snowAndIce(w, cols) {
    const ids = w.ids;
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const biome = cols[x + z * 16].biome, top = w.heights[x + z * 16];
      const high = top > (wild ? 200 : 165);
      if (!COLD.has(biome) && !high) continue;
      const i = CI(x, top, z), id = ids[i];
      if (id === B.WATER && top <= SEA && top >= SEA - 1) { ids[i] = B.ICE; continue; }
      if (top + 1 < HEIGHT && ids[i + 256] === B.AIR && (OPAQUE_SNOWABLE.has(id)) && biome !== BI.FROZEN_PEAKS) {
        ids[i + 256] = B.SNOW; w.meta[i + 256] = 0;
        if (id === B.GRASS_BLOCK) w.meta[i] = SNOWY_GRASS_M;
      }
    }
  }
  const OPAQUE_SNOWABLE = new Set([B.GRASS_BLOCK, B.DIRT, B.STONE, B.LEAVES, B.SAND, B.GRAVEL, B.SNOW_BLOCK, B.PACKED_ICE, B.COBBLESTONE]);

  // ---------------- animals present at generation ----------------
  const ANIMALS = {
    [BI.PLAINS]: ['cow', 'pig', 'sheep', 'chicken', 'horse'], [BI.SUNFLOWER_PLAINS]: ['cow', 'pig', 'sheep', 'chicken', 'horse'],
    [BI.FOREST]: ['cow', 'pig', 'sheep', 'chicken', 'wolf'], [BI.FLOWER_FOREST]: ['rabbit', 'pig', 'sheep', 'cow'], [BI.BIRCH_FOREST]: ['cow', 'pig', 'sheep', 'chicken'],
    [BI.DARK_FOREST]: ['cow', 'pig', 'sheep', 'chicken'], [BI.TAIGA]: ['wolf', 'fox', 'rabbit', 'sheep'], [BI.SNOWY_TAIGA]: ['wolf', 'fox', 'rabbit'],
    [BI.OLD_GROWTH_TAIGA]: ['wolf', 'fox', 'rabbit', 'pig'], [BI.SNOWY_PLAINS]: ['rabbit', 'polar_bear'], [BI.ICE_SPIKES]: ['rabbit', 'polar_bear'],
    [BI.SAVANNA]: ['horse', 'llama', 'cow', 'sheep'], [BI.JUNGLE]: ['parrot', 'ocelot', 'chicken', 'panda'], [BI.BAMBOO_JUNGLE]: ['panda', 'parrot', 'panda'],
    [BI.DESERT]: ['rabbit', 'camel'], [BI.MEADOW]: ['sheep', 'rabbit', 'donkey'], [BI.CHERRY_GROVE]: ['pig', 'rabbit', 'sheep'],
    [BI.MUSHROOM_FIELDS]: ['mooshroom'], [BI.SWAMP]: ['frog', 'frog', 'slime'], [BI.MANGROVE_SWAMP]: ['frog'], [BI.BEACH]: ['turtle'],
    [BI.SNOWY_SLOPES]: ['goat', 'rabbit'], [BI.JAGGED_PEAKS]: ['goat'], [BI.FROZEN_PEAKS]: ['goat'], [BI.GROVE]: ['wolf', 'fox', 'rabbit'],
    [BI.WINDSWEPT_HILLS]: ['sheep', 'llama', 'cow'],
    [BI.OCEAN]: ['squid', 'cod', 'dolphin'], [BI.DEEP_OCEAN]: ['squid', 'cod', 'glow_squid'], [BI.WARM_OCEAN]: ['tropical_fish', 'tropical_fish', 'dolphin', 'pufferfish'],
    [BI.COLD_OCEAN]: ['cod', 'salmon', 'squid'], [BI.FROZEN_OCEAN]: ['salmon', 'polar_bear'], [BI.RIVER]: ['salmon', 'squid'],
  };
  function animals(w, r, cols) {
    if (r() > (cols ? 0.22 : 0.12)) return;
    const x = Math.floor(r() * 16), z = Math.floor(r() * 16);
    const biome = cols ? cols[x + z * 16].biome : BI.PLAINS;
    const list = ANIMALS[biome];
    if (!list) return;
    const type = list[Math.floor(r() * list.length)];
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const px = Math.min(15, Math.max(0, x + Math.floor(r() * 5) - 2)), pz = Math.min(15, Math.max(0, z + Math.floor(r() * 5) - 2));
      const top = w.heights[px + pz * 16];
      const ground = w.ids[CI(px, top, pz)];
      const aquatic = ['squid', 'cod', 'dolphin', 'glow_squid', 'tropical_fish', 'pufferfish', 'salmon'].includes(type);
      if (aquatic !== (ground === B.WATER)) continue;
      const y = aquatic ? top - 2 : top + 1;
      w.entities.push({ type, x: w.ox + px + 0.5, y, z: w.oz + pz + 0.5 });
    }
  }

  function findSpawn() {
    if (flat) return { x: 0.5, y: 4, z: 0.5 };
    const nice = new Set([BI.PLAINS, BI.SUNFLOWER_PLAINS, BI.FOREST, BI.FLOWER_FOREST, BI.BIRCH_FOREST, BI.MEADOW, BI.SAVANNA, BI.CHERRY_GROVE, BI.TAIGA]);
    for (const strict of [true, false]) {
      for (let r = 0; r < 2500; r += 8) {
        for (let a = 0; a < 16; a++) {
          const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
          const c = column(x, z);
          if (strict ? !nice.has(c.biome) : (OCEANS.has(c.biome) || COLD.has(c.biome) || c.biome === BI.RIVER || c.biome === BI.BEACH || c.biome === BI.SWAMP)) continue;
          if (c.t.mtn > 0.35) continue;
          const y = surfaceY(x, z);
          if (y > SEA + 1 && y < SEA + 40 && !noiseCave(x, y, z, y) && hash2(x, z, seed ^ 0x7ee5) > 0.15) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: surfaceY(0, 0) + 2, z: 0.5 };
  }

  const biomeAt = (x, z) => flat ? BI.PLAINS : column(Math.floor(x), Math.floor(z)).biome;
  return { type, seed, column, climate, surfaceY, densityAt, noiseCave, generateChunk, findSpawn, biomeAt, wild, flat };
}
