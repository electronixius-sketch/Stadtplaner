// Gemeinsame Materialien. Das Weltmaterial erweitert MeshLambertMaterial um
// prozedurale Fenster (tags Glas, nachts beleuchtet), Lampen-Leuchten und Info-Ansichten.
import * as THREE from '../../vendor/three.module.min.js';
import { MAP_SIZE } from '../config.js';

export const uniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
  uOverlayTex: { value: null },
  uOverlayOn: { value: 0 },
  uMapSize: { value: MAP_SIZE },
  uHL: { value: new THREE.Vector4(-10, -10, -10, -10) },
  uHLColor: { value: new THREE.Color(0x3fa9ff) },
};

// aWin-Codes: 0 nichts, 1 Fenster, 2 Lampe, 3 Glasfassade, 4 Hausfenster, 5 feste Farbe,
// 6/7/8 wie 1/3/4 aber ohne Nachtlicht (unbewohnt/ohne Strom)
const VERT_HEAD = /* glsl */`
attribute float aWin;
varying float vWin;
varying vec3 vWPos;
varying vec3 vWNorm;
`;

const VERT_BODY = /* glsl */`
vWin = aWin;
{
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    wn = mat3(instanceMatrix) * wn;
  #endif
  wp = modelMatrix * wp;
  vWPos = wp.xyz;
  vWNorm = normalize(mat3(modelMatrix) * wn);
}
`;

const FRAG_HEAD = /* glsl */`
uniform float uNight;
uniform float uTime;
uniform sampler2D uOverlayTex;
uniform float uOverlayOn;
uniform float uMapSize;
uniform vec4 uHL;
uniform vec3 uHLColor;
varying float vWin;
varying vec3 vWPos;
varying vec3 vWNorm;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const FRAG_BODY = /* glsl */`
{
  float vert = 1.0 - abs(vWNorm.y);
  float code = vWin;
  bool noLight = code > 5.5;
  if (noLight) code -= 5.0;
  if (vert > 0.6 && (abs(code - 1.0) < 0.5 || abs(code - 3.0) < 0.5 || abs(code - 4.0) < 0.5)) {
    bool xFacing = abs(vWNorm.x) > abs(vWNorm.z);
    float along = xFacing ? vWPos.z : vWPos.x;
    float plane = xFacing ? vWPos.x : vWPos.z;
    float floorH = 0.22; float colW = 0.2; vec4 r = vec4(0.24, 0.76, 0.3, 0.8);
    vec3 glass = vec3(0.035, 0.05, 0.07);
    float litP = 0.42;
    if (abs(code - 3.0) < 0.5) { floorH = 0.2; colW = 0.14; r = vec4(0.06, 0.94, 0.12, 0.92); glass = vec3(0.05, 0.09, 0.13); litP = 0.5; }
    if (abs(code - 4.0) < 0.5) { floorH = 0.24; colW = 0.25; r = vec4(0.3, 0.7, 0.36, 0.78); litP = 0.45; }
    vec2 g = vec2(along / colW, (vWPos.y + 0.02) / floorH);
    vec2 f = fract(g);
    vec2 cell = floor(g);
    float inWin = step(r.x, f.x) * step(f.x, r.y) * step(r.z, f.y) * step(f.y, r.w);
    vec2 fw = fwidth(g);
    float aa = clamp(1.0 - max(fw.x, fw.y) * 1.2, 0.0, 1.0);
    float cover = (r.y - r.x) * (r.w - r.z);
    float win = mix(cover, inWin, aa);
    float rnd = hash12(cell + vec2(floor(plane * 2.0) * 13.7, floor(plane * 2.0) * 5.3));
    float fres = 0.6 + 0.4 * hash12(cell * 1.7 + 3.1);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass * fres * 2.2, win * 0.88);
    if (!noLight) {
      float lit = step(1.0 - litP, rnd);
      float warm = hash12(cell.yx + 7.0);
      vec3 lightCol = mix(vec3(1.0, 0.72, 0.38), vec3(0.85, 0.9, 1.0), step(0.8, warm));
      totalEmissiveRadiance += mix(cover * litP, inWin * lit, aa) * uNight * lightCol * (0.55 + 0.45 * hash12(cell + 11.0));
    }
  }
  if (abs(code - 2.0) < 0.5 && !noLight) {
    totalEmissiveRadiance += diffuseColor.rgb * (0.1 + uNight * 1.8);
  }
  if (uHL.x > -5.0 && vWPos.x > uHL.x && vWPos.x < uHL.z && vWPos.z > uHL.y && vWPos.z < uHL.w) {
    totalEmissiveRadiance += uHLColor * (0.18 + 0.08 * sin(uTime * 5.0));
  }
  if (uOverlayOn > 0.5) {
    vec2 ouv = vWPos.xz / uMapSize;
    float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    if (ouv.x >= 0.0 && ouv.x <= 1.0 && ouv.y >= 0.0 && ouv.y <= 1.0) {
      vec4 o = texture2D(uOverlayTex, ouv);
      vec3 base = vec3(0.22 + l * 0.55);
      diffuseColor.rgb = mix(base, o.rgb, o.a);
    } else {
      diffuseColor.rgb = vec3(0.12 + l * 0.4);
    }
    totalEmissiveRadiance *= 0.25;
  }
}
`;

function patchColorVertex() {
  return THREE.ShaderChunk.color_vertex.replace(
    'vColor.xyz *= instanceColor.xyz;',
    'if (aWin < 0.5) vColor.xyz *= instanceColor.xyz;'
  );
}

export function createWorldMaterial(opts = {}) {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? true,
  });
  if (opts.emissive) mat.emissive = new THREE.Color(opts.emissive);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <color_vertex>', patchColorVertex())
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_BODY);
  };
  mat.customProgramCacheKey = () => 'world-v2';
  return mat;
}

export function createZoneMaterial() {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export function createPreviewMaterial() {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

export function createGhostMaterial() {
  const m = createWorldMaterial({ transparent: true, opacity: 0.72, emissive: 0x000000 });
  return m;
}

export function createWaterMaterial(depthTex, ext, maskTex) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: uniforms.uTime,
      uNight: uniforms.uNight,
      uDepth: { value: depthTex },
      uMask: { value: maskTex },
      uMaskExt: { value: new THREE.Vector4(-ext.P, -ext.P, ext.ES, ext.ES) },
      uExt: { value: new THREE.Vector4(-ext.P, -ext.P, ext.CS - 1, ext.CS - 1) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uSkyCol: { value: new THREE.Color(0.5, 0.7, 0.9) },
      uDeep: { value: new THREE.Color(0x0e4a6e) },
      uShallow: { value: new THREE.Color(0x3fb2c6) },
      uFogColor: { value: new THREE.Color(0xcfe3f2) },
      uFogNear: { value: 100 },
      uFogFar: { value: 400 },
      uDay: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uNight;
      uniform float uDay;
      uniform sampler2D uDepth;
      uniform sampler2D uMask;
      uniform vec4 uExt;
      uniform vec4 uMaskExt;
      uniform vec3 uSunDir;
      uniform vec3 uSunCol;
      uniform vec3 uSkyCol;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec3 vW;
      void main() {
        vec2 uv = (vW.xz - uExt.xy) / uExt.zw;
        float mask = texture2D(uMask, (vW.xz - uMaskExt.xy) / uMaskExt.zw).r;
        if (mask < 0.44) discard;
        float depth = texture2D(uDepth, uv).r;
        vec2 p = vW.xz;
        float t = uTime;
        vec3 n = normalize(vec3(
          sin(p.x * 2.3 + t * 1.3) * 0.05 + sin(p.y * 3.1 - t * 1.7 + p.x * 1.3) * 0.035 + sin(p.x * 7.0 + p.y * 5.0 + t * 2.6) * 0.015,
          1.0,
          cos(p.y * 2.2 + t * 1.1) * 0.05 + cos(p.x * 3.7 + t * 1.9 - p.y) * 0.035 + cos(p.y * 6.3 - p.x * 4.1 + t * 2.2) * 0.015));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.02, 0.55, depth));
        col *= mix(0.25, 1.0, uDay);
        col = mix(col, uSkyCol, clamp(fres * 0.65, 0.0, 0.65));
        vec3 H = normalize(normalize(uSunDir) + V);
        float spec = pow(max(dot(n, H), 0.0), 140.0);
        col += uSunCol * spec * 1.6;
        float edge = smoothstep(0.62, 0.46, mask);
        float foam = max(smoothstep(0.08, 0.0, depth) * 0.6, edge) * (0.55 + 0.45 * sin(t * 2.0 + p.x * 6.0 + p.y * 4.0));
        col = mix(col, vec3(0.85, 0.92, 0.95) * mix(0.3, 1.0, uDay), foam * 0.45);
        float alpha = mix(0.6, 0.93, smoothstep(0.0, 0.3, depth)) * smoothstep(0.44, 0.5, mask);
        float fd = length(cameraPosition - vW);
        col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, fd));
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
