// S1 水文循環方塊圖（旗艦場景）
// 用法：const api = await createHydroCycle(container, { onProgress, quality })
// 所有動態只由時間 t 決定：互動時 t 跟著時鐘走；做影片時呼叫 api.render(t) 逐格輸出。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, createNoise2D, fbm, smoothstep, clamp, lerp } from '../lib/noise.js';
import { sampleBilinear } from '../lib/grid.js';
import { makeWaterNormal, makeDetailNormal, makePuffTexture } from '../lib/textures.js';
import { FlowSystem, chaikin } from '../lib/flows.js';
import { coniferGeometry, broadleafGeometry, palmGeometry, shrubGeometry, treeMaterial, wetUniform, chunkedInstances, TreeLOD } from '../lib/trees.js';
import { STEPS } from './steps.js';
import { createPost } from '../lib/post.js';
import { GLSL_FACE, faceIndex, addPlinth } from '../lib/stage.js';
import { planVillage, buildVillage } from './village.js';

const GLSL_NOISE = /* glsl */`
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
  float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

const loadTerrain = (seed, onProgress) => new Promise((resolve, reject) => {
  const w = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e) => {
    if (e.data.type === 'progress') onProgress(e.data.stage, e.data.p);
    else if (e.data.type === 'done') { w.terminate(); resolve(e.data.data); }
  };
  w.onerror = (err) => { w.terminate(); reject(err); };
  w.postMessage({ seed });
});

export async function createHydroCycle(container, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const seed = opts.seed ?? 7;
  let quality = opts.quality || 'high';
  const capture = !!opts.capture;

  // ---------- 渲染器 ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: capture });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'hc-canvas';
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'hc-labels';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 3000);
  camera.position.set(...STEPS[0].cam[0]);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...STEPS[0].cam[1]);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 260;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();
  // 後製（GTAO 接觸陰影、bloom）與畫質分級；像素比例也由它管
  const post = createPost(renderer, scene, camera, { level: quality, capture, ao: { radius: 2.4, distance: () => camera.position.distanceTo(controls.target) } });

  // ---------- 光與環境 ----------
  const sunDir = new THREE.Vector3(-0.52, 0.66, 0.54).normalize();
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const su = sky.material.uniforms;
  su.turbidity.value = 3.5; su.rayleigh.value = 1.4; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.82;
  su.sunPosition.value.copy(sunDir); su.cloudCoverage.value = 0.0; su.showSunDisc.value = 0;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(sky);
  const envTex = pmrem.fromScene(envScene, 0, 0.1, 100000).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;

  const sun = new THREE.DirectionalLight(0xfff1de, 2.7);
  sun.position.copy(sunDir).multiplyScalar(160);
  sun.castShadow = true;
  const shadowRes = { high: 4096, medium: 2048, low: 1024 };
  sun.shadow.mapSize.set(shadowRes[quality], shadowRes[quality]);
  Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 90, bottom: -90, near: 20, far: 380 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xd7e6f2, 0x6b5b45, 0.45));

  // 背景：柔和的展示台漸層
  const bgMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color(0xcdd9e2) }, uMid: { value: new THREE.Color(0xeeebe4) }, uBot: { value: new THREE.Color(0xe2ddd2) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop, uMid, uBot; varying vec3 vP;
      void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.6, y)) : mix(uMid, uBot, smoothstep(0.0, -0.4, y));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const bg = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), bgMat);
  bg.renderOrder = -10;
  bg.userData.noAO = true;
  scene.add(bg);

  // ---------- 地形資料 ----------
  const T = await loadTerrain(seed, onProgress);
  onProgress('建立 3D 模型', 0.2);
  const { nx, nz, dx, x0, z0, h, gwt, soil, mount, acc, dir, waterLevel, channelMask, rdist, cdist, ao, river, creek, ponds, coast, sMouth, bottom } = T;
  const x1 = x0 + (nx - 1) * dx, z1 = z0 + (nz - 1) * dx;
  const X = (i) => x0 + i * dx, Z = (j) => z0 + j * dx;
  const H = (x, z) => sampleBilinear(h, nx, nz, (x - x0) / dx, (z - z0) / dx);
  const rand = mulberry32(seed * 31 + 1);
  const nz2 = createNoise2D(mulberry32(seed + 99));

  // ---------- 山區溪流：先決定水路、在地形刻出淺溪床（之後才建地表網格）----------
  // D8 流向只有 8 個方向，在平整的坡面上會變成一條條平行直線。這裡把它磨圓、加上自然的蜿蜒，
  // 再沿水路把地形往下刻一條淺溝，水面才會乖乖待在溪床裡。
  const streamLines = [];
  const streamMask = new Uint8Array(nx * nz);
  const streamRef = new Int32Array(nx * nz).fill(-1);   // 溪床格子 → 第幾條溪 × 4096 + 第幾個點（漫地流粒子接到溪裡用）
  {
    const NN = nx * nz, A0 = 900;
    const srand = mulberry32(seed * 7 + 3);
    const isStream = new Uint8Array(NN);
    for (let k = 0; k < NN; k++) if (acc[k] >= A0 && h[k] > 1.2 && !channelMask[k] && waterLevel[k] <= -999) isStream[k] = 1;
    const hasUp = new Uint8Array(NN);
    for (let k = 0; k < NN; k++) if (isStream[k] && dir[k] >= 0) hasUp[dir[k]] = 1;
    const visited = new Uint8Array(NN);
    const h0 = Float32Array.from(h);   // 刻溪床前的地形
    const H0 = (x, z) => sampleBilinear(h0, nx, nz, (x - x0) / dx, (z - z0) / dx);
    // 先把每條溪的格子追出來，再從長的開始畫（間距檢查時，大溪優先保留）
    const cellLists = [];
    for (let k0 = 0; k0 < NN; k0++) {
      if (!isStream[k0] || hasUp[k0]) continue;
      const cells = [];
      let k = k0;
      for (let st = 0; st < 3000; st++) {
        cells.push(k);
        if (visited[k]) break;
        visited[k] = 1;
        const d = dir[k];
        if (d < 0) break;
        if (channelMask[d] || h[d] < 0.05 || waterLevel[d] > -999) { cells.push(d); break; }
        if (!isStream[d]) break;
        k = d;
      }
      if (cells.length >= 10) cellLists.push(cells);
    }
    cellLists.sort((a, b) => b.length - a.length);
    for (const cells of cellLists) {
      let flat = [];
      for (const c of cells) flat.push(X(c % nx), 0, Z((c / nx) | 0));
      flat = Array.from(chaikin(Float32Array.from(flat), 4));
      // 等距取樣
      const base = [];
      let s = 0;
      for (let q = 0; q < flat.length / 3; q++) {
        const x = flat[q * 3], z = flat[q * 3 + 2];
        if (q > 0) s += Math.hypot(x - flat[q * 3 - 3], z - flat[q * 3 - 1]);
        base.push({ x, z, s });
      }
      const L = s;
      if (L < 5) continue;
      const pts = [];
      for (let t = 0; t <= L; t += 0.25) {
        let lo = 0; while (lo < base.length - 2 && base[lo + 1].s < t) lo++;
        const a = base[lo], b = base[lo + 1], f = (t - a.s) / Math.max(1e-6, b.s - a.s);
        pts.push({ x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), s: t, k: cells[Math.min(cells.length - 1, Math.round((t / L) * (cells.length - 1)))] });
      }
      // 蜿蜒：沿法向偏移。一個中波長的彎＋一個長波長的漂移（相鄰的溪才不會平行），振幅隨流量變大；
      // 頭尾收斂，才接得上源頭和下游的河
      const ph = srand() * 6.28, lam = 8 + srand() * 6, ph2 = srand() * 100, drift = (srand() - 0.5) * 2;
      const off = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
        const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
        const env = smoothstep(0, 4, p.s) * smoothstep(0, 3, L - p.s);
        const amp = (0.45 + 0.5 * smoothstep(A0, A0 * 6, acc[p.k])) * env;
        const o = amp * (0.7 * Math.sin((p.s / lam) * 6.2832 + ph) + 0.6 * nz2(p.s * 0.12 + ph2, 3.7))
          + drift * env * Math.sin(Math.min(1, p.s / L) * Math.PI) * 1.4;
        return [-tz / l * o, tx / l * o];
      });
      pts.forEach((p, i) => { p.x += off[i][0]; p.z += off[i][1]; });
      // 和已經畫好的溪靠太近（大半段都在 3 單位內）就不畫：一排平行的溪很假
      const close = pts.filter((p) => streamLines.some((l2) => l2.some((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 9))).length;
      if (close > pts.length * 0.45) continue;
      // 溪床高度：沿線取原地形、只降不升；寬度隨流量
      let lvl = Infinity;
      for (const p of pts) {
        lvl = Math.min(lvl, H0(p.x, p.z) - 0.04);
        p.bed = lvl;
        p.level = lvl + 0.02;
        p.w = Math.min(0.3, 0.07 + 0.05 * Math.sqrt(acc[p.k] / A0));
      }
      // 刻溪床：中心比水面低一點，兩岸用拋物線接回原地形；岸邊顏色之後再加深
      for (const [pi, p] of pts.entries()) {
        const R = p.w + 0.7;
        for (let j = Math.floor((p.z - R - z0) / dx); j <= Math.ceil((p.z + R - z0) / dx); j++)
          for (let i = Math.floor((p.x - R - x0) / dx); i <= Math.ceil((p.x + R - x0) / dx); i++) {
            if (i < 1 || j < 1 || i >= nx - 1 || j >= nz - 1) continue;
            const d = Math.hypot(X(i) - p.x, Z(j) - p.z);
            if (d > R) continue;
            const kk = j * nx + i;
            h[kk] = Math.min(h[kk], p.bed - 0.06 + (d / R) ** 2 * (0.06 + 0.4));
            streamMask[kk] = Math.max(streamMask[kk], d < p.w + 0.2 ? 2 : 1);
            if (d < p.w + 0.2 && streamRef[kk] < 0) streamRef[kk] = streamLines.length * 4096 + pi;
          }
      }
      streamLines.push(pts);
    }
  }

  const waterNormal = makeWaterNormal();
  const detailNormal = makeDetailNormal();
  const puffTex = makePuffTexture();
  const timeUniform = { value: 0 };
  const treeMats = [];

  // ---------- 地表網格 ----------
  const N = nx * nz;
  const tPos = new Float32Array(N * 3), tNor = new Float32Array(N * 3), tCol = new Float32Array(N * 3), tUv = new Float32Array(N * 2), tPaddy = new Float32Array(N);
  const pal = Object.fromEntries(Object.entries({
    sand: 0xd8c7a0, wetSand: 0xb59f79, grassA: 0x86a250, grassB: 0x6e8d41, forestA: 0x4b6a31, forestB: 0x3a5426,
    alpine: 0x8b9068, rock: 0x7a7266, rockDark: 0x575047, gravel: 0xbdb39e, gravelB: 0xa1977f, wet: 0x55704f,
    seabedS: 0xcdb98e, seabedD: 0x6a6150, bank: 0x9a8d6e,
  }).map(([k, v]) => [k, new THREE.Color(v)]));
  const c = new THREE.Color(), c2 = new THREE.Color();
  const riverWAt = (s) => lerp(0.55, 2.3, Math.min(1, s / sMouth) ** 0.8);
  for (let j = 0; j < nz; j++) {
    const z = Z(j);
    const cx = coast[j];
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = X(i), y = h[k];
      tPos[k * 3] = x; tPos[k * 3 + 1] = y; tPos[k * 3 + 2] = z;
      const hl = h[j * nx + Math.max(0, i - 1)], hr = h[j * nx + Math.min(nx - 1, i + 1)];
      const hd = h[Math.max(0, j - 1) * nx + i], hu = h[Math.min(nz - 1, j + 1) * nx + i];
      const gx = (hr - hl) / (2 * dx), gz = (hu - hd) / (2 * dx);
      const il = 1 / Math.hypot(gx, 1, gz);
      const ny = il;
      tNor[k * 3] = -gx * il; tNor[k * 3 + 1] = ny; tNor[k * 3 + 2] = -gz * il;
      tUv[k * 2] = x * 0.85; tUv[k * 2 + 1] = z * 0.85;
      const slope = 1 - ny;
      const n = 0.5 + 0.5 * nz2(x * 0.09, z * 0.09);
      const n2 = 0.5 + 0.5 * nz2(x * 0.31 + 20, z * 0.31);
      const m = mount[k];
      if (y < 0.02) {
        c.copy(pal.seabedS).lerp(pal.seabedD, smoothstep(0, 7, -y));
      } else {
        c.copy(pal.grassA).lerp(pal.grassB, n);
        const forest = clamp(smoothstep(0.1, 0.4, m) + smoothstep(3.5, 7, y) * 0.8, 0, 1);
        c2.copy(pal.forestA).lerp(pal.forestB, n2);
        c.lerp(c2, forest);
        c.lerp(pal.alpine, smoothstep(23, 31, y + n * 3));
        const rk = smoothstep(0.32, 0.52, slope + (n2 - 0.5) * 0.12);
        c2.copy(pal.rock).lerp(pal.rockDark, n);
        c.lerp(c2, rk);
        // 山區溪溝：濕潤、較暗
        const a = acc[k];
        if (a > 130 && y > 2.5) c.lerp(pal.wet, smoothstep(130, 900, a) * 0.75);
        // 主河道兩側的礫石灘（台灣河川的特色）
        const rd = rdist[k];
        if (y < 16 && rd < 9) {
          const wv = 2.6 * (1 + 0.6 * nz2(x * 0.2, z * 0.2));
          c.lerp(n2 > 0.5 ? pal.gravel : pal.gravelB, (1 - smoothstep(wv * 0.9, wv * 1.6 + 1.0, rd)) * (1 - smoothstep(0.08, 0.22, slope)));
        }
        if (cdist[k] < 1.6) c.lerp(pal.bank, 1 - smoothstep(0.6, 1.6, cdist[k]));
        // 海灘
        const beach = smoothstep(cx - 6.5, cx - 3.5, x) * (1 - smoothstep(1.4, 2.2, y));
        c.lerp(y < 0.25 ? pal.wetSand : pal.sand, clamp(beach, 0, 1));
        // 水田
        const paddy = (1 - smoothstep(0.03, 0.14, m)) * (1 - smoothstep(0.035, 0.07, slope)) * (1 - smoothstep(4.5, 6, y))
          * smoothstep(riverWAt(sMouth) + 3.5, riverWAt(sMouth) + 6, rd) * smoothstep(2.6, 4, cdist[k]) * (1 - smoothstep(cx - 9, cx - 6, x));
        tPaddy[k] = paddy * (waterLevel[k] > -999 ? 0 : 1);
      }
      if (streamMask[k]) {
        const bed = streamMask[k] === 2;
        c.lerp(c2.copy(pal.wet).multiplyScalar(bed ? 0.7 : 0.85), bed ? 0.75 : 0.35);
      }
      const occl = 0.42 + 0.58 * ao[k];
      tCol[k * 3] = c.r * occl; tCol[k * 3 + 1] = c.g * occl; tCol[k * 3 + 2] = c.b * occl;
    }
  }
  // 窪地周圍不畫水田
  for (const p of ponds) {
    const r = p.r * 2.2;
    for (let j = Math.max(0, Math.floor((p.z - r - z0) / dx)); j <= Math.min(nz - 1, Math.ceil((p.z + r - z0) / dx)); j++)
      for (let i = Math.max(0, Math.floor((p.x - r - x0) / dx)); i <= Math.min(nx - 1, Math.ceil((p.x + r - x0) / dx)); i++) {
        const d = Math.hypot(X(i) - p.x, Z(j) - p.z);
        tPaddy[j * nx + i] *= smoothstep(p.r * 1.4, r, d);
      }
  }
  // 窪地：水下是深色淤泥，水邊一圈濕土
  for (const p of ponds) {
    const r = p.r * 1.7;
    for (let j = Math.max(0, Math.floor((p.z - r - z0) / dx)); j <= Math.min(nz - 1, Math.ceil((p.z + r - z0) / dx)); j++)
      for (let i = Math.max(0, Math.floor((p.x - r - x0) / dx)); i <= Math.min(nx - 1, Math.ceil((p.x + r - x0) / dx)); i++) {
        const k = j * nx + i, below = p.level - h[k];
        if (below < -0.22) continue;
        const fall = 1 - smoothstep(p.r * 1.15, p.r * 1.6, Math.hypot(X(i) - p.x, Z(j) - p.z));   // 只在窪地周圍，不要染出方形
        const mud = smoothstep(-0.22, -0.02, below) * fall, deep = smoothstep(0.0, 0.18, below) * fall;
        const n = 0.85 + 0.3 * (0.5 + 0.5 * nz2(X(i) * 0.9, Z(j) * 0.9));
        c.setRGB(tCol[k * 3], tCol[k * 3 + 1], tCol[k * 3 + 2]);
        c.lerp(c2.setRGB(0.2 * n, 0.19 * n, 0.13 * n), mud * 0.65).lerp(c2.setRGB(0.13, 0.12, 0.085), deep * 0.8);
        tCol[k * 3] = c.r; tCol[k * 3 + 1] = c.g; tCol[k * 3 + 2] = c.b;
      }
  }
  // 聚落（公路、橋、房子）：先規劃，順便改地表顏色、清掉路和房子底下的水田
  const village = planVillage(T, { H, slopeAt: (k) => 1 - tNor[k * 3 + 1], paddy: tPaddy, tCol, riverHalf: riverWAt(sMouth), streamMask });
  for (const k of village.touched) {
    const i = k % nx, j = (k / nx) | 0;
    tPos[k * 3 + 1] = h[k];
    for (const kk of [k, k - 1, k + 1, k - nx, k + nx]) {
      const ii = kk % nx, jj = (kk / nx) | 0;
      if (ii < 1 || jj < 1 || ii >= nx - 1 || jj >= nz - 1) continue;
      const gx = (h[kk + 1] - h[kk - 1]) / (2 * dx), gz = (h[kk + nx] - h[kk - nx]) / (2 * dx), il = 1 / Math.hypot(gx, 1, gz);
      tNor[kk * 3] = -gx * il; tNor[kk * 3 + 1] = il; tNor[kk * 3 + 2] = -gz * il;
    }
    void i; void j;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
    idx[q++] = a; idx[q++] = cc; idx[q++] = b; idx[q++] = b; idx[q++] = cc; idx[q++] = d;
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tGeo.setAttribute('normal', new THREE.BufferAttribute(tNor, 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tGeo.setAttribute('uv', new THREE.BufferAttribute(tUv, 2));
  tGeo.setAttribute('aPaddy', new THREE.BufferAttribute(tPaddy, 1));
  tGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tGeo.computeBoundingSphere();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, metalness: 0, normalMap: detailNormal, normalScale: new THREE.Vector2(0.32, 0.32),
  });
  terrainMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaddy;\nvarying float vPaddy;\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaddy = aPaddy;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPaddy;\nvarying vec3 vWPos;\nvarying vec3 vWN;\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pWater = 0.0;
        {
          float mn = vnoise(vWPos.xz * 1.6) * 0.6 + vnoise(vWPos.xz * 5.3) * 0.4;
          diffuseColor.rgb *= 0.88 + 0.24 * mn;
          // 陡坡岩壁：順坡向下的雨痕條紋、裂隙暗紋，避免一整片灰
          float steep = 1.0 - smoothstep(0.6, 0.8, vWN.y);
          if (steep > 0.01) {
            vec2 dn = normalize(vWN.xz + 1e-4);
            float across = dot(vWPos.xz, vec2(-dn.y, dn.x));
            float streak = vnoise(vec2(across * 2.2, vWPos.y * 0.35)) * 0.65 + vnoise(vec2(across * 7.0, vWPos.y * 0.9)) * 0.35;
            float crack = smoothstep(0.62, 0.8, vnoise(vec2(across * 1.3, vWPos.y * 2.4)));
            vec3 rk = diffuseColor.rgb * (0.74 + 0.4 * streak) * (1.0 - 0.32 * crack);
            diffuseColor.rgb = mix(diffuseColor.rgb, rk, steep);
          }
          if (vPaddy > 0.01) {
            float ca = 0.35; float sa = sin(ca), co = cos(ca);
            vec2 q = vec2(vWPos.x * co + vWPos.z * sa, -vWPos.x * sa + vWPos.z * co);
            vec2 cell = vec2(2.7, 1.8);
            vec2 id = floor(q / cell);
            vec2 f = fract(q / cell);
            float r = hash12(id + 17.0);
            vec3 fc = r < 0.36 ? vec3(0.27, 0.42, 0.09) : r < 0.62 ? vec3(0.19, 0.33, 0.07) : r < 0.80 ? vec3(0.13, 0.22, 0.19) : vec3(0.40, 0.40, 0.14);
            fc *= 0.93 + 0.07 * sin(q.y / cell.y * 6.2831 * 9.0);
            vec2 e = min(f, 1.0 - f) * cell;
            float dike = 1.0 - smoothstep(0.025, 0.07, min(e.x, e.y));
            bool flooded = r >= 0.62 && r < 0.80;
            // 剛插秧的水田：水面上一排排小秧苗
            float seed = 0.0;
            if (flooded) {
              vec2 g = fract(vec2(q.x * 6.0, q.y * 3.6)) - 0.5;
              seed = 1.0 - smoothstep(0.08, 0.2, length(g * vec2(1.0, 1.7)));
              fc = mix(fc, vec3(0.24, 0.38, 0.09), seed);
            }
            vec3 col = mix(fc, vec3(0.28, 0.33, 0.14) * (0.85 + 0.3 * mn), dike);
            diffuseColor.rgb = mix(diffuseColor.rgb, col, vPaddy);
            pWater = flooded ? vPaddy * (1.0 - dike) * (1.0 - 0.85 * seed) : 0.0;
          }
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, pWater);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, pWater * 0.9));');
  };
  const terrain = new THREE.Mesh(tGeo, terrainMat);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);

  // ---------- 切面（土層、地下水位）----------
  const strataMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uBottom: { value: bottom }, uTime: timeUniform, uGwHi: { value: 0 }, uUnsat: { value: 0 }, uFocusX: { value: -16 }, uLight: { value: 1.0 } },
    vertexShader: `attribute float aSurf, aGwt, aSoil, aU; varying float vSurf, vGwt, vSoil, vU; varying vec3 vPos, vN;
      void main(){ vSurf = aSurf; vGwt = aGwt; vSoil = aSoil; vU = aU; vPos = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uBottom, uTime, uGwHi, uUnsat, uFocusX, uLight; varying float vSurf, vGwt, vSoil, vU; varying vec3 vPos, vN;
      ${GLSL_NOISE}
      ${GLSL_FACE}
      vec2 hash22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      // 細胞雜訊：回傳 (到最近點的距離, 該格亂數)，用來畫礫石
      vec2 cellN(vec2 p){ vec2 i = floor(p), f = fract(p); float md = 8.0, id = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 r = g + hash22(i + g) - f; float d = dot(r, r); if (d < md) { md = d; id = hash12(i + g); } }
        return vec2(sqrt(md), id); }
      void main(){
        float y = vPos.y, u = vU;
        float depth = vSurf - y;
        float grain = vnoise(vec2(u, y) * 40.0) * 0.7 + vnoise(vec2(u, y) * 97.0) * 0.3;
        // ---- 沖積層：礫石、砂、黏土互層，層面略有起伏 ----
        float yb = y + 0.7 * (fbm2(vec2(u * 0.035, 1.7)) - 0.5) * 2.0 + 0.25 * sin(u * 0.09);
        float bedT = 2.1;
        float bi = floor(yb / bedT);
        float bf = fract(yb / bedT);
        float br = hash12(vec2(bi, 7.0));
        vec3 alluv;
        if (br < 0.36) {        // 礫石層
          vec2 c = cellN(vec2(u, y) * 3.2);
          float rr = 0.30 + 0.12 * c.y;
          float peb = 1.0 - smoothstep(rr - 0.05, rr, c.x);
          float rim = smoothstep(rr - 0.12, rr - 0.04, c.x) * peb;
          vec3 pc = mix(vec3(0.45, 0.43, 0.40), vec3(0.62, 0.55, 0.45), c.y);
          alluv = mix(vec3(0.42, 0.35, 0.24), pc * (1.0 - 0.35 * rim), peb);
        } else if (br < 0.72) { // 砂層：細顆粒、斜層理
          alluv = vec3(0.60, 0.49, 0.31) * (0.92 + 0.12 * grain) * (0.97 + 0.03 * sin((y + u * 0.3) * 24.0));
        } else {                // 黏土層：細緻、水平紋理
          alluv = vec3(0.43, 0.27, 0.17) * (0.96 + 0.04 * sin(y * 34.0)) * (0.97 + 0.05 * grain);
        }
        alluv *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.035, bf)); // 層面接觸線
        // ---- 基岩：用拉長的細胞邊界畫出塊狀節理（不規則、不會像網格）----
        vec2 rp = vec2(u * 0.3, y * 0.62) + vec2(fbm2(vec2(u, y) * 0.12), fbm2(vec2(y, u) * 0.12)) * 1.1;
        vec2 ci = floor(rp), cf = fract(rp);
        float f1 = 8.0, f2 = 8.0; float cid = 0.0;
        for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
          vec2 g = vec2(float(xx), float(yy)); vec2 r = g + hash22(ci + g) - cf; float d = dot(r, r);
          if (d < f1) { f2 = f1; f1 = d; cid = hash12(ci + g); } else if (d < f2) { f2 = d; }
        }
        float edge = sqrt(f2) - sqrt(f1);
        float joint = (1.0 - smoothstep(0.0, 0.035, edge)) * smoothstep(0.35, 0.6, vnoise(vec2(u, y) * 0.4 + cid * 7.0));
        float bedding = 0.95 + 0.05 * sin((y + u * 0.18) * 5.0 + fbm2(vec2(u, y) * 0.5) * 3.0);
        vec3 rock = mix(vec3(0.40, 0.39, 0.37), vec3(0.34, 0.335, 0.32), cid) * bedding * (0.9 + 0.1 * vnoise(vec2(u, y) * 2.5)) * (0.95 + 0.06 * grain);
        rock = mix(rock, vec3(0.16, 0.16, 0.155), joint * 0.55);
        // ---- 土層組合 ----
        float bedTop = vSurf - vSoil + (fbm2(vec2(u * 0.2, 3.0)) - 0.5) * 1.8;
        vec3 col = mix(alluv, rock, smoothstep(bedTop + 0.3, bedTop - 0.3, y));
        // 表土：深褐、帶根系的細紋
        float topT = 0.65 + 0.3 * fbm2(vec2(u * 0.4, 9.0));
        vec3 topsoil = vec3(0.17, 0.105, 0.055) * (0.85 + 0.25 * grain);
        col = mix(col, topsoil, 1.0 - smoothstep(topT - 0.08, topT + 0.08, depth));
        // ---- 地下水 ----
        float sat = smoothstep(vGwt + 0.04, vGwt - 0.08, y);
        vec2 pc = cellN(vec2(u, y) * 9.0);
        float pore = (1.0 - smoothstep(0.1, 0.2, pc.x)) * step(0.62, pc.y);   // 飽和層的孔隙水：圓點
        vec3 satCol = col * vec3(0.66, 0.82, 1.06) + vec3(0.0, 0.025, 0.08) + pore * vec3(0.04, 0.10, 0.2);
        float rockness = smoothstep(bedTop + 0.3, bedTop - 0.3, y);
        col = mix(col, satCol, sat * mix(0.9, 0.5, rockness));
        col += uGwHi * sat * vec3(0.0, 0.05, 0.12) * (0.55 + 0.45 * sin(uTime * 1.6 + u * 0.5 - y * 0.7));
        float fringe = smoothstep(vGwt + 0.5, vGwt + 0.04, y) * (1.0 - sat);
        col = mix(col, col * vec3(0.86, 0.92, 1.02), fringe * 0.6);
        // 滲漏：未飽和層（表土以下、地下水位以上）亮起，濕潤紋一道道往下移動
        if (uUnsat > 0.001) {
          float unsat = smoothstep(topT, topT + 0.12, depth) * smoothstep(vGwt - 0.02, vGwt + 0.12, y);
          float near = 1.0 - smoothstep(4.0, 9.0, abs(u - uFocusX));
          float band = smoothstep(0.55, 1.0, sin((y + uTime * 0.9) * 5.0 + vnoise(vec2(u * 1.3, 2.0)) * 2.0));
          col = mix(col, col * 1.18 + vec3(0.02, 0.05, 0.10), unsat * uUnsat * 0.6);
          col += vec3(0.10, 0.30, 0.65) * band * unsat * near * uUnsat * 0.45;
        }
        float wl = 1.0 - smoothstep(0.035, 0.09, abs(y - vGwt));
        col = mix(col, vec3(0.12, 0.58, 1.0), wl * step(0.0, depth - 0.05) * (1.0 + uUnsat * 0.0));
        col += vec3(0.10, 0.45, 1.0) * wl * uUnsat * 0.6 * step(0.0, depth - 0.05);
        col *= mix(0.8, 1.0, smoothstep(uBottom, uBottom + 10.0, y));
        col = mix(col, col * 1.45, 1.0 - smoothstep(0.0, 0.06, depth));
        col *= faceLight(vN, depth, y - uBottom);
        gl_FragColor = vec4(col * uLight, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const waterCutMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    uniforms: { uTime: timeUniform },
    vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec3 vPos;
      void main(){
        float d = -vPos.y;
        vec3 col = mix(vec3(0.05, 0.27, 0.34), vec3(0.006, 0.04, 0.085), smoothstep(0.0, 14.0, d));
        float rays = 0.5 + 0.5 * sin(vPos.x * 0.6 + vPos.z * 0.6 + d * 0.35 + uTime * 0.35);
        col += vec3(0.015, 0.04, 0.05) * rays * exp(-d * 0.22);
        col = mix(col, vec3(0.55, 0.8, 0.9), 1.0 - smoothstep(0.0, 0.06, d));
        gl_FragColor = vec4(col, 0.88);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  function buildFace(side) {
    const cols = [];
    if (side === 'front' || side === 'back') {
      const j = side === 'front' ? nz - 1 : 0;
      for (let i = 0; i < nx; i++) cols.push([X(i), Z(j), j * nx + i, X(i)]);
    } else {
      const i = side === 'left' ? 0 : nx - 1;
      for (let j = 0; j < nz; j++) cols.push([X(i), Z(j), j * nx + i, Z(j)]);
    }
    const n = cols.length;
    const pos = new Float32Array(n * 2 * 3), surf = new Float32Array(n * 2), gw = new Float32Array(n * 2), so = new Float32Array(n * 2), uu = new Float32Array(n * 2);
    const wPos = [];
    cols.forEach(([x, z, k, u], c2i) => {
      const top = h[k];
      pos.set([x, top, z, x, bottom, z], c2i * 6);
      surf[c2i * 2] = surf[c2i * 2 + 1] = top;
      gw[c2i * 2] = gw[c2i * 2 + 1] = top < 0 ? 0 : gwt[k];
      so[c2i * 2] = so[c2i * 2 + 1] = soil[k];
      uu[c2i * 2] = uu[c2i * 2 + 1] = u;
      wPos.push([x, z, top]);
    });
    const ind = faceIndex(n, side === 'back' || side === 'right');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 1));
    g.setAttribute('aGwt', new THREE.BufferAttribute(gw, 1));
    g.setAttribute('aSoil', new THREE.BufferAttribute(so, 1));
    g.setAttribute('aU', new THREE.BufferAttribute(uu, 1));
    g.setIndex(ind);
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, strataMat));
    // 海水切面
    const wp = [], wi = [];
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const base = wp.length / 3;
        run.forEach(([x, z, top]) => wp.push(x, top, z, x, 0, z));
        for (let r = 0; r < run.length - 1; r++) { const a = base + r * 2; wi.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      }
      run = [];
    };
    for (const p of wPos) { if (p[2] < 0) run.push(p); else flush(); }
    flush();
    if (wp.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
      wg.setIndex(wi);
      const wm = new THREE.Mesh(wg, waterCutMat);
      wm.renderOrder = 2;
      scene.add(wm);
    }
  }
  ['front', 'back', 'left', 'right'].forEach(buildFace);
  // 展示底座（帶倒角的木座）＋地面陰影
  addPlinth(scene, { x0, x1, z0, z1, bottom });

  // ---------- 水面材質 ----------
  // uMode：0 靜水（窪地）、1 流動（河川、溪流，帶狀 uv：x 橫向、y 沿流向）、2 海洋
  const rainUniform = { value: 0 };
  const mouth = river.find((p) => p.s >= sMouth) || river[river.length - 1];
  function waterMaterial({ mode = 0, shallow, deep, depthScale = 5, rough = 0.06, minA = 0.55, maxA = 0.93, edgeFoam = 0.6, env = 1.25 }) {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: rough, metalness: 0, transparent: true, normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: env, depthWrite: true,
    });
    const u = {
      uTime: timeUniform, uRain: rainUniform, uMode: { value: mode }, uDeep: { value: new THREE.Color(deep) }, uShallow: { value: new THREE.Color(shallow) },
      uMinA: { value: minA }, uMaxA: { value: maxA }, uDepthScale: { value: depthScale }, uEdge: { value: edgeFoam },
      uMouth: { value: new THREE.Vector2(mouth.x, mouth.z) }, uPlume: { value: new THREE.Color(0x8c9a6e) },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aDepth, aSpeed, aAcross, aFoam;
          uniform float uTime, uMode;
          varying float vDepth, vSpeed, vAcross, vFoam;
          varying vec3 vWP;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vDepth = aDepth; vSpeed = aSpeed; vAcross = aAcross; vFoam = aFoam;
          vWP = (modelMatrix * vec4(position, 1.0)).xyz;
          if (uMode > 1.5) {
            float sw = smoothstep(0.3, 2.5, aDepth);
            transformed.y += sw * (0.05 * sin(vWP.x * 0.45 + uTime * 1.1) + 0.035 * sin(vWP.x * 0.21 + vWP.z * 0.37 + uTime * 0.8));
          }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uMode, uMinA, uMaxA, uDepthScale, uRain, uEdge;
          uniform vec3 uDeep, uShallow, uPlume;
          uniform vec2 uMouth;
          varying float vDepth, vSpeed, vAcross, vFoam;
          varying vec3 vWP;
          ${GLSL_NOISE}
          // 雨滴落在水面的漣漪（法線擾動）
          vec2 ripples(vec2 p, float t) {
            vec2 n = vec2(0.0); vec2 cell = floor(p);
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 c = cell + vec2(float(i), float(j));
              vec2 ctr = c + vec2(hash12(c + 3.1), hash12(c + 7.7));
              float ph = fract(t * 0.85 + hash12(c));
              vec2 dv = p - ctr; float r = length(dv);
              float ring = r - ph * 0.85;
              float amp = (1.0 - ph) * (1.0 - smoothstep(0.0, 0.14, abs(ring)));
              n += (dv / (r + 1e-4)) * cos(ring * 42.0) * amp;
            }
            return n;
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float foam = 0.0;
          vec3 base = mix(uShallow, uDeep, smoothstep(0.0, uDepthScale, vDepth));
          float alpha = mix(uMinA, uMaxA, smoothstep(0.0, 2.2, vDepth));
          if (uMode < 0.5) { if (vDepth <= 0.0) discard; alpha = mix(0.35, uMaxA, smoothstep(0.0, 0.5, vDepth)) * smoothstep(0.0, 0.06, vDepth); }
          if (uMode > 0.5 && uMode < 1.5) {
            // 流動：陡處白水、兩岸細泡沫，泡沫紋理順流移動
            vec2 fp = vec2(vNormalMapUv.x * 7.0, vNormalMapUv.y * 3.5 - uTime * vSpeed * 1.6);
            float n = vnoise(fp) * 0.6 + vnoise(fp * 2.3) * 0.4;
            float edge = 1.0 - smoothstep(0.0, 0.2, min(vAcross, 1.0 - vAcross));
            foam = clamp(vFoam * smoothstep(0.4, 0.8, n) * 1.1 + edge * smoothstep(0.45, 0.8, n) * uEdge, 0.0, 1.0);
          } else if (uMode > 1.5) {
            // 海：碎浪一道道往岸邊推、河口有混濁的出流
            float shore = 1.0 - smoothstep(0.0, 2.2, vDepth);
            float wv = sin(vDepth * 3.6 - uTime * 1.25 + vnoise(vWP.xz * 0.25) * 4.0);
            float bands = smoothstep(0.82, 1.0, wv) * (0.6 + 0.4 * vnoise(vWP.xz * 1.5 + uTime * 0.2));
            foam = shore * bands + (1.0 - smoothstep(0.0, 0.22, vDepth)) * (0.55 + 0.45 * vnoise(vWP.xz * 2.0 + uTime * 0.3));
            float pl = exp(-length(vWP.xz - uMouth) / 8.0) * (1.0 - smoothstep(1.5, 7.0, vDepth));
            base = mix(base, uPlume, pl * 0.7);
          }
          diffuseColor.rgb = mix(base, vec3(0.93, 0.96, 0.96), foam * 0.85);
          diffuseColor.a = max(alpha, foam * 0.92);
          if (uMode > 0.5 && uMode < 1.5) diffuseColor.a *= 1.0 - smoothstep(-1.0, 2.5, vWP.x - uMouth.x);
          if (diffuseColor.a < 0.02) discard;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.75, foam);')
        .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
          vec3 mapN;
          if (uMode > 0.5 && uMode < 1.5) {
            // 雙相位流向貼圖：沿 uv.y 順流，避免長時間拉伸
            float t1 = fract(uTime * 0.5), t2 = fract(uTime * 0.5 + 0.5);
            float sp = vSpeed * 0.9;
            vec3 nA = texture2D(normalMap, vNormalMapUv + vec2(0.0, -t1 * sp)).xyz * 2.0 - 1.0;
            vec3 nB = texture2D(normalMap, vNormalMapUv * 1.31 + vec2(0.37, -t2 * sp)).xyz * 2.0 - 1.0;
            mapN = normalize(mix(nB, nA, 1.0 - abs(1.0 - 2.0 * t1)));
            mapN.xy *= 1.0 + vFoam;
          } else {
            vec2 fa = vec2(uTime * 0.011, uTime * 0.007), fb = vec2(-uTime * 0.008, uTime * 0.012);
            vec3 m1 = texture2D(normalMap, vNormalMapUv + fa).xyz * 2.0 - 1.0;
            vec3 m2 = texture2D(normalMap, vNormalMapUv * 1.73 + fb).xyz * 2.0 - 1.0;
            mapN = normalize(vec3(m1.xy + m2.xy, m1.z));
            if (uMode > 1.5) mapN.xy += 0.25 * vec2(cos(vWP.x * 0.45 + uTime * 1.1), 0.0) * smoothstep(0.3, 2.5, vDepth);
          }
          if (uRain > 0.01) mapN.xy += ripples(vWP.xz * 1.6, uTime) * uRain * 0.55 * (uMode > 1.5 ? 0.4 : 1.0);`);
    };
    return m;
  }
  const fillAttr = (g, name, v) => { if (!g.attributes[name]) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); };

  // 海洋
  {
    const xs = Math.min(...coast) - 6, segX = Math.round((x1 - xs) / 0.4), segZ = Math.round((z1 - z0) / 0.4);
    const g = new THREE.PlaneGeometry(x1 - xs, z1 - z0, segX, segZ);
    g.rotateX(-Math.PI / 2);
    g.translate((xs + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position;
    const dep = new Float32Array(p.count), uv = g.attributes.uv;
    for (let v = 0; v < p.count; v++) {
      dep[v] = Math.max(0, -H(p.getX(v), p.getZ(v)));
      uv.setXY(v, p.getX(v) * 0.06, p.getZ(v) * 0.06);
    }
    g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
    ['aSpeed', 'aAcross', 'aFoam'].forEach((a) => fillAttr(g, a, 0));
    const ocean = new THREE.Mesh(g, waterMaterial({ mode: 2, shallow: 0x55b8b5, deep: 0x123f5c, minA: 0.42, maxA: 0.95 }));
    ocean.renderOrder = 3;
    ocean.receiveShadow = true;
    scene.add(ocean);
  }

  // 帶狀水面：pts 需要 {x, z, s, level, w}；speed（世界單位／秒）、foam（0–1）可選
  function ribbon(pts, { extra = 0.3, yOff = 0.015 } = {}) {
    const pos = [], dep = [], uv = [], ind = [], spd = [], acr = [], fm = [];
    let base = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const nxv = -tz, nzv = tx;
      const p = pts[k], w = p.w + extra, y = p.level + yOff;
      pos.push(p.x + nxv * w, y, p.z + nzv * w, p.x, y, p.z, p.x - nxv * w, y, p.z - nzv * w);
      dep.push(0.05, 0.6 + p.w * 0.5, 0.05);
      const v = p.s * 0.09;
      uv.push(0, v, w * 0.09, v, 2 * w * 0.09, v);
      const sp = (p.speed ?? 2) * 0.09;
      spd.push(sp, sp, sp);
      acr.push(0, 0.5, 1);
      const f = p.foam ?? 0;
      fm.push(f, f, f);
      if (k < pts.length - 1) {
        const o = base + k * 3;
        ind.push(o, o + 3, o + 1, o + 1, o + 3, o + 4, o + 1, o + 4, o + 2, o + 2, o + 4, o + 5);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    g.setAttribute('aSpeed', new THREE.Float32BufferAttribute(spd, 1));
    g.setAttribute('aAcross', new THREE.Float32BufferAttribute(acr, 1));
    g.setAttribute('aFoam', new THREE.Float32BufferAttribute(fm, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ind);
    g.computeVertexNormals();
    return g;
  }
  // 依水面坡度給流速與白水
  function withFlow(line, { vMin = 1.2, vMax = 5.5, foamK = 1 } = {}) {
    return line.map((p, k) => {
      const a = line[Math.max(0, k - 3)], b = line[Math.min(line.length - 1, k + 3)];
      const slope = Math.max(0, (a.level - b.level) / Math.max(0.05, b.s - a.s));
      return { ...p, speed: lerp(vMin, vMax, smoothstep(0.0, 0.25, slope)), foam: foamK * smoothstep(0.06, 0.3, slope) };
    });
  }
  const riverMat = waterMaterial({ mode: 1, shallow: 0x79a497, deep: 0x2f6a72, minA: 0.55, maxA: 0.92 });
  riverMat.depthWrite = false;   // 河口那段和海面重疊：不寫深度，才不會把底下的海面擋掉、露出海底
  const riverLine = withFlow(river.filter((p) => p.s <= sMouth + 4));
  const riverMesh = new THREE.Mesh(ribbon(riverLine), riverMat);
  const creekMesh = new THREE.Mesh(ribbon(withFlow(creek, { vMin: 0.8, vMax: 2.5 }), { extra: 0.2 }), riverMat);
  riverMesh.renderOrder = creekMesh.renderOrder = 3;
  scene.add(riverMesh, creekMesh);

  // 山區溪流（水路在前面已經決定、溪床也刻好了）
  {
    const geos = streamLines.map((l) => ribbon(withFlow(l, { vMin: 1.5, vMax: 6, foamK: 0.35 }), { extra: 0.04, yOff: 0.02 }));
    if (geos.length) {
      const streamMat = waterMaterial({ mode: 1, shallow: 0x3c5c52, deep: 0x1d3d42, minA: 0.88, maxA: 0.96, edgeFoam: 0.1, env: 0.35, rough: 0.25 });
      const streams = new THREE.Mesh(mergeGeometries(geos), streamMat);
      streams.renderOrder = 3;
      scene.add(streams);
    }
  }

  // 窪蓄的水窪
  const pondMat = waterMaterial({ mode: 0, shallow: 0x6d7d62, deep: 0x2f4f4a, depthScale: 0.6, minA: 0.0, maxA: 0.86 });
  for (const p of ponds) {
    // 有好幾圈的圓盤：水深取自真正的地形，水邊就跟著地形起伏，不會是一個硬邊的圓
    const g = new THREE.RingGeometry(0.001, p.r * 1.45, 64, 14);
    g.rotateX(-Math.PI / 2);
    const pp = g.attributes.position, uv = g.attributes.uv;
    const dep = new Float32Array(pp.count);
    for (let v = 0; v < pp.count; v++) {
      dep[v] = (p.level - H(pp.getX(v) + p.x, pp.getZ(v) + p.z)) * 3.0;
      uv.setXY(v, (pp.getX(v) + p.x) * 0.09, (pp.getZ(v) + p.z) * 0.09);
    }
    g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
    ['aSpeed', 'aAcross', 'aFoam'].forEach((a) => fillAttr(g, a, 0));
    const m = new THREE.Mesh(g, pondMat);
    m.position.set(p.x, p.level + 0.01, p.z);
    m.renderOrder = 3;
    scene.add(m);
  }

  const villageApi = buildVillage(scene, village);

  // ---------- 樹木：針葉、闊葉、檳榔、灌木 ----------
  const trees = [];
  // 遠處的樹用簡化模型；做影片（網址有 ?capture）時關掉
  const treeLOD = new TreeLOD({ enabled: !capture && !new URLSearchParams(location.search).has('capture') });
  let heroSpot = null;
  const heroWet = { value: 0 };
  {
    const species = {
      conA: { geo: coniferGeometry(11), lo: coniferGeometry(11, 1), top: 1.6, list: [] },
      conB: { geo: coniferGeometry(29), lo: coniferGeometry(29, 1), top: 1.6, list: [] },
      brA: { geo: broadleafGeometry(5), lo: broadleafGeometry(5, 1), top: 1.45, list: [] },
      brB: { geo: broadleafGeometry(17), lo: broadleafGeometry(17, 1), top: 1.45, list: [] },
      palm: { geo: palmGeometry(3), top: 2.1, list: [], double: true },
      shrub: { geo: shrubGeometry(7), top: 0.4, list: [] },
    };
    const maxN = { high: 7800, medium: 4500, low: 2400 }[quality];
    // 截留的主角樹：在前緣找一塊平坦、不在水邊的空地
    {
      let best = null, bd = Infinity;
      for (let z = 33; z <= 38.5; z += 0.25) for (let x = -27; x <= -11; x += 0.25) {
        const k = Math.round((z - z0) / dx) * nx + Math.round((x - x0) / dx);
        const y = h[k], slope = 1 - tNor[k * 3 + 1];
        if (y < 2 || slope > 0.12 || waterLevel[k] > -999 || cdist[k] < 3 || tPaddy[k] > 0.05 || acc[k] > 200) continue;
        if (rdist[k] < riverWAt(sMouth) + 3) continue;
        const d = Math.hypot(x + 19, z - 36.5);
        if (d < bd) { bd = d; best = { x, z, y }; }
      }
      heroSpot = best || { x: -19, z: 36.5, y: H(-19, 36.5) };
    }
    let count = 0;
    for (let t = 0; t < maxN * 8 && count < maxN; t++) {
      const x = x0 + 1 + rand() * (x1 - x0 - 2), z = z0 + 1 + rand() * (z1 - z0 - 2);
      if (Math.hypot(x - heroSpot.x, z - heroSpot.z) < 2.8) continue;
      const fi = (x - x0) / dx, fj = (z - z0) / dx;
      const k = Math.round(fj) * nx + Math.round(fi);
      const y = sampleBilinear(h, nx, nz, fi, fj);
      if (y < 1.0 || y > 31 || waterLevel[k] > -999 || tPaddy[k] > 0.25) continue;
      const slope = 1 - tNor[k * 3 + 1];
      if (slope > 0.45) continue;
      if (rdist[k] < riverWAt(sMouth) + 1.6 && y < 12) continue;
      if (cdist[k] < 0.9) continue;
      if (streamMask[k]) continue; // 不長在溪床與溪岸
      if (x > coast[Math.round(fj)] - 4) continue;
      if (village.built[k]) continue;
      const m = mount[k];
      const forestN = nz2(x * 0.06, z * 0.06);
      const hill = m > 0.12 || y > 5;
      const dens = hill
        ? 0.6 + 0.4 * smoothstep(-0.25, 0.35, forestN) - smoothstep(25, 31, y)
        : (cdist[k] < 3.2 ? 0.8 : 0.0) + 0.65 * smoothstep(0.35, 0.6, nz2(x * 0.08 + 50, z * 0.08));
      if (rand() > dens) continue;
      const s = 0.8 + rand() * 0.6;
      const item = { x, y, z, s, rot: rand() * Math.PI * 2, tint: 0.82 + rand() * 0.3, hue: (rand() - 0.5) * 0.06 };
      let sp;
      const r = rand();
      if (y > 13 && m > 0.3) sp = r < 0.82 ? (r < 0.41 ? 'conA' : 'conB') : (r < 0.92 ? 'brA' : 'shrub');
      else if (y > 9 && m > 0.2) sp = r < 0.3 ? 'conA' : r < 0.85 ? (r < 0.58 ? 'brA' : 'brB') : 'shrub';
      else if (y < 9 && y > 2.2 && slope < 0.32 && nz2(x * 0.11 + 9, z * 0.11 - 4) > 0.42) sp = r < 0.85 ? 'palm' : 'shrub';
      else sp = r < 0.8 ? (r < 0.4 ? 'brA' : 'brB') : 'shrub';
      species[sp].list.push(item);
      count++;
    }
    const sun3 = sunDir.clone();
    const matF = treeMaterial({ time: timeUniform, sunDir: sun3 });
    const matD = treeMaterial({ time: timeUniform, sunDir: sun3, side: THREE.DoubleSide, wind: 0.05 });
    treeMats.push(matF, matD);
    const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    for (const sp of Object.values(species)) {
      if (!sp.list.length) continue;
      const items = sp.list.map((t2) => {
        e.set((rand() - 0.5) * 0.06, t2.rot, (rand() - 0.5) * 0.06); qq.setFromEuler(e);
        mtx.compose(new THREE.Vector3(t2.x, t2.y - 0.05, t2.z), qq, new THREE.Vector3(t2.s, t2.s * (0.92 + 0.25 * (t2.tint - 0.82)), t2.s));
        col.setRGB(t2.tint * (1 - t2.hue), t2.tint, t2.tint * (1 + t2.hue * 2));
        trees.push({ ...t2, top: sp.top * t2.s });
        return { x: t2.x, z: t2.z, matrix: mtx.clone(), color: col.clone() };
      });
      for (const mesh of chunkedInstances(sp.geo, sp.double ? matD : matF, items, 24, sp.lo, treeLOD)) scene.add(mesh);
    }
    {
      const s = 1.9;
      const hm = new THREE.Mesh(broadleafGeometry(5), treeMaterial({ time: timeUniform, sunDir: sun3, wet: heroWet }));
      hm.position.set(heroSpot.x, heroSpot.y - 0.05, heroSpot.z);
      hm.scale.setScalar(s); hm.rotation.y = 0.6;
      hm.castShadow = true; hm.receiveShadow = true;
      scene.add(hm);
      trees.push({ x: heroSpot.x, y: heroSpot.y, z: heroSpot.z, s, rot: 0.6, tint: 1, hue: 0, top: 1.45 * s, hero: true });
      // 樹冠正下方：雨水滴落把地面打濕
      const R = 0.95 * s;
      for (let j = Math.max(0, Math.floor((heroSpot.z - R - z0) / dx)); j <= Math.min(nz - 1, Math.ceil((heroSpot.z + R - z0) / dx)); j++)
        for (let i = Math.max(0, Math.floor((heroSpot.x - R - x0) / dx)); i <= Math.min(nx - 1, Math.ceil((heroSpot.x + R - x0) / dx)); i++) {
          const d = Math.hypot(X(i) - heroSpot.x, Z(j) - heroSpot.z) / R;
          if (d >= 1) continue;
          const kk = j * nx + i, f = 1 - 0.28 * (1 - d * d);
          tCol[kk * 3] *= f * 0.97; tCol[kk * 3 + 1] *= f * 0.99; tCol[kk * 3 + 2] *= f * 1.05;
        }
    }
    // 樹下的地面比較暗（林蔭與落葉）
    const colAttr = tGeo.attributes.color;
    for (const t2 of trees) {
      const R = 0.75 * t2.s;
      const i0 = Math.max(0, Math.floor((t2.x - R - x0) / dx)), i1 = Math.min(nx - 1, Math.ceil((t2.x + R - x0) / dx));
      const j0 = Math.max(0, Math.floor((t2.z - R - z0) / dx)), j1 = Math.min(nz - 1, Math.ceil((t2.z + R - z0) / dx));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(X(i) - t2.x, Z(j) - t2.z) / R;
        if (d >= 1) continue;
        const kk = j * nx + i, f = 1 - 0.16 * (1 - d * d);
        tCol[kk * 3] *= f; tCol[kk * 3 + 1] *= f; tCol[kk * 3 + 2] *= f * 1.01;
      }
    }
    colAttr.needsUpdate = true;
  }

  // ---------- 雲 ----------
  const CLOUD_TOP = 47, CLOUD_BASE = 39;
  function billboardMaterial(frag, extraUniforms = {}) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: timeUniform, uTex: { value: puffTex }, ...extraUniforms },
      vertexShader: `attribute vec3 aC; attribute vec4 aP; uniform float uTime; varying vec2 vUv; varying vec4 vP; varying float vF; varying float vCy; varying float vNear;
        void main(){
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          // aP: x 尺寸, y 明暗/種類, z 相位, w 上升高度（0 表示雲）
          float f = aP.w > 0.0 ? fract(aP.z + uTime * 0.045) : 0.0;
          vec3 c = aC + (aP.w > 0.0 ? vec3(-f * 2.5, f * aP.w, 0.0) : vec3(sin(uTime * 0.03 + aP.z * 6.0) * 0.8, 0.0, cos(uTime * 0.025 + aP.z * 5.0) * 0.5));
          float s = aP.w > 0.0 ? aP.x * mix(0.5, 1.9, f) : aP.x;
          vec3 p = c + (right * position.x + up * position.y) * s;
          vUv = uv; vP = aP; vF = f; vCy = aC.y;
          vNear = smoothstep(s * 0.6, s * 2.2, length(cameraPosition - c));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: frag,
    });
  }
  function puffs(list, mat) {
    const g = new THREE.InstancedBufferGeometry();
    g.copy(new THREE.PlaneGeometry(1, 1));
    g.instanceCount = list.length;
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((p) => p.c)), 3));
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((p) => p.p)), 4));
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    return m;
  }
  const cloudMat = billboardMaterial(`uniform sampler2D uTex; uniform float uOpacity; uniform vec3 uSun; varying vec2 vUv; varying vec4 vP; varying float vCy; varying float vNear;
    void main(){
      float a0 = vP.z * 6.2831; mat2 R = mat2(cos(a0), -sin(a0), sin(a0), cos(a0));
      float a = texture2D(uTex, R * (vUv - 0.5) + 0.5).a;
      // 把每朵雲當成小球：用 uv 推出法線，依太陽方向打亮，雲底較暗、邊緣有銀邊
      vec2 q = (vUv - 0.5) * 2.0; float r2 = dot(q, q);
      vec3 nV = normalize(vec3(q, sqrt(max(0.0, 1.0 - r2)) + 0.25));
      vec3 nW = normalize(transpose(mat3(viewMatrix)) * nV);
      float lit = clamp(0.5 + 0.55 * dot(nW, uSun), 0.0, 1.0);
      float hgt = clamp((vCy - ${CLOUD_BASE.toFixed(1)}) / 7.0 + nW.y * 0.3, 0.0, 1.0);
      vec3 shade = mix(vec3(0.47, 0.52, 0.60), vec3(0.33, 0.37, 0.45), vP.y);
      vec3 col = mix(shade, vec3(0.92, 0.93, 0.94), lit * mix(0.45, 0.95, hgt));
      col += vec3(1.0, 0.97, 0.9) * pow(1.0 - nV.z, 3.0) * max(0.0, dot(nW, uSun)) * 0.25;
      gl_FragColor = vec4(col, a * uOpacity * vNear);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`, { uOpacity: { value: 0.93 }, uSun: { value: sunDir.clone() } });
  const cloudList = [];
  const clusters = [[-44, -12, 1.0], [-30, 12, 1.0], [-14, -22, 0.9], [-6, 18, 0.85], [6, -4, 0.7], [-50, 22, 0.8], [50, 6, 0.0], [44, -26, 0.0]];
  for (const [cx2, cz, storm] of clusters) {
    const npuff = storm > 0 ? 46 : 22;
    const rx = storm > 0 ? 11 : 7, rz = storm > 0 ? 8 : 5;
    for (let p = 0; p < npuff; p++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand());
      const px = cx2 + Math.cos(a) * r * rx, pz = cz + Math.sin(a) * r * rz;
      const py = CLOUD_BASE + 1.2 + (1 - r) * (storm > 0 ? 6.5 : 3.5) * rand() + rand() * 1.2;
      cloudList.push({ c: [px, py + (storm > 0 ? 0 : 4), pz], p: [5 + rand() * 6, storm, rand(), 0] });
    }
  }
  const clouds = puffs(cloudList, cloudMat);
  clouds.renderOrder = 8;
  scene.add(clouds);

  // ---------- 水氣（蒸發、蒸散）----------
  const vaporMat = billboardMaterial(`uniform sampler2D uTex; uniform float uEvap, uTransp; varying vec2 vUv; varying vec4 vP; varying float vF;
    void main(){
      float a = texture2D(uTex, vUv).a;
      float k = vP.y; // 0 蒸發, 1 蒸散
      float on = mix(uEvap, uTransp, k);
      vec3 col = mix(vec3(0.93, 0.97, 1.0), vec3(0.86, 0.97, 0.88), k);
      gl_FragColor = vec4(col, a * sin(3.14159 * vF) * 0.16 * on);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`, { uEvap: { value: 1 }, uTransp: { value: 1 } });
  const vaporList = [];
  for (let v = 0; v < 150; v++) { // 海面
    const z = z0 + 2 + rand() * (z1 - z0 - 4);
    const x = coast[Math.round((z - z0) / dx)] + 2 + rand() * (x1 - coast[Math.round((z - z0) / dx)] - 3);
    vaporList.push({ c: [x, 0.3, z], p: [2.4 + rand() * 2.6, 0, rand(), 9 + rand() * 9] });
  }
  for (let v = 0; v < 90; v++) { // 河川與窪地
    const p = rand() < 0.65 ? river[Math.floor(rand() * river.length * 0.95)] : null;
    if (p) vaporList.push({ c: [p.x, p.level + 0.2, p.z], p: [1.4 + rand() * 1.4, 0, rand(), 6 + rand() * 6] });
    else { const pd = ponds[Math.floor(rand() * ponds.length)]; vaporList.push({ c: [pd.x + (rand() - 0.5) * pd.r, pd.level + 0.2, pd.z + (rand() - 0.5) * pd.r], p: [0.7 + rand() * 0.8, 0, rand(), 5 + rand() * 5] }); }
  }
  for (let v = 0; v < 240 && trees.length; v++) { // 樹冠
    const t2 = trees[Math.floor(rand() * trees.length)];
    vaporList.push({ c: [t2.x, t2.y + t2.top, t2.z], p: [1.0 + rand() * 1.2, 1, rand(), 4 + rand() * 5] });
  }
  const vapor = puffs(vaporList, vaporMat);
  vapor.renderOrder = 7;
  scene.add(vapor);

  // 樹的空間索引（雨滴落點、聚光燈用）
  const treeGrid = new Map();
  for (const t2 of trees) { const key = Math.floor(t2.x / 2) + ',' + Math.floor(t2.z / 2); if (!treeGrid.has(key)) treeGrid.set(key, []); treeGrid.get(key).push(t2); }
  function treeAt(x, z) {
    let best = null, bd = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const t2 of treeGrid.get((Math.floor(x / 2) + a) + ',' + (Math.floor(z / 2) + b)) || []) {
        const d = Math.hypot(t2.x - x, t2.z - z);
        if (d < 0.42 * t2.s && d < bd) { bd = d; best = t2; }
      }
    }
    return best;
  }

  // 截留的主角樹：前緣、看得清楚的一棵
  const pickTree = (fx, fz) => trees.reduce((b, t2) => ((t2.x - fx) ** 2 + (t2.z - fz) ** 2 < (b.x - fx) ** 2 + (b.z - fz) ** 2 ? t2 : b), trees[0]);
  const tHero = trees.find((t2) => t2.hero);
  // ---------- 雨 ----------
  const heroRain = 1600;
  const rainCount = { high: 9000, medium: 6000, low: 3000 }[quality] + heroRain;
  const rainMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: timeUniform, uTop: { value: CLOUD_BASE + 1 }, uSpeed: { value: 15 }, uLen: { value: 1.1 }, uW: { value: 0.045 }, uWind: { value: 0.06 }, uRain: { value: 1 } },
    // 每滴雨是一個繞垂直軸面向相機的細長四邊形（比 1px 線段更清楚、可抗鋸齒）
    vertexShader: `attribute vec4 aDrop; uniform float uTime, uTop, uSpeed, uLen, uW, uWind, uRain; varying float vA; varying vec2 vUv;
      void main(){
        float Hh = uTop - aDrop.w;
        float f = fract(aDrop.z + uTime * uSpeed / Hh);
        float y = uTop - f * Hh;
        vec3 c = vec3(aDrop.x + (uTop - y) * uWind, y, aDrop.y);
        vec3 toCam = cameraPosition - c; toCam.y = 0.0;
        vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam + vec3(1e-4))));
        vec3 p = c + side * position.x * uW + vec3(-uWind, 1.0, 0.0) * (position.y + 0.5) * uLen;
        p.y = max(p.y, aDrop.w);
        float on = step(fract(aDrop.z * 97.0), uRain);
        vA = on * smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.94, 1.0, f));
        vA *= smoothstep(2.5, 9.0, length(cameraPosition - c));   // 貼近鏡頭的雨絲會變成模糊的粗柱，淡掉
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying float vA; varying vec2 vUv; void main(){
      float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
      float along = smoothstep(1.0, 0.15, vUv.y);
      gl_FragColor = vec4(0.30, 0.40, 0.53, vA * across * along * 0.78);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  {
    const drop = new Float32Array(rainCount * 4);
    for (let r = 0; r < rainCount; r++) {
      const hero = r >= rainCount - heroRain;
      const cl = hero ? [tHero.x, tHero.z] : clusters[Math.floor(rand() * 6)];
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand());
      const x = clamp(cl[0] + Math.cos(a) * rr * (hero ? 3.2 : 12), x0 + 0.3, x1 - 0.3), z = clamp(cl[1] + Math.sin(a) * rr * (hero ? 3.2 : 9), z0 + 0.3, z1 - 0.3);
      let gy = H(x, z);
      const k = Math.round((z - z0) / dx) * nx + Math.round((x - x0) / dx);
      if (waterLevel[k] > -999) gy = Math.max(gy, waterLevel[k]);
      const tc = treeAt(x, z);
      if (tc) gy = Math.max(gy, tc.y + tc.top * 0.82);
      gy = Math.max(gy, village.roofAt(x, z));
      drop.set([x, z, rand(), gy], r * 4);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.copy(new THREE.PlaneGeometry(1, 1));
    g.instanceCount = rainCount;
    g.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drop, 4));
    const rain = new THREE.Mesh(g, rainMat);
    rain.frustumCulled = false;
    rain.renderOrder = 6;
    scene.add(rain);
  }

  // ---------- 水的路徑（粒子）----------
  onProgress('建立 3D 模型', 0.6);
  const flows = {};
  const zf = z1 + 0.06; // 前切面前方一點點
  const jf = nz - 1;
  const HF = (x) => sampleBilinear(h, nx, nz, (x - x0) / dx, jf);
  const GF = (x) => sampleBilinear(gwt, nx, nz, (x - x0) / dx, jf);
  // 小溪在前切面的位置
  let xc = creek[0].x, levelC = creek[0].level;
  for (let k = 0; k < creek.length - 1; k++) {
    const a = creek[k], b = creek[k + 1];
    if ((a.z - z1) * (b.z - z1) <= 0) { const t = (a.z - z1) / (a.z - b.z); xc = lerp(a.x, b.x, t); levelC = lerp(a.level, b.level, t); break; }
  }
  const coastF = coast[jf];
  const P = (arr) => Float32Array.from(arr);

  // 漫地流 → 河道 → 海
  {
    const paths = [];
    const nearestIdx = (line, x, z) => { let best = 0, bd = Infinity; line.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };
    const riverTail = (from) => { const out = []; for (let i = from; i < river.length && river[i].s < sMouth + 3; i += 3) out.push(river[i].x, river[i].level + 0.07, river[i].z); return out; };
    const joinIdx = nearestIdx(river, creek[creek.length - 1].x, creek[creek.length - 1].z);
    let tries = 0;
    while (paths.length < 300 && tries++ < 6000) {
      const i = 2 + Math.floor(rand() * (nx - 4)), j = 2 + Math.floor(rand() * (nz - 4));
      let k = j * nx + i;
      if (h[k] < 1.2 || channelMask[k] || waterLevel[k] > -999 || village.built[k]) continue;
      if (X(i) > coast[j] - 3) continue;
      const pts = [];
      let steps = 0, end = 'none';
      let inStream = false;
      while (steps++ < 900) {
        const ii = k % nx, jj = (k / nx) | 0;
        if (!inStream && streamRef[k] >= 0) {
          // 流進溪床：接著沿這條溪蜿蜒的水路走到溪的出口，再從出口的格子繼續
          const line = streamLines[(streamRef[k] / 4096) | 0], from = streamRef[k] % 4096;
          for (let q = from; q < line.length; q += 2) pts.push(line[q].x, line[q].level + 0.07, line[q].z);
          const e = line[line.length - 1];
          k = Math.round((e.z - z0) / dx) * nx + Math.round((e.x - x0) / dx);
          inStream = true;
          if (channelMask[k]) { end = rdist[k] <= cdist[k] ? 'river' : 'creek'; break; }
          if (waterLevel[k] > -999) { end = 'pond'; break; }
          if (h[k] < 0.05) { end = 'sea'; break; }
          continue;
        }
        pts.push(X(ii), h[k] + 0.2, Z(jj));
        if (channelMask[k]) { end = rdist[k] <= cdist[k] ? 'river' : 'creek'; break; }
        if (waterLevel[k] > -999) { end = 'pond'; break; }
        if (h[k] < 0.05) { end = 'sea'; break; }
        const d = dir[k];
        if (d < 0) break;
        k = d;
      }
      if (pts.length < 12) continue;
      let p2 = Array.from(chaikin(P(pts), 2));
      const lx = pts[pts.length - 3], lz = pts[pts.length - 1];
      if (end === 'river') p2 = p2.concat(riverTail(nearestIdx(river, lx, lz)));
      else if (end === 'creek') {
        const ci = nearestIdx(creek, lx, lz);
        for (let c3 = ci; c3 < creek.length; c3 += 3) p2.push(creek[c3].x, creek[c3].level + 0.07, creek[c3].z);
        p2 = p2.concat(riverTail(joinIdx));
      } else if (end === 'none') continue;
      paths.push(P(p2));
    }
    flows.overland = new FlowSystem(paths, { color: 0x2b86e0, size: 0.55, perPath: 7, speed: 3.2, rand, name: 'overland' });
  }
  // 截留後滴落
  {
    const paths = [];
    const wet = trees.filter((t2) => t2.x < 12 && t2.z > -30);
    for (let n = 0; n < 900 && wet.length; n++) {
      const t2 = wet[Math.floor(rand() * wet.length)];
      const ox = (rand() - 0.5) * 0.5 * t2.s, oz = (rand() - 0.5) * 0.5 * t2.s;
      paths.push(P([t2.x + ox, t2.y + t2.top * 0.75, t2.z + oz, t2.x + ox * 1.2, t2.y + 0.04, t2.z + oz * 1.2]));
    }
    flows.drip = new FlowSystem(paths, { color: 0x2f8fe0, size: 0.2, perPath: 2, speed: 1.4, rand, fade: 0.15, trail: 4, gap: 0.1, name: 'drip' });
    const hp = [];
    for (let n = 0; n < 70; n++) {
      const a = rand() * Math.PI * 2, rr = (0.25 + 0.75 * Math.sqrt(rand())) * 0.55 * tHero.s;
      const xx = tHero.x + Math.cos(a) * rr, zz = tHero.z + Math.sin(a) * rr;
      hp.push(P([xx, tHero.y + tHero.top * (0.42 + 0.1 * rand()), zz, xx, H(xx, zz) + 0.03, zz]));
    }
    flows.dripHero = new FlowSystem(hp, { color: 0x4aa8ff, size: 0.075, perPath: 2, speed: 2.2, rand, fade: 0.08, trail: 6, gap: 0.05, name: 'dripHero' });
  }
  // 前切面：入滲、滲漏、中間流、地下水、出滲
  {
    const infil = [], perc = [], percDense = [], inter = [], gw = [], exfil = [];
    for (let x = -57; x < coastF - 1.5; x += 1.15) {
      if (Math.abs(x - xc) < 1.3) continue;
      const xx = x + (rand() - 0.5) * 0.6, hs = HF(xx);
      infil.push(P([xx, hs + 0.03, zf, xx + 0.12, hs - 0.95, zf]));
    }
    for (let x = -52; x < coastF - 2; x += 2.0) {
      const xx = x + (rand() - 0.5), hs = HF(xx), g = GF(xx);
      if (g < hs - 2.4) perc.push(P([xx, hs - 0.9, zf, xx + 0.2, g + 0.06, zf]));
    }
    for (let x = -21; x <= -11.5; x += 0.42) {
      const xx = x + (rand() - 0.5) * 0.25, hs = HF(xx), g = GF(xx);
      const pts = [], ph = rand() * 6.28, top = hs - 0.8, bot = g - 0.45;
      for (let k = 0; k <= 14; k++) {
        const u = k / 14;
        pts.push(xx + Math.sin(u * 9 + ph) * 0.12 + u * 0.15, lerp(top, bot, u), zf);
      }
      percDense.push(P(pts));
    }
    for (let x0i = -50; x0i < xc - 3; x0i += 2.3) {
      const pts = [];
      for (let x = x0i; x < xc - 0.55; x += 0.45) pts.push(x, Math.max(HF(x) - 0.72, GF(x) + 0.12), zf);
      pts.push(xc - 0.4, levelC - 0.05, zf);
      inter.push(P(pts));
    }
    for (let x0i = -52; x0i < xc - 3; x0i += 2.6) {
      const y0 = Math.max(bottom + 1.5, GF(x0i) - (0.5 + rand() * 4.5));
      const pts = [];
      for (let x = x0i; x <= xc; x += 0.5) {
        const t = clamp((x - x0i) / (xc - x0i), 0, 1);
        pts.push(x, Math.min(lerp(y0, levelC - 0.6, t ** 1.6), GF(x) - 0.18), zf);
      }
      pts.push(xc, levelC - 0.3, zf);
      gw.push(P(pts));
    }
    for (let x0i = xc + 2; x0i < coastF - 2; x0i += 2.2) {
      const y0 = GF(x0i) - (0.5 + rand() * 4.5);
      const pts = [];
      for (let x = x0i; x <= coastF + 3.5; x += 0.5) pts.push(x, Math.min(y0 - 0.03 * (x - x0i), GF(x) - 0.18, HF(x) - 0.3), zf);
      pts.push(coastF + 3.7, HF(coastF + 3.7) + 0.05, zf);
      gw.push(P(pts));
    }
    for (let x = xc + 6; x < coastF - 4; x += 2.4) {
      const xx = x + (rand() - 0.5), hs = HF(xx);
      exfil.push(P([xx, hs - 0.85, zf, xx + 0.05, hs + 0.04, zf]));
    }
    flows.infil = new FlowSystem(infil, { color: 0x59c1f2, size: 0.42, perPath: 3, speed: 0.38, rand, name: 'infil' });
    flows.perc = new FlowSystem(perc, { color: 0x3f8fe6, size: 0.42, perPath: 4, speed: 0.55, rand, name: 'perc' });
    flows.percd = new FlowSystem(percDense, { color: 0x1f6fe0, size: 0.3, perPath: 2, speed: 0.75, rand, fade: 0.15, trail: 5, gap: 0.12, name: 'percd' });
    flows.interflow = new FlowSystem(inter, { color: 0x19b39b, size: 0.46, perPath: 12, speed: 1.0, rand, name: 'interflow' });
    flows.gw = new FlowSystem(gw, { color: 0x1747c9, size: 0.48, perPath: 12, speed: 0.45, rand, name: 'gw' });
    flows.exfil = new FlowSystem(exfil, { color: 0xb08a4e, size: 0.4, perPath: 3, speed: 0.22, rand, name: 'exfil' });
  }
  // 蒸發、蒸散：從水面、樹冠擺動上升的水氣絲
  {
    const wisp = (x, y, z, rise, amp) => {
      const pts = [], ph = rand() * 6.28, ph2 = rand() * 6.28;
      for (let k = 0; k <= 24; k++) {
        const u = k / 24;
        pts.push(x + Math.sin(u * 7 + ph) * amp * (0.4 + u), y + u * rise, z + Math.cos(u * 5 + ph2) * amp * 0.6 * (0.4 + u));
      }
      return P(pts);
    };
    const ev = [], tr = [];
    for (let n = 0; n < 160; n++) { // 海面
      const z = z0 + 3 + rand() * (z1 - z0 - 6), j = Math.round((z - z0) / dx);
      const x = coast[j] + 3 + rand() * (x1 - coast[j] - 5);
      ev.push(wisp(x, 0.25, z, 9 + rand() * 7, 0.5));
    }
    for (let n = 0; n < 50; n++) { const p = river[Math.floor(rand() * river.length * 0.9)]; ev.push(wisp(p.x, p.level + 0.15, p.z, 6 + rand() * 4, 0.35)); }
    for (const pd of ponds) for (let n = 0; n < 6; n++) ev.push(wisp(pd.x + (rand() - 0.5) * pd.r, pd.level + 0.1, pd.z + (rand() - 0.5) * pd.r, 5 + rand() * 3, 0.3));
    for (let n = 0; n < 220 && trees.length; n++) { const t2 = trees[Math.floor(rand() * trees.length)]; tr.push(wisp(t2.x, t2.y + t2.top, t2.z, 5 + rand() * 4, 0.3)); }
    flows.evapw = new FlowSystem(ev, { color: 0x4d8fca, size: 0.7, perPath: 2, speed: 1.6, rand, fade: 0.3, trail: 16, gap: 0.16, soft: true, name: 'evapw' });
    flows.transpw = new FlowSystem(tr, { color: 0x6dbb8a, size: 0.45, perPath: 2, speed: 1.3, rand, fade: 0.3, trail: 14, gap: 0.15, soft: true, name: 'transpw' });
  }
  for (const f of Object.values(flows)) scene.add(f.points);

  // ---------- 標籤 ----------
  const labelDefs = [
    ['precipitation', '降水', 'precipitation', [-26, CLOUD_BASE - 3, 2]],
    ['interception', '截留', 'interception', null],
    ['depression', '窪蓄', 'depression storage', [ponds[0].x, ponds[0].level + 0.4, ponds[0].z]],
    ['infiltration', '入滲', 'infiltration', [-12.5, HF(-12.5) - 0.4, zf + 0.2]],
    ['overland', '漫地流／地表逕流', 'overland flow / surface runoff', [-14, H(-14, 14) + 0.6, 14]],
    ['interflow', '中間流', 'interflow', [1, HF(1) - 0.8, zf + 0.2]],
    ['percolation', '滲漏', 'percolation', [-16, HF(-16) + 0.3, zf + 0.2]],
    ['unsat', '未飽和層', 'unsaturated zone', [-9.5, (HF(-9.5) + GF(-9.5)) / 2 + 0.3, zf + 0.2]],
    ['groundwater', '地下水', 'groundwater', [20, GF(20) - 3.2, zf + 0.2]],
    ['gwt', '地下水位', 'groundwater table', [-6.8, GF(-6.8), zf + 0.2]],
    ['exfiltration', '出滲', 'exfiltration', [26, HF(26) + 0.1, zf + 0.2]],
    ['evaporation', '蒸發', 'evaporation', [50, 7, 8]],
    ['transpiration', '蒸散', 'transpiration', null],
    ['river', '河川', 'river', [river[560].x, river[560].level + 0.6, river[560].z]],
    ['ocean', '海洋', 'ocean', [53, 0.6, -18]],
  ];
  // 截留、蒸散：找一棵靠前方、看得見的樹
  const tI = pickTree(-24, 30), tT = pickTree(-22, 12);
  labelDefs.find((d) => d[0] === 'interception')[3] = [tI.x, tI.y + tI.top + 0.2, tI.z];
  labelDefs.find((d) => d[0] === 'transpiration')[3] = [tT.x, tT.y + tT.top + 2.2, tT.z];
  const labels = {};
  for (const [id, zh, en, p] of labelDefs) {
    const el = document.createElement('div');
    el.className = 'hc-label';
    el.dataset.id = id;
    el.innerHTML = `<span class="hc-label__box"><span class="hc-label__zh">${zh}</span><span class="hc-label__en">${en}</span></span>`;
    const obj = new CSS2DObject(el);
    obj.position.set(...p);
    obj.center.set(0.5, 1.15);
    scene.add(obj);
    labels[id] = { el, obj };
  }

  // ---------- 聚光燈 ----------
  const spot = document.createElement('div');
  spot.className = 'hc-spot';
  spot.innerHTML = '<div class="hc-ring"></div>';
  container.appendChild(spot);
  const crown = [tHero.x, tHero.y + tHero.top * 0.5, tHero.z];
  const xcF = xc, lvC = levelC;
  const FOCUS = {
    interception: { p: crown, r: 1.15 * tHero.s },
    depression: { p: [ponds[0].x, ponds[0].level, ponds[0].z], r: ponds[0].r * 1.5 },
    infiltration: { p: [-12, HF(-12) - 0.45, zf], r: 2.4 },
    interflow: { p: [xcF - 2.2, lvC - 0.1, zf], r: 2.6 },
    percolation: { p: [-16, (HF(-16) + GF(-16)) / 2, zf], r: 3.6 },
    groundwater: { p: [8, GF(8) - 3, zf], r: 6 },
    exfiltration: { p: [26, HF(26) - 0.35, zf], r: 1.6 },
    evaporation: { p: [47, 4, 6], r: 9 },
    transpiration: { p: [tT.x, tT.y + tT.top + 1.5, tT.z], r: 3.2 },
  };
  // 截留：鏡頭拉近到前緣的一棵樹
  const stI = STEPS.find((st) => st.id === 'interception');
  if (stI) stI.cam = [[crown[0] + 6.5, crown[1] + 6.0, crown[2] + 11.5], [crown[0] - 1.8, crown[1] - 0.6, crown[2]]];
  labels.interception.obj.position.set(crown[0], tHero.y + tHero.top * 1.05, crown[2]);
  let focus = null;
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), camRight = new THREE.Vector3();
  function updateSpot() {
    const on = !!focus && !state.tween;
    spot.classList.toggle('is-on', on);
    if (!focus) return;
    const w = container.clientWidth, hh = container.clientHeight;
    vA.set(...focus.p).project(camera);
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    vB.set(...focus.p).addScaledVector(camRight, focus.r).project(camera);
    const sx = (vA.x * 0.5 + 0.5) * w, sy = (-vA.y * 0.5 + 0.5) * hh;
    const r = Math.max(40, Math.hypot((vB.x - vA.x) * 0.5 * w, (vB.y - vA.y) * 0.5 * hh));
    spot.style.setProperty('--sx', sx.toFixed(1) + 'px');
    spot.style.setProperty('--sy', sy.toFixed(1) + 'px');
    spot.style.setProperty('--sr', r.toFixed(1) + 'px');
  }

  // ---------- 標籤避讓 ----------
  const LABEL_PRIORITY = ['precipitation', 'evaporation', 'ocean', 'river', 'overland', 'transpiration', 'interception', 'depression',
    'groundwater', 'infiltration', 'interflow', 'percolation', 'unsat', 'gwt', 'exfiltration'];
  function declutter() {
    const order = Object.keys(labels).sort((a, b) => {
      const pa = labels[a].el.classList.contains('is-active') ? -1 : LABEL_PRIORITY.indexOf(a);
      const pb = labels[b].el.classList.contains('is-active') ? -1 : LABEL_PRIORITY.indexOf(b);
      return pa - pb;
    });
    const placed = [];
    for (const id of order) {
      const l = labels[id];
      if (!l.obj.visible || l.el.style.display === 'none') continue;
      const r = (l.box ||= l.el.querySelector('.hc-label__box')).getBoundingClientRect();
      const pad = 6;
      const hit = placed.some((q) => r.left - pad < q.right && r.right + pad > q.left && r.top - pad < q.bottom && r.bottom + pad > q.top);
      l.el.classList.toggle('is-hidden', hit);
      if (!hit) placed.push(r);
    }
  }

  onProgress('完成', 1);

  // ---------- 導覽與狀態 ----------
  const state = { step: 0, rain: true, labels: true, paused: false, t: 0, tween: null };
  const stepFlows = {
    cover: 'all', overview: 'all', precipitation: ['rain'], interception: ['dripHero', 'drip', 'rain'], depression: ['overland', 'rain'],
    infiltration: ['infil'], overland: ['overland'], interflow: ['interflow'], percolation: ['perc', 'percd'], groundwater: ['gw'],
    exfiltration: ['exfil'], evaporation: ['evap', 'evapw'], transpiration: ['transp', 'transpw'],
  };
  const stepLabel = { cover: null, overview: null, precipitation: 'precipitation', interception: 'interception', depression: 'depression', infiltration: 'infiltration',
    overland: 'overland', interflow: 'interflow', percolation: 'percolation', groundwater: 'groundwater', exfiltration: 'exfiltration',
    evaporation: 'evaporation', transpiration: 'transpiration' };

  function applyStepVisuals() {
    const id = STEPS[state.step].id;
    const on = stepFlows[id];
    const has = (n) => on === 'all' || on.includes(n);
    const calm = id === 'overview' || id === 'cover';
    for (const [name, f] of Object.entries(flows)) f.material.uniforms.uOpacity.value = has(name) ? (calm ? (name === 'evapw' || name === 'transpw' ? 0.3 : 0.55) : 1) : 0.08;
    if (id === 'interception') flows.drip.material.uniforms.uOpacity.value = 0.22;
    base.rain = has('rain') || id === 'depression' ? 1 : (id === 'evaporation' || id === 'transpiration' || id === 'exfiltration' ? 0 : 0.3);
    rainMat.uniforms.uW.value = id === 'precipitation' ? 0.075 : 0.045;
    rainMat.uniforms.uLen.value = id === 'precipitation' ? 1.5 : 1.1;
    base.evap = has('evap') ? 1.6 : (on === 'all' ? 1 : 0.15);
    base.transp = has('transp') ? 1.8 : (on === 'all' ? 1 : 0.15);
    applyGains();
    strataMat.uniforms.uGwHi.value = id === 'groundwater' || id === 'percolation' ? 1 : 0;
    strataMat.uniforms.uUnsat.value = id === 'percolation' ? 1 : 0;
    wetTarget = id === 'interception' ? 0.3 : (state.rain && (on === 'all' || has('rain')) ? 0.35 : 0);
    heroWetTarget = id === 'interception' ? 1 : wetTarget;
    focus = FOCUS[id] || null;
    const active = stepLabel[id];
    for (const [lid, l] of Object.entries(labels)) {
      const companion = (lid === 'gwt' && (id === 'groundwater' || id === 'percolation' || id === 'infiltration')) || (lid === 'unsat' && id === 'percolation');
      l.el.classList.toggle('is-active', lid === active || companion);
      l.el.classList.toggle('is-dim', !!active && lid !== active && !companion);
      l.obj.visible = state.labels && (lid !== 'unsat' || id === 'percolation');
    }
  }

  // gains：由參數模擬決定的各過程強度（0–1）；base：導覽步驟的強調程度
  const base = { rain: 1, evap: 1, transp: 1 };
  const gains = {};
  function applyGains() {
    const alias = { evapw: 'evap', transpw: 'transp' };
    for (const [name, f] of Object.entries(flows)) f.material.uniforms.uAmount.value = gains[name] ?? gains[alias[name]] ?? 1;
    rainMat.uniforms.uRain.value = state.rain ? base.rain * (gains.rain ?? 1) : 0;
    rainUniform.value = Math.min(1, rainMat.uniforms.uRain.value);
    vaporMat.uniforms.uEvap.value = base.evap * (gains.evap ?? 1);
    vaporMat.uniforms.uTransp.value = base.transp * (gains.transp ?? 1);
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let driftSpeed = 0, driftSign = 1;
  function setStep(i, { instant = false } = {}) {
    state.step = clamp(i, 0, STEPS.length - 1);
    if (driftSpeed > 0) { driftSign = -driftSign; controls.autoRotateSpeed = driftSpeed * driftSign; }
    const [p, tg] = STEPS[state.step].cam;
    if (instant) {
      camera.position.set(...p); controls.target.set(...tg); state.tween = null;
    } else {
      state.tween = { t0: performance.now(), dur: 1800, fromP: camera.position.clone(), fromT: controls.target.clone(), toP: new THREE.Vector3(...p), toT: new THREE.Vector3(...tg) };
    }
    applyStepVisuals();
    return STEPS[state.step];
  }

  let wetTarget = 0, heroWetTarget = 0, lastT = 0;
  function updateScene(t) {
    const dt = Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
    wetUniform.value += (wetTarget - wetUniform.value) * Math.min(1, dt * 1.5);
    heroWet.value += (heroWetTarget - heroWet.value) * Math.min(1, dt * 1.5);
    timeUniform.value = t;
    for (const f of Object.values(flows)) f.update(t);
    villageApi.update(t);
    treeLOD.update(camera.position);
  }

  // 左側面板遮住的寬度：把投影中心往右移，讓模型置中在可見區域
  let insetLeft = opts.insetLeft || 0, insetRight = opts.insetRight || 0;
  function resize() {
    const w = container.clientWidth, hgt = container.clientHeight;
    post.setSize(w, hgt);
    labelRenderer.setSize(w, hgt);
    camera.aspect = w / hgt;
    const shift = w > 760 ? (insetLeft - insetRight) / 2 : 0;
    if (shift !== 0) camera.setViewOffset(w, hgt, -shift, 0, w, hgt); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const px = hgt * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (const f of Object.values(flows)) f.setScale(px);
  }

  let raf = 0, last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!state.paused) state.t += dt;
    if (state.tween) {
      const k = clamp((now - state.tween.t0) / state.tween.dur, 0, 1), e = ease(k);
      camera.position.lerpVectors(state.tween.fromP, state.tween.toP, e);
      controls.target.lerpVectors(state.tween.fromT, state.tween.toT, e);
      if (k >= 1) state.tween = null;
    }
    controls.enabled = !state.tween;
    controls.update();
    updateScene(state.t);
    post.render();
    post.tick();
    labelRenderer.render(scene, camera);
    declutter();
    updateSpot();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  setStep(0, { instant: true });
  if (!capture) raf = requestAnimationFrame(frame);

  return {
    steps: STEPS,
    setStep,
    get step() { return state.step; },
    setRain(on) { state.rain = on; applyStepVisuals(); },
    setLabels(on) { state.labels = on; applyStepVisuals(); },
    setPaused(p) { state.paused = p; },
    setGains(g) { Object.assign(gains, g); applyGains(); },
    // 影片用的慢速環繞：每換一步就反向，避免累積後構圖跑掉
    setDrift(speed) { driftSpeed = speed; controls.autoRotate = speed > 0; controls.autoRotateSpeed = speed; },
    setStepById(id, o) { const i = STEPS.findIndex((st) => st.id === id); return setStep(i < 0 ? 0 : i, o); },
    get flowsOn() { return stepFlows[STEPS[state.step].id]; },
    setActive(on) {
      if (on && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
      if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
    },
    // 'full'：可旋轉、縮放、平移；'rotate'：只能旋轉；'none'：不能操作
    setControls(mode) {
      controls.enableRotate = mode !== 'none';
      controls.enableZoom = mode === 'full';
      controls.enablePan = mode === 'full';
    },
    clearGains() { for (const k of Object.keys(gains)) delete gains[k]; applyGains(); },
    get time() { return state.t; },
    setInsets(l, r) { insetLeft = l; insetRight = r; resize(); },
    // 影片用：指定時間與相機，同步輸出一格
    render(t, cam) {
      if (cam) { camera.position.set(...cam[0]); controls.target.set(...cam[1]); camera.lookAt(controls.target); }
      else controls.update();
      updateScene(t);
      post.render();
      labelRenderer.render(scene, camera);
    },
    // 畫質：'high' | 'medium' | 'low' | 'lowest'
    setQuality(name) { const r = post.setLevel(name); resize(); return r; },
    get qualityLevel() { return post.level; },
    get fps() { return post.fps; },
    tune: (p) => post.tune(p),
    post,
    camera, controls, scene, renderer,
    info: { ms: T.ms }, terrain: T, village,
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.innerHTML = ''; },
  };
}
