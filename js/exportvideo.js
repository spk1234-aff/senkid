// One-tap export of a recorded lesson to a full-length MP4, meant for editing elsewhere (iMovie, CapCut…).
// No timeline, no cuts: the whole lesson, ink + audio (+ the teacher camera at the corner, or as a separate file).
import { h, icon, toast, dialog, fmtTime, fmtBytes, uid, seg } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import * as db from './db.js';

export async function openExportVideo(app, rec) {
  const { addRecClip } = await import('./cut.js');
  const Q = await import('./exportq.js');
  let cam = null; if (rec.cam) { try { cam = await db.get('recs', rec.cam); } catch { } }
  const x = prefs.xv || (prefs.xv = { res: '2160', cam: 'pip' });
  const body = h('div', {});
  body.append(h('div', { class: 'lbl' }, 'ความละเอียด'),
    seg([['2160', '4K (คมสุด · ช้ากว่า 3–4 เท่า)'], ['1080', '1080p (เร็ว)']], x.res, v => { x.res = v; savePrefs(); est(); }));
  if (cam) body.append(h('div', { class: 'lbl', style: { marginTop: '10px' } }, 'หน้าครู'),
    seg([['pip', 'ใส่ที่มุมวิดีโอ'], ['none', 'ไม่ใส่'], ['sep', 'แยกเป็นอีกไฟล์']], x.cam, v => { x.cam = v; savePrefs(); est(); }),
    h('p', { class: 'sub', style: { margin: '6px 0 0' } }, 'แยกไฟล์: ได้วิดีโอกระดาน 1 ไฟล์ + ไฟล์กล้อง 1 ไฟล์ ไปจัดวางเองในแอปตัดต่อ'));
  const estEl = h('p', { class: 'sub', style: { marginTop: '12px' } }); body.append(estEl);
  const dur = rec.duration || 0;
  const est = () => {
    const k = x.res === '2160' ? 24e6 : 8e6, mb = k * dur / 1000 / 8 / 1e6, mins = Math.ceil(dur / 60000 * (x.res === '2160' ? 1.2 : 0.4));
    estEl.textContent = `ความยาว ${fmtTime(dur)} · ไฟล์ราว ${fmtBytes(mb * 1e6)} · ใช้เวลาราว ${mins} นาที · ต้องเปิดแอปค้างไว้จนเสร็จ หน้าจอจะไม่ดับเอง`;
  };
  est();
  // step 1 (tap): make sure the files are on this device, then pre-load the media
  // step 2 (tap): start — the media elements get their first play() inside this tap, which iPad requires
  let prepared = null;
  dialog('ส่งออกวิดีโอสำหรับตัดต่อ', body, [{ label: 'ยกเลิก', action: () => { prepared?.eng?.dispose?.(); } }, {
    label: 'เตรียมไฟล์', cls: 'prim', icon: 'film', keep: true, action: async (B) => {
      if (!prepared) {
        try {
          if (B) { B.disabled = true; B.textContent = 'กำลังเตรียม…'; }
          const R = await import('./recorder.js');
          if (rec.drive && !rec.localCopy) { estEl.textContent = 'กำลังดึงไฟล์จาก Google Drive มาเก็บในเครื่องก่อน (ทำครั้งเดียว)…'; const ok = await R.pullBack(rec); if (!ok) throw new Error('ดึงไฟล์จาก Drive ไม่สำเร็จ'); }
          const pr = { id: 'xv-' + rec.id, name: rec.name, clips: [], updated: Date.now() };
          await addRecClip(pr, rec);
          pr.clips[0].cam = !!(cam && x.cam === 'pip');
          estEl.textContent = 'กำลังโหลดเสียงและภาพกล้อง…';
          const { Engine } = await import('./cut.js');
          const eng = new Engine(pr); await eng.loadAll((i, n) => { estEl.textContent = `กำลังโหลดสื่อ ${i}/${n}…`; });
          prepared = { pr, eng, d: pr.clips[0].dur || dur };
          estEl.textContent = `พร้อมแล้ว · ${fmtTime(prepared.d)} · กด "เริ่มแปลงเลย" แล้วเปิดแอปค้างไว้จนเสร็จ`;
          if (B) { B.disabled = false; B.textContent = ''; B.append(icon('film'), ' เริ่มแปลงเลย'); }
        } catch (e) { estEl.textContent = 'เตรียมไฟล์ไม่สำเร็จ: ' + (e.message || e); if (B) { B.disabled = false; B.textContent = 'ลองอีกครั้ง'; } }
        return false;
      }
      // unlock every media element inside this user gesture (iPad refuses a programmatic first play())
      try { for (const s of prepared.eng.srcs.values()) for (const el of [s.audio, s.cam, s.v]) if (el) { const pr0 = el.play(); if (pr0?.then) pr0.then(() => el.pause()).catch(() => { }); else el.pause(); } } catch { }
      const { pr, eng, d: dd } = prepared;
      Q.enqueue({ id: uid(), name: rec.name, project: pr, engine: eng, res: +x.res === 2160 ? 3840 : 1920, dur: dd, onDone: async (vmeta, blob) => {
        vmeta.name = rec.name + (x.res === '2160' ? ' · 4K' : ' · 1080p'); vmeta.forEdit = 1; await db.put('recs', vmeta);
        if (cam && x.cam === 'sep') {
          try { const R = await import('./recorder.js'); const cb = await R.recBlob(cam); const cm = { id: uid(), kind: 'video', name: rec.name + ' · กล้องครู', nb: rec.nb, created: Date.now(), duration: cam.duration || dd, size: cb.size, mime: cb.type || 'video/mp4', res: String(prefs.rec.camRes || 480), done: true, forEdit: 1 }; await db.put('recs', cm); await db.addChunk(cm.id, 0, cb); } catch (e) { toast('แยกไฟล์กล้องไม่สำเร็จ: ' + (e.message || e), 4000, 'warn'); }
        }
        toast(`ส่งออก "${rec.name}" เสร็จแล้ว · อยู่ในคลังวิดีโอ แท็บ "วิดีโอที่ส่งออก" · กดบันทึกไฟล์เพื่อนำไปตัดต่อ`, 6000);
      } });
      toast('เริ่มแปลงแล้ว · ดูความคืบหน้าที่ป้ายมุมจอ · อย่าสลับแอปจนกว่าจะเสร็จ', 3500);
      return true;
    }
  }], { width: 560 });
}
