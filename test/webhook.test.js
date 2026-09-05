const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');

process.env.DENO_DEPLOY = 'true';
process.env.CHANNEL_SECRET = 'local-test-secret';
process.env.CHANNEL_ACCESS_TOKEN = 'local-test-token';
process.env.BOT_OWNER_IDS = '';
process.env.GROUP_ADMIN_IDS = '{}';
const { app } = require('../index');
const httpFetch = global.fetch;
let server;
let base;
let reply;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.line.me/v2/bot/message/reply');
    assert.equal(options.headers.Authorization, 'Bearer local-test-token');
    return reply(JSON.parse(options.body));
  };
});

after(async () => {
  global.fetch = httpFetch;
  await new Promise(resolve => server.close(resolve));
});

function post(body, signature, contentType = 'application/json') {
  const headers = { 'Content-Type': contentType };
  if (signature !== null) {
    headers['x-line-signature'] = signature ?? crypto.createHmac('sha256', process.env.CHANNEL_SECRET).update(body).digest('base64');
  }
  return httpFetch(`${base}/webhook`, {
    method: 'POST', headers, body, signal: AbortSignal.timeout(3000)
  });
}

test('home page confirms the server is running', async () => {
  const response = await httpFetch(base);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Avi Protection Bot is running/);
});

test('accepts signed empty verification events', async () => {
  assert.equal((await post('{"events":[]}')).status, 200);
});

test('rejects missing, invalid and tampered signatures', async () => {
  for (const signature of [null, 'invalid', 'A'.repeat(44)]) {
    assert.equal((await post('{"events":[]}', signature)).status, 401);
  }
  const signature = crypto.createHmac('sha256', process.env.CHANNEL_SECRET).update('{"events":[]}').digest('base64');
  assert.equal((await post('{ "events":[]}', signature)).status, 401);
});

test('signed malformed JSON and invalid event envelopes return 400', async () => {
  for (const body of ['{', 'null', '{}', '{"events":{}}']) {
    assert.equal((await post(body)).status, 400);
  }
});

test('unsupported content type returns 415', async () => {
  assert.equal((await post('{"events":[]}', undefined, 'text/plain')).status, 415);
});

test('ignores non-text and malformed events without sending replies', async () => {
  reply = () => assert.fail('Unexpected LINE reply');
  const body = { events: [null, { type: 'follow' }, { type: 'message', message: { type: 'image' } }] };
  assert.equal((await post(JSON.stringify(body))).status, 200);
});

test('finishes a LINE alert before acknowledging the webhook', async () => {
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  reply = async payload => {
    assert.equal(payload.replyToken, 'test-reply');
    assert.match(payload.messages[0].text, /Blocked word/);
    assert.match(payload.messages[0].text, /Warnings: 1/);
    started();
    await new Promise(resolve => { release = resolve; });
    return { ok: true };
  };
  const body = JSON.stringify({ events: [{
    type: 'message', replyToken: 'test-reply',
    source: { type: 'user', userId: 'test-user' },
    message: { type: 'text', text: 'badword1' }
  }] });
  let acknowledged = false;
  const pending = post(body).then(response => { acknowledged = true; return response; });
  try {
    await entered;
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(acknowledged, false);
  } finally {
    release();
  }
  assert.equal((await pending).status, 200);
});
