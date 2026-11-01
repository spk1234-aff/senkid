// Offline cache for เส้นคิด. Bump VERSION on every release.
const VERSION = 'senkid-1.3.3-1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/ui.js', 'js/db.js', 'js/prefs.js', 'js/render.js', 'js/shapes.js', 'js/editor.js', 'js/penpanel.js', 'js/recorder.js', 'js/library.js', 'js/images.js', 'js/files.js', 'js/pdfdoc.js', 'js/exportpdf.js', 'js/timer.js', 'js/broadcast.js', 'js/student.js', 'student.html', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js',
  'fonts/THSarabunNew.woff', 'fonts/THSarabunNew-Bold.woff',
  'icons/favicon.svg', 'icons/favicon.ico', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('senkid-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  // network-first for navigations so updates arrive, cache-first for assets
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put('index.html', cp)); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; })));
});
