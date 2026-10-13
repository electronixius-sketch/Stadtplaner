// Bauwerkzeuge. Jede Aktion wird für "Rückgängig" aufgezeichnet.
import { ROAD_TYPES, ZONES, SERVICES, T_WATER, T_LAND, BRIDGE_MULT, TREE_COST } from './config.js';
import { fmtMoney, fmt, rgb } from './util.js';
import { makeBuilding } from './world.js';

const OK = rgb(0x40c057), BAD = rgb(0xfa5252), SKIP = rgb(0x9aa5b1), WARN = rgb(0xffa94d), DEMO = rgb(0xff6b6b);

class Tool {
  constructor(game) {
    this.g = game;
    this.active = false;
  }
  get w() { return this.g.world; }
  get sim() { return this.g.sim; }
  get hint() { return ''; }
  down() {}
  move() {}
  up() {}
  hover() {}
  cancel() {
    this.active = false;
    this.g.preview.clear();
    this.g.ui.setCursorLabel(null);
  }
  dispose() { this.cancel(); }
  label(text, bad = false) {
    this.g.ui.setCursorLabel(text, bad);
  }
  rectTiles(a, b, max = 48) {
    const x0 = Math.max(0, Math.min(a.x, b.x)), x1 = Math.min(this.w.size - 1, Math.max(a.x, b.x));
    const y0 = Math.max(0, Math.min(a.y, b.y)), y1 = Math.min(this.w.size - 1, Math.max(a.y, b.y));
    const out = [];
    for (let y = y0; y <= Math.min(y1, y0 + max - 1); y++) for (let x = x0; x <= Math.min(x1, x0 + max - 1); x++) out.push([x, y]);
    return out;
  }
}

// ------------------------------------------------------------ Straßen
export class RoadTool extends Tool {
  constructor(game, type) {
    super(game);
    this.type = type;
    this.spec = ROAD_TYPES[type];
  }
  get hint() { return `${this.spec.name}: Mit dem Finger ziehen · ${fmtMoney(this.spec.cost)} pro Feld · Über Wasser entstehen Brücken`; }

  down(t) { if (!t) return; this.start = t; this.end = t; this.active = true; this.update(); }
  move(t) { if (!this.active || !t) return; if (t.x === this.end.x && t.y === this.end.y) return; this.end = t; this.update(); }
  hover(t) {
    if (this.active) return;
    if (!t) { this.g.preview.clear(); return; }
    this.g.preview.setTiles([{ x: t.x, y: t.y, c: this.w.canRoad(t.x, t.y) ? OK : BAD, a: 0.45 }]);
  }
  up(t) {
    if (!this.active) return;
    if (t) this.end = t;
    this.update();
    this.commit();
    this.cancel();
  }

  path() {
    const a = this.start, b = this.end;
    const out = [];
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    const horizFirst = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    let x = a.x, y = a.y;
    out.push([x, y]);
    if (horizFirst) {
      while (x !== b.x) { x += dx; out.push([x, y]); }
      while (y !== b.y) { y += dy; out.push([x, y]); }
    } else {
      while (y !== b.y) { y += dy; out.push([x, y]); }
      while (x !== b.x) { x += dx; out.push([x, y]); }
    }
    return out;
  }

  tileCost(x, y) {
    const w = this.w;
    const i = w.idx(x, y);
    const cur = w.road[i];
    if (cur === this.type) return 0;
    let c = this.spec.cost * (w.terrain[i] === T_WATER ? BRIDGE_MULT : 1);
    if (cur) c = Math.max(0, c - ROAD_TYPES[cur].cost * 0.5);
    return c;
  }

  update() {
    const w = this.w;
    const tiles = this.path();
    let cost = 0, n = 0, demo = 0;
    const list = [];
    for (const [x, y] of tiles) {
      if (!w.inb(x, y)) continue;
      const i = w.idx(x, y);
      const ok = w.canRoad(x, y) && !w.isOutsideTile(x, y);
      const same = w.road[i] === this.type;
      if (ok && !same) {
        cost += this.tileCost(x, y);
        n++;
        if (w.bld[i] >= 0) demo++;
      }
      list.push({ x, y, c: !ok ? BAD : same ? SKIP : w.bld[i] >= 0 ? WARN : OK, a: 0.6 });
    }
    this.tiles = tiles;
    this.cost = cost;
    this.n = n;
    this.g.preview.setTiles(list);
    const tooExpensive = cost > this.sim.money;
    this.label(`${n} ${n === 1 ? 'Feld' : 'Felder'} · ${fmtMoney(cost)}${demo ? ` · ${demo} Abriss` : ''}`, tooExpensive);
  }

  commit() {
    if (!this.n) return;
    if (this.cost > this.sim.money) { this.g.ui.toast('Nicht genug Geld für diese Straße.', 'error'); this.g.sound.error(); return; }
    const w = this.w;
    w.beginAction();
    for (const [x, y] of this.tiles) {
      if (!w.inb(x, y) || !w.canRoad(x, y) || w.isOutsideTile(x, y)) continue;
      if (w.road[w.idx(x, y)] === this.type) continue;
      w.setRoad(x, y, this.type);
    }
    w.updateNetwork();
    this.g.commitAction(w.endAction(), this.cost);
    this.g.sound.build();
  }
}

// ------------------------------------------------------------ Zonen
export class ZoneTool extends Tool {
  constructor(game, zone) {
    super(game);
    this.zone = zone;
  }
  get hint() {
    if (!this.zone) return 'Zonen entfernen: Rechteck aufziehen';
    return `${ZONES[this.zone].name}: Rechteck neben Straßen aufziehen (bis ${3} Felder tief) · kostenlos`;
  }
  down(t) { if (!t) return; this.start = t; this.end = t; this.active = true; this.update(); }
  move(t) { if (!this.active || !t) return; this.end = t; this.update(); }
  hover(t) {
    if (this.active) return;
    if (!t) { this.g.preview.clear(); return; }
    const ok = this.zone ? this.w.canZone(this.w.idx(t.x, t.y)) : !!this.w.zone[this.w.idx(t.x, t.y)];
    this.g.preview.setTiles([{ x: t.x, y: t.y, c: ok ? this.color() : BAD, a: 0.5 }]);
  }
  up(t) {
    if (!this.active) return;
    if (t) this.end = t;
    this.update();
    this.commit();
    this.cancel();
  }
  color() { return this.zone ? rgb(ZONES[this.zone].color) : DEMO; }

  update() {
    const w = this.w;
    const list = [];
    this.tiles = [];
    let replace = 0;
    for (const [x, y] of this.rectTiles(this.start, this.end)) {
      const i = w.idx(x, y);
      if (this.zone === 0) {
        if (w.zone[i]) { this.tiles.push([x, y]); list.push({ x, y, c: DEMO, a: 0.6 }); }
      } else if (w.canZone(i) && w.zone[i] !== this.zone) {
        this.tiles.push([x, y]);
        if (w.bld[i] >= 0) replace++;
        list.push({ x, y, c: this.color(), a: 0.6 });
      }
    }
    this.g.preview.setTiles(list);
    const n = this.tiles.length;
    this.label(n ? `${n} ${n === 1 ? 'Feld' : 'Felder'}${replace ? ` · ${replace} Gebäude werden ersetzt` : ''}` : 'Keine gültigen Felder – Zonen nur neben Straßen', !n);
  }

  commit() {
    if (!this.tiles.length) return;
    const w = this.w;
    w.beginAction();
    for (const [x, y] of this.tiles) w.setZone(x, y, this.zone);
    this.g.commitAction(w.endAction(), 0);
    this.g.sound.zone();
  }
}

// ------------------------------------------------------------ Abriss
export class BulldozeTool extends Tool {
  get hint() { return 'Abriss: Tippen oder Rechteck aufziehen · 50 % Erstattung für Straßen und Dienstgebäude'; }
  down(t) { if (!t) return; this.start = t; this.end = t; this.active = true; this.update(); }
  move(t) { if (!this.active || !t) return; this.end = t; this.update(); }
  hover(t) {
    if (this.active) return;
    if (!t) { this.g.preview.clear(); return; }
    this.start = this.end = t;
    this.update(true);
  }
  up(t) {
    if (!this.active) return;
    if (t) this.end = t;
    this.update();
    this.commit();
    this.cancel();
  }

  update(hoverOnly = false) {
    const w = this.w;
    const list = [];
    const blds = new Set();
    let roads = 0, trees = 0, refund = 0;
    const rect = this.rectTiles(this.start, this.end);
    const single = rect.length === 1;
    for (const [x, y] of rect) {
      const i = w.idx(x, y);
      if (w.bld[i] >= 0) blds.add(w.bld[i]);
      else if (w.road[i] && !w.isOutsideTile(x, y)) {
        roads++;
        refund += ROAD_TYPES[w.road[i]].cost * 0.5 * (w.terrain[i] === T_WATER ? BRIDGE_MULT : 1);
        list.push({ x, y, c: DEMO, a: 0.65 });
      } else if (w.trees[i] && (single || !blds.size)) {
        trees++;
        list.push({ x, y, c: WARN, a: 0.5 });
      } else if (!hoverOnly) list.push({ x, y, c: SKIP, a: 0.18 });
    }
    for (const id of blds) {
      const b = w.buildings.get(id);
      if (b.kind === 'service') refund += SERVICES[b.def].cost * 0.5;
      for (let y = b.y; y < b.y + b.H; y++) for (let x = b.x; x < b.x + b.W; x++) list.push({ x, y, c: DEMO, a: 0.7, h: (b.hgt || 0.5) + 0.05 });
    }
    this.blds = blds;
    this.rect = rect;
    this.refund = refund;
    this.g.preview.setTiles(list);
    const parts = [];
    if (blds.size) parts.push(`${blds.size} Gebäude`);
    if (roads) parts.push(`${roads} Straßenfelder`);
    if (trees) parts.push(`${trees} Bäume`);
    if (!hoverOnly) this.label(parts.length ? `${parts.join(' · ')}${refund ? ` · +${fmtMoney(refund)}` : ''}` : 'Nichts zum Abreißen', !parts.length);
  }

  commit() {
    const w = this.w;
    w.beginAction();
    let n = 0;
    for (const id of this.blds) { if (w.removeBuilding(id)) n++; }
    for (const [x, y] of this.rect) {
      const i = w.idx(x, y);
      if (w.road[i] && !w.isOutsideTile(x, y)) { w.removeRoad(x, y); n++; }
      else if (w.trees[i] && (this.rect.length === 1 || !this.blds.size)) { w.setTrees(x, y, 0); n++; }
    }
    if (!n) { w.endAction(); return; }
    w.updateNetwork();
    this.g.commitAction(w.endAction(), -this.refund);
    this.g.sound.bulldoze();
    this.g.ui.closeInfo();
  }
}

// ------------------------------------------------------------ Dienstgebäude platzieren
export class PlaceTool extends Tool {
  constructor(game, def) {
    super(game);
    this.def = def;
    this.spec = SERVICES[def];
    this.dir = 0;
    this.manualDir = false;
    this.fit = null;
    this.last = null;
  }
  get hint() {
    const touch = this.g.isTouch;
    return `${this.spec.name}: ${touch ? 'Ziehen zum Positionieren, dann ✓ tippen' : 'Klicken zum Bauen'} · ${fmtMoney(this.spec.cost)} · ${fmtMoney(this.spec.upkeep)}/Monat`;
  }

  place(t) {
    if (!t) return;
    this.last = t;
    const w = this.w;
    let fit;
    if (this.manualDir) {
      const W = this.dir % 2 === 0 ? this.spec.w : this.spec.h, H = this.dir % 2 === 0 ? this.spec.h : this.spec.w;
      const x = t.x - Math.floor((W - 1) / 2), y = t.y - Math.floor((H - 1) / 2);
      fit = { x, y, dir: this.dir, ...w.checkService(this.def, x, y, this.dir) };
    } else {
      fit = w.fitService(this.def, t.x, t.y, this.dir);
    }
    this.fit = fit;
    const p = this.g.preview;
    p.setGhost(this.def, fit.x, fit.y, fit.W, fit.H, fit.dir, fit.ok);
    const list = [];
    for (let y = fit.y; y < fit.y + fit.H; y++) for (let x = fit.x; x < fit.x + fit.W; x++) list.push({ x, y, c: fit.ok ? OK : BAD, a: 0.35, h: 0.03 });
    p.setTiles(list);
    if (this.spec.cover) p.setRing(fit.x + fit.W / 2, fit.y + fit.H / 2, this.spec.cover.r, fit.ok ? 0x4dabf7 : 0xfa5252);
    else if (this.spec.pollution) p.setRing(fit.x + fit.W / 2, fit.y + fit.H / 2, this.spec.pollution.r, 0xb07a3a);
    else p.hideRing();
    const poor = this.spec.cost > this.sim.money;
    this.label(fit.ok ? `${this.spec.name} · ${fmtMoney(this.spec.cost)}` : fit.reason, !fit.ok || poor);
    this.g.ui.positionConfirm(this.g.pending === this ? fit : null);
  }

  down(t, touch) {
    this.active = true;
    if (touch && this.g.pending === this) this.g.ui.positionConfirm(null);
    this.place(t);
  }
  move(t) { if (t && (!this.last || t.x !== this.last.x || t.y !== this.last.y)) this.place(t); }
  hover(t) {
    if (this.active || this.g.pending === this) return;
    if (!t) { this.g.preview.clear(); this.label(null); return; }
    this.place(t);
  }
  up(t, touch) {
    if (!this.active) return;
    this.active = false;
    if (touch) {
      this.g.pending = this;
      this.g.ui.positionConfirm(this.fit);
    } else {
      this.confirm();
    }
  }

  rotate() {
    this.manualDir = true;
    this.dir = ((this.fit ? this.fit.dir : this.dir) + 1) % 4;
    if (this.last) this.place(this.last);
  }

  confirm() {
    const fit = this.fit;
    if (!fit) return;
    if (!fit.ok) { this.g.ui.toast(fit.reason, 'error'); this.g.sound.error(); return; }
    if (this.spec.cost > this.sim.money) { this.g.ui.toast('Nicht genug Geld.', 'error'); this.g.sound.error(); return; }
    const w = this.w;
    w.beginAction();
    for (let y = fit.y; y < fit.y + fit.H; y++) {
      for (let x = fit.x; x < fit.x + fit.W; x++) {
        const id = w.bld[w.idx(x, y)];
        if (id >= 0) w.removeBuilding(id);
      }
    }
    w.addBuilding(makeBuilding({ kind: 'service', def: this.def, x: fit.x, y: fit.y, W: fit.W, H: fit.H, dir: fit.dir, name: this.spec.name, seed: 7 }));
    w.updateNetwork();
    this.g.commitAction(w.endAction(), this.spec.cost);
    this.g.sound.build();
    this.g.pending = null;
    this.g.ui.positionConfirm(null);
    if (this.spec.unique) { this.g.ui.selectTool(null); return; }
    this.place(this.last);
  }

  cancel() {
    super.cancel();
    if (this.g.pending === this) this.g.pending = null;
    this.g.ui.positionConfirm(null);
  }
}

// ------------------------------------------------------------ Bäume pflanzen
export class TreeTool extends Tool {
  get hint() { return `Bäume pflanzen: Über Flächen wischen · ${fmtMoney(TREE_COST)} pro Baum · Bäume senken Verschmutzung`; }
  down(t) { this.active = true; this.tiles = new Map(); this.add(t); }
  move(t) { if (this.active) this.add(t); }
  hover(t) {
    if (this.active) return;
    if (!t) { this.g.preview.clear(); return; }
    this.g.preview.setTiles([{ x: t.x, y: t.y, c: this.ok(t) ? OK : BAD, a: 0.45 }]);
  }
  ok(t) {
    const w = this.w;
    if (!t || !w.inb(t.x, t.y)) return false;
    const i = w.idx(t.x, t.y);
    return w.terrain[i] === T_LAND && !w.road[i] && w.bld[i] < 0 && w.trees[i] < 3;
  }
  add(t) {
    if (!t) return;
    for (let dy = 0; dy <= 0; dy++) {
      const k = t.y * this.w.size + t.x;
      if (this.ok(t) && !this.tiles.has(k)) this.tiles.set(k, [t.x, t.y]);
    }
    const list = [...this.tiles.values()].map(([x, y]) => ({ x, y, c: OK, a: 0.5 }));
    this.g.preview.setTiles(list);
    this.label(`${this.tiles.size} Bäume · ${fmtMoney(this.tiles.size * TREE_COST)}`, this.tiles.size * TREE_COST > this.sim.money);
  }
  up() {
    if (!this.active) return;
    const cost = this.tiles.size * TREE_COST;
    if (this.tiles.size && cost <= this.sim.money) {
      const w = this.w;
      w.beginAction();
      for (const [x, y] of this.tiles.values()) w.setTrees(x, y, Math.min(3, w.trees[w.idx(x, y)] + 2));
      this.g.commitAction(w.endAction(), cost);
      this.g.sound.zone();
    }
    this.cancel();
  }
}

export function createTool(game, spec) {
  switch (spec.kind) {
    case 'road': return new RoadTool(game, spec.type);
    case 'zone': return new ZoneTool(game, spec.zone);
    case 'bulldoze': return new BulldozeTool(game);
    case 'service': return new PlaceTool(game, spec.def);
    case 'tree': return new TreeTool(game);
    default: return null;
  }
}

export { fmt };
