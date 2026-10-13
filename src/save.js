// Speichern und Laden im localStorage (kompakt per Lauflängenkodierung).
import { rleEncode, rleDecode } from './util.js';
import { World, makeBuilding } from './world.js';
import { Simulation } from './sim.js';

const KEY = 'stadtplaner.save.v1';
const VERSION = 1;

const BFIELDS = ['id', 'kind', 'zone', 'def', 'x', 'y', 'W', 'H', 'dir', 'lw', 'ld', 'level', 'seed', 'cap', 'occ', 'built',
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
    road: rleEncode(w.road),
    zone: rleEncode(w.zone),
    trees: rleEncode(w.trees),
    nextId: w.nextId,
    buildings,
    sim: sim.toJSON(),
    camera: game.camera.toJSON(),
    clock: game.clock,
  };
}

export function deserialize(data) {
  if (!data || data.v !== VERSION) throw new Error('Unbekanntes Spielstandformat');
  const w = new World(data.seed);
  w.road.fill(0);
  rleDecode(data.road, w.road);
  rleDecode(data.zone, w.zone);
  rleDecode(data.trees, w.trees);
  for (const arr of data.buildings) {
    const o = {};
    BFIELDS.forEach((k, i) => { o[k] = arr[i]; });
    o.abandoned = !!o.abandoned;
    const b = makeBuilding(o);
    w.addBuilding(b);
  }
  w.nextId = Math.max(w.nextId, data.nextId || 1);
  w.updateNetwork();
  const sim = new Simulation(w, { cityName: data.sim.cityName });
  sim.fromJSON(data.sim);
  return { world: w, sim, camera: data.camera, clock: data.clock };
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
