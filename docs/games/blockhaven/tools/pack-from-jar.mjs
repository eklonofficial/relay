#!/usr/bin/env node
// Builds a resource pack of the official Minecraft textures from YOUR copy of the game, for loading
// into Blockhaven with Options > Resource Packs... (it stays in your browser). Nothing from Mojang is
// ever committed to this repository or deployed with the site.
//
//   node tools/pack-from-jar.mjs [--jar <client.jar>] [--version 1.20.1] [--out <file.zip>]
//
// Without --jar it uses that version's client jar from the Minecraft launcher, the Modrinth App,
// Prism Launcher or CurseForge if you have it installed, and
// otherwise downloads that client from Mojang's servers (as the launcher does) into a cache folder
// in your home directory. The pack holds assets/minecraft/textures (blocks, items, entities, armor).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { inflateRawSync, deflateRawSync, crc32 } from 'node:zlib';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const version = arg('--version', '1.20.1');
const out = resolve(arg('--out', join(homedir(), 'Downloads', `blockhaven-vanilla-${version}.zip`)));

async function clientJar() {
  const given = arg('--jar');
  if (given) return readFileSync(given);
  const mc = process.platform === 'win32' ? join(process.env.APPDATA || '', '.minecraft') : process.platform === 'darwin' ? join(homedir(), 'Library/Application Support/minecraft') : join(homedir(), '.minecraft');
  // The vanilla launcher, then other launchers that keep the unmodified client jar: the Modrinth App
  // (meta/versions/<version>-<loader>/, one per mod loader), Prism Launcher and CurseForge.
  const data = process.platform === 'win32' ? process.env.APPDATA || '' : process.platform === 'darwin' ? join(homedir(), 'Library/Application Support') : join(homedir(), '.local/share');
  const candidates = [join(mc, 'versions', version, `${version}.jar`)];
  const modrinth = join(data, 'ModrinthApp', 'meta', 'versions');
  if (existsSync(modrinth)) for (const d of readdirSync(modrinth)) if (d === version || d.startsWith(`${version}-`)) candidates.push(join(modrinth, d, `${d}.jar`));
  candidates.push(join(data, 'PrismLauncher', 'libraries', 'com', 'mojang', 'minecraft', version, `minecraft-${version}-client.jar`));
  candidates.push(join(homedir(), 'curseforge', 'minecraft', 'Install', 'versions', version, `${version}.jar`));
  const installed = candidates.find(f => existsSync(f));
  if (installed) { console.log(`using ${installed}`); return readFileSync(installed); }
  const cacheDir = join(homedir(), '.blockhaven-cache'), cached = join(cacheDir, `client-${version}.jar`);
  if (existsSync(cached)) { console.log(`using ${cached}`); return readFileSync(cached); }
  console.log(`Minecraft ${version} is not installed; downloading its client from Mojang...`);
  const manifest = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json();
  const entry = manifest.versions.find(v => v.id === version);
  if (!entry) throw new Error(`no such version: ${version}`);
  const meta = await (await fetch(entry.url)).json();
  const bytes = Buffer.from(await (await fetch(meta.downloads.client.url)).arrayBuffer());
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, bytes);
  return bytes;
}

// Reads a zip's central directory: [{ name, data() }].
function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files.push({ name, data: () => {
      const start = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28), raw = buf.subarray(start, start + csize);
      return method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    } });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

// Writes a deflated zip.
function writeZip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name), comp = deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    parts.push(local, n, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const files = readZip(await clientJar()).filter(f => f.name.startsWith('assets/minecraft/textures/') && !f.name.endsWith('/'));
const mcmeta = JSON.stringify({ pack: { pack_format: 15, description: `Minecraft ${version} textures from your own game (for Blockhaven)` } }, null, 2);
const entries = [['pack.mcmeta', Buffer.from(mcmeta)], ...files.map(f => [f.name, f.data()])];
mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(out, writeZip(entries));
console.log(`wrote ${out} (${files.length} textures). Load it in Blockhaven with Options > Resource Packs...`);
