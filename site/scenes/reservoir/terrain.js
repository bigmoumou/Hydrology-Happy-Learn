// 水庫場景的地形：一條往 +x 流的河谷，x = damX 處是峽谷壩址；上游有三條支流谷（淹水後成為樹枝狀的湖灣）
// 前切面 z = z1 正好沿著河谷中線，切面就是「水庫縱剖面」：河床、蓄水、大壩斷面。
import { mulberry32, createNoise2D, fbm, ridged, smoothstep, clamp, lerp } from '../lib/noise.js';
import { erode, sampleBilinear, blur, fillDepressions } from '../lib/grid.js';

export const RV = { x0: -60, x1: 60, z0: -44, z1: 0.5, dx: 0.25, bottom: -7, damX: 16, crest: 16, spill: 14.6, floorDam: 2.4 };

export function floorAt(x) {
  const { damX, floorDam } = RV;
  if (x <= damX) return floorDam + (damX - x) * 0.17;
  const toe = damX + 13;
  const down = floorDam - 1.7 - (x - toe) * 0.014;
  return x < toe ? lerp(floorDam, down, smoothstep(damX, toe, x)) : down;
}

export function buildReservoir(seed = 3, onProgress = () => {}) {
  const { x0, z0, dx, damX } = RV;
  const nx = Math.round((RV.x1 - x0) / dx) + 1, nz = Math.round((RV.z1 - z0) / dx) + 1, N = nx * nz;
  const X = (i) => x0 + i * dx, Z = (j) => z0 + j * dx;
  const rand = mulberry32(seed);
  const n1 = createNoise2D(rand), n2 = createNoise2D(rand), n3 = createNoise2D(rand);
  const h = new Float32Array(N);
  onProgress('地形骨架', 0);
  const tribs = [[-46, 0.4, 1.15], [-30, -0.3, 0.9], [-14, 0.25, 1.1], [0, -0.35, 0.8]]; // x, 角度, 規模
  for (let j = 0; j < nz; j++) {
    const z = Z(j), d = Math.abs(z);
    for (let i = 0; i < nx; i++) {
      const x = X(i);
      const fl = floorAt(x);
      const gorge = 1 - smoothstep(3, 16, Math.abs(x - damX - 1));
      const hw = lerp(12.5 + 3 * fbm(n3, x * 0.03, 3.1, 2), 2.6, gorge) * (x > damX + 4 ? 0.9 : 1);
      const wx = x + 5 * fbm(n3, x * 0.04, z * 0.04, 3), wz = z + 5 * fbm(n3, x * 0.04 + 31, z * 0.04, 3);
      const s = Math.max(0, d - hw * 0.3) / (hw * 1.7);
      const wallH = 23 + 6 * fbm(n2, x * 0.02, z * 0.02, 3);
      let y = fl + wallH * (1 - Math.exp(-lerp(1.3, 2.4, gorge) * Math.pow(s, lerp(1.15, 0.9, gorge))));
      y += smoothstep(0.15, 1.2, s) * (6 * ridged(n1, wx * 0.035, wz * 0.035, 5) + 2.2 * fbm(n2, x * 0.09, z * 0.09, 4));
      // 支流谷
      for (const [xt, ang, k] of tribs) {
        const ux = Math.sin(ang), uz = -Math.cos(ang);
        const px = x - xt, pz = z;
        const u = px * ux + pz * uz, v = px * uz - pz * ux;
        if (u < 2) continue;
        const target = floorAt(xt) + 0.2 * u + 0.5;
        const w = (2.4 + 0.22 * u) * k;
        if (y > target) y = target + (y - target) * smoothstep(0, w, Math.abs(v) + 0.6 * fbm(n3, u * 0.1, 7 + xt, 2));
      }
      // 後方山脊：讓水不會從方塊後緣漏出去
      y = Math.max(y, lerp(y, RV.crest + 3 + 3 * fbm(n2, x * 0.05, 9, 2), smoothstep(-35, -43.5, z)));
      h[j * nx + i] = y;
    }
  }
  onProgress('侵蝕模擬', 0);
  erode(h, nx, nz, rand, { iterations: 140000, scale: 30, radius: 3, maxLife: 40, erodeSpeed: 0.3, depositSpeed: 0.25, capacity: 4.5, evaporate: 0.015,
    onProgress: (p) => onProgress('侵蝕模擬', p) });
  onProgress('河道與水文分析', 0.3);
  // 河道：沿中線刻出小河槽，並讓剖面上的河床平順
  for (let j = 0; j < nz; j++) {
    const d = Math.abs(Z(j));
    for (let i = 0; i < nx; i++) {
      const x = X(i), k = j * nx + i;
      const bed = floorAt(x) - (x > damX ? 0.55 : 0.35);
      const w = x > damX ? 2.0 : 1.4;
      if (d < w + 3) {
        const t = smoothstep(0, w, d);
        const target = lerp(bed, floorAt(x) + 0.1, t);
        const blend = 1 - smoothstep(w, w + 3, d);
        h[k] = lerp(h[k], Math.min(h[k], target), blend);
      }
    }
  }
  // 壩址兩岸：確保壩頂高程以上是岩壁
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = X(i), z = Z(j), k = j * nx + i;
    if (Math.abs(x - damX) < 3 && -z > 9) h[k] = Math.max(h[k], RV.crest + 2 + 3 * smoothstep(9, 16, -z));
  }
  const hs = blur(h, nx, nz, 1, 1);
  for (let k = 0; k < N; k++) h[k] = lerp(h[k], hs[k], 0.5);
  // 填平封閉窪地（不然水位一高，山裡的小坑也會冒出水）
  const filled = fillDepressions(h, nx, nz, () => false, 0);
  h.set(filled);

  // 中線河床（取 |z| < 1.6 的最低點，往下游單調下降）→ 給水面著色器用
  const thal = new Float32Array(nx);
  for (let i = 0; i < nx; i++) {
    let m = Infinity;
    for (let j = nz - 1; j >= 0 && Z(j) > -1.6; j--) m = Math.min(m, h[j * nx + i]);
    thal[i] = m;
  }
  for (let i = 1; i < nx; i++) thal[i] = Math.min(thal[i], thal[i - 1]);

  // 標高—面積—蓄水量曲線（只算壩的上游）
  onProgress('河道與水文分析', 0.8);
  const iDam = Math.round((damX - x0) / dx);
  const levels = [], areas = [], stores = [];
  let Lmin = Infinity;
  for (let j = 0; j < nz; j++) for (let i = 0; i < iDam; i++) Lmin = Math.min(Lmin, h[j * nx + i]);
  for (let L = Math.ceil(Lmin * 20) / 20; L <= RV.crest + 1e-6; L += 0.05) {
    let a = 0, s = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < iDam; i++) { const d = L - h[j * nx + i]; if (d > 0) { a++; s += d; } }
    levels.push(+L.toFixed(3)); areas.push(a * dx * dx); stores.push(s * dx * dx);
  }
  // 環境遮蔽（簡化版地平線法）
  const ao = new Float32Array(N);
  const dirs = Array.from({ length: 8 }, (_, d) => [Math.cos(d * Math.PI / 4), Math.sin(d * Math.PI / 4)]);
  const steps = [1, 2, 4, 7, 11, 17, 26, 38];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const h0 = h[j * nx + i];
    let occ = 0;
    for (const [ux, uz] of dirs) {
      let mt = 0;
      for (const st of steps) {
        const ii = i + ux * st, jj = j + uz * st;
        if (ii < 0 || jj < 0 || ii > nx - 1 || jj > nz - 1) break;
        const tn = (sampleBilinear(h, nx, nz, ii, jj) - h0) / (st * dx);
        if (tn > mt) mt = tn;
      }
      occ += mt / Math.sqrt(1 + mt * mt);
    }
    ao[j * nx + i] = 1 - occ / 8;
  }
  onProgress('完成', 1);
  return { nx, nz, dx, x0, z0, h, thal, ao, curve: { levels, areas, stores }, ...RV };
}
