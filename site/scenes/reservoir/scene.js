// 水庫場景：峽谷大壩＋樹枝狀水庫＋入流河、出流河；前切面是水庫縱剖面
// 用法：const rv = await createReservoir(container, { onProgress })；rv.setLevel(L)、rv.setFlows({ I, O, spill })
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStage, strataMaterial, buildBlockFaces, arrowMesh, GLSL_NOISE } from '../lib/stage.js';
import { mulberry32, createNoise2D, smoothstep, clamp, lerp } from '../lib/noise.js';
import { sampleBilinear } from '../lib/grid.js';
import { makeWaterNormal, makeDetailNormal } from '../lib/textures.js';
import { coniferGeometry, broadleafGeometry, shrubGeometry, treeMaterial, chunkedInstances, TreeLOD } from '../lib/trees.js';
import { buildDamDetails } from './structures.js';

export const RV_STEPS = [
  { id: 'rv-overview', cam: [[-36, 62, 76], [-6, 3, -16]] },
  { id: 'rv-system', cam: [[-30, 66, 84], [-4, 3, -16]] },
  { id: 'rv-section', cam: [[-10, 20, 62], [-10, 6, 0]] },
  { id: 'rv-area', cam: [[-24, 46, 52], [-14, 8, -14]] },
  { id: 'rv-dam', cam: [[50, 31, 22], [19, 9, -3]] },
  { id: 'rv-lab', cam: [[-30, 64, 92], [-2, 2, -16]] },
];

const loadTerrain = (seed, onProgress) => new Promise((resolve, reject) => {
  const w = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e) => { if (e.data.type === 'progress') onProgress(e.data.stage, e.data.p); else { w.terminate(); resolve(e.data.data); } };
  w.onerror = (err) => { w.terminate(); reject(err); };
  w.postMessage({ seed });
});

export async function createReservoir(container, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const quality = opts.quality || 'high';
  const stage = createStage(container, { quality, capture: !!opts.capture, steps: RV_STEPS, shadowBox: 95, sunDir: new THREE.Vector3(-0.35, 0.7, 0.62) });
  const { scene, timeUniform } = stage;
  const T = await loadTerrain(opts.seed ?? 3, onProgress);
  onProgress('建立 3D 模型', 0.3);
  const { nx, nz, dx, x0, z0, h, thal, ao, curve, damX, crest, spill, bottom } = T;
  const x1 = x0 + (nx - 1) * dx, z1 = z0 + (nz - 1) * dx;
  const X = (i) => x0 + i * dx, Z = (j) => z0 + j * dx;
  const H = (x, z) => sampleBilinear(h, nx, nz, (x - x0) / dx, (z - z0) / dx);
  const N = nx * nz;
  const rand = mulberry32(17);
  const nn = createNoise2D(mulberry32(5));
  const thalAt = (x) => { const f = clamp((x - x0) / dx, 0, nx - 1.001), i = f | 0; return lerp(thal[i], thal[i + 1], f - i); };

  // 高度貼圖（水面著色器判斷水深用）
  const hTex = new THREE.DataTexture(h, nx, nz, THREE.RedFormat, THREE.FloatType);
  hTex.magFilter = hTex.minFilter = THREE.LinearFilter; hTex.needsUpdate = true;
  const tTex = new THREE.DataTexture(thal, nx, 1, THREE.RedFormat, THREE.FloatType);
  tTex.magFilter = tTex.minFilter = THREE.LinearFilter; tTex.needsUpdate = true;
  const U = {
    uTime: timeUniform, uLevel: { value: 11 }, uDI: { value: 0.35 }, uDO: { value: 0.45 }, uSpill: { value: 0 }, uRelease: { value: 0.5 },
    uVI: { value: 1.5 }, uVO: { value: 2 }, uH: { value: hTex }, uThal: { value: tTex },
    uGrid: { value: new THREE.Vector4(x0, z0, dx, 0) }, uSize: { value: new THREE.Vector2(nx, nz) }, uDamX: { value: damX }, uCrest: { value: crest },
  };
  const GLSL_H = `
    uniform sampler2D uH, uThal; uniform vec4 uGrid; uniform vec2 uSize; uniform float uDamX, uLevel, uDI, uDO, uCrest;
    float hAt(vec2 xz){ vec2 uv = ((xz - uGrid.xy) / uGrid.z + 0.5) / uSize; return texture2D(uH, uv).r; }
    float thalAt(float x){ return texture2D(uThal, vec2(((x - uGrid.x) / uGrid.z + 0.5) / uSize.x, 0.5)).r; }
    float levelAt(float x){ float b = thalAt(x); return x < uDamX ? max(uLevel, b + uDI) : b + uDO; }
  `;

  // ---------- 地表 ----------
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), col = new Float32Array(N * 3), uvs = new Float32Array(N * 2);
  const c = new THREE.Color(), c2 = new THREE.Color();
  const P = (hex) => new THREE.Color(hex);
  const pal = { grassA: P(0x86a250), grassB: P(0x6e8d41), forestA: P(0x4b6a31), forestB: P(0x3a5426), rock: P(0x7a7266), rockD: P(0x575047), gravel: P(0xb6ac96) };
  const slopeArr = new Float32Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = X(i), z = Z(j), y = h[k];
    pos.set([x, y, z], k * 3);
    const gx = (h[j * nx + Math.min(nx - 1, i + 1)] - h[j * nx + Math.max(0, i - 1)]) / (2 * dx);
    const gz = (h[Math.min(nz - 1, j + 1) * nx + i] - h[Math.max(0, j - 1) * nx + i]) / (2 * dx);
    const il = 1 / Math.hypot(gx, 1, gz);
    nor.set([-gx * il, il, -gz * il], k * 3);
    uvs.set([x * 0.35, z * 0.35], k * 2);
    const slope = 1 - il; slopeArr[k] = slope;
    const n1 = 0.5 + 0.5 * nn(x * 0.09, z * 0.09), n2 = 0.5 + 0.5 * nn(x * 0.31 + 20, z * 0.31);
    c.copy(pal.grassA).lerp(pal.grassB, n1);
    c2.copy(pal.forestA).lerp(pal.forestB, n2);
    c.lerp(c2, smoothstep(crest - 1, crest + 4, y) * 0.85);
    c2.copy(pal.rock).lerp(pal.rockD, n1);
    c.lerp(c2, smoothstep(0.45, 0.62, slope + (n2 - 0.5) * 0.12));
    if (x > damX && Math.abs(z) < 4.5) c.lerp(pal.gravel, (1 - smoothstep(2.5, 4.5, Math.abs(z))) * (1 - smoothstep(0.1, 0.25, slope)));
    const o = 0.45 + 0.55 * ao[k];
    col.set([c.r * o, c.g * o, c.b * o], k * 3);
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1; idx[q++] = a; idx[q++] = cc; idx[q++] = b; idx[q++] = b; idx[q++] = cc; idx[q++] = d; }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  tGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tGeo.computeBoundingSphere();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, normalMap: makeDetailNormal(), normalScale: new THREE.Vector2(0.5, 0.5) });
  terrainMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uLevel: U.uLevel, uCrest: U.uCrest, uDamX: U.uDamX });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nuniform float uLevel, uCrest, uDamX;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float mn = vnoise(vWP.xz * 1.6) * 0.6 + vnoise(vWP.xz * 5.3) * 0.4;
          diffuseColor.rgb *= 0.88 + 0.24 * mn;
          float steep = 1.0 - smoothstep(0.6, 0.8, vWN.y);
          if (steep > 0.01) {
            vec2 dn = normalize(vWN.xz + 1e-4);
            float across = dot(vWP.xz, vec2(-dn.y, dn.x));
            float streak = vnoise(vec2(across * 2.2, vWP.y * 0.35)) * 0.65 + vnoise(vec2(across * 7.0, vWP.y * 0.9)) * 0.35;
            float crack = smoothstep(0.62, 0.8, vnoise(vec2(across * 1.3, vWP.y * 2.4)));
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.74 + 0.4 * streak) * (1.0 - 0.32 * crack), steep);
          }
          if (vWP.x < uDamX + 0.2) {
            // 消落帶（水位變動區）：裸露的淺色土石；剛退水的地方較暗較濕
            float ring = smoothstep(uLevel - 0.02, uLevel + 0.05, vWP.y) * (1.0 - smoothstep(uCrest + 0.1, uCrest + 0.6, vWP.y));
            vec3 bare = mix(vec3(0.19, 0.15, 0.105), vec3(0.13, 0.105, 0.075), vnoise(vWP.xz * 2.2));
            bare *= 0.93 + 0.07 * smoothstep(-0.3, 0.3, sin(vWP.y * 18.0 + vnoise(vWP.xz) * 3.0));
            float wet = 1.0 - smoothstep(0.0, 0.5, vWP.y - uLevel);
            bare = mix(bare, bare * vec3(0.62, 0.6, 0.56), wet);
            diffuseColor.rgb = mix(diffuseColor.rgb, bare, ring);
            // 水下：泥沙淤積的湖底
            float under = 1.0 - smoothstep(uLevel - 0.05, uLevel, vWP.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.13, 0.095) * (0.85 + 0.2 * mn), under);
          }
        }`);
  };
  const terrain = new THREE.Mesh(tGeo, terrainMat);
  terrain.receiveShadow = true; terrain.castShadow = true;
  scene.add(terrain);
  buildBlockFaces(scene, { h, nx, nz, x0, z0, dx, bottom, material: strataMaterial({ bottom, timeUniform }), soilAt: (x, z, y) => lerp(2.5, 7, smoothstep(14, 4, y)) });

  // ---------- 水面（上游：水庫＋入流河；下游：出流河）----------
  const waterNormal = makeWaterNormal();
  function waterMat(side) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, transparent: true, normalMap: waterNormal, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 1.25 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { uSide: { value: side } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${GLSL_H}\nuniform float uSide;\nvarying vec3 vWP;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
          transformed.y = levelAt(wp0.x) + 0.01;
          vWP = vec3(wp0.x, transformed.y, wp0.z);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_H}\n${GLSL_NOISE}\nuniform float uTime, uSpill, uRelease, uVI, uVO, uSide;\nvarying vec3 vWP;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float depth = vWP.y - hAt(vWP.xz);
          if (depth < 0.0) discard;
          float riverness = uSide > 0.5 ? 1.0 : smoothstep(0.0, 0.12, thalAt(vWP.x) + uDI - uLevel);
          vec3 shallow = mix(vec3(0.36, 0.55, 0.50), vec3(0.42, 0.58, 0.5), riverness), deep = vec3(0.07, 0.24, 0.30);
          vec3 base = mix(shallow, deep, smoothstep(0.0, 6.0, depth));
          float a = mix(0.45, 0.94, smoothstep(0.0, 2.5, depth));
          float foam = (1.0 - smoothstep(0.0, 0.12, depth)) * (0.5 + 0.5 * vnoise(vWP.xz * 3.0 + uTime * 0.4));
          if (uSide > 0.5) {
            float toe = exp(-max(0.0, vWP.x - (uDamX + 12.5)) / 3.0) * step(uDamX + 9.0, vWP.x);
            vec2 fp = vec2(vWP.x * 0.8 - uTime * uVO, vWP.z * 2.0);
            float n = vnoise(fp) * 0.6 + vnoise(fp * 2.3) * 0.4;
            foam = max(foam, toe * (0.4 * uRelease + uSpill) * smoothstep(0.3, 0.8, n) * 1.6);
          } else if (riverness > 0.5) {
            vec2 fp = vec2(vWP.x * 0.8 - uTime * uVI, vWP.z * 2.0);
            foam = max(foam, smoothstep(0.55, 0.85, vnoise(fp) * 0.6 + vnoise(fp * 2.3) * 0.4) * 0.35);
          }
          foam = clamp(foam, 0.0, 1.0);
          diffuseColor.rgb = mix(base, vec3(0.93, 0.96, 0.96), foam * 0.85);
          diffuseColor.a = max(a, foam * 0.9);`)
        .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
          float flowing = uSide > 0.5 ? 1.0 : smoothstep(0.0, 0.12, thalAt(vWP.x) + uDI - uLevel);
          float sp = uSide > 0.5 ? uVO : uVI;
          vec2 uvW = vWP.xz * 0.09;
          float t1 = fract(uTime * 0.5), t2 = fract(uTime * 0.5 + 0.5);
          vec3 fA = texture2D(normalMap, uvW + vec2(-t1 * sp * 0.09, 0.0)).xyz * 2.0 - 1.0;
          vec3 fB = texture2D(normalMap, uvW * 1.31 + vec2(-t2 * sp * 0.09, 0.37)).xyz * 2.0 - 1.0;
          vec3 fN = normalize(mix(fB, fA, 1.0 - abs(1.0 - 2.0 * t1)));
          vec3 m1 = texture2D(normalMap, uvW + vec2(uTime * 0.011, uTime * 0.007)).xyz * 2.0 - 1.0;
          vec3 m2 = texture2D(normalMap, uvW * 1.73 + vec2(-uTime * 0.008, uTime * 0.012)).xyz * 2.0 - 1.0;
          vec3 cN = normalize(vec3(m1.xy + m2.xy, m1.z));
          vec3 mapN = normalize(mix(cN, fN, flowing));`);
    };
    return m;
  }
  function waterPlane(xa, xb, za, zb, side) {
    const g = new THREE.PlaneGeometry(xb - xa, zb - za, Math.round((xb - xa) / 0.4), Math.round((zb - za) / 0.4));
    g.rotateX(-Math.PI / 2); g.translate((xa + xb) / 2, 0, (za + zb) / 2);
    const m = new THREE.Mesh(g, waterMat(side));
    m.renderOrder = 3; m.frustumCulled = false; m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  waterPlane(x0, damX + 0.15, z0, z1, 0);
  const toeX = damX + 1.4 + 0.78 * (crest - (T.floorDam - 1.7));
  waterPlane(damX + 6, x1, -9, z1, 1);

  // 前切面的水體斷面（縱剖面上看得到水有多深）
  {
    const cols = Math.round((x1 - x0) / 0.25);
    const p2 = new Float32Array((cols + 1) * 2 * 3), top = new Float32Array((cols + 1) * 2);
    for (let i = 0; i <= cols; i++) {
      const x = x0 + i * 0.25;
      p2.set([x, 0, z1 + 0.02, x, 0, z1 + 0.02], i * 6);
      top[i * 2] = 1; top[i * 2 + 1] = 0;
    }
    const ind = [];
    for (let i = 0; i < cols; i++) { const a = i * 2; if (Math.abs(x0 + i * 0.25 - damX) < 0.3) continue; ind.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p2, 3));
    g.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    g.setIndex(ind);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { ...U },
      vertexShader: `${GLSL_H}\nattribute float aTop; varying float vD; varying float vTop; varying float vX;
        void main(){ vec3 p = position; float lv = levelAt(p.x); float hb = hAt(vec2(p.x, ${z1.toFixed(3)} - 0.01));
          p.y = aTop > 0.5 ? lv : min(hb, lv); vD = lv - p.y; vTop = lv - hb; vX = p.x;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float uTime; varying float vD; varying float vTop; varying float vX;
        void main(){ if (vTop <= 0.01) discard;
          vec3 col = mix(vec3(0.13, 0.44, 0.50), vec3(0.03, 0.13, 0.19), smoothstep(0.0, 12.0, vD));
          col += vec3(0.03, 0.07, 0.08) * (0.5 + 0.5 * sin(vX * 0.6 + vD * 0.5 + uTime * 0.4)) * exp(-vD * 0.2);
          col = mix(col, vec3(0.62, 0.86, 0.93), 1.0 - smoothstep(0.0, 0.08, vD));
          float a = max(mix(0.4, 0.8, smoothstep(0.0, 12.0, vD)), 1.0 - smoothstep(0.0, 0.08, vD));
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    m.renderOrder = 2; m.frustumCulled = false;
    scene.add(m);
  }

  // ---------- 大壩（重力壩，前端切開看得到斷面）----------
  const spZ0 = -4.3, spZ1 = -1.7; // 溢洪道寬度範圍（z）：峽谷中段，壩面露出來的地方
  const damMat = new THREE.MeshStandardMaterial({ color: 0x9f9a90, roughness: 0.88, metalness: 0 });
  damMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uLevel: U.uLevel });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform float uLevel;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float joint = 1.0 - smoothstep(0.0, 0.035, abs(fract(vWP.z / 3.5) - 0.5) * 3.5 - 1.7);
          float lift = 1.0 - smoothstep(0.0, 0.02, abs(fract(vWP.y / 0.75) - 0.5) * 0.75 - 0.35);
          float stain = vnoise(vec2(vWP.z * 6.0, vWP.y * 0.4)) * smoothstep(0.2, 1.0, vnoise(vec2(vWP.z * 0.7, vWP.y * 0.15)));
          vec3 cc = diffuseColor.rgb * (0.93 + 0.1 * vnoise(vWP.zy * 3.0));
          cc *= 1.0 - 0.18 * joint - 0.06 * lift - 0.16 * stain * step(0.3, vWN.x);
          if (vWN.x < -0.5) cc = mix(cc, cc * vec3(0.55, 0.58, 0.55), smoothstep(uLevel + 0.4, uLevel - 0.1, vWP.y));
          diffuseColor.rgb = cc;
        }`);
  };
  let damZEnd = z1;
  {
    const zs = [];
    let zEnd = z1;
    for (let z = z1; z > z0 + 2; z -= 0.25) { zs.push(z); if (H(damX, z) > crest + 0.8 && z < -6) { zEnd = z; break; } }
    const prof = (z) => {
      let base = Infinity;
      for (let x = damX; x < damX + 1.4 + 0.78 * (crest + 2); x += 0.5) base = Math.min(base, H(x, z));
      base = Math.min(base, H(damX, z)) - 1.0;
      const top = z < spZ1 && z > spZ0 ? spill : crest;
      return [[damX, base], [damX, top], [damX + 1.4, top], [damX + 1.4 + 0.78 * (top - base), base]];
    };
    const faces = [[], [], []];
    for (let s = 0; s < zs.length - 1; s++) {
      const za = zs[s], zb = zs[s + 1], pa = prof(za), pb = prof(zb);
      for (let f = 0; f < 3; f++) {
        const a0 = pa[f], a1 = pa[f + 1], b0 = pb[f], b1 = pb[f + 1];
        faces[f].push(a0[0], a0[1], za, b0[0], b0[1], zb, a1[0], a1[1], za, a1[0], a1[1], za, b0[0], b0[1], zb, b1[0], b1[1], zb);
      }
    }
    damZEnd = zEnd;
    const geos = faces.map((arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g; });
    // 前端斷面
    const pf = prof(z1 - 0.01);
    const cap = new THREE.BufferGeometry();
    const zc = z1 + 0.04;
    cap.setAttribute('position', new THREE.Float32BufferAttribute([pf[0][0], pf[0][1], zc, pf[2][0], pf[2][1], zc, pf[1][0], pf[1][1], zc, pf[0][0], pf[0][1], zc, pf[3][0], pf[3][1], zc, pf[2][0], pf[2][1], zc], 3));
    cap.computeVertexNormals();
    // 斷面用不受光的混凝土剖面材質（與土層切面一致）
    const capMesh = new THREE.Mesh(cap, new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; ${GLSL_NOISE}
        void main(){
          float agg = smoothstep(0.82, 0.9, hash12(floor(vP.xy * 9.0)));
          vec3 col = vec3(0.56, 0.55, 0.52) * (0.93 + 0.1 * vnoise(vP.xy * 2.0)) - agg * 0.08;
          float lift = 1.0 - smoothstep(0.0, 0.03, abs(fract(vP.y / 0.75) - 0.5) * 0.75 - 0.34);
          col *= 1.0 - 0.1 * lift;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    scene.add(capMesh);
    // 溢洪道閘墩
    for (let pz = spZ0; pz <= spZ1 + 1e-6; pz += (spZ1 - spZ0) / 3) { const pier = new THREE.BoxGeometry(1.4, crest - spill + 0.3, 0.3); pier.translate(damX + 0.7, (crest + spill) / 2, pz); geos.push(pier.toNonIndexed()); }
    const deck = new THREE.BoxGeometry(1.0, 0.3, spZ1 - spZ0 + 0.3); deck.translate(damX + 0.5, crest - 0.12, (spZ0 + spZ1) / 2); geos.push(deck.toNonIndexed());
    const dam = new THREE.Mesh(mergeGeometries(geos.map((g) => { g.deleteAttribute('uv'); return g; })), damMat);
    dam.castShadow = true; dam.receiveShadow = true;
    scene.add(dam);
  }

  // 溢洪道水流（水位高過溢洪道頂才有）
  const spillMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: timeUniform, uSpill: U.uSpill },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime, uSpill; varying vec2 vUv; ${GLSL_NOISE}
      void main(){ if (uSpill < 0.01) discard;
        // 溢流：順著陡槽拉長的白水條紋，越往下摻氣越多、越白
        float down = 1.0 - vUv.y;
        vec2 p = vec2(vUv.x * 16.0, vUv.y * 2.2 + uTime * 2.6);
        float n = vnoise(p) * 0.55 + vnoise(p * vec2(2.3, 3.1)) * 0.3 + vnoise(p * vec2(5.0, 7.0)) * 0.15;
        float aer = smoothstep(0.0, 0.6, down);
        vec3 col = mix(vec3(0.42, 0.62, 0.66), vec3(0.95, 0.97, 0.97), clamp(smoothstep(0.35, 0.7, n) * (0.35 + 0.65 * aer) + aer * 0.35, 0.0, 1.0));
        float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
        gl_FragColor = vec4(col, clamp(uSpill * 2.2, 0.0, 1.0) * (0.7 + 0.3 * n) * edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  {
    const base = H(damX + 1.4 + 0.78 * (spill - (T.floorDam - 2.6)), (spZ0 + spZ1) / 2) + 0.2;
    const run = 0.78 * (spill - base), len = Math.hypot(run, spill - base);
    const g = new THREE.PlaneGeometry(spZ1 - spZ0 - 0.35, len, 6, 24);
    g.rotateY(Math.PI / 2); g.rotateZ(Math.atan(0.78));
    const m = new THREE.Mesh(g, spillMat);
    const nrm = new THREE.Vector2(1, 0.78).normalize();
    m.position.set(damX + 1.4 + run / 2 + nrm.x * 0.08, (spill + base) / 2 + nrm.y * 0.08, (spZ0 + spZ1) / 2);
    m.renderOrder = 4;
    scene.add(m);
  }

  // 壩頂道路、護欄、路燈、取水塔、壓力鋼管、發電廠、溢洪道導牆、小車、小船
  const details = buildDamDetails(scene, { H, damX, crest, spill, spZ0, spZ1, zEnd: damZEnd, z1, thalAt, U, floorDam: T.floorDam });
  stage.onUpdate((t) => details.update(t));

  // ---------- 樹 ----------
  const trees = [];
  const treeLOD = new TreeLOD({ enabled: !opts.capture });
  stage.onUpdate(() => treeLOD.update(stage.camera.position));
  {
    const sp = { conA: { geo: coniferGeometry(11), lo: coniferGeometry(11, 1), list: [] }, brA: { geo: broadleafGeometry(5), lo: broadleafGeometry(5, 1), list: [] }, brB: { geo: broadleafGeometry(17), lo: broadleafGeometry(17, 1), list: [] }, shrub: { geo: shrubGeometry(7), list: [] } };
    const maxN = { high: 5200, medium: 3200, low: 1800 }[quality];
    let count = 0;
    for (let t = 0; t < maxN * 8 && count < maxN; t++) {
      const x = x0 + 1 + rand() * (x1 - x0 - 2), z = z0 + 1 + rand() * (z1 - z0 - 1.5);
      const fi = (x - x0) / dx, fj = (z - z0) / dx, k = Math.round(fj) * nx + Math.round(fi);
      const y = H(x, z);
      if (x < damX + 3 && y < crest + 0.8 && y < thalAt(x) + 4) continue;
      if (x < damX + 3 && y < crest + 0.8) continue;
      if (x >= damX + 3 && (Math.abs(z) < 5 || y < thalAt(x) + 1.2)) continue;
      if (Math.abs(x - damX - 4) < 9 && z > -18) continue;
      if (x > damX && x < damX + 20 && z > -7) continue;   // 發電廠一帶
      if (slopeArr[k] > 0.48) continue;
      const dens = 0.55 + 0.45 * smoothstep(-0.3, 0.4, nn(x * 0.05, z * 0.05)) - smoothstep(26, 31, y);
      if (rand() > dens) continue;
      const r = rand();
      const key = y > 20 ? (r < 0.75 ? 'conA' : 'brA') : (r < 0.3 ? 'conA' : r < 0.62 ? 'brA' : r < 0.9 ? 'brB' : 'shrub');
      sp[key].list.push({ x, y, z, s: 0.8 + rand() * 0.6, rot: rand() * Math.PI * 2, tint: 0.82 + rand() * 0.3 });
      count++;
    }
    const mat = treeMaterial({ time: timeUniform, sunDir: stage.sunDir });
    const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(), cl = new THREE.Color();
    for (const s of Object.values(sp)) {
      if (!s.list.length) continue;
      const items = s.list.map((t2) => {
        e.set(0, t2.rot, 0); qq.setFromEuler(e);
        mtx.compose(new THREE.Vector3(t2.x, t2.y - 0.05, t2.z), qq, new THREE.Vector3(t2.s, t2.s, t2.s));
        trees.push(t2);
        return { x: t2.x, z: t2.z, matrix: mtx.clone(), color: cl.setScalar(t2.tint).clone() };
      });
      for (const mesh of chunkedInstances(s.geo, mat, items, 24, s.lo, treeLOD)) scene.add(mesh);
    }
  }

  // ---------- 收支箭頭與標籤 ----------
  const arrI = arrowMesh(0x2b86e0), arrO = arrowMesh(0xc26a1d), arrS = arrowMesh(0x2c9a5b, { r: 0.35, head: 1.3, headR: 0.9 });
  arrI.rotation.z = -Math.PI / 2; arrO.rotation.z = -Math.PI / 2;
  arrI.position.set(-59, thalAt(-56) + 3.2, -1.2);
  arrO.position.set(damX + 19, thalAt(damX + 22) + 3.2, -1.2);
  arrS.position.set(-14, 11, -8);
  scene.add(arrI, arrO, arrS);
  const labels = {
    inflow: stage.label('入流 I', 'inflow', [-54, thalAt(-54) + 6.2, -1.2]),
    outflow: stage.label('出流 O', 'outflow', [damX + 25, thalAt(damX + 25) + 6.2, -1.2]),
    storage: stage.label('蓄水量 S', 'storage', [-20, 12, -10]),
    dam: stage.label('大壩', 'dam', [damX + 0.7, crest + 0.9, -5.6]),
    spill: stage.label('溢洪道', 'spillway', [damX + 4.6, spill - 2.6, (spZ0 + spZ1) / 2]),
  };
  const showArrows = { value: true };

  // ---------- 狀態 ----------
  const flows = { I: 0.5, O: 0.5, spill: 0 };
  let dSdt = 0;
  function apply() {
    U.uDI.value = 0.18 + 0.55 * flows.I; U.uVI.value = 0.8 + 3.2 * flows.I;
    const out = Math.min(1.2, flows.O + flows.spill);
    U.uDO.value = 0.2 + 0.6 * out; U.uVO.value = 1.0 + 3.5 * out;
    U.uRelease.value = flows.O; U.uSpill.value = flows.spill;
    arrI.setLength(2 + 9 * flows.I); arrO.setLength(2 + 9 * out);
    arrI.visible = arrO.visible = showArrows.value;
    const L = U.uLevel.value;
    arrS.visible = showArrows.value && Math.abs(dSdt) > 0.02;
    arrS.rotation.z = dSdt >= 0 ? 0 : Math.PI;
    arrS.setLength(1.2 + 5 * Math.min(1, Math.abs(dSdt)));
    arrS.position.set(-14, L + (dSdt >= 0 ? 0.6 : 8.6), -8);
    const xI = -57, lvI = Math.max(L, thalAt(xI) + U.uDI.value);
    arrI.position.set(xI - 2, lvI + 2.6, -1.2); labels.inflow.obj.position.set(xI + 2, lvI + 5.4, -1.2);
    labels.storage.obj.position.y = L + 1.0;
    details.setLevel(L);
  }
  apply();

  // 鏡頭步驟時的標籤
  function updateLabels() {
    const id = RV_STEPS[stage.step].id;
    const on = id === 'rv-dam' ? ['dam', 'spill', 'outflow'] : id === 'rv-section' ? ['storage', 'dam'] : ['inflow', 'outflow', 'storage', 'dam'];
    for (const [k, l] of Object.entries(labels)) l.obj.visible = stage.state.labels && on.includes(k);
  }
  stage.onStep(updateLabels);

  // 曲線換算
  const { levels, areas, stores } = curve;
  const interp = (xs, ys, x) => { if (x <= xs[0]) return ys[0]; if (x >= xs[xs.length - 1]) return ys[ys.length - 1]; let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; } return lerp(ys[lo], ys[hi], (x - xs[lo]) / (xs[hi] - xs[lo])); };

  onProgress('完成', 1);
  stage.start();
  // 用原型繼承 stage（不用 ...stage 展開）：time、step 這些 getter 才會一直是最新值
  return Object.assign(Object.create(stage), {
    curve, crest, spill, damX, floorDam: T.floorDam, lowLevel: 8.5, terrain: T,
    storeFromLevel: (L) => interp(levels, stores, L),
    levelFromStore: (S) => interp(stores, levels, S),
    areaAt: (L) => interp(levels, areas, L),
    setLevel(L) { U.uLevel.value = L; apply(); },
    get level() { return U.uLevel.value; },
    setFlows(f) { Object.assign(flows, f); apply(); },
    setRate(r) { dSdt = r; apply(); },
    setArrows(on) { showArrows.value = on; apply(); },
    setLabels(on) { stage.state.labels = on; updateLabels(); },
  });
}
