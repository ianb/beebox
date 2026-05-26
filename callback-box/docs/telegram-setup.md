# Telegram Connector Setup

The Telegram connector lets you connect a Telegram group chat (or private chat) to your box. Incoming messages become memo cards in your inbox; outbound messages are sent from output cards.

## How it works

- **Inbound (real-time):** Telegram pushes messages to a webhook on your server. Each message becomes a memo card in `box/inbox/telegram/`.
- **Inbound (catch-up):** On `cb wakeup`, the connector polls for any messages missed while the server was down, then re-establishes the webhook.
- **Outbound:** Create a `telegram-message.card` in `box/output/` and run `cb wakeup --connector telegram`. The connector sends it and deletes the card.

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

Create the secret config file in your box:

### `config/connectors/telegram.secret.json`

```json
{
  "botToken": "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ",
  "webhookSecret": "pick-a-random-string-here"
}
```

The chat ID is not needed in the config — it comes with each incoming message and is included on outbound cards automatically.

The `webhookSecret` can be any random string — it's used to verify that webhook requests actually come from Telegram. Generate one with:

```bash
openssl rand -hex 32
```

This file is gitignored by the `*.secret.*` pattern.

## 5. Set up the webhook

Run wakeup to catch up on any messages and register the webhook:

```bash
cb wakeup --connector telegram
```

This does three things:
1. Polls for any messages sent while the server was down
2. Registers the webhook URL (`$PUBLIC_URL/webhook/<box>/telegram`) with Telegram
3. Sends any pending outbound messages from `box/output/`

After this, new messages will be pushed to your server in real-time via the webhook.

## 6. Verify

1. Send a message in the Telegram group
2. Check that a memo card appeared in `box/inbox/telegram/`
3. The card should contain the message text, sender name, and chat metadata

## Sending messages

To send a message to the Telegram chat, create a card in `box/output/`:

```xml
<telegram-message status="pending" chat-id="-1001234567890">
<text>Hello from the box!</text>
</telegram-message>
```

Save it with a `.telegram-message.card` extension, stage and commit, then run:

```bash
cb wakeup --connector telegram
```

The connector sends the message and deletes the card.

To reply to a specific message, add a `<reply-to>` element with the message ID:

```xml
<telegram-message status="pending" chat-id="-1001234567890">
<text>Got it, thanks!</text>
<reply-to>12345</reply-to>
</telegram-message>
```

## What gets created

Each incoming Telegram message becomes a memo card:

```
box/inbox/telegram/
  Alice_2026-02-26T13-00-00.memo.card
  Bob_2026-02-26T13-05-00.memo.card
```

The memo cards include Telegram metadata on the `<context>` element:

```xml
<memo status="new">
<created>2026-02-26T13:00:00.000Z</created>
<content>Hey dad, can you pick me up at 3?</content>
<source>telegram</source>
<context telegram-chat-id="-1001234567890"
telegram-message-id="456"
telegram-sender="Alice"
telegram-sender-id="789">Family Group</context>
</memo>
```

## Notes

- The bot token is sensitive — keep it in the `.secret.json` file
- `publicUrl` must be set in `config/box.json` (e.g. `{"publicUrl": "https://box.example.com"}`) for the webhook to work
- The webhook URL must be HTTPS (Telegram requires it)
- The connector only processes text messages and captions on media. Photos/files without text are skipped.
- State is tracked in `config/connectors/telegram.state.json` (gitignored, auto-managed)
- If you need to reset, delete the state file and run `cb wakeup --connector telegram` again
