// Hen House (GDD §15.4): dense interiors for 12, close quarters (shotgun and SMG heaven).
// A two-storey hen house in a fenced yard: rooms and doorways downstairs, an open atrium in the middle
// overlooked by the upper gallery, stairwells and ladders between floors, nesting-box rows for cover,
// and windows to shoot through. Point-symmetric for team modes.
import { Builder, MAT } from './dsl.js?v=muv98ap7';

export default function henHouse() {
  const N = 26, b = new Builder(N, 10, N);
  b.fill(0, 0, 0, N - 1, 0, N - 1, 'block', MAT.grass);
  b.fill(3, 0, 3, 22, 0, 22, 'block', MAT.wood);                 // planked floor inside
  b.quartered(b => {
    for (let x = 0; x < N; x++) b.put(x, 1, 0, 'fence', 0, MAT.wood);
    // Outer walls, two storeys, plaster below and planks above.
    b.fill(3, 1, 3, 22, 3, 3, 'block', MAT.plaster);
    b.fill(3, 4, 3, 22, 6, 3, 'block', MAT.wood);
    // Doors and windows on this face.
    b.clear(7, 1, 3, 7, 2, 3); b.clear(17, 1, 3, 18, 2, 3);
    for (const x of [5, 11, 14, 20]) b.put(x, 2, 3, 'window', 0, MAT.plaster);
    for (const x of [6, 9, 12, 15, 18]) b.put(x, 5, 3, 'window', 0, MAT.wood);
    // Upper floor slab along this side (the gallery), 4 deep.
    b.fill(4, 3, 4, 21, 3, 7, 'block', MAT.wood);
    // Ground-floor room walls with doorways.
    b.fill(9, 1, 4, 9, 2, 8, 'block', MAT.plaster); b.clear(9, 1, 6, 9, 2, 6);
    b.fill(4, 1, 8, 8, 2, 8, 'block', MAT.plaster); b.clear(6, 1, 8, 6, 2, 8);
    // Nesting boxes: a hay row and a crate stack in each room.
    for (let x = 4; x <= 7; x++) b.put(x, 1, 4, 'hay', 0, MAT.hay);
    b.put(11, 1, 5, 'crate', 0, MAT.crate); b.put(11, 2, 5, 'crate', 1, MAT.crate); b.put(12, 1, 5, 'crate', 2, MAT.crate);
    // Upper floor: nesting boxes along the wall, a low rail at the gallery edge.
    for (let x = 10; x <= 15; x += 2) b.put(x, 4, 4, 'hay', 0, MAT.hay);
    for (let x = 8; x <= 17; x++) if (x < 11 || x > 14) b.put(x, 4, 8, 'fence', 0, MAT.wood);
    // Stairwell up to the gallery (rising along the wall) and a ladder in the corner room.
    b.stairs(19, 1, 10, 3, 2, 2, MAT.wood);          // rises towards -z, reaches the gallery at z 7
    b.clear(19, 3, 8, 20, 3, 9);                      // headroom over the stairs
    b.ladder(4, 1, 9, 3, 2, MAT.wood);
    // A tree and a cart in the yard.
    b.put(1, 1, 9, 'tree', 0, MAT.wood); b.put(24, 1, 6, 'barrel', 0, MAT.metal);
  });
  // The atrium: the middle is open from floor to roof, ringed by the galleries above.
  b.clear(8, 3, 8, 17, 3, 17);
  b.fill(3, 7, 3, 22, 7, 22, 'slab', MAT.roof);                   // roof
  b.fill(4, 7, 4, 21, 7, 21, 'block', MAT.roof);
  // A coop in the middle of the atrium: low walls and a crate pile for cover.
  b.fill(11, 1, 11, 14, 1, 11, 'slab', MAT.wood); b.fill(11, 1, 14, 14, 1, 14, 'slab', MAT.wood);
  b.put(12, 1, 12, 'crate', 0, MAT.crate); b.put(13, 1, 13, 'crate', 1, MAT.crate); b.put(12, 2, 12, 'crate', 2, MAT.crate);
  b.mirrored(b => {
    for (const [x, z] of [[5, 1], [13, 1], [21, 2], [1, 5], [5, 5], [14, 6], [20, 5]]) b.spawn(x, 1, z, 1, Math.PI);
    b.spawn(12, 4, 5, 1, Math.PI); b.spawn(5, 4, 6, 1, Math.PI);
    b.item('ammo', 12, 1, 9); b.item('ammo', 16, 4, 5); b.item('grenade', 6, 1, 6); b.item('ammo', 2, 1, 12);
    b.roost(4, 4, 8, 7, 1); b.roost(10, 4, 15, 7, 4);
    b.spatula(13, 1, 2);
  });
  b.roost(11, 11, 14, 14, 1);
  b.spatula(12, 1, 13); b.spatula(13, 1, 12);
  b.overview = { cx: N / 2, cy: 3, cz: N / 2, r: N * 0.7 };
  return b.finish({
    id: 'henhouse', name: 'Hen House', maxPlayers: 12, modes: { ffa: true, teams: true, spatula: true, roost: true },
    availability: 'both', sky: 'day', theme: 'farm', fog: { color: 0xd6e6ee, near: 30, far: 80 },
    sun: { dir: [-0.4, 0.85, -0.3], color: 0xfff1dc, intensity: 2.2 }, ambient: 1.15,
  });
}
