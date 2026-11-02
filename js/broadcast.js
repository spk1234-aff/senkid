// Teacher side of the student screen: sends pages, view, live ink, laser and timer over BroadcastChannel (no internet)
import { h, icon, toast, popover, seg, dialog } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import { serializePage } from './editor.js';

export class Broadcast {
  constructor(app) {
    this.app = app; this.lastAlive = -1e9; this.pending = new Map();
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

let studentWin = null;
export function openStudentWindow() {
  const url = new URL('student.html', location.href).href;
  const w = window.open(url, 'senkid-student', 'popup=yes,width=1280,height=800');
  if (!w) toast('เปิดหน้าต่างใหม่ไม่ได้ ให้คัดลอกลิงก์ไปเปิดในหน้าต่าง Safari ใหม่', 5000, 'warn');
  studentWin = w;
  return w;
}
// true = 2 screens, false = 1 screen, null = browser can't tell (Safari/iPad)
const twoScreens = () => (typeof screen.isExtended === 'boolean' ? screen.isExtended : null);

function presentMode(ed) {
  prefs.toolbarHidden = true; savePrefs(); ed.applyPos();
  toast('โหมดนำเสนอ · เปลี่ยนปากกา สี ยางลบ ได้จากแถบเล็กด้านขวา · ↔ = ขยายเต็มความกว้าง · × = ออก', 5000, 'keep');
}

// step-by-step check before opening a 2nd window (iPad can't detect a TV)
function confirmSecondScreen(ed) {
  const ext = twoScreens();
  const step = (n, t, sub) => h('div', { class: 'scr-step' }, h('span', { class: 'n' }, String(n)), h('div', {}, h('b', {}, t), sub ? h('div', { class: 'sub' }, sub) : ''));
  const body = h('div', {},
    ext === false ? h('p', { class: 'scr-warn' }, 'ตอนนี้เครื่องนี้มีจอเดียว ถ้าเปิดต่อ หน้าต่างนักเรียน (จอดำ) จะขึ้นมาทับจอครู') :
      h('p', { class: 'sub', style: { margin: '0 0 8px' } }, 'หน้าต่างนักเรียนจะเป็นจอดำที่แสดงแค่กระดาษ ต้องย้ายไปไว้บนทีวี จึงต้องเตรียม 3 อย่างนี้ก่อน'),
    step(1, 'ต่อ iPad เข้าทีวีด้วยสาย USB‑C → HDMI', 'ไม่มีสาย หรือใช้ AirPlay ให้เลือก "ทีวีแสดงเหมือน iPad" แทน'),
    step(2, 'เปิด Stage Manager', 'ปัดศูนย์ควบคุมลงจากมุมขวาบน แล้วแตะไอคอนสี่เหลี่ยมซ้อนกัน ทีวีจะกลายเป็นจอที่สอง'),
    step(3, 'กด "เปิดเลย" แล้วลากหน้าต่างจอดำไปไว้บนทีวี', 'แตะมุมขวาล่างของหน้าต่างนั้นเพื่อขยายเต็มจอ'));
  dialog('ทีวีเป็นจอที่สอง', body, [
    { label: 'ใช้แบบเหมือน iPad แทน', action: () => presentMode(ed) },
    { label: 'เปิดเลย', cls: 'prim', icon: 'screen', flex: 1.3, action: () => { openStudentWindow(); } },
  ], { width: 560 });
}

export function studentMenu(app, anchor, ed) {
  const b = app.broadcast;
  const box = h('div', { class: 'scr-menu', style: { width: 'min(460px, calc(100vw - 20px))' } });
  box.append(h('div', { class: 'row' }, h('div', {}, h('b', {}, 'ฉายขึ้นทีวี / โปรเจกเตอร์'), h('div', { class: 'sub' }, 'เลือกตามวิธีที่ต่อจอ')),
    b.connected ? h('span', { style: { color: '#1E9E5A', fontWeight: 700, whiteSpace: 'nowrap' } }, '● จอนักเรียนเปิดอยู่') : ''));
  const card = (title, sub, btn) => h('div', { class: 'scr-card' }, h('b', {}, title), h('div', { class: 'sub' }, sub), btn);
  // A: mirroring
  const pres = h('button', { class: 'pill sec' }, icon('hide'), 'ซ่อนเครื่องมือ (โหมดนำเสนอ)');
  pres.onclick = () => { close(); presentMode(ed); };
  box.append(card('ทีวีแสดงเหมือน iPad', 'ง่ายที่สุด · ใช้กับสายธรรมดาหรือ AirPlay · นักเรียนเห็นจอเดียวกับครู จึงซ่อนเครื่องมือให้เหลือแต่กระดาษ', pres));
  // B: second screen
  const open = h('button', { class: 'pill ' + (twoScreens() ? 'prim' : 'sec') }, icon('screen'), b.connected ? 'เปิดหน้าต่างนักเรียนอีกครั้ง' : 'เปิดหน้าจอนักเรียน');
  open.onclick = () => { close(); if (twoScreens() === true) openStudentWindow(); else confirmSecondScreen(ed); };
  box.append(card('ทีวีเป็นจอที่สอง', 'ครูเห็นเครื่องมือบน iPad · นักเรียนเห็นแค่กระดาษบนทีวี · ต้องต่อสายและเปิด Stage Manager', open));
  if (b.connected) {
    box.append(h('div', { class: 'lbl' }, 'สิ่งที่นักเรียนเห็นบนทีวี'), seg([['follow', 'ตามที่ครูดู (ซูม/เลื่อนตาม)'], ['page', 'ทั้งหน้าเสมอ']], b.mode, v => b.setMode(v)));
    if (studentWin && !studentWin.closed) { const x = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '6px' } }, 'ปิดหน้าจอนักเรียน'); x.onclick = () => { try { studentWin.close(); } catch { } close(); }; box.append(x); }
  }
  const link = new URL('student.html', location.href).href;
  const cp = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '2px', fontSize: '19px' } }, 'คัดลอกลิงก์หน้าจอนักเรียน (สำหรับคอมพิวเตอร์)');
  cp.onclick = async () => { try { await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์แล้ว'); } catch { toast(link, 5000); } };
  box.append(cp);
  const close = popover(anchor, box, ed.popOpts());
}
