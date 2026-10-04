// S1 水文循環方塊圖的地形：左邊高山 → 丘陵 → 平原 → 海岸 → 右邊海洋
// 前切面（z = +40）就是課本圖 1-1 的剖面：山坡 → 小溪 → 平原 → 海。
// 本檔可在 Web Worker 中執行，只依賴 noise.js 與 grid.js。

import { mulberry32, createNoise2D, fbm, ridged, smoothstep, clamp, lerp } from '../lib/noise.js';
import {
  blur, erode, fillDepressions, flowDirections, flowAccumulation, catmullRom, polylineIndex, sampleBilinear,
} from '../lib/grid.js';

export const S1 = { x0: -60, x1: 60, z0: -40, z1: 40, dx: 0.25, bottom: -22, sea: 0 };

export function coastX(z, n) {
  return 36 + 2.2 * Math.sin(0.11 * z + 0.6) + 1.3 * Math.sin(0.29 * z + 2.0) + (n ? 0.8 * n(z * 0.05, 7.3) : 0);
}

const RIVER_CP = [
  [-57, -35], [-49, -25], [-41, -18], [-32, -12], [-23, -7.5], [-14, -4.5], [-6, -1.5], [2, 0.5],
  [9, -2.5], [15, -7], [21, -6.5], [26, -2], [30, 3], [35, 2.5], [40, 0], [47, -1],
];
const CREEK_CP = [[5.2, 43], [5.6, 36], [3.8, 29], [6.2, 21.5], [8.6, 13.5], [7.4, 6.5], [4.6, 2.2]];
const PONDS = [[15, 24, 2.6], [23, 31, 2.0], [27, 15, 2.2], [17, -25, 2.5], [-12, 32.5, 1.7], [28, -20, 1.8]];

export function buildS1(seed = 7, onProgress = () => {}) {
  const { x0, z0, dx, sea } = S1;
  const nx = Math.round((S1.x1 - x0) / dx) + 1;
  const nz = Math.round((S1.z1 - z0) / dx) + 1;
  const N = nx * nz;
  const rand = mulberry32(seed);
  const n1 = createNoise2D(rand), n2 = createNoise2D(rand), n3 = createNoise2D(rand), n4 = createNoise2D(rand);
  const X = (i) => x0 + i * dx, Z = (j) => z0 + j * dx;

  onProgress('地形骨架', 0);
  // ---- 主河道與小溪折線 ----
  const river = catmullRom(RIVER_CP.map(([x, z]) => ({ x, z })), 700);
  const creek = catmullRom(CREEK_CP.map(([x, z]) => ({ x, z })), 260);
  // 河口位置
  let sMouth = river[river.length - 1].s;
  for (const p of river) if (p.x > coastX(p.z, n4)) { sMouth = p.s; break; }
  const rNear = polylineIndex(river, 4);
  const cNear = polylineIndex(creek, 4);

  const h = new Float32Array(N);
  const mount = new Float32Array(N);
  const rdist = new Float32Array(N); // 到主河道中心線的距離
  const cdist = new Float32Array(N); // 到小溪中心線的距離

  for (let j = 0; j < nz; j++) {
    const z = Z(j);
    const cx = coastX(z, n4);
    for (let i = 0; i < nx; i++) {
      const x = X(i);
      const k = j * nx + i;
      const warpX = x + 6 * fbm(n3, x * 0.03, z * 0.03, 3);
      const warpZ = z + 6 * fbm(n3, x * 0.03 + 40, z * 0.03 + 40, 3);
      const mm = smoothstep(2, -28, x + 0.28 * z + 5 * fbm(n2, x * 0.04, z * 0.04, 3));
      const fh = smoothstep(16, -8, x + 0.22 * z + 4 * fbm(n2, x * 0.05 + 9, z * 0.05, 3));
      mount[k] = mm;
      // 主河谷走廊：離河越近，山與丘陵的起伏越小（谷形交給侵蝕去雕）
      const r = rNear(x, z, 40);
      const rd = Math.min(r.d, 40);
      rdist[k] = rd;
      const f = Math.min(1, r.s / sMouth);
      const W = lerp(7, 18, f);
      const v = smoothstep(0, W, rd);
      const rl = 15 * Math.pow(1 - f, 2.1);
      const plain = 0.55 + 0.085 * Math.max(0, cx - x) + 0.032 * Math.max(0, rd - 3) + 0.25 * fbm(n1, x * 0.08, z * 0.08, 3);
      const hills = fh * (0.5 + 0.5 * v) * (1.8 + 3.2 * (0.5 + 0.5 * fbm(n1, warpX * 0.055, warpZ * 0.055, 4)));
      const mtn = Math.pow(mm, 1.25) * (0.5 + 0.5 * v) * (5 + 21 * ridged(n2, warpX * 0.021, warpZ * 0.021, 6) + 4 * fbm(n1, x * 0.06, z * 0.06, 4));
      let land = plain + hills + mtn;
      if (land > rl) land = rl + (land - rl) * (0.45 + 0.55 * smoothstep(0, W * 1.2, rd));
      // 小溪的淺谷
      const c = cNear(x, z, 8);
      cdist[k] = Math.min(c.d, 8);
      if (c.d < 7) land -= 0.7 * (1 - smoothstep(0, 7, c.d));
      // 海岸 → 海床
      const off = x - cx;
      const seabed = -0.45 * off - 0.0065 * off * off + 0.35 * fbm(n1, x * 0.1, z * 0.1, 3);
      const b = smoothstep(-3.5, 1.5, off);
      const beachLand = off > -6 ? lerp(land, 0.35 + 0.02 * (-off), smoothstep(-6, -0.5, off)) : land;
      h[k] = lerp(beachLand, Math.min(seabed, -0.05), b);
    }
  }

  // ---- 水滴侵蝕 ----
  onProgress('侵蝕模擬', 0);
  erode(h, nx, nz, rand, {
    iterations: 320000, scale: 32, stopBelow: 0.15, radius: 3, maxLife: 45,
    erodeSpeed: 0.35, depositSpeed: 0.25, capacity: 5, evaporate: 0.012,
    onProgress: (p) => onProgress('侵蝕模擬', p),
  });

  onProgress('河道與水文分析', 0);
  // ---- 主河道水位（跟著侵蝕後的谷底走，且由上游往下游單調下降）----
  const riverLevel = river.map((p) => {
    const fi = (p.x - x0) / dx, fj = (p.z - z0) / dx;
    let m = Infinity;
    for (let a = -3; a <= 3; a++) for (let b2 = -3; b2 <= 3; b2++) m = Math.min(m, sampleBilinear(h, nx, nz, fi + a * 2, fj + b2 * 2));
    return m;
  });
  smoothArray(riverLevel, 6);
  for (let k = 1; k < river.length; k++) riverLevel[k] = Math.min(riverLevel[k], riverLevel[k - 1] - 0.004);
  for (let k = 0; k < river.length; k++) {
    const f = river[k].s / sMouth;
    river[k].level = f >= 1 ? sea : Math.max(sea + 0.03, riverLevel[k] - 0.15);
    if (f > 0.92) river[k].level = lerp(river[k].level, sea, smoothstep(0.92, 1.0, f));
    river[k].w = lerp(0.55, 2.3, Math.min(1, f) ** 0.8);
    river[k].depth = lerp(0.3, 0.9, Math.min(1, f));
  }
  // 小溪水位：前切面處約低於地表 0.6，到匯流點等於主河道水位
  const jr = rNear(creek[creek.length - 1].x, creek[creek.length - 1].z, 10);
  const joinLevel = river[Math.min(river.length - 1, jr.seg)].level;
  const creekStart = sampleBilinear(h, nx, nz, (creek[0].x - x0) / dx, Math.min(nz - 1, (creek[0].z - z0) / dx)) - 0.55;
  const S = creek[creek.length - 1].s;
  for (const p of creek) {
    p.level = lerp(creekStart, joinLevel, Math.pow(p.s / S, 0.9));
    p.w = 0.5; p.depth = 0.35;
  }

  // ---- 切出河道（把水面以下挖成碟形，岸坡平緩爬升）----
  const waterLevel = new Float32Array(N).fill(-999); // -999 表示不是河道
  const channelMask = new Uint8Array(N);
  carveChannel(river, rNear, 1.0);
  carveChannel(creek, cNear, 0.6);

  function carveChannel(line, near, bankK) {
    for (let j = 0; j < nz; j++) {
      const z = Z(j);
      for (let i = 0; i < nx; i++) {
        const x = X(i);
        const r = near(x, z, 8);
        if (r.d > 8) continue;
        const a = line[r.seg], b = line[Math.min(line.length - 1, r.seg + 1)];
        const t = (r.s - a.s) / Math.max(1e-6, b.s - a.s);
        const lv = lerp(a.level, b.level, t), w = lerp(a.w, b.w, t), dep = lerp(a.depth, b.depth, t);
        const k = j * nx + i;
        if (r.d < w) {
          const bed = lv - dep;
          h[k] = Math.min(h[k], bed + (lv + 0.02 - bed) * (r.d / w) ** 2);
          channelMask[k] = 1;
          waterLevel[k] = Math.max(waterLevel[k], lv);
        } else {
          // 岸坡：錐形下切，往外平滑淡出，避免出現折痕
          const e = r.d - w;
          const cone = lv + 0.05 + e * 0.3 * bankK + e * e * 0.05;
          if (h[k] > cone) h[k] = lerp(cone, h[k], smoothstep(0.6, 6.5, e));
        }
      }
    }
  }

  // ---- 窪地（窪蓄）----
  const ponds = [];
  for (const [px, pz, R] of PONDS) {
    let rim = Infinity;
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      rim = Math.min(rim, sampleBilinear(h, nx, nz, (px + Math.cos(ang) * R * 1.3 - x0) / dx, (pz + Math.sin(ang) * R * 1.3 - z0) / dx));
    }
    const level = rim - 0.07;
    const ph1 = px * 0.7, ph2 = pz * 0.5;
    const Ra = (ang) => R * (1 + 0.16 * Math.sin(3 * ang + ph1) + 0.08 * Math.sin(5 * ang + ph2) + 0.05 * Math.sin(8 * ang + ph1 * 1.7));
    const i0 = Math.floor((px - R * 1.6 - x0) / dx), i1 = Math.ceil((px + R * 1.6 - x0) / dx);
    const j0 = Math.floor((pz - R * 1.6 - z0) / dx), j1 = Math.ceil((pz + R * 1.6 - z0) / dx);
    for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
      const d0 = Math.hypot(X(i) - px, Z(j) - pz);
      const d = d0 * R / Ra(Math.atan2(Z(j) - pz, X(i) - px));
      const k = j * nx + i;
      if (d < R) {
        h[k] = Math.min(h[k], level - 0.3 * (1 - (d / R) ** 2));
        waterLevel[k] = Math.max(waterLevel[k], level);
      } else if (d < R * 1.6) {
        const cone = level + (d - R) * 0.16;
        if (h[k] > cone) h[k] = lerp(cone, h[k], smoothstep(R, R * 1.6, d));
      }
    }
    ponds.push({ x: px, z: pz, r: R, level });
  }

  // ---- 水文分析：填窪 → D8 → 流量累積 ----
  const isOutlet = (k) => h[k] < sea + 0.02;
  const filled = fillDepressions(h, nx, nz, isOutlet);
  const dir = flowDirections(filled, nx, nz, dx);
  const acc = flowAccumulation(filled, dir);
  onProgress('河道與水文分析', 0.5);

  // 山區支流：累積面積大的格子稍微下切，讓溝谷更清楚
  const trib = 110; // 格數門檻（約 6.9 平方單位）
  for (let k = 0; k < N; k++) {
    if (channelMask[k] || h[k] < 1) continue;
    const a = acc[k];
    if (a > trib) h[k] -= 0.22 * smoothstep(trib, trib * 6, a) * (0.4 + 0.6 * mount[k]);
  }

  // ---- 地下水位：地形的平滑縮影，在河道、窪地等於水面，在海岸等於海平面 ----
  const hs = blur(h, nx, nz, 22, 3);
  let gwt = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (h[k] < sea) { gwt[k] = sea; continue; }
    gwt[k] = sea + 0.1 + Math.max(0, hs[k] - sea) * 0.6;
    gwt[k] = Math.min(gwt[k], h[k] - 0.9);
    if (waterLevel[k] > -999) gwt[k] = waterLevel[k] - 0.02;
  }
  gwt = blur(gwt, nx, nz, 5, 2);
  for (let k = 0; k < N; k++) {
    if (h[k] < sea) { gwt[k] = sea; continue; }
    if (waterLevel[k] > -999) gwt[k] = Math.min(gwt[k], waterLevel[k] - 0.02);
    else gwt[k] = Math.min(gwt[k], h[k] - 0.55);
    gwt[k] = Math.max(gwt[k], sea - 0.02);
  }

  // ---- 土層厚度（到基岩）：山區薄、平原厚 ----
  const soil = new Float32Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const m = mount[k];
    soil[k] = lerp(13.5, 1.6, Math.min(1, m * 1.3)) + 1.2 * fbm(n4, X(i) * 0.06, Z(j) * 0.06, 3);
  }

  // ---- 烘焙環境遮蔽（地平線法）：山谷、溝谷較暗，增加立體感 ----
  onProgress('環境遮蔽', 0);
  const ao = new Float32Array(N);
  const DIRS = 10, STEPS = [1, 2, 3, 5, 8, 12, 18, 26, 36, 48];
  const dirs = Array.from({ length: DIRS }, (_, d) => [Math.cos((d / DIRS) * Math.PI * 2), Math.sin((d / DIRS) * Math.PI * 2)]);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const h0 = Math.max(h[k], sea);
    let occ = 0;
    for (const [ux, uz] of dirs) {
      let maxT = 0;
      for (const st of STEPS) {
        const ii = i + ux * st, jj = j + uz * st;
        if (ii < 0 || jj < 0 || ii > nx - 1 || jj > nz - 1) break;
        const hh = Math.max(sampleBilinear(h, nx, nz, ii, jj), sea);
        const tn = (hh - h0) / (st * dx);
        if (tn > maxT) maxT = tn;
      }
      occ += maxT / Math.sqrt(1 + maxT * maxT); // sin(仰角)
    }
    ao[k] = 1 - occ / DIRS;
  }

  onProgress('完成', 1);
  return {
    rdist, cdist, ao,
    nx, nz, dx, x0, z0, sea, bottom: S1.bottom,
    h, gwt, soil, mount, acc, dir, waterLevel, channelMask,
    river: river.map((p) => ({ x: p.x, z: p.z, s: p.s, level: p.level, w: p.w })),
    creek: creek.map((p) => ({ x: p.x, z: p.z, s: p.s, level: p.level, w: p.w })),
    sMouth, ponds,
    coast: Array.from({ length: nz }, (_, j) => coastX(Z(j), n4)),
  };
}

function smoothArray(a, r) {
  const b = a.slice();
  for (let k = 0; k < a.length; k++) {
    let s = 0, c = 0;
    for (let q = -r; q <= r; q++) { const kk = k + q; if (kk >= 0 && kk < a.length) { s += b[kk]; c++; } }
    a[k] = s / c;
  }
}
