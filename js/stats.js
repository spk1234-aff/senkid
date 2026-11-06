// สถิติการใช้งาน: everything is counted on this device only (nothing is sent anywhere).
import { h, icon, dialog, fmtTime } from './ui.js';
import * as db from './db.js';

const KEY = 'usage';
const day = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let started = false;
// once a minute: count a minute of writing / of TV teaching when it happened in that minute
export function startUsageClock(app) {
  if (started) return; started = true;
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const ed = app.editor, write = ed && Date.now() - (ed.lastInput || 0) < 60e3, tv = !!app.broadcast?.connected;
    if (!write && !tv) return;
    try {
      const u = (await db.get('kv', KEY))?.v || {}; const k = day(); const e = u[k] || { w: 0, tv: 0 };
      if (write) e.w++; if (tv) e.tv++; u[k] = e;
      const keys = Object.keys(u).sort(); while (keys.length > 400) delete u[keys.shift()];
      await db.putQuiet('kv', { k: KEY, v: u });
    } catch { }
  }, 60e3);
}

export async function openStats() {
  const [nbs, pages, recs, usage, kv] = await Promise.all([db.getAll('notebooks'), db.getAll('pages'), db.getAll('recs'), db.get('kv', KEY).then(r => r?.v || {}), db.getAll('kv')]);
  const live = nbs.filter(n => !n.trash);
  const strokes = pages.reduce((a, p) => a + (p.strokes?.length || 0), 0);
  const lessons = recs.filter(r => r.kind === 'audio' && r.done), videos = recs.filter(r => r.kind === 'video' && r.done);
  const lessonMin = lessons.reduce((a, r) => a + (r.duration || 0), 0);
  const projects = kv.filter(x => x.k.startsWith('proj:')).length;
  const tile = (n, label) => h('div', { class: 'st-tile' }, h('b', {}, n), h('span', {}, label));
  // last 14 days
  const days = []; for (let i = 13; i >= 0; i--) { const t = Date.now() - i * 864e5, k = day(t), e = usage[k] || { w: 0, tv: 0 }; days.push({ k, d: new Date(t), ...e }); }
  const max = Math.max(10, ...days.map(d => Math.max(d.w, d.tv)));
  const chart = h('div', { class: 'st-chart' }, ...days.map(d => h('div', { class: 'st-col', title: `${d.d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} · เขียน ${d.w} นาที · ทีวี ${d.tv} นาที` },
    h('div', { class: 'st-bars' }, h('i', { class: 'w', style: { height: (d.w / max * 100) + '%' } }), h('i', { class: 'tv', style: { height: (d.tv / max * 100) + '%' } })),
    h('span', {}, d.d.toLocaleDateString('th-TH', { day: 'numeric' })))));
  const sum14 = days.reduce((a, d) => a + d.w, 0), tv14 = days.reduce((a, d) => a + d.tv, 0), active = days.filter(d => d.w || d.tv).length;
  // lessons per month (last 6 months)
  const months = []; const now = new Date(); for (let i = 5; i >= 0; i--) { const m = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ m, n: 0, ms: 0 }); }
  for (const r of lessons) { const d = new Date(r.created); const mm = months.find(x => x.m.getFullYear() === d.getFullYear() && x.m.getMonth() === d.getMonth()); if (mm) { mm.n++; mm.ms += r.duration || 0; } }
  const mrows = h('div', { class: 'st-months' }, ...months.map(x => h('div', { class: 'st-mrow' }, h('span', {}, x.m.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })), h('div', { class: 'st-mbar' }, h('i', { style: { width: Math.min(100, x.ms / Math.max(1, ...months.map(y => y.ms)) * 100) + '%' } })), h('span', { class: 'n' }, x.n ? `${x.n} บท · ${fmtTime(x.ms)}` : '–'))));
  // busiest notebooks
  const per = new Map(); for (const p of pages) per.set(p.nb, (per.get(p.nb) || 0) + (p.strokes?.length || 0));
  const top = live.map(n => ({ n, s: per.get(n.id) || 0 })).sort((a, b) => b.s - a.s).slice(0, 5);
  const body = h('div', { class: 'stats-dlg' },
    h('div', { class: 'st-tiles' }, tile(live.length, 'สมุด'), tile(pages.length, 'หน้า'), tile(strokes.toLocaleString('th-TH'), 'เส้น/วัตถุ'), tile(lessons.length, 'บทเรียนที่อัด'), tile(fmtTime(lessonMin), 'เวลาอัดรวม'), tile(videos.length, 'วิดีโอ'), tile(projects, 'โปรเจกต์ตัดต่อ')),
    h('div', { class: 'lbl' }, `14 วันล่าสุด · ใช้ ${active} วัน · เขียน ${sum14} นาที · ต่อทีวี ${tv14} นาที`), chart,
    h('div', { class: 'st-legend' }, h('span', {}, h('i', { class: 'w' }), 'เขียน'), h('span', {}, h('i', { class: 'tv' }), 'ต่อทีวี')),
    h('div', { class: 'lbl' }, 'บทเรียนที่อัดต่อเดือน'), mrows,
    h('div', { class: 'lbl' }, 'สมุดที่เขียนมากที่สุด'), h('div', { class: 'st-top' }, ...top.map(x => h('div', {}, h('span', {}, x.n.name), h('b', {}, x.s.toLocaleString('th-TH'))))),
    h('p', { class: 'sub' }, 'นับเฉพาะในเครื่องนี้ ไม่ส่งข้อมูลไปที่ใด · เวลาเขียนเริ่มนับตั้งแต่เวอร์ชันนี้'));
  dialog('สถิติการใช้งาน', body, [{ label: 'ปิด', cls: 'prim' }], { width: 640 });
}
