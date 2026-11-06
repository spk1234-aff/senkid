// Notebook library: folders, search, create, rename, move, duplicate, delete
import { h, icon, menu, dialog, ask, confirmBox, toast, seg, fmtDate, uid, brandWord, logoMark, pickFile, busy } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import { requireTeacher, setUnlocked } from './lock.js';
import { sync, syncNow, signIn, statusText, connected } from './sync.js';
import { PAPERS } from './render.js';
import * as db from './db.js';

const COVERS = ['#2F5BEA', '#1E9E5A', '#D9622B', '#7A4BD6', '#C2407A', '#0F8A7E', '#4A4E57', '#B8860B'];
const FCOLORS = ['#4F7DF3', '#2BB673', '#F08A3E', '#9B6BE8', '#E0559B', '#1FA9A0', '#E3B341', '#7C828C'];
const folderColor = (f) => prefs.folderColors?.[f] || FCOLORS[[...f].reduce((a, c) => a + c.charCodeAt(0), 0) % FCOLORS.length];
function folderArt(color, size = 1) {
  const s = h('div', { class: 'fart' });
  s.innerHTML = `<svg viewBox="0 0 120 92" width="100%" height="100%"><path d="M6 14 a8 8 0 0 1 8-8 h30 l10 10 h52 a8 8 0 0 1 8 8 v4 H6Z" fill="${color}" opacity=".72"/><rect x="6" y="22" width="108" height="64" rx="9" fill="${color}"/><rect x="6" y="22" width="108" height="64" rx="9" fill="url(#fg)" opacity=".25"/><defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs></svg>`;
  return s;
}

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
      const isF = key !== '*' && key !== '~recent';
      const b = h('button', { class: 'fold' + (this.folder === key ? ' on' : ''), 'data-drop': key === '~recent' ? null : (isF ? key : '') }, isF ? h('span', { class: 'fdot', style: { background: folderColor(key) } }) : icon(ic), h('span', {}, label), h('span', { class: 'n' }, String(count(key))));
      b.onclick = () => { this.folder = key; this.render(); };
      if (key !== '*' && key !== '~recent') b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.folderMenu(b, key); });
      return b;
    };
    const side = h('div', { class: 'lib-side' },
      h('div', { class: 'brand' }, logoMark(44), brandWord(32)),
      h('div', { class: 'folders' }, fbtn('*', 'ทั้งหมด', 'lib'), fbtn('~recent', 'ล่าสุด', 'pages'), ...folders.map(f => fbtn(f, f))));
    const nf = h('button', { class: 'fold', style: { color: 'var(--muted)' } }, icon('plus'), 'โฟลเดอร์ใหม่');
    nf.onclick = () => this.newFolder();
    side.querySelector('.folders').append(nf);
    if (this.folder !== '*' && this.folder !== '~recent') {
      const fm = h('button', { class: 'fold', style: { color: 'var(--muted)' } }, icon('edit'), 'จัดการโฟลเดอร์นี้');
      fm.onclick = () => this.folderMenu(fm, this.folder); side.querySelector('.folders').append(fm);
    }
    const st = h('button', { class: 'fold' }, icon('gear'), 'ตั้งค่า'); st.onclick = () => this.app.openSettings();
    const hp = h('button', { class: 'fold' }, icon('help'), 'วิธีใช้'); hp.onclick = () => this.app.openHelp();
    const mode = h('div', { class: 'modesw' }, h('div', { class: 'lbl' }, 'ใช้งานแบบ'),
      seg([['t', 'ครู'], ['s', 'นักเรียน']], prefs.studentUI ? 's' : 't', async (v) => { if (v === 't' && !(await requireTeacher())) { this.render(); return; } prefs.studentUI = v === 's'; if (v === 's') setUnlocked(false); savePrefs(); this.render(); toast(prefs.studentUI ? 'โหมดนักเรียน: ซ่อนเครื่องมือฉายจอ สุ่มชื่อ และม่านบังคำตอบ' : 'โหมดครู: แสดงเครื่องมือครบ', 2200); }));
    const sp = h('button', { class: 'fold syncpill' }, icon('cloud'), h('span', {}, ''));
    const paint = () => { sp.lastChild.textContent = statusText(); sp.classList.toggle('spin', sync.state === 'syncing'); sp.classList.toggle('warn', sync.state === 'auth' || sync.state === 'error'); };
    sp.onclick = () => { if (!connected()) this.app.openSettings(); else if (sync.state === 'auth') signIn(); else syncNow('manual'); };
    paint(); this._unsync?.(); this._unsync = sync.on(paint);
    side.append(mode, sp, hp, st);

    const search = h('input', { class: 'field', type: 'search', placeholder: 'ค้นหาชื่อสมุด', value: this.q });
    search.oninput = () => { this.q = search.value; this.renderGrid(); };
    const imp = h('button', { class: 'pill sec', title: 'เปิดไฟล์สมุด (.senkid.json) หรือ PDF' }, icon('folder'), 'เปิดไฟล์ / PDF');
    imp.onclick = () => this.app.openFile();
    const add = h('button', { class: 'pill prim' }, icon('plus'), 'สมุดใหม่');
    add.onclick = () => this.newNotebook();
    const inFolder = this.folder !== '*' && this.folder !== '~recent';
    const title = this.folder === '*' ? 'สมุดทั้งหมด' : this.folder === '~recent' ? 'ล่าสุด' : this.folder;
    const more = h('button', { class: 'btn sq', title: 'เพิ่มเติม' }, icon('more'));
    more.onclick = () => menu(more, [
      { icon: 'download', label: 'สำรองสมุดทั้งหมด', action: () => this.app.exportNotebooks(this.nbs.map(n => n.id)) },
      { icon: 'folder', label: 'เปิดไฟล์สมุด / ไฟล์สำรอง', action: () => this.app.openFile() },
      { icon: 'film', label: 'คลิปที่อัดไว้', action: () => this.app.openRecordings() },
      '-',
      { icon: 'gear', label: 'ตั้งค่า', action: () => this.app.openSettings() },
      { icon: 'user', label: prefs.studentUI ? 'เปลี่ยนเป็นโหมดครู' : 'เปลี่ยนเป็นโหมดนักเรียน', action: async () => { if (prefs.studentUI && !(await requireTeacher())) return; prefs.studentUI = !prefs.studentUI; if (prefs.studentUI) setUnlocked(false); savePrefs(); this.render(); } },
      { icon: 'help', label: 'วิธีใช้', action: () => this.app.openHelp() },
    ]);
    const titleEl = h('div', { class: 'title' });
    if (inFolder) {
      const back = h('button', { class: 'btn sq back', title: 'กลับหน้าแรก' }, icon('back'));
      back.onclick = () => { this.folder = '*'; this.render(); };
      const fmb = h('button', { class: 'btn sq', title: 'จัดการโฟลเดอร์' }, icon('more'));
      fmb.onclick = () => this.folderMenu(fmb, this.folder);
      titleEl.append(back, h('span', { class: 'fdot', style: { background: folderColor(this.folder) } }), h('span', {}, title), fmb);
    } else titleEl.append(title);
    const top = h('div', { class: 'lib-top' }, titleEl, h('div', { class: 'search' }, icon('search'), search), imp, add, more);
    const mob = h('div', { class: 'mobile-folders' }, fbtn('*', 'ทั้งหมด', 'lib'), ...folders.map(f => fbtn(f, f)));
    this.grid = h('div', { class: 'lib-grid' });
    el.append(side, h('div', { class: 'lib-main' }, top, this.backupBanner(), mob, this.grid));
    this.renderGrid();
  }

  // reminder: everything lives only on this device, so nudge a backup once a week
  backupBanner() {
    const now = Date.now(), last = prefs.lastBackup || 0, newest = Math.max(0, ...this.nbs.map(n => n.updated || 0));
    if (!this.nbs.length || newest <= last || now - last < 7 * 864e5 || now < (prefs.backupSnooze || 0)) return '';
    const days = last ? Math.floor((now - last) / 864e5) : null;
    const go = h('button', { class: 'pill prim' }, icon('download'), 'สำรองตอนนี้');
    const later = h('button', { class: 'pill ghost' }, 'พรุ่งนี้');
    const box = h('div', { class: 'bk-banner' }, icon('save'), h('div', {}, h('b', {}, days == null ? 'ยังไม่เคยสำรองสมุด' : `ไม่ได้สำรองสมุดมา ${days} วันแล้ว`), h('div', { class: 'sub' }, 'สมุดเก็บอยู่ในเครื่องนี้เท่านั้น ถ้าเครื่องเสียหรือล้างข้อมูลจะหายหมด · กดสำรองแล้วเลือก "บันทึกไปยังไฟล์" → iCloud Drive')), go, later);
    go.onclick = async () => { await this.app.exportNotebooks(this.nbs.map(n => n.id)); box.remove(); };
    later.onclick = () => { prefs.backupSnooze = now + 864e5; savePrefs(); box.remove(); };
    return box;
  }
  list() {
    let l = this.nbs.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const q = this.q.trim().toLowerCase();
    if (q) return l.filter(n => (n.name || '').toLowerCase().includes(q)); // search looks everywhere
    if (this.folder === '~recent') l = l.slice(0, 8);
    else if (this.folder === '*') l = l.filter(n => !n.folder || !this.folders().includes(n.folder));
    else l = l.filter(n => n.folder === this.folder);
    return l;
  }

  renderGrid() {
    const g = this.grid; g.innerHTML = '';
    const l = this.list();
    if (!this.q && this.folder === '*') {
      const fs = this.folders();
      const fsec = h('div', { class: 'lib-sec' }, h('span', {}, 'โฟลเดอร์'), h('span', { class: 'hint' }, 'กดค้างที่สมุดแล้วลากมาวางบนโฟลเดอร์เพื่อย้าย'));
      g.append(fsec);
      for (const f of fs) {
        const n = this.nbs.filter(x => x.folder === f).length;
        const more = h('button', { class: 'btn sq more', title: 'ตัวเลือก' }, icon('more'));
        const t = h('div', { class: 'nb fcard', 'data-drop': f }, h('div', { class: 'fcover' }, folderArt(folderColor(f)), h('div', { class: 'fcount' }, String(n))), h('div', { class: 'name' }, f), h('div', { class: 'meta' }, n ? `${n} เล่ม` : 'ว่าง'), more);
        t.onclick = (e) => { if (e.target.closest('.more')) return; this.folder = f; this.render(); };
        more.onclick = (e) => { e.stopPropagation(); this.folderMenu(more, f); };
        t.addEventListener('contextmenu', (e) => { e.preventDefault(); this.folderMenu(more, f); });
        g.append(t);
      }
      const nf = h('div', { class: 'nb fcard new' }, h('div', { class: 'fcover' }, icon('plus'), 'โฟลเดอร์ใหม่'));
      nf.onclick = () => this.newFolder(); g.append(nf);
      g.append(h('div', { class: 'lib-sec' }, h('span', {}, fs.length ? 'สมุดที่ไม่อยู่ในโฟลเดอร์' : 'สมุด')));
    }
    if (!this.q) {
      const nw = h('div', { class: 'nb new' }, h('div', { class: 'cover' }, icon('plus'), 'สมุดใหม่'));
      nw.onclick = () => this.newNotebook(); g.append(nw);
    }
    const cards = new Map();
    for (const n of l) {
      const cover = h('div', { class: 'cover', style: { background: PAPERS[n.paper || 'cream']?.fill } }, h('div', { class: 'spine', style: { background: n.cover || '#2F5BEA' } }));
      if (n.thumb) cover.append(h('img', { src: n.thumb, alt: '', loading: 'lazy' }));
      const more = h('button', { class: 'btn sq more', title: 'ตัวเลือก' }, icon('more'));
      const card = h('div', { class: 'nb' }, cover, h('div', { class: 'name' }, n.name || 'ไม่มีชื่อ'), h('div', { class: 'meta' }, `${fmtDate(n.updated || n.created)} · ${n.count || n.pages?.length || 1} หน้า`), more);
      card.onclick = (e) => { if (e.target.closest('.more')) return; this.app.openNotebook(n.id); };
      more.onclick = (e) => { e.stopPropagation(); this.cardMenu(more, n); };
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!this.dragging) this.cardMenu(more, n); });
      this.armDrag(card, n);
      g.append(card);
      cards.set(n.id, cover);
    }
    // small badge on covers that have recorded lessons → opens that notebook's list
    import('./recorder.js').then(({ recordingCounts }) => recordingCounts()).then(cnt => {
      for (const [id, cover] of cards) { const c = cnt[id]; if (!c || !cover.isConnected) continue; const b = h('button', { class: 'recbadge', title: 'บทเรียนที่อัดในเล่มนี้' }, icon('mic'), String(c)); b.onclick = (e) => { e.stopPropagation(); this.app.openRecordings(id); }; cover.append(b); }
    }).catch(() => { });
    if (!l.length && !this.q && this.folder !== '*' && this.folder !== '~recent') g.append(h('div', { class: 'empty' }, 'โฟลเดอร์นี้ยังว่าง · กด "สมุดใหม่" หรือเปิด PDF เข้ามาในโฟลเดอร์นี้ได้เลย'));
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
  async newFolder() {
    const n = (await ask('ชื่อโฟลเดอร์ใหม่', { placeholder: 'เช่น คณิต ม.4/1' }))?.trim();
    if (!n) return;
    if (!prefs.folders.includes(n)) prefs.folders.push(n);
    prefs.folderColors = { ...(prefs.folderColors || {}), [n]: folderColor(n) }; savePrefs();
    this.render(); toast('สร้างโฟลเดอร์ "' + n + '" แล้ว');
  }
  folderMenu(anchor, f) {
    menu(anchor, [
      { header: 'โฟลเดอร์ ' + f },
      { icon: 'edit', label: 'เปลี่ยนชื่อ', action: async () => { const v = (await ask('ชื่อโฟลเดอร์', { value: f }))?.trim(); if (v && v !== f) { for (const n of this.nbs.filter(x => x.folder === f)) { n.folder = v; await db.put('notebooks', n); } prefs.folders = prefs.folders.filter(x => x !== f).concat([v]); const fc = { ...(prefs.folderColors || {}) }; fc[v] = fc[f] || folderColor(f); delete fc[f]; prefs.folderColors = fc; savePrefs(); if (this.folder === f) this.folder = v; this.render(); } } },
      { icon: 'palette', label: 'เปลี่ยนสี', action: () => this.colorDialog(f) },
      { icon: 'plus', label: 'สร้างสมุดใหม่ในโฟลเดอร์นี้', action: () => { this.folder = f; this.render(); this.newNotebook(); } },
      '-',
      { icon: 'trash', label: 'ลบโฟลเดอร์ (สมุดข้างในไม่หาย)', danger: true, action: async () => { if (!(await confirmBox(`ลบโฟลเดอร์ "${f}"?`, 'สมุดในโฟลเดอร์จะย้ายออกมาไว้หน้าแรก ไม่ถูกลบ', { ok: 'ลบโฟลเดอร์', danger: true }))) return; for (const n of this.nbs.filter(x => x.folder === f)) { n.folder = ''; await db.put('notebooks', n); } prefs.folders = prefs.folders.filter(x => x !== f); savePrefs(); this.folder = '*'; this.render(); } },
    ]);
  }
  colorDialog(f) {
    const box = h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', padding: '6px 0' } });
    const dg = dialog('สีโฟลเดอร์ ' + f, box, [], { width: 460 });
    for (const c of FCOLORS) { const b = h('button', { class: 'fcol' + (c === folderColor(f) ? ' on' : '') }, folderArt(c)); b.onclick = () => { prefs.folderColors = { ...(prefs.folderColors || {}), [f]: c }; savePrefs(); dg.close(); this.render(); }; box.append(b); }
  }
  async moveTo(n, f) {
    if ((n.folder || '') === f) return;
    n.folder = f; if (f && !prefs.folders.includes(f)) { prefs.folders.push(f); savePrefs(); }
    await db.put('notebooks', n); this.render();
    toast(f ? `ย้าย "${n.name}" ไปที่ ${f}` : `ย้าย "${n.name}" ออกมาไว้หน้าแรก`);
  }
  moveDialog(n) {
    const fs = this.folders();
    const list = h('div', { class: 'mvlist' });
    const dg = dialog('ย้าย "' + n.name + '" ไปที่', list, [{ label: 'ยกเลิก' }], { width: 480 });
    const item = (f, label) => { const b = h('button', { class: 'mvitem' + ((n.folder || '') === f ? ' on' : '') }, f ? h('span', { class: 'fdot', style: { background: folderColor(f) } }) : icon('lib'), h('span', {}, label), (n.folder || '') === f ? h('span', { class: 'n' }, 'อยู่ที่นี่') : ''); b.onclick = () => { dg.close(); this.moveTo(n, f); }; return b; };
    list.append(item('', 'หน้าแรก (ไม่อยู่ในโฟลเดอร์)'), ...fs.map(f => item(f, f)));
    const nf = h('button', { class: 'mvitem', style: { color: 'var(--acc)' } }, icon('plus'), 'โฟลเดอร์ใหม่…');
    nf.onclick = async () => { dg.close(); const v = (await ask('ชื่อโฟลเดอร์ใหม่', { placeholder: 'เช่น คณิต ม.4/1' }))?.trim(); if (v) { prefs.folderColors = { ...(prefs.folderColors || {}), [v]: folderColor(v) }; await this.moveTo(n, v); } };
    list.append(nf);
  }
  // long-press a notebook card, then drag it onto a folder (card or sidebar) to move it
  armDrag(card, n) {
    let t = null, st = null;
    const cancel = () => { clearTimeout(t); t = null; };
    card.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('.more')) return;
      st = { x: e.clientX, y: e.clientY, id: e.pointerId };
      t = setTimeout(() => this.startDrag(card, n, st), 420);
    });
    card.addEventListener('pointermove', (e) => { if (t && st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 10) cancel(); });
    card.addEventListener('pointerup', cancel); card.addEventListener('pointercancel', cancel);
  }
  startDrag(card, n, st) {
    this.dragging = true;
    const r = card.querySelector('.cover').getBoundingClientRect();
    const ghost = card.querySelector('.cover').cloneNode(true);
    ghost.classList.add('drag-ghost', 'nbghost'); Object.assign(ghost.style, { width: r.width * 0.7 + 'px', height: r.height * 0.7 + 'px', left: st.x - r.width * 0.35 + 'px', top: st.y - r.height * 0.35 + 'px' });
    document.body.append(ghost); card.classList.add('lifted'); navigator.vibrate?.(10);
    const scroller = this.grid;
    let over = null, lastY = st.y, raf = 0;
    const targetAt = (x, y) => { ghost.style.display = 'none'; const el = document.elementFromPoint(x, y); ghost.style.display = ''; const d = el?.closest('[data-drop]'); return d && d.dataset.drop !== undefined ? d : null; };
    const auto = () => { const gr = scroller.getBoundingClientRect(); if (lastY < gr.top + 60) scroller.scrollTop -= 12; else if (lastY > gr.bottom - 60) scroller.scrollTop += 12; raf = requestAnimationFrame(auto); };
    raf = requestAnimationFrame(auto);
    const move = (e) => {
      e.preventDefault(); lastY = e.clientY;
      ghost.style.left = e.clientX - r.width * 0.35 + 'px'; ghost.style.top = e.clientY - r.height * 0.35 + 'px';
      const d = targetAt(e.clientX, e.clientY);
      if (d !== over) { over?.classList.remove('dropover'); over = d; over?.classList.add('dropover'); }
    };
    const end = (e) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('touchmove', block);
      cancelAnimationFrame(raf); ghost.remove(); card.classList.remove('lifted'); over?.classList.remove('dropover');
      setTimeout(() => { this.dragging = false; }, 50);
      if (over && e.type === 'pointerup') this.moveTo(n, over.dataset.drop || '');
    };
    const block = (e) => e.preventDefault();
    window.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    card.addEventListener('click', (e) => { if (this.dragging) { e.stopImmediatePropagation(); e.preventDefault(); } }, { capture: true, once: true });
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
