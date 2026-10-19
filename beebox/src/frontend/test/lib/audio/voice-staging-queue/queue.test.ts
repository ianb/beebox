// # The voice-staging queue's shell: enqueue, drain, status
//
// `createVoiceStagingQueue` (`lib/audio/voice-staging-queue.ts`) wires the pure
// core (`nextDrainStep`) to storage and a `send` function. These examples inject
// an in-memory storage (`voice-staging-storage.ts`'s in-memory implementation —
// Node has no `indexedDB`, and this repo doesn't add a polyfill for it) and a
// fake `send`, so the real queue's enqueue → persist → drain → status/failure
// reporting runs end to end with no network and no browser globals.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { createVoiceStagingQueue } from "../../../../src/lib/audio/voice-staging-queue/queue.js";
import { createInMemoryVoiceStagingStorage } from "../../../../src/lib/audio/voice-staging-queue/voice-staging-storage.js";

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

/** A persistent in-memory queue wired to a scripted transport. */
function makeQueue(opts: { script?: Record<string, Array<"success" | "transient" | "terminal">>; storage?: ReturnType<typeof createInMemoryVoiceStagingStorage> }) {
  const transport = fakeTransport(opts.script ?? {});
  const queue = createVoiceStagingQueue({
    storage: opts.storage ?? createInMemoryVoiceStagingStorage(),
    persistent: true,
    send: transport.send,
    apiBase: () => "http://box.example/api",
    now: () => now,
  });
  return { queue, transport };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let now = 1000;

// ## Enqueue is synchronous; success drains the queue and clears status
void test("Enqueue is synchronous; success drains the queue and clears status", async (t) => {
  const { queue, transport } = makeQueue({});

  queue.enqueueCreate("r1", { targetSessionId: "s1" });
  t.check(queue.pendingChunkCount("r1"), 0);

  queue.enqueueChunk("r1", new ArrayBuffer(4));
  queue.enqueueChunk("r1", new ArrayBuffer(4));
  t.check(queue.pendingChunkCount("r1"), 2);

  // Draining is async (each send is a microtask); after it settles, everything
  // sent successfully is gone and the finalize op knows the chunk count the queue
  // assigned on its own:

  queue.enqueueFinalize("r1", { emissionId: null, hq: null });
  await flushMicrotasks();

  t.check([...queue.getStatusSnapshot()], []);

  t.check(transport.calls, ["r1#0:create", "r1#1:chunk", "r1#2:chunk", "r1#3:finalize"]);
});

// ## A transient failure retries, then succeeds
void test("A transient failure retries, then succeeds", async (t) => {
  const { queue: queue2, transport: transport2 } = makeQueue({ script: { "r2#0": ["transient", "success"] } });

  queue2.enqueueCreate("r2", { targetSessionId: "s1" });
  await flushMicrotasks();
  t.check(queue2.getStatusSnapshot().get("r2"), { queuedOps: 1 });

  // Advancing time past the first retry delay and waking the drainer lands the
  // second (successful) attempt:

  now += 2000;
  queue2.wake();
  await flushMicrotasks();

  t.check([...queue2.getStatusSnapshot()], []);

  t.check(transport2.calls, ["r2#0:create", "r2#0:create"]);
});

// ## A terminal failure drops the whole recording and reports it
void test("A terminal failure drops the whole recording and reports it", async (t) => {
  const { queue: queue3, transport: transport3 } = makeQueue({ script: { "r3#1": ["terminal"] } });

  queue3.enqueueCreate("r3", { targetSessionId: "s1" });
  queue3.enqueueChunk("r3", new ArrayBuffer(4));
  queue3.enqueueFinalize("r3", { emissionId: null, hq: null });
  await flushMicrotasks();

  // Its ops are gone, but the status store keeps a terminal note against the
  // recording id, so the UI can still show why it stopped:

  t.check(queue3.getStatusSnapshot().get("r3"), {
    queuedOps: 0,
    lastError: "409 conflict",
    terminal: true,
  });

  t.check(queue3.getFailuresSnapshot(), [{ recordingId: "r3", message: "409 conflict", at: 3000 }]);

  // The finalize op that would have followed the rejected chunk never sends —
  // the whole recording was dropped.
  t.check(transport3.calls, ["r3#0:create", "r3#1:chunk"]);
});

// ## A discard of an unknown session is success — nothing to report
//
// The transport classifies a 404 as success before the core ever sees it, so a
// discard for a session the box already forgot resolves silently.
void test("The transport classifies a 404 as success before the core ever sees it, so a...", async (t) => {
  const { queue: queue4 } = makeQueue({});
  queue4.enqueueDiscard("r4");
  await flushMicrotasks();

  t.check({ pending: [...queue4.getStatusSnapshot()], failures: queue4.getFailuresSnapshot() }, {
    pending: [],
    failures: [],
  });
});

// ## The status store is `useSyncExternalStore`-compatible
void test("The status store is `useSyncExternalStore`-compatible", async (t) => {
  const { queue: queue6 } = makeQueue({});
  let notified = 0;
  const unsubscribe = queue6.subscribeStatus(() => { notified += 1; });
  queue6.enqueueCreate("r6", { targetSessionId: "s1" });
  t.check(notified, any(Number).positive());

  unsubscribe();
});

// ## A chunk enqueued after finalize is refused, not silently mis-sequenced
//
// `enqueueFinalize` snapshots the chunk count it assigned so far. A caller that
// (by mistake) enqueues one more chunk afterward would otherwise corrupt that
// count; the queue refuses the late chunk instead.
void test("enqueueFinalize snapshots the chunk count it assigned so far.", async (t) => {
  const { queue: queue7, transport: transport7 } = makeQueue({});
  queue7.enqueueCreate("r7", { targetSessionId: "s1" });
  queue7.enqueueChunk("r7", new ArrayBuffer(4));
  queue7.enqueueFinalize("r7", { emissionId: null, hq: null });
  t.check(queue7.pendingChunkCount("r7"), 1);

  queue7.enqueueChunk("r7", new ArrayBuffer(4));
  t.check(queue7.pendingChunkCount("r7"), 1);

  await flushMicrotasks();
  t.check(transport7.calls, ["r7#0:create", "r7#1:chunk", "r7#2:finalize"]);
});

// ## A stuck recording's backoff survives another recording succeeding
//
// Two recordings can each be mid-drain at once across a merge from storage
// (two tabs, or a resumed drainer). An older recording's transient failure
// must keep its own wait even after a different, older-still recording's op is
// merged in and succeeds in between — a single shared "last outcome" would let
// that unrelated success wipe `stuck`'s backoff and cause an immediate,
// un-backed-off resend. `urgent` is planted directly in storage (simulating an
// op a second tab already had queued, older than anything this queue has
// enqueued itself) so it merges in via `loadPersisted` — the reachable path for
// this race, since strict oldest-first ordering otherwise never lets a merely
// *newer* recording jump ahead of one already mid-backoff.
void test("Two recordings can each be mid-drain at once across a merge from storage (two...", async (t) => {
  const storage8 = createInMemoryVoiceStagingStorage();
  storage8.put({
    apiBase: "http://box.example/api",
    recordingId: "urgent",
    seq: 0,
    payload: { kind: "create", targetSessionId: "s1" },
    createdAt: 0,
    attempts: 0,
  });
  const { queue: queue8, transport: transport8 } = makeQueue({
    script: { "stuck#0": ["transient", "success"] },
    storage: storage8,
  });
  queue8.enqueueCreate("stuck", { targetSessionId: "s1" });
  await flushMicrotasks();

  // `stuck` failed once and is backing off; `urgent` (older than `stuck`, merged
  // in mid-drain) was sent and succeeded in between — and `stuck`'s backoff is
  // untouched:

  t.check(transport8.calls, ["stuck#0:create", "urgent#0:create"]);

  t.check(queue8.getStatusSnapshot().get("stuck"), { queuedOps: 1 });

  // Waking the drainer again immediately still finds `stuck` too soon to retry —
  // `urgent`'s success did not clear its wait:

  queue8.wake();
  await flushMicrotasks();
  t.check(transport8.calls, ["stuck#0:create", "urgent#0:create"]);

  // Only once real backoff time has passed does `stuck` retry and succeed:

  now += 5000;
  queue8.wake();
  await flushMicrotasks();

  t.check([...queue8.getStatusSnapshot()], []);

  t.check(transport8.calls, ["stuck#0:create", "urgent#0:create", "stuck#0:create"]);
});
