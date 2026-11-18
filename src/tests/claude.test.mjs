/**
 * The Claude artifact build (build.mjs --claude): the same app with Claude answering through the artifact runtime's
 * `sample`, and records kept in the viewer's private db subtree. Run from src/: node --test "tests/*.test.mjs"
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './load.mjs';

const segs = p => p.split('/').length;
const mustBe = (p, odd, what) => { if (segs(p) % 2 !== (odd ? 1 : 0)) throw new TypeError(`db ${what}: bad segment count in ${p}`); };

const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');

/** A Claude build with a fake `sample` that answers from `reply(prompt, opts)`, and an in-memory db. */
function claudeApp({ reply, storage = {}, cloudDocs = {} } = {}) {
  const calls = [], docs = new Map(Object.entries(cloudDocs)), writes = [];
  const sample = async (prompt, opts) => { calls.push({ prompt, opts }); return reply(prompt, opts, calls.length); };
  const docRef = path => (mustBe(path, false, 'doc()'), {
    set: async body => { writes.push({ path, body }); docs.set(path, body); },
    delete: async () => { writes.push({ path, deleted: true }); docs.delete(path); },
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) })
  });
  const db = {
    doc: path => ({ ...docRef(path), collection: sub => db.collection(`${path}/${sub}`) }),
    collection: base => (mustBe(base, true, 'collection()'), {
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
  const U = 'data/users/u1';
  /** One shared cloud for several "devices" (each its own app with its own browser storage). */
  function sharedCloud(initial = {}) {
    const docs = new Map(Object.entries(initial));
    const ref = path => ({
      set: async body => { docs.set(path, JSON.parse(JSON.stringify(body))); },
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      delete: async () => { docs.delete(path); }
    });
    const db = {
      doc: path => ({ ...ref(path), collection: sub => db.collection(`${path}/${sub}`) }),
      collection: base => (mustBe(base, true, 'collection()'), {
        doc: id => ref(`${base}/${id}`),
        get: async () => ({ docs: [...docs].filter(([p]) => p.startsWith(base + '/') && !p.slice(base.length + 1).includes('/'))
          .map(([p, b]) => ({ id: p.slice(base.length + 1), data: () => b })) })
      })
    };
    let online = true;
    const claude = { async use(n) { if (this !== claude) throw new TypeError('Illegal invocation'); return online ? { db, user: { id: async () => 'u1' } }[n] ?? null : null; } };
    return { docs, claude, setOnline: v => { online = v; } };
  }
  const device = (cloudEnv, storage = {}) => loadApp({ storage, globals: { NUTRILENS_PROVIDER: 'claude', claude: cloudEnv.claude } });
  const settle = () => new Promise(r => setTimeout(r, 30));
  const meal = (id, date, name = id) => ({ id, date, time: '12:00', name, cal: 100, p: 1, c: 1, f: 1, items: [] });
  const meals = app => plain(app.get('store').get('nutrilens_meals_v1', [])).map(m => m.id).sort();
  const sync = async app => { await app.get('cloud').flush(); await settle(); };

  test('meals are kept in month documents split by id, with a change time per meal', async () => {
    const env = sharedCloud(), a = device(env);
    await a.get('cloud').connect();
    a.get('db').saveMeals([meal('x', '2026-10-30'), meal('y', '2026-11-02'), meal('z', '2026-11-20')]);
    await sync(a);
    const docOf = (date, id) => `${U}/${a.get('cloud').mealDoc(date, id)}`;
    assert.match(docOf('2026-11-02', 'y'), /nutrilens_meals_v1@2026-11\.[0-7]$/);
    const d = env.docs.get(docOf('2026-11-02', 'y'));
    assert.equal(d.fmt, 2); assert.ok(d.items.y && d.mt.y > 0);
    assert.ok(env.docs.get(docOf('2026-10-30', 'x')).items.x);
  });

  test('two devices open at once: neither erases the other\'s new meal', async () => {
    const env = sharedCloud(), a = device(env), b = device(env);
    await a.get('cloud').connect(); await b.get('cloud').connect();
    a.get('db').addMeal(meal('fromA', '2026-11-18')); await sync(a);
    b.get('db').addMeal(meal('fromB', '2026-11-18')); await sync(b);
    await a.get('cloud').refresh(); await settle();
    assert.deepEqual(meals(a), ['fromA', 'fromB']);
    const inCloud = [...env.docs].filter(([k]) => k.includes('meals_v1@2026-11')).flatMap(([, d]) => Object.keys(d.items));
    assert.deepEqual(inCloud.sort(), ['fromA', 'fromB']);
  });

  test('a meal deleted on one device does not come back from another that still has it', async () => {
    const env = sharedCloud(), a = device(env);
    await a.get('cloud').connect();
    a.get('db').saveMeals([meal('m1', '2026-11-03'), meal('m2', '2026-11-03')]); await sync(a);
    const b1 = device(env); await b1.get('cloud').connect(); await settle();
    assert.deepEqual(meals(b1), ['m1', 'm2']);
    const bStorage = b1.localStorage.dump();                      // device B keeps its browser storage
    a.get('db').deleteMeal('m1'); await sync(a);
    const b2 = device(env, bStorage); await b2.get('cloud').connect(); await sync(b2);
    assert.deepEqual(meals(b2), ['m2']);
    const a2 = device(env); await a2.get('cloud').connect();
    assert.deepEqual(meals(a2), ['m2']);
  });

  test('"delete all" on one device is not undone by another device', async () => {
    const env = sharedCloud(), a = device(env);
    await a.get('cloud').connect();
    a.get('db').saveMeals([meal('m1', '2026-11-03'), meal('m2', '2026-11-04')]); await sync(a);
    const b1 = device(env); await b1.get('cloud').connect(); await settle();
    const bStorage = b1.localStorage.dump();
    a.get('db').saveMeals([]); await sync(a);
    const b2 = device(env, bStorage); await b2.get('cloud').connect(); await sync(b2);
    assert.deepEqual(meals(b2), []);
  });

  test('offline: changes are kept and sent once the cloud is reached; nothing the app seeds at start counts', async () => {
    const env = sharedCloud(), a = device(env);
    await a.get('cloud').connect();
    a.get('store').set('nutrilens_goals_v1', { cal: 1777 }); a.get('db').saveMeals([meal('old', '2026-11-01')]); await sync(a);
    env.setOnline(false);
    const b = device(env);
    assert.equal(await b.get('cloud').connect(), false);
    b.get('cloud').quiet = true; b.get('store').set('nutrilens_goals_v1', { cal: 2058 }); b.get('cloud').quiet = false;   // a start-up default
    b.get('db').addMeal(meal('offline', '2026-11-18'));
    env.setOnline(true);
    await b.get('cloud').connect(); await sync(b);
    assert.deepEqual(meals(b), ['offline', 'old']);
    assert.equal(b.get('store').get('nutrilens_goals_v1').cal, 1777);   // the default did not replace the real goals
    const c = device(env); await c.get('cloud').connect();
    assert.deepEqual(meals(c), ['offline', 'old']);
  });

  test('documents of the first cloud version are read, rewritten and removed', async () => {
    const env = sharedCloud({
      [`${U}/nutrilens_meals_v1@2026-11`]: { key: 'nutrilens_meals_v1', v: JSON.stringify([meal('m', '2026-11-02')]), ts: 5 },
      [`${U}/nutrilens_goals_v1`]: { key: 'nutrilens_goals_v1', v: '{"cal":2000}', ts: 5 }
    });
    const a = device(env); await a.get('cloud').connect(); await settle();
    assert.deepEqual(meals(a), ['m']);
    assert.equal(a.get('store').get('nutrilens_goals_v1').cal, 2000);
    assert.ok(!env.docs.has(`${U}/nutrilens_meals_v1@2026-11`));
    assert.ok(env.docs.get(`${U}/${a.get('cloud').mealDoc('2026-11-02', 'm')}`).items.m);
  });

  test('the photo list is merged id by id and a removal sticks; the jobs queue never leaves the device', async () => {
    const T = Date.now() - 60_000;
    const env = sharedCloud({ [`${U}/nutrilens_photo_cloud_v1`]: { key: 'nutrilens_photo_cloud_v1', v: JSON.stringify({ ja: T, jc: T }), ts: T } });
    const a = device(env, { nutrilens_photo_cloud_v1: JSON.stringify({ jb: T + 10, jc: -(T + 20) }) });
    await a.get('cloud').connect(); await sync(a);
    assert.deepEqual(JSON.parse(env.docs.get(`${U}/nutrilens_photo_cloud_v1`).v), { ja: T, jb: T + 10, jc: -(T + 20) });
    const merge = a.get('mergeStampMap');
    assert.equal(merge('["x"]', JSON.stringify({ x: -T })), JSON.stringify({ x: -T }));   // the first form (a list) still reads
    a.get('store').set('nutrilens_jobs_v1', [1]); await sync(a);
    assert.ok(![...env.docs.keys()].some(k => k.includes('jobs')));
  });

  test('a setting such as the model is written within a moment and read back by a fresh browser', async () => {
    const env = sharedCloud(), a = device(env);
    await a.get('cloud').connect();
    a.get('store').setStr('nutrilens_claude_model_v1', 'claude-opus-5-5');
    await new Promise(r => setTimeout(r, 450));
    assert.equal(env.docs.get(`${U}/nutrilens_claude_model_v1`)?.v, 'claude-opus-5-5');
    const fresh = device(env); await fresh.get('cloud').connect();
    assert.equal(fresh.get('db').model(), 'claude-opus-5-5');
  });
});
