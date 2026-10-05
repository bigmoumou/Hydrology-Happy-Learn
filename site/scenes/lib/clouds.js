// 程式生成的雲與山嵐：一朵朵面向鏡頭的柔邊小球（instanced billboard），著色方式和 1-1 的雲相同——
// 把每朵當成小球、依太陽方向打亮，雲底較暗、邊緣有銀邊；靠近鏡頭時淡出，不會糊住畫面。
// 用法：scene.add(cloudPuffs(list, { timeUniform, sunDir, base, thick }))
//   list：[{ c: [x, y, z], s: 尺寸, shade: 0–1（越大越暗）, ph: 0–1（相位） }]
import * as THREE from 'three';
import { makePuffTexture } from './textures.js';

let puffTex = null;

export function cloudPuffs(list, { timeUniform, sunDir, opacity = 0.9, base = 30, thick = 7, tint = 0xffffff, drift = 1, renderOrder = 8 }) {
  puffTex ||= makePuffTexture();
  const g = new THREE.InstancedBufferGeometry();
  g.copy(new THREE.PlaneGeometry(1, 1));
  g.instanceCount = list.length;
  g.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((p) => p.c)), 3));
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((p) => [p.s, p.shade ?? 0.3, p.ph ?? 0, 0])), 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: timeUniform, uTex: { value: puffTex }, uSun: { value: sunDir.clone().normalize() }, uOpacity: { value: opacity },
      uBase: { value: base }, uThick: { value: thick }, uTint: { value: new THREE.Color(tint) }, uDrift: { value: drift },
    },
    vertexShader: `attribute vec3 aC; attribute vec4 aP; uniform float uTime, uDrift; varying vec2 vUv; varying vec4 vP; varying float vCy; varying float vNear;
      void main(){
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 c = aC + vec3(sin(uTime * 0.03 + aP.z * 6.0) * 0.8, 0.0, cos(uTime * 0.025 + aP.z * 5.0) * 0.5) * uDrift;
        vec3 p = c + (right * position.x + up * position.y) * aP.x;
        vUv = uv; vP = aP; vCy = aC.y;
        vNear = smoothstep(aP.x * 0.6, aP.x * 2.2, length(cameraPosition - c));
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform sampler2D uTex; uniform float uOpacity, uBase, uThick; uniform vec3 uSun, uTint; varying vec2 vUv; varying vec4 vP; varying float vCy; varying float vNear;
      void main(){
        float a0 = vP.z * 6.2831; mat2 R = mat2(cos(a0), -sin(a0), sin(a0), cos(a0));
        float a = texture2D(uTex, R * (vUv - 0.5) + 0.5).a;
        vec2 q = (vUv - 0.5) * 2.0; float r2 = dot(q, q);
        vec3 nV = normalize(vec3(q, sqrt(max(0.0, 1.0 - r2)) + 0.25));
        vec3 nW = normalize(transpose(mat3(viewMatrix)) * nV);
        float lit = clamp(0.5 + 0.55 * dot(nW, uSun), 0.0, 1.0);
        float hgt = clamp((vCy - uBase) / uThick + nW.y * 0.3, 0.0, 1.0);
        vec3 shade = mix(vec3(0.50, 0.55, 0.62), vec3(0.36, 0.40, 0.47), vP.y);
        vec3 col = mix(shade, vec3(0.93, 0.94, 0.95), lit * mix(0.5, 0.95, hgt));
        col += vec3(1.0, 0.97, 0.9) * pow(1.0 - nV.z, 3.0) * max(0.0, dot(nW, uSun)) * 0.25;
        gl_FragColor = vec4(col * uTint, a * uOpacity * vNear);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = renderOrder;
  m.userData.noAO = true;
  return m;
}
