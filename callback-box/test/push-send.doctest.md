# push-send: server-level subscription store + sender

Web Push subscriptions are stored once, server-wide, keyed by endpoint, with
each record carrying the box slugs that endpoint opted into (a PushSubscription
is bound to its SW registration, not a box). `sendPush` delivers to the
endpoints opted into a box and prunes any the push service reports gone —
pruning removes the endpoint from *every* box at once. See
`docs/plans/web-push-notifications.md` (Track B).

```ts setup
import { boxSlug } from "../src/lib/box-slug.js";
import { addSubscription, endpointsForBox } from "../src/core/push-subscriptions.js";
import { sendPush } from "../src/core/send-push.js";
import { createFakePush } from "../src/services/push.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

// Isolate the server-level store in a temp dir for this test file.
const storeDir = path.join(os.tmpdir(), `cb-push-store-${process.pid}-${Date.now()}`);
process.env.CALLBACK_PUSH_STORE_DIR = storeDir;

const SUB_A = { endpoint: "https://push.example/a", keys: { p256dh: "pa", auth: "aa" } };
const SUB_B = { endpoint: "https://push.example/b", keys: { p256dh: "pb", auth: "ab" } };
const NOW = new Date("2026-06-29T12:00:00Z");
```

## Same endpoint under two boxes is stored once

```ts
const box = await makeTmpBox();
const slug = await boxSlug(box.root);

await addSubscription({ boxSlug: slug, subscription: SUB_A, now: NOW });
await addSubscription({ boxSlug: "other", subscription: SUB_A, now: NOW });

const forSlug = await endpointsForBox(slug);
const forOther = await endpointsForBox("other");
JSON.stringify([forSlug.length, forOther.length, forSlug[0]?.endpoint === forOther[0]?.endpoint])
=> [1,1,true]
```

## sendPush delivers healthy endpoints and prunes gone ones

```ts continue
await addSubscription({ boxSlug: slug, subscription: SUB_B, now: NOW });
const fake = createFakePush({ goneEndpoints: [SUB_A.endpoint] });
const result = await sendPush(box.root, {
  payload: { title: "Health", body: "task overdue", url: `/${slug}/health` },
  push: fake,
});
JSON.stringify(result)
=> {"sent":1,"pruned":1,"failed":0}
```

## Pruning removed the endpoint from every box, and only B was delivered

```ts continue
const stillOther = await endpointsForBox("other");
fake.describe()
=> FakePush: 1 sent
  https://push.example/b → Health: task overdue
```

```ts continue
stillOther.length
=> 0
```

## A payload-only debug line was written (no endpoints or keys)

```ts continue
const log = await fs.readFile(path.join(box.root, ".callback-box", "push-debug.log"), "utf-8");
const entry = JSON.parse(log.trim());
JSON.stringify([entry.title, entry.sent, entry.pruned, entry.body, entry.endpoint ?? "no-endpoint-field"])
=> ["Health",1,1,"task overdue","no-endpoint-field"]
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
