// 在背景執行緒生成 S1 地形，避免主畫面卡住
import { buildS1 } from './terrain.js';

self.onmessage = (e) => {
  const { seed } = e.data;
  const t0 = performance.now();
  const r = buildS1(seed, (stage, p) => self.postMessage({ type: 'progress', stage, p }));
  r.ms = performance.now() - t0;
  const transfer = [r.h.buffer, r.gwt.buffer, r.soil.buffer, r.mount.buffer, r.acc.buffer, r.dir.buffer, r.waterLevel.buffer, r.channelMask.buffer, r.rdist.buffer, r.cdist.buffer, r.ao.buffer];
  self.postMessage({ type: 'done', data: r }, transfer);
};
