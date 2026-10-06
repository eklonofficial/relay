// The modelling kit the guns and hats are made from: side profiles extruded with a chamfer (crisp
// silhouettes, soft edges that catch the light), turned parts, rings and balls. Every part carries
// its colour, roughness, metalness and glow in its vertices, so a whole model is one mesh and one
// draw call with one shared material, and a repaint (a gun skin, a hat's colour) is just a palette.
import * as THREE from '../../vendor/three/three.module.js?v=muwqe2h8';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js?v=muwqe2h8';

// Slot → [colour, roughness, metalness, glow]. body/accent/wood are what skins repaint.
export const BASE = {
  dark: [0x2e333b, 0.48, 0.5, 0], metal: [0x5d6570, 0.32, 0.85, 0], steel: [0xa3acb6, 0.24, 0.92, 0],
  grip: [0x232429, 0.86, 0, 0], wood: [0xa4622f, 0.62, 0, 0], woodDark: [0x6e3d1e, 0.66, 0, 0], brass: [0xd9a441, 0.3, 0.9, 0],
  glass: [0x6fd0ff, 0.06, 0.3, 0.35], dot: [0xff3b2a, 0.4, 0, 2.2], white: [0xf2efe8, 0.55, 0, 0], shell: [0xc8342a, 0.5, 0.05, 0],
  glove: [0xffffff, 0.62, 0, 0], body: [0x30353d, 0.45, 0.35, 0], accent: [0xf39a25, 0.42, 0.08, 0],
};
// One material for every kit part: the vertices say how rough, metallic and glowing each part is.
const KIT_VERT = ['#include <common>', '#include <common>\nattribute vec3 mre; varying vec3 vMre;', '#include <begin_vertex>', '#include <begin_vertex>\nvMre = mre;'];
const KIT_FRAG = ['#include <common>', '#include <common>\nvarying vec3 vMre;', '#include <roughnessmap_fragment>', 'float roughnessFactor = vMre.x;',
  '#include <metalnessmap_fragment>', 'float metalnessFactor = vMre.y;', '#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vMre.z;'];
let kitMat = null;
export function kitMaterial() {
  if (kitMat) return kitMat;
  kitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 1 });
  kitMat.name = 'kit';
  kitMat.onBeforeCompile = s => {
    for (let i = 0; i < KIT_VERT.length; i += 2) s.vertexShader = s.vertexShader.replace(KIT_VERT[i], KIT_VERT[i + 1]);
    for (let i = 0; i < KIT_FRAG.length; i += 2) s.fragmentShader = s.fragmentShader.replace(KIT_FRAG[i], KIT_FRAG[i + 1]);
  };
  kitMat.customProgramCacheKey = () => 'kit';
  return kitMat;
}

const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// A 2D outline from [z, y] points; a 4-number entry [cz, cy, z, y] is a curve through a control point.
function shapeOf(pts) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => { if (i === 0) s.moveTo(p[0], p[1]); else if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]); else s.lineTo(p[0], p[1]); });
  return s;
}

// Builds one model: parts go into the body or into a named moving part (pivoted at `at`).
export class Kit {
  constructor(pal, lo) { this.pal = pal; this.lo = lo; this.parts = new Map([['body', { at: V(), list: [] }]]); this.cur = this.parts.get('body'); this.u = {}; }
  part(name, at) { if (!this.parts.has(name)) this.parts.set(name, { at: V(...at), list: [] }); this.cur = this.parts.get(name); return this; }
  main() { this.cur = this.parts.get('body'); return this; }
  push(g, slot, pos, rot, scale) {
    if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    _e.set(...(rot || [0, 0, 0])); _q.setFromEuler(_e); _s.set(...(scale || [1, 1, 1])); _p.set(...(pos || [0, 0, 0])).sub(this.cur.at);
    g.applyMatrix4(_m.compose(_p, _q, _s));
    const n = g.attributes.position.count, [hex, r, m, e] = this.pal[slot] || BASE[slot], col = new Float32Array(n * 3), mre = new Float32Array(n * 3);
    _c.setHex(hex);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; mre[i * 3] = r; mre[i * 3 + 1] = m; mre[i * 3 + 2] = e; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('mre', new THREE.BufferAttribute(mre, 3));
    this.cur.list.push(g);
    return this;
  }
  // A side profile ([z, y] points) extruded w wide across x, centred on x0, with a chamfer.
  side(slot, pts, w, x0 = 0, bevel = 0.004, holes = null, rot = null) {
    const s = shapeOf(pts); if (holes) for (const h of holes) s.holes.push(shapeOf(h));
    const b = this.lo ? 0 : Math.min(bevel, w * 0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: w - b * 2, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: this.lo ? 2 : 4 });
    g.translate(0, 0, -(w - b * 2) / 2); g.rotateY(-Math.PI / 2);
    return this.push(g, slot, [x0, 0, 0], rot);
  }
  // A box from its centre and size (a chamfered side profile).
  box(slot, [x, y, z], [w, h, d], bevel = 0.003, rot) {
    if (!rot) return this.side(slot, [[z + d / 2, y - h / 2], [z - d / 2, y - h / 2], [z - d / 2, y + h / 2], [z + d / 2, y + h / 2]], w, x, bevel);
    const g = new THREE.BoxGeometry(w, h, d); return this.push(g, slot, [x, y, z], rot);
  }
  // A turned part along z: front radius r, back radius r2, centred at its middle.
  cyl(slot, pos, r, len, seg = 12, r2 = r, rot) {
    const g = new THREE.CylinderGeometry(r2, r, len, this.lo ? Math.max(5, seg >> 1) : seg, 1); g.rotateX(Math.PI / 2);
    return this.push(g, slot, pos, rot);
  }
  // A ring facing along z (sight hoods, scope bells, aperture sights).
  ring(slot, pos, R, r, depth, seg = 8, rot) {
    const s = new THREE.Shape(); s.absarc(0, 0, R, 0, Math.PI * 2, false);
    const h = new THREE.Path(); h.absarc(0, 0, r, 0, Math.PI * 2, true); s.holes.push(h);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: this.lo ? Math.max(3, seg >> 1) : seg });
    g.translate(0, 0, -depth / 2);
    return this.push(g, slot, pos, rot);
  }
  ball(slot, pos, r, scale = [1, 1, 1], ws = 10, hs = 7) {
    const g = new THREE.SphereGeometry(r, this.lo ? Math.max(5, ws >> 1) : ws, this.lo ? Math.max(4, hs >> 1) : hs);
    return this.push(g, slot, pos, null, scale);
  }
  // The top part of a ball (hats sit on the egg; a whole ball would be hidden half inside it).
  dome(slot, pos, r, scale = [1, 1, 1], ws = 14, hs = 6, cover = Math.PI / 2, rot) {
    const g = new THREE.SphereGeometry(r, this.lo ? Math.max(6, ws >> 1) : ws, this.lo ? Math.max(3, hs >> 1) : hs, 0, Math.PI * 2, 0, cover);
    return this.push(g, slot, pos, rot, scale);
  }
  // An upright turned part (axis y): bottom radius r, top radius r2, base at pos.
  vcyl(slot, pos, r, h, seg = 14, r2 = r, rot, scale) {
    const g = new THREE.CylinderGeometry(r2, r, h, this.lo ? Math.max(5, seg >> 1) : seg, 1); g.translate(0, h / 2, 0);
    return this.push(g, slot, pos, rot, scale);
  }
  // A round tube along a path of [x, y, z] points.
  tube(slot, pts, r, seg = 10, radial = 6) {
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => V(...p))), this.lo ? Math.max(3, seg >> 1) : seg, r, this.lo ? Math.max(3, radial >> 1) : radial);
    return this.push(g, slot);
  }
  // Repeated ribs/slots along z.
  ribs(slot, x, y, z0, z1, n, w, h, d) { for (let i = 0; i < n; i++) this.box(slot, [x, y, z0 + (z1 - z0) * (n > 1 ? i / (n - 1) : 0.5)], [w, h, d], 0.001); return this; }
  // A picatinny-style rail: a strip with cross slots.
  rail(z0, z1, y, w = 0.026, slot = 'dark') {
    this.box(slot, [0, y, (z0 + z1) / 2], [w, 0.01, Math.abs(z1 - z0)], 0.002);
    if (!this.lo) this.ribs(slot, 0, y + 0.007, z0 - 0.006 * Math.sign(z0 - z1), z1 + 0.006 * Math.sign(z0 - z1), Math.max(2, Math.round(Math.abs(z1 - z0) / 0.018)), w, 0.005, 0.008);
    return this;
  }
  // A pistol grip raked back, its top at (z, y).
  pgrip(z, y, len = 0.11, w = 0.034, slot = 'grip', rake = 0.045) {
    return this.side(slot, [[z + 0.018, y], [z - 0.024, y], [z - 0.02 + rake * 0.6, y - len * 0.55], [z - 0.014 + rake, y - len], [z + 0.03 + rake, y - len], [z + 0.03 + rake, y - len * 0.8], [z + 0.026, y - 0.02]], w, 0, 0.006);
  }
  // A trigger guard and trigger, the guard's back at z.
  guard(z, y, len = 0.06, slot = 'dark') {
    this.side(slot, [[z, y], [z, y - 0.045], [z - len, y - 0.045], [z - len - 0.008, y - 0.01], [z - len - 0.008, y]], 0.014, 0, 0.002,
      [[[z - 0.006, y - 0.004], [z - len + 0.002, y - 0.004], [z - len + 0.002, y - 0.039], [z - 0.006, y - 0.039]]]);
    return this.side('metal', [[z - len * 0.45, y], [z - len * 0.6, y], [z - len * 0.55, y - 0.03], [z - len * 0.4, y - 0.032]], 0.006, 0, 0.001);
  }
  // A scope: tube, bells, turrets, lenses that glint.
  scope(z, y, len, r, bell = r * 1.45) {
    this.cyl('dark', [0, y, z], r, len, 14);
    this.cyl('dark', [0, y, z - len / 2 - 0.03], bell, 0.05, 16, r); this.cyl('dark', [0, y, z + len / 2 + 0.025], bell * 0.85, 0.045, 16, bell * 0.9);
    this.ring('accent', [0, y, z - len / 2 - 0.056], bell * 1.02, bell * 0.86, 0.008, 12);
    this.cyl('glass', [0, y, z - len / 2 - 0.052], bell * 0.86, 0.004, 14); this.cyl('glass', [0, y, z + len / 2 + 0.046], bell * 0.72, 0.004, 14);
    this.cyl('dark', [0, y + r + 0.012, z - len * 0.1], 0.013, 0.024, 10, 0.013, [Math.PI / 2, 0, 0]);
    this.cyl('dark', [r + 0.012, y, z - len * 0.1], 0.013, 0.024, 10, 0.013, [0, Math.PI / 2, 0]);
    this.box('dark', [0, y - r - 0.012, z - len * 0.3], [0.022, 0.026, 0.022]); this.box('dark', [0, y - r - 0.012, z + len * 0.3], [0.022, 0.026, 0.022]);
    return this;
  }
  // Everything in one geometry, every part at rest (for models without moving parts: hats).
  geometry() {
    const list = []; for (const p of this.parts.values()) for (const g of p.list) list.push(g.translate(p.at.x, p.at.y, p.at.z));
    const geo = mergeGeometries(list); for (const g of list) g.dispose(); geo.computeBoundingSphere(); return geo;
  }
  build() {
    const g = new THREE.Group(), mat = kitMaterial();
    for (const [name, p] of this.parts) {
      if (!p.list.length) continue;
      const geo = mergeGeometries(p.list); for (const x of p.list) x.dispose();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = name;
      if (name === 'body') g.add(mesh);
      else { const pivot = new THREE.Group(); pivot.name = name; pivot.position.copy(p.at); pivot.add(mesh); g.add(pivot); }
    }
    return g;
  }
}

