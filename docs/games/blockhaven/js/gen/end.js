// End generator: the central island with its ring of obsidian pillars (end crystals on top, the
// two shortest caged in iron bars), a void gap, then endless outer islands with chorus forests.
import { Simplex, hash2, mulberry32 } from '../core/noise.js?v=mupp1ffq';
import { B, st, CHUNK, HEIGHT } from '../data/blocks.js?v=mupp1ffq';
import { ChunkBuilder, CI } from './chunk.js?v=mupp1ffq';
import { BI } from './biomes.js?v=mupp1ffq';

export const END_MAIN_R = 92;
export const END_OUTER_R = 180;

export function createEnd(seed) {
  seed |= 0;
  const N = k => new Simplex((seed ^ k) >>> 0);
  const nEdge = N(0xe001), nTop = N(0xe002), nOuter = N(0xe003), nOy = N(0xe004), nDetail = N(0xe005);
  const OBS = [B.OBSIDIAN, 0], BARS = st('iron_bars'), CHORUS_PLANT = st('chorus_plant'), CHORUS_FLOWER = st('chorus_flower');

  // Ten obsidian pillars in a ring of radius 42; heights shuffled per world.
  const pillars = (() => {
    const r = mulberry32(seed ^ 0x9111a), idx = [...Array(10).keys()];
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx.map((k, i) => {
      const a = 2 * Math.PI * i / 10;
      return { x: Math.round(Math.cos(a) * 42), z: Math.round(Math.sin(a) * 42), r: 2 + Math.floor(k / 3), top: 76 + k * 3, caged: k < 2 };
    });
  })();

  // Column profile of the island terrain: [bottom, top] or null.
  function mainColumn(x, z) {
    const d = Math.hypot(x, z);
    const R = END_MAIN_R + nEdge.noise2(Math.atan2(z, x) * 3, 0.5) * 10 + nEdge.noise2(x / 25, z / 25) * 5;
    if (d >= R) return null;
    const t = d / R;
    const top = Math.round(62 - Math.pow(t, 5) * 6 + nTop.fbm2(x / 30, z / 30, 2) * 1.8);
    const depth = Math.pow(1 - t * t, 0.6) * 52 + 2 + nDetail.noise2(x / 9, z / 9) * 3;
    return [Math.round(top - depth), top];
  }
  function outerColumn(x, z) {
    const d = Math.hypot(x, z);
    if (d < END_OUTER_R - 40) return null;
    const fade = Math.min(1, (d - (END_OUTER_R - 40)) / 60);
    const m = nOuter.fbm2(x / 110, z / 110, 4) * 1.3 - (1 - fade) * 0.5;
    if (m < 0.22) return null;
    const c = 58 + nOy.noise2(x / 240, z / 240) * 10;
    const k = m - 0.22;
    const top = Math.round(c + Math.min(6, k * 18) + nTop.noise2(x / 18, z / 18) * 1.2);
    const bot = Math.round(c - Math.min(40, k * 90));
    return bot < top ? [bot, top] : null;
  }
  const columnAt = (x, z) => mainColumn(x, z) || outerColumn(x, z);
  const surfaceY = (x, z) => { const c = columnAt(Math.floor(x), Math.floor(z)); return c ? c[1] : -1; };
  const biomeAt = (x, z) => (Math.hypot(x, z) < END_OUTER_R - 30 ? BI.THE_END : BI.END_HIGHLANDS);

  function generateChunk(cx, cz) {
    const w = new ChunkBuilder(cx, cz);
    const ox = cx * CHUNK, oz = cz * CHUNK;
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = ox + x, wz = oz + z;
      w.biomes[x + z * 16] = biomeAt(wx, wz);
      const c = columnAt(wx, wz);
      if (!c) continue;
      for (let y = Math.max(1, c[0]); y <= c[1]; y++) w.ids[CI(x, y, z)] = B.END_STONE;
    }
    // Pillars.
    if (Math.abs(ox) < 80 && Math.abs(oz) < 80) {
      for (const p of pillars) {
        if (!w.overlaps(p.x - p.r - 2, p.z - p.r - 2, p.x + p.r + 2, p.z + p.r + 2)) continue;
        for (let dz = -p.r; dz <= p.r; dz++) for (let dx = -p.r; dx <= p.r; dx++) {
          if (dx * dx + dz * dz > p.r * p.r + 1) continue;
          for (let y = 40; y <= p.top; y++) w.set(p.x + dx, y, p.z + dz, OBS[0], OBS[1]);
        }
        w.set(p.x, p.top + 1, p.z, B.BEDROCK, 0);
        w.set(p.x, p.top + 2, p.z, st('fire')[0], 0);
        if (p.caged) {
          for (let y = p.top + 1; y <= p.top + 4; y++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || y === p.top + 4) w.set(p.x + dx, y, p.z + dz, BARS[0], BARS[1]);
          }
        }
        w.addEntity({ type: 'end_crystal', x: p.x + 0.5, y: p.top + 2, z: p.z + 0.5 });
      }
    }
    // Chorus forests on the outer islands.
    const r = mulberry32((seed ^ Math.imul(cx, 0x632be5ab) ^ Math.imul(cz, 0x85157af5)) >>> 0);
    if (Math.hypot(ox + 8, oz + 8) > END_OUTER_R - 20) {
      const tries = 1 + Math.floor(r() * 4);
      for (let k = 0; k < tries; k++) {
        const x = 3 + Math.floor(r() * 10), z = 3 + Math.floor(r() * 10), c = outerColumn(ox + x, oz + z);
        if (!c) { r(); continue; }
        chorus(w, mulberry32(Math.floor(r() * 1e9)), ox + x, c[1] + 1, oz + z);
      }
    }
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      let y = HEIGHT - 1;
      while (y > 0 && w.ids[CI(x, y, z)] === B.AIR) y--;
      w.heights[x + z * 16] = y;
    }
    return w;
  }

  // Branching chorus plant with flowers at the tips.
  function chorus(w, r, x, y, z, depth = 0) {
    const h = 2 + Math.floor(r() * (depth ? 3 : 5));
    for (let i = 0; i < h; i++) w.soft(x, y + i, z, CHORUS_PLANT[0], CHORUS_PLANT[1]);
    const ty = y + h - 1;
    let branched = false;
    if (depth < 3) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (r() < 0.35 - depth * 0.07) {
        w.soft(x + dx, ty, z + dz, CHORUS_PLANT[0], CHORUS_PLANT[1]);
        chorus(w, r, x + dx, ty + 1, z + dz, depth + 1);
        branched = true;
      }
    }
    if (!branched || r() < 0.5) w.soft(x, ty + 1, z, CHORUS_FLOWER[0], CHORUS_FLOWER[1]);
  }

  const findSpawn = () => ({ x: 100.5, y: 49, z: 0.5 });
  return { seed, generateChunk, findSpawn, biomeAt, surfaceY, columnAt, pillars };
}
