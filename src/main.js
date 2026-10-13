// Stadtplaner – Einstiegspunkt. Verbindet Simulation, Rendering, Eingabe und Oberfläche.
import * as THREE from 'three';
import { MAP_SIZE, DAY_SECONDS, CLOCK_SPEED, TRAFFIC_SPEED, SERVICES } from './config.js';
import { World } from './world.js';
import { Simulation } from './sim.js';
import { Traffic } from './traffic.js';
import { SceneRenderer } from './render/scene.js';
import { createWorldMaterial, createZoneMaterial, createGhostMaterial, uniforms } from './render/materials.js';
import { ChunkManager } from './render/chunks.js';
import { createTerrain } from './render/terrainMesh.js';
import { VehicleRenderer } from './render/vehicles.js';
import { Effects } from './render/effects.js';
import { Overlay } from './render/overlay.js';
import { Preview } from './render/preview.js';
import { TreeLayer } from './render/trees.js';
import { CameraController } from './camera.js';
import { Input } from './input.js';
import { createTool } from './tools.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';
import { saveToStorage, loadFromStorage, serialize, deserialize, exportFile } from './save.js';

const SETTINGS_KEY = 'stadtplaner.settings.v1';

function loadSettings() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const def = { quality: coarse ? 'medium' : 'high', shadows: true, dayNight: true, vehicles: 350, icons: true, sound: true };
  try {
    return Object.assign(def, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
  } catch (_) {
    return def;
  }
}

class Game {
  constructor() {
    this.settings = loadSettings();
    this.canvas = document.getElementById('c');
    this.isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new SceneRenderer(this.canvas, this.settings);
    this.renderer.setPixelRatio(this.settings.quality);
    this.scene = this.renderer.scene;
    this.mats = { world: createWorldMaterial(), zone: createZoneMaterial(), ghost: createGhostMaterial() };
    this.camera = new CameraController(this.renderer.camera, MAP_SIZE);
    this.sound = new Sound();
    this.sound.enabled = this.settings.sound;
    this.overlay = new Overlay();
    this.preview = new Preview(this.scene, this.mats);
    this.effects = new Effects(this.scene, this.mats);
    this.vehicles = new VehicleRenderer(this.scene, this.mats, 600);
    this.trees = new TreeLayer(this.scene, this.mats);
    this.speed = 1;
    this.prevSpeed = 1;
    this.clock = 8.5;
    this.time = 0;
    this.simAcc = 0;
    this.uiAcc = 0;
    this.undoStack = [];
    this.tool = null;
    this.pending = null;
    this.started = false;
    this.lastPointer = null;
    this.chunks = null;
    this.terrain = null;

    const seed = Math.floor(Math.random() * 1e6);
    this.setWorld(new World(seed), null);
    this.ui = new UI(this);
    this.input = new Input(this.canvas, this);
    this.camera.animateTo({ dist: 95, pitch: 0.75 });

    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.started) this.save(); });
    window.addEventListener('pagehide', () => { if (this.started) this.save(); });
    setInterval(() => { if (this.started && this.speed > 0) this.save(); }, 60000);

    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    document.getElementById('loading').classList.add('hide');
    this.ui.showStart();
  }

  // ------------------------------------------------------------ Welt verwalten
  setWorld(world, sim) {
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
    }
    this.world = world;
    this.sim = sim || new Simulation(world, { cityName: 'Neustadt' });
    this.traffic = new Traffic(world, this.sim);
    this.traffic.maxVehicles = this.settings.vehicles;
    this.terrain = createTerrain(world, this.mats);
    this.scene.add(this.terrain.group);
    if (!this.chunks) this.chunks = new ChunkManager(this.scene, world, this.mats);
    else this.chunks.setWorld(world);
    this.chunks.rebuildAll();
    this.trees.setWorld(world);
    this.trees.update();
    this.effects.clear();
    this.preview.clear();
    this.undoStack = [];
    this.sim.computeCoverage();
    this.sim.computeEnvironment();
    this.effects.refreshIcons(world, this.sim, this.settings.icons);
    this.overlay.update(world, this.sim, this.traffic);
  }

  previewMap(seed) {
    if (this.started) return;
    this.setWorld(new World(seed), null);
    this.ui.closeInfo();
  }

  newGame(seed, name) {
    const world = new World(seed);
    const sim = new Simulation(world, { cityName: name });
    this.setWorld(world, sim);
    this.setTool(null);
    this.ui.selectTool(null);
    this.ui.closeInfo();
    this.ui.setView(null);
    this.started = true;
    this.speed = 1;
    this.clock = 8.5;
    const st = world.start;
    this.camera.animateTo({ x: st.x - 2, z: st.y + 0.5, dist: 30, pitch: 0.9, yaw: 0.6 });
    this.ui.update();
    this.ui.toast(`Willkommen in ${name}! Baue zuerst eine Straße an die Autobahn.`, 'good');
    this.save();
  }

  load() {
    const res = loadFromStorage();
    if (!res) { this.ui.toast('Kein Spielstand gefunden.', 'error'); return false; }
    this.applyLoaded(res);
    this.ui.toast(`📂 ${res.sim.cityName} geladen`, 'good');
    return true;
  }

  applyLoaded(res) {
    this.setWorld(res.world, res.sim);
    this.setTool(null);
    this.ui.selectTool(null);
    this.ui.closeInfo();
    this.ui.setView(null);
    this.ui.lastMilestone = -1;
    this.started = true;
    this.speed = 1;
    if (typeof res.clock === 'number') this.clock = res.clock;
    if (res.camera) this.camera.fromJSON(res.camera);
    this.sim.computeCoverage();
    this.sim.updateUtilities();
    this.sim.updatePopulation();
    this.ui.update();
  }

  save() {
    if (!this.started) return false;
    return saveToStorage(this);
  }

  exportSave() { if (this.started) exportFile(this); }

  importSave() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const res = deserialize(JSON.parse(await f.text()));
        this.applyLoaded(res);
        this.save();
        this.ui.toast(`📥 ${res.sim.cityName} importiert`, 'good');
      } catch (e) {
        this.ui.toast('Datei konnte nicht gelesen werden.', 'error');
      }
    };
    inp.click();
  }

  applySetting(k, v) {
    this.settings[k] = v;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (_) { /* egal */ }
    if (k === 'shadows') this.renderer.setShadows(v);
    if (k === 'quality') this.renderer.setPixelRatio(v);
    if (k === 'sound') { this.sound.enabled = v; if (v) this.sound.unlock(); }
    if (k === 'vehicles') this.traffic.maxVehicles = v;
    if (k === 'icons') this.effects.refreshIcons(this.world, this.sim, v);
  }

  toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      const el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
    }
  }

  // ------------------------------------------------------------ Zeit
  setSpeed(s) {
    if (s > 0) this.prevSpeed = s;
    this.speed = s;
    this.ui.update();
  }

  togglePause() { this.setSpeed(this.speed ? 0 : this.prevSpeed || 1); }

  // ------------------------------------------------------------ Werkzeuge
  setTool(spec) {
    if (this.tool) this.tool.dispose();
    this.pending = null;
    this.tool = spec ? createTool(this, spec) : null;
    this.chunks.setGrid(!!spec && spec.kind === 'zone');
    this.preview.clear();
  }

  pickTile(sx, sy) {
    const p = this.camera.ground(sx, sy, new THREE.Vector3());
    if (!p) return null;
    const x = Math.floor(p.x), y = Math.floor(p.z);
    if (!this.world.inb(x, y)) return null;
    return { x, y };
  }

  toolDown(sx, sy, touch) {
    this.lastPointer = { x: sx, y: sy, touch };
    if (this.tool) this.tool.down(this.pickTile(sx, sy), touch);
  }
  toolMove(sx, sy) {
    if (this.lastPointer) { this.lastPointer.x = sx; this.lastPointer.y = sy; }
    if (this.tool) this.tool.move(this.pickTile(sx, sy));
  }
  toolUp(sx, sy, touch) {
    if (this.tool) this.tool.up(this.pickTile(sx, sy), touch);
  }
  toolHover(sx, sy) {
    if (!this.tool) return;
    if (sx === null) { this.tool.hover(null); this.ui.setCursorLabel(null); return; }
    this.lastPointer = { x: sx, y: sy, touch: false };
    this.tool.hover(this.pickTile(sx, sy));
  }
  toolCancel() { if (this.tool) this.tool.cancel(); }

  commitAction(rec, cost) {
    if (!rec) return;
    rec.cost = cost;
    this.sim.money -= cost;
    this.undoStack.push(rec);
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.sim.covDirty = true;
    this.afterChange();
  }

  undo() {
    const rec = this.undoStack.pop();
    if (!rec) { this.ui.toast('Nichts zum Rückgängigmachen.', 'info'); return; }
    if (this.tool) this.tool.cancel();
    this.world.undo(rec);
    this.sim.money += rec.cost;
    this.sim.covDirty = true;
    this.sound.undo();
    this.ui.toast('↶ Rückgängig gemacht', 'info');
    this.afterChange();
  }

  afterChange() {
    this.effects.refreshIcons(this.world, this.sim, this.settings.icons);
    if (this.overlay.mode) { this.sim.computeCoverage(); this.overlay.update(this.world, this.sim, this.traffic); }
    this.ui.update();
  }

  demolish(b) {
    const w = this.world;
    w.beginAction();
    w.removeBuilding(b.id);
    w.updateNetwork();
    const refund = b.kind === 'service' ? SERVICES[b.def].cost * 0.5 : 0;
    this.commitAction(w.endAction(), -refund);
    this.sound.bulldoze();
    this.ui.closeInfo();
  }

  escape() {
    if (this.pending) { this.pending.cancel(); return; }
    if (this.tool) { this.ui.selectTool(null); return; }
    this.ui.closeInfo();
    this.ui.openCategory(null);
    this.ui.closeModal();
  }

  // ------------------------------------------------------------ Auswahl
  tap(sx, sy) {
    if (!this.started) return;
    this.ui.openCategory(null);
    document.getElementById('viewsPanel').classList.remove('show');
    const hit = this.pickBuilding(sx, sy);
    if (hit && hit.b) { this.sound.click(); this.ui.showInfo(hit.b); return; }
    if (hit && hit.tile >= 0 && this.world.road[hit.tile]) { this.sound.click(); this.ui.showRoadInfo(hit.tile); return; }
    this.ui.closeInfo();
  }

  pickBuilding(sx, sy) {
    const cam = this.camera;
    const r = this.renderer.camera;
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    cam.ray.setFromCamera(ndc, r);
    const o = cam.ray.ray.origin, d = cam.ray.ray.direction;
    if (d.y >= 0) return null;
    const top = 9;
    let t = o.y > top ? (o.y - top) / -d.y : 0;
    const w = this.world;
    for (let k = 0; k < 4000; k++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < 0) {
        const tx = Math.floor(x), tz = Math.floor(z);
        if (!w.inb(tx, tz)) return null;
        const b = w.getBuilding(tx, tz);
        return b ? { b } : { tile: w.idx(tx, tz) };
      }
      const tx = Math.floor(x), tz = Math.floor(z);
      const b = w.getBuilding(tx, tz);
      if (b && y <= (b.hgt || 0.5)) return { b };
      t += 0.06;
    }
    return null;
  }

  highlight(b) {
    if (!b) {
      uniforms.uHL.value.set(-10, -10, -10, -10);
      if (!this.tool) this.preview.hideRing();
      return;
    }
    uniforms.uHL.value.set(b.x + 0.02, b.y + 0.02, b.x + b.W - 0.02, b.y + b.H - 0.02);
    if (b.kind === 'service' && SERVICES[b.def].cover) this.preview.setRing(b.x + b.W / 2, b.y + b.H / 2, SERVICES[b.def].cover.r);
    else this.preview.hideRing();
  }

  setOverlay(mode) {
    this.overlay.set(mode);
    if (mode) { this.sim.computeCoverage(); this.overlay.update(this.world, this.sim, this.traffic); }
  }

  worldToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.renderer.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  // ------------------------------------------------------------ Hauptschleife
  afterTick() {
    for (const ev of this.sim.events) this.ui.handleEvent(ev);
    this.sim.events.length = 0;
    this.effects.refreshIcons(this.world, this.sim, this.settings.icons);
    if (this.overlay.mode) this.overlay.update(this.world, this.sim, this.traffic);
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    uniforms.uTime.value = this.time;
    this.input.update(dt);
    if (this.started) {
      if (this.speed > 0) {
        const daySec = DAY_SECONDS[this.speed];
        this.simAcc += dt;
        let n = 0;
        while (this.simAcc >= daySec && n < 3) {
          this.simAcc -= daySec;
          this.sim.tick();
          n++;
        }
        if (n) this.afterTick();
        if (this.simAcc > daySec * 3) this.simAcc = 0;
        if (this.settings.dayNight) this.clock = (this.clock + dt * CLOCK_SPEED[this.speed]) % 24;
      }
      this.traffic.update(dt, TRAFFIC_SPEED[this.speed]);
    } else {
      this.camera.yaw += dt * 0.04;
      this.clock = 9.5;
    }
    this.camera.update(dt);
    this.renderer.setTime(this.settings.dayNight ? this.clock : 12.5, this.terrain.waterMat);
    this.mats.zone.color.setScalar(1 - uniforms.uNight.value * 0.6);
    this.chunks.update(this.started ? 10 : 30);
    this.trees.update();
    this.vehicles.update(this.traffic.vehicles);
    this.effects.update(dt, this.time, this.started ? TRAFFIC_SPEED[this.speed] : 1, this.chunks, this.camera.dist);
    this.renderer.updateFrame(this.camera.target, this.camera.dist);
    if (this.pending && this.pending.fit) this.ui.positionConfirm(this.pending.fit);
    this.uiAcc += dt;
    if (this.uiAcc > 0.25 && this.started) { this.uiAcc = 0; this.ui.update(); }
    this.renderer.render();
  }
}

function boot() {
  try {
    window.game = new Game();
  } catch (e) {
    console.error(e);
    const l = document.getElementById('loading');
    l.classList.remove('hide');
    l.innerHTML = `<div class="err">😢 Das Spiel konnte nicht gestartet werden.<br><small>${String(e && e.message || e)}</small><br><small>Dein Browser benötigt WebGL 2.</small></div>`;
  }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();

export { serialize };
