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
import { once } from "node:events";
import "@ianbicking/tap-check/tap";
import { any, is, str } from "@ianbicking/tap-check/check";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { tick, plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";
import { stopChatSessionsAndWait } from "../../../../src/core/chat/session/registry/shutdown.js";
import { BACKGROUND_STALL_MS } from "../../../../src/core/chat/session/run/live-tasks.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// eslint-disable-next-line no-restricted-syntax -- test-only: the one frame field the pump reads, of the SDK's large union
const toolProgress = { type: "tool_progress" } as unknown as SDKMessage;

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

  closeListener();
  t.check(await delayedShutdown, []);

  // A stuck close is bounded and names the session the child had to leave behind:

  t.check(await stopChatSessionsAndWait([delayed], { timeoutMs: 5, periodMs: 1 }), [
    "delayed-session",
  ]);
});

// A session still starting is not running yet, but its start (the bootstrap docs
// commit, then the backend spawn) would finish after the box was torn down.
// Shutdown waits for the start, then stops the run it opened:
void test("A session still starting is not running yet, but its start (the bootstrap doc...", async (t) => {
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

  finishStart();
  t.check(await startingShutdown, []);

  t.check(stopped, true);

  // A start that never finishes is bounded by the same time limit and named.
  // It does not hold back a session that is already running: that one is stopped
  // at once, and it closes:

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
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);

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

  t.check(registry.get("s1"), is(s1));

  // ## Pins beat the LRU order
  //
  // A pinned entry (an SSE listener is attached) is skipped by the cap even when
  // it is the LRU candidate; eviction falls through to the next unpinned one.

  // Respawn s1 (clock 4000) so s2 (clock 2000) is now the LRU.
  clock = 4_000;
  await s1.send("again");
  registry.touch("s1", { subprocessUse: true });
  await tick();

  // Pin the LRU (s2); the cap check for s3 must evict s1 instead.
  const releaseS2 = registry.pin("s2");
  registry.enforceLiveCap("s3");
  t.check({ s1: s1.isRunning(), s2: s2.isRunning() }, {
    s1: false,
    s2: true,
  });

  // When every candidate is pinned or current, nothing is evicted — the cap
  // logs and declines rather than killing an in-flight stream:

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

  releaseS2b();

  // ## Idle sweep drops untouched entries, pins protect
  //
  // Entries idle past `idleTimeoutMs` (10s here) are dropped entirely; a pinned
  // entry survives regardless of age.

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
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);

  clock = 1_000;
  await registry.prewarm();
  await t.checkText(backend.describe(), `warmHeld: true
warming: false
prewarmCount: 1
closeWarmCount: 0`);

  // Chat goes quiet: `lastUse` (1_000) ages past `idleTimeoutMs` (10s). The sweep
  // closes the warm slot — an idle box shouldn't hold a Claude subprocess forever:

  clock = 30_000;
  registry.sweepIdle();
  await t.checkText(backend.describe(), `warmHeld: false
warming: false
prewarmCount: 1
closeWarmCount: 1`);

  // Activity resumes: `getOrCreate` re-warms (best-effort, fire-and-forget) because
  // prewarm was requested earlier and the backend now reports no warm slot:

  registry.getOrCreate("s1");
  await waitFor(() => backend.prewarmCount === 2);
  await t.checkText(backend.describe(), `warmHeld: true
warming: false
prewarmCount: 2
closeWarmCount: 1`);

  // No stampede while already warm: further accessors see `hasWarm() === true` and
  // don't fire redundant re-prewarms — the count stays put:

  registry.get("s1");
  registry.getOrCreate("s1");
  registry.touch("s1");
  t.check(backend.prewarmCount, 2);

  // A coined reservation's engine reaches the run it starts. The regression this
  // guards (2026-08-27): the registry handed the reservation's contextDir and
  // seedFeatures into the session but not its engine, so a `?engine=claude` coined
  // start on a codex-default box fell to the box default and tripped the
  // coined-must-be-Claude invariant — a 500 at chat open.

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { clearBoxConfigCache } = await import("../../../../src/core/box/config.js");
  const { randomUUID } = await import("node:crypto");

  const codexBox = await makeTmpBox({ git: true });
  await fs.mkdir(path.join(codexBox.root, "_config"), { recursive: true });
  await fs.writeFile(
    path.join(codexBox.root, "_config/box.json"),
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

  await codexRegistry.shutdown();
  t.check(coinedSession.isRunning(), false);

  await codexBox.cleanup();

  // Shutdown closes the warm slot immediately too — it is a subprocess like any
  // session's:

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
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = new ChatSessionRegistry(box.root, { backend });
  await registry.prewarm();
  registry.quiesceForMaintenance("fixture");
  registry.getOrCreate("maintenance-read");
  await registry.prewarm();
  t.check({ warm: backend.hasWarm(), starts: backend.prewarmCount }, {
    warm: false,
    starts: 1,
  });

  registry.resumeAfterMaintenance();
  await registry.prewarm();
  t.check({ warm: backend.hasWarm(), starts: backend.prewarmCount }, {
    warm: true,
    starts: 2,
  });
});

// ## A chat with live background work is not idle
//
// A background subagent outlives its parent's turn and touches neither
// `lastActivity` nor `refCount`, so without this the sweep and the cap both read
// a working chat as abandoned. Production lost subagent runs this way.
void test("the sweep keeps a chat with a live background task until it settles or stalls", async (t) => {
  t.teardown(async () => {
    try {
      await registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);
  clock = 1_000;
  const session = registry.getOrCreate("s1");
  await session.send("go");
  await tick();
  const run = backend.lastRun();
  run?.emitBackgroundTasks(["collect sources"]);
  await tick();

  // Past the idle timeout with a live task: it stays, and its run stays open.
  clock += 60_000;
  registry.sweepIdle();
  t.check({ size: registry.size(), running: session.isRunning(), aborted: run?.aborted }, { size: 1, running: true, aborted: false });

  // A progress frame the adapter drops still counts as the run being alive.
  clock += BACKGROUND_STALL_MS - 1_000;
  run?.emitMessage(toolProgress);
  await tick();
  clock += 2_000;
  registry.sweepIdle();
  t.check(registry.size(), 1);

  // The task settles: the ordinary idle rule applies, and input closes gently.
  run?.emitBackgroundTasks([]);
  await tick();
  t.check(session.isWorkingInBackground(), false);
  registry.sweepIdle();
  await tick();
  t.check({ size: registry.size(), running: session.isRunning(), aborted: run?.aborted }, { size: 0, running: false, aborted: false });

  // Maintenance reads the set itself, not the stall rule: a run quiet past the
  // limit still reports its task, so a deferrable owner never closes it
  // (`docs/implemented-plans/maintenance-live-tasks.md`).
  const quiet = registry.getOrCreate("s-quiet");
  await quiet.send("go");
  await tick();
  backend.lastRun()?.emitBackgroundTasks(["silent shell"]);
  const quietDone = once(quiet, "done");
  backend.lastRun()?.emitResult();
  await quietDone;
  clock += BACKGROUND_STALL_MS;
  t.check({ working: quiet.isWorkingInBackground(), snapshot: registry.snapshotAll().find((entry) => entry.sessionId === "s-quiet") }, {
    working: false,
    snapshot: { sessionId: "s-quiet", running: true, busy: false, liveTasks: 1 },
  });
  quiet.stop();
  await tick();

  // A run that has gone quiet past the limit is hung. It goes, and ends outright.
  const hung = registry.getOrCreate("s2");
  await hung.send("go");
  await tick();
  const hungRun = backend.lastRun();
  hungRun?.emitBackgroundTasks(["stuck"]);
  await tick();
  clock += BACKGROUND_STALL_MS;
  registry.sweepIdle();
  await tick();
  t.check({ size: registry.size(), running: hung.isRunning(), aborted: hungRun?.aborted }, { size: 0, running: false, aborted: true });

  // A later run on the same session starts with no live tasks: the last run's
  // set must not pin it. The fake's fresh run reports none.
  const again = registry.getOrCreate("s3");
  await again.send("go");
  await tick();
  backend.lastRun()?.emitBackgroundTasks(["a"]);
  await tick();
  again.restart();
  await tick();
  t.check(again.isWorkingInBackground(), false);
  await again.send("again");
  await tick();
  t.check(again.isWorkingInBackground(), false);
});

void test("the live cap passes over a chat with background work", async (t) => {
  t.teardown(async () => {
    try {
      await registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);
  clock = 1_000;
  const working = registry.getOrCreate("working");
  await working.send("go");
  await tick();
  const workingRun = backend.lastRun();
  workingRun?.emitBackgroundTasks(["collect sources"]);
  await tick();
  registry.touch("working", { subprocessUse: true });
  clock = 2_000;
  const plain = registry.getOrCreate("plain");
  await plain.send("go");
  await tick();
  registry.touch("plain", { subprocessUse: true });
  clock = 3_000;
  registry.getOrCreate("third");

  // `working` is the least recently used, and `plain` gives its process up instead.
  registry.enforceLiveCap("third");
  await tick();
  t.check({ working: working.isRunning(), plain: plain.isRunning() }, { working: true, plain: false });

  // With only working chats left to choose from, the cap declines.
  const quiet = registry.getOrCreate("quiet");
  await quiet.send("go");
  await tick();
  backend.lastRun()?.emitBackgroundTasks(["more"]);
  await tick();
  registry.enforceLiveCap("third");
  await tick();
  t.check({ working: working.isRunning(), quiet: quiet.isRunning() }, { working: true, quiet: true });
});

// ## Ending a run with tasks live
//
// `close()` only ends input, and a subagent carries on with its Bash calls
// refused in a user's name. So stop and restart end the process when tasks are
// live, and stay gentle otherwise.
void test("stop and restart abort a run only while tasks are live", async (t) => {
  t.teardown(async () => {
    try {
      await registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);
  const session = registry.getOrCreate("s1");
  const cases: [string, () => void, string[]][] = [
    ["stop, no tasks", () => { session.stop(); }, []],
    ["stop, live task", () => { session.stop(); }, ["x"]],
    ["restart, no tasks", () => { session.restart(); }, []],
    ["restart, live task", () => { session.restart(); }, ["x"]],
  ];
  const seen: Record<string, boolean | undefined> = {};
  for (const [name, act, tasks] of cases) {
    await session.send("go");
    await tick();
    const run = backend.lastRun();
    run?.emitBackgroundTasks(tasks);
    await tick();
    act();
    await tick();
    seen[name] = run?.aborted;
  }
  t.check(seen, { "stop, no tasks": false, "stop, live task": true, "restart, no tasks": false, "restart, live task": true });
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
  const box = await makeTmpBox();
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);
  await Promise.all([registry.prewarm(), registry.shutdown()]);
  t.check(backend.prewarmCount, 0);
});
