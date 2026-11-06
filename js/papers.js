// Math papers: page backgrounds with options (page.bg = 'graph' | 'trig' | 'polar' | 'truth', options in page.bgo)
import { h, seg, dialog } from './ui.js';

export const MATH_BGS = { graph: 'กราฟ x‑y', trig: 'กราฟตรีโกณ', polar: 'พิกัดเชิงขั้ว', truth: 'ตารางค่าความจริง' };
export const isMathBg = (bg) => bg in MATH_BGS;
export const DEFAULTS = {
  graph: { unit: 1, cell: 28, origin: 'center', labels: true },   // cell = page units per grid cell; unit = value per cell
  trig: { ymax: 2, cell: 36 },                                         // x in π/2 steps
  polar: { rings: 8, spokes: 12 },
  truth: { vars: 3, rows: 0 },
};
export const describe = (bg, o = {}) => {
  const d = { ...DEFAULTS[bg], ...o };
  if (bg === 'graph') return `กราฟ ช่องละ ${d.unit} หน่วย · จุดกำเนิด${d.origin === 'center' ? 'กลางหน้า' : 'ล่างซ้าย'}`;
  if (bg === 'trig') return `ตรีโกณ แกน x เป็น π/2 · y ±${d.ymax}`;
  if (bg === 'polar') return `เชิงขั้ว ${d.rings} วง · ${d.spokes} แฉก`;
  if (bg === 'truth') return `ตารางค่าความจริง ${d.vars} ตัวแปร (${2 ** d.vars} แถว)`;
  return MATH_BGS[bg] || bg;
};

// one dialog for all three places a background is chosen (new notebook, add page, this page)
export function mathPaperDialog(cur = {}) {
  return new Promise((res) => {
    let bg = isMathBg(cur.bg) ? cur.bg : 'graph';
    let o = { ...DEFAULTS[bg], ...(isMathBg(cur.bg) ? (cur.bgo || {}) : {}) };
    const opts = h('div', {});
    const paint = () => {
      opts.innerHTML = '';
      const row = (label, ctl) => h('div', { class: 'row' }, h('div', {}, label), ctl);
      if (bg === 'graph') {
        opts.append(row('ค่าต่อช่อง', seg([['0.5', '0.5'], ['1', '1'], ['2', '2'], ['5', '5'], ['10', '10']], String(o.unit), v => o.unit = +v)),
          row('ขนาดช่อง', seg([['22', 'เล็ก'], ['28', 'กลาง'], ['36', 'ใหญ่']], String(o.cell), v => o.cell = +v)),
          row('จุดกำเนิด', seg([['center', 'กลางหน้า'], ['bl', 'ล่างซ้าย']], o.origin, v => o.origin = v)),
          row('ตัวเลขบนแกน', seg([['1', 'แสดง'], ['0', 'ซ่อน']], o.labels ? '1' : '0', v => o.labels = v === '1')));
      } else if (bg === 'trig') {
        opts.append(row('แกน y ถึง', seg([['1', '±1'], ['2', '±2'], ['4', '±4']], String(o.ymax), v => o.ymax = +v)),
          row('ขนาดช่อง', seg([['28', 'เล็ก'], ['36', 'กลาง'], ['44', 'ใหญ่']], String(o.cell), v => o.cell = +v)));
      } else if (bg === 'polar') {
        opts.append(row('จำนวนวง', seg([['5', '5'], ['8', '8'], ['10', '10']], String(o.rings), v => o.rings = +v)),
          row('แฉก (องศา)', seg([['12', 'ทุก 30°'], ['24', 'ทุก 15°'], ['36', 'ทุก 10°']], String(o.spokes), v => o.spokes = +v)));
      } else if (bg === 'truth') {
        opts.append(row('ตัวแปร', seg([['2', 'p q'], ['3', 'p q r'], ['4', 'p q r s']], String(o.vars), v => o.vars = +v)));
      }
    };
    const kinds = seg(Object.entries(MATH_BGS), bg, v => { bg = v; o = { ...DEFAULTS[bg], ...(cur.bg === bg ? (cur.bgo || {}) : {}) }; paint(); });
    paint();
    let ok = false;
    dialog('กระดาษคณิต', h('div', {}, kinds, h('div', { style: { height: '8px' } }), opts, h('p', { class: 'sub', style: { margin: '8px 0 0' } }, 'ส่งออก PDF และฉายขึ้นทีวีได้ตรงกับที่เห็น · เปลี่ยนภายหลังได้จากเมนูพื้นกระดาษ')),
      [{ label: 'ยกเลิก' }, { label: 'ใช้กระดาษนี้', cls: 'prim', flex: 2, action: () => { ok = true; } }], { width: 520, onClose: () => res(ok ? { bg, bgo: { ...o } } : null) });
  });
}

// ---------- drawing (page coordinates; k = zoom, for hairline widths) ----------
const FONT = (px) => `${px}px "TH Sarabun New", system-ui, sans-serif`;
export function drawMathPaper(ctx, page, P, pp, k) {
  const o = { ...DEFAULTS[page.bg], ...(page.bgo || {}) };
  const lw = Math.max(0.35, 1 / k), thin = pp.line, axis = pp.dark ? 'rgba(255,255,255,.55)' : '#6B7280', text = pp.dark ? 'rgba(255,255,255,.7)' : '#5B6472';
  ctx.save(); ctx.lineWidth = lw; ctx.strokeStyle = thin; ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  if (page.bg === 'graph') {
    const c = o.cell, ox = o.origin === 'center' ? Math.round(P.w / 2 / c) * c : c * 2, oy = o.origin === 'center' ? Math.round(P.h / 2 / c) * c : P.h - c * 2;
    ctx.beginPath();
    for (let x = ox % c; x < P.w; x += c) { ctx.moveTo(x, 0); ctx.lineTo(x, P.h); }
    for (let y = oy % c; y < P.h; y += c) { ctx.moveTo(0, y); ctx.lineTo(P.w, y); }
    ctx.stroke();
    // every 5th line a little darker
    ctx.strokeStyle = axis; ctx.globalAlpha = 0.35; ctx.beginPath();
    for (let i = -Math.ceil(ox / c); ox + i * c < P.w; i++) if (i % 5 === 0 && i) { ctx.moveTo(ox + i * c, 0); ctx.lineTo(ox + i * c, P.h); }
    for (let i = -Math.ceil(oy / c); oy + i * c < P.h; i++) if (i % 5 === 0 && i) { ctx.moveTo(0, oy + i * c); ctx.lineTo(P.w, oy + i * c); }
    ctx.stroke(); ctx.globalAlpha = 1;
    // axes with arrows
    ctx.strokeStyle = axis; ctx.lineWidth = Math.max(1.2, 1.6 / k); ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(P.w, oy); ctx.moveTo(ox, 0); ctx.lineTo(ox, P.h); ctx.stroke();
    ctx.fillStyle = axis; ctx.beginPath(); ctx.moveTo(P.w, oy); ctx.lineTo(P.w - 10, oy - 5); ctx.lineTo(P.w - 10, oy + 5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox - 5, 10); ctx.lineTo(ox + 5, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = text; ctx.font = FONT(15); ctx.textAlign = 'left'; ctx.fillText('x', P.w - 14, oy + 6); ctx.fillText('y', ox + 8, 4);
    if (o.labels) {
      ctx.font = FONT(13); ctx.textAlign = 'center';
      const every = o.unit >= 5 ? 1 : 1, fmt = (v) => (Math.round(v * 100) / 100).toString();
      for (let i = -Math.floor(ox / c); ox + i * c < P.w; i += every) if (i) ctx.fillText(fmt(i * o.unit), ox + i * c, oy + 4);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let i = -Math.floor((P.h - oy) / c); oy - i * c > 0; i += every) if (i) ctx.fillText(fmt(i * o.unit), ox - 5, oy - i * c);
      ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('0', ox - 4, oy + 4);
    }
  } else if (page.bg === 'trig') {
    const c = o.cell, q = c * 1.4; // one cell per 0.5 on y; q = width of π/2
    const ox = c * 1.5, oy = Math.round(P.h / 2 / c) * c;
    const yr = o.ymax * 2; // cells up
    ctx.beginPath();
    for (let x = ox; x < P.w; x += q / 2) { ctx.moveTo(x, oy - yr * c); ctx.lineTo(x, oy + yr * c); }
    for (let i = -yr; i <= yr; i++) { ctx.moveTo(ox, oy + i * c); ctx.lineTo(P.w, oy + i * c); }
    ctx.stroke();
    ctx.strokeStyle = axis; ctx.lineWidth = Math.max(1.2, 1.6 / k); ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(P.w, oy); ctx.moveTo(ox, oy - yr * c - 10); ctx.lineTo(ox, oy + yr * c + 10); ctx.stroke();
    ctx.font = FONT(14); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lab = ['0', 'π/2', 'π', '3π/2', '2π', '5π/2', '3π', '7π/2', '4π', '9π/2', '5π'];
    for (let i = 0; ox + i * q < P.w - 10; i++) { ctx.fillText(lab[i] || '', ox + i * q, oy + 4); if (i) { ctx.strokeStyle = axis; ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(ox + i * q, oy - yr * c); ctx.lineTo(ox + i * q, oy + yr * c); ctx.stroke(); ctx.globalAlpha = 1; } }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = -yr; i <= yr; i++) if (i % 2 === 0 && i) ctx.fillText(String(i / 2), ox - 5, oy - i * c);
    ctx.fillText('y', ox - 5, oy - yr * c - 12); ctx.textAlign = 'left'; ctx.fillText('x', P.w - 14, oy - 12);
    // a faint sine as a guide
    ctx.strokeStyle = axis; ctx.globalAlpha = 0.18; ctx.lineWidth = Math.max(1, 1.4 / k); ctx.beginPath();
    for (let x = ox; x < P.w; x += 2) { const t = (x - ox) / q * Math.PI / 2; const y = oy - Math.sin(t) * 2 * c; x === ox ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke(); ctx.globalAlpha = 1;
  } else if (page.bg === 'polar') {
    const cx = P.w / 2, cy = P.h / 2, R = Math.min(P.w, P.h) / 2 - 28, step = R / o.rings;
    ctx.beginPath(); for (let i = 1; i <= o.rings; i++) { ctx.moveTo(cx + i * step, cy); ctx.arc(cx, cy, i * step, 0, Math.PI * 2); } ctx.stroke();
    ctx.beginPath(); for (let i = 0; i < o.spokes; i++) { const a = i * 2 * Math.PI / o.spokes; ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(a), cy - R * Math.sin(a)); } ctx.stroke();
    ctx.strokeStyle = axis; ctx.lineWidth = Math.max(1.2, 1.6 / k); ctx.beginPath(); ctx.moveTo(cx - R - 12, cy); ctx.lineTo(cx + R + 12, cy); ctx.moveTo(cx, cy - R - 12); ctx.lineTo(cx, cy + R + 12); ctx.stroke();
    ctx.font = FONT(13); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < o.spokes; i++) { const a = i * 2 * Math.PI / o.spokes, deg = Math.round(i * 360 / o.spokes); ctx.fillText(deg + '°', cx + (R + 16) * Math.cos(a), cy - (R + 16) * Math.sin(a)); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; for (let i = 1; i <= o.rings; i++) ctx.fillText(String(i), cx + i * step + 2, cy + 3);
  } else if (page.bg === 'truth') {
    const vars = ['p', 'q', 'r', 's'].slice(0, o.vars), rows = 2 ** o.vars, cols = o.vars + 4; // 4 empty columns for expressions
    const left = 40, top = 64, cw = Math.min(70, (P.w - 80) / cols), rh = 30;
    ctx.strokeStyle = axis; ctx.lineWidth = Math.max(0.8, 1.1 / k); ctx.beginPath();
    for (let c = 0; c <= cols; c++) { ctx.moveTo(left + c * cw, top); ctx.lineTo(left + c * cw, top + (rows + 1) * rh); }
    for (let r = 0; r <= rows + 1; r++) { ctx.moveTo(left, top + r * rh); ctx.lineTo(left + cols * cw, top + r * rh); }
    ctx.stroke();
    ctx.fillStyle = pp.dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.05)'; ctx.fillRect(left, top, cols * cw, rh);
    ctx.fillStyle = text; ctx.font = FONT(18); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    vars.forEach((v, i) => ctx.fillText(v, left + i * cw + cw / 2, top + rh / 2));
    for (let r = 0; r < rows; r++) for (let i = 0; i < vars.length; i++) { const bit = Math.floor(r / 2 ** (vars.length - 1 - i)) % 2; ctx.fillText(bit ? 'F' : 'T', left + i * cw + cw / 2, top + (r + 1) * rh + rh / 2); }
    // a second table lower on the page when there is room
    const top2 = top + (rows + 1) * rh + 60;
    if (top2 + (rows + 1) * rh < P.h - 20) {
      ctx.strokeStyle = axis; ctx.beginPath();
      for (let c = 0; c <= cols; c++) { ctx.moveTo(left + c * cw, top2); ctx.lineTo(left + c * cw, top2 + (rows + 1) * rh); }
      for (let r = 0; r <= rows + 1; r++) { ctx.moveTo(left, top2 + r * rh); ctx.lineTo(left + cols * cw, top2 + r * rh); }
      ctx.stroke();
      ctx.fillStyle = pp.dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.05)'; ctx.fillRect(left, top2, cols * cw, rh); ctx.fillStyle = text;
      vars.forEach((v, i) => ctx.fillText(v, left + i * cw + cw / 2, top2 + rh / 2));
      for (let r = 0; r < rows; r++) for (let i = 0; i < vars.length; i++) { const bit = Math.floor(r / 2 ** (vars.length - 1 - i)) % 2; ctx.fillText(bit ? 'F' : 'T', left + i * cw + cw / 2, top2 + (r + 1) * rh + rh / 2); }
    }
  }
  ctx.restore();
}
