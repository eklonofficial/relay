// The egg: a smooth ovoid shell (painted with its colour, pattern and stamp; cracks grow at
// 80/60/40/20 HP, GDD §5), two floating cartoon mittens holding the gun, an optional hat, a team
// ring for teammates and a name tag. Third-person only; the first-person hands are viewmodel.js.
//
// Other eggs are drawn cheaply, since a full lobby puts eighteen of them on screen: the gun and both
// mittens are one mesh, the hat is one mesh, and the shell has three levels of detail picked by
// distance (lod()); far away, the gun and mittens are too small to see and aren't drawn at all.
import * as THREE from '../../vendor/three/three.module.js?v=muwzay2r';
import { gunModel, heldGeometry, gunAnchors } from './guns.js?v=muwzay2r';
import { kitMaterial } from './kit.js?v=muwzay2r';
import { hatMesh } from './hats.js?v=muwzay2r';
import { merged } from './models.js?v=muwzay2r';
import { paintShell, paintCracks } from './shellart.js?v=muwzay2r';
import { COLORS, sanitizeCosmetics } from '../game/cosmetics.js?v=muwzay2r';

export const SHELL_COLORS = COLORS;
export const TEAM_COLORS = [0xbbbbbb, 0x2f86e8, 0xe8473c];

// Egg profile: 0.62 tall, 0.56 wide, a touch wider below the middle. u runs once around (the front,
// -z, is u = 0.5), v is height over the egg's height (as the texture is painted).
const H = 0.62, W = 0.28;
const LODS = [[32, 22], [18, 12], [11, 8]], LOD_FAR = [9, 24], HELD_FAR = 30, TAG_FAR = 34;
const shellGeos = [];
export function shellGeometry(level = 0) {
  if (shellGeos[level]) return shellGeos[level];
  const [seg, rings] = LODS[level], pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings * Math.PI, y = H / 2 * (1 - Math.cos(t)), r = W * Math.sin(t) * (1 + 0.1 * Math.cos(t));
    // The outward normal: perpendicular to the profile's tangent (dr, dy).
    const dy = H / 2 * Math.sin(t), dr = W * (Math.cos(t) * (1 + 0.1 * Math.cos(t)) - 0.1 * Math.sin(t) ** 2);
    let nr = dy, ny = -dr; const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
    if (i === 0) { nr = 0; ny = -1; } else if (i === rings) { nr = 0; ny = 1; }
    for (let j = 0; j <= seg; j++) {
      const a = j / seg * Math.PI * 2, sa = Math.sin(a), ca = Math.cos(a);
      pos.push(r * sa, y, r * ca); nor.push(nr * sa, ny, nr * ca); uv.push(j / seg, y / H);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1, c = b + 1, d = a + 1;
    idx.push(a, d, b, d, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere();
  return (shellGeos[level] = g);
}
export const eggGeometry = () => shellGeometry(0);

// Shell textures: the painted shell (cached per look and size), then a copy per crack stage.
const painted = new Map(), shellTex = new Map();
function lookKey(look) { return `${look.color}|${look.pattern}|${look.pcolor}|${look.stamp}`; }
function shellTexture(look, stage, S) {
  const key = lookKey(look) + '|' + stage + '|' + S;
  if (shellTex.has(key)) return shellTex.get(key);
  const pk = lookKey(look) + '|' + S;
  if (!painted.has(pk)) { const b = new OffscreenCanvas(S, S); paintShell(b.getContext('2d'), S, look); painted.set(pk, b); }
  const c = new OffscreenCanvas(S, S), x = c.getContext('2d');
  x.drawImage(painted.get(pk), 0, 0); paintCracks(x, S, stage);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  shellTex.set(key, t);
  return t;
}
export function crackStage(hp) { return hp >= 80 ? 0 : hp >= 60 ? 1 : hp >= 40 ? 2 : hp >= 20 ? 3 : 4; }

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

// The modelled mitten for the close-up egg (the home screen), or a simple ball before models load.
function bigMitten() {
  const m = merged('glove');
  if (m) { m.scale.setScalar(0.75); return m; }
  const g = new THREE.SphereGeometry(0.06, 12, 10); g.scale(1, 0.85, 1.15);
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }));
}
const GUN_AT = [0.27, -0.02, -0.2];

export class EggAvatar {
  // look: { color, pattern, pcolor, stamp, hat, skin } (cosmetics.js); local: the close-up egg of
  // the home screen or the player's own (full detail, no name tag).
  constructor({ name = '', look = null, color, hat, team = 0, weapon = 'yolk47', friendly = false, local = false }) {
    const c = sanitizeCosmetics(look || { color, hat });
    this.look = { color: COLORS[c.color], pattern: c.pattern, pcolor: COLORS[c.pcolor], stamp: c.stamp };
    this.skin = c.skin; this.local = local; this.texSize = local ? 512 : 256;
    this.group = new THREE.Group();
    this.stage = -1; this.level = -1;
    // A glossy shell: it catches the sky in a soft highlight like a real egg.
    this.shellMat = new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.0, envMapIntensity: 0.85 });
    this.shell = new THREE.Mesh(shellGeometry(0), this.shellMat); this.shell.castShadow = true; this.shell.receiveShadow = true;
    this.body = new THREE.Group(); this.body.add(this.shell); this.group.add(this.body);
    this.hat = hatMesh(c.hat); if (this.hat) { this.hat.position.y = H - 0.04; this.body.add(this.hat); }
    // Hands + gun pivot at chest height, pitched with the view.
    this.arms = new THREE.Group(); this.arms.position.set(0, 0.32, 0); this.body.add(this.arms);
    this.setWeapon(weapon);
    this.team = team; this.friendly = friendly;
    if (friendly) {
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.85, depthWrite: false }));
      this.ring.position.y = 0.02; this.group.add(this.ring);
    }
    // Only the shell casts a shadow (where shadows are drawn per frame at all): hats, mittens and the
    // gun add little to its shape and would double every egg's cost in the shadow pass.
    if (!local) this.body.traverse(o => { if (o.isMesh && o !== this.shell) o.castShadow = false; });
    this.tag = local ? null : nameSprite(name, team ? '#' + TEAM_COLORS[team].toString(16).padStart(6, '0') : '#e8e8e8');
    if (this.tag) this.group.add(this.tag);
    this.setHp(100);
    this.lod(0);
    this.sparkle = 0; this.flash = 0; this.squash = 0; this.lean = 0; this.side = 0; this.last = performance.now();
  }
  // Struck: the shell flashes white for a moment.
  hit(kill) { this.flash = kill ? 1.4 : 1; }
  get color() { return this.look.color; }
  // Where the muzzle is in the world (for the muzzle flash others see).
  muzzleWorld(out) {
    if (this.gun) return this.gun.localToWorld(out.copy(this.gun.userData.muzzle));
    const s = this.weaponId === 'peck9mm' ? 0.75 : 0.55;
    out.copy(gunAnchors(this.weaponId).muzzle).multiplyScalar(s); out.x += GUN_AT[0]; out.y += GUN_AT[1]; out.z += GUN_AT[2];
    return this.arms.localToWorld(out);
  }
  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (!this.local) {
      // Gun and mittens in one mesh, in the arms' space.
      if (!this.held) { this.held = new THREE.Mesh(heldGeometry(id, this.skin, GUN_AT), kitMaterial()); this.held.castShadow = false; this.held.receiveShadow = true; this.arms.add(this.held); }
      else this.held.geometry = heldGeometry(id, this.skin, GUN_AT);
      return;
    }
    if (this.gun) this.arms.remove(this.gun);
    this.gloveR ??= bigMitten(); this.gloveL ??= bigMitten(); this.arms.add(this.gloveR, this.gloveL);
    this.gun = gunModel(id, false, this.skin);
    const scale = id === 'peck9mm' ? 0.75 : 0.55;
    // Gloves and gun float clearly outside the shell, to the egg's right, as the reference style does.
    this.gun.scale.setScalar(scale); this.gun.position.set(...GUN_AT);
    this.arms.add(this.gun);
    const u = this.gun.userData, s2 = scale;
    const g = u.grip ? u.grip.clone().multiplyScalar(s2).add(this.gun.position) : new THREE.Vector3(0.27, -0.07, -0.16);
    const sp = u.support ? u.support.clone().multiplyScalar(s2).add(this.gun.position) : new THREE.Vector3(0.2, -0.03, -0.34);
    this.gloveR.position.copy(g); this.gloveL.position.copy(id === 'peck9mm' ? g.clone().add(new THREE.Vector3(-0.05, 0, 0)) : sp);
    if (u.mag && ['doubleYolker', 'poacher', 'yolkzooka'].includes(id)) u.mag.visible = false;
  }
  setHp(hp) {
    const st = crackStage(hp);
    if (st === this.stage) return;
    this.stage = st; this.shellMat.map = shellTexture(this.look, st, this.texSize); this.shellMat.needsUpdate = true;
  }
  // Detail for this distance from the camera: the shell's mesh, and whether the gun and mittens show.
  lod(dist) {
    const level = this.local ? 0 : dist < LOD_FAR[0] ? 0 : dist < LOD_FAR[1] ? 1 : 2;
    if (level !== this.level) { this.level = level; this.shell.geometry = shellGeometry(level); }
    if (this.held) this.held.visible = dist < HELD_FAR;
    if (this.tag) this.tag.visible = dist < TAG_FAR;   // (unreadable further out; one draw call each)
  }
  // Pose for this frame: position (feet), yaw, pitch, scale (Quail Egg), effects. vx/vz/vy (units per
  // second) give the egg some life: it leans into its run, stretches as it jumps and squashes on landing.
  pose(x, y, z, yaw, pitch, { scale = 1, shield = false, breaker = false, bob = 0, vx = 0, vy = 0, vz = 0 } = {}) {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.group.position.set(x, y, z);
    this.body.rotation.order = 'YXZ';
    this.body.rotation.y = yaw;
    // Lean: forward speed tips it forward, sideways speed rolls it.
    const fwd = -(vx * Math.sin(yaw) + vz * Math.cos(yaw)), side = vx * Math.cos(yaw) - vz * Math.sin(yaw);
    this.lean += (Math.max(-0.2, Math.min(0.2, -fwd * 0.045)) - this.lean) * Math.min(1, dt * 10);
    this.side += (Math.max(-0.15, Math.min(0.15, -side * 0.035)) - this.side) * Math.min(1, dt * 10);
    this.body.rotation.x = this.lean; this.body.rotation.z = this.side;
    // Squash and stretch along its height with vertical speed (and a little at landing, via vy jumps).
    const target = Math.max(-0.12, Math.min(0.1, vy * 0.018));
    this.squash += (target - this.squash) * Math.min(1, dt * 14);
    const k = 1 + this.squash;
    this.body.scale.set(scale / Math.sqrt(k), scale * k, scale / Math.sqrt(k));
    this.body.position.y = Math.abs(Math.sin(bob)) * 0.025;
    this.arms.rotation.x = pitch * 0.8;
    this.flash = Math.max(0, this.flash - dt * 6);
    const f = Math.min(1, this.flash);
    if (f > 0) this.shellMat.emissive.setRGB(f * 0.9, f * 0.75, f * 0.6);
    else this.shellMat.emissive.setHex(breaker ? 0x661100 : shield ? 0x113355 : 0x000000);
    if (this.tag) this.tag.position.y = 0.95 * scale;
  }
  dispose() { this.shellMat.dispose(); this.tag?.material.map.dispose(); this.tag?.material.dispose(); }
}
