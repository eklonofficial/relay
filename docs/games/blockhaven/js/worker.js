import { createGenerator } from './worldgen.js';
import { meshChunk } from './mesher.js';

let generator = null, generatorSeed = null;

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'gen') {
    if (generatorSeed !== m.seed) { generator = createGenerator(m.seed); generatorSeed = m.seed; }
    const blocks = generator.generateChunk(m.cx, m.cz);
    self.postMessage({ type: 'gen', job: m.job, cx: m.cx, cz: m.cz, blocks }, [blocks.buffer]);
  } else if (m.type === 'mesh') {
    const r = meshChunk(m.vol);
    self.postMessage({ type: 'mesh', job: m.job, cx: m.cx, cz: m.cz, version: m.version, ...r }, [r.opaque, r.trans]);
  }
};
