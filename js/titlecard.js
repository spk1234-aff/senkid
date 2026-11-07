// Title card (the first screen of a video): templates, background (colour / picture / notebook page, dimmed),
// three lines of text, font, text colour, a logo in a corner. Also renders the YouTube cover picture.
import { h, icon, toast, dialog, seg, uid, pickFile } from './ui.js';
import * as db from './db.js';
import { prefs, savePrefs } from './prefs.js';
import { TEXT_FONTS, familyFor, ensureFont, onFontReady } from './textfonts.js';
import { renderPageTo } from './render.js';

export const TEMPLATES = [
  { id: 'navy', name: 'กรมท่า', bg: 'color', color: '#1E2A55', fg: '#FFFFFF', font: 'prompt', accent: '#F5B83D' },
  { id: 'board', name: 'กระดานเขียว', bg: 'color', color: '#23423A', fg: '#F4F1E8', font: 'itim', accent: '#F5B83D' },
  { id: 'paper', name: 'กระดาษ', bg: 'color', color: '#FBF7EE', fg: '#1E2A55', font: 'sarabun', accent: '#E5484D' },
  { id: 'sun', name: 'สดใส', bg: 'color', color: '#F5B83D', fg: '#1E2A55', font: 'kanit', accent: '#FFFFFF' },
  { id: 'page', name: 'หน้าสมุด', bg: 'page', color: '#1E2A55', fg: '#FFFFFF', font: 'kanit', accent: '#F5B83D', dim: 0.55 },
];
const COLORS = ['#1E2A55', '#23423A', '#0F8A7E', '#2F5BEA', '#7C3AED', '#E5484D', '#F5B83D', '#FBF7EE', '#FFFFFF', '#111111'];

export function defaultDesign(title = '') {
  const last = prefs.mvTitle || {};
  const t = TEMPLATES.find(x => x.id === last.tpl) || TEMPLATES[0];
  return { tpl: t.id, bg: t.bg, color: t.color, fg: t.fg, font: t.font, accent: t.accent, dim: t.dim ?? 0.5, img: null, page: null, logo: null, corner: 'tr', hold: 3000,
    ...last, lines: [title, last.lines?.[1] || '', last.lines?.[2] || ''] };
}
export function rememberDesign(d) { prefs.mvTitle = { ...d, page: null, lines: ['', d.lines[1] || '', d.lines[2] || ''] }; savePrefs(); }

// pictures the card needs (background picture / page, logo)
export async function loadAssets(d) {
  const A = {};
  try {
    if (d.bg === 'image' && d.img) { const b = (await db.get('kv', 'cutimg:' + d.img))?.v; if (b) A.bg = await createImageBitmap(b); }
    if (d.bg === 'page' && d.page) { const pg = await db.get('pages', d.page.pid), nb = await db.get('notebooks', d.page.nb); if (pg) { const c = document.createElement('canvas'); renderPageTo(c, pg, nb?.paper || 'cream', 1600); A.bg = c; } }
    if (d.logo) { const b = (await db.get('kv', 'cutimg:' + d.logo))?.v; if (b) A.logo = await createImageBitmap(b); }
    await ensureFont(d.font);
  } catch (e) { console.warn('title assets', e); }
  return A;
}

const fit = (ctx, text, maxW, px, weight, fam) => { let s = px; ctx.font = `${weight} ${s}px ${fam}`; while (s > 12 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${weight} ${s}px ${fam}`; } return s; };
export function drawTitleCard(ctx, W, H, d, A = {}) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = d.color || '#1E2A55'; ctx.fillRect(0, 0, W, H);
  if (A.bg && (d.bg === 'image' || d.bg === 'page')) {
    const iw = A.bg.width, ih = A.bg.height;
    // pictures fill the frame; a notebook page is shown from the top so the writing is visible
    const s = d.bg === 'page' ? W / iw : Math.max(W / iw, H / ih), w = iw * s, hh = ih * s;
    ctx.drawImage(A.bg, (W - w) / 2, d.bg === 'page' ? Math.min(0, (H - hh) * 0.12) : (H - hh) / 2, w, hh);
    ctx.fillStyle = `rgba(0,0,0,${d.dim ?? 0.5})`; ctx.fillRect(0, 0, W, H);
  }
  const fam = familyFor(d.font), L = d.lines || [], cx = W / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = d.fg || '#fff';
  const s1 = L[0] ? fit(ctx, L[0], W * 0.86, Math.round(H * 0.12), 700, fam) : 0;
  const s2 = L[1] ? fit(ctx, L[1], W * 0.8, Math.round(H * 0.06), 400, fam) : 0;
  const s3 = L[2] ? fit(ctx, L[2], W * 0.8, Math.round(H * 0.045), 400, fam) : 0;
  const gap = H * 0.035, total = s1 * 1.15 + (s2 ? gap + s2 * 1.2 : 0) + (s3 ? gap * 0.6 + s3 * 1.2 : 0);
  let y = H / 2 - total / 2;
  if (s1) { ctx.font = `700 ${s1}px ${fam}`; ctx.fillText(L[0], cx, y + s1 * 0.58); y += s1 * 1.15;
    ctx.fillStyle = d.accent || '#F5B83D'; ctx.fillRect(cx - W * 0.05, y + gap * 0.25, W * 0.1, Math.max(3, H * 0.007)); ctx.fillStyle = d.fg || '#fff'; }
  if (s2) { y += gap; ctx.font = `400 ${s2}px ${fam}`; ctx.globalAlpha = 0.95; ctx.fillText(L[1], cx, y + s2 * 0.6); y += s2 * 1.2; }
  if (s3) { y += gap * 0.6; ctx.font = `400 ${s3}px ${fam}`; ctx.globalAlpha = 0.8; ctx.fillText(L[2], cx, y + s3 * 0.6); }
  ctx.globalAlpha = 1;
  if (A.logo) {
    const lh = H * 0.14, lw = Math.min(W * 0.25, A.logo.width / A.logo.height * lh), m = H * 0.045, c = d.corner || 'tr';
    const x = c.endsWith('l') ? m : W - lw - m, yy = c.startsWith('t') ? m : H - lh - m;
    ctx.drawImage(A.logo, x, yy, lw, lw / (A.logo.width / A.logo.height));
  }
  ctx.restore();
}
// 1280×720 JPEG for the YouTube cover
export async function renderCover(d) {
  const A = await loadAssets(d), c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  drawTitleCard(c.getContext('2d'), 1280, 720, d, A);
  return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
}

// ---------- designer ----------
export async function openTitleDesigner(design, { nb = null } = {}) {
  const d = JSON.parse(JSON.stringify(design));
  const cv = h('canvas', { class: 'tc-cv', width: 960, height: 540 });
  let A = {};
  const redraw = async (reload) => { if (reload) A = await loadAssets(d); drawTitleCard(cv.getContext('2d'), cv.width, cv.height, d, A); };
  const off = onFontReady(() => redraw());
  const body = h('div', { class: 'tc' });
  const tplRow = h('div', { class: 'tc-tpls' });
  const paintTpl = () => { tplRow.innerHTML = ''; for (const t of TEMPLATES) { const b = h('button', { class: 'tc-tpl' + (d.tpl === t.id ? ' on' : ''), style: { background: t.bg === 'page' ? 'linear-gradient(135deg,#555,#222)' : t.color, color: t.fg, fontFamily: familyFor(t.font) } }, t.name); b.onclick = async () => { Object.assign(d, { tpl: t.id, bg: t.bg === 'page' && !d.page ? d.bg : t.bg, color: t.color, fg: t.fg, font: t.font, accent: t.accent, dim: t.dim ?? d.dim }); if (t.bg === 'page' && !d.page) await pickPage(); paintAll(); redraw(true); }; tplRow.append(b); } };
  const lines = [0, 1, 2].map(i => { const inp = h('input', { class: 'field', value: d.lines[i] || '', placeholder: ['ชื่อเรื่อง (บรรทัดใหญ่)', 'บรรทัดรอง เช่น ชั้น ม.3 · ครูศาสตราวุฒิ', 'บรรทัดเล็ก เช่น ชื่อโรงเรียน'][i] }); inp.oninput = () => { d.lines[i] = inp.value; redraw(); }; return inp; });
  const bgBox = h('div');
  const pickPage = async () => {
    const nbs = (await db.getAll('notebooks')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const n = nbs.find(x => x.id === (d.page?.nb || nb)) || nbs[0]; if (!n) { toast('ยังไม่มีสมุด', 1500); return; }
    const pages = await db.pagesOf(n.id), map = new Map(pages.map(p => [p.id, p]));
    await new Promise(res => {
      const grid = h('div', { class: 'cp-pages', style: { flexWrap: 'wrap', maxHeight: '50vh', overflow: 'auto' } });
      const dd = dialog('เลือกหน้าเป็นพื้นหลัง · ' + n.name, grid, [{ label: 'ยกเลิก' }], { width: 640, onClose: res });
      (n.pages || []).forEach((pid, i) => { const p = map.get(pid); if (!p) return; const c = h('canvas', { class: 'cp-th' }); const it = h('button', { class: 'cp-page' }, c, h('span', { class: 'no' }, String(i + 1))); it.onclick = () => { d.page = { nb: n.id, pid }; d.bg = 'page'; dd.close(); }; grid.append(it); requestAnimationFrame(() => { try { renderPageTo(c, p, n.paper || 'cream', 160); } catch { } }); });
    });
  };
  const pickImg = async (key) => { const f = await pickFile('image/*'); if (!f) return false; const id = uid(); await db.putQuiet('kv', { k: 'cutimg:' + id, v: f }); d[key] = id; return true; };
  const colorRow = (key) => { const r = h('div', { class: 'tc-cols' }); for (const c of COLORS) { const b = h('button', { class: 'sw' + (String(d[key]).toUpperCase() === c ? ' on' : '') }, h('i', { style: { background: c } })); b.onclick = () => { d[key] = c; paintAll(); redraw(); }; r.append(b); } return r; };
  const paintBg = () => {
    bgBox.innerHTML = '';
    bgBox.append(seg([['color', 'สีพื้น'], ['image', 'รูปจากเครื่อง'], ['page', 'หน้าสมุด']], d.bg, async (v) => {
      if (v === 'image' && !d.img && !(await pickImg('img'))) { paintBg(); return; }
      if (v === 'page' && !d.page) await pickPage();
      d.bg = v === 'page' && !d.page ? 'color' : v; paintBg(); redraw(true);
    }));
    if (d.bg === 'color') bgBox.append(colorRow('color'));
    else {
      const ch = h('button', { class: 'chip' }, icon(d.bg === 'image' ? 'image' : 'pages'), d.bg === 'image' ? 'เปลี่ยนรูป' : 'เลือกหน้าอื่น');
      ch.onclick = async () => { if (d.bg === 'image') await pickImg('img'); else await pickPage(); paintBg(); redraw(true); };
      const dim = h('input', { type: 'range', min: 0, max: 85, value: Math.round((d.dim ?? 0.5) * 100), style: { flex: 1 } }); dim.oninput = () => { d.dim = +dim.value / 100; redraw(); };
      bgBox.append(h('div', { class: 'tc-rowx' }, ch, h('span', { class: 'sub' }, 'ทำให้มืดลง'), dim));
    }
  };
  const fonts = h('div', { class: 'fontgrid' });
  const paintFonts = () => { fonts.innerHTML = ''; for (const [id, name] of TEXT_FONTS) { const b = h('button', { class: 'chip fontchip' + (d.font === id ? ' on' : ''), style: { fontFamily: familyFor(id) } }, name); b.onclick = async () => { d.font = id; paintFonts(); await ensureFont(id); redraw(); }; fonts.append(b); } };
  const fgBox = h('div'), logoBox = h('div');
  const paintLogo = () => {
    logoBox.innerHTML = '';
    const pick = h('button', { class: 'chip' }, icon('image'), d.logo ? 'เปลี่ยนโลโก้' : 'เลือกโลโก้');
    pick.onclick = async () => { if (await pickImg('logo')) { paintLogo(); redraw(true); } };
    logoBox.append(h('div', { class: 'tc-rowx' }, pick, ...(d.logo ? [(() => { const x = h('button', { class: 'chip' }, icon('trash'), 'ไม่ใส่'); x.onclick = () => { d.logo = null; paintLogo(); redraw(true); }; return x; })(),
      seg([['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], d.corner || 'tr', v => { d.corner = v; redraw(); })] : [])));
  };
  const paintAll = () => { paintTpl(); paintBg(); paintFonts(); fgBox.replaceChildren(colorRow('fg')); paintLogo(); };
  body.append(h('div', { class: 'tc-prev' }, cv),
    h('div', { class: 'lbl' }, 'แบบสำเร็จรูป'), tplRow,
    h('div', { class: 'lbl' }, 'ข้อความ 3 บรรทัด'), ...lines,
    h('div', { class: 'lbl' }, 'พื้นหลัง'), bgBox,
    h('div', { class: 'lbl' }, 'ฟอนต์'), fonts,
    h('div', { class: 'lbl' }, 'สีตัวอักษร'), fgBox,
    h('div', { class: 'lbl' }, 'โลโก้ (เช่น ตราโรงเรียน)'), logoBox,
    h('div', { class: 'lbl' }, 'แสดงนาน'), seg([['2000', '2 วิ'], ['3000', '3 วิ'], ['5000', '5 วิ']], String(d.hold || 3000), v => d.hold = +v));
  paintAll(); redraw(true);
  const ok = await new Promise(r => dialog('ออกแบบหน้าแรกของวิดีโอ', body, [{ label: 'ยกเลิก' }, { label: 'ใช้แบบนี้', cls: 'prim', flex: 2, action: () => r(true) }], { width: 760, onClose: () => r(false) }));
  off();
  if (!ok) return null;
  rememberDesign(d);
  return d;
}
