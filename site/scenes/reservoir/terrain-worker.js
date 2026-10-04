import { buildReservoir } from './terrain.js';

self.onmessage = (e) => {
  const r = buildReservoir(e.data.seed, (stage, p) => self.postMessage({ type: 'progress', stage, p }));
  self.postMessage({ type: 'done', data: r }, [r.h.buffer, r.thal.buffer, r.ao.buffer]);
};
