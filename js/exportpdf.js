// Export pages to PDF with vector ink (pdf-lib, offline). PDF-backed pages keep their original vector content.
import { h, icon, toast, dialog, seg, toggle, downloadBlob, busy } from './ui.js';
import { dims, PAPERS, strokeVector, drawStroke, strokeBB, inkFor, hexToRgb, renderPageTo } from './render.js';
import { pdfBytes } from './pdfdoc.js';

let libP = null;
const lib = () => (libP ||= import('../vendor/pdf-lib.esm.min.js'));

// "1-5, 8, 10-12" -> [0,1,2,3,4,7,9,10,11] (0-based, unique, ordered)
export function parseRanges(str, n) {
  const out = new Set();
  for (const part of String(str).replace(/[–—]/g, '-').split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) return null;
    let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a];
    if (a < 1 || b > n) return null;
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

const rgb = (hex, L) => { const [r, g, b] = hexToRgb(hex); return L.rgb(r / 255, g / 255, b / 255); };

async function rasterize(s) {
  const b = strokeBB(s), w = b[2] - b[0], hh = b[3] - b[1];
  let k = 3;
  if (s.t === 'img') k = Math.min(4, Math.max(1.5, (s.iw * (s.crop?.w || 1)) / Math.max(1, s.w)));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(hh * k));
  const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, -b[0] * k, -b[1] * k);
  if (s.t === 'img') { const { bitmapAsync } = await import('./images.js'); await bitmapAsync(s.blob); }
  drawStroke(ctx, s, k, false, true);
  const png = await new Promise(r => c.toBlob(r, 'image/png'));
  return { bytes: new Uint8Array(await png.arrayBuffer()), x: b[0], y: b[1], w, h: hh };
}

function drawPaperVector(L, pg, page, paperKey, W, H) {
  const pp = PAPERS[paperKey] || PAPERS.cream;
  const fill = pp.dark ? pp.fill : pp.fill;
  pg.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(fill, L) });
  const line = pp.dark ? L.rgb(1, 1, 1) : rgb('#D9D2C2', L), op = pp.dark ? .12 : 1, lw = 0.5;
  if (page.bg === 'grid') {
    const sp = 19.84;
    for (let x = sp; x < W; x += sp) pg.drawLine({ start: { x, y: 0 }, end: { x, y: H }, thickness: lw, color: line, opacity: op });
    for (let y = sp; y < H; y += sp) pg.drawLine({ start: { x: 0, y: H - y }, end: { x: W, y: H - y }, thickness: lw, color: line, opacity: op });
  } else if (page.bg === 'lines') {
    for (let y = 72; y < H - 20; y += 24.09) pg.drawLine({ start: { x: 0, y: H - y }, end: { x: W, y: H - y }, thickness: lw, color: line, opacity: op });
    pg.drawLine({ start: { x: 64, y: 0 }, end: { x: 64, y: H }, thickness: lw, color: rgb('#E8A9A9', L), opacity: op });
  } else if (page.bg === 'dots') {
    const sp = 19.84;
    for (let x = sp; x < W; x += sp) for (let y = sp; y < H; y += sp) pg.drawCircle({ x, y: H - y, size: 0.9, color: line, opacity: op });
  }
}

export async function exportPdf(pages, paperKey, { withBg = true, onProgress } = {}) {
  const L = await lib();
  const out = await L.PDFDocument.create();
  out.setCreator('เส้นคิด'); out.setProducer('Senkid');
  const srcDocs = new Map();
  const dark = !!PAPERS[paperKey]?.dark && withBg;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i], D = dims(page);
    let pg, ox = 0, oy = 0, sc = 1, H;
    if (page.pdf) {
      let src = srcDocs.get(page.pdf.id);
      if (!src) { const bytes = await pdfBytes(page.pdf.id); src = bytes ? await L.PDFDocument.load(bytes, { ignoreEncryption: true }) : null; srcDocs.set(page.pdf.id, src); }
      if (src) {
        [pg] = await out.copyPages(src, [page.pdf.n - 1]); out.addPage(pg);
        const box = pg.getCropBox(); ox = box.x; oy = box.y; sc = box.width / D.w; H = box.height;
      }
    }
    if (!pg) { pg = out.addPage([D.w, D.h]); H = D.h; if (withBg) drawPaperVector(L, pg, page, paperKey, D.w, D.h); }
    const place = { x: ox, y: oy + H, scale: sc };
    // layers: images & text (raster), highlighter, ink
    const order = [...page.strokes.filter(s => s.t === 'img'), ...page.strokes.filter(s => s.t === 'hl'), ...page.strokes.filter(s => s.t !== 'img' && s.t !== 'hl')];
    for (const s of order) {
      if (s.t === 'img' || s.t === 'text') {
        const r = await rasterize(s);
        const im = await out.embedPng(r.bytes);
        pg.drawImage(im, { x: ox + r.x * sc, y: oy + H - (r.y + r.h) * sc, width: r.w * sc, height: r.h * sc });
        continue;
      }
      const v = strokeVector(s); if (!v.d) continue;
      const color = rgb(s.t === 'hl' ? s.c : inkFor(s.c, dark && !page.pdf), L);
      const alpha = (s.a ?? 1) * (v.alpha ?? 1);
      const blend = s.t === 'hl' ? L.BlendMode.Multiply : undefined;
      if (v.kind === 'fill') pg.drawSvgPath(v.d, { ...place, color, opacity: s.t === 'hl' ? Math.min(1, (s.a ?? .4) * (v.alpha ?? 1)) : alpha, blendMode: blend });
      else pg.drawSvgPath(v.d, { ...place, borderColor: color, borderWidth: v.w * sc, borderOpacity: s.t === 'hl' ? (s.a ?? .4) : alpha, borderLineCap: v.cap === 'butt' ? L.LineCapStyle.Butt : L.LineCapStyle.Round, borderDashArray: v.dash ? v.dash.map(x => x * sc) : undefined, blendMode: blend });
    }
    onProgress && onProgress(i + 1, pages.length);
    if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
  }
  const bytes = await out.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// Dialog per design: all / current / from-to / multiple ranges, progress bar
export function openExportDialog(ed) {
  const n = ed.nb.pages.length, curIdx = Math.max(0, ed.nb.pages.indexOf(ed.currentPage()?.id));
  let withBg = true;
  const sel = new Set([...Array(n).keys()]);
  const body = h('div', { class: 'xp' });
  const count = h('span', { class: 'xp-count' });
  const allBtn = h('button', { class: 'pill sec xp-b' });
  const curBtn = h('button', { class: 'pill sec xp-b' }, `เฉพาะหน้านี้ (${curIdx + 1})`);
  const ranges = h('input', { class: 'field', type: 'text', inputmode: 'numeric', placeholder: 'พิมพ์ช่วงหน้า เช่น 1-5, 8, 10-12' });
  const info = h('div', { class: 'xp-info' });
  body.append(h('div', { class: 'xp-top' }, allBtn, curBtn, h('span', { style: { flex: 1 } }), count));
  const grid = h('div', { class: 'xp-grid' });
  const cells = [];
  let anchor = null;
  const io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) { io.unobserve(en.target); drawCell(en.target); } }, { root: grid, rootMargin: '200px 0px' });
  const drawCell = (cell) => {
    const p = ed.pageMap.get(cell.dataset.pid); if (!p) return;
    const cv = cell.querySelector('canvas'), c = ed.thumbCache?.get(p.id);
    if (c && !c.partial && c.key === ed.thumbKey(p)) { cv.width = c.c.width; cv.height = c.c.height; cv.getContext('2d').drawImage(c.c, 0, 0); return; }
    requestAnimationFrame(() => { renderPageTo(cv, p, ed.paper, 110 * Math.min(2, devicePixelRatio || 1)); if (p.pdf) setTimeout(() => { if (cell.isConnected) renderPageTo(cv, p, ed.paper, 110 * Math.min(2, devicePixelRatio || 1)); }, 1500); });
  };
  ed.nb.pages.forEach((pid, i) => {
    const p = ed.pageMap.get(pid); const P = p ? dims(p) : { w: 595, h: 842 };
    const ar = P.w / P.h;
    const cell = h('div', { class: 'xp-cell', 'data-pid': pid },
      h('div', { class: 'xp-pg', style: { aspectRatio: ar } }, h('canvas'), h('span', { class: 'xp-chk' }, icon('check'))),
      h('span', { class: 'xp-no' }, String(i + 1)));
    cell.onclick = (e) => {
      if (e.shiftKey && anchor != null) { const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; for (let k = a; k <= b; k++) sel.add(k); }
      else { sel.has(i) ? sel.delete(i) : sel.add(i); anchor = i; }
      ranges.value = ''; paint();
    };
    cells.push(cell); grid.append(cell); io.observe(cell);
  });
  body.append(grid, h('div', { class: 'xp-range' }, ranges), info);
  body.append(h('div', { class: 'row' }, h('span', {}, 'รวมพื้นกระดาษ (เส้น/ตาราง/จุด)'), toggle(true, v => withBg = v)));
  const bar = h('div', { style: { height: '10px', borderRadius: '5px', background: 'var(--line)', marginTop: '10px', overflow: 'hidden', display: 'none' } }, h('div', { style: { width: '0%', height: '100%', background: 'var(--acc)', transition: 'width .2s' } }));
  const prog = h('div', { style: { fontSize: '19px', color: 'var(--muted)', marginTop: '4px' } });
  body.append(bar, prog);
  let okBtn;
  const paint = () => {
    cells.forEach((c, i) => c.classList.toggle('on', sel.has(i)));
    const k = sel.size;
    count.textContent = k ? `${k} หน้าที่เลือก` : 'ยังไม่ได้เลือกหน้า';
    allBtn.textContent = k === n ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด';
    curBtn.classList.toggle('on', k === 1 && sel.has(curIdx));
    if (okBtn) { okBtn.disabled = !k; okBtn.lastChild.textContent = k ? `ส่งออก ${k} หน้า` : 'ส่งออก'; }
  };
  allBtn.onclick = () => { if (sel.size === n) sel.clear(); else for (let i = 0; i < n; i++) sel.add(i); ranges.value = ''; info.textContent = ''; paint(); };
  curBtn.onclick = () => { sel.clear(); sel.add(curIdx); ranges.value = ''; info.textContent = ''; paint(); cells[curIdx]?.scrollIntoView({ block: 'nearest' }); };
  ranges.addEventListener('input', () => {
    if (!ranges.value.trim()) { info.textContent = ''; return; }
    const r = parseRanges(ranges.value, n);
    if (!r) { info.style.color = 'var(--rec)'; info.textContent = `รูปแบบไม่ถูกต้อง หรือเลขหน้าเกิน ${n}`; return; }
    info.style.color = '#1E9E5A'; info.textContent = `✓ เลือกตามช่วงที่พิมพ์ ${r.length} หน้า`;
    sel.clear(); for (const i of r) sel.add(i); paint();
    cells[r[0]]?.scrollIntoView({ block: 'nearest' });
  });
  let busyFlag = false;
  const dg = dialog('ส่งออกเป็น PDF', body, [
    { label: 'ยกเลิก' },
    { label: 'ส่งออก', cls: 'prim', flex: 2, icon: 'pdf', action: async (btn) => {
      if (busyFlag) return false;
      const idx = [...sel].sort((a, b) => a - b); if (!idx.length) return false;
      busyFlag = true; btn.disabled = true; bar.style.display = '';
      const bz = busy('กำลังสร้างไฟล์ PDF…', `${idx.length} หน้า`, 0);
      await ed.flush();
      try {
        const pages = idx.map(i => ed.pageMap.get(ed.nb.pages[i]));
        const blob = await exportPdf(pages, ed.paper, { withBg, onProgress: (a, b) => { bar.firstChild.style.width = Math.round(a / b * 100) + '%'; prog.textContent = `กำลังสร้างไฟล์… หน้า ${a} จาก ${b}`; bz.set('กำลังสร้างไฟล์ PDF…', `หน้า ${a} จาก ${b}`, a / b); } });
        prog.textContent = 'เสร็จแล้ว'; bz.done(); io.disconnect();
        await deliverPdf(blob, ed.nb.name);
      } catch (e) { console.error(e); bz.done(); toast('ส่งออกไม่สำเร็จ: ' + (e.message || e), 4000, 'warn'); busyFlag = false; btn.disabled = false; return false; }
    } },
  ], { width: 780 });
  okBtn = dg.el.querySelector('.foot .pill.prim');
  paint();
  requestAnimationFrame(() => cells[curIdx]?.scrollIntoView({ block: 'nearest' }));
}

async function deliverPdf(blob, name) {
  const safe = (name || 'สมุด').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
  const file = new File([blob], safe + '.pdf', { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: safe }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const d = new Date(), q = (n) => String(n).padStart(2, '0');
  downloadBlob(blob, `senkid-${d.getFullYear()}${q(d.getMonth() + 1)}${q(d.getDate())}-${q(d.getHours())}${q(d.getMinutes())}.pdf`);
  toast('ดาวน์โหลด PDF แล้ว');
}
