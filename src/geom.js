// Geometrie-Helfer: quadratische Bézierkurven, Polylinien, gedrehte Rechtecke.
// Punkte sind [x, z] in Weltkoordinaten (1 Einheit = 1 Feld).

export function qPoint(p0, c, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]];
}

export function qTangent(p0, c, p2, t) {
  const u = 1 - t;
  let x = 2 * u * (c[0] - p0[0]) + 2 * t * (p2[0] - c[0]);
  let z = 2 * u * (c[1] - p0[1]) + 2 * t * (p2[1] - c[1]);
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

// Teilt eine quadratische Kurve bei t (de Casteljau)
export function qSplit(p0, c, p2, t) {
  const a = [p0[0] + (c[0] - p0[0]) * t, p0[1] + (c[1] - p0[1]) * t];
  const b = [c[0] + (p2[0] - c[0]) * t, c[1] + (p2[1] - c[1]) * t];
  const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return [[p0, a, m], [m, b, p2]];
}

export function qApproxLen(p0, c, p2) {
  const chord = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
  const poly = Math.hypot(c[0] - p0[0], c[1] - p0[1]) + Math.hypot(p2[0] - c[0], p2[1] - c[1]);
  return (chord + poly) / 2;
}

// Gleichmäßig in t abgetastete Polylinie mit kumulierter Bogenlänge
export function qSample(p0, c, p2, step = 0.25) {
  const n = Math.max(2, Math.ceil(qApproxLen(p0, c, p2) / step));
  const pts = new Float32Array((n + 1) * 2);
  const cum = new Float32Array(n + 1);
  let len = 0;
  for (let i = 0; i <= n; i++) {
    const p = qPoint(p0, c, p2, i / n);
    pts[i * 2] = p[0];
    pts[i * 2 + 1] = p[1];
    if (i > 0) len += Math.hypot(p[0] - pts[i * 2 - 2], p[1] - pts[i * 2 - 1]);
    cum[i] = len;
  }
  return { pts, cum, len, n };
}

// Punkt und Tangente bei Bogenlänge s auf einer abgetasteten Polylinie
export function polyAt(pts, cum, s, out = {}) {
  const n = cum.length - 1;
  if (s <= 0) s = 0;
  if (s >= cum[n]) s = cum[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1e-6;
  const f = Math.min(1, Math.max(0, (s - cum[lo]) / seg));
  const ax = pts[lo * 2], az = pts[lo * 2 + 1], bx = pts[hi * 2], bz = pts[hi * 2 + 1];
  const tx = bx - ax, tz = bz - az;
  const l = Math.hypot(tx, tz) || 1;
  out.x = ax + tx * f;
  out.z = az + tz * f;
  out.tx = tx / l;
  out.tz = tz / l;
  out.t = (lo + f) / n;
  return out;
}

// Bogenlänge zu Kurvenparameter t (bei gleichmäßiger t-Abtastung)
export function sToT(cum, s) {
  const n = cum.length - 1;
  if (s <= 0) return 0;
  if (s >= cum[n]) return 1;
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  return (lo + (s - cum[lo]) / (cum[hi] - cum[lo] || 1e-6)) / n;
}

export function tToS(cum, t) {
  const n = cum.length - 1;
  const f = t * n;
  const i = Math.min(n - 1, Math.max(0, Math.floor(f)));
  return cum[i] + (cum[i + 1] - cum[i]) * (f - i);
}

// Abstand eines Punktes zu einer Polylinie: { d, s (Bogenlänge), x, z }
export function distToPoly(px, pz, pts, cum) {
  const n = cum.length - 1;
  let best = Infinity, bs = 0, bx = 0, bz = 0;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], ex = pts[i * 2 + 2] - ax, ez = pts[i * 2 + 3] - az;
    const ll = ex * ex + ez * ez || 1e-9;
    let f = ((px - ax) * ex + (pz - az) * ez) / ll;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const qx = ax + ex * f, qz = az + ez * f;
    const d = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
    if (d < best) { best = d; bs = cum[i] + (cum[i + 1] - cum[i]) * f; bx = qx; bz = qz; }
  }
  return { d: Math.sqrt(best), s: bs, x: bx, z: bz };
}

// Schnitt zweier Strecken: liefert {u, v} (0..1) oder null
export function segSeg(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = cx - ax, qz = cz - az;
  const u = (qx * sz - qz * sx) / den;
  const v = (qx * rz - qz * rx) / den;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

// Alle Schnittpunkte zweier Polylinien (gleichmäßige t-Abtastung): [{ta, tb, x, z}]
export function polyIntersections(A, B) {
  const out = [];
  const na = A.n, nb = B.n;
  for (let i = 0; i < na; i++) {
    const ax = A.pts[i * 2], az = A.pts[i * 2 + 1], bx = A.pts[i * 2 + 2], bz = A.pts[i * 2 + 3];
    const minx = Math.min(ax, bx), maxx = Math.max(ax, bx), minz = Math.min(az, bz), maxz = Math.max(az, bz);
    for (let j = 0; j < nb; j++) {
      const cx = B.pts[j * 2], cz = B.pts[j * 2 + 1], dx = B.pts[j * 2 + 2], dz = B.pts[j * 2 + 3];
      if (Math.max(cx, dx) < minx || Math.min(cx, dx) > maxx || Math.max(cz, dz) < minz || Math.min(cz, dz) > maxz) continue;
      const h = segSeg(ax, az, bx, bz, cx, cz, dx, dz);
      if (!h) continue;
      out.push({ ta: (i + h.u) / na, tb: (j + h.v) / nb, x: ax + (bx - ax) * h.u, z: az + (bz - az) * h.u });
    }
  }
  // Doppelte Treffer an Stützpunkten entfernen
  out.sort((p, q) => p.ta - q.ta);
  const res = [];
  for (const h of out) {
    const last = res[res.length - 1];
    if (last && Math.hypot(last.x - h.x, last.z - h.z) < 0.05) continue;
    res.push(h);
  }
  return res;
}

// ---------- Gedrehte Rechtecke {cx, cz, rot, w, d}
// L = (cos rot, sin rot) entlang der Front, D = (-sin rot, cos rot) in die Tiefe
export function rectAxes(r) {
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  return { lx: c, lz: s, dx: -s, dz: c };
}

export function rectLocal(px, pz, r) {
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  const x = px - r.cx, z = pz - r.cz;
  return { u: x * c + z * s, v: -x * s + z * c };
}

export function pointInRect(px, pz, r, pad = 0) {
  const { u, v } = rectLocal(px, pz, r);
  return Math.abs(u) <= r.w / 2 + pad && Math.abs(v) <= r.d / 2 + pad;
}

// Abstand eines Punktes zum Rechteck (0 im Inneren)
export function rectDist(px, pz, r) {
  const { u, v } = rectLocal(px, pz, r);
  const ex = Math.max(0, Math.abs(u) - r.w / 2), ez = Math.max(0, Math.abs(v) - r.d / 2);
  return Math.hypot(ex, ez);
}

export function rectCorners(r, shrink = 1) {
  const a = rectAxes(r);
  const hw = (r.w / 2) * shrink, hd = (r.d / 2) * shrink;
  const out = [];
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    out.push([r.cx + a.lx * hw * su + a.dx * hd * sv, r.cz + a.lz * hw * su + a.dz * hd * sv]);
  }
  return out;
}

// Überlappungstest zweier gedrehter Rechtecke (Trennachsen)
export function rectsOverlap(r1, r2, shrink = 1) {
  const c1 = rectCorners(r1, shrink), c2 = rectCorners(r2, shrink);
  const axes = [rectAxes(r1), rectAxes(r2)];
  for (const a of axes) {
    for (const [ax, az] of [[a.lx, a.lz], [a.dx, a.dz]]) {
      let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity;
      for (const p of c1) { const d = p[0] * ax + p[1] * az; if (d < min1) min1 = d; if (d > max1) max1 = d; }
      for (const p of c2) { const d = p[0] * ax + p[1] * az; if (d < min2) min2 = d; if (d > max2) max2 = d; }
      if (max1 <= min2 || max2 <= min1) return false;
    }
  }
  return true;
}

export function rectBounds(r, pad = 0) {
  const cs = rectCorners(r);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of cs) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
}

// Winkel normalisieren auf (-PI, PI]
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

// Ramer-Douglas-Peucker für Freihand-Linien
export function simplify(points, eps) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, az] = points[a], [bx, bz] = points[b];
    const ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const [px, pz] = points[i];
      let f = ((px - ax) * ex + (pz - az) * ez) / ll;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const d = Math.hypot(px - (ax + ex * f), pz - (az + ez * f));
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

// Polylinie -> Kette tangentenstetiger quadratischer Kurven [{p0, c, p2}]
export function smoothChain(pts) {
  if (pts.length < 2) return [];
  if (pts.length === 2) {
    const [a, b] = pts;
    return [{ p0: a, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], p2: b }];
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const out = [];
  const n = pts.length;
  let start = pts[0];
  for (let i = 1; i < n - 1; i++) {
    const end = i === n - 2 ? pts[n - 1] : mid(pts[i], pts[i + 1]);
    out.push({ p0: start, c: pts[i], p2: end });
    start = end;
  }
  return out;
}
