// Keyboard, mouse and gamepad into the control bitmask (GDD §18). Mouse look: raw (unadjusted)
// movement where the browser supports it, the event stream that loses the least movement, every
// coalesced sample summed, spikes when the lock engages filtered out.
import { surfaceDocument as document } from '../surface.js?v=muylpzs7';
import { CTRL } from '../sim/tuning.js?v=muylpzs7';

// Default bindings: left Shift aims, F is melee. 'M0'/'M1'/'M2' are mouse buttons.
export const DEFAULT_KEYS = {
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space',
  fire: 'M0', scope: 'ShiftLeft', reload: 'KeyR', swap: 'KeyE', grenade: 'KeyQ', melee: 'KeyF', inspect: 'KeyG',
};
export const ACTIONS = ['up', 'down', 'left', 'right', 'jump', 'fire', 'scope', 'reload', 'swap', 'grenade', 'melee', 'inspect'];
export const ACTION_NAMES = { up: 'Forward', down: 'Backward', left: 'Left', right: 'Right', jump: 'Jump', fire: 'Fire', scope: 'Aim', reload: 'Reload', swap: 'Swap Weapon', grenade: 'Grenade', melee: 'Melee', inspect: 'Inspect' };
export function keyLabel(code) {
  if (!code) return '—';
  if (code[0] === 'M' && code.length === 2) return `Mouse ${code[1]}`;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', Tab: 'Tab', CapsLock: 'Caps', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] || code;
}

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas; this.settings = settings;
    this.keys = new Set(); // held codes (also what veil.js clears on quick-hide)
    this.taps = new Set(); // pressed since the last controls() read, so a quick tap is never lost to a slow frame
    this.yaw = 0; this.pitch = 0; this.dx = 0; this.dy = 0;
    this.locked = false; this.enabled = false; this.aimToggled = false;
    this.onLockChange = null; this.onKey = null;
    this.mouseAvg = 0; this.lockedAt = 0;
    // Aim assist's friction (a look-speed multiplier set each frame), when the player last turned, and
    // whether a gamepad is in use.
    this.assist = 1; this.lookAt = -1e9; this.padAt = -1e9;
    const take = (dx, dy) => {
      if (!dx && !dy) return;
      // Drop the bogus jump some browsers report as pointer lock starts, and (without raw input, where
      // Chrome on Windows can report a cursor warp as one huge delta) a lone spike from a near-still
      // mouse. Raw input has no such glitch, and a real fast flick is sustained: every sample, kept
      // or not, raises the running average, so a flick is never eaten.
      const mag = Math.abs(dx) + Math.abs(dy), avg = this.mouseAvg;
      this.mouseAvg = avg * 0.8 + Math.min(mag, 2500) * 0.2;
      if (performance.now() - this.lockedAt < 60 || (this.rawInput !== true && mag > 2500 && mag > avg * 8 + 800)) return;
      // Mouse speed 1–100 (default 100) → radians per count; aiming scales by the zoom.
      const sens = (this.settings.mouseSpeed / 100) * 0.0028 * (this.zoom || 1) * this.assist;
      this.lookAt = this.mouseAt = performance.now();
      const inv = this.settings.invertMouse ? -1 : 1;
      this.yaw -= dx * sens; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * sens * inv));
      this.dx += dx; this.dy += dy;
    };
    // The same motion arrives three ways (raw pointer updates, pointer moves, mouse moves), and a
    // browser can round each event's movement to whole pixels after display scaling: at 125% a slow
    // 1-count step becomes 0.8 px and may become 0, so a stream of small events loses slow movement
    // (the view "sticks" until the hand moves faster). So every stream is measured, and only the one
    // reporting the most movement lately (a fraction of a second) turns the view; the others are the same
    // motion, minus whatever they dropped. Within an event, the finer coalesced samples are used unless
    // they add up to less than the event's own total.
    const stream = { raw: 0, move: 0, mouse: 0 };
    this.src = 'onpointerrawupdate' in window ? 'raw' : 'onpointermove' in window ? 'move' : 'mouse';
    const finite = e => Number.isFinite(e.movementX) && Number.isFinite(e.movementY);
    const samplesOf = e => {
      const whole = finite(e) ? [[e.movementX, e.movementY]] : [];
      const parts = (e.getCoalescedEvents?.() || []).filter(finite).map(c => [c.movementX, c.movementY]);
      const size = l => l.reduce((n, [x, y]) => n + Math.abs(x) + Math.abs(y), 0);
      return parts.length && size(parts) >= size(whole) * 0.95 ? parts : whole;
    };
    let streamAt = performance.now();
    const feed = (kind, e) => {
      if (!this.locked || !this.enabled) return;
      const list = samplesOf(e), now = performance.now(), k = Math.exp(-(now - streamAt) / 400);
      streamAt = now;
      for (const n in stream) stream[n] *= k;
      for (const [x, y] of list) stream[kind] += Math.abs(x) + Math.abs(y);
      if (kind !== this.src && stream[kind] > stream[this.src] * 1.2 + 20) this.src = kind;
      if (kind === this.src) for (const [x, y] of list) take(x, y);
    };
    if ('onpointerrawupdate' in window) document.addEventListener('pointerrawupdate', e => feed('raw', e));
    if ('onpointermove' in window) document.addEventListener('pointermove', e => feed('move', e));
    document.addEventListener('mousemove', e => feed('mouse', e));
    document.addEventListener('pointerlockchange', () => {
      this.locked = globalThis.document.pointerLockElement === canvas;
      if (this.locked) { this.lockedAt = performance.now(); this.mouseAvg = 0; }
      else { this.keys.clear(); this.taps.clear(); }
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousedown', e => { if (this.locked && this.enabled) { this.press('M' + e.button); e.preventDefault(); } });
    document.addEventListener('mouseup', e => this.release('M' + e.button));
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', e => {
      if (this.onKey?.(e) === false) return;
      if (!this.locked || !this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.press(e.code);
    });
    document.addEventListener('keyup', e => this.release(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.taps.clear(); this.sprinting = false; });
  }
  press(code) {
    this.keys.add(code); this.taps.add(code);
    // Double-tap forward to sprint (held until forward is let go).
    if (code === this.binding('up')) { const now = performance.now(); if (now - (this.upTapAt || -1e9) < 320) this.sprinting = true; this.upTapAt = now; }
    if (code === this.binding('scope') && !this.settings.holdToAim) this.aimToggled = !this.aimToggled;
    if (code === this.binding('inspect')) this.inspectPressed = true;
  }
  release(code) { this.keys.delete(code); if (code === this.binding('up')) this.sprinting = false; }
  binding(a) { return (this.settings.keys || {})[a] || DEFAULT_KEYS[a]; }
  held(a) { const k = this.binding(a); return this.keys.has(k) || this.taps.has(k); }
  // The control bits for this frame (a key pressed and released since the last frame counts once).
  controls() {
    let c = 0;
    for (const a of ['up', 'down', 'left', 'right', 'jump', 'fire', 'reload', 'swap', 'grenade', 'melee']) if (this.held(a)) c |= CTRL[a];
    this.taps.clear();
    if (this.settings.holdToAim ? this.held('scope') : this.aimToggled) c |= CTRL.scope;
    c |= this.pad();
    if ((this.sprinting && this.held('up')) || (this.padSprint && (c & CTRL.up))) c |= CTRL.sprint;
    if (!(c & CTRL.up)) this.padSprint = false;
    return c;
  }
  // Gamepad (GDD §18.2): standard mapping.
  // Only a real controller counts: a standard-mapped pad, and only axes that have actually moved off
  // where they sat when first seen (some mice, RGB tools and virtual-controller drivers show up as a
  // "gamepad" with an axis parked away from zero, which would otherwise drift the view and switch on
  // the aim assist meant for controllers). While the mouse is in use, the pad doesn't steer the view.
  pad() {
    const p = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected !== false && g.mapping === 'standard');
    if (!p || !this.enabled || !this.locked) return 0;
    const rest = this.padRest?.id === p.id ? this.padRest : (this.padRest = { id: p.id, base: [...p.axes], live: p.axes.map(() => false), stuck: p.buttons.map(x => !!x?.pressed) });
    const axis = i => { const v = p.axes[i] ?? 0; if (!rest.live[i] && Math.abs(v - (rest.base[i] ?? 0)) > 0.3) rest.live[i] = true; return rest.live[i] ? v : 0; };
    const mouse = performance.now() - (this.mouseAt ?? -1e9) < 500;
    // (A button already down when the pad was first seen counts once it has been let go.)
    const b = i => { const on = !!p.buttons[i]?.pressed; if (!on) rest.stuck[i] = false; return on && !rest.stuck[i]; };
    let c = 0;
    if (b(0)) c |= CTRL.jump; if (b(7)) c |= CTRL.fire; if (b(6)) c |= CTRL.scope; if (b(2)) c |= CTRL.reload;
    if (b(3)) c |= CTRL.swap; if (b(5)) c |= CTRL.grenade; if (b(1)) c |= CTRL.melee;
    if (b(10)) this.padSprint = true;   // left stick click: sprint until you stop pushing forward
    const lx = axis(0), ly = axis(1), rx = mouse ? 0 : axis(2), ry = mouse ? 0 : axis(3), dz = 0.2;
    if (ly < -dz) c |= CTRL.up; if (ly > dz) c |= CTRL.down; if (lx < -dz) c |= CTRL.left; if (lx > dz) c |= CTRL.right;
    const s = (this.settings.padSpeed ?? 50) / 50 * 0.05 * (this.zoom || 1) * this.assist;
    if (Math.abs(rx) > 0.15) this.yaw -= rx * s;
    if (Math.abs(ry) > 0.15) this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - ry * s * (this.settings.padInvert ? -1 : 1)));
    if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) this.lookAt = performance.now();
    if (c || Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15 || Math.abs(lx) > dz || Math.abs(ly) > dz) this.padAt = performance.now();
    return c;
  }
  // Raw input where available (Blockhaven's requestLock).
  requestLock() {
    const c = this.canvas;
    document.activeElement?.blur?.();
    c.focus({ preventScroll: true });
    const plain = () => { this.rawInput = false; try { const r2 = c.requestPointerLock(); if (r2 && r2.catch) r2.catch(() => {}); } catch { /* ignore */ } };
    if (this.settings.rawInput === false) { plain(); return; }
    let r;
    try { r = c.requestPointerLock({ unadjustedMovement: true }); } catch { r = null; }
    if (r && r.then) r.then(() => { this.rawInput = true; }, plain);
    else if (!r && globalThis.document.pointerLockElement !== c) plain();
    else this.rawInput = null;
  }
  exitLock() { if (globalThis.document.pointerLockElement) globalThis.document.exitPointerLock(); }
  takeMouse() { const r = [this.dx, this.dy]; this.dx = 0; this.dy = 0; return r; }
}
