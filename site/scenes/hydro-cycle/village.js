// 平原上的聚落：幾群透天厝與三合院（比例尺：大家知道房子有多大，看了就會把地景換算成真實尺寸）。
// planVillage 只做資料（在建地表網格前呼叫，順便改地表顏色、標出不長樹的地方）；buildVillage 才建 3D 物件。
import * as THREE from 'three';
import { mulberry32, smoothstep, clamp, lerp } from '../lib/noise.js';
import { townHouseGeometry, farmHouseGeometry } from '../lib/buildings.js';

// 各種房子在自己座標系的佔地（u：左右，v：前後，+v 是正面）與屋頂高度（用來讓雨停在屋頂上）
const FOOT = {
  town: { u0: -0.47, u1: 0.47, v0: -0.74, v1: 0.9, top: [0.92, 1.28, 1.28] },   // 2、3、3 層（含屋頂樓梯間、水塔）
  farm: { u0: -0.85, u1: 0.85, v0: -0.42, v1: 1.3, top: [0.64, 0.64, 0.64] },   // 正身＋往前伸的兩側護龍
  farmSolo: { u0: -0.85, u1: 0.85, v0: -0.42, v1: 0.42, top: [0.64, 0.64, 0.64] },
};
const footOf = (kind, v) => (kind === 'farm' && v === 2 ? FOOT.farmSolo : FOOT[kind]);

export function planVillage(T, { H, slopeAt, paddy, tCol, riverHalf, streamMask }) {
  const { nx, nz, dx, x0, z0, coast, rdist, ponds, waterLevel, h } = T;
  const x1 = x0 + (nx - 1) * dx, z1 = z0 + (nz - 1) * dx;
  const rand = mulberry32(4242);
  const cell = (x, z) => clamp(Math.round((z - z0) / dx), 0, nz - 1) * nx + clamp(Math.round((x - x0) / dx), 0, nx - 1);
  const coastAt = (z) => coast[clamp(Math.round((z - z0) / dx), 0, nz - 1)];
  const built = new Uint8Array(nx * nz);   // 1 = 房子和院子：不長樹、不畫水田
  const touched = new Set();               // 整平過的地形格子（之後要更新地表網格與法線）
  const pondHit = (x, z, m) => ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 1.22 + m);
  const toWorld = (x, z, yaw, u, v) => [x + u * Math.cos(yaw) + v * Math.sin(yaw), z - u * Math.sin(yaw) + v * Math.cos(yaw)];
  const toLocal = (x, z, yaw, px, pz) => { const ox = px - x, oz = pz - z, c = Math.cos(yaw), s = Math.sin(yaw); return [ox * c - oz * s, ox * s + oz * c]; };

  // ---- 房子 ----
  const houses = [];
  const near = (x, z, r) => houses.some((h2) => Math.hypot(h2.x - x, h2.z - z) < r);
  // 能不能蓋：佔地（含 0.4 的院子）裡夠平、不在水裡或溪床、不在河邊、不在海灘、不壓到別的房子。回傳建地高度（平均）
  function fits(x, z, yaw, f) {
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
      const u = lerp(f.u0 - 0.4, f.u1 + 0.4, a / 4), v = lerp(f.v0 - 0.4, f.v1 + 0.4, b / 4);
      const [px, pz] = toWorld(x, z, yaw, u, v);
      if (px < x0 + 1.3 || px > x1 - 1.3 || pz < z0 + 1.3 || pz > z1 - 1.3) return null;
      const k = cell(px, pz), y = H(px, pz);
      if (built[k] || streamMask?.[k] || waterLevel[k] > -999 || y < 0.2 || slopeAt(k) > 0.14) return null;
      if (rdist[k] < riverHalf + 2.2 || px > coastAt(pz) - 5.2 || pondHit(px, pz, 0.5)) return null;
      lo = Math.min(lo, y); hi = Math.max(hi, y); sum += y; n++;
    }
    if (hi - lo > 0.5) return null;
    return sum / n;
  }
  // 蓋：把建地整平（佔地＋0.25 完全平，往外 0.9 內柔和接回原地形）、塗上院子的顏色、清掉水田
  function claim(x, z, yaw, f, base) {
    const R = Math.hypot(Math.max(-f.u0, f.u1), Math.max(-f.v0, f.v1)) + 1.0;
    for (let j = Math.floor((z - R - z0) / dx); j <= Math.ceil((z + R - z0) / dx); j++)
      for (let i = Math.floor((x - R - x0) / dx); i <= Math.ceil((x + R - x0) / dx); i++) {
        if (i < 1 || j < 1 || i >= nx - 1 || j >= nz - 1) continue;
        const [u, v] = toLocal(x, z, yaw, x0 + i * dx, z0 + j * dx);
        const out = Math.max(f.u0 - u, u - f.u1, f.v0 - v, v - f.v1);
        if (out > 0.9) continue;
        const k = j * nx + i;
        h[k] = lerp(base, h[k], smoothstep(0.25, 0.9, out));
        touched.add(k);
        if (out > 0.45) continue;
        built[k] = 1; paddy[k] = 0;
        const t = 1 - smoothstep(-0.05, 0.28, out);   // 院子：壓實的土、水泥地（只到房子外一小圈）
        tCol[k * 3] = lerp(tCol[k * 3], 0.27, t); tCol[k * 3 + 1] = lerp(tCol[k * 3 + 1], 0.26, t); tCol[k * 3 + 2] = lerp(tCol[k * 3 + 2], 0.19, t);
      }
  }
  const add = (x, z, yaw, kind, v, pre = null) => {
    const f = footOf(kind, v), base = pre ?? fits(x, z, yaw, f);
    if (base === null) return false;
    claim(x, z, yaw, f, base);
    houses.push({ x, z, y: base, yaw, kind, v, f, top: base + f.top[v], tint: 0.9 + rand() * 0.1, hue: Math.floor(rand() * 4) });
    return true;
  };
  // 聚落：平原上找幾個中心，每個中心一排透天厝（同一個朝向，像一條小街）＋周圍幾戶三合院
  const centers = [];
  for (let t = 0; t < 3000 && centers.length < 5; t++) {
    const x = 9 + rand() * 21, z = z0 + 5 + rand() * (z1 - z0 - 10);
    if (centers.some((c) => Math.hypot(c.x - x, c.z - z) < 13)) continue;
    if (fits(x, z, 0, { u0: -1.6, u1: 1.6, v0: -1.6, v1: 1.6 }) === null) continue;
    centers.push({ x, z, yaw: (rand() - 0.5) * 0.5 });
  }
  for (const c of centers) {
    const nRow = 2 + Math.floor(rand() * 3), slots = [];
    for (let r = 0; r < nRow; r++) {
      const u = (r - (nRow - 1) / 2) * 0.98;
      slots.push([c.x + u * Math.cos(c.yaw), c.z - u * Math.sin(c.yaw), Math.floor(rand() * 3)]);
    }
    // 透天厝要成排才像街屋：整排都蓋得下才蓋；同一排用同一個地基高度（先全部檢查，再一起蓋，彼此的院子不互相擋）
    const bases = slots.map(([x, z, v]) => fits(x, z, c.yaw, footOf('town', v)));
    if (bases.every((b) => b !== null)) {
      const base = bases.reduce((a, b) => a + b, 0) / bases.length;
      for (const [x, z, v] of slots) add(x, z, c.yaw, 'town', v, base);
    }
    const nFarm = 1 + Math.floor(rand() * 3);
    for (let t = 0, n = 0; t < 60 && n < nFarm; t++) {
      const a = rand() * Math.PI * 2, d = 2.8 + rand() * 2.4;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, yaw = c.yaw + (rand() - 0.5) * 0.4;
      if (near(x, z, 2.2)) continue;
      if (add(x, z, yaw, 'farm', Math.floor(rand() * 3))) n++;
    }
  }
  // 散在平原上的幾戶農家
  for (let t = 0, n = 0; t < 400 && n < 7; t++) {
    const x = 10 + rand() * 18, z = z0 + 4 + rand() * (z1 - z0 - 8), yaw = (rand() - 0.5) * 0.6;
    if (near(x, z, 6)) continue;
    if (add(x, z, yaw, 'farm', Math.floor(rand() * 3))) n++;
  }
  // 屋頂高度（雨停在屋頂上用）；不在房子上回傳 -Infinity
  function roofAt(px, pz) {
    for (const hs of houses) {
      if (Math.abs(px - hs.x) > 2 || Math.abs(pz - hs.z) > 2) continue;
      const [u, v] = toLocal(hs.x, hs.z, hs.yaw, px, pz), f = hs.f;
      if (u > f.u0 && u < f.u1 && v > f.v0 && v < f.v1) return hs.top;
    }
    return -Infinity;
  }
  return { houses, built, touched, roofAt };
}

const HUES = [[1.0, 0.95, 0.86], [0.92, 0.93, 0.94], [1.0, 0.9, 0.86], [0.92, 0.96, 0.9]];

export function buildVillage(scene, plan) {
  const { houses } = plan;
  // 房子：每種造型一個 InstancedMesh
  // 天空反光弱一點，牆才不會泛藍白（材質要自己指定 envMap，envMapIntensity 才會生效）
  const houseMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMap: scene.environment, envMapIntensity: 0.65 });
  const kinds = {
    'town-0': townHouseGeometry({ floors: 2, wall: 0xc7c0b2, seed: 3 }),
    'town-1': townHouseGeometry({ floors: 3, wall: 0xbebab1, seed: 5 }),
    'town-2': townHouseGeometry({ floors: 3, w: 0.95, wall: 0xc5bba8, seed: 9 }),
    'farm-0': farmHouseGeometry({ wings: true, wall: 0xc8bfac, roof: 0x8a4632, seed: 2 }),
    'farm-1': farmHouseGeometry({ wings: true, wall: 0xa9765d, roof: 0x7f4030, seed: 4 }),
    'farm-2': farmHouseGeometry({ wings: false, wall: 0xc4bba7, roof: 0x6f5444, seed: 6 }),
  };
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const [key, geo] of Object.entries(kinds)) {
    const list = houses.filter((h2) => `${h2.kind}-${h2.v}` === key);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geo, houseMat, list.length);
    list.forEach((h2, i) => {
      q.setFromAxisAngle(up, h2.yaw);
      mesh.setMatrixAt(i, mtx.compose(new THREE.Vector3(h2.x, h2.y - 0.01, h2.z), q, new THREE.Vector3(1, 1, 1)));
      const hue = h2.kind === 'town' ? HUES[h2.hue] : [1, 0.99, 0.97];
      mesh.setColorAt(i, col.setRGB(h2.tint * hue[0], h2.tint * hue[1], h2.tint * hue[2]));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  return { update() {} };
}
