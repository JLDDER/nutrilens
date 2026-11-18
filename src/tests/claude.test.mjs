/**
 * The Claude artifact build (build.mjs --claude): the same app with Claude answering through the artifact runtime's
 * `sample`, and records kept in the viewer's private db subtree. Run from src/: node --test "tests/*.test.mjs"
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './load.mjs';

const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');

/** A Claude build with a fake `sample` that answers from `reply(prompt, opts)`, and an in-memory db. */
function claudeApp({ reply, storage = {}, cloudDocs = {} } = {}) {
  const calls = [], docs = new Map(Object.entries(cloudDocs)), writes = [];
  const sample = async (prompt, opts) => { calls.push({ prompt, opts }); return reply(prompt, opts, calls.length); };
  const docRef = path => ({
    set: async body => { writes.push({ path, body }); docs.set(path, body); },
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) })
  });
  const db = {
    collection: base => ({
      doc: id => docRef(`${base}/${id}`),
      get: async () => ({ docs: [...docs].filter(([p]) => p.startsWith(base + '/')).map(([p, b]) => ({ id: p.slice(base.length + 1), data: () => b })) })
    })
  };
  const claude = { async use(name) { if (this !== claude) throw new TypeError('Illegal invocation'); return { sample, db, user: { id: async () => 'u1' } }[name] ?? null; } };
  const app = loadApp({ storage, globals: { NUTRILENS_PROVIDER: 'claude', claude } });
  return { app, calls, docs, writes };
}

const mainAnswer = {
  reasoning: '筷子比例', name: '雞腿便當', packageKcal: 0,
  items: [{ name: '白飯', fromLabel: false, inPackage: false, published: false, foodKey: '白飯', method: 'plain', foodType: 'starch',
    fatSource: 'none', portionText: '半盒', count: 0, weightLow: 150, weight: 180, weightHigh: 210, proteinPer100g: 3, carbsPer100g: 41,
    fatPer100g: 0.3, oilSheen: 'none', separatedOil: false, soupOil: 'none', bowlDiameterCm: 0, storePackaging: false, diningSetting: 'unclear' }]
};
const weightAnswer = { estimates: [{ index: 1, geo: '18x9x1.5 ×0.85', weight: 200, method: 'plain', oilSheen: 'none', separatedOil: false, soupOil: 'none' }] };

describe('Claude build: AI calls', () => {
  test('no key is needed and the default model is the default tier', () => {
    const { app } = claudeApp({ reply: () => ({}) });
    assert.equal(app.get('IS_CLAUDE'), true);
    assert.equal(app.get('db').apiKey(), 'claude');
    assert.equal(app.get('db').model(), 'tier:default');
    assert.deepEqual(plain(app.get('claudeAI').modelOptions('claude-opus-5-5')), { model: 'claude-opus-5-5', modelTier: 'complex' });
    assert.deepEqual(plain(app.get('claudeAI').modelOptions('tier:default')), { modelTier: 'default' });
  });

  test('a Gemini schema becomes JSON Schema with fields in their order', () => {
    const { app } = claudeApp({ reply: () => ({}) });
    const js = plain(app.get('schemaToJson')(app.get('PRECISE_SCHEMA')));
    assert.equal(js.type, 'object');
    assert.deepEqual(Object.keys(js.properties), ['reasoning', 'name', 'packageKcal', 'items']);
    assert.equal(js.properties.items.items.properties.method.type, 'string');
    assert.ok(!JSON.stringify(js).includes('propertyOrdering'));
  });

  test('the JSON is found in a fenced or chatty reply', () => {
    const { app } = claudeApp({ reply: () => ({}) });
    const x = app.get('extractJsonText');
    assert.equal(x('{"a":1}'), '{"a":1}');
    assert.equal(x('Here:\n```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(x('Sure. {"a":{"b":2}} Done.'), '{"a":{"b":2}}');
  });

  test('precise analysis: one main call on the chosen model, two re-estimates on the default tier, never cached', async () => {
    const { app, calls } = claudeApp({
      storage: { nutrilens_claude_model_v1: 'claude-opus-5-5' },
      reply: (prompt, opts) => (prompt.includes('"estimates"')
        ? { text: JSON.stringify(weightAnswer), truncated: false, modelTierApplied: 'default' }
        : { text: '```json\n' + JSON.stringify(mainAnswer) + '\n```', truncated: false, modelTierApplied: 'complex', modelApplied: opts.model })
    });
    const job = { id: 'j1', images: [PHOTO], imageInfo: [], note: '', lang: 'zh', refs: [] };
    const res = await app.get('analyzeJob')(job, { apiKey: 'claude', model: app.get('db').model(), signal: new AbortController().signal,
      rec: { runs: [] }, mode: 'precise' });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].opts.model, 'claude-opus-5-5');
    assert.equal(calls[1].opts.modelTier, 'default'); assert.equal(calls[1].opts.model, undefined);
    assert.ok(calls.every(c => c.opts.cache === false && c.opts.images.length === 1));
    assert.ok(calls[0].prompt.includes('You estimate nutrition from meal photos') && calls[0].prompt.includes('JSON Schema'));
    assert.equal(res.modelUsed, 'Claude Opus 5.5');
    assert.equal(res.items[0].weight, 200);                        // median of 180, 200, 200
  });

  test('a refused permission shows a Claude message, a cancel is an AbortError', async () => {
    let code = 'not_granted';
    const { app } = claudeApp({ reply: () => { throw { code, message: 'x' }; } });
    const run = signal => app.get('gemini').generateWithFallback({ model: 'tier:default', parts: [{ text: 'hi' }], system: 's',
      signal, rec: { runs: [] }, task: app.get('PRECISE_TASK') });
    await assert.rejects(run(new AbortController().signal), e => /允許/.test(e.message));
    code = 'cancelled';
    await assert.rejects(run(new AbortController().signal), e => e.name === 'AbortError');
  });
});

describe('Claude build: cloud records', () => {
  test('meals are kept one document per month', async () => {
    const meals = [{ id: 'a', date: '2026-10-30', name: 'x' }, { id: 'b', date: '2026-11-02', name: 'y' }, { id: 'c', date: '2026-11-03', name: 'z' }];
    const { app } = claudeApp({ reply: () => ({}), storage: { nutrilens_meals_v1: JSON.stringify(meals) } });
    const docs = plain(app.get('cloud').docsFor('nutrilens_meals_v1'));
    assert.deepEqual(docs.map(d => d.id).sort(), ['nutrilens_meals_v1@2026-10', 'nutrilens_meals_v1@2026-11']);
    assert.equal(JSON.parse(docs.find(d => d.id.endsWith('11')).body.v).length, 2);
  });

  test('a newer cloud copy replaces this browser, a newer local key is sent, photos and jobs are not', async () => {
    const base = 'data/users/u1/kv';
    const { app, writes } = claudeApp({
      reply: () => ({}),
      storage: { nutrilens_goals_v1: '{"cal":1800}', nutrilens_weights_v1: '[{"date":"2026-11-01","kg":70}]', nutrilens_jobs_v1: '[1]',
        nutrilens_cloud_ts: JSON.stringify({ nutrilens_goals_v1: 100, nutrilens_weights_v1: 900, nutrilens_jobs_v1: 900 }) },
      cloudDocs: {
        [`${base}/nutrilens_goals_v1`]: { key: 'nutrilens_goals_v1', v: '{"cal":2000}', ts: 500 },
        [`${base}/nutrilens_meals_v1@2026-11`]: { key: 'nutrilens_meals_v1', v: '[{"id":"m","date":"2026-11-02"}]', ts: 500 },
        [`${base}/nutrilens_weights_v1`]: { key: 'nutrilens_weights_v1', v: '[]', ts: 200 }
      }
    });
    const cloud = app.get('cloud'), store = app.get('store');
    await cloud.start();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(store.get('nutrilens_goals_v1').cal, 2000);
    assert.equal(store.get('nutrilens_meals_v1')[0].id, 'm');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `${base}/nutrilens_weights_v1`);
    store.set('nutrilens_jobs_v1', [2]);                             // never synced
    store.set('nutrilens_favorites_v1', [{ id: 'f' }]);
    await cloud.flush.call(Object.assign(cloud, { timer: null }));
    assert.deepEqual(writes.map(w => w.path).slice(1), [`${base}/nutrilens_favorites_v1`]);
  });
});
