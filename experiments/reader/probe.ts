import { loginWithQR, type Client } from '@evex/linejs';
import QRCode from 'qrcode';
import { inspectRead } from './event-check.mjs';
import { createReaderMode } from './reader-mode.mjs';

// Local, memory-only experiment. No Official Account token is loaded.
const key = crypto.randomUUID();
let client: Client | undefined;
let busy = false;
let selected = '';
let since = 0;
let selfId = '';
const handledMessages = new Set<string>();
const readerMode = createReaderMode({
  async send(to: string, message: { text: string; contentMetadata?: Record<string, string> }) {
    if (!client || to !== selected) throw new Error('Reader group is not connected');
    return await client.base.talk.sendMessage({ to, ...message, e2ee: true });
  },
  async profile(mid: string) { return (await client!.base.talk.getContact({ mid })).displayName; }
});
const readers = new Set<string>();
const diagnostics = { totalEvents: 0, selectedGroupEvents: 0, readEvents: 0, pollingErrors: 0, lastEvent: '', lastError: '', rejectedReads: {} as Record<string, number> };
const state = { status: 'Ready. Use the NEW regular LINE account to log in.', qr: '', pin: '', account: '', groups: [] as {id: string; name: string}[], reads: [] as string[] };

async function login() {
  if (busy || client) return;
  busy = true;
  state.status = 'Requesting QR login…';
  try {
    client = await loginWithQR({
      async onReceiveQRUrl(url) {
        state.qr = await QRCode.toDataURL(url);
        state.status = 'Scan this QR using the NEW account in LINE. Approve login on that phone.';
      },
      onPincodeRequest(pin) { state.pin = pin; state.status = 'Enter this verification code in LINE on your phone.'; },
    }, { device: 'DESKTOPWIN' });
    state.qr = ''; state.pin = '';
    const me = await client.getMyProfile();
    state.account = me.displayName; selfId = me.mid;
    state.groups = (await client.fetchJoinedChats()).map(chat => ({ id: chat.mid, name: chat.name }));
    state.status = 'Logged in. Select only your test group, then start the check.';
    // Read raw operations only. Do not decrypt, display, or store chat messages.
    const polling = client.base.createPolling();
    void (async () => {
      try {
        // The package's push listener starts its connection without awaiting it.
        // Use its explicit sync polling path so transport errors reach this UI.
        for await (const op of polling._listenTalkEvents({ pollingInterval: 1500, onError(error) {
          diagnostics.pollingErrors++;
          diagnostics.lastError = new Date().toLocaleTimeString();
          state.status = 'LINE event polling failed. Login alone does not confirm reader support.';
        } })) {
          diagnostics.totalEvents++;
          diagnostics.lastEvent = new Date().toLocaleTimeString();
          if (selected && (op.param1 === selected || op.message?.to === selected)) diagnostics.selectedGroupEvents++;
          if (['55', 'NOTIFIED_READ_MESSAGE'].includes(String(op.type))) diagnostics.readEvents++;
          // Commands are accepted only from the logged-in account in the locally selected group.
          // Other users' message content is not decrypted or used as a read trigger.
          if (selected && ['SEND_MESSAGE', 'RECEIVE_MESSAGE', '25', '26'].includes(String(op.type)) &&
              op.message?.to === selected && op.message.from === selfId && Number(op.createdTime) >= since) {
            const id = String(op.message.id);
            if (!handledMessages.has(id)) {
              handledMessages.add(id);
              if (handledMessages.size > 1000) handledMessages.delete(handledMessages.values().next().value!);
              try {
                const message = await client!.base.e2ee.decryptE2EEMessage(op.message);
                await readerMode.command(message);
              } catch { state.status = 'Reader command failed to decrypt or send. No reader greeting was confirmed.'; }
            }
          }
          await readerMode.event(op);
          const check = inspectRead(op, selected, since);
          if (check.result !== 'reader') {
            if (['55', 'NOTIFIED_READ_MESSAGE'].includes(String(op.type))) diagnostics.rejectedReads[check.result] = (diagnostics.rejectedReads[check.result] || 0) + 1;
            continue;
          }
          if (readers.has(check.userId!) || readers.size >= 100) continue;
          readers.add(check.userId!);
          state.reads.push(`Read notification received from reader ${readers.size} at ${new Date().toLocaleTimeString()}`);
          state.status = 'Read event received. Compare the time with the person opening your test message.';
        }
      } catch { selected = ''; state.status = 'The LINE event connection stopped. Restart the local test to retry.'; }
    })();
  } catch {
    client = undefined; state.qr = ''; state.pin = '';
    state.status = 'LINE login or group lookup failed. This unofficial client may not work with this account. You can retry.';
  } finally { busy = false; }
}

const html = `<!doctype html><html><meta charset="utf-8"><title>Avi reader test</title>
<style>body{font:18px system-ui;background:#f5f0ff;color:#302047;max-width:720px;margin:40px auto;padding:20px}button,select{font:inherit;padding:12px;margin:8px 0}img{width:280px}#pin{font-size:32px}li{margin:12px 0}</style>
<h1>Avi reader test</h1><p>Reader greetings use read notifications only. Login lasts while this process runs.</p>
<button id="login">Log in with the new account</button><p id="status"></p><p id="account"></p><img id="qr" hidden><p id="pin"></p>
<select id="groups"><option value="">Select your test group</option></select><br><button id="start">Start reader check</button><button id="stop">Stop check</button>
<ol><li>Log in with mariam, select the test group, and press Start reader check.</li><li>Using mariam in that group, send <b>/reader on</b>. This account sends the opening message and reader greetings.</li><li>Open that message with your other account without typing. A supported read event triggers Hey @Name once.</li><li>From mariam, use <b>/reader list</b>, <b>/reader status</b>, or <b>/reader off</b>. Other accounts cannot control this experiment.</li></ol>
<p>No notification means this test has not confirmed reader detection. It does not prove nobody read your message.</p><ul id="reads"></ul><h2>Connection check</h2><pre id="diagnostics"></pre>
<script>
const root=location.pathname; const el=id=>document.getElementById(id);
async function post(action,data={}){await fetch(root+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
el('login').onclick=()=>post('login');el('start').onclick=()=>post('start',{id:el('groups').value});el('stop').onclick=()=>post('stop');
let groupList='';async function refresh(){try{const s=await(await fetch(root+'state')).json();el('status').textContent=s.status;el('account').textContent=s.account?'Account: '+s.account:'';el('qr').hidden=!s.qr;if(s.qr)el('qr').src=s.qr;el('pin').textContent=s.pin?'Verification code: '+s.pin:'';
const next=JSON.stringify(s.groups);if(next!==groupList){groupList=next;el('groups').replaceChildren(new Option('Select your test group',''),...s.groups.map(g=>new Option(g.name,g.id)));}el('reads').replaceChildren(...s.reads.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));el('diagnostics').textContent=JSON.stringify({connection:s.diagnostics,readerMode:s.readerMode},null,2);}catch{el('status').textContent='Local test is not running.';}}setInterval(refresh,1000);refresh();
</script></html>`;

Deno.serve({ hostname: '127.0.0.1', port: 8788, onListen() { console.log(`Open http://127.0.0.1:8788/${key}/`); } }, async req => {
  const url = new URL(req.url);
  const root = `/${key}/`;
  const headers = { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' };
  if (url.host !== '127.0.0.1:8788' || !url.pathname.startsWith(root)) return new Response('Not found', { status: 404 });
  if (req.method === 'GET' && url.pathname === root) return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  if (req.method === 'GET' && url.pathname === root+'state') return Response.json({ ...state, diagnostics, readerMode: readerMode.status }, { headers });
  if (req.method !== 'POST' || req.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  if (url.pathname === root+'login') void login();
  else if (url.pathname === root+'start') {
    const body = await req.json().catch(() => ({}));
    if (!client || !state.groups.some(g => g.id === body.id)) return new Response('Select a group first', { status: 400 });
    selected = body.id; since = Date.now(); readers.clear(); state.reads = [];
    readerMode.configure(selected, selfId, selfId); handledMessages.clear();
    diagnostics.selectedGroupEvents = 0;
    state.status = 'Group selected. From mariam send /reader on. Live read delivery is not verified yet.';
  } else if (url.pathname === root+'stop') { selected = ''; readerMode.configure('', '', ''); state.status = 'Reader check stopped.'; }
  else return new Response('Not found', { status: 404 });
  return new Response('OK', { headers });
});
