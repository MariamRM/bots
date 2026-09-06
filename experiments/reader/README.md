# Experimental reader companion

Separate regular-account experiment using LINEJS 3.3.2 and Deno 2.9.6. Live reader delivery remains unverified. It is not represented as LINE-approved and is not the Official Account webhook.

From the repository root:

```powershell
npm install --prefix experiments/reader
npm start --prefix experiments/reader
```

Open the localhost URL, log in with the new account by QR, select a test group, and click Start reader check. Send commands FROM THE LOGGED-IN ACCOUNT in that group:

- `/reader on`: send the opening message and start a reader session.
- `/reader off`: stop and clear the list.
- `/reader list`: show confirmed readers with up to 30 mentions.
- `/reader status`: show whether actual read notifications were confirmed.

Other accounts cannot control the experiment. Avi owner/mini-admin assignments are separate. Private-client IDs must not be assumed to match Official Account IDs.

Only a fresh NOTIFIED_READ_MESSAGE for the selected group covering the opening message ID or newer triggers Hey @Name, once per reader per session, capped at 100 readers. The logged-in account is excluded. Ordinary messages never trigger greetings. Repeated ON requires OFF first. Failed greetings remain recorded to prevent repeated sends.

For verification, keep the other account outside the group, send /reader on from the logged-in account, then open the opening message with the other account without typing. Check both the local read count and the actual greeting. An absent notification is inconclusive, not proof that nobody read a message.

Credentials and reader lists stay in memory. Restarting requires QR login and resets sessions. Stop with Ctrl+C. This companion must keep running locally; it is not deployed to Deno Deploy. Only command messages from the logged-in account are decrypted. Diagnostics do not expose credentials or message content.

Automated checks cover event filtering, mentions, authorization, duplicates, and stopping pending greetings. They do not prove live LINE support.

Sources:
- https://github.com/evex-dev/linejs
- https://github.com/evex-dev/linejs/blob/main/packages/linejs/client/login.ts
- https://github.com/evex-dev/linejs/blob/main/example/_event/talk-class.ts
