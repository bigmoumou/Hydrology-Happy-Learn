// 後製：HDR 中間緩衝（HalfFloat + MSAA）→ GTAO 接觸陰影 → Bloom 亮處發光 → Output（色調映射 + sRGB）
// 畫質分級：high（全開）→ medium（關 GTAO）→ low / lowest（不走後製，直接畫，和舊版一樣）。
// 掉幀時自動降一級，只降不升；做影片（capture）時固定 high、不量 fps。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// GTAO 只算不透明的網格。雨、雲、粒子、陰影接收面、背景球不參與，否則會在它們周圍畫出假的暗邊。
// 物件可用 userData.noAO = true 排除；透明但要參與的（例如水面）用 userData.ao = true。
class OpaqueGTAOPass extends GTAOPass {
  // AO 是很柔的暗部：用半解析度算（法線深度圖、AO、降噪都減半），最後放大疊回全解析度畫面。片段運算約省 3/4。
  setSize(w, h) { const k = this.resScale ?? 0.5; super.setSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))); }

  _overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if (!o.visible || o.userData.ao) return;
      const m = o.material;
      const skip = o.isPoints || o.isLine || o.isLine2 || o.isSprite || o.userData.noAO
        || (m && (Array.isArray(m) ? m.some((x) => x.transparent) : m.transparent));
      if (skip) { o.visible = false; cache.push(o); }
    });
  }
}

export const LEVELS = [
  { name: 'high', post: true, msaa: 4, ao: true, bloom: true, pr: 2, budget: 4.4e6 },
  { name: 'medium', post: true, msaa: 4, ao: false, bloom: true, pr: 1.5, budget: 3.2e6 },
  { name: 'low', post: false, pr: 1.25, budget: 2.4e6 },
  { name: 'lowest', post: false, pr: 1, budget: 2e6 },
];

export function createPost(renderer, scene, camera, { level = 'high', capture = false, ao = {}, bloom = {} } = {}) {
  const T = {
    aoRadius: 2.5, aoIntensity: 0.9, aoThickness: 1, aoFalloff: 1, aoPerDist: 0.016, aoDistance: null,
    bloomStrength: 0.2, bloomRadius: 0.45, bloomThreshold: 2.6,
    ...Object.fromEntries(Object.entries(ao).map(([k, v]) => ['ao' + k[0].toUpperCase() + k.slice(1), v])),
    ...Object.fromEntries(Object.entries(bloom).map(([k, v]) => ['bloom' + k[0].toUpperCase() + k.slice(1), v])),
  };
  let qi = Math.max(0, LEVELS.findIndex((l) => l.name === level));
  const small = (navigator.maxTouchPoints || 0) > 0 && Math.min(screen.width, screen.height) < 820;
  if (small && qi === 0 && !capture) qi = 1;
  let W = 1, H = 1, composer = null, gtao = null, bloomPass = null, builtMsaa = -1;
  renderer.info.autoReset = false;   // 一格會畫好幾次（陰影、GTAO、主畫面），統計自己歸零
  // 陰影只在需要時重算：場景裡投影的東西（地形、樹、房子、大壩）都不會動，
  // 每格重畫陰影圖等於把整個場景多畫一次。改了會投影的幾何時呼叫 invalidateShadows()。
  renderer.shadowMap.autoUpdate = false;
  let shadowFrames = 3;

  const L = () => LEVELS[qi];

  function build() {
    composer?.dispose();
    gtao?.dispose?.();
    bloomPass?.dispose?.();
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: L().msaa });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(W, H);
    gtao = new OpaqueGTAOPass(scene, camera, W, H);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), T.bloomStrength, T.bloomRadius, T.bloomThreshold);
    for (const p of [new RenderPass(scene, camera), gtao, bloomPass, new OutputPass()]) composer.addPass(p);
    builtMsaa = L().msaa;
    apply();
  }

  function apply() {
    if (!gtao) return;
    gtao.updateGtaoMaterial({ radius: T.aoRadius, distanceExponent: 1, thickness: T.aoThickness, scale: 1, samples: 16, distanceFallOff: T.aoFalloff, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 });
    gtao.blendIntensity = T.aoIntensity;
    gtao.enabled = !!L().ao;
    bloomPass.strength = T.bloomStrength; bloomPass.radius = T.bloomRadius; bloomPass.threshold = T.bloomThreshold;
    bloomPass.enabled = !!L().bloom;
  }

  function setSize(w, h) {
    W = Math.max(1, w); H = Math.max(1, h);
    const dpr = window.devicePixelRatio || 1;
    const pr = capture ? dpr : Math.max(1, Math.min(dpr, L().pr, Math.sqrt(L().budget / (W * H))));
    renderer.setPixelRatio(pr);
    renderer.setSize(W, H);
    if (L().post) {
      if (!composer || builtMsaa !== L().msaa) build();
      composer.setPixelRatio(pr); composer.setSize(W, H);
    }
  }

  function setLevel(name) {
    const i = LEVELS.findIndex((l) => l.name === name);
    if (i < 0) return L().name;
    qi = i; apply(); setSize(W, H); shadowFrames = 2;
    return L().name;
  }

  // 自動降畫質：開始畫 4 秒後，每 1.5 秒算一次 fps，連續兩次低於 40 就降一級（低於 15 一次就降）。
  // 用真實時間量（不用被截短的 dt），很慢的電腦才降得下來；分頁切走、卡超過 3 秒的那一格不算。
  const fps = { acc: 0, n: 0, value: 0, slow: 0, t0: 0, last: 0 };
  function tick() {
    if (capture) return;
    const now = performance.now();
    if (!fps.t0) { fps.t0 = fps.last = now; return; }
    const dt = (now - fps.last) / 1000; fps.last = now;
    if (document.hidden || dt > 3) { fps.acc = 0; fps.n = 0; return; }
    fps.acc += dt; fps.n++;
    if (fps.acc < 1.5) return;
    fps.value = fps.n / fps.acc; fps.acc = 0; fps.n = 0;
    if (now - fps.t0 < 4000) return;
    fps.slow = fps.value < 40 ? fps.slow + 1 : 0;
    if ((fps.slow >= 2 || fps.value < 15) && qi < LEVELS.length - 1) { fps.slow = 0; setLevel(LEVELS[qi + 1].name); }
  }

  // AO 半徑跟著鏡頭遠近縮放：全景時大（看得出山谷、樹林的暗部），近拍時小（貼地的接觸陰影），
  // 也避免近拍時取樣半徑在螢幕上變得很大、拖慢速度
  function adaptAO() {
    if (!gtao || !gtao.enabled || !T.aoDistance) return;
    const r = Math.min(T.aoRadius, Math.max(T.aoRadius * 0.2, T.aoDistance() * T.aoPerDist));
    gtao.gtaoMaterial.uniforms.radius.value = r;
  }

  function render() {
    renderer.info.reset();
    adaptAO();
    if (shadowFrames > 0) { renderer.shadowMap.needsUpdate = true; shadowFrames--; }
    if (L().post && composer) composer.render();
    else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  }

  return {
    render, setSize, setLevel, tick,
    invalidateShadows(n = 2) { shadowFrames = Math.max(shadowFrames, n); },
    get level() { return L().name; },
    get fps() { return +fps.value.toFixed(1); },
    get gtao() { return gtao; },
    get bloom() { return bloomPass; },
    tune(p) { if (p) { Object.assign(T, p); apply(); } return { ...T }; },
    dispose() { composer?.dispose(); gtao?.dispose?.(); bloomPass?.dispose?.(); },
  };
}
