// Live link between the iPad (guest, sends strokes) and the Mac "ห้องอัด" (host, records).
// Signaling goes through Firestore (project sirearth-class, anonymous sign-in); the strokes themselves travel over a
// WebRTC data channel (direct, usually on the same Wi-Fi). If the channel cannot open within ~12 s, messages are relayed
// through Firestore instead, so it still works — just with more latency and quota use.
// For automated tests the same code runs over a BroadcastChannel "signal" (?studio_signal=local).

const FB = { apiKey: 'AIzaSyCSGxk3LxnkbXgHyXxGxXlcrC9TJEJwKCM', authDomain: 'sirearth-class.firebaseapp.com', projectId: 'sirearth-class', appId: '1:991820377436:web:0efa36ba2dfa6e1c466599' };
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const ROOT = 'senkid_rooms';
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const CHUNK = 48 * 1024; // data-channel messages stay well under Chrome's/WebKit's limits
const RELAY_AFTER = 12000;

function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลด ' + src + ' ไม่ได้')); document.head.appendChild(s); }); }

// ---------- signal backends: put/get/add/watch over a tiny path model ----------
class FirestoreSignal {
  async init() {
    await loadScript(SDK + 'firebase-app-compat.js'); await loadScript(SDK + 'firebase-auth-compat.js'); await loadScript(SDK + 'firebase-firestore-compat.js');
    const fb = window.firebase; this.app = fb.apps.find(a => a.name === 'senkid-studio') || fb.initializeApp(FB, 'senkid-studio');
    this.auth = this.app.auth(); this.db = this.app.firestore(); this.unsubs = [];
    if (!this.auth.currentUser) { try { await this.auth.signInAnonymously(); } catch (e) { throw new Error('เข้าระบบ Firebase ไม่ได้ (' + (e.code || e.message) + ') · ต้องเปิด Anonymous sign-in ในโปรเจกต์ sirearth-class'); } }
    this.uid = this.auth.currentUser.uid;
  }
  doc(path) { return this.db.doc(path); }
  col(path) { return this.db.collection(path); }
  async put(path, obj) { await this.doc(path).set({ ...obj, _t: Date.now() }); }
  async get(path) { const s = await this.doc(path).get(); return s.exists ? s.data() : null; }
  async add(path, obj) { await this.col(path).add({ ...obj, _t: Date.now() }); }
  watchDoc(path, cb) { const u = this.doc(path).onSnapshot(s => { if (s.exists) cb(s.data()); }, e => console.warn('watch', path, e)); this.unsubs.push(u); return u; }
  watchAdds(path, cb) { const u = this.col(path).orderBy('_t').onSnapshot(s => { s.docChanges().forEach(c => { if (c.type === 'added') cb(c.doc.data(), c.doc.id); }); }, e => console.warn('watch', path, e)); this.unsubs.push(u); return u; }
  async wipe(path) { // delete a room and everything under it (best effort, 400 per batch)
    const subs = ['sig', 'candH', 'candG', 'ev'];
    for (const sub of subs) { for (;;) { const s = await this.col(path + '/' + sub).limit(400).get(); if (s.empty) break; const b = this.db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit(); if (s.size < 400) break; } }
    await this.doc(path).delete().catch(() => { });
  }
  close() { this.unsubs.forEach(u => { try { u(); } catch { } }); this.unsubs = []; }
}

class LocalSignal { // same-origin pages in one browser: for tests and for trying both roles on one computer
  async init() { this.bc = new BroadcastChannel('senkid-studio-signal'); this.store = new Map(); this.lists = new Map(); this.docW = new Map(); this.addW = new Map(); this.uid = 'local-' + Math.random().toString(36).slice(2, 8);
    this.bc.onmessage = (e) => { const m = e.data; if (m.op === 'put') { this.store.set(m.path, m.obj); (this.docW.get(m.path) || []).forEach(cb => cb(m.obj)); } else if (m.op === 'add') { if (!this.lists.has(m.path)) this.lists.set(m.path, []); this.lists.get(m.path).push(m.obj); (this.addW.get(m.path) || []).forEach(cb => cb(m.obj, m.id)); } else if (m.op === 'get' && this.store.has(m.path)) this.bc.postMessage({ op: 'put', path: m.path, obj: this.store.get(m.path) }); }; }
  async put(path, obj) { obj = { ...obj, _t: Date.now() }; this.store.set(path, obj); this.bc.postMessage({ op: 'put', path, obj }); (this.docW.get(path) || []).forEach(cb => cb(obj)); }
  async get(path) { if (this.store.has(path)) return this.store.get(path); this.bc.postMessage({ op: 'get', path }); await new Promise(r => setTimeout(r, 150)); return this.store.get(path) || null; }
  async add(path, obj) { obj = { ...obj, _t: Date.now() }; const id = Math.random().toString(36).slice(2); this.bc.postMessage({ op: 'add', path, obj, id }); }
  watchDoc(path, cb) { if (!this.docW.has(path)) this.docW.set(path, []); this.docW.get(path).push(cb); if (this.store.has(path)) cb(this.store.get(path)); else this.bc.postMessage({ op: 'get', path }); return () => { }; }
  watchAdds(path, cb) { if (!this.addW.has(path)) this.addW.set(path, []); this.addW.get(path).push(cb); (this.lists.get(path) || []).forEach(o => cb(o)); return () => { }; }
  async wipe() { }
  close() { try { this.bc.close(); } catch { } }
}

export function makeSignal() { return new URLSearchParams(location.search).get('studio_signal') === 'local' ? new LocalSignal() : new FirestoreSignal(); }

// ---------- peer: one side of the link ----------
class Peer {
  constructor(role, code, sig) {
    this.role = role; this.code = code; this.sig = sig; this.path = ROOT + '/' + code;
    this.handlers = []; this.status = 'connecting'; this.onStatus = null; this.inbox = new Map(); this.seq = 0; this.relay = false; this.closed = false;
    this.pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc.oniceconnectionstatechange = () => { const s = this.pc.iceConnectionState; if (s === 'failed' || s === 'disconnected') this.setStatus(this.relay ? 'relay' : 'connecting'); };
    this.pc.onicecandidate = (e) => { if (e.candidate) this.sig.add(this.path + (role === 'host' ? '/candH' : '/candG'), { c: JSON.stringify(e.candidate) }).catch(() => { }); };
    this.relayTimer = setTimeout(() => { if (!this.dcOpen) this.startRelay(); }, RELAY_AFTER);
  }
  setStatus(s) { if (this.status === s) return; this.status = s; this.onStatus?.(s); }
  attachDC(dc) {
    this.dc = dc; dc.binaryType = 'arraybuffer';
    dc.onopen = () => { this.dcOpen = true; clearTimeout(this.relayTimer); this.setStatus('direct'); this.flush(); };
    dc.onclose = () => { this.dcOpen = false; if (!this.closed) { this.setStatus('connecting'); this.startRelay(); } };
    dc.onmessage = (e) => this.onChunk(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));
  }
  startRelay() { // fall back to shuttling messages through the signal backend
    if (this.relay || this.closed) return; this.relay = true; this.setStatus('relay');
    this.sig.watchAdds(this.path + '/ev', (d) => { if (d.from !== this.role) this.onChunk(d.p); });
    this.flush();
  }
  // outgoing: JSON → chunks → channel (or relay)
  send(msg) {
    if (this.closed) return;
    const s = JSON.stringify(msg), id = ++this.seq, n = Math.ceil(s.length / CHUNK) || 1;
    for (let i = 0; i < n; i++) this.queue(JSON.stringify({ _c: id, _i: i, _n: n, _d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  queue(part) { (this.outq = this.outq || []).push(part); this.flush(); }
  flush() {
    if (!this.outq?.length) return;
    if (this.dcOpen) { while (this.outq.length) { const p = this.outq.shift(); try { if (this.dc.bufferedAmount > 8e6) { this.outq.unshift(p); setTimeout(() => this.flush(), 50); return; } this.dc.send(p); } catch (e) { this.outq.unshift(p); return; } } }
    else if (this.relay) { const batch = this.outq.splice(0, 8); batch.forEach(p => this.sig.add(this.path + '/ev', { from: this.role, p }).catch(() => { })); if (this.outq.length) setTimeout(() => this.flush(), 60); }
  }
  onChunk(txt) {
    let c; try { c = JSON.parse(txt); } catch { return; }
    if (c._n === 1) return this.deliver(c._d);
    const key = c._c; let e = this.inbox.get(key); if (!e) { e = { parts: new Array(c._n), got: 0 }; this.inbox.set(key, e); }
    if (e.parts[c._i] == null) { e.parts[c._i] = c._d; e.got++; }
    if (e.got === c._n) { this.inbox.delete(key); this.deliver(e.parts.join('')); }
  }
  deliver(s) { let m; try { m = JSON.parse(s); } catch { return; } this.handlers.forEach(h => { try { h(m); } catch (e) { console.warn('studio handler', e); } }); }
  onMessage(h) { this.handlers.push(h); }
  async close(wipe) { this.closed = true; clearTimeout(this.relayTimer); try { this.dc?.close(); } catch { } try { this.pc.close(); } catch { } if (wipe) { try { await this.sig.wipe(this.path); } catch { } } this.sig.close(); this.setStatus('closed'); }
}

const code4 = () => String(Math.floor(1000 + Math.random() * 9000));

// Mac side: opens a room and waits for the iPad
export async function createHost(onStatus) {
  const sig = makeSignal(); await sig.init();
  let code = code4();
  for (let i = 0; i < 5; i++) { const ex = await sig.get(ROOT + '/' + code); if (!ex || Date.now() - (ex._t || 0) > 3 * 3600e3) break; code = code4(); }
  const peer = new Peer('host', code, sig); peer.onStatus = onStatus;
  peer.attachDC(peer.pc.createDataChannel('ev', { ordered: true }));
  const offer = await peer.pc.createOffer(); await peer.pc.setLocalDescription(offer);
  await sig.put(peer.path, { state: 'waiting', host: sig.uid, created: Date.now() });
  await sig.put(peer.path + '/sig/offer', { sdp: JSON.stringify(offer) });
  const pendingC = []; // the iPad's candidates can arrive before its answer: hold them until the remote description is set
  sig.watchDoc(peer.path + '/sig/answer', async (d) => { if (peer.pc.currentRemoteDescription || !d?.sdp) return; try { await peer.pc.setRemoteDescription(JSON.parse(d.sdp)); peer.setStatus(peer.dcOpen ? 'direct' : 'paired'); for (const c of pendingC.splice(0)) { try { await peer.pc.addIceCandidate(c); } catch { } } } catch (e) { console.warn('answer', e); } });
  sig.watchAdds(peer.path + '/candG', async (d) => { const c = JSON.parse(d.c); if (!peer.pc.currentRemoteDescription) return pendingC.push(c); try { await peer.pc.addIceCandidate(c); } catch { } });
  return peer;
}

// iPad side: joins by code
export async function joinGuest(code, onStatus) {
  const sig = makeSignal(); await sig.init();
  const path = ROOT + '/' + code;
  const room = await sig.get(path); if (!room) throw new Error('ไม่พบห้องอัดรหัส ' + code + ' · ตรวจรหัสบนจอ Mac อีกครั้ง');
  const offerDoc = await sig.get(path + '/sig/offer'); if (!offerDoc?.sdp) throw new Error('ห้องอัดยังไม่พร้อม · ลองใหม่อีกครั้ง');
  const peer = new Peer('guest', code, sig); peer.onStatus = onStatus;
  peer.pc.ondatachannel = (e) => peer.attachDC(e.channel);
  await peer.pc.setRemoteDescription(JSON.parse(offerDoc.sdp));
  const answer = await peer.pc.createAnswer(); await peer.pc.setLocalDescription(answer);
  await sig.put(path + '/sig/answer', { sdp: JSON.stringify(answer) });
  await sig.put(path, { ...room, state: 'paired', guest: sig.uid });
  sig.watchAdds(path + '/candH', async (d) => { try { await peer.pc.addIceCandidate(JSON.parse(d.c)); } catch { } });
  peer.setStatus('paired');
  return peer;
}
