// เส้นคิด (Senkid) © 2026 นายศาสตราวุฒิ อาชนะชัย · โรงเรียนโซ่พิสัยพิทยาคม · สงวนลิขสิทธิ์ ดู LICENSE.md
// App shell: routing between library and editor, settings, help, onboarding, backup
import { h, icon, toast, dialog, seg, toggle, downloadBlob, pickFile, fmtBytes, uid, logoMark, brandWord, busy, shareFileDialog, $ } from './ui.js';
import { prefs, savePrefs, applyTheme } from './prefs.js';
import * as db from './db.js';
import { Library } from './library.js';
import { Editor } from './editor.js';
import { Recorder, AudioRecorder, openRecordings, canRecord, pickMime, uploadPendingRecordings } from './recorder.js';
import { Picker } from './picker.js';
import { Timeline } from './lesson.js';
import { handleWorksheetHash } from './worksheet.js';
import { STRIDE } from './render.js';
import { buildBackup, openNotebookFile, saveNotebookFile } from './files.js';
import { importPdf } from './pdfdoc.js';
import { Timer } from './timer.js';
import { Broadcast, studentMenu } from './broadcast.js';
import { UI_FONTS, applyUiFont, setUiFont, faceCss, familyOf } from './fonts.js';
import { sync, initSync, syncNow, signIn, disconnect, statusText, connected, hasFileScope, tokenOk } from './sync.js';

export const VERSION = '1.9.40';
export const DEV = { name: 'นายศาสตราวุฒิ อาชนะชัย', org: 'กลุ่มสาระการเรียนรู้คณิตศาสตร์ โรงเรียนโซ่พิสัยพิทยาคม' };

class App {
  constructor() {
    this.root = document.getElementById('app');
    this.recorder = new Recorder(this);
    this.audio = new AudioRecorder(this);
    this.timer = new Timer(this);
    this.broadcast = new Broadcast(this);
    this.picker = new Picker(this);
    this.timeline = new Timeline(this);
    this.caps = { pressure: false, tilt: false, hover: false, twist: false, coalesced: 'getCoalescedEvents' in PointerEvent.prototype, predicted: 'getPredictedEvents' in PointerEvent.prototype };
    window.addEventListener('pointermove', (e) => this.noteCaps(e), { passive: true, capture: true });
    window.addEventListener('pointerdown', (e) => this.noteCaps(e), { passive: true, capture: true });
  }
  noteCaps(e) {
    if (e.pointerType !== 'pen') return;
    const c = this.caps;
    if (e.buttons === 0) c.hover = true;
    if (e.pressure > 0 && e.pressure !== 0.5) c.pressure = true;
    if ((e.altitudeAngle && Math.abs(e.altitudeAngle - Math.PI / 2) > 0.01) || e.tiltX || e.tiltY) c.tilt = true;
    if (e.twist) c.twist = true;
  }
  async start() {
    applyTheme(); applyUiFont();
    const boot = document.getElementById('boot'); if (boot) { boot.querySelector('p').textContent = 'กำลังโหลดสมุด…'; }
    try { await db.openDB(); } catch (e) { this.root.append(h('div', { style: { padding: '40px', textAlign: 'center' } }, 'เปิดที่เก็บข้อมูลไม่ได้ (' + e.message + ') ถ้าเปิดในโหมดส่วนตัว ให้ปิดโหมดนั้นก่อน')); return; }
    try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { }
    // continue where the user left off
    const last = prefs.lastOpen && await db.get('notebooks', prefs.lastOpen).catch(() => null);
    try { if (last) await this.openNotebook(last.id); else await this.openLibrary(); }
    catch (e) { console.error(e); prefs.lastOpen = null; savePrefs(); try { await this.openLibrary(); } catch { } toast('เปิดสมุดล่าสุดไม่สำเร็จ จึงกลับมาหน้าแรก', 3500, 'warn'); }
    finally { document.getElementById('boot')?.remove(); }
    if (!prefs.onboarded) this.onboarding();
    initSync(this).catch(e => console.warn('sync init', e)).finally(() => { setTimeout(uploadPendingRecordings, 8000); window.addEventListener('online', () => setTimeout(uploadPendingRecordings, 3000)); });
    if (location.hash === '#from-app') this.receiveFromApp();
    if (/[#&]ws=/.test(location.hash)) handleWorksheetHash(this).catch(e => console.warn('worksheet', e));
    addEventListener('hashchange', () => { if (/[#&]ws=/.test(location.hash)) handleWorksheetHash(this).catch(() => { }); });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const had = !!navigator.serviceWorker.controller, t0 = performance.now();
      navigator.serviceWorker.register('sw.js').then((reg) => {
        const check = () => reg.update().catch(() => { });
        check(); // look for a new version right at launch
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        setInterval(check, 30 * 60 * 1000);
      }).catch(() => { });
      let shown = false;
      navigator.serviceWorker.addEventListener('controllerchange', async () => {
        if (!had || shown || this.updating) return; shown = true;
        // just opened the app and haven't written yet → update by itself, no button needed
        const untouched = !(this.editor && this.editor.undoStack?.length) && !this.editor?.live && !this.recorder?.active && !this.audio?.active;
        if (performance.now() - t0 < 20000 && untouched && !this.editor && !document.querySelector('.dialog')) { // only while still on the home screen: never pull a notebook out from under the teacher
          busy('กำลังอัปเดตเส้นคิดเป็นรุ่นใหม่…', 'สมุดทั้งหมดยังอยู่ครบ');
          await this.editor?.flush?.(); location.reload(); return;
        }
        const b = h('button', { class: 'pill prim', style: { height: '40px', marginLeft: '10px', pointerEvents: 'auto' } }, 'อัปเดตเลย');
        b.onclick = async () => { await this.editor?.flush?.(); location.reload(); };
        const t = h('div', { class: 'toast keep updbar' }, 'มีเส้นคิดรุ่นใหม่แล้ว', b);
        document.getElementById('toasts').append(t);
      });
    }
  }

  async openLibrary() {
    if (this.recorder.active) { toast('กำลังบันทึกคลิป…'); await this.recorder.stop(); }
    if (this.audio.active) await this.audio.stop();
    prefs.lastOpen = null; savePrefs();
    if (this.editor) { const e = this.editor; this.editor = null; await e.destroy(); }
    if (!this.library) this.library = new Library(this);
    this.root.innerHTML = '';
    await this.library.mount(this.root);
  }
  async openNotebook(id) {
    const nb = await db.get('notebooks', id); if (!nb) { toast('ไม่พบสมุด'); return; }
    // show a loading message if opening takes more than a moment
    let bz = null; const bzT = setTimeout(() => { bz = busy('กำลังเปิดสมุด…', `${nb.name} · ${nb.count || nb.pages?.length || 1} หน้า`); }, 200);
    const endBz = () => { clearTimeout(bzT); bz?.done(); bz = null; };
    let pages; try { pages = await db.pagesOf(id); } catch (e) { endBz(); throw e; }
    const byId = new Map(pages.map(p => [p.id, p]));
    nb.pages = (nb.pages || []).filter(pid => byId.has(pid));
    for (const p of pages) if (!nb.pages.includes(p.id)) nb.pages.push(p.id); // recover orphans
    if (!nb.pages.length) { const p = { id: uid(), nb: id, size: 'P', bg: 'grid', strokes: [] }; pages = [p]; nb.pages = [p.id]; await db.put('pages', p); }
    if (this.recorder.active) { toast('กำลังบันทึกคลิป…'); await this.recorder.stop(); }
    if (this.audio.active) await this.audio.stop();
    if (this.editor) { const e = this.editor; this.editor = null; await e.destroy(); }
    prefs.lastOpen = id;
    // tabs (Goodnotes-style): remember open notebooks
    prefs.tabs = (prefs.tabs || []).filter(x => x !== id); prefs.tabs.push(id); prefs.tabs = prefs.tabs.slice(-8); savePrefs();
    const all = await db.getAll('notebooks'); const names = new Map(all.map(n => [n.id, n.name]));
    prefs.tabs = prefs.tabs.filter(x => names.has(x)); this.tabNames = names;
    this.library?.destroy();
    this.root.innerHTML = '';
    this.editor = new Editor(this, nb, pages);
    try { this.editor.mount(this.root); } finally { endBz(); }
    this.broadcast.reset();
  }
  tabList() { return (prefs.tabs || []).map(id => ({ id, name: this.tabNames?.get(id) || 'สมุด' })); }
  renameTab(id, name) { this.tabNames?.set(id, name); }
  async closeTab(id) {
    const cur = this.editor?.nb.id === id;
    const i = prefs.tabs.indexOf(id);
    prefs.tabs = prefs.tabs.filter(x => x !== id); savePrefs();
    if (!cur) { this.editor?.buildToolbar(); return; }
    const next = prefs.tabs[Math.min(i, prefs.tabs.length - 1)];
    if (next) this.openNotebook(next); else this.openLibrary();
  }
  recorderClick(ed, btn) { if (this.audio.active) { toast('หยุดอัดเสียงก่อน แล้วจึงอัดคลิป'); return; } this.recorder.click(ed, btn); }
  recorderSettings(ed, btn) { if (!this.recorder.active && !this.audio.active) this.recorder.settings(ed, btn, true); }
  openRecordings(nb) { openRecordings(nb); }
  studentMenu(anchor) { if (this.editor) studentMenu(this, anchor, this.editor); }
  audioClick(ed, btn) {
    if (this.recorder.active) { toast('กำลังอัดคลิปอยู่ เสียงจะอยู่ในคลิปแล้ว'); return; }
    this.audio.click(ed, btn);
  }

  // ---------- backup ----------
  async exportNotebooks(ids) {
    if (!ids.length) { toast('ยังไม่มีสมุดให้สำรอง'); return; }
    const b = busy('กำลังเตรียมไฟล์สำรอง…', `${ids.length} เล่ม`);
    let out; try { out = await buildBackup(ids, null, (i, n) => b.set(null, `สมุดเล่มที่ ${i} จาก ${n}`, i / n)); } finally { b.done(); }
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const kind = ids.length === 1 ? 'notebook' : 'all';
    const name = `senkid-${kind}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.senkid.json`;
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    if (kind === 'all') { prefs.lastBackup = Date.now(); savePrefs(); }
    // iPad: the share sheet offers "Save to Files" → iCloud Drive. It must open straight from a tap, so ask for one more tap after the file is ready
    const f = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [f] })) {
      const r = await shareFileDialog(f, { title: 'ไฟล์สำรองพร้อมแล้ว', sub: `สมุด ${out.notebooks.length} เล่ม · กดแล้วเลือก "บันทึกไปยังไฟล์" (Save to Files) → iCloud Drive จะปลอดภัยที่สุด หรือส่งเข้า LINE/AirDrop ก็ได้`, label: `บันทึกไฟล์ (${Math.max(0.1, Math.round(blob.size / 1e5) / 10)} MB)` });
      if (r === 'shared') toast('สำรองแล้ว', 2000);
      return;
    }
    downloadBlob(blob, name);
    toast(ids.length === 1 ? `สำรอง "${out.notebooks[0]?.name}" แล้ว` : `สำรองสมุด ${out.notebooks.length} เล่มแล้ว`);
  }
  // open a notebook file from the device and continue writing in it
  async importBackup() { return this.openFile(); }
  async openFile() {
    const r = await openNotebookFile((m, s, p) => { if (!this._ob) this._ob = busy(m); this._ob.set(m, s, p); }).finally(() => { this._ob?.done(); this._ob = null; }); if (!r) return;
    if (r.pdf) return this.notebookFromPdf(r.pdf);
    if (r.id) { await this.openNotebook(r.id); toast('เปิดไฟล์แล้ว เขียนต่อได้เลย'); }
    else if (this.library && !this.editor) this.library.load();
  }
  async notebookFromPdf(file) {
    const mb = file.size ? ` · ${fmtBytes(file.size)}` : '';
    const b = busy('กำลังโหลด PDF จากเครื่อง…', file.name + mb);
    let r;
    try {
      r = await importPdf(file, (i, n, stage) => {
        if (stage === 'read') b.set('กำลังโหลด PDF จากเครื่อง…', file.name + mb);
        else if (stage === 'open') b.set('กำลังเปิด PDF…', 'ตรวจโครงสร้างไฟล์');
        else if (stage === 'store') b.set('กำลังเก็บ PDF ไว้ในแอป…', `${n} หน้า`, 1);
        else b.set('กำลังเปิด PDF…', `อ่านแล้ว ${i} จาก ${n} หน้า`, i / n);
      });
    }
    catch (e) { console.error(e); b.done(); toast('เปิด PDF ไม่ได้ (ไฟล์อาจเสียหรือมีรหัสผ่าน)', 3500, 'warn'); return; }
    b.set('กำลังสร้างสมุด…', `${r.sizes.length} หน้า`, 1);
    const id = uid();
    const pages = r.sizes.map((s, i) => ({ id: uid(), nb: id, size: s.w > s.h ? 'L' : 'P', pw: s.w, ph: s.h, bg: 'pdf', pdf: { id: r.id, n: i + 1 }, strokes: [] }));
    const nb = { id, name: r.name, folder: this.library?.folder && !['*', '~recent'].includes(this.library.folder) ? this.library.folder : '', cover: '#D64545', paper: 'white', single: true, created: Date.now(), updated: Date.now(), pages: pages.map(p => p.id), count: pages.length };
    try { await db.savePagesAndNotebook(pages, nb); await this.openNotebook(id); } finally { b.done(); }
    toast(`เปิด "${r.name}" แล้ว ${pages.length} หน้า · เขียนทับได้เลย`, 3000);
  }
  async saveNotebookToFile(nb, livePages, opts) {
    const b = busy('กำลังเตรียมไฟล์…', nb.name);
    let r; try { r = await saveNotebookFile(nb, livePages, { ...opts, onStage: () => b.done() }); } finally { b.done(); }
    if (!r) return null;
    nb.fileSavedAt = nb.updated || Date.now(); nb.fileName = r.name; await db.put('notebooks', { ...nb });
    toast(r.how === 'linked' ? `บันทึกลงไฟล์ "${r.name}" แล้ว · ต่อจากนี้จะบันทึกลงไฟล์นี้อัตโนมัติ` : r.how === 'shared' ? 'เลือก "บันทึกไปยังไฟล์" เพื่อเก็บลงเครื่อง ถ้าชื่อซ้ำให้เลือก "แทนที่"' : `ดาวน์โหลดไฟล์ "${r.name}" แล้ว`, 3600);
    return r;
  }

  // ---------- settings ----------
  sheet(title, content) {
    const close = () => s.remove();
    const back = h('button', { class: 'btn sq' }, icon('back')); back.onclick = close;
    const s = h('div', { class: 'sheet' }, h('div', { class: 'top' }, back, h('div', { class: 'h' }, title)), h('div', { class: 'body' }, content));
    document.getElementById('layer').append(s);
    return close;
  }
  async openSettings() {
    const card = (...rows) => h('div', { class: 'card' }, ...rows);
    const row = (t, right, sub) => h('div', { class: 'row' }, h('div', {}, h('div', {}, t), sub ? h('div', { class: 'sub' }, sub) : null), right);
    const refreshEd = () => { const e = this.editor; if (e) { e.applyPos(); e.buildToolbar(); e.resize(); } };
    const usage = h('span', { style: { color: 'var(--muted)' } }, '…');
    navigator.storage?.estimate?.().then(e => { usage.textContent = `${fmtBytes(e.usage)} จาก ${fmtBytes(e.quota)}`; }).catch(() => usage.textContent = '–');
    const persisted = h('span', { style: { color: 'var(--muted)' } }, '…');
    navigator.storage?.persisted?.().then(v => persisted.textContent = v ? 'ใช่' : 'ยังไม่ใช่ (ควรติดตั้งลงหน้าโฮม)').catch(() => persisted.textContent = '–');
    const c = this.caps, yes = (v, t = 'ใช้ได้') => h('span', { style: { color: v ? '#1E9E5A' : 'var(--muted)' } }, v ? t : 'ยังไม่พบ / ไม่รองรับ');
    const mime = pickMime();
    const left = h('div', {},
      h('div', { class: 'sec-t' }, 'หน้าตา'),
      card(
        row('ธีม', seg([['light', 'สว่าง'], ['dark', 'มืด'], ['auto', 'ตามระบบ']], prefs.theme, v => { prefs.theme = v; savePrefs(); applyTheme(); if (this.editor) this.editor.need.main = true; })),
        row('ฟอนต์ของแอป', (() => { const cur = UI_FONTS.find(f => f[0] === (prefs.uiFont || 'sarabun')) || UI_FONTS[0]; const b = h('button', { class: 'pill sec', style: { height: '42px', fontFamily: familyOf(cur[0]) } }, cur[1], icon('down')); b.onclick = () => this.fontPicker(b); return b; })(), 'ปุ่มและเมนู · ข้อความบนกระดาษไม่เปลี่ยน'),
        row('โหมดนักเรียน', toggle(!!prefs.studentUI, v => { prefs.studentUI = v; savePrefs(); refreshEd(); }), 'ซ่อนเครื่องมือของครู (ฉายจอ อัดเสียง จับเวลา ม่าน) ให้แถบเรียบง่าย'),
                row('ตำแหน่งแถบเครื่องมือ', seg([['top', 'บน'], ['left', 'ซ้าย'], ['right', 'ขวา'], ['bottom', 'ล่าง']], prefs.toolbarPos, v => { prefs.toolbarPos = v; savePrefs(); refreshEd(); })),
        row('แสดง 2 หน้าคู่เมื่อจอแนวนอน', toggle(prefs.twoPage, v => { prefs.twoPage = v; savePrefs(); this.editor?.relayout(true); })),
        row('ซ่อนแถบเครื่องมือ', toggle(prefs.toolbarHidden, v => { prefs.toolbarHidden = v; savePrefs(); refreshEd(); }))),
      h('div', { class: 'sec-t' }, 'การเขียน'),
      card(
        row('เขียนด้วยนิ้ว', toggle(prefs.fingerDraw, v => { prefs.fingerDraw = v; savePrefs(); }), 'สำหรับเครื่องที่ไม่มีปากกา (ใช้ 2 นิ้วเลื่อน/ซูม)'),
        row('แปลงเป็นรูปทรงอัตโนมัติ', toggle(prefs.shapeRecog, v => { prefs.shapeRecog = v; savePrefs(); this.editor?.buildToolbar(); }), 'ขีดแล้วกดค้างไว้ 0.5 วินาที'),
        row('ขีดฆ่าเพื่อลบ', toggle(prefs.scribbleErase, v => { prefs.scribbleErase = v; savePrefs(); }), 'ขีดไปมาซ้ำ ๆ ทับเส้นที่ต้องการลบ'),
        row('แสดงจุดปลายปากกาเมื่อลอย', toggle(prefs.showHover, v => { prefs.showHover = v; savePrefs(); }), 'Apple Pencil Pro / Apple Pencil 2 บน iPad M2 ขึ้นไป')),
      h('div', { class: 'sec-t' }, 'การรองรับของเครื่องนี้'),
      card(
        row('แรงกดปากกา', yes(c.pressure, 'ใช้ได้'), 'ลองเขียนด้วยปากกาสักเส้นก่อนเปิดหน้านี้'),
        row('ความเอียงปากกา', yes(c.tilt)),
        row('จุดปลายปากกาเมื่อลอย (hover)', yes(c.hover)),
        row('หมุนปากกา (Apple Pencil Pro)', yes(c.twist), 'เว็บยังรับค่าการหมุนจาก Safari ไม่ได้'),
        row('บีบปากกา (squeeze)', h('span', { style: { color: 'var(--muted)' } }, 'เว็บไม่รองรับ'), 'Apple ยังไม่เปิดให้เว็บแอปใช้'),
        row('จุดถี่ (coalesced) / คาดการณ์เส้น', h('span', { style: { color: 'var(--muted)' } }, `${c.coalesced ? 'มี' : 'ไม่มี'} / ${c.predicted ? 'มี' : 'ไม่มี'}`)),
        row('อัดเสียง + ลายมือ', yes(typeof MediaRecorder !== 'undefined', 'ได้')))
    );
    const right = h('div', {},
      h('div', { class: 'sec-t' }, 'ประสิทธิภาพ'),
      card(
        row('โหมดประหยัด', toggle(prefs.economy, v => { prefs.economy = v; savePrefs(); applyTheme(); this.editor?.resize(); }), 'ลดความละเอียดจอและเอฟเฟกต์ สำหรับเครื่องสเปกต่ำ'),
        row('ความละเอียดคลิปเริ่มต้น', seg([['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']], prefs.rec.res, v => { prefs.rec.res = v; savePrefs(); }))),
      h('div', { class: 'sec-t' }, 'ซิงก์ผ่าน Google Drive'),
      this.syncCard(),
      h('div', { class: 'sec-t' }, 'ข้อมูล (เก็บในเครื่องนี้เท่านั้น)'),
      card(
        row('พื้นที่ที่ใช้', usage),
        row('ป้องกันเบราว์เซอร์ลบข้อมูล', persisted),
        row('สำรองสมุดทั้งหมด', (() => { const b = h('button', { class: 'pill sec', style: { height: '42px' } }, icon('download'), 'ส่งออก'); b.onclick = async () => { await this.editor?.flush(); this.exportNotebooks((await db.getAll('notebooks')).map(n => n.id)); }; return b; })()),
        row('นำเข้าไฟล์สำรอง', (() => { const b = h('button', { class: 'pill sec', style: { height: '42px' } }, icon('upload'), 'นำเข้า'); b.onclick = () => this.importBackup(); return b; })()),
        row('คลิปที่อัดไว้', (() => { const b = h('button', { class: 'pill sec', style: { height: '42px' } }, icon('film'), 'เปิด'); b.onclick = () => openRecordings(); return b; })())),
      h('div', { class: 'sec-t' }, 'ความช่วยเหลือ'),
      card(
        row('ตรวจความพร้อมก่อนสอน', (() => { const b = h('button', { class: 'pill prim', style: { height: '42px' } }, icon('check'), 'ตรวจ'); b.onclick = () => this.healthCheck(); return b; })(), 'เช็ก Google · ซิงก์ · พื้นที่ · ไมค์ · ทีวี ในหน้าเดียว'),
        row('วิธีติดตั้งและใช้งาน', (() => { const b = h('button', { class: 'btn sq' }, icon('chev')); b.onclick = () => this.openHelp(); return b; })()),
        row('ดูหน้าแนะนำอีกครั้ง', (() => { const b = h('button', { class: 'btn sq' }, icon('chev')); b.onclick = () => this.onboarding(); return b; })()),
        row('เวอร์ชัน', h('span', { style: { color: 'var(--muted)' } }, VERSION + ' · ทำงานออฟไลน์ได้')),
        row('ตรวจหาอัปเดต', (() => { const b = h('button', { class: 'pill sec', style: { height: '42px' } }, icon('download'), 'อัปเดต'); b.onclick = () => this.checkUpdate(b); return b; })()),
        row('ผู้พัฒนา', h('span', { style: { color: 'var(--muted)', textAlign: 'right' } }, DEV.name, h('br'), h('small', {}, DEV.org))))
    );
    this.sheet('ตั้งค่า', h('div', { class: 'cols' }, left, right));
  }

  // one page that says whether everything is ready for class, with a fix button beside each problem
  async healthCheck() {
    const items = [];
    const it = (ok, title, sub, fix) => items.push({ ok, title, sub, fix });
    // app version
    it(true, 'เส้นคิด ' + VERSION, this.updating ? 'กำลังอัปเดต' : 'อัปเดตล่าสุดเมื่อเปิดแอป', null);
    // Google / sync
    const tok = tokenOk(), on = connected();
    if (!on) it('warn', 'ยังไม่ได้เปิดซิงก์ Google Drive', 'สมุดอยู่ในเครื่องนี้เท่านั้น', { label: 'ตั้งค่า', fn: () => this.openSettings() });
    else if (!tok) it(false, 'การเชื่อม Google หมดอายุ', 'ซิงก์และคลิปขึ้น Drive หยุดทำงาน', { label: 'เชื่อมต่อใหม่', fn: async () => { await this.editor?.flush?.(); signIn(); } });
    else { const ago = sync.lastSync ? Math.round((Date.now() - sync.lastSync) / 60000) : null; it(ago != null && ago < 180 ? true : 'warn', 'Google Drive: ' + (sync.email || 'เชื่อมต่อแล้ว'), ago == null ? 'ยังไม่เคยซิงก์' : `ซิงก์ล่าสุด ${ago < 1 ? 'เมื่อสักครู่' : ago + ' นาทีที่แล้ว'}` + (sync.error ? ' · ' + sync.error : ''), { label: 'ซิงก์ตอนนี้', fn: () => syncNow('manual') }); }
    // storage
    try { const e = await navigator.storage?.estimate?.(); if (e) { const free = (e.quota - e.usage) / 1048576; it(free > 500 ? true : free > 150 ? 'warn' : false, `พื้นที่: ใช้ ${fmtBytes(e.usage)} จาก ${fmtBytes(e.quota)}`, free < 500 ? 'เหลือน้อย · ย้ายคลิปขึ้น Drive หรือลบคลิปเก่า' : 'เพียงพอ', free < 500 ? { label: 'คลิป', fn: () => openRecordings() } : null); } } catch { }
    // persistent storage (iPad may evict otherwise)
    try { const p = await navigator.storage?.persisted?.(); if (p != null) it(p ? true : 'warn', p ? 'ข้อมูลถูกตั้งเป็นถาวรแล้ว' : 'ข้อมูลยังไม่ได้ตั้งเป็นถาวร', p ? 'ระบบจะไม่ลบข้อมูลแอปเอง' : 'iPad อาจเคลียร์ข้อมูลเมื่อพื้นที่เต็ม', p ? null : { label: 'ตั้งถาวร', fn: async () => { const ok = await navigator.storage.persist(); toast(ok ? 'ตั้งเป็นถาวรแล้ว' : 'ระบบไม่อนุญาต (ใช้จากไอคอนบนหน้าโฮมจะได้สิทธิ์นี้)', 2500); } }); } catch { }
    // microphone
    try { const st = await navigator.permissions?.query?.({ name: 'microphone' }); if (st) it(st.state === 'granted' ? true : st.state === 'denied' ? false : 'warn', 'ไมโครโฟน: ' + ({ granted: 'อนุญาตแล้ว', denied: 'ถูกปฏิเสธ', prompt: 'จะถามเมื่อกดอัด' }[st.state] || st.state), st.state === 'denied' ? 'เปิดได้ที่ การตั้งค่า iPad > Safari > ไมโครโฟน' : '', null); } catch { it('warn', 'ไมโครโฟน: จะถามเมื่อกดอัด', '', null); }
    // TV window
    const b = this.broadcast; const paired = prefs.pairedAt && Date.now() - prefs.pairedAt < 12 * 3600e3;
    it(b?.rtc?.open || b?.connected ? true : paired ? 'warn' : 'warn', b?.rtc?.open ? 'ทีวี (จอที่สอง): เชื่อมต่ออยู่' : b?.connected ? 'หน้าจอนักเรียน: เชื่อมต่ออยู่' : paired ? 'ทีวี: ยังไม่ได้ต่อ · จะต่อเองเมื่อหน้าต่างบนทีวีเปิดอยู่' : 'ทีวี: ยังไม่ได้ตั้งค่าวันนี้', '', this.editor && !b?.rtc?.open ? { label: 'ต่อทีวี', fn: () => this.studentMenu(document.querySelector('.tb .btn') || document.body) } : null);
    // pending clips
    try { const recs = await db.getAll('recs'); const pend = recs.filter(r => r.done && !r.drive).length; if (pend) it('warn', `คลิป ${pend} รายการยังอยู่ในเครื่อง`, 'จะส่งขึ้น Drive เองเมื่อเชื่อม Google และมีเน็ต', { label: 'ดูคลิป', fn: () => openRecordings() }); } catch { }
    // online
    it(navigator.onLine ? true : 'warn', navigator.onLine ? 'อินเทอร์เน็ต: ต่ออยู่' : 'อินเทอร์เน็ต: ออฟไลน์', navigator.onLine ? '' : 'สอนได้ปกติ · ซิงก์และทีวี(จอสอง)จะทำเมื่อมีเน็ต', null);
    const list = h('div', { class: 'hc' }, ...items.map(x => h('div', { class: 'hc-row ' + (x.ok === true ? 'ok' : x.ok === 'warn' ? 'warn' : 'bad') }, h('i', {}, x.ok === true ? '✓' : x.ok === 'warn' ? '!' : '✕'), h('div', {}, h('b', {}, x.title), x.sub ? h('div', { class: 'sub' }, x.sub) : ''), x.fix ? (() => { const bb = h('button', { class: 'pill sec', style: { height: '38px', flex: 'none' } }, x.fix.label); bb.onclick = () => { close(); x.fix.fn(); }; return bb; })() : '')));
    const bad = items.filter(x => x.ok === false).length, warn = items.filter(x => x.ok === 'warn').length;
    const head = h('div', { class: 'hc-head ' + (bad ? 'bad' : warn ? 'warn' : 'ok') }, bad ? `พบ ${bad} เรื่องต้องแก้ก่อนสอน` : warn ? `พร้อมสอน · มี ${warn} ข้อควรรู้` : 'พร้อมสอน ทุกอย่างเรียบร้อย');
    const dg = dialog('ตรวจความพร้อมก่อนสอน', h('div', {}, head, list), [{ label: 'ตรวจอีกครั้ง', action: () => { setTimeout(() => this.healthCheck(), 50); } }, { label: 'ปิด', cls: 'prim' }], { width: 600 });
    const close = () => dg?.close?.();
  }
  openHelp() {
    const sec = (t, ...items) => h('div', {}, h('h3', {}, t), h('ol', {}, ...items.map(i => h('li', { html: i }))));
    const guide = h('a', { class: 'pill prim', href: new URL('help/student.html', location.href).href, target: '_blank', rel: 'noopener', style: { textDecoration: 'none', justifyContent: 'center', width: '100%', marginBottom: '14px' } }, icon('help'), 'เปิดคู่มือฉบับเต็มสำหรับนักเรียน (มีรูปประกอบ)');
    const body = h('div', { class: 'help' }, guide,
      sec('ติดตั้งบน iPad (Safari)',
        'เปิดลิงก์ของแอปใน <b>Safari</b>',
        'แตะปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น) แล้วเลือก <b>เพิ่มไปยังหน้าจอโฮม</b>',
        'เปิดแอปจากไอคอน "เส้นคิด" บนหน้าโฮม แอปจะเปิดเต็มจอและใช้แบบออฟไลน์ได้',
        '<b>สำคัญ:</b> ควรใช้จากไอคอนบนหน้าโฮมเสมอ เพราะ Safari อาจลบข้อมูลของเว็บที่ไม่ได้เปิดนาน ๆ ถ้าไม่ได้ติดตั้งไว้'),
      sec('ติดตั้งบนแท็บเล็ต Android / Chromebook (Chrome)',
        'เปิดลิงก์ใน <b>Chrome</b>',
        'Android: แตะเมนู ⋮ แล้วเลือก <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b>',
        'Chromebook / คอมพิวเตอร์: คลิกไอคอนติดตั้ง (จอที่มีลูกศร) ทางขวาของช่องที่อยู่เว็บ'),
      sec('การเขียน',
        'ปากกาใช้เขียน ส่วนนิ้วใช้เลื่อนและซูม (บีบ 2 นิ้ว) วางมือบนจอขณะเขียนได้ ไม่เป็นรอย',
        'แตะปากกาที่เลือกอยู่ซ้ำ หรือแตะสีที่เลือกอยู่ซ้ำ เพื่อเปิดแผงปรับหัวปากกา ขนาด และสี',
        'ใช้ 2 นิ้วแตะจอ = ย้อนกลับ · ใช้ 3 นิ้วแตะจอ = ทำซ้ำ',
        'ขีดเส้นแล้ว<b>กดค้างไว้ครึ่งวินาที</b> เส้นจะกลายเป็นเส้นตรง ลูกศร สามเหลี่ยม สี่เหลี่ยม วงกลม วงรี หรือรูป 5–6 เหลี่ยม จากนั้นลากจุดสีน้ำเงินเพื่อปรับรูปทรงได้',
        'เครื่องที่ไม่มีปากกา: เปิด "เขียนด้วยนิ้ว" ในเมนู ⋯'),
      sec('อัดบทเรียน (เสียง + ลายมือ)',
        'แตะปุ่ม<b>ไมค์</b> แอปจะอัดเสียงและจำลำดับทุกเส้นที่เขียน การลบ ย้าย เปลี่ยนหน้า ซูม และเลเซอร์ไปพร้อมกัน (ไฟล์เล็กมาก) แตะอีกครั้งเพื่อหยุดชั่วคราวหรือหยุด',
        'เปิดดูได้ที่ปุ่มส่งออก > เสียงที่อัดในสมุดเล่มนี้ > <b>เล่นย้อน</b> เส้นจะปรากฏตามจังหวะเสียง เลื่อนไปช่วงไหนก็ได้ ปรับความเร็วได้',
        'ต้องการไฟล์วิดีโอ: ในเครื่องเล่นกด <b>ส่งออกเป็นวิดีโอ</b> เลือกความละเอียด ได้ MP4 ไปอยู่ใน "คลิปที่อัดไว้" (ใช้เวลาเท่าความยาวจริง)',
        'กดค้างปุ่มไมค์เพื่อเลือกไมโครโฟนและตั้งค่าเก็บเสียงใน Google Drive'),
      sec('ข้อมูลและการสำรอง',
        'แอปบันทึกให้อัตโนมัติทุกครั้งที่เขียน ไม่ต้องกดบันทึก เปิดแอปครั้งต่อไปจะกลับมาที่สมุดและหน้าเดิม',
        'สมุดทั้งหมดเก็บในเครื่องนี้เท่านั้น ไม่มีระบบบัญชีและไม่ส่งข้อมูลขึ้นอินเทอร์เน็ต',
        'ควรกด <b>สำรองสมุดทั้งหมด</b> เป็นระยะ ไฟล์ที่ได้ (.senkid.json) ใช้นำเข้าในเครื่องอื่นได้'),
      sec('บันทึกเป็นไฟล์ในเครื่อง และเปิดไฟล์มาเขียนต่อ',
        'แตะปุ่ม<b>บันทึก</b> (รูปแผ่นดิสก์) บนแถบเครื่องมือ',
        'iPad / Android: เลือก <b>บันทึกไปยังไฟล์</b> แล้วเลือกโฟลเดอร์ เช่น iCloud Drive › เส้นคิด ถ้าชื่อไฟล์ซ้ำให้เลือก <b>แทนที่</b> เพื่อบันทึกทับไฟล์เดิม',
        'Chrome บนคอมพิวเตอร์ / Chromebook: เลือกที่เก็บครั้งแรกครั้งเดียว หลังจากนั้นแอปจะบันทึกลงไฟล์นั้นให้อัตโนมัติ (จุดสีเขียวบนปุ่ม)',
        'จุดสีเหลืองบนปุ่มบันทึก = มีส่วนที่เขียนเพิ่มแต่ยังไม่ได้บันทึกลงไฟล์',
        'เปิดไฟล์มาเขียนต่อ: ที่คลังสมุดแตะ <b>เปิดไฟล์</b> เลือกไฟล์ .senkid.json แล้วเขียนต่อได้ทันที ถ้าในแอปมีเล่มเดียวกันอยู่ แอปจะถามว่าจะใช้ฉบับไหน'),
      sec('ต่อจอนักเรียน (ทีวี/โปรเจกเตอร์) ผ่าน Stage Manager บน iPad',
        'ต่อสาย USB-C เป็น HDMI จาก iPad ไปที่ทีวีหรือโปรเจกเตอร์',
        'เปิด <b>Stage Manager</b>: ปัดลงจากมุมขวาบนเพื่อเปิดศูนย์ควบคุม แล้วแตะไอคอน Stage Manager (สี่เหลี่ยมมีจุดสามจุด) ให้เปิดอยู่',
        'เปิดเส้นคิดใน <b>Safari</b> (ไม่ใช่ไอคอนบนหน้าโฮม เพราะหน้าจอนักเรียนต้องอยู่ในเบราว์เซอร์เดียวกัน) แล้วเปิดสมุดที่จะสอน',
        'แตะปุ่ม <b>หน้าจอนักเรียน</b> (รูปจอ) บนแถบเครื่องมือ แล้วกด <b>เปิดหน้าจอนักเรียน</b> จะได้หน้าต่าง Safari ใหม่',
        'ลากหน้าต่างใหม่นั้นไปที่จอทีวี (ลากจากแถบด้านบนของหน้าต่างไปทางขอบจอ หรือแตะ ••• ด้านบนหน้าต่าง แล้วเลือก "ย้ายไปที่จอแสดงผล")',
        'แตะหน้าจอนักเรียนหนึ่งครั้ง แล้วกด <b>เต็มจอ</b> นักเรียนจะเห็นแค่กระดาษ เลเซอร์ และนาฬิกา ส่วนครูเขียนบน iPad ตามปกติ',
        'ถ้าสะท้อนจอแบบไร้สาย (AirPlay) ให้ใช้ <b>โหมดนำเสนอ</b> ในเมนูเดียวกัน เพื่อซ่อนเครื่องมือทั้งหมด'),
      sec('เครื่องมือเสริม',
        '<b>บ่วงบาศ</b>: วาดวงล้อมสิ่งที่จะเลือก ลากเพื่อย้าย ลากมุมเพื่อย่อขยาย ลากจุดด้านบนเพื่อหมุน เปลี่ยนสี ทำสำเนา หรือลบได้',
        '<b>กล่องข้อความ</b>: แตะบนกระดาษแล้วพิมพ์ กดค้างที่ข้อความเพื่อแก้ไข',
        '<b>เลเซอร์</b>: ลากเพื่อชี้ เส้นจางหายเอง แสดงในหน้าจอนักเรียนและในคลิป',
        '<b>นาฬิกาจับเวลา</b>: ปุ่มนาฬิกาบนแถบเครื่องมือ มีเวลาด่วน 1–20 นาที ตั้งเองและบันทึกได้ แสดงแบบลอยหรือเต็มจอ เปลี่ยนสีเมื่อใกล้หมดเวลา และมีเสียงเตือน'),
      sec('PDF',
        'เปิด PDF เป็นสมุดใหม่: ที่คลังสมุดแตะ <b>เปิดไฟล์ / PDF</b> แอปจะโหลดเฉพาะหน้าที่กำลังดู เปิดไฟล์หลายร้อยหน้าได้ไม่ค้าง',
        'แทรก PDF ในสมุดเดิม: ปุ่มเพิ่มหน้า > แทรกไฟล์ PDF ต่อจากหน้านี้',
        'ส่งออก PDF: ปุ่มส่งออก > ส่งออกเป็น PDF เลือกได้ทั้งหมด หน้าปัจจุบัน ช่วงหน้า หรือหลายช่วง เช่น 1-5, 8, 10-12 ลายมือเป็นเวกเตอร์ ซูมแล้วยังคม'));
    this.sheet('วิธีใช้', body);
  }

  // manual update: ask the server for a new version; if there is one, install it and reload
  syncCard() {
    const row = (label, ctl, sub) => h('div', { class: 'row' }, h('div', {}, h('div', {}, label), sub ? h('div', { class: 'sub' }, sub) : null), ctl);
    const card = h('div', { class: 'card' });
    const build = () => {
      card.innerHTML = '';
      const st = h('span', { style: { color: sync.state === 'error' || sync.state === 'auth' ? '#D64545' : 'var(--muted)' } }, statusText());
      if (!connected()) {
        const b = h('button', { class: 'pill prim', style: { height: '42px' } }, icon('cloud'), 'เชื่อม Google Drive');
        b.onclick = () => signIn();
        card.append(row('สถานะ', st, 'สมุดทุกเล่มจะเก็บสำเนาไว้ในโฟลเดอร์ลับของแอปใน Google Drive ของครู · เปิดเส้นคิดเครื่องไหน (แอปโฮม/Safari/Mac) ก็เห็นสมุดชุดเดียวกัน'), row('เริ่มใช้', b));
      } else {
        const now = h('button', { class: 'pill sec', style: { height: '42px' } }, icon('sync'), 'ซิงก์ตอนนี้'); now.onclick = () => syncNow('manual');
        const re = h('button', { class: 'pill sec', style: { height: '42px' } }, 'เชื่อมต่อใหม่'); re.onclick = () => signIn();
        const off = h('button', { class: 'pill ghost', style: { height: '42px', color: '#D64545' } }, 'เลิกซิงก์'); off.onclick = () => { disconnect(); build(); toast('เลิกซิงก์แล้ว · สมุดในเครื่องนี้และใน Drive ยังอยู่', 3000); };
        card.append(row('บัญชี', h('span', { style: { color: 'var(--muted)' } }, sync.email || prefs.sync?.email || '–')), row('สถานะ', st),
          ...(hasFileScope() ? [] : [row('เก็บคลิปใน Drive', h('span', { style: { color: '#D64545' } }, 'ต้องกด "เชื่อมต่อใหม่" เพื่ออนุญาตเพิ่ม'), 'คลิปและเสียงที่อัดจะส่งขึ้นโฟลเดอร์ เส้นคิด/คลิป ใน Drive แทนการเก็บในเครื่อง')]), row('ซิงก์ด้วยตัวเอง', now, 'ปกติซิงก์เองหลังเขียน 6 วินาที และตอนสลับแอป'), row(sync.state === 'auth' ? 'หมดอายุการเชื่อมต่อ' : 'เชื่อมต่อใหม่', re), row('เลิกซิงก์เครื่องนี้', off));
      }
      const cid = h('input', { class: 'field', type: 'text', placeholder: 'xxxx.apps.googleusercontent.com', value: prefs.sync?.clientId || '' , style: { width: '100%', height: '40px', fontSize: '16px' } });
      cid.onchange = () => { prefs.sync = { ...(prefs.sync || {}), clientId: cid.value.trim() }; savePrefs(); };
      card.append(h('details', { style: { padding: '6px 0' } }, h('summary', { class: 'sub' }, 'ขั้นสูง: Client ID ของ Google'), cid));
    };
    build(); sync.on(build);
    return card;
  }
  fontPicker(btn) {
    // previews: load the regular weight of every font just for this list
    let st = document.getElementById('uifont-prev'); if (!st) { st = document.createElement('style'); st.id = 'uifont-prev'; document.head.append(st); }
    st.textContent = UI_FONTS.map(f => faceCss(f[0], true)).join('');
    const cur = prefs.uiFont || 'sarabun', list = h('div', { class: 'fontlist' });
    let group = '', close;
    for (const [id, name, g] of UI_FONTS) {
      if (g !== group) { group = g; list.append(h('div', { class: 'fl-g' }, g)); }
      const r = h('button', { class: 'fl-row' + (id === cur ? ' on' : ''), style: { fontFamily: familyOf(id) } },
        h('div', {}, h('div', { class: 'fl-n' }, name), h('div', { class: 'fl-s' }, 'สมุดทั้งหมด · ปากกา ไฮไลต์ ยางลบ · ฉายขึ้นทีวี 123')), h('span', { class: 'ck' }, id === cur ? '✓' : ''));
      r.onclick = () => { setUiFont(id); btn.textContent = name; btn.style.fontFamily = familyOf(id); close?.(); toast('เปลี่ยนฟอนต์เป็น ' + name, 1500); };
      list.append(r);
    }
    close = dialog('ฟอนต์ของแอป', list, [{ label: 'ปิด', action: () => { } }], { width: 520 }).close;
  }
  async checkUpdate(btn) {
    if (!('serviceWorker' in navigator)) { location.reload(); return; }
    if (!navigator.onLine) { toast('ต้องต่ออินเทอร์เน็ตก่อนจึงจะตรวจหาอัปเดตได้', 3000, 'warn'); return; }
    const bz = busy('กำลังตรวจหาอัปเดต…', 'รุ่นที่ใช้อยู่ ' + VERSION);
    try {
      // what is on the server right now?
      let latest = null;
      try { const t = await (await fetch('sw.js?fresh=' + Date.now(), { cache: 'no-store' })).text(); latest = (t.match(/senkid-([\d.]+)-/) || [])[1] || null; } catch { }
      if (latest && latest === VERSION) { bz.done(); toast('ใช้รุ่นล่าสุดอยู่แล้ว (' + VERSION + ')', 2600); return; }
      await this.editor?.flush?.();
      this.updating = true;
      bz.set('กำลังดาวน์โหลดรุ่นใหม่…', (latest ? 'รุ่น ' + latest + ' · ' : '') + 'อีกสักครู่แอปจะเปิดใหม่เอง');
      const reg = await navigator.serviceWorker.getRegistration();
      let ok = false;
      if (reg) {
        try { await reg.update(); } catch { }
        const w = reg.installing || reg.waiting;
        if (w) ok = await new Promise((res) => { if (w.state === 'activated') return res(true); w.addEventListener('statechange', () => { if (w.state === 'activated') res(true); else if (w.state === 'redundant') res(false); }); setTimeout(() => res(false), 25000); });
      }
      if (!ok) { // stuck: drop the offline copy and load fresh (notebooks are kept — they live in a separate store)
        bz.set('กำลังล้างไฟล์แอปเก่าแล้วโหลดใหม่…', 'สมุดทั้งหมดยังอยู่ครบ');
        for (const k of await caches.keys()) if (k.startsWith('senkid-')) await caches.delete(k);
        try { await reg?.unregister(); } catch { }
      }
      location.reload();
    } catch (e) { bz.done(); toast('ตรวจหาอัปเดตไม่สำเร็จ: ' + (e.message || e), 3500, 'warn'); }
  }

  // Safari opened from the home-screen app's "send to Safari": pick the file that was just saved
  receiveFromApp() {
    history.replaceState(null, '', location.pathname + location.search);
    prefs.onboarded = true; savePrefs(); document.querySelector('.onb')?.remove();
    const body = h('div', {}, h('p', { style: { margin: '0 0 6px', fontSize: '22px' } }, 'เลือกไฟล์สมุดที่เพิ่งบันทึกจากแอปบนหน้าจอโฮม'), h('p', { class: 'sub', style: { margin: 0 } }, 'ถ้าเคยส่งเล่มนี้มาแล้ว ให้เลือก "ใช้ฉบับในไฟล์" เพื่ออัปเดตเป็นฉบับล่าสุด · สมุดใน Safari อาจถูกลบถ้าไม่ได้เปิดเกิน 7 วัน'));
    dialog('รับสมุดจากแอป', body, [{ label: 'ไว้ทีหลัง' }, { label: 'เลือกไฟล์', cls: 'prim', icon: 'folder', flex: 2, action: () => { this.openFile(); } }], { width: 520 });
  }

  // ---------- onboarding ----------
  onboarding() {
    const slides = [
      ['ปากกาเขียน · นิ้วเลื่อนและซูม', 'วางมือบนจอขณะเขียนได้ ไม่เป็นรอย ถ้าเครื่องไม่มีปากกา เปิด "เขียนด้วยนิ้ว" ในเมนู ⋯ ได้', 'write'],
      ['แตะปากกาซ้ำ เพื่อปรับขนาดและสี', 'มีปากกา 9 แบบ แต่ละหัวจำขนาดไว้แยกกัน เพิ่มสีที่ใช้บ่อยได้ไม่จำกัด', 'pens'],
      ['อัดเสียง + ลายมือ แล้วเล่นย้อนได้', 'กดปุ่มไมค์เพื่ออัดเสียงพร้อมทุกเส้นที่เขียน เล่นย้อนดูหรือส่งออกเป็นวิดีโอได้ภายหลัง', 'rec'],
      ['ขีดแล้วกดค้าง = รูปทรงสวย', 'ขีดเส้นแล้วกดค้างไว้ครึ่งวินาที เส้นจะกลายเป็นเส้นตรง วงกลม หรือสามเหลี่ยมที่สมบูรณ์', 'shape'],
    ];
    let i = 0;
    const el = h('div', { class: 'onb' });
    const done = () => { prefs.onboarded = true; savePrefs(); el.remove(); };
    const render = () => {
      el.innerHTML = '';
      const [t, p, art] = slides[i];
      const skip = h('button', { class: 'skip' }, 'ข้าม'); skip.onclick = done;
      const artEl = h('div', { class: 'art', html: ART[art] });
      const dots = h('div', { class: 'dots' }, ...slides.map((_, j) => h('i', { class: j === i ? 'on' : '' })));
      const next = h('button', { class: 'pill prim' }, i === slides.length - 1 ? 'เริ่มใช้งาน' : 'ถัดไป', i === slides.length - 1 ? null : icon('chev'));
      next.onclick = () => { if (i === slides.length - 1) done(); else { i++; render(); } };
      const prev = h('button', { class: 'pill ghost', style: { visibility: i ? 'visible' : 'hidden' } }, 'ก่อนหน้า'); prev.onclick = () => { i--; render(); };
      const head = i === 0 ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '22px' } }, logoMark(56), brandWord(44)) : null;
      el.append(skip, head || '', artEl, h('h2', {}, t), h('p', {}, p), h('div', { class: 'nav' }, prev, dots, next), h('div', { class: 'onb-dev' }, `พัฒนาโดย ${DEV.name} · ${DEV.org}`));
    };
    render();
    document.getElementById('layer').append(el);
  }
}

const ART = {
  write: `<svg viewBox="0 0 400 300" width="100%" height="100%"><defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="1.3" fill="#D5CEBF"/></pattern></defs><rect width="400" height="300" fill="#FFFDF8"/><rect width="400" height="300" fill="url(#g)"/><path d="M60 200 Q 150 40 230 160 T 340 120" stroke="#2F5BEA" stroke-width="5" fill="none" stroke-linecap="round"/><g transform="translate(300 150) rotate(35)"><rect x="-9" y="-150" width="18" height="140" rx="9" fill="#ECECEF" stroke="#C9C9CF"/><path d="M-9 -10 L0 12 L9 -10 Z" fill="#888"/></g><path d="M40 270 C 40 230, 70 215, 90 225 L 120 240" stroke="#4A4E57" stroke-width="3" fill="none" stroke-linecap="round" opacity=".5"/></svg>`,
  pens: `<svg viewBox="0 0 400 300" width="100%" height="100%"><rect width="400" height="300" fill="#FFFDF8"/><g stroke-linecap="round" fill="none"><path d="M40 60 C 120 20, 200 100, 360 50" stroke="#1E2A55" stroke-width="3"/><path d="M40 110 C 120 70, 200 150, 360 100" stroke="#2F5BEA" stroke-width="7"/><path d="M40 160 C 120 120, 200 200, 360 150" stroke="#D64545" stroke-width="4" stroke-dasharray="14 10"/><path d="M40 210 C 120 170, 200 250, 360 200" stroke="#1E9E5A" stroke-width="5" stroke-dasharray="0.1 12"/><path d="M40 255 H 360" stroke="#F5B83D" stroke-width="22" opacity=".45" stroke-linecap="butt"/></g></svg>`,
  rec: `<svg viewBox="0 0 400 300" width="100%" height="100%"><rect width="400" height="300" fill="#F4F2ED"/><rect x="0" y="0" width="400" height="34" fill="#fff"/><rect x="290" y="7" width="94" height="20" rx="10" fill="#E5484D"/><circle cx="304" cy="17" r="4" fill="#fff"/><rect x="95" y="50" width="210" height="236" fill="#FFFDF8" stroke="#E5484D" stroke-width="5"/><path d="M130 220 Q 200 80 270 220" stroke="#2F5BEA" stroke-width="4" fill="none"/><path d="M120 200 H 285 M200 90 V 270" stroke="#1E2A55" stroke-width="2"/></svg>`,
  shape: `<svg viewBox="0 0 400 300" width="100%" height="100%"><rect width="400" height="300" fill="#FFFDF8"/><path d="M60 230 C 62 170, 58 120, 64 70 C 100 110, 140 160, 190 228 C 150 232, 100 226, 60 230" stroke="#1E2A55" stroke-width="3" fill="none" opacity=".35"/><path d="M215 150 h 20 l -8 -8 m 8 8 l -8 8" stroke="#7A7E87" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M260 230 V 70 L 360 230 Z" stroke="#2F5BEA" stroke-width="4" fill="none" stroke-linejoin="round"/><path d="M260 212 h 18 v 18" stroke="#2F5BEA" stroke-width="2" fill="none"/><circle cx="260" cy="70" r="8" fill="#fff" stroke="#2F5BEA" stroke-width="3"/><circle cx="260" cy="230" r="8" fill="#fff" stroke="#2F5BEA" stroke-width="3"/><circle cx="360" cy="230" r="8" fill="#fff" stroke="#2F5BEA" stroke-width="3"/></svg>`,
};

window.addEventListener('error', (e) => { console.error(e.error || e.message); });
const app = new App();
window.senkid = app;
app.start();
