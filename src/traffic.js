// Verkehr auf dem Vektor-Straßennetz: Fahrten zwischen Gebäuden, A* über Kreuzungen,
// Fahrt entlang der Kurven mit Fahrspurversatz und geglättetem Abbiegen.
import { ROAD_TYPES, ZONES, SERVICES } from './config.js';
import { clamp } from './util.js';

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  clear() { this.items.length = 0; }
  push(node, p) {
    const a = this.items;
    a.push([node, p]);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j][1] <= a[i][1]) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  peekPrio() { return this.items.length ? this.items[0][1] : Infinity; }
}

export const VEH_CAR = 0, VEH_TRUCK = 1, VEH_FIRE = 2, VEH_BUS = 3;
const JR = 0.42; // Abstand vor Kreuzungen, ab dem abgebogen wird

export class Traffic {
  constructor(world, sim) {
    this.w = world;
    this.sim = sim;
    sim.traffic = this;
    this.vehicles = [];
    this.density = new Float32Array(world.n);
    this.heap = new MinHeap();
    this.spawnAcc = 0;
    this.densAcc = 0;
    this.maxVehicles = 350;
    this.lists = null;
    this.listDay = -1;
    this.listVersion = -1;
    this.congestion = 0;
    this.rand = Math.random;
    this.p = {};
  }

  reset() {
    this.vehicles.length = 0;
    this.density.fill(0);
    for (const s of this.w.net.segs.values()) { s.occ = 0; s.density = 0; }
    this.lists = null;
  }

  anchorOf(b) { return b.seg >= 0 ? { seg: b.seg, s: b.segS, comp: b.comp } : null; }

  buildLists() {
    const w = this.w, net = w.net;
    const byComp = new Map();
    const get = (c) => {
      let o = byComp.get(c);
      if (!o) { o = { res: [], work: [], com: [], ind: [], all: [] }; byComp.set(c, o); }
      return o;
    };
    const res = [], ind = [];
    for (const b of w.buildings.values()) {
      if (b.seg < 0 || b.comp < 0 || b.built < 1 || b.abandoned) continue;
      const L = get(b.comp);
      L.all.push(b);
      if (b.kind === 'service') { if (SERVICES[b.def].jobs) L.work.push(b); continue; }
      const key = ZONES[b.zone].key;
      if (key === 'R') { if (b.occ > 0) { L.res.push(b); res.push(b); } }
      else if (b.occ > 0) {
        L.work.push(b);
        if (key === 'C') L.com.push(b);
        if (key === 'I') { L.ind.push(b); ind.push(b); }
      }
    }
    const stops = new Map();
    const depots = this.sim.depotComps || new Set();
    for (const b of w.buildings.values()) {
      if (b.kind !== 'service' || b.def !== 'busstop' || b.seg < 0 || !depots.has(b.comp)) continue;
      if (!stops.has(b.comp)) stops.set(b.comp, []);
      stops.get(b.comp).push(b);
    }
    this.stops = [...stops.values()].filter((a) => a.length >= 2);
    this.stopCount = this.stops.reduce((s, a) => s + a.length, 0);
    const outside = [];
    for (const nd of net.nodes.values()) {
      if (!nd.outside || !nd.segs.length) continue;
      const seg = net.segs.get(nd.segs[0]);
      outside.push({ seg: seg.id, s: seg.a === nd.id ? 0.05 : seg.len - 0.05, comp: seg.comp });
    }
    this.lists = { byComp, res, ind, outside };
    this.listDay = this.sim.day;
    this.listVersion = w.networkVersion;
  }

  pickFrom(arr) { return arr[Math.floor(this.rand() * arr.length)]; }

  spawnTrip() {
    const L = this.lists;
    if (!L) return;
    const r = this.rand();
    let from = null, to = null, type = VEH_CAR;
    const A = (b) => this.anchorOf(b);
    if (r < 0.72 && L.res.length) {
      const b = this.pickFrom(L.res);
      const C = L.byComp.get(b.comp);
      const dest = r < 0.5 ? C.work : C.com;
      if (dest.length) { from = A(b); to = A(this.pickFrom(dest)); }
      else {
        const o = L.outside.find((q) => q.comp === b.comp);
        if (o) { from = A(b); to = o; }
      }
      if (this.rand() < 0.5) { const t = from; from = to; to = t; }
    } else if (r < 0.88 && L.ind.length) {
      const b = this.pickFrom(L.ind);
      const C = L.byComp.get(b.comp);
      type = VEH_TRUCK;
      const o = L.outside.find((q) => q.comp === b.comp);
      if (C.com.length && (this.rand() < 0.6 || !o)) { from = A(b); to = A(this.pickFrom(C.com)); }
      else if (o) { from = A(b); to = o; if (this.rand() < 0.5) { from = o; to = A(b); } }
    } else if (L.outside.length) {
      const o = this.pickFrom(L.outside);
      const C = L.byComp.get(o.comp);
      if (C && C.all.length) {
        const b = this.pickFrom(C.all);
        from = o; to = A(b);
        if (this.rand() < 0.5) { from = A(b); to = o; }
        if (this.rand() < 0.25) type = VEH_TRUCK;
      }
    }
    if (!from || !to) return;
    const legs = this.findRoute(from, to);
    if (legs) this.addVehicle(legs, type);
  }

  dispatchFire(fromB, toB) {
    if (!fromB || !toB || fromB.seg < 0 || toB.seg < 0) return;
    const legs = this.findRoute(this.anchorOf(fromB), this.anchorOf(toB));
    if (legs) this.addVehicle(legs, VEH_FIRE, { target: toB.id });
  }

  // ---------- Wegfindung über Kreuzungsknoten
  cost(seg) { return (1 / ROAD_TYPES[seg.type].speed) * (1 + seg.density * 1.5); }

  findRoute(from, to) {
    const net = this.w.net;
    const fs = net.segs.get(from.seg), ts = net.segs.get(to.seg);
    if (!fs || !ts || fs.comp !== ts.comp) return null;
    if (fs === ts) {
      if (Math.abs(to.s - from.s) < 0.3) return null;
      return [{ seg: fs.id, dir: to.s > from.s ? 1 : -1, s0: from.s, s1: to.s }];
    }
    const g = new Map(), came = new Map(), closed = new Set();
    const heap = this.heap;
    heap.clear();
    const goal = net.at(ts, to.s, {});
    const h = (nd) => Math.hypot(nd.x - goal.x, nd.z - goal.z) * 0.45;
    const startCosts = [[fs.a, from.s * this.cost(fs)], [fs.b, (fs.len - from.s) * this.cost(fs)]];
    for (const [nid, c] of startCosts) {
      if (!g.has(nid) || c < g.get(nid)) { g.set(nid, c); came.set(nid, { prev: -1, seg: fs.id }); heap.push(nid, c + h(net.nodes.get(nid))); }
    }
    let best = null;
    let expanded = 0;
    while (heap.size) {
      if (best && heap.peekPrio() >= best.cost) break;
      const [nid] = heap.pop();
      if (closed.has(nid)) continue;
      closed.add(nid);
      if (++expanded > 4000) break;
      const nd = net.nodes.get(nid);
      const gc = g.get(nid);
      for (const sid of nd.segs) {
        const seg = net.segs.get(sid);
        if (seg === ts) {
          const c = gc + (seg.a === nid ? to.s : seg.len - to.s) * this.cost(seg);
          if (!best || c < best.cost) best = { cost: c, node: nid };
          continue;
        }
        if (seg === fs) continue;
        const m = net.other(seg, nid);
        const c = gc + seg.len * this.cost(seg);
        if (!g.has(m) || c < g.get(m)) {
          g.set(m, c);
          came.set(m, { prev: nid, seg: sid });
          heap.push(m, c + h(net.nodes.get(m)));
        }
      }
    }
    if (!best) return null;
    // Knotenfolge rekonstruieren
    const chain = [];
    for (let nid = best.node; nid !== -1;) {
      const c = came.get(nid);
      chain.push({ node: nid, seg: c.seg });
      nid = c.prev;
    }
    chain.reverse();
    const legs = [];
    const first = chain[0];
    legs.push({ seg: fs.id, dir: first.node === fs.b ? 1 : -1, s0: from.s, s1: first.node === fs.b ? fs.len : 0 });
    for (let k = 1; k < chain.length; k++) {
      const seg = net.segs.get(chain[k].seg);
      const fromNode = chain[k - 1].node;
      const fwd = seg.a === fromNode;
      legs.push({ seg: seg.id, dir: fwd ? 1 : -1, s0: fwd ? 0 : seg.len, s1: fwd ? seg.len : 0 });
    }
    const lastNode = chain[chain.length - 1].node;
    const fwd = ts.a === lastNode;
    legs.push({ seg: ts.id, dir: fwd ? 1 : -1, s0: fwd ? 0 : ts.len, s1: to.s });
    return legs;
  }

  // ---------- Fahrzeuge
  addVehicle(legs, type, extra = null) {
    const v = {
      legs, li: 0, s: legs[0].s0, type,
      color: Math.floor(this.rand() * 1000),
      laneSel: this.rand() < 0.5 ? 0 : 1,
      base: type === VEH_FIRE ? 2.6 : type === VEH_TRUCK || type === VEH_BUS ? 1.2 : 1.55 + this.rand() * 0.35,
      turn: null, x: 0, z: 0, yaw: 0, alive: true, parked: false, target: -1,
    };
    if (extra) Object.assign(v, extra);
    const seg = this.w.net.segs.get(legs[0].seg);
    if (!seg) return;
    seg.occ++;
    this.place(v, seg, legs[0]);
    this.vehicles.push(v);
  }

  lane(seg, v) {
    if (seg.type === 1) return 0.17;
    if (seg.type === 2) return v.laneSel ? 0.46 : 0.22;
    return v.laneSel ? 0.5 : 0.22;
  }

  // Position auf einem Fahrstreifen
  lanePos(seg, s, dir, v, out) {
    const p = this.w.net.at(seg, s, this.p);
    const tx = p.tx * dir, tz = p.tz * dir;
    const l = this.lane(seg, v);
    out.x = p.x - tz * l;
    out.z = p.z + tx * l;
    out.tx = tx;
    out.tz = tz;
    return out;
  }

  place(v, seg, leg) {
    const q = this.lanePos(seg, v.s, leg.dir, v, {});
    v.x = q.x; v.z = q.z;
    v.yaw = Math.atan2(q.tx, q.tz);
  }

  kill(v) {
    if (!v.alive) return;
    v.alive = false;
    const leg = v.legs[v.li];
    const seg = leg && this.w.net.segs.get(leg.seg);
    if (seg) seg.occ = Math.max(0, seg.occ - 1);
  }

  startTurn(v, seg, leg, nseg, nleg) {
    const a = this.lanePos(seg, v.s, leg.dir, v, {});
    const room = Math.abs(nleg.s1 - nleg.s0);
    const ns = nleg.s0 + nleg.dir * Math.min(JR, room * 0.45);
    const b = this.lanePos(nseg, ns, nleg.dir, v, {});
    // Kontrollpunkt: Schnitt der Tangenten, sonst Mitte
    let cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    const den = a.tx * b.tz - a.tz * b.tx;
    if (Math.abs(den) > 0.15) {
      const u = ((b.x - a.x) * b.tz - (b.z - a.z) * b.tx) / den;
      if (u > 0 && u < 2) { cx = a.x + a.tx * u; cz = a.z + a.tz * u; }
    } else if (a.tx * b.tx + a.tz * b.tz < -0.5) {
      cx += a.tx * 0.35; cz += a.tz * 0.35;
    }
    const len = Math.max(0.08, (Math.hypot(cx - a.x, cz - a.z) + Math.hypot(b.x - cx, b.z - cz)) * 0.95);
    v.turn = { ax: a.x, az: a.z, cx, cz, bx: b.x, bz: b.z, len, u: 0, ns };
  }

  update(dt, speedMult) {
    const w = this.w, net = w.net, sim = this.sim;
    if (!this.lists || this.listDay !== sim.day || this.listVersion !== w.networkVersion) this.buildLists();
    while (sim.dispatch.length) {
      const d = sim.dispatch.shift();
      this.dispatchFire(w.buildings.get(d.from), w.buildings.get(d.to));
    }
    if (speedMult <= 0) return;
    const sdt = Math.min(dt, 0.1) * speedMult;
    const s = sim.stats;
    const transitShare = s.pop > 0 ? Math.min(0.6, s.riders / s.pop) : 0;
    const rate = Math.min(28, 0.3 + s.pop * 0.011 + s.jobs * 0.004) * (1 - transitShare * 0.7);
    if (this.stops && this.stops.length) {
      this.busAcc = (this.busAcc || 0) + this.stopCount * 0.035 * sdt;
      let buses = 0;
      for (const v of this.vehicles) if (v.type === VEH_BUS) buses++;
      while (this.busAcc >= 1) {
        this.busAcc -= 1;
        if (buses >= Math.min(40, this.stopCount * 2)) break;
        const line = this.pickFrom(this.stops);
        const a = this.pickFrom(line), b = this.pickFrom(line);
        if (a === b) continue;
        const legs = this.findRoute(this.anchorOf(a), this.anchorOf(b));
        if (legs) { this.addVehicle(legs, VEH_BUS); buses++; }
      }
    }
    this.spawnAcc = Math.min(6, this.spawnAcc + rate * sdt);
    let budget = 6;
    while (this.spawnAcc >= 1 && budget-- > 0) {
      this.spawnAcc -= 1;
      if (this.vehicles.length < this.maxVehicles) this.spawnTrip();
    }
    const vs = this.vehicles;
    for (let k = 0; k < vs.length; k++) {
      const v = vs[k];
      if (!v.alive) continue;
      if (v.parked) {
        const tb = w.buildings.get(v.target);
        if (!tb || tb.fire <= 0) this.kill(v);
        continue;
      }
      const leg = v.legs[v.li];
      const seg = net.segs.get(leg.seg);
      if (!seg) { v.alive = false; continue; }
      const spec = ROAD_TYPES[seg.type];
      const cong = seg.occ / Math.max(1, spec.capacity * seg.len * 0.5);
      const spd = v.base * spec.speed * clamp(1.25 - cong * 0.55, 0.15, 1);
      if (v.turn) {
        const t = v.turn;
        t.u += (spd * 0.7 * sdt) / t.len;
        if (t.u >= 1) {
          v.turn = null;
          seg.occ = Math.max(0, seg.occ - 1);
          v.li++;
          const nleg = v.legs[v.li];
          const nseg = net.segs.get(nleg.seg);
          if (!nseg) { v.alive = false; continue; }
          nseg.occ++;
          v.s = t.ns;
          this.place(v, nseg, nleg);
        } else {
          const u = t.u, iu = 1 - u;
          v.x = iu * iu * t.ax + 2 * iu * u * t.cx + u * u * t.bx;
          v.z = iu * iu * t.az + 2 * iu * u * t.cz + u * u * t.bz;
          const dx = 2 * iu * (t.cx - t.ax) + 2 * u * (t.bx - t.cx), dz = 2 * iu * (t.cz - t.az) + 2 * u * (t.bz - t.cz);
          if (dx * dx + dz * dz > 1e-8) v.yaw = Math.atan2(dx, dz);
        }
        continue;
      }
      const last = v.li === v.legs.length - 1;
      const room = Math.abs(leg.s1 - leg.s0);
      const target = last ? leg.s1 : leg.s1 - leg.dir * Math.min(JR, room * 0.45);
      v.s += leg.dir * spd * sdt;
      if (leg.dir > 0 ? v.s >= target : v.s <= target) {
        v.s = target;
        if (last) {
          if (v.type === VEH_FIRE && v.target >= 0) { v.parked = true; this.place(v, seg, leg); continue; }
          this.kill(v);
          continue;
        }
        const nleg = v.legs[v.li + 1];
        const nseg = net.segs.get(nleg.seg);
        if (!nseg) { this.kill(v); continue; }
        this.startTurn(v, seg, leg, nseg, nleg);
        continue;
      }
      this.place(v, seg, leg);
    }
    let j = 0;
    for (let k = 0; k < vs.length; k++) if (vs[k].alive) vs[j++] = vs[k];
    vs.length = j;
    // Verkehrsdichte glätten (je Segment und als Feldraster für Lärm/Ansichten)
    this.densAcc += dt;
    if (this.densAcc > 0.5) {
      this.densAcc = 0;
      let sum = 0, cnt = 0;
      for (const sg of net.segs.values()) {
        const v = Math.min(1.5, (sg.occ / Math.max(1, ROAD_TYPES[sg.type].capacity * sg.len * 0.5)) * 2.2);
        sg.density = sg.density * 0.85 + v * 0.15;
        sum += sg.density * sg.len;
        cnt += sg.len;
      }
      const dens = this.density, rs = w.roadSeg;
      for (let i = 0; i < w.n; i++) {
        const id = rs[i];
        dens[i] = id >= 0 ? (net.segs.get(id)?.density || 0) : 0;
      }
      this.congestion = cnt ? Math.min(1, (sum / cnt) * 3) : 0;
    }
  }
}
