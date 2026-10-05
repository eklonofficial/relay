// Living mobs: physics, AI archetypes, combat, breeding/taming, trading and animation.
import { Entity, drawModel, rootMatrix, M } from './entity.js?v=muujms2i';
import { Projectile, renderStack } from './objects.js?v=muujms2i';
import { MOBS, PROFESSIONS, DYE_DIFFUSE } from '../data/mobs.js?v=muujms2i';
import { B, BLOCKS, SOLID, OPAQUE, VARIANT_MASK } from '../data/blocks.js?v=muujms2i';
import { UNLOADED } from '../world/world.js?v=muujms2i';
import { villagerTrades } from '../game/trades.js?v=muujms2i';
import { findPath, clearWalk } from './pathfind.js?v=muujms2i';
import { ARMOR_BYPASS, armorStats, armorReduce, applyInvul } from '../game/combat.js?v=muujms2i';
import { animalPose, chickenPose, wolfPose, horsePose } from './animals.js?v=muujms2i';
import { villagerPose, illagerPose, piglinPose } from './javamodels.js?v=muujms2i';
import { ironGolemPose, ironGolemSway, snowGolemPose, hoglinPose, striderPose, ravagerPose } from './beasts.js?v=muujms2i';
import { squidPose, fishPose, fishSway, pufferfishPose, guardianPose, dolphinPose, turtlePose, axolotlPose } from './aquatic.js?v=muujms2i';
import { witherPose, dragonPose, dragonHistory } from './bosses.js?v=muujms2i';
import { rabbitPose, ocelotPose, parrotPose, batPose, frogPose, camelPose } from './critters.js?v=muujms2i';
import { creeperPose, spiderPose, endermanPose, magmaPose, silverfishPose, blazePose, ghastPose, phantomPose } from './monsters.js?v=muujms2i';
import { humanoidPose } from './humanoid.js?v=muujms2i';
import { armorLayer } from '../data/armor.js?v=muujms2i';
import { I } from '../data/items.js?v=muujms2i';
import { dragonInit, dragonAI, dragonDamage, dragonDying, dragonHead } from './dragon.js?v=muujms2i';

const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
// BlockTags.ENDERMAN_HOLDABLE (by our block keys), and what the plants among them need beneath them.
const HOLDABLE = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt', 'moss_block', 'mud', 'muddy_mangrove_roots', 'sand', 'red_sand', 'gravel',
  'brown_mushroom', 'red_mushroom', 'tnt', 'cactus', 'clay', 'pumpkin', 'carved_pumpkin', 'melon', 'crimson_fungus', 'crimson_nylium', 'crimson_roots', 'warped_fungus',
  'warped_nylium', 'warped_roots', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
  'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower']);
const SOIL = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt', 'moss_block', 'mud', 'farmland', 'muddy_mangrove_roots']);
const NETHER_SOIL = new Set(['crimson_nylium', 'warped_nylium', 'soul_soil', ...SOIL]);
const blockKey = (id, m) => { const b = BLOCKS[id], v = b && b.variants && b.variants[m & VARIANT_MASK[id]]; return v ? v.key : null; };
// Whether a carried block can stand at a spot whose block below is `below` (Block.canSurvive, for the holdables).
function canStand(key, below, belowKey) {
  if (key === 'cactus') return belowKey === 'sand' || belowKey === 'red_sand' || belowKey === 'cactus';
  if (key.endsWith('fungus') || key.endsWith('roots')) return NETHER_SOIL.has(belowKey);
  if (key.endsWith('mushroom')) return OPAQUE[below] === 1;
  if (BLOCKS[B.FLOWER] && BLOCKS[B.FLOWER].variants.some(v => v.key === key)) return SOIL.has(belowKey);
  return true;
}
const WOOL_COLORS = { white: [1, 1, 1], light_gray: [0.62, 0.62, 0.6], gray: [0.3, 0.32, 0.34], black: [0.1, 0.1, 0.12], brown: [0.5, 0.33, 0.2], pink: [1, 0.6, 0.72] };

// Natural armor and weapons (Java Edition odds, scaled by difficulty).
const ARMORED = { zombie: 'zombie', husk: 'zombie', drowned: 'zombie', skeleton: 'skeleton', stray: 'skeleton' };
const ARMOR_TIERS = [['leather', 0.37], ['golden', 0.49], ['chainmail', 0.129], ['iron', 0.0127], ['diamond', 0.0004]];
function rollEquipment(type, difficulty) {
  const kind = ARMORED[type];
  if (!kind) return null;
  const chance = { easy: 0.06, normal: 0.12, hard: 0.22 }[difficulty] ?? 0.12;
  const eq = { armor: [null, null, null, null], hand: null };
  if (Math.random() < chance) {
    let r = Math.random(), mat = 'leather';
    for (const [m, w] of ARMOR_TIERS) { if ((r -= w) < 0) { mat = m; break; } }
    // Boots first, then leggings, chestplate and helmet, each less likely.
    const stop = difficulty === 'hard' ? 0.1 : 0.25;
    for (const slot of [3, 2, 1, 0]) { eq.armor[slot] = `${mat}_${['helmet', 'chestplate', 'leggings', 'boots'][slot]}`; if (Math.random() < stop) break; }
  }
  if (kind === 'zombie' && Math.random() < (difficulty === 'hard' ? 0.05 : 0.01) * 3) eq.hand = Math.random() < 0.33 ? 'iron_sword' : 'iron_shovel';
  return eq.hand || eq.armor.some(Boolean) ? eq : null;
}

// Rideable animals: speed range (blocks/s), jump strength range, whether they need taming,
// saddle height (where the rider sits, in blocks above the animal's feet).
export const RIDEABLE = {
  horse: { speed: [4.8, 14.5], jump: [0.4, 1.0], seat: 0.85 },
  donkey: { speed: [7.5, 7.5], jump: [0.5, 0.5], seat: 0.8 },
  camel: { speed: [6.8, 6.8], jump: [0.42, 0.42], seat: 1.55, tame: false },
};

const QUIET = new Set(['creeper', 'cod', 'salmon', 'tropical_fish', 'pufferfish', 'squid', 'glow_squid', 'turtle', 'axolotl']);

export class Mob extends Entity {
  constructor(game, type, x, y, z, opts = {}) {
    super(game, type, x, y, z);
    const d = MOBS[type];
    this.def = d; this.mobType = type; this.isLiving = true;
    this.size = opts.size || (d.sizes ? [1, 2, 4][rint(0, 2)] : 1);
    this.baby = !!opts.baby;
    this.equipment = opts.equipment || rollEquipment(type, game.difficulty);
    this.fresh = !!opts.fresh;
    this.saddled = !!opts.saddled;
    if (RIDEABLE[type]) {
      // Per-animal stats, as in the original: horses vary, donkeys are steady.
      const R = RIDEABLE[type];
      this.rideSpeed = opts.rideSpeed ?? (R.speed[0] + Math.random() * (R.speed[1] - R.speed[0]));
      this.jumpStrength = opts.jumpStrength ?? (R.jump[0] + Math.random() * (R.jump[1] - R.jump[0]));
      this.temper = opts.temper ?? 0;
      if (R.tame === false) this.tamed = true;
    }
    const sc = (d.scale || 1) * (d.sizes ? this.size : 1) * (this.baby ? 0.5 : 1);
    this.scale = sc;
    this.hw = d.hw * (d.sizes ? this.size : 1) * (this.baby ? 0.5 : 1);
    this.h = d.h * (d.sizes ? this.size : 1) * (this.baby ? 0.5 : 1);
    this.maxHealth = d.health * (d.sizes ? this.size * this.size : 1);
    this.health = opts.health ?? this.maxHealth;
    this.speed = d.speed * (this.baby ? 1.3 : 1);
    this.stepHeight = 0.6;
    this.yaw = opts.yaw ?? rnd(-Math.PI, Math.PI); this.bodyYaw = this.yaw; this.headPitch = 0;
    this.hurtT = 0; this.invul = 0; this.deathT = 0; this.attackT = 0; this.swing = 0;
    this.walk = 0; this.walkAmt = 0; this.wanderT = rnd(1, 4); this.goal = null;
    this.target = null; this.panic = 0; this.love = 0; this.breedCd = 0; this.growT = this.baby ? 1200 : 0;
    this.persistent = !!(opts.persistent || d.persistent);
    this.home = opts.home || null;
    this.fuse = 0; this.charged = !!opts.charged; this.resting = !!opts.resting;
    this.carried = opts.carried || null; // an enderman's block ([id, meta])
    // A tropical fish's pattern and colours ([pattern 0-11, base colour, pattern colour]).
    if (d.pickFish) this.fish = opts.fish || d.pickFish();
    // Its breed (Java's variant, data/mobs.js): handed down, saved, or picked for where it spawns.
    this.breed = opts.breed !== undefined ? opts.breed : d.pickBreed && game && game.world ? d.pickBreed(game.world.biomeAt(x, z)) : null;
    this.tamed = !!opts.tamed; this.sitting = !!opts.sitting;
    this.sheared = !!opts.sheared;
    this.woolColor = opts.woolColor || (type === 'sheep' ? (Math.random() < 0.82 ? 'white' : ['light_gray', 'gray', 'black', 'brown', 'pink'][rint(0, 4)]) : null);
    this.name = opts.name || null;
    this.air = 15;
    this.fire = 0;
    this.effects = {};
    this.gravity = d.flying ? 0 : 28;
    if (type === 'villager' || type === 'wandering_trader') this.initVillager(opts);
    if (type === 'ender_dragon') dragonInit(this);
    if (d.slowFall) this.slowFall = true;
    this.eggT = rnd(300, 600);
  }

  get displayName() { return this.name || (this.profession && this.profession !== 'nitwit' ? this.profession[0].toUpperCase() + this.profession.slice(1) : this.def.name); }
  get skinKey() { return this.mobType === 'villager' ? `villager_${this.profession}` : this.mobType; }

  initVillager(o) {
    this.profession = this.mobType === 'wandering_trader' ? 'trader' : o.profession || PROFESSIONS[rint(0, PROFESSIONS.length - 1)];
    this.level = o.level || 1; this.xp = o.xp || 0;
    this.trades = o.trades || villagerTrades(this.profession, this.level, true);
    this.persistent = this.mobType === 'villager';
  }

  // ---------------- damage ----------------
  hurt(amount, src = {}) {
    const g = this.game;
    if (this.dead || this.deathT > 0) return false;
    // (Bat.hurt: a hanging bat drops off its perch.)
    this.resting = false;
    if (this.def.fireImmune && (src.kind === 'fire' || src.kind === 'lava')) return false;
    if (this.mobType === 'enderman' && src.kind === 'projectile') { this.teleportRandom(); return false; }
    if (this.mobType === 'wither' && (this.spawnT > 0 || (this.armored && src.kind === 'projectile'))) return false;
    if (this.mobType === 'ender_dragon') { amount = dragonDamage(this, amount, src); if (amount <= 0) return false; }
    const hit = applyInvul(this, amount);
    if (hit.amount <= 0) return false;
    amount = hit.amount;
    if (!ARMOR_BYPASS.has(src.kind)) {
      const { pts, tough } = armorStats(this.equipment ? this.equipment.armor : []);
      amount = armorReduce(amount, pts + (this.def.armor || 0), tough);
    }
    this.health -= amount;
    if (hit.fresh) this.hurtT = 0.4;
    const kr = 1 - (this.def.knockbackResist || 0);
    if (hit.fresh && src.knock && kr > 0) {
      const k = (src.knockStrength || 5) * kr;
      this.vel[0] += src.knock[0] * k; this.vel[2] += src.knock[1] * k;
      if (this.onGround || this.def.flying) this.vel[1] = Math.max(this.vel[1], 4 * kr);
    }
    g.sound.mob(this.mobType, 'hurt', this.pos, this);
    const atk = src.attacker;
    if (atk && atk !== this) {
      if (this.def.kind === 'passive' || this.def.ai === 'animal') this.panic = 5;
      if (this.def.kind === 'neutral' || this.def.kind === 'hostile' || this.def.ai === 'golem' || this.mobType === 'wolf' || this.mobType === 'goat') this.target = atk;
      if (this.def.groupAnger) for (const o of g.entities.near(this.pos, 20, e => e.mobType === this.mobType)) o.target = atk;
      if (this.mobType === 'wolf' && this.tamed && atk === g.playerEntity) this.target = null;
    }
    if (this.health <= 0) this.die(src);
    return true;
  }
  die(src) {
    const g = this.game, d = this.def;
    this.health = 0;
    this.deathT = 0.001;
    g.sound.mob(this.mobType, 'death', this.pos, this);
    const byPlayer = src.attacker === g.playerEntity || (src.attacker && (src.attacker.tamed || src.attacker.remote));
    const onFire = this.fire > 0;
    if (!this.baby && g.rules.doMobLoot) {
      for (const [key, a, b, chance] of d.drops || []) {
        if (chance !== undefined && Math.random() >= chance) continue;
        // Looting adds 0..level to each drop when the player made the kill.
        const n = rint(a, b) + (byPlayer && src.looting ? rint(0, src.looting) : 0);
        const k = onFire && d.cooked && d.cooked[key] ? d.cooked[key] : key;
        if (n > 0) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], { key: k, count: n });
      }
      if (this.carried) { const k = blockKey(...this.carried); if (k && I[k]) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], { key: k, count: 1 }); }
      if (d.woolDrop && !this.sheared) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], { key: `${this.woolColor}_wool`, count: 1 });
      if (this.mobType === 'creeper' && src.attacker && src.attacker.mobType === 'skeleton') g.dropItem(this.pos[0], this.pos[1], this.pos[2], { key: 'music_disc' in {} ? 'music_disc' : 'gunpowder', count: 1 });
      if (this.equipment && byPlayer) for (const k of [...this.equipment.armor, this.equipment.hand]) if (k && Math.random() < 0.085) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], { key: k, count: 1, dmg: I[k] && I[k].durability ? Math.floor(I[k].durability * (0.3 + Math.random() * 0.6)) : undefined });
      if (byPlayer && d.xp) g.spawnXp(this.pos, rint(d.xp[0], d.xp[1]) * (d.sizes ? this.size : 1));
    }
    if (d.sizes && this.size > 1) for (let k = 0; k < rint(2, 4); k++) g.spawnMob(this.mobType, this.pos[0] + rnd(-0.5, 0.5), this.pos[1] + 0.5, this.pos[2] + rnd(-0.5, 0.5), { size: this.size / 2 });
    if (src.attacker === g.playerEntity) g.onKill(this);
  }
  // Entity.isInRain: rain falling where it stands, or at the top of it.
  inRain() { const g = this.game; return g.rainAt(this.pos[0], this.pos[1], this.pos[2]) || g.rainAt(this.pos[0], this.pos[1] + this.h, this.pos[2]); }
  setFire(s) { if (!this.def.fireImmune) this.fire = Math.max(this.fire, s); }
  teleportRandom() {
    const w = this.world;
    for (let k = 0; k < 16; k++) {
      const x = this.pos[0] + rnd(-16, 16), z = this.pos[2] + rnd(-16, 16);
      for (let y = Math.floor(this.pos[1]) + 8; y > this.pos[1] - 12; y--) {
        const id = w.getBlock(x, y, z);
        if (id !== UNLOADED && SOLID[id] && w.getBlock(x, y + 1, z) === B.AIR && w.getBlock(x, y + 2, z) === B.AIR && w.getBlock(x, y + 3, z) === B.AIR) {
          this.game.particles.fx('portal', this.center(), 20, 0.5);
          this.pos = [Math.floor(x) + 0.5, y + 1, Math.floor(z) + 0.5];
          this.game.sound.play('teleport', this.pos, 0.6);
          this.game.particles.fx('portal', this.center(), 20, 0.5);
          return true;
        }
      }
    }
    return false;
  }

  // ---------------- helpers ----------------
  // The player this mob pays attention to: the local one, or in multiplayer whoever is nearest.
  get focus() { return (this.game.net && this._focus) || this.game.playerEntity; }
  playerTargetable(t = this.focus) {
    const g = this.game;
    if (g.difficulty === 'peaceful') return false;
    if (t && t.remote) return t.visible && !t.deadFlag && (t.mode === 'survival' || t.mode === 'adventure');
    return g.alive && (g.mode === 'survival' || g.mode === 'adventure' || g.mode === 'hardcore');
  }
  distToPlayer() { const p = this.focus.pos; return Math.hypot(p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]); }
  canSee(t) {
    const e = [this.pos[0], this.pos[1] + this.h * 0.85, this.pos[2]];
    const tp = t.pos, th = t.h || 1.6;
    const d = [tp[0] - e[0], tp[1] + th * 0.8 - e[1], tp[2] - e[2]], len = Math.hypot(...d);
    if (len < 0.5) return true;
    const hit = this.world.raycast(e, d.map(v => v / len), len);
    return !hit || !SOLID[hit.id] || hit.id === B.LEAVES;
  }
  targetPos() { const t = this.target; return t ? t.pos : null; }
  lookAt(p, rate = 8, dt = 0.05) {
    const dx = p[0] - this.pos[0], dz = p[2] - this.pos[2];
    const want = Math.atan2(-dx, -dz);
    this.yaw += wrap(want - this.yaw) * Math.min(1, rate * dt);
    const dy = p[1] + 1.2 - (this.pos[1] + this.h * 0.85);
    this.headPitch = Math.atan2(dy, Math.hypot(dx, dz)) * 0.8;
  }
  // Steer horizontally toward p at speed; jumps over single blocks; avoids cliffs and liquids for land mobs.
  moveTo(p, speed, dt) {
    const dx = p[0] - this.pos[0], dz = p[2] - this.pos[2], d = Math.hypot(dx, dz);
    if (d < 0.3) return true;
    this.lookAt(p, 6, dt);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (!this.def.flying && !this.def.swim && this.onGround && !this.target && !this.followingPath) {
      const ax = this.pos[0] + fx * 0.9, az = this.pos[2] + fz * 0.9;
      let drop = 0;
      for (let k = 0; k < 4 && !SOLID[this.world.getBlock(ax, this.pos[1] - 1 - k, az)]; k++) drop++;
      const ahead = this.world.getBlock(ax, this.pos[1], az), below = this.world.getBlock(ax, this.pos[1] - 1, az);
      if (drop >= 3 || below === B.LAVA || ahead === B.LAVA || ((below === B.WATER) && !this.def.amphibious)) { this.goal = null; this.wanderT = 0.5; return false; }
    }
    const k = 1 - Math.exp(-(this.onGround || this.inWater || this.def.flying ? 12 : 3) * dt);
    this.vel[0] += (fx * speed - this.vel[0]) * k;
    this.vel[2] += (fz * speed - this.vel[2]) * k;
    if (this.collidedH && this.onGround) { this.vel[1] = this.def.hop ? 6 : 8.4; this.stuck = (this.stuck || 0) + dt; }
    else if (this.def.hop && this.onGround) this.vel[1] = 5;
    if (this.def.climbs && this.collidedH) this.vel[1] = 3;
    if (this.inWater && !this.def.swim && this.pos[1] < this.waterSurface()) this.vel[1] = Math.max(this.vel[1], 2.2);
    return false;
  }
  waterSurface() { let y = Math.floor(this.pos[1]); while (this.world.getBlock(this.pos[0], y + 1, this.pos[2]) === B.WATER && y < 255) y++; return y + 0.5; }
  wander(dt, radius = 8, speed = this.speed * 0.45) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = rnd(3, 9);
      if (Math.random() < 0.35) { this.goal = null; return; }
      const cx = this.home && Math.hypot(this.home[0] - this.pos[0], this.home[2] - this.pos[2]) > 24 ? this.home : this.pos;
      this.goal = [cx[0] + rnd(-radius, radius), this.pos[1], cx[2] + rnd(-radius, radius)];
    }
    if (this.goal) { if (this.navigateTo(this.goal, speed, dt)) this.goal = null; if (this.stuck > 1.5 || this.noPath) { this.goal = null; this.stuck = 0; this.noPath = false; this.wanderT = Math.min(this.wanderT, 0.5); } }
    else this.brake(dt);
  }
  // Walk towards p: straight at it when the way is clear, otherwise along an A* path that
  // steps up blocks, drops down safely, goes around walls and through doorways.
  navigateTo(p, speed, dt) {
    const d = this.def, g = this.game;
    this.followingPath = false;
    if (d.flying || d.swim || d.hop || this.inWater) { this.path = null; return this.moveTo(p, speed, dt); }
    const dist = Math.hypot(p[0] - this.pos[0], p[2] - this.pos[2]);
    if (this.age - (this.clearT ?? -9) > 0.35) { this.clearT = this.age; this.lastClear = dist < 20 && clearWalk(this.world, this.pos, p, Math.ceil(this.h)); }
    if (this.lastClear) { this.path = null; this.closeDoors(); return this.moveTo(p, speed, dt); }
    const goalMoved = !this.pathGoal || Math.hypot(this.pathGoal[0] - p[0], this.pathGoal[2] - p[2]) > 2.5;
    if ((!this.path || goalMoved || this.stuck > 0.8) && this.age >= (this.repathT || 0) && g.pathBudget > 0) {
      g.pathBudget--;
      this.repathT = this.age + 0.6 + Math.random() * 0.4; this.stuck = 0;
      const r = findPath(this.world, this.pos, p, { height: Math.ceil(this.h), doors: this.mobType === 'villager' || this.mobType === 'wandering_trader', maxNodes: this.target ? 900 : 500 });
      this.path = r && r.points.length ? r.points : null; this.pathI = 0; this.pathGoal = p.slice();
      this.noPath = !this.path;
    }
    if (!this.path) { if (this.target) return this.moveTo(p, speed, dt); this.brake(dt); return false; }
    let wp = this.path[this.pathI];
    if (Math.hypot(wp[0] - this.pos[0], wp[2] - this.pos[2]) < 0.45 && Math.abs(wp[1] - this.pos[1]) < 1.3) {
      if (++this.pathI >= this.path.length) { this.path = null; this.closeDoors(); return dist < 1.5; }
      wp = this.path[this.pathI];
    }
    if (this.mobType === 'villager' || this.mobType === 'wandering_trader') this.openDoorAt(wp);
    this.followingPath = true;
    this.moveTo(wp, speed, dt);
    return false;
  }
  openDoorAt(wp) {
    const w = this.world;
    for (const dy of [0, 1]) {
      const x = Math.floor(wp[0]), y = Math.floor(wp[1]) + dy, z = Math.floor(wp[2]);
      if (w.getBlock(x, y, z) !== B.DOOR) continue;
      const m = w.getMeta(x, y, z);
      if (!((m >> 5) & 1)) { this.game.setBlock(x, y, z, B.DOOR, m | 32); this.game.sound.play('door_open', [x, y, z], 0.5); (this.openedDoors ||= []).push([x, y, z]); }
    }
  }
  closeDoors() {
    if (!this.openedDoors) return;
    const w = this.world;
    this.openedDoors = this.openedDoors.filter(([x, y, z]) => {
      if (Math.hypot(x + 0.5 - this.pos[0], z + 0.5 - this.pos[2]) < 1.6) return true;
      const m = w.getMeta(x, y, z);
      if (w.getBlock(x, y, z) === B.DOOR && (m >> 5) & 1) this.game.setBlock(x, y, z, B.DOOR, m & ~32);
      return false;
    });
  }
  brake(dt) { const k = Math.exp(-10 * dt); if (this.onGround) { this.vel[0] *= k; this.vel[2] *= k; } }
  flee(from, dt, speed) {
    const dx = this.pos[0] - from[0], dz = this.pos[2] - from[2], d = Math.hypot(dx, dz) || 1;
    this.moveTo([this.pos[0] + dx / d * 6, this.pos[1], this.pos[2] + dz / d * 6], speed, dt);
  }
  // Pursuit speed: close to the player's 4.3 b/s walk so fights are real. Zombies are a touch
  // slower than walking, spiders and babies faster, angry endermen faster than a sprint.
  chaseSpeed() {
    const d = this.def;
    let s = d.chase ?? Math.min(5.2, Math.max(3.9, this.speed * 1.7));
    if (this.baby) s *= 1.35;
    if (this.effectSlow) s *= 0.6;
    return s;
  }
  meleeTarget(dt, reach = null) {
    const t = this.target, a = this.def.attack;
    if (!t || !a) return;
    const d = Math.hypot(t.pos[0] - this.pos[0], t.pos[2] - this.pos[2]);
    const dy = Math.abs(t.pos[1] - this.pos[1]);
    reach = reach ?? this.hw + (t.hw || 0.3) + 0.9;
    if (d > reach * 0.8) this.navigateTo(t.pos, this.chaseSpeed(), dt); else { this.lookAt(t.pos, 10, dt); this.brake(dt); }
    if (a.leap && this.onGround && d < 4 && d > 2 && Math.random() < dt * 1.5) { const n = d || 1; this.vel[0] = (t.pos[0] - this.pos[0]) / n * 6; this.vel[2] = (t.pos[2] - this.pos[2]) / n * 6; this.vel[1] = 6; }
    if (d < reach && dy < 2.2 && this.attackT <= 0) {
      this.attackT = a.cd;
      this.swing = 1;
      this.doAttack(t);
    }
  }
  doAttack(t) {
    const a = this.def.attack, g = this.game;
    const diffMul = { peaceful: 0, easy: 0.6, normal: 1, hard: 1.5 }[g.difficulty] ?? 1;
    let dmg = a.dmg * ((t === g.playerEntity || t.remote) ? diffMul : 1);
    if (this.mobType === 'iron_golem') dmg = rnd(7, 21) * ((t === g.playerEntity || t.remote) ? diffMul : 1);
    const weapon = this.equipment && this.equipment.hand;
    if (weapon && I[weapon] && I[weapon].damage) dmg += (I[weapon].damage - 1) * ((t === g.playerEntity || t.remote) ? diffMul : 1);
    const dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], n = Math.hypot(dx, dz) || 1;
    const ok = t.hurt(dmg, { kind: 'mob', attacker: this, knock: [dx / n, dz / n], knockStrength: a.fling ? 12 : 5 });
    if (ok) {
      if (a.fling) t.vel[1] = 9 * a.fling;
      if (a.poison && t.addEffect && g.difficulty !== 'easy') t.addEffect('poison', a.poison);
      if (a.wither && t.addEffect) t.addEffect('wither', a.wither);
      if (a.hunger && t.addEffect) t.addEffect('hunger', a.hunger);
      if (this.fire > 0 && t.setFire) t.setFire(4);
    }
  }
  shoot(kind, target, speed = 30) {
    const g = this.game;
    const e = [this.pos[0], this.pos[1] + this.h * 0.8, this.pos[2]];
    const tp = [target.pos[0], target.pos[1] + (target.h || 1.6) * 0.6, target.pos[2]];
    const dx = tp[0] - e[0], dz = tp[2] - e[2], hd = Math.hypot(dx, dz);
    let dy = tp[1] - e[1];
    if (kind === 'arrow' || kind === 'snowball' || kind === 'potion') dy += hd * hd * (kind === 'arrow' ? 20 : 12) / (2 * speed * speed);
    const len = Math.hypot(dx, dy, dz) || 1;
    const inacc = { easy: 0.12, normal: 0.07, hard: 0.03 }[g.difficulty] ?? 0.07;
    const v = [dx / len * speed + rnd(-1, 1) * inacc * speed, dy / len * speed + rnd(-1, 1) * inacc * speed, dz / len * speed + rnd(-1, 1) * inacc * speed];
    const pk = kind === 'potion' ? 'snowball' : kind;
    const pr = new Projectile(g, pk, e[0] + dx / len * 0.6, e[1], e[2] + dz / len * 0.6, v, this);
    if (kind === 'potion') { pr.kind = 'potion'; pr.potion = Math.random() < 0.5 ? 'poison' : 'harm'; }
    g.entities.add(pr);
    g.sound.play(kind === 'arrow' ? 'bow' : kind.includes('fireball') ? 'fireball' : 'throw', this.pos, 0.6);
  }

  // ---------------- update ----------------
  update(dt) {
    const g = this.game, d = this.def;
    if (this.deathT > 0) {
      this.deathT += dt;
      if (this.mobType === 'ender_dragon') { dragonDying(this, dt); return; }
      this.physics(dt);
      if (this.deathT > 1) { this.dead = true; g.particles.smoke(this.center(), 8); }
      return;
    }
    this.invul = Math.max(0, this.invul - dt); this.hurtT = Math.max(0, this.hurtT - dt);
    this.attackT -= dt; this.swing = Math.max(0, this.swing - dt * 3); this.breedCd -= dt;
    if (this.castT > 0) this.castT -= dt;
    if (this.love > 0) { this.love -= dt; if (Math.random() < dt * 3) g.particles.fx('heart', [this.pos[0], this.pos[1] + this.h + 0.2, this.pos[2]], 1, 0.3); }
    if (this.baby) { this.growT -= dt; if (this.growT <= 0) this.growUp(); }
    for (const k of Object.keys(this.effects)) {
      this.effects[k] -= dt;
      if (k === 'poison' && Math.random() < dt && this.health > 1) this.hurt(1, { kind: 'magic' });
      if (this.effects[k] <= 0) delete this.effects[k];
    }
    this.environment(dt);
    if (this.dead) return;
    if (g.net) { this.focusT = (this.focusT || 0) - dt; if (this.focusT <= 0 || !this._focus) { this.focusT = 0.5; this._focus = g.nearestPlayer(this.pos); } }
    this.ai(dt);
    // Idle voices: moos, bleats, groans and rattles every so often while near the player.
    if (this.deathT <= 0 && !QUIET.has(this.mobType)) {
      this.ambT = (this.ambT ?? rnd(2, 12)) - dt;
      if (this.ambT <= 0) { this.ambT = rnd(7, 18); if (this.distToPlayer() < 20) this.game.sound.mob(this.mobType, 'ambient', this.pos, this); }
    }
    // Bosses show a health bar to nearby players (the nearest boss wins).
    if (this.def.kind === 'boss' && this.deathT <= 0) {
      const g = this.game, d = this.distToPlayer();
      if (d < 128 && (!g.bossBar || d < g.bossBar.dist)) g.bossBar = { name: this.name || this.def.name, frac: Math.max(0, this.health / this.maxHealth), color: this.def.bossColor || '#e070ff', dist: d };
    }
    // Physics per archetype.
    if (d.flying) this.flyPhysics(dt);
    else if (d.swim && this.inWater) this.swimPhysics(dt);
    else {
      this.physics(dt, { groundFriction: 0.6 });
      if (this.slowFall && this.vel[1] < -2) this.vel[1] = -2;
    }
    const sp = Math.hypot(this.pos[0] - this.prev[0], this.pos[2] - this.prev[2]) / Math.max(dt, 1e-4);
    this.walkAmt += (Math.min(1, sp / 3) - this.walkAmt) * Math.min(1, dt * 8);
    this.walk += sp * dt * 2.2;
    this.bodyYaw += wrap(this.yaw - this.bodyYaw) * Math.min(1, dt * (sp > 0.3 ? 10 : 3));
    // Despawn far hostiles.
    if (!this.persistent && !this.name && !this.tamed && d.kind === 'hostile') {
      const dp = this.distToPlayer();
      if (dp > 128 || (dp > 40 && Math.random() < dt / 30)) this.dead = true;
    }
  }
  flyPhysics(dt) {
    this.prev = this.pos.slice();
    const k = Math.exp(-2 * dt);
    this.vel[0] *= k; this.vel[1] *= k; this.vel[2] *= k;
    const steps = Math.max(1, Math.ceil(Math.hypot(...this.vel) * dt / 0.45));
    if (this.mobType === 'ender_dragon' || this.mobType === 'ghast' || this.mobType === 'wither') { this.pos[0] += this.vel[0] * dt; this.pos[1] += this.vel[1] * dt; this.pos[2] += this.vel[2] * dt; return; }
    for (let i = 0; i < steps; i++) import_move(this, dt / steps);
  }
  swimPhysics(dt) {
    this.prev = this.pos.slice();
    const k = Math.exp(-1.5 * dt);
    this.vel[0] *= k; this.vel[1] *= k; this.vel[2] *= k;
    import_move(this, dt);
    if (this.world.getBlock(this.pos[0], this.pos[1] + this.h, this.pos[2]) !== B.WATER && this.vel[1] > 0) this.vel[1] *= 0.5;
  }
  environment(dt) {
    const g = this.game, d = this.def, w = this.world;
    const feet = w.getBlock(this.pos[0], this.pos[1] + 0.1, this.pos[2]);
    if (feet === B.LAVA && !d.fireImmune && !d.lavaWalker) { this.setFire(8); this.hurt(4, { kind: 'lava' }); }
    // A strider is cold (Strider.isSuffocating) unless it stands in or on lava.
    if (d.lavaWalker) this.cold = !(this.inLava || feet === B.LAVA || w.getBlock(this.pos[0], this.pos[1] - 0.2, this.pos[2]) === B.LAVA);
    if ((feet === B.FIRE || feet === B.CAMPFIRE) && !d.fireImmune) { this.setFire(8); this.inFireT = (this.inFireT || 0) + dt; if (this.inFireT > 0.5) { this.inFireT = 0; this.hurt(1, { kind: 'fire' }); } }
    if ((feet === B.FIRE || feet === B.CAMPFIRE) && !d.fireImmune) this.setFire(4);
    if (this.fire > 0) {
      this.fire -= dt;
      if (this.inWater) this.fire = 0;
      if (Math.floor(this.fire * 1) !== Math.floor((this.fire + dt) * 1)) this.hurt(1, { kind: 'fire' });
      if (Math.random() < dt * 8) g.particles.fx('flame', [this.pos[0] + rnd(-this.hw, this.hw), this.pos[1] + rnd(0, this.h), this.pos[2] + rnd(-this.hw, this.hw)], 1, 0.05, 0.3);
    }
    // Undead burn in daylight.
    if (d.burns && g.isDay() && g.dim === 0 && !this.inWater) {
      const l = w.lightAt(this.pos[0], this.pos[1] + this.h, this.pos[2]);
      if (l.sky >= 15 && !this.inRain() && Math.random() < dt * 2) this.setFire(8);
    }
    if (d.hurtByWater && (this.inWater || this.inRain()) && Math.random() < dt * 2) this.hurt(1, { kind: 'drown' });
    if (d.hatesWater && (this.inWater || this.inRain()) && Math.random() < dt * 2) { this.hurt(1, { kind: 'drown' }); this.teleportRandom(); }
    // Fish out of water.
    if (d.ai === 'fish' || this.mobType === 'squid' || this.mobType === 'glow_squid' || this.mobType === 'dolphin') {
      if (!this.inWater) { this.air -= dt; if (this.onGround && Math.random() < dt * 3) { this.vel[1] = 4; this.vel[0] = rnd(-2, 2); this.vel[2] = rnd(-2, 2); } if (this.air < 0 && Math.random() < dt) this.hurt(1, { kind: 'drown' }); }
      else this.air = 15;
    } else if (!d.swim && !d.amphibious && !d.undead && this.mobType !== 'iron_golem') {
      const head = w.getBlock(this.pos[0], this.pos[1] + this.h * 0.9, this.pos[2]);
      if (head === B.WATER) { this.air -= dt; if (this.air < 0 && Math.random() < dt) this.hurt(2, { kind: 'drown' }); } else this.air = 15;
    }
    if (d.meltsInHeat && (this.inWater || g.biomeTemp(this.pos) > 1) && Math.random() < dt) this.hurt(1, { kind: 'fire' });
    if (this.mobType === 'snow_golem' && this.onGround && Math.random() < dt * 4) {
      const x = this.pos[0], y = Math.floor(this.pos[1]), z = this.pos[2];
      if (w.getBlock(x, y, z) === B.AIR && SOLID[w.getBlock(x, y - 1, z)] && g.biomeTemp(this.pos) < 0.8 && g.rules.mobGriefing) g.setBlock(x, y, z, B.SNOW, 0);
    }
    if (this.pos[1] < -64) this.dead = true;
  }

  ai(dt) {
    const d = this.def, g = this.game;
    if (this.rider) return; // steered by (or bucking) its rider
    if (this.target && (this.target.dead || this.target.deathT > 0 || ((this.target === g.playerEntity || this.target.remote) && !this.playerTargetable(this.target)) || this.distTo(this.target.pos) > 40)) this.target = null;
    switch (d.ai) {
      case 'animal': return this.aiAnimal(dt);
      case 'wolf': return this.aiWolf(dt);
      case 'neutral': return this.target ? this.meleeTarget(dt) : this.aiAnimal(dt);
      case 'melee': return this.aiHostileMelee(dt);
      case 'ranged': return this.aiRanged(dt);
      case 'creeper': return this.aiCreeper(dt);
      case 'enderman': return this.aiEnderman(dt);
      case 'slime': return this.aiSlime(dt);
      case 'swimmer': case 'fish': return this.aiSwim(dt);
      case 'guardian': return this.aiGuardian(dt);
      case 'bat': case 'flyer': return this.aiFlyer(dt);
      case 'phantom': return this.aiPhantom(dt);
      case 'blaze': return this.aiBlaze(dt);
      case 'ghast': return this.aiGhast(dt);
      case 'golem': return this.aiGolem(dt);
      case 'snowgolem': return this.aiSnowGolem(dt);
      case 'villager': return this.aiVillager(dt);
      case 'dragon': return this.aiDragon(dt);
      case 'wither': return this.aiWither(dt);
      default: return this.wander(dt);
    }
  }
  seekPlayer(range = 16) {
    const g = this.game;
    if (this.target || !this.playerTargetable()) return;
    if (this.distToPlayer() > range) return;
    const f = this.focus, armor = f.remote ? f.armor : g.inv.armor.slots.map(s => s && s.key);
    if (this.def.goldCalm && armor.some(k => k && k.startsWith('golden_'))) return;
    if (this.def.neutralInDay && g.isDay() && this.world.lightAt(this.pos[0], this.pos[1] + 1, this.pos[2]).sky > 11) return;
    if (this.canSee(f)) this.target = f;
  }
  aiAnimal(dt) {
    const g = this.game, d = this.def;
    if (this.panic > 0) { this.panic -= dt; const s = this.focus.pos; this.flee(s, dt, this.speed * 1.6); return; }
    if (d.shy && this.distToPlayer() < 6 && !this.love) { this.flee(this.focus.pos, dt, this.speed * 1.3); return; }
    // Breeding partners.
    if (this.love > 0 && !this.baby) {
      const mate = g.entities.near(this.pos, 8, e => e !== this && e.mobType === this.mobType && e.love > 0 && !e.baby)[0];
      if (mate) {
        this.navigateTo(mate.pos, this.speed * 0.8, dt);
        if (this.distTo(mate.pos) < 1.5 + this.hw) {
          this.love = 0; mate.love = 0; this.breedCd = mate.breedCd = 300;
          g.spawnMob(this.mobType, this.pos[0], this.pos[1] + 0.2, this.pos[2], { baby: true, woolColor: Math.random() < 0.5 ? this.woolColor : mate.woolColor, breed: this.def.childBreed ? this.def.childBreed(this.breed, mate.breed, g.world.biomeAt(this.pos[0], this.pos[2])) : Math.random() < 0.5 ? this.breed : mate.breed });
          g.spawnXp(this.pos, rint(1, 7));
        }
        return;
      }
    }
    // Follow a player holding food.
    const fp = this.focus, heldKey = fp.remote ? fp.held : g.inv.held && g.inv.held.key;
    if (d.food && heldKey && d.food.includes(heldKey) && this.distToPlayer() < 10 && (fp.remote ? fp.visible : g.alive)) {
      if (this.distToPlayer() > 2.2) this.navigateTo(fp.pos, this.speed * 0.6, dt); else { this.lookAt(fp.pos, 6, dt); this.brake(dt); }
      return;
    }
    if (this.mobType === 'chicken' && !this.baby) { this.eggT -= dt; if (this.eggT <= 0) { this.eggT = rnd(300, 600); g.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], { key: 'egg', count: 1 }); g.sound.play('pop', this.pos, 0.4); } }
    if (this.mobType === 'sheep' && this.sheared && Math.random() < dt / 40) {
      const b = this.world.getBlock(this.pos[0], this.pos[1] - 0.5, this.pos[2]);
      if (b === B.GRASS_BLOCK) { this.sheared = false; g.setBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.5), Math.floor(this.pos[2]), B.DIRT, 0); }
    }
    if (this.mobType === 'goat' && this.playerTargetable() && this.distToPlayer() < 8 && Math.random() < dt / 20) { this.target = this.focus; this.ramT = 2; }
    if (this.ramT > 0) { this.ramT -= dt; if (this.target) { this.moveTo(this.target.pos, this.speed * 2.2, dt); if (this.distTo(this.target.pos) < 1.4) { this.target.hurt(2, { kind: 'mob', attacker: this, knock: [-Math.sin(this.yaw), -Math.cos(this.yaw)], knockStrength: 14 }); this.target = null; this.ramT = 0; } } return; }
    this.wander(dt);
  }
  aiWolf(dt) {
    const g = this.game;
    if (this.target && (this.target !== g.playerEntity || !this.tamed)) { this.meleeTarget(dt); return; }
    if (this.tamed) {
      if (this.sitting) { this.brake(dt); return; }
      const op = g.player.pos, d = Math.hypot(op[0] - this.pos[0], op[1] - this.pos[1], op[2] - this.pos[2]);
      if (d > 14 && g.alive) { this.pos = [g.player.pos[0] + rnd(-1, 1), g.player.pos[1], g.player.pos[2] + rnd(-1, 1)]; return; }
      if (d > 3.5) { this.navigateTo(g.player.pos, this.speed * 1.1, dt); return; }
      // Defend the owner.
      const foe = g.lastAttackedBy && !g.lastAttackedBy.dead && g.lastAttackedBy !== this ? g.lastAttackedBy : g.lastTarget && !g.lastTarget.dead && g.lastTarget !== this ? g.lastTarget : null;
      if (foe && foe.isLiving && foe.distTo(this.pos) < 16) this.target = foe;
      this.brake(dt);
      return;
    }
    const prey = g.entities.near(this.pos, 12, e => e.mobType === 'sheep' || e.mobType === 'rabbit' || e.mobType === 'fox')[0];
    if (prey && Math.random() < dt / 20) this.target = prey;
    this.aiAnimal(dt);
  }
  aiHostileMelee(dt) {
    const g = this.game;
    this.seekPlayer(this.def.undead ? 32 : 16);
    if (!this.target && (this.mobType === 'zombie' || this.mobType === 'husk' || this.mobType === 'drowned')) {
      const v = g.entities.near(this.pos, 16, e => e.mobType === 'villager' || e.mobType === 'wandering_trader')[0];
      if (v) this.target = v;
    }
    if (this.def.raider && !this.target) {
      const v = g.entities.near(this.pos, 16, e => e.mobType === 'villager' || e.mobType === 'iron_golem')[0];
      if (v) this.target = v;
    }
    if (this.target) this.meleeTarget(dt);
    else this.wander(dt);
  }
  aiRanged(dt) {
    const g = this.game, a = this.def.attack;
    this.seekPlayer(a.range + 4);
    if (this.def.raider && !this.target) { const v = g.entities.near(this.pos, 16, e => e.mobType === 'villager' || e.mobType === 'iron_golem')[0]; if (v) this.target = v; }
    const t = this.target;
    if (!t) { this.wander(dt); return; }
    const d = this.distTo(t.pos);
    const see = this.canSee(t);
    this.lookAt(t.pos, 10, dt);
    if (d > a.range * 0.7 || !see) this.navigateTo(t.pos, this.chaseSpeed() * 0.9, dt);
    else if (d < 4) this.flee(t.pos, dt, this.speed);
    else {
      this.strafe = this.strafe || (Math.random() < 0.5 ? 1 : -1);
      if (Math.random() < dt * 0.3) this.strafe *= -1;
      const rx = Math.cos(this.yaw) * this.strafe, rz = -Math.sin(this.yaw) * this.strafe;
      this.vel[0] += (rx * this.speed * 0.5 - this.vel[0]) * Math.min(1, dt * 6);
      this.vel[2] += (rz * this.speed * 0.5 - this.vel[2]) * Math.min(1, dt * 6);
    }
    if (see && d < a.range && this.attackT <= 0) {
      this.attackT = a.cd * rnd(0.8, 1.3);
      this.swing = 1;
      if (a.ranged === 'fangs') { this.evokerFangs(t); this.castT = 1.5; }
      else this.shoot(a.ranged, t, a.ranged === 'arrow' ? 32 : 22);
    }
  }
  evokerFangs(t) {
    const g = this.game;
    const dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], n = Math.hypot(dx, dz) || 1;
    for (let k = 1; k <= 12; k++) {
      const p = [this.pos[0] + dx / n * k * 1.2, this.pos[1], this.pos[2] + dz / n * k * 1.2];
      g.later(k * 0.06, () => {
        g.particles.fx('spark', [p[0], p[1] + 0.5, p[2]], 6, 0.4, 1);
        g.sound.play('fangs', p, 0.4);
        for (const e of [g.playerEntity, ...g.entities.near(p, 1.2, o => o.isLiving && o !== this && !o.def.raider)]) if (e && Math.hypot(e.pos[0] - p[0], e.pos[2] - p[2]) < 1 && Math.abs(e.pos[1] - p[1]) < 2) e.hurt(6, { kind: 'magic', attacker: this });
      });
    }
    if (Math.random() < 0.3) for (let k = 0; k < 2; k++) g.spawnMob('silverfish', this.pos[0], this.pos[1] + 1, this.pos[2]);
  }
  aiCreeper(dt) {
    const g = this.game;
    this.seekPlayer(16);
    const t = this.target;
    if (!t) { this.fuse = Math.max(0, this.fuse - dt); this.wander(dt); return; }
    const d = this.distTo(t.pos);
    if (d < 3 || (this.fuse > 0 && d < 7)) {
      if (this.fuse === 0) g.sound.play('fuse', this.pos, 0.8);
      this.fuse += dt; this.brake(dt); this.lookAt(t.pos, 8, dt);
      if (this.fuse >= 1.5) {
        this.dead = true;
        g.explode([this.pos[0], this.pos[1] + 0.8, this.pos[2]], this.charged ? 6 : 3, { source: this, breakBlocks: g.rules.mobGriefing });
      }
    } else { this.fuse = Math.max(0, this.fuse - dt * 2); this.navigateTo(t.pos, this.chaseSpeed(), dt); }
  }
  // EndermanTakeBlockGoal / EndermanLeaveBlockGoal: an empty-handed enderman tries a random block
  // near it 1 tick in 10 and picks it up if it is holdable and in plain sight; one carrying a block
  // sets it down nearby about 1 tick in 1000 where it can stand. Only with mobGriefing.
  endermanBlocks(dt) {
    const g = this.game, w = this.world, r = Math.random, ticks = dt * 20;
    if (!g.rules.mobGriefing) return;
    const [ex, ey, ez] = this.pos;
    if (!this.carried) {
      if (r() >= 1 - 0.9 ** ticks) return;
      const x = Math.floor(ex - 2 + r() * 4), y = Math.floor(ey + r() * 3), z = Math.floor(ez - 2 + r() * 4);
      const id = w.getBlock(x, y, z), m = w.getMeta(x, y, z), k = id > 0 && blockKey(id, m);
      if (!k || !HOLDABLE.has(k)) return;
      const o = [Math.floor(ex) + 0.5, y + 0.5, Math.floor(ez) + 0.5], dv = [x + 0.5 - o[0], 0, z + 0.5 - o[2]], len = Math.hypot(dv[0], dv[2]);
      const hit = len > 0 ? w.raycast(o, [dv[0] / len, 0, dv[2] / len], len + 0.5) : { x, y, z };
      if (!hit || hit.x !== x || hit.y !== y || hit.z !== z) return;
      this.carried = [id, m & VARIANT_MASK[id]];
      g.setBlock(x, y, z, B.AIR, 0);
    } else {
      if (r() >= 1 - 0.999 ** ticks) return;
      const x = Math.floor(ex - 1 + r() * 2), y = Math.floor(ey + r() * 2), z = Math.floor(ez - 1 + r() * 2);
      const below = w.getBlock(x, y - 1, z), k = blockKey(...this.carried);
      if (w.getBlock(x, y, z) !== B.AIR || below <= 0 || below === B.BEDROCK || !OPAQUE[below] || !k || !canStand(k, below, blockKey(below, w.getMeta(x, y - 1, z)))) return;
      g.setBlock(x, y, z, this.carried[0], this.carried[1]);
      this.carried = null;
    }
  }
  aiEnderman(dt) {
    const g = this.game;
    this.endermanBlocks(dt);
    if (!this.target && !this.focus.remote && this.playerTargetable() && this.distToPlayer() < 64) {
      // Aggro when the player looks straight at the head (a carved pumpkin helmet hides you).
      const e = g.player.eyePos(), f = g.lookDir();
      const h = [this.pos[0] - e[0], this.pos[1] + this.h * 0.9 - e[1], this.pos[2] - e[2]], len = Math.hypot(...h);
      const dot = (h[0] * f[0] + h[1] * f[1] + h[2] * f[2]) / len;
      if (dot > 1 - 0.025 / Math.max(1, len * 0.1) && this.canSee(g.playerEntity) && g.inv.armor.get(0)?.key !== 'carved_pumpkin') {
        this.target = g.playerEntity; this.stareT = 0.6; this.screamT = 0;
        g.sound.play('enderman_stare', this.pos, 1);
      }
    }
    if (this.target) {
      this.angry = true;
      // A brief frozen, trembling stare, then it rushes (and blinks closer when far away).
      if (this.stareT > 0) { this.stareT -= dt; this.lookAt(this.target.pos, 20, dt); this.brake(dt); return; }
      this.screamT = (this.screamT || 0) - dt;
      if (this.screamT <= 0) { this.screamT = rnd(2.5, 4.5); g.sound.play('enderman_stare', this.pos, 0.6); }
      const d = this.distTo(this.target.pos);
      if (d > 7 && Math.random() < dt * 0.9) this.teleportNear(this.target.pos);
      this.meleeTarget(dt);
      if (this.target && this.target.dead) this.target = null;
    } else {
      this.angry = false;
      this.wander(dt); if (Math.random() < dt / 30) this.teleportRandom();
    }
  }
  // Teleport to a standable spot 2-5 blocks from p.
  teleportNear(p) {
    const w = this.world;
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2, r = rnd(2, 5), x = p[0] + Math.cos(a) * r, z = p[2] + Math.sin(a) * r;
      for (let y = Math.floor(p[1]) + 3; y > p[1] - 4; y--) {
        const id = w.getBlock(x, y, z);
        if (id !== UNLOADED && SOLID[id] && w.getBlock(x, y + 1, z) === B.AIR && w.getBlock(x, y + 2, z) === B.AIR && w.getBlock(x, y + 3, z) === B.AIR) {
          this.game.particles.fx('portal', this.center(), 20, 0.5);
          this.pos = [Math.floor(x) + 0.5, y + 1, Math.floor(z) + 0.5];
          this.game.sound.play('teleport', this.pos, 0.6);
          this.game.particles.fx('portal', this.center(), 20, 0.5);
          return true;
        }
      }
    }
    return false;
  }
  aiSlime(dt) {
    // Slime.tick's squish: flattened as it lands, stretched as it leaves the ground, easing back.
    const ticks = dt * 20;
    this.squish = (this.squish || 0) + ((this.targetSquish || 0) - (this.squish || 0)) * (1 - 0.5 ** ticks);
    if (this.onGround && this.wasOnGround === false) this.targetSquish = -0.5;
    else if (!this.onGround && this.wasOnGround) this.targetSquish = 1;
    this.wasOnGround = this.onGround;
    this.targetSquish = (this.targetSquish || 0) * 0.6 ** ticks;
    this.seekPlayer(16);
    const t = this.target;
    this.jumpT = (this.jumpT ?? rnd(1, 2)) - dt;
    if (this.onGround) { this.brake(dt); if (this.landed === false) { this.landed = true; this.game.particles.fx('white', this.pos, 4 * this.size, this.hw, 0.5, this.mobType === 'slime' ? [0.5, 1, 0.4] : [1, 0.4, 0.1]); } }
    if (this.onGround && this.jumpT <= 0) {
      this.jumpT = t ? rnd(0.6, 1.2) : rnd(1.5, 4);
      if (t) this.lookAt(t.pos, 50, 1); else this.yaw += rnd(-1.5, 1.5);
      const sp = 3 + this.size;
      this.vel[0] = -Math.sin(this.yaw) * sp; this.vel[2] = -Math.cos(this.yaw) * sp; this.vel[1] = 6 + this.size * 0.8;
      this.landed = false;
    }
    if (t && this.size > 1 && this.overlaps(t, 0.1) && this.attackT <= 0) { this.attackT = 1; this.doAttack(t); }
    if (t && this.size === 1 && this.mobType === 'magma_cube' && this.overlaps(t, 0.1) && this.attackT <= 0) { this.attackT = 1; this.doAttack(t); }
  }
  // Squid.aiStep, Guardian.aiStep and Pufferfish.tick's look, stepped at Java's 20 ticks a second.
  waterTicks(dt) {
    this.tickAcc = (this.tickAcc || 0) + dt * 20;
    for (; this.tickAcc >= 1; this.tickAcc--) {
      if (this.mobType === 'squid' || this.mobType === 'glow_squid') this.squidTick();
      else if (this.def.ai === 'guardian') this.guardianTick();
    }
    if (this.mobType === 'pufferfish') {
      // PufferfishPuffGoal and Pufferfish.tick: puffs up a step when someone comes near (and fully after
      // 2 s), and lets the air out a step at a time once they leave.
      const near = this.playerTargetable() && this.distToPlayer() < 2.5;
      this.puff = this.puff || 0;
      if (near) { this.deflateT = 0; this.inflateT = (this.inflateT || 0) + dt; if (this.puff === 0) { this.puff = 1; this.inflateT = 0; } else if (this.puff === 1 && this.inflateT > 2) this.puff = 2; }
      else if (this.puff > 0) { this.inflateT = 0; this.deflateT = (this.deflateT || 0) + dt; if (this.puff === 2 && this.deflateT > 3) this.puff = 1; else if (this.puff === 1 && this.deflateT > 5) this.puff = 0; }
    }
  }
  squidTick() {
    if (this.tentacleSpeed === undefined) { this.tentacleSpeed = 1 / (Math.random() + 1) * 0.2; this.tentacleMovement = 0; this.rotateSpeed = this.tentacleSpeed; this.xBodyRot = 0; this.zBodyRot = 0; }
    this.tentacleMovement += this.tentacleSpeed;
    if (this.tentacleMovement > Math.PI * 2) { this.tentacleMovement = 0; if (Math.random() < 0.1) this.tentacleSpeed = 1 / (Math.random() + 1) * 0.2; }
    const v = this.vel;
    if (this.inWater) {
      if (this.tentacleMovement < Math.PI) {
        const f = this.tentacleMovement / Math.PI;
        this.tentacleAngle = Math.sin(f * f * Math.PI) * Math.PI * 0.25;
        this.rotateSpeed = f > 0.75 ? 1 : this.rotateSpeed * 0.8;
      } else { this.tentacleAngle = 0; this.rotateSpeed *= 0.99; }
      this.zBodyRot += Math.PI * this.rotateSpeed * 1.5;
      this.xBodyRot += (-Math.atan2(Math.hypot(v[0], v[2]), v[1]) * 180 / Math.PI - this.xBodyRot) * 0.1;
    } else {
      this.tentacleAngle = Math.abs(Math.sin(this.tentacleMovement)) * Math.PI * 0.25;
      this.xBodyRot += (-90 - this.xBodyRot) * 0.02;
    }
  }
  guardianTick() {
    const moving = Math.hypot(this.vel[0], this.vel[1], this.vel[2]) > 0.05;
    this.tailSpeed = this.tailSpeed ?? 0.125;
    if (!this.inWater) this.tailSpeed = 2;
    else if (moving) this.tailSpeed = this.tailSpeed < 0.5 ? 4 : this.tailSpeed + (0.5 - this.tailSpeed) * 0.1;
    else this.tailSpeed += (0.125 - this.tailSpeed) * 0.2;
    this.tailAnim = (this.tailAnim || 0) + this.tailSpeed;
    this.spikesAnim = this.spikesAnim ?? 1;
    if (!this.inWater) this.spikesAnim = Math.random();
    else this.spikesAnim += ((moving ? 0 : 1) - this.spikesAnim) * (moving ? 0.25 : 0.06);
  }
  // GuardianModel.setupAnim's eye: turned toward its target (or the viewer), and dropped a pixel when
  // that is below it.
  guardianEye() {
    const t = this.target || this.game.playerEntity;
    if (!t || !t.pos) return [0, 0];
    const ty = t.pos[1] + (t.h || 1.8) * 0.85, gy = this.pos[1] + this.h * 0.5;
    const look = [-Math.sin(this.yaw), -Math.cos(this.yaw)];
    let dx = this.pos[0] - t.pos[0], dz = this.pos[2] - t.pos[2]; const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    const d = look[0] * dz + look[1] * -dx; // (guardian - target) turned a quarter, against the look
    return [Math.sqrt(Math.abs(d)) * 2 * Math.sign(d), ty - gy > 0 ? 0 : 1];
  }
  aiSwim(dt) {
    const g = this.game;
    this.waterTicks(dt);
    if (!this.inWater) return;
    this.wanderT -= dt;
    if (this.mobType === 'pufferfish' && this.distToPlayer() < 2.5 && this.attackT <= 0 && this.playerTargetable()) { this.attackT = 1; this.doAttack(this.focus); }
    const fw = this.focus;
    if (this.mobType === 'dolphin' && (fw.remote ? this.world.getBlock(fw.pos[0], fw.pos[1] + 0.5, fw.pos[2]) === B.WATER : g.player.inWater) && this.distToPlayer() < 12) this.goal = [fw.pos[0] + rnd(-2, 2), fw.pos[1] + rnd(-1, 1), fw.pos[2] + rnd(-2, 2)];
    if (this.wanderT <= 0 || !this.goal) { this.wanderT = rnd(2, 6); this.goal = [this.pos[0] + rnd(-8, 8), this.pos[1] + rnd(-3, 3), this.pos[2] + rnd(-8, 8)]; }
    const dx = this.goal[0] - this.pos[0], dy = this.goal[1] - this.pos[1], dz = this.goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    if (this.world.getBlock(this.goal[0], this.goal[1], this.goal[2]) !== B.WATER) { this.goal = null; return; }
    const sp = this.speed * (this.mobType === 'squid' ? 0.6 + 0.4 * Math.max(0, Math.sin(this.age * 3)) : 1);
    this.vel[0] += (dx / n * sp - this.vel[0]) * Math.min(1, dt * 2); this.vel[1] += (dy / n * sp - this.vel[1]) * Math.min(1, dt * 2); this.vel[2] += (dz / n * sp - this.vel[2]) * Math.min(1, dt * 2);
    this.yaw += wrap(Math.atan2(-dx, -dz) - this.yaw) * Math.min(1, dt * 4);
  }
  // Guardians hold still while charging a laser at their target (4 s, elders 3 s) that then hits
  // for full damage; elders also curse nearby players with Mining Fatigue every minute.
  aiGuardian(dt) {
    const g = this.game, d = this.def;
    this.waterTicks(dt);
    if (d.elder) {
      this.curseT = (this.curseT ?? 5) - dt;
      if (this.curseT <= 0) {
        this.curseT = 60;
        const f = this.focus;
        if (f === g.playerEntity && this.playerTargetable() && this.distToPlayer() < 50) { g.addEffect('mining_fatigue', 300); g.sound.play('ghast_warn', null, 0.8); if (g.app.showAction) g.app.showAction('An Elder Guardian cursed you with Mining Fatigue', 3); }
      }
    }
    if (!this.target && this.playerTargetable() && this.distToPlayer() < 16 && this.canSee(this.focus)) this.target = this.focus;
    if (!this.target) {
      const prey = g.entities.near(this.pos, 12, e => e.mobType === 'squid' || e.mobType === 'glow_squid' || e.mobType === 'axolotl')[0];
      if (prey && Math.random() < dt / 10) this.target = prey;
    }
    const t = this.target;
    if (!t || !this.inWater && !this.onGround) { this.laser = null; if (this.inWater) this.aiSwim(dt); return; }
    const dist = this.distTo(t.pos), see = this.canSee(t);
    this.lookAt(t.pos, 10, dt);
    if (!see || dist > 16) {
      this.laser = null;
      if (this.inWater) { const dx = t.pos[0] - this.pos[0], dy = t.pos[1] + 0.5 - this.pos[1], dz = t.pos[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1; for (const [a, v] of [[0, dx], [1, dy], [2, dz]]) this.vel[a] += (v / n * this.speed - this.vel[a]) * Math.min(1, dt * 2); }
      return;
    }
    // Charging: brake, keep the beam on the target.
    for (let a = 0; a < 3; a++) this.vel[a] *= Math.exp(-4 * dt);
    if (this.attackT > 0) return;
    if (!this.laser) { this.laser = { t: 0 }; g.sound.play('fuse', this.pos, 0.4); }
    this.laser.t += dt;
    if (this.laser.t >= d.laser.time) {
      this.laser = null; this.attackT = 1.5;
      const diffMul = { peaceful: 0, easy: 0.67, normal: 1, hard: 1.5 }[g.difficulty] ?? 1;
      t.hurt(d.laser.dmg * ((t === g.playerEntity || t.remote) ? diffMul : 1) + 1, { kind: 'magic', attacker: this });
    }
  }
  // Where a charging laser points (for drawing), whether we or another player own this mob.
  laserInfo() {
    if (this.puppet) return this.laserTgt ? { to: this.laserTgt, prog: this.laserProg } : null;
    if (!this.laser || !this.target) return null;
    const t = this.target;
    return { to: [t.pos[0], t.pos[1] + (t.h || 1) * 0.6, t.pos[2]], prog: Math.min(1, this.laser.t / this.def.laser.time) };
  }
  // Bat.customServerAiStep: a bat hangs under a solid block it flies up against (1 tick in 100),
  // turning its head now and then, until the block goes or a player comes within 4 blocks.
  batRest(dt) {
    const w = this.world, x = this.pos[0], z = this.pos[2], above = Math.floor(this.pos[1]) + 1;
    const ceiling = OPAQUE[w.getBlock(x, above, z)];
    if (!this.resting) {
      if (ceiling && Math.random() < 1 - 0.99 ** (dt * 20)) { this.resting = true; this.goal = null; }
      return this.resting;
    }
    if (!ceiling) { this.resting = false; return false; }
    if (this.playerTargetable() && this.distToPlayer() < 4) { this.resting = false; this.vel[1] = 1; return false; }
    this.vel[0] = this.vel[1] = this.vel[2] = 0;
    this.pos[1] = above - this.h;
    if (Math.random() < 1 - (199 / 200) ** (dt * 20)) this.yaw = Math.random() * Math.PI * 2;
    return true;
  }
  aiFlyer(dt) {
    if (this.mobType === 'bat' && this.batRest(dt)) return;
    this.wanderT -= dt;
    if (this.wanderT <= 0 || !this.goal) {
      this.wanderT = rnd(1, 4);
      const ground = this.world.heightAt(this.pos[0], this.pos[2]);
      const maxY = this.mobType === 'bat' ? this.pos[1] + 3 : ground + 8;
      this.goal = [this.pos[0] + rnd(-6, 6), Math.min(maxY, this.pos[1] + rnd(-2, 2.5)), this.pos[2] + rnd(-6, 6)];
    }
    const dx = this.goal[0] - this.pos[0], dy = this.goal[1] - this.pos[1], dz = this.goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    this.vel[0] += (dx / n * this.speed - this.vel[0]) * Math.min(1, dt * 3); this.vel[1] += (dy / n * this.speed - this.vel[1]) * Math.min(1, dt * 3); this.vel[2] += (dz / n * this.speed - this.vel[2]) * Math.min(1, dt * 3);
    this.yaw += wrap(Math.atan2(-dx, -dz) - this.yaw) * Math.min(1, dt * 5);
    if (this.collidedH || this.collidedV) this.goal = null;
  }
  aiPhantom(dt) {
    const g = this.game;
    if (!this.target && this.playerTargetable()) this.target = this.focus;
    const t = this.target;
    if (!t) { this.aiFlyer(dt); return; }
    this.phaseT = (this.phaseT || 0) - dt;
    this.circleA = (this.circleA || 0) + dt * 0.6;
    let goal;
    if (this.swoop) {
      goal = [t.pos[0], t.pos[1] + 1, t.pos[2]];
      if (this.distTo(goal) < 1.8 && this.attackT <= 0) { this.attackT = 1; this.doAttack(t); this.swoop = false; this.phaseT = rnd(4, 8); }
      if (this.phaseT < -4) this.swoop = false;
    } else {
      goal = [t.pos[0] + Math.cos(this.circleA) * 14, t.pos[1] + 16, t.pos[2] + Math.sin(this.circleA) * 14];
      if (this.phaseT <= 0) { this.swoop = true; this.phaseT = 0; g.sound.play('phantom', this.pos, 0.8); }
    }
    const dx = goal[0] - this.pos[0], dy = goal[1] - this.pos[1], dz = goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    const sp = this.swoop ? 11 : 7;
    this.vel[0] += (dx / n * sp - this.vel[0]) * Math.min(1, dt * 2); this.vel[1] += (dy / n * sp - this.vel[1]) * Math.min(1, dt * 2); this.vel[2] += (dz / n * sp - this.vel[2]) * Math.min(1, dt * 2);
    this.yaw = Math.atan2(-this.vel[0], -this.vel[2]);
  }
  aiBlaze(dt) {
    const g = this.game;
    this.seekPlayer(20);
    const t = this.target;
    if (!t) { this.aiFlyer(dt); return; }
    const goal = [t.pos[0] + Math.cos(this.age * 0.4) * 6, t.pos[1] + 3, t.pos[2] + Math.sin(this.age * 0.4) * 6];
    const dx = goal[0] - this.pos[0], dy = goal[1] - this.pos[1], dz = goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    this.vel[0] += (dx / n * 2.5 - this.vel[0]) * dt * 2; this.vel[1] += (dy / n * 2.5 - this.vel[1]) * dt * 2; this.vel[2] += (dz / n * 2.5 - this.vel[2]) * dt * 2;
    this.lookAt(t.pos, 10, dt);
    if (this.canSee(t) && this.attackT <= 0) {
      this.attackT = 3; this.burst = 3;
    }
    if (this.burst > 0 && this.attackT < 2.6 - (3 - this.burst) * 0.3) { this.burst--; this.shoot('small_fireball', t, 16); }
    if (Math.random() < dt * 4) g.particles.smoke(this.center(), 1);
  }
  aiGhast(dt) {
    this.seekPlayer(48);
    const t = this.target;
    this.wanderT -= dt;
    if (this.wanderT <= 0 || !this.goal) { this.wanderT = rnd(3, 7); this.goal = [this.pos[0] + rnd(-16, 16), this.pos[1] + rnd(-4, 4), this.pos[2] + rnd(-16, 16)]; }
    const dx = this.goal[0] - this.pos[0], dy = this.goal[1] - this.pos[1], dz = this.goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    if (this.world.getBlock(this.pos[0] + dx / n * 3, this.pos[1] + 2 + dy / n * 3, this.pos[2] + dz / n * 3) !== B.AIR) this.goal = null;
    this.vel[0] += (dx / n * 2 - this.vel[0]) * dt; this.vel[1] += (dy / n * 2 - this.vel[1]) * dt; this.vel[2] += (dz / n * 2 - this.vel[2]) * dt;
    if (t) {
      this.lookAt(t.pos, 4, dt);
      if (this.attackT <= 0 && this.canSee(t)) { this.attackT = 3.5; this.charging = 0.6; this.game.sound.play('ghast_warn', this.pos, 1.2); }
      if (this.charging > 0) { this.charging -= dt; if (this.charging <= 0) this.shoot('fireball', t, 18); }
    } else this.yaw = Math.atan2(-this.vel[0], -this.vel[2]);
  }
  aiGolem(dt) {
    const g = this.game;
    if (!this.target || this.target === g.playerEntity || this.target.remote) {
      const foe = g.entities.near(this.pos, 16, e => e.isLiving && e.def && e.def.kind === 'hostile' && e.mobType !== 'creeper' && e.deathT === 0)[0];
      if (foe) this.target = foe;
    }
    if (this.target) this.meleeTarget(dt, this.hw + (this.target.hw || 0.3) + 1.2);
    else this.wander(dt, 10, this.speed * 0.6);
  }
  aiSnowGolem(dt) {
    const g = this.game;
    const foe = g.entities.near(this.pos, 10, e => e.isLiving && e.def && e.def.kind === 'hostile' && e.deathT === 0)[0];
    if (foe) { this.lookAt(foe.pos, 8, dt); this.brake(dt); if (this.attackT <= 0) { this.attackT = 1; this.shoot('snowball', foe, 22); } }
    else this.wander(dt);
  }
  aiVillager(dt) {
    const g = this.game;
    if (this.trading) { this.lookAt(this.focus.pos, 8, dt); this.brake(dt); return; }
    const threat = g.entities.near(this.pos, 8, e => e.def && (e.def.undead || e.def.raider) && e.deathT === 0 && e.def.kind === 'hostile')[0];
    if (threat) { this.flee(threat.pos, dt, this.speed * 1.4); return; }
    if (this.distToPlayer() < 4 && Math.random() < dt) this.lookAt(this.focus.pos, 20, dt);
    this.wander(dt, 10);
    if (this.mobType === 'wandering_trader' && this.age > 2400) this.dead = true;
  }
  // The Wither: charges up for 10 s after being built, explodes, then hunts the player (or any
  // living non-undead mob), circling overhead and firing wither skulls. Below half health it
  // grows armor (arrow-proof), dives in close and fires faster. It regenerates slowly.
  aiWither(dt) {
    const g = this.game;
    if (this.spawnT === undefined) this.spawnT = this.fresh ? 10 : 0;
    if (this.spawnT > 0) {
      this.spawnT -= dt; this.vel = [0, 0, 0];
      this.health = Math.max(1, this.maxHealth * (1 - Math.max(0, this.spawnT) / 10));
      if (Math.random() < dt * 8) g.particles.fx('portal', this.center(), 4, 1.4);
      if (this.spawnT <= 0) { g.explode([this.pos[0], this.pos[1] + 1.5, this.pos[2]], 7, { source: this, breakBlocks: g.rules.mobGriefing }); g.sound.mob('wither', 'death', this.pos, this); }
      return;
    }
    this.health = Math.min(this.maxHealth, this.health + dt);
    this.armored = this.health < this.maxHealth / 2;
    const bad = t => !t || t.dead || t.deathT > 0 || ((t === g.playerEntity || t.remote) && !this.playerTargetable(t));
    if (bad(this.target) || Math.random() < dt * 0.1) {
      this.target = this.playerTargetable() && this.distToPlayer() < 48 ? this.focus
        : g.entities.near(this.pos, 24, e => e.isLiving && e !== this && !e.dead && e.def && !e.def.undead && e.def.kind !== 'boss')[0] || null;
    }
    const t = this.target;
    let goal;
    if (t) {
      this.orbitA = (this.orbitA || Math.random() * 6) + dt * (this.armored ? 0.9 : 0.5);
      const r = this.armored ? 3 : 9;
      goal = [t.pos[0] + Math.cos(this.orbitA) * r, t.pos[1] + (this.armored ? 1.5 : 5), t.pos[2] + Math.sin(this.orbitA) * r];
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0 || !this.goal) { this.wanderT = rnd(3, 6); this.goal = [this.pos[0] + rnd(-12, 12), this.pos[1] + rnd(-3, 3), this.pos[2] + rnd(-12, 12)]; }
      goal = this.goal;
    }
    const dx = goal[0] - this.pos[0], dy = goal[1] - this.pos[1], dz = goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    const sp = (this.armored ? 7 : 5) * Math.min(1, n / 3), k = Math.min(1, dt * 2);
    this.vel[0] += (dx / n * sp - this.vel[0]) * k; this.vel[1] += (dy / n * sp - this.vel[1]) * k; this.vel[2] += (dz / n * sp - this.vel[2]) * k;
    if (t) {
      this.lookAt(t.pos, 12, dt);
      this.shootT = (this.shootT ?? 2) - dt;
      if (this.shootT <= 0 && this.canSee(t)) { this.shootT = this.armored ? 0.6 : 1.1; this.shoot('wither_skull', t, 18); this.swing = 1; }
    }
    // Smash through blocks it flies into.
    this.smashT = (this.smashT || 0) - dt;
    if (this.smashT <= 0 && g.rules.mobGriefing) {
      this.smashT = 0.5;
      const w = this.world;
      for (let y = Math.floor(this.pos[1]); y <= Math.floor(this.pos[1] + this.h); y++) for (let x = Math.floor(this.pos[0] - 1); x <= Math.floor(this.pos[0] + 1); x++) for (let z = Math.floor(this.pos[2] - 1); z <= Math.floor(this.pos[2] + 1); z++) {
        const id = w.getBlock(x, y, z);
        if (id !== B.AIR && id !== UNLOADED && id !== B.WATER && id !== B.LAVA && id !== B.BEDROCK && id !== B.OBSIDIAN && id !== B.END_PORTAL && id !== B.END_PORTAL_FRAME && BLOCKS[id].hardness !== Infinity) g.breakBlock(x, y, z, { player: false });
      }
    }
  }
  aiDragon(dt) { dragonAI(this, dt); }
  // Extra hit boxes beyond the main one: the dragon's head and neck reach well past its body.
  partBoxes() {
    if (this.mobType !== 'ender_dragon') return null;
    const h = dragonHead(this), n = [(this.pos[0] + h[0]) / 2, (this.pos[1] + 2.2 + h[1]) / 2, (this.pos[2] + h[2]) / 2];
    return [[h[0] - 1, h[1] - 1, h[2] - 1, h[0] + 1, h[1] + 1, h[2] + 1], [n[0] - 0.8, n[1] - 0.8, n[2] - 0.8, n[0] + 0.8, n[1] + 0.8, n[2] + 0.8]];
  }

  growUp() {
    this.baby = false;
    const d = this.def;
    this.scale = d.scale || 1; this.hw = d.hw; this.h = d.h; this.speed = d.speed;
  }

  // Player right-clicked this mob with a stack. Returns true if consumed the interaction.
  interact(held) {
    const g = this.game, d = this.def, key = held && held.key;
    if (key === 'name_tag' && held.tag && held.tag.name) { this.name = held.tag.name; this.persistent = true; g.inv.consumeHeld(); return true; }
    if (d.food && key && d.food.includes(key)) {
      if (this.baby) { this.growT -= 120; g.inv.consumeHeld(g.mode === 'creative' ? 0 : 1); g.particles.fx('happy', this.center(), 5, 0.4); return true; }
      if (this.breedCd <= 0 && this.love <= 0 && (!this.tamed || this.mobType === 'wolf')) { this.love = 30; g.inv.consumeHeld(g.mode === 'creative' ? 0 : 1); g.sound.play('eat', this.pos, 0.5); return true; }
    }
    if (this.mobType === 'wolf') {
      if (!this.tamed && key === 'bone') {
        g.inv.consumeHeld(g.mode === 'creative' ? 0 : 1);
        if (Math.random() < 0.33) { this.tamed = true; this.persistent = true; this.target = null; this.sitting = true; this.maxHealth = 20; this.health = 20; g.particles.fx('heart', this.center(), 7, 0.4); g.toast('Tamed!', 'A wolf joined you', 'bone'); }
        else g.particles.smoke(this.center(), 4);
        return true;
      }
      if (this.tamed && !key) { this.sitting = !this.sitting; return true; }
    }
    if ((d.milk) && key === 'bucket' && !this.baby) { g.inv.consumeHeld(); g.inv.add({ key: 'milk_bucket', count: 1 }); g.sound.play('milk', this.pos, 0.6); return true; }
    if (d.stew && key === 'bowl' && !this.baby) { g.inv.consumeHeld(); g.inv.add({ key: 'mushroom_stew', count: 1 }); return true; }
    if (d.shearable && key === 'shears' && !this.sheared && !this.baby) {
      this.sheared = true;
      for (let k = rint(1, 3); k > 0; k--) g.dropItem(this.pos[0], this.pos[1] + 1, this.pos[2], { key: `${this.woolColor}_wool`, count: 1 });
      g.inv.damageHeld(1); g.sound.play('shear', this.pos, 0.6); return true;
    }
    if (this.mobType === 'mooshroom' && key === 'shears') { this.dead = true; g.spawnMob('cow', this.pos[0], this.pos[1], this.pos[2]); g.dropItem(this.pos[0], this.pos[1] + 1, this.pos[2], { key: 'red_mushroom', count: 5 }); return true; }
    if (this.mobType === 'sheep' && key && key.endsWith('_dye')) { const c = key.slice(0, -4); this.woolColor = c; g.inv.consumeHeld(); return true; }
    if ((this.mobType === 'villager' || this.mobType === 'wandering_trader') && this.profession !== 'nitwit' && !this.baby) {
      this.trading = true; g.openTrade(this); return true;
    }
    if (this.mobType === 'zombie_villager' && key === 'golden_apple') { g.inv.consumeHeld(); this.curing = 5; g.sound.play('cure', this.pos, 0.8); g.later(5, () => { if (!this.dead) { this.dead = true; g.spawnMob('villager', this.pos[0], this.pos[1], this.pos[2]); } }); return true; }
    if (this.mobType === 'iron_golem' && key === 'iron_ingot' && this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + 25); g.inv.consumeHeld(); g.sound.play('anvil', this.pos, 0.5); return true; }
    if (key === 'saddle' && !this.saddled && !this.baby && (this.mobType === 'pig' || this.mobType === 'strider' || (RIDEABLE[this.mobType] && this.tamed))) {
      this.saddled = true; g.inv.consumeHeld(); g.sound.play('equip', this.pos, 0.7); return true;
    }
    // Horses: feeding calms them (temper); an empty hand (or any non-food item) mounts.
    if (RIDEABLE[this.mobType] && !this.baby) {
      const calm = { wheat: 3, sugar: 3, apple: 3, hay_block: 3, golden_carrot: 5, golden_apple: 10 }[key];
      if (calm && !this.tamed) { this.temper = Math.min(100, (this.temper || 0) + calm); g.inv.consumeHeld(g.mode === 'creative' ? 0 : 1); g.sound.play('eat', this.pos, 0.5); return true; }
      if (!g.player.sneaking) { g.mount(this); return true; }
    }
    if ((this.mobType === 'pig' || this.mobType === 'strider') && this.saddled && !key) { g.mount(this); return true; }
    return false;
  }

  // ---------------- rendering ----------------
  // Mobs built as Java models pose as Java does: HumanoidModel.setupAnim and the mob's own arms.
  javaPose() {
    const m = this.model, held = (this.equipment && this.equipment.hand) || this.def.holds, aggressive = !!this.target;
    let right = held ? 'item' : 'empty';
    if (aggressive && held === 'bow') right = 'bow';
    if (aggressive && held === 'trident' && m.arms === 'drowned') right = 'spear';
    const st = {
      limbSwing: this.walk / 0.6662, limbAmt: this.walkAmt, age: this.age * 20, headPitch: -this.headPitch, headYaw: -wrap(this.yaw - this.bodyYaw),
      attack: this.swing > 0 ? 1 - this.swing : 0, rightPose: right, aggressive, arms: m.arms, legX: m.legX, riding: !!this.riding, holding: !!held, id: this.id,
    };
    if (m.anim === 'jvillager') { const v = villagerPose(m, st); v.poses.pivots = v.pivots; return v.poses; }
    if (m.anim === 'jillager') {
      // AbstractIllager.getArmPose: an evoker casting, a vindicator hunting with its axe, a pillager
      // holding its crossbow on a target (charging it for the last 1.25 s before it shoots); otherwise
      // arms folded (pillagers keep theirs at their sides).
      const a = this.def.attack || {};
      if (this.castT > 0) st.armPose = 'spellcasting';
      else if (aggressive && a.crossbow) { st.armPose = this.attackT < 1.25 ? 'xbow_charge' : 'xbow_hold'; st.xbowCharge = Math.max(0, Math.min(1, 1 - this.attackT / 1.25)); }
      else if (aggressive && !a.ranged) st.armPose = 'attacking';
      else st.armPose = this.mobType === 'pillager' ? 'neutral' : 'crossed';
      const v = illagerPose(st); v.poses.pivots = v.pivots; return v.poses;
    }
    if (m.anim === 'jpiglin') { const v = piglinPose(m, st); v.poses.pivots = v.pivots; return v.poses; }
    const monster = { jcreeper: creeperPose, jspider: spiderPose, jenderman: endermanPose, jmagma: magmaPose, jsilverfish: silverfishPose, jblaze: blazePose, jghast: ghastPose, jphantom: phantomPose,
      jirongolem: ironGolemPose, jsnowgolem: snowGolemPose, jhoglin: hoglinPose, jstrider: striderPose, jravager: ravagerPose,
      jsquid: squidPose, jfish: fishPose, jpufferfish: pufferfishPose, jguardian: guardianPose, jdolphin: dolphinPose, jturtle: turtlePose, jaxolotl: axolotlPose,
      jrabbit: rabbitPose, jocelot: ocelotPose, jparrot: parrotPose, jbat: batPose, jfrog: frogPose, jcamel: camelPose, jwither: witherPose }[m.anim];
    if (m.anim === 'jslime') return {};
    if (monster) {
      st.creepy = !!this.angry; st.squish = this.squish || 0; st.ridden = !!this.rider; st.resting = !!this.resting; st.carrying = !!this.carried;
      // (Java's attack animation counts 10 ticks down from the blow.)
      st.attackTicks = this.swing * 10;
      st.inWater = this.inWater; st.onGround = this.onGround; st.moving = Math.hypot(this.vel[0], this.vel[1], this.vel[2]) > 0.05 || st.limbAmt > 1e-5;
      st.tentacleAngle = this.tentacleAngle || 0;
      if (m.anim === 'jguardian') { st.spikes = (1 - (this.spikesAnim ?? 1)) * 0.55; st.tail = this.tailAnim || 0; st.eye = this.guardianEye(); }
      // Time off the ground: a rabbit's jump (Rabbit.getJumpCompletion, 10 ticks) and a frog's leap.
      const dtPose = Math.max(0, this.age - (this.poseAge ?? this.age)); this.poseAge = this.age;
      this.airT = this.onGround || this.inWater ? 0 : (this.airT || 0) + dtPose;
      st.jump = this.airT > 0 && this.airT < 0.5 ? this.airT / 0.5 : 0;
      st.jumpT = this.airT > 0 ? this.airT : null;
      st.saddled = !!this.saddled; st.sitting = !!this.sitting;
      // (The wither's side heads glance about on their own.)
      if (m.anim === 'jwither') { const t = this.age; st.sideHeads = [[Math.sin(t * 0.9) * 0.2, 0.3 + Math.sin(t * 0.7) * 0.5], [Math.sin(t * 1.1 + 2) * 0.2, -0.3 + Math.sin(t * 0.8 + 1) * 0.5]]; }
      if (m.anim === 'jparrot') {
        // Parrot.calculateFlapping, a tick at a time: the wings beat fast in the air and settle on landing.
        this.flapAcc = (this.flapAcc || 0) + dtPose * 20;
        for (; this.flapAcc >= 1; this.flapAcc--) {
          this.flapSpeed = Math.max(0, Math.min(1, (this.flapSpeed || 0) + (this.onGround ? -1 : 4) * 0.3));
          if (!this.onGround && (this.flapping || 0) < 1) this.flapping = 1;
          this.flapping = (this.flapping || 0) * 0.9; this.flapT = (this.flapT || 0) + this.flapping * 2;
        }
        st.flying = !this.onGround; st.flap = (Math.sin(this.flapT || 0) + 1) * (this.flapSpeed || 0);
      }
      const v = monster(m, st); v.poses.pivots = v.pivots; return v.poses;
    }
    if (m.anim === 'jquadruped' || m.anim === 'jchicken' || m.anim === 'jwolf' || m.anim === 'jhorse') {
      // Chicken.aiStep's wing flap: beating fast while off the ground (ChickenRenderer.getBob).
      st.flap = this.onGround ? 0 : Math.sin(this.age * 40) + 1;
      st.sitting = !!this.sitting; st.angry = !!this.target && this.mobType === 'wolf'; st.tamed = !!this.tamed; st.health = this.health;
      const v = (m.anim === 'jchicken' ? chickenPose : m.anim === 'jwolf' ? wolfPose : m.anim === 'jhorse' ? horsePose : animalPose)(m, st);
      v.poses.pivots = v.pivots; return v.poses;
    }
    const { poses, pivots } = humanoidPose(st);
    poses.pivots = pivots;
    return poses;
  }
  // Every mob is built on a Java model, posed as Java poses it.
  pose() { return this.javaPose(); }

  render(ctx) {
    const g = this.game;
    if (!this.model) { this.model = g.mobModel(this.skinKey); this.layer = g.mobLayer(this.skinKey); }
    // TropicalFishRenderer: the small body (model A) or the large one (B) for its pattern.
    if (this.fish) { const k = this.fish[0] >= 6 ? 'tropical_fish_large' : this.skinKey; this.model = g.mobModel(k); this.layer = g.mobLayer(k); }
    // PufferfishRenderer: the model for how puffed up it is.
    if (this.mobType === 'pufferfish' && this.def.forms) {
      const k = this.puff === 2 ? 'pufferfish_big' : this.puff === 1 ? 'pufferfish_mid' : this.skinKey;
      this.model = g.mobModel(k); this.layer = g.mobLayer(k);
    }
    const light = this.def.glow ? [1.1, 1.1, 1.1] : this.brightness();
    let extra = null;
    if (this.deathT > 0 && this.mobType !== 'ender_dragon') extra = M.rz(Math.min(1, this.deathT * 2) * Math.PI / 2);
    const sc = this.scale;
    if (this.mobType === 'creeper' && this.fuse > 0) {
      // CreeperRenderer.scale: swelling wide (and a little tall) as the fuse burns, with a quiver.
      let f = Math.min(1, this.fuse / 1.5);
      const q = 1 + Math.sin(f * 100) * f * 0.01;
      f = f ** 4;
      extra = M.s((1 + f * 0.4) * q, (1 + f * 0.1) / q, (1 + f * 0.4) * q);
    }
    if (this.model.anim === 'jslime' || this.model.anim === 'jmagma') {
      // SlimeRenderer.scale / MagmaCubeRenderer.scale: squashed by the squish (see aiSlime).
      const k = 1 / ((this.squish || 0) / (this.size * 0.5 + 1) + 1);
      extra = M.s(k * 0.999, 0.999 / k, k * 0.999);
    }
    const anim = this.model.anim;
    if (anim === 'jsquid') {
      // SquidRenderer.setupRotations: pitched and spun about its middle.
      extra = M.chain(M.t(0, 8, 0), M.rx((this.xBodyRot || 0) * Math.PI / 180), M.ry((this.zBodyRot || 0) * Math.PI / 180), M.t(0, -19.2, 0));
    } else if (anim === 'jfish') {
      // Cod/Salmon/TropicalFishRenderer.setupRotations: the body sways, and a stranded fish flops on its side.
      const st = { age: this.age * 20, inWater: this.inWater };
      extra = M.ry(fishSway(this.model, st));
      if (this.model.salmon) extra = M.mul(extra, M.t(0, 0, -6.4));
      if (!this.inWater) extra = M.chain(extra, M.t(...this.model.flop), M.rz(Math.PI / 2));
    } else if (anim === 'jpufferfish') {
      // PufferfishRenderer.setupRotations: a slow bob.
      extra = M.t(0, Math.cos(this.age * 20 * 0.05) * 0.08 * 16, 0);
    }
    // IronGolemRenderer.setupRotations: it lurches side to side as it walks.
    if (this.model.anim === 'jirongolem') extra = M.rz(ironGolemSway(this.walk / 0.6662, this.walkAmt));
    let yOff = 0;
    // BatRenderer.setupRotations: a flying bat bobs; a hanging one sits a little lower.
    if (this.model.anim === 'jbat') yOff = this.resting ? -0.1 : Math.cos(this.age * 20 * 0.3) * 0.1;
    // EnderDragonRenderer: the dragon turns and pitches by its recent flight, and its neck and tail
    // follow the path it flew (EnderDragon's flap time and latency positions, a tick at a time).
    let dragon = null;
    if (anim === 'jdragon') {
      this.dragonAcc = (this.dragonAcc || 0) + Math.max(0, this.age - (this.dragonAge ?? this.age)) * 20; this.dragonAge = this.age;
      if (!this.dragonPos) dragonHistory(this, -this.bodyYaw * 180 / Math.PI, this.pos[1]);
      for (; this.dragonAcc >= 1; this.dragonAcc--) {
        dragonHistory(this, -this.bodyYaw * 180 / Math.PI, this.pos[1]);
        const v = this.vel, f = 0.2 / (Math.hypot(v[0], v[2]) / 20 * 10 + 1) * 2 ** (v[1] / 20);
        this.flapTime = (this.flapTime || 0) + ((this.perch || 0) > 0.5 ? 0.1 : f);
      }
      dragon = dragonPose(this.model, { history: this, flap: this.flapTime || 0, perch: this.perch || 0 });
      extra = M.chain(M.rx(dragon.pitch), M.t(0, 0, 16));
    }
    const shake = this.angry ? 0.035 : 0;
    // StriderRenderer.setupRotations: a cold strider shivers.
    const shiver = this.mobType === 'strider' && this.cold ? Math.cos(this.age * 20 * 3.25) * Math.PI * 0.4 * Math.PI / 180 : 0;
    const root = rootMatrix([this.pos[0] + rnd(-shake, shake), this.pos[1] + yOff, this.pos[2] + rnd(-shake, shake)], dragon ? -dragon.heading * Math.PI / 180 : this.bodyYaw + shiver, sc, extra);
    const flash = this.hurtT > 0 || (this.mobType === 'creeper' && this.fuse > 0 && Math.floor(this.fuse * 8) % 2 === 0) ? 0.8 : 0;
    this.lastPose = dragon ? Object.assign(dragon.poses, { pivots: dragon.pivots }) : this.pose();
    // WolfRenderer.getTextureLocation: tame and angry wolves wear their own skins.
    let layer = this.layer;
    // Its breed's skin (and RabbitRenderer's: a rabbit named Toast is Toast).
    const breed = this.mobType === 'rabbit' && this.name === 'Toast' ? 'toast' : this.breed;
    if (breed && this.def.breeds && this.def.breeds[breed]) layer = g.mobLayer(`${this.skinKey}_${breed}`);
    if (this.mobType === 'wolf') layer = g.mobLayer(this.tamed ? 'wolf_tame' : this.target ? 'wolf_angry' : 'wolf');
    // GhastRenderer: the open-mouthed face while it readies a fireball.
    if (this.mobType === 'ghast' && this.charging > 0) layer = g.mobLayer('ghast_shooting');
    if (this.mobType === 'strider' && this.cold) layer = g.mobLayer('strider_cold');
    if (this.mobType === 'iron_golem') {
      const f = this.health / this.maxHealth, c = f < 0.25 ? 'high' : f < 0.5 ? 'medium' : f < 0.75 ? 'low' : null;
      if (c) layer = g.mobLayer(`iron_golem_${c}`);
    }
    // (A tinted mob, like a tropical fish in its base colour.)
    const tint = (l, t) => [l[0] * t[0], l[1] * t[1], l[2] * t[2]];
    const tinted = (m, l) => m && m.tint ? tint(l, m.tint) : l;
    const mats = drawModel(ctx.mobs, this.model, layer, root, this.lastPose, this.fish ? tint(light, DYE_DIFFUSE[this.fish[1]]) : tinted(this.model, light), flash);
    if (this.fish) {
      // TropicalFishPatternLayer: its pattern over it, in the pattern colour.
      const [p, , c] = this.fish, k = `tropical_fish_pattern_${p >= 6 ? 'b' : 'a'}${(p % 6) + 1}`;
      drawModel(ctx.mobs, g.mobModel(k), g.mobLayer(k), root, this.lastPose, tint(light, DYE_DIFFUSE[c]), flash);
    }
    // MushroomCowMushroomLayer: two red mushrooms on a mooshroom's back and one on its head.
    if (this.mobType === 'mooshroom' && !this.baby) {
      const at = (m, x, y, z, a) => M.chain(m, M.t(x, y, z), M.ry(a), M.s(16), M.t(-0.5, -0.5, -0.5));
      for (const mm of [at(root, -3.2, 29.6, 8, 48 * Math.PI / 180), at(root, 2.03, 29.6, -0.2, 6 * Math.PI / 180), at(mats.head || root, 0, 11.2, -3.2, 78 * Math.PI / 180)]) {
        const gl = new Float32Array([mm[0], mm[4], mm[8], 0, mm[1], mm[5], mm[9], 0, mm[2], mm[6], mm[10], 0, mm[3], mm[7], mm[11], 1]);
        ctx.blockModels.push({ id: B.FLOWER, meta: 13, light: (light[0] + light[1] + light[2]) / 3, matrix: gl });
      }
    }
    if (this.mobType === 'strider' && this.saddled) drawModel(ctx.mobs, this.model, g.mobLayer('strider_saddle'), root, this.lastPose, light, flash);
    // SnowGolemHeadLayer: a carved pumpkin (facing forward, 10 px across) over its head, until sheared.
    if (this.mobType === 'snow_golem' && !this.sheared && mats.head) {
      const mm = M.chain(mats.head, M.t(0, 5.5, 0), M.s(10), M.t(-0.5, -0.5, -0.5));
      const gl = new Float32Array([mm[0], mm[4], mm[8], 0, mm[1], mm[5], mm[9], 0, mm[2], mm[6], mm[10], 0, mm[3], mm[7], mm[11], 1]);
      ctx.blockModels.push({ id: B.PUMPKIN, meta: 1 | (2 << 2), light: (light[0] + light[1] + light[2]) / 3, matrix: gl });
    }
    // EnergySwirlLayer: a charged creeper, or a wither below half health, wears its energy skin a
    // little bigger, scrolling, added onto it at half strength.
    const sw = this.def.swirl;
    if (sw && ctx.mobsSwirl && (this.mobType === 'creeper' ? this.charged : this.health <= this.maxHealth / 2)) {
      const t = this.age * 20;
      drawModel(ctx.mobsSwirl, g.mobModel(`${this.skinKey}_swirl`), g.mobLayer(`${this.skinKey}_swirl`), root, { ...this.lastPose, uvShift: [sw.x(t) % 1, (t * 0.01) % 1] }, [light[0] * 0.5, light[1] * 0.5, light[2] * 0.5]);
    }
    // EnderManCarriedBlockLayer: the block it carries, held out in front, half size, tipped and turned
    // (Java's model-space steps, after turning model space into ours).
    if (this.carried) {
      const D = Math.PI / 180, mm = M.chain(root, M.t(0, 24, 0), M.s(-16, -16, 16), M.t(0, 0.6875, -0.75), M.rx(20 * D), M.ry(45 * D), M.t(0.25, 0.1875, 0.25), M.s(-0.5, -0.5, 0.5), M.ry(90 * D));
      const gl = new Float32Array([mm[0], mm[4], mm[8], 0, mm[1], mm[5], mm[9], 0, mm[2], mm[6], mm[10], 0, mm[3], mm[7], mm[11], 1]);
      ctx.blockModels.push({ id: this.carried[0], meta: this.carried[1], light: (light[0] + light[1] + light[2]) / 3, matrix: gl });
    }
    // A second skin over the first (the stray's clothes, the drowned's outer layer), posed alike.
    const over = g.mobModel(`${this.skinKey}_overlay`, true);
    // (A sheep's wool is tinted by its colour, and gone once sheared: SheepFurLayer.)
    const wool = over && over.wool, woolRgb = wool && (WOOL_COLORS[this.woolColor] || [1, 1, 1]);
    if (over && !(wool && this.sheared)) drawModel(over.clear ? ctx.mobsClear || ctx.mobs : ctx.mobs, over, g.mobLayer(`${this.skinKey}_overlay`), root, this.lastPose, wool ? [light[0] * woolRgb[0], light[1] * woolRgb[1], light[2] * woolRgb[2]] : tinted(over, light), flash);
    if (this.saddled && (this.mobType === 'horse' || this.mobType === 'donkey')) drawModel(ctx.mobs, g.mobModel('saddle'), g.mobLayer('saddle'), root, { body: this.lastPose.body || [0, 0, 0] }, light, flash);
    // Worn armor follows the same pose: Java's armor layers (data/armor.js), on skeletons too.
    if (this.equipment) for (const k of this.equipment.armor) {
      const a = k && armorLayer(k);
      if (a) drawModel(ctx.mobs, g.mobModel(a.model), g.mobLayer(a.skin), root, { ...this.lastPose, hide: a.hide }, light, flash);
    }
    // Held item.
    const held = (this.equipment && this.equipment.hand) || this.def.holds;
    // (An illager with its arms folded shows nothing in its hand, as Java's IllagerRenderer.)
    if (held && mats.rightArm && !(this.lastPose.hide && this.lastPose.hide.rightArm)) {
      // At the hand: the middle of the arm box, which Java's models set off the pivot.
      const ab = this.model.parts.rightArm.boxes[0], cx = ab.o[0] + ab.s[0] / 2;
      const m = M.chain(mats.rightArm, M.t(cx, -9, -1), M.rx(-Math.PI / 2), M.s(10));
      renderStackMatrix(ctx, g, held, m, light);
    }
    if (this.fire > 0) for (let k = 0; k < 2; k++) g.particles.fx('flame', [this.pos[0] + rnd(-this.hw, this.hw), this.pos[1] + rnd(0, this.h), this.pos[2] + rnd(-this.hw, this.hw)], 1, 0.05, 0.2);
    if (this.name) ctx.labels.push({ text: this.name, pos: [this.pos[0], this.pos[1] + this.h + 0.5, this.pos[2]] });
    const lz = this.def.laser && this.laserInfo();
    if (lz) {
      // The beam fades from violet to hot yellow as the charge completes.
      const eye = [this.pos[0], this.pos[1] + this.h * 0.5, this.pos[2]], to = lz.to, layer = g.fxLayer('white'), p = lz.prog;
      const col = [0.5 + p * 0.9, 0.3 + p * 0.9, 1.2 - p * 0.9, 0.55 + p * 0.4], wd = 0.025 + p * 0.025;
      for (const [ox, oz] of [[wd, 0], [0, wd]]) ctx.itemFx.quad([[eye[0] - ox, eye[1], eye[2] - oz], [to[0] - ox, to[1], to[2] - oz], [to[0] + ox, to[1], to[2] + oz], [eye[0] + ox, eye[1], eye[2] + oz]], [0, 0, 1, 1], layer, col);
      ctx.itemFx.quad([[eye[0], eye[1] - wd, eye[2]], [to[0], to[1] - wd, to[2]], [to[0], to[1] + wd, to[2]], [eye[0], eye[1] + wd, eye[2]]], [0, 0, 1, 1], layer, col);
    }
    // Dying: shafts of light burst out of the body.
    if (this.mobType === 'ender_dragon' && this.deathT > 0) {
      const layer = g.fxLayer('white'), c = [this.pos[0], this.pos[1] + 2.4, this.pos[2]], k = Math.min(1, this.deathT / 8);
      for (let i = 0; i < 12; i++) {
        const a = i * 2.39996 + this.deathT * 0.3 * (i % 2 ? 1 : -1), b = Math.sin(i * 1.7 + this.deathT * 0.2) * 1.2;
        const d = [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)], L = 6 + k * 18 + (i % 3) * 3, w = 0.6 + k * 1.2;
        const s = [-d[2], 0, d[0]], e = [c[0] + d[0] * L, c[1] + d[1] * L, c[2] + d[2] * L];
        ctx.itemFx.quad([[c[0], c[1], c[2]], [e[0] - s[0] * w, e[1], e[2] - s[2] * w], [e[0] + s[0] * w, e[1], e[2] + s[2] * w], [c[0], c[1] + 0.01, c[2]]], [0, 0, 1, 1], layer, [1.3, 1.1, 1.4, 0.35 * (0.4 + k * 0.6)]);
      }
    }
    if (this.beam) {
      const c = this.beam.pos, layer = g.fxLayer('white');
      ctx.itemFx.quad([[c[0] - 0.1, c[1] + 1, c[2]], [this.pos[0] - 0.1, this.pos[1] + 2, this.pos[2]], [this.pos[0] + 0.1, this.pos[1] + 2, this.pos[2]], [c[0] + 0.1, c[1] + 1, c[2]]], [0, 0, 1, 1], layer, [1.2, 0.6, 1.4, 0.7]);
    }
  }

  toJSON() {
    if (this.deathT > 0) return null;
    return {
      t: 'mob', type: this.mobType, p: this.pos, yaw: this.yaw, health: this.health, baby: this.baby, size: this.size, tamed: this.tamed, sitting: this.sitting, saddled: this.saddled, rideSpeed: this.rideSpeed, jumpStrength: this.jumpStrength, temper: this.temper,
      sheared: this.sheared, woolColor: this.woolColor, name: this.name, persistent: this.persistent, home: this.home, charged: this.charged, resting: this.resting, carried: this.carried, breed: this.breed, fish: this.fish,
      profession: this.profession, level: this.level, xp: this.xp, trades: this.trades, equipment: this.equipment,
    };
  }
}

// Moves an entity without gravity handling (fliers/swimmers).
import { moveEntity } from './physics.js?v=muujms2i';
function import_move(e, dt) { moveEntity(e.world, e, e.vel[0] * dt, e.vel[1] * dt, e.vel[2] * dt); }

// Renders a held item using a part matrix (model units).
function renderStackMatrix(ctx, g, key, m, light) {
  if (g.itemDef(key)) g.renderItemAt(ctx, key, m, light);
}
export { renderStack };
