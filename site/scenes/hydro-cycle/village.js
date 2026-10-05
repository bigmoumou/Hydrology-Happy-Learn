// 平原上的聚落：幾群透天厝與三合院（比例尺：大家知道房子有多大，看了就會把地景換算成真實尺寸）。
// planVillage 只做資料（在建地表網格前呼叫，順便改地表顏色、標出不長樹的地方）；buildVillage 才建 3D 物件。
import * as THREE from 'three';
import { mulberry32, smoothstep, clamp, lerp } from '../lib/noise.js';
import { townHouseGeometry, farmHouseGeometry } from '../lib/buildings.js';

export function planVillage(T, { H, slopeAt, paddy, tCol, riverHalf, streamMask }) {
  const { nx, nz, dx, x0, z0, coast, rdist, ponds, waterLevel } = T;
  const x1 = x0 + (nx - 1) * dx, z1 = z0 + (nz - 1) * dx;
  const rand = mulberry32(4242);
  const cell = (x, z) => clamp(Math.round((z - z0) / dx), 0, nz - 1) * nx + clamp(Math.round((x - x0) / dx), 0, nx - 1);
  const coastAt = (z) => coast[clamp(Math.round((z - z0) / dx), 0, nz - 1)];
  const built = new Uint8Array(nx * nz);   // 1 = 房子和院子：不長樹、不畫水田
  const pondHit = (x, z, m) => ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 1.22 + m);

  // ---- 房子 ----
  const houses = [];
  const near = (x, z, r) => houses.some((h2) => Math.hypot(h2.x - x, h2.z - z) < r);
  // 房子能不能蓋：整塊地夠平、不在水裡或溪床、不在河邊、不在海灘、不壓到別的房子
  function fits(x, z, yaw, w, d) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let lo = Infinity, hi = -Infinity;
    for (const [u, v] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, d / 2], [0, -d / 2]]) {
      const px = x + u * c + v * s, pz = z - u * s + v * c;
      if (px < x0 + 1 || px > x1 - 1 || pz < z0 + 1 || pz > z1 - 1) return null;
      const k = cell(px, pz), y = H(px, pz);
      if (built[k] || streamMask?.[k] || waterLevel[k] > -999 || y < 0.15 || slopeAt(k) > 0.12) return null;
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
  const YARD = [0.21, 0.185, 0.14];
  // 聚落：平原上找幾個中心，每個中心一排透天厝（同一個朝向，像一條小街的兩三間）＋周圍幾戶三合院
  const centers = [];
  for (let t = 0; t < 3000 && centers.length < 5; t++) {
    const x = 9 + rand() * 21, z = z0 + 5 + rand() * (z1 - z0 - 10);
    if (centers.some((c) => Math.hypot(c.x - x, c.z - z) < 13)) continue;
    if (fits(x, z, 0, 3.2, 3.2) === null) continue;
    centers.push({ x, z, yaw: (rand() - 0.5) * 0.5 });
  }
  for (const c of centers) {
    const nRow = 2 + Math.floor(rand() * 3), cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const row = [];
    for (let r = 0; r < nRow; r++) {
      const u = (r - (nRow - 1) / 2) * 0.98, x = c.x + u * cs, z = c.z - u * sn;
      const y = fits(x, z, c.yaw, 0.9, 1.45);
      if (y !== null) row.push({ x, z, y });
    }
    if (row.length >= 2) for (const r of row) {   // 透天厝要成排才像街屋；單獨一棟立在田中間很突兀
      claim(r.x, r.z, c.yaw, 0.9, 1.45, YARD);
      houses.push({ ...r, yaw: c.yaw, kind: 'town', v: Math.floor(rand() * 3), tint: 0.92 + rand() * 0.12 });
    }
    const nFarm = 1 + Math.floor(rand() * 3);
    for (let t = 0, n = 0; t < 60 && n < nFarm; t++) {
      const a = rand() * Math.PI * 2, d = 2.6 + rand() * 2.4;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, yaw = c.yaw + (rand() - 0.5) * 0.4;
      if (near(x, z, 1.9)) continue;
      const y = fits(x, z, yaw, 1.6, 1.6);
      if (y === null) continue;
      claim(x, z, yaw, 1.6, 1.6, YARD);
      houses.push({ x, z, y, yaw, kind: 'farm', v: Math.floor(rand() * 3), tint: 0.92 + rand() * 0.12 });
      n++;
    }
  }
  // 散在平原上的幾戶農家
  for (let t = 0, n = 0; t < 400 && n < 7; t++) {
    const x = 10 + rand() * 18, z = z0 + 4 + rand() * (z1 - z0 - 8), yaw = (rand() - 0.5) * 0.6;
    if (near(x, z, 6)) continue;
    const y = fits(x, z, yaw, 1.6, 1.6);
    if (y === null) continue;
    claim(x, z, yaw, 1.6, 1.6, YARD);
    houses.push({ x, z, y, yaw, kind: 'farm', v: Math.floor(rand() * 3), tint: 0.92 + rand() * 0.12 });
    n++;
  }
  return { houses, built };
}

export function buildVillage(scene, plan) {
  const { houses } = plan;
  // 房子：每種造型一個 InstancedMesh
  const houseMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
  const kinds = {
    'town-0': townHouseGeometry({ floors: 2, wall: 0xd4cec2, seed: 3 }),
    'town-1': townHouseGeometry({ floors: 3, wall: 0xc9c5bc, seed: 5 }),
    'town-2': townHouseGeometry({ floors: 3, w: 0.95, wall: 0xd2c8b6, seed: 9 }),
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

  return { update() {} };
}
