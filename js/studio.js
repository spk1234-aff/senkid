// "ห้องอัด" — the Mac side. Shows a 4-digit code, receives the iPad's strokes live, and records the picture together with
// the Mac's microphone and camera straight to a file on disk (Chrome: written while recording, any length).
import { h, icon, toast, dialog, seg, fmtTime, fmtBytes, uid, downloadBlob } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import * as db from './db.js';
import { State, strokeIn, drawCamFrame } from './lesson.js';
import { injectPdfBitmap } from './pdfdoc.js';
import { creditImage, drawCredit, pickMime } from './recorder.js';

const RES = [['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']];
const W_OF = { 1080: 1920, 1440: 2560, 2160: 3840 };
const KBPS = { 1080: 10000, 1440: 16000, 2160: 28000 };
const DELAY = 450; // ms behind the iPad: smooths jitter and lets strokes animate as they arrive

export async function openStudio(app) {
  const x = prefs.studio || (prefs.studio = {}); x.res = x.res || '1440'; x.camPos = x.camPos || 'br'; x.camSize = x.camSize || 'm'; x.fit = x.fit || 'follow';
  document.body.classList.add('studio'); document.title = 'เส้นคิด Studio';
  const root = h('div', { class: 'studio-root' }); document.body.appendChild(root);

  // ---- receiver state ----
  const data = { v: 1, events: [] }; const st = new State(data); st.fitMode = x.fit; window.__studio = { data, st };
  let base = null, peer = null, camEl = null, camStream = null, micStream = null, rec = null, writer = null, fileName = '', bytes = 0, recStart = 0, lastEvAt = 0, nbName = '';
  const liveT = () => base == null ? 0 : performance.now() - base - DELAY;

  // ---- UI ----
  const cv = h('canvas', { class: 'studio-cv' }); const ctx = cv.getContext('2d', { alpha: false });
  const code = h('div', { class: 'studio-code' }, '····');
  const status = h('div', { class: 'studio-status' }, 'กำลังเปิดห้อง…');
  const micSel = h('select', { class: 'sel' }), camSel = h('select', { class: 'sel' });
  const micMeter = h('div', { class: 'meter big' }, ...Array.from({ length: 32 }, () => h('i')));
  const micState = h('div', { class: 'studio-mic', 'data-s': 'warn' }, 'กำลังเปิดไมค์…');
  const recBtn = h('button', { class: 'studio-rec' }, icon('mic'), ' เริ่มอัด');
  const timer = h('div', { class: 'studio-timer' }, '00:00');
  const sizeTxt = h('div', { class: 'sub' }, '');
  const fmtNote = h('div', { class: 'sub' }, '');
  const fitSeg = seg([['follow', 'ตามปากกา'], ['pages', 'ทั้งหน้า'], ['world', 'จอ iPad']], x.fit, v => { x.fit = v; st.fitMode = v; savePrefs(); });
  const fitNote = h('div', { class: 'sub' }, 'ตามปากกา: ขยายเต็มความกว้างหน้ากระดาษ แล้วเลื่อนตามจุดที่เขียน · ทั้งหน้า: เห็นทั้งหน้าตลอด · เหมือนจอ iPad: ตรงตามที่เห็นบน iPad');
  const resSeg = seg(RES, x.res, v => { x.res = v; savePrefs(); sizeCanvas(); });
  const posSeg = seg([['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], x.camPos, v => { x.camPos = v; savePrefs(); });
  const camSizeSeg = seg([['s', 'เล็ก'], ['m', 'กลาง'], ['l', 'ใหญ่']], x.camSize, v => { x.camSize = v; savePrefs(); });

  // ---- updates: check on open and every 20 minutes; never restart while recording ----
  const verTxt = h('span', { class: 'sub' }, 'รุ่น …'), upBtn = h('button', { class: 'pill sec', style: { height: '36px' } }, icon('download'), ' ตรวจหาอัปเดต');
  const upBox = h('div', { class: 'studio-up' }, verTxt, upBtn);
  let myVer = '', newVer = '';
  const serverVer = async () => { try { const t = await (await fetch(new URL('../sw.js?fresh=' + Date.now(), import.meta.url), { cache: 'no-store' })).text(); return (t.match(/senkid-([\d.]+)-/) || [])[1] || ''; } catch { return ''; } };
  const paintUp = () => { verTxt.textContent = 'รุ่น ' + (myVer || '?') + (newVer && newVer !== myVer ? ' · มีรุ่นใหม่ ' + newVer : ' · ล่าสุดแล้ว'); upBtn.classList.toggle('prim', !!newVer && newVer !== myVer); upBtn.classList.toggle('sec', !(newVer && newVer !== myVer)); upBtn.lastChild.textContent = newVer && newVer !== myVer ? ' อัปเดตเป็น ' + newVer : ' ตรวจหาอัปเดต'; };
  async function applyUpdate() {
    if (rec) { toast('กำลังอัดอยู่ · หยุดอัดก่อนแล้วค่อยอัปเดต', 3000, 'warn'); return; }
    upBtn.disabled = true; verTxt.textContent = 'กำลังดาวน์โหลดรุ่นใหม่…';
    try {
      const reg = await navigator.serviceWorker?.getRegistration(new URL('../', import.meta.url).href);
      let ok = false;
      if (reg) { try { await reg.update(); } catch { } const w = reg.installing || reg.waiting; if (w) ok = await new Promise(res => { if (w.state === 'activated') return res(true); w.addEventListener('statechange', () => { if (w.state === 'activated') res(true); else if (w.state === 'redundant') res(false); }); setTimeout(() => res(false), 20000); }); }
      if (!ok && window.caches) for (const k of await caches.keys()) if (k.startsWith('senkid-')) await caches.delete(k); // stuck: drop the offline copy (notebooks live elsewhere)
      try { peer?.send({ k: 'bye' }); await peer?.close(true); } catch { }
      location.reload();
    } catch (e) { upBtn.disabled = false; toast('อัปเดตไม่สำเร็จ: ' + (e.message || e), 4000, 'warn'); paintUp(); }
  }
  async function checkUpdate(manual) {
    if (!navigator.onLine) { if (manual) toast('ต้องต่ออินเทอร์เน็ตก่อน', 2500, 'warn'); return; }
    const v = await serverVer(); if (v) newVer = v; paintUp();
    if (manual && (!newVer || newVer === myVer)) toast('ใช้รุ่นล่าสุดอยู่แล้ว (' + myVer + ')', 2500);
    else if (!manual && newVer && newVer !== myVer && !rec && base == null) applyUpdate(); // nobody connected, not recording: update quietly
  }
  upBtn.onclick = () => (newVer && newVer !== myVer) ? applyUpdate() : checkUpdate(true);
  // the version this page is running = the sw.js copy in the offline cache (importing main.js here would boot the whole app)
  (async () => { try { const t = await (await fetch(new URL('../sw.js', import.meta.url))).text(); myVer = (t.match(/senkid-([\d.]+)-/) || [])[1] || ''; } catch { } paintUp(); checkUpdate(false); })();
  setInterval(() => checkUpdate(false), 20 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(false); });

  // what the video shows: the vector ink stream (sharp at any size), or a captured window that mirrors the whole iPad
  // screen (QuickTime's iPad mirror), so the teacher's toolbars are visible too
  let scrEl = null, scrStream = null;
  const srcNote = h('div', { class: 'sub' }, '');
  const paintSrc = () => { srcNote.innerHTML = x.src === 'screen' ? (scrEl ? 'กำลังใช้ภาพทั้งจอ iPad (เห็นแถบเครื่องมือ) · ความคมเท่าจอ iPad' : 'ยังไม่ได้เลือกหน้าต่าง · กดปุ่มด้านล่าง') : 'เฉพาะกระดาษและลายมือ คมทุกความละเอียด · ไม่เห็นแถบเครื่องมือ'; pickScr.hidden = x.src !== 'screen'; scrHelp.hidden = x.src !== 'screen'; fitRow.hidden = x.src === 'screen'; };
  async function pickScreen() {
    try {
      scrStream?.getTracks().forEach(t => t.stop());
      scrStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      scrEl = h('video', { muted: true, playsinline: true, autoplay: true }); scrEl.srcObject = scrStream; await scrEl.play().catch(() => { });
      scrStream.getVideoTracks()[0].addEventListener('ended', () => { scrEl = null; scrStream = null; toast('หน้าต่างที่จับภาพถูกปิด · กลับไปใช้ภาพลายมือ', 3500, 'warn'); paintSrc(); });
    } catch (e) { if (e.name !== 'NotAllowedError') toast('จับภาพหน้าต่างไม่ได้: ' + (e.message || e.name), 4000, 'warn'); }
    paintSrc();
  }
  x.src = x.src === 'screen' ? 'ink' : (x.src || 'ink'); // a captured window never survives a restart: start on ink
  const srcSeg = seg([['ink', 'ลายมือ (คมสุด)'], ['screen', 'ทั้งจอ + เครื่องมือ']], x.src, v => { x.src = v; savePrefs(); paintSrc(); if (v === 'screen' && !scrEl) pickScreen(); });
  const pickScr = h('button', { class: 'pill sec', style: { width: '100%', marginTop: '6px' }, onclick: pickScreen }, icon('screen'), ' เลือกหน้าต่างที่แสดงจอ iPad');
  const scrHelp = h('div', { class: 'sub' }, 'วิธีทำ: ต่อ iPad กับ Mac ด้วยสาย USB → เปิด QuickTime Player → ไฟล์ → บันทึกภาพยนตร์ใหม่ → กดลูกศรข้างปุ่มอัด เลือก iPad → กลับมากดปุ่มด้านบนแล้วเลือกหน้าต่าง QuickTime (ไม่ต้องใส่รหัส)');
  const fitRow = h('div', {}, h('div', { class: 'lbl' }, 'มุมมอง'), fitSeg, fitNote);
  const sec = (title, open, ...kids) => { const d = h('details', { class: 'studio-sec' }, h('summary', {}, title), h('div', { class: 'studio-sec-b' }, ...kids)); d.open = !!open; return d; };
  const panel = h('div', { class: 'studio-panel' },
    h('div', { class: 'studio-h' }, h('b', {}, 'เส้นคิด Studio'), h('span', { class: 'sub' }, ' เขียนบน iPad · อัดบน Mac')),
    h('div', { class: 'studio-card' }, h('div', { class: 'lbl', style: { marginTop: 0 } }, 'รหัสสำหรับ iPad'), code, status),
    h('div', { class: 'studio-card' }, micMeter, micState),
    recBtn, timer, sizeTxt,
    sec('ไมค์และกล้อง', false,
      h('div', { class: 'lbl' }, 'ไมโครโฟน'), micSel,
      h('div', { class: 'lbl' }, 'กล้องครู'), camSel,
      h('div', { class: 'row2' }, h('span', { class: 'sub' }, 'มุม'), posSeg), h('div', { class: 'row2' }, h('span', { class: 'sub' }, 'ขนาด'), camSizeSeg)),
    sec('ภาพในวิดีโอ', false,
      h('div', { class: 'lbl' }, 'ที่มาของภาพ'), srcSeg, srcNote, pickScr, scrHelp,
      fitRow,
      h('div', { class: 'lbl' }, 'ความละเอียด'), resSeg, fmtNote),
    h('div', { style: { flex: 1 } }),
    upBox,
    h('button', { class: 'pill sec', style: { marginTop: '8px' }, onclick: () => closeStudio() }, icon('close'), ' ปิด Studio'));
  paintSrc();
  // presentation mode (for sharing the window into Google Meet): only the board, with a small bar that appears on hover
  const hudT = h('span', {}, ''), hud = h('div', { class: 'studio-hud' }, h('i', { class: 'lv' }), h('b', {}, 'REC'), hudT,
    h('button', { title: 'เริ่ม/หยุดอัด', onclick: () => recBtn.click() }, '●'), h('button', { title: 'ออกจากโหมดนำเสนอ', onclick: () => present(false) }, '✕ ออก'));
  const presentBtn = h('button', { class: 'pill sec', style: { width: '100%' }, onclick: () => present(true) }, icon('tv'), ' นำเสนอ / Google Meet');
  function present(on) { root.classList.toggle('present', on); if (on) toast('โหมดนำเสนอ · ใน Meet กด "นำเสนอ" แล้วเลือกหน้าต่าง/แท็บนี้ · เลื่อนเมาส์ไปขอบล่างเพื่อดูปุ่ม · กด Esc เพื่อออก', 6000); }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('present')) present(false); });
  sizeTxt.after(presentBtn);
  root.append(h('div', { class: 'studio-stage' }, cv, hud), panel);

  const mime = pickMime(); const isMp4 = (mime || '').includes('mp4');
  const canStream = !!window.showSaveFilePicker;
  fmtNote.textContent = (isMp4 ? 'ไฟล์ MP4 (H.264) เปิดใน iMovie / Final Cut ได้เลย' : 'เบราว์เซอร์นี้อัดได้แค่ WebM · iMovie เปิดไม่ได้ แนะนำ Chrome รุ่นล่าสุด') + (canStream ? ' · เขียนลงดิสก์ระหว่างอัด ความยาวไม่จำกัด' : ' · เบราว์เซอร์นี้เก็บไฟล์ในหน่วยความจำจนจบ ไม่เหมาะกับคลิปยาว แนะนำ Chrome');

  function sizeCanvas() { const W = W_OF[x.res], H = Math.round(W * 9 / 16); if (cv.width !== W) { cv.width = W; cv.height = H; } }
  sizeCanvas();
  const credit = creditImage(cv.height);

  // ---- devices ----
  async function fillDevices() {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); s.getTracks().forEach(t => t.stop()); } catch { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch { } }
    const all = await navigator.mediaDevices.enumerateDevices();
    micSel.innerHTML = ''; camSel.innerHTML = '';
    all.filter(d => d.kind === 'audioinput').forEach((d, i) => micSel.append(h('option', { value: d.deviceId }, d.label || `ไมค์ ${i + 1}`)));
    camSel.append(h('option', { value: '' }, 'ไม่ใช้กล้อง'));
    all.filter(d => d.kind === 'videoinput').forEach((d, i) => camSel.append(h('option', { value: d.deviceId }, d.label || `กล้อง ${i + 1}`)));
    if (x.mic && [...micSel.options].some(o => o.value === x.mic)) micSel.value = x.mic;
    if (x.cam && [...camSel.options].some(o => o.value === x.cam)) camSel.value = x.cam;
    await openMic(); await openCam();
  }
  async function openMic() {
    micStream?.getTracks().forEach(t => t.stop()); micStream = null;
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: micSel.value ? { deviceId: { exact: micSel.value }, echoCancellation: false, noiseSuppression: true } : true }); x.mic = micSel.value; savePrefs(); meter(micStream); }
    catch (e) { toast('เปิดไมค์ไม่ได้: ' + (e.message || e.name), 4000, 'warn'); }
  }
  async function openCam() {
    camStream?.getTracks().forEach(t => t.stop()); camStream = null; camEl = null;
    if (!camSel.value) { x.cam = ''; savePrefs(); return; }
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: camSel.value }, width: { ideal: 1280 }, height: { ideal: 720 } } }); camEl = h('video', { muted: true, playsinline: true, autoplay: true }); camEl.srcObject = camStream; await camEl.play().catch(() => { }); x.cam = camSel.value; savePrefs(); }
    catch (e) { toast('เปิดกล้องไม่ได้: ' + (e.message || e.name), 4000, 'warn'); }
  }
  micSel.onchange = openMic; camSel.onchange = openCam;
  let meterCtx = null, lastLoud = 0, micLevel = 0;
  function meter(stream) {
    try { meterCtx?.close(); } catch { }
    const AC = window.AudioContext || window.webkitAudioContext; meterCtx = new AC(); const an = meterCtx.createAnalyser(); an.fftSize = 512; meterCtx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize), bars = [...micMeter.children]; let peak = 0, peakAt = 0; lastLoud = performance.now();
    const my = meterCtx;
    const tick = () => {
      if (meterCtx !== my || my.state === 'closed') return;
      if (my.state === 'suspended') { micState.textContent = 'แตะตรงไหนก็ได้ในหน้านี้เพื่อเปิดมาตรวัดเสียง'; micState.dataset.s = 'warn'; requestAnimationFrame(tick); return; }
      an.getByteTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v - 128)); const lv = Math.min(1, p / 128 * 1.8); micLevel = lv;
      const now = performance.now(); if (lv > peak || now - peakAt > 1200) { peak = lv; peakAt = now; } if (lv > 0.04) lastLoud = now;
      const n = Math.round(lv * bars.length), pk = Math.min(bars.length - 1, Math.round(peak * bars.length));
      bars.forEach((b, i) => { b.className = i < n ? (i > bars.length * 0.85 ? 'on hot' : i > bars.length * 0.65 ? 'on warm' : 'on') : (i === pk && peak > 0.04 ? 'pk' : ''); });
      const tr = stream.getAudioTracks()[0], silent = now - lastLoud > 6000;
      if (!tr || tr.readyState !== 'live') { micState.textContent = 'ไมค์หลุด · เลือกไมค์ใหม่'; micState.dataset.s = 'bad'; }
      else if (tr.muted) { micState.textContent = 'ไมค์ถูกปิดเสียงที่ระบบ'; micState.dataset.s = 'bad'; }
      else if (silent) { micState.textContent = (rec ? '⚠ กำลังอัดแต่ไม่มีเสียงเข้า' : 'ยังไม่ได้ยินเสียง') + ' · ลองพูด หรือเช็กว่าเลือกไมค์ถูกตัว'; micState.dataset.s = rec ? 'bad' : 'warn'; }
      else if (lv > 0.92) { micState.textContent = 'เสียงดังเกิน (แตก) · ถอยห่างไมค์หรือลดเกน'; micState.dataset.s = 'bad'; }
      else { micState.textContent = 'ไมค์ทำงาน ✓ ' + (tr.label || ''); micState.dataset.s = 'ok'; }
      requestAnimationFrame(tick);
    }; tick();
  }
  const wake = () => { try { if (meterCtx?.state === 'suspended') meterCtx.resume(); } catch { } };
  addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);

  // ---- drawing ----
  function camMeta(W, H) { const sz = { s: 0.14, m: 0.2, l: 0.28 }[x.camSize] * H; const pos = { tl: { x: sz / W, y: sz / H }, tr: { x: 1 - 0.015, y: sz / H + 0.015 }, bl: { x: sz / W + 0.015, y: 1 - 0.015 }, br: { x: 1 - 0.015, y: 1 - 0.015 } }[x.camPos]; return { camStageW: W, camSize: sz, camPos: pos, camShape: 'circle' }; }
  let waitingMsg = true;
  function frame() {
    const W = cv.width, H = cv.height;
    if (base == null) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#EDEAE2'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#6b6f7a'; ctx.font = `${Math.round(H * 0.045)}px "TH Sarabun New", sans-serif`; ctx.textAlign = 'center'; ctx.fillText('รอ iPad เชื่อมต่อ · ใส่รหัสด้านขวาในเส้นคิดบน iPad (เมนู → ส่งภาพไป Studio)', W / 2, H / 2); }
    else { st.seek(Math.max(0, liveT())); st.draw(ctx, W, H, 1); }
    if (x.src === 'screen' && scrEl && scrEl.readyState >= 2) { // whole iPad screen, letterboxed
      const vw = scrEl.videoWidth, vh = scrEl.videoHeight, k = Math.min(W / vw, H / vh), dw = vw * k, dh = vh * k;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#111318'; ctx.fillRect(0, 0, W, H); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(scrEl, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    if (camEl) drawCamFrame(ctx, camMeta(W, H), camEl, W, H);
    drawCredit(ctx, W, H, credit);
    if (rec) { timer.textContent = fmtTime(performance.now() - recStart); sizeTxt.textContent = fmtBytes(bytes) + (fileName ? ' → ' + fileName : ''); }
    hud.style.setProperty('--lv', micLevel.toFixed(2)); hud.dataset.rec = rec ? '1' : ''; hud.dataset.silent = (performance.now() - lastLoud > 6000) ? '1' : ''; if (rec) hudT.textContent = fmtTime(performance.now() - recStart);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- link ----
  const N = await import('./studio-net.js');
  const setStatus = (s) => { status.textContent = { connecting: 'รอ iPad เชื่อมต่อ…', paired: 'iPad จับคู่แล้ว · กำลังเปิดช่องส่งตรง…', direct: 'เชื่อมต่อตรงกับ iPad ✓', relay: 'เชื่อมต่อผ่านเซิร์ฟเวอร์ (ใช้ได้ ช้ากว่าเล็กน้อย)', closed: 'ปิดแล้ว' }[s] || s; status.dataset.s = s; };
  const loginBtn = h('button', { class: 'pill prim', style: { width: '100%', marginTop: '6px' }, hidden: true }, icon('user'), ' เข้าสู่ระบบด้วย Google (บัญชีครู)');
  status.after(loginBtn);
  async function openRoom() {
    try { peer = await N.createHost(setStatus); code.textContent = peer.code; setStatus('connecting'); loginBtn.hidden = true; peer.onMessage(onMsg); }
    catch (e) { code.textContent = '— — — —'; status.textContent = (e.needLogin ? '' : 'เปิดห้องไม่ได้: ') + (e.message || e); loginBtn.hidden = !e.needLogin; if (/permission|insufficient/i.test(e.message || '')) status.textContent = 'บัญชีนี้ไม่มีสิทธิ์ใช้ Studio · ต้องเป็นบัญชีครู'; }
  }
  loginBtn.onclick = async () => { loginBtn.disabled = true; try { await N.studioLogin(); status.textContent = 'กำลังเปิดห้อง…'; await openRoom(); } catch (e) { status.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + (e.code || e.message || e); } finally { loginBtn.disabled = false; } };
  const onMsg = async (m) => {
    if (m.k === 'hello') { base = performance.now() - (m.t || 0); nbName = m.name || ''; data.events.length = 0; st.reset(); toast('iPad เชื่อมต่อแล้ว' + (nbName ? ' · ' + nbName : ''), 2500); }
    else if (m.k === 'ping') { lastEvAt = performance.now(); if (base == null) base = performance.now() - (m.t || 0); }
    else if (m.k === 'ev') {
      const ev = m.ev; lastEvAt = performance.now();
      if ((ev[1] === 'base') && ev[3]) ev[3].strokes = await Promise.all(ev[3].strokes.map(strokeIn));
      if ((ev[1] === 'add' || ev[1] === 'rep') && ev[3]) ev[3] = await strokeIn(ev[3]);
      if (ev[1] === 'meta' && data.events.length) { /* the iPad restarted its timeline (a lesson recording started/stopped): keep going, times continue */ }
      if (base == null) base = performance.now() - ev[0];
      // keep the list ordered by time (payload decoding may finish out of order)
      const E = data.events; let i = E.length; while (i > 0 && E[i - 1][0] > ev[0]) i--; E.splice(i, 0, ev);
      if (i < st.i) { st.i = 0; st.lastT = -1; st.reset(); } // inserted behind the cursor: replay from the start (cheap, events are tiny)
    }
    else if (m.k === 'pdfimg') { const img = new Image(); img.onload = () => injectPdfBitmap(m.id, m.n, img); img.src = m.data; }
    else if (m.k === 'bye') { toast('iPad หยุดส่งภาพแล้ว', 3000); setStatus('connecting'); }
  };
  await openRoom();

  // ---- recording ----
  async function startRec() {
    if (!micStream) { toast('ยังไม่มีไมค์ · เลือกไมค์ก่อน', 3000, 'warn'); return; }
    if (base == null && !(x.src === 'screen' && scrEl) && !confirm('iPad ยังไม่ได้เชื่อมต่อ จะอัดเลยไหม?')) return;
    const ext = isMp4 ? 'mp4' : 'webm';
    fileName = `${(nbName || 'เส้นคิด').replace(/[\\/:*?"<>|]/g, '-')} ${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }).replace(':', '.')}.${ext}`;
    writer = null; let idbId = null, seq = 0;
    if (canStream) {
      try { const fh = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'วิดีโอ', accept: { [isMp4 ? 'video/mp4' : 'video/webm']: ['.' + ext] } }] }); writer = await fh.createWritable(); fileName = fh.name; }
      catch (e) { if (e.name === 'AbortError') return; toast('เลือกที่เก็บไฟล์ไม่ได้ · จะเก็บในเบราว์เซอร์แล้วดาวน์โหลดตอนจบ', 3500, 'warn'); }
    }
    if (!writer) idbId = uid();
    const vs = cv.captureStream(30); const tracks = [...vs.getVideoTracks(), ...micStream.getAudioTracks()];
    const out = new MediaStream(tracks);
    try { rec = new MediaRecorder(out, { mimeType: mime || undefined, videoBitsPerSecond: KBPS[x.res] * 1000, audioBitsPerSecond: 160000 }); }
    catch (e) { toast('เริ่มอัดไม่ได้: ' + (e.message || e), 4000, 'warn'); try { await writer?.abort(); } catch { } return; }
    bytes = 0; recStart = performance.now();
    const pend = [];
    rec.ondataavailable = (e) => { if (!e.data?.size) return; bytes += e.data.size; if (writer) pend.push(writer.write(e.data).catch(err => { toast('เขียนไฟล์ไม่ได้: ' + err.message, 5000, 'warn'); })); else pend.push(db.addChunk(idbId, seq++, e.data)); };
    rec.onstop = async () => {
      await Promise.allSettled(pend);
      if (writer) { try { await writer.close(); } catch { } toast(`บันทึกแล้ว: ${fileName} (${fmtBytes(bytes)})`, 6000); }
      else { const parts = (await db.chunksOf(idbId)).sort((a, b) => a.seq - b.seq).map(c => c.blob); const blob = new Blob(parts, { type: (mime || 'video/webm').split(';')[0] }); downloadBlob(blob, fileName); await db.deleteRec(idbId).catch(() => { }); toast(`ดาวน์โหลดแล้ว: ${fileName}`, 5000); }
      timer.textContent = fmtTime(performance.now() - recStart) + ' · เสร็จแล้ว'; rec = null; writer = null; recBtn.classList.remove('on'); recBtn.innerHTML = ''; recBtn.append(icon('mic'), ' เริ่มอัด'); peer?.send({ k: 'rec', on: false });
      try { if (navigator.wakeLock && wl) { wl.release(); wl = null; } } catch { }
    };
    rec.start(2000);
    recBtn.classList.add('on'); recBtn.innerHTML = ''; recBtn.append(icon('stop'), ' หยุดอัด'); peer?.send({ k: 'rec', on: true });
    try { wl = await navigator.wakeLock?.request('screen'); } catch { }
    toast('เริ่มอัดแล้ว · ' + (isMp4 ? 'MP4' : 'WebM') + ' ' + x.res + 'p', 2500);
  }
  let wl = null;
  recBtn.onclick = () => { if (rec) rec.stop(); else startRec(); };
  window.addEventListener('beforeunload', (e) => { if (rec) { e.preventDefault(); e.returnValue = ''; } });

  async function closeStudio() {
    if (rec && !confirm('กำลังอัดอยู่ จะหยุดและปิดห้องอัดไหม?')) return;
    if (rec) { rec.stop(); await new Promise(r => setTimeout(r, 1500)); }
    try { peer?.send({ k: 'bye' }); } catch { }
    await peer?.close(true);
    micStream?.getTracks().forEach(t => t.stop()); camStream?.getTracks().forEach(t => t.stop()); scrStream?.getTracks().forEach(t => t.stop()); try { meterCtx?.close(); } catch { }
    location.href = location.pathname.includes('/studio') ? '../' : location.pathname; // back to the main app
  }
  await fillDevices();
}
