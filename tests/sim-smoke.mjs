// Headless-Test der Simulation: baut eine Teststadt, lässt sie wachsen und prüft Kernfunktionen.
// Ausführen: npm test   (oder: node tests/sim-smoke.mjs [seed] [tage] [--verbose] [--map])
import assert from 'node:assert/strict';
import { World, makeBuilding } from '../src/world.js';
import { Simulation } from '../src/sim.js';
import { Traffic } from '../src/traffic.js';
import { HIGHWAY_LEN, T_WATER } from '../src/config.js';
import { serialize, deserialize } from '../src/save.js';

const seed = Number(process.argv[2] || 12345);
const days = Number(process.argv[3] || 1500);
const verbose = process.argv.includes('--verbose');

const w = new World(seed);
const sim = new Simulation(w, { cityName: 'Teststadt' });
const traffic = new Traffic(w, sim);
const S = w.size;

if (process.argv.includes('--map')) {
  for (let y = 0; y < S; y += 2) {
    let r = '';
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      r += w.road[i] ? '#' : w.terrain[i] === 1 ? '~' : w.terrain[i] === 2 ? '^' : w.trees[i] ? 't' : '.';
    }
    console.log(r);
  }
}

// --- Kartengenerierung
const water = w.terrain.reduce((a, t) => a + (t === T_WATER ? 1 : 0), 0);
assert.ok(water > 200, 'Karte sollte einen Fluss/See enthalten');
assert.equal(w.compOutside.filter(Boolean).length, 1, 'Autobahn muss mit der Außenwelt verbunden sein');

// --- Straßenraster an die Autobahn
const hy = w.ext.hwY;
const x0 = HIGHWAY_LEN + 1;
const road = (x, y, t = 1) => { if (w.inb(x, y) && w.canRoad(x, y) && !w.road[w.idx(x, y)]) w.setRoad(x, y, t); };
w.beginAction();
for (let x = x0; x < x0 + 40; x++) road(x, hy);
for (let k = 0; k < 6; k++) { const x = x0 + 4 + k * 7; for (let y = hy - 20; y <= hy + 20; y++) road(x, y); }
for (const dy of [-14, -7, 7, 14]) for (let x = x0 + 4; x <= x0 + 39; x++) road(x, hy + dy);
w.updateNetwork();
const roadRec = w.endAction();
assert.ok(roadRec && roadRec.tiles.size > 100, 'Straßenbau wird aufgezeichnet');
assert.equal(w.compOutside.filter(Boolean).length, 1, 'Neues Netz hängt an der Autobahn');

// --- Rückgängig und Wiederholen der Straßen
const roadsBefore = w.road.reduce((a, r) => a + (r ? 1 : 0), 0);
w.undo(roadRec);
assert.equal(w.road.reduce((a, r) => a + (r ? 1 : 0), 0), HIGHWAY_LEN + 1, 'Rückgängig entfernt alle neuen Straßen');
for (const [i, v] of roadRec.tiles) if (!v[0]) w.setRoad(i % S, (i / S) | 0, 1);
for (let x = x0; x < x0 + 40; x++) if (w.road[w.idx(x, hy)]) w.road[w.idx(x, hy)] = 1;
w.updateNetwork();
assert.equal(w.road.reduce((a, r) => a + (r ? 1 : 0), 0), roadsBefore, 'Straßen wiederhergestellt');

// --- Zonen
let zc = 0;
for (let i = 0; i < w.n; i++) {
  if (!w.canZone(i)) continue;
  const x = i % S, y = (i / S) | 0;
  const z = y < hy - 7 ? 1 : y < hy ? (x < x0 + 20 ? 1 : 3) : y < hy + 7 ? 3 : 5;
  w.setZone(x, y, z);
  zc++;
}
assert.ok(zc > 800, 'Genug zonenfähige Felder neben den Straßen');

function placeNear(def, count) {
  let placed = 0;
  for (let y = hy - 20; y <= hy + 20 && placed < count; y++) {
    for (let x = x0; x < x0 + 45 && placed < count; x++) {
      const i = y * S + x;
      if (w.road[i] || w.bld[i] >= 0) continue;
      const fit = w.fitService(def, x, y, 0);
      if (!fit || !fit.ok) continue;
      w.addBuilding(makeBuilding({ kind: 'service', def, x: fit.x, y: fit.y, W: fit.W, H: fit.H, dir: fit.dir, name: def }));
      placed++;
    }
  }
  return placed;
}
assert.equal(placeNear('wind', 6), 6, 'Windräder platzierbar');
assert.equal(placeNear('tower', 4), 4, 'Wassertürme platzierbar');
// Abwasser (im Test ohne Uferprüfung)
let sew = 0;
for (let y = hy - 20; y <= hy + 20 && sew < 3; y++) {
  for (let x = x0; x < x0 + 45 && sew < 3; x++) {
    const i = y * S + x;
    if (w.road[i] || w.bld[i] >= 0) continue;
    for (let d = 0; d < 4; d++) {
      if (w.hasFrontRoad(x, y, 1, 1, d)) { w.addBuilding(makeBuilding({ kind: 'service', def: 'outlet', x, y, W: 1, H: 1, dir: d })); sew++; break; }
    }
  }
}
w.updateNetwork();

// --- Simulation
let servicesAdded = false;
const t0 = Date.now();
for (let d = 1; d <= days; d++) {
  sim.tick();
  traffic.update(0.05, 1);
  traffic.update(0.05, 1);
  if (!servicesAdded && sim.stats.pop > 300) {
    servicesAdded = true;
    sim.milestone = Math.max(sim.milestone, 1);
    for (const s of ['coal', 'police', 'fire', 'clinic', 'school', 'landfill', 'park', 'park', 'busdepot', 'busstop', 'busstop', 'busstop']) placeNear(s, 1);
  }
  assert.ok(Number.isFinite(sim.money), `Geld ist eine Zahl (Tag ${d})`);
  if (verbose && d % 100 === 0) {
    const s = sim.stats;
    console.log(`Tag ${d}: Einw. ${s.pop}, Jobs ${s.jobs}, Arbeitslos ${(s.unemployment * 100).toFixed(0)} %, ` +
      `Nachfrage W${sim.demand.R.toFixed(0)} G${sim.demand.C.toFixed(0)} I${sim.demand.I.toFixed(0)}, Zufriedenheit ${s.happiness.toFixed(0)} %, ` +
      `Gebäude ${s.buildings}, Fahrzeuge ${traffic.vehicles.length}, Kasse ${Math.round(sim.money)} €`);
  }
}
const ms = (Date.now() - t0) / days;
const s = sim.stats;
assert.ok(s.pop > 800, `Stadt wächst (Einwohner: ${s.pop})`);
assert.ok(s.jobs > 300, 'Arbeitsplätze entstehen');
assert.ok(sim.milestone >= 2, 'Meilensteine werden erreicht');
assert.ok(sim.history.length > 12, 'Monatsabschlüsse werden protokolliert');
assert.ok(traffic.vehicles.length > 20, 'Es fährt Verkehr');
assert.ok(s.riders > 0, 'Busse werden genutzt');
let levels = 0;
for (const b of w.buildings.values()) if (b.kind === 'zone' && b.level > 1) levels++;
assert.ok(levels > 5, 'Gebäude steigen Stufen auf');
assert.ok(ms < 20, `Simulationstick schnell genug (${ms.toFixed(2)} ms)`);

// --- Speichern und Laden
const fakeGame = { world: w, sim, camera: { toJSON: () => null }, clock: 12 };
const data = JSON.parse(JSON.stringify(serialize(fakeGame)));
const loaded = deserialize(data);
assert.equal(loaded.world.buildings.size, w.buildings.size, 'Gebäudeanzahl nach Laden gleich');
assert.equal(Math.round(loaded.sim.money), Math.round(sim.money), 'Kontostand nach Laden gleich');
assert.deepEqual(Array.from(loaded.world.road), Array.from(w.road), 'Straßen nach Laden gleich');
assert.deepEqual(Array.from(loaded.world.zone), Array.from(w.zone), 'Zonen nach Laden gleich');
loaded.sim.tick();

console.log(`✔ Alle Prüfungen bestanden – ${s.pop} Einwohner, ${s.buildings} Gebäude, ${levels} aufgewertet, ` +
  `${traffic.vehicles.length} Fahrzeuge, ${ms.toFixed(2)} ms/Tag, Spielstand ${(JSON.stringify(data).length / 1024).toFixed(0)} KB`);
