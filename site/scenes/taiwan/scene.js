// 台灣真實地形（單元 1-3）：AWS Terrain Tiles（SRTM／ETOPO1）z10，約 280 m／像素
// 1 單位 = 1 km，島中心在原點；高程乘上垂直誇大
// 模式：'relief' 一般地形色、'bands' 三種地形分區（>1000、100–1000、<100 m）、'lumped' 集塊、'grid' 分佈（網格）
import * as THREE from 'three';
import { createStage, GLSL_NOISE, addPlinth } from '../lib/stage.js';
import { makeWaterNormal } from '../lib/textures.js';

export const TW_STEPS = [
  { id: 'tw-hero', cam: [[150, 250, 330], [0, 0, 10]] },
  { id: 'tw-top', cam: [[40, 470, 150], [0, 0, 0]] },
  { id: 'tw-bands', cam: [[170, 300, 300], [10, 0, 0]] },
  { id: 'tw-mtn', cam: [[150, 120, 120], [20, 10, -10]] },
  { id: 'tw-east', cam: [[260, 150, 60], [20, 0, 0]] },
  { id: 'tw-model', cam: [[120, 260, 230], [10, 0, -10]] },
];

export async function createTaiwan(container, { base = '../../data/', exaggeration = 3, onProgress = () => {}, quality = 'high', capture = false } = {}) {
  const meta = await (await fetch(base + 'taiwan_dem.json')).json();
  const dem = new Int16Array(await (await fetch(base + 'taiwan_dem.bin')).arrayBuffer());
  const W = meta.width, Hh = meta.height;
  onProgress('建立 3D 模型', 0.3);
  const kmX = meta.mpp_x / 1000, kmZ = meta.mpp_y / 1000;
  const sizeX = W * kmX, sizeZ = Hh * kmZ, ox = -sizeX / 2, oz = -sizeZ / 2;
  const stage = createStage(container, { quality, capture, steps: TW_STEPS, shadowBox: 260, fov: 30, sunDir: new THREE.Vector3(-0.55, 0.6, -0.35) });
  stage.controls.maxDistance = 900; stage.controls.minDistance = 30;
  stage.camera.far = 6000; stage.camera.updateProjectionMatrix();
  stage.sun.shadow.camera.far = 900; stage.sun.position.multiplyScalar(2.2);
  const { scene, timeUniform } = stage;

  // 經緯度 → 世界座標（Web Mercator 列）
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const m0 = merc(meta.lat1), m1 = merc(meta.lat0);
  const toXZ = (lon, lat) => [ox + (lon - meta.lon0) / (meta.lon1 - meta.lon0) * sizeX, oz + (m0 - merc(lat)) / (m0 - m1) * sizeZ];

  const step = 2;
  const nx = Math.floor((W - 1) / step) + 1, nz = Math.floor((Hh - 1) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), elev = new Float32Array(nx * nz), shade = new Float32Array(nx * nz);
  const at = (i, j) => dem[Math.min(Hh - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, I = i * step, J = j * step, h = at(I, J);
    elev[k] = h;
    pos[k * 3] = ox + I * kmX; pos[k * 3 + 2] = oz + J * kmZ;
    const gx = (at(I + 1, J) - at(I - 1, J)) / (2 * meta.mpp_x), gz = (at(I, J + 1) - at(I, J - 1)) / (2 * meta.mpp_y);
    shade[k] = Math.max(0.45, Math.min(1.25, 0.9 + (gx * 0.6 + gz * 0.45) * 1.6));
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aElev', new THREE.BufferAttribute(elev, 1));
  geo.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  // 法線用誇大後的高度計算（在 CPU 先算一次；改誇大倍數時重算）
  function updateNormals(ex) {
    for (let k = 0; k < nx * nz; k++) pos[k * 3 + 1] = elev[k] * 0.001 * (elev[k] > 0 ? ex : ex * 0.35);
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
  const U = { uMode: { value: 0 }, uMix: { value: 0 }, uMode2: { value: 0 }, uTime: timeUniform, uMean: { value: 700 } };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aElev, aShade;\nvarying float vElev, vShade;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvElev = aElev; vShade = aShade; vWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying float vElev, vShade; varying vec3 vWP; uniform float uMode, uMode2, uMix, uMean;
        ${GLSL_NOISE}
        vec3 ramp(float h) {
          if (h < 0.0) {
            float d = clamp(-h / 4000.0, 0.0, 1.0);
            return mix(mix(vec3(0.49, 0.76, 0.79), vec3(0.17, 0.47, 0.64), smoothstep(0.0, 0.06, d)), vec3(0.04, 0.17, 0.30), smoothstep(0.06, 1.0, d));
          }
          vec3 c = mix(vec3(0.49, 0.59, 0.39), vec3(0.42, 0.55, 0.31), smoothstep(0.0, 150.0, h));
          c = mix(c, vec3(0.30, 0.45, 0.25), smoothstep(150.0, 900.0, h));
          c = mix(c, vec3(0.40, 0.43, 0.32), smoothstep(1500.0, 2600.0, h));
          c = mix(c, vec3(0.58, 0.54, 0.47), smoothstep(2600.0, 3300.0, h));
          c = mix(c, vec3(0.92, 0.91, 0.88), smoothstep(3500.0, 3850.0, h));
          return c;
        }
        vec3 bands(float h) {
          if (h <= 0.0) return ramp(h);
          if (h < 100.0) return vec3(0.80, 0.73, 0.42);
          if (h < 1000.0) return vec3(0.47, 0.66, 0.36);
          return vec3(0.42, 0.36, 0.30);
        }
        vec3 modeCol(float m, float h) {
          if (m < 0.5) return ramp(h);
          if (m < 1.5) return bands(h);
          if (m < 2.5) return h > 0.0 ? vec3(0.46, 0.56, 0.36) : ramp(h);   // 集塊：整個集水區一個值
          // 分佈：每一格自己的值（10 km 網格，格內取格中心高程的分層色）
          if (h <= 0.0) return ramp(h);
          vec2 cell = floor(vWP.xz / 10.0);
          float r = hash12(cell);
          vec3 c = mix(vec3(0.93, 0.85, 0.55), vec3(0.20, 0.42, 0.30), r);
          c = mix(c, vec3(0.55, 0.40, 0.30), smoothstep(0.75, 1.0, r) * 0.6);
          vec2 f = abs(fract(vWP.xz / 10.0) - 0.5);
          float line = 1.0 - smoothstep(0.46, 0.49, max(f.x, f.y));
          return mix(c, vec3(0.95), (1.0 - line) * 0.55);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 cA = modeCol(uMode, vElev), cB = modeCol(uMode2, vElev);
        vec3 col = mix(cA, cB, uMix);
        diffuseColor.rgb = pow(col, vec3(2.2)) * (vElev > 0.0 ? mix(1.0, vShade, 0.85) : 1.0);`);
  };
  const terrain = new THREE.Mesh(geo, mat);
  terrain.receiveShadow = true; terrain.castShadow = true;
  scene.add(terrain);
  let ex = exaggeration;
  updateNormals(ex);

  // 方塊側面（海床切面）
  const sideMat = new THREE.MeshBasicMaterial({ color: 0x2b3a44 });
  const skirt = new THREE.Group();
  const B = -4.5 * ex * 0.35 - 0.8;
  function buildSkirt() {
    skirt.clear();
    const edges = [[0, 0, 1, 0, nx], [0, nz - 1, 1, 0, nx], [0, 0, 0, 1, nz], [nx - 1, 0, 0, 1, nz]];
    for (const [i0, j0, di, dj, n] of edges) {
      const p = [];
      for (let t = 0; t < n; t++) { const k = (j0 + dj * t) * nx + (i0 + di * t); p.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], pos[k * 3], B, pos[k * 3 + 2]); }
      const ind = [];
      for (let t = 0; t < n - 1; t++) { const a = t * 2; ind.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ind);
      const m = new THREE.Mesh(g, sideMat); m.material.side = THREE.DoubleSide; skirt.add(m);
    }
  }
  buildSkirt();
  scene.add(skirt);
  // 展示底座（木座）＋地面陰影：整塊地形像博物館裡的立體地圖模型
  addPlinth(scene, { x0: ox, x1: ox + sizeX, z0: oz, z1: oz + sizeZ, bottom: B, margin: 7, height: 9 });

  // 海面
  const wn = makeWaterNormal(); wn.repeat.set(24, 40);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), new THREE.MeshStandardMaterial({
    color: 0x3b86ad, transparent: true, opacity: 0.35, roughness: 0.12, normalMap: wn, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.1, depthWrite: false,
  }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = 0.004; sea.renderOrder = 2;
  scene.add(sea);
  stage.onUpdate((t) => wn.offset.set(t * 0.004, t * 0.003));

  // 北迴歸線（23.44°N）
  const [tx0, tz] = toXZ(meta.lon0, 23.44), [tx1] = toXZ(meta.lon1, 23.44);
  const trop = new THREE.Mesh(new THREE.BoxGeometry(tx1 - tx0, 0.35, 0.9), new THREE.MeshBasicMaterial({ color: 0xc26a1d, transparent: true, opacity: 0.9 }));
  trop.position.set((tx0 + tx1) / 2, 4.2 * ex * 0.35 + 3, tz); trop.visible = false;
  scene.add(trop);

  // 地名標籤
  const yAt = (x, z) => {
    const i = Math.round((x - ox) / kmX / step), j = Math.round((z - oz) / kmZ / step);
    const h = elev[Math.max(0, Math.min(nz - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
    return Math.max(0, h) * 0.001 * ex;
  };
  const place = (zh, en, lon, lat, dy = 4) => { const [x, z] = toXZ(lon, lat); const l = stage.label(zh, en, [x, yAt(x, z) + dy, z]); l.lonlat = [lon, lat, dy]; return l; };
  const labels = {
    yushan: place('玉山', '3952 m', 120.957, 23.47, 3),
    cmr: place('中央山脈', 'Central Range', 121.2, 24.1, 6),
    plain: place('嘉南平原', 'Chianan Plain', 120.25, 23.25, 4),
    tropic: stage.label('北迴歸線 23.5°N', 'Tropic of Cancer', [tx0 + 40, 12, tz - 3]),
    strait: place('台灣海峽', 'Taiwan Strait', 119.95, 24.2, 2),
    pacific: place('太平洋', 'Pacific Ocean', 122.0, 23.0, 2),
  };
  const labelSets = {
    'tw-hero': [], 'tw-top': ['tropic', 'strait', 'pacific'], 'tw-bands': ['yushan', 'cmr', 'plain'], 'tw-mtn': ['yushan', 'cmr'], 'tw-east': ['pacific', 'cmr'], 'tw-model': [],
  };
  function updateLabels() {
    const on = labelSets[TW_STEPS[stage.step].id] || [];
    for (const [k, l] of Object.entries(labels)) l.obj.visible = stage.state.labels && on.includes(k);
  }
  stage.onStep(updateLabels);

  // 模式切換（含淡入淡出）
  let fade = null;
  function setMode(m, instant = false) {
    const code = { relief: 0, bands: 1, lumped: 2, grid: 3 }[m] ?? 0;
    if (instant) { U.uMode.value = code; U.uMix.value = 0; fade = null; return; }
    if (code === U.uMode.value && !fade) return;
    U.uMode2.value = code; U.uMix.value = 0; fade = { t0: performance.now() };
  }
  stage.onUpdate(() => {
    if (!fade) return;
    const k = Math.min(1, (performance.now() - fade.t0) / 900);
    U.uMix.value = k * k * (3 - 2 * k);
    if (k >= 1) { U.uMode.value = U.uMode2.value; U.uMix.value = 0; fade = null; }
  });
  // 慢速旋轉的展示模式（封面用）
  onProgress('完成', 1);
  stage.start();
  // 用原型繼承 stage（不用 ...stage 展開）：time、step 這些 getter 才會一直是最新值
  return Object.assign(Object.create(stage), {
    meta, toXZ, sizeX, sizeZ,
    setMode,
    setTropic(on) { trop.visible = on; },
    setExaggeration(v) {
      ex = v; updateNormals(ex); buildSkirt(); stage.post.invalidateShadows();
      for (const l of Object.values(labels)) if (l.lonlat) { const [x, z] = toXZ(l.lonlat[0], l.lonlat[1]); l.obj.position.y = yAt(x, z) + l.lonlat[2]; }
    },
    setLabels(on) { stage.state.labels = on; updateLabels(); },
  });
}
