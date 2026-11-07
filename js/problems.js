// สุ่มโจทย์ฝึก: random practice problems with clean answers, typeset in LaTeX and placed on the page.
// Answers can go on the next page or at the bottom of this page (each answer under its own tap-to-reveal cover).
import { h, icon, toast, dialog, busy, seg, uid } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import { dims, measureText, strokeBB } from './render.js';
import { normalizeImage } from './images.js';

const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const NZ = (a, b) => { let v = 0; while (!v) v = R(a, b); return v; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const frac = (n, d) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); n /= g; d /= g; return d === 1 ? String(n) : `${n < 0 ? '-' : ''}\\frac{${Math.abs(n)}}{${d}}`; };
// polynomial with integer coefficients, highest power first: [[coef, pow], ...]
function poly(terms, v = 'x') {
  let out = '';
  for (const [c, p] of terms) {
    if (!c) continue;
    const abs = Math.abs(c), sign = c < 0 ? '-' : (out ? '+' : '');
    const coef = p === 0 ? String(abs) : abs === 1 ? '' : String(abs);
    const x = p === 0 ? '' : p === 1 ? v : `${v}^{${p}}`;
    out += `${out ? ' ' : ''}${sign}${out && sign ? ' ' : ''}${coef}${x}`;
  }
  return out || '0';
}
const lin = (a, b, v = 'x') => poly([[a, 1], [b, 0]], v);
const fac = (p) => p === 0 ? 'x' : p > 0 ? `(x+${p})` : `(x-${-p})`;

export const TOPICS = [
  ['frac', 'บวกลบเศษส่วน', 'จงหาผลลัพธ์ในรูปอย่างต่ำ', (lv) => {
    const b = R(2, lv > 1 ? 12 : 9), d = R(2, lv > 1 ? 12 : 9), a = NZ(1, b * 2), c = NZ(1, d * 2), op = pick(['+', '-']);
    if (gcd(a, b) > 1 || gcd(c, d) > 1 || b === d && lv > 1) return null;
    const n = op === '+' ? a * d + c * b : a * d - c * b;
    return { q: `\\frac{${a}}{${b}} ${op} \\frac{${c}}{${d}}`, a: frac(n, b * d) };
  }],
  ['lineq', 'สมการเชิงเส้นตัวแปรเดียว', 'จงแก้สมการ', (lv) => {
    const x = R(-9, 9), a = NZ(-6, 9), c = lv > 1 ? NZ(-5, 5) : 0; if (a === c) return null;
    const b = R(-15, 15), d = (a - c) * x + b;
    return { q: `${lin(a, b)} = ${c ? lin(c, d) : d}`, a: `x = ${x}` };
  }],
  ['factor', 'แยกตัวประกอบพหุนามดีกรีสอง', 'จงแยกตัวประกอบ', (lv) => {
    const p = NZ(-9, 9), q = NZ(-9, 9), k = lv > 1 ? pick([1, 2, 3]) : 1;
    if (k === 1) return { q: poly([[1, 2], [p + q, 1], [p * q, 0]]), a: p === q ? `${fac(p)}^2` : `${fac(p)}${fac(q)}` };
    // (kx + p)(x + q) with k > 1
    return { q: poly([[k, 2], [k * q + p, 1], [p * q, 0]]), a: `(${lin(k, p)})${fac(q)}` };
  }],
  ['quad', 'สมการกำลังสอง', 'จงหาคำตอบของสมการ', (lv) => {
    const r1 = R(-8, 8), r2 = R(-8, 8), k = lv > 1 ? pick([1, 2]) : 1; if (r1 === 0 && r2 === 0) return null;
    const sol = r1 === r2 ? `x = ${r1}` : `x = ${Math.min(r1, r2)},\\ ${Math.max(r1, r2)}`;
    return { q: `${poly([[k, 2], [-k * (r1 + r2), 1], [k * r1 * r2, 0]])} = 0`, a: sol };
  }],
  ['expo', 'เลขยกกำลัง', 'จงทำให้อยู่ในรูปอย่างง่าย', (lv) => {
    const a = pick(['a', 'x', '2', '3']), m = R(2, 9), n = R(-4, 7), k = R(1, 8), e = m + n - k, pw = (x) => x === 0 ? '1' : x === 1 ? a : `${a}^{${x}}`;
    if (lv > 1) { const p = R(2, 3); return { q: `\\left(\\frac{${a}^{${m}}\\cdot ${a}^{${n}}}{${a}^{${k}}}\\right)^{${p}}`, a: pw(e * p) }; }
    return { q: `\\frac{${a}^{${m}}\\cdot ${a}^{${n}}}{${a}^{${k}}}`, a: pw(e) };
  }],
  ['log', 'ลอการิทึม', 'จงหาค่า', (lv) => {
    const b = pick([2, 3, 5, 10]), maxN = { 2: 7, 3: 4, 5: 3, 10: 4 }[b], n = R(lv > 1 ? -2 : 1, maxN);
    const v = n >= 0 ? b ** n : `\\frac{1}{${b ** -n}}`;
    return { q: b === 10 ? `\\log ${v}` : `\\log_{${b}} ${v}`, a: String(n) };
  }],
  ['trig', 'ค่าตรีโกณมิติมุมมาตรฐาน', 'จงหาค่า', (lv) => {
    const T = { sin: { 0: '0', 30: '\\frac{1}{2}', 45: '\\frac{\\sqrt{2}}{2}', 60: '\\frac{\\sqrt{3}}{2}', 90: '1' }, cos: { 0: '1', 30: '\\frac{\\sqrt{3}}{2}', 45: '\\frac{\\sqrt{2}}{2}', 60: '\\frac{1}{2}', 90: '0' }, tan: { 0: '0', 30: '\\frac{\\sqrt{3}}{3}', 45: '1', 60: '\\sqrt{3}' } };
    if (lv > 1) { // quadrant reduction
      const f = pick(['sin', 'cos']), base = pick([30, 45, 60]), q = pick([180 - base, 180 + base, 360 - base]);
      const neg = f === 'sin' ? q > 180 : (q > 90 && q < 270);
      return { q: `\\${f} ${q}^\\circ`, a: (neg ? '-' : '') + T[f][base] };
    }
    const f = pick(['sin', 'cos', 'tan']), ang = pick(Object.keys(T[f]));
    return { q: `\\${f} ${ang}^\\circ`, a: T[f][ang] };
  }],
  ['deriv', 'อนุพันธ์ของพหุนาม', 'จงหา \\(f\'(x)\\)', (lv) => {
    const deg = lv > 1 ? 4 : 3, terms = []; for (let p = deg; p >= 0; p--) terms.push([p === deg ? NZ(-5, 6) : R(-8, 8), p]);
    return { q: `f(x) = ${poly(terms)}`, a: `f'(x) = ${poly(terms.filter(([, p]) => p > 0).map(([c, p]) => [c * p, p - 1]))}` };
  }],
  ['system', 'ระบบสมการสองตัวแปร', 'จงแก้ระบบสมการ', (lv) => {
    const x = R(-6, 6), y = R(-6, 6), a = NZ(-5, 5), b = NZ(-5, 5), c = NZ(-5, 5), d = NZ(-5, 5); if (a * d - b * c === 0) return null;
    const e = (u, v) => poly([[u, 1]], 'x') + (v < 0 ? ' - ' : ' + ') + (Math.abs(v) === 1 ? '' : Math.abs(v)) + 'y';
    return { q: `\\begin{cases} ${e(a, b)} = ${a * x + b * y} \\\\ ${e(c, d)} = ${c * x + d * y} \\end{cases}`, a: `x = ${x},\\ y = ${y}` };
  }],
];

// ---------- more topics (ม.1–3 and ม.4–6) ----------
const sgn = (v) => v < 0 ? `(${v})` : String(v);
const dec = (n, k) => { // integer n scaled by 10^-k, without float noise
  const neg = n < 0; let t = String(Math.abs(n)).padStart(k + 1, '0'); if (k) t = t.slice(0, -k) + '.' + t.slice(-k); t = t.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''); return (neg ? '-' : '') + t;
};
const fracPlain = (n, d) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); n /= g; d /= g; return [n, d]; };
const sq = (k, m) => k === 1 ? `\\sqrt{${m}}` : `${k}\\sqrt{${m}}`;
const SQFREE = [2, 3, 5, 6, 7, 10, 11];
const cplx = (a, b) => { if (!b) return String(a); const bi = Math.abs(b) === 1 ? 'i' : `${Math.abs(b)}i`; return a ? `${a} ${b < 0 ? '-' : '+'} ${bi}` : `${b < 0 ? '-' : ''}${bi}`; };
const nPr = (n, r) => { let v = 1; for (let i = 0; i < r; i++) v *= n - i; return v; };
const nCr = (n, r) => { r = Math.min(r, n - r); let v = 1; for (let i = 1; i <= r; i++) v = v * (n - r + i) / i; return Math.round(v); };
const mat = (M) => `\\begin{bmatrix} ${M[0]} & ${M[1]} \\\\ ${M[2]} & ${M[3]} \\end{bmatrix}`;

export const MORE_TOPICS = [
  ['int', 'จำนวนเต็ม', 'จงหาค่า', (lv) => {
    if (lv > 1) { const a = NZ(-12, 12), b = NZ(-6, 6), c = NZ(-6, 6), d = NZ(-5, 5), q = NZ(-6, 6), e = d * q; const op = pick(['+', '-']);
      const v = op === '+' ? a + b * c + e / d : a - b * c + e / d;
      return { q: `${sgn(a)} ${op} ${sgn(b)} \\times ${sgn(c)} + ${sgn(e)} \\div ${sgn(d)}`, a: String(v) }; }
    const a = NZ(-20, 20), b = NZ(-20, 20), c = NZ(-20, 20), o1 = pick(['+', '-']), o2 = pick(['+', '-']);
    const v = (o1 === '+' ? a + b : a - b) + (o2 === '+' ? c : -c);
    return { q: `${sgn(a)} ${o1} ${sgn(b)} ${o2} ${sgn(c)}`, a: String(v) };
  }],
  ['fracmul', 'คูณหารเศษส่วนและทศนิยม', 'จงหาผลลัพธ์', (lv) => {
    if (lv > 1 && Math.random() < .5) { // decimals
      const a = NZ(-99, 99), ka = R(1, 2), b = NZ(2, 99), kb = R(1, 2);
      if (Math.random() < .5) return { q: `${dec(a, ka)} \\times ${dec(b, kb)}`, a: dec(a * b, ka + kb) };
      const c = NZ(2, 12), k = R(1, 2); return { q: `${dec(a * c, ka + k)} \\div ${dec(c, k)}`, a: dec(a, ka) };
    }
    const a = NZ(-9, 9), b = R(2, 9), c = NZ(1, 9), d = R(2, 9), op = pick(['\\times', '\\div']); if (gcd(a, b) > 1 || gcd(c, d) > 1) return null;
    const [n, m] = op === '\\times' ? [a * c, b * d] : [a * d, b * c];
    return { q: `${a < 0 ? '-' : ''}\\frac{${Math.abs(a)}}{${b}} ${op} \\frac{${c}}{${d}}`, a: frac(n, m) };
  }],
  ['sci', 'สัญกรณ์วิทยาศาสตร์', 'จงเขียนในรูปสัญกรณ์วิทยาศาสตร์', (lv) => {
    const m = R(11, 99), n = R(lv > 1 ? -6 : 3, 8);
    if (lv > 1) { const a = R(2, 9), b = R(2, 9), p = R(-5, 6), q = R(-5, 6); let c = a * b, e = p + q; const A = c >= 10 ? dec(c, 1) : String(c); if (c >= 10) e += 1;
      return { q: `(${a} \\times 10^{${p}})(${b} \\times 10^{${q}})`, a: `${A} \\times 10^{${e}}` }; }
    const big = Math.random() < .5, digits = String(m), A = digits[0] + '.' + digits[1];
    if (big) { const num = String(m) + '0'.repeat(n - 1); return { q: num.replace(/\B(?=(\d{3})+(?!\d))/g, '{,}'), a: `${A} \\times 10^{${n}}` }; }
    const k = R(2, 6); return { q: '0.' + '0'.repeat(k - 1) + digits, a: `${A} \\times 10^{-${k}}` };
  }],
  ['pct', 'อัตราส่วนและร้อยละ', 'จงหาค่า', (lv) => {
    const t = pick(lv > 1 ? ['ratio', 'whole', 'part'] : ['part', 'ratio']);
    if (t === 'part') { const p = pick([5, 10, 12, 15, 20, 25, 30, 40, 45, 60, 75]), N = R(2, 40) * 20; return { q: `${p}\\% \\times ${N}`, a: dec(p * N, 2) }; }
    if (t === 'whole') { const p = pick([10, 20, 25, 40, 50, 75]), N = R(2, 30) * 20, part = p * N / 100; return { q: `${p}\\% \\times x = ${part}`, a: `x = ${N}` }; }
    const a = R(2, 9), b = R(2, 9), k = R(2, 6); if (a === b || gcd(a, b) > 1) return null;
    return Math.random() < .5 ? { q: `${a} : ${b} = ${a * k} : x`, a: `x = ${b * k}` } : { q: `${a} : ${b} = x : ${b * k}`, a: `x = ${a * k}` };
  }],
  ['polyop', 'บวก ลบ คูณพหุนาม', 'จงทำให้อยู่ในรูปอย่างง่าย', (lv) => {
    if (lv > 1) { const a = NZ(-4, 4), b = NZ(-6, 6), c = NZ(-3, 3), d = R(-5, 5), e = NZ(-6, 6);
      return { q: `(${lin(a, b)})(${poly([[c, 2], [d, 1], [e, 0]])})`, a: poly([[a * c, 3], [a * d + b * c, 2], [a * e + b * d, 1], [b * e, 0]]) }; }
    if (Math.random() < .4) { const a = NZ(-5, 5), b = NZ(-9, 9), c = NZ(-5, 5), d = NZ(-9, 9); return { q: `(${lin(a, b)})(${lin(c, d)})`, a: poly([[a * c, 2], [a * d + b * c, 1], [b * d, 0]]) }; }
    const A = [NZ(-6, 6), R(-9, 9), R(-9, 9)], B = [NZ(-6, 6), R(-9, 9), R(-9, 9)], op = pick(['+', '-']), s = op === '+' ? 1 : -1;
    const res = A.map((v, i) => v + s * B[i]); if (res.every(v => !v)) return null;
    return { q: `(${poly([[A[0], 2], [A[1], 1], [A[2], 0]])}) ${op} (${poly([[B[0], 2], [B[1], 1], [B[2], 0]])})`, a: poly([[res[0], 2], [res[1], 1], [res[2], 0]]) };
  }],
  ['expand', 'กำลังสองสมบูรณ์และผลต่างกำลังสอง', 'จงกระจาย', (lv) => {
    const a = lv > 1 ? NZ(-5, 5) : 1, b = NZ(-9, 9), t = pick(['sq', 'sq', 'diff']);
    if (t === 'sq') return { q: `(${lin(a, b)})^2`, a: poly([[a * a, 2], [2 * a * b, 1], [b * b, 0]]) };
    return { q: `(${lin(a, b)})(${lin(a, -b)})`, a: poly([[a * a, 2], [-b * b, 0]]) };
  }],
  ['sqrt', 'รากที่สองและกรณฑ์', 'จงทำให้อยู่ในรูปอย่างง่าย', (lv) => {
    const m = pick(SQFREE);
    if (lv > 1) { const a = NZ(-6, 6), k = R(2, 5), b = NZ(-4, 4), j = R(2, 4); const c = a * k + b * j; if (!c) return null;
      const co = (v) => v === 1 ? '' : v === -1 ? '-' : String(v);
      return { q: `${co(a)}\\sqrt{${k * k * m}} ${b < 0 ? '-' : '+'} ${co(Math.abs(b))}\\sqrt{${j * j * m}}`, a: `${co(c)}\\sqrt{${m}}` }; }
    const k = R(2, 9); return { q: `\\sqrt{${k * k * m}}`, a: sq(k, m) };
  }],
  ['pyth', 'ทฤษฎีบทพีทาโกรัส', 'c คือด้านตรงข้ามมุมฉาก จงหาด้านที่หายไป', (lv) => {
    const [x, y, z] = pick([[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29], [9, 40, 41]]), k = pick(lv > 1 ? [1, 2, 3] : [1, 2, 3, 4]);
    const a = x * k, b = y * k, c = z * k;
    if (lv > 1 || Math.random() < .3) return Math.random() < .5 ? { q: `a = ${a},\\ c = ${c},\\ b = ?`, a: `b = ${b}` } : { q: `b = ${b},\\ c = ${c},\\ a = ?`, a: `a = ${a}` };
    return { q: `a = ${a},\\ b = ${b},\\ c = ?`, a: `c = ${c}` };
  }],
  ['ineq', 'อสมการเชิงเส้นตัวแปรเดียว', 'จงแก้อสมการ', (lv) => {
    const k = R(-9, 9), a = NZ(-6, 6), c = lv > 1 ? NZ(-4, 4) : 0; if (a === c) return null;
    const b = R(-12, 12), d = (a - c) * k + b, rel = pick(['<', '>', '\\le', '\\ge']);
    const flip = { '<': '>', '>': '<', '\\le': '\\ge', '\\ge': '\\le' }, r = a - c < 0 ? flip[rel] : rel;
    return { q: `${lin(a, b)} ${rel} ${c ? lin(c, d) : d}`, a: `x ${r} ${k}` };
  }],
  ['slope', 'ความชันและสมการเส้นตรง', 'จากจุดสองจุด จงหาความชัน (m) หรือสมการเส้นตรง', (lv) => {
    const x1 = R(-6, 6), y1 = R(-6, 6), x2 = R(-6, 6), y2 = R(-6, 6); if (x1 === x2) return null;
    const [n, d] = fracPlain(y2 - y1, x2 - x1), m = frac(n, d), P = `(${x1}, ${y1}),\\ (${x2}, ${y2})`;
    if (lv < 2) return { q: `${P}\\ \\ m = ?`, a: `m = ${m}` };
    // y = mx + c with c = y1 - m x1 = (y1 d - n x1) / d
    const [cn, cd] = fracPlain(y1 * d - n * x1, d), mx = n === 0 ? '' : (d === 1 ? (n === 1 ? 'x' : n === -1 ? '-x' : `${n}x`) : `${m}x`), cc = cn === 0 ? '' : frac(cn, cd);
    const rhs = !mx ? (cc || '0') : !cc ? mx : `${mx} ${cn < 0 ? '-' : '+'} ${frac(Math.abs(cn), cd)}`;
    return { q: `${P}\\ \\ y = ?`, a: `y = ${rhs}` };
  }],
  ['func', 'ฟังก์ชัน: ค่าฟังก์ชันและฟังก์ชันประกอบ', 'จงหาค่า', (lv) => {
    if (lv > 1) { const a = NZ(-4, 4), b = R(-6, 6), c = NZ(-3, 3), d = R(-5, 5), sqg = Math.random() < .5;
      if (sqg) return { q: `f(x) = ${lin(a, b)},\\ g(x) = ${poly([[1, 2], [d, 0]])}\\ \\ (f \\circ g)(x) = ?`, a: poly([[a, 2], [a * d + b, 0]]) };
      return { q: `f(x) = ${lin(a, b)},\\ g(x) = ${lin(c, d)}\\ \\ (f \\circ g)(x) = ?`, a: lin(a * c, a * d + b) }; }
    const a = NZ(-3, 3), b = R(-6, 6), c = R(-9, 9), k = R(-4, 4);
    return { q: `f(x) = ${poly([[a, 2], [b, 1], [c, 0]])}\\ \\ f(${k}) = ?`, a: String(a * k * k + b * k + c) };
  }],
  ['matrix', 'เมทริกซ์ 2×2', 'จงหาค่า', (lv) => {
    const A = [R(-6, 6), R(-6, 6), R(-6, 6), R(-6, 6)];
    if (lv < 2) return Math.random() < .5 ? { q: `\\det ${mat(A)}`, a: String(A[0] * A[3] - A[1] * A[2]) } : (() => { const B = [R(-6, 6), R(-6, 6), R(-6, 6), R(-6, 6)], k = NZ(-3, 3); return { q: `${k === 1 ? '' : k === -1 ? '-' : k}${mat(A)} + ${mat(B)}`, a: mat(A.map((v, i) => k * v + B[i])) }; })();
    const B = [R(-4, 4), R(-4, 4), R(-4, 4), R(-4, 4)];
    return { q: `${mat(A)}${mat(B)}`, a: mat([A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]]) };
  }],
  ['seq', 'ลำดับเลขคณิตและเรขาคณิต', 'จงหาค่า', (lv) => {
    const t = lv > 1 ? pick(['geo', 'sum', 'geo']) : pick(['ari', 'ari', 'geo']);
    if (t === 'ari') { const a = R(-10, 15), d = NZ(-6, 8), n = R(8, 40); return { q: `a_1 = ${a},\\ d = ${d}\\ \\ a_{${n}} = ?`, a: `a_{${n}} = ${a + (n - 1) * d}` }; }
    if (t === 'sum') { const a = R(-5, 12), d = NZ(-4, 6), n = R(8, 30); return { q: `a_1 = ${a},\\ d = ${d}\\ \\ S_{${n}} = ?`, a: `S_{${n}} = ${n * (2 * a + (n - 1) * d) / 2}` }; }
    const a = NZ(-5, 6), r = pick([2, 3, -2, -3, 2]), n = R(4, lv > 1 ? 8 : 6); return { q: `a_1 = ${a},\\ r = ${r}\\ \\ a_{${n}} = ?`, a: `a_{${n}} = ${a * r ** (n - 1)}` };
  }],
  ['complex', 'จำนวนเชิงซ้อน', 'จงเขียนในรูป a + bi', (lv) => {
    const a = R(-6, 6), b = NZ(-6, 6), c = R(-6, 6), d = NZ(-6, 6);
    if (lv > 1) { // division with a clean answer: (z·w) / w
      const p = R(-5, 5), q = NZ(-5, 5), nr = p * c - q * d, ni = p * d + q * c; if (!nr && !ni) return null;
      return { q: `\\frac{${cplx(nr, ni)}}{${cplx(c, d)}}`, a: cplx(p, q) }; }
    if (Math.random() < .35) { const op = pick(['+', '-']), s = op === '+' ? 1 : -1; return { q: `(${cplx(a, b)}) ${op} (${cplx(c, d)})`, a: cplx(a + s * c, b + s * d) }; }
    return { q: `(${cplx(a, b)})(${cplx(c, d)})`, a: cplx(a * c - b * d, a * d + b * c) };
  }],
  ['perm', 'วิธีเรียงสับเปลี่ยนและการจัดหมู่', 'จงหาค่า', (lv) => {
    const n = R(lv > 1 ? 6 : 4, lv > 1 ? 12 : 9), r = R(2, Math.min(lv > 1 ? 5 : 3, n - 1));
    if (lv > 1 && Math.random() < .35) { const k = R(2, 4), m = R(k + 1, 8); return { q: `P_{${n},${r}} + \\binom{${m}}{${k}}`, a: String(nPr(n, r) + nCr(m, k)) }; }
    return Math.random() < .5 ? { q: `P_{${n},${r}}`, a: String(nPr(n, r)) } : { q: `\\binom{${n}}{${r}}`, a: String(nCr(n, r)) };
  }],
  ['stats', 'ค่าเฉลี่ย มัธยฐาน ฐานนิยม', 'จงหาค่าเฉลี่ย มัธยฐาน และฐานนิยม', (lv) => {
    const n = lv > 1 ? pick([8, 9, 10]) : pick([5, 6, 7]), vals = [];
    const mode = R(2, 20); vals.push(mode, mode);
    while (vals.length < n) { const v = R(1, 25); if (!vals.includes(v)) vals.push(v); }
    const sum = vals.reduce((x, y) => x + y, 0); if (sum % n) return null;
    for (let i = vals.length - 1; i > 0; i--) { const j = R(0, i); [vals[i], vals[j]] = [vals[j], vals[i]]; }
    const st = [...vals].sort((x, y) => x - y), med = n % 2 ? String(st[(n - 1) / 2]) : dec((st[n / 2 - 1] + st[n / 2]) * 5, 1);
    return { q: vals.join(',\\ '), a: `\\bar{x} = ${sum / n},\\ \\text{Med} = ${med},\\ \\text{Mo} = ${mode}` };
  }],
  ['calc', 'ลิมิตและอินทิกรัลของพหุนาม', 'จงหาค่า', (lv) => {
    const t = lv > 1 ? pick(['def', 'def', 'lim']) : pick(['lim', 'ind']);
    if (t === 'lim') { const a = NZ(-5, 5), p = R(-6, 6); return { q: `\\lim_{x \\to ${a}} \\frac{${poly([[1, 2], [p - a, 1], [-p * a, 0]])}}{${lin(1, -a)}}`, a: String(a + p) }; }
    if (t === 'ind') { const c3 = NZ(-3, 3) * 3, c2 = R(-4, 4) * 2, c1 = R(-9, 9); return { q: `\\int (${poly([[c3, 2], [c2, 1], [c1, 0]])})\\,dx`, a: `${poly([[c3 / 3, 3], [c2 / 2, 2], [c1, 1]])} + C` }; }
    const c2 = NZ(-3, 3) * 3, c1 = R(-4, 4) * 2, c0 = R(-6, 6), b = R(1, 3), F = (x) => c2 / 3 * x ** 3 + c1 / 2 * x ** 2 + c0 * x;
    return { q: `\\int_{0}^{${b}} (${poly([[c2, 2], [c1, 1], [c0, 0]])})\\,dx`, a: String(F(b) - F(0)) };
  }],
];
// grade bands for the topic list
const BAND = { frac: 'm13', lineq: 'm13', factor: 'm13', quad: 'm13', expo: 'm13', system: 'm13', int: 'm13', fracmul: 'm13', sci: 'm13', pct: 'm13', polyop: 'm13', expand: 'm13', sqrt: 'm13', pyth: 'm13', ineq: 'm13', slope: 'm13' };
TOPICS.push(...MORE_TOPICS);
const ORDER = ['int', 'frac', 'fracmul', 'sci', 'pct', 'expo', 'lineq', 'ineq', 'polyop', 'expand', 'factor', 'sqrt', 'pyth', 'slope', 'system', 'quad', 'func', 'matrix', 'seq', 'complex', 'perm', 'stats', 'log', 'trig', 'deriv', 'calc'];
TOPICS.sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
export const bandOf = (id) => BAND[id] || 'm46';

export function generate(topic, n, lv) {
  const T = TOPICS.find(t => t[0] === topic) || TOPICS[0], out = [], seen = new Set();
  for (let tries = 0; out.length < n && tries < n * 40; tries++) { const p = T[3](lv); if (!p || seen.has(p.q)) continue; seen.add(p.q); out.push(p); }
  return out;
}

export async function openProblems(ed, anchor) {
  const st = prefs.probs || {}; let topic = st.topic || 'lineq', n = st.n || 6, lv = st.lv || 1, ans = st.ans || 'next', list = [];
  const grp = (band, label) => h('optgroup', { label }, ...TOPICS.filter(t => bandOf(t[0]) === band).map(t => h('option', { value: t[0] }, t[1])));
  const sel = h('select', { class: 'sel', style: { width: '100%' } }, grp('m13', 'ม.1–3'), grp('m46', 'ม.4–6')); sel.value = topic;
  const prev = h('div', { class: 'pb-prev' });
  const { texSvgEl } = await import('./mathtools.js');
  const paint = async () => {
    list = generate(topic, n, lv); prev.innerHTML = '';
    for (const [i, p] of list.entries()) {
      const row = h('div', { class: 'pb-row' }, h('b', {}, (i + 1) + '.'));
      try { const q = await texSvgEl(p.q); q.style.height = 'auto'; q.style.maxWidth = '60%'; const a = await texSvgEl(p.a, '#0F8A7E'); a.style.height = 'auto'; a.style.maxWidth = '35%'; row.append(q, h('span', { class: 'pb-arrow' }, 'ตอบ'), a); }
      catch (e) { row.append(h('span', {}, p.q)); }
      prev.append(row);
    }
  };
  sel.onchange = () => { topic = sel.value; paint(); };
  const reroll = h('button', { class: 'pill sec' }, icon('dice'), 'สุ่มใหม่'); reroll.onclick = paint;
  const body = h('div', {}, h('div', { class: 'lbl', style: { marginTop: 0 } }, 'เรื่อง'), sel,
    h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginTop: '10px' } },
      h('span', { class: 'sub' }, 'จำนวน'), seg([['4', '4'], ['6', '6'], ['8', '8'], ['10', '10']], String(n), v => { n = +v; paint(); }),
      h('span', { class: 'sub' }, 'ระดับ'), seg([['1', 'พื้นฐาน'], ['2', 'ท้าทาย']], String(lv), v => { lv = +v; paint(); })),
    h('div', { class: 'lbl' }, 'เฉลย'), seg([['next', 'หน้าถัดไป'], ['bottom', 'ล่างหน้านี้ (บังไว้ แตะเปิดทีละข้อ)'], ['none', 'ไม่ใส่']], ans, v => ans = v),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 4px' } }, h('span', { class: 'sub' }, 'ตัวอย่าง (เฉลยสีเขียวไม่ขึ้นบนหน้าโจทย์)'), reroll), prev);
  const bz = busy('กำลังเตรียมตัวแสดงสมการ…');
  try { await paint(); } catch (e) { bz.done(); toast('โหลดตัวแสดงสมการไม่ได้ (ต้องต่อเน็ตครั้งแรก)', 3500, 'warn'); return; }
  bz.done();
  dialog('สุ่มโจทย์ฝึก', body, [{ label: 'ยกเลิก' }, { label: 'วางบนหน้า', cls: 'prim', flex: 2, action: () => { prefs.probs = { topic, n, lv, ans }; savePrefs(); placeProblems(ed, topic, list, ans); } }], { width: 640 });
}

// lay the problems out in one or two columns from the visible top of the current page
export async function placeProblems(ed, topic, list, ans) {
  const T = TOPICS.find(t => t[0] === topic) || TOPICS[0];
  const { texImage } = await import('./mathtools.js');
  const bz = busy('กำลังวางโจทย์…');
  try {
    let page = ed.currentPage(); const P = dims(page), color = prefs.penColor || '#1E2A55';
    const [, wy] = ed.toWorld(ed.W / 2, 0), rc = ed.rects.get(page.id);
    // start below whatever is already written; a page that is too full gets a fresh page after it
    const below = page.strokes.reduce((m, s) => { try { return Math.max(m, strokeBB(s)[3]); } catch { return m; } }, 0);
    let y0 = Math.max(30, Math.min(P.h * 0.5, wy - rc.y + 20), below ? below + 24 : 0);
    if (y0 > P.h * 0.55) { page = ed.addPage({ size: page.size, bg: page.bg }, page.id); y0 = 40; }
    const items = [], mkText = (text, x, y, size = 24, bold = true, c = color) => { const o = { id: uid(), t: 'text', text, size, bold, c, a: 1, x, y, ts: Date.now() }; const m = measureText(o); o.w = m.w; o.h = m.h; return o; };
    const mkImg = async (tex, x, y, c) => { const r = await texImage(tex, c, 22); const n = await normalizeImage(r.file); return { id: uid(), t: 'img', blob: n.blob, iw: n.iw, ih: n.ih, crop: { x: 0, y: 0, w: 1, h: 1 }, mask: null, x, y, w: r.w, h: r.h, meta: { ...r.meta, w0: r.w }, ts: Date.now() }; };
    const head = mkText(`${T[1]} · ${T[2].replace(/\\\(|\\\)/g, '')}`, 40, y0); items.push(head);
    const lay = async (arr, startY, key, c) => {
      const out = []; let col = 0, y = startY; const colW = (P.w - 80) / 2, x0 = () => 40 + col * colW;
      for (const [i, p] of arr.entries()) {
        const num = mkText(`${i + 1}.`, x0(), y, 22, true, c);
        const img = await mkImg(p[key], x0() + 30, y - 4, c);
        if (img.w > colW - 40) { const k = (colW - 40) / img.w; img.w *= k; img.h *= k; }
        if (y + img.h > P.h - 30) { if (col === 0) { col = 1; y = startY; num.x = x0(); num.y = y; img.x = x0() + 30; img.y = y - 4; } else { toast('หน้าไม่พอ วางได้ ' + i + ' ข้อ', 2500); break; } }
        out.push(num, img); y += Math.max(img.h, num.h) + 16;
      }
      return { out, bottom: y };
    };
    const q = await lay(list, y0 + head.h + 14, 'q', color); items.push(...q.out);
    const before = page.strokes.slice(); page.strokes.push(...items);
    const hist = [{ pid: page.id, before, after: page.strokes.slice() }];
    if (ans === 'bottom') {
      const ah = mkText('เฉลย', 40, Math.max(q.bottom + 30, P.h * 0.62), 22, true, '#0F8A7E');
      const a = await lay(list, ah.y + ah.h + 10, 'a', '#0F8A7E');
      const b2 = page.strokes.slice(); page.strokes.push(ah, ...a.out); hist[0].after = page.strokes.slice(); void b2;
      // each answer gets its own cover strip: tap one to reveal it, tap again to hide
      const covers = [];
      for (let i = 0; i + 1 < a.out.length; i += 2) {
        const im = a.out[i + 1], hh = im.h + 10, yc = im.y + im.h / 2, xa = im.x - 4, xb = im.x + im.w + 6;
        covers.push({ id: uid(), t: 'hl', pen: 'hl', hs: 'marker', cv: 1, op: 0, c: '#5B6B82', a: 1, w: hh, pts: Float32Array.from([xa, yc, .5, 0, xb, yc, .5, 0]), ts: Date.now() });
      }
      page.strokes.push(...covers); hist[0].after = page.strokes.slice();
    }
    ed.pushHistory({ k: 'str', items: hist }); ed.markDirty(page); ed.need.main = true;
    if (ans === 'next') {
      const np = ed.addPage({ size: page.size, bg: page.bg }, page.id);
      const nh = mkText(`เฉลย · ${T[1]}`, 40, 40, 24, true, '#0F8A7E');
      const a = await lay(list, 40 + nh.h + 14, 'a', '#0F8A7E');
      np.strokes.push(nh, ...a.out); ed.markDirty(np); ed.need.main = true; ed.scrollToPage(page.id);
    }
    toast(`วางโจทย์ ${list.length} ข้อแล้ว${ans === 'next' ? ' · เฉลยอยู่หน้าถัดไป' : ans === 'bottom' ? ' · เฉลยถูกบังไว้ แตะแถบเพื่อเปิดทีละข้อ' : ''}`, 2500);
  } catch (e) { console.error(e); toast('วางโจทย์ไม่สำเร็จ: ' + (e.message || e), 3500, 'warn'); }
  finally { bz.done(); }
}
