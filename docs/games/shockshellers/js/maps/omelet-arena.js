// Omelet Arena (GDD §15.4): a symmetric duel box for 1v1/2v2. A raised centre dais with two stair
// approaches, four corner towers reached by ladders (sniper perches, but exposed), low cover walls
// and a ring corridor under arches around the edge for flanks. 22×22, six players.
import { Builder, MAT } from './dsl.js?v=muunn3ao';

export default function omeletArena() {
  const N = 22, b = new Builder(N, 10, N);
  // Ground and the outer wall (with a decorative crenellated top).
  b.fill(0, 0, 0, N - 1, 0, N - 1, 'block', MAT.sand);
  b.quartered(b => {
    // Outer wall, 5 high, along the north edge (the four-way symmetry makes the rest).
    b.fill(0, 1, 0, N - 1, 5, 0, 'block', MAT.brick);
    for (let x = 1; x < N - 1; x += 2) b.put(x, 6, 0, 'slab', 0, MAT.brick);
    // Ring corridor: a roofed walkway inside the wall, open to the arena through arches.
    b.fill(1, 4, 1, N - 2, 4, 2, 'block', MAT.stone);
    for (let x = 3; x < N - 3; x += 3) { b.put(x, 1, 3, 'pillar', 0, MAT.stone); b.put(x, 2, 3, 'pillar', 0, MAT.stone); b.put(x, 3, 3, 'pillar', 0, MAT.stone); }
    b.fill(3, 4, 3, N - 4, 4, 3, 'slab', MAT.stone);
    // Corner tower (3×3, 4 high) with a ladder on its inner face and a fenced top.
    b.fill(1, 1, 1, 3, 4, 3, 'block', MAT.stone);
    b.fill(1, 5, 1, 3, 5, 1, 'fence', MAT.wood);
    b.put(1, 5, 2, 'fence', 1, MAT.wood); b.put(1, 5, 3, 'fence', 1, MAT.wood);
    b.ladder(4, 1, 3, 4, 3, MAT.wood);
    b.put(2, 4, 3, 'arch', 0, MAT.stone);
    // Low cover: an L of slabs and a waist-high block line out from each tower.
    b.fill(6, 1, 5, 8, 1, 5, 'block', MAT.darkStone); b.put(6, 1, 6, 'block', 0, MAT.darkStone); b.put(6, 1, 7, 'slab', 0, MAT.darkStone);
    b.fill(9, 1, 5, 9, 2, 5, 'window', MAT.stone, 0);
    // Crates and a barrel for mid-height cover on the flanks.
    b.put(5, 1, 10, 'crate', 0, MAT.crate); b.put(5, 2, 10, 'crate', 1, MAT.crate); b.put(5, 1, 11, 'crate', 2, MAT.crate);
    b.put(7, 1, 12, 'barrel', 0, MAT.metal);
    // The dais (6×6, two high) at the centre; one stair flight per side (four with the symmetry, two
    // of which are blocked by a half wall so only two clean approaches remain).
    b.fill(8, 1, 8, 13, 2, 13, 'block', MAT.stone);
    b.fill(8, 3, 8, 13, 3, 8, 'slab', MAT.darkStone);
  });
  // Stairs up the dais from north and south; low walls on east and west.
  b.mirrored(b => {
    b.stairs(10, 1, 6, 2, 0, 2, MAT.stone);
    b.fill(7, 1, 10, 7, 1, 11, 'slab', MAT.darkStone);
  });
  // The dais top is open in the middle except for a single pillar to break the long sightline.
  b.fill(9, 3, 9, 12, 3, 12, 'air', 0);
  b.fill(10, 3, 10, 11, 4, 11, 'pillar', MAT.gold);

  // Spawns: three per side, facing the centre; FFA uses all of them.
  b.mirrored(b => {
    b.spawn(10, 1, 3, 1, Math.PI); b.spawn(5, 1, 4, 1, Math.PI * 0.75); b.spawn(16, 1, 4, 1, Math.PI * 1.25);
    b.spawn(3, 5, 2, 1, Math.PI);
  });
  // Ammo out in the open, grenades at the chokes.
  b.mirrored(b => { b.item('ammo', 10, 3, 9); b.item('ammo', 4, 1, 8); b.item('grenade', 8, 1, 4); b.item('ammo', 2, 5, 2); });
  b.spatula(10, 3, 10); b.spatula(4, 1, 10); b.spatula(17, 1, 11);
  b.mirrored(b => b.roost(9, 9, 12, 12, 3));

  return b.finish({
    id: 'omelet', name: 'Omelet Arena', maxPlayers: 6, modes: { ffa: true, teams: true, spatula: true, roost: false },
    availability: 'both', sky: 'day', theme: 'arena', fog: { color: 0xbfd8e6, near: 30, far: 70 },
    sun: { dir: [-0.45, 0.8, -0.38], color: 0xfff4e0, intensity: 2.4 }, ambient: 0.9,
  });
}
