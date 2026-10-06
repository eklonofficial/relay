// Keyboard, mouse and gamepad into the control bitmask (GDD §18). Mouse look and pointer lock are
// Blockhaven's approach, kept as is: raw (unadjusted) movement where the browser supports it, every
// coalesced sample summed, spikes when the lock engages filtered out.
import { surfaceDocument as document } from '../surface.js?v=muwpta38';
import { movementSamples } from '../util/pointer.js?v=muwpta38';
import { CTRL } from '../sim/tuning.js?v=muwpta38';

// Default bindings: the live Settings defaults (Mouse 2 aims, V is melee). 'M0'/'M1'/'M2' are mouse buttons.
export const DEFAULT_KEYS = {
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space',
  fire: 'M0', scope: 'M2', reload: 'KeyR', swap: 'KeyE', grenade: 'KeyQ', melee: 'KeyV', inspect: 'KeyG',
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
      const mag = Math.abs(dx) + Math.abs(dy), avg = this.mouseAvg;
      if (performance.now() - this.lockedAt < 60 || (mag > 1200 && mag > avg * 12 + 400)) { this.mouseAvg = avg * 0.9; return; }
      this.mouseAvg = avg * 0.8 + mag * 0.2;
      // Mouse speed 1–100 (default 100) → radians per count; aiming scales by the zoom.
      const sens = (this.settings.mouseSpeed / 100) * 0.0028 * (this.zoom || 1) * this.assist;
      this.lookAt = performance.now();
      const inv = this.settings.invertMouse ? -1 : 1;
      this.yaw -= dx * sens; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * sens * inv));
      this.dx += dx; this.dy += dy;
    };
    const samples = e => {
      if (!this.locked || !this.enabled) return false;
      const list = movementSamples(e);
      for (const c of list) take(c.movementX, c.movementY);
      return list.length > 0;
    };
    if ('onpointerrawupdate' in window) document.addEventListener('pointerrawupdate', e => { if (samples(e)) this.lastRaw = performance.now(); });
    if ('onpointermove' in window) document.addEventListener('pointermove', e => { if (performance.now() - (this.lastRaw ?? -Infinity) < 250) return; if (samples(e)) this.lastPointer = performance.now(); });
    document.addEventListener('mousemove', e => { if (performance.now() - Math.max(this.lastRaw ?? -Infinity, this.lastPointer ?? -Infinity) < 250) return; samples(e); });
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
    window.addEventListener('blur', () => { this.keys.clear(); this.taps.clear(); });
  }
  press(code) {
    this.keys.add(code); this.taps.add(code);
    if (code === this.binding('scope') && !this.settings.holdToAim) this.aimToggled = !this.aimToggled;
    if (code === this.binding('inspect')) this.inspectPressed = true;
  }
  release(code) { this.keys.delete(code); }
  binding(a) { return (this.settings.keys || {})[a] || DEFAULT_KEYS[a]; }
  held(a) { const k = this.binding(a); return this.keys.has(k) || this.taps.has(k); }
  // The control bits for this frame (a key pressed and released since the last frame counts once).
  controls() {
    let c = 0;
    for (const a of ['up', 'down', 'left', 'right', 'jump', 'fire', 'reload', 'swap', 'grenade', 'melee']) if (this.held(a)) c |= CTRL[a];
    this.taps.clear();
    if (this.settings.holdToAim ? this.held('scope') : this.aimToggled) c |= CTRL.scope;
    c |= this.pad();
    return c;
  }
  // Gamepad (GDD §18.2): standard mapping.
  pad() {
    const p = navigator.getGamepads?.()[0];
    if (!p || !this.enabled || !this.locked) return 0;
    const b = i => p.buttons[i]?.pressed;
    let c = 0;
    if (b(0)) c |= CTRL.jump; if (b(7)) c |= CTRL.fire; if (b(6)) c |= CTRL.scope; if (b(2)) c |= CTRL.reload;
    if (b(3)) c |= CTRL.swap; if (b(5)) c |= CTRL.grenade; if (b(1)) c |= CTRL.melee;
    const [lx, ly, rx, ry] = p.axes, dz = 0.2;
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
