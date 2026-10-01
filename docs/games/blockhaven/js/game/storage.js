// Multiple world saves in IndexedDB (falls back to memory if unavailable). Worlds imported from
// Java Edition keep their chunks in a second store, compressed, keyed "<world id>/<dim>/<cx>,<cz>".
const DB = 'blockhaven', STORE = 'worlds', CHUNKS = 'chunks';
let dbp = null;
const mem = new Map();
function open() {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      const r = indexedDB.open(DB, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
async function tx(mode, fn, store = STORE) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : r);
    t.onerror = () => reject(t.error);
  });
}
export async function listWorlds() {
  const all = await tx('readonly', s => (s ? s.getAll() : { result: [...mem.values()] }));
  return (all || []).map(w => ({ id: w.id, name: w.name, lastPlayed: w.lastPlayed, mode: w.mode, type: w.type, seed: w.seed, day: w.day, thumb: w.thumb })).sort((a, b) => b.lastPlayed - a.lastPlayed);
}
export async function loadWorld(id) { return tx('readonly', s => (s ? s.get(id) : { result: mem.get(id) })); }
export async function saveWorld(w) { w.lastPlayed = Date.now(); return tx('readwrite', s => (s ? s.put(w) : mem.set(w.id, w))); }
export async function deleteWorld(id) {
  await deleteChunks(id);
  return tx('readwrite', s => (s ? s.delete(id) : mem.delete(id)));
}

// ---------------- imported chunks ----------------
const memChunks = new Map();
const pack = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
const unpack = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
// A chunk is stored as one buffer: ids (65536), meta (65536), biomes (256), heights (256).
export async function encodeChunk(c) {
  const raw = new Uint8Array(65536 * 2 + 512);
  raw.set(c.ids, 0); raw.set(c.meta, 65536); raw.set(c.biomes, 131072); raw.set(c.heights, 131328);
  return pack(raw);
}
export async function decodeChunk(bytes) {
  const raw = await unpack(bytes);
  return { ids: raw.slice(0, 65536), meta: raw.slice(65536, 131072), biomes: raw.slice(131072, 131328), heights: raw.slice(131328, 131584) };
}
export async function putChunks(entries) {
  return tx('readwrite', s => { for (const [k, v] of entries) { if (s) s.put(v, k); else memChunks.set(k, v); } }, CHUNKS);
}
export async function getChunk(key) { return tx('readonly', s => (s ? s.get(key) : { result: memChunks.get(key) }), CHUNKS); }
export async function deleteChunks(worldId) {
  const lo = `${worldId}/`, hi = `${worldId}/\uffff`;
  for (const k of [...memChunks.keys()]) if (k.startsWith(lo)) memChunks.delete(k);
  return tx('readwrite', s => { if (s) s.delete(IDBKeyRange.bound(lo, hi)); }, CHUNKS);
}
