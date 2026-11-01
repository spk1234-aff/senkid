// Teacher side of the student screen: sends pages, view, live ink, laser and timer over BroadcastChannel (no internet)
import { h, icon, toast, popover, seg } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import { serializePage } from './editor.js';

export class Broadcast {
  constructor(app) {
    this.app = app; this.lastAlive = 0; this.pending = new Map();
    this.mode = prefs.studentMode || 'follow';
    try { this.ch = new BroadcastChannel('senkid-live'); } catch { this.ch = null; }
    if (this.ch) this.ch.onmessage = (e) => this.onMsg(e.data);
    app.timer.onChange((st) => this.post({ type: 'timer', st }));
  }
  get connected() { return performance.now() - this.lastAlive < 4500; }
  post(m) { try { this.ch && this.connected && this.ch.postMessage(m); } catch (e) { console.warn(e); } }
  onMsg(m) {
    if (!m) return;
    if (m.type === 'alive' || m.type === 'hello') {
      const was = this.connected; this.lastAlive = performance.now();
      if (m.type === 'hello' || !was) { this.lastView = null; this.sendMeta(); this.app.editor?.buildToolbar(); if (m.type === 'hello') toast('หน้าจอนักเรียนเชื่อมต่อแล้ว', 1800); }
    } else if (m.type === 'need') {
      const ed = this.app.editor; if (!ed) return;
      for (const pid of m.pids || []) { const p = ed.pageMap.get(pid); if (p) this.post({ type: 'page', nb: ed.nb.id, page: serializePage(p) }); }
    }
  }
  sendMeta() {
    const ed = this.app.editor;
    this.post({ type: 'meta', nb: ed ? ed.nb.id : null, paper: ed ? ed.paper : 'cream', mode: this.mode });
    this.post({ type: 'timer', st: this.app.timer.state() });
  }
  reset() { this.lastView = null; if (this.connected) this.sendMeta(); }
  pageChanged(p) {
    if (!this.connected) return;
    clearTimeout(this.pending.get(p.id));
    this.pending.set(p.id, setTimeout(() => { this.pending.delete(p.id); const ed = this.app.editor; if (ed && ed.pageMap.get(p.id) === p) this.post({ type: 'page', nb: ed.nb.id, page: serializePage(p) }); }, 40));
  }
  frame(ed) {
    if (!this.ch || !this.connected) return;
    // view
    const [x0, y0] = ed.toWorld(0, 0), [x1, y1] = ed.toWorld(ed.W, ed.H);
    const cur = ed.currentPage();
    const key = [x0, y0, x1, y1].map(v => v.toFixed(1)).join(',') + cur?.id + this.mode + ed.nb.pages.length + ed.cols;
    if (key !== this.lastView) {
      this.lastView = key;
      const vis = []; const rects = {};
      for (const p of ed.pages) { const r = ed.rects.get(p.id); if (!r) continue; const pad = 200; if (r.x > x1 + pad || r.x + r.w < x0 - pad || r.y > y1 + pad || r.y + r.h < y0 - pad) continue; vis.push(p.id); rects[p.id] = r; }
      if (cur && !rects[cur.id]) { rects[cur.id] = ed.rects.get(cur.id); vis.push(cur.id); }
      this.post({ type: 'view', nb: ed.nb.id, world: [x0, y0, x1, y1], vis, rects, cur: cur?.id, mode: this.mode, paper: ed.paper });
    }
    // live stroke
    const L = ed.live;
    if (L) { const s = ed.liveStroke(true); this.post({ type: 'live', pid: L.page.id, s: s.shape ? { ...s } : { ...s, pts: s.pts } }); this.hadLive = true; }
    else if (this.hadLive) { this.hadLive = false; this.post({ type: 'live', s: null }); }
    // laser (world coords + age)
    if (ed.laser.length) { this.post({ type: 'laser', pts: ed.laserWorld(), head: !!ed.lasering, opt: prefs.laser }); this.hadLaser = true; }
    else if (this.hadLaser) { this.hadLaser = false; this.post({ type: 'laser', pts: [] }); }
  }
  setMode(m) { this.mode = m; prefs.studentMode = m; savePrefs(); this.lastView = null; }
}

export function openStudentWindow() {
  const url = new URL('student.html', location.href).href;
  const w = window.open(url, 'senkid-student', 'popup=yes,width=1280,height=800');
  if (!w) toast('เปิดหน้าต่างใหม่ไม่ได้ ให้คัดลอกลิงก์ไปเปิดในหน้าต่าง Safari ใหม่', 4000, 'warn');
  return w;
}

export function studentMenu(app, anchor, ed) {
  const b = app.broadcast;
  const box = h('div', { style: { width: 'min(430px, calc(100vw - 20px))' } });
  box.append(h('div', { class: 'row' }, h('div', {}, h('b', {}, 'หน้าจอนักเรียน'), h('div', { class: 'sub' }, 'แสดงเฉพาะกระดาษ ไม่มีเครื่องมือ ใช้กับทีวี/โปรเจกเตอร์')),
    h('span', { style: { color: b.connected ? '#1E9E5A' : 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' } }, b.connected ? '● เชื่อมต่อแล้ว' : '○ ยังไม่เปิด')));
  const open = h('button', { class: 'pill prim', style: { width: '100%', marginTop: '6px' } }, icon('screen'), 'เปิดหน้าจอนักเรียน');
  open.onclick = () => { openStudentWindow(); close(); };
  box.append(open);
  box.append(h('div', { class: 'lbl' }, 'สิ่งที่นักเรียนเห็น'), seg([['follow', 'ตามที่ครูดู (ซูม/เลื่อนตาม)'], ['page', 'ทั้งหน้าเสมอ']], b.mode, v => b.setMode(v)));
  const pres = h('button', { class: 'pill sec', style: { width: '100%', marginTop: '12px' } }, icon('hide'), 'โหมดนำเสนอ (ซ่อนเครื่องมือทั้งหมด)');
  pres.onclick = () => { close(); prefs.toolbarHidden = true; savePrefs(); ed.applyPos(); toast('สำหรับสะท้อนจอแบบไร้สาย · แตะปุ่มมุมขวาบนเพื่อแสดงเครื่องมือ', 3500); };
  box.append(pres);
  const link = new URL('student.html', location.href).href;
  const cp = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '4px' } }, 'คัดลอกลิงก์หน้าจอนักเรียน');
  cp.onclick = async () => { try { await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์แล้ว'); } catch { toast(link, 5000); } };
  box.append(cp, h('p', { style: { fontSize: '18px', color: 'var(--muted)', margin: '8px 2px 0' } }, 'บน iPad: เปิดเส้นคิดใน Safari แล้วกด "เปิดหน้าจอนักเรียน" ลากหน้าต่างใหม่ไปที่จอทีวีผ่าน Stage Manager (ดูวิธีทีละขั้นในเมนู ⋯ > วิธีใช้)'));
  const close = popover(anchor, box, ed.popOpts());
}
