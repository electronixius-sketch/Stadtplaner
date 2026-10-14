// Weltmodell: Gelände, Straßennetz (Vektor), Zonenzellen entlang der Straßen, frei gedrehte Gebäude,
// Raster für Umweltwerte/Bäume/Auswahl und Rückgängig per Schnappschuss.
import {
  MAP_SIZE, CHUNK_SIZE, ZONE_DEPTH, T_LAND, T_WATER, T_ROCK, ROAD_TYPES, SERVICES, BRIDGE_MULT,
} from './config.js';
import { generateMap } from './mapgen.js';
import { RoadNetwork } from './network.js';
import {
  qSample, qSplit, qTangent, polyIntersections, distToPoly, rectsOverlap, pointInRect, rectDist, rectBounds,
  rectCorners, rectAxes, sToT,
} from './geom.js';

export function makeBuilding(props) {
  return Object.assign({
    id: 0, kind: 'zone', zone: 0, def: null,
    cx: 0, cz: 0, rot: 0, w: 1, d: 1,
    level: 1, seed: 1, cap: 0, occ: 0, built: 1,
    power: true, water: true, sewage: true, garbage: true,
    seg: -1, segS: 0, comp: -1, connected: false,
    happy: 60, unhappyDays: 0, abandoned: false, abandonedDays: 0,
    fire: 0, fireCovered: false, edu: 0, name: '', hgt: 0.5, age: 0, ti: 0, tiles: [],
  }, props);
}

// Front-Mittelpunkt eines gedrehten Grundstücks (Seite zur Straße)
export function frontMid(b) {
  const a = rectAxes(b);
  return { x: b.cx - a.dx * b.d / 2, z: b.cz - a.dz * b.d / 2 };
}

const CELL_HB = 2;

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    const S = (this.size = MAP_SIZE);
    const n = (this.n = S * S);
    this.terrain = new Uint8Array(n);
    this.trees = new Uint8Array(n);
    this.waterDist = new Uint8Array(n);
    this.bld = new Int32Array(n).fill(-1);
    this.road = new Uint8Array(n);
    this.roadSeg = new Int32Array(n).fill(-1);
    this.zoneR = new Uint8Array(4 * n);
    this.roadLen = { 1: 0, 2: 0, 3: 0, bridge: 0 };
    this.buildings = new Map();
    this.nextId = 1;
    this.cells = [];
    this.cellHash = new Map();
    this.cellByKey = new Map();
    this.chunkN = S / CHUNK_SIZE;
    const nc = this.chunkN * this.chunkN;
    this.chunkBld = Array.from({ length: nc }, () => new Set());
    this.chunkSegs = Array.from({ length: nc }, () => new Set());
    this.chunkNodes = Array.from({ length: nc }, () => new Set());
    this.dirty = new Set();
    this.zoneDirty = new Set();
    this.networkDirty = true;
    this.servicesDirty = true;
    this.networkVersion = 0;
    this.version = 0;
    this.treesVersion = 0;
    this.cellsVersion = 0;
    this.rec = null;
    this.unique = {};
    this.net = new RoadNetwork();
    this.net.onChange = (kind, obj, removed) => this.onNetChange(kind, obj, removed);
    generateMap(this, this.seed);
    const hw = this.highway;
    const a = this.net.addNode(hw.x0, hw.z, 0, true);
    const b = this.net.addNode(hw.x1, hw.z);
    this.net.addSeg(a.id, b.id, 3, (hw.x0 + hw.x1) / 2, hw.z);
    this.updateNetwork();
  }

  idx(x, y) { return y * this.size + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  tileAt(x, z) {
    const tx = Math.floor(x), tz = Math.floor(z);
    return this.inb(tx, tz) ? tz * this.size + tx : -1;
  }
  terrainAt(x, z) {
    const i = this.tileAt(x, z);
    return i < 0 ? T_ROCK : this.terrain[i];
  }
  chunkOf(x, y) {
    const S = this.size;
    const cx = Math.min(this.chunkN - 1, Math.max(0, Math.floor(Math.min(S - 0.01, Math.max(0, x)) / CHUNK_SIZE)));
    const cy = Math.min(this.chunkN - 1, Math.max(0, Math.floor(Math.min(S - 0.01, Math.max(0, y)) / CHUNK_SIZE)));
    return cy * this.chunkN + cx;
  }

  markDirty(x, y) { this.dirty.add(this.chunkOf(x, y)); }
  markZoneDirty(x, y) { this.zoneDirty.add(this.chunkOf(x, y)); }
  markAllDirty() {
    for (let c = 0; c < this.chunkN * this.chunkN; c++) { this.dirty.add(c); this.zoneDirty.add(c); }
  }

  getBuilding(x, y) {
    if (!this.inb(x, y)) return null;
    const id = this.bld[this.idx(x, y)];
    return id >= 0 ? this.buildings.get(id) || null : null;
  }

  // Gebäude an einer Weltposition (genauer Test gegen das gedrehte Rechteck)
  buildingAt(x, z, pad = 0.05) {
    const tx = Math.floor(x), tz = Math.floor(z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const b = this.getBuilding(tx + dx, tz + dz);
        if (b && pointInRect(x, z, this.rectOf(b), pad)) return b;
      }
    }
    return null;
  }

  rectOf(b) { return { cx: b.cx, cz: b.cz, rot: b.rot, w: b.w, d: b.d }; }

  // ---------- Netzänderungen -> Chunks
  onNetChange(kind, obj, removed) {
    if (this.rec) this.rec.changed = true;
    const net = this.net;
    if (kind === 'node') {
      const c = this.chunkOf(obj.x, obj.z);
      if (removed) { this.chunkNodes[obj.chunk ?? c].delete(obj.id); this.dirty.add(obj.chunk ?? c); return; }
      obj.chunk = c;
      this.chunkNodes[c].add(obj.id);
      this.dirty.add(c);
      return;
    }
    const s = obj;
    if (removed) {
      this.chunkSegs[s.chunk].delete(s.id);
      this.dirty.add(s.chunk);
    } else {
      const m = net.at(s, s.len / 2);
      s.chunk = this.chunkOf(m.x, m.z);
      this.chunkSegs[s.chunk].add(s.id);
      this.dirty.add(s.chunk);
    }
    // Nachbarn neu zeichnen (Kreuzungen und Einmündungen ändern sich)
    for (const nid of [s.a, s.b]) {
      const nd = net.nodes.get(nid);
      if (!nd) continue;
      this.dirty.add(nd.chunk ?? this.chunkOf(nd.x, nd.z));
      for (const sid of nd.segs) { const o = net.segs.get(sid); if (o) this.dirty.add(o.chunk); }
    }
    this.networkDirty = true;
    this.version++;
  }

  // ---------- Rückgängig (Schnappschuss)
  beginAction() {
    this.rec = { snap: { net: this.net.toJSON(), zoneR: this.zoneR.slice(), trees: this.trees.slice() }, added: [], removed: [], cost: 0, changed: false };
  }
  endAction() {
    const r = this.rec;
    this.rec = null;
    if (!r || (!r.changed && !r.added.length && !r.removed.length)) return null;
    return r;
  }
  undo(rec) {
    this.rec = null;
    for (const id of rec.added) if (this.buildings.has(id)) this.removeBuilding(id);
    this.net.load(rec.snap.net);
    this.rebuildChunkIndex();
    this.zoneR.set(rec.snap.zoneR);
    this.trees.set(rec.snap.trees);
    this.treesVersion++;
    for (let k = rec.removed.length - 1; k >= 0; k--) {
      const b = rec.removed[k];
      if (!this.buildings.has(b.id)) this.addBuilding(Object.assign({}, b));
    }
    this.updateNetwork();
    this.validateBuildings();
    this.markAllDirty();
  }

  rebuildChunkIndex() {
    for (const s of this.chunkSegs) s.clear();
    for (const s of this.chunkNodes) s.clear();
    for (const s of this.net.segs.values()) {
      const m = this.net.at(s, s.len / 2);
      s.chunk = this.chunkOf(m.x, m.z);
      this.chunkSegs[s.chunk].add(s.id);
    }
    for (const nd of this.net.nodes.values()) {
      nd.chunk = this.chunkOf(nd.x, nd.z);
      this.chunkNodes[nd.chunk].add(nd.id);
    }
  }

  // Wachstumsgebäude, die eine Straße überdecken, entfernen
  validateBuildings() {
    for (const b of [...this.buildings.values()]) {
      if (b.kind !== 'zone') continue;
      if (this.rectHitsRoad(this.rectOf(b), -0.05)) this.removeBuilding(b.id);
    }
  }

  rectHitsRoad(r, slack = 0) {
    const bb = rectBounds(r, 1);
    for (const id of this.net.segsNear(bb.x0, bb.z0, bb.x1, bb.z1)) {
      const s = this.net.segs.get(id);
      for (let i = 0; i <= s.n; i++) {
        if (rectDist(s.pts[i * 2], s.pts[i * 2 + 1], r) < s.hw + slack) return s;
      }
    }
    return null;
  }

  // ---------- Straßen planen und bauen
  snapPoint(x, z) {
    const net = this.net;
    const node = net.nodeNear(x, z, 0.75);
    if (node) return { x: node.x, z: node.z, node };
    const near = net.nearestSeg(x, z, 1.2);
    if (near && near.d <= near.seg.hw + 0.35) {
      const s = near.seg;
      if (near.s < 0.9) { const nd = net.nodes.get(s.a); return { x: nd.x, z: nd.z, node: nd }; }
      if (s.len - near.s < 0.9) { const nd = net.nodes.get(s.b); return { x: nd.x, z: nd.z, node: nd }; }
      return { x: near.x, z: near.z, seg: s, s: near.s };
    }
    return { x, z };
  }

  // chain: [{p0, c, p2}] -> Plan mit Gültigkeit, Kosten, Vorschau
  planRoad(chain, type) {
    const net = this.net, spec = ROAD_TYPES[type], S = this.size;
    const hw = spec.width / 2;
    const plan = { ok: true, reason: '', cost: 0, len: 0, type, demolish: new Set(), curves: [], hits: [], bridge: 0 };
    const fail = (r) => { if (plan.ok) { plan.ok = false; plan.reason = r; } };
    if (!chain.length) { fail('Zu kurz'); return plan; }
    const first = chain[0], last = chain[chain.length - 1];
    plan.s0 = this.snapPoint(first.p0[0], first.p0[1]);
    plan.sN = this.snapPoint(last.p2[0], last.p2[1]);
    const curves = chain.map((c) => ({ p0: c.p0.slice(), c: c.c.slice(), p2: c.p2.slice() }));
    curves[0].p0 = [plan.s0.x, plan.s0.z];
    curves[curves.length - 1].p2 = [plan.sN.x, plan.sN.z];
    for (const c of curves) {
      c.smp = qSample(c.p0, c.c, c.p2, 0.25);
      plan.len += c.smp.len;
    }
    plan.curves = curves;
    if (plan.len < 0.6) fail('Zu kurz');
    if (plan.s0.node && plan.sN.node && plan.s0.node === plan.sN.node && curves.length === 1) fail('Zu kurz');
    const endPts = [[plan.s0.x, plan.s0.z], [plan.sN.x, plan.sN.z]];
    const nearEnd = (x, z, r) => endPts.some(([ex, ez]) => Math.hypot(x - ex, z - ez) < r);
    // Kreuzungen
    for (let k = 0; k < curves.length; k++) {
      const c = curves[k];
      const bb = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      for (let i = 0; i <= c.smp.n; i++) {
        const x = c.smp.pts[i * 2], z = c.smp.pts[i * 2 + 1];
        bb.x0 = Math.min(bb.x0, x); bb.x1 = Math.max(bb.x1, x); bb.z0 = Math.min(bb.z0, z); bb.z1 = Math.max(bb.z1, z);
      }
      for (const id of net.segsNear(bb.x0 - 1, bb.z0 - 1, bb.x1 + 1, bb.z1 + 1)) {
        const seg = net.segs.get(id);
        for (const h of polyIntersections(c.smp, seg)) {
          if (nearEnd(h.x, h.z, 0.6)) continue;
          const tn = qTangent(c.p0, c.c, c.p2, h.ta), to = qTangent(seg.p0, seg.c, seg.p2, h.tb);
          const sin = Math.abs(tn[0] * to[1] - tn[1] * to[0]);
          if (sin < Math.sin((25 * Math.PI) / 180)) fail('Zu spitzer Winkel zur Straße');
          plan.hits.push({ x: h.x, z: h.z, r: hw + seg.hw + 0.35 });
        }
      }
    }
    // Endpunkte: spitze Winkel an bestehenden Knoten vermeiden
    for (const [sn, k, atStart] of [[plan.s0, 0, true], [plan.sN, curves.length - 1, false]]) {
      if (!sn.node && !sn.seg) continue;
      const c = curves[k];
      const t = qTangent(c.p0, c.c, c.p2, atStart ? 0 : 1);
      const dir = atStart ? t : [-t[0], -t[1]];
      if (sn.node) {
        for (const sid of sn.node.segs) {
          const [ax, az] = net.armDir(net.segs.get(sid), sn.node.id);
          if (ax * dir[0] + az * dir[1] > Math.cos((25 * Math.PI) / 180)) fail('Zu spitzer Winkel zur Straße');
        }
      } else {
        const p = net.at(sn.seg, sn.s);
        const sin = Math.abs(dir[0] * p.tz - dir[1] * p.tx);
        if (sin < Math.sin((25 * Math.PI) / 180)) fail('Zu spitzer Winkel zur Straße');
      }
    }
    const nearHit = (x, z) => plan.hits.some((h) => Math.hypot(x - h.x, z - h.z) < h.r);
    // Abtastpunkte prüfen
    for (const c of curves) {
      const { pts, cum, n } = c.smp;
      for (let i = 0; i <= n; i++) {
        const x = pts[i * 2], z = pts[i * 2 + 1];
        const step = i > 0 ? cum[i] - cum[i - 1] : 0;
        if (x < 0.25 || z < 0.25 || x > S - 0.25 || z > S - 0.25) { fail('Außerhalb der Karte'); continue; }
        const t = this.terrainAt(x, z);
        if (t === T_ROCK) fail('Zu steil – hier ist ein Berg');
        const water = t === T_WATER;
        if (water) plan.bridge += step;
        plan.cost += step * spec.cost * (water ? BRIDGE_MULT : 1);
        if (!nearEnd(x, z, hw + 1.1) && !nearHit(x, z)) {
          const ns = net.nearestSeg(x, z, hw + 1.0);
          if (ns && ns.d < hw + ns.seg.hw - 0.06) fail('Zu nah an einer anderen Straße');
        }
        const tx = Math.floor(x), tz = Math.floor(z);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const b = this.getBuilding(tx + dx, tz + dz);
            if (!b || plan.demolish.has(b.id)) continue;
            if (rectDist(x, z, this.rectOf(b)) < hw - 0.02) {
              if (b.kind === 'service') fail('Gebäude im Weg');
              else plan.demolish.add(b.id);
            }
          }
        }
      }
    }
    return plan;
  }

  resolveSnap(sn) {
    const net = this.net;
    if (sn.node && net.nodes.has(sn.node.id)) return sn.node;
    const node = net.nodeNear(sn.x, sn.z, 0.3);
    if (node) return node;
    if (sn.seg) {
      const near = net.nearestSeg(sn.x, sn.z, 0.4);
      if (near) {
        if (near.s < 0.35) return net.nodes.get(near.seg.a);
        if (near.seg.len - near.s < 0.35) return net.nodes.get(near.seg.b);
        return net.splitSeg(near.seg.id, sToT(near.seg.cum, near.s));
      }
    }
    return net.addNode(sn.x, sn.z);
  }

  // Kurve vom Startknoten aus einfügen und dabei bestehende Straßen an Kreuzungen teilen
  insertCurve(start, curve, endSnap, type) {
    const net = this.net;
    let cur = start;
    let rem = { p0: [start.x, start.z], c: curve.c.slice(), p2: curve.p2.slice() };
    const ex = endSnap.x, ez = endSnap.z;
    for (let guard = 0; guard < 60; guard++) {
      const smp = qSample(rem.p0, rem.c, rem.p2, 0.2);
      let best = null;
      const pad = 1.5;
      const x0 = Math.min(rem.p0[0], rem.c[0], rem.p2[0]) - pad, x1 = Math.max(rem.p0[0], rem.c[0], rem.p2[0]) + pad;
      const z0 = Math.min(rem.p0[1], rem.c[1], rem.p2[1]) - pad, z1 = Math.max(rem.p0[1], rem.c[1], rem.p2[1]) + pad;
      for (const id of net.segsNear(x0, z0, x1, z1)) {
        const seg = net.segs.get(id);
        for (const h of polyIntersections(smp, seg)) {
          if (Math.hypot(h.x - cur.x, h.z - cur.z) < 0.5) continue;
          if (Math.hypot(h.x - ex, h.z - ez) < 0.5) continue;
          if (!best || h.ta < best.h.ta) best = { h, seg };
        }
      }
      if (!best) break;
      const { h, seg } = best;
      const A = net.nodes.get(seg.a), B = net.nodes.get(seg.b);
      let node;
      if (Math.hypot(h.x - A.x, h.z - A.z) < 0.45) node = A;
      else if (Math.hypot(h.x - B.x, h.z - B.z) < 0.45) node = B;
      else node = net.splitSeg(seg.id, h.tb);
      const [L, R] = qSplit(rem.p0, rem.c, rem.p2, h.ta);
      if (node !== cur && !this.segBetween(cur, node)) net.addSeg(cur.id, node.id, type, L[1][0], L[1][1]);
      cur = node;
      rem = { p0: [node.x, node.z], c: R[1], p2: R[2] };
    }
    const end = this.resolveSnap(endSnap);
    if (end !== cur && !this.segBetween(cur, end)) net.addSeg(cur.id, end.id, type, rem.c[0], rem.c[1]);
    return end;
  }

  segBetween(a, b) {
    for (const sid of a.segs) {
      const s = this.net.segs.get(sid);
      if ((s.a === a.id && s.b === b.id) || (s.b === a.id && s.a === b.id)) {
        const mid = this.net.at(s, s.len / 2);
        const dx = (a.x + b.x) / 2 - mid.x, dz = (a.z + b.z) / 2 - mid.z;
        if (Math.hypot(dx, dz) < 0.6) return s;
      }
    }
    return null;
  }

  buildRoad(plan) {
    for (const id of plan.demolish) this.removeBuilding(id);
    let cur = this.resolveSnap(plan.s0);
    const n = plan.curves.length;
    for (let k = 0; k < n; k++) {
      const c = plan.curves[k];
      const endSnap = k === n - 1 ? plan.sN : this.snapPoint(c.p2[0], c.p2[1]);
      cur = this.insertCurve(cur, c, endSnap, plan.type);
    }
    this.updateNetwork();
  }

  // Baukosten eines Segments (Brückenanteil teurer)
  segCost(seg, type = seg.type) {
    const p = {};
    let water = 0;
    for (let a = 0.125; a < seg.len; a += 0.25) {
      this.net.at(seg, a, p);
      if (this.terrainAt(p.x, p.z) === T_WATER) water += 0.25;
    }
    water = Math.min(water, seg.len);
    return ROAD_TYPES[type].cost * (seg.len - water + water * BRIDGE_MULT);
  }

  // Prüft, ob ein Segment auf einen anderen Straßentyp umgebaut werden kann ('' = ja)
  checkRoadType(segId, type) {
    const s = this.net.segs.get(segId);
    if (!s) return 'Keine Straße';
    if ([s.a, s.b].some((id) => this.net.nodes.get(id).outside)) return 'Autobahnanschluss kann nicht umgebaut werden';
    const hw = ROAD_TYPES[type].width / 2;
    if (hw <= s.hw) return '';
    const seen = new Set();
    for (let tz = Math.floor(s.bbox.z0 - hw - 1); tz <= Math.floor(s.bbox.z1 + hw + 1); tz++) {
      for (let tx = Math.floor(s.bbox.x0 - hw - 1); tx <= Math.floor(s.bbox.x1 + hw + 1); tx++) {
        const b = this.getBuilding(tx, tz);
        if (!b || b.kind !== 'service' || seen.has(b.id)) continue;
        seen.add(b.id);
        const r = this.rectOf(b);
        for (let i = 0; i <= s.n; i++) if (rectDist(s.pts[i * 2], s.pts[i * 2 + 1], r) < hw - 0.03) return 'Gebäude im Weg';
      }
    }
    return '';
  }

  setRoadType(segId, type) {
    const s = this.net.segs.get(segId);
    if (!s || s.type === type) return;
    const { a, b, c } = s;
    this.net.removeSeg(segId, true);
    this.net.addSeg(a, b, type, c[0], c[1]);
    this.validateBuildings();
    this.updateNetwork();
  }

  removeRoad(segId) {
    const s = this.net.segs.get(segId);
    if (!s) return null;
    if ([s.a, s.b].some((id) => this.net.nodes.get(id).outside)) return null;
    this.net.removeSeg(segId);
    return s;
  }

  // ---------- Netzwerk-Auswertung
  updateNetwork() {
    const net = this.net, S = this.size;
    net.computeComps();
    // Straßen rastern (für Umweltwerte, Bäume, Auswahl)
    this.road.fill(0);
    this.roadSeg.fill(-1);
    this.roadLen = { 1: 0, 2: 0, 3: 0, bridge: 0 };
    let treesChanged = false;
    const p = {};
    for (const s of net.segs.values()) {
      this.roadLen[s.type] += s.len;
      const r = s.hw + 0.2;
      for (let a = 0; a <= s.len; a += 0.35) {
        net.at(s, a, p);
        if (this.terrainAt(p.x, p.z) === T_WATER) this.roadLen.bridge += 0.35;
        const tx0 = Math.floor(p.x - r), tx1 = Math.floor(p.x + r), tz0 = Math.floor(p.z - r), tz1 = Math.floor(p.z + r);
        for (let tz = tz0; tz <= tz1; tz++) {
          for (let tx = tx0; tx <= tx1; tx++) {
            if (!this.inb(tx, tz)) continue;
            const d = Math.hypot(tx + 0.5 - p.x, tz + 0.5 - p.z);
            const i = tz * S + tx;
            if (d < r) { this.road[i] = s.type; this.roadSeg[i] = s.id; }
            if (d < s.hw + 0.35 && this.trees[i]) { this.trees[i] = 0; treesChanged = true; }
          }
        }
      }
    }
    if (treesChanged) this.treesVersion++;
    this.genCells();
    for (const b of this.buildings.values()) this.updateAccess(b);
    this.updateOccupancy();
    this.networkDirty = false;
    this.networkVersion++;
  }

  updateAccess(b) {
    const f = frontMid(b);
    const near = this.net.nearestSeg(f.x, f.z, 1.6, (s) => s.type !== 3);
    if (near && near.d <= near.seg.hw + 0.5) {
      b.seg = near.seg.id;
      b.segS = near.s;
      b.comp = near.seg.comp;
    } else {
      b.seg = -1;
      b.comp = -1;
    }
    b.connected = b.comp >= 0 && !!this.net.compOutside[b.comp];
  }

  // ---------- Zonenzellen
  trimAt(nodeId, own) {
    const net = this.net;
    const nd = net.nodes.get(nodeId);
    if (nd.segs.length === 1) return 0.2;
    const j = net.junction(nd);
    if (j.smooth) {
      // Gerade Fortsetzung: Zellen laufen ohne Lücke weiter
      const [p, q] = j.arms;
      if (p.dx * q.dx + p.dz * q.dz < -0.9) return 0;
    }
    let m = 0, t = 0;
    for (const a of j.arms) {
      if (a.seg.id !== own.id) m = Math.max(m, a.hw);
      else t = a.t;
    }
    return Math.max(m + 0.15, t + 0.05);
  }

  genCells() {
    const net = this.net;
    this.cells = [];
    this.cellHash.clear();
    this.cellByKey.clear();
    const segs = [...net.segs.values()].filter((s) => ROAD_TYPES[s.type].zoneable).sort((a, b) => a.id - b.id);
    const p = {};
    for (const s of segs) {
      const ta = this.trimAt(s.a, s), tb = this.trimAt(s.b, s);
      const usable = s.len - ta - tb;
      if (usable < 0.8) continue;
      const cols = Math.max(1, Math.round(usable));
      const cl = usable / cols;
      for (const side of [1, -1]) {
        for (let j = 0; j < cols; j++) {
          const sArc = ta + (j + 0.5) * cl;
          net.at(s, sArc, p);
          const nx = -p.tz * side, nz = p.tx * side;
          const rot = Math.atan2(-nx, nz);
          for (let r = 1; r <= ZONE_DEPTH; r++) {
            const off = s.hw + r - 0.5;
            const cell = { cx: p.x + nx * off, cz: p.z + nz * off, rot, w: cl, d: 1, seg: s.id, side, col: j, row: r, sArc, zone: 0, bld: -1, idx: 0 };
            if (!this.cellOk(cell)) break;
            cell.idx = this.cells.length;
            cell.zone = this.zoneAt(cell.cx, cell.cz);
            this.cells.push(cell);
            const k = Math.floor(cell.cz / CELL_HB) * 10000 + Math.floor(cell.cx / CELL_HB);
            let arr = this.cellHash.get(k);
            if (!arr) { arr = []; this.cellHash.set(k, arr); }
            arr.push(cell.idx);
            this.cellByKey.set(`${s.id}|${side}|${j}|${r}`, cell.idx);
          }
        }
      }
    }
    this.cellsVersion++;
    for (let c = 0; c < this.chunkN * this.chunkN; c++) this.zoneDirty.add(c);
  }

  cellsNear(x, z, r) {
    const out = [];
    const bx0 = Math.floor((x - r) / CELL_HB), bx1 = Math.floor((x + r) / CELL_HB);
    const bz0 = Math.floor((z - r) / CELL_HB), bz1 = Math.floor((z + r) / CELL_HB);
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const arr = this.cellHash.get(bz * 10000 + bx);
        if (arr) for (const i of arr) out.push(this.cells[i]);
      }
    }
    return out;
  }

  cellOk(cell) {
    const S = this.size;
    if (cell.cx < 0.5 || cell.cz < 0.5 || cell.cx > S - 0.5 || cell.cz > S - 0.5) return false;
    if (this.terrainAt(cell.cx, cell.cz) !== T_LAND) return false;
    for (const [x, z] of rectCorners(cell, 0.8)) if (this.terrainAt(x, z) !== T_LAND) return false;
    // Abstand zu allen Straßen
    for (const id of this.net.segsNear(cell.cx - 2.5, cell.cz - 2.5, cell.cx + 2.5, cell.cz + 2.5)) {
      const s = this.net.segs.get(id);
      const d = distToPoly(cell.cx, cell.cz, s.pts, s.cum).d;
      if (d < s.hw + 0.45) return false;
      for (const [x, z] of rectCorners(cell, 0.92)) if (distToPoly(x, z, s.pts, s.cum).d < s.hw - 0.02) return false;
    }
    // Dienstgebäude blockieren Zellen
    const tx = Math.floor(cell.cx), tz = Math.floor(cell.cz);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const b = this.getBuilding(tx + dx, tz + dz);
        if (b && b.kind === 'service' && rectsOverlap(cell, this.rectOf(b), 0.85)) return false;
      }
    }
    // Überlappung mit bereits angenommenen Zellen
    for (const o of this.cellsNear(cell.cx, cell.cz, 1.5)) {
      if (Math.hypot(o.cx - cell.cx, o.cz - cell.cz) > 1.4) continue;
      if (rectsOverlap(cell, o, 0.86)) return false;
    }
    return true;
  }

  cellAt(seg, side, col, row) {
    const i = this.cellByKey.get(`${seg}|${side}|${col}|${row}`);
    return i === undefined ? null : this.cells[i];
  }

  zoneAt(x, z) {
    const R = this.size * 2;
    const px = Math.floor(x * 2), pz = Math.floor(z * 2);
    if (px < 0 || pz < 0 || px >= R || pz >= R) return 0;
    return this.zoneR[pz * R + px];
  }

  paintCellRaster(cell, zone) {
    const R = this.size * 2;
    const bb = rectBounds(cell, 0);
    for (let pz = Math.max(0, Math.floor(bb.z0 * 2)); pz <= Math.min(R - 1, Math.floor(bb.z1 * 2)); pz++) {
      for (let px = Math.max(0, Math.floor(bb.x0 * 2)); px <= Math.min(R - 1, Math.floor(bb.x1 * 2)); px++) {
        if (pointInRect((px + 0.5) / 2, (pz + 0.5) / 2, cell, 0.02)) this.zoneR[pz * R + px] = zone;
      }
    }
    const cz = Math.floor(cell.cz * 2), cx = Math.floor(cell.cx * 2);
    if (cx >= 0 && cz >= 0 && cx < R && cz < R) this.zoneR[cz * R + cx] = zone;
  }

  setCellZone(cell, zone) {
    if (cell.zone === zone) return false;
    if (this.rec) this.rec.changed = true;
    cell.zone = zone;
    this.paintCellRaster(cell, zone);
    this.markZoneDirty(cell.cx, cell.cz);
    this.version++;
    return true;
  }

  // Gebäude anderer Zonen auf geänderten Zellen entfernen
  clearMismatched(cells) {
    const ids = new Set();
    for (const c of cells) {
      if (c.bld < 0) continue;
      const b = this.buildings.get(c.bld);
      if (b && b.kind === 'zone' && b.zone !== c.zone) ids.add(b.id);
    }
    for (const id of ids) this.removeBuilding(id);
    return ids.size;
  }

  updateOccupancy() {
    for (const c of this.cells) c.bld = -1;
    for (const b of this.buildings.values()) this.occupy(b, b.id);
  }

  occupy(b, id) {
    const r = this.rectOf(b);
    for (const c of this.cellsNear(b.cx, b.cz, Math.max(b.w, b.d) / 2 + 1)) {
      if (pointInRect(c.cx, c.cz, r, -0.05)) {
        if (id >= 0) c.bld = id; else if (c.bld === b.id) c.bld = -1;
      } else if (id >= 0 && c.bld < 0 && rectsOverlap(c, r, 0.8)) c.bld = id;
    }
  }

  // ---------- Gebäude
  rasterBuilding(b) {
    const S = this.size;
    const r = this.rectOf(b);
    const bb = rectBounds(r, 0);
    b.tiles = [];
    for (let tz = Math.max(0, Math.floor(bb.z0)); tz <= Math.min(S - 1, Math.floor(bb.z1)); tz++) {
      for (let tx = Math.max(0, Math.floor(bb.x0)); tx <= Math.min(S - 1, Math.floor(bb.x1)); tx++) {
        if (pointInRect(tx + 0.5, tz + 0.5, r, 0.2)) b.tiles.push(tz * S + tx);
      }
    }
    const ci = this.tileAt(b.cx, b.cz);
    b.ti = ci < 0 ? 0 : ci;
    if (ci >= 0 && !b.tiles.includes(ci)) b.tiles.push(ci);
  }

  addBuilding(b) {
    if (!b.id) b.id = this.nextId++;
    if (b.id >= this.nextId) this.nextId = b.id + 1;
    this.buildings.set(b.id, b);
    this.rasterBuilding(b);
    for (const i of b.tiles) this.bld[i] = b.id;
    // Bäume auf und direkt neben dem Grundstück fällen
    let treesChanged = false;
    const r = this.rectOf(b), bb = rectBounds(r, 1);
    for (let tz = Math.max(0, Math.floor(bb.z0)); tz <= Math.min(this.size - 1, Math.floor(bb.z1)); tz++) {
      for (let tx = Math.max(0, Math.floor(bb.x0)); tx <= Math.min(this.size - 1, Math.floor(bb.x1)); tx++) {
        const i = tz * this.size + tx;
        if (this.trees[i] && rectDist(tx + 0.5, tz + 0.5, r) < 0.7) { this.trees[i] = 0; treesChanged = true; }
      }
    }
    if (treesChanged) this.treesVersion++;
    b.chunk = this.chunkOf(b.cx, b.cz);
    this.chunkBld[b.chunk].add(b.id);
    this.dirty.add(b.chunk);
    this.markZoneDirty(b.cx, b.cz);
    if (b.kind === 'service') {
      this.servicesDirty = true;
      if (SERVICES[b.def].unique) this.unique[b.def] = b.id;
      this.networkDirty = true; // Zellen unter Dienstgebäuden werden ungültig
    }
    this.occupy(b, b.id);
    this.updateAccess(b);
    if (this.rec) { this.rec.added.push(b.id); this.rec.changed = true; }
    this.version++;
    return b;
  }

  removeBuilding(id) {
    const b = this.buildings.get(id);
    if (!b) return null;
    for (const i of b.tiles) if (this.bld[i] === id) this.bld[i] = -1;
    this.occupy(b, -1);
    this.buildings.delete(id);
    this.chunkBld[b.chunk].delete(id);
    this.dirty.add(b.chunk);
    this.markZoneDirty(b.cx, b.cz);
    // Überdeckte Rasterfelder an Nachbarn zurückgeben
    for (const i of b.tiles) {
      const x = i % this.size, z = (i / this.size) | 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const o = this.getBuilding(x + dx, z + dz);
        if (o && o.tiles.includes(i) && this.bld[i] < 0) this.bld[i] = o.id;
      }
    }
    if (b.kind === 'service') {
      this.servicesDirty = true;
      this.networkDirty = true;
      if (this.unique[b.def] === id) delete this.unique[b.def];
    }
    if (this.rec) {
      this.rec.changed = true;
      const k = this.rec.added.indexOf(id);
      if (k >= 0) this.rec.added.splice(k, 1);
      else this.rec.removed.push(Object.assign({}, b));
    }
    this.version++;
    return b;
  }

  setTrees(x, y, c) {
    const i = this.idx(x, y);
    if (this.trees[i] === c) return;
    if (this.rec) this.rec.changed = true;
    this.trees[i] = c;
    this.treesVersion++;
  }

  // ---------- Dienstgebäude frei platzieren
  // Richtet ein Gebäude an der nächsten Straße aus; flip wechselt die Straßenseite.
  fitService(defId, px, pz, opts = {}) {
    const def = SERVICES[defId];
    const w = def.w, d = def.h;
    const near = this.net.nearestSeg(px, pz, 2.2 + d / 2, (s) => s.type !== 3);
    let rect;
    if (near && !opts.free) {
      const p = this.net.at(near.seg, near.s);
      const nlx = -p.tz, nlz = p.tx;
      let side = (px - p.x) * nlx + (pz - p.z) * nlz >= 0 ? 1 : -1;
      if (opts.flip) side = -side;
      const nx = nlx * side, nz = nlz * side;
      const off = near.seg.hw + d / 2 + 0.06;
      rect = { cx: p.x + nx * off, cz: p.z + nz * off, rot: Math.atan2(-nx, nz), w, d };
    } else {
      rect = { cx: px, cz: pz, rot: opts.rot || 0, w, d };
    }
    return Object.assign(rect, this.checkService(defId, rect));
  }

  checkService(defId, r) {
    const def = SERVICES[defId];
    const S = this.size;
    const res = { ok: true, reason: '', demolish: [] };
    const fail = (m) => { if (res.ok) { res.ok = false; res.reason = m; } };
    if (def.unique && this.unique[defId] !== undefined) fail('Nur einmal baubar');
    for (const [x, z] of rectCorners(r)) if (x < 0.2 || z < 0.2 || x > S - 0.2 || z > S - 0.2) fail('Außerhalb der Karte');
    const a = rectAxes(r);
    for (let u = -r.w / 2 + 0.2; u <= r.w / 2 - 0.19; u += 0.5) {
      for (let v = -r.d / 2 + 0.2; v <= r.d / 2 - 0.19; v += 0.5) {
        if (this.terrainAt(r.cx + a.lx * u + a.dx * v, r.cz + a.lz * u + a.dz * v) !== T_LAND) fail('Ungeeignetes Gelände');
      }
    }
    if (this.rectHitsRoad(r, -0.03)) fail('Straße im Weg');
    const bb = rectBounds(r, 0.5);
    const seen = new Set();
    for (let tz = Math.floor(bb.z0); tz <= Math.floor(bb.z1); tz++) {
      for (let tx = Math.floor(bb.x0); tx <= Math.floor(bb.x1); tx++) {
        const b = this.getBuilding(tx, tz);
        if (!b || seen.has(b.id)) continue;
        seen.add(b.id);
        if (!rectsOverlap(r, this.rectOf(b), 0.97)) continue;
        if (b.kind === 'service') fail('Gebäude im Weg');
        else res.demolish.push(b.id);
      }
    }
    const f = { x: r.cx - a.dx * r.d / 2, z: r.cz - a.dz * r.d / 2 };
    const near = this.net.nearestSeg(f.x, f.z, 1.6, (s) => s.type !== 3);
    if (!near || near.d > near.seg.hw + 0.5) fail('Braucht Straßenanschluss');
    if (def.needsWater) {
      let water = false;
      for (let k = 0; k < 24 && !water; k++) {
        const ang = (k / 24) * Math.PI * 2;
        const rr = Math.max(r.w, r.d) / 2 + 0.8;
        if (this.terrainAt(r.cx + Math.cos(ang) * rr, r.cz + Math.sin(ang) * rr) === T_WATER) water = true;
      }
      if (!water) fail('Muss am Wasser stehen');
    }
    return res;
  }

  // ---------- Abriss-Abfrage
  objectsAt(x, z, r) {
    const out = { buildings: new Set(), segs: new Set(), trees: [] };
    const tx0 = Math.floor(x - r - 2), tx1 = Math.floor(x + r + 2), tz0 = Math.floor(z - r - 2), tz1 = Math.floor(z + r + 2);
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const b = this.getBuilding(tx, tz);
        if (b && !out.buildings.has(b.id) && rectDist(x, z, this.rectOf(b)) <= r) out.buildings.add(b.id);
        if (this.inb(tx, tz) && this.trees[this.idx(tx, tz)] && Math.hypot(tx + 0.5 - x, tz + 0.5 - z) <= r + 0.5) out.trees.push(this.idx(tx, tz));
      }
    }
    for (const id of this.net.segsNear(x - r - 1, z - r - 1, x + r + 1, z + r + 1)) {
      const s = this.net.segs.get(id);
      if ([s.a, s.b].some((nid) => this.net.nodes.get(nid).outside)) continue;
      if (distToPoly(x, z, s.pts, s.cum).d <= s.hw + r) out.segs.add(id);
    }
    return out;
  }
}
