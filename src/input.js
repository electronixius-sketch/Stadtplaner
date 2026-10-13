// Eingabe: Touch-Gesten (1 Finger Werkzeug/Verschieben, 2 Finger Zoom/Drehen/Verschieben, 3 Finger Neigen),
// Maus (Links Werkzeug/Verschieben, Rechts Drehen/Neigen, Rad Zoom) und Tastatur.

export class Input {
  constructor(canvas, game) {
    this.c = canvas;
    this.g = game;
    this.pointers = new Map();
    this.mode = 'none';
    this.toolPointer = -1;
    this.gs = null;
    this.keys = new Set();
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e, false));
    canvas.addEventListener('pointercancel', (e) => this.up(e, true));
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.pointers.size) this.g.toolHover(null); });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get cam() { return this.g.camera; }

  down(e) {
    e.preventDefault();
    try { this.c.setPointerCapture(e.pointerId); } catch (_) { /* ignorieren */ }
    this.g.sound.unlock();
    const now = performance.now();
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: now, lt: now, moved: false, type: e.pointerType };
    this.pointers.set(e.pointerId, p);
    this.cam.stopInertia();
    if (e.pointerType === 'mouse') {
      if (e.button === 2) this.mode = 'rotate';
      else if (e.button === 1) this.mode = 'pan';
      else if (this.g.tool) { this.mode = 'tool'; this.toolPointer = e.pointerId; this.g.toolDown(p.x, p.y, false); }
      else this.mode = 'pan';
      return;
    }
    const n = this.pointers.size;
    if (n === 1) {
      if (this.g.tool) { this.mode = 'tool'; this.toolPointer = e.pointerId; this.g.toolDown(p.x, p.y, true); }
      else this.mode = 'pan';
    } else if (n === 2) {
      if (this.mode === 'tool') this.g.toolCancel();
      this.mode = 'gesture';
      this.initGesture();
    } else {
      if (this.mode === 'tool') this.g.toolCancel();
      this.mode = 'tilt';
      this.initGesture();
    }
  }

  initGesture() {
    const ps = [...this.pointers.values()];
    const a = ps[0], b = ps[1];
    const mx = ps.reduce((s, p) => s + p.x, 0) / ps.length, my = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    this.gs = { mx, my, d: Math.hypot(b.x - a.x, b.y - a.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && this.g.tool) this.g.toolHover(e.clientX, e.clientY);
      return;
    }
    const px = p.x, py = p.y;
    const now = performance.now();
    const dt = (now - p.lt) / 1000;
    p.x = e.clientX; p.y = e.clientY; p.lt = now;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) p.moved = true;
    switch (this.mode) {
      case 'tool':
        if (e.pointerId === this.toolPointer) this.g.toolMove(p.x, p.y);
        break;
      case 'pan':
        if (p.moved) this.cam.panScreen(px, py, p.x, p.y, dt);
        break;
      case 'rotate':
        this.cam.rotate(-(p.x - px) * 0.006);
        this.cam.tilt((p.y - py) * 0.005);
        break;
      case 'gesture': {
        const ps = [...this.pointers.values()];
        if (ps.length < 2) break;
        const a = ps[0], b = ps[1];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        let da = ang - this.gs.a;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.cam.gesture(this.gs.mx, this.gs.my, mx, my, d / this.gs.d, da);
        this.gs = { mx, my, d, a: ang };
        break;
      }
      case 'tilt': {
        const ps = [...this.pointers.values()];
        const my = ps.reduce((s, q) => s + q.y, 0) / ps.length;
        this.cam.tilt((my - this.gs.my) * 0.006);
        this.gs.my = my;
        break;
      }
      default:
        break;
    }
  }

  up(e, cancelled) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    if (this.mode === 'tool' && e.pointerId === this.toolPointer) {
      if (cancelled) this.g.toolCancel();
      else this.g.toolUp(p.x, p.y, p.type !== 'mouse');
      this.toolPointer = -1;
      this.mode = this.pointers.size ? 'ignore' : 'none';
    } else if (this.mode === 'pan') {
      if (!p.moved && performance.now() - p.t < 450 && !cancelled) this.g.tap(p.x, p.y);
      else this.cam.releasePan();
      this.mode = 'none';
    } else if (this.mode === 'gesture' || this.mode === 'tilt') {
      if (this.pointers.size >= 2) this.initGesture();
      this.mode = this.pointers.size === 0 ? 'none' : this.pointers.size >= 2 ? this.mode : 'ignore';
    } else if (this.pointers.size === 0) {
      this.mode = 'none';
    }
  }

  wheel(e) {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.cam.zoomAt(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0012)), e.clientX, e.clientY);
  }

  keydown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.g.undo(); return; }
    this.keys.add(k);
    if (k === 'escape') this.g.escape();
    else if (k === ' ') { e.preventDefault(); this.g.togglePause(); }
    else if (k === '1' || k === '2' || k === '3') this.g.setSpeed(Number(k));
    else if (k === 'b') this.g.ui.selectTool({ kind: 'bulldoze' });
    else if (k === 'delete' || k === 'backspace') this.g.ui.selectTool({ kind: 'bulldoze' });
  }

  update(dt) {
    if (!this.keys.size) return;
    const cam = this.cam;
    const sp = cam.dist * 1.1 * dt;
    let fx = 0, fz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) fz += sp;
    if (this.keys.has('s') || this.keys.has('arrowdown')) fz -= sp;
    if (this.keys.has('a') || this.keys.has('arrowleft')) fx -= sp;
    if (this.keys.has('d') || this.keys.has('arrowright')) fx += sp;
    if (fx || fz) { cam.goal = null; cam.moveRelative(fx, fz); }
    if (this.keys.has('q')) cam.rotate(dt * 1.5);
    if (this.keys.has('e')) cam.rotate(-dt * 1.5);
    if (this.keys.has('r') || this.keys.has('+')) cam.zoomAt(Math.exp(-dt * 1.5), window.innerWidth / 2, window.innerHeight / 2);
    if (this.keys.has('f') || this.keys.has('-')) cam.zoomAt(Math.exp(dt * 1.5), window.innerWidth / 2, window.innerHeight / 2);
    if (this.keys.has('t')) cam.tilt(dt * 0.8);
    if (this.keys.has('g')) cam.tilt(-dt * 0.8);
  }
}
