# Telegram Connector

The Telegram connector syncs messages between Telegram and the box filesystem. It polls for missed messages, sets up webhooks, and sends outbound messages.

```ts setup
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { createFakeTelegram } from "../../src/services/telegram.js";
import { createTelegramConnector, processWebhookUpdate, extractMessage } from "../../src/connectors/telegram.js";
```

## extractMessage — basic field extraction

```ts
const update = {
  update_id: 1,
  message: {
    message_id: 100,
    date: 1700000000,
    chat: { id: 42, type: "private" },
    from: { id: 1, first_name: "Alice", last_name: "Smith", username: "alice" },
    text: "Hello!",
  },
};
const result = extractMessage(update);
result?.senderName
=> Alice Smith
```

```ts continue
result?.text
=> Hello!
```

## extractMessage — skips non-text updates

```ts
const update = { update_id: 2, message: {
  message_id: 101, date: 1700000000,
  chat: { id: 42, type: "private" },
} };
extractMessage(update)
=> null
```

## extractMessage — edited messages

```ts
const update = {
  update_id: 3,
  edited_message: {
    message_id: 102,
    date: 1700000000,
    chat: { id: 42, type: "private" },
    from: { id: 1, first_name: "Bob" },
    text: "Edited text",
  },
};
extractMessage(update)?.text
=> Edited text
```

## Webhook update processing

`processWebhookUpdate()` creates a thread file, appends the message, and commits:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");
const update = {
  update_id: 100,
  message: {
    message_id: 1,
    date: 1700000000,
    chat: { id: 555, type: "private" },
    from: { id: 10, first_name: "Alice" },
    text: "Hi from Telegram!",
  },
};
const result = await processWebhookUpdate({ boxRoot: box.root, update, skipJob: true });
const threadPath = result.threadRef;
threadPath
=> store/chat/telegram/Alice/thread.chat-thread.card
```

The thread file contains the message:

```ts continue
const content = await box.read(threadPath);
content.includes("Hi from Telegram!")
=> true
```

```ts continue
content.includes("sender: Alice")
=> true
```

```ts cleanup
await box.cleanup();
```

## Connector sync — polls updates and sets webhook

The full sync cycle: deletes webhook, polls for updates, re-sets webhook, checks outbound.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

// Write telegram config
await box.seed(
  "config/connectors/telegram.secret.json",
  JSON.stringify({ botToken: "fake:token", webhookSecret: "secret" }),
);
// Write box.json with publicUrl (needed for webhook setup)
await box.seed("config/box.json", JSON.stringify({ publicUrl: "https://example.com" }));
box.commitAll("add config");

const tg = createFakeTelegram({
  username: "test_bot",
  updates: [{
    update_id: 200,
    message: {
      message_id: 50,
      date: 1700000000,
      chat: { id: 777, type: "private" },
      from: { id: 20, first_name: "Bob" },
      text: "Missed message",
    },
  }],
});

const connector = createTelegramConnector(box.root, tg);
const result = await connector.sync();
result.success
=> true
```

The missed message was pulled into a thread:

```ts continue
result.created.length
=> 1
```

```ts continue
result.created[0]?.includes("Bob")
=> true
```

The webhook was set to the correct URL:

```ts continue
tg.webhookUrl
=> https://example.com/webhook/«*»/telegram
```

```ts cleanup
await box.cleanup();
```

## Connector sync — sends outbound messages

When a thread file has unsent agent messages, the connector sends them:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed(
  "config/connectors/telegram.secret.json",
  JSON.stringify({ botToken: "fake:token", webhookSecret: "secret" }),
);
await box.seed("config/box.json", JSON.stringify({ publicUrl: "https://example.com" }));

// Create a thread file with an unsent agent message
await box.seed(
  "store/chat/telegram/TestUser/thread.chat-thread.card",
  `---\ntype: chat-thread\nchat-id: "999"\nconnector: telegram\nentries:\n  - kind: message\n    sender: TestUser\n    time: "2024-01-01T00:00:00Z"\n    text: Hello\n  - kind: message\n    sender: agent\n    time: "2024-01-01T00:01:00Z"\n    text: Hi there!\n---\n`,
);
box.commitAll("add thread");

const tg = createFakeTelegram({ username: "test_bot" });
const connector = createTelegramConnector(box.root, tg);
const result = await connector.sync();
result.success
=> true
```

The agent message was sent:

```ts continue
tg.sent.length
=> 1
```

```ts continue
tg.sent[0]?.text
=> Hi there!
```

```ts continue
tg.sent[0]?.chatId
=> 999
```

```ts cleanup
await box.cleanup();
```
