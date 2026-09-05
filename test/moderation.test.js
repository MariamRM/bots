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

test('Seen ON cannot restart an active session, OFF followed by ON starts a fresh list', async () => {
  const f = setup();
  await f.bot.handle(f.event('hello'));
  assert.equal(f.replies.length, 0);
  await f.bot.handle(f.event('/avi seen on', admin));
  assert.match(f.replies.at(-1), /Seen Mode enabled/);
  await f.bot.handle(f.event('first greeting'));
  assert.equal(f.replies.at(-1).altText, 'Hey Member.');
  await f.bot.handle(f.event('/avi seen on', admin));
  assert.match(f.replies.at(-1), /already active/);
  const count = f.replies.length;
  await f.bot.handle(f.event('second text'));
  assert.equal(f.replies.length, count);
  await f.bot.handle(f.event('/avi seen off', admin));
  assert.match(f.replies.at(-1), /Seen Mode disabled/);
  await f.bot.handle(f.event('third text'));
  assert.equal(f.replies.length, count + 1);
  await f.bot.handle(f.event('/avi seen on', admin));
  f.tick(10001);
  await f.bot.handle(f.event('new session greeting'));
  assert.equal(f.replies.at(-1).altText, 'Hey Member.');
});

test('Seen confirmation is short and the opener is greeted on their next message once', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi seen on', owner));
  assert.equal(f.replies.at(-1), '🟢 Seen Mode enabled');
  await f.bot.handle(f.event('hello', owner));
  assert.equal(f.replies.at(-1).type, 'flex');
  const count = f.replies.length;
  await f.bot.handle(f.event('hello again', owner));
  assert.equal(f.replies.length, count);
});

test('each user is greeted once per group; messages in another group stay silent', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi seen on', admin));
  await f.bot.handle(f.event('one', member, groupB));
  assert.equal(f.replies.length, 1);
  await f.bot.handle(f.event('two'));
  await f.bot.handle(f.event('three', owner));
  await f.bot.handle(f.event('four'));
  assert.equal(f.replies.filter(message => message.type === 'flex').length, 2);
});

test('simultaneous messages from the same user produce only one greeting', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi seen on', admin));
  await Promise.all([f.bot.handle(f.event('one')), f.bot.handle(f.event('two'))]);
  assert.equal(f.replies.filter(message => message.type === 'flex').length, 1);
});

test('Seen Mode does not suppress moderation and combines messages into one reply', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi seen on', admin));
  await f.bot.handle(f.event('badword1'));
  assert.equal(f.replies.length, 2);
  assert.equal(f.replies[1].length, 2);
  assert.match(f.replies[1][0].text, /Blocked word/);
  assert.equal(f.replies[1][1].type, 'flex');
});

test('unavailable Seen storage fails closed but normal protection still works', async () => {
  const fail = async () => { throw new Error('offline'); };
  const f = setup({ seenStore: { get: fail, start: fail, stop: fail } });
  await f.bot.handle(f.event('/avi seen on', admin));
  assert.match(f.replies.at(-1), /needs shared storage/);
  await f.bot.handle(f.event('ordinary message'));
  assert.equal(f.replies.length, 1);
  await f.bot.handle(f.event('badword1'));
  assert.match(f.replies.at(-1), /Blocked word/);
});

test('profile failures use a short greeting without exposing IDs', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi seen on', admin));
  f.failApi();
  await f.bot.handle(f.event('hello'));
  assert.equal(f.replies.at(-1).altText, 'Hey there.');
});

test('admin menu and Seen controls send actionable Flex cards', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi admin', admin));
  assert.equal(f.replies.at(-1).type, 'flex');
  const actions = f.replies.at(-1).contents.body.contents.filter(item => item.type === 'button').map(item => item.action.text);
  assert.deepEqual(actions, ['/avi seen', '/avi warnings', '/avi members', '/avi status', '/avi protection']);
  await f.bot.handle(f.event('/avi seen', admin));
  assert.equal(f.replies.at(-1).altText, 'Seen Mode: OFF');
  await f.bot.handle(f.event('/avi warnings', admin));
  assert.match(f.replies.at(-1), /view totals/);
});

test('membership joins do not trigger Seen greetings', async () => {
  const f = setup();
  await f.bot.handle(f.event('/avi seen on', admin));
  f.replies.length = 0;
  await f.bot.handle({ type: 'memberJoined', source: { type: 'group', groupId: groupA }, joined: { members: [{ userId: member }] }, replyToken: 'fake' });
  assert.equal(f.replies.length, 0);
  await f.bot.handle(f.event('hello'));
  assert.equal(f.replies.at(-1).altText, 'Hey Member.');
});
