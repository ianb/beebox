# capture.resumableSessions: still-open captures a returning client may resume

The `capture.resumableSessions` tRPC query lists staging sessions that are still
`open` and non-empty — a capture a crash or navigation left mid-flight — matched
either by the chat capture was started from (`targetSessionId`) or by the exact
session id the client still holds in localStorage (`clientSessionId`). Sealed /
delivering / delivered / empty sessions are never resumable.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createStagingSession, addPhoto, setStagingState } from "../../src/core/capture/staging-store.js";

function caller(boxRoot, user = null) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user,
  };
  return appRouter.createCaller(ctx);
}

async function addPhotoTo(boxRoot, id) {
  await addPhoto({ boxRoot, id, filename: "photo-001.jpg", capturedAt: "2026-07-09T14:00:00.000Z", source: "camera-user", buffer: Buffer.from("IMG") });
}
```

## Open + non-empty sessions are resumable; sealed/empty ones are not

```ts
const box = await makeTmpBox();

// r1: open, has a photo, bound to chat-1 → resumable by targetSessionId.
const r1 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });
await addPhotoTo(box.root, r1.id);

// r2: open, has a photo, but standalone (targetSessionId null) → resumable only
// by its own id (the localStorage belt-and-braces path).
const r2 = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
await addPhotoTo(box.root, r2.id);

// e1: open but EMPTY (bare create, no media) → not resumable.
const e1 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });

// s1: has media but already sealed (finalized) → not resumable.
const s1 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });
await addPhotoTo(box.root, s1.id);
await setStagingState({ boxRoot: box.root, id: s1.id, state: "sealed" });

// Matching by chat id returns only the open+non-empty one for chat-1.
const byChat = await caller(box.root).capture.resumableSessions({ targetSessionId: "chat-1", clientSessionId: null });
byChat.resumable.map((r) => r.id).join(",") === r1.id
=> true
```

The resumable entry carries the media counts (so the client can seed its upload
indices) and the start time:

```ts continue
JSON.stringify(byChat.resumable[0].counts)
=> {"photos":1,"files":0,"audioSegments":0}

typeof byChat.resumable[0].startedAt
=> string
```

The standalone open session is found by its client-held id, not by any chat:

```ts continue
const byId = await caller(box.root).capture.resumableSessions({ targetSessionId: null, clientSessionId: r2.id });
byId.resumable.map((r) => r.id).join(",") === r2.id
=> true
```

Neither the empty session nor the sealed session is ever offered:

```ts continue
const all = await caller(box.root).capture.resumableSessions({ targetSessionId: "chat-1", clientSessionId: s1.id });
[all.resumable.some((r) => r.id === e1.id), all.resumable.some((r) => r.id === s1.id)].join(",")
=> false,false
```

```ts cleanup
await box.cleanup();
```

## A capture is only resumable by the user who started it (X4)

`createdBy` scopes resume: a session Priya started is never offered to Tomas or
to an unauthenticated caller — even when they present the right chat id or the
exact staging id (a shared browser's stale localStorage). `null` matches `null`,
so legacy (unattributed) sessions stay resumable only by an unauthenticated
caller.

```ts
const box = await makeTmpBox();

// Priya starts a capture bound to chat-A.
const p = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-A", createdBy: "priya@marlowe.example" });
await addPhotoTo(box.root, p.id);

// Priya (matching createdBy) sees it.
const asPriya = await caller(box.root, { email: "priya@marlowe.example", name: "Priya" })
  .capture.resumableSessions({ targetSessionId: "chat-A", clientSessionId: p.id });
asPriya.resumable.map((r) => r.id).join(",") === p.id
=> true
```

Tomas — presenting the same chat id AND the same staging id — gets nothing:

```ts continue
const asTomas = await caller(box.root, { email: "tomas@marlowe.example", name: "Tomas" })
  .capture.resumableSessions({ targetSessionId: "chat-A", clientSessionId: p.id });
asTomas.resumable.length
=> 0
```

An unauthenticated caller (no user) also gets nothing — `null` ≠ Priya:

```ts continue
const asAnon = await caller(box.root)
  .capture.resumableSessions({ targetSessionId: "chat-A", clientSessionId: p.id });
asAnon.resumable.length
=> 0
```

```ts cleanup
await box.cleanup();
```

## No open captures → empty list

```ts
const box = await makeTmpBox();
const { resumable } = await caller(box.root).capture.resumableSessions({ targetSessionId: "chat-none", clientSessionId: null });
resumable.length
=> 0
```

```ts cleanup
await box.cleanup();
```
