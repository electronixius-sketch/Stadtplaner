// Vorschau-Darstellung für Werkzeuge: frei gedrehte Flächen (Straßenbänder, Zellen, Grundstücke),
// Geister-Gebäude und Wirkungsradius.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from './builder.js';
import { addBuilding } from './buildingGeo.js';
import { makeBuilding } from '../world.js';
import { rectCorners } from '../geom.js';

export class Preview {
  constructor(scene, mats) {
    this.tileMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.tiles = new THREE.Mesh(new THREE.BufferGeometry(), this.tileMat);
    this.tiles.renderOrder = 5;
    this.tiles.frustumCulled = false;
    this.ghostMat = mats.ghost;
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghost.renderOrder = 6;
    this.ghost.visible = false;
    const ringGeo = new THREE.RingGeometry(0.985, 1, 96);
    ringGeo.rotateX(-Math.PI / 2);
    const discGeo = new THREE.CircleGeometry(1, 96);
    discGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x4dabf7, transparent: true, opacity: 0.95, depthWrite: false }));
    this.disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0x4dabf7, transparent: true, opacity: 0.12, depthWrite: false }));
    this.ring.renderOrder = 7;
    this.disc.renderOrder = 7;
    this.ring.visible = this.disc.visible = false;
    this.ghostKey = '';
    scene.add(this.tiles, this.ghost, this.ring, this.disc);
  }

  // Liste von Flächen: { p: [[x,z], ...] (konvex, beliebiger Umlaufsinn), c: [r,g,b], a, h }
  setShapes(list) {
    const pos = [], col = [];
    for (const s of list) {
      const p = s.p, y = s.h ?? 0.07, a = s.a ?? 0.55;
      for (let k = 1; k < p.length - 1; k++) {
        const A = p[0], B = p[k], C = p[k + 1];
        const cr = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
        const tri = cr >= 0 ? [A, B, C] : [A, C, B];
        for (const q of tri) { pos.push(q[0], y, q[1]); col.push(s.c[0], s.c[1], s.c[2], a); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    this.tiles.geometry.dispose();
    this.tiles.geometry = g;
  }

  setGhost(def, rect, ok) {
    const key = `${def}:${rect.cx.toFixed(3)}:${rect.cz.toFixed(3)}:${rect.rot.toFixed(3)}`;
    if (key !== this.ghostKey) {
      this.ghostKey = key;
      const B = new MeshBuilder();
      const b = makeBuilding({ kind: 'service', def, cx: rect.cx, cz: rect.cz, rot: rect.rot, w: rect.w, d: rect.d, seed: 7 });
      this.ghostTop = addBuilding(B, b);
      this.ghost.geometry.dispose();
      this.ghost.geometry = B.toGeometry();
    }
    this.ghostMat.emissive.setHex(ok ? 0x1f7a3a : 0x9b1c1c);
    this.ghost.position.y = 0.01;
    this.ghost.visible = true;
  }

  hideGhost() { this.ghost.visible = false; this.ghostKey = ''; }

  setRing(cx, cz, r, color = 0x4dabf7) {
    for (const m of [this.ring, this.disc]) {
      m.position.set(cx, 0.08, cz);
      m.scale.set(r, 1, r);
      m.material.color.setHex(color);
      m.visible = true;
    }
  }

  hideRing() { this.ring.visible = this.disc.visible = false; }

  clear() {
    this.setShapes([]);
    this.hideGhost();
    this.hideRing();
  }
}

// Hilfen zum Erzeugen von Vorschauflächen
export function rectShape(r, c, a = 0.5, h = 0.07, shrink = 1) {
  return { p: rectCorners(r, shrink), c, a, h };
}

// Band entlang einer abgetasteten Kurve (pts/cum wie qSample) mit halber Breite hw
export function ribbonShapes(out, smp, hw, c, a = 0.55, h = 0.075) {
  const { pts, n } = smp;
  const P = (i) => [pts[i * 2], pts[i * 2 + 1]];
  for (let i = 0; i < n; i++) {
    const [ax, az] = P(i), [bx, bz] = P(i + 1);
    const tx = bx - ax, tz = bz - az, l = Math.hypot(tx, tz) || 1;
    const nx = (-tz / l) * hw, nz = (tx / l) * hw;
    out.push({ p: [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], c, a, h });
  }
}

export function discShape(x, z, r, c, a = 0.8, h = 0.08, seg = 14) {
  const p = [];
  for (let k = 0; k < seg; k++) p.push([x + Math.cos((k / seg) * Math.PI * 2) * r, z + Math.sin((k / seg) * Math.PI * 2) * r]);
  return { p, c, a, h };
}
