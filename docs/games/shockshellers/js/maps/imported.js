// The imported maps (assets/maps/pack.json, made by tools/maps/import_maps.py): each is a list of
// placed pieces (blocks.js) plus spawns, spatula points, roost zones and pickups. This turns one into
// the same map object the hand-written maps build (dsl.js finish()): a grid, metadata and markers.
import { MapGrid } from './grid.js?v=muzi7z97';
import { PIECE } from './pieces.js?v=muzi7z97';
import { BLOCKS } from './blocks.js?v=muzi7z97';
import { MAP_ASSETS } from './map-assets.js?v=muzi7z97';
import { fetchAsset } from '../util/asset.js?v=muzi7z97';

const BLOCK_PIECE = BLOCKS.map(b => PIECE['b:' + b.name]);
// Each map's sky, and the built-in sky its lighting follows (render/renderer.js SKIES).
const SKY_KIND = { 'clear-day': 'day', midnight: 'night', 'star-field': 'space', 'candy-sky': 'dusk' };
const ROOST_HEIGHT = 3;

let pack = null;
export async function loadPack() {
  pack ??= JSON.parse(new TextDecoder().decode(await fetchAsset(MAP_ASSETS['pack.json'])));
  return pack;
}
export const packMaps = () => pack || [];

// The way to face from (x, y, z): of 16 headings, the one with the most open floor-level view
// (out to VIEW cells, or the map's edge), with a nudge towards the map's middle (cx, cz). Yaw 0
// looks down -z.
const VIEW = 24, hit = {};
function lookout(grid, x, y, z, cx, cz) {
  const toMid = Math.atan2(-(cx - x), -(cz - z));
  let best = toMid, bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const yaw = i / 16 * Math.PI * 2, dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const edge = Math.min(dx > 0 ? (grid.w - x) / dx : dx < 0 ? -x / dx : VIEW, dz > 0 ? (grid.d - z) / dz : dz < 0 ? -z / dz : VIEW);
    const far = Math.min(VIEW, edge), d = grid.raycast(x, y + 1.1, z, dx, 0, dz, far, hit, true) ? hit.t : far;
    const score = d + 4 * Math.cos(yaw - toMid);
    if (score > bestScore) { best = yaw; bestScore = score; }
  }
  return best;
}

export function buildImported(def) {
  const grid = new MapGrid(def.w, def.h, def.d), p = def.place;
  for (let i = 0; i < p.length; i += 5) grid.set(p[i + 1], p[i + 2], p[i + 3], BLOCK_PIECE[p[i]], p[i + 4]);
  const cx = def.w / 2, cz = def.d / 2;
  // Spawns stand on the floor under where they were placed (some maps stack them in columns, so those
  // collapse into one) and look down the longest clear view, leaning towards the middle of the map
  // (blue team 1, red team 2).
  const seen = new Set(), spawns = [];
  for (const [x, sy, z, team] of def.spawns) {
    const y = grid.floorBelow(x, sy + 0.5, z), key = `${x},${y},${z},${team}`;
    if (seen.has(key)) continue;
    seen.add(key); spawns.push({ x, y, z, team, yaw: lookout(grid, x, y, z, cx, cz) });
  }
  const roostZones = def.zones.map(([x0, z0, x1, z1, y]) => ({ x0, z0, x1: x1 + 1, z1: z1 + 1, y0: y, y1: y + ROOST_HEIGHT, cx: (x0 + x1 + 1) / 2, cy: y, cz: (z0 + z1 + 1) / 2 }));
  const fogFar = Math.max(60, Math.min(200, 2.2 / def.fog.density));
  return {
    grid, spawns, roostZones,
    spatulaSpawns: def.spatula.map(([x, y, z]) => ({ x, y, z })),
    items: def.items.map(([kind, x, y, z]) => ({ kind, x, y, z })),
    overview: { cx, cy: def.h * 0.45, cz, r: Math.max(def.w, def.d) * 0.62 },
    meta: {
      id: def.id, name: def.name, maxPlayers: def.maxPlayers, modes: Object.fromEntries(['ffa', 'teams', 'spatula', 'roost'].map(m => [m, def.modes.includes(m)])),
      availability: 'both', sky: SKY_KIND[def.sky] || 'day', skybox: def.sky, theme: 'arena',
      fog: { color: def.fog.color, near: fogFar * 0.35, far: fogFar },
      sun: { dir: def.sun.dir, color: def.sun.color, intensity: 2.2 }, ambient: 1.0,
    },
  };
}
