// Shock Shellers: boot, menus, the match flow (home → respawn screen → play → death → respawn) and
// the frame loop. The simulation runs at a fixed 30 Hz inside the session; rendering interpolates.
import './page.js?v=muwzskxe';
import { surfaceDocument as document } from './surface.js?v=muwzskxe';
import { registerApp } from './veil.js?v=muwzskxe';
import { tell } from './dialog.js?v=muwzskxe';
import { splash } from './splash.js?v=muwzskxe';
import * as THREE from '../vendor/three/three.module.js?v=muwzskxe';
import { Renderer } from './render/renderer.js?v=muwzskxe';
import { RELOAD_KIND } from './render/viewmodel.js?v=muwzskxe';
import { EggAvatar } from './render/egg.js?v=muwzskxe';
import { Recorder, planReplay, replayRate, projectileAt } from './game/replay.js?v=muwzskxe';
import { aimAssist, assistOn } from './game/aim.js?v=muwzskxe';
import { Input } from './game/input.js?v=muwzskxe';
import { SOUND_FILES } from './game/soundbank.js?v=muwzskxe';
import { Sound, registerSamples } from './game/audio.js?v=muwzskxe';
import { Hud } from './game/hud.js?v=muwzskxe';
import { loadSettings, saveSettings, loadProfile, saveProfile } from './game/store.js?v=muwzskxe';
import { ensureDaily, progress as challengeProgress, claim as claimChallenges } from './game/challenges.js?v=muwzskxe';
import { HostSession } from './game/session.js?v=muwzskxe';
import { GuestSession } from './net/guest.js?v=muwzskxe';
import { pickPublicMap, mapDef, MAPS } from './maps/index.js?v=muwzskxe';
import { WEAPONS, PRIMARIES, PLAYER, MODE_NAMES, MODE_MENU, ECONOMY, CTRL, TICK, TICK_HZ } from './sim/tuning.js?v=muwzskxe';
import { weaponOf, slotOf } from './sim/combat.js?v=muwzskxe';
import { eyePoint } from './sim/movement.js?v=muwzskxe';
import { drawLogo, drawHowTo } from './ui/art.js?v=muwzskxe';
import { loadModels } from './render/models.js?v=muwzskxe';
import { HIT } from './maps/grid.js?v=muwzskxe';
import { Menus } from './ui/menus.js?v=muwzskxe';

const $ = id => document.getElementById(id);
const show = (id, on = true) => { $(id).classList.toggle('hidden', !on); if (id === 'respawn') $('hud').classList.toggle('menu', on); };
// Footsteps per ground material (maps/dsl.js MAT): playback rate and loudness.
const STEP_SOUND = { 0: [1, 1], 1: [0.82, 0.75], 2: [1.18, 1.1], 4: [0.78, 0.7], 5: [1.4, 1.15], 6: [0.86, 0.8], 10: [0.8, 0.7], 11: [1.35, 1.1], 12: [1.15, 1.05], 13: [0.75, 0.7], 14: [0.9, 0.85], 15: [1.3, 1.1] };
// Per map theme: reverb length (s) and level.
const ROOMS = { farm: [1.2, 0.28], town: [1.6, 0.34], temple: [2.3, 0.45], hills: [0.9, 0.2], quarry: [2.5, 0.42], arena: [1.8, 0.38], space: [3.2, 0.22] };
// When each reload step sounds (fraction of the reload; true: only when reloading from empty).
const RELOAD_STEPS = {
  mag: [[0.16, 'magOut'], [0.66, 'magIn'], [0.84, 'rack', true]], pistol: [[0.16, 'magOut'], [0.66, 'magIn'], [0.79, 'rack', true]],
  break: [[0.04, 'breakOpen'], [0.6, 'shellIn'], [0.78, 'rack']], bolt: [[0.16, 'boltUp'], [0.68, 'boltDown']], rocket: [[0.62, 'rocketIn']],
};
// Resolves once a couple of frames have been drawn after now (or after 3 s in a background tab).
const settled = () => new Promise(r => { let n = 3; const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); setTimeout(r, 3000); });
const LOAD_LINES = ['Cracking eggs…', 'Whisking servers…', 'Stacking teams…', 'Greasing the pan…', 'Counting chickens…', 'Hatching plans…'];

class App {
  constructor() {
    this.settings = loadSettings();
    this.profile = loadProfile();
    ensureDaily(this.profile);
    this.canvas = $('game');
    this.renderer = new Renderer(this.canvas);
    this.renderer.baseFov = this.settings.fov;
    this.applyQuality();
    this.input = new Input(this.canvas, this.settings);
    this.keys = this.input.keys; // veil.js clears these on quick-hide
    registerSamples(SOUND_FILES);
    this.sound = new Sound(this.settings);
    this.hud = new Hud(this.settings);
    this.menus = new Menus(this);
    this.session = null; this.state = 'boot';
    this.t = 0; this.last = performance.now(); this.fps = 60; this.fpsN = 0; this.fpsT = 0; this.lowFps = 0;
    this.shake = 0; this.cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fovMul: 1 }; this.fovMul = 1; this.lean = 0; this.fallSpeed = 0; this.hurt = 0; this.lowHp = 0; this.heat = 0; this.beatT = 0;
    this.lifeKills = 0; this.spawnTick = 0; this.aim = {}; this.marked = new Map(); this.rec = new Recorder(); this.replay = null;
    this.resize(); addEventListener('resize', () => this.resize());
    // A click or a key skips the instant replay.
    for (const ev of ['mousedown', 'keydown']) document.addEventListener(ev, () => { if (this.replay && this.state === 'dead') this.replay.skip = true; });
    this.boot();
  }
  // Graphics quality: a fixed rung, or Auto (adapts to the frame rate unless Auto Detail is off).
  applyQuality() { const q = this.settings.quality || 'auto'; this.renderer.setQuality(q, q === 'auto' && this.settings.autoDetail !== false); }
  resize() {
    const u = Math.max(0.55, Math.min(1.4, Math.min(innerWidth / 1500, innerHeight / 860)));
    document.documentElement.style.setProperty('--u', u + 'px');
    this.renderer.resize(); this.hud.u = u; this.hud.maxDpr = this.renderer.uiDpr; this.hud.resize();
  }
  async boot() {
    drawLogo($('logo-load')); drawLogo($('logo-home'));
    drawHowTo($('howto-canvas'), this.settings.keys); drawHowTo($('help-canvas'), this.settings.keys);
    show('loading'); $('load-status').textContent = LOAD_LINES[Math.floor(Math.random() * LOAD_LINES.length)];
    splash.progress(0.4);
    const bar = $('load-bar');
    const step = async (p, fn) => { fn?.(); bar.style.width = Math.round(p * 100) + '%'; splash.progress(0.3 + p * 0.7); await new Promise(r => setTimeout(r, 0)); };
    await step(0.1);
    await loadModels().catch(e => console.warn('models', e));
    await step(0.2, () => this.buildHome());
    await step(0.5, () => this.menus.weaponIcons());
    await step(0.8, () => this.menus.build());
    await step(1);
    splash.ready();
    requestAnimationFrame(t => this.frame(t));
    setTimeout(() => { show('loading', false); this.goHome(); }, this.settings.seenHowTo ? 300 : 2600);
    this.settings.seenHowTo = true; saveSettings(this.settings);
  }

  // ---------------- home scene ----------------
  buildHome() {
    const s = new THREE.Scene();
    // The menu's sky gradient as the background, a studio key light, a cool fill and a warm rim, and the
    // sky for reflections, so the shell and the gun's metal catch real highlights.
    const bg = new OffscreenCanvas(4, 256), bx = bg.getContext('2d'), grad = bx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#1e86ad'); grad.addColorStop(0.65, '#7fc9e6'); grad.addColorStop(1, '#b4e2f2'); bx.fillStyle = grad; bx.fillRect(0, 0, 4, 256);
    s.background = new THREE.CanvasTexture(bg); s.background.colorSpace = THREE.SRGBColorSpace;
    s.environment = this.renderer.skyEnvironment('day');
    s.add(new THREE.HemisphereLight(0xeaf6ff, 0x5a8aa0, 1.3));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.4); key.position.set(-2, 4, 3); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -1.2; key.shadow.camera.right = key.shadow.camera.top = 1.2; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.01;
    s.add(key);
    const rim = new THREE.DirectionalLight(0xffe2b8, 2.2); rim.position.set(2.5, 2, -3); s.add(rim);   // a warm rim from behind
    const fill = new THREE.DirectionalLight(0x9fd8ff, 0.7); fill.position.set(3, 0.5, 2); s.add(fill);
    // A glossy turntable under the egg, with a lit rim.
    const ped = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.05, 64), new THREE.MeshStandardMaterial({ color: 0xd7e6ee, roughness: 0.3, envMapIntensity: 0.8 }));
    top.position.y = -0.025; top.receiveShadow = true; ped.add(top);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.07, 64), new THREE.MeshStandardMaterial({ color: 0x0b5b7d, roughness: 0.45, envMapIntensity: 0.7 }));
    base.position.y = -0.085; ped.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.425, 0.008, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23f).multiplyScalar(3), toneMapped: false }));
    ring.position.y = -0.05; ped.add(ring);
    s.add(ped);
    // A soft glow behind the egg and a few motes drifting up through the light.
    const glowTex = (() => { const c = new OffscreenCanvas(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,250,230,0.9)'); g.addColorStop(0.4, 'rgba(255,240,200,0.3)'); g.addColorStop(1, 'rgba(255,240,200,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.55, blending: THREE.AdditiveBlending }));
    glow.position.set(0, 0.45, -1.2); glow.scale.set(3.4, 3.4, 1); s.add(glow);
    const N = 40, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 3; pos[i * 3 + 1] = Math.random() * 1.8 - 0.3; pos[i * 3 + 2] = -0.4 - Math.random() * 1.2; seed[i] = Math.random(); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex, size: 0.06, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff3c8, opacity: 0.8 }));
    s.add(motes);
    this.home = { scene: s, camera: new THREE.PerspectiveCamera(28, 1, 0.1, 50), egg: null, spin: 0, ped, motes, seed, hop: -1 };
    this.home.camera.position.set(0, 0.62, 4.2); this.home.camera.lookAt(0, 0.12, 0);
    this.refreshHomeEgg();
  }
  refreshHomeEgg() {
    const h = this.home; if (!h) return;
    if (h.egg) h.scene.remove(h.egg.group);
    const e = this.profile.equip;
    h.egg = new EggAvatar({ name: '', look: e, weapon: this.profile.primary, local: true });
    h.egg.group.scale.setScalar(1.15);
    h.egg.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    h.scene.add(h.egg.group);
  }
  goHome() {
    this.leaveMatch();
    this.state = 'home';
    const got = claimChallenges(this.profile); if (got) { saveProfile(this.profile); setTimeout(() => tell(`Challenges complete! +${got} Golden Yolks`), 300); }
    show('home'); show('hud', false); show('respawn', false);
    this.menus.refreshHome();
    this.input.enabled = false; this.input.exitLock();
  }

  // ---------------- matches ----------------
  // PLAY: host a fresh bot-filled public-style room on a random map for the chosen mode.
  play() {
    const mode = this.profile.mode;
    // (The last four maps are skipped, so PLAY moves around the rotation.)
    const recent = Array.isArray(this.profile.recentMaps) ? this.profile.recentMaps : [];
    const map = pickPublicMap(mode, Math.random, recent.slice(-4));
    this.profile.recentMaps = [...recent.filter(id => id !== map), map].slice(-6);
    this.startMatch({ map, mode, options: {}, bots: undefined, difficulty: 'public', private: false });
  }
  startMatch(cfg) {
    this.sound.unlock();
    this.leaveMatch();
    const p = this.profile;
    const map = mapDef(cfg.map);
    const mode = map.modes.includes(cfg.mode) ? cfg.mode : map.modes[0];
    const session = new HostSession({ ...cfg, mode, options: { botChat: this.settings.botChat, ...cfg.options }, name: p.name, primary: p.primary, cosmetics: { ...p.equip } });
    this.enter(session);
    this.hud.chat('Opening your game to friends…', '#ffd23f');
    // Every match is a room friends can join (they take a bot's place). Opened once the map is on
    // screen: building it and compiling its shaders can freeze a Chromebook for seconds, long enough
    // to time out the multiplayer servers' connections if they were being made at the same moment.
    settled().then(() => this.session === session ? session.openRoom() : Promise.reject(new Error('left'))).then(code => {
      if (this.session !== session) { session.close(); return; }
      this.hud.chat(`Room code ${code}: click 👥 to copy it for friends!`, '#ffd23f');
      this.menus.refreshRespawn();
    }, e => { if (this.session === session) this.hud.chat('Playing offline: ' + e.message, '#ff8a80'); else session.close?.(); });
    this.profile.stats.games++; saveProfile(this.profile);
  }
  // Show a session (hosted or joined): load its map and go to the respawn screen.
  enter(session) {
    this.session = session; this.rec.clear(); this.replay = null; this.hud.replay = null;
    session.onChat = (text, color) => this.hud.chat(text, color);
    session.onDisconnected = reason => { if (this.session === session) { this.goHome(); tell(reason); } };
    this.renderer.loadMap(session.map);
    // The map's acoustics and background bed; world sounds behind walls come through muffled.
    const meta = session.map.meta, room = ROOMS[meta.theme] || ROOMS.farm;
    this.sound.setRoom(room[0], room[1]);
    this.sound.ambience(meta.id === 'henhouse' ? 'indoor' : meta.sky || 'day');
    this.sound.occluded = (x, y, z) => this.session === session && !session.match.grid.visible(this.sound.lx, this.sound.ly, this.sound.lz, x, y, z);
    this.state = 'respawn'; this.diedAt = 0; this.killer = null;
    this.lifeKills = 0;
    show('home', false); show('hud'); show('respawn');
    this.menus.refreshRespawn();
  }
  async joinRoom(code, status) {
    this.sound.unlock();
    const p = this.profile;
    const session = await GuestSession.join(code, { name: p.name, primary: p.primary, cosmetics: { ...p.equip } }, status);
    // Let the status show and the connection catch up before the slow part (building the map).
    status?.('Loading the map…'); await new Promise(r => setTimeout(r, 50));
    this.leaveMatch();
    this.enter(session);
    this.hud.chat(`Joined room ${code}.`, '#ffd23f');
  }
  leaveMatch() {
    if (!this.session) return;
    this.session.close?.();
    for (const id of [...this.renderer.avatars.keys()]) this.renderer.dropAvatar(id);
    this.sound.stopAll();
    this.session = null;
  }
  // Respawn screen PLAY: spawn and take the mouse (while the click still counts as a gesture).
  spawnMe() {
    const s = this.session; if (!s) return;
    const me = s.me;
    if (!me.alive) { if (!s.respawn()) return; }
    else if (me.pausedAt >= 0) { me.pausedAt = -1; s.respawn(); } // back before the grace window ran out
    this.input.yaw = me.body.yaw; this.input.pitch = 0;
    this.state = 'play'; show('respawn', false);
    this.input.enabled = true; this.input.requestLock();
    this.spawnTick = s.match.tick; this.lifeKills = 0;
    this.sound.play('respawn');
  }
  pause() {
    if (this.state !== 'play' || !this.session) return;
    this.session.pauseMe();
    this.state = 'respawn'; show('respawn'); this.menus.refreshRespawn();
    this.input.enabled = false;
  }

  // ---------------- events from the sim ----------------
  handle(events) {
    const s = this.session, m = s.match, me = s.me, R = this.renderer, fx = R.fx, snd = this.sound;
    const pos = id => { const p = m.players.get(id); return p ? [p.body.x, p.body.y + 0.3, p.body.z] : null; };
    for (const e of events) {
      const mine = e.id === s.myId;
      switch (e.t) {
        case 'shot': {
          this.rec.shot(m.tick, e);
          const p = m.players.get(e.id);
          if (p) {
            const a = R.avatars.get(e.id);
            // The streak starts at the visible muzzle: the viewmodel's for us, the avatar's gun for others.
            fx.streak(e.x, e.y - (mine ? 0.06 : 0), e.z, e.dx, e.dy, e.dz, e.len, WEAPONS[e.w].vel, e.tracer);
            if (!mine && a && a.group.visible) { const mz = a.muzzleWorld(new THREE.Vector3()); fx.muzzle(mz.x, mz.y, mz.z, e.w === 'doubleYolker'); }
            // Someone else's bullet passing close to our head whizzes by.
            if (!mine && me.alive && this.state === 'play') {
              const c = this.cam, t = Math.max(0, Math.min(e.len, (c.x - e.x) * e.dx + (c.y - e.y) * e.dy + (c.z - e.z) * e.dz));
              const px = e.x + e.dx * t, py = e.y + e.dy * t, pz = e.z + e.dz * t, d = Math.hypot(px - c.x, py - c.y, pz - c.z);
              if (d < 1.4 && t > 1.5 && t < e.len - 0.3) snd.play('whiz', [px, py, pz], 0.5 + (1.4 - d) * 0.5);
            }
          }
          break;
        }
        case 'fire': {
          const w = e.w;
          snd.play(w, mine ? null : pos(e.id), mine ? 0.7 : 1);
          if (mine) {
            R.view.fire(w);
            // The mechanism cycling under the bang, and a rising tick as the magazine runs low.
            if (w !== 'yolkzooka' && w !== 'doubleYolker') snd.play('mech', null, 0.8, w === 'peck9mm' ? 1.2 : 1);
            const sl = slotOf(me.hands), low = Math.max(1, Math.floor(WEAPONS[w].mag * 0.25));
            if (sl.mag <= low && WEAPONS[w].mag > 2) snd.play('lowAmmo', null, 0.8, 1 + (low - sl.mag) / low * 0.5);
            // (Aiming keeps the view steady: little shake, no field-of-view punch.)
            const aiming = me.hands.ads;
            if (this.settings.shake) this.shake = Math.min(1, this.shake + WEAPONS[w].recoil / 60 * (aiming ? 0.25 : 1));
            // A heavy shot from the hip punches the field of view out for a moment.
            if (!aiming) this.kick = Math.min(1, (this.kick || 0) + Math.min(0.8, WEAPONS[w].recoil / 40));
            // Our own shot lights the walls around us for a frame or two, and leaves the barrel smoking.
            const c = this.cam, fx2 = -Math.sin(c.yaw) * Math.cos(c.pitch), fy = Math.sin(c.pitch), fz = -Math.cos(c.yaw) * Math.cos(c.pitch);
            fx.light(c.x + fx2 * 0.8, c.y + fy * 0.8 - 0.1, c.z + fz * 0.8, w === 'doubleYolker' || w === 'yolkzooka' ? 7 : 4);
            this.heat = Math.min(3, (this.heat || 0) + (w === 'doubleYolker' || w === 'yolkzooka' || w === 'poacher' ? 1.2 : 0.22));
          }
          break;
        }
        case 'impact': fx.impact(e.x, e.y, e.z, e.nx, e.ny, e.nz); if (e.by === s.myId) snd.play('impact', [e.x, e.y, e.z], 0.7); break;
        case 'hit': {
          const v = m.players.get(e.id);
          if (e.id !== s.myId || this.state !== 'play') fx.hitSplash(e.x, e.y, e.z, e.dx, e.dy, e.dz); // (not into our own lens)
          snd.play(e.hp <= 0 ? 'crackBig' : 'crack', [e.x, e.y, e.z], 0.9);
          if (e.by === s.myId && e.id !== s.myId) {
            this.hud.hit(e.hp <= 0); this.stat('damage', e.dmg);
            // How much it did, where it landed; and their health shows over them for a while.
            this.hud.damageNumber(e.id, e.x, e.y, e.z, e.dmg, e.hp <= 0);
            if (e.hp > 0) this.marked.set(e.id, this.t); else this.marked.delete(e.id);
            // The hit tick (pitched up as the egg weakens), and a heavier crunch for the crack that kills.
            snd.play('hitmark', null, e.hp <= 0 ? 0.9 : 0.55, e.hp <= 0 ? 0.8 : 1 + (1 - Math.max(0, e.hp) / 100) * 0.35);
            snd.play('hitBody', null, e.hp <= 0 ? 0.9 : 0.7, e.hp <= 0 ? 0.8 : 1);
            if (e.hp <= 0) snd.play('killConfirm', null, 0.8);
          }
          if (e.id === s.myId) {
            const src = m.players.get(e.by);
            if (src) this.hud.damageFrom(Math.atan2(-(src.body.x - me.body.x), -(src.body.z - me.body.z)));
            else this.hud.damageFrom(this.cam.yaw);
          }
          if (v) { const a = R.avatars.get(e.id); a?.setHp(e.hp); a?.hit(e.hp <= 0); }
          if (e.id === s.myId) this.hurt = Math.min(1, this.hurt + 0.25 + e.dmg / 120);
          break;
        }
        case 'kill': {
          const v = m.players.get(e.id), k = m.players.get(e.by);
          const a = R.avatars.get(e.id);
          // (Our own burst waits for the replay, which shows it in slow motion.)
          const replayed = e.id === s.myId && k && k.id !== s.myId;
          if (!replayed) {
            fx.shatter(e.x, e.y, e.z, a ? a.color : 0xfff6e5, m.grid.floorBelow(e.x, e.y + 0.3, e.z) === -Infinity ? e.y : m.grid.floorBelow(e.x, e.y + 0.3, e.z));
            snd.play('splat', [e.x, e.y + 0.3, e.z]);
          }
          if (v) this.hud.kill(k ? k.name : '', v.name, e.w === 'melee' ? 'whisk' : e.w, k?.team || 0, v.team, e.by === s.myId || e.id === s.myId);
          if (e.by === s.myId && e.id !== s.myId) this.onMyKill(e, v);
          if (e.id === s.myId) this.onMyDeath(e, k);
          break;
        }
        case 'spawn': if (mine) this.input.yaw = me.body.yaw; else fx.sparkle(e.x, e.y + 0.4, e.z, 0xfff6dc, 16); break;
        case 'reload': snd.play('reload', mine ? null : pos(e.id), 0.8); break;
        case 'reloaded': snd.play(e.long ? 'reloadedLong' : 'reloaded', mine ? null : pos(e.id), 0.8); break;
        case 'dry': if (mine) snd.play('dry'); break;
        case 'swap': if (mine) snd.play('swap'); break;
        case 'swing': snd.play('melee', mine ? null : pos(e.id)); break;
        case 'throw': snd.play('throw', mine ? null : pos(e.id)); break;
        case 'bounce': snd.play('bounce', [e.x, e.y, e.z], 0.6); break;
        case 'rocket': this.rec.shot(m.tick, { ...e, w: 'yolkzooka', len: WEAPONS.yolkzooka.range }); snd.play('yolkzooka', mine ? null : [e.x, e.y, e.z]); break;
        case 'boom': {
          const fl = m.grid.floorBelow(e.x, e.y + 0.2, e.z);
          fx.explosion(e.x, e.y, e.z, e.r, e.w, e.team, fl === -Infinity ? null : fl); snd.play('explode', [e.x, e.y, e.z], 1.2); if (e.w === 'grenade') snd.play('squawk', [e.x, e.y + 0.3, e.z], 0.8);
          const d = Math.hypot(e.x - me.body.x, e.y - me.body.y, e.z - me.body.z);
          if (this.settings.shake && d < e.r * 1.5 * 3) this.shake = Math.min(1.5, this.shake + (1 - d / (e.r * 4.5)) * 1.2);
          // Close enough to feel it: the world goes dull for a moment (and rings, right on top of it).
          if (me.alive && d < e.r * 2.2) { snd.dull(d < e.r ? 380 : 900, d < e.r ? 1.6 : 0.9); if (d < e.r) snd.play('tinnitus'); }
          break;
        }
        case 'dud': fx.dud(e.x, e.y, e.z); snd.play('dud', [e.x, e.y, e.z]); break;
        case 'collect': { snd.play(e.kind === 'ammo' ? 'ammo' : 'pickupNade', mine ? null : pos(e.id)); const it = m.items[e.item]; if (it) fx.sparkle(it.x, it.y, it.z, e.kind === 'ammo' ? 0xffc04a : 0x8dff7a); break; }
        case 'land': {
          if (mine) { snd.play('land', null, 0.5); R.view.land(this.fallSpeed); if (this.fallSpeed > 5) fx.dust(me.body.x, me.body.y, me.body.z, Math.min(1.5, this.fallSpeed / 7)); }
          else { const p = m.players.get(e.id); if (p) fx.dust(p.body.x, p.body.y, p.body.z, 0.6); }
          break;
        }
        case 'pad': { const p = m.players.get(e.id); if (p) { fx.pad(p.body.x, p.body.y, p.body.z); snd.play('jump', mine ? null : pos(e.id), 0.9, 1.4); } break; }
        case 'jump': if (mine) snd.play('jump', null, 0.5); break;
        case 'power': if (mine) { this.hud.power(e.k); snd.play('powerup'); } break;
        case 'shieldBreak': if (mine) snd.play('powerdown'); break;
        case 'spatula': if (e.k === 'take') { snd.play('bawk'); this.hud.banner(`${e.team === 1 ? 'BLUE' : 'RED'} TEAM HAS THE SPATULA!`, 2); } else if (e.k === 'drop') snd.play('drop'); break;
        case 'score': snd.play('score'); break;
        case 'roost': if (e.k === 'move') { snd.play('zone'); R.setRoostZone(m.map.roostZones[e.zone]); } else if (e.k === 'score') snd.play('score'); break;
        case 'win': {
          snd.play('win'); this.hud.banner(`${e.team === 1 ? 'BLUE' : 'RED'} TEAM WINS!`, 4);
          if (e.bonus?.includes(s.myId)) { this.profile.coins += 250; this.profile.stats.roostWins++; saveProfile(this.profile); this.hud.toast('+250 Golden Yolks for the win!'); }
          break;
        }
        case 'team': if (mine) this.hud.toast(`You joined the ${e.team === 1 ? 'Blue' : 'Red'} team`); break;
      }
    }
  }
  onMyKill(e, victim) {
    const me = this.session.me;
    this.lifeKills++;
    const yolks = ECONOMY.perKill * ([0, 6].includes(new Date().getDay()) ? ECONOMY.weekendMult : 1) * (me.power.doubleYolks > 0 ? 2 : 1);
    this.profile.coins += yolks;
    const shown = victim && this.settings.safeNames ? 'Egg' + victim.id : victim?.name || '';
    this.hud.confirmKill(shown, me.streak, yolks, this.renderer.avatars.get(e.id)?.color);
    this.marked.delete(e.id);
    const st = this.profile.stats;
    st.kills++; st.bestStreak = Math.max(st.bestStreak, me.streak);
    st.byWeapon[e.w] = (st.byWeapon[e.w] || 0) + 1;
    st.byMode[this.session.match.modeId] = (st.byMode[this.session.match.modeId] || 0) + 1;
    if (this.session.cfg.private) st.privateKills++; else st.publicKills++;
    this.challenge({ k: 'kill', weapon: e.w, streak: me.streak, hp: me.hp, sinceSpawn: this.session.match.tick - this.spawnTick, lifeKills: this.lifeKills });
    // Multi-kills from one grenade/rocket in the same tick.
    if (e.w === 'grenade' || e.w === 'yolkzooka') { this.multi = this.multi?.tick === e.tick ? { tick: e.tick, n: this.multi.n + 1 } : { tick: e.tick, n: 1 }; if (this.multi.n >= 2) this.challenge({ k: 'multi', weapon: e.w, count: this.multi.n }); }
    saveProfile(this.profile);
  }
  onMyDeath(e, killer) {
    const st = this.profile.stats; st.deaths++; st.deathsByWeapon[e.w] = (st.deathsByWeapon[e.w] || 0) + 1; saveProfile(this.profile);
    this.diedAt = performance.now(); this.killer = killer?.id ?? null;
    this.input.enabled = false;
    const s = this.session, me = s.me, by = killer && killer.id !== s.myId;
    const recap = [by ? (this.settings.safeNames ? 'Egg' + killer.id : killer.name) : '', e.w === 'melee' ? 'whisk' : e.w, killer ? killer.hp : 0];
    // The kill-cam runs two seconds of game time (not wall time, so a hitch can't cut it short)...
    this.deadTick = s.match.tick;
    this.state = 'dead';
    // ... or, cracked by someone, the instant replay: their view, the shot in slow motion, the burst.
    this.rec.record(s.match);
    const at = [e.x, e.y + PLAYER.hitCenterY, e.z], w = WEAPONS[e.w];
    const plan = by ? planReplay(this.rec, killer.id, s.match.tick, e.w, w?.vel || 1.5, at) : null;
    if (plan) {
      this.replay = { plan, t: plan.start, impacted: false, after: 0, recap, at: [e.x, e.y, e.z], killer: killer.id, color: this.renderer.avatars.get(s.myId)?.color ?? 0xfff6e5 };
      this.sound.dull(1400, 4);
      return;
    }
    this.hud.died(...recap);
    this.sound.play('death', null, 0.8);
  }
  stat(kind, amount) { if (kind === 'damage') { this.profile.stats.damage += amount; this.challenge({ k: 'damage', amount }); } }
  challenge(ev) {
    for (const d of challengeProgress(this.profile, ev)) { this.hud.toast(`Challenge complete: ${d.title}!`); this.sound.play('challenge'); }
  }

  // ---------------- the frame ----------------
  frame(now) {
    requestAnimationFrame(t => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.t += dt;
    this.fpsN++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsT); this.fpsN = 0; this.fpsT = 0; this.autoDetail(); }
    if (this.state === 'home' || this.state === 'boot') { this.drawHome(dt); return; }
    const s = this.session; if (!s) return;
    const playing = this.state === 'play';
    if (playing && this.input.locked) this.assist(dt); else this.input.assist = 1;
    const input = playing && this.input.locked ? { ctrl: this.input.controls(), yaw: this.input.yaw, pitch: this.input.pitch } : { ctrl: 0, yaw: this.input.yaw, pitch: this.input.pitch };
    s.advance(dt, input);
    this.rec.record(s.match);
    this.handle(s.takeEvents());
    this.drawMatch(dt);
    this.hud.tick(dt);
    if (this.debug && (this.debugT = (this.debugT || 0) - dt) <= 0) {
      this.debugT = 0.25; const b = s.me.body;
      const info = this.renderer.gl.info.render;
      const sl = slotOf(s.me.hands), R = this.renderer;
      $('debug').textContent = `XYZ: ${b.x.toFixed(2)} / ${b.y.toFixed(2)} / ${b.z.toFixed(2)}\nFacing: ${(((this.input.yaw * 180 / Math.PI) % 360 + 360) % 360).toFixed(0)}°\nTick: ${s.match.tick}  Players: ${s.match.players.size}\nFPS: ${this.fps}  Ping: ${s.ping || 0}ms\nAmmo: ${sl.mag}/${sl.store}  Assist: ${this.input.assist < 1 ? 'on target' : '-'}\nGraphics: ${R.q.name} @ ${Math.round(R.resolution * 100)}%  GPU tier ${R.tier}\nDraws: ${R.calls}  Tris: ${Math.round(R.tris / 1000)}k`;
    }
    if (this.state === 'dead' && s.match.tick - this.deadTick >= 2 * TICK_HZ && !this.replay) { this.state = 'respawn'; this.input.exitLock(); show('respawn'); this.menus.refreshRespawn(); }
    if (this.state === 'respawn') this.menus.tickRespawn();
  }
  // One frame of the instant replay: the eggs as they were, the camera over the killer's shoulder,
  // then riding the projectile in, then circling the burst. Click or press a key to skip it.
  replayFrame(dt) {
    const r = this.replay, P = r.plan, R = this.renderer, s = this.session, cam = this.cam, rec = this.rec;
    r.t += dt * 30 * replayRate(P, r.t);
    const t = Math.min(r.t, P.end);
    // Eggs at their recorded poses (ours too, until it bursts).
    for (const [id, a] of R.avatars) {
      const q = rec.pose(id, Math.min(t, P.deathTick - 0.01));
      const show = q && (id !== s.myId || !r.impacted);
      a.group.visible = !!show;
      if (show) { a.lod(Math.hypot(q[0] - cam.x, q[1] - cam.y, q[2] - cam.z)); a.pose(q[0], q[1], q[2], q[3], q[4], { scale: q[6] }); }
    }
    const k = rec.pose(r.killer, Math.min(t, P.shotTick ?? P.deathTick)) || r.lastKiller;
    if (k) r.lastKiller = k;
    const me = rec.pose(s.myId, Math.min(t, P.deathTick - 0.01)) || [r.at[0], r.at[1], r.at[2], 0, 0, 1, 1];
    const bullet = projectileAt(P, t), b = R.replayBullet;
    b.visible = !!bullet;
    const lookAt = (x, y, z) => { cam.yaw = Math.atan2(-(x - cam.x), -(z - cam.z)); cam.pitch = Math.atan2(y - cam.y, Math.hypot(x - cam.x, z - cam.z)); };
    // Put the camera at (x, y, z) as seen from anchor a, pulled in front of any wall in between.
    const place = (a, x, y, z) => {
      const dx = x - a[0], dy = y - a[1], dz = z - a[2], d = Math.hypot(dx, dy, dz) || 1;
      const t = s.match.grid.raycast(a[0], a[1], a[2], dx / d, dy / d, dz / d, d, HIT) ? Math.max(0.1, HIT.t - 0.2) : d;
      cam.x = a[0] + dx / d * t; cam.y = a[1] + dy / d * t; cam.z = a[2] + dz / d * t;
    };
    if (bullet) {
      // Riding the shot: just behind and above it, looking down its path.
      const d = P.dir, side = [-d[2], 0, d[0]];
      place(bullet, bullet[0] - d[0] * 0.9 + side[0] * 0.15, bullet[1] - d[1] * 0.9 + 0.2, bullet[2] - d[2] * 0.9 + side[2] * 0.15);
      lookAt(bullet[0] + d[0] * 3, bullet[1] + d[1] * 3, bullet[2] + d[2] * 3);
      b.position.set(...bullet); b.lookAt(bullet[0] + d[0], bullet[1] + d[1], bullet[2] + d[2]);
      if (Math.random() < 0.8) R.fx.soft.emit(bullet[0], bullet[1], bullet[2], 0, 0.05, 0, { size: 0.03, grow: 0.12, life: 0.5, color: 0xfff1c8, alpha: 0.35, drag: 2 });
      cam.fovMul = 0.9;
    } else if (!r.impacted && k) {
      // Over the killer's shoulder, watching us.
      const f = [-Math.sin(k[3]), 0, -Math.cos(k[3])], right = [-f[2], 0, f[0]];
      place([k[0], k[1] + 0.7, k[2]], k[0] - f[0] * 1.5 + right[0] * 0.45, k[1] + 0.95, k[2] - f[2] * 1.5 + right[2] * 0.45);
      lookAt(me[0], me[1] + 0.35, me[2]);
      cam.fovMul = 0.85;
    } else {
      // The burst: circling slowly where we stood.
      if (r.orbit === undefined) {
        // Start the orbit from the most open side.
        let best = -1; const g = s.match.grid;
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, d = g.raycast(r.at[0], r.at[1] + 0.5, r.at[2], Math.sin(a) * 0.92, 0.23, Math.cos(a) * 0.92, 3, HIT) ? HIT.t : 3; if (d > best) { best = d; r.orbit = a; } }
      }
      r.orbit += dt * 0.5;
      place([r.at[0], r.at[1] + 0.5, r.at[2]], r.at[0] + Math.sin(r.orbit) * 2.6, r.at[1] + 1.1, r.at[2] + Math.cos(r.orbit) * 2.6);
      lookAt(r.at[0], r.at[1] + 0.3, r.at[2]);
      cam.fovMul = 0.9;
    }
    // (Nothing of the killer's own egg in front of the lens while we ride their shot out.)
    const ka = R.avatars.get(r.killer);
    if (ka && k && Math.hypot(cam.x - k[0], cam.y - k[1] - 0.35, cam.z - k[2]) < 1.1) ka.group.visible = false;
    if (!r.impacted && t >= P.hitTick) {
      r.impacted = true;
      const g = s.match.grid, fl = g.floorBelow(r.at[0], r.at[1] + 0.3, r.at[2]);
      R.fx.shatter(r.at[0], r.at[1], r.at[2], r.color, fl === -Infinity ? r.at[1] : fl);
      this.sound.play('crackBig', null, 1); this.sound.play('splat', null, 0.9); this.sound.play('death', null, 0.8);
      this.hud.died(...r.recap); this.shake = Math.min(1.2, this.shake + 0.8);
    }
    if (r.impacted) r.after += dt;
    if ((r.impacted && r.after > 2.2) || r.skip) { b.visible = false; this.replay = null; }
    this.hud.replay = this.replay ? { slow: replayRate(P, t) < 1 } : null;
  }
  // Aim assist (aim.js): friction on the look speed and a little tracking, on a visible enemy near the
  // crosshair, for trackpads and gamepads.
  assist(dt) {
    const s = this.session, m = s.match, me = s.me, inp = this.input;
    if (!me.alive || !assistOn(this.settings.aimAssist || 'auto', navigator.userAgent, performance.now() - inp.padAt < 5000)) { inp.assist = 1; return; }
    const P = [0, 0, 0]; s.lerpPos(me, P);
    const E = eyePoint({ x: P[0], y: P[1], z: P[2], yaw: inp.yaw, pitch: inp.pitch }), cam = { x: E[0], y: E[1], z: E[2], yaw: inp.yaw, pitch: inp.pitch };
    const targets = [];
    for (const p of m.players.values()) {
      if (p.id === s.myId || !p.alive || (m.mode.teams && p.team === me.team) || p.spawnShield > 0) continue;
      const T = [0, 0, 0]; s.lerpPos(p, T); T[1] += PLAYER.hitCenterY;
      targets.push({ id: p.id, x: T[0], y: T[1], z: T[2], visible: () => m.grid.visible(cam.x, cam.y, cam.z, T[0], T[1], T[2]) });
    }
    const moving = inp.held('up') || inp.held('down') || inp.held('left') || inp.held('right') || inp.held('fire');
    const r = aimAssist(this.aim, cam, targets, dt, { ads: me.hands.ads, active: moving || performance.now() - inp.lookAt < 150, gun: slotOf(me.hands).id });
    inp.assist = r.slow; inp.yaw += r.dyaw; inp.pitch = Math.max(-1.5, Math.min(1.5, inp.pitch + r.dpitch));
  }
  // (Only in a match: the menus are cheap to draw and would talk Auto Detail into rungs a fight can't hold.)
  autoDetail() { if (globalThis.document.visibilityState !== 'hidden' && (this.state === 'play' || this.state === 'dead')) this.renderer.adapt(this.fps); }
  drawHome(dt) {
    const h = this.home; if (!h) return;
    // Idle: the egg faces you three-quarters on (gun in view) and sways gently, as if breathing.
    h.spin += dt;
    if (h.egg) {
      // Picking a new gun: the egg hops and catches it.
      if (h.egg.weaponId !== this.profile.primary) { h.egg.setWeapon(this.profile.primary); h.hop = 0; }
      let y = 0, vy = 0;
      if (h.hop >= 0) { h.hop += dt; const f = h.hop / 0.42; if (f >= 1) h.hop = -1; else { y = Math.sin(f * Math.PI) * 0.16; vy = Math.cos(f * Math.PI) * 4; } }
      h.egg.pose(0, y, 0, Math.PI + 0.5 + Math.sin(h.spin * 0.45) * 0.35 + (h.hop >= 0 ? h.hop / 0.42 * Math.PI * 2 : 0), Math.sin(h.spin * 0.7) * 0.06, { bob: this.t * 2, vy });
    }
    h.ped.rotation.y = h.spin * 0.1;
    const p = h.motes.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { let yy = p.getY(i) + dt * (0.05 + h.seed[i] * 0.08); if (yy > 1.6) yy = -0.3; p.setY(i, yy); p.setX(i, p.getX(i) + Math.sin(this.t * 0.6 + h.seed[i] * 9) * dt * 0.03); }
    p.needsUpdate = true;
    h.camera.aspect = innerWidth / innerHeight; h.camera.updateProjectionMatrix();
    this.renderer.renderScene(h.scene, h.camera, this.t);
  }
  drawMatch(dt) {
    const s = this.session, m = s.match, me = s.me, R = this.renderer;
    const P = [0, 0, 0], cam = this.cam, blobs = this.blobList || (this.blobList = []);
    blobs.length = 0;
    // Eggs: detail by distance from the camera, and a soft shadow on the floor beneath each.
    for (const p of m.players.values()) {
      const a = R.avatar(p.id, { name: this.settings.safeNames && p.id !== s.myId ? 'Egg' + p.id : p.name, look: p.cosmetics, team: p.team, weapon: slotOf(p.hands).id, friendly: m.mode.teams && p.team === me.team && p.id !== s.myId, local: p.id === s.myId });
      const visible = p.alive && (p.id !== s.myId || this.state === 'dead' || this.state === 'respawn');
      a.group.visible = visible && p.id !== s.myId;
      if (!a.group.visible) continue;
      s.lerpPos(p, P);
      a.lod(Math.hypot(P[0] - cam.x, P[1] - cam.y, P[2] - cam.z));
      const fl = m.grid.floorBelow(P[0], P[1] + 0.3, P[2]);
      if (fl > -Infinity && P[1] - fl < 3) { const k = p.power.quailEgg > 0 ? 0.5 : 1, hgt = P[1] - fl; blobs.push([P[0], fl, P[2], 0.62 * k * (1 + hgt * 0.15), Math.max(0.2, 1 - hgt / 3)]); }
      a.setWeapon(slotOf(p.hands).id); a.setHp(p.hp);
      a.pose(P[0], P[1], P[2], p.body.yaw, p.body.pitch, { scale: p.power.quailEgg > 0 ? 0.5 : 1, shield: p.shield > 0 || p.spawnShield > 0, breaker: p.power.shellBreaker > 0, bob: this.t * 10 * Math.min(1, Math.hypot(p.body.vx, p.body.vz) * 25), vx: p.body.vx * 30, vy: p.body.onGround > 0 ? 0 : p.body.vy * 30, vz: p.body.vz * 30 });
    }
    for (const id of [...R.avatars.keys()]) if (!m.players.has(id)) R.dropAvatar(id);
    R.setBlobs(blobs);
    // Footsteps: one per stride of ground travel, for everyone (they give positions away, as they should).
    for (const p of m.players.values()) {
      if (!p.alive || p.body.onGround <= 0 || p.body.climbing) continue;
      const v = Math.hypot(p.body.vx, p.body.vz);
      if (v < 0.02) continue;
      this.strides ??= new Map();
      const d = (this.strides.get(p.id) || 0) + v * 30 * dt;
      if (d > 1.15) {
        this.strides.set(p.id, 0);
        // What's underfoot changes the step: soft on grass and sand, hollow on wood, ringing on metal.
        const g = m.grid, cx = Math.floor(p.body.x), cy = Math.floor(p.body.y - 0.05), cz = Math.floor(p.body.z);
        const mat = g.inside(cx, cy, cz) && g.cells[g.index(cx, cy, cz)] ? g.tint[g.index(cx, cy, cz)] : 0;
        const [rate, gain] = STEP_SOUND[mat] || STEP_SOUND[0];
        this.sound.play('step', p.id === s.myId ? null : [p.body.x, p.body.y, p.body.z], (p.id === s.myId ? 0.35 : 0.6) * gain, rate);
      }
      else this.strides.set(p.id, d);
    }
    // Pickups, rockets, grenades, spatula, roost.
    m.items.forEach((it, i) => R.setItem(i, it.active, this.t));
    for (const r of m.rockets) { R.fx.rocket(r.id, r.x, r.y, r.z, r.dx, r.dy, r.dz); this.sound.loop('r' + r.id, 'rocket', [r.x, r.y, r.z]); }
    for (const g of m.grenades) { R.fx.grenade(g.id, g.x, g.y, g.z, g.fuse, g.team); this.sound.loop('g' + g.id, 'cluck', [g.x, g.y, g.z]); }
    R.fx.sweep(); this.sound.sweepLoops();
    const st = m.mode.state();
    if (st.k === 'spatula') {
      const sp = m.mode.spat; R.spatula.visible = true; R.spatula.position.set(sp.x, sp.y, sp.z);
      const c = m.players.get(sp.carrier); R.spatula.rotation.y = c ? c.body.yaw : this.t;
    } else if (R.spatula) R.spatula.visible = false;
    if (st.k === 'roost') {
      if (R.roostZone !== m.map.roostZones[st.z]) R.setRoostZone(m.map.roostZones[st.z]);
      R.setRoostColor(st.o, st.st === 'contested', this.t);
      this.hud.capturers = 0;
    }
    // Camera: first person while alive; the instant replay after being cracked; an orbit over the map
    // while dead or on the respawn screen.
    if (this.replay && this.state === 'dead') this.replayFrame(dt);
    else if (me.alive && this.state === 'play') {
      s.lerpPos(me, P);
      // The eye pivots on the head like the reference's (it is also where shots leave from).
      cam.yaw = this.input.yaw; cam.pitch = this.input.pitch;
      const E = eyePoint({ x: P[0], y: P[1], z: P[2], yaw: cam.yaw, pitch: cam.pitch });
      cam.x = E[0]; cam.y = E[1] + (me.power.quailEgg > 0 ? -0.15 : 0); cam.z = E[2];
      const w = weaponOf(me.hands);
      cam.fovMul = me.hands.ads ? w.scope : 1;
      this.input.zoom = me.hands.ads ? w.scope : 1;
    } else if (this.state === 'dead' && this.killer !== null && m.players.get(this.killer)?.alive) {
      // Watch whoever cracked us.
      const k = m.players.get(this.killer);
      cam.yaw = Math.atan2(-(k.body.x - cam.x), -(k.body.z - cam.z)); cam.pitch = Math.atan2(k.body.y - cam.y, Math.hypot(k.body.x - cam.x, k.body.z - cam.z));
      cam.fovMul = 0.8;
    } else {
      const o = m.map.overview, a = this.t * 0.08;
      cam.x = o.cx + Math.cos(a) * o.r; cam.z = o.cz + Math.sin(a) * o.r; cam.y = o.cy + o.r * 0.55;
      cam.yaw = Math.atan2(-(o.cx - cam.x), -(o.cz - cam.z)); cam.pitch = -Math.atan2(cam.y - o.cy, o.r); cam.fovMul = 1;
    }
    // Zoom eases in and out rather than snapping.
    this.fovMul += (cam.fovMul - this.fovMul) * Math.min(1, dt * 14);
    this.kick = Math.max(0, (this.kick || 0) - dt * 9);
    cam.fovMul = this.fovMul * (1 + this.kick * this.kick * 0.035 + (R.view.sprintBlend || 0) * 0.06);
    // Recoil kicks the view up a touch and recovers (the setting turns the shake off, not the punch).
    const punch = R.view.takePunch(dt);
    cam.pitch += punch[0]; cam.yaw += punch[1];
    // Strafing leans the view a hair, and recoil and landings can roll it.
    const yawNow = this.input.yaw, strafe = me.alive && this.state === 'play' ? (me.body.vx * Math.cos(yawNow) - me.body.vz * Math.sin(yawNow)) * 30 : 0;
    this.lean += (-strafe * 0.0035 - this.lean) * Math.min(1, dt * 8);
    cam.roll = this.lean + punch[2];
    this.shake = Math.max(0, this.shake - dt * 4);
    const sk = this.shake * this.shake;
    cam.shakeX = (Math.random() - 0.5) * sk * 0.03; cam.shakeY = (Math.random() - 0.5) * sk * 0.03;
    this.sound.listener(cam.x, cam.y, cam.z, cam.yaw);
    // Hands.
    const h = me.hands, w = weaponOf(h), [mdx, mdy] = this.input.takeMouse();
    R.view.setWeapon(slotOf(h).id, this.profile.equip.skin);
    if (this.input.inspectPressed) { this.input.inspectPressed = false; if (h.reload === 0 && h.swap === 0) h.inspect = 45; }
    const rel = h.reload > 0 ? { f: 1 - h.reload / (h.reloadRounds && slotOf(h).mag === 0 ? w.reload[1] : w.reload[0]), long: w.reload[1] !== w.reload[0] && slotOf(h).mag === 0 } : null;
    // Reload steps you can hear: the magazine out and in, the bolt, the slide, the barrels.
    if (rel && me.alive) { for (const [at, name, longOnly] of RELOAD_STEPS[RELOAD_KIND[slotOf(h).id]] || []) if ((this.lastRf ?? 1) < at && rel.f >= at && (!longOnly || rel.long)) this.sound.play(name, null, 0.9); this.lastRf = rel.f; }
    else this.lastRf = 0;
    R.view.update({
      dt, visible: me.alive && this.state === 'play', speed: Math.hypot(me.body.vx, me.body.vz) * 30, strafe, vy: me.body.vy * 30, air: me.body.onGround === 0, climbing: !!me.body.climbing,
      ads: h.ads, scoped: w.scoped, mouseDX: mdx, mouseDY: mdy,
      reload: rel,
      swap: h.swap > 0 ? 1 - h.swap / 26 : 0, melee: h.melee > 0 ? 1 - h.melee / 17 : 0, charge: h.charging ? h.power : null,
      inspect: h.inspect > 0 ? 1 - h.inspect / 45 : 0, shield: me.spawnShield > 0, empty: slotOf(h).mag === 0,
      sprint: !!(me.body.prevCtrl & CTRL.sprint) && Math.hypot(me.body.vx, me.body.vz) * 30 > 1.45 && !h.ads,
    });
    this.fallSpeed = Math.max(0, -me.body.vy * 30);
    // Low on health: the heart pounds.
    if (me.alive && this.state === 'play' && me.hp < 35 && !(me.shield > 0)) { if ((this.beatT -= dt) <= 0) { this.beatT = 0.55 + me.hp / 35 * 0.4; this.sound.play('heartbeat', null, 0.5 + (35 - me.hp) / 70); } }
    else this.beatT = 0;
    // A hot barrel smokes for a moment after a burst.
    if (this.heat > 0) {
      this.heat = Math.max(0, this.heat - dt * 1.4);
      if (this.heat > 0.5 && me.alive && !h.ads && Math.random() < dt * 14) {
        const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
        R.fx.wisp(cam.x - sy * 0.75 + cy * 0.14, cam.y - 0.13, cam.z - cy * 0.75 - sy * 0.14);
      }
    }
    // Post: the hurt flash fades, low health desaturates and pulses.
    this.hurt = Math.max(0, (this.hurt || 0) - dt * 1.6);
    const low = me.alive && this.state === 'play' ? Math.max(0, (35 - me.hp) / 35) : 0;
    this.lowHp = (this.lowHp || 0) + (low - (this.lowHp || 0)) * Math.min(1, dt * 3);
    const pulse = this.lowHp > 0.01 ? (0.5 + 0.5 * Math.sin(this.t * 6.5)) * 0.35 * this.lowHp : 0;
    // HUD (drawn first so the frame can lay it over the image): projected with this frame's camera.
    R.place(cam);
    const ranked = m.standings();
    this.hud.leaderboard(ranked, s.myId, m.mode.teams);
    this.hud.stats(me, this.profile.coins, this.fps, s.ping || 0);
    this.hud.objective(st, m.mode.teams);
    const markers = [], V3 = this.v3 || (this.v3 = new THREE.Vector3());
    const project = (x, y, z) => { const v = V3.set(x, y, z).project(R.camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, behind: v.z > 1 }; };
    if (st.k === 'roost' && R.roostZone) markers.push({ screen: project(R.roostZone.cx, R.roostZone.y0 + 2.6, R.roostZone.cz), color: '#ffc531', label: Math.round(Math.hypot(R.roostZone.cx - me.body.x, R.roostZone.cz - me.body.z)) + 'u' });
    if (st.k === 'spatula' && st.c >= 0 && st.c !== s.myId) { const c = m.players.get(st.c); if (c) markers.push({ screen: project(c.body.x, c.body.y + 1.1, c.body.z), color: c.team === 1 ? '#4aa3ff' : '#ff6a5c', label: 'SPATULA' }); }
    // Distance to whatever the crosshair is on (the Yolkzooka reticle turns red inside arming range),
    // and whether that's an egg (the crosshair turns red on an enemy, blue on a teammate).
    const f = [-Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch)];
    const wallT = m.grid.raycast(cam.x, cam.y, cam.z, f[0], f[1], f[2], 60, HIT) ? HIT.t : 99;
    const aimDist = Math.min(wallT, 99) > 10 ? 99 : wallT;
    let enemy = 0, near = 99;
    const bars = [];
    for (const p of m.players.values()) {
      if (p.id === s.myId || !p.alive) continue;
      s.lerpPos(p, P);
      const cx = P[0] - cam.x, cy = P[1] + PLAYER.hitCenterY - cam.y, cz = P[2] - cam.z, t = cx * f[0] + cy * f[1] + cz * f[2];
      const r = PLAYER.hitRadius * (p.power.quailEgg > 0 ? 0.5 : 1);
      if (t > 0 && t < near && t < wallT && cx * cx + cy * cy + cz * cz - t * t < r * r) { near = t; enemy = m.mode.teams && p.team === me.team ? 2 : 1; }
      // Health over the eggs we've hurt lately, while they're in sight.
      const at = this.marked.get(p.id);
      if (at !== undefined) {
        const age = this.t - at, d = Math.hypot(cx, cy, cz);
        if (age > 4 || p.hp >= 100) { this.marked.delete(p.id); continue; }
        if (d < 45 && m.grid.visible(cam.x, cam.y, cam.z, P[0], P[1] + 0.5, P[2])) bars.push({ id: p.id, x: P[0], y: P[1] + 0.82 * (p.power.quailEgg > 0 ? 0.5 : 1), z: P[2], hp: p.hp, shield: p.shield, dist: d, fade: Math.min(1, (4 - age) * 2) });
      }
    }
    const rl = me.hands.reload > 0 ? 1 - me.hands.reload / (me.hands.reloadWasLong ? w.reload[1] : w.reload[0]) : 0;
    const playing = this.state === 'play';
    this.hud.draw(dt, { me: playing ? me : null, yaw: cam.yaw, pitch: cam.pitch, speed: Math.hypot(me.body.vx, me.body.vz) * 30, air: me.body.onGround <= 0, fov: R.camera.fov, markers, aimDist, reload: rl, project, bars, enemy });
    R.render(cam, dt, this.t, { hurt: Math.min(0.7, this.hurt * 0.6 + pulse), lowHp: this.lowHp * 0.8, aberration: this.hurt * 0.035 + (this.shake > 0.6 ? (this.shake - 0.6) * 0.02 : 0) }, playing || this.state === 'dead' ? this.hud : null);
  }
}

const app = new App();
registerApp(app);

