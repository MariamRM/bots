const { randomUUID } = require('node:crypto');

const SETUP = 'Seen Mode needs shared storage. Connect a Deno KV database to this app, set SEEN_STORAGE=deno-kv for Production and Preview, then redeploy.';

function createSeenStore({ env = process.env, deno = globalThis.Deno } = {}) {
  const records = new Map();
  let connection;
  async function database() {
    if (env.SEEN_STORAGE !== 'deno-kv' || !deno?.openKv) throw new Error(SETUP);
    if (!connection) connection = deno.openKv().catch(error => { connection = undefined; throw error; });
    return connection;
  }
  const persistent = env.DENO_DEPLOY === 'true' || env.SEEN_STORAGE === 'deno-kv';
  async function read(groupId, kind = 'seen') {
    const key = ['avi', kind, groupId];
    if (persistent) return (await database()).get(key);
    const entry = records.get(JSON.stringify(key));
    return { key, value: entry?.value || null, versionstamp: entry?.versionstamp || null };
  }
  async function write(entry, value) {
    if (persistent) return (await (await database()).atomic().check(entry).set(entry.key, value).commit()).ok;
    const key = JSON.stringify(entry.key);
    if ((records.get(key)?.versionstamp || null) !== entry.versionstamp) return false;
    records.set(key, { value, versionstamp: randomUUID() });
    return true;
  }
  async function update(groupId, change, kind = 'seen') {
    for (let attempt = 0; attempt < 12; attempt++) {
      const entry = await read(groupId, kind);
      const result = change(entry.value);
      if (!result.next) return result.result;
      if (await write(entry, result.next)) return result.result;
    }
    throw new Error('Seen Mode is busy. Please try again.');
  }
  return {
    async adminIds(groupId) { return (await read(groupId, 'mini-admins')).value?.ids || []; },
    async isAdmin(groupId, userId) { return ((await read(groupId, 'mini-admins')).value?.ids || []).includes(userId); },
    grantAdmin(groupId, userId) {
      return update(groupId, value => {
        const ids = value?.ids || [];
        if (ids.includes(userId)) return { result: false };
        if (ids.length >= 500) throw new Error('Too many mini admins in this group.');
        return { next: { ids: [...ids, userId] }, result: true };
      }, 'mini-admins');
    },
    revokeAdmin(groupId, userId) {
      return update(groupId, value => {
        const ids = value?.ids || [];
        return { next: { ids: ids.filter(id => id !== userId) }, result: ids.includes(userId) };
      }, 'mini-admins');
    },
    async get(groupId) { return (await read(groupId)).value; },
    start(groupId) {
      return update(groupId, value => value?.active ? { result: false } : {
        next: { active: true, id: randomUUID(), greeted: [] }, result: true
      });
    },
    stop(groupId) {
      return update(groupId, value => ({
        next: { active: false, id: randomUUID(), greeted: [] }, result: Boolean(value?.active)
      }));
    },
    claim(groupId, sessionId, userId) {
      return update(groupId, value => {
        if (!value?.active || value.id !== sessionId || value.greeted.includes(userId) || value.greeted.length >= 1000) return { result: false };
        return { next: { ...value, greeted: [...value.greeted, userId] }, result: true };
      });
    }
  };
}

module.exports = { createSeenStore, SEEN_SETUP_MESSAGE: SETUP };
