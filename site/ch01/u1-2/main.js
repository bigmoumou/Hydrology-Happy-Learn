import { Deck } from '../../assets/deck.js';
import { createReservoir } from '../../scenes/reservoir/scene.js';
import { mountRouting } from '../../scenes/reservoir/routing-panel.js';
import { mountDepthDemo } from '../../scenes/reservoir/depth-demo.js';
import { setupCapture, markReady, setupQuiz, insets, progressTo, isCapture, autoHideLabels } from '../../assets/unit-common.js';
import { tr } from '../../assets/i18n.js';

const root = document.querySelector('.deck');
const bg = document.getElementById('bg3d');
const loading = document.getElementById('loading3d');
let rv = null, panel = null, depthDemo = null;
const USES_3D = new Set(['title', 'scene', 'lab']);
const deck = new Deck(root, { onChange: apply });
setupCapture(root, deck);
setupQuiz();

// ---------- 習題 5：逐月帳 ----------
const IN = [3, 5, 4, 3, 4, 10, 30, 15, 6, 4, 2, 1];
const OUT = [6, 8, 7, 10, 6, 8, 20, 13, 4, 5, 7, 8];
const S = [60];
for (let m = 0; m < 12; m++) S.push(S[m] + IN[m] - OUT[m]);
const ledgerSvg = document.querySelector('.ledger__svg');
const MONTH_X = (m) => 46 + m * 42;
const SY = (s) => 30 + (62 - s) * 5.5;
(function drawLedger() {
  let h = '';
  for (let m = 0; m < 12; m++) {
    const x = MONTH_X(m);
    h += `<rect class="bar bar-in" data-m="${m}" x="${x - 15}" y="${280 - IN[m] * 4}" width="14" height="${IN[m] * 4}"/>`;
    h += `<rect class="bar bar-out" data-m="${m}" x="${x + 1}" y="${280 - OUT[m] * 4}" width="14" height="${OUT[m] * 4}"/>`;
    h += `<text x="${x}" y="298" text-anchor="middle">${m + 1}</text>`;
  }
  h += `<line x1="20" y1="280" x2="555" y2="280" stroke="currentColor" opacity=".35"/>`;
  h += `<text x="0" y="276">0</text><text x="0" y="164">30</text>`;
  h += `<path class="s-line" d=""/><circle class="s-dot" r="6" cx="${MONTH_X(0) - 21}" cy="${SY(60)}"/>`;
  h += `<text class="s-lab" x="${MONTH_X(0) - 21}" y="${SY(60) - 12}" text-anchor="middle">60</text>`;
  h += `<text x="555" y="16" text-anchor="end">${tr('<tspan fill="#2b86e0">■ 流入</tspan>　<tspan fill="#c26a1d">■ 流出</tspan>　<tspan fill="#2c9a5b">● 月底存水</tspan>', '<tspan fill="#2b86e0">■ In</tspan>　<tspan fill="#c26a1d">■ Out</tspan>　<tspan fill="#2c9a5b">● Storage at month end</tspan>')}</text>`;
  ledgerSvg.innerHTML = h;
})();
const ledger = { m: 0, target: 0 };
function renderLedger(mf) {
  const mi = Math.floor(mf + 1e-6);
  ledgerSvg.querySelectorAll('.bar').forEach((b) => { b.style.opacity = +b.dataset.m < Math.ceil(mf - 1e-6) ? 1 : 0.12; });
  const pts = [[MONTH_X(0) - 21, SY(60)]];
  for (let m = 1; m <= mi; m++) pts.push([MONTH_X(m - 1) + 21, SY(S[m])]);
  let sNow = S[mi];
  if (mf > mi && mi < 12) { const u = mf - mi; sNow = S[mi] + (S[mi + 1] - S[mi]) * u; pts.push([MONTH_X(mi) - 21 + 42 * u, SY(sNow)]); }
  ledgerSvg.querySelector('.s-line').setAttribute('d', 'M' + pts.map((p) => p.join(' ')).join(' L'));
  const [cx, cy] = pts[pts.length - 1];
  const dot = ledgerSvg.querySelector('.s-dot'), lab = ledgerSvg.querySelector('.s-lab');
  dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
  lab.setAttribute('x', cx); lab.setAttribute('y', cy - 12); lab.textContent = Math.round(sNow);
  document.getElementById('ledgerS').textContent = Math.round(sNow);
  const mEnd = Math.min(12, Math.ceil(mf - 0.02));
  document.getElementById('ledgerMonth').textContent = mf < 0.02 ? tr('年初', 'Start of year') : tr(`${mEnd} 月底`, `End of month ${mEnd}`);
  return sNow;
}
renderLedger(0);
const levelOfS = (s) => 6 + ((s - 30) / 30) * 8.4;

// ---------- 3D 水位動畫 ----------
const anim = { from: 13, to: 13, t0: 0, dur: 1.6 };
function animateLevel(to, dur = 1.6) {
  if (!rv) return;
  anim.from = rv.level; anim.to = to; anim.t0 = rv.time; anim.dur = dur;
}

createReservoir(bg, { quality: localStorage.getItem('hc.quality') || 'high', capture: isCapture, onProgress: progressTo(loading, document.getElementById('loadStage')) }).then((a) => {
  rv = a; window.hydro = a;
  autoHideLabels(rv, bg);
  loading.classList.add('is-done');
  rv.onUpdate((t) => {
    if (ledger.active) {
      const step = Math.sign(ledger.target - ledger.m) * Math.min(Math.abs(ledger.target - ledger.m), (t - (ledger.last ?? t)) / 0.85);
      ledger.m += step; ledger.last = t;
      const s = renderLedger(ledger.m);
      rv.setLevel(levelOfS(s));
      const mi = Math.min(11, Math.floor(ledger.m));
      rv.setFlows({ I: IN[mi] / 30, O: OUT[mi] / 30 });
      rv.setRate(ledger.target !== ledger.m ? (IN[mi] - OUT[mi]) / 10 : 0);
      return;
    }
    if (panel?.running) return;
    const u = Math.min(1, (t - anim.t0) / anim.dur), e = u * u * (3 - 2 * u);
    if (anim.from !== anim.to) rv.setLevel(anim.from + (anim.to - anim.from) * e);
  });
  panel = mountRouting({ phys: document.getElementById('phys'), chart: document.getElementById('chart'), tasks: document.getElementById('tasks'), rv });
  window.lab = panel;
  document.getElementById('resetParams').onclick = () => panel.reset();
  if (isCapture) rv.setDrift(0.08);
  apply(deck.state(), 'slide', { instant: true });
  markReady();
});

// ---------- 「把體積攤平成水深」的水塊動畫（第一次進到那一頁才建立）----------
function depthFor(slide, on) {
  const box = slide && slide.querySelector('.depth3d');
  if (on && box && !depthDemo) depthDemo = mountDepthDemo(box, { capture: isCapture, onPhase: (ph) => { box.dataset.phase = ph; } });
  if (!depthDemo) return;
  if (on && box) depthDemo.start(); else depthDemo.stop();
}

function rvState(st) {
  const sl = st.slide;
  let o = sl.dataset.rv ? JSON.parse(sl.dataset.rv) : {};
  st.frags.slice(0, st.f).flat().forEach((f) => { if (f.dataset.rv) o = { ...o, ...JSON.parse(f.dataset.rv) }; });
  return o;
}

function apply(st, why, { instant = false } = {}) {
  if (why === 'video-open') { rv?.setActive(false); panel?.stop(); depthFor(null, false); return; }
  if (why === 'video-close') why = 'slide';
  const s = st.slide, layout = s.dataset.layout;
  depthFor(s, !!s.querySelector('.depth3d'));
  if (!rv) return;
  const on3d = USES_3D.has(layout);
  rv.setActive(on3d);
  bg.classList.toggle('is-off', !on3d);
  if (layout === 'lab') { panel.start(); panel.running = true; } else { panel.stop(); panel.running = false; }
  // 習題 5 的逐月動畫
  const isLedger = !!s.querySelector('.ledger');
  if (isLedger) {
    const months = st.frags.slice(0, st.f).flat().filter((f) => f.dataset.months).map((f) => +f.dataset.months);
    const target = months.length ? months[months.length - 1] : 0;
    if (!ledger.active || why === 'slide') { ledger.m = instant || why === 'slide' ? (months.length > 1 ? months[months.length - 2] : 0) : ledger.m; }
    ledger.target = target; ledger.active = true; ledger.last = rv.time;
  } else ledger.active = false;
  if (!on3d) return;
  const o = rvState(st);
  if (why !== 'resize') {
    rv.setStepById(o.step || 'rv-overview', { instant });
    if (!isLedger && layout !== 'lab') {
      if (o.L != null) { if (instant || why === 'slide') { rv.setLevel(o.L); anim.from = anim.to = o.L; } else animateLevel(o.L, o.dur || 1.6); }
      rv.setFlows({ I: o.I ?? 0.5, O: o.O ?? 0.45, spill: o.sp ?? 0 });
      rv.setRate(o.rate ?? 0);
    }
  }
  rv.setInsets(...insets(s));
  rv.setControls(layout === 'lab' ? 'full' : 'rotate');
  rv.setLabels(s.dataset.labels !== 'off');
  rv.setArrows(layout !== 'title');
  rv.setLab(layout === 'lab');   // 實驗室背景只在互動實驗頁
  if (layout === 'lab') requestAnimationFrame(() => panel.redraw());
}
