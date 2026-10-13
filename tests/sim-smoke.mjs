// Headless-Rauchtest der Simulation: baut eine kleine Stadt und lässt sie wachsen.
// Ausführen: node tests/sim-smoke.mjs
import { World, makeBuilding } from '../src/world.js';
import { Simulation } from '../src/sim.js';
import { Traffic } from '../src/traffic.js';
import { SERVICES, HIGHWAY_LEN } from '../src/config.js';
import { serviceFootprint } from '../src/world.js';

const seed = Number(process.argv[2] || 12345);
const days = Number(process.argv[3] || 1500);
const w = new World(seed);
const sim = new Simulation(w, { cityName: 'Teststadt' });
const traffic = new Traffic(w, sim);

// Kartenvorschau
const S = w.size;
let rows = [];
for (let y = 0; y < S; y += 2) {
  let r = '';
  for (let x = 0; x < S; x += 1) {
    const i = y * S + x;
    r += w.road[i] ? '#' : w.terrain[i] === 1 ? '~' : w.terrain[i] === 2 ? '^' : w.trees[i] ? 't' : '.';
  }
  rows.push(r);
}
if (process.argv.includes('--map')) console.log(rows.join('\n'));

const hy = w.ext.hwY;
const x0 = HIGHWAY_LEN + 1;
// Straßenraster: Hauptachse + Querstraßen
function road(x, y, t = 1) { if (w.canRoad(x, y)) w.setRoad(x, y, t); }
for (let x = x0; x < x0 + 40; x++) road(x, hy);
for (let k = 0; k < 6; k++) {
  const x = x0 + 4 + k * 7;
  for (let y = hy - 20; y <= hy + 20; y++) road(x, y);
}
for (const dy of [-14, -7, 7, 14]) for (let x = x0 + 4; x <= x0 + 39; x++) road(x, hy + dy);
w.updateNetwork();
// Zonen
let zc = 0;
for (let i = 0; i < w.n; i++) {
  if (!w.canZone(i)) continue;
  const x = i % S, y = (i / S) | 0;
  const z = y < hy - 7 ? 1 : y < hy ? (x < x0 + 20 ? 1 : 3) : y < hy + 7 ? 3 : 5;
  w.setZone(x, y, z); zc++;
}
console.log('zoned tiles', zc);

function placeService(def, tx, ty) {
  const fit = w.fitService(def, tx, ty, 0);
  if (!fit || !fit.ok) return false;
  w.addBuilding(makeBuilding({ kind: 'service', def, x: fit.x, y: fit.y, W: fit.W, H: fit.H, dir: fit.dir, name: SERVICES[def].name }));
  return true;
}
// Dienste entlang der Hauptachse, versuche Plätze
function placeNear(def, count) {
  let placed = 0;
  for (let y = hy - 20; y <= hy + 20 && placed < count; y++)
    for (let x = x0; x < x0 + 45 && placed < count; x++) {
      const i = y * S + x; if (w.road[i] || w.bld[i] >= 0) continue;
      if (placeService(def, x, y)) placed++;
    }
  return placed;
}
// Wasserbedarf ohne Ufer: Wassertürme simulieren (Test ignoriert Freischaltung)
console.log('wind', placeNear('wind', 6), 'tower', placeNear('tower', 4));
// Abwasser: schummeln – direkt platzieren ohne Uferprüfung
for (let k = 0; k < 3; k++) {
  for (let y = hy - 20; y <= hy + 20; y++) { let done = false;
    for (let x = x0; x < x0 + 45; x++) {
      const i = y * S + x; if (w.road[i] || w.bld[i] >= 0) continue;
      for (let d = 0; d < 4; d++) { if (w.hasFrontRoad(x, y, 1, 1, d)) { w.addBuilding(makeBuilding({ kind: 'service', def: 'outlet', x, y, W: 1, H: 1, dir: d })); done = true; break; } }
      if (done) break;
    } if (done) break; }
}
w.updateNetwork();
sim.money = 1e6;
let addedServices = false;
const t0 = Date.now();
for (let d = 1; d <= days; d++) {
  sim.tick();
  traffic.update(0.05, 1); traffic.update(0.05, 1);
  if (!addedServices && sim.stats.pop > 300) {
    addedServices = true;
    console.log('services:', ['police', 'fire', 'clinic', 'school', 'landfill', 'park', 'park', 'coal'].map((s) => s + placeNear(s, 1)).join(' '));
  }
  if (d % 100 === 0) {
    const s = sim.stats;
    console.log(`d${d} pop=${s.pop} jobs=${s.jobs} (C${s.jobsC} I${s.jobsI} O${s.jobsO} S${s.jobsS}) wf=${s.workforce.toFixed(0)} unemp=${(s.unemployment*100).toFixed(0)}% ` +
      `dem R${sim.demand.R.toFixed(0)} C${sim.demand.C.toFixed(0)} I${sim.demand.I.toFixed(0)} O${sim.demand.O.toFixed(0)} happy=${s.happiness.toFixed(0)} ` +
      `pow ${s.powerSup}/${s.powerDem.toFixed(1)} wat ${s.waterSup}/${s.waterDem.toFixed(1)} bld=${s.buildings} lv=${s.landValue.toFixed(0)} ms=${sim.milestone} ` +
      `veh=${traffic.vehicles.length} money=${Math.round(sim.money)} net/mo=${sim.lastMonth ? Math.round(sim.lastMonth.totalIncome - sim.lastMonth.totalExpense) : '-'}`);
  }
}
const lv = {};
for (const b of w.buildings.values()) if (b.kind === 'zone') { const k = b.zone + ':' + b.level; lv[k] = (lv[k] || 0) + 1; }
console.log('levels', JSON.stringify(lv));
const ab = [...w.buildings.values()].filter((b) => b.abandoned).length;
console.log('abandoned', ab, 'events', sim.events.length, 'time', Date.now() - t0, 'ms');
console.log(sim.events.slice(-8).map((e) => e.type + ':' + (e.text || e.name || e.key || '')).join('\n'));
