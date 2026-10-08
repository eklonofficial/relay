import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from './load.mjs';
const { loadModels, weaponModel, eggGeometry } = await load('render/models.js');
const { HAT_IDS, hatMesh } = await load('render/hats.js');
const { stillGeometry } = await load('render/guns.js');
const { WeaponRig } = await load('render/weapon-rig.js');
const { WEAPON_ASSETS } = await load('render/asset-catalog.js');
const { WEAPONS } = await load('sim/tuning.js');
const { RELOAD_CUES } = await load('render/reload-cues.js');
before(async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(await readFile(new URL(url)));
  try {
    await loadModels();
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
test('all skins preserve their skeleton and vertex data', () => {
  for (const [id, spec] of Object.entries(WEAPON_ASSETS))
    for (let index = 0; index < spec.skins.length; index++) {
      const model = weaponModel(id, index, true);
      const mesh = model.getObjectByName(spec.skins[index]);
      assert.ok(mesh.isSkinnedMesh);
      assert.ok(mesh.skeleton.bones.every(Boolean));
      assert.equal(mesh.geometry.attributes.position.count, mesh.geometry.attributes.skinWeight.count);
      assert.ok(mesh.geometry.attributes.color.normalized);
    }
  assert.equal(HAT_IDS.length, 631);
  for (const id of HAT_IDS) assert.ok(hatMesh(id)?.isMesh, id);
});
test('reload clocks match verified source timing and every cue fires exactly once', () => {
  const clocks = {
    yolk47: [160, 205],
    doubleYolker: [155, 155],
    cageFree: [165, 225],
    yolkzooka: [170, 170],
    beater: [190, 225],
    poacher: [144, 144],
    triBoil: [160, 205],
    peck9mm: [160, 195]
  };
  for (const [id, timing] of Object.entries(clocks)) {
    assert.deepEqual(WEAPONS[id].reload, timing);
    for (const long of [false, true]) {
      const rig = new WeaponRig(id),
        events = [];
      const duration = timing[long ? 1 : 0] / 60;
      for (let frame = 0; frame <= 240; frame++)
        rig.update({ dt: duration / 240, reload: { f: frame / 240, long }, inspect: 0 }, (e) =>
          events.push(e)
        );
      assert.deepEqual(
        events,
        RELOAD_CUES[id][long ? 1 : 0].map((c) => c[1])
      );
      assert.equal(
        rig.actions[long ? rig.spec.long : rig.spec.short].time,
        rig.clips[long ? rig.spec.long : rig.spec.short].duration
      );
      rig.root.traverse((o) => assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
      rig.dispose();
    }
  }
});
test('instances have independent bones; interrupted reload returns exactly to idle', () => {
  for (const id of Object.keys(WEAPON_ASSETS)) {
    const a = new WeaponRig(id),
      b = new WeaponRig(id);
    const bone = b.root.getObjectByName(b.spec.left),
      rest = bone.matrixWorld.clone();
    a.update({ dt: 0, reload: { f: 0.5, long: true }, inspect: 0 });
    assert.deepEqual(bone.matrixWorld.elements, rest.elements);
    a.update({ dt: 0, reload: null, inspect: 0 });
    assert.deepEqual(a.root.getObjectByName(a.spec.left).matrixWorld.elements, rest.elements);
    a.dispose();
    b.dispose();
  }
});
test('the shell takes the painted texture: u runs once around with no triangle smeared across the seam', () => {
  const g = eggGeometry(), uv = g.attributes.uv, pos = g.attributes.position;
  g.computeBoundingBox();
  assert.ok(Math.abs(g.boundingBox.min.y) < 1e-6, 'its base sits at y = 0');
  for (let i = 0; i < uv.count; i += 3) {
    const us = [uv.getX(i), uv.getX(i + 1), uv.getX(i + 2)];
    assert.ok(Math.max(...us) - Math.min(...us) < 0.5, `triangle ${i / 3} spans ${us}`);
  }
  // The front (-z) is u = 0.5, as shellart.js paints it.
  let front = 0, best = Infinity;
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < best) { best = pos.getZ(i); front = uv.getX(i) % 1; }
  assert.ok(Math.abs(front - 0.5) < 0.08, `front at u ${front}`);
  assert.ok(g.attributes.color, 'its vertex colours carry the crack pattern');
});
test('still guns bake every skin, with and without the mittens, into one coloured mesh', () => {
  for (const [id, spec] of Object.entries(WEAPON_ASSETS)) for (const skin of [0, spec.skins.length - 1]) {
    const bare = stillGeometry(id, skin), held = stillGeometry(id, skin, true);
    assert.ok(bare.attributes.color && bare.attributes.normal && held.attributes.position.count > bare.attributes.position.count, `${id} ${skin}`);
    assert.ok([...bare.attributes.position.array].every(Number.isFinite), `${id} ${skin} finite`);
  }
});
