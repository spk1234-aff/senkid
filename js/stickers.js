// Stickers: emoji drawn by the device (Apple emoji on iPad) with a white die-cut border,
// plus Thai praise / reminder badges. Each sticker is inserted as an image on the page.
import { h, icon, popover, toast } from './ui.js';
import { prefs, savePrefs } from './prefs.js';

const E = (s) => [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s.replace(/\s+/g, ''))].map(x => x.segment);
export const CATS = [
  ['badge', 'คำชม', '🏅', null],
  ['cheer', 'กำลังใจ', '👍', E('👍👏🙌💪🎉🎊⭐🌟✨🏆🥇🥈🥉💯✅❌❓❗‼️💡🔥❤️💙💚💛🧡💜🫶😀😄😁😊😍🤩🥳😎🤓🤔😮😢😭😡😴🤯🙏')],
  ['people', 'คน', '🧑‍🏫', E('🧑‍🏫👨‍🏫👩‍🏫🧑‍🎓👨‍🎓👩‍🎓🧒👦👧🧑👨👩🧓👴👵👶👪🧑‍🔬👨‍🔬👩‍🔬🧑‍💻👨‍💻👩‍💻🧑‍⚕️👨‍⚕️👩‍⚕️🧑‍🌾👨‍🌾👩‍🌾🧑‍🍳👨‍🍳👩‍🍳🧑‍🔧🧑‍🏭🧑‍💼🧑‍🚀🧑‍🚒👮👷💂🕵️🧑‍🎨🧑‍✈️🧑‍⚖️🙋🙋‍♂️🙋‍♀️🙆🙅🤷💁🏃🚶🧍🧎🏊🚴⛹️🧘🤝👋✋✌️🤞☝️👉👈👆👇')],
  ['animal', 'สัตว์', '🐶', E('🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🪲🦗🕷️🦂🐢🐍🦎🦖🦕🐙🦑🦐🦞🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🦧🐘🦛🦏🐪🐫🦒🦘🦬🐃🐂🐄🐎🐖🐏🐑🦙🐐🦌🐕🐈🐓🦃🦚🦜🦢🦩🕊️🐇🦝🦨🦡🦫🦦🦥🐁🐀🐿️🦔')],
  ['nature', 'ธรรมชาติ', '🌳', E('🌱🌿☘️🍀🌵🌴🌳🌲🪴🎋🍃🍂🍁🌾🌺🌻🌹🥀🌷🌼🌸💐🍄🌰🪨🌍🌎🌏🌕🌖🌗🌘🌑🌒🌓🌔🌙🌞☀️⭐🌟☁️⛅🌦️🌧️⛈️🌩️❄️☃️🌈🌪️🌫️💨💧💦🌊🔥⚡🌋⛰️🏔️🏝️🏜️')],
  ['food', 'อาหาร', '🍎', E('🍎🍏🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🫑🌽🥕🧄🧅🥔🍠🥐🍞🥖🧀🥚🍳🥞🥓🍗🍖🌭🍔🍟🍕🥪🌮🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🍥🥮🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🥛☕🍵🧃🥤🧋🍯🧂')],
  ['school', 'การเรียน', '✏️', E('✏️✒️🖊️🖋️🖍️📝📏📐✂️📌📍📎🖇️📚📖📕📗📘📙📒📓📔📃📄📑🗂️📁📂🗒️🗓️📅📆🎒🧮🔢🔤🔡🅰️🅱️💻🖥️⌨️🖱️🖨️📱☎️📞📺📷📹🎥🔍🔎🔬🔭🧪🧫🧬⚗️🧲⚖️🧭⏰⏱️⏳⌛🔔📢📣💡🔦🕯️🔋🔌💾💿📀🎓🏫🏅🎖️🏆')],
  ['things', 'สิ่งของ', '🎁', E('🎁🎈🎀🎨🖼️🧵🧶🪡🎭🎪🎤🎧🎼🎵🎶🎹🥁🎷🎺🎸🪕🎻⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🏓🏸🏒🏏🥅⛳🏹🎣🥊🥋🎯🎲🧩♟️🪁🛹🛼🔑🗝️🔒🔓🔨🪓⛏️🔧🪛🔩⚙️🧰🪜🧱⛓️🪝🧹🧺🧻🪣🧼🧽🪥🛁🚿🚽🛏️🛋️🪑🚪🪟🧸🪆💰💵🪙💳💎⌚👓🕶️👔👕👖👗👘🥻👙👚👛👜👝🎒👞👟🥾👠👡👢👑👒🎩🧢⛑️☂️🌂')],
  ['place', 'สถานที่', '🏫', E('🏫🏠🏡🏘️🏢🏬🏣🏤🏥🏦🏨🏪🏭🏯🏰🗼🗽⛪🕌🛕🕍⛩️🕋⛲⛺🏕️🏞️🏖️🏟️🏛️🏗️🌁🌃🏙️🌄🌅🌆🌇🌉🎡🎢🎠🗺️🧭📍🚗🚕🚙🚌🚎🏎️🚓🚑🚒🚐🛻🚚🚛🚜🛵🏍️🚲🛴🚨🚔🚍🚘🚖🚡🚠🚟🚃🚋🚞🚝🚄🚅🚈🚂🚆🚇🚊🚉✈️🛫🛬🛩️💺🛰️🚀🛸🚁🛶⛵🚤🛥️🛳️⛴️🚢⚓🚧⛽🚏🚦🚥🛑')],
  ['symbol', 'สัญลักษณ์', '➕', E('➕➖✖️➗🟰♾️💲#️⃣*️⃣0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟🔢🔣📊📈📉⭕❌✅☑️✔️❎➡️⬅️⬆️⬇️↗️↘️↙️↖️↕️↔️🔄🔃🔁🔀▶️⏸️⏹️⏺️🔺🔻🔷🔶🔹🔸🟥🟧🟨🟩🟦🟪⬛⬜🟫🔴🟠🟡🟢🔵🟣⚫⚪🟤⚠️🚫⛔📛🔞☢️☣️⚛️☯️♻️⚜️🔰💠🆗🆕🆒🆓🆘🆚🔝🔜ℹ️Ⓜ️🅿️🚾♿🚻🚸')],
];
// praise & reminder badges (text in TH Sarabun New)
export const BADGES = [
  ['เก่งมาก!', '#E8524A'], ['ดีมาก', '#2F5BEA'], ['ยอดเยี่ยม', '#7A4BD6'], ['ถูกต้อง ✓', '#1E9E5A'], ['ลองใหม่อีกครั้ง', '#E07B2D'], ['สู้ ๆ นะ', '#E8524A'],
  ['พยายามดีมาก', '#1E9E5A'], ['ตั้งใจเรียน', '#2F5BEA'], ['สำคัญ!', '#D64545'], ['ออกสอบ!', '#D64545'], ['จำให้ได้', '#7A4BD6'], ['ข้อควรระวัง', '#E07B2D'],
  ['ตัวอย่าง', '#2F5BEA'], ['แบบฝึกหัด', '#1E9E5A'], ['การบ้าน', '#E07B2D'], ['สรุป', '#7A4BD6'], ['นิยาม', '#1E2A55'], ['ทฤษฎีบท', '#1E2A55'],
  ['สูตร', '#2F5BEA'], ['เฉลย', '#1E9E5A'], ['ตรวจแล้ว', '#1E9E5A'], ['ส่งแล้ว', '#2F5BEA'], ['ยังไม่ส่ง', '#D64545'], ['แก้ไข', '#E07B2D'],
];

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';
// white die-cut border + soft shadow, without canvas filters (Safari ignores them)
function dieCut(src, pad) {
  const W = src.width + pad * 2, H = src.height + pad * 2 + 6;
  const sil = document.createElement('canvas'); sil.width = src.width; sil.height = src.height;
  const sg = sil.getContext('2d'); sg.drawImage(src, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#fff'; sg.fillRect(0, 0, sil.width, sil.height);
  const sh = document.createElement('canvas'); sh.width = src.width; sh.height = src.height;
  const shg = sh.getContext('2d'); shg.drawImage(src, 0, 0); shg.globalCompositeOperation = 'source-in'; shg.fillStyle = 'rgba(0,0,0,.16)'; shg.fillRect(0, 0, sh.width, sh.height);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d');
  for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2; g.drawImage(sh, pad + Math.cos(t) * pad * 0.9, pad + 5 + Math.sin(t) * pad * 0.9); }
  for (let r of [pad * 0.5, pad]) for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2; g.drawImage(sil, pad + Math.cos(t) * r, pad + Math.sin(t) * r); }
  g.drawImage(src, pad, pad);
  return out;
}
function trim(c) {
  const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(c, -x0, -y0); return o;
}
function emojiCanvas(ch, px = 220) {
  const c = document.createElement('canvas'); c.width = c.height = Math.round(px * 1.5);
  const g = c.getContext('2d'); g.font = `${px}px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, c.width / 2, c.height / 2 + px * 0.06);
  const t = trim(c); return t ? dieCut(t, Math.round(px * 0.07)) : null;
}
async function badgeCanvas(text, color) {
  try { await document.fonts.load('bold 80px "TH Sarabun New"'); } catch { }
  const px = 96, c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = `bold ${px}px "TH Sarabun New", sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + px * 0.9, hh = Math.round(px * 1.15);
  c.width = w; c.height = hh; g.font = `bold ${px}px "TH Sarabun New", sans-serif`;
  const r = hh / 2; g.fillStyle = color; g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, hh, r); g.arcTo(w, hh, 0, hh, r); g.arcTo(0, hh, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.fill();
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(r * 0.6, hh * 0.12, w - r * 1.2, hh * 0.18);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, hh / 2 + px * 0.06);
  return dieCut(c, 10);
}
async function toFile(cv, name) { const b = await new Promise(r => cv.toBlob(r, 'image/png')); return new File([b], name + '.png', { type: 'image/png' }); }

export function stickerPanel(ed, anchor) {
  const box = h('div', { class: 'stkpanel' });
  const grid = h('div', { class: 'stkgrid' }), tabs = h('div', { class: 'stktabs' }), ttl = h('div', { class: 'stkttl' });
  let close;
  const insert = async (key, mk) => {
    const cv = await mk(); if (!cv) { toast('เครื่องนี้แสดงสติกเกอร์นี้ไม่ได้', 1500); return; }
    prefs.stickerRecent = [key, ...(prefs.stickerRecent || []).filter(k => k !== key)].slice(0, 24); savePrefs();
    close();
    await ed.insertImage(await toFile(cv, 'sticker'), { crop: false, sticker: true });
  };
  const mkBadge = (i) => () => badgeCanvas(BADGES[i][0], BADGES[i][1]);
  const show = (id) => {
    prefs.stickerCat = id; savePrefs();
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.id === id);
    grid.innerHTML = ''; grid.classList.toggle('badges', id === 'badge');
    if (id === 'recent') {
      ttl.textContent = 'ใช้ล่าสุด';
      const rec = prefs.stickerRecent || [];
      if (!rec.length) grid.append(h('div', { class: 'stkempty' }, 'ยังไม่มี · แตะสติกเกอร์เพื่อวางลงหน้า'));
      for (const k of rec) {
        if (k.startsWith('b:')) { const i = +k.slice(2); if (!BADGES[i]) continue; const b = h('button', { class: 'stk badge', style: { background: BADGES[i][1] } }, BADGES[i][0]); b.onclick = () => insert(k, mkBadge(i)); grid.append(b); }
        else { const ch = k.slice(2); const b = h('button', { class: 'stk' }, ch); b.onclick = () => insert(k, () => emojiCanvas(ch)); grid.append(b); }
      }
      return;
    }
    const cat = CATS.find(c => c[0] === id); ttl.textContent = cat[1];
    if (id === 'badge') { BADGES.forEach(([t, col], i) => { const b = h('button', { class: 'stk badge', style: { background: col } }, t); b.onclick = () => insert('b:' + i, mkBadge(i)); grid.append(b); }); return; }
    for (const ch of cat[3]) { const b = h('button', { class: 'stk' }, ch); b.onclick = () => insert('e:' + ch, () => emojiCanvas(ch)); grid.append(b); }
    grid.scrollTop = 0;
  };
  const tb = (id, label, glyph) => { const b = h('button', { class: 'stktab', title: label, 'data-id': id }, glyph); b.onclick = () => show(id); return b; };
  tabs.append(tb('recent', 'ใช้ล่าสุด', '🕘'), ...CATS.map(c => tb(c[0], c[1], c[2])));
  box.append(h('div', { class: 'stkhead' }, h('b', {}, 'สติกเกอร์'), ttl), grid, tabs);
  close = popover(anchor, box, ed.popOpts());
  show(prefs.stickerCat && (prefs.stickerCat === 'recent' || CATS.some(c => c[0] === prefs.stickerCat)) ? prefs.stickerCat : 'badge');
}
