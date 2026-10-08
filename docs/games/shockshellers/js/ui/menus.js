// Menus and modals (GDD §16–21): home, respawn/pause screen, settings (3 tabs), play with friends,
// custom matches, profile, shop/inventory, how to play, chat. All markup lives in index.html inside
// the compositor; this module wires it up and keeps it current.
import { surfaceDocument as document } from '../surface.js?v=muymyesq';
import * as THREE from '../../vendor/three/three.module.js?v=muymyesq';
import { ask, tell } from '../dialog.js?v=muymyesq';
import { gunModel } from '../render/guns.js?v=muymyesq';
import { EggAvatar } from '../render/egg.js?v=muymyesq';
import { hatMesh } from '../render/hats.js?v=muymyesq';
import { previewShell } from '../render/shellart.js?v=muymyesq';
import { COLORS, PATTERNS, STAMPS, HATS, SKINS, sanitizeCosmetics } from '../game/cosmetics.js?v=muymyesq';
import { WEAPONS, PRIMARIES, MODE_NAMES, MODE_MENU, TICK } from '../sim/tuning.js?v=muymyesq';
import { ACTIONS, ACTION_NAMES, keyLabel, DEFAULT_KEYS } from '../game/input.js?v=muymyesq';
import { DEFAULT_SETTINGS, saveSettings, saveProfile } from '../game/store.js?v=muymyesq';
import { ensureDaily, def as challengeDef, reroll, timeLeft } from '../game/challenges.js?v=muymyesq';
import { MAPS, mapDef } from '../maps/index.js?v=muymyesq';
import { drawHowTo } from './art.js?v=muymyesq';
import { wakeRelays, diagnoseNetwork } from '../net/net.js?v=muymyesq';

const $ = id => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
// Inline SVG icons (the compositor paints inline SVG).
const NS = 'http://www.w3.org/2000/svg';
function svg(inner, box = '0 0 24 24', cls = '') { const t = document.createElement('template'); t.innerHTML = `<svg xmlns="${NS}" viewBox="${box}"${cls ? ` class="${cls}"` : ''}>${inner}</svg>`; return t.content.firstChild; }
const STAR = '<path d="m26 3 6.6 13.4 14.8 2.1-10.7 10.5 2.5 14.7L26 36.8l-13.2 6.9 2.5-14.7L4.6 18.5l14.8-2.1z" fill="#ffd23f" stroke="#0b4560" stroke-width="3" stroke-linejoin="round"/><circle cx="26" cy="25" r="7" fill="none" stroke="#0b4560" stroke-width="3"/><circle cx="26" cy="25" r="2" fill="#0b4560"/>';
const COIN = '<ellipse cx="12" cy="13" rx="9" ry="10" fill="#f2a500"/><ellipse cx="12" cy="12" rx="8" ry="9" fill="#ffd23f"/>';
const REROLL = '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
const CLOCK = '<circle cx="12" cy="12" r="9" fill="none" stroke="#ffd23f" stroke-width="3"/><path d="M12 7v5l3 3" fill="none" stroke="#ffd23f" stroke-width="3" stroke-linecap="round"/>';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// The shop's tabs (cosmetics.js): everything is free but a few hats.
const swatches = () => COLORS.map((c, i) => ({ id: i, name: '', price: 0 }));
export const SHOP = {
  color: swatches(), pattern: PATTERNS.map(x => ({ ...x, price: 0 })), pcolor: swatches(), stamp: STAMPS.map(x => ({ ...x, price: 0 })),
  hat: HATS, skin: SKINS.map(x => ({ ...x, price: 0 })),
};
const SHOP_TABS = [['color', 'Colors'], ['pattern', 'Patterns'], ['pcolor', 'Pattern Color'], ['stamp', 'Stamps'], ['hat', 'Hats'], ['skin', 'Gun Skins']];
const hex = c => '#' + c.toString(16).padStart(6, '0');
// An image (2D canvas) as a data: URL (img-src allows data:/blob: only).
const dataUrl = cv => cv.convertToBlob().then(b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); }));

// Little lit 3D portraits for the shop (an egg in a look, an egg in a hat, a gun in a skin), rendered
// once each into a small target and kept as images.
class Portraits {
  constructor(renderer) {
    this.R = renderer; this.size = 160; this.cache = new Map();
    this.rt = new THREE.WebGLRenderTarget(this.size, this.size, { samples: 4 }); this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.scene.environment = renderer.skyEnvironment('day');
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x5a8aa0, 1.6));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.2); key.position.set(-2, 3, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe2b8, 1.4); rim.position.set(2.5, 2, -3); this.scene.add(rim);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    this.pixels = new Uint8Array(this.size * this.size * 4);
  }
  // obj framed by its bounding box, seen from (dir), returned as a data: URL (cached by key).
  shot(key, obj, dir = [0.55, 0.25, -1]) {
    if (this.cache.has(key)) return this.cache.get(key);
    const gl = this.R.gl, S = this.size;
    this.scene.add(obj); obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    const d = new THREE.Vector3(...dir).normalize();
    this.camera.position.copy(c).addScaledVector(d, r / Math.sin(this.camera.fov / 2 * Math.PI / 180) * 0.92); this.camera.lookAt(c);
    const shadows = gl.shadowMap.enabled; gl.shadowMap.enabled = false;
    gl.setRenderTarget(this.rt); gl.setClearColor(0x000000, 0); gl.clear(); gl.render(this.scene, this.camera);
    gl.readRenderTargetPixels(this.rt, 0, 0, S, S, this.pixels);
    gl.setRenderTarget(null); gl.setClearColor(0x000000, 1); gl.shadowMap.enabled = shadows;
    this.scene.remove(obj);
    const cv = new OffscreenCanvas(S, S), x = cv.getContext('2d'), img = x.createImageData(S, S);
    for (let y = 0; y < S; y++) img.data.set(this.pixels.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    x.putImageData(img, 0, 0);
    const p = dataUrl(cv); this.cache.set(key, p); return p;
  }
}

export class Menus {
  constructor(app) { this.app = app; this.icons = {}; this.customCfg = { mode: 'ffa', map: 'omelet', bots: 6, difficulty: 'normal', gravity: 1, damage: 1, regen: 1, disabled: [], locked: false, noTeamChange: false, noTeamShuffle: false, botChat: true }; }

  // White silhouettes of the guns, rendered once from the real models.
  weaponIcons() {
    const gl = this.app.renderer.gl, size = [256, 128];
    const rt = new THREE.WebGLRenderTarget(size[0], size[1], { samples: 4 });
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-0.55, 0.55, 0.275, -0.275, 0.1, 10);
    cam.position.set(3, 0, 0); cam.lookAt(0, 0, 0);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pixels = new Uint8Array(size[0] * size[1] * 4);
    for (const id of [...PRIMARIES, 'peck9mm', 'grenade', 'whisk']) {
      const g = gunModel(id); g.traverse(o => { if (o.isMesh) o.material = white; });
      const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const k = Math.min(1.0 / Math.max(s.z, 0.01), 0.5 / Math.max(s.y, 0.01)) * 0.92;
      g.scale.setScalar(k); g.position.set(-c.x * k, -c.y * k, -c.z * k);
      if (id === 'grenade' || id === 'whisk') g.rotation.z = 0;
      scene.add(g);
      gl.setRenderTarget(rt); gl.setClearColor(0x000000, 0); gl.clear(); gl.render(scene, cam);
      gl.readRenderTargetPixels(rt, 0, 0, size[0], size[1], pixels);
      scene.remove(g);
      const cv = new OffscreenCanvas(size[0], size[1]), x = cv.getContext('2d'), img = x.createImageData(size[0], size[1]);
      for (let y = 0; y < size[1]; y++) img.data.set(pixels.subarray((size[1] - 1 - y) * size[0] * 4, (size[1] - y) * size[0] * 4), y * size[0] * 4);
      x.putImageData(img, 0, 0);
      this.iconFrom(id, cv);
    }
    gl.setRenderTarget(null); gl.setClearColor(0x000000, 1); rt.dispose();
  }
  iconFrom(id, cv) {
    // A data: URL keeps the icon inside the page (img-src allows data:/blob: only).
    cv.convertToBlob().then(b => { const r = new FileReader(); r.onload = () => { this.icons[id] = r.result; this.app.hud.weaponIcons[id] = r.result; this.applyIcons(); }; r.readAsDataURL(b); });
  }
  applyIcons() { for (const img of document.querySelectorAll('img[data-w]')) if (this.icons[img.dataset.w] && img.src !== this.icons[img.dataset.w]) img.src = this.icons[img.dataset.w]; }
  weaponRow(container, onPick, current) {
    container.replaceChildren();
    for (const id of PRIMARIES) {
      const b = el('button', 'wbtn' + (id === current ? ' on' : '')), img = el('img');
      img.dataset.w = id; img.alt = ''; if (this.icons[id]) img.src = this.icons[id];
      b.append(img); b.title = WEAPONS[id].name;
      b.onclick = () => { this.app.sound.play('pop'); onPick(id); };
      container.append(b);
    }
  }

  build() {
    const app = this.app;
    $('name').value = app.profile.name;
    $('name').addEventListener('input', () => { const v = $('name').value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16); if (v !== $('name').value) $('name').value = v; if (v) { app.profile.name = v; saveProfile(app.profile); } });
    $('btn-play').onclick = () => { app.sound.unlock(); app.play(); };
    // The project relay sleeps when idle and takes up to a minute to wake; on school networks it is
    // often the only way through, so it is woken now (PLAY hosts at once) and again on this dialog.
    wakeRelays();
    $('btn-friends').onclick = () => { app.sound.unlock(); wakeRelays(); show('friends'); $('join-status').textContent = ''; $('code-input').focus(); };
    $('btn-net-test').onclick = () => this.testConnection();
    $('fr-close').onclick = () => show('friends', false);
    $('btn-join').onclick = () => this.join();
    $('code-input').addEventListener('keydown', e => { if (e.key === 'Enter') this.join(); });
    $('btn-create').onclick = () => { show('friends', false); this.openCustom(); };
    $('btn-1v1').onclick = () => { show('friends', false); app.startMatch({ map: 'omelet', mode: 'ffa', options: {}, bots: 1, slots: 2, difficulty: 'hard', private: true }); };
    // Game mode dropup (opens upward with a check on the current mode).
    $('mode-btn').onclick = () => { app.sound.play('pop'); $('mode-list-wrap').classList.toggle('hidden'); this.modeList(); };
    $('btn-settings').onclick = $('btn-rs-settings').onclick = () => this.openSettings();
    $('btn-full').onclick = $('btn-rs-full').onclick = () => { const d = globalThis.document; if (d.fullscreenElement) d.exitFullscreen(); else d.documentElement.requestFullscreen?.().catch(() => {}); };
    $('tab-profile').onclick = $('btn-rs-profile').onclick = () => this.openProfile();
    $('tab-shop').onclick = $('btn-rs-shop').onclick = () => this.openShop();
    $('pr-close').onclick = () => show('profile', false);
    $('sh-close').onclick = () => { show('shop', false); app.refreshHomeEgg(); };
    $('btn-help').onclick = () => { drawHowTo($('help-canvas'), app.settings.keys); show('help'); };
    $('help-close').onclick = () => show('help', false);
    $('btn-quit').onclick = async () => { if (await ask('Leave this match?')) app.goHome(); };
    $('btn-invite').onclick = () => this.invite();
    $('btn-team').onclick = () => this.switchTeam();
    $('btn-skip').onclick = () => app.requestSkip();
    $('vote-yes').onclick = () => app.castVote(true); $('vote-no').onclick = () => app.castVote(false);
    $('rs-play').onclick = () => { if (!$('rs-play').disabled) app.spawnMe(); };
    // Pointer lock lost while playing = pause (Esc).
    app.input.onLockChange = locked => { if (!locked && app.state === 'play' && !this.chatOpen) app.pause(); };
    app.input.onKey = e => this.key(e);
    // Esc closes whichever menu screen is open (each also has its X).
    const closers = { help: 'help-close', shop: 'sh-close', profile: 'pr-close', custom: 'cu-close', friends: 'fr-close', settings: 'set-close' };
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const open = Object.keys(closers).find(id => !$(id).classList.contains('hidden'));
      if (open) { e.preventDefault(); $(closers[open]).click(); }
    });
    // So does a click on the dimmed backdrop around it.
    for (const [id, x] of Object.entries(closers)) $(id).addEventListener('click', e => { if (e.target === $(id)) $(x).click(); });
    this.chatBind();
    this.settingsBind();
    this.customBind();
    // Interface sounds: a soft tick on hover, a click on press (the first click also wakes the audio).
    let hovered = null;
    document.addEventListener('mouseover', e => { const b = e.target.closest?.('button'); if (b && b !== hovered && !b.disabled) app.sound.play('uiHover'); hovered = b; });
    document.addEventListener('click', e => { const b = e.target.closest?.('button'); if (!b || b.disabled) return; app.sound.unlock(); app.sound.play('uiClick'); });
  }
  refreshHome() {
    const app = this.app, p = app.profile;
    this.weaponRow($('home-weapons'), id => { p.primary = id; saveProfile(p); this.refreshHome(); }, p.primary);
    $('weapon-name').textContent = WEAPONS[p.primary].name.toUpperCase();
    $('weapon-desc').textContent = WEAPONS[p.primary].desc;
    $('mode-val').textContent = MODE_NAMES[p.mode].toUpperCase();
    $('coins').textContent = p.coins.toLocaleString();
    show('mode-list-wrap', false);
  }
  modeList() {
    const l = $('mode-list'), p = this.app.profile; l.replaceChildren();
    for (const m of MODE_MENU) {
      const b = el('button', m === p.mode ? 'orange' : 'pale', MODE_NAMES[m].toUpperCase());
      if (m === p.mode) b.append(svg('<path d="M3 12l6 6L21 5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'));
      b.onclick = () => { p.mode = m; saveProfile(p); this.refreshHome(); };
      l.append(b);
    }
  }

  // ---------------- respawn / pause ----------------
  refreshRespawn() {
    const app = this.app, s = app.session; if (!s) return;
    const me = s.me;
    this.weaponRow($('rs-weapon-list'), id => { app.profile.primary = id; saveProfile(app.profile); s.setPrimary(id); this.refreshRespawn(); }, me.nextPrimary);
    $('rs-weapon-name').textContent = WEAPONS[me.nextPrimary].name.toUpperCase();
    $('room-code').textContent = s.code || 'OFFLINE';
    $('info-map').textContent = s.map.meta.name; $('info-mode').textContent = MODE_NAMES[s.match.modeId];
    show('btn-team', s.match.mode.teams);
    this.challenges();
    this.tickRespawn(true);
  }
  tickRespawn(force) {
    const app = this.app, s = app.session; if (!s) return;
    const m = s.match, me = s.me;
    const wait = Math.max(me.alive ? 0 : me.respawnAt - m.tick, me.pauseCooldownUntil - m.tick);
    const secs = Math.ceil(wait * TICK);
    const key = secs > 0 ? 'w' + secs : 'go';
    if (!force && this.rsKey === key) return;
    this.rsKey = key;
    const b = $('rs-play');
    if (secs > 0) { b.textContent = `GET READY! ${secs}`; b.className = 'red'; b.disabled = true; }
    else { b.replaceChildren(svg('<path d="M2 2 18 12 2 22z" fill="#fff" stroke="#1b7a2c" stroke-width="2.4" stroke-linejoin="round"/>', '0 0 20 24'), document.createTextNode('PLAY')); b.className = 'green'; b.disabled = false; }
    $('info-fps').textContent = app.fps; $('info-ping').textContent = (s.ping || 0) + 'ms';
    if (this.chalT === undefined || performance.now() - this.chalT > 1000) { this.chalT = performance.now(); $('chal-timer').replaceChildren(svg(CLOCK), document.createTextNode(timeLeft(app.profile))); }
  }
  challenges() {
    const app = this.app, c = ensureDaily(app.profile), list = $('chal-list');
    list.replaceChildren();
    c.slots.forEach((s, i) => {
      const d = challengeDef(s.id); if (!d) return;
      const row = el('div', 'chal' + (s.done ? ' done' : '')), body = el('div'); body.style.flex = '1';
      row.append(svg(STAR, '0 0 52 52', 'badge'));
      body.append(el('div', 't', d.title.toUpperCase()), el('div', 'dsc', d.desc));
      const prog = el('div', 'prog'), track = el('div', 'track'), fill = el('div');
      fill.style.width = Math.round(s.n / d.goal * 100) + '%'; track.append(fill);
      prog.append(track, el('span', '', s.done ? 'DONE!' : `${Math.floor(s.n)}/${d.goal}`)); body.append(prog);
      const meta = el('div', 'meta'), rw = el('div', 'rw');
      rw.append(svg(COIN), el('span', '', d.reward.toLocaleString()));
      const rr = el('button', 'small'); rr.append(svg(REROLL)); rr.title = 'Reroll (once a day)'; rr.disabled = s.rerolled || s.done;
      if (rr.disabled) rr.style.opacity = '0.45';
      rr.onclick = () => { if (reroll(app.profile, i)) { saveProfile(app.profile); this.challenges(); } };
      meta.append(rw, rr); body.append(meta);
      row.append(body); list.append(row);
    });
  }
  invite() {
    const code = this.app.session?.code;
    if (!code) { tell('The room is still opening (or the multiplayer servers could not be reached).'); return; }
    navigator.clipboard?.writeText(code).then(() => this.app.hud.toast(`Room code ${code} copied!`), () => tell(`Room code: ${code}`));
  }
  switchTeam() {
    const s = this.app.session; if (!s) return;
    const err = s.switchTeam();
    if (err) tell(err);
  }

  // ---------------- keys: chat, pause ----------------
  key(e) {
    const app = this.app;
    if (!['play', 'respawn', 'dead'].includes(app.state) || this.modalOpen()) return true;
    if (e.key === 'Enter' && !this.chatOpen && app.settings.chat && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); this.openChat(); return false; }
    if (e.code === 'F3') { e.preventDefault(); app.debug = !app.debug; show('debug', app.debug); return false; }
    // A skip-round vote is up: Y / N.
    if (app.vote && !app.vote.voted && !this.chatOpen && (e.code === 'KeyY' || e.code === 'KeyN')) { app.castVote(e.code === 'KeyY'); return false; }
    return true;
  }
  modalOpen() { return [...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden')); }
  chatBind() {
    const inp = $('chat-input');
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = inp.value.trim(); if (v) this.sendChat(v); this.closeChat(); e.preventDefault(); }
      else if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); this.closeChat(); }
    });
  }
  openChat() { this.chatOpen = true; this.app.hud.chatOpen = true; this.app.input.enabled = false; this.app.keys.clear(); show('chat-input'); show('chat-hint', false); $('chat').classList.add('open'); $('chat-input').value = ''; $('chat-input').focus(); }
  closeChat() { this.chatOpen = false; this.app.hud.chatOpen = false; show('chat-input', false); show('chat-hint'); $('chat').classList.remove('open'); $('chat-input').blur(); if (this.app.state === 'play') { this.app.input.enabled = true; this.app.canvas.focus({ preventScroll: true }); } }
  sendChat(text) {
    const app = this.app, s = app.session; if (!s) return;
    const team = /^\/(t|team)\s+/i.test(text);
    const msg = text.replace(/^\/(t|team)\s+/i, '').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, '').slice(0, 200);
    if (/^\/(kick|p|pin|lock|unlock|botchat)\b/i.test(text)) { this.command(text); return; }
    app.hud.chat(`${s.me.name}: ${msg}`, team ? '#7fd3ff' : '#fff');
    s.sendChat?.(msg, team);
  }
  command(text) {
    const app = this.app, s = app.session, [cmd, ...rest] = text.slice(1).split(/\s+/);
    if (!s?.host) { app.hud.chat('Only the host can do that.', '#ffd23f'); return; }
    switch (cmd.toLowerCase()) {
      case 'lock': s.match.options.locked = true; app.hud.chat('Game locked.', '#ffd23f'); break;
      case 'unlock': s.match.options.locked = false; app.hud.chat('Game unlocked.', '#ffd23f'); break;
      case 'kick': { const name = rest.join(' ').toLowerCase(); const p = [...s.match.players.values()].find(q => q.name.toLowerCase() === name && q.id !== s.myId); if (p) { s.kick?.(p.id); app.hud.chat(`${p.name} was booted.`, '#ffd23f'); } else app.hud.chat('No player with that name.', '#ffd23f'); break; }
      case 'botchat': { const on = !/^off$/i.test(rest[0] || ''); s.match.options.botChat = on; app.hud.chat(`Bot chat ${on ? 'on' : 'off'}.`, '#ffd23f'); break; }
      case 'p': case 'pin': app.hud.toast(rest.join(' '), 8); break;
    }
  }

  // ---------------- settings ----------------
  settingsBind() {
    for (let i = 0; i < 3; i++) $('set-tab-' + i).onclick = () => { for (let k = 0; k < 3; k++) { $('set-tab-' + k).classList.toggle('on', k === i); show('set-page-' + k, k === i); } };
    $('set-close').onclick = $('set-cancel').onclick = () => { Object.assign(this.app.settings, this.before); this.app.settings.keys = { ...this.before.keys }; show('settings', false); };
    $('set-ok').onclick = () => { saveSettings(this.app.settings); this.applySettings(); show('settings', false); };
    $('set-reset').onclick = () => { const seen = this.app.settings.seenHowTo; Object.assign(this.app.settings, structuredClone(DEFAULT_SETTINGS)); this.app.settings.keys = { ...DEFAULT_KEYS }; this.app.settings.seenHowTo = seen; this.fillSettings(); };
  }
  openSettings() { this.before = structuredClone(this.app.settings); this.fillSettings(); show('settings'); this.app.input.exitLock(); }
  applySettings() { const a = this.app; a.sound.setVolume(a.settings.volume); a.renderer.baseFov = a.settings.fov; a.applyQuality(); drawHowTo($('howto-canvas'), a.settings.keys); }
  fillSettings() {
    const s = this.app.settings;
    const kb = $('keybinds'); kb.replaceChildren();
    for (const a of ACTIONS) {
      const row = el('div', 'opt'), btn = el('button', 'key', keyLabel(s.keys[a]));
      btn.onclick = () => this.capture(a, btn);
      row.append(el('span', '', ACTION_NAMES[a]), btn); kb.append(row);
    }
    const mouse = $('set-mouse'); mouse.replaceChildren();
    mouse.append(this.slider('Mouse Speed', 1, 100, 1, () => s.mouseSpeed, v => { s.mouseSpeed = v; }));
    mouse.append(this.check('Invert Mouse', () => s.invertMouse, v => { s.invertMouse = v; }));
    mouse.append(this.check('Fix Mouse Glitch (raw input)', () => s.rawInput, v => { s.rawInput = v; }));
    // Aim assist: Auto turns it on for Chromebook trackpads and gamepads.
    mouse.append(this.chips('Aim Assist', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], () => s.aimAssist || 'auto', v => { s.aimAssist = v; }));
    const pad = $('set-pad'); pad.replaceChildren();
    pad.append(el('div', 'note', 'Standard gamepad: A jump · RT fire · LT aim · X reload · Y swap · RB grenade · B melee · sticks move and look.'));
    pad.append(this.slider('Stick Sensitivity', 1, 100, 1, () => s.padSpeed, v => { s.padSpeed = v; }));
    pad.append(this.check('Invert Stick', () => s.padInvert, v => { s.padInvert = v; }));
    pad.append(this.chips('Aim Assist', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], () => s.aimAssist || 'auto', v => { s.aimAssist = v; }));
    const misc = $('set-misc'); misc.replaceChildren();
    misc.append(this.slider('Sound Effects', 0, 100, 1, () => s.volume, v => { s.volume = v; this.app.sound.setVolume(v); }));
    misc.append(this.slider('Field of View', 60, 100, 1, () => s.fov, v => { s.fov = v; }));
    // Graphics: Auto adapts to the frame rate (the old Auto Detail switch); the others hold one level.
    const gfx = el('div', 'opt'), chips = el('div', 'chips');
    const pick = () => { for (const b of chips.children) b.classList.toggle('on', b.dataset.q === (s.quality || 'auto')); };
    for (const [q, label] of [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
      const b = el('button', '', label); b.dataset.q = q;
      b.onclick = () => { s.quality = q; s.autoDetail = q === 'auto'; pick(); };
      chips.append(b);
    }
    pick(); gfx.append(el('span', '', 'Graphics'), chips); misc.append(gfx);
    for (const [label, k] of [['Hold to Aim', 'holdToAim'], ['Enable Chat', 'chat'], ['Bot chat in games I host', 'botChat'], ['Safe Usernames', 'safeNames'], ['Prevent accidental game close?', 'preventClose'], ['Recoil camera shake', 'shake'], ['Show center dot', 'centerDot'], ['Show hit markers', 'hitMarkers']]) misc.append(this.check(label, () => s[k], v => { s[k] = v; }));
  }
  capture(action, btn) {
    btn.classList.add('wait'); btn.textContent = 'Press a key…';
    const done = code => { btn.classList.remove('wait'); if (code && code !== 'Escape') this.app.settings.keys[action] = code; btn.textContent = keyLabel(this.app.settings.keys[action]); document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onMouse, true); };
    const onKey = e => { e.preventDefault(); e.stopPropagation(); done(e.code); };
    const onMouse = e => { if (e.target === btn && e.button === 0) return; e.preventDefault(); e.stopPropagation(); done('M' + e.button); };
    setTimeout(() => { document.addEventListener('keydown', onKey, true); document.addEventListener('mousedown', onMouse, true); }, 0);
  }
  // A drawn slider (native range inputs are not painted by the compositor).
  slider(label, min, max, step, get, set, fmt = v => String(v)) {
    const row = el('div', 'opt'), sl = el('div', 'slider'), tr = el('div', 'track'), fill = el('div', 'fill'), knob = el('div', 'knob'), val = el('div', 'val');
    sl.append(tr, fill, knob, val); row.append(el('span', '', label), sl);
    const draw = () => { const f = (get() - min) / (max - min); fill.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%'; val.textContent = fmt(get()); };
    const at = e => { const r = sl.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); set(Math.round((min + f * (max - min)) / step) * step); draw(); };
    sl.addEventListener('pointerdown', e => { at(e); const mv = ev => at(ev), up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }; document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); });
    draw(); return row;
  }
  chips(label, options, get, set) {
    const row = el('div', 'opt'), chips = el('div', 'chips');
    const pick = () => { for (const b of chips.children) b.classList.toggle('on', b.dataset.v === get()); };
    for (const [v, text] of options) { const b = el('button', '', text); b.dataset.v = v; b.onclick = () => { set(v); pick(); }; chips.append(b); }
    pick(); row.append(el('span', '', label), chips); return row;
  }
  check(label, get, set) {
    const row = el('label', 'opt'), box = el('input'); box.type = 'checkbox'; box.checked = !!get();
    box.onchange = () => set(box.checked);
    row.append(el('span', '', label), box); return row;
  }

  // ---------------- friends / custom matches ----------------
  // Checks each way of connecting from this network and says whether multiplayer will work (as in
  // Blockhaven's Multiplayer screen).
  async testConnection() {
    const out = $('net-diag'), btn = $('btn-net-test');
    btn.disabled = true; out.className = 'note diag';
    const lines = []; let testing = true;
    const paint = () => { out.textContent = [...lines, ...(testing ? ['', 'Testing… a sleeping relay can take about a minute to wake.'] : [])].join('\n'); };
    paint();
    try {
      const results = await diagnoseNetwork(r => { lines.push(`${r.ok ? 'OK' : 'NO'}  ${r.name}: ${r.detail}`); paint(); });
      const relay = results.some(r => r.ok && /^Relay/.test(r.name)), room = results.some(r => r.ok && /^Room/.test(r.name)), direct = results.some(r => r.ok && /Direct/.test(r.name));
      testing = false;
      lines.push('', relay || room
        ? `Multiplayer will work on this network${direct ? ', with direct connections (fastest)' : ', through a relay server'}.`
        : 'No multiplayer server could be reached. This network may block them, or the relay is still waking: try again in a minute.');
      out.className = `note diag ${relay || room ? 'ok' : 'err'}`;
      paint();
    } catch (e) { out.textContent = `The test failed: ${e.message}`; out.className = 'note diag err'; }
    btn.disabled = false;
  }
  async join() {
    const code = $('code-input').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (code.length !== 5) { $('join-status').textContent = 'Room codes have 5 letters and numbers.'; return; }
        $('join-status').textContent = 'Connecting…';
    try { await this.app.joinRoom(code, t => { $('join-status').textContent = t; }); show('friends', false); }
    catch (e) { $('join-status').textContent = e.message || 'Could not join.'; }
  }
  openCustom() { show('custom'); this.fillCustom(); }
  customBind() {
    $('cu-close').onclick = () => show('custom', false);
    $('cu-search').addEventListener('input', () => this.fillCustom());
    $('cu-start').onclick = () => {
      const c = this.customCfg; show('custom', false);
      this.app.startMatch({ map: c.map, mode: c.mode, options: { gravity: c.gravity, damage: c.damage, regen: c.regen, disabled: c.disabled, locked: c.locked, noTeamChange: c.noTeamChange, noTeamShuffle: c.noTeamShuffle, botChat: c.botChat }, bots: c.bots + 1, difficulty: c.difficulty, private: true, host: true });
    };
  }
  fillCustom() {
    const c = this.customCfg, chips = (id, items, isOn, pick) => { const box = $(id); box.replaceChildren(); for (const [k, label] of items) { const b = el('button', isOn(k) ? 'on' : '', label); b.onclick = () => { pick(k); this.fillCustom(); }; box.append(b); } };
    const map = mapDef(c.map);
    chips('cu-modes', MODE_MENU.map(m => [m, MODE_NAMES[m]]), m => m === c.mode, m => { c.mode = m; if (!mapDef(c.map).modes.includes(m)) c.map = (MAPS.find(x => x.modes.includes(m)) || MAPS[0]).id; });
    const q = $('cu-search').value.toLowerCase();
    chips('cu-maps', MAPS.filter(m => m.name.toLowerCase().includes(q)).map(m => [m.id, `${m.name} (${m.maxPlayers})`]), m => m === c.map, m => { c.map = m; c.bots = Math.min(c.bots, mapDef(m).maxPlayers - 1); if (!mapDef(m).modes.includes(c.mode)) c.mode = mapDef(m).modes[0]; });
    chips('cu-bots', Array.from({ length: map.maxPlayers }, (_, i) => [i, i ? String(i) : 'None']), n => n === c.bots, n => { c.bots = n; });
    chips('cu-skill', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['expert', 'Expert'], ['mixed', 'Mixed']], d => d === c.difficulty, d => { c.difficulty = d; });
    const sl = $('cu-sliders'); sl.replaceChildren();
    sl.append(this.slider('Gravity', 0.25, 1, 0.25, () => c.gravity, v => { c.gravity = v; }, v => v + '×'));
    sl.append(this.slider('Damage', 0, 2, 0.25, () => c.damage, v => { c.damage = v; }, v => v + '×'));
    sl.append(this.slider('Health regen', 0, 4, 0.25, () => c.regen, v => { c.regen = v; }, v => v + '×'));
    chips('cu-weapons', PRIMARIES.map(w => [w, WEAPONS[w].name]), w => !c.disabled.includes(w), w => { c.disabled = c.disabled.includes(w) ? c.disabled.filter(x => x !== w) : [...c.disabled, w]; });
    const fl = $('cu-flags'); fl.replaceChildren();
    for (const [label, k] of [['Bot chat', 'botChat'], ['Locked (no new players)', 'locked'], ['No team change', 'noTeamChange'], ['No team shuffle', 'noTeamShuffle']]) fl.append(this.check(label, () => c[k], v => { c[k] = v; }));
  }

  // ---------------- profile & shop ----------------
  openProfile() {
    const p = this.app.profile, s = p.stats, t = $('stats');
    $('pr-name').textContent = p.name; t.replaceChildren();
    // Two stats to a row, so the whole profile fits without scrolling.
    let r = null;
    const row = (k, v) => { if (!r || r.children.length >= 4) t.append(r = el('tr')); r.append(el('td', 'k', k), el('td', 'v', String(v))); };
    row('Kills', s.kills); row('Deaths', s.deaths); row('K/D', s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills);
    row('Best streak', s.bestStreak); row('Damage dealt', Math.round(s.damage)); row('Matches', s.games);
    row('Public / private kills', `${s.publicKills} / ${s.privateKills}`); row('Roost wins', s.roostWins); row('Challenges completed', s.challenges);
    for (const w of [...PRIMARIES, 'peck9mm', 'grenade', 'melee']) row(`${WEAPONS[w]?.name || (w === 'grenade' ? 'Cluck Bomb' : 'Whisk')} kills`, s.byWeapon[w] || 0);
    for (const m of MODE_MENU) row(`${MODE_NAMES[m]} kills`, s.byMode[m] || 0);
    show('profile'); this.app.input.exitLock();
  }
  // The shop: a portrait of your egg as it looks now, tabs of cosmetics with previews of each.
  openShop(tab = this.shopTab || 'color') {
    this.shopTab = tab;
    const app = this.app, p = app.profile, tabs = $('sh-tabs'); tabs.replaceChildren();
    this.portraits ??= new Portraits(app.renderer);
    for (const [k, label] of SHOP_TABS) { const b = el('button', k === tab ? 'on' : '', label); b.onclick = () => this.openShop(k); tabs.append(b); }
    const look = sanitizeCosmetics(p.equip);
    const grid = $('shop-grid'); grid.replaceChildren(); grid.className = 'tab-' + tab;
    for (const item of SHOP[tab]) {
      const price = item.price || 0, owned = price === 0 || p.owned.includes(tab + ':' + item.id), on = look[tab] === item.id;
      const card = el('button', 'item-card' + (on ? ' on' : ''));
      if (tab === 'color' || tab === 'pcolor') { const sw = el('div', 'sw'); sw.style.background = hex(COLORS[item.id]); card.append(sw); }
      else {
        const img = el('img'); img.alt = ''; card.append(img);
        this.preview(tab, item.id, look).then(src => { if (src) img.src = src; });
      }
      if (item.name) card.append(el('div', 'nm', item.name));
      if (!owned || on) card.append(el('div', 'st', owned ? 'EQUIPPED' : `${price.toLocaleString()} yolks`));
      card.onclick = async () => {
        if (!owned) {
          if (p.coins < price) { tell('Not enough Golden Yolks yet. Kills and challenges earn more.'); return; }
          if (!(await ask(`Buy this for ${price.toLocaleString()} Golden Yolks?`))) return;
          p.coins -= price; p.owned.push(tab + ':' + item.id); app.sound.play('powerup');
        }
        p.equip[tab] = item.id; saveProfile(p); app.sound.play('click'); this.openShop(tab); app.refreshHomeEgg();
      };
      grid.append(card);
    }
    // Your egg as it looks now.
    const egg = new EggAvatar({ look, weapon: p.primary, local: true });
    egg.pose(0, 0, 0, 0.35, 0, {});
    const shell = $('sh-egg');
    this.portraits.shot('egg:' + JSON.stringify(look) + p.primary, egg.group, [0.35, 0.25, -1]).then(src => { shell.src = src; egg.dispose(); });
    $('sh-coins').textContent = p.coins.toLocaleString();
    show('shop'); app.input.exitLock();
  }
  // A card's picture: a flat shell for patterns and stamps, an egg in the hat, the gun in the skin.
  preview(tab, id, look) {
    if (tab === 'pattern' || tab === 'stamp') {
      const l = { color: COLORS[look.color], pcolor: COLORS[look.pcolor], pattern: tab === 'pattern' ? id : look.pattern, stamp: tab === 'stamp' ? id : 'none' };
      const key = JSON.stringify(l); this.flat ??= new Map();
      if (!this.flat.has(key)) { const cv = new OffscreenCanvas(96, 112); previewShell(cv.getContext('2d'), 96, 112, l); this.flat.set(key, dataUrl(cv)); }
      return this.flat.get(key);
    }
    if (tab === 'hat') {
      const g = new THREE.Group(), egg = new EggAvatar({ look: { color: look.color }, weapon: 'peck9mm', local: true });
      egg.arms.visible = false; g.add(egg.group); const h = hatMesh(id); if (h) { h.position.y = 0.58; egg.body.add(h); }
      return this.portraits.shot(`hat:${id}:${look.color}`, g, [0.45, 0.35, -1]).then(src => { egg.dispose(); return src; });
    }
    if (tab === 'skin') return this.portraits.shot(`skin:${id}:${this.app.profile.primary}`, gunModel(this.app.profile.primary, false, id), [1, 0.25, -0.15]);
    return Promise.resolve(null);
  }
}
