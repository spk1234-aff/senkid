// UI helpers: DOM builder, icons, toasts, dialogs, popovers
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
}

const P = {
  home: '<path d="M3.5 11.5 L12 4 L20.5 11.5 V20 a1 1 0 0 1-1 1 H14.5 V15 H9.5 V21 H4.5 a1 1 0 0 1-1-1 Z" fill="currentColor" stroke="none"/>',
  pageplus: '<path d="M6 2.5 H14.5 L19.5 7.5 V20 a1.5 1.5 0 0 1-1.5 1.5 H7.5 A1.5 1.5 0 0 1 6 20 Z" fill="currentColor" stroke="none"/><path d="M14.5 2.5 V7.5 H19.5" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.5"/><path d="M12.7 11.5 v6 M9.7 14.5 h6" stroke="var(--ico-in,#fff)" fill="none" stroke-width="2"/>',
  image: '<rect x="2.5" y="4.5" width="19" height="15" rx="3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="9.5" r="2" fill="var(--ico-in,#fff)" stroke="none"/><path d="M20 18.5 l-4.6-5.2 -3.6 3.4 -2.1-1.8 -4.2 3.6 Z" fill="var(--ico-in,#fff)" stroke="none"/>',
  crop: '<path d="M6 2 V17 a1 1 0 0 0 1 1 H22" stroke-width="2.4"/><path d="M2 6 H17 a1 1 0 0 1 1 1 V22" stroke-width="2.4"/>',
  rotate: '<path d="M20 12 a8 8 0 1 1-2.3-5.6" stroke-width="2.4"/><path d="M20 4 V9 H15" stroke-width="2.4"/>',
  layer: '<path d="M12 2.8 L21.5 8 L12 13.2 L2.5 8 Z" fill="currentColor" stroke="none"/><path d="M3.5 12.5 L12 17.2 L20.5 12.5" stroke-width="2.4"/><path d="M3.5 16.5 L12 21.2 L20.5 16.5" stroke-width="2.4" stroke-opacity=".55"/>',
  save: '<path d="M4.5 2.5 H16 L21.5 8 V19.5 a2 2 0 0 1-2 2 H4.5 a2 2 0 0 1-2-2 V4.5 a2 2 0 0 1 2-2 Z" fill="currentColor" stroke="none"/><path d="M7 2.5 v5.5 h8 V2.5" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/><rect x="7" y="13" width="10" height="8.5" rx="1" fill="var(--ico-in,#fff)" stroke="none"/>',
  lasso: '<ellipse cx="12" cy="9.5" rx="8.5" ry="5.5" stroke-dasharray="3.4 2.6" stroke-width="2.4"/><path d="M6.5 14.2 C 5 16.5 5.5 18.6 8 20" stroke-width="2.4"/>',
  laser: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8" stroke-width="2" stroke-opacity=".45"/>',
  text: '<path d="M5 7 V4.5 H19 V7" stroke-width="2.4"/><path d="M12 4.5 V20" stroke-width="2.4"/><path d="M8.5 20 H15.5" stroke-width="2.4"/>',
  timer: '<circle cx="12" cy="13.5" r="8" fill="currentColor" stroke="none"/><path d="M12 13.5 V9" stroke="var(--ico-in,#fff)" fill="none" stroke-width="2"/><path d="M9.5 2.5 H14.5" stroke-width="2.4"/>',
  screen: '<rect x="2.5" y="4" width="19" height="13" rx="2.5" fill="currentColor" stroke="none"/><path d="M8.5 20.5 H15.5 M12 17 v3.5" stroke-width="2.4"/>',
  lib: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" fill="currentColor" stroke="none"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="2" fill="currentColor" stroke="none"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2" fill="currentColor" stroke="none"/><rect x="13" y="13" width="7.5" height="7.5" rx="2" fill="currentColor" stroke="none"/>',
  pages: '<rect x="3.5" y="4.5" width="7.5" height="15" rx="2" fill="currentColor" stroke="none"/><rect x="13" y="4.5" width="7.5" height="15" rx="2" fill="currentColor" stroke="none"/>',
  undo: '<path d="M9 6 L4 11 L9 16" stroke-width="2.4"/><path d="M4 11 H14 a5 5 0 0 1 0 10 H11" stroke-width="2.4"/>',
  redo: '<path d="M15 6 L20 11 L15 16" stroke-width="2.4"/><path d="M20 11 H10 a5 5 0 0 0 0 10 H13" stroke-width="2.4"/>',
  pen: '<path d="M4 20 l1.6-5.6 L15.6 4.4 a2.4 2.4 0 0 1 3.4 3.4 L9 17.8 Z" fill="currentColor" stroke="none"/><path d="M13 7 l4 4" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/>',
  fount: '<path d="M12 21.5 L6.8 12 L8.8 3.5 H15.2 L17.2 12 Z" fill="currentColor" stroke="none"/><path d="M12 21 V13" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/><circle cx="12" cy="12" r="1.5" fill="var(--ico-in,#fff)" stroke="none"/>',
  ball: '<path d="M5.5 18.5 L16.5 7.5 a2.1 2.1 0 0 1 3 3 L8.5 21.5 H5.5 Z" fill="currentColor" stroke="none"/><path d="M5.5 18.5 l-2 2.5" stroke-width="2.4"/>',
  calli: '<path d="M6.5 20.5 L11 9 L17.5 5.5 L18.5 6.5 L15 13 L3.5 17.5 Z" fill="currentColor" stroke="none"/><path d="M11 9 l4 4" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/>',
  brush: '<path d="M14 3.5 L20.5 10 L12.5 15.5 L8.5 11.5 Z" fill="currentColor" stroke="none"/><path d="M9 12 C 5 13, 6 18, 3 20.5 C 8 21.5, 12.5 19, 12.5 15" fill="currentColor" stroke="none"/>',
  marker: '<path d="M14 3.5 L20.5 10 L11 19.5 L4.5 13 Z" fill="currentColor" stroke="none"/><path d="M4.5 13 L2.8 20.5 L11 19.5 Z" fill="currentColor" stroke="none" fill-opacity=".55"/>',
  pencil: '<path d="M4 20 l1.6-5.6 L15.6 4.4 a2.4 2.4 0 0 1 3.4 3.4 L9 17.8 Z" fill="currentColor" stroke="none"/><path d="M6 14.5 L9.5 18" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/><path d="M14 6 l4 4" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/>',
  dash: '<path d="M4 18 L8 14 M10 12 L13 9 M15 7 L19 3" stroke-width="2.4"/>',
  dot: '<circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.5" fill="currentColor" stroke="none"/>',
  hl: '<path d="M8 14 L15 5 L19.5 8.5 L12.5 17.5 Z" fill="currentColor" stroke="none"/><path d="M8 14 L6 18.5 H12.5 Z" fill="currentColor" stroke="none" fill-opacity=".55"/><path d="M4 21.5 H20" stroke-width="2.6"/>',
  eraser: '<path d="M8.5 19.5 L3.5 14.5 L13.5 4.5 L20.5 11.5 L12.5 19.5 Z" fill="currentColor" stroke="none"/><path d="M8.8 9.6 l6.6 6.6" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/><path d="M13.5 20.5 H21" stroke-width="2.4"/>',
  ruler: '<rect x="1.8" y="8.2" width="20.4" height="7.6" rx="2" transform="rotate(-35 12 12)" fill="currentColor" stroke="none"/><path transform="rotate(-35 12 12)" d="M6 8.2v3M9 8.2v2M12 8.2v3M15 8.2v2M18 8.2v3" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.5"/>',
  calc: '<rect x="4.5" y="2.5" width="15" height="19" rx="3" fill="currentColor" stroke="none"/><rect x="7.5" y="5.5" width="9" height="4" rx="1" fill="var(--ico-in,#fff)" stroke="none"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 17h.01M12 17h.01M15.5 17h.01" stroke="var(--ico-in,#fff)" fill="none" stroke-width="2.6" stroke-linecap="round"/>',
  cloud: '<path d="M7 18.5 a4.2 4.2 0 0 1 -.5 -8.4 A5.8 5.8 0 0 1 17.5 8.3 a4 4 0 0 1 .3 10.2 Z" fill="currentColor" stroke="none"/>',
  sync: '<path d="M20 11 a8 8 0 0 0 -14.5 -3.5 M4 13 a8 8 0 0 0 14.5 3.5 M4 4 v5 h5 M20 20 v-5 h-5" stroke-width="2.4"/>',
  user: '<circle cx="12" cy="7.5" r="4.2" fill="currentColor" stroke="none"/><path d="M4 21 c0-4.5 3.5-7.5 8-7.5 s8 3 8 7.5 Z" fill="currentColor" stroke="none"/>',
  curtain: '<rect x="3.5" y="3" width="17" height="18" rx="2.5" fill="currentColor" stroke="none"/><path d="M3.5 12 H20.5" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/><path d="M4.5 12.5 H19.5 V18.5 a2 2 0 0 1 -2 2 H6.5 a2 2 0 0 1 -2 -2 Z" fill="var(--ico-in,#fff)" stroke="none" fill-opacity=".35"/><path d="M9.8 9 L12 6.8 L14.2 9" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/>',
  equation: '<rect x="2.5" y="3" width="19" height="18" rx="4" fill="currentColor" stroke="none"/><path d="M6 8 H11 L8.5 12 L11 16 H6" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/><path d="M13.5 10.5 l4 4 M17.5 10.5 l-4 4" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/>',
  graph: '<path d="M4 20 V4 M4 20 H20" stroke-width="2.4"/><path d="M6 17 C 9 6, 12 6, 14 11 S 18 16, 19 7" stroke-width="2.4"/>',
  protractor: '<path d="M2.5 17.5 A9.5 9.5 0 0 1 21.5 17.5 Z" fill="currentColor" stroke="none"/><path d="M12 17 L12 12.5 M7 13 l1.6 1.4 M17 13 l-1.6 1.4" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/>',
  compass: '<path d="M12 3 V6 M12 6 L7 20 M12 6 L17 20" stroke-width="2.4"/><circle cx="12" cy="6" r="2" fill="currentColor" stroke="none"/>',
  shrect: '<rect x="4.5" y="5.5" width="15" height="13" rx="1.5" stroke-width="2.3"/>',
  shellipse: '<circle cx="12" cy="12" r="7.5" stroke-width="2.3"/>',
  shtri: '<path d="M12 4.5 L20 19 H4 Z" stroke-width="2.3"/>',
  shdiamond: '<path d="M12 3.5 L20.5 12 L12 20.5 L3.5 12 Z" stroke-width="2.3"/>',
  shpill: '<rect x="3.5" y="7" width="17" height="10" rx="5" stroke-width="2.3"/>',
  shline: '<path d="M5 19 L19 5" stroke-width="2.4"/>',
  sharrow: '<path d="M5 19 L19 5 M11 5 H19 V13" stroke-width="2.4"/>',
  shelbow: '<path d="M5 6 H12 V18 H17 M14.5 15.5 L17 18 L14.5 20.5" stroke-width="2.4"/>',
  shcurve: '<path d="M4.5 18 C 6 8, 15 16, 17.5 6 M14.5 7.6 L17.5 5.5 L19.2 8.8" stroke-width="2.4"/>',
  shround: '<path d="M5 19 V11 a6 6 0 0 1 6 -6 H19" stroke-width="2.4"/>',
  magic: '<path d="M4 20 L14 10" stroke-width="2.4"/><path d="M16.5 3 l1 2.5 2.5 1 -2.5 1 -1 2.5 -1-2.5 -2.5-1 2.5-1 Z" fill="currentColor" stroke="none"/><path d="M9.5 3 l.7 1.8 1.8.7 -1.8.7 -.7 1.8 -.7-1.8 -1.8-.7 1.8-.7 Z" fill="currentColor" stroke="none"/><path d="M19.5 10 l.6 1.4 1.4.6 -1.4.6 -.6 1.4 -.6-1.4 -1.4-.6 1.4-.6 Z" fill="currentColor" stroke="none"/>',
  sticker: '<path d="M20.5 12.5 A8.5 8.5 0 1 1 11.5 3.5 H13 a7.5 7.5 0 0 0 7.5 7.5 Z" fill="currentColor" stroke="none"/><path d="M8.3 13.2 c1.9 2.2 5.5 2.2 7.4 0" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/><circle cx="9" cy="9.5" r="1.1" fill="var(--ico-in,#fff)" stroke="none"/><circle cx="13.3" cy="9.5" r="1.1" fill="var(--ico-in,#fff)" stroke="none"/>',
  shape: '<circle cx="9" cy="9" r="5.8" fill="currentColor" stroke="none"/><rect x="10.5" y="10.5" width="10" height="10" rx="2.2" fill="currentColor" stroke="none" fill-opacity=".6"/>',
  more: '<circle cx="5.5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="6.5" stroke-width="2.4"/><path d="M16 16 l4.5 4.5" stroke-width="2.4"/>',
  plus: '<path d="M12 5 V19 M5 12 H19" stroke-width="2.4"/>',
  folder: '<path d="M2.5 7 a2 2 0 0 1 2-2 h4.5 l2 2 h8.5 a2 2 0 0 1 2 2 v8.5 a2 2 0 0 1-2 2 H4.5 a2 2 0 0 1-2-2 Z" fill="currentColor" stroke="none"/>',
  gear: '<path d="M10.3 2.5 h3.4 l.5 2.4 1.6.7 2.1-1.4 2.4 2.4 -1.4 2.1 .7 1.6 2.4.5 v3.4 l-2.4.5 -.7 1.6 1.4 2.1 -2.4 2.4 -2.1-1.4 -1.6.7 -.5 2.4 h-3.4 l-.5-2.4 -1.6-.7 -2.1 1.4 -2.4-2.4 1.4-2.1 -.7-1.6 -2.4-.5 v-3.4 l2.4-.5 .7-1.6 -1.4-2.1 2.4-2.4 2.1 1.4 1.6-.7 Z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="3" fill="var(--ico-in,#fff)" stroke="none"/>',
  close: '<path d="M6 6 L18 18 M18 6 L6 18" stroke-width="2.4"/>',
  back: '<path d="M15 6 l-6 6 6 6" stroke-width="2.4"/>',
  scissors: '<circle cx="6" cy="7" r="3" stroke-width="2.4"/><circle cx="6" cy="17" r="3" stroke-width="2.4"/><path d="M8.6 8.6 L20 18 M8.6 15.4 L20 6" stroke-width="2.4"/>',
  dup: '<rect x="8" y="8" width="12.5" height="12.5" rx="2.5" fill="currentColor" stroke="none"/><path d="M16 7 V5.5 a2 2 0 0 0-2-2 H5.5 a2 2 0 0 0-2 2 V14 a2 2 0 0 0 2 2 H7" stroke-width="2.4"/><path d="M14.2 11 v6.5 M11 14.2 h6.5" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.8"/>',
  expand: '<path d="M3 12 H21" stroke-width="2.4"/><path d="M7 8 L3 12 L7 16" stroke-width="2.4"/><path d="M17 8 L21 12 L17 16" stroke-width="2.4"/>',
  palette: '<path d="M12 2.5 a9.5 9.5 0 1 0 0 19 c1.5 0 2.1-1 1.7-2.2 -.5-1.4.4-2.5 1.9-2.5 H18 a3.2 3.2 0 0 0 3.2-3.2 C21.5 6.8 17.2 2.5 12 2.5 Z" fill="currentColor" stroke="none"/><circle cx="7.3" cy="11" r="1.5" fill="var(--ico-in,#fff)" stroke="none"/><circle cx="10.3" cy="6.8" r="1.5" fill="var(--ico-in,#fff)" stroke="none"/><circle cx="15.2" cy="7.3" r="1.5" fill="var(--ico-in,#fff)" stroke="none"/>',
  mic: '<rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor" stroke="none"/><path d="M5 11 a7 7 0 0 0 14 0 M12 18 V21.5 M8.5 21.5 H15.5" stroke-width="2.4"/>',
  chev: '<path d="M9 6 l6 6 -6 6" stroke-width="2.4"/>',
  down: '<path d="M6 9 l6 6 6-6" stroke-width="2.4"/>',
  up: '<path d="M6 15 l6-6 6 6" stroke-width="2.4"/>',
  pause: '<rect x="6" y="5" width="4.5" height="14" rx="1.5" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5" fill="currentColor" stroke="none"/>',
  play: '<path d="M7.5 5 L19.5 12 L7.5 19 Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8" y="8" width="12.5" height="12.5" rx="2.5" fill="currentColor" stroke="none"/><path d="M16 7 V5.5 a2 2 0 0 0-2-2 H5.5 a2 2 0 0 0-2 2 V14 a2 2 0 0 0 2 2 H7" stroke-width="2.4"/>',
  trash: '<path d="M3.5 7 H20.5" stroke-width="2.4"/><path d="M9 7 V4.5 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 1 1 V7" stroke-width="2.4"/><path d="M5.5 9 H18.5 L17.6 20 a1.5 1.5 0 0 1-1.5 1.4 H7.9 A1.5 1.5 0 0 1 6.4 20 Z" fill="currentColor" stroke="none"/><path d="M10 12 v6 M14 12 v6" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/>',
  download: '<path d="M12 4 v11 M7 10 l5 5 5-5 M5 20 h14" stroke-width="2.4"/>',
  upload: '<path d="M12 20 V9 M7 14 l5-5 5 5 M5 4 h14" stroke-width="2.4"/>',
  share: '<path d="M12 3 v12 M7 8 l5-5 5 5" stroke-width="2.4"/><path d="M5 12 v7 a2 2 0 0 0 2 2 h10 a2 2 0 0 0 2-2 v-7" stroke-width="2.4"/>',
  sun: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/><path d="M12 2 v2 M12 20 v2 M2 12 h2 M20 12 h2 M5 5 l1.4 1.4 M17.6 17.6 L19 19 M5 19 l1.4-1.4 M17.6 6.4 L19 5" stroke-width="2.4"/>',
  moon: '<path d="M20.5 14.5 A8.5 8.5 0 1 1 9.5 3.5 a6.8 6.8 0 0 0 11 11 Z" fill="currentColor" stroke="none"/>',
  hide: '<path d="M6 15 l6-6 6 6" stroke-width="2.4"/>',
  show: '<path d="M6 9 l6 6 6-6" stroke-width="2.4"/>',
  hand: '<path d="M8 13 V6 a1.5 1.5 0 0 1 3 0 V12 M11 11 V4.5 a1.5 1.5 0 0 1 3 0 V12 M14 11 V6 a1.5 1.5 0 0 1 3 0 V14 a6 6 0 0 1-6 6 h-1 a6 6 0 0 1-5-3 L3.5 13 a1.5 1.5 0 0 1 2.5-1.6 L8 14" stroke-width="2.4"/>',
  film: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="currentColor" stroke="none"/><path d="M7 4.5 v15 M17 4.5 v15" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.5"/><path d="M4.5 9 h2.5 M4.5 15 h2.5 M17 9 h2.5 M17 15 h2.5" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.5"/><path d="M10.5 9.5 L14.5 12 L10.5 14.5 Z" fill="var(--ico-in,#fff)" stroke="none"/>',
  check: '<path d="M5 12 l4.5 4.5 L19 7" stroke-width="2.4"/>',
  edit: '<path d="M3.5 20.5 h4.5 L19.5 9 l-4.5-4.5 L3.5 16 Z" fill="currentColor" stroke="none"/><path d="M13 6.5 l4.5 4.5" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.6"/>',
  bg: '<rect x="3.5" y="2.5" width="17" height="19" rx="2.5" fill="currentColor" stroke="none"/><path d="M3.5 8 h17 M3.5 13 h17 M9 2.5 v19" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.5"/>',
  help: '<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="M9.3 9.5 a2.7 2.7 0 1 1 3.8 2.5 c-.8.3-1.1 1-1.1 1.8 V14.3" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.8"/><circle cx="12" cy="17.3" r="1.1" fill="var(--ico-in,#fff)" stroke="none"/>',
  fit: '<path d="M4 9 V4 H9 M20 9 V4 H15 M4 15 V20 H9 M20 15 V20 H15" stroke-width="2.4"/>',
  star: '<path d="M12 2.8 l2.8 6 6.5.8 -4.8 4.5 1.3 6.5 -5.8-3.3 -5.8 3.3 1.3-6.5 -4.8-4.5 6.5-.8 Z" fill="currentColor" stroke="none"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4.5" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.7" fill="var(--ico-in,#fff)" stroke="none"/><circle cx="16" cy="8" r="1.7" fill="var(--ico-in,#fff)" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="var(--ico-in,#fff)" stroke="none"/><circle cx="8" cy="16" r="1.7" fill="var(--ico-in,#fff)" stroke="none"/><circle cx="16" cy="16" r="1.7" fill="var(--ico-in,#fff)" stroke="none"/>',
  pdf: '<path d="M6 2.5 H14.5 L19.5 7.5 V20 a1.5 1.5 0 0 1-1.5 1.5 H7.5 A1.5 1.5 0 0 1 6 20 Z" fill="currentColor" stroke="none"/><path d="M14.5 2.5 V7.5 H19.5" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.5"/><path d="M8.6 17 V11.5 h2 a1.6 1.6 0 0 1 0 3.2 h-2 M13.2 17 V11.5 h1.4 a2.75 2.75 0 0 1 0 5.5 Z" stroke="var(--ico-in,#fff)" fill="none" stroke-width="1.4"/>',
  rec: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
};
export const icon = (n, cls = 'i') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.innerHTML = P[n] || ''; return s;
};

export function toast(msg, ms = 2400, cls = '') {
  const t = h('div', { class: 'toast ' + cls }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
}

const layer = () => document.getElementById('layer');

// Generic popover anchored to element. returns close fn
export function popover(anchor, content, { cls = '', onClose, place = 'auto', clearScrim = true } = {}) {
  const scrim = h('div', { class: 'scrim' + (clearScrim ? ' clear' : '') });
  const box = h('div', { class: 'pop ' + cls }, content);
  let closed = false;
  const close = () => { if (closed) return; closed = true; scrim.remove(); box.remove(); onClose && onClose(); };
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
  layer().append(scrim, box);
  const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2, width: 0, height: 0 };
  const bw = box.offsetWidth, bh = box.offsetHeight, m = 8, vw = innerWidth, vh = innerHeight;
  let x, y;
  const spaceBelow = vh - r.bottom, spaceRight = vw - r.right;
  if (place === 'side') {
    x = r.left > vw / 2 ? r.left - bw - m : r.right + m; y = r.top - 20;
  } else {
    x = r.left + r.width / 2 - bw / 2;
    y = spaceBelow >= bh + m || spaceBelow > r.top ? r.bottom + m : r.top - bh - m;
  }
  x = Math.max(m, Math.min(vw - bw - m, x)); y = Math.max(m, Math.min(vh - bh - m, y));
  box.style.left = x + 'px'; box.style.top = y + 'px';
  box._close = close;
  return close;
}

export function menu(anchor, items, opts = {}) {
  let close;
  const box = h('div', { class: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { box.append(h('hr')); continue; }
    if (it.header) { box.append(h('div', { class: 'mh' }, it.header)); continue; }
    const b = h('button', { class: 'mi' + (it.danger ? ' danger' : '') },
      it.icon ? icon(it.icon) : null, h('span', {}, it.label), it.right ? h('span', { class: 'r' }, it.right) : null);
    b.addEventListener('click', () => { if (!it.keep) close(); it.action && it.action(b); });
    box.append(b);
  }
  close = popover(anchor, box, opts);
  return close;
}

export function dialog(title, body, buttons = [], { onClose, width, noClose } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const d = h('div', { class: 'dialog', style: width ? { width: `min(${width}px, calc(100vw - 24px))` } : null });
  let closed = false;
  const close = (v) => { if (closed) return; closed = true; scrim.remove(); d.remove(); onClose && onClose(v); };
  const head = h('div', { class: 'head' }, h('div', { class: 'h' }, title));
  if (!noClose) { const x = h('button', { class: 'btn sq' }, icon('close')); x.onclick = () => close(); head.append(x); }
  d.append(head, body);
  if (buttons.length) {
    const f = h('div', { class: 'foot' });
    for (const b of buttons) {
      const el = h('button', { class: 'pill ' + (b.cls || 'sec'), style: b.flex ? { flex: b.flex } : null }, b.icon ? icon(b.icon) : null, b.label);
      el.onclick = async () => { const r = b.action ? await b.action(el) : undefined; if (r !== false) close(b.value ?? r); };
      f.append(el); b.el = el;
    }
    d.append(f);
  }
  if (!noClose) scrim.addEventListener('pointerdown', () => close());
  layer().append(scrim, d);
  d._close = close;
  return { el: d, close };
}

export function ask(title, { value = '', placeholder = '', ok = 'ตกลง' } = {}) {
  return new Promise((res) => {
    const inp = h('input', { class: 'field', type: 'text', value, placeholder });
    let result = null;
    const dg = dialog(title, inp, [{ label: 'ยกเลิก' }, { label: ok, cls: 'prim', flex: 2, action: () => { result = inp.value.trim(); } }], { onClose: () => res(result) });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = inp.value.trim(); dg.close(); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 60);
  });
}

export function confirmBox(title, text, { ok = 'ตกลง', danger = false } = {}) {
  return new Promise((res) => {
    let r = false;
    dialog(title, h('p', { style: { margin: '4px 0 0', color: 'var(--muted)' } }, text),
      [{ label: 'ยกเลิก' }, { label: ok, cls: danger ? 'danger' : 'prim', flex: 2, action: () => { r = true; } }], { onClose: () => res(r) });
  });
}

export function toggle(on, onChange) {
  const t = h('button', { class: 'tog' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false' });
  t.addEventListener('click', () => { const v = !t.classList.contains('on'); t.classList.toggle('on', v); t.setAttribute('aria-checked', v); onChange(v); });
  return t;
}

export function seg(options, value, onChange) {
  const s = h('div', { class: 'seg' });
  for (const [v, label] of options) {
    const b = h('button', { class: v === value ? 'on' : '' }, label);
    b.onclick = () => { $$('button', s).forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(v); };
    s.append(b);
  }
  return s;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function pickFile(accept, { hint } = {}) {
  // iPad: the system file picker can take a while to appear and to copy the file (iCloud) — show a message the whole time
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept, style: { display: 'none' } });
    let done = false, ov = null;
    const msg = h('div', { class: 'busy-msg' }, 'กำลังเปิดหน้าเลือกไฟล์…');
    const sub = h('div', { class: 'busy-sub' }, hint || 'เลือกไฟล์ในหน้าต่างของเครื่อง');
    const cancel = h('button', { class: 'pill sec', style: { marginTop: '14px', height: '42px' } }, 'ยกเลิก');
    const finish = (f) => { if (done) return; done = true; ov?.remove(); window.removeEventListener('focus', onFocus); i.remove(); res(f); };
    const onFocus = () => setTimeout(() => { if (done) return; msg.textContent = 'กำลังโหลดไฟล์จากเครื่อง…'; sub.textContent = 'ไฟล์ใหญ่ หรือไฟล์ที่อยู่บน iCloud / Drive อาจใช้เวลาสักครู่'; }, 400);
    cancel.onclick = () => finish(null);
    i.onchange = () => finish(i.files[0] || null);
    i.addEventListener('cancel', () => finish(null));
    window.addEventListener('focus', onFocus);
    document.body.append(i);
    ov = h('div', { class: 'busy picking' }, h('div', { class: 'busy-box' }, h('div', { class: 'spin' }), msg, sub, cancel));
    setTimeout(() => { if (!done) document.body.append(ov); }, 250);
    i.click();
  });
}

export function fmtBytes(b) {
  if (b == null || isNaN(b)) return '–';
  if (b >= 1e9) return (b / 1e9).toFixed(b >= 1e10 ? 0 : 1) + ' GB';
  if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' KB';
}
// Thai has no spaces, so browsers break lines by dictionary and can split a proper noun ("โซ่พิสัย / พิทยาคม").
// nobr() glues every grapheme of a name with WORD JOINER (U+2060); spaces stay breakable, so wrapping happens between names only.
const CLUSTER = /\P{M}\p{M}*/gu;
export function nobr(s) { return String(s).split(' ').map(w => (w.match(CLUSTER) || [w]).join('\u2060')).join(' '); }
export function fmtTime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), hh = Math.floor(m / 60);
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(m % 60)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function fmtDate(t) {
  const d = new Date(t), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'เมื่อสักครู่';
  if (diff < 3600) return Math.floor(diff / 60) + ' นาทีที่แล้ว';
  if (d.toDateString() === now.toDateString()) return Math.floor(diff / 3600) + ' ชม. ที่แล้ว';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'เมื่อวาน';
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + (d.getFullYear() + 543) : ''}`;
}
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// long press helper
export function onLongPress(el, fn, ms = 500) {
  let t = null, sx = 0, sy = 0, fired = false;
  el.addEventListener('pointerdown', (e) => { fired = false; sx = e.clientX; sy = e.clientY; t = setTimeout(() => { fired = true; fn(e); }, ms); });
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', cancel); el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function brandWord(size = 34) {
  const w = h('div', { class: 'brand-word', style: { fontSize: size + 'px' } });
  w.innerHTML = `<span class="ins"><span class="e">เ</span><svg class="caret" viewBox="0 0 20 18"><path d="M2 16 L10 3 L18 16" stroke="var(--acc)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span style="position:relative">สิ้น<svg class="strike" viewBox="0 0 40 24"><path d="M3 18 C 12 10, 22 16, 37 4" stroke="#E5484D" stroke-width="4.2" fill="none" stroke-linecap="round"/><path d="M5 9 C 15 14, 25 6, 35 16" stroke="#E5484D" stroke-width="4.2" fill="none" stroke-linecap="round"/></svg></span></span>คิด`;
  return w;
}
export function logoMark(size = 44) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.innerHTML = '<rect width="64" height="64" rx="14" fill="#2F5BEA"/><path d="M19 12 H45 V29 L32 53 L19 29 Z" fill="#fff"/><path d="M32 31 V50" stroke="#2F5BEA" stroke-width="3.4" stroke-linecap="round"/><circle cx="32" cy="29" r="4.2" fill="#2F5BEA"/><rect x="19" y="12" width="26" height="6" fill="#F5B83D"/>';
  return s;
}

// Blocking "please wait" box with message and optional progress (0..1)
let busyEl = null, busyCount = 0;
export function busy(msg, sub) {
  busyCount++;
  if (!busyEl) {
    busyEl = h('div', { class: 'busy' }, h('div', { class: 'busy-box' }, h('div', { class: 'spin' }), h('div', { class: 'busy-msg' }), h('div', { class: 'busy-sub' }), h('div', { class: 'busy-bar' }, h('i'))));
    document.body.append(busyEl);
  }
  const box = busyEl;
  const api = {
    set(m, s, pct) {
      if (m != null) box.querySelector('.busy-msg').textContent = m;
      box.querySelector('.busy-sub').textContent = s || '';
      const bar = box.querySelector('.busy-bar');
      if (pct == null) bar.style.display = 'none'; else { bar.style.display = ''; bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%'; }
    },
    done() { if (api._done) return; api._done = true; busyCount = Math.max(0, busyCount - 1); if (!busyCount && busyEl) { busyEl.remove(); busyEl = null; } },
  };
  api.set(msg, sub, null);
  return api;
}
// run an async job with the busy box
export async function withBusy(msg, fn) { const b = busy(msg); try { return await fn(b); } finally { b.done(); } }

// iPad: navigator.share must run straight from a tap — after a long build, ask for one more tap
export function shareFileDialog(file, { title = 'ไฟล์พร้อมแล้ว', sub = '', label } = {}) {
  const mb = Math.max(0.1, Math.round(file.size / 1e5) / 10);
  const go = h('button', { class: 'pill prim', style: { height: '46px', width: '100%' } }, icon('share'), label || `แชร์ / บันทึกไฟล์ (${mb} MB)`);
  const dg = dialog(title, h('div', {}, sub ? h('p', { class: 'sub', style: { margin: '0 0 10px' } }, sub) : null, go), [{ label: 'ปิด' }], { width: 480 });
  return new Promise((res) => {
    go.onclick = async () => {
      try { await navigator.share({ files: [file], title: file.name }); dg.close(); res('shared'); }
      catch (e) { if (e.name === 'AbortError') return; downloadBlob(file, file.name); dg.close(); res('downloaded'); }
    };
  });
}

// Free dragging of floating bars. iPad: finger and Apple Pencil both arrive as touch events, which we take over
// completely (preventDefault) so Safari never turns the move into a scroll or cancels it. Mouse/trackpad: pointer events.
// Dragging starts right away on the grip, or anywhere on the element once the finger has moved `threshold` px
// (so a plain tap still presses the button underneath).
export function makeDraggable(el, { grip = null, threshold = 10, onStart, onMove, onEnd } = {}) {
  let a = null;
  const begin = (x, y) => { a.started = true; el.classList.add('dragging'); el._dragged = true; onStart?.(a.sx, a.sy); onMove?.(x, y); };
  const start = (x, y, target) => { a = { sx: x, sy: y, started: false }; if (grip && grip.contains(target)) begin(x, y); };
  const move = (x, y) => { if (!a) return false; if (!a.started) { if (Math.hypot(x - a.sx, y - a.sy) < threshold) return false; begin(x, y); } else onMove?.(x, y); return true; };
  const end = () => { if (!a) return; const st = a.started; a = null; el.classList.remove('dragging'); if (st) { onEnd?.(); setTimeout(() => { el._dragged = false; }, 0); } };
  el.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { end(); return; } const t = e.touches[0]; start(t.clientX, t.clientY, e.target); if (a?.started) e.preventDefault(); }, { passive: false });
  el.addEventListener('touchmove', (e) => { if (!a || e.touches.length !== 1) return; const t = e.touches[0]; if (move(t.clientX, t.clientY)) e.preventDefault(); }, { passive: false });
  el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    start(e.clientX, e.clientY, e.target); if (a?.started) e.preventDefault();
    const mv = (ev) => move(ev.clientX, ev.clientY), up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); end(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
  // a drag must not end in a button press
  el.addEventListener('click', (e) => { if (el._dragged) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}
