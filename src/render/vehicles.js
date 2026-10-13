// Fahrzeug-Darstellung per InstancedMesh (Autos, Lkw, Feuerwehr).
import * as THREE from 'three';
import { MeshBuilder } from './builder.js';
import { rgb } from '../util.js';
import { VEH_TRUCK, VEH_FIRE } from '../traffic.js';

const CAR_COLORS = [0xd63031, 0x0984e3, 0xfdcb6e, 0xf5f6fa, 0x2d3436, 0x00b894, 0x6c5ce7, 0xe17055, 0xb2bec3, 0x74b9ff, 0x8e44ad, 0x1e272e]
  .map((h) => new THREE.Color(h));
const TRUCK_COLORS = [0xf5f6fa, 0xe17055, 0x0984e3, 0xfdcb6e, 0x00b894].map((h) => new THREE.Color(h));

function carGeometry() {
  const B = new MeshBuilder();
  const body = [1, 1, 1], glass = rgb(0x26313b), dark = rgb(0x1c1f22);
  // vorne = +z
  B.box(-0.052, 0.012, -0.105, 0.052, 0.055, 0.105, body, 0);
  B.box(-0.046, 0.055, -0.06, 0.046, 0.088, 0.045, glass, 5, body);
  B.box(-0.045, 0.02, 0.104, -0.025, 0.04, 0.108, rgb(0xfff4c8), 2);
  B.box(0.025, 0.02, 0.104, 0.045, 0.04, 0.108, rgb(0xfff4c8), 2);
  B.box(-0.045, 0.025, -0.109, -0.028, 0.04, -0.105, rgb(0xff2a2a), 2);
  B.box(0.028, 0.025, -0.109, 0.045, 0.04, -0.105, rgb(0xff2a2a), 2);
  B.box(-0.054, 0.0, -0.08, 0.054, 0.025, -0.045, dark, 5, null);
  B.box(-0.054, 0.0, 0.045, 0.054, 0.025, 0.08, dark, 5, null);
  return B.toGeometry();
}

function truckGeometry(fire) {
  const B = new MeshBuilder();
  const body = [1, 1, 1], cab = fire ? rgb(0xd63a2f) : rgb(0xe8e8e8), glass = rgb(0x26313b);
  B.box(-0.058, 0.015, 0.06, 0.058, 0.095, 0.16, cab, 5);
  B.box(-0.054, 0.06, 0.13, 0.054, 0.09, 0.162, glass, 5, null);
  B.box(-0.06, 0.02, -0.16, 0.06, 0.12, 0.055, body, 0);
  B.box(-0.045, 0.02, 0.158, -0.025, 0.04, 0.163, rgb(0xfff4c8), 2);
  B.box(0.025, 0.02, 0.158, 0.045, 0.04, 0.163, rgb(0xfff4c8), 2);
  if (fire) {
    B.box(-0.04, 0.095, 0.1, 0.04, 0.11, 0.13, rgb(0x3d8bff), 2);
    B.box(-0.01, 0.12, -0.15, 0.01, 0.13, 0.05, rgb(0xd0d0d0), 5);
  }
  return B.toGeometry();
}

export class VehicleRenderer {
  constructor(scene, mats, max = 600) {
    this.max = max;
    this.cars = new THREE.InstancedMesh(carGeometry(), mats.world, max);
    this.trucks = new THREE.InstancedMesh(truckGeometry(false), mats.world, Math.ceil(max / 2));
    this.fire = new THREE.InstancedMesh(truckGeometry(true), mats.world, 32);
    this.fire.material = mats.world;
    for (const m of [this.cars, this.trucks, this.fire]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.count = 0;
      scene.add(m);
    }
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) this.cars.setColorAt(i, c);
    for (let i = 0; i < this.trucks.count || i < Math.ceil(max / 2); i++) this.trucks.setColorAt(i, c);
    this.fire.setColorAt(0, new THREE.Color(0xd63a2f));
    for (let i = 1; i < 32; i++) this.fire.setColorAt(i, new THREE.Color(0xd63a2f));
  }

  setVisible(v) { this.cars.visible = this.trucks.visible = this.fire.visible = v; }

  update(vehicles) {
    let nc = 0, nt = 0, nf = 0;
    const ca = this.cars.instanceMatrix.array, ta = this.trucks.instanceMatrix.array, fa = this.fire.instanceMatrix.array;
    const cc = this.cars.instanceColor.array, tc = this.trucks.instanceColor.array;
    const tMax = this.trucks.instanceMatrix.count;
    for (const v of vehicles) {
      let arr, idx;
      if (v.type === VEH_FIRE) { if (nf >= 32) continue; arr = fa; idx = nf++; }
      else if (v.type === VEH_TRUCK) {
        if (nt >= tMax) continue;
        arr = ta; idx = nt++;
        const col = TRUCK_COLORS[v.color % TRUCK_COLORS.length];
        tc[idx * 3] = col.r; tc[idx * 3 + 1] = col.g; tc[idx * 3 + 2] = col.b;
      } else {
        if (nc >= this.max) continue;
        arr = ca; idx = nc++;
        const col = CAR_COLORS[v.color % CAR_COLORS.length];
        cc[idx * 3] = col.r; cc[idx * 3 + 1] = col.g; cc[idx * 3 + 2] = col.b;
      }
      const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
      const o = idx * 16;
      arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -s; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = s; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
      arr[o + 12] = v.x; arr[o + 13] = 0.02; arr[o + 14] = v.z; arr[o + 15] = 1;
    }
    this.cars.count = nc; this.trucks.count = nt; this.fire.count = nf;
    this.cars.instanceMatrix.needsUpdate = true;
    this.trucks.instanceMatrix.needsUpdate = true;
    this.fire.instanceMatrix.needsUpdate = true;
    this.cars.instanceColor.needsUpdate = true;
    this.trucks.instanceColor.needsUpdate = true;
  }
}
