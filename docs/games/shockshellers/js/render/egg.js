// The egg: a smooth ovoid shell (cracks grow at 80/60/40/20 HP, GDD §5), two floating cartoon
// gloves holding the gun, an optional hat, a team ring for teammates and a name tag. Third-person
// only; the first-person hands are viewmodel.js.
import * as THREE from '../../vendor/three/three.module.js?v=muvmvc5o';
import { gunModel } from './guns.js?v=muvmvc5o';
import { clone } from './models.js?v=muvmvc5o';

export const SHELL_COLORS = [0xfff6e5, 0xf2d0a4, 0xc98e5a, 0x8a5a3b, 0x5b3a26, 0xe9e1ff, 0xd7f0ff, 0xff9eb5, 0x9ee6a0, 0xffd34e, 0x7fb6ff, 0xb98cff, 0xff7a59, 0x2e2e34];
export const TEAM_COLORS = [0xbbbbbb, 0x2f86e8, 0xe8473c];

// Egg profile: 0.62 tall, 0.56 wide, a touch wider below the middle.
const H = 0.62, W = 0.28;
let eggGeo = null;
export function eggGeometry() {
  if (eggGeo) return eggGeo;
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24 * Math.PI;
    const y = H / 2 * (1 - Math.cos(t));
    const r = W * Math.sin(t) * (1 + 0.1 * Math.cos(t)) * (i === 0 || i === 24 ? 0 : 1);
    pts.push(new THREE.Vector2(Math.max(0.0001, r), y));
  }
  eggGeo = new THREE.LatheGeometry(pts, 28);
  eggGeo.computeVertexNormals();
  return eggGeo;
}

// Shell textures: base colour plus 0–4 crack stages, drawn once per colour/stage.
const shellTex = new Map();
function shellTexture(color, stage) {
  const key = color * 8 + stage;
  if (shellTex.has(key)) return shellTex.get(key);
  const S = 512, c = new OffscreenCanvas(S, S), x = c.getContext('2d');
  const hex = '#' + color.toString(16).padStart(6, '0');
  x.fillStyle = hex; x.fillRect(0, 0, S, S);
  // Subtle speckles.
  let s = 7 + color % 97;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  x.fillStyle = 'rgba(0,0,0,0.04)'; for (let i = 0; i < 120; i++) { x.beginPath(); x.arc(r() * S, r() * S, 2 + r() * 4, 0, 7); x.fill(); }
  // Cracks (GDD §5: they grow at 80/60/40/20 HP). Each is a jagged, branching line from a seed spread
  // evenly around the shell (u wraps, so every side cracks), drawn as a dark groove with a pale lip
  // beside it so it reads at a distance. Later stages add seeds and lengthen the old ones; at the last
  // stage flakes of shell are chipped out. Fixed seeds keep the cracks the same from stage to stage.
  if (stage > 0) {
    const paths = [];
    for (let k = 0; k < 2 + stage * 2; k++) {
      s = 1000 + k * 7919;
      // The shell is ~2.8× wider around than it is tall, so texture-space y steps are stretched to match.
      const Y = 2.8, pts = [[((k * 0.382) % 1) * S, S * (0.25 + ((k * 0.618) % 1) * 0.5)]];
      let a = r() * Math.PI * 2;
      const len = 4 + stage * 3;
      for (let j = 0; j < len; j++) {
        a += (r() - 0.5) * 1.6;
        const [px, py] = pts[pts.length - 1], d = 14 + r() * 16;
        pts.push([px + Math.cos(a) * d * 0.7, py + Math.sin(a) * d * Y * 0.7]);
        if (r() < 0.35) { const b = a + (r() < 0.5 ? 1 : -1) * (0.7 + r() * 0.6), bd = 10 + r() * 18; paths.push([[px, py], [px + Math.cos(b) * bd * 0.7, py + Math.sin(b) * bd * Y * 0.7], [px + Math.cos(b + 0.4) * bd * 1.2, py + Math.sin(b + 0.4) * bd * Y * 1.2]]); }
      }
      paths.unshift(pts);
    }
    const stroke = (style, w, dx, dy) => {
      x.strokeStyle = style; x.lineWidth = w;
      for (const off of [-S, 0, S]) for (const pts of paths) {
        x.beginPath(); x.moveTo(pts[0][0] + off + dx, pts[0][1] + dy);
        for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0] + off + dx, pts[i][1] + dy);
        x.stroke();
      }
    };
    x.lineCap = 'round'; x.lineJoin = 'round';
    stroke('rgba(255,255,255,0.45)', 5, 1.5, 2);   // the lip catching light
    stroke('rgba(45,28,16,0.9)', 4.5, 0, 0);         // the groove
    stroke('rgba(20,12,6,0.95)', 1.6, 0, 0);         // its dark heart
    if (stage >= 4) {
      s = 4242;
      for (let i = 0; i < 6; i++) {
        const cx = r() * S, cy = S * (0.3 + r() * 0.45), n = 6 + Math.floor(r() * 3), R = 8 + r() * 10;
        x.beginPath();
        for (let j = 0; j < n; j++) { const a = j / n * Math.PI * 2, rr = R * (0.6 + r() * 0.6); x.lineTo(cx + Math.cos(a) * rr * 0.6, cy + Math.sin(a) * rr * 1.7); }
        x.closePath(); x.fillStyle = 'rgba(255,214,60,0.95)'; x.fill();
        x.strokeStyle = 'rgba(45,28,16,0.9)'; x.lineWidth = 2.5; x.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  shellTex.set(key, t);
  return t;
}
export function crackStage(hp) { return hp >= 80 ? 0 : hp >= 60 ? 1 : hp >= 40 ? 2 : hp >= 20 ? 3 : 4; }

let gloveGeo = null;
function glove(materialColor = 0xffffff) {
  gloveGeo ??= (() => { const g = new THREE.SphereGeometry(0.06, 12, 10); g.scale(1, 0.85, 1.15); return g; })();
  const m = new THREE.Mesh(gloveGeo, new THREE.MeshStandardMaterial({ color: materialColor, roughness: 0.7 }));
  m.castShadow = true; return m;
}

// Hats (cosmetic). Each returns a group sitting on the egg's top.
export const HATS = {
  none: () => null,
  cap(color = 0xd8452f) {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m); g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16, 1, false, -Math.PI / 2, Math.PI), m); brim.position.set(0, 0.0, -0.08); g.add(brim);
    return g;
  },
  chef() {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 16), m); band.position.y = 0.03; g.add(band);
    for (let i = 0; i < 5; i++) { const puff = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), m); const a = i / 5 * Math.PI * 2; puff.position.set(Math.cos(a) * 0.08, 0.13, Math.sin(a) * 0.08); g.add(puff); }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), m); top.position.y = 0.17; g.add(top);
    return g;
  },
  crown() {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xffc531, roughness: 0.3, metalness: 0.6 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.07, 10, 1, true), m); ring.material.side = THREE.DoubleSide; ring.position.y = 0.035; g.add(ring);
    for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 4), m); const a = i / 5 * Math.PI * 2; sp.position.set(Math.cos(a) * 0.12, 0.1, Math.sin(a) * 0.12); g.add(sp); }
    return g;
  },
  beanie(color = 0x2f86e8) {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m));
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })); pom.position.y = 0.17; g.add(pom);
    return g;
  },
  tophat() {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.6 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.015, 20), m); g.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.115, 0.2, 20), m); crown.position.y = 0.1; g.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.116, 0.118, 0.035, 20), new THREE.MeshStandardMaterial({ color: 0xd8452f })); band.position.y = 0.03; g.add(band);
    return g;
  },
};

// The modelled mitten (scaled for a third-person egg), or a simple ball before models load.
function mitten() {
  const m = clone('glove');
  if (!m) return glove();
  m.scale.setScalar(0.75);
  return m;
}
function nameSprite(text, color) {
  const c = new OffscreenCanvas(256, 64), x = c.getContext('2d');
  x.font = '800 30px n, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,0.7)'; x.strokeText(text, 128, 32);
  x.fillStyle = color; x.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true }));
  s.scale.set(0.9, 0.225, 1); s.position.y = 0.95;
  return s;
}

export class EggAvatar {
  constructor({ name = '', color = 0, hat = 'none', team = 0, weapon = 'yolk47', friendly = false, local = false }) {
    this.group = new THREE.Group();
    this.color = SHELL_COLORS[color] ?? SHELL_COLORS[0];
    this.stage = -1;
    this.shellMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.0 });
    const modelled = clone('egg')?.getObjectByProperty('isMesh', true);
    this.shell = new THREE.Mesh(modelled ? modelled.geometry : eggGeometry(), this.shellMat); this.shell.castShadow = true;
    this.body = new THREE.Group(); this.body.add(this.shell); this.group.add(this.body);
    this.hat = clone('hat_' + hat) || HATS[hat]?.() || null; if (this.hat) { this.hat.position.y = H - 0.04; this.body.add(this.hat); }
    // Hands + gun pivot at chest height, pitched with the view.
    this.arms = new THREE.Group(); this.arms.position.set(0, 0.32, 0); this.body.add(this.arms);
    this.gloveR = mitten(); this.gloveL = mitten(); this.arms.add(this.gloveR, this.gloveL);
    this.setWeapon(weapon);
    this.team = team; this.friendly = friendly;
    if (friendly) {
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.85, depthWrite: false }));
      this.ring.position.y = 0.02; this.group.add(this.ring);
    }
    this.tag = local ? null : nameSprite(name, team ? '#' + TEAM_COLORS[team].toString(16).padStart(6, '0') : '#e8e8e8');
    if (this.tag) this.group.add(this.tag);
    this.setHp(100);
    this.sparkle = 0; this.flash = 0;
  }
  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.gun) this.arms.remove(this.gun);
    this.gun = gunModel(id);
    const scale = id === 'peck9mm' ? 0.75 : 0.55;
    // Gloves and gun float clearly outside the shell, to the egg's right, as the reference style does.
    this.gun.scale.setScalar(scale); this.gun.position.set(0.27, -0.02, -0.2);
    this.arms.add(this.gun);
    const u = this.gun.userData, s2 = scale;
    const g = u.grip ? u.grip.clone().multiplyScalar(s2).add(this.gun.position) : new THREE.Vector3(0.27, -0.07, -0.16);
    const sp = u.support ? u.support.clone().multiplyScalar(s2).add(this.gun.position) : new THREE.Vector3(0.2, -0.03, -0.34);
    this.gloveR.position.copy(g); this.gloveL.position.copy(id === 'peck9mm' ? g.clone().add(new THREE.Vector3(-0.05, 0, 0)) : sp);
  }
  setHp(hp) {
    const st = crackStage(hp);
    if (st === this.stage) return;
    this.stage = st; this.shellMat.map = shellTexture(this.color, st); this.shellMat.needsUpdate = true;
  }
  // Pose for this frame: position (feet), yaw, pitch, scale (Quail Egg), effects.
  pose(x, y, z, yaw, pitch, { scale = 1, shield = false, breaker = false, bob = 0 } = {}) {
    this.group.position.set(x, y, z);
    this.body.rotation.y = yaw;
    this.body.scale.setScalar(scale);
    this.body.position.y = Math.abs(Math.sin(bob)) * 0.02;
    this.arms.rotation.x = pitch * 0.8;
    this.shellMat.emissive.setHex(breaker ? 0x661100 : shield ? 0x113355 : 0x000000);
    if (this.tag) this.tag.position.y = 0.95 * scale;
  }
  dispose() { this.shellMat.dispose(); this.tag?.material.map.dispose(); this.tag?.material.dispose(); }
}
