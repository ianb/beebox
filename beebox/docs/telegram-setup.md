# Telegram Connector Setup

The Telegram connector lets you connect a Telegram group chat (or private chat) to your box. Incoming messages accumulate on a per-chat thread card; outbound messages are sent from output cards.

## How it works

- **Inbound (real-time):** Telegram pushes messages to a webhook on your server. Each message is appended to a `chat-thread` card at `_content/chat/telegram/<Chat>/thread.chat-thread.card` (one accumulating thread per chat), and a chat job is created for the agent.
- **Inbound (catch-up):** On `bbx wakeup`, the connector polls for any messages missed while the server was down, then re-establishes the webhook.
- **Outbound:** Create a `telegram-message.card` in `_bookkeeping/output/` and run `bbx wakeup --connector telegram`. The connector sends it and deletes the card.

## 1. Create a Telegram bot

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a display name (e.g., "Family Box")
4. Choose a username ending in `bot` (e.g., `family_box_bot`)
5. Copy the **bot token** — it looks like `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`

## 2. Disable privacy mode

By default, bots only see messages that mention them or are replies to them. To see all messages in a group:

1. In the BotFather chat, send `/setprivacy`
2. Select your bot
3. Choose **Disable**

## 3. Add the bot to a group

1. Create a Telegram group (or use an existing one)
2. Add your bot to the group as a member
3. Send a test message in the group

## 4. Configure the connector

Paste the bot token into the box's admin page (Telegram section) and submit —
that's the whole setup step. The admin page validates the token against
Telegram's `getMe`, generates a random `webhookSecret` itself, and stores both
in the machine secret store as this box's `telegram-bot/<slug>` entry
(`docs/secrets.md`); there is no config file to create or edit by hand, and
nothing lands in the box tree. The chat ID is not needed either — it comes
with each incoming message and is included on outbound cards automatically.

## 5. Set up the webhook

Run wakeup to catch up on any messages and register the webhook:

```bash
bbx wakeup --connector telegram
```

This does three things:
1. Polls for any messages sent while the server was down
2. Registers the webhook URL (`$PUBLIC_URL/webhook/<box>/telegram`) with Telegram
3. Sends any pending outbound messages from `_bookkeeping/output/`

After this, new messages will be pushed to your server in real-time via the webhook.

## 6. Verify

1. Send a message in the Telegram group
2. Check that the message was appended to a `thread.chat-thread.card` under `_content/chat/telegram/`
3. The thread entry should contain the message text, sender name, and chat metadata

## Sending messages

To send a message to the Telegram chat, create a card in `_bookkeeping/output/`:

```yaml
---
status: pending
chat-id: "-1001234567890"
text: Hello from the box!
---
```

Save it with a `.telegram-message.card` extension, stage and commit, then run:

```bash
bbx wakeup --connector telegram
```

The connector sends the message and deletes the card. (There's no reply-to-message-id field currently — only a flat chat message.)

## What gets created

Each incoming Telegram message is appended as an entry on the chat's thread card:

```
_content/chat/telegram/Family_Group/
  thread.chat-thread.card
```

The thread card's frontmatter carries the chat metadata and its `entries` accumulate the messages:

```yaml
---
chat-id: "-1001234567890"
connector: telegram
description: Family Group
participants:
  - ref: /_content/people/alice.person.card
entries:
  - kind: message
    id: "456"
    sender: Alice
    sender-id: "789"
    time: 2026-02-26T13:00:00.000Z
    text: Hey dad, can you pick me up at 3?
---
```

## Notes

- The bot token is sensitive — it lives only in the machine secret store, never a box file
- `publicUrl` must be set in `_config/box.json` (e.g. `{"publicUrl": "https://box.example.com"}`) for the webhook to work
- The webhook URL must be HTTPS (Telegram requires it)
- The connector only processes text messages and captions on media. Photos/files without text are skipped.
- State is tracked in `_bookkeeping/connectors/telegram.state.json` (gitignored, auto-managed)
- If you need to reset, delete the state file and run `bbx wakeup --connector telegram` again
