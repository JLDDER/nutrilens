/**
 * Unit tests for the pure parts of app.js (section 5, 6, 6b, 6c). Run from src/: node --test "tests/*.test.mjs"
 * The scripts are loaded as the browser loads them (see load.mjs); nothing here touches the network.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './load.mjs';

const app = loadApp();
const fn = name => app.get(name);
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} ± ${tol}, got ${actual}`);
/** A main-analysis item with sensible defaults. */
const rawItem = over => ({ name: '品項', fromLabel: false, published: false, foodKey: '', method: 'plain', foodType: 'meat', portionText: '',
  weightLow: 90, weight: 100, weightHigh: 110, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 5, ...over });

describe('basic nutrition', () => {
  test('kcalFromMacros uses 4/4/9', () => {
    assert.equal(fn('kcalFromMacros')(10, 20, 5), 165);
  });
  test('per100gToAbsolute scales by weight and derives kcal', () => {
    const r = fn('per100gToAbsolute')({ name: 'x', weight: 200, proteinPer100g: 10, carbsPer100g: 20, fatPer100g: 5 });
    assert.deepEqual(plain(r), { name: 'x', weight: 200, cal: 330, p: 20, c: 40, f: 10 });
  });
  test('roundedTotals sums rounded items', () => {
    assert.deepEqual(plain(fn('roundedTotals')([{ cal: 100.4, p: 1.04, c: 2, f: 3 }, { cal: 100.4, p: 1.04, c: 2, f: 3 }])), { cal: 200, p: 2, c: 4, f: 6 });
  });
});

describe('food table lookup', () => {
  const findFood = fn('findFood');
  test('exact key', () => assert.equal(findFood('白飯').key, '白飯'));
  test('alias', () => assert.equal(findFood('米飯').key, '白飯'));
  test('half-width brackets, slashes and spaces are normalised', () => {
    assert.equal(findFood(' 高麗菜(炒) ').key, '高麗菜（炒）');
  });
  test('unknown or empty → null', () => {
    assert.equal(findFood('不存在的食物'), null);
    assert.equal(findFood(''), null);
  });
  test('every row has a source name and oilIncluded flag', () => {
    for (const f of fn('FOOD_TABLE')) {
      assert.ok(f.srcName, `${f.key} has no srcName`);
      assert.equal(typeof f.oilIncluded, 'boolean', `${f.key} oilIncluded`);
    }
  });
});

describe('cooking oil', () => {
  const cookOil = fn('cookOil');
  test('byType values with ±25 % range', () => {
    assert.deepEqual(plain(cookOil('stirfry', 'veg')), [3.5, 4.6, 5.8]);
    assert.deepEqual(plain(cookOil('panfry', 'meat')), [8.2, 10.9, 13.6]);
  });
  test('starch, other and unknown types fall back to mixed (9.3), never 0', () => {
    for (const type of ['starch', 'other', 'nonsense']) assert.equal(cookOil('stirfry', type)[1], 9.3);
  });
  test('fixed ranges for deep frying, plain adds nothing, unknown method = plain', () => {
    assert.deepEqual(plain(cookOil('deepfry_breaded', 'meat')), [10, 15, 20]);
    assert.deepEqual(plain(cookOil('plain', 'meat')), [0, 0, 0]);
    assert.deepEqual(plain(cookOil('boiled???', 'meat')), [0, 0, 0]);
  });
  test('votedOil averages the typical values, widest range', () => {
    assert.deepEqual(plain(fn('votedOil')(['plain', 'plain', 'panfry'], 'meat')), [0, 3.6, 13.6]);
  });
  test('majorityMethod: most votes, tie goes to the main answer', () => {
    assert.equal(fn('majorityMethod')(['panfry', 'plain', 'plain']), 'plain');
    assert.equal(fn('majorityMethod')(['panfry', 'plain']), 'panfry');
  });
  test('nutrientsAt: served weight includes the oil (mass is conserved)', () => {
    const n = fn('nutrientsAt')({ p: 26, c: 10, f: 5 }, 15, 115);
    near(n.p, 26, 1e-9); near(n.f, 20, 1e-9);
    near(n.cal, fn('kcalFromMacros')(n.p, n.c, n.f), 1e-9);
  });
});

describe('combinePrecise', () => {
  const combine = fn('combinePrecise');
  test('median of the three weights; outliers beyond ×3 ignored', () => {
    const [a] = combine([rawItem({ weight: 100 })], { weightSets: [[120], [400]] });
    assert.equal(a.weight, 110);                       // median(100, 120); 400 > 300 is dropped
    assert.deepEqual(plain(a.src.estimates), [100, 120]);
  });
  test('table row wins over the model composition', () => {
    const [a] = combine([rawItem({ name: '白飯', foodKey: '白飯', proteinPer100g: 99, weight: 200, foodType: 'starch' })]);
    assert.equal(a.src.kind, 'table');
    near(a.p, 6.2, 1e-9);
  });
  test('label and published values are used as served: no oil, method plain', () => {
    for (const flag of ['fromLabel', 'published']) {
      const [a] = combine([rawItem({ [flag]: true, method: 'deepfry_breaded', foodKey: '白飯' })]);
      assert.equal(a.src.kind, flag === 'fromLabel' ? 'label' : 'published');
      assert.equal(a.src.oilG, 0);
      assert.equal(a.src.method, 'plain');
      near(a.p, 20, 1e-9);
    }
  });
  test('oil-included table rows get no extra oil', () => {
    const [a] = combine([rawItem({ foodKey: '高麗菜（炒）', method: 'stirfry', foodType: 'veg' })]);
    assert.equal(a.src.oilG, 0);
    assert.equal(a.src.oilIncluded, true);
  });
  test('split method votes add part of the oil', () => {
    const [a] = combine([rawItem({ method: 'panfry' })], { weightSets: [[100], [100]], methodSets: [['plain'], ['plain']] });
    assert.equal(a.src.method, 'plain');
    assert.equal(a.src.methodSplit, true);
    near(a.src.oilG, 3.5, 0.1);
  });
  test('kcal always equals 4p + 4c + 9f', () => {
    const [a] = combine([rawItem({ method: 'deepfry_breaded', carbsPer100g: 12 })]);
    near(a.cal, fn('kcalFromMacros')(a.p, a.c, a.f), 1e-9);
    assert.ok(a.range.lowCal <= a.cal && a.cal <= a.range.highCal);
  });
});

describe('scaleToPackage', () => {
  const combine = fn('combinePrecise'), scale = fn('scaleToPackage');
  const items = () => combine([rawItem({ name: 'A' }), rawItem({ name: 'B' })]);
  test('outside 30–3000 kcal: unchanged', () => {
    const before = items();
    assert.equal(scale(before, 0), before);
    assert.equal(scale(before, 5000), before);
  });
  test('not scaled when an item comes from a nutrition label', () => {
    const list = combine([rawItem({ fromLabel: true }), rawItem()]);
    assert.equal(scale(list, 300), list);
  });
});

describe('meal suggestions: planning', () => {
  const defaultSlots = fn('defaultSlots'), mealTargets = fn('mealTargets');
  test('defaultSlots: meals not logged and not over yet', () => {
    assert.deepEqual(plain(defaultSlots('15:20', ['08:00', '12:30'])), ['dinner']);
    assert.deepEqual(plain(defaultSlots('09:00', [])), ['breakfast', 'lunch', 'dinner']);
  });
  test('defaultSlots: late evening → 宵夜; 00:00–03:59 belongs to the previous night', () => {
    assert.deepEqual(plain(defaultSlots('22:00', ['08:00', '12:00', '19:00'])), ['night']);
    assert.deepEqual(plain(defaultSlots('01:00', ['23:30'])), []);
  });
  test('mealTargets normal: shares renormalised over the chosen meals', () => {
    const r = mealTargets({ cal: 900, p: 90, c: 60, f: 25 }, ['dinner']);
    assert.equal(r.mode, 'normal');
    assert.deepEqual(plain(r.meals[0]), { slot: 'dinner', cal: 900, p: 90, c: 60, f: 25 });
  });
  test('mealTargets tight / over: each meal gets its minimum, never 0', () => {
    assert.equal(mealTargets({ cal: 200, p: 55, c: 30, f: 5 }, ['dinner']).mode, 'tight');
    const over = mealTargets({ cal: -300, p: -10, c: -50, f: -20 }, ['dinner', 'night']);
    assert.equal(over.mode, 'over');
    assert.deepEqual(plain(over.meals.map(m => m.cal)), [350, 150]);
    assert.ok(over.meals.every(m => m.p > 0 && m.c > 0 && m.f > 0));
  });
  test('looksUnderLogged: after 17:00, ≤ 1 meal, < 30 % eaten', () => {
    const f = fn('looksUnderLogged');
    assert.equal(f('18:00', 300, 2000, 1), true);
    assert.equal(f('16:00', 300, 2000, 1), false);
    assert.equal(f('18:00', 700, 2000, 1), false);
  });
});

describe('meal suggestions: parsing and correction', () => {
  const plan = { mode: 'normal', meals: [{ slot: 'dinner', cal: 600, p: 40, c: 60, f: 20 }] };
  const food = over => ({ name: '雞胸', portion: '1 片', grams: 150, published: false, foodKey: '', method: 'plain', foodType: 'meat',
    proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 2, ...over });
  const answer = { meals: [
    { slot: 'dinner', options: [
      { title: 'A', place: 'x', why: 'w', foods: [food(), food({ name: '白飯', foodKey: '白飯', grams: 200, foodType: 'starch' })] },
      { title: 'B', place: 'x', why: 'w', foods: [food({ grams: 0 })] }] },
    { slot: 'breakfast', options: [{ title: 'C', place: 'x', why: 'w', foods: [food()] }] }], tip: ' t ' };
  test('keeps planned meals only, drops empty options, computes nutrients like a precise analysis', () => {
    const r = fn('parseSuggestions')(answer, plan);
    assert.equal(r.meals.length, 1);
    assert.equal(r.meals[0].options.length, 1);
    const o = r.meals[0].options[0];
    assert.equal(o.foods[1].source, 'table');
    near(o.cal, fn('kcalFromMacros')(o.p, o.c, o.f), 9, 'totals are rounded per macro:');
    assert.equal(r.tip, 't');
  });
  test('optionGap / suggestMisses / suggestGap', () => {
    const target = plan.meals[0];
    assert.deepEqual(plain(fn('optionGap')({ cal: 480, p: 30 }, target)), { cal: 0.2, protein: 0.25 });
    const result = { meals: [{ slot: 'dinner', options: [{ title: 'ok', cal: 600, p: 40 }, { title: 'low', cal: 400, p: 40 }] }] };
    assert.deepEqual(plain(fn('suggestMisses')(result, plan).map(m => m.o.title)), ['low']);
    near(fn('suggestGap')(result, plan), 1 / 3, 1e-9);
  });
  test('suggestCorrection carries the first answer and the app numbers', () => {
    const text = fn('suggestCorrection')('USER', { meals: [] }, [{ slot: 'dinner', o: { title: 'low', cal: 400, p: 20, f: 10 }, target: plan.meals[0] }]);
    assert.match(text, /^USER/);
    assert.match(text, /"low": 400 kcal, protein 20 g, fat 10 g \(target 600 kcal, protein 40 g, fat 20 g\)/);
  });
});

describe('prompts', () => {
  test('shared guides appear in every prompt that needs them', () => {
    const [PG, MG, PUB] = ['PORTION_GUIDE', 'METHOD_GUIDE', 'PUBLISHED_GUIDE'].map(fn);
    const precise = fn('buildPrecisePrompt')({ lang: 'zh', imageCount: 2, note: '', refs: [] }).system;
    const weight = fn('buildWeightPrompt')([{ name: 'A' }], '', []).system;
    const standard = fn('buildNutritionPrompt')({ lang: 'zh', imageCount: 2, note: '', refs: [] }).system;
    for (const s of [precise, weight, standard]) assert.ok(s.includes(PG));
    for (const s of [precise, weight]) assert.ok(s.includes(MG));
    assert.ok(precise.includes(PUB));
  });
  test('user text: photo order, references and note; description mode without photos', () => {
    const u = fn('promptUserText')(2, '飯半碗', ['筷子 長 22.5 cm']);
    assert.match(u, /1st top view/);
    assert.match(u, /筷子 長 22.5 cm/);
    assert.match(u, /飯半碗/);
    assert.match(fn('promptUserText')(0, '大麥克'), /^No photo/);
  });
  test('weight prompt lists names only (no first-answer weights)', () => {
    const p = fn('buildWeightPrompt')([{ name: '白飯', weight: 160 }, { name: '炸排骨', weight: 120 }], '', []);
    assert.match(p.user, /1\. 白飯\n2\. 炸排骨/);
    assert.doesNotMatch(p.user, /160/);
  });
});

describe('goal history', () => {
  const goalsOn = fn('goalsOn'), withGoalChange = fn('withGoalChange');
  const g = (from, cal) => ({ from, cal, p: 100, c: 200, f: 50 });
  test('goals of a date are the latest entry on or before it; earlier dates use the first', () => {
    const h = [g('2026-10-01', 2000), g('2026-10-10', 1800)];
    assert.equal(goalsOn(h, '2026-10-05').cal, 2000);
    assert.equal(goalsOn(h, '2026-10-10').cal, 1800);
    assert.equal(goalsOn(h, '2026-09-01').cal, 2000);
    assert.equal(goalsOn([], '2026-10-01'), null);
  });
  test('withGoalChange replaces a same-day change and skips no-op changes', () => {
    const h = [g('2026-10-01', 2000)];
    assert.equal(withGoalChange(h, { cal: 2000, p: 100, c: 200, f: 50 }, '2026-10-05').length, 1);
    const changed = withGoalChange(withGoalChange(h, { cal: 1900, p: 100, c: 200, f: 50 }, '2026-10-05'), { cal: 1800, p: 100, c: 200, f: 50 }, '2026-10-05');
    assert.deepEqual(plain(changed.map(x => x.cal)), [2000, 1800]);
  });
});

describe('records', () => {
  test('withEditedItems recomputes totals and keeps invalid date/time', () => {
    const meal = { id: 'm', name: 'a', date: '2026-10-01', time: '12:00', items: [] };
    const r = fn('withEditedItems')(meal, { name: '', time: 'x', date: 'bad', items: [{ name: ' b ', weight: 10.4, cal: 100, p: 1, c: 2, f: 3 }] });
    assert.equal(r.name, 'a'); assert.equal(r.time, '12:00'); assert.equal(r.date, '2026-10-01');
    assert.equal(r.items[0].name, 'b'); assert.equal(r.cal, 100);
  });
  test('mealCopy gets a new id, date and time and loses the demo flag', () => {
    const r = fn('mealCopy')({ id: 'm', demo: true, photoId: 'p' }, '2026-10-02', '08:00');
    assert.notEqual(r.id, 'm'); assert.equal(r.date, '2026-10-02'); assert.equal(r.demo, undefined); assert.equal(r.photoId, 'p');
  });
  test('sanitizeSuggestPrefs keeps known places only', () => {
    assert.deepEqual(plain(fn('sanitizeSuggestPrefs')({ places: ['bento', 'evil', 'bento'], diet: ' 不吃\n蝦 ' })), { places: ['bento'], diet: '不吃 蝦' });
  });
});

describe('migrations', () => {
  test('migration 3 starts the goal history from the first recorded day', () => {
    const a = loadApp({ storage: {
      nutrilens_goals_v1: JSON.stringify({ cal: 1800, p: 120, c: 200, f: 50 }),
      nutrilens_meals_v1: JSON.stringify([{ date: '2026-09-15' }, { date: '2026-09-01' }])
    } });
    a.get('runMigrations')();
    assert.deepEqual(JSON.parse(a.localStorage.getItem('nutrilens_goal_history_v1')), [{ from: '2026-09-01', cal: 1800, p: 120, c: 200, f: 50 }]);
    assert.equal(a.localStorage.getItem('nutrilens_schema_version'), String(a.get('MIGRATIONS').length));
  });
});

describe('Gemini calls (fake fetch)', () => {
  const okBody = text => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} });
  const response = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
  const preciseAnswer = JSON.stringify({ reasoning: 'r', name: 'n', packageKcal: 0, items: [rawItem()] });

  test('a search request refused with 429 is re-sent at once without the tool, and search stays off', async () => {
    const a = loadApp();
    const bodies = [];
    a.setFetch(async (url, init) => {
      const body = JSON.parse(init.body); bodies.push(body);
      return body.tools ? response(429, { error: { message: 'You exceeded your current quota' } }) : response(200, okBody(preciseAnswer));
    });
    const run = { attempts: [] };
    const r = await a.get('gemini').generate({ key: 'k', model: 'gemini-3.5-flash-lite', parts: [{ text: 'x' }], system: 's',
      signal: new AbortController().signal, run, task: a.get('PRECISE_TASK') });
    assert.equal(r.rawItems.length, 1);
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0].tools && !bodies[1].tools);
    assert.equal(a.get('webSearch').available(), false);
  });
  test('a 400 naming the tool is handled the same way', async () => {
    const a = loadApp();
    let calls = 0;
    a.setFetch(async (url, init) => {
      calls++;
      return JSON.parse(init.body).tools ? response(400, { error: { message: 'Search grounding is not supported' } }) : response(200, okBody(preciseAnswer));
    });
    await a.get('gemini').generate({ key: 'k', model: 'gemini-3.5-flash-lite', parts: [], system: 's',
      signal: new AbortController().signal, run: { attempts: [] }, task: a.get('PRECISE_TASK') });
    assert.equal(calls, 2);
  });
  test('fallback: a 429 moves on to the next model; a 400 stops', async () => {
    const a = loadApp();
    const models = [];
    a.setFetch(async url => {
      const m = decodeURIComponent(url.match(/models\/([^:]+)/)[1]); models.push(m);
      return m === 'first' ? response(429, { error: { message: 'quota' } }) : response(200, okBody(preciseAnswer));
    });
    a.get('webSearch').turnOff();
    const r = await a.get('gemini').generateWithFallback({ key: 'k', model: 'first', parts: [], system: 's',
      signal: new AbortController().signal, task: a.get('PRECISE_TASK'), backups: ['second', 'third'] });
    assert.equal(r.modelUsed, 'second');
    assert.deepEqual(models, ['first', 'second']);

    a.setFetch(async () => response(400, { error: { message: 'bad request' } }));
    await assert.rejects(a.get('gemini').generateWithFallback({ key: 'k', model: 'first', parts: [], system: 's',
      signal: new AbortController().signal, task: a.get('PRECISE_TASK'), backups: ['second'] }), /bad request/);
  });
  test('the API key goes in a header, never in the URL', async () => {
    const a = loadApp();
    let seen;
    a.setFetch(async (url, init) => { seen = { url, init }; return response(200, okBody(preciseAnswer)); });
    a.get('webSearch').turnOff();
    await a.get('gemini').generate({ key: 'SECRET', model: 'm', parts: [], system: 's', signal: new AbortController().signal,
      run: { attempts: [] }, task: a.get('PRECISE_TASK') });
    assert.doesNotMatch(seen.url, /SECRET/);
    assert.equal(seen.init.headers['x-goog-api-key'], 'SECRET');
  });
});
