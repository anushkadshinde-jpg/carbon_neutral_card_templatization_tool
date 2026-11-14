// Carbon Neutral Gift Card template.
// A 20 x 3.5 in strip, accordion folded into 8 panels of 2.5 x 3.5 in.
//   Front: panel 1 = cover, panels 2-7 = species slots 1-6, panel 8 = info text + QR frame.
//   Back : panels 1-8 = species slots 7-14 (left to right).
// Every species card is placed inside its panel with a 0.5 cm gap on every side.
// Everything is drawn by renderSide(), which the preview and both exporters share.

const ASSETS = 'assets/carbon-neutral/';
const STRIP_W = 20, STRIP_H = 3.5, PANEL_W = 2.5;
const CREAM = '#FBFFDA';
const EDGE = 0.006; // the supplied panel PNGs have a soft 2-3 px edge; this trims it off

// The empty QR square on the info panel, measured on the supplied 544 x 761 px artwork (fractions of the PNG).
const QR_FRAC = { x: 206 / 544, y: 464 / 761, w: 130 / 544 };
// Brown text area of the info panel; the QR is printed in this colour.
const INK_AREA = { x: 0.07, y: 0.07, w: 0.86, h: 0.40 };

const SLOT_DEFS = Array.from({ length: 14 }, (_, i) => (i < 6 ? { side: 'front', panel: i + 1 } : { side: 'back', panel: i - 6 }));
const TICK = { len: 0.07, wid: 0.0139, maxAlpha: 0.6, ink: '100,106,80' }; // inches; fold ticks are drawn by the tool

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  species: [], slots: Array(14).fill(null), qrUrl: '', qr: null, label: '', confirmed: false,
  format: 'png', pdfMode: 'one', dpi: 300, insetCm: 0.5, guides: true, tickPct: 18,
  sel: 0, tab: 'build', libq: '', drag: null, files: [], exporting: false, hidden: [],
};
let QR_INK = '#4B3622', QR_INK_PDF = '0.294 0.212 0.133';

const byId = (id) => S.species.find((s) => s.id === id);
const inset = () => S.insetCm / 2.54;
const inner = () => { const m = inset(); return { m, w: PANEL_W - 2 * m, h: STRIP_H - 2 * m }; };
const fitCard = (sp) => { const b = inner(), a = sp.w / sp.h; let w = b.w, h = w / a; if (h > b.h) { h = b.h; w = h * a; } return { w, h }; };

/* ---------- storage (custom species only; the included ones come from assets/) ---------- */
const store = {
  db: null, mem: new Map(),
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('carbon-card-species', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('species', { keyPath: 'id' });
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    } catch (e) { this.db = null; }
  },
  tx(mode) { return this.db.transaction('species', mode).objectStore('species'); },
  async all() {
    if (!this.db) return [...this.mem.values()];
    try { return await new Promise((res, rej) => { const r = this.tx('readonly').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); } catch (e) { return [...this.mem.values()]; }
  },
  async put(s) {
    this.mem.set(s.id, s); if (!this.db) return;
    try { await new Promise((res, rej) => { const r = this.tx('readwrite').put(s); r.onsuccess = res; r.onerror = () => rej(r.error); }); } catch (e) { /* keep in memory */ }
  },
  async del(id) {
    this.mem.delete(id); if (!this.db) return;
    try { await new Promise((res, rej) => { const r = this.tx('readwrite').delete(id); r.onsuccess = res; r.onerror = () => rej(r.error); }); } catch (e) { /* ignore */ }
  },
};
const DRAFT = 'carbon-card-draft-v2';
function persistDraft() {
  try { localStorage.setItem(DRAFT, JSON.stringify({ slots: S.slots, qrUrl: S.qrUrl, label: S.label, format: S.format, pdfMode: S.pdfMode, dpi: S.dpi, insetCm: S.insetCm, guides: S.guides, tickPct: S.tickPct, hidden: S.hidden })); } catch (e) { /* private mode */ }
}
function loadDraft() {
  try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d) Object.assign(S, d); } catch (e) { /* ignore */ }
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'sp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

/* ---------- images ---------- */
const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not load ' + src)); im.src = src; });
// A single-file build can pre-set window.__CARBON_INLINE = { cover, info, species: [...] } with data: URLs (works from file://).
const INL = window.__CARBON_INLINE || null;
const panelImgs = { cover: loadImg(INL ? INL.cover : ASSETS + 'cover.png'), info: loadImg(INL ? INL.info : ASSETS + 'info.png') };
const imgCache = new Map();
function speciesImg(sp) {
  let e = imgCache.get(sp.id);
  if (!e || e.src !== (sp.blob || sp.url)) {
    if (e && e.blobUrl) URL.revokeObjectURL(e.blobUrl);
    const blobUrl = sp.blob ? URL.createObjectURL(sp.blob) : null, url = blobUrl || sp.url;
    e = { src: sp.blob || sp.url, blobUrl, url, promise: loadImg(url) }; imgCache.set(sp.id, e);
  }
  return e;
}
const thumbUrl = (sp) => speciesImg(sp).url;
function drawPanel(ctx, img, px, W, H) {
  const sx = img.width * EDGE, sy = img.height * EDGE;
  ctx.drawImage(img, sx, sy, img.width - 2 * sx, img.height - 2 * sy, px, 0, W, H);
}
function qrRect() {
  const k = 1 - 2 * EDGE;
  return { x: 7 * PANEL_W + ((QR_FRAC.x - EDGE) / k) * PANEL_W, y: ((QR_FRAC.y - EDGE) / k) * STRIP_H, s: (QR_FRAC.w / k) * PANEL_W };
}
async function sampleInk() {
  try {
    const img = await panelImgs.info, cv = document.createElement('canvas'), w = Math.round(img.width * INK_AREA.w), h = Math.round(img.height * INK_AREA.h);
    cv.width = w; cv.height = h; const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(img, img.width * INK_AREA.x, img.height * INK_AREA.y, w, h, 0, 0, w, h);
    const d = c.getImageData(0, 0, w, h).data; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 100) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (n > 200) { r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n); QR_INK = `rgb(${r},${g},${b})`; QR_INK_PDF = [r, g, b].map((v) => (v / 255).toFixed(3)).join(' '); }
  } catch (e) { /* keep the fallback brown */ }
}

/* ---------- QR ---------- */
function parseLink(t) {
  t = (t || '').trim();
  if (!t) return { empty: true };
  let u = t; if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return { error: 'Use a web link that starts with http or https.' };
    const qr = window.qrcode(0, 'M'); qr.addData(url.href); qr.make();
    const n = qr.getModuleCount(), mm = qrRect().s * 25.4 / n;
    return { ok: true, url: url.href, n, mm, dark: (r, c) => qr.isDark(r, c) };
  } catch (e) { return { error: 'This link could not be turned into a QR code. Check it for typos, or use a shorter link.' }; }
}
function paintQR(ctx, q, x, y, size) {
  const n = q.n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.dark(r, c)) {
    const x0 = Math.round(x + c * size / n), x1 = Math.round(x + (c + 1) * size / n), y0 = Math.round(y + r * size / n), y1 = Math.round(y + (r + 1) * size / n);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

/* ---------- rendering ---------- */
async function renderSide(side, o) {
  const ppi = o.ppi, W = Math.round(STRIP_W * ppi), H = Math.round(STRIP_H * ppi), pw = PANEL_W * ppi;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = CREAM; ctx.fillRect(0, 0, W, H);
  if (side === 'front') {
    drawPanel(ctx, await panelImgs.cover, 0, Math.round(pw), H);
    drawPanel(ctx, await panelImgs.info, Math.round(7 * pw), Math.round(W - 7 * pw), H);
  }
  // fold ticks: part of the print, very faint, only a folding reference
  if (S.tickPct > 0) {
    const tw = Math.max(1, Math.round(TICK.wid * ppi)), tl = Math.round(TICK.len * ppi);
    ctx.fillStyle = `rgba(${TICK.ink},${(S.tickPct / 100 * TICK.maxAlpha).toFixed(3)})`;
    for (let k = 1; k < 8; k++) { const x = Math.round(k * pw - tw / 2); ctx.fillRect(x, 0, tw, tl); ctx.fillRect(x, H - tl, tw, tl); }
  }
  for (let i = 0; i < 14; i++) {
    const d = SLOT_DEFS[i]; if (d.side !== side) continue;
    const sp = S.slots[i] && byId(S.slots[i]); if (!sp) continue;
    let im; try { im = await speciesImg(sp).promise; } catch (e) { continue; }
    const f = fitCard(sp);
    ctx.drawImage(im, Math.round((d.panel * PANEL_W + (PANEL_W - f.w) / 2) * ppi), Math.round(((STRIP_H - f.h) / 2) * ppi), Math.round(f.w * ppi), Math.round(f.h * ppi));
  }
  const qf = qrRect();
  if (side === 'front' && o.qr !== false && S.qr && S.qr.ok) { ctx.fillStyle = QR_INK; paintQR(ctx, S.qr, qf.x * ppi, qf.y * ppi, qf.s * ppi); }
  if (o.preview) drawOverlay(ctx, side, ppi, W, H, qf);
  return cv;
}
function drawOverlay(ctx, side, ppi, W, H, qf) {
  const m = inset(), ib = inner(), lw = Math.max(1.5, ppi * 0.014);
  ctx.save(); ctx.lineWidth = lw;
  if (S.guides) {
    ctx.setLineDash([ppi * 0.07, ppi * 0.05]); ctx.strokeStyle = 'rgba(9,78,65,.6)';
    for (let k = 1; k < 8; k++) { const x = Math.round(k * PANEL_W * ppi) + .5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(205,140,10,.95)';
    for (let i = 0; i < 14; i++) { const d = SLOT_DEFS[i]; if (d.side === side) ctx.strokeRect((d.panel * PANEL_W + m) * ppi, m * ppi, ib.w * ppi, ib.h * ppi); }
    if (side === 'front') ctx.strokeRect(qf.x * ppi, qf.y * ppi, qf.s * ppi, qf.s * ppi);
  }
  ctx.setLineDash([]);
  for (let i = 0; i < 14; i++) {
    const d = SLOT_DEFS[i]; if (d.side !== side) continue;
    const px = d.panel * PANEL_W * ppi, sp = S.slots[i] && byId(S.slots[i]);
    if (!sp) {
      ctx.save(); ctx.setLineDash([ppi * 0.08, ppi * 0.06]); ctx.strokeStyle = 'rgba(60,90,70,.55)'; ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.fillRect(px + m * ppi, m * ppi, ib.w * ppi, ib.h * ppi); ctx.strokeRect(px + m * ppi, m * ppi, ib.w * ppi, ib.h * ppi);
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(40,60,48,.8)'; ctx.textAlign = 'center'; ctx.font = '600 ' + ppi * 0.17 + 'px Inter,system-ui,sans-serif';
      ctx.fillText('Slot ' + (i + 1), px + PANEL_W * ppi / 2, STRIP_H * ppi / 2); ctx.font = ppi * 0.12 + 'px Inter,system-ui,sans-serif'; ctx.fillText('empty', px + PANEL_W * ppi / 2, STRIP_H * ppi / 2 + ppi * 0.2);
      ctx.restore();
    }
    const cx = px + 0.125 * ppi, cy = 0.125 * ppi, r = ppi * 0.115;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fillStyle = i === S.sel ? '#16A37F' : 'rgba(6,51,46,.88)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 ' + ppi * 0.12 + 'px Inter,system-ui,sans-serif'; ctx.fillText(String(i + 1), cx, cy + ppi * 0.005); ctx.textBaseline = 'alphabetic';
    if (i === S.sel) { ctx.strokeStyle = '#16A37F'; ctx.lineWidth = ppi * 0.045; ctx.strokeRect(px + ppi * 0.03, ppi * 0.03, PANEL_W * ppi - ppi * 0.06, STRIP_H * ppi - ppi * 0.06); ctx.lineWidth = lw; }
    if (S.drag && S.drag.over === i && S.drag.from !== i) { ctx.fillStyle = 'rgba(22,163,127,.28)'; ctx.fillRect(px, 0, PANEL_W * ppi, STRIP_H * ppi); }
  }
  if (side === 'front' && !(S.qr && S.qr.ok)) {
    ctx.fillStyle = 'rgba(40,60,48,.8)'; ctx.textAlign = 'center'; ctx.font = '600 ' + ppi * 0.1 + 'px Inter,system-ui,sans-serif';
    ctx.fillText('QR', (qf.x + qf.s / 2) * ppi, (qf.y + qf.s / 2) * ppi);
  }
  ctx.restore();
}
let pvTok = 0, pvQueued = false;
function schedulePreview() { if (pvQueued) return; pvQueued = true; requestAnimationFrame(() => { pvQueued = false; renderPreview(); }); }
async function renderPreview() {
  if (S.tab !== 'build') return;
  const tok = ++pvTok;
  for (const side of ['front', 'back']) {
    const canvas = $('#cn-cv-' + side), cssW = Math.max(720, canvas.parentElement.clientWidth || 720);
    const ppi = Math.min(150, Math.max(40, cssW * Math.min(2, window.devicePixelRatio || 1) / STRIP_W));
    const cv = await renderSide(side, { ppi, preview: true });
    if (tok !== pvTok) return;
    canvas.width = cv.width; canvas.height = cv.height; canvas.getContext('2d').drawImage(cv, 0, 0);
  }
}

/* ---------- species slots ---------- */
const pickable = () => S.species.filter((s) => !S.hidden.includes(s.id) && !s.retired);
function buildSlots() {
  const host = $('#cn-slots'); host.innerHTML = '';
  const group = (t) => { const g = document.createElement('div'); g.className = 'cn-group'; g.textContent = t; host.appendChild(g); };
  for (let i = 0; i < 14; i++) {
    if (i === 0) group('Front · panels 2–7');
    if (i === 6) group('Back · panels 1–8');
    const row = document.createElement('div'); row.className = 'cn-slot'; row.dataset.i = i;
    row.innerHTML = '<span class="cn-grip" title="Drag to reorder" aria-label="Drag to reorder slot ' + (i + 1) + '"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg></span>' +
      '<span class="cn-n" aria-hidden="true">' + (i + 1) + '</span><span class="cn-thumb"></span>' +
      '<div class="cn-cb"><input class="cn-in" id="cn-in-' + i + '" type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="Species for slot ' + (i + 1) + '" placeholder="Choose a species" autocomplete="off"><button class="cn-chev" type="button" tabindex="-1" aria-label="Open species list">▾</button></div>' +
      '<button class="icon cn-clr" type="button" aria-label="Clear slot ' + (i + 1) + '" title="Clear slot">×</button><div class="cn-note" hidden></div>';
    host.appendChild(row);
  }
  host.addEventListener('click', (e) => {
    const row = e.target.closest('.cn-slot'); if (!row) return; const i = +row.dataset.i;
    if (e.target.closest('.cn-clr')) setSlot(i, null);
    else if (e.target.classList.contains('cn-in')) { if (cb.i !== i || $('#cn-list').hidden) openList(i, '', true); }
    else if (e.target.closest('.cn-chev')) { $('#cn-in-' + i).focus(); cb.i === i && !$('#cn-list').hidden ? closeList() : openList(i, '', true); }
  });
  host.addEventListener('focusin', (e) => { const row = e.target.closest('.cn-slot'); if (row && +row.dataset.i !== S.sel) selectSlot(+row.dataset.i, false); if (e.target.classList.contains('cn-in')) openList(+row.dataset.i, '', true); });
  host.addEventListener('input', (e) => { if (e.target.classList.contains('cn-in')) openList(+e.target.closest('.cn-slot').dataset.i, e.target.value, false); });
  host.addEventListener('keydown', (e) => { if (e.target.classList.contains('cn-in')) comboKey(e, +e.target.closest('.cn-slot').dataset.i); });
  host.addEventListener('focusout', (e) => { if (e.target.classList.contains('cn-in')) setTimeout(() => { if (document.activeElement !== e.target) { closeList(); updateRow(+e.target.closest('.cn-slot').dataset.i); } }, 120); });
  // drag the hamburger handle to reorder (pointer events, so it also works by touch)
  let gd = null;
  const rowAt = (x, y) => { const el = document.elementFromPoint(x, y), r = el && el.closest && el.closest('.cn-slot'); return r && host.contains(r) ? r : null; };
  host.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.cn-grip'); if (!g) return; e.preventDefault();
    const row = g.closest('.cn-slot'); gd = { from: +row.dataset.i, over: +row.dataset.i, row }; row.classList.add('dragging'); document.body.classList.add('cn-dragging');
    try { g.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
  });
  host.addEventListener('pointermove', (e) => {
    if (!gd) return; const r = rowAt(e.clientX, e.clientY);
    if (r) { gd.over = +r.dataset.i; $$('.cn-slot.over', host).forEach((x) => x.classList.remove('over', 'above', 'below')); if (gd.over !== gd.from) r.classList.add('over', gd.over < gd.from ? 'above' : 'below'); }
    if (e.clientY < 70) scrollBy(0, -12); else if (e.clientY > innerHeight - 70) scrollBy(0, 12);
  });
  const endDrag = (cancel) => {
    if (!gd) return; const d = gd; gd = null; d.row.classList.remove('dragging'); document.body.classList.remove('cn-dragging'); $$('.cn-slot.over', host).forEach((x) => x.classList.remove('over', 'above', 'below'));
    if (!cancel && d.over !== d.from) moveSlot(d.from, d.over);
  };
  host.addEventListener('pointerup', () => endDrag(false)); host.addEventListener('pointercancel', () => endDrag(true));
}
function updateRow(i) {
  const row = $('.cn-slot[data-i="' + i + '"]'); if (!row) return;
  const sp = S.slots[i] && byId(S.slots[i]), inp = $('.cn-in', row), th = $('.cn-thumb', row), note = $('.cn-note', row);
  if (document.activeElement !== inp) inp.value = sp ? sp.name : '';
  th.innerHTML = sp ? '<img alt="" src="' + thumbUrl(sp) + '">' : '';
  row.classList.toggle('sel', i === S.sel);
  $('.cn-clr', row).disabled = !sp;
  const msgs = [];
  if (sp) { const f = fitCard(sp), eff = sp.w / f.w; if (eff < 200) msgs.push('Low resolution: about ' + Math.round(eff) + ' DPI at this size.'); }
  note.hidden = !msgs.length; note.textContent = msgs.join(' ');
}
const updateAllRows = () => { for (let i = 0; i < 14; i++) updateRow(i); };
function selectSlot(i, focus) {
  S.sel = i; $$('.cn-slot').forEach((r) => r.classList.toggle('sel', +r.dataset.i === i)); schedulePreview();
  if (focus) { const inp = $('#cn-in-' + i); inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); inp.focus(); inp.select(); }
}
function changed() { S.confirmed = false; persistDraft(); updateAllRows(); schedulePreview(); renderReview(); renderExport(); renderLibrary(); }
function setSlot(i, id) { S.slots[i] = id; changed(); }
function moveSlot(a, b) { if (a === b || a < 0 || b < 0 || a > 13 || b > 13) return; const [x] = S.slots.splice(a, 1); S.slots.splice(b, 0, x); S.sel = b; changed(); }
function swapSlots(a, b) { if (a === b || a < 0 || b < 0) return; const t = S.slots[a]; S.slots[a] = S.slots[b]; S.slots[b] = t; S.sel = b; changed(); }

/* ---------- species picker (combobox) ---------- */
const cb = { i: -1, items: [], active: -1 };
const nameKey = (s) => (s.name + ' ' + (s.local || '') + ' ' + (s.botanical || '')).toLowerCase();
function filterSpecies(q) {
  q = q.trim().toLowerCase();
  let list = pickable(); if (q) list = list.filter((s) => nameKey(s).includes(q));
  return list.sort((a, b) => { const as = q && a.name.toLowerCase().startsWith(q) ? 0 : 1, bs = q && b.name.toLowerCase().startsWith(q) ? 0 : 1; return as - bs || a.name.localeCompare(b.name) || (a.frame || 0) - (b.frame || 0); });
}
function openList(i, q, all) {
  cb.i = i; cb.items = filterSpecies(all ? '' : q); cb.active = cb.items.length ? 0 : -1;
  const lb = $('#cn-list'), inp = $('#cn-in-' + i), r = inp.getBoundingClientRect();
  lb.hidden = false; lb.style.width = Math.max(300, r.width) + 'px'; paintList();
  const h = Math.min(320, lb.scrollHeight + 10), below = innerHeight - r.bottom;
  lb.style.left = Math.min(r.left, innerWidth - lb.offsetWidth - 8) + 'px';
  lb.style.top = (below > h + 12 || below > r.top ? r.bottom + 4 : r.top - h - 4) + 'px';
  inp.setAttribute('aria-expanded', 'true');
}
function paintList() {
  const lb = $('#cn-list');
  if (!cb.items.length) { lb.innerHTML = '<div class="cn-empty">No species match. Add it in the Species library.</div>'; return; }
  lb.innerHTML = cb.items.map((s, k) => '<button type="button" class="cn-opt" role="option" id="cn-opt-' + k + '" data-k="' + k + '" aria-selected="' + (k === cb.active) + '"><span class="t"><img alt="" loading="lazy" src="' + thumbUrl(s) + '"></span><span><b>' + esc(s.name) + '</b><small>' + esc([s.local, s.botanical].filter(Boolean).join(' · ')) + '</small></span>' + (s.builtin ? '' : '<span class="cn-tag">Added</span>') + '</button>').join('');
}
function closeList() { const lb = $('#cn-list'); lb.hidden = true; if (cb.i >= 0) { const inp = $('#cn-in-' + cb.i); if (inp) inp.setAttribute('aria-expanded', 'false'); } cb.i = -1; }
function pick(k) { const s = cb.items[k], i = cb.i; if (!s) return; closeList(); setSlot(i, s.id); }
function comboKey(e, i) {
  const open = !$('#cn-list').hidden && cb.i === i, move = (d) => { cb.active = Math.max(0, Math.min(cb.items.length - 1, cb.active + d)); paintList(); $('#cn-opt-' + cb.active)?.scrollIntoView({ block: 'nearest' }); };
  if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) openList(i, e.target.value, true); else move(1); }
  else if (e.key === 'ArrowUp' && open) { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter' && open) { e.preventDefault(); pick(cb.active); }
  else if (e.key === 'Escape' && open) { e.preventDefault(); closeList(); updateRow(i); }
}

/* ---------- QR step ---------- */
let qrTimer = 0;
function applyQR() {
  const r = parseLink(S.qrUrl); S.qr = r.ok ? r : null;
  const msg = $('#cn-qr-msg'), info = $('#cn-qr-info'), cv = $('#cn-qr-prev'), ctx = cv.getContext('2d');
  ctx.fillStyle = CREAM; ctx.fillRect(0, 0, cv.width, cv.height);
  if (r.ok) {
    ctx.fillStyle = QR_INK; paintQR(ctx, r, 8, 8, cv.width - 16);
    const warn = r.mm < 0.4;
    msg.className = 'cn-msg ' + (warn ? 'warn' : 'ok');
    msg.textContent = warn ? 'This link is long. The code prints with small dots and may scan poorly. A shorter link scans better.' : 'QR code ready and placed on the front.';
    info.textContent = r.url + '\n' + r.n + ' × ' + r.n + ' modules · dots ' + r.mm.toFixed(2) + ' mm · frame ' + (qrRect().s * 2.54).toFixed(1) + ' cm';
  } else { msg.className = 'cn-msg ' + (r.error ? 'err' : ''); msg.textContent = r.error || ''; info.textContent = ''; }
}
function onQR() { S.qrUrl = $('#cn-qr-url').value; clearTimeout(qrTimer); qrTimer = setTimeout(() => { applyQR(); changed(); }, 180); }

/* ---------- review + export UI ---------- */
function analyze() {
  const empty = [], low = []; const ideal = inner().w / inner().h;
  S.slots.forEach((id, i) => { const sp = id && byId(id); if (!sp) { empty.push(i + 1); return; } const f = fitCard(sp); if (sp.w / f.w < 200) low.push(sp.name); void ideal; });
  return { empty, low, filled: 14 - empty.length };
}
function renderReview() {
  const a = analyze(), qrOk = !!(S.qr && S.qr.ok), ul = $('#cn-checks'), li = [];
  li.push([a.empty.length ? 'warn' : 'info', a.filled + ' of 14 slots filled' + (a.empty.length ? '. Empty slots print blank: ' + a.empty.join(', ') + '.' : '.')]);
  li.push([qrOk ? 'info' : 'warn', qrOk ? 'QR code is in place on the front.' : 'Add the link to the grove to generate the QR code.']);
  if (a.low.length) li.push(['warn', 'Low resolution at this size: ' + a.low.join(', ') + '.']);
  if (S.qr && S.qr.mm < 0.4) li.push(['warn', 'QR dots are small. Test-scan a printed proof.']);
  ul.innerHTML = li.map((x) => '<li class="' + x[0] + '">' + esc(x[1]) + '</li>').join('');
  $('#cn-confirm-btn').disabled = !qrOk;
  $('#cn-confirm-btn').textContent = S.confirmed ? 'Confirmed' : 'Confirm layout';
  $('#cn-confirm-btn').classList.toggle('primary', !S.confirmed || true);
  const st = $('#cn-confirm-state'); st.textContent = S.confirmed ? 'Layout confirmed' : 'Not confirmed'; st.className = 'cn-chip' + (S.confirmed ? '' : ' off');
  $('#cn-export-panel').classList.toggle('locked', !S.confirmed);
}
const fileBase = () => (S.label || 'order').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'order';
function renderExport() {
  $('#cn-export-btn').disabled = !(S.confirmed && S.label.trim() && !S.exporting);
  $('#cn-export-hint').textContent = S.confirmed ? (S.label.trim() ? 'Ready to export.' : 'Give the order a label to name the files.') : 'Confirm the layout to unlock export.';
  $('#cn-pdfopt').hidden = S.format !== 'pdf';
  $$('input[name=cn-fmt]').forEach((r) => { r.checked = r.value === S.format; });
  $('#cn-dpi').value = String(S.dpi); $('#cn-pdfmode').value = S.pdfMode;
  $('#cn-dims').textContent = STRIP_W + ' × ' + STRIP_H + ' in at ' + S.dpi + ' DPI = ' + Math.round(STRIP_W * S.dpi) + ' × ' + Math.round(STRIP_H * S.dpi) + ' px';
  $('#cn-export-btn').lastChild.textContent = S.format === 'pdf' ? (S.pdfMode === 'one' ? ' Export PDF' : ' Export 2 PDFs') : ' Export 2 PNGs';
  const b = inner(); $('#cn-insetnote').textContent = 'Card area ' + b.w.toFixed(2) + ' × ' + b.h.toFixed(2) + ' in (' + (b.w * 2.54).toFixed(2) + ' × ' + (b.h * 2.54).toFixed(2) + ' cm).';
  $('#cn-name-prev').innerHTML = 'Files will be named like <code>' + esc(fileBase()) + '_front_' + stamp() + '.' + S.format + '</code>';
}

/* ---------- export ---------- */
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8, c = 0xFFFFFFFF) => { for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return c; };
function pngWithDpi(buf, dpi) {
  const u = new Uint8Array(buf), ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, (crc32(chunk.subarray(4, 17)) ^ 0xFFFFFFFF) >>> 0);
  const out = new Uint8Array(u.length + 21); out.set(u.subarray(0, 33), 0); out.set(chunk, 33); out.set(u.subarray(33), 54); return out;
}
async function deflate(u8) { const cs = new CompressionStream('deflate'), w = cs.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
async function buildPDF(pages) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = (d) => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  const obj = (n, dict, stream) => { offs[n] = len; push(n + ' 0 obj\n'); if (stream) { push('<< ' + dict + ' /Length ' + stream.length + ' >>\nstream\n'); push(stream); push('\nendstream\n'); } else push(dict + '\n'); push('endobj\n'); };
  const kids = pages.map((_, i) => (3 + 3 * i) + ' 0 R').join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
  const pw = STRIP_W * 72, ph = STRIP_H * 72, f = (v) => (+v.toFixed(3)).toString(), qf = qrRect();
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i], cv = pg.canvas, W = cv.width, H = cv.height;
    const rgba = cv.getContext('2d').getImageData(0, 0, W, H).data, rgb = new Uint8Array(W * H * 3);
    for (let p = 0, q = 0; p < rgba.length; p += 4) { rgb[q++] = rgba[p]; rgb[q++] = rgba[p + 1]; rgb[q++] = rgba[p + 2]; }
    let data, filter;
    if (typeof CompressionStream !== 'undefined') { data = await deflate(rgb); filter = '/Filter /FlateDecode'; }
    else { const jb = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.95)); data = new Uint8Array(await jb.arrayBuffer()); filter = '/Filter /DCTDecode'; }
    let cs = 'q ' + f(pw) + ' 0 0 ' + f(ph) + ' 0 0 cm /Im0 Do Q\n';
    if (pg.qr) { // the QR is vector in the PDF, so it stays razor sharp at any size
      const q = pg.qr, s = qf.s / q.n; cs += QR_INK_PDF + ' rg\n';
      for (let r = 0; r < q.n; r++) for (let c = 0; c < q.n; c++) if (q.dark(r, c)) cs += f((qf.x + c * s) * 72) + ' ' + f(ph - (qf.y + (r + 1) * s) * 72) + ' ' + f(s * 72 + 0.04) + ' ' + f(s * 72 + 0.04) + ' re\n';
      cs += 'f\n';
    }
    obj(3 + 3 * i, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(pw) + ' ' + f(ph) + '] /Resources << /XObject << /Im0 ' + (5 + 3 * i) + ' 0 R >> >> /Contents ' + (4 + 3 * i) + ' 0 R >>');
    obj(4 + 3 * i, '', enc.encode(cs));
    obj(5 + 3 * i, '/Type /XObject /Subtype /Image /Width ' + W + ' /Height ' + H + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 ' + filter, data);
  }
  const n = 3 + 3 * pages.length, xr = len; let x = 'xref\n0 ' + n + '\n0000000000 65535 f \n';
  for (let i = 1; i < n; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + 'trailer\n<< /Size ' + n + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF\n');
  return new Blob(parts, { type: 'application/pdf' });
}
async function buildZip(files) {
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  const d = new Date(), dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = (crc32(data) ^ 0xFFFFFFFF) >>> 0;
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    cen.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
  }
  const csize = cen.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cen, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
const stamp = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
async function doExport() {
  S.exporting = true; S.files.forEach((f) => f.url && URL.revokeObjectURL(f.url)); S.files = []; renderExport(); renderFiles();
  const st = $('#cn-status'), ppi = S.dpi, base = fileBase(), date = stamp(), out = [];
  $('#cn-progress').hidden = false;
  try {
    const cvs = {};
    for (const side of ['front', 'back']) { st.textContent = 'Rendering ' + side + '…'; cvs[side] = await renderSide(side, { ppi, qr: S.format === 'png' }); }
    if (S.format === 'png') {
      for (const side of ['front', 'back']) {
        st.textContent = 'Encoding ' + side + '…';
        const blob = await new Promise((r) => cvs[side].toBlob(r, 'image/png')), buf = await blob.arrayBuffer();
        out.push({ name: base + '_' + side + '_' + date + '.png', blob: new Blob([pngWithDpi(buf, ppi)], { type: 'image/png' }), side });
      }
    } else {
      const pg = (side) => ({ canvas: cvs[side], qr: side === 'front' && S.qr && S.qr.ok ? S.qr : null });
      st.textContent = 'Building PDF…';
      if (S.pdfMode === 'one') out.push({ name: base + '_' + date + '.pdf', blob: await buildPDF([pg('front'), pg('back')]), side: 'both' });
      else for (const side of ['front', 'back']) out.push({ name: base + '_' + side + '_' + date + '.pdf', blob: await buildPDF([pg(side)]), side });
    }
    out.forEach((f) => { if (f.blob.type === 'image/png') f.url = URL.createObjectURL(f.blob); });
    S.files = out; st.textContent = 'Files ready.';
  } catch (e) { console.error(e); st.textContent = 'Export failed: ' + (e && e.message || e); }
  S.exporting = false; renderExport(); renderFiles();
}
function plainSave(name, blob) {
  const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
}
function renderFiles() {
  const host = $('#cn-files'); host.innerHTML = ''; $('#cn-results').hidden = !S.files.length;
  S.files.forEach((f, k) => {
    const d = document.createElement('div'); d.className = 'file-tile';
    d.innerHTML = (f.url ? '<img alt="" src="' + f.url + '">' : '') + '<div class="name">' + esc(f.name) + '</div><div class="meta">' + fmtSize(f.blob.size) + '</div><button class="btn sm" data-k="' + k + '">Download</button>';
    host.appendChild(d);
  });
  $('#cn-zip').hidden = S.files.length < 2;
}

/* ---------- species library ---------- */
function renderLibrary() {
  $('#cn-libcount').textContent = '(' + S.species.length + ')';
  if (S.tab !== 'library') return;
  const q = S.libq.trim().toLowerCase(), list = S.species.filter((s) => !q || nameKey(s).includes(q)).sort((a, b) => a.name.localeCompare(b.name) || (a.frame || 0) - (b.frame || 0));
  const used = (id) => S.slots.filter((s) => s === id).length;
  $('#cn-libnote').textContent = S.species.length + ' species · cards fit a ' + inner().w.toFixed(2) + ' × ' + inner().h.toFixed(2) + ' in area (ratio ' + (inner().w / inner().h).toFixed(3) + ':1).';
  $('#cn-libgrid').innerHTML = list.map((s) => '<button type="button" class="cn-sp" data-id="' + esc(s.id) + '"><div class="img"><img alt="" loading="lazy" src="' + thumbUrl(s) + '"></div><b>' + esc(s.name) + '</b><small>' + esc([s.local, s.botanical].filter(Boolean).join(' · ')) + '</small><span class="cn-tags">' + (s.builtin ? '' : '<span class="cn-tag">Added</span>') + (S.hidden.includes(s.id) ? '<span class="cn-tag off">Hidden</span>' : '') + (used(s.id) ? '<span class="cn-tag">In ' + used(s.id) + ' slot' + (used(s.id) > 1 ? 's' : '') + '</span>' : '') + '</span></button>').join('') || '<p class="cn-msg">No species match.</p>';
}
const dlgState = { id: null, blob: null, w: 0, h: 0, delArmed: false };
function openDialog(id) {
  const sp = id && byId(id), dlg = $('#cn-dlg'); Object.assign(dlgState, { id, blob: null, w: sp ? sp.w : 0, h: sp ? sp.h : 0, delArmed: false });
  $('#cn-dlg-title').textContent = sp ? sp.name : 'Add species';
  $('#cn-d-name').value = sp ? sp.name : ''; $('#cn-d-local').value = sp ? sp.local || '' : ''; $('#cn-d-bot').value = sp ? sp.botanical || '' : '';
  const builtin = !!(sp && sp.builtin);
  $('#cn-d-file-wrap').hidden = builtin; for (const el of ['#cn-d-name', '#cn-d-local', '#cn-d-bot']) $(el).disabled = builtin;
  $('#cn-d-hidden').checked = !!(sp && S.hidden.includes(sp.id)); $('#cn-d-hidden-wrap').hidden = !sp;
  $('#cn-d-img').hidden = !sp; if (sp) $('#cn-d-img').src = thumbUrl(sp);
  $('#cn-d-meta').textContent = sp ? sp.w + ' × ' + sp.h + ' px' + (sp.builtin ? ' · included in the repository' : '') : 'PNG or JPG, about 5 : 7 (portrait).';
  $('#cn-d-err').hidden = true; $('#cn-d-del').hidden = !(sp && !builtin); $('#cn-d-del').textContent = 'Delete';
  dlg.showModal();
}
async function imgDims(file) { const u = URL.createObjectURL(file); try { const im = await loadImg(u); return { w: im.naturalWidth, h: im.naturalHeight }; } finally { URL.revokeObjectURL(u); } }
async function saveDialog() {
  const err = $('#cn-d-err'), sp = dlgState.id && byId(dlgState.id), name = $('#cn-d-name').value.trim();
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  if (sp && sp.builtin) { const h = $('#cn-d-hidden').checked; S.hidden = S.hidden.filter((x) => x !== sp.id); if (h) S.hidden.push(sp.id); $('#cn-dlg').close(); persistDraft(); renderLibrary(); return; }
  if (!name) return fail('Enter the species name.');
  if (!sp && !dlgState.blob) return fail('Choose a card image.');
  const rec = sp ? { ...sp } : { id: uid(), builtin: false, sample: false };
  Object.assign(rec, { name, local: $('#cn-d-local').value.trim(), botanical: $('#cn-d-bot').value.trim(), updated: Date.now() });
  if (dlgState.blob) Object.assign(rec, { blob: dlgState.blob, w: dlgState.w, h: dlgState.h });
  const h = $('#cn-d-hidden').checked; S.hidden = S.hidden.filter((x) => x !== rec.id); if (h) S.hidden.push(rec.id);
  await store.put(rec); const k = S.species.findIndex((s) => s.id === rec.id); if (k >= 0) S.species[k] = rec; else S.species.push(rec);
  $('#cn-dlg').close(); changed();
}
async function deleteSpecies(id) { await store.del(id); S.species = S.species.filter((s) => s.id !== id); S.slots = S.slots.map((s) => (s === id ? null : s)); const e = imgCache.get(id); if (e && e.blobUrl) URL.revokeObjectURL(e.blobUrl); imgCache.delete(id); }

/* ---------- preview pointer interaction ---------- */
function panelAt(canvas, ev) { const r = canvas.getBoundingClientRect(), p = Math.min(7, Math.max(0, Math.floor((ev.clientX - r.left) / r.width * 8))), side = canvas.id === 'cn-cv-front' ? 'front' : 'back'; return SLOT_DEFS.findIndex((d) => d.side === side && d.panel === p); }
function wirePreview() {
  ['front', 'back'].forEach((side) => {
    const cv = $('#cn-cv-' + side);
    cv.addEventListener('pointerdown', (e) => { const i = panelAt(cv, e); if (i < 0) return; S.drag = { from: i, over: i, moved: false, sx: e.clientX, sy: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (!S.drag) return; const i = panelAt(cv, e); if (Math.abs(e.clientX - S.drag.sx) + Math.abs(e.clientY - S.drag.sy) > 8) S.drag.moved = true; if (S.drag.moved && S.drag.over !== i) { S.drag.over = i; schedulePreview(); } });
    const end = (cancel) => { if (!S.drag) return; const d = S.drag; S.drag = null; if (!cancel && d.moved && d.over >= 0 && d.over !== d.from) swapSlots(d.from, d.over); else if (!d.moved && d.from >= 0) selectSlot(d.from, true); else schedulePreview(); };
    cv.addEventListener('pointerup', () => end(false)); cv.addEventListener('pointercancel', () => end(true));
  });
}

/* ---------- markup ---------- */
const MARKUP = `
<header class="page-head"><h1>Carbon Neutral Card Template</h1></header>
<nav class="tabs" aria-label="Sections"><ol id="cn-tabs">
  <li data-tab="build" class="active" tabindex="0" role="tab">Build card</li>
  <li data-tab="library" tabindex="0" role="tab">Species library <span id="cn-libcount" class="muted"></span></li>
</ol></nav>

<div id="cn-build" class="cn-build">
  <section class="panel" id="cn-preview">
    <div class="panel-head">
      <div><h2>Card preview</h2><p class="muted small" id="cn-dims" style="margin:6px 0 0"></p></div>
      <label class="check"><input type="checkbox" id="cn-guides" checked> Show fold, margin and QR guides</label>
    </div>
    <div class="cn-strip"><div class="cn-slabel"><span>Front</span><span>Cover · slots 1–6 · info + QR</span></div><div class="cn-stripwrap"><canvas id="cn-cv-front" aria-label="Front of the card"></canvas></div></div>
    <div class="cn-strip"><div class="cn-slabel"><span>Back</span><span>Slots 7–14</span></div><div class="cn-stripwrap"><canvas id="cn-cv-back" aria-label="Back of the card"></canvas></div></div>
  </section>

  <div class="cn-cols">
    <section class="panel cn-left" id="cn-species">
      <div class="panel-head"><h2><span class="num">1</span> Species</h2></div>
      <div id="cn-slots"></div>
      <details class="cn-set"><summary>Layout settings</summary>
        <div class="cn-row"><label for="cn-inset" class="field-label">Gap around each species card (cm)</label><input id="cn-inset" type="number" min="0.2" max="1.5" step="0.1" class="cn-num"></div>
        <p class="muted small" id="cn-insetnote"></p>
        <div class="cn-row"><label for="cn-tick" class="field-label">Fold tick strength</label><input id="cn-tick" type="range" min="0" max="100" step="2" class="zoom" style="max-width:180px"><span class="muted small" id="cn-tickv"></span></div>
        <p class="muted small">The small ticks at each fold print very faint and only help with folding after printing. 0% removes them.</p>
      </details>
    </section>

    <div class="cn-right">
      <section class="panel" id="cn-qr-panel">
        <div class="panel-head"><div><h2><span class="num">2</span> QR code</h2>
          <p class="hint">Add link to the grove to generate QR</p></div></div>
        <div class="field"><input id="cn-qr-url" type="text" placeholder="https://…" aria-label="Link to the grove" autocomplete="off"></div>
        <div class="cn-qrbox"><canvas id="cn-qr-prev" width="150" height="150" aria-label="QR preview"></canvas><div><p id="cn-qr-msg" class="cn-msg"></p><p id="cn-qr-info" class="muted small" style="white-space:pre-wrap;overflow-wrap:anywhere"></p></div></div>
      </section>

      <section class="panel" id="cn-confirm-panel">
        <div class="panel-head"><h2><span class="num">3</span> Check and confirm</h2></div>
        <ul class="checks" id="cn-checks"></ul>
        <div class="confirm-bar"><span id="cn-confirm-state" class="cn-chip off">Not confirmed</span><div class="bar-actions"><button class="btn primary" id="cn-confirm-btn" type="button">Confirm layout</button></div></div>
      </section>

      <section class="panel locked" id="cn-export-panel">
        <div class="panel-head"><div><h2><span class="num">4</span> File name and export</h2><p class="hint" id="cn-export-hint"></p></div></div>
        <div class="form-grid">
          <div class="field"><input id="cn-label" type="text" placeholder="e.g. Order-1042" aria-label="Order label" autocomplete="off" maxlength="60"><p class="muted small" id="cn-name-prev"></p></div>
          <fieldset class="field"><legend>Format</legend><div class="formats">
            <label class="format"><input type="radio" name="cn-fmt" value="png"><strong>PNG</strong></label>
            <label class="format"><input type="radio" name="cn-fmt" value="pdf"><strong>PDF</strong></label></div></fieldset>
          <div class="cn-row">
            <label class="fill-pick"><span class="field-label">Resolution</span><select id="cn-dpi"><option value="300">300 DPI (6000 × 1050 px)</option><option value="600">600 DPI, highest (12000 × 2100 px)</option></select></label>
            <label class="fill-pick" id="cn-pdfopt" hidden><span class="field-label">PDF layout</span><select id="cn-pdfmode"><option value="one">One file, front then back</option><option value="two">Two files, one per side</option></select></label>
          </div>
        </div>
        <div class="confirm-bar"><span class="muted small" id="cn-status" role="status"></span><div class="bar-actions">
          <button class="btn primary big" id="cn-export-btn" type="button" disabled><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="m12 16-5-5 1.4-1.45 2.6 2.6V4h2v8.15l2.6-2.6L17 11l-5 5Zm-6 4q-.825 0-1.412-.587Q4 18.825 4 18v-3h2v3h12v-3h2v3q0 .825-.587 1.413Q18.825 20 18 20H6Z"/></svg> Export 2 PNGs</button></div></div>
        <div id="cn-progress" hidden></div>
        <div id="cn-results" hidden>
          <div class="files cn-files" id="cn-files"></div>
          <div class="confirm-bar"><div class="bar-actions"><button class="btn primary" id="cn-zip" type="button">Download all (.zip)</button></div></div>
        </div>
      </section>
    </div>
  </div>
</div>

<div id="cn-library" class="cn-lib" hidden>
  <section class="panel">
    <div class="panel-head"><div><h2>Species library</h2><p class="hint" id="cn-libnote"></p></div>
      <div class="bar-actions"><input id="cn-libq" type="search" class="cn-search" placeholder="Search by name" aria-label="Search species"><button class="btn primary" id="cn-add" type="button">Add species</button></div></div>
    <div class="cn-grid" id="cn-libgrid"></div>
  </section>
</div>

<div id="cn-list" class="cn-list" role="listbox" hidden></div>

<dialog id="cn-dlg" class="crop-dlg cn-dlg"><form method="dialog" id="cn-dlgform" novalidate>
  <h3 id="cn-dlg-title">Add species</h3>
  <div class="cn-prev"><img id="cn-d-img" alt="" hidden><div class="cn-stack">
    <div id="cn-d-file-wrap"><label class="field-label" for="cn-d-file">Card image</label><input id="cn-d-file" type="file" accept="image/png,image/jpeg"></div>
    <p class="muted small" id="cn-d-meta"></p></div></div>
  <div class="field"><label class="field-label" for="cn-d-name">English name</label><input id="cn-d-name" type="text" autocomplete="off"></div>
  <div class="cn-row"><div class="field" style="flex:1"><label class="field-label" for="cn-d-local">Local name</label><input id="cn-d-local" type="text" autocomplete="off"></div>
    <div class="field" style="flex:1"><label class="field-label" for="cn-d-bot">Botanical name</label><input id="cn-d-bot" type="text" autocomplete="off"></div></div>
  <label class="check" id="cn-d-hidden-wrap"><input type="checkbox" id="cn-d-hidden"> Hide from the species picker (past orders keep it)</label>
  <p class="notice" id="cn-d-err" hidden></p>
  <div class="crop-actions"><button type="button" class="btn danger-ghost" id="cn-d-del" hidden>Delete</button><div class="bar-actions"><button type="button" class="btn" id="cn-d-cancel">Cancel</button><button type="button" class="btn primary" id="cn-d-save">Save</button></div></div>
</form></dialog>
`;

/* ---------- wiring ---------- */
function setTab(t) {
  S.tab = t; $('#cn-build').hidden = t !== 'build'; $('#cn-library').hidden = t !== 'library';
  $$('#cn-tabs li').forEach((li) => li.classList.toggle('active', li.dataset.tab === t));
  closeList(); if (t === 'build') schedulePreview(); else renderLibrary();
}
function wire() {
  $$('#cn-tabs li').forEach((li) => { li.addEventListener('click', () => setTab(li.dataset.tab)); li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTab(li.dataset.tab); } }); });
  $('#cn-qr-url').addEventListener('input', onQR);
  $('#cn-guides').addEventListener('change', (e) => { S.guides = e.target.checked; persistDraft(); schedulePreview(); });
  $('#cn-inset').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v >= 0.2 && v <= 1.5) { S.insetCm = v; changed(); } });
  $('#cn-tick').addEventListener('input', (e) => { S.tickPct = +e.target.value; $('#cn-tickv').textContent = S.tickPct + '%'; persistDraft(); schedulePreview(); });
  $('#cn-confirm-btn').addEventListener('click', () => { S.confirmed = true; renderReview(); renderExport(); $('#cn-export-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  $('#cn-label').addEventListener('input', (e) => { S.label = e.target.value; persistDraft(); renderExport(); });
  $$('input[name=cn-fmt]').forEach((r) => r.addEventListener('change', () => { S.format = r.value; persistDraft(); renderExport(); }));
  $('#cn-dpi').addEventListener('change', (e) => { S.dpi = +e.target.value; persistDraft(); renderExport(); });
  $('#cn-pdfmode').addEventListener('change', (e) => { S.pdfMode = e.target.value; persistDraft(); renderExport(); });
  $('#cn-export-btn').addEventListener('click', doExport);
  $('#cn-files').addEventListener('click', (e) => { const b = e.target.closest('button'); const f = b && S.files[+b.dataset.k]; if (f) plainSave(f.name, f.blob); });
  $('#cn-zip').addEventListener('click', async () => plainSave(fileBase() + '_' + stamp() + '.zip', await buildZip(S.files)));
  $('#cn-list').addEventListener('mousedown', (e) => { const o = e.target.closest('.cn-opt'); if (o) { e.preventDefault(); pick(+o.dataset.k); } });
  addEventListener('scroll', (e) => { if (!$('#cn-list').contains(e.target)) closeList(); }, true);
  addEventListener('resize', () => { closeList(); schedulePreview(); });
  $('#cn-libq').addEventListener('input', (e) => { S.libq = e.target.value; renderLibrary(); });
  $('#cn-libgrid').addEventListener('click', (e) => { const c = e.target.closest('.cn-sp'); if (c) openDialog(c.dataset.id); });
  $('#cn-add').addEventListener('click', () => openDialog(null));
  $('#cn-d-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const d = await imgDims(f); Object.assign(dlgState, { blob: f, w: d.w, h: d.h }); $('#cn-d-err').hidden = true; $('#cn-d-img').hidden = false; $('#cn-d-img').src = URL.createObjectURL(f); $('#cn-d-meta').textContent = d.w + ' × ' + d.h + ' px'; if (!$('#cn-d-name').value.trim()) $('#cn-d-name').value = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(); }
    catch (err) { $('#cn-d-err').textContent = 'That image could not be read.'; $('#cn-d-err').hidden = false; }
  });
  $('#cn-d-save').addEventListener('click', saveDialog);
  $('#cn-d-cancel').addEventListener('click', () => $('#cn-dlg').close());
  $('#cn-dlgform').addEventListener('submit', (e) => e.preventDefault());
  $('#cn-d-del').addEventListener('click', async () => {
    if (!dlgState.delArmed) { dlgState.delArmed = true; $('#cn-d-del').textContent = 'Click again to delete'; return; }
    const id = dlgState.id; $('#cn-dlg').close(); await deleteSpecies(id); changed();
  });
  wirePreview();
}

/* ---------- boot ---------- */
let booted = false;
async function boot() {
  if (booted) return; booted = true;
  const root = $('#view-carbon'); if (!root) return;
  root.innerHTML = MARKUP;
  buildSlots(); wire(); loadDraft(); await store.open();
  let builtin = INL ? INL.species : [];
  if (!INL) { try { builtin = await (await fetch(ASSETS + 'species/manifest.json')).json(); } catch (e) { /* opened from file:// */ } }
  const loaded = await Promise.all(builtin.map(async (m) => {
    const url = m.url || ASSETS + 'species/' + m.file;
    try { const im = await loadImg(url); return { ...m, url, builtin: true, w: im.naturalWidth, h: im.naturalHeight }; } catch (e) { return null; }
  }));
  S.species = [...loaded.filter(Boolean), ...(await store.all())];
  if (!builtin.length) $('#cn-libnote').textContent = 'The included species could not be loaded. Serve this folder over HTTP (see README).';
  S.slots = S.slots.map((id) => (id && byId(id) ? id : null));
  await sampleInk();
  $('#cn-qr-url').value = S.qrUrl; $('#cn-label').value = S.label; $('#cn-guides').checked = S.guides; $('#cn-inset').value = S.insetCm; $('#cn-tick').value = S.tickPct; $('#cn-tickv').textContent = S.tickPct + '%';
  applyQR(); updateAllRows(); renderReview(); renderExport(); renderFiles(); renderLibrary(); schedulePreview();
  window.__carbon = { S, renderSide, doExport, buildPDF, moveSlot, parseLink, qrRect };
}
// the preview needs real layout widths, so redraw when the page becomes visible
document.addEventListener('DOMContentLoaded', boot);
window.addEventListener('hashchange', () => setTimeout(schedulePreview, 50));
if (document.readyState !== 'loading') boot();
