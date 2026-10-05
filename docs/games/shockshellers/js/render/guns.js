// The eight weapons and the whisk, modelled in code: each part is a 2D side profile extruded with a
// bevel (crisp low-poly silhouettes with soft edges), plus a few turned parts (barrels, scopes).
// Units: metres-ish, the gun's muzzle points along -z, the grip sits near the origin.
import * as THREE from '../../vendor/three/three.module.js?v=muuo146f';

const M = {};
function mat(key) {
  const defs = {
    dark: [0x2d3138, 0.55, 0.35], metal: [0x5a626d, 0.35, 0.7], black: [0x1b1d21, 0.6, 0.3], wood: [0x9a5b2d, 0.7, 0],
    orange: [0xf39a25, 0.5, 0.1], yolk: [0xffc531, 0.5, 0.05], teal: [0x1f6f7f, 0.5, 0.2], red: [0xd8452f, 0.5, 0.1],
    olive: [0x55603f, 0.7, 0.1], glass: [0x7fd0ff, 0.1, 0.2], white: [0xf4f4f0, 0.6, 0], tan: [0xc8a46a, 0.7, 0.05],
  };
  if (!M[key]) { const [c, r, m] = defs[key]; M[key] = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, flatShading: false }); }
  return M[key];
}
// Extrude a side profile (points in the y/z plane, z forward-negative) to a thickness, centred on x.
function profile(points, width, material, bevel = 0.006) {
  const s = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape x → world z (negative = forward), extrusion → world x
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat(material)); m.castShadow = true;
  return m;
}
function tube(r, len, material, z, y = 0, x = 0, seg = 12, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg); g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat(material)); m.position.set(x, y, z); m.castShadow = true; return m;
}
function block(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(material)); m.position.set(x, y, z); m.castShadow = true; return m;
}

// Each builder returns a Group with userData.muzzle (local position) and userData.grip.
const BUILD = {
  yolk47() {
    const g = new THREE.Group();
    g.add(profile([[0.06, -0.02], [-0.42, -0.02], [-0.42, 0.06], [-0.05, 0.075], [0.06, 0.06]], 0.06, 'dark'));            // receiver + handguard
    g.add(profile([[-0.12, 0.0], [-0.42, 0.0], [-0.42, 0.045], [-0.12, 0.05]], 0.07, 'wood'));                            // wooden handguard
    g.add(profile([[0.06, 0.04], [0.32, -0.02], [0.33, -0.1], [0.27, -0.1], [0.06, -0.01]], 0.05, 'wood'));               // stock
    g.add(profile([[0.0, -0.02], [-0.05, -0.02], [-0.11, -0.2], [-0.07, -0.21], [-0.0, -0.06]], 0.045, 'orange'));         // curved magazine
    g.add(profile([[0.06, -0.02], [0.03, -0.02], [0.06, -0.13], [0.1, -0.13]], 0.045, 'black'));                          // grip
    g.add(tube(0.013, 0.22, 'metal', -0.53, 0.035));
    g.add(block(0.012, 0.035, 0.012, 'black', 0, 0.09, -0.6));                                                           // front sight
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.65);
    return g;
  },
  doubleYolker() {
    const g = new THREE.Group();
    g.add(tube(0.022, 0.62, 'metal', -0.38, 0.03, -0.022)); g.add(tube(0.022, 0.62, 'metal', -0.38, 0.03, 0.022));
    g.add(profile([[0.04, -0.02], [-0.32, -0.02], [-0.32, 0.01], [0.04, 0.015]], 0.085, 'wood'));
    g.add(profile([[0.04, 0.03], [0.34, -0.05], [0.34, -0.13], [0.28, -0.13], [0.04, -0.03]], 0.06, 'wood'));
    g.add(profile([[0.06, 0.05], [-0.08, 0.06], [-0.08, -0.02], [0.06, -0.02]], 0.07, 'dark'));
    g.add(block(0.09, 0.012, 0.03, 'orange', 0, 0.065, -0.05));
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.7);
    return g;
  },
  cageFree() {
    const g = new THREE.Group();
    g.add(profile([[0.08, -0.03], [-0.5, -0.03], [-0.5, 0.04], [0.08, 0.06]], 0.055, 'olive'));
    g.add(profile([[0.08, 0.04], [0.36, 0.0], [0.37, -0.11], [0.3, -0.11], [0.08, -0.03]], 0.05, 'olive'));
    g.add(profile([[-0.02, -0.03], [-0.08, -0.03], [-0.09, -0.15], [-0.03, -0.15]], 0.04, 'black'));
    g.add(profile([[0.07, -0.03], [0.04, -0.03], [0.07, -0.14], [0.11, -0.14]], 0.04, 'black'));
    g.add(tube(0.012, 0.3, 'metal', -0.64, 0.01));
    g.add(tube(0.024, 0.26, 'black', -0.12, 0.1)); g.add(tube(0.03, 0.04, 'black', -0.26, 0.1)); g.add(tube(0.028, 0.04, 'black', 0.02, 0.1));
    g.add(block(0.012, 0.05, 0.02, 'black', 0, 0.07, -0.12));
    g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.8);
    return g;
  },
  yolkzooka() {
    const g = new THREE.Group();
    g.add(tube(0.07, 0.85, 'teal', -0.2, 0.06, 0, 14));
    g.add(tube(0.085, 0.12, 'yolk', -0.62, 0.06, 0, 14, 0.075));
    g.add(tube(0.082, 0.1, 'dark', 0.24, 0.06, 0, 14));
    g.add(profile([[0.04, -0.01], [0.0, -0.01], [0.03, -0.14], [0.08, -0.14]], 0.045, 'black'));
    g.add(profile([[-0.24, -0.01], [-0.28, -0.01], [-0.27, -0.12], [-0.22, -0.12]], 0.04, 'black'));
    g.add(tube(0.025, 0.16, 'black', -0.1, 0.16, 0.05));
    g.userData.muzzle = new THREE.Vector3(0, 0.06, -0.7);
    return g;
  },
  beater() {
    const g = new THREE.Group();
    g.add(profile([[0.22, -0.03], [-0.28, -0.03], [-0.3, 0.06], [0.22, 0.07]], 0.065, 'dark'));
    g.add(profile([[0.18, -0.03], [0.1, -0.03], [0.12, -0.2], [0.19, -0.2]], 0.045, 'yolk'));
    g.add(profile([[-0.04, -0.03], [-0.09, -0.03], [-0.08, -0.15], [-0.03, -0.15]], 0.045, 'black'));
    g.add(profile([[0.2, 0.07], [-0.2, 0.07], [-0.22, 0.1], [0.18, 0.1]], 0.03, 'black'));
    g.add(tube(0.013, 0.1, 'metal', -0.34, 0.02));
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.4);
    return g;
  },
  poacher() {
    const g = new THREE.Group();
    g.add(profile([[0.1, -0.02], [-0.32, -0.02], [-0.32, 0.03], [0.1, 0.05]], 0.06, 'tan'));
    g.add(profile([[0.1, 0.04], [0.42, 0.0], [0.43, -0.12], [0.36, -0.12], [0.24, -0.04], [0.1, -0.02]], 0.055, 'tan'));
    g.add(profile([[0.1, -0.02], [0.06, -0.02], [0.1, -0.13], [0.14, -0.13]], 0.045, 'tan'));
    g.add(tube(0.012, 0.6, 'black', -0.6, 0.02));
    g.add(tube(0.028, 0.32, 'black', -0.04, 0.11)); g.add(tube(0.036, 0.05, 'black', -0.22, 0.11)); g.add(tube(0.032, 0.05, 'black', 0.13, 0.11));
    g.add(tube(0.01, 0.07, 'metal', 0.04, 0.06, 0.05)); // bolt handle
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.92);
    return g;
  },
  triBoil() {
    const g = new THREE.Group();
    g.add(profile([[0.1, -0.03], [-0.44, -0.03], [-0.44, 0.04], [-0.05, 0.08], [0.1, 0.07]], 0.06, 'red'));
    g.add(profile([[0.1, 0.05], [0.34, 0.02], [0.35, -0.1], [0.28, -0.1], [0.1, -0.03]], 0.05, 'dark'));
    g.add(profile([[-0.02, -0.03], [-0.08, -0.03], [-0.09, -0.17], [-0.03, -0.17]], 0.045, 'dark'));
    g.add(profile([[0.08, -0.03], [0.05, -0.03], [0.08, -0.14], [0.12, -0.14]], 0.045, 'black'));
    g.add(profile([[0.05, 0.08], [-0.25, 0.08], [-0.25, 0.11], [0.05, 0.11]], 0.035, 'black'));
    g.add(tube(0.014, 0.16, 'metal', -0.52, 0.02));
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.6);
    return g;
  },
  peck9mm() {
    const g = new THREE.Group();
    g.add(profile([[0.06, 0.0], [-0.17, 0.0], [-0.17, 0.05], [0.06, 0.05]], 0.04, 'dark'));
    g.add(profile([[0.05, 0.0], [-0.02, 0.0], [0.02, -0.13], [0.08, -0.13]], 0.042, 'black'));
    g.add(block(0.01, 0.015, 0.01, 'orange', 0, 0.058, -0.15));
    g.userData.muzzle = new THREE.Vector3(0, 0.025, -0.19);
    return g;
  },
  whisk() {
    const g = new THREE.Group();
    g.add(tube(0.016, 0.16, 'red', 0.08, 0));
    const wire = mat('metal');
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI;
      const curve = new THREE.EllipseCurve(0, 0, 0.045, 0.14, 0, Math.PI, false, 0);
      const pts = curve.getPoints(12).map(p => new THREE.Vector3(p.x * Math.cos(a), p.x * Math.sin(a), -p.y - 0.0));
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.004, 4);
      g.add(new THREE.Mesh(geo, wire));
    }
    g.userData.muzzle = new THREE.Vector3(0, 0, -0.14);
    return g;
  },
  grenade() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), mat('olive')); body.scale.set(1, 1.15, 1); g.add(body);
    g.add(block(0.03, 0.04, 0.03, 'metal', 0, 0.09, 0));
    g.add(block(0.012, 0.06, 0.02, 'metal', 0.025, 0.07, 0));
    return g;
  },
};

const cache = new Map();
export function gunModel(id) {
  if (!cache.has(id)) cache.set(id, (BUILD[id] || BUILD.yolk47)());
  const src = cache.get(id), g = src.clone();
  g.userData.muzzle = src.userData.muzzle ? src.userData.muzzle.clone() : new THREE.Vector3();
  return g;
}
export const GUN_IDS = Object.keys(BUILD);
