# Web Push output cards (box/output/)

`sendOutputPushCards` implements the web-push card lifecycle: pending cards in
`box/output/` are delivered to the box's subscribed devices and deleted; cards
that reach no device are stamped `failed` and left in place (a durable, inspectable
artifact — never a silent drop). Endpoints reported gone are pruned.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as os from "node:os";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createFakePush } from "../../src/services/push.js";
import { sendOutputPushCards } from "../../src/connectors/push.js";
import { createWebPushTemplate } from "../../src/schemas/web-push.js";
import { addSubscription, endpointsForBox } from "../../src/core/push-subscriptions.js";

const storeDir = path.join(os.tmpdir(), `cb-push-conn-${process.pid}-${Date.now()}`);
process.env.CALLBACK_PUSH_STORE_DIR = storeDir;

const SUB = { endpoint: "https://push.example/dev1", keys: { p256dh: "p", auth: "a" } };
const GONE = { endpoint: "https://push.example/dead", keys: { p256dh: "p", auth: "a" } };
const NOW = new Date("2026-06-29T12:00:00Z");
```

## A delivered card is deleted and committed

```ts
const box = await makeTmpBox({ git: true });
const slug = path.basename(box.root);
await addSubscription({ boxSlug: slug, subscription: SUB, now: NOW });

await box.seed(
  "box/output/health.web-push.card",
  createWebPushTemplate({ title: "Health", body: "task overdue", url: `/${slug}/health` }),
);
box.commitAll("seed push outbox");

const push = createFakePush();
const sent = await sendOutputPushCards({ boxRoot: box.root, triggeredBy: "doctest", push });
JSON.stringify(sent)
=> ["box/output/health.web-push.card"]
```

```ts continue
JSON.stringify(await fs.readdir(path.join(box.root, "box/output")))
=> []
```

```ts continue
execSync("git log -1 --pretty=%s", { cwd: box.root, encoding: "utf-8" }).trim()
=> Web push outbox: deliver 1 push
```

```ts cleanup
await box.cleanup();
```

## A card reaching no device is stamped failed; gone endpoints are pruned

```ts
const box = await makeTmpBox({ git: true });
const slug = path.basename(box.root);
await addSubscription({ boxSlug: slug, subscription: GONE, now: NOW });

await box.seed(
  "box/output/alert.web-push.card",
  createWebPushTemplate({ title: "Alert", body: "hello", url: `/${slug}/` }),
);
box.commitAll("seed push outbox");

// The only endpoint is gone → nothing delivered → card stamped failed.
const push = createFakePush({ goneEndpoints: [GONE.endpoint] });
const sent = await sendOutputPushCards({ boxRoot: box.root, triggeredBy: "doctest", push });
JSON.stringify(sent)
=> []
```

```ts continue
const card = await fs.readFile(path.join(box.root, "box/output/alert.web-push.card"), "utf-8");
card.includes("status: failed") && card.includes("no devices received the push")
=> true
```

The gone endpoint was pruned from the store:

```ts continue
(await endpointsForBox(slug)).length
=> 0
```

A second pass skips the failed card — nothing delivered, nothing changes:

```ts continue
JSON.stringify(await sendOutputPushCards({ boxRoot: box.root, triggeredBy: "doctest", push }))
=> []
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
