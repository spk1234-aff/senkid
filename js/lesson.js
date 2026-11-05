// Lesson replay: while the teacher records audio, every stroke, erase, move, page/zoom change and laser movement is
// logged with its time. The result is tiny (text), replays in the app in sync with the audio, and can be rendered to a video.
import { h, icon, toast, dialog, busy, fmtTime, fmtBytes, seg, uid, downloadBlob } from './ui.js';
import * as db from './db.js';
import { prefs } from './prefs.js';
import { dims, drawPaper, drawStrokes, drawStroke, drawLaserTrail, drawCurtain, PAPERS, STRIDE } from './render.js';
import { blobToDataURL, dataURLToBlob, bitmapAsync, setImageReadyHook } from './images.js';
import { setPdfReadyHook } from './pdfdoc.js';
import { serializePage } from './editor.js';

const KV = (id) => 'lesson:' + id;

// ---------- serialisation (strokes with images → JSON-safe) ----------
async function strokeOut(s) {
  const o = { ...s }; delete o.bb;
  if (o.pts instanceof Float32Array) o.pts = Array.from(o.pts);
  if (o.blob instanceof Blob) { o.data = await blobToDataURL(o.blob); delete o.blob; }
  return o;
}
async function strokeIn(o) {
  const s = { ...o };
  if (Array.isArray(s.pts)) s.pts = Float32Array.from(s.pts);
  if (s.data) { s.blob = await dataURLToBlob(s.data); delete s.data; }
  return s;
}

// ---------- capture ----------
export class Timeline {
  constructor(app) { this.app = app; this.active = false; }
  start(ed, id) {
    this.ed = ed; this.id = id; this.t0 = performance.now(); this.pausedTotal = 0; this.pauseAt = 0; this.active = true;
    this.events = []; this.known = new Map(); this.based = new Set(); this.pending = []; this.lastView = ''; this.lastLaser = 0; this.lastSave = performance.now();
    this.events.push([0, 'meta', { nb: ed.nb.id, name: ed.nb.name, paper: ed.paper, cols: ed.cols }]);
    ed.hooks.dirty = (p) => this.pageChanged(p); ed.hooks.view = () => this.view(); ed.hooks.frame = () => this.frame();
    this.view(true);
  }
  now() { return Math.round(performance.now() - this.t0 - this.pausedTotal - (this.pauseAt ? performance.now() - this.pauseAt : 0)); }
  pause() { this.pauseAt = performance.now(); }
  resume() { if (this.pauseAt) { this.pausedTotal += performance.now() - this.pauseAt; this.pauseAt = 0; } }
  base(p) {
    if (this.based.has(p.id)) return; this.based.add(p.id);
    const sp = serializePage(p); const t = this.now();
    const ev = [t, 'base', p.id, null]; this.events.push(ev);
    this.pending.push(Promise.all(sp.strokes.map(strokeOut)).then(st => { ev[3] = { ...sp, strokes: st }; }));
    this.known.set(p.id, new Map(p.strokes.map(s => [s.id, s])));
  }
  pageChanged(p) {
    if (!this.active || this.pauseAt) return;
    if (!this.based.has(p.id)) return this.base(p);
    const prev = this.known.get(p.id) || new Map(), t = this.now(), cur = new Map();
    const rm = [];
    for (const s of p.strokes) {
      cur.set(s.id, s);
      const old = prev.get(s.id);
      if (!old) { const ev = [t, 'add', p.id, null, this.ed.lastCommitT0 ? Math.max(0, Math.round(this.ed.lastCommitT0 - this.t0 - this.pausedTotal)) : t]; this.events.push(ev); this.pending.push(strokeOut(s).then(o => { ev[3] = o; })); }
      else if (old !== s) { const ev = [t, 'rep', p.id, null]; this.events.push(ev); this.pending.push(strokeOut(s).then(o => { ev[3] = o; })); }
    }
    for (const id of prev.keys()) if (!cur.has(id)) rm.push(id);
    if (rm.length) this.events.push([t, 'rm', p.id, rm]);
    this.known.set(p.id, cur);
    if (performance.now() - this.lastSave > 20000) this.save(false);
  }
  view(force) {
    if (!this.active || this.pauseAt) return;
    const ed = this.ed; if (!ed.rects) return;
    const [x0, y0] = ed.toWorld(0, 0), [x1, y1] = ed.toWorld(ed.W, ed.H);
    const vis = [], rects = {};
    for (const p of ed.pages) { const r = ed.rects.get(p.id); if (!r) continue; if (r.x > x1 + 100 || r.x + r.w < x0 - 100 || r.y > y1 + 100 || r.y + r.h < y0 - 100) continue; vis.push(p.id); rects[p.id] = { x: r.x, y: r.y, w: r.w, h: r.h }; }
    for (const pid of vis) { const p = ed.pageMap.get(pid); if (p) this.base(p); }
    const key = [x0, y0, x1, y1].map(v => v.toFixed(1)).join(',') + vis.join('') + (ed.curtain ? ed.curtain.pid + ':' + ed.curtain.y.toFixed(0) : '');
    if (key === this.lastView && !force) return; this.lastView = key;
    this.events.push([this.now(), 'view', { world: [x0, y0, x1, y1], vis, rects, paper: ed.paper, curtain: ed.curtain ? { ...ed.curtain } : null }]);
  }
  frame() {
    if (!this.active || this.pauseAt) return;
    const ed = this.ed;
    if (ed.laser.length) { const now = performance.now(); if (now - this.lastLaser > 70) { this.lastLaser = now; this.events.push([this.now(), 'laser', ed.laserWorld(), !!ed.lasering]); this.hadLaser = true; } }
    else if (this.hadLaser) { this.hadLaser = false; this.events.push([this.now(), 'laser', [], false]); }
    if (this.ed.lastViewChange && performance.now() - this.ed.lastViewChange < 50) this.view();
  }
  async save(final) {
    this.lastSave = performance.now();
    await Promise.all(this.pending); this.pending = [];
    const json = JSON.stringify({ v: 1, id: this.id, duration: this.now(), events: this.events, final: !!final });
    await db.put('kv', { k: KV(this.id), v: json });
    return json.length;
  }
  async stop() {
    if (!this.active) return 0;
    this.active = false; const ed = this.ed; ed.hooks.dirty = ed.hooks.view = ed.hooks.frame = null;
    return this.save(true);
  }
}

// ---------- state machine shared by the player and the exporter ----------
class State {
  constructor(data) { this.data = data; this.reset(); }
  reset() { this.pages = new Map(); this.view = null; this.laser = []; this.laserHead = false; this.i = 0; this.paper = this.data.events[0]?.[2]?.paper || 'cream'; this.partial = null; }
  async prepare() { // decode strokes once
    for (const ev of this.data.events) {
      if (ev[1] === 'base' && ev[3]) ev[3].strokes = await Promise.all(ev[3].strokes.map(strokeIn));
      if ((ev[1] === 'add' || ev[1] === 'rep') && ev[3]) ev[3] = await strokeIn(ev[3]);
    }
  }
  seek(t) { if (t < this.lastT) this.reset(); this.advance(t); }
  advance(t) {
    const E = this.data.events;
    while (this.i < E.length && E[this.i][0] <= t) {
      const ev = E[this.i++]; const k = ev[1];
      if (k === 'base') { if (ev[3]) this.pages.set(ev[2], { ...ev[3], strokes: ev[3].strokes.slice() }); }
      else if (k === 'add') { const p = this.pages.get(ev[2]); if (p && ev[3]) p.strokes.push(ev[3]); }
      else if (k === 'rep') { const p = this.pages.get(ev[2]); if (p && ev[3]) p.strokes = p.strokes.map(s => s.id === ev[3].id ? ev[3] : s); }
      else if (k === 'rm') { const p = this.pages.get(ev[2]); if (p) { const rm = new Set(ev[3]); p.strokes = p.strokes.filter(s => !rm.has(s.id)); } }
      else if (k === 'view') { this.view = ev[2]; if (ev[2].paper) this.paper = ev[2].paper; }
      else if (k === 'laser') { this.laser = ev[2]; this.laserHead = ev[3]; }
    }
    this.lastT = t;
    // stroke being written right now (progressive drawing)
    this.partial = null;
    for (let j = this.i; j < E.length; j++) { const ev = E[j]; if (ev[0] - t > 15000) break; if (ev[1] === 'add' && ev[3] && ev[4] != null && ev[4] <= t && !ev[3].shape && ev[3].pts) { const f = (t - ev[4]) / Math.max(1, ev[0] - ev[4]); this.partial = { pid: ev[2], s: ev[3], f }; break; } }
  }
  draw(ctx, W, H, dpr) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#EDEAE2'; ctx.fillRect(0, 0, W * dpr, H * dpr);
    const v = this.view; if (!v) return;
    const [x0, y0, x1, y1] = v.world; const z = Math.min(W / (x1 - x0), H / (y1 - y0)); const ox = (W - (x1 - x0) * z) / 2 - x0 * z, oy = (H - (y1 - y0) * z) / 2 - y0 * z;
    const dark = !!PAPERS[this.paper]?.dark;
    for (const pid of v.vis) {
      const r = v.rects[pid], p = this.pages.get(pid); if (!r) continue;
      const k = z * dpr; ctx.setTransform(k, 0, 0, k, (ox + r.x * z) * dpr, (oy + r.y * z) * dpr);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, r.w, r.h); ctx.clip();
      if (p) {
        drawPaper(ctx, p, this.paper, k); drawStrokes(ctx, p, k, dark);
        if (this.partial && this.partial.pid === pid) { const s = this.partial.s, n = Math.max(1, Math.floor(s.pts.length / STRIDE * Math.min(1, this.partial.f))); drawStroke(ctx, { ...s, pts: s.pts.subarray(0, n * STRIDE), bb: null }, k, dark, false); }
        if (v.curtain && v.curtain.pid === pid) drawCurtain(ctx, p, v.curtain.y, k);
      } else { ctx.fillStyle = PAPERS[this.paper]?.fill || '#fff'; ctx.fillRect(0, 0, r.w, r.h); }
      ctx.restore();
    }
    if (this.laser.length) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawLaserTrail(ctx, this.laser.map(q => ({ x: ox + q.x * z, y: oy + q.y * z, a: q.a, s: q.s })), this.laserHead, prefs.laser || {}); }
  }
}

export async function loadLesson(id) { const r = await db.get('kv', KV(id)); if (!r) return null; try { return JSON.parse(r.v); } catch { return null; } }
export async function hasLesson(id) { return !!(await db.get('kv', KV(id))); }
export async function deleteLesson(id) { try { await db.del('kv', KV(id)); } catch { } }

// ---------- player ----------
export async function openPlayer(meta, audioBlob) {
  const bz = busy('กำลังเตรียมบทเรียน…');
  let data; try { data = await loadLesson(meta.id); } finally { bz.done(); }
  if (!data) return toast('ไม่พบข้อมูลลายมือของการอัดนี้', 2500, 'warn');
  const st = new State(data); await st.prepare();
  const dur = Math.max(data.duration || 0, meta.duration || 0, data.events.at(-1)?.[0] || 0);
  for (const sc of document.querySelectorAll('#layer .scrim')) sc.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); // close the list the player was opened from
  const root = h('div', { class: 'lplayer' });
  const cv = h('canvas'); const ctx = cv.getContext('2d', { alpha: false });
  const audio = audioBlob ? h('audio', { src: URL.createObjectURL(audioBlob), preload: 'auto' }) : null;
  const title = h('div', { class: 'lp-title' }, meta.name || 'บทเรียน');
  const tEl = h('span', { class: 'lp-t' }, '0:00 / ' + fmtTime(dur));
  const bar = h('input', { type: 'range', min: 0, max: Math.round(dur), value: 0, step: 50, class: 'lp-bar' });
  const play = h('button', { class: 'btn sq big', title: 'เล่น/หยุด' }, icon('play'));
  const speed = seg([['1', '1×'], ['1.5', '1.5×'], ['2', '2×']], '1', v => { rate = +v; if (audio) audio.playbackRate = rate; });
  const close = h('button', { class: 'btn sq', title: 'ปิด' }, icon('close'));
  const exp = h('button', { class: 'pill sec' }, icon('film'), 'ส่งออกเป็นวิดีโอ');
  root.append(h('div', { class: 'lp-head' }, title, h('span', { class: 'grow' }), exp, close), h('div', { class: 'lp-stage' }, cv), h('div', { class: 'lp-ctl' }, play, bar, tEl, speed));
  document.body.append(root);
  let playing = false, rate = 1, t = 0, base = 0, startAt = 0, raf = 0, dirty = true;
  const size = () => { const r = cv.parentElement.getBoundingClientRect(); const d = Math.min(2, devicePixelRatio || 1); cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); cv._w = r.width; cv._h = r.height; cv._d = d; dirty = true; };
  size(); addEventListener('resize', size); setImageReadyHook(() => dirty = true); setPdfReadyHook(() => dirty = true);
  const curT = () => audio ? audio.currentTime * 1000 : (playing ? base + (performance.now() - startAt) * rate : base);
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const nt = Math.min(dur, curT());
    if (nt !== t || dirty) { t = nt; st.seek(t); st.draw(ctx, cv._w, cv._h, cv._d); dirty = false; bar.value = Math.round(t); tEl.textContent = fmtTime(t) + ' / ' + fmtTime(dur); }
    if (playing && t >= dur) stop();
  };
  const stop = () => { playing = false; base = t; audio?.pause(); play.replaceChildren(icon('play')); };
  const go = () => { if (t >= dur - 50) { t = 0; base = 0; if (audio) audio.currentTime = 0; } playing = true; startAt = performance.now(); if (audio) { audio.playbackRate = rate; audio.play().catch(() => { }); } play.replaceChildren(icon('pause')); };
  play.onclick = () => playing ? stop() : go();
  bar.oninput = () => { const v = +bar.value; if (audio) audio.currentTime = v / 1000; base = v; startAt = performance.now(); t = -1; dirty = true; };
  close.onclick = () => { cancelAnimationFrame(raf); audio?.pause(); removeEventListener('resize', size); root.remove(); };
  exp.onclick = () => exportVideo(meta, data, audioBlob, dur);
  loop();
  return root;
}

// ---------- export to video (real-time render + audio) ----------
export async function exportVideo(meta, data, audioBlob, dur) {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return toast('เบราว์เซอร์นี้ส่งออกวิดีโอไม่ได้', 3000, 'warn');
  let pick = '1920';
  const res = await new Promise(r => dialog('ส่งออกเป็นวิดีโอ', h('div', {}, h('p', {}, `ความยาว ${fmtTime(dur)} · การแปลงใช้เวลาเท่าความยาวจริง ต้องเปิดหน้านี้ค้างไว้จนเสร็จ`), h('div', { class: 'lbl' }, 'ความละเอียด'), seg([['1280', '720p'], ['1920', '1080p'], ['2560', '1440p']], '1920', v => { pick = v; })), [{ label: 'ยกเลิก', action: () => r(null) }, { label: 'เริ่มแปลง', cls: 'prim', flex: 2, action: () => r(pick) }]));
  if (!res) return;
  const W = +res, H = Math.round(W * 9 / 16);
  const st = new State(data); await st.prepare();
  const cv = h('canvas', { width: W, height: H, style: { position: 'fixed', left: '-9999px', top: 0 } }); document.body.append(cv);
  const ctx = cv.getContext('2d', { alpha: false });
  const stream = cv.captureStream(30);
  let ac = null, audioEl = null;
  if (audioBlob) {
    ac = new (window.AudioContext || window.webkitAudioContext)(); audioEl = h('audio', { src: URL.createObjectURL(audioBlob) }); document.body.append(audioEl);
    const src = ac.createMediaElementSource(audioEl), dest = ac.createMediaStreamDestination(); src.connect(dest); for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  }
  const { pickMime, showRecording } = await import('./recorder.js');
  const mime = pickMime(); let mr; try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: W >= 2560 ? 12e6 : W >= 1920 ? 8e6 : 4e6 } : undefined); } catch { mr = new MediaRecorder(stream); }
  const chunks = []; mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const bz = busy('กำลังแปลงเป็นวิดีโอ…', fmtTime(0) + ' / ' + fmtTime(dur), 0);
  let cancelled = false; const cancelBtn = h('button', { class: 'pill ghost', style: { marginTop: '10px', pointerEvents: 'auto' } }, 'ยกเลิก'); cancelBtn.onclick = () => { cancelled = true; }; document.querySelector('.busy .busy-box')?.append(cancelBtn);
  mr.start(1000); const t0 = performance.now(); if (audioEl) { await ac.resume(); audioEl.play().catch(() => { }); }
  await new Promise(res2 => {
    const tick = () => {
      const wall = performance.now() - t0, at = audioEl ? audioEl.currentTime * 1000 : 0;
      const t = at > 200 ? at : wall; // audio clock when it runs, wall clock otherwise
      st.seek(Math.min(dur, t)); st.draw(ctx, W, H, 1);
      bz.set('กำลังแปลงเป็นวิดีโอ…', fmtTime(t) + ' / ' + fmtTime(dur), t / dur);
      if (wall >= dur + 300 || cancelled) return res2(); requestAnimationFrame(tick);
    }; tick();
  });
  const stopped = new Promise(r => { mr.onstop = r; setTimeout(r, 3000); }); mr.stop(); await stopped;
  audioEl?.pause(); try { ac?.close(); } catch { } cv.remove(); audioEl?.remove(); bz.done();
  if (cancelled) return toast('ยกเลิกการแปลงแล้ว', 1500);
  let blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
  if (blob.type.includes('mp4')) { try { const { defragMp4 } = await import('./mp4fix.js'); const fixed = await defragMp4(blob); if (fixed) blob = new Blob([fixed], { type: blob.type }); } catch { } }
  const d = new Date(meta.created || Date.now());
  const vmeta = { id: uid(), kind: 'video', name: (meta.name || 'บทเรียน').replace(' · เสียง', ' · วิดีโอ'), nb: meta.nb, created: Date.now(), duration: dur, size: blob.size, mime: blob.type, res: String(H), done: true, fromLesson: meta.id };
  await db.put('recs', vmeta); await db.addChunk(vmeta.id, 0, blob);
  toast(`ได้วิดีโอ ${fmtBytes(blob.size)} แล้ว · อยู่ในคลิปที่อัดไว้`, 3000);
  showRecording(vmeta, true, blob);
  try { (await import('./recorder.js')).scheduleBackgroundUpload(); } catch { }
}
