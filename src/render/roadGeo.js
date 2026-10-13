// Straßenfelder: Asphalt, Gehwege, Markierungen, Zebrastreifen, Laternen, Alleebäume, Brücken.
import { rgb, mulberry32, pick } from '../util.js';
import { DIRS } from '../config.js';
import { LEAF, LEAF2 } from './buildingGeo.js';

const A = {
  asph: rgb(0x4b4e54), asphH: rgb(0x3f4248), side: rgb(0xbab5ab), mark: rgb(0xeeeeea), yellow: rgb(0xf2c94c),
  median: rgb(0x6aa04a), rail: rgb(0xb0b7be), deck: rgb(0x9c9890), pillar: rgb(0x8a867e), pole: rgb(0x3a3f45),
  lamp: rgb(0xfff1c4), trunk: rgb(0x6b4a2b),
};

const Y = 0.02, MY = 0.026, SY = 0.05;

function arm(B, x, y, d) {
  const D = DIRS[d];
  B.frame(x + 0.5, y + 0.5, D.dy, -D.dx, D.dx, D.dy);
}

function popcount(m) { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; }

function crosswalk(B, half) {
  for (let u = -half + 0.04; u <= half - 0.04; u += 0.09) B.flat(u - 0.026, 0.31, u + 0.026, 0.45, MY, A.mark);
}

function lamp(B, v, u = 0) {
  // Mast auf dem Gehweg bei (u, v), Ausleger Richtung Straßenmitte
  B.box(u - 0.009, SY, v - 0.009, u + 0.009, 0.36, v + 0.009, A.pole, 0);
  B.box(u - 0.006, 0.34, v - 0.1, u + 0.006, 0.355, v, A.pole, 0);
  B.box(u - 0.022, 0.32, v - 0.13, u + 0.022, 0.345, v - 0.08, A.lamp, 2);
}

export function addRoadTile(B, x, y, type, mask, water) {
  const n = popcount(mask);
  const straight = mask === 5 || mask === 10;
  const conn = (d) => (mask & (1 << d)) !== 0;
  B.identity();
  if (water) {
    B.box(x, -0.14, y, x + 1, Y, y + 1, A.deck, 0, null);
    B.cyl(x + 0.5, y + 0.5, 0.09, -1.1, -0.14, 6, A.pillar, 0, null);
  }
  B.flat(x, y, x + 1, y + 1, Y, type === 3 ? A.asphH : A.asph);

  if (type === 1 || type === 2) {
    const SW = type === 1 ? 0.15 : 0.1;
    for (let d = 0; d < 4; d++) {
      arm(B, x, y, d);
      if (!conn(d)) {
        B.box(-0.5, 0, 0.5 - SW, 0.5, SY, 0.5, A.side, 0);
        if (water) B.box(-0.5, SY, 0.47, 0.5, 0.11, 0.49, A.rail, 0);
      } else if (conn((d + 3) % 4)) {
        B.box(0.5 - SW, 0, 0.5 - SW, 0.5, SY, 0.5, A.side, 0);
      }
    }
  }

  if (type === 1) {
    for (let d = 0; d < 4; d++) {
      if (!conn(d)) continue;
      arm(B, x, y, d);
      if (n >= 3) crosswalk(B, 0.35);
      else {
        B.flat(-0.012, 0.07, 0.012, 0.21, MY, A.mark);
        B.flat(-0.012, 0.33, 0.012, 0.47, MY, A.mark);
      }
    }
    if (straight && ((x + y) & 1) === 0) {
      const d = mask === 5 ? 1 : 0;
      arm(B, x, y, d);
      lamp(B, 0.5 - 0.075);
    }
  } else if (type === 2) {
    let treeDone = false;
    for (let d = 0; d < 4; d++) {
      if (!conn(d)) continue;
      arm(B, x, y, d);
      if (n >= 3) {
        crosswalk(B, 0.4);
        B.flat(-0.03, 0.0, -0.012, 0.3, MY, A.yellow);
        B.flat(0.012, 0.0, 0.03, 0.3, MY, A.yellow);
      } else if (straight) {
        B.box(-0.055, 0, 0, 0.055, 0.04, 0.5, A.median, 0);
        for (const u of [-0.2, 0.2]) {
          B.flat(u - 0.01, 0.07, u + 0.01, 0.2, MY, A.mark);
          B.flat(u - 0.01, 0.33, u + 0.01, 0.46, MY, A.mark);
        }
        if (!treeDone && d < 2) {
          treeDone = true;
          const r = mulberry32(x * 92821 + y * 68917);
          if ((x + y) & 1) B.tree(0, 0, 0.6, 0, pick(r, LEAF), pick(r, LEAF2), A.trunk);
          else lampMedian(B);
        }
      } else {
        B.flat(-0.03, 0.0, -0.012, 0.5, MY, A.yellow);
        B.flat(0.012, 0.0, 0.03, 0.5, MY, A.yellow);
      }
    }
    if (straight) {
      // Alleebäume auf beiden Gehwegen
      const r = mulberry32(x * 1237 + y * 7919);
      for (const d of mask === 5 ? [1, 3] : [0, 2]) {
        arm(B, x, y, d);
        B.tree(0, 0.45, 0.65 + r() * 0.2, 0, pick(r, LEAF), pick(r, LEAF2), A.trunk);
      }
    }
  } else if (type === 3) {
    for (let d = 0; d < 4; d++) {
      arm(B, x, y, d);
      if (!conn(d)) {
        B.box(-0.5, Y, 0.465, 0.5, 0.085, 0.485, A.rail, 0);
        B.box(-0.5, Y, 0.43, 0.5, MY, 0.44, A.mark, 0);
        continue;
      }
      if (straight) {
        B.box(-0.022, Y, 0, 0.022, 0.075, 0.5, A.rail, 0);
        for (const u of [-0.42, 0.42]) B.flat(u - 0.01, 0, u + 0.01, 0.5, MY, A.mark);
        for (const u of [-0.22, 0.22]) {
          B.flat(u - 0.01, 0.05, u + 0.01, 0.2, MY, A.mark);
          B.flat(u - 0.01, 0.3, u + 0.01, 0.45, MY, A.mark);
        }
      } else {
        B.flat(-0.03, 0.0, -0.012, 0.5, MY, A.yellow);
        B.flat(0.012, 0.0, 0.03, 0.5, MY, A.yellow);
      }
    }
    if (straight && x % 3 === 0) {
      B.identity();
      B.box(x + 0.49, 0.075, y + 0.49, x + 0.51, 0.42, y + 0.51, A.pole, 0);
      const alongX = mask === 10;
      if (alongX) B.box(x + 0.3, 0.4, y + 0.48, x + 0.7, 0.42, y + 0.52, A.lamp, 2);
      else B.box(x + 0.48, 0.4, y + 0.3, x + 0.52, 0.42, y + 0.7, A.lamp, 2);
    }
  }
  B.identity();
}

function lampMedian(B) {
  B.box(-0.01, 0.04, -0.01, 0.01, 0.4, 0.01, A.pole, 0);
  B.box(-0.2, 0.38, -0.012, 0.2, 0.395, 0.012, A.pole, 0);
  B.box(-0.22, 0.36, -0.02, -0.16, 0.385, 0.02, A.lamp, 2);
  B.box(0.16, 0.36, -0.02, 0.22, 0.385, 0.02, A.lamp, 2);
}
