// # ChatSessionRegistry — LRU cap, pins, and the idle sweep
//
// `ChatSessionRegistry` (`src/core/chat/session/registry/core.ts`) pools `ChatSession`
// instances by session id: subprocesses are capped (`enforceLiveCap` stops the
// LRU one), SSE listeners pin entries against eviction, and an idle sweep drops
// entries untouched past `idleTimeoutMs`.
//
// The registry's clock is DEADLINE time (the two-clock taxonomy) — never
// `BBX_TIME`-frozen — so these tests inject a fake `now` and advance it by hand.
// The fake `ChatBackend` keeps each spawned run open until stopped, so
// `isRunning()` reflects which sessions hold a live subprocess.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, is, str } from "@ianbicking/tap-check/check";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { tick, plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";
import { stopChatSessionsAndWait } from "../../../../src/core/chat/session/registry/shutdown.js";

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

// ## Shutdown waits for close, but not forever
//
// The supervised-reload boundary resolves after a session actually closes, not
// merely after `stop()` starts. A delayed fake makes that ordering observable:
void test("The supervised-reload boundary resolves after a session actually closes, not...", async (t) => {
  // doctest:L61
  let closeListener = () => {};
  const delayed = {
    getSessionId: () => "delayed-session",
    isRunning: () => true,
    whenStarted: () => Promise.resolve(),
    once: (_event: "close", listener: () => void) => { closeListener = listener; },
    stop: () => {},
  };
  let shutdownResolved = false;
  const delayedShutdown = stopChatSessionsAndWait([delayed], { timeoutMs: 100, periodMs: 1 })
    .then((timedOut) => { shutdownResolved = true; return timedOut; });
  await new Promise((resolve) => setImmediate(resolve));
  t.check(shutdownResolved, false);

  // doctest:L76
  closeListener();
  t.check(await delayedShutdown, []);

  // A stuck close is bounded and names the session the child had to leave behind:

  // doctest:L84
  t.check(await stopChatSessionsAndWait([delayed], { timeoutMs: 5, periodMs: 1 }), [
    "delayed-session",
  ]);
});

// A session still starting is not running yet, but its start (the bootstrap docs
// commit, then the backend spawn) would finish after the box was torn down.
// Shutdown waits for the start, then stops the run it opened:
void test("A session still starting is not running yet, but its start (the bootstrap doc...", async (t) => {
  // doctest:L93
  let finishStart = () => {};
  let running = false;
  let stopped = false;
  let onClose = () => {};
  const starting = {
    getSessionId: () => "starting-session",
    isRunning: () => running,
    whenStarted: () => new Promise<void>((resolve) => { finishStart = () => { running = true; resolve(); }; }),
    once: (_event: "close", listener: () => void) => { onClose = listener; },
    stop: () => { stopped = true; onClose(); },
  };
  const startingShutdown = stopChatSessionsAndWait([starting], { timeoutMs: 1_000, periodMs: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  t.check(
    // Not stopped yet: it has no run to stop until its start finishes.
    stopped,
    false,
  );

  // doctest:L110
  finishStart();
  t.check(await startingShutdown, []);

  // doctest:L114
  t.check(stopped, true);

  // A start that never finishes is bounded by the same time limit and named.
  // It does not hold back a session that is already running: that one is stopped
  // at once, and it closes:

  // doctest:L123
  const stuck = { ...starting, getSessionId: () => "stuck-session", whenStarted: () => new Promise<void>(() => {}) };
  let liveStopped = false;
  let liveOnClose = () => {};
  const live = {
    getSessionId: () => "live-session",
    isRunning: () => !liveStopped,
    whenStarted: () => Promise.resolve(),
    once: (_event: "close", listener: () => void) => { liveOnClose = listener; },
    stop: () => { liveStopped = true; liveOnClose(); },
  };
  t.check(await stopChatSessionsAndWait([stuck, live], { timeoutMs: 5, periodMs: 1 }), [
    "stuck-session",
  ]);

  // doctest:L136
  t.check(liveStopped, true);
});

// ## LRU eviction under the live cap
//
// Two sessions spawn under a cap of 2; starting a third evicts the one whose
// subprocess was least recently used — the entry stays (resumable later), only
// its subprocess stops.
void test("Two sessions spawn under a cap of 2; starting a third evicts the one whose su...", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L147
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);

  // doctest:L151
  clock = 1_000;
  const s1 = registry.getOrCreate("s1");
  await s1.send("hi");
  clock = 2_000;
  const s2 = registry.getOrCreate("s2");
  await s2.send("hi");
  await tick();
  t.check({ size: registry.size(), live: registry.liveCount() }, {
    size: 2,
    live: 2,
  });

  // A third session arrives. The cap check runs before its spawn (mirroring
  // `chat-send-routes.ts`) and stops s1 — the LRU by `lastSubprocessUse`:

  // doctest:L166
  clock = 3_000;
  const s3 = registry.getOrCreate("s3");
  registry.touch("s3", { subprocessUse: true });
  registry.enforceLiveCap("s3");
  await tick();
  t.check({ s1: s1.isRunning(), s2: s2.isRunning(), size: registry.size() }, {
    s1: false,
    s2: true,
    size: 3,
  });

  // The evicted entry is still addressable — `get` returns the same instance,
  // ready to re-spawn on the next send:

  // doctest:L179
  t.check(registry.get("s1"), is(s1));

  // ## Pins beat the LRU order
  //
  // A pinned entry (an SSE listener is attached) is skipped by the cap even when
  // it is the LRU candidate; eviction falls through to the next unpinned one.

  // doctest:L189
  // Respawn s1 (clock 4000) so s2 (clock 2000) is now the LRU.
  clock = 4_000;
  await s1.send("again");
  registry.touch("s1", { subprocessUse: true });
  await tick();

  // doctest:L195
  // Pin the LRU (s2); the cap check for s3 must evict s1 instead.
  const releaseS2 = registry.pin("s2");
  registry.enforceLiveCap("s3");
  t.check({ s1: s1.isRunning(), s2: s2.isRunning() }, {
    s1: false,
    s2: true,
  });

  // When every candidate is pinned or current, nothing is evicted — the cap
  // logs and declines rather than killing an in-flight stream:

  // doctest:L206
  clock = 5_000;
  await s1.send("respawn");
  const releaseS1 = registry.pin("s1");
  await tick();
  registry.enforceLiveCap("s3");
  t.check({ s1: s1.isRunning(), s2: s2.isRunning() }, {
    s1: true,
    s2: true,
  });

  // A pin's release function is idempotent: releasing the same pin twice must not
  // cancel a second pin on the same entry. s2 holds two pins; the first is released
  // twice, and the cap still skips s2 and evicts unpinned s1 instead:

  // doctest:L220
  const releaseS2b = registry.pin("s2");
  releaseS1();
  releaseS2();
  releaseS2();
  registry.enforceLiveCap("s3");
  await tick();
  t.check({ s1: s1.isRunning(), s2: s2.isRunning() }, {
    s1: false,
    s2: true,
  });

  // Release the second pin so later examples start unpinned:

  // doctest:L233
  releaseS2b();

  // ## Idle sweep drops untouched entries, pins protect
  //
  // Entries idle past `idleTimeoutMs` (10s here) are dropped entirely; a pinned
  // entry survives regardless of age.

  // doctest:L242
  // s3 stays fresh; s1 and s2 age out. Pin s2 to shield it.
  const releaseS2Again = registry.pin("s2");
  clock = 16_500; // s1/s2 last touched at ≤5_000 → idle; s3 touched at 3_000 → also idle
  registry.touch("s3");
  registry.sweepIdle();
  t.check({ size: registry.size(), s1: registry.get("s1"), s2: registry.get("s2"), s3: registry.get("s3") }, {
    size: 2,
    s1: null,
    s2: is(s2),
    s3: is(s3),
  });

  // Releasing the pin exposes s2 to the next sweep; s3 (last touched by the
  // assertions above) ages out too, emptying the registry:

  // doctest:L255
  releaseS2Again();
  clock = 40_000;
  registry.sweepIdle();
  t.check({ size: registry.size(), s2: registry.get("s2") }, {
    size: 0,
    s2: null,
  });
});

// ## Deletion reservation stops and tombstones a live session
void test("Deletion reservation stops and tombstones a live session", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L270
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const session = registry.getOrCreate(sessionId);
  await session.send("hello");
  await tick();
  registry.deletion.begin(sessionId);
  await registry.deletion.stopAndRemove(sessionId);
  registry.deletion.finish(sessionId);
  t.check({ running: session.isRunning(), live: registry.liveCount(), blocked: registry.deletion.isBlocked(sessionId) }, {
    running: false,
    live: 0,
    blocked: true,
  });

  // doctest:L285
  t.check(errorName(() => registry.getOrCreate(sessionId)), "SessionDeletingError");
});

// ## Warm slot: reaped when idle, re-warmed on activity
//
// `prewarm()` installs a warm subprocess slot on the shared backend so the first
// "new chat" send skips spawn latency. It shouldn't live forever: once chat has
// been quiet past `idleTimeoutMs`, the sweep reaps it, and the next accessor
// re-warms. (The backend clock and the registry's `lastUse` share the injected
// `now`.)
void test("prewarm() installs a warm subprocess slot on the shared backend so the first...", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L303
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);

  // doctest:L307
  clock = 1_000;
  await registry.prewarm();
  await t.checkText(backend.describe(), `warmHeld: true
warming: false
prewarmCount: 1
closeWarmCount: 0`);

  // Chat goes quiet: `lastUse` (1_000) ages past `idleTimeoutMs` (10s). The sweep
  // closes the warm slot — an idle box shouldn't hold a Claude subprocess forever:

  // doctest:L320
  clock = 30_000;
  registry.sweepIdle();
  await t.checkText(backend.describe(), `warmHeld: false
warming: false
prewarmCount: 1
closeWarmCount: 1`);

  // Activity resumes: `getOrCreate` re-warms (best-effort, fire-and-forget) because
  // prewarm was requested earlier and the backend now reports no warm slot:

  // doctest:L333
  registry.getOrCreate("s1");
  await waitFor(() => backend.prewarmCount === 2);
  await t.checkText(backend.describe(), `warmHeld: true
warming: false
prewarmCount: 2
closeWarmCount: 1`);

  // No stampede while already warm: further accessors see `hasWarm() === true` and
  // don't fire redundant re-prewarms — the count stays put:

  // doctest:L346
  registry.get("s1");
  registry.getOrCreate("s1");
  registry.touch("s1");
  t.check(backend.prewarmCount, 2);

  // A coined reservation's engine reaches the run it starts. The regression this
  // guards (2026-08-27): the registry handed the reservation's contextDir and
  // seedFeatures into the session but not its engine, so a `?engine=claude` coined
  // start on a codex-default box fell to the box default and tripped the
  // coined-must-be-Claude invariant — a 500 at chat open.

  // doctest:L360
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { clearBoxConfigCache } = await import("../../../../src/core/box/config.js");
  const { randomUUID } = await import("node:crypto");

  // doctest:L365
  const codexBox = await makeTmpBox({ git: true });
  await fs.mkdir(path.join(codexBox.root, "_config"), { recursive: true });
  await fs.writeFile(
    path.join(codexBox.root, "_config/box.json"),
    JSON.stringify({ agentEngine: "codex", engines: { claude: true, codex: true } }),
  );
  clearBoxConfigCache(codexBox.root);

  // doctest:L373
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
  const reservationAfterExpiry = codexRegistry.getReservation(coined);
  await coinedSession.setFeature("narration", "on");
  await coinedSession.send("hi");
  await tick();
  const { loadHistoryEntries } = await import("../../../../src/core/chat/session/history.js");
  const { findChatHuskEntry } = await import("../../../../src/core/chat/husk-read.js");
  await waitFor(async () => {
    const entry = (await loadHistoryEntries(codexBox.root)).find((candidate) => candidate.id === coined);
    return entry?.features?.narration === "on"
      && (await findChatHuskEntry(codexBox.root, coined))?.engine === "claude";
  });
  const historyEntry = (await loadHistoryEntries(codexBox.root)).find((entry) => entry.id === coined);
  const husk = await findChatHuskEntry(codexBox.root, coined);
  const { localOrigin } = await import("../../../../src/core/chat/session/origin.js");
  const here = await localOrigin();
  t.check({ reserved, reservationAfterExpiry, backend: codexBackend.lastRun()?.startOptions.engine, husk, history: historyEntry }, {
    reserved: { kind: "reserved", sessionId: coined },
    reservationAfterExpiry: null,
    backend: "claude",
    husk: {
      path: str`_content/chat/web/${any(String)}_${coined.slice(0, 8)}.chat.card`,
      session: coined,
      engine: "claude",
      origin: here.id,
      originName: here.name,
    },
    history: { id: coined, engine: "claude", features: { narration: "on" } },
  });

  // doctest:L409
  await codexRegistry.shutdown();
  t.check(coinedSession.isRunning(), false);

  // doctest:L413
  await codexBox.cleanup();

  // Shutdown closes the warm slot immediately too — it is a subprocess like any
  // session's:

  // doctest:L420
  registry.shutdown();
  t.check(`closeWarmCount=${backend.closeWarmCount} warmHeld after shutdown: ${backend.hasWarm()}`, "closeWarmCount=2 warmHeld after shutdown: false");
});

// ## Maintenance cannot be undone by a read warming a session
void test("Maintenance cannot be undone by a read warming a session", async (t) => {
  t.teardown(async () => {
    try {
      await registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L433
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = new ChatSessionRegistry(box.root, { backend });
  await registry.prewarm();
  registry.quiesceForMaintenance();
  registry.getOrCreate("maintenance-read");
  await registry.prewarm();
  t.check({ warm: backend.hasWarm(), starts: backend.prewarmCount }, {
    warm: false,
    starts: 1,
  });

  // doctest:L443
  registry.resumeAfterMaintenance();
  await registry.prewarm();
  t.check({ warm: backend.hasWarm(), starts: backend.prewarmCount }, {
    warm: true,
    starts: 2,
  });
});

// ## Shutdown during a prewarm's probe spawns nothing
//
// A prewarm first probes the box for the start options, and only then asks the
// backend to spawn. A shutdown that lands during the probe must stop the spawn:
// the server is gone, and the box directory may be next. A test server that
// reserved a chat and was cleaned up at once used to start a real Claude Code
// warm-up in an already deleted directory.
void test("A prewarm first probes the box for the start options, and only then asks the...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L463
  const box = await makeTmpBox();
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);
  await Promise.all([registry.prewarm(), registry.shutdown()]);
  t.check(backend.prewarmCount, 0);
});
