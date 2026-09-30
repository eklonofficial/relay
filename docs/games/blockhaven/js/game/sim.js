// Block simulation: liquids, gravity, support, random ticks (crops, saplings, grass, fire, cacti).
import { B, BLOCKS, SOLID, OPAQUE, SHAPE_OF, SHAPE, CROP_STAGES, CROP_AGE_SHIFT, props, st, DIM } from '../data/blocks.js';
import { UNLOADED } from '../world/world.js';
import * as T from '../gen/trees.js';

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const k3 = (x, y, z) => `${x},${y},${z}`;
// Fire behaviour per block: [burn chance per fire tick, spread encouragement] (after Java Edition).
const FLAME = new Map();
function flameOf(id) {
  if (FLAME.has(id)) return FLAME.get(id);
  let v = null;
  const b = BLOCKS[id];
  if (id === B.LEAVES || id === B.WOOL || id === B.CARPET || id === B.HAY_BLOCK || id === B.MOSS_CARPET) v = [0.6, 30];
  else if (id === B.PLANT || id === B.FLOWER || id === B.VINE || id === B.SWEET_BERRY_BUSH || id === B.SAPLING || id === B.CAVE_VINES || id === B.GLOW_LICHEN) v = [1, 60];
  else if (id === B.BOOKSHELF) v = [0.3, 30];
  else if (id === B.LOG) v = [0.05, 5];
  else if (id === B.PLANKS || id === B.FENCE || id === B.CRAFTING_TABLE || id === B.BAMBOO) v = [0.2, 5];
  else if (id === B.TNT) v = [1, 15];
  else if (b && b.flammable) v = [0.2, 5];
  FLAME.set(id, v);
  return v;
}
const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const NEEDS_GROUND = new Set([SHAPE.CROSS, SHAPE.CROP, SHAPE.CARPET, SHAPE.SNOW, SHAPE.RAIL, SHAPE.DOOR, SHAPE.FIRE, SHAPE.CAMPFIRE]);

export class Sim {
  constructor(game) { this.game = game; this.queue = new Map(); this.time = 0; this.fires = new Map(); }
  get world() { return this.game.world; }
  schedule(x, y, z, delay) {
    const key = k3(x, y, z);
    const at = this.time + delay;
    const cur = this.queue.get(key);
    if (!cur || cur.at > at) this.queue.set(key, { x, y, z, at });
  }
  isLiquid(id) { return id === B.WATER || id === B.LAVA; }
  delayFor(id) { return id === B.LAVA ? (this.game.dim === DIM.NETHER ? 0.5 : 1.5) : 0.25; }

  // Called for every block change.
  onChange(x, y, z) {
    if (this.world.getBlock(x, y, z) === B.FIRE) this.trackFire(x, y, z); else this.fires.delete(k3(x, y, z));
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const id = this.world.getBlock(x + dx, y + dy, z + dz);
      if (id === UNLOADED) continue;
      if (this.isLiquid(id)) this.schedule(x + dx, y + dy, z + dz, this.delayFor(id));
      else if (BLOCKS[id] && (BLOCKS[id].gravity || NEEDS_GROUND.has(SHAPE_OF[id]) || id === B.CACTUS || id === B.SUGAR_CANE || SHAPE_OF[id] === SHAPE.TORCH || SHAPE_OF[id] === SHAPE.LADDER || SHAPE_OF[id] === SHAPE.VINE || SHAPE_OF[id] === SHAPE.LANTERN || id === B.CAVE_VINES || id === B.SEAGRASS || id === B.BAMBOO)) this.schedule(x + dx, y + dy, z + dz, 0.05);
      // Liquids next to the changed cell may flow into it.
      if (id === B.AIR || !SOLID[id]) for (const [ex, ez] of NB4) { const n = this.world.getBlock(x + dx + ex, y + dy, z + dz + ez); if (this.isLiquid(n)) this.schedule(x + dx + ex, y + dy, z + dz + ez, this.delayFor(n)); }
    }
  }

  update(dt) {
    this.time += dt;
    let budget = 400;
    const due = [];
    for (const [key, u] of this.queue) { if (u.at <= this.time) { due.push(u); this.queue.delete(key); if (due.length >= budget) break; } }
    for (const u of due) this.tick(u.x, u.y, u.z);
    this.fireTicks();
    this.randomTicks(dt);
  }

  // ---------------- fire ----------------
  trackFire(x, y, z, age = 0) {
    const key = k3(x, y, z);
    if (!this.fires.has(key)) this.fires.set(key, { x, y, z, age, next: this.time + 0.6 + Math.random() * 1.2 });
  }
  fireTicks() {
    let n = 0;
    for (const [key, f] of this.fires) {
      if (f.next > this.time) continue;
      f.next = this.time + 1.1 + Math.random() * 1.1;
      this.fireTick(key, f);
      if (++n > 60) break;
    }
  }
  flammableAround(x, y, z) {
    for (const [dx, dy, dz] of DIRS6) if (flameOf(this.world.getBlock(x + dx, y + dy, z + dz))) return true;
    return false;
  }
  fireTick(key, f) {
    const g = this.game, w = this.world, { x, y, z } = f;
    const id = w.getBlock(x, y, z);
    if (id === UNLOADED) return;
    if (id !== B.FIRE) { this.fires.delete(key); return; }
    if (!g.rules.doFireTick) return;
    const below = w.getBlock(x, y - 1, z);
    const eternal = below === B.NETHERRACK || (below === B.BASALT && (w.getMeta(x, y - 1, z) & 7) === 4);
    const soul = (w.getMeta(x, y, z) & 1) === 1;
    if (!eternal && g.raining && w.lightAt(x, y, z).sky >= 15 && Math.random() < 0.6) { g.setBlock(x, y, z, B.AIR, 0); return; }
    f.age = Math.min(15, f.age + Math.floor(Math.random() * 3));
    const fuel = this.flammableAround(x, y, z);
    if (!eternal && !soul) {
      if (!fuel) { if (!SOLID[below] || f.age > 3) { g.setBlock(x, y, z, B.AIR, 0); return; } }
      else if (f.age >= 15 && !flameOf(below) && Math.random() < 0.25) { g.setBlock(x, y, z, B.AIR, 0); return; }
    }
    if (soul || eternal && !fuel) return;
    // Burn neighbours: they either catch fire themselves or crumble away.
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz, n = w.getBlock(nx, ny, nz), fl = flameOf(n);
      if (!fl || Math.random() >= fl[0] * 0.5) continue;
      if (n === B.TNT) { g.igniteTnt(nx, ny, nz); continue; }
      if (Math.random() < 0.6 - f.age * 0.02) { g.setBlock(nx, ny, nz, B.FIRE, 0); this.trackFire(nx, ny, nz, Math.min(15, f.age + 2)); }
      else g.setBlock(nx, ny, nz, B.AIR, 0);
    }
    // Spread through the air into spots next to fuel, more easily upwards.
    for (let dy = -1; dy <= 4; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy && !dz) continue;
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (w.getBlock(nx, ny, nz) !== B.AIR) continue;
      let enc = 0;
      for (const [ex, ey, ez] of DIRS6) { const fl = flameOf(w.getBlock(nx + ex, ny + ey, nz + ez)); if (fl) enc = Math.max(enc, fl[1]); }
      if (!enc) continue;
      const chance = enc / 100 * 0.35 / (dy > 1 ? dy : 1);
      if (Math.random() < chance) { g.setBlock(nx, ny, nz, B.FIRE, 0); this.trackFire(nx, ny, nz, Math.min(15, f.age + 1)); }
    }
  }

  tick(x, y, z) {
    const g = this.game, w = this.world;
    const id = w.getBlock(x, y, z);
    if (id === UNLOADED) return;
    if (this.isLiquid(id)) { this.flow(x, y, z, id); return; }
    const below = w.getBlock(x, y - 1, z);
    const b = BLOCKS[id];
    if (!b) return;
    if (b.gravity && (below === B.AIR || this.isLiquid(below) || (BLOCKS[below] && BLOCKS[below].replaceable))) {
      g.setBlock(x, y, z, B.AIR, 0);
      g.spawnFalling(x, y, z, id, w.getMeta(x, y, z));
      return;
    }
    const m = w.getMeta(x, y, z), sh = SHAPE_OF[id];
    let unsupported = false;
    if (NEEDS_GROUND.has(sh) && id !== B.FIRE) {
      if (sh === SHAPE.DOOR && (m >> 6) & 1) unsupported = w.getBlock(x, y - 1, z) !== B.DOOR;
      else if (sh === SHAPE.DOOR) unsupported = !SOLID[below] || w.getBlock(x, y + 1, z) !== B.DOOR;
      else if (id === B.SEAGRASS) unsupported = !SOLID[below] && below !== B.SEAGRASS;
      else unsupported = below === B.AIR || this.isLiquid(below) || (!SOLID[below] && below !== B.FARMLAND && !(sh === SHAPE.CROSS && below === id));
      if (sh === SHAPE.CROSS && id === B.PLANT && this.isLiquid(below)) unsupported = true;
    }
    if (id === B.FIRE && !SOLID[below] && !this.adjacentFlammable(x, y, z)) unsupported = true;
    if (id === B.CACTUS || id === B.SUGAR_CANE || id === B.BAMBOO) unsupported = below !== id && !SOLID[below];
    if (id === B.CACTUS) for (const [dx, dz] of NB4) if (SOLID[w.getBlock(x + dx, y, z + dz)]) unsupported = true;
    if (sh === SHAPE.TORCH) {
      const a = (m >> 1) & 7;
      if (!a) unsupported = !SOLID[below];
      else { const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][a - 1]; unsupported = !OPAQUE[w.getBlock(x + dx, y, z + dz)]; }
    }
    if (sh === SHAPE.LADDER || sh === SHAPE.VINE) {
      const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][m & 3];
      unsupported = !SOLID[w.getBlock(x + dx, y, z + dz)] && !(sh === SHAPE.VINE && w.getBlock(x, y + 1, z) === id);
    }
    if (sh === SHAPE.LANTERN && (m >> 1) & 1) unsupported = !SOLID[w.getBlock(x, y + 1, z)];
    if (id === B.CAVE_VINES) unsupported = !SOLID[w.getBlock(x, y + 1, z)] && w.getBlock(x, y + 1, z) !== B.CAVE_VINES;
    if (unsupported) g.breakBlock(x, y, z, { drop: true, silent: false, cause: 'support' });
  }

  adjacentFlammable(x, y, z) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const id = this.world.getBlock(x + dx, y + dy, z + dz); if (BLOCKS[id] && BLOCKS[id].flammable) return true; }
    return false;
  }

  flow(x, y, z, id) {
    const g = this.game, w = this.world, lava = id === B.LAVA;
    const m = w.getMeta(x, y, z) & 15;
    const drop = lava && g.dim !== DIM.NETHER ? 2 : 1;
    const isSame = n => n === id;
    const levelOf = (nx, ny, nz) => { const n = w.getBlock(nx, ny, nz); if (!isSame(n)) return -1; const l = w.getMeta(nx, ny, nz) & 15; return l >= 8 ? 0 : l; };
    // Reactions with the other liquid.
    if (lava) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
        if (w.getBlock(x + dx, y + dy, z + dz) === B.WATER) {
          g.setBlock(x, y, z, m === 0 ? B.OBSIDIAN : B.COBBLESTONE, 0);
          g.sound.play('fizz', [x + 0.5, y + 0.5, z + 0.5], 0.5); g.particles.smoke([x + 0.5, y + 1, z + 0.5], 6);
          return;
        }
      }
    }
    let level = m;
    if (m !== 0) {
      // Recompute from neighbours.
      let best = 99, sources = 0;
      if (isSame(w.getBlock(x, y + 1, z))) best = 0;
      for (const [dx, dz] of NB4) {
        const l = levelOf(x + dx, y, z + dz);
        if (l < 0) continue;
        if (l === 0 && (w.getMeta(x + dx, y, z + dz) & 15) === 0) sources++;
        best = Math.min(best, l + drop);
      }
      const belowId = w.getBlock(x, y - 1, z);
      if (!lava && sources >= 2 && (SOLID[belowId] || (isSame(belowId) && (w.getMeta(x, y - 1, z) & 15) === 0))) level = 0;
      else if (isSame(w.getBlock(x, y + 1, z))) level = 8;
      else level = best;
      if (level > 7 && level !== 8) { g.setBlock(x, y, z, B.AIR, 0); return; }
      if (level !== m) { g.setBlock(x, y, z, id, level); return; }
    }
    // Spread down, then sideways.
    const belowId = w.getBlock(x, y - 1, z);
    const canFill = n => n === B.AIR || (BLOCKS[n] && BLOCKS[n].replaceable && !this.isLiquid(n) && n !== B.WATER) || (lava && n === B.WATER);
    if (belowId === B.WATER && lava) { g.setBlock(x, y - 1, z, B.STONE, 0); return; }
    if (canFill(belowId) && y > 0) {
      if (belowId !== B.AIR && BLOCKS[belowId]) g.breakBlock(x, y - 1, z, { drop: true, silent: true });
      g.setBlock(x, y - 1, z, id, 8);
      return;
    }
    if (level >= 8 && !(SOLID[belowId] || isSame(belowId))) return;
    const base = level >= 8 ? 0 : level;
    const next = base + drop;
    if (next > 7) return;
    if (isSame(belowId) && level !== 0 && level < 8) return;
    for (const [dx, dz] of NB4) {
      const n = w.getBlock(x + dx, y, z + dz);
      if (n === UNLOADED) continue;
      if (lava && n === B.WATER) { g.setBlock(x + dx, y, z + dz, B.COBBLESTONE, 0); continue; }
      if (isSame(n)) { const l = w.getMeta(x + dx, y, z + dz) & 15; if (l !== 0 && l < 8 && l > next) g.setBlock(x + dx, y, z + dz, id, next); continue; }
      if (canFill(n)) {
        if (n !== B.AIR && BLOCKS[n]) g.breakBlock(x + dx, y, z + dz, { drop: true, silent: true });
        g.setBlock(x + dx, y, z + dz, id, next);
      }
    }
    if (lava && Math.random() < 0.3 && g.rules.doFireTick) this.lavaIgnite(x, y, z);
  }
  lavaIgnite(x, y, z) {
    const w = this.world;
    for (let k = 0; k < 3; k++) {
      const nx = x + Math.floor(Math.random() * 3) - 1, ny = y + 1 + Math.floor(Math.random() * 2), nz = z + Math.floor(Math.random() * 3) - 1;
      if (w.getBlock(nx, ny, nz) === B.AIR && this.adjacentFlammable(nx, ny, nz)) { this.game.setBlock(nx, ny, nz, B.FIRE, 0); return; }
    }
  }

  // ~3 random block ticks per 16x16x16 section per second near the player.
  randomTicks(dt) {
    const g = this.game, w = this.world, p = g.player.pos;
    const n = Math.floor(dt * 60 * 12) || 1;
    for (let k = 0; k < n * 3; k++) {
      const x = Math.floor(p[0] + (Math.random() - 0.5) * 96), z = Math.floor(p[2] + (Math.random() - 0.5) * 96);
      const y = Math.floor(Math.max(1, Math.min(254, p[1] + (Math.random() - 0.5) * 64)));
      const id = w.getBlock(x, y, z);
      if (id === UNLOADED || id === B.AIR || id === B.STONE) continue;
      this.randomTick(x, y, z, id);
    }
  }
  randomTick(x, y, z, id) {
    const g = this.game, w = this.world, m = w.getMeta(x, y, z);
    const light = () => { const l = w.lightAt(x, y + 1, z); return Math.max(l.blk, g.isDay() ? l.sky : l.sky - 11); };
    switch (id) {
      case B.CROPS: {
        const v = m & 7, age = (m >> CROP_AGE_SHIFT) & 7, max = CROP_STAGES[v] - 1;
        const netherWart = v === 6;
        if (!netherWart && light() < 9) return;
        const wet = w.getBlock(x, y - 1, z) === B.FARMLAND && (w.getMeta(x, y - 1, z) & 1);
        if (Math.random() > (wet ? 0.35 : 0.15) * (netherWart ? 0.5 : 1)) return;
        if (age < max) g.setBlock(x, y, z, id, v | ((age + 1) << CROP_AGE_SHIFT));
        else if (v === 4 || v === 5) {
          const [dx, dz] = NB4[Math.floor(Math.random() * 4)];
          const below = w.getBlock(x + dx, y - 1, z + dz);
          if (w.getBlock(x + dx, y, z + dz) === B.AIR && (below === B.DIRT || below === B.GRASS_BLOCK || below === B.FARMLAND)) g.setBlock(x + dx, y, z + dz, v === 4 ? B.PUMPKIN : B.MELON, 0);
        }
        return;
      }
      case B.FARMLAND: {
        let water = false;
        for (let dx = -4; dx <= 4 && !water; dx++) for (let dz = -4; dz <= 4 && !water; dz++) for (let dy = 0; dy <= 1; dy++) if (w.getBlock(x + dx, y + dy, z + dz) === B.WATER) { water = true; break; }
        if (water !== !!(m & 1)) g.setBlock(x, y, z, id, water ? 1 : 0);
        else if (!water && w.getBlock(x, y + 1, z) !== B.CROPS && Math.random() < 0.2) g.setBlock(x, y, z, B.DIRT, 0);
        return;
      }
      case B.SAPLING: if (light() >= 9 && Math.random() < 0.08) this.growTree(x, y, z, m & 7); return;
      case B.GRASS_BLOCK: {
        if (OPAQUE[w.getBlock(x, y + 1, z)]) { g.setBlock(x, y, z, B.DIRT, 0); return; }
        const nx = x + Math.floor(Math.random() * 3) - 1, ny = y + Math.floor(Math.random() * 5) - 3, nz = z + Math.floor(Math.random() * 3) - 1;
        if (w.getBlock(nx, ny, nz) === B.DIRT && w.getMeta(nx, ny, nz) === 0 && !OPAQUE[w.getBlock(nx, ny + 1, nz)] && w.lightAt(nx, ny + 1, nz).sky >= 4) g.setBlock(nx, ny, nz, B.GRASS_BLOCK, 0);
        return;
      }
      case B.FIRE: this.trackFire(x, y, z); return;
      case B.CACTUS: case B.SUGAR_CANE: case B.BAMBOO: {
        if (w.getBlock(x, y + 1, z) !== B.AIR || Math.random() > 0.2) return;
        let h = 1; while (w.getBlock(x, y - h, z) === id) h++;
        if (h < (id === B.BAMBOO ? 12 : 3)) g.setBlock(x, y + 1, z, id, 0);
        return;
      }
      case B.ICE: if (w.lightAt(x, y + 1, z).blk > 11) g.setBlock(x, y, z, B.WATER, 0); return;
      case B.SNOW: if (w.lightAt(x, y, z).blk > 11) g.setBlock(x, y, z, B.AIR, 0); return;
      case B.SWEET_BERRY_BUSH: return;
      case B.LEAVES: return;
      default: return;
    }
  }

  // Grows a sapling using the world-gen tree shapes.
  growTree(x, y, z, wood) {
    const g = this.game, w = this.world;
    const adapter = {
      get: (a, b, c) => { const id = w.getBlock(a, b, c); return id === UNLOADED ? -1 : id; },
      set: (a, b, c, id, m = 0) => { const cur = w.getBlock(a, b, c); if (cur !== UNLOADED && cur !== B.BEDROCK) g.setBlock(Math.floor(a), Math.floor(b), Math.floor(c), id, m); },
      soft: (a, b, c, id, m = 0, overLeaves = false) => { const cur = w.getBlock(a, b, c); if (cur === B.AIR || cur === B.SAPLING || (BLOCKS[cur] && BLOCKS[cur].replaceable && cur !== B.WATER && cur !== B.LAVA) || (overLeaves && cur === B.LEAVES)) g.setBlock(Math.floor(a), Math.floor(b), Math.floor(c), id, m); },
      inside: () => true,
    };
    for (let k = 1; k < 7; k++) if (w.getBlock(x, y + k, z) !== B.AIR && w.getBlock(x, y + k, z) !== B.LEAVES) return;
    g.setBlock(x, y, z, B.AIR, 0);
    const r = Math.random;
    switch (wood) {
      case 1: T.spruce(adapter, x, y, z, r); break;
      case 2: T.birch(adapter, x, y, z, r); break;
      case 3: T.jungle(adapter, x, y, z, r); break;
      case 4: T.acacia(adapter, x, y, z, r); break;
      case 5: T.darkOak(adapter, x, y, z, r); break;
      case 6: T.cherry(adapter, x, y, z, r); break;
      case 7: T.mangrove(adapter, x, y, z, r); break;
      default: if (r() < 0.1) T.fancyOak(adapter, x, y, z, r); else T.oak(adapter, x, y, z, r);
    }
  }

  // Bone meal: instantly advances growth.
  boneMeal(x, y, z) {
    const g = this.game, w = this.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
    if (id === B.CROPS) { const v = m & 7, age = (m >> CROP_AGE_SHIFT) & 7, max = CROP_STAGES[v] - 1; if (age >= max || v === 6) return false; g.setBlock(x, y, z, id, v | (Math.min(max, age + 2 + Math.floor(Math.random() * 3)) << CROP_AGE_SHIFT)); return true; }
    if (id === B.SAPLING) { if (Math.random() < 0.45) this.growTree(x, y, z, m & 7); return true; }
    if (id === B.GRASS_BLOCK) {
      for (let k = 0; k < 24; k++) {
        const nx = x + Math.floor(Math.random() * 7) - 3, nz = z + Math.floor(Math.random() * 7) - 3;
        if (w.getBlock(nx, y, nz) === B.GRASS_BLOCK && w.getBlock(nx, y + 1, nz) === B.AIR) {
          if (Math.random() < 0.8) g.setBlock(nx, y + 1, nz, B.PLANT, st('short_grass')[1]);
          else g.setBlock(nx, y + 1, nz, B.FLOWER, [0, 1, 4, 9][Math.floor(Math.random() * 4)]);
        }
      }
      return true;
    }
    return false;
  }
}
export { props };
