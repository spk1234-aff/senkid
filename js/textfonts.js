// Fonts for text typed on the page (text boxes, text inside shapes).
// The files live in fonts/ui (SIL Open Font License, Thai + Latin subsets) and are pre-cached by the
// service worker, so they work offline, on the TV and in PDF export.
// id, menu name, file id, size-adjust (to sit at the same size as TH Sarabun New), has bold?
export const TEXT_FONTS = [
  ['sarabun', 'TH Sarabun New', null, 1, true],
  ['kanit', 'Kanit', 'kanit', 1.12, true],
  ['prompt', 'Prompt', 'prompt', 1.07, true],
  ['chakra', 'Chakra Petch', 'chakra', 1.09, true],
  ['itim', 'Itim', 'itim', 1.2, false],
  ['sriracha', 'Sriracha', 'sriracha', 1.04, false],
  ['mali', 'Mali', 'mali', 0.97, true],
  ['charm', 'Charmonman', 'charm', 1.26, true],
];
const fam = (id) => 'SenkidT-' + id;
const state = new Map(); // id -> 'loading' | 'ready' | 'fail'
const hooks = new Set();
export function onFontReady(fn) { hooks.add(fn); return () => hooks.delete(fn); }

export function fontInfo(id) { return TEXT_FONTS.find(f => f[0] === id) || TEXT_FONTS[0]; }
export function fontReady(id) { return !id || id === 'sarabun' || state.get(id) === 'ready'; }
// CSS family list for canvas / textarea
export function familyFor(id) {
  if (!id || id === 'sarabun') return '"TH Sarabun New", sans-serif';
  if (!fontReady(id)) ensureFont(id);
  return `"${fam(id)}", "TH Sarabun New", sans-serif`;
}
export function ensureFont(id) {
  if (fontReady(id)) return Promise.resolve(true);
  // a failed font is retried at most once a minute (familyFor runs on every draw)
  if (state.get(id) === 'fail' && Date.now() - (ensureFont.failAt?.get(id) || 0) < 60000) return Promise.resolve(false);
  const f = TEXT_FONTS.find(x => x[0] === id); if (!f) return Promise.resolve(false);
  if (state.get(id) === 'loading') return ensureFont.p.get(id);
  state.set(id, 'loading');
  const base = (typeof document !== 'undefined' ? document.baseURI : self.location.href);
  const load = (w) => {
    const ff = new FontFace(fam(id), `url(${new URL(`fonts/ui/${f[2]}-${w}.woff2`, base).href}) format("woff2")`, { weight: String(w), sizeAdjust: Math.round(f[3] * 100) + '%' });
    return ff.load().then(x => { document.fonts.add(x); return x; });
  };
  const p = Promise.all([load(400), f[4] ? load(700).catch(() => null) : null])
    .then(() => { state.set(id, 'ready'); for (const h of hooks) { try { h(id); } catch { } } return true; })
    .catch((e) => { console.warn('font', id, e); state.set(id, 'fail'); (ensureFont.failAt ||= new Map()).set(id, Date.now()); return false; });
  (ensureFont.p ||= new Map()).set(id, p);
  return p;
}
// every font used by these pages (text boxes and text in shapes), loaded before export
export async function ensurePageFonts(pages) {
  const ids = new Set();
  for (const p of pages) for (const s of p.strokes || []) { if (s.t === 'text' && s.f) ids.add(s.f); if (s.tx?.f) ids.add(s.tx.f); }
  await Promise.all([...ids].map(ensureFont));
}
export function fontList() { return TEXT_FONTS.map(f => f[0]); }
