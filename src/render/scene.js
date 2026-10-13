// Renderer, Kamera, Licht, Himmel, Sterne und Tag/Nacht-Zyklus.
import * as THREE from '../../vendor/three.module.min.js';
import { uniforms } from './materials.js';
import { clamp, smoothstep, lerp } from '../util.js';

// Farbverlauf über den Tag: [Stunde, Himmel oben, Horizont, Sonnenfarbe, Sonnenintensität, Umgebung]
const KEYS = [
  [0, 0x070b1c, 0x141c36, 0x8fa6ff, 0.35, 0.32],
  [4.5, 0x0a1026, 0x23294a, 0x8fa6ff, 0.3, 0.32],
  [5.6, 0x1f2a55, 0x7a5c7c, 0xff9d6b, 0.35, 0.42],
  [6.6, 0x3e6aa8, 0xf2a46e, 0xffb27a, 1.4, 0.7],
  [8.5, 0x3d7fcf, 0xbcdff3, 0xfff0d8, 2.7, 0.95],
  [12.5, 0x3a7fd6, 0xcde6f6, 0xffffff, 3.1, 1.0],
  [16.5, 0x467cc4, 0xe3dcc6, 0xffe7c2, 2.7, 0.95],
  [18.4, 0x3b4f88, 0xf39a62, 0xff9a5a, 1.4, 0.7],
  [19.4, 0x1a2350, 0x7c4b6a, 0xff7d4d, 0.4, 0.45],
  [20.5, 0x0a1026, 0x1c2242, 0x8fa6ff, 0.3, 0.34],
  [24, 0x070b1c, 0x141c36, 0x8fa6ff, 0.35, 0.32],
];

const tmpA = new THREE.Color(), tmpB = new THREE.Color();
function lerpHex(a, b, t, out) {
  tmpA.setHex(a); tmpB.setHex(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

export class SceneRenderer {
  constructor(canvas, settings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe3f2, 120, 420);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.3, 1200);
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6b7a4a, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.skyTop = new THREE.Color();
    this.skyHorizon = new THREE.Color();
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
    this.createSky();
    this.resize();
  }

  createSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uSunCol: { value: new THREE.Color() },
        uNight: uniforms.uNight,
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uNight;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.55));
          if (h < 0.0) col = mix(uHorizon, uHorizon * 0.7, clamp(-h * 5.0, 0.0, 1.0));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25) * (1.0 - uNight * 0.6);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // Sterne
    const n = 900;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.08;
      const r = 850;
      p[i * 3] = Math.cos(u) * Math.sqrt(1 - v * v) * r;
      p[i * 3 + 1] = v * r;
      p[i * 3 + 2] = Math.sin(u) * Math.sqrt(1 - v * v) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  setPixelRatio(q) {
    const dpr = window.devicePixelRatio || 1;
    const max = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(dpr, max));
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // hours: 0..24
  setTime(hours, water) {
    let k = 0;
    while (k < KEYS.length - 2 && KEYS[k + 1][0] <= hours) k++;
    const a = KEYS[k], b = KEYS[k + 1];
    const t = clamp((hours - a[0]) / (b[0] - a[0]), 0, 1);
    lerpHex(a[1], b[1], t, this.skyTop);
    lerpHex(a[2], b[2], t, this.skyHorizon);
    const sunCol = lerpHex(a[3], b[3], t, new THREE.Color());
    const sunI = lerp(a[4], b[4], t);
    const amb = lerp(a[5], b[5], t);
    const night = hours < 12 ? 1 - smoothstep(5.2, 7.0, hours) : smoothstep(18.3, 20.2, hours);
    uniforms.uNight.value = night;

    // Sonne (tagsüber) bzw. Mond (nachts)
    const day = hours >= 6 && hours <= 18.6;
    const ang = day ? ((hours - 6) / 12.6) * Math.PI : (((hours + 24 - 18.6) % 24) / 11.4) * Math.PI;
    const elev = Math.max(0.12, Math.sin(ang)) * (day ? 1 : 0.75);
    const az = ang * 0.9 + 0.6;
    this.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) * 0.7 + 0.3).normalize();

    this.sun.color.copy(sunCol);
    this.sun.intensity = sunI;
    this.hemi.intensity = amb * 1.1;
    this.hemi.color.copy(this.skyTop).lerp(new THREE.Color(0xffffff), 0.45);
    this.hemi.groundColor.setHex(0x5d6b45).multiplyScalar(0.4 + amb * 0.6);

    this.skyMat.uniforms.uTop.value.copy(this.skyTop);
    this.skyMat.uniforms.uHorizon.value.copy(this.skyHorizon);
    this.skyMat.uniforms.uSunDir.value.copy(this.sunDir);
    this.skyMat.uniforms.uSunCol.value.copy(sunCol);
    this.starMat.opacity = night * 0.9;
    this.scene.fog.color.copy(this.skyHorizon).lerp(this.skyTop, 0.25);
    this.renderer.toneMappingExposure = 1.05 + night * 0.25;

    if (water) {
      const u = water.uniforms;
      u.uSunDir.value.copy(this.sunDir);
      u.uSunCol.value.copy(sunCol).multiplyScalar(day ? 1 : 0.4);
      u.uSkyCol.value.copy(this.skyHorizon).lerp(this.skyTop, 0.4);
      u.uFogColor.value.copy(this.scene.fog.color);
      u.uFogNear.value = this.scene.fog.near;
      u.uFogFar.value = this.scene.fog.far;
      u.uDay.value = clamp(amb * 1.1, 0.2, 1);
    }
  }

  updateFrame(target, dist) {
    // Schattenkamera folgt dem Blickpunkt
    const size = clamp(dist * 0.85, 14, 70);
    const cam = this.sun.shadow.camera;
    if (cam.right !== size) {
      cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size;
      cam.near = 1; cam.far = 260;
      cam.updateProjectionMatrix();
    }
    // Auf Texelraster einrasten, damit Schatten beim Bewegen nicht flimmern
    const texel = (size * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.sunDir.x * 120, this.sunDir.y * 120, tz + this.sunDir.z * 120);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    this.scene.fog.near = 60 + dist * 1.2;
    this.scene.fog.far = 260 + dist * 3;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
