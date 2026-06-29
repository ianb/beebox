# push.subscribe / disable / vapidPublicKey

The `push` tRPC router records a browser subscription in the server-level store
under the request's box slug (`subscribe`), removes it from that box
(`disable`), and exposes the VAPID public key for the frontend
(`vapidPublicKey`). The store is keyed by endpoint, so the same browser
subscribing under two boxes is stored once with both opt-ins.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { endpointsForBox } from "../../src/core/push-subscriptions.js";

const storeDir = path.join(os.tmpdir(), `cb-push-router-${process.pid}-${Date.now()}`);
process.env.CALLBACK_PUSH_STORE_DIR = storeDir;
delete process.env.CB_VAPID_PUBLIC_KEY;

function caller(boxSlug) {
  const ctx = {
    boxRoot: "/unused",
    boxSlug,
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}

const SUB = { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } };
```

## subscribe records the endpoint under the box; idempotent on re-subscribe

```ts
await caller("alpha").push.subscribe(SUB);
await caller("alpha").push.subscribe(SUB);
(await endpointsForBox("alpha")).length
=> 1
```

## Same endpoint under a second box is stored once with both opt-ins

```ts continue
await caller("beta").push.subscribe(SUB);
const a = await endpointsForBox("alpha");
const b = await endpointsForBox("beta");
JSON.stringify([a.length, b.length, a[0]?.endpoint === b[0]?.endpoint])
=> [1,1,true]
```

## disable removes it from one box only

```ts continue
await caller("alpha").push.disable({ endpoint: SUB.endpoint });
JSON.stringify([(await endpointsForBox("alpha")).length, (await endpointsForBox("beta")).length])
=> [0,1]
```

## vapidPublicKey reports null when the server has no VAPID key

```ts continue
JSON.stringify(await caller("alpha").push.vapidPublicKey())
=> {"publicKey":null}
```

```ts cleanup
await fs.rm(storeDir, { recursive: true, force: true });
```
