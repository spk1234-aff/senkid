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
  dialog('ส่งออกวิดีโอสำหรับตัดต่อ', body, [{ label: 'ยกเลิก' }, {
    label: 'เริ่มส่งออก', cls: 'prim', icon: 'film', action: async () => {
      const pr = { id: 'xv-' + rec.id, name: rec.name, clips: [], updated: Date.now() };
      await addRecClip(pr, rec);
      pr.clips[0].cam = !!(cam && x.cam === 'pip');
      const d = pr.clips[0].dur || dur;
      Q.enqueue({ id: uid(), name: rec.name, project: pr, res: +x.res === 2160 ? 3840 : 1920, dur: d, onDone: async (vmeta, blob) => {
        vmeta.name = rec.name + (x.res === '2160' ? ' · 4K' : ' · 1080p'); vmeta.forEdit = 1; await db.put('recs', vmeta);
        if (cam && x.cam === 'sep') {
          try { const R = await import('./recorder.js'); const cb = await R.recBlob(cam); const cm = { id: uid(), kind: 'video', name: rec.name + ' · กล้องครู', nb: rec.nb, created: Date.now(), duration: cam.duration || d, size: cb.size, mime: cb.type || 'video/mp4', res: String(prefs.rec.camRes || 480), done: true, forEdit: 1 }; await db.put('recs', cm); await db.addChunk(cm.id, 0, cb); } catch (e) { toast('แยกไฟล์กล้องไม่สำเร็จ: ' + (e.message || e), 4000, 'warn'); }
        }
        toast(`ส่งออก "${rec.name}" เสร็จแล้ว · อยู่ในคลังวิดีโอ แท็บ "วิดีโอที่ส่งออก" · กดบันทึกไฟล์เพื่อนำไปตัดต่อ`, 6000);
      } });
      toast('เริ่มส่งออกแล้ว · ดูความคืบหน้าที่ป้ายมุมจอ', 2500);
    }
  }], { width: 560 });
}
