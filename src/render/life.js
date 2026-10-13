// Atmosphäre: Fußgänger auf den Gehwegen und ziehende Wolken.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from './builder.js';
import { DIRS, ZONES } from '../config.js';
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

  spawn(world, sim) {
    const S = world.size;
    // Startpunkt: Zufahrt eines bewohnten Gebäudes oder eines Gewerbes
    for (let tries = 0; tries < 6; tries++) {
      const list = this.sources;
      if (!list || !list.length) return;
      const b = list[Math.floor(Math.random() * list.length)];
      const t = b.access;
      if (t < 0 || !world.road[t] || world.road[t] === 3) continue;
      const mask = world.roadMask(t % S, (t / S) | 0);
      const dirs = [0, 1, 2, 3].filter((d) => mask & (1 << d));
      const dir = dirs.length ? dirs[Math.floor(Math.random() * dirs.length)] : Math.floor(Math.random() * 4);
      this.peds.push({
        tile: t, dir, side: Math.random() < 0.5 ? 1 : -1, t: Math.random(), speed: 0.25 + Math.random() * 0.2,
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
        if (b.kind !== 'zone' || b.occ <= 0 || b.access < 0) continue;
        const k = ZONES[b.zone].key;
        if (k === 'R' || k === 'C' || k === 'O') this.sources.push(b);
      }
    }
    const night = uniforms.uNight.value;
    const target = Math.min(MAXPED, Math.round(sim.stats.pop * 0.04 * (1 - night * 0.7)));
    const S = world.size;
    const sdt = dt * Math.max(0.5, speed);
    this.spawnAcc += dt * 12;
    while (this.spawnAcc > 1 && this.peds.length < target) { this.spawnAcc -= 1; this.spawn(world, sim); }
    if (this.spawnAcc > 3) this.spawnAcc = 3;
    const arr = this.mesh.instanceMatrix.array, col = this.mesh.instanceColor.array;
    let n = 0;
    for (const p of this.peds) {
      p.life -= sdt;
      if (p.life <= 0 || !world.road[p.tile]) continue;
      p.t += p.speed * sdt;
      while (p.t >= 1) {
        p.t -= 1;
        const x = p.tile % S, y = (p.tile / S) | 0;
        const mask = world.roadMask(x, y);
        let nd = p.dir;
        if (!(mask & (1 << nd)) || Math.random() < 0.15) {
          const opts = [0, 1, 2, 3].filter((d) => (mask & (1 << d)) && d !== ((p.dir + 2) & 3));
          nd = opts.length ? opts[Math.floor(Math.random() * opts.length)] : (p.dir + 2) & 3;
        }
        const nx = x + DIRS[nd].dx, ny = y + DIRS[nd].dy;
        if (nd !== ((p.dir + 2) & 3) && world.inb(nx, ny) && world.road[ny * S + nx] && world.road[ny * S + nx] !== 3) {
          p.tile = ny * S + nx;
          p.dir = nd;
        } else {
          p.dir = (p.dir + 2) & 3;
          p.side = -p.side;
        }
      }
      if (n >= MAXPED) break;
      const x = p.tile % S, y = (p.tile / S) | 0;
      const d = DIRS[p.dir];
      const rx = -d.dy, rz = d.dx;
      const off = world.road[p.tile] === 2 ? 0.45 : 0.42;
      const px = x + 0.5 + d.dx * (p.t - 0.5) + rx * off * p.side;
      const pz = y + 0.5 + d.dy * (p.t - 0.5) + rz * off * p.side;
      const yaw = Math.atan2(d.dx, d.dy);
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
