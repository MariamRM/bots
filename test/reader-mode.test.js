const { test } = require('node:test');
const assert = require('node:assert/strict');
async function setup() {
  const { createReaderMode } = await import('../experiments/reader/reader-mode.mjs');
  const sent = [];
  const mode = createReaderMode({ now: () => 1000, profile: async () => 'Mariam', send: async (to, msg) => { sent.push({ to, ...msg }); return { id: '100' }; } });
  mode.configure('g', 'owner', 'bot');
  const command = (text, from = 'owner', to = 'g') => mode.command({ text, from, to });
  const read = (user = 'reader', message = '100') => mode.event({ type: 'NOTIFIED_READ_MESSAGE', param1: 'g', param2: user, param3: message, createdTime: 2000 });
  return { mode, sent, command, read };
}

test('Avi chat commands require admin authorization and control the same reader session', async () => {
  const f = await setup();
  await f.command('/avi seen on', 'stranger'); assert.equal(f.sent.length, 0);
  await f.command('/avi seen on'); assert.equal(f.mode.status.active, true);
  await f.read();
  await f.command('/avi seen list'); assert.match(f.sent.at(-1).text, /Readers: 1/);
  await f.command('/avi seen status'); assert.match(f.sent.at(-1).text, /Reader mode: ON/);
  await f.command('/avi seen off'); assert.equal(f.mode.status.active, false);
  const count = f.sent.length;
  await f.read('another'); assert.equal(f.sent.length, count);
});

test('read anchor uses the private command ID rather than the unrelated Official Account ID', async () => {
  const { createReaderMode } = await import('../experiments/reader/reader-mode.mjs');
  const sent = [];
  const mode = createReaderMode({ now: () => 1000, profile: async () => 'Name', send: async (g, message) => {
    sent.push(message); return { id: '900000000000000000' };
  } });
  mode.configure('g', 'owner', 'observer');
  await mode.command({ id: '100', to: 'g', from: 'owner', text: '/reader on' });
  assert.equal(sent.length, 1);
  await mode.event({ type: 55, param1: 'g', param2: 'owner', param3: '99', createdTime: 2000 });
  assert.equal(sent.length, 1);
  await mode.event({ type: 55, param1: 'g', param2: 'owner', param3: '101', createdTime: 2000 });
  assert.equal(sent.length, 2);
});

test('only actual read of anchor or newer triggers one mention per session', async () => {
  const f = await setup();
  await f.command('/reader on');
  assert.equal(f.sent[0].text, '🟢 Seen Mode enabled');
  await f.mode.event({ type: 'RECEIVE_MESSAGE', param1: 'g', param2: 'reader', param3: '100', createdTime: 2000 });
  await f.read('reader', '99');
  await f.read('bot');
  assert.equal(f.sent.length, 1);
  await f.read(); await f.read();
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].text, 'Hey @Mariam');
  assert.equal(JSON.parse(f.sent[1].contentMetadata.MENTION).MENTIONEES[0].M, 'reader');
  assert.equal(f.mode.status.confirmed, true);
  await f.command('/reader list');
  assert.match(f.sent.at(-1).text, /Readers: 1/);
});

test('unauthorized users and other groups cannot activate; off stops and on resets', async () => {
  const f = await setup();
  await f.command('/reader on', 'stranger');
  await f.command('/reader on', 'owner', 'other');
  await f.read(); assert.equal(f.sent.length, 0);
  await f.command('/reader on'); await f.read();
  await f.command('/reader on'); assert.match(f.sent.at(-1).text, /already active/);
  await f.command('/reader off');
  const count = f.sent.length;
  await f.read('second'); assert.equal(f.sent.length, count);
  await f.command('/reader on'); await f.read();
  assert.equal(f.sent.at(-1).text, 'Hey @Mariam');
});

test('stopping during profile lookup cancels pending greeting', async () => {
  const { createReaderMode } = await import('../experiments/reader/reader-mode.mjs');
  let resolve;
  const sent = [];
  const mode = createReaderMode({ now: () => 1000, profile: () => new Promise(r => { resolve = r; }), send: async (g, msg) => { sent.push(msg); return { id: '100' }; } });
  mode.configure('g', 'owner', 'bot');
  await mode.command({ to: 'g', from: 'owner', text: '/reader on' });
  const pending = mode.event({ type: 55, param1: 'g', param2: 'reader', param3: '100', createdTime: 2000 });
  mode.configure('', '', ''); resolve('Name'); await pending;
  assert.equal(sent.length, 1);
});
