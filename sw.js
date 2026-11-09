// Offline cache for เส้นคิด. Bump VERSION on every release.
const VERSION = 'senkid-1.9.72-1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/ui.js', 'js/db.js', 'js/prefs.js', 'js/render.js', 'js/shapes.js', 'js/editor.js', 'js/penpanel.js', 'js/recorder.js', 'js/mp4fix.js', 'js/stickers.js', 'js/fonts.js', 'js/mathtools.js', 'js/calculator.js', 'js/sync.js', 'js/tools-draw.js', 'js/library.js', 'js/images.js', 'js/files.js', 'js/pdfdoc.js', 'js/exportpdf.js', 'js/timer.js', 'js/broadcast.js', 'js/picker.js', 'js/lesson.js', 'js/worksheet.js', 'js/recover.js', 'js/lock.js', 'js/config.js', 'js/papers.js', 'js/copypages.js', 'js/cut.js', 'js/exportq.js', 'js/youtube.js', 'js/split.js', 'js/problems.js', 'js/stats.js', 'js/hub.js', 'js/makevideo.js', 'js/i18n.js', 'i18n/en.json', 'manifest-student.webmanifest', 'vendor/qrcode.esm.js', 'img/dev.jpg', 'js/pair.js', 'js/student.js', 'student.html', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js',
  'fonts/THSarabunNew.woff', 'fonts/THSarabunNew-Bold.woff',
  'fonts/ui/kanit-400.woff2', 'fonts/ui/kanit-700.woff2', 'fonts/ui/prompt-400.woff2', 'fonts/ui/prompt-700.woff2', 'fonts/ui/chakra-400.woff2', 'fonts/ui/chakra-700.woff2', 'fonts/ui/itim-400.woff2', 'fonts/ui/sriracha-400.woff2', 'fonts/ui/mali-400.woff2', 'fonts/ui/mali-700.woff2', 'fonts/ui/charm-400.woff2', 'fonts/ui/charm-700.woff2', 'js/textfonts.js', 'js/titlecard.js', 'js/videolib.js',
  'icons/favicon.svg', 'icons/favicon.ico', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png',
];
// install never fails because of one slow/missing file (slow hotspot): missing files are fetched later on demand
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => fetch(u, { cache: 'no-cache' }).then(r => { if (r.ok) return c.put(u, r); })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('senkid-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// copy of a response without the "redirected" flag
async function plain(r) {
  if (!r.redirected) return r;
  const body = await r.blob();
  return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
}
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  if (req.cache === 'no-store' || url.searchParams.has('fresh')) return; // version checks go straight to the network
  // pages: answer from the offline copy at once (fast on a slow hotspot) and refresh it in the background.
  if (req.mode === 'navigate') {
    // which page: the app shell (./ or index.html) or another page such as student.html
    const base = new URL('./', self.registration.scope).pathname, path = url.pathname;
    const key = (path === base || path === base.replace(/\/$/, '') || path.endsWith('/index.html')) ? 'index.html' : path.slice(base.length);
    const net = fetch(req).then(async (r) => {
      if (r.ok) { const clean = await plain(r.clone()); const c = await caches.open(VERSION); await c.put(key, clean); }
      return r;
    });
    e.waitUntil(net.then(() => { }, () => { })); // must be called synchronously (Safari)
    e.respondWith(caches.match(key).then(async (hit) => {
      if (hit) return plain(hit); // Safari refuses "redirected" responses for pages
      try { return await net; } catch { return caches.match(key); }
    }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; })));
});
