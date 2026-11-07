// Export queue: renders edited projects to MP4 one after another while the app stays open.
// Progress shows as a small pill in the corner; finished files land in "คลิปที่อัดไว้" with the credit line.
import { h, icon, toast, fmtTime, fmtBytes, uid, dialog } from './ui.js';
import * as db from './db.js';

const Q = []; let running = null, pill = null, wake = null, cancelFlag = false;
export const queueState = () => ({ running, pending: Q.slice() });

export function enqueue(job) { Q.push(job); paint(); if (!running) next(); }
async function next() {
  running = Q.shift() || null; paint(); if (!running) { release(); return; }
  cancelFlag = false;
  try { await hold(); await render(running); } catch (e) { console.warn('export', e); toast('ส่งออก "' + running.name + '" ไม่สำเร็จ: ' + (e.message || e), 5000, 'warn'); running.onError?.(e); }
  next();
}
async function hold() { try { if (!wake && navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch { } }
function release() { try { wake?.release(); } catch { } wake = null; }
function paint() {
  if (!running && !Q.length) { pill?.remove(); pill = null; return; }
  if (!pill) { pill = h('button', { class: 'xq-pill', 'data-nomirror': '1' }, icon('film'), h('span', { class: 'xq-txt' })); pill.onclick = showQueue; document.body.append(pill); }
  pill.querySelector('.xq-txt').textContent = (running ? `กำลังส่งออก ${running.pct != null ? Math.round(running.pct * 100) + '%' : ''}` : '') + (Q.length ? ` · รออีก ${Q.length}` : '');
}
function showQueue() {
  const list = h('div', { class: 'reclist' });
  const row = (j, cur) => h('div', { class: 'item' }, h('div', { class: 'meta' }, h('b', {}, j.name), h('div', {}, cur ? `กำลังแปลง ${fmtTime(j.at || 0)} / ${fmtTime(j.dur)} · ${j.res >= 3840 ? '4K' : j.res >= 2560 ? '1440p' : j.res >= 1920 ? '1080p' : '720p'}` : `รอคิว · ${fmtTime(j.dur)}`)), (() => { const b = h('button', { class: 'chip' }, 'ยกเลิก'); b.onclick = () => { if (cur) cancelFlag = true; else { const i = Q.indexOf(j); if (i >= 0) Q.splice(i, 1); } d.close(); paint(); }; return b; })());
  if (running) list.append(row(running, true)); for (const j of Q) list.append(row(j, false));
  const d = dialog('คิวส่งออกวิดีโอ', h('div', {}, h('p', { class: 'sub', style: { marginTop: 0 } }, 'เปิดแอปค้างไว้ระหว่างแปลง · ไฟล์เสร็จแล้วจะอยู่ใน "คลิปที่อัดไว้"'), list), [{ label: 'ปิด', cls: 'prim' }], { width: 520 });
}

async function render(job) {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) throw new Error('เบราว์เซอร์นี้ส่งออกวิดีโอไม่ได้');
  const { Engine } = await import('./cut.js');
  const { pickMime, showRecording, creditImage, drawCredit, scheduleBackgroundUpload } = await import('./recorder.js');
  const W = job.res, H = Math.round(W * 9 / 16), pr = job.project;
  const eng = new Engine(pr); await eng.loadAll();
  const cv = h('canvas', { width: W, height: H, style: { position: 'fixed', left: '-9999px', top: 0 } }); document.body.append(cv);
  const ctx = cv.getContext('2d', { alpha: false });
  const stream = cv.captureStream(30);
  // mix every media element of every clip into one audio track
  const ac = new (window.AudioContext || window.webkitAudioContext)(); const dest = ac.createMediaStreamDestination();
  for (const s of eng.srcs.values()) for (const el of s.audioEls()) { try { ac.createMediaElementSource(el).connect(dest); } catch (e) { console.warn('audio', e); } }
  for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  await ac.resume();
  const credit = creditImage(H);
  const mime = pickMime(); let mr; try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: W >= 3840 ? 24e6 : W >= 2560 ? 12e6 : W >= 1920 ? 8e6 : 4e6 } : undefined); } catch { mr = new MediaRecorder(stream); }
  const chunks = []; mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const dur = job.dur; mr.start(1000);
  const t0 = performance.now(); let t = 0, lastWall = t0;
  await new Promise(res => {
    const tick = (now) => {
      const ck = eng.clockT(); t = ck != null ? ck : t + (now - lastWall); lastWall = now;
      eng.sync(t); eng.draw(ctx, W, H, t); drawCredit(ctx, W, H, credit);
      job.at = t; job.pct = t / dur; if (now - (job.painted || 0) > 500) { job.painted = now; paint(); }
      if (t >= dur + 200 || cancelFlag) return res(); requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  });
  const stopped = new Promise(r => { mr.onstop = r; setTimeout(r, 3000); }); mr.stop(); await stopped;
  eng.pauseAll(); eng.dispose(); try { ac.close(); } catch { } cv.remove();
  if (cancelFlag) { toast('ยกเลิกการส่งออกแล้ว', 1500); job.onCancel?.(); return; }
  let blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
  if (blob.type.includes('mp4')) { try { const { defragMp4 } = await import('./mp4fix.js'); const fixed = await defragMp4(blob); if (fixed) blob = new Blob([fixed], { type: blob.type }); } catch { } }
  const nb = pr.clips.find(c => c.kind === 'page')?.src?.nb || (await (async () => { const c = pr.clips.find(c => c.kind === 'lesson'); if (!c) return null; return (await db.get('recs', c.src))?.nb || null; })());
  const vmeta = { id: uid(), kind: 'video', name: job.name + ' · วิดีโอ', nb, created: Date.now(), duration: dur, size: blob.size, mime: blob.type, res: String(H), done: true, fromProject: pr.id };
  // the title card as the cover picture (library thumbnail + YouTube cover)
  if (job.cover) { try { const { renderCover } = await import('./titlecard.js'); const jpg = await renderCover(job.cover); if (jpg) { await db.putQuiet('kv', { k: 'cover:' + vmeta.id, v: jpg }); vmeta.cover = 1; vmeta.ytCover = 1; } } catch (e) { console.warn('cover', e); } }
  await db.put('recs', vmeta); await db.addChunk(vmeta.id, 0, blob);
  toast(`ส่งออก "${job.name}" เสร็จแล้ว · ${fmtBytes(blob.size)}`, 4000);
  if (job.onDone) { try { job.onDone(vmeta, blob); } catch { } } else if (!Q.length) showRecording(vmeta, true, blob);
  try { scheduleBackgroundUpload(); } catch { }
}
