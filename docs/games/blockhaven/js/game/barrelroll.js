// Elytra flight with free rotation, in the spirit of the "Do a Barrel Roll" mod: while gliding the
// view is a full 3D orientation instead of yaw and pitch, so you can roll, loop and fly upside
// down. Moving the mouse up and down pitches; side to side rolls (or yaws, if you prefer); A and D
// work the rudder. A banked elytra turns towards its lower wing, like a plane. The glide physics
// keep using the direction you're facing; when you land, the camera levels out again.

// 3x3 rotation matrices, row-major; columns are the local right, up and back axes in the world.
const mul = (a, b) => {
  const o = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const rotX = t => { const c = Math.cos(t), s = Math.sin(t); return new Float64Array([1, 0, 0, 0, c, -s, 0, s, c]); };
const rotY = t => { const c = Math.cos(t), s = Math.sin(t); return new Float64Array([c, 0, s, 0, 1, 0, -s, 0, c]); };
const rotZ = t => { const c = Math.cos(t), s = Math.sin(t); return new Float64Array([c, -s, 0, s, c, 0, 0, 0, 1]); };
const col = (R, i) => [R[i], R[3 + i], R[6 + i]];

// Keeps the matrix a clean rotation despite rounding (Gram-Schmidt on the back and up axes).
function orthonormalize(R) {
  let z = col(R, 2), y = col(R, 1);
  const nz = Math.hypot(...z); z = z.map(v => v / nz);
  const d = y[0] * z[0] + y[1] * z[1] + y[2] * z[2];
  y = y.map((v, i) => v - z[i] * d); const ny = Math.hypot(...y); y = y.map(v => v / ny);
  const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  for (let r = 0; r < 3; r++) { R[r * 3] = x[r]; R[r * 3 + 1] = y[r]; R[r * 3 + 2] = z[r]; }
  return R;
}

export class BarrelRoll {
  constructor() { this.R = null; this.roll = 0; this.yaw = 0; this.pitch = 0; this.levelOut = 0; }
  get active() { return !!this.R; }
  start(yaw, pitch) { this.R = mul(rotY(yaw), rotX(pitch)); this.decompose(); }
  // Mouse look while flying: dy pitches; dx rolls (or yaws with mouseYaw).
  look(dx, dy, sens, mouseYaw = false) {
    if (!this.R) return;
    this.R = mul(this.R, rotX(-dy * sens));
    this.R = mul(this.R, mouseYaw ? rotY(-dx * sens) : rotZ(-dx * sens * 1.4));
    orthonormalize(this.R);
    this.decompose();
  }
  // Per frame: rudder keys (or roll keys when the mouse yaws) and banking.
  update(dt, input, mouseYaw = false, speed = 1) {
    if (!this.R) return;
    const k = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    if (k) this.R = mul(this.R, mouseYaw ? rotZ(k * 2.2 * dt) : rotY(k * 1.2 * dt));
    // Banking: the lower wing pulls the nose around about the world's vertical axis.
    const right = col(this.R, 0), up = col(this.R, 1);
    const bank = right[1] * Math.sign(up[1] || 1);
    this.R = mul(rotY(bank * 1.3 * Math.min(1.5, speed) * dt), this.R);
    orthonormalize(this.R);
    this.decompose();
  }
  // Yaw, pitch and roll for the camera (R = Ry(yaw) Rx(pitch) Rz(roll)), and the facing for physics.
  decompose() {
    const R = this.R, f = [-R[2], -R[5], -R[8]], up = col(R, 1);
    if (Math.hypot(f[0], f[2]) > 1e-5) this.yaw = Math.atan2(-f[0], -f[2]);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, f[1])));
    const r0 = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const u0 = [Math.sin(this.yaw) * Math.sin(this.pitch), Math.cos(this.pitch), Math.cos(this.yaw) * Math.sin(this.pitch)];
    this.roll = Math.atan2(-(up[0] * r0[0] + up[1] * r0[1] + up[2] * r0[2]), up[0] * u0[0] + up[1] * u0[1] + up[2] * u0[2]);
  }
  // Leaving flight: keep the heading, and let the camera roll ease back to level.
  stop() {
    if (!this.R) return;
    this.levelOut = this.roll;
    this.R = null;
  }
  cameraRoll(dt) {
    if (this.R) return this.roll;
    if (!this.levelOut) return 0;
    this.levelOut *= Math.exp(-dt * 6);
    if (Math.abs(this.levelOut) < 1e-3) this.levelOut = 0;
    return this.levelOut;
  }
}
