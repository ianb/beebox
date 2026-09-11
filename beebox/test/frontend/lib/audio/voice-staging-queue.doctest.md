# The voice-staging queue's shell: enqueue, drain, status

`createVoiceStagingQueue` (`lib/audio/voice-staging-queue.ts`) wires the pure
core (`nextDrainStep`) to storage and a `send` function. These examples inject
an in-memory storage (`voice-staging-storage.ts`'s in-memory implementation —
Node has no `indexedDB`, and this repo doesn't add a polyfill for it) and a
fake `send`, so the real queue's enqueue → persist → drain → status/failure
reporting runs end to end with no network and no browser globals.

```ts setup
import { createVoiceStagingQueue } from "../../../../src/frontend/src/lib/audio/voice-staging-queue.js";
import { createInMemoryVoiceStagingStorage } from "../../../../src/frontend/src/lib/audio/voice-staging-storage.js";

/** A `send` whose outcome per (recordingId, seq) is scripted call-by-call. */
function fakeTransport(script: Record<string, Array<"success" | "transient" | "terminal">>) {
  const calls: string[] = [];
  const send = async (op: { recordingId: string; seq: number; payload: { kind: string } }) => {
    const key = `${op.recordingId}#${String(op.seq)}`;
    calls.push(`${key}:${op.payload.kind}`);
    const outcomes = script[key] ?? ["success"];
    const outcome = outcomes.length > 1 ? outcomes.shift() : outcomes[0];
    if (outcome === "success") return { kind: "success" as const };
    if (outcome === "transient") return { kind: "transient" as const, error: new Error("502") };
    return { kind: "terminal" as const, error: new Error("409 conflict") };
  };
  return { send, calls };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let now = 1000;
```

## Enqueue is synchronous; success drains the queue and clears status

```ts
const transport = fakeTransport({});
const queue = createVoiceStagingQueue({
  storage: createInMemoryVoiceStagingStorage(),
  persistent: true,
  send: transport.send,
  apiBase: () => "http://box.example/api",
  now: () => now,
});

queue.enqueueCreate("r1", { targetSessionId: "s1" });
queue.pendingChunkCount("r1")
=> 0

queue.enqueueChunk("r1", new ArrayBuffer(4));
queue.enqueueChunk("r1", new ArrayBuffer(4));
queue.pendingChunkCount("r1")
=> 2
```

Draining is async (each send is a microtask); after it settles, everything
sent successfully is gone and the finalize op knows the chunk count the queue
assigned on its own:

```ts continue
queue.enqueueFinalize("r1", { hq: null });
await flushMicrotasks();

queue.getStatusSnapshot().has("r1")
=> false

transport.calls.join(",")
=> r1#0:create,r1#1:chunk,r1#2:chunk,r1#3:finalize
```

## A transient failure retries, then succeeds

```ts
const transport2 = fakeTransport({ "r2#0": ["transient", "success"] });
const queue2 = createVoiceStagingQueue({
  storage: createInMemoryVoiceStagingStorage(),
  persistent: true,
  send: transport2.send,
  apiBase: () => "http://box.example/api",
  now: () => now,
});

queue2.enqueueCreate("r2", { targetSessionId: "s1" });
await flushMicrotasks();
queue2.getStatusSnapshot().get("r2").queuedOps
=> 1
```

Advancing time past the first retry delay and waking the drainer lands the
second (successful) attempt:

```ts continue
now += 2000;
queue2.wake();
await flushMicrotasks();

queue2.getStatusSnapshot().has("r2")
=> false

transport2.calls.join(",")
=> r2#0:create,r2#0:create
```

## A terminal failure drops the whole recording and reports it

```ts
const transport3 = fakeTransport({ "r3#1": ["terminal"] });
const queue3 = createVoiceStagingQueue({
  storage: createInMemoryVoiceStagingStorage(),
  persistent: true,
  send: transport3.send,
  apiBase: () => "http://box.example/api",
  now: () => now,
});

queue3.enqueueCreate("r3", { targetSessionId: "s1" });
queue3.enqueueChunk("r3", new ArrayBuffer(4));
queue3.enqueueFinalize("r3", { hq: null });
await flushMicrotasks();
```

Its ops are gone, but the status store keeps a terminal note against the
recording id, so the UI can still show why it stopped:

```ts continue
JSON.stringify(queue3.getStatusSnapshot().get("r3"))
=> {"queuedOps":0,"lastError":"409 conflict","terminal":true}

const failure = queue3.getFailuresSnapshot()[0];
JSON.stringify({ recordingId: failure.recordingId, message: failure.message })
=> {"recordingId":"r3","message":"409 conflict"}
```

The finalize op that would have followed the rejected chunk never sends —
the whole recording was dropped:

```ts continue
transport3.calls.join(",")
=> r3#0:create,r3#1:chunk
```

## A discard of an unknown session is success — nothing to report

The transport classifies a 404 as success before the core ever sees it, so a
discard for a session the box already forgot resolves silently.

```ts
const transport4 = fakeTransport({});
const queue4 = createVoiceStagingQueue({
  storage: createInMemoryVoiceStagingStorage(),
  persistent: true,
  send: transport4.send,
  apiBase: () => "http://box.example/api",
  now: () => now,
});
queue4.enqueueDiscard("r4");
await flushMicrotasks();

JSON.stringify({ pending: queue4.getStatusSnapshot().has("r4"), failures: queue4.getFailuresSnapshot().length })
=> {"pending":false,"failures":0}
```

## Recordings drain oldest-first

```ts
const transport5 = fakeTransport({});
const queue5 = createVoiceStagingQueue({
  storage: createInMemoryVoiceStagingStorage(),
  persistent: true,
  send: transport5.send,
  apiBase: () => "http://box.example/api",
  now: () => now,
});
queue5.enqueueCreate("older", { targetSessionId: "s1" });
now += 100;
queue5.enqueueCreate("newer", { targetSessionId: "s1" });
await flushMicrotasks();

transport5.calls.join(",")
=> older#0:create,newer#0:create
```

## The status store is `useSyncExternalStore`-compatible

```ts
const transport6 = fakeTransport({});
const queue6 = createVoiceStagingQueue({
  storage: createInMemoryVoiceStagingStorage(),
  persistent: true,
  send: transport6.send,
  apiBase: () => "http://box.example/api",
  now: () => now,
});
let notified = 0;
const unsubscribe = queue6.subscribeStatus(() => { notified += 1; });
queue6.enqueueCreate("r6", { targetSessionId: "s1" });
notified > 0
=> true

unsubscribe();
```

## A chunk enqueued after finalize is refused, not silently mis-sequenced

`enqueueFinalize` snapshots the chunk count it assigned so far. A caller that
(by mistake) enqueues one more chunk afterward would otherwise corrupt that
count; the queue refuses the late chunk instead.

```ts
const transport7 = fakeTransport({});
const queue7 = createVoiceStagingQueue({
  storage: createInMemoryVoiceStagingStorage(),
  persistent: true,
  send: transport7.send,
  apiBase: () => "http://box.example/api",
  now: () => now,
});
queue7.enqueueCreate("r7", { targetSessionId: "s1" });
queue7.enqueueChunk("r7", new ArrayBuffer(4));
queue7.enqueueFinalize("r7", { hq: null });
queue7.pendingChunkCount("r7")
=> 1

queue7.enqueueChunk("r7", new ArrayBuffer(4));
queue7.pendingChunkCount("r7")
=> 1
```

```ts continue
await flushMicrotasks();
transport7.calls.join(",")
=> r7#0:create,r7#1:chunk,r7#2:finalize
```

## A stuck recording's backoff survives another recording succeeding

Two recordings can each be mid-drain at once across a merge from storage
(two tabs, or a resumed drainer). An older recording's transient failure
must keep its own wait even after a different, older-still recording's op is
merged in and succeeds in between — a single shared "last outcome" would let
that unrelated success wipe `stuck`'s backoff and cause an immediate,
un-backed-off resend. `urgent` is planted directly in storage (simulating an
op a second tab already had queued, older than anything this queue has
enqueued itself) so it merges in via `loadPersisted` — the reachable path for
this race, since strict oldest-first ordering otherwise never lets a merely
*newer* recording jump ahead of one already mid-backoff.

```ts
const storage8 = createInMemoryVoiceStagingStorage();
storage8.put({
  apiBase: "http://box.example/api",
  recordingId: "urgent",
  seq: 0,
  payload: { kind: "create", targetSessionId: "s1" },
  createdAt: 0,
  attempts: 0,
});
const transport8 = fakeTransport({ "stuck#0": ["transient", "success"] });
const queue8 = createVoiceStagingQueue({
  storage: storage8,
  persistent: true,
  send: transport8.send,
  apiBase: () => "http://box.example/api",
  now: () => now,
});
queue8.enqueueCreate("stuck", { targetSessionId: "s1" });
await flushMicrotasks();
```

`stuck` failed once and is backing off; `urgent` (older than `stuck`, merged
in mid-drain) was sent and succeeded in between — and `stuck`'s backoff is
untouched:

```ts continue
transport8.calls.join(",")
=> stuck#0:create,urgent#0:create

queue8.getStatusSnapshot().get("stuck").queuedOps
=> 1
```

Waking the drainer again immediately still finds `stuck` too soon to retry —
`urgent`'s success did not clear its wait:

```ts continue
queue8.wake();
await flushMicrotasks();
transport8.calls.join(",")
=> stuck#0:create,urgent#0:create
```

Only once real backoff time has passed does `stuck` retry and succeed:

```ts continue
now += 5000;
queue8.wake();
await flushMicrotasks();

queue8.getStatusSnapshot().has("stuck")
=> false

transport8.calls.join(",")
=> stuck#0:create,urgent#0:create,stuck#0:create
```
