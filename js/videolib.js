// คลังวิดีโอ: one place for every video made, every lesson recorded and every editing project.
// Students see only their own recordings (no YouTube, no editing).
import { h, icon, toast, dialog, menu, confirmBox, ask, fmtTime, fmtBytes } from './ui.js';
import * as db from './db.js';
import { prefs, savePrefs } from './prefs.js';
import { renderPageTo } from './render.js';

let open = null;
export function openVideoLibrary(app, { nb = null, tab = null } = {}) {
  open?.close();
  const student = !!prefs.studentUI;
  const st = prefs.vlib || {};
  let cur = student ? 'lessons' : (tab || st.tab || 'lessons'), q = '', group = st.group || 'nb', nbOnly = nb;
  const root = h('div', { class: 'sheet vlib' });
  const closeBtn = h('button', { class: 'btn', title: 'ปิด' }, icon('close'));
  const search = h('input', { class: 'field vl-search', type: 'search', placeholder: 'ค้นหาชื่อคลิป / ชื่อสมุด' });
  const make = student ? null : h('button', { class: 'pill prim' }, icon('film'), ' ส่งออกวิดีโอ');
  const tabs = h('div', { class: 'seg vl-tabs' });
  const groupSeg = h('div', { class: 'seg vl-group' });
  const usage = h('div', { class: 'vl-usage' });
  const scope = h('div', { class: 'vl-scope' });
  const grid = h('div', { class: 'vl-body' });
  root.append(
    h('div', { class: 'top' }, closeBtn, h('div', { class: 'title' }, student ? 'เสียงที่อัดไว้' : 'คลังวิดีโอ'), h('span', { class: 'grow' }), make),
    h('div', { class: 'vl-bar' }, student ? null : tabs, search, groupSeg),
    h('div', { class: 'body' }, usage, scope, grid));
  document.body.append(root);
  const close = () => { root.remove(); document.removeEventListener('senkid:rec-moved', paint); open = null; };
  open = { close };
  closeBtn.onclick = close;
  if (make) make.onclick = () => { if (cur !== 'lessons') { cur = 'lessons'; remember(); paint(); } toast('เลือกบทเรียนที่จะส่งออก แล้วกด ⋯ → ส่งออกวิดีโอ (4K)', 3500); };
  search.oninput = () => { q = search.value.trim().toLowerCase(); paintGrid(); };
  const remember = () => { prefs.vlib = { tab: cur, group }; savePrefs(); };
  if (cur === 'projects') cur = 'lessons';
  for (const [k, l] of [['lessons', 'บทเรียนที่อัด'], ['videos', 'วิดีโอที่ส่งออก']]) {
    const b = h('button', { 'data-k': k }, l); b.onclick = () => { cur = k; remember(); paint(); }; tabs.append(b);
  }
  for (const [k, l] of [['nb', 'ตามสมุด'], ['date', 'ตามวันที่']]) {
    const b = h('button', { 'data-k': k }, l); b.onclick = () => { group = k; remember(); paintGrid(); }; groupSeg.append(b);
  }

  let recs = [], nbs = new Map(), projects = [], driveOk = false;
  const load = async () => {
    recs = (await db.getAll('recs')).filter(r => !r.hidden && r.kind !== 'cam');
    nbs = new Map((await db.getAll('notebooks')).map(n => [n.id, n]));
    projects = student ? [] : (await import('./cut.js').then(C => C.listProjects()));
    try { const S = await import('./sync.js'); driveOk = S.connected() && S.hasFileScope() && prefs.rec?.toDrive !== false; } catch { driveOk = false; }
  };
  const inTab = (r) => cur === 'videos' ? r.kind === 'video' : r.kind === 'audio';
  const local = (r) => (!r.drive || r.localCopy) && !r.gone; // the file is on this device
  const badges = (r) => {
    const out = [];
    if (r.yt) out.push(h('span', { class: 'vl-b yt' }, 'YouTube'));
    if (r.drive) out.push(h('span', { class: 'vl-b dr' }, 'Drive'));
    if (local(r)) out.push(h('span', { class: 'vl-b lc' }, 'ในเครื่อง'));
    if (r.cam) out.push(h('span', { class: 'vl-b cam' }, 'กล้องครู'));
    if (r.lesson) out.push(h('span', { class: 'vl-b ls' }, 'ลายมือ'));
    if (!r.done) out.push(h('span', { class: 'vl-b bad' }, 'ไม่สมบูรณ์'));
    return out;
  };

  // ---------- thumbnails ----------
  const thumbOf = async (r, cv) => {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const draw = (img) => { const s = Math.max(W / img.width, H / img.height), w = img.width * s, hh = img.height * s; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.drawImage(img, (W - w) / 2, r.kind === 'audio' ? 0 : (H - hh) / 2, w, hh); };
    try {
      const cover = (await db.get('kv', 'cover:' + r.id))?.v || (await db.get('kv', 'vthumb:' + r.id))?.v;
      if (cover) { draw(await createImageBitmap(cover)); return; }
      if (r.kind === 'audio' && r.nb) { // the page the lesson started on
        const nbk = nbs.get(r.nb), pid = r.page || nbk?.pages?.[0]; const pg = pid && await db.get('pages', pid);
        if (pg) { const c = document.createElement('canvas'); renderPageTo(c, pg, nbk?.paper || 'cream', 320); draw(c); return; }
      }
      if (r.kind === 'video' && local(r) && r.done) { // one frame from the file, kept for next time
        const chunks = await db.chunksOf(r.id); if (!chunks.length) return;
        const url = URL.createObjectURL(new Blob(chunks.sort((a, b) => a.seq - b.seq).map(c => c.blob), { type: (r.mime || 'video/mp4').split(';')[0] }));
        const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(res, 4000); });
        try { v.currentTime = Math.min(2, (v.duration || 4) / 3); await new Promise(res => { v.onseeked = res; setTimeout(res, 2500); }); } catch { }
        if (v.videoWidth) { draw(v); cv.toBlob(b => b && db.putQuiet('kv', { k: 'vthumb:' + r.id, v: b }), 'image/jpeg', 0.8); }
        URL.revokeObjectURL(url);
      }
    } catch (e) { console.warn('thumb', e); }
  };

  // ---------- actions ----------
  const R = () => import('./recorder.js');
  const playRec = async (r) => {
    if (r.gone && r.ytLink) { window.open(r.ytLink, '_blank', 'noopener'); return; }
    if (r.lesson || r.cam) { const { busy } = await import('./ui.js'); const bz = busy('กำลังโหลดเสียง…'); let blob = null; try { blob = await (await R()).recBlob(r); } catch { } finally { bz.done(); } (await import('./lesson.js')).openPlayer(r, blob); return; }
    (await R()).showRecording(r);
  };
  const shareLink = async (r) => {
    let link = r.ytLink || r.link;
    if (!link && r.drive) { try { const { driveShareLink } = await import('./sync.js'); link = await driveShareLink(r.drive); r.link = link; await db.put('recs', r); } catch (e) { toast('สร้างลิงก์ไม่ได้: ' + (e.message || e), 3000, 'warn'); return; } }
    if (!link) { toast('ยังไม่มีลิงก์ · ส่งขึ้น YouTube หรือ Google Drive ก่อน', 2500); return; }
    dialog('ลิงก์แชร์', h('div', {}, h('a', { href: link, target: '_blank', rel: 'noopener', style: { wordBreak: 'break-all', fontSize: '20px' } }, link), h('p', { class: 'sub' }, r.ytLink ? 'ลิงก์ YouTube' : 'ใครมีลิงก์ก็เปิดดูได้ · ยกเลิกการแชร์ได้ใน Google Drive')),
      [{ label: 'คัดลอก', action: () => { navigator.clipboard?.writeText(link).then(() => toast('คัดลอกแล้ว', 1500)).catch(() => { }); return false; } }, { label: 'ปิด', cls: 'prim' }], { width: 520 });
  };
  const rename = async (r) => { const v = await ask('ชื่อคลิป', { value: r.name || '' }); if (v && v.trim()) { r.name = v.trim(); await db.put('recs', r); paintGrid(); } };
  const recMenu = (r, anchor) => {
    const playable = r.done && (local(r) || r.drive || r.ytLink);
    const items = [
      playable && { icon: 'play', label: r.lesson || r.cam ? (r.cam ? 'เล่นย้อน (เสียง + ลายมือ + หน้าครู)' : 'เล่นย้อน (เสียง + ลายมือ)') : r.gone ? 'ดูบน YouTube' : 'เล่น', action: () => playRec(r) },
      r.yt && !r.gone && { icon: 'play', label: 'ดูบน YouTube', action: () => window.open(r.ytLink, '_blank', 'noopener') },
      // (YouTube upload is hidden: export for external editing is the only video path now)
      !student && (r.ytLink || r.drive) && { icon: 'qr', label: 'ลิงก์แชร์', action: () => shareLink(r) },
      playable && !r.gone && { icon: 'share', label: 'แชร์ไฟล์ (LINE, AirDrop)', action: async () => (await R()).shareRecording(r) },
      playable && !r.gone && { icon: 'download', label: 'บันทึกลงเครื่อง', action: async () => (await R()).saveRecording(r) },
      !student && r.done && !r.gone && r.kind === 'audio' && (r.lesson || r.cam) && { icon: 'film', label: 'ส่งออกวิดีโอสำหรับตัดต่อ (4K)', action: async () => (await import('./exportvideo.js')).openExportVideo(app, r) },
      !student && r.drive && !r.localCopy && r.done && { icon: 'download', label: 'ดึงกลับมาเก็บในเครื่อง (เล่นได้ไม่ต้องใช้เน็ต)', action: async () => { if (await (await R()).pullBack(r)) paint(); } },
      !student && r.drive && r.localCopy && r.done && { icon: 'trash', label: 'ลบสำเนาในเครื่อง (เก็บไว้บน Drive)', action: async () => { await db.deleteRec(r.id); r.localCopy = false; if (r.cam) { const cm = await db.get('recs', r.cam); if (cm?.localCopy) { await db.deleteRec(cm.id); cm.localCopy = false; await db.put('recs', cm); } } await db.put('recs', r); toast('ลบสำเนาในเครื่องแล้ว', 2000); paint(); } },
      !student && driveOk && local(r) && !r.drive && r.done && { icon: 'cloud', label: 'ย้ายไป Google Drive (คืนพื้นที่เครื่อง)', action: async () => { await (await R()).maybeUpload(r); paint(); } },
      '-',
      { icon: 'edit', label: 'เปลี่ยนชื่อ', action: () => rename(r) },
      { icon: 'trash', label: 'ลบ', danger: true, action: async () => { if (await (await R()).deleteRecording(r)) { recs = recs.filter(x => x !== r); paint(); } } },
    ].filter(Boolean);
    menu(anchor, items);
  };
  const card = (r) => {
    const cv = h('canvas', { class: 'vl-th', width: 320, height: 180 });
    const nbName = nbs.get(r.nb)?.name || '';
    const d = new Date(r.created);
    const more = h('button', { class: 'btn sq vl-more', title: 'เพิ่มเติม' }, icon('more'));
    const playBtn = h('button', { class: 'vl-play', title: 'เล่น' }, icon('play'));
    const el = h('div', { class: 'vl-card' + (r.done ? '' : ' bad') },
      h('div', { class: 'vl-thw' }, cv, h('span', { class: 'vl-dur' }, fmtTime(r.duration || 0)), playBtn, h('div', { class: 'vl-badges' }, ...badges(r))),
      h('div', { class: 'vl-meta' }, h('b', {}, r.name || 'ไม่มีชื่อ'), h('span', {}, `${nbName ? nbName + ' · ' : ''}${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}${r.size && local(r) ? ' · ' + fmtBytes(r.size) : ''}`)), more);
    playBtn.onclick = (e) => { e.stopPropagation(); playRec(r); };
    more.onclick = (e) => { e.stopPropagation(); recMenu(r, more); };
    el.onclick = () => recMenu(r, more);
    requestAnimationFrame(() => thumbOf(r, cv));
    return el;
  };
  const projCard = (p) => {
    const C = import('./cut.js');
    const more = h('button', { class: 'btn sq vl-more', title: 'เพิ่มเติม' }, icon('more'));
    const el = h('div', { class: 'vl-card proj' },
      h('div', { class: 'vl-thw pj' }, icon('scissors'), h('span', { class: 'vl-dur' }, '')),
      h('div', { class: 'vl-meta' }, h('b', {}, p.name), h('span', {}, `${p.clips.length} คลิป · แก้ล่าสุด ${new Date(p.updated || p.created).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}`)), more);
    C.then(m => { el.querySelector('.vl-dur').textContent = fmtTime(m.totalDur(p)); });
    const openIt = async () => { close(); (await C).openCutEditor(app, { projectId: p.id }); };
    const pm = () => menu(more, [
      { icon: 'scissors', label: 'เปิดตัดต่อ', action: openIt },
      { icon: 'edit', label: 'เปลี่ยนชื่อ', action: async () => { const v = await ask('ชื่อโปรเจกต์', { value: p.name }); if (v && v.trim()) { p.name = v.trim(); await (await C).saveProject(p); paintGrid(); } } },
      '-',
      { icon: 'trash', label: 'ลบโปรเจกต์ (คลิปต้นฉบับยังอยู่)', danger: true, action: async () => { if (await confirmBox('ลบโปรเจกต์นี้?', 'คลิปต้นฉบับยังอยู่ครบ', { ok: 'ลบ', danger: true })) { await (await C).deleteProject(p.id); projects = projects.filter(x => x !== p); paintGrid(); } } },
    ]);
    more.onclick = (e) => { e.stopPropagation(); pm(); };
    el.onclick = openIt;
    return el;
  };

  // ---------- storage ----------
  const paintUsage = async () => {
    usage.innerHTML = '';
    let all = recs; try { all = await db.getAll('recs'); } catch { }
    const mine = all.filter(r => local(r) && r.done);
    const pendAll = mine.filter(r => !r.drive); // includes the hidden teacher-camera files, which take real space
    const used = mine.reduce((a, r) => a + (r.size || 0), 0);
    const pend = student ? [] : pendAll.filter(r => !r.local);
    let quota = '';
    try { const e = await navigator.storage?.estimate?.(); if (e?.quota) quota = ` · เครื่องเหลือที่ว่าง ${fmtBytes(Math.max(0, e.quota - e.usage))}`; } catch { }
    const freeable = student ? [] : recs.filter(r => local(r) && r.kind === 'video' && r.yt);
    const info = h('div', {}, h('b', {}, `คลิปในเครื่อง ${mine.length} ไฟล์ · ${fmtBytes(used)}`), h('span', { class: 'sub' }, quota));
    usage.append(info);
    if (pend.length && driveOk) {
      const sz = pend.reduce((a, r) => a + (r.size || 0), 0);
      const R = await import('./recorder.js');
      const b = h('button', { class: 'pill prim' }, icon('cloud'), `ส่งขึ้น Drive ตอนนี้ (${pend.length} ไฟล์ · ${fmtBytes(sz)})`);
      b.onclick = async () => { b.disabled = true; b.textContent = 'กำลังส่ง…'; try { await R.uploadPendingRecordings(true); } finally { paint(); } };
      usage.append(b, h('span', { class: 'sub' }, R.uploadMode() === 'night' ? 'หรือปล่อยให้ส่งเองตอน 01:00–05:00 เมื่อแอปเปิดอยู่' : R.uploadMode() === 'manual' ? 'ตั้งค่าไว้ให้กดส่งเองเท่านั้น' : ''));
    }
    if (freeable.length) {
      const sz = freeable.reduce((a, r) => a + (r.size || 0), 0);
      const b = h('button', { class: 'pill sec' }, icon('trash'), `ลบสำเนาในเครื่องที่อยู่บน YouTube แล้ว (${freeable.length} · ${fmtBytes(sz)})`);
      b.onclick = async () => {
        if (!(await confirmBox('ลบสำเนาในเครื่อง?', `วิดีโอ ${freeable.length} ไฟล์อยู่บน YouTube แล้ว · ในคลังจะยังเห็นรายการและเปิดดูบน YouTube ได้ แต่แชร์ไฟล์/ตัดต่อจากเครื่องนี้ไม่ได้อีก`, { ok: 'ลบสำเนา', danger: true }))) return;
        for (const r of freeable) { await db.deleteRec(r.id); r.gone = 1; await db.put('recs', r); }
        toast(`คืนพื้นที่ ${fmtBytes(sz)} แล้ว`, 2500); paint();
      };
      usage.append(b);
    }
  };

  // ---------- grid ----------
  const paintGrid = () => {
    grid.innerHTML = '';
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.k === cur);
    for (const b of groupSeg.children) b.classList.toggle('on', b.dataset.k === group);
    groupSeg.style.display = cur === 'projects' ? 'none' : '';
    scope.innerHTML = '';
    if (nbOnly && cur !== 'projects') { const x = h('button', { class: 'chip on' }, `เฉพาะสมุด "${nbs.get(nbOnly)?.name || ''}"`, icon('close')); x.onclick = () => { nbOnly = null; paintGrid(); }; scope.append(x); }
    if (cur === 'projects') {
      const list = projects.filter(p => !q || p.name.toLowerCase().includes(q));
      const wrap = h('div', { class: 'vl-grid' });
      const neu = h('button', { class: 'vl-card add' }, icon('plus'), h('b', {}, 'โปรเจกต์ใหม่'), h('span', { class: 'sub' }, 'ตัดหัว‑ท้าย แบ่งคลิป ความเร็ว รวมหลายคลิป'));
      neu.onclick = async () => { close(); (await import('./cut.js')).openCutEditor(app); };
      wrap.append(neu, ...list.map(projCard)); grid.append(wrap); return;
    }
    const list = recs.filter(inTab).filter(r => !nbOnly || r.nb === nbOnly)
      .filter(r => !q || (r.name || '').toLowerCase().includes(q) || (nbs.get(r.nb)?.name || '').toLowerCase().includes(q))
      .sort((a, b) => b.created - a.created);
    if (!list.length) {
      grid.append(h('div', { class: 'mv-empty' }, h('b', {}, q ? 'ไม่พบคลิปที่ค้นหา' : cur === 'videos' ? 'ยังไม่มีวิดีโอที่ทำ' : student ? 'ยังไม่มีเสียงที่อัด' : 'ยังไม่มีบทเรียนที่อัด'),
        h('div', {}, cur === 'videos' ? 'กด "ทำวิดีโอ" เพื่อรวมบทเรียนที่อัดไว้เป็นวิดีโอ' : 'กดปุ่ม "อัด" บนกระดานเพื่ออัดเสียงพร้อมลายมือ')));
      return;
    }
    const groups = new Map();
    for (const r of list) {
      const key = group === 'nb' ? (nbs.get(r.nb)?.name || 'ไม่ได้อยู่ในสมุด') : new Date(r.created).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r);
    }
    for (const [k, arr] of groups) grid.append(h('div', { class: 'vl-gh' }, k, h('span', {}, ` · ${arr.length}`)), h('div', { class: 'vl-grid' }, ...arr.map(card)));
  };
  const paint = async () => { await load(); paintUsage(); paintGrid(); };
  document.addEventListener('senkid:rec-moved', paint);
  paint();
  return open;
}
