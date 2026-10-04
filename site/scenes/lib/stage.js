// 共用的 3D 舞台：渲染器、天空環境光、太陽陰影、展示台背景、標籤、鏡頭導覽、左右留白、慢速環繞、逐格擷取
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky } from 'three/addons/objects/Sky.js';

export const GLSL_NOISE = /* glsl */`
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 hash22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
  float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

export function createStage(container, { quality = 'high', capture = false, fov = 34, sunDir = new THREE.Vector3(-0.52, 0.66, 0.54), shadowBox = 100, steps = [] } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: capture });
  renderer.setPixelRatio(capture ? window.devicePixelRatio : Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'hc-canvas';
  container.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'hc-labels';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 6; controls.maxDistance = 320; controls.maxPolarAngle = Math.PI * 0.495;

  sunDir = sunDir.clone().normalize();
  const sky = new Sky(); sky.scale.setScalar(10000);
  const su = sky.material.uniforms;
  su.turbidity.value = 3.5; su.rayleigh.value = 1.4; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.82;
  su.sunPosition.value.copy(sunDir); su.cloudCoverage.value = 0; su.showSunDisc.value = 0;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(sky);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100000).texture;
  scene.environmentIntensity = 0.55;

  const sun = new THREE.DirectionalLight(0xfff1de, 2.7);
  sun.position.copy(sunDir).multiplyScalar(170);
  sun.castShadow = true;
  const res = { high: 4096, medium: 2048, low: 1024 }[quality];
  sun.shadow.mapSize.set(res, res);
  Object.assign(sun.shadow.camera, { left: -shadowBox, right: shadowBox, top: shadowBox * 0.9, bottom: -shadowBox * 0.9, near: 20, far: 400 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xd7e6f2, 0x6b5b45, 0.45));

  const bg = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color(0xcdd9e2) }, uMid: { value: new THREE.Color(0xeeebe4) }, uBot: { value: new THREE.Color(0xe2ddd2) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop, uMid, uBot; varying vec3 vP;
      void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.6, y)) : mix(uMid, uBot, smoothstep(0.0, -0.4, y));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  }));
  bg.renderOrder = -10;
  scene.add(bg);

  const timeUniform = { value: 0 };
  const state = { t: 0, paused: false, tween: null, step: 0, labels: true };
  const stepHooks = [];
  let insetLeft = 0, insetRight = 0;
  const scaleHooks = [];

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    const shift = w > 760 ? (insetLeft - insetRight) / 2 : 0;
    if (shift !== 0) camera.setViewOffset(w, h, -shift, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const px = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    scaleHooks.forEach((f) => f(px));
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let driftSpeed = 0, driftSign = 1;
  function setStep(i, { instant = false } = {}) {
    state.step = Math.max(0, Math.min(steps.length - 1, i));
    if (driftSpeed > 0) { driftSign = -driftSign; controls.autoRotateSpeed = driftSpeed * driftSign; }
    const [p, tg] = steps[state.step].cam;
    if (instant) { camera.position.set(...p); controls.target.set(...tg); state.tween = null; }
    else state.tween = { t0: performance.now(), dur: steps[state.step].dur || 1800, fromP: camera.position.clone(), fromT: controls.target.clone(), toP: new THREE.Vector3(...p), toT: new THREE.Vector3(...tg) };
    stepHooks.forEach((f) => f(steps[state.step]));
    return steps[state.step];
  }

  const updates = [];
  let raf = 0, last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!state.paused) state.t += dt;
    if (state.tween) {
      const k = Math.min(1, (now - state.tween.t0) / state.tween.dur), e = ease(k);
      camera.position.lerpVectors(state.tween.fromP, state.tween.toP, e);
      controls.target.lerpVectors(state.tween.fromT, state.tween.toT, e);
      if (k >= 1) state.tween = null;
    }
    controls.enabled = !state.tween;
    controls.update();
    timeUniform.value = state.t;
    updates.forEach((f) => f(state.t, dt));
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  function label(zh, en, pos, { center = [0.5, 1.15] } = {}) {
    const el = document.createElement('div');
    el.className = 'hc-label';
    el.innerHTML = `<span class="hc-label__box"><span class="hc-label__zh">${zh}</span>${en ? `<span class="hc-label__en">${en}</span>` : ''}</span>`;
    const obj = new CSS2DObject(el);
    obj.position.set(...pos); obj.center.set(...center);
    scene.add(obj);
    return { el, obj };
  }

  const api = {
    renderer, scene, camera, controls, sun, sunDir, timeUniform, state, steps,
    label, onStep: (f) => stepHooks.push(f), onUpdate: (f) => updates.push(f), onScale: (f) => scaleHooks.push(f),
    start() { resize(); if (steps.length) setStep(0, { instant: true }); if (!capture) raf = requestAnimationFrame(frame); },
    resize,
    setStep,
    setStepById(id, o) { const i = steps.findIndex((s) => s.id === id); return setStep(i < 0 ? 0 : i, o); },
    get step() { return state.step; },
    get time() { return state.t; },
    setPaused(p) { state.paused = p; },
    setInsets(l, r) { insetLeft = l; insetRight = r; resize(); },
    setDrift(speed) { driftSpeed = speed; controls.autoRotate = speed > 0; controls.autoRotateSpeed = speed; },
    setControls(mode) { controls.enableRotate = mode !== 'none'; controls.enableZoom = mode === 'full'; controls.enablePan = mode === 'full'; },
    setActive(on) {
      if (on && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
      if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
    },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); },
  };
  return api;
}

// 方塊圖切面的土層材質（與水文循環場景同一套）
export function strataMaterial({ bottom, timeUniform }) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uBottom: { value: bottom }, uTime: timeUniform, uLight: { value: 1.0 } },
    vertexShader: `attribute float aSurf, aSoil, aU; varying float vSurf, vSoil, vU; varying vec3 vPos;
      void main(){ vSurf = aSurf; vSoil = aSoil; vU = aU; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uBottom, uTime, uLight; varying float vSurf, vSoil, vU; varying vec3 vPos;
      ${GLSL_NOISE}
      void main(){
        float y = vPos.y, u = vU, depth = vSurf - y;
        float grain = hash12(floor(vec2(u, y) * 40.0));
        float yb = y + 0.7 * (fbm2(vec2(u * 0.035, 1.7)) - 0.5) * 2.0 + 0.25 * sin(u * 0.09);
        float bi = floor(yb / 2.1), bf = fract(yb / 2.1), br = hash12(vec2(bi, 7.0));
        vec3 alluv;
        if (br < 0.36) {
          vec2 i0 = floor(vec2(u, y) * 3.2), f0 = fract(vec2(u, y) * 3.2); float md = 8.0, cid = 0.0;
          for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) { vec2 g = vec2(float(xx), float(yy)); vec2 r = g + hash22(i0 + g) - f0; float d = dot(r, r); if (d < md) { md = d; cid = hash12(i0 + g); } }
          float rr = 0.30 + 0.12 * cid, dd = sqrt(md);
          float peb = 1.0 - smoothstep(rr - 0.05, rr, dd);
          alluv = mix(vec3(0.42, 0.35, 0.24), mix(vec3(0.45, 0.43, 0.40), vec3(0.62, 0.55, 0.45), cid), peb);
        } else if (br < 0.72) alluv = vec3(0.60, 0.49, 0.31) * (0.92 + 0.12 * grain);
        else alluv = vec3(0.43, 0.27, 0.17) * (0.96 + 0.04 * sin(y * 34.0)) * (0.97 + 0.05 * grain);
        alluv *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.035, bf));
        vec2 rp = vec2(u * 0.3, y * 0.62) + vec2(fbm2(vec2(u, y) * 0.12), fbm2(vec2(y, u) * 0.12)) * 1.1;
        vec2 ci = floor(rp), cf = fract(rp); float f1 = 8.0, f2 = 8.0, cid2 = 0.0;
        for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) { vec2 g = vec2(float(xx), float(yy)); vec2 r = g + hash22(ci + g) - cf; float d = dot(r, r); if (d < f1) { f2 = f1; f1 = d; cid2 = hash12(ci + g); } else if (d < f2) f2 = d; }
        float joint = (1.0 - smoothstep(0.0, 0.035, sqrt(f2) - sqrt(f1))) * smoothstep(0.35, 0.6, vnoise(vec2(u, y) * 0.4 + cid2 * 7.0));
        vec3 rock = mix(vec3(0.40, 0.39, 0.37), vec3(0.34, 0.335, 0.32), cid2) * (0.9 + 0.1 * vnoise(vec2(u, y) * 2.5));
        rock = mix(rock, vec3(0.16, 0.16, 0.155), joint * 0.55);
        float bedTop = vSurf - vSoil + (fbm2(vec2(u * 0.2, 3.0)) - 0.5) * 1.8;
        vec3 col = mix(alluv, rock, smoothstep(bedTop + 0.3, bedTop - 0.3, y));
        float topT = 0.65 + 0.3 * fbm2(vec2(u * 0.4, 9.0));
        col = mix(col, vec3(0.17, 0.105, 0.055) * (0.85 + 0.25 * grain), 1.0 - smoothstep(topT - 0.08, topT + 0.08, depth));
        col *= mix(0.8, 1.0, smoothstep(uBottom, uBottom + 10.0, y));
        col = mix(col, col * 1.45, 1.0 - smoothstep(0.0, 0.06, depth));
        gl_FragColor = vec4(col * uLight, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// 依高度場建立方塊圖的四個切面
export function buildBlockFaces(scene, { h, nx, nz, x0, z0, dx, bottom, soilAt = () => 6, material }) {
  const X = (i) => x0 + i * dx, Z = (j) => z0 + j * dx;
  for (const side of ['front', 'back', 'left', 'right']) {
    const cols = [];
    if (side === 'front' || side === 'back') { const j = side === 'front' ? nz - 1 : 0; for (let i = 0; i < nx; i++) cols.push([X(i), Z(j), j * nx + i, X(i)]); }
    else { const i = side === 'left' ? 0 : nx - 1; for (let j = 0; j < nz; j++) cols.push([X(i), Z(j), j * nx + i, Z(j)]); }
    const n = cols.length;
    const pos = new Float32Array(n * 6), surf = new Float32Array(n * 2), so = new Float32Array(n * 2), uu = new Float32Array(n * 2);
    cols.forEach(([x, z, k, u], c) => {
      pos.set([x, h[k], z, x, bottom, z], c * 6);
      surf[c * 2] = surf[c * 2 + 1] = h[k];
      so[c * 2] = so[c * 2 + 1] = soilAt(x, z, h[k]);
      uu[c * 2] = uu[c * 2 + 1] = u;
    });
    const ind = [];
    for (let c = 0; c < n - 1; c++) { const a = c * 2; ind.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 1));
    g.setAttribute('aSoil', new THREE.BufferAttribute(so, 1));
    g.setAttribute('aU', new THREE.BufferAttribute(uu, 1));
    g.setIndex(ind);
    scene.add(new THREE.Mesh(g, material));
  }
  const x1 = X(nx - 1), z1 = Z(nz - 1);
  const bottomMesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ color: 0x2a2520 }));
  bottomMesh.rotation.x = Math.PI / 2; bottomMesh.position.set((x0 + x1) / 2, bottom, (z0 + z1) / 2);
  scene.add(bottomMesh);
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShadowMaterial({ opacity: 0.16 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = bottom - 0.02; catcher.receiveShadow = true;
  scene.add(catcher);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vUv; void main(){ vec2 d = abs(vUv - 0.5) * 2.0; float r = max(d.x, d.y); gl_FragColor = vec4(0.0, 0.0, 0.0, 0.35 * (1.0 - smoothstep(0.78, 1.0, r))); }',
  }));
  contact.rotation.x = -Math.PI / 2; contact.scale.set((x1 - x0) * 1.12, (z1 - z0) * 1.2, 1); contact.position.set((x0 + x1) / 2, bottom - 0.01, (z0 + z1) / 2);
  scene.add(contact);
}

// 3D 粗箭頭（給水量收支用）：沿 +y 建立，長度可用 scale.y 調
export function arrowMesh(color, { r = 0.45, head = 1.6, headR = 1.1 } = {}) {
  const shaft = new THREE.CylinderGeometry(r, r, 1, 20, 1);
  shaft.translate(0, 0.5, 0);
  const cone = new THREE.ConeGeometry(headR, head, 24);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.0, emissive: new THREE.Color(color).multiplyScalar(0.25), transparent: true, opacity: 0.92 });
  const g = new THREE.Group();
  const s = new THREE.Mesh(shaft, mat), c = new THREE.Mesh(cone, mat);
  g.add(s, c);
  g.userData = { s, c, head, mat };
  g.setLength = (L) => { s.scale.y = Math.max(0.01, L); c.position.y = Math.max(0.01, L) + head / 2; };
  g.setLength(4);
  return g;
}
