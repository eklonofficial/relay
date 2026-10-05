// The map list (GDD §15.4). Each map module builds its grid on demand; builds are cached.
import omeletArena from './omelet-arena.js?v=muuo6ksf';

export const MAPS = [
  { id: 'omelet', name: 'Omelet Arena', build: omeletArena, maxPlayers: 6, modes: ['ffa', 'teams', 'spatula'], public: true },
];
const cache = new Map();
export function getMap(id) {
  const def = MAPS.find(m => m.id === id) || MAPS[0];
  if (!cache.has(def.id)) cache.set(def.id, def.build());
  return cache.get(def.id);
}
export const mapDef = id => MAPS.find(m => m.id === id) || MAPS[0];
// Public rotation for PLAY: a random public map that supports the chosen mode.
export function pickPublicMap(mode, rnd = Math.random) {
  const list = MAPS.filter(m => m.public && m.modes.includes(mode));
  return (list.length ? list : MAPS)[Math.floor(rnd() * (list.length || MAPS.length))].id;
}
