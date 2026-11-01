// Writing screen: toolbar, view (pan/zoom), pen input, rendering, pages, history, autosave
import { h, icon, toast, popover, menu, dialog, confirmBox, toggle, seg, onLongPress, uid, ask, pickFile, busy, $, $$ } from './ui.js';
import { prefs, savePrefs, pushRecent, applyTheme, PEN_LABEL } from './prefs.js';
import { PAGE, PAPERS, STRIDE, dims, drawPaper, drawStrokes, drawStroke, strokeBB, renderPageTo, shapePolyline, setPdfQuality, measureText, drawLaserTrail } from './render.js';
import { importPdf, setPdfReadyHook, setPdfBudget, pdfBitmap } from './pdfdoc.js';
import { openExportDialog } from './exportpdf.js';
import { recognize, straighten, shapeHandles, moveHandle } from './shapes.js';
import * as db from './db.js';
import { openPenPanel, openEraserPanel } from './penpanel.js';
import { normalizeImage, openCropper, rotateBlob, setImageReadyHook } from './images.js';
import { canLinkFiles, getHandle, handlePermission, writeHandle, buildBackup } from './files.js';

const GAP = 28;
const HOLD_MS = 500;

export class Editor {
  constructor(app, nb, pages) {
    this.app = app; this.nb = nb;
    this.pageMap = new Map(pages.map(p => [p.id, p]));
    for (const p of pages) for (const s of p.strokes) if (s.pts && !(s.pts instanceof Float32Array)) s.pts = Float32Array.from(s.pts);
    this.tool = 'pen'; // pen | hl | eraser
    this.undoStack = []; this.redoStack = [];
    this.dirty = new Set(); this.deleted = new Set();
    this.z = 1; this.ox = 0; this.oy = 0; this.fitMode = true;
    this.R = 1; this.recScale = 0;
    this.pointers = new Map();
    this.live = null; this.sel = null; this.drag = null; this.erasing = null;
    this.need = { main: true, live: false, ui: false };
    this.lastHover = 0; this.penSeen = false;
    this.recorder = null;
    this.build();
  }

  get pages() { return this.nb.pages.map(id => this.pageMap.get(id)).filter(Boolean); }
  get paper() { return this.nb.paper || 'cream'; }
  get darkPaper() { return !!PAPERS[this.paper]?.dark; }

  // ---------- current tool params ----------
  cur() {
    if (this.tool === 'hl') { const c = prefs.hl; return { kind: 'hl', type: 'hl', color: c.color, alpha: c.alpha, size: c.size, presets: c.presets, cfg: c }; }
    if (this.tool === 'eraser') { const c = prefs.eraser; return { kind: 'eraser', type: 'eraser', size: c.size, presets: c.presets, cfg: c }; }
    const t = prefs.penType, c = prefs.pens[t];
    return { kind: 'pen', type: t, color: prefs.penColor, alpha: prefs.penAlpha, size: c.size, presets: c.presets, cfg: c };
  }
  setTool(t) { this.tool = t; this.deselect(); this.deselectImage(); this.clearLasso(); this.buildToolbar(); this.updateLiveBlend(); }
  setPenType(t) { if (t === 'hl') return this.setTool('hl'); prefs.penType = t; savePrefs(); this.tool = 'pen'; this.deselect(); this.buildToolbar(); this.updateLiveBlend(); }
  setSize(v) { const c = this.cur(); c.cfg.size = Math.round(Math.max(0.1, Math.min(c.kind === 'eraser' ? 120 : 50, v)) * 100) / 100; savePrefs(); this.refreshToolbarState(); }
  setColor(hex) { if (this.tool === 'hl') prefs.hl.color = hex; else { prefs.penColor = hex; if (this.tool === 'eraser') this.tool = 'pen'; } savePrefs(); this.buildToolbar(); }
  setAlpha(a) { if (this.tool === 'hl') prefs.hl.alpha = a; else prefs.penAlpha = a; savePrefs(); }

  // ---------- DOM ----------
  build() {
    this.el = h('div', { class: 'ed' });
    this.tb = h('div', { class: 'tb' });
    this.stage = h('div', { class: 'stage' });
    this.cvMain = h('canvas', { class: 'cv-main' });
    this.cvLive = h('canvas', { class: 'cv-live' });
    this.cvLaser = h('canvas', { class: 'cv-live cv-laser' });
    this.cvUI = h('canvas', { class: 'cv-ui' });
    this.hover = h('div', { class: 'hoverdot' });
    this.pageno = h('div', { class: 'pageno' });
    this.zoomInd = h('div', { class: 'zoomind' });
    this.thumbs = h('div', { class: 'thumbs' });
    this.stage.append(this.cvMain, this.cvLive, this.cvLaser, this.cvUI, this.hover, this.pageno, this.zoomInd, this.thumbs);
    this.el.append(this.tb, this.stage);
    this.ctxMain = this.cvMain.getContext('2d', { alpha: false });
    this.ctxLive = this.cvLive.getContext('2d', { desynchronized: true }) || this.cvLive.getContext('2d');
    this.ctxUI = this.cvUI.getContext('2d');
    this.ctxLaser = this.cvLaser.getContext('2d');
    this.laser = [];
    this.snap = document.createElement('canvas'); this.snapCtx = this.snap.getContext('2d', { alpha: false }); this.snapView = null;
    this.applyPos();
    this.buildToolbar();
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.stage);
    this.onKey = (e) => this.key(e); window.addEventListener('keydown', this.onKey);
    this.onVis = () => { if (document.visibilityState === 'hidden') this.flush(); };
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('pagehide', this.onVis);
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
    this.thumbTimer = setInterval(() => this.updateCover(), 30000);
    setPdfReadyHook(() => { this.need.main = true; if (this.thumbs.classList.contains('open')) { clearTimeout(this.thP); this.thP = setTimeout(() => this.refreshThumbs(), 250); } });
    setPdfQuality(prefs.economy ? 2 : 3); setPdfBudget(prefs.economy ? 40e6 : 90e6);
    setImageReadyHook(() => { this.need.main = true; if (this.thumbs.classList.contains('open')) { clearTimeout(this.thI); this.thI = setTimeout(() => { for (const v of this.thumbCache?.values() || []) v.partial = true; this.refreshThumbs(); }, 300); } });
    this.onPaste = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const f = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile();
      if (f) { e.preventDefault(); this.insertImage(f, { crop: false }); }
    };
    window.addEventListener('paste', this.onPaste);
    this.stage.addEventListener('dragover', (e) => e.preventDefault());
    this.stage.addEventListener('drop', (e) => { const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); this.insertImage(f, { crop: true }); } });
    this.imgBar = h('div', { class: 'imgbar hidden' }); this.stage.append(this.imgBar);
  }

  mount(parent) {
    parent.append(this.el); this.resize(); this.fit();
    if (this.nb.lastPage && this.nb.pages.includes(this.nb.lastPage) && this.nb.lastPage !== this.nb.pages[0]) this.scrollToPage(this.nb.lastPage);
    this.mounted = true;
    this.initFileLink();
  }

  async destroy() {
    cancelAnimationFrame(this.raf); this.raf = null;
    this.ro.disconnect(); window.removeEventListener('keydown', this.onKey); window.removeEventListener('paste', this.onPaste);
    document.removeEventListener('visibilitychange', this.onVis); window.removeEventListener('pagehide', this.onVis);
    clearInterval(this.thumbTimer);
    await this.flush(); await this.updateCover(true);
    if (this.fileLinked) await this.writeLinkedFile(true);
    this.el.remove();
  }

  applyPos() {
    this.el.dataset.pos = prefs.toolbarPos;
    this.tb.classList.toggle('hidden', !!prefs.toolbarHidden);
    $('.showtb', this.stage)?.remove();
    if (prefs.toolbarHidden) {
      const b = h('button', { class: 'showtb', title: 'แสดงแถบเครื่องมือ' }, icon('fit'));
      b.onclick = () => { prefs.toolbarHidden = false; savePrefs(); this.applyPos(); };
      this.stage.append(b);
    }
    $('.ctxbar', this.stage)?.classList.toggle('hidden', !!prefs.toolbarHidden); $('.undocap', this.stage)?.classList.toggle('hidden', !!prefs.toolbarHidden);
    this.updateRecFloat();
  }
  get vertical() { return prefs.toolbarPos === 'left' || prefs.toolbarPos === 'right'; }
  popOpts() { return { place: this.vertical ? 'side' : 'auto' }; }

  buildToolbar() {
    this.tb.classList.toggle('tb2', prefs.toolbarPos === 'top');
    $('.ctxbar', this.stage)?.remove(); $('.undocap', this.stage)?.remove();
    if (prefs.toolbarPos === 'top') return this.buildTopBar();
    const tb = this.tb; tb.innerHTML = '';
    const B = (ic, title, fn, on) => { const b = h('button', { class: 'btn sq' + (on ? ' on' : ''), title, 'aria-label': title }, icon(ic)); b.addEventListener('click', (e) => fn(b, e)); return b; };
    const sep = () => h('div', { class: 'sep' });
    const g1 = h('div', { class: 'grp' },
      B('lib', 'คลังสมุด', () => this.app.openLibrary()),
      this.btnPages = B('pages', 'ภาพย่อหน้า', () => this.toggleThumbs(), this.thumbs.classList.contains('open')),
      this.btnUndo = B('undo', 'ย้อนกลับ', () => this.undo()),
      this.btnRedo = B('redo', 'ทำซ้ำ', () => this.redo()));
    const t = this.tool;
    const penBtn = B(prefs.penType, 'ปากกา: ' + PEN_LABEL[prefs.penType], (b) => { if (this.tool === 'pen') openPenPanel(b, this, this.popOpts()); else this.setTool('pen'); }, t === 'pen');
    const hlBtn = B('hl', 'ไฮไลต์', (b) => { if (this.tool === 'hl') openPenPanel(b, this, this.popOpts()); else this.setTool('hl'); }, t === 'hl');
    const erBtn = B('eraser', 'ยางลบ', (b) => { if (this.tool === 'eraser') openEraserPanel(b, this, this.popOpts()); else this.setTool('eraser'); }, t === 'eraser');
    const shBtn = B('shape', 'แปลงเป็นรูปทรงอัตโนมัติ (ขีดแล้วกดค้าง)', () => { prefs.shapeRecog = !prefs.shapeRecog; savePrefs(); shBtn.classList.toggle('on', prefs.shapeRecog); toast(prefs.shapeRecog ? 'เปิดแปลงรูปทรง: ขีดแล้วกดค้างไว้ครึ่งวินาที' : 'ปิดแปลงรูปทรงแล้ว'); }, prefs.shapeRecog);
    const g2 = h('div', { class: 'grp' }, penBtn, hlBtn, erBtn, B('lasso', 'บ่วงบาศ', () => this.setTool('lasso'), t === 'lasso'), shBtn, B('image', 'แทรกรูปภาพ', () => this.pickImage()), B('text', 'กล่องข้อความ', () => this.setTool('text'), t === 'text'), B('laser', 'เลเซอร์พอยเตอร์', () => this.setTool('laser'), t === 'laser'), B('timer', 'นาฬิกาจับเวลา', (b) => this.app.timer.panel(b)), B('screen', 'หน้าจอนักเรียน', (b) => this.app.studentMenu(b)));
    // colors
    const g3 = h('div', { class: 'grp' });
    const c = this.cur();
    const favs = (t === 'hl' ? prefs.hlFavorites : prefs.favorites).slice(0, this.vertical ? 6 : 8);
    for (const col of favs) {
      const on = t !== 'eraser' && c.color && col.toUpperCase() === c.color.toUpperCase();
      const b = h('button', { class: 'sw' + (on ? ' on' : ''), title: col }, h('i', { style: { background: col } }));
      b.onclick = () => { if (on) openPenPanel(b, this, this.popOpts()); else this.setColor(col); };
      g3.append(b);
    }
    if (c.color && !favs.some(x => x.toUpperCase() === c.color.toUpperCase()) && t !== 'eraser') {
      const b = h('button', { class: 'sw on', title: c.color }, h('i', { style: { background: c.color } }));
      b.onclick = () => openPenPanel(b, this, this.popOpts()); g3.append(b);
    }
    // sizes
    this.gSizes = h('div', { class: 'grp' });
    this.fillSizes();
    // right side
    this.recBtn = h('button', { class: 'recbtn', title: 'อัดคลิป' }, h('span', { class: 'dot' }), h('span', { class: 'lab' }, 'อัดคลิป'));
    this.recBtn.onclick = () => this.app.recorderClick(this, this.recBtn);
    onLongPress(this.recBtn, () => this.app.recorderSettings(this, this.recBtn));
    this.micBtn = B('mic', 'อัดเสียง', (b) => this.app.audioClick(this, b));
    const g4 = h('div', { class: 'grp' }, this.micBtn, this.recBtn,
      this.saveBtn = B('save', 'บันทึกเป็นไฟล์ในเครื่อง', (b) => this.saveFileMenu(b)),
      B('more', 'เพิ่มเติม', (b) => this.moreMenu(b)),
      B('hide', 'ซ่อนแถบเครื่องมือ', () => { prefs.toolbarHidden = true; savePrefs(); this.applyPos(); toast('แตะปุ่มมุมขวาบนเพื่อแสดงแถบเครื่องมืออีกครั้ง'); }));
    tb.append(g1, sep(), g2, sep(), g3, sep(), this.gSizes, h('div', { class: 'grow' }), g4);
    this.updateUndoBtns();
    this.app.recorder?.syncButton?.(); this.app.audio?.syncButton?.(); this.syncSaveBtn();
    this.app.timer.attach(this);
  }
  // Goodnotes-style: tabs row + centered tool row + floating context bar + undo capsule
  buildTopBar() {
    const tb = this.tb; tb.innerHTML = '';
    const B = (ic, title, fn, on, cls = '') => { const b = h('button', { class: 'btn sq ' + cls + (on ? ' on' : ''), title, 'aria-label': title }, icon(ic)); b.addEventListener('click', (e) => fn(b, e)); return b; };
    // tabs
    const tabs = h('div', { class: 'tabs' });
    const home = h('button', { class: 'tab-home', title: 'คลังสมุด' }, icon('home'));
    home.onclick = () => this.app.openLibrary();
    tabs.append(home);
    for (const tab of this.app.tabList()) {
      const on = tab.id === this.nb.id;
      const x = h('button', { class: 'tx', title: 'ปิดแท็บ' }, icon('close'));
      const el = h('div', { class: 'tab' + (on ? ' on' : '') }, h('span', { class: 'nm' }, on ? this.nb.name : tab.name), on ? icon('down') : null, x);
      el.onclick = (e) => { if (e.target.closest('.tx')) return; if (on) this.notebookMenu(el); else this.app.openNotebook(tab.id); };
      x.onclick = (e) => { e.stopPropagation(); this.app.closeTab(tab.id); };
      tabs.append(el);
    }
    // tool row
    const t = this.tool;
    const left = h('div', { class: 'side l' },
      this.btnPages = B('pages', 'ภาพย่อหน้า', () => this.toggleThumbs(), this.thumbs.classList.contains('open')),
      B('fit', 'พอดีหน้าจอ', () => this.fit()));
    const center = h('div', { class: 'center' },
      B(prefs.penType, 'ปากกา', (b) => { if (this.tool === 'pen') openPenPanel(b, this, {}); else this.setTool('pen'); }, t === 'pen'),
      B('hl', 'ไฮไลต์', (b) => { if (this.tool === 'hl') openPenPanel(b, this, {}); else this.setTool('hl'); }, t === 'hl'),
      B('eraser', 'ยางลบ', (b) => { if (this.tool === 'eraser') openEraserPanel(b, this, {}); else this.setTool('eraser'); }, t === 'eraser'),
      (() => { const b = B('shape', 'แปลงเป็นรูปทรงอัตโนมัติ (ขีดแล้วกดค้าง)', () => { prefs.shapeRecog = !prefs.shapeRecog; savePrefs(); b.classList.toggle('on', prefs.shapeRecog); toast(prefs.shapeRecog ? 'เปิดแปลงรูปทรง: ขีดแล้วกดค้างไว้ครึ่งวินาที' : 'ปิดแปลงรูปทรงแล้ว'); }, prefs.shapeRecog); return b; })(),
      B('lasso', 'บ่วงบาศ (เลือก ย้าย ย่อขยาย หมุน)', () => this.setTool('lasso'), t === 'lasso'),
      B('image', 'แทรกรูปภาพ', () => this.pickImage()),
      B('text', 'กล่องข้อความ', () => this.setTool('text'), t === 'text'),
      B('laser', 'เลเซอร์พอยเตอร์', () => this.setTool('laser'), t === 'laser'));
    this.recBtn = h('button', { class: 'recbtn', title: 'อัดคลิป (กดค้างเพื่อตั้งค่า)' }, h('span', { class: 'dot' }), h('span', { class: 'lab' }, 'อัดคลิป'));
    this.recBtn.onclick = () => this.app.recorderClick(this, this.recBtn);
    onLongPress(this.recBtn, () => this.app.recorderSettings(this, this.recBtn));
    this.micBtn = B('mic', 'อัดเสียง', (b) => this.app.audioClick(this, b));
    const right = h('div', { class: 'side r' },
      B('timer', 'นาฬิกาจับเวลา', (b) => this.app.timer.panel(b), this.app.timer.visible),
      B('screen', 'หน้าจอนักเรียน / นำเสนอ', (b) => this.app.studentMenu(b), this.app.broadcast?.connected),
      this.micBtn, this.recBtn,
      B('pageplus', 'เพิ่มหน้า', (b) => this.addPageMenu(b)),
      this.saveBtn = B('save', 'บันทึกเป็นไฟล์ในเครื่อง', (b) => this.saveFileMenu(b)),
      B('share', 'ส่งออก / สำรอง', (b) => this.exportMenu(b)),
      B('more', 'เพิ่มเติม', (b) => this.moreMenu(b)),
      B('hide', 'ซ่อนแถบเครื่องมือ (โหมดนำเสนอ)', () => { prefs.toolbarHidden = true; savePrefs(); this.applyPos(); toast('แตะปุ่มมุมขวาบนเพื่อแสดงแถบเครื่องมืออีกครั้ง'); }));
    tb.append(tabs, h('div', { class: 'trow' }, left, center, right));
    // undo capsule
    this.btnUndo = B('undo', 'ย้อนกลับ', () => this.undo());
    this.btnRedo = B('redo', 'ทำซ้ำ', () => this.redo());
    const cap = h('div', { class: 'undocap' }, this.btnUndo, this.btnRedo);
    // floating context bar for the current tool
    const bar = h('div', { class: 'ctxbar' });
    const c = this.cur();
    if (['lasso', 'laser', 'text'].includes(t)) {
      const tips = { lasso: 'วาดวงล้อมสิ่งที่ต้องการเลือก แล้วลากเพื่อย้าย ลากมุมเพื่อย่อขยาย ลากจุดด้านบนเพื่อหมุน', laser: 'ลากเพื่อชี้ เส้นจะจางหายเอง และแสดงบนหน้าจอนักเรียนและในคลิป', text: 'แตะบนกระดาษเพื่อพิมพ์ข้อความ · กดค้างที่ข้อความเพื่อแก้ไข' };
      bar.append(h('span', { class: 'chip', style: { cursor: 'default' } }, icon(t), tips[t]));
      if (t === 'text') { bar.append(h('div', { class: 'vsep' })); for (const col of prefs.favorites.slice(0, 8)) { const on = col.toUpperCase() === prefs.penColor.toUpperCase(); const b = h('button', { class: 'sw' + (on ? ' on' : '') }, h('i', { style: { background: col } })); b.onclick = () => { prefs.penColor = col; savePrefs(); this.buildToolbar(); }; bar.append(b); } }
      if (prefs.toolbarHidden) { cap.classList.add('hidden'); bar.classList.add('hidden'); }
      this.stage.append(cap, bar); this.updateUndoBtns(); this.app.recorder?.syncButton?.(); this.app.audio?.syncButton?.(); this.syncSaveBtn();
      this.app.timer.attach(this);
      return;
    }
    if (c.kind === 'eraser') {
      const mk = (m, label) => { const b = h('button', { class: 'chip' + (prefs.eraser.mode === m ? ' on' : '') }, label); b.onclick = () => { prefs.eraser.mode = m; savePrefs(); this.buildToolbar(); }; return b; };
      bar.append(mk('stroke', 'ลบทั้งเส้น'), mk('area', 'ลบส่วนที่ถู'));
    } else {
      const chip = h('button', { class: 'chip main' }, icon(c.kind === 'hl' ? 'hl' : prefs.penType), h('span', {}, c.kind === 'hl' ? 'ไฮไลต์' : PEN_LABEL[prefs.penType]), icon('down'));
      chip.onclick = () => openPenPanel(chip, this, {});
      bar.append(chip);
      if (c.kind === 'hl') {
        const br = h('button', { class: 'chip' + ((prefs.hl.style || 'brush') === 'brush' ? ' on' : ''), title: 'แบบแปรง: ปลายสะบัด เข้มอ่อนตามแรงกด' }, 'แปรง');
        br.onclick = () => { prefs.hl.style = (prefs.hl.style || 'brush') === 'brush' ? 'flat' : 'brush'; savePrefs(); this.buildToolbar(); };
        bar.append(br);
        const st = h('button', { class: 'chip' + (prefs.hl.straight ? ' on' : ''), title: 'ลากเป็นเส้นตรงอัตโนมัติ' }, 'เส้นตรง');
        st.onclick = () => { prefs.hl.straight = !prefs.hl.straight; savePrefs(); this.buildToolbar(); };
        bar.append(st);
      }
    }
    bar.append(h('div', { class: 'vsep' }));
    this.gSizes = h('div', { class: 'grp' }); bar.append(this.gSizes); this.fillSizes();
    if (c.kind !== 'eraser') {
      bar.append(h('div', { class: 'vsep' }));
      const favs = (t === 'hl' ? prefs.hlFavorites : prefs.favorites).slice(0, 10);
      for (const col of favs) {
        const on = c.color && col.toUpperCase() === c.color.toUpperCase();
        const b = h('button', { class: 'sw' + (on ? ' on' : ''), title: col }, h('i', { style: { background: col } }));
        b.onclick = () => { if (on) openPenPanel(b, this, {}); else this.setColor(col); };
        bar.append(b);
      }
      if (c.color && !favs.some(x => x.toUpperCase() === c.color.toUpperCase())) {
        const b = h('button', { class: 'sw on', title: c.color }, h('i', { style: { background: c.color } }));
        b.onclick = () => openPenPanel(b, this, {}); bar.append(b);
      }
      const more = h('button', { class: 'sw wheel-sw', title: 'สีอื่น ๆ' }, h('i'));
      more.onclick = () => openPenPanel(more, this, {}); bar.append(more);
    }
    if (prefs.toolbarHidden) { cap.classList.add('hidden'); bar.classList.add('hidden'); }
    this.stage.append(cap, bar);
    this.updateUndoBtns();
    this.app.recorder?.syncButton?.(); this.app.audio?.syncButton?.(); this.syncSaveBtn();
    this.app.timer.attach(this);
  }
  exportMenu(anchor) {
    menu(anchor, [
      { icon: 'download', label: 'สำรองสมุดเล่มนี้ (.senkid.json)', action: async () => { await this.flush(); this.app.exportNotebooks([this.nb.id]); } },
      { icon: 'film', label: 'คลิปและเสียงที่อัดไว้', action: () => this.app.openRecordings() },
      { icon: 'mic', label: 'เสียงที่อัดในสมุดเล่มนี้', action: () => this.app.openRecordings(this.nb.id) },
      { icon: 'pdf', label: 'ส่งออกเป็น PDF', action: () => openExportDialog(this) },
    ], this.popOpts());
  }
  notebookMenu(anchor) {
    menu(anchor, [
      { header: this.nb.name },
      { icon: 'edit', label: 'เปลี่ยนชื่อสมุด', action: async () => { const v = await ask('เปลี่ยนชื่อสมุด', { value: this.nb.name }); if (v) { this.nb.name = v; this.saveNb(); this.app.renameTab(this.nb.id, v); this.buildToolbar(); } } },
      { icon: 'download', label: 'สำรองสมุดเล่มนี้', action: async () => { await this.flush(); this.app.exportNotebooks([this.nb.id]); } },
      { icon: 'lib', label: 'กลับไปคลังสมุด', action: () => this.app.openLibrary() },
    ]);
  }
  fillSizes() {
    const g = this.gSizes; g.innerHTML = '';
    const c = this.cur();
    const mx = Math.max(...c.presets);
    const lines = prefs.toolbarPos === 'top' && c.kind !== 'eraser';
    c.presets.forEach((v, i) => {
      if (lines) {
        const th = Math.max(1.5, Math.min(12, 1.5 + 10.5 * Math.sqrt(v / mx)));
        const on = Math.abs(v - c.size) < 1e-6;
        const b = h('button', { class: 'szl' + (on ? ' on' : ''), title: `ขนาด ${v}` }, h('i', { style: { height: th + 'px' } }));
        b.onclick = () => { if (on) openPenPanel(b, this, {}); else this.setSize(v); };
        g.append(b); return;
      }
      const d = c.kind === 'eraser' ? 6 + 16 * (v / mx) : Math.max(4, Math.min(22, 4 + 18 * Math.sqrt(v / mx)));
      const on = Math.abs(v - c.size) < 1e-6;
      const b = h('button', { class: 'sz' + (on ? ' on' : ''), title: `ขนาด ${v}` }, h('i', { style: { width: d + 'px', height: d + 'px', ...(c.kind === 'eraser' ? { background: 'transparent', border: '2px solid currentColor', color: on ? 'var(--acc)' : 'var(--icon)' } : {}) } }));
      b.onclick = () => { if (on) (c.kind === 'eraser' ? openEraserPanel : openPenPanel)(b, this, this.popOpts()); else this.setSize(v); };
      g.append(b);
    });
  }
  refreshToolbarState() { if (this.gSizes) this.fillSizes(); }
  updateUndoBtns() {
    if (this.btnUndo) this.btnUndo.style.opacity = this.undoStack.length ? 1 : .35;
    if (this.btnRedo) this.btnRedo.style.opacity = this.redoStack.length ? 1 : .35;
  }
  updateRecFloat() {
    $('.recfloat', this.stage)?.remove();
    if (prefs.toolbarHidden && this.app.recorder?.active) {
      const b = h('button', { class: 'recbtn live recfloat' }, h('span', { class: 'dot' }), h('span', { class: 't' }, ''));
      b.onclick = () => this.app.recorderClick(this, b);
      this.stage.append(b); this.recFloat = b;
    } else this.recFloat = null;
  }
  updateLiveBlend() { this.cvLive.style.mixBlendMode = this.tool === 'hl' && !this.darkPaper ? 'multiply' : 'normal'; }

  // ---------- quick settings ----------
  moreMenu(anchor) {
    const page = this.currentPage();
    const box = h('div', { style: { width: 'min(400px, calc(100vw - 20px))', padding: '4px 6px' } });
    const row = (label, ctl, sub) => h('div', { class: 'row' }, h('div', {}, h('div', {}, label), sub ? h('div', { class: 'sub' }, sub) : null), ctl);
    box.append(h('div', { class: 'lbl', style: { marginTop: '4px' } }, `พื้นกระดาษหน้านี้ (หน้า ${this.nb.pages.indexOf(page.id) + 1})`));
    if (page.pdf) box.append(h('div', { style: { fontSize: '19px', color: 'var(--muted)', margin: '0 0 6px' } }, 'หน้านี้มาจากไฟล์ PDF จึงเปลี่ยนพื้นไม่ได้ (เปลี่ยนพื้นทุกหน้าจะไม่กระทบหน้า PDF)'));
    box.append(seg([['blank', 'เปล่า'], ['lines', 'เส้น'], ['grid', 'ตาราง'], ['dots', 'จุด']], page.bg, (v) => this.setPageProps(page, { bg: v })));
    box.append(h('div', { style: { height: '8px' } }));
    box.append(seg([['P', 'A4 แนวตั้ง'], ['L', 'A4 แนวนอน']], page.size || 'P', (v) => this.setPageProps(page, { size: v })));
    const allBtn = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '4px' } }, 'ใช้พื้นนี้กับทุกหน้า');
    allBtn.onclick = () => { this.setAllPagesProps({ bg: page.bg, size: page.size }); toast('เปลี่ยนพื้นทุกหน้าแล้ว'); };
    box.append(allBtn);
    box.append(h('div', { class: 'lbl' }, 'สีกระดาษ (ทั้งเล่ม)'));
    box.append(seg(Object.entries(PAPERS).map(([k, v]) => [k, v.label]), this.paper, (v) => { this.nb.paper = v; this.saveNb(); this.updateLiveBlend(); this.need.main = true; this.thumbsDirtyAll(); }));
    box.append(h('div', { class: 'lbl' }, 'ตำแหน่งแถบเครื่องมือ'));
    box.append(seg([['top', 'บน'], ['left', 'ซ้าย'], ['right', 'ขวา'], ['bottom', 'ล่าง']], prefs.toolbarPos, (v) => { prefs.toolbarPos = v; savePrefs(); this.applyPos(); this.buildToolbar(); }));
    box.append(h('div', { class: 'lbl' }, 'ธีม'));
    box.append(seg([['light', 'สว่าง'], ['dark', 'มืด'], ['auto', 'ตามระบบ']], prefs.theme, (v) => { prefs.theme = v; savePrefs(); applyTheme(); this.need.main = true; }));
    box.append(h('div', { style: { height: '6px' } }));
    box.append(row('เขียนด้วยนิ้ว', toggle(prefs.fingerDraw, (v) => { prefs.fingerDraw = v; savePrefs(); }), 'ปิดไว้: นิ้วใช้เลื่อนและซูม'));
    box.append(row('แปลงเป็นรูปทรงอัตโนมัติ', toggle(prefs.shapeRecog, (v) => { prefs.shapeRecog = v; savePrefs(); this.buildToolbar(); }), 'ขีดแล้วกดค้างไว้ 0.5 วินาที'));
    box.append(row('แสดง 2 หน้าคู่ (สมุดเล่มนี้)', toggle(prefs.twoPage && !this.nb.single, (v) => { this.nb.single = !v; if (v && !prefs.twoPage) { prefs.twoPage = true; savePrefs(); } this.saveNb(); this.relayout(true); }), 'ปิด = เปิดทีละ 1 หน้า (สมุด PDF ตั้งเป็นทีละหน้าไว้)'));
    const m = h('div', { class: 'menu', style: { padding: '6px 0 0', minWidth: 0 } });
    const mi = (ic, label, fn) => { const b = h('button', { class: 'mi' }, icon(ic), h('span', {}, label)); b.onclick = () => { close(); fn(); }; m.append(b); };
    mi('fit', 'พอดีหน้าจอ', () => this.fit());
    mi('pdf', 'ส่งออกเป็น PDF', () => openExportDialog(this));
    mi('pageplus', 'เพิ่มหน้า / แทรก PDF', () => this.addPageMenu(anchor));
    mi('screen', 'หน้าจอนักเรียน', () => this.app.studentMenu(anchor));
    mi('film', 'คลิปที่อัดไว้', () => this.app.openRecordings());
    mi('download', 'สำรองสมุดเล่มนี้', async () => { await this.flush(); this.app.exportNotebooks([this.nb.id]); });
    mi('gear', 'ตั้งค่าทั้งหมด', () => this.app.openSettings());
    mi('help', 'วิธีใช้', () => this.app.openHelp());
    box.append(m);
    const close = popover(anchor, box, this.popOpts());
  }

  // ---------- layout & view ----------
  resize() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const wasFit = this.fitMode, oldW = this.W;
    this.W = r.width; this.H = r.height;
    const base = Math.min(devicePixelRatio || 1, prefs.economy ? 1.5 : 3);
    this.R = Math.max(base, this.recScale || 0);
    for (const c of [this.cvMain, this.cvLive, this.cvLaser, this.cvUI]) {
      c.width = Math.round(this.W * this.R); c.height = Math.round(this.H * this.R);
      c.style.width = this.W + 'px'; c.style.height = this.H + 'px';
    }
    this.snap.width = this.cvMain.width; this.snap.height = this.cvMain.height; this.snapView = null;
    this.relayout(wasFit || !oldW);
    this.need.main = this.need.live = this.need.ui = true;
  }
  setRecordScale(s) { this.recScale = s; this.resize(); }

  relayout(refit) {
    const pages = this.pages;
    const land = this.W > this.H * 1.05;
    this.cols = prefs.twoPage && !this.nb.single && land && pages.length > 1 ? 2 : 1;
    const colW = Math.max(...pages.map(p => dims(p).w), PAGE.P.w);
    this.rects = new Map(); let y = 0, maxH = 0;
    for (let i = 0; i < pages.length; i += this.cols) {
      let rowH = 0;
      for (let c = 0; c < this.cols && i + c < pages.length; c++) {
        const p = pages[i + c], P = dims(p);
        this.rects.set(p.id, { x: c * (colW + GAP) + (colW - P.w) / 2, y, w: P.w, h: P.h });
        rowH = Math.max(rowH, P.h); maxH = Math.max(maxH, P.h);
      }
      y += rowH + GAP;
    }
    this.contentW = this.cols * colW + (this.cols - 1) * GAP; this.contentH = Math.max(0, y - GAP);
    this.fitZ = Math.min((this.W - 32) / this.contentW, (this.H - 28) / (maxH || PAGE.P.h));
    if (refit) this.fit(true); else this.clampView();
    this.need.main = true; this.updatePageNo();
    if (this.thumbs.classList.contains('open')) this.renderThumbs();
  }
  fit(keepPage) {
    const cur = keepPage ? this.currentPage() : null;
    this.z = this.fitZ; this.fitMode = true;
    this.ox = (this.W - this.contentW * this.z) / 2;
    this.oy = 14;
    if (cur) { const r = this.rects.get(cur.id); if (r) this.oy = 14 - r.y * this.z; }
    this.clampView(); this.viewChanged();
  }
  clampView() {
    const cw = this.contentW * this.z, ch = this.contentH * this.z;
    if (cw <= this.W) this.ox = (this.W - cw) / 2; else this.ox = Math.min(60, Math.max(this.W - cw - 60, this.ox));
    if (ch <= this.H) this.oy = Math.max(8, Math.min(this.oy, this.H - ch - 8));
    else this.oy = Math.min(this.H * 0.35, Math.max(this.H * 0.65 - ch, this.oy));
  }
  viewChanged() { this.need.main = true; this.need.ui = true; this.need.live = true; this.lastViewChange = performance.now(); this.updatePageNo(); if (this.thumbList) { clearTimeout(this.thC); this.thC = setTimeout(() => this.markThumbCur(), 120); } }
  toWorld(sx, sy) { return [(sx - this.ox) / this.z, (sy - this.oy) / this.z]; }
  pageAt(wx, wy, slack = 0) {
    for (const p of this.pages) { const r = this.rects.get(p.id); if (wx >= r.x - slack && wx <= r.x + r.w + slack && wy >= r.y - slack && wy <= r.y + r.h + slack) return p; }
    return null;
  }
  currentPage() {
    const [cx, cy] = this.toWorld(this.W / 2, this.H / 2);
    if (this.pinPid) { const r = this.rects.get(this.pinPid), p = this.pageMap.get(this.pinPid); if (r && p && this.pages.includes(p) && cy >= r.y - 20 && cy <= r.y + r.h + 20) return p; }
    let best = null, bd = Infinity;
    for (const p of this.pages) {
      const r = this.rects.get(p.id); if (!r) continue;
      const dx = Math.max(r.x - cx, 0, cx - r.x - r.w), dy = Math.max(r.y - cy, 0, cy - r.y - r.h);
      const d = dx * 3 + dy; if (d < bd) { bd = d; best = p; }
    }
    return best || this.pages[0];
  }
  updatePageNo() {
    if (!this.rects) return;
    const p = this.currentPage(); if (!p) return;
    const i = this.nb.pages.indexOf(p.id);
    const n = this.nb.pages.length;
    this.pageno.textContent = this.cols === 2 && i + 1 < n ? `หน้า ${i + 1 - (i % 2)}–${Math.min(n, i + 2 - (i % 2))} / ${n}` : `หน้า ${i + 1} / ${n}`;
    if (this.curPid !== p.id) { this.curPid = p.id; $$('.th', this.thumbs).forEach(t => t.classList.toggle('cur', t.dataset.pid === p.id)); if (this.mounted && this.nb.lastPage !== p.id) { this.nb.lastPage = p.id; this.saveNb(); } }
  }
  scrollToPage(pid) {
    const r = this.rects.get(pid); if (!r) return;
    this.pinPid = pid;
    this.oy = 14 - r.y * this.z;
    if (this.contentW * this.z > this.W) this.ox = this.W / 2 - (r.x + r.w / 2) * this.z;
    this.clampView(); this.viewChanged();
  }
  showZoom() {
    this.zoomInd.textContent = Math.round(this.z / this.fitZ * 100) + '%';
    this.zoomInd.classList.add('show'); clearTimeout(this.zt); this.zt = setTimeout(() => this.zoomInd.classList.remove('show'), 700);
  }

  // ---------- rendering ----------
  frame(t) {
    if (!this.raf) return;
    const gesturing = performance.now() - (this.lastViewChange || 0) < 140;
    if (this.need.main) {
      this.need.main = false;
      if (gesturing && this.slowMain && this.snapView) { this.blitSnap(); this.need.mainSettle = true; }
      else { this.redrawMain(); this.need.mainSettle = false; }
    } else if (this.need.mainSettle && !gesturing) { this.need.mainSettle = false; this.redrawMain(); }
    if (this.need.live) { this.redrawLive(); this.need.live = false; }
    if (this.need.ui) { this.redrawUI(); this.need.ui = false; }
    if (this.laser.length || this.laserDirty) this.redrawLaser();
    this.app.broadcast?.frame?.(this);
    this.app.recorder?.frame?.(this);
    this.raf = requestAnimationFrame(this.frame);
  }
  desk() { return getComputedStyle(document.documentElement).getPropertyValue('--desk').trim() || '#E9E6DF'; }
  redrawMain() {
    const t0 = performance.now();
    const ctx = this.ctxMain, R = this.R;
    ctx.setTransform(R, 0, 0, R, 0, 0);
    this.deskColor = this.desk();
    ctx.fillStyle = this.deskColor; ctx.fillRect(0, 0, this.W, this.H);
    const [vx0, vy0] = this.toWorld(0, 0), [vx1, vy1] = this.toWorld(this.W, this.H);
    const k = this.z * R, dark = this.darkPaper;
    for (const p of this.pages) {
      const r = this.rects.get(p.id);
      if (r.x > vx1 || r.x + r.w < vx0 || r.y > vy1 || r.y + r.h < vy0) continue;
      ctx.setTransform(k, 0, 0, k, (this.ox + r.x * this.z) * R, (this.oy + r.y * this.z) * R);
      ctx.fillStyle = 'rgba(0,0,0,.10)'; ctx.fillRect(-0.5 / this.z, 2 / this.z, r.w + 1 / this.z, r.h + 1 / this.z);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, r.w, r.h); ctx.clip();
      drawPaper(ctx, p, this.paper, k);
      drawStrokes(ctx, p, k, dark, [vx0 - r.x, vy0 - r.y, vx1 - r.x, vy1 - r.y]);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dt = performance.now() - t0;
    this.slowMain = dt > 14;
    // snapshot for fast panning
    this.snapCtx.setTransform(1, 0, 0, 1, 0, 0); this.snapCtx.drawImage(this.cvMain, 0, 0);
    this.snapView = { z: this.z, ox: this.ox, oy: this.oy };
  }
  blitSnap() {
    const s = this.snapView, ctx = this.ctxMain, R = this.R, sc = this.z / s.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.deskColor; ctx.fillRect(0, 0, this.cvMain.width, this.cvMain.height);
    ctx.setTransform(sc, 0, 0, sc, (this.ox - s.ox * sc) * R, (this.oy - s.oy * sc) * R);
    ctx.drawImage(this.snap, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // draw one finished stroke directly on main (fast path)
  drawIncremental(page, s) {
    if (s.t === 'hl') { this.need.main = true; return; }
    const r = this.rects.get(page.id), R = this.R, k = this.z * R, ctx = this.ctxMain;
    ctx.save(); ctx.setTransform(k, 0, 0, k, (this.ox + r.x * this.z) * R, (this.oy + r.y * this.z) * R);
    ctx.beginPath(); ctx.rect(0, 0, r.w, r.h); ctx.clip();
    drawStroke(ctx, s, k, this.darkPaper, true);
    ctx.restore();
    this.snapCtx.setTransform(1, 0, 0, 1, 0, 0); this.snapCtx.drawImage(this.cvMain, 0, 0);
  }
  pageCtx(ctx, page) {
    const r = this.rects.get(page.id), R = this.R, k = this.z * R;
    ctx.setTransform(k, 0, 0, k, (this.ox + r.x * this.z) * R, (this.oy + r.y * this.z) * R);
    return k;
  }
  redrawLive() {
    const ctx = this.ctxLive;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.cvLive.width, this.cvLive.height);
    const L = this.live; if (!L) return;
    const r = this.rects.get(L.page.id); if (!r) return;
    const k = this.pageCtx(ctx, L.page);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, r.w, r.h); ctx.clip();
    const s = this.liveStroke(true);
    if (s) drawStroke(ctx, s, k, this.darkPaper, false);
    ctx.restore();
  }
  redrawUI() {
    const ctx = this.ctxUI, R = this.R;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.cvUI.width, this.cvUI.height);
    if (this.erCursor) {
      ctx.setTransform(R, 0, 0, R, 0, 0);
      ctx.beginPath(); ctx.arc(this.erCursor.x, this.erCursor.y, Math.max(3, prefs.eraser.size / 2 * this.z), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(30,30,30,.65)'; ctx.stroke();
    }
    this.drawLassoUI(ctx);
    const isel = this.selImage();
    if (isel && !this.imgDrag?.hideUI) {
      const r = this.rects.get(isel.page.id), s = isel.s;
      ctx.setTransform(R, 0, 0, R, 0, 0);
      const X0 = this.ox + (r.x + s.x) * this.z, Y0 = this.oy + (r.y + s.y) * this.z, Wd = s.w * this.z, Hd = s.h * this.z;
      ctx.lineWidth = 2; ctx.strokeStyle = '#2F5BEA'; ctx.strokeRect(X0, Y0, Wd, Hd);
      for (const [x, y] of [[X0, Y0], [X0 + Wd, Y0], [X0, Y0 + Hd], [X0 + Wd, Y0 + Hd]]) { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.stroke(); }
      if (!this.imgDrag) this.placeImgBar();
    } else if (!isel && !this.lsel && this.imgBar && !this.imgBar.classList.contains('hidden')) this.imgBar.classList.add('hidden');
    const sel = this.selStroke();
    if (sel) {
      const { page, s } = sel; const r = this.rects.get(page.id);
      ctx.setTransform(R, 0, 0, R, 0, 0);
      const toS = (x, y) => [this.ox + (r.x + x) * this.z, this.oy + (r.y + y) * this.z];
      // outline
      const poly = shapePolyline(s.shape, 64);
      ctx.beginPath(); for (let i = 0; i < poly.length; i += 2) { const [x, y] = toS(poly[i], poly[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(47,91,234,.7)'; ctx.stroke(); ctx.setLineDash([]);
      for (const hd of shapeHandles(s.shape)) {
        const [x, y] = toS(hd.x, hd.y);
        ctx.beginPath();
        if (hd.id === 'move') { ctx.rect(x - 9, y - 9, 18, 18); } else ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#2F5BEA'; ctx.stroke();
        if (hd.id === 'move') { ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.lineWidth = 2; ctx.stroke(); }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------- input ----------
  bindInput() {
    const st = this.stage;
    st.addEventListener('pointerdown', (e) => this.down(e));
    st.addEventListener('pointermove', (e) => this.move(e));
    st.addEventListener('pointerup', (e) => this.up(e));
    st.addEventListener('pointercancel', (e) => this.up(e, true));
    st.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.hideHover(); });
    st.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    st.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS: stop native gestures / magnifier
    for (const ev of ['touchstart', 'touchmove']) st.addEventListener(ev, (e) => { if (this.isSurface(e.target)) e.preventDefault(); }, { passive: false });
    st.addEventListener('gesturestart', (e) => e.preventDefault());
  }
  local(e) { const r = this.stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  isSurface(t) { return t === this.stage || t === this.cvMain || t === this.cvLive || t === this.cvLaser || t === this.cvUI; }
  inStageUI(e) { return !this.isSurface(e.target); }

  down(e) {
    if (this.inStageUI(e)) return;
    const [sx, sy] = this.local(e);
    const type = e.pointerType;
    if (type === 'pen') { this.penSeen = true; this.hideHover(); }
    if (type === 'touch') {
      // palm rejection: ignore touches while pen writes or pen hovered just now
      if (this.live && this.live.type === 'pen') return;
      if (this.erasing && this.erasing.type === 'pen') return;
      if (performance.now() - this.lastHover < 350) return;
      this.pointers.set(e.pointerId, { x: sx, y: sy, sx, sy });
      if (!this.gesture) this.gesture = { t0: performance.now(), max: 0, moved: 0 };
      this.gesture.max = Math.max(this.gesture.max, this.pointers.size);
      const fingerDraws = prefs.fingerDraw && !(e.width > 40 && e.height > 40);
      if (this.pointers.size === 1 && fingerDraws && !this.drag) {
        if (this.tryHandle(sx, sy, e)) return;
        this.startAction(e, sx, sy);
        return;
      }
      if (this.live && this.live.type === 'touch') { this.cancelLive(); }
      if (this.erasing && this.erasing.type === 'touch') { this.finishErase(); }
      if (this.pointers.size === 1 && this.tryHandle(sx, sy, e)) return;
      this.startGesture();
      return;
    }
    if (type === 'mouse' && e.button !== 0) { this.pointers.set(e.pointerId, { x: sx, y: sy, sx, sy }); this.startGesture(); this.stage.setPointerCapture(e.pointerId); return; }
    if (type === 'mouse' && this.spaceDown) { this.pointers.set(e.pointerId, { x: sx, y: sy, sx, sy }); this.startGesture(); this.stage.setPointerCapture(e.pointerId); return; }
    // pen / mouse draws: cancel any finger gesture (palm landed first)
    if (this.pointers.size) { this.pointers.clear(); this.gesture = null; this.pan = null; }
    try { this.stage.setPointerCapture(e.pointerId); } catch { }
    if (this.tryHandle(sx, sy, e)) return;
    this.startAction(e, sx, sy);
  }

  tryHandle(sx, sy, e) {
    if (this.lsel && this.lassoHandleDown(e, sx, sy)) return true;
    const ih = this.imgHandleAt(sx, sy, e.pointerType === 'touch');
    if (ih) {
      const [wx, wy] = this.toWorld(sx, sy), r = this.rects.get(ih.sel.page.id);
      this.imgDrag = { id: e.pointerId, kind: ih.kind, corner: ih.corner, page: ih.sel.page, orig: ih.sel.s, cur: ih.sel.s, px: wx - r.x, py: wy - r.y };
      this.imgBar.classList.add('hidden');
      try { this.stage.setPointerCapture(e.pointerId); } catch { }
      return true;
    }
    if (this.imgSel && e.pointerType !== 'touch') this.deselectImage();
    const sel = this.selStroke(); if (!sel) return false;
    const r = this.rects.get(sel.page.id);
    const hs = shapeHandles(sel.s.shape);
    for (const hd of hs) {
      const x = this.ox + (r.x + hd.x) * this.z, y = this.oy + (r.y + hd.y) * this.z;
      if (Math.hypot(x - sx, y - sy) < (e.pointerType === 'touch' ? 26 : 18)) {
        this.drag = { id: e.pointerId, hid: hd.id, page: sel.page, orig: sel.s, cur: sel.s };
        try { this.stage.setPointerCapture(e.pointerId); } catch { }
        return true;
      }
    }
    return false;
  }

  startAction(e, sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy);
    const page = this.pageAt(wx, wy, 6);
    this.deselect();
    const eraserBtn = e.button === 5 || (e.buttons & 32);
    if (!page) { if (e.pointerType !== 'touch') this.pointers.set(e.pointerId, { x: sx, y: sy, sx, sy }); this.startGesture(); return; }
    if (this.tool === 'eraser' || eraserBtn) { this.startErase(e, page, sx, sy); return; }
    if (this.tool === 'laser') { this.lasering = { id: e.pointerId }; this.laserAdd(sx, sy); return; }
    if (this.tool === 'lasso') { this.startLasso(e, page, sx, sy); return; }
    if (this.tool === 'text') { const r0 = this.rects.get(page.id); this.textTap = { id: e.pointerId, page, x: wx - r0.x, y: wy - r0.y, sx, sy }; this.armLongPress(e, sx, sy); return; }
    this.armLongPress(e, sx, sy);
    const c = this.cur(), r = this.rects.get(page.id);
    this.live = {
      id: e.pointerId, type: e.pointerType, page, kind: c.kind, pen: c.type, color: c.color, alpha: c.alpha, size: c.size,
      pts: [], pred: [], shape: null, sx, sy, holdX: sx, holdY: sy, rx: r.x, ry: r.y,
    };
    this.addPoint(e, sx, sy);
    this.armHold();
    this.need.live = true;
  }
  // hold detection: the pen stayed inside a small circle for HOLD_MS (tolerates hand tremor and drift)
  armHold() {
    clearInterval(this.holdTimer);
    const L = this.live; if (!L || L.shape) return;
    if (!prefs.shapeRecog || (L.kind === 'hl' && prefs.hl.straight)) return;
    L.track = [{ t: performance.now(), x: L.sx, y: L.sy, n: L.pts.length }];
    this.holdTimer = setInterval(() => this.checkHold(), 40);
  }
  trackHold(sx, sy) {
    const L = this.live; if (!L || !L.track) return;
    const now = performance.now(); L.track.push({ t: now, x: sx, y: sy, n: L.pts.length });
    while (L.track.length > 2 && now - L.track[1].t > 900) L.track.shift();
  }
  checkHold() {
    const L = this.live; if (!L || L.shape) { clearInterval(this.holdTimer); return; }
    const now = performance.now(), tr = L.track; if (!tr || now - tr[0].t < HOLD_MS) return;
    const last = tr[tr.length - 1], R = 9;
    // first sample of the stationary window
    let i = tr.length - 1;
    while (i > 0 && Math.hypot(tr[i - 1].x - last.x, tr[i - 1].y - last.y) < R) i--;
    const stillSince = i === 0 ? tr[0].t : tr[i].t;
    if (now - stillSince >= HOLD_MS || now - last.t >= HOLD_MS) {
      // only when the stroke actually travelled before the hold
      if (Math.hypot(L.sx - last.x, L.sy - last.y) < 12 && tr.length < 3) return;
      L.holdIdx = tr[i].n;
      clearInterval(this.holdTimer);
      this.onHold();
    }
  }
  onHold() {
    const L = this.live; if (!L || L.shape || L.pts.length < 4 * 4) return;
    // ignore the jitter after the pen stopped moving (the hold itself)
    const upto = Math.max(4 * STRIDE, Math.min(L.pts.length, (L.holdIdx || L.pts.length) + STRIDE));
    const xy = []; for (let i = 0; i < upto; i += STRIDE) xy.push(L.pts[i], L.pts[i + 1]);
    const sh = recognize(xy);
    if (sh) { L.shape = sh; this.need.live = true; try { navigator.vibrate?.(10); } catch { } }
  }
  pressureOf(e) {
    if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.5;
    return 0.5;
  }
  tiltOf(e) {
    if (e.pointerType !== 'pen') return 0;
    if (typeof e.altitudeAngle === 'number' && e.altitudeAngle > 0 && e.altitudeAngle !== Math.PI / 2) return Math.max(0, Math.min(1, 1 - e.altitudeAngle / (Math.PI / 2)));
    const t = Math.max(Math.abs(e.tiltX || 0), Math.abs(e.tiltY || 0)); return Math.min(1, t / 90);
  }
  addPoint(e, sx, sy) {
    const L = this.live;
    const x = (sx - this.ox) / this.z - L.rx, y = (sy - this.oy) / this.z - L.ry;
    const n = L.pts.length;
    if (n >= STRIDE) { const dx = x - L.pts[n - 4], dy = y - L.pts[n - 3]; if (dx * dx + dy * dy < 0.01) { L.pts[n - 2] = Math.max(L.pts[n - 2], this.pressureOf(e)); return; } }
    L.pts.push(x, y, this.pressureOf(e), this.tiltOf(e));
  }

  move(e) {
    const [sx, sy] = this.local(e);
    if (this.imgDrag && this.imgDrag.id === e.pointerId) { this.dragImage(sx, sy); return; }
    if (this.lasering && this.lasering.id === e.pointerId) { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; const r = this.stage.getBoundingClientRect(); for (const ce of (evs.length ? evs : [e])) this.laserAdd(ce.clientX - r.left, ce.clientY - r.top); return; }
    if (this.lassoDraw && this.lassoDraw.id === e.pointerId) { const [wx, wy] = this.toWorld(sx, sy); const L = this.lassoDraw; L.pts.push(wx - L.rx, wy - L.ry); this.need.ui = true; return; }
    if (this.lxf && this.lxf.id === e.pointerId) { this.lassoDrag(sx, sy); return; }
    if (this.textTap && this.textTap.id === e.pointerId) { if (Math.hypot(sx - this.textTap.sx, sy - this.textTap.sy) > 10) this.textTap = null; return; }
    if (this.lp && this.lp.id === e.pointerId && Math.hypot(sx - this.lp.sx, sy - this.lp.sy) > 8) { clearTimeout(this.lp.t); this.lp = null; }
    // handle drag
    if (this.drag && this.drag.id === e.pointerId) {
      const r = this.rects.get(this.drag.page.id);
      const [wx, wy] = this.toWorld(sx, sy);
      const sh = moveHandle(this.drag.orig.shape, this.drag.hid, wx - r.x, wy - r.y);
      const ns = { ...this.drag.orig, shape: sh, bb: null };
      const st = this.drag.page.strokes, i = st.indexOf(this.drag.cur);
      if (i >= 0) st[i] = ns; this.drag.cur = ns; this.sel = { pid: this.drag.page.id, sid: ns.id };
      this.need.main = this.need.ui = true; return;
    }
    // pen hover
    if (e.pointerType === 'pen' && e.buttons === 0 && !this.live) { this.showHover(sx, sy); return; }
    if (e.pointerType === 'mouse' && e.buttons === 0) { if (this.tool === 'eraser') { this.erCursor = { x: sx, y: sy }; this.need.ui = true; } return; }
    // drawing
    const L = this.live;
    if (L && L.id === e.pointerId) {
      if (L.shape) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      const r = this.stage.getBoundingClientRect();
      if (evs && evs.length) for (const ce of evs) this.addPoint(ce, ce.clientX - r.left, ce.clientY - r.top);
      else this.addPoint(e, sx, sy);
      L.pred = [];
      if (e.getPredictedEvents && !prefs.economy) {
        const pe = e.getPredictedEvents();
        for (const p of pe.slice(0, 3)) L.pred.push((p.clientX - r.left - this.ox) / this.z - L.rx, (p.clientY - r.top - this.oy) / this.z - L.ry, this.pressureOf(e), this.tiltOf(e));
      }
      this.trackHold(sx, sy);
      this.need.live = true; return;
    }
    if (this.erasing && this.erasing.id === e.pointerId) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const r = this.stage.getBoundingClientRect();
      for (const ce of (evs.length ? evs : [e])) this.eraseAt(ce.clientX - r.left, ce.clientY - r.top);
      this.erCursor = { x: sx, y: sy }; this.need.ui = true; return;
    }
    // gesture
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = sx; p.y = sy; if (this.gesture) this.gesture.moved = Math.max(this.gesture.moved, Math.hypot(sx - p.sx, sy - p.sy)); this.updateGesture(); }
  }

  up(e, cancel) {
    if (this.lp && this.lp.id === e.pointerId) { clearTimeout(this.lp.t); this.lp = null; }
    if (this.lasering && this.lasering.id === e.pointerId) { this.lasering = null; this.pointers.delete(e.pointerId); return; }
    if (this.lassoDraw && this.lassoDraw.id === e.pointerId) { this.pointers.delete(e.pointerId); this.finishLasso(); return; }
    if (this.lxf && this.lxf.id === e.pointerId) { this.pointers.delete(e.pointerId); this.endLassoDrag(); return; }
    if (this.textTap && this.textTap.id === e.pointerId) { const tt = this.textTap; this.textTap = null; this.pointers.delete(e.pointerId); if (!cancel) this.openTextDialog(tt.page, null, tt.x, tt.y); return; }
    if (this.imgDrag && this.imgDrag.id === e.pointerId) {
      const d = this.imgDrag; this.imgDrag = null; this.pointers.delete(e.pointerId);
      if (d.cur !== d.orig) { const before = d.page.strokes.map(s => s === d.cur ? d.orig : s); this.pushHistory({ k: 'str', items: [{ pid: d.page.id, before, after: d.page.strokes.slice() }] }); this.markDirty(d.page); }
      this.buildImgBar(); return;
    }
    const ownedByAction = (this.drag && this.drag.id === e.pointerId) || (this.live && this.live.id === e.pointerId) || (this.erasing && this.erasing.id === e.pointerId);
    if (ownedByAction && this.pointers.delete(e.pointerId) && !this.pointers.size) { this.gesture = null; this.pan = null; }
    if (this.drag && this.drag.id === e.pointerId) {
      const d = this.drag; this.drag = null;
      if (d.cur !== d.orig) {
        const before = d.page.strokes.map(s => s === d.cur ? d.orig : s);
        this.pushHistory({ k: 'str', items: [{ pid: d.page.id, before, after: d.page.strokes.slice() }] });
        this.markDirty(d.page);
      }
      this.need.ui = true; return;
    }
    if (this.live && this.live.id === e.pointerId) { this.commitLive(); return; }
    if (this.erasing && this.erasing.id === e.pointerId) { this.finishErase(); return; }
    if (this.pointers.has(e.pointerId)) {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) {
        const g = this.gesture; this.gesture = null; this.pan = null;
        if (g && !cancel && performance.now() - g.t0 < 320 && g.moved < 14) {
          if (g.max === 1 && this.imgSel) this.deselectImage();
          if (g.max === 2) { this.undo(); toast('ย้อนกลับ', 900); }
          else if (g.max === 3) { this.redo(); toast('ทำซ้ำ', 900); }
        }
        if (this.fling && !cancel) this.startFling();
      } else this.startGesture();
    }
  }

  armLongPress(e, sx, sy) {
    clearTimeout(this.lp?.t);
    const [wx, wy] = this.toWorld(sx, sy); const page = this.pageAt(wx, wy); if (!page) { this.lp = null; return; }
    const r = this.rects.get(page.id); const img = this.imgAt(page, wx - r.x, wy - r.y); if (!img) { this.lp = null; return; }
    this.lp = { id: e.pointerId, sx, sy, t: setTimeout(() => {
      if (!this.lp) return;
      this.lp = null;
      if (this.live && this.live.id === e.pointerId) this.cancelLive();
      if (this.erasing && this.erasing.id === e.pointerId) { this.finishErase(); }
      this.pan = null; this.gesture = null; this.pointers.delete(e.pointerId);
      this.selectImage(page.id, img.id);
      // continue as a move drag with the same pointer
      const ih = this.imgHandleAt(sx, sy, e.pointerType === 'touch');
      if (ih) { this.imgDrag = { id: e.pointerId, kind: 'move', page, orig: img, cur: img, px: wx - r.x, py: wy - r.y }; this.imgBar.classList.add('hidden'); }
      try { navigator.vibrate?.(12); } catch { }
    }, 480) };
  }
  startGesture() {
    this.pinPid = null;
    const pts = [...this.pointers.values()];
    if (!pts.length) return;
    if (pts.length === 1) { const p0 = [...this.pointers.entries()][0]; if (!this.imgDrag) this.armLongPress({ pointerId: p0[0], pointerType: 'touch' }, p0[1].x, p0[1].y); }
    else { clearTimeout(this.lp?.t); this.lp = null; }
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    this.pan = { cx, cy, d, z: this.z, ox: this.ox, oy: this.oy, n: pts.length, mode: pts.length > 1 ? null : 'pan', hist: [{ t: performance.now(), x: cx, y: cy }] };
    this.fling = null; cancelAnimationFrame(this.flingRaf);
  }
  updateGesture() {
    const P = this.pan; if (!P) return;
    const pts = [...this.pointers.values()];
    if (pts.length !== P.n) { this.startGesture(); return; }
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    let z = P.z;
    if (pts.length > 1 && P.d > 0) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      // lock: two fingers moving together = scroll, spreading/pinching = zoom
      if (!P.mode) {
        const dd = Math.abs(d - P.d), mv = Math.hypot(cx - P.cx, cy - P.cy);
        if (dd > 28 && dd > mv * 0.6) P.mode = 'zoom';
        else if (mv > 18 && dd < mv * 0.45) P.mode = 'pan';
        else if (dd > 60) P.mode = 'zoom';
        if (P.mode === 'zoom') { P.d = d; P.cx = cx; P.cy = cy; P.z = this.z; P.ox = this.ox; P.oy = this.oy; }
      }
      if (P.mode === 'zoom') {
        z = Math.max(this.fitZ * 0.35, Math.min(10, P.z * d / P.d));
        this.fitMode = false; this.showZoom();
      }
    }
    // keep world point under initial centroid under current centroid
    const wx = (P.cx - P.ox) / P.z, wy = (P.cy - P.oy) / P.z;
    this.z = z; this.ox = cx - wx * z; this.oy = cy - wy * z;
    if (P.mode === 'zoom' && Math.abs(z / this.fitZ - 1) < 0.04) this.z = this.fitZ;
    this.clampView(); this.viewChanged();
    const now = performance.now(); P.hist.push({ t: now, x: cx, y: cy }); while (P.hist.length > 6) P.hist.shift();
    if (pts.length === 1) { const a = P.hist[0], b = P.hist[P.hist.length - 1], dt = b.t - a.t; this.fling = dt > 0 ? { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt } : null; } else this.fling = null;
  }
  startFling() {
    let { vx, vy } = this.fling; this.fling = null;
    if (Math.hypot(vx, vy) < 0.25 || prefs.economy) return;
    let last = performance.now();
    const step = (t) => {
      const dt = t - last; last = t;
      this.ox += vx * dt; this.oy += vy * dt; vx *= Math.pow(0.994, dt); vy *= Math.pow(0.994, dt);
      this.clampView(); this.viewChanged();
      if (Math.hypot(vx, vy) > 0.03 && !this.pointers.size && !this.live) this.flingRaf = requestAnimationFrame(step);
    };
    this.flingRaf = requestAnimationFrame(step);
  }
  wheel(e) {
    if (this.inStageUI(e)) return;
    e.preventDefault(); this.pinPid = null;
    const [sx, sy] = this.local(e);
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025));
      const z = Math.max(this.fitZ * 0.35, Math.min(10, this.z * f));
      const wx = (sx - this.ox) / this.z, wy = (sy - this.oy) / this.z;
      this.z = z; this.ox = sx - wx * z; this.oy = sy - wy * z; this.fitMode = false; this.showZoom();
    } else {
      const m = e.deltaMode ? 30 : 1;
      this.ox -= (e.shiftKey ? e.deltaY : e.deltaX) * m; this.oy -= (e.shiftKey ? 0 : e.deltaY) * m;
    }
    this.clampView(); this.viewChanged();
  }

  showHover(sx, sy) {
    this.lastHover = performance.now();
    if (!prefs.showHover) return;
    const c = this.cur();
    const hv = this.hover; hv.style.display = 'block';
    const d = this.tool === 'eraser' ? Math.max(6, c.size * this.z) : Math.max(5, Math.min(60, c.size * this.z * (this.tool === 'hl' ? 1 : 1)));
    hv.style.width = hv.style.height = d + 'px';
    hv.style.left = sx + 'px'; hv.style.top = sy + 'px';
    hv.style.background = this.tool === 'eraser' ? 'rgba(255,255,255,.35)' : (c.color || '#000') + (this.tool === 'hl' ? '66' : 'AA');
    clearTimeout(this.hvT); this.hvT = setTimeout(() => this.hideHover(), 400);
  }
  hideHover() { this.hover.style.display = 'none'; if (this.erCursor && !this.erasing) { this.erCursor = null; this.need.ui = true; } }

  // ---------- strokes ----------
  liveStroke(withPred) {
    const L = this.live; if (!L) return null;
    const base = { id: 'live', t: L.kind === 'hl' ? 'hl' : 'pen', pen: L.kind === 'hl' ? 'hl' : L.pen, c: L.color, a: L.alpha, w: L.size };
    if (L.kind === 'hl') base.hs = prefs.hl.style || 'brush';
    if (L.shape) return { ...base, shape: L.shape, pen: L.kind === 'hl' ? 'hl' : L.pen };
    let pts = L.pts;
    if (L.kind === 'hl' && prefs.hl.straight && pts.length >= 8) {
      const n = pts.length; const sl = straighten(pts[0], pts[1], pts[n - 4], pts[n - 3]);
      if ((prefs.hl.style || 'brush') === 'brush') {
        const m = n / STRIDE, K = Math.max(2, Math.min(80, Math.round(Math.hypot(sl[2] - sl[0], sl[3] - sl[1]) / 3))), out = [];
        for (let i = 0; i < K; i++) { const u = i / (K - 1), j = Math.min(m - 1, Math.round(u * (m - 1))); out.push(sl[0] + (sl[2] - sl[0]) * u, sl[1] + (sl[3] - sl[1]) * u, pts[j * STRIDE + 2], 0); }
        pts = out;
      } else pts = [sl[0], sl[1], .5, 0, sl[2], sl[3], .5, 0];
    } else if (withPred && L.pred.length) pts = pts.concat(L.pred);
    return { ...base, pts: Float32Array.from(pts) };
  }
  cancelLive() { clearInterval(this.holdTimer); this.live = null; this.need.live = true; }
  commitLive() {
    clearInterval(this.holdTimer);
    const L = this.live; if (!L) return;
    const s = this.liveStroke(false);
    this.live = null; this.need.live = true;
    if (!s) return;
    s.id = uid(); s.bb = null; s.ts = Date.now();
    if (!s.shape && s.pts.length === STRIDE) { const p = Array.from(s.pts); s.pts = Float32Array.from(p.concat([p[0] + 0.05, p[1] + 0.05, p[2], p[3]])); }
    const page = L.page, before = page.strokes.slice();
    page.strokes.push(s);
    this.pushHistory({ k: 'str', items: [{ pid: page.id, before, after: page.strokes.slice() }] });
    this.markDirty(page);
    this.drawIncremental(page, s);
    // keep the last frame visible until main is repainted
    this.need.live = true;
    if (s.c) pushRecent(s.c);
    if (s.shape) { this.sel = { pid: page.id, sid: s.id }; this.need.ui = true; }
  }
  selStroke() {
    if (!this.sel) return null;
    const page = this.pageMap.get(this.sel.pid); if (!page) return null;
    const s = page.strokes.find(x => x.id === this.sel.sid); if (!s || !s.shape) return null;
    return { page, s };
  }
  deselect() { if (this.sel) { this.sel = null; this.need.ui = true; } }


  // ---------- notebook file on the device ----------
  async initFileLink() {
    if (!canLinkFiles()) return;
    const hd = await getHandle(this.nb.id); if (!hd) return;
    this.fileHandle = hd; this.fileLinked = await handlePermission(hd, false);
    this.syncSaveBtn();
  }
  syncSaveBtn() {
    const b = this.saveBtn; if (!b) return;
    b.querySelector('.dotmark')?.remove();
    const unsaved = !this.fileLinked && this.nb.fileSavedAt && (this.nb.updated || 0) > this.nb.fileSavedAt + 300;
    b.classList.toggle('linked', !!this.fileLinked);
    b.title = this.fileLinked ? `บันทึกลงไฟล์ "${this.fileHandle?.name}" อัตโนมัติ` : unsaved ? 'มีส่วนที่ยังไม่ได้บันทึกลงไฟล์' : 'บันทึกเป็นไฟล์ในเครื่อง';
    if (unsaved) b.append(h('span', { class: 'dotmark' }));
    if (this.fileLinked) b.append(h('span', { class: 'dotmark ok' }));
  }
  saveFileMenu(anchor) {
    const items = [{ header: this.fileLinked ? `ไฟล์: ${this.fileHandle.name} · บันทึกอัตโนมัติ` : this.nb.fileName ? `ไฟล์ล่าสุด: ${this.nb.fileName}` : 'สมุดเล่มนี้ยังไม่เคยบันทึกเป็นไฟล์' }];
    if (this.fileHandle && !this.fileLinked) items.push({ icon: 'check', label: 'เชื่อมไฟล์เดิมอีกครั้ง (บันทึกอัตโนมัติ)', action: async () => { this.fileLinked = await handlePermission(this.fileHandle, true); if (this.fileLinked) { await this.writeLinkedFile(true); toast('เชื่อมไฟล์แล้ว'); } this.syncSaveBtn(); } });
    items.push({ icon: 'save', label: this.fileLinked ? 'บันทึกลงไฟล์ตอนนี้' : 'บันทึกเป็นไฟล์ในเครื่อง', action: () => this.saveToFile(false) });
    if (canLinkFiles()) items.push({ icon: 'copy', label: 'บันทึกเป็นไฟล์ใหม่…', action: () => this.saveToFile(true) });
    items.push('-', { icon: 'folder', label: 'เปิดไฟล์สมุดอื่น', action: () => this.app.openFile() });
    menu(anchor, items, this.popOpts());
  }
  async saveToFile(forceNew) {
    await this.flush();
    const r = await this.app.saveNotebookToFile(this.nb, { nb: this.nb.id, pages: this.pages }, { forceNew });
    if (r && r.how === 'linked') { this.fileHandle = await getHandle(this.nb.id); this.fileLinked = true; }
    this.syncSaveBtn();
  }
  async writeLinkedFile(now) {
    if (!this.fileLinked || !this.fileHandle) return;
    clearTimeout(this.fileT);
    const run = async () => {
      try {
        const data = await buildBackup([this.nb.id], { nb: this.nb.id, pages: this.pages });
        await writeHandle(this.fileHandle, JSON.stringify(data));
        this.nb.fileSavedAt = Date.now(); await db.put('notebooks', { ...this.nb }); this.syncSaveBtn();
      } catch (e) { console.warn(e); this.fileLinked = false; this.syncSaveBtn(); toast('บันทึกลงไฟล์ไม่สำเร็จ แตะปุ่มบันทึกเพื่อเชื่อมไฟล์อีกครั้ง', 3500, 'warn'); }
    };
    if (now) return run();
    this.fileT = setTimeout(run, 2500);
  }

  // ---------- laser pointer ----------
  laserAdd(sx, sy) { const [wx, wy] = this.toWorld(sx, sy); this.laser.push({ x: wx, y: wy, t: performance.now() }); }
  redrawLaser() {
    const ctx = this.ctxLaser, R = this.R, now = performance.now(), LIFE = 900;
    while (this.laser.length && now - this.laser[0].t > LIFE) this.laser.shift();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.cvLaser.width, this.cvLaser.height);
    this.laserDirty = this.laser.length > 0;
    if (!this.laser.length) return;
    ctx.setTransform(R, 0, 0, R, 0, 0);
    drawLaserTrail(ctx, this.laser.map(p => ({ x: this.ox + p.x * this.z, y: this.oy + p.y * this.z, a: 1 - (now - p.t) / LIFE })), !!this.lasering);
  }

  // ---------- lasso ----------
  startLasso(e, page, sx, sy) {
    this.clearLasso();
    const r = this.rects.get(page.id), [wx, wy] = this.toWorld(sx, sy);
    this.lassoDraw = { id: e.pointerId, page, rx: r.x, ry: r.y, pts: [wx - r.x, wy - r.y] };
    this.need.ui = true;
  }
  finishLasso() {
    const L = this.lassoDraw; this.lassoDraw = null; this.need.ui = true;
    if (!L || L.pts.length < 8) return;
    const poly = L.pts, inside = (x, y) => { let c = false; for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) { const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; };
    const ids = new Set();
    for (const s of L.page.strokes) {
      if (s.t === 'img' || s.t === 'text') { if (inside(s.x + s.w / 2, s.y + s.h / 2)) ids.add(s.id); continue; }
      const xy = s.shape ? shapePolyline(s.shape, 24) : s.pts, st = s.shape ? 2 : STRIDE;
      let n = 0, k = 0; const step = Math.max(1, Math.floor(xy.length / st / 40));
      for (let i = 0; i < xy.length; i += st * step) { n++; if (inside(xy[i], xy[i + 1])) k++; }
      if (n && k / n >= 0.5) ids.add(s.id);
    }
    if (!ids.size) { toast('ไม่มีอะไรอยู่ในวงที่วาด', 1200); return; }
    this.lsel = { pid: L.page.id, ids };
    this.updateLassoBB(); this.buildLassoBar();
  }
  lassoItems() { const p = this.pageMap.get(this.lsel?.pid); return p ? p.strokes.filter(s => this.lsel.ids.has(s.id)) : []; }
  updateLassoBB() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of this.lassoItems()) { const b = strokeBB(s); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    if (!isFinite(x0)) { this.clearLasso(); return; }
    this.lsel.bb = [x0, y0, x1, y1]; this.need.ui = true;
  }
  clearLasso() { if (this.lsel || this.lassoDraw) { this.lsel = null; this.lassoDraw = null; this.need.ui = true; } if (this.imgBar && this.imgBar.dataset.kind === 'lasso') this.imgBar.classList.add('hidden'); }
  lassoScreenBB() {
    const r = this.rects.get(this.lsel.pid), b = this.lsel.bb;
    return [this.ox + (r.x + b[0]) * this.z, this.oy + (r.y + b[1]) * this.z, this.ox + (r.x + b[2]) * this.z, this.oy + (r.y + b[3]) * this.z];
  }
  lassoHandleDown(e, sx, sy) {
    const [X0, Y0, X1, Y1] = this.lassoScreenBB(), tol = e.pointerType === 'touch' ? 28 : 18;
    const page = this.pageMap.get(this.lsel.pid), r = this.rects.get(page.id), [wx, wy] = this.toWorld(sx, sy);
    const base = { id: e.pointerId, page, orig: new Map(this.lassoItems().map(s => [s.id, s])), before: page.strokes.slice(), sx: wx - r.x, sy: wy - r.y, bb: this.lsel.bb.slice() };
    const cx = (X0 + X1) / 2;
    let kind = null, corner = null;
    if (Math.hypot(sx - cx, sy - (Y0 - 34)) < tol) kind = 'rotate';
    else for (const [c, x, y] of [['tl', X0, Y0], ['tr', X1, Y0], ['bl', X0, Y1], ['br', X1, Y1]]) if (Math.hypot(sx - x, sy - y) < tol) { kind = 'scale'; corner = c; }
    if (!kind && sx > X0 - 6 && sx < X1 + 6 && sy > Y0 - 6 && sy < Y1 + 6) kind = 'move';
    if (!kind) { this.clearLasso(); return false; }
    this.lxf = { ...base, kind, corner };
    this.imgBar.classList.add('hidden');
    try { this.stage.setPointerCapture(e.pointerId); } catch { }
    return true;
  }
  lassoDrag(sx, sy) {
    const X = this.lxf, r = this.rects.get(X.page.id), [wx, wy] = this.toWorld(sx, sy), px = wx - r.x, py = wy - r.y, b = X.bb;
    let M, sc = 1, ang = 0;
    if (X.kind === 'move') M = [1, 0, 0, 1, px - X.sx, py - X.sy];
    else if (X.kind === 'scale') {
      const ax = X.corner.includes('l') ? b[2] : b[0], ay = X.corner.includes('t') ? b[3] : b[1];
      const d0 = Math.hypot(X.sx - ax, X.sy - ay) || 1; sc = Math.max(0.05, Math.hypot(px - ax, py - ay) / d0);
      M = [sc, 0, 0, sc, ax - sc * ax, ay - sc * ay];
    } else {
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      ang = Math.atan2(py - cy, px - cx) - Math.atan2(X.sy - cy, X.sx - cx);
      const snap = Math.round(ang / (Math.PI / 4)) * Math.PI / 4; if (Math.abs(ang - snap) < 0.06) ang = snap;
      const c = Math.cos(ang), s = Math.sin(ang); M = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
    }
    X.page.strokes = X.before.map(s => X.orig.has(s.id) ? transformStroke(s, M, sc, ang) : s);
    this.updateLassoBB(); this.need.main = true;
  }
  endLassoDrag() {
    const X = this.lxf; this.lxf = null;
    this.pushHistory({ k: 'str', items: [{ pid: X.page.id, before: X.before, after: X.page.strokes.slice() }] });
    this.markDirty(X.page); this.updateLassoBB(); this.buildLassoBar();
  }
  lassoEdit(fn) {
    const page = this.pageMap.get(this.lsel.pid), before = page.strokes.slice();
    fn(page);
    this.pushHistory({ k: 'str', items: [{ pid: page.id, before, after: page.strokes.slice() }] });
    this.markDirty(page); this.need.main = true;
    if (this.lsel) { this.updateLassoBB(); if (this.lsel) this.buildLassoBar(); }
  }
  buildLassoBar() {
    const bar = this.imgBar; bar.innerHTML = ''; bar.classList.remove('hidden'); bar.dataset.kind = 'lasso';
    const B = (ic, label, fn, danger) => { const b = h('button', { class: 'chip' + (danger ? ' danger' : '') }, icon(ic), h('span', {}, label)); b.onclick = fn; return b; };
    for (const col of prefs.favorites.slice(0, 6)) {
      const b = h('button', { class: 'sw', title: 'เปลี่ยนสีเป็น ' + col }, h('i', { style: { background: col } }));
      b.onclick = () => this.lassoEdit((page) => { page.strokes = page.strokes.map(s => this.lsel.ids.has(s.id) && s.t !== 'img' && s.t !== 'hl' ? { ...s, c: col, bb: null } : s); });
      bar.append(b);
    }
    bar.append(h('div', { class: 'vsep', style: { width: '1px', height: '26px', background: 'rgba(255,255,255,.2)', margin: '0 4px' } }),
      B('copy', 'ทำสำเนา', () => this.lassoEdit((page) => { const ids = new Set(); const copies = this.lassoItems().map(s => { const n = transformStroke(s, [1, 0, 0, 1, 18, 18], 1, 0); n.id = uid(); ids.add(n.id); return n; }); page.strokes.push(...copies); this.lsel.ids = ids; })),
      B('trash', 'ลบ', () => { this.lassoEdit((page) => { page.strokes = page.strokes.filter(s => !this.lsel.ids.has(s.id)); }); this.clearLasso(); }, true),
      B('check', 'เสร็จ', () => this.clearLasso()));
    this.placeLassoBar();
  }
  placeLassoBar() {
    if (!this.lsel || !this.lsel.bb) return;
    const [X0, Y0, X1, Y1] = this.lassoScreenBB(), bw = this.imgBar.offsetWidth || 480, bh = this.imgBar.offsetHeight || 50;
    let y = Y0 - bh - 52; if (y < 64) y = Math.min(this.H - bh - 10, Y1 + 16);
    this.imgBar.style.left = Math.max(8, Math.min(this.W - bw - 8, (X0 + X1) / 2 - bw / 2)) + 'px'; this.imgBar.style.top = Math.max(8, y) + 'px';
  }
  drawLassoUI(ctx) {
    const R = this.R;
    if (this.lassoDraw) {
      const L = this.lassoDraw; ctx.setTransform(R, 0, 0, R, 0, 0); ctx.beginPath();
      for (let i = 0; i < L.pts.length; i += 2) { const x = this.ox + (L.rx + L.pts[i]) * this.z, y = this.oy + (L.ry + L.pts[i + 1]) * this.z; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.setLineDash([7, 6]); ctx.lineWidth = 2; ctx.strokeStyle = '#2F5BEA'; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(47,91,234,.06)'; ctx.fill();
    }
    if (this.lsel && this.lsel.bb) {
      const [X0, Y0, X1, Y1] = this.lassoScreenBB(); ctx.setTransform(R, 0, 0, R, 0, 0);
      ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#2F5BEA'; ctx.strokeRect(X0, Y0, X1 - X0, Y1 - Y0); ctx.setLineDash([]);
      const cx = (X0 + X1) / 2; ctx.beginPath(); ctx.moveTo(cx, Y0); ctx.lineTo(cx, Y0 - 34); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.lineWidth = 3;
      for (const [x, y] of [[X0, Y0], [X1, Y0], [X0, Y1], [X1, Y1], [cx, Y0 - 34]]) { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(cx, Y0 - 34, 4.5, -2.4, 1.6); ctx.lineWidth = 1.8; ctx.stroke();
      if (!this.lxf) this.placeLassoBar();
    }
  }

  // ---------- text boxes ----------
  openTextDialog(page, existing, x, y) {
    const sizes = [['18', 'เล็ก'], ['24', 'กลาง'], ['32', 'ใหญ่'], ['44', 'ใหญ่มาก'], ['60', 'หัวข้อ']];
    let size = existing ? existing.size : (prefs.textSize || 24), bold = existing ? !!existing.bold : false, color = existing ? existing.c : prefs.penColor;
    const ta = h('textarea', { class: 'field', rows: 5, style: { height: 'auto', minHeight: '150px', padding: '10px 14px', lineHeight: '1.35', resize: 'vertical' }, placeholder: 'พิมพ์ข้อความ…' });
    ta.value = existing ? existing.text : '';
    const preview = () => { ta.style.fontWeight = bold ? '700' : '400'; ta.style.color = color; ta.style.fontSize = Math.min(40, Math.max(20, size)) + 'px'; };
    const colors = h('div', { style: { display: 'flex', gap: '2px', flexWrap: 'wrap' } });
    const paintC = () => { colors.innerHTML = ''; for (const c of prefs.favorites.slice(0, 10)) { const b = h('button', { class: 'sw' + (c.toUpperCase() === String(color).toUpperCase() ? ' on' : '') }, h('i', { style: { background: c } })); b.onclick = () => { color = c; paintC(); preview(); }; colors.append(b); } };
    paintC();
    const body = h('div', {}, ta,
      h('div', { class: 'lbl' }, 'ขนาดตัวอักษร'), seg(sizes, String(size), v => { size = +v; prefs.textSize = size; savePrefs(); preview(); }),
      h('div', { class: 'row' }, h('span', {}, 'ตัวหนา'), toggle(bold, v => { bold = v; preview(); })),
      h('div', { class: 'lbl' }, 'สี'), colors);
    preview();
    dialog(existing ? 'แก้ไขข้อความ' : 'กล่องข้อความ', body, [{ label: 'ยกเลิก' }, { label: existing ? 'บันทึก' : 'ใส่ข้อความ', cls: 'prim', flex: 2, action: () => {
      const text = ta.value.replace(/\s+$/, '');
      const before = page.strokes.slice();
      if (!text) { if (existing) { page.strokes = page.strokes.filter(s => s !== existing); this.deselectImage(); } else return; }
      else {
        const o = { id: existing ? existing.id : uid(), t: 'text', text, size, bold, c: color, a: 1, x: existing ? existing.x : x, y: existing ? existing.y : y - size * 0.7, ts: Date.now() };
        const m = measureText(o); o.w = m.w; o.h = m.h;
        if (existing) page.strokes = page.strokes.map(s => s === existing ? o : s); else page.strokes.push(o);
        this.selectImage(page.id, o.id);
      }
      this.pushHistory({ k: 'str', items: [{ pid: page.id, before, after: page.strokes.slice() }] });
      this.markDirty(page); this.need.main = true;
    } }], { width: 620 });
    setTimeout(() => ta.focus(), 80);
  }

  // ---------- images ----------
  async pickImage() {
    const f = await pickFile('image/*'); if (!f) return;
    this.insertImage(f, { crop: true });
  }
  async insertImage(file, { crop = true } = {}) {
    let n; const bz = busy('กำลังเปิดรูป…');
    try { n = await normalizeImage(file); } catch (e) { toast('เปิดรูปนี้ไม่ได้', 2500, 'warn'); return; } finally { bz.done(); }
    let obj = { id: uid(), t: 'img', blob: n.blob, iw: n.iw, ih: n.ih, crop: { x: 0, y: 0, w: 1, h: 1 }, mask: null, x: 0, y: 0, w: 1, h: 1, ts: Date.now() };
    if (crop) {
      const r = await openCropper(obj, { title: 'ครอปหรือตัดรูปก่อนแทรก', okLabel: 'แทรกรูป' });
      if (!r) return;
      obj.crop = r.crop; obj.mask = r.mask;
    }
    const page = this.currentPage(), P = dims(page), rc = this.rects.get(page.id);
    const aw = obj.crop.w * obj.iw, ah = obj.crop.h * obj.ih;
    const w = Math.min(P.w * 0.6, aw * 0.75), hh = w * ah / aw;
    const fitH = Math.min(1, P.h * 0.6 / hh);
    obj.w = w * fitH; obj.h = hh * fitH;
    // centre of the visible part of the page
    const [cx, cy] = this.toWorld(this.W / 2, this.H / 2);
    obj.x = Math.max(4, Math.min(P.w - obj.w - 4, cx - rc.x - obj.w / 2));
    obj.y = Math.max(4, Math.min(P.h - obj.h - 4, cy - rc.y - obj.h / 2));
    const before = page.strokes.slice();
    page.strokes.push(obj);
    this.pushHistory({ k: 'str', items: [{ pid: page.id, before, after: page.strokes.slice() }] });
    this.markDirty(page); this.need.main = true;
    this.selectImage(page.id, obj.id);
    if (!crop) toast('วางรูปแล้ว · กดค้างบนรูปเพื่อเลือกอีกครั้ง', 2200);
  }
  imgAt(page, x, y) {
    for (let i = page.strokes.length - 1; i >= 0; i--) { const s = page.strokes[i]; if ((s.t === 'img' || s.t === 'text') && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s; }
    return null;
  }
  selImage() {
    if (!this.imgSel) return null;
    const page = this.pageMap.get(this.imgSel.pid); if (!page) return null;
    const s = page.strokes.find(x => x.id === this.imgSel.sid && (x.t === 'img' || x.t === 'text')); return s ? { page, s } : null;
  }
  selectImage(pid, sid) { this.deselect(); this.clearLasso(); this.imgSel = { pid, sid }; this.need.ui = true; this.imgBar.dataset.kind = 'img'; this.buildImgBar(); }
  deselectImage() { if (this.imgSel) { this.imgSel = null; this.imgBar.classList.add('hidden'); this.need.ui = true; } }
  replaceImg(page, oldS, newS, history = true) {
    const before = page.strokes.slice(); const i = page.strokes.indexOf(oldS); if (i < 0) return;
    newS.bb = null; page.strokes[i] = newS;
    if (history) this.pushHistory({ k: 'str', items: [{ pid: page.id, before, after: page.strokes.slice() }] });
    this.markDirty(page); this.imgSel = { pid: page.id, sid: newS.id }; this.need.main = this.need.ui = true;
  }
  buildImgBar() {
    const bar = this.imgBar; bar.innerHTML = ''; bar.classList.remove('hidden');
    const B = (ic, label, fn, danger) => { const b = h('button', { class: 'chip' + (danger ? ' danger' : '') }, icon(ic), h('span', {}, label)); b.onclick = fn; return b; };
    const cur = this.selImage();
    if (cur && cur.s.t === 'text') {
      const del = () => { const sel = this.selImage(); if (!sel) return; const before = sel.page.strokes.slice(); sel.page.strokes = sel.page.strokes.filter(x => x !== sel.s); this.pushHistory({ k: 'str', items: [{ pid: sel.page.id, before, after: sel.page.strokes.slice() }] }); this.markDirty(sel.page); this.deselectImage(); this.need.main = true; };
      bar.append(B('edit', 'แก้ไข', () => { const sel = this.selImage(); if (sel) this.openTextDialog(sel.page, sel.s); }),
        B('copy', 'ทำสำเนา', () => { const sel = this.selImage(); if (!sel) return; const ns = { ...sel.s, id: uid(), x: sel.s.x + 14, y: sel.s.y + 14, bb: null }; const before = sel.page.strokes.slice(); sel.page.strokes.push(ns); this.pushHistory({ k: 'str', items: [{ pid: sel.page.id, before, after: sel.page.strokes.slice() }] }); this.markDirty(sel.page); this.selectImage(sel.page.id, ns.id); this.need.main = true; }),
        B('trash', 'ลบ', del, true), B('check', 'เสร็จ', () => this.deselectImage()));
      this.placeImgBar(); return;
    }
    bar.append(
      B('crop', 'ครอป/ตัด', async () => { const sel = this.selImage(); if (!sel) return; const r = await openCropper(sel.s, { title: 'ครอปหรือตัดรูป', okLabel: 'ใช้' }); if (!r) return; const s0 = sel.s; const aw0 = s0.crop.w * s0.iw, ah0 = s0.crop.h * s0.ih, aw = r.crop.w * s0.iw, ah = r.crop.h * s0.ih; const k = s0.w / aw0; const ns = { ...s0, crop: r.crop, mask: r.mask, w: aw * k, h: ah * k, x: s0.x + (r.crop.x - s0.crop.x) * s0.iw * k, y: s0.y + (r.crop.y - s0.crop.y) * s0.ih * k }; this.replaceImg(sel.page, s0, ns); }),
      B('rotate', 'หมุน', async () => { const sel = this.selImage(); if (!sel) return; const ns = await rotateBlob(sel.s); ns.id = uid(); this.replaceImg(sel.page, sel.s, ns); }),
      B('layer', 'ไว้หลังสุด', () => { const sel = this.selImage(); if (!sel) return; const before = sel.page.strokes.slice(); const st = sel.page.strokes.filter(x => x !== sel.s); st.unshift(sel.s); sel.page.strokes = st; this.pushHistory({ k: 'str', items: [{ pid: sel.page.id, before, after: st.slice() }] }); this.markDirty(sel.page); this.need.main = true; toast('ย้ายรูปไปไว้ล่างสุดแล้ว', 1200); }),
      B('copy', 'ทำสำเนา', () => { const sel = this.selImage(); if (!sel) return; const ns = { ...sel.s, id: uid(), x: sel.s.x + 16, y: sel.s.y + 16, bb: null }; const before = sel.page.strokes.slice(); sel.page.strokes.push(ns); this.pushHistory({ k: 'str', items: [{ pid: sel.page.id, before, after: sel.page.strokes.slice() }] }); this.markDirty(sel.page); this.selectImage(sel.page.id, ns.id); this.need.main = true; }),
      B('trash', 'ลบ', () => { const sel = this.selImage(); if (!sel) return; const before = sel.page.strokes.slice(); sel.page.strokes = sel.page.strokes.filter(x => x !== sel.s); this.pushHistory({ k: 'str', items: [{ pid: sel.page.id, before, after: sel.page.strokes.slice() }] }); this.markDirty(sel.page); this.deselectImage(); this.need.main = true; }, true),
      B('check', 'เสร็จ', () => this.deselectImage()));
    this.placeImgBar();
  }
  placeImgBar() {
    const sel = this.selImage(); if (!sel) { this.imgBar.classList.add('hidden'); return; }
    const r = this.rects.get(sel.page.id); const s = sel.s;
    const x = this.ox + (r.x + s.x + s.w / 2) * this.z, yTop = this.oy + (r.y + s.y) * this.z, yBot = this.oy + (r.y + s.y + s.h) * this.z;
    const bw = this.imgBar.offsetWidth || 520, bh = this.imgBar.offsetHeight || 50;
    let y = yTop - bh - 16; if (y < 64) y = Math.min(this.H - bh - 10, yBot + 16);
    this.imgBar.style.left = Math.max(8, Math.min(this.W - bw - 8, x - bw / 2)) + 'px';
    this.imgBar.style.top = Math.max(8, y) + 'px';
  }
  imgHandleAt(sx, sy, touch) {
    const sel = this.selImage(); if (!sel) return null;
    const r = this.rects.get(sel.page.id), s = sel.s, tol = touch ? 28 : 18;
    const X0 = this.ox + (r.x + s.x) * this.z, Y0 = this.oy + (r.y + s.y) * this.z, X1 = X0 + s.w * this.z, Y1 = Y0 + s.h * this.z;
    const cs = [['tl', X0, Y0], ['tr', X1, Y0], ['bl', X0, Y1], ['br', X1, Y1]];
    for (const [id, x, y] of cs) if (Math.hypot(sx - x, sy - y) < tol) return { kind: 'resize', corner: id, sel };
    if (sx > X0 && sx < X1 && sy > Y0 && sy < Y1) return { kind: 'move', sel };
    return null;
  }
  dragImage(sx, sy) {
    const d = this.imgDrag, s0 = d.orig, [wx, wy] = this.toWorld(sx, sy), r = this.rects.get(d.page.id);
    const px = wx - r.x, py = wy - r.y;
    let ns;
    if (d.kind === 'move') ns = { ...s0, x: s0.x + px - d.px, y: s0.y + py - d.py, bb: null };
    else {
      const ax = d.corner.includes('l') ? s0.x + s0.w : s0.x, ay = d.corner.includes('t') ? s0.y + s0.h : s0.y;
      const ratio = s0.h / s0.w;
      let w = Math.max(20, Math.abs(px - ax)); let hh = w * ratio;
      if (Math.abs(py - ay) > hh) { hh = Math.max(20 * ratio, Math.abs(py - ay)); w = hh / ratio; }
      ns = { ...s0, w, h: hh, x: d.corner.includes('l') ? ax - w : ax, y: d.corner.includes('t') ? ay - hh : ay, bb: null };
      if (s0.t === 'text') ns.size = Math.max(6, s0.size * w / s0.w);
    }
    const st = d.page.strokes, i = st.indexOf(d.cur); if (i >= 0) st[i] = ns; d.cur = ns;
    this.imgSel = { pid: d.page.id, sid: ns.id };
    this.need.main = this.need.ui = true;
  }

  // ---------- eraser ----------
  startErase(e, page, sx, sy) {
    this.erasing = { id: e.pointerId, type: e.pointerType, before: new Map(), last: null, mode: prefs.eraser.mode };
    this.eraseAt(sx, sy);
    this.erCursor = { x: sx, y: sy }; this.need.ui = true;
  }
  eraseAt(sx, sy) {
    const E = this.erasing; const [wx, wy] = this.toWorld(sx, sy);
    const r = prefs.eraser.size / 2;
    const pts = [];
    if (E.last) { const [lx, ly] = E.last, d = Math.hypot(wx - lx, wy - ly), n = Math.ceil(d / Math.max(0.5, r / 2)); for (let i = 1; i <= n; i++) pts.push([lx + (wx - lx) * i / n, ly + (wy - ly) * i / n]); }
    else pts.push([wx, wy]);
    E.last = [wx, wy];
    let changed = false;
    for (const [x, y] of pts) {
      const page = this.pageAt(x, y, r); if (!page) continue;
      const rc = this.rects.get(page.id); const px = x - rc.x, py = y - rc.y;
      if (E.mode === 'stroke') changed = this.eraseStrokes(page, px, py, r) || changed;
      else changed = this.eraseArea(page, px, py, r) || changed;
    }
    if (changed) this.need.main = true;
  }
  snapshotBefore(page) { const E = this.erasing; if (!E.before.has(page.id)) E.before.set(page.id, page.strokes.slice()); }
  eraseStrokes(page, x, y, r) {
    let hit = false;
    const keep = [];
    for (const s of page.strokes) {
      if (s.t === 'img' || s.t === 'text') { keep.push(s); continue; }
      const b = strokeBB(s);
      if (x + r < b[0] || x - r > b[2] || y + r < b[1] || y - r > b[3]) { keep.push(s); continue; }
      if (hitStroke(s, x, y, r)) { if (!hit) this.snapshotBefore(page); hit = true; } else keep.push(s);
    }
    if (hit) { page.strokes = keep; this.markDirty(page); }
    return hit;
  }
  eraseArea(page, x, y, r) {
    let changed = false; const out = [];
    for (const s of page.strokes) {
      if (s.t === 'img' || s.t === 'text') { out.push(s); continue; }
      const b = strokeBB(s);
      if (x + r < b[0] || x - r > b[2] || y + r < b[1] || y - r > b[3]) { out.push(s); continue; }
      const parts = splitStroke(s, x, y, r);
      if (parts === null) { out.push(s); continue; }
      if (!changed) this.snapshotBefore(page);
      changed = true; out.push(...parts);
    }
    if (changed) { page.strokes = out; this.markDirty(page); }
    return changed;
  }
  finishErase() {
    const E = this.erasing; this.erasing = null; this.erCursor = null; this.need.ui = true;
    if (!E || !E.before.size) return;
    const items = [...E.before].map(([pid, before]) => ({ pid, before, after: this.pageMap.get(pid).strokes.slice() }));
    this.pushHistory({ k: 'str', items });
  }

  // ---------- history ----------
  pushHistory(op) { this.undoStack.push(op); if (this.undoStack.length > 300) this.undoStack.shift(); this.redoStack = []; this.updateUndoBtns(); }
  applyOp(op, dir) {
    if (op.k === 'str') for (const it of op.items) { const p = this.pageMap.get(it.pid); if (p) { p.strokes = (dir ? it.after : it.before).slice(); this.markDirty(p); } }
    else if (op.k === 'pages') { this.nb.pages = (dir ? op.after : op.before).slice(); for (const id of op.before.concat(op.after)) { if (this.nb.pages.includes(id)) { this.deleted.delete(id); this.markDirty(this.pageMap.get(id)); } else this.deleted.add(id); } this.saveNb(); this.relayout(false); this.renderThumbs(); }
    else if (op.k === 'props') for (const it of op.items) { const p = this.pageMap.get(it.pid); Object.assign(p, dir ? it.after : it.before); this.markDirty(p); }
    if (op.k === 'props') this.relayout(false);
    this.deselect(); this.deselectImage(); this.clearLasso(); this.need.main = true;
  }
  undo() { if (this.live || this.erasing) return; const op = this.undoStack.pop(); if (!op) return; this.applyOp(op, 0); this.redoStack.push(op); this.updateUndoBtns(); }
  redo() { if (this.live || this.erasing) return; const op = this.redoStack.pop(); if (!op) return; this.applyOp(op, 1); this.undoStack.push(op); this.updateUndoBtns(); }

  // ---------- pages ----------
  newPageObj(props = {}) {
    const cur = this.currentPage();
    const bg = props.bg || (cur?.bg === 'pdf' ? 'grid' : cur?.bg) || 'grid';
    return { id: uid(), nb: this.nb.id, size: props.size || (cur?.pdf ? (cur.pw > cur.ph ? 'L' : 'P') : cur?.size) || 'P', bg, strokes: [] };
  }
  addPage(props, afterId) {
    const p = this.newPageObj(props); this.pageMap.set(p.id, p);
    const before = this.nb.pages.slice();
    const at = afterId ? this.nb.pages.indexOf(afterId) + 1 : this.nb.pages.length;
    this.nb.pages.splice(at, 0, p.id);
    this.pushHistory({ k: 'pages', before, after: this.nb.pages.slice() });
    this.markDirty(p); this.saveNb(); this.relayout(false); this.renderThumbs(); this.scrollToPage(p.id);
    return p;
  }
  async insertPdf(file, afterId) {
    const b = busy('กำลังแทรก PDF…', file.name);
    let r;
    try { r = await importPdf(file, (i, n) => b.set(null, `อ่านแล้ว ${i} จาก ${n} หน้า`, i / n)); }
    catch (e) { console.error(e); toast('เปิด PDF ไม่ได้: ' + (e.message || e), 3500, 'warn'); return; }
    finally { b.done(); }
    const before = this.nb.pages.slice();
    let at = afterId ? this.nb.pages.indexOf(afterId) + 1 : this.nb.pages.length;
    const ids = [];
    r.sizes.forEach((s, i) => { const p = { id: uid(), nb: this.nb.id, size: s.w > s.h ? 'L' : 'P', pw: s.w, ph: s.h, bg: 'pdf', pdf: { id: r.id, n: i + 1 }, strokes: [] }; this.pageMap.set(p.id, p); this.nb.pages.splice(at++, 0, p.id); ids.push(p.id); this.markDirty(p); });
    this.pushHistory({ k: 'pages', before, after: this.nb.pages.slice() });
    this.saveNb(); this.relayout(false); this.renderThumbs(); this.scrollToPage(ids[0]);
    toast(`แทรก PDF ${ids.length} หน้าแล้ว`);
  }
  duplicatePage(pid) {
    const src = this.pageMap.get(pid);
    const p = { id: uid(), nb: this.nb.id, size: src.size, bg: src.bg, pw: src.pw, ph: src.ph, pdf: src.pdf, strokes: src.strokes.map(s => ({ ...s, id: uid(), pts: s.pts ? new Float32Array(s.pts) : undefined, shape: s.shape ? JSON.parse(JSON.stringify(s.shape)) : undefined })) };
    this.pageMap.set(p.id, p);
    const before = this.nb.pages.slice(); this.nb.pages.splice(this.nb.pages.indexOf(pid) + 1, 0, p.id);
    this.pushHistory({ k: 'pages', before, after: this.nb.pages.slice() });
    this.markDirty(p); this.saveNb(); this.relayout(false); this.renderThumbs(); this.scrollToPage(p.id);
    toast('ทำสำเนาหน้าแล้ว');
  }
  async deletePage(pid) {
    if (this.nb.pages.length <= 1) { toast('ต้องมีอย่างน้อย 1 หน้า'); return; }
    const p = this.pageMap.get(pid);
    if (p.strokes.length && !(await confirmBox('ลบหน้านี้?', 'กดย้อนกลับได้ถ้าลบผิด', { ok: 'ลบหน้า', danger: true }))) return;
    const before = this.nb.pages.slice(); const i = before.indexOf(pid);
    this.nb.pages.splice(i, 1); this.deleted.add(pid);
    this.pushHistory({ k: 'pages', before, after: this.nb.pages.slice() });
    this.saveNb(); this.relayout(false); this.renderThumbs();
    this.scrollToPage(this.nb.pages[Math.min(i, this.nb.pages.length - 1)]);
  }
  movePage(pid, delta) {
    const before = this.nb.pages.slice(), i = before.indexOf(pid), j = i + delta;
    if (j < 0 || j >= before.length) return;
    this.nb.pages.splice(i, 1); this.nb.pages.splice(j, 0, pid);
    this.pushHistory({ k: 'pages', before, after: this.nb.pages.slice() });
    this.saveNb(); this.relayout(false); this.renderThumbs(); this.scrollToPage(pid);
  }
  setPageProps(page, props) {
    if (page.pdf) { toast('หน้า PDF เปลี่ยนพื้นไม่ได้'); return; }
    const before = { bg: page.bg, size: page.size || 'P' };
    Object.assign(page, props);
    this.pushHistory({ k: 'props', items: [{ pid: page.id, before, after: { bg: page.bg, size: page.size } }] });
    this.markDirty(page); this.relayout(false); this.need.main = true;
  }
  setAllPagesProps(props) {
    const items = this.pages.filter(p => !p.pdf).map(p => { const b = { bg: p.bg, size: p.size || 'P' }; Object.assign(p, props); this.markDirty(p); return { pid: p.id, before: b, after: { bg: p.bg, size: p.size } }; });
    this.pushHistory({ k: 'props', items }); this.relayout(false); this.need.main = true;
  }

  // ---------- thumbnails panel ----------
  toggleThumbs(force) {
    const open = force ?? !this.thumbs.classList.contains('open');
    this.thumbs.classList.toggle('open', open); this.stage.classList.toggle('thumbs-open', open);
    this.btnPages?.classList.toggle('on', open);
    if (open) this.renderThumbs();
  }
  thumbsDirtyAll() { this.thumbCache = new Map(); if (this.thumbs.classList.contains('open')) this.renderThumbs(); }
  renderThumbs() {
    if (!this.thumbs.classList.contains('open')) return;
    this.thumbCache ||= new Map();
    const t = this.thumbs;
    const oldList = $('.list', t), keep = oldList ? oldList.scrollTop : null;
    t.innerHTML = '';
    const list = h('div', { class: 'list' });
    this.thumbList = list;
    const cur = this.currentPage();
    this.thumbIO?.disconnect();
    this.thumbIO = new IntersectionObserver((ents) => { for (const en of ents) { en.target._vis = en.isIntersecting; if (en.isIntersecting) this.drawThumb(en.target); } }, { root: list, rootMargin: '300px 0px' });
    this.nb.pages.forEach((pid, i) => {
      const p = this.pageMap.get(pid); if (!p) return;
      const P = dims(p); const w = 128 * (P.w > P.h ? 1 : Math.min(1, P.w / PAGE.P.w)), hh = w * P.h / P.w;
      const cv = h('canvas');
      const th = h('div', { class: 'th' + (cur && cur.id === pid ? ' cur' : ''), 'data-pid': pid }, h('div', { class: 'pg', style: { width: w + 'px', height: hh + 'px' } }, cv), h('span', { class: 'no' }, String(i + 1)));
      th._w = w;
      th.onclick = () => { this.scrollToPage(pid); this.markThumbCur(true); };
      list.append(th);
      const c = this.thumbCache.get(pid);
      if (c) { cv.width = c.c.width; cv.height = c.c.height; cv.getContext('2d').drawImage(c.c, 0, 0); }
      this.thumbIO.observe(th);
    });
    // stop the canvas from scrolling while the list is being swiped
    list.addEventListener('scroll', () => { this.thumbScrollT = performance.now(); }, { passive: true });
    const B = (ic, title, fn) => { const b = h('button', { class: 'btn', title }, icon(ic)); b.onclick = fn; return b; };
    const add = h('button', { class: 'pill sec' }, icon('plus'), 'เพิ่มหน้า');
    add.onclick = () => this.addPageMenu(add);
    const acts = h('div', { class: 'acts' }, add,
      B('up', 'เลื่อนหน้าขึ้น', () => this.movePage(this.currentPage().id, -1)),
      B('down', 'เลื่อนหน้าลง', () => this.movePage(this.currentPage().id, 1)),
      B('copy', 'ทำสำเนาหน้า', () => this.duplicatePage(this.currentPage().id)),
      B('trash', 'ลบหน้า', () => this.deletePage(this.currentPage().id)));
    t.append(list, acts);
    if (keep != null) list.scrollTop = keep;
    else requestAnimationFrame(() => { const c = $('.th.cur', list); if (c) c.scrollIntoView({ block: 'center' }); });
  }
  thumbKey(p) { return p.strokes.length + ':' + p.bg + p.size + this.paper + ':' + (p._ver || 0); }
  drawThumb(th) {
    const pid = th.dataset.pid, p = this.pageMap.get(pid); if (!p) return;
    const key = this.thumbKey(p), c = this.thumbCache.get(pid);
    if (c && c.key === key && !c.partial) return;
    if (th._q) return; th._q = true;
    requestAnimationFrame(() => {
      th._q = false;
      if (!th.isConnected) return;
      const cv = $('canvas', th), w = th._w * Math.min(2, devicePixelRatio || 1);
      const P = dims(p);
      const partial = !!p.pdf && !pdfBitmap(p, w / P.w, 1);
      renderPageTo(cv, p, this.paper, w);
      const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; c2.getContext('2d').drawImage(cv, 0, 0);
      this.thumbCache.set(pid, { key, c: c2, partial });
    });
  }
  refreshThumbs() { // redraw visible thumbs only (after PDF/image loads or edits)
    if (!this.thumbList?.isConnected) return;
    for (const th of this.thumbList.children) if (th._vis) this.drawThumb(th);
  }
  markThumbCur(scroll) {
    const list = this.thumbList; if (!list?.isConnected) return;
    const cur = this.currentPage(); if (!cur) return;
    const old = $('.th.cur', list);
    if (old && old.dataset.pid === cur.id) return;
    old?.classList.remove('cur');
    const n = list.querySelector(`.th[data-pid="${cur.id}"]`); if (!n) return;
    n.classList.add('cur');
    // follow the page while writing/scrolling the paper, but not while the user swipes the list
    if (scroll || performance.now() - (this.thumbScrollT || 0) > 800) {
      const r = n.getBoundingClientRect(), lr = list.getBoundingClientRect();
      if (r.top < lr.top || r.bottom > lr.bottom) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  addPageMenu(anchor) {
    const cur = this.currentPage();
    let bg = cur.bg, size = cur.size || 'P';
    const box = h('div', { style: { width: '330px' } },
      h('div', { class: 'lbl', style: { marginTop: 0 } }, 'พื้นกระดาษ'), seg([['blank', 'เปล่า'], ['lines', 'เส้น'], ['grid', 'ตาราง'], ['dots', 'จุด']], bg, v => bg = v),
      h('div', { class: 'lbl' }, 'ขนาด'), seg([['P', 'A4 แนวตั้ง'], ['L', 'A4 แนวนอน']], size, v => size = v));
    const ok = h('button', { class: 'pill prim', style: { width: '100%', marginTop: '14px' } }, icon('plus'), 'เพิ่มต่อจากหน้านี้');
    const end = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '4px' } }, 'เพิ่มไว้ท้ายสมุด');
    ok.onclick = () => { close(); this.addPage({ bg, size }, cur.id); };
    const pdfB = h('button', { class: 'pill sec', style: { width: '100%', marginTop: '8px' } }, icon('pdf'), 'แทรกไฟล์ PDF ต่อจากหน้านี้');
    pdfB.onclick = async () => { close(); const f = await pickFile('application/pdf,.pdf'); if (f) this.insertPdf(f, cur.id); };
    end.onclick = () => { close(); this.addPage({ bg, size }); };
    box.append(ok, end, pdfB);
    const close = popover(anchor, box, { place: 'auto' });
  }

  // ---------- persistence ----------
  markDirty(p) { if (!p) return; this.app.broadcast?.pageChanged(p); p._ver = (p._ver || 0) + 1; this.dirty.add(p.id); this.scheduleSave(); if (this.thumbs.classList.contains('open')) { clearTimeout(this.thT); this.thT = setTimeout(() => this.refreshThumbs(), 700); } }
  saveNb() { this.nbDirty = true; this.scheduleSave(); }
  scheduleSave() { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.flush(), 700); }
  async flush() {
    clearTimeout(this.saveT);
    if (!this.dirty.size && !this.nbDirty && !this.deleted.size) return;
    const pages = [...this.dirty].filter(id => this.nb.pages.includes(id)).map(id => serializePage(this.pageMap.get(id)));
    this.dirty.clear(); this.nbDirty = false;
    this.nb.updated = Date.now(); this.nb.count = this.nb.pages.length;
    const nbRec = { ...this.nb };
    try {
      await db.savePagesAndNotebook(pages, nbRec);
      if (this.deleted.size) { const del = [...this.deleted].filter(id => !this.nb.pages.includes(id)); await db.delMany('pages', del); this.deleted.clear(); }
      this.coverStale = true;
      if (!this.lastCover || Date.now() - this.lastCover > 8000) { this.lastCover = Date.now(); this.updateCover(); }
      if (this.fileLinked) this.writeLinkedFile(); else this.syncSaveBtn();
    } catch (err) { console.error(err); toast('บันทึกไม่สำเร็จ: ' + (err?.message || err), 4000, 'warn'); }
  }
  async updateCover(force) {
    if (!this.coverStale && !force) return;
    this.coverStale = false;
    const p = this.pages[0]; if (!p) return;
    try {
      const c = renderPageTo(document.createElement('canvas'), p, this.paper, 300);
      this.nb.thumb = c.toDataURL('image/jpeg', 0.82);
      await db.put('notebooks', { ...this.nb });
    } catch (e) { console.warn(e); }
  }

  key(e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    else if (e.key === ' ') { this.spaceDown = e.type === 'keydown'; }
    else if (!mod && e.key === 'p') this.setTool('pen');
    else if (!mod && e.key === 'h') this.setTool('hl');
    else if (!mod && e.key === 'e') this.setTool('eraser');
    else if (!mod && e.key === '0') this.fit();
    else if (e.key === 'Escape') { this.deselect(); this.deselectImage(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.imgSel) { $('.imgbar .chip.danger', this.stage)?.click(); }
  }
}

// ---------- geometry helpers for erasing ----------
function strokeXY(s) {
  if (s.shape) return { xy: shapePolyline(s.shape, 96), st: 2 };
  return { xy: s.pts, st: STRIDE };
}
function hitStroke(s, x, y, r) {
  const { xy, st } = strokeXY(s);
  const rr = r + s.w / 2;
  const n = xy.length / st;
  if (n === 1) return Math.hypot(xy[0] - x, xy[1] - y) <= rr;
  for (let i = 0; i < n - 1; i++) {
    const ax = xy[i * st], ay = xy[i * st + 1], bx = xy[(i + 1) * st], by = xy[(i + 1) * st + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= rr) return true;
  }
  if (s.shape && s.shape.k === 'arrow') return Math.hypot(s.shape.pts[2] - x, s.shape.pts[3] - y) <= rr + s.w * 5;
  return false;
}
// returns null if untouched, else array of remaining pieces
function splitStroke(s, x, y, r) {
  let pts;
  if (s.shape) {
    const poly = shapePolyline(s.shape, 160); pts = [];
    for (let i = 0; i < poly.length; i += 2) pts.push(poly[i], poly[i + 1], 0.5, 0);
  } else pts = Array.from(s.pts);
  const rr = r + s.w * 0.35;
  // densify
  const step = Math.max(0.4, r / 3);
  const dense = [];
  const n = pts.length / STRIDE;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const ax = pts[(i - 1) * 4], ay = pts[(i - 1) * 4 + 1], bx = pts[i * 4], by = pts[i * 4 + 1], d = Math.hypot(bx - ax, by - ay);
      const m = Math.floor(d / step);
      for (let j = 1; j < m; j++) { const t = j / m; dense.push(ax + (bx - ax) * t, ay + (by - ay) * t, pts[(i - 1) * 4 + 2] + (pts[i * 4 + 2] - pts[(i - 1) * 4 + 2]) * t, pts[i * 4 + 3]); }
    }
    dense.push(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3]);
  }
  let any = false; const runs = []; let cur = [];
  for (let i = 0; i < dense.length; i += 4) {
    const inside = Math.hypot(dense[i] - x, dense[i + 1] - y) <= rr;
    if (inside) { any = true; if (cur.length >= 8) runs.push(cur); cur = []; }
    else cur.push(dense[i], dense[i + 1], dense[i + 2], dense[i + 3]);
  }
  if (!any) return null;
  if (cur.length >= 8) runs.push(cur);
  const base = { t: s.t, pen: s.shape ? (['dash', 'dot', 'hl'].includes(s.pen) ? s.pen : 'ball') : s.pen, c: s.c, a: s.a, w: s.w };
  return runs.map(run => ({ ...base, id: uid(), pts: Float32Array.from(run), bb: null }));
}

export function serializePage(p) {
  return { id: p.id, nb: p.nb, size: p.size || 'P', bg: p.bg, pw: p.pw, ph: p.ph, pdf: p.pdf, strokes: p.strokes.map(s => { if (s.t === 'text') return { id: s.id, t: 'text', text: s.text, size: s.size, bold: s.bold, c: s.c, a: s.a, x: s.x, y: s.y, w: s.w, h: s.h, ts: s.ts }; if (s.t === 'img') return { id: s.id, t: 'img', blob: s.blob, iw: s.iw, ih: s.ih, crop: s.crop, mask: s.mask, x: s.x, y: s.y, w: s.w, h: s.h, ts: s.ts }; const o = { id: s.id, t: s.t, pen: s.pen, c: s.c, a: s.a, w: s.w }; if (s.ts) o.ts = s.ts; if (s.hs) o.hs = s.hs; if (s.shape) o.shape = s.shape; else o.pts = s.pts; return o; }) };
}

// affine transform of any page object (M = [a,b,c,d,e,f]; sc = uniform scale; ang = rotation)
export function transformStroke(s, M, sc, ang) {
  const [a, b, c, d, e, f] = M, X = (x, y) => a * x + c * y + e, Y = (x, y) => b * x + d * y + f;
  if (s.t === 'img' || s.t === 'text') {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, w = s.w * sc, hh = s.h * sc, nx = X(cx, cy), ny = Y(cx, cy);
    const o = { ...s, x: nx - w / 2, y: ny - hh / 2, w, h: hh, bb: null };
    if (s.t === 'text') o.size = s.size * sc;
    return o;
  }
  if (s.shape) {
    const sh = JSON.parse(JSON.stringify(s.shape));
    if (sh.k === 'ellipse') { const nx = X(sh.cx, sh.cy), ny = Y(sh.cx, sh.cy); sh.cx = nx; sh.cy = ny; sh.rx *= sc; sh.ry *= sc; sh.rot = (sh.rot || 0) + ang; }
    else for (let i = 0; i < sh.pts.length; i += 2) { const x = sh.pts[i], y = sh.pts[i + 1]; sh.pts[i] = X(x, y); sh.pts[i + 1] = Y(x, y); }
    return { ...s, shape: sh, w: s.w * sc, bb: null };
  }
  const p = new Float32Array(s.pts);
  for (let i = 0; i < p.length; i += STRIDE) { const x = p[i], y = p[i + 1]; p[i] = X(x, y); p[i + 1] = Y(x, y); }
  return { ...s, pts: p, w: s.w * sc, bb: null };
}
