// Random student picker / group maker: a floating card on the teacher's page, mirrored to the student screen.
import { h, icon, toast, popover, dialog, ask, confirmBox, toggle, seg, makeDraggable } from './ui.js';
import { prefs, savePrefs } from './prefs.js';

const rosters = () => (prefs.rosters ||= {});
const names = (cls) => (rosters()[cls] || []);
const parseNames = (txt) => [...new Set(txt.split(/\r?\n|,|;/).map(s => s.replace(/^\s*\d+[.)]?\s*/, '').trim()).filter(Boolean))];

export class Picker {
  constructor(app) { this.app = app; this.el = null; this.cls = prefs.pickerClass || ''; this.used = new Set(); this.mode = 'one'; this.groupSize = 4; this.noRepeat = true; }
  get ed() { return this.app.editor; }
  broadcast(m) { this.app.broadcast?.post({ type: 'pick', ...m }); }

  open(anchor) {
    if (!Object.keys(rosters()).length) return this.manage(anchor, true);
    if (!this.el) this.build();
    this.ed?.stage.append(this.el); this.render();
  }
  close() { this.el?.remove(); this.broadcast({ off: true }); }

  build() {
    const el = this.el = h('div', { class: 'pickcard' });
    const head = h('div', { class: 'pk-head' }, h('i', { class: 'dgrip cgrip' }, h('i'), h('i')), h('b', {}, 'สุ่มชื่อ'), h('span', { class: 'pk-cls' }), h('span', { class: 'grow' }),
      B('gear', 'รายชื่อห้อง', (b) => this.manage(b)), B('close', 'ปิด', () => this.close()));
    this.body = h('div', { class: 'pk-body' });
    const ctl = h('div', { class: 'pk-ctl' },
      this.btnOne = h('button', { class: 'pill prim' }, icon('user'), 'สุ่ม 1 คน'),
      this.btnGrp = h('button', { class: 'pill sec' }, icon('lib'), 'สุ่มกลุ่ม'),
      this.btnReset = h('button', { class: 'pill ghost', title: 'เริ่มรอบใหม่ (ทุกคนกลับมาสุ่มได้)' }, icon('rotate')));
    this.btnOne.onclick = () => this.pickOne(); this.btnGrp.onclick = (b) => this.groupMenu(this.btnGrp); this.btnReset.onclick = () => { this.used.clear(); this.render(); toast('เริ่มรอบใหม่', 900); };
    el.append(head, this.body, ctl);
    makeDraggable(el, { grip: head.querySelector('.cgrip'), onStart: (sx, sy) => { const r = el.getBoundingClientRect(); this.dx = sx - r.left; this.dy = sy - r.top; }, onMove: (x, y) => { const sr = this.ed.stage.getBoundingClientRect(); el.style.left = Math.max(0, Math.min(sr.width - el.offsetWidth, x - this.dx - sr.left)) + 'px'; el.style.top = Math.max(0, Math.min(sr.height - el.offsetHeight, y - this.dy - sr.top)) + 'px'; } });
    function B(ic, t, fn) { const b = h('button', { class: 'btn sq', title: t }, icon(ic)); b.onclick = () => fn(b); return b; }
  }
  render() {
    const list = names(this.cls);
    this.el.querySelector('.pk-cls').textContent = this.cls ? `${this.cls} · ${list.length} คน` + (this.noRepeat ? ` · เหลือ ${list.filter(n => !this.used.has(n)).length}` : '') : 'ยังไม่เลือกห้อง';
    if (!this.result) this.body.replaceChildren(h('div', { class: 'pk-idle' }, 'กดสุ่ม'));
  }
  pool() { const list = names(this.cls); const left = this.noRepeat ? list.filter(n => !this.used.has(n)) : list; return left.length ? left : (this.used.clear(), toast('ครบทุกคนแล้ว · เริ่มรอบใหม่', 1200), list); }
  pickOne() {
    const pool = this.pool(); if (!pool.length) return toast('ห้องนี้ยังไม่มีรายชื่อ', 1200, 'warn');
    const win = pool[Math.floor(Math.random() * pool.length)];
    this.animate(pool, win, () => { if (this.noRepeat) this.used.add(win); this.result = win; this.render(); });
  }
  animate(pool, win, done) {
    const big = h('div', { class: 'pk-big spin' }); this.body.replaceChildren(big); this.result = win;
    const t0 = performance.now(), dur = 1800; let last = 0;
    const seq = pool.length > 1 ? pool : [...pool, '…'];
    const tick = () => {
      const t = performance.now() - t0;
      if (t >= dur) { big.textContent = win; big.classList.remove('spin'); big.classList.add('win'); this.broadcast({ names: [win], done: true, cls: this.cls }); done(); return; }
      const gap = 40 + 260 * Math.pow(t / dur, 2.2); // slows down towards the end
      if (performance.now() - last > gap) { last = performance.now(); big.textContent = seq[Math.floor(Math.random() * seq.length)]; this.broadcast({ names: [big.textContent], done: false, cls: this.cls }); }
      requestAnimationFrame(tick);
    };
    tick();
  }
  groupMenu(anchor) {
    const box = h('div', { class: 'scr-menu', style: { width: '320px' } });
    const n = h('input', { type: 'number', class: 'field', value: String(this.groupSize), min: 2, max: 12, style: { width: '90px' } });
    const by = seg([['size', 'กลุ่มละ'], ['count', 'จำนวนกลุ่ม']], this.groupBy || 'size', v => { this.groupBy = v; });
    const go = h('button', { class: 'pill prim', style: { width: '100%', marginTop: '10px' } }, 'สุ่มจัดกลุ่ม');
    go.onclick = () => { this.groupSize = Math.max(2, +n.value || 4); close(); this.makeGroups(); };
    box.append(h('div', { class: 'lbl' }, 'จัดกลุ่ม'), by, h('div', { class: 'row' }, h('span', {}, 'จำนวน'), n), go);
    const close = popover(anchor, box, {});
  }
  makeGroups() {
    const list = [...names(this.cls)]; if (list.length < 2) return toast('ต้องมีรายชื่ออย่างน้อย 2 คน', 1200, 'warn');
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const k = this.groupBy === 'count' ? Math.max(1, Math.min(list.length, this.groupSize)) : Math.max(1, Math.ceil(list.length / this.groupSize));
    const groups = Array.from({ length: k }, () => []); list.forEach((nm, i) => groups[i % k].push(nm));
    this.result = groups;
    this.body.replaceChildren(h('div', { class: 'pk-groups' }, ...groups.map((g, i) => h('div', { class: 'pk-g' }, h('b', {}, 'กลุ่ม ' + (i + 1)), ...g.map(x => h('div', {}, x))))));
    this.broadcast({ groups, done: true, cls: this.cls });
  }
  // rosters: one per class, names one per line (numbers in front are ignored)
  manage(anchor, first = false) {
    const box = h('div', { class: 'scr-menu', style: { width: 'min(520px, calc(100vw - 20px))' } });
    const R = rosters(); const keys = Object.keys(R).sort();
    const list = h('div', {});
    const refresh = () => {
      list.replaceChildren(...Object.keys(rosters()).sort().map(k => {
        const r = h('div', { class: 'row' }, h('button', { class: 'pill ' + (this.cls === k ? 'prim' : 'sec'), style: { flex: 1, justifyContent: 'flex-start' } }, `${k} · ${names(k).length} คน`), E('edit', 'แก้รายชื่อ', () => this.editRoster(k, refresh)), E('trash', 'ลบ', async () => { if (await confirmBox(`ลบรายชื่อห้อง ${k}?`, '', { ok: 'ลบ', danger: true })) { delete rosters()[k]; if (this.cls === k) this.cls = ''; savePrefs(); refresh(); } }));
        r.firstChild.onclick = () => { this.cls = k; prefs.pickerClass = k; savePrefs(); this.used.clear(); refresh(); if (this.el?.isConnected) this.render(); };
        return r;
      }));
      if (!Object.keys(rosters()).length) list.append(h('p', { class: 'sub', style: { padding: '8px 2px' } }, 'ยังไม่มีรายชื่อ · กด "เพิ่มห้อง" แล้ววางรายชื่อจาก Excel หรือพิมพ์ทีละบรรทัด'));
    };
    function E(ic, t, fn) { const b = h('button', { class: 'btn sq', title: t }, icon(ic)); b.onclick = fn; return b; }
    const add = h('button', { class: 'pill sec', style: { width: '100%', marginTop: '8px' } }, icon('plus'), 'เพิ่มห้อง'); add.onclick = () => this.editRoster(null, refresh);
    const opt = h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', {}, 'สุ่มไม่ซ้ำจนครบทุกคน'), toggle(this.noRepeat, v => { this.noRepeat = v; this.used.clear(); if (this.el?.isConnected) this.render(); }));
    box.append(h('div', { class: 'row' }, h('b', {}, 'รายชื่อห้อง'), h('span', { class: 'sub' }, 'แตะห้องเพื่อเลือก')), list, add, opt);
    if (first) { const go = h('button', { class: 'pill prim', style: { width: '100%', marginTop: '8px' } }, 'เริ่มสุ่ม'); go.onclick = () => { if (!this.cls) return toast('เลือกห้องก่อน', 1000, 'warn'); close(); this.open(anchor); }; box.append(go); }
    refresh();
    const close = popover(anchor, box, this.ed?.popOpts?.() || {});
  }
  editRoster(key, after) {
    const nameIn = h('input', { type: 'text', class: 'field', placeholder: 'ชื่อห้อง เช่น ม.6/2', value: key || '', style: { width: '100%' } });
    const ta = h('textarea', { class: 'field', rows: 12, placeholder: 'วางรายชื่อ บรรทัดละคน (มีเลขที่นำหน้าได้ เช่น 1. สมชาย)', style: { width: '100%', fontSize: '20px', lineHeight: '1.3' } }, key ? names(key).join('\n') : '');
    const body = h('div', {}, h('div', { class: 'lbl' }, 'ชื่อห้อง'), nameIn, h('div', { class: 'lbl', style: { marginTop: '8px' } }, 'รายชื่อ'), ta);
    dialog(key ? 'แก้รายชื่อ' : 'เพิ่มห้อง', body, [{ label: 'ยกเลิก' }, { label: 'บันทึก', cls: 'prim', flex: 2, action: () => {
      const k = nameIn.value.trim(), ns = parseNames(ta.value); if (!k) { toast('ใส่ชื่อห้อง', 1000, 'warn'); return false; }
      if (key && key !== k) delete rosters()[key]; rosters()[k] = ns; this.cls = k; prefs.pickerClass = k; savePrefs(); this.used.clear(); after?.(); if (this.el?.isConnected) this.render(); toast(`บันทึก ${k} · ${ns.length} คน`, 1200);
    } }], { width: 560 });
  }
}
