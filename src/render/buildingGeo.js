// Prozedurale Low-Poly-Gebäude. Alle Generatoren arbeiten im lokalen Grundstücksrahmen:
// x entlang der Straßenfront (0..w), z in die Tiefe (0..d), Front (Straße) bei z = 0.
import { rgb, mulberry32, pick, mixc, scalec, clamp } from '../util.js';

const P = (a) => a.map(rgb);
const WALLS_HOUSE = P([0xf3e9d8, 0xe9d6b6, 0xf2d8c8, 0xdfe8ee, 0xf0e2b6, 0xe8e2d6, 0xf7f2e8, 0xd9c4a6, 0xcfdccb, 0xf4cfa8, 0xe7c9b0]);
const ROOFS = P([0xa9483a, 0x8a3a2c, 0x6b4a3e, 0x4f5c68, 0x7b3e2f, 0x9b6a4d, 0x3f4b55, 0xb5654a, 0x5d4037]);
const PLASTER = P([0xe8dfd0, 0xd9cbb6, 0xc9b8a2, 0xe0d6c8, 0xd8c3a2, 0xcfd3d6, 0xe6d3b3, 0xd4b8a0, 0xbfcad3]);
const MODERN = P([0xe4e4e2, 0xc8ccd0, 0xb8bec5, 0xe6e2da, 0xa3acb5, 0xd2c6b4, 0xf0ede6]);
const ACCENT = P([0xe03131, 0x1c7ed6, 0xf08c00, 0x2f9e44, 0xae3ec9, 0x0ca678, 0xf59f00, 0xd6336c, 0x4263eb]);
const SOFT = P([0x6b7f99, 0x8a6f5a, 0x5f7f6a, 0x9a5b4d, 0x4d5d6e, 0xb08d57]);
const GLASS = P([0x6f9cc4, 0x5f88ad, 0x86b3c7, 0x557a96, 0x9bbfd6, 0x4d6f8a, 0x7aa6a0, 0x8aa0b8]);
const FRAME = P([0xd8dde2, 0x9aa3ad, 0x3d454e, 0xc9b99a, 0x6e7781]);
const IND_WALL = P([0xb9b3a7, 0x9ba1a7, 0xc5baa4, 0x8f9aad, 0xa8a090, 0xc9c2b0, 0xb07a5a]);
const IND_ROOF = P([0x6c757d, 0x5c636a, 0x7d8a96, 0x8c7b6b, 0x4f6f8f, 0x9aa3a8]);
const CONTAINER = P([0xc0392b, 0x2471a3, 0x229954, 0xd68910, 0x7d3c98, 0x839192, 0xb9770e]);
const CARS = P([0xd63031, 0x0984e3, 0xfdcb6e, 0xdfe6e9, 0x2d3436, 0x00b894, 0x6c5ce7, 0xe17055, 0xb2bec3]);
const LEAF = P([0x4f9a3c, 0x5ea845, 0x3f8a37, 0x6cae4a, 0x7bb352, 0x478f3a, 0x8fbf55]);
const LEAF2 = P([0x3c7f30, 0x4a8d39, 0x336f2e, 0x5a9a40, 0x669e3e]);
const CONIFER = P([0x2f6b3a, 0x2a5f35, 0x3a7a44, 0x24553a]);
const CONIFER2 = P([0x3b7d45, 0x357345, 0x2f6a3f]);

const C = {
  grass: rgb(0x80ad5b), grassD: rgb(0x6e9c4d), pave: rgb(0xbdb8ad), paveD: rgb(0xa39e94), paveL: rgb(0xd3cfc5),
  asph: rgb(0x55585e), conc: rgb(0xaaa69e), concL: rgb(0xc4c0b8), dirt: rgb(0x9a8565), dirtD: rgb(0x7f6b4f),
  hedge: rgb(0x4c8a3a), water: rgb(0x3d9ad1), white: rgb(0xf2f2f0), dark: rgb(0x2d3135), darkG: rgb(0x4a4f55),
  wood: rgb(0x7a5533), brick: rgb(0x9c4f3a), metal: rgb(0x8e959c), metalL: rgb(0xb7bec5), yellow: rgb(0xf2c230),
  red: rgb(0xd63a2f), trunk: rgb(0x6b4a2b), door: rgb(0x5b3b24), glassD: rgb(0x34495e), sand: rgb(0xe3d3a3),
  line: rgb(0xf4f4ef), blue: rgb(0x2b6cb0), orange: rgb(0xf08c00), gravel: rgb(0x8d8a84), track: rgb(0xb5523b),
  lamp: rgb(0xfff1c4), redLamp: rgb(0xff4040), scaffold: rgb(0xb08d57), crane: rgb(0xf2b705), green: rgb(0x2f9e44),
};

export const WIN = { NONE: 0, STD: 1, LAMP: 2, GLASS: 3, HOUSE: 4, FIXED: 5 };

const gray = (c, f = 0.55) => {
  const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return scalec(mixc(c, [l, l, l], 0.75), f);
};

function tree(B, x, z, s, rng) {
  const conifer = rng() < 0.3;
  if (conifer) B.tree(x, z, s, 1, pick(rng, CONIFER), pick(rng, CONIFER2), C.trunk);
  else B.tree(x, z, s, 0, pick(rng, LEAF), pick(rng, LEAF2), C.trunk);
}

function car(B, x, z, alongX, col) {
  const l = 0.11, wd = 0.055;
  if (alongX) {
    B.box(x - l, 0.012, z - wd, x + l, 0.06, z + wd, col, 0);
    B.box(x - l * 0.5, 0.06, z - wd * 0.85, x + l * 0.4, 0.095, z + wd * 0.85, C.glassD, 0, col);
  } else {
    B.box(x - wd, 0.012, z - l, x + wd, 0.06, z + l, col, 0);
    B.box(x - wd * 0.85, 0.06, z - l * 0.5, x + wd * 0.85, 0.095, z + l * 0.4, C.glassD, 0, col);
  }
}

function lampPost(B, x, z, h = 0.3) {
  B.box(x - 0.008, 0, z - 0.008, x + 0.008, h, z + 0.008, C.darkG, 0);
  B.box(x - 0.025, h, z - 0.025, x + 0.025, h + 0.03, z + 0.025, C.lamp, WIN.LAMP);
}

function roofStuff(B, x0, z0, x1, z1, y, rng, opts = {}) {
  // Brüstung
  const t = 0.025;
  const pc = opts.parapet || C.darkG;
  B.box(x0, y, z0, x1, y + 0.04, z0 + t, pc, 0);
  B.box(x0, y, z1 - t, x1, y + 0.04, z1, pc, 0);
  B.box(x0, y, z0 + t, x0 + t, y + 0.04, z1 - t, pc, 0);
  B.box(x1 - t, y, z0 + t, x1, y + 0.04, z1 - t, pc, 0);
  const w = x1 - x0, d = z1 - z0;
  if (opts.garden && rng() < 0.5) {
    B.flat(x0 + t, z0 + t, x1 - t, z1 - t, y + 0.005, C.grassD);
    tree(B, x0 + w * 0.3, z0 + d * 0.4, 0.6, rng);
    return y + 0.25;
  }
  const n = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const ax = x0 + 0.06 + rng() * Math.max(0.01, w - 0.22), az = z0 + 0.06 + rng() * Math.max(0.01, d - 0.22);
    B.box(ax, y, az, ax + 0.1, y + 0.06, az + 0.08, C.metalL, 0);
  }
  if (rng() < 0.4 && w > 0.3 && d > 0.3) {
    const cx = x0 + w * (0.25 + rng() * 0.5), cz = z0 + d * (0.25 + rng() * 0.5);
    B.box(cx - 0.05, y, cz - 0.05, cx + 0.05, y + 0.08, cz + 0.05, C.metal, 0);
    B.cyl(cx, cz, 0.07, y + 0.08, y + 0.2, 7, C.wood, 0);
    B.cone(cx, cz, 0.075, y + 0.2, y + 0.25, 7, C.dark);
    return y + 0.25;
  }
  if (rng() < 0.4) {
    B.box(x0 + w * 0.3, y, z0 + d * 0.3, x0 + w * 0.6, y + 0.12, z0 + d * 0.65, C.concL, 0);
  }
  return y + 0.12;
}

// ---------------------------------------------------------------- Wohnen (niedrig)
function house(B, x0, z0, w, d, lvl, rng) {
  const wall = pick(rng, WALLS_HOUSE), roof = pick(rng, ROOFS);
  const fw = Math.min(w - 0.18, 0.48 + rng() * 0.16 + (lvl - 1) * 0.07);
  const fd = Math.min(0.62, 0.4 + rng() * 0.12 + (lvl - 1) * 0.05);
  const hx0 = x0 + (w - fw) / 2 + (rng() - 0.5) * 0.06;
  const hz0 = z0 + 0.19 + rng() * 0.05;
  const floors = lvl === 1 ? (rng() < 0.35 ? 2 : 1) : 2;
  const wallH = 0.08 + floors * 0.22;
  const modern = lvl >= 2 && rng() < 0.25;
  const wc = modern ? pick(rng, MODERN) : wall;
  B.box(hx0, 0, hz0, hx0 + fw, wallH, hz0 + fd, wc, WIN.HOUSE, modern ? wc : null);
  let h = wallH;
  if (modern) {
    B.box(hx0 - 0.01, wallH, hz0 - 0.01, hx0 + fw + 0.01, wallH + 0.025, hz0 + fd + 0.01, C.darkG, 0);
    if (rng() < 0.6) {
      const ex = hx0 + fw * 0.45;
      B.box(ex, wallH + 0.025, hz0 + fd * 0.3, hx0 + fw - 0.02, wallH + 0.2, hz0 + fd - 0.02, wc, WIN.HOUSE);
      h = wallH + 0.2;
    }
    if (lvl >= 3) {
      // Solarpaneele
      B.quad([hx0 + 0.05, wallH + 0.03, hz0 + 0.05], [hx0 + 0.05, wallH + 0.08, hz0 + 0.2], [hx0 + 0.25, wallH + 0.08, hz0 + 0.2],
        [hx0 + 0.25, wallH + 0.03, hz0 + 0.05], rgb(0x1f3a5f), 0);
    }
  } else {
    const rh = 0.16 + rng() * 0.1;
    const o = 0.035;
    if (rng() < 0.62) B.gable(hx0 - o, hz0 - o, hx0 + fw + o, hz0 + fd + o, wallH, rh, roof, rng() < 0.65, wall);
    else B.hip(hx0 - o, hz0 - o, hx0 + fw + o, hz0 + fd + o, wallH, rh, roof);
    if (rng() < 0.6) {
      const cx = hx0 + fw * (0.2 + rng() * 0.6), cz = hz0 + fd * (0.25 + rng() * 0.5);
      B.box(cx - 0.025, wallH, cz - 0.025, cx + 0.025, wallH + rh + 0.05, cz + 0.025, C.brick, 0);
    }
    h = wallH + rh;
  }
  const dx = hx0 + fw * (0.25 + rng() * 0.5);
  B.box(dx - 0.033, 0, hz0 - 0.012, dx + 0.033, 0.15, hz0, C.door, 0);
  B.flat(dx - 0.04, z0 + 0.01, dx + 0.04, hz0, 0.017, C.paveL);
  // Garage
  const sideL = hx0 - x0, sideR = x0 + w - (hx0 + fw);
  if (lvl >= 2 && rng() < 0.55 && Math.max(sideL, sideR) > 0.2) {
    const gx0 = sideR > sideL ? hx0 + fw + 0.01 : x0 + 0.03;
    const gx1 = sideR > sideL ? x0 + w - 0.03 : hx0 - 0.01;
    B.box(gx0, 0, hz0 + 0.02, gx1, 0.17, hz0 + 0.3, wc, 0, C.darkG);
    B.box(gx0 + 0.02, 0, hz0 + 0.01, gx1 - 0.02, 0.13, hz0 + 0.02, C.metalL, 0);
    B.flat(gx0 + 0.01, z0 + 0.01, gx1 - 0.01, hz0 + 0.01, 0.016, C.paveD);
  }
  // Garten hinten
  const back = z0 + d - (hz0 + fd);
  if (back > 0.18) {
    const bz = hz0 + fd + 0.05;
    if (lvl >= 3 && back > 0.38 && rng() < 0.55) {
      const px0 = x0 + 0.12 + rng() * 0.1, pz0 = bz + 0.04;
      B.box(px0 - 0.02, 0, pz0 - 0.02, px0 + 0.3, 0.025, pz0 + 0.2, C.paveL, 0);
      B.flat(px0, pz0, px0 + 0.28, pz0 + 0.18, 0.027, C.water);
    } else if (rng() < 0.4) {
      const sx = x0 + w - 0.2, sz = z0 + d - 0.2;
      B.box(sx, 0, sz, sx + 0.12, 0.1, sz + 0.12, C.wood, 0);
      B.gable(sx - 0.01, sz - 0.01, sx + 0.13, sz + 0.13, 0.1, 0.05, pick(rng, ROOFS), true, C.wood);
    }
    const nt = 1 + Math.floor(rng() * 2) + (d >= 2 ? 1 : 0);
    for (let k = 0; k < nt; k++) tree(B, x0 + 0.12 + rng() * (w - 0.24), bz + rng() * Math.max(0.05, z0 + d - bz - 0.12), 0.7 + rng() * 0.5, rng);
  }
  // Hecke vorne
  if (rng() < 0.55) {
    if (dx - 0.06 > x0 + 0.04) B.box(x0 + 0.03, 0, z0 + 0.03, dx - 0.06, 0.05, z0 + 0.065, C.hedge, 0);
    if (dx + 0.06 < x0 + w - 0.04) B.box(dx + 0.06, 0, z0 + 0.03, x0 + w - 0.03, 0.05, z0 + 0.065, C.hedge, 0);
  }
  return h;
}

function villa(B, w, d, lvl, rng) {
  const wall = pick(rng, WALLS_HOUSE), roof = pick(rng, ROOFS);
  const H1 = 0.5, rh = 0.24;
  const x0 = 0.3, x1 = w - 0.3, z0 = 0.3, z1 = Math.min(d - 0.3, 1.1);
  B.box(x0, 0, z0, x1, H1, z1, wall, WIN.HOUSE, null);
  B.hip(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, H1, rh, roof);
  const wx0 = x0 + 0.1, wx1 = x0 + (x1 - x0) * 0.45;
  B.box(wx0, 0, z0 - 0.25, wx1, H1 * 0.75, z0, wall, WIN.HOUSE, null);
  B.gable(wx0 - 0.03, z0 - 0.28, wx1 + 0.03, z0 + 0.02, H1 * 0.75, 0.18, roof, false, wall);
  const dx = (x0 + x1) / 2 + 0.15;
  B.box(dx - 0.05, 0, z0 - 0.012, dx + 0.05, 0.17, z0, C.door, 0);
  B.flat(dx - 0.06, 0.02, dx + 0.06, z0, 0.017, C.paveL);
  if (d >= 2) {
    const pz = z1 + 0.15;
    B.box(x0, 0, pz, x0 + 0.5, 0.025, pz + 0.3, C.paveL, 0);
    B.flat(x0 + 0.03, pz + 0.03, x0 + 0.47, pz + 0.27, 0.027, C.water);
  }
  for (let k = 0; k < 4; k++) tree(B, 0.1 + rng() * (w - 0.2), z1 + 0.1 + rng() * Math.max(0.1, d - z1 - 0.2), 0.8 + rng() * 0.5, rng);
  B.box(0.03, 0, 0.03, dx - 0.08, 0.05, 0.065, C.hedge, 0);
  B.box(dx + 0.08, 0, 0.03, w - 0.03, 0.05, 0.065, C.hedge, 0);
  return H1 + rh;
}

function genHouse(B, w, d, lvl, rng) {
  B.flat(0.02, 0.02, w - 0.02, d - 0.02, 0.012, rng() < 0.5 ? C.grass : C.grassD);
  if (w >= 2) {
    if (lvl >= 2 && rng() < 0.45) return villa(B, w, d, lvl, rng);
    let h = 0;
    for (let k = 0; k < w; k++) h = Math.max(h, house(B, k, 0, 1, d, lvl, rng));
    return h;
  }
  return house(B, 0, 0, w, d, lvl, rng);
}

// ---------------------------------------------------------------- Wohnen (hoch)
function genApartment(B, w, d, lvl, rng) {
  B.flat(0.02, 0.02, w - 0.02, d - 0.02, 0.012, C.pave);
  const area = w * d;
  const floors = [3, 5, 8, 13, 19][lvl - 1] + Math.floor(rng() * 3) + (area >= 6 ? 1 : 0) + (area >= 9 ? 3 : 0);
  const FH = 0.22;
  if (lvl <= 2) {
    const wall = pick(rng, PLASTER), roof = pick(rng, ROOFS);
    const H = floors * FH + 0.06;
    const x0 = 0.1, x1 = w - 0.1, z0 = 0.14, z1 = Math.min(d - 0.12, z0 + 0.62 + (d - 1) * 0.42);
    B.box(x0, 0, z0, x1, H, z1, wall, WIN.STD, null);
    let top = H;
    if (rng() < 0.65) { B.hip(x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, H, 0.22, roof); top += 0.22; }
    else { B.flat(x0, z0, x1, z1, H, C.gravel); top = roofStuff(B, x0, z0, x1, z1, H, rng); }
    const nb = Math.max(1, Math.round((x1 - x0) / 0.42));
    const balc = pick(rng, [C.white, C.concL, pick(rng, SOFT)]);
    for (let f = 1; f < floors; f++) {
      for (let k = 0; k < nb; k++) {
        const bx = x0 + ((k + 0.5) * (x1 - x0)) / nb;
        B.box(bx - 0.1, f * FH, z0 - 0.07, bx + 0.1, f * FH + 0.022, z0, balc, 0);
        B.box(bx - 0.1, f * FH + 0.022, z0 - 0.075, bx + 0.1, f * FH + 0.075, z0 - 0.062, balc, 0);
      }
    }
    const ex = (x0 + x1) / 2;
    B.box(ex - 0.08, 0.19, z0 - 0.1, ex + 0.08, 0.21, z0, C.darkG, 0);
    B.box(ex - 0.05, 0, z0 - 0.01, ex + 0.05, 0.17, z0, C.door, 0);
    if (d - z1 > 0.3) {
      B.flat(0.1, z1 + 0.05, w - 0.1, d - 0.08, 0.014, C.grass);
      for (let k = 0; k < w + 1; k++) tree(B, 0.2 + rng() * (w - 0.4), z1 + 0.15 + rng() * Math.max(0.05, d - z1 - 0.3), 0.8 + rng() * 0.4, rng);
    }
    return top;
  }
  // Moderne Wohntürme
  const wall = pick(rng, MODERN), acc = pick(rng, SOFT);
  const podH = 2 * FH;
  const pc = scalec(wall, 0.85);
  B.box(0.06, 0, 0.08, w - 0.06, podH, d - 0.06, pc, WIN.GLASS, C.gravel);
  const inset = area >= 4 ? 0.24 : 0.12;
  const tx0 = inset, tx1 = w - inset, tz0 = inset + 0.04, tz1 = d - inset;
  const H = floors * FH;
  let topY = H;
  if (lvl === 5 && rng() < 0.5 && tx1 - tx0 > 0.8) {
    const H1 = H * 0.65;
    B.box(tx0, podH, tz0, tx1, H1, tz1, wall, WIN.STD, C.gravel);
    const s = 0.15;
    B.box(tx0 + s, H1, tz0 + s, tx1 - s, H, tz1 - s, wall, WIN.STD, C.gravel);
    topY = roofStuff(B, tx0 + s, tz0 + s, tx1 - s, tz1 - s, H, rng, { garden: true });
  } else {
    B.box(tx0, podH, tz0, tx1, H, tz1, wall, WIN.STD, C.gravel);
    topY = roofStuff(B, tx0, tz0, tx1, tz1, H, rng, { garden: lvl >= 4 });
  }
  const p = 0.035;
  for (const [cx, cz] of [[tx0, tz0], [tx1, tz0], [tx0, tz1], [tx1, tz1]]) {
    B.box(cx - p, podH, cz - p, cx + p, H + 0.02, cz + p, acc, 0);
  }
  for (let f = 3; f < floors - 1; f += 2) {
    B.box(tx0 - 0.04, f * FH, tz0 - 0.05, tx1 + 0.04, f * FH + 0.02, tz0, C.white, 0);
  }
  B.box(0.3, podH - 0.13, 0.065, w - 0.3, podH - 0.05, 0.08, pick(rng, ACCENT), WIN.LAMP);
  return topY;
}

// ---------------------------------------------------------------- Gewerbe (niedrig)
function shopFront(B, x0, x1, z0, acc) {
  B.box(x0 + 0.04, 0.02, z0 - 0.012, x1 - 0.04, 0.2, z0, C.glassD, WIN.GLASS, null);
  B.quad([x0, 0.25, z0], [x1, 0.25, z0], [x1, 0.21, z0 - 0.12], [x0, 0.21, z0 - 0.12], acc);
  B.quad([x0, 0.21, z0 - 0.12], [x1, 0.21, z0 - 0.12], [x1, 0.25, z0], [x0, 0.25, z0], scalec(acc, 0.6));
}

function genShop(B, w, d, lvl, rng) {
  B.flat(0.02, 0.02, w - 0.02, d - 0.02, 0.012, C.asph);
  B.flat(0.02, 0.02, w - 0.02, 0.13, 0.016, C.pave);
  const v = rng();
  const acc = pick(rng, ACCENT);
  if (w === 1 && d >= 2 && v < 0.35) return gasStation(B, w, d, rng, acc);
  if (w >= 2 && v < 0.55) return supermarket(B, w, d, lvl, rng, acc);
  const wall = pick(rng, rng() < 0.5 ? PLASTER : MODERN);
  const floors = lvl === 1 ? 1 : lvl;
  const H = 0.08 + floors * 0.22;
  const x0 = 0.07, x1 = w - 0.07, z0 = 0.15, z1 = Math.min(d - 0.1, z0 + 0.5 + (d - 1) * 0.3);
  B.box(x0, 0, z0, x1, H, z1, wall, floors > 1 ? WIN.STD : 0, C.gravel);
  shopFront(B, x0, x1, z0, acc);
  B.box(x0 + 0.06, H, z0, x1 - 0.06, H + 0.09, z0 + 0.03, acc, WIN.LAMP);
  roofStuff(B, x0, z0, x1, z1, H, rng);
  if (v < 0.75 && d - z1 < 0.35) {
    // Café-Tische
    for (let k = 0; k < 2; k++) {
      const ux = x0 + 0.15 + k * (x1 - x0 - 0.3);
      B.box(ux - 0.004, 0, 0.06, ux + 0.004, 0.12, 0.068, C.white, 0);
      B.cone(ux, 0.064, 0.07, 0.11, 0.15, 6, k ? acc : C.white);
    }
  }
  if (d - z1 > 0.3) {
    for (let k = 0; k < w * 3; k++) {
      const px = 0.12 + k * 0.28;
      if (px > w - 0.12) break;
      B.flat(px, z1 + 0.08, px + 0.01, d - 0.1, 0.018, C.line);
      if (rng() < 0.5) car(B, px + 0.14, z1 + 0.25, false, pick(rng, CARS));
    }
  }
  return H + 0.1;
}

function gasStation(B, w, d, rng, acc) {
  const cz0 = 0.25, cz1 = 0.85;
  for (const [x, z] of [[0.2, cz0 + 0.05], [0.8, cz0 + 0.05], [0.2, cz1 - 0.05], [0.8, cz1 - 0.05]]) {
    B.box(x - 0.02, 0, z - 0.02, x + 0.02, 0.3, z + 0.02, C.white, 0);
  }
  B.box(0.1, 0.3, cz0, 0.9, 0.35, cz1, C.white, 0, acc);
  B.box(0.1, 0.3, cz0 - 0.005, 0.9, 0.35, cz0, acc, WIN.LAMP, null);
  for (const x of [0.38, 0.62]) B.box(x - 0.03, 0, 0.5, x + 0.03, 0.1, 0.6, C.metalL, 0, acc);
  B.box(0.15, 0, 1.2, 0.85, 0.24, d - 0.15, C.white, 0, C.gravel);
  B.box(0.2, 0.02, 1.188, 0.8, 0.18, 1.2, C.glassD, WIN.GLASS, null);
  B.box(0.04, 0, 0.06, 0.06, 0.45, 0.08, C.metal, 0);
  B.box(0.0, 0.45, 0.04, 0.1, 0.6, 0.1, acc, WIN.LAMP);
  car(B, 0.5, 0.8, false, pick(rng, CARS));
  return 0.6;
}

function supermarket(B, w, d, lvl, rng, acc) {
  const wall = pick(rng, MODERN);
  const z0 = 0.15, z1 = Math.min(d - 0.12, z0 + 0.9 + (d - 2) * 0.4);
  const H = 0.36 + lvl * 0.06;
  B.box(0.08, 0, z0, w - 0.08, H, z1, wall, 0, C.gravel);
  B.box(0.08, H - 0.08, z0 - 0.01, w - 0.08, H - 0.03, z0, acc, 0, null);
  const ex = w / 2;
  B.box(ex - 0.3, 0.02, z0 - 0.012, ex + 0.3, 0.24, z0, C.glassD, WIN.GLASS, null);
  B.box(ex - 0.35, H, z0, ex + 0.35, H + 0.14, z0 + 0.04, acc, WIN.LAMP);
  roofStuff(B, 0.08, z0, w - 0.08, z1, H, rng);
  if (d - z1 > 0.25) {
    for (let k = 0; k < 8; k++) {
      const px = 0.15 + k * 0.25;
      if (px > w - 0.15) break;
      B.flat(px, z1 + 0.06, px + 0.01, d - 0.06, 0.018, C.line);
      if (rng() < 0.6) car(B, px + 0.125, z1 + 0.2 + rng() * 0.2, false, pick(rng, CARS));
    }
  }
  return H + 0.14;
}

// ---------------------------------------------------------------- Gewerbe (hoch)
function genMall(B, w, d, lvl, rng) {
  B.flat(0.02, 0.02, w - 0.02, d - 0.02, 0.012, C.paveL);
  const wall = pick(rng, MODERN), acc = pick(rng, ACCENT), glass = pick(rng, GLASS);
  const podH = 0.45 + lvl * 0.1;
  const m = 0.08;
  B.box(m, 0, m + 0.05, w - m, podH, d - m, wall, WIN.STD, C.gravel);
  B.box(m - 0.01, 0.02, m + 0.038, w - m + 0.01, 0.22, m + 0.05, C.glassD, WIN.GLASS, null);
  for (let k = 0; k < Math.max(1, w - 1); k++) {
    const sx = 0.3 + k * ((w - 0.6) / Math.max(1, w - 1));
    B.box(sx - 0.2, podH - 0.18, m + 0.02, sx + 0.2, podH - 0.04, m + 0.05, pick(rng, ACCENT), WIN.LAMP);
  }
  let top = roofStuff(B, m, m + 0.05, w - m, d - m, podH, rng);
  if (lvl >= 3) {
    const th = [0, 0, 1.4, 2.4, 3.6][lvl - 1] + rng() * 0.8;
    const ti = Math.min(w, d) >= 3 ? 0.55 : 0.32;
    const x0 = ti, x1 = w - ti, z0 = ti + 0.1, z1 = d - ti;
    B.box(x0, podH, z0, x1, podH + th, z1, glass, WIN.GLASS, C.gravel);
    B.box(x0 - 0.02, podH + th, z0 - 0.02, x1 + 0.02, podH + th + 0.06, z1 + 0.02, C.darkG, 0, C.gravel);
    B.box(x0 - 0.021, podH + th - 0.05, z0 - 0.021, x1 + 0.021, podH + th - 0.02, z1 + 0.021, acc, WIN.LAMP, null);
    top = podH + th + 0.06;
    if (rng() < 0.6) {
      B.box(x0 + 0.05, top, z0 + 0.1, x0 + 0.07, top + 0.2, z0 + 0.12, C.metal, 0);
      B.box(x1 - 0.07, top, z0 + 0.1, x1 - 0.05, top + 0.2, z0 + 0.12, C.metal, 0);
      B.box(x0 + 0.1, top + 0.2, z0 + 0.08, x1 - 0.1, top + 0.36, z0 + 0.11, pick(rng, ACCENT), WIN.LAMP);
      top += 0.36;
    }
  } else if (rng() < 0.6) {
    B.box(w * 0.3, podH, d * 0.4, w * 0.3 + 0.02, podH + 0.2, d * 0.4 + 0.02, C.metal, 0);
    B.box(w * 0.7 - 0.02, podH, d * 0.4, w * 0.7, podH + 0.2, d * 0.4 + 0.02, C.metal, 0);
    B.box(w * 0.3, podH + 0.2, d * 0.4 - 0.015, w * 0.7, podH + 0.38, d * 0.4 + 0.015, acc, WIN.LAMP);
    top = podH + 0.38;
  }
  return top;
}

// ---------------------------------------------------------------- Industrie
function chimney(B, cx, cz, r, h, banded = true) {
  const n = banded ? 4 : 1;
  for (let k = 0; k < n; k++) {
    const y0 = (h / n) * k, y1 = (h / n) * (k + 1);
    B.cyl(cx, cz, r * (1 - 0.15 * (k / n)), y0, y1, 8, banded && k % 2 ? C.white : C.red, 0, null, r * (1 - 0.15 * ((k + 1) / n)));
  }
  B.cyl(cx, cz, r * 0.85, h, h + 0.02, 8, C.dark, 0, C.dark);
  B.emitter(cx, h + 0.05, cz, 'smoke', 1);
}

function sawtooth(B, x0, z0, x1, z1, H, roof, wall) {
  const n = Math.max(2, Math.round((z1 - z0) / 0.3));
  const tw = (z1 - z0) / n, th = 0.12;
  for (let k = 0; k < n; k++) {
    const za = z0 + k * tw, zb = za + tw;
    B.quad([x0, H, za], [x0, H + th, za], [x1, H + th, za], [x1, H, za], rgb(0x7fa6c2), 0);
    B.quad([x1, H + th, za], [x0, H + th, za], [x0, H, zb], [x1, H, zb], roof);
    B.tri([x0, H, zb], [x0, H + th, za], [x0, H, za], wall);
    B.tri([x1, H, za], [x1, H + th, za], [x1, H, zb], wall);
  }
  return H + th;
}

function genIndustry(B, w, d, lvl, rng) {
  B.flat(0.02, 0.02, w - 0.02, d - 0.02, 0.012, rgb(0x9d998f));
  const wall = pick(rng, IND_WALL), roof = pick(rng, IND_ROOF);
  const v = rng();
  let top = 0.5;
  if (v < 0.4) {
    const H = 0.34 + lvl * 0.05;
    const x0 = 0.08, x1 = w - 0.08, z0 = 0.35, z1 = d - 0.1;
    B.box(x0, 0, z0, x1, H, z1, wall, 0, null);
    top = sawtooth(B, x0, z0, x1, z1, H, roof, wall);
    for (let k = 0; k < w; k++) B.box(x0 + 0.1 + k * 0.9, 0, z0 - 0.012, x0 + 0.34 + k * 0.9, 0.24, z0, C.darkG, 0);
    B.box(x1 - 0.42, 0, 0.1, x1, 0.32, z0, wall, WIN.STD, C.gravel);
    if (lvl <= 2 || rng() < 0.5) {
      const ch = 0.9 + rng() * 0.5;
      chimney(B, x0 + 0.15, z1 - 0.15, 0.06, ch);
      top = Math.max(top, ch);
    }
  } else if (v < 0.72) {
    const H = 0.3 + lvl * 0.05;
    const x0 = 0.08, x1 = w - 0.08, z0 = 0.4, z1 = d - 0.1;
    B.box(x0, 0, z0, x1, H, z1, wall, 0, null);
    B.gable(x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, H, 0.1, roof, false, wall);
    for (let k = 0; k < (z1 - z0) / 0.3 - 1; k++) {
      const zz = z0 + 0.12 + k * 0.3;
      B.box(x1, 0.02, zz, x1 + 0.012, 0.2, zz + 0.18, C.darkG, 0);
    }
    for (let k = 0; k < w * 2; k++) {
      const cx = 0.15 + k * 0.4;
      if (cx > w - 0.2) break;
      const col = pick(rng, CONTAINER);
      B.box(cx, 0, 0.08, cx + 0.3, 0.12, 0.2, col, 0);
      if (rng() < 0.5) B.box(cx, 0.12, 0.08, cx + 0.3, 0.24, 0.2, pick(rng, CONTAINER), 0);
    }
    B.box(0.15, 0, 0.24, 0.3, 0.1, 0.36, C.white, 0);
    B.box(0.3, 0, 0.24, 0.6, 0.12, 0.36, pick(rng, CONTAINER), 0);
    top = H + 0.1;
  } else {
    const n = Math.max(2, w + d - 1);
    for (let k = 0; k < n; k++) {
      const cx = 0.3 + (k % w) * 0.75 + rng() * 0.1, cz = 0.5 + Math.floor(k / w) * 0.7;
      if (cz > d - 0.25) break;
      if (rng() < 0.5) {
        const h = 0.6 + rng() * 0.5;
        B.cyl(cx, cz, 0.2, 0, h, 9, C.metalL, 0, null);
        B.cone(cx, cz, 0.21, h, h + 0.12, 9, C.metal);
        top = Math.max(top, h + 0.12);
      } else {
        const h = 0.25 + rng() * 0.15;
        B.cyl(cx, cz, 0.26, 0, h, 10, pick(rng, [C.white, C.metalL, rgb(0xd8d0b8)]), 0, C.metal);
        top = Math.max(top, h);
      }
    }
    B.box(0.1, 0.22, 0.4, w - 0.1, 0.25, 0.43, C.metal, 0);
    B.box(0.08, 0, 0.08, 0.5, 0.3, 0.3, wall, WIN.STD, C.gravel);
    if (lvl === 1 && rng() < 0.6) chimney(B, w - 0.2, 0.2, 0.05, 0.9, false);
  }
  // Zaun
  B.box(0.02, 0, d - 0.04, w - 0.02, 0.06, d - 0.03, C.metal, 0);
  return top;
}

// ---------------------------------------------------------------- Büros
function genOffice(B, w, d, lvl, rng) {
  B.flat(0.02, 0.02, w - 0.02, d - 0.02, 0.012, C.paveL);
  const area = w * d;
  const floors = [5, 9, 14, 20, 28][lvl - 1] + Math.floor(rng() * 4) + (area >= 9 ? 4 : 0);
  const FH = 0.2, H = floors * FH;
  const glass = pick(rng, GLASS), frame = pick(rng, FRAME);
  const m = area >= 4 ? 0.22 : 0.12;
  const x0 = m, x1 = w - m, z0 = m + 0.06, z1 = d - m;
  const style = rng();
  let top = H;
  if (style < 0.18 && Math.abs(w - d) === 0 && w >= 2) {
    const r = (x1 - x0) / 2;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    B.cyl(cx, cz, r, 0, H, 12, glass, WIN.GLASS, C.gravel);
    for (let f = 5; f < floors; f += 5) B.cyl(cx, cz, r + 0.02, f * FH, f * FH + 0.04, 12, frame, 0);
    B.cyl(cx, cz, r * 0.6, H, H + 0.25, 10, frame, 0);
    top = H + 0.25;
  } else if (style < 0.6 && lvl >= 3) {
    const s = Math.min(0.14, (x1 - x0) * 0.12);
    const H1 = H * 0.55, H2 = H * 0.82;
    B.box(x0, 0, z0, x1, H1, z1, glass, WIN.GLASS, frame);
    B.box(x0 + s, H1, z0 + s, x1 - s, H2, z1 - s, glass, WIN.GLASS, frame);
    B.box(x0 + 2 * s, H2, z0 + 2 * s, x1 - 2 * s, H, z1 - 2 * s, glass, WIN.GLASS, frame);
    top = H;
  } else {
    B.box(x0, 0, z0, x1, H, z1, glass, WIN.GLASS, frame);
    for (let f = 5; f < floors; f += 5) B.box(x0 - 0.015, f * FH, z0 - 0.015, x1 + 0.015, f * FH + 0.035, z1 + 0.015, frame, 0);
    const p = 0.03;
    for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) B.box(cx - p, 0, cz - p, cx + p, H + 0.03, cz + p, frame, 0);
    top = roofStuff(B, x0, z0, x1, z1, H, rng, { parapet: frame });
  }
  B.box((x0 + x1) / 2 - 0.12, 0, z0 - 0.08, (x0 + x1) / 2 + 0.12, 0.2, z0, C.glassD, WIN.GLASS, frame);
  if (lvl >= 4) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const ah = 0.5 + lvl * 0.15;
    B.cyl(cx, cz, 0.012, top, top + ah, 5, C.metalL, 0);
    B.box(cx - 0.02, top + ah, cz - 0.02, cx + 0.02, top + ah + 0.04, cz + 0.02, C.redLamp, WIN.LAMP);
    top += ah;
  }
  for (let k = 0; k < w; k++) {
    const tx = 0.2 + k * ((w - 0.4) / Math.max(1, w - 1 || 1));
    B.box(tx - 0.05, 0, 0.02, tx + 0.05, 0.04, 0.12, C.concL, 0);
    tree(B, tx, 0.07, 0.5, rng);
  }
  return top;
}

// ---------------------------------------------------------------- Baustelle
const TARGET_H = { 1: [0.55, 0.75, 0.8], 2: [1, 1.5, 2.4, 3.6, 5], 3: [0.45, 0.6, 0.75], 4: [0.9, 1.4, 2.2, 3.2, 4.4], 5: [0.6, 0.8, 1], 6: [1.2, 2.2, 3.4, 5, 7] };

function construction(B, b, w, d, rng) {
  const target = (TARGET_H[b.zone] || [0.6])[Math.min(b.level, 5) - 1] || 0.6;
  const p = clamp(b.built, 0, 1);
  B.flat(0.03, 0.03, w - 0.03, d - 0.03, 0.013, C.dirt);
  // Auf tiefen Grundstücken entsteht das Gebäude vorne, dahinter bleibt Garten bzw. Hof
  const x0 = 0.16, x1 = w - 0.16, z0 = 0.18, z1 = Math.min(d - 0.16, z0 + 0.62 + (b.zone === 1 ? 0 : (d - 1) * 0.42));
  const h = 0.04 + target * p;
  B.box(x0, 0, z0, x1, h, z1, C.concL, 0, C.conc);
  const sh = h + 0.08;
  const sc = C.scaffold;
  for (let x = x0 - 0.04; x <= x1 + 0.05; x += Math.max(0.2, (x1 - x0 + 0.08) / Math.ceil((x1 - x0) / 0.35))) {
    B.box(x - 0.008, 0, z0 - 0.05, x + 0.008, sh, z0 - 0.034, sc, 0);
    B.box(x - 0.008, 0, z1 + 0.034, x + 0.008, sh, z1 + 0.05, sc, 0);
  }
  for (let y = 0.2; y < sh; y += 0.2) {
    B.box(x0 - 0.05, y, z0 - 0.06, x1 + 0.05, y + 0.012, z0 - 0.03, C.wood, 0);
    B.box(x0 - 0.05, y, z1 + 0.03, x1 + 0.05, y + 0.012, z1 + 0.06, C.wood, 0);
  }
  // Bauzaun
  B.box(0.03, 0, 0.03, w - 0.03, 0.07, 0.045, C.orange, 0);
  let top = sh;
  if (target > 1.1) {
    const mh = target + 0.7;
    const cx = x1 + 0.06, cz = z1 + 0.06;
    B.box(cx - 0.03, 0, cz - 0.03, cx + 0.03, mh, cz + 0.03, C.crane, 0);
    B.box(cx - (x1 - x0) - 0.2, mh, cz - 0.02, cx + 0.3, mh + 0.05, cz + 0.02, C.crane, 0);
    B.box(cx + 0.18, mh - 0.06, cz - 0.05, cx + 0.3, mh, cz + 0.05, C.conc, 0);
    const hx = cx - (x1 - x0) * (0.3 + rng() * 0.5);
    B.box(hx - 0.004, Math.max(h + 0.1, mh - 1.2), cz - 0.004, hx + 0.004, mh, cz + 0.004, C.dark, 0);
    B.box(cx - 0.05, mh + 0.05, cz - 0.05, cx + 0.05, mh + 0.14, cz + 0.05, C.crane, WIN.LAMP);
    top = mh + 0.14;
  } else if (rng() < 0.5) {
    B.box(0.05, 0, d - 0.3, 0.25, 0.08, d - 0.08, rgb(0xb58b5a), 0);
  }
  return top;
}

// ---------------------------------------------------------------- Dienstgebäude
function ground(B, w, d, col) { B.flat(0.02, 0.02, w - 0.02, d - 0.02, 0.012, col); }

function flag(B, x, z, h, col) {
  B.box(x - 0.006, 0, z - 0.006, x + 0.006, h, z + 0.006, C.metalL, 0);
  B.box(x + 0.006, h - 0.1, z - 0.003, x + 0.12, h - 0.02, z + 0.003, col, 0);
}

function redCross(B, cx, y, z, s, lamp = WIN.LAMP) {
  B.box(cx - s * 0.3, y, z - 0.02, cx + s * 0.3, y + s * 0.1, z, C.red, lamp);
  B.box(cx - s * 0.1, y - s * 0.2, z - 0.02, cx + s * 0.1, y + s * 0.3, z, C.red, lamp);
}

function helipad(B, cx, cz, y, r) {
  B.cyl(cx, cz, r, y, y + 0.015, 12, C.darkG, 0, C.darkG);
  B.box(cx - r * 0.35, y + 0.016, cz - r * 0.45, cx - r * 0.22, y + 0.02, cz + r * 0.45, C.white, 0);
  B.box(cx + r * 0.22, y + 0.016, cz - r * 0.45, cx + r * 0.35, y + 0.02, cz + r * 0.45, C.white, 0);
  B.box(cx - r * 0.22, y + 0.016, cz - r * 0.06, cx + r * 0.22, y + 0.02, cz + r * 0.06, C.white, 0);
}

const SERVICE_GEN = {
  wind(B, w, d) {
    ground(B, w, d, C.grass);
    B.cyl(0.5, 0.5, 0.12, 0, 0.05, 8, C.conc, 0);
    B.cyl(0.5, 0.5, 0.045, 0.05, 1.6, 8, C.white, 0, C.white, 0.03);
    B.box(0.46, 1.56, 0.42, 0.54, 1.65, 0.64, C.white, 0);
    B.rotor(0.5, 1.605, 0.4, 1);
    B.box(0.5, 1.65, 0.6, 0.52, 1.68, 0.62, C.redLamp, WIN.LAMP);
    return 2.4;
  },
  coal(B, w, d, rng) {
    ground(B, w, d, rgb(0x8f8b83));
    B.box(0.2, 0, 0.3, 1.7, 0.7, 1.5, C.brick, WIN.STD, C.darkG);
    B.box(1.7, 0, 0.5, 2.3, 0.5, 1.3, rgb(0x8d99ae), 0, C.darkG);
    for (const [cx, cz] of [[2.3, 2.2], [1.25, 2.3]]) {
      B.cyl(cx, cz, 0.45, 0, 0.6, 12, C.concL, 0, null, 0.32);
      B.cyl(cx, cz, 0.32, 0.6, 0.9, 12, C.concL, 0, null, 0.3);
      B.cyl(cx, cz, 0.3, 0.9, 1.3, 12, C.concL, 0, C.darkG, 0.36);
      B.emitter(cx, 1.35, cz, 'steam', 1.4);
    }
    chimney(B, 0.4, 1.9, 0.09, 2.6);
    B.hip(0.15, 2.25, 0.85, 2.85, 0.0, 0.3, rgb(0x2b2b2b));
    B.quad([0.7, 0.05, 2.4], [0.8, 0.05, 2.4], [0.8, 0.6, 1.5], [0.7, 0.6, 1.5], C.metal);
    return 2.7;
  },
  solar(B, w, d) {
    ground(B, w, d, C.grassD);
    const panel = rgb(0x1f3a5f), frame = rgb(0xb7bec5);
    for (let r = 0; r < 5; r++) {
      const z = 0.35 + r * 0.52;
      for (let c = 0; c < 3; c++) {
        const x0 = 0.15 + c * 0.92, x1 = x0 + 0.82;
        B.box(x0 + 0.38, 0, z + 0.1, x0 + 0.44, 0.12, z + 0.14, frame, 0);
        B.quad([x0, 0.08, z], [x0, 0.22, z + 0.3], [x1, 0.22, z + 0.3], [x1, 0.08, z], panel, 0);
        B.quad([x1, 0.08, z], [x1, 0.22, z + 0.3], [x0, 0.22, z + 0.3], [x0, 0.08, z], frame, 0);
      }
    }
    B.box(0.1, 0, 0.05, 0.4, 0.18, 0.25, C.white, 0, C.darkG);
    return 0.3;
  },
  pump(B, w, d) {
    ground(B, w, d, C.pave);
    B.box(0.15, 0, 0.15, 0.6, 0.3, 0.55, rgb(0x5b8db8), WIN.STD, C.darkG);
    B.cyl(0.75, 0.7, 0.16, 0, 0.35, 10, C.metalL, 0, rgb(0x2b6cb0));
    B.box(0.42, 0.04, 0.55, 0.48, 0.1, 0.98, C.blue, 0);
    B.box(0.35, 0.04, 0.9, 0.98, 0.1, 0.96, C.blue, 0);
    return 0.4;
  },
  tower(B, w, d) {
    ground(B, w, d, C.grass);
    for (const [x, z] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) B.box(x - 0.02, 0, z - 0.02, x + 0.02, 0.95, z + 0.02, C.metal, 0);
    B.cyl(0.5, 0.5, 0.06, 0, 0.95, 6, C.metalL, 0);
    B.cyl(0.5, 0.5, 0.28, 0.95, 1.35, 12, rgb(0x7fb3d5), 0, null);
    B.cone(0.5, 0.5, 0.3, 1.35, 1.55, 12, C.blue);
    B.box(0.48, 1.55, 0.48, 0.52, 1.6, 0.52, C.redLamp, WIN.LAMP);
    return 1.6;
  },
  outlet(B, w, d) {
    ground(B, w, d, C.gravel);
    B.box(0.2, 0, 0.15, 0.7, 0.2, 0.5, C.conc, 0, C.darkG);
    B.cyl(0.45, 0.75, 0.1, 0, 0.12, 8, rgb(0x6d5a3e), 0, rgb(0x4a3b28));
    B.box(0.4, 0.02, 0.5, 0.5, 0.08, 0.98, rgb(0x6d6a63), 0);
    return 0.3;
  },
  treatment(B, w, d) {
    ground(B, w, d, C.grassD);
    for (const [cx, cz] of [[0.55, 0.85], [1.45, 0.85], [0.55, 1.5], [1.45, 1.5]]) {
      B.cyl(cx, cz, 0.36, 0, 0.14, 12, C.concL, 0, rgb(0x5f8f6a));
      B.box(cx - 0.36, 0.14, cz - 0.01, cx + 0.36, 0.16, cz + 0.01, C.metal, 0);
    }
    B.box(0.2, 0, 0.12, 1.2, 0.35, 0.45, C.white, WIN.STD, C.darkG);
    return 0.4;
  },
  busstop(B, w, d) {
    ground(B, w, d, C.paveL);
    B.flat(0.05, 0.05, 0.95, 0.4, 0.016, C.pave);
    B.box(0.2, 0.0, 0.32, 0.8, 0.24, 0.34, rgb(0x9ec5e8), 0);
    B.box(0.18, 0.24, 0.12, 0.82, 0.26, 0.36, C.darkG, 0);
    B.box(0.2, 0.0, 0.14, 0.22, 0.24, 0.34, C.metal, 0);
    B.box(0.78, 0.0, 0.14, 0.8, 0.24, 0.34, C.metal, 0);
    B.box(0.3, 0.05, 0.26, 0.7, 0.07, 0.31, C.wood, 0);
    B.box(0.88, 0, 0.1, 0.9, 0.36, 0.12, C.metal, 0);
    B.box(0.85, 0.3, 0.09, 0.93, 0.38, 0.13, rgb(0x2b8a3e), WIN.LAMP);
    B.box(0.26, 0.1, 0.35, 0.44, 0.22, 0.36, rgb(0xf08c00), WIN.LAMP);
    B.tree(0.15, 0.75, 0.8, 0, LEAF[1], LEAF2[1], C.trunk);
    B.tree(0.75, 0.78, 0.7, 0, LEAF[3], LEAF2[2], C.trunk);
    return 0.4;
  },
  busdepot(B, w, d) {
    ground(B, w, d, C.asph);
    const wall = rgb(0xd8dde2);
    B.box(0.1, 0, 0.7, 1.9, 0.42, 1.9, wall, 0, null);
    B.gable(0.08, 0.68, 1.92, 1.92, 0.42, 0.14, rgb(0x5c636a), false, wall);
    for (let k = 0; k < 4; k++) B.box(0.18 + k * 0.43, 0, 0.688, 0.52 + k * 0.43, 0.3, 0.7, C.dark, 0, null);
    B.box(0.1, 0.32, 0.69, 1.9, 0.37, 0.7, rgb(0xf2b705), 0, null);
    for (let k = 0; k < 3; k++) {
      const x = 0.4 + k * 0.6;
      B.box(x - 0.07, 0.015, 0.12, x + 0.07, 0.15, 0.55, rgb(0xf2b705), 0);
      B.box(x - 0.071, 0.08, 0.14, x + 0.071, 0.125, 0.53, C.glassD, 0, null);
    }
    B.box(1.5, 0, 0.05, 1.95, 0.3, 0.5, wall, WIN.STD, C.darkG);
    return 0.6;
  },
  landfill(B, w, d, rng) {
    ground(B, w, d, C.dirt);
    const trash = P([0x7a6a4f, 0x5b6e4a, 0x8a7a64, 0x6f5f4a, 0x9e8f75]);
    B.hip(0.4, 0.9, 2.6, 2.8, 0, 0.45, pick(rng, trash));
    B.hip(1.4, 1.4, 2.8, 2.9, 0, 0.6, pick(rng, trash));
    for (let k = 0; k < 18; k++) {
      const x = 0.5 + rng() * 2, z = 1 + rng() * 1.7;
      B.box(x, 0.1, z, x + 0.08, 0.22 + rng() * 0.2, z + 0.08, pick(rng, CONTAINER), 0);
    }
    B.box(0.1, 0, 0.1, 0.7, 0.25, 0.5, C.white, WIN.STD, C.darkG);
    B.box(1.2, 0, 0.4, 1.45, 0.12, 0.6, C.yellow, 0);
    B.box(1.25, 0.12, 0.45, 1.35, 0.2, 0.55, C.glassD, 0);
    B.box(0.03, 0, 2.94, 2.97, 0.12, 2.97, C.metal, 0);
    B.box(2.94, 0, 0.6, 2.97, 0.12, 2.94, C.metal, 0);
    return 0.7;
  },
  incinerator(B, w, d) {
    ground(B, w, d, rgb(0x8f8b83));
    B.box(0.15, 0, 0.3, 1.5, 0.65, 1.7, rgb(0x6f7d8c), WIN.STD, C.darkG);
    B.gable(0.15, 0.3, 1.5, 1.7, 0.65, 0.15, rgb(0x4f5b66), true, rgb(0x6f7d8c));
    chimney(B, 1.7, 1.6, 0.08, 1.9);
    return 2.0;
  },
  police(B, w, d) {
    ground(B, w, d, C.asph);
    B.box(0.15, 0, 0.2, 1.85, 0.5, 1.1, C.white, WIN.STD, C.darkG);
    B.box(0.15, 0.3, 0.19, 1.85, 0.36, 0.2, C.blue, 0, null);
    B.box(0.75, 0.5, 0.2, 1.25, 0.62, 0.24, C.blue, WIN.LAMP);
    B.box(0.85, 0, 0.18, 1.15, 0.22, 0.2, C.glassD, WIN.GLASS, null);
    for (let k = 0; k < 3; k++) {
      const x = 0.4 + k * 0.5;
      B.flat(x - 0.15, 1.3, x - 0.14, 1.9, 0.018, C.line);
      car(B, x, 1.55, false, C.white);
      B.box(x - 0.03, 0.095, 1.53, x + 0.03, 0.11, 1.57, C.blue, WIN.LAMP);
    }
    flag(B, 0.08, 0.1, 0.6, C.blue);
    return 0.65;
  },
  policehq(B, w, d) {
    ground(B, w, d, C.asph);
    B.box(0.2, 0, 0.25, 2.8, 0.7, 1.4, C.white, WIN.STD, C.darkG);
    B.box(0.8, 0.7, 0.4, 2.2, 1.5, 1.3, rgb(0xdfe6ee), WIN.STD, C.darkG);
    B.box(0.2, 0.45, 0.24, 2.8, 0.52, 0.25, C.blue, 0, null);
    B.box(1.1, 1.5, 0.4, 1.9, 1.62, 0.44, C.blue, WIN.LAMP);
    helipad(B, 1.5, 0.85, 1.5, 0.3);
    for (let k = 0; k < 5; k++) car(B, 0.4 + k * 0.5, 2.2, false, C.white);
    flag(B, 0.1, 0.12, 0.8, C.blue);
    return 1.65;
  },
  fire(B, w, d) {
    ground(B, w, d, C.pave);
    B.box(0.1, 0, 0.6, 1.5, 0.48, 1.85, C.brick, WIN.STD, C.darkG);
    for (let k = 0; k < 3; k++) {
      const x = 0.2 + k * 0.42;
      B.box(x, 0.0, 0.588, x + 0.32, 0.32, 0.6, C.dark, 0, null);
      B.box(x + 0.05, 0.0, 0.25, x + 0.27, 0.13, 0.55, C.red, 0);
      B.box(x + 0.07, 0.13, 0.25, x + 0.25, 0.18, 0.35, C.red, 0);
      B.box(x + 0.12, 0.18, 0.28, x + 0.2, 0.2, 0.32, C.lamp, WIN.LAMP);
    }
    B.box(1.55, 0, 0.9, 1.85, 1.1, 1.2, C.brick, WIN.STD, C.red);
    B.hip(1.53, 0.88, 1.87, 1.22, 1.1, 0.15, C.red);
    B.box(0.1, 0.48, 0.6, 1.5, 0.55, 0.62, C.red, WIN.LAMP, null);
    return 1.25;
  },
  clinic(B, w, d) {
    ground(B, w, d, C.grass);
    B.flat(0.1, 0.05, 1.9, 0.5, 0.015, C.pave);
    B.box(0.2, 0, 0.5, 1.8, 0.5, 1.6, C.white, WIN.STD, C.darkG);
    B.box(0.8, 0, 0.36, 1.2, 0.26, 0.5, C.white, 0, C.darkG);
    B.box(0.85, 0.02, 0.348, 1.15, 0.22, 0.36, C.glassD, WIN.GLASS, null);
    redCross(B, 1.0, 0.36, 0.5, 0.35);
    B.box(0.3, 0, 0.12, 0.62, 0.14, 0.3, C.white, 0);
    B.box(0.3, 0.06, 0.119, 0.62, 0.08, 0.121, C.red, 0, null);
    for (let k = 0; k < 3; k++) tree(B, 0.3 + k * 0.6, 1.8, 0.8, mulberry32(k + 3));
    return 0.6;
  },
  hospital(B, w, d) {
    ground(B, w, d, C.grass);
    B.flat(0.1, 0.05, 2.9, 0.55, 0.015, C.pave);
    B.box(0.25, 0, 0.6, 2.75, 0.6, 2.6, C.white, WIN.STD, C.darkG);
    B.box(0.75, 0.6, 0.9, 2.25, 1.9, 2.2, rgb(0xeef3f6), WIN.STD, C.darkG);
    B.box(1.2, 0, 0.42, 1.8, 0.3, 0.6, C.white, 0, C.darkG);
    B.box(1.25, 0.02, 0.408, 1.75, 0.26, 0.42, C.glassD, WIN.GLASS, null);
    redCross(B, 1.5, 1.6, 0.9, 0.5);
    helipad(B, 1.5, 1.55, 1.9, 0.38);
    B.box(0.4, 0, 0.15, 0.75, 0.15, 0.35, C.white, 0);
    B.box(0.4, 0.06, 0.149, 0.75, 0.08, 0.151, C.red, 0, null);
    return 2.0;
  },
  school(B, w, d, rng) {
    ground(B, w, d, C.grass);
    const wall = rgb(0xf2c46d);
    B.box(0.1, 0, 0.2, 1.9, 0.5, 0.75, wall, WIN.STD, null);
    B.gable(0.06, 0.16, 1.94, 0.79, 0.5, 0.2, rgb(0xa9483a), true, wall);
    B.box(0.1, 0, 0.75, 0.6, 0.45, 1.85, wall, WIN.STD, null);
    B.gable(0.06, 0.75, 0.64, 1.89, 0.45, 0.2, rgb(0xa9483a), false, wall);
    B.box(0.9, 0.0, 0.188, 1.1, 0.22, 0.2, C.door, 0, null);
    B.flat(0.75, 0.95, 1.9, 1.9, 0.016, rgb(0x6aa04a));
    B.box(0.8, 0.017, 1.4, 1.85, 0.02, 1.42, C.line, 0);
    B.box(0.8, 0.017, 0.98, 1.85, 0.02, 1.0, C.line, 0);
    B.box(0.8, 0.017, 1.84, 1.85, 0.02, 1.86, C.line, 0);
    B.box(0.79, 0, 1.3, 0.81, 0.15, 1.5, C.white, 0);
    B.box(1.84, 0, 1.3, 1.86, 0.15, 1.5, C.white, 0);
    flag(B, 0.05, 0.1, 0.6, C.red);
    return 0.72;
  },
  highschool(B, w, d) {
    ground(B, w, d, C.grass);
    const wall = rgb(0xb5654a);
    B.box(0.15, 0, 0.2, 2.85, 0.7, 0.8, wall, WIN.STD, C.darkG);
    B.box(0.15, 0, 0.8, 0.7, 0.7, 1.4, wall, WIN.STD, C.darkG);
    B.box(2.3, 0, 0.8, 2.85, 0.7, 1.4, wall, WIN.STD, C.darkG);
    B.box(1.25, 0.7, 0.2, 1.75, 1.1, 0.55, wall, WIN.STD, null);
    B.hip(1.22, 0.17, 1.78, 0.58, 1.1, 0.2, rgb(0x4f5c68));
    B.box(1.4, 0.8, 0.19, 1.6, 0.95, 0.2, C.white, 0, null);
    B.cyl(1.5, 2.25, 0.62, 0.0, 0.02, 14, C.track, 0, C.track);
    B.cyl(1.5, 2.25, 0.45, 0.02, 0.025, 14, rgb(0x6aa04a), 0, rgb(0x6aa04a));
    return 1.3;
  },
  university(B, w, d, rng) {
    ground(B, w, d, C.grass);
    B.flat(1.8, 0.02, 2.2, 3.98, 0.016, C.pave);
    B.flat(0.02, 2.4, 3.98, 2.7, 0.016, C.pave);
    const stone = rgb(0xe3d8c2);
    B.box(0.6, 0, 0.2, 3.4, 0.8, 1.2, stone, WIN.STD, C.darkG);
    for (let k = 0; k < 6; k++) B.cyl(1.45 + k * 0.22, 0.12, 0.035, 0, 0.6, 6, C.white, 0);
    B.box(1.35, 0.6, 0.05, 2.65, 0.66, 0.2, C.white, 0);
    B.gable(1.35, 0.05, 2.65, 0.2, 0.66, 0.15, rgb(0xd6cbb5), true, C.white);
    B.cyl(2.0, 0.7, 0.35, 0.8, 1.1, 12, stone, WIN.STD, null);
    B.cone(2.0, 0.7, 0.38, 1.1, 1.55, 12, rgb(0x4f8a7a));
    B.box(0.2, 0, 2.9, 1.5, 0.6, 3.8, rgb(0xb5654a), WIN.STD, C.darkG);
    B.box(2.5, 0, 2.9, 3.8, 0.9, 3.8, stone, WIN.STD, C.darkG);
    B.box(3.5, 0, 1.6, 3.8, 1.4, 1.9, stone, WIN.STD, C.darkG);
    B.hip(3.48, 1.58, 3.82, 1.92, 1.4, 0.3, rgb(0x4f8a7a));
    for (let k = 0; k < 10; k++) tree(B, 0.2 + rng() * 3.6, 1.5 + rng() * 0.8, 0.9, rng);
    return 1.7;
  },
  park(B, w, d, rng) {
    ground(B, w, d, rgb(0x6fb24f));
    B.flat(0.44, 0.02, 0.56, 0.98, 0.016, C.sand);
    B.flat(0.02, 0.44, 0.98, 0.56, 0.016, C.sand);
    if (rng() < 0.4) {
      B.cyl(0.5, 0.5, 0.12, 0, 0.05, 10, C.concL, 0, C.water);
      B.cyl(0.5, 0.5, 0.02, 0.05, 0.13, 5, C.concL, 0);
    }
    for (const [x, z] of [[0.22, 0.22], [0.78, 0.25], [0.24, 0.78], [0.76, 0.76]]) tree(B, x, z, 0.8 + rng() * 0.4, rng);
    B.box(0.3, 0.03, 0.6, 0.42, 0.06, 0.64, C.wood, 0);
    return 0.5;
  },
  playground(B, w, d, rng) {
    ground(B, w, d, rgb(0x6fb24f));
    B.flat(0.15, 0.15, 0.85, 0.85, 0.016, C.sand);
    B.box(0.25, 0, 0.25, 0.4, 0.22, 0.4, C.red, 0);
    B.quad([0.4, 0.22, 0.25], [0.4, 0.22, 0.4], [0.7, 0.03, 0.4], [0.7, 0.03, 0.25], C.yellow);
    B.box(0.55, 0, 0.6, 0.57, 0.22, 0.62, C.blue, 0);
    B.box(0.83, 0, 0.6, 0.85, 0.22, 0.62, C.blue, 0);
    B.box(0.55, 0.22, 0.6, 0.85, 0.24, 0.62, C.blue, 0);
    B.box(0.66, 0.06, 0.58, 0.74, 0.07, 0.64, C.wood, 0);
    B.cyl(0.3, 0.72, 0.08, 0.016, 0.05, 8, C.green, 0);
    tree(B, 0.85, 0.15, 0.7, rng);
    return 0.4;
  },
  plaza(B, w, d, rng) {
    ground(B, w, d, C.paveL);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) B.flat(0.1 + i * 0.45, 0.1 + j * 0.45, 0.55 + i * 0.45, 0.55 + j * 0.45, 0.016, C.pave);
    B.cyl(1, 1, 0.42, 0, 0.08, 14, C.concL, 0, C.water);
    B.cyl(1, 1, 0.12, 0.08, 0.2, 10, C.concL, 0, C.water);
    B.cyl(1, 1, 0.03, 0.2, 0.32, 6, C.concL, 0);
    for (const [x, z] of [[0.25, 0.25], [1.75, 0.25], [0.25, 1.75], [1.75, 1.75]]) {
      B.box(x - 0.1, 0, z - 0.1, x + 0.1, 0.06, z + 0.1, C.conc, 0, C.grassD);
      tree(B, x, z, 0.9, rng);
    }
    for (const [x, z] of [[1, 0.2], [1, 1.8], [0.2, 1], [1.8, 1]]) lampPost(B, x, z, 0.32);
    return 0.6;
  },
  citypark(B, w, d, rng) {
    ground(B, w, d, rgb(0x6fb24f));
    B.cyl(1.9, 1.9, 0.75, 0.0, 0.018, 12, C.water, 0, C.water);
    B.flat(0.02, 0.45, 2.98, 0.6, 0.016, C.sand);
    B.flat(0.5, 0.02, 0.65, 2.98, 0.016, C.sand);
    B.flat(0.65, 1.0, 1.2, 1.12, 0.016, C.sand);
    for (const [x, z] of [[0.9, 0.85], [1.2, 0.85], [0.9, 1.25], [1.2, 1.25]]) B.box(x - 0.015, 0, z - 0.015, x + 0.015, 0.2, z + 0.015, C.white, 0);
    B.hip(0.82, 0.77, 1.28, 1.33, 0.2, 0.15, rgb(0x6b4a3e));
    for (let k = 0; k < 16; k++) {
      const x = 0.15 + rng() * 2.7, z = 0.15 + rng() * 2.7;
      if (Math.hypot(x - 1.9, z - 1.9) < 0.85) continue;
      tree(B, x, z, 0.9 + rng() * 0.5, rng);
    }
    lampPost(B, 0.7, 0.7, 0.3);
    lampPost(B, 2.2, 0.7, 0.3);
    return 0.8;
  },
  cityhall(B, w, d) {
    ground(B, w, d, C.paveL);
    const stone = rgb(0xe8dcc4);
    B.box(0.15, 0, 0.45, 1.85, 0.08, 1.85, C.concL, 0);
    B.box(0.2, 0.08, 0.55, 1.8, 0.75, 1.8, stone, WIN.STD, C.darkG);
    for (let k = 0; k < 6; k++) B.cyl(0.55 + k * 0.18, 0.47, 0.03, 0.08, 0.6, 6, C.white, 0);
    B.box(0.45, 0.6, 0.38, 1.55, 0.66, 0.55, C.white, 0);
    B.gable(0.45, 0.38, 1.55, 0.55, 0.66, 0.18, stone, true, C.white);
    B.box(0.8, 0.75, 0.9, 1.2, 1.5, 1.3, stone, WIN.STD, null);
    B.box(0.92, 1.2, 0.889, 1.08, 1.36, 0.9, C.white, WIN.LAMP, null);
    B.cyl(1.0, 1.1, 0.2, 1.5, 1.6, 10, stone, 0, null);
    B.cone(1.0, 1.1, 0.22, 1.6, 2.0, 10, rgb(0x4f8a7a));
    flag(B, 1.0, 1.1, 2.25, C.red);
    B.flat(0.9, 0.02, 1.1, 0.45, 0.016, C.pave);
    return 2.25;
  },
  stadium(B, w, d) {
    ground(B, w, d, C.asph);
    const stand = rgb(0xc7ccd1), seat = rgb(0x1c7ed6);
    B.flat(0.9, 0.9, 3.1, 3.1, 0.016, rgb(0x4caf50));
    B.box(1.0, 0.017, 1.98, 3.0, 0.02, 2.02, C.line, 0);
    B.cyl(2, 2, 0.25, 0.017, 0.021, 12, C.line, 0, rgb(0x4caf50));
    const sides = [[0.4, 0.4, 3.6, 0.9, 0], [0.4, 3.1, 3.6, 3.6, 2], [0.4, 0.9, 0.9, 3.1, 3], [3.1, 0.9, 3.6, 3.1, 1]];
    for (const [x0, z0, x1, z1, s] of sides) {
      B.box(x0, 0, z0, x1, 0.15, z1, stand, 0, null);
      if (s === 0) B.quad([x1, 0.15, z1], [x1, 0.55, z0], [x0, 0.55, z0], [x0, 0.15, z1], seat);
      if (s === 2) B.quad([x0, 0.15, z0], [x0, 0.55, z1], [x1, 0.55, z1], [x1, 0.15, z0], seat);
      if (s === 3) B.quad([x1, 0.15, z0], [x0, 0.55, z0], [x0, 0.55, z1], [x1, 0.15, z1], seat);
      if (s === 1) B.quad([x0, 0.15, z1], [x1, 0.55, z1], [x1, 0.55, z0], [x0, 0.15, z0], seat);
    }
    B.box(0.4, 0.15, 0.38, 3.6, 0.55, 0.4, stand, WIN.STD, null);
    B.box(0.4, 0.15, 3.6, 3.6, 0.55, 3.62, stand, WIN.STD, null);
    B.box(0.38, 0.15, 0.4, 0.4, 0.55, 3.6, stand, WIN.STD, null);
    B.box(3.6, 0.15, 0.4, 3.62, 0.55, 3.6, stand, WIN.STD, null);
    for (const [x, z] of [[0.3, 0.3], [3.7, 0.3], [0.3, 3.7], [3.7, 3.7]]) {
      B.box(x - 0.025, 0, z - 0.025, x + 0.025, 1.2, z + 0.025, C.metal, 0);
      B.box(x - 0.1, 1.2, z - 0.1, x + 0.1, 1.3, z + 0.1, C.lamp, WIN.LAMP);
    }
    return 1.3;
  },
  tvtower(B, w, d) {
    ground(B, w, d, C.paveL);
    B.box(0.3, 0, 0.3, 1.7, 0.3, 1.7, C.concL, WIN.GLASS, C.darkG);
    B.cyl(1, 1, 0.16, 0.3, 5.2, 10, rgb(0xd8d6d0), 0, null, 0.11);
    B.cyl(1, 1, 0.22, 5.2, 5.35, 12, C.white, 0, null, 0.42);
    B.cyl(1, 1, 0.42, 5.35, 5.75, 12, rgb(0x6f9cc4), WIN.GLASS, null, 0.42);
    B.cyl(1, 1, 0.42, 5.75, 5.9, 12, C.white, 0, C.white, 0.2);
    B.cyl(1, 1, 0.1, 5.9, 6.4, 8, rgb(0xd8d6d0), 0, null, 0.08);
    B.cyl(1, 1, 0.035, 6.4, 7.6, 6, C.white, 0, null, 0.015);
    B.box(0.97, 7.6, 0.97, 1.03, 7.68, 1.03, C.redLamp, WIN.LAMP);
    B.box(0.96, 6.4, 0.96, 1.04, 6.46, 1.04, C.redLamp, WIN.LAMP);
    return 7.7;
  },
};

function genericService(B, w, d) {
  ground(B, w, d, C.pave);
  B.box(0.15, 0, 0.2, w - 0.15, 0.5, d - 0.15, C.white, WIN.STD, C.darkG);
  return 0.5;
}

const ZONE_GEN = { 1: genHouse, 2: genApartment, 3: genShop, 4: genMall, 5: genIndustry, 6: genOffice };

export function addBuilding(B, b) {
  const { w, d } = B.rotFrame(b.cx, b.cz, b.rot, b.w, b.d);
  const rng = mulberry32(b.seed + b.level * 7919);
  B.tint = b.abandoned ? (c) => gray(c, 0.55) : null;
  B.winOff = b.abandoned || !b.power || (b.kind === 'zone' && b.occ === 0 && b.built >= 1);
  let h;
  if (b.kind === 'zone' && b.built < 1) h = construction(B, b, w, d, rng);
  else if (b.kind === 'zone') h = ZONE_GEN[b.zone](B, w, d, b.level, rng);
  else h = (SERVICE_GEN[b.def] || genericService)(B, w, d, rng, b);
  B.tint = null;
  B.winOff = false;
  B.identity();
  return h;
}

export { LEAF, LEAF2, CONIFER };
