// Hats, modelled in code with the kit: each is one mesh (one draw call) in the shared kit material.
// The origin is where a hat sits on the egg: 0.04 below its tip, where the shell is about 0.13
// across; anything with a brim or band sits a little lower and wider so the shell never pokes out.
import * as THREE from '../../vendor/three/three.module.js?v=muwy3maj';
import { Kit, kitMaterial } from './kit.js?v=muwy3maj';

const PAL = {
  red: [0xd8452f, 0.6, 0, 0], white: [0xf6f4ee, 0.85, 0, 0], cream: [0xf3e6c8, 0.6, 0, 0], blue: [0x2f6fd6, 0.9, 0, 0], navy: [0x1f3f8a, 0.9, 0, 0],
  black: [0x1d1d22, 0.55, 0.1, 0], gold: [0xffc531, 0.25, 0.9, 0], brown: [0x5a3a26, 0.7, 0, 0], leather: [0x9a6a3a, 0.65, 0, 0], tan: [0xc9a46b, 0.8, 0, 0],
  olive: [0x6b7a45, 0.85, 0, 0], leaf: [0x5cc24a, 0.7, 0, 0], pink: [0xff8fb8, 0.7, 0, 0], purple: [0x5b2fb3, 0.75, 0, 0], yellow: [0xffd23f, 0.55, 0, 0],
  orange: [0xf39a25, 0.5, 0, 0], steel: [0xa3acb6, 0.3, 0.9, 0], felt: [0xb5242a, 0.9, 0, 0], straw: [0xe8c06a, 0.85, 0, 0], green: [0x3ccf7a, 0.6, 0, 0],
  glowGold: [0xffe08a, 0.3, 0.2, 1.6], glowGreen: [0x7dff6a, 0.4, 0, 1.6], glowStar: [0xfff2a8, 0.4, 0, 1.2], ruby: [0xff2a4a, 0.15, 0.3, 0.3], sapphire: [0x3a7bff, 0.15, 0.3, 0.3],
  ink: [0x15161a, 0.5, 0, 0],
};
const { PI } = Math;
// Points on an arc (for bands and ridges): centre, radius, from/to angles in the given plane.
const arc = (cx, cy, r, a0, a1, n, plane = 'xy') => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n, u = Math.cos(a) * r, v = Math.sin(a) * r; return plane === 'xy' ? [cx + u, cy + v, 0] : [0, cy + v, cx + u]; });

const BUILD = {
  cap(k) { k.dome('red', [0, -0.03, 0], 0.172, [1, 0.8, 1]); k.vcyl('red', [0, -0.035, -0.11], 0.12, 0.012, 18, 0.12, null, [1, 1, 0.78]); k.ball('white', [0, 0.106, 0], 0.017); k.ball('white', [0, 0.02, -0.165], 0.03, [1, 1, 0.3]); },
  beanie(k) { k.dome('blue', [0, -0.03, 0], 0.18, [1, 0.95, 1]); k.vcyl('navy', [0, -0.05, 0], 0.186, 0.055, 20); k.ball('white', [0, 0.155, 0], 0.05); },
  chef(k) { k.vcyl('white', [0, -0.045, 0], 0.182, 0.1, 20); for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2; k.ball('white', [Math.cos(a) * 0.095, 0.11, Math.sin(a) * 0.095], 0.09); } k.ball('white', [0, 0.15, 0], 0.11); },
  cowboy(k) {
    k.vcyl('leather', [0, -0.035, 0], 0.27, 0.012, 24, 0.27, null, [1, 1, 0.82]); k.ring('leather', [0, -0.024, 0], 0.27, 0.25, 0.022, 20, [PI / 2, 0, 0]);
    k.vcyl('leather', [0, -0.03, 0], 0.158, 0.15, 16, 0.135); k.dome('leather', [0, 0.118, 0], 0.135, [1, 0.35, 1]); k.vcyl('brown', [0, -0.02, 0], 0.16, 0.035, 16, 0.155);
  },
  viking(k) {
    k.dome('steel', [0, -0.04, 0], 0.185, [1, 0.92, 1]); k.vcyl('brown', [0, -0.055, 0], 0.19, 0.04, 20);
    k.tube('steel', arc(0, -0.04, 0.17, -0.2, PI + 0.2, 8, 'zy').map(([x, y, z]) => [x, y, z]), 0.012);
    for (const s of [-1, 1]) { k.tube('cream', [[s * 0.16, 0.0, 0], [s * 0.25, 0.05, 0], [s * 0.29, 0.14, 0]], 0.03, 8, 8); k.vcyl('cream', [s * 0.29, 0.14, 0], 0.03, 0.09, 8, 0.0, [0, 0, -s * 0.25]); }
  },
  wizard(k) {
    k.vcyl('purple', [0, -0.035, 0], 0.26, 0.012, 22); k.vcyl('purple', [0, -0.03, 0], 0.165, 0.17, 16, 0.11);
    k.vcyl('purple', [0.012, 0.135, 0.004], 0.11, 0.15, 14, 0.06, [0, 0, -0.12]); k.vcyl('purple', [0.04, 0.28, 0.01], 0.06, 0.13, 12, 0.0, [0, 0, -0.4]);
    k.vcyl('gold', [0, -0.025, 0], 0.168, 0.03, 16, 0.162);
    for (const [x, y, z] of [[0.1, 0.06, -0.12], [-0.08, 0.12, -0.08], [0.03, 0.2, -0.07], [-0.12, 0.03, -0.11]]) k.ball('glowStar', [x, y, z], 0.014, [1, 1, 0.5], 6, 4);
  },
  party(k) {
    const cols = ['pink', 'yellow', 'pink', 'yellow'];
    for (let i = 0; i < 4; i++) k.vcyl(cols[i], [0, -0.01 + i * 0.075, 0], 0.13 * (1 - i / 4), 0.075, 14, 0.13 * (1 - (i + 1) / 4));
    k.ball('white', [0, 0.3, 0], 0.035); for (let i = 0; i < 5; i++) { const a = i / 5 * PI * 2; k.ball(i % 2 ? 'blue' : 'green', [Math.cos(a) * 0.08, 0.04, Math.sin(a) * 0.08], 0.012, [1, 1, 1], 6, 4); }
  },
  propeller(k) {
    const cols = ['red', 'yellow', 'blue', 'green'];
    for (let i = 0; i < 4; i++) k.push(new THREE.SphereGeometry(0.178, k.lo ? 4 : 6, k.lo ? 3 : 6, i * PI / 2, PI / 2, 0, PI / 2), cols[i], [0, -0.03, 0], null, [1, 0.85, 1]);
    k.vcyl('ink', [0, 0.11, 0], 0.01, 0.05); k.ball('red', [0, 0.165, 0], 0.016);
    k.box('yellow', [0, 0.165, 0], [0.3, 0.006, 0.045], 0.002, [0.15, 0.4, 0]); k.box('blue', [0, 0.165, 0], [0.045, 0.006, 0.3], 0.002, [0, 0.4, 0.15]);
  },
  headphones(k) {
    k.tube('ink', arc(0, -0.14, 0.255, -0.05, PI + 0.05, 14), 0.016, 14, 6);
    for (const s of [-1, 1]) { k.vcyl('red', [s * 0.24, -0.19, 0], 0.065, 0.045, 16, 0.06, [0, 0, -s * PI / 2]); k.vcyl('ink', [s * 0.285, -0.19, 0], 0.045, 0.01, 12, 0.03, [0, 0, -s * PI / 2]); }
  },
  bunny(k) {
    k.tube('pink', arc(0, -0.12, 0.2, 0.15, PI - 0.15, 10), 0.012);
    for (const s of [-1, 1]) { k.ball('white', [s * 0.075, 0.15, 0], 0.05, [0.5, 1.9, 0.3], 10, 8); k.ball('pink', [s * 0.075, 0.15, -0.01], 0.034, [0.45, 1.75, 0.2], 8, 6); }
  },
  pirate(k) {
    k.dome('black', [0, -0.035, 0], 0.178, [1, 0.72, 1]);
    k.side('black', [[-0.03, -0.03], [-0.25, 0.07], [-0.2, 0.17], [-0.06, 0.11], [0.06, 0.11], [0.2, 0.17], [0.25, 0.07], [0.03, -0.03]], 0.05, 0, 0.004, null, [0, PI / 2, 0]);
    k.vcyl('gold', [0, -0.04, 0], 0.18, 0.016, 20);
    k.ball('white', [0, 0.065, -0.03], 0.03, [1, 1, 0.5]); k.box('white', [0, 0.04, -0.035], [0.08, 0.012, 0.01], 0.001, [0, 0, 0.6]); k.box('white', [0, 0.04, -0.035], [0.08, 0.012, 0.01], 0.001, [0, 0, -0.6]);
  },
  sombrero(k) {
    k.vcyl('straw', [0, -0.04, 0], 0.34, 0.012, 26); k.ring('straw', [0, -0.03, 0], 0.345, 0.315, 0.035, 24, [PI / 2, 0, 0]);
    k.vcyl('straw', [0, -0.035, 0], 0.16, 0.2, 16, 0.095); k.dome('straw', [0, 0.165, 0], 0.095, [1, 0.45, 1]);
    k.vcyl('red', [0, -0.03, 0], 0.162, 0.045, 16, 0.148);
    for (let i = 0; i < 10; i++) { const a = i / 10 * PI * 2; k.ball(i % 2 ? 'green' : 'yellow', [Math.cos(a) * 0.158, -0.008, Math.sin(a) * 0.158], 0.012, [1, 1, 1], 6, 4); }
  },
  beret(k) { k.ball('felt', [0.03, 0.025, 0], 0.2, [1, 0.3, 1], 16, 8); k.vcyl('felt', [0.03, 0.08, 0], 0.01, 0.025, 6); },
  bucket(k) { k.vcyl('tan', [0, -0.06, 0], 0.25, 0.05, 20, 0.172); k.vcyl('tan', [0, -0.02, 0], 0.172, 0.14, 18, 0.14); k.dome('tan', [0, 0.12, 0], 0.14, [1, 0.25, 1]); k.vcyl('brown', [0, -0.015, 0], 0.174, 0.025, 18, 0.168); },
  flower(k) {
    k.vcyl('leaf', [0, 0.0, 0], 0.01, 0.09, 6); k.ball('leaf', [0.045, 0.045, 0], 0.04, [1, 0.25, 0.5], 8, 5);
    for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2; k.ball('pink', [Math.cos(a) * 0.055, 0.095, Math.sin(a) * 0.055], 0.045, [1, 0.32, 0.62], 8, 6, ); }
    k.ball('yellow', [0, 0.1, 0], 0.032);
  },
  antenna(k) { for (const s of [-1, 1]) { k.tube('ink', [[s * 0.04, -0.01, 0], [s * 0.07, 0.1, 0], [s * 0.11, 0.2, 0]], 0.008, 8, 5); k.ball('glowGreen', [s * 0.115, 0.215, 0], 0.03); } },
  horns(k) { for (const s of [-1, 1]) { k.vcyl('red', [s * 0.07, -0.01, -0.02], 0.038, 0.09, 10, 0.022, [0, 0, -s * 0.45]); k.vcyl('red', [s * 0.11, 0.07, -0.02], 0.022, 0.07, 10, 0.0, [0, 0, -s * 0.05]); } },
  santa(k) {
    k.vcyl('white', [0, -0.055, 0], 0.19, 0.06, 20); k.vcyl('red', [0, 0.0, 0], 0.172, 0.13, 18, 0.11);
    k.vcyl('red', [0.0, 0.125, 0], 0.11, 0.12, 14, 0.05, [0, 0, -0.55]); k.ball('white', [0.12, 0.21, 0], 0.045);
  },
  hardhat(k) {
    k.dome('yellow', [0, -0.035, 0], 0.18, [1, 0.82, 1]); k.vcyl('yellow', [0, -0.04, -0.02], 0.215, 0.014, 22, 0.215, null, [1, 1, 1.06]);
    k.tube('yellow', arc(0, -0.035, 0.155, 0.25, PI - 0.25, 10, 'zy'), 0.018, 10, 6);
    k.vcyl('steel', [0, 0.06, -0.16], 0.024, 0.02, 10, 0.024, [-PI / 2 + 0.5, 0, 0]); k.ball('glowGold', [0, 0.068, -0.18], 0.017, [1, 1, 0.5]);
  },
  bow(k) { for (const s of [-1, 1]) k.ball('pink', [0.07 + s * 0.065, 0.06, -0.02], 0.06, [0.95, 0.7, 0.35], 10, 7); k.ball('pink', [0.07, 0.06, -0.025], 0.03, [1, 1, 0.8]); },
  fez(k) { k.vcyl('felt', [0, -0.008, 0], 0.142, 0.15, 16, 0.105); k.tube('ink', [[0, 0.142, 0], [0.06, 0.15, 0], [0.105, 0.06, 0]], 0.006, 8, 4); k.ball('gold', [0.105, 0.05, 0], 0.016, [1, 1.5, 1]); },
  grad(k) {
    k.vcyl('black', [0, -0.045, 0], 0.182, 0.1, 18, 0.17); k.box('black', [0, 0.062, 0], [0.38, 0.016, 0.38], 0.002, [0, PI / 4, 0]);
    k.ball('gold', [0, 0.073, 0], 0.014); k.tube('gold', [[0, 0.072, 0], [0.13, 0.072, 0], [0.2, 0.0, 0]], 0.006, 8, 4); k.ball('gold', [0.2, -0.01, 0], 0.016, [1, 1.6, 1]);
  },
  mohawk(k) {
    for (let i = -5; i <= 5; i++) {
      const phi = i * 0.13, h = 0.17 - Math.abs(i) * 0.012, d = [0, Math.cos(phi), -Math.sin(phi)];
      k.box(i % 2 ? 'pink' : 'green', [0, -0.13 + d[1] * (0.16 + h / 2), d[2] * (0.16 + h / 2)], [0.028, h, 0.035], 0.002, [-phi, 0, 0]);
    }
  },
  chick(k) {
    k.ball('yellow', [0, 0.05, 0.01], 0.075, [1, 0.88, 1.12], 12, 8); k.ball('yellow', [0, 0.14, -0.03], 0.052, [1, 1, 1], 12, 8);
    k.vcyl('orange', [0, 0.135, -0.075], 0.016, 0.035, 6, 0.0, [-PI / 2, 0, 0]);
    for (const s of [-1, 1]) { k.ball('ink', [s * 0.022, 0.155, -0.072], 0.008, [1, 1, 0.6], 6, 4); k.ball('yellow', [s * 0.07, 0.05, 0.02], 0.04, [0.35, 0.7, 1], 8, 6); }
    k.ball('yellow', [0, 0.195, -0.02], 0.02, [0.6, 1.2, 0.6], 6, 4);
  },
  sprout(k) { k.tube('leaf', [[0, -0.0, 0], [0.012, 0.08, 0], [0, 0.14, 0]], 0.008, 8, 5); for (const s of [-1, 1]) k.ball('leaf', [s * 0.048, 0.15, 0], 0.048, [1, 0.22, 0.55], 10, 6); },
  tophat(k) { k.vcyl('black', [0, -0.025, 0], 0.21, 0.014, 26); k.vcyl('black', [0, -0.015, 0], 0.148, 0.24, 20, 0.152); k.vcyl('red', [0, -0.01, 0], 0.152, 0.04, 20, 0.153); k.dome('black', [0, 0.225, 0], 0.152, [1, 0.06, 1], 20, 3); },
  halo(k) { k.ring('glowGold', [0, 0.2, 0], 0.13, 0.105, 0.022, 28, [PI / 2, 0, 0]); },
  crown(k) {
    k.ring('gold', [0, 0.035, 0], 0.155, 0.138, 0.075, 20, [PI / 2, 0, 0]);
    for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2, c = Math.cos(a) * 0.146, s = Math.sin(a) * 0.146; k.vcyl('gold', [c, 0.07, s], 0.03, 0.08, 4, 0.0); k.ball('gold', [c, 0.155, s], 0.012, [1, 1, 1], 6, 4); k.ball(i % 2 ? 'ruby' : 'sapphire', [Math.cos(a) * 0.158, 0.035, Math.sin(a) * 0.158], 0.016, [1, 1, 0.6], 8, 5); }
  },
};
export const HAT_IDS = Object.keys(BUILD);

const cache = new Map();
// One hat's geometry (cached), or null for none or an unknown id.
export function hatGeometry(id) {
  if (!BUILD[id]) return null;
  if (!cache.has(id)) { const k = new Kit(PAL, false); BUILD[id](k); cache.set(id, k.geometry()); }
  return cache.get(id);
}
export function hatMesh(id) {
  const g = hatGeometry(id); if (!g) return null;
  const m = new THREE.Mesh(g, kitMaterial()); m.castShadow = true; m.receiveShadow = true; return m;
}
