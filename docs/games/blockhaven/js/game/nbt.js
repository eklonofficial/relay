// Named Binary Tag (Minecraft's save format), big-endian, plus Anvil region files.
//
// Reading gives plain JS values: compounds become objects, lists arrays, numbers numbers, longs
// BigInts, and long arrays Uint32Arrays holding [hi, lo] word pairs (so packed block states can
// be unpacked with 32-bit maths). Writing takes tagged values built with the helpers below, so
// every number is written with the right type.

export const TAG = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };

// ---------------- reading ----------------
export function readNbt(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const dec = new TextDecoder();
  const str = () => { const n = v.getUint16(p); p += 2; const s = dec.decode(bytes.subarray(p, p + n)); p += n; return s; };
  function payload(t) {
    switch (t) {
      case TAG.BYTE: { const x = v.getInt8(p); p += 1; return x; }
      case TAG.SHORT: { const x = v.getInt16(p); p += 2; return x; }
      case TAG.INT: { const x = v.getInt32(p); p += 4; return x; }
      case TAG.LONG: { const x = v.getBigInt64(p); p += 8; return x; }
      case TAG.FLOAT: { const x = v.getFloat32(p); p += 4; return x; }
      case TAG.DOUBLE: { const x = v.getFloat64(p); p += 8; return x; }
      case TAG.BYTE_ARRAY: { const n = v.getInt32(p); p += 4; const x = bytes.slice(p, p + n); p += n; return x; }
      case TAG.STRING: return str();
      case TAG.LIST: {
        const et = v.getUint8(p), n = v.getInt32(p + 1); p += 5;
        const out = new Array(Math.max(0, n));
        for (let i = 0; i < n; i++) out[i] = payload(et);
        return out;
      }
      case TAG.COMPOUND: {
        const o = {};
        for (;;) {
          const ct = v.getUint8(p); p += 1;
          if (ct === TAG.END) return o;
          const name = str();
          o[name] = payload(ct);
        }
      }
      case TAG.INT_ARRAY: { const n = v.getInt32(p); p += 4; const x = new Int32Array(n); for (let i = 0; i < n; i++, p += 4) x[i] = v.getInt32(p); return x; }
      case TAG.LONG_ARRAY: { const n = v.getInt32(p); p += 4; const x = new Uint32Array(n * 2); for (let i = 0; i < n * 2; i++, p += 4) x[i] = v.getUint32(p); return x; }
      default: throw new Error(`Bad NBT tag ${t}`);
    }
  }
  const t = v.getUint8(p); p += 1;
  if (t !== TAG.COMPOUND) throw new Error('NBT root is not a compound');
  str();
  return payload(TAG.COMPOUND);
}

// ---------------- writing ----------------
// Tagged values: { t: TAG.X, v: value }. Compounds hold an object of tagged values; lists hold
// { t: TAG.LIST, et: elementType, v: [raw or tagged values] }.
export const byte = v => ({ t: TAG.BYTE, v }), short = v => ({ t: TAG.SHORT, v }), int = v => ({ t: TAG.INT, v });
export const long = v => ({ t: TAG.LONG, v: BigInt(v) }), float = v => ({ t: TAG.FLOAT, v }), double = v => ({ t: TAG.DOUBLE, v });
export const string = v => ({ t: TAG.STRING, v: String(v) }), compound = v => ({ t: TAG.COMPOUND, v });
export const list = (et, v) => ({ t: TAG.LIST, et, v }), intArray = v => ({ t: TAG.INT_ARRAY, v }), byteArray = v => ({ t: TAG.BYTE_ARRAY, v });
// Long arrays are passed as [hi, lo] word pairs, like the reader returns them.
export const longArray = v => ({ t: TAG.LONG_ARRAY, v });

export function writeNbt(root, name = '') {
  let buf = new Uint8Array(1 << 16), v = new DataView(buf.buffer), p = 0;
  const enc = new TextEncoder();
  const need = n => {
    if (p + n <= buf.length) return;
    let size = buf.length * 2; while (size < p + n) size *= 2;
    const nb = new Uint8Array(size); nb.set(buf); buf = nb; v = new DataView(buf.buffer);
  };
  const str = s => { const b = enc.encode(s); need(2 + b.length); v.setUint16(p, b.length); p += 2; buf.set(b, p); p += b.length; };
  function payload(t, x) {
    switch (t) {
      case TAG.BYTE: need(1); v.setInt8(p, x); p += 1; return;
      case TAG.SHORT: need(2); v.setInt16(p, x); p += 2; return;
      case TAG.INT: need(4); v.setInt32(p, x); p += 4; return;
      case TAG.LONG: need(8); v.setBigInt64(p, BigInt(x)); p += 8; return;
      case TAG.FLOAT: need(4); v.setFloat32(p, x); p += 4; return;
      case TAG.DOUBLE: need(8); v.setFloat64(p, x); p += 8; return;
      case TAG.BYTE_ARRAY: need(4 + x.length); v.setInt32(p, x.length); p += 4; buf.set(x, p); p += x.length; return;
      case TAG.STRING: str(x); return;
      case TAG.LIST: {
        const et = x.et ?? TAG.END, items = x.v;
        need(5); v.setUint8(p, items.length ? et : TAG.END); v.setInt32(p + 1, items.length); p += 5;
        // Elements may be raw payloads or tagged values of the list's type.
        for (const it of items) payload(et, it !== null && typeof it === 'object' && it.t === et && 'v' in it ? (et === TAG.LIST ? it : it.v) : it);
        return;
      }
      case TAG.COMPOUND: {
        for (const [k, tv] of Object.entries(x)) {
          if (tv === undefined || tv === null) continue;
          need(1); v.setUint8(p, tv.t); p += 1; str(k);
          payload(tv.t, tv.t === TAG.LIST ? tv : tv.v);
        }
        need(1); v.setUint8(p, TAG.END); p += 1;
        return;
      }
      case TAG.INT_ARRAY: need(4 + x.length * 4); v.setInt32(p, x.length); p += 4; for (const n of x) { v.setInt32(p, n); p += 4; } return;
      case TAG.LONG_ARRAY: need(4 + x.length * 4); v.setInt32(p, x.length / 2); p += 4; for (let i = 0; i < x.length; i++) { v.setUint32(p, x[i] >>> 0); p += 4; } return;
      default: throw new Error(`Bad NBT tag ${t}`);
    }
  }
  need(1); v.setUint8(p, TAG.COMPOUND); p += 1; str(name);
  payload(TAG.COMPOUND, root.v ?? root);
  return buf.slice(0, p);
}

// ---------------- compression ----------------
async function through(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
export const gunzip = b => through(b, new DecompressionStream('gzip'));
export const gzip = b => through(b, new CompressionStream('gzip'));
export const inflate = b => through(b, new DecompressionStream('deflate'));
export const deflate = b => through(b, new CompressionStream('deflate'));
export async function maybeGunzip(b) { return b[0] === 0x1f && b[1] === 0x8b ? gunzip(b) : b; }

// ---------------- Anvil region files ----------------
// A region holds 32x32 chunks: a 4 KiB table of (sector offset, sector count), a 4 KiB table of
// timestamps, then each chunk as length + compression type + data, padded to 4 KiB sectors.
export async function readRegion(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
  if (bytes.length < 8192) return out;
  for (let i = 0; i < 1024; i++) {
    const loc = v.getUint32(i * 4), off = (loc >>> 8) * 4096;
    if (!loc || off + 5 > bytes.length) continue;
    const len = v.getUint32(off), type = v.getUint8(off + 4);
    if (len < 1 || off + 4 + len > bytes.length) continue;
    const data = bytes.subarray(off + 5, off + 4 + len);
    let raw;
    try {
      if (type === 1) raw = await gunzip(data);
      else if (type === 2) raw = await inflate(data);
      else if (type === 3) raw = data;
      else continue; // LZ4 (24w04a+) and external (.mcc) chunks are not supported
      out.push({ lx: i & 31, lz: i >> 5, nbt: readNbt(raw) });
    } catch (e) { console.warn('skipping unreadable chunk', i, e); }
  }
  return out;
}
// chunks: [{ lx, lz, bytes (uncompressed NBT) }]
export async function writeRegion(chunks) {
  const parts = [];
  let sector = 2;
  const header = new Uint8Array(8192), hv = new DataView(header.buffer);
  const now = Math.floor(Date.now() / 1000);
  for (const c of chunks) {
    const z = await deflate(c.bytes);
    const total = 5 + z.length, sectors = Math.ceil(total / 4096);
    const blob = new Uint8Array(sectors * 4096), bv = new DataView(blob.buffer);
    bv.setUint32(0, z.length + 1); bv.setUint8(4, 2); blob.set(z, 5);
    const i = (c.lx & 31) + (c.lz & 31) * 32;
    hv.setUint32(i * 4, (sector << 8) | Math.min(255, sectors));
    hv.setUint32(4096 + i * 4, now);
    parts.push(blob); sector += sectors;
  }
  const out = new Uint8Array(sector * 4096);
  out.set(header, 0);
  let p = 8192;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}
