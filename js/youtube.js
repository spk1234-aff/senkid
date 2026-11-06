// YouTube upload with its own sign-in (any Google account, not necessarily the one used for Drive sync).
// Token lives an hour; the upload is resumable so a long clip survives a hiccup.
import { h, icon, toast, dialog, busy, fmtTime, fmtBytes, seg } from './ui.js';
import * as db from './db.js';
import { prefs, savePrefs } from './prefs.js';
import { DEFAULT_CLIENT_ID } from './sync.js';

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const KEY = 'senkid.yttoken', PEND = 'senkid.ytoauth';
const appUrl = () => new URL('./', location.href).href;
export function ytToken() { try { const t = JSON.parse(localStorage.getItem(KEY) || 'null'); return t && t.exp > Date.now() + 30e3 ? t : null; } catch { return null; } }
export function ytAccount() { return prefs.yt?.email || ''; }
export function ytSignIn(recId) {
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem(PEND, JSON.stringify({ state, rec: recId || null }));
  const q = new URLSearchParams({ client_id: prefs.sync?.clientId || DEFAULT_CLIENT_ID, redirect_uri: appUrl(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'false', state, prompt: 'select_account' });
  if (prefs.yt?.email) q.set('login_hint', prefs.yt.email);
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
// called before the Drive handler at startup: true when this hash belongs to a YouTube sign-in
export async function ytHandleRedirect(app) {
  if (!/[#&]access_token=|[#&]error=/.test(location.hash)) return false;
  let pend = null; try { pend = JSON.parse(sessionStorage.getItem(PEND) || 'null'); } catch { }
  if (!pend) return false;
  const hh = new URLSearchParams(location.hash.slice(1)); if (hh.get('state') !== pend.state) return false;
  sessionStorage.removeItem(PEND); history.replaceState(null, '', location.pathname + location.search);
  if (hh.get('error')) { toast('เชื่อม YouTube ไม่สำเร็จ: ' + hh.get('error'), 4000, 'warn'); return true; }
  const tok = { t: hh.get('access_token'), exp: Date.now() + (+hh.get('expires_in') || 3600) * 1000, scope: hh.get('scope') || '' };
  localStorage.setItem(KEY, JSON.stringify(tok));
  prefs.yt = { ...(prefs.yt || {}), on: true };
  try { const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + tok.t } }); if (r.ok) { const j = await r.json(); const c = j.items?.[0]; if (c) { prefs.yt.channel = c.snippet?.title || ''; prefs.yt.channelId = c.id; } } else if (r.status === 403) { const j = await r.json().catch(() => ({})); if (/not been used|disabled|accessNotConfigured/i.test(JSON.stringify(j))) toast('โปรเจกต์ Google ยังไม่ได้เปิด YouTube Data API · ดูวิธีในตั้งค่า > YouTube', 6000, 'warn'); } } catch { }
  savePrefs();
  toast('เชื่อม YouTube แล้ว' + (prefs.yt.channel ? ' · ช่อง ' + prefs.yt.channel : ''), 3000);
  if (pend.rec) { try { const m = await db.get('recs', pend.rec); if (m) setTimeout(() => uploadToYouTube(m), 600); } catch { } }
  return true;
}
export function ytDisconnect() { localStorage.removeItem(KEY); prefs.yt = { on: false }; savePrefs(); }

async function yfetch(url, opt = {}) {
  const tok = ytToken(); if (!tok) throw Object.assign(new Error('auth'), { auth: true });
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + tok.t } });
  if (r.status === 401) { localStorage.removeItem(KEY); throw Object.assign(new Error('auth'), { auth: true }); }
  if (!r.ok) { const txt = await r.text().catch(() => ''); const e = new Error(ytErrorText(r.status, txt)); e.status = r.status; throw e; }
  return r;
}
function ytErrorText(status, txt) {
  if (/accessNotConfigured|has not been used|is disabled/i.test(txt)) return 'โปรเจกต์ Google ยังไม่ได้เปิดใช้ YouTube Data API v3 (เปิดใน Google Cloud Console แล้วลองใหม่)';
  if (/quotaExceeded|uploadLimitExceeded/i.test(txt)) return 'เกินโควตาอัปโหลดของวันนี้ · ลองพรุ่งนี้';
  if (/youtubeSignupRequired/i.test(txt)) return 'บัญชีนี้ยังไม่มีช่อง YouTube · สร้างช่องใน YouTube ก่อน';
  if (/forbidden/i.test(txt) && status === 403) return 'บัญชีนี้ไม่ได้รับอนุญาตให้อัปโหลด (403)';
  return `YouTube ตอบ ${status}`;
}

export async function uploadToYouTube(meta, blob = null) {
  if (!ytToken()) {
    const ok = await new Promise(r => dialog('ส่งขึ้น YouTube', h('div', {}, h('p', { style: { marginTop: 0 } }, 'ต้องเข้าสู่ระบบ Google ของช่อง YouTube ก่อน (เลือกบัญชีใดก็ได้ ไม่จำเป็นต้องเป็นบัญชีเดียวกับที่ซิงก์ Drive) แอปจะพากลับมาที่หน้านี้แล้วเริ่มอัปโหลดให้เอง'), h('p', { class: 'sub' }, 'ครั้งแรก: ถ้า Google แจ้งว่าแอปยังไม่ได้ยืนยัน ให้กด "ขั้นสูง" > "ไปที่เส้นคิด" · การอัปโหลดใช้สิทธิ์ 1 ชั่วโมงต่อครั้ง')), [{ label: 'ยกเลิก' }, { label: 'เข้าสู่ระบบ YouTube', cls: 'prim', flex: 2, action: () => r(true) }], { onClose: () => r(false) }));
    if (ok) ytSignIn(meta.id); return;
  }
  let title = (meta.name || 'บทเรียน').replace(/ · วิดีโอ$/, ''), desc = '', privacy = prefs.yt?.privacy || 'unlisted';
  const tIn = h('input', { class: 'field', value: title, maxlength: 100 }), dIn = h('textarea', { class: 'field', rows: 5, placeholder: 'คำอธิบาย · วางสารบัญตอน (00:00 ชื่อตอน) ที่นี่ YouTube จะทำปุ่มข้ามตอนให้' });
  if (meta.fromProject) { try { const pr = (await db.get('kv', 'proj:' + meta.fromProject))?.v; if (pr) { let acc = 0; const lines = []; for (const c of pr.clips) { if (c.kind === 'title' || c.name) lines.push(`${String(Math.floor(acc / 60000)).padStart(2, '0')}:${String(Math.floor(acc / 1000) % 60).padStart(2, '0')} ${c.text || c.name}`); acc += c.kind === 'lesson' || c.kind === 'video' ? Math.max(100, (c.out - c.in) / (c.speed || 1)) : (c.hold || 4000); } if (lines.length > 1) dIn.value = lines.join('\n'); } } catch { } }
  const go = await new Promise(r => dialog('ส่งขึ้น YouTube' + (prefs.yt?.channel ? ' · ' + prefs.yt.channel : ''), h('div', {}, h('div', { class: 'lbl', style: { marginTop: 0 } }, 'ชื่อวิดีโอ'), tIn, h('div', { class: 'lbl' }, 'คำอธิบาย'), dIn, h('div', { class: 'lbl' }, 'การมองเห็น'), seg([['unlisted', 'ไม่แสดงในรายการ (มีลิงก์ถึงดูได้)'], ['private', 'ส่วนตัว'], ['public', 'สาธารณะ']], privacy, v => privacy = v), h('p', { class: 'sub' }, `ไฟล์ ${fmtBytes(meta.size)} · ${fmtTime(meta.duration || 0)} · อัปโหลดต่อเนื่อง เปิดแอปค้างไว้จนเสร็จ`)), [{ label: 'ยกเลิก' }, { label: 'อัปโหลด', cls: 'prim', flex: 2, action: () => r(true) }], { width: 560, onClose: () => r(false) }));
  if (!go) return;
  title = tIn.value.trim() || title; desc = dIn.value; prefs.yt = { ...(prefs.yt || {}), privacy }; savePrefs();
  const bz = busy('กำลังเตรียมไฟล์…');
  try {
    if (!blob) { const R = await import('./recorder.js'); blob = await R.recBlob(meta); }
    const body = { snippet: { title, description: desc, categoryId: '27' }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } };
    const r0 = await yfetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'video/mp4', 'X-Upload-Content-Length': String(blob.size) }, body: JSON.stringify(body) });
    const loc = r0.headers.get('Location'); if (!loc) throw new Error('YouTube ไม่ให้ที่อยู่อัปโหลด');
    const CH = 8 * 1024 * 1024; let off = 0, result = null;
    while (off < blob.size) {
      const end = Math.min(blob.size, off + CH); const part = blob.slice(off, end);
      const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': blob.type || 'video/mp4', 'Content-Range': `bytes ${off}-${end - 1}/${blob.size}` }, body: part });
      if (r.status === 308) { const rng = r.headers.get('Range'); off = rng ? +rng.split('-')[1] + 1 : end; }
      else if (r.ok) { result = await r.json(); off = blob.size; }
      else if (r.status === 401) { localStorage.removeItem(KEY); throw Object.assign(new Error('auth'), { auth: true }); }
      else { const txt = await r.text().catch(() => ''); throw new Error(ytErrorText(r.status, txt)); }
      bz.set('กำลังอัปโหลดขึ้น YouTube…', `${fmtBytes(off)} / ${fmtBytes(blob.size)}`, off / blob.size);
    }
    const vid = result?.id; if (!vid) throw new Error('ไม่ได้รหัสวิดีโอกลับมา');
    meta.yt = vid; meta.ytLink = 'https://youtu.be/' + vid; await db.put('recs', meta);
    bz.done();
    const link = meta.ytLink;
    dialog('ขึ้น YouTube แล้ว', h('div', {}, h('p', { style: { marginTop: 0 } }, 'YouTube กำลังประมวลผล อีกสักครู่จะดูได้ที่'), h('a', { href: link, target: '_blank', rel: 'noopener', style: { fontSize: '22px', wordBreak: 'break-all' } }, link), h('p', { class: 'sub' }, privacy === 'unlisted' ? 'ไม่แสดงในรายการ: ใครมีลิงก์ก็ดูได้ ส่งลิงก์ให้นักเรียนได้เลย' : privacy === 'private' ? 'ส่วนตัว: เปลี่ยนการมองเห็นได้ใน YouTube Studio' : 'สาธารณะ')), [{ label: 'คัดลอกลิงก์', action: () => { navigator.clipboard?.writeText(link).then(() => toast('คัดลอกแล้ว', 1500)).catch(() => { }); return false; } }, { label: 'ปิด', cls: 'prim' }]);
  } catch (e) {
    bz.done();
    if (e.auth) { toast('สิทธิ์ YouTube หมดอายุ · เข้าสู่ระบบใหม่แล้วจะอัปโหลดให้ต่อ', 3000); ytSignIn(meta.id); return; }
    toast('อัปโหลดไม่สำเร็จ: ' + (e.message || e), 6000, 'warn');
  }
}

// settings card
export function ytCard() {
  const on = !!prefs.yt?.on, tok = !!ytToken();
  const b = h('button', { class: 'pill ' + (on ? 'sec' : 'prim'), style: { height: '42px' } }, icon('user'), on ? 'เปลี่ยนบัญชี' : 'เชื่อมบัญชี YouTube'); b.onclick = () => ytSignIn();
  const off = h('button', { class: 'pill ghost', style: { height: '42px' } }, 'ตัดการเชื่อม'); off.onclick = () => { ytDisconnect(); toast('ตัดการเชื่อม YouTube แล้ว', 1500); off.closest('.sheet')?.querySelector('.top button')?.click(); };
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('div', {}, h('div', {}, on ? `ช่อง: ${prefs.yt.channel || '(ไม่ทราบชื่อช่อง)'}` : 'ยังไม่ได้เชื่อม'), h('div', { class: 'sub' }, on ? (tok ? 'พร้อมอัปโหลด' : 'สิทธิ์หมดอายุ · จะขอใหม่ตอนกดอัปโหลด') : 'ใช้บัญชี Google ใดก็ได้ แยกจากบัญชีซิงก์ Drive')), h('div', { style: { display: 'flex', gap: '6px' } }, b, on ? off : null)),
    h('p', { class: 'sub', style: { margin: '8px 0 0' } }, 'กด "ส่งขึ้น YouTube" ได้ที่คลิปวิดีโอใน "คลิปที่อัดไว้" · ครั้งแรกต้องเปิด YouTube Data API v3 ในโปรเจกต์ Google Cloud ของแอป (ทำครั้งเดียว) มิฉะนั้นจะขึ้นข้อความ "ยังไม่ได้เปิดใช้"'));
}
