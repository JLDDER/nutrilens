'use strict';
/* =====================================================================
 * NutriLens AI — cooked-food composition table (loaded before app.js)
 * ---------------------------------------------------------------------
 * Used by the precise analysis mode: when the model says an item is exactly one
 * of these foods, the app uses these values instead of the model's memory.
 * Values are per 100 g of the edible part AS SERVED, before any added cooking oil
 * (the app adds oil from the cooking method; see COOK_METHODS in app.js).
 *
 * Rules for adding rows:
 *  - Only cooked / ready-to-eat forms (rice, boiled egg, blanched vegetables…).
 *  - Every row names its source; nothing is typed in from memory.
 *  - `key` is what the model must return; `aliases` help matching.
 * ===================================================================== */

const FOOD_TABLE = [
  {
    key: '白飯', aliases: ['米飯', '蓬萊米飯', '白米飯'],
    p: 3.1, c: 41.0, f: 0.3,
    src: 'TFND', srcName: '衛福部食品營養成分資料庫（白飯）'
  }
];
