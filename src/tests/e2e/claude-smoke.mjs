/**
 * End-to-end smoke tests on the BUILT Claude artifact page (dist-claude/index.html), with the artifact runtime
 * (window.claude: sample, db, user, downloads) replaced by an in-page fake. localStorage is made to throw, as it may
 * in the artifact frame, so the records must come from and go to the fake db.
 *   node build.mjs --claude && node tests/e2e/claude-smoke.mjs        (from src/)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist-claude');
if (!existsSync(path.join(DIST, 'index.html'))) { console.error('Build first: node build.mjs --claude'); process.exit(2); }
const server = createServer((req, res) => {
  const file = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const PHOTO = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

/** Runs in the page before its scripts: the fake runtime, with its calls and db kept on window.__fake. */
function installFake(cloudDocs) {
  const docs = new Map(Object.entries(cloudDocs)), fake = { calls: [], docs, writes: [], saves: [] };
  window.__fake = fake;
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  const item = { name: '去皮雞腿', fromLabel: false, inPackage: false, published: false, foodKey: '', method: 'plain', foodType: 'meat',
    fatSource: 'none', portionText: '一塊', count: 0, weightLow: 90, weight: 100, weightHigh: 110, proteinPer100g: 20, carbsPer100g: 0,
    fatPer100g: 5, oilSheen: 'none', separatedOil: false, soupOil: 'none', bowlDiameterCm: 0, storePackaging: false, diningSetting: 'unclear' };
  const sample = async (prompt, opts) => {
    fake.calls.push({ prompt, opts: { ...opts, images: (opts.images || []).length, signal: undefined } });
    await new Promise(r => setTimeout(r, 50));
    const text = prompt.includes('"estimates"')
      ? JSON.stringify({ estimates: [{ index: 1, geo: 'x', weight: 100, method: 'plain', oilSheen: 'none', separatedOil: false, soupOil: 'none' }] })
      : 'Here it is:\n```json\n' + JSON.stringify({ reasoning: 'r', name: '雞腿', packageKcal: 0, items: [item] }) + '\n```';
    return { text, truncated: false, modelTierApplied: 'default' };
  };
  const mustBe = (p, odd) => { if (p.split('/').length % 2 !== (odd ? 1 : 0)) throw new TypeError('db: bad segment count in ' + p); };
  const ref = p => (mustBe(p, false), {
    set: async body => { fake.writes.push(p); docs.set(p, JSON.parse(JSON.stringify(body))); },
    delete: async () => { fake.writes.push('-' + p); docs.delete(p); },
    get: async () => { if (p.includes('/photos/')) await new Promise(r => setTimeout(r, 150)); return { exists: docs.has(p), data: () => docs.get(p) }; }
  });
  const db = { doc: p => ({ ...ref(p), collection: sub => db.collection(`${p}/${sub}`) }), collection: base => (mustBe(base, true), { doc: id => ref(`${base}/${id}`),
    get: async () => ({ docs: [...docs].filter(([p]) => p.startsWith(base + '/')).map(([p, b]) => ({ id: p.slice(base.length + 1), data: () => b })) }) }) };
  const caps = { sample, db, user: { id: async () => 'u1' }, downloads: { save: async r => {
    fake.saves.push(r.filename); fake.saved = JSON.parse(await r.data.text()); return { status: 'saved' }; } } };
  // Like the real runtime, use() only works as a method of window.claude.
  window.claude = { use(name) { if (this !== window.claude) throw new TypeError('Illegal invocation'); return new Promise(r => setTimeout(() => r(caps[name] ?? null), 30)); } };
}

const KV = 'data/users/u1';
const tests = [];
const it = (name, fn) => tests.push({ name, fn });

it('records come from the cloud; analysis runs on Claude; the saved meal goes back to the cloud', async browser => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  page.on('pageerror', e => { page.errors = [...(page.errors || []), String(e)]; });
  await page.addInitScript(installFake, {
    [`${KV}/nutrilens_onboarding_v1`]: { key: 'nutrilens_onboarding_v1', v: '{"status":"done"}', ts: 1 },
    [`${KV}/nutrilens_goals_v1`]: { key: 'nutrilens_goals_v1', v: '{"cal":1777,"p":120,"c":180,"f":55}', ts: 1 },
    [`${KV}/nutrilens_goal_history_v1`]: { key: 'nutrilens_goal_history_v1', v: '[{"from":"2026-01-01","cal":1777,"p":120,"c":180,"f":55}]', ts: 1 },
    [`${KV}/nutrilens_meals_v1@2026-01`]: { key: 'nutrilens_meals_v1', ts: 1,
      v: '[{"id":"old","date":"2026-01-05","time":"12:00","name":"舊的一餐","cal":500,"p":30,"c":50,"f":20,"items":[]}]' }
  });
  await page.goto(BASE);
  await page.waitForFunction(() => document.body.innerText.includes('1777') || document.body.innerText.includes('1,777'), null, { timeout: 15000 });
  if (await page.locator('#onboarding:not(.hidden)').count()) throw new Error('onboarding shown although the cloud says done');
  await page.setInputFiles('[data-upload="0"]', { name: 'meal.jpg', mimeType: 'image/jpeg', buffer: PHOTO });
  await page.waitForSelector('#preview0:not(.hidden)');
  await page.click('#analyzeBtn');
  await page.locator('[data-action="job-open"]').first().click({ timeout: 15000 });
  await page.waitForSelector('#resTableBody > [data-idx]');
  const calls = await page.evaluate(() => window.__fake.calls);
  if (calls.length !== 3) throw new Error(`expected 3 Claude calls, got ${calls.length}`);
  if (calls.some(c => c.opts.cache !== false || c.opts.images !== 1 || c.opts.modelTier !== 'default')) throw new Error(JSON.stringify(calls.map(c => c.opts)));
  const meta = await page.evaluate(() => analysisMetaText(state.analysis));
  if (/undefined|tok|（建議）/.test(meta) || !/Claude 預設/.test(meta)) throw new Error(`meta: ${meta}`);
  await page.click('[data-action="save-meal"]');
  await page.waitForFunction(() => [...window.__fake.docs].some(([k, b]) => k.includes('nutrilens_meals_v1@')
    && JSON.stringify(b.items || {}).includes('去皮雞腿')), null, { timeout: 10000 });
  // The first-version month document was rewritten as half-month documents and removed.
  if (await page.evaluate(() => window.__fake.docs.has('data/users/u1/nutrilens_meals_v1@2026-01'))) throw new Error('old meal document kept');
  // The meal's top view goes to the cloud photo collection, and its id to the synced list.
  await page.waitForFunction(() => [...window.__fake.docs].some(([k, b]) => k.startsWith('data/users/u1/photos/items/')
    && String(b.src).startsWith('data:image/jpeg')), null, { timeout: 10000 });
  return page;
});

it('reopened with empty browser storage: the photo comes from the cloud; deleting the meal deletes it there', async browser => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  page.on('pageerror', e => { page.errors = [...(page.errors || []), String(e)]; });
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const src = 'data:image/jpeg;base64,' + PHOTO.toString('base64');
  await page.addInitScript(installFake, {
    [`${KV}/nutrilens_onboarding_v1`]: { key: 'nutrilens_onboarding_v1', v: '{"status":"done"}', ts: 1 },
    [`${KV}/nutrilens_goal_history_v1`]: { key: 'nutrilens_goal_history_v1', v: '[{"from":"2026-01-01","cal":2000,"p":120,"c":200,"f":60}]', ts: 1 },
    [`${KV}/nutrilens_meals_v1@${today.slice(0, 7)}`]: { key: 'nutrilens_meals_v1', ts: 1,
      v: JSON.stringify([{ id: 'm1', date: today, time: '07:00', name: '有照片的一餐', angleCount: 1, cal: 300, p: 20, c: 30, f: 10, items: [], photoId: 'job1' }]) },
    [`${KV}/nutrilens_photo_cloud_v1`]: { key: 'nutrilens_photo_cloud_v1', v: '["job1"]', ts: 1 },
    'data/users/u1/photos/items/job1': { date: today, src }
  });
  await page.goto(BASE);
  await page.waitForFunction(() => document.querySelector('[data-photo-thumb="job1"] img')?.src.startsWith('data:image'), null, { timeout: 15000 });
  await page.evaluate(() => deleteMeal('m1'));
  await page.waitForFunction(() => !window.__fake.docs.has('data/users/u1/photos/items/job1'), null, { timeout: 10000 });
  return page;
});

it('a backup with photos is imported: the records and each meal\'s top view reach the cloud', async browser => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  page.on('pageerror', e => { page.errors = [...(page.errors || []), String(e)]; });
  await page.addInitScript(installFake, { [`${KV}/nutrilens_onboarding_v1`]: { key: 'nutrilens_onboarding_v1', v: '{"status":"done"}', ts: 1 } });
  await page.goto(BASE);
  await page.waitForTimeout(800);
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const src = 'data:image/jpeg;base64,' + PHOTO.toString('base64');
  const backup = { meals: [{ id: 'm9', date: today, time: '12:00', name: '舊照片的一餐', angleCount: 2, cal: 500, p: 30, c: 50, f: 20, items: [], photoId: 'old1' }],
    photos: [{ id: 'old1', date: today, images: [src, src] }] };
  await page.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.waitForFunction(() => String(window.__fake.docs.get('data/users/u1/photos/items/old1')?.src || '').startsWith('data:image/jpeg'), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('[data-photo-thumb="old1"] img')?.src.startsWith('data:image'), null, { timeout: 10000 });
  return page;
});

it('backup button with photos only in the cloud: feedback at once, saved without a second tap, photos included', async browser => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  page.on('pageerror', e => { page.errors = [...(page.errors || []), String(e)]; });
  const src = 'data:image/jpeg;base64,' + PHOTO.toString('base64'), docs = {}, meals = [], list = {};
  for (let i = 0; i < 30; i++) {
    const id = `p${i}`, date = `2026-11-${String(1 + (i % 25)).padStart(2, '0')}`;
    meals.push({ id: `m${i}`, date, time: '08:00', name: `餐${i}`, angleCount: 1, cal: 300, p: 20, c: 30, f: 10, items: [], photoId: id });
    docs[`data/users/u1/photos/items/${id}`] = { date, src }; list[id] = Date.now();
  }
  await page.addInitScript(installFake, { ...docs,
    [`${KV}/nutrilens_onboarding_v1`]: { key: 'nutrilens_onboarding_v1', v: '{"status":"done"}', ts: 1 },
    [`${KV}/nutrilens_photo_cloud_v1`]: { key: 'nutrilens_photo_cloud_v1', v: JSON.stringify(list), ts: 1 },
    [`${KV}/nutrilens_meals_v1@2026-11`]: { key: 'nutrilens_meals_v1', v: JSON.stringify(meals), ts: 1 } });
  await page.goto(BASE);
  await page.waitForFunction(() => document.querySelector('#selectedDate')?.value, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => MODAL_OPENERS.dataModal('dataModal'));
  await page.click('[data-action="export-json"]');
  await page.waitForFunction(() => /正在準備備份/.test(document.querySelector('#toastContainer')?.textContent || ''), null, { timeout: 1000 });
  await page.waitForFunction(() => window.__fake.saves.length === 1, null, { timeout: 15000 });
  const n = await page.evaluate(() => window.__fake.saved.photos.length);
  if (n !== 30) throw new Error(`backup has ${n} photos, expected 30`);
  return page;
});

it('settings: no key field, Opus can be chosen and is used for the main analysis', async browser => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  page.on('pageerror', e => { page.errors = [...(page.errors || []), String(e)]; });
  await page.addInitScript(installFake, { [`${KV}/nutrilens_onboarding_v1`]: { key: 'nutrilens_onboarding_v1', v: '{"status":"done"}', ts: 1 } });
  await page.goto(BASE);
  await page.waitForTimeout(800);
  await page.evaluate(() => openApiModal());
  if (await page.locator('#apiKeySection').isVisible()) throw new Error('key field shown');
  const opts = await page.locator('#apiModelSelect option').allInnerTexts();
  if (!opts.some(o => o.includes('Opus'))) throw new Error(`options: ${opts}`);
  await page.selectOption('#apiModelSelect', 'claude-opus-5-5');
  await page.click('[data-action="save-api"]');
  await page.setInputFiles('[data-upload="0"]', { name: 'meal.jpg', mimeType: 'image/jpeg', buffer: PHOTO });
  await page.waitForSelector('#preview0:not(.hidden)');
  await page.click('#analyzeBtn');
  await page.locator('[data-action="job-open"]').first().click({ timeout: 15000 });
  const calls = await page.evaluate(() => window.__fake.calls);
  if (calls[0].opts.model !== 'claude-opus-5-5' || calls[1].opts.model) throw new Error(JSON.stringify(calls.map(c => c.opts)));
  return page;
});

it('a new viewer sees the onboarding without a key step; backup goes through downloads', async browser => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  page.on('pageerror', e => { page.errors = [...(page.errors || []), String(e)]; });
  await page.addInitScript(installFake, {});
  await page.goto(BASE);
  await page.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
  await page.click('#obBody [data-action="ob-start"]');
  const text = await page.locator('#obBody').innerText();
  if (!text.includes('不需要金鑰') || await page.locator('#obKey').count()) throw new Error(`step 1: ${text}`);
  await page.evaluate(() => exportJSON());
  await page.waitForFunction(() => window.__fake.saves.length === 1, null, { timeout: 5000 });
  return page;
});

const browser = await chromium.launch();
let failed = 0;
for (const { name, fn } of tests) {
  let page;
  try {
    page = await fn(browser);
    if (page?.errors?.length) throw new Error(`page errors: ${page.errors.join(' | ')}`);
    console.log(`ok - ${name}`);
  } catch (e) { failed++; console.log(`not ok - ${name}\n  ${String(e.message || e).split("\n").slice(0, 12).join("\n  ")}`); }
  finally { await page?.close().catch(() => {}); }
}
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
