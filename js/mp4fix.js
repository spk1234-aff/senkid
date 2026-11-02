// Turn a fragmented MP4 (what Safari/Chrome MediaRecorder writes) into a normal MP4:
// players then know the real length and can seek / replay. Sample data is not copied —
// the result is a Blob made of slices of the original.
const CONT = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf', 'udta']);
const T = (s) => [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
const typeAt = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);

function parse(u8, start, end) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o), hdr = 8; const type = typeAt(u8, o + 4);
    if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    const b = { type };
    if (CONT.has(type)) b.kids = parse(u8, o + hdr, o + size); else b.data = u8.subarray(o + hdr, o + size);
    b.off = o; out.push(b); o += size;
  }
  return out;
}
const find = (b, ...path) => { let cur = b; for (const t of path) { cur = cur?.kids?.find(k => k.type === t); } return cur; };
function ser(b) {
  const parts = b.kids ? b.kids.map(ser) : [b.data];
  const len = 8 + parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(len), dv = new DataView(out.buffer);
  dv.setUint32(0, len); out.set(T(b.type), 4); let o = 8; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const full = (type, version, flags, bytes) => { const d = new Uint8Array(4 + bytes.length); d[0] = version; d[1] = flags >> 16; d[2] = flags >> 8; d[3] = flags; d.set(bytes, 4); return { type, data: d }; };
function u32s(arr) { const o = new Uint8Array(arr.length * 4), dv = new DataView(o.buffer); arr.forEach((v, i) => dv.setUint32(i * 4, v >>> 0)); return o; }

async function readAt(blob, o, n) { return new Uint8Array(await blob.slice(o, o + n).arrayBuffer()); }

export async function defragMp4(blob) {
  // 1) walk top-level boxes
  let o = 0, moov = null, ftyp = null; const moofs = [];
  while (o + 8 <= blob.size) {
    const h = await readAt(blob, o, 16), dv = new DataView(h.buffer);
    let size = dv.getUint32(0), hdr = 8; const type = typeAt(h, 4);
    if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16; } else if (size === 0) size = blob.size - o;
    if (size < 8) break;
    if (type === 'moov' || type === 'moof' || type === 'ftyp') {
      const u8 = await readAt(blob, o, size); const b = parse(u8, 0, u8.length)[0];
      if (type === 'moov') moov = b; else if (type === 'ftyp') ftyp = b; else moofs.push({ b, off: o });
    }
    o += size;
  }
  if (!moov || !moofs.length) return null; // already a normal MP4 (or not MP4)
  // 2) tracks + defaults
  const tracks = new Map();
  for (const trak of moov.kids.filter(k => k.type === 'trak')) {
    const tk = find(trak, 'tkhd').data, v = tk[0], id = new DataView(tk.buffer, tk.byteOffset).getUint32(v ? 20 : 12);
    const hd = find(trak, 'mdia', 'hdlr').data, handler = typeAt(hd, 8);
    const md = find(trak, 'mdia', 'mdhd').data, mv = md[0], mdv = new DataView(md.buffer, md.byteOffset), ts = mdv.getUint32(mv ? 20 : 12);
    tracks.set(id, { id, trak, handler, ts, def: { dur: 0, size: 0, flags: 0 }, sizes: [], durs: [], cts: [], sync: [], chunks: [], first: null, end: 0 });
  }
  for (const tx of (find(moov, 'mvex')?.kids || []).filter(k => k.type === 'trex')) {
    const dv = new DataView(tx.data.buffer, tx.data.byteOffset), t = tracks.get(dv.getUint32(4));
    if (t) t.def = { dur: dv.getUint32(12), size: dv.getUint32(16), flags: dv.getUint32(20) };
  }
  // 3) samples from every fragment
  for (const { b: moof, off } of moofs) {
    for (const traf of moof.kids.filter(k => k.type === 'traf')) {
      const th = find(traf, 'tfhd').data, dv = new DataView(th.buffer, th.byteOffset), fl = (th[1] << 16) | (th[2] << 8) | th[3];
      const t = tracks.get(dv.getUint32(4)); if (!t) continue;
      let p = 8, base = off; const d = { ...t.def };
      if (fl & 1) { base = Number(dv.getBigUint64(p)); p += 8; }
      if (fl & 2) p += 4;
      if (fl & 8) { d.dur = dv.getUint32(p); p += 4; }
      if (fl & 0x10) { d.size = dv.getUint32(p); p += 4; }
      if (fl & 0x20) { d.flags = dv.getUint32(p); p += 4; }
      const tf = find(traf, 'tfdt');
      if (tf) { const tv = new DataView(tf.data.buffer, tf.data.byteOffset), dt = tf.data[0] ? Number(tv.getBigUint64(4)) : tv.getUint32(4); if (t.first == null) t.first = dt; }
      let next = null;
      for (const tr of traf.kids.filter(k => k.type === 'trun')) {
        const r = new DataView(tr.data.buffer, tr.data.byteOffset), rv = tr.data[0], rf = (tr.data[1] << 16) | (tr.data[2] << 8) | tr.data[3];
        const n = r.getUint32(4); let q = 8, dataOff = next ?? base, firstFlags = null;
        if (rf & 1) { dataOff = base + r.getInt32(q); q += 4; }
        if (rf & 4) { firstFlags = r.getUint32(q); q += 4; }
        let bytes = 0;
        for (let i = 0; i < n; i++) {
          const du = rf & 0x100 ? r.getUint32((q += 4) - 4) : d.dur;
          const sz = rf & 0x200 ? r.getUint32((q += 4) - 4) : d.size;
          let sf = rf & 0x400 ? r.getUint32((q += 4) - 4) : d.flags; if (i === 0 && firstFlags != null) sf = firstFlags;
          const co = rf & 0x800 ? (rv ? r.getInt32((q += 4) - 4) : r.getUint32((q += 4) - 4)) : 0;
          t.durs.push(du); t.sizes.push(sz); t.cts.push(co); t.sync.push(!((sf >> 16) & 1)); bytes += sz; t.end += du;
        }
        if (n) t.chunks.push({ src: dataOff, n, bytes });
        next = dataOff + bytes;
      }
    }
  }
  const list = [...tracks.values()].filter(t => t.sizes.length);
  if (!list.length) return null;
  // pause/resume: Safari can stretch the frame before a pause over the whole gap — cap odd durations
  for (const t of list) {
    const sorted = t.durs.slice().sort((x, y) => x - y), med = sorted[sorted.length >> 1] || 1;
    t.end = 0; t.durs = t.durs.map(d => { const v = d > Math.max(med * 8, t.ts) ? med : d; t.end += v; return v; });
  }
  // 4) output layout: one chunk per fragment run, in source order
  const all = []; for (const t of list) for (const c of t.chunks) { c.t = t; all.push(c); }
  all.sort((a, b) => a.src - b.src);
  const mvhd = find(moov, 'mvhd'), mvv = new DataView(mvhd.data.buffer, mvhd.data.byteOffset), movTS = mvv.getUint32(mvhd.data[0] ? 20 : 12);
  const t0 = Math.min(...list.map(t => (t.first || 0) / t.ts));
  const build = (dataStart) => {
    let pos = dataStart; for (const c of all) { c.out = pos; pos += c.bytes; }
    let movieDur = 0;
    const traks = list.map(t => {
      const stts = []; for (const du of t.durs) { const l = stts[stts.length - 1]; if (l && l[1] === du) l[0]++; else stts.push([1, du]); }
      const stsc = []; t.chunks.forEach((c, i) => { const l = stsc[stsc.length - 1]; if (!l || l[1] !== c.n) stsc.push([i + 1, c.n, 1]); });
      const kids = [find(t.trak, 'mdia', 'minf', 'stbl', 'stsd'),
        full('stts', 0, 0, u32s([stts.length, ...stts.flat()])),
        full('stsc', 0, 0, u32s([stsc.length, ...stsc.flat()])),
        full('stsz', 0, 0, u32s([0, t.sizes.length, ...t.sizes]))];
      if (t.cts.some(x => x)) { const cc = []; for (const x of t.cts) { const l = cc[cc.length - 1]; if (l && l[1] === x) l[0]++; else cc.push([1, x]); } kids.push(full('ctts', t.cts.some(x => x < 0) ? 1 : 0, 0, u32s([cc.length, ...cc.flat()]))); }
      if (t.handler === 'vide' && t.sync.some(s => !s)) { const ss = []; t.sync.forEach((s, i) => s && ss.push(i + 1)); kids.push(full('stss', 0, 0, u32s([ss.length, ...ss]))); }
      const co = new Uint8Array(4 + t.chunks.length * 8), cv = new DataView(co.buffer); cv.setUint32(0, t.chunks.length); t.chunks.forEach((c, i) => cv.setBigUint64(4 + i * 8, BigInt(c.out)));
      kids.push(full('co64', 0, 0, co));
      const mediaDur = t.end, tkDur = Math.round(mediaDur / t.ts * movTS), delay = Math.round(((t.first || 0) / t.ts - t0) * movTS);
      movieDur = Math.max(movieDur, tkDur + delay);
      const trak = structuredCloneBox(t.trak);
      find(trak, 'mdia', 'minf').kids = find(trak, 'mdia', 'minf').kids.map(k => k.type === 'stbl' ? { type: 'stbl', kids } : k);
      setDur(find(trak, 'mdia', 'mdhd').data, mediaDur);
      setDur(find(trak, 'tkhd').data, tkDur + delay, true);
      trak.kids = trak.kids.filter(k => k.type !== 'edts');
      const el = delay > 0 ? [[delay, -1], [tkDur, 0]] : [[tkDur, 0]];
      const eb = new Uint8Array(4 + el.length * 12), ev = new DataView(eb.buffer); ev.setUint32(0, el.length);
      el.forEach(([d, m], i) => { ev.setUint32(4 + i * 12, d); ev.setInt32(8 + i * 12, m); ev.setUint32(12 + i * 12, 0x10000); });
      trak.kids.splice(1, 0, { type: 'edts', kids: [full('elst', 0, 0, eb)] });
      return trak;
    });
    const mv = { type: 'mvhd', data: mvhd.data.slice() }; setDur(mv.data, movieDur);
    const out = { type: 'moov', kids: [mv, ...traks, ...moov.kids.filter(k => !['mvhd', 'trak', 'mvex'].includes(k.type))] };
    return ser(out);
  };
  const ft = ser({ type: 'ftyp', data: new Uint8Array([...T('isom'), 0, 0, 2, 0, ...T('isom'), ...T('iso2'), ...T('avc1'), ...T('mp41')]) });
  let mo = build(0); mo = build(ft.length + mo.length + 16);
  const total = all.reduce((a, c) => a + c.bytes, 0), mh = new Uint8Array(16), mdv = new DataView(mh.buffer);
  mdv.setUint32(0, 1); mh.set(T('mdat'), 4); mdv.setBigUint64(8, BigInt(16 + total));
  return new Blob([ft, mo, mh, ...all.map(c => blob.slice(c.src, c.src + c.bytes))], { type: 'video/mp4' });
}
function structuredCloneBox(b) { return b.kids ? { type: b.type, kids: b.kids.map(structuredCloneBox) } : { type: b.type, data: b.data.slice() }; }
function setDur(d, v, tkhd) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (d[0] === 1) dv.setBigUint64(tkhd ? 28 : 24, BigInt(v)); else dv.setUint32(tkhd ? 20 : 16, Math.min(v, 0xFFFFFFFF));
}
