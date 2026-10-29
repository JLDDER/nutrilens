'use strict';
/* =====================================================================
 * NutriLens AI — meal photos and share images (loaded after app.js)
 * ---------------------------------------------------------------------
 * Sections:
 *   P1. Photo storage   IndexedDB; localStorage is far too small for photos
 *   P2. Hooks           `photos.*`, the only functions app.js calls
 *   P3. Photo viewer    full screen, swipe between angles, tap to zoom
 *   P4. Share images    drawn on a canvas on the device
 *   P5. Share sheet     preview first, then the system share sheet or a download
 *   P6. Wiring          registers its actions and handlers in app.js's tables
 *
 * Why images and not links: every record lives only in this browser, so a link
 * could not show anything to the person it is sent to.
 *
 * Data model: a saved meal keeps `photoId` = the id of the analysis job whose
 * photos were stored (one IndexedDB record per job: { id, date, savedAt, images }).
 * ===================================================================== */

/* ── P1. Photo storage ──────────────────────────────────────────────── */
const photoStore = {
  dbPromise: null,
  open() {
    this.dbPromise ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(CONFIG.photos.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(err => { this.dbPromise = null; throw err; });     // allow a later retry
    return this.dbPromise;
  },
  /** Runs `fn(objectStore)` in one transaction; resolves with the result of the request `fn` returns. */
  async run(mode, fn) {
    const idb = await this.open();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction('photos', mode), req = fn(tx.objectStore('photos'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  },
  put: record => photoStore.run('readwrite', s => s.put(record)),
  get: id => photoStore.run('readonly', s => s.get(id)),
  count: () => photoStore.run('readonly', s => s.count()),
  keys: () => photoStore.run('readonly', s => s.getAllKeys()),
  /** Ids of photos of meals dated before `date` (YYYY-MM-DD). */
  keysBefore: date => photoStore.run('readonly', s => s.index('date').getAllKeys(IDBKeyRange.upperBound(date, true))),
  remove: ids => photoStore.run('readwrite', s => { ids.forEach(id => s.delete(id)); }),
  clear: () => photoStore.run('readwrite', s => s.clear())
};

/** Loaded photos by id ([] = known to be missing), so re-renders never hit IndexedDB again. */
const photoCache = new Map();
async function loadPhotos(id) {
  if (!id) return [];
  if (!photoCache.has(id)) {
    try { photoCache.set(id, (await photoStore.get(id))?.images || []); } catch { return []; }
  }
  return photoCache.get(id);
}
const photoRetention = () => (store.str(STORAGE_KEYS.photoRetention) === 'forever' ? 'forever' : 'days');

/* ── P2. Hooks used by app.js ───────────────────────────────────────── */
const photos = {
  /** A new analysis job: keep its photos. Failure only means the meal will have no photo. */
  async saveForJob(job) {
    if (!job.images.length) return;
    try {
      await photoStore.put({ id: job.id, date: job.date, savedAt: Date.now(), images: [...job.images] });
      photoCache.set(job.id, [...job.images]);
      navigator.storage?.persist?.().catch(() => {});              // ask the browser not to evict the data
    } catch (err) { console.warn('[NutriLens] photos not saved', err); }
  },

  /** Fills the thumbnails that mealCardTemplate rendered hidden, once their photos are loaded. */
  async decorate(root) {
    for (const el of $$('[data-photo-thumb]', root)) {
      const images = await loadPhotos(el.dataset.photoThumb);
      if (!images.length || !el.isConnected) continue;
      $('img', el).src = images[0];
      el.classList.remove('hidden');
    }
  },

  /** Startup housekeeping: deletes photos past the retention period and photos no meal or job uses. */
  async prune() {
    try {
      const used = new Set([...db.meals().map(m => m.photoId), ...state.jobs.map(j => j.id)].filter(Boolean));
      const orphans = (await photoStore.keys()).filter(id => !used.has(id));
      const expired = photoRetention() === 'days'
        ? await photoStore.keysBefore(shiftDate(todayStr(), -CONFIG.photos.retentionDays)) : [];
      const ids = [...new Set([...orphans, ...expired])];
      if (!ids.length) return;
      await photoStore.remove(ids);
      ids.forEach(id => photoCache.delete(id));
      renderAll();
    } catch { /* IndexedDB unavailable: nothing to prune */ }
  },

  /** "Delete all data". */
  clear() { photoCache.clear(); return photoStore.clear().catch(() => {}); },

  /** Photo section of the data modal: retention choice and how much is stored. */
  async renderSettings() {
    const select = $('#photoRetention'); if (!select) return;
    select.value = photoRetention();
    $('#photoForeverWarn').classList.toggle('hidden', select.value !== 'forever');
    try {
      const [count, estimate] = await Promise.all([photoStore.count(), navigator.storage?.estimate?.().catch(() => null)]);
      $('#photoUsage').textContent = estimate?.usage
        ? t('photoUsage', { n: count, mb: (estimate.usage / 1048576).toFixed(1) }) : t('photoCount', { n: count });
    } catch { $('#photoUsage').textContent = t('photoUnavailable'); }
  },
  onRetentionChange(el) {
    store.setStr(STORAGE_KEYS.photoRetention, el.value === 'forever' ? 'forever' : 'days');
    (el.value === 'forever' ? Promise.resolve() : photos.prune()).then(photos.renderSettings);
  }
};

/* ── P3. Photo viewer ───────────────────────────────────────────────── */
const ANGLE_LABELS = ['photoAngle1', 'photoAngle2', 'photoAngle3'];
const SWIPE_MIN_PX = 50;
const viewer = { mealId: null, images: [], idx: 0, touchStart: null };

async function openPhotoViewer(mealId) {
  const meal = db.meals().find(m => m.id === mealId); if (!meal) return;
  const images = await loadPhotos(meal.photoId);
  if (!images.length) return toast(t(meal.photoId ? 'photoGone' : 'photoNone'), 'error');
  Object.assign(viewer, { mealId, images, idx: 0 });
  $('#photoTitle').textContent = meal.name;
  renderPhotoViewer();
  modal.close(); modal.open('photoModal');
}
function renderPhotoViewer() {
  const { images, idx } = viewer, img = $('#photoImg');
  img.src = images[idx]; img.classList.remove('zoomed');
  $('#photoScroller').scrollTo(0, 0);
  $('#photoCounter').textContent = images.length > 1 ? t('photoCounter', { i: idx + 1, n: images.length, name: t(ANGLE_LABELS[idx]) }) : '';
  $$('[data-action="photo-prev"], [data-action="photo-next"]').forEach(b => b.classList.toggle('hidden', images.length < 2));
}
function stepPhoto(delta) {
  if (viewer.images.length < 2) return;
  viewer.idx = (viewer.idx + delta + viewer.images.length) % viewer.images.length;
  renderPhotoViewer();
}

/* ── P4. Share images ───────────────────────────────────────────────── */
/** Canvas style: 1080 px wide (sharp on phones, fits LINE / IG); colors match the app's Tailwind palette. */
const SHARE = {
  w: 1080, pad: 64,
  font: '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Segoe UI", sans-serif',
  ink: '#0f172a', muted: '#64748b', faint: '#94a3b8', line: '#e2e8f0', bg: '#f8fafc', card: '#ffffff', mint: '#ecfdf5',
  green: '#059669', amber: '#d97706', macro: { p: '#e11d48', c: '#d97706', f: '#0284c7' },
  mealPhotoH: 760, bannerH: 220, thumb: 188
};
const loadImage = src => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
const setFont = (ctx, size, weight = 400) => { ctx.font = `${weight} ${size}px ${SHARE.font}`; };
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fillRoundRect(ctx, color, x, y, w, h, r) { ctx.fillStyle = color; roundRectPath(ctx, x, y, w, h, r); ctx.fill(); }
/** Draws `img` cropped to fill the box (like object-fit: cover), with rounded corners. */
function drawCover(ctx, img, x, y, w, h, r = 0) {
  const s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s;
  ctx.save(); roundRectPath(ctx, x, y, w, h, r); ctx.clip();
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}
/** Draws `parts` ([text, size, weight, color]) one after another on one baseline. */
function drawRun(ctx, x, y, parts) {
  for (const [text, size, weight, color] of parts) {
    setFont(ctx, size, weight); ctx.fillStyle = color; ctx.fillText(text, x, y);
    x += ctx.measureText(text).width;
  }
}
/** Splits text into at most `maxLines` lines of `maxWidth`, per character so CJK wraps correctly. */
function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = []; let cur = '';
  for (const ch of String(text)) {
    if (cur && ctx.measureText(cur + ch).width > maxWidth) { lines.push(cur); cur = ch.trimStart(); } else cur += ch;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines.splice(maxLines - 1, lines.length, last + '…');
  }
  return lines;
}
const shareDateLabel = date => new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en-US',
  { month: 'numeric', day: 'numeric', weekday: 'short' }).format(parseDate(date));
const periodText = time => { const p = mealPeriod(time); return `${p.icon} ${t(p.label)}`; };

/**
 * Renders `paint(ctx) → content height` at the height it needs. The first pass runs on a small
 * scratch canvas only to measure (drawing outside a canvas is harmless), the second draws.
 * Very long images are scaled down to stay under mobile canvas size limits.
 */
async function paintCanvas(paint) {
  const height = Math.ceil(await paint(document.createElement('canvas').getContext('2d')));
  const scale = Math.min(1, CONFIG.share.maxPixels / (SHARE.w * height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(SHARE.w * scale); canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = SHARE.bg; ctx.fillRect(0, 0, SHARE.w, height);
  await paint(ctx);
  return canvas;
}

/** Three columns: macro name, grams and a bar (share of energy, or progress toward `goals` if given). Height 140. */
function drawMacros(ctx, x, y, w, totals, goals) {
  const gap = 24, colW = (w - 2 * gap) / 3;
  MACROS.forEach((m, i) => {
    const cx = x + i * (colW + gap), val = Math.round(totals[m.field]), goal = goals?.[m.field];
    setFont(ctx, 30, 600); ctx.fillStyle = SHARE.muted; ctx.fillText(t(m.label), cx, y + 30);
    drawRun(ctx, cx, y + 92, [[`${val}`, 50, 800, SHARE.ink], [goal ? ` / ${goal} g` : ' g', 28, 500, SHARE.muted]]);
    const ratio = goal ? val / goal : totals.cal > 0 ? (val * (m.field === 'f' ? 9 : 4)) / totals.cal : 0;
    fillRoundRect(ctx, SHARE.line, cx, y + 116, colW, 14, 7);
    fillRoundRect(ctx, SHARE.macro[m.field], cx, y + 116, Math.max(14, colW * Math.min(1, ratio)), 14, 7);
  });
  return 140;
}
/** Divider and disclaimer. Height 80. */
function drawFooter(ctx, y) {
  ctx.fillStyle = SHARE.line; ctx.fillRect(SHARE.pad, y, SHARE.w - 2 * SHARE.pad, 2);
  setFont(ctx, 26, 500); ctx.fillStyle = SHARE.faint; ctx.fillText(t('shareFooter'), SHARE.pad, y + 50);
  return 80;
}

/** One meal: photo, date, name, kcal, P / C / F and the food items. */
async function renderMealShare(meal) {
  const [first] = await loadPhotos(meal.photoId);
  const photo = first ? await loadImage(first).catch(() => null) : null;
  const { w, pad } = SHARE, inner = w - 2 * pad;
  return paintCanvas(ctx => {
    let y;
    if (photo) { drawCover(ctx, photo, 0, 0, w, SHARE.mealPhotoH); y = SHARE.mealPhotoH; }
    else { ctx.fillStyle = SHARE.green; ctx.fillRect(0, 0, w, 120); drawRun(ctx, pad, 76, [['NutriLens AI', 36, 800, '#fff']]); y = 120; }

    y += 64;
    drawRun(ctx, pad, y, [[`${shareDateLabel(meal.date)}  ${meal.time}  ·  ${periodText(meal.time)}`, 32, 500, SHARE.muted]]);
    y += 24;
    setFont(ctx, 56, 800); ctx.fillStyle = SHARE.ink;
    for (const line of wrapLines(ctx, meal.name, inner, 2)) { y += 72; ctx.fillText(line, pad, y); }
    y += 116;
    drawRun(ctx, pad, y, [[`${meal.cal}`, 112, 800, SHARE.green], [' kcal', 44, 700, SHARE.green]]);
    y += 48;
    y += drawMacros(ctx, pad, y, inner, meal, null) + 40;

    const shown = meal.items.slice(0, CONFIG.share.maxItems);
    if (shown.length) {
      ctx.fillStyle = SHARE.line; ctx.fillRect(pad, y, inner, 2);
      y += 12;
      for (const it of shown) {
        y += 56;
        setFont(ctx, 32, 600);
        const kcal = `${Math.round(it.cal)} kcal`, kw = ctx.measureText(kcal).width;
        ctx.fillStyle = SHARE.ink; ctx.fillText(wrapLines(ctx, `${it.name}  ${Math.round(it.weight)} g`, inner - kw - 32, 1)[0], pad, y);
        ctx.fillStyle = SHARE.green; ctx.fillText(kcal, pad + inner - kw, y);
      }
      if (meal.items.length > shown.length) {
        y += 50; drawRun(ctx, pad, y, [[t('shareMoreItems', { n: meal.items.length - shown.length }), 28, 500, SHARE.muted]]);
      }
    }
    y += 48;
    return y + drawFooter(ctx, y);
  });
}

/** Summary card of a day: kcal eaten, optionally against the target, and the macros. Returns its height. */
function drawDaySummary(ctx, y, meals, total, goals, showGoals) {
  const { pad, w } = SHARE, inner = w - 2 * pad, x = pad + 16, barW = inner - 32;
  const h = showGoals ? 470 : 380;
  fillRoundRect(ctx, SHARE.card, pad - 16, y, inner + 32, h, 28);
  drawRun(ctx, x, y + 64, [[t('shareEaten', { n: meals.length }), 32, 600, SHARE.muted]]);
  drawRun(ctx, x, y + 170, [[`${total.cal}`, 104, 800, SHARE.ink], [showGoals ? ` / ${goals.cal} kcal` : ' kcal', 40, 700, SHARE.muted]]);
  let macrosY = y + 200;
  if (showGoals) {
    const remain = goals.cal - total.cal, color = remain >= 0 ? SHARE.green : SHARE.amber;
    drawRun(ctx, x, y + 232, [[remain >= 0 ? t('shareRemain', { n: remain }) : t('shareOver', { n: -remain }), 36, 700, color]]);
    fillRoundRect(ctx, SHARE.line, x, y + 256, barW, 16, 8);
    fillRoundRect(ctx, color, x, y + 256, Math.max(16, barW * Math.min(1, goals.cal > 0 ? total.cal / goals.cal : 0)), 16, 8);
    macrosY = y + 310;
  }
  drawMacros(ctx, x, macrosY, barW, total, showGoals ? goals : null);
  return h;
}
/** One meal row of the day image: photo (or period icon), time, name, kcal and macros. Returns its height. */
function drawDayMealRow(ctx, y, meal, thumbImg) {
  const { pad, w, thumb } = SHARE, inner = w - 2 * pad, cardH = thumb + 48, ty = y + 24, tx = pad + thumb + 28;
  fillRoundRect(ctx, SHARE.card, pad - 16, y, inner + 32, cardH, 24);
  if (thumbImg) drawCover(ctx, thumbImg, pad, ty, thumb, thumb, 18);
  else {
    fillRoundRect(ctx, SHARE.mint, pad, ty, thumb, thumb, 18);
    setFont(ctx, 80); ctx.textAlign = 'center'; ctx.fillText(mealPeriod(meal.time).icon, pad + thumb / 2, ty + thumb / 2 + 28); ctx.textAlign = 'left';
  }
  drawRun(ctx, tx, ty + 34, [[`${meal.time}  ${periodText(meal.time)}`, 28, 600, SHARE.muted]]);
  setFont(ctx, 38, 800); ctx.fillStyle = SHARE.ink;
  wrapLines(ctx, meal.name, inner - thumb - 28, 2).forEach((line, i) => ctx.fillText(line, tx, ty + 86 + i * 48));
  drawRun(ctx, tx, ty + 178, [[`${meal.cal} kcal`, 30, 700, SHARE.green], [`   P ${meal.p} · C ${meal.c} · F ${meal.f} g`, 26, 500, SHARE.muted]]);
  return cardH + 24;
}
/** A whole day as one long image: every meal is included, the image grows with the day. */
async function renderDayShare(date, showGoals) {
  const meals = db.meals().filter(m => m.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const goals = db.goals(), total = sumNutrients(meals);
  const thumbs = await Promise.all(meals.map(async m => {
    const [first] = await loadPhotos(m.photoId);
    return first ? loadImage(first).catch(() => null) : null;
  }));
  const { w, pad } = SHARE;
  return paintCanvas(ctx => {
    ctx.fillStyle = SHARE.green; ctx.fillRect(0, 0, w, SHARE.bannerH);
    drawRun(ctx, pad, 78, [['NutriLens AI', 32, 700, '#d1fae5']]);
    drawRun(ctx, pad, 160, [[t('shareDayTitle', { d: shareDateLabel(date) }), 60, 800, '#fff']]);
    let y = SHARE.bannerH + 40;
    y += drawDaySummary(ctx, y, meals, total, goals, showGoals) + 32;
    meals.forEach((m, i) => { y += drawDayMealRow(ctx, y, m, thumbs[i]); });
    y += 16;
    return y + drawFooter(ctx, y);
  });
}

/* ── P5. Share sheet ────────────────────────────────────────────────────
 * The image is made before the Share button is enabled: browsers only allow
 * navigator.share() directly inside a tap, not after a slow await. */
const share = { kind: null, id: null, blob: null, url: null, seq: 0 };
const canShareFiles = file => { try { return !!navigator.canShare?.({ files: [file] }); } catch { return false; } };
const shareButtons = () => $$('[data-action="share-send"], [data-action="share-save"]');

/** kind 'meal' (id = meal id) or 'day' (id = YYYY-MM-DD). */
async function openShare(kind, id) {
  if (kind === 'day' && !db.meals().some(m => m.date === id)) return toast(t('shareDayEmpty'), 'error');
  Object.assign(share, { kind, id });
  $('#shareTitle').textContent = t(kind === 'day' ? 'shareDayHeading' : 'shareMealHeading');
  $('#shareGoalsRow').classList.toggle('hidden', kind !== 'day');
  $('#shareGoals').checked = true;
  modal.close(); modal.open('shareModal');
  await buildShareImage();
}
async function buildShareImage() {
  const seq = ++share.seq;                                        // a newer request (e.g. a toggle) wins
  $('#sharePreview').classList.add('hidden'); $('#shareBusy').classList.remove('hidden');
  shareButtons().forEach(b => { b.disabled = true; });
  try {
    const meal = share.kind === 'meal' ? db.meals().find(m => m.id === share.id) : null;
    if (share.kind === 'meal' && !meal) return modal.close();
    const canvas = meal ? await renderMealShare(meal) : await renderDayShare(share.id, $('#shareGoals').checked);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', CONFIG.share.jpegQuality));
    if (seq !== share.seq || !blob) return;
    if (share.url) URL.revokeObjectURL(share.url);
    Object.assign(share, { blob, url: URL.createObjectURL(blob) });
    const preview = $('#sharePreview');
    preview.src = share.url; preview.classList.remove('hidden');
    // A meal image is shown whole; a long day image fills the width and scrolls.
    preview.classList.toggle('max-h-[55vh]', share.kind === 'meal'); preview.classList.toggle('w-auto', share.kind === 'meal');
    preview.classList.toggle('mx-auto', share.kind === 'meal'); preview.classList.toggle('w-full', share.kind !== 'meal');
    $('[data-action="share-send"]').classList.toggle('hidden', !canShareFiles(shareFile()));   // e.g. most desktop browsers
    shareButtons().forEach(b => { b.disabled = false; });
  } catch (err) {
    console.warn('[NutriLens] share image failed', err); toast(t('shareFailed'), 'error');
  } finally {
    if (seq === share.seq) $('#shareBusy').classList.add('hidden');
  }
}
function shareFileName() {
  const date = share.kind === 'day' ? share.id : db.meals().find(m => m.id === share.id)?.date || todayStr();
  return `NutriLens_${date}_${share.kind}.jpg`;
}
const shareFile = () => new File([share.blob], shareFileName(), { type: 'image/jpeg' });
async function sendShare() {
  if (!share.blob) return;
  try { await navigator.share({ files: [shareFile()] }); }
  catch (err) { if (err.name !== 'AbortError') toast(t('shareFailed'), 'error'); }   // AbortError = the user closed the sheet
}
const saveShare = () => { if (share.blob) download(share.blob, shareFileName()); };

/* ── P6. Wiring ─────────────────────────────────────────────────────── */
Object.assign(ACTIONS, {
  'view-photos': el => openPhotoViewer(el.dataset.id),
  'photo-prev': () => stepPhoto(-1),
  'photo-next': () => stepPhoto(1),
  'photo-zoom': () => $('#photoImg').classList.toggle('zoomed'),
  'photo-share': () => openShare('meal', viewer.mealId),
  'share-meal': el => openShare('meal', el.dataset.id),
  'share-day': () => openShare('day', selectedDate()),
  'share-send': sendShare,
  'share-save': saveShare
});
Object.assign(CHANGE_HANDLERS, {
  photoRetention: el => photos.onRetentionChange(el),
  shareGoals: () => buildShareImage()
});

document.addEventListener('keydown', e => {
  if (modal.isOpen('photoModal') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) stepPhoto(e.key === 'ArrowLeft' ? -1 : 1);
});
window.addEventListener('DOMContentLoaded', () => {
  // Swipe left / right between angles, swipe down to close. Ignored while zoomed, where a swipe pans the image.
  const scroller = $('#photoScroller');
  scroller.addEventListener('touchstart', e => {
    viewer.touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  scroller.addEventListener('touchend', e => {
    const start = viewer.touchStart; viewer.touchStart = null;
    if (!start || $('#photoImg').classList.contains('zoomed')) return;
    const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) stepPhoto(dx < 0 ? 1 : -1);
    else if (dy > SWIPE_MIN_PX * 2) modal.close();
  }, { passive: true });
  photos.prune();                                                 // after app.js's boot (listeners run in order)
});
