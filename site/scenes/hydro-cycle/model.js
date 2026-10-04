// 單場降雨的教學示意模型（不是校正過的水文模式）
// 目的：讓「降雨強度 i、入滲容量 f、土壤水份有效容量 Se」怎麼決定各種水流，能被看見、被算出來。
// 對應課本：圖 1-2（降雨組體圖 → 各過程 → 出口歷線）、式 (1-2)(1-3)(1-4)、2.3.3 節 Horton (1935) 四種情況。
// 單位：全部以「集水區平均水深」表示，量用 mm、流率用 mm/hr。

export const DEFAULTS = { i: 30, tr: 4, f: 15, Se: 60 };

export function simulate({ i, tr, f, Se }, o = {}) {
  const {
    Sc = 5,      // 地表暫存容量（截留＋窪蓄），mm
    ks = 1.2,    // 地表逕流的線性水庫常數，hr
    ki = 6,      // 中間流
    kg = 90,     // 地下水（基流）
    frac = 0.55, // 超過 Se 的入滲水中，走中間流的比例（其餘滲漏成地下水）
    q0 = 0.5,    // 降雨前的基流，mm/hr
    T = 36, dt = 0.05,
  } = o;
  const n = Math.round(T / dt) + 1;
  const t = new Float32Array(n), rain = new Float32Array(n), infl = new Float32Array(n), ex = new Float32Array(n);
  const qs = new Float32Array(n), qi = new Float32Array(n), qg = new Float32Array(n), rech = new Float32Array(n);
  let Ss = 0, soil = 0, Sq = 0, Si = 0, Sg = q0 * kg;
  const Sg0 = Sg;
  const tot = { P: 0, Ia: 0, INF: 0, Q: 0, INT: 0, G: 0 };
  let F_tr = 0, Ss_tr = 0;
  for (let k = 0; k < n; k++) {
    const tk = k * dt;
    t[k] = tk;
    const r = tk < tr ? i : 0;
    rain[k] = r;
    let rr = r * dt;
    const toS = Math.min(rr, Sc - Ss); Ss += toS; rr -= toS;
    const inf = Math.min(rr, f * dt);
    const e = rr - inf;
    const toSoil = Math.min(inf, Math.max(0, Se - soil));
    soil += toSoil;
    const drain = inf - toSoil;
    Si += drain * frac; Sg += drain * (1 - frac); Sq += e;
    const os = Math.min(Sq, (Sq / ks) * dt), oi = Math.min(Si, (Si / ki) * dt), og = Math.min(Sg, (Sg / kg) * dt);
    Sq -= os; Si -= oi; Sg -= og;
    infl[k] = inf / dt; ex[k] = e / dt; rech[k] = drain / dt;
    qs[k] = os / dt; qi[k] = oi / dt; qg[k] = og / dt;
    tot.P += r * dt; tot.INF += inf; tot.Q += e; tot.INT += oi; tot.G += og;
    if (tk < tr) { F_tr = tot.INF; Ss_tr = Ss; }
  }
  tot.Ia = Ss_tr;
  const dSg = tot.INF - tot.INT - tot.G; // = 土壤水增量 + 地下水與中間流蓄量變化
  const F = F_tr;
  const overland = i > f;
  const sub = F > Se;
  const caseId = overland ? (sub ? 'd' : 'c') : (sub ? 'b' : 'a');
  let peak = 0, tPeak = 0;
  for (let k = 0; k < n; k++) { const q = qs[k] + qi[k] + qg[k]; if (q > peak) { peak = q; tPeak = t[k]; } }
  return { t, rain, infl, ex, rech, qs, qi, qg, dt, T, tot: { ...tot, dSg, F, Sg0 }, overland, sub, caseId, peak, tPeak, params: { i, tr, f, Se, Sc } };
}

// 某一時刻各過程的相對強度（0–1），給 3D 場景用
export function intensities(sim, tau) {
  const k = Math.max(0, Math.min(sim.t.length - 1, Math.round(tau / sim.dt)));
  const max = (a) => { let m = 1e-9; for (const v of a) if (v > m) m = v; return m; };
  sim._max ??= { qs: max(sim.qs), qi: max(sim.qi), rech: max(sim.rech), qg: max(sim.qg) };
  const M = sim._max;
  const raining = sim.rain[k] > 0;
  const sinceRain = sim.t[k] - sim.params.tr;
  return {
    rain: raining ? 0.12 + 0.88 * Math.min(1, sim.params.i / 70) : 0,
    infil: raining ? Math.min(1, 0.25 + sim.infl[k] / Math.max(1, sim.params.f)) : 0,
    overland: sim.overland ? Math.min(1, (sim.qs[k] / M.qs) * 1.2) : 0,
    interflow: sim.sub ? Math.min(1, (sim.qi[k] / M.qi) * 1.3) : 0,
    perc: sim.sub ? Math.min(1, sim.rech[k] / M.rech + (raining ? 0.15 : 0)) : 0,
    gw: 0.35 + 0.65 * Math.min(1, (sim.qg[k] - sim.qg[0]) / Math.max(1e-6, M.qg - sim.qg[0])),
    drip: raining ? 1 : 0,
    exfil: sinceRain > 6 ? Math.min(1, (sinceRain - 6) / 6) : 0,
    evap: raining ? 0.15 : Math.min(1, 0.3 + sinceRain / 8),
    transp: raining ? 0.1 : Math.min(1, 0.3 + sinceRain / 8),
  };
}
