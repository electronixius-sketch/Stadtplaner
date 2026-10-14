// Chunk-Verwaltung: Straßensegmente, Kreuzungen und Gebäude werden pro 16x16-Chunk zu einem Mesh
// zusammengefasst und nur bei Änderungen neu erzeugt. Zonenzellen liegen als transparente Overlays darüber.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from './builder.js';
import { addBuilding } from './buildingGeo.js';
import { addSegment, addNode, nodeKey, segKey } from './roadGeo.js';
import { ZONES } from '../config.js';
import { rectAxes } from '../geom.js';
import { rgb, mixc } from '../util.js';

const ZONE_COL = {};
for (const z of Object.values(ZONES)) {
  const c = rgb(z.color);
  ZONE_COL[z.id] = { fill: mixc(c, [1, 1, 1], 0.15), border: c };
}

// Viereck nach oben (Reihenfolge der Ecken beliebig herum)
function zquad(pos, col, a, b, c, d, y, rgbc, alpha) {
  const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  const q = cr >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
  for (const p of q) {
    pos.push(p[0], y, p[1]);
    col.push(rgbc[0], rgbc[1], rgbc[2], alpha);
  }
}

// Punkt im gedrehten Rahmen einer Zelle: u entlang der Straße, v in die Tiefe (jeweils -0.5..0.5)
function cellPt(c, ax, u, v) {
  return [c.cx + ax.lx * u * c.w + ax.dx * v * c.d, c.cz + ax.lz * u * c.w + ax.dz * v * c.d];
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
    this.segCache = new Map();
    this.nodeCache = new Map();
    this.cellChunks = null;
    this.cellsVer = -1;
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

  // Geometrieblöcke werden pro Gebäude, Segment und Knoten zwischengespeichert und nur bei
  // Formänderungen neu erzeugt. Ein Chunk-Neuaufbau kopiert dann nur noch Arrays.
  blockFrom(B) {
    return {
      n: B.count, pos: new Float32Array(B.pos), nor: new Float32Array(B.nor), col: new Float32Array(B.col),
      win: new Float32Array(B.win), emitters: B.emitters, rotors: B.rotors,
    };
  }

  buildingBlock(b) {
    const stage = b.built < 1 ? Math.floor(b.built * 3) : 3;
    const winOff = b.abandoned || !b.power || (b.kind === 'zone' && b.occ === 0 && b.built >= 1);
    const key = `${b.level}|${stage}|${b.abandoned ? 1 : 0}|${winOff ? 1 : 0}|${b.cx},${b.cz},${b.rot},${b.w},${b.d}`;
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

  segBlock(seg) {
    const w = this.world, net = w.net;
    const key = segKey(net, seg);
    const c = this.segCache.get(seg.id);
    if (c && c.key === key) return c;
    const B = new MeshBuilder();
    addSegment(B, net, seg, net.junction(net.nodes.get(seg.a)), net.junction(net.nodes.get(seg.b)), (x, z) => w.terrainAt(x, z));
    const blk = this.blockFrom(B);
    blk.key = key;
    this.segCache.set(seg.id, blk);
    return blk;
  }

  nodeBlock(node) {
    const w = this.world, net = w.net;
    const key = nodeKey(node);
    const c = this.nodeCache.get(node.id);
    if (c && c.key === key) return c;
    const B = new MeshBuilder();
    addNode(B, node, net.junction(node), (x, z) => w.terrainAt(x, z));
    const blk = this.blockFrom(B);
    blk.key = key;
    this.nodeCache.set(node.id, blk);
    return blk;
  }

  rebuild(c) {
    const w = this.world, net = w.net;
    const blocks = [];
    for (const id of w.chunkSegs[c]) {
      const s = net.segs.get(id);
      if (s) blocks.push(this.segBlock(s));
    }
    for (const id of w.chunkNodes[c]) {
      const n = net.nodes.get(id);
      if (n && n.segs.length) blocks.push(this.nodeBlock(n));
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
    // Caches gelegentlich von gelöschten Segmenten/Knoten befreien
    if (this.segCache.size > net.segs.size * 2 + 64) for (const id of this.segCache.keys()) if (!net.segs.has(id)) this.segCache.delete(id);
    if (this.nodeCache.size > net.nodes.size * 2 + 64) for (const id of this.nodeCache.keys()) if (!net.nodes.has(id)) this.nodeCache.delete(id);
  }

  cellsOfChunk(c) {
    const w = this.world;
    if (this.cellsVer !== w.cellsVersion || !this.cellChunks) {
      this.cellsVer = w.cellsVersion;
      this.cellChunks = Array.from({ length: this.chunks.length }, () => []);
      for (const cell of w.cells) this.cellChunks[w.chunkOf(cell.cx, cell.cz)].push(cell);
    }
    return this.cellChunks[c];
  }

  rebuildZones(c) {
    const pos = [], col = [];
    const zy = 0.03;
    for (const cell of this.cellsOfChunk(c)) {
      if (cell.bld >= 0) continue;
      const ax = rectAxes(cell);
      const P = (u, v) => cellPt(cell, ax, u, v);
      if (cell.zone) {
        const zc = ZONE_COL[cell.zone];
        const a = 0.44, b = 0.37;
        zquad(pos, col, P(-b, -b), P(b, -b), P(b, b), P(-b, b), zy, zc.fill, 0.34);
        zquad(pos, col, P(-a, -a), P(a, -a), P(a, -b), P(-a, -b), zy, zc.border, 0.85);
        zquad(pos, col, P(-a, b), P(a, b), P(a, a), P(-a, a), zy, zc.border, 0.85);
        zquad(pos, col, P(-a, -b), P(-b, -b), P(-b, b), P(-a, b), zy, zc.border, 0.85);
        zquad(pos, col, P(b, -b), P(a, -b), P(a, b), P(b, b), zy, zc.border, 0.85);
      } else if (this.showGrid) {
        const a = 0.45, b = 0.41;
        const wc = [1, 1, 1];
        zquad(pos, col, P(-a, -a), P(a, -a), P(a, -b), P(-a, -b), zy, wc, 0.5);
        zquad(pos, col, P(-a, b), P(a, b), P(a, a), P(-a, a), zy, wc, 0.5);
        zquad(pos, col, P(-a, -b), P(-b, -b), P(-b, b), P(-a, b), zy, wc, 0.5);
        zquad(pos, col, P(b, -b), P(a, -b), P(a, b), P(b, b), zy, wc, 0.5);
        zquad(pos, col, P(-b, -b), P(b, -b), P(b, b), P(-b, b), zy, wc, 0.1);
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
