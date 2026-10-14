// Atmosphäre: Fußgänger auf den Gehwegen und ziehende Wolken.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from './builder.js';
import { ZONES } from '../config.js';
import { uniforms } from './materials.js';

const SHIRTS = [0xe03131, 0x1c7ed6, 0xf08c00, 0x2f9e44, 0xae3ec9, 0xf4f4f0, 0x343a40, 0xfab005, 0x0ca678, 0xd6336c].map((h) => new THREE.Color(h));
const MAXPED = 320;

function personGeometry() {
  const B = new MeshBuilder();
  const body = [1, 1, 1], legs = [0.08, 0.09, 0.13], skin = [0.75, 0.52, 0.38];
  B.box(-0.009, 0, -0.006, 0.009, 0.028, 0.006, legs, 5);
  B.box(-0.011, 0.028, -0.008, 0.011, 0.055, 0.008, body, 0);
  B.box(-0.007, 0.055, -0.006, 0.007, 0.068, 0.006, skin, 5);
  return B.toGeometry();
}

export class Life {
  constructor(scene, mats) {
    this.scene = scene;
    this.peds = [];
    this.mesh = new THREE.InstancedMesh(personGeometry(), mats.world, MAXPED);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < MAXPED; i++) this.mesh.setColorAt(i, c);
    scene.add(this.mesh);
    this.spawnAcc = 0;
    this.createClouds(scene);
  }

  createClouds(scene) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false, flatShading: true });
    const n = 26 * 6;
    this.clouds = new THREE.InstancedMesh(geo, this.cloudMat, n);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 8;
    this.cloudData = [];
    for (let k = 0; k < 26; k++) {
      const cx = -60 + Math.random() * 250, cz = -60 + Math.random() * 250, cy = 34 + Math.random() * 12;
      const s = 4 + Math.random() * 5;
      for (let j = 0; j < 6; j++) {
        this.cloudData.push({
          x: cx + (Math.random() - 0.5) * s * 2.6, y: cy + Math.random() * s * 0.4, z: cz + (Math.random() - 0.5) * s * 1.4,
          s: s * (0.55 + Math.random() * 0.6),
        });
      }
    }
    this.clouds.count = this.cloudData.length;
    scene.add(this.clouds);
    this.cloudOffset = 0;
  }

  reset() { this.peds.length = 0; }

  spawn(world) {
    const net = world.net;
    // Startpunkt: Gehweg vor einem bewohnten Gebäude oder einem Gewerbe
    for (let tries = 0; tries < 6; tries++) {
      const list = this.sources;
      if (!list || !list.length) return;
      const b = list[Math.floor(Math.random() * list.length)];
      const seg = net.segs.get(b.seg);
      if (!seg || seg.type === 3) continue;
      const p = net.at(seg, b.segS);
      const side = (b.cx - p.x) * -p.tz + (b.cz - p.z) * p.tx >= 0 ? 1 : -1;
      this.peds.push({
        seg: seg.id, s: b.segS, dir: Math.random() < 0.5 ? 1 : -1, side, speed: 0.25 + Math.random() * 0.2,
        life: 20 + Math.random() * 40, color: SHIRTS[Math.floor(Math.random() * SHIRTS.length)], phase: Math.random() * 6,
      });
      return;
    }
  }

  update(dt, world, sim, speed, camDist, time) {
    const show = camDist < 45;
    this.mesh.visible = show;
    // Wolken: beim Herauszoomen einblenden
    const cloudVis = Math.max(0, Math.min(1, (camDist - 70) / 60));
    this.cloudMat.opacity = cloudVis * (0.48 - uniforms.uNight.value * 0.3);
    this.clouds.visible = cloudVis > 0.01;
    if (this.clouds.visible) {
      this.cloudOffset += dt * (0.6 + speed * 0.6);
      const m = this.tmpM || (this.tmpM = new THREE.Matrix4());
      const arr = this.clouds.instanceMatrix.array;
      this.cloudData.forEach((c, i) => {
        let x = c.x + this.cloudOffset;
        x = ((x + 80) % 300 + 300) % 300 - 80;
        m.makeScale(c.s, c.s * 0.42, c.s * 0.85).setPosition(x, c.y, c.z);
        m.toArray(arr, i * 16);
      });
      this.clouds.instanceMatrix.needsUpdate = true;
    }
    if (!show || !world) { return; }
    // Quellen für Fußgänger regelmäßig auffrischen
    if (!this.sources || this.srcDay !== sim.day) {
      this.srcDay = sim.day;
      this.sources = [];
      for (const b of world.buildings.values()) {
        if (b.kind !== 'zone' || b.occ <= 0 || b.seg < 0) continue;
        const k = ZONES[b.zone].key;
        if (k === 'R' || k === 'C' || k === 'O') this.sources.push(b);
      }
    }
    const night = uniforms.uNight.value;
    const target = Math.min(MAXPED, Math.round(sim.stats.pop * 0.04 * (1 - night * 0.7)));
    const sdt = dt * Math.max(0.5, speed);
    this.spawnAcc += dt * 12;
    while (this.spawnAcc > 1 && this.peds.length < target) { this.spawnAcc -= 1; this.spawn(world); }
    if (this.spawnAcc > 3) this.spawnAcc = 3;
    const arr = this.mesh.instanceMatrix.array, col = this.mesh.instanceColor.array;
    let n = 0;
    const net = world.net, f = {};
    for (const p of this.peds) {
      p.life -= sdt;
      let seg = net.segs.get(p.seg);
      if (p.life <= 0 || !seg) continue;
      p.s += p.dir * p.speed * sdt;
      if (p.s < 0 || p.s > seg.len) {
        // Am Knoten: auf ein anderes Segment wechseln oder umkehren
        const nodeId = p.s < 0 ? seg.a : seg.b;
        const node = net.nodes.get(nodeId);
        const opts = node ? node.segs.filter((id) => id !== seg.id && net.segs.get(id).type !== 3) : [];
        if (opts.length && Math.random() < 0.9) {
          const next = net.segs.get(opts[Math.floor(Math.random() * opts.length)]);
          const fromA = next.a === nodeId;
          // Straßenseite beibehalten: links/rechts in Laufrichtung bleibt gleich
          const lr = p.side * p.dir;
          p.dir = fromA ? 1 : -1;
          p.side = lr * p.dir;
          p.s = fromA ? 0 : next.len;
          p.seg = next.id;
          seg = next;
        } else {
          p.s = Math.max(0, Math.min(seg.len, p.s));
          p.dir = -p.dir;
        }
      }
      if (n >= MAXPED) break;
      net.at(seg, p.s, f);
      const off = seg.hw - (seg.type === 2 ? 0.06 : 0.075);
      const px = f.x - f.tz * off * p.side;
      const pz = f.z + f.tx * off * p.side;
      const yaw = Math.atan2(f.tx * p.dir, f.tz * p.dir);
      const bob = Math.abs(Math.sin(time * 9 + p.phase)) * 0.006;
      const s = Math.sin(yaw), c = Math.cos(yaw);
      const o = n * 16;
      arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -s; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = s; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
      arr[o + 12] = px; arr[o + 13] = 0.05 + bob; arr[o + 14] = pz; arr[o + 15] = 1;
      col[n * 3] = p.color.r; col[n * 3 + 1] = p.color.g; col[n * 3 + 2] = p.color.b;
      this.peds[n++] = p;
    }
    this.peds.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
