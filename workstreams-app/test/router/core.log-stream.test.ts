// Each start opens one append stream for the worktree log, and the children
// pipe into it with `end: false`. Nothing ended it when the generation later
// went away, so every start of a worktree left one open file handle for the
// life of the router. The stream now ends once both children have settled.

import assert from "node:assert/strict";
import test from "node:test";
import { makeHarness, startReady, ticks } from "./core-harness.js";

/** Both children of the most recent generation exit and their execa promises settle. */
function settleChildren(h: Awaited<ReturnType<typeof makeHarness>>): void {
  for (const call of h.spawner.lifecycleCalls().slice(-2)) {
    call.child.fireExit(null, "SIGTERM");
    call.child.reject(new Error("killed"));
  }
}

test("a stopped worktree's log stream is ended once its children have exited", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  await startReady(h, "wt");
  await h.core.stopWorktree("wt");
  assert.equal(h.logStreams.length, 1);
  assert.equal(h.logStreams[0]!.writableEnded, false, "the children may still be flushing output");

  settleChildren(h);
  await ticks(2);
  assert.ok(h.logStreams[0]!.writableEnded, "the stream ended with the generation");
});

test("a worktree started twice leaves no open stream behind", async (t) => {
  const h = await makeHarness();
  t.after(() => h.cleanup());
  await startReady(h, "wt");
  // The ready generation's fastify dies; onChildExit tears the generation down.
  settleChildren(h);
  await ticks(2);
  await startReady(h, "wt");
  await h.core.stopWorktree("wt");
  settleChildren(h);
  await ticks(2);

  assert.equal(h.logStreams.length, 2, "one stream per start");
  assert.ok(h.logStreams.every((s) => s.writableEnded), "neither start left its stream open");
});
