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
let mirror = null, mStage = null, mScale = 1, mW = 0, mH = 0;
let tools = {}, nb = null, view = null, live = null, laser = [], laserHead = false, laserOpt = {}, paper = 'cream', dirty = true, lastMsg = 0;

// canvas size is capped: a 4K TV at 3× pixel ratio would need a ~75 MB canvas, which Safari silently fails to keep in a
// background window (the page goes white). ~8 M pixels (2× on a 1080p/4K window) is plenty for a TV and always fits.
function dprFor(w, hgt) { const d = Math.min(2, devicePixelRatio || 1); return Math.min(d, Math.sqrt(8e6 / Math.max(1, w * hgt)), 4096 / Math.max(w, hgt)); }
function size() { if (mirror) return; const d = dprFor(innerWidth, innerHeight); cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); dirty = true; }
addEventListener('resize', () => { size(); mirrorLayout(); }); size();
// when iPadOS pauses this window and brings it back, the canvas may have been purged: redraw at once, and keep a slow
// steady redraw so a purged canvas never stays white for long
const wake = () => { dirty = true; if (!mirror) size(); else mirrorLayout(); };
addEventListener('pageshow', wake); addEventListener('focus', wake); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
setInterval(() => { dirty = true; }, 4000);
// keep the display awake while the class watches
let wl = null; const keepAwake = async () => { try { if (!wl && navigator.wakeLock && document.visibilityState === 'visible') { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); } } catch { } };
keepAwake(); document.addEventListener('visibilitychange', keepAwake); addEventListener('pointerdown', keepAwake, { passive: true });
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
  else if (m.type === 'ui') mirrorApply(m);
  else if (m.type === 'pick') pickShow(m);
  else if (m.type === 'qr') { let q = document.getElementById('qrov'); if (!m.url) { q?.remove(); return; } if (!q) { q = document.createElement('div'); q.id = 'qrov'; document.body.append(q); } q.innerHTML = `<img src="${m.url}"><div class="n">${String(m.name || '').replace(/</g, '&lt;')}</div><div class="l">สแกนด้วยกล้อง iPad → เปิดใน Safari</div>`; }
};
ch.onmessage = (e) => onMsg(e.data);
ch.postMessage({ type: 'hello' });
setInterval(() => send({ type: 'alive' }), 1500);
setInterval(() => { if (performance.now() - lastMsg > 6000 && view) { wait.style.display = 'flex'; wait.querySelector('p').textContent = rtc ? 'ขาดการเชื่อมต่อกับแอปเส้นคิด · กลับไปที่แอปแล้วกด "ส่งหน้าจอนักเรียนไป Safari" อีกครั้ง' : 'ขาดการเชื่อมต่อกับหน้าจอครู · เปิดเส้นคิดค้างไว้ในเบราว์เซอร์เดียวกัน'; } }, 2000);
// the teacher's app hands this window its Google token (in the link on first open, then over the data channel whenever it
// renews), so the TV window never has to sign in to Google itself and never expires while the app is running
function takeToken(t) { try { if (t && t.exp > Date.now()) localStorage.setItem('senkid.gtoken', JSON.stringify(t)); } catch { } }
try { const m = /tok=([^&]+)/.exec(location.hash); if (m) { takeToken(JSON.parse(decodeURIComponent(m[1]))); history.replaceState(null, '', location.pathname + '#pair'); } } catch { }
const onMsg0 = onMsg; const onMsgT = (m) => { if (m && m.type === 'tok') { takeToken(m.t); return; } onMsg0(m); };
// opened from the home-screen app: pair through Drive, then talk directly
if (location.hash.includes('pair')) (async () => {
  const msg = (t) => { wait.style.display = 'flex'; wait.querySelector('p').textContent = t; };
  try {
    const { RtcLink, studentPair, canPair } = await import('./pair.js');
    if (!canPair()) { msg('ยังไม่ได้รับสิทธิ์จากแอปเส้นคิด · ในแอปกด "ส่งหน้าจอนักเรียนไป Safari" อีกครั้ง'); }
    let answered = 0, open = false;
    rtc = new RtcLink({ onMsg: onMsgT, onState: (v) => { open = v; if (v) { send({ type: 'hello' }); msg('เชื่อมต่อแล้ว · รอหน้ากระดาษจากแอปเส้นคิด…'); } else { view = null; msg('หลุดการเชื่อมต่อ · ในแอปเส้นคิดกด "ส่งหน้าจอนักเรียนไป Safari" อีกครั้ง หน้านี้จะต่อให้เอง'); } } });
    msg('กำลังจับคู่กับแอปเส้นคิด…');
    // keep this window alive on the TV: whenever the app publishes a new pairing code, answer it again
    while (true) {
      const t = await studentPair(rtc, { timeoutMs: 1e12, skipBefore: answered, onStatus: (st, e) => { if (open) return; if (st === 'waiting') msg(answered ? 'รอการเชื่อมต่อจากแอปเส้นคิด… (กดปุ่ม "ส่งหน้าจอนักเรียนไป Safari" ในแอป)' : 'รอรหัสจับคู่จากแอปเส้นคิด… (กดปุ่มในแอปอีกครั้งถ้านานเกินไป)'); else if (st === 'answered') msg('ตอบรับแล้ว · กลับไปที่แอปเส้นคิดเพื่อเชื่อมต่อให้เสร็จ'); else if (st === 'error') msg('อ่านรหัสจับคู่ไม่ได้: ' + (e?.message || e)); } });
      if (t) answered = t;
      // wait until this link closes (or never opened within a minute) before listening for the next code
      const t0 = Date.now(); let wasOpen = false;
      while (true) { await new Promise(r => setTimeout(r, 1000)); if (open) wasOpen = true; else if (wasOpen || Date.now() - t0 > 60e3) break; }
    }
  } catch (e) { console.warn(e); msg('จับคู่ไม่สำเร็จ: ' + (e.message || e)); }
})();

// ---- mirror of the teacher's whole screen (toolbars + menus as HTML, paper drawn in the stage area) ----
function mirrorApply(m) {
  if (!m.on) { if (mirror) { mirror.remove(); mirror = null; mStage = null; document.body.prepend(cv); size(); } return; }
  if (!mirror) { mirror = document.createElement('div'); mirror.id = 'mirror'; document.body.append(mirror); }
  if (m.theme) document.documentElement.dataset.theme = m.theme; else delete document.documentElement.dataset.theme;
  mW = m.W; mH = m.H;
  mirror.innerHTML = `<div class="${m.edClass}">${m.tb}<div class="stage"></div></div><div class="mlayer">${m.layer}</div><div class="mlayer" id="toasts">${m.toasts}</div>`;
  mStage = mirror.querySelector('.stage'); mStage.append(cv); mStage.insertAdjacentHTML('beforeend', m.stageUI);
  for (const el of mirror.querySelectorAll('.scrim')) el.style.pointerEvents = 'none';
  mirrorLayout(); dirty = true;
}
function mirrorLayout() {
  if (!mirror) return;
  mScale = Math.min(innerWidth / mW, innerHeight / mH);
  mirror.style.width = mW + 'px'; mirror.style.height = mH + 'px';
  mirror.style.transform = `translate(${(innerWidth - mW * mScale) / 2}px,${(innerHeight - mH * mScale) / 2}px) scale(${mScale})`;
  const sw = mStage.clientWidth, sh = mStage.clientHeight, d = dprFor(sw * mScale, sh * mScale) * mScale;
  cv.width = Math.max(1, Math.round(sw * d)); cv.height = Math.max(1, Math.round(sh * d));
}
// random-name picker overlay (big, on the TV)
let pickEl = null, pickT = null;
function pickShow(m) {
  if (m.off) { pickEl?.remove(); pickEl = null; return; }
  if (!pickEl) { pickEl = document.createElement('div'); pickEl.id = 'pick'; document.body.append(pickEl); }
  clearTimeout(pickT);
  if (m.groups) { pickEl.className = 'groups'; pickEl.innerHTML = m.groups.map((g, i) => `<div class="g"><b>กลุ่ม ${i + 1}</b>${g.map(x => `<div>${x.replace(/</g, '&lt;')}</div>`).join('')}</div>`).join(''); }
  else { pickEl.className = m.done ? 'one win' : 'one'; pickEl.textContent = (m.names || []).join(' '); }
  if (m.done) pickT = setTimeout(() => { pickEl?.remove(); pickEl = null; }, m.groups ? 120e3 : 15e3);
}
function transform() {
  if (mirror && mStage) { // exactly the teacher's viewport
    const W = mStage.clientWidth, H = mStage.clientHeight, [x0, y0, x1, y1] = view.world;
    const z = W / (x1 - x0);
    return { z, ox: -x0 * z, oy: -y0 * z, W, H };
  }
  const W = innerWidth, H = innerHeight;
  let x0, y0, x1, y1;
  if (view.mode === 'page' && view.cur && view.rects[view.cur]) { const r = view.rects[view.cur]; x0 = r.x; y0 = r.y; x1 = r.x + r.w; y1 = r.y + r.h; }
  else[x0, y0, x1, y1] = view.world;
  const pad = view.mode === 'page' ? 12 : 0;
  const z = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0));
  return { z, ox: (W - (x1 - x0) * z) / 2 - x0 * z, oy: (H - (y1 - y0) * z) / 2 - y0 * z, W, H };
}
function frame() {
  requestAnimationFrame(frame);
  if (!dirty || !view) return; dirty = laser.length > 0;
  const T = transform(), d = cv.width / T.W;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = mirror ? (getComputedStyle(mirror).getPropertyValue('--desk').trim() || '#EDEAE2') : '#0B0C0E'; ctx.fillRect(0, 0, cv.width, cv.height);
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
