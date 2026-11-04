// Cloud sync through the teacher's own Google Drive (hidden app folder).
// Each notebook record, each page and each PDF is one file in Drive; newer `updated` wins.
import * as db from './db.js';
import { prefs, savePrefs, toolPrefs, applyToolPrefs } from './prefs.js';
import { blobToDataURL, dataURLToBlob } from './images.js';
import { toast } from './ui.js';

// OAuth client (Google Cloud project of the teacher). Can be overridden in settings.
export const DEFAULT_CLIENT_ID = '991820377436-rhlp8jjecl11j10svd76736nejhacqi0.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file openid email';
const API = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'senkid.gtoken';
const appUrl = () => new URL('./', location.href).href;

export const sync = {
  state: 'off', // off | idle | syncing | error | auth
  email: '', lastSync: 0, error: '', progress: '', listeners: new Set(), app: null,
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const fn of this.listeners) try { fn(this); } catch { } },
};
function setState(st, extra = {}) { Object.assign(sync, { state: st }, extra); sync.emit(); }

// ---------- token ----------
function readToken() { try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); return t && t.exp > Date.now() + 30e3 ? t : null; } catch { return null; } }
function clientId() { return prefs.sync?.clientId || DEFAULT_CLIENT_ID; }
export function connected() { return !!prefs.sync?.on; }
export function tokenOk() { return !!readToken(); }

// top-level redirect to Google (works in Safari and in the home-screen app; no popups)
export function signIn({ silent = false } = {}) {
  const id = clientId(); if (!id) { toast('ยังไม่ได้ตั้งค่า Client ID ของ Google (ตั้งค่า > ซิงก์)', 4000, 'warn'); return; }
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem('senkid.oauth', JSON.stringify({ state, silent, back: location.pathname + location.search }));
  const q = new URLSearchParams({ client_id: id, redirect_uri: appUrl(), response_type: 'token', scope: SCOPES, include_granted_scopes: 'true', state });
  if (silent) { q.set('prompt', 'none'); if (prefs.sync?.email) q.set('login_hint', prefs.sync.email); }
  else q.set('prompt', 'select_account');
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
// call once at startup: picks up the token from the URL hash after Google sends us back
export async function handleRedirect() {
  if (!/[#&]access_token=|[#&]error=/.test(location.hash)) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  let pending = null; try { pending = JSON.parse(sessionStorage.getItem('senkid.oauth') || 'null'); } catch { }
  sessionStorage.removeItem('senkid.oauth');
  history.replaceState(null, '', location.pathname + location.search);
  if (!pending || h.get('state') !== pending.state) return false;
  if (h.get('error')) { if (!pending.silent) toast('เชื่อมต่อ Google ไม่สำเร็จ: ' + h.get('error'), 4000, 'warn'); setState('auth', { error: h.get('error') }); return true; }
  const tok = { t: h.get('access_token'), exp: Date.now() + (+h.get('expires_in') || 3600) * 1000, scope: h.get('scope') || '' };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tok));
  prefs.sync = { ...(prefs.sync || {}), on: true }; savePrefs();
  try { const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + tok.t } }); if (r.ok) { const u = await r.json(); prefs.sync.email = u.email || ''; savePrefs(); } } catch { }
  setState('idle', { email: prefs.sync.email });
  if (!pending.silent) toast('เชื่อม Google Drive แล้ว · สมุดจะซิงก์อัตโนมัติ', 3000);
  return true;
}
export function disconnect() { localStorage.removeItem(TOKEN_KEY); prefs.sync = { ...(prefs.sync || {}), on: false }; savePrefs(); setState('off'); }

// ---------- Drive helpers ----------
async function gfetch(url, opt = {}, retry = true) {
  const tok = readToken(); if (!tok) throw Object.assign(new Error('auth'), { auth: true });
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + tok.t } });
  if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); throw Object.assign(new Error('auth'), { auth: true }); }
  if (r.ok) return r;
  const err = await driveError(r, 'Drive');
  if ((r.status === 429 || r.status >= 500 || RATE.has(err.reason)) && retry) { await new Promise(res => setTimeout(res, 2000)); return gfetch(url, opt, false); }
  throw err;
}
// Google's error body says *why* (e.g. 403 = Drive full / rate limit / school policy) — show that in Thai
const RATE = new Set(['userRateLimitExceeded', 'rateLimitExceeded', 'sharingRateLimitExceeded']);
const REASON_TH = {
  storageQuotaExceeded: 'พื้นที่ Google Drive เต็ม — ลบไฟล์ใน Drive หรือขอพื้นที่เพิ่มจากผู้ดูแลระบบโรงเรียน',
  quotaExceeded: 'พื้นที่ Google Drive เต็ม — ลบไฟล์ใน Drive หรือขอพื้นที่เพิ่มจากผู้ดูแลระบบโรงเรียน',
  userRateLimitExceeded: 'ส่งข้อมูลถี่เกินไป รอสักครู่แล้วลองใหม่', rateLimitExceeded: 'ส่งข้อมูลถี่เกินไป รอสักครู่แล้วลองใหม่',
  dailyLimitExceeded: 'ใช้ Drive ครบโควตาวันนี้แล้ว ลองใหม่พรุ่งนี้',
  domainPolicy: 'ผู้ดูแลระบบโรงเรียนไม่อนุญาตให้แอปนี้ใช้ Google Drive',
  insufficientPermissions: 'สิทธิ์ Google ไม่พอ — ตัดการเชื่อมต่อแล้วเชื่อมใหม่',
};
async function driveError(r, prefix) {
  let reason = '', msg = '';
  try { const j = JSON.parse(await r.text()); reason = j.error?.errors?.[0]?.reason || j.error?.status || ''; msg = j.error?.message || ''; } catch {}
  const th = REASON_TH[reason];
  return Object.assign(new Error(th || `${prefix} ${r.status}${reason ? ' ' + reason : ''}${msg ? ': ' + msg.slice(0, 160) : ''}`), { status: r.status, reason });
}
async function listAll() {
  const out = []; let pageToken = '';
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(id,name,appProperties,size)' });
    if (pageToken) q.set('pageToken', pageToken);
    const j = await (await gfetch(`${API}/files?${q}`)).json();
    out.push(...(j.files || [])); pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}
async function download(fileId, asBlob) { const r = await gfetch(`${API}/files/${fileId}?alt=media`); return asBlob ? r.blob() : r.json(); }
// Drive caps each app property at 124 bytes (key + value, UTF-8): Thai file names blow past that fast
function clipProp(key, val, limit = 124) {
  const enc = new TextEncoder(); let v = String(val ?? ''); const max = limit - enc.encode(key).length - 2;
  while (enc.encode(v).length > max) v = v.slice(0, -1);
  return v;
}
async function upload(existingId, name, appProperties, body, mime) {
  if (appProperties) for (const k of Object.keys(appProperties)) appProperties[k] = clipProp(k, appProperties[k]);
  const meta = { name, appProperties }; if (!existingId) meta.parents = ['appDataFolder'];
  const blob = body instanceof Blob ? body : new Blob([JSON.stringify(body)], { type: mime || 'application/json' });
  if (blob.size < 4.5e6) {
    const fd = new FormData(); fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' })); fd.append('file', blob);
    const r = await gfetch(`${UP}/files${existingId ? '/' + existingId : ''}?uploadType=multipart&fields=id`, { method: existingId ? 'PATCH' : 'POST', body: fd });
    return (await r.json()).id;
  }
  // big file: resumable upload in one go (a fresh session once more if Google refuses the first)
  const type = blob.type || mime || 'application/octet-stream';
  for (let attempt = 0; ; attempt++) {
    const r0 = await gfetch(`${UP}/files${existingId ? '/' + existingId : ''}?uploadType=resumable&fields=id`, { method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(blob.size) }, body: JSON.stringify(meta) });
    const loc = r0.headers.get('Location'); if (!loc) throw new Error('resumable: no location');
    const tok = readToken();
    const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': type, ...(tok ? { Authorization: 'Bearer ' + tok.t } : {}) }, body: blob });
    if (r.ok) return (await r.json()).id;
    const err = await driveError(r, 'upload');
    if (attempt === 0 && (r.status === 403 || r.status === 429 || r.status >= 500) && !REASON_TH[err.reason]?.includes('เต็ม')) { await new Promise(res => setTimeout(res, 2500)); continue; }
    throw err;
  }
}
// small helpers for other modules (pairing file)
export async function driveFind(kind) { const q = new URLSearchParams({ spaces: 'appDataFolder', q: `appProperties has { key='kind' and value='${kind}' }`, fields: 'files(id,name,appProperties)' }); const j = await (await gfetch(`${API}/files?${q}`)).json(); return (j.files || [])[0] || null; }
export const driveDownload = download, driveUpload = upload;
async function remove(fileId) { try { await gfetch(`${API}/files/${fileId}`, { method: 'DELETE' }); } catch (e) { if (!/404/.test(e.message)) throw e; } }

// ---------- (de)serialising ----------
async function pageOut(p) {
  const strokes = [];
  for (const s of (p.strokes || [])) {
    if (s.t === 'img') { const { blob, ...rest } = s; strokes.push({ ...rest, data: await blobToDataURL(blob) }); }
    else if (s.pts) strokes.push({ ...s, pts: Array.from(s.pts) });
    else strokes.push(s);
  }
  return { ...p, strokes };
}
async function pageIn(p) {
  const strokes = [];
  for (const s of (p.strokes || [])) {
    if (s.t === 'img' && s.data) { const { data, ...rest } = s; strokes.push({ ...rest, blob: await dataURLToBlob(data) }); }
    else if (s.pts) strokes.push({ ...s, pts: Float32Array.from(s.pts) });
    else strokes.push(s);
  }
  return { ...p, strokes };
}
const nbOut = (nb) => { const { thumb, fileName, fileSavedAt, ...rest } = nb; return { ...rest, thumb }; };

// ---------- the sync itself ----------
let running = null, again = false, timer = null;
export function scheduleSync(ms = 6000) { if (!connected()) return; clearTimeout(timer); timer = setTimeout(() => syncNow('auto'), ms); }
export function syncNow(reason = 'manual') {
  if (!connected()) return Promise.resolve(false);
  if (running) { again = true; return running; }
  running = (async () => {
    try { return await doSync(reason); }
    finally { running = null; if (again) { again = false; scheduleSync(3000); } }
  })();
  return running;
}
async function doSync(reason) {
  if (!navigator.onLine) { setState('idle', { error: 'ออฟไลน์' }); return false; }
  if (!readToken()) { setState('auth'); return false; }
  setState('syncing', { error: '', progress: 'กำลังตรวจสอบ…' });
  const app = sync.app, ed = app?.editor;
  try {
    await ed?.flush?.();
    const remote = await listAll();
    const rNb = new Map(), rPg = new Map(), rPdf = new Map(), rDel = new Map(); let rRecs = null, rPrefs = null;
    for (const f of remote) {
      const a = f.appProperties || {};
      if (a.kind === 'nb') rNb.set(a.id, { f, updated: +a.updated || 0 });
      else if (a.kind === 'page') rPg.set(a.id, { f, nb: a.nb, updated: +a.updated || 0 });
      else if (a.kind === 'pdf') rPdf.set(a.id, { f });
      else if (a.kind === 'del') rDel.set(a.id, { f, t: +a.t || 0 });
      else if (a.kind === 'recs') rRecs = f;
      else if (a.kind === 'prefs') rPrefs = f;
    }
    const local = new Map((await db.getAll('notebooks')).map(n => [n.id, n]));
    const tomb = (await db.get('kv', 'sync:deleted'))?.v || {};
    let pulled = 0, pushed = 0, touchedOpen = false, pdfFailMsg = '';
    const pdfFails = [];
    const openId = ed?.nb?.id;
    db.setQuiet(true);
    try {
      // 1) deletions
      for (const [id, t] of Object.entries(tomb)) {
        for (const [pid, r] of rPg) if (r.nb === id) { await remove(r.f.id); rPg.delete(pid); }
        if (rNb.has(id)) { await remove(rNb.get(id).f.id); rNb.delete(id); }
        if (!rDel.has(id)) await upload(null, `del-${id}`, { kind: 'del', id, t: String(t) }, { id, t });
        rDel.set(id, { t });
      }
      if (Object.keys(tomb).length) await db.put('kv', { k: 'sync:deleted', v: {} });
      for (const [id, d] of rDel) {
        const l = local.get(id);
        if (l && (l.updated || 0) <= d.t) { await db.deleteNotebook(id); local.delete(id); pulled++; if (id === openId) touchedOpen = true; }
        if (rNb.has(id) && rNb.get(id).updated <= d.t) { await remove(rNb.get(id).f.id); rNb.delete(id); }
      }
      // 2) notebooks + pages
      const ids = new Set([...local.keys(), ...rNb.keys()]);
      let n = 0;
      for (const id of ids) {
        n++; setState('syncing', { progress: `สมุดเล่มที่ ${n} จาก ${ids.size}` });
        const l = local.get(id), r = rNb.get(id);
        const rd = rDel.get(id); if (!l && rd && r && r.updated <= rd.t) continue;
        let nb, pageList;
        if (r && (!l || r.updated > (l.updated || 0))) { // pull record
          nb = await download(r.f.id); nb.fileSavedAt = l?.fileSavedAt; nb.fileName = l?.fileName;
          await db.put('notebooks', nb); pulled++;
          if (id === openId) { const same = JSON.stringify(nb.pages) === JSON.stringify(ed.nb.pages); if (same) { ed.nb.name = nb.name; ed.nb.folder = nb.folder; ed.nb.updated = Math.max(ed.nb.updated || 0, nb.updated || 0); } else touchedOpen = true; }
        } else nb = l;
        pageList = nb.pages || [];
        if (l && (!r || (l.updated || 0) > r.updated)) { await upload(r?.f.id, `nb-${id}.json`, { kind: 'nb', id, updated: String(l.updated || 0) }, nbOut(l)); pushed++; }
        // pages of this notebook
        const lp = new Map((await db.pagesOf(id)).map(p => [p.id, p]));
        const jobs = [];
        for (const pid of pageList) {
          const lpg = lp.get(pid), rpg = rPg.get(pid);
          const editedHere = id === openId && ed?.editedAt?.get(pid) && Date.now() - ed.editedAt.get(pid) < 15 * 60e3;
          if (rpg && lpg && editedHere && rpg.updated > (lpg.updated || 0)) jobs.push(async () => {
            // written on this device in the last 15 minutes: keep ours and push it with a stamp the other side must respect
            await ed.flush?.(); const cur = await db.get('pages', pid); if (!cur) return;
            cur.updated = Math.max(Date.now(), rpg.updated + 1); await db.put('pages', cur); const lp2 = ed.pageMap.get(pid); if (lp2) lp2.updated = cur.updated;
            await upload(rpg.f.id, `pg-${pid}.json`, { kind: 'page', id: pid, nb: id, updated: String(cur.updated) }, await pageOut(cur)); pushed++;
          });
          else if (rpg && (!lpg || rpg.updated > (lpg.updated || 0))) jobs.push(async () => {
            const p = await pageIn(await download(rpg.f.id)); p.updated = rpg.updated;
            if (id === openId) await ed.flush?.();
            const cur = await db.get('pages', pid); if (cur && (cur.updated || 0) > (lpg?.updated || 0) && (cur.updated || 0) >= rpg.updated) return; // edited here meanwhile: keep ours
            await db.savePagesAndNotebook([p], null); pulled++;
            if (id === openId && !ed.applyRemotePage(p)) touchedOpen = true;
          });
          else if (lpg && (!rpg || (lpg.updated || 0) > rpg.updated)) jobs.push(async () => {
            await upload(rpg?.f.id, `pg-${pid}.json`, { kind: 'page', id: pid, nb: id, updated: String(lpg.updated || 0) }, await pageOut(lpg)); pushed++;
          });
        }
        // a few pages at a time (first upload of a big notebook)
        let done = 0; const total = jobs.length;
        const idle = async () => { while (ed?.live || ed?.lassoDraw || ed?.drag) await new Promise(r => setTimeout(r, 300)); await new Promise(r => setTimeout(r, 0)); };
        await Promise.all(Array.from({ length: Math.min(2, total) }, async () => { while (jobs.length) { await idle(); const j = jobs.shift(); await j(); done++; if (total > 3) setState('syncing', { progress: `${nb.name || 'สมุด'} · หน้า ${done}/${total}` }); } }));
        // remote pages no longer in the notebook
        for (const [pid, rpg] of rPg) if (rpg.nb === id && !pageList.includes(pid)) { await remove(rpg.f.id); rPg.delete(pid); }
        // local pages no longer in the notebook (removed on another device)
        for (const pid of lp.keys()) if (!pageList.includes(pid)) await db.del('pages', pid);
      }
      // 3) PDFs referenced by pages
      const need = new Set();
      for (const p of await db.getAll('pages')) if (p.pdf?.id) need.add(p.pdf.id);
      for (const pdfId of need) {
        const l = await db.get('pdfs', pdfId), r = rPdf.get(pdfId);
        if (l && !r) {
          setState('syncing', { progress: 'อัปโหลด PDF ' + l.name });
          // one PDF that Drive refuses must not stop the rest of the sync
          try { await upload(null, `pdf-${pdfId}.pdf`, { kind: 'pdf', id: pdfId, name: String(l.name || '').slice(0, 100), pages: String(l.pages || 0) }, l.blob, 'application/pdf'); pushed++; }
          catch (e) { if (e.auth) throw e; pdfFailMsg = 'ส่ง PDF ไม่สำเร็จ: ' + e.message; console.warn('sync pdf', l.name, e); pdfFails.push(`${l.name || 'PDF'} (${((l.blob?.size || 0) / 1048576).toFixed(1)} MB): ${e.message}`); }
        }
        else if (!l && r) { setState('syncing', { progress: 'ดาวน์โหลด PDF ' + (r.f.appProperties.name || '') }); const blob = await download(r.f.id, true); await db.put('pdfs', { id: pdfId, name: r.f.appProperties.name || 'เอกสาร.pdf', pages: +r.f.appProperties.pages || 0, blob, created: Date.now() }); pulled++; touchedOpen = touchedOpen || !!openId; }
      }
      // 4) recordings index (clips themselves live in Drive, folder เส้นคิด/คลิป) — one small json shared by all devices
      try {
        const idx = rRecs ? await download(rRecs.id) : { recs: {}, deleted: {} };
        const rdel = { ...(idx.deleted || {}), ...((await db.get('kv', 'sync:recdel'))?.v || {}) };
        const mine = (await db.getAll('recs')).filter(r => r.drive && r.done);
        const merged = { ...(idx.recs || {}) };
        let changed = !rRecs;
        for (const m of mine) { if (rdel[m.id]) continue; const { ...meta } = m; if (JSON.stringify(merged[m.id]) !== JSON.stringify(meta)) { merged[m.id] = meta; changed = true; } }
        for (const id of Object.keys(rdel)) if (merged[id]) { delete merged[id]; changed = true; }
        const localIds = new Set((await db.getAll('recs')).map(r => r.id));
        for (const [id, m] of Object.entries(merged)) if (!localIds.has(id)) { await db.put('recs', m); pulled++; }
        for (const id of Object.keys(rdel)) if (localIds.has(id)) { const l = await db.get('recs', id); if (l?.drive) { await db.deleteRec(id); } }
        if (JSON.stringify(rdel) !== JSON.stringify(idx.deleted || {})) changed = true;
        if (changed) await upload(rRecs?.id, 'recs.json', { kind: 'recs', id: 'recs' }, { recs: merged, deleted: rdel });
        await db.put('kv', { k: 'sync:recdel', v: {} });
      } catch (e) { if (e.auth) throw e; console.warn('sync recs', e); }
      // 5) tool settings (colours, pen sizes…): newest device wins
      try {
        const rp = rPrefs ? await download(rPrefs.id) : null, rt = rp?.stamp || 0, lt = prefs.toolsStamp || 0;
        if (rp && rt > lt) { applyToolPrefs(rp.tools || {}, rt); app?.editor?.buildToolbar?.(); app?.editor?.buildDock?.(); try { (await import('./fonts.js')).applyUiFont(); } catch { } }
        else if (lt > rt) await upload(rPrefs?.id || null, 'prefs.json', { kind: 'prefs', id: 'prefs' }, { stamp: lt, tools: toolPrefs() });
      } catch (e) { if (e.auth) throw e; console.warn('sync prefs', e); }
    } finally { db.setQuiet(false); }
    sync.lastSync = Date.now(); prefs.sync.last = sync.lastSync; savePrefs();
    setState('idle', { error: pdfFailMsg, progress: '' });
    if (pdfFails.length && reason === 'manual') toast('สมุดซิงก์แล้ว แต่ส่ง PDF ไม่ได้ — ' + pdfFails.join(' · '), 7000, 'warn');
    if (pulled) {
      if (app?.library && !ed) app.library.load();
      if (touchedOpen && ed) {
        const reload = async () => { const id = ed.nb.id, view = { z: ed.z, ox: ed.ox, oy: ed.oy, fit: ed.fitMode, cur: ed.currentPage()?.id }; await ed.flush?.(); await app.openNotebook(id);
          const e2 = app.editor; if (e2 && e2.nb?.id === id && view.cur && e2.pageMap.has(view.cur)) { e2.z = view.z; e2.ox = view.ox; e2.oy = view.oy; e2.fitMode = view.fit; e2.clampView?.(); e2.viewChanged?.(); e2.need.main = e2.need.ui = true; }
          toast('อัปเดตสมุดจากเครื่องอื่นแล้ว', 2000); };
        const busyWriting = Date.now() - (ed.lastInput || 0) < 120e3;
        if (!ed.live && !busyWriting && !document.querySelector('.dialog') && !app.recorder?.active) await reload();
        else { const b = document.createElement('button'); b.className = 'pill prim'; b.style.cssText = 'height:40px;margin-left:10px;pointer-events:auto'; b.textContent = 'โหลดใหม่'; b.onclick = () => { t.remove(); reload(); }; const t = document.createElement('div'); t.className = 'toast keep updbar'; t.append('มีการแก้ไขสมุดเล่มนี้จากเครื่องอื่น', b); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 15000); }
      }
    }
    if (reason === 'manual') toast(pushed || pulled ? `ซิงก์แล้ว · ส่งขึ้น ${pushed} · รับมา ${pulled}` : 'ข้อมูลตรงกันทุกเครื่องแล้ว', 2200);
    return true;
  } catch (e) {
    console.warn('sync', e);
    if (e.auth) setState('auth', { error: 'ต้องเชื่อมต่อ Google ใหม่' });
    else setState('error', { error: e.message || String(e) });
    if (reason === 'manual') toast('ซิงก์ไม่สำเร็จ: ' + (e.auth ? 'ต้องเชื่อมต่อ Google ใหม่' : e.message), 4000, 'warn');
    return false;
  }
}

// ---------- wiring ----------
export async function initSync(app) {
  sync.app = app;
  const got = await handleRedirect();
  if (!connected()) { setState('off'); return; }
  sync.email = prefs.sync.email || ''; sync.lastSync = prefs.sync.last || 0;
  if (!readToken()) {
    // token lasts an hour: refresh silently once per launch (Google answers at once when still signed in)
    const tried = sessionStorage.getItem('senkid.silent') === '1';
    if (!tried && !got && navigator.onLine) { sessionStorage.setItem('senkid.silent', '1'); await app.editor?.flush?.(); signIn({ silent: true }); return; }
    setState('auth'); return;
  }
  sessionStorage.removeItem('senkid.silent');
  setState('idle');
  db.onChange(() => scheduleSync(6000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(timer); syncNow('auto'); } else scheduleSync(1500); });
  addEventListener('online', () => scheduleSync(2000));
  setInterval(() => scheduleSync(0), 3 * 60 * 1000);
  scheduleSync(1200);
}
export function statusText() {
  const t = sync.lastSync ? new Date(sync.lastSync) : null, hm = t ? `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}` : '';
  switch (sync.state) {
    case 'off': return 'ยังไม่ได้เชื่อม Google Drive';
    case 'syncing': return sync.progress || 'กำลังซิงก์…';
    case 'auth': return 'ต้องเชื่อมต่อ Google ใหม่';
    case 'error': return 'ซิงก์ไม่สำเร็จ · แตะเพื่อลองใหม่';
    default: return sync.error ? sync.error : hm ? `ซิงก์แล้ว ${hm}` : 'พร้อมซิงก์';
  }
}

// ---------- recordings → a visible Drive folder "เส้นคิด/คลิป" (needs the drive.file permission) ----------
export function hasFileScope() { const t = readToken(); return !!t && (!t.scope || /drive\.file/.test(t.scope)); }
async function folderId(name, parent) {
  const q = new URLSearchParams({ q: `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent}' in parents`, fields: 'files(id)' });
  const j = await (await gfetch(`${API}/files?${q}`)).json();
  if (j.files?.[0]) return j.files[0].id;
  const r = await gfetch(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
  return (await r.json()).id;
}
export async function uploadRecording(blob, name, onProgress) {
  if (!connected() || !readToken()) throw Object.assign(new Error('auth'), { auth: true });
  const root = await folderId('เส้นคิด', 'root'), dir = await folderId('คลิป', root);
  onProgress?.('กำลังอัปโหลด…');
  const r0 = await gfetch(`${UP}/files?uploadType=resumable&fields=id,webViewLink`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) }, body: JSON.stringify({ name, parents: [dir] }) });
  const loc = r0.headers.get('Location'); if (!loc) throw new Error('resumable: no location');
  const tok = readToken();
  // upload in chunks so the progress bar moves and a dropped connection can resume
  const CH = 8 * 1024 * 1024; let off = 0, out = null;
  while (off < blob.size) {
    const end = Math.min(blob.size, off + CH), part = blob.slice(off, end);
    let r; for (let tries = 0; ; tries++) {
      r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream', 'Content-Range': `bytes ${off}-${end - 1}/${blob.size}`, Authorization: 'Bearer ' + tok.t }, body: part });
      if (r.status === 308 || r.ok) break;
      if (tries >= 2) throw new Error('upload ' + r.status);
      await new Promise(res => setTimeout(res, 1500));
    }
    if (r.ok) out = await r.json();
    off = end; onProgress?.(`กำลังอัปโหลด… ${Math.round(off / blob.size * 100)}%`, off / blob.size);
  }
  return out; // {id, webViewLink}
}
export async function driveFileUrl(id) { const r = await gfetch(`${API}/files/${id}?alt=media`); return URL.createObjectURL(await r.blob()); }
export async function deleteDriveFile(id) { await remove(id); }
export async function gfetchBlob(id, type) { const r = await gfetch(`${API}/files/${id}?alt=media`); const b = await r.blob(); return type && b.type !== type ? new Blob([b], { type }) : b; }
