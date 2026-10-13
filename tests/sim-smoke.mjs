// Headless-Test der Simulation: baut eine organische Teststadt, lässt sie wachsen und prüft Kernfunktionen.
// Ausführen: npm test   (oder: node tests/sim-smoke.mjs [seed] [tage] [--verbose])
import assert from 'node:assert/strict';
import { World, makeBuilding } from '../src/world.js';
import { Simulation } from '../src/sim.js';
import { Traffic } from '../src/traffic.js';
import { SERVICES, T_WATER } from '../src/config.js';
import { smoothChain, simplify } from '../src/geom.js';
import { serialize, deserialize } from '../src/save.js';

const seed = Number(process.argv[2] || 12345);
const days = Number(process.argv[3] || 1500);
const verbose = process.argv.includes('--verbose');

const w = new World(seed);
const sim = new Simulation(w, { cityName: 'Teststadt' });
const traffic = new Traffic(w, sim);

// --- Kartengenerierung
const water = w.terrain.reduce((a, t) => a + (t === T_WATER ? 1 : 0), 0);
assert.ok(water > 200, 'Karte sollte einen Fluss/See enthalten');
assert.equal(w.net.compOutside.filter(Boolean).length, 1, 'Autobahn muss mit der Außenwelt verbunden sein');

const hx = w.highway.x1, hz = w.highway.z;
const road = (chain, type = 1) => {
  const plan = w.planRoad(chain, type);
  if (plan.ok) w.buildRoad(plan);
  return plan;
};
const straight = (x0, z0, x1, z1) => [{ p0: [x0, z0], c: [(x0 + x1) / 2, (z0 + z1) / 2], p2: [x1, z1] }];

// --- Organisches Straßennetz: geschwungene Hauptstraße mit Querstraßen
w.beginAction();
let plan = road([{ p0: [hx, hz], c: [hx + 14, hz - 8], p2: [hx + 30, hz] }], 2);
assert.ok(plan.ok, 'Geschwungene Allee baubar: ' + plan.reason);
const undoRec = w.endAction();
assert.ok(undoRec, 'Straßenbau wird aufgezeichnet');
const segsAfter = w.net.segs.size;
w.undo(undoRec);
assert.equal(w.net.segs.size, 1, 'Rückgängig entfernt die neue Straße');
road([{ p0: [hx, hz], c: [hx + 14, hz - 8], p2: [hx + 30, hz] }], 2);
assert.equal(w.net.segs.size, segsAfter, 'Straße wiederhergestellt');

// Querstraßen (kreuzen die Allee)
for (let k = 0; k < 5; k++) {
  const x = hx + 4 + k * 5.5;
  const p = road([{ p0: [x - 2, hz - 16], c: [x + 1.5, hz - 4], p2: [x - 1, hz + 12] }]);
  assert.ok(p.ok, `Querstraße ${k} baubar: ${p.reason}`);
}
// Freihand-Ringstraße
const ring = [];
for (let a = Math.PI * 0.15; a <= Math.PI * 0.85; a += 0.08) ring.push([hx + 16 + Math.cos(a) * 15, hz + 2 + Math.sin(a) * 7]);
plan = road(smoothChain(simplify(ring, 0.25)));
assert.ok(plan.ok, 'Freihand-Ring baubar: ' + plan.reason);
// Zu nah an bestehender Straße
plan = road(straight(hx + 6, hz - 22, hx + 18, hz - 22));
assert.ok(plan.ok, 'Gerade Straße baubar: ' + plan.reason);
assert.equal(w.planRoad(straight(hx + 8, hz - 21.3, hx + 16, hz - 21.25), 1).ok, false, 'Paralleles Überlappen wird abgelehnt');
w.updateNetwork();
let junctions = 0;
for (const n of w.net.nodes.values()) if (n.segs.length >= 3) junctions++;
assert.ok(junctions >= 5, `Kreuzungen entstehen (${junctions})`);
assert.equal(w.net.compOutside.filter(Boolean).length, 1, 'Netz hängt an der Autobahn');
assert.ok(w.cells.length > 500, `Zonenzellen entlang der Straßen (${w.cells.length})`);

// --- Dienste frei an Straßen platzieren
function placeService(def, count = 1) {
  let placed = 0;
  const segs = [...w.net.segs.values()].filter((s) => s.type !== 3);
  for (const s of segs) {
    for (let a = 1; a < s.len - 1 && placed < count; a += 1.3) {
      const p = w.net.at(s, a);
      for (const side of [1, -1]) {
        const fit = w.fitService(def, p.x - p.tz * side * 2, p.z + p.tx * side * 2);
        if (!fit.ok || fit.demolish.length) continue;
        w.addBuilding(makeBuilding({ kind: 'service', def, cx: fit.cx, cz: fit.cz, rot: fit.rot, w: fit.w, d: fit.d, name: SERVICES[def].name }));
        w.updateNetwork();
        placed++;
        break;
      }
    }
    if (placed >= count) break;
  }
  return placed;
}
for (const [def, n] of [['wind', 6], ['tower', 4], ['coal', 1], ['police', 1], ['fire', 1], ['clinic', 1], ['school', 1],
  ['landfill', 1], ['park', 2], ['busdepot', 1], ['busstop', 3]]) {
  assert.equal(placeService(def, n), n, `${def} platzierbar`);
}
// Abwasser (im Test ohne Uferprüfung): Wassertürme ersetzen Pumpen, Auslass direkt
for (let k = 0; k < 3; k++) {
  const s = [...w.net.segs.values()].find((q) => q.type === 1 && q.len > 4 + k);
  const p = w.net.at(s, 1.5 + k);
  const rect = { cx: p.x - p.tz * (s.hw + 0.56), cz: p.z + p.tx * (s.hw + 0.56), rot: Math.atan2(p.tz, -p.tx), w: 1, d: 1 };
  if (!w.rectHitsRoad(rect, -0.05)) w.addBuilding(makeBuilding({ kind: 'service', def: 'outlet', ...rect }));
}
w.updateNetwork();
const services = [...w.buildings.values()].filter((b) => b.kind === 'service');
assert.ok(services.every((b) => b.seg >= 0), 'Alle Dienste haben Straßenanschluss');
assert.ok(services.some((b) => Math.abs(Math.sin(b.rot)) > 0.15), 'Dienste sind entlang schräger Straßen gedreht');

// --- Zonen auf Zellen
let zc = 0;
for (const c of w.cells) {
  const s = w.net.segs.get(c.seg);
  const mid = w.net.at(s, c.sArc);
  const z = c.side > 0 ? (mid.x > hx + 26 ? 3 : 1) : (mid.x > hx + 20 ? 5 : mid.x < hx + 8 ? 3 : 1);
  if (w.setCellZone(c, z)) zc++;
}
assert.ok(zc > 400, `Zellen zoniert (${zc})`);

// --- Simulation
const t0 = Date.now();
let maxRiders = 0;
for (let d = 1; d <= days; d++) {
  sim.tick();
  maxRiders = Math.max(maxRiders, sim.stats.riders);
  traffic.update(0.05, 1);
  traffic.update(0.05, 1);
  assert.ok(Number.isFinite(sim.money), `Geld ist eine Zahl (Tag ${d})`);
  if (verbose && d % 100 === 0) {
    const st = sim.stats;
    console.log(`Tag ${d}: Einw. ${st.pop}, Jobs ${st.jobs}, Arbeitslos ${(st.unemployment * 100).toFixed(0)} %, ` +
      `Nachfrage W${sim.demand.R.toFixed(0)} G${sim.demand.C.toFixed(0)} I${sim.demand.I.toFixed(0)}, Zufriedenheit ${st.happiness.toFixed(0)} %, ` +
      `Gebäude ${st.buildings}, Fahrzeuge ${traffic.vehicles.length}, Kasse ${Math.round(sim.money)} €`);
  }
}
const ms = (Date.now() - t0) / days;
const st = sim.stats;
assert.ok(st.pop > 1000, `Stadt wächst (Einwohner: ${st.pop})`);
assert.ok(st.jobs > 200, 'Arbeitsplätze entstehen');
assert.ok(sim.milestone >= 1, 'Meilensteine werden erreicht');
assert.ok(traffic.vehicles.length > 20, `Es fährt Verkehr (${traffic.vehicles.length})`);
assert.ok(maxRiders > 0, 'Busse werden genutzt');
const zoneB = [...w.buildings.values()].filter((b) => b.kind === 'zone');
const rotated = zoneB.filter((b) => Math.abs(Math.sin(b.rot * 2)) > 0.2).length;
assert.ok(rotated > zoneB.length * 0.2, `Gebäude folgen den geschwungenen Straßen (${rotated}/${zoneB.length} schräg)`);
let levels = 0;
for (const b of zoneB) if (b.level > 1) levels++;
assert.ok(levels > 3, 'Gebäude steigen Stufen auf');
assert.ok(ms < 20, `Simulationstick schnell genug (${ms.toFixed(2)} ms)`);
// Keine Überlappung von Wachstumsgebäuden mit Straßen
for (const b of zoneB) assert.ok(!w.rectHitsRoad(w.rectOf(b), -0.12), `Gebäude ${b.id} überdeckt keine Straße`);

// --- Speichern und Laden
const fakeGame = { world: w, sim, camera: { toJSON: () => null }, clock: 12 };
const data = JSON.parse(JSON.stringify(serialize(fakeGame)));
const loaded = deserialize(data);
assert.equal(loaded.world.buildings.size, w.buildings.size, 'Gebäudeanzahl nach Laden gleich');
assert.equal(loaded.world.net.segs.size, w.net.segs.size, 'Straßensegmente nach Laden gleich');
assert.equal(loaded.world.cells.length, w.cells.length, 'Zonenzellen nach Laden gleich');
assert.equal(Math.round(loaded.sim.money), Math.round(sim.money), 'Kontostand nach Laden gleich');
loaded.sim.tick();

console.log(`✔ Alle Prüfungen bestanden – ${st.pop} Einwohner, ${st.buildings} Gebäude (${rotated} schräg), ${levels} aufgewertet, ` +
  `${w.net.segs.size} Straßensegmente, ${junctions} Kreuzungen, ${traffic.vehicles.length} Fahrzeuge, ${ms.toFixed(2)} ms/Tag, ` +
  `Spielstand ${(JSON.stringify(data).length / 1024).toFixed(0)} KB`);
