// 互動實驗頁的背景：一間明亮、霧化的水文實驗室，三位科學家在工作——
// 一位坐在左邊的控制台操作電腦，兩位站在右後方看著模型討論。全部程式生成。
// 動作只由時間 t 決定（逐格錄影可以重現）。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { block, paint } from './buildings.js';
import { broadleafGeometry } from './trees.js';

const V2 = (x, y) => new THREE.Vector2(x, y);
// 合併前一律轉成非索引幾何（RoundedBoxGeometry 和 BoxGeometry 一個有索引、一個沒有）
const mergeAll = (geos) => mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));

// 霧化：離模型越遠，顏色越往背景色靠（只套用在實驗室的物件上，模型本身不受影響）
function hazeOf(mat, H) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, H);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLabW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLabW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLabW;\nuniform vec3 uHazeCol; uniform vec4 uHaze;')
      .replace('#include <fog_fragment>', `#include <fog_fragment>
        {
          float hd = length(vLabW.xz - uHaze.xy);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeCol, smoothstep(uHaze.z, uHaze.w, hd) * 0.35);
        }`);
  };
  mat.customProgramCacheKey = () => 'lab-haze';
  return mat;
}

// ---------- 人物 ----------
const lathe = (pts, seg = 28, phiStart = 0, phiLen = Math.PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg, phiStart, phiLen);
// 錐形肢段：關節在 y = 0，往下長 len；上端半徑 r0、下端 r1，兩端圓頭（像真的上臂、前臂、大腿、小腿）
function limb(r0, r1, len, seg = 14) {
  const pts = [], n = 5;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push([r1 * Math.sin(a), -len - r1 * Math.cos(a)]); }
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push([r0 * Math.cos(a), r0 * 0.6 * Math.sin(a)]); }
  return lathe(pts, seg);
}

// 成人比例（身高 1.75 m 為基準）：頭約 1/7.5 身高、肩寬約 0.38 m、腿長約一半身高
function makePerson(M, { coat = 0xf1f0ec, shirt = 0x8aa6c1, pants = 0x3b4150, skin = 0xd9ad8f, hair = 0x2a211c, style = 'short', glasses = false, h = 1.75, shoes = 0x2b2b2e, female = false } = {}) {
  const mat = (c, r = 0.75) => M(new THREE.MeshStandardMaterial({ color: c, roughness: r }));
  const mCoat = mat(coat, 0.85), mShirt = mat(shirt, 0.85), mPants = mat(pants, 0.82), mSkin = mat(skin, 0.62), mHair = mat(hair, 0.75), mShoe = mat(shoes, 0.5);
  mCoat.side = THREE.DoubleSide;
  const mesh = (g, m) => new THREE.Mesh(g, m);
  const root = new THREE.Group();
  const body = new THREE.Group(); body.scale.setScalar(h / 1.75); root.add(body);
  const shW = female ? 0.158 : 0.172, waist = female ? 0.122 : 0.138, chestR = female ? 0.152 : 0.166, hipR = female ? 0.165 : 0.155;
  // 骨架：hips → spine → chest → neck → head；chest → 肩 → 肘 → 手；hips → 髖 → 膝 → 踝
  const hips = new THREE.Group(); hips.position.y = 0.96; body.add(hips);
  const spine = new THREE.Group(); hips.add(spine);
  // 襯衫軀幹：骨盆 → 腰 → 胸 → 肩 → 頸根（橢圓斷面）
  const torso = mesh(lathe([[0.001, -0.08], [hipR * 0.9, -0.06], [hipR, 0.02], [waist, 0.2], [chestR, 0.38], [chestR * 0.97, 0.46], [shW * 0.72, 0.53], [0.06, 0.575], [0.001, 0.58]]), mShirt);
  torso.scale.z = 0.6; spine.add(torso);
  // 實驗袍：前方開襟、下襬到膝蓋上方、略往外散開
  const gap = 0.42;
  const coatM = mesh(lathe([[hipR + 0.075, -0.5], [hipR + 0.04, -0.25], [hipR + 0.022, 0.0], [waist + 0.03, 0.2], [chestR + 0.018, 0.38], [chestR + 0.012, 0.46], [shW * 0.8, 0.53], [0.075, 0.585]], 32, gap / 2, Math.PI * 2 - gap), mCoat);
  coatM.scale.set(1.02, 1, 0.66); spine.add(coatM);
  // 翻領、口袋、筆
  for (const sd of [-1, 1]) {
    const lap = mesh(new RoundedBoxGeometry(0.045, 0.17, 0.01, 2, 0.004), mCoat);
    lap.position.set(sd * 0.055, 0.44, 0.098); lap.rotation.set(0.12, 0, sd * 0.3); spine.add(lap);
    const pocket = mesh(new RoundedBoxGeometry(0.11, 0.12, 0.008, 2, 0.003), mCoat); pocket.position.set(sd * 0.11, -0.2, 0.118); spine.add(pocket);
  }
  const pen = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.065, 6), mat(0x2f5f9e, 0.4)); pen.position.set(0.085, 0.36, 0.108); spine.add(pen);
  const chest = new THREE.Group(); chest.position.y = 0.47; spine.add(chest);
  const neck = new THREE.Group(); neck.position.y = 0.09; chest.add(neck);
  neck.add(mesh(limb(0.048, 0.05, 0.09), mSkin).translateY(0.08));
  const head = new THREE.Group(); head.position.y = 0.085; neck.add(head);
  // 頭：顱骨＋下顎（蛋形），鼻、耳
  const skull = mesh(new THREE.SphereGeometry(0.094, 28, 20), mSkin); skull.scale.set(0.88, 1.06, 1.0); skull.position.y = 0.115; head.add(skull);
  const jaw = mesh(new THREE.SphereGeometry(0.068, 20, 14), mSkin); jaw.scale.set(0.95, 0.95, 1.0); jaw.position.set(0, 0.06, 0.018); head.add(jaw);
  const nose = mesh(new THREE.ConeGeometry(0.014, 0.04, 8), mSkin); nose.rotation.x = Math.PI / 2 + 0.35; nose.position.set(0, 0.098, 0.098); head.add(nose);
  for (const sd of [-1, 1]) { const ear = mesh(new THREE.SphereGeometry(0.02, 10, 8), mSkin); ear.scale.set(0.45, 1, 0.75); ear.position.set(sd * 0.083, 0.11, 0); head.add(ear); }
  const mEye = mat(0x2a2522, 0.4), mBrow = mat(hair, 0.8);
  for (const sd of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.009, 10, 8), mEye); eye.scale.set(1.2, 0.8, 0.5); eye.position.set(sd * 0.031, 0.122, 0.085); head.add(eye);
    const brow = mesh(new RoundedBoxGeometry(0.028, 0.005, 0.008, 1, 0.002), mBrow); brow.position.set(sd * 0.032, 0.142, 0.086); brow.rotation.z = sd * -0.1; head.add(brow);
  }
  // 頭髮：頭頂與後腦的一層，前緣在髮際線；女性多一個髮髻
  const hairG = new THREE.SphereGeometry(0.1, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const hm = mesh(hairG, mHair); hm.scale.set(0.9, 1.04, 1.02); hm.position.set(0, 0.122, -0.012); hm.rotation.x = -0.5; head.add(hm);
  const back = mesh(new THREE.SphereGeometry(0.09, 20, 14), mHair); back.scale.set(0.95, 0.9, 0.7); back.position.set(0, 0.1, -0.035); head.add(back);
  if (style === 'bun') { const bun = mesh(new THREE.SphereGeometry(0.042, 16, 12), mHair); bun.position.set(0, 0.165, -0.095); head.add(bun); }
  if (glasses) {
    const gm = mat(0x26282b, 0.3);
    for (const sd of [-1, 1]) { const ring = mesh(new THREE.TorusGeometry(0.02, 0.003, 6, 18), gm); ring.scale.y = 0.8; ring.position.set(sd * 0.031, 0.12, 0.09); head.add(ring); }
    const br = mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.022, 5), gm); br.rotation.z = Math.PI / 2; br.position.set(0, 0.122, 0.093); head.add(br);
  }
  // 手臂：圓肩、錐形上臂與前臂（實驗袍袖子）、膚色的手（四指併攏微彎＋拇指）
  const arm = (sd) => {
    const sh = new THREE.Group(); sh.position.set(sd * shW, 0.0, -0.005); chest.add(sh);
    const delt = mesh(new THREE.SphereGeometry(0.056, 16, 12), mCoat); delt.scale.set(1, 0.9, 0.95); sh.add(delt);
    sh.add(mesh(limb(0.05, 0.043, 0.27), mCoat));
    const el = new THREE.Group(); el.position.y = -0.285; sh.add(el);
    el.add(mesh(limb(0.045, 0.04, 0.22), mCoat));
    const hand = new THREE.Group(); hand.position.y = -0.255; el.add(hand);
    const wrist = mesh(limb(0.024, 0.026, 0.02, 10), mSkin); hand.add(wrist);
    const palm = mesh(new RoundedBoxGeometry(0.065, 0.075, 0.026, 2, 0.011), mSkin); palm.position.y = -0.05; hand.add(palm);
    const fing = mesh(new RoundedBoxGeometry(0.062, 0.06, 0.02, 2, 0.009), mSkin); fing.position.set(0, -0.105, 0.006); fing.rotation.x = 0.35; hand.add(fing);
    const thumb = mesh(limb(0.011, 0.009, 0.04, 8), mSkin); thumb.position.set(-sd * 0.03, -0.035, 0.012); thumb.rotation.set(0.4, 0, sd * 0.55); hand.add(thumb);
    return { sh, el, hand };
  };
  // 面向 +z 時，左手在 +x
  const L = arm(1), R = arm(-1);
  const leg = (sd) => {
    const hp = new THREE.Group(); hp.position.set(sd * 0.088, -0.04, 0); hips.add(hp);
    hp.add(mesh(limb(0.082, 0.058, 0.42), mPants));
    const kn = new THREE.Group(); kn.position.y = -0.445; hp.add(kn);
    kn.add(mesh(limb(0.058, 0.044, 0.4), mPants));
    const ft = new THREE.Group(); ft.position.y = -0.43; kn.add(ft);
    const shoe = mesh(new RoundedBoxGeometry(0.09, 0.065, 0.25, 3, 0.03), mShoe); shoe.position.set(0, -0.03, 0.05); ft.add(shoe);
    return { hp, kn, ft };
  };
  const LL = leg(1), LR = leg(-1);
  // 腳下的柔和陰影
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.38, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false }));
  blob.position.y = 0.003; root.add(blob);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  // 預設站姿：手臂自然垂下、手肘微彎
  for (const [sd, a] of [[1, L], [-1, R]]) { a.sh.rotation.set(0.02, 0, sd * 0.07); a.el.rotation.set(-0.18, 0, 0); a.hand.rotation.set(0, sd * 0.3, 0); }
  return { root, body, hips, spine, chest, neck, head, L, R, LL, LR };
}

// ---------- 螢幕、白板（CanvasTexture，淺色介面） ----------
function screenTexture(kind) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 300;
  const g = c.getContext('2d');
  g.fillStyle = '#f3f5f7'; g.fillRect(0, 0, 512, 300);
  g.fillStyle = '#dfe6ec'; g.fillRect(0, 0, 512, 26);
  g.fillStyle = '#0f6c9b'; g.fillRect(12, 9, 60, 8);
  for (let i = 0; i < 3; i++) { g.fillStyle = '#b9c5cf'; g.fillRect(420 + i * 26, 9, 18, 8); }
  if (kind === 0) {   // 歷線
    g.strokeStyle = '#c7d0d8'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(40, 60 + i * 38); g.lineTo(492, 60 + i * 38); g.stroke(); }
    const curve = (col, k, sh) => { g.strokeStyle = col; g.lineWidth = 4; g.beginPath();
      for (let x = 0; x <= 440; x += 4) { const t = x / 440; const y = 250 - k * Math.pow(t * 6, 2) * Math.exp(-t * 6 * sh) * 40; x ? g.lineTo(50 + x, y) : g.moveTo(50, y); } g.stroke(); };
    curve('#2b86e0', 2.6, 1.0); curve('#c26a1d', 1.4, 0.7); curve('#2c9a5b', 0.8, 0.5);
    g.fillStyle = 'rgba(43,134,224,.12)'; g.fillRect(50, 40, 60, 40);
  } else if (kind === 1) {   // 地圖
    g.fillStyle = '#cfe3ef'; g.fillRect(20, 40, 472, 240);
    g.fillStyle = '#9cc28a'; g.beginPath(); g.moveTo(20, 40); g.lineTo(330, 40); g.bezierCurveTo(300, 120, 360, 200, 320, 280); g.lineTo(20, 280); g.fill();
    g.fillStyle = '#5f8f55'; g.beginPath(); g.moveTo(20, 40); g.lineTo(170, 40); g.bezierCurveTo(140, 140, 190, 200, 120, 280); g.lineTo(20, 280); g.fill();
    g.strokeStyle = '#2b86e0'; g.lineWidth = 5; g.beginPath(); g.moveTo(40, 70); g.bezierCurveTo(160, 150, 220, 120, 330, 170); g.stroke();
    g.strokeStyle = 'rgba(15,108,155,.35)'; g.lineWidth = 1;
    for (let x = 20; x < 492; x += 24) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, 280); g.stroke(); }
    for (let y = 40; y < 280; y += 24) { g.beginPath(); g.moveTo(20, y); g.lineTo(492, y); g.stroke(); }
  } else {   // 長條圖＋數值
    const v = [60, 45, 35, 25, 15, 22, 50, 80, 105, 90, 80, 70];
    v.forEach((y, i) => { g.fillStyle = i === 4 ? '#c26a1d' : '#7fb3dd'; g.fillRect(36 + i * 38, 270 - y * 1.9, 28, y * 1.9); });
    g.fillStyle = '#1b2327'; for (let i = 0; i < 4; i++) g.fillRect(36, 44 + i * 14, 120 + (i % 2) * 60, 6);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function whiteboardTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfbf9'; g.fillRect(0, 0, 1024, 512);
  g.lineCap = 'round'; g.lineJoin = 'round';
  // 手繪感的水文循環草圖：山、雲、雨、箭頭
  g.strokeStyle = '#2f5f9e'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(60, 400); g.lineTo(190, 240); g.lineTo(260, 320); g.lineTo(330, 260); g.lineTo(470, 400); g.stroke();
  g.beginPath(); g.moveTo(470, 400); g.bezierCurveTo(560, 395, 600, 405, 700, 400); g.stroke();
  g.beginPath(); g.ellipse(250, 120, 70, 34, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.ellipse(320, 110, 55, 30, 0, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(220 + i * 22, 165); g.lineTo(210 + i * 22, 205); g.stroke(); }
  g.strokeStyle = '#b4532a'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(620, 380); g.bezierCurveTo(640, 250, 560, 160, 420, 130); g.stroke();
  g.beginPath(); g.moveTo(440, 118); g.lineTo(418, 130); g.lineTo(440, 146); g.stroke();
  // 水平衡式（手寫風格）
  g.fillStyle = '#1d3f6e'; g.font = 'italic 48px "Hydro Serif", serif';
  g.fillText('P − (E + T + Q) = ΔS', 530, 120);
  g.font = '40px "Hydro Sans", sans-serif'; g.fillStyle = '#2f5f9e';
  g.fillText('I − O = dS/dt', 600, 200);
  g.strokeStyle = 'rgba(0,0,0,.06)'; g.lineWidth = 2; g.strokeRect(4, 4, 1016, 504);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------- 模糊（霧化）----------
// 9 個取樣的高斯模糊（利用線性內插，一次取樣兩個像素），最後一次順便蒙上一層霧色
const BLUR = new THREE.ShaderMaterial({
  uniforms: { tMap: { value: null }, uStep: { value: new THREE.Vector2() }, uHaze: { value: new THREE.Color() }, uHazeK: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tMap; uniform vec2 uStep; uniform vec3 uHaze; uniform float uHazeK; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tMap, vUv).rgb * 0.2270270270;
      c += (texture2D(tMap, vUv + uStep * 1.3846153846).rgb + texture2D(tMap, vUv - uStep * 1.3846153846).rgb) * 0.3162162162;
      c += (texture2D(tMap, vUv + uStep * 3.2307692308).rgb + texture2D(tMap, vUv - uStep * 3.2307692308).rgb) * 0.0702702703;
      gl_FragColor = vec4(mix(c, uHaze, uHazeK), 1.0);
    }`,
  depthTest: false, depthWrite: false,
});

// ---------- 更多貼圖：大螢幕、海報、百葉窗、天花板 ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// 大螢幕：左邊雷達回波圖，右邊雨量組體圖＋流量歷線
const bigScreenTexture = () => canvasTex(1024, 576, (g, W, H) => {
  g.fillStyle = '#eef2f5'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#d5dee6'; g.fillRect(0, 0, W, 44);
  g.fillStyle = '#0f6c9b'; g.fillRect(18, 14, 120, 16);
  g.fillStyle = '#7d8b97'; for (let i = 0; i < 4; i++) g.fillRect(760 + i * 60, 16, 44, 12);
  // 雷達圖
  g.fillStyle = '#cfdbe4'; g.fillRect(20, 60, 470, 496);
  g.fillStyle = '#b9c7a8'; g.beginPath(); g.moveTo(250, 90); g.bezierCurveTo(330, 160, 360, 330, 300, 520); g.bezierCurveTo(230, 470, 180, 300, 200, 180); g.closePath(); g.fill();
  const blob = (x, y, r, c) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  blob(270, 250, 110, 'rgba(60,160,90,.75)'); blob(290, 260, 60, 'rgba(240,210,60,.85)'); blob(300, 265, 26, 'rgba(220,70,50,.9)'); blob(230, 380, 80, 'rgba(60,160,90,.6)');
  // 雨量組體圖＋流量歷線
  g.strokeStyle = '#c3cdd6'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(520, 120 + i * 80); g.lineTo(1000, 120 + i * 80); g.stroke(); }
  const rain = [3, 6, 12, 22, 30, 18, 9, 4, 2, 1];
  rain.forEach((r, i) => { g.fillStyle = '#5b8fd1'; g.fillRect(530 + i * 46, 70, 34, r * 4.2); });
  g.strokeStyle = '#c26a1d'; g.lineWidth = 5; g.beginPath();
  for (let x = 0; x <= 470; x += 5) { const t = x / 470 * 7; const y = 540 - 300 * Math.pow(t, 2.2) * Math.exp(-t * 1.15) / 1.25; x ? g.lineTo(525 + x, y) : g.moveTo(525, y); }
  g.stroke();
});
// 海報：集水區地圖（等高線＋河網）
const posterTexture = () => canvasTex(512, 700, (g, W, H) => {
  g.fillStyle = '#f6f2ea'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e6dcc8'; g.fillRect(30, 90, 452, 520);
  g.strokeStyle = 'rgba(140,110,70,.55)'; g.lineWidth = 2;
  for (let k = 1; k < 12; k++) { g.beginPath(); g.ellipse(250 + k * 3, 330 - k * 4, 30 + k * 18, 22 + k * 20, 0.3, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = '#2b78c4'; g.lineWidth = 6; g.beginPath(); g.moveTo(80, 600); g.bezierCurveTo(200, 500, 220, 380, 300, 250); g.stroke();
  g.lineWidth = 3; for (const [a, b] of [[[160, 520], [90, 430]], [[230, 410], [150, 330]], [[260, 330], [380, 280]], [[210, 470], [330, 470]]]) { g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
  g.fillStyle = '#1d3f6e'; g.fillRect(30, 30, 300, 26); g.fillStyle = '#7a8a99'; g.fillRect(30, 640, 220, 14);
});
// 百葉窗：外面是明亮的天光
const blindsTexture = () => canvasTex(256, 256, (g, W, H) => {
  for (let x = 0; x < W; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, '#fdfbf6'); gr.addColorStop(0.7, '#f1ece2'); gr.addColorStop(1, '#ddd6ca'); g.fillStyle = gr; g.fillRect(x, 0, 16, H); }
});
// 天花板：輕鋼架天花板的格線
const ceilingTexture = () => canvasTex(256, 256, (g, W, H) => {
  g.fillStyle = '#f3efe8'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#d9d2c6'; g.lineWidth = 6; g.strokeRect(0, 0, W, H);
});

// ---------- 實驗室 ----------
// 背景是一張「固定鏡頭拍的實驗室照片」：自己的場景、自己的固定相機，每格重畫（人物才會動），
// 用約 0.4 倍解析度畫、高斯模糊兩輪、蒙一層紙色霧，再當成主場景的背景。
// 旋轉、縮放 3D 模型時只有模型會動，背景完全不動（使用者要求）。
// 單位：公尺。相機在房間前方、離地 0.6 m，幾乎水平看向後牆：站著的人上半身會出現在模型上方。
export function buildLab(mainScene, { renderer, camera, hazeColor = 0xeeebe4, blur = 0.95, haze = 0.15 }) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(hazeColor);
  const g = new THREE.Group(); scene.add(g);
  const labCam = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
  labCam.position.set(0, 0.62, 6.2); labCam.lookAt(0, 1.0, 0);
  const H = { uHazeCol: { value: new THREE.Color(hazeColor) }, uHaze: { value: new THREE.Vector4(labCam.position.x, labCam.position.z, 6.5, 13.0) } };
  const M = (m) => { m.envMap = roomEnv; m.envMapIntensity = 0.55; return hazeOf(m, H); };
  const mat = (c, r = 0.7, extra = {}) => M(new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra }));
  const glow = (map, k = 0.85) => M(new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: k, roughness: 0.35 }));
  // 靜態的小東西全部用頂點色畫，再依材質合併成幾個網格（draw call 少）
  const solid = [], shiny = [];
  const B = (w, h, d, c, x, y, z, r = 0, ry = 0, list = solid) => { list.push(block(w, h, d, c, x, y, z, r, ry)); };
  const CY = (r0, r1, h, c, x, y, z, seg = 18, list = solid) => { const geo = new THREE.CylinderGeometry(r0, r1, h, seg); geo.translate(x, y, z); list.push(paint(geo, c)); };

  // 房間：左右 10 m、後牆在 z = -2.6、天花板 3.1 m
  const RW = 10, back = -2.6, front = 7, RH = 3.1;
  const floorMat = mat(0xbdb4a5, 0.38);
  floorMat.onBeforeCompile = ((prev) => (sh) => {
    prev(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 tp = vLabW.xz / 0.6; vec2 e = abs(fract(tp) - 0.5); float seam = smoothstep(0.485, 0.497, max(e.x, e.y)); diffuseColor.rgb *= 1.0 - 0.07 * seam; }`);
  })(floorMat.onBeforeCompile);
  floorMat.customProgramCacheKey = () => 'lab-floor';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, front - back).rotateX(-Math.PI / 2), floorMat);
  floor.position.set(0, 0, (front + back) / 2); g.add(floor);
  const wallMat = mat(0xd9d0c1, 0.92);
  const wall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, RH), wallMat); m.position.set(x, RH / 2, z); m.rotation.y = ry; g.add(m); };
  wall(RW, 0, back, 0); wall(front - back, -RW / 2, (front + back) / 2, Math.PI / 2); wall(front - back, RW / 2, (front + back) / 2, -Math.PI / 2);
  const ceilT = ceilingTexture(); ceilT.wrapS = ceilT.wrapT = THREE.RepeatWrapping; ceilT.repeat.set(RW / 0.6, (front - back) / 0.6);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(RW, front - back).rotateX(Math.PI / 2), mat(0xffffff, 0.9, { map: ceilT }));
  ceil.position.set(0, RH, (front + back) / 2); g.add(ceil);
  // 踢腳板
  B(RW, 0.1, 0.02, 0xa9a196, 0, 0.05, back + 0.01); B(0.02, 0.1, front - back, 0xa9a196, -RW / 2 + 0.01, 0.05, (front + back) / 2); B(0.02, 0.1, front - back, 0xa9a196, RW / 2 - 0.01, 0.05, (front + back) / 2);

  // ---- 後牆：大螢幕（雷達回波＋流量歷線）、白板、書架、時鐘、百葉窗 ----
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.63), glow(bigScreenTexture(), 0.95)); scr.position.set(0.15, 1.95, back + 0.065); g.add(scr);
  B(3.0, 1.73, 0.06, 0x2b2e33, 0.15, 1.95, back + 0.03, 0.01);   // 外框比螢幕面退後，避免兩個面搶深度而閃爍
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.95), M(new THREE.MeshStandardMaterial({ map: whiteboardTexture(), roughness: 0.35 }))); wb.position.set(-2.35, 1.6, back + 0.03); g.add(wb);
  B(1.78, 1.03, 0.025, 0xb7b3ab, -2.35, 1.6, back + 0.012, 0.006); B(1.1, 0.025, 0.06, 0xb7b3ab, -2.35, 1.1, back + 0.04);
  // 時鐘
  CY(0.17, 0.17, 0.04, 0xf6f4ef, -2.35, 2.55, back + 0.03, 28); { const geo = new THREE.TorusGeometry(0.17, 0.012, 8, 28); geo.translate(-2.35, 2.55, back + 0.05); solid.push(paint(geo, 0x3a3d42)); }
  B(0.012, 0.11, 0.01, 0x222222, -2.35, 2.59, back + 0.06, 0, 0); B(0.08, 0.012, 0.01, 0x222222, -2.31, 2.55, back + 0.06);
  // 書架（後牆左端）：資料夾、書、收納盒
  {
    const x0 = -4.3, w = 1.3;
    B(w, 2.2, 0.38, 0xc9c1b2, x0, 1.1, back + 0.2, 0.01);
    const bc = [0x2f5f9e, 0xb4532a, 0x3f7f5a, 0xd8b04a, 0x6d5a8a, 0x8a3a3a, 0x2f6f73, 0xe6e1d6];
    for (let s = 0; s < 5; s++) {
      const y = 0.18 + s * 0.42;
      B(w - 0.06, 0.025, 0.34, 0xb3aa9a, x0, y, back + 0.22);
      let x = x0 - w / 2 + 0.06;
      let k = s * 3;
      while (x < x0 + w / 2 - 0.1) {
        const bw = 0.04 + ((k * 37) % 5) * 0.012, bh = 0.24 + ((k * 13) % 4) * 0.03;
        if ((k * 7) % 11 === 0) { B(0.28, 0.16, 0.26, 0xe0d9cb, x + 0.14, y + 0.09, back + 0.22, 0.01); x += 0.32; }
        else { B(bw, bh, 0.27, bc[k % bc.length], x + bw / 2, y + 0.0125 + bh / 2, back + 0.23); x += bw + 0.006; }
        k++;
      }
    }
  }
  // 百葉窗（後牆右側）
  const blinds = blindsTexture(); blinds.wrapS = THREE.RepeatWrapping; blinds.repeat.set(6, 1);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.7), M(new THREE.MeshStandardMaterial({ map: blinds, emissiveMap: blinds, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.8 })));
  win.position.set(3.35, 1.75, back + 0.03); g.add(win);
  B(2.7, 0.05, 0.08, 0xc9c5bc, 3.35, 0.88, back + 0.05); B(2.7, 0.05, 0.05, 0xc9c5bc, 3.35, 2.62, back + 0.04);
  // 右側牆的海報
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.85), M(new THREE.MeshStandardMaterial({ map: posterTexture(), roughness: 0.6 })));
  poster.position.set(RW / 2 - 0.02, 1.65, 1.2); poster.rotation.y = -Math.PI / 2; g.add(poster);

  // ---- 天花板：燈條、出風口 ----
  for (const z of [-1.2, 1.2, 3.6]) {
    const lt = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.03, 0.16), M(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8ec, emissiveIntensity: 2.2 })));
    lt.position.set(0, RH - 0.32, z); g.add(lt);
    B(3.7, 0.05, 0.22, 0xd2ccc2, 0, RH - 0.29, z);
    for (const x of [-1.6, 1.6]) B(0.008, 0.28, 0.008, 0x8c8f93, x, RH - 0.14, z);
  }
  for (const [x, z] of [[-3.2, 0], [3.2, 0], [-3.2, 3], [3.2, 3]]) B(0.6, 0.02, 0.6, 0xe2ddd4, x, RH - 0.01, z);
  // 天花板下的圓形風管與消防管
  { const d = new THREE.CylinderGeometry(0.2, 0.2, front - back, 20); d.rotateX(Math.PI / 2); d.translate(-1.9, RH - 0.28, (front + back) / 2); shiny.push(paint(d, 0xc9ccd0));
    for (let z = back + 0.6; z < front; z += 1.6) { const r = new THREE.TorusGeometry(0.205, 0.012, 6, 20); r.translate(-1.9, RH - 0.28, z); solid.push(paint(r, 0xa9adb2)); }
    const p2 = new THREE.CylinderGeometry(0.03, 0.03, RW, 8); p2.rotateZ(Math.PI / 2); p2.translate(0, RH - 0.12, back + 0.5); solid.push(paint(p2, 0xb4532a)); }
  // 實驗桌上方的吊燈
  for (const x of [2.2, 3.8]) {
    B(0.008, 0.7, 0.008, 0x3a3d42, x, RH - 0.35, back + 0.9);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, 0.2, 24, 1, true), M(new THREE.MeshStandardMaterial({ color: 0x3a3d42, emissive: 0xfff0d0, emissiveIntensity: 0.35, side: THREE.DoubleSide })));
    sh.position.set(x, RH - 0.8, back + 0.9); g.add(sh);
  }

  // ---- 右後方：實驗桌（滲透砂箱、雨量筒、燒杯、樣本瓶）----
  {
    const bx = 3.0, bz = back + 0.75, bw = 3.2;
    B(bw, 0.05, 0.75, 0x4e565e, bx, 0.92, bz, 0.01);
    B(bw - 0.1, 0.88, 0.7, 0xcfc8bb, bx, 0.45, bz);
    for (let i = 0; i < 4; i++) B(0.74, 0.008, 0.01, 0xa9a196, bx - bw / 2 + 0.42 + i * 0.8, 0.7, bz + 0.355);
    // 滲透砂箱：玻璃箱裡的土層、地下水
    const tx = bx - 0.85, ty = 0.95;
    B(0.9, 0.12, 0.3, 0x8a6a4a, tx, ty + 0.06, bz, 0, 0, shiny);
    B(0.9, 0.1, 0.3, 0xc2a26e, tx, ty + 0.17, bz, 0, 0, shiny);
    B(0.9, 0.06, 0.3, 0x5d4a35, tx, ty + 0.25, bz, 0, 0, shiny);
    B(0.9, 0.08, 0.3, 0x5aa7d8, tx, ty + 0.05, bz + 0.0, 0, 0, shiny);
    // 雨量筒、燒杯、樣本瓶
    CY(0.08, 0.08, 0.36, 0xc8cdd2, bx + 0.05, ty + 0.18, bz - 0.1, 24, shiny); CY(0.095, 0.05, 0.07, 0xb0b6bc, bx + 0.05, ty + 0.39, bz - 0.1, 24, shiny);
    for (let i = 0; i < 6; i++) { CY(0.03, 0.03, 0.14, 0xe9eef2, bx + 0.45 + (i % 3) * 0.08, ty + 0.07, bz + 0.12 - Math.floor(i / 3) * 0.09, 12, shiny); CY(0.012, 0.012, 0.03, [0x2f5f9e, 0xb4532a, 0x3f7f5a][i % 3], bx + 0.45 + (i % 3) * 0.08, ty + 0.155, bz + 0.12 - Math.floor(i / 3) * 0.09, 10); }
    for (let i = 0; i < 3; i++) { CY(0.05, 0.045, 0.14 + i * 0.03, 0xdcecf4, bx + 1.0 + i * 0.13, ty + 0.07 + i * 0.015, bz - 0.05, 18, shiny); CY(0.043, 0.04, 0.06 + i * 0.02, 0x7cb6dc, bx + 1.0 + i * 0.13, ty + 0.035 + i * 0.01, bz - 0.05, 18, shiny); }
    // 桌上方的吊櫃
    B(bw, 0.6, 0.35, 0xd6cfc2, bx, 2.25, back + 0.2, 0.01);
    for (let i = 0; i < 4; i++) B(0.008, 0.54, 0.01, 0xb2aa9c, bx - bw / 2 + 0.8 * (i + 1) - 0.4, 2.25, back + 0.38);
  }

  // ---- 左邊：控制台（電腦、三台螢幕）＋伺服器機櫃＋盆栽 ----
  const DESK = { x: -3.3, z: 1.35, ry: Math.PI / 2 - 0.35 };
  const desk = new THREE.Group(); desk.position.set(DESK.x, 0, DESK.z); desk.rotation.y = DESK.ry; g.add(desk);
  {
    const dparts = [];
    const DB = (w, h, d, c, x, y, z, r = 0) => dparts.push(block(w, h, d, c, x, y, z, r));
    DB(1.8, 0.04, 0.8, 0xdedbd4, 0, 0.74, 0, 0.01);
    for (const x of [-0.85, 0.85]) DB(0.04, 0.72, 0.7, 0x8c8f93, x, 0.36, 0);
    DB(1.66, 0.4, 0.02, 0xc9c6bf, 0, 0.5, -0.3);
    DB(0.44, 0.02, 0.14, 0x3a3d42, 0, 0.77, 0.12, 0.006);
    DB(0.06, 0.02, 0.1, 0x3a3d42, 0.32, 0.77, 0.12, 0.008);
    { const mug = new THREE.CylinderGeometry(0.04, 0.036, 0.1, 16); mug.translate(-0.55, 0.81, 0.15); dparts.push(paint(mug, 0xb4532a)); }
    DB(0.21, 0.01, 0.29, 0xf3f1ec, 0.62, 0.755, 0.1); DB(0.21, 0.01, 0.29, 0xece8df, 0.64, 0.765, 0.08);
    // 檯燈
    { const a = new THREE.CylinderGeometry(0.06, 0.07, 0.02, 16); a.translate(-0.75, 0.77, -0.15); dparts.push(paint(a, 0x3a3d42)); const s = new THREE.CylinderGeometry(0.01, 0.01, 0.35, 8); s.translate(-0.75, 0.94, -0.15); dparts.push(paint(s, 0x3a3d42)); }
    for (let i = 0; i < 3; i++) {
      const mon = new THREE.Group(); mon.position.set((i - 1) * 0.58, 0.76, -0.2); mon.rotation.y = (1 - i) * 0.3; desk.add(mon);
      const st = new THREE.Mesh(mergeAll([block(0.03, 0.3, 0.03, 0x6f7378, 0, 0.15, 0), block(0.2, 0.012, 0.15, 0x6f7378, 0, 0, 0, 0.005), block(0.58, 0.35, 0.025, 0x2b2e33, 0, 0.42, 0, 0.008)]), mat(0xffffff, 0.4, { vertexColors: true }));
      mon.add(st);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.32), glow(screenTexture(i), 0.85)); s.position.set(0, 0.42, 0.0135); mon.add(s);
    }
    desk.add(new THREE.Mesh(mergeAll(dparts), mat(0xffffff, 0.6, { vertexColors: true })));
    const lampHead = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.1, 16, 1, true), M(new THREE.MeshStandardMaterial({ color: 0x3a3d42, emissive: 0xfff0d0, emissiveIntensity: 0.4, side: THREE.DoubleSide })));
    lampHead.position.set(-0.68, 1.1, -0.1); lampHead.rotation.z = 0.6; desk.add(lampHead);
  }
  const chair = new THREE.Group(); chair.position.set(0, 0, 0.65); desk.add(chair);
  chair.add(new THREE.Mesh(mergeAll([
    block(0.48, 0.07, 0.46, 0x3d4652, 0, 0.47, 0, 0.03), block(0.44, 0.55, 0.06, 0x3d4652, 0, 0.82, 0.24, 0.03),
    paint((() => { const c = new THREE.CylinderGeometry(0.025, 0.025, 0.36, 10); c.translate(0, 0.26, 0); return c; })(), 0x6f7378),
    ...[0, 1, 2, 3, 4].map((i) => block(0.03, 0.03, 0.3, 0x6f7378, Math.sin(i * 1.2566) * 0.15, 0.07, Math.cos(i * 1.2566) * 0.15, 0, i * 1.2566)),
  ]), mat(0xffffff, 0.65, { vertexColors: true })));
  // 伺服器機櫃（左後角）
  B(0.62, 2.0, 0.7, 0x3a3f46, -4.45, 1.0, back + 0.5, 0.02);
  { const leds = []; for (let i = 0; i < 18; i++) leds.push(block(0.025, 0.012, 0.005, 0xffffff, -4.62 + (i % 6) * 0.06, 0.6 + Math.floor(i / 6) * 0.45, back + 0.86)); g.add(new THREE.Mesh(mergeAll(leds), M(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x3fbf7f, emissiveIntensity: 2.2 })))); }
  for (let i = 0; i < 6; i++) B(0.56, 0.008, 0.01, 0x5a6068, -4.45, 0.35 + i * 0.3, back + 0.86);

  // ---- 盆栽（左前、右後）----
  const plantGeo = broadleafGeometry(13);
  for (const [x, z, s] of [[-4.3, 1.6, 1.15], [4.4, back + 1.6, 1.25], [1.95, back + 0.4, 0.8]]) {
    CY(0.2, 0.15, 0.36, 0xd8d2c6, x, 0.18, z, 20);
    const p = new THREE.Mesh(plantGeo, mat(0xffffff, 0.8, { vertexColors: true })); p.position.set(x, 0.3, z); p.scale.setScalar(s); g.add(p);
  }
  // 掛衣架與外套
  CY(0.02, 0.02, 1.75, 0x6f7378, 4.6, 0.875, 2.2, 10); CY(0.2, 0.22, 0.03, 0x6f7378, 4.6, 0.02, 2.2, 16);
  B(0.3, 0.75, 0.12, 0xeceae5, 4.6, 1.3, 2.32, 0.03);

  g.add(new THREE.Mesh(mergeAll(solid), mat(0xffffff, 0.68, { vertexColors: true })));
  g.add(new THREE.Mesh(mergeAll(shiny), mat(0xffffff, 0.25, { vertexColors: true })));

  // 室內的光：柔和的天光＋左前上方的暖光＋窗戶那側的補光
  const hemi = new THREE.HemisphereLight(0xfff7ec, 0xb3a690, 1.15);
  const key = new THREE.DirectionalLight(0xfff1de, 1.6); key.position.set(-3, 6, 6);
  const fill = new THREE.DirectionalLight(0xe8f0ff, 0.45); fill.position.set(5, 3, -1);
  scene.add(hemi, key, fill);

  // ---------- 三位科學家 ----------
  const A = makePerson(M, { coat: 0xedebe6, shirt: 0x6f8aa6, pants: 0x34394a, skin: 0xc29478, hair: 0x1f1a17, style: 'short', glasses: true, h: 1.76 });
  const P2 = makePerson(M, { coat: 0xefede8, shirt: 0xa9b9a2, pants: 0x4a4540, skin: 0xdcb398, hair: 0x3b2a20, style: 'bun', h: 1.64, female: true });
  const P3 = makePerson(M, { coat: 0xebe9e4, shirt: 0x7d8ea3, pants: 0x2f3440, skin: 0xae8166, hair: 0x241c18, style: 'short', h: 1.79 });
  // A：坐在左邊的控制台前；P2、P3：站在右後方，面向模型（畫面中央前方）討論
  A.root.position.set(0, 0, 0.67); A.root.rotation.y = Math.PI; desk.add(A.root);
  P2.root.position.set(0.72, 0, 1.75); P2.root.rotation.y = -0.15;
  P3.root.position.set(1.32, 0, 1.45); P3.root.rotation.y = -0.45;
  g.add(P2.root, P3.root);
  A.hips.position.y = 0.53;
  for (const lg of [A.LL, A.LR]) { lg.hp.rotation.x = -1.5; lg.kn.rotation.x = 1.45; lg.ft.rotation.x = 0.05; }
  A.LL.hp.rotation.z = 0.07; A.LR.hp.rotation.z = -0.07;
  P2.LR.hp.rotation.x = -0.05; P2.LR.kn.rotation.x = 0.12; P2.hips.rotation.z = 0.035;
  P3.LL.hp.rotation.x = -0.04; P3.LL.kn.rotation.x = 0.1; P3.hips.rotation.z = -0.03;
  const tablet = new THREE.Group();
  tablet.add(new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.012, 0.19, 2, 0.008), mat(0x2b2e33, 0.35)));
  { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.165).rotateX(-Math.PI / 2), glow(screenTexture(0), 0.7)); s.position.y = 0.0065; tablet.add(s); }
  P3.L.hand.add(tablet); tablet.position.set(-0.1, -0.08, 0.05); tablet.rotation.set(0.2, 0, 1.45);

  // ---------- 動作（只由時間決定） ----------
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const pulse = (t, period, start, dur, ease = 0.8) => { const u = ((t - start) % period + period) % period; return sm(0, ease, u) * (1 - sm(dur - ease, dur, u)); };
  function update(t) {
    // A：打字；每 13 秒轉頭看一下模型
    const look = pulse(t, 13, 4, 3.4, 0.9);
    A.spine.rotation.set(0.12 - 0.04 * look, -0.4 * look, 0);
    A.head.rotation.set(0.18 - 0.1 * look + 0.02 * Math.sin(t * 0.7), -0.8 * look, 0);
    A.chest.rotation.x = 0.01 * Math.sin(t * 1.4);
    const typing = 1 - look;
    for (const [s, arm] of [[1, A.L], [-1, A.R]]) {
      arm.sh.rotation.set(-0.55 + 0.03 * typing * Math.sin(t * 9 + s), 0, s * 0.12);
      arm.el.rotation.set(-1.05 + 0.06 * typing * Math.sin(t * 11.3 + s * 2.1), 0, -s * 0.2);
      arm.hand.rotation.set(0.35, 0, 0);
    }
    A.R.sh.rotation.z = -0.12 - 0.12 * pulse(t, 7, 1.5, 1.6, 0.4);
    chair.rotation.y = -0.25 * look;
    A.root.rotation.y = Math.PI - 0.25 * look;
    // P2：指著模型解說；說話時轉頭看 P3（P3 在她的左後方）
    const talk = pulse(t, 11, 6, 3.0, 0.8);
    P2.spine.rotation.set(0.06 + 0.015 * Math.sin(t * 1.2), 0.2 * talk, 0);
    P2.head.rotation.set(0.2 - 0.12 * talk, 0.85 * talk + 0.06 * Math.sin(t * 0.5), 0);
    P2.R.sh.rotation.set(-0.95 + 0.08 * Math.sin(t * 0.45) + 0.55 * talk, 0, 0.06 + 0.1 * Math.sin(t * 0.32));
    P2.R.el.rotation.set(-0.12 - 0.5 * talk, 0, 0);
    P2.R.hand.rotation.set(-0.15, 0, 0);
    P2.L.sh.rotation.set(0.05, 0, 0.06); P2.L.el.rotation.set(-0.25, 0, 0);
    P2.hips.position.x = 0.012 * Math.sin(t * 0.3);
    // P3：看平板、看模型、點頭；P2 說話時轉頭看她
    const tab = pulse(t, 9, 0, 4.2, 0.9);
    const nod = Math.max(0, Math.sin(t * 2.6)) * pulse(t, 8, 5, 2.2, 0.4);
    P3.spine.rotation.set(0.06 + 0.04 * tab, -0.15 * talk, 0);
    P3.head.rotation.set(0.15 + 0.4 * tab + 0.12 * nod, -0.65 * talk, 0);
    P3.L.sh.rotation.set(-0.35, 0, 0.1); P3.L.el.rotation.set(-1.35, 0, -0.35);
    P3.R.sh.rotation.set(-0.3 - 0.08 * pulse(t, 9, 1.5, 1.2, 0.4), 0, -0.12); P3.R.el.rotation.set(-1.4, 0, 0.4);
    for (const P of [A, P2, P3]) P.chest.scale.set(1, 1 + 0.008 * Math.sin(t * 1.5 + P.root.position.x), 1);
  }
  update(0);

  // ---------- 霧化背景 ----------
  const rtA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const quad = new FullScreenQuad(BLUR);
  BLUR.uniforms.uHaze.value.set(hazeColor);
  const size = new THREE.Vector2();
  function pass(src, dst, dx, dy, hk) {
    BLUR.uniforms.tMap.value = src.texture;
    BLUR.uniforms.uStep.value.set(dx / src.width, dy / src.height);
    BLUR.uniforms.uHazeK.value = hk;
    renderer.setRenderTarget(dst); quad.render(renderer);
  }
  function render() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(16, Math.round(size.x * 0.4)), h = Math.max(16, Math.round(size.y * 0.4));
    if (rtA.width !== w || rtA.height !== h) { rtA.setSize(w, h); rtB.setSize(w, h); }
    // 固定相機：只跟主相機同步畫面比例與左右留白（面板遮住的區域），位置、方向永遠不變
    labCam.aspect = camera.aspect;
    if (camera.view && camera.view.enabled) { const v = camera.view; labCam.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height); }
    else labCam.clearViewOffset();
    labCam.updateProjectionMatrix();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rtA); renderer.render(scene, labCam);
    pass(rtA, rtB, blur, 0, 0); pass(rtB, rtA, 0, blur, 0);
    pass(rtA, rtB, blur * 2, 0, 0); pass(rtB, rtA, 0, blur * 2, haze);
    renderer.setRenderTarget(prev);
    mainScene.background = rtA.texture;
  }
  return { update, render, group: g, scene, camera: labCam, off() { mainScene.background = null; } };
}
