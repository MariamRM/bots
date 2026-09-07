# Experimental Avi reader bridge

A local LINEJS 3.3.2 connection receives private-client read notifications. Avi's Official Account sends greetings through the official push API with textV2 mentions. The read source remains unofficial; this is not a claim of LINE approval or reliable support. The root `.env` must contain the same Avi channel access token as Deno Deploy. Deno Deploy must run the updated webhook with Deno KV attached and `SEEN_STORAGE=deno-kv`. The channel secret is still needed by the official webhook, but not by this local bridge.

From the repository root:

```powershell
npm install --prefix experiments/reader
npm start --prefix experiments/reader
```

Open the localhost URL, log in with the reader account by QR, select a group containing Avi, and click Start reader check. Send commands from your Avi owner or mini-admin account in that group:

- `/reader link @person`: select a real LINE mention to link each reader once per local session.
- `/reader on`: Avi sends the opening message and starts a reader session.
- `/reader off`: stop and clear the list.
- `/reader list`: show linked readers with up to 20 mentions.
- `/reader status`: show whether actual read notifications were confirmed.

Only current Avi owner/mini-admin accounts can control reader mode. Only the main owner can appoint mini admins. IDs are matched using the exact same message ID across the private client and Avi's verified webhook; mentioned users are matched by exact mention positions. Names and similarities between private and Official Account IDs are never used to guess a match. Unknown readers are counted in local diagnostics without sending incorrect mentions.

Only a fresh NOTIFIED_READ_MESSAGE for the selected group covering the opening message ID or newer triggers Hey @Name, once per reader per session, capped at 100 readers. The logged-in account is excluded. Ordinary messages never trigger greetings. Repeated ON requires OFF first. Failed greetings remain recorded to prevent repeated sends.

For verification, keep a linked person outside the group, send `/reader on` as an Avi admin, then have that person open Avi's new message without typing. Check both the local read count and Avi's actual greeting. The logged-in reader account cannot detect its own reads; use the separate mariam account as observer if Jay lu should be greeted. An absent notification is inconclusive, not proof that nobody read a message.

The login session, identity links and reader lists stay in memory. Restarting requires QR login and relinking users. Stop with Ctrl+C. The companion must keep running locally; it is not deployed to Deno Deploy. Selected-group messages are inspected for reader commands without retaining conversation text. Diagnostics never expose credentials or message content.

Avi indexes only explicit `/reader` commands for ten minutes in Deno KV, storing sender/group IDs and mention positions without text. The read-only resolver requires a timestamped, domain-separated HMAC using the channel access token and rechecks admin roles on every lookup. An unauthorized user cannot establish the group link or link other people; their own `/reader link` can identify only themselves once the group is linked.

Read notifications from two distinct users reached the previous local probe. The new bridge still needs a live end-to-end test confirming cross-API message IDs, Avi's read watermark, and Avi's actual greeting. Automated checks cover filtering, authenticated identity matching, mentions, authorization, duplicates, and stopping pending greetings. They do not prove live support. `node experiments/reader/check-avi.mjs` validates credentials, mention syntax and the deployed resolver without sending group messages. Official push messages use the account's message allowance.

Sources:
- https://github.com/evex-dev/linejs
- https://github.com/evex-dev/linejs/blob/main/packages/linejs/client/login.ts
- https://github.com/evex-dev/linejs/blob/main/example/_event/talk-class.ts
- https://developers.line.biz/en/reference/messaging-api/#text-message-v2
