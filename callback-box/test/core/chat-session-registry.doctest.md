# ChatSessionRegistry — LRU cap, pins, and the idle sweep

`ChatSessionRegistry` (`src/core/chat/session/registry.ts`) pools `ChatSession`
instances by session id: subprocesses are capped (`enforceLiveCap` stops the
LRU one), SSE listeners pin entries against eviction, and an idle sweep drops
entries untouched past `idleTimeoutMs`.

The registry's clock is DEADLINE time (the two-clock taxonomy) — never
`CB_TIME`-frozen — so these tests inject a fake `now` and advance it by hand.
The fake `ChatBackend` keeps each spawned run open until stopped, so
`isRunning()` reflects which sessions hold a live subprocess.

```ts setup
import { ChatSessionRegistry } from "../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { tick, plainTestPrompt } from "../helpers/chat-session-spawner-helpers.js";

// Hand-advanced deadline clock.
let clock = 1_000;
const now = () => clock;

function makeRegistry(box: { root: string }, backend: ReturnType<typeof createFakeChatBackend>) {
  return new ChatSessionRegistry(box.root, {
    backend,
    maxLiveProcesses: 2,
    idleTimeoutMs: 10_000,
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
    now,
  });
}
```

## LRU eviction under the live cap

Two sessions spawn under a cap of 2; starting a third evicts the one whose
subprocess was least recently used — the entry stays (resumable later), only
its subprocess stops.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box, backend);

clock = 1_000;
const s1 = registry.getOrCreate("s1");
await s1.send("hi");
clock = 2_000;
const s2 = registry.getOrCreate("s2");
await s2.send("hi");
await tick();
JSON.stringify({ size: registry.size(), live: registry.liveCount() })
=> {"size":2,"live":2}
```

A third session arrives. The cap check runs before its spawn (mirroring
`chat-send-routes.ts`) and stops s1 — the LRU by `lastSubprocessUse`:

```ts continue
clock = 3_000;
registry.getOrCreate("s3");
registry.touch("s3", { subprocessUse: true });
registry.enforceLiveCap("s3");
await tick();
JSON.stringify({ s1: s1.isRunning(), s2: s2.isRunning(), size: registry.size() })
=> {"s1":false,"s2":true,"size":3}
```

The evicted entry is still addressable — `get` returns the same instance,
ready to re-spawn on the next send:

```ts continue
registry.get("s1") === s1
=> true
```

## Pins beat the LRU order

A pinned entry (an SSE listener is attached) is skipped by the cap even when
it is the LRU candidate; eviction falls through to the next unpinned one.

```ts continue
// Respawn s1 (clock 4000) so s2 (clock 2000) is now the LRU.
clock = 4_000;
await s1.send("again");
registry.touch("s1", { subprocessUse: true });
await tick();

// Pin the LRU (s2); the cap check for s3 must evict s1 instead.
const releaseS2 = registry.pin("s2");
registry.enforceLiveCap("s3");
JSON.stringify({ s1: s1.isRunning(), s2: s2.isRunning() })
=> {"s1":false,"s2":true}
```

When every candidate is pinned or current, nothing is evicted — the cap
logs and declines rather than killing an in-flight stream:

```ts continue
clock = 5_000;
await s1.send("respawn");
const releaseS1 = registry.pin("s1");
await tick();
registry.enforceLiveCap("s3");
JSON.stringify({ s1: s1.isRunning(), s2: s2.isRunning() })
=> {"s1":true,"s2":true}
```

A pin's release function is idempotent — double-release does not corrupt the
refcount (an underflow would log an invariant violation):

```ts continue
releaseS2();
releaseS2();
releaseS1();
"released"
=> released
```

## Idle sweep drops untouched entries, pins protect

Entries idle past `idleTimeoutMs` (10s here) are dropped entirely; a pinned
entry survives regardless of age.

```ts continue
// s3 stays fresh; s1 and s2 age out. Pin s2 to shield it.
const releaseS2Again = registry.pin("s2");
clock = 16_500; // s1/s2 last touched at ≤5_000 → idle; s3 touched at 3_000 → also idle
registry.touch("s3");
registry.sweepIdle();
JSON.stringify({ size: registry.size(), s1: registry.get("s1") !== null, s2: registry.get("s2") !== null, s3: registry.get("s3") !== null })
=> {"size":2,"s1":false,"s2":true,"s3":true}
```

Releasing the pin exposes s2 to the next sweep; s3 (last touched by the
assertions above) ages out too, emptying the registry:

```ts continue
releaseS2Again();
clock = 40_000;
registry.sweepIdle();
JSON.stringify({ size: registry.size(), s2: registry.get("s2") === null })
=> {"size":0,"s2":true}
```

```ts cleanup
registry.shutdown();
await box.cleanup();
```
