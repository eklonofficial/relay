// Java Edition worlds in and out.
//
// Import: a zipped world folder (level.dat + region/*.mca, DIM-1, DIM1) becomes a Blockhaven
// world whose generated chunks are the Java ones (kept compressed in IndexedDB); anything past
// them is generated as usual from the world's seed. 1.13+ worlds are supported (paletted chunks).
// Export: a world becomes a zip of a 1.20.1 world folder: every chunk that was imported, visited
// or edited, the spawn, time, and the player's position and inventory.
//
// Heights: Blockhaven worlds are 256 tall with the sea surface at y=64; Java's overworld runs
// -64..319 with its sea surface at y=62, so overworld blocks shift by 2 (Java y -2..253 is kept).
// The Nether and the End keep their y.
import { BLOCKS, B, CHUNK, HEIGHT, DIM, SHAPE } from '../data/blocks.js?v=musmwdx0';
import { BIOMES } from '../gen/biomes.js?v=musmwdx0';
import { I } from '../data/items.js?v=musmwdx0';
import { ENCHANTS } from '../data/enchantments.js?v=musmwdx0';
import { createGenerator } from '../gen/index.js?v=musmwdx0';
import { readNbt, writeNbt, readRegion, writeRegion, maybeGunzip, gzip, TAG, byte, short, int, long, float, double, string, compound, list, longArray } from './nbt.js?v=musmwdx0';
import { toJava, fromJava, biomeToJava } from './javablocks.js?v=musmwdx0';
import { encodeChunk, decodeChunk, putChunks, getChunk } from './storage.js?v=musmwdx0';
import { SAVE_VERSION } from './migrate.js?v=musmwdx0';

const DATA_VERSION = 3465; // 1.20.1
const Y_SHIFT = [2, 0, 0];
const DIM_DIRS = ['region/', 'DIM-1/region/', 'DIM1/region/'];
const CC = CHUNK * CHUNK;

// ---------------- packed arrays ----------------
// Bits from an NBT long array (as [hi, lo] words), bit 0 being the low bit of the first long.
function readBits(words, pos, n) {
  let v = 0, got = 0;
  while (got < n) {
    const L = pos >>> 6, k = pos & 63, w = k < 32 ? words[2 * L + 1] : words[2 * L], kk = k & 31;
    const take = Math.min(n - got, 32 - kk);
    v |= ((w >>> kk) & ((1 << take) - 1)) << got;
    got += take; pos += take;
  }
  return v;
}
function writeBits(words, pos, n, v) {
  let put = 0;
  while (put < n) {
    const L = pos >>> 6, k = pos & 63, wi = k < 32 ? 2 * L + 1 : 2 * L, kk = k & 31;
    const take = Math.min(n - put, 32 - kk), mask = ((1 << take) - 1) >>> 0;
    words[wi] = (words[wi] & ~((mask << kk) >>> 0)) | ((((v >>> put) & mask) << kk) >>> 0);
    put += take; pos += take;
  }
}
// Index of entry i: packed without spanning longs (1.16+), or as one continuous bit stream.
const entryPos = (i, bits, span) => (span ? i * bits : Math.floor(i / Math.floor(64 / bits)) * 64 + (i % Math.floor(64 / bits)) * bits);
function unpack(words, count, bits, span) {
  const out = new Uint16Array(count);
  if (!words || !bits) return out;
  for (let i = 0; i < count; i++) out[i] = readBits(words, entryPos(i, bits, span), bits);
  return out;
}
function pack(values, bits) {
  const per = Math.floor(64 / bits), longs = Math.ceil(values.length / per), words = new Uint32Array(longs * 2);
  for (let i = 0; i < values.length; i++) writeBits(words, entryPos(i, bits, false), bits, values[i]);
  return words;
}
const bitsFor = n => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

// ---------------- zip ----------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// Stored (uncompressed) zip: region files and level.dat are compressed already.
export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name), crc = crc32(data);
    const h = new Uint8Array(30 + nb.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(8, 0, true); v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, nb.length, true); h.set(nb, 30);
    const c = new Uint8Array(46 + nb.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true); c.set(nb, 46);
    parts.push(h, data); central.push(c); off += h.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const e = new Uint8Array(22), ev = new DataView(e.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}

// ---------------- Java chunk -> Blockhaven ----------------
const BIOME_ID = new Map(BIOMES.map((b, i) => [b.key, i]));
const LEGACY_BIOMES = { 0: 'ocean', 1: 'plains', 2: 'desert', 3: 'windswept_hills', 4: 'forest', 5: 'taiga', 6: 'swamp', 7: 'river', 8: 'nether_wastes', 9: 'the_end', 10: 'frozen_ocean', 11: 'frozen_river', 12: 'snowy_plains', 14: 'mushroom_fields', 16: 'beach', 21: 'jungle', 24: 'deep_ocean', 25: 'stony_shore', 26: 'snowy_beach', 27: 'birch_forest', 29: 'dark_forest', 30: 'snowy_taiga', 32: 'old_growth_taiga', 35: 'savanna', 37: 'badlands', 44: 'warm_ocean', 46: 'cold_ocean' };
const biomeIndex = name => {
  const k = String(name).replace(/^minecraft:/, '');
  return BIOME_ID.get(k) ?? BIOME_ID.get({ small_end_islands: 'floating_isles', end_midlands: 'end_highlands', end_barrens: 'the_end', lukewarm_ocean: 'warm_ocean', deep_lukewarm_ocean: 'warm_ocean', deep_cold_ocean: 'cold_ocean', deep_frozen_ocean: 'frozen_ocean', sparse_jungle: 'jungle', windswept_forest: 'windswept_hills', windswept_gravelly_hills: 'windswept_hills', windswept_savanna: 'savanna', savanna_plateau: 'savanna', wooded_badlands: 'badlands', old_growth_birch_forest: 'birch_forest', old_growth_pine_taiga: 'old_growth_taiga', old_growth_spruce_taiga: 'old_growth_taiga', deep_dark: 'dripstone_caves' }[k]) ?? BIOME_ID.get('plains');
};
const CONTAINERS = /chest|barrel|shulker_box|dispenser|dropper|hopper/;

// Items keep their wear, enchantments (stored ones on books), anvil cost and custom name.
function itemFromJava(t) {
  const key = String(t.id || '').replace(/^minecraft:/, '');
  if (!I[key]) return null;
  const count = Math.max(1, Math.min(I[key].stack || 64, Number(t.Count ?? t.count ?? 1)));
  const out = { key, count }, tg = t.tag || {};
  if (tg.Damage && I[key].durability) out.dmg = Math.min(I[key].durability - 1, tg.Damage | 0);
  const tag = {};
  const ench = list => Object.fromEntries((list || []).map(e => [String(e.id || '').replace(/^minecraft:/, ''), Math.max(1, Number(e.lvl) | 0)]).filter(([id]) => ENCHANTS[id]));
  if (tg.Enchantments && tg.Enchantments.length) tag.ench = ench(tg.Enchantments);
  if (tg.StoredEnchantments && tg.StoredEnchantments.length) tag.stored = ench(tg.StoredEnchantments);
  if (tg.RepairCost) tag.rc = tg.RepairCost | 0;
  if (tg.display && tg.display.Name) { try { const n = JSON.parse(tg.display.Name); tag.name = typeof n === 'string' ? n : n.text || ''; } catch { /* plain text */ } }
  for (const k of ['ench', 'stored']) if (tag[k] && !Object.keys(tag[k]).length) delete tag[k];
  if (!tag.name) delete tag.name;
  if (Object.keys(tag).length) out.tag = tag;
  return out;
}
function itemToJava(s, slot) {
  if (!s || !s.key) return null;
  const o = { id: string(`minecraft:${s.key}`), Count: byte(Math.min(127, s.count || 1)) };
  if (slot !== undefined) o.Slot = byte(slot);
  const tag = {}, t = s.tag || {};
  if (s.dmg) tag.Damage = int(s.dmg | 0);
  const ench = e => list(TAG.COMPOUND, Object.entries(e).map(([id, lv]) => compound({ id: string(`minecraft:${id}`), lvl: short(lv) })));
  if (t.ench && Object.keys(t.ench).length) tag.Enchantments = ench(t.ench);
  if (t.stored && Object.keys(t.stored).length) tag.StoredEnchantments = ench(t.stored);
  if (t.rc) tag.RepairCost = int(t.rc);
  if (t.name) tag.display = compound({ Name: string(JSON.stringify({ text: t.name })) });
  if (Object.keys(tag).length) o.tag = compound(tag);
  return o;
}

function javaChunkToOurs(nbt, dim) {
  const dv = nbt.DataVersion | 0, lvl = nbt.Level || nbt;
  const status = String(lvl.Status || 'full').replace(/^minecraft:/, '');
  if (!['full', 'spawn', 'heightmaps', 'light', 'initialize_light', 'features', 'postprocessed', 'fullchunk'].includes(status)) return null;
  const sections = nbt.sections || lvl.Sections;
  if (!Array.isArray(sections)) return null;
  const shift = Y_SHIFT[dim];
  const c = { cx: lvl.xPos | 0, cz: lvl.zPos | 0, ids: new Uint8Array(CC * HEIGHT), meta: new Uint8Array(CC * HEIGHT), biomes: new Uint8Array(CC), heights: new Uint8Array(CC), blockEntities: [] };
  let any = false, biomesSet = false;
  for (const sec of sections) {
    const Y = sec.Y | 0;
    const pal = sec.block_states ? sec.block_states.palette : sec.Palette;
    const data = sec.block_states ? sec.block_states.data : sec.BlockStates;
    if (Array.isArray(pal) && pal.length) {
      const states = pal.map(e => fromJava(e.Name || 'minecraft:air', e.Properties));
      const bits = pal.length > 1 ? Math.max(4, Math.ceil(Math.log2(pal.length))) : 0;
      const idx = unpack(data, 4096, bits, dv < 2529);
      for (let i = 0; i < 4096; i++) {
        const y = Y * 16 + (i >> 8) + shift;
        if (y < 0 || y >= HEIGHT) continue;
        const s = states[idx[i]] ?? 0;
        if (!(s & 255)) continue;
        const o = (i & 255) + y * CC;
        c.ids[o] = s & 255; c.meta[o] = s >> 8; any = true;
      }
    }
    // Biomes: the section around the sea surface decides each column's biome.
    if (sec.biomes && Array.isArray(sec.biomes.palette) && Y * 16 <= 64 - shift && 64 - shift < Y * 16 + 16) {
      const bp = sec.biomes.palette.map(biomeIndex), bi = unpack(sec.biomes.data, 64, bp.length > 1 ? bitsFor(bp.length) : 0, false);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.biomes[x + z * 16] = bp[bi[(x >> 2) + (z >> 2) * 4]] ?? 0;
      biomesSet = true;
    }
  }
  if (!biomesSet) {
    const legacy = lvl.Biomes;
    const fill = id => c.biomes.fill(id);
    if (legacy && legacy.length >= 256) {
      const per = legacy.length === 256;
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const n = per ? legacy[x + z * 16] : legacy[16 * 4 + (z >> 2) * 4 + (x >> 2)];
        c.biomes[x + z * 16] = biomeIndex(LEGACY_BIOMES[n] || 'plains');
      }
    } else fill(biomeIndex(dim === DIM.NETHER ? 'nether_wastes' : dim === DIM.END ? 'the_end' : 'plains'));
  }
  if (!any) return null;
  // The overworld's lowest layer is bedrock, as in a generated world.
  if (dim === DIM.OVERWORLD) for (let i = 0; i < CC; i++) { c.ids[i] = B.BEDROCK; c.meta[i] = 0; }
  for (let i = 0; i < CC; i++) { let y = HEIGHT - 1; while (y > 0 && !c.ids[i + y * CC]) y--; c.heights[i] = y; }
  for (const be of nbt.block_entities || lvl.TileEntities || []) {
    const id = String(be.id || '').replace(/^minecraft:/, '');
    if (!CONTAINERS.test(id) || !Array.isArray(be.Items)) continue;
    const size = id === 'hopper' ? 5 : id === 'dispenser' || id === 'dropper' ? 9 : 27;
    const items = new Array(size).fill(null);
    for (const t of be.Items) { const s = t.Slot | 0; if (s >= 0 && s < size) items[s] = itemFromJava(t); }
    c.blockEntities.push({ type: id === 'hopper' ? 'hopper' : 'chest', x: be.x | 0, y: (be.y | 0) + shift, z: be.z | 0, items });
  }
  return c;
}

// ---------------- import ----------------
// What lies beyond a Java world's saved chunks, from its own generator settings: 'void' (void
// and empty flat worlds, typical for downloaded maps), 'flat', or 'terrain' (normal generation).
export function javaGenerator(D) {
  const gs = D.WorldGenSettings;
  if (gs && gs.dimensions) {
    const g = gs.dimensions['minecraft:overworld'] && gs.dimensions['minecraft:overworld'].generator;
    const t = String((g && g.type) || '').replace(/^minecraft:/, '');
    if (t === 'flat') return ((g.settings && g.settings.layers) || []).some(l => !/(^|:)air$/.test(String(l.block))) ? 'flat' : 'void';
    if (t === 'debug') return 'void';
    return 'terrain';
  }
  const n = String(D.generatorName || '').toLowerCase();
  if (n === 'flat') {
    const o = D.generatorOptions, layers = o && typeof o === 'object' ? o.layers || [] : null;
    if (layers) return layers.some(l => !/(^|:)air$/.test(String(l.block))) ? 'flat' : 'void';
    return /(stone|dirt|grass|bedrock|sand|\d+\*?[1-9])/.test(String(o || '2;7,2x3,2')) ? 'flat' : 'void';
  }
  if (n === 'debug_all_block_states') return 'void';
  return 'terrain';
}
// A world border smaller than the whole world: chunks outside it stay empty.
function javaBorder(D) {
  const size = Number(D.BorderSize ?? 6e7);
  return size > 0 && size < 1e6 ? { x: Number(D.BorderCenterX || 0), z: Number(D.BorderCenterZ || 0), size } : null;
}
// True when chunk (cx, cz) of an imported world is empty space rather than generated terrain.
export function importedVoidAt(java, cx, cz) {
  if (!java) return false;
  if (java.beyond === 'void') return true;
  const b = java.border;
  if (b) { const h = b.size / 2; if (cx * 16 + 16 <= b.x - h || cx * 16 >= b.x + h || cz * 16 + 16 <= b.z - h || cz * 16 >= b.z + h) return true; }
  return false;
}
export const emptyChunk = () => ({ ids: new Uint8Array(CC * HEIGHT), meta: new Uint8Array(CC * HEIGHT), biomes: new Uint8Array(CC).fill(BIOME_ID.get('plains') ?? 0), heights: new Uint8Array(CC) });

// A helpful message for a zip that is not a Java world.
function whatIsThis(names) {
  const has = re => names.some(n => re.test(n));
  if (has(/(^|\/)shaders\.properties$/) || has(/(^|\/)shaders\/(program|lib|world-?\d)\//)) {
    return 'This is a shader pack (for OptiFine or Iris), not a world. Blockhaven has its own shaders built in, so shader packs are not used. If the download also came with a map, import the folder that contains level.dat.';
  }
  if (has(/(^|\/)pack\.mcmeta$/) && has(/(^|\/)assets\//)) return 'This is a resource pack, not a world. Load it from Options -> Resource Packs instead.';
  if (has(/(^|\/)levelname\.txt$/) || has(/(^|\/)db\/.*\.ldb$/)) return 'This is a Bedrock Edition world, which is not supported. Only Java Edition worlds (1.13 or newer) can be imported.';
  if (has(/\.mca$/)) return 'This zip has region files but no level.dat. Zip the whole world folder (the one with level.dat in it), not just its region folder.';
  return 'No Java world found in this zip. Zip the world folder itself: the one that contains level.dat and a region folder (in Minecraft: Singleplayer -> select the world -> Edit -> Open World Folder).';
}

// zip: a Zip (render/pack.js). Returns the new world's save record.
export async function importJavaWorld(zip, onProgress = () => {}, opts = {}) {
  const names = [...zip.entries.keys()];
  const shortest = re => names.filter(n => re.test(n)).sort((a, b) => a.length - b.length)[0];
  const levelPath = shortest(/(^|\/)level\.dat$/) || shortest(/(^|\/)level\.dat_old$/);
  if (!levelPath) throw new Error(whatIsThis(names));
  const root = levelPath.slice(0, levelPath.lastIndexOf('/') + 1);
  zip.root = '';
  const level = readNbt(await maybeGunzip(await zip.bytes(levelPath)));
  const D = level.Data || level;
  if ((D.version | 0) !== 19133 && !D.DataVersion) throw new Error('This world is from before Minecraft 1.13, which is not supported.');
  const seed = D.WorldGenSettings ? D.WorldGenSettings.seed : D.RandomSeed;
  // Normal worlds may still be maps that are meant to end at their edges: the player decides.
  let beyond = javaGenerator(D);
  if (beyond === 'terrain' && opts.askBeyond && !(await opts.askBeyond())) beyond = 'void';
  const seedNum = Number(BigInt.asIntN(32, BigInt(seed ?? 0)));
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const regions = [];
  for (let dim = 0; dim < 3; dim++) for (const n of names) {
    const m = n.startsWith(root + DIM_DIRS[dim]) && /r\.(-?\d+)\.(-?\d+)\.mca$/.exec(n.slice((root + DIM_DIRS[dim]).length));
    if (m && !n.slice((root + DIM_DIRS[dim]).length).includes('/')) regions.push({ dim, path: n });
  }
  if (!regions.length) throw new Error('This world has no region files.');
  const dims = {}, java = { dims: {}, beyond, border: javaBorder(D) };
  let done = 0, chunks = 0;
  for (const r of regions) {
    onProgress(done / regions.length, `Converting region ${done + 1} of ${regions.length}...`);
    const bytes = await zip.bytes(r.path);
    if (bytes && bytes.length) {
      const list = await readRegion(bytes), batch = [];
      const d = dims[r.dim] || (dims[r.dim] = { edits: {}, populated: [], blockEntities: {} });
      const keys = java.dims[r.dim] || (java.dims[r.dim] = []);
      for (const { nbt } of list) {
        const c = javaChunkToOurs(nbt, r.dim);
        if (!c) continue;
        const key = `${c.cx},${c.cz}`;
        batch.push([`${id}/${r.dim}/${key}`, await encodeChunk(c)]);
        keys.push(key); d.populated.push(key); chunks++;
        for (const be of c.blockEntities) d.blockEntities[`${be.x},${be.y},${be.z}`] = be;
      }
      await putChunks(batch);
    }
    done++;
  }
  if (!chunks) throw new Error('No finished chunks were found in this world.');
  const gameType = D.GameType | 0, hardcore = !!D.hardcore;
  const P = D.Player;
  const meta = {
    id, name: String(D.LevelName || 'Java World').slice(0, 32), seed: seedNum, seedText: String(seed ?? seedNum), type: beyond === 'flat' ? 'flat' : 'default',
    mode: hardcore ? 'hardcore' : ['survival', 'creative', 'adventure', 'spectator'][gameType] || 'survival', hardcore,
    difficulty: ['peaceful', 'easy', 'normal', 'hard'][D.Difficulty | 0] || 'normal', cheats: !!D.allowCommands, created: Date.now(),
    time: (((Number(D.DayTime ?? 0) % 24000) + 24000) % 24000) / 24000, day: Math.floor(Number(D.DayTime ?? 0) / 24000),
    spawn: [Number(D.SpawnX | 0) + 0.5, Number(D.SpawnY | 0) + Y_SHIFT[0], Number(D.SpawnZ | 0) + 0.5],
    dims, java, saveVersion: SAVE_VERSION,
  };
  if (P && Array.isArray(P.Pos)) {
    const pd = /nether/.test(P.Dimension) || P.Dimension === -1 ? DIM.NETHER : /end/.test(P.Dimension) || P.Dimension === 1 ? DIM.END : DIM.OVERWORLD;
    meta.player = { pos: [Number(P.Pos[0]), Number(P.Pos[1]) + Y_SHIFT[pd], Number(P.Pos[2])], yaw: -Number(P.Rotation?.[0] || 0) * Math.PI / 180, pitch: -Number(P.Rotation?.[1] || 0) * Math.PI / 180, dim: pd, flying: false };
    const inv = { main: new Array(36).fill(null), armor: new Array(4).fill(null), offhand: [null], selected: P.SelectedItemSlot | 0 };
    for (const t of P.Inventory || []) {
      const s = t.Slot | 0, it = itemFromJava(t);
      if (s >= 0 && s < 36) inv.main[s] = it; else if (s >= 100 && s <= 103) inv.armor[103 - s] = it; else if (s === -106) inv.offhand[0] = it;
    }
    meta.inventory = inv;
  }
  if (!meta.player) meta.player = { pos: meta.spawn.slice(), yaw: 0, pitch: 0, dim: DIM.OVERWORLD, flying: false };
  onProgress(1, `Imported ${chunks} chunks.`);
  return meta;
}

// ---------------- Blockhaven -> Java ----------------
function ourChunkToJava(c, dim, cx, cz, bes) {
  const shift = Y_SHIFT[dim], minY = dim === DIM.OVERWORLD ? -4 : 0, maxY = dim === DIM.OVERWORLD ? 19 : 15;
  const at = (x, y, z) => (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= HEIGHT ? -1 : c.ids[x + z * 16 + y * CC]);
  const sections = [];
  const biomeNames = [...new Set(c.biomes)].map(b => `minecraft:${biomeToJava(BIOMES[b]?.key || 'plains')}`);
  const biomeIdx = new Uint16Array(64);
  for (let i = 0; i < 64; i++) { const x = (i & 3) * 4 + 2, z = ((i >> 2) & 3) * 4 + 2; biomeIdx[i] = biomeNames.indexOf(`minecraft:${biomeToJava(BIOMES[c.biomes[x + z * 16]]?.key || 'plains')}`); }
  const biomes = compound({ palette: list(TAG.STRING, biomeNames), ...(biomeNames.length > 1 ? { data: longArray(pack(biomeIdx, bitsFor(biomeNames.length))) } : {}) });
  const memo = new Map();
  for (let Y = minY; Y <= maxY; Y++) {
    const palette = [], index = new Map(), vals = new Uint16Array(4096);
    for (let i = 0; i < 4096; i++) {
      const jy = Y * 16 + (i >> 8), y = jy + shift, x = i & 15, z = (i >> 4) & 15;
      let key;
      if (dim === DIM.OVERWORLD && jy === -64) key = 'bedrock';
      else if (y < 0 || (dim === DIM.OVERWORLD && y <= 4 && at(x, y, z) === B.BEDROCK)) key = jy < 0 && dim === DIM.OVERWORLD ? 'deepslate' : 'stone';
      else if (y >= HEIGHT) key = 'air';
      if (key) {
        let k = index.get(key);
        if (k === undefined) { k = palette.length; index.set(key, k); palette.push({ Name: string(`minecraft:${key}`) }); }
        vals[i] = k; continue;
      }
      const o = x + z * 16 + y * CC, id = c.ids[o], m = c.meta[o];
      const needsNb = BLOCKS[id] && (BLOCKS[id].shape === SHAPE.FENCE || BLOCKS[id].shape === SHAPE.PANE || id === B.NOTE_BLOCK || id === B.MISC);
      const sk = needsNb ? null : id | (m << 8);
      let j = sk !== null ? memo.get(sk) : null;
      if (!j) { j = toJava(id, m, needsNb ? (dx, dy, dz) => at(x + dx, y + dy, z + dz) : undefined); if (sk !== null) memo.set(sk, j); }
      const pk = j.props ? j.name + JSON.stringify(j.props) : j.name;
      let k = index.get(pk);
      if (k === undefined) {
        k = palette.length; index.set(pk, k);
        const e = { Name: string(`minecraft:${j.name}`) };
        if (j.props) e.Properties = compound(Object.fromEntries(Object.entries(j.props).map(([a, b]) => [a, string(b)])));
        palette.push(e);
      }
      vals[i] = k;
    }
    const bs = { palette: list(TAG.COMPOUND, palette) };
    if (palette.length > 1) bs.data = longArray(pack(vals, Math.max(4, Math.ceil(Math.log2(palette.length)))));
    sections.push({ Y: byte(Y), block_states: compound(bs), biomes });
  }
  const blockEntities = [];
  for (const be of bes) {
    if (be.type !== 'chest' && be.type !== 'hopper') continue;
    const jy = be.y - shift, id = c.ids[(be.x & 15) + (be.z & 15) * 16 + be.y * CC];
    const name = be.type === 'hopper' ? 'hopper' : id === B.MISC ? 'barrel' : id === B.DISPENSER ? 'dispenser' : id === B.DROPPER ? 'dropper' : 'chest';
    const items = (be.items || []).map((s, i) => itemToJava(s, i)).filter(Boolean);
    blockEntities.push({ id: string(`minecraft:${name}`), x: int(be.x), y: int(jy), z: int(be.z), keepPacked: byte(0), Items: list(TAG.COMPOUND, items) });
  }
  return writeNbt(compound({
    DataVersion: int(DATA_VERSION), xPos: int(cx), zPos: int(cz), yPos: int(minY), Status: string('minecraft:full'),
    LastUpdate: long(0), InhabitedTime: long(0), isLightOn: byte(0),
    sections: list(TAG.COMPOUND, sections), block_entities: list(TAG.COMPOUND, blockEntities),
    block_ticks: list(TAG.COMPOUND, []), fluid_ticks: list(TAG.COMPOUND, []), PostProcessing: list(TAG.LIST, []),
    structures: compound({ References: compound({}), starts: compound({}) }),
  }));
}

function levelDat(w, player) {
  const seed = BigInt(w.seedText && /^-?\d+$/.test(w.seedText) ? w.seedText : w.seed | 0);
  const dimGen = (type, settings, source) => compound({ type: string(type), generator: compound({ type: string('minecraft:noise'), settings: string(settings), biome_source: compound(source) }) });
  const P = player ? compound({
    Pos: list(TAG.DOUBLE, player.pos.map(Number)), Rotation: list(TAG.FLOAT, [-(player.yaw || 0) * 180 / Math.PI, -(player.pitch || 0) * 180 / Math.PI]),
    Dimension: string(`minecraft:${['overworld', 'the_nether', 'the_end'][player.dim | 0]}`), playerGameType: int(['survival', 'creative', 'adventure', 'spectator'].indexOf(w.mode === 'hardcore' ? 'survival' : w.mode)),
    Inventory: list(TAG.COMPOUND, player.items), SelectedItemSlot: int(player.selected | 0), Health: float(20), foodLevel: int(20), DataVersion: int(DATA_VERSION),
    abilities: compound({ flying: byte(0), mayfly: byte(w.mode === 'creative' || w.mode === 'spectator' ? 1 : 0), instabuild: byte(w.mode === 'creative' ? 1 : 0), invulnerable: byte(w.mode === 'creative' ? 1 : 0), mayBuild: byte(1), flySpeed: float(0.05), walkSpeed: float(0.1) }),
  }) : undefined;
  const time = BigInt(Math.floor(((w.day || 0) + (w.time ?? 0)) * 24000));
  const spawn = w.spawn || [0, 66, 0];
  return writeNbt(compound({
    Data: compound({
      DataVersion: int(DATA_VERSION), version: int(19133), initialized: byte(1), LevelName: string(w.name || 'Blockhaven World'),
      Version: compound({ Id: int(DATA_VERSION), Name: string('1.20.1'), Series: string('main'), Snapshot: byte(0) }),
      GameType: int(Math.max(0, ['survival', 'creative', 'adventure', 'spectator'].indexOf(w.mode === 'hardcore' ? 'survival' : w.mode))),
      hardcore: byte(w.hardcore || w.mode === 'hardcore' ? 1 : 0), allowCommands: byte(w.cheats ? 1 : 0),
      Difficulty: byte(Math.max(0, ['peaceful', 'easy', 'normal', 'hard'].indexOf(w.difficulty || 'normal'))), DifficultyLocked: byte(0),
      SpawnX: int(Math.floor(spawn[0])), SpawnY: int(Math.floor(spawn[1]) - Y_SHIFT[0]), SpawnZ: int(Math.floor(spawn[2])), SpawnAngle: float(0),
      Time: long(time), DayTime: long(time), LastPlayed: long(Date.now()), raining: byte(0), thundering: byte(0), rainTime: int(0), thunderTime: int(0), clearWeatherTime: int(0),
      WasModded: byte(0), ServerBrands: list(TAG.STRING, ['vanilla']),
      DataPacks: compound({ Enabled: list(TAG.STRING, ['vanilla']), Disabled: list(TAG.STRING, []) }),
      GameRules: compound({}),
      WorldGenSettings: compound({
        seed: long(seed), generate_features: byte(1), bonus_chest: byte(0),
        dimensions: compound({
          // A map that ends at its edges stays that way in Java: an empty (void) world around it.
          'minecraft:overworld': w.java && w.java.beyond === 'void'
            ? compound({ type: string('minecraft:overworld'), generator: compound({ type: string('minecraft:flat'), settings: compound({ layers: list(TAG.COMPOUND, []), biome: string('minecraft:the_void'), lakes: byte(0), features: byte(0), structure_overrides: list(TAG.STRING, []) }) }) })
            : dimGen('minecraft:overworld', 'minecraft:overworld', { type: string('minecraft:multi_noise'), preset: string('minecraft:overworld') }),
          'minecraft:the_nether': dimGen('minecraft:the_nether', 'minecraft:nether', { type: string('minecraft:multi_noise'), preset: string('minecraft:nether') }),
          'minecraft:the_end': dimGen('minecraft:the_end', 'minecraft:end', { type: string('minecraft:the_end') }),
        }),
      }),
      Player: P,
    }),
  }));
}

// w: a world save record. Returns a Blob (zip of the world folder).
export async function exportJavaWorld(w, onProgress = () => {}) {
  const folder = (w.name || 'Blockhaven World').replace(/[^\w\- ]+/g, '').trim() || 'Blockhaven World';
  const files = [];
  const jobs = [];
  for (let dim = 0; dim < 3; dim++) {
    const d = (w.dims || {})[dim] || {};
    const keys = new Set([...(w.java?.dims?.[dim] || []), ...(d.populated || []), ...Object.keys(d.edits || {})]);
    if (dim === DIM.OVERWORLD && !keys.size) {
      // A world never played still exports its spawn area.
      const s = w.spawn || [0, 0, 0], scx = Math.floor(s[0] / 16), scz = Math.floor(s[2] / 16);
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) keys.add(`${scx + dx},${scz + dz}`);
    }
    for (const k of keys) jobs.push([dim, k]);
  }
  const gens = [], imported = dim => new Set(w.java?.dims?.[dim] || []);
  const impSets = [imported(0), imported(1), imported(2)];
  const regions = new Map();
  let n = 0;
  for (const [dim, key] of jobs) {
    if (++n % 8 === 0) { onProgress(n / jobs.length * 0.95, `Converting chunk ${n} of ${jobs.length}...`); await new Promise(r => setTimeout(r)); }
    const [cx, cz] = key.split(',').map(Number);
    let c = null;
    if (impSets[dim].has(key)) { const raw = await getChunk(`${w.id}/${dim}/${key}`); if (raw) c = await decodeChunk(raw); }
    if (!c && importedVoidAt(w.java, cx, cz)) c = emptyChunk();
    if (!c) { const g = gens[dim] || (gens[dim] = createGenerator(w.seed, dim, w.type || 'default')); c = g.generateChunk(cx, cz); }
    const d = (w.dims || {})[dim] || {};
    const edits = d.edits?.[key];
    if (edits) for (let i = 0; i < edits.length; i += 2) { c.ids[edits[i]] = edits[i + 1] & 255; c.meta[edits[i]] = edits[i + 1] >> 8; }
    const bes = Object.values(d.blockEntities || {}).filter(be => Math.floor(be.x / 16) === cx && Math.floor(be.z / 16) === cz);
    const bytes = ourChunkToJava(c, dim, cx, cz, bes);
    const rk = `${dim}/${cx >> 5}.${cz >> 5}`;
    if (!regions.has(rk)) regions.set(rk, []);
    regions.get(rk).push({ lx: cx & 31, lz: cz & 31, bytes });
  }
  for (const [rk, chunks] of regions) {
    const [dim, rest] = rk.split('/');
    files.push([`${folder}/${DIM_DIRS[dim]}r.${rest}.mca`, await writeRegion(chunks)]);
  }
  // The player.
  let player = null;
  if (w.player) {
    const items = [];
    const inv = w.inventory || {};
    (inv.main || []).forEach((s, i) => { const t = itemToJava(s, i); if (t) items.push(t); });
    (inv.armor || []).forEach((s, i) => { const t = itemToJava(s, 103 - i); if (t) items.push(t); });
    (inv.offhand || []).forEach(s => { const t = itemToJava(s, -106); if (t) items.push(t); });
    const pd = w.player.dim | 0;
    player = { pos: [w.player.pos[0], w.player.pos[1] - Y_SHIFT[pd], w.player.pos[2]], yaw: w.player.yaw, pitch: w.player.pitch, dim: pd, items, selected: inv.selected };
  }
  files.unshift([`${folder}/level.dat`, await gzip(levelDat(w, player))]);
  onProgress(1, 'Done.');
  return { blob: makeZip(files), name: `${folder}.zip` };
}

export { javaChunkToOurs, ourChunkToJava, readBits, pack, unpack };
