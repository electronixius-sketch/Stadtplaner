// Prozedurale Kartengenerierung: Fluss, See, Berge, Wälder und Autobahnanschluss.
import { makeNoise } from './noise.js';
import { mulberry32, smoothstep, hash2 } from './util.js';
import { T_LAND, T_WATER, T_ROCK, EXT_PAD, HIGHWAY_LEN } from './config.js';

function bfsDistance(ES, isSource, passable) {
  const n = ES * ES;
  const dist = new Uint16Array(n).fill(65535);
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let e = 0; e < n; e++) if (isSource(e)) { dist[e] = 0; q[tail++] = e; }
  while (head < tail) {
    const e = q[head++];
    const x = e % ES, y = (e / ES) | 0, d = dist[e] + 1;
    if (x > 0) { const f = e - 1; if (dist[f] > d && passable(f)) { dist[f] = d; q[tail++] = f; } }
    if (x < ES - 1) { const f = e + 1; if (dist[f] > d && passable(f)) { dist[f] = d; q[tail++] = f; } }
    if (y > 0) { const f = e - ES; if (dist[f] > d && passable(f)) { dist[f] = d; q[tail++] = f; } }
    if (y < ES - 1) { const f = e + ES; if (dist[f] > d && passable(f)) { dist[f] = d; q[tail++] = f; } }
  }
  return dist;
}

export function generateMap(world, seed) {
  const S = world.size, P = EXT_PAD, ES = S + 2 * P;
  const nz = makeNoise(seed);
  const rng = mulberry32((seed * 7919 + 13) >>> 0);

  const hwY = Math.floor(S / 2 + (rng() - 0.5) * 20);
  const startX = HIGHWAY_LEN + 10;
  const riverBase = S * (0.62 + rng() * 0.1);
  const amp = 5 + rng() * 7;
  const freq = 0.025 + rng() * 0.02;
  const ph = rng() * Math.PI * 2;
  const riverX = (y) => riverBase + Math.sin(y * freq + ph) * amp + nz.fbm(y * 0.025, 11.7, 3) * 14;
  const riverW = (y) => 1.9 + (nz.noise(y * 0.045, 5.3) * 0.5 + 0.5) * 2.4;

  const hasLake = rng() < 0.85;
  const lakeX = S * (0.18 + rng() * 0.2);
  const lakeY = hwY < S / 2 ? S * (0.75 + rng() * 0.08) : S * (0.17 + rng() * 0.08);
  const lakeR = 5 + rng() * 4;

  const types = new Uint8Array(ES * ES);
  const mval = new Float32Array(ES * ES);
  for (let ey = 0; ey < ES; ey++) {
    for (let ex = 0; ex < ES; ex++) {
      const x = ex - P, y = ey - P, e = ey * ES + ex;
      const cx = (x + 0.5) / S - 0.5, cy = (y + 0.5) / S - 0.5;
      const edge = Math.max(Math.abs(cx), Math.abs(cy)) * 2;
      let m = nz.fbm(x * 0.035 + 50, y * 0.035 - 20, 4) * 0.55 + 0.5;
      m += smoothstep(0.7, 1.0, edge) * 0.38 + smoothstep(1.0, 1.4, edge) * 1.5;
      const dCorr = x < startX ? Math.abs(y - hwY) : 1e9;
      m -= smoothstep(9, 2, dCorr) * 1.6;
      m -= smoothstep(30, 12, Math.hypot(x - startX, y - hwY)) * 0.7;
      mval[e] = m;
      let t = m > 0.86 ? T_ROCK : T_LAND;
      const ry = y + 0.5;
      if (Math.abs(x + 0.5 - riverX(ry)) < riverW(ry)) t = T_WATER;
      if (hasLake) {
        const d = Math.hypot(x + 0.5 - lakeX, y + 0.5 - lakeY) + nz.noise(x * 0.25, y * 0.25) * 2.2;
        if (d < lakeR) t = T_WATER;
      }
      if (y === hwY && x <= HIGHWAY_LEN) t = T_LAND;
      types[e] = t;
    }
  }

  // Distanzfelder für Wassertiefe und Berghänge
  const wDist = bfsDistance(ES, (e) => types[e] !== T_WATER, (e) => types[e] === T_WATER);
  const rDist = bfsDistance(ES, (e) => types[e] !== T_ROCK, (e) => types[e] === T_ROCK);

  const th = new Float32Array(ES * ES);
  for (let e = 0; e < ES * ES; e++) {
    const t = types[e];
    if (t === T_WATER) th[e] = -(0.3 + Math.min(wDist[e], 4) * 0.16);
    else if (t === T_ROCK) {
      const x = (e % ES) - P, y = ((e / ES) | 0) - P;
      const d = rDist[e];
      const cap = 0.8 + (mval[e] - 0.86) * 18;
      let h = Math.min(d * 0.7, cap);
      h += nz.fbm(x * 0.13 + 7, y * 0.13 + 3, 3) * 0.9 * Math.min(1, d / 3);
      th[e] = Math.max(0.15, h);
    }
  }

  // Eckhöhen: Ecken an Land sind exakt 0, damit alles Bauland flach bleibt
  const CS = ES + 1;
  const ch = new Float32Array(CS * CS);
  for (let cy = 0; cy < CS; cy++) {
    for (let cx = 0; cx < CS; cx++) {
      let anyLand = false, ws = 0, wn = 0, rs = 0, rn = 0;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = Math.min(ES - 1, Math.max(0, cx + dx));
          const ty = Math.min(ES - 1, Math.max(0, cy + dy));
          const e = ty * ES + tx;
          const t = types[e];
          if (t === T_LAND) anyLand = true;
          else if (t === T_WATER) { ws += th[e]; wn++; }
          else { rs += th[e]; rn++; }
        }
      }
      ch[cy * CS + cx] = anyLand ? 0 : wn ? ws / wn : rs / rn;
    }
  }

  // Karte übernehmen
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      world.terrain[y * S + x] = types[(y + P) * ES + x + P];
    }
  }

  // Wälder
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (world.terrain[i] !== T_LAND) continue;
      const f = nz.fbm(x * 0.06 + 200, y * 0.06 + 300, 3);
      let c = f > 0.3 ? 3 : f > 0.2 ? 2 : f > 0.11 ? 1 : (rng() < 0.012 ? 1 : 0);
      if (Math.abs(y - hwY) <= 2 && x <= HIGHWAY_LEN + 3) c = 0;
      world.trees[i] = c;
    }
  }

  // Dekorative Bäume im Umland
  const outTrees = [];
  for (let ey = 0; ey < ES && outTrees.length < 45000; ey++) {
    for (let ex = 0; ex < ES; ex++) {
      const x = ex - P, y = ey - P;
      if (x >= -1 && y >= -1 && x <= S && y <= S) continue;
      const e = ey * ES + ex;
      if (types[e] === T_WATER || th[e] > 2.6) continue;
      if (Math.abs(y - hwY) <= 1 && x < 0) continue;
      const f = nz.fbm(x * 0.06 + 200, y * 0.06 + 300, 3);
      const r = hash2(x, y, seed);
      const cnt = f > 0.2 ? (r < 0.5 ? 2 : 1) : f > 0.05 ? (r < 0.35 ? 1 : 0) : (r < 0.03 ? 1 : 0);
      for (let k = 0; k < cnt; k++) {
        const ox = hash2(x, y, seed + 11 + k), oz = hash2(x, y, seed + 37 + k);
        const wx = x + 0.15 + ox * 0.7, wz = y + 0.15 + oz * 0.7;
        outTrees.push(wx, heightAt(ch, CS, P, wx, wz), wz, 0.8 + hash2(x, y, k + 5) * 0.7, hash2(x, y, k + 9));
      }
    }
  }

  // Wasserabstand innerhalb der Karte
  const q = new Int32Array(S * S);
  let head = 0, tail = 0;
  world.waterDist.fill(255);
  for (let i = 0; i < S * S; i++) if (world.terrain[i] === T_WATER) { world.waterDist[i] = 0; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++];
    const x = i % S, y = (i / S) | 0, d = world.waterDist[i] + 1;
    if (d > 250) continue;
    const nb = [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, y > 0 ? i - S : -1, y < S - 1 ? i + S : -1];
    for (const j of nb) if (j >= 0 && world.waterDist[j] > d) { world.waterDist[j] = d; q[tail++] = j; }
  }

  // Autobahn vom Kartenrand (wird von der Welt als Straßensegment angelegt)
  for (let x = 0; x <= HIGHWAY_LEN + 1; x++) world.trees[hwY * S + x] = 0;
  world.highway = { x0: 0, x1: HIGHWAY_LEN + 0.5, z: hwY + 0.5 };
  world.start = { x: HIGHWAY_LEN + 5, y: hwY };
  world.ext = { P, ES, CS, types, ch, outTrees, hwY };
}

export function heightAt(ch, CS, P, wx, wz) {
  const gx = wx + P, gz = wz + P;
  const x0 = Math.max(0, Math.min(CS - 2, Math.floor(gx)));
  const z0 = Math.max(0, Math.min(CS - 2, Math.floor(gz)));
  const fx = gx - x0, fz = gz - z0;
  const a = ch[z0 * CS + x0], b = ch[z0 * CS + x0 + 1];
  const c = ch[(z0 + 1) * CS + x0], d = ch[(z0 + 1) * CS + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}
