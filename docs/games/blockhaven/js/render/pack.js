// Resource packs: Java Edition style packs (.zip with assets/minecraft/textures/... and
// assets/minecraft/sounds/...). The bundled defaults and player-selected packs use the same
// matching path; a player's pack stays in this browser (IndexedDB) and is never uploaded.
import { SHEETS } from '../data/blocks.js?v=muujns32';

const DB = 'blockhaven-packs', STORE = 'packs', KEY = 'active';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE), req = fn(s);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}
export const savePack = (name, blob) => tx('readwrite', s => s.put({ name, blob, added: Date.now() }, KEY));
export const removePack = () => tx('readwrite', s => s.delete(KEY));
export const storedPack = () => tx('readonly', s => s.get(KEY)).catch(() => null);

// ---------------- zip reading (stored and deflated entries) ----------------
export class Zip {
  static async open(blob) {
    const z = new Zip();
    z.blob = blob;
    const tail = new DataView(await blob.slice(Math.max(0, blob.size - 65557)).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) {
      const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      if (head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21) throw new Error('This is a .rar file, which browsers cannot open. Extract it first (for example with 7-Zip or WinRAR), then zip the folder you need and choose that .zip.');
      if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) throw new Error('This is a .7z file, which browsers cannot open. Extract it first, then zip the folder you need and choose that .zip.');
      throw new Error('This file is not a .zip.');
    }
    const n = tail.getUint16(eocd + 10, true), size = tail.getUint32(eocd + 12, true), off = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await blob.slice(off, off + size).arrayBuffer());
    const dec = new TextDecoder();
    z.entries = new Map();
    for (let p = 0, k = 0; k < n && p < cd.byteLength; k++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
      const nl = cd.getUint16(p + 28, true), el = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), loff = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nl));
      if (!name.endsWith('/')) z.entries.set(name, { method, csize, usize, loff });
      p += 46 + nl + el + cl;
    }
    // Packs are often zipped with an extra top folder; find where assets/ starts.
    z.root = '';
    for (const name of z.entries.keys()) { const i = name.indexOf('assets/minecraft/'); if (i >= 0) { z.root = name.slice(0, i); break; } }
    return z;
  }
  has(path) { return this.entries.has(this.root + path); }
  list(prefix) { const p = this.root + prefix, out = []; for (const k of this.entries.keys()) if (k.startsWith(p)) out.push(k.slice(this.root.length)); return out; }
  async bytes(path) {
    const e = this.entries.get(this.root + path);
    if (!e) return null;
    const head = new DataView(await this.blob.slice(e.loff, e.loff + 30).arrayBuffer());
    const start = e.loff + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const raw = this.blob.slice(start, start + e.csize);
    if (e.method === 0) return new Uint8Array(await raw.arrayBuffer());
    if (e.method === 8) return new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    return null;
  }
  async text(path) { const b = await this.bytes(path); return b ? new TextDecoder().decode(b) : null; }
}

// ---------------- textures ----------------
// Our texture names -> Minecraft's block texture names.
const COLOR_RE = /^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)$/;
const FIXED = {
  smooth_stone_side: 'smooth_stone_slab_side', water: 'water_still', lava: 'lava_still', snow_block: 'snow', quartz_block: 'quartz_block_side',
  block_quartz: 'quartz_block_side', torch_top: 'torch', soul_torch_top: 'soul_torch', chest_side: '#entity/chest', chest_top: '#entity/chest', chest_front: '#entity/chest',
  bed_side: '#entity/bed', bed_top_foot: '#entity/bed', bed_top_head: '#entity/bed', magma_block: 'magma', purpur_pillar: 'purpur_pillar',
  end_portal: '#entity/end_portal', fire: 'fire_0', soul_fire: 'soul_fire_0', pointed_dripstone: 'pointed_dripstone_down_tip', campfire: 'campfire_fire',
  mangrove_roots: 'mangrove_roots_side', sweet_berry_bush: 'sweet_berry_bush_stage3', lantern_hanging: 'lantern', redstone_dust_line: 'redstone_dust_line0',
  lever_base: 'cobblestone', rs_torch_head_on: 'redstone_torch', rs_torch_head_off: 'redstone_torch_off', nether_wart_stage3: 'nether_wart_stage2', grass_block_snow: 'grass_block_snow',
  water_flow_top: 'water_flow', lava_flow_top: 'lava_flow', water_overlay: 'water_still',
};
export function packTextureName(n) {
  if (FIXED[n]) return FIXED[n];
  let m;
  if ((m = n.match(/^log_(\w+)_top$/))) return `${m[1]}_log_top`;
  if ((m = n.match(/^log_(\w+)$/))) return `${m[1]}_log`;
  if ((m = n.match(/^stem_(\w+)_top$/))) return `${m[1]}_stem_top`;
  if ((m = n.match(/^stem_(\w+)$/))) return `${m[1]}_stem`;
  if ((m = n.match(/^planks_(\w+)$/))) return `${m[1]}_planks`;
  if ((m = n.match(/^leaves_(\w+)$/))) return `${m[1]}_leaves`;
  if ((m = n.match(/^sapling_(\w+)$/))) return m[1] === 'mangrove' ? 'mangrove_propagule' : `${m[1]}_sapling`;
  if ((m = n.match(/^(stained_glass|wool|concrete|terracotta)_(\w+)$/)) && COLOR_RE.test(m[2])) return `${m[2]}_${m[1]}`;
  if ((m = n.match(/^deepslate_ore_(\w+)$/))) return `deepslate_${m[1]}_ore`;
  if ((m = n.match(/^ore_(\w+)$/))) return `${m[1]}_ore`;
  if ((m = n.match(/^door_(\w+)_(top|bottom)$/))) return `${m[1]}_door_${m[2]}`;
  if ((m = n.match(/^trapdoor_(\w+)$/))) return `${m[1]}_trapdoor`;
  if ((m = n.match(/^coral_block_(\w+)$/))) return `${m[1]}_coral_block`;
  if ((m = n.match(/^(skeleton|wither)_skull_\w+$/))) return null;
  if ((m = n.match(/^(pumpkin|melon)_stem_stage(\d)$/))) return `${m[1]}_stem`;
  if ((m = n.match(/^destroy_(\d)$/))) return `destroy_stage_${m[1]}`;
  return n;
}
// Item layer names -> Minecraft item texture names (FX layers that are item states).
const ITEM_FIXED = { crossbow: 'crossbow_standby', crossbow_loaded: 'crossbow_arrow', fishing_rod_cast: 'fishing_rod_cast', clock: 'clock_00', compass: 'compass_00', shield: null };

async function decodeImage(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  return bmp;
}
// The top square of an image (animated textures are vertical strips), scaled to 16x16.
function to16(bmp, sx = 0, sy = 0, sw = bmp.width, sh = Math.min(bmp.width, bmp.height)) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, 16, 16);
  return ctx.getImageData(0, 0, 16, 16).data;
}
// Copies a pack image over one of our 16x16 RGBA layers. Layers that the game tints (grass,
// leaves, water...) are marked with alpha 254, so the pack's greyscale pixels get tinted too.
function overlay(dst, src, forceTint = false) {
  let tinted = forceTint;
  for (let i = 3; i < dst.length; i += 4) if (dst[i] === 254) { tinted = true; break; }
  for (let i = 0; i < 1024; i += 4) {
    dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2];
    const a = src[i + 3];
    // Translucent texels (water, stained glass, slime, portal) keep their alpha, as in Java.
    dst[i + 3] = a >= 250 ? (tinted ? 254 : 255) : a < 8 ? 0 : a;
  }
}

// Ticks per frame of the vanilla animated textures (their .png.mcmeta); a pack's own .mcmeta wins.
const FRAMETIME = { water_still: 2, water_flow: 1, lava_still: 2, lava_flow: 3, nether_portal: 2, sea_lantern: 5, magma: 8, prismarine: 300, kelp: 2, kelp_plant: 2, seagrass: 2, tall_seagrass_top: 2, tall_seagrass_bottom: 2, fire_0: 1, fire_1: 1, soul_fire_0: 1, soul_fire_1: 1, campfire_fire: 2, soul_campfire_fire: 2 };
// Frame order: lava_still runs forwards then back, like its vanilla frame list.
const PINGPONG = new Set(['lava_still']);
async function animation(zip, mc, count) {
  let time = FRAMETIME[mc] ?? 2, order = null;
  try {
    const meta = await zip.text(`assets/minecraft/textures/block/${mc}.png.mcmeta`), a = meta && JSON.parse(meta).animation;
    if (a) { if (a.frametime) time = a.frametime; if (Array.isArray(a.frames)) order = a.frames.map(f => (typeof f === 'number' ? { i: f, t: time } : { i: f.index, t: f.time ?? time })); }
  } catch { /* use the defaults */ }
  if (!order) { order = []; for (let k = 0; k < count; k++) order.push({ i: k, t: time }); if (PINGPONG.has(mc)) for (let k = count - 2; k > 0; k--) order.push({ i: k, t: time }); }
  return order.filter(f => f.i >= 0 && f.i < count);
}
// Flowing liquid sides read the top-left quarter of the (32 px) flow frame at full size, as Java's
// side faces do; flowing tops (*_flow_top) take the whole frame.
const QUARTER = new Set(['water_flow', 'lava_flow']);

// Pack textures the game tints although our own versions are already coloured: leaves (but not
// cherry or azalea) and pumpkin and melon stems.
const TINTED = name => (/^leaves_/.test(name) && !/cherry|azalea/.test(name)) || /_stem_stage\d$/.test(name);
// Replaces generated block textures (names: our TEXTURES list) with the pack's; returns the count.
// Animated strips are recorded in anims (layer -> { frames, order }) for the renderer to play.
export async function applyBlockTextures(zip, names, layers, anims = null) {
  let n = 0;
  const sheets = new Map();
  await Promise.all(names.map(async (name, i) => {
    // A tile of a block-entity sheet (data/blocks.js SHEETS): cut from the pack's entity texture,
    // scaled to Java's size for it (high-resolution packs come down to it).
    const sh = name.match(/^(\w+)_sheet_(\d+)$/);
    if (sh && SHEETS[sh[1]]) {
      const [w, , path] = SHEETS[sh[1]];
      if (!sheets.has(path)) sheets.set(path, zip.bytes(`assets/minecraft/textures/${path}.png`).then(b => b && decodeImage(b)).catch(() => null));
      const bmp = await sheets.get(path);
      if (!bmp) return;
      const k = bmp.width / w, cols = w / 16, t = Number(sh[2]);
      overlay(layers[i], to16(bmp, (t % cols) * 16 * k, Math.floor(t / cols) * 16 * k, 16 * k, 16 * k));
      n++;
      return;
    }
    const mc = packTextureName(name);
    if (!mc || mc[0] === '#') return;
    const bytes = await zip.bytes(`assets/minecraft/textures/block/${mc}.png`);
    if (!bytes) return;
    try {
      const bmp = await decodeImage(bytes);
      const fw = bmp.width, crop = QUARTER.has(name) ? fw >> 1 : fw;
      const count = bmp.height > fw && bmp.height % fw === 0 ? bmp.height / fw : 1;
      if (anims) anims.delete(i);
      if (count > 1 && anims && name !== 'grass_block_side') {
        const tint = TINTED(name), frames = [];
        for (let k = 0; k < count; k++) { const f = new Uint8ClampedArray(layers[i]); overlay(f, to16(bmp, 0, k * fw, crop, crop), tint); frames.push(f); }
        anims.set(i, { frames, order: await animation(zip, mc, count) });
      }
      const px = to16(bmp, 0, 0, crop, crop);
      if (name === 'grass_block_side') {
        // Dirt side plus the tinted grass overlay, as the original layers them.
        overlay(layers[i], px);
        for (let k = 3; k < 1024; k += 4) layers[i][k] = 255;
        const ob = await zip.bytes('assets/minecraft/textures/block/grass_block_side_overlay.png');
        if (ob) { const o = to16(await decodeImage(ob)); for (let k = 0; k < 1024; k += 4) if (o[k + 3] > 128) { layers[i][k] = o[k]; layers[i][k + 1] = o[k + 1]; layers[i][k + 2] = o[k + 2]; layers[i][k + 3] = 254; } }
      } else overlay(layers[i], px, TINTED(name));
      n++;
    } catch { /* unreadable image: keep ours */ }
  }));
  return n;
}
// An entity texture (assets/minecraft/textures/<path>.png) as a 128x128 entity layer, drawn in its top-left
// corner at Java's size for it ([w, h]; a high-resolution pack's image is scaled down to that). With
// `over`, it is laid over that layer instead (Java's extra passes, like a villager's profession).
// null if the pack lacks it.
export async function readEntityTexture(zip, path, size = [64, 64], over = null, stretch = false) {
  const bytes = await zip.bytes(`assets/minecraft/textures/${path}.png`);
  if (!bytes) return null;
  try {
    const bmp = await decodeImage(bytes);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    if (over) ctx.putImageData(new ImageData(new Uint8ClampedArray(over), 128, 128), 0, 0);
    // (`stretch`: the image fills the layer, for a texture that wraps as it scrolls.)
    if (stretch) ctx.drawImage(bmp, 0, 0, 128, 128);
    else ctx.drawImage(bmp, 0, 0, size[0], Math.round(bmp.height * size[0] / bmp.width));
    return new Uint8ClampedArray(ctx.getImageData(0, 0, 128, 128).data);
  } catch { return null; }
}
// The cloud map (textures/environment/clouds.png) at the pack's own size: { w, h, data } or null.
export async function readCloudTexture(zip) {
  const bytes = await zip.bytes('assets/minecraft/textures/environment/clouds.png');
  if (!bytes) return null;
  try {
    const bmp = await decodeImage(bytes);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, data: new Uint8Array(ctx.getImageData(0, 0, bmp.width, bmp.height).data.buffer) };
  } catch { return null; }
}
// Armor layers (textures/models/armor/<material>_layer_<1|2>.png, 64x32 in Java's armor layout, or a
// multiple of it), as entity layers with the image in the top-left corner. Leather is greyscale in
// Java and tinted by its dye, so it is tinted with `leather` ([r, g, b]) and its overlay laid on top.
// Returns [[material, layer, pixels]] for the files the pack has.
export async function applyArmorTextures(zip, materials, leather) {
  const read = async name => {
    const bytes = await zip.bytes(`assets/minecraft/textures/models/armor/${name}.png`);
    if (!bytes) return null;
    const bmp = await decodeImage(bytes);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0, bmp.width, bmp.width / 2, 0, 0, 64, 32);
    return new Uint8ClampedArray(ctx.getImageData(0, 0, 128, 128).data);
  };
  const out = [];
  await Promise.all(materials.flatMap(mat => [1, 2].map(async l => {
    try {
      const px = await read(`${mat === 'golden' ? 'gold' : mat}_layer_${l}`);
      if (!px) return;
      if (mat === 'leather') {
        for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) px[i + k] = px[i + k] * leather[k] / 255;
        const over = await read(`leather_layer_${l}_overlay`);
        if (over) for (let i = 0; i < px.length; i += 4) if (over[i + 3] > 127) for (let k = 0; k < 4; k++) px[i + k] = over[i + k];
      }
      out.push([mat, l, px]);
    } catch { /* unreadable image: keep ours */ }
  })));
  return out;
}
// Replaces item sprites; `entries` is [[layerName, layerIndex, blockTextureFallback]].
export async function applyItemTextures(zip, entries, layers) {
  let n = 0;
  await Promise.all(entries.map(async ([name, idx, blockName]) => {
    const mc = name in ITEM_FIXED ? ITEM_FIXED[name] : name;
    let bytes = mc && await zip.bytes(`assets/minecraft/textures/item/${mc}.png`);
    if (!bytes && blockName) { const b = packTextureName(blockName); if (b && b[0] !== '#') bytes = await zip.bytes(`assets/minecraft/textures/block/${b}.png`); }
    if (!bytes) return;
    try {
      const px = to16(await decodeImage(bytes));
      const d = layers[idx];
      for (let k = 0; k < 1024; k += 4) { d[k] = px[k]; d[k + 1] = px[k + 1]; d[k + 2] = px[k + 2]; d[k + 3] = px[k + 3] >= 128 ? 255 : 0; }
      n++;
    } catch { /* keep ours */ }
  }));
  return n;
}

// ---------------- sounds ----------------
// Our sound names -> Minecraft sound files (paths under assets/minecraft/sounds/, without the
// trailing number and .ogg; a random numbered variant is picked).
const MAT_DIR = { stone: 'stone', wood: 'wood', grass: 'grass', gravel: 'gravel', sand: 'sand', snow: 'snow', glass: 'stone', cloth: 'cloth', metal: 'stone', slime: 'grass' };
export const SOUND_FILES = {
  pop: 'random/pop', xp: 'random/orb', levelup: 'random/levelup', hurt: 'damage/hit', eat: 'random/eat', burp: 'random/burp', drink: 'random/drink',
  bow: 'random/bow', arrow_hit: 'random/bowhit', explode: 'random/explode', fuse: 'random/fuse', fizz: 'random/fizz', fire: 'fire/fire', ignite: 'fire/ignite',
  door_open: 'random/door_open', door_close: 'random/door_close', chest_open: 'random/chestopen', chest_close: 'random/chestclosed', glass: 'random/glass',
  splash: 'random/splash', swim: 'liquid/swim', break_item: 'random/break', click: 'random/click', rs_click: 'random/click', piston_out: 'tile/piston/out',
  piston_in: 'tile/piston/in', thunder: 'ambient/weather/thunder', rain: 'ambient/weather/rain', rain_above: 'ambient/weather/rain', anvil: 'random/anvil_land', portal: 'portal/portal', portal_travel: 'portal/travel',
  teleport: 'mob/endermen/portal', throw: 'random/bow', firework: 'fireworks/launch', firework_blast: 'fireworks/blast', totem: 'item/totem/use_totem',
  shield_block: 'item/shield/block', xbow_shoot: 'item/crossbow/shoot', xbow_load: 'item/crossbow/loading_end', xbow_start: 'item/crossbow/loading_start', xbow_mid: 'item/crossbow/loading_middle',
  equip: 'item/armor/equip_generic', sweep: 'entity/player/attack/sweep', crit: 'entity/player/attack/crit', attack: 'entity/player/attack/strong',
  anvil_use: 'random/anvil_use', anvil_break: 'random/anvil_break', enchant: 'block/enchantment_table/enchant1',
};
export const NOTE_FILES = { harp: 'note/harp', bass: 'note/bass', basedrum: 'note/bd', snare: 'note/snare', hat: 'note/hat', bell: 'note/bell', flute: 'note/flute', chime: 'note/icechime', guitar: 'note/guitar', xylophone: 'note/xylobone', iron_xylophone: 'note/iron_xylophone', cow_bell: 'note/cow_bell', didgeridoo: 'note/didgeridoo', bit: 'note/bit', banjo: 'note/banjo', pling: 'note/pling' };
export const matSound = (kind, mat) => `${kind === 'step' ? 'step' : 'dig'}/${MAT_DIR[mat] || 'stone'}`;
export const MOB_DIR = { zombie: 'mob/zombie', skeleton: 'mob/skeleton', creeper: 'mob/creeper', spider: 'mob/spider', cow: 'mob/cow', pig: 'mob/pig', sheep: 'mob/sheep', chicken: 'mob/chicken', wolf: 'mob/wolf', cat: 'mob/cat', horse: 'mob/horse', enderman: 'mob/endermen', villager: 'mob/villager', blaze: 'mob/blaze', ghast: 'mob/ghast', slime: 'mob/slime', witch: 'mob/witch', golem: 'mob/irongolem' };

// Collects the numbered variants of each sound so lookups are instant during play.
export function indexSounds(zip) {
  const files = zip.list('assets/minecraft/sounds/').filter(p => p.endsWith('.ogg'));
  const idx = new Map();
  for (const f of files) {
    const rel = f.slice('assets/minecraft/sounds/'.length, -4), base = rel.replace(/\d+$/, '');
    if (!idx.has(base)) idx.set(base, []);
    idx.get(base).push(f);
    if (base !== rel) { if (!idx.has(rel)) idx.set(rel, [f]); }
  }
  return idx;
}
