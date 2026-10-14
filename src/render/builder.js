// MeshBuilder: sammelt Low-Poly-Geometrie (Position, Normale, Farbe, Fenstercode) in einem lokalen
// Grundstücks-Koordinatensystem und erzeugt daraus eine BufferGeometry.
import * as THREE from '../../vendor/three.module.min.js';

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.win = [];
    this.emitters = [];
    this.rotors = [];
    this.tint = null;
    this.winOff = false;
    this.identity();
  }

  identity() { this.frame(0, 0, 1, 0, 0, 1, 0); }

  // Ursprung (ox,oz), Seitenachse L, Tiefenachse D (beide in Welt-xz)
  frame(ox, oz, Lx, Lz, Dx, Dz, oy = 0) {
    this.ox = ox; this.oz = oz; this.oy = oy;
    this.Lx = Lx; this.Lz = Lz; this.Dx = Dx; this.Dz = Dz;
  }

  // Grundstücksrahmen: lokales x entlang der Straßenfront, lokales z in die Tiefe (Front bei z=0)
  lotFrame(x0, y0, W, H, dir, oy = 0) {
    switch (dir) {
      case 0: this.frame(x0, y0, 1, 0, 0, 1, oy); return { w: W, d: H };
      case 2: this.frame(x0 + W, y0 + H, -1, 0, 0, -1, oy); return { w: W, d: H };
      case 1: this.frame(x0 + W, y0, 0, 1, -1, 0, oy); return { w: H, d: W };
      default: this.frame(x0, y0 + H, 0, -1, 1, 0, oy); return { w: H, d: W };
    }
  }

  // Gedrehtes Grundstück {cx, cz, rot, w, d}: Front (Straße) bei lokal z = 0
  rotFrame(cx, cz, rot, w, d, oy = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    this.frame(cx - c * w / 2 + s * d / 2, cz - s * w / 2 - c * d / 2, c, s, -s, c, oy);
    return { w, d };
  }

  // Helfer in Weltkoordinaten (Rahmen = Identität), Ausrichtung wird automatisch korrigiert
  triUp(ax, az, bx, bz, cx, cz, y, col, w = 0) {
    const cr = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (Math.abs(cr) < 1e-10) return;
    if (cr > 0) this.tri([ax, y, az], [bx, y, bz], [cx, y, cz], col, w);
    else this.tri([ax, y, az], [cx, y, cz], [bx, y, bz], col, w);
  }

  quadUp(a, b, c, d, y, col, w = 0) {
    this.triUp(a[0], a[1], b[0], b[1], c[0], c[1], y, col, w);
    this.triUp(a[0], a[1], c[0], c[1], d[0], d[1], y, col, w);
  }

  // Senkrechte Wand von a nach b, Normale zeigt Richtung (fx, fz)
  wall(a, b, y0, y1, col, fx, fz, w = 0) {
    if ((b[1] - a[1]) * fx - (b[0] - a[0]) * fz < 0) { const t = a; a = b; b = t; }
    this.quad([a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]], col, w);
  }

  wx(lx, lz) { return this.ox + this.Lx * lx + this.Dx * lz; }
  wz(lx, lz) { return this.oz + this.Lz * lx + this.Dz * lz; }

  _push(x, y, z, nx, ny, nz, c, w) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(c[0], c[1], c[2]);
    this.win.push(w);
  }

  _color(c) { return this.tint ? this.tint(c) : c; }
  _win(w) {
    if (this.winOff && (w === 1 || w === 3 || w === 4)) return w + 5;
    if (this.winOff && w === 2) return 0;
    return w;
  }

  // Dreieck in lokalen Koordinaten (gegen den Uhrzeigersinn von außen gesehen)
  tri(a, b, c, col, w = 0) {
    const oy = this.oy;
    const ax = this.wx(a[0], a[2]), ay = a[1] + oy, az = this.wz(a[0], a[2]);
    const bx = this.wx(b[0], b[2]), by = b[1] + oy, bz = this.wz(b[0], b[2]);
    const cx = this.wx(c[0], c[2]), cy = c[1] + oy, cz = this.wz(c[0], c[2]);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const cc = this._color(col), ww = this._win(w);
    this._push(ax, ay, az, nx, ny, nz, cc, ww);
    this._push(bx, by, bz, nx, ny, nz, cc, ww);
    this._push(cx, cy, cz, nx, ny, nz, cc, ww);
  }

  quad(a, b, c, d, col, w = 0) {
    this.tri(a, b, c, col, w);
    this.tri(a, c, d, col, w);
  }

  // Quader von (x0,y0,z0) bis (x1,y1,z1). top: Farbe der Oberseite oder null
  box(x0, y0, z0, x1, y1, z1, col, w = 0, top = undefined, bottom = false) {
    const t = top === undefined ? col : top;
    if (t) this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], t, 0);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, 0);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], col, w);
    this.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], col, w);
    this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], col, w);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], col, w);
  }

  // Flache Fläche nach oben
  flat(x0, z0, x1, z1, y, col) {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], col, 0);
  }

  // Satteldach; alongX: First parallel zur lokalen x-Achse
  gable(x0, z0, x1, z1, y, h, col, alongX = true, gableCol = null) {
    const gc = gableCol || col;
    if (alongX) {
      const zm = (z0 + z1) / 2;
      this.quad([x0, y, z0], [x0, y + h, zm], [x1, y + h, zm], [x1, y, z0], col);
      this.quad([x1, y, z1], [x1, y + h, zm], [x0, y + h, zm], [x0, y, z1], col);
      this.tri([x0, y, z1], [x0, y + h, zm], [x0, y, z0], gc);
      this.tri([x1, y, z0], [x1, y + h, zm], [x1, y, z1], gc);
    } else {
      const xm = (x0 + x1) / 2;
      this.quad([x1, y, z0], [xm, y + h, z0], [xm, y + h, z1], [x1, y, z1], col);
      this.quad([x0, y, z1], [xm, y + h, z1], [xm, y + h, z0], [x0, y, z0], col);
      this.tri([x0, y, z0], [xm, y + h, z0], [x1, y, z0], gc);
      this.tri([x1, y, z1], [xm, y + h, z1], [x0, y, z1], gc);
    }
  }

  // Walmdach (bei quadratischer Grundfläche Pyramide)
  hip(x0, z0, x1, z1, y, h, col) {
    const dx = x1 - x0, dz = z1 - z0;
    const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
    const yt = y + h;
    if (Math.abs(dx - dz) < 0.02) {
      this.tri([x0, y, z0], [xm, yt, zm], [x1, y, z0], col);
      this.tri([x1, y, z0], [xm, yt, zm], [x1, y, z1], col);
      this.tri([x1, y, z1], [xm, yt, zm], [x0, y, z1], col);
      this.tri([x0, y, z1], [xm, yt, zm], [x0, y, z0], col);
    } else if (dx > dz) {
      const i = dz / 2;
      this.quad([x0, y, z0], [x0 + i, yt, zm], [x1 - i, yt, zm], [x1, y, z0], col);
      this.quad([x1, y, z1], [x1 - i, yt, zm], [x0 + i, yt, zm], [x0, y, z1], col);
      this.tri([x0, y, z1], [x0 + i, yt, zm], [x0, y, z0], col);
      this.tri([x1, y, z0], [x1 - i, yt, zm], [x1, y, z1], col);
    } else {
      const i = dx / 2;
      this.quad([x1, y, z0], [xm, yt, z0 + i], [xm, yt, z1 - i], [x1, y, z1], col);
      this.quad([x0, y, z1], [xm, yt, z1 - i], [xm, yt, z0 + i], [x0, y, z0], col);
      this.tri([x0, y, z0], [xm, yt, z0 + i], [x1, y, z0], col);
      this.tri([x1, y, z1], [xm, yt, z1 - i], [x0, y, z1], col);
    }
  }

  // Zylinder (Mantel + Deckel)
  cyl(cx, cz, r, y0, y1, seg, col, w = 0, top = undefined, r1 = r) {
    const t = top === undefined ? col : top;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad([cx + c0 * r, y0, cz + s0 * r], [cx + c0 * r1, y1, cz + s0 * r1], [cx + c1 * r1, y1, cz + s1 * r1],
        [cx + c1 * r, y0, cz + s1 * r], col, w);
      if (t) this.tri([cx, y1, cz], [cx + c1 * r1, y1, cz + s1 * r1], [cx + c0 * r1, y1, cz + s0 * r1], t);
    }
  }

  cone(cx, cz, r, y0, y1, seg, col) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      this.tri([cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx, y1, cz],
        [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], col);
    }
  }

  // Oktaeder-Krone (Laubbaum, Büsche)
  blob(cx, cy, cz, r, h, col, col2 = col) {
    const t = [cx, cy + h, cz], b = [cx, cy - h * 0.7, cz];
    const p = [[cx + r, cy, cz], [cx, cy, cz + r], [cx - r, cy, cz], [cx, cy, cz - r]];
    for (let k = 0; k < 4; k++) {
      const a = p[k], c = p[(k + 1) % 4];
      this.tri(a, t, c, k % 2 ? col : col2);
      this.tri(c, b, a, col2);
    }
  }

  // Ikosaeder-Krone (rundlicher Laubbaum)
  ico(cx, cy, cz, r, h, col, col2 = col) {
    const t = (1 + Math.sqrt(5)) / 2, l = Math.sqrt(1 + t * t);
    const V = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
    const I = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2,
      3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    const p = (k) => [cx + (V[k * 3] / l) * r, cy + (V[k * 3 + 1] / l) * h, cz + (V[k * 3 + 2] / l) * r];
    for (let f = 0; f < 20; f++) this.tri(p(I[f * 3]), p(I[f * 3 + 1]), p(I[f * 3 + 2]), f % 3 ? col : col2);
  }

  tree(x, z, s, kind, c1, c2, trunk) {
    if (kind === 0) {
      this.box(x - 0.018 * s, 0, z - 0.018 * s, x + 0.018 * s, 0.12 * s, z + 0.018 * s, trunk, 0, null);
      this.blob(x, 0.24 * s, z, 0.14 * s, 0.15 * s, c1, c2);
    } else {
      this.box(x - 0.015 * s, 0, z - 0.015 * s, x + 0.015 * s, 0.08 * s, z + 0.015 * s, trunk, 0, null);
      this.cone(x, z, 0.12 * s, 0.06 * s, 0.32 * s, 5, c1);
      this.cone(x, z, 0.085 * s, 0.22 * s, 0.46 * s, 5, c2);
    }
  }

  emitter(lx, ly, lz, type, rate = 1) {
    this.emitters.push({ x: this.wx(lx, lz), y: ly + this.oy, z: this.wz(lx, lz), type, rate });
  }

  rotor(lx, ly, lz, size = 1) {
    // Rotor blickt entlang lokal -z (zur Straße)
    this.rotors.push({ x: this.wx(lx, lz), y: ly + this.oy, z: this.wz(lx, lz), yaw: Math.atan2(-this.Dx, -this.Dz), size });
  }

  get count() { return this.pos.length / 3; }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWin', new THREE.Float32BufferAttribute(this.win, 1));
    g.computeBoundingSphere();
    return g;
  }
}
