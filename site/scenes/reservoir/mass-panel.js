// 單元 1-3 互動實驗：流量累積曲線（Mass curve，Rippl 法）決定水庫容量
// 資料：課本第 1 章習題 8 的月平均流量（m³/s），重複兩年；需水量 D 固定
// 容量單位用「(m³/s)·月」：1 (m³/s)·月 ≈ 2.592 × 10⁶ m³（以 30 天計）
import { tr, EN } from '../../assets/i18n.js';

export const FLOWS = [60, 45, 35, 25, 15, 22, 50, 80, 105, 90, 80, 70];
const MEAN = FLOWS.reduce((a, b) => a + b, 0) / 12;

// 需要的容量 = 累積虧缺的最大值（sequent peak），用兩年連續資料算
export function requiredStorage(D) {
  let k = 0, K = 0, kStart = -1, crit = null, start = 0;
  const Q = [...FLOWS, ...FLOWS];
  for (let m = 0; m < Q.length; m++) {
    const before = k;
    k = Math.max(0, k + D - Q[m]);
    if (before === 0 && k > 0) start = m;
    if (k > K) { K = k; crit = [start, m]; }
  }
  return { K, crit, feasible: D < MEAN - 1e-9 || D <= Math.min(...FLOWS) };
}

export function mountMass({ phys, chart, tasks, rv, monthsPerSec = 1.2 }) {
  phys.innerHTML = `
    <header class="phys__head">
      <p class="phys__eyebrow">PARAMETERS · ${tr(`習題 8 的月流量`, `EXERCISE 8 FLOWS`)}</p>
      <h3 class="phys__title">${tr(`流量累積曲線決定水庫容量`, `Sizing a reservoir with the mass curve`)}</h3>
    </header>
    <section class="ph">
      <h4><span class="ph__no">01</span>${tr(`河川月流量`, `Monthly river flow`)} <em>m³/s</em></h4>
      <div class="months" data-o="months"></div>
      <p class="ph__derived">${tr(`平均流量 <b>${MEAN.toFixed(1)}</b> m³/s；最小 <b>${Math.min(...FLOWS)}</b> m³/s（5 月）`, `Mean <b>${MEAN.toFixed(1)}</b> m³/s; minimum <b>${Math.min(...FLOWS)}</b> m³/s (May)`)}</p>
    </section>
    <section class="ph">
      <h4><span class="ph__no">02</span>${tr(`固定需水量 <em>demand</em>`, `Constant demand`)}</h4>
      <div class="sl"><label>${tr(`需水量`, `Demand`)} <var>D</var></label><output data-o="D"></output><input type="range" data-k="D" min="5" max="60" step="1" aria-label="${tr(`需水量`, `Demand`)}"></div>
    </section>
    <section class="ph">
      <h4><span class="ph__no">03</span>${tr(`需要的水庫容量 <em>Rippl 法</em>`, `Required storage <em>Rippl method</em>`)}</h4>
      <div class="eq"><span class="eq__f" data-o="K"></span><span class="eq__n" data-o="Km3"></span></div>
      <ul class="checks" data-o="checks"></ul>
    </section>`;
  const q = (s) => phys.querySelector(s);
  const mo = q('[data-o="months"]');
  mo.innerHTML = FLOWS.map((f, i) => `<span><i style="height:${(f / 105) * 100}%"></i><b>${f}</b><small>${i + 1}</small></span>`).join('');
  const P = { D: 40 };
  let res, run, raf = 0, running = false, t0 = 0;
  const inp = q('input[data-k="D"]');
  inp.value = P.D; q('output[data-o="D"]').textContent = `${P.D} m³/s`;
  inp.addEventListener('input', () => { P.D = +inp.value; q('output[data-o="D"]').textContent = `${P.D} m³/s`; recompute(); });
  const done = new Set();

  function operate(D, K) {
    // 從 1 月初水庫滿水開始，逐月操作兩年（用細分時間步讓 3D 平滑）
    const Q = [...FLOWS, ...FLOWS], sub = 10, S = [K];
    let s = K, empty = false;
    for (let m = 0; m < Q.length; m++) for (let k = 0; k < sub; k++) {
      s = Math.min(K, s + (Q[m] - D) / sub);
      if (s < -1e-6) { empty = true; s = 0; }
      S.push(s);
    }
    return { S, sub, empty };
  }

  function recompute() {
    res = requiredStorage(P.D);
    const K = res.feasible ? res.K : Infinity;
    q('[data-o="K"]').innerHTML = res.feasible
      ? (res.K <= 1e-9 ? tr(`<var>K</var> = 0：每個月流量都夠，不需要水庫`, `<var>K</var> = 0: every month meets the demand, no reservoir needed`) : tr(`<var>K</var> = 最大累積虧缺 = <b>${res.K.toFixed(0)}</b> (m³/s)·月`, `<var>K</var> = max cumulative deficit = <b>${res.K.toFixed(0)}</b> (m³/s)·month`))
      : tr(`<var>D</var> 超過平均流量，蓋多大的水庫都不夠`, `<var>D</var> exceeds the mean flow: no reservoir is big enough`);
    q('[data-o="Km3"]').textContent = res.feasible && res.K > 0 ? tr(`≈ ${(res.K * 2.592).toFixed(0)} × 10⁶ m³（每月以 30 天計）`, `≈ ${(res.K * 2.592).toFixed(0)} × 10⁶ m³ (30-day months)`) : '';
    q('[data-o="checks"]').innerHTML = res.feasible && res.K > 0
      ? `<li class="yes"><span>${tr(`關鍵期：第 ${res.crit[0] % 12 + 1} 月到第 ${res.crit[1] % 12 + 1} 月，流量連續低於需水量`, `Critical period: month ${res.crit[0] % 12 + 1} to month ${res.crit[1] % 12 + 1}, flow stays below demand`)}</span></li>`
      : '';
    run = operate(P.D, res.feasible ? res.K : 1e9);
    if (tasks) {
      const rules = { d40: () => P.D === 40, zero: () => res.feasible && res.K === 0, mean: () => !res.feasible || res.K > 300 };
      tasks.querySelectorAll('li[data-task]').forEach((li) => { if (rules[li.dataset.task]?.()) done.add(li.dataset.task); li.classList.toggle('is-done', done.has(li.dataset.task)); });
    }
    drawStatic();
  }

  // ---- 圖：累積流量曲線＋需水線 ----
  const off = document.createElement('canvas');
  let g0;
  function size() {
    const r = chart.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio);
    const w = chart.offsetWidth, h = chart.offsetHeight, k = (r.width / w) * dpr;
    chart.width = off.width = Math.max(1, Math.round(w * k)); chart.height = off.height = Math.max(1, Math.round(h * k));
    g0 = { w, h, k, l: 60, r: 14, top: 12, bot: 30 };
  }
  function drawStatic() {
    size();
    const { w, h, k, l, r, top, bot } = g0, g = off.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, w, h);
    g.font = `15px ${getComputedStyle(document.body).fontFamily}`;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#5b6268';
    const Q = [...FLOWS, ...FLOWS], C = [0];
    for (const v of Q) C.push(C[C.length - 1] + v);
    const X = (m) => l + (m / 24) * (w - l - r);
    const Y = (v) => h - bot - (v / C[24]) * (h - top - bot);
    // 平均流量線（虛線）
    g.strokeStyle = ink; g.setLineDash([3, 4]); g.lineWidth = 1; g.globalAlpha = 0.7;
    g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(24), Y(C[24])); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    // 累積流量曲線
    g.strokeStyle = '#2b86e0'; g.lineWidth = 3; g.beginPath(); C.forEach((v, m) => g.lineTo(X(m), Y(v))); g.stroke();
    g.fillStyle = '#2b86e0'; C.forEach((v, m) => { g.beginPath(); g.arc(X(m), Y(v), 2.5, 0, 6.29); g.fill(); });
    // 需水線：從關鍵期開始的切線，與曲線的最大垂直距離 = 容量
    if (res.feasible && res.K > 0) {
      const [a, b] = res.crit;
      const m0 = a, v0 = C[m0];
      g.strokeStyle = '#c26a1d'; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(X(m0), Y(v0)); g.lineTo(X(Math.min(24, m0 + 12)), Y(v0 + P.D * Math.min(12, 24 - m0))); g.stroke();
      const mb = b + 1, vb = C[mb], vd = v0 + P.D * (mb - m0);
      g.strokeStyle = '#2c9a5b'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(X(mb), Y(vb)); g.lineTo(X(mb), Y(vd)); g.stroke();
      g.beginPath(); g.moveTo(X(mb) - 7, Y(vb)); g.lineTo(X(mb) + 7, Y(vb)); g.moveTo(X(mb) - 7, Y(vd)); g.lineTo(X(mb) + 7, Y(vd)); g.stroke();
      g.fillStyle = '#2c9a5b'; g.textAlign = 'left'; g.fillText(`K = ${res.K.toFixed(0)}`, X(mb) + 10, (Y(vb) + Y(vd)) / 2 + 5);
    }
    g.strokeStyle = ink; g.globalAlpha = 0.6; g.lineWidth = 1; g.beginPath(); g.moveTo(l, top); g.lineTo(l, h - bot); g.lineTo(w - r, h - bot); g.stroke(); g.globalAlpha = 1;
    g.fillStyle = ink; g.textAlign = 'center';
    for (let m = 0; m <= 24; m += 3) g.fillText(m === 0 ? '0' : `${m}`, X(m), h - bot + 20);
    g.textAlign = 'right'; g.fillText(`${C[24]}`, l - 6, top + 10); g.fillText('0', l - 6, h - bot + 4);
    g.save(); g.translate(16, (top + h - bot) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(tr('累積流量 (m³/s)·月', 'Cumulative flow (m³/s)·month'), 0, 0); g.restore();
    // 時間單位：中文「月」放在最後一個刻度旁；英文字較長，放在 x 軸線上方的右下角（那裡曲線已經很高，不會擋到）
    g.textAlign = 'right';
    if (EN) g.fillText('months', w - r, h - bot - 6); else g.fillText('月', w - r, h - bot + 20);
  }
  function drawFrame(mon) {
    if (!g0) return;
    const { w, h, k, l, r, top, bot } = g0, g = chart.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, chart.width, chart.height); g.drawImage(off, 0, 0);
    g.setTransform(k, 0, 0, k, 0, 0);
    const x = l + (mon / 24) * (w - l - r);
    g.strokeStyle = '#a5631a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, top); g.lineTo(x, h - bot); g.stroke();
  }
  function tick() {
    raf = requestAnimationFrame(tick);
    if (!res) return;
    const mon = ((rv.time - t0) * monthsPerSec) % 24;
    const idx = Math.min(run.S.length - 1, Math.round(mon * run.sub));
    const mi = Math.floor(mon) % 12;
    mo.querySelectorAll('span').forEach((s, i) => s.classList.toggle('is-on', i === mi));
    {
      const K = res.feasible ? res.K : 0;
      const frac = K > 0 ? run.S[idx] / K : 1;
      rv.setLevel(rv.lowLevel + (rv.spill - 0.05 - rv.lowLevel) * Math.max(0, Math.min(1, frac)));
      const Qm = FLOWS[mi];
      rv.setFlows({ I: Math.min(1, Qm / 105), O: Math.min(1, P.D / 105), spill: K > 0 && frac >= 0.999 && Qm > P.D ? Math.min(1, (Qm - P.D) / 60) : 0 });
      rv.setRate(K > 0 && frac < 0.999 ? (Qm - P.D) / 60 : 0);
    }
    drawFrame(mon);
  }
  recompute();
  return {
    start() { if (!running) { running = true; t0 = rv.time; recompute(); tick(); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    redraw() { if (res) drawStatic(); },
    set(k, v) { if (k !== 'D') return; P.D = v; inp.value = v; q('output[data-o="D"]').textContent = `${v} m³/s`; recompute(); },
    reset() { this.set('D', 40); },
    get params() { return { ...P }; },
  };
}
