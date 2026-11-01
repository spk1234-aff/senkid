// Notebooks as real files on the device: save to a file, open a file and keep writing.
// Chrome/Edge (computer, Chromebook): the file stays linked and is re-saved automatically.
// iPad/Android: save through the share sheet ("Save to Files"), open with the file picker.
import { h, icon, toast, dialog, downloadBlob, pickFile, fmtDate, uid } from './ui.js';
import { STRIDE } from './render.js';
import { blobToDataURL, dataURLToBlob } from './images.js';
import * as db from './db.js';

export const canLinkFiles = () => typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
const FILE_TYPES = [{ description: 'สมุดเส้นคิด', accept: { 'application/json': ['.json'] } }];
const OPEN_TYPES = [{ description: 'สมุดเส้นคิด หรือ PDF', accept: { 'application/json': ['.json'], 'application/pdf': ['.pdf'] } }];
const dataURLs = new WeakMap();
async function imgData(blob) { let v = dataURLs.get(blob); if (!v) { v = await blobToDataURL(blob); dataURLs.set(blob, v); } return v; }

export async function buildBackup(ids, livePages, onProgress) {
  const out = { app: 'senkid', format: 1, exported: new Date().toISOString(), notebooks: [], pages: [] };
  for (const id of ids) {
    onProgress && onProgress(out.notebooks.length + 1, ids.length);
    const nb = await db.get('notebooks', id); if (!nb) continue;
    out.notebooks.push({ ...nb, thumb: undefined });
    const pages = livePages && livePages.nb === id ? livePages.pages : await db.pagesOf(id);
    for (const p of pages) {
      const strokes = [];
      for (const s of p.strokes) {
        if (s.t === 'img') strokes.push({ id: s.id, t: 'img', iw: s.iw, ih: s.ih, crop: s.crop, mask: s.mask, x: s.x, y: s.y, w: s.w, h: s.h, ts: s.ts, data: await imgData(s.blob) });
        else if (s.t === 'text') strokes.push({ ...s, bb: undefined });
        else if (s.pts) strokes.push({ id: s.id, t: s.t, pen: s.pen, c: s.c, a: s.a, w: s.w, ts: s.ts, hs: s.hs, pts: Array.from(s.pts, (v, i) => i % STRIDE < 2 ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000) });
        else strokes.push({ id: s.id, t: s.t, pen: s.pen, c: s.c, a: s.a, w: s.w, ts: s.ts, shape: s.shape });
      }
      out.pages.push({ id: p.id, nb: p.nb, size: p.size, bg: p.bg, pw: p.pw, ph: p.ph, pdf: p.pdf, strokes });
    }
  }
  const pdfIds = [...new Set(out.pages.filter(p => p.pdf).map(p => p.pdf.id))];
  if (pdfIds.length) {
    out.pdfs = [];
    for (const id of pdfIds) { const rec = await db.get('pdfs', id); if (rec) out.pdfs.push({ id, name: rec.name, pages: rec.pages, data: await imgData(rec.blob) }); }
  }
  return out;
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (data.app !== 'senkid' || !Array.isArray(data.notebooks)) throw new Error('not senkid');
  return data;
}

async function inflatePages(pages, nid, pmap) {
  const np = [];
  for (const p of pages) {
    const strokes = [];
    for (const s of (p.strokes || [])) {
      if (s.t === 'img' && s.data) { const { data, ...rest } = s; strokes.push({ ...rest, blob: await dataURLToBlob(data) }); }
      else strokes.push(s.pts ? { ...s, pts: Float32Array.from(s.pts) } : s);
    }
    np.push({ ...p, id: pmap.get(p.id), nb: nid, strokes });
  }
  return np;
}

// put notebooks from a file into the app. mode per notebook: 'replace' | 'copy'
export async function storeFromBackup(data, decide, onProgress) {
  for (const pd of (data.pdfs || [])) { if (!(await db.get('pdfs', pd.id))) await db.put('pdfs', { id: pd.id, name: pd.name, pages: pd.pages, blob: await dataURLToBlob(pd.data), created: Date.now() }); }
  const existing = new Map((await db.getAll('notebooks')).map(n => [n.id, n]));
  const ids = [];
  for (const nb of data.notebooks) {
    onProgress && onProgress(ids.length + 1, data.notebooks.length);
    const pages = data.pages.filter(p => p.nb === nb.id);
    let nid = nb.id, pmap = new Map(pages.map(p => [p.id, p.id]));
    const cur = existing.get(nb.id);
    if (cur) {
      const mode = decide ? await decide(nb, cur) : 'copy';
      if (!mode) continue;
      if (mode === 'replace') await db.deleteNotebook(nb.id);
      else { nid = uid(); pmap = new Map(pages.map(p => [p.id, uid()])); nb.name += ' (สำเนา)'; }
    }
    const np = await inflatePages(pages, nid, pmap);
    await db.savePagesAndNotebook(np, { ...nb, id: nid, pages: (nb.pages || []).map(x => pmap.get(x)).filter(Boolean), fileSavedAt: nb.updated, updated: nb.updated || Date.now() });
    ids.push(nid);
  }
  return ids;
}

function askReplace(nb, cur) {
  return new Promise((res) => {
    let r = null;
    const newer = (nb.updated || 0) >= (cur.updated || 0);
    const body = h('div', {},
      h('p', { style: { margin: '0 0 8px' } }, `ในแอปมีสมุด "${cur.name}" เล่มนี้อยู่แล้ว`),
      h('div', { class: 'card', style: { marginBottom: '6px' } },
        h('div', { class: 'row' }, h('span', {}, 'ฉบับในไฟล์'), h('b', {}, fmtDate(nb.updated || 0) + (newer ? ' · ใหม่กว่า' : ''))),
        h('div', { class: 'row' }, h('span', {}, 'ฉบับในแอป'), h('b', {}, fmtDate(cur.updated || 0) + (!newer ? ' · ใหม่กว่า' : '')))));
    dialog('เปิดไฟล์สมุด', body, [
      { label: 'เปิดเป็นสมุดใหม่', action: () => { r = 'copy'; } },
      { label: 'ใช้ฉบับในไฟล์', cls: newer ? 'prim' : 'sec', flex: 1.4, action: () => { r = 'replace'; } },
    ], { onClose: () => res(r) });
  });
}

// ---------- linked file handles (Chrome) ----------
export async function getHandle(nbId) { try { return (await db.get('kv', 'file:' + nbId))?.v || null; } catch { return null; } }
export async function setHandle(nbId, handle) { try { if (handle) await db.put('kv', { k: 'file:' + nbId, v: handle }); else await db.del('kv', 'file:' + nbId); } catch (e) { console.warn(e); } }
export async function handlePermission(handle, ask) {
  try {
    const o = { mode: 'readwrite' };
    if ((await handle.queryPermission(o)) === 'granted') return true;
    if (ask) return (await handle.requestPermission(o)) === 'granted';
  } catch { }
  return false;
}
export async function writeHandle(handle, text) {
  const w = await handle.createWritable(); await w.write(new Blob([text], { type: 'application/json' })); await w.close();
}
export const fileNameFor = (nb) => (nb.name || 'สมุด').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 60) + '.senkid.json';

// Save a notebook as a file. Returns 'linked' | 'shared' | 'downloaded' | null
export async function saveNotebookFile(nb, livePages, { forceNew = false, onStage } = {}) {
  const data = await buildBackup([nb.id], livePages);
  const text = JSON.stringify(data);
  onStage && onStage();
  const name = fileNameFor(nb);
  if (canLinkFiles()) {
    let handle = forceNew ? null : await getHandle(nb.id);
    if (handle && !(await handlePermission(handle, true))) handle = null;
    if (!handle) {
      try { handle = await window.showSaveFilePicker({ suggestedName: name, types: FILE_TYPES }); }
      catch (e) { if (e.name === 'AbortError') return null; handle = null; }
    }
    if (handle) { await writeHandle(handle, text); await setHandle(nb.id, handle); return { how: 'linked', name: handle.name }; }
  }
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nb.name }); return { how: 'shared', name }; }
    catch (e) { if (e.name === 'AbortError') return null; }
  }
  const d = new Date(), q = (n) => String(n).padStart(2, '0');
  const ascii = `senkid-notebook-${d.getFullYear()}${q(d.getMonth() + 1)}${q(d.getDate())}-${q(d.getHours())}${q(d.getMinutes())}.senkid.json`;
  downloadBlob(file, ascii);
  return { how: 'downloaded', name: ascii };
}

// Open a notebook file. Returns notebook id to open (or null)
export async function openNotebookFile(prog) {
  let text, handle = null;
  if (canLinkFiles()) {
    try { [handle] = await window.showOpenFilePicker({ types: OPEN_TYPES, multiple: false }); const f = await handle.getFile(); if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') return { pdf: f }; text = await f.text(); }
    catch (e) { if (e.name === 'AbortError') return null; handle = null; }
  }
  if (text == null) {
    const f = await pickFile('.json,.pdf,application/json,application/pdf'); if (!f) return null;
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') return { pdf: f };
    text = await f.text();
  }
  prog && prog('กำลังอ่านไฟล์…', `${Math.round(text.length / 1e6 * 10) / 10} MB`);
  let data; try { data = parseBackup(text); } catch { toast('ไฟล์นี้ไม่ใช่สมุดของเส้นคิด', 3000, 'warn'); return null; }
  const ids = await storeFromBackup(data, async (nb, cur) => { const b = document.querySelector('.busy'); if (b) b.style.display = 'none'; const r = await askReplace(nb, cur); if (b) b.style.display = ''; return r; }, (i, n) => prog && prog('กำลังนำสมุดเข้าแอป…', `เล่มที่ ${i} จาก ${n}`, i / n));
  if (!ids.length) return null;
  if (handle && ids.length === 1) await setHandle(ids[0], handle);
  if (ids.length > 1) { toast(`เปิดไฟล์แล้ว ได้สมุด ${ids.length} เล่ม`); return { many: ids }; }
  return { id: ids[0] };
}
