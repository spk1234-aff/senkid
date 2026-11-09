// เส้นคิด (Senkid) © 2026 นายศาสตราวุฒิ อาชนะชัย · โรงเรียนโซ่พิสัยพิทยาคม · สงวนลิขสิทธิ์ ดู LICENSE.md
// Records ONLY the paper area (main + live canvases) + microphone audio.
import { h, icon, toast, dialog, popover, seg, toggle, fmtBytes, fmtTime, downloadBlob, confirmBox, uid, busy } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import { connected as syncOn, hasFileScope, uploadRecording, driveFileUrl, deleteDriveFile, signIn, scheduleSync } from './sync.js';
import * as db from './db.js';

const RES = [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']];
const BITRATE = { 720: 3e6, 1080: 5e6, 1440: 8e6, 2160: 12e6 };
const AUDIO_BPS = 128e3; // audio-only recordings use 96 kbps (see AudioRecorder)

// developer credit pill rendered for a frame of height H — every exported clip carries it
export function creditImage(H) {
  const px = Math.max(12, Math.round(H * 0.019)), text = 'สร้างด้วยเส้นคิด · พัฒนาโดย นายศาสตราวุฒิ อาชนะชัย โรงเรียนโซ่พิสัยพิทยาคม';
  const cv = document.createElement('canvas'), x = cv.getContext('2d');
  x.font = `${px}px "TH Sarabun New", sans-serif`;
  const w = Math.ceil(x.measureText(text).width), pad = Math.round(px * 0.5), hh = Math.round(px * 1.4);
  cv.width = w + pad * 2; cv.height = hh;
  x.fillStyle = 'rgba(30,32,38,0.38)'; const r = hh / 2;
  x.beginPath(); x.moveTo(r, 0); x.arcTo(cv.width, 0, cv.width, hh, r); x.arcTo(cv.width, hh, 0, hh, r); x.arcTo(0, hh, 0, 0, r); x.arcTo(0, 0, cv.width, 0, r); x.fill();
  x.font = `${px}px "TH Sarabun New", sans-serif`; x.fillStyle = 'rgba(255,255,255,0.92)'; x.textBaseline = 'middle'; x.fillText(text, pad, hh / 2 + px * 0.04);
  return cv;
}
export function drawCredit(ctx, W, H, img) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(img, W - img.width - Math.round(H * 0.012), H - img.height - Math.round(H * 0.01)); ctx.restore(); }
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

  async settings(ed, btn, audioOnly = false) {
    if (!canRecord() && !audioOnly) { dialog('อัดคลิปไม่ได้', h('p', {}, 'เบราว์เซอร์นี้ไม่รองรับการอัดคลิป ลองใช้ Safari บน iPad (iPadOS 16 ขึ้นไป) หรือ Chrome รุ่นล่าสุด'), [{ label: 'ปิด', cls: 'prim' }]); return; }
    const mime = pickMime();
    let res = prefs.rec.res;
    const body = h('div');
    const ratio = ed.W / ed.H;
    if (audioOnly) body.append(h('div', { class: 'recprev' },
      h('div', { class: 'box', style: { width: '72px', height: '72px', display: 'grid', placeItems: 'center' } }, icon('mic')),
      h('div', { style: { fontSize: '21px' } }, 'อัด', h('b', {}, 'เสียงไมค์'), 'พร้อม', h('b', {}, 'ลายมือทุกเส้น'), 'ที่เขียนระหว่างอัด', h('br'),
        h('span', { style: { color: 'var(--muted)' } }, 'ดูย้อนหลังได้จาก "คลิปที่อัดไว้" แล้วส่งออกเป็นวิดีโอ MP4 ได้ภายหลัง · ไฟล์เล็กมาก (≈ 1 MB/นาที)'))));
    else body.append(h('div', { class: 'recprev' },
      h('div', { class: 'box', style: { aspectRatio: ratio, width: ratio >= 1 ? '120px' : 'auto', height: ratio >= 1 ? 'auto' : '100px' } }, icon('pages')),
      h('div', { style: { fontSize: '21px' } }, 'คลิปจะมีแค่', h('b', {}, 'พื้นที่กระดาษ'), 'กับ', h('b', {}, 'เสียงไมค์'), h('br'),
        h('span', { style: { color: 'var(--muted)' } }, 'ไม่มีแถบเครื่องมือ เมนู แถบสถานะ หรือแจ้งเตือนติดไปด้วย ซูมหรือเลื่อนหน้าระหว่างอัดได้ตามปกติ'))));
    // mic
    const micSel = h('select', { class: 'field' }, h('option', { value: '' }, 'ไมค์เริ่มต้นของเครื่อง'));
    const meter = h('div', { class: 'meter' }); for (let i = 0; i < 26; i++) meter.append(h('span'));
    const testBtn = h('button', { class: 'pill sec', style: { flex: 'none' } }, icon('mic'), 'ทดสอบไมค์');
    const refreshBtn = h('button', { class: 'pill sec', style: { flex: 'none' }, title: 'ค้นหาไมค์ใหม่ (หลังเสียบไมค์แยก)' }, icon('sync'));
    const micSub = h('div', { class: 'sub', style: { marginTop: '4px' } });
    body.append(h('div', { class: 'lbl' }, 'ไมโครโฟน'), h('div', { style: { display: 'flex', gap: '8px' } }, micSel, refreshBtn, testBtn), micSub, meter);
    const fillMics = async (askPerm = false) => {
      try {
        let devs = await listMics();
        // labels are blank until the mic permission was granted once; ask (briefly) so the teacher can tell the mics apart
        if (askPerm && (!devs.length || devs.every(d => !d.label))) { await primeDevices(!!devs.length); devs = await listMics(); }
        micSel.innerHTML = ''; micSel.append(h('option', { value: '' }, 'ไมค์เริ่มต้นของเครื่อง'));
        devs.forEach((d, i) => micSel.append(h('option', { value: d.deviceId }, d.label || `ไมค์ ${i + 1}`)));
        const cur = await resolveMic();
        micSel.value = cur ? cur.deviceId : '';
        const missing = !cur && prefs.rec.micLabel;
        micSub.textContent = missing ? `ไม่พบไมค์ "${prefs.rec.micLabel}" ตอนนี้ · ถ้าเสียบแล้วจะกลับมาใช้ให้เอง` : devs.length > 1 ? `พบไมค์ ${devs.length} ตัว · ตัวที่เลือกจะถูกจำไว้ แม้ถอดแล้วเสียบใหม่` : devs.length === 1 && devs[0].label ? `พบ: ${devs[0].label}` : 'เสียบไมค์แยกแล้วกดปุ่มรีเฟรชหากยังไม่ขึ้นในรายการ';
        micSub.style.color = missing ? 'var(--warn, #b45309)' : '';
      } catch { }
    };
    fillMics(true);
    refreshBtn.onclick = () => fillMics(true);
    if (audioOnly && !prefs.studentUI) {
      // teacher camera: off / a camera; shape; live preview of the exact size and place it will take
      const camSel = h('select', { class: 'sel', style: { flex: 1 } });
      const camShape = seg([['circle', 'วงกลม'], ['round', 'สี่เหลี่ยมมน']], prefs.rec.camShape || 'circle', v => { prefs.rec.camShape = v; savePrefs(); for (const el of document.querySelectorAll('video.campip')) el.className = 'campip ' + v; });
      const camSize = seg([['110', 'เล็ก'], ['150', 'กลาง'], ['210', 'ใหญ่']], String(prefs.rec.camSize || 150), v => { prefs.rec.camSize = +v; savePrefs(); if (this.camTest) startCamPreview(); });
      const camRes = seg([['480', 'ปกติ 480p'], ['720', 'คม 720p']], String(prefs.rec.camRes || 480), v => { prefs.rec.camRes = +v; savePrefs(); }); this._camResCtl = camRes;
      const camSub = h('div', { class: 'sub', style: { marginTop: '4px' } }, 'ปิดอยู่ · จะอัดเสียงกับลายมืออย่างเดียว');
      const camRefresh = h('button', { class: 'pill sec', style: { flex: 'none' }, title: 'ค้นหากล้องใหม่ (หลังเสียบกล้องนอก)' }, icon('sync'), 'ค้นหากล้อง');
      body.append(h('div', { class: 'lbl' }, 'กล้องครู (ภาพเล็กที่มุม)'), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, camSel, camRefresh), camSub,
        h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px', alignItems: 'center' } }, h('span', { class: 'sub' }, 'รูปทรง'), camShape, h('span', { class: 'sub' }, 'ขนาด'), camSize),
        h('p', { class: 'sub', style: { margin: '6px 0 0' } }, 'เปิดแล้วจะเห็นตัวเองเล็ก ๆ ที่มุมกระดาน ลากย้ายได้ ไม่ฉายขึ้นทีวี'));
      const fillCams = async (askPerm = false, force = false) => {
        let devs = await listCams();
        // Safari shows camera names only after the camera permission was granted once; ask when the teacher looks for a camera
        if ((force || askPerm) && (!devs.length || devs.every(d => !d.label))) { await primeDevices(force); devs = await listCams(); if (!devs.length) camSub.textContent = 'ไม่พบกล้อง · ถ้าเสียบกล้อง USB แล้ว ลองถอดเสียบใหม่แล้วกด "ค้นหากล้อง"'; }
        const names = devs.map((d, i) => camName(d, i)).join(', ');
        camSel._names = names;
        camSel.innerHTML = ''; camSel.append(h('option', { value: '' }, 'ปิด (ไม่อัดกล้อง)'));
        if (!devs.length) { camSel.append(h('option', { value: 'user' }, 'กล้องหน้า'), h('option', { value: 'environment' }, 'กล้องหลัง')); }
        devs.forEach((d, i) => camSel.append(h('option', { value: d.deviceId }, camName(d, i))));
        const cur = matchDev(devs, prefs.rec.cam, prefs.rec.camLabel);
        if (cur && cur.deviceId !== prefs.rec.cam) { prefs.rec.cam = cur.deviceId; savePrefs(); }
        camSel.value = cur ? cur.deviceId : (prefs.rec.cam === 'user' || prefs.rec.cam === 'environment') && !devs.length ? prefs.rec.cam : prefs.rec.cam && !cur ? '' : '';
        if (prefs.rec.cam && !cur && devs.length) { camSel.value = ''; }
        camSub.textContent = (camSel.value ? `เปิด: ${camSel.selectedOptions[0]?.textContent}` : prefs.rec.cam ? `ไม่พบกล้อง "${prefs.rec.camLabel || prefs.rec.cam}" ตอนนี้ · เสียบแล้วเลือกใหม่` : 'ปิดอยู่ · จะอัดเสียงกับลายมืออย่างเดียว') + (force ? ` · พบกล้อง ${devs.length} ตัว${names ? ': ' + names : ''}` : '');
      };
      camRefresh.onclick = () => fillCams(true, true);
      const startCamPreview = async () => { stopCamPreview(); if (!prefs.rec.cam) return; if (this.testStream) { this._meterRun = (this._meterRun || 0) + 1; cancelAnimationFrame(this.meterRaf); this.testStream.getTracks().forEach(t => t.stop()); this.testStream = null; this.testCtx?.close?.(); this.testCtx = null; micSub.textContent = 'หยุดทดสอบไมค์ชั่วคราวระหว่างเปิดกล้อง (iPad เปิดทีละอย่างในหน้าตั้งค่า) · ตอนอัดจริงจะเปิดพร้อมกัน'; } camSub.textContent = 'กำลังเปิดกล้อง…'; const st = await openCam(); if (!st) { camSub.textContent = 'เปิดกล้องไม่ได้: ' + camErrorText(openCam.lastError); camSub.style.color = 'var(--warn, #b45309)'; return; } camSub.style.color = ''; camSub.textContent = `เปิด: ${camSel.selectedOptions[0]?.textContent} · ${st.getVideoTracks()[0]?.getSettings?.().width || '?'}×${st.getVideoTracks()[0]?.getSettings?.().height || '?'}`; this.camTest = st; const stage = ed?.stage || document.body; showCamPip(stage, st, {}); };
      const stopCamPreview = () => { hideCamPip(); this.camTest?.getTracks().forEach(t => t.stop()); this.camTest = null; };
      camSel.onchange = () => { prefs.rec.cam = camSel.value; prefs.rec.camLabel = camSel.value ? (camSel.selectedOptions[0]?.textContent || '') : ''; savePrefs(); fillCams(); startCamPreview(); };
      fillCams(true); if (prefs.rec.cam) startCamPreview();
      const onDevC = () => fillCams(true); try { navigator.mediaDevices.addEventListener('devicechange', onDevC); } catch { }
      this._camCleanup = () => { stopCamPreview(); try { navigator.mediaDevices.removeEventListener('devicechange', onDevC); } catch { } };
    }
    const onDev = () => { fillMics(); if (!this.testStream) toast('อุปกรณ์เสียงเปลี่ยน · อัปเดตรายการไมค์แล้ว', 2000); };
    try { navigator.mediaDevices.addEventListener('devicechange', onDev); } catch { }
    micSel.onchange = () => { prefs.rec.mic = micSel.value; prefs.rec.micLabel = micSel.value ? (micSel.selectedOptions[0]?.textContent || '') : ''; savePrefs(); fillMics(); if (this.testStream) startMeter(); };
    const stopMeter = () => { try { this._camCleanup?.(); this._camCleanup = null; } catch { } try { navigator.mediaDevices.removeEventListener('devicechange', onDev); } catch { } cancelAnimationFrame(this.meterRaf); this.testStream?.getTracks().forEach(t => t.stop()); this.testStream = null; this.testCtx?.close?.(); this.testCtx = null; };
    const startMeter = async () => {
      stopMeter(); try { this.camTest?.getTracks().forEach(t => t.stop()); this.camTest = null; hideCamPip(); } catch { }
      const run = this._meterRun = (this._meterRun || 0) + 1; // a second tap (or iPad's devicechange when the USB mic opens) restarts us: the older run must not touch the new stream
      testBtn.disabled = true;
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: micSel.value ? { deviceId: { exact: micSel.value } } : true });
        if (run !== this._meterRun) { st.getTracks().forEach(t => t.stop()); return; }
        this.testStream = st;
        fillMics(); // refresh the labels in the background: never await it here (iOS reroutes audio while it runs)
        const AC = window.AudioContext || window.webkitAudioContext; this.testCtx = new AC();
        try { await this.testCtx.resume(); } catch { }
        if (run !== this._meterRun || this.testStream !== st) return;
        const an = this.testCtx.createAnalyser(); an.fftSize = 512; this.testCtx.createMediaStreamSource(st).connect(an);
        micSub.textContent = 'กำลังฟัง: ' + (st.getAudioTracks()[0]?.label || 'ไมค์เริ่มต้นของเครื่อง') + ' · พูดแล้วแถบจะขยับ';
        st.getAudioTracks()[0]?.addEventListener('ended', () => { if (this.testStream === st) { micSub.textContent = 'ไมค์ถูกตัดการเชื่อมต่อ (เครื่องสลับอุปกรณ์เสียง) · กดทดสอบไมค์อีกครั้ง'; stopMeter(); } });
        const buf = new Uint8Array(an.fftSize); const bars = [...meter.children];
        const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); const lv = Math.min(1, m / 90); bars.forEach((b, i) => { const on = i / bars.length < lv; b.style.background = on ? (i < 16 ? '#1E9E5A' : i < 21 ? '#F5B83D' : '#E5484D') : ''; }); this.meterRaf = requestAnimationFrame(loop); };
        loop();
      } catch (e) { if (run === this._meterRun) toast('เปิดไมค์ไม่ได้: ' + micErrorText(e), 4000, 'warn'); }
      finally { testBtn.disabled = false; }
    };
    testBtn.onclick = startMeter;
    // resolution
    const est = h('b'), free = h('b'), freeSub = h('span');
    if (!audioOnly) body.append(h('div', { class: 'lbl' }, 'ความละเอียด'), seg(RES, res, (v) => { res = v; prefs.rec.res = v; savePrefs(); upd(); }));
    const stats = h('div', { class: 'stats' }, h('div', {}, h('span', {}, 'ขนาดไฟล์โดยประมาณ'), est), h('div', {}, h('span', {}, 'พื้นที่ที่แอปใช้ได้'), free, freeSub));
    let freeB = null;
    const upd = () => {
      const perMin = (audioOnly ? 96e3 : BITRATE[res] + AUDIO_BPS) * 60 / 8;
      est.textContent = '≈ ' + fmtBytes(perMin) + ' / นาที';
      free.textContent = freeB == null ? '–' : fmtBytes(freeB);
      freeSub.textContent = freeB == null ? '' : ` (อัดได้ราว ${Math.floor(freeB / perMin / 60) >= 1 ? Math.floor(freeB / perMin / 60) + ' ชม.' : Math.floor(freeB / perMin) + ' นาที'})`;
    };
    freeSpace().then(v => { freeB = v; upd(); }); upd();
    const row = (label, ctl, sub) => h('div', { class: 'row' }, h('div', {}, h('div', {}, label), sub ? h('div', { class: 'sub' }, sub) : null), ctl);
    const adv = h('div', { class: 'advbox', hidden: true });
    const advBtn = h('button', { class: 'pill sec', style: { width: '100%', marginTop: '8px' }, onclick: () => { adv.hidden = !adv.hidden; advBtn.lastChild.textContent = adv.hidden ? ' ตั้งค่าเพิ่มเติม (Drive · ความคม · การเตือน)' : ' ซ่อนตั้งค่าเพิ่มเติม'; } }, icon('gear'), ' ตั้งค่าเพิ่มเติม (Drive · ความคม · การเตือน)');
    const chkBtn = h('button', { class: 'pill sec', style: { width: '100%', marginTop: '10px' }, onclick: () => { stopMeter(); deviceCheck(ed); } }, icon('mic'), ' ตรวจกล้องและไมค์ · บอกชัดว่าตัวไหนใช้ได้ ตัวไหนไม่ได้ เพราะอะไร');
    body.append(chkBtn, advBtn, adv);
    if (audioOnly && this._camResCtl) adv.append(row('ความคมของกล้องครู', this._camResCtl, '720p ไฟล์ใหญ่กว่าราว 2 เท่า'));
    adv.append(stats, h('div', { style: { height: '6px' } }),
      row(audioOnly ? 'เก็บไฟล์เสียงใน Google Drive' : 'เก็บคลิปใน Google Drive', toggle(prefs.rec.toDrive !== false && syncOn(), v => { prefs.rec.toDrive = v; savePrefs(); if (v) uploadPendingRecordings(); }), syncOn() ? 'อัดเสร็จแล้วส่งขึ้น Drive (โฟลเดอร์ เส้นคิด/คลิป) แล้วลบออกจากเครื่อง · ประหยัดพื้นที่ iPad' : 'ต้องเปิดซิงก์ผ่าน Google Drive ในตั้งค่าก่อน'),
      ...(audioOnly && !prefs.studentUI && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? [row('ถอดเสียงเป็นข้อความระหว่างอัด', toggle(!!prefs.rec.transcript, v => { prefs.rec.transcript = v; savePrefs(); }), 'ทดลอง · ใช้ระบบรู้จำเสียงของเครื่อง (ต้องมีเน็ต) ได้ข้อความคร่าว ๆ ไว้ค้นหา/ทำคำบรรยาย · บางเครื่องอาจทำให้ไมค์สะดุด ถ้าเป็นแบบนั้นให้ปิด')] : []),
      row('เวลาส่งขึ้น Drive', (() => { const sel = h('select', { class: 'sel' }, h('option', { value: 'night' }, 'กลางคืน 01:00–05:00 (ถ้าแอปเปิดอยู่)'), h('option', { value: 'bg' }, 'ทันทีหลังอัดเสร็จ'), h('option', { value: 'manual' }, 'กดส่งเองเท่านั้น')); sel.value = uploadMode(); sel.onchange = () => { prefs.rec.uploadMode = sel.value; savePrefs(); if (sel.value === 'bg') uploadPendingRecordings(); }; return sel; })(), 'คลิปเก็บลงเครื่องก่อนเสมอ เปิดเล่นได้ทันที · กลางคืน: เสียบชาร์จแล้วเปิดเส้นคิดค้างไว้ แอปจะส่งให้เอง · กดส่งเองได้ทุกเมื่อในคลังวิดีโอ'),
      ...(audioOnly ? [] : [row('เตือนเมื่ออัดนานเกิน 25 นาที', toggle(prefs.rec.warn25, v => { prefs.rec.warn25 = v; savePrefs(); }))]),
      ...(audioOnly ? [] : [row('รูปแบบไฟล์', h('span', { style: { color: 'var(--muted)' } }, mime ? (mime.includes('mp4') ? 'MP4' : 'WebM (เครื่องนี้ไม่รองรับ MP4)') : 'ค่าเริ่มต้นของเบราว์เซอร์')),
      row('ให้นาฬิกาจับเวลาติดไปในคลิป', toggle(this.app.timer.s.inClip, v => { this.app.timer.s.inClip = v; this.app.timer.save(); }))]));
    dialog(audioOnly ? 'ตั้งค่าการอัดเสียง + ลายมือ' : 'ตั้งค่าการอัดคลิป', body, [
      { label: 'ยกเลิก' },
      audioOnly ? { label: 'เริ่มอัดเสียง', cls: 'prim', flex: 2, icon: 'mic', action: async () => { stopMeter(); await this.app.audio.start(ed); } } : { label: 'เริ่มอัด', cls: 'danger', flex: 2, icon: 'rec', action: async () => { stopMeter(); await this.start(ed, res, mime); } },
    ], { width: 700, onClose: stopMeter });
  }

  async start(ed, res, mime) {
    // microphone
    let audio = null;
    try { audio = await openMic(); }
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
    const cr = this.creditImg();
    if (cr) c.drawImage(cr, this.canvas.width - cr.width - Math.round(this.canvas.height * 0.012), this.canvas.height - cr.height - Math.round(this.canvas.height * 0.01));
  }
  // developer credit, always in the clip (bottom-right, small)
  creditImg() { const H = this.canvas.height; if (this._cr && this._crH === H) return this._cr; this._cr = creditImage(H); this._crH = H; return this._cr; }
  frame(ed) { if (this.state === 'recording') this.paint(ed); }
  onTick() {
    const ed = this.app.editor;
    const t = fmtTime(this.elapsed());
    const tEl = ed?.recBtn?.querySelector('.t'); if (tEl) tEl.textContent = t;
    const tf = ed?.recFloat?.querySelector('.t'); if (tf) tf.textContent = t;
    if (prefs.rec.warn25 && !this.warned && this.elapsed() > 25 * 60 * 1000) { this.warned = true; toast('อัดมาเกิน 25 นาทีแล้ว คลิปยาวอาจแชร์หรืออัปโหลดลำบาก', 6000, 'warn'); }
  }
  pause() { if (this.state !== 'recording') return; try { this.mr.pause(); } catch { } try { this.cam?.mr.pause(); } catch { } this.state = 'paused'; this.pauseAt = performance.now(); this.syncButton(); }
  resume() { if (this.state !== 'paused') return; try { this.mr.resume(); } catch { } try { this.cam?.mr.resume(); } catch { } this.pausedTotal += performance.now() - this.pauseAt; this.state = 'recording'; this.syncButton(); }
  async stop() {
    if (this.state === 'idle') return;
    const bz = busy('กำลังบันทึกคลิป…', 'รอสักครู่ อย่าเพิ่งปิดแอป');
    try { await this._stop(); } finally { bz.done(); }
    const blob = uploadMode() === 'bg' ? await maybeUpload(this.meta) : null;
    await showRecording(this.meta, true, blob);
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

// the chosen microphone is a preference, not a requirement: iPadOS renews device ids, so a stale id must not stop the recording.
// We remember both id and label; when the id is gone (new session, re-plugged mic) we re-match by label, then fall back to default.

// iPadOS lists device NAMES only after this page has opened a capture once; before that the lists look empty or say
// "กล้อง 1". Warm up once per page with one combined request (mic + camera), so both lists are complete on first open.
let primed = null;
export async function primeDevices(force = false) {
  if (primed && !force) return primed;
  primed = (async () => {
    const stop = (st) => st && st.getTracks().forEach(t => t.stop());
    let okA = false, okV = false;
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); stop(st); okA = okV = true; } catch { }
    if (!okA) { try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); stop(st); okA = true; } catch { } }
    if (!okV) { try { const st = await navigator.mediaDevices.getUserMedia({ video: true }); stop(st); okV = true; } catch { } }
    // give iPadOS a moment to settle its audio route after the capture closed
    await new Promise(r => setTimeout(r, 250));
    return { okA, okV };
  })();
  return primed;
}
// match a remembered device by id, then by exact name, then by a name that merely contains it (USB hubs rename ports)
function matchDev(devs, id, label) {
  return devs.find(x => x.deviceId === id) || (label && (devs.find(x => x.label === label) || devs.find(x => x.label && label && (x.label.includes(label) || label.includes(x.label))))) || null;
}
export async function listMics() {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default'); } catch { return []; }
}
export async function resolveMic() {
  if (!prefs.rec.mic && !prefs.rec.micLabel) return null;
  const devs = await listMics();
  const d = matchDev(devs, prefs.rec.mic, prefs.rec.micLabel);
  if (d && d.deviceId !== prefs.rec.mic) { prefs.rec.mic = d.deviceId; savePrefs(); }
  return d || null;
}
export function micName(label) { return label || 'ไมค์เริ่มต้นของเครื่อง'; }
// open the chosen mic briefly and report the peak level heard (0..1) — the pre-class check uses it
export async function micProbe(ms = 2000) {
  let st; try { st = await openMic(); } catch (e) { return { err: e, peak: 0, label: '' }; }
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)(); const src = ac.createMediaStreamSource(st), an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const buf = new Float32Array(an.fftSize); let peak = 0; const t0 = performance.now();
    while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i])); await new Promise(r => setTimeout(r, 60)); }
    try { ac.close(); } catch { }
    return { peak, label: st._micLabel || '' };
  } finally { st.getTracks().forEach(t => t.stop()); }
}
// ---- teacher camera (small picture-in-picture while recording a lesson) ----
export async function listCams() {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && d.deviceId && d.deviceId !== 'default'); } catch { return []; }
}
export const camName = (d, i) => d.label || (i === 0 ? 'กล้องหน้า' : i === 1 ? 'กล้องหลัง' : `กล้อง ${i + 1}`);
// withAudio: ask for mic + camera in ONE getUserMedia. iPadOS interrupts a capture that is already running whenever a
// second capture starts (the mic goes silent or the camera stops) — one combined request avoids that.
export async function openCam(withAudio = null) {
  const want = prefs.rec.cam; if (!want) return null;
  const hd = (prefs.rec.camRes || 480) >= 720;
  const vid = { width: { ideal: hd ? 1280 : 640 }, height: { ideal: hd ? 720 : 480 }, frameRate: { ideal: 24, max: 30 } };
  const devs = await listCams();
  const d = matchDev(devs, want, prefs.rec.camLabel);
  const tries = [];
  // external (USB) cameras on iPad are picky about size constraints: ask for the device alone first, then with sizes
  if (d) tries.push(hd ? { ...vid, deviceId: { exact: d.deviceId } } : { deviceId: { exact: d.deviceId } }, { deviceId: { exact: d.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, { ...vid, deviceId: { exact: d.deviceId } }, { deviceId: { exact: d.deviceId } });
  if (want === 'user' || want === 'environment' || !d) tries.push({ ...vid, facingMode: want === 'environment' ? 'environment' : 'user' });
  if (!d) tries.push(vid);
  openCam.lastError = null;
  for (const c of tries) {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: c, audio: withAudio || false });
      // some external cameras hand over a track that never delivers frames: wait briefly for the first frame
      const ok = await firstFrame(st, 2500);
      if (ok) return st;
      st.getTracks().forEach(t => t.stop()); openCam.lastError = { name: 'NoFrames', message: 'กล้องเปิดได้แต่ไม่ส่งภาพ' };
    } catch (e) { console.warn('cam', e); openCam.lastError = e; }
  }
  return null;
}
function firstFrame(stream, ms) {
  return new Promise((res) => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream; v.style.cssText = 'position:fixed;left:-9999px;width:64px';
    document.body.append(v); let done = false;
    const fin = (ok) => { if (done) return; done = true; v.srcObject = null; v.remove(); res(ok); };
    const tick = () => { if (done) return; if (v.videoWidth > 0 && v.readyState >= 2) return fin(true); requestAnimationFrame(tick); };
    v.play().then(tick).catch(() => tick()); setTimeout(() => fin(false), ms);
  });
}
export function camErrorText(e) {
  if (!e) return '';
  const n = e.name || '';
  if (n === 'NotAllowedError') return 'ไม่ได้รับอนุญาตให้ใช้กล้อง · ตั้งค่า iPad > Safari > กล้อง = อนุญาต (หรือ ตั้งค่า > แอปเส้นคิด)';
  if (n === 'NotReadableError' || n === 'AbortError') return 'กล้องถูกแอปอื่นใช้อยู่ (เช่น FaceTime) · ปิดแอปนั้นแล้วลองใหม่';
  if (n === 'OverconstrainedError') return 'กล้องไม่รองรับค่าที่ขอ';
  if (n === 'NotFoundError') return 'ไม่พบกล้องแล้ว · ตรวจสายและฮับ';
  if (n === 'NoFrames') return 'กล้องเปิดได้แต่ไม่ส่งภาพ (Safari ยังรับภาพจากกล้องนี้ไม่ได้) · ลองถอด-เสียบใหม่ หรือใช้กล้องในตัว';
  return `${n} ${e.message || ''}`.trim();
}
export function pickCamMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { } }
  return '';
}
// the floating camera preview (draggable, shape = circle / rounded square); position is remembered as a fraction of the stage
export function showCamPip(stage, stream, { shape = prefs.rec.camShape || 'circle', mirror = true } = {}) {
  hideCamPip();
  const v = h('video', { class: 'campip ' + shape, autoplay: true, muted: true, playsinline: true, 'data-nomirror': '1' });
  v.muted = true; v.srcObject = stream; v.play?.().catch(() => { });
  if (mirror) v.style.transform = 'scaleX(-1)';
  const pos = prefs.rec.camPos || { x: 0.985, y: 0.985 }; // bottom-right by default
  const size = prefs.rec.camSize || 150;
  v.style.width = v.style.height = size + 'px';
  const place = () => { const W = stage.clientWidth, H = stage.clientHeight; v.style.left = Math.max(0, Math.min(W - size, pos.x * W - size)) + 'px'; v.style.top = Math.max(0, Math.min(H - size, pos.y * H - size)) + 'px'; };
  place(); stage.append(v);
  let drag = null;
  v.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, dx: e.clientX - v.offsetLeft, dy: e.clientY - v.offsetTop }; v.setPointerCapture(e.pointerId); e.stopPropagation(); e.preventDefault(); });
  v.addEventListener('pointermove', (e) => { if (!drag || drag.id !== e.pointerId) return; const W = stage.clientWidth, H = stage.clientHeight; const l = Math.max(0, Math.min(W - size, e.clientX - drag.dx)), t = Math.max(0, Math.min(H - size, e.clientY - drag.dy)); v.style.left = l + 'px'; v.style.top = t + 'px'; pos.x = (l + size) / W; pos.y = (t + size) / H; e.stopPropagation(); });
  const up = (e) => { if (drag && drag.id === e.pointerId) { drag = null; prefs.rec.camPos = { x: pos.x, y: pos.y }; savePrefs(); } };
  v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up);
  v._place = place; addEventListener('resize', place);
  return v;
}
export function hideCamPip() { for (const v of document.querySelectorAll('video.campip')) { removeEventListener('resize', v._place); v.srcObject = null; v.remove(); } }


// ---- one-tap device check: opens mic + camera the way a real recording does, reports what works and why not ----
export async function deviceCheck(ed) {
  const lines = [], rows = [];
  const body = h('div', { class: 'devchk' });
  const row = (ok, title, sub) => { const r = h('div', { class: 'dc-row ' + (ok === null ? 'wait' : ok ? 'ok' : 'bad') }, h('span', { class: 'dc-ico' }, ok === null ? '…' : ok ? '✓' : '✕'), h('div', {}, h('div', { class: 'dc-t' }, title), h('div', { class: 'dc-s' }, sub || ''))); body.append(r); rows.push(r); lines.push(`${ok === null ? '…' : ok ? 'OK ' : 'FAIL'} ${title}${sub ? ' — ' + sub : ''}`); return r; };
  const set = (r, ok, title, sub) => { r.className = 'dc-row ' + (ok ? 'ok' : 'bad'); r.firstChild.textContent = ok ? '✓' : '✕'; r.lastChild.firstChild.textContent = title; r.lastChild.lastChild.textContent = sub || ''; const i = rows.indexOf(r); lines[i] = `${ok ? 'OK ' : 'FAIL'} ${title}${sub ? ' — ' + sub : ''}`; };
  const report = h('textarea', { class: 'dc-rep', readonly: true, rows: 6 });
  const VER = (await import('./main.js')).VERSION;
  const upd = () => { report.value = [`เส้นคิด ${VER} · ${new Date().toLocaleString('th-TH')}`, navigator.userAgent, `standalone=${matchMedia('(display-mode: standalone)').matches}`, ...lines].join('\n'); };
  let streams = [];
  const stopAll = () => { streams.forEach(st => st.getTracks().forEach(t => t.stop())); streams = []; hideCamPip(); };
  const btns = [{ label: 'ปิด' }, { label: 'คัดลอกรายงาน', cls: 'prim', icon: 'copy', keep: true, action: async () => { try { await navigator.clipboard.writeText(report.value); toast('คัดลอกแล้ว · วางส่งให้ผู้พัฒนาได้เลย', 2500); } catch { report.select(); toast('กดค้างที่ข้อความแล้วเลือก "คัดลอก"', 3000); } } }];
  dialog('ตรวจกล้องและไมค์', body, btns, { width: 640, onClose: stopAll });
  const errTxt = (e) => (e?.name || '') + (e?.message ? ': ' + e.message : '');
  // 1) permissions + device list
  let mics = [], cams = [];
  try { const all = await navigator.mediaDevices.enumerateDevices(); mics = all.filter(d => d.kind === 'audioinput'); cams = all.filter(d => d.kind === 'videoinput'); } catch (e) { row(false, 'อ่านรายชื่ออุปกรณ์ไม่ได้', errTxt(e)); }
  const named = (l) => l.filter(d => d.label).map(d => d.label);
  row(mics.length > 0, `ไมค์ที่เครื่องเห็น: ${mics.length} ตัว`, named(mics).join(' · ') || (mics.length ? 'ยังไม่ได้อนุญาต จึงไม่เห็นชื่อ' : 'ไม่พบไมค์เลย · ตรวจสาย/hub'));
  row(cams.length > 0, `กล้องที่เครื่องเห็น: ${cams.length} ตัว`, named(cams).join(' · ') || (cams.length ? 'ยังไม่ได้อนุญาต จึงไม่เห็นชื่อ' : 'ไม่พบกล้องเลย · ตรวจสาย/hub'));
  upd();
  // 2) mic alone
  const rm = row(null, 'เปิดไมค์', 'กำลังเปิด…'); upd();
  let micSt = null;
  try { micSt = await openMic(); streams.push(micSt); } catch (e) { set(rm, false, 'เปิดไมค์ไม่ได้', micErrorText(e) + '  [' + errTxt(e) + ']'); }
  if (micSt) {
    const tr = micSt.getAudioTracks()[0];
    // listen 2.5 s for level
    let peak = 0;
    try { const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(); await ctx.resume().catch(() => { }); const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(micSt).connect(an); const buf = new Uint8Array(an.fftSize); const t0 = Date.now(); set(rm, true, 'ไมค์เปิดได้: ' + (tr?.label || 'ไมค์เริ่มต้น'), 'พูดอะไรก็ได้ 3 วินาที…'); while (Date.now() - t0 < 3000) { an.getByteTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); await new Promise(r => setTimeout(r, 100)); } ctx.close(); } catch (e) { set(rm, false, 'ไมค์เปิดได้แต่วัดเสียงไม่ได้', errTxt(e)); }
    const live = tr && tr.readyState === 'live' && !tr.muted;
    set(rm, live && peak > 3, (live ? 'ไมค์ใช้งานได้: ' : 'ไมค์ถูกตัด: ') + (tr?.label || 'ไมค์เริ่มต้น'), `ระดับเสียงสูงสุด ${peak} ${peak <= 3 ? '(เงียบสนิท · ไมค์ปิดอยู่ หรือเครื่องส่งเสียงไปอีกตัว)' : ''}${tr?.muted ? ' · ระบบ mute' : ''}`);
  }
  upd();
  // 3) camera while the mic is still open (what happens in a real recording)
  const wantCam = prefs.rec.cam && !prefs.studentUI;
  if (!wantCam) row(true, 'กล้องครู: ปิดอยู่ในตั้งค่า', 'ถ้าต้องการอัดกล้องด้วย เลือกกล้องในตั้งค่าการอัดก่อน');
  else {
    const rc = row(null, 'เปิดกล้องพร้อมไมค์ (แบบเดียวกับตอนอัด)', 'กำลังเปิด…'); upd();
    let both = null; try { both = await openCam(await micConstraints()); } catch (e) { openCam.lastError = e; }
    if (both) {
      streams.push(both);
      const v = both.getVideoTracks()[0], a = both.getAudioTracks()[0], s = v?.getSettings?.() || {};
      set(rc, true, 'กล้อง + ไมค์เปิดพร้อมกันได้', `${v?.label || 'กล้อง'} ${s.width || '?'}×${s.height || '?'} · ไมค์ ${a?.label || '-'}`);
      try { showCamPip(ed?.stage || document.body, both, {}); } catch { }
      // did the first mic stream survive?
      const t1 = micSt?.getAudioTracks()[0];
      if (t1) row(t1.readyState === 'live' && !t1.muted, t1.readyState === 'live' && !t1.muted ? 'ไมค์ตัวแรกยังทำงานหลังเปิดกล้อง' : 'ไมค์ตัวแรกถูกตัดเมื่อเปิดกล้อง', (t1.readyState === 'live' && !t1.muted) ? 'ดี · เครื่องนี้เปิดสองอย่างซ้อนกันได้' : t1.readyState + (t1.muted ? ' muted' : '') + ' · iPad ตัดการจับเสียงเดิมเมื่อเปิดกล้อง แอปจึงเปิดทั้งคู่ในคำขอเดียวตอนอัดจริง');
    } else {
      set(rc, false, 'เปิดกล้องพร้อมไมค์ไม่ได้', camErrorText(openCam.lastError) + '  [' + errTxt(openCam.lastError) + ']');
      const r2 = row(null, 'ลองเปิดกล้องอย่างเดียว', 'กำลังเปิด…'); upd();
      stopAll();
      const only = await openCam();
      if (only) { streams.push(only); const v = only.getVideoTracks()[0]; set(r2, true, 'กล้องอย่างเดียวเปิดได้: ' + (v?.label || ''), 'แสดงว่ากล้องดี แต่เปิดคู่กับไมค์ไม่ได้ → มักเป็นไฟเลี้ยง hub ไม่พอ หรือ iPad สลับช่องเสียง'); try { showCamPip(ed?.stage || document.body, only, {}); } catch { } }
      else set(r2, false, 'กล้องอย่างเดียวก็เปิดไม่ได้', camErrorText(openCam.lastError) + '  [' + errTxt(openCam.lastError) + ']');
    }
  }
  upd();
  body.append(h('div', { class: 'lbl', style: { marginTop: '10px' } }, 'รายงาน (คัดลอกส่งให้ผู้พัฒนาได้)'), report);
  toast('ตรวจเสร็จแล้ว', 1800);
}

// mic + teacher camera for a lesson. iPadOS has two habits that fight each other: a capture that is already running gets
// interrupted when another one starts, and in a combined request it tends to hand over the CAMERA's built-in mic instead of
// the chosen one. So: try the combined request and check which mic we actually got; if wrong, open them one after the other
// and verify both tracks are still alive; only then settle for the camera's mic, and say so.
export async function openLessonStreams() {
  const want = await resolveMic(), wantLabel = want?.label || prefs.rec.micLabel || '';
  const ac = await micConstraints();
  const settle = (ms) => new Promise(r => setTimeout(r, ms));
  const alive = (t) => t && t.readyState === 'live' && !t.muted;
  const sameMic = (t) => !want || !t?.label || t.label === wantLabel || t.label.includes(wantLabel) || wantLabel.includes(t.label);
  const stopAll = (...sts) => sts.forEach(st => st && st.getTracks().forEach(t => t.stop()));
  const out = (a, v, note) => { const mic = new MediaStream([a]); mic._micLabel = a.label || ''; return { mic, cam: v ? new MediaStream([v]) : null, note }; };
  // 1) combined
  let both = null; try { both = await openCam(ac); } catch { }
  if (both) {
    const a = both.getAudioTracks()[0], v = both.getVideoTracks()[0];
    if (a && sameMic(a)) return out(a, v, '');
    stopAll(both);
  }
  // 2) mic first (exact), then camera without audio; the mic must survive the camera opening
  if (want) {
    let mic = null, cam = null;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: ac }); } catch { }
    if (mic) {
      cam = await openCam(); await settle(700);
      const a = mic.getAudioTracks()[0];
      if (alive(a) && cam) return out(a, cam.getVideoTracks()[0], '');
      if (alive(a) && !cam) return out(a, null, 'เปิดกล้องไม่ได้ · อัดเสียงอย่างเดียว');
      stopAll(mic, cam);
      // 3) camera first, then the exact mic
      cam = await openCam(); try { mic = await navigator.mediaDevices.getUserMedia({ audio: ac }); } catch { mic = null; } await settle(700);
      const a2 = mic?.getAudioTracks()[0], v2 = cam?.getVideoTracks()[0];
      if (alive(a2) && (!cam || alive(v2))) return out(a2, v2, cam ? '' : 'เปิดกล้องไม่ได้ · อัดเสียงอย่างเดียว');
      stopAll(mic, cam);
    }
  }
  // 4) last resort: whatever the combined request gives (usually the camera's mic)
  try { both = await openCam({ echoCancellation: true, noiseSuppression: true }); } catch { }
  if (both && both.getAudioTracks()[0]) return out(both.getAudioTracks()[0], both.getVideoTracks()[0], want ? `iPad ไม่ยอมให้ใช้ "${wantLabel}" พร้อมกล้องนี้ · ใช้ไมค์ของกล้องแทน` : '');
  stopAll(both);
  const mic = await openMic();
  return { mic, cam: null, note: prefs.rec.cam ? 'เปิดกล้องไม่ได้ · อัดเสียงอย่างเดียว' : '' };
}
export function micErrorText(e) {
  const n = (e && e.name) || '';
  if (/NotAllowed|Permission|Security/i.test(n)) return 'ไม่ได้รับอนุญาตให้ใช้ไมค์ · เปิดที่ ตั้งค่า iPad → Safari → ไมโครโฟน และ ความเป็นส่วนตัว → ไมโครโฟน → Safari';
  if (/NotFound|Overconstrained/i.test(n)) return 'ไม่พบไมค์ตัวที่เลือก · ลองเลือก "ไมค์เริ่มต้นของเครื่อง"';
  if (/NotReadable|AbortError|TrackStart/i.test(n)) return 'ไมค์ถูกแอปอื่นหรือระบบใช้อยู่ · ปิดแอปอื่นที่ใช้ไมค์ หรือถอดเสียบใหม่';
  return (e && (e.message || e.name)) || 'ไม่ทราบสาเหตุ';
}
async function micConstraints() {
  const base = { echoCancellation: true, noiseSuppression: true };
  const want = await resolveMic();
  return want ? { ...base, deviceId: { exact: want.deviceId } } : base;
}
async function openMic() {
  const base = { echoCancellation: true, noiseSuppression: true };
  const want = await resolveMic();
  if (want) {
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: want.deviceId } } }); st._micLabel = want.label || st.getAudioTracks()[0]?.label; return st; }
    catch (e) { if (!/constraint|NotFound|Overconstrained/i.test(e.name + ' ' + e.message)) throw e; }
  } else if (prefs.rec.mic || prefs.rec.micLabel) {
    toast(`ไม่พบไมค์ "${micName(prefs.rec.micLabel)}" · ใช้ไมค์เริ่มต้นของเครื่องแทน`, 3500, 'warn');
  }
  const st = await navigator.mediaDevices.getUserMedia({ audio: base });
  st._micLabel = st.getAudioTracks()[0]?.label || ''; st._fallback = !!want;
  return st;
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
    box.append(h('div', { class: 'mh' }, `อัดเสียง ${fmtTime(this.elapsed())}`), h('div', { class: 'mh', style: { fontWeight: 400, color: 'var(--muted)' } }, `ไมค์: ${micName(this.stream?._micLabel)}`));
    if (this.state === 'recording') mk('pause', 'หยุดชั่วคราว', () => this.pause()); else mk('play', 'อัดต่อ', () => this.resume());
    mk('stop', 'หยุดและบันทึกเสียง', () => this.stop(), true);
    const close = popover(btn, box, ed.popOpts());
  }
  async start(ed, opts = {}) {
    if (typeof MediaRecorder === 'undefined') { toast('เบราว์เซอร์นี้อัดเสียงไม่ได้', 3000, 'warn'); return; }
    // a lesson in this notebook that ended within the last 30 minutes → offer to continue it as the next part
    if (!opts.decided && !opts.continues) {
      try {
        const prev = (await db.getAll('recs')).filter(r => r.kind === 'audio' && r.lesson && r.done && r.nb === ed.nb.id && Date.now() - (r.created + (r.duration || 0)) < 30 * 60e3).sort((a, b) => b.created - a.created)[0];
        if (prev) {
          const box = h('div', { class: 'menu' });
          const mk = (ic, label, sub, fn) => { const b = h('button', { class: 'mi' }, icon(ic), h('span', {}, label, sub ? h('small', { style: { display: 'block', color: 'var(--muted)' } }, sub) : null)); b.onclick = () => { close(); fn(); }; box.append(b); };
          mk('rec', `อัดต่อจาก "${prev.name}"`, `เป็นตอนที่ ${(prev.part || 1) + 1} · รวมเป็นวิดีโอเดียวได้ตอนตัดต่อ`, () => this.start(ed, { continues: prev }));
          mk('mic', 'อัดบทเรียนใหม่', null, () => this.start(ed, { decided: true }));
          const close = popover(ed.micBtn || ed.stage, box, ed.popOpts());
          return;
        }
      } catch { }
    }
    let stream, camStream = null, devNote = '';
    const wantCam = !!(prefs.rec.cam && !prefs.studentUI);
    try {
      if (wantCam) { const r = await openLessonStreams(); stream = r.mic; camStream = r.cam; devNote = r.note; }
      else stream = await openMic();
    } catch (e) { toast('เปิดไมค์ไม่ได้: ' + micErrorText(e), 4500, 'warn'); return; }
    const mime = pickAudioMime();
    let mr; try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : undefined); } catch { mr = new MediaRecorder(stream); }
    this.stream = stream; this.mr = mr; this.recId = uid(); this.seq = 0; this.bytes = 0; this.writes = [];
    // teacher camera (optional): its own recorder + chunk stream, kept as a hidden companion record
    this.cam = null;
    if (wantCam) {
      const cs = camStream;
      if (!cs) { if (!devNote) toast('เปิดกล้องครูไม่ได้ (' + camErrorText(openCam.lastError) + ') · อัดเสียง + ลายมืออย่างเดียว', 4500, 'warn'); }
      else {
        const cmime = pickCamMime(); let cmr; try { cmr = new MediaRecorder(cs, cmime ? { mimeType: cmime, videoBitsPerSecond: (prefs.rec.camRes || 480) >= 720 ? 2e6 : 900e3 } : { videoBitsPerSecond: (prefs.rec.camRes || 480) >= 720 ? 2e6 : 900e3 }); } catch { cmr = new MediaRecorder(cs); }
        this.cam = { stream: cs, mr: cmr, id: this.recId + '-cam', seq: 0, bytes: 0, writes: [], mime: cmr.mimeType || cmime || 'video/mp4' };
        showCamPip(ed.stage, cs, {});
      }
    }
    const d = new Date();
    this.meta = { id: this.recId, kind: 'audio', name: `${ed.nb.name} · เสียง ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} น.`, nb: ed.nb.id, page: ed.currentPage()?.id, created: Date.now(), mime: mr.mimeType || mime || 'audio/webm', duration: 0, size: 0, done: false };
    if (opts.continues) { const pv = opts.continues; this.meta.continues = pv.id; this.meta.part = (pv.part || 1) + 1; this.meta.name = (pv.name || '').replace(/ · ตอนที่ \d+$/, '') + ` · ตอนที่ ${this.meta.part}`; }
    await db.put('recs', this.meta);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) { this.bytes += e.data.size; this.writes.push(db.addChunk(this.recId, this.seq++, e.data).catch(console.error)); } };
    mr.start(3000);
    if (this.cam) { const C = this.cam; await db.put('recs', { id: C.id, kind: 'cam', parent: this.recId, nb: ed.nb.id, name: this.meta.name + ' · กล้อง', created: Date.now(), mime: C.mime, done: false, hidden: true }); C.mr.ondataavailable = (e) => { if (e.data && e.data.size) { C.bytes += e.data.size; C.writes.push(db.addChunk(C.id, C.seq++, e.data).catch(console.error)); } }; C.mr.start(3000); this.meta.cam = C.id; this.meta.camShape = prefs.rec.camShape || 'circle'; this.meta.camPos = prefs.rec.camPos || { x: 0.985, y: 0.985 }; this.meta.camSize = prefs.rec.camSize || 150; this.meta.camStageW = ed.stage.clientWidth; await db.put('recs', this.meta); }
    this.state = 'recording'; this.t0 = performance.now(); this.pausedTotal = 0;
    try { this.app.timeline?.start(ed, this.recId); } catch (e) { console.warn('timeline', e); }
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch { }
    this.tick = setInterval(() => { const m = this.app.editor?.micBtn?.querySelector('.mt'); if (m) m.textContent = fmtTime(this.elapsed()); this.panelTick(); }, 300);
    this.openPanel(ed, stream);
    this.syncButton();
    this.startTranscript();
    { const cam = this.cam?.stream.getVideoTracks()[0]?.label;
      toast(`เริ่มอัดแล้ว · 🎙 ${micName(stream._micLabel || stream.getAudioTracks()[0]?.label)}${cam ? ` · 📷 ${cam}` : wantCam ? ' · 📷 ไม่มีกล้อง' : ''}${devNote ? ' · ' + devNote : ''} · แตะปุ่มไมค์เพื่อหยุด`, devNote ? 7000 : 3500, devNote ? 'warn' : ''); }
  }
  // ---- optional live transcript (device speech recognition; best effort) ----
  startTranscript() {
    this.tx = []; this.sr = null;
    if (!prefs.rec.transcript || prefs.studentUI) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    try {
      const sr = new SR(); sr.lang = 'th-TH'; sr.continuous = true; sr.interimResults = false; this.sr = sr; let stopping = false;
      sr.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) { const text = e.results[i][0].transcript.trim(); if (text) this.tx.push({ t: Math.round(this.elapsed()), text }); } };
      sr.onend = () => { if (!stopping && this.state !== 'idle') { try { sr.start(); } catch { } } };
      sr.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopping = true; toast('ถอดเสียงไม่ได้ในเครื่องนี้ · อัดต่อตามปกติ', 2500); } };
      this.sr._stop = () => { stopping = true; try { sr.stop(); } catch { } };
      sr.start();
    } catch (e) { console.warn('transcript', e); this.sr = null; }
  }
  stopTranscript() { try { this.sr?._stop(); } catch { } this.sr = null; return this.tx || []; }
  // ---- live status panel: time, mic level, camera, free space; warns when the mic goes quiet ----
  openPanel(ed, stream) {
    this.closePanel();
    try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 512; src.connect(an); this.pan = { ac, an, buf: new Float32Array(an.fftSize) }; } catch { this.pan = null; }
    const lvl = h('div', { class: 'lv' }, h('i'));
    this.panel = h('div', { class: 'recpanel', 'data-nomirror': '1' },
      h('span', { class: 'dot' }), h('b', { class: 'tm' }, '0:00'),
      h('span', { class: 'mic' }, icon('mic'), h('span', { class: 'mn' }, micName(stream._micLabel)), lvl),
      this.cam ? h('span', { class: 'cam' }, icon('screen'), 'กล้อง') : null,
      h('span', { class: 'sp' }, ''));
    this.panel.onclick = () => this.click(ed, ed.micBtn || this.panel);
    (ed?.stage || document.body).append(this.panel);
    this.quietSince = performance.now(); this.quietWarned = false; this.lastSpace = 0; this.camWarned = false; this.spaceWarned = false;
  }
  panelTick() {
    const P = this.panel; if (!P) return;
    P.querySelector('.tm').textContent = fmtTime(this.elapsed());
    P.classList.toggle('paused', this.state === 'paused');
    if (this.pan && this.state === 'recording') {
      this.pan.an.getFloatTimeDomainData(this.pan.buf); let peak = 0; for (let i = 0; i < this.pan.buf.length; i++) peak = Math.max(peak, Math.abs(this.pan.buf[i]));
      P.querySelector('.lv i').style.width = Math.min(100, Math.round(peak * 220)) + '%';
      if (peak > 0.015) { this.quietSince = performance.now(); if (this.quietWarned) { this.quietWarned = false; P.classList.remove('quiet'); } }
      else if (performance.now() - this.quietSince > 20e3 && !this.quietWarned) { this.quietWarned = true; P.classList.add('quiet'); toast('ไมค์เงียบมา 20 วินาที · ตรวจว่าไมค์ที่เลือกยังเสียบอยู่ (แตะแผงสถานะเพื่อตั้งค่า)', 5000, 'warn'); }
    }
    if (this.cam && this.cam.stream) { const live = this.cam.stream.getVideoTracks()[0]?.readyState === 'live'; const c = P.querySelector('.cam'); if (c) { c.classList.toggle('bad', !live); if (!live && !this.camWarned) { this.camWarned = true; toast('กล้องครูหลุด · ภาพกล้องจะหยุดตรงนี้ เสียงและลายมือยังอัดต่อ', 4000, 'warn'); } } }
    if (performance.now() - this.lastSpace > 30e3) { this.lastSpace = performance.now(); navigator.storage?.estimate?.().then(e => { if (!e || !this.panel) return; const free = (e.quota - e.usage) / 1048576; const sp = this.panel.querySelector('.sp'); sp.textContent = free > 1024 ? `ว่าง ${(free / 1024).toFixed(1)} GB` : `ว่าง ${Math.round(free)} MB`; sp.classList.toggle('bad', free < 300); if (free < 300 && !this.spaceWarned) { this.spaceWarned = true; toast('พื้นที่เครื่องเหลือน้อยกว่า 300 MB · อัดต่อได้อีกไม่นาน', 5000, 'warn'); } }).catch(() => { }); }
  }
  closePanel() { try { this.pan?.ac.close(); } catch { } this.pan = null; this.panel?.remove(); this.panel = null; }
  pause() { if (this.state !== 'recording') return; try { this.mr.pause(); } catch { } try { this.cam?.mr.pause(); } catch { } this.state = 'paused'; this.app.timeline?.pause(); this.pauseAt = performance.now(); this.syncButton(); }
  resume() { if (this.state !== 'paused') return; try { this.mr.resume(); } catch { } try { this.cam?.mr.resume(); } catch { } this.pausedTotal += performance.now() - this.pauseAt; this.state = 'recording'; this.app.timeline?.resume(); this.syncButton(); }
  async stop() {
    if (this.state === 'idle') return;
    const dur = this.elapsed();
    const stopped = new Promise(r => { this.mr.onstop = r; setTimeout(r, 3000); });
    try { if (this.mr.state !== 'inactive') this.mr.stop(); } catch { }
    await stopped; clearInterval(this.tick); this.closePanel();
    this.stream.getTracks().forEach(t => t.stop());
    if (this.cam) { const C = this.cam; const cst = new Promise(r => { C.mr.onstop = r; setTimeout(r, 3000); }); try { if (C.mr.state !== 'inactive') C.mr.stop(); } catch { } await cst; C.stream.getTracks().forEach(t => t.stop()); hideCamPip(); await Promise.all(C.writes); await db.put('recs', { id: C.id, kind: 'cam', parent: this.recId, nb: this.meta.nb, name: this.meta.name + ' · กล้อง', created: this.meta.created, mime: C.mime, duration: dur, size: C.bytes, done: true, hidden: true }); this.meta.camPos = prefs.rec.camPos || this.meta.camPos; this.cam = null; }
    try { await this.wake?.release(); } catch { }
    this.state = 'idle'; this.syncButton();
    await Promise.all(this.writes);
    let lessonBytes = 0, lessonWhy = '';
    try { lessonBytes = await this.app.timeline?.stop(); if (!this.app.timeline) lessonWhy = 'no-timeline'; } catch (e) { console.warn('timeline stop', e); lessonWhy = 'stop:' + (e.message || e); }
    // the handwriting file may still exist (autosaved every few seconds) even when stop() reported nothing — trust the file
    if (!lessonBytes) { try { const kv = await db.get('kv', 'lesson:' + this.recId); if (kv?.v) { lessonBytes = kv.v.length; lessonWhy += ' recovered-from-kv'; } else lessonWhy += ' no-kv'; } catch { } }
    if (!lessonBytes && !lessonWhy) lessonWhy = 'inactive';
    const tx = this.stopTranscript(); if (tx.length) { this.meta.transcript = true; try { await db.putQuiet('kv', { k: 'tx:' + this.recId, v: tx }); } catch { } }
    Object.assign(this.meta, { duration: dur, size: this.bytes, done: true, lesson: lessonBytes > 0 || !!this.meta.cam, lessonWhy: lessonBytes > 0 ? undefined : lessonWhy });
    if (!lessonBytes) console.warn('lesson timeline missing:', lessonWhy);
    await db.put('recs', this.meta);
    toast(`บันทึกเสียงลงเครื่องแล้ว (${fmtTime(dur)}) · เล่นย้อนพร้อมลายมือได้ที่ปุ่มส่งออก > เสียงที่อัดในสมุดเล่มนี้`, 3500);
    scheduleBackgroundUpload();
  }
}

// after recording: push to Drive and free the space on this device
// recordings are always saved on the device first; Drive upload runs later in the background (or by hand), never blocking the teacher
let bgTimer = null;
// upload policy: 'night' (default) = only between 01:00 and 05:00 while the app is open and idle; 'bg' = right after
// recording; 'manual' = only when the teacher presses "ส่งขึ้น Drive". Night/manual keep the clip on the device first,
// so the lesson is instantly replayable and the teacher's network is free during class.
export function uploadMode() { return prefs.rec.uploadMode || 'night'; }
export function inNightWindow(d = new Date()) { const hr = d.getHours(); return hr >= 1 && hr < 5; }
export function uploadAllowedNow(force) { if (force) return true; const m = uploadMode(); if (m === 'manual') return false; if (m === 'night') return inNightWindow(); return true; }
let nightTimer = null;
export function startUploadScheduler() {
  clearInterval(nightTimer);
  const tick = () => { if (document.visibilityState !== 'visible') return; if (uploadMode() === 'night' && inNightWindow() && !pendingRun) uploadPendingRecordings(); };
  nightTimer = setInterval(tick, 10 * 60e3); setTimeout(tick, 20e3);
  document.addEventListener('visibilitychange', tick);
}
export function scheduleBackgroundUpload(delay = 15000) {
  if (uploadMode() !== 'bg') return;
  clearTimeout(bgTimer);
  bgTimer = setTimeout(() => { bgTimer = null; uploadPendingRecordings(); }, delay);
}
// bring a clip that lives on Drive back onto this device (one download, then every replay is instant and offline)
export async function pullBack(meta) {
  const bz = busy('กำลังดึงคลิปจาก Google Drive มาเก็บในเครื่อง…', fmtBytes(meta.size || 0), 0);
  try {
    const one = async (m, label) => {
      if (!m || !m.drive || m.localCopy) return;
      bz.set('กำลังดึงคลิปจาก Google Drive มาเก็บในเครื่อง…', label + ' ' + fmtBytes(m.size || 0), 0);
      const { gfetchBlob } = await import('./sync.js');
      const b = await gfetchBlob(m.drive, (m.mime || 'video/mp4').split(';')[0]);
      await db.deleteRec(m.id).catch(() => { }); await db.addChunk(m.id, 0, b);
      m.localCopy = true; m.size = b.size; await db.put('recs', m);
    };
    await one(meta, 'เสียง');
    if (meta.cam) { try { await one(await db.get('recs', meta.cam), 'กล้องครู'); } catch (e) { console.warn('cam pull', e); } }
    toast('เก็บสำเนาในเครื่องแล้ว · เปิดเล่นได้ทันทีโดยไม่ต้องใช้เน็ต (ต้นฉบับยังอยู่บน Drive)', 3500);
    return true;
  } catch (e) { toast('ดึงจาก Drive ไม่สำเร็จ: ' + (e.auth ? 'ต้องเชื่อมต่อ Google ใหม่' : e.message || e), 4500, 'warn'); return false; }
  finally { bz.done(); }
}
export async function maybeUpload(meta, quiet) {
  if (!syncOn() || prefs.rec.toDrive === false || !meta.done || meta.drive) return null;
  if (quiet && !hasFileScope()) return null;
  if (!hasFileScope()) { toast('ต้องเชื่อมต่อ Google ใหม่เพื่ออนุญาตเก็บคลิปใน Drive (ตั้งค่า > ซิงก์ > เชื่อมต่อใหม่) · คลิปนี้เก็บไว้ในเครื่องก่อน', 5000, 'warn'); return; }
  const bz = quiet ? { set() {}, done() {} } : busy('กำลังส่งคลิปขึ้น Google Drive…', fmtBytes(meta.size), 0);
  try {
    const blob = await recBlob(meta);
    try {
    const r = await uploadRecording(blob, fileName(meta), (t, p) => bz.set('กำลังส่งคลิปขึ้น Google Drive…', t, p));
    meta.drive = r.id; meta.link = r.webViewLink; meta.size = blob.size; meta.mime = blob.type;
    await db.put('recs', meta);
    await db.deleteRec(meta.id); await db.put('recs', meta); // drop the local chunks, keep the record
    // the teacher-camera clip travels with its lesson: send it right away rather than waiting for the background pass
    if (meta.cam) { try { const cm = await db.get('recs', meta.cam); if (cm && cm.done && !cm.drive) { bz.set('กำลังส่งภาพกล้องครูขึ้น Google Drive…', fmtBytes(cm.size || 0), 0); const cb = await recBlob(cm); const rc = await uploadRecording(cb, fileName(cm), (t, p) => bz.set('กำลังส่งภาพกล้องครูขึ้น Google Drive…', t, p)); cm.drive = rc.id; cm.link = rc.webViewLink; cm.size = cb.size; cm.mime = cb.type; await db.deleteRec(cm.id); await db.put('recs', cm); } } catch (e) { console.warn('cam upload', e); } }
    scheduleSync(3000);
    if (!quiet) toast('เก็บคลิปใน Google Drive แล้ว (โฟลเดอร์ เส้นคิด/คลิป) · ไม่กินพื้นที่เครื่อง', 3500);
    return blob;
    } catch (e) { e._blob = blob; throw e; }
  } catch (e) { console.warn(e); if (quiet) throw e; toast('ส่งขึ้น Drive ไม่สำเร็จ (' + (e.auth ? 'ต้องเชื่อมต่อ Google ใหม่' : e.message) + ') · คลิปยังอยู่ในเครื่อง', 5000, 'warn'); return e._blob || null; }
  finally { bz.done(); }
}
// older clips still on this device: move them to Drive in the background, one at a time
let pendingRun = null;
export function uploadPendingRecordings(force) {
  if (pendingRun) return pendingRun;
  pendingRun = (async () => {
    if (!syncOn() || prefs.rec.toDrive === false || !hasFileScope() || !navigator.onLine) return;
    if (!uploadAllowedNow(force)) return;
    if (window.senkid?.audio?.state && window.senkid.audio.state !== 'idle') return; // never while a lesson is being recorded
    const recs = (await db.getAll('recs')).filter(r => r.done && !r.drive && !r.local && !r.localCopy).sort((a, b) => a.created - b.created);
    let n = 0;
    if (recs.length) toast(`กำลังส่ง ${recs.length} ไฟล์ขึ้น Google Drive อยู่เบื้องหลัง · ใช้งานต่อได้ตามปกติ`, 3000);
    for (const m of recs) {
      if (!navigator.onLine) break;
      try { if (await maybeUpload(m, true)) { n++; m.drive && document.dispatchEvent(new CustomEvent('senkid:rec-moved')); } } catch (e) { if (e.auth) break; }
    }
    if (n) toast(`ส่งขึ้น Google Drive แล้ว ${n} ไฟล์ · คืนพื้นที่ในเครื่อง`, 3000);
  })().catch(e => console.warn('pending recs', e)).finally(() => { pendingRun = null; });
  return pendingRun;
}
export async function recBlob(meta) {
  if (meta.drive && !meta.localCopy) { const { gfetchBlob } = await import('./sync.js'); return gfetchBlob(meta.drive, (meta.mime || 'video/mp4').split(';')[0]); }
  const chunks = (await db.chunksOf(meta.id)).sort((a, b) => a.seq - b.seq).map(c => c.blob);
  const type = (meta.mime || (meta.kind === 'audio' ? 'audio/mp4' : 'video/mp4')).split(';')[0];
  const raw = new Blob(chunks, { type });
  if (!type.includes('mp4')) return raw;
  // MediaRecorder writes a fragmented MP4 (wrong length, no seeking/replay) — rebuild a normal MP4
  try { const { defragMp4 } = await import('./mp4fix.js'); const fixed = await defragMp4(raw); if (fixed) return new Blob([fixed], { type }); } catch (e) { console.warn('mp4 fix', e); }
  return raw;
}
export function fileName(meta) {
  const d = new Date(meta.created), p = (n) => String(n).padStart(2, '0');
  return `senkid-${meta.kind === 'audio' ? 'audio' : meta.kind === 'cam' ? 'cam' : 'clip'}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${extOf(meta.mime)}`;
}
export async function saveRecording(meta) { const bz = busy('กำลังเตรียมไฟล์…'); let b; try { b = await recBlob(meta); } finally { bz.done(); } downloadBlob(b, fileName(meta)); }
export async function shareRecording(meta) {
  const bz = busy('กำลังเตรียมไฟล์…'); let b; try { b = await recBlob(meta); } finally { bz.done(); }
  const f = new File([b], fileName(meta), { type: b.type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    const { shareFileDialog } = await import('./ui.js');
    await shareFileDialog(f, { title: 'คลิปพร้อมแล้ว', sub: 'ส่งเข้า LINE, AirDrop หรือบันทึกลงรูปภาพ/ไฟล์', label: 'แชร์คลิป (' + fmtBytes(b.size) + ')' });
  } else { downloadBlob(b, f.name); toast('เครื่องนี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลดไฟล์แทน', 3000); }
}

export async function showRecording(meta, fresh, blob) {
  if (!blob) { const bz = busy(meta.drive ? 'กำลังดึงคลิปจาก Google Drive…' : 'กำลังเปิดคลิป…'); try { blob = await recBlob(meta); } catch (e) { bz.done(); toast('เปิดคลิปไม่ได้: ' + (e.auth ? 'ต้องเชื่อมต่อ Google ใหม่' : e.message), 4000, 'warn'); return; } finally { bz.done(); } }
  const url = URL.createObjectURL(blob);
  const body = h('div');
  if (meta.kind === 'audio') body.append(h('audio', { src: url, controls: true, style: { width: '100%', marginTop: '8px' } }));
  else body.append(h('video', { class: 'preview', src: url, controls: true, playsinline: true }));
  let cam = null; if (meta.cam) { try { cam = await db.get('recs', meta.cam); } catch { } }
  const parts = meta.kind === 'audio' ? [`เสียง ${fmtBytes(blob.size)}`, meta.lesson ? 'ลายมือ ✓' : null, meta.cam ? (cam ? `กล้องครู ✓ ${fmtBytes(cam.size || 0)}${cam.drive ? ' (Drive)' : ' (ในเครื่อง)'}` : 'กล้องครู: ไฟล์หาย') : null].filter(Boolean).join(' · ') : fmtBytes(blob.size) + ' · ' + (meta.res === '2160' ? '4K' : meta.res + 'p');
  body.append(h('div', { class: 'stats' },
    h('div', {}, h('span', {}, 'ความยาว'), h('b', {}, fmtTime(meta.duration || 0))),
    h('div', {}, h('span', {}, meta.kind === 'audio' && meta.lesson ? 'บทเรียนนี้มี' : 'ขนาดไฟล์'), h('b', { style: { fontSize: meta.lesson ? '20px' : '' } }, parts))));
  if (meta.kind === 'audio' && meta.lesson) body.append(h('p', { style: { fontSize: '19px', color: 'var(--muted)', margin: '10px 0 0' } }, 'ตัวเล่นด้านบนเป็นไฟล์เสียงดิบ · กด "เล่นย้อน" เพื่อดูลายมือ' + (meta.cam ? 'และหน้าครู' : '') + 'เขียนตามเสียง หรือ "ทำวิดีโอ" เพื่อรวมเป็น MP4'));
  body.append(h('p', { style: { fontSize: '19px', color: 'var(--muted)', margin: '12px 0 0' } }, meta.drive ? 'คลิปอยู่ใน Google Drive (โฟลเดอร์ เส้นคิด/คลิป) ไม่กินพื้นที่เครื่อง · เปิดดูอีกครั้งได้ที่เมนู > คลิปที่อัดไว้' : 'คลิปเก็บไว้ในแอปแล้ว เปิดดูอีกครั้งได้ที่เมนู > คลิปที่อัดไว้ · บน iPad กด "แชร์" แล้วเลือก "บันทึกวิดีโอ" เพื่อเก็บลงแอปรูปภาพ'));
  if (meta.ytLink) body.append(h('p', { style: { margin: '8px 0 0' } }, 'YouTube: ', h('a', { href: meta.ytLink, target: '_blank', rel: 'noopener' }, meta.ytLink)));
  dialog(fresh ? 'อัดคลิปเสร็จแล้ว' : meta.name, body, [
    ...(meta.kind === 'audio' && (meta.lesson || meta.cam) ? [{ label: 'เล่นย้อน', icon: 'play', cls: 'prim', action: () => { import('./lesson.js').then(m => m.openPlayer(meta, blob)); } }] : []),
    { label: 'บันทึกไฟล์', icon: 'download', action: () => { saveRecording(meta); return false; } },
    ...(meta.kind === 'video' && !prefs.studentUI ? [{ label: meta.yt ? 'YouTube อีกครั้ง' : 'ส่งขึ้น YouTube', icon: 'upload', action: () => { import('./youtube.js').then(m => m.uploadToYouTube(meta, blob)); } }] : []),
    { label: meta.kind === 'audio' ? 'แชร์ไฟล์เสียง' : 'แชร์ / บันทึกลงรูปภาพ', icon: 'share', cls: meta.kind === 'audio' && meta.lesson ? '' : 'prim', flex: meta.kind === 'audio' && meta.lesson ? 1 : 2, action: () => { shareRecording(meta); return false; } },
  ], { width: 760, onClose: () => URL.revokeObjectURL(url) });
}

export async function recordingCounts() {
  const c = {}; for (const r of await db.getAll('recs')) if (r.nb && !r.hidden) c[r.nb] = (c[r.nb] || 0) + 1; return c;
}
// all parts recorded "อัดต่อ" from one another, oldest first
export function chainOf(m, recs) {
  let first = m; const seen = new Set([m.id]);
  while (first.continues) { const p = recs.find(r => r.id === first.continues); if (!p || seen.has(p.id)) break; seen.add(p.id); first = p; }
  const out = [first]; let cur = first;
  for (;;) { const n = recs.find(r => r.continues === cur.id && !out.includes(r)); if (!n) break; out.push(n); cur = n; }
  return out;
}
// delete a clip everywhere (this device, Google Drive, its camera track, its lesson ink); asks first
export async function deleteRecording(m, { ask = true } = {}) {
  if (ask && !(await confirmBox('ลบคลิปนี้?', m.drive ? 'จะลบออกจาก Google Drive ด้วย กู้คืนไม่ได้' : 'ลบแล้วกู้คืนไม่ได้', { ok: 'ลบ', danger: true }))) return false;
  if (m.drive) { try { await deleteDriveFile(m.drive); } catch (e) { toast('ลบจาก Drive ไม่ได้: ' + e.message, 3000, 'warn'); return false; } }
  if (m.drive) { const v = (await db.get('kv', 'sync:recdel'))?.v || {}; v[m.id] = Date.now(); await db.put('kv', { k: 'sync:recdel', v }); scheduleSync(3000); }
  await db.deleteRec(m.id);
  if (m.cam) { try { const cm = await db.get('recs', m.cam); if (cm?.drive) { await deleteDriveFile(cm.drive).catch(() => { }); const v = (await db.get('kv', 'sync:recdel'))?.v || {}; v[cm.id] = Date.now(); await db.put('kv', { k: 'sync:recdel', v }); } await db.deleteRec(m.cam); } catch { } }
  if (m.lesson) (await import('./lesson.js')).deleteLesson(m.id);
  try { await db.del('kv', 'cover:' + m.id); await db.del('kv', 'vthumb:' + m.id); } catch { }
  return true;
}
// the old list view (kept for reference); the app now opens the video library instead
export async function openRecordingsList(nb, app) {
  const recs = (await db.getAll('recs')).filter(r => !r.hidden && (!nb || r.nb === nb)).sort((a, b) => b.created - a.created);
  const nbRec = nb ? await db.get('notebooks', nb) : null;
  const pageNo = (m) => { const i = nbRec?.pages?.indexOf(m.page); return i >= 0 ? i + 1 : 0; };
  const list = h('div', { class: 'reclist' });
  let dlg = null;
  const render = () => {
    list.innerHTML = '';
    const pend = recs.filter(r => r.done && !r.drive && !r.local).length;
    if (pend && syncOn()) {
      if (!hasFileScope()) { const b = h('button', { class: 'pill prim', style: { height: '40px' } }, 'เชื่อมต่อใหม่'); b.onclick = () => signIn(); list.append(h('div', { class: 'bk-banner warn' }, h('div', {}, `มี ${pend} คลิปรอส่งขึ้น Google Drive · ต้องเชื่อมต่อ Google ใหม่ก่อนเพื่ออนุญาตเก็บคลิปใน Drive`), b)); }
      else if (prefs.rec.toDrive === false) list.append(h('div', { class: 'bk-banner' }, h('div', {}, `มี ${pend} คลิปเก็บอยู่ในเครื่อง · เปิด "เก็บคลิปใน Google Drive" ในตั้งค่าการอัดเพื่อย้ายขึ้นอัตโนมัติ`)));
      else { const b = h('button', { class: 'pill prim', style: { height: '40px' } }, pendingRun ? 'กำลังส่ง…' : 'ส่งตอนนี้'); b.disabled = !!pendingRun; b.onclick = async () => { b.disabled = true; b.textContent = 'กำลังส่ง…'; await uploadPendingRecordings(true); render(); }; list.append(h('div', { class: 'bk-banner' }, h('div', {}, pendingRun ? `กำลังส่ง ${pend} ไฟล์ขึ้น Google Drive อยู่เบื้องหลัง…` : prefs.rec.uploadMode === 'manual' ? `มี ${pend} ไฟล์อยู่ในเครื่อง · กดส่งเมื่อสะดวก` : `มี ${pend} ไฟล์รอส่งขึ้น Google Drive`), b)); }
    }
    if (!recs.length) { list.append(h('p', { style: { color: 'var(--muted)', textAlign: 'center', padding: '30px 0' } }, nb ? 'สมุดเล่มนี้ยังไม่มีบทเรียนที่อัดไว้ · แตะปุ่มไมค์บนแถบเครื่องมือเพื่ออัดเสียง + ลายมือ' : 'ยังไม่มีคลิปหรือเสียงที่อัดไว้')); return; }
    for (const m of recs) {
      const d = new Date(m.created);
      const it = h('div', { class: 'item' },
        icon(m.kind === 'audio' ? 'mic' : 'film'),
        h('div', { class: 'meta' }, h('b', {}, m.name), h('div', {}, `${d.toLocaleDateString('th-TH')} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ${fmtTime(m.duration || 0)} · ${fmtBytes(m.size)}${m.done ? '' : ' · ไม่สมบูรณ์ (กู้คืนจากการอัดที่ค้าง)'}`)));
      const pn = pageNo(m);
      if (pn) { const pb = h('button', { class: 'chip', style: { height: '32px', padding: '0 10px', fontSize: '18px' }, title: 'ไปหน้าที่เริ่มอัด' }, `หน้า ${pn}`); pb.onclick = () => { const ed = app?.editor; if (ed && ed.nb?.id === nb) { ed.scrollToPage(m.page); ed.need && (ed.need.main = ed.need.ui = true); dlg?.close(); } }; it.querySelector('.meta div').append(' ', pb); }
      const B = (ic, t, fn) => { const b = h('button', { class: 'btn sq', title: t }, icon(ic)); b.onclick = fn; return b; };
      if (m.lesson) { const pb = h('button', { class: 'pill prim', style: { height: '38px', padding: '0 12px' } }, icon('play'), 'เล่นย้อน'); pb.onclick = async () => { const bz = busy('กำลังโหลดเสียง…'); let blob = null; try { blob = await recBlob(m); } catch { } finally { bz.done(); } (await import('./lesson.js')).openPlayer(m, blob); }; it.append(pb); it.querySelector('.meta div').append(' · มีลายมือ'); }
      if (m.continues || m.part > 1) it.querySelector('.meta div').append(` · ตอนที่ ${m.part || 2}`);
      if (m.kind === 'video' && !prefs.studentUI) it.append(B('upload', m.yt ? 'อยู่บน YouTube แล้ว · ส่งอีกครั้ง' : 'ส่งขึ้น YouTube', () => import('./youtube.js').then(x => x.uploadToYouTube(m))));
      if (m.drive && m.done && !prefs.studentUI) it.append(B('qr', 'ลิงก์แชร์จาก Google Drive (ใครมีลิงก์ก็ดูได้)', async () => { const bz = busy('กำลังสร้างลิงก์…'); try { const { driveShareLink } = await import('./sync.js'); const link = await driveShareLink(m.drive); m.link = link; await db.put('recs', m); bz.done(); dialog('ลิงก์แชร์', h('div', {}, h('a', { href: link, target: '_blank', rel: 'noopener', style: { wordBreak: 'break-all', fontSize: '20px' } }, link), h('p', { class: 'sub' }, 'ใครมีลิงก์ก็เปิดดู/ดาวน์โหลดได้ · ยกเลิกการแชร์ได้ใน Google Drive')), [{ label: 'คัดลอก', action: () => { navigator.clipboard?.writeText(link).then(() => toast('คัดลอกแล้ว', 1500)).catch(() => { }); return false; } }, { label: 'ปิด', cls: 'prim' }]); } catch (e) { bz.done(); toast('สร้างลิงก์ไม่ได้: ' + (e.message || e), 4000, 'warn'); } }));
      if (m.yt) it.querySelector('.meta div').append(' · YouTube');
      if (m.transcript) it.append(B('edit', 'ข้อความที่ถอดเสียง', async () => { const tx = (await db.get('kv', 'tx:' + m.id))?.v || []; const ta = h('textarea', { class: 'field', rows: 12, style: { width: '100%' } }, tx.map(x => `[${fmtTime(x.t)}] ${x.text}`).join('\n')); dialog('ข้อความที่ถอดเสียง · ' + m.name, ta, [{ label: 'คัดลอก', action: () => { navigator.clipboard?.writeText(ta.value).catch(() => { }); toast('คัดลอกแล้ว', 1500); return false; } }, { label: 'ปิด', cls: 'prim' }], { width: 640 }); }));
      if (!prefs.studentUI && m.kind === 'audio' && (m.lesson || m.cam)) it.append(B('film', 'ทำวิดีโอ', async () => { dlg?.close(); (await import('./exportvideo.js')).makeVideo(window.senkid, m); }));
      if (m.drive) { const dl = h('a', { class: 'btn sq', title: 'เปิดใน Google Drive', href: m.link || ('https://drive.google.com/file/d/' + m.drive + '/view'), target: '_blank', rel: 'noopener' }, icon('cloud')); it.append(dl); it.querySelector('.meta div').append(' · อยู่ใน Drive'); }
      else if (syncOn() && hasFileScope() && m.done) it.append(B('cloud', 'ส่งขึ้น Google Drive แล้วลบออกจากเครื่อง', async () => { await maybeUpload(m); render(); }));
      it.append(B('play', 'เปิดดู', () => showRecording(m)), B('download', 'บันทึกไฟล์', () => saveRecording(m)), B('share', 'แชร์', () => shareRecording(m)),
        B('trash', 'ลบ', async () => { if (await deleteRecording(m)) { recs.splice(recs.indexOf(m), 1); render(); } }));
      list.append(it);
    }
  };
  render(); document.addEventListener('senkid:rec-moved', render);
  const projBtn = h('button', { class: 'pill prim', style: { height: '40px' } }, icon('film'), 'คลังวิดีโอ'); projBtn.onclick = () => { dlg?.close(); window.senkid?.openRecordings?.(); };
  const head = h('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' } }, projBtn, h('span', { class: 'sub' }, 'เลือกบทเรียน → ตัดช่วงเงียบให้เอง → ได้วิดีโอ 1 ไฟล์'));
  dlg = dialog(nb ? `บทเรียนที่อัดในเล่ม "${nbRec?.name || ''}"` : 'คลิปและเสียงที่อัดไว้ (ทุกเล่ม)', h('div', {}, prefs.studentUI ? null : head, list), [], { width: 720 });
}
