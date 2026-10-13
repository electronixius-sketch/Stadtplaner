// Vorschau-Darstellung für Werkzeuge: Feldmarkierungen, Geister-Gebäude und Wirkungsradius.
import * as THREE from 'three';
import { MeshBuilder } from './builder.js';
import { addBuilding } from './buildingGeo.js';
import { makeBuilding } from '../world.js';

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

  setTiles(list) {
    const pos = [], col = [];
    for (const t of list) {
      const x0 = t.x + 0.04, z0 = t.y + 0.04, x1 = t.x + 0.96, z1 = t.y + 0.96, y = t.h ?? 0.07;
      pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
      for (let k = 0; k < 6; k++) col.push(t.c[0], t.c[1], t.c[2], t.a ?? 0.55);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    this.tiles.geometry.dispose();
    this.tiles.geometry = g;
  }

  setGhost(def, x, y, W, H, dir, ok) {
    const key = `${def}:${x}:${y}:${dir}`;
    if (key !== this.ghostKey) {
      this.ghostKey = key;
      const B = new MeshBuilder();
      const b = makeBuilding({ kind: 'service', def, x, y, W, H, dir, seed: 7 });
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
    this.setTiles([]);
    this.hideGhost();
    this.hideRing();
  }
}
