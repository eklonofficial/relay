// Map playlists for PLAY. The new maps (bar the 1v1-sized ones) are dealt into fixed playlists of
// about six: shuffled once with a fixed seed, then dealt a size class at a time, so each playlist
// mixes big and small maps that have nothing else in common, and is the same list every time. A
// match on a playlist moves through it in order, round after round.
import { MAPS, mapsBySize, sizeOf } from './index.js?v=muztsdw7';

const NAMES = ['Sunny Side Up', 'Scrambled', 'Over Easy', 'Hard Boiled', 'Poached', 'Benedict', 'Deviled', 'Soft Boiled',
  'Omelette', 'Frittata', 'Shakshuka', 'Quiche', 'Soufflé', 'Custard', 'Meringue', 'Eggnog', 'Carbonara', 'Huevos Rancheros'];
const PER_LIST = 6;

let lists = null;
export function playlists() {
  if (lists) return lists;
  let s = 0x2545f491;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // One size class after another (each shuffled), dealt round the playlists like cards.
  const maps = mapsBySize('new').filter(m => sizeOf(m).id !== 'duel'), n = Math.max(1, Math.round(maps.length / PER_LIST));
  const bySize = new Map();
  for (const m of maps) { const k = sizeOf(m).id; if (!bySize.has(k)) bySize.set(k, []); bySize.get(k).push(m.id); }
  const deck = [...bySize.values()].flatMap(shuffle);
  lists = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: NAMES[i] || `Playlist ${i + 1}`, maps: [] }));
  deck.forEach((id, i) => lists[i % n].maps.push(id));
  for (const l of lists) shuffle(l.maps);
  return lists;
}
export const playlistById = id => playlists().find(l => l.id === id) || null;
export const randomPlaylist = (rnd = Math.random, not = null) => {
  const others = playlists().filter(l => l.id !== not), pool = others.length ? others : playlists();
  return pool[Math.floor(rnd() * pool.length)].id;
};
// The map after `current` in a playlist that has the mode (null when none of it does).
export function nextInPlaylist(id, current, mode) {
  const ids = (playlistById(id)?.maps || []).filter(m => MAPS.find(d => d.id === m)?.modes.includes(mode));
  if (!ids.length) return null;
  return ids[(ids.indexOf(current) + 1) % ids.length];
}
