const { createHmac, createHash, timingSafeEqual } = require('node:crypto');
const { createSeenStore } = require('./seen-store');
const { isMainOwner } = require('./owner');

const TTL = 10 * 60 * 1000;
function validRequest(raw, timestamp, signature, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw) || typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp)) > 60000 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update('avi-reader-link:v1\n' + timestamp + '\n').update(raw).digest('hex');
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function createReaderLink({ deno = globalThis.Deno, env = process.env, now = Date.now,
  owner = isMainOwner, admins = createSeenStore({ deno, env }) } = {}) {
  let connection;
  const memory = new Map();
  const fingerprints = new Map();
  const persistent = env.DENO_DEPLOY === 'true' || env.SEEN_STORAGE === 'deno-kv';
  async function db() {
    if (!deno?.openKv || env.SEEN_STORAGE !== 'deno-kv') throw new Error('Reader linking needs Deno KV');
    return connection ||= deno.openKv().catch(e => { connection = undefined; throw e; });
  }
  return {
    async observe(event) {
      // Only explicit reader commands are indexed. Never store conversation text.
      if (event?.type !== 'message' || event.source?.type !== 'group' || event.message?.type !== 'text' ||
          !/^(?:\/reader|\/avi\s+seen)\s+(on|off|status|list|link)(?:\s|$)/i.test(event.message.text || '') ||
          !/^\d{1,30}$/.test(event.message.id || '') || !event.source.userId) return;
      const value = {
        messageId: event.message.id, groupId: event.source.groupId, userId: event.source.userId,
        timestamp: Number(event.timestamp), commandHash: createHash('sha256').update(event.message.text).digest('hex'),
        action: event.message.text.match(/^(?:\/reader|\/avi\s+seen)\s+(on|off|status|list|link)(?:\s|$)/i)[1].toLowerCase(),
        mentions: (event.message.mention?.mentionees || []).filter(m => m.type === 'user' && m.userId)
          .slice(0, 20).map(m => ({ index: m.index, length: m.length, userId: m.userId })),
        expires: now() + TTL
      };
      if (persistent) {
        const kv = await db();
        await kv.set(['avi', 'reader-link', value.messageId], value, { expireIn: TTL });
        if (Number.isSafeInteger(value.timestamp) && value.timestamp > 0) {
          const key = ['avi', 'reader-fingerprint', value.timestamp, value.commandHash];
          // Never choose an arbitrary user if more than one message matches.
          for (let attempt = 0; attempt < 10; attempt++) {
            const entry = await kv.get(key);
            const next = entry.value && entry.value.messageId !== value.messageId ? { ambiguous: true } : value;
            if ((await kv.atomic().check(entry).set(key, next, { expireIn: TTL }).commit()).ok) break;
          }
        }
      }
      else {
        memory.set(value.messageId, value);
        for (const [id, entry] of memory) if (entry.expires <= now()) memory.delete(id);
        if (memory.size > 500) memory.delete(memory.keys().next().value);
        const key = value.timestamp + ':' + value.commandHash;
        const previous = fingerprints.get(key);
        fingerprints.set(key, previous && previous.messageId !== value.messageId ? { ambiguous: true, expires: value.expires } : value);
        for (const [id, entry] of fingerprints) if (entry.expires <= now()) fingerprints.delete(id);
        if (fingerprints.size > 500) fingerprints.delete(fingerprints.keys().next().value);
      }
    },
    async resolve(id, fingerprint) {
      let value = persistent ? (await (await db()).get(['avi', 'reader-link', id])).value : memory.get(id);
      if (!value && fingerprint) {
        value = persistent ? (await (await db()).get(['avi', 'reader-fingerprint', fingerprint.timestamp, fingerprint.commandHash])).value
          : fingerprints.get(fingerprint.timestamp + ':' + fingerprint.commandHash);
      }
      if (value?.ambiguous) return null;
      if (!value || value.expires <= now()) return null;
      // Recheck roles on each request; a cached observation does not preserve admin privileges.
      const authorized = owner(value.userId) || await admins.isAdmin(value.groupId, value.userId);
      return { ...value, authorized };
    }
  };
}
module.exports = { createReaderLink, validRequest };
