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
  theme: 'auto', fingerDraw: false, shapeRecog: true, scribbleErase: true, twoPage: true, economy: false,
  showHover: true, onboarded: false,
  newNb: { bg: 'grid', orient: 'P', paper: 'cream' },
  rec: { res: '2160', mic: '', warn25: true, fps: 30 },
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
export function savePrefs() {
  clearTimeout(t);
  t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { } }, 150);
  subs.forEach(f => f());
}
export function onPrefs(f) { subs.add(f); return () => subs.delete(f); }

export function pushRecent(color) {
  const c = color.toUpperCase();
  const r = state.recent.filter(x => x.toUpperCase() !== c);
  r.unshift(c); state.recent = r.slice(0, 10); savePrefs();
}

export function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (state.economy) document.documentElement.dataset.economy = ''; else delete document.documentElement.dataset.economy;
  return dark;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applyTheme(); subs.forEach(f => f()); });
