// Verkehr: Fahrten zwischen Gebäuden, A*-Wegfindung über Straßenfelder und Stau-Dichte.
import { ROAD_TYPES, DIRS, ZONES, SERVICES } from './config.js';
import { clamp } from './util.js';

class MinHeap {
  constructor(cap) {
    this.nodes = new Int32Array(cap);
    this.prio = new Float32Array(cap);
    this.size = 0;
  }
  clear() { this.size = 0; }
  push(node, p) {
    if (this.size >= this.nodes.length) {
      const nn = new Int32Array(this.nodes.length * 2); nn.set(this.nodes); this.nodes = nn;
      const np = new Float32Array(this.prio.length * 2); np.set(this.prio); this.prio = np;
    }
    let i = this.size++;
    const N = this.nodes, P = this.prio;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (P[parent] <= p) break;
      N[i] = N[parent]; P[i] = P[parent];
      i = parent;
    }
    N[i] = node; P[i] = p;
  }
  pop() {
    const N = this.nodes, P = this.prio;
    const top = N[0];
    const n = --this.size;
    if (n > 0) {
      const node = N[n], p = P[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && P[c + 1] < P[c]) c++;
        if (P[c] >= p) break;
        N[i] = N[c]; P[i] = P[c];
        i = c;
      }
      N[i] = node; P[i] = p;
    }
    return top;
  }
}

export const VEH_CAR = 0, VEH_TRUCK = 1, VEH_FIRE = 2, VEH_BUS = 3;

export class Traffic {
  constructor(world, sim) {
    this.w = world;
    this.sim = sim;
    sim.traffic = this;
    const n = world.n;
    this.vehicles = [];
    this.occ = new Float32Array(n);
    this.density = new Float32Array(n);
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 1;
    this.heap = new MinHeap(4096);
    this.spawnAcc = 0;
    this.densAcc = 0;
    this.maxVehicles = 350;
    this.lists = null;
    this.listDay = -1;
    this.listVersion = -1;
    this.congestion = 0;
    this.rand = Math.random;
  }

  reset() {
    this.vehicles.length = 0;
    this.occ.fill(0);
    this.density.fill(0);
    this.lists = null;
  }

  buildLists() {
    const w = this.w;
    const byComp = new Map();
    const get = (c) => {
      let o = byComp.get(c);
      if (!o) { o = { res: [], work: [], com: [], ind: [], all: [] }; byComp.set(c, o); }
      return o;
    };
    const res = [], ind = [];
    for (const b of w.buildings.values()) {
      if (b.access < 0 || b.comp < 0 || b.built < 1 || b.abandoned) continue;
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
    // Aktive Haltestellen je Straßennetz (nur mit Busdepot)
    const stops = new Map();
    const depots = this.sim.depotComps || new Set();
    for (const b of w.buildings.values()) {
      if (b.kind !== 'service' || b.def !== 'busstop' || b.access < 0 || !depots.has(b.comp)) continue;
      if (!stops.has(b.comp)) stops.set(b.comp, []);
      stops.get(b.comp).push(b);
    }
    this.stops = [...stops.values()].filter((a) => a.length >= 2);
    this.stopCount = this.stops.reduce((s, a) => s + a.length, 0);
    const outside = [];
    for (const o of w.outside) {
      const i = w.idx(o.x, o.y);
      if (w.road[i]) outside.push({ tile: i, comp: w.comp[i] });
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
    let from = -1, to = -1, type = VEH_CAR;
    if (r < 0.72 && L.res.length) {
      const b = this.pickFrom(L.res);
      const C = L.byComp.get(b.comp);
      const dest = r < 0.5 ? C.work : C.com;
      if (dest.length) { from = b.access; to = this.pickFrom(dest).access; }
      else if (L.outside.length) {
        const o = L.outside.find((o) => o.comp === b.comp);
        if (o) { from = b.access; to = o.tile; }
      }
      if (this.rand() < 0.5) { const t = from; from = to; to = t; }
    } else if (r < 0.88 && L.ind.length) {
      const b = this.pickFrom(L.ind);
      const C = L.byComp.get(b.comp);
      type = VEH_TRUCK;
      const o = L.outside.find((o) => o.comp === b.comp);
      if (C.com.length && (this.rand() < 0.6 || !o)) { from = b.access; to = this.pickFrom(C.com).access; }
      else if (o) { from = b.access; to = o.tile; if (this.rand() < 0.5) { from = o.tile; to = b.access; } }
    } else if (L.outside.length) {
      const o = this.pickFrom(L.outside);
      const C = L.byComp.get(o.comp);
      if (C && C.all.length) {
        const b = this.pickFrom(C.all);
        from = o.tile; to = b.access;
        if (this.rand() < 0.5) { from = b.access; to = o.tile; }
        if (this.rand() < 0.25) type = VEH_TRUCK;
      }
    }
    if (from < 0 || to < 0 || from === to) return;
    const path = this.findPath(from, to);
    if (path) this.addVehicle(path, type);
  }

  dispatchFire(fromB, toB) {
    if (!fromB || !toB || fromB.access < 0 || toB.access < 0) return;
    const path = this.findPath(fromB.access, toB.access);
    if (path) this.addVehicle(path, VEH_FIRE, { target: toB.id });
  }

  addVehicle(path, type, extra = null) {
    const v = {
      path, i: 0, s: 0, type,
      color: Math.floor(this.rand() * 1000),
      laneSel: this.rand() < 0.5 ? 0 : 1,
      base: type === VEH_FIRE ? 2.6 : type === VEH_TRUCK || type === VEH_BUS ? 1.2 : 1.55 + this.rand() * 0.35,
      p0x: 0, p0z: 0, p1x: 0, p1z: 0, p2x: 0, p2z: 0, len: 1, turn: false,
      x: 0, z: 0, yaw: 0, alive: true, parked: false, target: -1,
    };
    if (extra) Object.assign(v, extra);
    this.occ[path[0]] += 1;
    this.segment(v);
    this.pose(v);
    this.vehicles.push(v);
  }

  laneOffset(type, v) {
    if (type === 1) return 0.17;
    if (type === 2) return v.laneSel ? 0.34 : 0.21;
    return v.laneSel ? 0.31 : 0.15;
  }

  segment(v) {
    const S = this.w.size, p = v.path, i = v.i;
    const cur = p[i];
    const cx = (cur % S) + 0.5, cz = ((cur / S) | 0) + 0.5;
    let dix, diz, dox, doz;
    if (i > 0) { const pr = p[i - 1]; dix = cx - ((pr % S) + 0.5); diz = cz - (((pr / S) | 0) + 0.5); }
    if (i < p.length - 1) { const nx = p[i + 1]; dox = ((nx % S) + 0.5) - cx; doz = (((nx / S) | 0) + 0.5) - cz; }
    if (dix === undefined) { dix = dox ?? 1; diz = doz ?? 0; }
    if (dox === undefined) { dox = dix; doz = diz; }
    const lane = this.laneOffset(this.w.road[cur] || 1, v);
    // rechts von Richtung (dx,dz) ist (-dz, dx)
    v.p0x = cx - dix * 0.5 - diz * lane; v.p0z = cz - diz * 0.5 + dix * lane;
    v.p2x = cx + dox * 0.5 - doz * lane; v.p2z = cz + doz * 0.5 + dox * lane;
    if (dix === dox && diz === doz) {
      v.p1x = (v.p0x + v.p2x) / 2; v.p1z = (v.p0z + v.p2z) / 2; v.turn = false;
    } else if (dix === -dox && diz === -doz) {
      v.p1x = cx + dix * 0.35; v.p1z = cz + diz * 0.35; v.turn = true;
    } else {
      v.p1x = cx - diz * lane - doz * lane; v.p1z = cz + dix * lane + dox * lane; v.turn = true;
    }
    const a = Math.hypot(v.p1x - v.p0x, v.p1z - v.p0z), b = Math.hypot(v.p2x - v.p1x, v.p2z - v.p1z);
    v.len = Math.max(0.05, (a + b) * (v.turn ? 0.92 : 1));
  }

  pose(v) {
    const t = v.s, u = 1 - t;
    v.x = u * u * v.p0x + 2 * u * t * v.p1x + t * t * v.p2x;
    v.z = u * u * v.p0z + 2 * u * t * v.p1z + t * t * v.p2z;
    const tx = 2 * u * (v.p1x - v.p0x) + 2 * t * (v.p2x - v.p1x);
    const tz = 2 * u * (v.p1z - v.p0z) + 2 * t * (v.p2z - v.p1z);
    if (tx * tx + tz * tz > 1e-8) v.yaw = Math.atan2(tx, tz);
  }

  kill(v) {
    if (!v.alive) return;
    v.alive = false;
    const t = v.path[v.i];
    if (t !== undefined) this.occ[t] = Math.max(0, this.occ[t] - 1);
  }

  update(dt, speedMult) {
    const w = this.w, road = w.road, sim = this.sim;
    if (!this.lists || this.listDay !== sim.day || this.listVersion !== w.networkVersion) this.buildLists();
    // Feuerwehr-Einsätze
    while (sim.dispatch.length) {
      const d = sim.dispatch.shift();
      this.dispatchFire(w.buildings.get(d.from), w.buildings.get(d.to));
    }
    if (speedMult <= 0) return;
    const sdt = Math.min(dt, 0.1) * speedMult;
    const s = sim.stats;
    const transitShare = s.pop > 0 ? Math.min(0.6, s.riders / s.pop) : 0;
    const rate = Math.min(28, 0.3 + s.pop * 0.011 + s.jobs * 0.004) * (1 - transitShare * 0.7);
    // Busse zwischen Haltestellen
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
        const path = this.findPath(a.access, b.access);
        if (path) { this.addVehicle(path, VEH_BUS); buses++; }
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
        // Löschfahrzeug bleibt, bis das Feuer aus ist
        const tb = w.buildings.get(v.target);
        if (!tb || tb.fire <= 0) this.kill(v);
        continue;
      }
      let tile = v.path[v.i];
      const rt = road[tile];
      if (!rt) { this.kill(v); continue; }
      const spec = ROAD_TYPES[rt];
      const cong = this.occ[tile] / spec.capacity;
      const spd = v.base * spec.speed * clamp(1.25 - cong * 0.55, 0.15, 1) * (v.turn ? 0.7 : 1);
      v.s += (spd * sdt) / v.len;
      while (v.s >= 1 && v.alive) {
        const prevLen = v.len;
        v.s -= 1;
        this.occ[tile] = Math.max(0, this.occ[tile] - 1);
        v.i++;
        if (v.i >= v.path.length) {
          if (v.type === VEH_FIRE && v.target >= 0) {
            v.i = v.path.length - 1; v.s = 0.92; v.parked = true;
            this.occ[v.path[v.i]] += 1;
            break;
          }
          v.alive = false;
          break;
        }
        tile = v.path[v.i];
        if (!road[tile]) { v.alive = false; break; }
        this.occ[tile] += 1;
        this.segment(v);
        v.s = Math.min(0.99, (v.s * prevLen) / v.len);
      }
      if (v.alive) this.pose(v);
    }
    // Tote Fahrzeuge entfernen
    let j = 0;
    for (let k = 0; k < vs.length; k++) if (vs[k].alive) vs[j++] = vs[k];
    vs.length = j;
    // Verkehrsdichte glätten
    this.densAcc += dt;
    if (this.densAcc > 0.5) {
      this.densAcc = 0;
      const occ = this.occ, dens = this.density;
      let sum = 0, cnt = 0;
      for (let i = 0; i < w.n; i++) {
        const t = road[i];
        if (!t) { dens[i] = 0; continue; }
        const v = Math.min(1.5, occ[i] / ROAD_TYPES[t].capacity * 2.2);
        dens[i] = dens[i] * 0.85 + v * 0.15;
        sum += dens[i]; cnt++;
      }
      this.congestion = cnt ? Math.min(1, (sum / cnt) * 3) : 0;
    }
  }

  findPath(start, goal) {
    const w = this.w, S = w.size, road = w.road;
    if (start === goal || !road[start] || !road[goal]) return null;
    if (w.comp[start] !== w.comp[goal]) return null;
    if (++this.gen > 4e9) { this.gen = 1; this.stamp.fill(0); this.closed.fill(0); }
    const gen = this.gen, g = this.g, came = this.came, stamp = this.stamp, closed = this.closed, heap = this.heap;
    const dens = this.density;
    heap.clear();
    const gx = goal % S, gy = (goal / S) | 0;
    g[start] = 0; stamp[start] = gen; came[start] = -1;
    heap.push(start, 0);
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) {
        const out = [];
        for (let c = goal; c !== -1; c = came[c]) out.push(c);
        out.reverse();
        return Int32Array.from(out);
      }
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (++expanded > 9000) return null;
      const cx = cur % S, cy = (cur / S) | 0, gc = g[cur];
      for (let d = 0; d < 4; d++) {
        const nx = cx + DIRS[d].dx, ny = cy + DIRS[d].dy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const nb = ny * S + nx;
        const rt = road[nb];
        if (!rt || closed[nb] === gen) continue;
        const ng = gc + (1 / ROAD_TYPES[rt].speed) * (1 + dens[nb] * 1.5);
        if (stamp[nb] !== gen || ng < g[nb]) {
          stamp[nb] = gen; g[nb] = ng; came[nb] = cur;
          heap.push(nb, ng + (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.47);
        }
      }
    }
    return null;
  }
}
