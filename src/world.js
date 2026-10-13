// Weltmodell: Felder, Straßen, Zonen, Gebäude, Netzwerk-Analyse und Rückgängig-Aufzeichnung.
import {
  MAP_SIZE, CHUNK_SIZE, ZONE_DEPTH, DIRS, T_LAND, T_WATER, T_ROCK, ROAD_TYPES, SERVICES,
} from './config.js';
import { generateMap } from './mapgen.js';

export function makeBuilding(props) {
  return Object.assign({
    id: 0, kind: 'zone', zone: 0, def: null,
    x: 0, y: 0, W: 1, H: 1, dir: 0, lw: 1, ld: 1,
    level: 1, seed: 1, cap: 0, occ: 0, built: 1,
    power: true, water: true, sewage: true, garbage: true,
    comp: -1, access: -1, connected: false,
    happy: 60, unhappyDays: 0, abandoned: false, abandonedDays: 0,
    fire: 0, fireCovered: false, edu: 0, name: '', hgt: 0.5, age: 0,
  }, props);
}

// Lokale Grundstücksmaße (Frontbreite, Tiefe) aus Weltgröße und Ausrichtung
export function lotDims(W, H, dir) {
  return dir === 0 || dir === 2 ? { lw: W, ld: H } : { lw: H, ld: W };
}

export function serviceFootprint(def, dir) {
  return dir === 0 || dir === 2 ? { W: def.w, H: def.h } : { W: def.h, H: def.w };
}

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    const S = (this.size = MAP_SIZE);
    const n = (this.n = S * S);
    this.terrain = new Uint8Array(n);
    this.road = new Uint8Array(n);
    this.zone = new Uint8Array(n);
    this.trees = new Uint8Array(n);
    this.bld = new Int32Array(n).fill(-1);
    this.comp = new Int32Array(n).fill(-1);
    this.zoneable = new Uint8Array(n);
    this.waterDist = new Uint8Array(n);
    this.compOutside = [];
    this.compCount = 0;
    this.roadCount = { 1: 0, 2: 0, 3: 0, bridge: 0 };
    this.buildings = new Map();
    this.nextId = 1;
    this.outside = [];
    this.chunkN = S / CHUNK_SIZE;
    this.chunkBld = Array.from({ length: this.chunkN * this.chunkN }, () => new Set());
    this.dirty = new Set();
    this.zoneDirty = new Set();
    this.networkDirty = true;
    this.servicesDirty = true;
    this.networkVersion = 0;
    this.version = 0;
    this.rec = null;
    this.unique = {};
    generateMap(this, this.seed);
    this.updateNetwork();
  }

  idx(x, y) { return y * this.size + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  chunkOf(x, y) { return ((y / CHUNK_SIZE) | 0) * this.chunkN + ((x / CHUNK_SIZE) | 0); }

  markDirty(x, y) { if (this.inb(x, y)) this.dirty.add(this.chunkOf(x, y)); }
  markZoneDirty(x, y) { if (this.inb(x, y)) this.zoneDirty.add(this.chunkOf(x, y)); }
  markAllDirty() {
    for (let c = 0; c < this.chunkN * this.chunkN; c++) { this.dirty.add(c); this.zoneDirty.add(c); }
  }

  isOutsideTile(x, y) {
    return this.outside.some((o) => o.x === x && o.y === y);
  }

  getBuilding(x, y) {
    if (!this.inb(x, y)) return null;
    const id = this.bld[this.idx(x, y)];
    return id >= 0 ? this.buildings.get(id) || null : null;
  }

  // Bitmaske verbundener Nachbarn: N=1, O=2, S=4, W=8
  roadMask(x, y) {
    let m = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
      if (this.inb(nx, ny)) {
        if (this.road[this.idx(nx, ny)]) m |= 1 << d;
      } else if (this.outside.some((o) => o.x === x && o.y === y && o.dir === d)) {
        m |= 1 << d;
      }
    }
    return m;
  }

  // ---------- Rückgängig ----------
  beginAction() {
    this.rec = { tiles: new Map(), added: [], removed: [], cost: 0 };
  }
  endAction() {
    const r = this.rec;
    this.rec = null;
    if (!r || (r.tiles.size === 0 && r.added.length === 0 && r.removed.length === 0)) return null;
    return r;
  }
  _touch(i) {
    if (this.rec && !this.rec.tiles.has(i)) this.rec.tiles.set(i, [this.road[i], this.zone[i], this.trees[i]]);
  }
  undo(rec) {
    this.rec = null;
    for (const id of rec.added) if (this.buildings.has(id)) this.removeBuilding(id);
    for (const [i, v] of rec.tiles) {
      if (this.bld[i] >= 0) this.removeBuilding(this.bld[i]);
      this.road[i] = v[0];
      this.zone[i] = v[1];
      this.trees[i] = v[2];
      const x = i % this.size, y = (i / this.size) | 0;
      this.markDirty(x, y);
      for (const d of DIRS) this.markDirty(x + d.dx, y + d.dy);
      this.markZoneDirty(x, y);
    }
    for (let k = rec.removed.length - 1; k >= 0; k--) {
      const b = rec.removed[k];
      if (this.footprintFree(b.x, b.y, b.W, b.H)) this.addBuilding(Object.assign({}, b));
    }
    this.networkDirty = true;
    this.servicesDirty = true;
    this.updateNetwork();
  }

  footprintFree(x0, y0, W, H) {
    for (let y = y0; y < y0 + H; y++) {
      for (let x = x0; x < x0 + W; x++) {
        if (!this.inb(x, y)) return false;
        const i = this.idx(x, y);
        if (this.bld[i] >= 0 || this.road[i]) return false;
      }
    }
    return true;
  }

  // ---------- Straßen ----------
  canRoad(x, y) {
    if (!this.inb(x, y)) return false;
    const i = this.idx(x, y);
    if (this.terrain[i] === T_ROCK) return false;
    const id = this.bld[i];
    if (id >= 0 && this.buildings.get(id).kind === 'service') return false;
    return true;
  }

  setRoad(x, y, type) {
    const i = this.idx(x, y);
    this._touch(i);
    if (this.bld[i] >= 0) this.removeBuilding(this.bld[i]);
    this.road[i] = type;
    this.zone[i] = 0;
    this.trees[i] = 0;
    this.markDirty(x, y);
    for (const d of DIRS) this.markDirty(x + d.dx, y + d.dy);
    this.markZoneDirty(x, y);
    this.networkDirty = true;
    this.version++;
  }

  removeRoad(x, y) {
    const i = this.idx(x, y);
    if (!this.road[i]) return;
    this._touch(i);
    this.road[i] = 0;
    this.markDirty(x, y);
    for (const d of DIRS) this.markDirty(x + d.dx, y + d.dy);
    this.networkDirty = true;
    this.version++;
  }

  // ---------- Zonen ----------
  canZone(i) {
    if (!this.zoneable[i] || this.terrain[i] !== T_LAND || this.road[i]) return false;
    const id = this.bld[i];
    return id < 0 || this.buildings.get(id).kind === 'zone';
  }

  setZone(x, y, z) {
    const i = this.idx(x, y);
    if (this.zone[i] === z) return false;
    this._touch(i);
    const id = this.bld[i];
    if (id >= 0) {
      const b = this.buildings.get(id);
      if (b.kind === 'zone' && b.zone !== z) this.removeBuilding(id);
    }
    this.zone[i] = z;
    this.markZoneDirty(x, y);
    this.version++;
    return true;
  }

  setTrees(x, y, c) {
    const i = this.idx(x, y);
    if (this.trees[i] === c) return;
    this._touch(i);
    this.trees[i] = c;
    this.markDirty(x, y);
  }

  // ---------- Gebäude ----------
  addBuilding(b) {
    if (!b.id) b.id = this.nextId++;
    if (b.id >= this.nextId) this.nextId = b.id + 1;
    this.buildings.set(b.id, b);
    for (let y = b.y; y < b.y + b.H; y++) {
      for (let x = b.x; x < b.x + b.W; x++) {
        const i = this.idx(x, y);
        this._touch(i);
        this.trees[i] = 0;
        this.bld[i] = b.id;
        if (b.kind === 'service') this.zone[i] = 0;
        this.markZoneDirty(x, y);
        this.markDirty(x, y);
      }
    }
    this.chunkBld[this.chunkOf(b.x, b.y)].add(b.id);
    if (b.kind === 'service') {
      this.servicesDirty = true;
      if (SERVICES[b.def].unique) this.unique[b.def] = b.id;
      this.networkDirty = true; // Dienstgebäude begrenzen die Zonentiefe
    }
    this.updateAccess(b);
    if (this.rec) this.rec.added.push(b.id);
    this.version++;
    return b;
  }

  removeBuilding(id) {
    const b = this.buildings.get(id);
    if (!b) return null;
    for (let y = b.y; y < b.y + b.H; y++) {
      for (let x = b.x; x < b.x + b.W; x++) {
        const i = this.idx(x, y);
        if (this.bld[i] === id) this.bld[i] = -1;
        this.markZoneDirty(x, y);
        this.markDirty(x, y);
      }
    }
    this.buildings.delete(id);
    this.chunkBld[this.chunkOf(b.x, b.y)].delete(id);
    if (b.kind === 'service') {
      this.servicesDirty = true;
      this.networkDirty = true;
      if (this.unique[b.def] === id) delete this.unique[b.def];
    }
    if (this.rec) {
      const k = this.rec.added.indexOf(id);
      if (k >= 0) this.rec.added.splice(k, 1);
      else this.rec.removed.push(Object.assign({}, b));
    }
    this.version++;
    return b;
  }

  bulldozeTile(x, y) {
    if (!this.inb(x, y)) return null;
    const i = this.idx(x, y);
    if (this.bld[i] >= 0) return { kind: 'building', b: this.removeBuilding(this.bld[i]) };
    if (this.road[i]) {
      if (this.isOutsideTile(x, y)) return null;
      const t = this.road[i];
      this.removeRoad(x, y);
      return { kind: 'road', type: t, water: this.terrain[i] === T_WATER };
    }
    if (this.trees[i]) {
      this.setTrees(x, y, 0);
      return { kind: 'trees' };
    }
    return null;
  }

  findAccess(b) {
    const S = this.size;
    const order = [b.dir, (b.dir + 1) % 4, (b.dir + 3) % 4, (b.dir + 2) % 4];
    for (const d of order) {
      const { dx, dy } = DIRS[d];
      for (let ty = b.y; ty < b.y + b.H; ty++) {
        for (let tx = b.x; tx < b.x + b.W; tx++) {
          const nx = tx + dx, ny = ty + dy;
          if (nx >= b.x && nx < b.x + b.W && ny >= b.y && ny < b.y + b.H) continue;
          if (!this.inb(nx, ny)) continue;
          const j = ny * S + nx;
          const r = this.road[j];
          if (r && r !== 3) return j;
        }
      }
    }
    return -1;
  }

  updateAccess(b) {
    b.access = this.findAccess(b);
    b.comp = b.access >= 0 ? this.comp[b.access] : -1;
    b.connected = b.comp >= 0 && !!this.compOutside[b.comp];
  }

  hasFrontRoad(x0, y0, W, H, dir) {
    const { dx, dy } = DIRS[dir];
    for (let ty = y0; ty < y0 + H; ty++) {
      for (let tx = x0; tx < x0 + W; tx++) {
        const nx = tx + dx, ny = ty + dy;
        if (nx >= x0 && nx < x0 + W && ny >= y0 && ny < y0 + H) continue;
        if (!this.inb(nx, ny)) continue;
        const r = this.road[this.idx(nx, ny)];
        if (r && r !== 3) return true;
      }
    }
    return false;
  }

  nearWater(x0, y0, W, H) {
    for (let y = y0 - 1; y <= y0 + H; y++) {
      for (let x = x0 - 1; x <= x0 + W; x++) {
        if (!this.inb(x, y)) continue;
        if (this.terrain[this.idx(x, y)] === T_WATER) return true;
      }
    }
    return false;
  }

  // Prüft, ob ein Dienstgebäude an (x0,y0) mit Ausrichtung dir gebaut werden kann.
  checkService(defId, x0, y0, dir) {
    const def = SERVICES[defId];
    const { W, H } = serviceFootprint(def, dir);
    if (def.unique && this.unique[defId] !== undefined) return { ok: false, reason: 'Nur einmal baubar', W, H };
    for (let y = y0; y < y0 + H; y++) {
      for (let x = x0; x < x0 + W; x++) {
        if (!this.inb(x, y)) return { ok: false, reason: 'Außerhalb der Karte', W, H };
        const i = this.idx(x, y);
        if (this.terrain[i] !== T_LAND) return { ok: false, reason: 'Ungeeignetes Gelände', W, H };
        if (this.road[i]) return { ok: false, reason: 'Straße im Weg', W, H };
        const id = this.bld[i];
        if (id >= 0 && this.buildings.get(id).kind === 'service') return { ok: false, reason: 'Gebäude im Weg', W, H };
      }
    }
    if (!this.hasFrontRoad(x0, y0, W, H, dir)) return { ok: false, reason: 'Braucht Straßenanschluss', W, H };
    if (def.needsWater && !this.nearWater(x0, y0, W, H)) return { ok: false, reason: 'Muss am Wasser stehen', W, H };
    return { ok: true, reason: '', W, H };
  }

  // Sucht Ausrichtung und Position für ein Dienstgebäude um Feld (tx,ty)
  fitService(defId, tx, ty, preferDir) {
    const def = SERVICES[defId];
    let first = null;
    for (let k = 0; k < 4; k++) {
      const dir = (preferDir + k) % 4;
      const { W, H } = serviceFootprint(def, dir);
      const x0 = tx - Math.floor((W - 1) / 2), y0 = ty - Math.floor((H - 1) / 2);
      const res = this.checkService(defId, x0, y0, dir);
      const cand = { x: x0, y: y0, dir, ...res };
      if (res.ok) return cand;
      if (!first) first = cand;
    }
    return first;
  }

  // ---------- Netzwerk ----------
  updateNetwork() {
    const S = this.size, n = this.n, comp = this.comp, road = this.road;
    comp.fill(-1);
    const q = new Int32Array(n);
    let c = 0;
    this.compOutside = [];
    this.roadCount = { 1: 0, 2: 0, 3: 0, bridge: 0 };
    for (let i = 0; i < n; i++) {
      if (!road[i]) continue;
      this.roadCount[road[i]]++;
      if (this.terrain[i] === T_WATER) this.roadCount.bridge++;
      if (comp[i] >= 0) continue;
      let head = 0, tail = 0;
      q[tail++] = i;
      comp[i] = c;
      while (head < tail) {
        const j = q[head++];
        const x = j % S;
        if (x > 0 && road[j - 1] && comp[j - 1] < 0) { comp[j - 1] = c; q[tail++] = j - 1; }
        if (x < S - 1 && road[j + 1] && comp[j + 1] < 0) { comp[j + 1] = c; q[tail++] = j + 1; }
        if (j >= S && road[j - S] && comp[j - S] < 0) { comp[j - S] = c; q[tail++] = j - S; }
        if (j < n - S && road[j + S] && comp[j + S] < 0) { comp[j + S] = c; q[tail++] = j + S; }
      }
      this.compOutside.push(false);
      c++;
    }
    this.compCount = c;
    for (const o of this.outside) {
      const i = this.idx(o.x, o.y);
      if (comp[i] >= 0) this.compOutside[comp[i]] = true;
    }

    // Zonenfähige Felder neben Straßen
    this.zoneable.fill(0);
    for (let i = 0; i < n; i++) {
      const t = road[i];
      if (!t || !ROAD_TYPES[t].zoneable) continue;
      const x = i % S, y = (i / S) | 0;
      for (const d of DIRS) {
        for (let k = 1; k <= ZONE_DEPTH; k++) {
          const tx = x + d.dx * k, ty = y + d.dy * k;
          if (!this.inb(tx, ty)) break;
          const j = ty * S + tx;
          if (this.terrain[j] !== T_LAND || road[j]) break;
          const id = this.bld[j];
          if (id >= 0 && this.buildings.get(id).kind === 'service') break;
          this.zoneable[j] = 1;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (this.zone[i] && !this.zoneable[i] && this.bld[i] < 0) {
        this._touch(i);
        this.zone[i] = 0;
        this.markZoneDirty(i % S, (i / S) | 0);
      }
    }
    for (const b of this.buildings.values()) this.updateAccess(b);
    this.networkDirty = false;
    this.networkVersion++;
  }
}

export { T_LAND, T_WATER, T_ROCK };
