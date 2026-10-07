// Moon Hatch (GDD §15.4): a low-gravity moon base for 18 (gravity 0.5×, jumps carry far). A cratered
// moon-rock plain, a raised central hub of metal panels, habitat pods with doorways, landing pads on
// stilts reached by jump pads, and a starry space sky. Point-symmetric for team modes.
import { Builder, MAT } from './dsl.js?v=muyi3h1t';

export default function moonHatch() {
  const N = 40, c = (N - 1) / 2, b = new Builder(N, 14, N);
  // Cratered ground: gentle rolls with a few bowls (symmetric so mirrored props sit right).
  const crater = (x, z, cx, cz, r) => { const d = Math.hypot(x - cx, z - cz); return d < r ? -Math.cos(d / r * Math.PI / 2) * 1.6 : 0; };
  const roll = (x, z) => 0.5 * Math.sin(x * 0.3) * Math.sin(z * 0.27);
  const h = (x, z) => {
    const one = (x, z) => 1 + roll(x, z) + crater(x, z, 9, 9, 5) + crater(x, z, 30, 12, 4) + crater(x, z, 12, 28, 4);
    return (one(x, z) + one(N - 1 - x, N - 1 - z)) / 2;
  };
  b.terrain(0, 0, N - 1, N - 1, h, MAT.moon, MAT.moon, true);
  const ground = (x, z) => Math.round(Math.max(0, h(x, z))) + 1;
  // The hub: a 10×10 panelled deck two up, ramps on all four sides, a beacon in the middle.
  b.fill(15, 1, 15, 24, 2, 24, 'block', MAT.panel);
  b.quartered(b => {
    b.stairs(18, 1, 13, 2, 0, 4, MAT.metal, 'ramp');
    b.put(15, 3, 15, 'slab', 0, MAT.metal); b.put(16, 3, 15, 'slab', 0, MAT.metal); b.put(15, 3, 16, 'slab', 0, MAT.metal);
  });
  b.fill(19, 3, 19, 20, 5, 20, 'pillar', MAT.blue);
  b.mirrored(b => {
    // Habitat pods: small rooms with a door each way and a window band.
    const pod = (x0, z0) => {
      const y = ground(x0 + 2, z0 + 2);
      b.fill(x0, y - 1, z0, x0 + 4, y - 1, z0 + 4, 'block', MAT.panel);
      b.walls(x0, y, z0, x0 + 4, y + 2, z0 + 4, MAT.panel);
      b.clear(x0 + 2, y, z0, x0 + 2, y + 1, z0); b.clear(x0 + 2, y, z0 + 4, x0 + 2, y + 1, z0 + 4);
      b.put(x0, y + 1, z0 + 2, 'glass', 1, MAT.panel); b.put(x0 + 4, y + 1, z0 + 2, 'glass', 1, MAT.panel);
      b.fill(x0, y + 3, z0, x0 + 4, y + 3, z0 + 4, 'slab', MAT.metal);
      // Ramps up to the pod floor if it sits above the ground around it.
      b.put(x0 + 2, y - 1, z0 - 1, 'ramp', 0, MAT.metal); b.put(x0 + 2, y - 1, z0 + 5, 'ramp', 2, MAT.metal);
    };
    pod(4, 16); pod(16, 4);
    // A landing pad on stilts with a jump pad below it: the fast way up (and a sniper perch).
    b.fill(29, 4, 27, 33, 4, 31, 'block', MAT.metal);           // the deck (top at 5)
    for (const [x, z] of [[29, 27], [33, 27], [29, 31], [33, 31]]) b.fill(x, 1, z, x, 3, z, 'pillar', MAT.metal);
    for (let x = 29; x <= 33; x++) { b.put(x, 5, 31, 'fence', 0, MAT.metal); }
    b.put(31, ground(31, 24) - 1, 24, 'pad', 0, MAT.metal);   // three steps short of the deck: the launch clears its edge
    // Jump pads across the plain, crates and fuel barrels for cover.
    b.put(10, ground(10, 20) - 1, 20, 'pad', 0, MAT.metal); b.put(24, ground(24, 8) - 1, 8, 'pad', 0, MAT.metal);
    for (const [x, z] of [[8, 12], [13, 9], [26, 15], [22, 30], [6, 27]]) b.put(x, ground(x, z), z, 'crate', 0, MAT.crate);
    for (const [x, z] of [[12, 14], [27, 20], [17, 33]]) b.put(x, ground(x, z), z, 'barrel', 0, MAT.metal);
    for (const [x, z] of [[3, 3], [10, 3], [3, 10], [20, 2], [2, 20], [7, 7], [14, 12], [25, 3]]) b.spawn(x, ground(x, z), z, 1, Math.PI * 1.25);
    b.item('ammo', 19, 3, 16); b.item('ammo', 6, ground(6, 18), 18); b.item('grenade', 31, 5, 29); b.item('ammo', 18, ground(18, 6), 6); b.item('grenade', 9, ground(9, 9), 9);
    b.roost(5, 17, 8, 20, ground(6, 18)); b.roost(25, 30, 28, 33, ground(26, 31));
    b.spatula(26, ground(26, 22), 22);
  });
  b.roost(17, 17, 22, 22, 3);
  b.spatula(18, 3, 21); b.spatula(21, 3, 18);
  b.overview = { cx: c, cy: 4, cz: c, r: N * 0.6 };
  return b.finish({
    id: 'moon', name: 'Moon Hatch', maxPlayers: 18, modes: { ffa: true, teams: true, spatula: true, roost: true },
    availability: 'both', sky: 'space', theme: 'space', gravity: 0.5, fog: { color: 0x0c0c22, near: 60, far: 160 },
    sun: { dir: [-0.3, 0.75, -0.6], color: 0xf4f6ff, intensity: 2.6 }, ambient: 0.75,
  });
}
