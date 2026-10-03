// Blockhaven bootstrap: assets, menus, input, camera, frame loop.
import './page.js?v=mush3vnf';
import { surfaceDocument as document } from './surface.js?v=mush3vnf';
import { registerApp } from './veil.js?v=mush3vnf';
import { movementSamples } from './util/pointer.js?v=mush3vnf';
import { ask, tell } from './dialog.js?v=mush3vnf';
import { Demo, DEMO_SEED } from './demo.js?v=mush3vnf';
import { armorLayerModel, armorLayer, ARMOR_MATERIALS, LEATHER_COLOR, elytraModel } from './data/armor.js?v=mush3vnf';
import { humanoidPose, processSkin } from './entity/humanoid.js?v=mush3vnf';
import { TEXTURES, TEX, B, BLOCKS, DIM, DIM_NAMES, SHAPE_OF, SHAPE, props, HEIGHT } from './data/blocks.js?v=mush3vnf';
import { I, ITEMS } from './data/items.js?v=mush3vnf';
import { MOBS, PROFESSIONS, playerModel, saddleModel, PLAYER_SKINS } from './data/mobs.js?v=mush3vnf';
import { Net, cleanCode, cleanName, cleanKey, cleanChat, chatLine, MAX_PLAYERS, wakeRelays, diagnoseNetwork } from './net/net.js?v=mush3vnf';
import { NameTags } from './net/nametags.js?v=mush3vnf';
import { BIOMES } from './gen/biomes.js?v=mush3vnf';
import { generateBlockTextures, drawBlockTexture } from './render/blocktex.js?v=mush3vnf';
import { generateItemTextures, ITEM_LAYER, FX_LAYER, ITEM_LAYER_COUNT, flatTexFor } from './render/itemtex.js?v=mush3vnf';
import { Zip, storedPack, savePack, removePack, applyBlockTextures, applyItemTextures, applyArmorTextures, readEntityTexture, indexSounds } from './render/pack.js?v=mush3vnf';
import { packModel, paintModel, ENTITY, texFactor, faceRects } from './render/mobtex.js?v=mush3vnf';
import { buildMipChain } from './render/atlas.js?v=mush3vnf';
import { Renderer, Batch } from './render/renderer.js?v=mush3vnf';
import { World, UNLOADED } from './world/world.js?v=mush3vnf';
import { createGenerator } from './gen/index.js?v=mush3vnf';
import { Game } from './game/game.js?v=mush3vnf';
import { Interact, crossbowCharge } from './game/interact.js?v=mush3vnf';
import { SpawnPrep, STATUS_COLOR } from './game/spawnprep.js?v=mush3vnf';
import { splash } from './splash.js?v=mush3vnf';
import { Commands } from './game/commands.js?v=mush3vnf';
import { GUI, HUD } from './game/ui.js?v=mush3vnf';
import { buildIcons, hudSprites } from './game/icons.js?v=mush3vnf';
import { Sound } from './game/audio.js?v=mush3vnf';
import { buildLogo, buttonTexture, dirtTexture, iconDataURL } from './render/logo.js?v=mush3vnf';
import { computeEnv } from './game/env.js?v=mush3vnf';
import { guideSections } from './game/guide.js?v=mush3vnf';
import { listWorlds, loadWorld, saveWorld, deleteWorld } from './game/storage.js?v=mush3vnf';
import { importJavaWorld, exportJavaWorld } from './game/javaworld.js?v=mush3vnf';
import { drawModel, rootMatrix, M } from './entity/entity.js?v=mush3vnf';
import { itemMesh, emitItemMesh, clearItemMeshes } from './entity/itemmesh.js?v=mush3vnf';
import { Lightning, billboard } from './entity/objects.js?v=mush3vnf';
import { compose, translation, rotationX, rotationY, rotationZ, scaling, forward, mat4 } from './core/math.js?v=mush3vnf';
import { hasGlint } from './data/enchantments.js?v=mush3vnf';
import { BarrelRoll } from './game/barrelroll.js?v=mush3vnf';

const $ = id => document.getElementById(id);
// Resolves after the page has painted what was just put on screen.
const nextPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const SETTINGS_KEY = 'blockhaven.settings.v2';
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
// Low-end machines (Chromebooks, 4-core / 4 GB devices) get lighter defaults; visuals stay the same.
const LOW_END = /CrOS/.test(navigator.userAgent) || (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency || 8) <= 4;
const settings = Object.assign({
  renderDistance: LOW_END ? 6 : 8, fov: 70, sensitivity: 100, brightness: 50, volume: 60, music: 40,
  bobbing: true, clouds: true, autoJump: true, particles: true, dynamicRes: true, barrelRoll: true, barrelRollYaw: false, graphics: LOW_END ? 1 : 2, rawInput: true, lowLatency: !LOW_END,
}, load(SETTINGS_KEY) || {});
// Minecraft's default FOV is 70; move anyone still on our old default (75) over once.
if (!settings.fovMigrated) { if (settings.fov === 75) settings.fov = 70; settings.fovMigrated = true; store(SETTINGS_KEY, settings); }
const SPLASHES = ['Random ahh edition!', 'Also try Minecraft!', 'Now with elytra!', 'Saddle up!', 'Now with the Nether!', 'Also try the End!', 'Creepers included!', '60 mobs!', 'Villagers will trade!', 'Wild worlds are wild!', 'Custom pixels!', 'Craft everything!', 'Spectator mode!', 'Runs on Chromebooks!', 'Mind the lava!', 'Floating islands!'];

// What an uploaded world may say about itself (the create screen's choices, plus /gamemode's).
const WORLD_MODES = ['survival', 'creative', 'hardcore', 'adventure', 'spectator'], WORLD_TYPES = ['default', 'wild', 'flat'], DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
// Checks an uploaded save and fills in safe defaults; throws with a readable reason if it can't be used.
function checkWorld(w) {
  const bad = why => { throw new Error(`That file is not a Blockhaven world (${why}).`); };
  if (!isObj(w) || typeof w.seed !== 'number' || !Number.isFinite(w.seed)) bad('no seed');
  const pick = (k, list, def) => { if (w[k] === undefined || w[k] === null) w[k] = def; else if (!list.includes(w[k])) bad(`unknown ${k} "${String(w[k]).slice(0, 20)}"`); };
  pick('mode', WORLD_MODES, 'survival'); pick('type', WORLD_TYPES, 'default'); pick('difficulty', DIFFICULTIES, 'normal');
  if (w.dims !== undefined && (!isObj(w.dims) || Object.values(w.dims).some(d => d !== null && !isObj(d)))) bad('broken dimensions');
  w.name = (typeof w.name === 'string' ? w.name.trim().slice(0, 32).trim() : '') || 'Uploaded World';
  if (typeof w.seedText !== 'string') w.seedText = String(w.seed);
  w.day = Number.isFinite(w.day) && w.day >= 0 ? Math.floor(w.day) : 0;
  if (w.time !== undefined && !Number.isFinite(w.time)) delete w.time;
  w.cheats = w.cheats !== false; w.hardcore = w.mode === 'hardcore' || w.hardcore === true;
  for (const k of ['rules', 'players', 'weather', 'stats']) if (w[k] !== undefined && !isObj(w[k])) delete w[k];
  if (w.palette !== undefined && !Array.isArray(w.palette)) delete w.palette;
  if (typeof w.thumb !== 'string' || !w.thumb.startsWith('data:image/')) delete w.thumb;
  delete w.demo; delete w.guest; // an upload is always a normal, saved, hostable world
  return w;
}
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

// ---------------- Minecraft-style widgets ----------------
// Slider: wraps a range input in a button-like track with the label centred and an 8x20 handle;
// the (invisible) input keeps handling the mouse, keyboard and 'input' events. Returns a refresh().
function slider(id, label, fmt = v => v) {
  const el = $(id), wrap = document.createElement('div'), lab = document.createElement('span'), knob = document.createElement('span');
  wrap.className = 'slider'; lab.className = 'lab'; knob.className = 'knob';
  el.replaceWith(wrap); wrap.append(el, lab, knob);
  const refresh = () => { const v = Number(el.value); wrap.style.setProperty('--p', (v - el.min) / (el.max - el.min)); lab.textContent = `${label}: ${fmt(v)}`; };
  el.addEventListener('input', refresh); refresh();
  return refresh;
}
// Cycle button ("Difficulty: Normal"): each click moves to the next of opts = [[value, text], ...].
function cycle(btn, label, opts, get, set) {
  const draw = () => { const o = opts.find(o => o[0] === get()) || opts[0]; btn.textContent = `${label}: ${o[1]}`; };
  btn.addEventListener('click', () => { const i = opts.findIndex(o => o[0] === get()); set(opts[(i + 1) % opts.length][0]); draw(); });
  draw(); return draw;
}
const toggle = (btn, label, get, set) => cycle(btn, label, [[true, 'ON'], [false, 'OFF']], get, set);

class App {
  constructor() {
    this.settings = settings;
    this.mode = 'title';
    this.keys = new Set();
    this.dabr = new BarrelRoll();
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
    // The splash (splash.js) counted the module downloads up to 0.3; the rest of startup reports here.
    splash.progress(0.3);
    // Menu textures first, so even the error screen has its dirt background.
    const css = document.documentElement.style;
    css.setProperty('--btn-tex', `url(${buttonTexture()})`); css.setProperty('--dirt-tex', `url(${dirtTexture(drawBlockTexture('dirt', 1))})`);
    try { this.renderer = new Renderer($('game'), { lowLatency: settings.lowLatency }); } catch (e) { this.fatal(/WebGL 2 is not available/.test(e.message) ? 'Blockhaven needs WebGL 2, which this browser or device does not provide.' : `Graphics startup failed: ${e.message.split('\n')[0]}`); return false; }
    this.applyGraphics();
    // Textures.
    this.blockTex = generateBlockTextures();
    this.renderer.setBlockTextures(buildMipChain(this.blockTex), TEXTURES.length);
    splash.progress(0.4);
    this.itemTex = generateItemTextures();
    this.renderer.setItemTextures(buildMipChain(this.itemTex), this.itemTex.length);
    splash.progress(0.45);
    // Mob skins (one 64x64 layer per mob, villager profession and the player).
    this.mobModels = new Map(); this.mobLayers = new Map();
    const skins = [];
    const addSkin = (key, model, seed) => { if (!model.java) packModel(model); this.mobModels.set(key, model); this.mobLayers.set(key, skins.length); skins.push(paintModel(model, seed)); };
    let seed = 1;
    for (const [k, d] of Object.entries(MOBS)) addSkin(k, d.model(), seed++);
    for (const p of PROFESSIONS) addSkin(`villager_${p}`, MOBS.villager.professionModel(p), seed++);
    PLAYER_SKINS.forEach((_, i) => addSkin(`player_${i}`, playerModel(i), 777 + i * 31));
    // The player's own Minecraft skin (Options > Skin), shown as the first default until one is loaded.
    addSkin('player_custom', playerModel(0), 777);
    this.mobModels.set('player_wide', playerModel(0)); this.mobModels.set('player_slim', playerModel(0, true));
    this.skinPixels = skins;
    addSkin('saddle', saddleModel(), 778);
    addSkin('elytra', elytraModel(), 779);
    // Two armor layers per material, as Java's textures/models/armor/<material>_layer_1 and _2.
    for (const mat of Object.keys(ARMOR_MATERIALS)) for (const l of [1, 2]) addSkin(`armor_${mat}_${l}`, armorLayerModel(mat, l), seed++);
    this.mobModels.set('armor_outer', this.mobModels.get('armor_iron_1')); this.mobModels.set('armor_inner', this.mobModels.get('armor_iron_2'));
    // Second skins drawn over some mobs (the stray's clothes, the drowned's outer layer).
    for (const [k, d] of Object.entries(MOBS)) if (d.overlay) addSkin(`${k}_overlay`, d.overlay(), seed++);
    // Skins a mob wears in some states, painted like its own (the wolf's tame and angry looks).
    for (const [k, d] of Object.entries(MOBS)) for (const [v, texture] of Object.entries(d.variants || {})) addSkin(`${k}_${v}`, { ...d.model(), texture }, seed++);
    // Other models a mob switches to (the pufferfish puffing up).
    for (const [k, d] of Object.entries(MOBS)) for (const [v, f] of Object.entries(d.forms || {})) addSkin(`${k}_${v}`, f(), seed++);
    this.renderer.setEntityTextures(buildMipChain(skins, ENTITY, 8), skins.length);
    this.loadCustomSkin();
    splash.progress(0.6);
    this.icons = buildIcons(this.blockTex, this.itemTex);
    this.sprites = hudSprites();
    this.sound = new Sound();
    this.sound.volume = settings.volume / 100; this.sound.music = settings.music / 100;
    this.batches = { mobs: new Batch(), mobsClear: new Batch(), items: new Batch(), itemFx: new Batch(), blockParticles: new Batch(), hand: new Batch() };
    this.nametags = new NameTags($('nametags'));
    this.bindSettings(); this.bindMenus(); this.bindInput();
    $('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
    // Like Minecraft, the splash is scaled so it always spans about 100 GUI px (measured once the font is in).
    const fitSplash = () => { const el = $('splash'), w = el.offsetWidth / (this.guiScale || 3) / (Number(getComputedStyle(el).getPropertyValue('--splash-scale')) || 1); el.style.setProperty('--splash-scale', Math.min(1.5, 110 / (w + 16)).toFixed(2)); };
    fitSplash(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSplash);
    this.fontsReady = !document.fonts; if (document.fonts) document.fonts.ready.then(() => { this.fontsReady = true; });
    this.buildTitleArt();
    this.startPanorama();
    splash.progress(0.7);
    requestAnimationFrame(t => this.frame(t));
    return true;
  }
  buildTitleArt() {
    const logo = buildLogo('BLOCKHAVEN', 'RANDOM AHH EDITION');
    $('logo').prepend(logo);
    $('logo').style.setProperty('--logo-w', logo.width);
    $('full-icon').src = iconDataURL('full');
    this.applyMute();
  }
  applyMute() {
    this.sound.setVolume(settings.muted ? 0 : settings.volume / 100);
    if (this.sound.setMusic) this.sound.setMusic(settings.muted ? 0 : settings.music / 100);
    $('mute-icon').src = iconDataURL(settings.muted ? 'mute' : 'sound');
  }
  // Graphics presets: 0 Fast, 1 Regular, 2 High, 3 PC.
  applyGraphics() {
    const q = Number(settings.graphics);
    this.renderer.setQuality(q);
    // Render distance goes up to 32 chunks on the High and PC presets, 14 otherwise.
    const rdMax = q >= 2 ? 32 : 14, rd = $('set-rd');
    if (rd) { rd.max = rdMax; if (settings.renderDistance > rdMax) { settings.renderDistance = rdMax; rd.value = rdMax; rd.dispatchEvent(new Event('input')); } }
  }
  openGuide() {
    this.openPanel('guide');
    const secs = guideSections(this.icons), tabs = $('guide-tabs'), body = $('guide-body');
    tabs.textContent = '';
    const show = name => { body.innerHTML = secs[name]; body.scrollTop = 0; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === name)); };
    for (const name of Object.keys(secs)) { const b = document.createElement('button'); b.className = 'small'; b.textContent = name; b.addEventListener('click', () => { this.sound.click(); show(name); }); tabs.appendChild(b); }
    show(Object.keys(secs)[0]);
  }
  fatal(msg) { $('title').classList.add('hidden'); $('error').classList.remove('hidden'); $('error').textContent = msg; splash.ready(); }

  // ---------------- asset lookups used by the game ----------------
  itemLayer(key) { return ITEM_LAYER[key] ?? FX_LAYER.blank; }
  itemPixels(key) { const l = ITEM_LAYER[key]; return l === undefined ? this.itemTex[FX_LAYER.blank] : this.itemTex[l]; }
  fxLayer(name) { return FX_LAYER[name] ?? FX_LAYER.blank; }
  mobModel(key, optional = false) { return this.mobModels.get(key) || (optional ? null : this.mobModels.get('pig')); }
  mobLayer(key) { return this.mobLayers.get(key === 'player' ? (this.customSkin ? 'player_custom' : `player_${settings.skin | 0}`) : key) ?? 0; }
  // The local player's model: slim (Alex) arms for a skin chosen as slim, otherwise the classic ones.
  playerModelOf() { return this.mobModel(this.customSkin && settings.skinSlim ? 'player_slim' : 'player_wide'); }
  // A Minecraft skin from this computer (64x64, or a classic 64x32), kept in this browser's settings
  // as a data URL and turned into Java's layout (processSkin) for the player_custom layer.
  async loadCustomSkin() {
    this.customSkin = false;
    if (!settings.skinData || !settings.useSkin) return;
    try {
      // Decoded here rather than fetched: the page's connect-src does not cover data: URLs.
      const bin = atob(settings.skinData.slice(settings.skinData.indexOf(',') + 1)), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
      const skin = processSkin(new Uint8ClampedArray(x.getImageData(0, 0, bmp.width, bmp.height).data.buffer), bmp.width, bmp.height);
      const px = new Uint8ClampedArray(ENTITY * ENTITY * 4);
      for (let y = 0; y < 64; y++) px.set(skin.subarray(y * 256, y * 256 + 256), y * ENTITY * 4);
      const layer = this.mobLayers.get('player_custom');
      this.skinPixels[layer] = px;
      this.renderer.setEntityLayer(layer, px);
      this.customSkin = true;
    } catch (e) { console.warn('skin failed', e); }
  }
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
    document.body.classList.toggle('ingame', !!this.game); // in a world, menus overlay the game instead of dirt
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
    $('btn-world-play').disabled = $('btn-world-delete').disabled = $('btn-world-download').disabled = $('btn-world-java-export').disabled = true;
    if (!worlds.length) { const d = document.createElement('div'); d.className = 'empty-note'; d.textContent = 'No worlds yet — create one!'; list.appendChild(d); return; }
    for (const w of worlds) {
      // One damaged save must not hide the rest of the list.
      try {
        const e = document.createElement('div'); e.className = 'world-entry';
        const th = document.createElement('div'); th.className = 'thumb'; if (typeof w.thumb === 'string' && w.thumb.startsWith('data:image/')) th.style.backgroundImage = `url(${w.thumb})`;
        const info = document.createElement('div'); info.className = 'txt';
        const n = document.createElement('div'); n.className = 'name'; n.textContent = String(w.name || 'Untitled World');
        const i = document.createElement('div'), i2 = document.createElement('div'); i.className = i2.className = 'info';
        const mode = typeof w.mode === 'string' && w.mode ? w.mode : 'survival', day = Number.isFinite(w.day) ? w.day : 0;
        i.textContent = `(${new Date(w.lastPlayed || 0).toLocaleString()})`;
        i2.textContent = `${mode[0].toUpperCase() + mode.slice(1)} Mode, ${w.type === 'wild' ? 'Wild' : w.type === 'flat' ? 'Superflat' : 'Default'}, Day ${day + 1}`;
        info.append(n, i, i2); e.append(th, info);
        e.addEventListener('click', () => { list.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); e.classList.add('sel'); this.selectedWorld = w.id; $('btn-world-play').disabled = $('btn-world-delete').disabled = $('btn-world-download').disabled = $('btn-world-java-export').disabled = false; });
        e.addEventListener('dblclick', () => this.playWorld(w.id));
        list.appendChild(e);
      } catch (err) { console.warn('skipping broken world', w && w.id, err); }
    }
  }
  // Worlds travel as .bhworld files: the save as JSON, gzipped when the browser can.
  async downloadWorld(id) {
    const w = id && await loadWorld(id);
    if (!w) return;
    let blob = new Blob([JSON.stringify({ blockhaven: 1, world: w })], { type: 'application/json' });
    if (window.CompressionStream) blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(w.name || 'world').replace(/[^\w\- ]+/g, '').trim() || 'world'}.bhworld`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async uploadWorld(file) {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let text;
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        if (!window.DecompressionStream) throw new Error('This browser cannot open compressed worlds.');
        text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      } else text = new TextDecoder().decode(buf);
      const data = JSON.parse(text), w = checkWorld(data && (data.world || data));
      const existing = await listWorlds();
      // Never overwrite: an upload is always added as its own world.
      w.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      if (existing.some(e => e.name === w.name)) w.name = `${w.name} (uploaded)`;
      await saveWorld(w);
      this.showWorlds();
    } catch (e) { await tell(`Could not upload the world: ${e.message}`); }
  }
  // Java Edition worlds: a zipped world folder in, a zipped 1.20.1 world folder out.
  async importJava(file) {
    this.showLoading('message', 'Reading Java world...');
    try {
      const zip = await Zip.open(file);
      const meta = await importJavaWorld(zip, (p, text) => { $('load-msg').textContent = `${text} (${Math.round(p * 100)}%)`; }, {
        askBeyond: async () => await ask('What should be around the imported area?\n\nOK: generate new terrain, so the world goes on forever (it won\'t match the edges of the map).\nCancel: leave empty space around it, as maps are meant to be played.'),
      });
      const existing = await listWorlds();
      if (existing.some(e => e.name === meta.name)) meta.name = `${meta.name} (Java)`;
      await saveWorld(meta);
    } catch (e) { console.error(e); await tell(`Could not import the world: ${e.message}`); }
    this.showWorlds();
  }
  async exportJava(id) {
    const w = id && await loadWorld(id);
    if (!w) return;
    this.showLoading('message', 'Converting to Java Edition...');
    try {
      const { blob, name } = await exportJavaWorld(w, (p, text) => { $('load-msg').textContent = `${text} (${Math.round(p * 100)}%)`; });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) { console.error(e); await tell(`Could not export the world: ${e.message}`); }
    this.showWorlds();
  }
  async playWorld(id) {
    this.sound.unlock(); this.sound.click();
    this.showLoading('message', 'Reading world data...');
    const meta = await loadWorld(id);
    if (!meta) { this.showWorlds(); return; }
    // Java worlds imported before the "beyond the edges" choice existed: ask once.
    if (meta.java && meta.java.beyond === undefined) {
      meta.java.beyond = await ask('This world was imported from Java Edition.\n\nOK: generate new terrain around the imported area, so the world goes on forever (it won\'t match the edges of the map).\nCancel: leave empty space around it, as maps are meant to be played.') ? 'terrain' : 'void';
      await saveWorld(meta);
    }
    await nextPaint();
    this.startGame(meta);
  }
  async createWorld() {
    this.sound.unlock(); this.sound.click();
    const opt = k => $('create').querySelector(`[data-opt=${k}]`).dataset.v;
    const seedText = $('cw-seed').value;
    const meta = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: $('cw-name').value.trim() || 'New World', seed: hashSeed(seedText), seedText,
      mode: opt('mode'), type: opt('type'), difficulty: opt('difficulty'), cheats: opt('cheats') === 'on', created: Date.now(),
    };
    // Setting up the generator and finding spawn blocks the page for a moment: show why first.
    this.showLoading('message', 'Preparing for world creation...');
    await nextPaint();
    this.startGame(meta);
  }
  // Cinematic showcase: a real (unsaved) world driven by scripted camera shots.
  async startDemo() {
    try { this.startDemoInner(); } catch (e) {
      console.error(e); this.demo = null;
      await tell(`The demo couldn't start: ${e.message}\nTry refreshing the page (Ctrl+Shift+R).`);
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
    // A world of our own prepares its spawn area first, with the chunk map; joining someone else's
    // world (and the demo) only waits for the terrain, as joining a server does.
    const p = this.game.player;
    this.spawnPrep = meta.demo || meta.guest ? null : new SpawnPrep(this.game.world, Math.floor(p.pos[0] / 16), Math.floor(p.pos[2] / 16));
    if (this.spawnPrep) this.showLoading('map'); else this.showLoading('terrain', 'Loading terrain...');
    if (!meta.demo) this.requestLock();
    if (!meta.demo) this.chat(`Welcome to ${meta.name}! Press T or / for chat and commands (try /help).`, '#aaaaaa');
    this.saveT = 0;
    // The controls hint only appears briefly in brand-new worlds.
    this.hintUntil = meta.dims || meta.demo ? 0 : performance.now() + 10000;
    $('hint').style.opacity = meta.dims || meta.demo ? 0 : 1;
  }
  onWorldOpened() {}
  onDimensionChange() {
    if (this.demo) return;
    this.showLoading('terrain', 'Loading terrain...');
  }
  // Java Edition's loading screens (layouts in index.html): 'message' while a world is read or
  // prepared, 'map' while spawn is prepared, 'terrain' until the chunk under the player is ready.
  showLoading(kind, text = '') {
    this.setMode('loading');
    $('loading').dataset.kind = kind;
    $('load-msg').textContent = text;
    if (kind === 'map') { $('load-pct').textContent = '0%'; this.drawChunkMap(null); }
    this.loadingFor = 0;
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
    this.sound.setWind(0); this.dabr.stop(); this.wings = null;
    this.spawnPrep = null;
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
  // Random per-browser secret: the host ties our saved progress in its world to it, not just to our name.
  mpKey() {
    if (!cleanKey(settings.mpKey)) {
      const b = crypto.getRandomValues(new Uint8Array(24)), c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      settings.mpKey = Array.from(b, x => c[x & 63]).join(''); store(SETTINGS_KEY, settings);
    }
    return settings.mpKey;
  }
  saveMpSettings() {
    const n = cleanName($('mp-name').value);
    if (n) settings.mpName = n;
    store(SETTINGS_KEY, settings);
  }
  showMultiplayer(status = '', kind = '') {
    this.setMode('mp');
    wakeRelays();
    $('mp-name').value = this.mpName();
    this.renderSkinPicker();
    this.mpStatus(status, kind);
  }
  // Checks each way of connecting from this network and says whether multiplayer will work.
  async testConnection() {
    const out = $('mp-diag'), btn = $('btn-mp-test');
    btn.disabled = true; out.className = 'mp-status'; out.textContent = 'Testing this network…';
    const lines = [];
    const show = () => { out.textContent = lines.join('\n'); };
    try {
      const results = await diagnoseNetwork(r => { lines.push(`${r.ok ? 'OK  ' : 'NO  '} ${r.name}: ${r.detail}`); show(); });
      const relay = results.some(r => r.ok && /^Relay/.test(r.name)), room = results.some(r => r.ok && /^Room/.test(r.name)), direct = results.some(r => r.ok && /Direct/.test(r.name));
      lines.push('', relay || room
        ? `Multiplayer will work on this network${direct ? ', with direct connections (fastest)' : ', through a relay server'}.`
        : 'This network blocks every multiplayer server. Try another network (or a phone hotspot), or see MULTIPLAYER.md.');
      out.className = `mp-status ${relay || room ? 'ok' : 'err'}`;
      show();
    } catch (e) { out.textContent = `The test failed: ${e.message}`; out.className = 'mp-status err'; }
    btn.disabled = false;
  }
  mpStatus(text, kind = '') { const el = $('mp-status'); el.textContent = text; el.className = `mp-status ${kind}`; }
  // Front view of each default skin, cut out of the painted skin textures.
  renderSkinPicker() {
    const box = $('mp-skins');
    box.textContent = '';
    const pick = (label, key, on, select) => {
      const b = document.createElement('button');
      b.className = `mp-skin${on ? ' on' : ''}`;
      b.appendChild(this.skinPreview(key));
      const t = document.createElement('span'); t.textContent = label; b.appendChild(t);
      b.addEventListener('click', () => { this.sound.click(); select(); });
      box.appendChild(b);
    };
    PLAYER_SKINS.forEach(([label], i) => pick(label, `player_${i}`, !this.customSkin && (settings.skin | 0) === i, () => {
      settings.skin = i; settings.useSkin = false; store(SETTINGS_KEY, settings); this.loadCustomSkin().then(() => this.renderSkinPicker());
    }));
    // Your own skin: choosing it again (or before one is loaded) asks for the PNG.
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png'; file.hidden = true; box.appendChild(file);
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 64 * 1024) { this.mpStatus('That file is too big to be a skin.', 'err'); return; }
      const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });
      const prev = [settings.skinData, settings.useSkin];
      settings.skinData = data; settings.useSkin = true;
      await this.loadCustomSkin();
      if (!this.customSkin) { [settings.skinData, settings.useSkin] = prev; await this.loadCustomSkin(); this.mpStatus('That image is not a Minecraft skin (64x64 or 64x32 pixels).', 'err'); }
      else store(SETTINGS_KEY, settings);
      this.renderSkinPicker();
    });
    // Your own skin: a row under the defaults (use it, its arm width, load another).
    const row = document.createElement('div'); row.className = 'row'; box.appendChild(row);
    const btn = (text, on, fn) => { const b = document.createElement('button'); b.className = `small${on ? ' on' : ''}`; b.textContent = text; b.addEventListener('click', () => { this.sound.click(); fn(); }); row.appendChild(b); return b; };
    if (settings.skinData) btn(this.customSkin ? 'Your Skin ✓' : 'Your Skin', this.customSkin, () => { settings.useSkin = true; store(SETTINGS_KEY, settings); this.loadCustomSkin().then(() => this.renderSkinPicker()); });
    if (this.customSkin) btn(`Arms: ${settings.skinSlim ? 'Slim' : 'Classic'}`, false, () => { settings.skinSlim = !settings.skinSlim; store(SETTINGS_KEY, settings); this.renderSkinPicker(); });
    btn(settings.skinData ? 'Change Skin...' : 'Load Your Skin...', false, () => file.click()).title = 'A Minecraft skin PNG (64x64, or a classic 64x32)';
  }
  // Front view of a skin (by layer key), cut out of its texture like the original's skin preview.
  skinPreview(key) {
    const src = document.createElement('canvas'); src.width = src.height = ENTITY;
    const img = src.getContext('2d').createImageData(ENTITY, ENTITY);
    img.data.set(this.skinPixels[this.mobLayers.get(key)]);
    src.getContext('2d').putImageData(img, 0, 0);
    const out = document.createElement('canvas'); out.width = 16; out.height = 32;
    const x = out.getContext('2d'); x.imageSmoothingEnabled = false;
    const model = this.mobModels.get(key === 'player_custom' && settings.skinSlim ? 'player_slim' : 'player_wide'), aw = model.slim ? 3 : 4;
    const put = (partName, k, dx, dy, dw, dh) => { const b = model.parts[partName].boxes[k], [u, v, w, h] = faceRects(b).front; x.drawImage(src, u, v, w, h, dx, dy, dw, dh); };
    for (const k of [0, 1]) { put('head', k, 4, 0, 8, 8); put('body', k, 4, 8, 8, 12); put('rightArm', k, 4 - aw, 8, aw, 12); put('leftArm', k, 12, 8, aw, 12); put('rightLeg', k, 4, 20, 4, 12); put('leftLeg', k, 8, 20, 4, 12); }
    return out;
  }
  async joinWorld() {
    if (this.joining) return;
    this.saveMpSettings();
    const code = cleanCode($('mp-code').value), name = this.mpName();
    if (code.length !== 5) { this.mpStatus('Enter the 5-character code your friend sees in their pause menu.', 'err'); return; }
    this.joining = true; $('btn-mp-join').disabled = true;
    this.rejoinToken = null;
    this.sound.unlock();
    this.lastJoin = { code, name, skin: settings.skin | 0, key: this.mpKey() };
    try {
      const { net, welcome } = await Net.join(this, code, name, settings.skin | 0, this.mpKey(), t => this.mpStatus(t));
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
      player: sv.player || { pos: spawn.slice(), yaw: Math.PI * 0.75, pitch: 0, flying: false, dim: 0 }, guest: true, genVersion: m.genVersion, palette: m.palette, java: m.java,
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
  onDisconnected(msg, opts = {}) {
    const wasGuest = this.net && !this.net.isHost;
    this.leaveNet();
    if (!wasGuest) return;
    document.exitPointerLock();
    if (this.game) { this.game.world.dispose(); this.game = null; }
    this.startPanorama();
    this.showMultiplayer(msg, 'err');
    if (opts.retry && this.lastJoin) this.autoRejoin();
  }
  // A dropped connection (Wi-Fi blip, sleeping laptop, network switch) rejoins on its own, with
  // growing pauses, for about two minutes. Leaving the screen or joining by hand stops it.
  async autoRejoin() {
    const token = this.rejoinToken = {}, j = this.lastJoin;
    const delays = [1000, 2000, 4000, 6000, 10000, 15000, 20000, 30000, 30000];
    for (let i = 0; i < delays.length; i++) {
      for (let left = Math.ceil(delays[i] / 1000); left > 0; left--) {
        if (this.rejoinToken !== token || this.mode !== 'mp') return;
        this.mpStatus(`Connection lost. Reconnecting in ${left} s… (attempt ${i + 1} of ${delays.length})`, 'err');
        await new Promise(r => setTimeout(r, 1000));
      }
      if (this.rejoinToken !== token || this.mode !== 'mp' || this.joining) return;
      this.joining = true;
      try {
        const { net, welcome } = await Net.join(this, j.code, j.name, j.skin, j.key, t => this.mpStatus(`Reconnecting: ${t}`));
        if (this.rejoinToken !== token || this.mode !== 'mp') { net.close(); return; }
        this.rejoinToken = null;
        this.startGuestGame(net, welcome);
        this.chat('Reconnected.', '#55ff55');
        return;
      } catch (e) {
        if (/No open world/.test(e.message || '')) { this.mpStatus('The world is no longer open. Ask your friend to open it again, then join.', 'err'); return; }
      } finally { this.joining = false; }
    }
    if (this.rejoinToken === token) this.mpStatus('Could not reconnect. Check your connection, then press Join World to try again.', 'err');
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
    // Moving from a menu/search field into the world must release text focus.
    // Pointer lock alone does not reliably focus the canvas in every browser.
    document.activeElement?.blur?.();
    c.focus({ preventScroll: true });
    let r;
    // Raw Input (on by default, as in Minecraft) asks for the mouse's own movement, without the
    // operating system's pointer acceleration, which shrinks slow movements almost to nothing.
    const plain = () => { this.rawInput = false; try { const r2 = c.requestPointerLock(); if (r2 && r2.catch) r2.catch(() => {}); } catch { /* ignore */ } };
    if (settings.rawInput === false) { plain(); return; }
    try { r = c.requestPointerLock({ unadjustedMovement: true }); } catch { r = null; }
    if (r && r.then) r.then(() => { this.rawInput = true; }, plain);
    else if (!r && document.pointerLockElement !== c) plain();
    else this.rawInput = null; // the browser does not say
  }

  // Apply one Java resource pack over the current textures and sounds. Player-selected packs
  // layer over the bundled defaults, so an omitted asset keeps the built-in replacement.
  async applyPack(zip, soundOverlay = false) {
    if (!this.blockAnims) this.blockAnims = new Map();
    const nb = await applyBlockTextures(zip, TEXTURES, this.blockTex, this.blockAnims);
    // Entity skins from the pack's textures/entity (each Java model names its own).
    // A list of images is laid one over another (a villager's biome and profession over its body).
    for (const [key, model] of this.mobModels) {
      if (!model.texture || !this.mobLayers.has(key)) continue;
      let px = null;
      const k = texFactor(model);
      for (const path of [].concat(model.texture)) px = (await readEntityTexture(zip, path, model.texSize && model.texSize.map(v => v / k), px)) || px;
      if (px) { const layer = this.mobLayers.get(key); this.skinPixels[layer] = px; this.renderer.setEntityLayer(layer, px); }
    }
    // Worn armor from the pack's textures/models/armor.
    for (const [mat, l, px] of await applyArmorTextures(zip, Object.keys(ARMOR_MATERIALS), LEATHER_COLOR)) {
      const layer = this.mobLayers.get(`armor_${mat}_${l}`);
      this.skinPixels[layer] = px; this.renderer.setEntityLayer(layer, px);
    }
    if (nb) { this.renderer.setBlockTextures(buildMipChain(this.blockTex), TEXTURES.length); this.renderer.setAnimations(this.blockAnims); }
    const entries = [];
    for (const it of ITEMS) if (ITEM_LAYER[it.key] !== undefined) entries.push([it.key, ITEM_LAYER[it.key], it.block ? flatTexFor(it) : null]);
    for (const f of ['bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2', 'crossbow_pulling_0', 'crossbow_pulling_1', 'crossbow_pulling_2', 'crossbow_arrow', 'crossbow_firework', 'fishing_rod_cast']) if (FX_LAYER[f] !== undefined) entries.push([f, FX_LAYER[f], null]);
    const ni = await applyItemTextures(zip, entries, this.itemTex);
    if (ni) { this.renderer.setItemTextures(buildMipChain(this.itemTex), this.itemTex.length); clearItemMeshes(); }
    this.icons = buildIcons(this.blockTex, this.itemTex);
    document.documentElement.style.setProperty('--dirt-tex', `url(${dirtTexture(this.blockTex[TEX.dirt])})`);
    if (this.game) { this.game.icons = this.icons; this.game.invDirty = true; }
    const sounds = indexSounds(zip);
    this.sound.setPack(zip, sounds, soundOverlay);
    return { blocks: nb, items: ni, sounds: sounds.size };
  }

  // The curated bundled pack is the normal look and sound. A standard Java Edition resource
  // pack chosen by the player is kept in this browser only and overrides matching bundled files.
  async loadPack() {
    let p;
    try { p = await storedPack(); } catch { p = null; }
    this.packName = p ? p.name : null;
    this.updatePackButton();
    try {
      const response = await fetch('assets/default-pack.zip?v=STAMP-splash', { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const zip = await Zip.open(await response.blob());
      const stats = await this.applyPack(zip);
      console.info(`Bundled defaults: ${stats.blocks} block textures, ${stats.items} item textures, ${stats.sounds} sound groups`);
    } catch (e) { console.warn('bundled defaults failed; using generated fallbacks', e); }
    if (!p) return;
    try {
      const zip = await Zip.open(p.blob);
      this.packStats = await this.applyPack(zip, true);
      console.info(`Resource pack "${p.name}": ${this.packStats.blocks} block textures, ${this.packStats.items} item textures, ${this.packStats.sounds} sound groups`);
      this.updatePackButton();
    } catch (e) { console.warn('resource pack failed', e); this.packName = null; this.packStats = null; this.updatePackButton(`Pack failed: ${e.message}`); }
  }
  updatePackButton(msg) {
    const b = $('set-pack');
    if (!b) return;
    b.textContent = msg || (this.packName ? `Pack: ${this.packName.replace(/\.zip$/i, '').slice(0, 22)}` : 'Resource Packs...');
    b.title = this.packStats ? `${this.packStats.blocks} block textures, ${this.packStats.items} item textures, ${this.packStats.sounds} sounds` : 'Load a Java Edition resource pack (.zip) from this computer';
  }
  bindSettings() {
    const bind = (id, key, label, fmt, apply) => {
      const el = $(id);
      el.value = settings[key];
      el.addEventListener('input', () => { settings[key] = Number(el.value); if (apply) apply(); });
      slider(id, label, fmt);
    };
    const pct = v => `${v}%`, vol = v => (v ? `${v}%` : 'OFF'), unmute = () => { settings.muted = false; this.applyMute(); };
    bind('set-rd', 'renderDistance', 'Render Distance', v => `${v} chunks`);
    bind('set-fov', 'fov', 'FOV', v => (v === 70 ? 'Normal' : v === 110 ? 'Quake Pro' : v));
    bind('set-sens', 'sensitivity', 'Sensitivity', pct);
    bind('set-bright', 'brightness', 'Brightness', v => (v === 0 ? 'Moody' : v === 100 ? 'Bright' : pct(v)));
    bind('set-vol', 'volume', 'Master Volume', vol, unmute);
    bind('set-music', 'music', 'Music', vol, unmute);
    cycle($('set-gfx'), 'Graphics', [[0, 'Fast'], [1, 'Regular'], [2, 'High'], [3, 'PC']], () => Number(settings.graphics), v => { settings.graphics = v; this.applyGraphics(); store(SETTINGS_KEY, settings); });
    for (const [id, k, label] of [['set-bob', 'bobbing', 'View Bobbing'], ['set-clouds', 'clouds', 'Clouds'], ['set-autojump', 'autoJump', 'Auto-Jump'], ['set-particles', 'particles', 'Particles'], ['set-dynres', 'dynamicRes', 'Dynamic Resolution'], ['set-raw', 'rawInput', 'Raw Input'], ['set-lowlat', 'lowLatency', 'Low Latency'], ['set-dabr', 'barrelRoll', 'Barrel Roll Flight'], ['set-dabryaw', 'barrelRollYaw', 'Flight: Mouse Yaws']]) {
      toggle($(id), label, () => !!settings[k], async v => {
        settings[k] = v; if (this.game) this.game.player.autoJump = settings.autoJump;
        if (k === 'lowLatency') { store(SETTINGS_KEY, settings); if (await ask('Low Latency changes how the game draws to the screen and applies after a reload. Reload now?')) location.reload(); }
      });
    }
    // Resource packs: chosen from this computer, stored in this browser, applied on reload.
    $('set-pack').addEventListener('click', async () => {
      if (this.packName && await ask(`Using the resource pack "${this.packName}".\n\nOK: remove it.  Cancel: choose a different pack.`)) { await removePack(); location.reload(); return; }
      $('pack-file').click();
    });
    $('pack-file').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      this.updatePackButton('Reading pack…');
      try { const z = await Zip.open(f); if (!z.list('assets/minecraft/').length) throw new Error('no assets/minecraft folder inside'); await savePack(f.name, f); location.reload(); }
      catch (err) { this.updatePackButton(); await tell(`That isn't a usable resource pack: ${err.message}`); }
    });
    for (const b of $('settings').querySelectorAll('.opts button')) b.addEventListener('click', () => this.sound.click());
  }
  bindMenus() {
    const click = (id, fn) => $(id).addEventListener('click', () => { this.sound.unlock(); this.sound.click(); fn(); });
    click('btn-play', () => this.showWorlds());
    click('btn-world-download', () => this.downloadWorld(this.selectedWorld));
    click('btn-world-upload', () => $('world-file').click());
    $('world-file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) this.uploadWorld(f); });
    click('btn-world-java-import', () => $('java-file').click());
    click('btn-mp-test', () => this.testConnection());
    $('java-file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) this.importJava(f); });
    click('btn-world-java-export', () => this.exportJava(this.selectedWorld));
    click('btn-world-back', () => { if (this.hostAfterLoad) this.showMultiplayer(); else this.setMode('title'); });
    click('btn-world-new', () => { this.setMode('create'); $('cw-name').focus(); $('cw-name').select(); this.updateCreateHint(); });
    click('btn-world-play', () => this.selectedWorld && this.playWorld(this.selectedWorld));
    click('btn-world-delete', async () => { if (this.selectedWorld && await ask('Delete this world forever?')) { await deleteWorld(this.selectedWorld); this.showWorlds(); } });
    click('btn-create', () => this.createWorld());
    click('btn-create-cancel', () => this.showWorlds());
    // Create-screen choices are cycle buttons; the current value lives in data-v.
    const choices = {
      mode: ['Game Mode', [['survival', 'Survival'], ['creative', 'Creative'], ['hardcore', 'Hardcore']]],
      difficulty: ['Difficulty', [['peaceful', 'Peaceful'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]],
      type: ['World Type', [['default', 'Default'], ['wild', 'Wild'], ['flat', 'Superflat']]],
      cheats: ['Allow Cheats', [['on', 'ON'], ['off', 'OFF']]],
    };
    for (const b of $('create').querySelectorAll('[data-opt]')) {
      const [label, opts] = choices[b.dataset.opt];
      cycle(b, label, opts, () => b.dataset.v, v => { b.dataset.v = v; this.sound.click(); this.updateCreateHint(); });
    }
    click('btn-settings', () => this.openPanel('settings'));
    click('btn-settings2', () => this.openPanel('settings'));
    click('btn-settings-done', () => { this.closePanel('settings'); store(SETTINGS_KEY, settings); });
    click('btn-guide', () => this.openGuide());
    click('btn-demo', () => this.startDemo());
    click('btn-guide2', () => this.openGuide());
    click('btn-guide-done', () => this.closePanel('guide'));
    click('btn-controls', () => this.openPanel('controls'));
    click('btn-mute', () => { settings.muted = !settings.muted; this.applyMute(); store(SETTINGS_KEY, settings); });
    click('btn-full', () => { if (document.fullscreenElement) document.exitFullscreen?.(); else globalThis.document.documentElement.requestFullscreen?.().catch(() => {}); });
    click('btn-controls2', () => this.openPanel('controls'));
    click('btn-controls-done', () => this.closePanel('controls'));
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
    const opt = k => $('create').querySelector(`[data-opt=${k}]`).dataset.v;
    $('cw-hint').textContent = { survival: 'Gather resources, craft and stay alive.', creative: 'Unlimited blocks, flight, instant breaking.', hardcore: 'Survival on hard difficulty with one life.' }[opt('mode')];
    $('cw-type-hint').textContent = { default: 'Continents, oceans, rivers, 40+ biomes, deep caves, villages and structures.', wild: 'Amplified mountains, floating islands with waterfalls, giant stone pillars and natural arches.', flat: 'A flat grassland, perfect for building.' }[opt('type')];
  }
  // Options/Controls/Guide replace the pause menu while open, like Minecraft's sub-screens.
  openPanel(id) { $(id).classList.remove('hidden'); if (this.mode === 'pause') $('pause').classList.add('hidden'); }
  closePanel(id) { $(id).classList.add('hidden'); if (this.mode === 'pause') $('pause').classList.remove('hidden'); }

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
    // Mouse look. Chrome batches mouse events whenever the page is busy (every frame at 60 fps),
    // and a batched event does not reliably carry the movement of every sample inside it: that
    // loss is the dead-zone / laggy feel. So every sample is taken from getCoalescedEvents() and
    // summed. Raw updates (delivered as soon as the mouse moves) are used where the browser has
    // them; plain pointer moves only while no raw updates arrive, so nothing is counted twice.
    const take = (dx, dy) => {
      if (!dx && !dy) return;
      this.mouseStats.n++;
      // Ignore the first moments after locking and absurd one-off jumps some browsers report when
      // the lock engages or the event queue stalls; ordinary fast flicks always get through.
      const mag = Math.abs(dx) + Math.abs(dy), avg = this.mouseAvg || 0;
      if (performance.now() - (this.lockedAt || 0) < 60 || (mag > 1200 && mag > avg * 12 + 400)) { this.mouseAvg = avg * 0.9; return; }
      this.mouseAvg = avg * 0.8 + mag * 0.2;
      const sens = settings.sensitivity / 100 * 0.0022, p = this.game.player;
      // Barrel-roll flight takes the mouse while gliding.
      if (this.dabr.active) { this.dabr.look(dx, dy, sens, !!settings.barrelRollYaw); p.yaw = this.dabr.yaw; p.pitch = Math.max(-1.56, Math.min(1.56, this.dabr.pitch)); return; }
      p.yaw -= dx * sens;
      p.pitch = Math.max(-1.56, Math.min(1.56, p.pitch - dy * sens));
    };
    const samples = e => {
      if (!this.locked || this.mode !== 'play' || !this.game) return false;
      const list = movementSamples(e);
      for (const c of list) take(c.movementX, c.movementY);
      return list.length > 0;
    };
    this.mouseStats = { n: 0, src: '', rate: 0, t: performance.now() };
    if ('onpointerrawupdate' in window) document.addEventListener('pointerrawupdate', e => {
      if (samples(e)) { this.lastRaw = performance.now(); this.mouseStats.src = 'raw'; }
    });
    if ('onpointermove' in window) document.addEventListener('pointermove', e => {
      if (performance.now() - (this.lastRaw ?? -Infinity) < 250) return;
      if (samples(e)) { this.lastPointer = performance.now(); this.mouseStats.src = 'move'; }
    });
    document.addEventListener('mousemove', e => {
      if (performance.now() - Math.max(this.lastRaw ?? -Infinity, this.lastPointer ?? -Infinity) < 250) return;
      if (samples(e)) this.mouseStats.src = 'mouse';
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
          else { const msg = cleanChat(v); if (msg) { this.chat(chatLine(this.game.playerName, msg)); if (this.net) this.net.send({ t: 'chat', id: this.net.myId, msg }); } }
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
    if (document.activeElement?.tagName === 'INPUT' && document.activeElement.id !== 'chat-input') return;
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
    let yaw = p.yaw, pitch = p.pitch, roll = Math.sin(ph) * 0.006 * bob + this.dabr.cameraRoll(dt);
    if (this.dabr.active) { yaw = this.dabr.yaw; pitch = this.dabr.pitch; }
    if (this.shakeAmt > 0) { roll += (Math.random() - 0.5) * this.shakeAmt * 0.08; this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2); }
    if (!g.alive) { roll = Math.min(1.2, (this.deathRoll = (this.deathRoll || 0) + dt * 2)); pos[1] -= Math.min(1.2, this.deathRoll); } else this.deathRoll = 0;
    if (this.view > 0) {
      const back = this.view === 1 ? -1 : 1;
      const f = forward(yaw, pitch);
      const d = [f[0] * back, f[1] * back, f[2] * back];
      const hit = g.mode === 'spectator' ? null : g.world.raycast(eye, d, 4);
      const dist = hit ? Math.max(0.3, hit.t - 0.3) : 4;
      pos = [eye[0] + d[0] * dist, eye[1] + d[1] * dist, eye[2] + d[2] * dist];
      // Looking back at the player: R * Ry(pi) = Ry(yaw + pi) Rx(-pitch) Rz(-roll).
      if (this.view === 2) { yaw += Math.PI; pitch = -pitch; roll = -roll; }
    }
    return { pos, yaw, pitch, roll };
  }

  // ---------------- frame ----------------
  frame(now) {
    requestAnimationFrame(t => this.frame(t));
    const realDt = (now - (this.lastFrame || now)) / 1000;
    const dt = Math.min(0.05, realDt);
    this.frameDt = dt;
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
    // Java's width / 2 and height / 2: the GUI size is the window over the scale, rounded up.
    const hw = Math.floor(Math.ceil(window.innerWidth / gs) / 2), hh = Math.floor(Math.ceil(window.innerHeight / gs) / 2);
    if (hw !== this.guiHalfW || hh !== this.guiHalfH) { this.guiHalfW = hw; this.guiHalfH = hh; document.documentElement.style.setProperty('--half-w', hw); document.documentElement.style.setProperty('--half-h', hh); }
    const tick = Math.floor(this.time * 20);
    if (tick !== this.lastTick) { this.lastTick = tick; this.renderer.animate(tick); } // the 20 Hz client tick
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
  mouseRate() {
    const m = this.mouseStats, now = performance.now(), dt = (now - m.t) / 1000;
    if (dt >= 0.5) { m.rate = Math.round(m.n / dt); m.n = 0; m.t = now; }
    return m.rate;
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
  // Startup ends once the title panorama's terrain is on screen and the fonts are in: the splash's
  // last 30% is the share of the panorama's chunks built and uploaded.
  bootProgress(radius) {
    const w = this.panoWorld, cx = Math.floor(this.panorama.pos[0] / 16), cz = Math.floor(this.panorama.pos[2] / 16);
    let total = 0, done = 0;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      // The chunks World.update meshes: in view, with all eight neighbours inside the generated area.
      if (dx * dx + dz * dz > (radius + 0.5) ** 2 || (Math.abs(dx) + 1) ** 2 + (Math.abs(dz) + 1) ** 2 > (radius + 1.5) ** 2) continue;
      const c = w.chunk(cx + dx, cz + dz);
      total++;
      if (c && c.meshedVersion > 0 && !w.uploads.has(c.key)) done++;
    }
    splash.progress(0.7 + 0.3 * done / total);
    if (done === total && this.fontsReady) { this.booted = true; splash.ready(); }
  }
  framePanorama(dt) {
    const pano = this.panorama;
    if (!pano || !this.panoWorld) return;
    pano.yaw += dt * 0.04;
    this.sound.updateMusic(dt, 'menu');
    const panoRadius = Math.min(settings.renderDistance, LOW_END ? 5 : 7);
    this.panoWorld.update(pano.pos[0], pano.pos[2], panoRadius);
    if (!this.booted) this.bootProgress(panoRadius);
    const env = computeEnv(0, 0.07, forward(pano.yaw, -0.15), 0, 0, settings.brightness / 100);
    this.renderer.render({ camPos: pano.pos, yaw: pano.yaw, pitch: -0.15, roll: 0, fov: 75, time: this.time, env, medium: 0, renderDistance: Math.min(settings.renderDistance, LOW_END ? 5 : 7), clouds: settings.clouds, chunks: this.panoWorld.chunks.values(), dim: 0, post: { saturation: 1.1 } });
  }
  // LevelLoadingScreen.renderChunks: one pixel per chunk here, scaled to 2x2 GUI px by CSS; a chunk
  // with no status yet is black.
  drawChunkMap(prep) {
    const cv = $('load-map'), n = cv.width, ctx = cv.getContext('2d');
    if (!this.chunkMapImage) {
      this.chunkMapImage = ctx.createImageData(n, n);
      this.chunkMapRGB = STATUS_COLOR.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
    }
    const img = this.chunkMapImage, d = img.data;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const s = prep ? prep.statusAt(x, z) : -1, rgb = s < 0 ? [0, 0, 0] : this.chunkMapRGB[s], k = (x + z * n) * 4;
      d[k] = rgb[0]; d[k + 1] = rgb[1]; d[k + 2] = rgb[2]; d[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  frameGame(dt) {
    const g = this.game, p = g.player;
    const rd = settings.renderDistance;
    // While spawn is prepared, generation follows the spawn ticket rather than the view.
    if (!this.spawnPrep) g.world.update(p.pos[0], p.pos[2], rd);
    if (this.mode === 'loading') {
      this.loadingFor += dt;
      let ready = false;
      if (this.spawnPrep) {
        const prep = this.spawnPrep;
        prep.update();
        $('load-pct').textContent = `${prep.progress}%`;
        this.drawChunkMap(prep);
        if (prep.done) { this.spawnPrep = null; this.showLoading('terrain', 'Loading terrain...'); }
      } else {
        // ReceivingLevelScreen: done once the chunk under the player is built (or the player is above
        // or below the world, or a spectator), and after 30 s whatever happens.
        g.settleArrival();
        const c = g.world.chunkAt(p.pos[0], p.pos[2]);
        ready = !g.pendingArrival && ((c && c.meshedVersion > 0) || p.pos[1] < 0 || p.pos[1] >= HEIGHT || g.mode === 'spectator' || this.loadingFor > 30);
      }
      if (ready) {
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
        // Elytra flight with free rotation ("Do a Barrel Roll"): starts once you're gliding.
        const dabrOn = settings.barrelRoll !== false && g.mode !== 'spectator';
        if (p.gliding && dabrOn && !this.dabr.active) this.dabr.start(p.yaw, p.pitch);
        if (this.dabr.active && (!p.gliding || !dabrOn || !g.alive)) this.dabr.stop();
        if (this.dabr.active) {
          this.dabr.update(dt, input, !!settings.barrelRollYaw, Math.hypot(p.vel[0], p.vel[1], p.vel[2]) * 20 / 30);
          p.yaw = this.dabr.yaw; p.pitch = Math.max(-1.56, Math.min(1.56, this.dabr.pitch));
        }
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
    const fovTarget = settings.fov + (p.sprinting ? (p.flying ? 14 : 9) : 0) - (medium === 1 ? 6 : 0);
    // Drawing a bow zooms in like the original: the view narrows by up to 15%.
    const bowZoom = this.interact.using === 'bow' ? 1 - 0.15 * Math.min(1, this.interact.useT) ** 2 : 1;
    this.fovCur += (fovTarget * bowZoom - this.fovCur) * (1 - Math.exp(-dt * 8));
    this.sound.listener = { pos: cam.pos, yaw: cam.yaw };
    // Entity/particle batches.
    const B_ = this.batches;
    for (const b of Object.values(B_)) b.reset();
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    const up = [Math.sin(cam.yaw) * Math.sin(cam.pitch), Math.cos(cam.pitch), Math.cos(cam.yaw) * Math.sin(cam.pitch)];
    const ctx = { camPos: cam.pos, camRight: right, camUp: up, mobs: B_.mobs, mobsClear: B_.mobsClear, items: B_.items, itemFx: B_.itemFx, blockParticles: B_.blockParticles, blockModels: [], labels: [] };
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
      const matrix = compose(translation(a.x + 0.5, a.y, a.z + 0.5), rotationY(-facing * Math.PI / 2), translation(-0.5, 0, -0.5), translation(0, 9 / 16, 1 / 16), rotationX(-e * Math.PI / 2), translation(0, -9 / 16, -1 / 16));
      ctx.blockModels.push({ id: B.CHEST, meta: 32, light, matrix });
    }
    // Blocks being moved by pistons.
    g.rs.render(ctx, (x, y, z) => { const l = g.world.lightAt(x, y, z); return Math.max(Math.pow(0.8, 15 - l.sky) * g.env.skyLight[0], Math.pow(0.82, 15 - l.blk) * 1.1, g.env.ambient[0]); });
    if (this.view > 0 && g.alive && g.mode !== 'spectator') this.drawPlayerModel(ctx);
    else if (p.rockets.length && g.alive) this.rocketSparks(this.rocketAt(p.renderPos || p.pos, p.yaw, g.inv.held && g.inv.held.key, g.inv.offhand.get(0) && g.inv.offhand.get(0).key), this.wings || (this.wings = { x: 0.2617994, y: 0, z: -0.2617994 }));
    if (rain > 0.05) this.drawWeather(ctx, cam, rain);
    // Elytra wind: speed squared (blocks/tick) over 4, silent for the first second of a glide, then
    // fading in over the next; above 0.8 it also rises in pitch.
    // (Every frame, not only in the rain.)
    let wind = 0;
    if (p.gliding && g.alive) {
      const v2 = (p.vel[0] ** 2 + p.vel[1] ** 2 + p.vel[2] ** 2) / 400, gt = p.glideTicks || 0;
      wind = gt < 20 ? 0 : Math.min(1, v2 / 4) * Math.min(1, (gt - 20) / 20);
    }
    this.sound.setWind(wind, wind > 0.8 ? 1 + (wind - 0.8) : 1);
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
      // (See-through mob layers, like a slime's outer jelly: Java's entityTranslucent.)
      blendBatches: [{ batch: B_.mobsClear, tex: 'mob' }, { batch: B_.itemFx, tex: 'item' }],
      hand, post: { hurt: this.post.hurt, flash: this.post.flash + (g.stats.fire > 0 && this.view === 0 ? 0.03 : 0), portal: this.portalEffect, dark: this.post.dark, saturation: 1.1 },
    });
    if (this.net && !this.hudHidden) this.nametags.update(cam, this.fovCur, this.net.remotePlayers(), g.world); else this.nametags.clear();
    if (this.wantThumb) { this.wantThumb = false; }
    // The inventory's player, after the frame so it never disturbs the world's draw state.
    const pv = this.gui && this.gui.isOpen && this.gui.preview;
    if (pv && pv.canvas.isConnected) this.renderInventoryPlayer(pv);
  }

  drawPlayerModel(ctx) { this.drawHumanoid(ctx, this.playerState()); }
  // The local player as drawHumanoid takes it (the world view and the inventory preview).
  playerState() {
    const g = this.game, p = g.player;
    return {
      pos: p.renderPos || p.pos, yaw: p.yaw, pitch: p.pitch, walk: p.bobPhase * 1.6, walkAmt: p.bobAmount, swing: this.interact.swing,
      sneaking: p.sneaking, riding: !!g.riding, gliding: p.gliding, vel: p.vel, layer: this.mobLayer('player'), model: this.playerModelOf(), flash: this.post.hurt > 0.5 ? 0.6 : 0,
      glideTicks: p.gliding ? (p.glideTicks || 0) + (p.tickAcc || 0) * 20 : 0, roll: this.dabr.active ? this.dabr.roll : null, crawling: p.crawling,
      rockets: p.rockets.length, wings: this.wings || (this.wings = { x: 0.2617994, y: 0, z: -0.2617994 }), dt: this.frameDt || 0,
      armor: g.inv.armor.slots.map(s => s && s.key), held: g.inv.held && g.inv.held.key, off: g.inv.offhand.get(0) && g.inv.offhand.get(0).key,
      bow: this.interact.using === 'bow', trident: this.interact.using === 'trident', blocking: g.blocking,
      xbowCharge: this.interact.using === 'crossbow' ? Math.min(1, this.interact.useT / crossbowCharge(this.game.inv.held)) : -1,
      xbowHold: !this.interact.using && g.inv.held && g.inv.held.key === 'crossbow' && !!(g.inv.held.tag && g.inv.held.tag.loaded),
    };
  }
  // InventoryScreen.renderEntityInInventoryFollowsMouse: the player in its box, its body turned up to
  // 20 degrees and its head 40 towards the pointer, tilted up to 20 degrees as the pointer rises or
  // falls, lit evenly; drawn offscreen and copied into the box's canvas.
  renderInventoryPlayer(pv) {
    const g = this.game, c = pv.canvas, r = c.getBoundingClientRect();
    if (!r.width || !g.alive) return;
    const dpr = window.devicePixelRatio || 1, W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    // Before the pointer has moved over the screen its place is unknown: face straight out, as Java
    // does with the pointer on the player.
    const k = r.width / pv.w, mx = Number.isFinite(this.gui.mx) ? (this.gui.mx - r.left) / k : pv.fx, my = Number.isFinite(this.gui.my) ? (this.gui.my - r.top) / k : pv.fy - pv.eye;
    const f = Math.atan((pv.fx - mx) / 40), f1 = Math.atan((pv.fy - pv.eye - my) / 40), D2R = Math.PI / 180;
    if (!this.pvBatches) this.pvBatches = { mobs: new Batch(), items: new Batch() };
    const B_ = this.pvBatches; B_.mobs.reset(); B_.items.reset();
    const ctx = { mobs: B_.mobs, items: B_.items, itemFx: B_.items, blockModels: [], camPos: [0, 0, 10], camRight: [1, 0, 0], camUp: [0, 1, 0], labels: [] };
    this.drawHumanoid(ctx, {
      ...this.playerState(), pos: [0, 0, 0], yaw: Math.PI - f * 20 * D2R, pitch: f1 * 20 * D2R, headYaw: f * 20 * D2R,
      pre: M.rx(-f1 * 20 * D2R), light: 1, flash: 0, rockets: 0, wings: this.pvWings || (this.pvWings = { x: 0.2617994, y: 0, z: -0.2617994 }),
    });
    // Orthographic: `scale` GUI px a block, the feet at (fx, fy) in the box, depth +-4 blocks.
    const sx = 2 * pv.scale / pv.w, sy = 2 * pv.scale / pv.h;
    const vp = new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, -0.125, 0, 2 * pv.fx / pv.w - 1, 1 - 2 * pv.fy / pv.h, 0, 1]);
    const px = this.renderer.renderPreview([{ batch: B_.mobs, tex: 'mob' }, { batch: B_.items, tex: 'item' }], W, H, vp, { env: g.env, time: this.time, blockModels: ctx.blockModels });
    const img = new ImageData(W, H), row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    c.getContext('2d').putImageData(img, 0, 0);
  }
  drawRemotePlayer(ctx, rp) {
    this.drawHumanoid(ctx, {
      pos: rp.pos, yaw: rp.yaw, pitch: rp.headPitch, walk: rp.walk, walkAmt: rp.walkAmt, swing: rp.swing, sneaking: rp.sneaking, riding: rp.riding,
      gliding: rp.gliding, vel: rp.vel, layer: this.mobLayer(`player_${rp.skin}`), flash: rp.hurtT > 0 ? 0.6 : 0,
      glideTicks: rp.glideTicks || 0, roll: rp.gliding && rp.roll ? rp.roll : null, crawling: rp.crawling, rockets: rp.rocket ? 1 : 0,
      wings: rp.wings || (rp.wings = { x: 0.2617994, y: 0, z: -0.2617994 }), dt: this.frameDt || 0,
      armor: rp.armor, held: rp.held, off: rp.off, bow: rp.drawingBow && rp.held !== 'crossbow', trident: rp.throwingTrident, blocking: rp.blocking,
      xbowCharge: rp.drawingBow && rp.held === 'crossbow' ? 1 : -1, xbowHold: rp.crossbowHold,
    });
  }
  // A player model in any pose: walking, sneaking, riding, gliding, drawing a bow, blocking.
  drawHumanoid(ctx, s) {
    const g = this.game;
    const model = s.model || this.mobModel('player_wide');
    // PlayerRenderer.getArmPose: what each hand is doing, and HumanoidModel.setupAnim's pose for it.
    let right = s.held ? 'item' : 'empty', left = s.off ? 'item' : 'empty', using = null;
    if (s.bow) { right = 'bow'; using = 'right'; }
    else if (s.trident) { right = 'spear'; using = 'right'; }
    else if (s.xbowCharge >= 0) { right = 'xbow_charge'; using = 'right'; }
    else if (s.xbowHold) right = 'xbow_hold';
    if (s.blocking) { if (s.held === 'shield') { right = 'block'; using = 'right'; } else { left = 'block'; using = 'left'; } }
    const { poses, pivots } = humanoidPose({
      limbSwing: (s.walk || 0) / 0.6662, limbAmt: s.walkAmt || 0, age: (s.age ?? this.time * 20), headPitch: -(s.pitch || 0), headYaw: s.headYaw || 0,
      attack: s.swing || 0, crouching: s.sneaking, riding: s.riding, rightPose: right, leftPose: left, using,
      fallFlying: s.gliding ? s.glideTicks || 0 : 0, vel: s.vel ? s.vel.map(v => v / 20) : null, swim: s.crawling ? 1 : 0, xbowCharge: Math.max(0, s.xbowCharge),
    });
    poses.pivots = pivots;
    const lp = s.pos;
    const light = s.light ? null : g.world.lightAt(lp[0], lp[1] + 1, lp[2]);
    const b = s.light || Math.max(Math.pow(0.8, 15 - light.sky) * g.env.skyLight[0], Math.pow(0.82, 15 - light.blk), g.env.ambient[0]);
    const sneak = s.sneaking ? M.chain(M.t(0, -2, 0), M.rx(0)) : null;
    // Gliding (LivingEntityRenderer.setupRotations): over the first 10 ticks the body tips about the
    // feet until it lies along the view, then banks by the angle between its motion and its facing;
    // Do-a-Barrel-Roll flight rolls it with the camera instead. Crawling lies flat (the swim pose).
    let glide = null;
    if (s.gliding || s.crawling) {
      const gt = s.glideTicks || 0, f1 = s.crawling ? 1 : Math.min(1, gt * gt / 100);
      glide = M.rx(f1 * ((s.crawling ? 0 : s.pitch) - Math.PI / 2));
      if (s.crawling) glide = M.mul(glide, M.t(0, -16, 4.8));
      else if (s.roll !== null && s.roll !== undefined) glide = M.mul(glide, M.ry(-s.roll));
      else {
        const v = s.vel || [0, 0, 0], fx = -Math.sin(s.yaw) * Math.cos(s.pitch), fz = -Math.cos(s.yaw) * Math.cos(s.pitch);
        const d0 = v[0] * v[0] + v[2] * v[2], d1 = fx * fx + fz * fz;
        if (d0 > 0 && d1 > 0) glide = M.mul(glide, M.ry(Math.sign(v[0] * fz - v[2] * fx) * Math.acos(Math.max(-1, Math.min(1, (v[0] * fx + v[2] * fz) / Math.sqrt(d0 * d1))))));
      }
    }
    let root = rootMatrix(lp, s.yaw, 1, glide || sneak);
    if (s.pre) root = M.mul(s.pre, root);
    const flash = s.flash || 0;
    const mats = drawModel(ctx.mobs, model, s.layer, root, poses, [b, b, b], flash);
    const armor = s.armor || [];
    if (armor[1] === 'elytra') {
      // ElytraModel.setupAnim: folded on the back (tilted 15 degrees), spread flat while gliding (less
      // the steeper the dive), half open when crouching; each wing eases 10% of the way per tick.
      let tx = 0.2617994, tz = -0.2617994, ty = 0, drop = 0;
      if (s.gliding) {
        const v = s.vel || [0, 0, 0], n = Math.hypot(v[0], v[1], v[2]);
        const f4 = v[1] < 0 && n > 0 ? 1 - Math.pow(-v[1] / n, 1.5) : 1;
        tx = f4 * 0.34906584 + (1 - f4) * tx; tz = f4 * -Math.PI / 2 + (1 - f4) * tz;
      } else if (s.sneaking) { tx = 0.6981317; tz = -Math.PI / 4; ty = 0.08726646; drop = 3; }
      const w = s.wings, k = 1 - Math.pow(0.9, Math.min(1, s.dt) * 20);
      w.x += (tx - w.x) * k; w.y += (ty - w.y) * k; w.z += (tz - w.z) * k;
      // Java's model space has x and y flipped: x and y rotations change sign here, z keeps it.
      drawModel(ctx.mobs, this.mobModel('elytra'), this.mobLayer('elytra'), root, {
        wingL: [-w.x, -w.y, w.z], wingR: [-w.x, w.y, -w.z], pivots: { wingL: [-5, 24 - drop, 2], wingR: [5, 24 - drop, 2] },
      }, [b, b, b], flash);
    }
    // An attached firework rocket rides at the hand (getHandHoldingItemAngle: 80 degrees off the
    // facing, half a block out, at the feet) and sheds sparks every tick.
    if (s.rockets > 0) {
      const rp = this.rocketAt(lp, s.yaw, s.held, s.off);
      billboard(ctx.items, ctx, rp[0], rp[1] + 0.12, rp[2], 0.5, this.itemLayer('firework_rocket'), [b, b, b, 1]);
      this.rocketSparks(rp, s.wings);
    }
    // HumanoidArmorLayer: each piece's layer on the armor model, posed exactly like the body.
    for (const key of armor) {
      const a = key && armorLayer(key);
      if (a) drawModel(ctx.mobs, this.mobModel(a.model), this.mobLayer(a.skin), root, { ...poses, hide: a.hide }, [b, b, b], flash);
    }
    // Items at the hands (the arm boxes sit a pixel out from their pivots, as in Java).
    if (s.held && I[s.held] && mats.rightArm) this.renderItemAt(ctx, s.held, M.chain(mats.rightArm, M.t(-2, -10, -1), M.rx(-Math.PI / 2), M.s(10)), [b, b, b]);
    if (s.off && I[s.off] && mats.leftArm) this.renderItemAt(ctx, s.off, M.chain(mats.leftArm, M.t(2, -10, -1), M.rx(-Math.PI / 2), M.s(10)), [b, b, b]);
  }

  // LivingEntity.getHandHoldingItemAngle: a rocket rides 80 degrees off the facing on the side of
  // the hand that held it, half a block out, at the feet.
  rocketAt(pos, yaw, held, off) {
    const side = off === 'firework_rocket' && held !== 'firework_rocket' ? -1 : 1, a = 80 * Math.PI / 180;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    return [pos[0] + (fx * Math.cos(a) + rx * Math.sin(a) * side) * 0.5, pos[1], pos[2] + (fz * Math.cos(a) + rz * Math.sin(a) * side) * 0.5];
  }
  // FireworkRocketEntity.tick: one spark a tick from a burning rocket.
  rocketSparks(at, state) {
    const tick = Math.floor(this.time * 20), g = this.game;
    if (tick === state.sparkTick) return;
    state.sparkTick = tick;
    if (g.particles.enabled()) g.particles.fx('spark', at, 1, 0.05, 0.3);
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

  // First-person hand, following Minecraft's held-item renderer: the arm offset, the swing arc
  // (sin(f^2*pi) / sin(sqrt(f)*pi) curves over 0.3 s), the eating transform and the display
  // transforms from each item model (generated/handheld, handheld_rod, block, bow, crossbow).
  buildHand(dt, cam) {
    const res = this.buildMainHand(dt, cam) || {};
    const off = this.game.inv.offhand.get(0);
    if (off && I[off.key]) this.addOffHand(res, off, dt);
    return res;
  }
  // The off-hand item on the left, with its own swing; a raised shield while blocking.
  addOffHand(res, off, dt) {
    const g = this.game, p = g.player, it = this.interact, D2R = Math.PI / 180;
    const item = I[off.key];
    const f = it.swingOff > 0 ? 1 - it.swingOff : 0, sf = Math.sqrt(f);
    const using = it.using && it.usingHand === 'off' ? it.using : null;
    const bob = settings.bobbing ? p.bobAmount : 0, ph = p.bobPhase;
    const sway = M.t(-Math.sin(ph) * 0.03 * bob - (this.swayX || 0) * 0.3, -Math.abs(Math.cos(ph)) * 0.035 * bob + (this.swayY || 0) * 0.2, 0);
    const mirror = M.s(-1, 1, 1);
    const g1 = Math.sin(f * f * Math.PI), h1 = Math.sin(sf * Math.PI);
    // The original's left-arm transforms (its arm sign i = -1), not a mirror image, so the item isn't flipped.
    const arm = M.chain(M.t(0.4 * Math.sin(sf * Math.PI), 0.2 * Math.sin(sf * Math.PI * 2), -0.2 * Math.sin(f * Math.PI)), M.t(-0.56, -0.52, -0.72), M.ry(-(45 - g1 * 20) * D2R), M.rz(h1 * 20 * D2R), M.rx(-h1 * 80 * D2R), M.ry(45 * D2R));
    const display = (rx, ry, rz, tx, ty, tz, sc) => M.chain(M.t(tx / 16, ty / 16, tz / 16), M.rx(rx * D2R), M.ry(ry * D2R), M.rz(rz * D2R), M.s(sc), M.t(-0.5, -0.5, 0));
    const ROD = off.key === 'fishing_rod' || off.key === 'carrot_on_a_stick' || off.key === 'warped_fungus_on_a_stick';
    const leftItem = base => M.chain(base, ROD ? display(0, -90, -25, 0, 1.6, 0.8, 0.68) : display(0, 90, -25, -1.13, 3.2, 1.13, 0.68));
    const l = g.world.lightAt(p.pos[0], p.pos[1] + 1.6, p.pos[2]);
    const light = Math.max(Math.pow(0.8, 15 - l.sky) * g.env.skyLight[0], Math.pow(0.82, 15 - l.blk), g.env.ambient[0] + 0.05);
    if (item.block && !item.flat) {
      const m = M.chain(sway, arm, M.ry(225 * D2R), M.s(0.4), M.t(-0.5, -0.5, -0.5));
      res.block2 = { id: item.block[0], meta: item.block[1], matrix: toMat4(m) };
      res.light = res.light ?? light;
      return;
    }
    let m;
    if (using === 'shield' || (item.kind === 'shield' && g.blocking)) m = M.chain(sway, mirror, M.t(0.28, -0.38, -0.55), M.ry(-0.25), M.s(0.8), M.t(-0.5, -0.5, 0));
    else if (using === 'eat') {
      const dur = off.key === 'dried_kelp' ? 0.8 : 1.6, left = Math.max(0, dur - it.useT) * 20 + 1, f1 = left / (dur * 20);
      const f3 = 1 - Math.pow(f1, 27), bobY = f1 < 0.8 ? Math.abs(Math.cos(left / 4 * Math.PI) * 0.1) : 0;
      m = leftItem(M.chain(sway, M.t(-f3 * 0.6, bobY - f3 * 0.5, 0), M.t(-0.56, -0.52, -0.72), M.ry(-f3 * 90 * D2R), M.rx(f3 * 10 * D2R), M.rz(-f3 * 30 * D2R)));
    }
    else m = leftItem(M.chain(sway, arm));
    const batch = this.batches.hand2 || (this.batches.hand2 = new Batch());
    batch.reset();
    emitItemMesh(batch, itemMesh(off.key, this.itemPixels(off.key)), this.itemLayer(off.key), m, [light, light, light], hasGlint(off) ? 3 : 1);
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
    // applyEatTransform: the item rises to the mouth and bobs while eating or drinking.
    const eatArm = dur => {
      const left = Math.max(0, dur - it.useT) * 20 + 1, f1 = left / (dur * 20);
      const f3 = 1 - Math.pow(f1, 27), bobY = f1 < 0.8 ? Math.abs(Math.cos(left / 4 * Math.PI) * 0.1) : 0;
      return M.chain(sway, M.t(0, bobY, 0), M.t(f3 * 0.6, -f3 * 0.5, 0), M.t(0.56, -0.52 - equip * 0.6, -0.72),
        M.ry(f3 * 90 * D2R), M.rx(f3 * 10 * D2R), M.rz(f3 * 30 * D2R));
    };
    if (item && item.block && !item.flat) {
      // block/block.json firstperson_righthand: rotation [0, 45, 0], scale 0.4.
      const base = using === 'eat' ? eatArm(1.6) : swingArm();
      const m = M.chain(base, M.ry(45 * D2R), M.s(0.4), M.t(-0.5, -0.5, -0.5));
      return { block: { id: item.block[0], meta: item.block[1], matrix: toMat4(m) }, light };
    }
    if (item) {
      let m;
      // Bows and crossbows use the original's own first-person transforms (ItemInHandRenderer)
      // and the display transforms from their item models.
      const display = (rx, ry, rz, tx, ty, tz, sc) => M.chain(M.t(tx / 16, ty / 16, tz / 16), M.rx(rx * D2R), M.ry(ry * D2R), M.rz(rz * D2R), M.s(sc), M.t(-0.5, -0.5, 0));
      const armT = M.chain(sway, M.t(0.56, -0.52 - equip * 0.6, -0.72));
      // item/generated and item/handheld share this firstperson_righthand transform; item/handheld_rod
      // (fishing rods, carrot and fungus on a stick) turns the other way so the rod points ahead.
      const ROD = held.key === 'fishing_rod' || held.key === 'carrot_on_a_stick' || held.key === 'warped_fungus_on_a_stick';
      const flatItem = base => M.chain(base, ROD ? display(0, 90, 25, 0, 1.6, 0.8, 0.68) : display(0, -90, 25, 1.13, 3.2, 1.13, 0.68));
      const drawn = (base, ticks, f) => {
        if (f > 0.1) base = M.chain(base, M.t(0, Math.sin((ticks - 0.1) * 1.3) * (f - 0.1) * 0.004, 0));
        return M.chain(base, M.t(0, 0, f * 0.04), M.s(1, 1, 1 + f * 0.2), M.ry(-45 * D2R));
      };
      const fx = key => { emitItemMesh(batch, itemMesh(key, this.itemTex[FX_LAYER[key]]), FX_LAYER[key], m, [light, light, light], hasGlint(held) ? 3 : 1); return { batch, batchTex: 'item', light }; };
      if (using === 'bow') {
        const ticks = it.useT * 20, t = ticks / 20, f = Math.min(1, (t * t + t * 2) / 3);
        m = M.chain(drawn(M.chain(armT, M.t(-0.2785682, 0.18344387, 0.15731531), M.rx(-13.935 * D2R), M.ry(35.3 * D2R), M.rz(-9.785 * D2R)), ticks, f), display(0, -90, 25, 1.13, 3.2, 1.13, 0.68));
        return fx(t >= 0.9 ? 'bow_pulling_2' : t >= 0.65 ? 'bow_pulling_1' : 'bow_pulling_0');
      }
      if (using === 'crossbow') {
        const ticks = it.useT * 20, f = Math.min(1, it.useT / crossbowCharge(held));
        m = M.chain(drawn(M.chain(armT, M.t(-0.4785682, -0.094387, 0.05731531), M.rx(-11.935 * D2R), M.ry(65.3 * D2R), M.rz(-9.785 * D2R)), ticks, f), display(-90, 0, -55, 1.13, 3.2, 1.13, 0.68));
        return fx(f >= 1 ? 'crossbow_pulling_2' : f >= 0.58 ? 'crossbow_pulling_1' : 'crossbow_pulling_0');
      }
      if (held.key === 'crossbow') {
        if (held.tag && held.tag.loaded) {
          // Charged: held out in front, ready to fire.
          m = M.chain(armT, M.t(-0.641864, 0, 0), M.ry(10 * D2R), display(-90, 0, -55, 1.13, 3.2, 1.13, 0.68));
          return fx(held.tag.rocket ? 'crossbow_firework' : 'crossbow_arrow');
        }
        m = M.chain(swingArm(), display(-90, 0, -55, 1.13, 3.2, 1.13, 0.68));
        emitItemMesh(batch, itemMesh(held.key, this.itemPixels(held.key)), this.itemLayer(held.key), m, [light, light, light], hasGlint(held) ? 3 : 1);
        return { batch, batchTex: 'item', light };
      }
      if (held.key === 'fishing_rod' && it.fish) {
        m = flatItem(swingArm());
        return fx('fishing_rod_cast');
      }
      if (using === 'trident') {
        // Wound back over the shoulder, prongs forward, trembling once fully charged.
        const pull = Math.min(1, it.useT / 0.5), shake = pull >= 1 ? Math.sin(this.time * 50) * 0.004 : 0;
        m = M.chain(sway, M.t(0.3 + shake, -0.28 + pull * 0.06, -0.5 + pull * 0.2), orient([-0.08, 0.18, -1], [0.3, 1, 0.1]), M.s(1.15), M.t(-0.5, -0.5, 0));
      } else if (using === 'eat') m = flatItem(eatArm(held.key === 'dried_kelp' ? 0.8 : 1.6));
      else if (using === 'shield') m = M.chain(sway, M.t(0.25, -0.4, -0.6), M.ry(-0.3), M.s(0.8), M.t(-0.5, -0.5, 0));
      else m = flatItem(swingArm());
      emitItemMesh(batch, itemMesh(held.key, this.itemPixels(held.key)), this.itemLayer(held.key), m, [light, light, light], hasGlint(held) ? 3 : 1);
      return { batch, batchTex: 'item', light };
    }
    // Empty hand: Minecraft's renderArmFirstPerson stack (blocks and degrees), then the arm model
    // (arm and sleeve) in its own space: our arm box turned 180 degrees about z is the original's
    // (hand at y +12), at its shoulder pivot (-5, 2).
    const DR = Math.PI / 180, f2 = -0.3 * Math.sin(sf * Math.PI), f3 = 0.4 * Math.sin(sf * Math.PI * 2), f4 = -0.4 * Math.sin(f * Math.PI);
    const f5 = Math.sin(f * f * Math.PI), f6 = Math.sin(sf * Math.PI);
    const model = this.playerModelOf(), arm = { java: true, tex: model.tex, parts: { rightArm: { pivot: [0, 0, 0], boxes: model.parts.rightArm.boxes } } };
    const root = M.chain(sway,
      M.t(f2 + 0.64, f3 - 0.6 - equip * 0.6, f4 - 0.72),
      M.ry(45 * DR), M.ry(f6 * 70 * DR), M.rz(-f5 * 20 * DR),
      M.t(-1, 3.6, 3.5), M.rz(120 * DR), M.rx(200 * DR), M.ry(-135 * DR), M.t(5.6, 0, 0),
      M.s(1 / 16), M.t(-5, 2, 0), M.rz(Math.PI));
    drawModel(batch, arm, this.mobLayer('player'), root, {}, [light, light, light], 0);
    return { batch, batchTex: 'mob', light };
  }

  updateHud(dt) {
    const g = this.game, p = g.player;
    if (g.invDirty) { this.hud.renderHotbar(); g.invDirty = false; }
    this.hud.update(dt);
    for (const c of this.chatLines) { c.t -= dt; c.el.style.opacity = Math.min(1, Math.max(0, c.t)); }
    // Java draws the crosshair only in first person.
    const ch = this.view === 0 ? '' : 'none';
    if ($('crosshair').style.display !== ch) $('crosshair').style.display = ch;
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
          `Mode: ${g.mode}${g.hardcore ? ' (hardcore)' : ''}   Difficulty: ${g.difficulty}   Seed: ${g.seed}\n` +
          `Mouse: ${this.mouseRate()} samples/s via ${this.mouseStats.src || '-'}   Raw input: ${this.rawInput === true ? 'on' : this.rawInput === false ? 'off' : '?'}   Low latency: ${settings.lowLatency ? 'on' : 'off'}` +
          (t ? `\nTarget: ${props(t.id, t.meta).name} @ ${t.x} ${t.y} ${t.z}` : this.interact.entityTarget ? `\nTarget: ${this.interact.entityTarget.displayName || this.interact.entityTarget.type} (${Math.ceil(this.interact.entityTarget.health || 0)} HP)` : '');
      }
    }
  }
}

const app = new App();
registerApp(app);
if (app.init()) { app.setMode('title'); app.loadPack(); }
