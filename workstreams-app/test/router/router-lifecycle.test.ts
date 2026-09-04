// Unit tests for the pure worktree-state model (workstreams-app/src/router/router-lifecycle.ts): the
// guarded transition table and the stable-shell identity contract. These are
// the "transition-table" tests of Phase C group 6 — they need no fakes, only
// the pure module. Run with:
//   node --import tsx --test workstreams-app/test/router/router-lifecycle.test.ts
// (or `pnpm --dir workstreams-app test`, which runs the router tests with the package suite).
//
// Non-vacuity: each illegal-transition assertion fails if the `invariant()`
// guard inside transitionLifecycle is neutered (see the report). The
// identity-stability test locks in the stable-shell contract — transitions
// mutate handle.lifecycle in place and never replace the handle object.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type WorktreeHandle,
  type ReadyLifecycle,
  type StoppingLifecycle,
  WorktreeLifecycleError,
  LEGAL_TRANSITIONS,
  isLegalTransition,
  transitionLifecycle,
  createStartingHandle,
} from "../../src/router/router-lifecycle.js";

function startingHandle(name: string): WorktreeHandle {
  // createStartingHandle wires the deferred startPromise the `starting` variant
  // needs; we never call begin(), so the promise simply stays pending.
  return createStartingHandle({ name, startedAt: 0 }).handle;
}

function readyVariant(): ReadyLifecycle {
  return {
    phase: "ready",
    vitePid: 111,
    fastifyPid: 222,
    frontendPort: 5001,
    backendPort: 5002,
    dashboardPort: 5003,
    dashboardUrl: "http://localhost:5003/",
    socketDir: "/tmp/sock",
    profileDir: "/tmp/prof",
    browseEnv: {},
    logFile: "/tmp/x.log",
    sourceToken: null,
    lastActivity: 0,
    idleTimer: null,
    staleSince: null,
    lastStaleCheck: 0,
  };
}

function stoppingVariant(reason: "exited" | "requested"): StoppingLifecycle {
  return {
    phase: "stopping",
    reason,
    vitePid: 111,
    fastifyPid: 222,
    dashboardPort: 5003,
    browseEnv: {},
    killTimer: null,
  };
}

// --- transition table ---------------------------------------------------------

test("LEGAL_TRANSITIONS: the incident-derived edges, terminals are dead-ends", () => {
  assert.deepEqual(LEGAL_TRANSITIONS.starting, ["ready", "failed", "stopping"]);
  assert.deepEqual(LEGAL_TRANSITIONS.ready, ["stopping"]);
  assert.deepEqual(LEGAL_TRANSITIONS.stopping, []);
  assert.deepEqual(LEGAL_TRANSITIONS.failed, []);
  assert.equal(isLegalTransition("starting", "ready"), true);
  assert.equal(isLegalTransition("ready", "starting"), false);
  assert.equal(isLegalTransition("stopping", "ready"), false);
});

test("transitionLifecycle: legal starting → ready → stopping is allowed", () => {
  const handle = startingHandle("alpha");
  transitionLifecycle(handle, readyVariant());
  assert.equal(handle.lifecycle.phase, "ready");
  transitionLifecycle(handle, stoppingVariant("requested"));
  assert.equal(handle.lifecycle.phase, "stopping");
});

test("transitionLifecycle: starting → failed and starting → stopping are legal", () => {
  const toFailed = startingHandle("beta");
  transitionLifecycle(toFailed, {
    phase: "failed",
    lastError: { message: "boom", phase: "waitForHttp", viteOutput: "", fastifyOutput: "", at: 0 },
  });
  assert.equal(toFailed.lifecycle.phase, "failed");

  const toStopping = startingHandle("gamma");
  transitionLifecycle(toStopping, stoppingVariant("requested"));
  assert.equal(toStopping.lifecycle.phase, "stopping");
});

// --- illegal transitions throw (the invariant guard) --------------------------
// Non-vacuity: neuter the `invariant(...)` call inside transitionLifecycle and
// EVERY assertion below stops throwing — the tests then fail (see report).

test("transitionLifecycle: illegal ready → starting throws WorktreeLifecycleError", () => {
  const handle = startingHandle("delta");
  transitionLifecycle(handle, readyVariant());
  assert.throws(
    () => transitionLifecycle(handle, createStartingHandle({ name: "delta", startedAt: 0 }).handle.lifecycle),
    WorktreeLifecycleError,
  );
  // The failed move must not have mutated the handle.
  assert.equal(handle.lifecycle.phase, "ready");
});

test("transitionLifecycle: terminal stopping is a dead end (→ ready throws)", () => {
  const handle = startingHandle("epsilon");
  transitionLifecycle(handle, readyVariant());
  transitionLifecycle(handle, stoppingVariant("exited"));
  assert.throws(() => transitionLifecycle(handle, readyVariant()), WorktreeLifecycleError);
  assert.equal(handle.lifecycle.phase, "stopping");
});

test("transitionLifecycle: terminal failed is a dead end (→ stopping throws)", () => {
  const handle = startingHandle("zeta");
  transitionLifecycle(handle, {
    phase: "failed",
    lastError: { message: "x", phase: "waitForHttp", viteOutput: "", fastifyOutput: "", at: 0 },
  });
  assert.throws(() => transitionLifecycle(handle, stoppingVariant("requested")), WorktreeLifecycleError);
  assert.equal(handle.lifecycle.phase, "failed");
});

test("transitionLifecycle: starting → starting throws (no self-loop)", () => {
  const handle = startingHandle("eta");
  assert.throws(
    () => transitionLifecycle(handle, createStartingHandle({ name: "eta", startedAt: 0 }).handle.lifecycle),
    WorktreeLifecycleError,
  );
});

// --- handle-identity stability ------------------------------------------------
// The stable-shell contract: the handle object registered in the map is NEVER
// replaced through its lifecycle — transitions swap the union value in place.
// This is what makes `worktrees.get(name) === handle` a valid cross-generation
// guard during startup, not only after ready (invariants #4/#5).

test("handle identity is stable across every transition", () => {
  const handle = startingHandle("theta");
  const ref = handle;
  transitionLifecycle(handle, readyVariant());
  assert.equal(handle, ref, "ready transition must not replace the handle");
  transitionLifecycle(handle, stoppingVariant("requested"));
  assert.equal(handle, ref, "stopping transition must not replace the handle");
  // Fixed shell fields survive; only the union value changed.
  assert.equal(handle.name, "theta");
  assert.equal(handle.startedAt, 0);
  assert.equal(handle.lifecycle.phase, "stopping");
});
