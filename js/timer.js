// Classroom timer: countdown / stopwatch, floating widget or fullscreen, alarm sounds, optional in clip
import { h, icon, toast, popover, seg, toggle } from './ui.js';
import { prefs, savePrefs } from './prefs.js';

const QUICK = [1, 3, 5, 10, 15, 20];
const SOUNDS = [['bell', 'กระดิ่ง'], ['beep', 'บี๊บ'], ['chime', 'เสียงดนตรี'], ['none', 'ปิดเสียง']];
export const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s % 60).padStart(2, '0'); };
const fmtUp = (ms) => { const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s % 60).padStart(2, '0'); };

let ac = null;
function audio() { if (!ac) { const A = window.AudioContext || window.webkitAudioContext; ac = A ? new A() : null; } if (ac && ac.state === 'suspended') ac.resume(); return ac; }
export function playSound(kind) {
  const a = audio(); if (!a || kind === 'none') return;
  const now = a.currentTime;
  const tone = (f, t0, dur, type = 'sine', vol = 0.3) => { const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0.0001, now + t0); g.gain.exponentialRampToValueAtTime(vol, now + t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur); o.connect(g).connect(a.destination); o.start(now + t0); o.stop(now + t0 + dur + 0.05); };
  if (kind === 'bell') for (let r = 0; r < 3; r++) { tone(880, r * 0.9, 1.6, 'sine', .35); tone(1760, r * 0.9, 1.0, 'sine', .12); tone(2640, r * 0.9, .6, 'sine', .06); }
  else if (kind === 'beep') for (let r = 0; r < 6; r++) tone(1000, r * 0.32, .18, 'square', .14);
  else if (kind === 'chime') [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.22, .9, 'triangle', .25));
}

export class Timer {
  constructor(app) {
    this.app = app;
    const t = prefs.timer || {};
    this.s = { mode: 'down', total: 5 * 60e3, base: 5 * 60e3, running: false, at: 0, view: 'hidden', x: null, y: null, scale: t.scale || 1, sound: t.sound || 'bell', inClip: t.inClip ?? true, label: '', fired: false };
    this.subs = new Set();
    setInterval(() => this.tick(), 200);
  }
  get value() { const s = this.s; const run = s.running ? performance.now() - s.at : 0; return s.mode === 'down' ? s.total - run : s.total + run; }
  get visible() { return this.s.view !== 'hidden'; }
  save() { prefs.timer = { scale: this.s.scale, sound: this.s.sound, inClip: this.s.inClip, favs: (prefs.timer && prefs.timer.favs) || [] }; savePrefs(); }
  favs() { return (prefs.timer && prefs.timer.favs) || []; }
  onChange(f) { this.subs.add(f); }
  emit() { this.subs.forEach(f => f(this.state())); this.render(); }
  state() { const v = this.value; return { view: this.s.view, mode: this.s.mode, text: this.text(v), color: this.color(v), progress: this.progress(v), label: this.s.label, running: this.s.running, done: this.s.mode === 'down' && v <= 0, x: this.s.x, y: this.s.y, scale: this.s.scale, inClip: this.s.inClip }; }
  text(v = this.value) { return this.s.mode === 'down' ? fmt(v) : fmtUp(v); }
  color(v = this.value) { if (this.s.mode !== 'down') return null; if (v <= 10e3) return '#E5484D'; if (v <= 60e3) return '#F08A24'; return null; }
  progress(v = this.value) { return this.s.mode === 'down' ? Math.max(0, Math.min(1, v / this.s.base)) : 0; }
  set(ms, label) { const s = this.s; s.mode = 'down'; s.total = s.base = ms; s.running = false; s.fired = false; s.label = label || ''; if (s.view === 'hidden') s.view = 'float'; this.emit(); }
  start() { audio(); const s = this.s; if (s.mode === 'down' && this.value <= 0) { s.total = s.base; s.fired = false; } if (!s.running) { s.running = true; s.at = performance.now(); } if (s.view === 'hidden') s.view = 'float'; this.emit(); }
  pause() { const s = this.s; if (!s.running) return; s.total = this.value; s.running = false; this.emit(); }
  toggleRun() { this.s.running ? this.pause() : this.start(); }
  reset() { const s = this.s; s.running = false; s.total = s.mode === 'down' ? s.base : 0; s.fired = false; this.emit(); }
  addMinute() { const s = this.s; if (s.mode === 'down') { s.total += 60e3; s.base = Math.max(s.base, this.value); s.fired = false; } this.emit(); }
  stopwatch() { const s = this.s; s.mode = 'up'; s.total = 0; s.running = false; s.fired = false; if (s.view === 'hidden') s.view = 'float'; this.emit(); }
  setView(v) { this.s.view = v; this.emit(); }
  close() { this.pause(); this.s.view = 'hidden'; this.emit(); }
  tick() {
    const s = this.s;
    if (s.running && s.mode === 'down' && this.value <= 0 && !s.fired) {
      s.fired = true; s.total = 0; s.running = false; playSound(s.sound);
      this.emit();
    }
    if (s.running || (s.fired && this.visible)) this.emit();
  }

  // ---------- floating widget + fullscreen in the editor ----------
  attach(ed) { this.ed = ed; this.el = null; this.full = null; this.render(); }
  render() {
    const ed = this.ed; if (!ed || !ed.stage?.isConnected) return;
    const st = this.state();
    // floating
    if (st.view === 'float') {
      if (!this.el || !this.el.isConnected) this.buildFloat();
      const t = this.el.querySelector('.tm-t'); t.textContent = st.text; t.style.color = st.color || '';
      this.el.classList.toggle('done', st.done && !this.s.running);
      this.el.querySelector('.tm-run').replaceChildren(icon(st.running ? 'pause' : 'play'));
      this.el.style.setProperty('--sc', this.s.scale);
      this.placeFloat();
    } else if (this.el) { this.el.remove(); this.el = null; }
    // fullscreen
    if (st.view === 'full') {
      if (!this.full || !this.full.isConnected) this.buildFull();
      const t = this.full.querySelector('.tf-t'); t.textContent = st.text; t.style.color = st.color || '';
      this.full.querySelector('.tf-bar i').style.width = (st.mode === 'down' ? st.progress * 100 : 100) + '%';
      this.full.querySelector('.tf-bar i').style.background = st.color || 'var(--acc)';
      this.full.querySelector('.tf-run').replaceChildren(icon(st.running ? 'pause' : 'play'), st.running ? 'หยุดชั่วคราว' : (st.done ? 'เริ่มใหม่' : 'เริ่ม'));
      this.full.classList.toggle('done', st.done && !this.s.running);
      this.full.querySelector('.tf-lab').textContent = this.s.label || (st.mode === 'down' ? 'นับถอยหลัง' : 'จับเวลา');
    } else if (this.full) { this.full.remove(); this.full = null; }
  }
  buildFloat() {
    const B = (ic, title, fn, cls = '') => { const b = h('button', { class: 'btn sq ' + cls, title }, icon(ic)); b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
    const el = h('div', { class: 'tmfloat' },
      h('div', { class: 'tm-t' }),
      h('div', { class: 'tm-ctl' },
        B('play', 'เริ่ม/หยุด', () => this.toggleRun(), 'tm-run'),
        B('reset', 'รีเซ็ต', () => this.reset()),
        h('button', { class: 'btn tm-plus', title: 'เพิ่ม 1 นาที', onclick: (e) => { e.stopPropagation(); this.addMinute(); } }, '+1'),
        B('fit', 'เต็มจอ', () => this.setView('full')),
        B('timer', 'ตั้งเวลา', () => this.panel(this.el)),
        B('close', 'ปิดนาฬิกา', () => this.close())));
    // drag to move, pinch-free resize with the size buttons in the panel
    let d = null;
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); const r = el.getBoundingClientRect(), sr = this.ed.stage.getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top, sr }; });
    el.addEventListener('pointermove', (e) => { if (!d) return; this.s.x = (e.clientX - d.sr.left - d.dx) / d.sr.width; this.s.y = (e.clientY - d.sr.top - d.dy) / d.sr.height; this.placeFloat(); this.emitLight(); });
    el.addEventListener('pointerup', () => { d = null; });
    this.ed.stage.append(el); this.el = el;
  }
  emitLight() { this.subs.forEach(f => f(this.state())); }
  placeFloat() {
    const el = this.el, st = this.ed.stage; if (!el) return;
    const W = st.clientWidth, H = st.clientHeight, w = el.offsetWidth, hh = el.offsetHeight;
    let x = this.s.x == null ? W - w - 20 : this.s.x * W, y = this.s.y == null ? H - hh - 20 : this.s.y * H;
    x = Math.max(6, Math.min(W - w - 6, x)); y = Math.max(6, Math.min(H - hh - 6, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
    this.box = { x, y, w, h: hh };
  }
  buildFull() {
    const B = (label, fn, cls = 'sec') => { const b = h('button', { class: 'pill ' + cls }, label); b.onclick = fn; return b; };
    const run = h('button', { class: 'pill prim tf-run' }); run.onclick = () => this.toggleRun();
    const el = h('div', { class: 'tmfull' },
      h('div', { class: 'tf-top' }, seg([['down', 'นับถอยหลัง'], ['up', 'จับเวลาเดินหน้า']], this.s.mode, v => v === 'up' ? this.stopwatch() : this.set(this.s.base || 5 * 60e3)), h('div', { style: { flex: 1 } }),
        (() => { const b = h('button', { class: 'btn sq' }, icon('pages')); b.title = 'ย่อเป็นแบบลอย'; b.onclick = () => this.setView('float'); return b; })(),
        (() => { const b = h('button', { class: 'btn sq' }, icon('close')); b.title = 'ปิด'; b.onclick = () => this.close(); return b; })()),
      h('div', { class: 'tf-mid' }, h('div', { class: 'tf-lab' }), h('div', { class: 'tf-t' }), h('div', { class: 'tf-bar' }, h('i'))),
      h('div', { class: 'tf-ctl' }, B([icon('reset'), 'รีเซ็ต'], () => this.reset()), run, B('+1 นาที', () => this.addMinute())),
      h('div', { class: 'tf-quick' }, ...QUICK.map(m => B(m + ' นาที', () => { this.set(m * 60e3); this.start(); })),
        ...this.favs().map(ms => B([icon('star'), fmt(ms)], () => { this.set(ms); this.start(); })),
        B([icon('plus'), 'ตั้งเอง'], (e) => this.panel(e.currentTarget))));
    this.ed.el.append(el); this.full = el;
  }

  // ---------- settings popover ----------
  panel(anchor) {
    const box = h('div', { style: { width: 'min(420px, calc(100vw - 20px))' } });
    box.append(h('div', { class: 'lbl', style: { marginTop: 0 } }, 'ตั้งเวลาด่วน (แตะแล้วเริ่มนับทันที)'));
    const q = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px' } });
    for (const m of QUICK) { const b = h('button', { class: 'pill sec' }, m + ' นาที'); b.onclick = () => { close(); this.set(m * 60e3); this.start(); }; q.append(b); }
    box.append(q);
    const favs = this.favs();
    if (favs.length) {
      box.append(h('div', { class: 'lbl' }, 'ที่บันทึกไว้ (กดค้างเพื่อลบ)'));
      const fr = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
      favs.forEach((ms, i) => { const b = h('button', { class: 'pill sec' }, icon('star'), fmt(ms)); b.onclick = () => { close(); this.set(ms); this.start(); }; b.oncontextmenu = (e) => { e.preventDefault(); favs.splice(i, 1); this.save(); close(); toast('ลบเวลาที่บันทึกไว้แล้ว'); }; let lt; b.addEventListener('pointerdown', () => { lt = setTimeout(() => { favs.splice(i, 1); prefs.timer.favs = favs; savePrefs(); close(); toast('ลบเวลาที่บันทึกไว้แล้ว'); }, 650); }); b.addEventListener('pointerup', () => clearTimeout(lt)); fr.append(b); });
      box.append(fr);
    }
    box.append(h('div', { class: 'lbl' }, 'ตั้งเอง (นาที : วินาที)'));
    const mm = h('input', { class: 'field', type: 'number', min: 0, max: 600, value: Math.floor((this.s.base || 300e3) / 60e3), style: { width: '90px', textAlign: 'center' } });
    const ss = h('input', { class: 'field', type: 'number', min: 0, max: 59, value: Math.floor((this.s.base || 0) / 1000) % 60, style: { width: '90px', textAlign: 'center' } });
    const label = h('input', { class: 'field', type: 'text', placeholder: 'ชื่อกิจกรรม (ไม่ใส่ก็ได้) เช่น งานกลุ่ม', value: this.s.label || '' });
    const go = h('button', { class: 'pill prim', style: { flex: 1 } }, 'เริ่ม');
    const sv = h('button', { class: 'pill sec' }, icon('star'), 'บันทึก');
    const ms = () => ((+mm.value || 0) * 60 + Math.min(59, +ss.value || 0)) * 1000;
    go.onclick = () => { if (ms() <= 0) return; close(); this.set(ms(), label.value.trim()); this.start(); };
    sv.onclick = () => { if (ms() <= 0) return; const f = this.favs(); if (!f.includes(ms())) f.push(ms()); prefs.timer = { ...(prefs.timer || {}), favs: f }; savePrefs(); toast('บันทึกเวลานี้ไว้แล้ว', 1200); close(); };
    box.append(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, mm, ':', ss, sv), h('div', { style: { height: '8px' } }), label, h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, go,
      (() => { const b = h('button', { class: 'pill sec' }, 'จับเวลาเดินหน้า'); b.onclick = () => { close(); this.stopwatch(); this.start(); }; return b; })()));
    box.append(h('div', { class: 'lbl' }, 'เสียงเมื่อหมดเวลา'));
    const sr = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, seg(SOUNDS, this.s.sound, v => { this.s.sound = v; this.save(); playSound(v); }));
    box.append(sr);
    box.append(h('div', { class: 'lbl' }, 'ขนาดนาฬิกาแบบลอย'), seg([['0.8', 'เล็ก'], ['1', 'กลาง'], ['1.4', 'ใหญ่'], ['2', 'ใหญ่มาก']], String(this.s.scale), v => { this.s.scale = +v; this.save(); this.emit(); }));
    box.append(h('div', { class: 'row', style: { borderBottom: 0 } }, h('div', {}, h('div', {}, 'ให้นาฬิกาติดไปในคลิปที่อัด'), h('div', { class: 'sub' }, 'ปิดไว้ถ้าไม่อยากให้นักเรียนที่ดูคลิปเห็นเวลา')), toggle(this.s.inClip, v => { this.s.inClip = v; this.save(); this.emitLight(); })));
    if (this.visible) { const fsb = h('button', { class: 'pill ghost', style: { width: '100%' } }, icon('fit'), 'แสดงเต็มจอ'); fsb.onclick = () => { close(); this.setView('full'); }; box.append(fsb); }
    const close = popover(anchor, box, this.ed ? this.ed.popOpts() : {});
  }

  // draw into the recording canvas (k = canvas px per css px)
  drawInto(ctx, k, W, H) {
    if (!this.s.inClip || !this.visible) return;
    const st = this.state();
    ctx.save();
    if (st.view === 'full') {
      ctx.fillStyle = 'rgba(16,17,20,.92)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = st.color || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(H * 0.42)}px "TH Sarabun New", sans-serif`; ctx.fillText(st.text, W / 2, H * 0.5);
      if (this.s.label) { ctx.fillStyle = '#9AA0AA'; ctx.font = `${Math.round(H * 0.05)}px "TH Sarabun New", sans-serif`; ctx.fillText(this.s.label, W / 2, H * 0.22); }
    } else if (this.box) {
      const b = this.box; const x = b.x * k, y = b.y * k, w = b.w * k, hh = this.el ? this.el.querySelector('.tm-t').offsetHeight * k + 16 * k : b.h * k;
      ctx.fillStyle = 'rgba(32,34,39,.92)'; rr(ctx, x, y, w, hh, 14 * k); ctx.fill();
      ctx.fillStyle = st.color || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(hh * 0.78)}px "TH Sarabun New", sans-serif`; ctx.fillText(st.text, x + w / 2, y + hh * 0.56);
    }
    ctx.restore();
  }
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
