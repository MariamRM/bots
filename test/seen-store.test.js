const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSeenStore } = require('../seen-store');
const { greetingCard } = require('../cards');

function sharedDatabase() {
  const records = new Map();
  let version = 0;
  return {
    async get(key) {
      const entry = records.get(JSON.stringify(key));
      return { key, value: entry?.value || null, versionstamp: entry?.versionstamp || null };
    },
    atomic() {
      let expected, key, value;
      return {
        check(entry) { expected = entry; return this; },
        set(k, v) { key = k; value = v; return this; },
        async commit() {
          const id = JSON.stringify(key);
          if ((records.get(id)?.versionstamp || null) !== expected.versionstamp) return { ok: false };
          records.set(id, { value, versionstamp: String(++version) });
          return { ok: true };
        }
      };
    }
  };
}

test('separate instances share active session and atomic greeting claims', async () => {
  const kv = sharedDatabase();
  const options = { env: { DENO_DEPLOY: 'true', SEEN_STORAGE: 'deno-kv' }, deno: { openKv: async () => kv } };
  const a = createSeenStore(options);
  const b = createSeenStore(options);
  assert.deepEqual((await Promise.all([a.start('g'), b.start('g')])).sort(), [false, true]);
  const session = await a.get('g');
  assert.deepEqual((await Promise.all([a.claim('g', session.id, 'u'), b.claim('g', session.id, 'u')])).sort(), [false, true]);
  const restarted = createSeenStore(options);
  assert.equal(await restarted.start('g'), false);
  assert.equal(await restarted.claim('g', session.id, 'u'), false);
  await b.stop('g');
  assert.equal(await a.claim('g', session.id, 'other'), false);
  assert.equal(await restarted.start('g'), true);
  const fresh = await restarted.get('g');
  assert.notEqual(fresh.id, session.id);
  assert.equal(await a.claim('g', session.id, 'other'), false);
  assert.equal(await a.claim('g', fresh.id, 'u'), true);
});

test('mini admins persist across instances with atomic grants and independent Seen state', async () => {
  const kv = sharedDatabase();
  const options = { env: { DENO_DEPLOY: 'true', SEEN_STORAGE: 'deno-kv' }, deno: { openKv: async () => kv } };
  const a = createSeenStore(options), b = createSeenStore(options);
  await Promise.all([a.grantAdmin('g', 'one'), b.grantAdmin('g', 'two')]);
  const restarted = createSeenStore(options);
  assert.deepEqual((await restarted.adminIds('g')).sort(), ['one', 'two']);
  assert.equal(await restarted.isAdmin('other', 'one'), false);
  await a.start('g');
  await a.stop('g');
  assert.equal(await b.isAdmin('g', 'one'), true);
  await b.revokeAdmin('g', 'one');
  assert.equal(await restarted.isAdmin('g', 'one'), false);
});

test('production refuses a temporary memory fallback', async () => {
  const store = createSeenStore({ env: { DENO_DEPLOY: 'true' } });
  await assert.rejects(store.start('g'), /SEEN_STORAGE=deno-kv/);
});

test('violet greeting has increasing opacity and wraps long names', () => {
  const card = greetingCard('Mariam');
  assert.equal(card.altText, 'Hey Mariam.');
  const gradient = card.contents.body.background;
  assert.equal(gradient.type, 'linearGradient');
  assert.equal(gradient.startColor, '#C4B5FD88');
  assert.equal(gradient.endColor, '#6D28D9EE');
  assert.equal(card.contents.body.contents.length, 1);
  assert.equal(card.contents.body.contents[0].wrap, true);
  assert.ok(greetingCard('x'.repeat(1000)).altText.length < 100);
});
