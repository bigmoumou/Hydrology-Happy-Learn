// 程序產生的貼圖（不需要外部圖檔，可完全離線）
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// 可無縫拼接的值雜訊（週期 period 格）
function tileNoise(size, period, rand) {
  const g = new Float32Array(period * period);
  for (let k = 0; k < g.length; k++) g[k] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * period, fy = (y / size) * period;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const u = fx - ix, v = fy - iy;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = g[(iy % period) * period + (ix % period)];
    const b = g[(iy % period) * period + ((ix + 1) % period)];
    const c = g[((iy + 1) % period) * period + (ix % period)];
    const d = g[((iy + 1) % period) * period + ((ix + 1) % period)];
    out[y * size + x] = (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
  }
  return out;
}

function heightToNormalTexture(hgt, size, strength) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = hgt[y * size + ((x - 1 + size) % size)], r = hgt[y * size + ((x + 1) % size)];
    const u = hgt[((y - 1 + size) % size) * size + x], d = hgt[((y + 1) % size) * size + x];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    const k = (y * size + x) * 4;
    data[k] = (nx * 0.5 + 0.5) * 255; data[k + 1] = (ny * 0.5 + 0.5) * 255; data[k + 2] = (nz * 0.5 + 0.5) * 255; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// 水面法線貼圖：多尺度波紋
export function makeWaterNormal(size = 512, seed = 11) {
  const rand = mulberry32(seed);
  const hgt = new Float32Array(size * size);
  const layers = [[6, 1.0], [12, 0.55], [24, 0.3], [48, 0.16], [96, 0.08]];
  for (const [p, a] of layers) {
    const n = tileNoise(size, p, rand);
    for (let k = 0; k < hgt.length; k++) hgt[k] += a * Math.pow(n[k], 1.6);
  }
  return heightToNormalTexture(hgt, size, 9);
}

// 地表細節法線：土塊與草叢的細碎起伏
export function makeDetailNormal(size = 512, seed = 23) {
  const rand = mulberry32(seed);
  const hgt = new Float32Array(size * size);
  const layers = [[16, 0.6], [32, 0.5], [64, 0.35], [128, 0.25]];
  for (const [p, a] of layers) {
    const n = tileNoise(size, p, rand);
    for (let k = 0; k < hgt.length; k++) hgt[k] += a * n[k];
  }
  return heightToNormalTexture(hgt, size, 5);
}

// 雲朵貼圖：柔邊、帶雜訊
export function makePuffTexture(size = 128, seed = 5) {
  const rand = mulberry32(seed);
  const n1 = tileNoise(size, 8, rand), n2 = tileNoise(size, 16, rand);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const r = Math.hypot(dx, dy);
    const k = y * size + x;
    const nn = 0.6 * n1[k] + 0.4 * n2[k];
    let a = Math.max(0, 1 - r) ** 1.6 * (0.55 + 0.75 * nn);
    a = Math.min(1, a * 1.35);
    data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = 255;
    data[k * 4 + 3] = a * 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
