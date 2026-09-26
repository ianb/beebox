# notifications and presence routers

`notifications.recent` and `notifications.get` read the notification log for
the Admin "Recent" list and the `chat:new` banner. `presence.heartbeat` is the
open tab's report that a person is using it; the server keeps
`.beebox/presence.json` current from those heartbeats, and `livePresence` (what
`notifyBoxholder` reads) sees the count.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { notifyBoxholder } from "../../src/core/notify-boxholder.js";
import { livePresence } from "../../src/core/notification/presence.js";

const storeDir = path.join(os.tmpdir(), `bbx-notifications-router-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;

const box = await makeTmpBox({ git: true });

function caller(over) {
  return appRouter.createCaller({
    boxRoot: box.root,
    boxSlug: "alpha",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: true,
    isAuthenticatedOwner: true,
    ...over,
  });
}

async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    return `THREW:${e.code}`;
  }
}
```

## recent: intents with their deliveries, newest first

The box has no channel configured, so each channel is logged `no-audience`.

```ts
const first = await notifyBoxholder(box.root, {
  intent: { title: "Field trip form due", body: "Sign by Friday.", target: { kind: "dashboard" }, loudness: "loud", source: "doctest" },
});
const second = await notifyBoxholder(box.root, {
  intent: { title: "Talk about the trip?", body: "", target: { kind: "chat-new" }, loudness: "quiet", source: "doctest" },
});
const recent = await caller({}).notifications.recent({ days: 3 });
recent.map((n) => `${n.intent.title}: ${n.deliveries.map((d) => `${d.channel} ${d.status} ${d.detail}`).join(", ")}`).join("\n")
=>
Talk about the trip?: apns skipped no-audience, web-push skipped no-audience, telegram skipped no-audience
Field trip form due: apns skipped no-audience, web-push skipped no-audience, telegram skipped no-audience
```

## get: one intent by id; null for an unknown id

A `chat:new` tap carries the id, and the chat page shows the intent. An id the
log no longer has (rotated away) is null, not an error.

```ts continue
const got = await caller({}).notifications.get({ id: second.id });
JSON.stringify([got?.intent.title, got?.intent.target])
=> ["Talk about the trip?","chat:new"]

await caller({}).notifications.get({ id: "no-such-id" })
=> null
```

## Both routers need an authenticated request

```ts continue
await attempt(() => caller({ authed: false }).notifications.recent({}))
=> THREW:UNAUTHORIZED

await attempt(() => caller({ authed: false }).presence.heartbeat({ sessionId: "tab-aaaaaaaa" }))
=> THREW:UNAUTHORIZED
```

## heartbeat: each tab counts once, and the file reflects it

```ts continue
await caller({}).presence.heartbeat({ sessionId: "tab-aaaaaaaa" });
await caller({}).presence.heartbeat({ sessionId: "tab-bbbbbbbb" });
await caller({}).presence.heartbeat({ sessionId: "tab-aaaaaaaa" });
JSON.stringify(await livePresence(box.root))
=> {"activeWeb":2}
```

A malformed session id is rejected:

```ts continue
await attempt(() => caller({}).presence.heartbeat({ sessionId: "x" }))
=> THREW:BAD_REQUEST
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
