// User preferences persisted in localStorage
const KEY = 'senkid.prefs.v1';

export const PEN_TYPES = [
  // id, label, default size, presets
  ['ball', 'ลูกลื่น', 1.2, [0.5, 0.8, 1.2, 2, 4]],
  ['fount', 'หมึกซึม', 2, [1, 1.5, 2, 3, 5]],
  ['calli', 'คอแร้ง', 4, [2, 3, 4, 6, 10]],
  ['brush', 'พู่กัน', 5, [2, 3.5, 5, 9, 16]],
  ['marker', 'มาร์กเกอร์', 4, [2, 3, 4, 7, 12]],
  ['pencil', 'ดินสอ', 1.6, [0.7, 1.1, 1.6, 2.5, 4]],
  ['dash', 'เส้นประ', 1.5, [0.8, 1.2, 1.5, 2.5, 4]],
  ['dot', 'เส้นจุด', 2, [1, 1.5, 2, 3, 5]],
];
export const PEN_LABEL = Object.fromEntries(PEN_TYPES.map(p => [p[0], p[1]]));
PEN_LABEL.hl = 'ไฮไลต์';

const defaults = () => ({
  penType: 'fount',
  pens: Object.fromEntries(PEN_TYPES.map(([id, , s, pr]) => [id, { size: s, presets: pr.slice() }])),
  penColor: '#1E2A55', penAlpha: 1,
  hl: { size: 14, presets: [8, 11, 14, 20, 28], color: '#F5B83D', alpha: 0.4, straight: false, style: 'brush' },
  eraser: { mode: 'stroke', size: 14, presets: [6, 10, 14, 24, 40] },
  favorites: ['#1E2A55', '#2F5BEA', '#D64545', '#1E9E5A', '#F5B83D', '#7A4BD6', '#000000', '#E06B2D'],
  hlFavorites: ['#F5B83D', '#7FE07A', '#7CC7FF', '#FF8FB1', '#C9A7FF'],
  recent: [],
  toolbarPos: 'top', toolbarHidden: false,
  theme: 'auto', fingerDraw: false, shapeRecog: true, shapeFill: true, scribbleErase: true, twoPage: true, economy: false,
  showHover: true, onboarded: false,
  newNb: { bg: 'grid', orient: 'P', paper: 'cream' },
  rec: { res: '2160', mic: '', micLabel: '', warn25: true, fps: 30, uploadMode: 'bg', cam: '', camLabel: '', camShape: 'circle', camSize: 150 },
  folders: [], folderColors: {}, tabs: [], lastOpen: null,
  laser: { style: 'trail', size: 'm', color: '#FF3B30' },
});

function merge(d, s) {
  for (const k in s) {
    if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) merge(d[k], s[k]);
    else if (s[k] !== undefined) d[k] = s[k];
  }
  return d;
}

let state;
try { state = merge(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { state = defaults(); }
export const prefs = state;
let t = null;
const subs = new Set();
// the part of the settings that should be the same on every device of the teacher
export const SYNCED_KEYS = ['pens', 'penColor', 'penAlpha', 'hl', 'eraser', 'favorites', 'hlFavorites', 'laser', 'uiFont', 'shapeFill', 'shapeFillA', 'shapeRecog', 'scribbleErase', 'newNb', 'rosters', 'penSets', 'worksheets'];
export function toolPrefs() { const o = {}; for (const k of SYNCED_KEYS) if (state[k] !== undefined) o[k] = state[k]; return o; }
export function applyToolPrefs(o, stamp) { for (const k of SYNCED_KEYS) if (o[k] !== undefined) state[k] = o[k]; state.toolsStamp = stamp; lastTools = JSON.stringify(toolPrefs()); savePrefs(); }
let lastTools = JSON.stringify(toolPrefs());
export function savePrefs() {
  clearTimeout(t);
  const tp = JSON.stringify(toolPrefs()); if (tp !== lastTools) { lastTools = tp; state.toolsStamp = Date.now(); }
  t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { } }, 150);
  subs.forEach(f => f());
}
// write now (before a reload, or when the page is going away)
export function flushPrefs() { clearTimeout(t); try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { } }
addEventListener('pagehide', flushPrefs);
export function onPrefs(f) { subs.add(f); return () => subs.delete(f); }

export function pushRecent(color) {
  const c = color.toUpperCase();
  const r = state.recent.filter(x => x.toUpperCase() !== c);
  r.unshift(c); state.recent = r.slice(0, 10); savePrefs();
}

// colour themes: toolbar, accent and desk colours (the paper itself never changes)
export const COLOR_THEMES = [['navy', 'กรมท่า', '#1E2A55', '#2F5BEA'], ['emerald', 'เขียวมรกต', '#0F4D45', '#0F8A7E'], ['grape', 'ม่วงองุ่น', '#3A2466', '#7A4FE0'], ['brick', 'ส้มอิฐ', '#5A2A16', '#E0662F'], ['sakura', 'ชมพูซากุระ', '#5C2440', '#D9487F'], ['charcoal', 'เทาถ่าน', '#26282E', '#4B5563']];
export function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (state.color && state.color !== 'navy') document.documentElement.dataset.color = state.color; else delete document.documentElement.dataset.color;
  if (state.economy) document.documentElement.dataset.economy = ''; else delete document.documentElement.dataset.economy;
  return dark;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applyTheme(); subs.forEach(f => f()); });
