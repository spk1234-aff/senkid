// iPad side of the "ห้องอัด": pair with the Mac by a 4-digit code, then stream every stroke / page / zoom change live.
// The Mac records; here nothing is saved unless a normal lesson recording is also running.
import { h, icon, toast, dialog } from './ui.js';
import { prefs } from './prefs.js';
import { Timeline } from './lesson.js';
import { pdfBitmap } from './pdfdoc.js';

let link = null; // { peer, tl, chip, stop }

export function liveActive() { return !!link; }

export async function openStudioLink(app, ed) {
  if (link) return showChipMenu(app);
  const inp = h('input', { class: 'inp', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, placeholder: '0000', autocomplete: 'off', style: { fontSize: '40px', letterSpacing: '12px', textAlign: 'center', width: '100%' } });
  const sub = h('p', { class: 'sub', style: { margin: '10px 0 0' } }, 'บน Mac เปิดแอป "เส้นคิด Studio" (spk1234-aff.github.io/senkid/studio/) จะเห็นรหัส 4 หลัก พิมพ์รหัสนั้นที่นี่ · ทั้งสองเครื่องต้องต่ออินเทอร์เน็ต');
  const body = h('div', {}, h('div', { class: 'lbl' }, 'รหัสจากจอ เส้นคิด Studio บน Mac'), inp, sub);
  setTimeout(() => inp.focus(), 50);
  dialog('ส่งภาพไปเส้นคิด Studio (Mac)', body, [{ label: 'ยกเลิก' }, {
    label: 'เชื่อมต่อ', cls: 'prim', icon: 'link', action: async (B) => {
      const code = inp.value.trim(); if (!/^\d{4}$/.test(code)) { sub.textContent = 'รหัสต้องเป็นตัวเลข 4 หลัก'; return false; }
      B.disabled = true; B.textContent = 'กำลังเชื่อมต่อ…'; sub.textContent = 'กำลังติดต่อห้องอัด…';
      try { await connect(app, ed, code); return true; }
      catch (e) { sub.textContent = e.message || String(e); B.disabled = false; B.textContent = 'ลองอีกครั้ง'; return false; }
    }
  }], { width: 460 });
}

async function connect(app, ed, code) {
  const N = await import('./studio-net.js');
  const chip = h('div', { class: 'live-chip' }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, 'กำลังเชื่อมต่อ Studio…'), h('button', { class: 'x', title: 'หยุดส่งภาพ' }, '✕'));
  const setTxt = (s) => {
    const m = { connecting: 'กำลังเชื่อมต่อ…', paired: 'จับคู่แล้ว · กำลังเปิดช่องส่งตรง…', direct: 'Studio: เชื่อมต่อตรง ✓', relay: 'Studio: ส่งผ่านเซิร์ฟเวอร์ (ช้ากว่าเล็กน้อย)', closed: 'ห้องอัดปิดแล้ว' };
    chip.querySelector('.txt').textContent = m[s] || s; chip.dataset.s = s;
  };
  const peer = await N.joinGuest(code, setTxt);
  document.body.appendChild(chip);
  // one timeline for everything: if a lesson recording is running it already has one; otherwise run it in live-only mode
  const tl = app.timeline || (app.timeline = new Timeline(app));
  const sentPdf = new Set();
  // hello first (it resets the Mac's picture), then the stream
  if (!tl.active) { tl.start(ed, 'live-' + Date.now()); tl.liveOnly = true; }
  peer.send({ k: 'hello', t: tl.now(), name: ed.nb?.name || '', ver: 1 });
  tl.live = (ev) => {
    peer.send({ k: 'ev', ev });
    if (ev[1] === 'base' && ev[3]?.pdf) sendPdfPage(ed, ev[2], ev[3].pdf, sentPdf, peer);
  };
  // give the Mac the whole current picture: meta, every visible page, the view
  peer.send({ k: 'ev', ev: tl.events[0] });
  tl.based.clear(); tl.view(true);
  const ping = setInterval(() => { if (link) peer.send({ k: 'ping', t: tl.now() }); }, 4000);
  peer.onMessage((m) => { if (m.k === 'bye') { toast('Studio บน Mac ปิดการเชื่อมต่อแล้ว', 3000); stopLive(app, false); } if (m.k === 'rec') { chip.classList.toggle('rec', !!m.on); toast(m.on ? '● Mac เริ่มอัดแล้ว' : '■ Mac หยุดอัดแล้ว', 2000); } if (m.k === 'needpdf') sendPdfPage(ed, m.pid, m.pdf, new Set(), peer); });
  chip.querySelector('.x').onclick = () => showChipMenu(app);
  link = { peer, tl, chip, ping };
  toast('ส่งภาพไป Studio แล้ว · เขียนต่อได้เลย Mac จะเห็นทันที', 3000);
}

async function sendPdfPage(ed, pid, ref, sent, peer) {
  const key = ref.id + ':' + ref.n; if (sent.has(key)) return; sent.add(key);
  const page = ed.pageMap.get(pid); if (!page) return;
  // the Mac may not have this PDF: send a rendered bitmap of the page (JPEG, ~2× screen scale)
  for (let i = 0; i < 40; i++) {
    const bm = pdfBitmap(page, 2, 3);
    if (bm && bm.width > 0) {
      try {
        const c = document.createElement('canvas'); const W = Math.min(bm.width, 2200), H = Math.round(bm.height * W / bm.width); c.width = W; c.height = H;
        c.getContext('2d').drawImage(bm, 0, 0, W, H);
        peer.send({ k: 'pdfimg', id: ref.id, n: ref.n, data: c.toDataURL('image/jpeg', 0.82) });
      } catch (e) { console.warn('pdfimg', e); }
      return;
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

function showChipMenu(app) {
  if (!link) return;
  const s = link.peer.status;
  dialog('เส้นคิด Studio (Mac)', h('div', {}, h('p', {}, s === 'direct' ? 'เชื่อมต่อตรงกับ Mac อยู่ ✓' : s === 'relay' ? 'ส่งผ่านเซิร์ฟเวอร์อยู่ (ใช้ได้ แต่ช้ากว่าเล็กน้อย)' : 'กำลังเชื่อมต่อ…'), h('p', { class: 'sub' }, 'ทุกเส้นที่เขียน การเปลี่ยนหน้า และการซูม ถูกส่งไปให้ Mac อัด · ฝั่ง iPad ไม่ได้อัดอะไรไว้ เว้นแต่กดอัดบทเรียนตามปกติด้วย')),
    [{ label: 'ปิด' }, { label: 'หยุดส่งภาพ', cls: 'danger', icon: 'close', action: () => stopLive(app, true) }], { width: 440 });
}

export function stopLive(app, say = true) {
  if (!link) return;
  const { peer, tl, chip, ping } = link; link = null;
  clearInterval(ping);
  try { peer.send({ k: 'bye' }); } catch { }
  setTimeout(() => peer.close(false), 300);
  tl.live = null;
  if (tl.liveOnly) { tl.liveOnly = false; tl.active = false; const ed = tl.ed; if (ed?.hooks) ed.hooks.dirty = ed.hooks.view = ed.hooks.frame = null; }
  chip.remove();
  if (say) toast('หยุดส่งภาพไป Studio แล้ว', 2000);
}
