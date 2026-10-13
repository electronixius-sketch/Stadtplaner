// Chunk-Verwaltung: Straßen, Bäume und Gebäude werden pro 16x16-Chunk zu einem Mesh zusammengefasst
// und nur bei Änderungen neu erzeugt. Zonenfelder liegen als transparente Overlay-Meshes darüber.
import * as THREE from 'three';
import { MeshBuilder } from './builder.js';
import { addBuilding } from './buildingGeo.js';
import { addRoadTile } from './roadGeo.js';
import { CHUNK_SIZE, ZONES, T_WATER } from '../config.js';
import { rgb, mixc } from '../util.js';

const ZONE_COL = {};
for (const z of Object.values(ZONES)) {
  const c = rgb(z.color);
  ZONE_COL[z.id] = { fill: mixc(c, [1, 1, 1], 0.15), border: c };
}

function zquad(pos, col, x0, z0, x1, z1, y, c, a) {
  pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
  for (let k = 0; k < 6; k++) col.push(c[0], c[1], c[2], a);
}

export class ChunkManager {
  constructor(scene, world, mats) {
    this.scene = scene;
    this.mats = mats;
    this.chunks = [];
    this.showGrid = false;
    this.version = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.setWorld(world);
  }

  setWorld(world) {
    for (const ch of this.chunks) {
      ch.mesh.geometry.dispose();
      ch.zmesh.geometry.dispose();
      this.group.remove(ch.mesh, ch.zmesh);
    }
    this.world = world;
    this.chunks = [];
    this.roadCache = new Map();
    const N = world.chunkN;
    for (let c = 0; c < N * N; c++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mats.world);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      const zmesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mats.zone);
      zmesh.renderOrder = 2;
      zmesh.matrixAutoUpdate = false;
      this.group.add(mesh, zmesh);
      this.chunks.push({ mesh, zmesh, emitters: [], rotors: [] });
    }
    world.markAllDirty();
  }

  setGrid(on) {
    if (this.showGrid === on) return;
    this.showGrid = on;
    for (let c = 0; c < this.chunks.length; c++) this.world.zoneDirty.add(c);
  }

  update(budgetMs = 10) {
    const w = this.world;
    const t0 = performance.now();
    for (const c of w.dirty) {
      w.dirty.delete(c);
      this.rebuild(c);
      if (performance.now() - t0 > budgetMs) break;
    }
    for (const c of w.zoneDirty) {
      w.zoneDirty.delete(c);
      this.rebuildZones(c);
      if (performance.now() - t0 > budgetMs * 1.5) break;
    }
  }

  rebuildAll() {
    const w = this.world;
    for (let c = 0; c < this.chunks.length; c++) { this.rebuild(c); this.rebuildZones(c); }
    w.dirty.clear();
    w.zoneDirty.clear();
  }

  // Geometrieblöcke werden pro Gebäude bzw. Straßenfeld zwischengespeichert und nur bei
  // Zustandsänderungen neu erzeugt. Ein Chunk-Neuaufbau kopiert dann nur noch Arrays.
  blockFrom(B) {
    return {
      n: B.count, pos: new Float32Array(B.pos), nor: new Float32Array(B.nor), col: new Float32Array(B.col),
      win: new Float32Array(B.win), emitters: B.emitters, rotors: B.rotors,
    };
  }

  buildingBlock(b) {
    const stage = b.built < 1 ? Math.floor(b.built * 3) : 3;
    const winOff = b.abandoned || !b.power || (b.kind === 'zone' && b.occ === 0 && b.built >= 1);
    const key = `${b.level}|${stage}|${b.abandoned ? 1 : 0}|${winOff ? 1 : 0}|${b.x},${b.y},${b.dir}`;
    if (b._geo && b._geo.key === key) return b._geo;
    const B = new MeshBuilder();
    const h = addBuilding(B, b);
    const blk = this.blockFrom(B);
    blk.key = key;
    blk.hgt = h;
    b._geo = blk;
    b.hgt = h;
    return blk;
  }

  roadBlock(i, x, y) {
    const w = this.world;
    const type = w.road[i], mask = w.roadMask(x, y), water = w.terrain[i] === T_WATER;
    const key = type * 64 + mask * 2 + (water ? 1 : 0);
    const c = this.roadCache.get(i);
    if (c && c.key === key) return c;
    const B = new MeshBuilder();
    addRoadTile(B, x, y, type, mask, water);
    const blk = this.blockFrom(B);
    blk.key = key;
    this.roadCache.set(i, blk);
    return blk;
  }

  rebuild(c) {
    const w = this.world, S = w.size, N = w.chunkN;
    const cx = c % N, cy = (c / N) | 0;
    const blocks = [];
    for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y++) {
      for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) {
        const i = y * S + x;
        if (w.road[i]) blocks.push(this.roadBlock(i, x, y));
        else if (this.roadCache.has(i)) this.roadCache.delete(i);
      }
    }
    for (const id of w.chunkBld[c]) {
      const b = w.buildings.get(id);
      if (b) blocks.push(this.buildingBlock(b));
    }
    let n = 0;
    for (const bl of blocks) n += bl.n;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), win = new Float32Array(n);
    const emitters = [], rotors = [];
    let o = 0;
    for (const bl of blocks) {
      pos.set(bl.pos, o * 3); nor.set(bl.nor, o * 3); col.set(bl.col, o * 3); win.set(bl.win, o);
      o += bl.n;
      for (const e of bl.emitters) emitters.push(e);
      for (const r of bl.rotors) rotors.push(r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aWin', new THREE.BufferAttribute(win, 1));
    g.computeBoundingSphere();
    const ch = this.chunks[c];
    ch.mesh.geometry.dispose();
    ch.mesh.geometry = g;
    ch.emitters = emitters;
    ch.rotors = rotors;
    this.version++;
  }

  rebuildZones(c) {
    const w = this.world, S = w.size, N = w.chunkN;
    const cx = c % N, cy = (c / N) | 0;
    const pos = [], col = [];
    const zy = 0.03;
    for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y++) {
      for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) {
        const i = y * S + x;
        if (w.road[i] || w.bld[i] >= 0) continue;
        const z = w.zone[i];
        if (z) {
          const zc = ZONE_COL[z];
          const a = 0.07, b = 0.13;
          zquad(pos, col, x + b, y + b, x + 1 - b, y + 1 - b, zy, zc.fill, 0.34);
          zquad(pos, col, x + a, y + a, x + 1 - a, y + b, zy, zc.border, 0.85);
          zquad(pos, col, x + a, y + 1 - b, x + 1 - a, y + 1 - a, zy, zc.border, 0.85);
          zquad(pos, col, x + a, y + b, x + b, y + 1 - b, zy, zc.border, 0.85);
          zquad(pos, col, x + 1 - b, y + b, x + 1 - a, y + 1 - b, zy, zc.border, 0.85);
        } else if (this.showGrid && w.zoneable[i]) {
          zquad(pos, col, x + 0.07, y + 0.07, x + 0.93, y + 0.93, zy, [1, 1, 1], 0.2);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.computeBoundingSphere();
    const ch = this.chunks[c];
    ch.zmesh.geometry.dispose();
    ch.zmesh.geometry = g;
  }

  *emitters() {
    for (const ch of this.chunks) for (const e of ch.emitters) yield e;
  }
}
