import { createGenerator } from './gen/index.js?v=mutbpf5j';
import { meshChunk } from './mesh/mesher.js?v=mutbpf5j';

let generator = null, genKey = '';

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
      // The volume goes back to be filled again for the next job.
      const volume = { ids: m.ids, meta: m.meta, biomes: m.biomes, top: m.top };
      self.postMessage({ type: 'mesh', job: m.job, cx: m.cx, cz: m.cz, dim: m.dim, version: m.version, ...r, volume }, [r.solid, r.cutout, r.trans, r.light, m.ids.buffer, m.meta.buffer, m.biomes.buffer]);
    } else if (m.type === 'locate') {
      const key = `${m.seed}|${m.dim}|${m.worldType}`;
      if (key !== genKey) { generator = createGenerator(m.seed, m.dim, m.worldType); genKey = key; }
      self.postMessage({ type: 'locate', job: m.job, result: generator.locate(m.kind, m.x, m.z) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', job: m.job, cx: m.cx, cz: m.cz, kind: m.type, message: String(err && err.stack || err) });
  }
};
