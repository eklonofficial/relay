// The map list (GDD §15.4). Each map module builds its grid on demand; builds are cached.
import barnyard from './barnyard.js?v=muwpta38';
import yolkQuarry from './yolk-quarry.js?v=muwpta38';
import henHouse from './hen-house.js?v=muwpta38';
import sunnySide from './sunny-side.js?v=muwpta38';
import coopVille from './coop-ville.js?v=muwpta38';
import moonHatch from './moon-hatch.js?v=muwpta38';
import eggTemple from './egg-temple.js?v=muwpta38';
import omeletArena from './omelet-arena.js?v=muwpta38';

export const MAPS = [
  { id: 'barnyard', name: 'Barnyard', build: barnyard, maxPlayers: 18, modes: ['ffa', 'teams', 'spatula', 'roost'], public: true },
  { id: 'quarry', name: 'Yolk Quarry', build: yolkQuarry, maxPlayers: 14, modes: ['ffa', 'teams', 'spatula', 'roost'], public: true },
  { id: 'henhouse', name: 'Hen House', build: henHouse, maxPlayers: 12, modes: ['ffa', 'teams', 'spatula', 'roost'], public: true },
  { id: 'sunny', name: 'Sunny Side', build: sunnySide, maxPlayers: 16, modes: ['ffa', 'teams', 'spatula', 'roost'], public: true },
  { id: 'coopville', name: 'Coop Ville', build: coopVille, maxPlayers: 18, modes: ['ffa', 'teams', 'spatula', 'roost'], public: true },
  { id: 'moon', name: 'Moon Hatch', build: moonHatch, maxPlayers: 18, modes: ['ffa', 'teams', 'spatula', 'roost'], public: true },
  { id: 'temple', name: 'Egg Temple', build: eggTemple, maxPlayers: 18, modes: ['ffa', 'teams', 'spatula'], public: true },
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
