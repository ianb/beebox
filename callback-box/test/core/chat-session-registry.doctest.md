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
import { stopChatSessionsAndWait } from "../../src/core/chat/session/registry-shutdown.js";

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

// Poll until a condition holds — the registry's re-warm is fire-and-forget
// (`void this.prewarm()`), and prewarm awaits async box I/O before the fake's
// counter moves, so a fixed tick count would be flaky.
async function waitFor(cond: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 2_000; i += 1) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error("condition did not become true");
}

function errorName(fn: () => unknown): string {
  try {
    fn();
    return "not blocked";
  } catch (error) {
    return error instanceof Error ? error.name : "unknown";
  }
}
```

## Shutdown waits for close, but not forever

The supervised-reload boundary resolves after a session actually closes, not
merely after `stop()` starts. A delayed fake makes that ordering observable:

```ts
let closeListener = () => {};
const delayed = {
  getSessionId: () => "delayed-session",
  isRunning: () => true,
  once: (_event: "close", listener: () => void) => { closeListener = listener; },
  stop: () => {},
};
let shutdownResolved = false;
const delayedShutdown = stopChatSessionsAndWait([delayed], { timeoutMs: 100, periodMs: 1 })
  .then((timedOut) => { shutdownResolved = true; return timedOut; });
await new Promise((resolve) => setImmediate(resolve));
shutdownResolved
=> false

closeListener();
JSON.stringify(await delayedShutdown)
=> []
```

A stuck close is bounded and names the session the child had to leave behind:

```ts continue
JSON.stringify(await stopChatSessionsAndWait([delayed], { timeoutMs: 5, periodMs: 1 }))
=> ["delayed-session"]
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

## Deletion reservation stops and tombstones a live session

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box, backend);
const sessionId = "11111111-1111-4111-8111-111111111111";
const session = registry.getOrCreate(sessionId);
await session.send("hello");
await tick();
registry.deletion.begin(sessionId);
await registry.deletion.stopAndRemove(sessionId);
registry.deletion.finish(sessionId);
JSON.stringify({ running: session.isRunning(), live: registry.liveCount(), blocked: registry.deletion.isBlocked(sessionId) })
=> {"running":false,"live":0,"blocked":true}
```

```ts continue
errorName(() => registry.getOrCreate(sessionId))
=> SessionDeletingError
```

```ts cleanup
registry.shutdown();
await box.cleanup();
```

## Warm slot: reaped when idle, re-warmed on activity

`prewarm()` installs a warm subprocess slot on the shared backend so the first
"new chat" send skips spawn latency. It shouldn't live forever: once chat has
been quiet past `idleTimeoutMs`, the sweep reaps it, and the next accessor
re-warms. (The backend clock and the registry's `lastUse` share the injected
`now`.)

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box, backend);

clock = 1_000;
await registry.prewarm();
backend.describe()
=> warmHeld: true
warming: false
prewarmCount: 1
closeWarmCount: 0
```

Chat goes quiet: `lastUse` (1_000) ages past `idleTimeoutMs` (10s). The sweep
closes the warm slot — an idle box shouldn't hold a Claude subprocess forever:

```ts continue
clock = 30_000;
registry.sweepIdle();
backend.describe()
=> warmHeld: false
warming: false
prewarmCount: 1
closeWarmCount: 1
```

Activity resumes: `getOrCreate` re-warms (best-effort, fire-and-forget) because
prewarm was requested earlier and the backend now reports no warm slot:

```ts continue
registry.getOrCreate("s1");
await waitFor(() => backend.prewarmCount === 2);
backend.describe()
=> warmHeld: true
warming: false
prewarmCount: 2
closeWarmCount: 1
```

No stampede while already warm: further accessors see `hasWarm() === true` and
don't fire redundant re-prewarms — the count stays put:

```ts continue
registry.get("s1");
registry.getOrCreate("s1");
registry.touch("s1");
backend.prewarmCount
=> 2
```

A coined reservation's engine reaches the run it starts. The regression this
guards (2026-08-27): the registry handed the reservation's contextDir and
seedFeatures into the session but not its engine, so a `?engine=claude` coined
start on a codex-default box fell to the box default and tripped the
coined-must-be-Claude invariant — a 500 at chat open.

```ts continue
const fs = await import("node:fs/promises");
const path = await import("node:path");
const { clearBoxConfigCache } = await import("../../src/core/box/config.js");
const { randomUUID } = await import("node:crypto");

const codexBox = await makeTmpBox();
await fs.mkdir(path.join(codexBox.root, "config"), { recursive: true });
await fs.writeFile(
  path.join(codexBox.root, "config/box.json"),
  JSON.stringify({ agentEngine: "codex", engines: { claude: true, codex: true } }),
);
clearBoxConfigCache(codexBox.root);

const codexBackend = createFakeChatBackend();
const codexRegistry = makeRegistry(codexBox, codexBackend);
const coined = randomUUID();
const reserved = await codexRegistry.reserve({
  sessionId: coined, contextDir: null, seedFeatures: {}, requestedEngine: "claude",
});
await waitFor(() => codexBackend.prewarmCount === 1);
const coinedSession = codexRegistry.getOrCreate(coined);
// Even if addressability expires after construction, the session retains the
// accepted start choice; a feature toggle cannot mint a competing history row.
clock += 7 * 60 * 60 * 1_000;
const reservationExpired = codexRegistry.getReservation(coined) === null;
await coinedSession.setFeature("hq-dictation", "on");
await coinedSession.send("hi");
await tick();
const { loadHistoryEntries } = await import("../../src/core/chat/session/history.js");
const { findChatHuskEntry } = await import("../../src/core/chat/husk-read.js");
await waitFor(async () => {
  const entry = (await loadHistoryEntries(codexBox.root)).find((candidate) => candidate.id === coined);
  return entry?.features?.["hq-dictation"] === "on"
    && (await findChatHuskEntry(codexBox.root, coined))?.engine === "claude";
});
const historyEntry = (await loadHistoryEntries(codexBox.root)).find((entry) => entry.id === coined);
const husk = await findChatHuskEntry(codexBox.root, coined);
JSON.stringify({
  reserved: reserved.kind,
  reservationExpired,
  backend: codexBackend.lastRun()?.startOptions.engine,
  husk: husk?.engine,
  history: historyEntry?.engine,
  features: historyEntry?.features,
})
=> {"reserved":"reserved","reservationExpired":true,"backend":"claude","husk":"claude","history":"claude","features":{"hq-dictation":"on"}}
```

```ts continue
await codexRegistry.shutdown();
coinedSession.isRunning()
=> false

await codexBox.cleanup();
```

Shutdown closes the warm slot immediately too — it is a subprocess like any
session's:

```ts continue
registry.shutdown();
`closeWarmCount=${backend.closeWarmCount} warmHeld after shutdown: ${backend.hasWarm()}`
=> closeWarmCount=2 warmHeld after shutdown: false
```

```ts cleanup
registry.shutdown();
await box.cleanup();
```
