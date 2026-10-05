// 沿路徑移動的粒子（入滲、中間流、地下水……）。位置只由時間 t 決定，可逐格重現。
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute float aSeed;
  attribute float aK;      // 0 = 水珠本體，1 = 後面的拖尾
  attribute vec3 aDir;     // 流動方向（世界座標）
  uniform float uScale;
  uniform float uSize;
  uniform float uAmount;
  uniform float uSoft;
  varying float vAlpha;
  varying float vK;
  varying vec2 vDir;       // 螢幕上的流動方向（y 朝上）
  varying float vElong;    // 0 = 正對鏡頭流動（圓形），1 = 橫越畫面（水滴形）
  varying float vPx;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = min(uSize * aSize * uScale / -mv.z, uScale * 0.02);
    if (uSoft < 0.5 && aK < 0.5) px *= 1.35;   // 水滴形要多一點空間給尾巴
    gl_PointSize = px;
    vPx = px;
    // 流量越小，看得到的粒子越少（用每顆粒子的大小亂數當門檻）
    vAlpha = aAlpha * smoothstep(aSeed - 0.06, aSeed, uAmount);
    // 柔和的水氣：貼近鏡頭時會變成一大片模糊的霧，淡掉
    if (uSoft > 0.5) vAlpha *= smoothstep(4.0, 14.0, -mv.z);
    vK = aK;
    // 流動方向投影到螢幕
    vec4 c1 = projectionMatrix * (mv + modelViewMatrix * vec4(aDir * 0.1, 0.0));
    vec2 d = c1.xy / c1.w - gl_Position.xy / gl_Position.w;
    d.x *= projectionMatrix[1][1] / projectionMatrix[0][0];
    float L = length(d);
    vDir = L > 1e-7 ? d / L : vec2(0.0, -1.0);
    vElong = smoothstep(0.2, 0.65, L * -mv.z / (0.1 * projectionMatrix[1][1]));
  }
`;
const FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity, uSoft;
  varying float vAlpha;
  varying float vK;
  varying vec2 vDir;
  varying float vElong;
  varying float vPx;
  void main() {
    vec2 c = vec2(gl_PointCoord.x - 0.5, 0.5 - gl_PointCoord.y);
    if (uSoft > 0.5) {   // 水氣：柔和的霧團
      float r = length(c);
      if (r > 0.5) discard;
      float core = smoothstep(0.5, 0.0, r);
      gl_FragColor = vec4(uColor * (0.9 + 0.3 * core), exp(-r * r * 14.0) * uOpacity * vAlpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    float aa = 1.6 / max(vPx, 1.0);   // 一個像素多寬（抗鋸齒）
    if (vK > 0.5) {      // 拖尾：柔和的小水痕
      float r = length(c);
      float a = 1.0 - smoothstep(0.18, 0.5, r);
      if (a <= 0.0) discard;
      gl_FragColor = vec4(mix(uColor, vec3(0.92, 0.97, 1.0), 0.25), a * 0.55 * uOpacity * vAlpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    // 水滴：沿流動方向的座標（along 往前為正、across 為側向）
    float along = dot(c, vDir), across = dot(c, vec2(-vDir.y, vDir.x));
    float R = mix(0.36, 0.25, vElong);
    float hc = mix(0.0, 0.1, vElong);              // 圓頭中心往前移，尾巴往後拉
    float tip = hc - R - mix(0.0, 0.28, vElong);   // 尾巴尖端
    float dHead = length(vec2(across, along - hc)) - R;
    float t = clamp((along - tip) / max(hc - tip, 1e-3), 0.0, 1.0);
    float dTail = along < hc ? abs(across) - R * pow(t, 0.75) * sqrt(max(0.0, 1.0 - pow(1.0 - t, 6.0))) : 1.0;
    if (along < tip) dTail = 1.0;
    float d = min(dHead, dTail);
    float mask = 1.0 - smoothstep(-aa, aa, d);
    if (mask <= 0.0) discard;
    // 把水滴當成小玻璃珠打光：球面法線、上方來光、白色高光點、邊緣反光
    vec2 q = vec2(across, along - hc) / R;
    vec2 qs = q.x * vec2(-vDir.y, vDir.x) + q.y * vDir;   // 轉回螢幕座標（光從畫面左上方來）
    float r2 = min(1.0, dot(q, q));
    vec3 n = normalize(vec3(qs, sqrt(1.0 - r2) + 0.15));
    vec3 Ld = normalize(vec3(-0.45, 0.7, 0.55));
    float lam = 0.72 + 0.42 * max(0.0, dot(n, Ld));
    float fres = pow(1.0 - n.z, 2.5);
    vec3 body = uColor * lam * mix(1.05, 0.8, smoothstep(0.0, 1.0, -q.y * 0.5 + 0.5) * vElong);
    vec3 col = body + vec3(0.55, 0.75, 0.95) * fres * 0.35;
    float spec = pow(max(0.0, dot(n, normalize(Ld + vec3(0.0, 0.0, 1.0)))), 60.0);
    col += vec3(1.0) * spec * 1.1;
    col = mix(col * 0.72, col, smoothstep(0.0, 0.18, -d));   // 細細的深色邊，淺色地面上也看得清楚
    float a = mask * mix(0.82, 1.0, fres);
    gl_FragColor = vec4(col, a * uOpacity * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class FlowSystem {
  // paths: Array<Float32Array>（xyz 依序），perPath：每條路徑的粒子數，speed：世界單位／秒
  constructor(paths, { color = 0x3a8fd8, size = 0.5, perPath = 3, speed = 1.5, rand = Math.random, fade = 0.12, name = '', trail = 4, gap = 0.22, soft = false } = {}) {
    this.name = name;
    this.paths = [];
    for (const p of paths) {
      const n = p.length / 3;
      if (n < 2) continue;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        cum[i] = cum[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]);
      }
      if (cum[n - 1] < 1e-3) continue;
      this.paths.push({ p, cum, len: cum[n - 1] });
    }
    // 每顆粒子後面拖著 trail-1 個漸淡的小點，看起來像在流動
    this.trail = trail; this.gap = gap; this.soft = soft;
    const heads = this.paths.length * perPath;
    const count = heads * trail;
    this.heads = heads;
    this.part = new Float32Array(heads * 3); // [pathIdx, phase, speedMul]
    let q = 0;
    for (let i = 0; i < this.paths.length; i++) for (let k = 0; k < perPath; k++) {
      this.part[q++] = i; this.part[q++] = (k + rand() * 0.8) / perPath; this.part[q++] = 0.75 + rand() * 0.5;
    }
    this.speed = speed; this.fade = fade;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    const sizes = new Float32Array(count), kind = new Float32Array(count);
    this.dir = new Float32Array(count * 3);
    for (let i = 0; i < heads; i++) {
      const base = 0.75 + rand() * 0.5;
      for (let k = 0; k < trail; k++) {
        sizes[i * trail + k] = soft ? base : base * (k === 0 ? 1 : 0.62 * (1 - (k - 1) / trail));   // 拖尾越後面越細
        kind[i * trail + k] = k === 0 ? 0 : 1;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aK', new THREE.BufferAttribute(kind, 1));
    geo.setAttribute('aDir', new THREE.BufferAttribute(this.dir, 3).setUsage(THREE.DynamicDrawUsage));
    const seeds = new Float32Array(count);
    for (let i = 0; i < heads; i++) { const r = rand(); for (let k = 0; k < trail; k++) seeds[i * trail + k] = r; }
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uAmount: { value: 1 }, uScale: { value: 600 }, uSize: { value: size }, uSoft: { value: soft ? 1 : 0 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.count = count;
  }

  update(t) {
    const P = this.part, pos = this.pos, al = this.alpha, tr = this.trail, dir = this.dir;
    for (let i = 0; i < this.heads; i++) {
      const path = this.paths[P[i * 3]];
      const L = path.len, cum = path.cum, p = path.p;
      const s0 = ((P[i * 3 + 1] * L + t * this.speed * P[i * 3 + 2]) % L + L) % L;
      for (let k = 0; k < tr; k++) {
        const s = s0 - k * this.gap;
        const o = i * tr + k;
        if (s < 0) { al[o] = 0; continue; }
        let lo = 0, hi = cum.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
        const u = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
        pos[o * 3] = p[lo * 3] + (p[hi * 3] - p[lo * 3]) * u;
        pos[o * 3 + 1] = p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * u;
        pos[o * 3 + 2] = p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * u;
        if (k === 0) {
          const ex = p[hi * 3] - p[lo * 3], ey = p[hi * 3 + 1] - p[lo * 3 + 1], ez = p[hi * 3 + 2] - p[lo * 3 + 2], el = Math.hypot(ex, ey, ez) || 1;
          dir[o * 3] = ex / el; dir[o * 3 + 1] = ey / el; dir[o * 3 + 2] = ez / el;
        }
        const f = s / L;
        al[o] = Math.min(1, f / this.fade, (1 - f) / this.fade) * (this.soft ? 0.55 : k === 0 ? 1 : 0.85 * (1 - (k - 1) / tr));
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
    this.points.geometry.attributes.aDir.needsUpdate = true;
  }

  setScale(px) { this.material.uniforms.uScale.value = px; }
}

// Chaikin 平滑（xyz 扁平陣列）
export function chaikin(arr, iters = 2) {
  let a = arr;
  for (let it = 0; it < iters; it++) {
    const n = a.length / 3;
    if (n < 3) return a;
    const out = [a[0], a[1], a[2]];
    for (let i = 0; i < n - 1; i++) {
      const x0 = a[i * 3], y0 = a[i * 3 + 1], z0 = a[i * 3 + 2], x1 = a[i * 3 + 3], y1 = a[i * 3 + 4], z1 = a[i * 3 + 5];
      out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.75 * z0 + 0.25 * z1);
      out.push(0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1, 0.25 * z0 + 0.75 * z1);
    }
    out.push(a[a.length - 3], a[a.length - 2], a[a.length - 1]);
    a = out;
  }
  return Float32Array.from(a);
}
