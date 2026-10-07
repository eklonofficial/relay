// Omelet Arena (GDD §15.4): a symmetric castle-courtyard duel map for 1v1 and 2v2.
// A grass courtyard ringed by crenellated stone walls with a walkway on top (reached by mid-wall stairs:
// the sniper lane), a raised central dais with two stair approaches and a cover lip, L-shaped cover in
// each quadrant, crates and barrels for mid-height cover, and trees in the corners. 24×24, six players.
import { Builder, MAT } from './dsl.js?v=muyjsnue';

export default function omeletArena() {
  const N = 24, b = new Builder(N, 10, N);
  // Ground: grass, worn to dirt along the walls.
  b.fill(0, 0, 0, N - 1, 0, N - 1, 'block', MAT.grass);
  b.quartered(b => {
    b.fill(1, 0, 1, N - 2, 0, 2, 'block', MAT.dirt);
    // Outer wall: three blocks of stone with a walkway on top and crenellations on the outside edge.
    b.fill(0, 1, 0, N - 1, 3, 0, 'block', MAT.stone);
    b.fill(1, 1, 1, N - 2, 3, 1, 'block', MAT.stone);
    for (let x = 0; x < N; x += 2) b.put(x, 4, 0, 'block', 0, MAT.darkStone);
    // Stairs up to the walkway, rising along the wall away from the corners.
    b.stairs(13, 1, 2, 3, 3, 1, MAT.stone);
    // L-shaped cover in the quadrant, two high with a window to shoot through.
    b.fill(6, 1, 6, 8, 2, 6, 'block', MAT.darkStone);
    b.fill(6, 1, 7, 6, 2, 8, 'block', MAT.darkStone);
    b.put(7, 2, 6, 'window', 0, MAT.darkStone);
    // Crates and a barrel by the cover.
    b.put(9, 1, 4, 'crate', 0, MAT.crate); b.put(10, 1, 4, 'crate', 1, MAT.crate); b.put(9, 2, 4, 'crate', 2, MAT.crate);
    b.put(4, 1, 9, 'barrel', 0, MAT.metal);
    // A tree in the corner pocket and a bush along the wall.
    b.put(3, 1, 4, 'tree', 0, MAT.wood);
    b.put(16, 1, 2, 'bush', 0, MAT.leaf);
  });
  // The dais: 6×6 and two high, open on top, with a low lip on two sides for cover.
  b.fill(9, 1, 9, 14, 2, 14, 'block', MAT.stone);
  b.mirrored(b => {
    b.stairs(11, 1, 7, 2, 0, 2, MAT.stone);       // stairs up from the north and south
    b.fill(9, 3, 9, 10, 3, 9, 'slab', MAT.darkStone);
    b.fill(9, 3, 10, 9, 3, 10, 'slab', MAT.darkStone);
  });
  b.put(11, 3, 11, 'pillar', 0, MAT.gold); b.put(12, 3, 12, 'pillar', 0, MAT.gold);

  // Spawns: corners and wall bases, facing in; team modes take a side each.
  b.mirrored(b => {
    b.spawn(4, 1, 3, 1, Math.PI); b.spawn(19, 1, 4, 1, Math.PI); b.spawn(11, 1, 3, 1, Math.PI);
    b.spawn(2, 4, 1, 1, Math.PI);
  });
  // Ammo out in the open (on the dais and mid-flank), grenades at the corner pockets.
  b.mirrored(b => { b.item('ammo', 11, 3, 10); b.item('ammo', 4, 1, 12); b.item('grenade', 5, 1, 5); b.item('ammo', 12, 4, 1); });
  b.spatula(11, 3, 12); b.spatula(4, 1, 11); b.spatula(19, 1, 12);
  b.overview = { cx: N / 2, cy: 3, cz: N / 2, r: N * 0.62 };

  return b.finish({
    id: 'omelet', name: 'Omelet Arena', maxPlayers: 6, modes: { ffa: true, teams: true, spatula: true, roost: false },
    availability: 'both', sky: 'day', theme: 'arena', fog: { color: 0xc7e1ee, near: 35, far: 90 },
    sun: { dir: [-0.5, 0.85, -0.35], color: 0xfff1dc, intensity: 2.3 }, ambient: 1.0,
  });
}
