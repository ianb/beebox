# Telegram Service — Fake Implementation

The fake Telegram service maintains an outbox of sent messages and a configurable inbox for polling, without touching the real Telegram API.

```ts setup
import { createFakeTelegram } from "../../src/services/telegram.js";
```

## Sending messages

`sendMessage()` appends to the `sent` outbox with auto-incrementing message IDs.

```ts
const tg = createFakeTelegram({ username: "bot" });
await tg.sendMessage(123, { text: "hello" });
await tg.sendMessage(123, { text: "world" });
await tg.sendMessage(456, { text: "different chat" });
tg.sent.length
=> 3
```

```ts continue
tg.sent.map(m => `${m.chatId}: ${m.text}`).join("\n")
=>
123: hello
123: world
456: different chat
```

## Message IDs auto-increment

```ts
const tg = createFakeTelegram({ username: "bot" });
const r1 = await tg.sendMessage(1, { text: "a" });
const r2 = await tg.sendMessage(1, { text: "b" });
`${r1.message_id}, ${r2.message_id}`
=> 1, 2
```

## Polling updates

Pre-loaded updates are drained by `getUpdates()`.

```ts
const tg = createFakeTelegram({
  username: "bot",
  updates: [
    { update_id: 100, message: { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text: "hi" } },
    { update_id: 101, message: { message_id: 2, date: 0, chat: { id: 1, type: "private" }, text: "there" } },
  ],
});

const batch = await tg.getUpdates();
batch.length
=> 2
```

```ts continue
// Updates are drained — second call returns empty
const empty = await tg.getUpdates();
empty.length
=> 0
```

## Offset filtering

Passing `offset` returns only updates with `update_id >= offset`.

```ts
const tg = createFakeTelegram({
  username: "bot",
  updates: [
    { update_id: 100, message: { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text: "old" } },
    { update_id: 200, message: { message_id: 2, date: 0, chat: { id: 1, type: "private" }, text: "new" } },
  ],
});

const batch = await tg.getUpdates({ offset: 200, limit: 100, timeout: 0 });
batch.length
=> 1
```

```ts continue
batch[0].message.text
=> new
```

