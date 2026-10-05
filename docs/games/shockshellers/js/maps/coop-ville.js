// Coop Ville (GDD §15.4): a small town for 18, all about verticality. Streets in a grid between
// houses you can walk through, flat rooftops with parapets reached by ladders (and joined by plank
// walkways), a central plaza with a fountain and market stalls. Rooftops rule sightlines; streets and
// interiors give the flanks. Point-symmetric for team modes.
import { Builder, MAT } from './dsl.js?v=muvjbwwq';

// A house: walls `h` high with a door, windows, a flat roof with a parapet, and a ladder up the side.
function house(b, x0, z0, w, d, h, mat, door, ladder) {
  const x1 = x0 + w - 1, z1 = z0 + d - 1;
  b.walls(x0, 1, z0, x1, h, z1, mat);
  // Doorways on two sides so every house is a through-route.
  if (door === 'x') { b.clear(x0, 1, z0 + 1, x0, 2, z0 + 1); b.clear(x1, 1, z1 - 1, x1, 2, z1 - 1); }
  else { b.clear(x0 + 1, 1, z0, x0 + 1, 2, z0); b.clear(x1 - 1, 1, z1, x1 - 1, 2, z1); }
  for (let x = x0 + 2; x < x1 - 1; x += 2) { b.put(x, 2, z0, 'window', 0, mat); b.put(x, 2, z1, 'window', 0, mat); }
  b.fill(x0, h + 1, z0, x1, h + 1, z1, 'block', MAT.roof);           // flat roof (walk on it)
  for (let x = x0; x <= x1; x++) { b.put(x, h + 2, z0, 'slab', 0, MAT.plaster); b.put(x, h + 2, z1, 'slab', 0, MAT.plaster); }
  for (let z = z0 + 1; z < z1; z++) { b.put(x0, h + 2, z, 'slab', 0, MAT.plaster); b.put(x1, h + 2, z, 'slab', 0, MAT.plaster); }
  const [lx, lz, ry] = ladder;
  b.ladder(lx, 1, lz, h + 1, ry, MAT.wood);
  b.clear(lx + [0, 1, 0, -1][ry], h + 2, lz + [1, 0, -1, 0][ry]);  // a gap in the parapet at the ladder top
}

export default function coopVille() {
  const N = 40, b = new Builder(N, 14, N);
  b.fill(0, 0, 0, N - 1, 0, N - 1, 'block', MAT.stone);             // cobbled streets
  b.mirrored(b => {
    // Two rows of houses on each side of the main street.
    house(b, 2, 2, 7, 6, 3, MAT.plaster, 'z', [9, 6, 3]);
    house(b, 12, 2, 6, 6, 4, MAT.brick, 'x', [11, 6, 1]);
    house(b, 21, 2, 7, 6, 3, MAT.plaster, 'z', [28, 4, 3]);
    house(b, 31, 2, 7, 7, 4, MAT.brick, 'x', [30, 7, 1]);
    house(b, 2, 11, 6, 7, 4, MAT.brick, 'x', [8, 13, 3]);
    house(b, 30, 11, 8, 6, 3, MAT.plaster, 'z', [29, 13, 1]);
    // A plank walkway between two rooftops: flush with the low roof (walking surface 5), with a step
    // up at the far end onto the taller house's roof (6), through gaps in both parapets.
    for (let x = 9; x <= 11; x++) b.put(x, 4, 4, 'block', 0, MAT.wood);
    b.put(11, 5, 4, 'stairs', 1, MAT.wood);
    b.clear(8, 5, 4, 8, 5, 4); b.clear(12, 6, 4, 12, 6, 4);
    // Street furniture: market stalls (a roof on posts over crates), barrels, trees in planters.
    for (const [x, z] of [[14, 12], [17, 12]]) { b.put(x, 1, z, 'pillar', 0, MAT.wood); b.put(x, 2, z, 'pillar', 0, MAT.wood); }
    b.fill(13, 3, 11, 18, 3, 13, 'slab', MAT.red);
    b.put(15, 1, 12, 'crate', 0, MAT.crate); b.put(16, 1, 12, 'crate', 1, MAT.crate);
    b.put(24, 1, 11, 'barrel', 0, MAT.metal); b.put(25, 1, 11, 'barrel', 0, MAT.metal); b.put(10, 1, 9, 'crate', 0, MAT.crate);
    for (const [x, z] of [[19, 9], [1, 20], [27, 16]]) { b.put(x, 1, z, 'tree', 0, MAT.wood); }
    // Spawns: house doors and street ends.
    for (const [x, z] of [[5, 9], [14, 9], [24, 9], [34, 10], [1, 9], [10, 15], [28, 18], [5, 4], [33, 5]]) b.spawn(x, 1, z, 1, Math.PI);
    b.spawn(4, 5, 4, 1, Math.PI);
    b.item('ammo', 15, 1, 15); b.item('ammo', 4, 5, 5); b.item('grenade', 9, 1, 10); b.item('ammo', 33, 5, 4); b.item('grenade', 22, 1, 15);
    b.roost(13, 14, 18, 17, 1); b.roost(3, 3, 7, 6, 5); b.roost(31, 12, 36, 15, 1);
    b.spatula(15, 1, 10);
  });
  // The plaza fountain: a ring wall (cover) with a pillar in the middle.
  b.fill(17, 1, 17, 22, 1, 22, 'slab', MAT.stone); b.fill(18, 1, 18, 21, 1, 21, 'block', MAT.water);
  b.clear(18, 1, 18, 21, 1, 21); b.fill(18, 0, 18, 21, 0, 21, 'block', MAT.water);
  b.fill(19, 1, 19, 20, 3, 20, 'pillar', MAT.gold);
  b.roost(16, 16, 23, 23, 1);
  b.spatula(19, 1, 16); b.spatula(20, 1, 23);
  b.overview = { cx: N / 2, cy: 4, cz: N / 2, r: N * 0.58 };
  return b.finish({
    id: 'coopville', name: 'Coop Ville', maxPlayers: 18, modes: { ffa: true, teams: true, spatula: true, roost: true },
    availability: 'both', sky: 'day', theme: 'town', fog: { color: 0xd3e5ee, near: 45, far: 120 },
    sun: { dir: [-0.4, 0.8, -0.45], color: 0xfff2dc, intensity: 2.3 }, ambient: 1.05,
  });
}
