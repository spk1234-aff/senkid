// Pen / highlighter / eraser settings panels with color wheel
import { h, icon, popover, toast, seg, toggle, onLongPress, $$ } from './ui.js';
import { prefs, savePrefs, PEN_TYPES, PEN_LABEL } from './prefs.js';
import { penSample, hexToRgb, rgbToHex } from './render.js';

const LOGMIN = Math.log(0.1), LOGMAX = Math.log(50);
const toSlider = (v) => (Math.log(v) - LOGMIN) / (LOGMAX - LOGMIN);
const fromSlider = (t) => { const v = Math.exp(LOGMIN + t * (LOGMAX - LOGMIN)); return v < 1 ? Math.round(v * 20) / 20 : v < 10 ? Math.round(v * 10) / 10 : Math.round(v * 2) / 2; };

function rgbToHsv(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0; if (d) { hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh /= 6; if (hh < 0) hh += 1; } return [hh, mx ? d / mx : 0, mx]; }
function hsvToRgb(hh, s, v) { const f = (n) => { const k = (n + hh * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5) * 255, f(3) * 255, f(1) * 255]; }

export function openPenPanel(anchor, ed, opts = {}) {
  const isHl = () => ed.tool === 'hl';
  const box = h('div', { class: 'penpanel' });
  let close;

  // preview
  const prevCv = h('canvas');
  const ttl = h('div', { class: 'ttl' });
  const prev = h('div', { class: 'pp-prev' }, prevCv, ttl);

  // left: pen types + sizes
  const pens = h('div', { class: 'pens' });
  const types = PEN_TYPES.map(p => p[0]).concat(['hl']);
  const penBtns = types.map(t => {
    const cv = h('canvas');
    const b = h('button', { 'data-t': t }, cv, PEN_LABEL[t]);
    b.onclick = () => { ed.setPenType(t); refreshAll(); };
    pens.append(b);
    return { t, b, cv };
  });
  const sizeVal = h('span', { class: 'sizeval' });
  const slider = h('input', { type: 'range', min: 0, max: 1000, step: 1 });
  slider.oninput = () => { ed.setSize(fromSlider(slider.value / 1000)); refreshSize(); };
  const presets = h('div', { class: 'presets' });
  const left = h('div', {},
    h('div', { class: 'lbl', style: { marginTop: '8px' } }, 'หัวปากกา'), pens,
    h('div', { class: 'lbl' }, 'ขนาดเส้น (จุด) ', sizeVal), slider,
    h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '17px', color: 'var(--muted)', marginTop: '-4px' } }, h('span', {}, '0.1'), h('span', {}, '50')),
    h('div', { class: 'lbl' }, 'ขนาดลัด (กดค้างเพื่อเก็บขนาดปัจจุบัน)'), presets);
  const hlRow = h('div', { class: 'row', style: { borderBottom: 0 } }, h('div', {}, h('div', {}, 'ลากเป็นเส้นตรงอัตโนมัติ'), h('div', { class: 'sub' }, 'ไฮไลต์จะเป็นเส้นตรงจากจุดเริ่มถึงจุดปล่อย')),
    toggle(prefs.hl.straight, (v) => { prefs.hl.straight = v; savePrefs(); }));
  const hlStyle = h('div', {}, h('div', { class: 'lbl' }, 'แบบไฮไลต์'), seg([['brush', 'แปรง (สะบัด · เข้มอ่อนตามแรงกด)'], ['flat', 'หัวตัด (เรียบเท่ากัน)']], prefs.hl.style || 'brush', v => { prefs.hl.style = v; savePrefs(); refreshPreview(); }));
  left.append(hlStyle, hlRow);

  // right: color
  const wheelCv = h('canvas', { width: 420, height: 420 });
  const knob = h('div', { class: 'knob' });
  const wheel = h('div', { class: 'wheel' }, wheelCv, knob);
  const vBar = h('div', { class: 'bar' }), vK = h('div', { class: 'k' }); vBar.append(vK);
  const aBar = h('div', { class: 'bar checker' }), aFill = h('div', { style: { position: 'absolute', inset: 0, borderRadius: '15px' } }), aK = h('div', { class: 'k' }); aBar.append(aFill, aK);
  const hexIn = h('input', { class: 'field', type: 'text', maxlength: 7, spellcheck: 'false', autocapitalize: 'characters' });
  const aIn = h('input', { class: 'field', type: 'number', min: 5, max: 100, style: { width: '84px', flex: 'none', padding: '0 10px' } });
  const favsEl = h('div', { class: 'favs' });
  const recentEl = h('div', { class: 'recent' });
  const editBtn = h('button', { class: 'r' }, 'แก้ไข');
  const right = h('div', {},
    h('div', { class: 'lbl', style: { marginTop: '8px' } }, 'สี'),
    h('div', { class: 'cw' }, wheel, h('div', { class: 'side' },
      h('div', { class: 'lbl', style: { marginTop: 0 } }, 'ความสว่าง'), vBar,
      h('div', { class: 'lbl' }, 'ความทึบ'), aBar,
      h('div', { class: 'hexrow' }, h('div', { style: { flex: 1, position: 'relative' } }, hexIn), aIn, h('span', { style: { alignSelf: 'center', color: 'var(--muted)' } }, '%')))),
    h('div', { class: 'lbl' }, 'สีที่ใช้บ่อย', editBtn), favsEl,
    h('div', { class: 'lbl' }, 'สีล่าสุด'), recentEl);

  box.append(prev, h('div', { class: 'pp-grid' }, left, right));

  // ---- color state ----
  let H = 0, S = 0, V = 0;
  const curHex = () => ed.cur().color || '#000000';
  const curAlpha = () => ed.cur().alpha ?? 1;
  function loadColor() { [H, S, V] = rgbToHsv(...hexToRgb(curHex())); }
  function drawWheel() {
    const c = wheelCv.getContext('2d'), N = 420, R = N / 2;
    const im = c.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x - R, dy = y - R, d = Math.hypot(dx, dy) / R, i = (y * N + x) * 4;
      if (d > 1) { im.data[i + 3] = 0; continue; }
      const hh = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
      const [r, g, b] = hsvToRgb(hh, d, 1);
      im.data[i] = r; im.data[i + 1] = g; im.data[i + 2] = b; im.data[i + 3] = 255;
    }
    c.putImageData(im, 0, 0);
  }
  function setFromHSV(push = false) {
    const hex = rgbToHex(...hsvToRgb(H, S, V));
    ed.setColor(hex); refreshColorUI(false); refreshPreview(); refreshFavs();
  }
  function refreshColorUI(reload = true) {
    if (reload) loadColor();
    const R = 105;
    knob.style.left = (R + Math.cos(H * 2 * Math.PI) * S * R) + 'px';
    knob.style.top = (R + Math.sin(H * 2 * Math.PI) * S * R) + 'px';
    knob.style.background = curHex();
    const full = rgbToHex(...hsvToRgb(H, S, 1));
    vBar.style.background = `linear-gradient(90deg,#000,${full})`;
    vK.style.left = (V * 100) + '%'; vK.style.background = curHex();
    aFill.style.background = `linear-gradient(90deg,${curHex()}00,${curHex()})`;
    aK.style.left = (curAlpha() * 100) + '%';
    if (document.activeElement !== hexIn) hexIn.value = curHex();
    if (document.activeElement !== aIn) aIn.value = Math.round(curAlpha() * 100);
    wheelCv.style.opacity = V < .15 ? .6 : 1;
  }
  function dragOn(el, fn) {
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); fn(e); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) fn(e); });
  }
  dragOn(wheel, (e) => {
    const r = wheel.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    H = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1; S = Math.min(1, Math.hypot(dx, dy) / (r.width / 2)); if (V < 0.2) V = 1;
    setFromHSV();
  });
  dragOn(vBar, (e) => { const r = vBar.getBoundingClientRect(); V = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); setFromHSV(); });
  dragOn(aBar, (e) => { const r = aBar.getBoundingClientRect(); ed.setAlpha(Math.round(Math.max(.05, Math.min(1, (e.clientX - r.left) / r.width)) * 100) / 100); refreshColorUI(false); refreshPreview(); });
  hexIn.addEventListener('input', () => { let v = hexIn.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-fA-F]{6}$/.test(v)) { ed.setColor(v.toUpperCase()); loadColor(); refreshColorUI(false); refreshPreview(); refreshFavs(); } });
  aIn.addEventListener('change', () => { const v = Math.max(5, Math.min(100, +aIn.value || 100)); ed.setAlpha(v / 100); refreshColorUI(false); refreshPreview(); });

  // ---- favorites ----
  let editing = false;
  const favList = () => isHl() ? prefs.hlFavorites : prefs.favorites;
  editBtn.onclick = () => { editing = !editing; editBtn.textContent = editing ? 'เสร็จ' : 'แก้ไข'; refreshFavs(); };
  function refreshFavs() {
    favsEl.innerHTML = ''; favsEl.classList.toggle('edit', editing);
    const list = favList(), cur = curHex().toUpperCase();
    list.forEach((c, i) => {
      const b = h('button', { class: 'sw' + (c.toUpperCase() === cur ? ' on' : ''), title: c }, h('i', { style: { background: c } }), h('span', { class: 'x' }, '×'));
      b.onclick = () => {
        if (editing) { list.splice(i, 1); savePrefs(); refreshFavs(); ed.buildToolbar(); return; }
        ed.setColor(c); loadColor(); refreshColorUI(false); refreshPreview(); refreshFavs();
      };
      if (editing) enableDrag(b, i);
      favsEl.append(b);
    });
    const add = h('button', { class: 'add', title: 'เพิ่มสีปัจจุบัน' }, icon('plus'));
    add.onclick = () => { if (!list.some(c => c.toUpperCase() === cur)) { list.push(cur); savePrefs(); refreshFavs(); ed.buildToolbar(); toast('เพิ่มสีที่ใช้บ่อยแล้ว', 1200); } else toast('มีสีนี้อยู่แล้ว', 1200); };
    favsEl.append(add);
    recentEl.innerHTML = '';
    for (const c of prefs.recent) { const b = h('button', { style: { background: c }, title: c }); b.onclick = () => { ed.setColor(c); loadColor(); refreshColorUI(false); refreshPreview(); refreshFavs(); }; recentEl.append(b); }
    if (!prefs.recent.length) recentEl.append(h('span', { style: { fontSize: '18px', color: 'var(--muted)' } }, 'สีที่เขียนล่าสุดจะขึ้นที่นี่อัตโนมัติ'));
  }
  function enableDrag(b, i) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); b.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY; let moved = false; let target = i;
      const mv = (ev) => {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) moved = true;
        b.style.transform = `translate(${ev.clientX - sx}px,${ev.clientY - sy}px)`; b.style.zIndex = 5;
        const kids = $$('.sw', favsEl);
        kids.forEach((k, j) => { if (k === b) return; const r = k.getBoundingClientRect(); if (ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom) target = j; });
      };
      const upf = () => {
        b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', upf); b.removeEventListener('pointercancel', upf);
        b.style.transform = ''; b.style.zIndex = '';
        if (moved && target !== i) { const l = favList(); const [c] = l.splice(i, 1); l.splice(target, 0, c); savePrefs(); ed.buildToolbar(); refreshFavs(); }
        else if (!moved) { const l = favList(); l.splice(i, 1); savePrefs(); ed.buildToolbar(); refreshFavs(); }
      };
      b.addEventListener('pointermove', mv); b.addEventListener('pointerup', upf); b.addEventListener('pointercancel', upf);
    }, { capture: true });
    b.onclick = null;
  }

  // ---- size ----
  function refreshSize() {
    const c = ed.cur();
    sizeVal.textContent = c.size + ' จุด';
    slider.value = Math.round(toSlider(c.size) * 1000);
    presets.innerHTML = '';
    const mx = Math.max(...c.presets);
    c.presets.forEach((v, i) => {
      const d = Math.max(3, Math.min(30, 3 + 27 * Math.sqrt(v / mx)));
      const b = h('button', { class: Math.abs(v - c.size) < 1e-6 ? 'on' : '' }, h('i', { style: { width: d + 'px', height: d + 'px', background: c.color || 'var(--text)', opacity: c.kind === 'hl' ? .5 : 1 } }), String(v));
      b.onclick = () => { ed.setSize(v); refreshSize(); refreshPreview(); };
      onLongPress(b, () => { c.presets[i] = c.size; savePrefs(); ed.refreshToolbarState(); refreshSize(); toast(`เก็บขนาด ${c.size} ไว้ที่ปุ่มลัดแล้ว`, 1400); });
      presets.append(b);
    });
    refreshPreview();
  }
  function refreshPreview() {
    const c = ed.cur();
    const w = prevCv.getBoundingClientRect().width || 560;
    penSample(prevCv, c.type, c.kind === 'hl' ? 'hl' : 'pen', c.color, c.size, w, 72, prefs.hl.style || 'brush');
    prevCv.style.opacity = c.alpha ?? 1;
    ttl.innerHTML = '';
    ttl.append(h('b', {}, c.kind === 'hl' ? 'ไฮไลต์' : 'ปากกา' + PEN_LABEL[c.type]), h('div', {}, `${c.size} จุด · ${c.color} · ทึบ ${Math.round((c.alpha ?? 1) * 100)}%`));
    for (const p of penBtns) {
      p.b.classList.toggle('on', p.t === c.type);
      penSample(p.cv, p.t, p.t === 'hl' ? 'hl' : 'pen', p.t === 'hl' ? prefs.hl.color : '#1E2A55', p.t === 'hl' ? 10 : Math.max(1.4, Math.min(5, prefs.pens[p.t].size * 1.4)), 110, 34, prefs.hl.style || 'brush');
    }
  }
  function refreshAll() { hlRow.style.display = hlStyle.style.display = isHl() ? '' : 'none'; loadColor(); refreshColorUI(false); refreshSize(); refreshFavs(); }

  close = popover(anchor, box, { ...opts, onClose: () => ed.buildToolbar() });
  drawWheel(); refreshAll();
  requestAnimationFrame(refreshPreview);
  return close;
}

export function openEraserPanel(anchor, ed, opts = {}) {
  const box = h('div', { style: { width: '360px' } });
  const c = prefs.eraser;
  box.append(h('div', { class: 'lbl', style: { marginTop: '2px' } }, 'แบบยางลบ'),
    seg([['stroke', 'ลบทั้งเส้น'], ['area', 'ลบเฉพาะส่วนที่ถู']], c.mode, (v) => { c.mode = v; savePrefs(); }));
  const val = h('span', { class: 'sizeval' }, c.size + ' จุด');
  const sl = h('input', { type: 'range', min: 2, max: 120, step: 1, value: c.size });
  sl.oninput = () => { c.size = +sl.value; val.textContent = c.size + ' จุด'; savePrefs(); ed.refreshToolbarState(); pre(); };
  const presets = h('div', { class: 'presets' });
  const pre = () => {
    presets.innerHTML = '';
    c.presets.forEach((v, i) => {
      const b = h('button', { class: v === c.size ? 'on' : '' }, h('i', { style: { width: Math.min(30, 4 + v / 2) + 'px', height: Math.min(30, 4 + v / 2) + 'px', background: 'transparent', border: '2px solid var(--text)' } }), String(v));
      b.onclick = () => { c.size = v; sl.value = v; val.textContent = v + ' จุด'; savePrefs(); ed.refreshToolbarState(); pre(); };
      onLongPress(b, () => { c.presets[i] = c.size; savePrefs(); pre(); ed.refreshToolbarState(); toast('เก็บขนาดไว้ที่ปุ่มลัดแล้ว', 1200); });
      presets.append(b);
    });
  };
  pre();
  box.append(h('div', { class: 'lbl' }, 'ขนาดยางลบ ', val), sl, h('div', { class: 'lbl' }, 'ขนาดลัด (กดค้างเพื่อเก็บ)'), presets,
    h('p', { style: { fontSize: '18px', color: 'var(--muted)', margin: '12px 0 0' } }, 'เคล็ดลับ: แตะด้วย 2 นิ้ว = ย้อนกลับ · แตะด้วย 3 นิ้ว = ทำซ้ำ'));
  return popover(anchor, box, opts);
}

// ---- colour manager: long-press any swatch on the toolbar / dock ----
// reorder by dragging, tap a swatch to change that colour, × removes, + adds. Shared by pen and highlighter lists.
export function openColorManager(anchor, ed, opts = {}) {
  const isHl = () => ed.tool === 'hl';
  const list = () => isHl() ? prefs.hlFavorites : prefs.favorites;
  const box = h('div', { class: 'cmgr' });
  box.append(h('div', { class: 'ttl' }, h('b', {}, isHl() ? 'สีไฮไลต์' : 'สีปากกา'), h('div', { class: 'sub' }, 'ลากเพื่อเรียง · แตะเพื่อแก้สี · × ลบ')));
  const favsEl = h('div', { class: 'favs edit cm-list' }); box.append(favsEl);
  const editor = h('div', { class: 'cm-edit hidden' }); box.append(editor);
  let editIdx = -1;
  const commit = () => { savePrefs(); ed.buildToolbar(); ed.buildDock?.(); };
  function openEditor(i) {
    editIdx = i; const l = list(); editor.classList.remove('hidden'); editor.innerHTML = '';
    const cur = l[i];
    const wheel = h('input', { type: 'color', value: cur.slice(0, 7), class: 'cm-wheel' });
    const hex = h('input', { type: 'text', value: cur.toUpperCase(), class: 'field cm-hex', maxlength: 7, spellcheck: false, autocapitalize: 'characters' });
    const prev = h('i', { class: 'cm-prev', style: { background: cur } });
    const apply = (v) => { if (!/^#[0-9A-F]{6}$/i.test(v)) return; l[i] = v.toUpperCase(); prev.style.background = v; hex.value = v.toUpperCase(); wheel.value = v; commit(); refresh(false); };
    wheel.oninput = () => apply(wheel.value); hex.onchange = () => apply(hex.value.startsWith('#') ? hex.value : '#' + hex.value);
    const useBtn = h('button', { class: 'pill prim', style: { height: '40px' } }, 'ใช้สีนี้'); useBtn.onclick = () => { ed.setColor(l[i]); };
    const doneBtn = h('button', { class: 'pill ghost', style: { height: '40px' } }, 'ปิด'); doneBtn.onclick = () => { editor.classList.add('hidden'); editIdx = -1; refresh(); };
    editor.append(h('div', { class: 'row' }, prev, h('label', { class: 'cm-wrap' }, wheel, h('span', {}, 'วงล้อสี')), hex), h('div', { class: 'row' }, useBtn, doneBtn));
  }
  function refresh(rebuild = true) {
    if (!rebuild) { $$('.sw', favsEl).forEach((b, j) => { b.querySelector('i').style.background = list()[j]; b.classList.toggle('on', j === editIdx); }); return; }
    favsEl.innerHTML = '';
    const l = list();
    l.forEach((c, i) => {
      const b = h('button', { class: 'sw' + (i === editIdx ? ' on' : ''), title: c }, h('i', { style: { background: c } }), h('span', { class: 'x' }, '×'));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); b.setPointerCapture(e.pointerId);
        const sx = e.clientX, sy = e.clientY; let moved = false; let target = i;
        const onX = e.target.classList.contains('x');
        const mv = (ev) => {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) moved = true;
          if (!moved) return;
          b.style.transform = `translate(${ev.clientX - sx}px,${ev.clientY - sy}px)`; b.style.zIndex = 5;
          $$('.sw', favsEl).forEach((k, j) => { if (k === b) return; const r = k.getBoundingClientRect(); if (ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom) target = j; });
        };
        const upf = () => {
          b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', upf); b.removeEventListener('pointercancel', upf);
          b.style.transform = ''; b.style.zIndex = '';
          const L = list();
          if (moved && target !== i) { const [c] = L.splice(i, 1); L.splice(target, 0, c); if (editIdx === i) editIdx = target; commit(); refresh(); }
          else if (!moved && onX) { if (L.length <= 1) { toast('ต้องมีอย่างน้อย 1 สี', 1200); return; } L.splice(i, 1); if (editIdx === i) { editIdx = -1; editor.classList.add('hidden'); } commit(); refresh(); }
          else if (!moved) openEditor(i), refresh();
        };
        b.addEventListener('pointermove', mv); b.addEventListener('pointerup', upf); b.addEventListener('pointercancel', upf);
      }, { capture: true });
      favsEl.append(b);
    });
    const add = h('button', { class: 'add', title: 'เพิ่มสี' }, icon('plus'));
    add.onclick = () => { const L = list(); if (L.length >= 16) { toast('เก็บได้สูงสุด 16 สี', 1500); return; } const cur = (ed.cur().color || '#1E2A55').toUpperCase(); L.push(L.some(c => c.toUpperCase() === cur) ? '#888888' : cur); commit(); openEditor(L.length - 1); refresh(); };
    favsEl.append(add);
  }
  refresh();
  const reset = h('button', { class: 'pill ghost', style: { width: '100%', marginTop: '8px', fontSize: '18px' } }, 'คืนค่าสีเริ่มต้น');
  reset.onclick = () => { const d = isHl() ? ['#F5B83D', '#7FE07A', '#7CC7FF', '#FF8FB1', '#C9A7FF'] : ['#1E2A55', '#2F5BEA', '#D64545', '#1E9E5A', '#F5B83D', '#7A4BD6', '#000000', '#E06B2D']; list().splice(0, list().length, ...d); editIdx = -1; editor.classList.add('hidden'); commit(); refresh(); };
  box.append(reset);
  return popover(anchor, box, opts);
}
