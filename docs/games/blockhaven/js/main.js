import { B, BLOCKS, INVENTORY, FACE_TEX, RENDER, SOLID, R_CROSS, R_TORCH, SEA } from './blocks.js';
import { generateTextures, makeIcons } from './textures.js';
import { Renderer } from './renderer.js';
import { World, UNLOADED } from './world.js';
import { Player } from './player.js';
import { Sound } from './audio.js';
import { createGenerator, BIOME_NAMES } from './worldgen.js';
import { compose, translation, rotationX, rotationY, rotationZ, scaling, forward } from './math.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'blockhaven.world.v1';
const SETTINGS_KEY = 'blockhaven.settings.v1';
const DAY_LENGTH = 1200;
const REACH = 5;
const DEFAULT_HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.COBBLESTONE, B.PLANKS, B.OAK_LOG, B.GLASS, B.TORCH, B.BRICKS];
const SPLASHES = ['Now with shaders!', 'Handcrafted pixels!', '100% procedural!', 'Mind the lava!', 'Look up at night!', 'Torches glow warm!', 'Infinite-ish!', 'Also try the kart game!'];

const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or disabled */ } };
const settings = Object.assign({ renderDistance: 7, fov: 75, sensitivity: 100, bobbing: true, clouds: true, autoJump: true, volume: 60 }, load(SETTINGS_KEY) || {});

let renderer, world, player, generator, sound, icons;
let mode = 'title';
let settingsReturn = 'title';
let locked = false, suppressPause = false, hudHidden = false, showDebug = false, played = false;
const game = { seed: 0, dayTime: 0.05, hotbar: DEFAULT_HOTBAR.slice(), selected: 0 };
const keys = new Set();
const mouse = { left: false, right: false, clicked: false };
let target = null, breakKey = '', breakProgress = 0, hitTimer = 0, breakCooldown = 0, placeTimer = 0;
let particles = [];
let swing = 0, equip = 0, handSwayX = 0, handSwayY = 0, lastYaw = 0, lastPitch = 0;
let fovCurrent = settings.fov, time = 0, lastFrame = 0, saveTimer = 0, debugTimer = 0, fps = 0, frames = 0;
let panoramaYaw = 0, hintTimer = 0;

function hashSeed(text) {
  const t = text.trim();
  if (!t) return (Math.random() * 2147483647) | 0;
  if (/^-?\d+$/.test(t)) return Number(t) | 0;
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 33) + t.charCodeAt(i)) | 0;
  return h;
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function computeEnv(dayTime, camFwd) {
  const a = dayTime * Math.PI * 2;
  const len = Math.hypot(Math.cos(a), Math.sin(a), 0.25);
  const sunDir = [Math.cos(a) / len, Math.sin(a) / len, 0.25 / len];
  const sy = sunDir[1];
  const day = smoothstep(-0.1, 0.22, sy);
  const sunset = (1 - smoothstep(0.0, 0.32, Math.abs(sy))) * smoothstep(-0.28, 0.0, sy);
  let zenith = mix([0.008, 0.012, 0.035], [0.25, 0.5, 0.95], day);
  let horizon = mix([0.03, 0.045, 0.09], [0.68, 0.82, 1.0], day);
  horizon = mix(horizon, [1.0, 0.52, 0.25], sunset * 0.7);
  zenith = mix(zenith, [0.32, 0.33, 0.6], sunset * 0.25);
  const sunColor = mix([1.0, 0.45, 0.18], [1.0, 0.93, 0.82], smoothstep(0.0, 0.45, sy)).map(v => v * smoothstep(-0.12, 0.05, sy));
  const skyLight = mix([0.16, 0.19, 0.32], mix([1.0, 0.72, 0.52], [1, 1, 1], smoothstep(0.05, 0.4, sy)), day);
  const night = 1 - smoothstep(-0.25, 0.05, sy);
  const fl = Math.hypot(camFwd[0], camFwd[2]) || 1, sl = Math.hypot(sunDir[0], sunDir[2]) || 1;
  const facing = Math.max(0, (camFwd[0] * sunDir[0] + camFwd[2] * sunDir[2]) / (fl * sl));
  const fogColor = horizon.map((v, i) => v + sunColor[i] * Math.pow(facing, 4) * 0.35 * sunset);
  return { sunDir, zenith, horizon, sunColor, skyLight, night, fogColor, day };
}

// ---------- world lifecycle ----------

function startWorld(seed, save) {
  if (world) world.dispose();
  particles = [];
  generator = createGenerator(seed);
  world = new World(seed, save ? save.edits : null, {
    onMesh: (c, r) => renderer.uploadChunk(c, r),
    onUnload: c => renderer.freeChunk(c),
  });
  player = new Player(world);
  const p = save && save.player ? save.player : generator.findSpawn();
  player.pos = [p.x, p.y, p.z];
  player.yaw = save && save.player ? save.player.yaw : Math.PI * 0.75;
  player.pitch = save && save.player ? save.player.pitch : 0;
  player.flying = !!(save && save.player && save.player.flying);
  player.onStep = id => sound.step(BLOCKS[id] ? BLOCKS[id].sound : 'stone');
  player.onSplash = () => sound.splash();
  player.autoJump = settings.autoJump;
  game.seed = seed;
  game.dayTime = save ? save.time : 0.03;
  game.hotbar = save && save.hotbar ? save.hotbar : DEFAULT_HOTBAR.slice();
  game.selected = save ? save.selected || 0 : 0;
  buildHotbar();
}

function saveGame() {
  if (!played || !world || !player) return;
  store(SAVE_KEY, {
    seed: game.seed, time: game.dayTime, hotbar: game.hotbar, selected: game.selected,
    player: { x: player.pos[0], y: player.pos[1], z: player.pos[2], yaw: player.yaw, pitch: player.pitch, flying: player.flying },
    edits: world.serializeEdits(),
  });
}

// ---------- modes and screens ----------

function setMode(m) {
  mode = m;
  $('title').classList.toggle('hidden', m !== 'title');
  $('loading').classList.toggle('hidden', m !== 'loading');
  $('pause').classList.toggle('hidden', m !== 'pause');
  $('inventory').classList.toggle('hidden', m !== 'inventory');
  $('hud').classList.toggle('hidden', !(m === 'play' || m === 'pause' || m === 'inventory') || hudHidden);
  mouse.left = mouse.right = false;
  keys.clear();
}

function requestLock() {
  const r = $('game').requestPointerLock();
  if (r && r.catch) r.catch(() => {});
}

function enterGame() {
  sound.unlock();
  played = true;
  setMode('loading');
  requestLock();
}

function openSettings(from) {
  settingsReturn = from;
  $('settings').classList.remove('hidden');
  if (from === 'pause') $('pause').classList.add('hidden');
}

function closeSettings() {
  $('settings').classList.add('hidden');
  if (settingsReturn === 'pause') $('pause').classList.remove('hidden');
  store(SETTINGS_KEY, settings);
}

function bindSettings() {
  const bind = (id, keyName, label, fmt = v => v) => {
    const el = $(id);
    el.value = settings[keyName];
    if (label) $(label).textContent = fmt(settings[keyName]);
    el.addEventListener('input', () => {
      settings[keyName] = Number(el.value);
      if (label) $(label).textContent = fmt(settings[keyName]);
      if (keyName === 'volume' && sound.master) sound.master.gain.value = settings.volume / 100;
    });
  };
  bind('set-rd', 'renderDistance', 'rd-val');
  bind('set-fov', 'fov', 'fov-val');
  bind('set-sens', 'sensitivity', 'sens-val');
  bind('set-vol', 'volume', 'vol-val');
  for (const [id, k] of [['set-bob', 'bobbing'], ['set-clouds', 'clouds'], ['set-autojump', 'autoJump']]) {
    $(id).checked = settings[k];
    $(id).addEventListener('change', () => { settings[k] = $(id).checked; if (player) player.autoJump = settings.autoJump; });
  }
}

// ---------- HUD ----------

function buildHotbar() {
  const bar = $('hotbar');
  bar.textContent = '';
  game.hotbar.forEach((id, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === game.selected ? ' selected' : '');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i + 1;
    const img = document.createElement('img');
    if (icons[id]) img.src = icons[id];
    img.alt = BLOCKS[id] ? BLOCKS[id].name : '';
    slot.append(num, img);
    bar.appendChild(slot);
  });
}

let nameTimer = 0;
function select(i) {
  if (i === game.selected) return;
  game.selected = (i + 9) % 9;
  equip = 1;
  buildHotbar();
  const b = BLOCKS[game.hotbar[game.selected]];
  $('item-name').textContent = b ? b.name : '';
  $('item-name').style.opacity = 1;
  nameTimer = 2;
}

function buildInventory() {
  const grid = $('inv-grid');
  for (const id of INVENTORY) {
    const btn = document.createElement('button');
    btn.className = 'inv-item';
    btn.title = BLOCKS[id].name;
    const img = document.createElement('img');
    img.src = icons[id];
    img.alt = BLOCKS[id].name;
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      game.hotbar[game.selected] = id;
      equip = 1;
      buildHotbar();
      sound.click();
    });
    grid.appendChild(btn);
  }
}

// ---------- interaction ----------

function brightnessAt(x, y, z, env) {
  const l = world.lightAt(x, y, z);
  const sky = Math.pow(0.8, 15 - l.sky) * Math.max(0.16, env.day);
  return Math.max(sky, Math.pow(0.82, 15 - l.blk), 0.05);
}

function spawnParticles(x, y, z, id, count, env) {
  const layer = FACE_TEX[id * 6];
  const bright = brightnessAt(x + 0.5, y + 0.5, z + 0.5, env);
  for (let i = 0; i < count; i++) {
    particles.push({
      x: x + 0.15 + Math.random() * 0.7, y: y + 0.15 + Math.random() * 0.7, z: z + 0.15 + Math.random() * 0.7,
      vx: (Math.random() - 0.5) * 3.2, vy: Math.random() * 3.5 + 1, vz: (Math.random() - 0.5) * 3.2,
      life: 0.5 + Math.random() * 0.6, layer, u: Math.floor(Math.random() * 3) * 0.25, v: Math.floor(Math.random() * 3) * 0.25,
      size: 0.09 + Math.random() * 0.09, bright,
    });
  }
  if (particles.length > 600) particles.splice(0, particles.length - 600);
}

function updateParticles(dt) {
  for (const p of particles) {
    p.vy -= 16 * dt;
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
    const id = world.getBlock(nx, ny, nz);
    if (id !== UNLOADED && SOLID[id]) {
      if (world.getBlock(p.x, ny, p.z) !== UNLOADED && SOLID[world.getBlock(p.x, ny, p.z)]) { p.vy = -p.vy * 0.25; p.vx *= 0.6; p.vz *= 0.6; }
      else { p.vx = -p.vx * 0.3; p.vz = -p.vz * 0.3; }
    } else { p.x = nx; p.y = ny; p.z = nz; }
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);
}

function isWater(x, y, z) { return world.getBlock(x, y, z) === B.WATER; }

function breakBlock(t, env) {
  const id = world.getBlock(t.x, t.y, t.z);
  if (id === UNLOADED || !BLOCKS[id] || BLOCKS[id].hardness === Infinity) return;
  // Water stays level instead of leaving a gap in lakes and oceans.
  const flood = isWater(t.x, t.y + 1, t.z) || (t.y <= SEA && (isWater(t.x + 1, t.y, t.z) || isWater(t.x - 1, t.y, t.z) || isWater(t.x, t.y, t.z + 1) || isWater(t.x, t.y, t.z - 1)));
  world.setBlock(t.x, t.y, t.z, flood ? B.WATER : B.AIR);
  spawnParticles(t.x, t.y, t.z, id, 18, env);
  sound.dig(BLOCKS[id].sound);
  const above = world.getBlock(t.x, t.y + 1, t.z);
  if (RENDER[above] === R_CROSS || RENDER[above] === R_TORCH) {
    world.setBlock(t.x, t.y + 1, t.z, B.AIR);
    spawnParticles(t.x, t.y + 1, t.z, above, 8, env);
  }
  breakProgress = 0;
  breakCooldown = 0.18;
}

function placeBlock(t) {
  const id = game.hotbar[game.selected];
  if (!id) return;
  let x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
  if (t.id === B.TALL_GRASS) { x = t.x; y = t.y; z = t.z; }
  const existing = world.getBlock(x, y, z);
  if (!(existing === B.AIR || existing === B.WATER || existing === B.TALL_GRASS)) return;
  const b = BLOCKS[id];
  const below = world.getBlock(x, y - 1, z);
  if (b.render === R_CROSS) {
    const ok = id === B.DEAD_BUSH ? [B.SAND, B.DIRT, B.GRASS] : [B.GRASS, B.DIRT, B.SNOWY_GRASS];
    if (!ok.includes(below)) return;
  }
  if (b.render === R_TORCH && !(below !== UNLOADED && SOLID[below])) return;
  if (b.solid) {
    const p = player.pos, h = player.height;
    if (x + 1 > p[0] - 0.3 && x < p[0] + 0.3 && y + 1 > p[1] && y < p[1] + h && z + 1 > p[2] - 0.3 && z < p[2] + 0.3) return;
  }
  if (world.setBlock(x, y, z, id)) {
    sound.place(b.sound);
    swing = 1;
  }
}

function interact(dt, env) {
  const eye = player.eyePos();
  const dir = forward(player.yaw, player.pitch);
  target = world.raycast(eye, dir, REACH);
  breakCooldown = Math.max(0, breakCooldown - dt);

  const breaking = mouse.left || mouse.clicked;
  mouse.clicked = false;
  if (breaking && target && breakCooldown === 0) {
    const k = `${target.x},${target.y},${target.z}`;
    if (k !== breakKey) { breakKey = k; breakProgress = 0; hitTimer = 0; }
    const b = BLOCKS[target.id];
    if (b.hardness === 0) { breakBlock(target, env); swing = 1; }
    else if (b.hardness !== Infinity) {
      breakProgress += dt / b.hardness;
      hitTimer -= dt;
      if (hitTimer <= 0) {
        hitTimer = 0.24;
        swing = 1;
        sound.hit(b.sound);
        spawnParticles(target.x, target.y, target.z, target.id, 2, env);
      }
      if (breakProgress >= 1) breakBlock(target, env);
    }
  } else if (!breaking || !target) {
    breakProgress = 0;
    breakKey = '';
  }

  if (mouse.right) {
    placeTimer -= dt;
    if (placeTimer <= 0 && target) { placeBlock(target); placeTimer = 0.22; }
  } else placeTimer = 0;
}

function pickBlock() {
  if (!target || !INVENTORY.includes(target.id)) return;
  const existing = game.hotbar.indexOf(target.id);
  if (existing >= 0) select(existing);
  else { game.hotbar[game.selected] = target.id; equip = 1; buildHotbar(); }
}

// ---------- held item ----------

function handMatrix(dt) {
  swing = Math.max(0, swing - dt / 0.28);
  equip = Math.max(0, equip - dt / 0.25);
  const s = Math.sin((1 - swing) * Math.PI) * (swing > 0 ? 1 : 0);
  const bob = settings.bobbing ? player.bobAmount : 0;
  const ph = player.bobPhase;
  // The hand lags slightly behind camera turns.
  let dyaw = player.yaw - lastYaw;
  if (dyaw > Math.PI) dyaw -= Math.PI * 2; else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
  handSwayX += (Math.max(-0.2, Math.min(0.2, dyaw * 2.5)) - handSwayX) * Math.min(1, dt * 10);
  handSwayY += (Math.max(-0.2, Math.min(0.2, (player.pitch - lastPitch) * 2.5)) - handSwayY) * Math.min(1, dt * 10);
  lastYaw = player.yaw; lastPitch = player.pitch;
  const b = BLOCKS[game.hotbar[game.selected]];
  const flat = b.render === R_CROSS, torch = b.render === R_TORCH;
  const drop = Math.sin(equip * Math.PI / 2) * 0.55;
  return compose(
    translation(0.56 + Math.sin(ph) * 0.03 * bob + handSwayX * 0.35 - s * 0.22, -0.5 - Math.abs(Math.cos(ph)) * 0.035 * bob - drop + handSwayY * 0.25 + s * 0.1, -0.9 - s * 0.15),
    rotationY(flat ? -0.3 : -0.78 + s * 0.5),
    rotationX(0.1 - s * 0.9),
    rotationZ(0.04 + s * 0.2),
    scaling(torch ? 0.62 : 0.4, torch ? 0.62 : 0.4, torch ? 0.62 : 0.4),
    translation(-0.5, torch ? -0.1 : -0.5, -0.5),
  );
}

// ---------- main loop ----------

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = (now - (lastFrame || now)) / 1000;
  const dt = Math.min(0.05, realDt);
  lastFrame = now;
  time += dt;
  frames++;
  debugTimer += realDt;

  const w = Math.floor(window.innerWidth * Math.min(window.devicePixelRatio || 1, 2));
  const h = Math.floor(window.innerHeight * Math.min(window.devicePixelRatio || 1, 2));
  renderer.resize(w, h);

  let camPos, yaw, pitch, roll = 0, dayTime;
  const input = {
    forward: keys.has('KeyW'), back: keys.has('KeyS'), left: keys.has('KeyA'), right: keys.has('KeyD'),
    jump: keys.has('Space'), sneak: keys.has('ShiftLeft') || keys.has('ShiftRight'), sprint: keys.has('ControlLeft') || keys.has('ControlRight'),
  };

  if (mode === 'title') {
    panoramaYaw += dt * 0.045;
    world.update(player.pos[0], player.pos[2], Math.min(settings.renderDistance, 8));
    camPos = [player.pos[0], player.pos[1] + 14, player.pos[2]];
    yaw = panoramaYaw; pitch = -0.2; dayTime = 0.06;
  } else {
    world.update(player.pos[0], player.pos[2], settings.renderDistance);
    if (mode === 'loading') {
      const r = 2, total = (2 * r + 1) ** 2;
      let ready = 0;
      const pcx = Math.floor(player.pos[0] / 16), pcz = Math.floor(player.pos[2] / 16);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const c = world.chunk(pcx + dx, pcz + dz); if (c && c.meshedVersion > 0) ready++; }
      $('load-bar').style.width = `${Math.round(ready / total * 100)}%`;
      if (ready === total) { setMode(locked ? 'play' : 'pause'); hintTimer = 14; $('hint').style.opacity = 1; }
    }
    const env0 = computeEnv(game.dayTime, forward(player.yaw, player.pitch));
    if (mode === 'play') {
      game.dayTime = (game.dayTime + dt / DAY_LENGTH * (keys.has('KeyT') ? 80 : 1)) % 1;
      player.update(dt, input);
      interact(dt, env0);
      saveTimer += dt;
      if (saveTimer > 15) { saveTimer = 0; saveGame(); }
    }
    const bob = settings.bobbing ? player.bobAmount : 0;
    const eye = player.eyePos();
    const ph = player.bobPhase;
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    camPos = [eye[0] + rx * Math.sin(ph) * 0.03 * bob, eye[1] + (Math.abs(Math.cos(ph)) * 0.07 - 0.04) * bob, eye[2] + rz * Math.sin(ph) * 0.03 * bob];
    yaw = player.yaw; pitch = player.pitch; roll = Math.sin(ph) * 0.006 * bob;
    dayTime = game.dayTime;
  }

  const camFwd = forward(yaw, pitch);
  const env = computeEnv(dayTime, camFwd);
  updateParticles(dt);
  const underwater = world.getBlock(camPos[0], camPos[1], camPos[2]) === B.WATER;
  const fovTarget = settings.fov + (player.sprinting ? (player.flying ? 14 : 9) : 0) - (underwater ? 6 : 0);
  fovCurrent += (fovTarget - fovCurrent) * (1 - Math.exp(-dt * 8));

  let hand = null;
  if (mode !== 'title' && !hudHidden) {
    const l = world.lightAt(camPos[0], camPos[1], camPos[2]);
    renderer.buildHand(game.hotbar[game.selected], (l.sky << 4) | l.blk);
    hand = { matrix: handMatrix(dt) };
  }

  const crackStage = breakProgress > 0 ? Math.min(9, Math.floor(breakProgress * 10)) : 0;
  renderer.render({
    camPos, yaw, pitch, roll, fov: fovCurrent, time, env, underwater,
    renderDistance: mode === 'title' ? Math.min(settings.renderDistance, 8) : settings.renderDistance,
    clouds: settings.clouds, chunks: world.chunks.values(),
    target: mode === 'play' || mode === 'pause' ? target : null,
    crack: mode === 'play' && breakProgress > 0 ? String(crackStage) : null,
    particles, hand,
  });

  if (nameTimer > 0) { nameTimer -= dt; if (nameTimer <= 0) $('item-name').style.opacity = 0; }
  if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) $('hint').style.opacity = 0; }
  if (debugTimer >= 0.5) {
    fps = Math.round(frames / debugTimer);
    frames = 0; debugTimer = 0;
    if (showDebug && mode !== 'title') {
      const p = player.pos, col = generator.column(Math.floor(p[0]), Math.floor(p[2]));
      const l = world.lightAt(p[0], p[1] + 1, p[2]);
      const hours = Math.floor(((dayTime * 24 + 6) % 24)), mins = Math.floor((dayTime * 24 * 60) % 60);
      $('debug').textContent = `Blockhaven  ${fps} fps\n` +
        `XYZ: ${p[0].toFixed(2)} / ${p[1].toFixed(2)} / ${p[2].toFixed(2)}\n` +
        `Chunk: ${Math.floor(p[0] / 16)}, ${Math.floor(p[2] / 16)}   Biome: ${BIOME_NAMES[col.biome]}\n` +
        `Light: sky ${l.sky} block ${l.blk}   Time: ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}\n` +
        `Chunks: ${world.chunks.size} loaded, ${renderer.stats.chunks} drawn   Quads: ${renderer.stats.quads.toLocaleString()}\n` +
        `Seed: ${game.seed}   ${player.flying ? 'Flying' : player.inWater ? 'Swimming' : player.sprinting ? 'Sprinting' : 'Walking'}` +
        (target ? `\nLooking at: ${BLOCKS[target.id].name} (${target.x}, ${target.y}, ${target.z})` : '');
    }
  }
}

// ---------- input ----------

function bindInput() {
  const canvas = $('game');
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (locked) {
      if (mode === 'pause') setMode('play');
    } else if (mode === 'play' && !suppressPause) {
      setMode('pause');
      saveGame();
    }
    suppressPause = false;
  });
  canvas.addEventListener('click', () => { if (mode === 'play' && !locked) requestLock(); });

  document.addEventListener('mousemove', e => {
    if (!locked || mode !== 'play') return;
    const s = settings.sensitivity / 100 * 0.0022;
    player.yaw -= e.movementX * s;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * s));
  });
  document.addEventListener('mousedown', e => {
    if (mode !== 'play' || !locked) return;
    if (e.button === 0) { mouse.left = true; mouse.clicked = true; }
    if (e.button === 2) {
      // Place on press rather than on the next frame, so quick clicks never get lost.
      mouse.right = true;
      if (target) placeBlock(target);
      placeTimer = 0.25;
    }
    if (e.button === 1) { e.preventDefault(); pickBlock(); }
  });
  document.addEventListener('mouseup', e => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('wheel', e => {
    if (mode !== 'play') return;
    select(game.selected + Math.sign(e.deltaY));
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (['Space', 'F1', 'F3', 'Tab'].includes(e.code) || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
    if (mode === 'play' || mode === 'inventory') {
      if (/^Digit[1-9]$/.test(e.code)) select(Number(e.code.slice(5)) - 1);
    }
    if (mode === 'play') {
      keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) player.jumpPressed(time);
      if (e.code === 'KeyE') { suppressPause = true; setMode('inventory'); document.exitPointerLock(); }
      if (e.code === 'F3') { showDebug = !showDebug; $('debug').classList.toggle('hidden', !showDebug); }
      if (e.code === 'F1') { hudHidden = !hudHidden; $('hud').classList.toggle('hidden', hudHidden); }
    } else if (mode === 'inventory' && (e.code === 'KeyE' || e.code === 'Escape')) {
      setMode('play');
      requestLock();
    }
  });
  document.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
  window.addEventListener('beforeunload', saveGame);
}

function bindMenus() {
  const save = load(SAVE_KEY);
  $('btn-continue').classList.toggle('hidden', !save);
  if (save) $('save-note').classList.remove('hidden');
  $('btn-continue').addEventListener('click', () => { sound.click(); enterGame(); });
  $('btn-new').addEventListener('click', () => {
    sound.unlock(); sound.click();
    $('new-world').classList.toggle('hidden');
    $('seed-input').focus();
  });
  const create = () => {
    sound.unlock(); sound.click();
    localStorage.removeItem(SAVE_KEY);
    startWorld(hashSeed($('seed-input').value), null);
    enterGame();
  };
  $('btn-create').addEventListener('click', create);
  $('seed-input').addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  $('btn-settings').addEventListener('click', () => { sound.unlock(); sound.click(); openSettings('title'); });
  $('btn-settings2').addEventListener('click', () => { sound.click(); openSettings('pause'); });
  $('btn-settings-done').addEventListener('click', () => { sound.click(); closeSettings(); });
  $('btn-controls').addEventListener('click', () => { sound.unlock(); sound.click(); $('controls').classList.remove('hidden'); });
  $('btn-controls-done').addEventListener('click', () => { sound.click(); $('controls').classList.add('hidden'); });
  $('btn-resume').addEventListener('click', () => { sound.click(); requestLock(); });
  $('btn-quit').addEventListener('click', () => {
    sound.click();
    saveGame();
    $('btn-continue').classList.remove('hidden');
    $('save-note').classList.remove('hidden');
    setMode('title');
  });
  $('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
}

function init() {
  try {
    renderer = new Renderer($('game'));
  } catch (e) {
    $('title').classList.add('hidden');
    $('error').classList.remove('hidden');
    $('error').textContent = `Blockhaven needs WebGL 2, which this browser or device doesn't provide. (${e.message})`;
    return;
  }
  const layers = generateTextures();
  renderer.setTextures(layers);
  icons = makeIcons(layers);
  sound = new Sound();
  sound.volume = settings.volume / 100;
  bindSettings();
  buildInventory();
  bindInput();
  bindMenus();
  const save = load(SAVE_KEY);
  startWorld(save ? save.seed : (Math.random() * 2147483647) | 0, save);
  setMode('title');
  requestAnimationFrame(frame);
}

init();
