import { inspectRead } from './event-check.mjs';

export function mentionMessage(prefix, users) {
  let text = prefix;
  const mentions = [];
  for (const user of users) {
    if (mentions.length) text += '\n';
    const label = '@' + String(user.name || 'user').replace(/[\r\n\t]/g, ' ').slice(0, 60);
    const start = text.length;
    text += label;
    mentions.push({ S: String(start), E: String(text.length), M: user.id });
  }
  return { text, contentMetadata: { MENTION: JSON.stringify({ MENTIONEES: mentions }) } };
}

export function createReaderMode({ send, profile, now = Date.now, authorize, canMention = (id) => true }) {
  let group = '', owner = '', self = '', session;
  let generation = 0;
  let commands = [];
  const status = { active: false, readers: 0, sentGreetings: 0, sendFailures: 0, confirmed: false, unlinkedReaders: 0 };
  function configure(g, o, s) {
    group = g; owner = o; self = s; session = undefined; generation++; commands = [];
    Object.assign(status, { active: false, readers: 0, sentGreetings: 0, sendFailures: 0, confirmed: false, unlinkedReaders: 0 });
  }
  async function command(message) {
    if (!group || message.to !== group || !(authorize ? await authorize(message) : [owner, self].includes(message.from))) return false;
    const action = message.text?.trim().match(/^(?:\/reader|\/avi\s+seen)\s+(on|off|list|status)$/i)?.[1]?.toLowerCase();
    if (!action) return false;
    commands = commands.filter(t => now() - t < 10000);
    if (commands.length >= 5) return true;
    commands.push(now());
    if (action === 'off') {
      generation++; session = undefined; status.active = false; status.readers = 0;
      await send(group, { text: '🔴 Seen Mode disabled' });
    } else if (action === 'on') {
      if (session) { await send(group, { text: '⚠️ Seen Mode is already active.\n/avi seen off' }); return true; }
      const version = ++generation;
      const started = now();
      const sent = await send(group, { text: '🟢 Seen Mode enabled' });
      if (version !== generation) return true;
      // The private read watermark must be compared to a private message ID.
      // Activating the mode does not itself count as a read event.
      const anchor = message.id ?? sent?.id;
      if (!/^\d+$/.test(String(anchor))) throw new Error('Read anchor was not confirmed');
      session = { started, anchor: String(anchor), users: new Map(), unlinked: new Set(), version };
      status.active = true; status.readers = 0; status.confirmed = false; status.unlinkedReaders = 0;
    } else if (action === 'list') {
      const users = session ? [...session.users.values()].slice(0, 20) : [];
      await send(group, users.length ? mentionMessage(`👁 Readers: ${session.users.size}\n`, users) : { text: 'No readers confirmed in this session.' });
    } else {
      await send(group, { text: `Reader mode: ${status.active ? 'ON' : 'OFF'}\nRead events confirmed: ${status.confirmed ? 'Yes' : 'Not yet'}\nReaders: ${status.readers}\nGreetings sent: ${status.sentGreetings}` });
    }
    return true;
  }
  async function event(op) {
    const current = session;
    if (!current) return;
    const check = inspectRead(op, group, current.started);
    if (check.result !== 'reader' || check.userId === self) return;
    if (!/^\d+$/.test(String(op.param3)) || BigInt(op.param3) < BigInt(current.anchor)) return;
    if (!canMention(check.userId)) {
      if (current.unlinked.size < 1000) current.unlinked.add(check.userId);
      status.unlinkedReaders = current.unlinked.size;
      return;
    }
    if (current.users.has(check.userId) || current.users.size >= 100) return;
    const user = { id: check.userId, name: 'user' };
    current.users.set(check.userId, user);
    status.confirmed = true; status.readers = current.users.size;
    try { user.name = await profile(check.userId) || 'user'; } catch { /* An actual mention still identifies the reader. */ }
    if (session !== current || current.version !== generation) return;
    try { await send(group, mentionMessage('Hey ', [user])); status.sentGreetings++; }
    catch { status.sendFailures++; }
  }
  return { configure, command, event, status };
}
