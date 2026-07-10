# capture.pendingSessions: server-derived in-flight captures for a chat

The `capture.pendingSessions` tRPC query lists the staging sessions bound to a
chat that are sealed-but-not-yet-delivered (or failed and retryable), so the chat
can render a pending capture bubble that survives reload. It reads the on-disk
staging manifests via `listStagingSessions` and filters with `selectPendingCaptures`
— `open` (still capturing) and `delivered` (done, cleaned up) sessions are excluded.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createStagingSession, addPhoto, setStagingState } from "../../src/core/capture/staging-store.js";

// Minimal tRPC context — pendingSessions only reads ctx.boxRoot.
function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}
```

## Only sealed/preparing/failed sessions for the chat are returned

```ts
const box = await makeTmpBox();

// s1: bound to chat-1, one photo, mid-preparation → pending.
const s1 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1" });
await addPhoto({ boxRoot: box.root, id: s1.id, filename: "photo-001.jpg", capturedAt: "2026-07-09T14:00:00.000Z", source: "camera-user", buffer: Buffer.from("IMG") });
await setStagingState({ boxRoot: box.root, id: s1.id, state: "preparing" });

// s2: bound to chat-1 but still open (capture mode live) → NOT pending.
const s2 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1" });

// s3: bound to chat-1 but already delivered → NOT pending.
const s3 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1" });
await setStagingState({ boxRoot: box.root, id: s3.id, state: "delivered" });

// s4: bound to chat-1, delivery failed → pending (retryable).
const s4 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1" });
await setStagingState({ boxRoot: box.root, id: s4.id, state: "failed:deliver" });

// s5: bound to a different chat → excluded from chat-1's list.
const s5 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-2" });
await setStagingState({ boxRoot: box.root, id: s5.id, state: "preparing" });

const { pending } = await caller(box.root).capture.pendingSessions({ sessionId: "chat-1" });
pending.map((p) => p.state).join(",")
=> preparing,failed:deliver
```

The pending entries carry each capture's media counts and start time:

```ts continue
JSON.stringify(pending.map((p) => ({ state: p.state, counts: p.counts })))
=> [{"state":"preparing","counts":{"photos":1,"files":0,"audioSegments":0}},{"state":"failed:deliver","counts":{"photos":0,"files":0,"audioSegments":0}}]

typeof pending[0].startedAt
=> string
```

The other chat sees only its own capture:

```ts continue
const other = await caller(box.root).capture.pendingSessions({ sessionId: "chat-2" });
other.pending.map((p) => p.state).join(",")
=> preparing
```

```ts cleanup
await box.cleanup();
```

## A chat with no staging sessions returns an empty list

```ts
const box = await makeTmpBox();
const { pending } = await caller(box.root).capture.pendingSessions({ sessionId: "chat-none" });
pending.length
=> 0
```

```ts cleanup
await box.cleanup();
```
