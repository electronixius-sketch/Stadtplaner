// Straßengeometrie für das Vektornetz: Fahrbahnbänder entlang der Kurven, Gehwege mit Bordstein,
// Markierungen, Kreuzungsflächen mit abgerundeten Ecken, Zebrastreifen, Laternen, Alleebäume und Brücken.
// Alle Koordinaten sind Weltkoordinaten (Rahmen des MeshBuilders = Identität).
import { rgb, mulberry32, pick } from '../util.js';
import { ROAD_TYPES, T_WATER } from '../config.js';
import { qPoint, qTangent, qSample, polyAt } from '../geom.js';
import { LEAF, LEAF2 } from './buildingGeo.js';

const A = {
  asph: rgb(0x4b4e54), asphH: rgb(0x3f4248), side: rgb(0xbab5ab), curb: rgb(0xa29d93), mark: rgb(0xeeeeea),
  yellow: rgb(0xf2c94c), median: rgb(0x6aa04a), rail: rgb(0xb0b7be), deck: rgb(0x9c9890), pillar: rgb(0x8a867e),
  pole: rgb(0x3a3f45), lamp: rgb(0xfff1c4), trunk: rgb(0x6b4a2b),
};

const Y = 0.02, MY = 0.027, SY = 0.05, DECK = -0.16;

function spec(type) {
  const t = ROAD_TYPES[type];
  const hw = t.width / 2;
  return { type, hw, ha: hw - t.sidewalk, sw: t.sidewalk };
}

// Rahmen auf einer Kurve bei Bogenlänge s: Position, Tangente, Linksnormale (n), Gehrungsfaktor k
function frameAt(seg, s, out = {}) {
  const p = polyAt(seg.pts, seg.cum, s);
  const q = qPoint(seg.p0, seg.c, seg.p2, p.t), t = qTangent(seg.p0, seg.c, seg.p2, p.t);
  out.s = s; out.x = q[0]; out.z = q[1]; out.tx = t[0]; out.tz = t[1]; out.nx = -t[1]; out.nz = t[0]; out.k = 1;
  return out;
}

const lat = (f, h) => [f.x + f.nx * h * f.k, f.z + f.nz * h * f.k];

// ---------------------------------------------------------------- Bausteine
function strip(B, f0, f1, h0, h1, y, col) {
  B.quadUp(lat(f0, h0), lat(f0, h1), lat(f1, h1), lat(f1, h0), y, col);
}

function side(B, f0, f1, h, y0, y1, col, dir) {
  B.wall(lat(f0, h), lat(f1, h), y0, y1, col, f0.nx * dir, f0.nz * dir);
}

// Erhöhter Streifen (Gehweg, Mittelstreifen): Oberseite + beide Kanten
function raised(B, f0, f1, h0, h1, y0, y1, col, colSide, outerY0 = y0) {
  strip(B, f0, f1, h0, h1, y1, col);
  side(B, f0, f1, h0, y0, y1, colSide, h0 < h1 ? -1 : 1);
  side(B, f0, f1, h1, outerY0, y1, colSide, h0 < h1 ? 1 : -1);
}

function dashes(B, seg, s0, s1, h, w, len, period, col, y = MY) {
  const n = Math.floor((s1 - s0) / period);
  if (n < 1) return;
  const off = s0 + ((s1 - s0) - n * period + (period - len)) / 2;
  const f0 = {}, f1 = {};
  for (let k = 0; k < n; k++) {
    const a = off + k * period;
    frameAt(seg, a, f0);
    frameAt(seg, a + len, f1);
    strip(B, f0, f1, h - w / 2, h + w / 2, y, col);
  }
}

// Laterne am Gehweg: lokaler Rahmen mit -z zur Straßenmitte
function lamp(B) {
  B.box(-0.009, SY, -0.009, 0.009, 0.36, 0.009, A.pole, 0);
  B.box(-0.006, 0.34, -0.1, 0.006, 0.355, 0, A.pole, 0);
  B.box(-0.022, 0.32, -0.13, 0.022, 0.345, -0.08, A.lamp, 2);
}

// Doppellaterne auf dem Mittelstreifen: Ausleger entlang lokal x (quer zur Fahrbahn)
function lampMedian(B, h = 0.4, reach = 0.2) {
  B.box(-0.01, 0.04, -0.01, 0.01, h, 0.01, A.pole, 0);
  B.box(-reach, h - 0.02, -0.012, reach, h - 0.005, 0.012, A.pole, 0);
  B.box(-reach - 0.02, h - 0.04, -0.02, -reach + 0.04, h - 0.015, 0.02, A.lamp, 2);
  B.box(reach - 0.04, h - 0.04, -0.02, reach + 0.02, h - 0.015, 0.02, A.lamp, 2);
}

// Rahmen an einer Seitenposition: L entlang der Straße, D nach außen (sideSign = ±1)
function sideFrame(B, f, h, sideSign) {
  const [x, z] = lat(f, h);
  if (sideSign > 0) B.frame(x, z, f.tx, f.tz, f.nx, f.nz);
  else B.frame(x, z, -f.tx, -f.tz, -f.nx, -f.nz);
}

// Rahmen auf der Mittellinie: L quer, D entlang (rechtshändig)
function medianFrame(B, f) { B.frame(f.x, f.z, f.nx, f.nz, -f.tx, -f.tz); }

// ---------------------------------------------------------------- Segmentband
// Abtastpunkte: auf Geraden grob, in Kurven fein, über Wasser für Brückenkanten enger
function sampleS(seg, s0, s1, water) {
  const ta = qTangent(seg.p0, seg.c, seg.p2, 0), tb = qTangent(seg.p0, seg.c, seg.p2, 1);
  const turn = Math.acos(Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1])));
  const L = s1 - s0;
  let n = Math.max(1, Math.ceil(L / 2), Math.ceil((turn / 0.07) * (L / seg.len)));
  if (water) n = Math.max(n, Math.ceil(L / 0.4));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(s0 + (L * i) / n);
  return out;
}

// Gehrung an einem nahtlosen Knoten: gemeinsamer Querschnitt beider Segmente
function miter(f, info, node, segId) {
  const [p, q] = info.arms;
  const me = p.seg.id === segId ? p : q, other = me === p ? q : p;
  let tx = other.dx - me.dx, tz = other.dz - me.dz;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l; tz /= l;
  let nx = -tz, nz = tx;
  let k = nx * f.nx + nz * f.nz;
  if (k < 0) { nx = -nx; nz = -nz; k = -k; }
  f.x = node.x; f.z = node.z;
  f.nx = nx; f.nz = nz; f.k = 1 / Math.max(k, 0.5);
}

export function addSegment(B, net, seg, infoA, infoB, terrainAt) {
  B.identity();
  const sp = spec(seg.type), { hw, ha, sw } = sp;
  const armA = infoA.arms.find((a) => a.seg.id === seg.id && a.atA);
  const armB = infoB.arms.find((a) => a.seg.id === seg.id && !a.atA);
  const s0 = armA ? armA.t : 0, s1 = seg.len - (armB ? armB.t : 0);
  if (s1 - s0 < 0.02) return;
  let anyWater = false;
  for (let s = s0; s <= s1 && !anyWater; s += 0.3) {
    const p = net.at(seg, s);
    if (terrainAt(p.x, p.z) === T_WATER) anyWater = true;
  }
  const S = sampleS(seg, s0, s1, anyWater);
  const F = S.map((s) => frameAt(seg, s));
  const nA = net.nodes.get(seg.a), nB = net.nodes.get(seg.b);
  if (infoA.smooth) miter(F[0], infoA, nA, seg.id);
  if (infoB.smooth) miter(F[F.length - 1], infoB, nB, seg.id);
  const water = [];
  for (let i = 0; i < F.length - 1; i++) {
    const s = (S[i] + S[i + 1]) / 2;
    const p = net.at(seg, s);
    water.push(terrainAt(p.x, p.z) === T_WATER);
  }
  const asph = seg.type === 3 ? A.asphH : A.asph;
  for (let i = 0; i < F.length - 1; i++) {
    const f0 = F[i], f1 = F[i + 1], wat = water[i];
    strip(B, f0, f1, -ha, ha, Y, asph);
    if (sw > 0) {
      raised(B, f0, f1, ha, hw, Y, SY, A.side, A.curb, wat ? DECK : 0);
      raised(B, f0, f1, -ha, -hw, Y, SY, A.side, A.curb, wat ? DECK : 0);
    } else if (wat) {
      side(B, f0, f1, hw, DECK, Y, A.deck, 1);
      side(B, f0, f1, -hw, DECK, Y, A.deck, -1);
    }
    const top = sw > 0 ? SY : Y;
    if (wat || seg.type === 3) {
      // Geländer bzw. Leitplanke an beiden Außenkanten
      for (const sg of [1, -1]) {
        const h = sg * (hw - 0.02);
        side(B, f0, f1, h, top, top + 0.06, A.rail, sg);
        side(B, f0, f1, h - sg * 0.012, top, top + 0.06, A.rail, -sg);
        strip(B, f0, f1, h - sg * 0.012, h, top + 0.06, A.rail);
      }
    }
    if (seg.type === 2) raised(B, f0, f1, -0.055, 0.055, Y, 0.045, A.median, A.curb);
    if (seg.type === 3) {
      raised(B, f0, f1, -0.022, 0.022, Y, 0.075, A.rail, A.rail);
      for (const sg of [1, -1]) strip(B, f0, f1, sg * (hw - 0.1) - 0.01, sg * (hw - 0.1) + 0.01, MY, A.mark);
    }
  }
  // Markierungen
  if (seg.type === 1) dashes(B, seg, s0 + 0.08, s1 - 0.08, 0, 0.024, 0.14, 0.3, A.mark);
  else if (seg.type === 2) for (const h of [-0.34, 0.34]) dashes(B, seg, s0 + 0.08, s1 - 0.08, h, 0.02, 0.13, 0.3, A.mark);
  else for (const h of [-0.38, 0.38]) dashes(B, seg, s0 + 0.05, s1 - 0.05, h, 0.02, 0.2, 0.4, A.mark);

  // Ausstattung: Laternen, Bäume, Brückenpfeiler
  const rng = mulberry32(seg.id * 92821 + 17);
  const f = {};
  const span = s1 - s0 - 0.8;
  if (span > 0.2) {
    const period = seg.type === 2 ? 1.3 : seg.type === 3 ? 3 : 2.4;
    const n = Math.max(1, Math.floor(span / period) + 1);
    for (let k = 0; k < n; k++) {
      const s = s0 + 0.4 + (n === 1 ? span / 2 : (span * k) / (n - 1));
      frameAt(seg, s, f);
      const onWater = terrainAt(f.x, f.z) === T_WATER;
      if (seg.type === 1) {
        const sg = (k + seg.id) & 1 ? 1 : -1;
        sideFrame(B, f, sg * (hw - 0.075), sg);
        lamp(B);
      } else if (seg.type === 2) {
        medianFrame(B, f);
        if (k & 1 || onWater) lampMedian(B);
        else B.tree(0, 0, 0.55, 0, pick(rng, LEAF), pick(rng, LEAF2), A.trunk);
        if (!onWater) {
          for (const sg of [1, -1]) {
            sideFrame(B, f, sg * (hw - sw / 2), sg);
            B.tree(0, 0, 0.6 + rng() * 0.2, 0, pick(rng, LEAF), pick(rng, LEAF2), A.trunk);
          }
        }
      } else {
        medianFrame(B, f);
        lampMedian(B, 0.45, 0.3);
      }
    }
  }
  if (anyWater) {
    B.identity();
    for (let s = s0 + 0.5; s < s1 - 0.3; s += 2) {
      frameAt(seg, s, f);
      if (terrainAt(f.x, f.z) !== T_WATER) continue;
      B.cyl(f.x, f.z, 0.09 + hw * 0.08, -1.1, DECK, 6, A.pillar, 0, null);
    }
  }
  B.identity();
}

// ---------------------------------------------------------------- Kreuzungsfläche
function mouth(arm) {
  const f = frameAt(arm.seg, arm.atA ? arm.t : arm.seg.len - arm.t);
  const ox = arm.atA ? f.tx : -f.tx, oz = arm.atA ? f.tz : -f.tz;
  return { x: f.x, z: f.z, ox, oz, nx: -oz, nz: ox, t: arm.t };
}

function lineX(p, d, q, e) {
  const cr = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(cr) < 1e-4) return null;
  const wx = q[0] - p[0], wz = q[1] - p[1];
  const u = (wx * e[1] - wz * e[0]) / cr, v = (wx * d[1] - wz * d[0]) / cr;
  if (u > 0.05 || v > 0.05) return null;
  return [p[0] + d[0] * u, p[1] + d[1] * u];
}

// Bordkante zwischen Arm a (linke Seite) und Arm b (rechte Seite), von a nach b
function gapPath(node, a, b, gap, ha, hb) {
  const e1 = [a.x + a.nx * ha, a.z + a.nz * ha];
  const e2 = [b.x - b.nx * hb, b.z - b.nz * hb];
  const pts = [e1];
  if (gap < Math.PI - 0.1) {
    const X = lineX(e1, [a.ox, a.oz], e2, [b.ox, b.oz]) || [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2];
    const K = 6;
    for (let k = 1; k < K; k++) pts.push(qPoint(e1, X, e2, k / K));
  } else {
    const a0 = Math.atan2(a.nz, a.nx), span = Math.max(0, gap - Math.PI);
    const m = Math.max(1, Math.ceil(span / 0.3));
    if (a.t > 0.01) pts.push([node.x + a.nx * ha, node.z + a.nz * ha]);
    for (let k = 1; k < m; k++) {
      const ang = a0 + (span * k) / m, r = ha + ((hb - ha) * k) / m;
      pts.push([node.x + Math.cos(ang) * r, node.z + Math.sin(ang) * r]);
    }
    if (b.t > 0.01) pts.push([node.x - b.nx * hb, node.z - b.nz * hb]);
  }
  pts.push(e2);
  return pts;
}

export function addNode(B, node, info, terrainAt) {
  B.identity();
  const arms = info.arms, n = arms.length;
  if (!n || info.smooth || node.outside) return;
  const M = arms.map(mouth);
  const S = arms.map((a) => spec(a.seg.type));
  const water = terrainAt(node.x, node.z) === T_WATER;
  const allHw = arms.every((a) => a.seg.type === 3);
  const asph = allHw ? A.asphH : A.asph;
  const poly = [];
  const gaps = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let gap = arms[j].ang - arms[i].ang;
    if (i === n - 1) gap += Math.PI * 2;
    const inner = gapPath(node, M[i], M[j], gap, S[i].ha, S[j].ha);
    const outer = gapPath(node, M[i], M[j], gap, S[i].hw, S[j].hw);
    gaps.push({ inner, outer });
    const m = M[i];
    poly.push([m.x - m.nx * S[i].ha, m.z - m.nz * S[i].ha]);
    for (const p of inner) poly.push(p);
  }
  // Fahrbahn als Fächer um den Knoten
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length];
    B.triUp(node.x, node.z, p[0], p[1], q[0], q[1], Y, asph);
  }
  // Gehwege mit Bordstein entlang der Ecken
  for (const { inner, outer } of gaps) {
    for (let k = 0; k < inner.length - 1; k++) {
      const i0 = inner[k], i1 = inner[k + 1], o0 = outer[k], o1 = outer[k + 1];
      const wide = Math.hypot(o0[0] - i0[0], o0[1] - i0[1]) > 0.01 || Math.hypot(o1[0] - i1[0], o1[1] - i1[1]) > 0.01;
      if (wide) {
        B.quadUp(i0, o0, o1, i1, SY, A.side);
        B.wall(i0, i1, Y, SY, A.curb, i0[0] - o0[0], i0[1] - o0[1]);
        B.wall(o0, o1, water ? DECK : 0, SY, A.curb, o0[0] - i0[0], o0[1] - i0[1]);
      } else if (water) {
        B.wall(o0, o1, DECK, Y, A.deck, o0[0] - node.x, o0[1] - node.z);
      }
    }
  }
  // Zebrastreifen an städtischen Kreuzungen
  if (n >= 2) {
    for (let i = 0; i < n; i++) {
      const m = M[i], ha = S[i].ha;
      if (arms[i].seg.type === 3 || m.t < 0.32) continue;
      for (let u = -ha + 0.06; u <= ha - 0.05; u += 0.09) {
        const c0 = [m.x - m.ox * 0.2 + m.nx * (u - 0.025), m.z - m.oz * 0.2 + m.nz * (u - 0.025)];
        const c1 = [m.x - m.ox * 0.2 + m.nx * (u + 0.025), m.z - m.oz * 0.2 + m.nz * (u + 0.025)];
        const c2 = [m.x - m.ox * 0.06 + m.nx * (u + 0.025), m.z - m.oz * 0.06 + m.nz * (u + 0.025)];
        const c3 = [m.x - m.ox * 0.06 + m.nx * (u - 0.025), m.z - m.oz * 0.06 + m.nz * (u - 0.025)];
        B.quadUp(c0, c1, c2, c3, MY, A.mark);
      }
    }
  }
  if (water) B.cyl(node.x, node.z, 0.16, -1.1, DECK, 6, A.pillar, 0, null);
}

// Gerades Straßenstück ohne Netzanbindung (Autobahn im Umland)
export function addStraightRoad(B, x0, z0, x1, z1, type) {
  const p0 = [x0, z0], p2 = [x1, z1], c = [(x0 + x1) / 2, (z0 + z1) / 2];
  const smp = qSample(p0, c, p2, 1);
  const seg = { id: 1, type, p0, c, p2, pts: smp.pts, cum: smp.cum, len: smp.len, n: smp.n, a: -1, b: -1 };
  const net = { at: (s, a) => polyAt(s.pts, s.cum, a), nodes: new Map([[-1, { x: x0, z: z0 }]]) };
  const none = { arms: [], smooth: false };
  addSegment(B, net, seg, none, none, () => 0);
}

// Schlüssel für Geometrie-Caches: ändert sich, sobald sich die Form an Knoten oder Segment ändert
export function nodeKey(node) { return `${node.x.toFixed(3)},${node.z.toFixed(3)}|${node.segs.slice().sort((a, b) => a - b).join(',')}`; }
export function segKey(net, seg) {
  const a = net.nodes.get(seg.a), b = net.nodes.get(seg.b);
  return `${seg.type}|${nodeKey(a)}|${nodeKey(b)}`;
}
