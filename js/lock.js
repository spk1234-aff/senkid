// Teacher lock: a PIN that guards the switch out of student mode, and a "student install" link whose app
// always opens in student mode. Per device (never synced). The PIN is stored only as a salted SHA-256 hash.
import { prefs, savePrefs } from './prefs.js';
import { h, icon, toast, dialog } from './ui.js';
import { TEACHER_ACCOUNTS } from './config.js';

const SALT = 'senkid-lock-v1:';
export async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + String(pin)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const lock = () => prefs.lock || {};
export const hasPin = () => !!lock().h;
export const studentOnly = () => !!lock().studentOnly;
// was teacher mode unlocked on this launch? (a student-install device drops back to student mode on the next launch)
let unlocked = false; // in memory only: any relaunch of the app puts a student-install device back into student mode
export const unlockedNow = () => unlocked;
export function setUnlocked(v) { unlocked = !!v; }

// is this one of the teacher's own devices? (signed in to Drive sync with a teacher account)
export const accountRule = () => TEACHER_ACCOUNTS.length > 0;
export function isTeacherDevice() {
  if (!accountRule()) return true;
  const em = (prefs.sync?.email || '').trim().toLowerCase();
  return !!(prefs.sync?.on && em && TEACHER_ACCOUNTS.map(x => x.toLowerCase()).includes(em));
}
export function enforceAccountRule() {
  if (accountRule() && !isTeacherDevice() && !prefs.studentUI) { prefs.studentUI = true; savePrefs(); return true; }
  return false;
}
// after a Google sign-in: a teacher account unlocks teacher mode on this device right away
export function afterSignIn(app) {
  if (!accountRule()) return;
  if (isTeacherDevice()) { if (prefs.studentUI && !studentOnly()) { prefs.studentUI = false; savePrefs(); toast('บัญชีครู · เปิดโหมดครูให้แล้ว', 3000); app?.library?.render?.(); } }
  else enforceAccountRule();
}
// apply the install link / enforce student mode at start-up
export function applyStartup() {
  enforceAccountRule();
  const q = new URLSearchParams(location.search);
  if (q.get('mode') === 'student') {
    const k = q.get('k') || lock().h || '';
    prefs.lock = { ...lock(), studentOnly: true, h: k || undefined };
    prefs.studentUI = true; savePrefs();
    // the home-screen app must come back with this flag: point the manifest at the student one before the user adds it
    const l = document.querySelector('link[rel="manifest"]'); if (l) l.href = 'manifest-student.webmanifest';
  }
  if (studentOnly() && !unlockedNow() && !prefs.studentUI) { prefs.studentUI = true; savePrefs(); }
}

export async function setPin(pin) { prefs.lock = { ...lock(), h: await hashPin(pin) }; savePrefs(); }
export function clearPin() { prefs.lock = { ...lock(), h: undefined }; savePrefs(); }
export async function verifyPin(pin) { return hasPin() && (await hashPin(pin)) === lock().h; }

const FAILS = 'senkid.lockfails';
function fails() { try { return JSON.parse(localStorage.getItem(FAILS) || '{"n":0,"t":0}'); } catch { return { n: 0, t: 0 }; } }
function setFails(v) { try { localStorage.setItem(FAILS, JSON.stringify(v)); } catch { } }

// ask for the PIN; resolves true when correct. 5 wrong tries → wait a minute.
export function askPin(title = 'ใส่ PIN ของครู', sub = '') {
  return new Promise((res) => {
    let ok = false;
    const inp = h('input', { class: 'inp', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: 8, placeholder: 'PIN 4–8 หลัก', style: { fontSize: '28px', letterSpacing: '8px', textAlign: 'center', width: '100%' } });
    const msg = h('div', { class: 'sub', style: { marginTop: '8px', minHeight: '24px' } }, sub);
    const d = dialog(title, h('div', {}, inp, msg), [{ label: 'ยกเลิก' }, { label: 'ตกลง', cls: 'prim', flex: 2, action: async () => {
      const f = fails(); if (f.n >= 5 && Date.now() - f.t < 60e3) { msg.textContent = `ผิดหลายครั้ง · รอ ${Math.ceil((60e3 - (Date.now() - f.t)) / 1000)} วินาที`; return false; }
      if (await verifyPin(inp.value)) { ok = true; setFails({ n: 0, t: 0 }); return true; }
      const n = (f.n >= 5 && Date.now() - f.t >= 60e3) ? 1 : f.n + 1; setFails({ n, t: Date.now() }); inp.value = ''; msg.textContent = n >= 5 ? 'ผิด 5 ครั้ง · รอ 1 นาทีแล้วลองใหม่' : `PIN ไม่ถูกต้อง (${n}/5)`; inp.focus(); return false;
    } }], { width: 360, onClose: () => res(ok) });
    inp.onkeydown = (e) => { if (e.key === 'Enter') d.el.querySelector('.foot .prim')?.click(); };
    setTimeout(() => inp.focus(), 50);
  });
}

// may the user leave student mode right now?
export async function requireTeacher() {
  if (accountRule() && !isTeacherDevice()) { toast(TEACHER_ACCOUNTS.length === 1 ? `โหมดครูใช้ได้เฉพาะเครื่องที่เชื่อม Google Drive ด้วยบัญชี ${TEACHER_ACCOUNTS[0]}` : 'โหมดครูใช้ได้เฉพาะเครื่องที่เชื่อม Google Drive ด้วยบัญชีครู', 4000, 'warn'); return false; }
  if (!hasPin() && !studentOnly()) return true;
  if (!hasPin()) { toast('เครื่องนี้ติดตั้งแบบนักเรียน · ไม่มี PIN ครูสำหรับปลดล็อก', 3500, 'warn'); return false; }
  const ok = await askPin('ปลดล็อกโหมดครู', studentOnly() ? 'เครื่องนี้ติดตั้งแบบนักเรียน · ปลดล็อกได้ชั่วคราวจนกว่าจะปิดแอป' : '');
  if (ok) setUnlocked(true);
  return ok;
}

// set / change / remove the PIN (teacher side)
export async function managePin() {
  if (hasPin() && !(await askPin('ยืนยัน PIN เดิมก่อน'))) return false;
  return new Promise((res) => {
    let done = false;
    const a = h('input', { class: 'inp', type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: 'PIN ใหม่ (4–8 หลัก)', style: { fontSize: '24px', letterSpacing: '6px', textAlign: 'center', width: '100%' } });
    const b = h('input', { class: 'inp', type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: 'พิมพ์ซ้ำอีกครั้ง', style: { fontSize: '24px', letterSpacing: '6px', textAlign: 'center', width: '100%', marginTop: '8px' } });
    const msg = h('div', { class: 'sub', style: { marginTop: '8px', minHeight: '24px' } }, 'ใช้ยืนยันเมื่อเปลี่ยนจากโหมดนักเรียนกลับเป็นโหมดครู · จำไว้ให้ดี ลืมแล้วต้องล้างข้อมูลแอป');
    const btns = [{ label: 'ยกเลิก' }];
    if (hasPin()) btns.push({ label: 'ลบ PIN', cls: 'danger', action: () => { clearPin(); done = true; toast('ลบ PIN แล้ว · สลับโหมดได้อิสระ', 2500); } });
    btns.push({ label: 'บันทึก', cls: 'prim', flex: 2, action: async () => {
      if (!/^\d{4,8}$/.test(a.value)) { msg.textContent = 'PIN ต้องเป็นตัวเลข 4–8 หลัก'; return false; }
      if (a.value !== b.value) { msg.textContent = 'พิมพ์ซ้ำไม่ตรงกัน'; b.value = ''; b.focus(); return false; }
      await setPin(a.value); done = true; toast('ตั้ง PIN ครูแล้ว', 2500); return true;
    } });
    const d = dialog(hasPin() ? 'เปลี่ยน PIN ครู' : 'ตั้ง PIN ครู', h('div', {}, a, b, msg), btns, { width: 380, onClose: () => res(done) });
    setTimeout(() => a.focus(), 50);
  });
}

// the student install link (+ QR): the app added from it always opens in student mode; the teacher's PIN hash rides along
// so the teacher can unlock that device with the same PIN
export async function showStudentLink() {
  const url = new URL('./', location.href); url.searchParams.set('mode', 'student'); if (hasPin()) url.searchParams.set('k', lock().h);
  const link = url.href;
  let img = null; try { const QR = (await import('../vendor/qrcode.esm.js')).default; img = h('img', { src: await QR.toDataURL(link, { width: 560, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1E2A55', light: '#FFFFFF' } }), style: { width: '280px', height: '280px', display: 'block', margin: '0 auto', borderRadius: '12px', background: '#fff' } }); } catch { }
  const body = h('div', { style: { textAlign: 'center' } }, img,
    h('p', { class: 'sub', style: { margin: '10px 0 4px' } }, 'ให้นักเรียนสแกนแล้ว "เพิ่มลงหน้าจอโฮม" จากหน้านี้ แอปที่ได้จะเปิดเป็นโหมดนักเรียนเสมอ ไม่มีปุ่มสลับ ไม่มีซิงค์ Google'),
    h('p', { class: 'sub', style: { margin: '0 0 10px' } }, hasPin() ? 'ครูปลดล็อกชั่วคราวบนเครื่องนักเรียนได้ด้วย PIN เดียวกับเครื่องครู' : 'ยังไม่ได้ตั้ง PIN ครู: เครื่องที่ติดตั้งจากลิงก์นี้จะปลดล็อกไม่ได้เลย (ตั้ง PIN ก่อนแจกถ้าต้องการปลดล็อกได้)'),
    h('input', { class: 'inp', value: link, readonly: true, style: { width: '100%', fontSize: '16px' }, onclick: (e) => e.target.select() }));
  dialog('ลิงก์ติดตั้งสำหรับนักเรียน', body, [{ label: 'คัดลอกลิงก์', cls: 'sec', action: () => { navigator.clipboard?.writeText(link).then(() => toast('คัดลอกแล้ว', 1500)).catch(() => { }); return false; } }, { label: 'ปิด', cls: 'prim' }], { width: 460 });
}

// lock an already-installed app (the student's own install from the normal link) into student mode
export async function lockThisDevice(app) {
  if (!hasPin()) { toast('ตั้ง PIN ครูก่อน · PIN เดียวกันนี้ใช้ปลดล็อกทุกเครื่อง', 3000); if (!(await managePin())) return; }
  else if (!(await askPin('ยืนยัน PIN ครู', 'ล็อกเครื่องนี้เป็นโหมดนักเรียน'))) return;
  prefs.lock = { ...lock(), studentOnly: true }; prefs.studentUI = true; setUnlocked(false); savePrefs();
  toast('ล็อกแล้ว · เครื่องนี้อยู่ในโหมดนักเรียน ปลดได้ด้วย PIN ครูเท่านั้น', 3500);
  document.querySelector('.sheet .top button')?.click(); app?.openSettings?.();
}
