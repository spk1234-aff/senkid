// UI helpers: DOM builder, icons, toasts, dialogs, popovers
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
}

const P = {
  home: '<path d="M4 11 L12 4 L20 11 V20 H14 V14 H10 V20 H4 Z"/>',
  pageplus: '<path d="M6 3 H14 L19 8 V21 H6 Z"/><path d="M14 3 V8 H19"/><path d="M12.5 11 v6 M9.5 14 h6"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16 l-5-5 -9 8"/>',
  crop: '<path d="M6 2 V17 a1 1 0 0 0 1 1 H22"/><path d="M2 6 H17 a1 1 0 0 1 1 1 V22"/>',
  rotate: '<path d="M20 12 a8 8 0 1 1-2.3-5.6"/><path d="M20 4 V9 H15"/>',
  layer: '<path d="M12 3 L21 8 L12 13 L3 8 Z"/><path d="M3 13 L12 18 L21 13"/>',
  save: '<path d="M5 3 H16 L21 8 V19 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 V5 a2 2 0 0 1 2-2 Z"/><path d="M7 3 v5 h8 V3"/><rect x="7" y="13" width="10" height="8" rx="1"/>',
  lasso: '<path d="M12 4 C 6 4 3 6.5 3 9.5 S 6.5 15 12 15 S 21 12.5 21 9.5 S 18 4 12 4 Z" stroke-dasharray="3 2.6"/><path d="M7 14 c-1.5 2 -1 4.5 1.5 5.5"/>',
  laser: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 3 v3 M12 18 v3 M3 12 h3 M18 12 h3 M5.6 5.6 l2.1 2.1 M16.3 16.3 l2.1 2.1 M5.6 18.4 l2.1-2.1 M16.3 7.7 l2.1-2.1" opacity=".6"/>',
  text: '<path d="M5 6 V4 H19 V6"/><path d="M12 4 V20"/><path d="M9 20 H15"/>',
  timer: '<circle cx="12" cy="13" r="7"/><path d="M12 13 V9.5"/><path d="M10 3 H14"/>',
  screen: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M9 20 H15 M12 17 v3"/>',
  lib: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  pages: '<rect x="4" y="5" width="7" height="14" rx="1.5"/><rect x="13" y="5" width="7" height="14" rx="1.5"/>',
  undo: '<path d="M9 6 L4 11 L9 16"/><path d="M4 11 H14 a5 5 0 0 1 0 10 H11"/>',
  redo: '<path d="M15 6 L20 11 L15 16"/><path d="M20 11 H10 a5 5 0 0 0 0 10 H13"/>',
  pen: '<path d="M5 19 L6.5 14 L15.5 5 a2.1 2.1 0 0 1 3 3 L9.5 17 Z"/><path d="M13.5 7 l3 3"/>',
  fount: '<path d="M12 21 L7 12 L9 4 H15 L17 12 Z"/><path d="M12 21 V13"/><circle cx="12" cy="12" r="1.3"/>',
  ball: '<path d="M6 18 L16.5 7.5 a2 2 0 0 1 3 3 L9 21 H6 Z"/><path d="M6 18 l-2 2"/>',
  calli: '<path d="M7 20 L11 9 L17 6 L18 7 L15 13 L4 17 Z"/><path d="M11 9 l4 4"/>',
  brush: '<path d="M14 4 L20 10 L12 15 L9 12 Z"/><path d="M9 12 C 5 13, 6 18, 3 20 C 8 21, 12 19, 12 15"/>',
  marker: '<path d="M14 4 L20 10 L11 19 L5 13 Z"/><path d="M5 13 L3 20 L11 19"/>',
  pencil: '<path d="M5 19 L6.5 14 L15.5 5 a2.1 2.1 0 0 1 3 3 L9.5 17 Z"/><path d="M6.5 14 L9.5 17" /><path d="M5 19 l1.2-.4"/>',
  dash: '<path d="M4 18 L8 14 M10 12 L13 9 M15 7 L19 3" />',
  dot: '<circle cx="5" cy="19" r="1.2" fill="currentColor"/><circle cx="10" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="20" cy="4" r="1.2" fill="currentColor"/>',
  hl: '<path d="M7 15 L14 5 L19 9 L12 19 Z"/><path d="M7 15 L5 19 H12"/>',
  eraser: '<path d="M8 19 L4 15 L14 5 L20 11 L12 19 Z"/><path d="M9 10 l6 6"/><path d="M12 19 H20"/>',
  ruler: '<rect x="1.8" y="8.2" width="20.4" height="7.6" rx="1.4" transform="rotate(-35 12 12)"/><path d="M7.2 15.6l1.5 2.1M9.9 13.7l.9 1.3M12.6 11.8l1.5 2.1M15.3 9.9l.9 1.3M18 8l1.5 2.1" transform="rotate(-35 12 12) rotate(35 12 12)"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><rect x="8" y="6" width="8" height="3.5" rx=".8"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" stroke-width="2.4"/>',
  cloud: '<path d="M7 18 a4 4 0 0 1 -.5 -7.97 A5.5 5.5 0 0 1 17 8.5 a3.75 3.75 0 0 1 .5 9.5 Z"/>',
  sync: '<path d="M20 11 a8 8 0 0 0 -14.5 -3.5 M4 13 a8 8 0 0 0 14.5 3.5 M4 4 v5 h5 M20 20 v-5 h-5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20 c0-4 3.2-6.5 7-6.5 s7 2.5 7 6.5"/>',
  curtain: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 12 H20" /><path d="M4.5 12.5 H19.5 V19 a1.5 1.5 0 0 1 -1.5 1.5 H6 a1.5 1.5 0 0 1 -1.5 -1.5 Z" fill="currentColor" stroke="none" opacity=".55"/><path d="M10 9 L12 7 L14 9"/>',
  equation: '<path d="M4 6 H11 L7.5 12 L11 18 H4"/><path d="M14 10 l5 5 M19 10 l-5 5"/>',
  graph: '<path d="M4 20 V4 M4 20 H20"/><path d="M6 17 C 9 6, 12 6, 14 11 S 18 16, 19 7"/>',
  protractor: '<path d="M3 17 A9 9 0 0 1 21 17 Z"/><path d="M12 17 L12 13 M7.5 12.5 l1.5 1.3 M16.5 12.5 l-1.5 1.3"/>',
  compass: '<path d="M12 3 V6 M12 6 L7 20 M12 6 L17 20"/><circle cx="12" cy="6" r="1.6"/>',
  shrect: '<rect x="4.5" y="5.5" width="15" height="13" rx="1"/>',
  shellipse: '<circle cx="12" cy="12" r="7.5"/>',
  shtri: '<path d="M12 4.5 L20 19 H4 Z"/>',
  shdiamond: '<path d="M12 3.5 L20.5 12 L12 20.5 L3.5 12 Z"/>',
  shpill: '<rect x="3.5" y="7" width="17" height="10" rx="5"/>',
  shline: '<path d="M5 19 L19 5"/>',
  sharrow: '<path d="M5 19 L19 5 M11 5 H19 V13"/>',
  shelbow: '<path d="M5 6 H12 V18 H17 M14.5 15.5 L17 18 L14.5 20.5"/>',
  shcurve: '<path d="M4.5 18 C 6 8, 15 16, 17.5 6 M14.5 7.6 L17.5 5.5 L19.2 8.8"/>',
  shround: '<path d="M5 19 V11 a6 6 0 0 1 6 -6 H19"/>',
  magic: '<path d="M4 20 L14 10 M15 4 v3 M13.5 5.5 h3 M19 9 v2 M18 10 h2 M10 3.5 v2 M9 4.5 h2"/>',
  sticker: '<path d="M20 12.5 A8 8 0 1 1 11.5 4 H13 a7 7 0 0 0 7 7 Z"/><path d="M13 4 c0 4 3 7 7 7"/><path d="M9 14.5 c1.5 1.5 4.5 1.5 6 0"/><circle cx="9.5" cy="10.5" r=".6"/>',
  shape: '<circle cx="9" cy="9" r="5"/><rect x="11" y="11" width="9" height="9" rx="1"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16 l4 4"/>',
  plus: '<path d="M12 5 V19 M5 12 H19"/>',
  folder: '<path d="M3 7 a2 2 0 0 1 2-2 h4 l2 2 h8 a2 2 0 0 1 2 2 v8 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3 v2.5 M12 18.5 V21 M3 12 h2.5 M18.5 12 H21 M5.6 5.6 l1.8 1.8 M16.6 16.6 l1.8 1.8 M5.6 18.4 l1.8-1.8 M16.6 7.4 l1.8-1.8"/>',
  close: '<path d="M6 6 L18 18 M18 6 L6 18"/>',
  back: '<path d="M15 6 l-6 6 6 6"/>',
  scissors: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.6 8.6 L20 18 M8.6 15.4 L20 6"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8 V6 a2 2 0 0 0-2-2 H6 a2 2 0 0 0-2 2 v8 a2 2 0 0 0 2 2 h2"/><path d="M14 11 v6 M11 14 h6"/>',
  expand: '<path d="M3 12 H21"/><path d="M7 8 L3 12 L7 16"/><path d="M17 8 L21 12 L17 16"/>',
  palette: '<path d="M12 3 a9 9 0 1 0 0 18 c1.4 0 2-1 1.6-2.1 -.5-1.3.4-2.4 1.8-2.4 H18 a3 3 0 0 0 3-3 C21 7 17 3 12 3 Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11 a7 7 0 0 0 14 0 M12 18 V21"/>',
  chev: '<path d="M9 6 l6 6 -6 6"/>',
  down: '<path d="M6 9 l6 6 6-6"/>',
  up: '<path d="M6 15 l6-6 6 6"/>',
  pause: '<path d="M9 6 V18 M15 6 V18"/>',
  play: '<path d="M8 5 L19 12 L8 19 Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8 V6 a2 2 0 0 0-2-2 H6 a2 2 0 0 0-2 2 v8 a2 2 0 0 0 2 2 h2"/>',
  trash: '<path d="M4 7 H20 M10 11 v6 M14 11 v6 M6 7 l1 13 h10 l1-13 M9 7 V4 h6 v3"/>',
  download: '<path d="M12 4 v11 M7 10 l5 5 5-5 M5 20 h14"/>',
  upload: '<path d="M12 20 V9 M7 14 l5-5 5 5 M5 4 h14"/>',
  share: '<path d="M12 3 v12 M7 8 l5-5 5 5"/><path d="M5 12 v7 a2 2 0 0 0 2 2 h10 a2 2 0 0 0 2-2 v-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2 v2 M12 20 v2 M2 12 h2 M20 12 h2 M5 5 l1.4 1.4 M17.6 17.6 L19 19 M5 19 l1.4-1.4 M17.6 6.4 L19 5"/>',
  moon: '<path d="M20 14.5 A8 8 0 1 1 9.5 4 a6.5 6.5 0 0 0 10.5 10.5 Z"/>',
  hide: '<path d="M6 15 l6-6 6 6"/>',
  show: '<path d="M6 9 l6 6 6-6"/>',
  hand: '<path d="M8 13 V6 a1.5 1.5 0 0 1 3 0 V12 M11 11 V4.5 a1.5 1.5 0 0 1 3 0 V12 M14 11 V6 a1.5 1.5 0 0 1 3 0 V14 a6 6 0 0 1-6 6 h-1 a6 6 0 0 1-5-3 L3.5 13 a1.5 1.5 0 0 1 2.5-1.6 L8 14"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5 v14 M17 5 v14 M3 9 h4 M3 15 h4 M17 9 h4 M17 15 h4"/>',
  check: '<path d="M5 12 l4.5 4.5 L19 7"/>',
  edit: '<path d="M4 20 h4 L19 9 l-4-4 L4 16 Z"/>',
  bg: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8 h16 M4 13 h16 M9 3 v18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5 a2.5 2.5 0 1 1 3.5 2.3 c-.7.3-1 1-1 1.7 V14"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  fit: '<path d="M4 9 V4 H9 M20 9 V4 H15 M4 15 V20 H9 M20 15 V20 H15"/>',
  rec: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
};
export const icon = (n, cls = 'i') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.innerHTML = P[n] || ''; return s;
};

export function toast(msg, ms = 2400, cls = '') {
  const t = h('div', { class: 'toast ' + cls }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
}

const layer = () => document.getElementById('layer');

// Generic popover anchored to element. returns close fn
export function popover(anchor, content, { cls = '', onClose, place = 'auto', clearScrim = true } = {}) {
  const scrim = h('div', { class: 'scrim' + (clearScrim ? ' clear' : '') });
  const box = h('div', { class: 'pop ' + cls }, content);
  let closed = false;
  const close = () => { if (closed) return; closed = true; scrim.remove(); box.remove(); onClose && onClose(); };
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
  layer().append(scrim, box);
  const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2, width: 0, height: 0 };
  const bw = box.offsetWidth, bh = box.offsetHeight, m = 8, vw = innerWidth, vh = innerHeight;
  let x, y;
  const spaceBelow = vh - r.bottom, spaceRight = vw - r.right;
  if (place === 'side') {
    x = r.left > vw / 2 ? r.left - bw - m : r.right + m; y = r.top - 20;
  } else {
    x = r.left + r.width / 2 - bw / 2;
    y = spaceBelow >= bh + m || spaceBelow > r.top ? r.bottom + m : r.top - bh - m;
  }
  x = Math.max(m, Math.min(vw - bw - m, x)); y = Math.max(m, Math.min(vh - bh - m, y));
  box.style.left = x + 'px'; box.style.top = y + 'px';
  box._close = close;
  return close;
}

export function menu(anchor, items, opts = {}) {
  let close;
  const box = h('div', { class: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { box.append(h('hr')); continue; }
    if (it.header) { box.append(h('div', { class: 'mh' }, it.header)); continue; }
    const b = h('button', { class: 'mi' + (it.danger ? ' danger' : '') },
      it.icon ? icon(it.icon) : null, h('span', {}, it.label), it.right ? h('span', { class: 'r' }, it.right) : null);
    b.addEventListener('click', () => { if (!it.keep) close(); it.action && it.action(b); });
    box.append(b);
  }
  close = popover(anchor, box, opts);
  return close;
}

export function dialog(title, body, buttons = [], { onClose, width, noClose } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const d = h('div', { class: 'dialog', style: width ? { width: `min(${width}px, calc(100vw - 24px))` } : null });
  let closed = false;
  const close = (v) => { if (closed) return; closed = true; scrim.remove(); d.remove(); onClose && onClose(v); };
  const head = h('div', { class: 'head' }, h('div', { class: 'h' }, title));
  if (!noClose) { const x = h('button', { class: 'btn sq' }, icon('close')); x.onclick = () => close(); head.append(x); }
  d.append(head, body);
  if (buttons.length) {
    const f = h('div', { class: 'foot' });
    for (const b of buttons) {
      const el = h('button', { class: 'pill ' + (b.cls || 'sec'), style: b.flex ? { flex: b.flex } : null }, b.icon ? icon(b.icon) : null, b.label);
      el.onclick = async () => { const r = b.action ? await b.action(el) : undefined; if (r !== false) close(b.value ?? r); };
      f.append(el); b.el = el;
    }
    d.append(f);
  }
  if (!noClose) scrim.addEventListener('pointerdown', () => close());
  layer().append(scrim, d);
  d._close = close;
  return { el: d, close };
}

export function ask(title, { value = '', placeholder = '', ok = 'ตกลง' } = {}) {
  return new Promise((res) => {
    const inp = h('input', { class: 'field', type: 'text', value, placeholder });
    let result = null;
    const dg = dialog(title, inp, [{ label: 'ยกเลิก' }, { label: ok, cls: 'prim', flex: 2, action: () => { result = inp.value.trim(); } }], { onClose: () => res(result) });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = inp.value.trim(); dg.close(); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 60);
  });
}

export function confirmBox(title, text, { ok = 'ตกลง', danger = false } = {}) {
  return new Promise((res) => {
    let r = false;
    dialog(title, h('p', { style: { margin: '4px 0 0', color: 'var(--muted)' } }, text),
      [{ label: 'ยกเลิก' }, { label: ok, cls: danger ? 'danger' : 'prim', flex: 2, action: () => { r = true; } }], { onClose: () => res(r) });
  });
}

export function toggle(on, onChange) {
  const t = h('button', { class: 'tog' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false' });
  t.addEventListener('click', () => { const v = !t.classList.contains('on'); t.classList.toggle('on', v); t.setAttribute('aria-checked', v); onChange(v); });
  return t;
}

export function seg(options, value, onChange) {
  const s = h('div', { class: 'seg' });
  for (const [v, label] of options) {
    const b = h('button', { class: v === value ? 'on' : '' }, label);
    b.onclick = () => { $$('button', s).forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(v); };
    s.append(b);
  }
  return s;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function pickFile(accept, { hint } = {}) {
  // iPad: the system file picker can take a while to appear and to copy the file (iCloud) — show a message the whole time
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept, style: { display: 'none' } });
    let done = false, ov = null;
    const msg = h('div', { class: 'busy-msg' }, 'กำลังเปิดหน้าเลือกไฟล์…');
    const sub = h('div', { class: 'busy-sub' }, hint || 'เลือกไฟล์ในหน้าต่างของเครื่อง');
    const cancel = h('button', { class: 'pill sec', style: { marginTop: '14px', height: '42px' } }, 'ยกเลิก');
    const finish = (f) => { if (done) return; done = true; ov?.remove(); window.removeEventListener('focus', onFocus); i.remove(); res(f); };
    const onFocus = () => setTimeout(() => { if (done) return; msg.textContent = 'กำลังโหลดไฟล์จากเครื่อง…'; sub.textContent = 'ไฟล์ใหญ่ หรือไฟล์ที่อยู่บน iCloud / Drive อาจใช้เวลาสักครู่'; }, 400);
    cancel.onclick = () => finish(null);
    i.onchange = () => finish(i.files[0] || null);
    i.addEventListener('cancel', () => finish(null));
    window.addEventListener('focus', onFocus);
    document.body.append(i);
    ov = h('div', { class: 'busy picking' }, h('div', { class: 'busy-box' }, h('div', { class: 'spin' }), msg, sub, cancel));
    setTimeout(() => { if (!done) document.body.append(ov); }, 250);
    i.click();
  });
}

export function fmtBytes(b) {
  if (b == null || isNaN(b)) return '–';
  if (b >= 1e9) return (b / 1e9).toFixed(b >= 1e10 ? 0 : 1) + ' GB';
  if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' KB';
}
export function fmtTime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), hh = Math.floor(m / 60);
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(m % 60)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function fmtDate(t) {
  const d = new Date(t), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'เมื่อสักครู่';
  if (diff < 3600) return Math.floor(diff / 60) + ' นาทีที่แล้ว';
  if (d.toDateString() === now.toDateString()) return Math.floor(diff / 3600) + ' ชม. ที่แล้ว';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'เมื่อวาน';
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + (d.getFullYear() + 543) : ''}`;
}
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// long press helper
export function onLongPress(el, fn, ms = 500) {
  let t = null, sx = 0, sy = 0, fired = false;
  el.addEventListener('pointerdown', (e) => { fired = false; sx = e.clientX; sy = e.clientY; t = setTimeout(() => { fired = true; fn(e); }, ms); });
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', cancel); el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function brandWord(size = 34) {
  const w = h('div', { class: 'brand-word', style: { fontSize: size + 'px' } });
  w.innerHTML = `<span class="ins"><span class="e">เ</span><svg class="caret" viewBox="0 0 20 18"><path d="M2 16 L10 3 L18 16" stroke="var(--acc)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span style="position:relative">สิ้น<svg class="strike" viewBox="0 0 40 24"><path d="M3 18 C 12 10, 22 16, 37 4" stroke="#E5484D" stroke-width="4.2" fill="none" stroke-linecap="round"/><path d="M5 9 C 15 14, 25 6, 35 16" stroke="#E5484D" stroke-width="4.2" fill="none" stroke-linecap="round"/></svg></span></span>คิด`;
  return w;
}
export function logoMark(size = 44) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.innerHTML = '<rect width="64" height="64" rx="14" fill="#2F5BEA"/><path d="M19 12 H45 V29 L32 53 L19 29 Z" fill="#fff"/><path d="M32 31 V50" stroke="#2F5BEA" stroke-width="3.4" stroke-linecap="round"/><circle cx="32" cy="29" r="4.2" fill="#2F5BEA"/><rect x="19" y="12" width="26" height="6" fill="#F5B83D"/>';
  return s;
}

// Blocking "please wait" box with message and optional progress (0..1)
let busyEl = null, busyCount = 0;
export function busy(msg, sub) {
  busyCount++;
  if (!busyEl) {
    busyEl = h('div', { class: 'busy' }, h('div', { class: 'busy-box' }, h('div', { class: 'spin' }), h('div', { class: 'busy-msg' }), h('div', { class: 'busy-sub' }), h('div', { class: 'busy-bar' }, h('i'))));
    document.body.append(busyEl);
  }
  const box = busyEl;
  const api = {
    set(m, s, pct) {
      if (m != null) box.querySelector('.busy-msg').textContent = m;
      box.querySelector('.busy-sub').textContent = s || '';
      const bar = box.querySelector('.busy-bar');
      if (pct == null) bar.style.display = 'none'; else { bar.style.display = ''; bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%'; }
    },
    done() { if (api._done) return; api._done = true; busyCount = Math.max(0, busyCount - 1); if (!busyCount && busyEl) { busyEl.remove(); busyEl = null; } },
  };
  api.set(msg, sub, null);
  return api;
}
// run an async job with the busy box
export async function withBusy(msg, fn) { const b = busy(msg); try { return await fn(b); } finally { b.done(); } }
