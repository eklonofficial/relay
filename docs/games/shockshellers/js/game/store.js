// Saved settings and the local profile (GDD §20–22). Everything lives in this browser only, under
// keys namespaced to the game; every access is wrapped because storage can throw or come back empty.
import { DEFAULT_KEYS } from './input.js?v=muuo6ksf';

export const SETTINGS_KEY = 'shockshellers.settings.v1';
export const PROFILE_KEY = 'shockshellers.profile.v1';

export const DEFAULT_SETTINGS = {
  keys: { ...DEFAULT_KEYS }, mouseSpeed: 100, invertMouse: false, rawInput: true,
  padSpeed: 50, padInvert: false,
  volume: 60, holdToAim: true, chat: true, safeNames: false, autoDetail: true, preventClose: false,
  shake: true, centerDot: true, hitMarkers: true, fov: 72, seenHowTo: false,
};

function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }

export function loadSettings() {
  const s = read(SETTINGS_KEY) || {};
  return { ...DEFAULT_SETTINGS, ...s, keys: { ...DEFAULT_KEYS, ...(s.keys || {}) } };
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
    equip: { color: 0, hat: 'none', stamp: 'none', ...(p.equip || {}) },
    stats: { ...emptyStats(), ...(p.stats || {}) },
    challenges: p.challenges || null,
  };
}
export const saveProfile = p => write(PROFILE_KEY, p);
