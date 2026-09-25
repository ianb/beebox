// Track 2 of docs/plans/router-transient-failure-resilience.md: a load-induced
// startup failure retries, bounded; everything else parks on the first failure.
//
// The bound is the load-bearing part. Nothing retries forever, and a stranded
// terminal state must stay visible — so these tests care as much about the
// retry STOPPING as about it happening, and about the count surviving the
// clear-and-restart that a retry performs.

import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AUTO_RETRIES,
  RETRY_BACKOFF_MS,
  failedLifecycle,
  readyLifecycle,
  retryDecision,
} from "../../src/router/router-lifecycle.js";
import { FakeProbeTimeoutError, makeHarness, ticks, type Harness } from "./router-core-harness.js";

// --- the decision, on its own ------------------------------------------------

test("only waitForHttp earns an automatic retry", () => {
  assert.equal(retryDecision({ phase: "waitForHttp", attempts: 0, now: 1_000 }).retryAfter, 3_000);
  // Everything else is a statement about the worktree, not about the host.
  for (const phase of ["childExit", "spawn", "pidStore.write", "dashboard-start"]) {
    assert.equal(retryDecision({ phase, attempts: 0, now: 1_000 }).retryAfter, null, phase);
  }
});

test("the retry budget is spent, then the failure is terminal", () => {
  const now = 1_000;
  const schedule = [0, 1, 2, 3, 4].map((attempts) => retryDecision({ phase: "waitForHttp", attempts, now }).retryAfter);
  assert.deepEqual(schedule, [
    now + RETRY_BACKOFF_MS[0],
    now + RETRY_BACKOFF_MS[1],
    now + RETRY_BACKOFF_MS[2],
    null,
    null,
  ]);
  assert.equal(RETRY_BACKOFF_MS.length, MAX_AUTO_RETRIES, "one backoff per permitted attempt");
});

test("the backoff grows, so a retry storm cannot outpace the machine it is waiting on", () => {
  const ascending = RETRY_BACKOFF_MS.every((ms, i) => i === 0 || ms > (RETRY_BACKOFF_MS[i - 1] ?? 0));
  assert.ok(ascending, `expected ascending backoff, got ${RETRY_BACKOFF_MS.join(", ")}`);
});

// --- the decision, driving a real core ---------------------------------------

/** Cold-start `wt` and let its readiness probes time out, as a loaded host does. */
async function failOnce(h: Harness): Promise<void> {
  const started = h.core.ensureRunning("wt");
  const rejected = assert.rejects(started);
  const probes = await h.awaitProbes(2);
  for (const probe of probes) probe.reject(new FakeProbeTimeoutError());
  await rejected;
  await ticks(2);
}

test("a waitForHttp failure parks with a retry scheduled, and 502s until it is due", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  await failOnce(h);
  const failed = failedLifecycle(h.core.getHandle("wt")!);
  assert.ok(failed);
  assert.equal(failed.attempts, 0);
  assert.equal(failed.retryAfter, h.clock.now() + RETRY_BACKOFF_MS[0]);

  // Before the backoff elapses a request is refused immediately rather than
  // queueing, so a burst against a parked worktree stays cheap.
  const spawnsBefore = h.spawner.lifecycleCalls().length;
  await assert.rejects(h.core.ensureRunning("wt"), /did not respond/u);
  assert.equal(h.spawner.lifecycleCalls().length, spawnsBefore, "no generation was spawned");
});

test("once the backoff elapses the next request restarts it", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  await failOnce(h);
  const spawnsBefore = h.spawner.lifecycleCalls().length;
  h.clock.advance(RETRY_BACKOFF_MS[0]);

  const retried = h.core.ensureRunning("wt");
  const probes = await h.awaitProbes(2);
  assert.equal(h.spawner.lifecycleCalls().length, spawnsBefore + 2, "a fresh vite+hub pair");

  for (const probe of probes) probe.resolve();
  assert.ok(readyLifecycle(await retried), "the retry came up");
});

test("the bound holds: three retries, then parked for good", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  await failOnce(h);
  for (let attempt = 0; attempt < MAX_AUTO_RETRIES; attempt++) {
    const failed = failedLifecycle(h.core.getHandle("wt")!);
    assert.ok(failed?.retryAfter !== null, `attempt ${String(attempt)} should still be retryable`);
    h.clock.advance(RETRY_BACKOFF_MS[attempt] ?? 0);
    // Each retry fails the same way — a host that stays loaded.
    await failOnce(h);
  }

  const exhausted = failedLifecycle(h.core.getHandle("wt")!);
  assert.equal(exhausted?.attempts, MAX_AUTO_RETRIES, "the count survived every clear-and-restart");
  assert.equal(exhausted?.retryAfter, null, "terminal");

  // However long we wait now, it stays parked: nothing retries forever.
  h.clock.advance(60 * 60 * 1000);
  const spawnsBefore = h.spawner.lifecycleCalls().length;
  await assert.rejects(h.core.ensureRunning("wt"));
  assert.equal(h.spawner.lifecycleCalls().length, spawnsBefore, "no further generation");
});

test("a child dying during startup parks on the first failure, with no retry", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  const started = h.core.ensureRunning("wt");
  const rejected = assert.rejects(started, /exited during startup/u);
  await h.awaitProbes(2);
  h.spawner.lifecycleCalls()[1]?.child.fireExit(1, null);
  await rejected;

  const failed = failedLifecycle(h.core.getHandle("wt")!);
  assert.equal(failed?.lastError.phase, "childExit");
  assert.equal(failed?.retryAfter, null, "a dead child is not a busy host");

  h.clock.advance(60_000);
  const spawnsBefore = h.spawner.lifecycleCalls().length;
  await assert.rejects(h.core.ensureRunning("wt"));
  assert.equal(h.spawner.lifecycleCalls().length, spawnsBefore);
});

test("an explicit retry resets the budget, because a human asking is a fresh start", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  // Spend the whole budget.
  await failOnce(h);
  for (let attempt = 0; attempt < MAX_AUTO_RETRIES; attempt++) {
    h.clock.advance(RETRY_BACKOFF_MS[attempt] ?? 0);
    await failOnce(h);
  }
  assert.equal(failedLifecycle(h.core.getHandle("wt")!)?.retryAfter, null, "terminal before the ask");

  // POST /__router/retry/<name>.
  assert.equal(h.core.clearFailed("wt"), true);
  await failOnce(h);

  const afterAsk = failedLifecycle(h.core.getHandle("wt")!);
  assert.equal(afterAsk?.attempts, 0, "the budget reset");
  assert.equal(afterAsk?.retryAfter, h.clock.now() + RETRY_BACKOFF_MS[0]);
});

test("coming up clears the history, so a later unrelated failure gets a full budget", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  await failOnce(h);
  h.clock.advance(RETRY_BACKOFF_MS[0]);
  const retried = h.core.ensureRunning("wt");
  for (const probe of await h.awaitProbes(2)) probe.resolve();
  await retried;

  // The worktree served. A failure days later must not inherit the old count.
  await h.core.stopWorktree("wt");
  await failOnce(h);
  assert.equal(failedLifecycle(h.core.getHandle("wt")!)?.attempts, 0);
});

test("an explicit stop resets the retry budget, so the next start is not mislabelled", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  // Spend one automatic retry, then stop the worktree while that retry's
  // generation is still starting — `bin/workstreams down <name>` mid-recovery.
  await failOnce(h);
  h.clock.advance(RETRY_BACKOFF_MS[0]);
  const retried = h.core.ensureRunning("wt");
  const probes = await h.awaitProbes(2);
  await h.core.stopWorktree("wt");
  // Settle the in-flight probes, or the superseded start waits on them forever:
  // stopWorktree unlinks the handle but does not reach into the start it left
  // running. The host is still loaded, so they fail.
  for (const probe of probes) probe.reject(new FakeProbeTimeoutError());
  await retried.catch(() => {
    /* the superseded start self-cleans without publishing (invariant #5) */
  });
  await ticks(4);

  // A later cold start's first failure is attempt 0 with a full budget. Leaving
  // the count behind would quietly shorten it, for a reason nothing visible
  // explains.
  await failOnce(h);
  const failed = failedLifecycle(h.core.getHandle("wt")!);
  assert.equal(failed?.attempts, 0);
  assert.equal(failed?.retryAfter, h.clock.now() + RETRY_BACKOFF_MS[0]);
});
