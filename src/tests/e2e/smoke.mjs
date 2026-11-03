/**
 * End-to-end smoke tests on the BUILT page (dist/index.html), with Gemini replaced by fixed answers.
 * Needs Playwright with Chromium (npm i playwright && npx playwright install chromium).
 *   node build.mjs && node tests/e2e/smoke.mjs            (from src/)
 * Exit code 0 = all passed. Screenshots of failures go to tests/e2e/out/ (not committed).
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', '..', 'dist');
const OUT = path.join(HERE, 'out');
const PAGE = 'index.html';
if (!existsSync(path.join(DIST, PAGE))) { console.error(`Build first: dist/${PAGE} not found`); process.exit(2); }
mkdirSync(OUT, { recursive: true });

// A static server: localStorage is unreliable on file:// pages.
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const file = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}/${PAGE}`;

/** A 1×1 JPEG, enough for the upload path. */
const PHOTO = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

const item = over => ({ name: '品項', fromLabel: false, published: false, foodKey: '', method: 'plain', foodType: 'meat', portionText: '一塊',
  weightLow: 90, weight: 100, weightHigh: 110, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 5, ...over });
const geminiReply = obj => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }], usageMetadata: {} });

/** Routes Gemini: `answer(body, model)` returns the object the model "writes". Requests are recorded. */
async function fakeGemini(page, answer) {
  const calls = [];
  await page.route('**/generativelanguage.googleapis.com/**', async route => {
    const url = route.request().url(), model = decodeURIComponent(url.match(/models\/([^:?]+)/)?.[1] || '');
    if (!url.includes(':generateContent')) return route.fulfill({ json: { models: [] } });
    const body = route.request().postDataJSON();
    calls.push({ model, body });
    return route.fulfill({ json: geminiReply(answer(body, model)) });
  });
  return calls;
}

async function freshPage(browser, storage = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  await ctx.addInitScript(s => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, {
    nutrilens_apikey_v1: 'TEST-KEY', nutrilens_apimodel_v1: 'gemini-3.5-flash-lite',
    nutrilens_onboarding_v1: JSON.stringify({ status: 'done' }), nutrilens_search_off_until_v1: String(Date.now() + 3600e3), ...storage
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => { page.errors = [...(page.errors || []), String(e)]; });
  return page;
}

/** Uploads one photo, runs the analysis and opens the result. Returns the Gemini calls. */
async function analyse(page, answer) {
  const calls = await fakeGemini(page, answer);
  await page.goto(BASE);
  await page.setInputFiles('[data-upload="0"]', { name: 'meal.jpg', mimeType: 'image/jpeg', buffer: PHOTO });
  await page.waitForSelector('#preview0:not(.hidden)');
  await page.click('#analyzeBtn');
  await page.locator('[data-action="job-open"]').first().click({ timeout: 15000 });
  await page.waitForSelector('#resTableBody > [data-idx]');
  return calls;
}
const totals = page => page.evaluate(() => ['Cal', 'P', 'C', 'F'].map(k => Number(document.getElementById('resTotal' + k).textContent)));

const tests = [];
const it = (name, fn) => tests.push({ name, fn });

it('precise analysis: three requests, table values, result editor shows the items', async browser => {
  const page = await freshPage(browser);
  const calls = await analyse(page, (body, model) => (body.generationConfig.responseSchema.properties.items
    ? { reasoning: 'r', name: '便當', packageKcal: 0, items: [item({ name: '白飯', foodKey: '白飯', foodType: 'starch', weight: 200 }), item({ name: '雞腿' })] }
    : { estimates: [{ index: 1, geo: '', weight: 200, method: 'plain' }, { index: 2, geo: '', weight: 100, method: 'plain' }] }));
  if (calls.length !== 3) throw new Error(`expected 3 Gemini calls, got ${calls.length}`);
  if (calls.some(c => JSON.stringify(c.body).includes('TEST-KEY'))) throw new Error('API key leaked into the body');
  const rows = await page.locator('#resTableBody > [data-idx]').count();
  if (rows !== 2) throw new Error(`expected 2 items, got ${rows}`);
  const [cal, p] = await totals(page);
  // 白飯 200 g from the table (3.1 / 41 / 0.3) + 100 g at 20 / 0 / 5  →  P 26.2, C 82, F 5.6 → 483 kcal
  if (Math.abs(cal - 483) > 2 || Math.abs(p - 26) > 1) throw new Error(`totals ${cal} kcal / P ${p}`);
  return page;
});

it('package total: only the package\'s items are scaled, the drink beside it is not', async browser => {
  const page = await freshPage(browser);
  await analyse(page, body => (body.generationConfig.responseSchema.properties.items
    ? { reasoning: 'r', name: '飯糰＋豆漿', packageKcal: 209, items: [
      item({ name: '飯糰', inPackage: true, proteinPer100g: 5, carbsPer100g: 35, fatPer100g: 2.2222 }),        // 180 kcal → 209
      item({ name: '無糖豆漿', inPackage: false, proteinPer100g: 10, carbsPer100g: 10, fatPer100g: 6.6667 })] } // 140 kcal, unchanged
    : { estimates: [{ index: 1, geo: '', weight: 100, method: 'plain' }, { index: 2, geo: '', weight: 100, method: 'plain' }] }));
  const [cal] = await totals(page);
  if (Math.abs(cal - 349) > 2) throw new Error(`total ${cal} kcal, expected 349 (209 + 140)`);
  const text = await page.locator('#resTableBody').innerText();
  if (!text.includes('209')) throw new Error('the package correction note is missing');
  return page;
});

it('saving the analysis adds a meal to today', async browser => {
  const page = await freshPage(browser);
  await analyse(page, body => (body.generationConfig.responseSchema.properties.items
    ? { reasoning: 'r', name: '雞胸', packageKcal: 0, items: [item({ name: '雞胸' })] } : { estimates: [{ index: 1, geo: '', weight: 100, method: 'plain' }] }));
  await page.click('[data-action="save-meal"]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('nutrilens_meals_v1') || '[]').some(m => m.name === '雞胸'));
  return page;
});

it('meal suggestions: request, nutrients computed by the app, no log button', async browser => {
  const page = await freshPage(browser);
  const food = over => ({ name: '雞胸', portion: '1 片', grams: 150, published: false, foodKey: '', method: 'plain', foodType: 'meat',
    proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 2, ...over });
  const calls = await fakeGemini(page, body => {
    const slot = body.contents[0].parts[0].text.match(/^- (\w+):/m)[1];
    const opt = t => ({ title: t, place: '便利商店', why: 'w', foods: [food(), food({ name: '白飯', foodKey: '白飯', grams: 250, foodType: 'starch' })] });
    return { meals: [{ slot, options: [opt('A'), opt('B'), opt('C')] }], tip: '' };
  });
  await page.goto(BASE);
  await page.click('[data-action="open-suggest"]');
  await page.click('[data-action="suggest-run"]');
  await page.waitForFunction(() => document.querySelector('#suggestResult')?.textContent.includes('白飯'), null, { timeout: 15000 });
  if (calls.length < 1) throw new Error('no suggestion request');
  if (await page.locator('#suggestResult [data-action="save-meal"]').count()) throw new Error('suggestions must not offer logging');
  return page;
});

it('no JavaScript errors on load in English and dark mode', async browser => {
  const page = await freshPage(browser, { nutrilens_lang_v1: 'en', nutrilens_theme_v1: 'dark' });
  await page.goto(BASE);
  await page.waitForTimeout(500);
  return page;
});

const browser = await chromium.launch();
let failed = 0;
for (const t of tests) {
  let page;
  try {
    page = await t.fn(browser);
    if (page?.errors?.length) throw new Error(`page errors: ${page.errors.join(' | ')}`);
    console.log(`ok - ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${t.name}\n  ${String(e.message || e).split('\n')[0]}`);
    try { await (page || (await browser.contexts().at(-1)?.pages())?.at(-1))?.screenshot({ path: path.join(OUT, `${tests.indexOf(t)}.png`) }); } catch { /* best effort */ }
  }
  for (const c of browser.contexts()) await c.close();
}
await browser.close(); server.close();
console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
