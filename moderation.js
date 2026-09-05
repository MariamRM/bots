const crypto = require('node:crypto');
const { createSeenStore, SEEN_SETUP_MESSAGE } = require('./seen-store');
const { greetingCard, adminCard, seenCard } = require('./cards');

const HELP = `Avi group protection
/avi help — commands and limits
/avi id — your bot user ID and this group ID
Bot admins, inside their assigned group:
/avi admin — AVI ADMIN menu
. — quick admin greeting (ordinary members get no reply)
/avi seen on — start one greeting per user per session
/avi seen off — end the session; ON again starts a new list
/avi status — group name, member count and monitoring status
/avi members — recently observed users (not a complete member list)
/avi seen @person — last event observed by this bot instance
/avi warn @person — record a warning
/avi warnings @person — show warning totals
/avi reset @person — clear warning totals
Owner, in a private chat with the bot:
/avi groups — groups recently observed by this instance

Select a real LINE @mention from the member picker.
Bot admins are configured by the owner in GROUP_ADMIN_IDS.
Warnings/activity are temporary and separate for each group and server instance.
Avi cannot kick/invite users, change join links, appoint LINE admins, read private chats between others, or show online/read status.`;

function createModeration({ reply, api, env = process.env, now = Date.now, seenStore = createSeenStore({ env }) }) {
  const owners = new Set((env.BOT_OWNER_IDS || '').split(',').map(id => id.trim()).filter(Boolean));
  let admins;
  try {
    admins = JSON.parse(env.GROUP_ADMIN_IDS || '{}');
    if (!admins || Array.isArray(admins) || typeof admins !== 'object' ||
        Object.entries(admins).some(([group, ids]) => !/^C[0-9a-f]{32}$/i.test(group) ||
          !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^U[0-9a-f]{32}$/i.test(id)))) {
      throw new Error();
    }
  } catch {
    throw new Error('GROUP_ADMIN_IDS must be a JSON object mapping LINE group IDs to arrays of LINE user IDs.');
  }
  const words = (env.BLOCKED_WORDS ?? 'badword1,badword2').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const domains = (env.BLOCKED_DOMAINS ?? 'scam.com,badsite.com').split(',').map(x => x.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
  const groups = new Map();
  const directUsers = new Map();
  const processed = new Map();
  const DAY = 86400000;

  function userState(collection, id) {
    let user = collection.get(id);
    if (!user) {
      if (collection.size >= 1000) collection.delete(collection.keys().next().value);
      user = { messages: [], warnings: 0, riskScore: 0, lastSeen: now(), lastObserved: null };
      collection.set(id, user);
    }
    return user;
  }

  function target(event) {
    const mentions = event.message?.mention?.mentionees || [];
    const ids = [...new Set(mentions.filter(m => m.type === 'user' && /^U[0-9a-f]{32}$/i.test(m.userId)).map(m => m.userId))];
    return ids.length === 1 ? ids[0] : null;
  }

  async function handle(event) {
    if (!event || event.mode === 'standby') return;
    const timestamp = now();
    for (const [key, group] of groups) if (timestamp - group.lastSeen > DAY) groups.delete(key);
    for (const [key, user] of directUsers) if (timestamp - user.lastSeen > DAY) directUsers.delete(key);
    for (const [key, time] of processed) if (timestamp - time > DAY) processed.delete(key);
    if (event.webhookEventId) {
      if (processed.has(event.webhookEventId)) return;
      if (processed.size >= 10000) processed.delete(processed.keys().next().value);
      processed.set(event.webhookEventId, timestamp);
    }
    const groupId = event.source?.type === 'group' ? event.source.groupId : null;
    const userId = event.source?.userId;
    const say = message => event.replyToken ? reply(event.replyToken, typeof message === 'string' ? message.slice(0, 4900) : message) : Promise.resolve();
    let group;
    if (groupId) {
      if (event.type === 'leave') {
        groups.delete(groupId);
        try { await seenStore.stop(groupId); } catch { console.error('Could not close Seen session after leaving group'); }
        return;
      }
      if (!groups.has(groupId)) {
        if (groups.size >= 200) groups.delete(groups.keys().next().value);
        groups.set(groupId, { users: new Map(), lastSeen: timestamp });
      }
      group = groups.get(groupId);
      group.lastSeen = timestamp;
      for (const [id, user] of group.users) if (timestamp - user.lastSeen > DAY) group.users.delete(id);
      if (event.type === 'join') {
        return say('Avi is here. I check new messages for spam and configured blocked words/domains, and temporarily track activity and warnings. Type /avi help. I cannot remove members or change invitation links.');
      }
      if (event.type === 'memberJoined') {
        for (const member of event.joined?.members || []) {
          if (member.userId) {
            const memberState = userState(group.users, member.userId);
            memberState.lastSeen = timestamp;
            memberState.lastObserved = timestamp;
          }
        }
        return;
      }
      if (event.type === 'memberLeft') {
        for (const member of event.left?.members || []) group.users.delete(member.userId);
        return;
      }
    }
    if (event.type !== 'message' || !userId) return;
    // Multi-person rooms are not regular groups and cannot use group admin permissions.
    if (!group && event.source?.type !== 'user') return;
    const collection = group ? group.users : directUsers;
    const user = userState(collection, userId);
    user.lastSeen = timestamp;
    user.lastObserved = timestamp;
    if (event.message?.type !== 'text' || typeof event.message.text !== 'string') return;
    const text = event.message.text;
    const authorized = owners.has(userId) || Boolean(group && Object.hasOwn(admins, groupId) && admins[groupId].includes(userId));
    const allowCommand = () => {
      user.commandTimes = (user.commandTimes || []).filter(time => timestamp - time < 10000);
      if (user.commandTimes.length >= 6) return false;
      user.commandTimes.push(timestamp);
      return true;
    };
    const displayName = async () => {
      try {
        const profile = await api(group ? `/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}` : `/profile/${encodeURIComponent(userId)}`);
        return profile.displayName || 'there';
      } catch { return 'there'; }
    };
    if (text.trim() === '.') {
      if (!authorized || !allowCommand()) return;
      return say(greetingCard(await displayName(), true));
    }
    const command = text.trim().match(/^\/avi(?:\s+(\S+))?(?:\s|$)/i);
    if (command) {
      if (!allowCommand()) return;
      const name = (command[1] || 'help').toLowerCase();
      if (name === 'help') return say(HELP);
      if (name === 'id') return say(`Your user ID: ${userId}${groupId ? `\nGroup ID: ${groupId}` : ''}`);
      if (name === 'groups') {
        if (!owners.has(userId) || event.source.type !== 'user') return say('Only the configured bot owner can use /avi groups in a private chat with Avi.');
        const rows = [...groups.entries()].slice(-50).map(([id, g]) => `${g.name || 'Group'} | ${id}\nLast event: ${new Date(g.lastSeen).toISOString()}`);
        return say(`Recently observed groups on this instance (not a full list; clears on restart):\n${rows.join('\n') || 'None observed here yet.'}`);
      }
      if (!['admin', 'protection', 'status', 'members', 'seen', 'warn', 'warnings', 'reset'].includes(name)) return say('Unknown command. Type /avi help. Invitations, kicks, join-link controls and LINE admin promotion must be handled in LINE; Avi has no API for these actions.');
      if (!group) return say('Use this command inside the regular LINE group you want to manage.');
      if (!authorized) return say('This command requires bot-admin permission for this group. The bot owner configures BOT_OWNER_IDS and GROUP_ADMIN_IDS in Deno settings.');
      if (name === 'admin') return say(adminCard());
      if (name === 'protection') return say('🔐 Protection is active: flood/repetition checks and configured blocked words/domains. Seen Mode is a separate greeting feature; switching it off keeps protection active. Invite/remove members inside LINE.');
      if (name === 'seen' && /^\/avi\s+seen(?:\s+(on|off))?\s*$/i.test(text.trim())) {
        const action = text.trim().split(/\s+/)[2]?.toLowerCase();
        try {
          if (action === 'on') {
            const started = await seenStore.start(groupId);
            return say(started ? '🟢 Seen Mode enabled\n\nAvi will greet each user once when they write.\nUse /avi seen off to close it.' : '⚠️ Seen Mode is already active.\n\nClose it first:\n/avi seen off');
          }
          if (action === 'off') {
            await seenStore.stop(groupId);
            return say('🔴 Seen Mode disabled');
          }
          return say(seenCard(Boolean((await seenStore.get(groupId))?.active)));
        } catch { return say(SEEN_SETUP_MESSAGE); }
      }
      if (name === 'warnings' && /^\/avi\s+warnings\s*$/i.test(text.trim())) return say('⚠️ Warnings\n/avi warn @person — record a warning\n/avi warnings @person — view totals\n/avi reset @person — clear totals\nSelect a real LINE @mention.');
      if (name === 'status') {
        try {
          const [summary, count] = await Promise.all([
            api(`/group/${encodeURIComponent(groupId)}/summary`),
            api(`/group/${encodeURIComponent(groupId)}/members/count`)
          ]);
          group.name = String(summary.groupName || 'Group').slice(0, 100);
          return say(`${group.name}\nGroup ID: ${groupId}\nLINE member count (excluding bot): ${count.count}\nProtection: spam, repeated text, configured words/domains\nWarning/activity storage: temporary, this instance only\nUse /avi members for recently observed users.`);
        } catch { return say('LINE group information is unavailable. Check the channel access token and that Avi is still in this group, then try again.'); }
      }
      if (name === 'members') {
        const rows = [...group.users.entries()].filter(([, u]) => u.lastObserved !== null).sort((a, b) => b[1].lastObserved - a[1].lastObserved).slice(0, 30)
          .map(([id, u]) => `${id} | warnings ${u.warnings} | ${new Date(u.lastObserved).toISOString()}`);
        return say(`Recently observed users, up to 30 (not a full member list or online status; this instance only):\n${rows.join('\n')}`);
      }
      const id = target(event);
      if (!id) return say('Select exactly one person using LINE\'s @mention picker, e.g. /avi warn @person. Typing their name without a real mention is not enough.');
      if (name === 'seen') {
        const observed = group.users.get(id);
        return say(observed?.lastObserved != null ? `${id}\nLast event observed here: ${new Date(observed.lastObserved).toISOString()}\nThis is not online or read status.` : 'No recent activity for this user on this instance. This does not mean they are offline or absent from the group.');
      }
      if (name === 'warnings') {
        const observed = group.users.get(id);
        return say(observed ? `${id}\nWarnings: ${observed.warnings}\nRisk Score: ${observed.riskScore}\nTemporary totals for this group and instance.` : 'No warning record on this instance. Records can expire or disappear after restart.');
      }
      // Recheck membership through LINE before recording an admin action.
      let profile;
      try { profile = await api(`/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(id)}`); }
      catch { return say('Could not confirm that person is a current group member. No warning record was changed.'); }
      const record = userState(group.users, id);
      if (name === 'reset') { record.warnings = 0; record.riskScore = 0; }
      else { record.warnings++; record.riskScore++; }
      return say(`${name === 'reset' ? 'Warnings cleared' : 'Admin warning recorded'}: ${String(profile.displayName || id).slice(0, 100)}\nWarnings: ${record.warnings}\nRisk Score: ${record.riskScore}\nTemporary totals for this group and instance.`);
    }

    const digest = crypto.createHash('sha256').update(text).digest('hex');
    user.messages = user.messages.filter(m => timestamp - m.time <= 10000).slice(-99);
    user.messages.push({ digest, time: timestamp });
    const reasons = [];
    let points = 0;
    if (user.messages.length >= 6) { reasons.push('Flood detected'); points += 3; }
    if (user.messages.filter(m => m.digest === digest).length >= 4) { reasons.push('Repeated spam'); points += 3; }
    if (words.some(word => text.toLowerCase().includes(word))) { reasons.push('Blocked word'); points += 2; }
    const suspicious = (text.match(/https?:\/\/[^\s<>]+/gi) || []).some(link => {
      try {
        const host = new URL(link).hostname.toLowerCase().replace(/\.$/, '');
        return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
      } catch { return false; }
    });
    if (suspicious) { reasons.push('Suspicious link'); points += 5; }
    const announce = async alert => {
      let card;
      if (group && event.replyToken) {
        try {
          const session = await seenStore.get(groupId);
          if (session?.active && !session.greeted.includes(userId)) {
            const name = await displayName();
            if (await seenStore.claim(groupId, session.id, userId)) {
              const current = await seenStore.get(groupId);
              if (current?.active && current.id === session.id) card = greetingCard(name);
            }
          }
        } catch { /* Seen storage failures must not interrupt protection or cause repeated replies. */ }
      }
      if (alert && card) return say([{ type: 'text', text: alert }, card]);
      if (alert || card) return say(alert || card);
    };
    if (!reasons.length) return announce();
    user.warnings++;
    user.riskScore += points;
    // Limit automatic alert volume while continuing to count violations.
    if (user.lastAlert !== undefined && timestamp - user.lastAlert < 10000) return announce();
    user.lastAlert = timestamp;
    return announce(`⚠️ Avi Protection Alert\nUser: ${userId}\nReason: ${reasons.join(', ')}\nWarnings: ${user.warnings}\nRisk Score: ${user.riskScore}\nTemporary totals. A group member must handle any removal manually.`);
  }
  return { handle };
}

module.exports = { createModeration };
