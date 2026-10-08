// The map list (GDD §15.4). Two sets: the legacy maps, written by hand (maps/*.js), and the new
// maps, imported (imported.js; loaded at start-up by loadMaps()). PLAY and the next rounds draw only
// from the new ones; a custom match can use either. Every map has a size class, from its walkable
// floor, and a natural number of players for that floor (what PLAY fills with bots). Builds are cached.
import barnyard from './barnyard.js?v=muziihfj';
import yolkQuarry from './yolk-quarry.js?v=muziihfj';
import henHouse from './hen-house.js?v=muziihfj';
import sunnySide from './sunny-side.js?v=muziihfj';
import coopVille from './coop-ville.js?v=muziihfj';
import moonHatch from './moon-hatch.js?v=muziihfj';
import eggTemple from './egg-temple.js?v=muziihfj';
import omeletArena from './omelet-arena.js?v=muziihfj';
import { loadPack, packMaps, buildImported } from './imported.js?v=muziihfj';
import { PIECES } from './pieces.js?v=muziihfj';

export const MAPS = [
  { id: 'barnyard', name: 'Barnyard', build: barnyard, maxPlayers: 18, modes: ['ffa', 'teams', 'spatula', 'roost'], public: false, set: 'legacy' },
  { id: 'quarry', name: 'Yolk Quarry', build: yolkQuarry, maxPlayers: 14, modes: ['ffa', 'teams', 'spatula', 'roost'], public: false, set: 'legacy' },
  { id: 'henhouse', name: 'Hen House', build: henHouse, maxPlayers: 12, modes: ['ffa', 'teams', 'spatula', 'roost'], public: false, set: 'legacy' },
  { id: 'sunny', name: 'Sunny Side', build: sunnySide, maxPlayers: 16, modes: ['ffa', 'teams', 'spatula', 'roost'], public: false, set: 'legacy' },
  { id: 'coopville', name: 'Coop Ville', build: coopVille, maxPlayers: 18, modes: ['ffa', 'teams', 'spatula', 'roost'], public: false, set: 'legacy' },
  { id: 'moon', name: 'Moon Hatch', build: moonHatch, maxPlayers: 18, modes: ['ffa', 'teams', 'spatula', 'roost'], public: false, set: 'legacy' },
  { id: 'temple', name: 'Egg Temple', build: eggTemple, maxPlayers: 18, modes: ['ffa', 'teams', 'spatula'], public: false, set: 'legacy' },
  { id: 'omelet', name: 'Omelet Arena', build: omeletArena, maxPlayers: 6, modes: ['ffa', 'teams', 'spatula'], public: false, set: 'legacy' },
];
// The new maps, once loaded.
export async function loadMaps() {
  const pack = await loadPack();
  if (MAPS.some(m => m.set === 'new')) return;
  // (A map's alternate version shares its name: that one is "… II".)
  for (const def of pack) if (def.id.endsWith('-alt') && pack.some(d => d !== def && d.name === def.name)) def.name += ' II';
  for (const def of pack) MAPS.push({ id: def.id, name: def.name, build: () => buildImported(def), maxPlayers: def.maxPlayers, modes: def.modes, public: true, set: 'new', walk: def.walk, thumb: def.thumb });
}

// Size classes, largest first, by walkable floor (cells an egg can stand on).
export const SIZES = [
  { id: 'huge', name: 'Huge', min: 600 }, { id: 'large', name: 'Large', min: 440 }, { id: 'medium', name: 'Medium', min: 300 },
  { id: 'small', name: 'Small', min: 200 }, { id: 'duel', name: '1v1', min: 0 },
];
const FLOOR_PER_PLAYER = 45;
// Walkable floor of a map: cells whose top an egg can stand on with two clear cells above.
export function walkable(def) {
  if (def.walk === undefined) {
    const g = getMap(def.id).grid, top = (x, y, z) => { let t = -1; if (PIECES[g.get(x, y, z)].blocksPlayers) for (const b of g.boxes(x, y, z)) t = Math.max(t, b[4]); return t; };
    let n = 0;
    for (let y = 0; y < g.h; y++) for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) if (top(x, y, z) >= 0.5 && top(x, y + 1, z) < 0 && top(x, y + 2, z) < 0) n++;
    def.walk = n;
  }
  return def.walk;
}
export const sizeOf = def => SIZES.find(s => walkable(def) >= s.min);
// How many players a map wants: about one per FLOOR_PER_PLAYER cells of floor, two on a 1v1 map,
// never more than it holds.
export function naturalPlayers(def) {
  if (sizeOf(def).id === 'duel') return 2;
  return Math.max(2, Math.min(def.maxPlayers, Math.round(walkable(def) / FLOOR_PER_PLAYER)));
}
// A set's maps, largest first.
export const mapsBySize = set => MAPS.filter(m => m.set === set).sort((a, b) => walkable(b) - walkable(a) || a.name.localeCompare(b.name));

const cache = new Map();
export function getMap(id) {
  const def = MAPS.find(m => m.id === id) || MAPS[0];
  if (!cache.has(def.id)) cache.set(def.id, def.build());
  return cache.get(def.id);
}
export const mapDef = id => MAPS.find(m => m.id === id) || MAPS[0];
// Public rotation for PLAY: a random public map that supports the chosen mode, never one of the
// last few you played (recent: map ids, newest last) while there are others to choose from.
export function pickPublicMap(mode, rnd = Math.random, recent = []) {
  const pub = MAPS.filter(m => m.public), list = pub.filter(m => m.modes.includes(mode)), all = list.length ? list : pub.length ? pub : MAPS;
  const avoid = new Set(recent.slice(-Math.min(recent.length, all.length - 1)));
  const fresh = all.filter(m => !avoid.has(m.id)), pool = fresh.length ? fresh : all;
  return pool[Math.floor(rnd() * pool.length)].id;
}
