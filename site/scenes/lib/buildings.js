// 程式生成的小建築與交通工具（給地景模型當比例尺）：透天厝、三合院、小車、橋。
// 單位和地形一樣（1 單位約 7–8 公尺）。每個造型都合併成一個幾何，只有 position／normal／color，
// 方便用 InstancedMesh 大量擺放；牆、窗、屋頂的顏色寫在頂點色裡，實例顏色只做些微的冷暖差。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';

const _c = new THREE.Color();

// 幾何 → 非索引、去掉 uv、整個塗上一個顏色
export function paint(g, color) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// 方塊（r > 0 時是圓角方塊）：中心在 (x, y, z)
export function block(w, h, d, color, x = 0, y = 0, z = 0, r = 0, ry = 0) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, color);
}

// 兩坡屋頂：w = x 方向的寬、d = z 方向的深、屋脊高 ph；屋脊沿 z（along='z'）或沿 x（along='x'）
export function gableRoof(w, d, ph, color, x = 0, y = 0, z = 0, along = 'z') {
  // 三角形斷面的底邊 = 和屋脊垂直的那一邊；沿屋脊方向擠出
  const base = along === 'x' ? d : w, len = along === 'x' ? w : d;
  const s = new THREE.Shape();
  s.moveTo(-base / 2, 0); s.lineTo(base / 2, 0); s.lineTo(0, ph); s.lineTo(-base / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  if (along === 'x') g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

const merge = (parts) => mergeGeometries(parts);

// 透天厝：2–4 層、正面朝 +z；一樓鐵捲門、樓上窗帶與陽台、屋頂女兒牆、樓梯間、不鏽鋼水塔
export function townHouseGeometry({ w = 0.9, d = 1.45, floors = 3, wall = 0xe9e3d6, seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const fh = 0.36, H = floors * fh + 0.06, sink = 0.35;
  const glass = 0x33434c, frame = 0xbfb8aa;
  const parts = [block(w, H + sink, d, wall, 0, (H - sink) / 2, 0, 0.02)];
  const fz = d / 2;
  for (let f = 0; f < floors; f++) {
    const y0 = f * fh;
    if (f === 0) {
      parts.push(block(w * 0.78, fh * 0.72, 0.03, rand() < 0.5 ? 0x7d8084 : 0x9a8f80, 0, y0 + fh * 0.36, fz + 0.005));
      parts.push(block(w * 1.02, 0.03, 0.16, frame, 0, y0 + fh * 0.84, fz + 0.07));   // 騎樓雨遮
    } else {
      parts.push(block(w * 0.66, fh * 0.44, 0.03, glass, 0, y0 + fh * 0.56, fz + 0.005));
      parts.push(block(w * 0.98, 0.028, 0.11, frame, 0, y0 + 0.03, fz + 0.05));       // 陽台板
      parts.push(block(w * 0.98, fh * 0.2, 0.02, wall, 0, y0 + fh * 0.13, fz + 0.1)); // 陽台矮牆
      for (const sx of [-1, 1]) parts.push(block(0.03, fh * 0.34, d * 0.22, glass, sx * (w / 2 + 0.005), y0 + fh * 0.55, (rand() - 0.5) * d * 0.3));
    }
  }
  // 屋頂：女兒牆、樓梯間、水塔
  const t = 0.03, ph = 0.07;
  parts.push(block(w, ph, t, wall, 0, H + ph / 2, d / 2 - t / 2), block(w, ph, t, wall, 0, H + ph / 2, -d / 2 + t / 2));
  parts.push(block(t, ph, d, wall, w / 2 - t / 2, H + ph / 2, 0), block(t, ph, d, wall, -w / 2 + t / 2, H + ph / 2, 0));
  parts.push(block(w * 0.42, fh * 0.75, d * 0.28, wall, -w * 0.18, H + fh * 0.37, -d * 0.28, 0.01));
  const tank = new THREE.CylinderGeometry(0.075, 0.075, 0.14, 14);
  tank.translate(w * 0.2, H + 0.12, -d * 0.05);
  parts.push(paint(tank, 0xcfd3d6));
  parts.push(block(0.17, 0.05, 0.17, 0x8d8a84, w * 0.2, H + 0.025, -d * 0.05));
  return merge(parts);
}

// 平房／三合院：正身朝 +z，兩側護龍往前伸，中間是曬穀的埕；紅瓦兩坡屋頂
export function farmHouseGeometry({ wings = true, wall = 0xd3cbb9, roof = 0x8a4632, seed = 2 } = {}) {
  const rand = mulberry32(seed);
  const sink = 0.35, wh = 0.4, door = 0x5b4030, glass = 0x34424a;
  const W = 1.55, D = 0.62;
  const parts = [block(W, wh + sink, D, wall, 0, (wh - sink) / 2, 0)];
  parts.push(gableRoof(W + 0.14, D + 0.16, 0.24, roof, 0, wh, 0, 'x'));
  parts.push(block(0.22, 0.28, 0.02, door, 0, 0.14, D / 2 + 0.006));
  for (const sx of [-1, 1]) parts.push(block(0.2, 0.13, 0.02, glass, sx * 0.48, 0.22, D / 2 + 0.006));
  if (wings) {
    const ww = 0.46, wd = 0.95;
    for (const sx of [-1, 1]) {
      const cx = sx * (W / 2 - ww / 2), cz = D / 2 + wd / 2 - 0.02;
      parts.push(block(ww, wh * 0.9 + sink, wd, wall, cx, (wh * 0.9 - sink) / 2, cz));
      parts.push(gableRoof(ww + 0.12, wd + 0.06, 0.18, roof, cx, wh * 0.9, cz, 'z'));
      parts.push(block(0.02, 0.24, 0.16, door, cx - sx * (ww / 2 + 0.006), 0.12, cz + 0.18));
      parts.push(block(0.02, 0.12, 0.14, glass, cx - sx * (ww / 2 + 0.006), 0.2, cz - 0.2));
    }
    parts.push(block(W - ww * 2 + 0.04, 0.02, wd, 0xc2b597, 0, 0.0, D / 2 + wd / 2));   // 埕
  }
  parts.push(block(0.16, 0.12, 0.16, 0x9b9488, (rand() - 0.5) * 0.6, wh + 0.16, -D * 0.15));   // 屋頂上的小水塔座
  return merge(parts);
}

// 小車：車身朝 +x，車底在 y = 0
export function carGeometry() {
  const parts = [
    block(0.36, 0.08, 0.17, 0xffffff, 0, 0.065, 0, 0.025),
    block(0.19, 0.07, 0.15, 0x2f3a41, -0.02, 0.135, 0, 0.025),
    block(0.03, 0.03, 0.15, 0x1d1f21, 0.11, 0.025, 0), block(0.03, 0.03, 0.15, 0x1d1f21, -0.11, 0.025, 0),
  ];
  return merge(parts);
}
