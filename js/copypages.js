// Copy or move pages from the open notebook into another notebook ("สอนเรื่องเดียวกัน 3 ห้อง")
import { h, icon, toast, dialog, uid, busy } from './ui.js';
import * as db from './db.js';
import { renderPageTo } from './render.js';

export async function openCopyPages(ed) {
  const cur = ed.currentPage(); if (!cur) return;
  const nbs = (await db.getAll('notebooks')).filter(n => n.id !== ed.nb.id).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const sel = new Set([cur.id]);
  let dest = null, at = 'end', mode = 'copy';
  // 1) pages of this notebook as small thumbnails with checkboxes
  const pageList = h('div', { class: 'cp-pages' });
  const paintPages = () => {
    pageList.innerHTML = '';
    ed.nb.pages.forEach((pid, i) => {
      const p = ed.pageMap.get(pid); if (!p) return;
      const cv = h('canvas', { class: 'cp-th' });
      const it = h('button', { class: 'cp-page' + (sel.has(pid) ? ' on' : '') }, cv, h('span', { class: 'no' }, String(i + 1)), h('span', { class: 'ck' }, sel.has(pid) ? '✓' : ''));
      it.onclick = () => { sel.has(pid) ? sel.delete(pid) : sel.add(pid); paintPages(); paintSummary(); };
      pageList.append(it);
      requestAnimationFrame(() => { try { renderPageTo(cv, p, ed.paper, 110); } catch { } });
    });
  };
  const allBtn = h('button', { class: 'chip' }, 'เลือกทุกหน้า'); allBtn.onclick = () => { for (const pid of ed.nb.pages) sel.add(pid); paintPages(); paintSummary(); };
  const noneBtn = h('button', { class: 'chip' }, 'ล้าง'); noneBtn.onclick = () => { sel.clear(); paintPages(); paintSummary(); };
  // 2) destination notebook
  const q = h('input', { class: 'field', type: 'search', placeholder: 'ค้นหาชื่อสมุดปลายทาง' });
  const nbList = h('div', { class: 'mvlist', style: { maxHeight: '220px', overflow: 'auto' } });
  const paintNbs = () => {
    nbList.innerHTML = '';
    const f = q.value.trim().toLowerCase();
    const list = nbs.filter(n => !f || (n.name || '').toLowerCase().includes(f)).slice(0, 40);
    if (!list.length) nbList.append(h('div', { class: 'sub', style: { padding: '10px' } }, nbs.length ? 'ไม่พบสมุดชื่อนี้' : 'ยังไม่มีสมุดเล่มอื่น'));
    for (const n of list) {
      const b = h('button', { class: 'mvitem' + (dest?.id === n.id ? ' on' : '') }, h('span', { class: 'fdot', style: { background: n.cover || '#2F5BEA' } }), h('span', {}, n.name || 'ไม่มีชื่อ'), h('span', { class: 'n' }, `${n.pages?.length || 0} หน้า${n.folder ? ' · ' + n.folder.split('/').join(' › ') : ''}`));
      b.onclick = () => { dest = n; paintNbs(); paintSummary(); };
      nbList.append(b);
    }
  };
  q.oninput = paintNbs;
  const summary = h('div', { class: 'sub', style: { margin: '10px 0 0', minHeight: '24px' } });
  const paintSummary = () => { summary.textContent = `${mode === 'copy' ? 'คัดลอก' : 'ย้าย'} ${sel.size} หน้า → ${dest ? '"' + dest.name + '"' : '(เลือกสมุดปลายทาง)'} ${at === 'end' ? 'ต่อท้าย' : 'ไว้หน้าแรก'}`; };
  const modeSeg = h('div', { class: 'seg' });
  for (const [k, l] of [['copy', 'คัดลอก (ต้นฉบับยังอยู่)'], ['move', 'ย้าย (เอาออกจากเล่มนี้)']]) { const b = h('button', { class: k === mode ? 'on' : '' }, l); b.onclick = () => { mode = k; for (const x of modeSeg.children) x.classList.toggle('on', x === b); paintSummary(); }; modeSeg.append(b); }
  const atSeg = h('div', { class: 'seg' });
  for (const [k, l] of [['end', 'ต่อท้ายสมุดปลายทาง'], ['start', 'ไว้หน้าแรก']]) { const b = h('button', { class: k === at ? 'on' : '' }, l); b.onclick = () => { at = k; for (const x of atSeg.children) x.classList.toggle('on', x === b); paintSummary(); }; atSeg.append(b); }
  paintPages(); paintNbs(); paintSummary();
  const body = h('div', {},
    h('div', { class: 'lbl', style: { marginTop: 0, display: 'flex', gap: '8px', alignItems: 'center' } }, '1. เลือกหน้า', h('span', { class: 'grow' }), allBtn, noneBtn), pageList,
    h('div', { class: 'lbl' }, '2. สมุดปลายทาง'), q, nbList,
    h('div', { class: 'lbl' }, '3. วิธี'), modeSeg, h('div', { style: { height: '6px' } }), atSeg, summary);
  dialog('คัดลอก / ย้ายหน้าไปสมุดอื่น', body, [{ label: 'ยกเลิก' }, { label: 'ตกลง', cls: 'prim', flex: 2, action: async () => {
    if (!sel.size) { toast('ยังไม่ได้เลือกหน้า', 2000, 'warn'); return false; }
    if (!dest) { toast('เลือกสมุดปลายทางก่อน', 2000, 'warn'); return false; }
    if (mode === 'move' && sel.size >= ed.nb.pages.length) { toast('ย้ายทุกหน้าไม่ได้ · สมุดต้องเหลืออย่างน้อย 1 หน้า', 3000, 'warn'); return false; }
    const bz = busy(mode === 'copy' ? 'กำลังคัดลอกหน้า…' : 'กำลังย้ายหน้า…', dest.name);
    try { await copyPages(ed, [...ed.nb.pages.filter(p => sel.has(p))], dest, { move: mode === 'move', at }); } finally { bz.done(); }
    return true;
  } }], { width: 640 });
}

export async function copyPages(ed, pids, destNb, { move = false, at = 'end' } = {}) {
  await ed.flush();
  const dest = await db.get('notebooks', destNb.id); if (!dest) { toast('ไม่พบสมุดปลายทาง', 3000, 'warn'); return; }
  const pages = [];
  for (const pid of pids) {
    const src = ed.pageMap.get(pid); if (!src) continue;
    const strokes = src.strokes.map(s => ({ ...s, id: uid(), pts: s.pts ? new Float32Array(s.pts) : undefined, shape: s.shape ? JSON.parse(JSON.stringify(s.shape)) : undefined, bb: null }));
    pages.push({ id: uid(), nb: dest.id, size: src.size, bg: src.bg, bgo: src.bgo, pw: src.pw, ph: src.ph, pdf: src.pdf, strokes });
  }
  const ids = pages.map(p => p.id);
  dest.pages = at === 'start' ? [...ids, ...(dest.pages || [])] : [...(dest.pages || []), ...ids];
  dest.count = dest.pages.length;
  await db.savePagesAndNotebook(pages, dest);
  if (move) {
    const before = ed.nb.pages.slice();
    ed.nb.pages = ed.nb.pages.filter(p => !pids.includes(p)); for (const p of pids) ed.deleted.add(p);
    ed.pushHistory({ k: 'pages', before, after: ed.nb.pages.slice() });
    ed.saveNb(); ed.relayout(false); ed.renderThumbs(); ed.scrollToPage(ed.nb.pages[0]);
  }
  toast(`${move ? 'ย้าย' : 'คัดลอก'} ${pages.length} หน้าไปที่ "${dest.name}" แล้ว`, 3000);
}
