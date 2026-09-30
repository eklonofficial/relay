// Blockhaven bootstrap: assets, menus, input, camera, frame loop.
import { Demo, DEMO_SEED } from './demo.js?v=muo4kot4';
import { armorModel, armorSkinKey, ARMOR_MATERIALS, ARMOR_PIECES, elytraModel } from './data/armor.js?v=muo4kot4';
import { TEXTURES, TEX, B, BLOCKS, DIM, DIM_NAMES, SHAPE_OF, SHAPE, props } from './data/blocks.js?v=muo4kot4';
import { I, ITEMS } from './data/items.js?v=muo4kot4';
import { MOBS, PROFESSIONS, playerModel, saddleModel, PLAYER_SKINS } from './data/mobs.js?v=muo4kot4';
import { Net, cleanCode, cleanName, MAX_PLAYERS } from './net/net.js?v=muo4kot4';
import { NameTags } from './net/nametags.js?v=muo4kot4';
import { BIOMES } from './gen/biomes.js?v=muo4kot4';
import { generateBlockTextures } from './render/blocktex.js?v=muo4kot4';
import { generateItemTextures, ITEM_LAYER, FX_LAYER, ITEM_LAYER_COUNT } from './render/itemtex.js?v=muo4kot4';
import { packModel, paintModel, SKIN, faceRects } from './render/mobtex.js?v=muo4kot4';
import { buildMipChain } from './render/atlas.js?v=muo4kot4';
import { Renderer, Batch } from './render/renderer.js?v=muo4kot4';
import { World, UNLOADED } from './world/world.js?v=muo4kot4';
import { createGenerator } from './gen/index.js?v=muo4kot4';
import { Game } from './game/game.js?v=muo4kot4';
import { Interact } from './game/interact.js?v=muo4kot4';
import { Commands } from './game/commands.js?v=muo4kot4';
import { GUI, HUD } from './game/ui.js?v=muo4kot4';
import { buildIcons, hudSprites } from './game/icons.js?v=muo4kot4';
import { Sound } from './game/audio.js?v=muo4kot4';
import { buildLogo, buttonTexture, iconDataURL } from './render/logo.js?v=muo4kot4';
import { computeEnv } from './game/env.js?v=muo4kot4';
import { guideSections } from './game/guide.js?v=muo4kot4';
import { listWorlds, loadWorld, saveWorld, deleteWorld } from './game/storage.js?v=muo4kot4';
import { drawModel, rootMatrix, M } from './entity/entity.js?v=muo4kot4';
import { itemMesh, emitItemMesh } from './entity/itemmesh.js?v=muo4kot4';
import { Lightning } from './entity/objects.js?v=muo4kot4';
import { compose, translation, rotationX, rotationY, rotationZ, scaling, forward, mat4 } from './core/math.js?v=muo4kot4';

const $ = id => document.getElementById(id);
const SETTINGS_KEY = 'blockhaven.settings.v2';
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
// Low-end machines (Chromebooks, 4-core / 4 GB devices) get lighter defaults; visuals stay the same.
const LOW_END = /CrOS/.test(navigator.userAgent) || (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency || 8) <= 4;
const settings = Object.assign({
  renderDistance: LOW_END ? 6 : 8, fov: 70, sensitivity: 100, brightness: 50, volume: 60, music: 40,
  bobbing: true, clouds: true, autoJump: true, particles: true, dynamicRes: true, graphics: LOW_END ? 1 : 2,
}, load(SETTINGS_KEY) || {});
// Minecraft's default FOV is 70; move anyone still on our old default (75) over once.
if (!settings.fovMigrated) { if (settings.fov === 75) settings.fov = 70; settings.fovMigrated = true; store(SETTINGS_KEY, settings); }
const SPLASHES = ['Random ahh edition!', 'Also try Minecraft!', 'Now with elytra!', 'Saddle up!', 'Now with the Nether!', 'Also try the End!', 'Creepers included!', '60 mobs!', 'Villagers will trade!', 'Wild worlds are wild!', 'Every pixel procedural!', 'Craft everything!', 'Spectator mode!', 'Runs on Chromebooks!', 'Mind the lava!', 'Floating islands!'];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hashSeed(text) {
  const t = text.trim();
  if (!t) return (Math.random() * 2147483647) | 0;
  if (/^-?\d+$/.test(t)) return Number(t) | 0;
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 33) + t.charCodeAt(i)) | 0;
  return h;
}

// 3x4 row-major (entity M) to a 4x4 column-major matrix for the renderer.
function toMat4(m) { const o = new Float32Array(16); o[0] = m[0]; o[1] = m[4]; o[2] = m[8]; o[4] = m[1]; o[5] = m[5]; o[6] = m[9]; o[8] = m[2]; o[9] = m[6]; o[10] = m[10]; o[12] = m[3]; o[13] = m[7]; o[14] = m[11]; o[15] = 1; return o; }

// Rotation taking a sprite's diagonal (handle -> tip) to direction d with its face normal towards n.
function orient(d, n) {
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  d = norm(d);
  const dn = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
  n = norm([n[0] - d[0] * dn, n[1] - d[1] * dn, n[2] - d[2] * dn]);
  const A = [d, cross(n, d), n], s = Math.SQRT1_2;
  const Bv = [[s, s, 0], [-s, s, 0], [0, 0, 1]];
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 4 + c] = A[0][r] * Bv[0][c] + A[1][r] * Bv[1][c] + A[2][r] * Bv[2][c];
  return m;
}
const GRIP = orient([-0.42, 0.78, -0.46], [-0.5, 0.2, 0.85]);

class App {
  constructor() {
    this.settings = settings;
    this.mode = 'title';
    this.keys = new Set();
    this.mouse = { left: false, right: false, leftClicked: false, rightClicked: false };
    this.locked = false; this.hudHidden = false; this.debug = false; this.view = 0;
    this.time = 0; this.lastFrame = 0; this.fps = 60; this.frames = 0; this.fpsT = 0;
    this.renderScale = 1; this.frameTimes = [];
    this.post = { hurt: 0, flash: 0, dark: 0 };
    this.shakeAmt = 0; this.portalEffect = 0;
    this.chatLines = []; this.chatHistory = []; this.chatIdx = -1;
    this.fovCur = settings.fov;
    this.bobLast = [0, 0];
  }

  init() {
    try { this.renderer = new Renderer($('game')); } catch (e) { this.fatal(/WebGL 2 is not available/.test(e.message) ? 'Blockhaven needs WebGL 2, which this browser or device does not provide.' : `Graphics startup failed: ${e.message.split('\n')[0]}`); return false; }
    this.applyGraphics();
    // Textures.
    this.blockTex = generateBlockTextures();
    this.renderer.setBlockTextures(buildMipChain(this.blockTex), TEXTURES.length);
    this.itemTex = generateItemTextures();
    this.renderer.setItemTextures(buildMipChain(this.itemTex), this.itemTex.length);
    // Mob skins (one 64x64 layer per mob, villager profession and the player).
    this.mobModels = new Map(); this.mobLayers = new Map();
    const skins = [];
    const addSkin = (key, model, seed) => { packModel(model); this.mobModels.set(key, model); this.mobLayers.set(key, skins.length); skins.push(paintModel(model, seed)); };
    let seed = 1;
    for (const [k, d] of Object.entries(MOBS)) addSkin(k, d.model(), seed++);
    for (const p of PROFESSIONS) addSkin(`villager_${p}`, MOBS.villager.professionModel(p), seed++);
    PLAYER_SKINS.forEach((_, i) => addSkin(`player_${i}`, playerModel(i), 777 + i * 31));
    this.mobModels.set('player', this.mobModels.get('player_0'));
    this.skinPixels = skins;
    addSkin('saddle', saddleModel(), 778);
    addSkin('elytra', elytraModel(), 779);
    for (const mat of Object.keys(ARMOR_MATERIALS)) for (const piece of ARMOR_PIECES) for (const thin of [false, true]) addSkin(`armor_${mat}_${piece}${thin ? '_thin' : ''}`, armorModel(mat, piece, thin), seed++);
    this.renderer.setEntityTextures(buildMipChain(skins, SKIN, 7), skins.length);
    this.icons = buildIcons(this.blockTex, this.itemTex);
    this.sprites = hudSprites();
    this.sound = new Sound();
    this.sound.volume = settings.volume / 100; this.sound.music = settings.music / 100;
    this.batches = { mobs: new Batch(), items: new Batch(), itemFx: new Batch(), blockParticles: new Batch(), hand: new Batch() };
    this.nametags = new NameTags($('nametags'));
    this.bindSettings(); this.bindMenus(); this.bindInput();
    $('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
    this.buildTitleArt();
    this.startPanorama();
    requestAnimationFrame(t => this.frame(t));
    return true;
  }
  buildTitleArt() {
    const logo = buildLogo('BLOCKHAVEN', 'RANDOM AHH EDITION');
    $('logo').prepend(logo);
    $('logo').style.setProperty('--logo-w', logo.width);
    document.documentElement.style.setProperty('--btn-tex', `url(${buttonTexture()})`);
    $('full-icon').src = iconDataURL('full');
    this.applyMute();
  }
  applyMute() {
    this.sound.setVolume(settings.muted ? 0 : settings.volume / 100);
    if (this.sound.setMusic) this.sound.setMusic(settings.muted ? 0 : settings.music / 100);
    $('mute-icon').src = iconDataURL(settings.muted ? 'mute' : 'sound');
  }
  // Graphics presets: 0 Disabled, 1 Regular, 2 High, 3 PC.
  applyGraphics() {
    const q = Number(settings.graphics);
    this.renderer.setQuality(q);
  }
  openGuide() {
    this.openPanel('guide');
    const secs = guideSections(this.icons), tabs = $('guide-tabs'), body = $('guide-body');
    tabs.textContent = '';
    const show = name => { body.innerHTML = secs[name]; body.scrollTop = 0; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === name)); };
    for (const name of Object.keys(secs)) { const b = document.createElement('button'); b.textContent = name; b.addEventListener('click', () => { this.sound.click(); show(name); }); tabs.appendChild(b); }
    show(Object.keys(secs)[0]);
  }
  fatal(msg) { $('title').classList.add('hidden'); $('error').classList.remove('hidden'); $('error').textContent = msg; }

  // ---------------- asset lookups used by the game ----------------
  itemLayer(key) { return ITEM_LAYER[key] ?? FX_LAYER.blank; }
  itemPixels(key) { const l = ITEM_LAYER[key]; return l === undefined ? this.itemTex[FX_LAYER.blank] : this.itemTex[l]; }
  fxLayer(name) { return FX_LAYER[name] ?? FX_LAYER.blank; }
  mobModel(key) { return this.mobModels.get(key) || this.mobModels.get('pig'); }
  mobLayer(key) { return this.mobLayers.get(key === 'player' ? `player_${settings.skin | 0}` : key) ?? 0; }
  // Renders an item through a 3x4 world matrix whose unit square is the item's size.
  renderItemAt(ctx, key, m, light) {
    const it = I[key];
    if (!it) return;
    if (it.block && !it.flat) {
      const mm = M.chain(m, M.t(0.25, 0.25, 0), M.s(0.5), M.t(-0.5, -0.5, -0.5));
      const gl = new Float32Array([mm[0], mm[4], mm[8], 0, mm[1], mm[5], mm[9], 0, mm[2], mm[6], mm[10], 0, mm[3], mm[7], mm[11], 1]);
      ctx.blockModels.push({ id: it.block[0], meta: it.block[1], light: (light[0] + light[1] + light[2]) / 3, matrix: gl });
    } else emitItemMesh(ctx.items, itemMesh(key, this.itemPixels(key)), this.itemLayer(key), m, light);
  }

  // ---------------- title panorama ----------------
  startPanorama() {
    this.panorama = { seed: 1337, yaw: 0 };
    const gen = createGenerator(1337, 0, 'default');
    const s = gen.findSpawn();
    this.panorama.pos = [s.x, Math.max(s.y + 28, 104), s.z];
    this.panoWorld = new World({ seed: 1337, dim: 0, worldType: 'default', callbacks: { onMesh: (c, m) => this.renderer.uploadChunk(c, m), onUnload: c => this.renderer.freeChunk(c) } });
  }
  stopPanorama() { if (this.panoWorld) { this.panoWorld.dispose(); this.panoWorld = null; } }

  // ---------------- menus ----------------
  setMode(m) {
    this.mode = m;
    for (const id of ['title', 'worlds', 'create', 'loading', 'pause', 'death', 'mp']) $(id).classList.toggle('hidden', id !== m);
    if (m === 'pause') this.updatePauseMenu();
    $('hud').classList.toggle('hidden', !(m === 'play' || m === 'pause' || m === 'gui' || m === 'chat') || this.hudHidden);
    this.keys.clear(); this.mouse.left = this.mouse.right = false;
  }
  async showWorlds() {
    this.setMode('worlds');
    const list = $('world-list');
    list.textContent = '';
    const worlds = await listWorlds();
    this.selectedWorld = null;
    $('btn-world-play').disabled = $('btn-world-delete').disabled = true;
    if (!worlds.length) { const d = document.createElement('div'); d.className = 'empty-note'; d.textContent = 'No worlds yet — create one!'; list.appendChild(d); return; }
    for (const w of worlds) {
      const e = document.createElement('div'); e.className = 'world-entry';
      const th = document.createElement('div'); th.className = 'thumb'; if (w.thumb) th.style.backgroundImage = `url(${w.thumb})`;
      const info = document.createElement('div');
      const n = document.createElement('div'); n.className = 'name'; n.textContent = w.name;
      const i = document.createElement('div'); i.className = 'info';
      i.textContent = `${new Date(w.lastPlayed).toLocaleString()} · ${w.mode[0].toUpperCase() + w.mode.slice(1)} · ${w.type === 'wild' ? 'Wild' : w.type === 'flat' ? 'Superflat' : 'Default'} · Day ${(w.day || 0) + 1}`;
      info.append(n, i); e.append(th, info);
      e.addEventListener('click', () => { list.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); e.classList.add('sel'); this.selectedWorld = w.id; $('btn-world-play').disabled = $('btn-world-delete').disabled = false; });
      e.addEventListener('dblclick', () => this.playWorld(w.id));
      list.appendChild(e);
    }
  }
  async playWorld(id) {
    this.sound.unlock(); this.sound.click();
    const meta = await loadWorld(id);
    if (!meta) return;
    this.startGame(meta);
  }
  createWorld() {
    this.sound.unlock(); this.sound.click();
    const opt = k => $('create').querySelector(`[data-opt=${k}] .on`).dataset.v;
    const seedText = $('cw-seed').value;
    const meta = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: $('cw-name').value.trim() || 'New World', seed: hashSeed(seedText), seedText,
      mode: opt('mode'), type: opt('type'), difficulty: opt('difficulty'), cheats: opt('cheats') === 'on', created: Date.now(),
    };
    this.startGame(meta);
  }
  // Cinematic showcase: a real (unsaved) world driven by scripted camera shots.
  startDemo() {
    try { this.startDemoInner(); } catch (e) {
      console.error(e); this.demo = null;
      alert(`The demo couldn't start: ${e.message}\nTry refreshing the page (Ctrl+Shift+R).`);
    }
  }
  startDemoInner() {
    this.sound.unlock(); this.sound.click();
    this.demo = new Demo(this);
    this.startGame({ id: 'demo', name: 'Demo', seed: DEMO_SEED, seedText: String(DEMO_SEED), mode: 'creative', type: 'default', difficulty: 'normal', cheats: true, demo: true, created: Date.now() });
    this.hudHidden = true; $('hud').classList.add('hidden');
    $('demo-fade').style.opacity = 1;
  }
  exitDemo() {
    if (!this.demo) return;
    this.demo.stop(); this.demo = null;
    this.hudHidden = false;
    this.quitToTitle();
  }
  startGame(meta) {
    this.stopPanorama();
    this.generator = createGenerator(meta.seed, 0, meta.type);
    this.game = new Game(this);
    this.game.icons = this.icons;
    this.interact = new Interact(this.game);
    this.commands = new Commands(this.game);
    this.game.gui = this.gui = new GUI(this.game);
    this.game.hud = this.hud = new HUD(this.game, this.sprites);
    this.game.start(meta);
    this.chatLines = []; $('chat').textContent = '';
    this.setMode('loading');
    $('loading-label').textContent = meta.demo ? 'Preparing the demo…' : meta.dims ? 'Loading world…' : 'Generating world…';
    this.loadingFor = 0;
    if (!meta.demo) this.requestLock();
    if (!meta.demo) this.chat(`Welcome to ${meta.name}! Press T or / for chat and commands (try /help).`, '#aaaaaa');
    this.saveT = 0;
    // The controls hint only appears briefly in brand-new worlds.
    this.hintUntil = meta.dims || meta.demo ? 0 : performance.now() + 10000;
    $('hint').style.opacity = meta.dims || meta.demo ? 0 : 1;
  }
  onWorldOpened() {}
  onDimensionChange(dim) {
    if (this.demo) return;
    this.setMode('loading');
    $('loading-label').textContent = dim === DIM.NETHER ? 'Entering the Nether…' : dim === DIM.END ? 'Entering the End…' : 'Returning to the Overworld…';
  }
  async saveGame(quiet = true) {
    if (!this.game || !this.game.world || (this.game.meta && this.game.meta.demo)) return;
    // Guests' progress is kept by the host.
    if (this.net && !this.net.isHost) { this.net.sendPlayerData(); return; }
    const data = this.game.serialize();
    if (this.thumbNext) data.thumb = this.thumbNext;
    try { await saveWorld(data); if (!quiet) this.chat('Game saved', '#aaaaaa'); } catch (e) { console.warn('save failed', e); }
  }
  async quitToTitle() {
    if (document.pointerLockElement) document.exitPointerLock();
    await this.saveGame();
    this.leaveNet();
    if (this.game) { this.game.world.dispose(); this.game = null; }
    this.setMode('title');
    this.startPanorama();
  }
  onDeath(msg, score) {
    document.exitPointerLock();
    $('death-msg').textContent = msg;
    $('death-score').textContent = `Score: ${score}`;
    $('btn-respawn').textContent = this.game.hardcore ? 'Spectate World' : 'Respawn';
    setTimeout(() => this.setMode('death'), 900);
  }
  setGameMode(m) {
    const g = this.game;
    g.mode = m; g.player.mode = m;
    if (m !== 'creative' && m !== 'spectator') g.player.flying = false;
    if (m === 'spectator') g.player.flying = true;
    g.invDirty = true;
    this.hud.last = {};
    $('hotbar').parentElement.style.visibility = m === 'spectator' ? 'hidden' : 'visible';
  }
  showAction(text, t = 1.6) { this.actionText = text; this.actionT = t; }
  summonLightning(x, y, z) { this.game.entities.add(new Lightning(this.game, x, y, z)); }
  hurtFlash() { this.post.hurt = 1; this.shakeAmt = Math.max(this.shakeAmt, 0.35); }
  flash(v) { this.post.flash = Math.max(this.post.flash, v); }
  shake(v) { this.shakeAmt = Math.max(this.shakeAmt, v); }
  sleep(done) { this.sleeping = { t: 0, done }; }
  onGuiOpen() { this.setMode('gui'); this.suppressPause = true; document.exitPointerLock(); }
  onGuiClose() { this.setMode('play'); this.requestLock(); }

  // ---------------- multiplayer ----------------
  mpName() {
    if (!cleanName(settings.mpName)) { settings.mpName = `Player${100 + Math.floor(Math.random() * 900)}`; store(SETTINGS_KEY, settings); }
    return cleanName(settings.mpName);
  }
  saveMpSettings() {
    const n = cleanName($('mp-name').value);
    if (n) settings.mpName = n;
    store(SETTINGS_KEY, settings);
  }
  showMultiplayer(status = '', kind = '') {
    this.setMode('mp');
    $('mp-name').value = this.mpName();
    this.renderSkinPicker();
    this.mpStatus(status, kind);
  }
  mpStatus(text, kind = '') { const el = $('mp-status'); el.textContent = text; el.className = `mp-status ${kind}`; }
  // Front view of each default skin, cut out of the painted skin textures.
  renderSkinPicker() {
    const box = $('mp-skins');
    box.textContent = '';
    PLAYER_SKINS.forEach(([label], i) => {
      const b = document.createElement('button');
      b.className = `mp-skin${(settings.skin | 0) === i ? ' on' : ''}`;
      b.appendChild(this.skinPreview(i));
      const t = document.createElement('span'); t.textContent = label; b.appendChild(t);
      b.addEventListener('click', () => { this.sound.click(); settings.skin = i; store(SETTINGS_KEY, settings); this.renderSkinPicker(); });
      box.appendChild(b);
    });
  }
  skinPreview(i) {
    const src = document.createElement('canvas'); src.width = src.height = SKIN;
    const img = src.getContext('2d').createImageData(SKIN, SKIN);
    img.data.set(this.skinPixels[this.mobLayers.get(`player_${i}`)]);
    src.getContext('2d').putImageData(img, 0, 0);
    const out = document.createElement('canvas'); out.width = 16; out.height = 32;
    const x = out.getContext('2d'); x.imageSmoothingEnabled = false;
    const model = this.mobModels.get(`player_${i}`);
    const put = (partName, dx, dy, dw, dh) => { const b = model.parts[partName].boxes[0], [u, v, w, h] = faceRects(b).front; x.drawImage(src, u, v, w, h, dx, dy, dw, dh); };
    put('head', 4, 0, 8, 8); put('body', 4, 8, 8, 12); put('rightArm', 0, 8, 4, 12); put('leftArm', 12, 8, 4, 12); put('rightLeg', 4, 20, 4, 12); put('leftLeg', 8, 20, 4, 12);
    return out;
  }
  async joinWorld() {
    if (this.joining) return;
    this.saveMpSettings();
    const code = cleanCode($('mp-code').value), name = this.mpName();
    if (code.length !== 5) { this.mpStatus('Enter the 5-character code your friend sees in their pause menu.', 'err'); return; }
    this.joining = true; $('btn-mp-join').disabled = true;
    this.sound.unlock();
    try {
      const { net, welcome } = await Net.join(this, code, name, settings.skin | 0, t => this.mpStatus(t));
      if (this.mode !== 'mp') { net.close(); return; }
      this.mpStatus('Joined!', 'ok');
      this.startGuestGame(net, welcome);
    } catch (e) {
      this.mpStatus(e.message || String(e), 'err');
    } finally { this.joining = false; $('btn-mp-join').disabled = false; }
  }
  startGuestGame(net, w) {
    const m = w.meta, sv = m.saved || {};
    const spawn = sv.spawn || m.spawn || [0, 100, 0];
    const meta = {
      id: `mp-${net.code}`, name: m.name, seed: m.seed, seedText: m.seedText, type: m.type,
      mode: sv.mode || (m.mode === 'hardcore' ? 'survival' : m.mode), hardcore: m.mode === 'hardcore', difficulty: m.difficulty, cheats: m.cheats,
      rules: { ...(m.rules || {}), doWeatherCycle: false }, time: m.time, day: m.day, weather: m.weather, spawn, dragonKilled: m.dragonKilled, dims: m.dims,
      inventory: sv.inventory, enderChest: sv.enderChest, stats: sv.stats, advancements: sv.advancements,
      player: sv.player || { pos: spawn.slice(), yaw: Math.PI * 0.75, pitch: 0, flying: false, dim: 0 }, guest: true,
    };
    this.net = net;
    this.startGame(meta);
    this.game.net = net;
    net.attach();
    this.chat(`Connected to ${net.players.get(0) ? net.players.get(0).name : 'the host'}'s world. Hold Tab to see who's online.`, '#55ff55');
  }
  async openToFriends() {
    const g = this.game;
    if (this.net || !g || (g.meta && g.meta.demo)) return;
    const btn = $('btn-open');
    btn.disabled = true; btn.textContent = 'Opening…';
    const net = new Net(this, 'host');
    try {
      await net.host(this.mpName(), settings.skin | 0);
      if (this.game !== g) { net.close(); return; }
      this.net = net; g.net = net;
      if (g.rules.pvp === undefined) g.rules.pvp = true;
      this.chat(`Your world is open to friends! Room code: ${net.code}`, '#55ff55');
      this.chat('Friends join from the title screen: Multiplayer → enter the code. Hold Tab to see who\'s online.', '#aaaaaa');
    } catch (e) {
      this.chat(`Could not open to friends: ${e.message}`, '#ff5555');
    }
    btn.disabled = false;
    this.updatePauseMenu();
  }
  updatePauseMenu() {
    const n = this.net, info = $('room-info'), open = $('btn-open');
    const demo = this.game && this.game.meta && this.game.meta.demo;
    open.classList.toggle('hidden', !!n || !!demo);
    if (!n) open.textContent = 'Open to Friends';
    $('btn-quit').textContent = n && !n.isHost ? 'Disconnect' : 'Save and Quit to Title';
    info.classList.toggle('hidden', !n);
    if (n) {
      info.textContent = '';
      const a = document.createElement('div');
      a.append(n.isHost ? 'Room code: ' : 'Connected · code ', Object.assign(document.createElement('b'), { textContent: n.code }));
      const b = document.createElement('div');
      b.textContent = `${n.count}/${MAX_PLAYERS} players: ${n.playerNames().join(', ')}`;
      info.append(a, b);
    }
  }
  onPlayersChanged() { if (this.mode === 'pause') this.updatePauseMenu(); if (this.playerListShown) this.showPlayerList(true); }
  showPlayerList(on) {
    const el = $('playerlist');
    this.playerListShown = on && !!this.net;
    el.classList.toggle('hidden', !this.playerListShown);
    if (!this.playerListShown) return;
    const n = this.net;
    el.textContent = '';
    el.appendChild(Object.assign(document.createElement('div'), { className: 'h', textContent: `${n.isHost ? 'Your world' : 'Online'} · code ${n.code} · ${n.count}/${MAX_PLAYERS}` }));
    const host = n.isHost ? n.name : (n.players.get(0) || {}).name;
    for (const name of n.playerNames()) el.appendChild(Object.assign(document.createElement('div'), { className: 'p', textContent: `${name}${name === host ? ' (host)' : ''}${name === n.name ? ' (you)' : ''}` }));
  }
  leaveNet() {
    if (!this.net) return;
    this.net.close();
    this.net = null;
    if (this.game) this.game.net = null;
    this.nametags.clear(); this.showPlayerList(false);
  }
  onDisconnected(msg) {
    const wasGuest = this.net && !this.net.isHost;
    this.leaveNet();
    if (!wasGuest) return;
    document.exitPointerLock();
    if (this.game) { this.game.world.dispose(); this.game = null; }
    this.startPanorama();
    this.showMultiplayer(msg, 'err');
  }

  chat(text, color = '#ffffff') {
    const div = document.createElement('div');
    div.className = 'msg'; div.textContent = text; div.style.color = color;
    $('chat').appendChild(div);
    this.chatLines.push({ el: div, t: 10 });
    while (this.chatLines.length > 12) this.chatLines.shift().el.remove();
  }
  openChat(prefix = '') {
    this.setMode('chat');
    this.suppressPause = true;
    document.exitPointerLock();
    $('chat').classList.add('open');
    $('chat-input-row').classList.remove('hidden');
    const inp = $('chat-input');
    inp.value = prefix; inp.focus();
    this.chatIdx = this.chatHistory.length;
    this.updateSuggest();
  }
  closeChat() {
    $('chat').classList.remove('open');
    $('chat-input-row').classList.add('hidden');
    $('chat-suggest').classList.add('hidden');
    $('chat-input').blur();
    this.setMode('play'); this.requestLock();
  }
  updateSuggest() {
    const s = this.commands.suggest($('chat-input').value);
    const el = $('chat-suggest');
    el.classList.toggle('hidden', !s.length);
    el.textContent = s.join('\n');
    this.suggestions = s;
  }

  // Raw (unaccelerated) mouse input where supported, like Minecraft's "Raw Input" option.
  requestLock() {
    const c = $('game');
    let r;
    try { r = c.requestPointerLock({ unadjustedMovement: true }); } catch { r = null; }
    if (r && r.catch) r.catch(() => { const r2 = c.requestPointerLock(); if (r2 && r2.catch) r2.catch(() => {}); });
    else if (!r && document.pointerLockElement !== c) { try { c.requestPointerLock(); } catch { /* ignore */ } }
  }

  bindSettings() {
    const bind = (id, key, label, apply) => {
      const el = $(id);
      el.value = settings[key];
      if (label) $(label).textContent = settings[key];
      el.addEventListener('input', () => { settings[key] = Number(el.value); if (label) $(label).textContent = settings[key]; if (apply) apply(); });
    };
    bind('set-rd', 'renderDistance', 'rd-val');
    bind('set-fov', 'fov', 'fov-val');
    bind('set-sens', 'sensitivity', 'sens-val');
    bind('set-bright', 'brightness', 'bright-val');
    bind('set-vol', 'volume', 'vol-val', () => { settings.muted = false; this.applyMute(); });
    bind('set-music', 'music', 'music-val', () => { settings.muted = false; this.applyMute(); });
    $('set-gfx').value = settings.graphics;
    $('set-gfx').addEventListener('change', () => { settings.graphics = Number($('set-gfx').value); this.applyGraphics(); store(SETTINGS_KEY, settings); });
    for (const [id, k] of [['set-bob', 'bobbing'], ['set-clouds', 'clouds'], ['set-autojump', 'autoJump'], ['set-particles', 'particles'], ['set-dynres', 'dynamicRes']]) {
      $(id).checked = settings[k];
      $(id).addEventListener('change', () => { settings[k] = $(id).checked; if (this.game) this.game.player.autoJump = settings.autoJump; });
    }
  }
  bindMenus() {
    const click = (id, fn) => $(id).addEventListener('click', () => { this.sound.unlock(); this.sound.click(); fn(); });
    click('btn-play', () => this.showWorlds());
    click('btn-world-back', () => { if (this.hostAfterLoad) this.showMultiplayer(); else this.setMode('title'); });
    click('btn-world-new', () => { this.setMode('create'); $('cw-name').focus(); $('cw-name').select(); this.updateCreateHint(); });
    click('btn-world-play', () => this.selectedWorld && this.playWorld(this.selectedWorld));
    click('btn-world-delete', async () => { if (this.selectedWorld && confirm('Delete this world forever?')) { await deleteWorld(this.selectedWorld); this.showWorlds(); } });
    click('btn-create', () => this.createWorld());
    click('btn-create-cancel', () => this.showWorlds());
    for (const group of $('create').querySelectorAll('.opt')) {
      group.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        group.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        this.sound.click();
        this.updateCreateHint();
      });
    }
    click('btn-settings', () => this.openPanel('settings'));
    click('btn-settings2', () => this.openPanel('settings'));
    click('btn-settings-done', () => { $('settings').classList.add('hidden'); store(SETTINGS_KEY, settings); });
    click('btn-guide', () => this.openGuide());
    click('btn-demo', () => this.startDemo());
    click('btn-guide2', () => this.openGuide());
    click('btn-guide-done', () => $('guide').classList.add('hidden'));
    click('btn-controls', () => this.openPanel('controls'));
    click('btn-mute', () => { settings.muted = !settings.muted; this.applyMute(); store(SETTINGS_KEY, settings); });
    click('btn-full', () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); });
    click('btn-controls2', () => this.openPanel('controls'));
    click('btn-controls-done', () => $('controls').classList.add('hidden'));
    click('btn-resume', () => this.requestLock());
    click('btn-quit', () => this.quitToTitle());
    click('btn-open', () => this.openToFriends());
    click('btn-mp', () => this.showMultiplayer());
    click('btn-mp-back', () => { this.hostAfterLoad = false; this.setMode('title'); });
    click('btn-mp-join', () => this.joinWorld());
    click('btn-mp-host', () => { this.saveMpSettings(); this.hostAfterLoad = true; this.showWorlds(); });
    $('mp-code').addEventListener('input', () => { const el = $('mp-code'), v = cleanCode(el.value); if (el.value !== v) el.value = v; });
    $('mp-code').addEventListener('keydown', e => { if (e.key === 'Enter') this.joinWorld(); });
    $('mp-name').addEventListener('input', () => { const el = $('mp-name'), v = cleanName(el.value); if (el.value !== v) el.value = v; });
    click('btn-respawn', () => { this.game.respawn(); this.setMode('play'); this.requestLock(); if (this.game.hardcore) this.setGameMode('spectator'); });
    click('btn-death-title', () => this.quitToTitle());
    $('cw-seed').addEventListener('keydown', e => { if (e.key === 'Enter') this.createWorld(); });
  }
  updateCreateHint() {
    const opt = k => $('create').querySelector(`[data-opt=${k}] .on`).dataset.v;
    const t = { default: 'Continents, oceans, rivers, 40+ biomes, deep caves, villages and structures.', wild: 'Wild: amplified mountains, floating islands with waterfalls, giant stone pillars and natural arches.', flat: 'Superflat: a flat grassland, perfect for building.' }[opt('type')];
    const m = { survival: 'Survival: gather resources, craft, stay alive.', creative: 'Creative: unlimited blocks, flight, instant breaking.', hardcore: 'Hardcore: survival on hard difficulty with one life.' }[opt('mode')];
    $('cw-hint').textContent = `${m} ${t}`;
  }
  openPanel(id) { $(id).classList.remove('hidden'); }

  // ---------------- input ----------------
  bindInput() {
    const canvas = $('game');
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) { this.lockedAt = performance.now(); this.mouseAvg = 0; }
      if (this.locked) { if (this.mode === 'pause') this.setMode('play'); }
      else if (this.mode === 'play' && !this.suppressPause && !this.demo) { this.setMode('pause'); this.saveGame(); }
      this.suppressPause = false;
    });
    canvas.addEventListener('click', () => { if (!this.demo && (this.mode === 'play' || this.mode === 'loading') && !this.locked) this.requestLock(); });
    // Pointer events carry fractional movement (mousemove rounds to whole pixels, which swallows
    // slow, small motions and feels like a deadzone). pointerrawupdate is also delivered at the
    // device's full rate instead of once per frame.
    const moveEvent = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'onpointermove' in window ? 'pointermove' : 'mousemove';
    document.addEventListener(moveEvent, e => {
      if (!this.locked || this.mode !== 'play' || !this.game) return;
      let dx = e.movementX, dy = e.movementY;
      // Some browsers occasionally report a huge bogus jump (especially right after locking or
      // when the event queue stalls); drop deltas that are wildly out of line with recent motion.
      const mag = Math.abs(dx) + Math.abs(dy), avg = this.mouseAvg || 0;
      if (performance.now() - (this.lockedAt || 0) < 120 || (mag > 250 && mag > avg * 8 + 60)) { this.mouseAvg = avg * 0.9; return; }
      this.mouseAvg = avg * 0.8 + mag * 0.2;
      const s = settings.sensitivity / 100 * 0.0022, p = this.game.player;
      p.yaw -= dx * s;
      p.pitch = Math.max(-1.56, Math.min(1.56, p.pitch - dy * s));
    });
    document.addEventListener('mousedown', e => {
      if (this.mode !== 'play' || !this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftClicked = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightClicked = true; }
      if (e.button === 1) { e.preventDefault(); this.interact.pickBlock(); }
    });
    document.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('wheel', e => {
      if (this.mode !== 'play' || !this.game) return;
      const g = this.game;
      if (g.mode === 'spectator') { this.specSpeed = Math.max(0.2, Math.min(5, (this.specSpeed || 1) * (e.deltaY > 0 ? 0.85 : 1.15))); return; }
      this.select(g.inv.selected + Math.sign(e.deltaY));
    }, { passive: true });
    document.addEventListener('keydown', e => this.keyDown(e));
    document.addEventListener('keyup', e => { this.keys.delete(e.code); if (e.code === 'KeyW') this.tapSprint = false; if (e.code === 'Tab') this.showPlayerList(false); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveGame(); });
    window.addEventListener('beforeunload', () => this.saveGame());
    const inp = $('chat-input');
    inp.addEventListener('input', () => this.updateSuggest());
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { this.closeChat(); return; }
      if (e.key === 'Enter') {
        const v = inp.value.trim();
        if (v) {
          this.chatHistory.push(v);
          if (v.startsWith('/')) this.commands.run(v);
          else { const text = `<${this.game.playerName}> ${v}`; this.chat(text); if (this.net) this.net.send({ t: 'chat', id: this.net.myId, text }); }
        }
        this.closeChat();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = this.suggestions && this.suggestions[0];
        if (s) { const parts = inp.value.split(' '); parts[parts.length - 1] = s.startsWith('/') ? s.split(' ')[0] : s; inp.value = (parts.length === 1 ? parts[0].replace(/^\/?/, '/') : parts.join(' ')) + ' '; if (parts.length === 1) inp.value = s.split(' ')[0] + ' '; this.updateSuggest(); }
      }
      if (e.key === 'ArrowUp' && this.chatHistory.length) { this.chatIdx = Math.max(0, this.chatIdx - 1); inp.value = this.chatHistory[this.chatIdx]; }
      if (e.key === 'ArrowDown' && this.chatHistory.length) { this.chatIdx = Math.min(this.chatHistory.length, this.chatIdx + 1); inp.value = this.chatHistory[this.chatIdx] || ''; }
    });
  }
  select(i) {
    const g = this.game;
    const n = ((i % 9) + 9) % 9;
    if (n === g.inv.selected) return;
    g.inv.selected = n;
    g.attackCooldown = 0; // switching items restarts the attack charge, as in the original
    g.invDirty = true;
    this.interact.equip = 1;
    const s = g.inv.held;
    $('item-name').textContent = s ? I[s.key].name : '';
    $('item-name').style.opacity = s ? 1 : 0;
    this.nameT = 2;
  }
  keyDown(e) {
    if (this.demo) {
      if (e.code === 'Escape') { e.preventDefault(); this.exitDemo(); }
      else if (e.code === 'Space') { e.preventDefault(); this.demo.skip(); }
      return;
    }
    if (e.target.tagName === 'INPUT' && e.target.id !== 'chat-input') return;
    if (['Space', 'F1', 'F3', 'F5', 'Tab', 'Slash', 'Quote'].includes(e.code) || (e.ctrlKey && ['KeyW', 'KeyD', 'KeyS', 'KeyQ'].includes(e.code))) e.preventDefault();
    if (this.mode === 'gui') { if (this.gui.key(e)) e.preventDefault(); return; }
    const g = this.game;
    if (this.mode !== 'play' || !g) return;
    this.keys.add(e.code);
    if (e.code === 'KeyW' && !e.repeat) {
      const now = performance.now();
      if (now - (this.lastWTap || 0) < 300) this.tapSprint = true;
      this.lastWTap = now;
    }
    if (/^Digit[1-9]$/.test(e.code)) this.select(Number(e.code.slice(5)) - 1);
    if (e.code === 'Space' && !e.repeat) g.player.jumpPressed(this.time);
    if (e.code === 'KeyE' && g.mode !== 'spectator' && g.alive) this.gui.openInventory();
    if (e.code === 'KeyT' && !e.repeat) { e.preventDefault(); this.openChat(''); }
    if (e.code === 'Slash' && !e.repeat) { e.preventDefault(); this.openChat('/'); }
    if (e.code === 'KeyQ' && g.inv.held && g.mode !== 'spectator') { const s = g.inv.held, n = e.ctrlKey ? s.count : 1; g.dropStack({ ...s, count: n }); g.inv.consumeHeld(n); }
    if (e.code === 'KeyF' && g.mode !== 'spectator') { const a = g.inv.held, b = g.inv.offhand.get(0); g.inv.setHeld(b); g.inv.offhand.set(0, a); }
    if (e.code === 'Tab' && this.net) this.showPlayerList(true);
    if (e.code === 'F1') { this.hudHidden = !this.hudHidden; $('hud').classList.toggle('hidden', this.hudHidden); }
    if (e.code === 'F3') { this.debug = !this.debug; $('debug').classList.toggle('hidden', !this.debug); }
    if ((e.code === 'F5' || e.code === 'KeyV') && !e.repeat) {
      this.view = (this.view + 1) % 3;
      this.showAction(['First person', 'Third person (behind)', 'Third person (front)'][this.view]);
    }
    if (e.code === 'F4' && g.cheats) this.setGameMode(g.mode === 'spectator' ? 'creative' : 'spectator');
  }

  // ---------------- camera ----------------
  camera(dt) {
    const g = this.game, p = g.player;
    if (this.demo && this.demo.cam && this.demo.state === 'play') { const c = this.demo.cam; return { pos: c.pos.slice(), yaw: c.yaw, pitch: c.pitch, roll: c.roll }; }
    const bob = settings.bobbing && g.mode !== 'spectator' ? p.bobAmount : 0, ph = p.bobPhase;
    const eye = p.eyePos();
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let pos = [eye[0] + rx * Math.sin(ph) * 0.03 * bob, eye[1] + (Math.abs(Math.cos(ph)) * 0.07 - 0.04) * bob, eye[2] + rz * Math.sin(ph) * 0.03 * bob];
    let yaw = p.yaw, pitch = p.pitch, roll = Math.sin(ph) * 0.006 * bob;
    if (this.shakeAmt > 0) { roll += (Math.random() - 0.5) * this.shakeAmt * 0.08; this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2); }
    if (!g.alive) { roll = Math.min(1.2, (this.deathRoll = (this.deathRoll || 0) + dt * 2)); pos[1] -= Math.min(1.2, this.deathRoll); } else this.deathRoll = 0;
    if (this.view > 0) {
      const back = this.view === 1 ? -1 : 1;
      const f = forward(yaw, pitch);
      const d = [f[0] * back, f[1] * back, f[2] * back];
      const hit = g.mode === 'spectator' ? null : g.world.raycast(eye, d, 4);
      const dist = hit ? Math.max(0.3, hit.t - 0.3) : 4;
      pos = [eye[0] + d[0] * dist, eye[1] + d[1] * dist, eye[2] + d[2] * dist];
      if (this.view === 2) { yaw += Math.PI; pitch = -pitch; }
    }
    return { pos, yaw, pitch, roll };
  }

  // ---------------- frame ----------------
  frame(now) {
    requestAnimationFrame(t => this.frame(t));
    const realDt = (now - (this.lastFrame || now)) / 1000;
    const dt = Math.min(0.05, realDt);
    this.lastFrame = now;
    this.time += dt;
    this.fpsT += realDt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
    if (!this.game) { this.frames++; this.adaptResolution(realDt); }
    const dpr = Math.min(window.devicePixelRatio || 1, LOW_END ? 1 : 2) * this.renderScale;
    this.renderer.resize(Math.floor(window.innerWidth * dpr), Math.floor(window.innerHeight * dpr));
    // GUI scale like Minecraft's "Auto": the largest whole scale that keeps a 320x240 GUI on screen.
    const gs = Math.max(1, Math.min(4, Math.floor(Math.min(window.innerWidth / 320, window.innerHeight / 240))));
    if (gs !== this.guiScale) { this.guiScale = gs; document.documentElement.style.setProperty('--gs', gs); }
    if (!this.game) { this.framePanorama(dt); return; }
    this.frameGame(dt);
  }
  // Low-latency frame pacing. When the GPU can't keep up, the browser quietly queues finished
  // frames, so what you see (and every mouse/key press) lags two or three frames behind. A fence
  // after each frame lets us skip drawing while the GPU is still busy with the last one: the game
  // keeps simulating with the newest input, and the next frame drawn is always a fresh one.
  gpuReady() {
    const gl = this.renderer.gl;
    if (!this.fence) return true;
    const st = gl.getSyncParameter(this.fence, gl.SYNC_STATUS);
    if (st !== gl.SIGNALED && (this.gpuSkips = (this.gpuSkips || 0) + 1) <= 3) return false;
    gl.deleteSync(this.fence); this.fence = null; this.gpuSkips = 0;
    return true;
  }
  gpuSubmitted() {
    const gl = this.renderer.gl, now = performance.now();
    // Frame rate and dynamic resolution follow frames actually drawn, not animation callbacks.
    this.frames++;
    if (this.lastDrawn) this.adaptResolution(Math.min(0.25, (now - this.lastDrawn) / 1000));
    this.lastDrawn = now;
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }
  // Dynamic resolution keeps the frame rate smooth on slow GPUs, only touching resolution when truly needed.
  adaptResolution(realDt) {
    if (!settings.dynamicRes) { this.renderScale = 1; return; }
    // Resizing reallocates every render target, so it must be rare: only after a sustained
    // slowdown (or recovery) and never more than once every few seconds.
    this.frameTimes.push(realDt);
    if (this.frameTimes.length < 60) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    this.frameTimes.length = 0;
    const now = performance.now();
    this.resSlow = med > 1 / 36 ? (this.resSlow || 0) + 1 : 0;
    this.resFast = med < 1 / 55 ? (this.resFast || 0) + 1 : 0;
    if (now - (this.resChangedAt || 0) < 6000) return;
    const minScale = LOW_END ? 0.6 : 0.7;
    if (this.resSlow >= 2 && this.renderScale > minScale) { this.renderScale = Math.max(minScale, +(this.renderScale - 0.15).toFixed(2)); this.resChangedAt = now; this.resSlow = 0; }
    else if (this.resFast >= 6 && this.renderScale < 1) { this.renderScale = Math.min(1, +(this.renderScale + 0.15).toFixed(2)); this.resChangedAt = now; this.resFast = 0; }
  }
  framePanorama(dt) {
    const pano = this.panorama;
    if (!pano || !this.panoWorld) return;
    pano.yaw += dt * 0.04;
    this.sound.updateMusic(dt, 'menu');
    this.panoWorld.update(pano.pos[0], pano.pos[2], Math.min(settings.renderDistance, LOW_END ? 5 : 7));
    const env = computeEnv(0, 0.07, forward(pano.yaw, -0.15), 0, 0, settings.brightness / 100);
    this.renderer.render({ camPos: pano.pos, yaw: pano.yaw, pitch: -0.15, roll: 0, fov: 75, time: this.time, env, medium: 0, renderDistance: Math.min(settings.renderDistance, LOW_END ? 5 : 7), clouds: settings.clouds, chunks: this.panoWorld.chunks.values(), dim: 0, post: { saturation: 1.1 } });
  }
  frameGame(dt) {
    const g = this.game, p = g.player;
    const rd = settings.renderDistance;
    g.world.update(p.pos[0], p.pos[2], rd);
    if (this.mode === 'loading') {
      g.settleArrival();
      const r = 2, total = (2 * r + 1) ** 2;
      let ready = 0;
      const pcx = Math.floor(p.pos[0] / 16), pcz = Math.floor(p.pos[2] / 16);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const c = g.world.chunk(pcx + dx, pcz + dz); if (c && c.meshedVersion > 0) ready++; }
      $('load-bar').style.width = `${Math.round(ready / total * 100)}%`;
      this.loadingFor += dt;
      if (ready === total && !g.pendingArrival) {
        // Drop onto solid ground if the saved position is inside terrain.
        this.setMode(this.locked || this.demo ? 'play' : 'pause');
        this.setGameMode(g.mode);
        if (this.hostAfterLoad) { this.hostAfterLoad = false; this.openToFriends(); }
        if (this.demo && this.demo.state === 'idle') { $('hud').classList.add('hidden'); this.demo.start(); }
      }
    }
    const playing = this.mode === 'play' || this.mode === 'gui' || this.mode === 'chat' || this.mode === 'death' || (this.net && this.mode === 'pause');
    if (playing) {
      const input = {
        forward: this.keys.has('KeyW'), back: this.keys.has('KeyS'), left: this.keys.has('KeyA'), right: this.keys.has('KeyD'),
        jump: this.keys.has('Space'), sneak: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'), sprint: this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyR') || !!this.tapSprint,
      };
      if (this.mode !== 'play') for (const k of Object.keys(input)) input[k] = false;
      if (g.alive) {
        if (g.mode === 'spectator') p.speedMul = this.specSpeed || 1;
        if (g.riding) g.rideControl(dt, input); else p.update(dt, input);
      }
      g.update(dt);
      if (g.riding) g.rideSync();
      if (this.net) this.net.update(dt);
      if (this.demo) this.demo.update(dt);
      this.interact.update(dt, { attack: this.mouse.left && this.mode === 'play', attackClicked: this.mouse.leftClicked, use: this.mouse.right && this.mode === 'play', useClicked: this.mouse.rightClicked });
      this.mouse.leftClicked = this.mouse.rightClicked = false;
      if (this.gui.isOpen) this.gui.update();
      this.saveT += dt;
      if (this.saveT > 45) { this.saveT = 0; this.saveGame(); }
    }
    if (this.sleeping) {
      this.sleeping.t += dt;
      this.post.dark = Math.min(1, this.sleeping.t / 1.5);
      if (this.sleeping.t > 2) { this.sleeping.done(); this.sleeping = null; }
    } else this.post.dark = Math.max(0, this.post.dark - dt);
    if (this.gpuReady()) { this.render(dt); this.gpuSubmitted(); }
    this.updateHud(dt);
  }

  render(dt) {
    const g = this.game, p = g.player;
    const cam = this.camera(dt);
    const f = forward(cam.yaw, cam.pitch);
    const rain = g.dim === 0 ? g.weather.rain : 0;
    g.env = computeEnv(g.dim, g.dayTime, f, rain, g.dim === 0 ? g.weather.thunder : 0, settings.brightness / 100 + (g.stats.effects.night_vision ? 4 : 0));
    const env = g.env;
    const camBlock = g.world.getBlock(cam.pos[0], cam.pos[1], cam.pos[2]);
    const medium = g.mode === 'spectator' && SHAPE_OF[camBlock] === SHAPE.CUBE ? 0 : camBlock === B.WATER ? 1 : camBlock === B.LAVA ? 2 : 0;
    // FOV: sprint and flight widen it.
    const fovTarget = settings.fov + (p.gliding ? Math.min(18, Math.hypot(p.vel[0], p.vel[1], p.vel[2]) * 0.5) : 0) + (p.sprinting ? (p.flying ? 14 : 9) : 0) - (medium === 1 ? 6 : 0) - (this.interact.using === 'bow' ? Math.min(1, this.interact.useT) * 12 : 0);
    this.fovCur += (fovTarget - this.fovCur) * (1 - Math.exp(-dt * 8));
    this.sound.listener = { pos: cam.pos, yaw: cam.yaw };
    // Entity/particle batches.
    const B_ = this.batches;
    for (const b of Object.values(B_)) b.reset();
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    const up = [Math.sin(cam.yaw) * Math.sin(cam.pitch), Math.cos(cam.pitch), Math.cos(cam.yaw) * Math.sin(cam.pitch)];
    const ctx = { camPos: cam.pos, camRight: right, camUp: up, mobs: B_.mobs, items: B_.items, itemFx: B_.itemFx, blockParticles: B_.blockParticles, blockModels: [], labels: [] };
    const maxD2 = (settings.renderDistance * 16) ** 2;
    for (const e of g.entities.list) {
      if (e.dead || e.frozen) continue;
      const dx = e.pos[0] - cam.pos[0], dz = e.pos[2] - cam.pos[2];
      if (dx * dx + dz * dz > Math.min(maxD2, e.mobType === 'ender_dragon' || e.mobType === 'ghast' ? 1e9 : 80 * 80)) continue;
      e.render(ctx);
    }
    g.particles.render(ctx);
    // Chest lids swinging on their back hinge (ease-out like the original's lid curve).
    for (const a of g.chestAnims.values()) {
      const e = 1 - (1 - a.open) ** 3, facing = g.world.getMeta(a.x, a.y, a.z) & 3;
      const l = g.world.lightAt(a.x, a.y + 1, a.z), sky = Math.pow(0.8, 15 - l.sky), blk = Math.pow(0.82, 15 - l.blk);
      const light = Math.max(sky * g.env.skyLight[0], blk * 1.1, g.env.ambient[0]);
      const matrix = compose(translation(a.x + 0.5, a.y, a.z + 0.5), rotationY(-facing * Math.PI / 2), translation(-0.5, 0, -0.5), translation(0, 10 / 16, 1 / 16), rotationX(-e * Math.PI / 2), translation(0, -10 / 16, -1 / 16));
      ctx.blockModels.push({ id: B.CHEST, meta: 32, light, matrix });
    }
    if (this.view > 0 && g.alive && g.mode !== 'spectator') this.drawPlayerModel(ctx);
    if (rain > 0.05) this.drawWeather(ctx, cam, rain);
    // Hand.
    let hand = null;
    if (this.view === 0 && !this.hudHidden && g.alive && g.mode !== 'spectator') hand = this.buildHand(dt, cam);
    const target = this.mode === 'play' && this.interact.target ? { ...this.interact.target } : null;
    const stage = this.interact.crackStage();
    this.post.hurt = Math.max(0, this.post.hurt - dt * 2);
    this.post.flash = Math.max(0, this.post.flash - dt * 3);
    this.renderer.render({
      camPos: cam.pos, yaw: cam.yaw, pitch: cam.pitch, roll: cam.roll, fov: this.fovCur, time: this.time, env, medium, wind: rain,
      renderDistance: settings.renderDistance, clouds: settings.clouds && g.dim === 0, chunks: g.world.chunks.values(), dim: g.dim, rain,
      target: target && this.mode === 'play' ? target : null, crack: stage >= 0 && target ? { ...target, stage } : null,
      blockModels: ctx.blockModels,
      solidBatches: [{ batch: B_.mobs, tex: 'mob' }, { batch: B_.items, tex: 'item' }, { batch: B_.blockParticles, tex: 'block' }],
      blendBatches: [{ batch: B_.itemFx, tex: 'item' }],
      hand, post: { hurt: this.post.hurt, flash: this.post.flash + (g.stats.fire > 0 && this.view === 0 ? 0.03 : 0), portal: this.portalEffect, dark: this.post.dark, saturation: 1.1 },
    });
    if (this.net && !this.hudHidden) this.nametags.update(cam, this.fovCur, this.net.remotePlayers(), g.world); else this.nametags.clear();
    if (this.wantThumb) { this.wantThumb = false; }
  }

  drawPlayerModel(ctx) {
    const g = this.game, p = g.player;
    this.drawHumanoid(ctx, {
      pos: p.renderPos || p.pos, yaw: p.yaw, pitch: p.pitch, walk: p.bobPhase * 1.6, walkAmt: p.bobAmount, swing: this.interact.swing,
      sneaking: p.sneaking, riding: !!g.riding, gliding: p.gliding, vel: p.vel, layer: this.mobLayer('player'), flash: this.post.hurt > 0.5 ? 0.6 : 0,
      armor: g.inv.armor.slots.map(s => s && s.key), held: g.inv.held && g.inv.held.key, off: g.inv.offhand.get(0) && g.inv.offhand.get(0).key,
      bow: this.interact.using === 'bow' || this.interact.using === 'crossbow', trident: this.interact.using === 'trident', blocking: g.blocking,
    });
  }
  drawRemotePlayer(ctx, rp) {
    this.drawHumanoid(ctx, {
      pos: rp.pos, yaw: rp.yaw, pitch: rp.headPitch, walk: rp.walk, walkAmt: rp.walkAmt, swing: rp.swing, sneaking: rp.sneaking, riding: rp.riding,
      gliding: rp.gliding, vel: rp.vel, layer: this.mobLayer(`player_${rp.skin}`), flash: rp.hurtT > 0 ? 0.6 : 0,
      armor: rp.armor, held: rp.held, off: rp.off, bow: rp.drawingBow, trident: rp.throwingTrident, blocking: rp.blocking,
    });
  }
  // A player model in any pose: walking, sneaking, riding, gliding, drawing a bow, blocking.
  drawHumanoid(ctx, s) {
    const g = this.game;
    const model = this.mobModel('player');
    const sw = Math.sin(s.walk) * 0.9 * s.walkAmt;
    const swing = Math.sin(s.swing * Math.PI) * 1.4;
    const poses = { head: [s.pitch, 0, 0], rightLeg: [sw, 0, 0], leftLeg: [-sw, 0, 0], rightArm: [-sw * 0.8 + swing, 0, 0], leftArm: [sw * 0.8, 0, 0] };
    if (s.riding) { poses.rightLeg = [1.35, -0.25, 0]; poses.leftLeg = [1.35, 0.25, 0]; poses.rightArm = [0.55 + swing, 0, 0]; poses.leftArm = [0.55, 0, 0]; }
    if (s.bow) { poses.rightArm = [1.45 + s.pitch, -0.1, 0]; poses.leftArm = [1.45 + s.pitch, 0.45, 0]; }
    if (s.blocking) poses.leftArm = [0.9, 0.55, 0];
    if (s.trident) poses.rightArm = [2.8, -0.2, 0];
    const lp = s.pos;
    const light = g.world.lightAt(lp[0], lp[1] + 1, lp[2]);
    const b = Math.max(Math.pow(0.8, 15 - light.sky) * g.env.skyLight[0], Math.pow(0.82, 15 - light.blk), g.env.ambient[0]);
    const sneak = s.sneaking ? M.chain(M.t(0, -2, 0), M.rx(0)) : null;
    // Gliding: the body lies along the flight path (feet at the tail), arms swept back.
    let glide = null;
    if (s.gliding) {
      const v = s.vel || [0, 0, 0], sp = Math.hypot(v[0], v[1], v[2]) || 1, fp = Math.asin(Math.max(-1, Math.min(1, v[1] / sp)));
      glide = M.chain(M.t(0, 12, 0), M.rx(-Math.PI / 2 - fp), M.t(0, -12, 0));
      poses.rightArm = [0.2, 0, 0.25]; poses.leftArm = [0.2, 0, -0.25]; poses.rightLeg = [0.05, 0, 0]; poses.leftLeg = [-0.05, 0, 0]; poses.head = [0.9, 0, 0];
    }
    const root = rootMatrix(lp, s.yaw, 1, glide || sneak), flash = s.flash || 0;
    const mats = drawModel(ctx.mobs, model, s.layer, root, poses, [b, b, b], flash);
    const armor = s.armor || [];
    if (armor[1] === 'elytra') {
      const open = s.gliding ? 1 : 0, flap = s.gliding ? Math.sin(this.time * 3) * 0.05 : Math.sin(this.time * 1.2) * 0.03;
      drawModel(ctx.mobs, this.mobModel('elytra'), this.mobLayer('elytra'), root, { wingL: [0.26 + open * 0.2 + flap, 0, -0.26 - open * 1.1], wingR: [0.26 + open * 0.2 + flap, 0, 0.26 + open * 1.1] }, [b, b, b], flash);
    }
    for (const key of armor) {
      const sk = key && armorSkinKey(key);
      if (sk) drawModel(ctx.mobs, this.mobModel(sk), this.mobLayer(sk), root, poses, [b, b, b], flash);
    }
    if (s.held && I[s.held] && mats.rightArm) this.renderItemAt(ctx, s.held, M.chain(mats.rightArm, M.t(-3, -10, -1), M.rx(-Math.PI / 2), M.s(10)), [b, b, b]);
    if (s.off && I[s.off] && mats.leftArm) this.renderItemAt(ctx, s.off, M.chain(mats.leftArm, M.t(3, -10, -1), M.rx(-Math.PI / 2), M.s(10)), [b, b, b]);
  }

  drawWeather(ctx, cam, rain) {
    const g = this.game, w = g.world;
    const snowy = b => { const bm = BIOMES[b]; return bm && bm.temp < 0.15; };
    const layerRain = this.fxLayer('rain'), layerSnow = this.fxLayer('snow');
    const R = 12, t = this.time;
    const cx = Math.floor(cam.pos[0]), cz = Math.floor(cam.pos[2]);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R) continue;
      const x = cx + dx, z = cz + dz;
      const h = ((x * 73856093) ^ (z * 19349663)) >>> 0;
      if ((h & 3) !== 0 && dx * dx + dz * dz > 25) continue;
      const top = w.heightAt(x, z);
      if (top < 0) continue;
      const y0 = Math.max(top + 1, cam.pos[1] - 10), y1 = cam.pos[1] + 12;
      if (y1 <= y0) continue;
      const snow = snowy(w.biomeAt(x, z)) || top > 170;
      const bx = x + (h % 97) / 97, bz = z + ((h >> 8) % 89) / 89;
      if (snow) {
        for (let k = 0; k < 3; k++) {
          const yy = y1 - ((t * 1.5 + (h >> 4) % 20 + k * 7) % (y1 - y0 + 0.01));
          const wob = Math.sin(t + k + h) * 0.3;
          const s = 0.12, r = ctx.camRight, u = ctx.camUp;
          const c = (a, b) => [bx + wob + (r[0] * a + u[0] * b) * s, yy + (r[1] * a + u[1] * b) * s, bz + (r[2] * a + u[2] * b) * s];
          ctx.itemFx.quad([c(-1, -1), c(-1, 1), c(1, 1), c(1, -1)], [0, 0, 1, 1], layerSnow, [1, 1, 1, rain]);
        }
      } else {
        const len = 1.4, yy = y1 - ((t * 14 + (h >> 4) % 30) % (y1 - y0 + 0.01));
        if (yy - len < y0) continue;
        const r = ctx.camRight, s = 0.05;
        ctx.itemFx.quad([[bx - r[0] * s, yy - len, bz - r[2] * s], [bx - r[0] * s, yy, bz - r[2] * s], [bx + r[0] * s, yy, bz + r[2] * s], [bx + r[0] * s, yy - len, bz + r[2] * s]], [0, 0, 1, 1], layerRain, [0.8, 0.85, 1, rain * 0.7]);
        if (Math.random() < 0.004 * rain && top + 1 > cam.pos[1] - 10) g.particles.fx('splash', [bx, top + 1.05, bz], 1, 0.05, 0.6);
      }
    }
    this.sound.setRain(rain * (g.world.lightAt(cam.pos[0], cam.pos[1], cam.pos[2]).sky / 15));
  }

  // First-person hand/item in view space.
  // First-person hand, following Minecraft's held-item renderer: the arm offset, the swing arc
  // (sin(f^2*pi) / sin(sqrt(f)*pi) curves over 0.3 s) and per-type display transforms, so swords
  // sit diagonally in the grip and chop down-and-across when swung.
  buildHand(dt, cam) {
    const res = this.buildMainHand(dt, cam) || {};
    const off = this.game.inv.offhand.get(0);
    if (off && I[off.key]) this.addOffHand(res, off, dt);
    return res;
  }
  // The off-hand item, mirrored to the left with its own swing; a raised shield while blocking.
  addOffHand(res, off, dt) {
    const g = this.game, p = g.player, it = this.interact, D2R = Math.PI / 180;
    const item = I[off.key];
    const f = it.swingOff > 0 ? 1 - it.swingOff : 0, sf = Math.sqrt(f);
    const using = it.using && it.usingHand === 'off' ? it.using : null;
    const bob = settings.bobbing ? p.bobAmount : 0, ph = p.bobPhase;
    const sway = M.t(-Math.sin(ph) * 0.03 * bob - (this.swayX || 0) * 0.3, -Math.abs(Math.cos(ph)) * 0.035 * bob + (this.swayY || 0) * 0.2, 0);
    const mirror = M.s(-1, 1, 1);
    const g1 = Math.sin(f * f * Math.PI), h1 = Math.sin(sf * Math.PI);
    const arm = M.chain(mirror, M.t(-0.4 * Math.sin(sf * Math.PI), 0.2 * Math.sin(sf * Math.PI * 2), -0.2 * Math.sin(f * Math.PI)), M.t(0.56, -0.52, -0.72), M.ry((45 - g1 * 20) * D2R), M.rz(-h1 * 20 * D2R), M.rx(-h1 * 80 * D2R), M.ry(-45 * D2R));
    const l = g.world.lightAt(p.pos[0], p.pos[1] + 1.6, p.pos[2]);
    const light = Math.max(Math.pow(0.8, 15 - l.sky) * g.env.skyLight[0], Math.pow(0.82, 15 - l.blk), g.env.ambient[0] + 0.05);
    if (item.block && !item.flat) {
      const m = M.chain(sway, arm, M.t(-0.06, 0.17, -0.06), M.ry(45 * D2R), M.rx(-6 * D2R), M.s(0.25), M.t(-0.5, -0.5, -0.5));
      res.block2 = { id: item.block[0], meta: item.block[1], matrix: toMat4(m) };
      res.light = res.light ?? light;
      return;
    }
    let m;
    if (using === 'shield' || (item.kind === 'shield' && g.blocking)) m = M.chain(sway, mirror, M.t(0.28, -0.38, -0.55), M.ry(-0.25), M.s(0.8), M.t(-0.5, -0.5, 0));
    else if (using === 'eat') m = M.chain(sway, mirror, M.t(0.18, -0.36 + Math.sin(it.useT * 18) * 0.04, -0.58), M.ry(-40 * D2R), M.rx(20 * D2R), M.t(0.04, -0.02, 0.05), GRIP, M.s(0.54), M.t(-0.22, -0.22, 0));
    else m = M.chain(sway, arm, M.t(0.04, -0.02, 0.05), GRIP, M.s(0.54), M.t(-0.22, -0.22, 0));
    const batch = this.batches.hand2 || (this.batches.hand2 = new Batch());
    batch.reset();
    emitItemMesh(batch, itemMesh(off.key, this.itemPixels(off.key)), this.itemLayer(off.key), m, [light, light, light]);
    res.batch2 = batch; res.batchTex2 = 'item'; res.light = res.light ?? light;
  }
  buildMainHand(dt, cam) {
    const g = this.game, p = g.player, it = this.interact;
    const D2R = Math.PI / 180;
    const f = this.debugSwing ?? (it.swing > 0 ? 1 - it.swing : 0), sf = Math.sqrt(f);
    const bob = settings.bobbing ? p.bobAmount : 0, ph = p.bobPhase;
    let dyaw = p.yaw - this.bobLast[0];
    if (dyaw > Math.PI) dyaw -= Math.PI * 2; else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.swayX = (this.swayX || 0) + (Math.max(-0.2, Math.min(0.2, dyaw * 2.5)) - (this.swayX || 0)) * Math.min(1, dt * 10);
    this.swayY = (this.swayY || 0) + (Math.max(-0.2, Math.min(0.2, (p.pitch - this.bobLast[1]) * 2.5)) - (this.swayY || 0)) * Math.min(1, dt * 10);
    this.bobLast = [p.yaw, p.pitch];
    const equip = Math.sin(it.equip * Math.PI / 2);
    // View bob and sway, applied to the whole arm like the original's bobbing.
    const sway = M.t(Math.sin(ph) * 0.03 * bob + this.swayX * 0.3, -Math.abs(Math.cos(ph)) * 0.035 * bob + this.swayY * 0.2, 0);
    const l = g.world.lightAt(p.pos[0], p.pos[1] + 1.6, p.pos[2]);
    const light = Math.max(Math.pow(0.8, 15 - l.sky) * g.env.skyLight[0], Math.pow(0.82, 15 - l.blk), g.env.ambient[0] + 0.05);
    const held = g.inv.held, item = held && I[held.key];
    const using = it.using;
    const batch = this.batches.hand;
    batch.reset();
    // Arm position + attack swing (applyItemArmTransform / applyItemArmAttackTransform).
    const swingArm = () => {
      const g1 = Math.sin(f * f * Math.PI), h1 = Math.sin(sf * Math.PI);
      return M.chain(sway,
        M.t(-0.4 * Math.sin(sf * Math.PI), 0.2 * Math.sin(sf * Math.PI * 2), -0.2 * Math.sin(f * Math.PI)),
        M.t(0.56, -0.52 - equip * 0.6, -0.72),
        M.ry((45 - g1 * 20) * D2R), M.rz(-h1 * 20 * D2R), M.rx(-h1 * 80 * D2R), M.ry(-45 * D2R));
    };
    if (item && item.block && !item.flat) {
      let base = swingArm();
      if (using === 'eat') base = M.chain(sway, M.t(0.3, -0.35 + Math.sin(it.useT * 18) * 0.04, -0.6));
      const m = M.chain(base, M.t(-0.06, 0.17, -0.06), M.ry(45 * D2R), M.rx(-6 * D2R), M.s(0.25), M.t(-0.5, -0.5, -0.5));
      return { block: { id: item.block[0], meta: item.block[1], matrix: toMat4(m) }, light };
    }
    if (item) {
      let m;
      const flatItem = (base) => M.chain(base, M.t(0.04, -0.02, 0.05), GRIP, M.s(0.54), M.t(-0.22, -0.22, 0));
      if (using === 'bow' || using === 'crossbow') {
        const pull = Math.min(1, it.useT);
        const key = using === 'bow' ? (pull > 0.9 ? 'bow_pulling_2' : pull > 0.5 ? 'bow_pulling_1' : 'bow_pulling_0') : 'crossbow';
        // Bow drawn across the body, pulled back as it charges.
        const base = M.chain(sway, M.t(0.18, -0.38, -0.62 + pull * 0.08), M.ry(-12 * D2R), M.rx(-6 * D2R), M.rz(-10 * D2R + Math.sin(this.time * 40) * 0.01 * pull));
        m = M.chain(base, M.ry(-90 * D2R), M.rz(40 * D2R), M.s(0.7), M.t(-0.5, -0.5, 0));
        emitItemMesh(batch, itemMesh(key, this.itemTex[FX_LAYER[key] ?? ITEM_LAYER.bow]), FX_LAYER[key] ?? ITEM_LAYER[held.key], m, [light, light, light]);
        return { batch, batchTex: 'item', light };
      }
      if (using === 'trident') {
        // Wound back over the shoulder, prongs forward, trembling once fully charged.
        const pull = Math.min(1, it.useT / 0.5), shake = pull >= 1 ? Math.sin(this.time * 50) * 0.004 : 0;
        m = M.chain(sway, M.t(0.3 + shake, -0.28 + pull * 0.06, -0.5 + pull * 0.2), orient([-0.08, 0.18, -1], [0.3, 1, 0.1]), M.s(1.15), M.t(-0.5, -0.5, 0));
      } else if (using === 'eat') m = flatItem(M.chain(sway, M.t(0.18, -0.36 + Math.sin(it.useT * 18) * 0.04, -0.58), M.ry(-40 * D2R), M.rx(20 * D2R)));
      else if (using === 'shield') m = M.chain(sway, M.t(0.25, -0.4, -0.6), M.ry(-0.3), M.s(0.8), M.t(-0.5, -0.5, 0));
      else {
        // Chop: the blade sweeps from upper right down across the crosshair, fast out, slower back.
        const h1 = Math.sin(sf * Math.PI), g1 = Math.sin(f * f * Math.PI);
        const base = M.chain(sway, M.t(0.56 - 0.2 * h1, -0.52 - equip * 0.6 + 0.2 * h1 - 0.1 * g1, -0.72 - 0.1 * h1), M.rz(h1 * 42 * D2R), M.rx(-h1 * 22 * D2R), M.ry(g1 * 12 * D2R));
        m = flatItem(base);
      }
      emitItemMesh(batch, itemMesh(held.key, this.itemPixels(held.key)), this.itemLayer(held.key), m, [light, light, light]);
      return { batch, batchTex: 'item', light };
    }
    // Empty hand: Minecraft's renderArmFirstPerson stack (blocks and degrees), then the arm model
    // in its own space: our arm box (hand at y -10, outer face +x) turned into the original's
    // (hand at y +12, shoulder pivot at x -5).
    const DR = Math.PI / 180, f2 = -0.3 * Math.sin(sf * Math.PI), f3 = 0.4 * Math.sin(sf * Math.PI * 2), f4 = -0.4 * Math.sin(f * Math.PI);
    const f5 = Math.sin(f * f * Math.PI), f6 = Math.sin(sf * Math.PI);
    const model = this.mobModel('player'), arm = { tex: model.tex, parts: { rightArm: { pivot: [0, 0, 0], boxes: model.parts.rightArm.boxes } } };
    const root = M.chain(sway,
      M.t(f2 + 0.64, f3 - 0.6 - equip * 0.6, f4 - 0.72),
      M.ry(45 * DR), M.ry(f6 * 70 * DR), M.rz(-f5 * 20 * DR),
      M.t(-1, 3.6, 3.5), M.rz(120 * DR), M.rx(200 * DR), M.ry(-135 * DR), M.t(5.6, 0, 0),
      M.s(1 / 16), M.t(-6, 2, 0), M.rz(Math.PI));
    drawModel(batch, arm, this.mobLayer('player'), root, {}, [light, light, light], 0);
    return { batch, batchTex: 'mob', light };
  }

  updateHud(dt) {
    const g = this.game, p = g.player;
    if (g.invDirty) { this.hud.renderHotbar(); g.invDirty = false; }
    this.hud.update(dt);
    for (const c of this.chatLines) { c.t -= dt; c.el.style.opacity = Math.min(1, Math.max(0, c.t)); }
    if (this.nameT > 0) { this.nameT -= dt; if (this.nameT <= 0) $('item-name').style.opacity = 0; }
    if (this.hintUntil && performance.now() > this.hintUntil) { this.hintUntil = 0; $('hint').style.opacity = 0; }
    const boss = $('boss');
    boss.classList.toggle('hidden', !g.bossBar);
    if (g.bossBar) { boss.querySelector('.n').textContent = g.bossBar.name; const bar = boss.querySelector('.b div'); bar.style.width = `${g.bossBar.frac * 100}%`; bar.style.background = g.bossBar.color || ''; }
    $('onfire').style.opacity = g.stats.fire > 0 && this.view === 0 && g.alive && g.survivalLike ? 1 : 0;
    const act = $('action');
    if (g.mode === 'spectator') { act.textContent = 'Spectator mode — fly through blocks · scroll to change speed · /gamemode to leave'; act.style.opacity = this.specHintT === undefined || this.specHintT > 0 ? 1 : 0; this.specHintT = (this.specHintT ?? 6) - dt; }
    else if (this.actionT > 0) { this.actionT -= dt; act.textContent = this.actionText; act.style.opacity = Math.min(1, this.actionT); this.specHintT = undefined; }
    else { act.style.opacity = 0; this.specHintT = undefined; }
    this.sound.updateMusic(dt, g.dim === DIM.NETHER ? 'nether' : g.dim === DIM.END ? 'end' : p.pos[1] < 50 && g.world.lightAt(p.pos[0], p.pos[1] + 1, p.pos[2]).sky < 8 ? 'cave' : g.mode === 'creative' && g.isDay() ? 'creative' : g.isDay() ? 'day' : 'night');
    if (this.debug) {
      this.debugT = (this.debugT || 0) - dt;
      if (this.debugT <= 0) {
        this.debugT = 0.25;
        const pos = p.pos, t = this.interact.target;
        const l = g.world.lightAt(pos[0], pos[1] + 1, pos[2]);
        const b = BIOMES[g.world.biomeAt(pos[0], pos[2])];
        const facing = ['south (+Z)', 'west (-X)', 'north (-Z)', 'east (+X)'][((Math.round(-p.yaw / (Math.PI / 2)) % 4) + 6) % 4];
        const hours = Math.floor((g.dayTime * 24 + 6) % 24), mins = Math.floor((g.dayTime * 1440) % 60);
        $('debug').textContent = `Blockhaven  ${this.fps} fps  (${Math.round(this.renderScale * 100)}% res)\n` +
          `XYZ: ${pos[0].toFixed(2)} / ${pos[1].toFixed(2)} / ${pos[2].toFixed(2)}   Facing: ${facing}\n` +
          `Chunk: ${Math.floor(pos[0] / 16)} ${Math.floor(pos[2] / 16)}   Biome: ${b ? b.name : '?'}   Dimension: ${DIM_NAMES[g.dim]}\n` +
          `Light: sky ${l.sky} block ${l.blk}   Day ${g.day + 1} ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}   ${g.weather.rain > 0.5 ? (g.weather.thunder > 0.5 ? 'Thunder' : 'Rain') : 'Clear'}\n` +
          `Chunks: ${g.world.chunks.size} loaded, ${this.renderer.stats.chunks} drawn   Quads: ${this.renderer.stats.quads.toLocaleString()}   Entities: ${g.entities.list.length}\n` +
          `Mode: ${g.mode}${g.hardcore ? ' (hardcore)' : ''}   Difficulty: ${g.difficulty}   Seed: ${g.seed}` +
          (t ? `\nTarget: ${props(t.id, t.meta).name} @ ${t.x} ${t.y} ${t.z}` : this.interact.entityTarget ? `\nTarget: ${this.interact.entityTarget.displayName || this.interact.entityTarget.type} (${Math.ceil(this.interact.entityTarget.health || 0)} HP)` : '');
      }
    }
  }
}

const app = new App();
window.blockhaven = app;
if (app.init()) app.setMode('title');
