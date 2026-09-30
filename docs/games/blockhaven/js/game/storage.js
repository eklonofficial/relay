// Multiple world saves in IndexedDB (falls back to memory if unavailable).
const DB = 'blockhaven', STORE = 'worlds';
let dbp = null;
const mem = new Map();
function open() {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
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
export async function deleteWorld(id) { return tx('readwrite', s => (s ? s.delete(id) : mem.delete(id))); }
