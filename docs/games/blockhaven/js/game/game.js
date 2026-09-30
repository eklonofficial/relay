// The running game: world + dimensions, player survival state, entities, simulation, weather and saving.
import { B, BLOCKS, SOLID, OPAQUE, DIM, DIM_NAMES, HEIGHT, SEA, props, st, SHAPE_OF, SHAPE } from '../data/blocks.js?v=muo1whx0';
import { I, maxStack } from '../data/items.js?v=muo1whx0';
import { SMELTING } from '../data/recipes.js?v=muo1whx0';
import { MOBS } from '../data/mobs.js?v=muo1whx0';
import { BIOMES, COLD } from '../gen/biomes.js?v=muo1whx0';
import { World, UNLOADED, posKey } from '../world/world.js?v=muo1whx0';
import { Player } from './player.js?v=muo1whx0';
import { PlayerInventory, Container } from './inventory.js?v=muo1whx0';
import { EntityManager } from '../entity/entity.js?v=muo1whx0';
import { ItemEntity, XpOrb, FallingBlock, PrimedTnt, Lightning, Projectile } from '../entity/objects.js?v=muo1whx0';
import { Mob, RIDEABLE } from '../entity/mob.js?v=muo1whx0';
import { Particles } from './particles.js?v=muo1whx0';
import { Sim } from './sim.js?v=muo1whx0';
import { blockDrops } from './drops.js?v=muo1whx0';
import { computeEnv } from './env.js?v=muo1whx0';
import { fuelOf } from './ui.js?v=muo1whx0';
import { unlockLevel } from './trades.js?v=muo1whx0';
import { forward } from '../core/math.js?v=muo1whx0';
import { EndCrystal } from '../entity/crystal.js?v=muo1whx0';
import { ARMOR_BYPASS, armorReduce, applyInvul, isAxe } from './combat.js?v=muo1whx0';

export const DAY = 1200; // seconds per day
const rnd = (a, b) => a + Math.random() * (b - a);
export const xpForLevel = l => (l < 16 ? 2 * l + 7 : l < 31 ? 5 * l - 38 : 9 * l - 158);

export class Game {
  constructor(app) {
    this.app = app;
    this.renderer = app.renderer; this.sound = app.sound; this.settings = app.settings; this.icons = app.icons;
    this.hud = null; this.gui = null;
    this.particles = new Particles(this);
    this.entities = new EntityManager(this);
    this.sim = new Sim(this);
    this.inv = new PlayerInventory();
    this.tableGrid = new Container(9);
    this.tradeSlots = new Container(2);
    this.time = 0;
    this.timers = [];
    this.env = computeEnv(0, 0.3, [0, 0, -1]);
    this.inv.main.onChange = () => { this.invDirty = true; };
    this.inv.armor.onChange = () => { this.invDirty = true; };
    this.inv.offhand.onChange = () => { this.invDirty = true; };
    const pe = {
      isLiving: true, hw: 0.3, h: 1.8, type: 'player',
      get pos() { return pe.game.player.pos; }, get vel() { return pe.game.player.vel; },
      get dead() { return !pe.game.alive; }, deathT: 0,
      hurt: (a, s) => this.damagePlayer(a, s), addEffect: (k, s, l) => this.addEffect(k, s, l), setFire: s => { if (!this.stats.effects.fire_resistance && this.mode !== 'creative' && this.mode !== 'spectator') this.stats.fire = Math.max(this.stats.fire, s); },
      distTo: p => Math.hypot(pe.pos[0] - p[0], pe.pos[1] - p[1], pe.pos[2] - p[2]),
    };
    pe.game = this;
    this.playerEntity = pe;
  }

  // ---------------- lifecycle ----------------
  start(meta) {
    this.meta = meta;
    this.seed = meta.seed; this.worldType = meta.type;
    this.mode = meta.mode === 'hardcore' ? 'survival' : meta.mode; this.hardcore = meta.mode === 'hardcore' || meta.hardcore;
    this.difficulty = this.hardcore ? 'hard' : meta.difficulty || 'normal';
    this.cheats = meta.cheats !== false;
    this.rules = Object.assign({ doDaylightCycle: true, doMobSpawning: true, keepInventory: false, mobGriefing: true, doFireTick: true, doWeatherCycle: true, naturalRegeneration: true, doMobLoot: true, doTileDrops: true, showCoordinates: true, doInsomnia: true }, meta.rules || {});
    this.dayTime = meta.time ?? 0.02; this.day = meta.day || 0;
    this.weather = meta.weather || { rain: 0, thunder: 0, timer: rnd(300, 900) };
    this.dims = meta.dims || {};
    this.spawn = meta.spawn || null;
    this.dragonKilled = !!meta.dragonKilled;
    this.stats = Object.assign({ health: 20, maxHealth: 20, absorption: 0, food: 20, sat: 5, exhaustion: 0, air: 300, xp: 0, level: 0, xpProgress: 0, fire: 0, effects: {}, score: 0 }, meta.stats || {});
    this.inv.clearAll();
    this.inv.load(meta.inventory);
    this.alive = true;
    this.enderChest = new Container(27); this.enderChest.load(meta.enderChest);
    this.advancements = new Set(meta.advancements || []);
    this.nightsNoSleep = meta.nightsNoSleep || 0;
    this.bossBar = null;
    const pd = meta.player;
    this.dim = pd ? pd.dim ?? 0 : 0;
    this.openWorld(this.dim);
    this.player = new Player(this.world);
    this.hookPlayer();
    this.player.mode = this.mode;
    if (pd) {
      this.player.pos = pd.pos.slice(); this.player.yaw = pd.yaw; this.player.pitch = pd.pitch; this.player.flying = !!pd.flying;
    } else {
      const s = this.app.generator.findSpawn();
      this.spawn = [s.x, s.y, s.z];
      this.player.pos = this.spawn.slice();
      this.player.yaw = Math.PI * 0.75;
      this.giveStarter();
    }
    if (!this.spawn) this.spawn = this.player.pos.slice();
    this.player.mode = this.mode;
    this.invDirty = true;
    this.attackCooldown = 1;
    this.portalT = 0; this.portalCd = 0;
    this.lastSave = 0;
  }
  giveStarter() { // Everyone starts empty-handed, as in the original; creative has the item menu (E).
  }
  hookPlayer() {
    const p = this.player;
    p.onStep = id => this.sound.step(BLOCKS[id] ? props(id, 0).sound : 'stone', p.pos);
    p.onSplash = () => { this.sound.play('splash', p.pos, 0.6); this.particles.fx('splash', p.pos, 12, 0.5, 2); };
    p.onLand = (dist, water) => this.onLand(dist, water);
    p.onJump = () => this.exhaust(p.sprinting ? 0.2 : 0.05);
    p.autoJump = this.settings.autoJump;
    const chest = () => this.inv.armor.get(1);
    p.hasElytra = () => { const c = chest(); return !!(c && c.key === 'elytra' && (c.dmg || 0) < I.elytra.durability - 1); };
    p.onKinetic = dmg => {
      // Only real walls hurt, not the edge of terrain that hasn't streamed in yet.
      const d = Math.hypot(p.preVel ? p.preVel[0] : 0, p.preVel ? p.preVel[2] : 0) || 1;
      const ax = p.pos[0] + (p.preVel ? p.preVel[0] / d : 0) * 0.8, az = p.pos[2] + (p.preVel ? p.preVel[2] / d : 0) * 0.8;
      if (!this.world.isLoaded(ax, az)) return;
      this.damagePlayer(dmg, { kind: 'fall' });
    };
    p.onGlideSecond = () => {
      const c = chest();
      if (!c || this.mode === 'creative') return;
      c.dmg = (c.dmg || 0) + 1; this.inv.armor.changed();
      if (c.dmg >= I.elytra.durability - 1) { p.gliding = false; this.sound.play('break_item', p.pos, 0.6); }
    };
  }
  // A firework rocket fired from the ground: climbs, then bursts into coloured sparks.
  launchFirework(pos) {
    const cols = [[1, 0.3, 0.3], [0.3, 0.6, 1], [1, 0.9, 0.3], [0.5, 1, 0.4], [1, 0.4, 1]];
    const col = cols[Math.floor(Math.random() * cols.length)];
    this.sound.play('firework', pos, 0.8);
    const p = pos.slice();
    for (let i = 0; i < 12; i++) this.later(i * 0.09, () => { p[1] += 1.4; this.particles.fx('smoke', p, 2, 0.1, 0.2); this.particles.fx('crit', p, 2, 0.1, 0.4); });
    this.later(1.15, () => { this.particles.fx('white', p, 60, 0.3, 9, col); this.sound.play('firework_blast', p, 1); });
  }
  openWorld(dim) {
    if (this.world) this.world.dispose();
    this.dim = dim;
    const d = this.dims[dim] || {};
    this.world = new World({
      seed: this.seed, dim, worldType: this.worldType, edits: d.edits, populated: d.populated, blockEntities: d.blockEntities,
      callbacks: {
        onMesh: (c, m) => this.renderer.uploadChunk(c, m), onUnload: c => this.renderer.freeChunk(c),
        onEntities: list => this.onGenEntities(list),
        onChunkLoaded: c => this.onChunkLoaded(c),
        onBlockChange: (x, y, z) => this.sim.onChange(x, y, z),
        onBlockEntityRemoved: (x, y, z, be) => this.onBlockEntityRemoved(x, y, z, be),
        onEdit: (x, y, z, id, m) => { if (this.net) this.net.onLocalEdit(dim, x, y, z, id, m); },
        onPopulate: key => { if (this.net) this.net.send({ t: 'pop', id: this.net.myId, d: dim, k: key }); },
      },
    });
    this.entities.clear();
    for (const e of d.entities || []) this.loadEntity(e);
    this.app.onWorldOpened(this.world, dim);
    if (this.player) { this.player.world = this.world; }
  }
  onGenEntities(list) {
    for (const e of list) {
      if (e.type === 'end_crystal') { this.entities.add(new EndCrystal(this, e.x, e.y, e.z)); continue; }
      if (!MOBS[e.type]) continue;
      this.spawnMob(e.type, e.x, e.y, e.z, { persistent: true, ...(e.data || {}) });
    }
  }
  onChunkLoaded() {}
  loadEntity(d) {
    if (!d) return;
    if (d.t === 'mob' && MOBS[d.type]) { const m = new Mob(this, d.type, d.p[0], d.p[1], d.p[2], d); m.yaw = d.yaw; this.entities.add(m); }
    else if (d.t === 'item' && I[d.s.key]) { const e = new ItemEntity(this, d.p[0], d.p[1], d.p[2], d.s, [0, 0, 0]); e.age = d.a || 0; this.entities.add(e); }
    else if (d.t === 'crystal') this.entities.add(new EndCrystal(this, d.p[0], d.p[1], d.p[2]));
  }
  serializeDim(forSave = false) {
    const entities = this.entities.list.map(e => e.toJSON()).filter(Boolean);
    // The host's save also keeps other players' mobs and items near it.
    if (forSave && this.net && this.net.isHost) entities.push(...this.net.share.puppetsJSON());
    return {
      edits: this.world.serializeEdits(), populated: [...this.world.populated], blockEntities: this.world.serializeBlockEntities(),
      entities,
    };
  }
  serialize() {
    this.dims[this.dim] = this.serializeDim(true);
    return {
      ...this.meta, time: this.dayTime, day: this.day, weather: this.weather, dims: this.dims, spawn: this.spawn, dragonKilled: this.dragonKilled,
      mode: this.hardcore ? 'hardcore' : this.mode, hardcore: this.hardcore, difficulty: this.difficulty, rules: this.rules, stats: this.stats,
      inventory: this.inv.toJSON(), enderChest: this.enderChest.toJSON(), advancements: [...this.advancements], nightsNoSleep: this.nightsNoSleep,
      player: { pos: this.player.pos, yaw: this.player.yaw, pitch: this.player.pitch, flying: this.player.flying, dim: this.dim },
    };
  }

  // ---------------- helpers used across modules ----------------
  itemLayer(key) { return this.app.itemLayer(key); }
  itemPixels(key) { return this.app.itemPixels(key); }
  fxLayer(name) { return this.app.fxLayer(name); }
  mobModel(key) { return this.app.mobModel(key); }
  mobLayer(key) { return this.app.mobLayer(key); }
  itemDef(key) { return I[key]; }
  renderItemAt(ctx, key, m, light) { this.app.renderItemAt(ctx, key, m, light); }
  later(t, fn) { this.timers.push({ t: this.time + t, fn }); }
  isDay() { return this.dim !== DIM.OVERWORLD ? false : this.dayTime < 0.47 || this.dayTime > 0.97; }
  get raining() { return this.dim === DIM.OVERWORLD && this.weather.rain > 0.5; }
  lookDir() { return forward(this.player.yaw, this.player.pitch); }
  biomeTemp(p) { const b = BIOMES[this.world.biomeAt(p[0], p[2])]; return b ? b.temp - Math.max(0, p[1] - 90) * 0.0125 : 0.5; }
  // ---------------- riding ----------------
  mount(m) {
    if (this.riding) this.dismount();
    this.riding = m; m.rider = true; m.target = null; m.path = null;
    this.player.flying = false; this.player.sneaking = false;
    this.rideSneak = true; this.jumpCharge = 0; this.buckT = m.tamed ? null : 1 + Math.random() * 2.5;
    this.sound.mob(m.mobType, 'ambient', m.pos, m);
    if (this.app.showAction) this.app.showAction(m.tamed && !m.saddled && RIDEABLE[m.mobType] ? 'Needs a saddle to steer · Shift to dismount' : 'Shift to dismount', 2.5);
  }
  dismount(thrown = false) {
    const m = this.riding;
    if (!m) return;
    this.riding = null; m.rider = false;
    const p = this.player, w = this.world;
    // Step off to the side onto open ground.
    const side = [Math.cos(m.yaw), -Math.sin(m.yaw)];
    let pos = [m.pos[0] + side[0] * 1.2, m.pos[1], m.pos[2] + side[1] * 1.2];
    for (const s of [1, -1]) { const x = m.pos[0] + side[0] * 1.2 * s, z = m.pos[2] + side[1] * 1.2 * s; if (w.getBlock(x, m.pos[1], z) === B.AIR && w.getBlock(x, m.pos[1] + 1, z) === B.AIR) { pos = [x, m.pos[1], z]; break; } }
    p.pos = pos; p.vel = thrown ? [side[0] * 4, 5, side[1] * 4] : [0, 0, 0]; p.fallStart = null;
    this.jumpCharge = 0;
  }
  // Before the world ticks: steer the mount from the rider's input.
  rideControl(dt, input) {
    const m = this.riding, p = this.player;
    if (!m || m.dead || m.deathT > 0 || !this.alive) { this.dismount(); return; }
    if (input.sneak && !this.rideSneak) { this.dismount(); return; }
    this.rideSneak = input.sneak;
    const R = RIDEABLE[m.mobType];
    if (!m.tamed) {
      // Bucking: the horse fights the rider, then either gives in or throws them off.
      this.buckT -= dt;
      if (Math.random() < dt * 3) { m.yaw += (Math.random() - 0.5) * 1.6; if (m.onGround) m.vel[1] = 4; }
      m.vel[0] *= 0.9; m.vel[2] *= 0.9;
      if (this.buckT <= 0) {
        if (Math.random() * 100 < m.temper) {
          m.tamed = true; m.persistent = true;
          this.particles.fx('heart', m.center(), 7, 0.6); this.toast('Tamed!', 'Put a saddle on it to ride', 'saddle');
          this.advance('tame_horse', 'Horsin\' Around', 'Tame a horse', 'saddle');
          this.buckT = null;
        } else {
          m.temper = Math.min(100, (m.temper || 0) + 5);
          this.particles.smoke(m.center(), 8); this.sound.mob(m.mobType, 'hurt', m.pos, m);
          this.dismount(true);
        }
      }
      return;
    }
    const steer = R ? m.saddled : false;
    if (!steer) return; // unsaddled (or a pig without a carrot): it wanders with you on top
    m.yaw = m.bodyYaw = p.yaw;
    const f = (input.forward ? 1 : 0) - (input.back ? 0.25 : 0), s = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 0.5;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const sp = m.rideSpeed * (m.inWater ? 0.3 : 1);
    const tx = (fx * f + rx * s) * sp, tz = (fz * f + rz * s) * sp;
    const k = 1 - Math.exp(-(m.onGround ? 7 : 1.5) * dt);
    m.vel[0] += (tx - m.vel[0]) * k; m.vel[2] += (tz - m.vel[2]) * k;
    m.walk += Math.hypot(m.vel[0], m.vel[2]) * dt * 1.2; m.walkAmt = Math.min(1, Math.hypot(m.vel[0], m.vel[2]) / 4);
    // Step up single blocks while riding.
    if (m.collidedH && m.onGround && (f || s)) m.vel[1] = 7.5;
    // Charged jump: hold Space to fill the bar, release to leap.
    if (input.jump) this.jumpCharge = Math.min(1, (this.jumpCharge || 0) + dt / 0.9);
    else if (this.jumpCharge > 0) {
      if (m.onGround) { const c = this.jumpCharge >= 0.9 ? 1 : 0.4 + this.jumpCharge * 0.6; m.vel[1] = m.jumpStrength * c * 20; const b = 2 * c; m.vel[0] += fx * b; m.vel[2] += fz * b; this.sound.mob(m.mobType, 'ambient', m.pos, m); }
      this.jumpCharge = 0;
    }
  }
  // After the world ticks: sit the rider in the saddle.
  rideSync() {
    const m = this.riding, p = this.player;
    if (!m) return;
    const seat = (RIDEABLE[m.mobType] && RIDEABLE[m.mobType].seat) || m.h * 0.75;
    p.pos = [m.pos[0], m.pos[1] + seat, m.pos[2]]; p.vel = [0, 0, 0]; p.fallStart = null; p.onGround = true; p.renderPos = p.pos.slice();
  }
  toast(a, b, icon) { if (this.hud) this.hud.toast(a, b, icon); }
  chat(msg, color) { this.app.chat(msg, color); }
  advance(key, title, text, icon) { if (this.advancements.has(key)) return; this.advancements.add(key); this.toast(`Advancement Made!`, title, icon); this.chat(`Advancement made: [${title}] — ${text}`, '#ffff55'); this.sound.play('chime', null, 0.6); }

  // ---------------- blocks ----------------
  setBlock(x, y, z, id, meta = 0) { return this.world.setBlock(Math.floor(x), Math.floor(y), Math.floor(z), id, meta); }
  // Break a block (with drops, particles and sound). Handles two-block doors/beds.
  breakBlock(x, y, z, { drop = true, silent = false, tool = null, player = false } = {}) {
    const w = this.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
    if (id === UNLOADED || id === B.AIR) return;
    const sh = SHAPE_OF[id];
    if (!silent) { this.sound.dig(props(id, m).sound, [x + 0.5, y + 0.5, z + 0.5]); this.particles.block(x, y, z, id, m, 20); if (this.net) this.net.fx('break', [x + 0.5, y + 0.5, z + 0.5], { d: this.dim, s: props(id, m).sound, b: id, bm: m }); }
    const be = w.blockEntities.get(posKey(x, y, z));
    let replace = B.AIR, replaceMeta = 0;
    if (id === B.ICE && player && this.mode !== 'creative' && SOLID[w.getBlock(x, y - 1, z)] && this.dim !== DIM.NETHER) replace = B.WATER;
    if (w.getBlock(x, y + 1, z) === B.WATER || (y <= SEA && this.dim === 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => w.getBlock(x + a, y, z + b) === B.WATER && (w.getMeta(x + a, y, z + b) & 15) === 0).length >= 2)) { replace = B.WATER; }
    if (BLOCKS[id].waterlogged) replace = B.WATER;
    w.setBlock(x, y, z, replace, replaceMeta);
    if (drop && this.rules.doTileDrops && this.mode !== 'creative' && this.mode !== 'spectator') {
      const { items, xp } = blockDrops(id, m, tool);
      for (const s of items) this.dropItem(x + 0.5, y + 0.3, z + 0.5, s);
      if (xp) this.spawnXp([x + 0.5, y + 0.5, z + 0.5], xp);
    }
    if (be && be.container) for (const s of be.container.slots) if (s) this.dropItem(x + 0.5, y + 0.5, z + 0.5, s);
    if (be && be.items) for (const s of be.items) if (s) this.dropItem(x + 0.5, y + 0.5, z + 0.5, s);
    // Second halves.
    if (sh === SHAPE.DOOR) { const up = (m >> 6) & 1; const oy = up ? y - 1 : y + 1; if (w.getBlock(x, oy, z) === B.DOOR) w.setBlock(x, oy, z, B.AIR, 0); }
    if (sh === SHAPE.BED) { const f = m & 3, head = (m >> 2) & 1, d = [[0, 1], [-1, 0], [0, -1], [1, 0]][f], s = head ? -1 : 1; if (w.getBlock(x + d[0] * s, y, z + d[1] * s) === B.BED) w.setBlock(x + d[0] * s, y, z + d[1] * s, B.AIR, 0); }
    if (id === B.NETHER_PORTAL) this.breakPortalAround(x, y, z);
    if (id === B.TNT && !player) this.igniteTnt(x, y, z);
    if (id === B.END_CRYSTAL_BASE) return;
  }
  breakPortalAround(x, y, z) {
    const w = this.world, stack = [[x, y, z]], seen = new Set();
    while (stack.length) {
      const [a, b, c] = stack.pop(), k = posKey(a, b, c);
      if (seen.has(k)) continue; seen.add(k);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (w.getBlock(a + dx, b + dy, c + dz) === B.NETHER_PORTAL) { w.setBlock(a + dx, b + dy, c + dz, B.AIR, 0); stack.push([a + dx, b + dy, c + dz]); }
    }
  }
  onBlockEntityRemoved() {}
  onBlockEntityChanged(be) { if (this.net) this.net.onLocalBlockEntity(this.dim, posKey(be.x, be.y, be.z), be); }
  // ---------------- multiplayer ----------------
  get playerName() { return this.net ? this.net.name : 'Player'; }
  // Another player's edit to a dimension we are not in: fold it into that dimension's saved edits.
  storeRemoteEdit(dim, x, y, z, id, m) {
    const d = this.dims[dim] || (this.dims[dim] = {});
    const edits = d.edits || (d.edits = {});
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), k = `${cx},${cz}`;
    (edits[k] || (edits[k] = [])).push((x - cx * 16) + (z - cz * 16) * 16 + y * 256, id | (m << 8));
    if (d.blockEntities && id !== B.AIR) delete d.blockEntities[posKey(x, y, z)];
  }
  applyRemoteBlockEntity(dim, k, data) {
    if (dim !== this.dim) { const d = this.dims[dim] || (this.dims[dim] = {}); (d.blockEntities || (d.blockEntities = {}))[k] = data; return; }
    const w = this.world, cur = w.blockEntities.get(k);
    if (!cur) { w.blockEntities.set(k, data); return; }
    for (const key of Object.keys(cur)) if (!(key in data)) delete cur[key];
    Object.assign(cur, data);
    if (cur.container) cur.container.load(data.items || []);
    if (this.gui && this.gui.isOpen) this.gui.refresh && this.gui.refresh();
  }
  // The nearest player (this one or a remote one in this dimension), preferring ones mobs can
  // actually engage (alive, not in spectator).
  nearestPlayer(pos) {
    let best = this.playerEntity, bd = Infinity, active = false;
    const consider = (e, ok) => {
      const d = (e.pos[0] - pos[0]) ** 2 + (e.pos[1] - pos[1]) ** 2 + (e.pos[2] - pos[2]) ** 2;
      if ((ok && !active) || (ok === active && d < bd)) { best = e; bd = d; active = ok; }
    };
    consider(this.playerEntity, this.alive && this.mode !== 'spectator');
    if (this.net) for (const rp of this.net.remotePlayers()) if (rp.visible || (rp.dim === this.dim && rp.snaps.length && rp.spectator)) consider(rp, rp.visible);
    return best;
  }
  applyRemotePopulated(dim, key) {
    if (dim === this.dim) { this.world.populated.add(key); return; }
    const d = this.dims[dim] || (this.dims[dim] = {});
    (d.populated || (d.populated = [])).push(key);
  }
  // What the host saves for a guest between sessions.
  playerData() {
    return {
      inventory: this.inv.toJSON(), enderChest: this.enderChest.toJSON(), stats: this.stats, advancements: [...this.advancements], mode: this.mode,
      spawn: this.spawn, player: { pos: this.player.pos, yaw: this.player.yaw, pitch: this.player.pitch, flying: this.player.flying, dim: this.dim },
    };
  }
  blockEntity(x, y, z) { return this.world.blockEntities.get(posKey(x, y, z)); }
  // Chest / furnace containers are plain slot lists in block entities; wrap them for the GUI.
  containerOf(be, size) {
    if (!be.container) {
      const c = new Container(size);
      c.load(be.items || []);
      c.onChange = () => { be.items = c.toJSON(); this.onBlockEntityChanged(be); };
      Object.defineProperty(be, 'container', { value: c, enumerable: false, writable: true });
    }
    return be.container;
  }

  // ---------------- entities ----------------
  dropItem(x, y, z, stack, vel = null) {
    if (!stack || !I[stack.key] || stack.count <= 0) return null;
    return this.entities.add(new ItemEntity(this, x, y, z, { ...stack }, vel));
  }
  dropStack(stack) {
    const p = this.player, f = this.lookDir();
    const e = this.dropItem(p.pos[0], p.pos[1] + 1.3, p.pos[2], stack, [f[0] * 5, f[1] * 5 + 1.5, f[2] * 5]);
    if (e) e.pickupDelay = 2;
  }
  spawnXp(pos, amount) {
    while (amount > 0) { const v = amount >= 37 ? 37 : amount >= 17 ? 17 : amount >= 7 ? 7 : amount >= 3 ? 3 : 1; amount -= v; this.entities.add(new XpOrb(this, pos[0], pos[1], pos[2], v)); }
  }
  spawnMob(type, x, y, z, opts = {}) {
    if (!MOBS[type]) return null;
    return this.entities.add(new Mob(this, type, x, y, z, opts));
  }
  spawnFalling(x, y, z, id, meta) { this.entities.add(new FallingBlock(this, x, y, z, id, meta)); }
  igniteTnt(x, y, z, fuse = 4) { this.world.setBlock(x, y, z, B.AIR, 0); this.entities.add(new PrimedTnt(this, x, y, z, fuse)); this.sound.play('fuse', [x, y, z], 0.8); }
  shootProjectile(kind, from, vel, shooter, extra = {}) { const p = new Projectile(this, kind, from[0], from[1], from[2], vel, shooter); Object.assign(p, extra); return this.entities.add(p); }

  // Explosion: ray-marched block destruction, entity damage and knockback.
  explode(pos, power, { fire = false, breakBlocks = true, source = null } = {}) {
    const w = this.world;
    this.sound.play('explode', pos, 1.6);
    this.particles.explosion(pos, power);
    if (this.net) this.net.fx('explode', pos, { d: this.dim, pw: power });
    const broken = new Set();
    if (breakBlocks && !(source && source.inWater)) {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
        if (i && i < 15 && j && j < 15 && k && k < 15) continue;
        let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        let f = power * (0.7 + Math.random() * 0.6), x = pos[0], y = pos[1], z = pos[2];
        while (f > 0) {
          const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), id = w.getBlock(bx, by, bz);
          if (id === UNLOADED) break;
          if (id !== B.AIR) {
            const r = id === B.WATER || id === B.LAVA ? 100 : props(id, w.getMeta(bx, by, bz)).resistance;
            f -= (r / 5 + 0.3) * 0.3;
            if (f > 0 && id !== B.WATER && id !== B.LAVA && r < 1000) broken.add(posKey(bx, by, bz));
          }
          x += dx * 0.3; y += dy * 0.3; z += dz * 0.3; f -= 0.225;
        }
      }
    }
    for (const k of broken) {
      const [x, y, z] = k.split(',').map(Number);
      const id = w.getBlock(x, y, z);
      if (id === B.TNT) { this.world.setBlock(x, y, z, B.AIR, 0); this.entities.add(new PrimedTnt(this, x, y, z, 0.5 + Math.random())); continue; }
      const m = w.getMeta(x, y, z);
      w.setBlock(x, y, z, B.AIR, 0);
      if (Math.random() < 1 / power && this.rules.doTileDrops) for (const s of blockDrops(id, m, { key: 'diamond_pickaxe' }).items) this.dropItem(x + 0.5, y + 0.5, z + 0.5, s);
    }
    if (fire) for (const k of broken) { if (Math.random() < 0.33) { const [x, y, z] = k.split(',').map(Number); if (w.getBlock(x, y, z) === B.AIR && SOLID[w.getBlock(x, y - 1, z)]) w.setBlock(x, y, z, B.FIRE, 0); } }
    // Entities and the player.
    const R = power * 2;
    const targets = [...this.entities.near(pos, R + 1, e => e.isLiving || e.type === 'item' || e.type === 'tnt'), ...(this.alive ? [this.playerEntity] : [])];
    for (const e of targets) {
      if (e === source) continue;
      const c = [e.pos[0], e.pos[1] + (e.h || 0.5) / 2, e.pos[2]];
      const d = Math.hypot(c[0] - pos[0], c[1] - pos[1], c[2] - pos[2]);
      if (d > R) continue;
      const exposure = this.exposure(pos, e);
      const impact = (1 - d / R) * exposure;
      const dmg = Math.floor((impact * impact + impact) / 2 * 7 * R + 1);
      const n = d || 1;
      if (e.type === 'item') { if (!e.puppet && Math.random() < 0.5) e.dead = true; continue; }
      if (e.hurt) e.hurt(dmg, { kind: 'explosion', attacker: source && source.shooter ? source.shooter : source, knock: [(c[0] - pos[0]) / n, (c[2] - pos[2]) / n], knockStrength: impact * 14 });
      if (e.vel) e.vel[1] += impact * 10;
    }
    if (this.alive && Math.hypot(this.player.pos[0] - pos[0], this.player.pos[2] - pos[2]) < 16) this.app.shake(Math.min(1, power / 4));
  }
  exposure(pos, e) {
    let hits = 0, n = 0;
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
      const p = [e.pos[0] - e.hw + (i / 2) * e.hw * 2, e.pos[1] + (j / 2) * (e.h || 1), e.pos[2]];
      const d = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]], len = Math.hypot(...d);
      n++;
      if (len < 0.1) { hits++; continue; }
      const hit = this.world.raycast(pos, d.map(v => v / len), len);
      if (!hit || !OPAQUE[hit.id]) hits++;
    }
    return hits / n;
  }
  onLightning(bolt) {
    const p = bolt.pos;
    this.sound.play('thunder', p, 2.5);
    this.app.flash(0.6);
    const w = this.world;
    if (this.rules.doFireTick && w.getBlock(p[0], p[1], p[2]) === B.AIR && SOLID[w.getBlock(p[0], p[1] - 1, p[2])] && this.difficulty !== 'peaceful') w.setBlock(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]), B.FIRE, 0);
    for (const e of [...this.entities.near(p, 4, o => o.isLiving), ...(this.alive ? [this.playerEntity] : [])]) {
      if (Math.hypot(e.pos[0] - p[0], e.pos[2] - p[2]) > 3) continue;
      if (e.mobType === 'creeper') { e.charged = true; continue; }
      if (e.puppet) continue;
      if (e.mobType === 'pig') { e.dead = true; this.spawnMob('zombified_piglin', e.pos[0], e.pos[1], e.pos[2]); continue; }
      if (e.mobType === 'villager') { e.dead = true; this.spawnMob('witch', e.pos[0], e.pos[1], e.pos[2]); continue; }
      if (e.hurt) e.hurt(5, { kind: 'lightning' });
      if (e.setFire) e.setFire(8);
    }
  }

  // ---------------- player survival ----------------
  get survivalLike() { return this.mode === 'survival' || this.mode === 'adventure'; }
  exhaust(v) { if (this.survivalLike && this.difficulty !== 'peaceful') this.stats.exhaustion += v; }
  addEffect(kind, seconds, level = 1) {
    const e = this.stats.effects;
    e[kind] = Math.max(e[kind] || 0, seconds);
    if (kind === 'absorption') this.stats.absorption = Math.max(this.stats.absorption, 4 * level);
  }
  damagePlayer(amount, src = {}) {
    const s = this.stats;
    if (!this.alive || !this.survivalLike) return false;
    if (src.kind === 'void' || src.kind === 'kill') this.invul = 0;
    if (this.difficulty === 'peaceful' && src.kind === 'mob') return false;
    if (s.effects.fire_resistance && (src.kind === 'fire' || src.kind === 'lava')) return false;
    const bypass = ARMOR_BYPASS.has(src.kind);
    // Shield blocks frontal attacks.
    if (this.blocking && src.attacker && src.kind !== 'explosion' && !bypass) {
      const a = src.attacker.pos, p = this.player.pos, f = this.lookDir();
      const dx = a[0] - p[0], dz = a[2] - p[2], n = Math.hypot(dx, dz) || 1;
      if ((dx * f[0] + dz * f[2]) / n > 0.2 && !(src.attacker.equipment && isAxe(src.attacker.equipment.hand))) { this.sound.play('arrow_hit', p, 0.8); if (src.attacker.vel && src.kind === 'mob') { src.attacker.vel[0] += dx / n * -6; src.attacker.vel[2] += dz / n * -6; } const h = this.inv.hand; this.inv.hand = (this.app.interact && this.app.interact.usingHand) || 'main'; this.inv.damageHeld(1); this.inv.hand = h; return false; }
    }
    // Invulnerability frames: a harder hit still lands for the difference.
    const hit = applyInvul(this, amount);
    if (hit.amount <= 0) return false;
    let dmg = hit.amount;
    if (!bypass) {
      const { pts, tough } = this.inv.armorPoints();
      dmg = armorReduce(dmg, pts, tough);
      if (pts) this.inv.damageArmor(hit.amount);
    }
    if (s.effects.resistance) dmg *= 0.8;
    if (src.kind === 'fall' && this.inv.armor.get(3)) dmg *= 1;
    if (s.absorption > 0) { const a = Math.min(s.absorption, dmg); s.absorption -= a; dmg -= a; }
    s.health -= dmg;
    this.exhaust(0.1);
    if (hit.fresh) { this.app.hurtFlash(src); this.sound.play('hurt', null, 0.8); if (this.net) this.net.onHurt(); }
    if (hit.fresh && src.knock) { const k = src.knockStrength || 5; this.player.vel[0] += src.knock[0] * k; this.player.vel[2] += src.knock[1] * k; this.player.vel[1] = Math.max(this.player.vel[1], 4.5); }
    if (src.attacker && src.attacker.isLiving) this.lastAttackedBy = src.attacker;
    this.lastDamage = src;
    if (s.health <= 0) {
      // Totem of undying in either hand.
      const totemSlot = this.inv.held && this.inv.held.key === 'totem_of_undying' ? 'main' : this.inv.offhand.get(0) && this.inv.offhand.get(0).key === 'totem_of_undying' ? 'off' : null;
      if (totemSlot && src.kind !== 'void' && src.kind !== 'kill') {
        if (totemSlot === 'main') this.inv.consumeHeld(); else this.inv.offhand.set(0, null);
        s.health = 1; s.effects = {}; this.addEffect('regeneration', 45); this.addEffect('absorption', 5, 2); this.addEffect('fire_resistance', 40);
        this.sound.play('totem', null, 1); this.particles.fx('happy', [this.player.pos[0], this.player.pos[1] + 1, this.player.pos[2]], 40, 1, 2, [1, 0.9, 0.3]);
        this.advance('totem', 'Postmortal', 'Use a Totem of Undying to cheat death', 'totem_of_undying');
        return true;
      }
      this.die(src);
    }
    return true;
  }
  deathMessage(src) {
    return this.deathMessageRaw(src).replace(/^Player/, this.playerName);
  }
  deathMessageRaw(src) {
    const a = src.attacker, name = a && a.def ? a.displayName || a.def.name : null;
    switch (src.kind) {
      case 'fall': return 'Player fell from a high place';
      case 'lava': return 'Player tried to swim in lava';
      case 'fire': return 'Player burned to death';
      case 'drown': return 'Player drowned';
      case 'starve': return 'Player starved to death';
      case 'void': return 'Player fell out of the world';
      case 'explosion': return name ? `Player was blown up by ${name}` : 'Player blew up';
      case 'projectile': return `Player was shot by ${name || 'an arrow'}`;
      case 'magic': return 'Player was killed by magic';
      case 'wither': return 'Player withered away';
      case 'lightning': return 'Player was struck by lightning';
      case 'kill': return 'Player was killed';
      default: return name ? `Player was slain by ${name}` : 'Player died';
    }
  }
  die(src) {
    this.dismount();
    const s = this.stats;
    this.alive = false; s.health = 0;
    const msg = this.deathMessage(src);
    this.chat(msg, '#ff8080');
    if (this.net) this.net.send({ t: 'chat', id: this.net.myId, text: msg, color: '#ff8080' });
    if (!this.rules.keepInventory) {
      const p = this.player.pos;
      for (const st of this.inv.allStacks()) this.dropItem(p[0], p[1] + 1, p[2], st, [rnd(-3, 3), rnd(2, 5), rnd(-3, 3)]);
      this.inv.clearAll();
      this.spawnXp([p[0], p[1] + 1, p[2]], Math.min(100, s.level * 7));
      s.xp = 0; s.level = 0; s.xpProgress = 0;
    }
    this.app.onDeath(msg, s.score);
  }
  respawn() {
    const s = this.stats;
    Object.assign(s, { health: 20, absorption: 0, food: 20, sat: 5, exhaustion: 0, air: 300, fire: 0, effects: {} });
    if (this.hardcore) { this.mode = 'spectator'; this.player.mode = 'spectator'; }
    this.alive = true;
    if (this.dim !== DIM.OVERWORLD) this.changeDimension(DIM.OVERWORLD, this.spawn);
    this.player.pos = this.spawn.slice(); this.player.vel = [0, 0, 0]; this.player.fallStart = null;
    this.invul = 3; this.lastHurtAmount = Infinity;
  }
  onLand(dist, water) {
    if (water || this.player.inWeb || !this.survivalLike) return;
    const id = this.world.getBlock(this.player.pos[0], this.player.pos[1] - 0.2, this.player.pos[2]);
    let dmg = Math.ceil(dist - 3);
    if (id === B.HAY_BLOCK) dmg = Math.floor(dmg * 0.2);
    if (id === B.SLIME_BLOCK || id === B.WATER) dmg = 0;
    if (dmg > 0) { this.damagePlayer(dmg, { kind: 'fall' }); this.sound.play('hurt', null, 0.4); this.particles.block(Math.floor(this.player.pos[0]), Math.floor(this.player.pos[1] - 1), Math.floor(this.player.pos[2]), id, 0, Math.min(40, dmg * 6)); }
  }
  addXp(n) {
    const s = this.stats;
    s.score += n;
    let cur = s.xpProgress * xpForLevel(s.level) + n;
    const prevLevel = s.level;
    while (cur >= xpForLevel(s.level)) { cur -= xpForLevel(s.level); s.level++; }
    s.xpProgress = cur / xpForLevel(s.level);
    if (s.level > prevLevel && s.level % 5 === 0) this.sound.play('levelup', null, 0.6);
  }
  eat(key) {
    const it = I[key], f = it.food, s = this.stats;
    if (f.milk) { s.effects = {}; this.sound.play('drink'); return; }
    s.food = Math.min(20, s.food + f.hunger);
    s.sat = Math.min(s.food, s.sat + f.sat);
    if (f.poison && Math.random() < f.poison) this.addEffect('poison', 5);
    if (f.hunger && Math.random() < (f.hunger || 0)) {}
    if (f.regen) this.addEffect('regeneration', f.regen);
    if (f.absorption) this.addEffect('absorption', 120, f.absorption / 4);
    if (f.resistance) this.addEffect('resistance', f.resistance);
    if (f.fire) this.addEffect('fire_resistance', f.fire);
    if (key === 'rotten_flesh' && Math.random() < 0.8) this.addEffect('hunger', 30);
    if (key === 'chicken' && Math.random() < 0.3) this.addEffect('hunger', 30);
    if (key === 'chorus_fruit') for (let k = 0; k < 16; k++) { const x = this.player.pos[0] + rnd(-8, 8), z = this.player.pos[2] + rnd(-8, 8); for (let y = Math.floor(this.player.pos[1]) + 8; y > this.player.pos[1] - 8; y--) if (SOLID[this.world.getBlock(x, y, z)] && this.world.getBlock(x, y + 1, z) === B.AIR && this.world.getBlock(x, y + 2, z) === B.AIR) { this.teleportPlayer(Math.floor(x) + 0.5, y + 1, Math.floor(z) + 0.5); k = 99; break; } }
    this.sound.play('burp', null, 0.5);
    if (/stew|soup/.test(key)) this.inv.add({ key: 'bowl', count: 1 });
    if (key === 'honey_bottle') this.inv.add({ key: 'glass_bottle', count: 1 });
  }
  teleportPlayer(x, y, z) { this.player.pos = [x, y, z]; this.player.vel = [0, 0, 0]; this.player.fallStart = null; }

  updateSurvival(dt) {
    const s = this.stats, p = this.player;
    this.invul = Math.max(0, (this.invul || 0) - dt);
    for (const k of Object.keys(s.effects)) {
      s.effects[k] -= dt;
      if (s.effects[k] <= 0) { delete s.effects[k]; if (k === 'absorption') s.absorption = 0; }
    }
    p.speedMul = (s.effects.speed ? 1.2 : 1) * (s.effects.slowness ? 0.85 : 1);
    if (!this.survivalLike || !this.alive) { s.fire = 0; s.air = 300; return; }
    const e = s.effects;
    if (e.poison) { this.poisonT = (this.poisonT || 0) + dt; if (this.poisonT > 1.25) { this.poisonT = 0; if (s.health > 1) this.damagePlayer(1, { kind: 'poison' }); } }
    if (e.wither) { this.witherT = (this.witherT || 0) + dt; if (this.witherT > 2) { this.witherT = 0; this.damagePlayer(1, { kind: 'wither' }); } }
    if (e.regeneration) { this.regenT = (this.regenT || 0) + dt; if (this.regenT > 2.5) { this.regenT = 0; s.health = Math.min(s.maxHealth, s.health + 1); } }
    if (e.hunger) this.exhaust(0.1 * dt * 20 * 0.25);
    // Air.
    if (p.headInWater && !e.water_breathing) {
      s.air -= dt * 20;
      if (s.air <= -20) { s.air = 0; this.damagePlayer(2, { kind: 'drown' }); }
    } else s.air = Math.min(300, s.air + dt * 100);
    // Fire and lava.
    if (p.inLava && !e.fire_resistance) { s.fire = 15; this.lavaT = (this.lavaT || 0) + dt; if (this.lavaT > 0.5) { this.lavaT = 0; this.damagePlayer(4, { kind: 'lava' }); } }
    const feet = this.world.getBlock(p.pos[0], p.pos[1] + 0.1, p.pos[2]);
    if ((feet === B.FIRE || feet === B.CAMPFIRE) && !e.fire_resistance) {
      s.fire = Math.max(s.fire, 8);
      // Standing in flames hurts on top of burning.
      this.inFireT = (this.inFireT || 0) + dt;
      if (this.inFireT > 0.55) { this.inFireT = 0; this.damagePlayer(1, { kind: "fire" }); }
    } else this.inFireT = 0;
    if (feet === B.SWEET_BERRY_BUSH && Math.hypot(p.vel[0], p.vel[2]) > 0.5 && Math.random() < dt * 2) this.damagePlayer(1, { kind: 'fire' });
    if (s.fire > 0) {
      s.fire -= dt;
      if (p.inWater || (this.raining && this.world.lightAt(p.pos[0], p.pos[1] + 1, p.pos[2]).sky >= 15)) s.fire = 0;
      this.fireT = (this.fireT || 0) + dt;
      if (this.fireT > 1 && !e.fire_resistance) { this.fireT = 0; this.damagePlayer(1, { kind: 'fire' }); }
    }
    const under = this.world.getBlock(p.pos[0], p.pos[1] - 0.2, p.pos[2]);
    if (under === B.CACTUS || this.world.getBlock(p.pos[0] + 0.35, p.pos[1] + 0.5, p.pos[2]) === B.CACTUS || this.world.getBlock(p.pos[0] - 0.35, p.pos[1] + 0.5, p.pos[2]) === B.CACTUS || this.world.getBlock(p.pos[0], p.pos[1] + 0.5, p.pos[2] + 0.35) === B.CACTUS || this.world.getBlock(p.pos[0], p.pos[1] + 0.5, p.pos[2] - 0.35) === B.CACTUS) this.damagePlayer(1, { kind: 'mob' });
    if (under === B.BASALT && (this.world.getMeta(p.pos[0], p.pos[1] - 0.2, p.pos[2]) & 7) === 4 && !p.sneaking) this.damagePlayer(1, { kind: 'fire' });
    if (p.pos[1] < -64) this.damagePlayer(4, { kind: 'void' });
    // Hunger.
    if (p.sprinting) this.exhaust(0.1 * (p.distanceMoved || 0));
    if (p.inWater && p.headInWater) this.exhaust(0.01 * (p.distanceMoved || 0));
    if (s.exhaustion >= 4) { s.exhaustion -= 4; if (s.sat > 0) s.sat = Math.max(0, s.sat - 1); else s.food = Math.max(0, s.food - 1); }
    p.noSprint = s.food <= 6;
    this.foodT = (this.foodT || 0) + dt;
    if (this.difficulty === 'peaceful') { if (this.foodT > 1) { this.foodT = 0; s.health = Math.min(s.maxHealth, s.health + 1); s.food = Math.min(20, s.food + 1); } return; }
    if (this.rules.naturalRegeneration && s.food >= 20 && s.sat > 0 && s.health < s.maxHealth && this.foodT > 0.5) { this.foodT = 0; const h = Math.min(1, s.sat / 6); s.health = Math.min(s.maxHealth, s.health + h); s.exhaustion += h * 6; }
    else if (this.rules.naturalRegeneration && s.food >= 18 && s.health < s.maxHealth && this.foodT > 4) { this.foodT = 0; s.health = Math.min(s.maxHealth, s.health + 1); s.exhaustion += 6; }
    else if (s.food <= 0 && this.foodT > 4) { this.foodT = 0; const floor = this.difficulty === 'hard' ? 0 : this.difficulty === 'normal' ? 1 : 10; if (s.health > floor) this.damagePlayer(1, { kind: 'starve' }); }
  }

  // ---------------- per-frame tick ----------------
  update(dt) {
    this.bossBar = null; // bosses re-register every tick while nearby
    this.pathBudget = 4; // A* searches allowed per tick across all mobs
    this.time += dt;
    if (this.timers.length) { const now = this.time; const due = this.timers.filter(t => t.t <= now); this.timers = this.timers.filter(t => t.t > now); for (const t of due) t.fn(); }
    if (this.rules.doDaylightCycle && this.dim === DIM.OVERWORLD) {
      const prev = this.dayTime;
      this.dayTime = (this.dayTime + dt / DAY) % 1;
      if (this.dayTime < prev) { this.day++; this.nightsNoSleep++; }
    }
    this.updateWeather(dt);
    this.updateSurvival(dt);
    this.sim.update(dt);
    this.entities.update(dt);
    this.particles.update(dt);
    this.tickBlockEntities(dt);
    this.spawnTick(dt);
    this.portalTick(dt);
    if (this.stats.health > 0 && this.stats.effects.night_vision) this.nightVision = 1; else this.nightVision = 0;
  }
  updateWeather(dt) {
    const w = this.weather;
    if (this.rules.doWeatherCycle) {
      w.timer -= dt;
      if (w.timer <= 0) {
        if (w.target) { w.target = 0; w.thunderOn = false; w.timer = rnd(600, 1500); }
        else { w.target = 1; w.thunderOn = Math.random() < 0.25; w.timer = rnd(240, 600); }
      }
    }
    const tgt = w.target ? 1 : 0;
    w.rain += (tgt - w.rain) * Math.min(1, dt * 0.15);
    w.thunder += ((w.thunderOn && w.target ? 1 : 0) - w.thunder) * Math.min(1, dt * 0.15);
    if (this.dim === DIM.OVERWORLD && w.thunder > 0.8 && Math.random() < dt / 12) {
      const p = this.player.pos, x = p[0] + rnd(-48, 48), z = p[2] + rnd(-48, 48);
      const h = this.world.heightAt(x, z);
      if (h > 0) this.entities.add(new Lightning(this, Math.floor(x) + 0.5, h + 1, Math.floor(z) + 0.5));
    }
  }
  // Furnaces smelt, spawners spawn.
  tickBlockEntities(dt) {
    for (const [k, be] of this.world.blockEntities) {
      if (be.type === 'furnace') { if (!(this.net && !this.net.isHost)) this.tickFurnace(k, be, dt); }
      else if (be.type === 'spawner') this.tickSpawner(be, dt);
    }
  }
  tickFurnace(k, be, dt) {
    const c = this.containerOf(be, 3);
    const input = c.get(0), fuel = c.get(1), out = c.get(2);
    const recipe = input && SMELTING[input.key];
    const canOut = recipe && (!out || (out.key === recipe.out && out.count + recipe.count <= maxStack(out.key)));
    be.burn = be.burn || 0; be.cook = be.cook || 0;
    if (be.burn <= 0 && canOut && fuel && fuelOf(fuel.key)) {
      be.burn = be.burnMax = fuelOf(fuel.key) * 0.5; // seconds (one item smelts in 10s; coal = 8 items)
      if (fuel.key === 'lava_bucket') c.set(1, { key: 'bucket', count: 1 }); else { fuel.count--; c.set(1, fuel.count ? fuel : null); }
    }
    const wasLit = be.lit;
    if (be.burn > 0) { be.burn -= dt; be.lit = true; } else be.lit = false;
    if (be.burn > 0 && canOut) {
      be.cook += dt / 10;
      if (be.cook >= 1) {
        be.cook = 0;
        input.count--; c.set(0, input.count ? input : null);
        c.set(2, out ? { ...out, count: out.count + recipe.count } : { key: recipe.out, count: recipe.count });
        be.xp = (be.xp || 0) + recipe.xp;
      }
    } else be.cook = Math.max(0, be.cook - dt / 5);
    if (wasLit !== be.lit) {
      const [x, y, z] = k.split(',').map(Number);
      const m = this.world.getMeta(x, y, z);
      if (this.world.getBlock(x, y, z) === B.FURNACE) this.world.setBlock(x, y, z, B.FURNACE, (m & ~1) | (be.lit ? 1 : 0), false);
      this.world.blockEntities.set(k, be);
    }
  }
  tickSpawner(be, dt) {
    if (this.difficulty === 'peaceful' && MOBS[be.mob]?.kind === 'hostile') return;
    const p = this.player.pos;
    if (Math.hypot(p[0] - be.x, p[1] - be.y, p[2] - be.z) > 16) return;
    be.t = (be.t ?? rnd(2, 8)) - dt;
    if (Math.random() < dt * 2) this.particles.fx('flame', [be.x + 0.5, be.y + 0.5, be.z + 0.5], 1, 0.4, 0.1);
    if (be.t > 0) return;
    be.t = rnd(10, 40);
    if (this.entities.count(e => e.mobType === be.mob && Math.abs(e.pos[0] - be.x) < 9 && Math.abs(e.pos[2] - be.z) < 9) >= 6) return;
    for (let k = 0; k < 4; k++) {
      const x = be.x + rnd(-4, 4), z = be.z + rnd(-4, 4), y = be.y + Math.floor(rnd(-1, 2));
      if (this.world.getBlock(x, y, z) === B.AIR && this.world.getBlock(x, y + 1, z) === B.AIR && SOLID[this.world.getBlock(x, y - 1, z)]) {
        this.spawnMob(be.mob, Math.floor(x) + 0.5, y, Math.floor(z) + 0.5);
        this.particles.smoke([x, y + 0.5, z], 8);
      }
    }
  }

  // ---------------- natural spawning ----------------
  spawnTick(dt) {
    this.spawnT = (this.spawnT || 0) - dt;
    if (this.spawnT > 0 || !this.rules.doMobSpawning) return;
    this.spawnT = 0.5;
    const p = this.player.pos, w = this.world;
    const hostiles = this.entities.count(e => e.def && e.def.kind === 'hostile' && !e.persistent);
    const passives = this.entities.count(e => e.def && (e.def.kind === 'passive' || e.def.kind === 'neutral'));
    const water = this.entities.count(e => e.def && e.def.kind === 'water');
    const ambient = this.entities.count(e => e.def && e.def.kind === 'ambient');
    for (let attempt = 0; attempt < 3; attempt++) {
      const a = Math.random() * Math.PI * 2, r = rnd(24, 60);
      const x = Math.floor(p[0] + Math.cos(a) * r), z = Math.floor(p[2] + Math.sin(a) * r);
      if (!w.isLoaded(x, z)) continue;
      const top = w.heightAt(x, z);
      // Pick a candidate height: surface or a random cave spot.
      let y = Math.random() < 0.5 ? top + 1 : Math.floor(rnd(5, Math.max(6, top)));
      if (this.dim !== DIM.OVERWORLD) y = Math.floor(rnd(8, 120));
      let found = false;
      for (let k = 0; k < 12; k++, y--) {
        if (y < 1) break;
        const g0 = w.getBlock(x, y - 1, z), a0 = w.getBlock(x, y, z), a1 = w.getBlock(x, y + 1, z);
        if (SOLID[g0] && g0 !== B.BEDROCK && g0 !== B.GLASS && (a0 === B.AIR || a0 === B.SNOW || a0 === B.PLANT) && a1 === B.AIR) { found = true; break; }
        if (a0 === B.WATER && w.getBlock(x, y + 1, z) === B.WATER && water < 8 && this.dim === 0) { this.spawnWater(x, y, z); found = false; break; }
      }
      if (!found) continue;
      const l = w.lightAt(x, y, z);
      const sky = this.dim === DIM.OVERWORLD ? (this.isDay() ? l.sky : l.sky - 11 + Math.floor(this.weather.rain * 3)) : 0;
      const light = Math.max(l.blk, sky);
      const biome = BIOMES[w.biomeAt(x, z)]?.key || 'plains';
      if (Math.hypot(x - p[0], y - p[1], z - p[2]) < 24) continue;
      if (this.difficulty !== 'peaceful' && hostiles < 30 && (light === 0 || (this.dim !== DIM.OVERWORLD && light < 8))) {
        const type = this.pickHostile(biome, y, x, z);
        if (type) { const n = type === 'enderman' || type === 'witch' ? 1 : Math.floor(rnd(1, 4)); for (let i = 0; i < n; i++) this.spawnMob(type, x + 0.5 + rnd(-1, 1), y, z + 0.5 + rnd(-1, 1)); continue; }
      }
      if (this.dim === DIM.OVERWORLD && l.sky < 6 && y < top - 4 && ambient < 6 && Math.random() < 0.3) { this.spawnMob('bat', x + 0.5, y + 0.5, z + 0.5); continue; }
      if (this.dim === DIM.OVERWORLD && passives < 14 && light >= 9 && w.getBlock(x, y - 1, z) === B.GRASS_BLOCK && Math.random() < 0.08) {
        const t = ['cow', 'pig', 'sheep', 'chicken'][Math.floor(Math.random() * 4)];
        for (let i = 0; i < 3; i++) this.spawnMob(t, x + 0.5 + rnd(-2, 2), y, z + 0.5 + rnd(-2, 2));
      }
    }
    // Phantoms for players that haven't slept in 3+ nights.
    if (this.rules.doInsomnia && this.dim === 0 && !this.isDay() && this.nightsNoSleep >= 3 && this.survivalLike && this.difficulty !== 'peaceful' && Math.random() < 0.01 && this.world.lightAt(p[0], p[1] + 1, p[2]).sky >= 14 && this.entities.count(e => e.mobType === 'phantom') < 3) {
      this.spawnMob('phantom', p[0] + rnd(-10, 10), p[1] + 22, p[2] + rnd(-10, 10));
    }
    // Wandering trader occasionally.
    if (this.dim === 0 && this.isDay() && Math.random() < 0.0004 && !this.entities.count(e => e.mobType === 'wandering_trader')) {
      const x = p[0] + rnd(-20, 20), z = p[2] + rnd(-20, 20), h = this.world.heightAt(x, z);
      if (h > 0) this.spawnMob('wandering_trader', x, h + 1, z);
    }
  }
  pickHostile(biome, y, x, z) {
    const r = Math.random();
    if (this.dim === DIM.NETHER) {
      if (biome === 'crimson_forest') return r < 0.5 ? 'hoglin' : 'piglin';
      if (biome === 'warped_forest') return 'enderman';
      if (biome === 'soul_sand_valley') return r < 0.6 ? 'skeleton' : r < 0.8 ? 'ghast' : 'enderman';
      if (biome === 'basalt_deltas') return 'magma_cube';
      return r < 0.5 ? 'zombified_piglin' : r < 0.7 ? 'ghast' : r < 0.85 ? 'magma_cube' : 'piglin';
    }
    if (this.dim === DIM.END) return 'enderman';
    if (biome === 'mushroom_fields') return null;
    if (biome === 'swamp' && r < 0.12 && y > 50) return 'slime';
    if (y < 40 && r < 0.04) return 'slime';
    const desert = biome === 'desert', cold = COLD.has(BIOMES.find(b => b.key === biome)?.id);
    const opts = [['zombie', 95], ['skeleton', 90], ['creeper', 90], ['spider', 90], ['enderman', 10], ['witch', 5], ['zombie_villager', 5]];
    let total = 0; for (const o of opts) total += o[1];
    let k = r * total;
    for (const [t, wgt] of opts) {
      if ((k -= wgt) < 0) {
        if (t === 'zombie' && desert && Math.random() < 0.8) return 'husk';
        if (t === 'skeleton' && cold && Math.random() < 0.8) return 'stray';
        return t;
      }
    }
    return 'zombie';
  }
  spawnWater(x, y, z) {
    const biome = BIOMES[this.world.biomeAt(x, z)]?.key || '';
    const warm = biome === 'warm_ocean', river = biome.includes('river'), ocean = biome.includes('ocean');
    if (!ocean && !river && Math.random() < 0.8) return;
    let t = river ? (Math.random() < 0.5 ? 'salmon' : 'squid') : warm ? (Math.random() < 0.7 ? 'tropical_fish' : 'pufferfish') : ['cod', 'cod', 'squid', 'salmon', 'dolphin'][Math.floor(Math.random() * 5)];
    if (y < 40 && Math.random() < 0.3) t = 'glow_squid';
    if (!this.isDay() && this.difficulty !== 'peaceful' && Math.random() < 0.15) t = 'drowned';
    const n = t === 'dolphin' || t === 'drowned' ? 1 : 3;
    for (let i = 0; i < n; i++) this.spawnMob(t, x + 0.5 + rnd(-1, 1), y, z + 0.5 + rnd(-1, 1));
  }

  // ---------------- portals & dimensions ----------------
  portalTick(dt) {
    if (!this.alive) return;
    const p = this.player, w = this.world;
    this.portalCd = Math.max(0, this.portalCd - dt);
    const inNether = w.getBlock(p.pos[0], p.pos[1] + 0.5, p.pos[2]) === B.NETHER_PORTAL || w.getBlock(p.pos[0], p.pos[1] + 1.2, p.pos[2]) === B.NETHER_PORTAL;
    const inEnd = w.getBlock(p.pos[0], p.pos[1] + 0.2, p.pos[2]) === B.END_PORTAL;
    if (inEnd && this.portalCd <= 0) {
      this.portalCd = 5;
      this.sound.play('portal_travel', null, 0.8);
      if (this.dim === DIM.END) { this.changeDimension(DIM.OVERWORLD, this.spawn); if (this.dragonKilled) this.advance('end_escape', 'The End?', 'Escape the island', 'dragon_egg'); }
      else { this.changeDimension(DIM.END, [100.5, 49, 0.5]); this.advance('enter_end', 'The End', 'Enter the End Portal', 'end_stone'); }
      return;
    }
    if (inNether && this.portalCd <= 0) {
      this.portalT += dt;
      this.app.portalEffect = Math.min(1, this.portalT / 4);
      if (this.portalT >= (this.mode === 'creative' ? 0.5 : 4)) {
        this.portalT = 0; this.portalCd = 6; this.app.portalEffect = 0;
        this.sound.play('portal_travel', null, 0.8);
        const to = this.dim === DIM.NETHER ? DIM.OVERWORLD : DIM.NETHER;
        const f = to === DIM.NETHER ? 1 / 8 : 8;
        const tx = Math.floor(p.pos[0] * f), tz = Math.floor(p.pos[2] * f);
        this.changeDimension(to, [tx + 0.5, to === DIM.NETHER ? 70 : 100, tz + 0.5], { portal: true });
        if (to === DIM.NETHER) this.advance('nether', 'We Need to Go Deeper', 'Build, light and enter a Nether Portal', 'obsidian');
      }
    } else { this.portalT = Math.max(0, this.portalT - dt * 2); this.app.portalEffect = this.portalT / 4; }
  }
  changeDimension(dim, pos, { portal = false } = {}) {
    this.dismount();
    if (this.net) this.net.share.leaveDim(this.dim);
    this.dims[this.dim] = this.serializeDim();
    this.openWorld(dim);
    this.player.world = this.world;
    this.player.pos = pos.slice();
    this.player.vel = [0, 0, 0];
    this.player.fallStart = null;
    this.pendingArrival = { portal, dim, pos: pos.slice(), t: 0 };
    this.app.onDimensionChange(dim);
    this.chat(`Entering ${{ 0: 'the Overworld', 1: 'the Nether', 2: 'the End' }[dim]}…`, '#aaaaaa');
  }
  // Called each frame until chunks around the arrival point load: finds/creates a portal or platform.
  settleArrival() {
    const a = this.pendingArrival;
    if (!a) return;
    const w = this.world, p = this.player;
    if (!w.isReadyAround(a.pos[0], a.pos[2], 1)) { p.pos = a.pos.slice(); p.vel = [0, 0, 0]; return; }
    this.pendingArrival = null;
    const x0 = Math.floor(a.pos[0]), z0 = Math.floor(a.pos[2]);
    if (a.dim === DIM.END) {
      // Obsidian landing platform like the original.
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { w.setBlock(x0 + dx, 47, z0 + dz, B.OBSIDIAN, 0); for (let y = 48; y <= 50; y++) w.setBlock(x0 + dx, y, z0 + dz, B.AIR, 0); }
      p.pos = [x0 + 0.5, 48, z0 + 0.5];
      if (!this.dragonKilled && !this.entities.list.some(e => e.mobType === 'ender_dragon')) this.spawnMob('ender_dragon', 0, 100, 0, { persistent: true });
      return;
    }
    if (a.portal) {
      // Look for an existing portal nearby.
      for (let r = 0; r <= 16; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let y = 5; y < (a.dim === DIM.NETHER ? 124 : 250); y++) if (w.getBlock(x0 + dx, y, z0 + dz) === B.NETHER_PORTAL && w.getBlock(x0 + dx, y - 1, z0 + dz) !== B.NETHER_PORTAL) { p.pos = [x0 + dx + 0.5, y, z0 + dz + 0.5]; this.portalCd = 4; return; }
      }
      // Build a new one on the nearest safe ground.
      let best = null;
      for (let r = 0; r <= 12 && !best; r += 2) for (let dx = -r; dx <= r && !best; dx += 2) for (let dz = -r; dz <= r && !best; dz += 2) {
        const top = a.dim === DIM.NETHER ? 120 : w.heightAt(x0 + dx, z0 + dz);
        for (let y = Math.min(top + 1, 120); y > 8; y--) {
          if (SOLID[w.getBlock(x0 + dx, y - 1, z0 + dz)] && w.getBlock(x0 + dx, y - 1, z0 + dz) !== B.LAVA && [0, 1, 2, 3].every(k => w.getBlock(x0 + dx, y + k, z0 + dz) === B.AIR && w.getBlock(x0 + dx + 1, y + k, z0 + dz) === B.AIR)) { best = [x0 + dx, y, z0 + dz]; break; }
        }
      }
      if (!best) best = [x0, a.dim === DIM.NETHER ? 70 : Math.max(70, w.heightAt(x0, z0) + 1), z0];
      const [bx, by, bz] = best;
      for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 1; dz++) if (!SOLID[w.getBlock(bx + dx, by - 1, bz + dz)]) w.setBlock(bx + dx, by - 1, bz + dz, B.OBSIDIAN, 0);
      for (let dx = -1; dx <= 2; dx++) for (let dy = -1; dy <= 3; dy++) {
        const edge = dx === -1 || dx === 2 || dy === -1 || dy === 3;
        w.setBlock(bx + dx, by + dy, bz, edge ? B.OBSIDIAN : B.NETHER_PORTAL, 0);
        if (!edge) for (const dz of [-1, 1]) if (SOLID[w.getBlock(bx + dx, by + dy, bz + dz)]) w.setBlock(bx + dx, by + dy, bz + dz, B.AIR, 0);
      }
      p.pos = [bx + 0.5, by, bz + 0.5];
      this.portalCd = 4;
      return;
    }
    // Plain arrival: stand on top of the ground.
    const h = w.heightAt(x0, z0);
    if (h > 0 && a.dim === DIM.OVERWORLD) p.pos = [a.pos[0], h + 1, a.pos[2]];
  }
  // Flint and steel inside an obsidian frame lights a portal.
  tryLightPortal(x, y, z) {
    const w = this.world;
    for (const axis of [0, 1]) {
      const [ax, az] = axis === 0 ? [1, 0] : [0, 1];
      let bx = x, bz = z, by = y;
      while (w.getBlock(bx - ax, by, bz - az) === B.AIR && Math.abs(bx - x) + Math.abs(bz - z) < 21) { bx -= ax; bz -= az; }
      while (w.getBlock(bx, by - 1, bz) === B.AIR && y - by < 21) by--;
      if (w.getBlock(bx - ax, by, bz - az) !== B.OBSIDIAN || w.getBlock(bx, by - 1, bz) !== B.OBSIDIAN) continue;
      let width = 0; while (width < 22 && w.getBlock(bx + ax * width, by, bz + az * width) === B.AIR) width++;
      let height = 0; while (height < 22 && w.getBlock(bx, by + height, bz) === B.AIR) height++;
      if (width < 2 || height < 3 || width > 21 || height > 21) continue;
      let ok = true;
      for (let i = 0; i < width && ok; i++) { if (w.getBlock(bx + ax * i, by - 1, bz + az * i) !== B.OBSIDIAN || w.getBlock(bx + ax * i, by + height, bz + az * i) !== B.OBSIDIAN) ok = false; for (let j = 0; j < height && ok; j++) if (w.getBlock(bx + ax * i, by + j, bz + az * i) !== B.AIR) ok = false; }
      for (let j = 0; j < height && ok; j++) if (w.getBlock(bx - ax, by + j, bz - az) !== B.OBSIDIAN || w.getBlock(bx + ax * width, by + j, bz + az * width) !== B.OBSIDIAN) ok = false;
      if (!ok) continue;
      for (let i = 0; i < width; i++) for (let j = 0; j < height; j++) w.setBlock(bx + ax * i, by + j, bz + az * i, B.NETHER_PORTAL, axis, false);
      this.sound.play('portal', [x, y, z], 1);
      return true;
    }
    return false;
  }
  // Eye placed in an end portal frame: completes the ring into an active portal.
  checkEndPortal(x, y, z) {
    const w = this.world;
    for (let cx = x - 4; cx <= x + 4; cx++) for (let cz = z - 4; cz <= z + 4; cz++) {
      const ring = [];
      for (let i = -1; i <= 1; i++) ring.push([cx + i, cz - 2], [cx + i, cz + 2], [cx - 2, cz + i], [cx + 2, cz + i]);
      if (ring.every(([a, b]) => w.getBlock(a, y, b) === B.END_PORTAL_FRAME && (w.getMeta(a, y, b) >> 2) & 1)) {
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) w.setBlock(cx + i, y, cz + j, B.END_PORTAL, 0);
        this.sound.play('portal_travel', [cx, y, cz], 1.5);
        this.advance('eye_spy', 'Eye Spy', 'Activate an End Portal', 'ender_eye');
        return true;
      }
    }
    return false;
  }
  onDragonDeath(d) {
    this.dragonKilled = true;
    this.sound.play('dragon_death', null, 1.5);
    this.spawnXp([0, 80, 0], 12000);
    const w = this.world;
    const top = Math.max(60, w.heightAt(0, 0));
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const r = Math.hypot(dx, dz);
      if (r > 3.5) continue;
      w.setBlock(dx, top, dz, r > 2.5 ? B.BEDROCK : B.END_PORTAL, 0);
      w.setBlock(dx, top - 1, dz, B.BEDROCK, 0);
    }
    for (let y = top; y < top + 4; y++) w.setBlock(0, y, 0, B.BEDROCK, 0);
    w.setBlock(0, top + 4, 0, B.DRAGON_EGG, 0);
    this.advance('free_end', 'Free the End', 'Good luck', 'dragon_egg');
    this.chat('The Ender Dragon has been slain! An exit portal opened at the centre of the island.', '#e070ff');
  }
  onKill(mob) {
    this.stats.score += 1;
    if (mob.def.kind === 'hostile') this.advance('monster_hunter', 'Monster Hunter', 'Kill any hostile monster', 'iron_sword');
  }
  onPickup(key) {
    if (/_log$|_stem$/.test(key)) this.advance('wood', 'Getting Wood', 'Punch a tree until a block of wood pops out', 'oak_log');
    if (key === 'diamond') this.advance('diamonds', 'Diamonds!', 'Acquire diamonds', 'diamond');
    if (key === 'iron_ingot') this.advance('iron', 'Acquire Hardware', 'Smelt an Iron Ingot', 'iron_ingot');
    if (key === 'obsidian') this.advance('obsidian', 'Ice Bucket Challenge', 'Obtain a block of Obsidian', 'obsidian');
  }
  onCraft(stack) {
    this.sound.play('pop', null, 0.3, 0.8);
    if (stack.key === 'crafting_table') this.advance('bench', 'Benchmarking', 'Craft a crafting table', 'crafting_table');
    if (stack.key.endsWith('_pickaxe')) this.advance('pick', 'Time to Mine!', 'Craft a pickaxe', stack.key);
    if (stack.key === 'furnace') this.advance('furnace', 'Hot Topic', 'Construct a furnace', 'furnace');
    if (stack.key === 'bread') this.advance('bread', 'Bake Bread', 'Turn wheat into bread', 'bread');
  }
  onSmelt(stack, be) { if (be.xp) { this.spawnXp([this.player.pos[0], this.player.pos[1] + 1, this.player.pos[2]], Math.floor(be.xp) + (Math.random() < be.xp % 1 ? 1 : 0)); be.xp = 0; } if (stack) this.onPickup(stack.key); }
  onTrade(v, t) {
    t.uses++;
    const s = { ...t.sell };
    this.sound.play('trade', v.pos, 0.6);
    v.xp = (v.xp || 0) + (t.xp || 2);
    this.spawnXp([v.pos[0], v.pos[1] + 1, v.pos[2]], 3 + Math.floor(Math.random() * 4));
    const need = [0, 10, 70, 150, 250];
    if (v.level < 5 && v.xp >= need[v.level]) { v.level++; v.trades.push(...unlockLevel(v.profession, v.level)); this.particles.fx('happy', v.center(), 10, 0.5); }
    this.advance('trade', 'What a Deal!', 'Successfully trade with a Villager', 'emerald');
    return s;
  }
  openTrade(v) { this.gui.openTrade(v); }
  onGuiOpen() { this.app.onGuiOpen(); }
  onGuiClose() { this.app.onGuiClose(); }
  get creativeMenu() { return this.mode === 'creative'; }
}
export { DIM_NAMES, HEIGHT, st };
