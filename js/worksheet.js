// Worksheets by QR code: the teacher puts a PDF on Drive (shared by link) and shows a QR; a student scans it and the
// worksheet opens in เส้นคิด on their own device as a new notebook — no file sent by chat, no sign-in for students.
import { h, icon, toast, dialog, busy, pickFile, fmtBytes, confirmBox } from './ui.js';
import { prefs, savePrefs } from './prefs.js';
import * as db from './db.js';
import { driveShareFile, hasFileScope, connected, driveApiKey } from './sync.js';

const APP_URL = () => new URL('./', location.href).href;
export const worksheetLink = (id, name) => `${APP_URL()}#ws=${encodeURIComponent(id)}&n=${encodeURIComponent(name)}`;

async function qrDataUrl(text, size = 640) {
  const QR = (await import('../vendor/qrcode.esm.js')).default;
  return QR.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1E2A55', light: '#FFFFFF' } });
}

// ---------- teacher ----------
export async function shareWorksheet(app, anchor) {
  const ed = app.editor;
  if (!connected() || !hasFileScope()) { toast('ต้องเชื่อมต่อ Google Drive ก่อน (ตั้งค่า > ซิงก์ผ่าน Google Drive)', 3500, 'warn'); return; }
  const pdfIds = ed ? [...new Set(ed.pages.filter(p => p.pdf?.id).map(p => p.pdf.id))] : [];
  const pdfs = []; for (const id of pdfIds) { const r = await db.get('pdfs', id); if (r) pdfs.push(r); }
  const list = (prefs.worksheets ||= []);
  const body = h('div', { style: { fontSize: '20px' } });
  const sec = (t) => h('div', { class: 'lbl' }, t);
  const choose = h('div', {});
  for (const r of pdfs) { const b = h('button', { class: 'pill sec', style: { width: '100%', justifyContent: 'flex-start', marginBottom: '6px' } }, icon('pdf'), `${r.name} · ${r.pages || '?'} หน้า · ${fmtBytes(r.blob.size)}`); b.onclick = () => { dg.close(); publish(app, r.blob, r.name.replace(/\.pdf$/i, '')); }; choose.append(b); }
  const pick = h('button', { class: 'pill sec', style: { width: '100%', justifyContent: 'flex-start' } }, icon('folder'), 'เลือกไฟล์ PDF จากเครื่อง…');
  pick.onclick = async () => { const f = await pickFile('application/pdf'); if (!f) return; dg.close(); publish(app, f, f.name.replace(/\.pdf$/i, '')); };
  body.append(sec('ใบงานที่จะแชร์'), choose, pick);
  if (list.length) {
    body.append(sec('ใบงานที่เคยแชร์'));
    for (const w of list.slice().reverse().slice(0, 8)) { const row = h('div', { class: 'row' }, h('div', { style: { flex: 1, minWidth: 0 } }, h('b', {}, w.name), h('div', { class: 'sub' }, new Date(w.t).toLocaleDateString('th-TH'))), h('button', { class: 'pill sec', style: { height: '38px' } }, 'แสดง QR')); row.lastChild.onclick = () => { dg.close(); showQr(app, w); }; body.append(row); }
  }
  const dg = dialog('แชร์ใบงานด้วย QR', body, [{ label: 'ปิด' }], { width: 560 });
}
async function publish(app, blob, name) {
  const bz = busy('กำลังส่งใบงานขึ้น Drive…', name + ' · ' + fmtBytes(blob.size), 0);
  try {
    const id = await driveShareFile(blob, name + '.pdf', 'ใบงาน', (t, p) => bz.set('กำลังส่งใบงานขึ้น Drive…', t, p));
    const w = { id, name, t: Date.now() };
    (prefs.worksheets ||= []).push(w); if (prefs.worksheets.length > 40) prefs.worksheets.splice(0, prefs.worksheets.length - 40); savePrefs();
    bz.done(); showQr(app, w);
  } catch (e) { bz.done(); console.warn(e); toast('ส่งใบงานไม่สำเร็จ: ' + (e.auth ? 'ต้องเชื่อมต่อ Google ใหม่' : e.message), 4000, 'warn'); }
}
export async function showQr(app, w) {
  const link = worksheetLink(w.id, w.name);
  const url = await qrDataUrl(link);
  const img = h('img', { src: url, style: { width: 'min(360px, 70vw)', height: 'auto', display: 'block', margin: '0 auto', borderRadius: '12px' } });
  const linkEl = h('input', { type: 'text', class: 'field', value: link, readonly: true, style: { width: '100%', fontSize: '17px' } });
  const tv = h('button', { class: 'pill prim', style: { flex: 1 } }, icon('screen'), 'แสดงบนทีวี');
  const cp = h('button', { class: 'pill sec', style: { flex: 1 } }, icon('copy'), 'คัดลอกลิงก์');
  const sh = h('button', { class: 'pill sec', style: { flex: 1 } }, icon('share'), 'แชร์ลิงก์');
  let onTv = false;
  tv.onclick = () => { onTv = !onTv; app.broadcast?.post({ type: 'qr', url: onTv ? url : null, name: w.name, link }); tv.replaceChildren(icon('screen'), onTv ? 'ซ่อนจากทีวี' : 'แสดงบนทีวี'); if (onTv && !app.broadcast?.connected) toast('ยังไม่ได้ต่อหน้าจอนักเรียน/ทีวี', 2000, 'warn'); };
  cp.onclick = async () => { try { await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์แล้ว'); } catch { linkEl.select(); } };
  sh.onclick = async () => { try { await navigator.share({ title: w.name, url: link }); } catch { } };
  const body = h('div', { style: { textAlign: 'center' } }, img, h('p', { style: { margin: '10px 0 4px', fontSize: '22px', fontWeight: 700 } }, w.name), h('p', { class: 'sub', style: { margin: '0 0 10px' } }, 'นักเรียนสแกนด้วยกล้อง iPad แล้วเปิดใน Safari · ใบงานจะเปิดในเส้นคิดเป็นสมุดใหม่'), linkEl, h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, tv, cp, sh));
  dialog('QR ใบงาน', body, [{ label: 'ปิด', cls: 'prim' }], { width: 520, onClose: () => { if (onTv) app.broadcast?.post({ type: 'qr', url: null }); } });
}

// ---------- student: #ws=<id>&n=<name> ----------
export async function handleWorksheetHash(app) {
  const m = /[#&]ws=([^&]+)/.exec(location.hash); if (!m) return false;
  const id = decodeURIComponent(m[1]); const nm = /[#&]n=([^&]+)/.exec(location.hash); const name = nm ? decodeURIComponent(nm[1]) : 'ใบงาน';
  history.replaceState(null, '', location.pathname + location.search);
  const have = (prefs.wsOpened ||= {})[id];
  if (have && await db.get('notebooks', have)) { const again = await confirmBox(`เปิดใบงาน "${name}" อีกครั้ง?`, 'เคยเปิดใบงานนี้แล้ว · เลือก "เปิดเล่มเดิม" เพื่อเขียนต่อ', { ok: 'สร้างเล่มใหม่', cancel: 'เปิดเล่มเดิม' }); if (!again) { await app.openNotebook(have); return true; } }
  const key = driveApiKey(); if (!key) { toast('แอปยังไม่ได้ตั้งค่ากุญแจสำหรับเปิดใบงาน', 3000, 'warn'); return false; }
  const bz = busy('กำลังดาวน์โหลดใบงาน…', name);
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&key=${key}`);
    if (!r.ok) throw new Error(r.status === 404 ? 'ไม่พบไฟล์ (ครูอาจลบหรือยังไม่ได้แชร์)' : 'ดาวน์โหลดไม่ได้ (' + r.status + ')');
    const blob = await r.blob(); bz.done();
    const file = new File([blob], name + '.pdf', { type: 'application/pdf' });
    await app.notebookFromPdf(file);
    if (app.editor) { prefs.wsOpened[id] = app.editor.nb.id; savePrefs(); }
    return true;
  } catch (e) { bz.done(); toast('เปิดใบงานไม่ได้: ' + (e.message || e), 4500, 'warn'); return false; }
}
