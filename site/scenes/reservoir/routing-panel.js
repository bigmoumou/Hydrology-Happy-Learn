// 單元 1-2 互動實驗：一場洪水通過水庫（水庫演算的直覺版）
// 連續方程式 I − O = dS/dt；出流 = 基本放流 + 溢洪道溢流 Cw·(L − 溢洪道頂)^1.5
// 單位：蓄水量用場景的「單位體積」，流量用「單位／小時」。這是教學示意，不對應真實水庫。
import { tr } from '../../assets/i18n.js';

const fmt = (v, d = 0) => v.toFixed(d);

export function simulateRouting(rv, { Ip, Ob, Cw, L0 = 13.0, T = 48, dt = 0.05, Ib = 60, tPeak = 6, tEnd = 18 }) {
  const n = Math.round(T / dt) + 1;
  const t = new Float32Array(n), I = new Float32Array(n), O = new Float32Array(n), S = new Float32Array(n), L = new Float32Array(n);
  let s = rv.storeFromLevel(L0);
  const crestS = rv.storeFromLevel(rv.crest), crestA = rv.areaAt(rv.crest);
  // 超過壩頂：水位用壩頂的水面積往上外插，並加上越過整個壩頂的溢流
  const levelOf = (st) => (st <= crestS ? rv.levelFromStore(st) : rv.crest + (st - crestS) / crestA);
  let overtop = false;
  const inflow = (tt) => Ib + (tt < tPeak ? (tt / tPeak) : tt < tEnd ? (tEnd - tt) / (tEnd - tPeak) : 0) * (Ip - Ib) * (tt >= 0 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const tt = k * dt;
    const lv = levelOf(s);
    const sp = Cw * Math.pow(Math.max(0, lv - rv.spill), 1.5) + 4000 * Math.pow(Math.max(0, lv - rv.crest), 1.5);
    const out = Math.min(s / dt, Ob + sp);
    t[k] = tt; I[k] = inflow(tt); O[k] = out; S[k] = s; L[k] = lv;
    if (s > crestS) overtop = true;
    s = Math.max(0, s + (I[k] - out) * dt);
  }
  let kI = 0, kO = 0, kS = 0;
  for (let k = 0; k < n; k++) { if (I[k] > I[kI]) kI = k; if (O[k] > O[kO]) kO = k; if (S[k] > S[kS]) kS = k; }
  return { t, I, O, S, L, n, dt, T, kI, kO, kS, overtop, S0: S[0], params: { Ip, Ob, Cw } };
}

export function mountRouting({ phys, chart, tasks, rv, hoursPerSec = 2.4 }) {
  phys.innerHTML = `
    <header class="phys__head">
      <p class="phys__eyebrow">PARAMETERS · ${tr(`教學示意模型`, `SIMPLIFIED MODEL`)}</p>
      <h3 class="phys__title">${tr(`洪水通過水庫`, `A flood passes through a reservoir`)}</h3>
      <label class="phys__sim"><input type="checkbox" data-k="sim" checked> ${tr(`3D 水位跟著模擬`, `3D water level follows the model`)}</label>
    </header>
    <section class="ph">
      <h4><span class="ph__no">01</span>${tr(`入流 <em>inflow I(t)</em>`, `Inflow <em>I(t)</em>`)}</h4>
      <div class="sl"><label>${tr(`洪峰入流`, `Peak inflow`)} <var>I</var><sub>p</sub></label><output data-o="Ip"></output><input type="range" data-k="Ip" min="100" max="1400" step="10" aria-label="${tr(`洪峰入流`, `Peak inflow`)}"></div>
    </section>
    <section class="ph">
      <h4><span class="ph__no">02</span>${tr(`出流 <em>outflow O(t)</em>`, `Outflow <em>O(t)</em>`)}</h4>
      <div class="sl"><label>${tr(`基本放流`, `Base release`)} <var>O</var><sub>b</sub></label><output data-o="Ob"></output><input type="range" data-k="Ob" min="0" max="400" step="10" aria-label="${tr(`基本放流`, `Base release`)}"></div>
      <div class="sl"><label>${tr(`溢洪道寬度係數`, `Spillway coefficient`)} <var>C</var><sub>w</sub></label><output data-o="Cw"></output><input type="range" data-k="Cw" min="0" max="1200" step="20" aria-label="${tr(`溢洪道係數`, `Spillway coefficient`)}"></div>
      <p class="ph__derived">${tr(`溢流量 = <var>C</var><sub>w</sub> · (水位 − 溢洪道頂)<sup>1.5</sup><br>水位沒超過溢洪道頂時為 0`, `Spill = <var>C</var><sub>w</sub> · (level − spillway crest)<sup>1.5</sup><br>Zero while the level is below the spillway crest`)}</p>
    </section>
    <section class="ph">
      <h4><span class="ph__no">03</span>${tr(`連續方程式 <em>式 (1-1)</em>`, `Continuity equation <em>Eq. (1-1)</em>`)}</h4>
      <div class="eq"><span class="eq__f"><var>I</var> − <var>O</var> = d<var>S</var>/d<var>t</var></span><span class="eq__n" data-o="now"></span></div>
      <ul class="checks" data-o="checks"></ul>
    </section>`;
  const q = (s) => phys.querySelector(s);
  const P = { Ip: 700, Ob: 120, Cw: 500 };
  const unit = { Ip: (v) => `${v} ${tr('單位/hr', 'units/hr')}`, Ob: (v) => `${v} ${tr('單位/hr', 'units/hr')}`, Cw: (v) => `${v}` };
  let sim, running = false, raf = 0, simOffset = 0;
  for (const k of Object.keys(unit)) {
    const inp = q(`input[data-k="${k}"]`);
    inp.value = P[k]; q(`output[data-o="${k}"]`).textContent = unit[k](P[k]);
    inp.addEventListener('input', () => { P[k] = +inp.value; q(`output[data-o="${k}"]`).textContent = unit[k](P[k]); recompute(); });
  }
  const done = new Set();
  function recompute() {
    sim = simulateRouting(rv, P);
    const peakAtt = sim.O[sim.kO] / sim.I[sim.kI];
    q('[data-o="checks"]').innerHTML = `
      <li class="yes"><span>${tr(`入流洪峰 <b>${fmt(sim.I[sim.kI])}</b>（第 ${fmt(sim.t[sim.kI], 1)} hr）→ 出流洪峰 <b>${fmt(sim.O[sim.kO])}</b>（第 ${fmt(sim.t[sim.kO], 1)} hr）`, `Peak inflow <b>${fmt(sim.I[sim.kI])}</b> (at ${fmt(sim.t[sim.kI], 1)} hr) → peak outflow <b>${fmt(sim.O[sim.kO])}</b> (at ${fmt(sim.t[sim.kO], 1)} hr)`)}</span></li>
      <li class="${sim.overtop ? 'no' : 'yes'}"><span>${sim.overtop ? tr('<b style="color:#b23a30">水位超過壩頂：溢頂！</b>放流或溢洪道太小', '<b style="color:#b23a30">Water above the dam crest: overtopping!</b> Release or spillway too small') : tr('水位沒有超過壩頂', 'Water stays below the dam crest')}</span></li>`;
    if (tasks) {
      const rules = {
        spill: () => sim.L[sim.kS] > rv.spill + 0.05,
        half: () => peakAtt < 0.5 && !sim.overtop,
        drain: () => sim.S[sim.n - 1] < sim.S0 - 1 && sim.S[sim.kS] <= sim.S0 + 1,
      };
      tasks.querySelectorAll('li[data-task]').forEach((li) => { if (rules[li.dataset.task]?.()) done.add(li.dataset.task); li.classList.toggle('is-done', done.has(li.dataset.task)); });
    }
    drawStatic();
  }

  // ---- 圖 ----
  const off = document.createElement('canvas');
  let g0;
  function size() {
    const r = chart.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio);
    const w = chart.offsetWidth, h = chart.offsetHeight, k = (r.width / w) * dpr;
    chart.width = off.width = Math.max(1, Math.round(w * k)); chart.height = off.height = Math.max(1, Math.round(h * k));
    g0 = { w, h, k, l: 54, r: 46, top: 10, bot: 30 };
  }
  const css = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
  function drawStatic() {
    size();
    const { w, h, k, l, r, top, bot } = g0, g = off.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, w, h);
    g.font = `15px ${getComputedStyle(document.body).fontFamily}`;
    const ink = css('--muted', '#5b6268');
    const X = (t) => l + (t / sim.T) * (w - l - r);
    let qMax = 0; for (let n = 0; n < sim.n; n++) qMax = Math.max(qMax, sim.I[n], sim.O[n]);
    qMax = Math.ceil(qMax * 1.1 / 100) * 100;
    const Yq = (v) => h - bot - (v / qMax) * (h - top - bot);
    const sMin = Math.min(...sim.S), sMax = Math.max(...sim.S, rv.storeFromLevel(rv.spill));
    const pad = (sMax - sMin) * 0.15 + 1;
    const Ys = (v) => h - bot - ((v - (sMin - pad)) / (sMax - sMin + 2 * pad)) * (h - top - bot);
    // 溢洪道頂的蓄水量
    const sSp = rv.storeFromLevel(rv.spill);
    g.strokeStyle = '#2c9a5b'; g.setLineDash([4, 4]); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(l, Ys(sSp)); g.lineTo(w - r, Ys(sSp)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#2c9a5b'; g.textAlign = 'right'; g.fillText(tr('溢洪道頂', 'Spillway crest'), w - r - 4, Ys(sSp) - 5);
    // 曲線
    const line = (arr, Y, col, wdt) => { g.strokeStyle = col; g.lineWidth = wdt; g.beginPath(); for (let n = 0; n < sim.n; n += 2) g.lineTo(X(sim.t[n]), Y(arr[n])); g.stroke(); };
    // I − O 之間的面積（蓄水增加：藍、減少：橘）
    for (let n = 0; n < sim.n - 2; n += 2) {
      const a = sim.I[n] - sim.O[n];
      g.fillStyle = a >= 0 ? 'rgba(43,134,224,.16)' : 'rgba(194,106,29,.16)';
      g.beginPath(); g.moveTo(X(sim.t[n]), Yq(sim.I[n])); g.lineTo(X(sim.t[n + 2]), Yq(sim.I[n + 2])); g.lineTo(X(sim.t[n + 2]), Yq(sim.O[n + 2])); g.lineTo(X(sim.t[n]), Yq(sim.O[n])); g.fill();
    }
    line(sim.S, Ys, '#2c9a5b', 2.4);
    line(sim.I, Yq, '#2b86e0', 2.6);
    line(sim.O, Yq, '#c26a1d', 2.6);
    // S 最大處（= I 與 O 相交）
    const xs = X(sim.t[sim.kS]);
    g.strokeStyle = ink; g.setLineDash([2, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(xs, top); g.lineTo(xs, h - bot); g.stroke(); g.setLineDash([]);
    g.fillStyle = ink; g.textAlign = 'center'; g.fillText(tr('S 最大：I = O', 'Max S: I = O'), xs, top + 12);
    // 軸
    g.strokeStyle = ink; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(l, top); g.lineTo(l, h - bot); g.lineTo(w - r, h - bot); g.stroke(); g.globalAlpha = 1;
    g.textAlign = 'right'; g.fillText(`${qMax}`, l - 6, top + 10); g.fillText('0', l - 6, h - bot + 4);
    g.textAlign = 'center'; for (let tt = 0; tt < sim.T; tt += 12) g.fillText(`${tt}`, X(tt), h - bot + 20);
    g.textAlign = 'right'; g.fillText(`${sim.T} hr`, w - r + 30, h - bot + 20);
    g.save(); g.translate(14, (top + h - bot) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(tr('流量', 'Flow'), 0, 0); g.restore();
    g.save(); g.translate(w - 12, (top + h - bot) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = '#2c9a5b'; g.fillText(tr('蓄水量 S', 'Storage S'), 0, 0); g.restore();
  }
  function drawFrame(tau) {
    if (!g0) return;
    const { w, h, k, l, r, top, bot } = g0, g = chart.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, chart.width, chart.height); g.drawImage(off, 0, 0);
    g.setTransform(k, 0, 0, k, 0, 0);
    const x = l + (tau / sim.T) * (w - l - r);
    g.strokeStyle = '#a5631a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, top); g.lineTo(x, h - bot); g.stroke();
  }
  function tick() {
    raf = requestAnimationFrame(tick);
    if (!sim) return;
    const tau = ((rv.time - simOffset) * hoursPerSec) % sim.T;
    const n = Math.max(0, Math.min(sim.n - 1, Math.round(tau / sim.dt)));
    if (q('input[data-k="sim"]').checked) {
      rv.setLevel(sim.L[n]);
      const big = Math.max(sim.I[sim.kI], 1);
      rv.setFlows({ I: Math.min(1, sim.I[n] / 900), O: Math.min(1, P.Ob / 600), spill: Math.min(1, (sim.O[n] - Math.min(P.Ob, sim.O[n])) / 500) });
      rv.setRate((sim.I[n] - sim.O[n]) / big);
    }
    const d = sim.I[n] - sim.O[n];
    q('[data-o="now"]').innerHTML = `${tr(`第 ${fmt(tau, 1)} hr：`, `t = ${fmt(tau, 1)} hr: `)}${fmt(sim.I[n])} − ${fmt(sim.O[n])} = <b>${d >= 0 ? '+' : ''}${fmt(d)}</b>　→　${Math.abs(d) < 8 ? tr('水位持平', 'level steady') : d > 0 ? tr('水位上升', 'level rising') : tr('水位下降', 'level falling')}`;
    drawFrame(tau);
  }
  recompute();
  return {
    start() { if (!running) { running = true; simOffset = rv.time; recompute(); tick(); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    redraw() { if (sim) drawStatic(); },
    set(k, v) { if (!(k in unit)) return; P[k] = v; q(`input[data-k="${k}"]`).value = v; q(`output[data-o="${k}"]`).textContent = unit[k](v); recompute(); },
    reset() { Object.assign(P, { Ip: 700, Ob: 120, Cw: 500 }); for (const k of Object.keys(unit)) { q(`input[data-k="${k}"]`).value = P[k]; q(`output[data-o="${k}"]`).textContent = unit[k](P[k]); } recompute(); },
    get params() { return { ...P }; },
  };
}
