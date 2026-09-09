# Telegram webhook ingest — transient-state deltas

`processWebhookUpdate` (`connectors/telegram-webhook.ts`) splits its
transient-state read-modify-write into two independent `updateTransientState`
calls, each a delta against FRESH state (Track 1): call 1 ingests the message
and persists any new chat mappings, then — after the git commits — call 2
advances `lastUpdateId` to `max(current, this update)`. The transient-state lock
is never held across the commits, so an interleaved catch-up poll and a webhook
can't clobber each other's progress.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { createFakeTelegram } from "../../src/services/telegram.js";
import { createTelegramConnector, processWebhookUpdate } from "../../src/connectors/telegram.js";
import { telegramSecretName } from "../../src/connectors/telegram-helpers.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";

/** Configure Telegram the only way it is configurable: a granted store entry. */
async function grantTelegram(box) {
  const slug = await boxSlug(box.root);
  const name = telegramSecretName(slug);
  await setSecret({ name, value: JSON.stringify({ botToken: "fake:token", webhookSecret: "secret" }) });
  await grantSecret({ slug, name, access: "server" });
}

async function seededBox() {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");
  await box.seed("_config/box.json", JSON.stringify({ publicUrl: "https://example.com" }));
  box.commitAll("add config");
  await grantTelegram(box);
  return box;
}

async function readState(box) {
  return JSON.parse(await box.read("_bookkeeping/connectors/telegram.state.json"));
}

function msgUpdate(opts) {
  return {
    update_id: opts.updateId,
    message: {
      message_id: opts.updateId,
      date: 1700000000,
      chat: { id: opts.chatId, type: "private" },
      from: { id: opts.chatId, first_name: opts.name },
      text: opts.text,
    },
  };
}
```

## Call 2 reads fresh state and takes the max — a late, older update can't rewind lastUpdateId

A catch-up poll may have already advanced `lastUpdateId` far past an update that
arrives late over the webhook. Because call 2 is a `max` delta against fresh
state, the older update leaves the offset untouched:

```ts
const box = await seededBox();
await box.seed(
  "_bookkeeping/connectors/telegram.state.json",
  JSON.stringify({ lastUpdateId: 500 }),
);
await processWebhookUpdate({ boxRoot: box.root, update: msgUpdate({ updateId: 100, chatId: 42, name: "Late", text: "late" }), skipJob: true });
(await readState(box)).lastUpdateId
=> 500
```

```ts continue
// A newer webhook update does advance it.
await processWebhookUpdate({ boxRoot: box.root, update: msgUpdate({ updateId: 600, chatId: 42, name: "Late", text: "newer" }), skipJob: true });
(await readState(box)).lastUpdateId
=> 600
```

```ts cleanup
await box.cleanup();
```

## Call 2 delta preserves a callback timer a concurrent op set

Advancing `lastUpdateId` is a delta (`{...fresh, lastUpdateId}`), not a
whole-object rewrite of a stale snapshot, so a `callbacks` entry written between
the webhook's ingest and its offset advance survives:

```ts
const box = await seededBox();
await box.seed(
  "_bookkeeping/connectors/telegram.state.json",
  JSON.stringify({ callbacks: { "_content/chat/telegram/Zoe/thread.chat-thread.card": { at: "2999-01-01T00:00:00Z" } } }),
);
await processWebhookUpdate({ boxRoot: box.root, update: msgUpdate({ updateId: 10, chatId: 42, name: "Ann", text: "hi" }), skipJob: true });
const state = await readState(box);
JSON.stringify({ lastUpdateId: state.lastUpdateId, keptTimer: Boolean(state.callbacks?.["_content/chat/telegram/Zoe/thread.chat-thread.card"]) })
=> {"lastUpdateId":10,"keptTimer":true}
```

```ts cleanup
await box.cleanup();
```

## Concurrent webhook + catch-up poll: neither update's progress is lost

A live webhook update (id 300) and a catch-up poll draining an earlier missed
update (id 250) run at the same time. The two lock-serialized delta-merges
compose: the final `lastUpdateId` is the max, and both chats get a mapping —
under the old single-snapshot save, one write would clobber the other.

```ts
const box = await seededBox();
const tg = createFakeTelegram({
  username: "bot",
  updates: [msgUpdate({ updateId: 250, chatId: 111, name: "Poll", text: "missed" })],
});
const connector = createTelegramConnector(box.root, tg);
const webhookUpdate = msgUpdate({ updateId: 300, chatId: 222, name: "Live", text: "live" });

await Promise.all([
  connector.sync(),
  processWebhookUpdate({ boxRoot: box.root, update: webhookUpdate, skipJob: true }),
]);

const state = await readState(box);
JSON.stringify({ lastUpdateId: state.lastUpdateId, chats: Object.keys(state.chatMappings ?? {}).sort() })
=> {"lastUpdateId":300,"chats":["111","222"]}
```

```ts cleanup
await box.cleanup();
```
