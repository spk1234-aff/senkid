// IndexedDB storage: notebooks, pages, recordings (meta + chunks)
const NAME = 'senkid', VER = 4;
let dbp = null;
// change tracking for cloud sync: every normal write stamps `updated`; writes coming *from* sync are quiet
let quiet = false; export function setQuiet(v) { quiet = v; }
const listeners = new Set(); export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed(kind) { if (quiet) return; for (const fn of listeners) try { fn(kind); } catch { } }

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' }).createIndex('nb', 'nb');
      if (!db.objectStoreNames.contains('recs')) db.createObjectStore('recs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['rec', 'seq'] }).createIndex('rec', 'rec');
      // page snapshots (ink history for "กู้เส้นที่หาย"): { id, pid, nb, t, n, strokes }
      if (!db.objectStoreNames.contains('snaps')) db.createObjectStore('snaps', { keyPath: 'id' }).createIndex('pid', 'pid');
    };
    r.onsuccess = () => {
      const db = r.result;
      // iPadOS closes idle connections (background, memory pressure) and a version change elsewhere closes them too:
      // forget this handle so the next call opens a fresh one instead of failing with "connection is closing"
      db.onclose = () => { if (dbp && dbp._db === db) dbp = null; };
      db.onversionchange = () => { try { db.close(); } catch { } if (dbp && dbp._db === db) dbp = null; };
      dbp._db = db; res(db);
    };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
  return dbp;
}

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function tx(stores, mode = 'readonly') {
  for (let tries = 0; ; tries++) {
    const db = await openDB();
    try { return db.transaction(stores, mode); }
    catch (e) { if (tries >= 2 || !(e && (e.name === 'InvalidStateError' || /closing/i.test(e.message || '')))) throw e; dbp = null; await new Promise(r => setTimeout(r, 150)); }
  }
}
function done(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort')); }); }

export async function getAll(store) { const t = await tx([store]); return req(t.objectStore(store).getAll()); }
export async function get(store, key) { const t = await tx([store]); return req(t.objectStore(store).get(key)); }
export async function put(store, obj) { if (!quiet && store === 'notebooks') obj.updated = Date.now(); const t = await tx([store], 'readwrite'); t.objectStore(store).put(obj); await done(t); if (store === 'notebooks' || store === 'pdfs') changed(store); }
export async function putQuiet(store, obj) { const t = await tx([store], 'readwrite'); t.objectStore(store).put(obj); return done(t); }
export async function putMany(store, arr) { const t = await tx([store], 'readwrite'); const s = t.objectStore(store); for (const o of arr) s.put(o); return done(t); }
export async function del(store, key) { const t = await tx([store], 'readwrite'); t.objectStore(store).delete(key); return done(t); }
export async function delMany(store, keys) { const t = await tx([store], 'readwrite'); const s = t.objectStore(store); for (const k of keys) s.delete(k); return done(t); }

export async function pagesOf(nbId) { const t = await tx(['pages']); return req(t.objectStore('pages').index('nb').getAll(nbId)); }

export async function savePagesAndNotebook(pages, nb) {
  const t = await tx(['pages', 'notebooks'], 'readwrite');
  const ps = t.objectStore('pages'), now = Date.now();
  for (const p of pages) { if (!quiet) p.updated = now; ps.put(p); }
  if (nb) { if (!quiet) nb.updated = Math.max(nb.updated || 0, now); t.objectStore('notebooks').put(nb); }
  await done(t); changed('pages');
}

export async function deleteNotebook(id) {
  const pages = await pagesOf(id);
  const t = await tx(['pages', 'notebooks'], 'readwrite');
  for (const p of pages) t.objectStore('pages').delete(p.id);
  t.objectStore('notebooks').delete(id);
  await done(t);
  if (!quiet) { // tombstone so the other devices delete it too
    const rec = (await get('kv', 'sync:deleted'))?.v || {}; rec[id] = Date.now();
    const t2 = await tx(['kv'], 'readwrite'); t2.objectStore('kv').put({ k: 'sync:deleted', v: rec }); await done(t2);
    changed('notebooks');
  }
}

// recording chunks
export async function addChunk(rec, seq, blob) { const t = await tx(['chunks'], 'readwrite'); t.objectStore('chunks').put({ rec, seq, blob }); return done(t); }
export async function chunksOf(rec) { const t = await tx(['chunks']); return req(t.objectStore('chunks').index('rec').getAll(rec)); }
export async function deleteRec(rec) {
  const t0 = await tx(['chunks']);
  const keys = await req(t0.objectStore('chunks').index('rec').getAllKeys(rec));
  const t = await tx(['chunks', 'recs'], 'readwrite');
  for (const k of keys) t.objectStore('chunks').delete(k);
  t.objectStore('recs').delete(rec);
  return done(t);
}

export async function snapsOf(pid) { const t = await tx(['snaps']); const a = await req(t.objectStore('snaps').index('pid').getAll(pid)); return a.sort((x, y) => y.t - x.t); }
// a deletion journal + bounded page snapshots, so lost ink can be explained and brought back
const JOURNAL = 'journal';
export async function journal(entry) {
  try { const j = (await get('kv', JOURNAL))?.v || []; j.push({ t: Date.now(), ...entry }); while (j.length > 400) j.shift(); await putQuiet('kv', { k: JOURNAL, v: j }); } catch { }
}
export async function journalRead() { return (await get('kv', JOURNAL))?.v || []; }
export async function snapshot(page, why) {
  try {
    const list = await snapsOf(page.id);
    const n = (page.strokes || []).length;
    if (list[0] && Date.now() - list[0].t < 45e3 && why !== 'before-restore') { // fold quick successive edits into one snapshot
      if (list[0].n === n) return;
    }
    const id = page.id + ':' + Date.now();
    const strokes = (page.strokes || []).map(s => s.pts && !(s.pts instanceof Float32Array) ? { ...s, pts: Float32Array.from(s.pts) } : s);
    await putQuiet('snaps', { id, pid: page.id, nb: page.nb, t: Date.now(), n, why, strokes });
    const old = list.filter((x, i) => i >= 29 || Date.now() - x.t > 21 * 86400e3).map(x => x.id);
    if (old.length) await delMany('snaps', old);
  } catch (e) { console.warn('snapshot', e); }
}
