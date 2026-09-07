import { createHmac } from 'node:crypto';

// Correlate the SAME message, never names or similarities between provider IDs.
export function createIdentityLink() {
  let group = '';
  const users = new Map();
  return {
    reset() { group = ''; users.clear(); },
    get group() { return group; },
    get size() { return users.size; },
    user(id) { return users.get(id); },
    observe(message, observation) {
      if (String(message.id) !== observation.messageId || !message.from ||
          !/^C[0-9a-f]{32}$/.test(observation.groupId) || !/^U[0-9a-f]{32}$/.test(observation.userId)) throw new Error('Unverified identity link');
      if (!group && !observation.authorized) return;
      if (group && group !== observation.groupId) throw new Error('Group identity conflict');
      const additions = [[message.from, observation.userId]];
      if (observation.authorized) {
        const mentions = JSON.parse(message.contentMetadata?.MENTION || '{"MENTIONEES":[]}').MENTIONEES;
        for (const item of (Array.isArray(mentions) ? mentions : []).slice(0, 20)) {
          const start = Number(item.S), end = Number(item.E);
          if (typeof item.M !== 'string' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) continue;
          const matches = observation.mentions.filter(m => m.index === start && m.length === end - start && /^U[0-9a-f]{32}$/.test(m.userId));
          if (matches.length === 1) additions.push([item.M, matches[0].userId]);
        }
      }
      for (const [privateId, officialId] of additions) {
        if (users.has(privateId) && users.get(privateId) !== officialId) throw new Error('User identity conflict');
      }
      group = observation.groupId;
      for (const [privateId, officialId] of additions) if (users.size < 1000) users.set(privateId, officialId);
    }
  };
}

export function officialMessage(message, identity) {
  if (!message.contentMetadata?.MENTION) return { type: 'text', text: message.text };
  const mentions = JSON.parse(message.contentMetadata.MENTION).MENTIONEES;
  if (!Array.isArray(mentions) || !mentions.length || mentions.length > 20) throw new Error('Invalid mentions');
  const substitution = {};
  let text = '', offset = 0;
  const escape = value => value.replaceAll('{', '{{').replaceAll('}', '}}');
  for (const [i, mention] of mentions.entries()) {
    const start = Number(mention.S), end = Number(mention.E), userId = identity.user(mention.M);
    if (!userId || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < offset || end <= start || end > message.text.length) throw new Error('Reader identity is not linked');
    text += escape(message.text.slice(offset, start)) + `{reader${i}}`;
    substitution[`reader${i}`] = { type: 'mention', mentionee: { type: 'user', userId } };
    offset = end;
  }
  text += escape(message.text.slice(offset));
  return { type: 'textV2', text, substitution };
}

export function createAviBridge({ token, baseUrl, request = fetch, now = Date.now }) {
  const identity = createIdentityLink();
  let generation = 0;
  const status = { linkedUsers: 0, groupLinked: false, lastError: '', sentByAvi: 0 };
  async function observe(message) {
    const version = generation;
    if (!/^\/reader\s+(on|off|status|list|link)(?:\s|$)/i.test(message.text || '')) return null;
    const body = JSON.stringify({ messageId: String(message.id) });
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      const timestamp = String(now());
      const signature = createHmac('sha256', token).update('avi-reader-link:v1\n' + timestamp + '\n' + body).digest('hex');
      response = await request(baseUrl + '/reader/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-avi-reader-time': timestamp, 'x-avi-reader-signature': signature },
        body, signal: AbortSignal.timeout(10000), redirect: 'error'
      });
      if (response.status !== 404) break;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 700));
    }
    if (!response.ok) {
      status.lastError = `Avi link lookup failed (${response.status}). Check the latest deployment and send a fresh /reader command.`;
      throw new Error(status.lastError);
    }
    const observation = await response.json();
    if (version !== generation) return null;
    identity.observe(message, observation);
    status.linkedUsers = identity.size; status.groupLinked = Boolean(identity.group); status.lastError = '';
    return observation;
  }
  async function send(message) {
    if (!identity.group) throw new Error('Send /reader on from an Avi admin to link this group');
    const response = await request('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ to: identity.group, messages: [officialMessage(message, identity)] }),
      signal: AbortSignal.timeout(10000), redirect: 'error'
    });
    if (!response.ok) {
      status.lastError = `Avi send failed (${response.status}). Check token, group membership, and message quota.`;
      throw new Error(status.lastError);
    }
    const result = await response.json();
    status.sentByAvi++; status.lastError = '';
    return { id: result.sentMessages?.[0]?.id };
  }
  return { identity, status, observe, send, reset() {
    generation++;
    identity.reset(); Object.assign(status, { linkedUsers: 0, groupLinked: false, lastError: '', sentByAvi: 0 });
  } };
}
