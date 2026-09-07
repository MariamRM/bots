const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createModeration } = require('../moderation');

const owner = 'U' + '1'.repeat(32);
const admin = 'U' + '2'.repeat(32);
const member = 'U' + '3'.repeat(32);
const groupA = 'C' + 'a'.repeat(32);
const groupB = 'C' + 'b'.repeat(32);

test('only main owner delegates group-scoped roles and revocation takes effect', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi claim', owner, groupB));
  assert.match(f.replies.at(-1), /main owner in all groups/);
  await f.bot.handle(f.event('/avi admin add @Member', owner, groupA, member));
  assert.match(f.replies.at(-1), /Mini admin appointed/);
  await f.bot.handle(f.event('/avi admin', member));
  assert.equal(f.replies.at(-1).type, 'flex');
  for (const action of ['add', 'remove']) {
    await f.bot.handle(f.event('/avi admin ' + action + ' @Admin', member, groupA, admin));
    assert.match(f.replies.at(-1), /Only the main owner/);
  }
  await f.bot.handle(f.event('/avi admin', member, groupB));
  assert.match(f.replies.at(-1), /requires bot-admin/);
  await f.bot.handle(f.event('/avi admin remove @Member', owner, groupA, member));
  assert.match(f.replies.at(-1), /access removed/);
  await f.bot.handle(f.event('/avi admin', member));
  assert.match(f.replies.at(-1), /requires bot-admin/);
});

test('grants require real mentions and membership; owner cannot be demoted', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi admin add Member', owner));
  assert.match(f.replies.at(-1), /exactly one person/);
  await f.bot.handle(f.event('/avi admin remove @Owner', owner, groupA, owner));
  assert.match(f.replies.at(-1), /cannot be changed/);
  f.failApi();
  await f.bot.handle(f.event('/avi admin add @Member', owner, groupA, member));
  assert.match(f.replies.at(-1), /No admin permission was changed/);
  await f.bot.handle(f.event('/avi admin', member));
  assert.match(f.replies.at(-1), /requires bot-admin/);
});

test('unavailable role storage never grants access', async () => {
  const f = setup({ adminStore: {
    async isAdmin() { throw new Error('offline'); },
    async grantAdmin() { throw new Error('offline'); }
  } });
  await f.bot.handle(f.event('/avi admin add @Member', owner, groupA, member));
  assert.match(f.replies.at(-1), /No role change was confirmed/);
  await f.bot.handle(f.event('/avi admin', member));
  assert.match(f.replies.at(-1), /requires bot-admin/);
});

function setup(options = {}) {
  const replies = [];
  const calls = [];
  let time = 1700000000000;
  let apiFails = false;
  const roles = new Map([[groupA, new Set([admin])]]);
  const bot = createModeration({
    isMainOwner: id => id === owner,
    adminStore: {
      async isAdmin(g, u) { return roles.get(g)?.has(u) || false; },
      async adminIds(g) { return [...(roles.get(g) || [])]; },
      async grantAdmin(g, u) { if (!roles.has(g)) roles.set(g, new Set()); const ids = roles.get(g); const added = !ids.has(u); ids.add(u); return added; },
      async revokeAdmin(g, u) { return roles.get(g)?.delete(u) || false; }
    },
    ...options,
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

test('legacy owner environment cannot grant ownership', async () => {
  const f = setup({ isMainOwner: () => false });
  await f.bot.handle(f.event('/avi claim', owner));
  assert.match(f.replies.at(-1), /Only Avi/);
  await f.bot.handle(f.event('/avi admin add @Member', owner, groupA, member));
  assert.match(f.replies.at(-1), /Only the main owner/);
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

test('dot greets admins but is completely silent for ordinary users, even during Seen Mode', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi seen on', admin));
  f.replies.length = 0;
  for (let i = 0; i < 10; i++) await f.bot.handle(f.event('.'));
  assert.equal(f.replies.length, 0);
  await f.bot.handle(f.event('.', admin));
  assert.equal(f.replies[0].type, 'flex');
  assert.equal(f.replies[0].altText, 'Hey Member. Avi is active.');
  await f.bot.handle(f.event('.', admin, groupB));
  assert.equal(f.replies.length, 1);
  await f.bot.handle(f.event('.', owner, null));
  assert.equal(f.replies.length, 2);
});

test('only authorized group admins can change Seen Mode or open the admin menu', async () => {
  const f = setup();
  for (const command of ['seen on', 'seen off', 'admin', 'protection']) {
    await f.bot.handle(f.event('/avi ' + command));
    assert.match(f.replies.at(-1), /requires bot-admin permission/);
  }
  await f.bot.handle(f.event('/avi seen on', admin, groupB));
  assert.match(f.replies.at(-1), /requires bot-admin permission/);
  await f.bot.handle(f.event('/avi seen on', owner, null));
  assert.match(f.replies.at(-1), /inside the regular LINE group/);
});

test('Official Account delegates reader controls without false confirmations or writer greetings', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi seen on', admin));
  await f.bot.handle(f.event('/avi seen off', admin));
  await f.bot.handle(f.event('/avi seen list', admin));
  await f.bot.handle(f.event('/avi seen status', admin));
  assert.equal(f.replies.length, 0);
  const count = f.replies.length;
  await f.bot.handle(f.event('hello', member));
  await f.bot.handle(f.event('hello', owner));
  await f.bot.handle(f.event('hello', admin));
  assert.equal(f.replies.length, count);
});

test('old active greeting sessions cannot greet writers after migration', async () => {
  const { createSeenStore } = require('../seen-store');
  const store = createSeenStore({ env: {} });
  await store.start(groupA);
  const f = setup({ seenStore: store });
  await f.bot.handle(f.event('ordinary message'));
  assert.equal(f.replies.length, 0);
  await f.bot.handle(f.event('badword1'));
  assert.equal(typeof f.replies.at(-1), 'string');
  assert.match(f.replies.at(-1), /Blocked word/);
});

test('admin greeting still works and reader menu explains companion commands', async () => {
  const f = setup();
  await f.bot.handle(f.event('.', owner));
  assert.equal(f.replies.at(-1).type, 'flex');
  await f.bot.handle(f.event('/avi seen', admin));
  assert.equal(f.replies.at(-1).altText, 'Reader connection required');
  const actions = f.replies.at(-1).contents.body.contents.filter(x => x.type === 'button').map(x => x.action.text);
  assert.deepEqual(actions, ['/avi seen on', '/avi seen off', '/avi seen list']);
});
