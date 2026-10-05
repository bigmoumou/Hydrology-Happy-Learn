// 右側物理參數面板＋歷線圖：滑桿 → 示意模型 → 式子帶入數字、Horton 四種情況、歷線、3D 強度
import { simulate, intensities, DEFAULTS } from './model.js';
import { tr } from '../../assets/i18n.js';

const fmt = (v, d = 1) => (Math.abs(v) < 0.05 && d === 1 ? '0' : v.toFixed(d));
const C = { qs: '#2b86e0', qi: '#19b39b', qg: '#1747c9', rain: '#8796a3', f: '#a5631a' };
const HORTON = [
  ['a', 'i<f, F<Se', 'M2 8 L40 22'],
  ['b', 'i<f, F>Se', 'M2 8 L14 13 C20 9 26 10 40 20'],
  ['c', 'i>f, F<Se', 'M2 8 L10 12 C15 12 16 1 20 1 C24 1 25 16 30 18 L40 22'],
  ['d', 'i>f, F>Se', 'M2 8 L10 12 C15 12 16 1 20 1 C24 1 25 12 30 13 L40 16'],
];
const esc = (t) => t.replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function mountPanel({ phys, chart, tasks, getApi, hoursPerSec = 1.5, initial = {} }) {
  phys.innerHTML = `
    <header class="phys__head">
      <p class="phys__eyebrow">PARAMETERS · ${tr(`教學示意模型`, `SIMPLIFIED MODEL`)}</p>
      <h3 class="phys__title">${tr(`一場降雨的水帳`, `Water budget of one storm`)}</h3>
      <label class="phys__sim"><input type="checkbox" data-k="sim" checked> ${tr(`3D 畫面跟著參數模擬`, `3D view follows the model`)}</label>
    </header>
    <section class="ph">
      <h4><span class="ph__no">01</span>${tr(`降雨 <em>precipitation</em>`, `Rainfall`)}</h4>
      <div class="sl"><label>${tr(`降雨強度`, `Rainfall intensity`)} <var>i</var></label><output data-o="i"></output><input type="range" data-k="i" min="0" max="80" step="1" aria-label="${tr(`降雨強度 i`, `Rainfall intensity i`)}"></div>
      <div class="sl"><label>${tr(`降雨延時`, `Rainfall duration`)} <var>t</var><sub>r</sub></label><output data-o="tr"></output><input type="range" data-k="tr" min="0.5" max="12" step="0.5" aria-label="${tr(`降雨延時`, `Rainfall duration`)}"></div>
      <p class="ph__derived" data-o="P"></p>
    </section>
    <section class="ph">
      <h4><span class="ph__no">02</span>${tr(`土壤 <em>soil</em>`, `Soil`)}</h4>
      <div class="sl"><label>${tr(`入滲容量`, `Infiltration capacity`)} <var>f</var></label><output data-o="f"></output><input type="range" data-k="f" min="2" max="60" step="1" aria-label="${tr(`入滲容量 f`, `Infiltration capacity f`)}"></div>
      <div class="sl"><label>${tr(`土壤水份有效容量`, `Available soil-water capacity`)} <var>S</var><sub>e</sub></label><output data-o="Se"></output><input type="range" data-k="Se" min="10" max="200" step="5" aria-label="${tr(`土壤水份有效容量`, `Available soil-water capacity`)}"></div>
      <p class="ph__derived" data-o="F"></p>
      <ul class="checks" data-o="checks"></ul>
      <div class="horton" aria-label="${tr(`Horton 四種情況（課本圖 2-12）`, `Horton's four cases (textbook Fig. 2-12)`)}">${HORTON.map(([id, cap, d]) => `
        <figure data-case="${id}"><svg viewBox="0 0 42 26" aria-hidden="true">
          <path d="M1 1 V25 H41" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>
          <path d="M2 8 L40 22" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="2 2" stroke-width="1"/>
          <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.7"/></svg>
          <figcaption>(${id}) ${esc(cap).replace(/Se/g, 'S<sub>e</sub>')}</figcaption></figure>`).join('')}
      </div>
    </section>
    <section class="ph">
      <h4><span class="ph__no">03</span>${tr(`水文平衡 <em>water budget</em>`, `Water budget`)}</h4>
      <div class="eq" data-o="eq12"></div>
      <div class="eq" data-o="eq13"></div>
      <div class="eq" data-o="eq14"></div>
    </section>`;

  const q = (sel) => phys.querySelector(sel);
  const P = { ...DEFAULTS, ...initial };
  const unit = { i: (v) => `${v} mm/hr`, tr: (v) => `${v} hr`, f: (v) => `${v} mm/hr`, Se: (v) => `${v} mm` };
  let sim, running = false, raf = 0;

  for (const k of Object.keys(unit)) {
    const inp = q(`input[data-k="${k}"]`);
    inp.value = P[k];
    q(`output[data-o="${k}"]`).textContent = unit[k](P[k]);
    inp.addEventListener('input', () => { P[k] = +inp.value; q(`output[data-o="${k}"]`).textContent = unit[k](P[k]); recompute(); });
  }
  q('input[data-k="sim"]').addEventListener('change', (e) => { if (!e.target.checked) getApi()?.clearGains(); });

  function recompute() {
    sim = simulate(P);
    const T = sim.tot;
    q('[data-o="P"]').innerHTML = `${tr(`降雨量`, `Rainfall depth`)} <var>P</var> = <var>i</var> × <var>t</var><sub>r</sub> = ${P.i} × ${P.tr} = <b>${fmt(T.P)} mm</b>`;
    // 累積入滲量 F：降雨期間滲進土壤的總水深。一開始的 Sc 先被截留＋窪蓄接住；之後每小時最多滲 min(i, f)
    const Sc = sim.params.Sc;
    q('[data-o="F"]').innerHTML = T.P <= Sc
      ? tr(`累積入滲量 <var>F</var> = 0（雨量不到 <var>S</var><sub>c</sub> = ${Sc} mm，全被截留＋窪蓄接住）`, `Cumulative infiltration <var>F</var> = 0 (rain is less than <var>S</var><sub>c</sub> = ${Sc} mm; interception and depression storage hold it all)`)
      : P.i > P.f
        ? `${tr(`累積入滲量`, `Cumulative infiltration`)} <var>F</var> = <var>f</var> × (<var>t</var><sub>r</sub> − <var>S</var><sub>c</sub> ÷ <var>i</var>) = ${P.f} × (${P.tr} − ${Sc} ÷ ${P.i}) = <b>${fmt(T.F)} mm</b>
           <span class="ph__note">${tr(`雨比土壤吸得快，每小時只滲得進 <var>f</var>；<var>S</var><sub>c</sub> = ${Sc} mm 是一開始被截留＋窪蓄接住的雨`, `Rain outpaces the soil, so only <var>f</var> soaks in per hour; the first <var>S</var><sub>c</sub> = ${Sc} mm is caught by interception and depressions`)}</span>`
        : `${tr(`累積入滲量`, `Cumulative infiltration`)} <var>F</var> = <var>P</var> − <var>S</var><sub>c</sub> = ${fmt(T.P)} − ${Sc} = <b>${fmt(T.F)} mm</b>
           <span class="ph__note">${tr(`雨沒有土壤吸得快，全部滲得進去；<var>S</var><sub>c</sub> = ${Sc} mm 是一開始被截留＋窪蓄接住的雨`, `The soil keeps up with the rain, so all of it soaks in; the first <var>S</var><sub>c</sub> = ${Sc} mm is caught by interception and depressions`)}</span>`;
    q('[data-o="checks"]').innerHTML = `
      <li class="${sim.overland ? 'yes' : 'no'}"><span><span class="math">i = ${P.i} ${sim.overland ? '>' : '≤'} f = ${P.f}</span>${tr('：', ': ')}${sim.overland ? tr('雨下得比土壤吸得快，<b>產生漫地流</b>', 'rain outpaces the soil → <b>overland flow</b>') : tr('雨水全部來得及入滲，不產生漫地流', 'all rain soaks in, no overland flow')}</span></li>
      <li class="${sim.sub ? 'yes' : 'no'}"><span><span class="math">F = ${fmt(T.F)} ${sim.sub ? '>' : '≤'} S<sub>e</sub> = ${P.Se}</span>${tr('：', ': ')}${sim.sub ? tr('土壤裝滿了，<b>產生中間流與新增地下水</b>', 'soil is full → <b>interflow + groundwater</b>') : tr('入滲的水都被土壤留住', 'the soil holds it all')}</span></li>`;
    phys.querySelectorAll('.horton figure').forEach((f) => f.classList.toggle('is-on', f.dataset.case === sim.caseId));
    q('[data-o="eq12"]').innerHTML = `<span class="eq__tag">${tr(`式 (1-2) 地表以上・降雨期間（<var>E</var>、<var>T</var> 很小，先當 0）`, `Eq. (1-2) above ground, during rain (<var>E</var>, <var>T</var> ≈ 0)`)}</span>
      <span class="eq__f"><var>P</var> − (<var>E</var> + <var>T</var> + <var>INF</var> + <var>Q</var>) = Δ<var>S</var><sub>s</sub></span>
      <span class="eq__n">${fmt(T.P)} − (0 + 0 + ${fmt(T.F)} + ${fmt(T.Q)}) = ${fmt(T.P - T.F - T.Q)} mm</span>
      <span class="eq__tag">${tr(`差額留在地表：截留＋窪蓄`, `Left on the surface: interception + depression storage`)}</span>`;
    q('[data-o="eq13"]').innerHTML = `<span class="eq__tag">${tr(`式 (1-3) 地表以下・雨開始後 36 小時`, `Eq. (1-3) below ground, 36 h after the rain starts`)}</span>
      <span class="eq__f"><var>INF</var> − (<var>INT</var> + <var>G</var>) = Δ<var>S</var><sub>g</sub></span>
      <span class="eq__n">${fmt(T.INF)} − (${fmt(T.INT)} + ${fmt(T.G)}) = ${fmt(T.dSg)} mm</span>`;
    q('[data-o="eq14"]').innerHTML = `<span class="eq__tag">${tr(`出口量到的河川流量（式 1-4 的輸出項）`, `Streamflow at the outlet (output of Eq. 1-4)`)}</span>
      <span class="eq__f"><var>Q</var> + <var>INT</var> + <var>G</var> = ${fmt(T.Q)} + ${fmt(T.INT)} + ${fmt(T.G)} = <b>${fmt(T.Q + T.INT + T.G)} mm</b></span>`;
    if (chart) drawStatic();
    if (tasks) checkTasks();
  }

  // ---- 挑戰任務（自動打勾）----
  const done = new Set();
  function checkTasks() {
    const rules = {
      noOverland: () => !sim.overland && P.i > 0,
      interflow: () => sim.sub,
      peak: () => sim.peak > 30,
    };
    tasks.querySelectorAll('li[data-task]').forEach((li) => {
      if (rules[li.dataset.task]?.()) done.add(li.dataset.task);
      li.classList.toggle('is-done', done.has(li.dataset.task));
    });
  }

  // ---- 歷線圖（圖 1-2 下方的 Q–t，加上 2-9 的成份）----
  const off = document.createElement('canvas');
  let geom;
  function sizeChart() {
    const r = chart.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio);
    // 投影片會被縮放：用實際螢幕像素畫，邏輯座標用 offsetWidth
    const w = chart.offsetWidth, h = chart.offsetHeight, k = (r.width / w) * dpr;
    chart.width = off.width = Math.max(1, Math.round(w * k)); chart.height = off.height = Math.max(1, Math.round(h * k));
    geom = { w, h, k, l: 50, r: 10, top: 8, rainH: 86, gap: 22, bot: 30 };
  }
  function drawStatic() {
    sizeChart();
    const { w, h, k, l, r, top, rainH, gap, bot } = geom;
    const g = off.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--muted').trim() || '#5b6268';
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = `15px ${getComputedStyle(document.body).fontFamily}`;
    const W = w - l - r, T = sim.T, X = (t) => l + (t / T) * W;
    const iMax = 80, Yr = (v) => top + (v / iMax) * rainH;
    g.fillStyle = C.rain;
    for (let hr = 0; hr < T; hr += 0.5) {
      const v = hr < sim.params.tr ? sim.params.i : 0;
      if (v > 0) g.fillRect(X(hr) + 0.5, top, Math.max(1, X(hr + 0.5) - X(hr) - 1.5), Yr(v) - top);
    }
    g.strokeStyle = C.f; g.setLineDash([5, 4]); g.lineWidth = 2;
    g.beginPath(); g.moveTo(l, Yr(sim.params.f)); g.lineTo(X(Math.min(T, sim.params.tr + 3)), Yr(sim.params.f)); g.stroke(); g.setLineDash([]);
    g.fillStyle = ink; g.textAlign = 'right';
    g.fillText('i', l - 8, top + 13);
    g.fillStyle = C.f; g.textAlign = 'left'; g.fillText('f', X(Math.min(T, sim.params.tr + 3)) + 6, Yr(sim.params.f) + 5);
    const y0 = top + rainH + gap, y1 = h - bot;
    let qMax = 0;
    for (let n = 0; n < sim.t.length; n++) qMax = Math.max(qMax, sim.qs[n] + sim.qi[n] + sim.qg[n]);
    qMax = niceCeil(qMax * 1.08);
    const Yq = (v) => y1 - (v / qMax) * (y1 - y0);
    const acc = new Float32Array(sim.t.length);
    for (const [arr, col] of [[sim.qg, C.qg], [sim.qi, C.qi], [sim.qs, C.qs]]) {
      g.beginPath();
      for (let n = 0; n < sim.t.length; n += 2) g.lineTo(X(sim.t[n]), Yq(acc[n] + arr[n]));
      for (let n = sim.t.length - 1; n >= 0; n -= 2) g.lineTo(X(sim.t[n]), Yq(acc[n]));
      g.closePath(); g.fillStyle = col; g.globalAlpha = 0.88; g.fill(); g.globalAlpha = 1;
      for (let n = 0; n < sim.t.length; n++) acc[n] += arr[n];
    }
    g.strokeStyle = ink; g.lineWidth = 1; g.globalAlpha = 0.6;
    g.beginPath(); g.moveTo(l, y0); g.lineTo(l, y1); g.lineTo(w - r, y1); g.stroke(); g.globalAlpha = 1;
    g.fillStyle = ink; g.textAlign = 'right';
    g.fillText(`${qMax}`, l - 8, y0 + 12); g.fillText('Q', l - 8, (y0 + y1) / 2 + 5); g.fillText('0', l - 8, y1 + 4);
    g.textAlign = 'center';
    for (let t = 0; t < T; t += 6) g.fillText(`${t}`, X(t), y1 + 20);
    g.textAlign = 'right'; g.fillText(`${T} hr`, w - r, y1 + 20);
    g.textAlign = 'left'; g.fillText('mm/hr', l + 6, y0 + 12);
    const pk = chart.parentElement.querySelector('[data-o="peak"]');
    if (pk) pk.innerHTML = tr(`洪峰 <b>${fmt(sim.peak, 2)} mm/hr</b>，在雨開始後 <b>${fmt(sim.tPeak)} hr</b>`, `Peak <b>${fmt(sim.peak, 2)} mm/hr</b>, <b>${fmt(sim.tPeak)} hr</b> after the rain starts`);
  }
  function niceCeil(v) { const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function drawFrame(tau) {
    if (!geom) return;
    const { w, h, k, l, r, top, bot } = geom;
    const g = chart.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, chart.width, chart.height);
    g.drawImage(off, 0, 0);
    g.setTransform(k, 0, 0, k, 0, 0);
    const x = l + (tau / sim.T) * (w - l - r);
    g.strokeStyle = '#a5631a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, top); g.lineTo(x, h - bot); g.stroke();
  }

  // 3D 的強度平滑地跟上模型（雨開始、停止時淡入淡出，不會一閃一閃）
  const cur = {};
  let lastNow = 0;
  function tick() {
    raf = requestAnimationFrame(tick);
    const api = getApi();
    if (!api || !sim) return;
    const tau = (api.time * hoursPerSec) % sim.T;
    const now = performance.now(), dtR = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 1; lastNow = now;
    if (q('input[data-k="sim"]').checked) {
      const target = intensities(sim, tau);
      for (const [k, v] of Object.entries(target)) cur[k] = cur[k] === undefined ? v : cur[k] + (v - cur[k]) * Math.min(1, dtR * 3.5);
      api.setGains(cur);
    }
    if (chart) drawFrame(tau);
  }

  recompute();
  return {
    start() { if (!running) { running = true; recompute(); tick(); } },
    stop() { running = false; cancelAnimationFrame(raf); for (const k of Object.keys(cur)) delete cur[k]; lastNow = 0; getApi()?.clearGains(); },
    redraw() { if (chart && sim) { drawStatic(); } },
    set(k, v) { if (!(k in unit)) return; P[k] = v; const inp = q(`input[data-k="${k}"]`); inp.value = v; q(`output[data-o="${k}"]`).textContent = unit[k](+(+v).toFixed(k === 'tr' ? 1 : 0)); recompute(); },
    reset() { Object.assign(P, DEFAULTS); for (const k of Object.keys(unit)) { q(`input[data-k="${k}"]`).value = P[k]; q(`output[data-o="${k}"]`).textContent = unit[k](P[k]); } recompute(); },
    get params() { return { ...P }; },
  };
}
