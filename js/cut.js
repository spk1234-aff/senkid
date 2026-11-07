// ตัดต่อบทเรียน — a storyboard editor: clips in a row, each trimmed/split/removed, played as one piece and
// rendered to one MP4. Sources: recorded lessons (ink + audio + camera), videos in the app, notebook pages,
// images, videos from the device, title cards. Nothing destructive: the project only stores references + in/out.
import { h, icon, toast, dialog, busy, fmtTime, fmtBytes, uid, confirmBox, ask, pickFile, seg } from './ui.js';
import * as db from './db.js';
import { prefs, savePrefs } from './prefs.js';
import { renderPageTo } from './render.js';
import { lessonSource, drawCamFrame } from './lesson.js';
import { CREDIT } from './exportpdf.js';
import { loadAssets as titleAssets, drawTitleCard, openTitleDesigner } from './titlecard.js';

const KEY = (id) => 'proj:' + id;
export async function listProjects() { return (await db.getAll('kv')).filter(x => x.k.startsWith('proj:')).map(x => x.v).sort((a, b) => (b.updated || 0) - (a.updated || 0)); }
export async function saveProject(pr) { pr.updated = Date.now(); await db.putQuiet('kv', { k: KEY(pr.id), v: pr }); }
export async function deleteProject(id) { try { await db.del('kv', KEY(id)); } catch { } }

const HOLD = 4000; // default length of a still (page / image / title), ms
const FADE = 500;
const clipDur = (c) => c.kind === 'lesson' || c.kind === 'video' ? Math.max(100, (c.out - c.in) / (c.speed || 1)) : (c.hold || HOLD);
export const totalDur = (pr) => pr.clips.reduce((a, c) => a + clipDur(c), 0);
const KIND_TH = { lesson: 'บทเรียน', video: 'วิดีโอ', page: 'หน้าสมุด', image: 'รูป', title: 'ชื่อตอน' };

// ---------- sources (cached per clip src key) ----------
class Source {
  constructor(clip) { this.clip = clip; this.ready = false; }
  async load() { this.ready = true; }
  get dur() { return this.clip.dur || 0; }
  draw(ctx, W, H, t) { }
  audioEls() { return []; }             // media elements that carry sound
  play(t, rate, muted) { }
  pause() { }
  seek(t) { }
  clock() { return null; }               // ms of source time while playing, when a media clock exists
  dispose() { }
}
const letterbox = (ctx, el, W, H, vw, vh) => { const s = Math.min(W / vw, H / vh), w = vw * s, hh = vh * s; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); try { ctx.drawImage(el, (W - w) / 2, (H - hh) / 2, w, hh); } catch { } };
class LessonSrc extends Source {
  async load() {
    const meta = await db.get('recs', this.clip.src); if (!meta) throw new Error('ไม่พบบทเรียน');
    const L = await lessonSource(meta); if (!L) throw new Error('ไม่พบข้อมูลลายมือ');
    this.meta = meta; this.L = L; this.clip.dur = this.clip.dur || L.dur;
    this.audio = L.audioBlob ? h('audio', { src: URL.createObjectURL(L.audioBlob), preload: 'auto' }) : null;
    this.cam = L.camBlob ? h('video', { src: URL.createObjectURL(L.camBlob), muted: true, playsinline: true, preload: 'auto' }) : null;
    if (this.cam) this.cam.muted = true;
    for (const el of [this.audio, this.cam]) if (el) { el.style.cssText = 'position:fixed;left:-9999px;top:0;width:64px'; document.body.append(el); }
    if (this.audio) this.audio.onended = () => { this.ended = true; };
    this.ready = true;
  }
  draw(ctx, W, H, t) { const st = this.L.st; st.seek(Math.min(this.dur, t)); st.draw(ctx, W, H, 1); if (this.cam && this.clip.cam !== false) { if (Math.abs(this.cam.currentTime * 1000 - t) > 500) { try { this.cam.currentTime = t / 1000; } catch { } } drawCamFrame(ctx, this.meta, this.cam, W, H); } }
  audioEls() { return this.audio ? [this.audio] : []; }
  play(t, rate, muted) { if (this.ended) return; for (const el of [this.audio, this.cam]) if (el) { el.playbackRate = rate; if (Math.abs(el.currentTime * 1000 - t) > 250) { try { el.currentTime = t / 1000; } catch { } } el.play().catch(() => { }); } if (this.audio) this.audio.muted = !!muted; }
  pause() { this.audio?.pause(); this.cam?.pause(); }
  seek(t) { this.ended = false; for (const el of [this.audio, this.cam]) if (el) { try { el.currentTime = t / 1000; } catch { } } }
  clock() { return this.audio && !this.audio.paused && !this.ended ? this.audio.currentTime * 1000 : null; }
  dispose() { for (const el of [this.audio, this.cam]) el?.remove(); }
}
class VideoSrc extends Source {
  async load() {
    const meta = await db.get('recs', this.clip.src); if (!meta) throw new Error('ไม่พบวิดีโอ');
    const R = await import('./recorder.js'); const blob = await R.recBlob(meta);
    this.v = h('video', { src: URL.createObjectURL(blob), playsinline: true, preload: 'auto', style: 'position:fixed;left:-9999px;top:0;width:64px' }); document.body.append(this.v);
    await new Promise(r => { this.v.onloadedmetadata = r; setTimeout(r, 4000); });
    this.v.onended = () => { this.ended = true; };
    if (!this.clip.dur || !isFinite(this.clip.dur)) this.clip.dur = isFinite(this.v.duration) ? Math.round(this.v.duration * 1000) : (meta.duration || 0);
    if (this.clip.out == null || this.clip.out > this.clip.dur) this.clip.out = this.clip.dur;
    this.ready = true;
  }
  draw(ctx, W, H, t) { if (this.v.paused && Math.abs(this.v.currentTime * 1000 - t) > 120) { try { this.v.currentTime = t / 1000; } catch { } } letterbox(ctx, this.v, W, H, this.v.videoWidth || 16, this.v.videoHeight || 9); }
  audioEls() { return [this.v]; }
  play(t, rate, muted) { if (this.ended) return; this.v.playbackRate = rate; this.v.muted = !!muted; if (Math.abs(this.v.currentTime * 1000 - t) > 250) { try { this.v.currentTime = t / 1000; } catch { } } this.v.play().catch(() => { }); }
  pause() { this.v.pause(); }
  seek(t) { this.ended = false; try { this.v.currentTime = t / 1000; } catch { } }
  clock() { return !this.v.paused && !this.ended ? this.v.currentTime * 1000 : null; }
  dispose() { this.v.remove(); }
}
class StillSrc extends Source {
  async load() {
    const c = this.clip;
    if (c.kind === 'image') { const blob = c.blob || (await db.get('kv', 'cutimg:' + c.src))?.v; this.img = await createImageBitmap(blob); }
    else if (c.kind === 'title' && c.design) this.A = await titleAssets(c.design);
    else if (c.kind === 'page') { const pg = await db.get('pages', c.src.pid); const nb = await db.get('notebooks', c.src.nb); const cv = document.createElement('canvas'); if (pg) renderPageTo(cv, pg, nb?.paper || 'cream', 1600); this.img = cv; }
    this.ready = true;
  }
  draw(ctx, W, H, t) {
    const c = this.clip;
    if (c.kind === 'title' && c.design) { drawTitleCard(ctx, W, H, c.design, this.A || {}); return; }
    if (c.kind === 'title') {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = c.bg || '#1E2A55'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = c.fg || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const big = Math.round(H * 0.11), small = Math.round(H * 0.055);
      ctx.font = `bold ${big}px "TH Sarabun New", system-ui, sans-serif`; ctx.fillText(c.text || '', W / 2, H / 2 - (c.sub ? small * 0.8 : 0), W * 0.9);
      if (c.sub) { ctx.font = `${small}px "TH Sarabun New", system-ui, sans-serif`; ctx.globalAlpha = 0.85; ctx.fillText(c.sub, W / 2, H / 2 + big * 0.7, W * 0.9); ctx.globalAlpha = 1; }
      return;
    }
    if (!this.img) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = c.kind === 'page' ? '#EDEAE2' : '#000'; ctx.fillRect(0, 0, W, H);
    const vw = this.img.width, vh = this.img.height, s = Math.min(W / vw, H / vh), w = vw * s, hh = vh * s; ctx.drawImage(this.img, (W - w) / 2, (H - hh) / 2, w, hh);
  }
}
const makeSrc = (c) => c.kind === 'lesson' ? new LessonSrc(c) : c.kind === 'video' ? new VideoSrc(c) : new StillSrc(c);

// ---------- the player engine (preview and export share it) ----------
export class Engine {
  constructor(pr) { this.pr = pr; this.srcs = new Map(); this.cur = -1; this.playing = false; }
  src(c) { let s = this.srcs.get(c.id); if (!s) { s = makeSrc(c); this.srcs.set(c.id, s); } return s; }
  async loadAll(onProgress) { let i = 0; for (const c of this.pr.clips) { const s = this.src(c); if (!s.ready) { try { await s.load(); } catch (e) { console.warn('clip', e); s.error = e.message || String(e); s.ready = true; } } onProgress?.(++i, this.pr.clips.length); } }
  locate(t) { // project time → clip index + local source time
    let acc = 0;
    for (let i = 0; i < this.pr.clips.length; i++) { const c = this.pr.clips[i], d = clipDur(c); if (t < acc + d || i === this.pr.clips.length - 1) { const local = Math.min(d, Math.max(0, t - acc)); return { i, c, local, start: acc, d, srcT: (c.in || 0) + local * (c.speed || 1) }; } acc += d; }
    return null;
  }
  draw(ctx, W, H, t) {
    const L = this.locate(t); if (!L) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    const s = this.src(L.c);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!s.ready && !s.error) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#aaa'; ctx.font = `${Math.round(H * 0.05)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('กำลังโหลด…', W / 2, H / 2); return L; }
    if (s.error) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#f88'; ctx.font = `${Math.round(H * 0.05)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(s.error, W / 2, H / 2); }
    else s.draw(ctx, W, H, L.c.kind === 'lesson' || L.c.kind === 'video' ? L.srcT : L.local);
    if (this.pr.fade) { const edge = Math.min(L.local, L.d - L.local); if (edge < FADE && (L.local < FADE ? L.i > 0 : L.i < this.pr.clips.length - 1)) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1 - edge / FADE; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; } }
    return L;
  }
  // keep media playing in step with project time t (called every frame while playing)
  sync(t) {
    const L = this.locate(t); if (!L) return;
    const s = this.src(L.c); if (!s.ready) return;
    const muted = (L.c.speed || 1) > 1 || L.c.mute;
    if (this.cur !== L.i) { if (this.cur >= 0) this.src(this.pr.clips[this.cur])?.pause(); this.cur = L.i; s.seek(L.srcT); s.play(L.srcT, L.c.speed || 1, muted); }
    else if (L.c.kind === 'lesson' || L.c.kind === 'video') { const ck = s.clock(); if (ck == null) { if (!s.ended) s.play(L.srcT, L.c.speed || 1, muted); } else if (Math.abs(ck - L.srcT) > 400) s.seek(L.srcT); }
  }
  // project time derived from the media clock of the playing clip (drift-free)
  clockT() { if (this.cur < 0) return null; const c = this.pr.clips[this.cur]; const s = this.src(c); const ck = s.clock(); if (ck == null) return null; let acc = 0; for (let i = 0; i < this.cur; i++) acc += clipDur(this.pr.clips[i]); return acc + (ck - (c.in || 0)) / (c.speed || 1); }
  pauseAll() { for (const s of this.srcs.values()) s.pause(); this.cur = -1; }
  dispose() { for (const s of this.srcs.values()) s.dispose(); this.srcs.clear(); }
}

// ---------- silence / dead-air analysis ----------
async function rmsTrack(blob, step = 100) {
  const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
  const buf = await ac.decodeAudioData(await blob.arrayBuffer());
  const ch = buf.getChannelData(0), sr = buf.sampleRate, n = Math.floor(sr * step / 1000), out = [];
  for (let i = 0; i + n <= ch.length; i += n) { let s = 0; for (let j = i; j < i + n; j++) s += ch[j] * ch[j]; out.push(Math.sqrt(s / n)); }
  return { rms: out, step, dur: buf.duration * 1000 };
}
// ranges (ms, source time) where nobody speaks and nothing is written for at least minLen ms
export async function findDeadAir(src, { minLen = 8000, pad = 500, level = 'mid' } = {}) {
  const c = src.clip, blob = c.kind === 'lesson' ? src.L?.audioBlob : null;
  let speech = null, step = 100, n = Math.ceil(src.dur / step);
  if (c.kind === 'video') { const R = await import('./recorder.js'); const meta = await db.get('recs', c.src); const b = await R.recBlob(meta); try { const t = await rmsTrack(b, step); speech = t.rms; } catch (e) { console.warn('decode', e); } }
  else if (blob) { try { const t = await rmsTrack(blob, step); speech = t.rms; } catch (e) { console.warn('decode', e); } }
  if (!speech) return { ranges: [], noAudio: true };
  n = speech.length;
  const sorted = speech.slice().sort((a, b) => a - b), floor = sorted[Math.floor(sorted.length * 0.15)] || 0;
  const loud = sorted[Math.floor(sorted.length * 0.9)] || 0; // typical speech level
  const mult = level === 'low' ? 4 : level === 'high' ? 2.2 : 3, rel = level === 'low' ? 0.12 : level === 'high' ? 0.05 : 0.08;
  const thr = Math.max(floor * mult, loud * rel, 0.003);
  const talking = speech.map(v => v > thr);
  // ink activity from the timeline (lesson clips only)
  const ink = new Array(n).fill(false);
  if (c.kind === 'lesson' && src.L) for (const ev of src.L.data.events) { if (['add', 'rm', 'rep', 'laser'].includes(ev[1])) { const a = Math.floor((ev[4] != null ? ev[4] : ev[0]) / step), b = Math.floor(ev[0] / step); for (let i = Math.max(0, a - 2); i <= Math.min(n - 1, b + 2); i++) ink[i] = true; } }
  const busy = talking.map((v, i) => v || ink[i]);
  const ranges = []; let start = -1;
  for (let i = 0; i <= n; i++) { const b = i < n ? busy[i] : true; if (!b && start < 0) start = i; if (b && start >= 0) { const a = start * step, e = i * step; if (e - a >= minLen) ranges.push({ a: a + pad, b: e - pad, len: e - a - 2 * pad }); start = -1; } }
  const stats = { talk: talking.filter(Boolean).length * step, ink: ink.filter(Boolean).length * step, dead: ranges.reduce((s, r) => s + r.len, 0), total: n * step };
  return { ranges: ranges.filter(r => r.b > r.a + 500), stats };
}
// apply cuts to a clip: split into the kept pieces
export function applyCuts(pr, clip, ranges) {
  const keep = []; let pos = clip.in || 0; const end = clip.out;
  for (const r of ranges.sort((x, y) => x.a - y.a)) { const a = Math.max(pos, r.a), b = Math.min(end, r.b); if (b <= a) continue; if (a > pos + 300) keep.push([pos, a]); pos = b; }
  if (end > pos + 300) keep.push([pos, end]);
  const i = pr.clips.indexOf(clip); if (i < 0 || !keep.length) return;
  const pieces = keep.map(([a, b]) => ({ ...clip, id: uid(), in: a, out: b }));
  pr.clips.splice(i, 1, ...pieces);
}

// ---------- the editor UI ----------
export async function openCutEditor(app, { projectId = null, addRec = null, addRecs = null } = {}) {
  let pr = projectId ? (await db.get('kv', KEY(projectId)))?.v : null;
  if (!pr) { pr = { id: uid(), name: 'ตัดต่อ ' + new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }), created: Date.now(), clips: [], fade: true, res: '1920', chapters: [] }; }
  if (addRec) await addRecClip(pr, addRec);
  if (addRecs) { for (const r of addRecs) { try { await addRecClip(pr, r); } catch (e) { toast('เพิ่ม "' + r.name + '" ไม่ได้: ' + (e.message || e), 3000, 'warn'); } } if (addRecs.length) pr.name = (addRecs[0].name || pr.name).replace(/ · (เสียง.*|ตอนที่ \d+)$/, '') + ' · ตัดต่อ'; }
  for (const sc of document.querySelectorAll('#layer .scrim')) sc.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const eng = new Engine(pr);
  const root = h('div', { class: 'lplayer cutter' });
  const cv = h('canvas'); const ctx = cv.getContext('2d', { alpha: false });
  const nameBtn = h('button', { class: 'lp-title', style: { background: 'transparent', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'left' } }, pr.name);
  nameBtn.onclick = async () => { const v = await ask('ชื่อโปรเจกต์', { value: pr.name }); if (v) { pr.name = v; nameBtn.textContent = v; save(); } };
  const close = h('button', { class: 'btn', title: 'ปิด (บันทึกให้เอง)' }, icon('close'));
  const undoBtn = h('button', { class: 'btn', title: 'ย้อนกลับ' }, icon('undo')), redoBtn = h('button', { class: 'btn', title: 'ทำซ้ำ' }, icon('redo'));
  const addBtn = h('button', { class: 'pill prim' }, icon('plus'), 'เพิ่มคลิป');
  const quietBtn = h('button', { class: 'pill sec' }, icon('mic'), 'ตัดช่วงเงียบ');
  const chapBtn = h('button', { class: 'pill sec' }, icon('edit'), 'สารบัญ');
  const expBtn = h('button', { class: 'pill sec' }, icon('film'), 'ส่งออก');
  const head = h('div', { class: 'lp-head' }, nameBtn, h('span', { class: 'grow' }), undoBtn, redoBtn, addBtn, quietBtn, chapBtn, expBtn, close);
  const stageEl = h('div', { class: 'lp-stage' }, cv);
  const play = h('button', { class: 'btn big' }, icon('play'));
  const bar = h('input', { type: 'range', class: 'lp-bar', min: 0, max: 1000, value: 0 });
  const tEl = h('div', { class: 'lp-t' }, '0:00 / 0:00');
  const ctl = h('div', { class: 'lp-ctl' }, play, bar, tEl);
  const strip = h('div', { class: 'cut-strip' });
  const tools = h('div', { class: 'cut-tools' });
  root.append(head, stageEl, ctl, strip, tools);
  document.body.append(root);
  let t = 0, playing = false, sel = null, raf = 0, dirty = true, lastWall = 0;
  const dur = () => totalDur(pr);
  const save = () => saveProject(pr).catch(() => { });
  // the preview is always 16:9 (what the video will look like), centred in the stage with dark bars
  const size = () => {
    const r = stageEl.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    let w = r.width, hh = w * 9 / 16; if (hh > r.height) { hh = r.height; w = hh * 16 / 9; }
    Object.assign(cv.style, { width: w + 'px', height: hh + 'px', left: (r.width - w) / 2 + 'px', top: (r.height - hh) / 2 + 'px', right: 'auto', bottom: 'auto' });
    cv.width = Math.max(2, Math.round(w * d)); cv.height = Math.max(2, Math.round(hh * d)); cv._w = w; cv._h = hh; cv._d = d; dirty = true;
  };
  size(); addEventListener('resize', size);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => size()) : null; ro?.observe(stageEl);
  const paintTime = () => { const D = dur(); bar.value = D ? Math.round(t / D * 1000) : 0; tEl.textContent = fmtTime(t) + ' / ' + fmtTime(D); };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (playing) { const ck = eng.clockT(); const dt = lastWall ? now - lastWall : 0; lastWall = now; t = ck != null ? ck : t + dt; eng.sync(t); if (t >= dur()) { stop(); t = dur(); } dirty = true; }
    if (dirty) { ctx.setTransform(1, 0, 0, 1, 0, 0); const L = eng.draw(ctx, cv.width, cv.height, t); dirty = playing; paintTime(); markStrip(L); }
  };
  const stop = () => { playing = false; lastWall = 0; eng.pauseAll(); play.replaceChildren(icon('play')); dirty = true; };
  const go = () => { if (!pr.clips.length) return; if (t >= dur() - 50) t = 0; playing = true; lastWall = 0; play.replaceChildren(icon('pause')); };
  play.onclick = () => playing ? stop() : go();
  bar.oninput = () => { stop(); t = +bar.value / 1000 * dur(); dirty = true; };
  const seekTo = (v) => { stop(); t = Math.max(0, Math.min(dur(), v)); dirty = true; };
  let lastMark = -1;
  const markStrip = (L) => { const i = L ? L.i : -1; if (i === lastMark) return; lastMark = i; for (const el of strip.querySelectorAll('.cut-clip')) el.classList.toggle('playing', +el.dataset.i === i); };
  const startOf = (i) => { let a = 0; for (let k = 0; k < i; k++) a += clipDur(pr.clips[k]); return a; };

  // ---- strip ----
  const paintStrip = () => {
    strip.innerHTML = '';
    pr.clips.forEach((c, i) => {
      const th = h('canvas', { class: 'cut-th', width: 160, height: 90 });
      const card = h('div', { class: 'cut-clip' + (sel === c ? ' on' : ''), 'data-i': i },
        th, h('div', { class: 'cut-name' }, c.name || KIND_TH[c.kind]), h('div', { class: 'cut-meta' }, `${KIND_TH[c.kind]} · ${fmtTime(clipDur(c))}${c.speed > 1 ? ' · ' + c.speed + '×' : ''}${c.mute ? ' · เงียบ' : ''}`));
      card.onclick = () => { sel = sel === c ? null : c; paintStrip(); paintTools(); if (sel) seekTo(startOf(i)); };
      strip.append(card);
      const s = eng.src(c); const paintTh = () => { try { const x = th.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); s.draw(x, 160, 90, c.kind === 'lesson' || c.kind === 'video' ? (c.in || 0) + 1000 : 0); } catch { } };
      if (s.ready) paintTh(); else s.load().then(paintTh).catch(e => { s.error = e.message; card.classList.add('bad'); });
    });
    const add = h('button', { class: 'cut-clip add' }, icon('plus'), h('span', {}, 'เพิ่มคลิป')); add.onclick = () => addMenu(); strip.append(add);
    if (!pr.clips.length) strip.append(h('div', { class: 'cut-empty' }, 'ยังไม่มีคลิป · กด "เพิ่มคลิป" เลือกบทเรียนที่อัดไว้ วิดีโอ หน้าสมุด รูป หรือไฟล์จากเครื่อง'));
  };
  // ---- tools for the selected clip ----
  const paintTools = () => {
    tools.innerHTML = '';
    if (!sel) { tools.append(h('div', { class: 'sub', style: { padding: '6px 12px' } }, pr.clips.length ? 'แตะคลิปเพื่อตัด · ลำดับซ้าย→ขวาคือลำดับในวิดีโอ' : '')); return; }
    const c = sel, i = pr.clips.indexOf(c), B = (ic, label, fn, cls = 'sec') => { const b = h('button', { class: 'pill ' + cls }, icon(ic), label); b.onclick = fn; return b; };
    const row = h('div', { class: 'cut-row' });
    if (c.kind === 'lesson' || c.kind === 'video') row.append(B('scissors', 'ตัดหัว‑ท้าย', () => trimDialog(c)), B('dup', 'แบ่งตรงนี้', () => splitAt()));
    else row.append(B('timer', `แสดง ${Math.round((c.hold || HOLD) / 1000)} วิ`, () => holdDialog(c)));
    row.append(B('history', 'คืนค่าคลิปนี้', () => resetClip(c)), B('gear', 'ตั้งค่า', () => clipSettings(c)), B('back', 'ซ้าย', () => move(-1)), B('chev', 'ขวา', () => move(1)), B('copy', 'ทำสำเนา', () => { pr.clips.splice(i + 1, 0, { ...c, id: uid() }); changed(); }), B('trash', 'ลบ', () => { pr.clips.splice(i, 1); sel = null; changed(); }, 'ghost'));
    tools.append(row);
  };
  // ---- undo / redo: snapshots of the clip list (up to 60 steps) ----
  const snap = () => JSON.stringify({ clips: pr.clips, fade: pr.fade });
  const hist = [snap()]; let hi = 0;
  const syncUndo = () => { undoBtn.disabled = hi <= 0; redoBtn.disabled = hi >= hist.length - 1; };
  const restore = (j) => {
    hi = j; const S = JSON.parse(hist[j]), byId = new Map(pr.clips.map(c => [c.id, c]));
    // keep the same clip objects where possible so the loaded sources stay attached
    pr.clips = S.clips.map(sc => { const o = byId.get(sc.id); if (!o) return sc; for (const k of Object.keys(o)) delete o[k]; return Object.assign(o, sc); });
    pr.fade = S.fade; sel = sel && pr.clips.includes(sel) ? sel : null;
    save(); paintStrip(); paintTools(); dirty = true; eng.cur = -1; t = Math.min(t, dur()); syncUndo();
  };
  undoBtn.onclick = () => { if (hi > 0) { stop(); restore(hi - 1); toast('ย้อนกลับ', 800); } };
  redoBtn.onclick = () => { if (hi < hist.length - 1) { stop(); restore(hi + 1); toast('ทำซ้ำ', 800); } };
  const changed = () => {
    const s2 = snap(); if (s2 !== hist[hi]) { hist.splice(hi + 1); hist.push(s2); if (hist.length > 61) hist.shift(); hi = hist.length - 1; }
    save(); paintStrip(); paintTools(); dirty = true; eng.cur = -1; t = Math.min(t, dur()); syncUndo();
  };
  // undo everything done to this clip: join the pieces it was cut into, full length, normal speed and sound
  const resetClip = (c) => {
    const i = pr.clips.indexOf(c); if (i < 0) return;
    if (c.kind === 'lesson' || c.kind === 'video') {
      let a = i, b = i; const same = (x) => x && x.kind === c.kind && x.src === c.src;
      while (same(pr.clips[a - 1])) a--; while (same(pr.clips[b + 1])) b++;
      const D = c.dur || eng.src(c).dur || c.out;
      Object.assign(c, { in: 0, out: D, speed: 1, mute: false }); delete c.cam;
      pr.clips.splice(a, b - a + 1, c);
    } else if (c.kind !== 'title') c.hold = HOLD;
    sel = c; stop(); changed(); toast('คืนค่าคลิปนี้แล้ว (กดย้อนกลับได้)', 1800);
  };
  const move = (d) => { const i = pr.clips.indexOf(sel), j = i + d; if (j < 0 || j >= pr.clips.length) return; pr.clips.splice(i, 1); pr.clips.splice(j, 0, sel); changed(); };
  const splitAt = () => { const L = eng.locate(t); if (!L || L.c !== sel) { toast('เลื่อนตัวเล่นไปตรงที่จะแบ่งภายในคลิปนี้ก่อน', 2500); return; } if (L.local < 500 || L.d - L.local < 500) { toast('ใกล้ขอบคลิปเกินไป', 1500); return; } const c = sel, at = L.srcT; const b = { ...c, id: uid(), in: at }; c.out = at; pr.clips.splice(pr.clips.indexOf(c) + 1, 0, b); sel = b; changed(); toast('แบ่งเป็น 2 คลิปแล้ว · ลบชิ้นที่ไม่เอาได้เลย', 2000); };
  const trimDialog = (c) => {
    const s = eng.src(c), D = c.dur || s.dur; let a = c.in || 0, b = c.out ?? D;
    const pv = h('canvas', { width: 320, height: 180, style: { width: '100%', borderRadius: '8px', background: '#000' } });
    const show = (x) => { try { const g = pv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); s.draw(g, 320, 180, x); } catch { } };
    const ra = h('input', { type: 'range', min: 0, max: D, value: a, step: 100, style: { width: '100%' } }), rb = h('input', { type: 'range', min: 0, max: D, value: b, step: 100, style: { width: '100%' } });
    const la = h('span', { class: 'cut-tl' }), lb = h('span', { class: 'cut-tl' });
    const upd = (which) => { a = +ra.value; b = +rb.value; if (b < a + 500) { if (which === 'a') { a = b - 500; ra.value = a; } else { b = a + 500; rb.value = b; } } la.textContent = 'เริ่ม ' + fmtTime(a); lb.textContent = 'จบ ' + fmtTime(b) + ` · ยาว ${fmtTime(b - a)}`; show(which === 'b' ? b : a); };
    ra.oninput = () => upd('a'); rb.oninput = () => upd('b'); upd('a');
    const nudge = (which, d) => { if (which === 'a') ra.value = Math.max(0, Math.min(D, a + d)); else rb.value = Math.max(0, Math.min(D, b + d)); upd(which); };
    const N = (which, d) => { const x = h('button', { class: 'chip' }, (d > 0 ? '+' : '−') + Math.abs(d / 1000) + ' วิ'); x.onclick = () => nudge(which, d); return x; };
    dialog('ตัดหัว‑ท้าย', h('div', {}, pv, h('div', { class: 'lbl' }, 'จุดเริ่ม'), ra, h('div', { class: 'cut-nudge' }, la, N('a', -1000), N('a', 1000)), h('div', { class: 'lbl' }, 'จุดจบ'), rb, h('div', { class: 'cut-nudge' }, lb, N('b', -1000), N('b', 1000))),
      [{ label: 'ยกเลิก' }, { label: 'ใช้', cls: 'prim', flex: 2, action: () => { c.in = a; c.out = b; changed(); } }], { width: 520 });
  };
  const holdDialog = async (c) => { const v = await ask('แสดงกี่วินาที', { value: String(Math.round((c.hold || HOLD) / 1000)) }); const n = parseFloat(v); if (n > 0) { c.hold = Math.round(n * 1000); changed(); } };
  const clipSettings = async (c) => {
    // a designed title card: edit it in the same designer as Make-video
    if (c.kind === 'title' && c.design) {
      const d = await openTitleDesigner(c.design); if (!d) return;
      c.design = d; c.text = d.lines[0] || c.text; c.sub = d.lines[1] || ''; c.name = c.name || c.text; c.hold = d.hold || c.hold;
      try { eng.src(c).A = await titleAssets(d); } catch { }
      changed(); return;
    }
    const body = h('div', {});
    if (c.kind === 'lesson' || c.kind === 'video') body.append(h('div', { class: 'lbl', style: { marginTop: 0 } }, 'ความเร็ว (เร็วกว่า 1× จะปิดเสียงช่วงนี้)'), seg([['1', '1×'], ['1.5', '1.5×'], ['2', '2×'], ['3', '3×']], String(c.speed || 1), v => c.speed = +v),
      h('div', { class: 'lbl' }, 'เสียง'), seg([['on', 'เปิด'], ['off', 'ปิดเสียง']], c.mute ? 'off' : 'on', v => c.mute = v === 'off'));
    if (c.kind === 'lesson') body.append(h('div', { class: 'lbl' }, 'กล้องครู'), seg([['on', 'แสดง'], ['off', 'ซ่อน']], c.cam === false ? 'off' : 'on', v => c.cam = v !== 'off'));
    if (c.kind === 'title') { const tx = h('input', { class: 'field', value: c.text || '' }), sb = h('input', { class: 'field', value: c.sub || '', placeholder: 'บรรทัดรอง (ไม่บังคับ)' }); body.append(h('div', { class: 'lbl', style: { marginTop: 0 } }, 'ข้อความ'), tx, sb, h('div', { class: 'lbl' }, 'สีพื้น'), seg([['#1E2A55', 'น้ำเงิน'], ['#0F8A7E', 'เขียว'], ['#2B3040', 'เทาเข้ม'], ['#FFFFFF', 'ขาว']], c.bg || '#1E2A55', v => { c.bg = v; c.fg = v === '#FFFFFF' ? '#1E2A55' : '#fff'; })); body._tx = tx; body._sb = sb; }
    const nm = h('input', { class: 'field', value: c.name || '', placeholder: KIND_TH[c.kind] }); body.append(h('div', { class: 'lbl' }, 'ชื่อคลิป (ใช้เป็นชื่อตอนในสารบัญ)'), nm);
    dialog('ตั้งค่าคลิป', body, [{ label: 'ยกเลิก' }, { label: 'บันทึก', cls: 'prim', flex: 2, action: () => { c.name = nm.value.trim(); if (body._tx) { c.text = body._tx.value; c.sub = body._sb.value; } changed(); } }], { width: 480 });
  };
  // ---- adding clips ----
  const addMenu = () => {
    const tabs = h('div', { class: 'seg' }); const body = h('div', { style: { minHeight: '200px', marginTop: '10px' } });
    const kinds = [['lesson', 'บทเรียน'], ['video', 'วิดีโอในแอป'], ['page', 'หน้าสมุด'], ['device', 'จากเครื่อง'], ['title', 'ชื่อตอน']];
    let cur = 'lesson';
    const paint = async () => {
      for (const b of tabs.children) b.classList.toggle('on', b.dataset.k === cur);
      body.innerHTML = '';
      const recs = (await db.getAll('recs')).filter(r => r.done && !r.hidden).sort((a, b) => b.created - a.created);
      const nbs = new Map((await db.getAll('notebooks')).map(n => [n.id, n]));
      const item = (title, sub, fn) => { const b = h('button', { class: 'mvitem' }, h('span', {}, title), h('span', { class: 'n' }, sub)); b.onclick = fn; return b; };
      if (cur === 'lesson') { const l = recs.filter(r => r.kind === 'audio' && r.lesson); if (!l.length) body.append(h('div', { class: 'sub' }, 'ยังไม่มีบทเรียนที่อัด')); for (const r of l) body.append(item(r.name, `${nbs.get(r.nb)?.name || ''} · ${fmtTime(r.duration || 0)}`, async () => { d.close(); await withBusy(() => addRecClip(pr, r)); changed(); })); }
      else if (cur === 'video') { const l = recs.filter(r => r.kind === 'video'); if (!l.length) body.append(h('div', { class: 'sub' }, 'ยังไม่มีวิดีโอในแอป (ส่งออกบทเรียนเป็นวิดีโอ หรือเพิ่มจากเครื่อง)')); for (const r of l) body.append(item(r.name, `${fmtTime(r.duration || 0)} · ${fmtBytes(r.size)}`, async () => { d.close(); await withBusy(() => addRecClip(pr, r)); changed(); })); }
      else if (cur === 'page') { const list = [...nbs.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 30); for (const n of list) body.append(item(n.name, `${n.pages?.length || 0} หน้า`, () => pickPage(n))); }
      else if (cur === 'device') { body.append(h('p', { class: 'sub' }, 'วิดีโอ MP4/MOV หรือรูปจากแอปไฟล์/รูปภาพ · วิดีโอจะถูกคัดลอกเก็บในแอป'), h('button', { class: 'pill prim', onclick: async () => { const f = await pickFile('video/*,image/*'); if (!f) return; d.close(); await withBusy(() => addDeviceFile(pr, f)); changed(); } }, icon('folder'), 'เลือกไฟล์…')); }
      else if (cur === 'title') { const tx = h('input', { class: 'field', placeholder: 'เช่น ตอนที่ 1 นิยาม' }); body.append(tx, h('button', { class: 'pill prim', style: { marginTop: '10px' }, onclick: () => { if (!tx.value.trim()) return; pr.clips.push({ id: uid(), kind: 'title', text: tx.value.trim(), name: tx.value.trim(), hold: 3500, bg: '#1E2A55', fg: '#fff' }); d.close(); changed(); } }, icon('plus'), 'เพิ่มหน้าชื่อตอน')); setTimeout(() => tx.focus(), 50); }
    };
    for (const [k, l] of kinds) { const b = h('button', { 'data-k': k }, l); b.onclick = () => { cur = k; paint(); }; tabs.append(b); }
    const pickPage = async (n) => {
      body.innerHTML = ''; const pages = await db.pagesOf(n.id); const map = new Map(pages.map(p => [p.id, p]));
      const grid = h('div', { class: 'cp-pages', style: { flexWrap: 'wrap' } });
      (n.pages || []).forEach((pid, i) => { const p = map.get(pid); if (!p) return; const c = h('canvas', { class: 'cp-th' }); const it = h('button', { class: 'cp-page' }, c, h('span', { class: 'no' }, String(i + 1))); it.onclick = () => { pr.clips.push({ id: uid(), kind: 'page', src: { nb: n.id, pid }, name: `${n.name} หน้า ${i + 1}`, hold: HOLD }); d.close(); changed(); }; grid.append(it); requestAnimationFrame(() => { try { renderPageTo(c, p, n.paper || 'cream', 110); } catch { } }); });
      body.append(h('div', { class: 'sub' }, 'แตะหน้าที่ต้องการ (แสดงเป็นภาพนิ่ง)'), grid);
    };
    const d = dialog('เพิ่มคลิป', h('div', {}, tabs, body), [{ label: 'ปิด' }], { width: 600 });
    paint();
  };
  const withBusy = async (fn) => { const bz = busy('กำลังเตรียมคลิป…'); try { await fn(); } catch (e) { toast('เพิ่มคลิปไม่สำเร็จ: ' + (e.message || e), 4000, 'warn'); } finally { bz.done(); } };
  // ---- dead air ----
  quietBtn.onclick = async () => {
    const target = sel && (sel.kind === 'lesson' || sel.kind === 'video') ? [sel] : pr.clips.filter(c => c.kind === 'lesson' || c.kind === 'video');
    if (!target.length) { toast('ไม่มีคลิปเสียงให้วิเคราะห์', 2000); return; }
    let minLen = prefs.cutMin || 8000, level = prefs.cutLevel || 'mid';
    const opts = h('div', {}, h('div', { class: 'lbl', style: { marginTop: 0 } }, 'ถือว่า "เงียบ" เมื่อไม่มีเสียงพูดและไม่มีการเขียนนานกว่า'), seg([['5000', '5 วิ'], ['8000', '8 วิ'], ['15000', '15 วิ'], ['30000', '30 วิ']], String(minLen), v => minLen = +v), h('div', { class: 'lbl' }, 'ความไว'), seg([['low', 'น้อย'], ['mid', 'กลาง'], ['high', 'มาก']], level, v => level = v), h('p', { class: 'sub' }, `จะวิเคราะห์ ${target.length} คลิป · ช่วงที่ครูเขียนเงียบ ๆ ไม่ถูกตัด · เหลือช่องว่าง 0.5 วิระหว่างประโยค`));
    const go = await new Promise(r => dialog('ตัดช่วงเงียบ / dead air', opts, [{ label: 'ยกเลิก' }, { label: 'วิเคราะห์', cls: 'prim', flex: 2, action: () => r(true) }], { width: 480, onClose: () => r(false) }));
    if (!go) return;
    prefs.cutMin = minLen; prefs.cutLevel = level; savePrefs();
    const bz = busy('กำลังวิเคราะห์เสียงและลายมือ…'); const found = [];
    try { for (const c of target) { const s = eng.src(c); if (!s.ready) await s.load(); const r = await findDeadAir(s, { minLen, level }); const inRange = r.ranges.filter(x => x.b > (c.in || 0) && x.a < c.out).map(x => ({ ...x, a: Math.max(x.a, c.in || 0), b: Math.min(x.b, c.out), keep: true })); found.push({ c, s, ranges: inRange, stats: r.stats, noAudio: r.noAudio }); } } finally { bz.done(); }
    const total = found.reduce((a, f) => a + f.ranges.reduce((x, y) => x + (y.b - y.a), 0), 0), count = found.reduce((a, f) => a + f.ranges.length, 0);
    if (!count) { toast(found.some(f => f.noAudio) ? 'ถอดเสียงของคลิปนี้ไม่ได้ในเบราว์เซอร์นี้' : 'ไม่พบช่วงเงียบตามเกณฑ์นี้', 3000); return; }
    const list = h('div', { class: 'reclist' });
    for (const f of found) for (const r of f.ranges) {
      const cb = h('input', { type: 'checkbox', checked: true }); cb.onchange = () => { r.keep = cb.checked; };
      const pv = h('button', { class: 'chip' }, icon('play'), 'ฟัง'); pv.onclick = () => { const i = pr.clips.indexOf(f.c); seekTo(startOf(i) + (r.a - (f.c.in || 0)) / (f.c.speed || 1)); go2(); };
      list.append(h('div', { class: 'item' }, h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', flex: 1 } }, cb, h('div', { class: 'meta' }, h('b', {}, `${f.c.name || KIND_TH[f.c.kind]} · ${fmtTime(r.a)} → ${fmtTime(r.b)}`), h('div', {}, `เงียบ ${fmtTime(r.b - r.a)}`))), pv));
    }
    const st = found[0]?.stats; const sum = st ? `พูด ${Math.round(st.talk / st.total * 100)}% · เขียนเงียบ ๆ ${Math.round(Math.max(0, st.ink - st.talk) / st.total * 100)}% · dead air ${Math.round(st.dead / st.total * 100)}%` : '';
    const go2 = () => { playing = true; lastWall = 0; play.replaceChildren(icon('pause')); };
    dialog('พบช่วงเงียบ', h('div', {}, h('div', { class: 'hc-head warn' }, `พบ ${count} ช่วง รวม ${fmtTime(total)} · ตัดแล้วเหลือ ${fmtTime(dur() - total)}`), h('p', { class: 'sub' }, sum + ' · เอาเครื่องหมายถูกออกเพื่อเก็บช่วงนั้นไว้'), list),
      [{ label: 'ยกเลิก' }, { label: 'ตัดออกทั้งหมดที่เลือก', cls: 'prim', flex: 2, action: () => { for (const f of found) { const rs = f.ranges.filter(r => r.keep); if (rs.length) applyCuts(pr, f.c, rs); } sel = null; stop(); changed(); toast('ตัดช่วงเงียบแล้ว', 2000); } }], { width: 640 });
  };
  // ---- chapters ----
  chapBtn.onclick = () => {
    const lines = []; let acc = 0;
    for (const c of pr.clips) { if (c.kind === 'title' || c.name) lines.push(`${fmtTime(acc).padStart(5, '0').replace(/^0(\d:)/, '$1')} ${c.text || c.name}`); acc += clipDur(c); }
    const txt = lines.length ? lines.map(l => l.replace(/^(\d+):(\d\d)/, (m, a, b) => `${String(a).padStart(2, '0')}:${b}`)).join('\n') : '';
    const ta = h('textarea', { class: 'field', rows: 8, style: { width: '100%' } }, txt || 'ยังไม่มีตอน · ตั้งชื่อคลิป (ตั้งค่า > ชื่อคลิป) หรือเพิ่ม "ชื่อตอน" แล้วสารบัญจะสร้างให้');
    dialog('สารบัญตอน (วางในคำอธิบาย YouTube)', h('div', {}, h('p', { class: 'sub', style: { marginTop: 0 } }, 'YouTube จะทำเป็นปุ่มข้ามตอนให้เองเมื่อวางรายการเวลานี้ในคำอธิบาย'), ta), [{ label: 'คัดลอก', action: () => { navigator.clipboard?.writeText(ta.value).then(() => toast('คัดลอกแล้ว', 1500)).catch(() => { }); return false; } }, { label: 'ปิด', cls: 'prim' }], { width: 520 });
  };
  // ---- export ----
  expBtn.onclick = async () => {
    if (!pr.clips.length) { toast('ยังไม่มีคลิป', 1500); return; }
    stop();
    let res = pr.res || '1920', split = false;
    const body = h('div', {}, h('p', { style: { marginTop: 0 } }, `ความยาว ${fmtTime(dur())} · ใช้เวลาแปลงเท่าความยาวจริง · เปิดแอปค้างไว้ (ตั้งคิวได้หลายงาน)`),
      h('div', { class: 'lbl' }, 'ความละเอียด'), seg([['1280', '720p'], ['1920', '1080p'], ['2560', '1440p'], ['3840', '4K']], res, v => res = v),
      h('div', { class: 'lbl' }, 'เฟดดำระหว่างคลิป'), seg([['1', 'เปิด'], ['0', 'ปิด']], pr.fade ? '1' : '0', v => pr.fade = v === '1'),
      h('p', { class: 'sub' }, 'ไฟล์จะอยู่ใน "คลิปที่อัดไว้" พร้อมลายน้ำผู้พัฒนา · 1080p ≈ 30 MB/นาที · 4K ≈ 90 MB/นาที'));
    const ok = await new Promise(r => dialog('ส่งออกวิดีโอ', body, [{ label: 'ยกเลิก' }, { label: 'เพิ่มในคิวส่งออก', cls: 'prim', flex: 2, action: () => r(true) }], { width: 520, onClose: () => r(false) }));
    if (!ok) return;
    pr.res = res; save();
    const { enqueue } = await import('./exportq.js');
    enqueue({ id: uid(), name: pr.name, project: JSON.parse(JSON.stringify(pr)), res: +res, dur: dur() });
    toast('เพิ่มในคิวส่งออกแล้ว · ดูความคืบหน้าที่มุมขวาล่าง', 3000);
  };
  addBtn.onclick = addMenu;
  const shut = () => { ro?.disconnect(); cancelAnimationFrame(raf); stop(); eng.dispose(); removeEventListener('resize', size); save(); root.remove(); };
  close.onclick = async () => {
    if (hi > 0 && !(await confirmBox('ปิดหน้าตัดต่อ?', 'งานที่แก้บันทึกไว้ให้แล้ว เปิดทำต่อได้ที่ คลังวิดีโอ > โปรเจกต์ตัดต่อ', { ok: 'ปิด' }))) return;
    shut();
  };
  paintStrip(); paintTools(); syncUndo(); raf = requestAnimationFrame(frame);
  return pr;
}

// ---------- helpers to add clips ----------
export async function addRecClip(pr, r) {
  if (r.kind === 'audio' && r.lesson) { const c = { id: uid(), kind: 'lesson', src: r.id, name: r.name, in: 0, out: r.duration || 0, dur: r.duration || 0, speed: 1 }; const s = new LessonSrc(c); await s.load(); c.dur = s.dur; c.out = s.dur; s.dispose(); pr.clips.push(c); }
  else if (r.kind === 'video') { const c = { id: uid(), kind: 'video', src: r.id, name: r.name, in: 0, out: r.duration || 0, dur: r.duration || 0, speed: 1 }; const s = new VideoSrc(c); await s.load(); s.dispose(); pr.clips.push(c); }
  else throw new Error('ชนิดนี้ใช้เป็นคลิปไม่ได้');
}
export async function addDeviceFile(pr, f) {
  if (f.type.startsWith('image/')) { const id = uid(); await db.putQuiet('kv', { k: 'cutimg:' + id, v: f }); pr.clips.push({ id: uid(), kind: 'image', src: id, name: f.name.replace(/\.[^.]+$/, ''), hold: HOLD }); return; }
  if (!f.type.startsWith('video/')) throw new Error('ต้องเป็นวิดีโอหรือรูป');
  const id = uid();
  const meta = { id, kind: 'video', name: f.name.replace(/\.[^.]+$/, ''), created: Date.now(), size: f.size, mime: f.type, done: true, imported: true, local: true };
  await db.addChunk(id, 0, f); await db.put('recs', meta);
  await addRecClip(pr, meta);
}

// ---------- project list ----------
export async function openProjects(app) {
  const list = h('div', { class: 'reclist' });
  const paint = async () => {
    list.innerHTML = '';
    const prs = await listProjects();
    if (!prs.length) list.append(h('p', { class: 'sub', style: { textAlign: 'center', padding: '24px 0' } }, 'ยังไม่มีโปรเจกต์ · กด "สร้างใหม่" หรือกดปุ่มกรรไกรที่บทเรียนในรายการคลิป'));
    for (const p of prs) {
      const open = h('button', { class: 'pill prim', style: { height: '38px' } }, icon('scissors'), 'เปิด'); open.onclick = () => { d.close(); openCutEditor(app, { projectId: p.id }); };
      const del = h('button', { class: 'btn sq', title: 'ลบโปรเจกต์ (ไม่ลบคลิปต้นฉบับ)' }, icon('trash')); del.onclick = async () => { if (await confirmBox('ลบโปรเจกต์นี้?', 'คลิปต้นฉบับยังอยู่ครบ', { ok: 'ลบ', danger: true })) { await deleteProject(p.id); paint(); } };
      list.append(h('div', { class: 'item' }, icon('film'), h('div', { class: 'meta' }, h('b', {}, p.name), h('div', {}, `${p.clips.length} คลิป · ${fmtTime(totalDur(p))} · แก้ล่าสุด ${new Date(p.updated || p.created).toLocaleDateString('th-TH')}`)), open, del));
    }
  };
  const neu = h('button', { class: 'pill prim', style: { height: '40px' } }, icon('plus'), 'สร้างใหม่'); neu.onclick = () => { d.close(); openCutEditor(app); };
  const d = dialog('โปรเจกต์ตัดต่อ', h('div', {}, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' } }, neu, h('span', { class: 'sub' }, 'บันทึกให้เองตลอด · ตัดต่อไม่ทำลายต้นฉบับ')), list), [], { width: 640 });
  paint();
}
