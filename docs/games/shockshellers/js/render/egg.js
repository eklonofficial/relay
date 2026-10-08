// The egg: the shell (painted with its colour, pattern and stamp; the cracks in its mesh show as it
// loses health, GDD §5), the mittens holding the gun, an optional hat, a team ring for teammates and
// a name tag. Third-person only; the first-person hands are viewmodel.js.
//
// Other eggs are drawn cheaply, since a full lobby puts eighteen of them on screen: the gun and both
// mittens are one still mesh (guns.js), the hat is one mesh, and far away the gun and mittens are too
// small to see and aren't drawn at all. Only an egg close by gets its gun's live rig, so its reloads
// and shots can be seen.
import * as THREE from '../../vendor/three/three.module.js?v=muziihfj';
import { heldGeometry, muzzleOf } from './guns.js?v=muziihfj';
import { WeaponRig } from './weapon-rig.js?v=muziihfj';
import { hatMesh } from './hats.js?v=muziihfj';
import { eggGeometry, importedMaterial } from './models.js?v=muziihfj';
import { paintShell } from './shellart.js?v=muziihfj';
import { stampImage, loadStamp } from './stamps.js?v=muziihfj';
import { COLORS, sanitizeCosmetics, skinOf } from '../game/cosmetics.js?v=muziihfj';

export const SHELL_COLORS = COLORS;
export const TEAM_COLORS = [0xbbbbbb, 0x2f86e8, 0xe8473c];

// Distances (units) inside which an egg's gun is live, drawn at all, and its name tag shown.
const RIG_NEAR = 9, RIG_FAR = 11, HELD_FAR = 30, TAG_FAR = 34;
// Where the gun hangs: the head pivot, turned a little inwards (as the first-person view).
const HEAD_Y = 0.3, HOLD_PITCH = 0.035, HOLD_YAW = 0.14;

// Shell textures, painted once per look and size.
const painted = new Map();
const lookKey = look => `${look.color}|${look.pattern}|${look.pcolor}|${look.stamp}`;
function shellTexture(look, S) {
  const key = lookKey(look) + '|' + S + '|' + (stampImage(look.stamp) ? 1 : 0);
  if (painted.has(key)) return painted.get(key);
  const c = new OffscreenCanvas(S, S);
  paintShell(c.getContext('2d'), S, look, stampImage(look.stamp));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  painted.set(key, t);
  return t;
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

const holder = () => { const g = new THREE.Group(); g.rotation.set(HOLD_PITCH, HOLD_YAW, 0, 'YXZ'); return g; };

export class EggAvatar {
  // look: { color, pattern, pcolor, stamp, hat, skins } (cosmetics.js); local: the close-up egg of
  // the home screen or the player's own (full detail, live gun, no name tag).
  constructor({ name = '', look = null, color, hat, team = 0, weapon = 'yolk47', friendly = false, local = false }) {
    const c = sanitizeCosmetics(look || { color, hat });
    this.look = { color: COLORS[c.color], pattern: c.pattern, pcolor: COLORS[c.pcolor], stamp: c.stamp };
    this.cosmetics = c; this.local = local; this.texSize = local ? 512 : 256;
    this.group = new THREE.Group();
    this.level = -1; this.near = local;
    // A glossy shell: it catches the sky in a soft highlight like a real egg. Its vertex colours hold
    // the crack pattern: health uncovers it (the darker a vertex's mark, the earlier it cracks).
    this.health = { value: 1 };
    this.shellMat = new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.0, envMapIntensity: 0.85, vertexColors: true });
    // ...and a warm rim of light around the silhouette (stylised, like a back light on a character),
    // so an egg always separates from the walls and floor behind it.
    this.shellMat.onBeforeCompile = sh => {
      sh.uniforms.shellHealth = this.health;
      sh.fragmentShader = 'uniform float shellHealth;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#ifdef USE_COLOR
        diffuseColor.rgb *= sqrt(clamp(6.0 * (vColor.rgb + vec3(0.16470588235 * shellHealth)), 0.0, 1.0));
        #endif`)
        .replace('#include <opaque_fragment>', `float rimK = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        outgoingLight += vec3(1.0, 0.93, 0.8) * rimK * 0.32;
        #include <opaque_fragment>`);
    };
    this.shellMat.customProgramCacheKey = () => 'eggShell';
    this.shell = new THREE.Mesh(eggGeometry(), this.shellMat); this.shell.castShadow = true; this.shell.receiveShadow = true;
    this.body = new THREE.Group(); this.body.add(this.shell); this.group.add(this.body);
    this.paint();
    if (c.stamp !== 'none' && !stampImage(c.stamp)) loadStamp(c.stamp).then(() => { if (!this.disposed) this.paint(); });
    this.hat = hatMesh(c.hat); if (this.hat) this.body.add(this.hat);
    // Hands + gun pivot at the head, pitched with the view.
    this.arms = new THREE.Group(); this.arms.position.set(0, HEAD_Y, 0); this.body.add(this.arms);
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
    this.lod(local ? 0 : Infinity);
    this.sparkle = 0; this.flash = 0; this.squash = 0; this.lean = 0; this.side = 0; this.last = performance.now();
  }
  paint() { this.shellMat.map = shellTexture(this.look, this.texSize); this.shellMat.needsUpdate = true; }
  // Struck: the shell flashes white for a moment.
  hit(kill) { this.flash = kill ? 1.4 : 1; }
  get color() { return this.look.color; }
  // Where the muzzle is in the world (for the muzzle flash others see).
  muzzleWorld(out) {
    out.copy(muzzleOf(this.weaponId));
    return (this.rig ? this.rig.root : this.held).localToWorld(out);
  }
  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id; this.skin = skinOf(this.cosmetics, id);
    this.dropRig();
    // The still gun and mittens (one mesh), shown whenever the live rig isn't.
    if (!this.held) { this.held = new THREE.Mesh(heldGeometry(id, this.skin), importedMaterial); this.held.rotation.set(HOLD_PITCH, HOLD_YAW, 0, 'YXZ'); this.held.castShadow = false; this.held.receiveShadow = true; this.arms.add(this.held); }
    else this.held.geometry = heldGeometry(id, this.skin);
    if (this.near) this.makeRig();
  }
  makeRig() {
    if (this.rig) return;
    this.rig = new WeaponRig(this.weaponId, this.skin, true);
    this.rig.root.rotation.set(HOLD_PITCH, HOLD_YAW, 0, 'YXZ');
    if (!this.local) this.rig.root.traverse(o => { if (o.isMesh) o.castShadow = false; });
    this.arms.add(this.rig.root); this.held.visible = false;
  }
  dropRig() { if (!this.rig) return; this.arms.remove(this.rig.root); this.rig.dispose(); this.rig = null; }
  // The live gun's clip this frame: { dt, reload: {f, long}|null }. cue(sample) for its sounds.
  animate(state, cue) { this.rig?.update({ inspect: 0, melee: 0, ...state }, cue); }
  // A shot: the live gun works its action.
  fired() { this.rig?.fire(); }
  setHp(hp) { this.health.value = Math.max(0, Math.min(1, hp / 100)); }
  // Detail for this distance from the camera: whether the gun is live, drawn still, or not at all.
  lod(dist) {
    if (!this.local) {
      const near = this.rig ? dist < RIG_FAR : dist < RIG_NEAR;
      if (near && !this.rig) this.makeRig(); else if (!near && this.rig) { this.dropRig(); this.held.visible = true; }
      this.near = near;
    }
    this.held.visible = !this.rig && dist < HELD_FAR;
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
  dispose() { this.disposed = true; this.dropRig(); this.shellMat.dispose(); this.tag?.material.map.dispose(); this.tag?.material.dispose(); this.ring?.geometry.dispose(); this.ring?.material.dispose(); }
}
