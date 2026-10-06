// Barnyard (GDD §15.4): an open farm for 18. Two red barns face each other across a grass field
// (each with a hayloft reached by stairs: a covered upper lane with windows), metal silos with
// ladders up to sniper perches, hay-bale and fence cover in the middle, a farmhouse on each flank
// for close fights, and a dirt track around the field. Point-symmetric for team modes.
import { Builder, MAT } from './dsl.js?v=muwxo6oz';

export default function barnyard() {
  const W = 40, D = 40, b = new Builder(W, 12, D);
  b.fill(0, 0, 0, W - 1, 0, D - 1, 'block', MAT.grass);
  // Low boundary fence all round (the map edge is an invisible wall; the fence shows it).
  b.quartered(b => { for (let x = 0; x < W; x++) b.put(x, 1, 0, 'fence', 0, MAT.wood); });
  b.mirrored(b => {
    // Dirt track across the field.
    b.fill(3, 0, 12, 36, 0, 13, 'block', MAT.dirt);
    // The barn: 10 wide, 8 deep, walls 4 high, open doors facing the field, a hayloft at y 3.
    const x0 = 15, z0 = 2, x1 = 24, z1 = 9;
    b.walls(x0, 1, z0, x1, 4, z1, MAT.red);
    b.clear(18, 1, z1, 21, 3, z1);                    // big doors to the field
    b.clear(x0, 1, 5, x0, 2, 6); b.clear(x1, 1, 5, x1, 2, 6);  // side doors
    b.fill(x0 + 1, 2, z0 + 1, x1 - 1, 2, z0 + 2, 'block', MAT.wood);  // hayloft floor (top at 3, level with the stairs)
    b.stairs(x0 + 1, 1, z0 + 4, 2, 2, 1, MAT.wood);  // stairs up to the loft
    for (let x = x0 + 1; x <= x1 - 1; x += 3) b.put(x, 3, z0, 'window', 0, MAT.red);   // loft windows at eye level
    b.fill(x0, 5, z0, x1, 5, z1, 'slab', MAT.roof);   // roof
    b.fill(x0 + 1, 5, z0 + 2, x1 - 1, 5, z1 - 2, 'block', MAT.roof);
    b.fill(x0 + 2, 1, z0 + 1, x0 + 3, 1, z0 + 1, 'hay', MAT.hay); b.put(x1 - 2, 1, z0 + 1, 'hay', 0, MAT.hay); b.put(x1 - 2, 2, z0 + 1, 'hay', 0, MAT.hay);
    // A silo beside each barn: 3×3 metal, 7 high, ladder up the outside to a fenced perch.
    b.fill(27, 1, 3, 29, 7, 5, 'block', MAT.metal);
    b.fill(27, 8, 3, 29, 8, 3, 'fence', MAT.metal); b.put(27, 8, 4, 'fence', 1, MAT.metal); b.put(27, 8, 5, 'fence', 1, MAT.metal);
    b.ladder(28, 1, 6, 7, 2, MAT.metal);
    // Farmhouse on the flank: plaster walls, a doorway each side, windows, a flat roof you can't reach.
    b.walls(2, 1, 4, 8, 3, 9, MAT.plaster);
    b.clear(5, 1, 9, 5, 2, 9); b.clear(8, 1, 6, 8, 2, 6);
    b.put(3, 2, 4, 'window', 0, MAT.plaster); b.put(6, 2, 4, 'window', 0, MAT.plaster); b.put(2, 2, 7, 'window', 1, MAT.plaster);
    b.fill(2, 4, 4, 8, 4, 9, 'slab', MAT.roof);
    b.put(4, 1, 6, 'crate', 0, MAT.crate); b.put(6, 1, 7, 'barrel', 0, MAT.metal);
    // Field cover: hay bales in loose rows, fence runs, crates, trees.
    for (const [x, z] of [[12, 15], [13, 15], [19, 16], [25, 15], [26, 15], [9, 18], [30, 18], [16, 18], [23, 18]]) b.put(x, 1, z, 'hay', 0, MAT.hay);
    b.put(13, 2, 15, 'hay', 0, MAT.hay); b.put(26, 2, 15, 'hay', 0, MAT.hay);
    for (let x = 4; x < 11; x++) b.put(x, 1, 16, 'fence', 0, MAT.wood);
    for (let z = 14; z < 19; z++) b.put(33, 1, z, 'fence', 1, MAT.wood);
    b.put(35, 1, 6, 'tree', 0, MAT.wood); b.put(11, 1, 3, 'tree', 0, MAT.wood); b.put(31, 1, 10, 'bush', 0, MAT.leaf); b.put(10, 1, 11, 'bush', 0, MAT.leaf);
    b.put(21, 1, 11, 'crate', 0, MAT.crate); b.put(22, 1, 11, 'crate', 1, MAT.crate);
    // Spawns behind each barn and by the farmhouse.
    for (const [x, z] of [[17, 1], [22, 1], [26, 2], [12, 2], [4, 11], [9, 12], [31, 2], [35, 9], [18, 6]]) b.spawn(x, 1, z, 1, Math.PI);
    b.spawn(17, 3, 4, 1, Math.PI);   // the loft
    // Items: ammo out in the field, grenades at the barn doors and silo foot.
    b.item('ammo', 19, 1, 17); b.item('ammo', 6, 1, 14); b.item('ammo', 28, 8, 4); b.item('grenade', 20, 1, 10); b.item('grenade', 29, 1, 7); b.item('ammo', 5, 1, 7);
    b.roost(17, 14, 21, 17, 1); b.roost(3, 5, 7, 8, 1);
    b.spatula(19, 1, 6);
  });
  // The coop at the centre: a roof on posts with crates inside, cover from every side but open sightlines.
  for (const [x, z] of [[17, 18], [22, 18], [17, 21], [22, 21]]) b.fill(x, 1, z, x, 2, z, 'pillar', MAT.wood);
  b.fill(16, 3, 17, 23, 3, 22, 'slab', MAT.roof);
  b.put(19, 1, 19, 'crate', 0, MAT.crate); b.put(20, 1, 20, 'crate', 1, MAT.crate); b.put(19, 2, 19, 'crate', 2, MAT.crate);
  b.mirrored(b => { for (const [x, z] of [[14, 22], [14, 23], [15, 23], [25, 24]]) b.put(x, 1, z, 'hay', 0, MAT.hay); b.put(14, 2, 23, 'hay', 0, MAT.hay); });
  b.spatula(18, 1, 20); b.spatula(21, 1, 19);
  b.roost(17, 18, 22, 21, 1);
  b.overview = { cx: W / 2, cy: 3, cz: D / 2, r: W * 0.6 };
  return b.finish({
    id: 'barnyard', name: 'Barnyard', maxPlayers: 18, modes: { ffa: true, teams: true, spatula: true, roost: true },
    availability: 'both', sky: 'day', theme: 'farm', fog: { color: 0xcfe6ef, near: 45, far: 120 },
    sun: { dir: [-0.45, 0.8, -0.4], color: 0xfff0d8, intensity: 2.3 }, ambient: 1.0,
  });
}
