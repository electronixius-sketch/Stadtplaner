// Orbit-Kamera mit "Boden greifen"-Steuerung für Touch und Maus.
import * as THREE from '../vendor/three.module.min.js';
import { clamp } from './util.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

export class CameraController {
  constructor(camera, mapSize) {
    this.cam = camera;
    this.S = mapSize;
    this.target = new THREE.Vector3(mapSize / 2, 0, mapSize / 2);
    this.yaw = 0.75;
    this.pitch = 0.92;
    this.dist = 36;
    this.minDist = 4.5;
    this.maxDist = 150;
    this.minPitch = 0.24;
    this.maxPitch = 1.48;
    this.goal = null;
    this.vel = new THREE.Vector2();
    this.lastPan = 0;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ndc = new THREE.Vector2();
    this.apply();
  }

  apply() {
    const cp = Math.cos(this.pitch);
    this.cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.cam.lookAt(this.target);
    this.cam.updateMatrixWorld();
  }

  clampAll() {
    this.dist = clamp(this.dist, this.minDist, this.maxDist);
    this.pitch = clamp(this.pitch, this.minPitch, this.maxPitch);
    const m = 6;
    this.target.x = clamp(this.target.x, -m, this.S + m);
    this.target.z = clamp(this.target.z, -m, this.S + m);
  }

  ground(sx, sy, out) {
    const r = this.cam.userData.viewport || { w: window.innerWidth, h: window.innerHeight };
    this.ndc.set((sx / r.w) * 2 - 1, -(sy / r.h) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.cam);
    const hit = this.ray.ray.intersectPlane(this.plane, out);
    if (!hit || hit.distanceTo(this.cam.position) > 700) return null;
    return hit;
  }

  // Bodenpunkt unter (px,py) soll nach der Änderung unter (sx,sy) liegen
  anchored(px, py, sx, sy, fn) {
    const before = this.ground(px, py, v1);
    const bx = before ? before.x : 0, bz = before ? before.z : 0;
    fn();
    this.clampAll();
    this.apply();
    if (!before) return;
    const after = this.ground(sx, sy, v2);
    if (!after) return;
    this.target.x += bx - after.x;
    this.target.z += bz - after.z;
    this.clampAll();
    this.apply();
  }

  panScreen(px, py, sx, sy, dt = 0.016) {
    this.goal = null;
    const a = this.ground(px, py, v1);
    if (!a) return;
    const ax = a.x, az = a.z;
    const b = this.ground(sx, sy, v2);
    if (!b) return;
    const dx = ax - b.x, dz = az - b.z;
    this.target.x += dx;
    this.target.z += dz;
    this.clampAll();
    this.apply();
    const k = 1 / Math.max(0.008, dt);
    this.vel.set(this.vel.x * 0.4 + dx * k * 0.6, this.vel.y * 0.4 + dz * k * 0.6);
    this.lastPan = performance.now();
  }

  releasePan() {
    if (performance.now() - this.lastPan > 80) this.vel.set(0, 0);
    const max = this.dist * 3;
    if (this.vel.length() > max) this.vel.setLength(max);
  }

  stopInertia() { this.vel.set(0, 0); }

  gesture(pmx, pmy, mx, my, scale, dAngle) {
    this.goal = null;
    this.anchored(pmx, pmy, mx, my, () => {
      this.dist /= scale;
      this.yaw -= dAngle;
    });
  }

  zoomAt(factor, sx, sy) {
    this.goal = null;
    this.anchored(sx, sy, sx, sy, () => { this.dist *= factor; });
  }

  rotate(d) { this.goal = null; this.yaw += d; this.apply(); }
  tilt(d) { this.goal = null; this.pitch = clamp(this.pitch + d, this.minPitch, this.maxPitch); this.apply(); }

  animateTo({ x, z, dist, yaw, pitch }) {
    this.goal = {
      x: x ?? this.target.x, z: z ?? this.target.z, dist: dist ?? this.dist,
      yaw: yaw ?? this.yaw, pitch: pitch ?? this.pitch,
    };
    this.vel.set(0, 0);
  }

  rotateBy(d) { this.animateTo({ yaw: (this.goal ? this.goal.yaw : this.yaw) + d }); }
  tiltBy(d) { this.animateTo({ pitch: clamp((this.goal ? this.goal.pitch : this.pitch) + d, this.minPitch, this.maxPitch) }); }
  zoomBy(f) { this.animateTo({ dist: clamp((this.goal ? this.goal.dist : this.dist) * f, this.minDist, this.maxDist) }); }

  moveRelative(fx, fz) {
    // fx: rechts, fz: vorwärts (Bildschirmbezogen)
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.target.x += fx * c - fz * s;
    this.target.z += -fx * s - fz * c;
    this.clampAll();
  }

  update(dt) {
    if (this.goal) {
      const k = 1 - Math.exp(-dt * 7);
      const g = this.goal;
      this.target.x += (g.x - this.target.x) * k;
      this.target.z += (g.z - this.target.z) * k;
      this.dist += (g.dist - this.dist) * k;
      this.yaw += (g.yaw - this.yaw) * k;
      this.pitch += (g.pitch - this.pitch) * k;
      if (Math.abs(g.x - this.target.x) + Math.abs(g.z - this.target.z) + Math.abs(g.dist - this.dist) * 0.2 +
        Math.abs(g.yaw - this.yaw) + Math.abs(g.pitch - this.pitch) < 0.002) this.goal = null;
    }
    if (this.vel.lengthSq() > 1e-4) {
      this.target.x += this.vel.x * dt;
      this.target.z += this.vel.y * dt;
      this.vel.multiplyScalar(Math.exp(-dt * 4.5));
    }
    this.clampAll();
    this.apply();
  }

  toJSON() { return { x: this.target.x, z: this.target.z, yaw: this.yaw, pitch: this.pitch, dist: this.dist }; }
  fromJSON(o) {
    if (!o) return;
    this.target.set(o.x, 0, o.z);
    this.yaw = o.yaw; this.pitch = o.pitch; this.dist = o.dist;
    this.goal = null;
    this.clampAll();
    this.apply();
  }
}

