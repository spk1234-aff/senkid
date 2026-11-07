// Images on pages: loading, bitmap cache, drawing (with crop + mask), crop/cut dialog
import { h, icon, dialog, toast, seg } from './ui.js';

const MAX_SIDE = 2400;
const cache = new WeakMap(); // blob -> ImageBitmap | HTMLImageElement | Promise
let readyHook = null;
export function setImageReadyHook(fn) { readyHook = fn; }

// never wait forever on a picture that will not decode
function loadEl(blob, ms = 30000) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(blob); const im = new Image(); const to = setTimeout(() => { im.src = ''; rej(new Error('timeout')); }, ms); im.onload = () => { clearTimeout(to); res(im); }; im.onerror = (e) => { clearTimeout(to); rej(e); }; im.src = u; });
}
async function decode(blob) {
  try { if (window.createImageBitmap) return await createImageBitmap(blob); } catch { }
  return loadEl(blob);
}
export function bitmapOf(blob) {
  const v = cache.get(blob);
  if (v && !(v instanceof Promise)) return v;
  if (!v) {
    const p = decode(blob).then(bm => { cache.set(blob, bm); readyHook && readyHook(); return bm; }).catch(() => { cache.delete(blob); });
    cache.set(blob, p);
  }
  return null;
}
export async function bitmapAsync(blob) { const b = bitmapOf(blob); return b || (await cache.get(blob)) || decode(blob); }

// Read a picked/pasted file: fix size, keep transparency for PNG/WebP/GIF
export async function normalizeImage(file) {
  // big phone photos: decode straight to the target size (much faster and lighter than full 12 MP)
  let bm = null;
  try {
    const im = await loadEl(file); const nw = im.naturalWidth, nh = im.naturalHeight, k = Math.min(1, MAX_SIDE / Math.max(nw, nh));
    if (k < 1 && window.createImageBitmap) { bm = await createImageBitmap(im, { resizeWidth: Math.round(nw * k), resizeHeight: Math.round(nh * k), resizeQuality: 'high' }); if (bm.width !== Math.round(nw * k)) { bm.close?.(); bm = null; } }
    if (!bm) { await im.decode?.().catch(() => { }); bm = im; } else URL.revokeObjectURL(im.src);
  } catch { bm = await decode(file); }
  const iw0 = bm.naturalWidth || bm.width, ih0 = bm.naturalHeight || bm.height;
  const big = Math.max(iw0, ih0) > MAX_SIDE;
  const iw = iw0, ih = ih0, sc = big ? MAX_SIDE / Math.max(iw, ih) : 1;
  const w = Math.max(1, Math.round(iw * sc)), hh = Math.max(1, Math.round(ih * sc));
  const keepAlpha = /png|webp|gif/.test(file.type || '');
  if (sc === 1 && (file.type === 'image/jpeg' || keepAlpha) && file.size < 6e6) {
    const blob = file instanceof Blob ? file.slice(0, file.size, file.type) : file;
    cache.set(blob, bm); return { blob, iw, ih };
  }
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const g = c.getContext('2d'); g.drawImage(bm, 0, 0, w, hh);
  const blob = await new Promise(r => c.toBlob(r, keepAlpha ? 'image/png' : 'image/jpeg', 0.9));
  return { blob, iw: w, ih: hh };
}

export async function rotateBlob(img) {
  // rotate the source 90° clockwise; transform crop & mask accordingly
  const bm = await bitmapAsync(img.blob);
  const c = document.createElement('canvas'); c.width = img.ih; c.height = img.iw;
  const g = c.getContext('2d'); g.translate(img.ih, 0); g.rotate(Math.PI / 2); g.drawImage(bm, 0, 0);
  const png = img.blob.type === 'image/png';
  const blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.92));
  const cr = img.crop;
  const crop = { x: 1 - (cr.y + cr.h), y: cr.x, w: cr.h, h: cr.w };
  let mask = img.mask;
  if (mask && mask.k === 'poly') { const pts = []; for (let i = 0; i < mask.pts.length; i += 2) pts.push(1 - mask.pts[i + 1], mask.pts[i]); mask = { k: 'poly', pts }; }
  return { ...img, blob, iw: img.ih, ih: img.iw, crop, mask, w: img.h, h: img.w, x: img.x + (img.w - img.h) / 2, y: img.y + (img.h - img.w) / 2, bb: null };
}

// draw an image object (page coordinates)
export function drawImageObj(ctx, s) {
  const bm = bitmapOf(s.blob);
  const cr = s.crop || { x: 0, y: 0, w: 1, h: 1 };
  ctx.save();
  if (!bm) { ctx.fillStyle = 'rgba(120,120,120,.12)'; ctx.fillRect(s.x, s.y, s.w, s.h); ctx.restore(); return; }
  const sx = s.w / (cr.w * s.iw), sy = s.h / (cr.h * s.ih);
  ctx.translate(s.x, s.y); ctx.scale(sx, sy); ctx.translate(-cr.x * s.iw, -cr.y * s.ih);
  ctx.beginPath(); ctx.rect(cr.x * s.iw, cr.y * s.ih, cr.w * s.iw, cr.h * s.ih); ctx.clip();
  if (s.mask) {
    ctx.beginPath();
    if (s.mask.k === 'ellipse') ctx.ellipse((cr.x + cr.w / 2) * s.iw, (cr.y + cr.h / 2) * s.ih, cr.w * s.iw / 2, cr.h * s.ih / 2, 0, 0, Math.PI * 2);
    else if (s.mask.k === 'round') { const r = Math.min(cr.w * s.iw, cr.h * s.ih) * 0.12; rr(ctx, cr.x * s.iw, cr.y * s.ih, cr.w * s.iw, cr.h * s.ih, r); }
    else { const p = s.mask.pts; ctx.moveTo(p[0] * s.iw, p[1] * s.ih); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * s.iw, p[i + 1] * s.ih); ctx.closePath(); }
    ctx.clip();
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bm, 0, 0, s.iw, s.ih);
  ctx.restore();
}
function rr(ctx, x, y, w, hh, r) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ---------- crop / cut dialog ----------
// returns Promise<{crop, mask} | null>
export function openCropper(img, { title = 'ครอปหรือตัดรูป', okLabel = 'ใช้รูปนี้' } = {}) {
  return new Promise(async (resolve) => {
    const bm = await bitmapAsync(img.blob);
    const maxW = Math.min(innerWidth - 80, 900), maxH = Math.min(innerHeight - 330, 640);
    const sc = Math.min(maxW / img.iw, maxH / img.ih);
    const W = Math.round(img.iw * sc), H = Math.round(img.ih * sc);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cv = h('canvas', { width: W * dpr, height: H * dpr, style: { width: W + 'px', height: H + 'px', display: 'block', touchAction: 'none', borderRadius: '6px' } });
    const g = cv.getContext('2d');
    let mode = img.mask ? (img.mask.k === 'poly' ? 'free' : img.mask.k) : 'rect';
    let crop = { ...(img.crop || { x: 0, y: 0, w: 1, h: 1 }) };
    let poly = img.mask && img.mask.k === 'poly' ? img.mask.pts.slice() : null;
    let drawing = null, drag = null;
    const hint = h('div', { style: { fontSize: '19px', color: 'var(--muted)', minHeight: '26px', marginTop: '8px' } });
    const setHint = () => hint.textContent = mode === 'free' ? (poly ? 'วาดใหม่ได้ถ้าต้องการ · ส่วนนอกเส้นจะถูกตัดออก' : 'ใช้ปากกาหรือนิ้ววาดรอบส่วนที่ต้องการเก็บไว้') : 'ลากมุมหรือขอบกรอบเพื่อครอป ลากตรงกลางเพื่อย้ายกรอบ';
    function draw() {
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      g.drawImage(bm, 0, 0, W, H);
      g.fillStyle = 'rgba(15,17,22,.6)';
      g.beginPath(); g.rect(0, 0, W, H);
      if (mode === 'free') {
        const p = drawing || poly;
        if (p && p.length >= 6) { g.moveTo(p[0] * W, p[1] * H); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] * W, p[i + 1] * H); g.closePath(); }
        g.fill('evenodd');
        if (p && p.length >= 4) { g.beginPath(); g.moveTo(p[0] * W, p[1] * H); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] * W, p[i + 1] * H); if (!drawing) g.closePath(); g.setLineDash([7, 5]); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke(); g.setLineDash([]); }
        return;
      }
      const x = crop.x * W, y = crop.y * H, w = crop.w * W, hh = crop.h * H;
      if (mode === 'ellipse') g.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
      else if (mode === 'round') rr(g, x, y, w, hh, Math.min(w, hh) * .12);
      else g.rect(x, y, w, hh);
      g.fill('evenodd');
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x, y, w, hh);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath();
      for (let i = 1; i < 3; i++) { g.moveTo(x + w * i / 3, y); g.lineTo(x + w * i / 3, y + hh); g.moveTo(x, y + hh * i / 3); g.lineTo(x + w, y + hh * i / 3); }
      g.stroke();
      g.fillStyle = '#fff';
      for (const [hx, hy] of [[x, y], [x + w, y], [x, y + hh], [x + w, y + hh]]) { g.beginPath(); g.arc(hx, hy, 9, 0, Math.PI * 2); g.fill(); }
      g.lineWidth = 5; g.strokeStyle = '#fff'; g.beginPath();
      for (const [hx, hy, dx, dy] of [[x + w / 2, y, 1, 0], [x + w / 2, y + hh, 1, 0], [x, y + hh / 2, 0, 1], [x + w, y + hh / 2, 0, 1]]) { g.moveTo(hx - dx * 14, hy - dy * 14); g.lineTo(hx + dx * 14, hy + dy * 14); }
      g.stroke();
    }
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); e.preventDefault();
      const [u, v] = pos(e);
      if (mode === 'free') { drawing = [u, v]; draw(); return; }
      const tol = 22 / W, tolv = 22 / H, c = crop;
      const nearL = Math.abs(u - c.x) < tol, nearR = Math.abs(u - (c.x + c.w)) < tol, nearT = Math.abs(v - c.y) < tolv, nearB = Math.abs(v - (c.y + c.h)) < tolv;
      const inX = u > c.x - tol && u < c.x + c.w + tol, inY = v > c.y - tolv && v < c.y + c.h + tolv;
      const edges = { l: nearL && inY, r: nearR && inY, t: nearT && inX, b: nearB && inX };
      if (edges.l || edges.r || edges.t || edges.b) drag = { edges, u, v, c0: { ...c } };
      else if (u > c.x && u < c.x + c.w && v > c.y && v < c.y + c.h) drag = { move: true, u, v, c0: { ...c } };
      else drag = { fresh: true, u, v };
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cv.hasPointerCapture(e.pointerId)) return;
      const [u, v] = pos(e);
      if (mode === 'free' && drawing) { const n = drawing.length; if (Math.hypot((u - drawing[n - 2]) * W, (v - drawing[n - 1]) * H) > 3) drawing.push(u, v); draw(); return; }
      if (!drag) return;
      const m = 0.03;
      if (drag.fresh) { crop = { x: Math.min(u, drag.u), y: Math.min(v, drag.v), w: Math.max(m, Math.abs(u - drag.u)), h: Math.max(m, Math.abs(v - drag.v)) }; }
      else if (drag.move) { const c0 = drag.c0; crop.x = Math.max(0, Math.min(1 - c0.w, c0.x + u - drag.u)); crop.y = Math.max(0, Math.min(1 - c0.h, c0.y + v - drag.v)); }
      else {
        const c0 = drag.c0, E = drag.edges; let x0 = c0.x, y0 = c0.y, x1 = c0.x + c0.w, y1 = c0.y + c0.h;
        if (E.l) x0 = Math.min(u, x1 - m); if (E.r) x1 = Math.max(u, x0 + m); if (E.t) y0 = Math.min(v, y1 - m); if (E.b) y1 = Math.max(v, y0 + m);
        if (mode === 'ellipse' && circleLock && (E.l || E.r) && (E.t || E.b)) { const s = Math.max((x1 - x0) * W, (y1 - y0) * H); if (E.r) x1 = x0 + s / W; else x0 = x1 - s / W; if (E.b) y1 = y0 + s / H; else y0 = y1 - s / H; }
        crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      draw();
    });
    const end = () => {
      if (mode === 'free' && drawing) {
        if (drawing.length >= 12) { poly = drawing; } drawing = null;
        if (poly) { let a = 1, b = 1, c = 0, d = 0; for (let i = 0; i < poly.length; i += 2) { a = Math.min(a, poly[i]); c = Math.max(c, poly[i]); b = Math.min(b, poly[i + 1]); d = Math.max(d, poly[i + 1]); } crop = { x: a, y: b, w: Math.max(.01, c - a), h: Math.max(.01, d - b) }; }
        setHint(); draw();
      }
      drag = null;
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    let circleLock = false;
    const modes = seg([['rect', 'สี่เหลี่ยม'], ['round', 'มุมมน'], ['ellipse', 'วงกลม/วงรี'], ['free', 'ตัดตามเส้นที่วาด']], mode, (v) => {
      mode = v; if (v !== 'free') { poly = null; if (crop.w > .98 && crop.h > .98) crop = { x: .1, y: .1, w: .8, h: .8 }; }
      if (v === 'ellipse') { const s = Math.min(crop.w * W, crop.h * H); crop.w = s / W; crop.h = s / H; circleLock = true; } else circleLock = false;
      setHint(); draw();
    });
    const reset = h('button', { class: 'pill ghost' }, 'รีเซ็ต');
    reset.onclick = () => { crop = { x: 0, y: 0, w: 1, h: 1 }; poly = null; draw(); };
    const body = h('div', {}, modes, h('div', { style: { display: 'flex', justifyContent: 'center', marginTop: '12px', background: 'repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px', borderRadius: '8px', padding: '6px' } }, cv), h('div', { style: { display: 'flex', alignItems: 'center' } }, hint, h('div', { style: { flex: 1 } }), reset));
    let result = null;
    dialog(title, body, [
      { label: 'ยกเลิก' },
      { label: okLabel, cls: 'prim', flex: 2, action: () => {
        if (mode === 'free' && !poly) { toast('วาดรอบส่วนที่ต้องการก่อน หรือเลือกแบบสี่เหลี่ยม'); return false; }
        result = { crop: { ...crop }, mask: mode === 'free' ? { k: 'poly', pts: poly } : mode === 'rect' ? null : { k: mode } };
      } },
    ], { width: Math.max(560, W + 60), onClose: () => resolve(result) });
    setHint(); draw();
  });
}

export async function blobToDataURL(b) { return new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); }
export async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
