// Straßennetz als Graph: Knoten (Kreuzungen, Enden) und Segmente (quadratische Kurven).
import { qSample, qSplit, qTangent, distToPoly, polyAt, wrapAngle } from './geom.js';
import { ROAD_TYPES } from './config.js';

const HB = 4; // Kantenlänge der Hash-Zellen
const FIL = 0.22; // Radius der Bordsteinrundung an Kreuzungen
const SMOOTH_DOT = -0.6; // zwei gleichartige Arme mit Knick < ~53° gehen nahtlos ineinander über

export class RoadNetwork {
  constructor() {
    this.nodes = new Map();
    this.segs = new Map();
    this.nextNode = 1;
    this.nextSeg = 1;
    this.buckets = new Map();
    this.version = 0;
    this.compOutside = [];
    this.compCount = 0;
    this.onChange = null;
  }

  // ---------- Knoten
  addNode(x, z, id = 0, outside = false) {
    const n = { id: id || this.nextNode++, x, z, segs: [], outside, comp: -1 };
    if (n.id >= this.nextNode) this.nextNode = n.id + 1;
    this.nodes.set(n.id, n);
    this.version++;
    if (this.onChange) this.onChange('node', n);
    return n;
  }

  removeNode(n) {
    if (!n || n.segs.length || n.outside) return;
    this.nodes.delete(n.id);
    this.version++;
    if (this.onChange) this.onChange('node', n, true);
  }

  nodeNear(x, z, r) {
    let best = null, bd = r;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d <= bd) { bd = d; best = n; }
    }
    return best;
  }

  // ---------- Segmente
  addSeg(aId, bId, type, cx, cz, id = 0) {
    const a = this.nodes.get(aId), b = this.nodes.get(bId);
    const s = { id: id || this.nextSeg++, a: aId, b: bId, type, c: [cx, cz], comp: -1, density: 0, occ: 0 };
    if (s.id >= this.nextSeg) this.nextSeg = s.id + 1;
    this.geom(s);
    this.segs.set(s.id, s);
    a.segs.push(s.id);
    b.segs.push(s.id);
    this.index(s, true);
    this.version++;
    if (this.onChange) this.onChange('seg', s);
    return s;
  }

  geom(s) {
    const a = this.nodes.get(s.a), b = this.nodes.get(s.b);
    s.p0 = [a.x, a.z];
    s.p2 = [b.x, b.z];
    const smp = qSample(s.p0, s.c, s.p2, 0.25);
    s.pts = smp.pts;
    s.cum = smp.cum;
    s.len = smp.len;
    s.n = smp.n;
    s.hw = ROAD_TYPES[s.type].width / 2;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i <= s.n; i++) {
      const x = s.pts[i * 2], z = s.pts[i * 2 + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    s.bbox = { x0, z0, x1, z1 };
  }

  index(s, add) {
    const m = s.hw + 0.5;
    const bx0 = Math.floor((s.bbox.x0 - m) / HB), bx1 = Math.floor((s.bbox.x1 + m) / HB);
    const bz0 = Math.floor((s.bbox.z0 - m) / HB), bz1 = Math.floor((s.bbox.z1 + m) / HB);
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const k = bz * 10000 + bx;
        let set = this.buckets.get(k);
        if (add) {
          if (!set) { set = new Set(); this.buckets.set(k, set); }
          set.add(s.id);
        } else if (set) {
          set.delete(s.id);
        }
      }
    }
  }

  removeSeg(id, keepNodes = false) {
    const s = this.segs.get(id);
    if (!s) return null;
    this.index(s, false);
    this.segs.delete(id);
    for (const nid of [s.a, s.b]) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      n.segs = n.segs.filter((x) => x !== id);
      if (!keepNodes) this.removeNode(n);
    }
    this.version++;
    if (this.onChange) this.onChange('seg', s, true);
    return s;
  }

  // Segment bei Kurvenparameter t teilen; gibt den neuen Knoten zurück
  splitSeg(id, t) {
    const s = this.segs.get(id);
    const [L, R] = qSplit(s.p0, s.c, s.p2, t);
    const node = this.addNode(L[2][0], L[2][1]);
    const { a, b, type } = s;
    this.removeSeg(id, true);
    this.addSeg(a, node.id, type, L[1][0], L[1][1]);
    this.addSeg(node.id, b, type, R[1][0], R[1][1]);
    return node;
  }

  segsNear(x0, z0, x1, z1) {
    const out = new Set();
    const bx0 = Math.floor(x0 / HB), bx1 = Math.floor(x1 / HB), bz0 = Math.floor(z0 / HB), bz1 = Math.floor(z1 / HB);
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const set = this.buckets.get(bz * 10000 + bx);
        if (set) for (const id of set) out.add(id);
      }
    }
    return out;
  }

  // Nächstes Segment zu einem Punkt: { seg, d, s, x, z }
  nearestSeg(x, z, maxD, filter = null) {
    let best = null;
    for (const id of this.segsNear(x - maxD - 1, z - maxD - 1, x + maxD + 1, z + maxD + 1)) {
      const seg = this.segs.get(id);
      if (filter && !filter(seg)) continue;
      const r = distToPoly(x, z, seg.pts, seg.cum);
      if (r.d <= maxD && (!best || r.d < best.d)) best = { seg, d: r.d, s: r.s, x: r.x, z: r.z };
    }
    return best;
  }

  at(seg, s, out = {}) { return polyAt(seg.pts, seg.cum, s, out); }

  other(seg, nodeId) { return seg.a === nodeId ? seg.b : seg.a; }

  // Richtung, in die ein Segment einen Knoten verlässt
  armDir(seg, nodeId) {
    const p = {};
    if (seg.a === nodeId) { this.at(seg, Math.min(seg.len, 0.3), p); return [p.tx, p.tz]; }
    this.at(seg, Math.max(0, seg.len - 0.3), p);
    return [-p.tx, -p.tz];
  }

  // Arme eines Knotens, gegen den Uhrzeigersinn sortiert
  arms(node) {
    const out = [];
    for (const id of node.segs) {
      const seg = this.segs.get(id);
      const [dx, dz] = this.armDir(seg, node.id);
      out.push({ seg, dx, dz, ang: Math.atan2(dz, dx), hw: seg.hw });
    }
    out.sort((p, q) => p.ang - q.ang);
    return out;
  }

  minArmAngle(node) {
    const arms = this.arms(node);
    if (arms.length < 2) return Math.PI;
    let m = Math.PI * 2;
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i], b = arms[(i + 1) % arms.length];
      let d = b.ang - a.ang;
      if (i === arms.length - 1) d += Math.PI * 2;
      m = Math.min(m, Math.abs(wrapAngle(d)) || Math.abs(d));
    }
    return m;
  }

  // Kreuzungsgeometrie: Arme (gegen den Uhrzeigersinn) mit Rückzugsabstand t, ab dem das Segment
  // als Band gezeichnet wird. smooth: nahtloser Übergang zweier Segmente ohne Kreuzungsfläche.
  junction(node) {
    const arms = [];
    for (const id of node.segs) {
      const seg = this.segs.get(id);
      const atA = seg.a === node.id;
      const [tx, tz] = qTangent(seg.p0, seg.c, seg.p2, atA ? 0 : 1);
      const dx = atA ? tx : -tx, dz = atA ? tz : -tz;
      arms.push({ seg, atA, dx, dz, ang: Math.atan2(dz, dx), hw: seg.hw, t: 0 });
    }
    arms.sort((p, q) => p.ang - q.ang);
    const info = { arms, smooth: false };
    const n = arms.length;
    if (n === 2 && arms[0].seg.type === arms[1].seg.type && arms[0].dx * arms[1].dx + arms[0].dz * arms[1].dz < SMOOTH_DOT) {
      info.smooth = true;
      return info;
    }
    if (n < 2) return info;
    for (let i = 0; i < n; i++) {
      const a = arms[i], b = arms[(i + 1) % n];
      let gap = b.ang - a.ang;
      if (i === n - 1) gap += Math.PI * 2;
      if (gap > Math.PI - 0.1) continue;
      const sn = Math.sin(gap), cs = Math.cos(gap);
      a.t = Math.max(a.t, (b.hw + a.hw * cs) / sn + FIL);
      b.t = Math.max(b.t, (a.hw + b.hw * cs) / sn + FIL);
    }
    for (const a of arms) a.t = Math.min(Math.max(a.t, a.hw * 0.5 + 0.1), a.seg.len * 0.45, 3);
    return info;
  }

  computeComps() {
    for (const n of this.nodes.values()) n.comp = -1;
    let c = 0;
    this.compOutside = [];
    for (const n0 of this.nodes.values()) {
      if (n0.comp >= 0 || !n0.segs.length) continue;
      const stack = [n0];
      n0.comp = c;
      let outside = false;
      while (stack.length) {
        const n = stack.pop();
        if (n.outside) outside = true;
        for (const sid of n.segs) {
          const s = this.segs.get(sid);
          s.comp = c;
          const o = this.nodes.get(this.other(s, n.id));
          if (o.comp < 0) { o.comp = c; stack.push(o); }
        }
      }
      this.compOutside.push(outside);
      c++;
    }
    this.compCount = c;
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()].map((n) => [n.id, Math.round(n.x * 1000) / 1000, Math.round(n.z * 1000) / 1000, n.outside ? 1 : 0]),
      segs: [...this.segs.values()].map((s) => [s.id, s.a, s.b, s.type, Math.round(s.c[0] * 1000) / 1000, Math.round(s.c[1] * 1000) / 1000]),
      nextNode: this.nextNode,
      nextSeg: this.nextSeg,
    };
  }

  load(o) {
    const cb = this.onChange;
    this.onChange = null;
    this.nodes.clear();
    this.segs.clear();
    this.buckets.clear();
    for (const [id, x, z, out] of o.nodes) this.addNode(x, z, id, !!out);
    for (const [id, a, b, type, cx, cz] of o.segs) if (this.nodes.has(a) && this.nodes.has(b)) this.addSeg(a, b, type, cx, cz, id);
    this.nextNode = Math.max(this.nextNode, o.nextNode || 1);
    this.nextSeg = Math.max(this.nextSeg, o.nextSeg || 1);
    this.onChange = cb;
    this.version++;
  }
}
