// 沿路徑移動的粒子（入滲、中間流、地下水……）。位置只由時間 t 決定，可逐格重現。
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute float aSeed;
  uniform float uScale;
  uniform float uSize;
  uniform float uAmount;
  uniform float uSoft;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aSize * uScale / -mv.z;
    // 流量越小，看得到的粒子越少（用每顆粒子的大小亂數當門檻）
    vAlpha = aAlpha * smoothstep(aSeed - 0.06, aSeed, uAmount);
    // 柔和的水氣：貼近鏡頭時會變成一大片模糊的霧，淡掉
    if (uSoft > 0.5) vAlpha *= smoothstep(4.0, 14.0, -mv.z);
  }
`;
const FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity, uSoft;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float core = smoothstep(0.5, 0.0, r);
    float rim = smoothstep(0.5, 0.32, r);
    vec3 col = mix(uColor * 0.55, uColor * 1.25 + 0.08, core);
    float a = rim;
    if (uSoft > 0.5) { col = uColor * (0.9 + 0.3 * core); a = exp(-r * r * 14.0); }
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
    const sizes = new Float32Array(count);
    for (let i = 0; i < heads; i++) {
      const base = 0.75 + rand() * 0.5;
      for (let k = 0; k < trail; k++) sizes[i * trail + k] = soft ? base : base * (1 - k / (trail + 1.5));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
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
    const P = this.part, pos = this.pos, al = this.alpha, tr = this.trail;
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
        const f = s / L;
        al[o] = Math.min(1, f / this.fade, (1 - f) / this.fade) * (this.soft ? 0.55 : 1 - k / tr);
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
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
