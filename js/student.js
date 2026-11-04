// Student screen: shows only the paper, synced live from the teacher window (BroadcastChannel)
import { dims, drawPaper, drawStrokes, drawStroke, drawLaserTrail, drawCurtain, PAPERS, STRIDE } from './render.js';
import { setPdfReadyHook } from './pdfdoc.js';
import { drawRulerAt, drawProtractorAt } from './tools-draw.js';
import { setImageReadyHook } from './images.js';

const cv = document.getElementById('cv'), ctx = cv.getContext('2d', { alpha: false });
const wait = document.getElementById('wait'), tm = document.getElementById('tm'), tmf = document.getElementById('tmf'), ov = document.getElementById('ov');
const ch = new BroadcastChannel('senkid-live');
let rtc = null; const send = (m) => { try { ch.postMessage(m); } catch { } if (rtc?.open) rtc.send(m); };
const pages = new Map();
let tools = {}, nb = null, view = null, live = null, laser = [], laserHead = false, laserOpt = {}, paper = 'cream', dirty = true, lastMsg = 0;

function size() { const d = Math.min(3, devicePixelRatio || 1); cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); dirty = true; }
addEventListener('resize', size); size();
setPdfReadyHook(() => dirty = true); setImageReadyHook(() => dirty = true);

const onMsg = (m) => {
  if (!m) return; lastMsg = performance.now(); window.__senkidLast = lastMsg;
  if (m.type === 'meta') { if (m.nb !== nb) { nb = m.nb; pages.clear(); } paper = m.paper || paper; dirty = true; }
  else if (m.type === 'view') {
    if (m.nb !== nb) { nb = m.nb; pages.clear(); }
    view = m; paper = m.paper || paper;
    const need = m.vis.filter(id => !pages.has(id)); if (need.length) send({ type: 'need', pids: need });
    wait.style.display = 'none'; dirty = true;
  } else if (m.type === 'page') { if (m.nb === nb) { for (const s of m.page.strokes) if (s.pts && !(s.pts instanceof Float32Array)) s.pts = Float32Array.from(s.pts); pages.set(m.page.id, m.page); dirty = true; } }
  else if (m.type === 'live') { live = m.s ? { pid: m.pid, s: m.s } : null; dirty = true; }
  else if (m.type === 'laser') { laser = m.pts || []; laserHead = !!m.head; laserOpt = m.opt || laserOpt; dirty = true; }
  else if (m.type === 'timer') timer(m.st);
  else if (m.type === 'tools') { tools = m; dirty = true; calcShow(m.calc); }
};
ch.onmessage = (e) => onMsg(e.data);
ch.postMessage({ type: 'hello' });
setInterval(() => send({ type: 'alive' }), 1500);
setInterval(() => { if (performance.now() - lastMsg > 6000 && view) { wait.style.display = 'flex'; wait.querySelector('p').textContent = rtc ? 'ขาดการเชื่อมต่อกับแอปเส้นคิด · กลับไปที่แอปแล้วกด "ส่งหน้าจอนักเรียนไป Safari" อีกครั้ง' : 'ขาดการเชื่อมต่อกับหน้าจอครู · เปิดเส้นคิดค้างไว้ในเบราว์เซอร์เดียวกัน'; } }, 2000);
// opened from the home-screen app: pair through Drive, then talk directly
if (location.hash.includes('pair')) (async () => {
  const msg = (t) => { wait.style.display = 'flex'; wait.querySelector('p').textContent = t; };
  try {
    const { RtcLink, studentPair, canPair } = await import('./pair.js');
    if (!canPair()) { msg('ต้องเชื่อมต่อ Google ใน Safari ก่อน (เปิดเส้นคิดใน Safari → ตั้งค่า → ซิงก์ผ่าน Google Drive)'); return; }
    rtc = new RtcLink({ onMsg, onState: (v) => { if (v) { send({ type: 'hello' }); msg('เชื่อมต่อแล้ว · รอหน้ากระดาษจากแอปเส้นคิด…'); } } });
    msg('กำลังจับคู่กับแอปเส้นคิด…');
    const ok = await studentPair(rtc, { onStatus: (st, e) => { if (st === 'waiting') msg('รอรหัสจับคู่จากแอปเส้นคิด… (กดปุ่มในแอปอีกครั้งถ้านานเกินไป)'); else if (st === 'answered') msg('ตอบรับแล้ว · กลับไปที่แอปเส้นคิดเพื่อเชื่อมต่อให้เสร็จ'); else if (st === 'error') msg('อ่านรหัสจับคู่ไม่ได้: ' + (e?.message || e)); } });
    if (!ok) msg('จับคู่ไม่สำเร็จ (หมดเวลา) · กดปุ่มในแอปเส้นคิดอีกครั้ง แล้วโหลดหน้านี้ใหม่');
  } catch (e) { console.warn(e); msg('จับคู่ไม่สำเร็จ: ' + (e.message || e)); }
})();

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
    if (p) { drawPaper(ctx, p, paper, k); drawStrokes(ctx, p, k, dark); if (live && live.pid === id) drawStroke(ctx, live.s, k, dark, false); if (view.curtain && view.curtain.pid === id) drawCurtain(ctx, p, view.curtain.y, k); }
    else { ctx.fillStyle = PAPERS[paper]?.fill || '#fff'; ctx.fillRect(0, 0, r.w, r.h); }
    ctx.restore();
  }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  if (tools.ruler) { const r = tools.ruler; drawRulerAt(ctx, T.ox + r.x * T.z, T.oy + r.y * T.z, r.ang, r.L * T.z, r.H * T.z, 72 / 25.4 * T.z); }
  if (tools.prot) { const r = tools.prot; drawProtractorAt(ctx, T.ox + r.x * T.z, T.oy + r.y * T.z, r.ang, r.r * T.z); }
  if (laser.length) {
    ctx.setTransform(d, 0, 0, d, 0, 0);
    drawLaserTrail(ctx, laser.map(p => ({ x: T.ox + p.x * T.z, y: T.oy + p.y * T.z, a: p.a, s: p.s })), laserHead, laserOpt);
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
setTimeout(() => { if (!view) document.getElementById('hint2').style.display = 'block'; }, 7000);

// calculator: the class sees the display (expression + answer), not the keys
const calcEl = document.createElement('div'); calcEl.id = 'calc'; calcEl.innerHTML = '<div class="t"></div><div class="r"></div><div class="p"></div>'; document.body.append(calcEl);
function calcShow(c) {
  calcEl.style.display = c ? 'block' : 'none'; if (!c) return;
  calcEl.querySelector('.t').textContent = c.top || ''; calcEl.querySelector('.r').textContent = c.res || '0'; calcEl.querySelector('.p').textContent = c.prev || '';
}
