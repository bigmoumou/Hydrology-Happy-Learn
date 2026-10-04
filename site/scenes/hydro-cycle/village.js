// 平原上的聚落：海岸公路（河口有橋）、一條農路、透天厝、三合院、路上慢慢開的小車。
// 用途是比例尺：大家知道房子和車有多大，看了就會把地景換算成真實尺寸。
// planVillage 只做資料（在建地表網格前呼叫，順便改地表顏色、標出不長樹的地方）；buildVillage 才建 3D 物件。
import * as THREE from 'three';
import { mulberry32, smoothstep, clamp, lerp } from '../lib/noise.js';
import { chaikin } from '../lib/flows.js';
import { townHouseGeometry, farmHouseGeometry, carGeometry, block, paint } from '../lib/buildings.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from '../lib/stage.js';

const ROAD_HALF = 0.26, FARM_HALF = 0.16;

// 折線 → 每 step 一點，附累積距離 s 與水平切線
function resample(flat, step = 0.25) {
  const pts = [];
  let carry = 0;
  for (let i = 0; i < flat.length / 3 - 1; i++) {
    const ax = flat[i * 3], az = flat[i * 3 + 2], bx = flat[i * 3 + 3], bz = flat[i * 3 + 5];
    const L = Math.hypot(bx - ax, bz - az);
    for (let t = carry; t < L; t += step) pts.push({ x: lerp(ax, bx, t / L), z: lerp(az, bz, t / L) });
    carry = (carry - L) % step; if (carry < 0) carry += step;
  }
  const n = flat.length / 3 - 1;
  pts.push({ x: flat[n * 3], z: flat[n * 3 + 2] });
  let s = 0;
  pts.forEach((p, i) => {
    if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    p.s = s;
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    p.tx = tx / l; p.tz = tz / l;
  });
  return pts;
}

export function planVillage(T, { H, slopeAt, paddy, tCol, riverHalf }) {
  const { nx, nz, dx, x0, z0, coast, rdist, ponds, waterLevel } = T;
  const x1 = x0 + (nx - 1) * dx, z1 = z0 + (nz - 1) * dx;
  const rand = mulberry32(4242);
  const cell = (x, z) => clamp(Math.round((z - z0) / dx), 0, nz - 1) * nx + clamp(Math.round((x - x0) / dx), 0, nx - 1);
  const coastAt = (z) => coast[clamp(Math.round((z - z0) / dx), 0, nz - 1)];
  const built = new Uint8Array(nx * nz);   // 1 = 路或房子：不長樹、不畫水田
  const pondHit = (x, z, m) => ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 1.22 + m);

  // ---- 海岸公路：沿海岸線的大彎（不跟著每個小岬角扭），在海灘後面；遇到水窪往近的一側繞開 ----
  const base = (z) => 36 + 2.2 * Math.sin(0.11 * z + 0.6) - 7.2;
  const bumps = [];
  for (const p of ponds) {
    const R = p.r * 1.22 + 1.2, b = base(p.z);
    if (Math.abs(b - p.x) >= R) continue;
    const east = p.x + R - b, west = p.x - R - b;
    const push = Math.abs(east) < Math.abs(west) && p.x + R < coastAt(p.z) - 5.4 ? east : west;
    bumps.push({ z: p.z, push, w: R + 3 });
  }
  const raw = [];
  for (let z = z0; z <= z1 + 1e-6; z += 2) {
    let x = base(z);
    for (const b of bumps) x += b.push * Math.exp(-((z - b.z) ** 2) / (b.w * b.w));
    raw.push(x, 0, z);
  }
  const road = resample(chaikin(Float32Array.from(raw), 3));
  // 起訖點拉回方塊邊緣（chaikin 會把端點往內縮）
  road[0].z = Math.max(road[0].z, z0); road[road.length - 1].z = Math.min(road[road.length - 1].z, z1);

  // ---- 橋：公路跨過主河道的那一段 ----
  const span = [];
  road.forEach((p, i) => { if (rdist[cell(p.x, p.z)] < riverHalf + 1.1) span.push(i); });
  let bridge = null;
  if (span.length) {
    const pad = 3;
    const i0 = Math.max(0, span[0] - pad), i1 = Math.min(road.length - 1, span[span.length - 1] + pad);
    const deckY = Math.max(H(road[i0].x, road[i0].z), H(road[i1].x, road[i1].z), 0.6) + 0.22;
    bridge = { i0, i1, deckY };
  }
  const ramp = 10;   // 引道長度（點數）
  road.forEach((p, i) => {
    const g = H(p.x, p.z);
    if (!bridge) { p.y = g; return; }
    const d = i < bridge.i0 ? bridge.i0 - i : i > bridge.i1 ? i - bridge.i1 : 0;
    const k = d === 0 ? 1 : 1 - smoothstep(0, ramp, d);
    p.y = lerp(g, Math.max(g, bridge.deckY), k);
    p.onBridge = d === 0;
  });

  // ---- 農路：從公路往西，進到水田中間的聚落 ----
  const jz = 11;
  const ri = road.reduce((best, p, i) => (Math.abs(p.z - jz) < Math.abs(road[best].z - jz) ? i : best), 0);
  const fr = [road[ri].x, 0, road[ri].z, road[ri].x - 3, 0, jz + 0.3, 21, 0, 11.6, 16, 0, 10.6, 11.6, 0, 9.6];
  const farm = resample(chaikin(Float32Array.from(fr), 3));
  farm.forEach((p) => { p.y = H(p.x, p.z); });

  // ---- 路面佔用與路肩顏色 ----
  const markRoad = (pts, half) => {
    for (const p of pts) {
      if (p.onBridge) continue;
      const R = half + 0.3;
      for (let j = Math.floor((p.z - R - z0) / dx); j <= Math.ceil((p.z + R - z0) / dx); j++)
        for (let i = Math.floor((p.x - R - x0) / dx); i <= Math.ceil((p.x + R - x0) / dx); i++) {
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
          const k = j * nx + i, d = Math.hypot(x0 + i * dx - p.x, z0 + j * dx - p.z);
          if (d > R) continue;
          built[k] = 1; paddy[k] = 0;
          const f = 0.86 + 0.14 * smoothstep(half, R, d);
          tCol[k * 3] *= f; tCol[k * 3 + 1] *= f * 0.99; tCol[k * 3 + 2] *= f * 0.97;
        }
    }
  };
  markRoad(road, ROAD_HALF); markRoad(farm, FARM_HALF);

  // ---- 房子 ----
  const houses = [];
  const near = (x, z, r) => houses.some((h2) => Math.hypot(h2.x - x, h2.z - z) < r);
  // 房子能不能蓋：整塊地夠平、不在水裡、不在河邊、不在海灘、不壓到路
  function fits(x, z, yaw, w, d) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let lo = Infinity, hi = -Infinity;
    for (const [u, v] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, d / 2], [0, -d / 2]]) {
      const px = x + u * c + v * s, pz = z - u * s + v * c;
      if (px < x0 + 1 || px > x1 - 1 || pz < z0 + 1 || pz > z1 - 1) return null;
      const k = cell(px, pz), y = H(px, pz);
      if (built[k] || waterLevel[k] > -999 || y < 0.15 || slopeAt(k) > 0.12) return null;
      if (rdist[k] < riverHalf + 2.2 || px > coastAt(pz) - 5.2 || pondHit(px, pz, 0.5)) return null;
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    if (hi - lo > 0.35) return null;
    return lo;
  }
  function claim(x, z, yaw, w, d, yard) {
    const c = Math.cos(yaw), s = Math.sin(yaw), R = Math.hypot(w, d) / 2 + 0.6;
    for (let j = Math.floor((z - R - z0) / dx); j <= Math.ceil((z + R - z0) / dx); j++)
      for (let i = Math.floor((x - R - x0) / dx); i <= Math.ceil((x + R - x0) / dx); i++) {
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const px = x0 + i * dx - x, pz = z0 + j * dx - z;
        const u = px * c - pz * s, v = px * s + pz * c;
        const out = Math.max(Math.abs(u) - w / 2, Math.abs(v) - d / 2);
        if (out > 0.45) continue;
        const k = j * nx + i;
        built[k] = 1; paddy[k] = 0;
        // 房子周圍：壓實的泥土、水泥地
        const f = 1 - smoothstep(0.05, 0.45, out);
        tCol[k * 3] = lerp(tCol[k * 3], yard[0], f); tCol[k * 3 + 1] = lerp(tCol[k * 3 + 1], yard[1], f); tCol[k * 3 + 2] = lerp(tCol[k * 3 + 2], yard[2], f);
      }
  }
  const YARD = [0.2, 0.175, 0.13];
  // 聚落集中在幾段：河的北岸、橋南、南邊海岸
  const cluster = (z) => Math.max(0.95 * Math.exp(-(((z + 14) / 4.5) ** 2)), 0.95 * Math.exp(-(((z - 9) / 4.0) ** 2)), 0.8 * Math.exp(-(((z - 27) / 3.5) ** 2)), 0.5 * Math.exp(-(((z + 30) / 3) ** 2)));
  for (const p of road) {
    if (p.onBridge || p.s % 0.75 > 0.25) continue;
    for (const side of [-1, 1]) {
      const prob = cluster(p.z) * (side > 0 ? 0.7 : 1);
      if (rand() > prob) continue;
      const nxv = -p.tz * side, nzv = p.tx * side;   // 從路中心往外
      const kind = rand() < 0.78 ? 'town' : 'farm';
      const w = kind === 'town' ? 0.9 : 1.6, d = kind === 'town' ? 1.45 : 1.55;
      const off = ROAD_HALF + 0.32 + d / 2 + (kind === 'farm' ? 0.4 : rand() * 0.15);
      const x = p.x + nxv * off, z = p.z + nzv * off;
      const yaw = Math.atan2(-nxv, -nzv);   // 正面（+z）朝向馬路
      if (near(x, z, kind === 'town' ? 1.05 : 1.9)) continue;
      const y = fits(x, z, yaw, w, d);
      if (y === null) continue;
      claim(x, z, yaw, w, d, YARD);
      houses.push({ x, z, y, yaw, kind, v: Math.floor(rand() * 3), tint: 0.92 + rand() * 0.12 });
    }
  }
  // 農路旁的三合院
  for (const p of farm) {
    if (p.s % 1.0 > 0.25 || p.s < 3) continue;
    for (const side of [-1, 1]) {
      if (rand() > 0.32) continue;
      const nxv = -p.tz * side, nzv = p.tx * side;
      const off = FARM_HALF + 1.3, x = p.x + nxv * off, z = p.z + nzv * off, yaw = Math.atan2(-nxv, -nzv);
      if (near(x, z, 2.4)) continue;
      const y = fits(x, z, yaw, 1.6, 1.6);
      if (y === null) continue;
      claim(x, z, yaw, 1.6, 1.6, YARD);
      houses.push({ x, z, y, yaw, kind: 'farm', v: Math.floor(rand() * 3), tint: 0.92 + rand() * 0.12 });
    }
  }
  // 散在平原上的幾戶農家
  for (let t = 0, n = 0; t < 400 && n < 7; t++) {
    const x = 10 + rand() * 18, z = z0 + 4 + rand() * (z1 - z0 - 8), yaw = (rand() - 0.5) * 0.5 + (rand() < 0.5 ? 0 : Math.PI);
    if (near(x, z, 6)) continue;
    const y = fits(x, z, yaw, 1.6, 1.6);
    if (y === null) continue;
    claim(x, z, yaw, 1.6, 1.6, YARD);
    houses.push({ x, z, y, yaw, kind: 'farm', v: Math.floor(rand() * 3), tint: 0.92 + rand() * 0.12 });
    n++;
  }
  return { road, farm, bridge, houses, built };
}

// 帶狀路面：橫切面 5 個頂點。中間 3 個是路面（橋上用橋面高度），最外側落到地面，
// 所以平地上是很窄的路肩，引道上自然變成路堤斜坡
function roadRibbon(pts, half, H) {
  const pos = [], uv = [], ind = [], C = 5, sh = 0.3;
  const offs = [-half - sh, -half, 0, half, half + sh], us = [-sh / (2 * half), 0, 0.5, 1, 1 + sh / (2 * half)];
  pts.forEach((p, i) => {
    const nxv = -p.tz, nzv = p.tx;
    for (let a = 0; a < C; a++) {
      const o = offs[a], x = p.x + nxv * o, z = p.z + nzv * o, outer = a === 0 || a === C - 1;
      let y;
      if (p.onBridge) y = p.y + (outer ? -0.05 : 0);
      else if (outer) y = H(x, z) - 0.01;
      else y = Math.max(H(x, z), p.y);
      pos.push(x, y + 0.035, z); uv.push(us[a], p.s);
    }
    if (i < pts.length - 1) for (let a = 0; a < C - 1; a++) { const o = i * C + a; ind.push(o, o + 1, o + C, o + 1, o + C + 1, o + C); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ind);
  g.computeVertexNormals();
  return g;
}

function roadMaterial({ color, marks, rainUniform }) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.86, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRain = rainUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRd; varying vec3 vRW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRd = uv; vRW = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vRd; varying vec3 vRW; uniform float uRain;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float paint = 0.0;
        float shoulder = smoothstep(0.0, -0.08, vRd.x) + smoothstep(1.0, 1.08, vRd.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.17, 0.1), clamp(shoulder, 0.0, 1.0));
        ${marks ? `
        paint += (1.0 - smoothstep(0.035, 0.06, vRd.x)) + smoothstep(0.94, 0.965, vRd.x);
        paint += (1.0 - smoothstep(0.012, 0.03, abs(vRd.x - 0.5))) * step(0.5, fract(vRd.y / 0.9));` : ''}
        float an = vnoise(vRW.xz * 6.0) * 0.6 + vnoise(vRW.xz * 23.0) * 0.4;
        diffuseColor.rgb *= 0.9 + 0.18 * an;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.8, 0.77), clamp(paint, 0.0, 1.0) * 0.85);
        diffuseColor.rgb *= 1.0 - 0.3 * uRain;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, uRain);');
  };
  return m;
}

export function buildVillage(scene, plan, { H, rainUniform }) {
  const { road, farm, bridge, houses } = plan;
  // 路
  const asphalt = new THREE.Mesh(roadRibbon(road, ROAD_HALF, H), roadMaterial({ color: 0x4a4c4e, marks: true, rainUniform }));
  const farmRoad = new THREE.Mesh(roadRibbon(farm, FARM_HALF, H), roadMaterial({ color: 0x9d988c, marks: false, rainUniform }));
  asphalt.receiveShadow = farmRoad.receiveShadow = true;
  scene.add(asphalt, farmRoad);

  // 橋：橋面、護欄、橋墩（橢圓柱，順著水流方向）
  if (bridge) {
    const parts = [], a = road[bridge.i0], b = road[bridge.i1];
    const len = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, y = bridge.deckY;
    const conc = 0x9d988e, rail = 0xb9b4aa;
    parts.push(block(len + 0.6, 0.16, ROAD_HALF * 2 + 0.16, conc, 0, y - 0.06, 0, 0.03));
    for (const s of [-1, 1]) {
      parts.push(block(len + 0.6, 0.11, 0.045, rail, 0, y + 0.07, s * (ROAD_HALF + 0.06), 0.01));
      for (let t = -len / 2; t <= len / 2 + 1e-6; t += 0.5) parts.push(block(0.05, 0.11, 0.06, conc, t, y + 0.07, s * (ROAD_HALF + 0.06)));
    }
    const nP = Math.max(2, Math.round(len / 2.2));
    for (let q = 1; q < nP; q++) {
      const t = -len / 2 + (len * q) / nP;
      const wx = cx + Math.cos(yaw) * t, wz = cz - Math.sin(yaw) * t;
      const bed = H(wx, wz) - 0.4, hgt = y - 0.14 - bed;
      const pier = new THREE.CylinderGeometry(0.11, 0.13, hgt, 16);
      pier.scale(1, 1, 2.2);
      pier.translate(t, bed + hgt / 2, 0);
      parts.push(paint(pier, conc));
      parts.push(block(0.34, 0.08, ROAD_HALF * 2 + 0.1, conc, t, y - 0.18, 0, 0.02));   // 帽梁
    }
    const g = mergeGeometries(parts);
    g.rotateY(yaw); g.translate(cx, 0, cz);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // 房子：每種造型一個 InstancedMesh
  const houseMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
  const kinds = {
    'town-0': townHouseGeometry({ floors: 2, wall: 0xd4cec2, seed: 3 }),
    'town-1': townHouseGeometry({ floors: 3, wall: 0xc9c5bc, seed: 5 }),
    'town-2': townHouseGeometry({ floors: 4, w: 0.95, wall: 0xd2c8b6, seed: 9 }),
    'farm-0': farmHouseGeometry({ wings: true, wall: 0xd3cbb9, roof: 0x8a4632, seed: 2 }),
    'farm-1': farmHouseGeometry({ wings: true, wall: 0xa9765d, roof: 0x7f4030, seed: 4 }),
    'farm-2': farmHouseGeometry({ wings: false, wall: 0xcfc6b3, roof: 0x6f5444, seed: 6 }),
  };
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const [key, geo] of Object.entries(kinds)) {
    const list = houses.filter((h2) => `${h2.kind}-${h2.v}` === key);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geo, houseMat, list.length);
    list.forEach((h2, i) => {
      q.setFromAxisAngle(up, h2.yaw);
      mesh.setMatrixAt(i, mtx.compose(new THREE.Vector3(h2.x, h2.y - 0.02, h2.z), q, new THREE.Vector3(1, 1, 1)));
      mesh.setColorAt(i, col.setRGB(h2.tint, h2.tint * 0.99, h2.tint * 0.97));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  // 小車：沿公路來回（時間決定位置，影片逐格輸出也一樣）
  const CARS = [
    [0.02, 1, 0xf2f2ef], [0.23, 1, 0xb8302a], [0.51, 1, 0x9aa3ab], [0.76, 1, 0x2e5d8a],
    [0.12, -1, 0x2a2c2f], [0.4, -1, 0xe9e6dc], [0.66, -1, 0xc79a3a], [0.9, -1, 0x7e8c7a],
  ];
  const cars = new THREE.InstancedMesh(carGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0 }), CARS.length);
  CARS.forEach(([, , c], i) => cars.setColorAt(i, col.set(c)));
  cars.frustumCulled = false;   // 車子會動、陰影圖是靜態的，所以不投影
  scene.add(cars);
  const L = road[road.length - 1].s, speed = 1.1;
  const at = (s) => {
    let lo = 0, hi = road.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (road[m].s <= s) lo = m; else hi = m; }
    const a = road[lo], b = road[hi], f = (s - a.s) / Math.max(1e-6, b.s - a.s);
    return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), y: lerp(a.y, b.y, f), tx: a.tx, tz: a.tz, bridge: a.onBridge };
  };
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
  function update(t) {
    CARS.forEach(([s0, dir], i) => {
      let s = ((s0 * L + dir * speed * t) % L + L) % L;
      const p = at(s);
      const lane = 0.12 * dir;   // 靠右行駛：前進方向的右手邊 = 路的法向 × dir
      const nx2 = -p.tz, nz2 = p.tx;
      const fx = p.tx * dir, fz = p.tz * dir;
      const cx2 = p.x + nx2 * lane, cz2 = p.z + nz2 * lane;
      const gy = p.bridge ? p.y : Math.max(H(cx2, cz2), p.y);
      pos.set(cx2, gy + 0.035, cz2);
      q.setFromAxisAngle(up, Math.atan2(-fz, fx));
      cars.setMatrixAt(i, mtx.compose(pos, q, scl));
    });
    cars.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { update };
}
