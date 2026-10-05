import { Deck } from '../../assets/deck.js';
import { createTaiwan } from '../../scenes/taiwan/scene.js';
import { createReservoir } from '../../scenes/reservoir/scene.js';
import { mountMass, FLOWS } from '../../scenes/reservoir/mass-panel.js';
import { setupCapture, markReady, setupQuiz, insets, progressTo, isCapture } from '../../assets/unit-common.js';
import { tr } from '../../assets/i18n.js';

const root = document.querySelector('.deck');
const bgTw = document.getElementById('bgTw'), bgRv = document.getElementById('bgRv');
let tw = null, rv = null, panel = null;
const USES_3D = new Set(['title', 'scene', 'lab']);

// ---------- 先畫好 2D 圖（分段元素要在投影片引擎建立前就存在）----------
(function seasonBars() {
  const g = document.querySelector('.season__bars');
  const X = (m) => 90 + m * 48, Y = (v) => 520 - v * 4;
  let h = '';
  FLOWS.forEach((v, m) => {
    h += `<rect x="${X(m) - 17}" y="${Y(v)}" width="34" height="${v * 4}" class="${v < 40 ? 'dry' : ''}"/>`;
    h += `<text x="${X(m)}" y="${Y(v) - 8}">${v}</text><text x="${X(m)}" y="548">${m + 1}</text>`;
  });
  g.innerHTML = h;
  const d = document.querySelector('.season__d'); d.setAttribute('y1', Y(40)); d.setAttribute('y2', Y(40));
  document.querySelector('.season__dl').setAttribute('y', Y(40) + 6);
  const bars = g.querySelectorAll('rect');
  bars.forEach((b) => b.classList.remove('dry'));
  // 分段 2 出現需水線時，低於需水的月份變色
  const fr = document.querySelector('.season .f');
  new MutationObserver(() => { const on = fr.classList.contains('is-in'); bars.forEach((b, m) => b.classList.toggle('dry', on && FLOWS[m] < 40)); }).observe(fr, { attributes: true });
  // 讓「需水線」成為這頁的第 2 段：前面一段是文字
})();

(function massSketch() {
  // 示意用的月流量（枯水期更明顯，讓「最大差距」看得清楚）；實際的習題 8 數字在互動頁
  const F = [90, 70, 25, 8, 5, 12, 45, 130, 170, 150, 110, 95];
  const svg = document.querySelector('.mc');
  const C = [0]; for (const v of F) C.push(C[C.length - 1] + v);
  const X = (m) => 90 + m * 46, Y = (v) => 620 - v * 0.615;
  const D = 70, D2 = 85, m0 = 2, v0 = C[m0];
  let m1 = m0, gap = 0;
  for (let m = m0; m <= 12; m++) { const g = v0 + D * (m - m0) - C[m]; if (g > gap) { gap = g; m1 = m; } }
  const curve = C.map((v, m) => `${X(m)},${Y(v)}`).join(' ');
  const ang = (d) => Math.atan2(-d * 0.615, 46) * 180 / Math.PI;
  const onLine = (d, m, off) => { const x = X(m), y = Y(v0 + d * (m - m0)); const a = Math.atan2(-d * 0.615, 46); return [x - Math.sin(a) * off, y + Math.cos(a) * off]; };
  const [dlx, dly] = onLine(D, 3.3, 30), [d2x, d2y] = onLine(D2, 2.9, -14);
  const gTop = Y(v0 + D * (m1 - m0)), gBot = Y(C[m1]);
  svg.innerHTML = `
    <path class="ax" d="M90 40 V 620 H 660"/>
    <text x="96" y="30">${tr('累積流量', 'Cumulative flow')}</text><text x="660" y="652" text-anchor="end">${tr('時間（月）', 'Time (months)')}</text>
    <polyline class="curve" points="${curve}"/>
    <text x="${X(12) - 10}" y="${Y(C[12]) - 12}" class="lab-c" text-anchor="end">${tr('累積流量曲線', 'Mass curve')}</text>
    <text x="${X(4.5)}" y="${Y(C[5]) + 46}" text-anchor="middle">${tr('平緩：枯水', 'Flat: dry season')}</text>
    <text x="${X(9) + 18}" y="${Y(C[9]) + 34}">${tr('陡：豐水', 'Steep: wet season')}</text>
    <g class="f" data-fi="1"><path class="dl" d="M${X(m0)} ${Y(v0)} L ${X(12)} ${Y(v0 + D * (12 - m0))}"/>
      <text x="${dlx}" y="${dly}" class="lab-d" transform="rotate(${ang(D)} ${dlx} ${dly})">${tr('需水線（斜率 D）', 'Demand line (slope D)')}</text></g>
    <g class="f" data-fi="2"><line class="gap" x1="${X(m1)}" y1="${gTop}" x2="${X(m1)}" y2="${gBot}"/>
      <text x="${X(m1) + 16}" y="${gBot + 18}" class="lab-k">${tr('最大差距', 'Largest gap')}</text><text x="${X(m1) + 16}" y="${gBot + 50}" class="lab-k">${tr('= 所需容量', '= required storage')}</text></g>
    <g class="f" data-fi="3"><path class="dl2" d="M${X(m0)} ${Y(v0)} L ${X(10)} ${Y(v0 + D2 * 8)}"/>
      <text x="${d2x}" y="${d2y}" class="lab-d2" transform="rotate(${ang(D2)} ${d2x} ${d2y})">${tr('容量固定時：最陡的需水線', 'Fixed storage: steepest demand line')}</text></g>`;
})();

// 比流量長條（對數尺度）
const sqBars = [...document.querySelectorAll('.sq__b')];
function showSq(on) { sqBars.forEach((b) => { b.style.width = on ? `${Math.max(2, (Math.log10(+b.dataset.v) + 2) * 140)}px` : '0px'; }); }

const deck = new Deck(root, { onChange: apply });
setupCapture(root, deck);
setupQuiz();


let pending = 2;
const ready = () => { if (--pending === 0) { apply(deck.state(), 'slide', { instant: true }); markReady(); } };
createTaiwan(bgTw, { base: new URL('../../data/', import.meta.url).href, capture: isCapture, quality: localStorage.getItem('hc.quality') || 'high', onProgress: progressTo(document.getElementById('loadTw'), document.getElementById('loadTwStage')) }).then((a) => {
  tw = a; window.taiwan = a; window.hydro = a;
  document.getElementById('loadTw').classList.add('is-done');
  if (isCapture) tw.setDrift(0.06);
  ready();
});
createReservoir(bgRv, { capture: isCapture, quality: localStorage.getItem('hc.quality') || 'high', onProgress: progressTo(document.getElementById('loadRv'), document.getElementById('loadRvStage')) }).then((a) => {
  rv = a;
  document.getElementById('loadRv').classList.add('is-done');
  panel = mountMass({ phys: document.getElementById('phys'), chart: document.getElementById('chart'), tasks: document.getElementById('tasks'), rv });
  window.lab = panel;
  document.getElementById('resetParams').onclick = () => panel.reset();
  rv.setActive(false);
  ready();
});

function stateOf(st, key) {
  const sl = st.slide;
  let o = sl.dataset[key] ? JSON.parse(sl.dataset[key]) : {};
  st.frags.slice(0, st.f).flat().forEach((f) => { if (f.dataset[key]) o = { ...o, ...JSON.parse(f.dataset[key]) }; });
  return o;
}

function apply(st, why, { instant = false } = {}) {
  if (why === 'video-open') { tw?.setActive(false); rv?.setActive(false); panel?.stop(); return; }
  if (why === 'video-close') why = 'slide';
  const s = st.slide, layout = s.dataset.layout;
  showSq(s.querySelector('.sq') && st.f >= 1);
  if (!tw || !rv) return;
  const on3d = USES_3D.has(layout);
  const which = on3d ? (s.dataset.scene || 'tw') : null;
  tw.setActive(which === 'tw'); rv.setActive(which === 'rv');
  bgTw.classList.toggle('is-off', which !== 'tw'); bgRv.classList.toggle('is-off', which !== 'rv');
  if (layout === 'lab') panel.start(); else panel.stop();
  if (!which) return;
  const api = which === 'tw' ? tw : rv;
  if (which === 'tw') {
    const o = stateOf(st, 'tw');
    if (why !== 'resize') { tw.setStepById(o.step || 'tw-hero', { instant }); tw.setMode(o.mode || 'relief', instant || why === 'slide'); }
    tw.setTropic(!!o.tropic);
  } else {
    const o = stateOf(st, 'rv');
    if (why !== 'resize') rv.setStepById(o.step || 'rv-lab', { instant });
    rv.setArrows(true);
    rv.setLab(layout === 'lab');   // 實驗室背景只在互動實驗頁
  }
  api.setInsets(...insets(s));
  api.setControls(layout === 'lab' ? 'full' : 'rotate');
  api.setLabels(s.dataset.labels !== 'off');
  if (layout === 'lab') requestAnimationFrame(() => panel.redraw());
}
