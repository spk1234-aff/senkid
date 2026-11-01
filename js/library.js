// Notebook library: folders, search, create, rename, move, duplicate, delete
import { h, icon, menu, dialog, ask, confirmBox, toast, seg, fmtDate, uid, brandWord, logoMark, pickFile, busy } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import { PAPERS } from './render.js';
import * as db from './db.js';

const COVERS = ['#2F5BEA', '#1E9E5A', '#D9622B', '#7A4BD6', '#C2407A', '#0F8A7E', '#4A4E57', '#B8860B'];

export class Library {
  constructor(app) { this.app = app; this.folder = '*'; this.q = ''; this.el = h('div', { class: 'lib' }); }
  async mount(parent) { parent.append(this.el); await this.load(); }
  destroy() { this.el.remove(); }
  async load() { this.nbs = await db.getAll('notebooks'); this.render(); }

  folders() {
    const set = new Set(prefs.folders);
    for (const n of this.nbs) if (n.folder) set.add(n.folder);
    return [...set].sort((a, b) => a.localeCompare(b, 'th'));
  }

  render() {
    const el = this.el; el.innerHTML = '';
    const folders = this.folders();
    const count = (f) => f === '*' ? this.nbs.length : f === '~recent' ? Math.min(8, this.nbs.length) : this.nbs.filter(n => n.folder === f).length;
    const fbtn = (key, label, ic = 'folder') => {
      const b = h('button', { class: 'fold' + (this.folder === key ? ' on' : '') }, icon(ic), h('span', {}, label), h('span', { class: 'n' }, String(count(key))));
      b.onclick = () => { this.folder = key; this.render(); };
      if (key !== '*' && key !== '~recent') b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.folderMenu(b, key); });
      return b;
    };
    const side = h('div', { class: 'lib-side' },
      h('div', { class: 'brand' }, logoMark(44), brandWord(32)),
      h('div', { class: 'folders' }, fbtn('*', 'ทั้งหมด', 'lib'), fbtn('~recent', 'ล่าสุด', 'pages'), ...folders.map(f => fbtn(f, f))));
    const nf = h('button', { class: 'fold', style: { color: 'var(--muted)' } }, icon('plus'), 'โฟลเดอร์ใหม่');
    nf.onclick = async () => { const n = await ask('ชื่อโฟลเดอร์ใหม่', { placeholder: 'เช่น ม.4/1' }); if (n) { if (!prefs.folders.includes(n)) prefs.folders.push(n); savePrefs(); this.folder = n; this.render(); } };
    side.querySelector('.folders').append(nf);
    if (this.folder !== '*' && this.folder !== '~recent') {
      const fm = h('button', { class: 'fold', style: { color: 'var(--muted)' } }, icon('edit'), 'จัดการโฟลเดอร์นี้');
      fm.onclick = () => this.folderMenu(fm, this.folder); side.querySelector('.folders').append(fm);
    }
    const st = h('button', { class: 'fold' }, icon('gear'), 'ตั้งค่า'); st.onclick = () => this.app.openSettings();
    const hp = h('button', { class: 'fold' }, icon('help'), 'วิธีใช้'); hp.onclick = () => this.app.openHelp();
    side.append(hp, st);

    const search = h('input', { class: 'field', type: 'search', placeholder: 'ค้นหาชื่อสมุด', value: this.q });
    search.oninput = () => { this.q = search.value; this.renderGrid(); };
    const imp = h('button', { class: 'pill sec', title: 'เปิดไฟล์สมุด (.senkid.json) หรือ PDF' }, icon('folder'), 'เปิดไฟล์ / PDF');
    imp.onclick = () => this.app.openFile();
    const add = h('button', { class: 'pill prim' }, icon('plus'), 'สมุดใหม่');
    add.onclick = () => this.newNotebook();
    const title = this.folder === '*' ? 'สมุดทั้งหมด' : this.folder === '~recent' ? 'ล่าสุด' : this.folder;
    const more = h('button', { class: 'btn sq', title: 'เพิ่มเติม' }, icon('more'));
    more.onclick = () => menu(more, [
      { icon: 'download', label: 'สำรองสมุดทั้งหมด', action: () => this.app.exportNotebooks(this.nbs.map(n => n.id)) },
      { icon: 'folder', label: 'เปิดไฟล์สมุด / ไฟล์สำรอง', action: () => this.app.openFile() },
      { icon: 'film', label: 'คลิปที่อัดไว้', action: () => this.app.openRecordings() },
      '-',
      { icon: 'gear', label: 'ตั้งค่า', action: () => this.app.openSettings() },
      { icon: 'help', label: 'วิธีใช้', action: () => this.app.openHelp() },
    ]);
    const top = h('div', { class: 'lib-top' }, h('div', { class: 'title' }, title), h('div', { class: 'search' }, icon('search'), search), imp, add, more);
    const mob = h('div', { class: 'mobile-folders' }, fbtn('*', 'ทั้งหมด', 'lib'), ...folders.map(f => fbtn(f, f)));
    this.grid = h('div', { class: 'lib-grid' });
    el.append(side, h('div', { class: 'lib-main' }, top, mob, this.grid));
    this.renderGrid();
  }

  list() {
    let l = this.nbs.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    if (this.folder === '~recent') l = l.slice(0, 8);
    else if (this.folder !== '*') l = l.filter(n => n.folder === this.folder);
    const q = this.q.trim().toLowerCase();
    if (q) l = l.filter(n => (n.name || '').toLowerCase().includes(q));
    return l;
  }

  renderGrid() {
    const g = this.grid; g.innerHTML = '';
    const l = this.list();
    if (!this.q) {
      const nw = h('div', { class: 'nb new' }, h('div', { class: 'cover' }, icon('plus'), 'สมุดใหม่'));
      nw.onclick = () => this.newNotebook(); g.append(nw);
    }
    for (const n of l) {
      const cover = h('div', { class: 'cover', style: { background: PAPERS[n.paper || 'cream']?.fill } }, h('div', { class: 'spine', style: { background: n.cover || '#2F5BEA' } }));
      if (n.thumb) cover.append(h('img', { src: n.thumb, alt: '', loading: 'lazy' }));
      const more = h('button', { class: 'btn sq more', title: 'ตัวเลือก' }, icon('more'));
      const card = h('div', { class: 'nb' }, cover, h('div', { class: 'name' }, n.name || 'ไม่มีชื่อ'), h('div', { class: 'meta' }, `${fmtDate(n.updated || n.created)} · ${n.count || n.pages?.length || 1} หน้า`), more);
      card.onclick = (e) => { if (e.target.closest('.more')) return; this.app.openNotebook(n.id); };
      more.onclick = (e) => { e.stopPropagation(); this.cardMenu(more, n); };
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cardMenu(more, n); });
      g.append(card);
    }
    if (!l.length && this.q) g.append(h('div', { class: 'empty' }, 'ไม่พบสมุดที่ชื่อมีคำว่า "' + this.q + '"'));
  }

  cardMenu(anchor, n) {
    menu(anchor, [
      { header: n.name },
      { icon: 'edit', label: 'เปลี่ยนชื่อ', action: async () => { const v = await ask('เปลี่ยนชื่อสมุด', { value: n.name }); if (v) { n.name = v; await db.put('notebooks', n); this.render(); } } },
      { icon: 'folder', label: 'ย้ายไปโฟลเดอร์', right: n.folder || 'ไม่มี', action: () => this.moveDialog(n) },
      { icon: 'copy', label: 'ทำสำเนา', action: () => this.duplicate(n) },
      { icon: 'save', label: 'บันทึกเป็นไฟล์ในเครื่อง', action: () => this.app.saveNotebookToFile(n) },
      '-',
      { icon: 'trash', label: 'ลบสมุด', danger: true, action: async () => { if (await confirmBox(`ลบ "${n.name}"?`, 'ลบแล้วกู้คืนไม่ได้ ถ้ายังไม่แน่ใจให้สำรองไว้ก่อน', { ok: 'ลบสมุด', danger: true })) { const bz = busy('กำลังลบสมุด…', n.name); try { await db.deleteNotebook(n.id); } finally { bz.done(); } await this.load(); toast('ลบสมุดแล้ว'); } } },
    ]);
  }
  folderMenu(anchor, f) {
    menu(anchor, [
      { header: 'โฟลเดอร์ ' + f },
      { icon: 'edit', label: 'เปลี่ยนชื่อโฟลเดอร์', action: async () => { const v = await ask('ชื่อโฟลเดอร์', { value: f }); if (v && v !== f) { for (const n of this.nbs.filter(x => x.folder === f)) { n.folder = v; await db.put('notebooks', n); } prefs.folders = prefs.folders.filter(x => x !== f).concat([v]); savePrefs(); this.folder = v; this.render(); } } },
      { icon: 'trash', label: 'ลบโฟลเดอร์ (สมุดยังอยู่)', danger: true, action: async () => { for (const n of this.nbs.filter(x => x.folder === f)) { n.folder = ''; await db.put('notebooks', n); } prefs.folders = prefs.folders.filter(x => x !== f); savePrefs(); this.folder = '*'; this.render(); } },
    ]);
  }
  moveDialog(n) {
    const fs = this.folders();
    let v = n.folder || '';
    const sel = h('select', { class: 'field' }, h('option', { value: '' }, '— ไม่อยู่ในโฟลเดอร์ —'), ...fs.map(f => h('option', { value: f, selected: f === v }, f)));
    const nn = h('input', { class: 'field', type: 'text', placeholder: 'หรือพิมพ์ชื่อโฟลเดอร์ใหม่', style: { marginTop: '10px' } });
    dialog('ย้ายไปโฟลเดอร์', h('div', {}, sel, nn), [{ label: 'ยกเลิก' }, {
      label: 'ย้าย', cls: 'prim', flex: 2, action: async () => {
        const f = nn.value.trim() || sel.value; n.folder = f; if (f && !prefs.folders.includes(f)) { prefs.folders.push(f); savePrefs(); }
        await db.put('notebooks', n); this.render();
      }
    }]);
  }
  async duplicate(n) {
    const bz = busy('กำลังทำสำเนาสมุด…', n.name);
    try { await this._dup(n); } finally { bz.done(); }
  }
  async _dup(n) {
    const pages = await db.pagesOf(n.id);
    const id = uid(); const map = new Map();
    const np = pages.map(p => { const nid = uid(); map.set(p.id, nid); return { ...p, id: nid, nb: id }; });
    const nb = { ...n, id, name: n.name + ' (สำเนา)', created: Date.now(), updated: Date.now(), pages: n.pages.map(x => map.get(x)).filter(Boolean) };
    await db.savePagesAndNotebook(np, nb); await this.load(); toast('ทำสำเนาสมุดแล้ว');
  }

  newNotebook() {
    const d = new Date();
    const cfg = { name: `สมุดใหม่ ${d.getDate()}/${d.getMonth() + 1}`, ...prefs.newNb, cover: COVERS[Math.floor(Math.random() * COVERS.length)], folder: this.folder !== '*' && this.folder !== '~recent' ? this.folder : '' };
    const name = h('input', { class: 'field', type: 'text', value: cfg.name });
    const covers = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
    const drawCovers = () => { covers.innerHTML = ''; for (const c of COVERS) { const b = h('button', { class: 'sw' + (c === cfg.cover ? ' on' : '') }, h('i', { style: { background: c } })); b.onclick = () => { cfg.cover = c; drawCovers(); }; covers.append(b); } };
    drawCovers();
    const body = h('div', {},
      h('div', { class: 'lbl', style: { marginTop: 0 } }, 'ชื่อสมุด'), name,
      h('div', { class: 'lbl' }, 'พื้นกระดาษ'), seg([['blank', 'เปล่า'], ['lines', 'เส้นบรรทัด'], ['grid', 'ตาราง'], ['dots', 'จุด']], cfg.bg, v => cfg.bg = v),
      h('div', { class: 'lbl' }, 'ขนาดกระดาษ'), seg([['P', 'A4 แนวตั้ง'], ['L', 'A4 แนวนอน']], cfg.orient, v => cfg.orient = v),
      h('div', { class: 'lbl' }, 'สีกระดาษ'), seg(Object.entries(PAPERS).map(([k, v]) => [k, v.label]), cfg.paper, v => cfg.paper = v),
      h('div', { class: 'lbl' }, 'สีปก'), covers);
    dialog('สร้างสมุดใหม่', body, [{ label: 'ยกเลิก' }, {
      label: 'สร้างและเริ่มเขียน', cls: 'prim', flex: 2, action: async () => {
        prefs.newNb = { bg: cfg.bg, orient: cfg.orient, paper: cfg.paper }; savePrefs();
        const id = uid(), pid = uid();
        const nb = { id, name: name.value.trim() || cfg.name, folder: cfg.folder, cover: cfg.cover, paper: cfg.paper, created: Date.now(), updated: Date.now(), pages: [pid], count: 1 };
        await db.savePagesAndNotebook([{ id: pid, nb: id, size: cfg.orient, bg: cfg.bg, strokes: [] }], nb);
        this.app.openNotebook(id);
      }
    }], { width: 620 });
    setTimeout(() => name.select(), 80);
  }
}
