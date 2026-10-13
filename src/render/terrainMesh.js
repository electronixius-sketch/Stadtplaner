// Geländemesh (inkl. Umland), Wasseroberfläche, Autobahn außerhalb der Karte und Umlandwälder.
import * as THREE from '../../vendor/three.module.min.js';
import { makeNoise } from '../noise.js';
import { rgb, mixc, scalec, clamp, smoothstep } from '../util.js';
import { T_WATER, T_ROCK, WATER_LEVEL } from '../config.js';
import { MeshBuilder } from './builder.js';
import { addRoadTile } from './roadGeo.js';
import { createWaterMaterial } from './materials.js';

const G1 = rgb(0x84b05e), G2 = rgb(0x6f9c4c), G3 = rgb(0x93b86b), MEADOW = rgb(0xa8bf72);
const SAND = rgb(0xd8c690), MUD = rgb(0x8c7a55), ROCK = rgb(0x8a8378), ROCK2 = rgb(0x6f6a62), SNOW = rgb(0xf4f6f8);

export function createTerrain(world, mats) {
  const { P, ES, CS, types, ch } = world.ext;
  const S = world.size;
  const nz = makeNoise(world.seed + 99);
  const nV = CS * CS;
  const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 3), win = new Float32Array(nV);
  const typeAt = (tx, ty) => {
    tx = Math.min(ES - 1, Math.max(0, tx)); ty = Math.min(ES - 1, Math.max(0, ty));
    return types[ty * ES + tx];
  };
  for (let cy = 0; cy < CS; cy++) {
    for (let cx = 0; cx < CS; cx++) {
      const v = cy * CS + cx;
      const h = ch[v];
      const wx = cx - P, wz = cy - P;
      pos[v * 3] = wx; pos[v * 3 + 1] = h; pos[v * 3 + 2] = wz;
      const n1 = nz.fbm(wx * 0.05, wz * 0.05, 3) * 0.5 + 0.5;
      const n2 = nz.noise(wx * 0.31, wz * 0.31) * 0.5 + 0.5;
      let c = mixc(mixc(G2, G1, n1), G3, n2 * 0.35);
      if (n1 > 0.62) c = mixc(c, MEADOW, (n1 - 0.62) * 1.5);
      let water = false, rock = false;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const t = typeAt(cx + dx, cy + dy);
        if (t === T_WATER) water = true;
        if (t === T_ROCK) rock = true;
      }
      if (h < -0.02) c = mixc(SAND, MUD, clamp(-h / 0.9, 0, 1));
      else if (water) c = mixc(c, SAND, 0.75);
      else if (h > 0.02 || rock) {
        const r = mixc(ROCK, ROCK2, n2);
        c = mixc(c, r, smoothstep(0.4, 2.2, h));
        if (h > 6.5) c = mixc(c, SNOW, smoothstep(6.5, 8, h + n2));
      }
      const inside = wx >= 0 && wz >= 0 && wx <= S && wz <= S;
      if (!inside) {
        const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
        c = scalec(mixc(c, [l, l, l], 0.25), 0.9);
      }
      col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
    }
  }
  const idx = new Uint32Array((CS - 1) * (CS - 1) * 6);
  let k = 0;
  for (let cy = 0; cy < CS - 1; cy++) {
    for (let cx = 0; cx < CS - 1; cx++) {
      const a = cy * CS + cx, b = a + 1, c = a + CS, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aWin', new THREE.BufferAttribute(win, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, mats.world);
  terrain.receiveShadow = true;
  terrain.matrixAutoUpdate = false;

  // Wassertiefe als Textur
  const depth = new Uint8Array(nV * 4);
  for (let v = 0; v < nV; v++) {
    const d = clamp((WATER_LEVEL - ch[v]) / 0.9, 0, 1);
    depth[v * 4] = Math.round(d * 255);
    depth[v * 4 + 3] = 255;
  }
  const depthTex = new THREE.DataTexture(depth, CS, CS, THREE.RGBAFormat);
  depthTex.magFilter = THREE.LinearFilter;
  depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;
  const wmat = createWaterMaterial(depthTex, world.ext);
  const wgeo = new THREE.PlaneGeometry(CS - 1, CS - 1, 1, 1);
  wgeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wgeo, wmat);
  water.position.set(-P + (CS - 1) / 2, WATER_LEVEL, -P + (CS - 1) / 2);
  water.renderOrder = 1;
  water.updateMatrix();
  water.matrixAutoUpdate = false;

  // Autobahn ins Umland
  const B = new MeshBuilder();
  const hy = world.ext.hwY;
  for (let x = -P; x < 0; x++) addRoadTile(B, x, hy, 3, 10, false);
  const outRoad = new THREE.Mesh(B.toGeometry(), mats.world);
  outRoad.receiveShadow = true;
  outRoad.matrixAutoUpdate = false;

  const group = new THREE.Group();
  group.add(terrain, water, outRoad);
  return { group, terrain, water, waterMat: wmat, dispose() {
    geo.dispose(); wgeo.dispose(); wmat.dispose(); depthTex.dispose(); outRoad.geometry.dispose();
  } };
}
