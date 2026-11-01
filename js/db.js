// IndexedDB storage: notebooks, pages, recordings (meta + chunks)
const NAME = 'senkid', VER = 3;
let dbp = null;

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
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
  return dbp;
}

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function tx(stores, mode = 'readonly') { const db = await openDB(); return db.transaction(stores, mode); }
function done(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort')); }); }

export async function getAll(store) { const t = await tx([store]); return req(t.objectStore(store).getAll()); }
export async function get(store, key) { const t = await tx([store]); return req(t.objectStore(store).get(key)); }
export async function put(store, obj) { const t = await tx([store], 'readwrite'); t.objectStore(store).put(obj); return done(t); }
export async function putMany(store, arr) { const t = await tx([store], 'readwrite'); const s = t.objectStore(store); for (const o of arr) s.put(o); return done(t); }
export async function del(store, key) { const t = await tx([store], 'readwrite'); t.objectStore(store).delete(key); return done(t); }
export async function delMany(store, keys) { const t = await tx([store], 'readwrite'); const s = t.objectStore(store); for (const k of keys) s.delete(k); return done(t); }

export async function pagesOf(nbId) { const t = await tx(['pages']); return req(t.objectStore('pages').index('nb').getAll(nbId)); }

export async function savePagesAndNotebook(pages, nb) {
  const t = await tx(['pages', 'notebooks'], 'readwrite');
  const ps = t.objectStore('pages');
  for (const p of pages) ps.put(p);
  if (nb) t.objectStore('notebooks').put(nb);
  return done(t);
}

export async function deleteNotebook(id) {
  const pages = await pagesOf(id);
  const t = await tx(['pages', 'notebooks'], 'readwrite');
  for (const p of pages) t.objectStore('pages').delete(p.id);
  t.objectStore('notebooks').delete(id);
  return done(t);
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
