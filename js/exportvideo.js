// "ทำวิดีโอ": combine a recorded lesson's ink + audio (+ teacher camera at the corner) into one MP4 and save it on the iPad.
// One choice only (resolution). Nothing to cut, nothing to arrange.
import { h, icon, toast, dialog, fmtTime, fmtBytes, uid, seg, downloadBlob } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import * as db from './db.js';

const RES = [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']];
const W_OF = { 720: 1280, 1080: 1920, 1440: 2560, 2160: 3840 };
const MBPS = { 720: 4, 1080: 8, 1440: 12, 2160: 24 };

export async function makeVideo(app, rec) {
  const { addRecClip } = await import('./cut.js');
  const Q = await import('./exportq.js');
  const R = await import('./recorder.js');
  const x = prefs.xv || (prefs.xv = {}); if (!x.res) x.res = '1080';
  const dur = rec.duration || 0;
  const body = h('div', {});
  const estEl = h('p', { class: 'sub', style: { margin: '10px 0 0' } });
  const est = () => {
    const mb = MBPS[x.res] * dur / 1000 / 8, mins = Math.max(1, Math.ceil(dur / 60000 * ({ 720: 0.3, 1080: 0.4, 1440: 0.7, 2160: 1.2 })[x.res]));
    estEl.textContent = `${fmtTime(dur)} · ไฟล์ราว ${fmtBytes(mb * 1e6)} · ใช้เวลาราว ${mins} นาที · เปิดแอปค้างไว้จนเสร็จ`;
  };
  body.append(h('div', { class: 'lbl' }, 'ความละเอียด'), seg(RES, x.res, v => { x.res = v; savePrefs(); est(); }), estEl);
  if (rec.cam) body.append(h('p', { class: 'sub', style: { margin: '6px 0 0' } }, 'มีภาพกล้องครู · จะอยู่ที่มุมวิดีโอ'));
  est();
  let prepared = null;
  dialog('ทำวิดีโอ', body, [{ label: 'ยกเลิก', action: () => { prepared?.eng?.dispose?.(); } }, {
    label: 'เตรียม', cls: 'prim', icon: 'film', action: async (B) => {
      if (!prepared) {
        try {
          B.disabled = true; B.textContent = 'กำลังเตรียม…';
          if (rec.drive && !rec.localCopy) { estEl.textContent = 'กำลังดึงไฟล์จาก Google Drive มาไว้ในเครื่องก่อน (ครั้งเดียว)…'; if (!await R.pullBack(rec)) throw new Error('ดึงไฟล์จาก Drive ไม่สำเร็จ'); }
          const pr = { id: 'xv-' + rec.id, name: rec.name, clips: [], updated: Date.now() };
          await addRecClip(pr, rec); pr.clips[0].cam = !!rec.cam;
          estEl.textContent = 'กำลังโหลดเสียงและภาพกล้อง…';
          const { Engine } = await import('./cut.js');
          const eng = new Engine(pr); await eng.loadAll((i, n) => { estEl.textContent = `กำลังโหลดสื่อ ${i}/${n}…`; });
          prepared = { pr, eng, d: pr.clips[0].dur || dur };
          estEl.textContent = `พร้อมแล้ว · กด "เริ่ม" แล้วเปิดแอปค้างไว้จนเสร็จ`;
          B.disabled = false; B.textContent = ''; B.append(icon('play'), ' เริ่ม');
        } catch (e) { estEl.textContent = 'เตรียมไม่สำเร็จ: ' + (e.message || e); B.disabled = false; B.textContent = 'ลองอีกครั้ง'; }
        return false;
      }
      // first play() of each media element must happen inside a tap on iPad
      try { for (const s of prepared.eng.srcs.values()) for (const el of [s.audio, s.cam, s.v]) if (el) { const p0 = el.play(); if (p0?.then) p0.then(() => el.pause()).catch(() => { }); else el.pause(); } } catch { }
      const { pr, eng, d } = prepared, res = x.res;
      Q.enqueue({ id: uid(), name: rec.name, project: pr, engine: eng, res: W_OF[res], dur: d, onDone: async (vmeta, blob) => {
        vmeta.name = rec.name + ' · ' + (res === '2160' ? '4K' : res + 'p'); vmeta.forEdit = 1; await db.put('recs', vmeta);
        doneDialog(vmeta, blob);
      } });
      toast('เริ่มทำวิดีโอแล้ว · ดูความคืบหน้าที่ป้ายมุมจอ · อย่าสลับแอปจนกว่าจะเสร็จ', 3500);
      return true;
    }
  }], { width: 520 });
}

// when the video is ready: one big button to put it in the Photos app
export async function doneDialog(vmeta, blob) {
  const R = await import('./recorder.js');
  const body = h('div', {},
    h('p', { style: { margin: '4px 0 10px', fontSize: '20px' } }, `${vmeta.name}`),
    h('p', { class: 'sub', style: { margin: 0 } }, `${fmtTime(vmeta.duration || 0)} · ${fmtBytes(vmeta.size || blob?.size || 0)} · อยู่ในคลังวิดีโอ แท็บ "วิดีโอ" กดบันทึกซ้ำได้ทุกเมื่อ`));
  dialog('วิดีโอเสร็จแล้ว', body, [
    { label: 'บันทึกลงไฟล์', icon: 'download', action: () => { R.saveRecording(vmeta); return false; } },
    { label: 'บันทึกลงแอปรูปภาพ', icon: 'share', cls: 'prim', flex: 2, action: () => { saveToPhotos(vmeta, blob); return false; } },
  ], { width: 520 });
}

export async function saveToPhotos(vmeta, blob) {
  const R = await import('./recorder.js');
  if (!blob) { const { busy } = await import('./ui.js'); const bz = busy('กำลังเตรียมไฟล์…'); try { blob = await R.recBlob(vmeta); } finally { bz.done(); } }
  const f = new File([blob], R.fileName(vmeta), { type: blob.type || 'video/mp4' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    const { shareFileDialog } = await import('./ui.js');
    await shareFileDialog(f, { title: 'บันทึกลงแอปรูปภาพ', sub: 'ในแผ่นแชร์ที่เด้งขึ้น เลื่อนหา "บันทึกวิดีโอ" (Save Video) · หรือเลือก AirDrop / LINE ได้จากที่เดียวกัน', label: 'เปิดแผ่นแชร์ (' + fmtBytes(blob.size) + ')' });
  } else { downloadBlob(blob, f.name); toast('เครื่องนี้ไม่มีแผ่นแชร์ จึงดาวน์โหลดไฟล์แทน', 3000); }
}
