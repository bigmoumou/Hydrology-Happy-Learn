// 1-2「把體積攤平成水深」：一塊水像潰壩一樣塌下、往四周流開，攤成一層薄薄的水（體積守恆）。
// 水用物理材質（透光、折射率 1.33、藍綠色的吸收），表面有細小漣漪；整段只由時間決定（錄影的虛擬時鐘可以重現）。
// 用法：const demo = mountDepthDemo(div, { onPhase })；demo.start()、demo.stop()
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeWaterNormal } from '../lib/textures.js';

const PLATE = 4.6;              // 地面半邊長（攤平後的範圍）
const A0 = 1.0, H0 = 3.0;       // 水塊半邊長、高度（攤平後只剩約 0.13 的薄層）
const V = (2 * A0) * (2 * A0) * H0;
const LOOP = 9.5;               // 一輪秒數：靜置 1.3 → 流開 3.4 → 攤平、漣漪 3.3 → 淡出 1.5
const ease = (u) => 1 - Math.pow(1 - u, 2.4);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function mountDepthDemo(box, { onPhase = () => {}, capture = false } = {}) {
  const canvas = document.createElement('canvas');
  box.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: capture });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(12.4, 11.6, 15.4); camera.lookAt(0, 0.6, 0.4);
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.2); sun.position.set(-4, 9, 6);
  scene.add(sun, new THREE.HemisphereLight(0xe6eef5, 0x8a7a62, 0.6));

  // 地面：方形的一塊地（集水區），淺土色＋細格線，帶倒角的木座
  const grid = document.createElement('canvas'); grid.width = grid.height = 512;
  { const g = grid.getContext('2d'); g.fillStyle = '#d8c8a6'; g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 2600; k++) { g.fillStyle = `rgba(${120 + Math.random() * 60},${100 + Math.random() * 40},${70 + Math.random() * 30},${0.06 + Math.random() * 0.08})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3); }
    g.strokeStyle = 'rgba(110, 90, 60, .28)'; g.lineWidth = 2;
    for (let k = 0; k <= 8; k++) { const v = k * 64; g.beginPath(); g.moveTo(v, 0); g.lineTo(v, 512); g.moveTo(0, v); g.lineTo(512, v); g.stroke(); } }
  const gridTex = new THREE.CanvasTexture(grid); gridTex.colorSpace = THREE.SRGBColorSpace; gridTex.anisotropy = 8;
  const top = new THREE.Mesh(new THREE.PlaneGeometry(PLATE * 2, PLATE * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.92 }));
  top.position.y = 0.001;
  const base = new THREE.Mesh(new RoundedBoxGeometry(PLATE * 2 + 0.5, 0.6, PLATE * 2 + 0.5, 4, 0.12), new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 0.6 }));
  base.position.y = -0.3;
  scene.add(base, top);

  // 水：高度場網格（每格重算高度與法線）
  const N = 150, geo = new THREE.PlaneGeometry(PLATE * 2 - 0.04, PLATE * 2 - 0.04, N, N).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, X = new Float32Array(pos.count), Z = new Float32Array(pos.count);
  for (let k = 0; k < pos.count; k++) { X[k] = pos.getX(k); Z[k] = pos.getZ(k); }
  const water = new THREE.MeshPhysicalMaterial({
    color: 0xd9ecff, roughness: 0.04, metalness: 0, transmission: 0.92, ior: 1.333, thickness: 1.4,
    // 越厚越藍綠：水塊看得出水的顏色，攤平的薄層幾乎透明（看得到底下的地）
    attenuationColor: new THREE.Color(0x2f86d6), attenuationDistance: 2.8, specularIntensity: 1, envMapIntensity: 1.5,
    normalMap: makeWaterNormal(), normalScale: new THREE.Vector2(0.28, 0.28), transparent: true,
  });
  water.normalMap.repeat.set(2.2, 2.2);
  const mesh = new THREE.Mesh(geo, water);
  scene.add(mesh);

  // 某一時刻的水面：圓角方形的範圍（半邊長 s、圓角 r），高度 H 由體積守恆決定；流開時前緣有一道湧浪
  function heightAt(t) {
    const tt = t % LOOP;
    let s, r, H, edge, surge = 0, ripple = 0, wob = 0;
    if (tt < 1.3) { s = A0; r = 0.08; edge = 0.05; wob = 0.03 * Math.sin(tt * 9) * Math.exp(-tt * 1.5); }
    else if (tt < 4.7) {
      const u = (tt - 1.3) / 3.4, e = ease(u);
      s = A0 + (PLATE - 0.14 - A0) * e; r = 0.08 + (s - 0.08) * 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.7 + (u > 0.9 ? 0 : 0);
      edge = 0.05 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.15));
      surge = 0.35 * Math.sin(Math.PI * Math.min(1, u * 1.2)) * (1 - u);
    } else { s = PLATE - 0.14; r = 0.12; edge = 0.12; ripple = Math.exp(-(tt - 4.7) * 0.9); }
    r = Math.min(r, s * 0.98);
    const area = 4 * s * s - (4 - Math.PI) * r * r;
    H = V / area;
    return { tt, s, r, H, edge, surge, ripple, wob };
  }
  const sd = (x, z, s, r) => { const qx = Math.abs(x) - (s - r), qz = Math.abs(z) - (s - r); return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r; };

  let lastPhase = '';
  function update(t) {
    const st = heightAt(t);
    const { s, r, H, edge, surge, ripple, wob } = st;
    for (let k = 0; k < pos.count; k++) {
      const x = X[k], z = Z[k], d = sd(x, z, s, r);
      let h = 0;
      if (d < 0) {
        h = H * smooth(0, edge, -d);
        h += surge * Math.exp(-(((d + edge * 0.6) / Math.max(0.12, edge * 0.5)) ** 2)) * smooth(0, 0.05, -d);
        if (ripple > 0) h += 0.022 * ripple * Math.sin(Math.hypot(x, z) * 4.2 - t * 5.0) + 0.012 * ripple * Math.sin(x * 3.1 + z * 1.7 - t * 3.6);
        h += wob * Math.sin(x * 2.5 + t * 6) * smooth(0, 0.3, -d);
      }
      pos.setY(k, h > 0.003 ? h + 0.004 : -0.004);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    water.normalMap.offset.set(t * 0.012, t * 0.009);
    // 光穿過的水有多厚就吸收多少：水塊（約 3）藍綠色，攤平的薄層（約 0.13）幾乎透明
    // （薄層保留一點藍色：教學上要看得出「一層水」，不追求完全透明）
    water.thickness = 0.7 + Math.min(1.5, H * 0.5);
    // 淡出再重來
    water.opacity = st.tt > LOOP - 1.5 ? 1 - smooth(LOOP - 1.5, LOOP - 0.4, st.tt) : smooth(0, 0.35, st.tt);
    const phase = st.tt < 1.9 ? 'block' : st.tt > 4.9 && st.tt < LOOP - 1.2 ? 'sheet' : 'flow';
    if (phase !== lastPhase) { lastPhase = phase; onPhase(phase, { depth: V / ((2 * PLATE) ** 2), height: H0 }); }
  }

  function size() {
    const rc = box.getBoundingClientRect();
    const w = Math.max(1, Math.round(rc.width)), h = Math.max(1, Math.round(rc.height));
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  let raf = 0, t0 = 0, running = false;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    size(); update(t); renderer.render(scene, camera);
  }
  return {
    start() { if (running) return; running = true; t0 = performance.now(); lastPhase = ''; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    renderAt(t) { size(); update(t); renderer.render(scene, camera); },
  };
}
