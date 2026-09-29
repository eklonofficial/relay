// Blockhaven bootstrap: assets, menus, input, camera, frame loop.
import { TEXTURES, TEX, B, BLOCKS, DIM, DIM_NAMES, SHAPE_OF, SHAPE, props } from './data/blocks.js';
import { I, ITEMS } from './data/items.js';
import { MOBS, PROFESSIONS, playerModel } from './data/mobs.js';
import { BIOMES } from './gen/biomes.js';
import { generateBlockTextures } from './render/blocktex.js';
import { generateItemTextures, ITEM_LAYER, FX_LAYER, ITEM_LAYER_COUNT } from './render/itemtex.js';
import { packModel, paintModel, SKIN } from './render/mobtex.js';
import { buildMipChain } from './render/atlas.js';
import { Renderer, Batch } from './render/renderer.js';
import { World, UNLOADED } from './world/world.js';
import { createGenerator } from './gen/index.js';
import { Game } from './game/game.js';
import { Interact } from './game/interact.js';
import { Commands } from './game/commands.js';
import { GUI, HUD } from './game/ui.js';
import { buildIcons, hudSprites } from './game/icons.js';
import { Sound } from './game/audio.js';
import { computeEnv } from './game/env.js';
import { listWorlds, loadWorld, saveWorld, deleteWorld } from './game/storage.js';
import { drawModel, rootMatrix, M } from './entity/entity.js';
import { itemMesh, emitItemMesh } from './entity/itemmesh.js';
import { Lightning } from './entity/objects.js';
import { compose, translation, rotationX, rotationY, rotationZ, scaling, forward, mat4 } from './core/math.js';

const $ = id => document.getElementById(id);
const SETTINGS_KEY = 'blockhaven.settings.v2';
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
// Low-end machines (Chromebooks, 4-core / 4 GB devices) get lighter defaults; visuals stay the same.
const LOW_END = /CrOS/.test(navigator.userAgent) || (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency || 8) <= 4;
const settings = Object.assign({
  renderDistance: LOW_END ? 6 : 8, fov: 75, sensitivity: 100, brightness: 50, volume: 60, music: 40,
  bobbing: true, clouds: true, autoJump: true, particles: true, msaa: !LOW_END, dynamicRes: true,
}, load(SETTINGS_KEY) || {});
const SPLASHES = ['Now with the Nether!', 'Also try the End!', 'Creepers included!', '60 mobs!', 'Villagers will trade!', 'Wild worlds are wild!', 'Every pixel procedural!', 'Craft everything!', 'Spectator mode!', 'Runs on Chromebooks!', 'Mind the lava!', 'Floating islands!'];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hashSeed(text) {
  const t = text.trim();
  if (!t) return (Math.random() * 2147483647) | 0;
  if (/^-?\d+$/.test(t)) return Number(t) | 0;
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 33) + t.charCodeAt(i)) | 0;
  return h;
}

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
    try { this.renderer = new Renderer($('game')); } catch (e) { this.fatal(`Blockhaven needs WebGL 2, which this browser or device doesn't provide. (${e.message})`); return false; }
    if (!settings.msaa) this.renderer.samples = 0;
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
    addSkin('player', playerModel(), 777);
    this.renderer.setEntityTextures(buildMipChain(skins, SKIN, 7), skins.length);
    this.icons = buildIcons(this.blockTex, this.itemTex);
    this.sprites = hudSprites();
    this.sound = new Sound();
    this.sound.volume = settings.volume / 100; this.sound.music = settings.music / 100;
    this.batches = { mobs: new Batch(), items: new Batch(), itemFx: new Batch(), blockParticles: new Batch(), hand: new Batch() };
    this.bindSettings(); this.bindMenus(); this.bindInput();
    $('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
    this.startPanorama();
    requestAnimationFrame(t => this.frame(t));
    return true;
  }
  fatal(msg) { $('title').classList.add('hidden'); $('error').classList.remove('hidden'); $('error').textContent = msg; }

  // ---------------- asset lookups used by the game ----------------
  itemLayer(key) { return ITEM_LAYER[key] ?? FX_LAYER.blank; }
  itemPixels(key) { const l = ITEM_LAYER[key]; return l === undefined ? this.itemTex[FX_LAYER.blank] : this.itemTex[l]; }
  fxLayer(name) { return FX_LAYER[name] ?? FX_LAYER.blank; }
  mobModel(key) { return this.mobModels.get(key) || this.mobModels.get('pig'); }
  mobLayer(key) { return this.mobLayers.get(key) ?? 0; }
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
    this.panorama.pos = [s.x, s.y + 18, s.z];
    this.panoWorld = new World({ seed: 1337, dim: 0, worldType: 'default', callbacks: { onMesh: (c, m) => this.renderer.uploadChunk(c, m), onUnload: c => this.renderer.freeChunk(c) } });
  }
  stopPanorama() { if (this.panoWorld) { this.panoWorld.dispose(); this.panoWorld = null; } }

  // ---------------- menus ----------------
  setMode(m) {
    this.mode = m;
    for (const id of ['title', 'worlds', 'create', 'loading', 'pause', 'death']) $(id).classList.toggle('hidden', id !== m);
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
    $('loading-label').textContent = meta.dims ? 'Loading world…' : 'Generating world…';
    this.loadingFor = 0;
    this.requestLock();
    this.chat(`Welcome to ${meta.name}! Press T or / for chat and commands (try /help).`, '#aaaaaa');
    this.saveT = 0;
    $('hint').style.opacity = 1; this.hintT = 12;
  }
  onWorldOpened() {}
  onDimensionChange(dim) {
    this.setMode('loading');
    $('loading-label').textContent = dim === DIM.NETHER ? 'Entering the Nether…' : dim === DIM.END ? 'Entering the End…' : 'Returning to the Overworld…';
  }
  async saveGame(quiet = true) {
    if (!this.game || !this.game.world) return;
    const data = this.game.serialize();
    if (this.thumbNext) data.thumb = this.thumbNext;
    try { await saveWorld(data); if (!quiet) this.chat('Game saved', '#aaaaaa'); } catch (e) { console.warn('save failed', e); }
  }
  async quitToTitle() {
    await this.saveGame();
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
  summonLightning(x, y, z) { this.game.entities.add(new Lightning(this.game, x, y, z)); }
  hurtFlash() { this.post.hurt = 1; this.shakeAmt = Math.max(this.shakeAmt, 0.35); }
  flash(v) { this.post.flash = Math.max(this.post.flash, v); }
  shake(v) { this.shakeAmt = Math.max(this.shakeAmt, v); }
  sleep(done) { this.sleeping = { t: 0, done }; }
  onGuiOpen() { this.setMode('gui'); this.suppressPause = true; document.exitPointerLock(); }
  onGuiClose() { this.setMode('play'); this.requestLock(); }

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

  requestLock() { const r = $('game').requestPointerLock(); if (r && r.catch) r.catch(() => {}); }

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
    bind('set-vol', 'volume', 'vol-val', () => this.sound.setVolume(settings.volume / 100));
    bind('set-music', 'music', 'music-val', () => this.sound.setMusic(settings.music / 100));
    for (const [id, k] of [['set-bob', 'bobbing'], ['set-clouds', 'clouds'], ['set-autojump', 'autoJump'], ['set-particles', 'particles'], ['set-msaa', 'msaa']]) {
      $(id).checked = settings[k];
      $(id).addEventListener('change', () => { settings[k] = $(id).checked; if (this.game) this.game.player.autoJump = settings.autoJump; });
    }
  }
  bindMenus() {
    const click = (id, fn) => $(id).addEventListener('click', () => { this.sound.unlock(); this.sound.click(); fn(); });
    click('btn-play', () => this.showWorlds());
    click('btn-world-back', () => this.setMode('title'));
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
    click('btn-controls', () => this.openPanel('controls'));
    click('btn-controls2', () => this.openPanel('controls'));
    click('btn-controls-done', () => $('controls').classList.add('hidden'));
    click('btn-resume', () => this.requestLock());
    click('btn-quit', () => this.quitToTitle());
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
      if (this.locked) { if (this.mode === 'pause') this.setMode('play'); }
      else if (this.mode === 'play' && !this.suppressPause) { this.setMode('pause'); this.saveGame(); }
      this.suppressPause = false;
    });
    canvas.addEventListener('click', () => { if ((this.mode === 'play' || this.mode === 'loading') && !this.locked) this.requestLock(); });
    document.addEventListener('mousemove', e => {
      if (!this.locked || this.mode !== 'play' || !this.game) return;
      const s = settings.sensitivity / 100 * 0.0022, p = this.game.player;
      p.yaw -= e.movementX * s;
      p.pitch = Math.max(-1.56, Math.min(1.56, p.pitch - e.movementY * s));
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
    document.addEventListener('keyup', e => this.keys.delete(e.code));
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
        if (v) { this.chatHistory.push(v); if (v.startsWith('/')) this.commands.run(v); else this.chat(`<Player> ${v}`); }
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
    g.invDirty = true;
    this.interact.equip = 1;
    const s = g.inv.held;
    $('item-name').textContent = s ? I[s.key].name : '';
    $('item-name').style.opacity = s ? 1 : 0;
    this.nameT = 2;
  }
  keyDown(e) {
    if (e.target.tagName === 'INPUT' && e.target.id !== 'chat-input') return;
    if (['Space', 'F1', 'F3', 'F5', 'Tab', 'Slash', 'Quote'].includes(e.code) || (e.ctrlKey && ['KeyW', 'KeyD', 'KeyS', 'KeyQ'].includes(e.code))) e.preventDefault();
    if (this.mode === 'gui') { if (this.gui.key(e)) e.preventDefault(); return; }
    const g = this.game;
    if (this.mode !== 'play' || !g) return;
    this.keys.add(e.code);
    if (/^Digit[1-9]$/.test(e.code)) this.select(Number(e.code.slice(5)) - 1);
    if (e.code === 'Space' && !e.repeat) g.player.jumpPressed(this.time);
    if (e.code === 'KeyE' && g.mode !== 'spectator' && g.alive) this.gui.openInventory();
    if (e.code === 'KeyT' && !e.repeat) { e.preventDefault(); this.openChat(''); }
    if (e.code === 'Slash' && !e.repeat) { e.preventDefault(); this.openChat('/'); }
    if (e.code === 'KeyQ' && g.inv.held && g.mode !== 'spectator') { const s = g.inv.held, n = e.ctrlKey ? s.count : 1; g.dropStack({ ...s, count: n }); g.inv.consumeHeld(n); }
    if (e.code === 'KeyF' && g.mode !== 'spectator') { const a = g.inv.held, b = g.inv.offhand.get(0); g.inv.setHeld(b); g.inv.offhand.set(0, a); }
    if (e.code === 'F1') { this.hudHidden = !this.hudHidden; $('hud').classList.toggle('hidden', this.hudHidden); }
    if (e.code === 'F3') { this.debug = !this.debug; $('debug').classList.toggle('hidden', !this.debug); }
    if (e.code === 'F5') this.view = (this.view + 1) % 3;
    if (e.code === 'F4' && g.cheats) this.setGameMode(g.mode === 'spectator' ? 'creative' : 'spectator');
  }

  // ---------------- camera ----------------
  camera(dt) {
    const g = this.game, p = g.player;
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
    this.frames++; this.fpsT += realDt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
    this.adaptResolution(realDt);
    const dpr = Math.min(window.devicePixelRatio || 1, LOW_END ? 1 : 2) * this.renderScale;
    this.renderer.resize(Math.floor(window.innerWidth * dpr), Math.floor(window.innerHeight * dpr));
    if (!this.game) { this.framePanorama(dt); return; }
    this.frameGame(dt);
  }
  // Dynamic resolution keeps the frame rate smooth on slow GPUs, only touching resolution when truly needed.
  adaptResolution(realDt) {
    if (!settings.dynamicRes) { this.renderScale = 1; return; }
    this.frameTimes.push(realDt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 1 / 40 && this.renderScale > 0.7) this.renderScale = Math.max(0.7, this.renderScale - 0.1);
    else if (avg < 1 / 57 && this.renderScale < 1) this.renderScale = Math.min(1, this.renderScale + 0.05);
  }
  framePanorama(dt) {
    const pano = this.panorama;
    if (!pano || !this.panoWorld) return;
    pano.yaw += dt * 0.04;
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
        this.setMode(this.locked ? 'play' : 'pause');
        this.setGameMode(g.mode);
      }
    }
    const playing = this.mode === 'play' || this.mode === 'gui' || this.mode === 'chat' || this.mode === 'death';
    if (playing && this.mode !== 'pause') {
      const input = {
        forward: this.keys.has('KeyW'), back: this.keys.has('KeyS'), left: this.keys.has('KeyA'), right: this.keys.has('KeyD'),
        jump: this.keys.has('Space'), sneak: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'), sprint: this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyR'),
      };
      if (this.mode !== 'play') for (const k of Object.keys(input)) input[k] = false;
      if (g.alive) {
        if (g.mode === 'spectator') p.speedMul = this.specSpeed || 1;
        p.update(dt, input);
      }
      g.update(dt);
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
    this.render(dt);
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
    const fovTarget = settings.fov + (p.sprinting ? (p.flying ? 14 : 9) : 0) - (medium === 1 ? 6 : 0) - (this.interact.using === 'bow' ? Math.min(1, this.interact.useT) * 12 : 0);
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
    if (this.wantThumb) { this.wantThumb = false; }
  }

  drawPlayerModel(ctx) {
    const g = this.game, p = g.player;
    const model = this.mobModel('player'), layer = this.mobLayer('player');
    const sw = Math.sin(p.bobPhase * 1.6) * 0.9 * p.bobAmount;
    const swing = Math.sin(this.interact.swing * Math.PI) * 1.4;
    const poses = { head: [p.pitch, 0, 0], rightLeg: [sw, 0, 0], leftLeg: [-sw, 0, 0], rightArm: [-sw * 0.8 + swing, 0, 0], leftArm: [sw * 0.8, 0, 0] };
    const light = g.world.lightAt(p.pos[0], p.pos[1] + 1, p.pos[2]);
    const b = Math.max(Math.pow(0.8, 15 - light.sky) * g.env.skyLight[0], Math.pow(0.82, 15 - light.blk), g.env.ambient[0]);
    const sneak = p.sneaking ? M.chain(M.t(0, -2, 0), M.rx(0)) : null;
    const mats = drawModel(ctx.mobs, model, layer, rootMatrix(p.pos, p.yaw, 1, sneak), poses, [b, b, b], this.post.hurt > 0.5 ? 0.6 : 0);
    const held = g.inv.held;
    if (held && mats.rightArm) this.renderItemAt(ctx, held.key, M.chain(mats.rightArm, M.t(-3, -10, -1), M.rx(-Math.PI / 2), M.s(10)), [b, b, b]);
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
  buildHand(dt, cam) {
    const g = this.game, p = g.player, it = this.interact;
    const swing = Math.sin((1 - it.swing) * Math.PI) * (it.swing > 0 ? 1 : 0);
    const bob = settings.bobbing ? p.bobAmount : 0, ph = p.bobPhase;
    let dyaw = p.yaw - this.bobLast[0];
    if (dyaw > Math.PI) dyaw -= Math.PI * 2; else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.swayX = (this.swayX || 0) + (Math.max(-0.2, Math.min(0.2, dyaw * 2.5)) - (this.swayX || 0)) * Math.min(1, dt * 10);
    this.swayY = (this.swayY || 0) + (Math.max(-0.2, Math.min(0.2, (p.pitch - this.bobLast[1]) * 2.5)) - (this.swayY || 0)) * Math.min(1, dt * 10);
    this.bobLast = [p.yaw, p.pitch];
    const drop = Math.sin(it.equip * Math.PI / 2) * 0.55;
    const ox = 0.56 + Math.sin(ph) * 0.03 * bob + this.swayX * 0.35 - swing * 0.2;
    const oy = -0.52 - Math.abs(Math.cos(ph)) * 0.035 * bob - drop + this.swayY * 0.25 + swing * 0.12;
    const oz = -0.9 - swing * 0.12;
    const l = g.world.lightAt(p.pos[0], p.pos[1] + 1.6, p.pos[2]);
    const light = Math.max(Math.pow(0.8, 15 - l.sky) * g.env.skyLight[0], Math.pow(0.82, 15 - l.blk), g.env.ambient[0] + 0.05);
    const held = g.inv.held, item = held && I[held.key];
    const using = it.using;
    const eatBob = using === 'eat' ? Math.sin(it.useT * 18) * 0.04 : 0;
    const batch = this.batches.hand;
    batch.reset();
    if (item && item.block && !item.flat) {
      const m = compose(translation(ox - (using ? 0.25 : 0), oy + eatBob + (using === 'eat' ? 0.25 : 0), oz), rotationY(-0.78 + swing * 0.5), rotationX(0.1 - swing * 0.9), rotationZ(0.04 + swing * 0.2), scaling(0.4, 0.4, 0.4), translation(-0.5, -0.5, -0.5));
      return { block: { id: item.block[0], meta: item.block[1], matrix: m }, light };
    }
    if (item) {
      let m;
      if (using === 'bow' || using === 'crossbow') {
        const pull = Math.min(1, it.useT);
        const key = using === 'bow' ? (pull > 0.9 ? 'bow_pulling_2' : pull > 0.5 ? 'bow_pulling_1' : 'bow_pulling_0') : 'crossbow';
        m = M.chain(M.t(0.15, -0.35, -0.6 + pull * 0.05), M.ry(-0.15), M.rz(0.8), M.s(0.7), M.t(-0.5, -0.5, 0));
        emitItemMesh(batch, itemMesh(key, this.itemTex[FX_LAYER[key] ?? ITEM_LAYER.bow]), FX_LAYER[key] ?? ITEM_LAYER[held.key], m, [light, light, light]);
        return { batch, batchTex: 'item', light };
      }
      if (using === 'eat') m = M.chain(M.t(0.1, -0.35 + eatBob, -0.55), M.ry(0.9), M.s(0.5), M.t(-0.5, -0.5, 0));
      else if (using === 'shield') m = M.chain(M.t(0.25, -0.4, -0.6), M.ry(-0.3), M.s(0.8), M.t(-0.5, -0.5, 0));
      else m = M.chain(M.t(ox, oy + 0.05, oz + 0.1), M.ry(-1.15 + swing * 0.4), M.rx(swing * -0.9), M.rz(0.1 + swing * 0.3), M.s(0.62), M.t(-0.3, -0.25, 0));
      emitItemMesh(batch, itemMesh(held.key, this.itemPixels(held.key)), this.itemLayer(held.key), m, [light, light, light]);
      return { batch, batchTex: 'item', light };
    }
    // Empty hand: the player's arm.
    const model = this.mobModel('player'), arm = { tex: model.tex, parts: { rightArm: { pivot: [0, 0, 0], boxes: model.parts.rightArm.boxes } } };
    const root = M.chain(M.t(ox + 0.1, oy - 0.05, oz + 0.2), M.ry(-0.35 + swing * 0.3), M.rx(1.5 - swing * 0.9 + this.swayY), M.rz(-0.25), M.s(1 / 16 * 0.9));
    drawModel(batch, arm, this.mobLayer('player'), root, {}, [light, light, light], 0);
    return { batch, batchTex: 'mob', light };
  }

  updateHud(dt) {
    const g = this.game, p = g.player;
    if (g.invDirty) { this.hud.renderHotbar(); g.invDirty = false; }
    this.hud.update(dt);
    for (const c of this.chatLines) { c.t -= dt; c.el.style.opacity = Math.min(1, Math.max(0, c.t)); }
    if (this.nameT > 0) { this.nameT -= dt; if (this.nameT <= 0) $('item-name').style.opacity = 0; }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) $('hint').style.opacity = 0; }
    const boss = $('boss');
    boss.classList.toggle('hidden', !g.bossBar);
    if (g.bossBar) { boss.querySelector('.n').textContent = g.bossBar.name; boss.querySelector('.b div').style.width = `${g.bossBar.frac * 100}%`; }
    const act = $('action');
    if (g.mode === 'spectator') { act.textContent = 'Spectator mode — fly through blocks · scroll to change speed · /gamemode to leave'; act.style.opacity = this.specHintT === undefined || this.specHintT > 0 ? 1 : 0; this.specHintT = (this.specHintT ?? 6) - dt; }
    else { act.style.opacity = 0; this.specHintT = undefined; }
    this.sound.updateMusic(dt, g.dim === DIM.NETHER ? 'nether' : g.dim === DIM.END ? 'end' : p.pos[1] < 50 ? 'cave' : g.isDay() ? 'day' : 'night');
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
