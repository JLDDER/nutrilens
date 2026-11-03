/**
 * Loads the app's scripts into a Node `vm` context, the way the browser loads them (one shared global scope),
 * with just enough of the browser stubbed for the pure parts to run: localStorage in memory, an inert
 * document/window (the boot code only registers listeners) and a replaceable fetch.
 *
 * Usage: const app = loadApp(); app.get('mealTargets')(…)
 * Objects created inside the vm belong to another realm, so compare them with `plain()` (a JSON round trip)
 * rather than assert.deepStrictEqual on the raw values.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const JS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');
const FILES = ['i18n.js', 'foods.js', 'app.js', 'photos.js'];

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: k => { data.delete(k); },
    clear: () => data.clear(),
    key: i => [...data.keys()][i] ?? null,
    get length() { return data.size; },
    dump: () => Object.fromEntries(data)
  };
}

const inert = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => '' : inert()), apply: () => inert() });

export function loadApp({ storage = {}, fetch } = {}) {
  const localStorage = memoryStorage(storage);
  const listeners = () => ({ addEventListener() {}, removeEventListener() {} });
  const document = {
    ...listeners(),
    documentElement: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, lang: 'zh-Hant' },
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    createElement: () => inert(), hidden: false, title: ''
  };
  const sandbox = {
    console, localStorage, document, window: listeners(), navigator: { userAgent: 'node' },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    AbortController, DOMException, URL, Blob, TextEncoder, TextDecoder, structuredClone, crypto: globalThis.crypto,
    fetch: (...args) => (sandbox.fetchImpl || fetch || globalThis.fetch)(...args),
    fetchImpl: null
  };
  const ctx = vm.createContext(sandbox);
  const source = FILES.map(f => readFileSync(path.join(JS_DIR, f), 'utf8')).join('\n;\n');
  vm.runInContext(source, ctx, { filename: 'nutrilens-bundle.js' });
  return {
    ctx, localStorage,
    /** Any top-level binding (const, let, function) of the scripts, by name. */
    get: name => vm.runInContext(name, ctx),
    run: code => vm.runInContext(code, ctx),
    /** Replace fetch for the next calls (e.g. a fake Gemini). */
    setFetch: f => { sandbox.fetchImpl = f; }
  };
}

/** A realm-free copy for deep comparisons. */
export const plain = v => JSON.parse(JSON.stringify(v));
