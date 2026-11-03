/**
 * Static checks on the source (no browser): ids, buttons, i18n keys, data-action handlers, #id references and
 * line length. Run from src/: node --test "tests/*.test.mjs"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApp } from './load.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(path.join(SRC, f), 'utf8');
const html = read('index.html');
const JS_FILES = ['js/app.js', 'js/photos.js', 'js/i18n.js', 'js/foods.js'];
const js = Object.fromEntries(JS_FILES.map(f => [f, read(f)]));
const allJs = Object.values(js).join('\n');
/** The scripts without comments, so examples written in comments (data-action="name") are not taken as uses. */
const code = allJs.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const app = loadApp();
const MAX_LINE = 160;

const matches = (text, re) => [...text.matchAll(re)].map(m => m[1]);
/** Literal values only: anything built with ${…} is checked where it is used, not here. */
const literal = v => !v.includes('${');

test('element ids in index.html are unique', () => {
  const ids = matches(html, /\sid="([^"]+)"/g).filter(literal);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(dupes)], []);
});

test('every <button> declares a type', () => {
  const missing = [html, allJs].flatMap(t => [...t.matchAll(/<button\b[^>]*>/g)].map(m => m[0]).filter(tag => !/\stype=/.test(tag)));
  assert.deepEqual(missing, []);
});

test('zh and en have the same keys', () => {
  const I18N = app.get('I18N');
  const zh = Object.keys(I18N.zh), en = Object.keys(I18N.en);
  assert.deepEqual(zh.filter(k => !en.includes(k)), [], 'missing in en');
  assert.deepEqual(en.filter(k => !zh.includes(k)), [], 'missing in zh');
});

test('every literal translation key used is defined', () => {
  const I18N = app.get('I18N');
  const used = new Set([
    ...matches(code, /\bt\('(\w+)'\s*[,)]/g),
    ...matches(html + code, /data-i18n(?:-placeholder|-title|-aria)?="([\w]+)"/g)
  ]);
  assert.deepEqual([...used].filter(k => !(k in I18N.zh)), []);
});

test('every literal data-action has a handler', () => {
  const ACTIONS = app.get('ACTIONS');
  const used = new Set(matches(html + code, /data-action="([^"]+)"/g).filter(literal));
  assert.deepEqual([...used].filter(a => typeof ACTIONS[a] !== 'function'), []);
});

test('every literal #id the scripts look up exists', () => {
  // Ids written as id="…" or passed as a plain string to a template helper (numField('obAge', …)).
  const defined = new Set([...matches(html + code, /\sid="([^"]+)"/g).filter(literal), ...matches(code, /'([\w-]+)'/g)]);
  const looked = new Set([
    ...matches(allJs, /\$\('#([\w-]+)'\)/g),
    ...matches(allJs, /getElementById\('([\w-]+)'\)/g)
  ]);
  assert.deepEqual([...looked].filter(id => !defined.has(id)), []);
});

test(`lines are at most ${MAX_LINE} characters (prompt text and schema descriptions excepted)`, () => {
  const long = [];
  for (const [file, text] of Object.entries(js)) {
    if (file === 'js/foods.js' || file === 'js/i18n.js') continue;    // generated table; one UI string per line
    let inTemplate = false;
    text.split('\n').forEach((line, i) => {
      const startsInside = inTemplate;
      inTemplate = ((line.replace(/\\`/g, '').match(/`/g) || []).length % 2 === 1) !== inTemplate;
      const prompt = startsInside || inTemplate || /description:|^\s*\/\*\s*──|`/.test(line);
      if ([...line].length > MAX_LINE && !prompt) long.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(long, []);
});
