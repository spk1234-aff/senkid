// English UI. The app is written in Thai; in English mode every Thai string that reaches the page
// (text, title, aria-label, placeholder) is looked up in i18n/en.json and swapped as it appears.
// Templates like "หน้า {0}" match "หน้า 3". User content (inputs, text boxes, names marked data-noi18n) is left alone.
import { prefs } from './prefs.js';

const TH = /[฀-๿]/;
let dict = null, pats = [], on = false;
export const lang = () => (prefs.lang === 'en' ? 'en' : 'th');
export const isEn = () => on;

const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
function build(d) {
  dict = new Map();
  pats = [];
  for (const [k, v] of Object.entries(d)) {
    if (!v) continue;
    if (/\{\d+\}/.test(k)) {
      const order = []; const src = esc(k).replace(/\\?\{(\d+)\\?\}/g, (m, n) => { order.push(+n); return '([\\s\\S]+?)'; });
      try { pats.push({ re: new RegExp('^' + src + '$'), order, v, len: k.length }); } catch { }
    } else dict.set(k, v);
  }
  pats.sort((a, b) => b.len - a.len); // most specific first
}
// translate one string; returns null when nothing changed
export function tr(s, depth = 0) {
  if (!on || !s || !TH.test(s)) return null;
  if (s.includes('\u2060')) s = s.replace(/\u2060/g, '');
  const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0], core = s.trim();
  let out = dict.get(core);
  if (out == null) for (const p of pats) { const m = core.match(p.re); if (m) { out = p.v.replace(/\{(\d+)\}/g, (x, n) => { const val = m[p.order.indexOf(+n) + 1] ?? ''; return tr(val, depth + 1) ?? val; }); break; } }
  if (out == null && depth < 2) {
    // pieces joined with " · ", " — ", ": " or newlines
    for (const sep of ['\n', ' · ', ' — ', ' – ', ' / ', ': ', ' (']) {
      if (!core.includes(sep)) continue;
      const parts = core.split(sep); let changed = false;
      const res = parts.map((x, i) => { const piece = sep === ' (' && i > 0 ? '(' + x : x; const t = tr(piece, depth + 1); if (t != null) { changed = true; return sep === ' (' && i > 0 ? t.replace(/^\(/, '') : t; } return x; });
      if (changed) { out = res.join(sep); break; }
    }
  }
  return out == null ? null : lead + out + tail;
}
export const t = (s) => tr(s) ?? s;

const SKIP = new Set(['NOSCRIPT', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CANVAS', 'SVG', 'CODE']);
const INLINE = new Set(['B', 'I', 'BR', 'SMALL', 'EM', 'STRONG', 'KBD', 'SPAN', 'A', 'SUP', 'SUB']);
const skipNode = (el) => !el || el.closest?.('[data-noi18n],[contenteditable=""],[contenteditable=true],textarea,input');
function doAttrs(el) {
  for (const a of ['title', 'aria-label', 'placeholder']) { const v = el.getAttribute?.(a); if (v && TH.test(v)) { const x = tr(v); if (x != null && x !== v) el.setAttribute(a, x); } }
}
function doEl(el) {
  if (el.nodeType !== 1) return;
  if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.closest('[data-noi18n]')) { doAttrs(el); return; }
  if (SKIP.has(el.tagName) || skipNode(el)) return;
  doAttrs(el);
  // rich text written with tags (help pages): translate the whole fragment at once
  if (el.children.length && el.innerHTML.length < 1500 && TH.test(el.textContent) && [...el.children].every(c => INLINE.has(c.tagName) && !c.children.length)) {
    const raw = el.innerHTML.trim(), x = dict.get(raw) || dict.get(raw.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')); if (x) { el.innerHTML = x; return; }
  }
  for (const n of [...el.childNodes]) {
    if (n.nodeType === 3) doText(n);
    else if (n.nodeType === 1) doEl(n);
  }
}
function doText(n) { const v = n.nodeValue; if (!v || !TH.test(v)) return; if (skipNode(n.parentElement)) return; const x = tr(v); if (x != null && x !== v) n.nodeValue = x; }

export async function initI18n() {
  if (lang() !== 'en') return;
  try { const r = await fetch('./i18n/en.json'); build(await r.json()); } catch (e) { console.warn('i18n', e); return; }
  on = true;
  document.documentElement.lang = 'en';
  // Thai dates → English dates
  const L = Date.prototype.toLocaleDateString, LT = Date.prototype.toLocaleTimeString, LS = Date.prototype.toLocaleString;
  const fix = (loc) => (loc === 'th-TH' || loc === 'th' ? 'en-GB' : loc);
  Date.prototype.toLocaleDateString = function (loc, o) { return L.call(this, fix(loc), o); };
  Date.prototype.toLocaleTimeString = function (loc, o) { return LT.call(this, fix(loc), o); };
  Date.prototype.toLocaleString = function (loc, o) { return LS.call(this, fix(loc), o); };
  const N = Number.prototype.toLocaleString; Number.prototype.toLocaleString = function (loc, o) { return N.call(this, fix(loc), o); };
  if (document.title && TH.test(document.title)) document.title = t(document.title);
  doEl(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') for (const n of m.addedNodes) { if (n.nodeType === 3) doText(n); else doEl(n); }
      else if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v && TH.test(v) && !m.target.closest('[data-noi18n]')) { const x = tr(v); if (x != null && x !== v) m.target.setAttribute(m.attributeName, x); } }
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
}
