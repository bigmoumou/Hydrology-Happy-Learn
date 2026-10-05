// 程序生成的樹：針葉樹（層層下垂的枝層）、闊葉樹（多團凹凸樹冠）、檳榔（細幹＋羽狀葉）、灌木
// 全部只用 position／normal／color 三種屬性，方便合併與 instancing；材質有微風擺動與逆光透葉。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';

const C = (hex) => new THREE.Color(hex);

function finalize(g, colorFn) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let v = 0; v < n; v++) { colorFn(p.getX(v), p.getY(v), p.getZ(v), c, v); col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function trunk(r0, r1, h, color, bend = 0, lod = 0) {
  const g = lod ? new THREE.CylinderGeometry(r1, r0, h, 5, 1, true) : new THREE.CylinderGeometry(r1, r0, h, 7, 4, true);
  g.translate(0, h / 2, 0);
  if (bend) {
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) { const t = p.getY(v) / h; p.setX(v, p.getX(v) + bend * t * t); }
    g.computeVertexNormals();
  }
  const base = C(color);
  return finalize(g, (x, y, z, c) => c.copy(base).multiplyScalar(0.75 + 0.25 * Math.min(1, y / h)));
}

// 針葉樹：一層層有鋸齒邊緣、下垂的枝層
// lod = 1：遠景用的簡化版（同樣的輪廓與配色，面數約 4 成）
export function coniferGeometry(seed = 1, lod = 0) {
  const rand = mulberry32(seed);
  const parts = [trunk(0.07, 0.03, 1.55, 0x4a3828, 0, lod)];
  const layers = lod ? 6 : 9, seg = lod ? 7 : 11;
  const dark = C(0x1f3a1e), mid = C(0x2c4f27), tip = C(0x46703a);
  for (let l = 0; l < layers; l++) {
    const t = l / (layers - 1);
    const y = 0.32 + t * 1.22;
    const r = 0.58 * Math.pow(1 - t, 0.9) + 0.05;
    const top = 0.26 + 0.1 * (1 - t);
    const pos = [];
    const tips = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2 + (rand() - 0.5) * 0.35;
      const rr = r * (0.75 + 0.45 * rand());
      const droop = rr * (0.42 + 0.25 * rand());
      tips.push([Math.cos(a) * rr, y - droop, Math.sin(a) * rr]);
    }
    const apex = [0, y + top, 0], under = [0, y - r * 0.18, 0];
    for (let k = 0; k < seg; k++) {
      const a = tips[k], b = tips[(k + 1) % seg];
      // 兩個尖端之間加一個縮進的中點，做出鋸齒邊緣
      const m = [(a[0] + b[0]) * 0.36, (a[1] + b[1]) * 0.5 + 0.03, (a[2] + b[2]) * 0.36];
      pos.push(...apex, ...b, ...m, ...apex, ...m, ...a);
      pos.push(...under, ...a, ...m, ...under, ...m, ...b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    parts.push(finalize(g, (x, yy, z, c) => {
      const out = Math.min(1, Math.hypot(x, z) / (r + 1e-3));
      const up = yy > y ? 1 : 0.55;
      c.copy(dark).lerp(mid, out).lerp(tip, Math.max(0, out - 0.6) * 1.6 * t + 0.15 * out);
      c.multiplyScalar(up * (0.8 + 0.3 * t));
    }));
  }
  return mergeGeometries(parts);
}

// 闊葉樹：主幹分叉＋5–7 團凹凸的樹冠
export function broadleafGeometry(seed = 2, lod = 0) {
  const rand = mulberry32(seed);
  const parts = [trunk(0.075, 0.045, 0.85, 0x4b3a2b, 0, lod)];
  for (let b = 0; b < 3; b++) {
    const g = new THREE.CylinderGeometry(0.02, 0.035, 0.5, 5, 1, true);
    g.translate(0, 0.25, 0);
    g.rotateZ((rand() - 0.5) * 1.2); g.rotateY(rand() * Math.PI * 2);
    g.translate(0, 0.62, 0);
    if (!lod) parts.push(finalize(g, (x, y, z, c) => c.set(0x4b3a2b)));
  }
  const crownC = [0, 1.05, 0];
  const n = 8 + Math.floor(rand() * 4);
  const dark = C(0x1c3516), mid = C(0x2f5424), lite = C(0x587a34);
  const blobs = [];
  for (let k = 0; k < n; k++) {
    const a = rand() * Math.PI * 2, rr = k === 0 ? 0 : 0.2 + rand() * 0.22;
    blobs.push({ cx: Math.cos(a) * rr, cz: Math.sin(a) * rr, cy: crownC[1] + (k === 0 ? 0.12 : (rand() - 0.4) * 0.28), R: k === 0 ? 0.34 : 0.17 + rand() * 0.12, ph: rand() * 10 });
  }
  for (const [k, { cx, cy, cz, R, ph }] of blobs.entries()) {
    const jit = mulberry32(seed * 131 + k);
    const g = lod ? new THREE.SphereGeometry(R, 5, 4) : new THREE.SphereGeometry(R, 8, 6);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
      const lump = 1 + 0.16 * Math.sin(x * 13 + ph) * Math.sin(y * 11 + ph * 0.7) * Math.sin(z * 12 + ph * 1.3) + (jit() - 0.5) * 0.08;
      p.setXYZ(v, cx + x * lump, cy + y * lump * 0.82, cz + z * lump);
    }
    g.computeVertexNormals();
    parts.push(finalize(g, (x, y, z, c) => {
      const dc = Math.hypot(x - crownC[0], (y - crownC[1]) * 1.3, z - crownC[2]);
      const outer = Math.min(1, dc / 0.6);
      const h = Math.min(1, Math.max(0, (y - 0.75) / 0.7));
      c.copy(dark).lerp(mid, outer).lerp(lite, Math.max(0, h * outer - 0.35) * 1.4);
    }));
  }
  return mergeGeometries(parts);
}

// 檳榔：細長、略彎的樹幹，頂端羽狀葉
export function palmGeometry(seed = 3) {
  const rand = mulberry32(seed);
  const H = 2.0, bend = 0.12;
  const parts = [];
  const tg = trunk(0.04, 0.03, H, 0x8a7d66, bend);
  // 樹幹環紋
  const p0 = tg.attributes.position, col0 = tg.attributes.color;
  for (let v = 0; v < p0.count; v++) { const ring = 0.85 + 0.15 * Math.sin(p0.getY(v) * 38); col0.setXYZ(v, col0.getX(v) * ring, col0.getY(v) * ring, col0.getZ(v) * ring); }
  parts.push(tg);
  const topX = bend, topY = H;
  const fronds = 9;
  const green = C(0x3f6b2a), yellow = C(0x7d8f3a);
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rand() * 0.3;
    const L = 0.55 + rand() * 0.2;
    const lift = f < 2 ? 0.5 : 0.15 + rand() * 0.2;
    const pos = [];
    const seg = 8;
    let prev = null;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const r = L * t, y = topY + lift * Math.sin(t * Math.PI * 0.9) * 0.6 - t * t * 0.45;
      const w = 0.11 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.01;
      const cx = topX + Math.cos(a) * r, cz = Math.sin(a) * r;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      const cur = [[cx + px, y - w * 0.4, cz + pz], [cx, y, cz], [cx - px, y - w * 0.4, cz - pz]];
      if (prev) {
        pos.push(...prev[0], ...cur[0], ...prev[1], ...prev[1], ...cur[0], ...cur[1]);
        pos.push(...prev[1], ...cur[1], ...prev[2], ...prev[2], ...cur[1], ...cur[2]);
      }
      prev = cur;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    parts.push(finalize(g, (x, y, z, c) => c.copy(green).lerp(yellow, Math.min(1, Math.hypot(x - topX, z) / L) * 0.4)));
  }
  return mergeGeometries(parts);
}

// 灌木：低矮的兩三團
export function shrubGeometry(seed = 4) {
  const rand = mulberry32(seed);
  const parts = [];
  const dark = C(0x253f1c), lite = C(0x4d7030);
  for (let k = 0; k < 3; k++) {
    const R = 0.16 + rand() * 0.1, cx = (rand() - 0.5) * 0.25, cz = (rand() - 0.5) * 0.25;
    const g = new THREE.SphereGeometry(R, 7, 5);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) p.setXYZ(v, cx + p.getX(v) * (1 + (rand() - 0.5) * 0.25), R * 0.7 + p.getY(v) * 0.8, cz + p.getZ(v) * (1 + (rand() - 0.5) * 0.25));
    g.computeVertexNormals();
    parts.push(finalize(g, (x, y, z, c) => c.copy(dark).lerp(lite, Math.min(1, y / (R * 1.6)))));
  }
  return mergeGeometries(parts);
}

// 分地塊的實例：同一種樹依位置分到 size × size 的地塊，每塊一個 InstancedMesh（各有自己的包圍球）。
// 鏡頭拉近時，畫面外的地塊整塊被視錐剔除，主畫面和 GTAO 的法線圖都少畫很多樹。
// items：[{ x, z, matrix, color }]
// lodGeo：遠景用的簡化模型；有給的話每個地塊多一個遠景網格，由 TreeLOD 依鏡頭距離切換。
export function chunkedInstances(geo, mat, items, size = 24, lodGeo = null, lod = null) {
  const groups = new Map();
  for (const it of items) {
    const key = `${Math.floor(it.x / size)},${Math.floor(it.z / size)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const make = (g, list) => {
    const m = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((it, i) => { m.setMatrixAt(i, it.matrix); m.setColorAt(i, it.color); });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const meshes = [];
  for (const list of groups.values()) {
    const hi = make(geo, list);
    meshes.push(hi);
    if (lodGeo && lod?.enabled) { const lo = make(lodGeo, list); meshes.push(lo); lod.add(hi, lo); }
  }
  return meshes;
}

// 遠近切換：地塊離鏡頭超過 far 用簡化模型，回到 near 以內換回完整模型（中間留一段避免來回跳）。
// 做影片時關掉（enabled = false），逐格渲染不在乎速度，也不會有切換的跳動。
export class TreeLOD {
  constructor({ near = 68, far = 80, enabled = true } = {}) { Object.assign(this, { near, far, enabled, chunks: [] }); }
  add(hi, lo) { lo.visible = false; this.chunks.push({ hi, lo, low: false }); }
  update(cam) {
    for (const c of this.chunks) {
      const s = c.hi.boundingSphere, d = cam.distanceTo(s.center) - s.radius;
      if (!c.low && d > this.far) { c.low = true; c.hi.visible = false; c.lo.visible = true; }
      else if (c.low && d < this.near) { c.low = false; c.hi.visible = true; c.lo.visible = false; }
    }
  }
}

// 樹的材質：微風擺動（越高擺越多）＋逆光時葉子透光
// uWet（0–1）：葉面沾滿雨水（截留），葉子變暗、變亮滑，並有閃爍的水珠
export const wetUniform = { value: 0 };
export function treeMaterial({ time, sunDir, wind = 0.035, translucency = 0.5, side = THREE.FrontSide, wet = wetUniform }) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side });
  const u = { uTime: time, uWind: { value: wind }, uSunDir: { value: sunDir.clone() }, uTrans: { value: translucency }, uWet: wet };
  m.userData.uniforms = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uWind;\nvarying vec3 vTreeWP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(0.0);
          #endif
          float hh = max(0.0, transformed.y - 0.25);
          float ph = ip.x * 0.37 + ip.z * 0.29;
          float gust = 0.65 + 0.35 * sin(uTime * 0.23 + ip.x * 0.05);
          transformed.x += (sin(uTime * 1.15 + ph) * 0.7 + sin(uTime * 2.6 + ph * 1.9) * 0.2) * uWind * gust * hh * hh;
          transformed.z += (cos(uTime * 0.93 + ph * 1.3) * 0.45) * uWind * gust * hh * hh;
          #ifdef USE_INSTANCING
            vTreeWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vTreeWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSunDir; uniform float uTrans, uWet, uTime; varying vec3 vTreeWP;
        float tHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float tNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(tHash(i), tHash(i + vec3(1,0,0)), f.x), mix(tHash(i + vec3(0,1,0)), tHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(tHash(i + vec3(0,0,1)), tHash(i + vec3(1,0,1)), f.x), mix(tHash(i + vec3(0,1,1)), tHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // 葉叢：綠色的部分（不含樹幹）加上一團團的明暗，近看再加凹凸；遠處淡掉，避免閃爍
        float leafy = 0.0, leafN = 0.5;
        #ifdef USE_COLOR
          leafy = smoothstep(0.0, 0.03, vColor.g - vColor.r);
        #endif
        float leafNear = 1.0 - smoothstep(25.0, 80.0, length(vViewPosition));
        float leafLo = tNoise(vTreeWP * 5.0);
        leafN = leafLo * 0.7 + tNoise(vTreeWP * 11.0) * 0.3;
        diffuseColor.rgb *= mix(1.0, 0.86 + 0.28 * leafN, leafy * (0.4 + 0.6 * leafNear));
        diffuseColor.rgb *= 1.0 - 0.22 * uWet;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (leafy * leafNear > 0.01) {
          // 用葉叢雜訊當凹凸貼圖（螢幕空間導數），讓樹冠表面有細碎的受光變化
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dFdx(leafLo), dhy = dFdy(leafLo);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad * 0.22 * leafy * leafNear);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, uWet);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float back = pow(saturate(dot(normalize(vViewPosition), -sunV)), 3.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.9, 1.0, 0.55) * uTrans * back;
        }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        if (uWet > 0.01) {
          vec3 cell = floor(vTreeWP * 5.0);
          float r = tHash(cell);
          float tw = 0.55 + 0.45 * sin(uTime * 4.0 + r * 40.0);
          float drop = step(0.86, r) * tw * smoothstep(0.5, 0.95, uWet);
          vec3 f = fract(vTreeWP * 5.0) - 0.5;
          float d = length(f);
          float core = 1.0 - smoothstep(0.05, 0.16, d);
          float halo = (1.0 - smoothstep(0.12, 0.3, d)) * 0.45;
          gl_FragColor.rgb += vec3(0.75, 0.88, 1.0) * (core + halo) * drop * uWet;
        }`);
  };
  return m;
}
