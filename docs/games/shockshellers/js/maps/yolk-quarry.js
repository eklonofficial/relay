// Yolk Quarry (GDD §15.4): a terraced stone pit for 14. Three rings step down from the rim to a
// sandy floor; stair cuts on every side link the terraces, tunnels bore through the terrace walls at
// the diagonals for flanks, mine carts (crates), barrels and timber props give cover, and ladders
// climb the tall faces. Long sightlines across the pit, close fights in the tunnels.
import { Builder, MAT } from './dsl.js?v=muyi3h1t';

export default function yolkQuarry() {
  const N = 32, c = (N - 1) / 2, b = new Builder(N, 12, N);
  // Ring heights by distance from the centre (square rings: a cut quarry).
  const ring = (x, z) => { const d = Math.max(Math.abs(x - c), Math.abs(z - c)); return d >= 13 ? 6 : d >= 10 ? 4 : d >= 6.5 ? 2 : 0; };
  b.terrain(0, 0, N - 1, N - 1, ring, MAT.stone, MAT.darkStone, false);
  b.fill(9, 0, 9, 22, 0, 22, 'block', MAT.sand);       // the pit floor
  // Each level its own surface: a grassy rim, a dirt ring, a sandy lower ring (stone faces between).
  const g = b.grid;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const h = ring(x, z); if (!h) continue;
    g.tint[g.index(x, h, z)] = h === 6 ? MAT.grass : h === 4 ? MAT.dirt : MAT.sand;
  }
  b.quartered(b => {
    // Stairs up each terrace on the north axis (four ways with the symmetry), 3 wide.
    b.stairs(14, 1, 10, 2, 2, 3, MAT.stone);            // pit → first terrace (rising towards -z, from the pit floor)
    b.stairs(14, 3, 6, 2, 2, 3, MAT.stone);             // first → second
    b.stairs(14, 5, 3, 2, 2, 3, MAT.stone);             // second → rim
    // A sunken cut from the pit up into the first terrace near the corner: a covered flank route.
    b.clear(9, 1, 11, 9, 2, 12);
    b.stairs(8, 1, 11, 2, 3, 2, MAT.stone);
    b.fill(9, 3, 11, 9, 3, 12, 'slab', MAT.darkStone);   // a lintel over the entrance
    // Ladders on the tall faces between terraces, beside the stairs.
    b.ladder(20, 3, 6, 2, 2, MAT.wood);
    // Timber props and carts on the terraces.
    b.put(5, 5, 10, 'crate', 0, MAT.crate); b.put(5, 5, 11, 'crate', 1, MAT.crate); b.put(5, 6, 10, 'crate', 2, MAT.crate);
    b.put(11, 3, 7, 'barrel', 0, MAT.metal); b.put(19, 3, 7, 'barrel', 0, MAT.metal);
    b.fill(1, 7, 6, 2, 7, 7, 'block', MAT.stone);       // rim boulders
    b.put(27, 7, 2, 'tree', 0, MAT.wood);
  });
  // The pit: a rock outcrop in the middle (climbable by its slabs) and scattered carts.
  b.fill(14, 1, 14, 17, 1, 17, 'block', MAT.stone);
  b.fill(15, 2, 15, 16, 2, 16, 'slab', MAT.darkStone);
  b.mirrored(b => { b.stairs(15, 1, 13, 1, 0, 2, MAT.stone); b.put(11, 1, 12, 'crate', 0, MAT.crate); b.put(11, 1, 13, 'crate', 1, MAT.crate); b.put(20, 1, 11, 'barrel', 0, MAT.metal); });
  b.mirrored(b => {
    for (const [x, z] of [[3, 3], [16, 2], [28, 3], [9, 5], [22, 5], [5, 16]]) b.spawn(x, 7, z, 1, Math.PI);
    b.spawn(12, 5, 2, 1, Math.PI);
    b.item('ammo', 15, 1, 11); b.item('ammo', 4, 5, 16); b.item('grenade', 9, 1, 11); b.item('ammo', 24, 3, 8);
    b.roost(13, 4, 17, 6, 5); b.roost(3, 13, 6, 18, 5);
    b.spatula(16, 3, 8);
  });
  b.roost(13, 13, 18, 18, 1);
  b.spatula(15, 3, 15);
  b.overview = { cx: c, cy: 2, cz: c, r: N * 0.62 };
  return b.finish({
    id: 'quarry', name: 'Yolk Quarry', maxPlayers: 14, modes: { ffa: true, teams: true, spatula: true, roost: true },
    availability: 'both', sky: 'day', theme: 'quarry', fog: { color: 0xd9d2c0, near: 40, far: 100 },
    sun: { dir: [-0.35, 0.85, -0.45], color: 0xfff0d0, intensity: 2.3 }, ambient: 1.0,
  });
}
