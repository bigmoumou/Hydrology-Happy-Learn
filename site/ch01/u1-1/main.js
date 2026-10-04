import { Deck } from '../../assets/deck.js';
import { createHydroCycle } from '../../scenes/hydro-cycle/scene.js';
import { mountPanel } from '../../scenes/hydro-cycle/panel.js';
import { setupCapture, markReady, setupQuiz } from '../../assets/unit-common.js';

const root = document.querySelector('.deck');
const bg = document.getElementById('bg3d');
const loading = document.getElementById('loading3d');
let api = null;
let panel = null;
const USES_3D = new Set(['title', 'scene', 'lab']);

const capture = new URLSearchParams(location.search).has('capture');
if (capture) root.classList.add('is-capture');
const deck = new Deck(root, { onChange: apply });
setupCapture(root, deck);

// 3D 在背景載入；先看紙面頁也不用等
const STAGE_WEIGHT = { '地形骨架': [0, 0.15], '侵蝕模擬': [0.15, 0.6], '河道與水文分析': [0.6, 0.75], '環境遮蔽': [0.75, 0.82], '建立 3D 模型': [0.82, 0.98], '完成': [1, 1] };
createHydroCycle(bg, {
  quality: localStorage.getItem('hc.quality') || 'high',
  onProgress(stage, p) {
    const [a, b] = STAGE_WEIGHT[stage] || [0, 1];
    loading.style.setProperty('--p', `${(a + (b - a) * p) * 100}%`);
    document.getElementById('loadStage').textContent = `${stage} ${Math.round(p * 100)}%`;
  },
}).then((a) => {
  api = a;
  window.hydro = a;
  loading.classList.add('is-done');
  panel = mountPanel({
    phys: document.getElementById('phys'), chart: document.getElementById('chart'), tasks: document.getElementById('tasks'),
    getApi: () => api,
  });
  document.getElementById('resetParams').onclick = () => panel.reset();
  window.lab = panel;
  if (capture) a.setDrift(0.09);
  apply(deck.state(), 'slide', { instant: true });
  markReady();
});

function insets(slide) {
  let l = 0, r = 0;
  for (const el of slide.querySelectorAll('[data-inset="left"]')) l = Math.max(l, el.getBoundingClientRect().right + 12);
  for (const el of slide.querySelectorAll('[data-inset="right"]')) r = Math.max(r, innerWidth - el.getBoundingClientRect().left + 12);
  return [l, r];
}

function apply(st, why, { instant = false } = {}) {
  if (why === 'video-open') { api?.setActive(false); panel?.stop(); return; }
  if (why === 'video-close') why = 'slide';
  const s = st.slide;
  const layout = s.dataset.layout;
  const on3d = USES_3D.has(layout);
  if (!api) return;
  api.setActive(on3d);
  if (layout === 'lab') panel?.start(); else panel?.stop();
  if (!on3d) return;
  // 目前這一段若有 data-step 就用它，否則用投影片的 data-step
  let step = s.dataset.step || 'overview';
  st.frags.slice(0, st.f).flat().forEach((f) => { if (f.dataset.step) step = f.dataset.step; });
  if (why !== 'resize') api.setStepById(step, { instant });
  api.setInsets(...insets(s));
  api.setControls(layout === 'lab' ? 'full' : 'rotate');
  api.setLabels(s.dataset.labels !== 'off');
  if (layout === 'lab') requestAnimationFrame(() => panel?.redraw());
}

// ---- 自我檢查 ----
setupQuiz();
