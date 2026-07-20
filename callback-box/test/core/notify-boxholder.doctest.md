# notifyBoxholder: per-channel fan-out

`notifyBoxholder` writes one durable output card per configured channel — a
`web-push` card when a device is subscribed, a `telegram-message` card when
`healthAlerts.telegramChat` is set. Each is delivered by its own connector at
`cb finalize`. Fan-out is at card-write time; the telegram path is untouched and
web push is its mirror.

```ts setup
import { boxSlug } from "../../src/lib/box-slug.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { notifyBoxholder } from "../../src/core/notify-boxholder.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";

const storeDir = path.join(os.tmpdir(), `cb-notify-${process.pid}-${Date.now()}`);
process.env.CALLBACK_PUSH_STORE_DIR = storeDir;

const NOW = new Date("2026-06-29T12:00:00Z");
const SUB = { endpoint: "https://push.example/d1", keys: { p256dh: "p", auth: "a" } };

async function outputCards(box) {
  const files = await fs.readdir(path.join(box.root, "box/output")).catch(() => []);
  return files.map((f) => f.replace(/^notify-[^.]+\./, "")).toSorted();
}

const INPUT = { title: "Hi", body: "something happened", url: "/box/", now: NOW };
```

## No channel configured → nothing written

```ts
const box = await makeTmpBox({ git: true });
const r = await notifyBoxholder(box.root, INPUT);
JSON.stringify([r.channels, await outputCards(box)])
=> [[],[]]
```

```ts cleanup
await box.cleanup();
```

## Telegram only → one telegram card

```ts
const box = await makeTmpBox({ git: true });
await box.seed("config/box.json", JSON.stringify({ healthAlerts: { telegramChat: "777" } }));
box.commitAll("seed");

const r = await notifyBoxholder(box.root, INPUT);
JSON.stringify([r.channels, await outputCards(box)])
=> [["telegram"],["telegram-message.card"]]
```

```ts cleanup
await box.cleanup();
```

## Subscribed device only → one web-push card

```ts
const box = await makeTmpBox({ git: true });
await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: NOW });

const r = await notifyBoxholder(box.root, INPUT);
JSON.stringify([r.channels, await outputCards(box)])
=> [["web-push"],["web-push.card"]]
```

```ts cleanup
await box.cleanup();
```

## Both configured → both cards

```ts
const box = await makeTmpBox({ git: true });
await box.seed("config/box.json", JSON.stringify({ healthAlerts: { telegramChat: "777" } }));
box.commitAll("seed");
await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: NOW });

const r = await notifyBoxholder(box.root, INPUT);
JSON.stringify([r.channels.toSorted(), await outputCards(box)])
=> [["telegram","web-push"],["telegram-message.card","web-push.card"]]
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
