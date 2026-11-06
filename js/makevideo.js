// ทำวิดีโอจากบทเรียน — three plain steps: pick lessons → look (silence already cut) → make the video.
// Everything finer (trim, split, speed, title cards) lives behind "ปรับละเอียด", which opens the full cut editor.
import { h, icon, toast, fmtTime, fmtBytes, uid } from './ui.js';
import * as db from './db.js';
import { prefs, savePrefs } from './prefs.js';

const step = (n, label, cur) => h('div', { class: 'mv-step' + (n === cur ? ' on' : n < cur ? ' done' : '') }, h('b', {}, n < cur ? '✓' : String(n)), h('span', {}, label));

export async function openMakeVideo(app, { preselect = null } = {}) {
  const C = await import('./cut.js');
  const root = h('div', { class: 'sheet mv' });
  const back = h('button', { class: 'btn', title: 'ปิด' }, icon('close'));
  const steps = h('div', { class: 'mv-steps' });
  const body = h('div', { class: 'body mv-body' });
  root.append(h('div', { class: 'top' }, back, h('div', { class: 'title' }, 'ทำวิดีโอจากบทเรียน'), h('span', { class: 'grow' }), steps), body);
  document.body.append(root);
  let eng = null, raf = 0, pr = null, orig = null, cuts = null, title = '', addTitle = true, cutOn = prefs.mv?.cut !== false, picked = [];
  const cleanup = () => { cancelAnimationFrame(raf); try { eng?.pauseAll(); eng?.dispose(); } catch { } eng = null; };
  back.onclick = () => { cleanup(); root.remove(); };
  const setSteps = (n) => steps.replaceChildren(step(1, 'เลือกบทเรียน', n), step(2, 'ดูก่อน', n), step(3, 'ทำวิดีโอ', n));

  // ---------- step 1 ----------
  const step1 = async () => {
    cleanup(); setSteps(1); body.innerHTML = '';
    const recs = (await db.getAll('recs')).filter(r => r.kind === 'audio' && r.lesson && r.done && !r.hidden).sort((a, b) => b.created - a.created);
    const nbs = new Map((await db.getAll('notebooks')).map(n => [n.id, n]));
    const curNb = app.editor?.nb?.id;
    let scope = curNb && recs.some(r => r.nb === curNb) ? 'here' : 'all';
    const sel = new Set(picked.length ? picked : preselect ? preselect.map(r => r.id) : []);
    const list = h('div', { class: 'mv-list' });
    const nextBtn = h('button', { class: 'pill prim mv-big' }, 'ถัดไป', icon('chev'));
    const count = h('div', { class: 'mv-count' });
    const upd = () => { const ms = recs.filter(r => sel.has(r.id)).reduce((a, r) => a + (r.duration || 0), 0); count.textContent = sel.size ? `เลือก ${sel.size} บท · รวม ${fmtTime(ms)}` : 'แตะบทเรียนที่ต้องการ (เลือกได้หลายบท)'; nextBtn.disabled = !sel.size; };
    const paint = () => {
      list.innerHTML = '';
      const show = recs.filter(r => scope === 'all' || r.nb === curNb);
      if (!show.length) list.append(h('div', { class: 'mv-empty' }, h('b', {}, 'ยังไม่มีบทเรียนที่อัด'), h('div', {}, 'กดปุ่มไมค์บนกระดานเพื่ออัดเสียงพร้อมลายมือ แล้วกลับมาที่นี่')));
      for (const r of show) {
        const on = sel.has(r.id);
        const it = h('button', { class: 'mv-item' + (on ? ' on' : '') }, h('span', { class: 'mv-tick' }, on ? '✓' : ''), h('div', { class: 'mv-meta' }, h('b', {}, r.name), h('span', {}, `${scope === 'all' ? (nbs.get(r.nb)?.name || '') + ' · ' : ''}${new Date(r.created).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${new Date(r.created).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`)), h('span', { class: 'mv-dur' }, fmtTime(r.duration || 0)));
        it.onclick = () => { if (sel.has(r.id)) sel.delete(r.id); else sel.add(r.id); paint(); upd(); };
        list.append(it);
      }
    };
    const tabs = h('div', { class: 'seg' });
    for (const [k, l] of [['here', 'สมุดเล่มนี้'], ['all', 'ทุกเล่ม']]) { if (k === 'here' && !curNb) continue; const b = h('button', { class: scope === k ? 'on' : '' }, l); b.onclick = () => { scope = k; for (const x of tabs.children) x.classList.toggle('on', x === b); paint(); }; tabs.append(b); }
    nextBtn.onclick = () => { picked = recs.filter(r => sel.has(r.id)).sort((a, b) => a.created - b.created).map(r => r.id); step2(recs.filter(r => sel.has(r.id)).sort((a, b) => a.created - b.created)); };
    body.append(h('div', { class: 'mv-wrap' }, h('h2', {}, 'เลือกบทเรียนที่จะรวมเป็นวิดีโอ'), h('p', { class: 'sub' }, 'เลือกหลายบทได้ แอปจะเรียงตามเวลาที่อัดให้เอง'), tabs, list, h('div', { class: 'mv-foot' }, count, nextBtn)));
    paint(); upd();
  };

  // ---------- step 2 ----------
  const step2 = async (chosen) => {
    cleanup(); setSteps(2); body.innerHTML = '';
    const wait = h('div', { class: 'mv-wait' }, h('div', { class: 'spin' }), h('div', {}, 'กำลังเตรียมบทเรียนและหาช่วงเงียบ…'));
    body.append(wait);
    try {
      orig = { id: uid(), name: '', created: Date.now(), clips: [], fade: true, res: '1920' };
      for (const r of chosen) await C.addRecClip(orig, r);
      title = (chosen[0].name || 'บทเรียน').replace(/ · (เสียง.*|ตอนที่ \d+)$/, '');
      // find dead air once, keep the result so the switch is instant
      const tmp = new C.Engine(orig); await tmp.loadAll();
      cuts = new Map();
      for (const c of orig.clips) { try { const r = await C.findDeadAir(tmp.src(c), { minLen: prefs.cutMin || 8000, level: prefs.cutLevel || 'mid' }); cuts.set(c.id, r.ranges); } catch { cuts.set(c.id, []); } }
      tmp.dispose();
    } catch (e) { body.innerHTML = ''; body.append(h('div', { class: 'mv-empty' }, h('b', {}, 'เตรียมบทเรียนไม่ได้'), h('div', {}, String(e.message || e)))); return; }
    const build = () => {
      const p = { ...orig, id: pr?.id || uid(), name: title + ' · วิดีโอ', clips: orig.clips.map(c => ({ ...c, id: uid(), _from: c.id })) };
      if (cutOn) for (const c of p.clips.slice()) { const rs = cuts.get(c._from) || []; if (rs.length) C.applyCuts(p, c, rs.map(r => ({ ...r }))); }
      if (addTitle && title.trim()) p.clips.unshift({ id: uid(), kind: 'title', text: title.trim(), name: title.trim(), hold: 3000, bg: '#1E2A55', fg: '#fff' });
      return p;
    };
    const before = C.totalDur(orig);
    const sum = h('div', { class: 'mv-sum' });
    const cv = h('canvas', { class: 'mv-cv' }), ctx = cv.getContext('2d', { alpha: false });
    const play = h('button', { class: 'btn big mv-play' }, icon('play'));
    const bar = h('input', { type: 'range', class: 'lp-bar', min: 0, max: 1000, value: 0 });
    const tEl = h('span', { class: 'mv-t' });
    let t = 0, playing = false, lastWall = 0;
    const restart = async () => {
      cancelAnimationFrame(raf); try { eng?.pauseAll(); eng?.dispose(); } catch { }
      pr = build(); eng = new C.Engine(pr); await eng.loadAll(); t = 0; playing = false; play.replaceChildren(icon('play'));
      const after = C.totalDur(pr), saved = before - after + (addTitle ? 3000 : 0);
      sum.replaceChildren(cutOn && saved > 1000 ? h('span', {}, 'จาก ', h('b', {}, fmtTime(before)), ' เหลือ ', h('b', {}, fmtTime(after)), ` · ตัดช่วงเงียบออก ${fmtTime(saved)}`) : h('span', {}, 'ความยาว ', h('b', {}, fmtTime(after)), cutOn ? ' · ไม่พบช่วงเงียบยาว ๆ' : ''));
      raf = requestAnimationFrame(frame);
    };
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const D = C.totalDur(pr);
      if (playing) { const ck = eng.clockT(); t = ck != null ? ck : t + (lastWall ? now - lastWall : 0); lastWall = now; eng.sync(t); if (t >= D) { playing = false; eng.pauseAll(); play.replaceChildren(icon('play')); t = D; } }
      const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); if (cv.width !== Math.round(r.width * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.width * 9 / 16 * d); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); eng.draw(ctx, cv.width, cv.height, t);
      bar.value = D ? Math.round(t / D * 1000) : 0; tEl.textContent = fmtTime(t) + ' / ' + fmtTime(D);
    };
    play.onclick = () => { if (playing) { playing = false; eng.pauseAll(); play.replaceChildren(icon('play')); } else { if (t >= C.totalDur(pr) - 50) t = 0; playing = true; lastWall = 0; eng.cur = -1; play.replaceChildren(icon('pause')); } };
    bar.oninput = () => { playing = false; eng.pauseAll(); play.replaceChildren(icon('play')); t = +bar.value / 1000 * C.totalDur(pr); };
    const sw = (on, label, sub, fn) => { const b = h('button', { class: 'mv-switch' + (on ? ' on' : '') }, h('span', { class: 'knob' }), h('div', {}, h('b', {}, label), h('span', {}, sub))); b.onclick = () => { b.classList.toggle('on'); fn(b.classList.contains('on')); }; return b; };
    const tIn = h('input', { class: 'field', value: title, placeholder: 'ชื่อวิดีโอ' }); tIn.onchange = () => { title = tIn.value; restart(); };
    const fine = h('button', { class: 'pill ghost' }, icon('scissors'), 'ปรับละเอียด (ตัดหัว‑ท้าย แบ่งคลิป ความเร็ว)');
    fine.onclick = async () => { const p = build(); await C.saveProject(p); cleanup(); root.remove(); C.openCutEditor(app, { projectId: p.id }); };
    const nextBtn = h('button', { class: 'pill prim mv-big' }, 'ถัดไป', icon('chev')); nextBtn.onclick = () => { const p = build(); cleanup(); step3(p); };
    const backBtn = h('button', { class: 'pill sec mv-big' }, icon('back'), 'ย้อนกลับ'); backBtn.onclick = step1;
    body.innerHTML = '';
    body.append(h('div', { class: 'mv-wrap' },
      h('h2', {}, 'ดูก่อนทำวิดีโอ'), sum,
      h('div', { class: 'mv-player' }, cv, h('div', { class: 'mv-ctl' }, play, bar, tEl)),
      h('div', { class: 'lbl' }, 'ชื่อวิดีโอ'), tIn,
      sw(cutOn, 'ตัดช่วงเงียบอัตโนมัติ', 'ช่วงที่ไม่พูดและไม่เขียนนานเกิน 8 วินาทีจะถูกตัดออก', (v) => { cutOn = v; prefs.mv = { ...(prefs.mv || {}), cut: v }; savePrefs(); restart(); }),
      sw(addTitle, 'ใส่หน้าชื่อเรื่องตอนต้น', 'ขึ้นชื่อวิดีโอ 3 วินาทีก่อนเริ่ม', (v) => { addTitle = v; restart(); }),
      h('div', { style: { margin: '10px 0' } }, fine),
      h('div', { class: 'mv-foot' }, backBtn, h('span', { class: 'grow' }), nextBtn)));
    await restart();
  };

  // ---------- step 3 ----------
  const step3 = async (p) => {
    setSteps(3); body.innerHTML = '';
    await C.saveProject(p);
    const D = C.totalDur(p);
    const go = h('button', { class: 'pill prim mv-huge' }, icon('film'), 'ทำวิดีโอ');
    const backBtn = h('button', { class: 'pill sec mv-big' }, icon('back'), 'ย้อนกลับ');
    backBtn.onclick = async () => { const recs = await Promise.all(picked.map(id => db.get('recs', id))); step2(recs.filter(Boolean)); };
    const box = h('div', { class: 'mv-wrap mv-center' },
      h('h2', {}, p.name.replace(/ · วิดีโอ$/, '')),
      h('p', { class: 'sub' }, `ความยาว ${fmtTime(D)} · ความคมชัด 1080p · มีลายน้ำผู้พัฒนาที่มุมขวาล่าง`),
      go,
      h('p', { class: 'sub' }, `ใช้เวลาประมาณ ${fmtTime(D)} (เท่าความยาววิดีโอ) · เปิดแอปค้างไว้ ทำอย่างอื่นในแอปได้`),
      h('div', { class: 'mv-foot' }, backBtn));
    body.append(box);
    go.onclick = async () => {
      const prog = h('div', { class: 'mv-prog' }, h('i')), lab = h('div', { class: 'mv-plab' }, 'กำลังเริ่ม…');
      box.replaceChildren(h('h2', {}, 'กำลังทำวิดีโอ…'), prog, lab, h('p', { class: 'sub' }, 'ปิดหน้านี้ได้ วิดีโอจะทำต่อเบื้องหลัง (ดูความคืบหน้าที่มุมขวาล่าง)'));
      const Q = await import('./exportq.js');
      const job = { id: uid(), name: p.name.replace(/ · วิดีโอ$/, ''), project: JSON.parse(JSON.stringify(p)), res: 1920, dur: D };
      const tick = setInterval(() => { if (!root.isConnected) return clearInterval(tick); const st = Q.queueState(); const j = st.running?.id === job.id ? st.running : null; if (j) { prog.firstChild.style.width = Math.round((j.pct || 0) * 100) + '%'; lab.textContent = `${Math.round((j.pct || 0) * 100)}% · ${fmtTime(j.at || 0)} / ${fmtTime(D)}`; } else if (st.pending.some(x => x.id === job.id)) lab.textContent = 'รอคิว (มีวิดีโออื่นกำลังทำอยู่)'; }, 500);
      job.onError = (e) => { clearInterval(tick); if (!root.isConnected) return; box.replaceChildren(h('h2', {}, 'ทำวิดีโอไม่สำเร็จ'), h('p', {}, String(e.message || e)), backBtn); };
      job.onCancel = () => { clearInterval(tick); if (root.isConnected) step3(p); };
      job.onDone = (meta, blob) => {
        clearInterval(tick);
        if (!root.isConnected) { import('./recorder.js').then(R => R.showRecording(meta, true, blob)); return; }
        const R = import('./recorder.js');
        const yt = h('button', { class: 'pill prim mv-big' }, icon('upload'), 'ส่งขึ้น YouTube'); yt.onclick = () => import('./youtube.js').then(m => m.uploadToYouTube(meta, blob));
        const sv = h('button', { class: 'pill sec mv-big' }, icon('download'), 'บันทึกลงเครื่อง'); sv.onclick = () => R.then(m => m.saveRecording(meta));
        const pl = h('button', { class: 'pill sec mv-big' }, icon('play'), 'ดูวิดีโอ'); pl.onclick = () => R.then(m => m.showRecording(meta, false, blob));
        box.replaceChildren(h('div', { class: 'mv-ok' }, '✓'), h('h2', {}, 'วิดีโอเสร็จแล้ว'), h('p', { class: 'sub' }, `${fmtTime(meta.duration)} · ${fmtBytes(blob.size)} · เก็บไว้ใน "คลิปที่อัดไว้" แล้ว`), h('div', { class: 'mv-actions' }, yt, sv, pl));
      };
      Q.enqueue(job);
    };
  };

  if (preselect?.length) { picked = preselect.map(r => r.id); step2(preselect.slice().sort((a, b) => a.created - b.created)); } else step1();
}
