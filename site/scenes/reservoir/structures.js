// 大壩周邊的附屬結構（第二、三層細節＋比例尺）：壩頂道路與護欄、路燈、取水塔與連絡橋、
// 沿下游壩面的壓力鋼管、壩趾發電廠、溢洪道導牆、壩頂停的小車、水庫上的小船。
// 全部程式生成；同材質的零件合併成一個網格，減少 draw call。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { block, paint, carGeometry } from '../lib/buildings.js';

const CONC = 0x8c877d, CONC_D = 0x77726a, STEEL = 0x3d4a45, GLASS = 0x34444c, ROOF = 0x6d6a64, ASPH = 0x4b4d4f;

// 沿斜面的牆（x 往下游、y 往上）：從 (xa, ya) 到 (xb, yb)，高 hh、厚 t，中心在 z
function slopeWall(xa, ya, xb, yb, hh, t, z, color) {
  const s = new THREE.Shape();
  s.moveTo(xa, ya - 0.3); s.lineTo(xb, yb - 0.3); s.lineTo(xb, yb + hh); s.lineTo(xa, ya + hh); s.lineTo(xa, ya - 0.3);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(0, 0, z - t / 2);
  return paint(g, color);
}

// 管線：沿折線的圓管
function pipe(points, r, color) {
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.05), 64, r, 14, false);
  return paint(g, color);
}

export function buildDamDetails(scene, ctx) {
  const { H, damX, crest, spill, spZ0, spZ1, zEnd, z1, thalAt, U } = ctx;
  const W = 1.4, slope = 0.78;                  // 壩頂寬、下游面坡度（水平／垂直）
  const faceX = (y) => damX + W + slope * (crest - y);   // 下游壩面在高度 y 的 x
  const conc = [], steel = [], glass = [], dark = [];

  // ---- 壩頂：路面、兩側護欄、路燈 ----
  const zA = zEnd + 0.2, zB = z1 - 0.02, L = zB - zA, zc = (zA + zB) / 2;
  dark.push(block(W - 0.3, 0.03, L, ASPH, damX + W / 2, crest + 0.015, zc));
  for (const x of [damX + 0.05, damX + W - 0.05]) {
    conc.push(block(0.08, 0.18, L, CONC, x, crest + 0.09, zc, 0.02));
    for (let z = zA + 0.4; z < zB; z += 0.9) conc.push(block(0.1, 0.22, 0.1, CONC_D, x, crest + 0.11, z));
  }
  const lamps = [];
  for (let z = zA + 1.1; z < zB - 0.3; z += 2.6) {
    const x = damX + W - 0.05;
    steel.push(block(0.035, 0.62, 0.035, 0x6e7275, x, crest + 0.31 + 0.1, z));
    steel.push(block(0.24, 0.025, 0.03, 0x6e7275, x - 0.11, crest + 0.72, z));
    lamps.push([x - 0.22, crest + 0.7, z]);
  }

  // ---- 取水塔＋連絡橋（上游面前方） ----
  const tz = -0.7, tx = damX - 1.9, tr = 0.55;
  {
    const yb = thalAt(tx) - 1.5, top = crest + 0.9;
    const tower = new THREE.CylinderGeometry(tr, tr * 1.08, top - yb, 28);
    tower.translate(tx, (top + yb) / 2, tz);
    conc.push(paint(tower, CONC));
    // 塔頂機房：一圈窗帶、屋頂
    const house = new THREE.CylinderGeometry(tr * 1.12, tr * 1.12, 0.62, 28);
    house.translate(tx, top + 0.31, tz);
    conc.push(paint(house, 0xa49e92));
    const band = new THREE.CylinderGeometry(tr * 1.13, tr * 1.13, 0.18, 28, 1, true);
    band.translate(tx, top + 0.36, tz);
    glass.push(paint(band, GLASS));
    const cap = new THREE.CylinderGeometry(tr * 0.5, tr * 1.22, 0.22, 28);
    cap.translate(tx, top + 0.73, tz);
    conc.push(paint(cap, ROOF));
    // 攔污柵（深色直條），水位低時看得到
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2, r = tr * 1.04;
      dark.push(block(0.1, 2.2, 0.04, 0x3a3f42, tx + Math.cos(ang) * r, yb + 3.2, tz + Math.sin(ang) * r, 0, -ang));
    }
    // 連絡橋
    const bx0 = tx + tr * 0.9, bx1 = damX + 0.02;
    conc.push(block(bx1 - bx0, 0.12, 0.42, CONC, (bx0 + bx1) / 2, crest - 0.04, tz));
    for (const s of [-1, 1]) steel.push(block(bx1 - bx0, 0.03, 0.025, 0x8c9296, (bx0 + bx1) / 2, crest + 0.17, tz + s * 0.2));
    for (const s of [-1, 1]) for (let x = bx0 + 0.15; x < bx1; x += 0.35) steel.push(block(0.02, 0.18, 0.02, 0x8c9296, x, crest + 0.09, tz + s * 0.2));
  }

  // ---- 壩趾發電廠＋沿下游壩面的壓力鋼管 ----
  const phX0 = faceX(ctx.floorDam) + 0.25, phW = 2.8, phZ0 = -1.45, phZ1 = 0.42;
  {
    const gy = thalAt(phX0 + 1) - 0.6, top = gy + 3.1, x = phX0 + phW / 2, z = (phZ0 + phZ1) / 2, d = phZ1 - phZ0;
    conc.push(block(phW, top - gy, d, 0xb5ae9f, x, (top + gy) / 2, z, 0.04));
    conc.push(block(phW + 0.12, 0.08, d + 0.12, ROOF, x, top + 0.04, z));
    conc.push(block(phW * 0.55, 0.35, d * 0.5, 0xbab3a5, x - 0.3, top + 0.2, z - 0.3));   // 屋頂上的機房
    // 窗：下游面直條窗、靠剖面這一側的窗帶
    for (let k = 0; k < 3; k++) glass.push(block(0.02, 1.2, 0.34, GLASS, phX0 + phW + 0.01, top - 1.0, phZ0 + 0.4 + k * (d - 0.8) / 2));
    for (let k = 0; k < 4; k++) glass.push(block(0.4, 0.9, 0.02, GLASS, phX0 + 0.5 + k * 0.68, top - 1.1, phZ1 + 0.01));
    // 尾水出口（深色拱口），出口外的水由水面著色器畫白浪
    dark.push(block(0.04, 0.55, 0.9, 0x1d2427, phX0 + phW + 0.02, gy + 0.85, z));
    // 壓力鋼管：從壩體中段穿出，沿壩面下來接到廠房
    for (const pz of [tz + 0.15]) {
      const y0 = crest - 4.2, y1 = gy + 1.6, off = 0.24;
      const n = new THREE.Vector2(1, slope).normalize();   // 壩面法向（x, y）
      const p = [
        new THREE.Vector3(faceX(y0) - 0.15, y0, pz),
        new THREE.Vector3(faceX(y0) + n.x * off, y0 + n.y * off, pz),
        new THREE.Vector3(faceX(y1 + 0.6) + n.x * off, y1 + 0.6 + n.y * off, pz),
        new THREE.Vector3(phX0 + 0.05, y1, pz),
        new THREE.Vector3(phX0 + 0.5, y1, pz),
      ];
      steel.push(pipe(p, 0.21, STEEL));
      // 鎮墩（轉角的混凝土塊）
      conc.push(block(0.55, 0.5, 0.55, CONC_D, faceX(y1 + 0.6) + 0.25, y1 + 0.55, pz, 0.04));
      for (let y = y1 + 1.8; y < y0 - 0.5; y += 1.6) conc.push(block(0.32, 0.18, 0.42, CONC_D, faceX(y) + n.x * 0.12, y + n.y * 0.12, pz));
    }
  }

  // ---- 溢洪道導牆（沿下游壩面兩側） ----
  {
    // 沿壩面往下走，碰到地面就是陡槽的終點
    const zm = (spZ0 + spZ1) / 2;
    let yb = spill;
    while (yb > ctx.floorDam && H(faceX(yb - 0.25), zm) < yb - 0.25) yb -= 0.25;
    const ya = spill;
    for (const z of [spZ0 - 0.06, spZ1 + 0.06]) conc.push(slopeWall(damX + W, ya, faceX(yb), yb, 0.55, 0.14, z, CONC));
  }

  const mk = (parts, mat) => {
    if (!parts.length) return null;
    const m = new THREE.Mesh(mergeGeometries(parts), mat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const concMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84 });
  mk(conc, concMat);
  mk(steel, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, envMap: scene.environment, envMapIntensity: 0.45 }));
  mk(glass, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0, envMapIntensity: 1.4 }));
  mk(dark, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));

  // 路燈燈頭：自發光（傍晚、陰天時 bloom 會讓它亮起來；白天只是小白點）
  {
    const g = mergeGeometries(lamps.map(([x, y, z]) => block(0.1, 0.035, 0.06, 0xffffff, x, y, z)));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xfff3dc, emissive: 0xffe2b0, emissiveIntensity: 0.6, roughness: 0.4 }));
    scene.add(m);
  }

  // ---- 壩頂停的兩台車 ----
  {
    const cars = new THREE.InstancedMesh(carGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }), 2);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), m4 = new THREE.Matrix4();
    [[damX + 0.45, zEnd + 2.2, 0xe9e6dc], [damX + 0.95, zEnd + 5.6, 0x9e2f28]].forEach(([x, z, c], i) => {
      cars.setMatrixAt(i, m4.compose(new THREE.Vector3(x, crest + 0.03, z), q, new THREE.Vector3(1, 1, 1)));
      cars.setColorAt(i, new THREE.Color(c));
    });
    cars.castShadow = true;
    scene.add(cars);
  }

  // ---- 水庫上的小船（跟著水位上下） ----
  const boat = new THREE.Group();
  {
    const hull = new THREE.LatheGeometry([[0, -0.06], [0.1, -0.05], [0.13, 0.0], [0.135, 0.05], [0, 0.05]].map(([x, y]) => new THREE.Vector2(x, y)), 18);
    hull.scale(2.6, 1, 1);
    const parts = [paint(hull, 0xeeeeea), block(0.16, 0.08, 0.14, 0xd9d6cf, -0.06, 0.09, 0, 0.02), block(0.02, 0.05, 0.12, GLASS, 0.03, 0.1, 0)];
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }));
    boat.add(m);
    // 船尾的水痕（略高於水面，波峰才不會把它蓋掉）
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.36).rotateX(-Math.PI / 2).translate(-1.05, 0.05, 0), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uTime: U.uTime },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float u = vUv.x, v = abs(vUv.y - 0.5) * 2.0; float spread = 0.25 + 0.75 * (1.0 - u);
          float a = (1.0 - smoothstep(0.0, spread, v)) * smoothstep(0.0, 0.25, u) * (0.25 + 0.2 * sin(u * 40.0 + uTime * 6.0));
          gl_FragColor = vec4(vec3(0.92, 0.96, 0.97), a * 0.7);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    wake.renderOrder = 5;
    boat.add(wake);
    boat.scale.setScalar(2);   // 船身（連水痕）放大 2 倍，鏡頭拉遠時也看得到
    scene.add(boat);
  }
  // 船沿著湖中線附近慢慢繞橢圓；水太淺（低水位）就不出現
  let level = 11;
  const place = (t) => {
    const w = 0.05, s = Math.sin(t * w), c = Math.cos(t * w);
    const bx = -9 + 3.2 * s, bz = -3.4 + 0.9 * c;
    boat.position.set(bx, level + 0.02 + (ctx.surfEta ? ctx.surfEta(bx, bz, t) : 0), bz);   // 跟著波浪、晃動起伏
    boat.rotation.y = Math.atan2(0.9 * s, 3.2 * c);
    boat.visible = level - H(boat.position.x, boat.position.z) > 0.5;   // 船變大了，吃水也要深一點才出現
  };
  place(0);
  return {
    setLevel(L) { level = L; place(U.uTime.value); },
    update(t) { place(t); },
  };
}
