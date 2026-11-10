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
    // rebuild the toolbar when the TV comes or goes (the TV-mode button shows only while connected, by default)
    this.wasConn = false; setInterval(() => { const c = this.connected; if (c !== this.wasConn) { this.wasConn = c; if (!c) this.tvSynced = false; this.app.editor?.buildToolbar?.(); } }, 1500);
    try { this.ch = new BroadcastChannel('senkid-live'); } catch { this.ch = null; }
    if (this.ch) this.ch.onmessage = (e) => this.onMsg(e.data);
    this.rtc = new RtcLink({ onMsg: (m) => this.onMsg(m, true), onState: (v) => { if (v) { this.lastView = null; this.lastTools = null; setTv('on', 'ทีวี: เชื่อมต่อแล้ว'); } else if (this.rtcWas) { setTv('wait', 'ทีวีหลุด · กำลังต่อใหม่เอง…'); this.autoAt = 0; this.dropped = true; } this.rtcWas = v; this.app.editor?.buildToolbar(); } });
    app.timer.onChange((st) => this.post({ type: 'timer', st }));
    this.armMirror();
    // once a Safari window has been paired, keep it paired by itself: after a break, an app switch or a restart of the app,
    // publish a fresh code quietly and the window on the TV (which keeps listening) answers — no button needed
    const tryAuto = () => {
      if (this.rtc.open || pairing || document.visibilityState !== 'visible' || !navigator.onLine) return;
      const t = prefs.pairedAt || 0; if (Date.now() - t > 12 * 3600e3) return; // only on a day a TV window was set up
      if (Date.now() - (this.autoAt || 0) < ((this.autoFail || 0) >= 5 ? 60e3 : 12e3)) return; this.autoAt = Date.now(); // quick retries first, then once a minute
      import('./pair.js').then(m => { if (!m.canPair()) return; startPairing(this, false, true); });
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(tryAuto, 1500); });
    setInterval(tryAuto, 5e3); setTimeout(tryAuto, 3000);
    // hand the TV window our Google token whenever it changes, so it can re-pair without signing in
    setInterval(() => this.sendToken(), 30e3);
  }
  get connected() { return performance.now() - this.lastAlive < 4500; }
  sendToken(force) {
    if (!this.rtc.open) return;
    let t = null; try { t = JSON.parse(localStorage.getItem('senkid.gtoken') || 'null'); } catch { }
    if (!t || !(t.exp > Date.now())) return;
    if (!force && this.tokSent === t.exp) return; this.tokSent = t.exp;
    this.rtc.send({ type: 'tok', t });
  }
  post(m) { if (!this.connected) return; try { this.ch && this.ch.postMessage(m); } catch (e) { console.warn(e); } if (this.rtc.open) this.rtc.send(m); }
  onMsg(m, viaRtc) {
    if (!m) return;
    if (m.type === 'alive' || m.type === 'hello') {
      const was = this.connected; this.lastAlive = performance.now();
      try { if (viaRtc) this.rtc.send({ type: 'ack' }); else this.ch.postMessage({ type: 'ack' }); } catch { } // keeps the student screen from showing "disconnected" while the teacher is idle
      if (viaRtc) this.sendToken(m.type === 'hello');
      if (m.type === 'alive' && 'mode' in m) this.checkTv(m);
      if (m.type === 'hello' || !was) { this.lastView = null; this.lastTools = null; this.sendMeta(); this.uiWas = false; setTimeout(() => this.sendUI(), 200); this.app.editor?.buildToolbar(); if (m.type === 'hello') { toast('หน้าจอนักเรียนเชื่อมต่อแล้ว', 1800); if (!prefs.secondScreenOk) { prefs.secondScreenOk = true; savePrefs(); } } }
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
  // "ฉายทั้งหน้าจอ" on a second screen: the student page rebuilds the teacher's whole screen —
  // toolbars, menus, dialogs are sent as HTML (same stylesheet over there); the paper is drawn in the same place.
  mirrorOn() { return prefs.presentKind === 'screen' && this.connected && !!this.app.editor; }
  uiSnapshot() {
    const ed = this.app.editor; if (!ed) return null;
    const stageUI = [...ed.stage.children].filter(el => el.tagName !== 'CANVAS' && !el.dataset.nomirror).map(el => htmlOf(el)).join('');
    const layer = [...(document.getElementById('layer')?.children || [])].map(el => htmlOf(el)).join('');
    return { type: 'ui', on: true, W: innerWidth, H: innerHeight, theme: document.documentElement.dataset.theme || '', edClass: ed.el.className, tb: ed.tb.outerHTML, stageUI, layer, toasts: document.getElementById('toasts')?.innerHTML || '' };
  }
  armMirror() {
    if (this.mo) return;
    const kick = () => { if (!this.mirrorOn()) return; clearTimeout(this.uiT); this.uiT = setTimeout(() => this.sendUI(), 120); };
    this.mo = new MutationObserver(kick); this.mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    setInterval(() => { if (this.mirrorOn()) this.sendUI(); }, 2500);
  }
  sendUI() {
    if (!this.mirrorOn()) { if (this.uiWas) { this.uiWas = false; this.post({ type: 'ui', on: false }); } return; }
    const snap = this.uiSnapshot(); if (!snap) return;
    const key = snap.tb.length + ':' + snap.stageUI.length + ':' + snap.layer.length + ':' + snap.toasts.length + ':' + snap.W + 'x' + snap.H + ':' + sum(snap.stageUI) + ':' + sum(snap.layer);
    if (key === this.uiKey && this.uiWas && snap.tb === this.uiTb) return;
    this.uiKey = key; this.uiTb = snap.tb; this.uiWas = true; this.post(snap);
  }
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
    const key = [x0, y0, x1, y1].map(v => v.toFixed(1)).join(',') + cur?.id + this.mode + ed.nb.pages.length + ed.cols;
    if (key !== this.lastView) {
      this.lastView = key;
      const vis = []; const rects = {};
      for (const p of ed.pages) { const r = ed.rects.get(p.id); if (!r) continue; const pad = 200; if (r.x > x1 + pad || r.x + r.w < x0 - pad || r.y > y1 + pad || r.y + r.h < y0 - pad) continue; vis.push(p.id); rects[p.id] = r; }
      if (cur && !rects[cur.id]) { rects[cur.id] = ed.rects.get(cur.id); vis.push(cur.id); }
      this.post({ type: 'view', nb: ed.nb.id, world: [x0, y0, x1, y1], vis, rects, cur: cur?.id, mode: this.mode, paper: ed.paper });
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
  // the TV reports what it is showing every 1.5 s; anything that does not match the teacher's choice is sent again
  checkTv(m) {
    const wantUi = this.mirrorOn(), okMode = !this.app.editor || m.mode == null || m.mode === this.mode, okUi = !!m.ui === wantUi;
    if (!okMode) this.lastView = null;
    if (!okUi) { this.uiWas = !!m.ui; this.uiKey = null; this.sendUI(); }
    const synced = okMode && okUi;
    if (synced !== this.tvSynced) { this.tvSynced = synced; this.app.editor?.updateTvBtn?.(); }
  }
  setMode(m) { this.mode = m; prefs.studentMode = m; savePrefs(); this.lastView = null; this.lastTools = null; this.tvSynced = false; this.app.editor?.updateTvBtn?.(); setTimeout(() => this.sendUI(), 50); }
}

// outerHTML of a UI element with its canvases (page thumbnails, previews) turned into small images, so the TV shows
// dialogs and the page picker exactly as the teacher sees them (a bare <canvas> in HTML is blank)
const cvCache = new WeakMap();
function htmlOf(el) {
  const cvs = el.querySelectorAll('canvas'); if (!cvs.length) return el.outerHTML;
  const clone = el.cloneNode(true), ccv = clone.querySelectorAll('canvas');
  cvs.forEach((c, i) => {
    const r = c.getBoundingClientRect(); if (!c.width || !c.height || r.width === 0) { ccv[i].remove(); return; }
    let e = cvCache.get(c); const key = c.width + 'x' + c.height + ':' + (c._ver || 0);
    if (!e || e.key !== key || Date.now() - e.t > 2500) {
      try { const w = Math.min(c.width, 320), hgt = Math.round(c.height * w / c.width), t = document.createElement('canvas'); t.width = w; t.height = hgt; t.getContext('2d').drawImage(c, 0, 0, w, hgt); e = { key, t: Date.now(), url: t.toDataURL('image/jpeg', 0.6) }; cvCache.set(c, e); } catch { e = null; }
    }
    const img = document.createElement('img'); if (e) img.src = e.url; img.className = ccv[i].className; img.style.cssText = ccv[i].style.cssText; img.style.width = r.width + 'px'; img.style.height = r.height + 'px'; img.draggable = false;
    ccv[i].replaceWith(img);
  });
  return clone.outerHTML;
}
function sum(str) { let x = 0; for (let i = 0; i < str.length; i += 7) x = (x * 31 + str.charCodeAt(i)) | 0; return x; }
let studentWin = null;
let pairing = false;
// small status pill (bottom-right of the page area) so the teacher always knows what the TV link is doing
let tvPill = null, tvHideT = null;
export function setTv(state, text) {
  const stage = document.querySelector('.stage'); if (!stage) return;
  if (!tvPill || !tvPill.isConnected) { tvPill = h('div', { class: 'tvpill' }, h('i'), h('span')); stage.append(tvPill); }
  clearTimeout(tvHideT);
  tvPill.dataset.st = state; tvPill.querySelector('span').textContent = text; tvPill.classList.remove('hidden');
  if (state === 'on') tvHideT = setTimeout(() => tvPill.classList.add('mini'), 6000); else tvPill.classList.remove('mini');
  if (state === 'off') tvHideT = setTimeout(() => tvPill.classList.add('hidden'), 4000);
}
async function startPairing(b, openSafari = true, quiet = false) {
  if (pairing) return; pairing = true;
  const bz = quiet ? { done() {} } : busy('กำลังเตรียมจับคู่กับ Safari…');
  if (!quiet) setTv('wait', 'กำลังจับคู่กับ Safari…');
  try {
    await b.app.editor?.flush?.(); // iPadOS may suspend or restart this app while Safari is in front: nothing may be left unsaved
    let tokq = ''; try { const t = JSON.parse(localStorage.getItem('senkid.gtoken') || 'null'); if (t && t.exp > Date.now()) tokq = '&tok=' + encodeURIComponent(JSON.stringify(t)); } catch { }
    const url = new URL('student.html#pair' + tokq, location.href).href;
    const p = teacherPair(b.rtc, { timeoutMs: quiet ? 40e3 : 180e3, onStatus: (st) => { if (st === 'offer') { bz.done(); if (openSafari) { location.href = 'x-safari-' + url; toast('เปิด Safari แล้ว · กลับมาที่แอปนี้เมื่อหน้าจอนักเรียนขึ้น', 6000); } else if (!quiet) toast('กำลังรอหน้าต่าง Safari บนทีวีตอบรับ…', 4000); } } });
    const ok = await p;
    if (ok) { prefs.pairedAt = Date.now(); savePrefs(); b.autoFail = 0; } else { b.autoFail = (b.autoFail || 0) + 1; } if (!ok && !b.rtc.open) { if (!quiet) setTv('off', 'จับคู่ไม่สำเร็จ'); else if (b.rtcWas || b.dropped) setTv('off', 'ทีวียังไม่กลับมา · จะลองต่อใหม่เองเงียบ ๆ'); }
    if (!ok && !quiet) toast('จับคู่กับ Safari ไม่สำเร็จ (หมดเวลา) · ลองใหม่อีกครั้ง', 4000, 'warn');
  } catch (e) { console.warn('pair', e); if (!quiet) toast('จับคู่ไม่สำเร็จ: ' + (e.message || e), 4000, 'warn'); }
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

export function presentMode(ed) {
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

export const TV_KINDS = [
  ['page', 'เฉพาะกระดาษ ทั้งหน้า', 'ทีวีเห็นหน้าเต็ม ๆ ไม่ซูมตามครู', 'pages'],
  ['present', 'กระดาษ ซูมตามครู', 'ทีวีเห็นส่วนที่ครูซูม/เลื่อนอยู่', 'fit'],
  ['screen', 'ทั้งหน้าจอเหมือนครู', 'เห็นเครื่องมือและเมนูด้วย', 'screen'],
];
export const tvKind = (app) => prefs.presentKind || (app.broadcast?.mode === 'page' ? 'page' : 'present');
// choose what the TV shows (does not hide or show the iPad toolbar — that is the presentation-mode button's job)
export function setTvKind(app, id) {
  const b = app.broadcast, ed = app.editor; if (!b) return;
  prefs.presentKind = id; savePrefs();
  b.setMode(id === 'page' ? 'page' : 'follow');
  if (id === 'page') ed?.fit();
  const on = b.connected;
  toast(!on ? 'ตั้งแบบทีวีไว้แล้ว · จะมีผลเมื่อต่อทีวี' : id === 'page' ? 'ทีวีแสดงทั้งหน้า ไม่ซูมตามครู' : id === 'present' ? 'ทีวีซูม/เลื่อนตามครู ไม่เห็นเครื่องมือ' : 'ทีวีเห็นทั้งหน้าจอเหมือนครู', 2200);
  ed?.updateTvBtn?.(); ed?.buildToolbar?.();
}
export function studentMenu(app, anchor, ed) {
  const b = app.broadcast;
  const box = h('div', { class: 'scr-menu', style: { width: 'min(460px, calc(100vw - 20px))' } });
  const on = b.connected;
  // header: one line that says where things stand
  box.append(h('div', { class: 'row' }, h('div', {}, h('b', {}, 'ทีวี / โปรเจกเตอร์'), h('div', { class: 'sub' }, on ? 'ทีวีเป็นจอสองอยู่ · นักเรียนเห็นบนทีวีแล้ว' : 'ยังไม่ได้เชื่อมเป็นจอสอง')),
    h('span', { style: { color: on ? '#1E9E5A' : 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' } }, on ? '● เชื่อมแล้ว' : '○ ยังไม่เชื่อม')));
  // two tabs: how the TV is connected / what the TV shows
  let tab = on ? 'show' : 'connect';
  const tabs = seg([['connect', 'ต่อทีวี'], ['show', 'ทีวีแสดงอะไร']], tab, (v) => { tab = v; paint(); });
  tabs.style.marginTop = '8px';
  const body = h('div', {});
  box.append(tabs, body);
  const card = (title, sub, ...btns) => h('div', { class: 'scr-card' }, h('b', {}, title), sub ? h('div', { class: 'sub' }, sub) : null, ...btns);
  const paint = () => {
    body.innerHTML = '';
    if (tab === 'connect') {
      // choice 1: mirroring (cable / AirPlay) — the TV shows the iPad as is
      const pres = h('button', { class: 'pill sec' }, icon('hide'), 'ซ่อนเครื่องมือบน iPad (โหมดนำเสนอ)');
      pres.onclick = () => { close(); presentMode(ed); };
      body.append(card('แบบที่ 1 · สะท้อนจอ (สาย / AirPlay)', 'ทีวีเห็นเหมือนหน้าจอ iPad ทุกอย่าง · ง่ายสุด ไม่ต้องตั้งค่า · ถ้าไม่อยากให้นักเรียนเห็นเครื่องมือ ให้ซ่อน', pres));
      // choice 2: second screen through the Safari TV window
      if (isHomeApp() && isIOS()) {
        if (canPair() && syncOn()) {
          const pairBtn = h('button', { class: 'pill prim' }, icon('screen'), on ? 'เชื่อมใหม่ (เปิด Safari อีกครั้ง)' : 'เชื่อมทีวี (เปิด Safari ให้)');
          pairBtn.onclick = () => { close(); startPairing(b, true); };
          const reBtn = h('button', { class: 'pill sec' }, icon('sync'), 'ต่อกับหน้าต่าง Safari ที่เปิดค้างอยู่'); reBtn.onclick = () => { close(); startPairing(b, false); };
          body.append(card('แบบที่ 2 · ทีวีเป็นจอสอง (เต็มจอ)', on ? 'เชื่อมอยู่แล้ว · ครูสอนในแอปนี้ต่อได้เลย' : '1) ต่อทีวี + เปิด Stage Manager  2) กดปุ่มนี้ แอปจะเปิดหน้าทีวีใน Safari  3) ลากหน้าต่าง Safari ไปทีวี แล้วกลับมาแอปนี้ · ครั้งต่อไปต่อให้เองภายใน 12 ชม.', pairBtn, reBtn));
        } else body.append(card('แบบที่ 2 · ทีวีเป็นจอสอง (เต็มจอ)', syncOn() ? 'เชื่อมต่อ Google ในตั้งค่าก่อน แล้วปุ่มเชื่อมทีวีจะใช้ได้' : 'เปิด "ซิงก์ผ่าน Google Drive" ในตั้งค่าก่อน แล้วปุ่มเชื่อมทีวีจะใช้ได้'));
      } else {
        const open = h('button', { class: 'pill ' + (twoScreens() ? 'prim' : 'sec') }, icon('screen'), on ? 'เปิดหน้าต่างนักเรียนอีกครั้ง' : 'เปิดหน้าจอนักเรียน');
        open.onclick = () => { close(); if (twoScreens() === true || prefs.secondScreenOk) openStudentWindow(); else confirmSecondScreen(ed); };
        if (isIOS()) {
          const a = h('a', { class: 'pill prim', href: new URL('student.html', location.href).href, target: 'senkid-student', style: { textDecoration: 'none', justifyContent: 'center' } }, icon('screen'), 'เปิดหน้าจอนักเรียน');
          a.addEventListener('click', () => setTimeout(close, 50));
          body.append(card('แบบที่ 2 · ทีวีเป็นจอสอง', 'ต่อสาย + เปิด Stage Manager · นักเรียนเห็นแค่กระดาษเต็มทีวี', a, h('div', { class: 'tvtip' }, h('b', {}, 'ทางลัด: '), 'กดค้างปุ่มนี้ → "เปิดในหน้าต่างใหม่" → กดค้างจุดสีเขียวของหน้าต่างนั้น → ย้ายไปจอทีวี')));
        } else body.append(card('แบบที่ 2 · ทีวีเป็นจอสอง', 'ครูเห็นเครื่องมือบน iPad · นักเรียนเห็นแค่กระดาษบนทีวี', open));
      }
      if (on && studentWin && !studentWin.closed) { const x = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '6px' } }, 'ปิดหน้าจอนักเรียน'); x.onclick = () => { try { studentWin.close(); } catch { } close(); }; body.append(x); }
      if (on || (prefs.pairedAt && Date.now() - prefs.pairedAt < 12 * 3600e3)) {
        // stop using the TV: drop the link and stop the quiet re-pair attempts until the teacher connects again
        const stop = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '6px', color: 'var(--danger, #c0392b)' } }, icon('close'), on ? 'เลิกใช้ทีวี (ตัดการเชื่อม)' : 'เลิกใช้ทีวี (หยุดต่ออัตโนมัติ)');
        stop.onclick = () => { close(); prefs.pairedAt = 0; savePrefs(); b.dropped = false; b.rtcWas = false; try { b.rtc.close?.(); } catch { } setTv('off', 'เลิกใช้ทีวีแล้ว'); toast('เลิกใช้ทีวีแล้ว · กด "เชื่อมทีวี" เมื่อจะใช้อีก', 2500); };
        body.append(stop);
      }
      const link = new URL('student.html', location.href).href;
      const cp = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '2px', fontSize: '18px' } }, 'คัดลอกลิงก์หน้าจอนักเรียน (เปิดบนคอมพิวเตอร์)');
      cp.onclick = async () => { try { await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์แล้ว'); } catch { toast(link, 5000); } };
      body.append(cp);
    } else {
      // what the audience sees (Goodnotes-style)
      const kind = prefs.presentKind || (b.mode === 'page' ? 'page' : 'present');
      const kinds = [
        ['page', 'เฉพาะกระดาษ ทั้งหน้า', 'นักเรียนเห็นหน้าเต็ม ๆ ไม่ซูมตามครู ไม่เห็นเครื่องมือ (เหมาะกับสอนปกติ)', 'pages'],
        ['present', 'กระดาษ ซูมตามครู', 'นักเรียนเห็นส่วนที่ครูซูม/เลื่อนอยู่ ไม่เห็นเครื่องมือ', 'hide'],
        ['screen', 'ทั้งหน้าจอเหมือนครู', 'เห็นเครื่องมือ เมนู และหน้าต่างทุกอย่าง (เหมาะกับสอนวิธีใช้แอป)', 'screen'],
      ];
      const pk = h('div', { class: 'pkind' });
      for (const [id, t, sub, ic] of kinds) {
        const r = h('button', { class: 'pk' + (kind === id ? ' on' : '') }, icon(ic), h('div', {}, h('b', {}, t), h('div', { class: 'sub' }, sub)), h('span', { class: 'ck' }, kind === id ? '✓' : ''));
        r.onclick = () => { close(); setTvKind(app, id); };
        pk.append(r);
      }
      body.append(h('div', { class: 'sub', style: { margin: '6px 2px 4px' } }, on ? 'เลือกว่าทีวีจะแสดงอะไร (เปลี่ยนได้ตลอดระหว่างสอน)' : 'ใช้เมื่อทีวีเป็นจอสอง · ถ้าสะท้อนจอ ทีวีจะเห็นเหมือน iPad เสมอ'), pk);
    }
  };
  paint();
  const close = popover(anchor, box, ed.popOpts());
}
