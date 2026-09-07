const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createReaderLink, validRequest } = require('../reader-link');
const group = 'C' + '1'.repeat(32), ownerId = 'U' + '2'.repeat(32), reader = 'U' + '3'.repeat(32);
const event = (text = '/reader link @Name') => ({ type: 'message', source: { type: 'group', groupId: group, userId: ownerId },
  message: { type: 'text', id: '123', text, mention: { mentionees: [{ type: 'user', index: 13, length: 5, userId: reader }] } } });

test('different API message IDs resolve only with exact timestamp and text hash; collisions fail closed', async () => {
  const { createHash } = require('node:crypto');
  const { createIdentityLink } = await import('../experiments/reader/avi-bridge.mjs');
  const store = createReaderLink({ env: {}, owner: () => true });
  const text = '/reader link random-pair-code', timestamp = 1700000000000;
  const original = { ...event(text), timestamp };
  await store.observe(original);
  const fingerprint = { timestamp, commandHash: createHash('sha256').update(text).digest('hex') };
  const observed = await store.resolve('999', fingerprint);
  assert.equal(observed.messageId, '123');
  const identity = createIdentityLink();
  identity.observe({ id: '999', from: 'private-owner', createdTime: timestamp, text }, observed);
  assert.equal(identity.user('private-owner'), ownerId);
  assert.equal(await store.resolve('999', { ...fingerprint, timestamp: timestamp + 1 }), null);
  assert.throws(() => identity.observe({ id: '998', from: 'another-user', createdTime: timestamp + 1, text }, observed));
  await store.observe({ ...original, message: { ...original.message, id: '456' } });
  assert.equal(await store.resolve('999', fingerprint), null);
});

test('unknown users must use the current pairing code before any identity lookup', async () => {
  const { createAviBridge } = await import('../experiments/reader/avi-bridge.mjs');
  let calls = 0;
  const bridge = createAviBridge({ token: 'test', baseUrl: 'https://example.test', request: async () => { calls++; throw new Error('unexpected'); } });
  await assert.rejects(bridge.observe({ id: '1', from: 'unknown', text: '/reader on' }), /pairing command/);
  await assert.rejects(bridge.observe({ id: '1', from: 'unknown', text: '/reader link wrong-code @Name' }), /pairing command/);
  assert.equal(calls, 0);
  const before = bridge.status.pairCommand;
  bridge.reset(); assert.notEqual(bridge.status.pairCommand, before);
});

test('reader link requests reject missing, stale, tampered and non-ASCII signatures', () => {
  const time = '1700000000000', body = Buffer.from('{"messageId":"123"}'), secret = 'test';
  const signature = createHmac('sha256', secret).update('avi-reader-link:v1\n' + time + '\n').update(body).digest('hex');
  assert.equal(validRequest(body, time, signature, secret, Number(time)), true);
  assert.equal(validRequest(body, time, signature, secret, Number(time) + 61000), false);
  assert.equal(validRequest(Buffer.from('{}'), time, signature, secret, Number(time)), false);
  assert.equal(validRequest(body, time, 'é'.repeat(64), secret, Number(time)), false);
  assert.equal(validRequest(body, time, undefined, secret, Number(time)), false);
});

test('only explicit group reader commands are indexed, without text, expire and recheck roles', async () => {
  let time = 1, allowed = true;
  const link = createReaderLink({ env: {}, now: () => time, owner: () => false, admins: { isAdmin: async () => allowed } });
  await link.observe(event('hello'));
  assert.equal(await link.resolve('123'), null);
  await link.observe({ ...event(), source: { type: 'user', userId: ownerId } });
  assert.equal(await link.resolve('123'), null);
  await link.observe(event());
  const found = await link.resolve('123');
  assert.equal(found.authorized, true);
  assert.equal(found.text, undefined);
  assert.equal(found.mentions[0].userId, reader);
  allowed = false; assert.equal((await link.resolve('123')).authorized, false);
  time += 600001; assert.equal(await link.resolve('123'), null);
});

test('identity linking needs same message, authorized initial group, exact mention span and no conflicts', async () => {
  const { createIdentityLink, officialMessage } = await import('../experiments/reader/avi-bridge.mjs');
  const ids = createIdentityLink();
  const msg = { id: '123', from: 'private-owner', text: '/reader link @Name', contentMetadata: { MENTION: JSON.stringify({ MENTIONEES: [{ S: '13', E: '18', M: 'private-reader' }] }) } };
  const observed = { messageId: '123', groupId: group, userId: ownerId, authorized: false, mentions: [{ index: 13, length: 5, userId: reader }] };
  ids.observe(msg, observed); assert.equal(ids.group, '');
  assert.throws(() => ids.observe(msg, { ...observed, messageId: '999', authorized: true }));
  ids.observe(msg, { ...observed, authorized: true });
  assert.equal(ids.user('private-reader'), reader);
  assert.throws(() => ids.observe(msg, { ...observed, userId: reader, authorized: true }));
  const { mentionMessage } = await import('../experiments/reader/reader-mode.mjs');
  const greeting = officialMessage(mentionMessage('Hey ', [{ id: 'private-reader', name: 'Name' }]), ids);
  assert.deepEqual(greeting, { type: 'textV2', text: 'Hey {reader0}', substitution: { reader0: { type: 'mention', mentionee: { type: 'user', userId: reader } } } });
  assert.throws(() => officialMessage(mentionMessage('Hey ', [{ id: 'unknown', name: 'Name' }]), ids));
  ids.reset(); ids.observe(msg, { ...observed, authorized: true, mentions: [{ index: 12, length: 5, userId: reader }] });
  assert.equal(ids.user('private-reader'), undefined);
});

test('Avi bridge routes a real read greeting through official push, never a writing event', async () => {
  const { createAviBridge } = await import('../experiments/reader/avi-bridge.mjs');
  const { createReaderMode } = await import('../experiments/reader/reader-mode.mjs');
  const calls = [];
  const bridge = createAviBridge({ token: 'dummy', baseUrl: 'https://example.test', request: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/reader/resolve')) {
      assert.equal(validRequest(Buffer.from(options.body), options.headers['x-avi-reader-time'], options.headers['x-avi-reader-signature'], 'dummy'), true);
      return Response.json({ messageId: '123', groupId: group, userId: ownerId, authorized: true,
        mentions: [{ index: bridge.status.pairCommand.length + 1, length: 5, userId: reader }] });
    }
    return Response.json({ sentMessages: [{ id: '200' }] });
  } });
  const start = bridge.status.pairCommand.length + 1;
  await bridge.observe({ id: '123', from: 'private-owner', text: bridge.status.pairCommand + ' @Name', contentMetadata: { MENTION: JSON.stringify({ MENTIONEES: [{ S: String(start), E: String(start + 5), M: 'private-reader' }] }) } });
  const mode = createReaderMode({ send: async (g, msg) => bridge.send(msg), profile: async () => 'Name', now: () => 1000,
    authorize: msg => msg.authorized === true, canMention: id => Boolean(bridge.identity.user(id)) });
  mode.configure('private-group', '', 'private-observer');
  await mode.command({ to: 'private-group', from: 'private-owner', text: '/reader on', authorized: true });
  assert.equal(calls.length, 2);
  await mode.event({ type: 26, param1: 'private-group', param2: 'private-reader', param3: '201', createdTime: 2000 });
  await mode.event({ type: 55, param1: 'private-group', param2: 'unknown', param3: '201', createdTime: 2000 });
  assert.equal(calls.length, 2);
  assert.equal(mode.status.unlinkedReaders, 1);
  const read = { type: 55, param1: 'private-group', param2: 'private-reader', param3: '201', createdTime: 2000 };
  await mode.event(read); await mode.event(read);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(calls[2].body.to, group);
  assert.equal(calls[2].body.messages[0].substitution.reader0.mentionee.userId, reader);
});
