// Block simulation: liquids, gravity, support, random ticks (crops, saplings, grass, fire, cacti).
import { B, BLOCKS, SOLID, OPAQUE, SHAPE_OF, SHAPE, CROP_STAGES, CROP_AGE_SHIFT, WATERLOGGED, props, st, DIM } from '../data/blocks.js?v=musn4era';
import { amountAt, heightAt, isWater, sameFluid } from './fluid.js?v=musn4era';
import { UNLOADED } from '../world/world.js?v=musn4era';
import * as T from '../gen/trees.js?v=musn4era';
import { KIND } from './redstone.js?v=musn4era';

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
      if (id === B.LAVA && this.lavaReact(x + dx, y + dy, z + dz)) continue; // neighborChanged reacts at once
      if (this.isLiquid(id) || WATERLOGGED[id]) this.schedule(x + dx, y + dy, z + dz, this.delayFor(id));
      else if (KIND[id] && id !== B.DOOR && id !== B.TRAPDOOR && id !== B.TNT) { /* redstone parts check their own support */ }
      else if (BLOCKS[id] && (BLOCKS[id].gravity || NEEDS_GROUND.has(SHAPE_OF[id]) || id === B.CACTUS || id === B.SUGAR_CANE || SHAPE_OF[id] === SHAPE.TORCH || SHAPE_OF[id] === SHAPE.LADDER || SHAPE_OF[id] === SHAPE.VINE || SHAPE_OF[id] === SHAPE.LANTERN || id === B.CAVE_VINES || id === B.SEAGRASS || id === B.BAMBOO)) this.schedule(x + dx, y + dy, z + dz, 0.05);
      // Liquids next to the changed cell may flow into it.
      if (id === B.AIR || !SOLID[id]) for (const [ex, ez] of NB4) { const n = this.world.getBlock(x + dx + ex, y + dy, z + dz + ez); if (this.isLiquid(n) || WATERLOGGED[n]) this.schedule(x + dx + ex, y + dy, z + dz + ez, this.delayFor(n)); }
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
    if (WATERLOGGED[id]) this.flow(x, y, z, id); // the water in it spreads; the plant still needs support
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

  // ---------------- liquids: a port of Java's FlowingFluid, WaterFluid and LavaFluid ----------------
  // Per fluid: drop-off per block, slope-find distance, tick delay (water 5 ticks; lava 30, or 10 in the Nether).
  fluidParams(lava) { const hot = this.game.dim === DIM.NETHER; return lava ? { drop: hot ? 1 : 2, slope: hot ? 4 : 2, delay: hot ? 0.5 : 1.5 } : { drop: 1, slope: 4, delay: 0.25 }; }
  // canHoldFluid: air, liquids and anything that doesn't block movement, except doors, ladders,
  // carpets, sugar cane, portals and waterlogged plants (which already hold water).
  holds(id) {
    if (id === B.AIR || id === B.WATER || id === B.LAVA) return true;
    if (id === UNLOADED || SOLID[id] || WATERLOGGED[id] || id === B.SUGAR_CANE || id === B.MOVING_PISTON) return false;
    const sh = SHAPE_OF[id];
    return sh !== SHAPE.DOOR && sh !== SHAPE.LADDER && sh !== SHAPE.CARPET && sh !== SHAPE.PORTAL && sh !== SHAPE.END_PORTAL;
  }
  isSrc(x, y, z, lava) { const id = this.world.getBlock(x, y, z); return sameFluid(id, lava) && (WATERLOGGED[id] === 1 || (this.world.getMeta(x, y, z) & 15) === 0); }
  // getNewLiquid: the state this cell would take from its neighbours, as a liquid meta (-1 = empty).
  newLiquid(x, y, z, lava, P) {
    const w = this.world;
    let max = 0, sources = 0;
    for (const [dx, dz] of NB4) {
      const a = amountAt(w, x + dx, y, z + dz, lava);
      if (!a) continue;
      if (this.isSrc(x + dx, y, z + dz, lava)) sources++;
      if (a > max) max = a;
    }
    if (!lava && sources >= 2 && this.game.rules.waterSourceConversion !== false) {
      const b = w.getBlock(x, y - 1, z);
      if (SOLID[b] || this.isSrc(x, y - 1, z, lava)) return 0;
    }
    if (sameFluid(w.getBlock(x, y + 1, z), lava)) return 8;
    const k = max - P.drop;
    return k <= 0 ? -1 : 8 - k;
  }
  // canSpreadTo: the target can hold liquid and its own fluid lets this one replace it.
  canSpreadTo(id, x, y, z, lava, down) {
    if (!this.holds(id)) return false;
    if (id === B.WATER) return lava && down; // WaterFluid.canBeReplacedWith: lava, flowing down only
    if (id === B.LAVA) return !lava && heightAt(this.world, x, y, z, true) >= 0.44444445; // LavaFluid.canBeReplacedWith
    return true;
  }
  spreadTo(x, y, z, id, lava, meta, down) {
    const g = this.game;
    if (lava && down && isWater(id)) { g.setBlock(x, y, z, B.STONE, 0); this.fizz(x, y, z); return; }
    if (id !== B.AIR && id !== B.WATER && id !== B.LAVA) {
      if (lava) { g.breakBlock(x, y, z, { drop: false, silent: true }); this.fizz(x, y, z); }
      else g.breakBlock(x, y, z, { drop: true, silent: true });
    }
    g.setBlock(x, y, z, lava ? B.LAVA : B.WATER, meta);
  }
  fizz(x, y, z) { this.game.sound.play('fizz', [x + 0.5, y + 0.5, z + 0.5], 0.5); this.game.particles.smoke([x + 0.5, y + 1, z + 0.5], 6); }
  // isWaterHole: below is the same fluid, or something liquid could fall into.
  isHole(x, y, z, lava) { if (y < 0) return false; const id = this.world.getBlock(x, y, z); return id !== UNLOADED && (sameFluid(id, lava) || this.holds(id)); }
  passable(id, x, y, z, lava) { return id !== UNLOADED && !(sameFluid(id, lava) && this.isSrc(x, y, z, lava)) && this.holds(id); }
  // getSlopeDistance: steps (up to the slope-find distance) to the nearest drop, never back the way it came.
  slopeDist(x, y, z, depth, bx, bz, lava, P) {
    let best = 1000;
    for (const [dx, dz] of NB4) {
      if (dx === bx && dz === bz) continue;
      const nx = x + dx, nz = z + dz, id = this.world.getBlock(nx, y, nz);
      if (!this.passable(id, nx, y, nz, lava)) continue;
      if (this.isHole(nx, y - 1, nz, lava)) return depth;
      if (depth < P.slope) { const j = this.slopeDist(nx, y, nz, depth + 1, -dx, -dz, lava, P); if (j < best) best = j; }
    }
    return best;
  }
  // spreadToSides + getSpread: only towards the nearest drop (every way when none is in reach).
  spreadSides(x, y, z, lava, amount, falling, P) {
    if ((falling ? 7 : amount - P.drop) <= 0) return;
    const w = this.world, out = [];
    let best = 1000;
    for (const [dx, dz] of NB4) {
      const nx = x + dx, nz = z + dz, id = w.getBlock(nx, y, nz);
      if (!this.passable(id, nx, y, nz, lava)) continue;
      const nm = this.newLiquid(nx, y, nz, lava, P);
      if (nm < 0) continue;
      const j = this.isHole(nx, y - 1, nz, lava) ? 0 : this.slopeDist(nx, y, nz, 1, -dx, -dz, lava, P);
      if (j < best) out.length = 0;
      if (j <= best) { out.push([nx, nz, nm]); best = j; }
    }
    for (const [nx, nz, nm] of out) { const id = w.getBlock(nx, y, nz); if (this.canSpreadTo(id, nx, y, nz, lava, false)) this.spreadTo(nx, y, nz, id, lava, nm, false); }
  }
  // LiquidBlock.shouldSpreadLiquid for lava: water above or beside makes obsidian (from a source)
  // or cobblestone; soul soil below with blue ice beside makes basalt. True when the lava is gone.
  lavaReact(x, y, z) {
    const w = this.world, soul = w.getBlock(x, y - 1, z) === B.SOUL_SAND && (w.getMeta(x, y - 1, z) & 1) === 1;
    for (const [dx, dy, dz] of [[0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]) {
      const id = w.getBlock(x + dx, y + dy, z + dz);
      if (isWater(id)) { this.game.setBlock(x, y, z, (w.getMeta(x, y, z) & 15) === 0 ? B.OBSIDIAN : B.COBBLESTONE, 0); this.fizz(x, y, z); return true; }
      if (soul && id === B.PACKED_ICE && (w.getMeta(x + dx, y + dy, z + dz) & 1) === 1) { this.game.setBlock(x, y, z, B.BASALT, 0); this.fizz(x, y, z); return true; }
    }
    return false;
  }
  // FlowingFluid.tick: a flowing cell re-derives its level from its neighbours, then spreads.
  flow(x, y, z, id) {
    const g = this.game, w = this.world, lava = id === B.LAVA, P = this.fluidParams(lava);
    if (lava && this.lavaReact(x, y, z)) return;
    let m = id === B.WATER || id === B.LAVA ? Math.min(8, w.getMeta(x, y, z) & 15) : 0; // waterlogged: a source
    if (m !== 0) {
      const nm = this.newLiquid(x, y, z, lava, P);
      if (nm < 0) { g.setBlock(x, y, z, B.AIR, 0); return; }
      if (nm !== m) {
        g.setBlock(x, y, z, id, nm);
        // LavaFluid.getSpreadDelay: rising lava usually waits four times as long.
        const rising = m !== 8 && nm !== 8 && nm < m;
        this.queue.delete(k3(x, y, z));
        this.schedule(x, y, z, lava && rising && Math.random() < 0.75 ? P.delay * 4 : P.delay);
        m = nm;
      }
    }
    // FlowingFluid.spread: down first; sideways only from sources, from cells with nothing below
    // to fall into, or (while falling) from cells with three source neighbours.
    const amount = m === 0 || m === 8 ? 8 : 8 - m;
    const bid = y > 0 ? w.getBlock(x, y - 1, z) : UNLOADED;
    if (bid !== UNLOADED) {
      const nb = this.newLiquid(x, y - 1, z, lava, P);
      if (nb >= 0 && this.canSpreadTo(bid, x, y - 1, z, lava, true)) {
        this.spreadTo(x, y - 1, z, bid, lava, nb, true);
        let n = 0;
        for (const [dx, dz] of NB4) if (this.isSrc(x + dx, y, z + dz, lava)) n++;
        if (n >= 3) this.spreadSides(x, y, z, lava, amount, m === 8, P);
      } else if (m === 0 || !this.isHole(x, y - 1, z, lava)) this.spreadSides(x, y, z, lava, amount, m === 8, P);
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
