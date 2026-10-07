// Saved settings and the local profile (GDD §20–22). Everything lives in this browser only, under
// keys namespaced to the game; every access is wrapped because storage can throw or come back empty.
import { DEFAULT_KEYS } from './input.js?v=muyk0718';

export const SETTINGS_KEY = 'shockshellers.settings.v1';
export const PROFILE_KEY = 'shockshellers.profile.v1';

// Mouse speed: Chromebook trackpads want it fast; a PC mouse with raw input (no OS scaling) at full
// speed turns ~0.16° a count, a 360 in a few centimetres, too twitchy for small corrections.
const CROS = /\bCrOS\b/.test(globalThis.navigator?.userAgent || '');
export const MOUSE_DEFAULT = CROS ? 100 : 40;

export const DEFAULT_SETTINGS = {
  keys: { ...DEFAULT_KEYS }, mouseSpeed: MOUSE_DEFAULT, invertMouse: false, rawInput: true,
  padSpeed: 50, padInvert: false,
  volume: 60, holdToAim: true, chat: true, safeNames: false, autoDetail: true, preventClose: false,
  shake: true, centerDot: true, hitMarkers: true, fov: 72, seenHowTo: false, botChat: true,
  quality: 'auto', // 'auto' (adapts to the frame rate) | 'low' | 'medium' | 'high'
  aimAssist: 'auto', // 'auto' (Chromebook trackpads and gamepads) | 'on' | 'off'
};

function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }

export function loadSettings() {
  const s = read(SETTINGS_KEY) || {};
  // The defaults moved (melee V → F, aim right mouse → left Shift): players still on the old defaults
  // get the new ones; anything they chose themselves stays.
  if (s.keys && !s.keysRev) { if (s.keys.melee === 'KeyV') s.keys.melee = 'KeyF'; if (s.keys.scope === 'M2') s.keys.scope = 'ShiftLeft'; }
  // Players on a PC still at the old default (the maximum) get the new one.
  if (!s.mouseRev && s.mouseSpeed === 100 && !CROS) s.mouseSpeed = MOUSE_DEFAULT;
  return { ...DEFAULT_SETTINGS, ...s, keysRev: 2, mouseRev: 1, keys: { ...DEFAULT_KEYS, ...(s.keys || {}) } };
}
export const saveSettings = s => write(SETTINGS_KEY, s);

const NAME_A = ['Noob', 'Sunny', 'Crispy', 'Fluffy', 'Golden', 'Speedy', 'Sneaky', 'Salty', 'Spicy', 'Lucky', 'Happy', 'Cracked'];
const NAME_B = ['Bird', 'Yolk', 'Shell', 'Chick', 'Hen', 'Egg', 'Rooster', 'Omelet', 'Nugget', 'Duck'];
export function randomName() { return NAME_A[Math.floor(Math.random() * NAME_A.length)] + NAME_B[Math.floor(Math.random() * NAME_B.length)] + Math.floor(Math.random() * 90 + 10); }

export function emptyStats() { return { kills: 0, deaths: 0, bestStreak: 0, byWeapon: {}, deathsByWeapon: {}, byMode: {}, privateKills: 0, publicKills: 0, roostCaptures: 0, roostWins: 0, challenges: 0, damage: 0, games: 0 }; }
export function loadProfile() {
  const p = read(PROFILE_KEY) || {};
  return {
    name: typeof p.name === 'string' && p.name ? p.name : randomName(),
    primary: p.primary || 'yolk47', mode: p.mode || 'ffa',
    coins: Number.isFinite(p.coins) ? p.coins : 0,
    owned: Array.isArray(p.owned) ? p.owned : [],
    equip: { color: 0, hat: 'none', pattern: 'none', pcolor: 13, stamp: 'none', skin: 'factory', ...(p.equip || {}) },
    stats: { ...emptyStats(), ...(p.stats || {}) },
    challenges: p.challenges || null,
    recentMaps: Array.isArray(p.recentMaps) ? p.recentMaps.filter(id => typeof id === 'string').slice(-6) : [],
  };
}
export const saveProfile = p => write(PROFILE_KEY, p);
