const { test } = require('node:test');
const assert = require('node:assert/strict');

test('reader probe accepts both read operation formats and rejects unrelated or stale data', async () => {
  const { inspectRead } = await import('../experiments/reader/event-check.mjs');
  const read = { type: 'NOTIFIED_READ_MESSAGE', param1: 'test-group', param2: 'reader', param3: 'message', createdTime: 2000n };
  assert.deepEqual(inspectRead(read, 'test-group', 1000), { result: 'reader', userId: 'reader' });
  assert.equal(inspectRead({ ...read, type: 55 }, 'test-group', 1000).result, 'reader');
  assert.equal(inspectRead(read, '', 1000).result, 'inactive');
  assert.equal(inspectRead(read, 'another-group', 1000).result, 'other-group');
  assert.equal(inspectRead(read, 'test-group', 3000).result, 'old-event');
  assert.equal(inspectRead({ ...read, type: 'RECEIVE_MESSAGE' }, 'test-group', 1000).result, 'other-event');
  assert.equal(inspectRead({ ...read, param2: undefined }, 'test-group', 1000).result, 'missing-fields');
  assert.equal(inspectRead({ ...read, createdTime: undefined }, 'test-group', 1000).result, 'missing-time');
});
