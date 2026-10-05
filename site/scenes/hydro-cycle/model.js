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
  const sw = new Float32Array(n), ss = new Float32Array(n), sg = new Float32Array(n);   // 土壤含水比例、地表暫存比例、地下水蓄量
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
    // 這一步裡剛填滿地表暫存的話，只有剩下的時間能入滲（讓 F 剛好等於 f × (tr − Sc / i)）
    const inf = Math.min(rr, f * dt * (r > 0 ? rr / (r * dt) : 0));
    const e = rr - inf;
    const toSoil = Math.min(inf, Math.max(0, Se - soil));
    soil += toSoil;
    const drain = inf - toSoil;
    Si += drain * frac; Sg += drain * (1 - frac); Sq += e;
    const os = Math.min(Sq, (Sq / ks) * dt), oi = Math.min(Si, (Si / ki) * dt), og = Math.min(Sg, (Sg / kg) * dt);
    Sq -= os; Si -= oi; Sg -= og;
    infl[k] = inf / dt; ex[k] = e / dt; rech[k] = drain / dt;
    qs[k] = os / dt; qi[k] = oi / dt; qg[k] = og / dt;
    sw[k] = soil / Se; ss[k] = Ss / Sc; sg[k] = Sg;
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
  return { t, rain, infl, ex, rech, qs, qi, qg, sw, ss, sg, dt, T, tot: { ...tot, dSg, F, Sg0 }, overland, sub, caseId, peak, tPeak, params: { i, tr, f, Se, Sc } };
}

// 某一時刻各過程的強度（0–1），給 3D 場景用。
// 用固定的尺度換算（不是每場雨各自正規化），所以雨下得越大、3D 裡的水就越多。
export function intensities(sim, tau) {
  const k = Math.max(0, Math.min(sim.t.length - 1, Math.round(tau / sim.dt)));
  const { i, f, tr } = sim.params;
  const c = (v) => Math.min(1, Math.max(0, v));
  const raining = sim.rain[k] > 0;
  const sinceRain = sim.t[k] - tr;
  const q = sim.qs[k] + sim.qi[k] + sim.qg[k];
  // 窪地的水：雨一開始被截留＋窪蓄接住而漲起來，雨停後慢慢蒸發退回去（迴圈頭尾接得起來）
  const dry = 0.3, dryOut = 1 - (sinceRain > 0 ? Math.min(1, Math.max(0, (sinceRain - 3) / (sim.T - tr - 5))) : 0);
  return {
    rain: raining ? 0.12 + 0.88 * Math.min(1, i / 70) : 0,
    infil: raining ? c(0.25 + Math.min(i, f) / 40) : 0,
    overland: c(Math.pow(sim.qs[k] / 20, 0.7)),
    interflow: c(Math.pow(sim.qi[k] / 3, 0.7)),
    perc: c(Math.pow(sim.rech[k] / 15, 0.7)),
    gw: 0.35 + 0.65 * c((sim.qg[k] - sim.qg[0]) / 0.3),
    drip: raining ? 1 : 0,
    exfil: sinceRain > 6 ? c((sinceRain - 6) / 6) : 0,
    evap: raining ? 0.15 : c(0.3 + sinceRain / 8),
    transp: raining ? 0.1 : c(0.3 + sinceRain / 8),
    soilWet: c(sim.sw[k]),
    gwRise: c((sim.sg[k] - sim.tot.Sg0) / 20),
    flood: c(Math.pow(Math.max(0, q - sim.qg[0]) / 25, 0.8)),
    pond: dry + (1 - dry) * c(sim.ss[k]) * dryOut,
  };
}
