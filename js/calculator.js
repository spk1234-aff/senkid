// Scientific calculator in the style of the iPad Calculator: floating, draggable, shows the whole expression.
import { h, icon, toast } from './ui.js';
import { prefs, savePrefs } from './prefs.js';

// ---------- evaluator (no eval) ----------
const FN = {
  sin: (x, d) => Math.sin(d ? x * Math.PI / 180 : x), cos: (x, d) => Math.cos(d ? x * Math.PI / 180 : x), tan: (x, d) => Math.tan(d ? x * Math.PI / 180 : x),
  'sin⁻¹': (x, d) => Math.asin(x) * (d ? 180 / Math.PI : 1), 'cos⁻¹': (x, d) => Math.acos(x) * (d ? 180 / Math.PI : 1), 'tan⁻¹': (x, d) => Math.atan(x) * (d ? 180 / Math.PI : 1),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, 'sinh⁻¹': Math.asinh, 'cosh⁻¹': Math.acosh, 'tanh⁻¹': Math.atanh,
  ln: Math.log, log: Math.log10, 'log₂': Math.log2, '√': Math.sqrt, '∛': Math.cbrt,
};
const FNAMES = Object.keys(FN).sort((a, b) => b.length - a.length);
function fact(n) { if (n < 0) return NaN; if (Number.isInteger(n)) { if (n > 170) return Infinity; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; } // gamma (Lanczos)
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const gam = (z) => { if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gam(1 - z)); z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i); const t = z + g + 0.5; return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x; };
  return gam(n + 1); }
export function evaluate(src, deg) {
  let s = src, i = 0;
  const opens = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length; if (opens > 0) s += ')'.repeat(opens); // auto-close
  const peek = () => s[i];
  const expr = () => { let a = term(); while (peek() === '+' || peek() === '−' || peek() === '-') { const op = s[i++], b = term(); a = op === '+' ? a + b : a - b; } return a; };
  const startsFactor = () => { const c = peek(); return c !== undefined && /[0-9.(πe√∛a-zA-Z]/.test(c) && !s.startsWith('ʸ√', i); };
  const term = () => { let a = unary(); for (;;) { const c = peek(); if (c === '×' || c === '÷' || c === '*' || c === '/') { i++; const b = unary(); a = (c === '×' || c === '*') ? a * b : a / b; } else if (startsFactor()) a *= unary(); else break; } return a; };
  const unary = () => { if (peek() === '−' || peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return power(); };
  const power = () => { let a = postfix(); if (peek() === '^') { i++; return Math.pow(a, unary()); } if (s.startsWith('ʸ√', i)) { i += 2; const n = unary(); return n === 3 ? Math.cbrt(a) : (a < 0 && n % 2 === 1 ? -Math.pow(-a, 1 / n) : Math.pow(a, 1 / n)); } return a; };
  const postfix = () => { let a = atom(); for (;;) { if (peek() === '!') { i++; a = fact(a); } else if (peek() === '%') { i++; a /= 100; } else if (peek() === '²') { i++; a = a * a; } else if (peek() === '³') { i++; a = a * a * a; } else break; } return a; };
  const atom = () => {
    const c = peek();
    if (c === undefined) throw new Error('incomplete');
    if (c === '(') { i++; const a = expr(); if (s[i] === ')') i++; return a; }
    if (/[0-9.]/.test(c)) { const m = /^[0-9]*\.?[0-9]*(E[−-]?[0-9]+)?/.exec(s.slice(i)); i += m[0].length; return parseFloat(m[0].replace('−', '-')); }
    if (c === 'π') { i++; return Math.PI; }
    if (c === 'e' && !s.startsWith('eˣ', i)) { i++; return Math.E; }
    for (const n of FNAMES) if (s.startsWith(n, i)) { i += n.length; const a = peek() === '(' ? atom() : power(); return FN[n](a, deg); }
    throw new Error('syntax');
  };
  const v = expr(); if (i < s.length) throw new Error('syntax');
  return v;
}
export function fmtNum(v) {
  if (!isFinite(v)) return isNaN(v) ? 'ผิดพลาด' : (v > 0 ? '∞' : '−∞');
  if (Math.abs(v) < 1e-12) v = 0;
  const a = Math.abs(v);
  let t = (a !== 0 && (a >= 1e12 || a < 1e-7)) ? v.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'E').replace('e', 'E') : String(parseFloat(v.toPrecision(12)));
  if (!t.includes('E')) { const [ip, fp] = t.split('.'); t = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fp ? '.' + fp : ''); }
  return t.replace(/^-/, '−');
}

// ---------- UI ----------
let panel = null;
export function toggleCalculator(ed) { if (panel) { panel.remove(); panel = null; window.__senkidCalc = null; return; } openCalculator(ed); }
export function openCalculator(ed) {
  if (panel) return;
  let expr = '', last = null, mem = 0, second = false, deg = prefs.calcDeg !== false, sci = prefs.calcSci !== false;
  const exprEl = h('div', { class: 'cx-expr' }), resEl = h('div', { class: 'cx-res' }, '0'), prevEl = h('div', { class: 'cx-prev' });
  const keys = h('div', { class: 'cx-keys' });
  const head = h('div', { class: 'cx-head' }, h('i', { class: 'cx-grip' }), h('span', { class: 'cx-title' }, 'เครื่องคิดเลข'));
  const modeBtn = h('button', { class: 'cx-hb' }, ''), sciBtn = h('button', { class: 'cx-hb' }, ''), putBtn = h('button', { class: 'cx-hb', title: 'วางผลลัพธ์ลงหน้า' }, icon('text'), h('span', { class: 'cx-putl' }, 'วางลงหน้า')), x = h('button', { class: 'cx-hb x', title: 'ปิด' }, icon('close'));
  head.append(h('span', { style: { flex: 1 } }), putBtn, sciBtn, x);
  panel = h('div', { class: 'calc' + (sci ? ' sci' : '') }, head, h('div', { class: 'cx-disp' }, exprEl, resEl, prevEl), keys);
  const refresh = () => {
    exprEl.textContent = expr || (last != null ? '' : ' ');
    if (!expr) { resEl.textContent = last != null ? fmtNum(last) : '0'; prevEl.textContent = ''; }
    else { resEl.textContent = expr; try { const v = evaluate(expr, deg); prevEl.textContent = '= ' + fmtNum(v); } catch { prevEl.textContent = ''; } }
    exprEl.textContent = expr ? '' : (panel.dataset.lastExpr || '');
    modeBtn.textContent = deg ? 'Deg' : 'Rad'; sciBtn.textContent = sci ? 'แบบย่อ' : 'วิทยาศาสตร์';
    for (const b of keys.querySelectorAll('[data-k2]')) b.textContent = second ? b.dataset.k2 : b.dataset.k1;
    keys.querySelector('.k2nd')?.classList.toggle('on', second);
    const ac = keys.querySelector('.kac'); if (ac) ac.textContent = expr ? '⌫' : 'AC';
    resEl.style.fontSize = resEl.textContent.length > 18 ? '26px' : resEl.textContent.length > 11 ? '36px' : '52px';
  };
  const ins = (t) => { if (!expr && last != null && /^[+−×÷^²³!%]|^ʸ√/.test(t)) expr = fmtNum(last).replace(/,/g, ''); expr += t; };
  const equals = () => { if (!expr) return; try { const v = evaluate(expr, deg); panel.dataset.lastExpr = expr + ' ='; last = v; expr = ''; } catch { prevEl.textContent = 'สมการยังไม่ครบ'; return; } };
  const cur = () => { if (expr) { try { return evaluate(expr, deg); } catch { return null; } } return last; };
  const lastNumRange = () => { const m = /(−?)([0-9.]+(E[−-]?[0-9]+)?)$/.exec(expr); return m; };
  const act = (k) => {
    switch (k) {
      case 'AC': if (expr) expr = expr.slice(0, -1); else { last = null; panel.dataset.lastExpr = ''; } break;
      case '±': { const m = lastNumRange(); if (m) expr = expr.slice(0, m.index) + (m[1] ? '' : '−') + m[2]; else if (!expr && last != null) last = -last; else expr += '−'; break; }
      case '=': equals(); break;
      case 'mc': mem = 0; break; case 'm+': { const v = cur(); if (v != null) mem += v; break; } case 'm−': { const v = cur(); if (v != null) mem -= v; break; } case 'mr': ins(fmtNum(mem).replace(/,/g, '').replace('−', '−')); break;
      case '2nd': second = !second; break;
      case 'Deg': deg = !deg; prefs.calcDeg = deg; savePrefs(); break;
      case 'Rand': ins(String(Math.round(Math.random() * 1e8) / 1e8)); break;
      case 'x²': ins('²'); break; case 'x³': ins('³'); break; case 'xʸ': ins('^'); break; case 'x!': ins('!'); break; case '%': ins('%'); break;
      case 'eˣ': ins('e^'); break; case '10ˣ': ins('10^'); break; case '2ˣ': ins('2^'); break; case 'yˣ': ins('^'); break;
      case '1/x': if (!expr && last != null) expr = '1÷' + fmtNum(last).replace(/,/g, ''); else expr = '1÷(' + expr + ')'; break;
      case '²√x': ins('√('); break; case '³√x': ins('∛('); break; case 'ʸ√x': ins('ʸ√'); break;
      case 'ln': ins('ln('); break; case 'log₁₀': ins('log('); break; case 'log₂': ins('log₂('); break;
      case 'EE': ins('E'); break;
      default:
        if (['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'sin⁻¹', 'cos⁻¹', 'tan⁻¹', 'sinh⁻¹', 'cosh⁻¹', 'tanh⁻¹'].includes(k)) { ins(k + '('); break; }
        if (!expr && last != null && /^[0-9.(πe√]/.test(k)) { last = null; panel.dataset.lastExpr = ''; }
        ins(k);
    }
    refresh();
  };
  // layout like the iPad: 6 scientific columns + 4 basic columns
  const SCI = [
    [['(', 'f'], [')', 'f'], ['mc', 'f'], ['m+', 'f'], ['m−', 'f'], ['mr', 'f']],
    [['2nd', 'f k2nd'], ['x²', 'f'], ['x³', 'f'], ['xʸ', 'f'], ['eˣ', 'f', 'yˣ'], ['10ˣ', 'f', '2ˣ']],
    [['1/x', 'f'], ['²√x', 'f'], ['³√x', 'f'], ['ʸ√x', 'f'], ['ln', 'f', 'log₂'], ['log₁₀', 'f', 'log₂']],
    [['x!', 'f'], ['sin', 'f', 'sin⁻¹'], ['cos', 'f', 'cos⁻¹'], ['tan', 'f', 'tan⁻¹'], ['e', 'f'], ['EE', 'f']],
    [['Deg', 'f kmode'], ['sinh', 'f', 'sinh⁻¹'], ['cosh', 'f', 'cosh⁻¹'], ['tanh', 'f', 'tanh⁻¹'], ['π', 'f'], ['Rand', 'f']],
  ];
  const BASIC = [
    [['AC', 'g kac'], ['±', 'g'], ['%', 'g'], ['÷', 'o']],
    [['7'], ['8'], ['9'], ['×', 'o']],
    [['4'], ['5'], ['6'], ['−', 'o']],
    [['1'], ['2'], ['3'], ['+', 'o']],
    [['0', 'zero'], ['.'], ['=', 'o']],
  ];
  const build = () => {
    keys.innerHTML = ''; panel.classList.toggle('sci', sci);
    for (let r = 0; r < 5; r++) {
      const row = sci ? [...SCI[r], ...BASIC[r]] : BASIC[r];
      for (const [k, cls = 'n', k2] of row) {
        const b = h('button', { class: 'cx-k ' + cls }, k);
        if (k2) { b.dataset.k1 = k; b.dataset.k2 = k2; }
        if (k === 'Deg') { b.textContent = deg ? 'Deg' : 'Rad'; }
        b.onclick = (e) => { e.stopPropagation(); const key = b.dataset.k2 && second ? b.dataset.k2 : (k === 'Deg' ? 'Deg' : k); act(key); if (k === 'Deg') b.textContent = deg ? 'Deg' : 'Rad'; if (second && key !== '2nd' && b.dataset.k2) { second = false; refresh(); } };
        keys.append(b);
      }
    }
    refresh();
  };
  sciBtn.onclick = () => { sci = !sci; prefs.calcSci = sci; savePrefs(); build(); place(); };
  x.onclick = () => { panel.remove(); panel = null; window.__senkidCalc = null; document.removeEventListener('keydown', onKey, true); };
  putBtn.onclick = () => {
    const v = expr ? (() => { try { return evaluate(expr, deg); } catch { return null; } })() : last;
    const e0 = expr || (panel.dataset.lastExpr || '').replace(/ =$/, '');
    if (v == null) { toast('ยังไม่มีผลลัพธ์', 1200); return; }
    ed.insertTextLine(e0 ? `${e0} = ${fmtNum(v)}` : fmtNum(v));
  };
  // keyboard (computers)
  const onKey = (e) => {
    if (!panel || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    const m = { '*': '×', '/': '÷', '-': '−', 'Enter': '=', '=': '=', 'Backspace': 'AC', 'Escape': 'AC' }[e.key] || (/^[0-9.+()%^!]$/.test(e.key) ? e.key : null);
    if (!m) return; e.preventDefault(); e.stopPropagation(); act(m === '^' ? 'xʸ' : m);
  };
  document.addEventListener('keydown', onKey, true);
  // drag by the header
  const place = () => { const P = prefs.calcXY; const W = innerWidth, H = innerHeight, bw = panel.offsetWidth, bh = panel.offsetHeight; const x0 = P ? P.x * W : W - bw - 20, y0 = P ? P.y * H : 90; panel.style.left = Math.max(6, Math.min(W - bw - 6, x0)) + 'px'; panel.style.top = Math.max(6, Math.min(H - bh - 6, y0)) + 'px'; };
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; e.preventDefault();
    const r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top; head.setPointerCapture(e.pointerId);
    const mv = (ev) => { prefs.calcXY = { x: (ev.clientX - dx) / innerWidth, y: (ev.clientY - dy) / innerHeight }; place(); };
    const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); savePrefs(); };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
  });
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  // what the student screen shows (display only)
  window.__senkidCalc = () => panel && { top: exprEl.textContent, res: resEl.textContent, prev: prevEl.textContent };
  document.body.append(panel); build(); place();
}
