import { TEMPLATE, cardPx } from './template.js';
import { renderCardFront, MIN_ZOOM, MAX_ZOOM, effectiveDpi } from './render.js';
import { autoPlace, centredPlacement, containZoom, clamp, cardChecks } from './placement.js';
import { loadPhoto, decodeImage, isSupported, ACCEPT } from './images.js';
import { detectFaces, preloadFaceModel } from './faces.js';
import { EXPORTERS, DEFAULT_EXPORTER, getExporter } from './exporters/index.js';
import { cleanLabel, cardFileName, backFileName, zipFileName } from './naming.js';
import { loadScript, formatBytes, downloadBlob } from './util.js';
import { openCrop } from './crop.js';

const CARD_COUNT = 4;
const PX = cardPx();
const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  cards: Array.from({ length: CARD_COUNT }, (_, i) => newCard(i)),
  layoutConfirmed: false,
  formatId: DEFAULT_EXPORTER,
  formatConfirmed: false,
  results: null, // [{ name, blob, thumb, meta }]
  exporting: false,
};

function newCard(index) {
  return {
    index,
    file: null,
    source: null,      // decodable original (HEIC already converted)
    fullPreview: null, // downscaled canvas of the whole photo (face detection, crop dialog)
    origW: 0,
    origH: 0,
    crop: null,        // { x, y, w, h } normalised to the photo, or null
    allFaces: null,    // faces in whole-photo coordinates
    preview: null,     // fullPreview with the crop applied; what the card shows
    imgW: 0,           // size of the cropped original
    imgH: 0,
    faces: null,       // faces in cropped coordinates; null = not yet known
    detectError: false,
    auto: null,        // automatic placement (target of Reset)
    placement: null,
    manual: false,     // true once the user has moved/zoomed this card
    busy: null,        // text while working, else null
    error: null,
    showBack: false,
    token: 0,          // guards against stale async results after Replace
  };
}

let backImage = null;
const backReady = decodeImageFromUrl(TEMPLATE.backImage).then((img) => (backImage = img));

async function decodeImageFromUrl(url) {
  const res = await fetch(url);
  return decodeImage(await res.blob());
}

// ---------- Card UI ----------

const cardsEl = $('#cards');
const views = state.cards.map((card) => buildCardView(card));

function buildCardView(card) {
  const el = $('#card-tpl').content.firstElementChild.cloneNode(true);
  const v = {
    el,
    title: $('h3', el),
    stage: $('.stage', el),
    canvas: $('canvas', el),
    busyText: $('.busy-text', el),
    zoom: $('.zoom', el),
    fill: $('.fill', el),
    fillColor: $('.fill-color', el),
    fillRow: $('.fill-pick', el),
    flip: $('[data-act=flip]', el),
    checks: $('.checks', el),
    file: $('.file', el),
  };
  v.title.textContent = `Card ${card.index + 1}`;
  v.canvas.width = PX.w;
  v.canvas.height = PX.h;
  v.file.accept = ACCEPT;
  v.zoom.min = Math.log(MIN_ZOOM);
  v.zoom.max = Math.log(MAX_ZOOM);
  v.zoom.step = 0.001;

  $('.empty', el).addEventListener('click', () => {
    if (!state.layoutConfirmed) v.file.click();
  });
  v.file.addEventListener('change', () => {
    if (v.file.files[0]) setPhoto(card, v.file.files[0]);
    v.file.value = '';
  });

  // Drop a file straight onto a card to fill or replace it.
  v.stage.addEventListener('dragover', (e) => {
    if (state.layoutConfirmed) return;
    e.preventDefault();
    e.stopPropagation();
    v.stage.classList.add('over');
  });
  v.stage.addEventListener('dragleave', () => v.stage.classList.remove('over'));
  v.stage.addEventListener('drop', (e) => {
    v.stage.classList.remove('over');
    if (state.layoutConfirmed) return;
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files[0];
    if (f) setPhoto(card, f);
  });

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) onCardAction(card, act);
  });

  v.zoom.addEventListener('input', () => {
    if (!card.placement) return;
    adjust(card, { zoom: Math.exp(+v.zoom.value) });
  });

  v.fill.addEventListener('change', () => {
    if (v.fill.value === 'custom') {
      v.fillColor.hidden = false;
      adjust(card, { fill: v.fillColor.value });
    } else {
      v.fillColor.hidden = true;
      adjust(card, { fill: v.fill.value });
    }
  });
  v.fillColor.addEventListener('input', () => adjust(card, { fill: v.fillColor.value }));

  attachPanZoom(card, v);
  cardsEl.appendChild(el);
  return v;
}

function attachPanZoom(card, v) {
  let drag = null;
  const canEdit = () => card.placement && !state.layoutConfirmed && !card.showBack;

  v.canvas.addEventListener('pointerdown', (e) => {
    if (!canEdit()) return;
    v.canvas.setPointerCapture(e.pointerId);
    v.canvas.classList.add('dragging');
    drag = { x: e.clientX, y: e.clientY, cx: card.placement.cx, cy: card.placement.cy };
  });
  v.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = v.canvas.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / (r.width * TEMPLATE.photoArea.w);
    const dy = (e.clientY - drag.y) / (r.height * TEMPLATE.photoArea.h);
    adjust(card, { cx: drag.cx + dx, cy: drag.cy + dy });
  });
  const end = () => {
    drag = null;
    v.canvas.classList.remove('dragging');
  };
  v.canvas.addEventListener('pointerup', end);
  v.canvas.addEventListener('pointercancel', end);

  // Wheel / trackpad pinch zooms around the pointer.
  v.canvas.addEventListener('wheel', (e) => {
    if (!canEdit()) return;
    e.preventDefault();
    const r = v.canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width;
    const my = (e.clientY - r.top) / r.height;
    zoomAround(card, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), mx, my);
  }, { passive: false });

  // Keyboard: arrows nudge, +/- zoom.
  v.stage.addEventListener('keydown', (e) => {
    if (!canEdit()) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const p = card.placement;
    const map = {
      ArrowLeft: { cx: p.cx - step }, ArrowRight: { cx: p.cx + step },
      ArrowUp: { cy: p.cy - step }, ArrowDown: { cy: p.cy + step },
    };
    if (map[e.key]) adjust(card, map[e.key]);
    else if (e.key === '+' || e.key === '=') zoomAround(card, 1.05, 0.5, 0.5);
    else if (e.key === '-') zoomAround(card, 1 / 1.05, 0.5, 0.5);
    else return;
    e.preventDefault();
  });
}

function zoomAround(card, factor, mx, my) {
  const p = card.placement;
  const a = TEMPLATE.photoArea;
  mx = (mx - a.x) / a.w;
  my = (my - a.y) / a.h;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.zoom * factor));
  const k = zoom / p.zoom;
  // Keep the point under the pointer still.
  adjust(card, { zoom, cx: mx + (p.cx - mx) * k, cy: my + (p.cy - my) * k });
}

function adjust(card, patch) {
  if (!card.placement || state.layoutConfirmed) return;
  card.placement = clamp({ ...card.placement, ...patch }, card.imgW, card.imgH);
  card.manual = true;
  invalidateResults();
  drawCard(card);
}

function onCardAction(card, act) {
  const v = views[card.index];
  if (act === 'replace') return state.layoutConfirmed || v.file.click();
  if (act === 'flip') {
    card.showBack = !card.showBack;
    return drawCard(card);
  }
  if (state.layoutConfirmed || !card.placement) return;
  if (act === 'remove') {
    if (!confirm(`Remove the photo from card ${card.index + 1}?`)) return;
    Object.assign(card, newCard(card.index), { token: card.token + 1 });
    invalidateResults();
    return drawCard(card);
  }
  if (act === 'reset') {
    card.placement = { ...card.auto };
    card.manual = false;
  } else if (act === 'fit') {
    card.placement = clamp({ ...card.placement, zoom: containZoom(card.imgW, card.imgH), cx: 0.5, cy: 0.5 }, card.imgW, card.imgH);
    card.manual = true;
  } else if (act === 'crop') {
    return cropCard(card);
  } else if (act === 'zoom-in' || act === 'zoom-out') {
    return zoomAround(card, act === 'zoom-in' ? 1.1 : 1 / 1.1, 0.5, 0.5);
  }
  invalidateResults();
  drawCard(card);
}

// ---------- Cropping ----------

// Rebuild the card's working image, size and faces from the whole photo and
// the current crop.
function applyCrop(card) {
  const c = card.crop || { x: 0, y: 0, w: 1, h: 1 };
  const fp = card.fullPreview;
  if (!card.crop) {
    card.preview = fp;
  } else {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(c.w * fp.width));
    cv.height = Math.max(1, Math.round(c.h * fp.height));
    cv.getContext('2d').drawImage(fp, c.x * fp.width, c.y * fp.height, c.w * fp.width, c.h * fp.height, 0, 0, cv.width, cv.height);
    card.preview = cv;
  }
  card.imgW = Math.max(1, Math.round(c.w * card.origW));
  card.imgH = Math.max(1, Math.round(c.h * card.origH));
  card.faces = card.allFaces && card.allFaces
    .map((f) => ({ ...f, x: (f.x - c.x) / c.w, y: (f.y - c.y) / c.h, w: f.w / c.w, h: f.h / c.h }))
    // Keep faces whose centre is still inside the crop.
    .filter((f) => f.x + f.w / 2 > 0 && f.x + f.w / 2 < 1 && f.y + f.h / 2 > 0 && f.y + f.h / 2 < 1);
}

async function cropCard(card) {
  const token = card.token;
  const crop = await openCrop(card.fullPreview, card.crop);
  if (crop === undefined || token !== card.token || state.layoutConfirmed) return;
  card.crop = crop;
  applyCrop(card);
  card.auto = card.faces ? autoPlace(card.faces, card.imgW, card.imgH) : centredPlacement();
  card.placement = { ...card.auto };
  card.manual = false;
  invalidateResults();
  drawCard(card);
}

// The full-resolution original with the crop applied, for export.
async function exportSource(card) {
  const img = await decodeImage(card.source);
  if (!card.crop) return img;
  const c = card.crop;
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = card.imgW;
  cv.height = card.imgH;
  cv.getContext('2d').drawImage(img, c.x * W, c.y * H, c.w * W, c.h * H, 0, 0, cv.width, cv.height);
  return cv;
}

// ---------- Loading photos ----------

async function setPhoto(card, file) {
  if (state.layoutConfirmed) return;
  if (!isSupported(file)) {
    card.error = `“${file.name}” is not a supported file. Use JPG, PNG or HEIC.`;
    return drawCard(card);
  }
  const token = ++card.token;
  Object.assign(card, newCard(card.index), { token, file, busy: 'Opening photo…' });
  invalidateResults();
  drawCard(card);

  try {
    const loaded = await loadPhoto(file);
    if (token !== card.token) return;
    card.source = loaded.source;
    card.fullPreview = loaded.preview;
    card.origW = loaded.imgW;
    card.origH = loaded.imgH;
    applyCrop(card);
    card.placement = centredPlacement(card.imgW, card.imgH);
    card.auto = { ...card.placement };
    card.busy = 'Finding faces…';
    drawCard(card);
  } catch (err) {
    if (token !== card.token) return;
    Object.assign(card, newCard(card.index), { token, error: err.message || String(err) });
    return drawCard(card);
  }

  let faces;
  try {
    faces = await detectFaces(card.fullPreview);
  } catch (err) {
    console.error('Face detection failed', err);
    faces = [];
    card.detectError = true;
  }
  if (token !== card.token) return;
  card.allFaces = faces;
  applyCrop(card);
  card.auto = autoPlace(card.faces, card.imgW, card.imgH);
  // Never overwrite something the user already adjusted while we were busy.
  if (!card.manual) card.placement = { ...card.auto };
  card.busy = null;
  drawCard(card);
}

function addFiles(files) {
  const msg = $('#bulk-msg');
  const list = [...files];
  const empty = state.cards.filter((c) => !c.file && !c.busy);
  const usable = list.filter(isSupported);
  const notes = [];
  if (usable.length < list.length) notes.push(`${list.length - usable.length} file(s) skipped (only JPG, PNG, HEIC).`);
  if (usable.length > empty.length) {
    notes.push(empty.length
      ? `Only ${empty.length} empty card slot(s) left; extra photos were ignored. Use “Replace” on a card to swap a photo.`
      : 'All 4 cards already have photos. Use “Replace” on a card to swap one.');
  }
  usable.slice(0, empty.length).forEach((f, i) => setPhoto(empty[i], f));
  msg.hidden = !notes.length;
  msg.textContent = notes.join(' ');
}

// ---------- Drawing ----------

function drawAll() {
  state.cards.forEach(drawCard);
}

function drawCard(card) {
  const v = views[card.index];
  const ctx = v.canvas.getContext('2d');
  const has = !!card.preview;
  v.el.classList.toggle('has-photo', has || card.showBack);
  v.el.classList.toggle('busy', !!card.busy);
  v.el.classList.toggle('locked', state.layoutConfirmed);
  v.busyText.textContent = card.busy || '';
  v.flip.textContent = card.showBack ? 'Show front' : 'Show back';

  ctx.clearRect(0, 0, PX.w, PX.h);
  if (card.showBack) {
    if (backImage) ctx.drawImage(backImage, 0, 0, PX.w, PX.h);
    else backReady.then(() => drawCard(card));
  } else if (has) {
    renderCardFront(ctx, card.preview, card.placement, PX.w, PX.h);
  }

  // Controls reflect the current placement.
  if (has) {
    v.zoom.value = Math.log(card.placement.zoom);
    const f = card.placement.fill;
    if (f === 'blur' || f === '#ffffff') {
      v.fill.value = f;
      v.fillColor.hidden = true;
    } else {
      v.fill.value = 'custom';
      v.fillColor.hidden = false;
      v.fillColor.value = f;
    }
  }

  const checks = has && !card.busy ? cardChecks(card) : [];
  if (card.error) checks.unshift({ level: 'error', text: card.error });
  v.checks.replaceChildren(...checks.map((c) => {
    const li = document.createElement('li');
    li.className = c.level;
    li.textContent = c.text;
    return li;
  }));

  updateFlow();
}

// ---------- Flow gating ----------

const confirmLayoutBtn = $('#confirm-layout');
const editLayoutBtn = $('#edit-layout');
const confirmFormatBtn = $('#confirm-format');
const editFormatBtn = $('#edit-format');
const exportBtn = $('#export-btn');
const labelInput = $('#label');
const includeBack = $('#include-back');

function readyCards() {
  return state.cards.filter((c) => c.preview && !c.busy);
}

function updateFlow() {
  const ready = readyCards().length;
  const working = state.cards.some((c) => c.busy);
  const needLook = state.cards.filter((c) => c.preview && !c.busy &&
    cardChecks(c).some((x) => x.level !== 'info')).length;

  // Layout
  confirmLayoutBtn.hidden = state.layoutConfirmed;
  editLayoutBtn.hidden = !state.layoutConfirmed;
  // Any number of filled cards (1–4) can go forward.
  confirmLayoutBtn.disabled = ready < 1 || working;
  const summary = $('#layout-summary');
  summary.className = state.layoutConfirmed ? 'confirmed' : '';
  const plural = (n) => `${n} card${n === 1 ? '' : 's'}`;
  if (state.layoutConfirmed) summary.textContent = `Layout confirmed for ${plural(ready)}.`;
  else if (working) summary.textContent = 'Working on photos…';
  else if (!ready) summary.textContent = '';
  else if (needLook) summary.textContent = `${ready} of ${CARD_COUNT} photos added · ${plural(needLook)} flagged — please check before confirming.`;
  else summary.textContent = `${ready} of ${CARD_COUNT} photos added`;
  $('#dropzone').style.display = state.layoutConfirmed ? 'none' : '';

  // Format
  $('#format-panel').classList.toggle('locked', !state.layoutConfirmed);
  document.querySelectorAll('#formats input').forEach((i) => (i.disabled = state.formatConfirmed));
  includeBack.disabled = state.formatConfirmed;
  confirmFormatBtn.hidden = state.formatConfirmed;
  editFormatBtn.hidden = !state.formatConfirmed;
  const fs = $('#format-summary');
  fs.className = state.formatConfirmed ? 'confirmed' : '';
  fs.textContent = state.formatConfirmed
    ? `Format confirmed: ${getExporter(state.formatId).label}${includeBack.checked ? ' (+ card back)' : ''}`
    : '';

  const label = cleanLabel(labelInput.value);
  const ext = getExporter(state.formatId).ext;
  $('#name-preview').innerHTML = `Files will be named like <code>${cardFileName(label || 'Sharma', 1, ext)}</code>`;

  // Export
  const canExport = state.layoutConfirmed && state.formatConfirmed && !!label && !state.exporting;
  $('#export-panel').classList.toggle('locked', !(state.layoutConfirmed && state.formatConfirmed));
  exportBtn.disabled = !canExport;
  $('#export-hint').textContent = !state.layoutConfirmed ? ''
    : !state.formatConfirmed ? 'Confirm the format first.'
    : !label ? 'Enter a family or deck name above.'
    : state.results ? ''
    : '';

  // Stepper
  const step = !state.layoutConfirmed ? (ready < 1 ? 1 : 2) : !state.formatConfirmed ? 3 : 4;
  document.querySelectorAll('#steps li').forEach((li) => {
    const n = +li.dataset.step;
    li.classList.toggle('active', n === step);
    li.classList.toggle('done', n < step || (n === 4 && !!state.results));
  });
}

confirmLayoutBtn.addEventListener('click', () => {
  const flagged = state.cards
    .map((c) => ({ c, w: cardChecks(c).filter((x) => x.level !== 'info') }))
    .filter((x) => x.w.length);
  if (flagged.length) {
    const lines = flagged.map(({ c, w }) => `Card ${c.index + 1}: ${w.map((x) => x.text).join(' ')}`);
    if (!confirm(`Some cards were flagged:\n\n${lines.join('\n')}\n\nConfirm the layout anyway?`)) return;
  }
  state.layoutConfirmed = true;
  state.cards.forEach((c) => (c.showBack = false));
  drawAll();
  labelInput.focus();
});

editLayoutBtn.addEventListener('click', () => {
  state.layoutConfirmed = false;
  state.formatConfirmed = false;
  invalidateResults();
  drawAll();
});

const formatsEl = $('#formats');
formatsEl.replaceChildren(...EXPORTERS.map((x) => {
  const l = document.createElement('label');
  l.className = 'format';
  l.innerHTML = `<input type="radio" name="format" value="${x.id}"><strong></strong>`;
  $('strong', l).textContent = x.id === DEFAULT_EXPORTER ? `${x.label} (default)` : x.label;
  $('input', l).checked = x.id === state.formatId;
  $('input', l).addEventListener('change', () => {
    state.formatId = x.id;
    updateFlow();
  });
  return l;
}));

confirmFormatBtn.addEventListener('click', () => {
  state.formatConfirmed = true;
  updateFlow();
});
editFormatBtn.addEventListener('click', () => {
  state.formatConfirmed = false;
  invalidateResults();
  updateFlow();
});
labelInput.addEventListener('input', () => {
  labelInput.classList.toggle('invalid', !cleanLabel(labelInput.value));
  invalidateResults();
  updateFlow();
});

// ---------- Export ----------

function invalidateResults() {
  if (!state.results) return;
  state.results.forEach((r) => URL.revokeObjectURL(r.thumb));
  state.results = null;
  $('#results').hidden = true;
}

function setProgress(done, total, text) {
  const p = $('#progress');
  p.hidden = false;
  $('.bar', p).style.width = `${(done / total) * 100}%`;
  $('span', p).textContent = text;
}

async function thumbOf(canvas) {
  const t = document.createElement('canvas');
  t.width = 300;
  t.height = Math.round((300 * PX.h) / PX.w);
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  return new Promise((res) => t.toBlob((b) => res(URL.createObjectURL(b)), 'image/jpeg', 0.85));
}

exportBtn.addEventListener('click', async () => {
  const exporter = getExporter(state.formatId);
  const label = cleanLabel(labelInput.value);
  if (!label || !state.layoutConfirmed || !state.formatConfirmed) return;
  invalidateResults();
  state.exporting = true;
  updateFlow();

  const now = new Date();
  const meta = { dpi: TEMPLATE.dpi, widthIn: TEMPLATE.widthIn, heightIn: TEMPLATE.heightIn };
  // Only cards that have a photo; files are numbered 1..n in slot order.
  const filled = readyCards();
  const total = filled.length + (includeBack.checked ? 1 : 0);
  const results = [];
  try {
    for (const [i, card] of filled.entries()) {
      setProgress(results.length, total, `Rendering card ${i + 1} from the original photo…`);
      // Always the full-resolution original, never the preview copy.
      const original = await exportSource(card);
      const canvas = document.createElement('canvas');
      canvas.width = PX.w;
      canvas.height = PX.h;
      renderCardFront(canvas.getContext('2d'), original, card.placement, PX.w, PX.h);
      const name = cardFileName(label, i + 1, exporter.ext, now);
      const blob = await exporter.exportCard(canvas, { ...meta, title: name });
      results.push({ name, blob, thumb: await thumbOf(canvas), dpi: effectiveDpi(card.placement, card.imgW, card.imgH) });
    }
    if (includeBack.checked) {
      setProgress(results.length, total, 'Rendering card back…');
      await backReady;
      const canvas = document.createElement('canvas');
      canvas.width = PX.w;
      canvas.height = PX.h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(backImage, 0, 0, PX.w, PX.h);
      const name = backFileName(label, exporter.ext, now);
      const blob = await exporter.exportCard(canvas, { ...meta, title: name });
      results.push({ name, blob, thumb: await thumbOf(canvas), isBack: true });
    }
    setProgress(total, total, `Done · ${results.length} files ready`);
    state.results = results;
    showResults(exporter);
  } catch (err) {
    console.error(err);
    setProgress(0, 1, `Export failed: ${err.message || err}`);
  } finally {
    state.exporting = false;
    updateFlow();
  }
});

function showResults(exporter) {
  const files = $('#files');
  const size = exporter.id === 'pdf'
    ? `${TEMPLATE.widthIn} × ${TEMPLATE.heightIn} in`
    : `${PX.w} × ${PX.h} px · ${TEMPLATE.dpi} DPI`;
  files.replaceChildren(...state.results.map((r) => {
    const d = document.createElement('div');
    d.className = 'file-tile';
    d.innerHTML = '<img alt=""><div class="name"></div><div class="meta"></div>' +
      '<button class="btn sm"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="m12 16-5-5 1.4-1.45 2.6 2.6V4h2v8.15l2.6-2.6L17 11l-5 5Zm-6 4q-.825 0-1.412-.587Q4 18.825 4 18v-3h2v3h12v-3h2v3q0 .825-.587 1.413Q18.825 20 18 20H6Z"/></svg>Download</button>';
    $('img', d).src = r.thumb;
    $('.name', d).textContent = r.name;
    $('.meta', d).textContent = `${exporter.label} · ${size} · ${formatBytes(r.blob.size)}`;
    $('button', d).addEventListener('click', () => downloadBlob(r.blob, r.name));
    return d;
  }));
  $('#results').hidden = false;
}

$('#download-zip').addEventListener('click', async () => {
  if (!state.results) return;
  await loadScript('vendor/jszip.min.js');
  const zip = new window.JSZip();
  for (const r of state.results) zip.file(r.name, r.blob);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, zipFileName(labelInput.value));
});

$('#clear-all').addEventListener('click', () => {
  if (!confirm('Delete all photos and exported files from this session? Download anything you need first.')) return;
  invalidateResults();
  state.cards.forEach((c) => Object.assign(c, newCard(c.index), { token: c.token + 1 }));
  state.layoutConfirmed = false;
  state.formatConfirmed = false;
  labelInput.value = '';
  $('#progress').hidden = true;
  drawAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- Bulk upload ----------

const dropzone = $('#dropzone');
const bulkInput = $('#bulk-input');
bulkInput.accept = ACCEPT;
bulkInput.addEventListener('change', () => {
  addFiles(bulkInput.files);
  bulkInput.value = '';
});
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  addFiles(e.dataTransfer.files);
});
// Stop the browser opening a photo dropped anywhere else on the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

window.addEventListener('beforeunload', (e) => {
  if (state.cards.some((c) => c.file)) e.preventDefault();
});

preloadFaceModel();
drawAll();
