import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { load } from './load.mjs';

const { Zip, packTextureName, SOUND_FILES } = await load('render/pack.js');
const zip = await Zip.open(new Blob([await readFile(new URL('../assets/default-pack.zip', import.meta.url))]));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('bundled lava layers are the supplied still and flowing textures', async () => {
  const expected = {
    lava: '9d28ac5d4ac1a9965552e5c8b5e1229a38a5f7216c0250b35d2400dee1f1b8be',
    lava_flow: 'a598f8bf033bc5bb3c7567b6bc790c2c3b6c57504e9d9efd498a1798303d8bfb',
  };
  for (const [name, hash] of Object.entries(expected)) {
    const bytes = await zip.bytes(`assets/minecraft/textures/block/${packTextureName(name)}.png`);
    assert.ok(bytes, `missing ${name}`);
    assert.equal(digest(bytes), hash);
  }
});

test('default splash uses the supplied full-bandwidth water sample in the override slot', async () => {
  const bytes = Buffer.from(await zip.bytes(`assets/minecraft/sounds/${SOUND_FILES.splash}.ogg`));
  assert.equal(digest(bytes), '39304ad19bb456356ed28adc51aa29da8a1d81f6c8cd5a87de153dac612d4d70');
  const header = bytes.indexOf(Buffer.from([1, ...Buffer.from('vorbis')]));
  assert.ok(header >= 0, 'Vorbis identification header');
  assert.equal(bytes.readUInt32LE(header + 12), 44100);
});

test('lava shading samples the selected texture layer, not a procedural replacement', async () => {
  const { TERRAIN_FS } = await load('render/shaders.js');
  const branch = TERRAIN_FS.match(/if \(vFlags == F_LAVA\) \{([^}]+)\}/)?.[1];
  assert.ok(branch);
  assert.match(branch, /texture\(uTex, vUV\)/);
  assert.doesNotMatch(branch, /lava\(vWorld\)/);
});
