import { createGenerator } from './gen/index.js?v=muprr3ie';
import { meshChunk } from './mesh/mesher.js?v=muprr3ie';
import { buildLodTile } from './mesh/lod.js?v=muprr3ie';

let generator = null, genKey = '', lodColors = null;

self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'gen') {
      const key = `${m.seed}|${m.dim}|${m.worldType}`;
      if (key !== genKey) { generator = createGenerator(m.seed, m.dim, m.worldType); genKey = key; }
      const w = generator.generateChunk(m.cx, m.cz);
      self.postMessage({
        type: 'gen', job: m.job, cx: m.cx, cz: m.cz, dim: m.dim,
        ids: w.ids, meta: w.meta, biomes: w.biomes, heights: w.heights, entities: w.entities, blockEntities: w.blockEntities,
      }, [w.ids.buffer, w.meta.buffer, w.biomes.buffer, w.heights.buffer]);
    } else if (m.type === 'mesh') {
      const r = meshChunk(m);
      self.postMessage({ type: 'mesh', job: m.job, cx: m.cx, cz: m.cz, dim: m.dim, version: m.version, ...r }, [r.opaque, r.trans, r.light]);
    } else if (m.type === 'lodColors') {
      lodColors = m.colors;
    } else if (m.type === 'lod') {
      // A far-view tile (js/world/farview.js), built from the generator without making its chunks.
      const key = `${m.seed}|${m.dim}|${m.worldType}`;
      if (key !== genKey) { generator = createGenerator(m.seed, m.dim, m.worldType); genKey = key; }
      const r = buildLodTile(generator.terrain, lodColors, m.level, m.tx, m.tz);
      self.postMessage({ type: 'lod', job: m.job, key: m.key, dim: m.dim, ...r }, [r.verts]);
    } else if (m.type === 'locate') {
      const key = `${m.seed}|${m.dim}|${m.worldType}`;
      if (key !== genKey) { generator = createGenerator(m.seed, m.dim, m.worldType); genKey = key; }
      self.postMessage({ type: 'locate', job: m.job, result: generator.locate(m.kind, m.x, m.z) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', job: m.job, cx: m.cx, cz: m.cz, kind: m.type, key: m.key, message: String(err && err.stack || err) });
  }
};
