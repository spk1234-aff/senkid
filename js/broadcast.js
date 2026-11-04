// Teacher side of the student screen: sends pages, view, live ink, laser and timer over BroadcastChannel (no internet)
import { h, icon, toast, popover, seg, dialog, busy, downloadBlob } from './ui.js';
import { buildBackup, fileNameFor } from './files.js';
import { prefs, savePrefs } from './prefs.js';
import { connected as syncOn } from './sync.js';
import { serializePage } from './editor.js';
import { RtcLink, teacherPair, canPair } from './pair.js';

export class Broadcast {
  constructor(app) {
    this.app = app; this.lastAlive = -1e9; this.pending = new Map();
    this.mode = prefs.studentMode || 'follow';
    try { this.ch = new BroadcastChannel('senkid-live'); } catch { this.ch = null; }
    if (this.ch) this.ch.onmessage = (e) => this.onMsg(e.data);
    this.rtc = new RtcLink({ onMsg: (m) => this.onMsg(m, true), onState: (v) => { if (v) { this.lastView = null; this.lastTools = null; toast('เชื่อมหน้าต่าง Safari แล้ว', 1800); } else if (this.rtcWas) toast('หน้าต่าง Safari หลุดการเชื่อมต่อ', 2500, 'warn'); this.rtcWas = v; this.app.editor?.buildToolbar(); } });
    app.timer.onChange((st) => this.post({ type: 'timer', st }));
  }
  get connected() { return performance.now() - this.lastAlive < 4500; }
  post(m) { if (!this.connected) return; try { this.ch && this.ch.postMessage(m); } catch (e) { console.warn(e); } if (this.rtc.open) this.rtc.send(m); }
  onMsg(m, viaRtc) {
    if (!m) return;
    if (m.type === 'alive' || m.type === 'hello') {
      const was = this.connected; this.lastAlive = performance.now();
      try { if (viaRtc) this.rtc.send({ type: 'ack' }); else this.ch.postMessage({ type: 'ack' }); } catch { } // keeps the student screen from showing "disconnected" while the teacher is idle
      if (m.type === 'hello' || !was) { this.lastView = null; this.lastTools = null; this.sendMeta(); this.app.editor?.buildToolbar(); if (m.type === 'hello') { toast('หน้าจอนักเรียนเชื่อมต่อแล้ว', 1800); if (!prefs.secondScreenOk) { prefs.secondScreenOk = true; savePrefs(); } } }
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
    if (!this.connected) return;
    // view
    const [x0, y0] = ed.toWorld(0, 0), [x1, y1] = ed.toWorld(ed.W, ed.H);
    const cur = ed.currentPage();
    const key = [x0, y0, x1, y1].map(v => v.toFixed(1)).join(',') + cur?.id + this.mode + ed.nb.pages.length + ed.cols + (ed.curtain ? ed.curtain.pid + ':' + ed.curtain.y.toFixed(1) : '');
    if (key !== this.lastView) {
      this.lastView = key;
      const vis = []; const rects = {};
      for (const p of ed.pages) { const r = ed.rects.get(p.id); if (!r) continue; const pad = 200; if (r.x > x1 + pad || r.x + r.w < x0 - pad || r.y > y1 + pad || r.y + r.h < y0 - pad) continue; vis.push(p.id); rects[p.id] = r; }
      if (cur && !rects[cur.id]) { rects[cur.id] = ed.rects.get(cur.id); vis.push(cur.id); }
      this.post({ type: 'view', nb: ed.nb.id, world: [x0, y0, x1, y1], vis, rects, cur: cur?.id, mode: this.mode, paper: ed.paper, curtain: ed.curtain ? { ...ed.curtain } : null });
    }
    // floating tools the class should see: ruler, protractor, calculator display
    const tools = { ...ed.toolsState(), calc: window.__senkidCalc?.() || null }, tk = JSON.stringify(tools);
    if (tk !== this.lastTools) { this.lastTools = tk; this.post({ type: 'tools', ...tools }); }
    // live stroke
    const L = ed.live;
    if (L) { const s = ed.liveStroke(true); this.post({ type: 'live', pid: L.page.id, s: s.shape ? { ...s } : { ...s, pts: s.pts } }); this.hadLive = true; }
    else if (this.hadLive) { this.hadLive = false; this.post({ type: 'live', s: null }); }
    // laser (world coords + age)
    if (ed.laser.length) { this.post({ type: 'laser', pts: ed.laserWorld(), head: !!ed.lasering, opt: prefs.laser }); this.hadLaser = true; }
    else if (this.hadLaser) { this.hadLaser = false; this.post({ type: 'laser', pts: [] }); }
  }
  setMode(m) { this.mode = m; prefs.studentMode = m; savePrefs(); this.lastView = null; this.lastTools = null; }
}

let studentWin = null;
let pairing = false;
async function startPairing(b, openSafari = true) {
  if (pairing) return; pairing = true;
  const bz = busy('กำลังเตรียมจับคู่กับ Safari…');
  try {
    const url = new URL('student.html#pair', location.href).href;
    const p = teacherPair(b.rtc, { onStatus: (st) => { if (st === 'offer') { bz.done(); if (openSafari) { location.href = 'x-safari-' + url; toast('เปิด Safari แล้ว · กลับมาที่แอปนี้เมื่อหน้าจอนักเรียนขึ้น', 6000); } else toast('กำลังรอหน้าต่าง Safari บนทีวีตอบรับ…', 4000); } } });
    const ok = await p;
    if (!ok) toast('จับคู่กับ Safari ไม่สำเร็จ (หมดเวลา) · ลองใหม่อีกครั้ง', 4000, 'warn');
  } catch (e) { console.warn('pair', e); toast('จับคู่ไม่สำเร็จ: ' + (e.message || e), 4000, 'warn'); }
  finally { bz.done(); pairing = false; }
}
export const isHomeApp = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const APP_URL = () => new URL('./', location.href).href;

// Home-screen app and Safari keep separate storage on iPad: move a notebook across with a file.
export function transferDialog(ed, to, { all = false } = {}) {
  const toSafari = to === 'safari';
  let file = null;
  const step = (n, t, sub, btn) => h('div', { class: 'scr-step' }, h('span', { class: 'n' }, String(n)), h('div', { style: { flex: 1 } }, h('b', {}, t), sub ? h('div', { class: 'sub' }, sub) : '', btn || ''));
  const saveBtn = h('button', { class: 'pill prim', style: { marginTop: '8px', height: '44px' } }, icon('save'), 'กำลังเตรียมไฟล์…'); saveBtn.disabled = true;
  const openBtn = h('button', { class: 'pill sec', style: { marginTop: '8px', height: '44px' } }, icon(toSafari ? 'screen' : 'home'), toSafari ? 'เปิด Safari' : 'วิธีเปิดในแอป');
  const copyBtn = h('button', { class: 'pill ghost', style: { marginTop: '8px', height: '44px' } }, 'คัดลอกลิงก์');
  const body = h('div', {},
    h('p', { class: 'sub', style: { margin: '0 0 8px' } }, all ? (toSafari ? 'แอปบนหน้าจอโฮมกับ Safari เก็บข้อมูลแยกกัน (เป็นข้อจำกัดของ iPad) จึงย้ายสมุดทุกเล่มผ่านไฟล์เดียว · เล่มที่มีอยู่แล้วจะอัปเดตเป็นฉบับใหม่กว่าให้เอง' : 'ส่งสมุดทุกเล่มที่เขียนใน Safari กลับไปเก็บในแอปบนหน้าจอโฮม · เล่มที่มีอยู่แล้วจะอัปเดตเป็นฉบับใหม่กว่าให้เอง (Safari อาจลบข้อมูลถ้าไม่ได้เปิด 7 วัน)')
      : toSafari ? 'แอปบนหน้าจอโฮมกับ Safari เก็บสมุดแยกกัน จึงต้องส่งสมุดเป็นไฟล์ (ครั้งต่อไปเลือก "ใช้ฉบับในไฟล์" เพื่ออัปเดต)' : 'ส่งสมุดที่เขียนใน Safari กลับไปเก็บในแอปบนหน้าจอโฮม ซึ่งปลอดภัยกว่า (Safari อาจลบข้อมูลถ้าไม่ได้ใช้ 7 วัน)'),
    step(1, all ? 'บันทึกสมุดทั้งหมดเป็นไฟล์' : 'บันทึกสมุดเป็นไฟล์', 'กดแล้วเลือก "บันทึกไปยังไฟล์" (Save to Files) เก็บไว้ที่ไหนก็ได้ เช่น บน iPad ของฉัน', saveBtn),
    toSafari ? step(2, 'เปิดเส้นคิดใน Safari', 'ถ้าปุ่มไม่พาไป Safari ให้คัดลอกลิงก์ไปวางใน Safari เอง', h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, openBtn, copyBtn))
      : step(2, 'เปิดแอปเส้นคิดจากหน้าจอโฮม', 'ปัดกลับไปหน้าจอโฮม แล้วแตะไอคอนเส้นคิด'),
    step(3, 'กด "เปิดไฟล์ / PDF" แล้วเลือกไฟล์ที่บันทึก', all ? 'สมุดทุกเล่มจะเข้ามาเอง เล่มที่ซ้ำจะเก็บฉบับที่ใหม่กว่า ไม่ต้องตอบคำถามทีละเล่ม' : 'ถ้าเคยส่งสมุดเล่มนี้มาก่อน ให้เลือก "ใช้ฉบับในไฟล์" สมุดจะอัปเดตเป็นฉบับล่าสุด'));
  dialog(all ? (toSafari ? 'ย้ายสมุดทั้งหมดไปสอนใน Safari' : 'ส่งสมุดทั้งหมดกลับแอปบนหน้าจอโฮม') : toSafari ? 'ส่งสมุดไปฉายใน Safari' : 'ส่งสมุดกลับไปแอปบนหน้าจอโฮม', body, [{ label: 'ปิด' }], { width: 600 });
  (async () => {
    try {
      await ed?.flush();
      let data;
      if (all) {
        const { getAll } = await import('./db.js'), ids = (await getAll('notebooks')).map(n => n.id);
        data = await buildBackup(ids, ed ? { nb: ed.nb.id, pages: ed.pages } : null); data.sync = true; data.from = isHomeApp() ? 'app' : 'safari';
        const d = new Date(), q = (n) => String(n).padStart(2, '0');
        file = new File([JSON.stringify(data)], `เส้นคิด-ย้ายทั้งหมด-${d.getFullYear()}${q(d.getMonth() + 1)}${q(d.getDate())}-${q(d.getHours())}${q(d.getMinutes())}.senkid.json`, { type: 'application/json' });
      } else {
        data = await buildBackup([ed.nb.id], { nb: ed.nb.id, pages: ed.pages });
        file = new File([JSON.stringify(data)], fileNameFor(ed.nb), { type: 'application/json' });
      }
      saveBtn.disabled = false; saveBtn.lastChild.textContent = 'บันทึกไฟล์ (' + Math.max(0.1, Math.round(file.size / 1e5) / 10) + ' MB)';
    } catch (e) { saveBtn.lastChild.textContent = 'เตรียมไฟล์ไม่สำเร็จ'; console.error(e); }
  })();
  // share must run straight from the tap (iPad needs a fresh user gesture)
  saveBtn.onclick = async () => {
    if (!file) return;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: all ? 'สมุดเส้นคิดทั้งหมด' : ed.nb.name }); saveBtn.lastChild.textContent = '✓ บันทึกแล้ว'; if (all) { if (!toSafari) prefs.lastSyncBack = Date.now(); prefs.lastBackup = Date.now(); savePrefs(); } return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    downloadBlob(file, 'senkid-notebook.senkid.json'); saveBtn.lastChild.textContent = '✓ ดาวน์โหลดแล้ว';
  };
  openBtn.onclick = () => {
    if (!toSafari) return;
    const url = APP_URL() + '#from-app';
    if (isIOS()) location.href = 'x-safari-' + url; // iOS 17+: open the link in Safari itself
    else window.open(url, '_blank');
  };
  copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(APP_URL()); toast('คัดลอกลิงก์แล้ว · ไปวางใน Safari'); } catch { toast(APP_URL(), 5000); } };
}

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
  toast('โหมดนำเสนอ · ลากขีดบนแถบเล็กเพื่อย้ายไปไหนก็ได้ · ˄˅ เปลี่ยนหน้า · แตะเครื่องมือซ้ำเพื่อตั้งค่า · × ออก', 5000, 'keep');
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
  // Goodnotes-style: what the audience sees
  const kind = prefs.presentKind || (b.mode === 'page' ? 'page' : 'present');
  const kinds = [
    ['screen', 'ฉายทั้งหน้าจอ', 'ผู้ชมจะเห็นสิ่งที่ผู้นำเสนอเห็น', 'screen'],
    ['present', 'ฉายหน้านำเสนอ', 'ผู้ชมจะไม่เห็นคำสั่งใช้งาน', 'hide'],
    ['page', 'ฉายเฉพาะหน้า', 'ผู้ชมจะไม่เห็นคำสั่งใช้งานและการซูม', 'pages'],
  ];
  const pk = h('div', { class: 'pkind' });
  for (const [id, t, sub, ic] of kinds) {
    const r = h('button', { class: 'pk' + (kind === id ? ' on' : '') }, icon(ic), h('div', {}, h('b', {}, t), h('div', { class: 'sub' }, sub)), h('span', { class: 'ck' }, kind === id ? '✓' : ''));
    r.onclick = () => {
      prefs.presentKind = id; savePrefs(); close();
      b.setMode(id === 'page' ? 'page' : 'follow');
      if (id === 'screen') { if (prefs.toolbarHidden) ed.exitPresent(); toast('ฉายทั้งหน้าจอ · ผู้ชมเห็นเหมือนจอครู', 2200); return; }
      if (b.connected) { toast(id === 'page' ? 'จอนักเรียนแสดงทั้งหน้าเสมอ ไม่ซูมตามครู' : 'จอนักเรียนซูม/เลื่อนตามครู ไม่เห็นเครื่องมือ', 2600); return; }
      // mirroring: the TV shows the iPad screen, so hide the tools here
      if (id === 'page') ed.fit();
      presentMode(ed);
    };
    pk.append(r);
  }
  box.append(h('div', { class: 'lbl' }, 'โหมดพรีเซนเทชั่น'), pk);
  const card = (title, sub, btn) => h('div', { class: 'scr-card' }, h('b', {}, title), h('div', { class: 'sub' }, sub), btn);
  // A: mirroring
  const pres = h('button', { class: 'pill sec' }, icon('hide'), 'ซ่อนเครื่องมือ (โหมดนำเสนอ)');
  pres.onclick = () => { close(); presentMode(ed); };
  box.append(h('div', { class: 'sub', style: { margin: '6px 2px 0' } }, 'สะท้อนจอ (AirPlay/AirServer/สายธรรมดา): ทีวีเห็นเหมือน iPad จึงซ่อนเครื่องมือบน iPad ให้แทน · ถ้าอยากให้ครูยังเห็นเครื่องมือ ใช้ "ทีวีเป็นจอที่สอง" ด้านล่าง'));
  // B: second screen
  const open = h('button', { class: 'pill ' + (twoScreens() ? 'prim' : 'sec') }, icon('screen'), b.connected ? 'เปิดหน้าต่างนักเรียนอีกครั้ง' : 'เปิดหน้าจอนักเรียน');
  open.onclick = () => { close(); if (twoScreens() === true || prefs.secondScreenOk) openStudentWindow(); else confirmSecondScreen(ed); };
  if (isHomeApp() && isIOS()) {
    // the student window only works inside Safari on iPad
    const open = h('button', { class: 'pill sec' }, icon('screen'), 'หรือเปิดเส้นคิดใน Safari แล้วสอนที่นั่น');
    open.onclick = () => { close(); ed?.flush?.(); location.href = 'x-safari-' + APP_URL(); };
    if (canPair() && syncOn()) {
      const pairBtn = h('button', { class: 'pill prim' }, icon('screen'), b.rtc.open ? 'เชื่อมต่อใหม่ (เปิด Safari)' : 'ส่งหน้าจอนักเรียนไป Safari');
      pairBtn.onclick = () => { close(); startPairing(b, true); };
      const reBtn = h('button', { class: 'pill sec' }, icon('sync'), 'ต่อกับหน้าต่าง Safari ที่เปิดค้างไว้บนทีวี'); reBtn.onclick = () => { close(); startPairing(b, false); };
      box.append(card('ทีวีเป็นจอที่สอง (เต็มจอ)', 'สอนในแอปนี้ต่อได้ · จะเปิดหน้าจอนักเรียนใน Safari ให้ แล้วลากหน้าต่างนั้นไปทีวี (ต้องเปิด Stage Manager) · ใช้เน็ตแค่ตอนจับคู่', h('div', {}, pairBtn, h('div', { class: 'tvtip' }, h('b', {}, 'ครั้งแรก: '), 'กดปุ่ม → Safari เปิดขึ้นมา → กลับมาที่แอปเส้นคิด (รอ "เชื่อมหน้าต่าง Safari แล้ว") → กดค้างจุดสีเขียวของหน้าต่าง Safari → "ย้ายไปยัง…" ทีวี · ', h('b', {}, 'ครั้งต่อไป: '), 'ปล่อยหน้าต่างนั้นไว้บนทีวี แล้วกดปุ่มด้านล่างนี้แทน ไม่ต้องสลับแอป'), reBtn, open)));
    } else box.append(card('ทีวีเป็นจอที่สอง (เต็มจอ)', syncOn() ? 'เชื่อมต่อ Google ในตั้งค่าก่อน แล้วจะส่งหน้าจอนักเรียนไป Safari จากแอปนี้ได้' : 'เปิด "ซิงก์ผ่าน Google Drive" ในตั้งค่าก่อน แล้วจะส่งหน้าจอนักเรียนไป Safari จากแอปนี้ได้', open));
  } else {
    if (isIOS()) {
      // a real link: press-and-hold gives iPad's own "Open in New Window", which skips the "move tab to new window" step
      const a = h('a', { class: 'pill prim', href: new URL('student.html', location.href).href, target: 'senkid-student', style: { textDecoration: 'none', justifyContent: 'center' } }, icon('screen'), 'เปิดหน้าจอนักเรียน');
      a.addEventListener('click', () => setTimeout(close, 50));
      box.append(card('ทีวีเป็นจอที่สอง', 'ต่อสาย + เปิด Stage Manager · นักเรียนเห็นแค่กระดาษเต็มทีวี', h('div', {}, a,
        h('div', { class: 'tvtip' }, h('b', {}, 'ทางลัด: '), 'กดค้างปุ่มนี้ → เลือก "เปิดในหน้าต่างใหม่" → แล้วกดค้างจุดสีเขียวของหน้าต่างนั้น → "ย้ายไปยัง…" ทีวี'))));
    } else box.append(card('ทีวีเป็นจอที่สอง', 'ครูเห็นเครื่องมือบน iPad · นักเรียนเห็นแค่กระดาษบนทีวี · ต้องต่อสายและเปิด Stage Manager', open));
  }
  if (b.connected) {
    if (studentWin && !studentWin.closed) { const x = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '6px' } }, 'ปิดหน้าจอนักเรียน'); x.onclick = () => { try { studentWin.close(); } catch { } close(); }; box.append(x); }
  }
  const link = new URL('student.html', location.href).href;
  const cp = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '2px', fontSize: '19px' } }, 'คัดลอกลิงก์หน้าจอนักเรียน (สำหรับคอมพิวเตอร์)');
  cp.onclick = async () => { try { await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์แล้ว'); } catch { toast(link, 5000); } };
  box.append(cp);
  const close = popover(anchor, box, ed.popOpts());
}
