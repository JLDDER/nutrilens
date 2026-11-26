/**
 * Prompt v14 (2026-11-26): changes proposed by another agent, verified one by one against the owner's backup
 * (182 meals, 53 photos) and adopted, corrected or declined. Run from src/: node --test "tests/*.test.mjs"
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './load.mjs';

const app = loadApp();
const fn = name => app.get(name);
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const item = over => ({ name: '品項', fromLabel: false, inPackage: false, published: false, foodKey: '', method: 'plain', foodType: 'meat',
  fatSource: 'ingredient', portionText: '', count: 0, weightLow: 100, weight: 100, weightHigh: 100, proteinPer100g: 20, carbsPer100g: 0,
  fatPer100g: 5, oilSheen: 'unclear', separatedOil: false, soupOil: 'none', bowlDiameterCm: 0, storePackaging: false, diningSetting: 'unclear',
  ...over });
const combine = (items, opts = {}) => plain(fn('combinePrecise')(items, opts));
const one = (over, opts) => combine([item(over)], opts)[0];

describe('1. a visible nutrition label keeps its net weight', () => {
  // 11/23 光泉優格脆片杯: label 10 g + 130 g (117.8 kcal) was saved as 15 g + 99 g.
  const cup = [item({ name: '穀物脆片（上杯）', fromLabel: true, inPackage: true, foodType: 'starch', weight: 10, weightLow: 10, weightHigh: 10,
    proteinPer100g: 3.8, carbsPer100g: 83.9, fatPer100g: 2.3 }),
  item({ name: '優格（下杯）', fromLabel: true, inPackage: true, foodType: 'other', weight: 130, weightLow: 130, weightHigh: 130,
    proteinPer100g: 3.3, carbsPer100g: 4.6, fatPer100g: 3.4 })];
  test('re-estimates do not move label weights', () => {
    const list = combine(cup, { weightSets: [[15, 99], [16, 95]] });
    assert.deepEqual(list.map(i => i.weight), [10, 130]);
    assert.equal(list[0].src.kind, 'label');
  });
  test('a printed total within ±5 % of the label items leaves them as they are', () => {
    const list = plain(fn('scaleToPackage')(fn('combinePrecise')(cup, {}), 117));
    assert.deepEqual(list.map(i => i.weight), [10, 130]);
  });
});

describe('2. weight re-estimates', () => {
  test('know which photo is which and use the same thinking floor as the main analysis', () => {
    const wp = fn('buildWeightPrompt')([item({ name: '白飯' })], '', [], 2);
    assert.match(wp.user, /1st top view, 2nd ~45° side view/);
    assert.equal(fn('WEIGHT_TASK').thinking, fn('PRECISE_TASK').thinking);
  });
  test('the median of the three answers is kept (2:1:1 declined): main 85 g, re-estimates 60 g, 60 g → 60 g', () => {
    // Evidence: the owner's photos show the same thin toast every day; their own saved value is 60 g on 12 of 24 days.
    const t = one({ name: '烤白吐司 2 片', foodType: 'starch', weight: 85, weightLow: 70, weightHigh: 100 }, { weightSets: [[60], [60]] });
    assert.equal(t.weight, 60);
  });
  test('the toast anchor is a measured thin slice (about 33 g), not 35–45 g', () => {
    assert.match(fn('PORTION_GUIDE'), /薄片白吐司 30–35 g\/片/);
  });
});

describe('3. food groups and the no-oil fat bounds', () => {
  test('rows filed under the wrong group no longer stretch the bounds', () => {
    const b = fn('groupFatBounds');
    assert.deepEqual(plain(b('starch', '白飯')), [0.1, 2.3]);
    assert.equal(plain(b('veg', '燙青菜'))[1], 0.5);
    assert.equal(plain(b('meat', '雞胸'))[1], 9.1);
    assert.equal(plain(b('meat', '五花肉'))[1], 44.2);
  });
  test('filled starch foods keep the bounds of measured filled products, so a pan-fried 生煎包 still gets its oil', () => {
    assert.equal(plain(fn('groupFatBounds')('starch', '生煎包'))[1], 15.5);
    assert.ok(one({ name: '生煎包', method: 'panfry', foodType: 'starch' }).src.oilG > 0);
  });
  test('lean meat with oil already in the model fat: no oil added twice', () => {
    assert.equal(one({ name: '蒜炒雞胸', method: 'stirfry', proteinPer100g: 28, fatPer100g: 12 }, { methodSets: [['stirfry'], ['stirfry']] }).src.oilG, 0);
  });
});

describe('4. table rows that have no plain pair are kept', () => {
  test('炒飯 voted plain keeps the measured row', () => {
    const r = one({ name: '炒飯', foodKey: '炒飯', method: 'stirfry', foodType: 'starch' }, { methodSets: [['plain'], ['plain']] });
    assert.equal(r.src.kind, 'table'); assert.equal(r.src.key, '炒飯');
  });
  test('親子丼料 is a simmered dish (rowMethod none)', () => {
    assert.equal(fn('findFood')('親子丼料（不含飯）').rowMethod, 'none');
  });
  test('荷包蛋 with 沒放油 in the note gets no oil even when the photo says pan-fried', () => {
    const r = one({ name: '荷包蛋', foodKey: '荷包蛋（加油 1 小匙）', method: 'panfry', foodType: 'other', count: 1 }, { note: '荷包蛋沒放油',
      methodSets: [['panfry'], ['panfry']] });
    assert.equal(r.src.oilG, 0);
  });
});

describe('5. table lookup by everyday names', () => {
  const find = (k, n) => fn('findFoodFor')(k, n)?.key ?? null;
  test('quantities, cooking prefixes and aliases', () => {
    assert.equal(find('', '烤白吐司 2 片'), '白吐司');
    assert.equal(find('', '炒高麗菜'), '高麗菜（炒）');
    assert.equal(find('', '黃金奇異果 1 顆'), '奇異果');
    assert.equal(find('', '水煮雞胸肉片'), '雞胸（去皮，水煮）');
    assert.equal(find('', '水煮鮪魚'), '鮪魚罐頭（水煮，瀝乾）');
    assert.equal(find('', '香雞蛋吐司'), null);
    assert.equal(find('', '滷雞腿'), null);
  });
  test('boiled chicken breast and drained tuna carry the values of their cited USDA rows', () => {
    const c = fn('findFood')('雞胸（去皮，水煮）'), t = fn('findFood')('鮪魚罐頭（水煮，瀝乾）');
    assert.deepEqual([c.p, c.f], [29.0, 3.0]);                      // NDB 05065 breast, meat only, stewed
    assert.deepEqual([t.p, t.f], [25.5, 0.8]);                      // NDB 15121 (v14 had 19.4 / 1.0, not that row's values)
  });
});

describe('6. coating carbohydrate for fried plain rows', () => {
  test('a breaded pork loin from a plain row gets the coating starch', () => {
    const r = one({ name: '炸豬排', foodKey: '豬小里肌（煎／烤）', method: 'deepfry_breaded', weight: 150, weightLow: 150, weightHigh: 150 },
      { methodSets: [['deepfry_breaded'], ['deepfry_breaded']] });
    near(r.src.coatingCarbG, 18, 0.1);
    assert.ok(r.c >= 18);
  });
});

describe('7. physical ceiling', () => {
  test('p + c + f over 100 g per 100 g is scaled down and marked', () => {
    const m = plain(fn('clampMacrosPer100')({ p: 44, c: 68, f: 26 }));
    near(m.p + m.c + m.f, 100, 0.2); assert.equal(m.clamped, true);
    assert.equal(one({ name: '潛艇堡', foodType: 'starch', proteinPer100g: 44, carbsPer100g: 68, fatPer100g: 26 }).src.uncertain, true);
  });
});

describe('8–9. photos and prompt', () => {
  test('photos go at 1024 px; prompt v14', () => {
    assert.equal(fn('CONFIG').image.maxDim, 1024);
    assert.equal(fn('CONFIG').precise.promptVersion, 14);
  });
});
