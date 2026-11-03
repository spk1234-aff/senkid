// เส้นคิด (Senkid) © 2026 นายศาสตราวุฒิ อาชนะชัย · โรงเรียนโซ่พิสัยพิทยาคม · สงวนลิขสิทธิ์ ดู LICENSE.md
// Export pages to PDF with vector ink (pdf-lib, offline). PDF-backed pages keep their original vector content.
import { h, icon, toast, dialog, seg, toggle, downloadBlob, busy } from './ui.js';
import { dims, PAPERS, strokeVector, drawStroke, strokeBB, inkFor, hexToRgb, renderPageTo } from './render.js';
import { pdfBytes } from './pdfdoc.js';
import { prefs } from './prefs.js';
const CREDIT = 'สร้างด้วยเส้นคิด · พัฒนาโดย นายศาสตราวุฒิ อาชนะชัย โรงเรียนโซ่พิสัยพิทยาคม';

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

// small credit line at the bottom of each page (Thai text → rendered with the app font into a PNG)
async function creditPng(text) {
  try { await document.fonts.load('40px "TH Sarabun New"'); } catch { }
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), px = 40;
  ctx.font = `${px}px "TH Sarabun New", sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 8, hgt = Math.ceil(px * 1.35);
  c.width = w; c.height = hgt;
  ctx.font = `${px}px "TH Sarabun New", sans-serif`; ctx.fillStyle = 'rgba(110,112,120,0.85)'; ctx.textBaseline = 'middle'; ctx.fillText(text, 4, hgt / 2);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ar: w / hgt };
}

export async function exportPdf(pages, paperKey, { withBg = true, onProgress } = {}) {
  const credit = CREDIT; // always on
  const L = await lib();
  const out = await L.PDFDocument.create();
  out.setCreator('เส้นคิด · พัฒนาโดย นายศาสตราวุฒิ อาชนะชัย'); out.setProducer('Senkid'); out.setAuthor('เส้นคิด (พัฒนาโดย นายศาสตราวุฒิ อาชนะชัย โรงเรียนโซ่พิสัยพิทยาคม)');
  const srcDocs = new Map();
  const dark = !!PAPERS[paperKey]?.dark && withBg;
  let creditImg = null, creditAr = 1;
  if (credit) { const cp = await creditPng(credit); creditImg = await out.embedPng(cp.bytes); creditAr = cp.ar; }
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
      if (s.shape && s.fill && s.t !== 'hl' && (s.shape.closed || s.shape.k === 'ellipse')) pg.drawSvgPath(v.d, { ...place, color: s.fc ? rgb(inkFor(s.fc, dark && !page.pdf), L) : color, opacity: Math.min(1, alpha * s.fill) });
      if (v.kind === 'fill') pg.drawSvgPath(v.d, { ...place, color, opacity: s.t === 'hl' ? Math.min(1, (s.a ?? .4) * (v.alpha ?? 1)) : alpha, blendMode: blend });
      else pg.drawSvgPath(v.d, { ...place, borderColor: color, borderWidth: v.w * sc, borderOpacity: s.t === 'hl' ? (s.a ?? .4) : alpha, borderLineCap: v.cap === 'butt' ? L.LineCapStyle.Butt : L.LineCapStyle.Round, borderDashArray: v.dash ? v.dash.map(x => x * sc) : undefined, blendMode: blend });
    }
    if (creditImg) { // ~7pt high, bottom-right corner
      const hh = 9 * sc, ww = hh * creditAr, W = D.w * sc;
      pg.drawImage(creditImg, { x: ox + W - ww - 10 * sc, y: oy + 5 * sc, width: ww, height: hh });
    }
    onProgress && onProgress(i + 1, pages.length);
    if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
  }
  const bytes = await out.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// Dialog per design: all / current / from-to / multiple ranges, progress bar
export function openExportDialog(ed, { submit = false } = {}) {
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
  body.append(h('div', { class: 'xp-credit' }, 'ทุกหน้าจะมีบรรทัดเล็กที่มุมล่าง: ' + CREDIT));
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
  const make = async (btn) => {   // สร้าง PDF จากหน้าที่เลือก → { blob, n } หรือ null
    if (busyFlag) return null;
    const idx = [...sel].sort((a, b) => a - b); if (!idx.length) return null;
    busyFlag = true; btn.disabled = true; bar.style.display = '';
    const bz = busy('กำลังสร้างไฟล์ PDF…', `${idx.length} หน้า`, 0);
    await ed.flush();
    try {
      const pages = idx.map(i => ed.pageMap.get(ed.nb.pages[i]));
      const blob = await exportPdf(pages, ed.paper, { withBg, onProgress: (a, b) => { bar.firstChild.style.width = Math.round(a / b * 100) + '%'; prog.textContent = `กำลังสร้างไฟล์… หน้า ${a} จาก ${b}`; bz.set('กำลังสร้างไฟล์ PDF…', `หน้า ${a} จาก ${b}`, a / b); } });
      prog.textContent = 'เสร็จแล้ว'; bz.done(); io.disconnect(); return { blob, n: idx.length };
    } catch (e) { console.error(e); bz.done(); toast('ส่งออกไม่สำเร็จ: ' + (e.message || e), 4000, 'warn'); busyFlag = false; btn.disabled = false; return null; }
  };
  const student = submit || prefs.studentUI;
  const dg = dialog(submit ? 'ส่งงานให้ครู' : 'ส่งออกเป็น PDF', body, [
    { label: 'ยกเลิก' },
    { label: 'ส่งงานให้ครู', icon: 'upload', flex: 2, cls: student ? 'prim' : 'sec', action: async (btn) => {
      const r = await make(btn); if (!r) return false;
      openSubmitDialog(r.blob, r.n, ed.nb.name);
    } },
    { label: 'ส่งออก', cls: student ? 'sec' : 'prim', flex: 2, icon: 'pdf', action: async (btn) => {
      if (busyFlag) return false;
      const idx = [...sel].sort((a, b) => a - b); if (!idx.length) return false;
      busyFlag = true; btn.disabled = true; bar.style.display = '';
      const bz = busy('กำลังสร้างไฟล์ PDF…', `${idx.length} หน้า`, 0);
      await ed.flush();
      try {
        const pages = idx.map(i => ed.pageMap.get(ed.nb.pages[i]));
        const blob = await exportPdf(pages, ed.paper, { withBg,  onProgress: (a, b) => { bar.firstChild.style.width = Math.round(a / b * 100) + '%'; prog.textContent = `กำลังสร้างไฟล์… หน้า ${a} จาก ${b}`; bz.set('กำลังสร้างไฟล์ PDF…', `หน้า ${a} จาก ${b}`, a / b); } });
        prog.textContent = 'เสร็จแล้ว'; bz.done(); io.disconnect();
        await deliverPdf(blob, ed.nb.name);
      } catch (e) { console.error(e); bz.done(); toast('ส่งออกไม่สำเร็จ: ' + (e.message || e), 4000, 'warn'); busyFlag = false; btn.disabled = false; return false; }
    } },
  ], { width: 780 });
  okBtn = dg.el.querySelectorAll('.foot .pill')[2];
  paint();
  requestAnimationFrame(() => cells[curIdx]?.scrollIntoView({ block: 'nearest' }));
}

/* ---------- 📤 ส่งงานเข้า Sir’Earth Class (ห้องเรียนออนไลน์ของครู) โดยตรง ---------- */
const SE_API = 'https://script.google.com/macros/s/AKfycbytfA0FUcixIlzJ1Im3ISGQLjE7mZeY4mZ1fmxa9yZS_lrHb2ngDJsx0nSvH0JGhAb-cg/exec';
const seLS = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } }, del: k => { try { localStorage.removeItem(k); } catch { } } };
async function seCall(fn, args) {
  let r; try { r = await fetch(SE_API, { method: 'POST', body: JSON.stringify({ fn, args }) }); } catch { throw new Error('ต่ออินเทอร์เน็ตไม่ได้ ลองใหม่อีกครั้ง'); }
  const j = await r.json(); if (!j.ok) throw new Error(String(j.e || 'ผิดพลาด').replace(/^Error:\s*/, '')); return j.r;
}
async function seB64(blob) { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); }
const seDate = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); if (!m) return ''; const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']; return `${+m[3]} ${M[+m[2] - 1]} ${m[4]}:${m[5]} น.`; };
const seDue = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5]) : 0; };
function seOpen(data) {   // งานที่เปิดรับอยู่ (ภาคเรียนล่าสุด)
  const t = (data && data.terms || [])[0], out = []; if (!t) return out;
  t.subjects.forEach(sb => sb.items.forEach(it => { if (it.submit && !(it.due && seDue(it.due) <= Date.now())) out.push({ sb, it }); }));
  return out;
}
export function openSubmitDialog(blob, pages, name) {
  if (blob.size > 24 * 1024 * 1024) { toast('ไฟล์ใหญ่เกิน 24 MB ลองเลือกหน้าให้น้อยลง', 4000, 'warn'); return; }
  let S = null; try { S = JSON.parse(seLS.get('se_sess') || 'null'); } catch { }
  if (S && Date.now() - S.at > 5.5 * 3600e3) S = null;
  const body = h('div', { style: { fontSize: '20px', lineHeight: '1.45' } });
  let pick = null, mates = new Set(), sendBtn = null;
  const loginView = (msg) => {
    body.innerHTML = ''; pick = null; if (sendBtn) sendBtn.disabled = true;
    const id = h('input', { class: 'field', type: 'text', inputmode: 'numeric', placeholder: 'เลขประจำตัวนักเรียน', value: seLS.get('se_id'), maxlength: 6 });
    const pin = h('input', { class: 'field', type: 'password', inputmode: 'numeric', placeholder: 'PIN 4 หลัก', maxlength: 4, style: { marginTop: '8px' } });
    const err = h('div', { style: { color: 'var(--rec)', minHeight: '1.4em', marginTop: '6px' } }, msg || '');
    const go = h('button', { class: 'pill prim', style: { width: '100%', marginTop: '6px' } }, 'เข้าสู่ระบบ');
    const run = async () => {
      err.textContent = ''; go.disabled = true; go.textContent = 'กำลังเข้าสู่ระบบ…';
      try {
        const r = await seCall('login', [id.value.trim(), pin.value.trim()]);
        if (!r.ok) throw new Error(r.msg || 'เข้าสู่ระบบไม่สำเร็จ');
        seLS.set('se_id', id.value.trim()); S = { tok: r.tok, data: r.data, at: Date.now() }; seLS.set('se_sess', JSON.stringify(S)); listView();
      } catch (e) { err.textContent = e.message; go.disabled = false; go.textContent = 'เข้าสู่ระบบ'; }
    };
    go.onclick = run; pin.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    body.append(h('div', { style: { color: 'var(--muted)', marginBottom: '8px' } }, `ส่ง PDF ${pages} หน้า เข้า Sir’Earth Class — ใช้เลขประจำตัวและ PIN เดียวกับที่ดูคะแนน`), id, pin, err, go);
    setTimeout(() => (id.value ? pin : id).focus(), 60);
  };
  const listView = () => {
    body.innerHTML = ''; pick = null; mates = new Set(); if (sendBtn) sendBtn.disabled = true;
    const list = seOpen(S.data);
    body.append(h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', color: 'var(--muted)', marginBottom: '6px' } }, h('span', {}, `${S.data.name} · ส่ง PDF ${pages} หน้า`),
      h('button', { class: 'pill sec', style: { padding: '2px 12px' }, onclick: () => { seLS.del('se_sess'); S = null; loginView(); } }, 'เปลี่ยนคน / ดูงานล่าสุด')));
    if (!list.length) { body.append(h('div', { style: { padding: '18px 4px' } }, 'ตอนนี้ยังไม่มีงานที่ครูเปิดรับ — ถ้าครูเพิ่งเปิดรับ กด “เปลี่ยนคน / ดูงานล่าสุด” แล้วเข้าสู่ระบบใหม่')); return; }
    const mbox = h('div');
    body.append(h('div', { style: { fontWeight: 700, margin: '4px 0' } }, 'เลือกงานที่จะส่ง'));
    list.forEach(({ sb, it }) => {
      const row = h('label', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: '12px', marginBottom: '6px', cursor: 'pointer' } },
        h('input', { type: 'radio', name: 'se_it', style: { width: '22px', height: '22px', marginTop: '4px' } }),
        h('div', {}, h('div', { style: { fontWeight: 700 } }, it.name), h('div', { style: { fontSize: '17px', color: 'var(--muted)' } },
          `${sb.code} ${sb.name}` + (it.due ? ` · ส่งภายใน ${seDate(it.due)}` : '') + (it.group ? ' · งานกลุ่ม' : '') + (it.sent ? ' · ✅ ส่งแล้ว (ส่งใหม่จะแทนที่)' : ''))));
      row.querySelector('input').onchange = () => {
        pick = it; mates = new Set(); sendBtn.disabled = false; mbox.innerHTML = '';
        if (it.group && it.mates && it.mates.length) {
          mbox.append(h('div', { style: { fontWeight: 700, margin: '8px 0 4px' } }, '👥 เลือกเพื่อนในกลุ่ม (คุณเป็นผู้ส่ง)'));
          const g = h('div', { style: { maxHeight: '220px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '12px', padding: '4px 8px' } });
          it.mates.forEach(m => { const c = h('input', { type: 'checkbox', style: { width: '20px', height: '20px' } }); c.onchange = () => c.checked ? mates.add(m.id) : mates.delete(m.id); g.append(h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0' } }, c, `${m.no}. ${m.name}`)); });
          mbox.append(g);
        }
      };
      body.append(row);
    });
    body.append(mbox);
  };
  const dg = dialog('ส่งงานให้ครู (Sir’Earth Class)', body, [
    { label: 'ยกเลิก' },
    { label: 'ส่งงาน', cls: 'prim', flex: 2, icon: 'upload', action: async (btn) => {
      if (!S || !pick) return false;
      if (pick.group && !mates.size && !confirm('ยังไม่ได้เลือกเพื่อนในกลุ่ม — ส่งในนามคุณคนเดียวใช่ไหม?')) return false;
      btn.disabled = true; const bz = busy('กำลังส่งงาน…', pick.name);
      try {
        const r = await seCall('submitWork', [S.tok, pick.id, { data: await seB64(blob), pages }, [...mates]]);
        bz.done(); pick.sent = r; seLS.set('se_sess', JSON.stringify(S));
        toast(`✅ ส่ง “${pick.name}” แล้ว (${r.n} หน้า)` + (r.members && r.members.length ? ` · กลุ่ม ${r.members.length} คน` : ''), 4200);
      } catch (e) {
        bz.done(); btn.disabled = false;
        if (/SESSION/.test(e.message)) { seLS.del('se_sess'); S = null; loginView('หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่แล้วกดส่งอีกครั้ง'); }
        else toast('ส่งไม่สำเร็จ: ' + e.message, 5000, 'warn');
        return false;
      }
    } },
  ], { width: 560 });
  sendBtn = dg.el.querySelector('.foot .pill.prim'); sendBtn.disabled = true;
  S ? listView() : loginView();
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
