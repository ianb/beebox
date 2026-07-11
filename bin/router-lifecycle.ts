// The worktree lifecycle as a stable shell + a discriminated union + a guarded
// transition, extracted so the four incident invariants of
// bin/docs/router-protocol.md live in typed, unit-testable shapes rather than
// scattered `entry.state === "..."` string checks. Pure and zero-I/O: it owns
// the state model only — the router (router.ts) owns the effects (spawning,
// killing, pidfiles, HTTP probes) and drives transitions through here.
//
// Design (mirrors callback-box/src/core/chat/session/lifecycle.ts):
//
//   - A `WorktreeHandle` is ONE object per generation, created when a start is
//     kicked off and NEVER replaced or copied. Identity lives on the handle:
//     `worktrees.get(name) === handle` is the cross-generation guard, and it now
//     works uniformly *during* startup, not only after ready (the old code
//     replaced the map entry with a brand-new object at the ready/failed paths,
//     so the placeholder and the ready entry were different objects).
//   - `WorktreeLifecycle` is a true discriminated union: each phase carries
//     exactly its legal fields, so e.g. you cannot reach `ready` without
//     supplying ports and child PIDs.
//   - `transitionLifecycle` is the single guarded setter. It takes the COMPLETE
//     destination variant (not a phase string) and asserts the move against
//     `LEGAL_TRANSITIONS`. It mutates `handle.lifecycle` in place — the shell
//     identity is preserved; only the union value is swapped.
//
// bin/ can't import callback-box internals, so `invariant` is restated locally.

/** The tail of a child's interleaved stdout+stderr, captured for the failed
 *  page so the user can see what went wrong without grepping the log file. */
export interface CapturedError {
  message: string;
  /** Which lifecycle phase failed (waitForHttp, spawn, etc.). */
  phase: string;
  viteOutput: string;
  fastifyOutput: string;
  at: number;
}

export type WorktreePhase = "starting" | "ready" | "stopping" | "failed";

/**
 * `starting` — children are being spawned / probed; `startPromise` resolves to
 * the handle once the start reaches a terminal phase. Concurrent callers and WS
 * upgrades await it rather than racing a second start.
 */
export interface StartingLifecycle {
  readonly phase: "starting";
  readonly startPromise: Promise<WorktreeHandle>;
}

/**
 * `ready` — both children are serving HTTP. Ports/PIDs/dirs are immutable for
 * the generation; `lastActivity`/`idleTimer` are the mutable idle bookkeeping
 * that `touch` updates in place (a within-phase field update, not a transition).
 */
export interface ReadyLifecycle {
  readonly phase: "ready";
  readonly vitePid: number | undefined;
  readonly fastifyPid: number | undefined;
  readonly frontendPort: number;
  readonly backendPort: number;
  readonly dashboardPort: number | null;
  readonly dashboardUrl: string | null;
  readonly socketDir: string;
  readonly profileDir: string;
  readonly browseEnv: NodeJS.ProcessEnv;
  readonly logFile: string;
  // Mutable idle bookkeeping — `touch` updates these in place (a within-phase
  // field update, deliberately NOT a transition). Everything else is fixed for
  // the generation.
  lastActivity: number;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * `stopping` — teardown is underway. `reason` records why:
 * - `"exited"` — an unexpected child exit; `onChildExit` tears down DETACHED
 *   (fire-and-forget), since no caller is awaiting an unexpected death.
 * - `"requested"` — an explicit/idle stop (`stopWorktree`, which AWAITS its
 *   pidfile-remove + dashboard-stop, because the retry endpoint relies on that
 *   completion), OR a start that finished but found itself superseded and
 *   self-cleaned (`startWorktree` awaits its own cleanup before resolving).
 *   Note `stopWorktree` on a still-`starting` handle does NOT block on that
 *   self-clean — it unlinks and returns, and the in-flight start does its
 *   (awaited) cleanup when it completes; the pidfile store's generation guard +
 *   serialization keep that safe against the replacing generation.
 * Handles only ever reach `stopping` after being unlinked from the map, so this
 * phase is never observed there (status accuracy for in-flight teardown is a
 * recorded non-goal).
 */
export interface StoppingLifecycle {
  readonly phase: "stopping";
  readonly reason: "exited" | "requested";
  readonly vitePid: number | undefined;
  readonly fastifyPid: number | undefined;
  readonly dashboardPort: number | null;
  readonly browseEnv: NodeJS.ProcessEnv | null;
}

/** `failed` — startup failed; stays in the map so the error page + retry work.
 *  `ensureRunning` won't auto-restart it; the retry endpoint clears it. */
export interface FailedLifecycle {
  readonly phase: "failed";
  readonly lastError: CapturedError;
}

export type WorktreeLifecycle =
  | StartingLifecycle
  | ReadyLifecycle
  | StoppingLifecycle
  | FailedLifecycle;

/** The stable per-generation shell. `name`/`startedAt` are fixed for the life
 *  of the generation; `lifecycle` is swapped whole via `transitionLifecycle`. */
export interface WorktreeHandle {
  readonly name: string;
  readonly startedAt: number;
  lifecycle: WorktreeLifecycle;
}

// --- invariant (local; bin/ can't import callback-box) ------------------------

export class WorktreeLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeLifecycleError";
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WorktreeLifecycleError(message);
}

// --- transitions --------------------------------------------------------------

/**
 * Legal phase moves. Keyed by `WorktreePhase`, so adding a phase fails to
 * compile until its edges are declared — the table can't drift from the union.
 *
 * - `starting → ready` — both children came up healthy and this start is still
 *   the map's current generation.
 * - `starting → failed` — a probe/spawn failure parked the generation.
 * - `starting → stopping` — a start that finished but was superseded (stopped or
 *   replaced) self-cleans its own children without publishing (invariant #5).
 * - `ready → stopping` — an explicit/idle stop, or an unexpected child exit.
 * - `stopping`/`failed` are terminal: a `stopping` handle is already off the map
 *   and discarded; a `failed` handle is cleared by the retry endpoint (which
 *   drops it from the map and starts a fresh generation), never transitioned.
 */
export const LEGAL_TRANSITIONS: Record<WorktreePhase, readonly WorktreePhase[]> = {
  starting: ["ready", "failed", "stopping"],
  ready: ["stopping"],
  stopping: [],
  failed: [],
};

export function isLegalTransition(from: WorktreePhase, to: WorktreePhase): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Swap `handle.lifecycle` to the complete destination variant, asserting the
 * move is legal. Mutates in place — the handle reference is never replaced, so
 * every generation guard (`worktrees.get(name) === handle`) and every closed-over
 * exit listener keeps pointing at the same object across the whole lifecycle.
 */
export function transitionLifecycle(handle: WorktreeHandle, next: WorktreeLifecycle): void {
  const from = handle.lifecycle.phase;
  invariant(
    isLegalTransition(from, next.phase),
    `illegal worktree lifecycle transition for ${JSON.stringify(handle.name)}: ${from} → ${next.phase}`,
  );
  handle.lifecycle = next;
}

export interface StartingRegistration {
  /** The `starting` handle, ready to register in the map. */
  handle: WorktreeHandle;
  /**
   * Kick off `start(handle)` AFTER the handle is registered, returning the
   * generation's `startPromise` (also reachable via `startPromiseOf(handle)`).
   * Call it in the same synchronous stretch as `worktrees.set`, so no `await`
   * separates registration from the start (invariant #2).
   */
  begin(start: (handle: WorktreeHandle) => Promise<WorktreeHandle>): Promise<WorktreeHandle>;
}

/**
 * Build a fresh generation's handle in `starting`, but DON'T invoke the start
 * yet — return a `begin` the caller runs after `worktrees.set`.
 *
 * The `starting` lifecycle needs a `startPromise`, and `start` needs the handle
 * (to guard its own terminal publication against a superseded generation,
 * invariant #5) — a cycle. We break it with a deferred: the `starting`
 * lifecycle carries a promise we settle when `start` resolves, so the handle is
 * fully constructed (and registerable) before `start` is ever called. That lets
 * the caller register FIRST and invoke startup SECOND (invariant #2's ordering
 * — "construct → set → then start"), so even a synchronous/injected resolver
 * (Phase B) cannot run before the handle is in the map.
 */
export function createStartingHandle(params: {
  name: string;
  startedAt: number;
}): StartingRegistration {
  const { name, startedAt } = params;
  let settle!: (handle: WorktreeHandle) => void;
  let fail!: (reason: unknown) => void;
  const startPromise = new Promise<WorktreeHandle>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const handle: WorktreeHandle = {
    name,
    startedAt,
    lifecycle: { phase: "starting", startPromise },
  };
  const begin = (start: (handle: WorktreeHandle) => Promise<WorktreeHandle>): Promise<WorktreeHandle> => {
    // `start` is async, so this never throws synchronously; its settlement is
    // piped into the deferred `startPromise` the handle already exposes.
    start(handle).then(settle, fail);
    return startPromise;
  };
  return { handle, begin };
}

// --- derived predicates / accessors -------------------------------------------
// These replace the scattered `entry.state === "..."` checks. Each returns the
// narrowed variant (or null) so callers read a phase's fields type-safely.

export function isServing(handle: WorktreeHandle): boolean {
  return handle.lifecycle.phase === "ready";
}

export function readyLifecycle(handle: WorktreeHandle): ReadyLifecycle | null {
  return handle.lifecycle.phase === "ready" ? handle.lifecycle : null;
}

export function failedLifecycle(handle: WorktreeHandle): FailedLifecycle | null {
  return handle.lifecycle.phase === "failed" ? handle.lifecycle : null;
}

export function isStarting(handle: WorktreeHandle): boolean {
  return handle.lifecycle.phase === "starting";
}

/** The in-flight start's promise while `starting`, else null (so concurrent
 *  callers and WS upgrades can await an underway start instead of racing one). */
export function startPromiseOf(handle: WorktreeHandle): Promise<WorktreeHandle> | null {
  return handle.lifecycle.phase === "starting" ? handle.lifecycle.startPromise : null;
}

/** The generation's child PIDs for any phase that owns them (for killGroup /
 *  pidfile removal / status), else `undefined`s. */
export function childPids(lifecycle: WorktreeLifecycle): {
  vitePid: number | undefined;
  fastifyPid: number | undefined;
} {
  switch (lifecycle.phase) {
    case "ready":
    case "stopping":
      return { vitePid: lifecycle.vitePid, fastifyPid: lifecycle.fastifyPid };
    case "starting":
    case "failed":
      return { vitePid: undefined, fastifyPid: undefined };
  }
}
