# Using Avi in regular LINE groups

Avi detects spam and records warnings. A bot admin can use Avi's moderation commands; this role does not grant LINE app permissions.

The official Messaging API offers group information and messaging, but no endpoints to add/kick members, manage invitation links, delete other people's messages, or appoint LINE group admins. Regular groups do not offer the OpenChat admin/co-admin model. Bot permissions cannot stop another group member from using LINE's own membership controls.

## 1. Add the bot to a group

1. In LINE Developers Console, open your channel's **Messaging API** tab.
2. Enable **Allow bot to join group chats** and **Use webhook**. Keep the deployed HTTPS URL ending in `/webhook` as your webhook URL.
3. Add the LINE Official Account as a friend in LINE, then open the group > menu > **Invite** and select the bot.
4. Send `/avi help` in the group. Automatic checks apply to new messages while Avi is present.

Only one LINE Official Account can be in a group at a time. See [LINE's group bot documentation](https://developers.line.biz/en/docs/messaging-api/group-chats/).

## 2. Set yourself as bot owner

1. Send `/avi id` to Avi in a private chat. Copy the returned **user ID** (starts with `U`); it is different from your searchable LINE username.
2. In Deno Deploy > your app > **Settings > Environment Variables**, add `BOT_OWNER_IDS` with that ID. Multiple owners can be separated by commas.
3. Select **Production and Preview**, save, and redeploy the latest `main` branch. Keep the two channel credentials as Secrets. Owner/admin configuration can also be stored as Secrets.

Owners can use bot-admin commands in any group they are in. There is no first-user or first-message claim command: only someone with access to the deployment settings can configure owners.

## 3. Give someone bot-admin access in one group

1. In that group, you and the trusted person each send `/avi id`.
2. Copy the **group ID** (starts with `C`) and the trusted person's **user ID** (starts with `U`).
3. Add `GROUP_ADMIN_IDS` in Deno settings. Its value is a JSON object mapping each group to its bot admins. For example, replace these dummy IDs with the actual IDs:

```json
{
  "Caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": [
    "U22222222222222222222222222222222",
    "U33333333333333333333333333333333"
  ]
}
```

4. Select **Production and Preview**, save and redeploy. To revoke access, remove that person's ID, save and redeploy. To add another group, add another group-ID entry.

These users can warn/reset in that group only. They cannot appoint more bot admins. The deployment owner manages assignments, which persist across app restarts because they are configuration.

## 4. Commands

### Seen Mode and violet cards

`/avi admin` opens the **AVI ADMIN** menu with Seen Mode, Warnings, Members, Group Status and Protection. Its buttons send commands into the current group; every command still checks the sender's bot-admin permission. Menu cards and greetings are visible to the group, even though only admins can trigger the admin controls.

- `.` — an owner/admin gets a small violet card: **Hey Mariam. / Avi is active.** An ordinary member's dot is always ignored, including when Seen Mode is on.
- `/avi seen` — opens the ON/OFF controls.
- `/avi seen on` — starts a group Seen session. If already ON, Avi asks you to use OFF first; it does not clear the current greeting list.
- `/avi seen off` — ends the session and clears its list. Starting again creates a new session.
- During a session, the first ordinary text message from each user triggers **Hey [display name].** in a violet gradient card. Repeated messages do not repeat the greeting. Commands, dots, stickers, images and membership joins do not trigger automatic Seen greetings. If LINE cannot provide a name, Avi says **Hey there.**

The card gradient runs from light violet at lower opacity to deeper violet at higher opacity. LINE's normal text-bubble colour and its Read/Seen receipts are not changed. Moderation warnings remain active when Seen Mode is OFF.

### One-time Deno storage setup for Seen Mode

1. In your Deno organization, open **Databases > Provision Database**. Choose **Deno KV**, name it `avi-seen`, and save.
2. **Assign** the database to the `bots-63` app and wait until it is connected.
3. In the app's environment variables, set `SEEN_STORAGE` to `deno-kv` for **Production and Preview**. This value may be Plain Text. Save and redeploy.
4. Your `BOT_OWNER_IDS` / `GROUP_ADMIN_IDS` configuration still controls who can open the menu and change Seen Mode. Keep webhooks enabled and LINE auto-response messages disabled while using Avi.

Shared storage keeps the ON/OFF state and greeted-user IDs across Deno restarts and instances. When storage is missing, Seen Mode stays unavailable and provides setup instructions; ordinary protection and admin greetings continue to work. Normal Node development uses temporary memory for Seen sessions.

Only group/user IDs and a session identifier are stored for this feature, not message text. OFF clears the greeted-user list. Sessions remain active until switched OFF (or the bot receives a leave event). A greeting is claimed before sending to prevent duplicate attempts; a failed send may mean that user gets no greeting in that session. Already-sent or in-flight messages cannot be recalled by OFF.

See [Deno KV setup](https://docs.deno.com/deploy/reference/deno_kv/) and [LINE gradient support](https://developers.line.biz/en/docs/messaging-api/flex-message-layout/#linear-gradient-backgrounds).

| Command | Who can use it | Result |
| --- | --- | --- |
| `/avi help` | Anyone | Instructions and limitations |
| `/avi id` | Anyone | Your user ID and current group ID |
| `/avi admin` | Group bot admin or owner, in group | Violet AVI ADMIN menu |
| `.` | Bot owner, or admin in their assigned group | Short violet greeting; other members get silence |
| `/avi seen on` / `/avi seen off` | Group bot admin or owner, in group | Start/stop a Seen greeting session |
| `/avi protection` | Group bot admin or owner, in group | Explain active protection and membership limits |
| `/avi status` | Group bot admin or owner, in group | Group name, live LINE member count and monitoring status |
| `/avi members` | Group bot admin or owner, in group | Up to 30 recently observed users, IDs, warning counts and UTC timestamps |
| `/avi seen @person` | Group bot admin or owner, in group | Last event observed for that person, not online/read status |
| `/avi warn @person` | Group bot admin or owner, in group | Record a warning after checking current membership |
| `/avi warnings @person` | Group bot admin or owner, in group | Temporary warning and risk totals |
| `/avi reset @person` | Group bot admin or owner, in group | Clear warnings and risk totals |
| `/avi groups` | Owner, private chat with Avi | Up to 50 groups recently observed on the responding server instance |

For `@person`, select exactly one real user from LINE's mention picker. Merely typing their display name does not identify them. Command responses appear in the chat where you send the command, so group replies are visible to its members.

The bot checks six or more messages or four identical messages within ten seconds. `BLOCKED_WORDS` and `BLOCKED_DOMAINS` can be configured as comma-separated environment variables; the defaults are examples. Domain checks include subdomains. Automatic alerts are limited to one per user per ten seconds; violations still increase the counters. Commands are limited to six responses per user per chat per ten seconds.

## 5. Membership controls in the LINE phone app

- **Invite people:** open the group > menu > **Invite**, select friends, then **Invite**.
- **Remove someone:** group > menu > **Members > Edit**. On iPhone choose the minus icon and **Remove**; on Android choose **Delete > OK**.
- **Open/close link invitations:** group > menu > **Settings > Invite by link or QR code**, turn it on/off.
- **Invalidate an old shared link:** group > menu > **Invite > QR code** or **Invite link > Regenerate**. This replaces the invitation link; distribute the new one only to intended invitees.

These actions are performed by people in LINE. There is no Avi command to restrict them to your bot admins, and adding someone as bot admin does not change their LINE membership powers. For an actual admin/co-admin role, LINE has a separate product, OpenChat; this bot is built for regular group chats.

Official instructions: [Invitations](https://help.line.me/line/smartphone/sp?contentId=20008159&lang=en), [removing members](https://help.line.me/line/smartphone/?contentId=20000420&lang=en), [replacing leaked links](https://help.line.me/line/smartphone/?contentId=20023024&lang=en).

## What activity reports can and cannot show

Activity reports, group discovery, webhook-event deduplication, and warnings are held in memory for at most 24 hours of inactivity, with size limits. They disappear on restart and are not shared between Deno instances. Treat them as a temporary view, not a complete audit or a reliable cross-instance history. Seen Mode's ON/OFF state and greeting list use the separate shared storage described above.

Avi only observes events LINE delivers while it is present: new messages and member join/leave events. It cannot retrieve old chats, watch users in unrelated groups, read their private conversations, or tell who is online or has read a message. It stores message hashes for repetition checks, not an archive of message text. It announces its monitoring when joining a group; if already present before this update, share these rules with members.

`/avi members` deliberately reports observed users. Full member-ID enumeration is restricted by LINE to verified/premium accounts; it is not implemented here. Use the LINE app's Members screen for the full list. See the [Messaging API reference](https://developers.line.biz/en/reference/messaging-api/#get-group-member-ids).

LINE reply failures are logged by status without logging credentials. They are not automatically retried. Event deduplication applies only while its record exists on the same instance; it does not guarantee exactly-once processing across deployments.
