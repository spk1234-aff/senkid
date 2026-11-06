// สุ่มโจทย์ฝึก: random practice problems with clean answers, typeset in LaTeX and placed on the page.
// Answers can go on the next page or at the bottom of this page (hide them with the curtain).
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

export function generate(topic, n, lv) {
  const T = TOPICS.find(t => t[0] === topic) || TOPICS[0], out = [], seen = new Set();
  for (let tries = 0; out.length < n && tries < n * 40; tries++) { const p = T[3](lv); if (!p || seen.has(p.q)) continue; seen.add(p.q); out.push(p); }
  return out;
}

export async function openProblems(ed, anchor) {
  const st = prefs.probs || {}; let topic = st.topic || 'lineq', n = st.n || 6, lv = st.lv || 1, ans = st.ans || 'next', list = [];
  const sel = h('select', { class: 'sel', style: { width: '100%' } }, ...TOPICS.map(t => h('option', { value: t[0] }, t[1]))); sel.value = topic;
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
    h('div', { class: 'lbl' }, 'เฉลย'), seg([['next', 'หน้าถัดไป'], ['bottom', 'ล่างหน้านี้ (บังด้วยม่าน)'], ['none', 'ไม่ใส่']], ans, v => ans = v),
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
      // remember where the answers start so the curtain can snap there
      page.steps = [...new Set([...(page.steps || []), Math.round(ah.y - 10)])].sort((x, y) => x - y);
    }
    ed.pushHistory({ k: 'str', items: hist }); ed.markDirty(page); ed.need.main = true;
    if (ans === 'next') {
      const np = ed.addPage({ size: page.size, bg: page.bg }, page.id);
      const nh = mkText(`เฉลย · ${T[1]}`, 40, 40, 24, true, '#0F8A7E');
      const a = await lay(list, 40 + nh.h + 14, 'a', '#0F8A7E');
      np.strokes.push(nh, ...a.out); ed.markDirty(np); ed.need.main = true; ed.scrollToPage(page.id);
    }
    toast(`วางโจทย์ ${list.length} ข้อแล้ว${ans === 'next' ? ' · เฉลยอยู่หน้าถัดไป' : ans === 'bottom' ? ' · ใช้ม่านบังเฉลยด้านล่าง' : ''}`, 2500);
  } catch (e) { console.error(e); toast('วางโจทย์ไม่สำเร็จ: ' + (e.message || e), 3500, 'warn'); }
  finally { bz.done(); }
}
