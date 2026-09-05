const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createModeration } = require('../moderation');

const owner = 'U' + '1'.repeat(32);
const admin = 'U' + '2'.repeat(32);
const member = 'U' + '3'.repeat(32);
const groupA = 'C' + 'a'.repeat(32);
const groupB = 'C' + 'b'.repeat(32);

function setup() {
  const replies = [];
  const calls = [];
  let time = 1700000000000;
  let apiFails = false;
  const bot = createModeration({
    env: { BOT_OWNER_IDS: owner, GROUP_ADMIN_IDS: JSON.stringify({ [groupA]: [admin] }) },
    now: () => time,
    reply: async (token, text) => replies.push(text),
    api: async path => {
      calls.push(path);
      if (apiFails) throw new Error('Unavailable');
      if (path.endsWith('/summary')) return { groupName: 'Test group' };
      if (path.endsWith('/count')) return { count: 3 };
      return { userId: member, displayName: 'Member' };
    }
  });
  const event = (text, userId = member, groupId = groupA, target) => ({
    type: 'message', replyToken: 'fake-reply',
    source: groupId ? { type: 'group', groupId, userId } : { type: 'user', userId },
    message: { type: 'text', text, ...(target ? { mention: { mentionees: [{ type: 'user', userId: target }] } } : {}) }
  });
  return { bot, replies, calls, event, tick: n => { time += n; }, failApi: () => { apiFails = true; } };
}

test('ordinary users cannot warn, reset, or enumerate group users', async () => {
  const f = setup();
  for (const command of ['warn', 'reset', 'members', 'status', 'seen', 'warnings']) {
    await f.bot.handle(f.event('/avi ' + command, member, groupA, admin));
    assert.match(f.replies.at(-1), /requires bot-admin permission/);
  }
  assert.equal(f.calls.length, 0);
});

test('admin permission applies only to the configured group', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi warn @Member', admin, groupA, member));
  assert.match(f.replies.at(-1), /Admin warning recorded: Member\nWarnings: 1/);
  assert.equal(f.calls[0], `/group/${groupA}/member/${member}`);
  await f.bot.handle(f.event('/avi warn @Member', admin, groupB, member));
  assert.match(f.replies.at(-1), /requires bot-admin permission/);
});

test('warning totals and flood detection are isolated between groups', async () => {
  const f = setup();
  for (let n = 0; n < 3; n++) await f.bot.handle(f.event('same text'));
  await f.bot.handle(f.event('same text', member, groupB));
  assert.equal(f.replies.length, 0);
  await f.bot.handle(f.event('same text'));
  assert.match(f.replies.at(-1), /Repeated spam/);
  await f.bot.handle(f.event('/avi warnings @Member', owner, groupB, member));
  assert.match(f.replies.at(-1), /Warnings: 0/);
});

test('owner may administer groups; admin can clear only current group warnings', async () => {
  const f = setup();
  await f.bot.handle(f.event('badword1', member, groupB));
  await f.bot.handle(f.event('badword1'));
  await f.bot.handle(f.event('/avi reset @Member', admin, groupA, member));
  assert.match(f.replies.at(-1), /Warnings: 0/);
  await f.bot.handle(f.event('/avi warnings @Member', owner, groupB, member));
  assert.match(f.replies.at(-1), /Warnings: 1/);
});

test('warn requires a real single mention and current membership confirmation', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi warn Member', admin));
  assert.match(f.replies.at(-1), /exactly one person/);
  const many = f.event('/avi warn @Member @Owner', admin, groupA, member);
  many.message.mention.mentionees.push({ type: 'user', userId: owner });
  await f.bot.handle(many);
  assert.match(f.replies.at(-1), /exactly one person/);
  f.failApi();
  await f.bot.handle(f.event('/avi warn @Member', admin, groupA, member));
  assert.match(f.replies.at(-1), /No warning record was changed/);
});

test('seen reports observed events, never inferred online status or admin actions', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi warn @Member', admin, groupA, member));
  await f.bot.handle(f.event('/avi seen @Member', admin, groupA, member));
  assert.match(f.replies.at(-1), /No recent activity/);
  await f.bot.handle(f.event('hello'));
  await f.bot.handle(f.event('/avi seen @Member', admin, groupA, member));
  assert.match(f.replies.at(-1), /Last event observed here/);
  assert.match(f.replies.at(-1), /not online or read status/);
});

test('groups list is restricted to owner in private chat', async () => {
  const f = setup();
  await f.bot.handle(f.event('hello'));
  await f.bot.handle(f.event('/avi groups', owner));
  assert.match(f.replies.at(-1), /private chat/);
  await f.bot.handle(f.event('/avi groups', admin, null));
  assert.match(f.replies.at(-1), /Only the configured bot owner/);
  await f.bot.handle(f.event('/avi groups', owner, null));
  assert.match(f.replies.at(-1), new RegExp(groupA));
  assert.match(f.replies.at(-1), /not a full list/);
});

test('join, member leave and bot leave update observed records', async () => {
  const f = setup();
  await f.bot.handle({ type: 'join', source: { type: 'group', groupId: groupA }, replyToken: 'fake' });
  assert.match(f.replies.at(-1), /check new messages/);
  await f.bot.handle({ type: 'memberJoined', source: { type: 'group', groupId: groupA }, joined: { members: [{ userId: member }] }, replyToken: 'fake' });
  await f.bot.handle(f.event('/avi members', admin));
  assert.match(f.replies.at(-1), new RegExp(member));
  await f.bot.handle({ type: 'memberLeft', source: { type: 'group', groupId: groupA }, left: { members: [{ userId: member }] } });
  await f.bot.handle(f.event('/avi members', admin));
  assert.ok(!f.replies.at(-1).includes(member));
  await f.bot.handle({ type: 'leave', source: { type: 'group', groupId: groupA } });
  await f.bot.handle(f.event('/avi groups', owner, null));
  assert.ok(!f.replies.at(-1).includes(groupA));
});

test('domain checks match hostnames rather than innocent URL paths or suffixes', async () => {
  const f = setup();
  await f.bot.handle(f.event('https://example.com/scam.com https://notscam.com'));
  assert.equal(f.replies.length, 0);
  await f.bot.handle(f.event('https://login.scam.com/test'));
  assert.match(f.replies.at(-1), /Suspicious link/);
});

test('automatic alerts are throttled while violations are counted', async () => {
  const f = setup();
  await f.bot.handle(f.event('badword1'));
  await f.bot.handle(f.event('badword1'));
  assert.equal(f.replies.length, 1);
  f.tick(10001);
  await f.bot.handle(f.event('badword1'));
  assert.match(f.replies.at(-1), /Warnings: 3/);
});

test('redelivery is deduplicated within this instance', async () => {
  const f = setup();
  const event = { ...f.event('/avi warn @Member', admin, groupA, member), webhookEventId: 'one-event' };
  await f.bot.handle(event);
  await f.bot.handle(event);
  assert.equal(f.replies.length, 1);
  assert.match(f.replies[0], /Warnings: 1/);
});

test('status uses LINE summary and count; API failures return a useful message', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi status', admin));
  assert.match(f.replies.at(-1), /Test group/);
  assert.match(f.replies.at(-1), /count.*3/);
  f.failApi();
  await f.bot.handle(f.event('/avi status', admin));
  assert.match(f.replies.at(-1), /information is unavailable/);
});

test('malformed admin configuration fails closed without exposing its value', () => {
  assert.throws(() => createModeration({ env: { GROUP_ADMIN_IDS: 'not-json' } }), /GROUP_ADMIN_IDS must be/);
  assert.throws(() => createModeration({ env: { GROUP_ADMIN_IDS: JSON.stringify({ [groupA]: admin }) } }), /GROUP_ADMIN_IDS must be/);
});

test('old activity expires after 24 hours', async () => {
  const f = setup();
  await f.bot.handle(f.event('hello'));
  f.tick(86400001);
  await f.bot.handle(f.event('/avi groups', owner, null));
  assert.match(f.replies.at(-1), /None observed/);
});

test('command spam is bounded, including unknown commands', async () => {
  const f = setup();
  for (let i = 0; i < 20; i++) await f.bot.handle(f.event('/avi nonsense'));
  assert.equal(f.replies.length, 6);
  f.tick(10000);
  await f.bot.handle(f.event('/avi help'));
  assert.equal(f.replies.length, 7);
});
