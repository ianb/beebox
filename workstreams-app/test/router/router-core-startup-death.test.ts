// Track 1 of docs/plans/router-transient-failure-resilience.md: during startup,
// a dying child is a signal and the clock is only a backstop.
//
// The 2026-09-15 outage was a healthy generation given up on: a cold Vite under
// two parallel test suites could not answer within a fixed 30s, and the worktree
// parked as permanently failed for three hours. Making the budget generous is
// only safe because a child that genuinely dies now fails the start at once
// instead of waiting the budget out — these tests pin both halves.

import assert from "node:assert/strict";
import test from "node:test";
import { failedLifecycle, readyLifecycle } from "../../src/router/router-lifecycle.js";
import { FakeProbeTimeoutError, makeHarness, ticks, type Harness } from "./router-core-harness.js";

/** The lifecycle spawns, in the order `spawnGeneration` makes them. */
function children(h: Harness): { fastify: { fireExit: (c: number | null, s: NodeJS.Signals | null) => void }; vite: { fireExit: (c: number | null, s: NodeJS.Signals | null) => void } } {
  const calls = h.spawner.lifecycleCalls();
  const fastify = calls[0]?.child;
  const vite = calls[1]?.child;
  assert.ok(fastify && vite, "both lifecycle children were spawned");
  return { fastify, vite };
}

test("a child that dies during startup fails the start without waiting out the budget", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  const started = h.core.ensureRunning("wt");
  // Probes are pending — nothing will resolve them. Under the old shape the
  // only way out of here was the 30s stopwatch.
  await h.awaitProbes(2);

  children(h).vite.fireExit(1, null);

  await assert.rejects(started, /vite exited during startup/u);
  const handle = h.core.getHandle("wt");
  assert.ok(handle, "the failure is parked, not discarded");
  const failed = failedLifecycle(handle);
  assert.ok(failed, "the generation parked as failed");
  // The phase is the whole point: track 2 dispatches on it, and only
  // `waitForHttp` earns an automatic retry.
  assert.equal(failed.lastError.phase, "childExit");
});

test("the backend dying is reported as the backend, not as a generic timeout", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  const started = h.core.ensureRunning("wt");
  await h.awaitProbes(2);
  children(h).fastify.fireExit(null, "SIGSEGV");

  await assert.rejects(started, /fastify exited during startup \(code=null signal=SIGSEGV\)/u);
});

test("both children dying settles the start once, not twice", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  const started = h.core.ensureRunning("wt");
  await h.awaitProbes(2);

  // Attach the handler BEFORE the exits: a rejection that settles with nothing
  // watching is an unhandledRejection, which is the failure mode under test
  // rather than an artefact to tolerate.
  const settled = assert.rejects(started, /vite exited during startup/u);

  const { vite, fastify } = children(h);
  vite.fireExit(1, null);
  fastify.fireExit(1, null);
  await ticks(4);

  // The first rejection wins; the second is a no-op on an already-settled
  // promise. A double-settle would surface here as an unhandled rejection.
  await settled;
  const failed = failedLifecycle(h.core.getHandle("wt")!);
  assert.equal(failed?.lastError.phase, "childExit");
});

test("a slow but living child is still awaited well past the old 30s budget", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  const started = h.core.ensureRunning("wt");
  const probes = await h.awaitProbes(2);

  // The old budget would have expired here. Nothing has died, so the start is
  // still in flight — this is the 2026-09-15 generation, which was healthy.
  h.clock.advance(60_000);
  await ticks(4);
  assert.equal(h.core.getHandle("wt")?.lifecycle.phase, "starting", "still starting, not parked");

  // It answers late, and that is a success rather than an outage.
  for (const probe of probes) probe.resolve();
  const handle = await started;
  assert.ok(readyLifecycle(handle), "the late generation published ready");
});

test("after ready, the same listener tears the generation down on an exit", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());

  await h.core.ensureRunning("wt");
  assert.ok(readyLifecycle(h.core.getHandle("wt")!), "generation is serving");

  // No second listener was attached at publication; this is the one from
  // spawnGeneration, now dispatching on the `ready` phase instead.
  children(h).vite.fireExit(0, null);
  await ticks(4);

  assert.equal(h.core.getHandle("wt"), undefined, "the dead generation left the map");
});

test("a child exiting after the generation already parked is a no-op", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  h.manualProbes();

  const started = h.core.ensureRunning("wt");
  const probes = await h.awaitProbes(2);
  // The harness already models this failure — it is the one the outage hit.
  probes[0]?.reject(new FakeProbeTimeoutError());
  await assert.rejects(started);

  const parked = h.core.getHandle("wt");
  assert.ok(failedLifecycle(parked!), "parked");

  // failStart kills both children, so their exits arrive at a `failed` handle.
  // onChildExit's own `if (!ready) return` is what makes that safe, and the
  // record must survive it — otherwise the failed page and the retry endpoint
  // would lose the error they exist to show.
  const { vite, fastify } = children(h);
  vite.fireExit(null, "SIGTERM");
  fastify.fireExit(null, "SIGTERM");
  await ticks(4);

  assert.equal(h.core.getHandle("wt"), parked, "the parked record is untouched");
  assert.equal(failedLifecycle(parked!)?.lastError.phase, "waitForHttp");
});
