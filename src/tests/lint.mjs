/**
 * ESLint over the four scripts as the browser sees them: one shared global scope, so they are linted
 * concatenated (otherwise every cross-file name would be "undefined").
 *
 * ESLint is not a dependency of the site. Install it once anywhere, then point NODE_PATH at it:
 *   npm i eslint globals            (in any folder, e.g. ../tools)
 *   NODE_PATH=../tools/node_modules node tests/lint.mjs      (Windows: set NODE_PATH=..\tools\node_modules)
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'noop.js'));
let ESLint, globals;
try { ({ ESLint } = require('eslint')); globals = require('globals'); } catch {
  console.error('ESLint not found: npm i eslint globals, then set NODE_PATH to that node_modules (see the comment at the top).');
  process.exit(2);
}

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['js/i18n.js', 'js/foods.js', 'js/app.js', 'js/photos.js'];
const parts = FILES.map(f => ({ f, text: readFileSync(path.join(SRC, f), 'utf8') }));
const bundle = parts.map(p => p.text).join('\n');

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: {
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'script',
      // Chart.js and lucide come from <script> tags in index.html.
      globals: { ...globals.browser, Chart: 'readonly' }
    },
    rules: {
      'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], eqeqeq: 'error', 'no-var': 'error',
      'prefer-const': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-self-assign': 'error',
      'no-global-assign': 'error', 'no-implicit-globals': 'off'
    }
  }
});
const [result] = await eslint.lintText(bundle, { filePath: 'bundle.js' });

// Map bundle lines back to the source file and line.
const starts = []; let line = 1;
for (const p of parts) { starts.push({ f: p.f, from: line }); line += p.text.split('\n').length; }
const where = l => { const s = starts.filter(x => x.from <= l).at(-1); return `${s.f}:${l - s.from + 1}`; };

for (const m of result.messages) console.log(`${where(m.line)}  ${m.ruleId || 'parse'}  ${m.message}`);
console.log(result.messages.length ? `${result.messages.length} problem(s)` : 'ESLint: no problems');
process.exit(result.messages.length ? 1 : 0);
