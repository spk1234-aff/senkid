// Math tools: LaTeX equations (MathJax → picture), graphs / axes / number lines.
// Each is inserted as a picture that remembers how it was made (s.meta), so it can be edited again.
import { h, icon, dialog, toast, seg, busy } from './ui.js';
import { prefs, savePrefs } from './prefs.js';

const EXTRA_CACHE = 'senkidfonts-v1';
const COLORS = ['#1E2A55', '#2F5BEA', '#D64545', '#1E9E5A', '#E07B2D', '#7A4BD6', '#000000'];

// ---------- MathJax (loaded on first use, kept for offline) ----------
let mjP = null;
export function loadMathJax() {
  if (mjP) return mjP;
  mjP = new Promise((res, rej) => {
    window.MathJax = { startup: { typeset: false, ready: () => { window.MathJax.startup.defaultReady(); res(window.MathJax); } }, svg: { fontCache: 'none' }, tex: { packages: { '[+]': ['ams', 'boldsymbol', 'cancel', 'color'] } } };
    const src = new URL('vendor/mathjax/tex-svg-full.js', document.baseURI).href;
    const sc = document.createElement('script'); sc.src = src; sc.async = true;
    sc.onerror = () => { mjP = null; rej(new Error('โหลดตัวแสดงสมการไม่ได้ (ต้องต่อเน็ตครั้งแรก)')); };
    document.head.append(sc);
    caches?.open(EXTRA_CACHE).then(async c => { if (!(await c.match(src))) { const r = await fetch(src); if (r.ok) c.put(src, r); } }).catch(() => { });
  });
  return mjP;
}
function texSvg(MJ, tex, color) {
  const node = MJ.tex2svg(tex, { display: true });
  const svg = node.querySelector('svg'); if (!svg) throw new Error('สมการไม่ถูกต้อง');
  if (node.querySelector('[data-mjx-error]')) throw new Error(node.querySelector('[data-mjx-error]').getAttribute('data-mjx-error') || 'สมการไม่ถูกต้อง');
  const ex = (v) => parseFloat(v) || 1;
  const wEx = ex(svg.getAttribute('width')), hEx = ex(svg.getAttribute('height'));
  svg.setAttribute('style', `color:${color}`); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return { svg, wEx, hEx };
}
// draw to a canvas: exPx = pixels per ex
async function svgToCanvas(svg, wEx, hEx, exPx) {
  const W = Math.ceil(wEx * exPx), H = Math.ceil(hEx * exPx);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const im = new Image(); im.src = url; await im.decode();
    const c = document.createElement('canvas'); c.width = W + 8; c.height = H + 8;
    c.getContext('2d').drawImage(im, 4, 4, W, H); return c;
  } finally { URL.revokeObjectURL(url); }
}
const toFile = async (c, name) => new File([await new Promise(r => c.toBlob(r, 'image/png'))], name, { type: 'image/png' });

const SNIPS = [['เศษส่วน', '\\frac{a}{b}'], ['√', '\\sqrt{x}'], ['ⁿ√', '\\sqrt[n]{x}'], ['xⁿ', 'x^{n}'], ['xₙ', 'x_{n}'], ['π', '\\pi'], ['θ', '\\theta'], ['α', '\\alpha'], ['β', '\\beta'], ['≤', '\\le'], ['≥', '\\ge'], ['≠', '\\ne'], ['≈', '\\approx'], ['×', '\\times'], ['÷', '\\div'], ['±', '\\pm'], ['·', '\\cdot'], ['∞', '\\infty'], ['°', '^{\\circ}'], ['∠', '\\angle'], ['△', '\\triangle'], ['∥', '\\parallel'], ['⊥', '\\perp'], ['∈', '\\in'], ['∪', '\\cup'], ['∩', '\\cap'], ['⊂', '\\subset'], ['∅', '\\emptyset'], ['ℝ', '\\mathbb{R}'], ['Σ', '\\sum_{i=1}^{n}'], ['∫', '\\int_{a}^{b}'], ['lim', '\\lim_{x\\to a}'], ['log', '\\log_{a}'], ['sin', '\\sin'], ['cos', '\\cos'], ['tan', '\\tan'], ['|x|', '\\left| x \\right|'], ['( )', '\\left( x \\right)'], ['vec', '\\vec{v}'], ['เมทริกซ์', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'], ['ระบบสมการ', '\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}'], ['ข้อความ', '\\text{ไทย}']];

// returns {file, meta, w, h} (w,h in page units) or null
export async function equationDialog(old) {
  let MJ; const bz = busy('กำลังเตรียมตัวแสดงสมการ…');
  try { MJ = await loadMathJax(); } catch (e) { toast(e.message, 3500, 'warn'); return null; } finally { bz.done(); }
  const m = old || { tex: prefs.lastTex || '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', color: prefs.penColor || '#1E2A55', size: 22 };
  const ta = h('textarea', { class: 'field eq-src', rows: 3, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' }); ta.value = m.tex;
  const prev = h('div', { class: 'eq-prev' }), err = h('div', { class: 'eq-err' });
  let color = m.color, size = m.size;
  const draw = () => { try { const { svg } = texSvg(MJ, ta.value || '\\square', color); svg.style.maxWidth = '100%'; svg.style.height = 'auto'; prev.innerHTML = ''; prev.append(svg); err.textContent = ''; } catch (e) { err.textContent = e.message; } };
  let t; ta.oninput = () => { clearTimeout(t); t = setTimeout(draw, 150); };
  const snips = h('div', { class: 'eq-snips' });
  for (const [l, code] of SNIPS) { const b = h('button', { class: 'chip' }, l); b.onclick = () => { const s0 = ta.selectionStart, s1 = ta.selectionEnd; ta.setRangeText(code, s0, s1, 'end'); ta.focus(); draw(); }; snips.append(b); }
  const cols = h('div', { class: 'eq-cols' });
  const setC = () => { for (const b of cols.children) b.classList.toggle('on', b.dataset.c === color); draw(); };
  for (const c of COLORS) { const b = h('button', { class: 'sw', 'data-c': c }, h('i', { style: { background: c } })); b.onclick = () => { color = c; setC(); }; cols.append(b); }
  const sz = seg([[16, 'เล็ก'], [22, 'กลาง'], [32, 'ใหญ่'], [46, 'ใหญ่มาก']], size, v => { size = +v; });
  const body = h('div', { class: 'eq-dlg' }, h('div', { class: 'lbl' }, 'พิมพ์สมการแบบ LaTeX'), ta, snips, prev, err, h('div', { class: 'eq-row' }, cols, sz));
  setC();
  return new Promise((res) => {
    let ok = false;
    dialog(old ? 'แก้ไขสมการ' : 'แทรกสมการ', body, [
      { label: 'ยกเลิก', action: () => { } },
      { label: old ? 'บันทึก' : 'แทรก', cls: 'prim', flex: 2, action: async () => {
        try {
          const { svg, wEx, hEx } = texSvg(MJ, ta.value.trim() || '\\square', color);
          const c = await svgToCanvas(svg, wEx, hEx, 40); // sharp when zoomed
          prefs.lastTex = ta.value; savePrefs(); ok = true;
          const k = size * 0.45; // page units per ex
          res({ file: await toFile(c, 'equation.png'), meta: { kind: 'tex', tex: ta.value, color, size }, w: (wEx * 40 + 8) / 40 * k, h: (hEx * 40 + 8) / 40 * k });
        } catch (e) { toast(e.message, 3000, 'warn'); res(null); }
      } },
    ], { width: 720, onClose: () => { if (!ok) res(null); } });
    setTimeout(() => ta.focus(), 50);
  });
}

// ---------- expression parser (safe; no eval) ----------
export function compile(src) {
  const s = src.replace(/\s+/g, '').replace(/^y=/i, '').replace(/^f\(x\)=/i, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt');
  let i = 0;
  const F = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, sec: x => 1 / Math.cos(x), csc: x => 1 / Math.sin(x), cot: x => 1 / Math.tan(x) };
  const peek = () => s[i];
  const expr = () => { let a = term(); while (peek() === '+' || peek() === '-') { const op = s[i++], b = term(), A = a; a = op === '+' ? (x => A(x) + b(x)) : (x => A(x) - b(x)); } return a; };
  const startsFactor = () => { const c = peek(); return c && (/[0-9.a-z(]/i.test(c)); };
  const term = () => { let a = unary(); for (;;) { if (peek() === '*' || peek() === '/') { const op = s[i++], b = unary(), A = a; a = op === '*' ? (x => A(x) * b(x)) : (x => A(x) / b(x)); } else if (startsFactor()) { const b = power(), A = a; a = x => A(x) * b(x); } else break; } return a; };
  const unary = () => { if (peek() === '-') { i++; const a = unary(); return x => -a(x); } if (peek() === '+') { i++; return unary(); } return power(); };
  const power = () => { const a = atom(); if (peek() === '^') { i++; const b = unary(); return x => Math.pow(a(x), b(x)); } return a; };
  const atom = () => {
    const c = peek();
    if (c === '(') { i++; const a = expr(); if (s[i] !== ')') throw new Error('วงเล็บไม่ครบ'); i++; return a; }
    if (c === '|') { i++; const a = expr(); if (s[i] !== '|') throw new Error('ค่าสัมบูรณ์ไม่ครบ'); i++; return x => Math.abs(a(x)); }
    if (/[0-9.]/.test(c)) { let j = i; while (/[0-9.]/.test(s[j])) j++; const v = parseFloat(s.slice(i, j)); i = j; return () => v; }
    if (/[a-z]/i.test(c)) {
      for (const name of Object.keys(F).sort((a, b) => b.length - a.length)) if (s.startsWith(name, i)) { i += name.length; const f = F[name]; const a = peek() === '(' ? atom() : power(); return x => f(a(x)); }
      if (s.startsWith('pi', i)) { i += 2; return () => Math.PI; }
      if (s[i] === 'e' && !/[a-z]/i.test(s[i + 1] || '')) { i++; return () => Math.E; }
      if (s[i] === 'x') { i++; return x => x; }
    }
    throw new Error(`อ่าน "${src}" ไม่ออก ตรงตำแหน่ง ${i + 1}`);
  };
  const f = expr(); if (i < s.length) throw new Error(`อ่าน "${src}" ไม่ออก ตรงตำแหน่ง ${i + 1}`);
  return f;
}

// ---------- graph picture ----------
const nice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
const fmt = (v) => { const r = Math.round(v * 1000) / 1000; return (r < 0 ? '−' : '') + Math.abs(r); };
export async function graphCanvas(g, scale = 3) {
  try { await document.fonts.load('20px "TH Sarabun New"'); } catch { }
  const line = g.type === 'line';
  const Wp = g.w || 340, Hp = line ? 70 : (g.h || 300), S = scale;
  const c = document.createElement('canvas'); c.width = Wp * S; c.height = Hp * S;
  const x = c.getContext('2d'); x.scale(S, S);
  const pad = 14, x0 = g.xmin, x1 = g.xmax, y0 = line ? -1 : g.ymin, y1 = line ? 1 : g.ymax;
  const X = v => pad + (v - x0) / (x1 - x0) * (Wp - pad * 2), Y = v => line ? Hp / 2 - 6 : Hp - pad - (v - y0) / (y1 - y0) * (Hp - pad * 2);
  const ink = g.ink || '#1E2A55';
  const sx = g.step || nice((x1 - x0) / 10), sy = g.stepY || nice((y1 - y0) / 10);
  x.font = '13px "TH Sarabun New", sans-serif'; x.lineCap = 'round';
  if (!line && g.grid) {
    x.strokeStyle = 'rgba(30,42,85,.13)'; x.lineWidth = .6; x.beginPath();
    for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + 1e-9; v += sx) { x.moveTo(X(v), Y(y0)); x.lineTo(X(v), Y(y1)); }
    for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + 1e-9; v += sy) { x.moveTo(X(x0), Y(v)); x.lineTo(X(x1), Y(v)); }
    x.stroke();
  }
  // axes with arrows
  const ax = (xa, ya, xb, yb) => { x.beginPath(); x.moveTo(xa, ya); x.lineTo(xb, yb); x.stroke(); const a = Math.atan2(yb - ya, xb - xa); x.beginPath(); x.moveTo(xb, yb); x.lineTo(xb - 7 * Math.cos(a - .45), yb - 7 * Math.sin(a - .45)); x.moveTo(xb, yb); x.lineTo(xb - 7 * Math.cos(a + .45), yb - 7 * Math.sin(a + .45)); x.stroke(); };
  x.strokeStyle = ink; x.fillStyle = ink; x.lineWidth = 1.2;
  const yAxisX = X(Math.min(Math.max(0, x0), x1)), xAxisY = Y(Math.min(Math.max(0, y0), y1));
  ax(X(x0) - 4, xAxisY, X(x1) + 8, xAxisY);
  if (!line) ax(yAxisX, Y(y0) + 4, yAxisX, Y(y1) - 8);
  // ticks + numbers
  x.lineWidth = 1; x.textAlign = 'center'; x.textBaseline = 'top';
  for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + 1e-9; v += sx) { const px = X(v); x.beginPath(); x.moveTo(px, xAxisY - 3); x.lineTo(px, xAxisY + 3); x.stroke(); if (Math.abs(v) > 1e-9 || line) x.fillText(fmt(v), px, xAxisY + 4); }
  if (!line) { x.textAlign = 'right'; x.textBaseline = 'middle'; for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + 1e-9; v += sy) { if (Math.abs(v) < 1e-9) continue; const py = Y(v); x.beginPath(); x.moveTo(yAxisX - 3, py); x.lineTo(yAxisX + 3, py); x.stroke(); x.fillText(fmt(v), yAxisX - 5, py); } }
  x.font = 'italic 15px "TH Sarabun New", serif'; x.textAlign = 'left'; x.textBaseline = 'bottom';
  x.fillText('x', X(x1) + 2, xAxisY - 3); if (!line) { x.textBaseline = 'top'; x.fillText('y', yAxisX + 5, Y(y1) - 8); x.textAlign = 'right'; x.textBaseline = 'top'; x.font = '13px "TH Sarabun New", sans-serif'; x.fillText('0', yAxisX - 4, xAxisY + 3); }
  // functions
  if (!line) {
    x.save(); x.beginPath(); x.rect(X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1)); x.clip();
    (g.fns || []).forEach((src, n) => {
      if (!src.trim()) return; let f; try { f = compile(src); } catch { return; }
      x.strokeStyle = COLORS[(n + 1) % COLORS.length]; x.lineWidth = 1.8; x.beginPath();
      const N = 900; let pen = false, py = null;
      for (let k = 0; k <= N; k++) { const xv = x0 + (x1 - x0) * k / N, yv = f(xv); if (!isFinite(yv)) { pen = false; continue; } const qy = Y(yv); if (pen && Math.abs(qy - py) > Hp * 1.5) pen = false; if (pen) x.lineTo(X(xv), qy); else x.moveTo(X(xv), qy); pen = true; py = qy; }
      x.stroke();
    });
    x.restore();
  }
  // marked points  "2, -1.5, 3o" (o = open circle)
  for (const tok of String(g.pts || '').split(/[,\s]+/).filter(Boolean)) {
    const open = /o$/i.test(tok), v = parseFloat(tok); if (!isFinite(v)) continue;
    const px = X(v), py = line ? xAxisY : xAxisY; x.beginPath(); x.arc(px, py, 4, 0, Math.PI * 2);
    if (open) { x.fillStyle = '#fff'; x.fill(); x.strokeStyle = '#D64545'; x.lineWidth = 1.6; x.stroke(); } else { x.fillStyle = '#D64545'; x.fill(); }
  }
  return c;
}
export async function graphDialog(old) {
  const g = old || { type: 'xy', xmin: -5, xmax: 5, ymin: -5, ymax: 5, grid: true, fns: ['x^2-3', '', ''], pts: '' };
  let type = g.type;
  const num = (v) => h('input', { class: 'field', type: 'text', inputmode: 'decimal', value: String(v) });
  const fx0 = num(g.xmin), fx1 = num(g.xmax), fy0 = num(g.ymin), fy1 = num(g.ymax), fst = num(g.step || '');
  const fns = [0, 1, 2].map(i => h('input', { class: 'field', type: 'text', placeholder: i ? 'ฟังก์ชันที่ ' + (i + 1) + ' (ไม่ใส่ก็ได้)' : 'เช่น x^2-3, 2sin(x), sqrt(x), |x|', value: (g.fns || [])[i] || '', spellcheck: 'false', autocapitalize: 'off' }));
  const pts = h('input', { class: 'field', type: 'text', placeholder: 'จุดบนแกน x เช่น -2, 1.5, 3o (o = จุดโปร่ง)', value: g.pts || '' });
  let grid = g.grid !== false;
  const prev = h('div', { class: 'gr-prev' }), err = h('div', { class: 'eq-err' });
  const read = () => ({ type, xmin: +fx0.value, xmax: +fx1.value, ymin: +fy0.value, ymax: +fy1.value, step: +fst.value || 0, grid, fns: fns.map(f => f.value), pts: pts.value, w: 340, h: 300 });
  const draw = async () => {
    const q = read(); err.textContent = '';
    if (!(q.xmax > q.xmin) || (type === 'xy' && !(q.ymax > q.ymin))) { err.textContent = 'ค่าต่ำสุดต้องน้อยกว่าค่าสูงสุด'; return; }
    for (const f of q.fns) if (f.trim()) try { compile(f); } catch (e) { err.textContent = e.message; }
    const c = await graphCanvas(q, 1.5); c.style.width = '100%'; c.style.maxWidth = (type === 'line' ? 520 : 380) + 'px'; prev.innerHTML = ''; prev.append(c);
  };
  let t; const later = () => { clearTimeout(t); t = setTimeout(draw, 200); };
  for (const el of [fx0, fx1, fy0, fy1, fst, pts, ...fns]) el.oninput = later;
  const yRow = h('div', { class: 'gr-row' }, h('span', {}, 'แกน y จาก'), fy0, h('span', {}, 'ถึง'), fy1);
  const fnBox = h('div', { class: 'gr-fns' }, h('div', { class: 'lbl' }, 'กราฟของ y ='), ...fns);
  const gridT = seg([['on', 'มีตาราง'], ['off', 'ไม่มีตาราง']], grid ? 'on' : 'off', v => { grid = v === 'on'; later(); });
  const sync = () => { const xy = type === 'xy'; yRow.style.display = fnBox.style.display = gridT.style.display = xy ? '' : 'none'; later(); };
  const body = h('div', { class: 'gr-dlg' },
    seg([['xy', 'ระบบพิกัด / กราฟ'], ['line', 'เส้นจำนวน']], type, v => { type = v; sync(); }),
    h('div', { class: 'gr-row' }, h('span', {}, 'แกน x จาก'), fx0, h('span', {}, 'ถึง'), fx1, h('span', {}, 'ช่วงละ'), fst),
    yRow, fnBox, pts, gridT, prev, err);
  sync();
  return new Promise((res) => {
    let ok = false;
    dialog(old ? 'แก้ไขกราฟ' : 'แทรกกราฟ / เส้นจำนวน', body, [
      { label: 'ยกเลิก', action: () => { } },
      { label: old ? 'บันทึก' : 'แทรก', cls: 'prim', flex: 2, action: async () => {
        const q = read(); if (!(q.xmax > q.xmin) || (type === 'xy' && !(q.ymax > q.ymin))) { toast('ค่าต่ำสุดต้องน้อยกว่าค่าสูงสุด', 2000, 'warn'); res(null); return; }
        ok = true; const c = await graphCanvas(q, 4);
        res({ file: await toFile(c, 'graph.png'), meta: { kind: 'graph', ...q }, w: c.width / 4, h: c.height / 4 });
      } },
    ], { width: 640, onClose: () => { if (!ok) res(null); } });
  });
}
// LaTeX → image file sized in page units (same scale as the equation dialog), no dialog
export async function texImage(tex, color = '#1E2A55', size = 22) {
  const MJ = await loadMathJax();
  const { svg, wEx, hEx } = texSvg(MJ, tex, color);
  const c = await svgToCanvas(svg, wEx, hEx, 40), k = size * 0.45;
  return { file: await toFile(c, 'equation.png'), meta: { kind: 'tex', tex, color, size }, w: (wEx * 40 + 8) / 40 * k, h: (hEx * 40 + 8) / 40 * k };
}
export async function texSvgEl(tex, color = '#1E2A55') { const MJ = await loadMathJax(); const { svg } = texSvg(MJ, tex, color); return svg; }
