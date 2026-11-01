// Records ONLY the paper area (main + live canvases) + microphone audio.
import { h, icon, toast, dialog, popover, seg, toggle, fmtBytes, fmtTime, downloadBlob, confirmBox, uid, busy } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import * as db from './db.js';

const RES = [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']];
const BITRATE = { 720: 3e6, 1080: 5e6, 1440: 8e6, 2160: 12e6 };
const AUDIO_BPS = 128e3;

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const c = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of c) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { } }
  return '';
}
const extOf = (m) => (m || '').startsWith('audio/') ? ((m.includes('mp4') ? 'm4a' : m.includes('ogg') ? 'ogg' : 'webm')) : (m || '').includes('mp4') ? 'mp4' : 'webm';
export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;

async function freeSpace() {
  try { const e = await navigator.storage.estimate(); return Math.max(0, (e.quota || 0) - (e.usage || 0)); } catch { return null; }
}

export class Recorder {
  constructor(app) { this.app = app; this.state = 'idle'; this.mic = null; }
  get active() { return this.state !== 'idle'; }

  syncButton() {
    const ed = this.app.editor; if (!ed || !ed.recBtn) return;
    const b = ed.recBtn;
    b.classList.toggle('live', this.state === 'recording');
    b.classList.toggle('paused', this.state === 'paused');
    b.innerHTML = '';
    if (this.state === 'idle') b.append(h('span', { class: 'dot' }), h('span', { class: 'lab' }, 'อัดคลิป'));
    else b.append(h('span', { class: 'dot' }), h('span', { class: 't' }, fmtTime(this.elapsed())), icon(this.state === 'paused' ? 'play' : 'pause'));
    ed.updateRecFloat();
  }
  elapsed() { if (!this.t0) return 0; const now = this.state === 'paused' ? this.pauseAt : performance.now(); return now - this.t0 - this.pausedTotal; }

  click(ed, btn) {
    if (this.state === 'idle') return this.settings(ed, btn);
    const box = h('div', { class: 'menu' });
    const mk = (ic, label, fn, danger) => { const b = h('button', { class: 'mi' + (danger ? ' danger' : '') }, icon(ic), h('span', {}, label)); b.onclick = () => { close(); fn(); }; box.append(b); };
    box.append(h('div', { class: 'mh' }, `กำลังอัด ${fmtTime(this.elapsed())} · ${this.res === '2160' ? '4K' : this.res + 'p'}`));
    if (this.state === 'recording') mk('pause', 'หยุดชั่วคราว', () => this.pause());
    else mk('play', 'อัดต่อ', () => this.resume());
    mk('stop', 'หยุดและบันทึกคลิป', () => this.stop(), true);
    const close = popover(btn, box, ed.popOpts());
  }

  async settings(ed, btn) {
    if (!canRecord()) { dialog('อัดคลิปไม่ได้', h('p', {}, 'เบราว์เซอร์นี้ไม่รองรับการอัดคลิป ลองใช้ Safari บน iPad (iPadOS 16 ขึ้นไป) หรือ Chrome รุ่นล่าสุด'), [{ label: 'ปิด', cls: 'prim' }]); return; }
    const mime = pickMime();
    let res = prefs.rec.res;
    const body = h('div');
    const ratio = ed.W / ed.H;
    body.append(h('div', { class: 'recprev' },
      h('div', { class: 'box', style: { aspectRatio: ratio, width: ratio >= 1 ? '120px' : 'auto', height: ratio >= 1 ? 'auto' : '100px' } }, icon('pages')),
      h('div', { style: { fontSize: '21px' } }, 'คลิปจะมีแค่', h('b', {}, 'พื้นที่กระดาษ'), 'กับ', h('b', {}, 'เสียงไมค์'), h('br'),
        h('span', { style: { color: 'var(--muted)' } }, 'ไม่มีแถบเครื่องมือ เมนู แถบสถานะ หรือแจ้งเตือนติดไปด้วย ซูมหรือเลื่อนหน้าระหว่างอัดได้ตามปกติ'))));
    // mic
    const micSel = h('select', { class: 'field' }, h('option', { value: '' }, 'ไมค์เริ่มต้นของเครื่อง'));
    const meter = h('div', { class: 'meter' }); for (let i = 0; i < 26; i++) meter.append(h('span'));
    const testBtn = h('button', { class: 'pill sec', style: { flex: 'none' } }, icon('mic'), 'ทดสอบไมค์');
    body.append(h('div', { class: 'lbl' }, 'ไมโครโฟน'), h('div', { style: { display: 'flex', gap: '8px' } }, micSel, testBtn), meter);
    const fillMics = async () => {
      try {
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
        micSel.innerHTML = ''; micSel.append(h('option', { value: '' }, 'ไมค์เริ่มต้นของเครื่อง'));
        devs.forEach((d, i) => { if (d.deviceId === 'default' || !d.deviceId) return; micSel.append(h('option', { value: d.deviceId }, d.label || `ไมค์ ${i + 1}`)); });
        micSel.value = [...micSel.options].some(o => o.value === prefs.rec.mic) ? prefs.rec.mic : '';
      } catch { }
    };
    fillMics();
    micSel.onchange = () => { prefs.rec.mic = micSel.value; savePrefs(); if (this.testStream) startMeter(); };
    const stopMeter = () => { cancelAnimationFrame(this.meterRaf); this.testStream?.getTracks().forEach(t => t.stop()); this.testStream = null; this.testCtx?.close?.(); this.testCtx = null; };
    const startMeter = async () => {
      stopMeter();
      try {
        this.testStream = await navigator.mediaDevices.getUserMedia({ audio: micSel.value ? { deviceId: { exact: micSel.value } } : true });
        await fillMics();
        const AC = window.AudioContext || window.webkitAudioContext; this.testCtx = new AC();
        const an = this.testCtx.createAnalyser(); an.fftSize = 512; this.testCtx.createMediaStreamSource(this.testStream).connect(an);
        const buf = new Uint8Array(an.fftSize); const bars = [...meter.children];
        const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); const lv = Math.min(1, m / 90); bars.forEach((b, i) => { const on = i / bars.length < lv; b.style.background = on ? (i < 16 ? '#1E9E5A' : i < 21 ? '#F5B83D' : '#E5484D') : ''; }); this.meterRaf = requestAnimationFrame(loop); };
        loop();
      } catch (e) { toast('เปิดไมค์ไม่ได้: ' + (e.message || e.name), 3000, 'warn'); }
    };
    testBtn.onclick = startMeter;
    // resolution
    const est = h('b'), free = h('b'), freeSub = h('span');
    body.append(h('div', { class: 'lbl' }, 'ความละเอียด'), seg(RES, res, (v) => { res = v; prefs.rec.res = v; savePrefs(); upd(); }));
    body.append(h('div', { class: 'stats' }, h('div', {}, h('span', {}, 'ขนาดไฟล์โดยประมาณ'), est), h('div', {}, h('span', {}, 'พื้นที่ที่แอปใช้ได้'), free, freeSub)));
    let freeB = null;
    const upd = () => {
      const perMin = (BITRATE[res] + AUDIO_BPS) * 60 / 8;
      est.textContent = '≈ ' + fmtBytes(perMin) + ' / นาที';
      free.textContent = freeB == null ? '–' : fmtBytes(freeB);
      freeSub.textContent = freeB == null ? '' : ` (อัดได้ราว ${Math.floor(freeB / perMin / 60) >= 1 ? Math.floor(freeB / perMin / 60) + ' ชม.' : Math.floor(freeB / perMin) + ' นาที'})`;
    };
    freeSpace().then(v => { freeB = v; upd(); }); upd();
    const row = (label, ctl, sub) => h('div', { class: 'row' }, h('div', {}, h('div', {}, label), sub ? h('div', { class: 'sub' }, sub) : null), ctl);
    body.append(h('div', { style: { height: '6px' } }),
      row('เตือนเมื่ออัดนานเกิน 25 นาที', toggle(prefs.rec.warn25, v => { prefs.rec.warn25 = v; savePrefs(); })),
      row('รูปแบบไฟล์', h('span', { style: { color: 'var(--muted)' } }, mime ? (mime.includes('mp4') ? 'MP4' : 'WebM (เครื่องนี้ไม่รองรับ MP4)') : 'ค่าเริ่มต้นของเบราว์เซอร์')),
      row('ให้นาฬิกาจับเวลาติดไปในคลิป', toggle(this.app.timer.s.inClip, v => { this.app.timer.s.inClip = v; this.app.timer.save(); })));
    dialog('ตั้งค่าการอัดคลิป', body, [
      { label: 'ยกเลิก' },
      { label: 'เริ่มอัด', cls: 'danger', flex: 2, icon: 'rec', action: async () => { stopMeter(); await this.start(ed, res, mime); } },
    ], { width: 700, onClose: stopMeter });
  }

  async start(ed, res, mime) {
    // microphone
    let audio = null;
    try { audio = await navigator.mediaDevices.getUserMedia({ audio: prefs.rec.mic ? { deviceId: { exact: prefs.rec.mic }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) {
      if (!(await confirmBox('ใช้ไมค์ไม่ได้', 'อัดคลิปแบบไม่มีเสียงต่อไหม? (ตรวจการอนุญาตไมค์ใน การตั้งค่า > Safari > ไมโครโฟน)', { ok: 'อัดแบบไม่มีเสียง' }))) return;
    }
    // resolution with auto downgrade
    const order = ['2160', '1440', '1080', '720'];
    let idx = order.indexOf(res); if (idx < 0) idx = 2;
    let chosen = null;
    for (; idx < order.length; idx++) {
      const r = +order[idx];
      const scale = r / Math.min(ed.W, ed.H);
      ed.setRecordScale(scale);
      const okSize = ed.cvMain.width * ed.cvMain.height <= 16.7e6;
      if (!okSize) continue;
      const t0 = performance.now(); ed.redrawMain(); ed.redrawMain(); const tRedraw = (performance.now() - t0) / 2;
      const test = document.createElement('canvas'); test.width = ed.cvMain.width; test.height = ed.cvMain.height;
      const tc = test.getContext('2d'); const t1 = performance.now();
      for (let i = 0; i < 4; i++) { tc.drawImage(ed.cvMain, 0, 0); tc.drawImage(ed.cvLive, 0, 0); }
      tc.getImageData(0, 0, 1, 1);
      const tComp = (performance.now() - t1) / 4;
      if ((tRedraw < 60 && tComp < 12) || idx === order.length - 1) { chosen = order[idx]; break; }
    }
    if (chosen !== res) toast(`เครื่องนี้อัด ${res === '2160' ? '4K' : res + 'p'} ไม่ไหว จึงลดเป็น ${chosen === '2160' ? '4K' : chosen + 'p'}`, 3500, 'warn');
    this.res = chosen;
    const W = ed.cvMain.width & ~1, H = ed.cvMain.height & ~1;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.ctx.fillStyle = '#fff'; this.ctx.fillRect(0, 0, W, H);
    const vstream = this.canvas.captureStream(prefs.rec.fps || 30);
    const tracks = [...vstream.getVideoTracks(), ...(audio ? audio.getAudioTracks() : [])];
    this.stream = new MediaStream(tracks); this.audio = audio;
    const opts = { videoBitsPerSecond: BITRATE[chosen], audioBitsPerSecond: AUDIO_BPS };
    if (mime) opts.mimeType = mime;
    let mr;
    try { mr = new MediaRecorder(this.stream, opts); } catch { mr = new MediaRecorder(this.stream); }
    this.mr = mr; this.mime = mr.mimeType || mime || 'video/webm';
    this.recId = uid(); this.seq = 0; this.bytes = 0; this.writes = [];
    const meta = { id: this.recId, name: `${this.app.editor?.nb?.name || 'เส้นคิด'}`, nb: ed.nb.id, created: Date.now(), mime: this.mime, res: chosen, w: W, h: H, duration: 0, size: 0, done: false };
    this.meta = meta; await db.put('recs', meta);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) { this.bytes += e.data.size; this.writes.push(db.addChunk(this.recId, this.seq++, e.data).catch(err => console.error(err))); } };
    mr.onerror = (e) => { toast('การอัดผิดพลาด: ' + (e.error?.message || ''), 4000, 'warn'); this.stop(); };
    mr.start(3000);
    this.state = 'recording'; this.t0 = performance.now(); this.pausedTotal = 0; this.warned = false;
    this.paint(ed);
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch { }
    this.tick = setInterval(() => this.onTick(), 250);
    this.syncButton();
    toast('เริ่มอัดแล้ว · แตะปุ่มแดงเพื่อหยุดชั่วคราวหรือหยุด', 2600);
  }
  paint(ed) {
    const c = this.ctx; if (!c) return;
    c.globalCompositeOperation = 'source-over';
    c.drawImage(ed.cvMain, 0, 0, this.canvas.width, this.canvas.height);
    if (ed.live) { c.globalCompositeOperation = ed.live.kind === 'hl' && !ed.darkPaper ? 'multiply' : 'source-over'; c.drawImage(ed.cvLive, 0, 0, this.canvas.width, this.canvas.height); c.globalCompositeOperation = 'source-over'; }
    if (ed.laser && ed.laser.length) c.drawImage(ed.cvLaser, 0, 0, this.canvas.width, this.canvas.height);
    this.app.timer?.drawInto(c, this.canvas.width / ed.W, this.canvas.width, this.canvas.height);
  }
  frame(ed) { if (this.state === 'recording') this.paint(ed); }
  onTick() {
    const ed = this.app.editor;
    const t = fmtTime(this.elapsed());
    const tEl = ed?.recBtn?.querySelector('.t'); if (tEl) tEl.textContent = t;
    const tf = ed?.recFloat?.querySelector('.t'); if (tf) tf.textContent = t;
    if (prefs.rec.warn25 && !this.warned && this.elapsed() > 25 * 60 * 1000) { this.warned = true; toast('อัดมาเกิน 25 นาทีแล้ว คลิปยาวอาจแชร์หรืออัปโหลดลำบาก', 6000, 'warn'); }
  }
  pause() { if (this.state !== 'recording') return; try { this.mr.pause(); } catch { } this.state = 'paused'; this.pauseAt = performance.now(); this.syncButton(); }
  resume() { if (this.state !== 'paused') return; try { this.mr.resume(); } catch { } this.pausedTotal += performance.now() - this.pauseAt; this.state = 'recording'; this.syncButton(); }
  async stop() {
    if (this.state === 'idle') return;
    const bz = busy('กำลังบันทึกคลิป…', 'รอสักครู่ อย่าเพิ่งปิดแอป');
    try { await this._stop(); } finally { bz.done(); }
    await showRecording(this.meta, true);
  }
  async _stop() {
    const dur = this.elapsed();
    const stopped = new Promise(r => { this.mr.onstop = r; setTimeout(r, 4000); });
    try { if (this.mr.state !== 'inactive') this.mr.stop(); } catch { }
    await stopped;
    clearInterval(this.tick);
    this.stream?.getTracks().forEach(t => t.stop());
    try { await this.wake?.release(); } catch { }
    this.state = 'idle'; this.ctx = null;
    const ed = this.app.editor; if (ed) { ed.setRecordScale(0); }
    this.syncButton();
    await Promise.all(this.writes);
    Object.assign(this.meta, { duration: dur, size: this.bytes, done: true });
    await db.put('recs', this.meta);
  }
}

export function pickAudioMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { } }
  return '';
}

// Audio-only recording tied to a notebook (Goodnotes-style mic button)
export class AudioRecorder {
  constructor(app) { this.app = app; this.state = 'idle'; }
  get active() { return this.state !== 'idle'; }
  elapsed() { if (!this.t0) return 0; const now = this.state === 'paused' ? this.pauseAt : performance.now(); return now - this.t0 - this.pausedTotal; }
  syncButton() {
    const b = this.app.editor?.micBtn; if (!b) return;
    b.classList.toggle('mic-live', this.state === 'recording');
    b.classList.toggle('mic-paused', this.state === 'paused');
    b.querySelector('.mt')?.remove();
    if (this.active) b.append(h('span', { class: 'mt' }, fmtTime(this.elapsed())));
    b.title = this.active ? 'กำลังอัดเสียง' : 'อัดเสียง';
  }
  click(ed, btn) {
    if (this.state === 'idle') return this.start(ed);
    const box = h('div', { class: 'menu' });
    const mk = (ic, label, fn, danger) => { const b = h('button', { class: 'mi' + (danger ? ' danger' : '') }, icon(ic), h('span', {}, label)); b.onclick = () => { close(); fn(); }; box.append(b); };
    box.append(h('div', { class: 'mh' }, `อัดเสียง ${fmtTime(this.elapsed())}`));
    if (this.state === 'recording') mk('pause', 'หยุดชั่วคราว', () => this.pause()); else mk('play', 'อัดต่อ', () => this.resume());
    mk('stop', 'หยุดและบันทึกเสียง', () => this.stop(), true);
    const close = popover(btn, box, ed.popOpts());
  }
  async start(ed) {
    if (typeof MediaRecorder === 'undefined') { toast('เบราว์เซอร์นี้อัดเสียงไม่ได้', 3000, 'warn'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: prefs.rec.mic ? { deviceId: { exact: prefs.rec.mic }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast('เปิดไมค์ไม่ได้: ' + (e.message || e.name) + ' (ตรวจการอนุญาตไมค์ในการตั้งค่า Safari)', 4000, 'warn'); return; }
    const mime = pickAudioMime();
    let mr; try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : undefined); } catch { mr = new MediaRecorder(stream); }
    this.stream = stream; this.mr = mr; this.recId = uid(); this.seq = 0; this.bytes = 0; this.writes = [];
    const d = new Date();
    this.meta = { id: this.recId, kind: 'audio', name: `${ed.nb.name} · เสียง ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} น.`, nb: ed.nb.id, page: ed.currentPage()?.id, created: Date.now(), mime: mr.mimeType || mime || 'audio/webm', duration: 0, size: 0, done: false };
    await db.put('recs', this.meta);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) { this.bytes += e.data.size; this.writes.push(db.addChunk(this.recId, this.seq++, e.data).catch(console.error)); } };
    mr.start(3000);
    this.state = 'recording'; this.t0 = performance.now(); this.pausedTotal = 0;
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch { }
    this.tick = setInterval(() => { const m = this.app.editor?.micBtn?.querySelector('.mt'); if (m) m.textContent = fmtTime(this.elapsed()); }, 300);
    this.syncButton();
    toast('เริ่มอัดเสียงแล้ว · แตะปุ่มไมค์เพื่อหยุด', 2200);
  }
  pause() { if (this.state !== 'recording') return; try { this.mr.pause(); } catch { } this.state = 'paused'; this.pauseAt = performance.now(); this.syncButton(); }
  resume() { if (this.state !== 'paused') return; try { this.mr.resume(); } catch { } this.pausedTotal += performance.now() - this.pauseAt; this.state = 'recording'; this.syncButton(); }
  async stop() {
    if (this.state === 'idle') return;
    const dur = this.elapsed();
    const stopped = new Promise(r => { this.mr.onstop = r; setTimeout(r, 3000); });
    try { if (this.mr.state !== 'inactive') this.mr.stop(); } catch { }
    await stopped; clearInterval(this.tick);
    this.stream.getTracks().forEach(t => t.stop());
    try { await this.wake?.release(); } catch { }
    this.state = 'idle'; this.syncButton();
    await Promise.all(this.writes);
    Object.assign(this.meta, { duration: dur, size: this.bytes, done: true });
    await db.put('recs', this.meta);
    toast(`บันทึกเสียงแล้ว (${fmtTime(dur)}) · ฟังได้ที่ปุ่มส่งออก > เสียงที่อัดในสมุดเล่มนี้`, 3500);
  }
}

export async function recBlob(meta) {
  const chunks = (await db.chunksOf(meta.id)).sort((a, b) => a.seq - b.seq).map(c => c.blob);
  return new Blob(chunks, { type: (meta.mime || (meta.kind === 'audio' ? 'audio/mp4' : 'video/mp4')).split(';')[0] });
}
function fileName(meta) {
  const d = new Date(meta.created), p = (n) => String(n).padStart(2, '0');
  return `senkid-${meta.kind === 'audio' ? 'audio' : 'clip'}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${extOf(meta.mime)}`;
}
export async function saveRecording(meta) { const bz = busy('กำลังเตรียมไฟล์…'); let b; try { b = await recBlob(meta); } finally { bz.done(); } downloadBlob(b, fileName(meta)); }
export async function shareRecording(meta) {
  const bz = busy('กำลังเตรียมไฟล์…'); let b; try { b = await recBlob(meta); } finally { bz.done(); }
  const f = new File([b], fileName(meta), { type: b.type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: meta.name }); } catch (e) { if (e.name !== 'AbortError') toast('แชร์ไม่สำเร็จ: ' + e.message, 3000, 'warn'); }
  } else { downloadBlob(b, f.name); toast('เครื่องนี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลดไฟล์แทน', 3000); }
}

export async function showRecording(meta, fresh) {
  const bz = busy('กำลังเปิดคลิป…'); let blob; try { blob = await recBlob(meta); } finally { bz.done(); }
  const url = URL.createObjectURL(blob);
  const body = h('div');
  if (meta.kind === 'audio') body.append(h('audio', { src: url, controls: true, style: { width: '100%', marginTop: '8px' } }));
  else body.append(h('video', { class: 'preview', src: url, controls: true, playsinline: true }));
  body.append(h('div', { class: 'stats' },
    h('div', {}, h('span', {}, 'ความยาว'), h('b', {}, fmtTime(meta.duration || 0))),
    h('div', {}, h('span', {}, 'ขนาดไฟล์'), h('b', {}, fmtBytes(blob.size) + (meta.kind === 'audio' ? ' · เสียง' : ' · ' + (meta.res === '2160' ? '4K' : meta.res + 'p'))))));
  body.append(h('p', { style: { fontSize: '19px', color: 'var(--muted)', margin: '12px 0 0' } }, 'คลิปเก็บไว้ในแอปแล้ว เปิดดูอีกครั้งได้ที่เมนู ⋯ > คลิปที่อัดไว้ · บน iPad กด "แชร์" แล้วเลือก "บันทึกวิดีโอ" เพื่อเก็บลงแอปรูปภาพ'));
  dialog(fresh ? 'อัดคลิปเสร็จแล้ว' : meta.name, body, [
    { label: 'บันทึกไฟล์', icon: 'download', action: () => { saveRecording(meta); return false; } },
    { label: meta.kind === 'audio' ? 'แชร์ / ส่งต่อ' : 'แชร์ / บันทึกลงรูปภาพ', icon: 'share', cls: 'prim', flex: 2, action: () => { shareRecording(meta); return false; } },
  ], { width: 760, onClose: () => URL.revokeObjectURL(url) });
}

export async function openRecordings(nb) {
  const recs = (await db.getAll('recs')).filter(r => !nb || (r.nb === nb && r.kind === 'audio')).sort((a, b) => b.created - a.created);
  const list = h('div', { class: 'reclist' });
  const render = () => {
    list.innerHTML = '';
    if (!recs.length) { list.append(h('p', { style: { color: 'var(--muted)', textAlign: 'center', padding: '30px 0' } }, nb ? 'สมุดเล่มนี้ยังไม่มีเสียงที่อัดไว้ · แตะปุ่มไมค์บนแถบเครื่องมือเพื่อเริ่มอัด' : 'ยังไม่มีคลิปหรือเสียงที่อัดไว้')); return; }
    for (const m of recs) {
      const d = new Date(m.created);
      const it = h('div', { class: 'item' },
        icon(m.kind === 'audio' ? 'mic' : 'film'),
        h('div', { class: 'meta' }, h('b', {}, m.name), h('div', {}, `${d.toLocaleDateString('th-TH')} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ${fmtTime(m.duration || 0)} · ${fmtBytes(m.size)}${m.done ? '' : ' · ไม่สมบูรณ์ (กู้คืนจากการอัดที่ค้าง)'}`)));
      const B = (ic, t, fn) => { const b = h('button', { class: 'btn sq', title: t }, icon(ic)); b.onclick = fn; return b; };
      it.append(B('play', 'เปิดดู', () => showRecording(m)), B('download', 'บันทึกไฟล์', () => saveRecording(m)), B('share', 'แชร์', () => shareRecording(m)),
        B('trash', 'ลบ', async () => { if (await confirmBox('ลบคลิปนี้?', 'ลบแล้วกู้คืนไม่ได้', { ok: 'ลบ', danger: true })) { await db.deleteRec(m.id); recs.splice(recs.indexOf(m), 1); render(); } }));
      list.append(it);
    }
  };
  render();
  dialog(nb ? 'เสียงที่อัดในสมุดเล่มนี้' : 'คลิปและเสียงที่อัดไว้', list, [], { width: 720 });
}
