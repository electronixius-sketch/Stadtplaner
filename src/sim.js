// Stadtsimulation: Versorgung, Dienste, Umwelt, Bevölkerung, Nachfrage, Wachstum, Brände und Finanzen.
import {
  ZONES, SERVICES, CAPACITY, ZONE_DEPTH, LOTS, UTIL_USE, TAX_YIELD, MILESTONES, COVERAGE_TYPES, START_MONEY,
  START_YEAR, ROAD_TYPES, T_LAND,
} from './config.js';
import { mulberry32, clamp, hash2, weightedPick, shuffle } from './util.js';
import { rectsOverlap, wrapAngle } from './geom.js';
import { makeBuilding } from './world.js';
import { buildingName, chirpText, handle } from './names.js';

const LEVEL_SCORE = [0, 36, 48, 60, 72];

function emptyLedger() {
  return {
    income: { R: 0, C: 0, I: 0, O: 0, T: 0 },
    expense: { roads: 0, power: 0, water: 0, garbage: 0, police: 0, fire: 0, health: 0, edu: 0, parks: 0, transport: 0 },
  };
}

export class Simulation {
  constructor(world, opts = {}) {
    this.w = world;
    this.cityName = opts.cityName || 'Neustadt';
    this.money = START_MONEY;
    this.day = 0;
    this.taxes = { R: 9, C: 9, I: 9, O: 9 };
    this.demand = { R: 60, C: 30, I: 40, O: 0 };
    this.milestone = 0;
    this.stats = {
      pop: 0, workforce: 0, employed: 0, jobs: 0, jobsC: 0, jobsI: 0, jobsO: 0, jobsS: 0, commuters: 0,
      unemployment: 0, happiness: 60, landValue: 20, eduWorkers: 0, eduAvg: 0,
      powerSup: 0, powerDem: 0, waterSup: 0, waterDem: 0, sewSup: 0, sewDem: 0,
      buildings: 0, crime: 0, pollution: 0, health: 0, zones: { R: 0, C: 0, I: 0, O: 0 }, riders: 0,
    };
    this.month = emptyLedger();
    this.lastMonth = null;
    this.history = [];
    this.events = [];
    this.flags = {};
    this.cooldown = {};
    this.tasks = {};
    this.rng = mulberry32((world.seed ^ 0x9e3779b9) >>> 0);
    const n = world.n;
    this.cov = {};
    for (const t of COVERAGE_TYPES) this.cov[t] = new Float32Array(n);
    this.pollution = new Float32Array(n);
    this.noise = new Float32Array(n);
    this.landValue = new Float32Array(n).fill(20);
    this.crime = new Float32Array(n);
    this.traffic = null;
    this.covDirty = true;
    this.fireStations = [];
    this.dispatch = [];
    this.cityHall = false;
    this.dailyNet = 0;
  }

  get date() { return new Date(START_YEAR, 0, 1 + this.day); }
  unlocked(level) { return this.milestone >= level; }

  emit(ev) {
    this.events.push(Object.assign({ day: this.day }, ev));
    if (this.events.length > 60) this.events.shift();
  }

  chirp(type, ctx = {}, cooldown = 30) {
    if ((this.cooldown[type] || -1e9) > this.day - cooldown) return;
    this.cooldown[type] = this.day;
    const text = chirpText(type, this.rng, Object.assign({ city: this.cityName }, ctx));
    if (text) this.emit({ type: 'chirp', kind: type, author: handle(this.rng), text });
  }

  // ---------- Haupt-Tick: ein Spieltag ----------
  tick() {
    const w = this.w;
    if (w.networkDirty) { w.updateNetwork(); this.covDirty = true; }
    if (w.servicesDirty) { this.covDirty = true; w.servicesDirty = false; }
    const prevMonth = this.date.getMonth();
    this.day++;
    this.updateUtilities();
    if (this.covDirty || this.day % 10 === 0) { this.computeCoverage(); this.covDirty = false; }
    if (this.day % 3 === 0 || this.day < 3) this.computeEnvironment();
    this.updateBuildings();
    this.updatePopulation();
    this.updateDemand();
    this.grow();
    this.updateFires();
    this.economy();
    if (this.date.getMonth() !== prevMonth) this.closeMonth();
    this.checkMilestones();
    if (this.day % 2 === 0) this.checkWarnings();
  }

  // ---------- Strom, Wasser, Abwasser ----------
  updateUtilities() {
    const w = this.w, nc = w.compCount;
    const pS = new Float64Array(nc), pD = new Float64Array(nc);
    const wS = new Float64Array(nc), wD = new Float64Array(nc);
    const sS = new Float64Array(nc), sD = new Float64Array(nc);
    for (const b of w.buildings.values()) {
      const c = b.comp;
      if (b.kind === 'service') {
        const d = SERVICES[b.def];
        if (c < 0) continue;
        if (d.power) pS[c] += d.power;
        if (d.water) wS[c] += d.water;
        if (d.sewage) sS[c] += d.sewage;
        if (d.powerUse) pD[c] += d.powerUse;
        continue;
      }
      if (b.built < 1 && b.level === 1) { b.pUse = 0; b.wUse = 0; continue; }
      const u = UTIL_USE[ZONES[b.zone].key];
      const amt = b.abandoned ? 0 : b.cap;
      b.pUse = amt * u.power;
      b.wUse = amt * u.water;
      if (c < 0) continue;
      pD[c] += b.pUse; wD[c] += b.wUse; sD[c] += b.wUse;
    }
    const period = Math.floor(this.day / 20);
    let tps = 0, tpd = 0, tws = 0, twd = 0, tss = 0, tsd = 0;
    for (let c = 0; c < nc; c++) {
      tps += pS[c]; tpd += pD[c]; tws += wS[c]; twd += wD[c]; tss += sS[c]; tsd += sD[c];
    }
    Object.assign(this.stats, { powerSup: tps, powerDem: tpd, waterSup: tws, waterDem: twd, sewSup: tss, sewDem: tsd });
    for (const b of w.buildings.values()) {
      const c = b.comp;
      const prevPower = b.power;
      if (c < 0) {
        b.power = b.water = b.sewage = false;
      } else {
        const rp = pD[c] > 0 ? pS[c] / pD[c] : 1;
        const rw = wD[c] > 0 ? wS[c] / wD[c] : 1;
        const rs = sD[c] > 0 ? sS[c] / sD[c] : 1;
        b.power = rp >= 1 || hash2(b.id, period, 1) < rp;
        b.water = rw >= 1 || hash2(b.id, period, 2) < rw;
        b.sewage = rs >= 1 || hash2(b.id, period, 3) < rs;
        if (b.kind === 'service' && SERVICES[b.def].power) b.power = true;
      }
      if (b.kind === 'service' && !SERVICES[b.def].powerUse) b.power = true;
      if (b.kind === 'service' && b.power !== prevPower) this.covDirty = true;
      if (prevPower !== b.power) w.markDirty(b.cx, b.cz);
    }
  }

  // ---------- Abdeckung durch Dienstgebäude ----------
  computeCoverage() {
    const w = this.w, S = w.size;
    for (const t of COVERAGE_TYPES) this.cov[t].fill(0);
    this.fireStations = [];
    this.cityHall = false;
    // Haltestellen funktionieren nur mit einem Busdepot im selben Straßennetz
    this.depotComps = new Set();
    for (const b of w.buildings.values()) if (b.kind === 'service' && b.def === 'busdepot' && b.comp >= 0 && b.power) this.depotComps.add(b.comp);
    for (const b of w.buildings.values()) {
      if (b.kind !== 'service') continue;
      const def = SERVICES[b.def];
      if (b.def === 'cityhall' && b.comp >= 0) this.cityHall = true;
      if (!def.cover || b.comp < 0) continue;
      if (def.powerUse && !b.power) continue;
      if (b.def === 'busstop' && !this.depotComps.has(b.comp)) continue;
      const arr = this.cov[def.cover.type];
      const r = def.cover.r, s = def.cover.s ?? 1;
      const cx = b.cx, cy = b.cz;
      if (b.def === 'fire') this.fireStations.push(b);
      const additive = def.cover.type === 'parks';
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(S - 1, Math.ceil(cy + r));
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(S - 1, Math.ceil(cx + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const d = Math.sqrt(dx * dx + dy * dy) / r;
          if (d > 1) continue;
          const v = s * (1 - 0.65 * d * d);
          const i = y * S + x;
          arr[i] = additive ? Math.min(1, arr[i] + v * 0.6) : Math.max(arr[i], v);
        }
      }
    }
  }

  // ---------- Verschmutzung, Lärm, Kriminalität, Bodenwert ----------
  computeEnvironment() {
    const w = this.w, S = w.size, n = w.n;
    const pol = this.pollution, noise = this.noise, crime = this.crime, lv = this.landValue;
    pol.fill(0); noise.fill(0); crime.fill(0);
    const radial = (arr, cx, cy, s, r) => {
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(S - 1, Math.ceil(cy + r));
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(S - 1, Math.ceil(cx + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > r) continue;
          arr[y * S + x] += s * (1 - d / r);
        }
      }
    };
    const dens = this.traffic ? this.traffic.density : null;
    for (let i = 0; i < n; i++) {
      const t = w.road[i];
      if (!t) continue;
      const base = t === 1 ? 6 : t === 2 ? 11 : 20;
      const v = base + (dens ? Math.min(1.5, dens[i]) * 30 : 0);
      radial(noise, (i % S) + 0.5, ((i / S) | 0) + 0.5, v, 2.2);
    }
    const pol0 = this.cov.police;
    for (const b of w.buildings.values()) {
      const cx = b.cx, cy = b.cz, area = b.w * b.d;
      if (b.kind === 'service') {
        const def = SERVICES[b.def];
        if (def.pollution) radial(pol, cx, cy, def.pollution.s, def.pollution.r);
        if (def.noise) radial(noise, cx, cy, def.noise, 3 + Math.sqrt(area));
        continue;
      }
      if (b.built < 1 && b.level === 1) continue;
      const key = ZONES[b.zone].key;
      if (key === 'I' && !b.abandoned) {
        radial(pol, cx, cy, [30, 24, 17][b.level - 1] * Math.sqrt(area) / 1.6, 3 + Math.sqrt(area) * 1.4);
        radial(noise, cx, cy, 14, 3);
      } else if (key === 'C') {
        radial(noise, cx, cy, 6 + area, 2.5);
      }
      if (key === 'R' || key === 'C' || key === 'O' || b.abandoned) {
        const density = b.occ / area;
        let c = 14 + density * 0.9 + (b.abandoned ? 35 : 0) - pol0[b.ti] * 50;
        c = clamp(c, 0, 100);
        for (const i of b.tiles) crime[i] = c;
      }
    }
    let lvSum = 0, lvN = 0, polSum = 0, polN = 0, crimeSum = 0, crimeN = 0;
    const cv = this.cov;
    for (let i = 0; i < n; i++) {
      if (pol[i] > 0) {
        const x = i % S, y = (i / S) | 0;
        let t = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < S && yy < S) t += w.trees[yy * S + xx];
          }
        }
        pol[i] = clamp(pol[i] * (1 - Math.min(0.5, t * 0.035)), 0, 100);
      }
      noise[i] = clamp(noise[i], 0, 100);
      if (w.terrain[i] !== T_LAND) { lv[i] = 0; continue; }
      const edu = Math.max(cv.edu1[i], cv.edu2[i], cv.edu3[i]);
      const wd = w.waterDist[i];
      let v = 22 + cv.parks[i] * 26 + cv.police[i] * 6 + cv.fire[i] * 5 + cv.health[i] * 7 + edu * 6 + cv.garbage[i] * 3
        + cv.landmark[i] * 22 + cv.transit[i] * 6 + (wd <= 4 ? (5 - wd) * 3.5 : 0) - pol[i] * 0.55 - noise[i] * 0.15 - crime[i] * 0.08;
      v = clamp(v, 0, 100);
      lv[i] = lv[i] * 0.5 + v * 0.5;
      if (w.bld[i] >= 0) {
        lvSum += lv[i]; lvN++;
        polSum += pol[i]; polN++;
        if (crime[i] > 0) { crimeSum += crime[i]; crimeN++; }
      }
    }
    this.stats.landValue = lvN ? lvSum / lvN : 20;
    this.stats.pollution = polN ? polSum / polN : 0;
    this.stats.crime = crimeN ? crimeSum / crimeN : 0;
  }

  // ---------- Zufriedenheit, Aufwertung, Verlassen ----------
  updateBuildings() {
    const w = this.w, cv = this.cov;
    let hs = 0, hn = 0, eduS = 0;
    const pop = this.stats.pop;
    const toRemove = [];
    for (const b of w.buildings.values()) {
      if (b.kind === 'service') continue;
      b.age++;
      if (b.built < 1) {
        if (b.connected) {
          const before = Math.floor(b.built * 3);
          b.built = Math.min(1, b.built + 0.2 + this.rng() * 0.12);
          if (Math.floor(b.built * 3) !== before || b.built >= 1) w.markDirty(b.cx, b.cz);
        }
        continue;
      }
      if (b.abandoned) {
        b.abandonedDays++;
        if (b.abandonedDays > 50) toRemove.push(b.id);
        continue;
      }
      const ci = b.ti;
      const key = ZONES[b.zone].key;
      const eduTarget = clamp(cv.edu1[ci] * 0.45 + cv.edu2[ci] * 0.35 + cv.edu3[ci] * 0.3, 0, 1);
      b.edu += (eduTarget - b.edu) * 0.04;
      let h = 55;
      // Neue Gebäude bekommen eine Schonfrist, bis Strom und Wasser ankommen
      const grace = b.age < 40 ? 0.35 : 1;
      h += b.power ? 6 : -16 * grace;
      h += b.water ? 5 : -12 * grace;
      h += b.sewage ? 3 : -8 * grace;
      b.garbage = cv.garbage[ci] > 0.05;
      if (pop > 400) h += b.garbage ? 3 : -10;
      h += cv.police[ci] * 6 + cv.fire[ci] * 4 + cv.health[ci] * 7 + cv.parks[ci] * 9;
      if (key === 'R') h += b.edu * 6 + cv.transit[ci] * 3;
      h -= this.pollution[ci] * (key === 'I' ? 0.08 : 0.32);
      h -= this.noise[ci] * (key === 'I' ? 0 : 0.12);
      h -= this.crime[ci] * 0.15;
      h += (this.landValue[ci] - 30) * 0.15;
      h -= (this.taxes[key] - 9) * 1.6;
      if (key !== 'R' && b.cap > 0 && b.occ < b.cap * 0.4) h -= 10;
      if (!b.connected) h -= 25;
      if (this.cityHall) h += 5;
      const seg = b.seg >= 0 ? w.net.segs.get(b.seg) : null;
      if (seg && seg.density > 0.9) h -= 6;
      h = clamp(h, 0, 100);
      b.happy += (h - b.happy) * 0.15;
      if ((b.happy < 16 || !b.connected) && b.age > 30) b.unhappyDays += b.connected ? 1 : 2;
      else b.unhappyDays = Math.max(0, b.unhappyDays - 2);
      if (b.unhappyDays > 75) {
        b.abandoned = true;
        b.occ = 0;
        b.abandonedDays = 0;
        w.markDirty(b.cx, b.cz);
        this.chirp('abandoned', {}, 40);
        continue;
      }
      if ((this.day + b.id) % 8 === 0) this.checkLevel(b, ci, key);
      const wgt = Math.max(1, b.occ);
      hs += b.happy * wgt; hn += wgt;
      if (key === 'R') eduS += b.edu * b.occ;
    }
    for (const id of toRemove) w.removeBuilding(id);
    this.stats.happiness = hn ? hs / hn : 60;
    this.stats.eduAvg = this.stats.pop ? eduS / this.stats.pop : 0;
  }

  checkLevel(b, ci, key) {
    const z = ZONES[b.zone];
    if (b.level >= z.maxLevel) return;
    const lv = this.landValue[ci];
    let score;
    if (key === 'R') score = lv * 0.55 + b.happy * 0.25 + b.edu * 30;
    else if (key === 'C') score = lv * 0.65 + b.happy * 0.3;
    else if (key === 'I') score = b.happy * 0.45 + b.edu * 40 + 12;
    else score = lv * 0.4 + b.edu * 45 + b.happy * 0.2;
    if (score >= LEVEL_SCORE[b.level] && b.happy >= 45 && b.power && b.water) {
      b.level++;
      b.cap = CAPACITY[b.zone][b.level - 1] * b.w * b.d;
      b.built = 0.55;
      this.w.markDirty(b.cx, b.cz);
      this.emit({ type: 'levelup', id: b.id });
      if (b.level >= 3) this.chirp('levelup', {}, 90);
    }
  }

  // ---------- Bevölkerung und Arbeitsplätze ----------
  updatePopulation() {
    const w = this.w, rng = this.rng;
    let pop = 0, eduPop = 0, jC = 0, jI = 0, jO = 0, jS = 0, bcount = 0, riders = 0;
    const dR = this.demand.R;
    const zc = { R: 0, C: 0, I: 0, O: 0 };
    for (const b of w.buildings.values()) {
      bcount++;
      if (b.kind === 'service') {
        if (b.comp >= 0) jS += SERVICES[b.def].jobs || 0;
        continue;
      }
      const key = ZONES[b.zone].key;
      zc[key]++;
      const active = (b.built >= 1 || b.level > 1) && !b.abandoned && b.connected;
      if (key === 'R') {
        if (b.abandoned) b.occ = 0;
        else if (!active) b.occ = Math.max(0, b.occ - Math.ceil(b.cap * 0.1));
        else if (b.happy < 22 && b.occ > 0 && rng() < 0.3) b.occ--;
        else if (b.occ < b.cap && dR > -15 && rng() < 0.45 + dR / 220) {
          const add = 1 + Math.floor(rng() * Math.max(1, b.cap * 0.15));
          if (b.occ === 0 && b.age < 30) this.chirp('welcome', {}, 25);
          b.occ = Math.min(b.cap, b.occ + add);
        }
        if (b.occ > b.cap) b.occ = b.cap;
        pop += b.occ;
        eduPop += b.occ * b.edu;
        riders += b.occ * this.cov.transit[b.ti] * 0.4;
      } else if (active) {
        if (key === 'C') jC += b.cap; else if (key === 'I') jI += b.cap; else jO += b.cap;
      }
    }
    const workforce = pop * 0.55;
    const jobs = jC + jI + jO + jS;
    const connected = w.net.compOutside.some(Boolean);
    const commuters = connected ? Math.min(jobs * 0.25, 20 + pop * 0.12) : 0;
    const fill = jobs > 0 ? Math.min(1, (workforce + commuters) / jobs) : 0;
    for (const b of w.buildings.values()) {
      if (b.kind === 'service' || ZONES[b.zone].key === 'R') continue;
      const active = (b.built >= 1 || b.level > 1) && !b.abandoned && b.connected;
      b.occ = active ? Math.round(b.cap * fill * (b.happy > 20 ? 1 : 0.6)) : 0;
    }
    const employed = Math.min(workforce, jobs);
    Object.assign(this.stats, {
      pop, workforce, employed, jobs, jobsC: jC, jobsI: jI, jobsO: jO, jobsS: jS, commuters,
      unemployment: workforce > 0 ? (workforce - employed) / workforce : 0,
      eduWorkers: eduPop * 0.55, buildings: bcount, zones: zc, riders,
    });
  }

  // ---------- Nachfrage (RCI + Büros) ----------
  updateDemand() {
    const s = this.stats, t = this.taxes;
    let dR = 35 + clamp((s.jobs * 1.15 - s.workforce) / Math.max(s.workforce, 40), -1.5, 1.5) * 90
      + (s.happiness - 55) * 0.6 - (t.R - 9) * 5;
    if (s.pop < 80) dR += 35;
    const wantC = 10 + s.pop * 0.2;
    const dC = (wantC - s.jobsC) / wantC * 110 + s.unemployment * 60 - (t.C - 9) * 5;
    const wantI = Math.max(10, 14 + s.pop * 0.24 + s.jobsC * 0.15 - s.eduWorkers * 0.12);
    const dI = (wantI - s.jobsI) / wantI * 110 + s.unemployment * 60 - (t.I - 9) * 5;
    let dO = -100;
    if (this.unlocked(ZONES[6].unlock)) {
      const wantO = 5 + s.eduWorkers * 0.3;
      dO = (wantO - s.jobsO) / wantO * 110 + s.unemployment * 30 - (t.O - 9) * 5;
    }
    const d = this.demand;
    d.R += (clamp(dR, -100, 100) - d.R) * 0.25;
    d.C += (clamp(dC, -100, 100) - d.C) * 0.25;
    d.I += (clamp(dI, -100, 100) - d.I) * 0.25;
    d.O += (clamp(dO, -100, 100) - d.O) * 0.25;
  }

  // ---------- Wachstum: neue Gebäude auf Zonenzellen ----------
  grow() {
    const w = this.w, rng = this.rng, net = w.net;
    if (!net.compOutside.some(Boolean)) return;
    let constructing = 0;
    for (const b of w.buildings.values()) if (b.kind === 'zone' && b.built < 1 && b.level === 1) constructing++;
    const maxC = 6 + Math.floor(this.stats.pop / 350);
    if (constructing >= maxC) return;
    const cands = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const c of w.cells) {
      if (c.row !== 1 || !c.zone || c.bld >= 0) continue;
      const s = net.segs.get(c.seg);
      if (s && net.compOutside[s.comp]) cands[c.zone].push(c);
    }
    for (let z = 1; z <= 6; z++) {
      const zdef = ZONES[z];
      if (!this.unlocked(zdef.unlock)) continue;
      const dem = this.demand[zdef.key];
      if (dem <= 3) continue;
      const list = cands[z];
      let tries = dem > 70 ? 3 : dem > 35 ? 2 : 1;
      if (rng() > 0.4 + dem / 140) continue;
      while (tries-- > 0 && list.length && constructing < maxC) {
        const k = Math.floor(rng() * list.length);
        const c = list[k];
        list.splice(k, 1);
        if (c.bld < 0 && this.placeLot(z, c)) constructing++;
      }
    }
  }

  // Grundstück aus benachbarten Zellen bilden; das Gebäude richtet sich nach der Straße aus
  placeLot(z, c0) {
    const w = this.w, rng = this.rng;
    const opts = LOTS[z].slice();
    const ordered = [];
    while (opts.length) {
      const o = weightedPick(rng, opts, (it) => it[2]);
      ordered.push(o);
      opts.splice(opts.indexOf(o), 1);
    }
    for (const [lw, ld0] of ordered) {
      const offs = shuffle(rng, Array.from({ length: lw }, (_, k) => -k));
      for (const o of offs) {
        let ld = ld0;
        const front = [];
        let ok = true;
        for (let a = 0; a < lw && ok; a++) {
          for (let r = 1; r <= ld; r++) {
            const c = w.cellAt(c0.seg, c0.side, c0.col + o + a, r);
            if (!c || c.zone !== z || c.bld >= 0) { ok = false; break; }
            if (r === 1) front.push(c);
          }
        }
        if (!ok) continue;
        // Wie in Cities: Skylines füllt das Grundstück die freie Zonentiefe dahinter auf
        let dd = ld;
        while (dd < ZONE_DEPTH) {
          let all = true;
          for (let a = 0; a < lw && all; a++) {
            const c = w.cellAt(c0.seg, c0.side, c0.col + o + a, dd + 1);
            if (!c || c.zone !== z || c.bld >= 0) all = false;
          }
          if (!all) break;
          dd++;
        }
        ld = dd;
        let sx = 0, sz = 0, px = 0, pz = 0;
        for (const c of front) { sx += Math.cos(c.rot); sz += Math.sin(c.rot); px += c.cx; pz += c.cz; }
        const rot = Math.atan2(sz, sx);
        if (front.some((c) => Math.abs(wrapAngle(c.rot - rot)) > 0.35)) continue;
        px /= front.length; pz /= front.length;
        const dx = -Math.sin(rot), dz = Math.cos(rot);
        const rect = { cx: px + dx * (ld - 1) / 2, cz: pz + dz * (ld - 1) / 2, rot, w: lw, d: ld };
        if (this.lotBlocked(rect)) continue;
        const b = makeBuilding({
          kind: 'zone', zone: z, cx: rect.cx, cz: rect.cz, rot, w: lw, d: ld,
          seed: (rng() * 2147483647) | 0, built: 0, happy: 62,
        });
        b.cap = CAPACITY[z][0] * lw * ld;
        b.name = buildingName(b, rng);
        w.addBuilding(b);
        return b;
      }
    }
    return null;
  }

  lotBlocked(rect) {
    const w = this.w;
    const tx = Math.floor(rect.cx), tz = Math.floor(rect.cz);
    const R = Math.ceil(Math.max(rect.w, rect.d) / 2) + 2;
    const seen = new Set();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const o = w.getBuilding(tx + dx, tz + dz);
        if (!o || seen.has(o.id)) continue;
        seen.add(o.id);
        if (rectsOverlap(rect, w.rectOf(o), 0.92)) return true;
      }
    }
    return !!w.rectHitsRoad(rect, -0.1);
  }

  // ---------- Brände ----------
  updateFires() {
    const w = this.w, rng = this.rng;
    if (this.stats.pop < 150) return;
    const burning = [];
    for (const b of w.buildings.values()) {
      if (b.fire > 0) { burning.push(b); continue; }
      if (b.built < 1) continue;
      if (b.kind === 'service' && SERVICES[b.def].cat === 'parks') continue;
      const fc = this.cov.fire[b.ti];
      const isI = b.kind === 'zone' && ZONES[b.zone].key === 'I';
      const p = 0.00004 * (1 - fc) * (1 - fc) * (isI ? 2.5 : 1) * (b.abandoned ? 3 : 1);
      if (rng() < p) this.ignite(b, fc);
    }
    for (const b of burning) {
      b.fire -= 1;
      if (!b.fireCovered && rng() < 0.07) {
        const nb = this.neighborBuilding(b);
        if (nb && nb.fire <= 0 && nb.built >= 1) {
          this.ignite(nb, this.cov.fire[nb.ti]);
        }
      }
      if (b.fire <= 0) {
        b.fire = 0;
        if (b.fireCovered) {
          b.happy = Math.max(0, b.happy - 8);
          this.chirp('fireOut', {}, 20);
          w.markDirty(b.cx, b.cz);
        } else {
          this.chirp('burned', { where: b.name || 'ein Gebäude' }, 5);
          this.emit({ type: 'burned', x: b.cx, y: b.cz });
          w.removeBuilding(b.id);
        }
      }
    }
  }

  ignite(b, fc) {
    b.fireCovered = fc > 0.15;
    b.fire = b.fireCovered ? 2 + this.rng() * 3 : 9 + this.rng() * 4;
    this.w.markDirty(b.cx, b.cz);
    this.chirp('fire', { where: b.name || 'der Stadt' }, 6);
    this.emit({ type: 'fire', id: b.id });
    if (b.fireCovered && this.fireStations.length) {
      let best = null, bd = 1e9;
      for (const s of this.fireStations) {
        const d = Math.hypot(s.cx - b.cx, s.cz - b.cz);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) this.dispatch.push({ from: best.id, to: b.id });
    }
  }

  neighborBuilding(b) {
    const w = this.w;
    for (let k = 0; k < 6; k++) {
      const ang = this.rng() * Math.PI * 2, rr = Math.max(b.w, b.d) / 2 + 0.6;
      const nb = w.buildingAt(b.cx + Math.cos(ang) * rr, b.cz + Math.sin(ang) * rr, 0.3);
      if (nb && nb !== b) return nb;
    }
    return null;
  }

  // ---------- Finanzen ----------
  economy() {
    const w = this.w, t = this.taxes, L = this.month;
    let inc = 0, exp = 0;
    for (const b of w.buildings.values()) {
      if (b.kind === 'service') {
        const def = SERVICES[b.def];
        const v = def.upkeep / 30;
        L.expense[def.cat] += v;
        exp += v;
        continue;
      }
      if (b.abandoned || b.occ <= 0) continue;
      const key = ZONES[b.zone].key;
      const v = b.occ * (t[key] / 100) * TAX_YIELD[key] * (1 + 0.2 * (b.level - 1));
      L.income[key] += v;
      inc += v;
    }
    const tickets = this.stats.riders * 0.03;
    L.income.T += tickets;
    inc += tickets;
    let roads = 0;
    for (const k of [1, 2, 3]) roads += w.roadLen[k] * ROAD_TYPES[k].upkeep;
    roads += w.roadLen.bridge * 3;
    roads /= 30;
    L.expense.roads += roads;
    exp += roads;
    this.money += inc - exp;
    this.dailyNet = this.dailyNet * 0.8 + (inc - exp) * 0.2;
  }

  closeMonth() {
    const L = this.month;
    const inc = Object.values(L.income).reduce((a, b) => a + b, 0);
    const exp = Object.values(L.expense).reduce((a, b) => a + b, 0);
    this.lastMonth = Object.assign(L, { totalIncome: inc, totalExpense: exp });
    this.history.push({ day: this.day, pop: this.stats.pop, money: Math.round(this.money), net: Math.round(inc - exp),
      happy: Math.round(this.stats.happiness) });
    if (this.history.length > 120) this.history.shift();
    this.month = emptyLedger();
  }

  monthlyEstimate() {
    // Hochrechnung aus laufendem oder letztem Monat
    const L = this.lastMonth;
    if (L) return { income: L.totalIncome, expense: L.totalExpense };
    const daysIn = Math.max(1, this.date.getDate());
    const inc = Object.values(this.month.income).reduce((a, b) => a + b, 0);
    const exp = Object.values(this.month.expense).reduce((a, b) => a + b, 0);
    return { income: inc * 30 / daysIn, expense: exp * 30 / daysIn };
  }

  // ---------- Meilensteine & Warnungen ----------
  checkMilestones() {
    while (this.milestone + 1 < MILESTONES.length && this.stats.pop >= MILESTONES[this.milestone + 1].pop) {
      this.milestone++;
      const m = MILESTONES[this.milestone];
      this.money += m.reward;
      this.emit({ type: 'milestone', index: this.milestone, name: m.name, reward: m.reward });
      this.chirp('milestone', { what: m.name === 'Weiler' ? 'ein Weiler' : m.name === 'Dorf' ? 'ein Dorf' : 'eine ' + m.name }, 0);
    }
  }

  checkWarnings() {
    const s = this.stats, f = this.flags;
    const flag = (key, cond, clear, chirpType) => {
      if (!f[key] && cond) { f[key] = true; if (chirpType) this.chirp(chirpType, {}, 15); this.emit({ type: 'warn', key }); }
      else if (f[key] && clear) f[key] = false;
    };
    flag('power', s.powerDem > 0.3 && s.powerSup < s.powerDem, s.powerSup >= s.powerDem * 1.02, 'power');
    flag('water', s.waterDem > 0.3 && s.waterSup < s.waterDem, s.waterSup >= s.waterDem * 1.02, 'water');
    flag('sewage', s.sewDem > 0.3 && s.sewSup < s.sewDem, s.sewSup >= s.sewDem * 1.02, 'sewage');
    let zoned = false;
    for (const c of this.w.cells) if (c.zone) { zoned = true; break; }
    const conn = this.w.net.compOutside.some(Boolean);
    flag('conn', zoned && !conn, conn, 'conn');
    flag('broke', this.money < 0, this.money > 1000, 'broke');
    if (s.pop > 300 && s.unemployment > 0.18) this.chirp('unemployment', {}, 60);
    if (Math.max(this.taxes.R, this.taxes.C, this.taxes.I, this.taxes.O) > 14) this.chirp('taxes', {}, 50);
    if (s.pop > 400 && this.cov.garbage.every((v) => v === 0)) this.chirp('garbage', {}, 60);
    if (s.pop > 300 && this.demand.C > 75) this.chirp('needC', {}, 70);
    if (s.pop > 300 && this.demand.I > 80) this.chirp('needI', {}, 70);
    if (s.pop > 300 && this.demand.R > 85) this.chirp('needR', {}, 70);
    if (s.pollution > 25) this.chirp('pollution', {}, 80);
    if (s.crime > 30 && s.pop > 500) this.chirp('crime', {}, 80);
    if (s.happiness > 68 && s.pop > 50 && this.rng() < 0.1) this.chirp('happy', {}, 25);
    if (this.traffic && this.traffic.congestion > 0.6 && s.pop > 600) this.chirp('traffic', {}, 60);
  }

  // ---------- Speichern ----------
  toJSON() {
    return {
      cityName: this.cityName, pop: this.stats.pop, money: this.money, day: this.day, taxes: this.taxes, demand: this.demand,
      milestone: this.milestone, history: this.history, flags: this.flags, cooldown: this.cooldown, tasks: this.tasks,
      month: this.month, lastMonth: this.lastMonth, landValue: Array.from(this.landValue, (v) => Math.round(v)),
    };
  }

  fromJSON(o) {
    for (const k of ['cityName', 'money', 'day', 'taxes', 'demand', 'milestone', 'history', 'flags', 'cooldown', 'tasks',
      'month', 'lastMonth']) {
      if (o[k] !== undefined) this[k] = o[k];
    }
    const fix = (L) => {
      if (!L) return L;
      const e = emptyLedger();
      return Object.assign({}, L, { income: Object.assign(e.income, L.income), expense: Object.assign(e.expense, L.expense) });
    };
    this.month = fix(this.month) || emptyLedger();
    this.lastMonth = fix(this.lastMonth);
    if (o.landValue) for (let i = 0; i < this.landValue.length && i < o.landValue.length; i++) this.landValue[i] = o.landValue[i];
    this.covDirty = true;
  }
}
