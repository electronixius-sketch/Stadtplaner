// Effekte: Rauch/Dampf aus Schornsteinen, Feuer, Windrad-Rotoren und Status-Symbole über Gebäuden.
import * as THREE from 'three';
import { MeshBuilder } from './builder.js';
import { ZONES } from '../config.js';

const MAXP = 700;

function rotorGeometry() {
  const B = new MeshBuilder();
  const white = [0.92, 0.92, 0.92];
  B.box(-0.03, -0.03, -0.03, 0.03, 0.03, 0.05, white, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    // Blatt als flacher Keil in der xy-Ebene
    const p = (r, w) => [c * r - s * w, s * r + c * w];
    const [ax, ay] = p(0.03, -0.035), [bx, by] = p(0.8, -0.012), [cx, cy] = p(0.8, 0.012), [dx, dy] = p(0.03, 0.035);
    B.quad([ax, ay, 0], [bx, by, 0], [cx, cy, 0], [dx, dy, 0], white);
    B.quad([dx, dy, 0.004], [cx, cy, 0.004], [bx, by, 0.004], [ax, ay, 0.004], white);
  }
  return B.toGeometry();
}

const ICONS = {
  power: '⚡', water: '💧', sewage: '🚽', garbage: '🗑️', fire: '🔥', abandoned: '🏚️', road: '🚧', noWorkers: '👷',
};

function iconTexture(ch, bg) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(48, 48, 42, 0, Math.PI * 2);
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.font = '50px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, 48, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene, mats) {
    this.scene = scene;
    // Partikel
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.smokeMat = new THREE.MeshLambertMaterial({ color: 0xb8b8b8, transparent: true, opacity: 0.5, depthWrite: false });
    this.smoke = new THREE.InstancedMesh(geo, this.smokeMat, MAXP);
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;
    this.smoke.renderOrder = 3;
    const col = new THREE.Color(1, 1, 1);
    for (let i = 0; i < MAXP; i++) this.smoke.setColorAt(i, col);
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flames = new THREE.InstancedMesh(geo, this.flameMat, 300);
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flames.frustumCulled = false;
    this.flames.count = 0;
    this.flames.renderOrder = 4;
    for (let i = 0; i < 300; i++) this.flames.setColorAt(i, new THREE.Color(1, 0.5, 0.1));
    scene.add(this.smoke, this.flames);
    this.parts = [];
    this.fparts = [];
    // Rotoren
    this.rotors = new THREE.InstancedMesh(rotorGeometry(), mats.world, 256);
    this.rotors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rotors.count = 0;
    this.rotors.frustumCulled = false;
    this.rotors.castShadow = true;
    scene.add(this.rotors);
    this.rotorAngle = 0;
    // Statussymbole
    this.iconMats = {};
    for (const [k, ch] of Object.entries(ICONS)) {
      const bg = k === 'fire' ? '#ff6b35' : k === 'abandoned' ? '#6c757d' : '#e03131';
      this.iconMats[k] = new THREE.SpriteMaterial({ map: iconTexture(ch, bg), depthTest: false, transparent: true });
    }
    this.icons = new THREE.Group();
    this.icons.renderOrder = 10;
    scene.add(this.icons);
    this.spritePool = [];
    this.iconList = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.e = new THREE.Euler();
    this.emitAcc = 0;
  }

  // Status-Symbole aus Gebäudezuständen neu aufbauen (nach jedem Sim-Tick)
  refreshIcons(world, sim, show) {
    const list = [];
    if (show) {
      for (const b of world.buildings.values()) {
        let k = null;
        if (b.fire > 0) k = 'fire';
        else if (b.kind === 'zone') {
          if (b.built < 1 && b.level === 1) continue;
          if (b.abandoned) k = 'abandoned';
          else if (b.access < 0) k = 'road';
          else if (!b.power) k = 'power';
          else if (!b.water) k = 'water';
          else if (!b.sewage) k = 'sewage';
          else if (!b.garbage && sim.stats.pop > 400) k = 'garbage';
        } else if (b.access < 0) k = 'road';
        else if (!b.power) k = 'power';
        if (k) list.push([b, k]);
        if (list.length >= 400) break;
      }
    }
    while (this.spritePool.length < list.length) {
      const s = new THREE.Sprite(this.iconMats.power);
      s.scale.set(0.42, 0.42, 1);
      s.renderOrder = 10;
      this.spritePool.push(s);
      this.icons.add(s);
    }
    for (let i = 0; i < this.spritePool.length; i++) {
      const s = this.spritePool[i];
      if (i < list.length) {
        const [b, k] = list[i];
        s.visible = true;
        s.material = this.iconMats[k];
        s.position.set(b.x + b.W / 2, (b.hgt || 0.5) + 0.35, b.y + b.H / 2);
        s.userData.base = s.position.y;
        s.userData.phase = b.id * 0.7;
      } else s.visible = false;
    }
    this.iconCount = list.length;
    this.burning = [];
    for (const b of world.buildings.values()) if (b.fire > 0) this.burning.push(b);
  }

  update(dt, time, timeScale, chunks, camDist) {
    // Rotoren
    let n = 0;
    this.rotorAngle += dt * (1.2 + timeScale * 0.8);
    const arr = this.rotors.instanceMatrix.array;
    for (const ch of chunks.chunks) {
      for (const r of ch.rotors) {
        if (n >= 256) break;
        this.e.set(0, r.yaw, 0, 'YXZ');
        this.q.setFromEuler(this.e);
        const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.rotorAngle + (r.x * 1.3 + r.z));
        this.q.multiply(qz);
        this.m.compose(this.v.set(r.x, r.y, r.z), this.q, this.s.set(r.size, r.size, r.size));
        this.m.toArray(arr, n * 16);
        n++;
      }
    }
    this.rotors.count = n;
    this.rotors.instanceMatrix.needsUpdate = true;

    // Partikel emittieren
    const sdt = dt * Math.max(0.6, timeScale);
    this.emitAcc += sdt;
    if (this.emitAcc > 0.12) {
      const steps = Math.min(3, Math.floor(this.emitAcc / 0.12));
      this.emitAcc -= steps * 0.12;
      for (let s = 0; s < steps; s++) {
        for (const ch of chunks.chunks) {
          for (const e of ch.emitters) {
            if (this.parts.length >= MAXP) break;
            if (Math.random() > 0.55 * e.rate) continue;
            const steam = e.type === 'steam';
            this.parts.push({
              x: e.x + (Math.random() - 0.5) * 0.05, y: e.y, z: e.z + (Math.random() - 0.5) * 0.05,
              vx: 0.12 + Math.random() * 0.06, vy: steam ? 0.45 : 0.32, vz: 0.05 + Math.random() * 0.04,
              age: 0, life: steam ? 4 : 5 + Math.random() * 2, size: steam ? 0.18 : 0.08, grow: steam ? 0.22 : 0.12,
              c: steam ? 0.97 : 0.55 + Math.random() * 0.15,
            });
          }
        }
        for (const b of this.burning || []) {
          const top = (b.hgt || 0.5) * 0.8;
          for (let k = 0; k < 5; k++) {
            if (this.fparts.length < 300) {
              this.fparts.push({
                x: b.x + 0.2 + Math.random() * (b.W - 0.4), y: top * (0.35 + Math.random() * 0.75), z: b.y + 0.2 + Math.random() * (b.H - 0.4),
                vy: 0.5 + Math.random() * 0.4, age: 0, life: 0.6 + Math.random() * 0.5, size: 0.11 + Math.random() * 0.1,
              });
            }
          }
          if (this.parts.length < MAXP) {
            this.parts.push({
              x: b.x + b.W / 2 + (Math.random() - 0.5) * 0.3, y: top + 0.1, z: b.y + b.H / 2 + (Math.random() - 0.5) * 0.3,
              vx: 0.15, vy: 0.5, vz: 0.05, age: 0, life: 5, size: 0.14, grow: 0.25, c: 0.18,
            });
          }
        }
      }
    }
    // Rauch aktualisieren
    const sa = this.smoke.instanceMatrix.array, sc = this.smoke.instanceColor.array;
    let j = 0;
    for (const p of this.parts) {
      p.age += sdt;
      if (p.age >= p.life) continue;
      p.x += p.vx * sdt; p.y += p.vy * sdt; p.z += p.vz * sdt;
      p.vy *= 0.995;
      const t = p.age / p.life;
      const sz = (p.size + p.grow * p.age) * (t > 0.75 ? 1 - (t - 0.75) * 3 : 1);
      const o = j * 16;
      sa[o] = sz; sa[o + 1] = 0; sa[o + 2] = 0; sa[o + 3] = 0;
      sa[o + 4] = 0; sa[o + 5] = sz * 0.85; sa[o + 6] = 0; sa[o + 7] = 0;
      sa[o + 8] = 0; sa[o + 9] = 0; sa[o + 10] = sz; sa[o + 11] = 0;
      sa[o + 12] = p.x; sa[o + 13] = p.y; sa[o + 14] = p.z; sa[o + 15] = 1;
      const c = p.c + t * 0.2;
      sc[j * 3] = c; sc[j * 3 + 1] = c; sc[j * 3 + 2] = c;
      this.parts[j++] = p;
    }
    this.parts.length = j;
    this.smoke.count = j;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.smoke.instanceColor.needsUpdate = true;
    // Flammen
    const fa = this.flames.instanceMatrix.array, fc = this.flames.instanceColor.array;
    let k = 0;
    for (const p of this.fparts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.y += p.vy * dt;
      const t = p.age / p.life;
      const sz = p.size * (1 - t);
      const o = k * 16;
      fa[o] = sz; fa[o + 1] = 0; fa[o + 2] = 0; fa[o + 3] = 0;
      fa[o + 4] = 0; fa[o + 5] = sz * 1.6; fa[o + 6] = 0; fa[o + 7] = 0;
      fa[o + 8] = 0; fa[o + 9] = 0; fa[o + 10] = sz; fa[o + 11] = 0;
      fa[o + 12] = p.x; fa[o + 13] = p.y; fa[o + 14] = p.z; fa[o + 15] = 1;
      fc[k * 3] = 1; fc[k * 3 + 1] = 0.75 - t * 0.6; fc[k * 3 + 2] = 0.2 - t * 0.2;
      this.fparts[k++] = p;
    }
    this.fparts.length = k;
    this.flames.count = k;
    this.flames.instanceMatrix.needsUpdate = true;
    this.flames.instanceColor.needsUpdate = true;
    // Symbole wippen lassen und mit Zoom skalieren
    const sc2 = Math.min(0.95, Math.max(0.22, 0.16 + camDist * 0.0065));
    for (let i = 0; i < (this.iconCount || 0); i++) {
      const s = this.spritePool[i];
      s.position.y = s.userData.base + Math.sin(time * 3 + s.userData.phase) * 0.06;
      s.scale.set(sc2, sc2, 1);
    }
  }

  clear() {
    this.parts.length = 0;
    this.fparts.length = 0;
  }
}

export { ZONES };
