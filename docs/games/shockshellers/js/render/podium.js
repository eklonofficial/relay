// The end-of-round podium: the top three eggs (as they dress, holding their guns) on gold, silver and
// bronze blocks on a round stage under the round's own sky. The camera sweeps in, the eggs drop onto
// their blocks third to first, the winner hops for joy and shows off its gun, and confetti falls.
// Its own little scene, drawn through the same pipeline as the home screen; the names and the
// results table are the HUD's.
import * as THREE from '../../vendor/three/three.module.js?v=muzmf26a';
import { EggAvatar } from './egg.js?v=muzmf26a';

// Places, left to right on screen: second, first, third. [x, block height, colour]
const SPOTS = [[-1.05, 0.42, 0xc9d1d9], [0, 0.66, 0xffc83a], [1.05, 0.28, 0xd08a4e]];
const ORDER = [1, 0, 2]; // which podium place stands on each spot
// When each spot's egg lands (seconds into the podium): third, then second, then the winner.
const LAND = [0.95, 1.45, 0.55];
const DROP = 1.6, FALL = 0.42;          // drop height and fall time
const SWEEP = 1.8;                      // the camera's sweep in
const TURN = 0.45;                      // three-quarters on, so each gun shows
const INSPECT_EVERY = 4.5;              // the winner shows off its gun this often

function numberTexture(n, color) {
  const S = 256, c = new OffscreenCanvas(S, S), x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, S, S);
  // A lighter band at the top edge and a darker one at the foot, like a bevel catching the light.
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.08, 'rgba(255,255,255,0)'); g.addColorStop(0.9, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.25)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  x.font = '400 168px s, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round'; x.lineWidth = 18; x.strokeStyle = 'rgba(0,0,0,.28)'; x.strokeText(String(n), S / 2 + 4, S / 2 + 14);
  x.fillStyle = '#fff'; x.fillText(String(n), S / 2, S / 2 + 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const ease = f => 1 - Math.pow(1 - Math.min(1, Math.max(0, f)), 3);

export class Podium {
  constructor(renderer) {
    const s = this.scene = new THREE.Scene();
    const bg = new OffscreenCanvas(4, 256), bx = bg.getContext('2d'), g = bx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#16345e'); g.addColorStop(0.6, '#2c6aa8'); g.addColorStop(1, '#79b8e0'); bx.fillStyle = g; bx.fillRect(0, 0, 4, 256);
    this.gradient = new THREE.CanvasTexture(bg); this.gradient.colorSpace = THREE.SRGBColorSpace;
    s.environment = renderer.skyEnvironment('day');
    s.add(new THREE.HemisphereLight(0xeaf6ff, 0x4a6a80, 1.1));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4); key.position.set(-2, 5, 4); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5 }); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.01;
    s.add(key);
    const rim = new THREE.DirectionalLight(0xffe2b8, 1.8); rim.position.set(2.5, 2.5, -3); s.add(rim);
    // A spotlight on the winner's block.
    const spot = new THREE.SpotLight(0xfff4d6, 18, 9, 0.32, 0.6, 1.4); spot.position.set(0, 5.5, 2.2); spot.target.position.set(0, 0.66, 0);
    s.add(spot, spot.target);
    // The stage: a low round plinth with a lit rim, under the blocks.
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.05, 0.16, 72), new THREE.MeshStandardMaterial({ color: 0x24507e, roughness: 0.45, metalness: 0.2 }));
    stage.position.y = -0.08; stage.receiveShadow = true; s.add(stage);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.025, 8, 96).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb020, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6 }));
    trim.position.y = 0.0; s.add(trim);
    // The three blocks, each with its place number on the front and a gold, silver or bronze cap.
    this.blocks = SPOTS.map(([x, h, color], i) => {
      const place = ORDER[i] + 1;
      const side = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.35, envMapIntensity: 1 });
      const front = new THREE.MeshStandardMaterial({ map: numberTexture(place, '#' + new THREE.Color(color).getHexString()), roughness: 0.4, metalness: 0.25 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.95, h, 0.95), [side, side, side, side, front, side]);
      m.position.set(x, h / 2, 0); m.castShadow = m.receiveShadow = true; s.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.99, 0.04, 0.99), new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(1.12), roughness: 0.25, metalness: 0.55 }));
      cap.position.y = h / 2 - 0.02; cap.receiveShadow = true; m.add(cap);
      return m;
    });
    // Confetti: small coloured quads tumbling down through the light (a burst as the winner lands).
    const N = 220, cg = new THREE.PlaneGeometry(0.05, 0.03);
    this.confetti = new THREE.InstancedMesh(cg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N);
    this.bits = Array.from({ length: N }, () => ({ x: 0, y: -1, z: 0, r: 0, w: 0, v: 0 }));
    const cols = [0xffd23f, 0xff6a5c, 0x4aa3ff, 0x5cff7a, 0xffffff, 0xff9ad5];
    for (let i = 0; i < N; i++) this.confetti.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    this.confetti.frustumCulled = false; s.add(this.confetti);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 500);
    this.eggs = []; this.t = 0;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1);
  }
  // entries: up to three { look, primary, team } in podium order (first, second, third). sky: the
  // round's skybox (a cube texture) to stand under, if it has one.
  set(entries, sky = null) {
    for (const e of this.eggs) if (e) { this.scene.remove(e.group); e.dispose(); }
    this.eggs = SPOTS.map((spot, i) => {
      const who = entries[ORDER[i]]; if (!who) return null;
      const egg = new EggAvatar({ name: '', look: who.look, team: who.team, weapon: who.primary || 'yolk47', local: true });
      egg.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
      egg.group.visible = false;
      this.scene.add(egg.group); return egg;
    });
    this.blocks.forEach((b, i) => { b.visible = !!this.eggs[i] || ORDER[i] === 0; });
    this.scene.background = sky || this.gradient;
    this.scene.backgroundBlurriness = sky ? 0.06 : 0;
    this.scene.backgroundIntensity = sky ? 0.8 : 1;
    for (const b of this.bits) b.y = -1;   // (the confetti waits for the winner)
    this.burst = false; this.t = 0;
  }
  update(dt, aspect) {
    this.t += dt; const t = this.t;
    this.eggs.forEach((egg, i) => {
      if (!egg) return;
      const [x, h] = SPOTS[i], first = ORDER[i] === 0, since = t - LAND[ORDER[i]];
      // Dropping in: falls onto its block, squashes as it lands.
      let y = h, vy = 0;
      if (since < 0) {
        const f = Math.max(0, 1 + since / FALL);
        egg.group.visible = f > 0;
        y = h + DROP * (1 - f * f); vy = -DROP * 2 * f / FALL;
      } else if (first) {
        egg.group.visible = true;
        // The winner hops for joy (it lands each time on its block).
        const hop = Math.max(0, Math.sin(since * 3.2 - 0.6));
        y = h + hop * 0.2; vy = Math.cos(since * 3.2 - 0.6) * 3 * (hop > 0 ? 1 : 0);
      } else {
        egg.group.visible = true;
        y = h + Math.abs(Math.sin(since * 2.4 + i)) * 0.03;
      }
      const yaw = Math.PI + TURN + Math.sin(t * 0.8 + i) * 0.18;
      egg.pose(x, y, 0, yaw, 0.05 + Math.sin(t * 0.9 + i) * 0.04, { bob: t * 2, vy });
      // The gun idles in the mittens; the winner turns it over to admire it now and then.
      const show = first && since > 0.5 ? ((since - 0.5) % INSPECT_EVERY) / 1.6 : 0;
      egg.animate({ dt, reload: null, inspect: show > 0 && show < 1 ? show : 0 });
    });
    // Confetti: a burst over the winner as they land, then a steady fall.
    if (!this.burst && t >= LAND[0]) {
      this.burst = true;
      for (const b of this.bits) Object.assign(b, { x: (Math.random() - 0.5) * 5, y: 1.4 + Math.random() * 3, z: (Math.random() - 0.5) * 2.5 - 0.3, r: Math.random() * 6, w: 2 + Math.random() * 6, v: 0.4 + Math.random() * 0.5 });
    }
    for (let i = 0; i < this.bits.length; i++) {
      const b = this.bits[i];
      if (this.burst) {
        b.y -= b.v * dt; b.x += Math.sin(t * 1.5 + i) * dt * 0.15; b.r += b.w * dt;
        if (b.y < 0) { b.y = 3.8 + Math.random() * 0.5; b.x = (Math.random() - 0.5) * 5; }
      }
      this.q.setFromEuler(this.e.set(b.r, b.r * 0.7, b.r * 0.3));
      this.confetti.setMatrixAt(i, this.m4.compose(this.v.set(b.x, b.y, b.z), this.q, this.one));
    }
    this.confetti.instanceMatrix.needsUpdate = true;
    // The camera sweeps in from high and wide, then drifts slowly across. Narrow screens stand
    // further back so all three blocks fit. The podium sits in the upper part of the screen, above
    // the results table.
    const cam = this.camera, k = ease(t / SWEEP), back = Math.max(1, 1.5 / aspect + 0.4);
    const dist = (5.5 + (1 - k) * 3) * back, height = 1.05 + (1 - k) * 1.6, swing = (1 - k) * -0.7 + Math.sin(t * 0.25) * 0.08;
    cam.aspect = aspect; cam.fov = 34;
    cam.position.set(Math.sin(swing) * dist, height, Math.cos(swing) * dist); cam.lookAt(0, 0.7, 0);
    // (Shifted so the podium sits in the upper part of the screen, above the results table.)
    cam.setViewOffset(1000 * aspect, 1000, 0, 125, 1000 * aspect, 1000);
  }
  // Where each place's name goes on screen (above the egg's head, once it has landed): [{ place, x, y,
  // a (fade in) }] in CSS pixels.
  labels(w, h) {
    const out = [];
    this.eggs.forEach((egg, i) => {
      if (!egg) return;
      const [x, hgt] = SPOTS[i], a = Math.min(1, Math.max(0, (this.t - LAND[ORDER[i]]) / 0.3));
      if (a <= 0) return;
      this.v.set(x, hgt + 0.85, 0).project(this.camera);
      out.push({ place: ORDER[i], x: (this.v.x + 1) / 2 * w, y: (1 - this.v.y) / 2 * h, a });
    });
    return out;
  }
}
