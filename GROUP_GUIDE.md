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

The main owner's LINE identity is pinned by its fingerprint in `owner.js`. After deploying this version, that account can send `/avi claim` to confirm access, then `/avi admin` in any group to open the menu. Claim does not give ownership to any other account.

Only this main owner can appoint or remove mini admins. Legacy `BOT_OWNER_IDS` and `GROUP_ADMIN_IDS` environment variables are no longer used. Keep the channel token and secret as Secrets.

## 3. Give someone bot-admin access in one group

Connect Deno KV using the storage instructions below first. Then the main owner sends these commands inside the relevant group:

- `/avi admin add @person` grants mini-admin access. Type `@` and select the person from LINE's member picker.
- `/avi admin remove @person` revokes that person's access in this group.
- `/avi admins` lists this group's mini-admin IDs.

Mini admins can use the admin menu, warnings and other moderation commands in their assigned group only. They cannot appoint or remove admins, including themselves. The main owner's access cannot be removed through a chat command. Assignments persist in Deno KV across restarts and remain until explicitly revoked, including if someone leaves and rejoins.

## 4. Commands

### Reader mode and violet cards

Automatic greetings triggered by ordinary messages have been removed. The Official Account cannot detect silent readers and `/avi seen` explains the separate reader companion. The explicit owner/admin `.` greeting remains available.

The experimental bridge is in `experiments/reader`. Log in locally with the reader account and select a group containing Avi. From your Avi owner/mini-admin account, send `/reader link @person` using real mentions, then `/reader on`. Avi sends the opening message and greetings with real mentions. `/reader off`, `/reader list`, and `/reader status` use your current Avi admin permissions. Ordinary messages never trigger greetings. The reader account itself cannot be detected as a reader.

Read notifications reached the local probe, but the new bridge still needs a live test confirming cross-API identity matching and Avi's actual greeting. It is not represented as LINE-approved. It runs locally while the process stays open; restarting clears sessions, identity links, reader lists and login. See `experiments/reader/README.md` for setup and verification.

### Deno storage for mini-admin roles and legacy session cleanup

1. In your Deno organization, open **Databases > Provision Database**. Choose **Deno KV**, name it `avi-seen`, and save.
2. **Assign** the database to the `bots-63` app and wait until it is connected.
3. In the app's environment variables, set `SEEN_STORAGE` to `deno-kv` for **Production and Preview**. This value may be Plain Text. Save and redeploy.
4. The same database saves mini-admin assignments. Keep webhooks enabled and LINE auto-response messages disabled while using Avi. Main-owner recognition works without the database; assigning mini admins requires it.

Deno KV persists mini-admin assignments. It cannot add read notifications to the Official Account API. Previous greeting sessions no longer cause writer greetings.

| Command | Who can use it | Result |
| --- | --- | --- |
| `/avi help` | Anyone | Instructions and limitations |
| `/avi id` | Anyone | Your user ID and current group ID |
| `/avi admin` | Group bot admin or owner, in group | Violet AVI ADMIN menu |
| `.` | Bot owner, or admin in their assigned group | Short violet greeting; other members get silence |
| `/avi seen` | Group bot admin or owner | Reader companion instructions; no writer greetings |
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

Activity reports, group discovery, webhook-event deduplication, and warnings are held in memory for at most 24 hours of inactivity, with size limits. They disappear on restart and are not shared between Deno instances. Treat them as a temporary view, not a complete audit or a reliable cross-instance history. Mini-admin assignments use Deno KV. The experimental reader companion keeps its reader sessions in local memory.

Avi only observes events LINE delivers while it is present: new messages and member join/leave events. It cannot retrieve old chats, watch users in unrelated groups, read their private conversations, or tell who is online or has read a message. It stores message hashes for repetition checks, not an archive of message text. It announces its monitoring when joining a group; if already present before this update, share these rules with members.

`/avi members` deliberately reports observed users. Full member-ID enumeration is restricted by LINE to verified/premium accounts; it is not implemented here. Use the LINE app's Members screen for the full list. See the [Messaging API reference](https://developers.line.biz/en/reference/messaging-api/#get-group-member-ids).

LINE reply failures are logged by status without logging credentials. They are not automatically retried. Event deduplication applies only while its record exists on the same instance; it does not guarantee exactly-once processing across deployments.
