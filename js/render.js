// Stroke + page rendering (Canvas 2D). Coordinates are page points (1/72 in).
import { drawImageObj } from './images.js';
import { pdfBitmap } from './pdfdoc.js';
import { circle3 } from './shapes.js';
export const PAGE = { P: { w: 595.28, h: 841.89 }, L: { w: 841.89, h: 595.28 } };
export const STRIDE = 4;
export const dims = (p) => (p && p.pw) ? { w: p.pw, h: p.ph } : PAGE[(p && p.size) || 'P'];
let pdfMaxBucket = 3; export function setPdfQuality(b) { pdfMaxBucket = b; } // x, y, pressure, tilt(0..1)

export const PAPERS = {
  cream: { fill: '#FFFDF8', line: '#E3DDCF', margin: '#EBB9B9', dark: false, label: 'ครีม' },
  white: { fill: '#FFFFFF', line: '#E2E2E6', margin: '#EDBDBD', dark: false, label: 'ขาว' },
  dark: { fill: '#23262C', line: 'rgba(255,255,255,.10)', margin: 'rgba(255,120,120,.35)', dark: true, label: 'ดำ' },
  board: { fill: '#1E3B34', line: 'rgba(255,255,255,.11)', margin: 'rgba(255,200,120,.35)', dark: true, label: 'กระดานเขียว' },
};

// ---------- color helpers ----------
export function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
export function lum(hex) { const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; }
function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hslToRgb(h, s, l) { const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }; return [f(0), f(8), f(4)]; }
const inkCache = new Map();
// On dark paper, very dark inks are shown light so they stay readable.
export function inkFor(hex, darkPaper) {
  if (!darkPaper) return hex;
  let v = inkCache.get(hex); if (v) return v;
  v = hex;
  if (lum(hex) < 0.18) { const [h, s, l] = rgbToHsl(...hexToRgb(hex)); v = rgbToHex(...hslToRgb(h, Math.min(s, .6), Math.max(.86, 1 - l))); }
  inkCache.set(hex, v); return v;
}

// ---------- path objects (Path2D on screen, SVG strings for PDF export) ----------
export class SvgPath {
  constructor() { this.d = []; this.cx = 0; this.cy = 0; }
  f(n) { return Math.round(n * 100) / 100; }
  moveTo(x, y) { this.d.push('M' + this.f(x) + ' ' + this.f(y)); this.cx = x; this.cy = y; }
  lineTo(x, y) { this.d.push('L' + this.f(x) + ' ' + this.f(y)); this.cx = x; this.cy = y; }
  bezierCurveTo(a, b, c, d, x, y) { const f = this.f.bind(this); this.d.push(`C${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(x)} ${f(y)}`); this.cx = x; this.cy = y; }
  quadraticCurveTo(a, b, x, y) { this.d.push('Q' + this.f(a) + ' ' + this.f(b) + ' ' + this.f(x) + ' ' + this.f(y)); this.cx = x; this.cy = y; }
  closePath() { this.d.push('Z'); }
  arc(x, y, r) { const f = this.f.bind(this); this.d.push(`A${f(r)} ${f(r)} 0 1 1 ${f(x - r)} ${f(y)}A${f(r)} ${f(r)} 0 1 1 ${f(x + r)} ${f(y)}`); }
  ellipse(cx, cy, rx, ry, rot) { const c = Math.cos(rot || 0), s = Math.sin(rot || 0); for (let i = 0; i <= 72; i++) { const t = i / 72 * Math.PI * 2, x = Math.cos(t) * rx, y = Math.sin(t) * ry; const X = cx + x * c - y * s, Y = cy + x * s + y * c; i ? this.lineTo(X, Y) : this.moveTo(X, Y); } this.closePath(); }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  toString() { return this.d.join(''); }
}
let NewPath = () => new Path2D();

// ---------- geometry ----------
function prep(pts, n, smooth = true) {
  // remove near duplicates; light smoothing of interior points
  const xs = [], ys = [], ps = [], ts = [];
  let lx = NaN, ly = NaN;
  for (let i = 0; i < n; i++) {
    const x = pts[i * STRIDE], y = pts[i * STRIDE + 1];
    if (i > 0 && i < n - 1 && Math.abs(x - lx) + Math.abs(y - ly) < 0.12) continue;
    xs.push(x); ys.push(y); ps.push(pts[i * STRIDE + 2]); ts.push(pts[i * STRIDE + 3]); lx = x; ly = y;
  }
  if (smooth && xs.length > 3) {
    const ox = xs.slice(), oy = ys.slice();
    for (let i = 1; i < xs.length - 1; i++) { xs[i] = ox[i - 1] * .25 + ox[i] * .5 + ox[i + 1] * .25; ys[i] = oy[i - 1] * .25 + oy[i] * .5 + oy[i + 1] * .25; }
  }
  return { xs, ys, ps, ts, n: xs.length };
}

function addCircle(path, x, y, r) { path.moveTo(x + r, y); path.arc(x, y, r, 0, Math.PI * 2); }
function addQuad(path, ax, ay, bx, by, cx, cy, dx, dy) {
  const area = (ax * by - bx * ay) + (bx * cy - cx * by) + (cx * dy - dx * cy) + (dx * ay - ax * dy);
  if (area >= 0) { path.moveTo(ax, ay); path.lineTo(bx, by); path.lineTo(cx, cy); path.lineTo(dx, dy); }
  else { path.moveTo(dx, dy); path.lineTo(cx, cy); path.lineTo(bx, by); path.lineTo(ax, ay); }
  path.closePath();
}
// variable-width capsule chain (union filled once -> no alpha overlap)
function capsulePath(g, rs, from = 0, to = g.n) {
  const p = NewPath();
  const { xs, ys } = g;
  for (let i = from; i < to; i++) {
    addCircle(p, xs[i], ys[i], rs[i]);
    if (i + 1 < to) {
      const dx = xs[i + 1] - xs[i], dy = ys[i + 1] - ys[i], L = Math.hypot(dx, dy);
      if (L < 1e-4) continue;
      const nx = -dy / L, ny = dx / L, r0 = rs[i], r1 = rs[i + 1];
      addQuad(p, xs[i] + nx * r0, ys[i] + ny * r0, xs[i + 1] + nx * r1, ys[i + 1] + ny * r1, xs[i + 1] - nx * r1, ys[i + 1] - ny * r1, xs[i] - nx * r0, ys[i] - ny * r0);
    }
  }
  return p;
}
// nib-swept path (calligraphy, marker, highlighter)
function nibPath(g, ang, halfFn, thick) {
  const p = NewPath();
  const { xs, ys, n } = g;
  const cx = Math.cos(ang), cy = Math.sin(ang);
  const tx = -cy, ty = cx; // thickness direction
  for (let i = 0; i < n; i++) {
    const h0 = halfFn(i);
    // nib rectangle at point
    const ax = cx * h0, ay = cy * h0, bx = tx * thick, by = ty * thick;
    addQuad(p, xs[i] + ax + bx, ys[i] + ay + by, xs[i] - ax + bx, ys[i] - ay + by, xs[i] - ax - bx, ys[i] - ay - by, xs[i] + ax - bx, ys[i] + ay - by);
    if (i + 1 < n) {
      const h1 = halfFn(i + 1);
      addQuad(p, xs[i] + cx * h0, ys[i] + cy * h0, xs[i + 1] + cx * h1, ys[i + 1] + cy * h1, xs[i + 1] - cx * h1, ys[i + 1] - cy * h1, xs[i] - cx * h0, ys[i] - cy * h0);
    }
  }
  return p;
}
function smoothLine(g) {
  const p = NewPath();
  const { xs, ys, n } = g;
  if (n === 1) { p.moveTo(xs[0], ys[0]); p.lineTo(xs[0] + 0.01, ys[0]); return p; }
  p.moveTo(xs[0], ys[0]);
  if (n === 2) { p.lineTo(xs[1], ys[1]); return p; }
  for (let i = 1; i < n - 1; i++) p.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
  p.lineTo(xs[n - 1], ys[n - 1]);
  return p;
}

// pencil grain pattern per color
const grain = new Map(); const patCache = new Map();
function grainPattern(ctx, color, k) {
  let c = grain.get(color);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d'); const im = g.createImageData(96, 96); const [r, gg, b] = hexToRgb(color);
    let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 96 * 96; i++) { const v = rnd(); im.data[i * 4] = r; im.data[i * 4 + 1] = gg; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = v < .22 ? 40 : 150 + v * 105; }
    g.putImageData(im, 0, 0); grain.set(color, c);
  }
  const key = color + '@' + k.toFixed(3);
  let pat = patCache.get(key);
  if (!pat || patCache.ctx !== ctx) {
    if (patCache.ctx !== ctx) { patCache.clear(); patCache.ctx = ctx; }
    pat = ctx.createPattern(c, 'repeat');
    try { pat.setTransform(new DOMMatrix().scale(1 / k, 1 / k)); } catch { }
    patCache.set(key, pat); if (patCache.size > 64) patCache.clear();
  }
  return pat;
}

// ---------- shapes ----------
function arcPts(sh, steps) {
  const [x0, y0, xm, ym, x1, y1] = sh.pts, C = circle3([x0, y0], [xm, ym], [x1, y1]);
  if (!C || C.r > 1e5) return [x0, y0, x1, y1];
  const a0 = Math.atan2(y0 - C.cy, x0 - C.cx), am = Math.atan2(ym - C.cy, xm - C.cx), a1 = Math.atan2(y1 - C.cy, x1 - C.cx);
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sw = norm(a1 - a0); if (norm(am - a0) > sw) sw -= 2 * Math.PI; // go through the middle point
  const out = []; for (let i = 0; i <= steps; i++) { const a = a0 + sw * i / steps; out.push(C.cx + C.r * Math.cos(a), C.cy + C.r * Math.sin(a)); }
  return out;
}
function curvePts(sh, per = 10) {
  const p = sh.pts, n = p.length / 2, out = [];
  const P = (i) => [p[Math.max(0, Math.min(n - 1, i)) * 2], p[Math.max(0, Math.min(n - 1, i)) * 2 + 1]];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < per; k++) { const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push(0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)); }
  }
  out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}
export function shapePolyline(sh, steps = 72) {
  if (sh.k === 'arc3') return arcPts(sh, steps);
  if (sh.k === 'curve') return curvePts(sh, Math.max(4, Math.round(steps / 8)));
  if (sh.k === 'ellipse') {
    const out = [], c = Math.cos(sh.rot || 0), s = Math.sin(sh.rot || 0);
    for (let i = 0; i <= steps; i++) { const t = i / steps * Math.PI * 2, x = Math.cos(t) * sh.rx, y = Math.sin(t) * sh.ry; out.push(sh.cx + x * c - y * s, sh.cy + x * s + y * c); }
    return out;
  }
  const out = sh.pts.slice();
  if (sh.closed) out.push(sh.pts[0], sh.pts[1]);
  return out;
}
function arrowHead(sh, w) {
  const n = sh.pts.length, x1 = sh.pts[n - 2], y1 = sh.pts[n - 1], x0 = sh.pts[n - 4], y0 = sh.pts[n - 3];
  const a = Math.atan2(y1 - y0, x1 - x0), L = Math.max(w * 5, 12), sp = 0.48;
  return [x1 - L * Math.cos(a - sp), y1 - L * Math.sin(a - sp), x1, y1, x1 - L * Math.cos(a + sp), y1 - L * Math.sin(a + sp)];
}
function shapePath(sh, w) {
  const p = NewPath();
  if (sh.k === 'ellipse') { p.ellipse(sh.cx, sh.cy, Math.max(.1, sh.rx), Math.max(.1, sh.ry), sh.rot || 0, 0, Math.PI * 2); return p; }
  if (sh.k === 'arc3' || sh.k === 'curve') { const q = sh.k === 'arc3' ? arcPts(sh, 96) : curvePts(sh, 16); p.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) p.lineTo(q[i], q[i + 1]); return p; }
  p.moveTo(sh.pts[0], sh.pts[1]);
  for (let i = 2; i < sh.pts.length; i += 2) p.lineTo(sh.pts[i], sh.pts[i + 1]);
  if (sh.closed) p.closePath();
  if (sh.k === 'arrow') { const hd = arrowHead(sh, w); p.moveTo(hd[0], hd[1]); p.lineTo(hd[2], hd[3]); p.lineTo(hd[4], hd[5]); }
  return p;
}

// vector description of a stroke for PDF export
export function strokeVector(s) {
  const prev = NewPath; NewPath = () => new SvgPath();
  try {
    if (s.shape) return { kind: 'stroke', d: String(shapePath(s.shape, s.w)), w: s.w, dash: s.pen === 'dash' ? [Math.max(s.w * 3, 3), Math.max(s.w * 2.6, 3)] : s.pen === 'dot' ? [0.01, Math.max(s.w * 2.3, 2)] : null, cap: s.t === 'hl' ? 'butt' : 'round' };
    const pen = s.t === 'hl' ? 'hl' : s.pen;
    const G = buildGeom(s, pen, 0.2, true);
    if (pen === 'ball' || pen === 'dash' || pen === 'dot') return { kind: 'stroke', d: String(G.path), w: s.w, dash: pen === 'dash' ? [Math.max(s.w * 3, 2.5), Math.max(s.w * 2.6, 2.5)] : pen === 'dot' ? [0.01, Math.max(s.w * 2.3, 2)] : null, cap: 'round' };
    if (pen === 'pencil' || G.paths) { const a = G.alphas.reduce((x, y) => x + y, 0) / G.alphas.length; return { kind: 'fill', d: G.paths.map(String).join(''), alpha: a }; }
    return { kind: 'fill', d: String(G.path), alpha: pen === 'marker' ? .96 : 1 };
  } finally { NewPath = prev; }
}

// ---------- bounding box ----------
export function strokeBB(s) {
  if (s.bb) return s.bb;
  if (s.t === 'img' || s.t === 'text') { s.bb = [s.x, s.y, s.x + s.w, s.y + s.h]; return s.bb; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const arr = s.shape ? shapePolyline(s.shape, 24) : s.pts, st = s.shape ? 2 : STRIDE;
  for (let i = 0; i < arr.length; i += st) { const x = arr[i], y = arr[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = s.w * (s.pen === 'pencil' ? 2.6 : s.pen === 'brush' ? 1.6 : s.t === 'hl' ? 1 : 1.2) + (s.shape && s.shape.k === 'arrow' ? s.w * 5 + 12 : 0) + 1;
  s.bb = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  return s.bb;
}

export function buildGeom(s, pen, minW, final) {
  const n = s.pts.length / STRIDE | 0;
  const g = prep(s.pts, n, pen !== 'hl');
  const w = s.w;
  switch (pen) {
    case 'ball': case 'dash': case 'dot': return { path: smoothLine(g) };
    case 'fount': return { path: capsulePath(g, g.ps.map(p => Math.max(minW / 2, w / 2 * (0.42 + 1.05 * Math.pow(p, .85))))) };
    case 'brush': {
      const { xs, ys } = g; const d = [0]; for (let i = 1; i < g.n; i++) d[i] = d[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      const tot = d[g.n - 1] || 1, tl = Math.max(w * 3, 6);
      const rs = g.ps.map((p, i) => {
        let tp = Math.min(1, d[i] / tl); if (final) tp = Math.min(tp, (tot - d[i]) / tl);
        tp = Math.max(.12, Math.pow(Math.max(0, tp), .55));
        return Math.max(minW / 2, w / 2 * (0.3 + 1.25 * Math.pow(p, .9)) * tp);
      });
      return { path: capsulePath(g, rs) };
    }
    case 'calli': return { path: nibPath(g, -Math.PI / 4, (i) => w / 2 * (0.6 + 0.55 * g.ps[i]), Math.max(minW / 2, w * 0.07)) };
    case 'marker': return { path: nibPath(g, -Math.PI / 5, () => w / 2, w * 0.2) };
    case 'hl': {
      if (s.hs !== 'brush') return { path: nibPath(g, Math.PI / 2, () => w / 2, w * 0.14) };
      // brush highlighter: flicked tapered ends, width & intensity follow pressure
      const { xs, ys } = g; const d = [0]; for (let i = 1; i < g.n; i++) d[i] = d[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      const tot = d[g.n - 1] || 1, tl = Math.max(w * 2.2, 8);
      const rs = g.ps.map((p, i) => {
        let tp = Math.min(1, d[i] / (tl * 0.6)); if (final) tp = Math.min(tp, (tot - d[i]) / tl);
        tp = Math.max(.08, Math.pow(Math.max(0, tp), .6));
        return Math.max(minW / 2, w / 2 * (0.5 + 0.7 * Math.pow(p, .8)) * tp);
      });
      const CH = 4, paths = [], alphas = [];
      for (let i = 0; i < g.n; i += CH - 1) {
        const to = Math.min(g.n, i + CH);
        let ap = 0; for (let j = i; j < to; j++) ap += g.ps[j]; ap /= (to - i);
        alphas.push(Math.min(1.6, 0.55 + 0.9 * Math.pow(ap, .9)));
        paths.push(capsulePath(g, rs, i, to));
        if (to >= g.n) break;
      }
      return { paths, alphas };
    }
    case 'pencil': {
      const rs = g.ps.map((p, i) => Math.max(minW / 2, w / 2 * (0.75 + 0.5 * p) * (1 + g.ts[i] * 1.6)));
      const CH = 10, paths = [], alphas = [];
      for (let i = 0; i < g.n; i += CH - 1) {
        const to = Math.min(g.n, i + CH);
        let ap = 0; for (let j = i; j < to; j++) ap += g.ps[j]; ap /= (to - i);
        alphas.push((0.32 + 0.66 * Math.pow(ap, .8)) * (1 - 0.35 * g.ts[i]));
        paths.push(capsulePath(g, rs, i, to));
        if (to >= g.n) break;
      }
      return { paths, alphas };
    }
  }
  return { path: smoothLine(g) };
}

// ---------- draw one stroke ----------
// ctx is in page coordinates. k = device pixels per page point. final: stroke finished (for tapers)
export function drawStroke(ctx, s, k, darkPaper, final = true) {
  if (s.t === 'img') { drawImageObj(ctx, s); return; }
  if (s.t === 'text') { drawText(ctx, s, darkPaper); return; }
  const color = s.t === 'hl' ? s.c : inkFor(s.c, darkPaper);
  const minW = 0.8 / k;
  ctx.save();
  ctx.globalAlpha = s.a ?? 1;
  if (s.t === 'hl') { ctx.globalAlpha = s.a ?? .4; if (!darkPaper) ctx.globalCompositeOperation = 'multiply'; }
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.shape) {
    ctx.lineWidth = Math.max(minW, s.w);
    if (s.t === 'hl') { ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; }
    if (s.pen === 'dash') ctx.setLineDash([Math.max(s.w * 3, 3), Math.max(s.w * 2.6, 3)]);
    else if (s.pen === 'dot') ctx.setLineDash([0.001, Math.max(s.w * 2.3, 2)]);
    ctx.stroke(shapePath(s.shape, s.w));
    ctx.restore(); return;
  }
  const n = s.pts.length / STRIDE | 0;
  if (!n) { ctx.restore(); return; }
  const pen = s.t === 'hl' ? 'hl' : s.pen;
  const cacheable = final && s.id !== 'live';
  let G = cacheable ? s._g : null;
  if (!G) { G = buildGeom(s, pen, minW, final); if (cacheable) Object.defineProperty(s, '_g', { value: G, writable: true, configurable: true, enumerable: false }); }
  const w = s.w;
  switch (pen) {
    case 'ball': case 'dash': case 'dot':
      ctx.lineWidth = Math.max(minW, w);
      if (pen === 'dash') ctx.setLineDash([Math.max(w * 3, 2.5), Math.max(w * 2.6, 2.5)]);
      if (pen === 'dot') ctx.setLineDash([0.001, Math.max(w * 2.3, 2)]);
      ctx.stroke(G.path); break;
    case 'marker': ctx.globalAlpha = (s.a ?? 1) * .96; ctx.fill(G.path); break;
    case 'hl':
      if (G.paths) drawBrushHl(ctx, s, G, color, darkPaper);
      else ctx.fill(G.path);
      break;
    case 'pencil':
      ctx.fillStyle = grainPattern(ctx, color, k);
      for (let i = 0; i < G.paths.length; i++) { ctx.globalAlpha = (s.a ?? 1) * G.alphas[i]; ctx.fill(G.paths[i]); }
      break;
    default: ctx.fill(G.path);
  }
  ctx.restore();
}


// brush highlighter: chunks with different intensity, drawn "last wins" on a scratch layer so joints don't darken
let scratch = null;
function drawBrushHl(ctx, s, G, color, darkPaper) {
  const m = ctx.getTransform(), b = strokeBB(s), cw = ctx.canvas.width, ch = ctx.canvas.height;
  const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  let x0 = Math.floor(Math.max(0, Math.min(...pts.map(p => p[0])))), y0 = Math.floor(Math.max(0, Math.min(...pts.map(p => p[1]))));
  let x1 = Math.ceil(Math.min(cw, Math.max(...pts.map(p => p[0])))), y1 = Math.ceil(Math.min(ch, Math.max(...pts.map(p => p[1]))));
  const w = x1 - x0, hh = y1 - y0; if (w <= 0 || hh <= 0) return;
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width < w || scratch.height < hh) { scratch.width = Math.max(scratch.width, w); scratch.height = Math.max(scratch.height, hh); }
  const g = scratch.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, hh);
  g.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
  g.fillStyle = color;
  const base = s.a ?? .4;
  for (let i = 0; i < G.paths.length; i++) {
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1; g.fill(G.paths[i]);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, base * G.alphas[i]); g.fill(G.paths[i]);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = darkPaper ? 'source-over' : 'multiply';
  ctx.drawImage(scratch, 0, 0, w, hh, x0, y0, w, hh);
  ctx.restore();
}

// ---------- text boxes ----------
export const TEXT_LH = 1.32;
export function textFont(s) { return `${s.bold ? '700 ' : ''}${s.size}px "TH Sarabun New", sans-serif`; }
export function measureText(s) {
  const c = measureText.c || (measureText.c = document.createElement('canvas').getContext('2d'));
  c.font = textFont(s);
  const lines = String(s.text || '').split('\n');
  let w = 0; for (const l of lines) w = Math.max(w, c.measureText(l).width);
  return { w: Math.max(w, s.size * 0.6) + s.size * 0.2, h: lines.length * s.size * TEXT_LH + s.size * 0.25 };
}
function drawText(ctx, s, dark) {
  ctx.save();
  ctx.font = textFont(s); ctx.fillStyle = inkFor(s.c || '#1E2A55', dark); ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = s.a ?? 1;
  const lines = String(s.text || '').split('\n');
  lines.forEach((l, i) => ctx.fillText(l, s.x + s.size * 0.1, s.y + s.size * (0.98 + i * TEXT_LH)));
  ctx.restore();
}

// ---------- page background ----------
export function drawPaper(ctx, page, paperKey, k) {
  const P = dims(page), pp = PAPERS[paperKey] || PAPERS.cream;
  if (page.pdf) {
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, P.w, P.h);
    const bm = pdfBitmap(page, k, pdfMaxBucket);
    if (bm) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bm, 0, 0, P.w, P.h); }
    else { ctx.fillStyle = '#9AA0AA'; ctx.font = `${18}px "TH Sarabun New", sans-serif`; ctx.textAlign = 'center'; ctx.fillText('กำลังโหลดหน้า PDF…', P.w / 2, P.h / 2); }
    return;
  }
  ctx.fillStyle = pp.fill; ctx.fillRect(0, 0, P.w, P.h);
  const lw = Math.max(0.35, 1 / k);
  ctx.save();
  ctx.strokeStyle = pp.line; ctx.lineWidth = lw;
  if (page.bg === 'grid') {
    const sp = 19.84; // 7 mm
    ctx.beginPath();
    for (let x = sp; x < P.w; x += sp) { ctx.moveTo(x, 0); ctx.lineTo(x, P.h); }
    for (let y = sp; y < P.h; y += sp) { ctx.moveTo(0, y); ctx.lineTo(P.w, y); }
    ctx.stroke();
  } else if (page.bg === 'lines') {
    const sp = 24.09; // 8.5 mm
    ctx.beginPath();
    for (let y = 72; y < P.h - 20; y += sp) { ctx.moveTo(0, y); ctx.lineTo(P.w, y); }
    ctx.stroke();
    ctx.strokeStyle = pp.margin; ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(64, P.h); ctx.stroke();
  } else if (page.bg === 'dots') {
    const sp = 19.84; ctx.fillStyle = pp.line;
    const r = Math.max(0.7, 1.2 / Math.sqrt(k)) * (pp.dark ? 1 : 1.05);
    ctx.beginPath();
    for (let x = sp; x < P.w; x += sp) for (let y = sp; y < P.h; y += sp) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.globalAlpha = pp.dark ? 1 : 1; ctx.fillStyle = pp.dark ? 'rgba(255,255,255,.22)' : '#CFC8B8'; ctx.fill();
  }
  ctx.restore();
}

// strokes of a page within an optional clip rect [x0,y0,x1,y1] (page coords)
export function drawStrokes(ctx, page, k, darkPaper, clip) {
  const st = page.strokes;
  // images first, then highlighters, then ink on top
  for (let pass = 0; pass < 3; pass++) {
    for (const s of st) {
      const layer = s.t === 'img' ? 0 : s.t === 'hl' ? 1 : 2;
      if (layer !== pass) continue;
      if (clip) { const b = strokeBB(s); if (b[2] < clip[0] || b[0] > clip[2] || b[3] < clip[1] || b[1] > clip[3]) continue; }
      drawStroke(ctx, s, k, darkPaper, true);
    }
  }
}

export function renderPageTo(canvas, page, paperKey, widthPx) {
  const P = dims(page);
  const k = widthPx / P.w;
  canvas.width = Math.round(widthPx); canvas.height = Math.round(P.h * k);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawPaper(ctx, page, paperKey, k);
  drawStrokes(ctx, page, k, !!PAPERS[paperKey]?.dark);
  return canvas;
}

// preview of a pen type (for UI)
export function penSample(canvas, pen, t, color, w, cssW, cssH, hs) {
  const dpr = Math.min(3, devicePixelRatio || 1);
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const N = 60, pts = new Float32Array(N * STRIDE);
  const ww = Math.min(w, cssH * 0.35);
  for (let i = 0; i < N; i++) {
    const tt = i / (N - 1), x = 8 + (cssW - 16) * tt;
    const y = t === 'hl' && hs !== 'brush' ? cssH / 2 : cssH / 2 + cssH * (t === 'hl' ? 0.12 : 0.26) * Math.sin(tt * Math.PI * 2.1 - 0.5);
    pts[i * 4] = x; pts[i * 4 + 1] = y; pts[i * 4 + 2] = 0.25 + 0.7 * Math.sin(Math.PI * tt); pts[i * 4 + 3] = 0.1;
  }
  drawStroke(ctx, { t, pen, hs, c: color, a: t === 'hl' ? .45 : 1, w: Math.max(0.6, ww), pts }, dpr, false, true);
}

export function drawLaserTrail(ctx, pts, headOn) {
  if (!pts.length) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i], a = Math.max(0, p1.a);
    ctx.strokeStyle = `rgba(255,59,48,${a * 0.35})`; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.strokeStyle = `rgba(255,90,80,${a})`; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
  const h0 = pts[pts.length - 1];
  if (headOn || h0.a > 0.6) {
    const g = ctx.createRadialGradient(h0.x, h0.y, 0, h0.x, h0.y, 18); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,59,48,1)'); g.addColorStop(1, 'rgba(255,59,48,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h0.x, h0.y, 18, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
