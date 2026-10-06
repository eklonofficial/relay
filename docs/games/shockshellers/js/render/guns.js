// The eight weapons, the whisk and the Cluck Bomb, modelled in code with the kit (kit.js): each gun
// is one mesh (one draw call) whose parts carry their own colour and finish, so a skin is just a
// different palette.
//
// Units: metres-ish, the muzzle points along -z, +y is up, the grip sits near the origin. Each gun
// has the attachment points the hands and camera use (muzzle, sight: the eye line when aiming,
// grip, support, eject) and its moving parts as their own child groups, pivoted where they move:
// the magazine (or the shells, the round, the rocket), the slide or charging handle that kicks
// back with each shot, the shotgun's barrels on their hinge, the sniper's bolt.
import * as THREE from '../../vendor/three/three.module.js?v=muwq4fsj';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js?v=muwq4fsj';
import { Kit, BASE, kitMaterial } from './kit.js?v=muwq4fsj';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Each gun's own colours.
const LOOK = {
  yolk47: { body: [0x353a42, 0.5, 0.3, 0], accent: [0xf39a25, 0.42, 0.08, 0], wood: [0xb0662e, 0.6, 0, 0] },
  beater: { body: [0x2f6fd6, 0.4, 0.08, 0], accent: [0xffd23f, 0.42, 0.05, 0] },
  triBoil: { body: [0xd8452f, 0.4, 0.08, 0], accent: [0xf6f4ee, 0.5, 0, 0] },
  cageFree: { body: [0x6b7a45, 0.6, 0.08, 0], accent: [0xd8c08a, 0.62, 0.02, 0] },
  poacher: { body: [0x353a42, 0.45, 0.3, 0], accent: [0xd9a441, 0.3, 0.9, 0], wood: [0x8a4f26, 0.58, 0, 0] },
  doubleYolker: { body: [0x7a828c, 0.3, 0.88, 0], accent: [0xffc531, 0.28, 0.9, 0], wood: [0x9c5b2e, 0.6, 0, 0] },
  yolkzooka: { body: [0x1f8fa8, 0.42, 0.12, 0], accent: [0xffc531, 0.42, 0.05, 0] },
  peck9mm: { body: [0x353a42, 0.45, 0.35, 0], accent: [0xf39a25, 0.45, 0.05, 0] },
  whisk: { body: [0xd8452f, 0.45, 0.05, 0] },
  grenade: { body: [0x6b7a45, 0.6, 0.05, 0], accent: [0xffc531, 0.45, 0.05, 0] },
};

// Gun skins (cosmetic, all free): repaint body/accent/wood. Glow skins light their accent.
export const SKINS = {
  factory: { name: 'Factory' },
  arctic: { name: 'Arctic', body: [0xeef3f7, 0.55, 0.02, 0], accent: [0x7fc4ff, 0.45, 0.05, 0], wood: [0xd6dde4, 0.6, 0, 0] },
  midnight: { name: 'Midnight', body: [0x17181d, 0.4, 0.4, 0], accent: [0x7b4dff, 0.4, 0.1, 0.25], wood: [0x24252c, 0.5, 0.2, 0] },
  gold: { name: 'Gold Rush', body: [0xffc531, 0.22, 0.95, 0], accent: [0x1d1d22, 0.35, 0.5, 0], wood: [0x3a2414, 0.5, 0, 0] },
  candy: { name: 'Candy', body: [0xff8fb8, 0.45, 0.02, 0], accent: [0x8ff0d0, 0.45, 0.02, 0], wood: [0xfff0f5, 0.55, 0, 0] },
  toxic: { name: 'Toxic', body: [0x22262b, 0.45, 0.3, 0], accent: [0x7dff4a, 0.4, 0, 0.9], wood: [0x2f3a2a, 0.6, 0, 0] },
  lava: { name: 'Lava', body: [0x2a1d1a, 0.5, 0.2, 0], accent: [0xff6a1f, 0.4, 0, 1.1], wood: [0x3a2219, 0.6, 0, 0] },
  ocean: { name: 'Ocean', body: [0x0f5f8a, 0.38, 0.15, 0], accent: [0x5ff0e6, 0.4, 0.05, 0.2], wood: [0x2c86a8, 0.5, 0, 0] },
  sunset: { name: 'Sunset', body: [0xff7a59, 0.42, 0.05, 0], accent: [0x6b3fb3, 0.42, 0.1, 0], wood: [0xffb36b, 0.6, 0, 0] },
  bubblegum: { name: 'Bubblegum', body: [0xb98cff, 0.42, 0.05, 0], accent: [0xff6fb5, 0.42, 0.05, 0], wood: [0xffd6ef, 0.55, 0, 0] },
  chrome: { name: 'Chrome', body: [0xdfe5ea, 0.12, 1.0, 0], accent: [0x2e333b, 0.4, 0.4, 0], wood: [0x111215, 0.4, 0.2, 0] },
  tiger: { name: 'Tiger', body: [0xf39a25, 0.45, 0.05, 0], accent: [0x1b1b1f, 0.5, 0.1, 0], wood: [0xffd27a, 0.6, 0, 0] },
  mint: { name: 'Mint', body: [0x9ee6c0, 0.45, 0.02, 0], accent: [0x3d5a4f, 0.45, 0.1, 0], wood: [0xe8fff4, 0.55, 0, 0] },
  royal: { name: 'Royal', body: [0x2846b8, 0.35, 0.3, 0], accent: [0xffc531, 0.25, 0.9, 0], wood: [0x5a2a8a, 0.5, 0, 0] },
  ghost: { name: 'Ghost', body: [0xf6f4ee, 0.5, 0, 0.15], accent: [0xbfe9ff, 0.4, 0, 0.6], wood: [0xffffff, 0.55, 0, 0.1] },
  zebra: { name: 'Zebra', body: [0xf6f4ee, 0.5, 0, 0], accent: [0x15161a, 0.5, 0.1, 0], wood: [0x2a2b30, 0.6, 0, 0] },
};
export const SKIN_IDS = Object.keys(SKINS);

// The guns. Anchors keep the old models' positions, which the hands' poses and sight relief were
// tuned to; the iron sights' tops sit exactly on the sight line (the sight anchor's height).
const BUILD = {
  yolk47(k) {
    // Receiver and dust cover, the rear sight block on the sight line.
    k.side('body', [[0.06, -0.03], [-0.26, -0.03], [-0.27, 0.0], [-0.27, 0.05], [-0.2, 0.058], [0.02, 0.062], [0.06, 0.05]], 0.05, 0, 0.005);
    k.side('dark', [[0.055, 0.05], [0.02, 0.064], [-0.2, 0.06], [-0.2, 0.052], [0.05, 0.046]], 0.044, 0, 0.003);
    k.box('dark', [0, 0.072, 0.045], [0.034, 0.02, 0.03]); k.box('dark', [0.011, 0.084, 0.045], [0.009, 0.012, 0.022], 0.001); k.box('dark', [-0.011, 0.084, 0.045], [0.009, 0.012, 0.022], 0.001);
    k.box('metal', [0.026, 0.028, -0.07], [0.006, 0.026, 0.07], 0.001);             // ejection port
    k.box('dark', [0.026, 0.0, 0.0], [0.005, 0.012, 0.07], 0.001, [0, 0, 0]);      // selector lever
    // Wooden furniture: handguard (lower and upper), stock with a butt plate.
    k.side('wood', [[-0.27, -0.028], [-0.47, -0.022], [-0.48, 0.0], [-0.47, 0.034], [-0.27, 0.036]], 0.06, 0, 0.007);
    for (let i = 0; i < 3; i++) k.box('woodDark', [0, -0.03, -0.31 - i * 0.05], [0.05, 0.006, 0.026], 0.001);
    k.cyl('metal', [0, 0.045, -0.37], 0.013, 0.2, 10);
    k.side('wood', [[-0.28, 0.035], [-0.44, 0.04], [-0.44, 0.06], [-0.3, 0.062], [-0.28, 0.056]], 0.042, 0, 0.006);
    k.side('wood', [[0.06, 0.04], [0.33, -0.005], [0.34, -0.012], [0.34, -0.125], [0.3, -0.125], [0.12, -0.05], [0.06, -0.03]], 0.044, 0, 0.008);
    k.side('grip', [[0.342, 0.0], [0.358, 0.0], [0.358, -0.128], [0.342, -0.128]], 0.046, 0, 0.003);
    // Grip, guard, barrel, gas block and front sight (posts up to the sight line, hooded), brake.
    k.pgrip(0.03, -0.028, 0.11, 0.036, 'grip', 0.04);
    k.guard(-0.005, -0.03, 0.065);
    k.cyl('metal', [0, 0.012, -0.57], 0.011, 0.2, 10);
    k.box('dark', [0, 0.03, -0.48], [0.03, 0.04, 0.03]);
    k.side('dark', [[-0.585, 0.0], [-0.615, 0.0], [-0.61, 0.04], [-0.59, 0.04]], 0.024, 0, 0.002);
    k.box('dark', [0, 0.072, -0.6], [0.0045, 0.036, 0.008], 0.0005);
    k.box('dark', [0.011, 0.07, -0.6], [0.003, 0.04, 0.012], 0.0005); k.box('dark', [-0.011, 0.07, -0.6], [0.003, 0.04, 0.012], 0.0005);
    k.cyl('dark', [0, 0.012, -0.685], 0.017, 0.045, 10); k.ribs('metal', 0, 0.03, -0.672, -0.698, 3, 0.012, 0.004, 0.006);
    // The banana magazine (orange, yolk-coloured), pivoted at the well.
    k.part('mag', [0, -0.03, -0.08]);
    k.side('accent', [[-0.035, -0.028], [-0.115, -0.028], [-0.135, -0.11, -0.175, -0.2], [-0.115, -0.218], [-0.09, -0.12, -0.04, -0.035]], 0.042, 0, 0.005);
    k.ribs('dark', 0, -0.075, -0.1, -0.1, 1, 0.044, 0.006, 0.05); k.box('dark', [0, -0.21, -0.147], [0.046, 0.012, 0.05], 0.002, [0.55, 0, 0]);
    // The charging handle rides with the bolt.
    k.part('slide', [0.03, 0.03, -0.06]);
    k.box('metal', [0.026, 0.03, -0.12], [0.006, 0.012, 0.05], 0.001); k.cyl('metal', [0.036, 0.03, -0.14], 0.007, 0.018, 8, 0.007, [0, Math.PI / 2, 0]);
    k.main();
    Object.assign(k.u, { muzzle: V(0, 0.012, -0.71), sight: V(0, 0.09, 0.04), grip: V(0, -0.07, 0.01), support: V(0, -0.02, -0.32), eject: V(0.032, 0.035, -0.06), slideTravel: 0.045 });
  },
  beater(k) {
    // A bullpup: one long moulded shell, the magazine behind the grip, a carry rail with a reflex sight.
    k.side('body', [[0.21, -0.05], [-0.1, -0.05], [-0.2, -0.04], [-0.27, -0.02], [-0.27, 0.035], [-0.2, 0.058], [0.15, 0.062], [0.21, 0.045]], 0.06, 0, 0.012);
    k.side('accent', [[0.215, 0.045], [0.235, 0.04], [0.235, -0.11], [0.2, -0.11], [0.2, -0.05], [0.215, -0.05]], 0.064, 0, 0.008);   // butt pad
    k.side('dark', [[0.2, -0.05], [0.04, -0.05], [0.04, -0.055], [0.2, -0.11]], 0.05, 0, 0.004);                                      // lower stock
    k.box('accent', [0.031, 0.01, -0.0], [0.004, 0.03, 0.34], 0.001); k.box('accent', [-0.031, 0.01, -0.0], [0.004, 0.03, 0.34], 0.001);
    k.box('metal', [0.03, 0.04, 0.12], [0.006, 0.024, 0.07], 0.001);                                                                 // ejection port
    k.rail(0.17, -0.06, 0.068, 0.024);
    // Reflex sight: an open hoop on a mount, the red dot exactly on the sight line.
    k.box('dark', [0, 0.085, 0.07], [0.026, 0.022, 0.05]);
    k.ring('dark', [0, 0.12, 0.07], 0.03, 0.024, 0.012, 14); k.ring('accent', [0, 0.12, 0.062], 0.031, 0.027, 0.003, 14);
    k.box('dark', [0, 0.098, 0.07], [0.012, 0.016, 0.012]);
    k.ball('dot', [0, 0.12, 0.064], 0.0022, [1, 1, 0.3], 6, 4);
    // Grip (forward of the magazine), guard, front grip, barrel and muzzle.
    k.pgrip(-0.045, -0.05, 0.1, 0.036, 'grip', 0.03);
    k.guard(-0.06, -0.05, 0.06);
    k.side('grip', [[-0.17, -0.04], [-0.2, -0.04], [-0.205, -0.13], [-0.165, -0.13]], 0.032, 0, 0.006);
    k.cyl('metal', [0, 0.018, -0.31], 0.012, 0.09, 10); k.cyl('dark', [0, 0.018, -0.36], 0.018, 0.035, 12); k.cyl('accent', [0, 0.018, -0.38], 0.019, 0.008, 12);
    k.part('mag', [0, -0.05, 0.12]);
    k.side('accent', [[0.16, -0.05], [0.07, -0.05], [0.07, -0.2], [0.162, -0.2]], 0.04, 0, 0.004);
    k.box('dark', [0, -0.205, 0.116], [0.044, 0.012, 0.1], 0.002);
    k.main();
    Object.assign(k.u, { muzzle: V(0, 0.018, -0.39), sight: V(0, 0.12, 0.18), grip: V(0, -0.08, -0.06), support: V(0, -0.09, -0.18), eject: V(0.036, 0.04, 0.12) });
  },
  triBoil(k) {
    // A burst rifle with a carry handle: aperture rear sight on the handle, a triangle front post.
    k.side('body', [[0.07, -0.035], [-0.16, -0.035], [-0.16, 0.05], [0.07, 0.05]], 0.05, 0, 0.005);
    k.side('dark', [[0.07, 0.05], [-0.16, 0.05], [-0.16, 0.066], [0.07, 0.066]], 0.044, 0, 0.003);
    k.side('dark', [[0.05, 0.066], [0.05, 0.1], [0.035, 0.1], [-0.11, 0.1], [-0.12, 0.066], [-0.09, 0.066], [-0.085, 0.086], [0.025, 0.086], [0.03, 0.066]], 0.02, 0, 0.003);
    k.ring('dark', [0, 0.12, 0.045], 0.014, 0.0045, 0.008, 10); k.box('dark', [0, 0.106, 0.045], [0.012, 0.01, 0.008]);
    k.box('metal', [0.026, 0.035, -0.08], [0.006, 0.026, 0.06], 0.001);
    for (let i = 0; i < 3; i++) k.ball('dot', [0.026, 0.015, -0.02 - i * 0.016], 0.004, [0.6, 1, 1], 6, 4);   // burst lights
    // Ribbed handguard, barrel, front sight tower up to the sight line, bird-cage flash hider.
    k.cyl('body', [0, 0.02, -0.31], 0.034, 0.3, 8, 0.036);
    k.ribs('dark', 0, 0.055, -0.19, -0.43, 6, 0.03, 0.006, 0.012);
    k.cyl('metal', [0, 0.02, -0.53], 0.01, 0.14, 10);
    k.side('dark', [[-0.47, 0.0], [-0.5, 0.0], [-0.497, 0.06], [-0.473, 0.06]], 0.02, 0, 0.002);
    k.side('dark', [[-0.48, 0.06], [-0.49, 0.06], [-0.4865, 0.12], [-0.4835, 0.12]], 0.006, 0, 0.0005);
    k.ring('dark', [0, 0.1, -0.485], 0.014, 0.011, 0.01, 8);
    k.cyl('dark', [0, 0.02, -0.625], 0.015, 0.05, 8); k.ribs('metal', 0, 0.035, -0.61, -0.64, 3, 0.03, 0.004, 0.006);
    // Skeleton stock, grip, guard.
    k.side('dark', [[0.07, 0.045], [0.33, 0.03], [0.34, 0.02], [0.34, -0.11], [0.31, -0.11], [0.07, -0.03]], 0.04, 0, 0.006,
      [[[0.12, 0.02], [0.28, 0.01], [0.24, -0.04], [0.13, -0.01]]]);
    k.side('body', [[0.342, 0.03], [0.358, 0.03], [0.358, -0.112], [0.342, -0.112]], 0.046, 0, 0.003);
    k.pgrip(0.035, -0.035, 0.115, 0.036, 'grip', 0.04);
    k.guard(0.0, -0.035, 0.062, 'body');
    k.part('mag', [0, -0.035, -0.075]);
    k.side('accent', [[-0.04, -0.035], [-0.11, -0.035], [-0.125, -0.18], [-0.07, -0.185]], 0.04, 0, 0.004);
    k.box('dark', [0, -0.18, -0.098], [0.044, 0.01, 0.06], 0.002, [0.08, 0, 0]);
    k.part('slide', [0, 0.06, 0.08]);
    k.box('metal', [0, 0.062, 0.085], [0.03, 0.01, 0.025], 0.001);
    k.main();
    Object.assign(k.u, { muzzle: V(0, 0.02, -0.65), sight: V(0, 0.12, 0.06), grip: V(0, -0.09, 0.02), support: V(0, -0.02, -0.36), eject: V(0.032, 0.04, -0.08), slideTravel: 0.03 });
  },
  cageFree(k) {
    // Marksman rifle: long receiver, a big scope on rings, free-floated barrel, brake, bipod folded.
    k.side('body', [[0.08, -0.03], [-0.2, -0.03], [-0.2, 0.05], [0.08, 0.058]], 0.052, 0, 0.005);
    k.rail(0.07, -0.19, 0.062, 0.026);
    k.box('metal', [0.027, 0.03, -0.06], [0.006, 0.026, 0.07], 0.001);
    k.side('body', [[-0.2, -0.035], [-0.52, -0.03], [-0.53, -0.015], [-0.53, 0.04], [-0.2, 0.05]], 0.05, 0, 0.006);
    for (let i = 0; i < 4; i++) k.box('dark', [0.026, 0.008, -0.26 - i * 0.065], [0.004, 0.022, 0.04], 0.001);
    k.cyl('metal', [0, 0.012, -0.66], 0.012, 0.28, 10);
    k.cyl('dark', [0, 0.012, -0.81], 0.02, 0.06, 10); for (const z of [-0.795, -0.815]) k.box('steel', [0, 0.012, z], [0.042, 0.012, 0.006], 0.001);
    k.box('dark', [0, -0.045, -0.48], [0.014, 0.03, 0.02]); k.box('metal', [0.012, -0.05, -0.39], [0.006, 0.008, 0.18], 0.001); k.box('metal', [-0.012, -0.05, -0.39], [0.006, 0.008, 0.18], 0.001);
    k.scope(-0.06, 0.115, 0.2, 0.024);
    // Stock with cheek riser, grip, guard.
    k.side('accent', [[0.08, 0.05], [0.36, 0.02], [0.37, 0.0], [0.37, -0.115], [0.33, -0.115], [0.2, -0.06], [0.08, -0.03]], 0.046, 0, 0.008);
    k.side('body', [[0.16, 0.042], [0.3, 0.027], [0.3, 0.05], [0.18, 0.06]], 0.034, 0, 0.004);
    k.side('grip', [[0.372, 0.005], [0.388, 0.005], [0.388, -0.118], [0.372, -0.118]], 0.048, 0, 0.003);
    k.pgrip(0.045, -0.03, 0.11, 0.036, 'grip', 0.045);
    k.guard(0.01, -0.03, 0.06);
    k.part('mag', [0, -0.03, -0.09]);
    k.side('dark', [[-0.05, -0.03], [-0.13, -0.03], [-0.13, -0.13], [-0.05, -0.135]], 0.042, 0, 0.004);
    k.box('accent', [0, -0.137, -0.09], [0.046, 0.01, 0.086], 0.002);
    k.part('slide', [0.03, 0.03, -0.02]);
    k.box('metal', [0.026, 0.035, 0.0], [0.006, 0.012, 0.04], 0.001); k.ball('metal', [0.036, 0.035, 0.01], 0.008, [1, 1, 1], 8, 6);
    k.main();
    Object.assign(k.u, { muzzle: V(0, 0.012, -0.84), sight: V(0, 0.115, 0.16), grip: V(0, -0.08, 0.02), support: V(0, -0.03, -0.36), eject: V(0.03, 0.035, -0.06), slideTravel: 0.03 });
  },
  poacher(k) {
    // Bolt-action: a long wooden stock, a heavy barrel, a big scope; the bolt is its own part.
    k.side('wood', [[0.42, 0.035], [0.12, 0.03], [0.04, -0.03], [-0.5, -0.02], [-0.52, 0.0], [-0.5, 0.02], [0.02, 0.02], [0.1, 0.04], [0.12, 0.045], [0.4, 0.06]], 0.052, 0, 0.008);
    k.side('wood', [[0.44, 0.065], [0.3, 0.035], [0.12, -0.02], [0.1, -0.06], [0.18, -0.13], [0.42, -0.135], [0.44, -0.13]], 0.05, 0, 0.01,
      [[[0.2, -0.03], [0.17, -0.07], [0.22, -0.1], [0.27, -0.06], [0.26, -0.03]]]);
    k.side('grip', [[0.44, 0.068], [0.46, 0.068], [0.46, -0.14], [0.44, -0.14]], 0.054, 0, 0.003);
    k.side('woodDark', [[0.36, 0.06], [0.25, 0.05], [0.25, 0.07], [0.36, 0.08]], 0.04, 0, 0.004);
    k.cyl('body', [0, 0.035, -0.04], 0.026, 0.24, 12);
    k.cyl('body', [0, 0.035, -0.5], 0.017, 0.68, 12, 0.021);
    k.cyl('dark', [0, 0.035, -0.86], 0.024, 0.06, 12); k.ring('accent', [0, 0.035, -0.83], 0.0255, 0.02, 0.008, 12);
    k.scope(-0.03, 0.12, 0.26, 0.026, 0.042);
    k.guard(0.08, -0.025, 0.06, 'accent');
    k.box('accent', [0, -0.045, -0.03], [0.034, 0.012, 0.07], 0.002);                                          // floorplate
    // The bolt: knob, handle and body, pivoted on the action's axis.
    k.part('bolt', [0, 0.035, 0.05]);
    k.cyl('steel', [0, 0.035, 0.08], 0.012, 0.05, 10);
    k.box('steel', [0.03, 0.035, 0.07], [0.05, 0.008, 0.008], 0.001); k.ball('accent', [0.058, 0.03, 0.072], 0.012, [1, 1, 1], 10, 7);
    // The round being loaded (hidden until the reload), at the port.
    k.part('mag', [0, 0.065, -0.04]);
    k.cyl('brass', [0, 0.065, -0.03], 0.007, 0.045, 8); k.cyl('steel', [0, 0.065, -0.062], 0.0065, 0.02, 8, 0.0068);
    k.main();
    Object.assign(k.u, { muzzle: V(0, 0.035, -0.89), sight: V(0, 0.12, 0.26), grip: V(0, -0.08, 0), support: V(0, -0.04, -0.3) });
  },
  doubleYolker(k) {
    // Side-by-side: an engraved receiver, wooden stock and fore-end; the barrels break open on a hinge.
    k.side('body', [[0.07, -0.03], [-0.07, -0.03], [-0.075, 0.0], [-0.07, 0.05], [0.04, 0.055], [0.07, 0.04]], 0.07, 0, 0.007);
    k.box('accent', [0.036, 0.012, -0.0], [0.003, 0.034, 0.1], 0.001); k.box('accent', [-0.036, 0.012, -0.0], [0.003, 0.034, 0.1], 0.001);
    k.box('accent', [0, 0.06, 0.03], [0.014, 0.01, 0.03], 0.002);                                              // top lever
    k.side('wood', [[0.07, 0.04], [0.34, -0.02], [0.35, -0.03], [0.35, -0.135], [0.31, -0.135], [0.13, -0.08], [0.08, -0.07], [0.06, -0.03]], 0.054, 0, 0.01);
    k.side('woodDark', [[0.352, -0.02], [0.366, -0.02], [0.366, -0.138], [0.352, -0.138]], 0.056, 0, 0.003);
    k.guard(0.02, -0.03, 0.06, 'accent');
    k.part('hinge', [0, -0.012, -0.07]);
    for (const x of [-0.022, 0.022]) { k.cyl('body', [x, 0.03, -0.37], 0.021, 0.6, 12); k.ring('dark', [x, 0.03, -0.668], 0.021, 0.015, 0.006, 10); }
    k.box('body', [0, 0.053, -0.37], [0.012, 0.006, 0.6], 0.001);                                              // rib
    k.box('dark', [0, 0.008, -0.37], [0.03, 0.02, 0.6], 0.002);
    k.ball('accent', [0, 0.08, -0.66], 0.005, [1, 1, 1], 8, 6);                                                // bead sight
    k.box('dark', [0, 0.066, -0.66], [0.004, 0.022, 0.005], 0.0005);
    k.side('wood', [[-0.1, -0.005], [-0.3, -0.005], [-0.31, 0.01], [-0.3, 0.025], [-0.1, 0.022]], 0.062, 0, 0.007);
    k.ribs('woodDark', 0, -0.006, -0.15, -0.26, 4, 0.05, 0.004, 0.01);
    k.box('body', [0, 0.03, -0.08], [0.074, 0.05, 0.02], 0.003);                                               // breech face
    // The two shells (only seen while loading).
    k.part('mag', [0, 0.03, -0.02]);
    for (const x of [-0.022, 0.022]) { k.cyl('shell', [x, 0.03, -0.035], 0.017, 0.05, 10); k.cyl('brass', [x, 0.03, -0.005], 0.0185, 0.012, 10); }
    k.main();
    Object.assign(k.u, { muzzle: V(0, 0.03, -0.68), sight: V(0, 0.08, 0.05), grip: V(0, -0.07, 0.04), support: V(0, -0.03, -0.3) });
  },
  yolkzooka(k) {
    // Rocket launcher: the tube with a flared venturi, a yolk-yellow bell, grips, a box sight on the right.
    k.cyl('body', [0, 0.06, -0.2], 0.07, 0.8, 16);
    for (const z of [-0.45, 0.05]) k.cyl('dark', [0, 0.06, z], 0.074, 0.03, 16);
    k.cyl('accent', [0, 0.06, -0.635], 0.088, 0.07, 16, 0.072); k.ring('dark', [0, 0.06, -0.672], 0.088, 0.072, 0.006, 16);
    k.cyl('dark', [0, 0.06, 0.25], 0.09, 0.1, 16, 0.075); k.ring('accent', [0, 0.06, 0.3], 0.09, 0.08, 0.006, 16);
    k.box('accent', [0, 0.13, -0.2], [0.03, 0.012, 0.5], 0.002);                                               // top strip
    k.box('dark', [0.04, 0.105, -0.12], [0.032, 0.03, 0.05]);                                                  // sight mount
    k.box('dark', [0.08, 0.13, -0.12], [0.05, 0.14, 0.05], 0.004);                                             // sight box
    k.box('glass', [0.08, 0.13, -0.146], [0.036, 0.11, 0.004], 0.0005); k.box('glass', [0.08, 0.13, -0.094], [0.036, 0.11, 0.004], 0.0005);
    k.ball('dot', [0.08, 0.13, -0.148], 0.0028, [1, 1, 0.3], 6, 4);
    k.side('grip', [[0.01, -0.01], [-0.03, -0.01], [-0.02, -0.15], [0.03, -0.15]], 0.04, 0, 0.006);
    k.guard(-0.015, -0.015, 0.05);
    k.side('grip', [[-0.25, -0.01], [-0.29, -0.01], [-0.285, -0.14], [-0.245, -0.14]], 0.036, 0, 0.006);
    k.box('accent', [0, 0.0, 0.18], [0.03, 0.03, 0.1], 0.004);                                                 // shoulder pad
    // The rocket (seen loading): yolk warhead on a dark body with fins.
    k.part('mag', [0, 0.06, -0.6]);
    k.cyl('dark', [0, 0.06, -0.56], 0.04, 0.12, 12); k.ball('accent', [0, 0.06, -0.63], 0.045, [1, 1, 1.5], 12, 8);
    for (let i = 0; i < 4; i++) k.box('accent', [Math.cos(i * Math.PI / 2) * 0.04, 0.06 + Math.sin(i * Math.PI / 2) * 0.04, -0.51], [0.004, 0.004, 0.04], 0.0005, [0, 0, i * Math.PI / 2]);
    k.main();
    Object.assign(k.u, { muzzle: V(0, 0.06, -0.72), sight: V(0.08, 0.13, 0.05), grip: V(0, -0.08, -0.02), support: V(0, -0.08, -0.27) });
  },
  peck9mm(k) {
    // Pistol: the frame with an accent grip; the slide (its own part) kicks back with each shot.
    k.side('accent', [[0.06, -0.0], [-0.13, -0.0], [-0.13, 0.018], [0.06, 0.02]], 0.03, 0, 0.004);
    k.rail(-0.06, -0.12, -0.006, 0.02, 'dark');
    k.side('accent', [[0.062, 0.0], [0.02, 0.0], [0.03, -0.06], [0.04, -0.125], [0.098, -0.128], [0.09, -0.06], [0.07, -0.0]], 0.034, 0, 0.007);
    for (let i = 0; i < 4; i++) k.box('dark', [0, -0.03 - i * 0.022, 0.06 + i * 0.004], [0.036, 0.008, 0.035], 0.001);
    k.guard(0.01, 0.0, 0.05, 'accent');
    k.part('slide', [0, 0.02, 0]);
    k.side('body', [[0.065, 0.018], [-0.135, 0.018], [-0.135, 0.05], [-0.125, 0.056], [0.055, 0.056], [0.065, 0.05]], 0.03, 0, 0.004);
    k.ribs('metal', 0, 0.037, 0.035, 0.055, 4, 0.032, 0.022, 0.003);
    k.box('metal', [0.0155, 0.04, -0.02], [0.002, 0.016, 0.04], 0.0005);
    k.box('dark', [0.008, 0.06, 0.055], [0.006, 0.008, 0.01], 0.0005); k.box('dark', [-0.008, 0.06, 0.055], [0.006, 0.008, 0.01], 0.0005);
    k.box('dark', [0, 0.059, -0.12], [0.005, 0.006, 0.008], 0.0005); k.ball('dot', [0, 0.0605, -0.116], 0.0018, [1, 1, 0.4], 6, 4);
    k.cyl('metal', [0, 0.034, -0.134], 0.008, 0.008, 10);
    k.part('mag', [0, -0.005, 0.06]);
    k.side('metal', [[0.03, -0.01], [0.075, -0.01], [0.093, -0.125], [0.045, -0.125]], 0.026, 0, 0.002);
    k.box('dark', [0, -0.13, 0.07], [0.034, 0.012, 0.058], 0.002, [-0.1, 0, 0]);
    k.main();
    Object.assign(k.u, { muzzle: V(0, 0.034, -0.14), sight: V(0, 0.06, 0.12), grip: V(0, -0.07, 0.04), support: V(0, -0.08, 0.03), eject: V(0.018, 0.04, -0.02), slideTravel: 0.035 });
  },
  whisk(k) {
    k.cyl('body', [0, 0, 0.09], 0.017, 0.16, 10, 0.02); k.ring('body', [0, 0, 0.175], 0.02, 0.008, 0.02, 8);
    k.cyl('steel', [0, 0, 0.0], 0.01, 0.03, 8);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI, curve = new THREE.EllipseCurve(0, 0, 0.045, 0.15, 0, Math.PI, false, 0);
      const pts = curve.getPoints(10).map(p => V(p.x * Math.cos(a), p.x * Math.sin(a), -p.y));
      k.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0035, k.lo ? 3 : 4), 'steel');
    }
    Object.assign(k.u, { muzzle: V(0, 0, -0.15) });
  },
  grenade(k) {
    // The Cluck Bomb: an egg-shaped body with a yolk band, the spoon, pin and ring.
    k.ball('body', [0, 0, 0], 0.068, [1, 1.18, 1], 14, 10);
    k.cyl('accent', [0, 0.0, 0], 0.07, 0.024, 14, 0.07, [Math.PI / 2, 0, 0]);
    k.cyl('metal', [0, 0.088, 0], 0.024, 0.03, 10, 0.024, [Math.PI / 2, 0, 0]);
    k.box('metal', [0.022, 0.06, 0], [0.01, 0.07, 0.018], 0.002, [0, 0, -0.25]);
    k.ring('accent', [-0.028, 0.1, 0], 0.016, 0.011, 0.004, 10, [0, Math.PI / 2, 0]);
    Object.assign(k.u, { muzzle: V(0, 0, 0) });
  },
};
export const GUN_IDS = Object.keys(BUILD);
// Parts that only exist while loading (shotgun shells, the sniper round, the rocket).
export const LOADED_ONLY = new Set(['doubleYolker', 'poacher', 'yolkzooka']);

function palette(id, skin) {
  const s = SKINS[skin] || SKINS.factory, look = LOOK[id] || {};
  return { ...BASE, ...look, ...(s.body ? { body: s.body } : {}), ...(s.accent ? { accent: s.accent } : {}), ...(s.wood && look.wood ? { wood: s.wood } : {}) };
}

// The cached source models: full detail for the first-person view, lighter ones for everything else.
const cache = new Map();
function source(id, skin, lo) {
  const key = id + '|' + skin + '|' + (lo ? 1 : 0);
  if (!cache.has(key)) {
    const k = new Kit(palette(BUILD[id] ? id : 'yolk47', skin), lo);
    (BUILD[id] || BUILD.yolk47)(k);
    const g = k.build(); g.userData = { ...k.u, model: id };
    cache.set(key, g);
  }
  return cache.get(key);
}
function anchorsCopy(u) { const o = {}; for (const [k, v] of Object.entries(u)) o[k] = v && v.isVector3 ? v.clone() : v; return o; }

// A gun's attachment points (gun space), without building a copy.
export const gunAnchors = id => source(BUILD[id] ? id : 'yolk47', 'factory', true).userData;

// A gun to hold. The moving parts are child groups named in userData (mag, slide, hinge, bolt).
// still = true gives the light, single-mesh version (other eggs' guns, pickups, icons).
export function gunModel(id, still = false, skin = 'factory') {
  if (still) {
    const m = new THREE.Mesh(stillGeometry(id, skin), kitMaterial()); m.castShadow = true;
    const g = new THREE.Group(); g.add(m); g.userData = anchorsCopy(source(id, skin, true).userData); return g;
  }
  const src = source(id, skin, false), g = src.clone(true);
  g.userData = anchorsCopy(src.userData);
  for (const name of ['mag', 'slide', 'hinge', 'bolt']) { const p = g.getObjectByName(name); if (p && p !== g) g.userData[name] = p; }
  return g;
}

// The light model merged into one geometry (parts at rest; shells, round and rocket left out).
const stillCache = new Map();
export function stillGeometry(id, skin = 'factory') {
  const key = id + '|' + skin;
  if (stillCache.has(key)) return stillCache.get(key);
  const src = source(id, skin, true), list = [];
  src.updateMatrixWorld(true);
  src.traverse(o => {
    if (!o.isMesh) return;
    if (o.parent?.name === 'mag' && LOADED_ONLY.has(id)) return;
    list.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
  });
  const geo = mergeGeometries(list); geo.computeBoundingSphere();
  stillCache.set(key, geo);
  return geo;
}

// A low-poly mitten for other eggs (palm, finger lump, thumb, cuff; ~300 triangles): fingers point
// along -z, the thumb sits on -x, the cuff at +z.
export function mittenParts(k) {
  k.ball('glove', [0, 0, 0], 0.06, [1, 0.8, 1.12], 10, 7);
  k.ball('glove', [0, 0.006, -0.05], 0.05, [1.05, 0.72, 0.9], 8, 6);
  k.ball('glove', [-0.055, 0.004, 0.0], 0.028, [0.7, 0.8, 1.3], 6, 5);
  k.cyl('glove', [0, 0, 0.078], 0.04, 0.03, 10, 0.044);
}
// What another egg holds: its gun and both mittens, baked into one geometry in the arms' space (one
// draw call per egg). Positions follow the hold in egg.js: gun at `at` scaled `s`, mittens at the
// grip and support points.
const heldCache = new Map();
export function heldGeometry(id, skin = 'factory', at = [0.27, -0.02, -0.2]) {
  const key = id + '|' + skin;
  if (heldCache.has(key)) return heldCache.get(key);
  const s = id === 'peck9mm' ? 0.75 : 0.55, u = source(id, skin, true).userData, pos = V(...at);
  const gun = stillGeometry(id, skin).clone().scale(s, s, s).translate(pos.x, pos.y, pos.z);
  const grip = u.grip.clone().multiplyScalar(s).add(pos), sup = id === 'peck9mm' ? grip.clone().add(V(-0.05, 0, 0)) : u.support.clone().multiplyScalar(s).add(pos);
  const k = new Kit({ ...BASE }, false);
  mittenParts(k);
  const mitt = mergeGeometries(k.parts.get('body').list).scale(0.75, 0.75, 0.75);
  const geo = mergeGeometries([gun, mitt.clone().translate(grip.x, grip.y, grip.z), mitt.clone().translate(sup.x, sup.y, sup.z)]);
  geo.computeBoundingSphere();
  heldCache.set(key, geo);
  return geo;
}
