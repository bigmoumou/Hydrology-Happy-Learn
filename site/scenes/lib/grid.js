// 網格地形的水文演算：取樣、模糊、水滴侵蝕、填窪、D8 流向、流量累積、Strahler 級序
// 網格以列優先存放：index = j * nx + i，i 沿 x、j 沿 z。

export function sampleBilinear(h, nx, nz, fx, fz) {
  // fx, fz 為網格座標（可帶小數）
  if (fx < 0) fx = 0; if (fz < 0) fz = 0;
  if (fx > nx - 1.001) fx = nx - 1.001; if (fz > nz - 1.001) fz = nz - 1.001;
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  const k = j * nx + i;
  return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + nx] * (1 - u) + h[k + nx + 1] * u) * v;
}

// 可分離方框模糊，passes 次近似高斯
export function blur(src, nx, nz, radius, passes = 3) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const r = Math.max(1, radius | 0);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < nz; j++) {
      const row = j * nx;
      let acc = 0, cnt = 0;
      for (let i = -r; i <= r; i++) { const ii = Math.min(nx - 1, Math.max(0, i)); acc += a[row + ii]; cnt++; }
      for (let i = 0; i < nx; i++) {
        b[row + i] = acc / cnt;
        const add = Math.min(nx - 1, i + r + 1), sub = Math.max(0, i - r);
        acc += a[row + add] - a[row + sub];
      }
    }
    for (let i = 0; i < nx; i++) {
      let acc = 0, cnt = 0;
      for (let j = -r; j <= r; j++) { const jj = Math.min(nz - 1, Math.max(0, j)); acc += b[jj * nx + i]; cnt++; }
      for (let j = 0; j < nz; j++) {
        a[j * nx + i] = acc / cnt;
        const add = Math.min(nz - 1, j + r + 1), sub = Math.max(0, j - r);
        acc += b[add * nx + i] - b[sub * nx + i];
      }
    }
  }
  return a;
}

// 水滴侵蝕（改寫自 Hans Beyer / Sebastian Lague 的演算法）
// h 會被就地修改；scale 把世界高度換成約 0..1 的正規化高度
export function erode(h, nx, nz, rand, o = {}) {
  const {
    iterations = 100000, scale = 30, inertia = 0.05, capacity = 4, minCapacity = 0.01,
    erodeSpeed = 0.3, depositSpeed = 0.3, evaporate = 0.015, gravity = 4, maxLife = 40,
    radius = 3, stopBelow = 0, onProgress = null,
  } = o;
  const n = new Float32Array(h.length);
  for (let k = 0; k < h.length; k++) n[k] = h[k] / scale;
  const stopN = stopBelow / scale;

  // 侵蝕刷子
  const bo = [], bw = [];
  let wsum = 0;
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
    const d = Math.sqrt(x * x + y * y);
    if (d < radius) { bo.push([x, y]); const w = 1 - d / radius; bw.push(w); wsum += w; }
  }
  for (let k = 0; k < bw.length; k++) bw[k] /= wsum;

  const hg = { h: 0, gx: 0, gy: 0 };
  function heightGrad(px, py) {
    const ix = px | 0, iy = py | 0, u = px - ix, v = py - iy;
    const k = iy * nx + ix;
    const a = n[k], b = n[k + 1], c = n[k + nx], d = n[k + nx + 1];
    hg.gx = (b - a) * (1 - v) + (d - c) * v;
    hg.gy = (c - a) * (1 - u) + (d - b) * u;
    hg.h = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    return hg;
  }

  const report = Math.max(1, (iterations / 20) | 0);
  for (let it = 0; it < iterations; it++) {
    if (onProgress && it % report === 0) onProgress(it / iterations);
    let px = rand() * (nx - 2), py = rand() * (nz - 2);
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let life = 0; life < maxLife; life++) {
      const ix = px | 0, iy = py | 0;
      const k = iy * nx + ix;
      const cu = px - ix, cv = py - iy;
      const g = heightGrad(px, py);
      const h0 = g.h;
      if (h0 < stopN) break; // 進入海面就結束（泥沙視為帶出海）
      dx = dx * inertia - g.gx * (1 - inertia);
      dy = dy * inertia - g.gy * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len; dy /= len;
      px += dx; py += dy;
      if (px < 1 || px >= nx - 2 || py < 1 || py >= nz - 2) break;
      const dH = heightGrad(px, py).h - h0;
      const cap = Math.max(-dH * speed * water * capacity, minCapacity);
      if (sediment > cap || dH > 0) {
        const amt = dH > 0 ? Math.min(dH, sediment) : (sediment - cap) * depositSpeed;
        sediment -= amt;
        n[k] += amt * (1 - cu) * (1 - cv);
        n[k + 1] += amt * cu * (1 - cv);
        n[k + nx] += amt * (1 - cu) * cv;
        n[k + nx + 1] += amt * cu * cv;
      } else {
        const amt = Math.min((cap - sediment) * erodeSpeed, -dH);
        for (let b = 0; b < bo.length; b++) {
          const xx = ix + bo[b][0], yy = iy + bo[b][1];
          if (xx < 0 || yy < 0 || xx >= nx || yy >= nz) continue;
          const kk = yy * nx + xx;
          const e = amt * bw[b];
          n[kk] -= e; sediment += e;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dH * gravity));
      water *= 1 - evaporate;
    }
  }
  for (let k = 0; k < h.length; k++) h[k] = n[k] * scale;
  if (onProgress) onProgress(1);
}

// 最小堆（存 index，以 key 排序）
class MinHeap {
  constructor(cap) { this.idx = new Int32Array(cap); this.key = new Float64Array(cap); this.n = 0; }
  push(i, k) {
    let c = this.n++;
    this.idx[c] = i; this.key[c] = k;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.key[p] <= this.key[c]) break;
      this.swap(p, c); c = p;
    }
  }
  pop() {
    const top = this.idx[0];
    this.n--;
    if (this.n > 0) {
      this.idx[0] = this.idx[this.n]; this.key[0] = this.key[this.n];
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < this.n && this.key[l] < this.key[m]) m = l;
        if (r < this.n && this.key[r] < this.key[m]) m = r;
        if (m === c) break;
        this.swap(m, c); c = m;
      }
    }
    return top;
  }
  swap(a, b) {
    const ti = this.idx[a]; this.idx[a] = this.idx[b]; this.idx[b] = ti;
    const tk = this.key[a]; this.key[a] = this.key[b]; this.key[b] = tk;
  }
}

const DI = [1, 1, 0, -1, -1, -1, 0, 1];
const DJ = [0, 1, 1, 1, 0, -1, -1, -1];

// Priority-Flood 填窪（Barnes 2014，加微小坡度確保每格都能流出）
// isOutlet(k) 為 true 的格子（邊界或海）當作出口
export function fillDepressions(h, nx, nz, isOutlet, eps = 1e-4) {
  const f = Float32Array.from(h);
  const done = new Uint8Array(h.length);
  const heap = new MinHeap(h.length);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1 || isOutlet(k)) { done[k] = 1; heap.push(k, f[k]); }
  }
  while (heap.n > 0) {
    const k = heap.pop();
    const i = k % nx, j = (k / nx) | 0;
    for (let d = 0; d < 8; d++) {
      const ii = i + DI[d], jj = j + DJ[d];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const kk = jj * nx + ii;
      if (done[kk]) continue;
      done[kk] = 1;
      if (f[kk] <= f[k]) f[kk] = f[k] + eps;
      heap.push(kk, f[kk]);
    }
  }
  return f;
}

// D8 流向：回傳下游格 index，-1 表示出口
export function flowDirections(f, nx, nz, dx = 1) {
  const dir = new Int32Array(f.length).fill(-1);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let best = -1, bestS = 0;
    for (let d = 0; d < 8; d++) {
      const ii = i + DI[d], jj = j + DJ[d];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const kk = jj * nx + ii;
      const s = (f[k] - f[kk]) / (d & 1 ? Math.SQRT2 * dx : dx);
      if (s > bestS) { bestS = s; best = kk; }
    }
    dir[k] = best;
  }
  return dir;
}

// 流量累積（每格貢獻 1 個單位面積），依高程由高到低處理
export function flowAccumulation(f, dir) {
  const N = f.length;
  const order = new Int32Array(N);
  for (let k = 0; k < N; k++) order[k] = k;
  order.sort((a, b) => f[b] - f[a]);
  const acc = new Float32Array(N).fill(1);
  for (let t = 0; t < N; t++) {
    const k = order[t];
    const d = dir[k];
    if (d >= 0) acc[d] += acc[k];
  }
  return acc;
}

// Strahler 級序：只對 acc >= threshold 的河道格計算
export function strahlerOrder(f, dir, acc, threshold) {
  const N = f.length;
  const order = new Int32Array(N);
  for (let k = 0; k < N; k++) order[k] = k;
  order.sort((a, b) => f[b] - f[a]);
  const so = new Uint8Array(N);
  const maxIn = new Uint8Array(N), cntMax = new Uint8Array(N);
  for (let t = 0; t < N; t++) {
    const k = order[t];
    if (acc[k] < threshold) continue;
    let o = maxIn[k] === 0 ? 1 : (cntMax[k] >= 2 ? maxIn[k] + 1 : maxIn[k]);
    so[k] = o;
    const d = dir[k];
    if (d >= 0 && acc[d] >= threshold) {
      if (o > maxIn[d]) { maxIn[d] = o; cntMax[d] = 1; }
      else if (o === maxIn[d]) cntMax[d]++;
    }
  }
  return so;
}

// 追蹤從格 k 往下游的路徑，直到 stop(k) 為 true 或到出口
export function traceDown(dir, k, stop, maxSteps = 5000) {
  const path = [k];
  for (let s = 0; s < maxSteps; s++) {
    const d = dir[k];
    if (d < 0) break;
    k = d; path.push(k);
    if (stop(k)) break;
  }
  return path;
}

// ---- 折線工具 ----

// Catmull-Rom（centripetal）取樣成 n 點的平滑折線，回傳 [{x,z}]
export function catmullRom(points, n) {
  const P = [points[0], ...points, points[points.length - 1]];
  const segs = points.length - 1;
  const out = [];
  for (let s = 0; s < n; s++) {
    const t = (s / (n - 1)) * segs;
    const i = Math.min(segs - 1, Math.floor(t));
    const u = t - i;
    const p0 = P[i], p1 = P[i + 1], p2 = P[i + 2], p3 = P[i + 3];
    const u2 = u * u, u3 = u2 * u;
    const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
    out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
  }
  let acc = 0;
  out[0].s = 0;
  for (let k = 1; k < out.length; k++) { acc += Math.hypot(out[k].x - out[k - 1].x, out[k].z - out[k - 1].z); out[k].s = acc; }
  return out;
}

// 點到折線的最近距離與沿線距離 s；用粗網格加速
export function polylineIndex(line, cell = 4) {
  const buckets = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (let k = 0; k < line.length - 1; k++) {
    const a = line[k], b = line[k + 1];
    const minx = Math.floor(Math.min(a.x, b.x) / cell), maxx = Math.floor(Math.max(a.x, b.x) / cell);
    const minz = Math.floor(Math.min(a.z, b.z) / cell), maxz = Math.floor(Math.max(a.z, b.z) / cell);
    for (let cx = minx; cx <= maxx; cx++) for (let cz = minz; cz <= maxz; cz++) {
      const kk = key(cx, cz);
      if (!buckets.has(kk)) buckets.set(kk, []);
      buckets.get(kk).push(k);
    }
  }
  const res = { d: Infinity, s: 0, seg: 0 };
  return function nearest(x, z, maxR = 24) {
    res.d = Infinity;
    const cx0 = Math.floor(x / cell), cz0 = Math.floor(z / cell);
    const R = Math.ceil(maxR / cell);
    const seen = new Set();
    for (let cx = cx0 - R; cx <= cx0 + R; cx++) for (let cz = cz0 - R; cz <= cz0 + R; cz++) {
      const arr = buckets.get(key(cx, cz));
      if (!arr) continue;
      for (const k of arr) {
        if (seen.has(k)) continue; seen.add(k);
        const a = line[k], b = line[k + 1];
        const vx = b.x - a.x, vz = b.z - a.z;
        const L2 = vx * vx + vz * vz || 1e-9;
        let t = ((x - a.x) * vx + (z - a.z) * vz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a.x + vx * t, pz = a.z + vz * t;
        const d = Math.hypot(x - px, z - pz);
        if (d < res.d) { res.d = d; res.s = a.s + (b.s - a.s) * t; res.seg = k; }
      }
    }
    return res;
  };
}
