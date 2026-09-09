// Incident tests for the worktree lifecycle engine's TEARDOWN and publication
// paths (workstreams-app/src/router/router-worktree-teardown.ts, plus the guarded terminals in
// workstreams-app/src/router/router-worktree-start.ts): stale child exit (bin/docs/router-protocol.md
// invariant #4), guarded publication (#5), full-router shutdown, and the pidfile
// store's per-name serialization (#6, via router-pidfile.ts's fs seam). The
// startup-side incidents live in workstreams-app/test/router/router-core.test.ts; both drive the same
// deterministic fakes from workstreams-app/src/router/router-core-harness.ts.
//
// Run with:
//   node --import tsx --test workstreams-app/test/router/router-core-teardown.test.ts
// (or `pnpm --dir workstreams-app test`, which runs the router tests with the package suite).
//
// NON-VACUITY: every incident test fails when the guard it covers is neutered —
// the specific neuter and observed failure are recorded in the implementation
// report.

import assert from "node:assert/strict";
import { test } from "node:test";
import { listenLoopback } from "../../src/router/router-core.js";
import {
  deferred,
  type Deferred,
  FakeDiskFullError,
  FakeMissingFileError,
  FakeProbeTimeoutError,
  makeHarness,
  startReady,
  ticks,
} from "./router-core-harness.js";
import { createPidStore, type PidStoreFs } from "../../src/router/router-pidfile.js";
import { readyLifecycle } from "../../src/router/router-lifecycle.js";

// --- group 4: stale exit (invariant #4) ---------------------------------------

test("stale exit: a replaced generation's exit does NOT tear down the live READY entry", async () => {
  const h = await makeHarness();
  try {
    const a = await startReady(h, "wt");
    const aVite = h.spawner.lifecycleCalls()[1]!.child; // [0]=fastify, [1]=vite of A

    // SIGTERM A (unlinks it), then bring a fresh generation B all the way to
    // READY — this is the 2026-06-09 incident shape: A's child drains for ~10s
    // and its exit lands only AFTER B is up and serving under the same name.
    await h.core.stopWorktree("wt");
    const b = await startReady(h, "wt");
    assert.ok(b !== a, "B is a distinct handle mapped under the same name");
    assert.ok(readyLifecycle(b), "B is serving");

    // A's delayed exit finally lands. onChildExit operates on A's OWN handle and
    // the identity guard confirms A is no longer current — so this reduces to a
    // log line. A NAME-keyed teardown (the old bug) would kill READY B instead.
    aVite.fireExit(0, "SIGTERM");

    assert.equal(h.core.getHandle("wt"), b, "the live ready entry B is untouched by A's stale exit");
    assert.ok(readyLifecycle(h.core.getHandle("wt")!), "B is still serving, not torn down");
  } finally {
    await h.cleanup();
  }
});

test("SIGKILL escalation targets exactly the stopped generation's pids", async () => {
  const h = await makeHarness();
  try {
    const a = await startReady(h, "wt");
    const fastifyPid = h.spawner.lifecycleCalls()[0]!.child.pid;
    const vitePid = h.spawner.lifecycleCalls()[1]!.child.pid;

    await h.core.stopWorktree("wt"); // SIGTERM now + schedules the SIGKILL escalation
    assert.ok(a);

    const sigkillsBefore = h.killCalls.filter((k) => k.signal === "SIGKILL");
    assert.equal(sigkillsBefore.length, 0, "no SIGKILL until the grace elapses");

    h.clock.advance(2_000); // past killGraceMs

    const sigkilled = h.killCalls.filter((k) => k.signal === "SIGKILL").map((k) => k.pid);
    // Honestly scoped: this pins that the escalation closes over THIS generation's
    // pids (not an identity guard). Both children, exactly.
    assert.deepEqual(sigkilled.toSorted(), [fastifyPid, vitePid].toSorted());
  } finally {
    await h.cleanup();
  }
});

// --- group 5: guarded publication (invariant #5) ------------------------------

test("stop-during-start: a superseded start self-cleans and does NOT publish", async () => {
  const h = await makeHarness();
  try {
    h.manualProbes();
    const startP = h.core.ensureRunning("wt");
    const probes = await h.awaitProbes(2); // let start reach waitForHttp
    assert.equal(probes.length, 2, "both readiness probes are pending");

    const fastifyPid = h.spawner.lifecycleCalls()[0]!.child.pid;
    const vitePid = h.spawner.lifecycleCalls()[1]!.child.pid;

    // Stop while the start is mid-await — unlinks the starting handle.
    await h.core.stopWorktree("wt");

    // Now readiness completes — the start finds itself superseded.
    for (const p of probes) p.resolve();
    await startP;

    // It must NOT reappear in the map, and it must have killed its OWN children.
    assert.equal(h.core.getHandle("wt"), undefined, "the completed start did not resurrect the entry");
    const termed = h.killCalls.filter((k) => k.signal === "SIGTERM").map((k) => k.pid).toSorted();
    assert.deepEqual(termed, [fastifyPid, vitePid].toSorted(), "superseded start self-cleaned its children");
    assert.ok(
      h.removeCalls.some((r) => r.name === "wt" && r.expect?.vitePid === vitePid),
      "superseded start removed its own (generation-guarded) pidfile",
    );
  } finally {
    await h.cleanup();
  }
});

test("stale failure: a superseded start's failure self-cleans and cannot park a stale `failed`", async () => {
  const h = await makeHarness();
  try {
    h.manualProbes();
    const aPromise = h.core.ensureRunning("wt");
    const aProbes = await h.awaitProbes(2);
    assert.equal(aProbes.length, 2);
    const handleA = h.core.getHandle("wt")!; // capture A's shell before it's superseded
    const aFastifyPid = h.spawner.lifecycleCalls()[0]!.child.pid;
    const aVitePid = h.spawner.lifecycleCalls()[1]!.child.pid;

    // Supersede A with a fresh generation B (still starting).
    await h.core.stopWorktree("wt");
    const bPromise = h.core.ensureRunning("wt");
    const bProbesEarly = await h.awaitProbes(2); // B's probes — leave them pending
    const b = h.core.getHandle("wt");
    assert.ok(b, "B registered");

    // A's readiness now FAILS.
    for (const p of aProbes) p.reject(new FakeProbeTimeoutError());
    await assert.rejects(() => aPromise, /did not respond/);

    // B is untouched and still starting; no `failed` record clobbered its slot.
    // (This protection is STRUCTURAL — the failure terminal transitions A's
    // detached shell in place and never re-sets the map, so B is safe even
    // without the guard; see the report's #5b neuter, which must ALSO reintroduce
    // the old `worktrees.set` to break B.)
    assert.equal(h.core.getHandle("wt"), b, "B still owns the name");
    assert.equal(b!.lifecycle.phase, "starting", "B was not overwritten by A's failure");
    // The RUNTIME guard's uniquely-observable effect: a superseded failure routes
    // A to `stopping` (self-clean), NOT `failed`. Removing the guard alone flips
    // this to `failed` — so this assertion depends on the guard itself.
    assert.equal(handleA.lifecycle.phase, "stopping", "superseded A self-cleaned to stopping, not failed");
    assert.equal(
      handleA.lifecycle.phase === "stopping" ? handleA.lifecycle.reason : null,
      "requested",
      "self-clean uses the awaited 'requested' teardown contract",
    );
    // A self-cleaned its own children.
    const termed = h.killCalls.filter((k) => k.signal === "SIGTERM").map((k) => k.pid);
    assert.ok(termed.includes(aVitePid) && termed.includes(aFastifyPid), "A self-cleaned its children");

    // Drain B so it doesn't leak into later tests.
    for (const p of bProbesEarly) p.resolve();
    await bPromise;
  } finally {
    await h.cleanup();
  }
});

test("pidStore.write failure between spawn and waitForHttp still kills both children (cross-phase review)", async () => {
  const h = await makeHarness();
  try {
    h.failNextPidWrite.value = new FakeDiskFullError();
    await assert.rejects(() => h.core.ensureRunning("wt"), /ENOSPC/);

    const fastifyPid = h.spawner.lifecycleCalls()[0]!.child.pid;
    const vitePid = h.spawner.lifecycleCalls()[1]!.child.pid;

    // Before the cross-phase fix, this failure fell OUTSIDE the only try/catch
    // (which wrapped just the waitForHttp probes), so neither child was killed,
    // no pidfile cleanup ran, and no terminal transition happened — a leaked
    // vite+fastify pair with a still-`starting` (then dropped) handle.
    const termed = h.killCalls.filter((k) => k.signal === "SIGTERM").map((k) => k.pid).toSorted();
    assert.deepEqual(termed, [fastifyPid, vitePid].toSorted(), "both children killed despite the pre-probe failure");
    assert.ok(
      h.removeCalls.some((r) => r.name === "wt"),
      "pidfile cleanup ran even though the write that would have created it failed",
    );
    assert.equal(h.core.getHandle("wt")?.lifecycle.phase, "failed", "parked as `failed`, not a phantom `starting`");
  } finally {
    await h.cleanup();
  }
});

// --- shutdown (cross-phase review: stopAllChildren vs. in-flight starts) -----

test("shutdown supersedes an in-flight start: it self-cleans instead of publishing after teardown", async () => {
  const h = await makeHarness();
  try {
    h.manualProbes();
    const startP = h.core.ensureRunning("wt");
    const probes = await h.awaitProbes(2); // start is now parked in waitForHttp
    assert.equal(probes.length, 2);
    assert.equal(h.core.getHandle("wt")?.lifecycle.phase, "starting", "still mid cold-start");

    assert.equal(h.spawner.lifecycleCalls().length, 2, "vite + fastify were spawned for this start");
    const fastifyPid = h.spawner.lifecycleCalls()[0]!.child.pid;
    const vitePid = h.spawner.lifecycleCalls()[1]!.child.pid;

    // Full-router shutdown runs WHILE the start is still in flight.
    const shutdownP = h.core.stopAllChildren();

    // stopAllChildren must have unlinked the starting handle immediately
    // (synchronously, before its own `sleep(500)`) — it can't wait on the
    // start's own probes to resolve since it doesn't control them.
    assert.equal(h.core.getHandle("wt"), undefined, "starting handle superseded up front");

    // Readiness now resolves — the start finds itself superseded and self-cleans.
    for (const p of probes) p.resolve();
    const startedHandle = await startP;
    await shutdownP;

    assert.equal(startedHandle.lifecycle.phase, "stopping", "superseded start completed via self-clean");
    assert.equal(startedHandle.lifecycle.reason, "requested", "self-clean follows the shutdown reason");
    const termed = h.killCalls.filter((k) => k.signal === "SIGTERM").map((k) => k.pid).toSorted();
    assert.deepEqual(termed, [fastifyPid, vitePid].toSorted(), "shutdown's supersession made the start self-clean");
    assert.ok(
      h.removeCalls.some((r) => r.name === "wt" && r.expect?.vitePid === vitePid),
      "the superseded start removed its own pidfile",
    );
    assert.equal(h.core.getHandle("wt"), undefined, "still nothing published after shutdown resolved");
  } finally {
    await h.cleanup();
  }
});

// --- group 1: pidfile TOCTOU serialization (invariant #6) ----------------------
// This exercises the REAL createPidStore's per-name promise chain via an
// injectable, barrier-gated fs backend — a synchronous fake can't force the
// read-then-unlink window the serialization closes. Neuter: replace `serialize`
// with `op()` (run immediately, no chain) and this test fails (N+1's record is
// deleted by N's unlink).

test("pidfile serialization: a write cannot be clobbered by a concurrent stale remove", async () => {
  // In-memory fs with a releasable barrier on the stale remove's unlink.
  const files = new Map<string, string>();
  let unlinkGate: Deferred | null = null;
  let sawRemoveRead = false;

  const backend: PidStoreFs = {
    mkdir: async () => {},
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new FakeMissingFileError();
      sawRemoveRead = true;
      return v;
    },
    writeFile: async (p, content) => {
      files.set(p, content);
    },
    unlink: async (p) => {
      if (unlinkGate) await unlinkGate.promise; // hold the stale remove mid-op
      files.delete(p);
    },
  };

  const store = createPidStore("/pids", backend);
  const rec = (vitePid: number, fastifyPid: number) => ({
    name: "wt",
    vitePid,
    fastifyPid,
    frontendPort: 1,
    backendPort: 2,
    dashboardPort: null,
    socketDir: "/s",
    profileDir: "/p",
    routerPid: 9,
    startedAt: 0,
  });

  // Generation N lands its record.
  await store.write("wt", rec(100, 200));

  // Generation N's teardown removes (expect N's pids) — gate its unlink so it
  // pauses AFTER reading + matching, BEFORE unlinking.
  unlinkGate = deferred();
  const removeN = store.remove("wt", { vitePid: 100, fastifyPid: 200 });

  // Generation N+1 writes its fresh record while N is paused. Serialization must
  // queue this write AFTER N's remove fully completes.
  const writeN1 = store.write("wt", rec(300, 400));

  await ticks(3); // give both a chance to interleave if unserialized
  assert.ok(sawRemoveRead, "the stale remove read the record");
  assert.equal(
    JSON.parse(files.get("/pids/wt.json")!).vitePid,
    100,
    "serialized: N+1's write has NOT run yet (still queued behind N's remove)",
  );

  // Release N's unlink; then N+1's write runs.
  unlinkGate.resolve();
  await Promise.all([removeN, writeN1]);

  const final = files.get("/pids/wt.json");
  assert.ok(final, "N+1's record survives — not clobbered by N's stale unlink");
  assert.equal(JSON.parse(final).vitePid, 300, "the surviving record is N+1's");
});

// --- listenLoopback: the router must never bind a routable interface --------
// (docs/implemented-plans/tailscale-expose-and-protect.md Track A: the router's
// `/__router/*` control routes are unauthenticated, so exposure is a security
// hole, not a feature. This exercises the real listen path main() uses.)

test("listenLoopback binds 127.0.0.1 only", async () => {
  const http = await import("node:http");
  const server = http.createServer();
  await new Promise<void>((resolve) => {
    listenLoopback(server, { port: 0, onListening: resolve });
  });
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object", "server has a bound address");
    assert.equal(addr.address, "127.0.0.1", "bound to loopback, not a routable interface");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
