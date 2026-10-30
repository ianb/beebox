// A start that fails before any child is spawned parks like one that fails
// after: resolving the box list (BOXES=, TEST_BOXES=) happens after the log
// stream is open, and a throw there used to bypass `failStart`. ensureRunning
// then dropped the bare `starting` handle, so every request re-ran the whole
// start and opened one more log stream that nothing closed.

import assert from "node:assert/strict";
import test from "node:test";
import { failedLifecycle } from "../../src/router/lifecycle.js";
import { FakeBoxResolutionError, makeHarness, ticks } from "./core-harness.js";

test("a box list that does not resolve parks the start as failed and closes its log", async (t) => {
  const h = await makeHarness({ boxes: ["/boxes/gone"] });
  t.after(() => h.cleanup());
  h.failBoxResolution.value = new FakeBoxResolutionError();

  await assert.rejects(h.core.ensureRunning("wt"), /no box at \/boxes\/gone/u);
  await ticks(2);

  const failed = failedLifecycle(h.core.getHandle("wt")!);
  assert.ok(failed, "the record is parked as failed, so the failed-startup page shows it");
  assert.equal(failed.lastError.phase, "resolveBoxes");
  assert.equal(failed.retryAfter, null, "a broken box list is not retried automatically");
  assert.equal(h.spawner.lifecycleCalls().length, 0, "no child was spawned");

  // A second request is refused from the parked record; it does not start again.
  await assert.rejects(h.core.ensureRunning("wt"), /no box at \/boxes\/gone/u);
  assert.equal(h.logStreams.length, 1, "the start ran once");
  assert.ok(h.logStreams.every((s) => s.writableEnded), "the log stream it opened was ended");
});

test("a TEST_BOXES entry that BOXES does not serve refuses to start, naming the entry", async (t) => {
  const h = await makeHarness({ boxes: ["/boxes/own"], testBoxes: ["/boxes/test1"] });
  t.after(() => h.cleanup());

  await assert.rejects(h.core.ensureRunning("main"), /TEST_BOXES lists "\/boxes\/test1", which BOXES does not serve/u);
  const failed = failedLifecycle(h.core.getHandle("main")!);
  assert.equal(failed?.lastError.phase, "resolveBoxes");
  assert.equal(h.spawner.lifecycleCalls().length, 0, "the real boxes were not started without it");
});

test("TEST_BOXES under the no-hub mode parks instead of retrying every request", async (t) => {
  const h = await makeHarness({ devNoHub: true, boxes: ["/boxes/test1"], testBoxes: ["/boxes/test1"] });
  t.after(() => h.cleanup());

  await assert.rejects(h.core.ensureRunning("main"), /TEST_BOXES needs the hub/u);
  await assert.rejects(h.core.ensureRunning("main"), /TEST_BOXES needs the hub/u);
  assert.ok(failedLifecycle(h.core.getHandle("main")!), "parked");
  assert.equal(h.logStreams.length, 1, "the start ran once");
  assert.ok(h.logStreams.every((s) => s.writableEnded), "the log stream it opened was ended");
});

test("a retry from the failed page starts again after the box list is fixed", async (t) => {
  const h = await makeHarness({ boxes: ["/boxes/test1"] });
  t.after(() => h.cleanup());
  h.failBoxResolution.value = new FakeBoxResolutionError();
  await assert.rejects(h.core.ensureRunning("wt"));

  h.failBoxResolution.value = undefined;
  assert.equal(h.core.clearFailed("wt"), true);
  const handle = await h.core.ensureRunning("wt");
  assert.equal(handle.lifecycle.phase, "ready");
});
