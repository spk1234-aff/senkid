// PDF backgrounds: offline pdf.js, documents loaded once, only visible pages rendered (LRU cache)
import * as db from './db.js';

let libP = null;
export function pdfjs() {
  if (!libP) libP = import('../vendor/pdfjs/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href; return m; });
  return libP;
}
const base = new URL('../vendor/pdfjs/', import.meta.url).href;
const docs = new Map(); // pdfId -> Promise<PDFDocumentProxy>
// Safari has no canvas `filter`, which pdf.js uses for soft masks → masked areas came out black.
// Detect that and convert the mask to alpha by hand (luminosity or alpha + optional transfer map).
(function canvasFilterFallback() {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d');
    x.filter = 'invert(1)'; x.fillStyle = '#fff'; x.fillRect(0, 0, 1, 1);
    const works = x.getImageData(0, 0, 1, 1).data[0] < 128;
    if (works) return;
  } catch { }
  globalThis.__senkidNoFilter = true;
  globalThis.__senkidMask = (src, sx, sy, w, h, type, map) => {
    const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
    const x = c.getContext('2d'); x.drawImage(src, sx, sy, w, h, 0, 0, w, h);
    const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
    const tf = map && map.length >= 256 ? map : null;
    for (let i = 0; i < d.length; i += 4) {
      let a = type === 'Luminosity' ? Math.round(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) : d[i + 3];
      if (tf) a = tf[a];
      d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = a;
    }
    x.putImageData(im, 0, 0); return c;
  };
})();

export async function openPdfData(data) {
  const lib = await pdfjs();
  return lib.getDocument({ data, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', isEvalSupported: false, disableAutoFetch: true,
    // iPad Safari: OffscreenCanvas / ImageDecoder paths can paint soft-masked or transparent parts black
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false }).promise;
}
export function getDoc(pdfId) {
  let p = docs.get(pdfId);
  if (!p) {
    p = db.get('pdfs', pdfId).then(async (rec) => { if (!rec) throw new Error('missing pdf'); return openPdfData(new Uint8Array(await rec.blob.arrayBuffer())); });
    p.catch(() => docs.delete(pdfId));
    docs.set(pdfId, p);
  }
  return p;
}

// store a PDF file and return its page list [{w,h}] in points
export async function importPdf(file, onProgress) {
  onProgress && onProgress(0, 0, 'read');
  const buf = new Uint8Array(await file.arrayBuffer());
  onProgress && onProgress(0, 0, 'open');
  const doc = await openPdfData(buf.slice());
  const n = doc.numPages, sizes = [];
  for (let i = 1; i <= n; i++) {
    const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1 });
    sizes.push({ w: vp.width, h: vp.height }); pg.cleanup();
    if (onProgress && (i % 10 === 0 || i === n)) onProgress(i, n);
  }
  const id = 'pdf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  onProgress && onProgress(n, n, 'store');
  await db.put('pdfs', { id, name: file.name || 'เอกสาร.pdf', blob: new Blob([buf], { type: 'application/pdf' }), pages: n, created: Date.now() });
  docs.set(id, Promise.resolve(doc));
  return { id, sizes, name: (file.name || 'เอกสาร').replace(/\.pdf$/i, '') };
}

// ---- bitmap cache ----
const BUCKETS = [0.6, 1, 1.5, 2, 3, 4];
const cache = new Map(); // key -> {c, px, used}
let budget = 90e6; // pixels
let readyHook = null;
export function setPdfReadyHook(fn) { readyHook = fn; }
export function setPdfBudget(px) { budget = px; }
const queue = []; let busy = false;
const pending = new Set();
function key(id, n, b) { return id + '#' + n + '@' + b; }

export function pdfBitmap(page, scale, maxBucket = 3) {
  const ref = page.pdf; if (!ref) return null;
  const want = BUCKETS.find(b => b >= scale * 0.92) || BUCKETS[BUCKETS.length - 1];
  const b = Math.min(want, maxBucket);
  const k = key(ref.id, ref.n, b);
  const hit = cache.get(k);
  if (hit) { hit.used = performance.now(); return hit.c; }
  if (!pending.has(k)) { pending.add(k); queue.push({ k, ref, b }); pump(); }
  // fall back to the best bitmap we already have
  let best = null, bs = 0;
  for (const bb of BUCKETS) { const e = cache.get(key(ref.id, ref.n, bb)); if (e && bb > bs) { best = e.c; bs = bb; } }
  return best;
}
async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const job = queue.pop(); // newest first: what the user looks at now
    try {
      const doc = await getDoc(job.ref.id);
      const pg = await doc.getPage(job.ref.n);
      const vp = pg.getViewport({ scale: job.b });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      pg.cleanup();
      cache.set(job.k, { c, px: c.width * c.height, used: performance.now() });
      evict();
      readyHook && readyHook();
    } catch (e) { console.warn('pdf render', e); }
    pending.delete(job.k);
    if (queue.length > 24) queue.splice(0, queue.length - 24);
  }
  busy = false;
}
function evict() {
  let tot = 0; for (const e of cache.values()) tot += e.px;
  if (tot <= budget) return;
  const arr = [...cache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (const [k, e] of arr) { if (tot <= budget * 0.8) break; cache.delete(k); e.c.width = e.c.height = 0; tot -= e.px; }
}

// raw bytes for export
export async function pdfBytes(pdfId) { const rec = await db.get('pdfs', pdfId); return rec ? new Uint8Array(await rec.blob.arrayBuffer()) : null; }
