// Structures: villages (five styles), pillager outposts, desert pyramids, igloos, swamp huts,
// ruined portals, dungeons, mineshafts, strongholds with portal rooms, nether fortresses,
// bastion remnants and end cities. Each structure is planned once from its own seed and then
// written into every chunk it overlaps (ChunkBuilder clips writes), so they span chunk borders
// seamlessly. Planning must never read the chunk, only the terrain functions, so every chunk
// sees the same plan.
import { hash2, hash3, mulberry32 } from '../core/noise.js?v=munkil2j';
import { B, st, DIM, SEA, CHUNK, COLORS, CROP_AGE_SHIFT } from '../data/blocks.js?v=munkil2j';
import { BI } from './biomes.js?v=munkil2j';
import { NETHER_LAVA } from './nether.js?v=munkil2j';
import { END_OUTER_R } from './end.js?v=munkil2j';

const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // +z, -x, -z, +x (same as placement code)
const S = k => st(k);
const AIR = [B.AIR, 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SOLIDISH = id => id > 0 && id !== B.WATER && id !== B.LAVA && id !== B.FENCE && id !== B.COBWEB && id !== B.RAIL;

// ---------------- loot ----------------
// [key, min, max, weight]; rolls [lo, hi].
const LOOT = {
  village: [3, 7, [['bread', 1, 4, 15], ['apple', 1, 5, 12], ['wheat', 3, 9, 10], ['emerald', 1, 3, 5], ['iron_ingot', 1, 3, 4], ['oak_sapling', 1, 3, 5], ['potato', 2, 6, 8], ['carrot', 2, 6, 8], ['book', 1, 2, 3], ['beetroot_seeds', 2, 6, 5], ['wheat_seeds', 2, 8, 6], ['leather', 1, 3, 4], ['feather', 1, 4, 3]]],
  smith: [3, 8, [['iron_ingot', 1, 5, 12], ['gold_ingot', 1, 3, 6], ['bread', 1, 3, 10], ['apple', 1, 3, 10], ['obsidian', 3, 7, 5], ['diamond', 1, 3, 2], ['iron_pickaxe', 1, 1, 4], ['iron_sword', 1, 1, 4], ['iron_helmet', 1, 1, 3], ['iron_chestplate', 1, 1, 3], ['iron_leggings', 1, 1, 3], ['iron_boots', 1, 1, 3], ['saddle', 1, 1, 3], ['oak_sapling', 3, 7, 5]]],
  library: [2, 5, [['book', 1, 3, 20], ['paper', 1, 5, 12], ['compass', 1, 1, 5], ['clock', 1, 1, 3], ['emerald', 1, 2, 4], ['bread', 1, 2, 6]]],
  dungeon: [4, 9, [['saddle', 1, 1, 10], ['golden_apple', 1, 1, 8], ['enchanted_golden_apple', 1, 1, 1], ['name_tag', 1, 1, 10], ['iron_ingot', 1, 4, 10], ['gold_ingot', 1, 4, 5], ['bread', 1, 1, 20], ['wheat', 1, 4, 20], ['bucket', 1, 1, 10], ['redstone', 1, 4, 15], ['coal', 1, 4, 15], ['gunpowder', 1, 8, 10], ['string', 1, 8, 10], ['bone', 1, 8, 10], ['rotten_flesh', 1, 8, 10]]],
  pyramid: [3, 8, [['bone', 4, 6, 25], ['rotten_flesh', 3, 7, 16], ['gunpowder', 1, 8, 10], ['sand', 1, 8, 10], ['string', 1, 8, 10], ['spider_eye', 1, 3, 10], ['gold_ingot', 2, 7, 15], ['iron_ingot', 1, 5, 15], ['emerald', 1, 3, 15], ['diamond', 1, 3, 5], ['saddle', 1, 1, 10], ['golden_apple', 1, 1, 20], ['enchanted_golden_apple', 1, 1, 2]]],
  mineshaft: [3, 7, [['rail', 4, 8, 20], ['torch', 1, 16, 15], ['bread', 1, 3, 15], ['iron_ingot', 1, 5, 10], ['gold_ingot', 1, 3, 5], ['redstone', 4, 9, 5], ['lapis_lazuli', 4, 9, 5], ['diamond', 1, 2, 3], ['coal', 3, 8, 10], ['melon_seeds', 2, 4, 10], ['pumpkin_seeds', 2, 4, 10], ['beetroot_seeds', 2, 4, 10], ['iron_pickaxe', 1, 1, 5], ['name_tag', 1, 1, 3], ['golden_apple', 1, 1, 2]]],
  stronghold: [3, 7, [['ender_pearl', 1, 2, 10], ['iron_ingot', 1, 5, 10], ['gold_ingot', 1, 3, 5], ['redstone', 4, 9, 5], ['bread', 1, 3, 15], ['apple', 1, 3, 15], ['iron_pickaxe', 1, 1, 5], ['iron_sword', 1, 1, 5], ['iron_chestplate', 1, 1, 5], ['iron_helmet', 1, 1, 5], ['diamond', 1, 3, 3], ['golden_apple', 1, 1, 1], ['saddle', 1, 1, 1], ['book', 1, 3, 4]]],
  fortress: [2, 5, [['diamond', 1, 3, 5], ['iron_ingot', 1, 5, 5], ['gold_ingot', 1, 3, 15], ['golden_sword', 1, 1, 5], ['golden_chestplate', 1, 1, 5], ['flint_and_steel', 1, 1, 5], ['nether_wart', 3, 7, 5], ['saddle', 1, 1, 10], ['obsidian', 2, 4, 2]]],
  bastion: [4, 9, [['gold_ingot', 3, 9, 15], ['gold_nugget', 6, 17, 12], ['netherite_scrap', 1, 1, 4], ['ancient_debris', 1, 2, 3], ['diamond', 1, 3, 4], ['golden_apple', 1, 1, 6], ['crossbow', 1, 1, 6], ['arrow', 6, 17, 8], ['obsidian', 2, 6, 6], ['crying_obsidian', 1, 5, 6], ['gilded_blackstone', 1, 4, 5], ['magma_cream', 2, 6, 5], ['iron_ingot', 3, 9, 8]]],
  end_city: [3, 8, [['diamond', 2, 7, 5], ['iron_ingot', 4, 8, 10], ['gold_ingot', 2, 7, 15], ['emerald', 2, 6, 2], ['beetroot_seeds', 1, 10, 5], ['saddle', 1, 1, 3], ['diamond_sword', 1, 1, 3], ['diamond_pickaxe', 1, 1, 3], ['diamond_chestplate', 1, 1, 3], ['iron_sword', 1, 1, 3], ['iron_chestplate', 1, 1, 3], ['chorus_fruit', 2, 6, 6]]],
  ruined_portal: [3, 7, [['obsidian', 1, 2, 40], ['flint_and_steel', 1, 1, 40], ['gold_nugget', 4, 24, 15], ['golden_apple', 1, 1, 15], ['golden_sword', 1, 1, 15], ['golden_helmet', 1, 1, 15], ['golden_carrot', 4, 12, 15], ['clock', 1, 1, 5], ['gold_ingot', 2, 8, 5], ['enchanted_golden_apple', 1, 1, 1]]],
  igloo: [2, 6, [['apple', 1, 3, 15], ['coal', 1, 4, 15], ['gold_nugget', 1, 3, 10], ['stone_axe', 1, 1, 2], ['rotten_flesh', 1, 1, 10], ['emerald', 1, 1, 1], ['wheat', 2, 3, 10], ['golden_apple', 1, 1, 1]]],
  outpost: [2, 6, [['arrow', 2, 7, 10], ['crossbow', 1, 1, 3], ['wheat', 3, 5, 7], ['potato', 2, 5, 5], ['carrot', 3, 5, 5], ['dark_oak_log', 2, 3, 10], ['iron_ingot', 1, 3, 5], ['string', 1, 6, 5], ['experience_bottle', 1, 1, 3]]],
  swamp_hut: [1, 3, [['glowstone_dust', 1, 4, 10], ['string', 1, 4, 10], ['spider_eye', 1, 2, 10], ['redstone', 1, 4, 8], ['gunpowder', 1, 2, 8]]],
};
function lootItems(r, table) {
  const [lo, hi, entries] = LOOT[table];
  const n = lo + Math.floor(r() * (hi - lo + 1));
  let total = 0; for (const e of entries) total += e[3];
  const items = new Array(27).fill(null);
  for (let i = 0; i < n; i++) {
    let k = r() * total, e = entries[0];
    for (const x of entries) if ((k -= x[3]) < 0) { e = x; break; }
    const count = e[1] + Math.floor(r() * (e[2] - e[1] + 1));
    let slot = Math.floor(r() * 27);
    for (let t = 0; t < 27 && items[slot]; t++) slot = (slot + 1) % 27;
    items[slot] = { key: e[0], count };
  }
  return items;
}

// ---------------- block helpers ----------------
const put = (w, x, y, z, s) => w.set(x, y, z, s[0], s[1]);
function fill(w, x0, y0, z0, x1, y1, z1, s) {
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (z0 > z1) [z0, z1] = [z1, z0];
  w.box(x0, y0, z0, x1, y1, z1, s[0], s[1]);
}
const stairs = (key, facing, up = false) => { const s = S(key); return [s[0], s[1] | (facing << 4) | (up ? 64 : 0)]; };
const slab = (key, top = false) => { const s = S(key); return [s[0], s[1] | ((top ? 1 : 0) << 4)]; };
const logAxis = (key, axis) => { const s = S(key); return [s[0], s[1] | (axis << 4)]; }; // 0 y, 1 x, 2 z
const wallTorch = (wallDir, soul = false) => { const s = S(soul ? 'soul_torch' : 'torch'); return [s[0], s[1] | ((wallDir + 1) << 1)]; };
function door(w, x, y, z, key, facing) { const s = S(key); w.set(x, y, z, s[0], s[1] | (facing << 3)); w.set(x, y + 1, z, s[0], s[1] | (facing << 3) | 64); }
function bed(w, x, y, z, dir) { const [dx, dz] = DIRS[dir]; w.set(x, y, z, B.BED, dir); w.set(x + dx, y, z + dz, B.BED, dir | 4); }
function chest(w, x, y, z, facing, r, table) { w.set(x, y, z, B.CHEST, facing); w.addBlockEntity({ type: 'chest', x, y, z, items: lootItems(r, table) }); }
function spawner(w, x, y, z, mob) { w.set(x, y, z, B.SPAWNER, 0); w.addBlockEntity({ type: 'spawner', x, y, z, mob }); }
// Fills downward from y-1 until solid ground (for foundations and stilts).
function foundation(w, x, y, z, s, max = 12) {
  for (let yy = y - 1; yy > y - 1 - max && yy > 0; yy--) {
    const c = w.get(x, yy, z);
    if (c < 0) return;
    if (c !== B.AIR && c !== B.WATER && c !== B.LAVA && c !== B.SNOW && c !== B.PLANT && c !== B.FLOWER && c !== B.LEAVES && c !== B.SEAGRASS) return;
    put(w, x, yy, z, s);
  }
}
// Mix of stone bricks: mossy and cracked by position.
const brickMix = (x, y, z, seed, base = 'stone_bricks') => {
  const h = hash3(x, y, z, seed ^ 0xb71c);
  if (base !== 'stone_bricks') return S(base);
  return h < 0.18 ? S('mossy_stone_bricks') : h < 0.3 ? S('cracked_stone_bricks') : S('stone_bricks');
};
function shell(w, x0, y0, z0, x1, y1, z1, mat, seed, inner = AIR) {
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (z0 > z1) [z0, z1] = [z1, z0];
  const ax = Math.max(x0, w.ox), bx = Math.min(x1, w.ox + CHUNK - 1), az = Math.max(z0, w.oz), bz = Math.min(z1, w.oz + CHUNK - 1);
  if (ax > bx || az > bz) return;
  for (let y = y0; y <= y1; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
    const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
    put(w, x, y, z, edge ? (typeof mat === 'function' ? mat(x, y, z) : mat) : inner);
  }
}

// Local frame for a lot: u runs along the front, v runs from the front (towards the road) back.
function frame(L) {
  const { x0, z0, x1, z1, face } = L;
  const at = (u, v) => face === 0 ? [x0 + u, z1 - v] : face === 2 ? [x1 - u, z0 + v] : face === 3 ? [x1 - v, z0 + u] : [x0 + v, z1 - u];
  const [ax, az] = at(0, 0), [bx, bz] = at(1, 0);
  const R = dirOf(bx - ax, bz - az);
  return {
    at, F: face, Bk: (face + 2) % 4, R, Lf: (R + 2) % 4,
    put: (w, u, y, v, s) => { const [x, z] = at(u, v); put(w, x, y, z, s); },
    get: (w, u, y, v) => { const [x, z] = at(u, v); return w.get(x, y, z); },
    fill: (w, u0, y0, v0, u1, y1, v1, s) => { const [ax2, az2] = at(u0, v0), [bx2, bz2] = at(u1, v1); fill(w, ax2, y0, az2, bx2, y1, bz2, s); },
  };
}
const dirOf = (dx, dz) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 3 : 1) : (dz > 0 ? 0 : 2));

// ---------------- village styles ----------------
const STYLE = {
  plains: { wall: 'oak_planks', log: 'oak_log', floor: 'oak_planks', base: 'cobblestone', stairs: 'oak_stairs', slab: 'oak_slab', door: 'oak_door', fence: 'oak_fence', accent: 'cobblestone', roof: 'gable', sapling: 'oak_sapling' },
  desert: { wall: 'sandstone', log: 'cut_sandstone', floor: 'smooth_sandstone', base: 'sandstone', stairs: 'sandstone_stairs', slab: 'sandstone_slab', door: 'jungle_door', fence: 'jungle_fence', accent: 'orange_terracotta', roof: 'flat', sapling: 'dead_bush' },
  savanna: { wall: 'acacia_planks', log: 'acacia_log', floor: 'acacia_planks', base: 'cobblestone', stairs: 'acacia_stairs', slab: 'acacia_slab', door: 'acacia_door', fence: 'acacia_fence', accent: 'orange_terracotta', roof: 'hip', sapling: 'acacia_sapling' },
  taiga: { wall: 'spruce_planks', log: 'spruce_log', floor: 'spruce_planks', base: 'cobblestone', stairs: 'spruce_stairs', slab: 'spruce_slab', door: 'spruce_door', fence: 'spruce_fence', accent: 'mossy_cobblestone', roof: 'gable', sapling: 'spruce_sapling' },
  snowy: { wall: 'spruce_planks', log: 'spruce_log', floor: 'spruce_planks', base: 'stone_bricks', stairs: 'spruce_stairs', slab: 'spruce_slab', door: 'spruce_door', fence: 'spruce_fence', accent: 'packed_ice', roof: 'gable', snow: true, sapling: 'spruce_sapling' },
};
function villageStyle(biome) {
  if (biome === BI.DESERT) return 'desert';
  if (biome === BI.SAVANNA) return 'savanna';
  if (biome === BI.TAIGA || biome === BI.OLD_GROWTH_TAIGA) return 'taiga';
  if (biome === BI.SNOWY_PLAINS || biome === BI.SNOWY_TAIGA) return 'snowy';
  return 'plains';
}
const VILLAGE_BIOMES = new Set([BI.PLAINS, BI.SUNFLOWER_PLAINS, BI.MEADOW, BI.DESERT, BI.SAVANNA, BI.TAIGA, BI.SNOWY_PLAINS, BI.SNOWY_TAIGA]);

// Lot sizes [width along road, depth].
const LOT = { small: [5, 5], big: [7, 9], farm: [9, 7], bigfarm: [13, 9], smith: [9, 7], library: [9, 7], temple: [7, 11], pen: [9, 9], butcher: [7, 7], fletcher: [7, 7] };
const PROF = { farm: 'farmer', bigfarm: 'farmer', smith: ['armorer', 'weaponsmith', 'toolsmith'], library: 'librarian', temple: 'cleric', butcher: 'butcher', fletcher: 'fletcher', pen: 'shepherd' };

export function createStructures(seed, dim, terrain) {
  seed |= 0;
  const flat = !!terrain.flat, wild = !!terrain.wild;
  const plans = new Map();

  // ---------------- placement grid ----------------
  // spacing (blocks), margin, radius (block reach from origin), salt.
  const KINDS = {
    village: { dim: DIM.OVERWORLD, spacing: 480, reach: 80, salt: 0x1a11 },
    pillager_outpost: { dim: DIM.OVERWORLD, spacing: 640, reach: 24, salt: 0x1a12 },
    desert_pyramid: { dim: DIM.OVERWORLD, spacing: 360, reach: 16, salt: 0x1a13 },
    igloo: { dim: DIM.OVERWORLD, spacing: 360, reach: 12, salt: 0x1a14 },
    swamp_hut: { dim: DIM.OVERWORLD, spacing: 360, reach: 10, salt: 0x1a15 },
    ruined_portal: { dim: DIM.OVERWORLD, spacing: 280, reach: 10, salt: 0x1a16 },
    mineshaft: { dim: DIM.OVERWORLD, spacing: 192, reach: 96, salt: 0x1a17 },
    stronghold: { dim: DIM.OVERWORLD, reach: 72, salt: 0x1a18 },
    dungeon: { dim: DIM.OVERWORLD, spacing: 48, reach: 8, salt: 0x1a19 },
    fortress: { dim: DIM.NETHER, spacing: 352, reach: 96, salt: 0x2a11 },
    bastion: { dim: DIM.NETHER, spacing: 352, reach: 24, salt: 0x2a12 },
    end_city: { dim: DIM.END, spacing: 320, reach: 28, salt: 0x3a11 },
  };

  // Stronghold positions: 3 in a ring at 560-880 blocks, 6 more at 1500-2000.
  const strongholds = (() => {
    const r = mulberry32(seed ^ 0x5701), out = [];
    const ring = (n, r0, r1) => { const a0 = r() * Math.PI * 2; for (let i = 0; i < n; i++) { const a = a0 + i * Math.PI * 2 / n + (r() - 0.5) * 0.4, d = r0 + r() * (r1 - r0); out.push({ x: Math.round(Math.cos(a) * d), z: Math.round(Math.sin(a) * d) }); } };
    ring(3, 560, 880); ring(6, 1500, 2000);
    return out;
  })();

  const biomeOf = (x, z) => terrain.biomeAt(x, z);
  const landY = (x, z) => terrain.surfaceY ? terrain.surfaceY(Math.floor(x), Math.floor(z)) : 64;

  // Candidate origin in region (rx, rz) for `kind`, or null.
  function candidate(kind, rx, rz) {
    const K = KINDS[kind];
    const key = kind + rx + ',' + rz;
    if (plans.has('c' + key)) return plans.get('c' + key);
    let c = null;
    const h = hash2(rx, rz, seed ^ K.salt);
    const m = Math.min(64, K.spacing / 4);
    const x = rx * K.spacing + Math.floor(m + hash2(rx, rz, seed ^ K.salt ^ 0x55) * (K.spacing - 2 * m));
    const z = rz * K.spacing + Math.floor(m + hash2(rx, rz, seed ^ K.salt ^ 0x77) * (K.spacing - 2 * m));
    const b = () => biomeOf(x, z);
    switch (kind) {
      case 'village': if (VILLAGE_BIOMES.has(b()) || (flat && h < 0.9)) { const y = landY(x, z); if (flat || (y >= SEA && y < SEA + 60)) c = { x, z, y }; } break;
      case 'pillager_outpost': if (h < 0.7 && (VILLAGE_BIOMES.has(b()) || b() === BI.GROVE || b() === BI.SNOWY_SLOPES || flat)) { const y = landY(x, z); if (flat || y >= SEA) c = { x, z, y }; } break;
      case 'desert_pyramid': if (b() === BI.DESERT) { const y = landY(x, z); if (y >= SEA) c = { x, z, y }; } break;
      case 'igloo': if (b() === BI.SNOWY_PLAINS || b() === BI.SNOWY_TAIGA) { const y = landY(x, z); if (y >= SEA) c = { x, z, y }; } break;
      case 'swamp_hut': if (b() === BI.SWAMP || b() === BI.MANGROVE_SWAMP) c = { x, z, y: Math.max(landY(x, z), SEA - 1) }; break;
      case 'ruined_portal': if (h < 0.6 && !flat) { const y = landY(x, z); if (y >= SEA - 1 && y < 200) c = { x, z, y }; } break;
      case 'mineshaft': if (h < 0.55 && !flat) { const y = 18 + Math.floor(hash2(rx, rz, seed ^ 0x3131) * 22); if (landY(x, z) > y + 14) c = { x, z, y }; } break;
      case 'dungeon': if (h < 0.5 && !flat) { const y = 12 + Math.floor(hash2(rx, rz, seed ^ 0x4141) * 38); if (landY(x, z) > y + 10) c = { x, z, y }; } break;
      case 'fortress': if (h < 0.75) c = { x, z, y: 52 + Math.floor(hash2(rx, rz, seed ^ 0x6161) * 16) }; break;
      case 'bastion': if (h < 0.55 && b() !== BI.BASALT_DELTAS) { const y = terrain.floorY ? terrain.floorY(x, z, 90, NETHER_LAVA + 2) : -1; if (y > 0) c = { x, z, y }; } break;
      case 'end_city': if (h < 0.8 && Math.hypot(x, z) > END_OUTER_R + 60) { const y = terrain.surfaceY(x, z); if (y > 40 && terrain.surfaceY(x + 6, z) > 40 && terrain.surfaceY(x - 6, z) > 40 && terrain.surfaceY(x, z + 6) > 40 && terrain.surfaceY(x, z - 6) > 40) c = { x, z, y }; } break;
    }
    if (c) { c.kind = kind; c.seed = (hash2(rx, rz, seed ^ K.salt ^ 0x9999) * 4294967296) >>> 0; }
    if (plans.size > 4000) plans.clear();
    plans.set('c' + key, c);
    return c;
  }

  function* candidatesNear(kind, x0, z0, x1, z1) {
    const K = KINDS[kind];
    if (kind === 'stronghold') {
      for (let i = 0; i < strongholds.length; i++) {
        const s = strongholds[i];
        if (s.x + K.reach >= x0 && s.x - K.reach <= x1 && s.z + K.reach >= z0 && s.z - K.reach <= z1) yield strongholdCand(i);
      }
      return;
    }
    const rx0 = Math.floor((x0 - K.reach) / K.spacing), rx1 = Math.floor((x1 + K.reach) / K.spacing);
    const rz0 = Math.floor((z0 - K.reach) / K.spacing), rz1 = Math.floor((z1 + K.reach) / K.spacing);
    for (let rz = rz0; rz <= rz1; rz++) for (let rx = rx0; rx <= rx1; rx++) {
      const c = candidate(kind, rx, rz);
      if (c && c.x + K.reach >= x0 && c.x - K.reach <= x1 && c.z + K.reach >= z0 && c.z - K.reach <= z1) yield c;
    }
  }
  function strongholdCand(i) {
    const s = strongholds[i];
    return { kind: 'stronghold', x: s.x, z: s.z, y: 26 + Math.floor(hash2(i, 7, seed) * 12), seed: (hash2(i, 3, seed ^ 0x5702) * 4294967296) >>> 0 };
  }

  // ---------------- chunk population ----------------
  function place(w) {
    const x0 = w.ox, z0 = w.oz, x1 = x0 + CHUNK - 1, z1 = z0 + CHUNK - 1;
    let touched = false;
    for (const kind in KINDS) {
      if (KINDS[kind].dim !== dim) continue;
      if (flat && (kind === 'mineshaft' || kind === 'dungeon' || kind === 'stronghold' || kind === 'ruined_portal')) continue;
      for (const c of candidatesNear(kind, x0, z0, x1, z1)) {
        BUILD[kind](w, c);
        touched = true;
      }
    }
    return touched;
  }

  // ---------------- locate ----------------
  function locate(kind, x, z) {
    const K = KINDS[kind];
    if (!K || K.dim !== dim) return null;
    if (kind === 'stronghold') {
      let best = null, bd = Infinity;
      strongholds.forEach((s, i) => { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = strongholdCand(i); } });
      return best && { x: best.x, y: best.y, z: best.z };
    }
    const rx = Math.floor(x / K.spacing), rz = Math.floor(z / K.spacing);
    let best = null, bd = Infinity;
    const maxR = Math.max(4, Math.ceil(6000 / K.spacing));
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const c = candidate(kind, rx + dx, rz + dz);
        if (!c) continue;
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best && bd < (r - 1) * K.spacing) break;
    }
    return best && { x: best.x, y: best.y, z: best.z };
  }

  // ======================================================================
  // Builders
  // ======================================================================
  const BUILD = {};

  // ---------------- village ----------------
  function planVillage(c) {
    const key = 'v' + c.x + ',' + c.z;
    if (plans.has(key)) return plans.get(key);
    const r = mulberry32(c.seed);
    const style = flat ? 'plains' : villageStyle(biomeOf(c.x, c.z));
    const roads = [], lots = [], lamps = [];
    const rects = [[c.x - 4, c.z - 4, c.x + 4, c.z + 4]];
    const free = (a) => rects.every(b => a[2] < b[0] - 1 || a[0] > b[2] + 1 || a[3] < b[1] - 1 || a[1] > b[3] + 1);
    const groundOK = (x0, z0, x1, z1) => {
      if (flat) return c.y;
      const hs = [landY(x0, z0), landY(x1, z0), landY(x0, z1), landY(x1, z1), landY((x0 + x1) >> 1, (z0 + z1) >> 1)].sort((a, b) => a - b);
      if (hs[0] < SEA || hs[4] - hs[0] > 6 || Math.abs(hs[2] - c.y) > 14) return -1;
      return hs[2];
    };
    // Roads: up to four arms plus side streets.
    const arms = [];
    for (let d = 0; d < 4; d++) if (d === 0 || r() < 0.85) arms.push({ d, len: 22 + Math.floor(r() * 26), x: c.x + DIRS[d][0] * 5, z: c.z + DIRS[d][1] * 5, depth: 0 });
    const allRoads = [];
    while (arms.length) {
      const a = arms.shift();
      const [dx, dz] = DIRS[a.d];
      const ex = a.x + dx * a.len, ez = a.z + dz * a.len;
      if (Math.hypot(ex - c.x, ez - c.z) > 70) a.len = Math.max(8, a.len - 20);
      const seg = { x0: a.x, z0: a.z, d: a.d, len: a.len };
      roads.push(seg); allRoads.push(seg);
      const px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0;
      rects.push([Math.min(a.x, a.x + dx * a.len) - pz, Math.min(a.z, a.z + dz * a.len) - px, Math.max(a.x, a.x + dx * a.len) + pz, Math.max(a.z, a.z + dz * a.len) + px]);
      if (a.depth === 0 && a.len > 18 && r() < 0.8) {
        const t = 8 + Math.floor(r() * (a.len - 14)), side = r() < 0.5 ? 1 : 3;
        const nd = (a.d + side) % 4;
        arms.push({ d: nd, len: 12 + Math.floor(r() * 14), x: a.x + dx * t + DIRS[nd][0] * 2, z: a.z + dz * t + DIRS[nd][1] * 2, depth: 1 });
      }
    }
    // Lots along roads, alternating sides.
    const types = ['small', 'small', 'big', 'farm', 'small', 'smith', 'library', 'farm', 'big', 'temple', 'pen', 'butcher', 'fletcher', 'bigfarm', 'small', 'big'];
    let ti = 0;
    for (const seg of allRoads) {
      const [dx, dz] = DIRS[seg.d];
      for (let t = 3; t < seg.len - 2; t += 2) {
        for (const side of [1, 3]) {
          if (r() < 0.35) continue;
          const type = r() < 0.55 ? types[ti % types.length] : ['small', 'big', 'farm'][Math.floor(r() * 3)];
          const [W, D] = LOT[type];
          const sd = (seg.d + side) % 4, [sx, sz] = DIRS[sd];
          // Front row sits three blocks off the road centre line; the lot runs W along the road and D away from it.
          const p0x = seg.x0 + dx * t + sx * 3, p0z = seg.z0 + dz * t + sz * 3;
          const p1x = p0x + dx * (W - 1) + sx * (D - 1), p1z = p0z + dz * (W - 1) + sz * (D - 1);
          const x0 = Math.min(p0x, p1x), x1 = Math.max(p0x, p1x), z0 = Math.min(p0z, p1z), z1 = Math.max(p0z, p1z);
          const rect = [x0, z0, x1, z1];
          if (!free(rect)) continue;
          const y = groundOK(x0, z0, x1, z1);
          if (y < 0) continue;
          rects.push(rect);
          lots.push({ type, x0, z0, x1, z1, y, face: (sd + 2) % 4, seed: Math.floor(r() * 4294967296) });
          ti++;
          t += W;
          break;
        }
      }
      for (let t = 6; t < seg.len; t += 11) lamps.push({ x: seg.x0 + dx * t + (dz !== 0 ? 2 : 0), z: seg.z0 + dz * t + (dx !== 0 ? 2 : 0) });
    }
    const plan = { style, roads, lots, lamps, cx: c.x, cz: c.z, cy: flat ? c.y : c.y };
    plans.set(key, plan);
    return plan;
  }

  BUILD.village = (w, c) => {
    const P = planVillage(c), Sty = STYLE[P.style];
    const r = mulberry32(c.seed ^ 0x77);
    const home = [P.cx + 0.5, P.cy + 1, P.cz + 0.5];
    // Roads.
    const path = S('dirt_path'), bridge = S(Sty.slab === 'sandstone_slab' ? 'smooth_sandstone' : Sty.wall);
    for (const seg of P.roads) {
      const [dx, dz] = DIRS[seg.d];
      for (let t = 0; t <= seg.len; t++) for (let k = -1; k <= 1; k++) {
        const x = seg.x0 + dx * t + (dz !== 0 ? k : 0), z = seg.z0 + dz * t + (dx !== 0 ? k : 0);
        if (!w.inside(x, z)) continue;
        const y = flat ? P.cy : landY(x, z);
        if (y < SEA - 1 && !flat) { put(w, x, SEA - 1, z, bridge); for (let yy = SEA; yy < SEA + 3; yy++) put(w, x, yy, z, AIR); continue; }
        put(w, x, y, z, P.style === 'desert' && hash2(x, z, seed) < 0.3 ? S('smooth_sandstone') : path);
        for (let yy = y + 1; yy < y + 4; yy++) { const id = w.get(x, yy, z); if (id === B.PLANT || id === B.FLOWER || id === B.SNOW || id === B.SAPLING || id === B.SWEET_BERRY_BUSH) put(w, x, yy, z, AIR); }
      }
    }
    // Meeting point: a well (or a campfire in snowy/taiga villages).
    {
      const y = P.cy;
      fill(w, P.cx - 4, y + 1, P.cz - 4, P.cx + 4, y + 6, P.cz + 4, AIR);
      fill(w, P.cx - 4, y, P.cz - 4, P.cx + 4, y, P.cz + 4, path);
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) foundation(w, P.cx + dx, y, P.cz + dz, S(Sty.base), 8);
      if (P.style === 'taiga' || P.style === 'snowy') {
        fill(w, P.cx - 1, y, P.cz - 1, P.cx + 1, y, P.cz + 1, S('cobblestone'));
        put(w, P.cx, y + 1, P.cz, S('campfire'));
      } else {
        const base = S(Sty.base);
        fill(w, P.cx - 2, y - 4, P.cz - 2, P.cx + 2, y + 1, P.cz + 2, base);
        fill(w, P.cx - 1, y - 3, P.cz - 1, P.cx + 1, y + 1, P.cz + 1, [B.WATER, 0]);
        for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) fill(w, P.cx + a, y + 2, P.cz + b, P.cx + a, y + 3, P.cz + b, S(Sty.fence));
        fill(w, P.cx - 2, y + 4, P.cz - 2, P.cx + 2, y + 4, P.cz + 2, slab(Sty.slab === 'sandstone_slab' ? 'sandstone_slab' : 'cobblestone_slab'));
        put(w, P.cx, y + 4, P.cz, S(Sty.base));
      }
    }
    // Lamps.
    for (const l of P.lamps) {
      if (!w.inside(l.x, l.z)) continue;
      const y = flat ? P.cy : landY(l.x, l.z);
      if (y < SEA) continue;
      put(w, l.x, y + 1, l.z, S(Sty.fence)); put(w, l.x, y + 2, l.z, S(Sty.fence));
      put(w, l.x, y + 3, l.z, P.style === 'desert' ? S('glowstone') : S('torch'));
    }
    // Buildings.
    for (const L of P.lots) {
      if (!w.overlaps(L.x0 - 2, L.z0 - 2, L.x1 + 2, L.z1 + 2)) { r(); continue; }
      const lr = mulberry32(L.seed);
      LOTS[L.type](w, L, Sty, lr, P);
      r();
    }
    // Villagers and a golem (each spawns in exactly one chunk).
    const vr = mulberry32(c.seed ^ 0x5eed);
    for (const L of P.lots) {
      const n = L.type === 'big' ? 2 : L.type === 'pen' || L.type === 'farm' || L.type === 'bigfarm' ? 1 : 1;
      for (let i = 0; i < n; i++) {
        let prof = PROF[L.type];
        if (Array.isArray(prof)) prof = prof[Math.floor(vr() * prof.length)];
        if (!prof) prof = vr() < 0.1 ? 'nitwit' : ['farmer', 'shepherd', 'fisherman', 'mason', 'cartographer', 'leatherworker'][Math.floor(vr() * 6)];
        const baby = vr() < 0.18;
        const f = frame(L), [x, z] = f.at(L.x1 - L.x0 > 3 ? 2 : 1, 2);
        w.addEntity({ type: 'villager', x: x + 0.5, y: L.y + 1, z: z + 0.5, data: { profession: baby ? undefined : prof, baby, home } });
      }
    }
    w.addEntity({ type: 'iron_golem', x: P.cx + 5.5, y: P.cy + 1, z: P.cz + 0.5, data: { home } });
    if (P.lots.length > 6) w.addEntity({ type: 'iron_golem', x: P.cx - 4.5, y: P.cy + 1, z: P.cz + 5.5, data: { home } });
    if (P.style === 'plains' || P.style === 'taiga') w.addEntity({ type: 'ocelot', x: P.cx + 0.5, y: P.cy + 1, z: P.cz + 6.5, data: { home } });
  };

  // Clears the lot, lays a floor and foundations.
  function prepLot(w, L, Sty, floorKey, clearH = 9) {
    fill(w, L.x0, L.y + 1, L.z0, L.x1, L.y + clearH, L.z1, AIR);
    for (let z = L.z0; z <= L.z1; z++) for (let x = L.x0; x <= L.x1; x++) {
      if (!w.inside(x, z)) continue;
      put(w, x, L.y, z, S(floorKey));
      foundation(w, x, L.y, z, S(Sty.base), 10);
    }
  }
  // Front step: path in front of the door and cleared headroom.
  function doorstep(w, f, L, u) {
    const [x, z] = f.at(u, -1);
    if (!w.inside(x, z)) return;
    const y = landY(x, z);
    const yy = Math.abs(y - L.y) <= 1 ? L.y : L.y;
    put(w, x, yy, z, S('dirt_path')); foundation(w, x, yy, z, S('dirt'), 6);
    for (let k = 1; k <= 3; k++) put(w, x, yy + k, z, AIR);
  }

  function roof(w, f, W, D, y, Sty) {
    if (Sty.roof === 'flat') {
      f.fill(w, -1, y, -1, W, y, D, S(Sty.wall));
      for (let u = -1; u <= W; u++) for (const v of [-1, D]) f.put(w, u, y + 1, v, slab(Sty.slab));
      for (let v = 0; v < D; v++) for (const u of [-1, W]) f.put(w, u, y + 1, v, slab(Sty.slab));
      return;
    }
    // Gable: ridge along u; stairs rise from the front and back towards the middle.
    const half = Math.ceil(D / 2);
    for (let k = 0; k <= half; k++) {
      const vf = -1 + k, vb = D - k;
      const yy = y + k;
      if (vf > vb) break;
      for (let u = -1; u <= W; u++) {
        if (vf === vb) f.put(w, u, yy, vf, slab(Sty.slab));
        else { f.put(w, u, yy, vf, stairs(Sty.stairs, f.Bk)); f.put(w, u, yy, vb, stairs(Sty.stairs, f.F)); }
      }
      // Gable ends.
      if (vf + 1 <= vb - 1) for (let v = vf + 1; v <= vb - 1; v++) for (const u of [0, W - 1]) f.put(w, u, yy, v, S(Sty.wall));
      if (Sty.snow) for (let u = -1; u <= W; u++) { f.put(w, u, yy + 1, vf, S('snow')); if (vf !== vb) f.put(w, u, yy + 1, vb, S('snow')); }
    }
  }

  // Generic house box with log corners, windows and a door.
  function houseShell(w, L, Sty, W, D, H, r) {
    const f = frame(L), y = L.y;
    for (let v = 0; v < D; v++) for (let u = 0; u < W; u++) {
      const edgeU = u === 0 || u === W - 1, edgeV = v === 0 || v === D - 1;
      if (!edgeU && !edgeV) continue;
      for (let k = 1; k <= H; k++) {
        const corner = edgeU && edgeV;
        f.put(w, u, y + k, v, corner ? (Sty.log.endsWith('_log') ? S(Sty.log) : S(Sty.log)) : k === 1 && Sty.accent && Sty.roof !== 'flat' ? S(Sty.base) : S(Sty.wall));
      }
    }
    // Windows.
    const glass = S('glass_pane');
    for (let u = 2; u < W - 2; u += 2) { f.put(w, u, y + 2, D - 1, glass); if (u !== (W >> 1)) f.put(w, u, y + 2, 0, glass); }
    for (let v = 2; v < D - 2; v += 2) { f.put(w, 0, y + 2, v, glass); f.put(w, W - 1, y + 2, v, glass); }
    // Door.
    const du = W >> 1, [dx, dz] = f.at(du, 0);
    door(w, dx, y + 1, dz, Sty.door, f.Bk);
    doorstep(w, f, L, du);
    // Light inside.
    const [tx, tz] = f.at(du, 1);
    put(w, tx, y + H, tz, S('lantern') && [S('lantern')[0], S('lantern')[1] | 2]);
    void r;
    return f;
  }

  const LOTS = {};
  LOTS.small = (w, L, Sty, r) => {
    prepLot(w, L, Sty, Sty.floor);
    const f = houseShell(w, L, Sty, 5, 5, 3, r);
    roof(w, f, 5, 5, L.y + 4, Sty);
    const [bx, bz] = f.at(1, 3); bed(w, bx, L.y + 1, bz, f.R);
    f.put(w, 3, L.y + 1, 3, r() < 0.5 ? S('crafting_table') : S('barrel'));
    const [cx2, cz2] = f.at(3, 1); put(w, cx2, L.y + 1, cz2, [B.CARPET, COLORS.indexOf(['red', 'white', 'yellow', 'green', 'cyan'][Math.floor(r() * 5)])]);
  };
  LOTS.big = (w, L, Sty, r) => {
    prepLot(w, L, Sty, Sty.floor);
    const f = houseShell(w, L, Sty, 7, 9, 4, r);
    roof(w, f, 7, 9, L.y + 5, Sty);
    // Interior wall with an opening.
    for (let u = 1; u < 6; u++) if (u !== 3) for (let k = 1; k <= 4; k++) f.put(w, u, L.y + k, 4, S(Sty.wall));
    const [b1x, b1z] = f.at(1, 6); bed(w, b1x, L.y + 1, b1z, f.Bk);
    const [b2x, b2z] = f.at(5, 6); bed(w, b2x, L.y + 1, b2z, f.Bk);
    const [cx2, cz2] = f.at(3, 7); chest(w, cx2, L.y + 1, cz2, f.F, r, 'village');
    f.put(w, 1, L.y + 1, 2, S('crafting_table'));
    f.put(w, 5, L.y + 1, 2, S(Sty.fence)); f.put(w, 5, L.y + 2, 2, [B.CARPET, COLORS.indexOf('white')]);
    f.put(w, 5, L.y + 1, 1, stairs(Sty.stairs, f.R));
    f.put(w, 1, L.y + 1, 3, S('bookshelf'));
    const [tx, tz] = f.at(3, 6); put(w, tx, L.y + 4, tz, [S('lantern')[0], S('lantern')[1] | 2]);
  };
  function crops(w, f, L, W, D, r) {
    const kinds = ['wheat', 'wheat', 'carrots', 'potatoes', 'beetroots'];
    const kind = kinds[Math.floor(r() * kinds.length)];
    const cs = S(kind), stages = [8, 4, 4, 4][['wheat', 'carrots', 'potatoes', 'beetroots'].indexOf(kind)] || 8;
    const mid = D >> 1;
    for (let v = 0; v < D; v++) for (let u = 0; u < W; u++) {
      const edge = u === 0 || u === W - 1 || v === 0 || v === D - 1;
      if (edge) { f.put(w, u, L.y, v, logAxis(Sty(L).log, 0)); continue; }
      if (v === mid) { f.put(w, u, L.y, v, [B.WATER, 0]); continue; }
      f.put(w, u, L.y, v, S('farmland_moist'));
      const age = Math.floor(hash3(u, v, L.seed, 1) * stages);
      f.put(w, u, L.y + 1, v, [cs[0], cs[1] | (age << CROP_AGE_SHIFT)]);
    }
  }
  const Sty = L => L._sty;
  LOTS.farm = (w, L, St, r) => {
    L._sty = St;
    fill(w, L.x0, L.y + 1, L.z0, L.x1, L.y + 5, L.z1, AIR);
    for (let z = L.z0; z <= L.z1; z++) for (let x = L.x0; x <= L.x1; x++) if (w.inside(x, z)) foundation(w, x, L.y, z, S('dirt'), 8);
    crops(w, frame(L), L, 9, 7, r);
    const f = frame(L); f.put(w, 0, L.y + 1, 0, S('hay_block'));
  };
  LOTS.bigfarm = (w, L, St, r) => {
    L._sty = St;
    fill(w, L.x0, L.y + 1, L.z0, L.x1, L.y + 5, L.z1, AIR);
    for (let z = L.z0; z <= L.z1; z++) for (let x = L.x0; x <= L.x1; x++) if (w.inside(x, z)) foundation(w, x, L.y, z, S('dirt'), 8);
    const f = frame(L);
    const left = { ...L, seed: L.seed ^ 1 }, right = { ...L, seed: L.seed ^ 2 };
    left._sty = St; right._sty = St;
    const fl = frame({ ...L, ...(L.face === 0 || L.face === 2 ? {} : {}) });
    void fl;
    // Two plots side by side.
    const sub = (u0, W, seedX) => {
      const kinds = ['wheat', 'carrots', 'potatoes', 'beetroots'];
      const kind = kinds[Math.floor(hash2(L.seed, seedX, 5) * 4)], cs = S(kind), stages = [8, 4, 4, 4][kinds.indexOf(kind)];
      for (let v = 0; v < 9; v++) for (let u = u0; u < u0 + W; u++) {
        const edge = u === u0 || u === u0 + W - 1 || v === 0 || v === 8;
        if (edge) { f.put(w, u, L.y, v, logAxis(St.log, 0)); continue; }
        if (v === 4) { f.put(w, u, L.y, v, [B.WATER, 0]); continue; }
        f.put(w, u, L.y, v, S('farmland_moist'));
        f.put(w, u, L.y + 1, v, [cs[0], cs[1] | (Math.floor(hash3(u, v, L.seed, 2) * stages) << CROP_AGE_SHIFT)]);
      }
    };
    sub(0, 7, 1); sub(6, 7, 2);
    f.put(w, 6, L.y + 1, 0, S('hay_block'));
    void r;
  };
  LOTS.smith = (w, L, St, r) => {
    prepLot(w, L, St, 'cobblestone');
    const f = frame(L), y = L.y;
    // Half-open workshop: low walls, posts and a slab roof.
    for (let v = 0; v < 7; v++) for (let u = 0; u < 9; u++) {
      const edge = u === 0 || u === 8 || v === 6;
      if (!edge) continue;
      f.put(w, u, y + 1, v, S('cobblestone'));
      if ((u === 0 || u === 8) && (v === 0 || v === 6 || v === 3)) for (let k = 2; k <= 4; k++) f.put(w, u, y + k, v, S(St.log));
      else if (v === 6) for (let k = 2; k <= 4; k++) f.put(w, u, y + k, v, S(St.wall));
    }
    f.fill(w, -1, y + 5, -1, 9, y + 5, 7, slab(St.slab));
    const fr = f.at(1, 5), fr2 = f.at(2, 5);
    put(w, fr[0], y + 1, fr[1], [B.FURNACE, S('furnace')[1] | (f.F << 1)]);
    put(w, fr2[0], y + 1, fr2[1], [B.FURNACE, S('furnace')[1] | (f.F << 1)]);
    const [cx2, cz2] = f.at(7, 5); chest(w, cx2, y + 1, cz2, f.F, r, 'smith');
    f.put(w, 6, y + 1, 5, S('crafting_table'));
    // Lava forge set into the floor, fenced off.
    f.put(w, 4, y, 4, S('lava')); f.put(w, 4, y - 1, 4, S('cobblestone'));
    for (const [a, b] of [[3, 4], [5, 4], [4, 3]]) f.put(w, a, y + 1, b, S('iron_bars'));
    const [tx, tz] = f.at(4, 1); put(w, tx, y + 4, tz, [S('lantern')[0], S('lantern')[1] | 2]);
    f.put(w, 7, y + 1, 1, S('iron_block'));
  };
  LOTS.library = (w, L, St, r) => {
    prepLot(w, L, St, St.floor);
    const f = houseShell(w, L, St, 9, 7, 4, r);
    roof(w, f, 9, 7, L.y + 5, St);
    for (let u = 1; u < 8; u++) for (const k of [1, 2]) f.put(w, u, L.y + k, 5, S('bookshelf'));
    for (let v = 2; v < 5; v++) for (const k of [1, 2]) { f.put(w, 1, L.y + k, v, S('bookshelf')); f.put(w, 7, L.y + k, v, S('bookshelf')); }
    const [cx2, cz2] = f.at(4, 4); chest(w, cx2, L.y + 1, cz2, f.F, r, 'library');
    f.put(w, 3, L.y + 1, 3, S('crafting_table'));
    f.put(w, 5, L.y + 1, 3, [B.CARPET, COLORS.indexOf('red')]);
  };
  LOTS.temple = (w, L, St, r) => {
    prepLot(w, L, St, 'cobblestone', 14);
    const T = { ...St, wall: St.roof === 'flat' ? 'cut_sandstone' : 'cobblestone', log: St.roof === 'flat' ? 'chiseled_sandstone' : 'stone_bricks' };
    const f = houseShell(w, L, T, 7, 11, 5, r);
    // Tower over the back third.
    for (let v = 7; v < 11; v++) for (let u = 1; u < 6; u++) {
      const edge = u === 1 || u === 5 || v === 7 || v === 10;
      for (let k = 6; k <= 12; k++) f.put(w, u, L.y + k, v, edge ? S(T.wall) : AIR);
    }
    for (const v of [8, 9]) for (const u of [1, 5]) f.put(w, u, L.y + 10, v, S('glass_pane'));
    for (const u of [2, 3, 4]) { f.put(w, u, L.y + 10, 7, S('glass_pane')); f.put(w, u, L.y + 10, 10, S('glass_pane')); }
    f.fill(w, 1, L.y + 13, 7, 5, L.y + 13, 10, slab(St.roof === 'flat' ? 'sandstone_slab' : 'stone_brick_slab'));
    f.fill(w, 0, L.y + 6, 0, 6, L.y + 6, 6, S(T.wall));
    for (let k = 1; k <= 12; k++) f.put(w, 3, L.y + k, 9, [B.LADDER, f.Bk]);
    f.put(w, 3, L.y + 5, 9, [B.LADDER, f.Bk]); f.put(w, 3, L.y + 6, 9, [B.LADDER, f.Bk]);
    f.put(w, 3, L.y + 1, 6, S('red_carpet') || [B.CARPET, 14]);
    f.put(w, 2, L.y + 1, 7, S('crafting_table'));
    const [tx, tz] = f.at(3, 3); put(w, tx, L.y + 5, tz, [S('lantern')[0], S('lantern')[1] | 2]);
    for (const [u, v] of [[1, 2], [5, 2], [1, 5], [5, 5]]) f.put(w, u, L.y + 3, v, wallTorch(u === 1 ? f.Lf : f.R));
  };
  LOTS.pen = (w, L, St, r) => {
    fill(w, L.x0, L.y + 1, L.z0, L.x1, L.y + 5, L.z1, AIR);
    const f = frame(L);
    for (let v = 0; v < 9; v++) for (let u = 0; u < 9; u++) {
      f.put(w, u, L.y, v, S(St.roof === 'flat' ? 'sand' : 'grass_block'));
      const [x, z] = f.at(u, v); if (w.inside(x, z)) foundation(w, x, L.y, z, S('dirt'), 8);
      const edge = u === 0 || u === 8 || v === 0 || v === 8;
      if (edge && !(v === 0 && u === 4)) f.put(w, u, L.y + 1, v, S(St.fence));
    }
    f.put(w, 7, L.y + 1, 7, S('hay_block')); f.put(w, 7, L.y + 1, 6, S('hay_block')); f.put(w, 6, L.y + 1, 7, S('hay_block'));
    const animal = ['sheep', 'cow', 'pig', 'chicken'][Math.floor(r() * 4)];
    for (let i = 0; i < 3; i++) { const [x, z] = f.at(2 + i * 2, 4); w.addEntity({ type: animal, x: x + 0.5, y: L.y + 1, z: z + 0.5 }); }
  };
  LOTS.butcher = (w, L, St, r) => {
    prepLot(w, L, St, 'smooth_stone');
    const f = houseShell(w, L, St, 7, 7, 3, r);
    roof(w, f, 7, 7, L.y + 4, St);
    const [fx, fz] = f.at(1, 5); put(w, fx, L.y + 1, fz, [B.FURNACE, S('furnace')[1] | (f.F << 1)]);
    const [cx2, cz2] = f.at(5, 5); chest(w, cx2, L.y + 1, cz2, f.F, r, 'village');
    f.put(w, 3, L.y + 1, 5, S('crafting_table'));
  };
  LOTS.fletcher = (w, L, St, r) => {
    prepLot(w, L, St, St.floor);
    const f = houseShell(w, L, St, 7, 7, 3, r);
    roof(w, f, 7, 7, L.y + 4, St);
    f.put(w, 1, L.y + 1, 5, S('crafting_table')); f.put(w, 2, L.y + 1, 5, S('barrel'));
    const [bx, bz] = f.at(4, 4); bed(w, bx, L.y + 1, bz, f.R);
  };

  // ---------------- pillager outpost ----------------
  BUILD.pillager_outpost = (w, c) => {
    const r = mulberry32(c.seed), y = c.y;
    const log = S('dark_oak_log'), wall = S('birch_planks'), floor = S('dark_oak_planks');
    fill(w, c.x - 5, y + 1, c.z - 5, c.x + 5, y + 24, c.z + 5, AIR);
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) { put(w, c.x + dx, y, c.z + dz, S('cobblestone')); foundation(w, c.x + dx, y, c.z + dz, S('cobblestone'), 10); }
    for (let k = 1; k <= 19; k++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3, corner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
      if (!edge) { if (k % 5 === 0 && !(dx === 2 && dz === 2)) put(w, c.x + dx, y + k, c.z + dz, floor); continue; }
      if (corner) put(w, c.x + dx, y + k, c.z + dz, log);
      else if (k % 5 === 2 && (dx === 0 || dz === 0)) put(w, c.x + dx, y + k, c.z + dz, S('glass_pane') && [B.AIR, 0]);
      else put(w, c.x + dx, y + k, c.z + dz, k % 5 === 0 ? floor : wall);
    }
    for (let k = 1; k <= 20; k++) put(w, c.x + 2, y + k, c.z + 2, [B.LADDER, 3]);
    put(w, c.x, y + 1, c.z - 3, AIR); put(w, c.x, y + 2, c.z - 3, AIR);
    // Top deck with fences and overhang.
    fill(w, c.x - 4, y + 20, c.z - 4, c.x + 4, y + 20, c.z + 4, floor);
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (Math.abs(dx) === 4 || Math.abs(dz) === 4) put(w, c.x + dx, y + 21, c.z + dz, S('dark_oak_fence'));
    put(w, c.x + 2, y + 21, c.z + 2, AIR);
    for (const [a, b] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { put(w, c.x + a, y + 22, c.z + b, S('dark_oak_fence')); put(w, c.x + a, y + 23, c.z + b, S('torch')); }
    fill(w, c.x - 4, y + 24, c.z - 4, c.x + 4, y + 24, c.z + 4, slab('dark_oak_slab'));
    chest(w, c.x - 2, y + 21, c.z - 2, 0, r, 'outpost');
    // A caged golem next to the tower.
    if (r() < 0.6) {
      const gx = c.x + 9, gz = c.z;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const yy = landY(gx + dx, gz + dz);
        if (w.inside(gx + dx, gz + dz)) { fill(w, gx + dx, yy + 1, gz + dz, gx + dx, yy + 5, gz + dz, AIR); }
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) for (let k = 1; k <= 3; k++) put(w, gx + dx, c.y + k, gz + dz, S('dark_oak_fence'));
        put(w, gx + dx, c.y, gz + dz, S('dark_oak_planks')); foundation(w, gx + dx, c.y, gz + dz, S('cobblestone'), 8);
        put(w, gx + dx, c.y + 4, gz + dz, slab('dark_oak_slab'));
      }
      w.addEntity({ type: 'iron_golem', x: gx + 0.5, y: c.y + 1, z: gz + 0.5 });
    }
    for (let i = 0; i < 4; i++) w.addEntity({ type: 'pillager', x: c.x - 6.5 + r() * 13, y: y + 1, z: c.z - 7.5, data: { persistent: true } });
    w.addEntity({ type: 'pillager', x: c.x + 0.5, y: y + 21, z: c.z + 0.5 });
    if (r() < 0.5) w.addEntity({ type: 'vindicator', x: c.x + 6.5, y: y + 1, z: c.z + 6.5 });
  };

  // ---------------- desert pyramid ----------------
  BUILD.desert_pyramid = (w, c) => {
    const r = mulberry32(c.seed), y = c.y, ss = S('sandstone'), cut = S('cut_sandstone'), orange = S('orange_terracotta'), blue = S('blue_terracotta');
    for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) foundation(w, c.x + dx, y, c.z + dz, ss, 12);
    fill(w, c.x - 10, y, c.z - 10, c.x + 10, y, c.z + 10, ss);
    fill(w, c.x - 9, y + 1, c.z - 9, c.x + 9, y + 12, c.z + 9, AIR);
    for (let k = 0; k <= 10; k++) {
      const s = 10 - k;
      for (let dz = -s; dz <= s; dz++) for (let dx = -s; dx <= s; dx++) {
        if (Math.abs(dx) !== s && Math.abs(dz) !== s && k !== 10) continue;
        put(w, c.x + dx, y + 1 + k, c.z + dz, (k === 3 || k === 7) ? cut : ss);
      }
    }
    // Hollow hall inside.
    fill(w, c.x - 5, y + 1, c.z - 5, c.x + 5, y + 4, c.z + 5, AIR);
    // Entrance and corner towers.
    fill(w, c.x - 1, y + 1, c.z - 10, c.x + 1, y + 3, c.z - 6, AIR);
    for (const [tx, tz] of [[-8, -8], [8, -8]]) {
      for (let k = 1; k <= 14; k++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        put(w, c.x + tx + dx, y + k, c.z + tz + dz, edge ? (k % 4 === 2 ? orange : k === 14 ? cut : ss) : AIR);
      }
      put(w, c.x + tx, y + 10, c.z + tz - 2, AIR); put(w, c.x + tx, y + 11, c.z + tz - 2, AIR);
    }
    // Terracotta star on the hall floor.
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) put(w, c.x + dx, y, c.z + dz, (dx === 0 && dz === 0) ? blue : (Math.abs(dx) === Math.abs(dz) || dx === 0 || dz === 0) ? orange : ss);
    // Hidden treasure room below.
    const ty = y - 12;
    shell(w, c.x - 5, ty - 1, c.z - 5, c.x + 5, ty + 4, c.z + 5, cut, seed);
    put(w, c.x, y, c.z, AIR);
    for (let yy = ty + 4; yy < y; yy++) put(w, c.x, yy, c.z, AIR);
    for (let yy = ty; yy < y; yy++) { put(w, c.x, yy, c.z, [B.LADDER, 3]); if (yy >= ty + 4) put(w, c.x + 1, yy, c.z, cut); }
    put(w, c.x, ty - 1, c.z, blue);
    for (const d of [0, 1, 2, 3]) { const [dx, dz] = DIRS[d]; chest(w, c.x + dx * 4, ty, c.z + dz * 4, (d + 2) % 4, r, 'pyramid'); }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(w, c.x + dx, ty - 2, c.z + dz, S('tnt'));
    for (const [a, b] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) put(w, c.x + a, ty + 2, c.z + b, S('torch'));
    w.addEntity({ type: 'husk', x: c.x + 3.5, y: ty, z: c.z - 2.5 });
  };

  // ---------------- igloo ----------------
  BUILD.igloo = (w, c) => {
    const r = mulberry32(c.seed), y = c.y;
    const snow = S('snow_block'), ice = S('ice');
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      foundation(w, c.x + dx, y, c.z + dz, snow, 8);
      for (let k = 0; k <= 5; k++) {
        const d = Math.hypot(dx, k * 1.25, dz);
        if (d > 5.2) continue;
        put(w, c.x + dx, y + k, c.z + dz, k === 0 ? snow : d > 4.1 ? ((k === 2 && (dx === 0 || dz === 0) && Math.abs(dx + dz) > 3) ? ice : snow) : AIR);
      }
    }
    // Entrance tunnel facing -z.
    for (let t = 5; t <= 7; t++) for (let dx = -1; dx <= 1; dx++) for (let k = 0; k <= 3; k++) put(w, c.x + dx, y + k, c.z - t, (Math.abs(dx) === 1 || k === 3 || k === 0) ? snow : AIR);
    put(w, c.x, y + 1, c.z - 4, AIR); put(w, c.x, y + 2, c.z - 4, AIR); put(w, c.x, y + 1, c.z - 5, AIR); put(w, c.x, y + 2, c.z - 5, AIR);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dz) < 3.6) put(w, c.x + dx, y + 1, c.z + dz, [B.CARPET, COLORS.indexOf('white')]);
    bed(w, c.x + 2, y + 1, c.z + 1, 0);
    put(w, c.x - 2, y + 1, c.z + 2, [B.FURNACE, S('furnace')[1] | (3 << 1)]);
    put(w, c.x - 3, y + 1, c.z, S('crafting_table'));
    put(w, c.x, y + 3, c.z + 3, wallTorch(0));
    if (r() < 0.6) {
      // Basement.
      put(w, c.x, y, c.z, [B.TRAPDOOR, S('oak_trapdoor')[1]]);
      put(w, c.x, y + 1, c.z, AIR);
      const by = y - 10;
      for (let yy = by + 1; yy < y; yy++) { put(w, c.x, yy, c.z, AIR); put(w, c.x, yy, c.z + 1, S('stone_bricks')); put(w, c.x, yy, c.z, [B.LADDER, 0]); put(w, c.x - 1, yy, c.z, S('stone_bricks')); put(w, c.x + 1, yy, c.z, S('stone_bricks')); put(w, c.x, yy, c.z - 1, S('stone_bricks')); }
      shell(w, c.x - 3, by - 1, c.z - 8, c.x + 3, by + 3, c.z + 1, (x, yy, z) => brickMix(x, yy, z, seed), seed);
      put(w, c.x, by, c.z, [B.LADDER, 0]);
      chest(w, c.x + 2, by, c.z - 1, 1, r, 'igloo');
      put(w, c.x - 2, by, c.z - 1, S('crafting_table'));
      put(w, c.x - 2, by + 2, c.z, wallTorch(0));
      // Two cells behind iron bars.
      for (const cxo of [-2, 2]) {
        for (let k = 0; k < 3; k++) { put(w, c.x + cxo - 1, by + k, c.z - 5, S('iron_bars')); put(w, c.x + cxo, by + k, c.z - 5, S('iron_bars')); put(w, c.x + cxo + 1, by + k, c.z - 5, S('iron_bars')); }
      }
      for (let k = 0; k < 3; k++) put(w, c.x, by + k, c.z - 6, S('stone_bricks')), put(w, c.x, by + k, c.z - 7, S('stone_bricks'));
      w.addEntity({ type: 'villager', x: c.x - 1.5, y: by, z: c.z - 6.5, data: { profession: 'cleric' } });
      w.addEntity({ type: 'zombie_villager', x: c.x + 2.5, y: by, z: c.z - 6.5, data: { persistent: true } });
    }
  };

  // ---------------- swamp hut ----------------
  BUILD.swamp_hut = (w, c) => {
    const r = mulberry32(c.seed), y = c.y + 3, pl = S('spruce_planks');
    for (const [a, b] of [[-2, -3], [2, -3], [-2, 3], [2, 3]]) { for (let k = 0; k < 3; k++) put(w, c.x + a, c.y + 1 + k - 1, c.z + b, S('oak_log')); foundation(w, c.x + a, c.y, c.z + b, S('oak_log'), 10); }
    fill(w, c.x - 3, y, c.z - 4, c.x + 3, y, c.z + 4, pl);
    fill(w, c.x - 3, y + 1, c.z - 4, c.x + 3, y + 5, c.z + 4, AIR);
    for (let dz = -3; dz <= 4; dz++) for (let dx = -2; dx <= 2; dx++) {
      const edge = Math.abs(dx) === 2 || dz === -3 || dz === 4;
      if (!edge) continue;
      for (let k = 1; k <= 3; k++) put(w, c.x + dx, y + k, c.z + dz, (Math.abs(dx) === 2 && (dz === -3 || dz === 4)) ? S('oak_log') : pl);
    }
    put(w, c.x, y + 1, c.z - 3, AIR); put(w, c.x, y + 2, c.z - 3, AIR);
    put(w, c.x - 2, y + 2, c.z, S('glass_pane') && [B.AIR, 0]); put(w, c.x + 2, y + 2, c.z, [B.AIR, 0]);
    for (let dz = -4; dz <= 5; dz++) { put(w, c.x - 3, y + 4, c.z + dz, stairs('spruce_stairs', 3)); put(w, c.x + 3, y + 4, c.z + dz, stairs('spruce_stairs', 1)); for (let dx = -2; dx <= 2; dx++) put(w, c.x + dx, y + 4, c.z + dz, pl); }
    for (let dx = -1; dx <= 1; dx++) put(w, c.x + dx, y + 1, c.z - 4, [B.FENCE, S('oak_fence')[1]]);
    put(w, c.x + 1, y + 1, c.z + 3, S('crafting_table'));
    chest(w, c.x - 1, y + 1, c.z + 3, 2, r, 'swamp_hut');
    put(w, c.x - 1, y + 1, c.z + 1, S('brown_mushroom'));
    w.addEntity({ type: 'witch', x: c.x + 0.5, y: y + 1, z: c.z + 0.5, data: { persistent: true } });
  };

  // ---------------- ruined portal ----------------
  BUILD.ruined_portal = (w, c) => {
    const r = mulberry32(c.seed), y = c.y, axisX = r() < 0.5, lean = r() < 0.3;
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      const d = Math.hypot(dx, dz), h = hash2(c.x + dx, c.z + dz, seed ^ 0x9e7);
      if (d > 5 - h * 2) continue;
      put(w, c.x + dx, y, c.z + dz, h < 0.12 ? S('magma_block') : h < 0.55 ? S('netherrack') : h < 0.7 ? S('blackstone') : S('stone'));
      if (h > 0.93) put(w, c.x + dx, y + 1, c.z + dz, S('fire'));
    }
    const obs = S('obsidian'), cry = S('crying_obsidian');
    for (let a = -1; a <= 2; a++) for (let k = 0; k <= 4; k++) {
      const edge = a === -1 || a === 2 || k === 0 || k === 4;
      if (!edge) continue;
      const h = hash3(c.x + a, y + k, c.z, seed ^ 0x6e7);
      if (h < 0.28) continue;
      const x = axisX ? c.x + a : c.x, z = axisX ? c.z : c.z + a;
      const yy = lean && k > 2 ? y + k - 1 : y + k;
      put(w, x + (lean && k > 2 ? 1 : 0), yy + 1, z, h < 0.4 ? cry : obs);
    }
    put(w, c.x + (axisX ? 0 : 3), y + 1, c.z + (axisX ? 3 : 0), S('gold_block'));
    chest(w, c.x + (axisX ? 2 : -3), y + 1, c.z + (axisX ? -3 : 2), 0, r, 'ruined_portal');
  };

  // ---------------- dungeon ----------------
  BUILD.dungeon = (w, c) => {
    const r = mulberry32(c.seed), y = c.y, R = 3 + (r() < 0.5 ? 1 : 0);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) for (let k = -1; k <= 4; k++) {
      const edge = Math.abs(dx) === R || Math.abs(dz) === R || k === -1 || k === 4;
      const x = c.x + dx, z = c.z + dz, yy = y + k;
      if (!edge) { put(w, x, yy, z, AIR); continue; }
      const cur = w.get(x, yy, z);
      if (cur === B.AIR && k >= 0 && k <= 2) continue; // leave openings where caves cross
      put(w, x, yy, z, k === -1 && hash3(x, yy, z, seed) < 0.6 ? S('mossy_cobblestone') : S('cobblestone'));
    }
    const mob = ['zombie', 'zombie', 'skeleton', 'spider'][Math.floor(r() * 4)];
    spawner(w, c.x, y, c.z, mob);
    const n = 1 + (r() < 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const d = Math.floor(r() * 4), [dx, dz] = DIRS[d], off = Math.floor(r() * (2 * R - 1)) - (R - 1);
      const x = c.x + dx * (R - 1) + (dz !== 0 ? off : 0), z = c.z + dz * (R - 1) + (dx !== 0 ? off : 0);
      chest(w, x, y, z, (d + 2) % 4, r, 'dungeon');
    }
  };

  // ---------------- mineshaft ----------------
  function planMineshaft(c) {
    const key = 'm' + c.x + ',' + c.z;
    if (plans.has(key)) return plans.get(key);
    const r = mulberry32(c.seed), segs = [], rooms = [{ x: c.x, y: c.y, z: c.z, r: 5 + Math.floor(r() * 3) }];
    const grow = (x, y, z, d, depth) => {
      if (depth > 5 || segs.length > 40) return;
      const len = 12 + Math.floor(r() * 7) * 4;
      const [dx, dz] = DIRS[d];
      const ex = x + dx * len, ez = z + dz * len;
      if (Math.hypot(ex - c.x, ez - c.z) > 88) return;
      const dy = r() < 0.15 ? (r() < 0.5 ? -4 : 4) : 0;
      segs.push({ x, y, z, d, len, dy, seed: Math.floor(r() * 1e9) });
      const ny = clamp(y + dy, 10, 50);
      const k = r();
      if (k < 0.45) { for (const nd of [(d + 1) % 4, (d + 3) % 4]) if (r() < 0.7) grow(ex + DIRS[nd][0] * 2, ny, ez + DIRS[nd][1] * 2, nd, depth + 1); grow(ex + dx, ny, ez + dz, d, depth + 1); }
      else if (k < 0.8) grow(ex + dx, ny, ez + dz, d, depth + 1);
      else { const nd = (d + (r() < 0.5 ? 1 : 3)) % 4; grow(ex + DIRS[nd][0] * 2, ny, ez + DIRS[nd][1] * 2, nd, depth + 1); }
    };
    const R0 = rooms[0].r;
    for (let d = 0; d < 4; d++) if (r() < 0.8) grow(c.x + DIRS[d][0] * (R0 + 1), c.y, c.z + DIRS[d][1] * (R0 + 1), d, 0);
    const plan = { segs, rooms };
    plans.set(key, plan);
    return plan;
  }
  BUILD.mineshaft = (w, c) => {
    const P = planMineshaft(c);
    const planks = S('oak_planks'), fence = S('oak_fence');
    for (const rm of P.rooms) {
      fill(w, rm.x - rm.r, rm.y, rm.z - rm.r, rm.x + rm.r, rm.y + 4, rm.z + rm.r, AIR);
      fill(w, rm.x - rm.r, rm.y - 1, rm.z - rm.r, rm.x + rm.r, rm.y - 1, rm.z + rm.r, S('dirt'));
    }
    for (const s of P.segs) {
      const [dx, dz] = DIRS[s.d], px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0;
      const sr = mulberry32(s.seed);
      const chestAt = sr() < 0.35 ? 2 + Math.floor(sr() * (s.len - 4)) : -1;
      const spiderAt = sr() < 0.08 ? 3 + Math.floor(sr() * (s.len - 6)) : -1;
      const x1 = s.x + dx * s.len, z1 = s.z + dz * s.len;
      if (!w.overlaps(Math.min(s.x, x1) - 2, Math.min(s.z, z1) - 2, Math.max(s.x, x1) + 2, Math.max(s.z, z1) + 2)) continue;
      for (let t = 0; t <= s.len; t++) {
        const y = s.y + Math.round(s.dy * t / s.len);
        const cx2 = s.x + dx * t, cz2 = s.z + dz * t;
        for (let k = -1; k <= 1; k++) {
          const x = cx2 + px * k, z = cz2 + pz * k;
          if (!w.inside(x, z)) continue;
          for (let yy = y; yy <= y + 2; yy++) { const id = w.get(x, yy, z); if (id !== B.WATER && id !== B.LAVA) put(w, x, yy, z, AIR); }
          const below = w.get(x, y - 1, z);
          if (below === B.AIR || below === B.WATER || below === B.LAVA) put(w, x, y - 1, z, planks);
          const h = hash3(x, y, z, seed ^ 0x3c3);
          if ((k !== 0 || t % 4 !== 0) && h < 0.05) put(w, x, y + 2, z, S('cobweb'));
        }
        if (t % 4 === 0) {
          for (const k of [-1, 1]) { const x = cx2 + px * k, z = cz2 + pz * k; put(w, x, y, z, fence); put(w, x, y + 1, z, fence); }
          for (let k = -1; k <= 1; k++) put(w, cx2 + px * k, y + 2, cz2 + pz * k, planks);
        } else if (hash2(cx2, cz2, seed ^ 0x11) < 0.6 && s.dy === 0) put(w, cx2, y, cz2, [B.RAIL, dx !== 0 ? 1 : 0]);
        if (t === chestAt) { const x = cx2 + px, z = cz2 + pz; if (w.inside(x, z)) chest(w, x, y, z, (s.d + (px ? 1 : 3)) % 4, sr, 'mineshaft'); else sr(); }
        if (t === spiderAt) {
          spawner(w, cx2, y, cz2, 'cave_spider');
          for (let k = 0; k < 14; k++) { const x = cx2 + Math.floor(hash3(k, t, s.seed, 1) * 7) - 3, yy = y + Math.floor(hash3(k, t, s.seed, 2) * 3), z = cz2 + Math.floor(hash3(k, t, s.seed, 3) * 7) - 3; if (w.get(x, yy, z) === B.AIR) put(w, x, yy, z, S('cobweb')); }
        }
      }
      // Torches on some supports.
      for (let t = 2; t < s.len; t += 8) { const x = s.x + dx * t + px, z = s.z + dz * t + pz, y = s.y + Math.round(s.dy * t / s.len); if (w.get(x, y + 1, z) === B.AIR && SOLIDISH(w.get(x + px, y + 1, z + pz)) && hash2(x, z, seed ^ 0x8) < 0.6) put(w, x, y + 1, z, wallTorch(dirOf(px, pz))); }
    }
  };

  // ---------------- stronghold ----------------
  function planStronghold(c) {
    const key = 's' + c.x + ',' + c.z;
    if (plans.has(key)) return plans.get(key);
    const r = mulberry32(c.seed), rooms = [], corridors = [];
    rooms.push({ kind: 'hub', x: c.x, y: c.y, z: c.z, hw: 5, hd: 5, h: 7, d: 0 });
    const order = ['portal', 'library', 'prison', 'store'];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d], len = 14 + Math.floor(r() * 14);
      const sx = c.x + dx * 6, sz = c.z + dz * 6;
      corridors.push({ x: sx, y: c.y, z: sz, d, len });
      const kind = order[d];
      const dims = kind === 'portal' ? [5, 8, 8] : kind === 'library' ? [7, 6, 9] : [4, 4, 5];
      const ox = sx + dx * (len + dims[1] + 1), oz = sz + dz * (len + dims[1] + 1);
      rooms.push({ kind, x: ox, y: c.y, z: oz, hw: dims[0], hd: dims[1], h: dims[2], d });
      if (kind === 'store' || kind === 'prison') {
        const nd = (d + 1) % 4, l2 = 10 + Math.floor(r() * 8);
        const bx = sx + dx * Math.floor(len / 2), bz = sz + dz * Math.floor(len / 2);
        corridors.push({ x: bx + DIRS[nd][0] * 2, y: c.y, z: bz + DIRS[nd][1] * 2, d: nd, len: l2 });
        rooms.push({ kind: 'chestroom', x: bx + DIRS[nd][0] * (l2 + 6), y: c.y, z: bz + DIRS[nd][1] * (l2 + 6), hw: 3, hd: 3, h: 5, d: nd });
      }
    }
    const plan = { rooms, corridors, seed: c.seed };
    plans.set(key, plan);
    return plan;
  }
  BUILD.stronghold = (w, c) => {
    const P = planStronghold(c);
    const mix = (x, y, z) => brickMix(x, y, z, seed);
    for (const k of P.corridors) {
      const [dx, dz] = DIRS[k.d], px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0;
      const ex = k.x + dx * k.len, ez = k.z + dz * k.len;
      if (!w.overlaps(Math.min(k.x, ex) - 3, Math.min(k.z, ez) - 3, Math.max(k.x, ex) + 3, Math.max(k.z, ez) + 3)) continue;
      for (let t = 0; t <= k.len; t++) {
        const cx2 = k.x + dx * t, cz2 = k.z + dz * t;
        for (let a = -2; a <= 2; a++) for (let yy = k.y - 1; yy <= k.y + 3; yy++) {
          const x = cx2 + px * a, z = cz2 + pz * a;
          const edge = Math.abs(a) === 2 || yy === k.y - 1 || yy === k.y + 3;
          put(w, x, yy, z, edge ? mix(x, yy, z) : AIR);
        }
        if (t % 9 === 4) put(w, cx2 + px * 1, k.y + 1, cz2 + pz * 1, wallTorch(dirOf(px, pz)));
      }
    }
    const r = mulberry32(P.seed ^ 0x51);
    for (const rm of P.rooms) {
      const [dx, dz] = DIRS[rm.d];
      const along = dx !== 0; // room depth runs along x
      const hx = along ? rm.hd : rm.hw, hz = along ? rm.hw : rm.hd;
      if (!w.overlaps(rm.x - hx - 1, rm.z - hz - 1, rm.x + hx + 1, rm.z + hz + 1)) { r(); r(); r(); r(); continue; }
      shell(w, rm.x - hx, rm.y - 1, rm.z - hz, rm.x + hx, rm.y + rm.h, rm.z + hz, mix, seed);
      // Doorway facing back along the corridor.
      if (rm.kind !== 'hub') { const bx = rm.x - dx * (along ? hx : 0), bz = rm.z - dz * (along ? 0 : hz); for (let a = -1; a <= 1; a++) for (let yy = rm.y; yy <= rm.y + 2; yy++) put(w, bx + (along ? 0 : a), yy, bz + (along ? a : 0), AIR); }
      else for (let d = 0; d < 4; d++) { const [ex, ez] = DIRS[d]; for (let a = -1; a <= 1; a++) for (let yy = rm.y; yy <= rm.y + 2; yy++) put(w, rm.x + ex * 5 + (ez !== 0 ? a : 0), yy, rm.z + ez * 5 + (ex !== 0 ? a : 0), AIR); }
      if (rm.kind === 'hub') {
        for (let yy = rm.y; yy < rm.y + rm.h; yy++) put(w, rm.x, yy, rm.z, S('chiseled_stone_bricks'));
        for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) put(w, rm.x + a, rm.y, rm.z + b, slab('stone_brick_slab'));
        for (const [a, b] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { put(w, rm.x + a, rm.y, rm.z + b, mix(rm.x + a, rm.y, rm.z + b)); put(w, rm.x + a, rm.y + 1, rm.z + b, mix(rm.x + a, rm.y + 1, rm.z + b)); put(w, rm.x + a, rm.y + 2, rm.z + b, S('torch')); }
        r(); r(); r(); r();
      } else if (rm.kind === 'portal') {
        // Portal on a raised dais at the far end, over a lava pool; stairs lead up.
        const fx = rm.x + dx * 3, fz = rm.z + dz * 3, py = rm.y + 3;
        for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let yy = rm.y; yy < py; yy++) put(w, fx + a, yy, fz + b, mix(fx + a, yy, fz + b));
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { put(w, fx + a, py - 1, fz + b, S('lava')); put(w, fx + a, py, fz + b, AIR); }
        const ring = [];
        for (let i = -1; i <= 1; i++) ring.push([i, -2, 0], [i, 2, 2], [-2, i, 3], [2, i, 1]);
        for (const [a, b, face] of ring) {
          const eye = hash3(fx + a, py, fz + b, P.seed) < 0.1 ? 4 : 0;
          put(w, fx + a, py, fz + b, [B.END_PORTAL_FRAME, face | eye]);
        }
        for (let s = 1; s <= 3; s++) for (let a = -1; a <= 1; a++) {
          const x = fx - dx * (3 + s) + (along ? 0 : a), z = fz - dz * (3 + s) + (along ? a : 0);
          put(w, x, rm.y + 3 - s, z, stairs('stone_brick_stairs', rm.d));
          for (let yy = rm.y + 4 - s; yy < py + 3; yy++) put(w, x, yy, z, AIR);
        }
        spawner(w, fx - dx * 3, py, fz - dz * 3, 'silverfish');
        for (const [a, b] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) put(w, fx + a, py + 3, fz + b, S('torch'));
        r(); r(); r(); r();
      } else if (rm.kind === 'library') {
        for (let x = rm.x - hx + 1; x <= rm.x + hx - 1; x++) for (let z = rm.z - hz + 1; z <= rm.z + hz - 1; z++) {
          const wall = x === rm.x - hx + 1 || x === rm.x + hx - 1 || z === rm.z - hz + 1 || z === rm.z + hz - 1;
          const shelfRow = (along ? (x - rm.x) : (z - rm.z)) % 3 === 0 && Math.abs(along ? z - rm.z : x - rm.x) > 1;
          if (wall || shelfRow) for (let yy = rm.y; yy < rm.y + 4; yy++) put(w, x, yy, z, S('bookshelf'));
        }
        for (let a = -1; a <= 1; a++) for (let yy = rm.y; yy <= rm.y + 2; yy++) put(w, rm.x - dx * (hx - 1) + (along ? 0 : a), yy, rm.z - dz * (hz - 1) + (along ? a : 0), AIR);
        fill(w, rm.x - 1, rm.y, rm.z - 1, rm.x + 1, rm.y + 3, rm.z + 1, AIR);
        put(w, rm.x, rm.y + 4, rm.z, [S('lantern')[0], S('lantern')[1] | 2]);
        chest(w, rm.x + dx * (hx - 2), rm.y, rm.z + dz * (hz - 2), (rm.d + 2) % 4, r, 'library');
        chest(w, rm.x, rm.y, rm.z, rm.d, r, 'stronghold');
        r(); r();
      } else if (rm.kind === 'prison') {
        for (let a = -hx + 1; a <= hx - 1; a++) for (let yy = rm.y; yy <= rm.y + 2; yy++) { if (a === 0) continue; if (along) put(w, rm.x + a, yy, rm.z, S('iron_bars')); else put(w, rm.x, yy, rm.z + a, S('iron_bars')); }
        chest(w, rm.x + dx * (hx - 1), rm.y, rm.z + dz * (hz - 1), (rm.d + 2) % 4, r, 'stronghold');
        r(); r(); r();
      } else {
        chest(w, rm.x + dx * 2, rm.y, rm.z + dz * 2, (rm.d + 2) % 4, r, 'stronghold');
        if (r() < 0.5) chest(w, rm.x + dz * 2, rm.y, rm.z + dx * 2, rm.d, r, 'stronghold');
        put(w, rm.x, rm.y + 3, rm.z, [S('lantern')[0], S('lantern')[1] | 2]);
        r();
      }
    }
  };

  // ---------------- nether fortress ----------------
  function planFortress(c) {
    const key = 'f' + c.x + ',' + c.z;
    if (plans.has(key)) return plans.get(key);
    const r = mulberry32(c.seed), segs = [];
    const arm = (x, z, d, len, depth) => {
      segs.push({ x, z, d, len, closed: r() < 0.45 });
      if (depth === 0) for (let t = 12; t < len - 6; t += 14 + Math.floor(r() * 10)) {
        if (r() < 0.6) { const nd = (d + (r() < 0.5 ? 1 : 3)) % 4; arm(x + DIRS[d][0] * t + DIRS[nd][0] * 3, z + DIRS[d][1] * t + DIRS[nd][1] * 3, nd, 14 + Math.floor(r() * 20), 1); }
      }
    };
    for (let d = 0; d < 4; d++) arm(c.x + DIRS[d][0] * 6, c.z + DIRS[d][1] * 6, d, 28 + Math.floor(r() * 36), 0);
    const wartArm = Math.floor(r() * 4);
    const plan = { segs, wartArm, y: c.y, seed: c.seed };
    plans.set(key, plan);
    return plan;
  }
  BUILD.fortress = (w, c) => {
    const P = planFortress(c), y = P.y;
    const nb = S('nether_bricks'), fence = S('nether_brick_fence'), st2 = d => stairs('nether_brick_stairs', d);
    const r = mulberry32(P.seed ^ 0xf0);
    const pillar = (x, z) => { for (let yy = y - 2; yy > 4; yy--) { const id = w.get(x, yy, z); if (id < 0) return; if (id !== B.AIR && id !== B.LAVA && id !== B.FIRE) break; put(w, x, yy, z, nb); } };
    // Central blaze room.
    fill(w, c.x - 6, y - 1, c.z - 6, c.x + 6, y - 1, c.z + 6, nb);
    shell(w, c.x - 6, y - 1, c.z - 6, c.x + 6, y + 6, c.z + 6, nb, seed);
    for (let d = 0; d < 4; d++) { const [dx, dz] = DIRS[d]; for (let a = -2; a <= 2; a++) for (let yy = y; yy <= y + 3; yy++) put(w, c.x + dx * 6 + (dz ? a : 0), yy, c.z + dz * 6 + (dx ? a : 0), AIR); }
    for (let a = -6; a <= 6; a += 3) for (const b of [-6, 6]) { put(w, c.x + a, y + 3, c.z + b, fence); put(w, c.x + b, y + 3, c.z + a, fence); }
    fill(w, c.x - 2, y, c.z - 2, c.x + 2, y + 1, c.z + 2, nb);
    for (let d = 0; d < 4; d++) { const [dx, dz] = DIRS[d]; for (let a = -1; a <= 1; a++) put(w, c.x + dx * 3 + (dz ? a : 0), y, c.z + dz * 3 + (dx ? a : 0), st2((d + 2) % 4)); }
    spawner(w, c.x, y + 2, c.z, 'blaze');
    for (let dz = -6; dz <= 6; dz += 4) for (let dx = -6; dx <= 6; dx += 4) pillar(c.x + dx, c.z + dz);
    w.addEntity({ type: 'blaze', x: c.x + 3.5, y: y + 1, z: c.z + 3.5 });
    // Bridges and corridors.
    P.segs.forEach((s, si) => {
      const [dx, dz] = DIRS[s.d], px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0;
      const ex = s.x + dx * s.len, ez = s.z + dz * s.len;
      const isWart = si === P.segs.findIndex(q => q.d === P.wartArm);
      const pad = isWart ? 12 : 3;
      const inChunk = w.overlaps(Math.min(s.x, ex) - pad, Math.min(s.z, ez) - pad, Math.max(s.x, ex) + pad, Math.max(s.z, ez) + pad);
      const sr = mulberry32(P.seed ^ (si * 7919));
      const chestT = s.closed && sr() < 0.5 ? 3 + Math.floor(sr() * (s.len - 6)) : -1;
      const wsN = 1 + Math.floor(sr() * 2);
      if (!inChunk) return;
      for (let t = 0; t <= s.len; t++) {
        const cx2 = s.x + dx * t, cz2 = s.z + dz * t;
        for (let a = -2; a <= 2; a++) {
          const x = cx2 + px * a, z = cz2 + pz * a;
          put(w, x, y - 1, z, nb);
          for (let yy = y; yy <= y + 4; yy++) put(w, x, yy, z, AIR);
          if (s.closed) {
            if (Math.abs(a) === 2) for (let yy = y; yy <= y + 3; yy++) put(w, x, yy, z, yy === y + 1 && t % 2 === 0 ? fence : nb);
            put(w, x, y + 4, z, nb);
          } else if (Math.abs(a) === 2) put(w, x, y, z, fence);
        }
        if (!s.closed && t % 7 === 3) for (const a of [-2, 2]) pillar(cx2 + px * a, cz2 + pz * a);
        if (s.closed && t % 8 === 4) pillar(cx2, cz2);
        if (t === chestT) chest(w, cx2 + px, y, cz2 + pz, (s.d + (px ? 1 : 3)) % 4, sr, 'fortress');
      }
      // End platform: wart garden on one arm, lookout on the rest.
      if (isWart) {
        const gx = ex + dx * 5, gz = ez + dz * 5;
        shell(w, gx - 5, y - 1, gz - 5, gx + 5, y + 5, gz + 5, nb, seed);
        for (let a = -2; a <= 2; a++) for (let yy = y; yy <= y + 3; yy++) put(w, ex + dx + (dz ? a : 0), yy, ez + dz + (dx ? a : 0), AIR), put(w, gx - dx * 5 + (dz ? a : 0), yy, gz - dz * 5 + (dx ? a : 0), AIR);
        const wart = S('nether_wart');
        for (let a = -3; a <= 3; a++) for (const b of [-3, 3]) {
          const x = gx + (dz ? a : b), z = gz + (dz ? b : a);
          put(w, x, y, z, S('soul_sand')); put(w, x, y + 1, z, [wart[0], wart[1] | (Math.floor(hash2(x, z, seed) * 4) << CROP_AGE_SHIFT)]);
        }
        chest(w, gx, y, gz, s.d, sr, 'fortress');
        for (let dz2 = -5; dz2 <= 5; dz2 += 5) for (let dx2 = -5; dx2 <= 5; dx2 += 5) pillar(gx + dx2, gz + dz2);
      }
      for (let i = 0; i < wsN; i++) {
        const t = Math.floor(sr() * s.len);
        if (w.inside(s.x + dx * t, s.z + dz * t)) w.addEntity({ type: 'wither_skeleton', x: s.x + dx * t + 0.5, y, z: s.z + dz * t + 0.5, data: { persistent: true } });
      }
    });
    void r;
  };

  // ---------------- bastion remnant ----------------
  BUILD.bastion = (w, c) => {
    const r = mulberry32(c.seed), y = c.y;
    const bb = S('polished_blackstone_bricks'), bs = S('blackstone'), gold = S('gold_block'), gil = S('gilded_blackstone');
    const pick = (x, yy, z) => { const h = hash3(x, yy, z, seed ^ 0xba5); return h < 0.08 ? gil : h < 0.4 ? bs : bb; };
    for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) { put(w, c.x + dx, y - 1, c.z + dz, pick(c.x + dx, y - 1, c.z + dz)); foundation(w, c.x + dx, y - 1, c.z + dz, bs, 30); }
    fill(w, c.x - 10, y, c.z - 10, c.x + 10, y + 18, c.z + 10, AIR);
    for (let level = 0; level < 3; level++) {
      const s = 10 - level * 3, y0 = y + level * 6;
      for (let dz = -s; dz <= s; dz++) for (let dx = -s; dx <= s; dx++) {
        const edge = Math.abs(dx) === s || Math.abs(dz) === s;
        const x = c.x + dx, z = c.z + dz;
        if (edge) for (let k = 0; k < 6; k++) { if (hash3(x, y0 + k, z, seed ^ 0x4) < 0.14 + level * 0.05) continue; if (k >= 2 && k <= 3 && (dx === 0 || dz === 0)) continue; put(w, x, y0 + k, z, pick(x, y0 + k, z)); }
        if (level > 0 && Math.abs(dx) <= s && Math.abs(dz) <= s && hash3(x, y0, z, seed ^ 0x9) > 0.1) put(w, x, y0 - 1, z, pick(x, y0 - 1, z));
      }
    }
    // Ramps and a treasure core.
    for (let t = 0; t < 6; t++) put(w, c.x - 7 + t, y + t, c.z - 8, stairs('stone_brick_stairs', 3));
    fill(w, c.x - 1, y + 12, c.z - 1, c.x + 1, y + 12, c.z + 1, gold);
    chest(w, c.x + 2, y + 12, c.z, 1, r, 'bastion');
    chest(w, c.x - 4, y, c.z + 4, 0, r, 'bastion');
    put(w, c.x + 5, y, c.z - 5, gold);
    for (let i = 0; i < 4; i++) put(w, c.x - 6 + i * 4, y, c.z + 6, S('magma_block'));
    for (let i = 0; i < 4; i++) w.addEntity({ type: 'piglin', x: c.x - 5.5 + i * 3, y, z: c.z + 0.5, data: { persistent: true } });
    if (r() < 0.6) w.addEntity({ type: 'hoglin', x: c.x + 6.5, y, z: c.z - 6.5, data: { persistent: true } });
  };

  // ---------------- end city ----------------
  BUILD.end_city = (w, c) => {
    const r = mulberry32(c.seed), y = c.y + 1;
    const pb = S('purpur_block'), pp = logAxis('purpur_pillar', 0), esb = S('end_stone_bricks'), rod = S('end_rod');
    const storey = (x0, y0, s, h, roofRods = true) => {
      for (let dz = -s; dz <= s; dz++) for (let dx = -s; dx <= s; dx++) for (let k = 0; k <= h; k++) {
        const edge = Math.abs(dx) === s || Math.abs(dz) === s, corner = Math.abs(dx) === s && Math.abs(dz) === s;
        const X = c.x + dx, Z = c.z + dz, Y = y0 + k;
        if (k === 0 || k === h) put(w, X, Y, Z, k === 0 && !edge ? pb : esb);
        else if (corner) put(w, X, Y, Z, pp);
        else if (edge) put(w, X, Y, Z, (k === 2 && (dx === 0 || dz === 0 || Math.abs(dx) === 2 || Math.abs(dz) === 2)) ? S('magenta_stained_glass') : pb);
        else put(w, X, Y, Z, AIR);
      }
      if (roofRods) for (const [a, b] of [[-s, -s], [s, -s], [-s, s], [s, s]]) put(w, c.x + a, y0 + h + 1, c.z + b, rod);
      void x0;
    };
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) foundation(w, c.x + dx, y, c.z + dz, S('end_stone'), 20);
    storey(0, y, 6, 6);
    storey(0, y + 6, 4, 6);
    storey(0, y + 12, 4, 6);
    storey(0, y + 18, 3, 6);
    storey(0, y + 24, 5, 5);
    // Ladder shaft up the middle and openings between floors.
    for (let yy = y + 1; yy < y + 29; yy++) { put(w, c.x, yy, c.z, AIR); put(w, c.x + 1, yy, c.z, pp); put(w, c.x, yy, c.z, [B.LADDER, 3]); }
    for (let k = 1; k <= 3; k++) put(w, c.x, y + k, c.z - 6, AIR);
    for (let dx = -1; dx <= 1; dx++) for (let k = 1; k <= 3; k++) put(w, c.x + dx, y + k, c.z - 6, AIR);
    put(w, c.x - 2, y + 3, c.z - 7, rod); put(w, c.x + 2, y + 3, c.z - 7, rod);
    chest(w, c.x - 3, y + 25, c.z + 3, 0, r, 'end_city');
    chest(w, c.x + 3, y + 25, c.z + 3, 0, r, 'end_city');
    // The prize: elytra in a chest at the very top.
    put(w, c.x - 3, y + 25, c.z - 3, [B.CHEST, 3]);
    w.addBlockEntity({ type: 'chest', x: c.x - 3, y: y + 25, z: c.z - 3, items: [{ key: 'elytra', count: 1 }, null, null, { key: 'diamond', count: 3 + Math.floor(r() * 4) }, ...new Array(23).fill(null)] });
    put(w, c.x + 3, y + 25, c.z - 3, S('diamond_block'));
    for (let i = 0; i < 3; i++) w.addEntity({ type: 'enderman', x: c.x + 3.5 - i * 3, y: y + 1, z: c.z + 3.5, data: { persistent: true } });
  };

  return { place, locate, kinds: Object.keys(KINDS).filter(k => KINDS[k].dim === dim), strongholds };
}
