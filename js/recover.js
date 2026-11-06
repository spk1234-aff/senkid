// "กู้เส้นที่หาย": page snapshots kept on the device (see db.snapshot) and the deletion journal, with one-tap restore.
import { h, icon, toast, dialog, confirmBox } from './ui.js';
import * as db from './db.js';
import { renderPageTo } from './render.js';

const when = (t) => { const d = new Date(t); return `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`; };
const WHY = { 'before-erase': 'ก่อนลบเส้นบนเครื่องนี้', 'before-merge': 'ก่อนรับการลบจากเครื่องอื่น', 'before-restore': 'ก่อนกู้คืน', edit: 'ระหว่างเขียน' };

export async function openRecover(ed) {
  const page = ed.currentPage(); if (!page) return;
  const snaps = await db.snapsOf(page.id);
  const pno = ed.nb.pages.indexOf(page.id) + 1;
  const list = h('div', { class: 'reclist' });
  const body = h('div', {}, h('p', { class: 'sub', style: { margin: '0 0 10px' } }, `หน้า ${pno} · ตอนนี้มี ${page.strokes.length} ชิ้น · ระบบเก็บสำเนาหน้าไว้ในเครื่องนี้อัตโนมัติ (ล่าสุด 30 สำเนา / 21 วัน) · ถ้าเส้นหายให้เลือกสำเนาก่อนหน้าเวลาที่หาย`), list);
  if (!snaps.length) list.append(h('p', { style: { color: 'var(--muted)', textAlign: 'center', padding: '24px 0' } }, 'หน้านี้ยังไม่มีสำเนาย้อนหลัง (จะเริ่มเก็บตั้งแต่เวอร์ชันนี้เป็นต้นไป)'));
  let dlg;
  for (const sn of snaps) {
    const cv = h('canvas', { class: 'snapthumb' });
    const it = h('div', { class: 'item' }, cv,
      h('div', { class: 'meta' }, h('b', {}, `${when(sn.t)} · ${sn.n} ชิ้น`), h('div', {}, (WHY[sn.why] || sn.why || '') + (sn.n > page.strokes.length ? ` · มากกว่าตอนนี้ ${sn.n - page.strokes.length} ชิ้น` : sn.n < page.strokes.length ? ` · น้อยกว่าตอนนี้ ${page.strokes.length - sn.n} ชิ้น` : ' · เท่าตอนนี้'))),
      h('div', { class: 'acts' },
        h('button', { class: 'pill sec', onclick: () => restore(ed, page, sn, 'add') }, icon('plus'), 'เติมเส้นที่หาย'),
        h('button', { class: 'pill prim', onclick: () => restore(ed, page, sn, 'replace') }, icon('undo'), 'ย้อนทั้งหน้า')));
    list.append(it);
    requestAnimationFrame(() => { try { renderPageTo(cv, { ...page, strokes: sn.strokes }, ed.paper, 160); } catch { } });
  }
  const jb = h('button', { class: 'pill sec' }, icon('help'), 'ประวัติเส้นที่หาย (ทุกหน้า)'); jb.onclick = () => openJournal(ed.app);
  dlg = dialog(`กู้เส้นที่หาย · หน้า ${pno}`, body, [{ label: 'ปิด' }], { width: 760 });
  dlg.el.querySelector('.foot')?.prepend(jb);
  async function restore(ed, page, sn, how) {
    const before = page.strokes.slice();
    await db.snapshot(page, 'before-restore');
    let after;
    if (how === 'replace') after = sn.strokes.map(s => ({ ...s }));
    else { const have = new Set(before.map(x => x.id)); const add = sn.strokes.filter(x => x.id && !have.has(x.id)).map(s => ({ ...s, rev: Date.now() })); if (!add.length) { toast('สำเนานี้ไม่มีเส้นที่หน้าปัจจุบันไม่มี', 2500); return; } after = [...before, ...add]; }
    for (const st of after) if (st.id && page.del?.[st.id]) { delete page.del[st.id]; st.rev = Date.now(); } // revived: tombstones must not re-erase it on sync
    page.strokes = after;
    ed.pushHistory({ k: 'str', items: [{ pid: page.id, before, after: after.slice() }] });
    ed.delWhy = 'restore'; ed.markDirty(page); ed.need.main = ed.need.ui = true;
    toast(how === 'replace' ? `ย้อนหน้านี้กลับไปเป็นสำเนาเวลา ${when(sn.t)} แล้ว (เลิกทำได้)` : `เติมเส้นที่หายกลับมา ${after.length - before.length} ชิ้นแล้ว (เลิกทำได้)`, 3500);
    dlg?.close();
  }
}

export async function openJournal(app) {
  const j = (await db.journalRead()).slice().reverse();
  const nbs = new Map((await db.getAll('notebooks')).map(n => [n.id, n]));
  const list = h('div', { class: 'reclist' });
  if (!j.length) list.append(h('p', { style: { color: 'var(--muted)', textAlign: 'center', padding: '24px 0' } }, 'ยังไม่มีบันทึกการลบเส้น'));
  const CAUSE = { user: 'ลบบนเครื่องนี้ (ยางลบ / เลิกทำ / ลบที่เลือก)', 'remote-erase': 'เครื่องอื่นลบแล้วซิงค์มา', restore: 'จากการกู้คืน' };
  for (const e of j) {
    const nb = nbs.get(e.nb); const pno = nb ? nb.pages.indexOf(e.pid) + 1 : 0;
    list.append(h('div', { class: 'item' }, h('div', { class: 'meta' }, h('b', {}, `${when(e.t)} · ${nb?.name || 'สมุด (ถูกลบแล้ว)'} หน้า ${pno || '?'}`), h('div', {}, `หาย ${e.n} ชิ้น · เหลือ ${e.left} · ${CAUSE[e.why] || e.why} · อุปกรณ์ ${e.dev || '?'}`)),
      nb && pno ? h('button', { class: 'pill sec', onclick: async () => { d.close(); await app.openNotebook(e.nb); setTimeout(() => { const ed = app.editor; if (ed) { ed.scrollToPage(e.pid); openRecover(ed); } }, 600); } }, 'ไปดู / กู้คืน') : null));
  }
  const d = dialog('ประวัติเส้นที่หาย', h('div', {}, h('p', { class: 'sub', style: { margin: '0 0 10px' } }, 'ทุกครั้งที่เส้นหายไปจากหน้า ระบบจดไว้ว่าหายเพราะอะไร จากเครื่องไหน · ถ้าเจอ "เครื่องอื่นลบแล้วซิงค์มา" ทั้งที่ไม่ได้ลบ ให้ส่งภาพหน้านี้ให้ผู้พัฒนา'), list), [{ label: 'ปิด' }], { width: 760 });
}
