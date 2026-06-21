# Telegram output cards (box/output/)

`sendOutputCards` implements the lifecycle documented in the
telegram-message schema: pending cards in `box/output/` are sent and
deleted; cards that fail to send are stamped `failed` with the error
and left in place (not retried).

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createFakeTelegram } from "../../src/services/telegram.js";
import { sendOutputCards } from "../../src/connectors/telegram-output-cards.js";
import { createTelegramMessageTemplate } from "../../src/schemas/telegram-message.js";
```

## Pending cards are sent and deleted

```ts
const box = await makeTmpBox({ git: true });
await box.seed(
  "box/output/health-alert.telegram-message.card",
  createTelegramMessageTemplate({ chatId: "777", text: "check-email: failing ×3" }),
);
await box.seed(
  "box/output/already-failed.telegram-message.card",
  `---\nstatus: failed\nchat-id: "777"\ntext: old news\nerror: kaboom\n---\n`,
);
box.commitAll("seed outbox");

const tg = createFakeTelegram({ username: "test_bot" });
const sent = await sendOutputCards({ boxRoot: box.root, triggeredBy: "doctest", tg });
JSON.stringify(sent)
=> ["box/output/health-alert.telegram-message.card"]

JSON.stringify(tg.sent)
=> [{"chatId":"777","text":"check-email: failing ×3","messageId":1}]
```

The sent card is gone; the previously-failed card is untouched (failed
cards are never retried):

```ts continue
JSON.stringify(await fs.readdir(path.join(box.root, "box/output")))
=> ["already-failed.telegram-message.card"]
```

The deletion is committed:

```ts continue
execSync("git log -1 --pretty=%s", { cwd: box.root, encoding: "utf-8" }).trim()
=> Telegram outbox: send 1 telegram message
```

```ts cleanup
await box.cleanup();
```

## Send failures stamp the card instead of deleting it

```ts
const box = await makeTmpBox({ git: true });
await box.seed(
  "box/output/alert.telegram-message.card",
  createTelegramMessageTemplate({ chatId: "777", text: "hello" }),
);
box.commitAll("seed outbox");

const tg = createFakeTelegram({ username: "test_bot" });
const broken = { ...tg, sendMessage: async () => { throw new Error("403: bot was blocked by the user"); } };
const sent = await sendOutputCards({ boxRoot: box.root, triggeredBy: "doctest", tg: broken });
JSON.stringify(sent)
=> []

await fs.readFile(path.join(box.root, "box/output/alert.telegram-message.card"), "utf-8")
=> ---
status: failed
chat-id: "777"
text: hello
error: "403: bot was blocked by the user"
---
```

A second pass skips the failed card — nothing is sent, nothing changes:

```ts continue
JSON.stringify(await sendOutputCards({ boxRoot: box.root, triggeredBy: "doctest", tg }))
=> []

JSON.stringify(tg.sent)
=> []
```

```ts cleanup
await box.cleanup();
```
