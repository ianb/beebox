// Incident tests for the worktree lifecycle engine's STARTUP path
// (bin/router-core.ts → bin/router-worktree-start.ts): TOCTOU dedupe
// (bin/docs/router-protocol.md invariant #2), backend source freshness, and
// rejection discipline (#3). The teardown-side incidents (#4, #5, #6) live in
// bin/router-core-teardown.test.ts; both drive the same deterministic fakes from
// bin/router-core-harness.ts.
//
// Run with:
//   node --import tsx --test bin/router-core.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).
//
// NON-VACUITY: every incident test fails when the guard it covers is neutered —
// the specific neuter and observed failure are recorded in the implementation
// report.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeChildExitError, makeHarness, startReady, ticks } from "./router-core-harness.js";
import { readyLifecycle } from "./router-lifecycle.js";

// --- group 2: TOCTOU dedupe (invariant #2) ------------------------------------

test("dedupe: two concurrent ensureRunning(name) share ONE start and one handle", async () => {
  const h = await makeHarness();
  try {
    const [a, b] = await Promise.all([h.core.ensureRunning("wt"), h.core.ensureRunning("wt")]);
    assert.equal(a, b, "both callers get the same handle");
    assert.equal(h.core.getHandle("wt"), a);
    // Exactly one vite + one fastify spawned — not two pairs.
    assert.equal(h.spawner.lifecycleCalls().length, 2, "one lifecycle pair, not two");
    const fastify = h.spawner.lifecycleCalls()[0];
    assert.equal(fastify?.options.env?.CB_DEV_SURFACES, "1", "hub backend explicitly enables dev surfaces");
  } finally {
    await h.cleanup();
  }
});

test("direct backend explicitly enables development surfaces too", async () => {
  const h = await makeHarness({ devNoHub: true });
  try {
    await startReady(h, "wt");
    const fastify = h.spawner.lifecycleCalls()[0];
    assert.ok(fastify?.args.includes("./src/webapp/server-main.ts"));
    assert.equal(fastify?.options.env?.CB_DEV_SURFACES, "1");
  } finally {
    await h.cleanup();
  }
});

test("404 corollary: an unknown name leaves NO phantom map entry", async () => {
  const h = await makeHarness();
  try {
    h.unknownNames.add("ghost");
    await assert.rejects(() => h.core.ensureRunning("ghost"), /not found/);
    // The detached .catch cleanup runs a microtask later — flush, then assert.
    await ticks(2);
    assert.equal(h.core.getHandle("ghost"), undefined, "no phantom starting entry left behind");
  } finally {
    await h.cleanup();
  }
});

// --- source freshness: a running generation vs. the code on disk --------------
//
// The hub executes TypeScript straight from the checkout, and nothing reloads
// it, so a merge landing under a running generation leaves it serving the old
// code while the router keeps calling it ready
// (issues/bugs/2026-08-15-main-runtime-stays-stale-after-deploy-build.md).
// These cover the noticing. There is deliberately no restart to cover: the
// router's only activity signal is HTTP, so it cannot tell a chat streaming
// over a WebSocket from an idle worktree, and has no moment it can prove safe.

test("source freshness: a token that moves under a ready generation marks it stale", async () => {
  const h = await makeHarness();
  try {
    const handle = await startReady(h, "wt");
    const ready = readyLifecycle(handle)!;
    assert.equal(ready.staleSince, null, "fresh at start");

    h.sourceToken.value = "src-gen-2"; // a merge lands
    h.clock.advance(6_000); // past the throttle
    await h.core.ensureRunning("wt");
    await ticks(4); // the check is fire-and-forget off the request path

    assert.equal(typeof ready.staleSince, "number", "the request after the change reports it");
  } finally {
    await h.cleanup();
  }
});

test("source freshness: an unchanged token never marks a generation stale, and the check is throttled", async () => {
  const h = await makeHarness();
  try {
    const handle = await startReady(h, "wt");
    const ready = readyLifecycle(handle)!;

    h.clock.advance(6_000);
    await h.core.ensureRunning("wt");
    await ticks(4);
    assert.equal(ready.staleSince, null, "same source, nothing to report");

    // Within the throttle window the token is not consulted at all: move it and
    // the answer must not change until the window elapses.
    h.sourceToken.value = "src-gen-2";
    await h.core.ensureRunning("wt");
    await ticks(4);
    assert.equal(ready.staleSince, null, "throttled — not rechecked yet");

    h.clock.advance(6_000);
    await h.core.ensureRunning("wt");
    await ticks(4);
    assert.equal(typeof ready.staleSince, "number", "rechecked once the window passed");
  } finally {
    await h.cleanup();
  }
});

test("source freshness: an uncomputable token disables the comparison instead of crying stale", async () => {
  const h = await makeHarness();
  h.sourceToken.value = null; // e.g. a checkout with no callback-box/src
  try {
    const handle = await startReady(h, "wt");
    const ready = readyLifecycle(handle)!;
    assert.equal(ready.sourceToken, null);

    h.sourceToken.value = "src-gen-2";
    h.clock.advance(6_000);
    await h.core.ensureRunning("wt");
    await ticks(4);
    assert.equal(ready.staleSince, null, "no baseline to compare against — stays quiet");
  } finally {
    await h.cleanup();
  }
});

// --- group 3: rejection discipline (invariant #3) -----------------------------

test("rejection discipline: a child rejecting at spawn time raises NO unhandledRejection", async () => {
  const h = await makeHarness();
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    // Every lifecycle child rejects on the microtask right after spawn returns.
    h.spawner.rejectLifecycleWith = new FakeChildExitError();
    await startReady(h, "wt"); // start still completes (rejection is orthogonal)
    // Give any unhandledRejection ample time to surface (it fires a tick later).
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(seen, [], "invariant #3: spawn-site .catch swallowed the rejection");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await h.cleanup();
  }
});
