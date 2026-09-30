// Cinematic demo ("attract mode"): loads a real, unsaved world and plays a looping sequence of
// scripted camera shots — villages, mob parades, a forest fire, a night battle with explosions,
// caves, a Nether fortress, the End and the Wither. Every shot is set up behind a fade while its
// chunks stream in, then the camera follows smooth eased paths. Esc exits, Space skips.
import { B, st, DIM } from './data/blocks.js?v=munko4yf';

const $ = id => document.getElementById(id);
const ease = x => x * x * (3 - 2 * x);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const DEMO_SEED = 777;

export class Demo {
  constructor(app) {
    this.app = app;
    this.shots = SHOTS;
    this.index = -1;
    this.state = 'idle';
    this.cam = null;
    this.spawned = [];
    this.fade = 1;
    this.token = 0;
  }
  get g() { return this.app.game; }

  start() {
    const g = this.g;
    for (const c of ['/gamerule doDaylightCycle false', '/gamerule doWeatherCycle false', '/gamerule doMobSpawning false', '/weather clear', '/difficulty normal']) this.app.commands.run(c);
    g.rules.keepInventory = true;
    this.app.setGameMode('spectator');
    $('demo').classList.remove('hidden');
    this.next();
  }
  stop() {
    this.token++;
    $('demo').classList.add('hidden');
    $('demo-fade').style.opacity = 0;
  }
  skip() { if (this.state === 'play') this.next(); }

  // ---------------- helpers used by shots ----------------
  ready(x, z, r = 3) {
    const w = this.g.world, cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const c = w.chunk(cx + dx, cz + dz); if (!c || !(c.meshedVersion > 0)) return false; }
    return true;
  }
  async waitReady(x, y, z, r = 3, timeout = 30000) {
    const tok = this.token, t0 = performance.now();
    this.hold = [x, y, z];
    while (!this.ready(x, z, r) && performance.now() - t0 < timeout) { await sleep(120); if (tok !== this.token) throw new Error('cancelled'); }
    await sleep(250);
  }
  locate(kind, x, z) { return new Promise(res => this.g.world.locate(kind, x, z, r => res(r))); }
  async toDim(dim, pos) {
    const g = this.g;
    if (g.dim === dim) return;
    this.clearSpawned();
    g.changeDimension(dim, pos);
    const tok = this.token;
    while (g.pendingArrival) { g.settleArrival(); this.hold = g.player.pos.slice(); await sleep(120); if (tok !== this.token) throw new Error('cancelled'); }
    this.app.setMode('play');
  }
  spawn(type, x, y, z, opts = {}) { const m = this.g.spawnMob(type, x, y, z, { persistent: true, ...opts }); if (m) this.spawned.push(m); return m; }
  ground(x, z) { return this.g.world.heightAt(x, z) + 1; }
  setTime(t) { this.app.commands.run(`/time set ${t}`); }
  clearSpawned() { for (const m of this.spawned) m.dead = true; this.spawned = []; }

  // ---------------- sequencing ----------------
  async next() {
    const tok = ++this.token;
    this.state = 'loading';
    this.captionOff();
    await this.fadeTo(1, 0.6);
    if (tok !== this.token) return;
    this.index = (this.index + 1) % this.shots.length;
    const shot = this.shots[this.index];
    this.clearSpawned();
    try {
      this.ctx = {};
      await shot.setup(this, this.ctx);
      if (tok !== this.token) return;
    } catch (e) {
      if (tok !== this.token) return;
      console.warn('demo shot skipped', shot.title, e);
      this.next();
      return;
    }
    this.shot = shot; this.t = 0; this.fired = new Set();
    this.state = 'play';
    this.cam = this.camFor(0);
    this.caption(shot.title, shot.sub);
    this.fadeTo(0, 1.0);
    this.updateDots();
  }
  fadeTo(v, s) {
    const el = $('demo-fade');
    el.style.transition = `opacity ${s}s`;
    el.style.opacity = v;
    return sleep(s * 1000 + 30);
  }
  caption(title, sub) {
    $('demo-title').textContent = title; $('demo-sub').textContent = sub;
    const c = $('demo-caption'); c.classList.remove('show'); void c.offsetWidth;
    setTimeout(() => c.classList.add('show'), 700);
  }
  captionOff() { $('demo-caption').classList.remove('show'); }
  updateDots() { $('demo-dots').innerHTML = this.shots.map((s, i) => `<i class="${i === this.index ? 'on' : ''}"></i>`).join(''); }

  camFor(t) {
    const c = this.shot.cam(t / this.shot.dur, this.ctx, this);
    const d = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]];
    return { pos: c.pos, yaw: Math.atan2(-d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), roll: c.roll || 0 };
  }
  // Called every frame after the game has ticked.
  update(dt) {
    const g = this.g, p = g.player;
    if (this.state === 'play') {
      this.t += dt;
      for (const [i, ev] of (this.shot.events || []).entries()) if (!this.fired.has(i) && this.t >= ev[0] * this.shot.dur) { this.fired.add(i); try { ev[1](this, this.ctx); } catch (e) { console.warn(e); } }
      this.cam = this.camFor(Math.min(this.t, this.shot.dur));
      if (this.t > this.shot.dur - 1.2) this.captionOff();
      if (this.t >= this.shot.dur) this.next();
    }
    // Keep the (invisible, spectating) player with the camera so chunks stream around it.
    const at = this.state === 'play' && this.cam ? this.cam.pos : this.hold;
    if (at) { p.pos = [at[0], at[1] - 1.62, at[2]]; p.vel = [0, 0, 0]; }
    if (this.cam) { p.yaw = this.cam.yaw; p.pitch = this.cam.pitch; }
  }
}

// ---------------- camera path helpers ----------------
const orbit = (c, r, h, a0, a1, lookUp = 0) => (u) => { const a = lerp(a0, a1, ease(u)); return { pos: [c[0] + Math.cos(a) * r, c[1] + h, c[2] + Math.sin(a) * r], look: [c[0], c[1] + lookUp, c[2]] }; };
const dolly = (p0, p1, l0, l1) => (u) => { const e = ease(u); return { pos: lerp3(p0, p1, e), look: lerp3(l0, l1 || l0, e) }; };

// ---------------- the shots ----------------
async function atVillage(d, ctx) {
  if (d.g.dim !== DIM.OVERWORLD) await d.toDim(DIM.OVERWORLD, [0.5, 100, 0.5]);
  if (!d.village) d.village = await d.locate('village', 0, 0) || { x: 0, y: 70, z: 0 };
  const v = d.village;
  await d.waitReady(v.x, v.y + 20, v.z, 3);
  ctx.v = [v.x + 0.5, d.ground(v.x, v.z), v.z + 0.5];
  return ctx.v;
}

const SHOTS = [
  {
    title: 'BLOCKHAVEN', sub: 'A whole voxel sandbox, written from scratch for the browser', dur: 11,
    async setup(d, ctx) { const v = await atVillage(d, ctx); d.setTime(1200); ctx.p0 = [v[0] - 48, v[1] + 20, v[2] - 40]; ctx.p1 = [v[0] - 20, v[1] + 13, v[2] - 14]; await d.waitReady(ctx.p0[0], ctx.p0[1], ctx.p0[2], 3); },
    cam: (u, ctx) => dolly(ctx.p0, ctx.p1, [ctx.v[0] + 10, ctx.v[1] + 2, ctx.v[2] + 14], [ctx.v[0] + 4, ctx.v[1], ctx.v[2] + 4])(u),
  },
  {
    title: 'Villages', sub: 'Five building styles · farms, smithies, libraries, temples · villagers with jobs and trades', dur: 12,
    async setup(d, ctx) { await atVillage(d, ctx); d.setTime(4000); },
    cam: (u, ctx) => orbit(ctx.v, 30, 20, 0.2, 1.9)(u),
  },
  {
    title: '60 mobs', sub: 'Every creature modelled, skinned and animated in code', dur: 11,
    async setup(d, ctx) {
      let v = await atVillage(d, ctx); d.setTime(5000);
      // Find open, flat grass away from the buildings so nothing blocks the camera.
      const w = d.g.world; let spot = null;
      const natural = new Set([B.GRASS_BLOCK, B.DIRT, B.SAND, B.PLANT, B.FLOWER, B.SNOW, B.SANDSTONE, B.GRAVEL, B.STONE]);
      for (let r = 30; r < 120 && !spot; r += 5) for (let a = 0; a < 20 && !spot; a++) {
        const x0 = Math.floor(v[0] + Math.cos(a / 20 * Math.PI * 2) * r), z0 = Math.floor(v[2] + Math.sin(a / 20 * Math.PI * 2) * r);
        if (!d.ready(x0, z0, 1)) continue;
        const h0 = w.heightAt(x0, z0); let ok = h0 >= 62;
        for (let dx = -16; dx <= 18 && ok; dx += 2) for (let dz = -3; dz <= 9 && ok; dz += 3) {
          const h = w.heightAt(x0 + dx, z0 + dz), id = w.getBlock(x0 + dx, h, z0 + dz);
          if (Math.abs(h - h0) > 2 || !natural.has(id)) ok = false;
        }
        if (ok) spot = [x0 + 0.5, h0 + 1, z0 + 0.5];
      }
      if (spot) { v = spot; ctx.v = spot; await d.waitReady(spot[0], spot[1], spot[2], 2); }
      const types = ['cow', 'sheep', 'pig', 'chicken', 'horse', 'fox', 'wolf', 'llama', 'rabbit', 'panda', 'goat', 'polar_bear', 'mooshroom', 'donkey', 'cat', 'camel'];
      ctx.line = [];
      types.forEach((t, i) => {
        const x = v[0] - 14 + i * 2, z = v[2] + 7 + (i % 2) * 2;
        const m = d.spawn(t, x + 0.5, d.ground(x, z), z + 0.5, t === 'sheep' ? { woolColor: ['white', 'pink', 'black'][i % 3] } : {});
        if (m) { m.yaw = m.bodyYaw = Math.PI; ctx.line.push(m); }
      });
    },
    cam: (u, ctx) => { const v = ctx.v; const x = lerp(v[0] - 16, v[0] + 18, ease(u)); return { pos: [x, v[1] + 2.4, v[2] + 1], look: [x + 3, v[1] + 0.8, v[2] + 8] }; },
  },
  {
    title: 'Living fire', sub: 'Flames age, spread through forests and burn what they touch', dur: 12,
    async setup(d, ctx) {
      const v = await atVillage(d, ctx); d.setTime(6000);
      const w = d.g.world; let best = null;
      for (let r = 20; r < 70 && !best; r += 4) for (let a = 0; a < 24 && !best; a++) {
        const x = Math.floor(v[0] + Math.cos(a / 24 * Math.PI * 2) * r), z = Math.floor(v[2] + Math.sin(a / 24 * Math.PI * 2) * r);
        const h = w.heightAt(x, z);
        if (h > 0 && w.getBlock(x, h, z) === B.LEAVES) best = [x, h, z];
      }
      if (!best) { // no trees nearby: build a little wooden cabin to burn
        const x = Math.floor(v[0]) + 14, z = Math.floor(v[2]) + 14, y = d.ground(x, z), pl = st('oak_planks');
        for (let dx = 0; dx < 5; dx++) for (let dz = 0; dz < 5; dz++) for (let k = 0; k < 4; k++) if (dx % 4 === 0 || dz % 4 === 0 || k === 3) d.g.setBlock(x + dx, y + k, z + dz, pl[0], pl[1]);
        best = [x + 2, y + 3, z + 2];
      }
      ctx.f = best;
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) { const h = w.heightAt(best[0] + dx, best[2] + dz); if (w.getBlock(best[0] + dx, h + 1, best[2] + dz) === B.AIR) d.g.setBlock(best[0] + dx, h + 1, best[2] + dz, B.FIRE, 0); }
      for (let i = 0; i < 60; i++) d.g.sim.update(0.1); // give it a head start
    },
    cam: (u, ctx) => orbit([ctx.f[0], ctx.f[1] - 3, ctx.f[2]], 14, 7, 3.6, 4.9)(u),
  },
  {
    title: 'Night falls', sub: 'Zombies, skeletons and creepers — and the iron golems that fight back', dur: 14,
    async setup(d, ctx) {
      const v = await atVillage(d, ctx); d.setTime(18000);
      const x0 = v[0] + 3, z0 = v[2] - 10;
      const golem = d.spawn('iron_golem', x0 + 0.5, d.ground(x0, z0), z0 + 0.5);
      const golem2 = d.spawn('iron_golem', x0 - 3.5, d.ground(x0 - 4, z0 + 2), z0 + 2.5);
      const foes = [];
      for (let i = 0; i < 5; i++) { const x = x0 - 8 + i * 3, z = z0 - 7; const m = d.spawn(i % 3 === 2 ? 'skeleton' : 'zombie', x + 0.5, d.ground(x, z), z + 0.5); if (m) foes.push(m); }
      foes.forEach((f, i) => { f.target = i % 2 ? golem2 : golem; });
      if (golem) golem.target = foes[0]; if (golem2) golem2.target = foes[1];
      // A creeper sneaking up on a golem, and a TNT cache next to a house.
      const cx = x0 + 6, cz = z0 - 2;
      ctx.creeper = d.spawn('creeper', cx + 0.5, d.ground(cx, cz), cz + 0.5);
      ctx.tnt = [x0 + 10, 0, z0 + 3]; ctx.tnt[1] = d.ground(ctx.tnt[0], ctx.tnt[2]);
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) d.g.setBlock(ctx.tnt[0] + dx, ctx.tnt[1], ctx.tnt[2] + dz, B.TNT, 0);
      ctx.c = [x0, v[1], z0 - 3];
      ctx.golem = golem;
    },
    events: [
      [0.28, (d, ctx) => { if (ctx.creeper && !ctx.creeper.dead && ctx.golem) { ctx.creeper.target = ctx.golem; ctx.creeper.pos = [ctx.golem.pos[0] + 1.6, ctx.golem.pos[1], ctx.golem.pos[2]]; } }],
      [0.62, (d, ctx) => { d.g.igniteTnt(ctx.tnt[0], ctx.tnt[1], ctx.tnt[2], 2.5); }],
    ],
    cam: (u, ctx) => orbit(ctx.c, 15, 6, 1.2, 2.6, 1)(u),
  },
  {
    title: 'Underground', sub: 'Cheese, spaghetti and noodle caves, ravines, mineshafts, dungeons and strongholds', dur: 11,
    async setup(d, ctx) {
      const v = await atVillage(d, ctx); d.setTime(6000);
      const w = d.g.world; let best = null, bestScore = 0;
      for (let dx = -40; dx <= 40; dx += 3) for (let dz = -40; dz <= 40; dz += 3) {
        const x = Math.floor(v[0] + dx), z = Math.floor(v[2] + dz), top = w.heightAt(x, z);
        for (let y = 12; y < top - 10; y++) {
          if (w.getBlock(x, y, z) !== B.AIR) continue;
          let run = 0; while (run < 12 && w.getBlock(x, y + run, z) === B.AIR) run++;
          let wide = 0; for (let k = -6; k <= 6; k += 2) if (w.getBlock(x + k, y + 2, z) === B.AIR) wide++;
          const score = run * wide;
          if (score > bestScore && run >= 4) { bestScore = score; best = [x, y, z]; }
          y += run;
        }
      }
      if (!best) throw new Error('no cave');
      ctx.cave = best;
      // Light it up a little so it reads on camera.
      for (let k = -8; k <= 8; k += 4) for (const s of [-1, 1]) {
        const x = best[0] + k, z = best[2] + s * 3;
        for (let y = best[1] + 4; y > best[1] - 6; y--) if (w.getBlock(x, y, z) === B.AIR && w.getBlock(x, y - 1, z) !== B.AIR && w.getBlock(x, y - 1, z) !== B.WATER) { d.g.setBlock(x, y, z, st('torch')[0], st('torch')[1]); break; }
      }
      d.spawn('bat', best[0] + 2.5, best[1] + 2, best[2] + 0.5);
      d.spawn('zombie', best[0] + 4.5, best[1], best[2] + 1.5);
    },
    cam: (u, ctx) => { const c = ctx.cave; return dolly([c[0] - 9, c[1] + 2.5, c[2] - 2], [c[0] + 7, c[1] + 2, c[2] + 1], [c[0], c[1] + 1, c[2] + 6], [c[0] + 14, c[1] + 1, c[2] + 2])(u); },
  },
  {
    title: 'The Nether', sub: 'Five biomes above a lava sea · fortresses, bastions, blazes and ghasts', dur: 13,
    async setup(d, ctx) {
      await d.toDim(DIM.NETHER, [0.5, 70, 0.5]);
      const f = await d.locate('fortress', 0, 0);
      if (!f) throw new Error('no fortress');
      await d.waitReady(f.x, f.y + 8, f.z, 3);
      ctx.f = [f.x + 0.5, f.y, f.z + 0.5];
      d.spawn('blaze', f.x + 2.5, f.y + 2, f.z + 2.5);
      d.spawn('blaze', f.x - 2.5, f.y + 3, f.z + 1.5);
      d.spawn('ghast', f.x + 18, f.y + 14, f.z - 10);
      d.spawn('wither_skeleton', f.x + 9.5, f.y, f.z + 0.5);
      d.spawn('zombified_piglin', f.x - 9.5, f.y, f.z + 0.5);
    },
    cam: (u, ctx) => orbit(ctx.f, 20, 9, -0.6, 0.9, 1)(u),
  },
  {
    title: 'The End', sub: 'Obsidian pillars, end crystals and the Ender Dragon', dur: 13,
    async setup(d, ctx) {
      await d.toDim(DIM.END, [100.5, 49, 0.5]);
      await d.waitReady(0, 80, 0, 4);
      ctx.c = [0, 66, 0];
    },
    cam: (u, ctx, d) => { const o = orbit(ctx.c, 72, 26, 0.3, 1.4, 12)(u); const dr = d.g.entities.list.find(e => e.mobType === 'ender_dragon'); if (dr) o.look = lerp3(o.look, dr.pos, 0.6); return o; },
  },
  {
    title: 'Bosses', sub: 'Build the Wither from soul sand and skulls — if you dare', dur: 13,
    async setup(d, ctx) {
      if (d.g.dim !== DIM.END) await d.toDim(DIM.END, [100.5, 49, 0.5]);
      const x = 60, z = 30;
      await d.waitReady(x, 80, z, 3);
      const y = d.ground(x, z);
      ctx.w = d.spawn('wither', x + 0.5, y + 6, z + 0.5);
      for (let i = 0; i < 5; i++) { const ex = x - 8 + i * 4, ez = z + 6; d.spawn('enderman', ex + 0.5, d.ground(ex, ez), ez + 0.5); }
      ctx.c = [x, y, z];
    },
    cam: (u, ctx) => {
      // Follow the Wither itself, smoothing its motion so the camera never jerks.
      const w = ctx.w && !ctx.w.dead ? ctx.w.pos : ctx.c;
      ctx.fc = ctx.fc ? lerp3(ctx.fc, w, 0.04) : w.slice();
      const o = orbit([ctx.fc[0], ctx.fc[1] - 2, ctx.fc[2]], 11, 3, 2.2, 3.5, 3)(u);
      return o;
    },
  },
  {
    title: 'BLOCKHAVEN', sub: 'Every texture, model, sound and song is generated in code · Press Esc to play', dur: 12,
    async setup(d, ctx) { const v = await atVillage(d, ctx); d.setTime(12300); },
    cam: (u, ctx) => { const v = ctx.v; return dolly([v[0] + 10, v[1] + 8, v[2] + 22], [v[0] + 26, v[1] + 38, v[2] + 44], [v[0], v[1] + 2, v[2]], [v[0] - 60, v[1] + 18, v[2] - 20])(u); },
  },
];
