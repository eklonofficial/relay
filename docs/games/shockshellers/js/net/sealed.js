// Application payload protection from passive relay/traffic inspection.
// Ephemeral ECDH + HKDF gives distinct AES-GCM keys for each direction.
// The exchange is NOT authenticated: an active intermediary can replace keys.
// A compromised endpoint can capture plaintext. Never claim otherwise.
const encode = bytes => {
  let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
const decode = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const utf8 = new TextEncoder(), text = new TextDecoder('utf-8', { fatal: true });
const LIMIT = 128 * 1024 * 1024;
export class SealedChannel {
  constructor(conn) {
    this.conn = conn; this.handlers = new Map(); this.open = conn.open; this.closed = false;
    this.tx = Promise.resolve(); this.rx = Promise.resolve(); this.queued = 0; this.incoming = 0; this.seq = 0n; this.next = 1n;
    this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.ready.catch(() => {});
    conn.on('data', s => this.receive(s));
    conn.on('close', () => this.close()); conn.on('error', () => this.fail());
    conn.on('open', () => { if (this.closed) return; this.open = true; this.announce(); this.emit('open'); });
    this.local = this.generate(); this.local.catch(() => this.fail());
    this.timer = setInterval(() => { if (!this.keys) this.announce(); }, 500);
    this.timeout = setTimeout(() => this.fail(), 10000);
  }
  on(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); }
  emit(name, value) { for (const fn of this.handlers.get(name) || []) fn(value); }
  async generate() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    this.public = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    this.hello = '0.' + encode(this.public);
    this.announce();
    return pair;
  }
  announce() { if (!this.closed && this.conn.open && this.hello) { try { this.conn.send(this.hello); } catch { this.fail(); } } }
  async exchange(raw) {
    const pair = await this.local;
    const peer = await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, pair.privateKey, 256);
    const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    let lower = false;
    for (let i = 0; i < raw.length; i++) { if (this.public[i] !== raw[i]) { lower = this.public[i] < raw[i]; break; } }
    if (this.public.every((v, i) => v === raw[i])) throw Error('Reflected exchange');
    const salt = new Uint8Array(130); salt.set(lower ? this.public : raw); salt.set(lower ? raw : this.public, 65);
    const derive = side => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode('v1/' + side) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const [a, b] = await Promise.all([derive(0), derive(1)]);
    if (this.closed) return;
    this.keys = { send: lower ? a : b, recv: lower ? b : a };
    this.announce();
    clearInterval(this.timer); clearTimeout(this.timeout); this.resolve();
  }
  receive(s) {
    if (this.closed || typeof s !== 'string' || s.length > 100000) { this.fail(); return; }
    if (s.startsWith('0.')) {
      if (this.remote === s) return;
      if (this.remote) { this.fail(); return; }
      try {
        const raw = decode(s.slice(2)); if (raw.length !== 65) throw Error();
        this.remote = s; this.exchange(raw).catch(() => this.fail());
      } catch { this.fail(); }
      return;
    }
    if (!s.startsWith('1.') || (this.incoming += s.length) > LIMIT) { this.fail(); return; }
    this.rx = this.rx.then(async () => {
      await this.ready; if (this.closed) return;
      const packet = decode(s.slice(2)); if (packet.length < 24) throw Error();
      const n = new DataView(packet.buffer, packet.byteOffset, 8).getBigUint64(0);
      if (n !== this.next) throw Error('Unexpected sequence');
      const iv = new Uint8Array(12); iv.set(packet.subarray(0, 8), 4);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: packet.subarray(0, 8) }, this.keys.recv, packet.subarray(8));
      this.next++; if (!this.closed) this.emit('data', text.decode(plain));
    }).catch(() => this.fail()).finally(() => { this.incoming -= s.length; });
  }
  send(s) {
    if (this.closed) return;
    const bytes = utf8.encode(s);
    if (bytes.length > 65536 || this.queued + bytes.length > LIMIT) { this.fail(); return; }
    this.queued += bytes.length;
    this.tx = this.tx.then(async () => {
      await this.ready; if (this.closed) return;
      if (++this.seq > 0xffffffffffffffffn) throw Error('Sequence exhausted');
      const header = new Uint8Array(8); new DataView(header.buffer).setBigUint64(0, this.seq);
      const iv = new Uint8Array(12); iv.set(header, 4);
      const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, this.keys.send, bytes));
      const packet = new Uint8Array(8 + cipher.length); packet.set(header); packet.set(cipher, 8);
      if (!this.closed) this.conn.send('1.' + encode(packet));
    }).catch(() => this.fail()).finally(() => { this.queued -= bytes.length; });
  }
  fail() { if (this.closed) return; this.emit('error', new Error('Unable to establish or verify a protected connection. Both browsers need the latest version.')); this.close(); }
  close() {
    if (this.closed) return;
    this.closed = true; this.open = false; clearInterval(this.timer); clearTimeout(this.timeout);
    this.reject(new Error('Closed')); try { this.conn.close(); } catch { /* already closed */ } this.emit('close');
  }
}
