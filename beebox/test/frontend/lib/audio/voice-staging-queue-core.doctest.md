# The voice-staging queue's pure decision core

`nextDrainStep` (`lib/audio/voice-staging-queue-core.ts`) is the drainer's
brain, reachable with no storage and no network: given the ops still queued
and what happened last time, it says what to do next — send an op, wait, drop
a recording as terminally failed, or sit idle.

```ts setup
import { nextDrainStep, type VoiceOp, type LastOutcome } from "../../../../src/frontend/src/lib/audio/voice-staging-queue-core.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BOUND_MS = 7 * DAY_MS;

function op(overrides: Partial<VoiceOp> & Pick<VoiceOp, "recordingId" | "seq">): VoiceOp {
  const { recordingId, seq, payload, createdAt, attempts } = overrides;
  return {
    recordingId,
    seq,
    payload: payload ?? { kind: "chunk", chunkIndex: seq, bytes: new ArrayBuffer(0) },
    createdAt: createdAt ?? 0,
    attempts: attempts ?? 0,
  };
}

function step(ops: VoiceOp[], opts: { now: number; lastOutcome?: LastOutcome | null }) {
  return nextDrainStep(ops, { now: opts.now, lastOutcome: opts.lastOutcome ?? null, boundMs: BOUND_MS });
}
```

## Idle: nothing queued

```ts
step([], { now: 1000 })
=> {
  "type": "idle"
}
```

## Ordered ops: the lowest `seq` goes first, and stays first until it's gone

```ts
const ops = [
  op({ recordingId: "r1", seq: 0, createdAt: 100 }),
  op({ recordingId: "r1", seq: 1, createdAt: 200 }),
  op({ recordingId: "r1", seq: 2, createdAt: 300 }),
];
step(ops, { now: 1000 })
=> {
  "type": "send",
  "op": {
    "recordingId": "r1",
    "seq": 0,
    "payload": {
      "kind": "chunk",
      "chunkIndex": 0,
      "bytes": {}
    },
    "createdAt": 100,
    "attempts": 0
  }
}
```

Once seq 0 is removed (the shell deletes an op on success), seq 1 is next —
never seq 2 out of order:

```ts continue
const afterFirstSucceeds = ops.slice(1);
step(afterFirstSucceeds, { now: 1000 }).op.seq
=> 1
```

## Recordings drain oldest-first

Two recordings interleave; the one whose earliest pending op is older goes
first, regardless of how the ops happen to be ordered in the array.

```ts
const interleaved = [
  op({ recordingId: "newer", seq: 0, createdAt: 500 }),
  op({ recordingId: "older", seq: 0, createdAt: 100 }),
  op({ recordingId: "newer", seq: 1, createdAt: 600 }),
];
step(interleaved, { now: 1000 }).op.recordingId
=> older
```

```ts continue
const olderDone = interleaved.filter((o) => o.recordingId !== "older");
step(olderDone, { now: 1000 }).op.recordingId
=> newer
```

## A transient failure waits, then retries

A 502 (or any transient error) on attempt 1 waits `retryDelayMs(1)` = 1000ms
from when it failed. Before that elapses, the drainer waits; after, it sends
again — with `attempts` already bumped by the shell to 1.

```ts
const failedOnce = op({ recordingId: "r1", seq: 0, createdAt: 100, attempts: 1 });
const lastOutcome: LastOutcome = { recordingId: "r1", seq: 0, at: 5000, kind: "transient" };

step([failedOnce], { now: 5500, lastOutcome })
=> {
  "type": "wait",
  "ms": 500
}

step([failedOnce], { now: 6000, lastOutcome })
=> {
  "type": "send",
  "op": {
    "recordingId": "r1",
    "seq": 0,
    "payload": {
      "kind": "chunk",
      "chunkIndex": 0,
      "bytes": {}
    },
    "createdAt": 100,
    "attempts": 1
  }
}
```

## Steady-state delay once the backoff schedule runs out

`MAX_RETRIES` is 7; past that, the wait is a steady 30s rather than the
schedule's last (30s-capped) entry running out immediately.

```ts
const exhausted = op({ recordingId: "r1", seq: 0, createdAt: 100, attempts: 8 });
const justFailed: LastOutcome = { recordingId: "r1", seq: 0, at: 5000, kind: "transient" };

step([exhausted], { now: 34_000, lastOutcome: justFailed })
=> {
  "type": "wait",
  "ms": 1000
}

step([exhausted], { now: 35_000, lastOutcome: justFailed }).type
=> send
```

## A terminal failure (a 4xx) drops the whole recording

```ts
const rejected = op({ recordingId: "r1", seq: 0, createdAt: 100 });
const conflict: LastOutcome = { recordingId: "r1", seq: 0, at: 5000, kind: "terminal" };

step([rejected], { now: 5001, lastOutcome: conflict })
=> {
  "type": "terminal",
  "recordingId": "r1",
  "op": {
    "recordingId": "r1",
    "seq": 0,
    "payload": {
      "kind": "chunk",
      "chunkIndex": 0,
      "bytes": {}
    },
    "createdAt": 100,
    "attempts": 0
  },
  "reason": "rejected"
}
```

## An op older than the 7-day bound is terminal regardless of its own history

Even an op that has never failed goes terminal once it's too old — the bound
is about the op's age, not its attempt count.

```ts
const ancient = op({ recordingId: "r1", seq: 0, createdAt: 0 });
step([ancient], { now: BOUND_MS }).reason
=> expired

step([ancient], { now: BOUND_MS - 1 }).type
=> send
```

## A `lastOutcome` for a different op doesn't apply

If the recording's earliest op changed (the prior one succeeded and was
removed), a stale `lastOutcome` for the old op is simply ignored.

```ts
const next = op({ recordingId: "r1", seq: 1, createdAt: 100 });
const staleOutcome: LastOutcome = { recordingId: "r1", seq: 0, at: 5000, kind: "terminal" };
step([next], { now: 5001, lastOutcome: staleOutcome }).type
=> send
```
