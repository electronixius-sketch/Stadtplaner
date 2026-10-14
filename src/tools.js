// Bauwerkzeuge für organisches Bauen: Straßen frei, gerade oder als Kurve, Zonen per Pinsel oder Füllen,
// Dienstgebäude an Straßen ausgerichtet, Abriss-Pinsel. Jede Aktion wird für "Rückgängig" aufgezeichnet.
import { ROAD_TYPES, ZONES, SERVICES, T_LAND, TREE_COST } from './config.js';
import { fmtMoney, rgb } from './util.js';
import { makeBuilding } from './world.js';
import { qSample, simplify, smoothChain, pointInRect } from './geom.js';
import { rectShape, ribbonShapes, discShape } from './render/preview.js';

const OK = rgb(0x40c057), BAD = rgb(0xfa5252), WARN = rgb(0xffa94d), DEMO = rgb(0xff6b6b);
const GUIDE = rgb(0x74c0fc), SNAP = rgb(0xffffff);
const M = 8; // Meter pro Einheit für Längenangaben

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

class Tool {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.mode = null;
    this.blds = new Set();
    this.segs = new Set();
    this.trees = new Set();
  }
  get w() { return this.g.world; }
  get sim() { return this.g.sim; }
  get hint() { return ''; }
  get modes() { return null; }
  setMode(m) {
    this.mode = m;
    this.cancel();
  }
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
}

// ------------------------------------------------------------ Straßen
export class RoadTool extends Tool {
  constructor(game, type, mode) {
    super(game);
    this.type = type;
    this.spec = ROAD_TYPES[type];
    this.mode = mode || 'free';
    this.stage = 0;
  }
  get modes() {
    return [
      { id: 'free', icon: '〰️', label: 'Freihand' },
      { id: 'straight', icon: '📏', label: 'Gerade' },
      { id: 'curve', icon: '⤵️', label: 'Kurve' },
    ];
  }
  get hint() {
    const c = `${fmtMoney(this.spec.cost)} je ${M} m`;
    if (this.mode === 'straight') return `${this.spec.name}: vom Start zum Ziel ziehen · ${c} · Straße antippen = umbauen`;
    if (this.mode === 'curve') return `${this.spec.name}: 1. Richtung ziehen, 2. Endpunkt tippen · ${c}`;
    return `${this.spec.name}: mit dem Finger zeichnen · ${c} · über Wasser als Brücke`;
  }
  setMode(m) {
    this.stage = 0;
    super.setMode(m);
  }

  snap(p) {
    const s = this.w.snapPoint(p.x, p.z);
    return { x: s.x, z: s.z, sn: s };
  }

  // Gerade Straßen rasten rechtwinklig oder in Verlängerung bestehender Straßen ein
  angleSnap(A, B) {
    const net = this.w.net, sn = A.sn;
    const dirs = [];
    if (sn.node) for (const id of sn.node.segs) { const [dx, dz] = net.armDir(net.segs.get(id), sn.node.id); dirs.push([dx, dz], [-dz, dx], [dz, -dx], [-dx, -dz]); }
    else if (sn.seg) { const p = net.at(sn.seg, sn.s); dirs.push([-p.tz, p.tx], [p.tz, -p.tx]); }
    const len = dist(A, B);
    if (!dirs.length || len < 0.5) return B;
    const ux = (B.x - A.x) / len, uz = (B.z - A.z) / len;
    for (const [dx, dz] of dirs) {
      if (ux * dx + uz * dz > Math.cos((6 * Math.PI) / 180)) return { x: A.x + dx * len, z: A.z + dz * len, snapped: true };
    }
    return B;
  }

  chain() {
    if (this.mode === 'free') {
      if (this.pts.length < 2) return null;
      let pts = simplify(this.pts, 0.3);
      // Zu dichte Stützpunkte zusammenfassen, damit keine winzigen Segmente entstehen
      const out = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const q = out[out.length - 1];
        if (Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) >= 1.4) out.push(pts[i]);
      }
      const last = pts[pts.length - 1];
      if (out.length > 1 && Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) < 0.7) out.pop();
      out.push(last);
      pts = out;
      return smoothChain(pts);
    }
    if (!this.A || !this.B || dist(this.A, this.B) < 0.3) return null;
    const A = [this.A.x, this.A.z], B = [this.B.x, this.B.z];
    if (this.mode === 'curve' && this.C) return [{ p0: A, c: [this.C.x, this.C.z], p2: B }];
    return [{ p0: A, c: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], p2: B }];
  }

  down(p) {
    if (!p) return;
    this.active = true;
    this.downAt = p;
    this.moved = false;
    if (this.mode === 'free') {
      const s = this.snap(p);
      this.pts = [[s.x, s.z]];
    } else if (this.mode === 'straight' || this.stage === 0) {
      this.A = this.snap(p);
      this.B = this.A;
      this.C = null;
    } else {
      this.B = p;
    }
    this.update();
  }

  move(p) {
    if (!this.active || !p) return;
    if (dist(p, this.downAt) > 0.3) this.moved = true;
    if (this.mode === 'free') {
      const q = this.pts[this.pts.length - 1];
      if (Math.hypot(p.x - q[0], p.z - q[1]) < 0.35) return;
      this.pts.push([p.x, p.z]);
    } else if (this.mode === 'straight') {
      this.B = this.angleSnap(this.A, p);
    } else if (this.stage === 0) {
      this.C = p;
    } else {
      this.B = p;
    }
    this.update();
  }

  hover(p) {
    if (this.active) return;
    if (!p) { if (!this.stage) this.g.preview.clear(); return; }
    if (this.mode === 'curve' && this.stage === 1) { this.B = p; this.update(); return; }
    const s = this.w.snapPoint(p.x, p.z);
    const shapes = [discShape(s.x, s.z, this.spec.width / 2, s.node || s.seg ? SNAP : OK, 0.6)];
    const near = this.w.net.nearestSeg(p.x, p.z, 0.8);
    if (near && near.d <= near.seg.hw && near.seg.type !== this.type) {
      ribbonShapes(shapes, near.seg, near.seg.hw, WARN, 0.35);
      const err = this.w.checkRoadType(near.seg.id, this.type);
      this.label(err || `Tippen: zu ${this.spec.name} umbauen · ${fmtMoney(this.upgradeCost(near.seg))}`, !!err);
    } else this.label(null);
    this.g.preview.setShapes(shapes);
  }

  up(p) {
    if (!this.active) return;
    this.active = false;
    if (!this.moved && (this.mode !== 'curve' || this.stage === 0)) {
      // Tippen auf eine bestehende Straße: Straßentyp umbauen
      if (this.upgradeAt(this.downAt)) { this.reset(); return; }
    }
    if (this.mode === 'curve' && this.stage === 0) {
      if (this.moved && this.C && dist(this.A, this.C) > 0.5) {
        this.stage = 1;
        this.B = this.C;
        this.update();
        this.label('Jetzt den Endpunkt antippen');
      } else this.reset();
      return;
    }
    if (p && this.mode === 'curve') this.B = p;
    this.update();
    this.commit();
    this.reset();
  }

  reset() {
    this.stage = 0;
    this.pts = [];
    this.A = this.B = this.C = null;
    this.plan = null;
    this.cancel();
  }

  upgradeCost(seg) { return Math.max(0, this.w.segCost(seg, this.type) - this.w.segCost(seg) * 0.5); }

  upgradeAt(p) {
    if (!p) return false;
    const w = this.w;
    const near = w.net.nearestSeg(p.x, p.z, 0.8);
    if (!near || near.d > near.seg.hw || near.seg.type === this.type) return false;
    const err = w.checkRoadType(near.seg.id, this.type);
    if (err) { this.g.ui.toast(err, 'error'); this.g.sound.error(); return true; }
    const cost = this.upgradeCost(near.seg);
    if (cost > this.sim.money) { this.g.ui.toast('Nicht genug Geld für den Umbau.', 'error'); this.g.sound.error(); return true; }
    w.beginAction();
    w.setRoadType(near.seg.id, this.type);
    this.g.commitAction(w.endAction(), cost);
    this.g.sound.build();
    this.g.ui.toast(`🔧 Zu ${this.spec.name} umgebaut`, 'info');
    return true;
  }

  update() {
    const shapes = [];
    const chain = this.chain();
    if (this.mode === 'curve' && this.A && this.C) {
      // Hilfslinien zum Kontrollpunkt
      const g = qSample([this.A.x, this.A.z], [(this.A.x + this.C.x) / 2, (this.A.z + this.C.z) / 2], [this.C.x, this.C.z], 0.5);
      ribbonShapes(shapes, g, 0.04, GUIDE, 0.8, 0.09);
      shapes.push(discShape(this.C.x, this.C.z, 0.12, GUIDE, 0.9, 0.09));
    }
    if (!chain) {
      if (this.A) shapes.push(discShape(this.A.x, this.A.z, this.spec.width / 2, SNAP, 0.5));
      this.g.preview.setShapes(shapes);
      this.plan = null;
      if (this.mode === 'curve' && this.stage === 0 && this.active) this.label('Richtung der Kurve ziehen');
      return;
    }
    const plan = this.w.planRoad(chain, this.type);
    this.plan = plan;
    const poor = plan.cost > this.sim.money;
    const col = !plan.ok ? BAD : poor ? WARN : OK;
    for (const c of plan.curves) ribbonShapes(shapes, c.smp, this.spec.width / 2, col, 0.55);
    for (const sn of [plan.s0, plan.sN]) {
      if (sn && (sn.node || sn.seg)) shapes.push(discShape(sn.x, sn.z, this.spec.width / 2 + 0.08, SNAP, 0.7, 0.085));
    }
    for (const id of plan.demolish) {
      const b = this.w.buildings.get(id);
      if (b) shapes.push(rectShape(this.w.rectOf(b), DEMO, 0.6, (b.hgt || 0.5) + 0.05));
    }
    this.g.preview.setShapes(shapes);
    const parts = [`${Math.round(plan.len * M)} m`, fmtMoney(plan.cost)];
    if (plan.bridge > 0.3) parts.push('Brücke');
    if (plan.demolish.size) parts.push(`${plan.demolish.size} Abriss`);
    this.label(plan.ok ? parts.join(' · ') : plan.reason, !plan.ok || poor);
  }

  commit() {
    const plan = this.plan;
    if (!plan) return;
    if (!plan.ok) { this.g.ui.toast(plan.reason, 'error'); this.g.sound.error(); return; }
    if (plan.cost > this.sim.money) { this.g.ui.toast('Nicht genug Geld für diese Straße.', 'error'); this.g.sound.error(); return; }
    const w = this.w;
    w.beginAction();
    w.buildRoad(plan);
    this.g.commitAction(w.endAction(), plan.cost);
    this.g.sound.build();
  }
}

// ------------------------------------------------------------ Zonen
export class ZoneTool extends Tool {
  constructor(game, zone, mode) {
    super(game);
    this.zone = zone;
    this.mode = mode || 'brush';
    this.cells = new Map();
  }
  get modes() {
    return [
      { id: 'brush', icon: '🖌️', label: 'Pinsel' },
      { id: 'big', icon: '🖌️', label: 'Großer Pinsel' },
      { id: 'fill', icon: '🪣', label: 'Füllen' },
    ];
  }
  get radius() { return this.mode === 'big' ? 2.2 : 0.8; }
  get hint() {
    const what = this.zone ? ZONES[this.zone].name : 'Zonen entfernen';
    if (this.mode === 'fill') return `${what}: Fläche antippen – füllt den ganzen Block`;
    return `${what}: Zellen entlang der Straßen bemalen${this.zone ? ' · kostenlos' : ''}`;
  }
  color() { return this.zone ? rgb(ZONES[this.zone].color) : DEMO; }
  want(c) { return c.zone !== this.zone; }

  cellAtPoint(p) {
    for (const c of this.w.cellsNear(p.x, p.z, 1)) if (pointInRect(p.x, p.z, c, 0.02)) return c;
    return null;
  }

  brush(p) {
    const r = this.radius;
    for (const c of this.w.cellsNear(p.x, p.z, r + 0.5)) {
      if (Math.hypot(c.cx - p.x, c.cz - p.z) <= r + 0.25 && this.want(c)) this.cells.set(c.idx, c);
    }
  }

  // Zusammenhängende Zellen gleicher Zone (Straßen trennen Flächen, da Zellen dort weiter auseinanderliegen)
  fill(p) {
    this.cells.clear();
    const start = this.cellAtPoint(p);
    if (!start || !this.want(start)) return;
    const z0 = start.zone;
    const seen = new Set([start.idx]);
    const q = [start];
    while (q.length && this.cells.size < 900) {
      const c = q.pop();
      this.cells.set(c.idx, c);
      for (const o of this.w.cellsNear(c.cx, c.cz, 1.4)) {
        if (seen.has(o.idx) || o.zone !== z0) continue;
        if (Math.hypot(o.cx - c.cx, o.cz - c.cz) > 1.3) continue;
        seen.add(o.idx);
        q.push(o);
      }
    }
  }

  down(p) {
    if (!p) return;
    this.active = true;
    this.cells = new Map();
    if (this.mode === 'fill') this.fill(p);
    else this.brush(p);
    this.show(p);
  }
  move(p) {
    if (!this.active || !p) return;
    if (this.mode === 'fill') this.fill(p);
    else this.brush(p);
    this.show(p);
  }
  hover(p) {
    if (this.active) return;
    if (!p) { this.g.preview.clear(); return; }
    this.cells = new Map();
    if (this.mode === 'fill') this.fill(p);
    else this.brush(p);
    this.show(p, true);
  }
  up() {
    if (!this.active) return;
    this.active = false;
    this.commit();
    this.cells = new Map();
    this.g.preview.setShapes([]);
    this.label(null);
  }

  show(p, hoverOnly = false) {
    const shapes = [];
    let replace = 0;
    const col = this.color();
    for (const c of this.cells.values()) {
      shapes.push(rectShape(c, col, hoverOnly ? 0.35 : 0.6, 0.06, 0.9));
      if (c.bld >= 0) replace++;
    }
    this.g.preview.setShapes(shapes);
    if (this.mode !== 'fill') this.g.preview.setRing(p.x, p.z, this.radius, this.zone ? ZONES[this.zone].color : 0xff6b6b);
    else this.g.preview.hideRing();
    const n = this.cells.size;
    if (hoverOnly && this.mode !== 'fill') { this.label(null); return; }
    this.label(n ? `${n} ${n === 1 ? 'Zelle' : 'Zellen'}${replace ? ` · ${replace} Gebäude werden ersetzt` : ''}` : 'Keine Zellen – Zonen entstehen entlang von Straßen', !n);
  }

  commit() {
    if (!this.cells.size) return;
    const w = this.w;
    w.beginAction();
    const list = [...this.cells.values()];
    for (const c of list) w.setCellZone(c, this.zone);
    w.clearMismatched(list);
    this.g.commitAction(w.endAction(), 0);
    this.g.sound.zone();
  }
}

// ------------------------------------------------------------ Abriss
export class BulldozeTool extends Tool {
  get hint() { return 'Abriss: Objekt antippen oder darüber wischen · 50 % Erstattung für Straßen und Dienstgebäude'; }

  // Beim Tippen genau ein Objekt, beim Wischen alles im Pinsel
  pick(p, brush) {
    const w = this.w;
    if (brush) {
      const o = w.objectsAt(p.x, p.z, 0.45);
      for (const id of o.buildings) this.blds.add(id);
      for (const id of o.segs) this.segs.add(id);
      for (const i of o.trees) this.trees.add(i);
      return;
    }
    const b = w.buildingAt(p.x, p.z, 0.02);
    if (b) { this.blds.add(b.id); return; }
    const near = w.net.nearestSeg(p.x, p.z, 1);
    if (near && near.d <= near.seg.hw + 0.05 && ![near.seg.a, near.seg.b].some((id) => w.net.nodes.get(id).outside)) { this.segs.add(near.seg.id); return; }
    const i = w.tileAt(p.x, p.z);
    if (i >= 0 && w.trees[i]) this.trees.add(i);
  }

  reset() { this.blds = new Set(); this.segs = new Set(); this.trees = new Set(); }

  down(p) {
    if (!p) return;
    this.active = true;
    this.reset();
    this.downAt = p;
    this.moved = false;
    this.pick(p, false);
    this.show();
  }
  move(p) {
    if (!this.active || !p) return;
    if (!this.moved && dist(p, this.downAt) > 0.35) { this.moved = true; this.pick(this.downAt, true); }
    if (this.moved) this.pick(p, true);
    this.show();
  }
  hover(p) {
    if (this.active) return;
    if (!p) { this.g.preview.clear(); return; }
    this.reset();
    this.pick(p, false);
    this.show(true);
  }
  up() {
    if (!this.active) return;
    this.active = false;
    this.commit();
    this.reset();
    this.g.preview.setShapes([]);
    this.label(null);
  }

  refund() {
    const w = this.w;
    let r = 0;
    for (const id of this.blds) { const b = w.buildings.get(id); if (b && b.kind === 'service') r += SERVICES[b.def].cost * 0.5; }
    for (const id of this.segs) { const s = w.net.segs.get(id); if (s) r += w.segCost(s) * 0.5; }
    return r;
  }

  show(hoverOnly = false) {
    const w = this.w, shapes = [];
    for (const id of this.segs) { const s = w.net.segs.get(id); if (s) ribbonShapes(shapes, s, s.hw + 0.04, DEMO, 0.6, 0.08); }
    for (const id of this.blds) { const b = w.buildings.get(id); if (b) shapes.push(rectShape(w.rectOf(b), DEMO, 0.65, (b.hgt || 0.5) + 0.05)); }
    for (const i of this.trees) {
      const x = i % w.size, z = (i / w.size) | 0;
      shapes.push({ p: [[x + 0.1, z + 0.1], [x + 0.9, z + 0.1], [x + 0.9, z + 0.9], [x + 0.1, z + 0.9]], c: WARN, a: 0.5, h: 0.06 });
    }
    this.g.preview.setShapes(shapes);
    const parts = [];
    if (this.blds.size) parts.push(`${this.blds.size} Gebäude`);
    if (this.segs.size) parts.push(`${this.segs.size} Straßenstück${this.segs.size > 1 ? 'e' : ''}`);
    if (this.trees.size) parts.push(`${this.trees.size} Baumfeld${this.trees.size > 1 ? 'er' : ''}`);
    const refund = this.refund();
    if (hoverOnly) { this.label(parts.length ? parts.join(' · ') : null); return; }
    this.label(parts.length ? `${parts.join(' · ')}${refund ? ` · +${fmtMoney(refund)}` : ''}` : 'Nichts zum Abreißen', !parts.length);
  }

  commit() {
    const w = this.w;
    if (!this.blds.size && !this.segs.size && !this.trees.size) return;
    const refund = this.refund();
    w.beginAction();
    for (const id of this.blds) w.removeBuilding(id);
    for (const id of this.segs) w.removeRoad(id);
    for (const i of this.trees) w.setTrees(i % w.size, (i / w.size) | 0, 0);
    w.updateNetwork();
    this.g.commitAction(w.endAction(), -refund);
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
    this.flip = false;
    this.fit = null;
    this.last = null;
  }
  get hint() {
    const touch = this.g.isTouch;
    return `${this.spec.name}: ${touch ? 'Neben eine Straße ziehen, dann ✓ tippen' : 'Neben eine Straße klicken'} · richtet sich zur Straße aus · ${fmtMoney(this.spec.cost)} · ${fmtMoney(this.spec.upkeep)}/Monat`;
  }

  place(p) {
    if (!p) return;
    this.last = p;
    const fit = this.w.fitService(this.def, p.x, p.z, { flip: this.flip });
    this.fit = fit;
    const pv = this.g.preview;
    pv.setGhost(this.def, fit, fit.ok);
    const shapes = [rectShape(fit, fit.ok ? OK : BAD, 0.35, 0.03)];
    for (const id of fit.demolish) {
      const b = this.w.buildings.get(id);
      if (b) shapes.push(rectShape(this.w.rectOf(b), DEMO, 0.5, (b.hgt || 0.5) + 0.05));
    }
    pv.setShapes(shapes);
    if (this.spec.cover) pv.setRing(fit.cx, fit.cz, this.spec.cover.r, fit.ok ? 0x4dabf7 : 0xfa5252);
    else if (this.spec.pollution) pv.setRing(fit.cx, fit.cz, this.spec.pollution.r, 0xb07a3a);
    else pv.hideRing();
    const poor = this.spec.cost > this.sim.money;
    const extra = fit.demolish.length ? ` · ${fit.demolish.length} Abriss` : '';
    this.label(fit.ok ? `${this.spec.name} · ${fmtMoney(this.spec.cost)}${extra}` : fit.reason, !fit.ok || poor);
    this.g.ui.positionConfirm(this.g.pending === this ? fit : null);
  }

  down(p, touch) {
    this.active = true;
    if (touch && this.g.pending === this) this.g.ui.positionConfirm(null);
    this.place(p);
  }
  move(p) { if (p && (!this.last || dist(p, this.last) > 0.05)) this.place(p); }
  hover(p) {
    if (this.active || this.g.pending === this) return;
    if (!p) { this.g.preview.clear(); this.label(null); return; }
    this.place(p);
  }
  up(p, touch) {
    if (!this.active) return;
    this.active = false;
    if (touch) {
      this.g.pending = this;
      this.g.ui.positionConfirm(this.fit);
    } else {
      this.confirm();
    }
  }

  // Straßenseite wechseln
  rotate() {
    this.flip = !this.flip;
    if (this.last) this.place(this.last);
  }

  confirm() {
    const fit = this.fit;
    if (!fit) return;
    if (!fit.ok) { this.g.ui.toast(fit.reason, 'error'); this.g.sound.error(); return; }
    if (this.spec.cost > this.sim.money) { this.g.ui.toast('Nicht genug Geld.', 'error'); this.g.sound.error(); return; }
    const w = this.w;
    w.beginAction();
    for (const id of fit.demolish) w.removeBuilding(id);
    w.addBuilding(makeBuilding({
      kind: 'service', def: this.def, cx: fit.cx, cz: fit.cz, rot: fit.rot, w: fit.w, d: fit.d, name: this.spec.name, seed: 7,
    }));
    w.updateNetwork();
    this.g.commitAction(w.endAction(), this.spec.cost);
    this.g.sound.build();
    this.g.pending = null;
    this.g.ui.positionConfirm(null);
    if (this.spec.unique) { this.g.ui.selectTool(null); return; }
    // Vorschau ausblenden, bis erneut getippt bzw. die Maus bewegt wird
    this.g.preview.clear();
    this.label(null);
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
  ok(i) {
    const w = this.w;
    if (i < 0) return false;
    const x = i % w.size, z = (i / w.size) | 0;
    if (w.terrain[i] !== T_LAND || w.road[i] || w.bld[i] >= 0 || w.trees[i] >= 3) return false;
    const near = w.net.nearestSeg(x + 0.5, z + 0.5, 1.2);
    return !near || near.d > near.seg.hw + 0.3;
  }
  brush(p) {
    const w = this.w;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz;
        if (!w.inb(x, z) || Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) > 0.9) continue;
        const i = w.idx(x, z);
        if (this.ok(i)) this.tiles.add(i);
      }
    }
  }
  down(p) { if (!p) return; this.active = true; this.tiles = new Set(); this.brush(p); this.show(); }
  move(p) { if (this.active && p) { this.brush(p); this.show(); } }
  hover(p) {
    if (this.active) return;
    if (!p) { this.g.preview.clear(); return; }
    const i = this.w.tileAt(p.x, p.z);
    const x = Math.floor(p.x), z = Math.floor(p.z);
    this.g.preview.setShapes([{ p: [[x + 0.05, z + 0.05], [x + 0.95, z + 0.05], [x + 0.95, z + 0.95], [x + 0.05, z + 0.95]], c: this.ok(i) ? OK : BAD, a: 0.45 }]);
  }
  show() {
    const w = this.w, shapes = [];
    for (const i of this.tiles) {
      const x = i % w.size, z = (i / w.size) | 0;
      shapes.push({ p: [[x + 0.05, z + 0.05], [x + 0.95, z + 0.05], [x + 0.95, z + 0.95], [x + 0.05, z + 0.95]], c: OK, a: 0.5 });
    }
    this.g.preview.setShapes(shapes);
    this.label(`${this.tiles.size} Bäume · ${fmtMoney(this.tiles.size * TREE_COST)}`, this.tiles.size * TREE_COST > this.sim.money);
  }
  up() {
    if (!this.active) return;
    const cost = this.tiles.size * TREE_COST;
    if (this.tiles.size && cost <= this.sim.money) {
      const w = this.w;
      w.beginAction();
      for (const i of this.tiles) w.setTrees(i % w.size, (i / w.size) | 0, Math.min(3, w.trees[i] + 2));
      this.g.commitAction(w.endAction(), cost);
      this.g.sound.zone();
    }
    this.cancel();
  }
}

export function createTool(game, spec) {
  const mode = game.toolModes ? game.toolModes[spec.kind] : undefined;
  switch (spec.kind) {
    case 'road': return new RoadTool(game, spec.type, mode);
    case 'zone': return new ZoneTool(game, spec.zone, mode);
    case 'bulldoze': return new BulldozeTool(game);
    case 'service': return new PlaceTool(game, spec.def);
    case 'tree': return new TreeTool(game);
    default: return null;
  }
}

