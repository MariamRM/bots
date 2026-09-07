// Read-only checks: no messages are sent to LINE users or groups.
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { parse } from 'dotenv';
const env = parse(await readFile(new URL('../../.env', import.meta.url), 'utf8'));
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.CHANNEL_ACCESS_TOKEN };
async function check() {
  const info = await fetch('https://api.line.me/v2/bot/info', { headers, signal: AbortSignal.timeout(10000), redirect: 'error' });
  console.log('Avi token check:', info.status);
  if (!info.ok || (await info.json()).basicId !== '@411qawev') throw new Error('Local token does not identify the expected Avi account');
  const validation = await fetch('https://api.line.me/v2/bot/message/validate/push', {
    method: 'POST', headers, signal: AbortSignal.timeout(10000), redirect: 'error',
    body: JSON.stringify({ messages: [{ type: 'textV2', text: 'Hey {reader0}', substitution: {
      reader0: { type: 'mention', mentionee: { type: 'user', userId: 'U' + '0'.repeat(32) } }
    } }] })
  });
  console.log('LINE mention-object validation:', validation.status);
  if (!validation.ok) throw new Error('Mention validation failed');
  const timestamp = String(Date.now()), body = JSON.stringify({ messageId: '0' });
  const signature = createHmac('sha256', env.CHANNEL_ACCESS_TOKEN).update('avi-reader-link:v1\n' + timestamp + '\n' + body).digest('hex');
  const resolver = await fetch('https://bots-63.mariamrm.deno.net/reader/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-avi-reader-time': timestamp, 'x-avi-reader-signature': signature },
    body, signal: AbortSignal.timeout(15000), redirect: 'error'
  });
  console.log('Deployed resolver:', resolver.status, '(404 means the test message is absent; 503 means storage is unavailable)');
  console.log('Resolver fingerprint:', resolver.headers.get('x-avi-reader-version') || 'not deployed');
}
try { await check(); } catch { console.error('Avi bridge preflight did not complete. No messages were sent.'); process.exitCode = 1; }
