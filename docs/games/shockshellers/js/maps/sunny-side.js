// Sunny Side (GDD §15.4): two grassy hills with a valley between, for 16. Each hilltop holds a low
// stone fort; a long wooden bridge spans the valley between the forts (the exposed fast route), while
// the valley floor below offers rocks, trees and a stream bed for the covered route. Mid-range lanes.
import { Builder, MAT } from './dsl.js?v=muvmfsft';

export default function sunnySide() {
  const W = 40, D = 30, b = new Builder(W, 12, D);
  // Two round hills (one per side) and a gentle valley between them.
  // Each hill has a flat summit (radius 5) for the fort, then falls away smoothly.
  const hill = (x, z, cx, cz, r, h) => { const d = Math.hypot(x - cx, (z - cz) * 1.2), f = 5; return d >= r ? 0 : d <= f ? h : h * (Math.cos((d - f) / (r - f) * Math.PI) + 1) / 2; };
  // Point-symmetric (so mirrored props land on matching ground): two hills and a gently rolling valley.
  const roll = (x, z) => 0.4 * Math.sin(x * 0.4) * Math.cos(z * 0.3);
  const height = (x, z) => Math.max(hill(x, z, 8, 15, 11, 5), hill(x, z, W - 1 - 8, D - 1 - 15, 11, 5), 0.6 + (roll(x, z) + roll(W - 1 - x, D - 1 - z)) / 2);
  b.terrain(0, 0, W - 1, D - 1, height, MAT.dirt, MAT.grass, true);
  // A dry, sandy stream bed winding through the valley floor (at ground level, so it never blocks).
  for (let z = 0; z < D; z++) { const x = 19 + Math.round(Math.sin(z * 0.35) * 1.5); for (const xx of [x, x + 1]) { const t = Math.max(0, Math.round(height(xx, z))); b.grid.tint[b.grid.index(xx, t, z)] = MAT.sand; } }
  b.mirrored(b => {
    // The hilltop fort: a ring of low walls (waist high) with gaps, around the summit.
    const top = Math.round(height(8, 15)) + 1;
    // The ring sits on the flat summit: waist-high stone, with four gaps to run through.
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * Math.PI * 2, x = Math.round(8 + Math.cos(a) * 3.6), z = Math.round(15 + Math.sin(a) * 3.6 / 1.2);
      if (i % 7 === 0 || i % 7 === 1) continue;
      b.put(x, top, z, 'slab', 0, MAT.stone);
    }
    b.fill(7, top, 14, 9, top, 16, 'slab', MAT.darkStone);           // the summit platform
    b.put(8, top, 13, 'crate', 0, MAT.crate); b.put(6, top - 1, 17, 'barrel', 0, MAT.metal);
    // Valley cover: boulders and trees.
    for (const [x, z] of [[15, 6], [16, 22], [24, 9], [13, 13]]) { const y = Math.round(height(x, z)) + 1; b.put(x, y, z, 'block', 0, MAT.stone); b.put(x + 1, y, z, 'slab', 0, MAT.stone); }
    for (const [x, z] of [[12, 3], [14, 26], [4, 4], [3, 26]]) b.put(x, Math.round(height(x, z)) + 1, z, 'tree', 0, MAT.wood);
    for (const [x, z] of [[17, 12], [10, 21]]) b.put(x, Math.round(height(x, z)) + 1, z, 'bush', 0, MAT.leaf);
    for (const [x, z] of [[3, 15], [8, 8], [8, 22], [11, 19], [2, 9], [2, 21], [6, 2], [6, 27]]) b.spawn(x, Math.round(height(x, z)) + 1, z, 1, Math.PI / 2);
    b.item('ammo', 8, top + 0.5, 15); b.item('grenade', 13, Math.round(height(13, 18)) + 1, 18); b.item('ammo', 16, Math.round(height(16, 4)) + 1, 4);
    b.roost(6, 13, 10, 17, Math.round(height(8, 15)) + 1);
    b.spatula(10, Math.round(height(10, 10)) + 1, 10);
  });
  // The bridge between the summits: planks on posts, rails on both sides, ramps down at each end.
  const by = 5; // deck blocks at y 5: walking surface 6, flush with the hilltops
  for (let x = 12; x <= 27; x++) { b.put(x, by, 15, 'block', 0, MAT.wood); b.put(x, by, 14, 'block', 0, MAT.wood); if (x % 3 === 0) { b.put(x, by + 1, 13, 'fence', 0, MAT.wood); b.put(x, by + 1, 16, 'fence', 0, MAT.wood); } }
  // Ramps up onto the deck at both ends.
  // (only where the hill doesn't already meet the deck: the flat summits reach it on their own)
  for (const z of [14, 15]) { if (Math.round(height(11, z)) < by) b.put(11, by, z, 'ramp', 1, MAT.wood); if (Math.round(height(28, z)) < by) b.put(28, by, z, 'ramp', 3, MAT.wood); }
  for (const x of [14, 19, 24]) for (let y = 1; y < by; y++) { b.put(x, y, 13, 'pillar', 0, MAT.wood); b.put(x, y, 16, 'pillar', 0, MAT.wood); }
  b.roost(18, 10, 21, 19, 1);
  b.spatula(19, 1, 15); b.spatula(20, by + 1, 14);
  b.overview = { cx: W / 2, cy: 4, cz: D / 2, r: W * 0.55 };
  return b.finish({
    id: 'sunny', name: 'Sunny Side', maxPlayers: 16, modes: { ffa: true, teams: true, spatula: true, roost: true },
    availability: 'both', sky: 'day', theme: 'hills', fog: { color: 0xcfe8f2, near: 45, far: 120 },
    sun: { dir: [-0.5, 0.75, -0.3], color: 0xfff3dc, intensity: 2.4 }, ambient: 1.0,
  });
}
