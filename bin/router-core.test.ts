// Incident tests for the worktree lifecycle engine (bin/router-core.ts), driven
// by deterministic fakes: a manual clock owning every TimerHandle, a controllable
// spawner (capturable exit callbacks, rejectable promises, assigned pids), a
// recording killGroup, and manual HTTP-readiness probes. They reproduce the
// documented concurrency incidents (bin/docs/router-protocol.md invariants #2–#6)
// and the pidfile-store serialization (#6, via router-pidfile.ts's fs seam).
//
// Run with:
//   node --import tsx --test bin/router-core.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).
//
// NON-VACUITY: every incident test fails when the guard it covers is neutered —
// the specific neuter and observed failure are recorded in the implementation
// report. Log output is silenced by default (a no-op `log`) so a passing run is
// quiet; flip `LOG` below to debug.

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createRouterCore,
  type RouterCore,
  type RouterEffects,
  type SpawnOptions,
  type SpawnedChild,
  type ResolvedWorktree,
} from "./router-core.js";
import { createPidStore, type PidStoreFs, type PidExpectation } from "./router-pidfile.js";
import { readyLifecycle, type TimerHandle, type WorktreeHandle } from "./router-lifecycle.js";

const LOG = false;

// A settled/unsettled turn of the event loop, draining microtasks AND the libuv
// callbacks the core's real fs.mkdir/createWriteStream sit on.
function tick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}
async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await tick();
}

// --- fake clock: owns every TimerHandle the core arms -------------------------

interface ScheduledTimer {
  id: number;
  dueAt: number;
  fn: () => void;
  cancelled: boolean;
}

class FakeClock {
  private t = 1_000;
  private nextId = 1;
  readonly timers: ScheduledTimer[] = [];

  now = (): number => this.t;

  setTimer = (ms: number, fn: () => void): TimerHandle => {
    const timer: ScheduledTimer = { id: this.nextId++, dueAt: this.t + ms, fn, cancelled: false };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  };

  clearTimer = (handle: TimerHandle): void => handle.cancel();

  /** Advance virtual time, firing (once) every due, uncancelled timer in order. */
  advance(ms: number): void {
    this.t += ms;
    const due = this.timers
      .filter((x) => !x.cancelled && x.dueAt <= this.t)
      .sort((a, b) => a.dueAt - b.dueAt);
    for (const timer of due) {
      timer.cancelled = true; // fire once
      timer.fn();
    }
  }

  pendingCount(): number {
    return this.timers.filter((x) => !x.cancelled).length;
  }
}

// --- fake spawner: controllable children --------------------------------------

interface FakeChild extends SpawnedChild {
  /** Invoke the exit listener the core registered via `.on("exit", …)`. */
  fireExit(code: number | null, signal: NodeJS.Signals | null): void;
  /** Reject the underlying execa-style promise (an exiting/failed child). */
  reject(err: unknown): void;
}

function makeChild(pid: number, autoResolve: boolean, rejectOnMicrotask: unknown | undefined): FakeChild {
  let rejectFn: (e: unknown) => void = () => {};
  let resolveFn: (v: unknown) => void = () => {};
  const base = new Promise<unknown>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  let exitListener: ((c: number | null, s: NodeJS.Signals | null) => void) | null = null;
  if (autoResolve) resolveFn(undefined);
  if (rejectOnMicrotask !== undefined) {
    // Reject on the microtask immediately after the spawn effect returns —
    // pinning invariant #3's catch-at-spawn-site (the core's very next line).
    queueMicrotask(() => rejectFn(rejectOnMicrotask));
  }
  const child: FakeChild = Object.assign(base, {
    pid,
    stdout: null,
    stderr: null,
    on(_event: "exit", listener: (c: number | null, s: NodeJS.Signals | null) => void): void {
      exitListener = listener;
    },
    fireExit(c: number | null, s: NodeJS.Signals | null): void {
      exitListener?.(c, s);
    },
    reject(err: unknown): void {
      rejectFn(err);
    },
  });
  return child;
}

interface SpawnCall {
  command: string;
  args: string[];
  child: FakeChild;
}

class FakeSpawner {
  private nextPid = 1000;
  readonly calls: SpawnCall[] = [];
  /** When set, every LIFECYCLE child (vite/fastify) rejects on a microtask. */
  rejectLifecycleWith: unknown | undefined = undefined;

  spawn = (command: string, args: string[], _options: SpawnOptions): SpawnedChild => {
    const isDashboard = args.includes("dashboard");
    const child = makeChild(
      this.nextPid++,
      /* autoResolve */ isDashboard, // dashboard commands are awaited; resolve them
      /* rejectOnMicrotask */ isDashboard ? undefined : this.rejectLifecycleWith,
    );
    this.calls.push({ command, args, child });
    return child;
  };

  /** The lifecycle (non-dashboard) spawns, in order: [0]=fastify, [1]=vite. */
  lifecycleCalls(): SpawnCall[] {
    return this.calls.filter((c) => !c.args.includes("dashboard"));
  }
}

// --- recording killGroup ------------------------------------------------------

interface KillCall {
  pid: number | undefined;
  signal: string;
}

// --- manual HTTP-readiness probes ---------------------------------------------

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --- harness ------------------------------------------------------------------

interface Harness {
  core: RouterCore;
  clock: FakeClock;
  spawner: FakeSpawner;
  killCalls: KillCall[];
  removeCalls: { name: string; expect: PidExpectation | undefined }[];
  /** Switch readiness to manual (probes pend until resolved/rejected). */
  manualProbes(): void;
  /** Pending probes created since the last take, cleared out. */
  takePendingProbes(): Deferred[];
  /** Tick the loop until at least `count` probes are pending, then take them.
   *  (Cold start has several real-fs awaits before it reaches waitForHttp.) */
  awaitProbes(count: number): Promise<Deferred[]>;
  /** Names the resolver should treat as unknown (→ 404 from startWorktree). */
  unknownNames: Set<string>;
  cleanup(): Promise<void>;
}

async function makeHarness(): Promise<Harness> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "router-core-test-"));
  const clock = new FakeClock();
  const spawner = new FakeSpawner();
  const killCalls: KillCall[] = [];
  const removeCalls: Harness["removeCalls"] = [];
  const unknownNames = new Set<string>();

  let probeMode: "auto" | "manual" = "auto";
  let pendingProbes: Deferred[] = [];

  const effects: RouterEffects = {
    spawn: spawner.spawn,
    killGroup: (pid, signal) => {
      killCalls.push({ pid, signal: signal ?? "SIGTERM" });
    },
    pidAlive: () => false,
    waitForHttp: () => {
      if (probeMode === "auto") return Promise.resolve();
      const d = deferred();
      pendingProbes.push(d);
      return d.promise;
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    sleep: () => Promise.resolve(),
    // In-memory pidfile store for the core harness (the barrier-gated store that
    // proves serialization is exercised separately, in the pidfile test below).
    pidStore: {
      write: async () => undefined,
      remove: async (name, expect) => {
        removeCalls.push({ name, expect });
      },
    },
    writeHubConfig: async () => path.join(tmp, "hub.json"),
    getPort: (() => {
      let p = 6000;
      return () => Promise.resolve(p++);
    })(),
    resolveWorktree: async (name): Promise<ResolvedWorktree | null> => {
      if (unknownNames.has(name)) return null;
      return { name, root: tmp, backendCwd: tmp, frontendCwd: tmp, boxes: [] };
    },
    resolveBoxEntries: async () => [],
  };

  const core = createRouterCore(effects, {
    idleTimeoutMs: 300_000,
    killGraceMs: 2_000,
    logDir: path.join(tmp, "logs"),
    browseDir: path.join(tmp, "browse"),
    agentBrowserBin: path.join(tmp, "agent-browser.js"),
    devNoHub: false,
    routerPid: 4242,
    log: LOG ? (m) => console.log(m) : () => {},
  });

  return {
    core,
    clock,
    spawner,
    killCalls,
    removeCalls,
    unknownNames,
    manualProbes: () => {
      probeMode = "manual";
    },
    takePendingProbes: () => {
      const out = pendingProbes;
      pendingProbes = [];
      return out;
    },
    awaitProbes: async (count) => {
      for (let i = 0; i < 100 && pendingProbes.length < count; i++) await tick();
      const out = pendingProbes;
      pendingProbes = [];
      return out;
    },
    cleanup: () => fs.rm(tmp, { recursive: true, force: true }),
  };
}

/** Drive a cold start to `ready` (auto probes) and return its handle. */
async function startReady(h: Harness, name: string): Promise<WorktreeHandle> {
  const handle = await h.core.ensureRunning(name);
  return handle;
}

// --- group 2: TOCTOU dedupe (invariant #2) ------------------------------------

test("dedupe: two concurrent ensureRunning(name) share ONE start and one handle", async () => {
  const h = await makeHarness();
  try {
    const [a, b] = await Promise.all([h.core.ensureRunning("wt"), h.core.ensureRunning("wt")]);
    assert.equal(a, b, "both callers get the same handle");
    assert.equal(h.core.getHandle("wt"), a);
    // Exactly one vite + one fastify spawned — not two pairs.
    assert.equal(h.spawner.lifecycleCalls().length, 2, "one lifecycle pair, not two");
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
    h.spawner.rejectLifecycleWith = new Error("child exited 1");
    await startReady(h, "wt"); // start still completes (rejection is orthogonal)
    // Give any unhandledRejection ample time to surface (it fires a tick later).
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(seen, [], "invariant #3: spawn-site .catch swallowed the rejection");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await h.cleanup();
  }
});

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
    assert.deepEqual(sigkilled.sort(), [fastifyPid, vitePid].sort());
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
    const termed = h.killCalls.filter((k) => k.signal === "SIGTERM").map((k) => k.pid).sort();
    assert.deepEqual(termed, [fastifyPid, vitePid].sort(), "superseded start self-cleaned its children");
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
    const aFastifyPid = h.spawner.lifecycleCalls()[0]!.child.pid;
    const aVitePid = h.spawner.lifecycleCalls()[1]!.child.pid;

    // Supersede A with a fresh generation B (still starting).
    await h.core.stopWorktree("wt");
    const bPromise = h.core.ensureRunning("wt");
    const bProbesEarly = await h.awaitProbes(2); // B's probes — leave them pending
    const b = h.core.getHandle("wt");
    assert.ok(b, "B registered");

    // A's readiness now FAILS.
    for (const p of aProbes) p.reject(new Error("vite/wt did not respond"));
    await assert.rejects(() => aPromise, /did not respond/);

    // B is untouched and still starting; no `failed` record clobbered its slot.
    assert.equal(h.core.getHandle("wt"), b, "B still owns the name");
    assert.equal(b!.lifecycle.phase, "starting", "B was not overwritten by A's failure");
    // A self-cleaned its own children (the guard's observable effect).
    const termed = h.killCalls.filter((k) => k.signal === "SIGTERM").map((k) => k.pid);
    assert.ok(termed.includes(aVitePid) && termed.includes(aFastifyPid), "A self-cleaned its children");

    // Drain B so it doesn't leak into later tests.
    for (const p of bProbesEarly) p.resolve();
    await bPromise;
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
    mkdir: async () => undefined,
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
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
