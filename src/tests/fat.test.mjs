/**
 * Fat ledger (js/fat.js + combinePrecise), spec NutriLens_脂肪帳本規格 v9.2. Run from src/: node --test "tests/*.test.mjs"
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './load.mjs';

const app = loadApp();
const fn = name => app.get(name);
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} ± ${tol}, got ${actual}`);
const item = over => ({ name: '品項', fromLabel: false, published: false, foodKey: '', method: 'plain', foodType: 'meat', fatSource: 'ingredient',
  portionText: '', count: 0, weightLow: 100, weight: 100, weightHigh: 100, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 5,
  oilSheen: 'unclear', separatedOil: false, soupOil: 'none', bowlDiameterCm: 0, storePackaging: false, diningSetting: 'unclear', ...over });
const combine = (items, opts = {}) => fn('combinePrecise')(items, opts);
const one = (over, opts) => combine([item(over)], opts)[0];

describe('measured oil (八訂 表 13 / 14, computed from the food numbers)', () => {
  const S = () => fn('OIL_STATS');
  test('method medians and ranges match the verification script', () => {
    const want = { stirfry_veg: [4.3, 0.9, 7.4], panfry_lean: [4.2, 1.4, 5.2], panfry_skin_fatty: [0, 0, 0], deepfry_plain: [5.6, 2.0, 13.3],
      deepfry_light: [5.1, 0, 12.2], deepfry_breaded: [13.0, 4.8, 21.8], deepfry_batter: [8.0, 0, 16.5], stirfry_cut: [5.2, 5.2, 5.2] };
    for (const [m, [mid, lo, hi]] of Object.entries(want)) {
      near(S()[m].mid, mid, 0.051, m); near(S()[m].lo, lo, 0.051, m); near(S()[m].hi, hi, 0.051, m);
    }
  });
  test('spot checks: 06342 = 5.6, 06333 = 5.8, 11298 = 4.2, 11276 C = 14.0; 素揚げ converted to served weight', () => {
    assert.equal(fn('mextT14')('06342'), 5.6); assert.equal(fn('mextT14')('06333'), 5.8); assert.equal(fn('mextT14')('11298'), 4.2);
    assert.equal(fn('mextT13')('11276'), 14.0); assert.equal(fn('mextT13')('08055'), 13.3);
  });
  test('individual rows: deep-fried eggplant 16.9, tonkatsu 14.0, stir-fried cabbage 5.8 (range scaled, inside 0.9–7.4)', () => {
    assert.equal(fn('oilFor')('deepfry_porous', { name: '茄子' }).mid, 16.9);
    assert.equal(fn('oilFor')('deepfry_breaded', { name: '炸豬排' }).mid, 14);
    const cab = fn('oilFor')('stirfry_veg', { name: '炒高麗菜' });
    assert.deepEqual([cab.lo, cab.mid, cab.hi], [1.2, 5.8, 7.4]);
  });
  test('Taiwanese starch-coated fries: centre 5.1, upper bound 21.8; 鹽酥雞 with skin is not 唐揚 (−1.2 → 0)', () => {
    const o = fn('oilFor')('deepfry_light', { name: '鹽酥雞（帶皮）' });
    assert.deepEqual([o.lo, o.mid, o.hi], [0, 5.1, 21.8]);
    const a = one({ name: '鹽酥雞（帶皮）', method: 'deepfry_light' });
    near(a.src.oilG, 5.1, 0.05);
  });
});

describe('oil sheen, less oil, separated oil', () => {
  const oilFor = (sub, ctx) => fn('oilFor')(sub, ctx);
  test('sheen moves the centre symmetrically by half a step', () => {
    near(oilFor('stirfry_veg', { sheen: 'none' }).mid, (4.3 + 0.9) / 2, 0.051);
    near(oilFor('stirfry_veg', { sheen: 'heavy' }).mid, (4.3 + 7.4) / 2, 0.051);
    assert.equal(oilFor('stirfry_veg', { sheen: 'light' }).mid, 4.3);
  });
  test('three different sheen votes give the middle level, so the centre stays', () => {
    assert.equal(fn('sheenVote')(['none', 'light', 'heavy']), 'light');
  });
  test('少油: lower half of the measured values (panfry_lean {1.4, 4.2, 5.2} → 2.8), never above the normal centre', () => {
    assert.equal(oilFor('panfry_lean', { lessOil: true }).mid, 2.8);
    for (const m of Object.keys(fn('OIL_STATS'))) {
      assert.ok(oilFor(m, { lessOil: true }).mid <= oilFor(m, {}).mid, m);
    }
  });
  test('separated oil widens only the upper bound', () => {
    const a = oilFor('stirfry_veg', {}), b = oilFor('stirfry_veg', { separatedOil: true, sheen: 'none' });
    assert.ok(b.hi >= a.hi);
    assert.equal(oilFor('stirfry_veg', { separatedOil: true }).mid, a.mid);
  });
  test('meat stir-fry: centre 5.2 (#1), upper bound 15.5 (Pu 2019, #15)', () => {
    const o = oilFor('stirfry_cut', {});
    assert.deepEqual([o.mid, o.hi], [5.2, 15.5]);
  });
});

describe('the note (spec 3.1)', () => {
  test('烤魚 in an unknown context is one vote among four; at home it is applied', () => {
    const photo = { methodSets: [['panfry', 'plain'], ['panfry', 'plain']] };
    const [a] = combine([item({ name: '烤魚', method: 'panfry' }), item({ name: '滷肉飯', foodType: 'mixed' })], { ...photo, note: '烤魚、滷肉飯' });
    assert.equal(a.src.context, 'unknown');
    near(a.src.oilG, 4.2 * 3 / 4, 0.06);
    const b = one({ name: '烤魚', method: 'panfry' }, { ...photo, note: '在家 烤魚' });
    assert.equal(b.src.oilG, 0); assert.equal(b.src.methodFromNote, true);
  });
  test('沒放油 means no cooking oil in any context', () => {
    for (const note of ['煎雞胸 沒放油', '自助餐，煎雞胸沒放油']) {
      assert.equal(one({ name: '煎雞胸', method: 'panfry' }, { note }).src.oilG, 0, note);
    }
  });
  test('home 乾煎雞胸 150 g: 2.8 g / 100 g → about 4 g, range up to 7.8 g', () => {
    const a = one({ name: '乾煎雞胸', method: 'panfry', weight: 150, weightLow: 150, weightHigh: 150, fatPer100g: 2 }, { note: '乾煎雞胸、燙青菜、地瓜' });
    assert.equal(a.src.context, 'home');
    near(a.src.oilG, 4.2, 0.05);
    near(a.src.ledger.C, 4.2, 0.05);
    near(a.src.fatRange[1], (150 - 7.8) * 0.02 + 150 * 0.052, 0.05);   // oil is part of the served weight
  });
  test('shop 乾煎 is ordinary pan-frying', () => {
    near(one({ name: '乾煎魚片', method: 'panfry', foodType: 'meat' }, { note: '自助餐 乾煎魚片' }).src.oilG, 4.2, 0.05);
  });
  test('dish names are not cooking words: 生煎包, 生炒花枝 and 烤肉飯 are never plain', () => {
    assert.ok(one({ name: '生煎包', method: 'plain', foodType: 'starch' }, { note: '生煎包' }).src.oilG > 0);
    assert.ok(one({ name: '生炒花枝', method: 'plain' }, { note: '生炒花枝' }).src.oilG > 0);
    assert.ok(one({ name: '烤肉飯的烤肉', method: 'plain' }, { note: '烤肉飯' }).src.oilG > 0);
  });
});

describe('context (spec 3.1-4)', () => {
  const ctx = (names, note, over = {}) => fn('contextsFor')(names.map(n => ({ name: n, foodType: /青菜|菜/.test(n) ? 'veg' : 'meat',
    skip: fn('SKIP_CONTEXT').test(n), ...over })), fn('parseNote')(note));
  test('a bought item does not make the home-cooked ones a shop meal', () => {
    assert.deepEqual(plain(ctx(['乾煎雞胸', '燙青菜', '烤地瓜'], '乾煎雞胸、燙青菜、烤地瓜（7-11 買的）')), ['home', 'home', 'store']);
    assert.deepEqual(plain(ctx(['乾煎雞胸', '燙青菜', '無糖豆漿', '優格'], '乾煎雞胸、燙青菜、無糖豆漿（買的）、優格')).slice(0, 2), ['home', 'home']);
  });
  test('plain staples are skipped: 水煮雞胸、糙米飯、燙青菜 is home', () => {
    assert.deepEqual(plain(ctx(['水煮雞胸', '糙米飯', '燙青菜'], '水煮雞胸、糙米飯、燙青菜')).filter((_, i) => i !== 1), ['home', 'home']);
  });
  test('a scene word applies to the whole meal, whatever the punctuation', () => {
    assert.deepEqual(plain(ctx(['白飯', '滷雞腿', '炒高麗菜', '茄子'], '自助餐，白飯、滷雞腿、炒高麗菜、茄子')), ['store', 'store', 'store', 'store']);
    assert.deepEqual(plain(ctx(['漢堡'], '早餐店 漢堡 奶茶')), ['store']);
  });
  test('no evidence: unknown', () => {
    assert.deepEqual(plain(ctx(['滷肉飯', '燙青菜', '貢丸湯'], '滷肉飯、燙青菜、貢丸湯')), ['unknown', 'unknown', 'unknown']);
  });
  test('外帶 at the start with a colon covers the meal', () => {
    assert.deepEqual(plain(ctx(['雞腿便當', '燙青菜'], '外帶：雞腿便當、燙青菜')), ['store', 'store']);
  });
});

describe('table rows against the final method (spec 3.3.2-7)', () => {
  const home = { note: '' };
  test('home 水煮花椰菜 matched to 綠花椰（炒） → 綠花椰（燙）, no oil', () => {
    const a = one({ name: '水煮花椰菜', foodKey: '綠花椰（炒）', method: 'stirfry', foodType: 'veg' }, { note: '水煮花椰菜、水煮雞胸' });
    assert.equal(a.src.key, '綠花椰（燙）'); assert.equal(a.src.oilG, 0);
  });
  test('home 燙青菜 matched to 高麗菜（炒） → the blanched row', () => {
    const a = one({ name: '燙青菜', foodKey: '高麗菜（炒）', method: 'stirfry', foodType: 'veg' }, { note: '燙青菜、水煮蛋' });
    assert.equal(a.src.key, '高麗菜（燙）'); near(a.f, 0.2, 1e-9);
  });
  test('finished products are kept: 烤吐司 → 白吐司, 水餃 → 水餃 row, no oil', () => {
    const a = one({ name: '烤吐司', foodKey: '白吐司', method: 'plain', foodType: 'starch' }, { note: '烤吐司 2 片' });
    assert.equal(a.src.key, '白吐司'); assert.equal(a.src.oilG, 0);
    const b = one({ name: '水餃', foodKey: '水餃（高麗菜，熟）', method: 'plain', foodType: 'starch' }, { methodSets: [['plain'], ['plain']] });
    assert.equal(b.src.key, '水餃（高麗菜，熟）'); assert.equal(b.src.oilG, 0);
  });
  test('紅燒豆腐 uses fried tofu (TFND R4701101) and adds no oil', () => {
    const a = one({ name: '紅燒豆腐', method: 'plain', foodType: 'other' });
    assert.equal(a.src.key, '油豆腐'); assert.equal(a.src.oilG, 0);
  });
  test('three of four votes stir-fried: 0.2 + ¾ × 5.8 ≈ 4.6 g / 100 g', () => {
    const a = one({ name: '炒高麗菜', foodKey: '高麗菜（炒）', method: 'stirfry', foodType: 'veg' },
      { methodSets: [['stirfry'], ['stirfry']], note: '炒高麗菜' });
    // the note's 炒 is a direct method; use votes only
    const b = one({ name: '高麗菜', foodKey: '高麗菜（炒）', method: 'stirfry', foodType: 'veg' }, { methodSets: [['stirfry'], ['plain']] });
    near(b.f, 0.2 + 5.8 * 2 / 3, 0.1);
    assert.ok(a.f > 5.5);
  });
  test('plain bases get oil from the final method: 煎豆腐, 煎蘿蔔糕, 煎雞胸', () => {
    near(one({ name: '煎豆腐', foodKey: '板豆腐', method: 'panfry', foodType: 'other' }, { note: '煎豆腐' }).src.oilG, 4.2, 0.05);
    near(one({ name: '煎蘿蔔糕', foodKey: '蘿蔔糕（未煎）', method: 'panfry', foodType: 'starch' }).src.oilG, 5, 0.05);
    near(one({ name: '煎雞胸', foodKey: '雞胸（去皮，烤／煎）', method: 'panfry' }, { note: '煎雞胸' }).src.oilG, 4.2, 0.05);
  });
  test('home 烤雞腿 on the grilled row: no oil; 炒青菜 on a blanched row: stir-fry oil; 煎水餃: pan-fry oil', () => {
    assert.equal(one({ name: '烤雞腿', foodKey: '雞腿（帶皮，烤／煎）', method: 'plain' }, { note: '烤雞腿、燙青菜' }).src.oilG, 0);
    assert.ok(one({ name: '炒青菜', foodKey: '高麗菜（燙）', method: 'stirfry', foodType: 'veg' }).src.oilG > 3);
    near(one({ name: '煎水餃', foodKey: '水餃（高麗菜，熟）', method: 'panfry', foodType: 'starch' }, { note: '煎水餃' }).src.oilG, 5, 0.05);
  });
});

describe('toppings, drizzle, soup', () => {
  test('乾麵 from a shop gets the usual lard (5 g), not at home, not when the note says 沒加', () => {
    const shop = combine([item({ name: '乾麵', foodType: 'starch', fatPer100g: 0.6 })], { note: '麵店 乾麵' });
    assert.equal(shop.length, 2); assert.equal(shop[1].src.kind, 'convention'); near(shop[1].f, 5, 0.05);
    assert.equal(combine([item({ name: '乾麵', foodType: 'starch' })], { note: '自己煮 乾麵' }).length, 1);
    assert.equal(combine([item({ name: '乾麵', foodType: 'starch' })], { note: '麵店 乾麵 沒加豬油' }).length, 1);
  });
  test('a listed topping is not added twice, and its dish gets no drizzle either', () => {
    const list = combine([item({ name: '乾麵', foodType: 'starch', oilSheen: 'heavy' }), item({ name: '豬油拌油', fatSource: 'topping' })], { note: '麵店 乾麵' });
    assert.equal(list.filter(x => x.src.kind === 'convention').length, 0);
    assert.equal(list[0].src.drizzleG, 0);
    const veg = combine([item({ name: '燙青菜', foodType: 'veg', oilSheen: 'heavy' }), item({ name: '燙青菜上的肉燥', fatSource: 'topping' })], { note: '麵店' });
    assert.equal(veg[0].src.drizzleG, 0);
  });
  test('shiny shop vegetables get 3 g / 100 g drizzle; rice never does', () => {
    near(one({ name: '燙青菜', foodType: 'veg', oilSheen: 'light', fatPer100g: 0.2 }, { note: '自助餐 燙青菜' }).src.drizzleG, 3, 0.05);
    assert.equal(one({ name: '白飯', foodType: 'starch', oilSheen: 'light' }, { note: '自助餐 白飯' }).src.drizzleG, 0);
  });
  test('三明治 matched to the TFND row (spread included) gets no extra mayonnaise; an unknown 漢堡 only widens the range', () => {
    assert.equal(combine([item({ name: '火腿蛋三明治', foodKey: '火腿蛋三明治', foodType: 'starch' })], { note: '早餐店 三明治' }).length, 1);
    const [h] = combine([item({ name: '漢堡', foodType: 'mixed' })], { note: '漢堡' });
    assert.ok(h.src.fatRange[1] > h.f + 5);
  });
  test('floating soup oil: 18 cm, layer, 75 % → 4.2 g (spec 3.6 example)', () => {
    assert.equal(fn('soupOilGrams')('layer', 18, null)[1], 4.2);
    const s = one({ name: '牛肉湯', fatSource: 'sauce', foodType: 'other', soupOil: 'layer', bowlDiameterCm: 18, fatPer100g: 0.5 });
    near(s.src.soupOilG, 4.2, 0.05); near(s.src.ledger.D, s.f, 0.1);
  });
  test('三杯雞 carries sauce oil (D) on top of the stir-fry oil', () => {
    const a = one({ name: '三杯雞', method: 'stirfry' });
    near(a.src.sauceOilG, 4, 0.05); near(a.src.oilG, 5.2, 0.05);
  });
});

describe('ledger and range', () => {
  test('the ledger adds up to the item fat; the range holds the centre', () => {
    const list = combine([item({ name: '炒高麗菜', foodType: 'veg', method: 'stirfry', fatPer100g: 0.2 }),
      item({ name: '乾麵', foodType: 'starch', fatPer100g: 0.6 }), item({ name: '貢丸湯', fatSource: 'sauce', soupOil: 'film' })], { note: '麵店' });
    for (const it of list) {
      const sum = Object.values(it.src.ledger).reduce((s, v) => s + v, 0);
      near(sum, it.f, 0.25, it.name);
      assert.ok(it.src.fatRange[0] <= it.f + 1e-9 && it.f <= it.src.fatRange[1] + 1e-9, it.name);
    }
    const L = fn('fatLedger')(list);
    near(L.A + L.B + L.C + L.D, list.reduce((s, x) => s + x.f, 0), 0.5);
    assert.ok(L.lo <= L.hi);
  });
  test('whole eggs by count: 2 茶葉蛋 = 110 g (55 g each, 50–60)', () => {
    const a = one({ name: '茶葉蛋', foodKey: '茶葉蛋', count: 2, weight: 120, foodType: 'other' });
    assert.equal(a.weight, 110);
  });
  test('cut not visible: 滷肉 uses the belly-pork default and is marked', () => {
    const a = one({ name: '滷肉', method: 'plain', fatPer100g: 20 });
    assert.equal(a.src.cut, '五花'); near(a.f, 42.0, 0.1);
  });
  test('the plausibility check flags and widens, never moves the centre', () => {
    const a = one({ name: '燙地瓜葉', foodType: 'veg', fatPer100g: 25 });
    assert.equal(a.src.uncertain, true); near(a.f, 25, 1e-9);
  });
});
