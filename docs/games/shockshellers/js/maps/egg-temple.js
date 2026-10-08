// Egg Temple (GDD §15.4): a stepped pyramid with tunnels, for 18; signature verticality. Three
// two-high tiers climbed by stair flights on every face, a shrine on the summit (the sniper's prize),
// and inside the pyramid a ring of tunnels around a central chamber, entered from each face: the
// covered route for shotguns and SMGs. Ruined towers with ladders in the jungle corners. Quartered,
// so every face plays the same.
import { Builder, MAT } from './dsl.js?v=muzthczg';

export default function eggTemple() {
  const N = 40, b = new Builder(N, 14, N);
  b.fill(0, 0, 0, N - 1, 0, N - 1, 'block', MAT.grass);
  // The pyramid: tiers with tops at 3, 5 and 7.
  b.fill(8, 1, 8, 31, 2, 31, 'block', MAT.sand);
  b.fill(10, 3, 10, 29, 4, 29, 'block', MAT.sand);
  b.fill(13, 5, 13, 26, 6, 26, 'block', MAT.darkStone);
  // The central chamber (under the summit) and the tunnel ring around it, two high.
  b.clear(17, 1, 17, 22, 2, 22);
  b.quartered(b => {
    // Stone paving leading to each face, and a flight of stairs up every tier.
    b.fill(17, 0, 0, 22, 0, 7, 'block', MAT.stone);
    b.stairs(20, 1, 6, 2, 0, 2, MAT.stone);
    b.stairs(20, 3, 8, 2, 0, 2, MAT.stone);
    b.stairs(20, 5, 11, 2, 0, 2, MAT.darkStone);
    // Tunnels: a mouth cut into the face, a passage under the tiers, and the ring corridor.
    b.clear(25, 1, 8, 26, 2, 14);
    b.clear(13, 1, 13, 26, 2, 14);
    b.clear(19, 1, 15, 20, 2, 16);                   // into the chamber
    b.fill(24, 3, 8, 27, 3, 8, 'slab', MAT.darkStone); // a lintel over the mouth
    // Torches flanking the stairs, columns on the first tier.
    b.put(17, 3, 9, 'pillar', 0, MAT.gold); b.put(23, 3, 9, 'pillar', 0, MAT.gold);
    b.fill(9, 3, 9, 9, 4, 9, 'pillar', MAT.darkStone);
    // Crates and broken blocks on the tiers for cover.
    b.put(13, 3, 8, 'block', 0, MAT.darkStone); b.put(14, 3, 8, 'slab', 0, MAT.darkStone);
    b.put(15, 5, 11, 'crate', 0, MAT.crate); b.put(24, 5, 10, 'slab', 0, MAT.darkStone);
    // Corner ruin: a three-high block tower with a ladder, and a crumbling wall.
    b.fill(1, 1, 1, 3, 3, 3, 'block', MAT.darkStone);
    b.ladder(4, 1, 2, 3, 3, MAT.wood);
    b.put(1, 4, 3, 'slab', 0, MAT.darkStone); b.put(3, 4, 1, 'slab', 0, MAT.darkStone);
    b.fill(6, 1, 12, 6, 2, 15, 'block', MAT.darkStone); b.clear(6, 2, 14, 6, 2, 14);
    // Jungle.
    for (const [x, z] of [[1, 8], [2, 17], [4, 24], [12, 2], [28, 1], [6, 30]]) b.put(x, 1, z, 'tree', 0, MAT.wood);
    for (const [x, z] of [[3, 12], [10, 5], [27, 4]]) b.put(x, 1, z, 'bush', 0, MAT.leaf);
  });
  // The shrine on the summit: four columns and a roof.
  for (const [x, z] of [[17, 17], [22, 17], [17, 22], [22, 22]]) b.fill(x, 7, z, x, 8, z, 'pillar', MAT.gold);
  b.fill(17, 9, 17, 22, 9, 22, 'slab', MAT.darkStone);
  b.mirrored(b => {
    for (const [x, z] of [[8, 2], [13, 3], [16, 1], [24, 2], [31, 3], [7, 5], [33, 5], [10, 4]]) b.spawn(x, 1, z, 1, Math.PI);
    b.spawn(2, 4, 2, 1, Math.PI);
    b.item('ammo', 18, 3, 9); b.item('grenade', 25, 1, 7); b.item('ammo', 14, 1, 13); b.item('grenade', 9, 1, 34);
    b.item('ammo', 2, 4, 2); b.item('ammo', 13, 5, 11);
    b.spatula(19, 1, 13);
  });
  b.spatula(19, 7, 19); b.spatula(20, 1, 20);
  b.overview = { cx: N / 2, cy: 5, cz: N / 2, r: N * 0.62 };
  return b.finish({
    id: 'temple', name: 'Egg Temple', maxPlayers: 18, modes: { ffa: true, teams: true, spatula: true, roost: false },
    availability: 'both', sky: 'day', theme: 'temple', fog: { color: 0xd8e8d6, near: 45, far: 120 },
    sun: { dir: [-0.45, 0.8, -0.35], color: 0xfff0d4, intensity: 2.4 }, ambient: 1.0,
  });
}
