// เมนูหลัก: one button on the board opens a page of big cards; each card opens its own page.
// Everything that used to sit in the toolbar or the ⋯ menu lives in exactly one of these pages.
import { h, icon, toast, seg, toggle } from './ui.js';
import { prefs, savePrefs, applyTheme, COLOR_THEMES } from './prefs.js';

let root = null;
export const hubOpen = () => !!root?.isConnected;
export function closeHub() { root?.remove(); root = null; }

// row = one action in a page; `keep` leaves the hub open (for switches)
const R = (ic, label, sub, fn) => { const b = h('button', { class: 'hub-row' }, h('span', { class: 'hub-ri' }, icon(ic)), h('div', { class: 'hub-rt' }, h('b', {}, label), sub ? h('span', {}, sub) : null), icon('chev')); b.onclick = fn; return b; };
const S = (label, sub, ctl) => h('div', { class: 'hub-row set' }, h('div', { class: 'hub-rt' }, h('b', {}, label), sub ? h('span', {}, sub) : null), ctl);
const T = (t) => h('div', { class: 'hub-sec' }, t);

export function openHub(ed, anchor, page = null) {
  closeHub();
  const app = ed.app, student = !!prefs.studentUI;
  // run something that needs a popover anchor: close the hub, then anchor it to the menu button
  const go = (fn) => () => { closeHub(); requestAnimationFrame(() => fn(ed.menuBtn || anchor)); };
  const PAGES = [
    !student && { id: 'tv', ic: 'tv', title: 'ต่อทีวี', sub: 'ฉายจอให้นักเรียนดู', rows: () => [
      R('tv', app.broadcast?.connected ? 'ทีวีต่ออยู่ · ตั้งค่า / เลิกใช้' : 'เชื่อมทีวี', 'สแกน QR หรือเปิดลิงก์บนทีวี แล้วเลือกว่าทีวีแสดงอะไร', go(a => app.studentMenu(a))),
    ] },
    { id: 'rec', ic: 'mic', title: student ? 'อัดเสียง' : 'อัดบทเรียน', sub: student ? 'เสียงพร้อมเส้นที่เขียน' : 'เสียง เส้น กล้อง', rows: () => [
      R('mic', app.audio?.active ? 'กำลังอัด · หยุด / พัก' : 'เริ่มอัด', student ? 'อัดเสียงอธิบายพร้อมเส้นที่เขียน' : 'อัดเสียงพร้อมลายมือ (และกล้องครูถ้าเปิดไว้)', go(a => app.audioClick(ed, ed.micBtn || a))),
      R('gear', student ? 'เลือกไมโครโฟน' : 'ไมโครโฟนและกล้องครู', student ? null : 'เลือกไมค์ เปิดกล้อง ถอดเสียง ส่งขึ้น Drive', go(a => app.recorderSettings(ed, ed.micBtn || a))),
      R('history', student ? 'เสียงที่อัดในเล่มนี้' : 'บทเรียนที่อัดในเล่มนี้', student ? 'ฟังย้อนพร้อมดูเส้น' : 'ฟังย้อน แชร์ ดาวน์โหลด', () => { closeHub(); app.openRecordings(ed.nb.id); }),
    ] },
    !student && { id: 'video', ic: 'film', title: 'ทำวิดีโอ', sub: '3 ขั้น จบ', direct: () => { closeHub(); import('./makevideo.js').then(m => m.openMakeVideo(app)); } },
    { id: 'teach', ic: 'teach', title: student ? 'เครื่องมือ' : 'เครื่องมือสอน', sub: student ? 'จับเวลา คณิต' : 'ใช้ระหว่างคาบ', rows: () => student ? [
      R('timer', 'นาฬิกาจับเวลา', null, go(a => app.timer.panel(a))),
      R('equation', 'คณิต: สมการ กราฟ ไม้โปรแทรกเตอร์', null, go(a => ed.mathMenu(a))),
    ] : [
      R('timer', 'นาฬิกาจับเวลา', null, go(a => app.timer.panel(a))),
      R('dice', 'สุ่มชื่อนักเรียน / จัดกลุ่ม', null, go(a => app.picker.open(a))),
      R('laser', 'เลเซอร์พอยเตอร์', 'ชี้แล้วหายเอง', () => { closeHub(); ed.setTool('laser'); }),
      R('curtain', ed.curtain ? 'ปิดม่านบังคำตอบ' : 'ม่านบังคำตอบ', 'ค่อย ๆ เลื่อนเปิดทีละขั้น', () => { closeHub(); ed.toggleCurtain(); }),
      R('dice', 'สุ่มโจทย์ฝึก', 'โจทย์ + เฉลย พิมพ์สวยด้วย LaTeX', go(a => import('./problems.js').then(m => m.openProblems(ed, a)))),
      R('pages', ed.splitPane ? 'ปิดเทียบสองหน้า' : 'เทียบสองหน้า', 'ดูอีกหน้าด้านขวา เขียนต่อด้านซ้าย', () => { closeHub(); import('./split.js').then(m => m.toggleSplit(ed)); }),
      R('history', 'ย้อนดูขั้นก่อนหน้า', 'ดูว่าเขียนอะไรไปบ้าง โดยไม่ลบ', go(a => ed.openPeek(a))),
      R('equation', 'คณิต: สมการ กราฟ ไม้โปรแทรกเตอร์', null, go(a => ed.mathMenu(a))),
      R('sticker', 'สติกเกอร์', null, go(a => ed.stickerPanel(a))),
      R('hide', 'โหมดนำเสนอ (ซ่อนแถบเครื่องมือ)', 'แตะขีดเล็กด้านบนเพื่อเอาแถบกลับมา', () => { closeHub(); prefs.toolbarHidden = true; savePrefs(); ed.applyPos(); }),
    ] },
    { id: 'pages', ic: 'book', title: 'หน้าและสมุด', sub: 'เพิ่ม ย้าย คัดลอก', rows: () => {
      const cur = ed.currentPage(), marked = !!ed.nb.marks?.[cur?.id];
      return [
        R('pageplus', 'เพิ่มหน้า / แทรก PDF', null, go(a => ed.addPageMenu(a))),
        R('bg', 'พื้นกระดาษและสีกระดาษ', 'เส้น ตาราง จุด กระดาษคณิต แนวตั้ง/แนวนอน', go(a => ed.paperMenu(a))),
        R('pages', 'ภาพย่อทุกหน้า', 'ลากเรียงหน้า ลบ ทำสำเนา', () => { closeHub(); ed.toggleThumbs(true); }),
        R('star', marked ? 'ถอนที่คั่นหน้านี้' : 'ปักที่คั่นหน้านี้', null, () => { closeHub(); ed.toggleMark(cur.id); }),
        R('star', 'ที่คั่นหน้า / สารบัญ', null, () => { closeHub(); ed.toggleThumbs(true); ed.thumbTab = 'marks'; ed.renderThumbs(); }),
        ...(ed.nb.lastInk && ed.pageMap.has(ed.nb.lastInk) ? [R('pen', `ไปหน้าที่เขียนล่าสุด (หน้า ${ed.nb.pages.indexOf(ed.nb.lastInk) + 1})`, null, () => { closeHub(); ed.scrollToPage(ed.nb.lastInk); })] : []),
        R('share', 'คัดลอก / ย้ายหน้าไปสมุดอื่น', null, () => { closeHub(); import('./copypages.js').then(m => m.openCopyPages(ed)); }),
        R('undo', 'กู้เส้นที่หาย (หน้านี้)', 'ย้อนดูสำเนาอัตโนมัติของหน้านี้', () => { closeHub(); import('./recover.js').then(m => m.openRecover(ed)); }),
        R('lib', 'กลับคลังสมุด', null, () => { closeHub(); app.openLibrary(); }),
      ];
    } },
    { id: 'out', ic: 'share', title: student ? 'ส่งงาน / ส่งออก' : 'ส่งออก', sub: student ? 'ส่งงานให้ครู PDF' : 'PDF รูป คลิป', rows: () => [
      ...(student ? [R('upload', 'ส่งงานให้ครู', null, () => { closeHub(); import('./exportpdf.js').then(m => m.openExportDialog(ed, { submit: true })); })] : []),
      R('pdf', 'บันทึกเป็น PDF', 'เลือกหน้า ใส่ลายน้ำผู้พัฒนาให้เอง', () => { closeHub(); import('./exportpdf.js').then(m => m.openExportDialog(ed)); }),
      R('save', 'บันทึกไฟล์ลงเครื่อง', null, go(a => ed.saveFileMenu(a))),
      ...(student ? [] : [
        R('share', 'ส่งออก / สำรอง', 'รูปภาพ ไฟล์สำรองสมุด', go(a => ed.exportMenu(a))),
        R('film', 'คลิปที่อัดไว้ (ทุกเล่ม)', 'ดู แชร์ ส่งขึ้น YouTube', () => { closeHub(); app.openRecordings(); }),
        R('scissors', 'โปรเจกต์ตัดต่อ (ปรับละเอียด)', 'สำหรับตัดหัว‑ท้าย แบ่งคลิป ความเร็ว', () => { closeHub(); import('./cut.js').then(m => m.openProjects(app)); }),
      ]),
    ] },
    { id: 'set', ic: 'gear', title: 'ตั้งค่า', sub: student ? 'การเขียน ธีมสี ภาษา' : 'การเขียน บัญชี ห้องเรียน', rows: () => [
      T('การเขียน'),
      S('เขียนด้วยนิ้ว', 'ปิดไว้: นิ้วใช้เลื่อนและซูม', toggle(prefs.fingerDraw, (v) => { prefs.fingerDraw = v; savePrefs(); })),
      S('แปลงเป็นรูปทรงอัตโนมัติ', 'ขีดแล้วกดค้างไว้ครู่หนึ่ง', toggle(prefs.shapeRecog, (v) => { prefs.shapeRecog = v; savePrefs(); ed.buildToolbar(); })),
      S('ขีดฆ่าเพื่อลบ', 'ขีดไปมาซ้ำ ๆ ทับเส้นที่ต้องการลบ', toggle(prefs.scribbleErase, (v) => { prefs.scribbleErase = v; savePrefs(); })),
      S('แสดง 2 หน้าคู่ (เล่มนี้)', null, toggle(prefs.twoPage && !ed.nb.single, (v) => { ed.nb.single = !v; if (v && !prefs.twoPage) { prefs.twoPage = true; savePrefs(); } ed.saveNb(); ed.relayout(true); })),
      T('หน้าตา'),
      h('div', { class: 'hub-row set', style: { flexDirection: 'column', alignItems: 'stretch' } }, h('div', { class: 'hub-rt' }, h('b', {}, 'ธีมสี')), colorPicker(() => ed.need.main = true)),
      S('ภาษา / Language', 'ตั้งแยกแต่ละเครื่อง', seg([['th', 'ไทย'], ['en', 'English']], prefs.lang === 'en' ? 'en' : 'th', (v) => { prefs.lang = v; savePrefs(); location.reload(); })),
      S('สว่าง / มืด', null, seg([['light', 'สว่าง'], ['dark', 'มืด'], ['auto', 'ตามระบบ']], prefs.theme, (v) => { prefs.theme = v; savePrefs(); applyTheme(); ed.need.main = true; })),
      S('ตำแหน่งแถบเครื่องมือ', null, seg([['top', 'บน'], ['left', 'ซ้าย'], ['right', 'ขวา'], ['bottom', 'ล่าง']], prefs.toolbarPos, (v) => { prefs.toolbarPos = v; savePrefs(); ed.applyPos(); ed.buildToolbar(); })),
      S('ใช้งานแบบ', 'โหมดนักเรียนซ่อนเครื่องมือของครู', seg([['t', 'ครู'], ['s', 'นักเรียน']], student ? 's' : 't', async (v) => { if (v === 't' && !(await (await import('./lock.js')).requireTeacher())) return; prefs.studentUI = v === 's'; savePrefs(); ed.buildToolbar(); closeHub(); })),
      T('อื่น ๆ'),
      R('gear', 'ตั้งค่าทั้งหมด', 'บัญชี Google / YouTube, ห้องเรียน, ตรวจความพร้อม, สถิติ', () => { closeHub(); app.openSettings(); }),
    ] },
    { id: 'help', ic: 'help', title: 'วิธีใช้', sub: 'อยากทำอะไร', rows: () => HOWTO.filter(x => !student || x.s).map(x => {
      const d = h('details', { class: 'hub-how' }, h('summary', {}, h('b', {}, x.q)), h('ol', {}, ...x.a.map(t => h('li', { html: t }))));
      return d;
    }).concat([R('help', 'คู่มือฉบับเต็ม', null, () => { closeHub(); app.openHelp(); })]) },
  ].filter(Boolean);

  root = h('div', { class: 'hub', 'data-nomirror': '1' });
  const top = h('div', { class: 'hub-top' }), main = h('div', { class: 'hub-main' });
  root.append(top, main); document.body.append(root);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) closeHub(); });
  const home = () => {
    top.replaceChildren(h('button', { class: 'pill sec hub-back' }, icon('back'), 'กลับไปกระดาน'), h('div', { class: 'hub-title' }, 'เมนู'));
    top.firstChild.onclick = closeHub; root.style.removeProperty('--tile');
    const grid = h('div', { class: 'hub-grid' });
    for (const p of PAGES) { const c = h('button', { class: 'hub-card', 'data-id': p.id }, h('span', { class: 'hub-ci' }, icon(p.ic)), h('b', {}, p.title), h('span', {}, p.sub)); c.onclick = () => p.direct ? p.direct() : open(p); grid.append(c); }
    main.replaceChildren(grid);
  };
  const open = (p) => {
    top.replaceChildren(h('button', { class: 'pill sec hub-back' }, icon('back'), 'เมนู'), h('span', { class: 'hub-tile' }, icon(p.ic)), h('div', { class: 'hub-title' }, p.title));
    top.firstChild.onclick = home;
    root.style.setProperty('--tile', TILE[p.id] || '');
    main.replaceChildren(h('div', { class: 'hub-page' }, ...p.rows()));
  };
  const want = page && PAGES.find(p => p.id === page);
  if (want && !want.direct) open(want); else home();
}

const TILE = { tv: '#2F5BEA', rec: '#E5484D', video: '#D9487F', teach: '#E0912F', pages: '#0F8A7E', out: '#7A4FE0', set: '#4B5563', help: '#1D9E75' };
export function colorPicker(after) {
  const box = h('div', { class: 'ctheme' });
  for (const [id, name, nav, acc] of COLOR_THEMES) {
    const b = h('button', { class: (prefs.color || 'navy') === id ? 'on' : '' }, h('div', { class: 'cb', style: { background: nav } }), h('div', { class: 'ca', style: { background: acc } }), h('span', {}, name));
    b.onclick = () => { prefs.color = id; savePrefs(); applyTheme(); for (const x of box.children) x.classList.toggle('on', x === b); after?.(); };
    box.append(b);
  }
  return box;
}
const HOWTO = [
  { q: 'อยากต่อทีวีให้นักเรียนดู', a: ['เมนู > <b>ต่อทีวี</b> > เชื่อมทีวี', 'บนทีวีเปิดลิงก์หรือสแกน QR ที่ขึ้น', 'เลือกว่าทีวีแสดงเฉพาะกระดาน หรือทั้งจอ'] },
  { q: 'อยากอัดบทเรียนไว้ให้นักเรียนดูย้อนหลัง', a: ['กดปุ่ม<b>ไมค์</b>บนแถบ (หรือ เมนู > อัดบทเรียน > เริ่มอัด)', 'สอนตามปกติ เสียงและลายมือถูกเก็บพร้อมกัน', 'กดไมค์อีกครั้ง > หยุดและบันทึก'] },
  { q: 'อยากทำคลิปขึ้น YouTube', a: ['เมนู > <b>ทำวิดีโอ</b> > เลือกบทเรียน > ถัดไป', 'ดูตัวอย่าง (ช่วงเงียบถูกตัดให้แล้ว) > ถัดไป', 'กด<b>ทำวิดีโอ</b> รอจนเสร็จ แล้วกด<b>ส่งขึ้น YouTube</b>'] },
  { q: 'อยากบังคำตอบแล้วค่อย ๆ เปิด', a: ['เมนู > เครื่องมือสอน > <b>ม่านบังคำตอบ</b>', 'ลากขอบม่านลงทีละนิด', 'ลากลงสุดหน้า ม่านจะหายเอง'] },
  { q: 'อยากจับเวลาทำแบบฝึก', s: true, a: ['กดปุ่ม<b>นาฬิกา</b>บนแถบ', 'เลือกเวลา หรือกดนับขึ้น', 'ลากนาฬิกาไปวางมุมไหนก็ได้'] },
  { q: 'อยากส่งงานให้ครู', s: true, a: ['เมนู > <b>ส่งงาน / ส่งออก</b> > ส่งงานให้ครู', 'เลือกหน้าที่จะส่ง', 'กดส่ง'] },
  { q: 'เส้นหาย / ลบผิด', s: true, a: ['กดปุ่ม<b>ย้อนกลับ</b> (ลูกศรวน) ซ้ำได้หลายครั้ง', 'ถ้ายังไม่กลับ: เมนู > หน้าและสมุด > <b>กู้เส้นที่หาย</b>', 'เลือกสำเนาที่ต้องการแล้วกดกู้'] },
];
