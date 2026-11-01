// Student screen: shows only the paper, synced live from the teacher window (BroadcastChannel)
import { dims, drawPaper, drawStrokes, drawStroke, drawLaserTrail, PAPERS, STRIDE } from './render.js';
import { setPdfReadyHook } from './pdfdoc.js';
import { setImageReadyHook } from './images.js';

const cv = document.getElementById('cv'), ctx = cv.getContext('2d', { alpha: false });
const wait = document.getElementById('wait'), tm = document.getElementById('tm'), tmf = document.getElementById('tmf'), ov = document.getElementById('ov');
const ch = new BroadcastChannel('senkid-live');
const pages = new Map();
let nb = null, view = null, live = null, laser = [], laserHead = false, paper = 'cream', dirty = true, lastMsg = 0;

function size() { const d = Math.min(3, devicePixelRatio || 1); cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); dirty = true; }
addEventListener('resize', size); size();
setPdfReadyHook(() => dirty = true); setImageReadyHook(() => dirty = true);

ch.onmessage = (e) => {
  const m = e.data; if (!m) return; lastMsg = performance.now();
  if (m.type === 'meta') { if (m.nb !== nb) { nb = m.nb; pages.clear(); } paper = m.paper || paper; dirty = true; }
  else if (m.type === 'view') {
    if (m.nb !== nb) { nb = m.nb; pages.clear(); }
    view = m; paper = m.paper || paper;
    const need = m.vis.filter(id => !pages.has(id)); if (need.length) ch.postMessage({ type: 'need', pids: need });
    wait.style.display = 'none'; dirty = true;
  } else if (m.type === 'page') { if (m.nb === nb) { for (const s of m.page.strokes) if (s.pts && !(s.pts instanceof Float32Array)) s.pts = Float32Array.from(s.pts); pages.set(m.page.id, m.page); dirty = true; } }
  else if (m.type === 'live') { live = m.s ? { pid: m.pid, s: m.s } : null; dirty = true; }
  else if (m.type === 'laser') { laser = m.pts || []; laserHead = !!m.head; dirty = true; }
  else if (m.type === 'timer') timer(m.st);
};
ch.postMessage({ type: 'hello' });
setInterval(() => ch.postMessage({ type: 'alive' }), 1500);
setInterval(() => { if (performance.now() - lastMsg > 6000 && view) { wait.style.display = 'flex'; wait.querySelector('p').textContent = 'ขาดการเชื่อมต่อกับหน้าจอครู · เปิดเส้นคิดค้างไว้ในเบราว์เซอร์เดียวกัน'; } }, 2000);

function transform() {
  const W = innerWidth, H = innerHeight;
  let x0, y0, x1, y1;
  if (view.mode === 'page' && view.cur && view.rects[view.cur]) { const r = view.rects[view.cur]; x0 = r.x; y0 = r.y; x1 = r.x + r.w; y1 = r.y + r.h; }
  else[x0, y0, x1, y1] = view.world;
  const pad = view.mode === 'page' ? 12 : 0;
  const z = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0));
  return { z, ox: (W - (x1 - x0) * z) / 2 - x0 * z, oy: (H - (y1 - y0) * z) / 2 - y0 * z };
}
function frame() {
  requestAnimationFrame(frame);
  if (!dirty || !view) return; dirty = laser.length > 0;
  const d = cv.width / innerWidth, T = transform();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0B0C0E'; ctx.fillRect(0, 0, cv.width, cv.height);
  const dark = !!PAPERS[paper]?.dark;
  for (const id of view.vis) {
    const r = view.rects[id], p = pages.get(id); if (!r) continue;
    const k = T.z * d;
    ctx.setTransform(k, 0, 0, k, (T.ox + r.x * T.z) * d, (T.oy + r.y * T.z) * d);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, r.w, r.h); ctx.clip();
    if (p) { drawPaper(ctx, p, paper, k); drawStrokes(ctx, p, k, dark); if (live && live.pid === id) drawStroke(ctx, live.s, k, dark, false); }
    else { ctx.fillStyle = PAPERS[paper]?.fill || '#fff'; ctx.fillRect(0, 0, r.w, r.h); }
    ctx.restore();
  }
  if (laser.length) {
    ctx.setTransform(d, 0, 0, d, 0, 0);
    drawLaserTrail(ctx, laser.map(p => ({ x: T.ox + p.x * T.z, y: T.oy + p.y * T.z, a: p.a })), laserHead);
  }
}
requestAnimationFrame(frame);

function timer(st) {
  if (!st || st.view === 'hidden') { tm.style.display = 'none'; tmf.style.display = 'none'; return; }
  if (st.view === 'full') {
    tm.style.display = 'none'; tmf.style.display = 'flex';
    tmf.querySelector('.t').textContent = st.text; tmf.querySelector('.t').style.color = st.color || '#fff';
    tmf.querySelector('.l').textContent = st.label || (st.mode === 'down' ? 'นับถอยหลัง' : 'จับเวลา');
    const b = tmf.querySelector('.b i'); b.style.width = (st.mode === 'down' ? st.progress * 100 : 100) + '%'; b.style.background = st.color || '#2F5BEA';
    tmf.classList.toggle('done', !!st.done && !st.running);
  } else {
    tmf.style.display = 'none'; tm.style.display = 'block';
    tm.textContent = st.text; tm.style.color = st.color || '#fff'; tm.style.fontSize = Math.round(9 * Math.max(.8, st.scale || 1)) + 'vh';
    tm.classList.toggle('done', !!st.done && !st.running);
  }
}

// tap to reveal the fullscreen button
let ovT;
addEventListener('pointerdown', () => { ov.style.display = 'flex'; clearTimeout(ovT); ovT = setTimeout(() => ov.style.display = 'none', 3500); });
document.getElementById('fs').onclick = (e) => { e.stopPropagation(); const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); ov.style.display = 'none'; };
