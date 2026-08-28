// The deterministic fakes the router-core incident tests are driven by: a manual
// clock owning every TimerHandle the core arms, a controllable spawner
// (capturable exit callbacks, rejectable promises, assigned pids), a recording
// killGroup, manual HTTP-readiness probes, and the `makeHarness` that wires them
// into a real `createRouterCore`.
//
// Shared by bin/router-core.test.ts (startup: dedupe, freshness, rejection
// discipline) and bin/router-core-teardown.test.ts (exit, guarded publication,
// shutdown, pidfile serialization), which were one file until it outgrew the
// file-length limit. Log output is silenced by default (a no-op `log`) so a
// passing run is quiet; flip `LOG` below to debug.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterCore, type RouterCore } from "./router-core.js";
import type { RouterEffects, SpawnOptions, SpawnedChild, ResolvedWorktree } from "./router-effects.js";
import type { PidExpectation } from "./router-pidfile.js";
import type { TimerHandle, WorktreeHandle } from "./router-lifecycle.js";

const LOG = false;

// --- fixture errors -----------------------------------------------------------
// The rejections these tests inject. Named classes rather than `new Error(msg)`
// so the failure a test simulates is identifiable at the assertion, not just a
// string.

/** A lifecycle child rejecting its execa-style promise (invariant #3). */
export class FakeChildExitError extends Error {
  constructor() {
    super("child exited 1");
    this.name = "FakeChildExitError";
  }
}

/** A timed-out HTTP-readiness probe for the harness's vite child. */
export class FakeProbeTimeoutError extends Error {
  constructor() {
    super("vite/wt did not respond");
    this.name = "FakeProbeTimeoutError";
  }
}

/** A disk-full `pidStore.write` between the spawn and waitForHttp. */
export class FakeDiskFullError extends Error {
  constructor() {
    super("ENOSPC: no space left on device");
    this.name = "FakeDiskFullError";
  }
}

/** A missing pidfile, carrying the errno `code` the store's catch inspects. */
export class FakeMissingFileError extends Error {
  readonly code = "ENOENT";
  constructor() {
    super("ENOENT");
    this.name = "FakeMissingFileError";
  }
}


// A settled/unsettled turn of the event loop, draining microtasks AND the libuv
// callbacks the core's real fs.mkdir/createWriteStream sit on.
export function tick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}
export async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await tick();
}

// --- fake clock: owns every TimerHandle the core arms -------------------------

interface ScheduledTimer {
  id: number;
  dueAt: number;
  fn: () => void;
  cancelled: boolean;
}

export class FakeClock {
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
      .toSorted((a, b) => a.dueAt - b.dueAt);
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

export interface FakeChild extends SpawnedChild {
  /** Invoke the exit listener the core registered via `.on("exit", …)`. */
  fireExit(code: number | null, signal: NodeJS.Signals | null): void;
  /** Reject the underlying execa-style promise (an exiting/failed child). */
  reject(err: unknown): void;
}

function makeChild(pid: number, { autoResolve, rejectOnMicrotask }: { autoResolve: boolean; rejectOnMicrotask: unknown | undefined }): FakeChild {
  let rejectFn: (e: unknown) => void = () => {};
  let resolveFn: (v: unknown) => void = () => {};
  const base = new Promise<unknown>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  let exitListener: ((c: number | null, s: NodeJS.Signals | null) => void) | null = null;
  if (autoResolve) resolveFn(null);
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

export interface SpawnCall {
  command: string;
  args: string[];
  options: SpawnOptions;
  child: FakeChild;
}

export class FakeSpawner {
  private nextPid = 1000;
  readonly calls: SpawnCall[] = [];
  /** When set, every LIFECYCLE child (vite/fastify) rejects on a microtask. */
  rejectLifecycleWith: unknown | undefined = undefined;

  spawn = (command: string, { args, options }: { args: string[]; options: SpawnOptions }): SpawnedChild => {
    const isDashboard = args.includes("dashboard");
    const child = makeChild(this.nextPid++, {
      // Dashboard commands are awaited; resolve them.
      autoResolve: isDashboard,
      rejectOnMicrotask: isDashboard ? undefined : this.rejectLifecycleWith,
    });
    this.calls.push({ command, args, options, child });
    return child;
  };

  /** The lifecycle (non-dashboard) spawns, in order: [0]=fastify, [1]=vite. */
  lifecycleCalls(): SpawnCall[] {
    return this.calls.filter((c) => !c.args.includes("dashboard"));
  }
}

// --- recording killGroup ------------------------------------------------------

export interface KillCall {
  pid: number | undefined;
  signal: string;
}

// --- manual HTTP-readiness probes ---------------------------------------------

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}
export function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --- harness ------------------------------------------------------------------

export interface Harness {
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
  /** When set, the NEXT `pidStore.write` call rejects with this and clears
   *  itself (a disk-full/permission failure between spawn and waitForHttp). */
  failNextPidWrite: { value: unknown | undefined };
  /** The backend-source token the effects report; assign to simulate a rebuild. */
  sourceToken: { value: string | null };
  cleanup(): Promise<void>;
}

export async function makeHarness(options?: { devNoHub?: boolean }): Promise<Harness> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "router-core-test-"));
  const clock = new FakeClock();
  const spawner = new FakeSpawner();
  const killCalls: KillCall[] = [];
  const removeCalls: Harness["removeCalls"] = [];
  const unknownNames = new Set<string>();

  let probeMode: "auto" | "manual" = "auto";
  let pendingProbes: Deferred[] = [];
  const failNextPidWrite: { value: unknown | undefined } = { value: undefined };
  // What the backend source "looks like" right now. A test moves it to simulate
  // a merge landing under a running generation.
  const sourceToken: { value: string | null } = { value: "src-gen-1" };

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
      write: async () => {
        if (failNextPidWrite.value !== undefined) {
          const err = failNextPidWrite.value;
          failNextPidWrite.value = undefined;
          throw err;
        }
      },
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
    sourceToken: () => Promise.resolve(sourceToken.value),
  };

  const core = createRouterCore(effects, {
    idleTimeoutMs: 300_000,
    killGraceMs: 2_000,
    logDir: path.join(tmp, "logs"),
    browseDir: path.join(tmp, "browse"),
    agentBrowserBin: path.join(tmp, "agent-browser.js"),
    devNoHub: options?.devNoHub === true,
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
    failNextPidWrite,
    sourceToken,
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
export async function startReady(h: Harness, name: string): Promise<WorktreeHandle> {
  const handle = await h.core.ensureRunning(name);
  return handle;
}
