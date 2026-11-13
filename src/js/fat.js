'use strict';
/* =====================================================================
 * NutriLens AI — fat ledger (脂肪帳本) for meals without a label (loaded after foods.js, before app.js)
 * ---------------------------------------------------------------------
 * Spec: NutriLens_脂肪帳本規格 v9.2 (reviewed by a chef and a dietitian, verified before implementation).
 * Every gram of fat belongs to one of four sources:
 *   A ingredient  the food itself (meat, egg, tofu, products bought fried)
 *   B topping     mayonnaise, butter, lard, 肉燥, sesame paste, drizzled oil
 *   C cooking oil oil the food took up when stir-fried, pan-fried or deep-fried
 *   D soup/sauce  floating oil on soup, sauce oil of 三杯 / 麻油 dishes, red oil
 * The centre value is never moved on purpose; what is not known goes into the range.
 * Every number is either measured (source named) or an assumption numbered as in the spec (#n).
 *
 * Sections
 *   F1. Measured cooking-oil data (日本食品標準成分表 八訂 2023 增補, 表 13 / 表 14) and the methods built from it
 *   F2. Dishes, toppings and cuts (spec 2.1, 3.3.5, 3.4)
 *   F3. The user's note (spec 3.1)
 *   F4. Context: home / store / unknown (spec 3.1-4)
 *   F5. Oil for one item (spec 3.3)
 *   F6. Soup (spec 3.6)
 * All functions are pure; js/app.js (combinePrecise) puts them together.
 * ===================================================================== */

/* ── F1. Measured cooking oil ─────────────────────────────────────────── */
const fr1 = x => Math.round(x * 10) / 10;
const fmedian = list => { const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** 表 14 (stir-fry / sauté, 5 g oil per 100 g raw): code → [name, the last column = g fat gained per 100 g cooked weight].
 *  The last column is per 100 g AS SERVED (cabbage: 4.6 g per 100 g raw ÷ 0.80 cooked = 5.75 → 5.8). */
const MEXT_T14 = {
  '06327': ['アスパラガス', 3.6], '06331': ['トウミョウ', 5.4], '06375': ['グリンピース冷凍', 3.9], '06333': ['キャベツ', 5.8],
  '06335': ['切干しだいこん', 5.8], '06336': ['たまねぎ', 5.8], '06389': ['あめ色たまねぎ', 6.4], '06338': ['チンゲンサイ', 3.1],
  '06170': ['とうがらし葉', 4.8], '06379': ['スイートコーン冷凍', 4.5], '06342': ['なす', 5.6], '06206': ['にがうり', 3.2],
  '06344': ['にら', 5.4], '06345': ['にんじん', 6.2], '06381': ['にんじん冷凍', 3.8], '06349': ['にんにく', 4.8],
  '06351': ['根深ねぎ', 4.3], '06352': ['葉ねぎ', 4.9], '06246': ['青ピーマン', 4.1], '06248': ['赤ピーマン', 4.1],
  '06394': ['オレンジピーマン', 4.8], '06250': ['黄ピーマン', 4.1], '06397': ['ブロッコリー', 5.5], '06359': ['ほうれんそう', 7.4],
  '06373': ['ほうれんそう冷凍', 4.1], '06412': ['だいずもやし', 2.9], '06398': ['ブラックマッペもやし', 0.9], '06413': ['りょくとうもやし', 2.7],
  '06384': ['ミックスベジタブル冷凍', 4.1], '08037': ['えのきたけ', 3.7], '08038': ['あらげきくらげ', 5.0], '08041': ['しいたけ菌床', 3.7],
  '08044': ['しいたけ原木', 5.0], '08046': ['ぶなしめじ', 4.9], '08050': ['エリンギ', 3.3], '08051': ['まいたけ', 3.8],
  '08052': ['マッシュルーム', 4.1], '09052': ['ひじきステンレス釜', 4.3], '09055': ['ひじき鉄釜', 4.3],
  '10473': ['蒸しだこ', 1.2], '12021': ['目玉焼き', 5.2], '12022': ['いり卵', 5.2],
  '10436': ['大西洋さけ皮つきソテー', -0.4], '10443': ['大西洋さけ皮なしソテー', -4.0], '10455': ['くろまぐろ赤身ソテー', 1.4],
  '10464': ['くろまぐろ脂身ソテー', -10.6], '11298': ['ささみソテー', 4.2]
};
/** 表 13 (deep-fry): code → [name, cooked mass per 100 g raw, A (per 100 g raw main material), C (per 100 g of the fried
 *  food incl. coating, ＊2)]. 素揚げ rows print A only: C = A ÷ (cooked mass ÷ 100); checked against the database's
 *  「調理油」 for ぶなしめじ素揚げ (8.4 ÷ 0.63 = 13.3, database 13.4). */
const MEXT_T13 = {
  '02067': ['じゃがいも皮なし素揚げ', 71, 4.0, null], '02065': ['じゃがいも皮つき素揚げ', 71, 3.9, null],
  '08055': ['ぶなしめじ素揚げ', 63, 8.4, null], '10474': ['蒸しだこ素揚げ', 59, 1.2, null],
  '02047': ['さつまいも天ぷら', 98, 6.2, 6.3], '06343': ['なす天ぷら', 109, 15.2, 13.8], '08057': ['しいたけ天ぷら', 150, 20.8, 13.6],
  '08056': ['ぶなしめじ天ぷら', 191, 32.3, 16.5], '10400': ['きす天ぷら', 105, 15.8, 14.8], '10437': ['さけ皮つき天ぷら', 102, 4.0, 3.8],
  '10444': ['さけ皮なし天ぷら', 96, 0.7, 0.7], '10456': ['まぐろ赤身天ぷら', 97, 4.7, 4.7], '10465': ['まぐろ脂身天ぷら', 94, -5.2, -5.7],
  '10416': ['バナメイえび天ぷら', 102, 9.9, 9.5], '10419': ['するめいか天ぷら', 119, 12.2, 10.1], '11299': ['ささみ天ぷら', 92, 6.0, 6.4],
  '10390': ['まあじフライ', 116, 16.6, 13.0], '10395': ['まいわしフライ', 118, 26.5, 21.0], '10403': ['まさばフライ', 112, 11.3, 9.1],
  '10409': ['すけとうだらフライ', 124, 13.8, 10.0], '10430': ['かきフライ', 119, 10.9, 8.5], '10470': ['するめいかフライ', 95, 21.7, 21.8],
  '11305': ['ロースハムフライ', 132, 28.3, 20.3], '11308': ['ウインナーフライ', 102, 5.1, 4.8], '11300': ['ささみフライ', 91, 10.9, 11.6],
  '11276': ['ロースとんかつ', 91, 13.4, 14.0], '11279': ['ヒレとんかつ', 97, 20.9, 20.7],
  '10392': ['まあじから揚げ', 79, 9.7, 12.2], '11289': ['もも皮つきから揚げ', 75, -0.7, -1.2], '11290': ['もも皮なしから揚げ', 81, 4.3, 5.1]
};
const mextT14 = code => MEXT_T14[code][1];
const mextT13 = code => { const [, mass, a, c] = MEXT_T13[code]; return c === null ? fr1(a / (mass / 100)) : c; };

/** Measured rows per method (spec 3.3.1 table). Negative values (food lost fat into the pan) count as 0 (#12). */
const OIL_SOURCES = {
  stirfry_veg: { table: 14, codes: Object.keys(MEXT_T14).filter(c => /^0[689]/.test(c)) },
  stirfry_cut: { table: 14, codes: ['12022'] },                                  // #1: meat strips assumed like scrambled egg
  panfry_lean: { table: 14, codes: ['11298', '10455', '12021'] },
  panfry_skin_fatty: { table: 14, codes: ['10436', '10443', '10464'] },
  deepfry_plain: { table: 13, codes: ['02067', '02065', '08055', '10474'] },
  deepfry_light: { table: 13, codes: ['10392', '11289', '11290'] },
  deepfry_breaded: { table: 13, codes: ['10390', '10395', '10403', '10409', '10430', '10470', '11305', '11308', '11300', '11276', '11279'] },
  deepfry_batter: { table: 13, codes: ['02047', '06343', '08057', '08056', '10400', '10437', '10444', '10456', '10465', '10416', '10419', '11299'] }
};
/** { mid, lo, hi, measured: [values ≥ 0], codes } per sub-method, computed from the codes above (never typed in). */
const OIL_STATS = (() => {
  const out = { plain: { mid: 0, lo: 0, hi: 0, measured: [0], codes: [] } };
  for (const [m, { table, codes }] of Object.entries(OIL_SOURCES)) {
    const raw = codes.map(table === 14 ? mextT14 : mextT13), vals = raw.map(v => Math.max(0, v));
    out[m] = { mid: fr1(Math.max(0, fmedian(raw))), lo: Math.min(...vals), hi: Math.max(...vals), measured: vals, codes };
  }
  out.stirfry_cut = { ...out.stirfry_cut, lo: out.stirfry_cut.mid, hi: out.stirfry_cut.mid };            // #1
  out.panfry_starch = { mid: 5, lo: 3, hi: 8, measured: [], codes: [], assumed: 2 };                       // #2: no measurement
  out.panfry_tofu = { ...out.panfry_lean, assumed: 13 };                                                    // #13
  out.deepfry_porous = { mid: out.deepfry_plain.mid, lo: out.deepfry_plain.lo, hi: 16.9, measured: [], codes: [], assumed: 14 };  // #14
  return out;
})();
/** Upper bound beyond the 5 %-oil experiment: Pu et al. 2019 median oil used in meat dishes, 12.8 g / 100 g raw, at a
 *  70 % cooked yield: 12.8 ÷ (70 + 12.8) × 100 ≈ 15.5 g / 100 g served, assuming all of it is eaten (#15). */
const OIL_UPPER_MEAT = 15.5;

/** Individual measured rows that replace a method's median (spec 3.3.1 個別列). Matched on the item name. */
const OIL_INDIVIDUAL = [
  { method: 'deepfry_porous', re: /茄子/, mid: 16.9, src: '八訂 06194 べいなす素揚げ 17.0 − 生 0.1 ÷ 0.93' },
  { method: 'deepfry_plain', re: /茄子/, mid: 16.9, src: '八訂 06194 べいなす素揚げ 17.0 − 生 0.1 ÷ 0.93' },
  { method: 'deepfry_batter', re: /茄子/, mid: 13.8, src: '八訂 06343 C' },
  { method: 'deepfry_batter', re: /鮭/, mid: 3.8, src: '八訂 10437 C' },
  { method: 'deepfry_breaded', re: /腰內|小里肌|菲力/, mid: 20.7, src: '八訂 11279 C' },
  { method: 'deepfry_breaded', re: /豬排|排骨|炸里肌/, mid: 14.0, src: '八訂 11276 C' },
  { method: 'deepfry_light', re: /唐揚.*(去皮)|去皮.*唐揚/, mid: 5.1, src: '八訂 11290 C' },
  { method: 'deepfry_light', re: /唐揚/, mid: 0, src: '八訂 11289 C（−1.2 以 0 計）' },
  { method: 'panfry_lean', re: /荷包蛋|煎蛋/, mid: 3.7, lo: 3.7, hi: 5.2, src: 'TFND K0123201 − K0123101' },   // #28, #33
  // Stir-fried vegetables measured one by one (表 14).
  ...[['高麗菜|包心菜|甘藍', '06333'], ['茄子', '06342'], ['豆芽', '06413'], ['洋蔥', '06336'], ['青江菜|江菜', '06338'],
    ['菠菜', '06359'], ['紅蘿蔔|胡蘿蔔', '06345'], ['青椒|彩椒|甜椒', '06246'], ['花椰|青花菜', '06397'], ['蘆筍', '06327'],
    ['韭菜', '06344'], ['苦瓜', '06206'], ['金針菇', '08037'], ['香菇', '08041'], ['鴻喜菇|美白菇', '08046'],
    ['杏鮑菇', '08050'], ['豆苗', '06331'], ['玉米', '06379']]
    .map(([words, code]) => ({ method: 'stirfry_veg', re: new RegExp(words), mid: mextT14(code), src: `八訂 ${code}` }))
];

/* ── F2. Dishes, toppings and cuts ────────────────────────────────────── */
/** Dishes fried before braising, and oil-heavy dishes (spec 3.3.5, #5). `fry`: the item must be fried; if the votes say
 *  otherwise the default fry method applies. `force`: always this sub-method. `row`: use this FOOD_TABLE row (product
 *  bought fried, no oil added). `sauceOil`: D oil per 100 g [lo, mid, hi]. `drink0`: red-oil soup is not drunk. */
const DISH_RULES = [
  { re: /滷排骨|炸排骨|台式排骨/, fry: 'deepfry_light' },
  { re: /生煎包|煎包|鍋貼|煎餃/, force: 'panfry_starch' },
  { re: /生炒/, force: 'stirfry_cut' },
  { re: /烤肉飯|燒肉飯|烤肉便當|醬燒肉|燒肉便當/, force: 'panfry_lean' },
  { re: /雞排/, fry: 'deepfry_breaded' },
  { re: /獅子頭|糖醋|橙汁排骨|宮保/, fry: 'deepfry_light' },
  { re: /紅燒魚/, fry: 'deepfry_plain' },
  { re: /紅燒豆腐|鐵板豆腐|三杯豆腐/, row: '油豆腐' },
  { re: /茄子/, unless: /蒸|涼拌|燙|天婦羅/, force: 'deepfry_porous' },
  { re: /乾煸四季豆/, force: 'deepfry_plain' },
  { re: /豆包/, row: '炸豆皮' },                                                   // #43
  { re: /鹽酥雞|排骨酥/, fry: 'deepfry_light' },
  { re: /麵筋/, row: '麵筋（油炸）' },
  { re: /烤麩/, force: 'deepfry_porous' },
  { re: /三杯|麻油雞|麻油腰花|麻油麵線/, force: 'stirfry_cut', sauceOil: [2, 4, 8] },   // #17
  { re: /(沙茶|蔥爆|黑胡椒|青椒)(牛|羊|豬)/, force: 'stirfry_cut' },
  { re: /水煮魚|水煮牛/, redOil: [0, 5, 12], drink0: true },                         // #30
  { re: /滷雞腿|滷豬腳/, plainUnlessFried: true }
];
const dishRuleFor = name => DISH_RULES.find(r => r.re.test(name) && !(r.unless && r.unless.test(name))) || null;

/** Taiwanese sweet-potato-starch fries: deepfry_light centre, upper bound widened to the breaded maximum (#21). */
const TW_STARCH_FRY = /鹽酥|排骨酥|雞米花|雞塊|炸雞|地瓜粉|台式|滷排骨|炸排骨|炸雞腿/;

/** Conventional toppings (spec 3.4; list shown to the user 2026-11-13). Composition from FOOD_TABLE (TFND rows); the
 *  grams are assumptions (#19) as [low, typical, high]. tier 1: part of the dish (store and unknown → centre; home → none);
 *  tier 2: hidden spread (store → centre; unknown → range only; home → none). perPiece: grams per slice / piece. */
const TOPPING_RULES = [
  { tier: 1, re: /乾麵|意麵|乾板條|乾拌|拌麵/, not: /麻醬|炸醬|涼麵/, row: '豬油', label: 'toppingOilMix', g: [3, 5, 10] },
  { tier: 1, re: /麻醬麵/, row: '芝麻醬（麻醬）', label: 'toppingSesame', g: [10, 20, 30] },
  { tier: 1, re: /炸醬麵/, row: '炸醬', label: 'toppingZhajiang', g: [20, 40, 60] },
  { tier: 1, re: /涼麵/, row: '芝麻醬（麻醬）', label: 'toppingColdNoodle', g: [8, 15, 25] },
  { tier: 1, re: /肉燥飯|滷肉飯|魯肉飯/, row: '肉燥', label: 'toppingLuRou', g: [15, 30, 50] },
  { tier: 2, re: /漢堡/, row: '沙拉醬（美乃滋）', label: 'toppingMayo', g: [5, 10, 15] },
  { tier: 2, re: /捲餅/, row: '沙拉醬（美乃滋）', label: 'toppingMayo', g: [5, 10, 15] },
  { tier: 2, re: /三明治/, row: '沙拉醬（美乃滋）', label: 'toppingMayo', g: [5, 10, 15] },
  { tier: 2, re: /奶酥/, row: '奶酥醬', label: 'toppingStreusel', g: [10, 20, 30] },
  { tier: 2, re: /奶油(烤)?吐司|奶油厚片/, row: '人造奶油（乳瑪琳）', label: 'toppingButter', g: [4, 6, 10], perPiece: true }
];
/** Words that mean a topping or fat is already listed as its own item (no conventional one added). */
const TOPPING_WORDS = /美乃滋|沙拉醬|奶油|乳瑪琳|奶酥|麻醬|芝麻醬|肉燥|滷肉|豬油|拌油|炸醬|花生醬|油蔥|香油|麻油|辣油|蔥油|沙茶|醬/;
/** A sauce item the model listed that has no table row of its own: 飯上滷汁 is counted as 肉燥 (TFND has no 滷汁, #44). */
const SAUCE_PROXY = [{ re: /滷汁|肉燥汁|滷肉汁/, row: '肉燥', g: [5, 10, 20] }];

/** Default cut when the photo cannot show it (spec 2.1, #6): TFND raw fat × cooked ÷ raw ratio (#42: 八訂 ロース 22.7 ÷
 *  19.2 = 1.18, バラ 43.9 ÷ 35.4 = 1.24, other cuts 1.2). Values: fat g per 100 g cooked [range low, centre, range high]. */
const CUT_FAT = {
  belly: fr1(33.9 * 1.24), butt: fr1(14.0 * 1.2), loin: fr1(14.4 * 1.18), tenderloin: fr1(5.4 * 1.2), ham: fr1(4.0 * 1.2),
  mince: fr1(14.6 * 1.2), shank: fr1(5.75 * 1.2), brisket: fr1(29.7 * 1.2)
};
const CUT_RULES = [
  { re: /滷肉|肉燥|控肉|焢肉|爌肉/, fat: [CUT_FAT.butt, CUT_FAT.belly, CUT_FAT.belly], cut: '五花' },
  { re: /排骨|豬排/, fat: [CUT_FAT.tenderloin, CUT_FAT.loin, CUT_FAT.loin], cut: '大里肌' },
  { re: /(豬)?肉絲|(豬)?肉片/, not: /牛|羊|雞/, fat: [CUT_FAT.ham, CUT_FAT.ham, CUT_FAT.butt], cut: '後腿' },
  { re: /絞肉|肉末|獅子頭/, fat: [CUT_FAT.mince, CUT_FAT.mince, CUT_FAT.mince], cut: '豬絞肉' },
  { re: /烤肉|燒肉/, fat: [CUT_FAT.ham, CUT_FAT.butt, CUT_FAT.belly], cut: '梅花' },
  { re: /牛肉麵|紅燒牛|牛肉塊/, fat: [CUT_FAT.shank, CUT_FAT.shank, CUT_FAT.brisket], cut: '牛腱' },
  { re: /雞腿/, not: /去皮|帶皮/, fat: [5.2, 15.2, 15.2], cut: '帶皮雞腿' }      // 八訂 11226 / 11223 boiled
];
/** Words that already name the cut (then the model's composition stands). */
const CUT_NAMED = /五花|三層|梅花|里肌|後腿|前腿|腱|腩|瘦|肥|去皮|帶皮|胸|小排|肋/;
const cutRuleFor = (name, foodType) => (foodType === 'meat' || foodType === 'mixed') && !CUT_NAMED.test(name)
  ? CUT_RULES.find(r => r.re.test(name) && !(r.not && r.not.test(name))) || null : null;

/** Whole shell-cooked eggs counted by number: 55 g each (衛福部 代換表, one exchange), range 50–60 g (#7). */
const COUNT_EGG = /水煮蛋|白煮蛋|溏心蛋|茶葉蛋|滷蛋|糖心蛋/;
const NOT_COUNT_EGG = /鐵蛋|鳥蛋|鵪鶉|鹹鴨蛋|皮蛋|荷包|炒蛋|蛋白/;

/* ── F3. The user's note ──────────────────────────────────────────────── */
const ZERO_WORDS = ['生魚片', '生菜', '氣炸', '清蒸', '水煮', '燙', '蒸', '烤', '滷'];      // longest first
const OIL_WORDS = [['乾煎', 'panfry'], ['煎', 'panfry'], ['炒', 'stirfry']];
const NO_OIL = /沒放油|無油|不放油|沒加油|不加油|零油/;
const LESS_OIL = /少油|噴油/;
const NOT_FRIED = /沒炸|沒有炸|自己滷|自己煮/;
const NO_DRIZZLE = /沒淋油|不淋油|沒加油/;
const REMOVE = /(沒加|沒有加|去掉|不要|不加)([^\s、，,；;。]{1,6})/g;
const QTY = /[0-9０-９.]+|[一二三四五六七八九十兩半]+|(片|顆|個|碗|份|杯|塊|條|盒|根|支|隻|粒|匙|口|串|g|公克|克|ml|毫升|cc)/gi;

/** Splits the note into segments and reads each one. Pure. */
function parseNote(note) {
  const text = String(note || '');
  const segments = text.split(/[、，,；;。\n／/+＋]|\s+/).map(s => s.trim()).filter(Boolean).map(seg => {
    const zero = ZERO_WORDS.find(w => seg.includes(w)) || '';
    const oil = OIL_WORDS.find(([w]) => seg.includes(w));
    let core = seg.replace(/[（(].*?[）)]/g, '');
    const drop = ['乾煎', '煎', '炒', '少油', '噴油', '沒放油', '無油', '不放油', '沒加油', '不加油', '自己', '在家', '自煮', '買的', '外帶', '我煮'];
    for (const w of [...ZERO_WORDS, ...drop]) core = core.split(w).join('');
    core = core.replace(QTY, '').replace(/[:：]/g, '').trim();
    return { text: seg, core, zero, oil: oil ? oil[1] : '', dryFry: seg.includes('乾煎'), noOil: NO_OIL.test(seg), lessOil: LESS_OIL.test(seg),
      notFried: NOT_FRIED.test(seg), noDrizzle: NO_DRIZZLE.test(seg) };
  });
  const removed = [...text.matchAll(REMOVE)].map(m => m[2]);
  // "沒放油" in a segment that names no food applies to every item.
  const noOilAll = segments.some(s => s.noOil && !s.core);
  const lessOilAll = segments.some(s => s.lessOil && !s.core);
  let drink = null;
  if (/湯(都)?喝完|湯全喝|喝光/.test(text)) drink = 1;
  else if (/沒喝湯|湯沒喝|不喝湯|湯不喝/.test(text)) drink = 0;
  else if (/湯喝一半|喝一半湯|半碗湯|湯喝半/.test(text)) drink = 0.5;
  return { text, segments, removed, noOilAll, lessOilAll, drink };
}

/** Longest common substring length (short strings). */
function lcsLen(a, b) {
  let best = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    let k = 0; while (a[i + k] && a[i + k] === b[j + k]) k++;
    if (k > best) best = k;
  }
  return best;
}
/** The note segment that talks about this item, or null: the core is contained in the name (or the other way round),
 *  or they share two or more characters. Pure. */
const GENERIC_VEG = /^(青菜|蔬菜|菜|燙菜|時蔬|葉菜)$/;
function noteSegmentFor(name, parsed, foodType = '') {
  const n = String(name || '');
  let best = null, score = 0;
  for (const s of parsed.segments) {
    if (!s.core) continue;
    const generic = foodType === 'veg' && GENERIC_VEG.test(s.core) ? 50 : 0;
    const sc = n.includes(s.core) || s.core.includes(n) ? 100 + s.core.length : Math.max(generic, lcsLen(n, s.core));
    if (sc >= 2 && sc > score) { best = s; score = sc; }
  }
  return best;
}

/* ── F4. Context ──────────────────────────────────────────────────────── */
const HOME_WORDS = /自己|在家|自煮|自帶|家裡|我煮|帶便當/;
const SCENE_WORDS = /自助餐|便當店|早餐店|麵店|熱炒|小吃|外食/;
const SINGLE_WORDS = /買的|外帶|超商|7-?11|7-?ELEVEN|小七|全家|萊爾富|OK超商|麥當勞|摩斯|肯德基|星巴克|路易莎|85度C/i;
/** Foods the context does not matter for (pre-packed, plain drinks and fruit, plain staples; #38, #40). */
const SKIP_CONTEXT = /優格|優酪|豆漿|牛奶|鮮奶|鮮乳|奶茶|咖啡|拿鐵|茶|果汁|香蕉|蘋果|芭樂|水果|燕麥|堅果|白飯|糙米飯|五穀飯|燕麥飯|紫米飯|麵條|乾麵條|^地瓜|^馬鈴薯|^玉米|^南瓜|水$/;
/** Home cooking word + whole food, for the structural check (#24a). */
const HOME_METHOD = /水煮|燙|蒸|烤|煎|乾煎|氣炸/;

/**
 * Context per item: 'home' | 'store' | 'unknown' (spec 3.1-4). items: [{ name, storePackaging, diningSetting, skip }].
 * Pure.
 */
function contextsFor(items, parsed) {
  const segs = parsed.segments;
  const homeAny = segs.some(s => HOME_WORDS.test(s.text)), sceneAny = segs.some(s => SCENE_WORDS.test(s.text));
  // A single-item word at the start followed by a colon describes the whole meal (外帶：…).
  const leadSingle = /^[^、，,；;\n]*?(買的|外帶)\s*[:：]/.test(parsed.text);
  const out = items.map(it => {
    if (it.skip) return null;
    const seg = noteSegmentFor(it.name, parsed, it.foodType), idx = seg ? segs.indexOf(seg) : -1;
    if (seg && SINGLE_WORDS.test(seg.text)) return 'store';
    if (seg && HOME_WORDS.test(seg.text)) return 'home';
    if (seg && SCENE_WORDS.test(seg.text)) return 'store';
    if (leadSingle) return 'store';
    if (homeAny && !sceneAny) return 'home';
    if (sceneAny && !homeAny) return 'store';
    if (homeAny && sceneAny && idx >= 0) {
      for (let i = idx; i >= 0; i--) { if (HOME_WORDS.test(segs[i].text)) return 'home'; if (SCENE_WORDS.test(segs[i].text)) return 'store'; }
    }
    if (it.storePackaging === true || it.diningSetting === 'store') return 'store';
    return '';
  });
  // Structural rule: every remaining item is "home cooking word + whole food" and no listed dish → home.
  const rest = items.map((it, i) => (out[i] === '' ? i : -1)).filter(i => i >= 0);
  const homey = rest.length > 0 && parsed.segments.length > 0 && rest.every(i => {
    const seg = noteSegmentFor(items[i].name, parsed, items[i].foodType);
    return seg && HOME_METHOD.test(seg.text) && !dishRuleFor(items[i].name) && !TOPPING_RULES.some(r => r.re.test(items[i].name));
  });
  const meal = sceneAny && !homeAny ? 'store' : homeAny && !sceneAny ? 'home' : 'unknown';
  return out.map((c, i) => (c === null ? meal : c === '' ? (homey && rest.includes(i) ? 'home' : 'unknown') : c));
}

/* ── F5. Oil for one item ─────────────────────────────────────────────── */
/** Sub-method from the coarse method the model votes with (spec 3.3.2-6; #23). */
function subMethod(method, { name = '', foodType = 'mixed', fatPer100 = 0 } = {}) {
  if (method === 'stirfry') return foodType === 'veg' ? 'stirfry_veg' : 'stirfry_cut';
  if (method === 'panfry') {
    if (/豆腐|豆干/.test(name)) return 'panfry_tofu';
    if (foodType === 'starch' || /蘿蔔糕|蔥抓餅|蔥油餅|蛋餅|鍋貼|煎餃|煎包|餅/.test(name)) return 'panfry_starch';
    if (/帶皮|雞腿|鮭|鯖|虱目魚|五花|三層|秋刀|魚肚|鴨/.test(name) || fatPer100 >= 10) return 'panfry_skin_fatty';
    return 'panfry_lean';
  }
  if (method === 'deepfry_plain' && /茄子|烤麩|豆腐|麵筋/.test(name)) return 'deepfry_porous';
  return OIL_STATS[method] ? method : 'plain';
}
const isFry = m => m.startsWith('deepfry');

/**
 * Cooking oil per 100 g served for one sub-method: { lo, mid, hi, src } (spec 3.3.1–3.3.3). Pure.
 * ctx: { name, context, sheen ('none'|'light'|'heavy'|'unclear'|''), separatedOil, lessOil, dryFry }.
 */
function oilFor(sub, { name = '', context = 'unknown', sheen = '', separatedOil = false, lessOil = false, dryFry = false } = {}) {
  const s = OIL_STATS[sub] || OIL_STATS.plain;
  if (sub === 'plain') return { lo: 0, mid: 0, hi: 0, src: '' };
  let { lo, mid, hi } = s, src = s.assumed ? `#${s.assumed}` : '八訂';
  const ind = OIL_INDIVIDUAL.find(r => r.method === sub && r.re.test(name));
  const methodMid = mid;
  if (ind) {
    mid = ind.mid; src = ind.src;
    if (ind.lo !== undefined) { lo = ind.lo; hi = ind.hi; }
    else if (sub.startsWith('stirfry') && methodMid > 0) {     // #36: the method's range scaled to the row, inside the method's bounds
      lo = Math.max(s.lo, fr1(ind.mid * s.lo / methodMid)); hi = Math.min(s.hi, fr1(ind.mid * s.hi / methodMid));
    }
    else { lo = Math.min(lo, mid); hi = Math.max(hi, mid); }
  }
  // Taiwanese starch-coated fries: centre as 唐揚, range up to the breaded maximum (#21).
  if (sub === 'deepfry_light' && TW_STARCH_FRY.test(name) && !/唐揚/.test(name)) { mid = s.mid; lo = 0; hi = OIL_STATS.deepfry_breaded.hi; src = '#21'; }
  // Oil sheen: symmetric half-steps towards the measured low / high (#3); not for fried or fatty-skin items, nor rows.
  if (!ind && ['stirfry_veg', 'stirfry_cut', 'panfry_starch'].includes(sub)) {
    if (sheen === 'none') mid = fr1((mid + lo) / 2);
    else if (sheen === 'heavy') mid = fr1((mid + hi) / 2);
  }
  // 少油 / 噴油 / home 乾煎: lower half of the measured values (median of the lower half, n odd → incl. the median), never above
  // the normal centre; no measurement → the range's low (#16, #25).
  if (lessOil || dryFry) {
    const m = [...s.measured].sort((a, b) => a - b);
    const lower = m.slice(0, Math.ceil(m.length / 2));
    const less = sub === 'panfry_skin_fatty' ? 0 : lower.length ? fmedian(lower) : lo;
    mid = fr1(Math.min(mid, less));
    lo = context === 'store' ? Math.min(lo, mid) : 0;
  }
  // Upper bounds beyond the experiment: meat stir-fries anywhere, fatty pan-fries in shops (#15, #15b).
  if (sub === 'stirfry_cut') hi = Math.max(hi, OIL_UPPER_MEAT);
  if (sub === 'panfry_skin_fatty' && context === 'store') hi = Math.max(hi, OIL_UPPER_MEAT);
  if (separatedOil && ['stirfry_veg', 'stirfry_cut', 'panfry_starch'].includes(sub)) {
    hi = Math.max(hi, sub === 'stirfry_cut' ? OIL_UPPER_MEAT : OIL_STATS[sub].hi);
  }
  return { lo: fr1(Math.min(lo, mid)), mid: fr1(mid), hi: fr1(Math.max(hi, mid)), src };
}

/** Majority of categorical votes; three different → the middle level of `order` (#27). Pure. */
function voteLevel(votes, order) {
  const v = votes.filter(x => order.includes(x));
  if (!v.length) return '';
  const counts = new Map(); v.forEach(x => counts.set(x, (counts.get(x) || 0) + 1));
  const top = Math.max(...counts.values());
  const winners = [...counts.keys()].filter(k => counts.get(k) === top);
  if (winners.length === 1) return winners[0];
  const idx = winners.map(w => order.indexOf(w)).sort((a, b) => a - b);
  return order[idx[Math.floor(idx.length / 2)]];
}
const SHEEN_ORDER = ['none', 'light', 'heavy'];
/** unclear counts as light (the centre); returns 'none' | 'light' | 'heavy' | ''. */
const sheenVote = votes => voteLevel(votes.map(v => (v === 'unclear' ? 'light' : v)), SHEEN_ORDER);
const SOUP_ORDER = ['none', 'film', 'layer', 'thick'];

/* ── F6. Soup ─────────────────────────────────────────────────────────── */
/** Floating-oil thickness per level in mm [lo, mid, hi] (#9) and the share of the bowl's mouth the soup surface covers (#26b). */
const SOUP_OIL_MM = { none: [0, 0, 0], film: [0, 0.025, 0.05], layer: [0.1, 0.3, 0.5], thick: [0.5, 1.0, 2.0] };
const SOUP_SURFACE = [0.6, 0.8, 1.0];
const SOUP_DRINK = [0.5, 0.75, 1.0];            // #10, #11: same share as the broth
const SOUP_BOWL_DEFAULT_CM = [14, 16, 18];      // #45: when the model gives no diameter
/** Floating oil in grams eaten [lo, mid, hi]. Pure. */
function soupOilGrams(level, diameterCm, drink) {
  const mm = SOUP_OIL_MM[level] || SOUP_OIL_MM.none;
  const d = diameterCm > 5 && diameterCm < 40 ? [diameterCm, diameterCm, diameterCm] : SOUP_BOWL_DEFAULT_CM;
  const share = drink === null || drink === undefined ? SOUP_DRINK : [drink, drink, drink];
  return [0, 1, 2].map(i => fr1(Math.PI * (d[i] / 2) ** 2 * SOUP_SURFACE[i] * (mm[i] / 10) * 0.92 * share[i]));
}
const isSoupItem = name => /湯|羹/.test(name) && !/湯包|湯圓|湯匙/.test(name);
