# TurnBuffer

The resumable per-turn output buffer behind `events.turnStream`. It captures a
chat turn's messages with monotonic `seq` numbers so a reconnecting client can
replay from its last-seen seq, then stream live. Bounded (a long turn evicts its
head) with the durable transcript as the floor: a resume past evicted frames is
reported as a gap so the client refetches history instead of silently losing
text.

```ts setup
import { TurnBuffer } from "../../src/core/chat/turn-buffer.js";
import type { ChatMessage } from "../../src/core/chat/session/messages.js";

function msg(type: ChatMessage["type"]): ChatMessage {
  return { type };
}
```

## Frames get monotonic seqs; framesAfter resumes from a seq

```ts
const b = new TurnBuffer("t1");
b.push(msg("system"));
b.push(msg("assistant"));
b.push(msg("result"));
print(`all: ${b.framesAfter(0).map((f) => f.seq).join(",")}`);
print(`types: ${b.framesAfter(0).map((f) => f.msg.type).join(",")}`);
print(`after 1: ${b.framesAfter(1).map((f) => f.seq).join(",")}`);
print(`after 3: ${b.framesAfter(3).length}`)
=>
all: 1,2,3
types: system,assistant,result
after 1: 2,3
after 3: 0
```

## A fresh buffer has no gap and isn't complete

```ts
const b = new TurnBuffer("t2");
b.push(msg("assistant"));
print(`gap after 0: ${b.hasGapAfter(0)}`);
print(`complete: ${b.complete}`);
print(`errored: ${b.errored}`)
=>
gap after 0: false
complete: false
errored: null
```

## finish marks the turn complete

```ts
const b = new TurnBuffer("t3");
b.push(msg("result"));
b.finish();
print(`complete: ${b.complete}`);
print(`errored: ${b.errored}`)
=>
complete: true
errored: null
```

## fail records a terminal error and completes

```ts
const b = new TurnBuffer("t4");
b.fail("subprocess crashed");
print(`complete: ${b.complete}`);
print(`errored: ${b.errored}`)
=>
complete: true
errored: subprocess crashed
```

## Overflow evicts the head and reports a gap for evicted seqs

The ring keeps the most recent frames. Once the head is evicted, a resume from
before the eviction point is a gap (→ the client resyncs from history).

```ts
const b = new TurnBuffer("t5");
for (let i = 0; i < 4001; i++) b.push(msg("stream_event"));
print(`retained: ${b.framesAfter(0).length}`);
print(`first seq: ${b.framesAfter(0)[0].seq}`);
print(`gap after 0: ${b.hasGapAfter(0)}`);
print(`gap after 1: ${b.hasGapAfter(1)}`);
print(`gap after 4001: ${b.hasGapAfter(4001)}`)
=>
retained: 4000
first seq: 2
gap after 0: true
gap after 1: false
gap after 4001: false
```

## waitForChange resolves immediately when the version moved (no missed wakeup)

A reader snapshots the version before draining; a push during the drain bumps it,
so the subsequent `waitForChange` returns at once rather than sleeping on a frame
that's already buffered.

```ts
const b = new TurnBuffer("t6");
const v = b.versionSnapshot();
b.push(msg("assistant")); // happens "during" a drain
await b.waitForChange(undefined, v);
print("resolved-on-change")
=>
resolved-on-change
```

## waitForChange resolves immediately once complete

```ts
const b = new TurnBuffer("t7");
const v = b.versionSnapshot();
b.finish();
await b.waitForChange(undefined, v);
print("resolved-on-complete")
=>
resolved-on-complete
```
