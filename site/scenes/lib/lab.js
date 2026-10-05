// 背景的實驗室：模型放在展示台上，周圍是一間明亮、帶點霧的實驗室，三位科學家在工作——
// 一位坐在控制台前操作電腦，兩位站在模型旁邊看著模型討論。全部程式生成。
// 實驗室內部用公尺建模，整個群組再縮放到場景單位（upm = 每公尺幾個場景單位）。
// 動作只由時間 t 決定（逐格錄影可以重現）。人物不投影（陰影圖是靜態的），接觸暗部交給 GTAO 和腳下的柔和陰影。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

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

// ---------- 實驗室 ----------
// 實驗室在自己的場景裡：每格用約 0.4 倍解析度畫，模糊兩輪、蒙上一層霧，再當成主場景的背景；
// 3D 模型照常清楚地畫在前面（所以「除了模型以外都霧化」）。
// opts：scene（主場景）、camera、cx, cz（模型中心）、top（展示台台面高度，= 模型底座底面）、modelW, modelD（底座的寬、深，場景單位）、upm、hazeColor
export function buildLab(mainScene, { renderer, camera, cx = 0, cz = 0, top, modelW, modelD, upm, hazeColor = 0xeeebe4, blur = 1.15, haze = 0.16 }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(hazeColor);
  // 實驗室用中性的室內環境光（場景共用的是戶外天空，打在淺色牆面上會整片泛藍）。
  // 注意：材質要自己指定 envMap，envMapIntensity 才會生效。
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const PLAT_H = 0.42;
  const floorY = top - PLAT_H * upm;
  const g = new THREE.Group();
  g.position.set(cx, floorY, cz); g.scale.setScalar(upm);
  scene.add(g);
  // 室內的光：柔和的天光＋一盞從左前上方來的暖光
  const hemi = new THREE.HemisphereLight(0xfff7ec, 0xb3a690, 1.1);
  const key = new THREE.DirectionalLight(0xfff1de, 1.7);
  key.position.set(cx - 3 * upm, floorY + 6 * upm, cz + 4 * upm); key.target.position.set(cx, floorY, cz);
  scene.add(hemi, key, key.target);
  const H = { uHazeCol: { value: new THREE.Color(hazeColor) }, uHaze: { value: new THREE.Vector4(cx, cz, 2.0 * upm, 7.0 * upm) } };
  const M = (m) => { m.envMap = roomEnv; m.envMapIntensity = 0.55; return hazeOf(m, H); };
  const mat = (c, r = 0.7, extra = {}) => M(new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra }));
  const mw = modelW / upm, md = modelD / upm;   // 模型底座的公尺尺寸

  // 展示台（模型坐在上面）
  const plat = new THREE.Mesh(new RoundedBoxGeometry(mw + 0.36, PLAT_H, md + 0.36, 4, 0.035), mat(0xd8d0c3, 0.6));
  plat.position.y = PLAT_H / 2 - 0.004; plat.receiveShadow = true; g.add(plat);
  const kick = new THREE.Mesh(new THREE.BoxGeometry(mw + 0.22, 0.05, md + 0.22), mat(0x9a958c, 0.6));
  kick.position.y = 0.025; g.add(kick);

  // 房間：地板、後牆、兩側牆（只從室內看得到；鏡頭繞到外面時像剖開的模型屋）
  const RW = 9.2, RD = 7.6, RH = 3.3, back = -3.4;
  const floorMat = mat(0xbfb6a7, 0.42);
  floorMat.onBeforeCompile = ((prev) => (sh) => {
    prev(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 tp = vLabW.xz / ${upm.toFixed(3)} / 0.6; vec2 e = abs(fract(tp) - 0.5); float seam = smoothstep(0.485, 0.497, max(e.x, e.y)); diffuseColor.rgb *= 1.0 - 0.06 * seam; }`);
  })(floorMat.onBeforeCompile);
  floorMat.customProgramCacheKey = () => 'lab-floor';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD).rotateX(-Math.PI / 2), floorMat);
  floor.position.set(0, 0, back + RD / 2); floor.receiveShadow = true; g.add(floor);
  const wallMat = mat(0xd6cdbd, 0.92);
  wallMat.onBeforeCompile = ((prev) => (sh) => {
    prev(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { float u = (vLabW.x + vLabW.z) / ${upm.toFixed(3)} / 1.2; float seam = smoothstep(0.49, 0.498, abs(fract(u) - 0.5)); diffuseColor.rgb *= 1.0 - 0.05 * seam; }`);
  })(wallMat.onBeforeCompile);
  wallMat.customProgramCacheKey = () => 'lab-wall';
  const wall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, RH), wallMat); m.position.set(x, RH / 2, z); m.rotation.y = ry; g.add(m); return m; };
  wall(RW, 0, back, 0);
  wall(RD, -RW / 2, back + RD / 2, Math.PI / 2);
  wall(RD, RW / 2, back + RD / 2, -Math.PI / 2);
  // 牆腳踢腳板
  const skirt = mat(0xbdb8ae, 0.6);
  const sk = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.02), skirt); m.position.set(x, 0.05, z); m.rotation.y = ry; g.add(m); };
  sk(RW, 0, back + 0.01, 0); sk(RD, -RW / 2 + 0.01, back + RD / 2, Math.PI / 2); sk(RD, RW / 2 - 0.01, back + RD / 2, -Math.PI / 2);
  // 後牆的霧面窗帶（柔光）
  const win = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.5), M(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf6f4ee, emissiveIntensity: 0.85, roughness: 0.9 })));
  win.position.set(1.8, 1.85, back + 0.015); g.add(win);
  const mull = mat(0xc9c5bc, 0.5);
  for (let i = 0; i <= 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.54, 0.03), mull); b.position.set(-0.4 + i * 1.1, 1.85, back + 0.02); g.add(b); }
  for (const y of [1.1, 2.6]) { const b = new THREE.Mesh(new THREE.BoxGeometry(4.44, 0.04, 0.03), mull); b.position.set(1.8, y, back + 0.02); g.add(b); }
  // 白板
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), M(new THREE.MeshStandardMaterial({ map: whiteboardTexture(), roughness: 0.35 })));
  wb.position.set(-2.1, 1.55, back + 0.02); g.add(wb);
  const wbf = new THREE.Mesh(new RoundedBoxGeometry(1.98, 1.03, 0.02, 2, 0.008), mat(0xb7b3ab, 0.4));
  wbf.position.set(-2.1, 1.55, back + 0.008); g.add(wbf);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.025, 0.06), mat(0xb7b3ab, 0.4)); tray.position.set(-2.1, 1.06, back + 0.04); g.add(tray);
  // 天花板的燈條（只看到下緣，在牆頂附近）
  for (const x of [-2.5, 0, 2.5]) {
    const lt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 4.5), M(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfffaf0, emissiveIntensity: 1.6 })));
    lt.position.set(x, RH - 0.05, back + 2.6); g.add(lt);
  }

  // 側邊實驗桌與儀器
  {
    const parts = [];
    const add = (geo, x, y, z) => { geo.translate(x, y, z); parts.push(geo); };
    const bx = -RW / 2 + 0.4;
    add(new RoundedBoxGeometry(0.7, 0.05, 3.2, 2, 0.01), bx, 0.9, back + 2.0);
    add(new THREE.BoxGeometry(0.62, 0.85, 3.1), bx, 0.43, back + 2.0);
    const bench = new THREE.Mesh(mergeAll(parts), mat(0xd9d6cf, 0.55)); g.add(bench);
    const top2 = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.012, 3.22), mat(0x5d6670, 0.4)); top2.position.set(bx, 0.93, back + 2.0); g.add(top2);
    // 儀器：雨量筒、量筒、盒子、筆電
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 24), mat(0xc8cdd2, 0.25, { metalness: 0 })); gauge.position.set(bx, 1.15, back + 0.9); g.add(gauge);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.06, 0.08, 24, 1, true), mat(0xb0b6bc, 0.25)); funnel.material.side = THREE.DoubleSide; funnel.position.set(bx, 1.4, back + 0.9); g.add(funnel);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 16), M(new THREE.MeshStandardMaterial({ color: 0xd8eef8, roughness: 0.1, transparent: true, opacity: 0.55 }))); cyl.position.set(bx + 0.1, 1.08, back + 1.3); g.add(cyl);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 16), mat(0x5aa7d8, 0.2)); water.position.set(bx + 0.1, 1.0, back + 1.3); g.add(water);
    for (const [z, c, w, hh] of [[back + 2.2, 0x7e8b96, 0.35, 0.22], [back + 2.6, 0xe0dcd2, 0.3, 0.16], [back + 2.95, 0x9fb3a1, 0.25, 0.12]]) {
      const b = new THREE.Mesh(new RoundedBoxGeometry(0.4, hh, w, 2, 0.015), mat(c, 0.5)); b.position.set(bx, 0.93 + hh / 2, z); g.add(b);
    }
    const lap = new THREE.Group(); lap.position.set(bx, 0.94, back + 3.3); lap.rotation.y = Math.PI / 2 + 0.3; g.add(lap);
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.015, 0.24, 2, 0.006), mat(0x9ea3a8, 0.35)); lap.add(base);
    const lid = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.22, 0.01, 2, 0.004), mat(0x9ea3a8, 0.35)); lid.position.set(0, 0.11, -0.12); lid.rotation.x = -0.25; lap.add(lid);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), M(new THREE.MeshStandardMaterial({ map: screenTexture(1), emissiveMap: screenTexture(1), emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.3 })));
    scr.position.set(0, 0.11, -0.114); scr.rotation.x = -0.25; lap.add(scr);
  }

  // 儀器櫃（後牆左側，有狀態燈）
  {
    const rack = new THREE.Mesh(new RoundedBoxGeometry(0.62, 2.0, 0.6, 2, 0.02), mat(0xcfccc5, 0.55)); rack.position.set(-RW / 2 + 0.45, 1.0, back + 0.4); g.add(rack);
    const leds = [];
    for (let i = 0; i < 8; i++) { const l = new THREE.BoxGeometry(0.03, 0.012, 0.005); l.translate(-RW / 2 + 0.3 + (i % 4) * 0.05, 1.5 - Math.floor(i / 4) * 0.25, back + 0.705); leds.push(l); }
    g.add(new THREE.Mesh(mergeAll(leds), M(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x3fbf7f, emissiveIntensity: 1.4 }))));
    for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.006, 0.01), mat(0xb5b1a8, 0.5)); p.position.set(-RW / 2 + 0.45, 0.4 + i * 0.42, back + 0.705); g.add(p); }
  }

  // 控制台（後方偏右，靠牆）：桌子、三台螢幕、鍵盤、杯子、椅子
  const DESK = [0.62, back + 0.62];
  const desk = new THREE.Group(); desk.position.set(DESK[0], 0, DESK[1]); g.add(desk);
  {
    const dt = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.04, 0.8, 2, 0.01), mat(0xdedbd4, 0.5)); dt.position.y = 0.74; desk.add(dt);
    for (const x of [-0.85, 0.85]) { const lg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, 0.7), mat(0x8c8f93, 0.4)); lg.position.set(x, 0.36, 0); desk.add(lg); }
    const modesty = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.4, 0.02), mat(0xc9c6bf, 0.6)); modesty.position.set(0, 0.5, -0.3); desk.add(modesty);
    for (let i = 0; i < 3; i++) {
      const mon = new THREE.Group(); mon.position.set((i - 1) * 0.6, 0.76, -0.2); mon.rotation.y = (1 - i) * 0.28; desk.add(mon);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), mat(0x6f7378, 0.35)); stand.position.y = 0.15; mon.add(stand);
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.012, 0.15, 2, 0.005), mat(0x6f7378, 0.35)); mon.add(foot);
      const frame = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.35, 0.025, 2, 0.008), mat(0x2b2e33, 0.4)); frame.position.set(0, 0.42, 0); mon.add(frame);
      const tex = screenTexture(i);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.32), M(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.25 })));
      scr.position.set(0, 0.42, 0.0135); mon.add(scr);
    }
    const kb = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.02, 0.14, 2, 0.006), mat(0x3a3d42, 0.5)); kb.position.set(0, 0.77, 0.12); desk.add(kb);
    const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), mat(0x3a3d42, 0.4)); mouse.scale.set(0.8, 0.45, 1.2); mouse.position.set(0.32, 0.77, 0.12); desk.add(mouse);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.1, 18), mat(0xb4532a, 0.45)); mug.position.set(-0.55, 0.81, 0.15); desk.add(mug);
  }
  const chair = new THREE.Group(); chair.position.set(DESK[0], 0, DESK[1] + 0.65); g.add(chair);
  {
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.07, 0.46, 3, 0.03), mat(0x3d4652, 0.7)); seat.position.y = 0.47; chair.add(seat);
    const bk = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.55, 0.06, 3, 0.03), mat(0x3d4652, 0.7)); bk.position.set(0, 0.82, 0.24); bk.rotation.x = 0.12; chair.add(bk);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 10), mat(0x6f7378, 0.35)); col.position.y = 0.26; chair.add(col);
    for (let i = 0; i < 5; i++) { const a = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), mat(0x6f7378, 0.35)); a.position.set(Math.sin(i * 1.2566) * 0.15, 0.07, Math.cos(i * 1.2566) * 0.15); a.rotation.y = i * 1.2566; chair.add(a); }
  }

  // ---------- 三位科學家 ----------
  const A = makePerson(M, { coat: 0xedebe6, shirt: 0x6f8aa6, pants: 0x34394a, skin: 0xc29478, hair: 0x1f1a17, style: 'short', glasses: true, h: 1.76 });
  const B = makePerson(M, { coat: 0xefede8, shirt: 0xa9b9a2, pants: 0x4a4540, skin: 0xdcb398, hair: 0x3b2a20, style: 'bun', h: 1.64, female: true });
  const C = makePerson(M, { coat: 0xebe9e4, shirt: 0x7d8ea3, pants: 0x2f3440, skin: 0xae8166, hair: 0x241c18, style: 'short', h: 1.79 });
  // A：坐在控制台前（背對鏡頭），B、C：站在模型後方看模型
  A.root.position.set(DESK[0], 0, DESK[1] + 0.67); A.root.rotation.y = Math.PI;
  B.root.position.set(0.1, 0, -1.78); B.root.rotation.y = 0.12;
  C.root.position.set(0.82, 0, -1.72); C.root.rotation.y = -0.32;
  g.add(A.root, B.root, C.root);
  // 坐姿
  A.hips.position.y = 0.53;
  for (const lg of [A.LL, A.LR]) { lg.hp.rotation.x = -1.5; lg.kn.rotation.x = 1.45; lg.ft.rotation.x = 0.05; }
  A.LL.hp.rotation.z = 0.07; A.LR.hp.rotation.z = -0.07;
  // 站姿：重心放在一隻腳（另一腳膝蓋微彎）
  B.LR.hp.rotation.x = -0.05; B.LR.kn.rotation.x = 0.12; B.hips.rotation.z = 0.035;
  C.LL.hp.rotation.x = -0.04; C.LL.kn.rotation.x = 0.1; C.hips.rotation.z = -0.03;
  // C 手上的平板
  const tablet = new THREE.Group();
  {
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.012, 0.19, 2, 0.008), mat(0x2b2e33, 0.35));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.165).rotateX(-Math.PI / 2), M(new THREE.MeshStandardMaterial({ map: screenTexture(0), emissiveMap: screenTexture(0), emissive: 0xffffff, emissiveIntensity: 0.7 })));
    scr.position.y = 0.0065; tablet.add(body, scr);
  }
  C.L.hand.add(tablet); tablet.position.set(-0.1, -0.08, 0.05); tablet.rotation.set(0.2, 0, 1.45);

  // ---------- 動作（只由時間決定） ----------
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // 週期性的「事件」：在 period 秒中，從 start 開始、持續 dur 秒，平滑進出（回傳 0–1）
  const pulse = (t, period, start, dur, ease = 0.8) => { const u = ((t - start) % period + period) % period; return sm(0, ease, u) * (1 - sm(dur - ease, dur, u)); };
  function update(t) {
    // A：打字；每 13 秒轉頭看一下模型
    const look = pulse(t, 13, 4, 3.4, 0.9);
    A.spine.rotation.set(0.12 - 0.04 * look, -0.35 * look, 0);
    A.head.rotation.set(0.18 - 0.1 * look + 0.02 * Math.sin(t * 0.7), -0.75 * look, 0);
    A.chest.rotation.x = 0.01 * Math.sin(t * 1.4);
    const typing = 1 - look;
    for (const [s, arm] of [[1, A.L], [-1, A.R]]) {
      arm.sh.rotation.set(-0.55 + 0.03 * typing * Math.sin(t * 9 + s), 0, s * 0.12);
      arm.el.rotation.set(-1.05 + 0.06 * typing * Math.sin(t * 11.3 + s * 2.1), 0, -s * 0.2);
      arm.hand.rotation.set(0.35, 0, 0);
    }
    // 打字時偶爾伸手去點滑鼠
    A.R.sh.rotation.z = -0.12 - 0.12 * pulse(t, 7, 1.5, 1.6, 0.4);
    chair.rotation.y = -0.3 * look;
    A.root.rotation.y = Math.PI - 0.3 * look;
    // B：指著模型解說，手緩緩移動；偶爾轉頭看 C
    const talkB = pulse(t, 11, 6, 3.0, 0.8);
    B.spine.rotation.set(0.1 + 0.015 * Math.sin(t * 1.2), 0.15 * talkB, 0);
    B.head.rotation.set(0.32 - 0.22 * talkB, 0.75 * talkB + 0.06 * Math.sin(t * 0.5), 0);
    // 指向模型：手臂往前下方伸，指尖跟著說明慢慢移動；轉頭跟 C 說話時手放低
    B.R.sh.rotation.set(-0.95 + 0.08 * Math.sin(t * 0.45) + 0.55 * talkB, 0, 0.06 + 0.1 * Math.sin(t * 0.32));
    B.R.el.rotation.set(-0.12 - 0.5 * talkB, 0, 0);
    B.R.hand.rotation.set(-0.15, 0, 0);
    B.L.sh.rotation.set(0.05, 0, 0.06); B.L.el.rotation.set(-0.25, 0, 0);
    B.hips.position.x = 0.012 * Math.sin(t * 0.3);
    // C：看平板、看模型、點頭；B 說話時轉頭看 B
    const tab = pulse(t, 9, 0, 4.2, 0.9);
    const nod = Math.max(0, Math.sin(t * 2.6)) * pulse(t, 8, 5, 2.2, 0.4);
    C.spine.rotation.set(0.06 + 0.04 * tab, -0.15 * talkB, 0);
    C.head.rotation.set(0.25 + 0.35 * tab + 0.12 * nod, -0.7 * talkB - 0.1 * (1 - tab), 0);
    C.L.sh.rotation.set(-0.35, 0, 0.1); C.L.el.rotation.set(-1.35, 0, -0.35);
    C.R.sh.rotation.set(-0.3 - 0.08 * pulse(t, 9, 1.5, 1.2, 0.4), 0, -0.12); C.R.el.rotation.set(-1.4, 0, 0.4);
    // 呼吸
    for (const P of [A, B, C]) P.chest.scale.set(1, 1 + 0.008 * Math.sin(t * 1.5 + P.root.position.x), 1);
  }
  update(0);

  // 霧化背景
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
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rtA); renderer.render(scene, camera);
    pass(rtA, rtB, blur, 0, 0); pass(rtB, rtA, 0, blur, 0);
    pass(rtA, rtB, blur * 2, 0, 0); pass(rtB, rtA, 0, blur * 2, haze);
    renderer.setRenderTarget(prev);
    mainScene.background = rtA.texture;
  }
  return { update, render, floorY, group: g, scene, off() { mainScene.background = null; } };
}
