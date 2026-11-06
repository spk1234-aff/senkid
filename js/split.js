// เทียบสองหน้า: a read-only pane beside the board showing any page of any notebook (the worked example,
// last lesson's notes, the question sheet…) while the teacher keeps writing on the left.
import { h, icon, toast } from './ui.js';
import * as db from './db.js';
import { prefs, savePrefs } from './prefs.js';
import { renderPageTo } from './render.js';

export function toggleSplit(ed) { if (ed.splitPane) closeSplit(ed); else openSplit(ed); }
export function closeSplit(ed) { const P = ed.splitPane; if (!P) return; P.ro?.disconnect(); P.ro2?.disconnect(); P.el.remove(); ed.splitPane = null; ed.el.classList.remove('split'); prefs.split = { ...(prefs.split || {}), on: false }; savePrefs(); }
export async function openSplit(ed, { nb = null, pid = null } = {}) {
  closeSplit(ed);
  const st = prefs.split || {};
  const nbs = (await db.getAll('notebooks')).filter(n => !n.trash).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  let curNb = nbs.find(n => n.id === (nb || st.nb)) || ed.nb, pages = [], idx = 0, zoom = st.zoom || 1;
  const sel = h('select', { class: 'sel', style: { flex: '1 1 auto', minWidth: 0 } }, ...nbs.map(n => h('option', { value: n.id }, n.id === ed.nb.id ? `${n.name} (เล่มนี้)` : n.name)));
  const no = h('span', { class: 'sp-no' });
  const B = (ic, t, fn) => { const b = h('button', { class: 'btn sq', title: t }, icon(ic)); b.onclick = fn; return b; };
  const cv = h('canvas', { class: 'sp-cv' });
  const body = h('div', { class: 'sp-body' }, cv);
  const wide = B('expand', 'กว้าง/แคบ', () => { P.el.classList.toggle('wide'); prefs.split.wide = P.el.classList.contains('wide'); savePrefs(); });
  const head = h('div', { class: 'sp-head' }, sel, B('back', 'หน้าก่อน', () => go(idx - 1)), no, B('chev', 'หน้าถัดไป', () => go(idx + 1)),
    B('down', 'ย่อ', () => { zoom = Math.max(1, zoom / 1.4); paint(); }), B('up', 'ขยาย', () => { zoom = Math.min(4, zoom * 1.4); paint(); }), wide, B('close', 'ปิดเทียบสองหน้า', () => closeSplit(ed)));
  const el = h('div', { class: 'splitpane' + (st.wide ? ' wide' : ''), 'data-nomirror': '1' }, head, body);
  const P = ed.splitPane = { el, changed: (p) => { if (curNb.id === ed.nb.id && pages[idx]?.id === p.id) { clearTimeout(P.t); P.t = setTimeout(paint, 300); } } };
  ed.el.append(el); ed.el.classList.add('split');
  const place = () => { el.style.top = ed.stage.offsetTop + 'px'; el.style.height = ed.stage.offsetHeight + 'px'; };
  place(); P.ro2 = new ResizeObserver(place); P.ro2.observe(ed.stage);
  const load = async () => {
    if (curNb.id === ed.nb.id) pages = ed.nb.pages.map(id => ed.pages.find(p => p.id === id)).filter(Boolean);
    else { const all = await db.pagesOf(curNb.id); const m = new Map(all.map(p => [p.id, p])); pages = (curNb.pages || []).map(id => m.get(id)).filter(Boolean); }
  };
  const paint = () => {
    const p = pages[idx]; no.textContent = pages.length ? `${idx + 1}/${pages.length}` : '–';
    if (!p) { const x = cv.getContext('2d'); cv.width = 10; cv.height = 10; x.clearRect(0, 0, 10, 10); return; }
    const w = Math.max(200, body.clientWidth - 16) * zoom, d = Math.min(2, devicePixelRatio || 1);
    try { renderPageTo(cv, p, curNb.paper || 'cream', Math.round(w * d)); cv.style.width = w + 'px'; cv.style.height = Math.round(cv.height / d) + 'px'; } catch (e) { console.warn('split', e); }
    prefs.split = { ...(prefs.split || {}), on: true, nb: curNb.id, pid: p.id, zoom }; savePrefs();
  };
  const go = (i) => { if (!pages.length) return; idx = Math.max(0, Math.min(pages.length - 1, i)); body.scrollTop = 0; paint(); };
  sel.value = curNb.id;
  sel.onchange = async () => { curNb = nbs.find(n => n.id === sel.value) || ed.nb; await load(); idx = 0; paint(); };
  await load();
  const want = pid || (curNb.id === (st.nb || '') ? st.pid : null);
  idx = Math.max(0, pages.findIndex(p => p.id === want)); if (idx < 0) idx = 0;
  // swipe left/right in the pane to change page
  let sx = null; body.addEventListener('pointerdown', e => { sx = e.clientX; }); body.addEventListener('pointerup', e => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (zoom === 1 && Math.abs(dx) > 60) go(idx + (dx < 0 ? 1 : -1)); });
  P.ro = new ResizeObserver(() => { clearTimeout(P.r); P.r = setTimeout(paint, 120); }); P.ro.observe(body);
  requestAnimationFrame(paint);
  toast('เทียบสองหน้า: ด้านขวาดูอย่างเดียว เขียนต่อทางซ้ายได้ตามปกติ', 2200);
}
