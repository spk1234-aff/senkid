// Shape recognition from a freehand point list [x0,y0,x1,y1,...] (page coords)
const D2R = Math.PI / 180;

function pathLen(p) { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; }
function resample(p, n) {
  const L = pathLen(p); if (L === 0) return p.slice(0, 2);
  const step = L / (n - 1), out = [p[0], p[1]]; let acc = 0;
  let px = p[0], py = p[1];
  for (let i = 2; i < p.length; i += 2) {
    let x = p[i], y = p[i + 1], d = Math.hypot(x - px, y - py);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d; const nx = px + (x - px) * t, ny = py + (y - py) * t;
      out.push(nx, ny); px = nx; py = ny; d = Math.hypot(x - px, y - py); acc = 0;
    }
    acc += d; px = x; py = y;
  }
  if (out.length < n * 2) out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function rdp(pts, eps) { // pts: array of [x,y]
  if (pts.length < 3) return pts.slice();
  let dmax = 0, idx = 0; const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = distSeg(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax > eps) { const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps); return l.slice(0, -1).concat(r); }
  return [a, b];
}
const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
function angleAt(prev, cur, next) { // interior angle in degrees
  const a1 = Math.atan2(prev[1] - cur[1], prev[0] - cur[0]), a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
  let d = Math.abs(a1 - a2) / D2R; if (d > 180) d = 360 - d; return d;
}
export function snapAngle(a, tolDeg = 7) {
  const step = Math.PI / 4, s = Math.round(a / step) * step;
  return Math.abs(a - s) < tolDeg * D2R ? s : a;
}
function snapLine(x0, y0, x1, y1) {
  const L = Math.hypot(x1 - x0, y1 - y0), a = snapAngle(Math.atan2(y1 - y0, x1 - x0));
  return [x0, y0, x0 + Math.cos(a) * L, y0 + Math.sin(a) * L];
}

function fitEllipse(P) { // P array of [x,y], closed loop
  let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= P.length; cy /= P.length;
  let sxx = 0, syy = 0, sxy = 0; for (const p of P) { const x = p[0] - cx, y = p[1] - cy; sxx += x * x; syy += y * y; sxy += x * y; }
  sxx /= P.length; syy /= P.length; sxy /= P.length;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const rot = Math.atan2(l1 - sxx, sxy || 1e-9);
  let a = Math.sqrt(2 * l1), b = Math.sqrt(2 * l2);
  // refine scale & error
  const c = Math.cos(rot), s = Math.sin(rot);
  const rr = P.map(p => { const x = (p[0] - cx) * c + (p[1] - cy) * s, y = -(p[0] - cx) * s + (p[1] - cy) * c; return Math.hypot(x / a, y / b); });
  const m = rr.reduce((u, v) => u + v, 0) / rr.length; a *= m; b *= m;
  const err = Math.sqrt(rr.reduce((u, v) => u + (v / m - 1) ** 2, 0) / rr.length);
  // angular coverage
  let sweep = 0; for (let i = 1; i < P.length; i++) { let d = Math.atan2(P[i][1] - cy, P[i][0] - cx) - Math.atan2(P[i - 1][1] - cy, P[i - 1][0] - cx); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; sweep += d; }
  return { cx, cy, rx: a, ry: b, rot, err, sweep: Math.abs(sweep) };
}

function cleanCorners(V, perim) {
  // V: closed list of corners (no repeat). Remove near-straight and very short sides.
  let changed = true;
  while (changed && V.length > 3) {
    changed = false;
    for (let i = 0; i < V.length; i++) {
      const p = V[(i - 1 + V.length) % V.length], c = V[i], n = V[(i + 1) % V.length];
      if (angleAt(p, c, n) > 155 || Math.hypot(n[0] - c[0], n[1] - c[1]) < perim * 0.06) { V.splice(i, 1); changed = true; break; }
    }
  }
  return V;
}

function rectFrom(V) {
  // best-fit rectangle from 4 corners: orientation from longest edge (snapped)
  let best = 0, a = 0;
  for (let i = 0; i < 4; i++) { const p = V[i], q = V[(i + 1) % 4]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L > best) { best = L; a = ang(p, q); } }
  a = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2); if (a > Math.PI / 4) a -= Math.PI / 2;
  if (Math.abs(a) < 8 * D2R) a = 0;
  const c = Math.cos(a), s = Math.sin(a);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of V) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
  // shrink to average of inner/outer extents for a balanced fit
  const U = V.map(p => p[0] * c + p[1] * s).sort((m, n) => m - n), W = V.map(p => -p[0] * s + p[1] * c).sort((m, n) => m - n);
  x0 = (U[0] + U[1]) / 2; x1 = (U[2] + U[3]) / 2; y0 = (W[0] + W[1]) / 2; y1 = (W[2] + W[3]) / 2;
  const back = (u, v) => [u * c - v * s, u * s + v * c];
  return [back(x0, y0), back(x1, y0), back(x1, y1), back(x0, y1)].flat();
}

function regularize(V) {
  // regular polygon if sides & angles are similar
  const n = V.length; let cx = 0, cy = 0; V.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= n; cy /= n;
  const sides = V.map((p, i) => Math.hypot(V[(i + 1) % n][0] - p[0], V[(i + 1) % n][1] - p[1]));
  const ms = sides.reduce((a, b) => a + b) / n; const cv = Math.sqrt(sides.reduce((a, b) => a + (b - ms) ** 2, 0) / n) / ms;
  if (cv > 0.22) return V.flat();
  const R = V.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) / n;
  let a0 = Math.atan2(V[0][1] - cy, V[0][0] - cx);
  // snap so a side or vertex is axis aligned when close
  const step = 2 * Math.PI / n, cand = [-Math.PI / 2, Math.PI / 2 + step / 2];
  for (const c of cand) { let d = ((a0 - c) % step + step) % step; if (d > step / 2) d -= step; if (Math.abs(d) < 10 * D2R) { a0 -= d; break; } }
  const dir = ((V[1][0] - cx) * (V[0][1] - cy) - (V[1][1] - cy) * (V[0][0] - cx)) > 0 ? -1 : 1;
  const out = []; for (let i = 0; i < n; i++) { const t = a0 + dir * i * step; out.push(cx + R * Math.cos(t), cy + R * Math.sin(t)); }
  return out;
}

// Main entry. p: flat [x,y,...]. returns shape object or null
// remove the jitter cluster where the pen rested (start touch-down and the hold at the end)
function trimRest(p) {
  if (p.length < 12) return p;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  const r = Math.max(4, 0.045 * Math.hypot(x1 - x0, y1 - y0));
  const n = p.length / 2;
  const ex = p[p.length - 2], ey = p[p.length - 1];
  let end = n - 1; while (end > 1 && Math.hypot(p[end * 2 - 2] - ex, p[end * 2 - 1] - ey) < r) end--;
  const sx = p[0], sy = p[1];
  let st = 0; while (st < end - 1 && Math.hypot(p[st * 2 + 2] - sx, p[st * 2 + 3] - sy) < r) st++;
  const out = [p[0], p[1]];
  for (let i = st + 1; i < end; i++) out.push(p[i * 2], p[i * 2 + 1]);
  out.push(ex, ey);
  return out.length >= 4 ? out : p;
}
function circle3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-9) return null;
  const A = a[0] ** 2 + a[1] ** 2, B = b[0] ** 2 + b[1] ** 2, C = c[0] ** 2 + c[1] ** 2;
  const cx = (A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d, cy = (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}
export { circle3 };
function fitCircle(P) { // Kasa least squares
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = P.length;
  for (const [x, y] of P) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], V = [sxz, syz, sz];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M); if (Math.abs(D) < 1e-9) return null;
  const sol = [0, 1, 2].map(k => det(M.map((row, i) => row.map((v, j) => j === k ? V[i] : v))) / D);
  const cx = sol[0] / 2, cy = sol[1] / 2, r = Math.sqrt(Math.max(0, sol[2] + cx * cx + cy * cy));
  let e = 0; for (const [x, y] of P) e += (Math.hypot(x - cx, y - cy) - r) ** 2;
  return { cx, cy, r, err: Math.sqrt(e / n) / (r || 1) };
}

// an S-shaped wave crosses its fitted line and swings both ways; a wobbly straight line doesn't swing far
function flipsLow(P, mx, my, ux, uy, ext) {
  let pos = 0, neg = 0; for (const q of P) { const d = -(q[0] - mx) * uy + (q[1] - my) * ux; pos = Math.max(pos, d); neg = Math.min(neg, d); }
  return Math.min(pos, -neg) < 0.03 * ext;
}
// does the stroke bend one way only? (signed distance from the chord keeps one sign)
function singleBend(P) {
  const s = P[0], e = P[P.length - 1], L = Math.hypot(e[0] - s[0], e[1] - s[1]) || 1;
  let pos = 0, neg = 0, mx = 0;
  for (const q of P) { const d = ((e[0] - s[0]) * (q[1] - s[1]) - (e[1] - s[1]) * (q[0] - s[0])) / L; mx = Math.max(mx, Math.abs(d)); if (d > 0) pos = Math.max(pos, d); else neg = Math.max(neg, -d); }
  return Math.min(pos, neg) < Math.max(0.12 * mx, 2);
}
// quadratic through start, the point farthest from the chord (vertex) and end
function quadFrom(P) {
  const s = P[0], e = P[P.length - 1], L = Math.hypot(e[0] - s[0], e[1] - s[1]) || 1;
  let best = P[P.length >> 1], bd = -1;
  for (const q of P) { const d = Math.abs((e[0] - s[0]) * (q[1] - s[1]) - (e[1] - s[1]) * (q[0] - s[0])) / L; if (d > bd) { bd = d; best = q; } }
  return { k: 'quad', closed: false, pts: [s[0], s[1], best[0], best[1], e[0], e[1]] };
}
export function recognize(p) {
  if (p.length < 8) return null;
  p = trimRest(p);
  const L = pathLen(p); if (L < 14) return null;
  const R = resample(p, 96); const P = []; for (let i = 0; i < R.length; i += 2) P.push([R[i], R[i + 1]]);
  const s = P[0], e = P[P.length - 1];
  const chord = Math.hypot(e[0] - s[0], e[1] - s[1]);
  // bbox size
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of P) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const diag = Math.hypot(x1 - x0, y1 - y0);

  // ---- straight line ----
  // straightness: deviation from the best-fit line (PCA), relative to the stroke's extent
  let mx = 0, my = 0; for (const q of P) { mx += q[0]; my += q[1]; } mx /= P.length; my /= P.length;
  let sxx = 0, syy = 0, sxy = 0; for (const q of P) { const dx = q[0] - mx, dy = q[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
  let tmin = Infinity, tmax = -Infinity, dmax = 0, dsum = 0, sgn = 0, flips = 0;
  for (const q of P) { const dx = q[0] - mx, dy = q[1] - my, tt = dx * ux + dy * uy, d = -dx * uy + dy * ux; tmin = Math.min(tmin, tt); tmax = Math.max(tmax, tt); dmax = Math.max(dmax, Math.abs(d)); dsum += d * d; }
  const ext = Math.max(1, tmax - tmin), rms = Math.sqrt(dsum / P.length);
  const straight = chord > 0.55 * L && (rms / ext < 0.022 || dmax < Math.max(0.05 * ext, 2.5));
  if (straight) {
    // endpoints = first/last points projected on the fitted line
    const pr = (q) => { const tt = (q[0] - mx) * ux + (q[1] - my) * uy; return [mx + ux * tt, my + uy * tt]; };
    const a = pr(s), b = pr(e);
    return { k: 'line', pts: snapLine(a[0], a[1], b[0], b[1]), closed: false };
  }
  const closed = chord < Math.max(0.2 * diag, 8);

  if (!closed) {
    // ---- arrow ----
    const S = rdp(P, Math.max(0.035 * L, 2));
    if (S.length >= 3) {
      const tip = S[1], shaft = Math.hypot(tip[0] - S[0][0], tip[1] - S[0][1]);
      const rest = S.slice(2);
      const near = rest.every(q => Math.hypot(q[0] - tip[0], q[1] - tip[1]) < Math.max(0.5 * shaft, 10));
      const back = rest.some(q => angleAt(S[0], tip, q) < 70 && Math.hypot(q[0] - tip[0], q[1] - tip[1]) > Math.max(8, 0.1 * shaft));
      if (shaft > 0.5 * L && near && back) {
        return { k: 'arrow', pts: snapLine(S[0][0], S[0][1], tip[0], tip[1]), closed: false };
      }
    }
    // ---- one bend (U / parabola / gentle arc) → smooth 3-point curve, like Goodnotes ----
    const C = fitCircle(P);
    const bend = dmax / ext;
    let sw = 0;
    if (C) for (let i = 1; i < P.length; i++) { let d = Math.atan2(P[i][1] - C.cy, P[i][0] - C.cx) - Math.atan2(P[i - 1][1] - C.cy, P[i - 1][0] - C.cx); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; sw += d; }
    const oneBend = singleBend(P);
    // a big round arc (half circle or more) that really fits a circle stays a circular arc
    if (C && oneBend && C.err < 0.03 && C.r > 4 && Math.abs(sw) > 2.3 && Math.abs(sw) < 5.6) {
      const a0 = Math.atan2(s[1] - C.cy, s[0] - C.cx), am = a0 + sw / 2, a1 = a0 + sw;
      return { k: 'arc3', closed: false, pts: [C.cx + C.r * Math.cos(a0), C.cy + C.r * Math.sin(a0), C.cx + C.r * Math.cos(am), C.cy + C.r * Math.sin(am), C.cx + C.r * Math.cos(a1), C.cy + C.r * Math.sin(a1)] };
    }
    if (bend < 0.07 && chord > 0.6 * L && flipsLow(P, mx, my, ux, uy, ext)) { const pr = (q) => { const tt = (q[0] - mx) * ux + (q[1] - my) * uy; return [mx + ux * tt, my + uy * tt]; }; const a = pr(s), b = pr(e); return { k: 'line', pts: snapLine(a[0], a[1], b[0], b[1]), closed: false }; }
    if (oneBend) return quadFrom(P);
    // S-shapes etc.: smooth curve through a few points (editable)
    let eps = 0.02 * L, S2 = rdp(P, Math.max(eps, 1.5));
    while (S2.length > 6) { eps *= 1.4; S2 = rdp(P, eps); }
    if (S2.length >= 3) return { k: 'curve', closed: false, pts: S2.flat() };
    return null;
  }

  // ---- closed: compare polygon fit vs ellipse fit ----
  const E = fitEllipse(P);
  const perim = L;
  const loop = P.slice(0, -1);
  let cx = 0, cy = 0; loop.forEach(q => { cx += q[0]; cy += q[1]; }); cx /= loop.length; cy /= loop.length;
  let fi = 0, fd = -1; loop.forEach((q, i) => { const d = Math.hypot(q[0] - cx, q[1] - cy); if (d > fd) { fd = d; fi = i; } });
  const rot = loop.slice(fi).concat(loop.slice(0, fi)); rot.push(rot[0]);
  let V = rdp(rot, Math.max(0.03 * perim, 2.5)); V.pop();
  V = cleanCorners(V, perim);
  const n = V.length;
  let polyErr = Infinity;
  if (n >= 3 && n <= 6) {
    let s = 0; for (const q of loop) { let m = Infinity; for (let i = 0; i < n; i++) { const a = V[i], b = V[(i + 1) % n]; m = Math.min(m, distSeg(q[0], q[1], a[0], a[1], b[0], b[1])); } s += m; }
    polyErr = s / loop.length / diag;
  }
  const ellOK = E.err < 0.1 && E.sweep > 5.2;
  // a true polygon has straight sides: its edge error is much smaller than a circle's bulge
  const polyWins = polyErr < 0.012 && (!ellOK || polyErr < E.err * 0.28);
  if (ellOK && !polyWins) {
    const ratio = Math.min(E.rx, E.ry) / Math.max(E.rx, E.ry);
    if (ratio > 0.86) { const r = (E.rx + E.ry) / 2; return { k: 'ellipse', cx: E.cx, cy: E.cy, rx: r, ry: r, rot: 0 }; }
    let rot = E.rot, rx = E.rx, ry = E.ry;
    let rr = ((rot % Math.PI) + Math.PI) % Math.PI; if (rr > Math.PI / 2) rr -= Math.PI;
    if (Math.abs(rr) < 9 * D2R) rot = 0; else if (Math.abs(Math.abs(rr) - Math.PI / 2) < 9 * D2R) { rot = 0; [rx, ry] = [ry, rx]; }
    return { k: 'ellipse', cx: E.cx, cy: E.cy, rx, ry, rot };
  }
  if (!polyWins && n > 6) return E.err < 0.14 && E.sweep > 5 ? { k: 'ellipse', cx: E.cx, cy: E.cy, rx: E.rx, ry: E.ry, rot: E.rot } : null;
  if (polyErr > 0.03) return null;
  if (n === 3) {
    return { k: 'poly', pts: V.flat(), closed: true };
  }
  if (n === 4) {
    const angs = V.map((c, i) => angleAt(V[(i + 3) % 4], c, V[(i + 1) % 4]));
    if (angs.every(a => Math.abs(a - 90) < 16)) return { k: 'poly', pts: rectFrom(V), closed: true };
    const e = (i) => [V[(i + 1) % 4][0] - V[i][0], V[(i + 1) % 4][1] - V[i][1]];
    const par = (u, v) => { const a = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])); return Math.min(a, Math.PI - a) < 13 * D2R; };
    if (par(e(0), e(2)) && par(e(1), e(3))) {
      let mx = 0, my = 0; V.forEach(q => { mx += q[0]; my += q[1]; }); mx /= 4; my /= 4;
      const a = [((V[1][0] - V[0][0]) + (V[2][0] - V[3][0])) / 2, ((V[1][1] - V[0][1]) + (V[2][1] - V[3][1])) / 2];
      const b = [((V[3][0] - V[0][0]) + (V[2][0] - V[1][0])) / 2, ((V[3][1] - V[0][1]) + (V[2][1] - V[1][1])) / 2];
      // snap the longer pair horizontal if close
      return { k: 'poly', closed: true, pts: [mx - a[0] / 2 - b[0] / 2, my - a[1] / 2 - b[1] / 2, mx + a[0] / 2 - b[0] / 2, my + a[1] / 2 - b[1] / 2, mx + a[0] / 2 + b[0] / 2, my + a[1] / 2 + b[1] / 2, mx - a[0] / 2 + b[0] / 2, my - a[1] / 2 + b[1] / 2] };
    }
    return { k: 'poly', pts: V.flat(), closed: true };
  }
  if (n === 5 || n === 6) return { k: 'poly', pts: regularize(V), closed: true };
  // fallback: loose ellipse if reasonably round
  if (E.err < 0.14 && E.sweep > 5) return { k: 'ellipse', cx: E.cx, cy: E.cy, rx: E.rx, ry: E.ry, rot: E.rot };
  return null;
}

// straight line used for highlighter "auto straight" mode
export function straighten(x0, y0, x1, y1) { return snapLine(x0, y0, x1, y1); }

// handles for editing a shape
export function shapeHandles(sh) {
  if (sh.k === 'ellipse') {
    const c = Math.cos(sh.rot || 0), s = Math.sin(sh.rot || 0);
    return [
      { id: 'rx+', x: sh.cx + sh.rx * c, y: sh.cy + sh.rx * s },
      { id: 'rx-', x: sh.cx - sh.rx * c, y: sh.cy - sh.rx * s },
      { id: 'ry+', x: sh.cx - sh.ry * s, y: sh.cy + sh.ry * c },
      { id: 'ry-', x: sh.cx + sh.ry * s, y: sh.cy - sh.ry * c },
      { id: 'move', x: sh.cx, y: sh.cy },
    ];
  }
  const hs = [];
  for (let i = 0; i < sh.pts.length; i += 2) hs.push({ id: i / 2, x: sh.pts[i], y: sh.pts[i + 1] });
  let cx = 0, cy = 0; const n = sh.pts.length / 2; for (let i = 0; i < sh.pts.length; i += 2) { cx += sh.pts[i]; cy += sh.pts[i + 1]; }
  hs.push({ id: 'move', x: cx / n, y: cy / n });
  return hs;
}
export function moveHandle(orig, id, x, y) {
  const sh = JSON.parse(JSON.stringify(orig));
  if (id === 'move') {
    const hs = shapeHandles(orig), m = hs[hs.length - 1], dx = x - m.x, dy = y - m.y;
    if (sh.k === 'ellipse') { sh.cx += dx; sh.cy += dy; } else for (let i = 0; i < sh.pts.length; i += 2) { sh.pts[i] += dx; sh.pts[i + 1] += dy; }
    return sh;
  }
  if (sh.k === 'ellipse') {
    const c = Math.cos(sh.rot || 0), s = Math.sin(sh.rot || 0), u = (x - sh.cx) * c + (y - sh.cy) * s, v = -(x - sh.cx) * s + (y - sh.cy) * c;
    if (id[1] === 'x') sh.rx = Math.max(2, Math.abs(u)); else sh.ry = Math.max(2, Math.abs(v));
    if (sh.rx === sh.ry) { /* keep circle */ }
    return sh;
  }
  sh.pts[id * 2] = x; sh.pts[id * 2 + 1] = y;
  if (!sh.closed && sh.pts.length === 4) { // keep line snapping while editing
    const o = id === 0 ? 1 : 0; const sn = snapLine(sh.pts[o * 2], sh.pts[o * 2 + 1], x, y); sh.pts[id * 2] = sn[2]; sh.pts[id * 2 + 1] = sn[3];
  }
  return sh;
}

// force a specific open shape (used by the "change to…" chips after hold-to-shape)
export function shapeAs(p, kind) {
  p = trimRest(p);
  const R = resample(p, 96); const P = []; for (let i = 0; i < R.length; i += 2) P.push([R[i], R[i + 1]]);
  if (P.length < 3) return null;
  const s = P[0], e = P[P.length - 1];
  if (kind === 'line') return { k: 'line', pts: snapLine(s[0], s[1], e[0], e[1]), closed: false };
  if (kind === 'arc3') { // circle through start, the point farthest from the chord, and end
    let best = P[1], bd = -1; const L = Math.hypot(e[0] - s[0], e[1] - s[1]) || 1;
    for (const q of P) { const d = Math.abs((e[0] - s[0]) * (s[1] - q[1]) - (s[0] - q[0]) * (e[1] - s[1])) / L; if (d > bd) { bd = d; best = q; } }
    if (bd < 1) return { k: 'line', pts: snapLine(s[0], s[1], e[0], e[1]), closed: false };
    return { k: 'arc3', closed: false, pts: [s[0], s[1], best[0], best[1], e[0], e[1]] };
  }
  if (kind === 'quad') return quadFrom(P);
  if (kind === 'curve') {
    const L = pathLen(p); let eps = 0.012 * L, S2 = rdp(P, Math.max(eps, 1.5));
    while (S2.length > 9) { eps *= 1.4; S2 = rdp(P, eps); }
    if (S2.length < 3) S2 = [s, P[P.length >> 1], e];
    return { k: 'curve', closed: false, pts: S2.flat() };
  }
  return null;
}
