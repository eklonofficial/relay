// Shock Shellers: boot, menus, the match flow (home → respawn screen → play → death → respawn) and
// the frame loop. The simulation runs at a fixed 30 Hz inside the session; rendering interpolates.
import './page.js?v=muvjbwwq';
import { surfaceDocument as document } from './surface.js?v=muvjbwwq';
import { registerApp } from './veil.js?v=muvjbwwq';
import { tell } from './dialog.js?v=muvjbwwq';
import { splash } from './splash.js?v=muvjbwwq';
import * as THREE from '../vendor/three/three.module.js?v=muvjbwwq';
import { Renderer } from './render/renderer.js?v=muvjbwwq';
import { EggAvatar, SHELL_COLORS, TEAM_COLORS } from './render/egg.js?v=muvjbwwq';
import { gunModel } from './render/guns.js?v=muvjbwwq';
import { Input } from './game/input.js?v=muvjbwwq';
import { SOUND_FILES } from './game/soundbank.js?v=muvjbwwq';
import { Sound, registerSamples } from './game/audio.js?v=muvjbwwq';
import { Hud } from './game/hud.js?v=muvjbwwq';
import { loadSettings, saveSettings, loadProfile, saveProfile } from './game/store.js?v=muvjbwwq';
import { ensureDaily, progress as challengeProgress, claim as claimChallenges } from './game/challenges.js?v=muvjbwwq';
import { HostSession } from './game/session.js?v=muvjbwwq';
import { GuestSession } from './net/guest.js?v=muvjbwwq';
import { pickPublicMap, mapDef, MAPS } from './maps/index.js?v=muvjbwwq';
import { WEAPONS, PRIMARIES, PLAYER, MODE_NAMES, MODE_MENU, ECONOMY, CTRL, TICK } from './sim/tuning.js?v=muvjbwwq';
import { weaponOf, slotOf } from './sim/combat.js?v=muvjbwwq';
import { drawLogo, drawHowTo } from './ui/art.js?v=muvjbwwq';
import { loadModels } from './render/models.js?v=muvjbwwq';
import { HIT } from './maps/grid.js?v=muvjbwwq';
import { Menus } from './ui/menus.js?v=muvjbwwq';

const $ = id => document.getElementById(id);
const show = (id, on = true) => { $(id).classList.toggle('hidden', !on); if (id === 'respawn') $('hud').classList.toggle('menu', on); };
const LOAD_LINES = ['Cracking eggs…', 'Whisking servers…', 'Stacking teams…', 'Greasing the pan…', 'Counting chickens…', 'Hatching plans…'];

class App {
  constructor() {
    this.settings = loadSettings();
    this.profile = loadProfile();
    ensureDaily(this.profile);
    this.canvas = $('game');
    this.renderer = new Renderer(this.canvas);
    this.renderer.baseFov = this.settings.fov;
    this.input = new Input(this.canvas, this.settings);
    this.keys = this.input.keys; // veil.js clears these on quick-hide
    registerSamples(SOUND_FILES);
    this.sound = new Sound(this.settings);
    this.hud = new Hud(this.settings);
    this.menus = new Menus(this);
    this.session = null; this.state = 'boot';
    this.t = 0; this.last = performance.now(); this.fps = 60; this.fpsN = 0; this.fpsT = 0; this.lowFps = 0;
    this.shake = 0; this.cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fovMul: 1 };
    this.lifeKills = 0; this.spawnTick = 0;
    this.resize(); addEventListener('resize', () => this.resize());
    this.boot();
  }
  resize() {
    const u = Math.max(0.55, Math.min(1.4, Math.min(innerWidth / 1500, innerHeight / 860)));
    document.documentElement.style.setProperty('--u', u + 'px');
    this.renderer.resize(); this.hud.resize();
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
    // The menu's sky gradient as the background.
    const bg = new OffscreenCanvas(4, 256), bx = bg.getContext('2d'), grad = bx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#2290b5'); grad.addColorStop(1, '#a6dcef'); bx.fillStyle = grad; bx.fillRect(0, 0, 4, 256);
    s.background = new THREE.CanvasTexture(bg); s.background.colorSpace = THREE.SRGBColorSpace;
    s.add(new THREE.HemisphereLight(0xffffff, 0x88aabb, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(-2, 4, 3); s.add(sun);
    const rim = new THREE.DirectionalLight(0xfff1d6, 1.6); rim.position.set(2.5, 2, -3); s.add(rim);   // a warm rim from behind
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0e3440, transparent: true, opacity: 0.25, depthWrite: false }));
    shadow.position.y = 0.002; s.add(shadow);
    this.home = { scene: s, camera: new THREE.PerspectiveCamera(28, 1, 0.1, 50), egg: null, spin: 0 };
    this.home.camera.position.set(0, 0.62, 4.2); this.home.camera.lookAt(0, 0.12, 0);
    this.refreshHomeEgg();
  }
  refreshHomeEgg() {
    const h = this.home; if (!h) return;
    if (h.egg) h.scene.remove(h.egg.group);
    const e = this.profile.equip;
    h.egg = new EggAvatar({ name: '', color: e.color, hat: e.hat, weapon: this.profile.primary, local: true });
    h.egg.group.scale.setScalar(1.15);
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
    this.startMatch({ map: pickPublicMap(mode), mode, options: {}, bots: undefined, difficulty: 'public', private: false });
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
    // Every match is a room friends can join (they take a bot's place).
    session.openRoom().then(code => {
      if (this.session !== session) { session.close(); return; }
      this.hud.chat(`Room code ${code}: click 👥 to copy it for friends!`, '#ffd23f');
      this.menus.refreshRespawn();
    }, e => { if (this.session === session) this.hud.chat('Playing offline: ' + e.message, '#ff8a80'); });
    this.profile.stats.games++; saveProfile(this.profile);
  }
  // Show a session (hosted or joined): load its map and go to the respawn screen.
  enter(session) {
    this.session = session;
    session.onChat = (text, color) => this.hud.chat(text, color);
    session.onDisconnected = reason => { if (this.session === session) { this.goHome(); tell(reason); } };
    this.renderer.loadMap(session.map);
    this.state = 'respawn'; this.diedAt = 0; this.killer = null;
    this.lifeKills = 0;
    show('home', false); show('hud'); show('respawn');
    this.menus.refreshRespawn();
  }
  async joinRoom(code, status) {
    this.sound.unlock();
    const p = this.profile;
    const session = await GuestSession.join(code, { name: p.name, primary: p.primary, cosmetics: { ...p.equip } }, status);
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
          const p = m.players.get(e.id);
          if (p) {
            const a = R.avatars.get(e.id);
            // The streak starts at the visible muzzle: the viewmodel's for us, the avatar's gun for others.
            fx.streak(e.x, e.y - (mine ? 0.06 : 0), e.z, e.dx, e.dy, e.dz, e.len, WEAPONS[e.w].vel, e.tracer);
            if (!mine && a) { const mz = a.gun.localToWorld(a.gun.userData.muzzle.clone()); fx.muzzle(mz.x, mz.y, mz.z, e.w === 'doubleYolker'); }
          }
          break;
        }
        case 'fire': {
          const w = e.w;
          snd.play(w, mine ? null : pos(e.id), mine ? 0.7 : 1);
          if (mine) {
            R.view.fire(w);
            if (this.settings.shake) this.shake = Math.min(1, this.shake + WEAPONS[w].recoil / 60);
          }
          break;
        }
        case 'impact': fx.impact(e.x, e.y, e.z, e.nx, e.ny, e.nz); break;
        case 'hit': {
          const v = m.players.get(e.id);
          fx.hitSplash(e.x, e.y, e.z, e.dx, e.dy, e.dz);
          snd.play(e.hp <= 0 ? 'crackBig' : 'crack', [e.x, e.y, e.z], 0.9);
          if (e.by === s.myId && e.id !== s.myId) { this.hud.hit(e.hp <= 0); this.stat('damage', e.dmg); }
          if (e.id === s.myId) {
            const src = m.players.get(e.by);
            if (src) this.hud.damageFrom(Math.atan2(-(src.body.x - me.body.x), -(src.body.z - me.body.z)));
            else this.hud.damageFrom(this.cam.yaw);
          }
          if (v) R.avatars.get(e.id)?.setHp(e.hp);
          break;
        }
        case 'kill': {
          const v = m.players.get(e.id), k = m.players.get(e.by);
          const a = R.avatars.get(e.id);
          fx.shatter(e.x, e.y, e.z, a ? a.color : 0xfff6e5, m.grid.floorBelow(e.x, e.y + 0.3, e.z) === -Infinity ? e.y : m.grid.floorBelow(e.x, e.y + 0.3, e.z));
          snd.play('splat', [e.x, e.y + 0.3, e.z]);
          if (v) this.hud.kill(k ? k.name : '', v.name, e.w, k?.team || 0, v.team);
          if (e.by === s.myId && e.id !== s.myId) this.onMyKill(e, v);
          if (e.id === s.myId) this.onMyDeath(e, k);
          break;
        }
        case 'spawn': if (mine) this.input.yaw = me.body.yaw; break;
        case 'reload': snd.play('reload', mine ? null : pos(e.id), 0.8); break;
        case 'reloaded': snd.play(e.long ? 'reloadedLong' : 'reloaded', mine ? null : pos(e.id), 0.8); break;
        case 'dry': if (mine) snd.play('dry'); break;
        case 'swap': if (mine) snd.play('swap'); break;
        case 'swing': snd.play('melee', mine ? null : pos(e.id)); break;
        case 'throw': snd.play('throw', mine ? null : pos(e.id)); break;
        case 'bounce': snd.play('bounce', [e.x, e.y, e.z], 0.6); break;
        case 'rocket': snd.play('yolkzooka', mine ? null : [e.x, e.y, e.z]); break;
        case 'boom': {
          fx.explosion(e.x, e.y, e.z, e.r, e.w, e.team); snd.play('explode', [e.x, e.y, e.z], 1.2); if (e.w === 'grenade') snd.play('squawk', [e.x, e.y + 0.3, e.z], 0.8);
          const d = Math.hypot(e.x - me.body.x, e.y - me.body.y, e.z - me.body.z);
          if (this.settings.shake && d < e.r * 1.5 * 3) this.shake = Math.min(1.5, this.shake + (1 - d / (e.r * 4.5)) * 1.2);
          break;
        }
        case 'dud': fx.dud(e.x, e.y, e.z); snd.play('dud', [e.x, e.y, e.z]); break;
        case 'collect': snd.play(e.kind === 'ammo' ? 'ammo' : 'pickupNade', mine ? null : pos(e.id)); break;
        case 'land': if (mine) snd.play('land', null, 0.5); break;
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
    setTimeout(() => { if (this.state === 'play' || this.state === 'dead') { this.state = 'respawn'; this.input.exitLock(); show('respawn'); this.menus.refreshRespawn(); } }, 1600);
    this.state = 'dead';
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
    const input = playing && this.input.locked ? { ctrl: this.input.controls(), yaw: this.input.yaw, pitch: this.input.pitch } : { ctrl: 0, yaw: this.input.yaw, pitch: this.input.pitch };
    s.advance(dt, input);
    this.handle(s.takeEvents());
    this.drawMatch(dt);
    this.hud.tick(dt);
    if (this.debug && (this.debugT = (this.debugT || 0) - dt) <= 0) {
      this.debugT = 0.25; const b = s.me.body;
      $('debug').textContent = `XYZ: ${b.x.toFixed(2)} / ${b.y.toFixed(2)} / ${b.z.toFixed(2)}\nFacing: ${(((this.input.yaw * 180 / Math.PI) % 360 + 360) % 360).toFixed(0)}°\nTick: ${s.match.tick}  Players: ${s.match.players.size}\nFPS: ${this.fps}  Ping: ${s.ping || 0}ms`;
    }
    if (this.state === 'respawn') this.menus.tickRespawn();
  }
  autoDetail() {
    if (!this.settings.autoDetail) return;
    const r = this.renderer;
    if (this.fps < 45) { if (++this.lowFps >= 4) { this.lowFps = 0; r.setDetail(r.detail >= 1 ? 0.5 : 0); } }
    else if (this.fps > 58 && r.detail < 1) { if (--this.lowFps <= -10) { this.lowFps = 0; r.setDetail(r.detail === 0 ? 0.5 : 1); } }
    else this.lowFps = 0;
  }
  drawHome(dt) {
    const h = this.home; if (!h) return;
    // Idle: the egg faces you three-quarters on (gun in view) and sways gently, as if breathing.
    h.spin += dt;
    if (h.egg) { h.egg.pose(0, 0, 0, Math.PI + 0.5 + Math.sin(h.spin * 0.45) * 0.35, Math.sin(h.spin * 0.7) * 0.06, { bob: this.t * 2 }); h.egg.setWeapon(this.profile.primary); }
    const gl = this.renderer.gl;
    h.camera.aspect = innerWidth / innerHeight; h.camera.updateProjectionMatrix();
    gl.setClearColor(0x000000, 1); gl.clear(); gl.render(h.scene, h.camera);
  }
  drawMatch(dt) {
    const s = this.session, m = s.match, me = s.me, R = this.renderer;
    const P = [0, 0, 0];
    // Eggs.
    for (const p of m.players.values()) {
      const a = R.avatar(p.id, { name: this.settings.safeNames && p.id !== s.myId ? 'Egg' + p.id : p.name, color: p.cosmetics?.color || 0, hat: p.cosmetics?.hat || 'none', team: p.team, weapon: slotOf(p.hands).id, friendly: m.mode.teams && p.team === me.team && p.id !== s.myId, local: p.id === s.myId });
      const visible = p.alive && (p.id !== s.myId || this.state === 'dead' || this.state === 'respawn');
      a.group.visible = visible && p.id !== s.myId;
      if (!a.group.visible) continue;
      s.lerpPos(p, P);
      a.setWeapon(slotOf(p.hands).id); a.setHp(p.hp);
      a.pose(P[0], P[1], P[2], p.body.yaw, p.body.pitch, { scale: p.power.quailEgg > 0 ? 0.5 : 1, shield: p.shield > 0 || p.spawnShield > 0, breaker: p.power.shellBreaker > 0, bob: this.t * 10 * Math.min(1, Math.hypot(p.body.vx, p.body.vz) * 25) });
    }
    for (const id of [...R.avatars.keys()]) if (!m.players.has(id)) R.dropAvatar(id);
    // Footsteps: one per stride of ground travel, for everyone (they give positions away, as they should).
    for (const p of m.players.values()) {
      if (!p.alive || p.body.onGround <= 0 || p.body.climbing) continue;
      const v = Math.hypot(p.body.vx, p.body.vz);
      if (v < 0.02) continue;
      this.strides ??= new Map();
      const d = (this.strides.get(p.id) || 0) + v * 30 * dt;
      if (d > 1.15) { this.strides.set(p.id, 0); this.sound.play('step', p.id === s.myId ? null : [p.body.x, p.body.y, p.body.z], p.id === s.myId ? 0.35 : 0.6); }
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
    // Camera: first person while alive; an orbit over the map while dead or on the respawn screen.
    const cam = this.cam;
    if (me.alive && this.state === 'play') {
      s.lerpPos(me, P);
      cam.x = P[0]; cam.y = P[1] + PLAYER.eyeY + (me.power.quailEgg > 0 ? -0.15 : 0); cam.z = P[2];
      cam.yaw = this.input.yaw; cam.pitch = this.input.pitch;
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
    // Recoil kicks the view up a touch and recovers (the setting turns the shake off, not the punch).
    cam.pitch += R.view.takePunch(dt);
    this.shake = Math.max(0, this.shake - dt * 4);
    cam.shakeX = (Math.random() - 0.5) * this.shake * 0.02; cam.shakeY = (Math.random() - 0.5) * this.shake * 0.02;
    this.sound.listener(cam.x, cam.y, cam.z, cam.yaw);
    // Hands.
    const h = me.hands, w = weaponOf(h), [mdx, mdy] = this.input.takeMouse();
    R.view.setWeapon(slotOf(h).id);
    if (this.input.inspectPressed) { this.input.inspectPressed = false; if (h.reload === 0 && h.swap === 0) h.inspect = 45; }
    R.view.update({
      dt, visible: me.alive && this.state === 'play', speed: Math.hypot(me.body.vx, me.body.vz) * 30, air: me.body.onGround === 0, climbing: !!me.body.climbing,
      ads: h.ads, scoped: w.scoped, mouseDX: mdx, mouseDY: mdy,
      reload: h.reload > 0 ? { f: 1 - h.reload / (h.reloadRounds && slotOf(h).mag === 0 ? w.reload[1] : w.reload[0]), long: w.reload[1] !== w.reload[0] && slotOf(h).mag === 0 } : null,
      swap: h.swap > 0 ? 1 - h.swap / 26 : 0, melee: h.melee > 0 ? 1 - h.melee / 17 : 0, charge: h.charging ? h.power : null,
      inspect: h.inspect > 0 ? 1 - h.inspect / 45 : 0, shield: me.spawnShield > 0,
    });
    R.render(cam, dt, this.t);
    // HUD.
    const ranked = m.standings();
    this.hud.leaderboard(ranked, s.myId, m.mode.teams);
    this.hud.stats(me, this.profile.coins, this.fps, s.ping || 0);
    this.hud.objective(st, m.mode.teams);
    const markers = [];
    const project = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(R.camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, behind: v.z > 1 }; };
    if (st.k === 'roost' && R.roostZone) markers.push({ screen: project(R.roostZone.cx, R.roostZone.y0 + 2.6, R.roostZone.cz), color: '#ffc531', label: Math.round(Math.hypot(R.roostZone.cx - me.body.x, R.roostZone.cz - me.body.z)) + 'u' });
    if (st.k === 'spatula' && st.c >= 0 && st.c !== s.myId) { const c = m.players.get(st.c); if (c) markers.push({ screen: project(c.body.x, c.body.y + 1.1, c.body.z), color: c.team === 1 ? '#4aa3ff' : '#ff6a5c', label: 'SPATULA' }); }
    // Distance to whatever the crosshair is on (the Yolkzooka reticle turns red inside arming range).
    const f = [-Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch)];
    const aimDist = m.grid.raycast(cam.x, cam.y, cam.z, f[0], f[1], f[2], 10, HIT) ? HIT.t : 99;
    this.hud.draw(dt, { me: this.state === 'play' ? me : null, yaw: cam.yaw, pitch: cam.pitch, speed: Math.hypot(me.body.vx, me.body.vz) * 30, air: me.body.onGround <= 0, fov: R.camera.fov, markers, aimDist });
  }
}

const app = new App();
registerApp(app);
