// Ruler and protractor pictures, shared by the teacher screen and the student screen (screen pixels).
export function drawRulerAt(ctx, cx, cy, ang, L, H, mm) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
  const k = Math.max(0.55, Math.min(1.6, H / 84)); // label scale when drawn smaller/bigger on the TV
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-L / 2, -H / 2, L, H, 8 * k) : ctx.rect(-L / 2, -H / 2, L, H);
  ctx.fillStyle = 'rgba(46,50,58,.72)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke();
  const step = mm < 2.2 ? 10 : 1, n = Math.min(4000, Math.floor(L / 2 / mm));
  ctx.beginPath();
  for (let i = -n - (-n % step); i <= n; i += step) {
    const x = i * mm, len = (i % 10 === 0 ? 20 : i % 5 === 0 ? 13 : 7) * k;
    ctx.moveTo(x, -H / 2); ctx.lineTo(x, -H / 2 + len); ctx.moveTo(x, H / 2); ctx.lineTo(x, H / 2 - len);
  }
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `${15 * k}px "TH Sarabun New", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const cmStep = mm * 10 < 26 ? 5 : 1;
  for (let i = -Math.floor(n / 10); i <= n / 10; i++) if (i % cmStep === 0) ctx.fillText(String(Math.abs(i)), i * mm * 10, -H / 2 + 21 * k);
  const deg = Math.round(((-ang * 180 / Math.PI) % 180 + 180) % 180), tx = deg + '°';
  ctx.font = `bold ${20 * k}px "TH Sarabun New", sans-serif`; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(tx).width + 22 * k; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-tw / 2, 6 * k, tw, 26 * k, 13 * k) : ctx.rect(-tw / 2, 6 * k, tw, 26 * k); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
  ctx.fillStyle = '#1E2A55'; ctx.fillText(tx, 0, 20 * k);
  ctx.restore();
}
export function drawProtractorAt(ctx, cx, cy, ang, Rr) {
  const k = Math.max(0.5, Math.min(1.8, Rr / 240));
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(-Rr, 0); ctx.arc(0, 0, Rr, Math.PI, 0); ctx.lineTo(Rr, 12 * k); ctx.lineTo(-Rr, 12 * k); ctx.closePath();
  ctx.fillStyle = 'rgba(46,50,58,.66)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let d = 0; d <= 180; d++) {
    const t = Math.PI + d * Math.PI / 180, len = (d % 10 === 0 ? 16 : d % 5 === 0 ? 10 : 6) * k, c = Math.cos(t), s = Math.sin(t);
    ctx.beginPath(); ctx.moveTo(c * Rr, s * Rr); ctx.lineTo(c * (Rr - len), s * (Rr - len)); ctx.lineWidth = d % 10 ? .8 : 1.2; ctx.stroke();
    if (d % 10 === 0) {
      ctx.font = `${13 * k}px "TH Sarabun New", sans-serif`; ctx.fillText(String(d), c * (Rr - 27 * k), s * (Rr - 27 * k));
      ctx.font = `${11 * k}px "TH Sarabun New", sans-serif`; ctx.globalAlpha = .65; ctx.fillText(String(180 - d), c * (Rr - 44 * k), s * (Rr - 44 * k)); ctx.globalAlpha = 1;
    }
  }
  ctx.beginPath(); ctx.moveTo(-Rr, 0); ctx.lineTo(Rr, 0); ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -Rr * 0.55); ctx.globalAlpha = .4; ctx.stroke(); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(0, 0, 4 * k, 0, Math.PI * 2); ctx.fillStyle = '#F5B83D'; ctx.fill();
  ctx.restore();
}
