// Info-Ansichten: färbt Gelände, Straßen und Gebäude über eine Datentextur ein.
import * as THREE from 'three';
import { MAP_SIZE, T_LAND, SERVICES, ZONES } from '../config.js';
import { uniforms } from './materials.js';

export const VIEWS = {
  landValue: { name: 'Bodenwert', icon: '💎', low: 'niedrig', high: 'hoch' },
  happiness: { name: 'Zufriedenheit', icon: '😊', low: 'unzufrieden', high: 'glücklich' },
  power: { name: 'Strom', icon: '⚡', low: 'kein Strom', high: 'versorgt' },
  water: { name: 'Wasser & Abwasser', icon: '💧', low: 'unversorgt', high: 'versorgt' },
  pollution: { name: 'Verschmutzung', icon: '🏭', low: 'sauber', high: 'verschmutzt' },
  noise: { name: 'Lärm', icon: '🔊', low: 'ruhig', high: 'laut' },
  traffic: { name: 'Verkehr', icon: '🚦', low: 'frei', high: 'Stau' },
  police: { name: 'Polizei', icon: '🚓', low: 'keine', high: 'gut abgedeckt' },
  crime: { name: 'Kriminalität', icon: '🦹', low: 'sicher', high: 'gefährlich' },
  fire: { name: 'Feuerwehr', icon: '🚒', low: 'keine', high: 'gut abgedeckt' },
  health: { name: 'Gesundheit', icon: '🩺', low: 'keine', high: 'gut abgedeckt' },
  education: { name: 'Bildung', icon: '🎓', low: 'keine', high: 'gut abgedeckt' },
  garbage: { name: 'Müllabfuhr', icon: '🗑️', low: 'keine', high: 'abgedeckt' },
  parks: { name: 'Freizeit & Parks', icon: '🌳', low: 'keine', high: 'viel Grün' },
  transit: { name: 'Nahverkehr', icon: '🚌', low: 'kein Anschluss', high: 'gut angebunden' },
};

const RED = [224, 49, 49], YEL = [250, 176, 5], GRN = [55, 178, 77], BLUE = [34, 139, 230], BROWN = [150, 95, 30],
  PURPLE = [150, 70, 200], GREY = [120, 120, 120];

function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.5) { const k = t * 2; return [RED[0] + (YEL[0] - RED[0]) * k, RED[1] + (YEL[1] - RED[1]) * k, RED[2] + (YEL[2] - RED[2]) * k]; }
  const k = (t - 0.5) * 2;
  return [YEL[0] + (GRN[0] - YEL[0]) * k, YEL[1] + (GRN[1] - YEL[1]) * k, YEL[2] + (GRN[2] - YEL[2]) * k];
}

export class Overlay {
  constructor() {
    this.data = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
    this.tex = new THREE.DataTexture(this.data, MAP_SIZE, MAP_SIZE, THREE.RGBAFormat);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    uniforms.uOverlayTex.value = this.tex;
    this.mode = null;
  }

  set(mode) {
    this.mode = mode;
    uniforms.uOverlayOn.value = mode ? 1 : 0;
  }

  update(world, sim, traffic) {
    if (!this.mode) return;
    const d = this.data, n = world.n, mode = this.mode;
    const put = (i, c, a) => { const o = i * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = a; };
    d.fill(0);
    const cov = sim.cov;
    const bOf = (i) => (world.bld[i] >= 0 ? world.buildings.get(world.bld[i]) : null);
    for (let i = 0; i < n; i++) {
      const land = world.terrain[i] === T_LAND;
      const b = bOf(i);
      switch (mode) {
        case 'landValue':
          if (land) put(i, ramp(sim.landValue[i] / 70), b ? 235 : 150);
          break;
        case 'happiness':
          if (b && b.kind === 'zone') put(i, ramp((b.happy - 15) / 70), 235);
          break;
        case 'power':
          if (b) put(i, b.power ? GRN : RED, 230);
          else if (world.road[i] && world.comp[i] >= 0) put(i, [250, 210, 60], 140);
          break;
        case 'water':
          if (b) put(i, b.water && b.sewage ? BLUE : RED, 230);
          else if (world.road[i] && world.comp[i] >= 0) put(i, [120, 190, 250], 140);
          break;
        case 'pollution': {
          const v = sim.pollution[i] / 60;
          if (land) put(i, v > 0.02 ? BROWN : GRN, v > 0.02 ? Math.min(240, 60 + v * 200) : 60);
          break;
        }
        case 'noise': {
          const v = sim.noise[i] / 60;
          if (land || world.road[i]) put(i, PURPLE, Math.min(235, v * 235));
          break;
        }
        case 'traffic':
          if (world.road[i]) put(i, ramp(1 - traffic.density[i]), 240);
          break;
        case 'crime':
          if (b && b.kind === 'zone') put(i, ramp(1 - sim.crime[i] / 50), 230);
          break;
        case 'education': {
          const v = Math.max(cov.edu1[i], cov.edu2[i], cov.edu3[i]);
          if (b && b.kind === 'zone' && ZONES[b.zone].key === 'R') put(i, ramp(b.edu * 1.3), 235);
          else if (land) put(i, BLUE, v * 170);
          break;
        }
        default: {
          const arr = cov[mode];
          if (!arr) break;
          const v = arr[i];
          if (b && b.kind === 'zone') put(i, v > 0.05 ? ramp(0.45 + v * 0.6) : RED, 220);
          else if (land) put(i, BLUE, v * 170);
        }
      }
      if (b && b.kind === 'service') {
        const def = SERVICES[b.def];
        const rel = (mode === 'power' && def.power) || (mode === 'water' && (def.water || def.sewage)) ||
          (def.cover && (def.cover.type === mode || (mode === 'education' && def.cover.type.startsWith('edu')) ||
            (mode === 'crime' && def.cover.type === 'police')));
        put(i, rel ? [255, 255, 255] : GREY, rel ? 250 : 160);
      }
    }
    this.tex.needsUpdate = true;
  }
}
