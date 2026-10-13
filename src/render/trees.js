// Bäume als InstancedMesh: Wälder auf der Karte (veränderlich) und im Umland (statisch).
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from './builder.js';
import { mulberry32, pick } from '../util.js';
import { LEAF, LEAF2, CONIFER } from './buildingGeo.js';

function treeGeometry(kind) {
  const B = new MeshBuilder();
  const trunk = [0.16, 0.08, 0.03];
  const a = [1, 1, 1], b = [0.82, 0.86, 0.8];
  if (kind === 0) {
    B.box(-0.02, 0, -0.02, 0.02, 0.13, 0.02, trunk, 0, null);
    B.ico(0, 0.25, 0, 0.15, 0.14, a, b);
  } else {
    B.box(-0.017, 0, -0.017, 0.017, 0.08, 0.017, trunk, 0, null);
    B.cone(0, 0, 0.13, 0.06, 0.33, 6, a);
    B.cone(0, 0, 0.095, 0.22, 0.48, 6, b);
  }
  // Stamm nicht einfärben
  for (let i = 0; i < B.win.length; i++) {
    if (B.col[i * 3] < 0.5 && B.col[i * 3 + 1] < 0.3) B.win[i] = 5;
  }
  return B.toGeometry();
}

export class TreeLayer {
  constructor(scene, mats) {
    this.scene = scene;
    this.mats = mats;
    this.geos = [treeGeometry(0), treeGeometry(1)];
    this.meshes = [null, null];
    this.caps = [0, 0];
    this.version = -1;
    this.outMeshes = null;
  }

  ensure(kind, n) {
    if (this.meshes[kind] && this.caps[kind] >= n) return this.meshes[kind];
    if (this.meshes[kind]) { this.scene.remove(this.meshes[kind]); this.meshes[kind].dispose(); }
    const cap = Math.max(1024, Math.ceil(n * 1.3));
    const m = this.makeMesh(kind, cap, true);
    this.meshes[kind] = m;
    this.caps[kind] = cap;
    return m;
  }

  makeMesh(kind, cap, shadow) {
    const m = new THREE.InstancedMesh(this.geos[kind], this.mats.world, cap);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.count = 0;
    this.scene.add(m);
    return m;
  }

  fill(m, arr) {
    const ma = m.instanceMatrix.array, ca = m.instanceColor.array;
    for (let j = 0; j < arr.length; j++) {
      const o = arr[j];
      const c = Math.cos(o.rot) * o.s, s = Math.sin(o.rot) * o.s;
      const k = j * 16;
      ma[k] = c; ma[k + 1] = 0; ma[k + 2] = -s; ma[k + 3] = 0;
      ma[k + 4] = 0; ma[k + 5] = o.s * o.sy; ma[k + 6] = 0; ma[k + 7] = 0;
      ma[k + 8] = s; ma[k + 9] = 0; ma[k + 10] = c; ma[k + 11] = 0;
      ma[k + 12] = o.x; ma[k + 13] = o.y; ma[k + 14] = o.z; ma[k + 15] = 1;
      ca[j * 3] = o.col[0]; ca[j * 3 + 1] = o.col[1]; ca[j * 3 + 2] = o.col[2];
    }
    m.count = arr.length;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }

  setWorld(world) {
    this.world = world;
    this.version = -1;
    // Umlandbäume einmalig vorberechnen
    const t = world.ext.outTrees;
    const rng = mulberry32(world.seed + 5);
    const out = [[], []];
    for (let i = 0; i < t.length; i += 5) {
      const conifer = t[i + 4] < 0.38;
      const col = conifer ? pick(rng, CONIFER) : pick(rng, rng() < 0.5 ? LEAF : LEAF2);
      out[conifer ? 1 : 0].push({ x: t[i], y: t[i + 1], z: t[i + 2], s: t[i + 3], sy: 0.85 + rng() * 0.3, rot: rng() * 6.28, col });
    }
    if (this.outMeshes) for (const m of this.outMeshes) { this.scene.remove(m); m.dispose(); }
    this.outMeshes = [0, 1].map((k) => {
      const m = this.makeMesh(k, Math.max(1, out[k].length), false);
      this.fill(m, out[k]);
      return m;
    });
  }

  update() {
    const w = this.world;
    if (!w || w.treesVersion === this.version) return;
    this.version = w.treesVersion;
    const list = [[], []];
    const S = w.size;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const cnt = w.trees[i];
        if (!cnt || w.road[i] || w.bld[i] >= 0) continue;
        for (let k = 0; k < cnt; k++) {
          const r = mulberry32((x * 73856093) ^ (y * 19349663) ^ (k * 83492791) ^ w.seed);
          const tx = x + 0.18 + r() * 0.64, tz = y + 0.18 + r() * 0.64;
          const s = 0.75 + r() * 0.6;
          const conifer = r() < 0.38;
          const col = conifer ? pick(r, CONIFER) : pick(r, r() < 0.5 ? LEAF : LEAF2);
          list[conifer ? 1 : 0].push({ x: tx, y: 0, z: tz, s: conifer ? s * 1.1 : s, sy: 0.9 + r() * 0.25, rot: r() * 6.28, col });
        }
      }
    }
    for (let kind = 0; kind < 2; kind++) this.fill(this.ensure(kind, list[kind].length), list[kind]);
  }
}
