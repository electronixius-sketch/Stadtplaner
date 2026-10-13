// Speichern und Laden im localStorage (kompakt per Lauflängenkodierung).
import { rleEncode, rleDecode } from './util.js';
import { World, makeBuilding } from './world.js';
import { Simulation } from './sim.js';

const KEY = 'stadtplaner.save.v1';
const VERSION = 2;

const BFIELDS = ['id', 'kind', 'zone', 'def', 'cx', 'cz', 'rot', 'w', 'd', 'level', 'seed', 'cap', 'occ', 'built',
  'happy', 'unhappyDays', 'abandoned', 'abandonedDays', 'edu', 'name', 'age'];
const BFIELDS_V1 = ['id', 'kind', 'zone', 'def', 'x', 'y', 'W', 'H', 'dir', 'lw', 'ld', 'level', 'seed', 'cap', 'occ', 'built',
  'happy', 'unhappyDays', 'abandoned', 'abandonedDays', 'edu', 'name', 'age'];

export function serialize(game) {
  const w = game.world, sim = game.sim;
  const buildings = [];
  for (const b of w.buildings.values()) {
    buildings.push(BFIELDS.map((k) => {
      const v = b[k];
      if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 1000) / 1000;
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    }));
  }
  return {
    v: VERSION,
    seed: w.seed,
    savedAt: Date.now(),
    net: w.net.toJSON(),
    zoneR: rleEncode(w.zoneR),
    trees: rleEncode(w.trees),
    nextId: w.nextId,
    buildings,
    sim: sim.toJSON(),
    camera: game.camera.toJSON(),
    clock: game.clock,
  };
}

export function deserialize(data) {
  if (!data || (data.v !== VERSION && data.v !== 1)) throw new Error('Unbekanntes Spielstandformat');
  const w = new World(data.seed);
  if (data.v === 1) convertV1(w, data);
  else {
    w.net.load(data.net);
    w.rebuildChunkIndex();
    rleDecode(data.zoneR, w.zoneR);
    rleDecode(data.trees, w.trees);
    for (const arr of data.buildings) {
      const o = {};
      BFIELDS.forEach((k, i) => { o[k] = arr[i]; });
      o.abandoned = !!o.abandoned;
      w.addBuilding(makeBuilding(o));
    }
  }
  w.treesVersion++;
  w.nextId = Math.max(w.nextId, data.nextId || 1);
  w.updateNetwork();
  w.markAllDirty();
  const sim = new Simulation(w, { cityName: data.sim.cityName });
  sim.fromJSON(data.sim);
  return { world: w, sim, camera: data.camera, clock: data.clock };
}

// Alte, rasterbasierte Spielstände in das Vektor-Straßennetz übertragen
function convertV1(w, data) {
  const S = w.size;
  const road = new Uint8Array(w.n), zone = new Uint8Array(w.n);
  rleDecode(data.road, road);
  rleDecode(data.zone, zone);
  rleDecode(data.trees, w.trees);
  const net = w.net;
  net.load({ nodes: [], segs: [] });
  const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const isRoad = (x, y) => x >= 0 && y >= 0 && x < S && y < S && road[y * S + x] > 0;
  const nodeAt = new Map();
  const isJunction = (x, y) => {
    const t = road[y * S + x];
    const nb = D.map(([dx, dy]) => isRoad(x + dx, y + dy));
    const deg = nb.filter(Boolean).length + (x === 0 ? 1 : 0);
    if (deg !== 2 || x === 0) return true;
    if (!((nb[0] && nb[2]) || (nb[1] && nb[3]))) return true;
    return D.some(([dx, dy]) => isRoad(x + dx, y + dy) && road[(y + dy) * S + x + dx] !== t);
  };
  const getNode = (x, y) => {
    const k = y * S + x;
    if (!nodeAt.has(k)) nodeAt.set(k, net.addNode(x === 0 ? 0 : x + 0.5, y + 0.5, 0, x === 0 && road[k] === 3));
    return nodeAt.get(k);
  };
  const done = new Set();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!road[y * S + x] || !isJunction(x, y)) continue;
      const a = getNode(x, y);
      for (const [dx, dy] of D) {
        let cx = x + dx, cy = y + dy;
        if (!isRoad(cx, cy)) continue;
        const key = [y * S + x, cy * S + cx].sort((p, q) => p - q).join('-');
        if (done.has(key)) continue;
        done.add(key);
        while (!isJunction(cx, cy)) { cx += dx; cy += dy; }
        const b = getNode(cx, cy);
        if (a === b) continue;
        net.addSeg(a.id, b.id, road[y * S + x + dx + dy * S] || road[y * S + x], (a.x + b.x) / 2, (a.z + b.z) / 2);
      }
    }
  }
  w.rebuildChunkIndex();
  for (let i = 0; i < w.n; i++) {
    if (!zone[i]) continue;
    const x = i % S, y = (i / S) | 0, R = S * 2;
    for (let pz = 0; pz < 2; pz++) for (let px = 0; px < 2; px++) w.zoneR[(y * 2 + pz) * R + x * 2 + px] = zone[i];
  }
  for (const arr of data.buildings) {
    const o = {};
    BFIELDS_V1.forEach((k, i) => { o[k] = arr[i]; });
    const f = D[o.dir || 0];
    const rot = Math.atan2(f[0], -f[1]);
    const ns = o.dir === 0 || o.dir === 2;
    w.addBuilding(makeBuilding({
      id: o.id, kind: o.kind, zone: o.zone, def: o.def, cx: o.x + o.W / 2, cz: o.y + o.H / 2, rot,
      w: ns ? o.W : o.H, d: ns ? o.H : o.W, level: o.level, seed: o.seed, cap: o.cap, occ: o.occ, built: o.built,
      happy: o.happy, unhappyDays: o.unhappyDays, abandoned: !!o.abandoned, abandonedDays: o.abandonedDays, edu: o.edu,
      name: o.name, age: o.age,
    }));
  }
}

export function saveToStorage(game) {
  try {
    const data = serialize(game);
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', e);
    return false;
  }
}

export function loadFromStorage() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    return deserialize(JSON.parse(s));
  } catch (e) {
    console.warn('Laden fehlgeschlagen', e);
    return null;
  }
}

export function saveInfo() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const d = JSON.parse(s);
    return { name: d.sim.cityName, savedAt: d.savedAt, day: d.sim.day, money: d.sim.money, pop: d.sim.pop ?? 0 };
  } catch (_) {
    return null;
  }
}

export function exportFile(game) {
  const blob = new Blob([JSON.stringify(serialize(game))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${game.sim.cityName.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.stadt.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (_) { /* egal */ }
}
