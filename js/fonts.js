// App (UI) font: buttons, menus and dialogs. Writing on the page, badges and exports stay TH Sarabun New.
// Fonts are SIL Open Font License (see fonts/ui/OFL.txt); subset to Thai + Latin, loaded only when chosen.
import { prefs, savePrefs } from './prefs.js';

// id, name, group, size-adjust (to match the sizes tuned for TH Sarabun New), bold file?
export const UI_FONTS = [
  ['sarabun', 'TH Sarabun New', 'เดิม', 1, true],
  ['anuphan', 'Anuphan', 'ทันสมัย', 0.92, true],
  ['ibm', 'IBM Plex Sans Thai', 'ทันสมัย', 0.9, true],
  ['noto', 'Noto Sans Thai', 'ทันสมัย', 0.9, true],
  ['k2d', 'K2D', 'ทันสมัย', 0.94, true],
  ['prompt', 'Prompt', 'ทันสมัย', 0.86, true],
  ['kanit', 'Kanit', 'ทันสมัย', 0.9, true],
  ['mitr', 'Mitr', 'ทันสมัย', 0.86, true],
  ['bai', 'Bai Jamjuree', 'ทันสมัย', 0.92, true],
  ['chakra', 'Chakra Petch', 'ทันสมัย', 0.92, true],
  ['athiti', 'Athiti', 'ทันสมัย', 0.98, true],
  ['ibml', 'IBM Plex Sans Thai Looped', 'มีหัว อ่านง่าย', 0.9, true],
  ['notol', 'Noto Sans Thai Looped', 'มีหัว อ่านง่าย', 0.9, true],
  ['playpen', 'Playpen Sans Thai', 'ลายมือ น่ารัก', 0.88, true],
  ['kodchasan', 'Kodchasan', 'ลายมือ น่ารัก', 0.9, true],
  ['mali', 'Mali', 'ลายมือ น่ารัก', 0.88, true],
  ['itim', 'Itim', 'ลายมือ น่ารัก', 0.98, false],
];
const FONT_CACHE = 'senkidfonts-v1'; // not a "senkid-" cache, so app updates don't throw it away
const url = (id, w) => new URL(`fonts/ui/${id}-${w}.woff2`, document.baseURI).href;
const fam = (id) => 'SenkidUI-' + id;

export function faceCss(id, previewOnly) {
  const f = UI_FONTS.find(x => x[0] === id); if (!f || id === 'sarabun') return '';
  const ws = previewOnly || !f[4] ? [400] : [400, 700];
  return ws.map(w => `@font-face{font-family:"${fam(id)}";src:url(${url(id, w)}) format("woff2");font-weight:${w};font-display:swap;size-adjust:${Math.round(f[3] * 100)}%}`).join('');
}
export function familyOf(id) { return id && id !== 'sarabun' ? `"${fam(id)}","TH Sarabun New",system-ui,sans-serif` : `"TH Sarabun New",system-ui,sans-serif`; }

export function applyUiFont(id = prefs.uiFont || 'sarabun') {
  let st = document.getElementById('uifont');
  if (id === 'sarabun') { st?.remove(); return; }
  if (!st) { st = document.createElement('style'); st.id = 'uifont'; document.head.append(st); }
  st.textContent = faceCss(id) +
    `body,button:not(.fl-row),input,select,textarea{font-family:${familyOf(id)}!important}` +
    // text typed on the page and the praise badges must match what is drawn/exported
    `.txed,.stk.badge{font-family:"TH Sarabun New",sans-serif!important}`;
  keepOffline(id);
}
async function keepOffline(id) {
  try {
    if (!('caches' in window)) return;
    const c = await caches.open(FONT_CACHE);
    const f = UI_FONTS.find(x => x[0] === id);
    for (const w of f && f[4] ? [400, 700] : [400]) { const u = url(id, w); if (!(await c.match(u))) { const r = await fetch(u); if (r.ok) await c.put(u, r); } }
  } catch { }
}
export function setUiFont(id) { prefs.uiFont = id; savePrefs(); applyUiFont(id); }
