// Direct link between the home-screen app and a Safari student window on the same iPad.
// The two can't share a BroadcastChannel, so they pair once through a tiny file in the teacher's
// Google Drive (offer/answer) and then talk peer-to-peer on the device over a WebRTC data channel.
import { driveFind, driveDownload, driveUpload, tokenOk } from './sync.js';

const CHUNK = 16000, HDR = 12;
const te = new TextEncoder(), td = new TextDecoder();

// ---- message (de)serialisation: JSON + binary attachments (Blob, Float32Array) ----
async function encode(m) {
  const bins = [];
  const walk = (v) => {
    if (v instanceof Blob) { bins.push(v); return { __bin: bins.length - 1, kind: 'blob', type: v.type }; }
    if (v instanceof Float32Array) { bins.push(v); return { __bin: bins.length - 1, kind: 'f32' }; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k in v) { const w = walk(v[k]); if (w !== undefined) o[k] = w; } return o; }
    return v;
  };
  const body = walk(m);
  const bufs = await Promise.all(bins.map(async b => b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
  const json = te.encode(JSON.stringify({ body, sizes: bufs.map(b => b.byteLength) }));
  const out = new Uint8Array(4 + json.byteLength + bufs.reduce((a, b) => a + b.byteLength, 0));
  new DataView(out.buffer).setUint32(0, json.byteLength); out.set(json, 4);
  let o = 4 + json.byteLength; for (const b of bufs) { out.set(b, o); o += b.byteLength; }
  return out;
}
function decode(u8) {
  const n = new DataView(u8.buffer, u8.byteOffset).getUint32(0);
  const { body, sizes } = JSON.parse(td.decode(u8.subarray(4, 4 + n)));
  const bins = []; let o = 4 + n; for (const s of sizes) { bins.push(u8.slice(o, o + s)); o += s; }
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      if ('__bin' in v) { const b = bins[v.__bin]; return v.kind === 'f32' ? new Float32Array(b.buffer, 0, b.byteLength / 4) : new Blob([b], { type: v.type || '' }); }
      const r = {}; for (const k in v) r[k] = walk(v[k]); return r;
    }
    return v;
  };
  return walk(body);
}

export class RtcLink {
  constructor({ onMsg, onState } = {}) { this.onMsg = onMsg; this.onState = onState; this.pc = null; this.dc = null; this.open = false; this.msgId = 1; this.parts = new Map(); this.q = Promise.resolve(); }
  _pc() {
    this.close();
    const pc = this.pc = new RTCPeerConnection({ iceServers: [] }); // same device: host candidates are enough
    pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this._setOpen(false); };
    return pc;
  }
  _bind(dc) {
    this.dc = dc; dc.binaryType = 'arraybuffer';
    dc.onopen = () => this._setOpen(true); dc.onclose = () => this._setOpen(false); dc.onerror = (e) => console.warn('rtc dc', e);
    dc.onmessage = (e) => this._chunk(new Uint8Array(e.data));
  }
  _setOpen(v) { if (this.open === v) return; this.open = v; this.onState?.(v); }
  _chunk(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset), id = dv.getUint32(0), idx = dv.getUint32(4), total = dv.getUint32(8);
    const body = u8.subarray(HDR);
    if (total === 1) { this._deliver(body); return; }
    let p = this.parts.get(id); if (!p) { p = { got: 0, parts: new Array(total) }; this.parts.set(id, p); }
    p.parts[idx] = body; p.got++;
    if (p.got === total) { this.parts.delete(id); const len = p.parts.reduce((a, b) => a + b.byteLength, 0), all = new Uint8Array(len); let o = 0; for (const b of p.parts) { all.set(b, o); o += b.byteLength; } this._deliver(all); }
  }
  _deliver(u8) { try { this.onMsg?.(decode(u8)); } catch (e) { console.warn('rtc decode', e); } }
  send(m) {
    if (!this.open) return;
    this.q = this.q.then(async () => {
      if (!this.open) return;
      const data = await encode(m), id = this.msgId++, total = Math.max(1, Math.ceil(data.byteLength / CHUNK));
      for (let i = 0; i < total; i++) {
        const part = data.subarray(i * CHUNK, (i + 1) * CHUNK), f = new Uint8Array(HDR + part.byteLength), dv = new DataView(f.buffer);
        dv.setUint32(0, id); dv.setUint32(4, i); dv.setUint32(8, total); f.set(part, HDR);
        while (this.dc && this.dc.bufferedAmount > 4e6) await new Promise(r => setTimeout(r, 20)); // don't flood a slow channel
        if (!this.open) return; this.dc.send(f);
      }
    }).catch(e => console.warn('rtc send', e));
  }
  close() { try { this.dc?.close(); } catch { } try { this.pc?.close(); } catch { } this.dc = this.pc = null; this._setOpen(false); }
}

function iceDone(pc, ms = 2500) {
  return new Promise(res => { if (pc.iceGatheringState === 'complete') return res(); const t = setTimeout(res, ms); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }; });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function pairFile() { return driveFind('pair'); }
async function savePair(obj) { const f = await pairFile(); return driveUpload(f?.id || null, 'pair.json', { kind: 'pair', id: 'pair' }, obj); }
async function readPair() { const f = await pairFile(); return f ? driveDownload(f.id) : null; }

export const canPair = () => typeof RTCPeerConnection !== 'undefined' && tokenOk();

// teacher (home-screen app): publish an offer, then wait for the Safari window's answer
export async function teacherPair(link, { onStatus, timeoutMs = 180e3 } = {}) {
  const pc = link._pc(); link._bind(pc.createDataChannel('senkid', { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer()); await iceDone(pc);
  const t = Date.now();
  await savePair({ offer: pc.localDescription.sdp, t, ans: null });
  onStatus?.('offer');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && link.pc === pc) {
    await sleep(1500);
    if (document.visibilityState === 'hidden') continue; // iPad pauses us in the background anyway
    let j = null; try { j = await readPair(); } catch (e) { console.warn('pair poll', e); continue; }
    if (j && j.t === t && j.ans) { await pc.setRemoteDescription({ type: 'answer', sdp: j.ans }); onStatus?.('answered'); return true; }
  }
  return false;
}

// student (Safari window opened with #pair): take the newest offer, answer it
export async function studentPair(link, { onStatus, timeoutMs = 180e3, skipBefore = 0 } = {}) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < timeoutMs) {
    let j = null; try { j = await readPair(); } catch (e) { console.warn('pair poll', e); onStatus?.('error', e); await sleep(3000); continue; }
    if (j && j.offer && !j.ans && Date.now() - j.t < 10 * 60e3 && j.t !== last && j.t > skipBefore) {
      last = j.t;
      const pc = link._pc(); pc.ondatachannel = (e) => link._bind(e.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp: j.offer });
      await pc.setLocalDescription(await pc.createAnswer()); await iceDone(pc);
      await savePair({ ...j, ans: pc.localDescription.sdp });
      onStatus?.('answered');
      return j.t;
    }
    onStatus?.('waiting');
    await sleep(1500);
  }
  return false;
}
