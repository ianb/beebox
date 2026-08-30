// The worktree-lifecycle engine, factored out of router.ts as a pure-ish core:
// `createRouterCore(effects, config)` owns the `worktrees` map and drives the
// lifecycle (ensureRunning → startWorktree → ready/failed, onChildExit,
// stopWorktree) through an injected `RouterEffects` surface. Every impure
// operation the lifecycle performs — spawning children, killing process groups,
// HTTP-readiness probes, timers, the clock, sleeps, pidfile writes, hub-config
// generation, port allocation, worktree/box resolution — arrives through
// `effects`, so the incident tests (bin/router-core.test.ts) can substitute
// deterministic fakes (a manual clock, a barrier-gated pidfile store, a
// controllable spawner) and reproduce the documented races.
//
// router.ts constructs the REAL effects (execa, get-port, the serialized pidfile
// store, http.request probes) and wires this core to the HTTP/WS server. Both
// this module and router.ts are import-safe: importing them binds no ports and
// installs no signal handlers (that lives in router.ts's `main()`).
//
// This file owns only the map, the registration guard (`ensureRunning`), and the
// assembly. The effects/config seam lives in router-effects.ts; the cold-start
// path in router-worktree-start.ts; activity, freshness, and every teardown path
// in router-worktree-teardown.ts. The state model itself (the WorktreeHandle
// shell, the phase union, the guarded transition table, and the six incident
// invariants) lives in router-lifecycle.ts.

import type net from "node:net";
import {
  type WorktreeHandle,
  createStartingHandle,
  readyLifecycle,
  failedLifecycle,
  startPromiseOf,
} from "./router-lifecycle.js";
import { statusError, type RouterEffects, type RouterCoreConfig } from "./router-effects.js";
import { startWorktree } from "./router-worktree-start.js";
import {
  type CoreState,
  checkSourceFreshness,
  clearFailed,
  stopAllChildren,
  stopWorktree,
  touch,
} from "./router-worktree-teardown.js";

/**
 * Bind a server to loopback only. The router has unauthenticated control
 * routes (`/__router/status|retry|stop`) and proxies to worktree backends
 * whose open-mode opt-out is legal precisely because their bind is loopback —
 * so the router itself must never listen on a routable interface. There is
 * deliberately no host override; tailnet/remote access goes through
 * `tailscale serve` fronting a dedicated auth-gated `bbx serve`/`bbx hub`,
 * never the router (docs/implemented-plans/tailscale-expose-and-protect.md, Track A).
 */
export function listenLoopback(server: net.Server, { port, onListening }: { port: number; onListening: () => void }): void {
  server.listen(port, "127.0.0.1", onListening);
}

// --- the core -----------------------------------------------------------------

export interface RouterCore {
  /** Ensure `name` is running, starting it if cold. Resolves to its handle
   *  (which may be non-ready if a concurrent stop superseded the start). */
  ensureRunning(name: string): Promise<WorktreeHandle>;
  /** Explicit/idle stop. Awaits cleanup (the retry endpoint relies on it). */
  stopWorktree(name: string): Promise<void>;
  /** Record activity + (re)arm the idle timer on a ready handle (no-op else). */
  touch(handle: WorktreeHandle): void;
  getHandle(name: string): WorktreeHandle | undefined;
  /** Snapshot of the map for status/index/tab-title/shutdown iteration. */
  entries(): [string, WorktreeHandle][];
  /** Drop a `failed` record so the next ensureRunning retries; returns whether
   *  anything was cleared. */
  clearFailed(name: string): boolean;
  /** Full-router shutdown: SIGTERM every generation's children, schedule the
   *  SIGKILL escalation, wait the drain, remove every child pidfile, and
   *  supersede+await any in-flight `starting` generations so they self-clean
   *  (invariant #5) instead of publishing after this resolves. */
  stopAllChildren(): Promise<void>;
}

export async function ensureRunning(state: CoreState, name: string): Promise<WorktreeHandle> {
  const { effects, worktrees } = state;
  const existing = worktrees.get(name);
  if (existing) {
    if (readyLifecycle(existing)) {
      checkSourceFreshness(state, existing);
      touch(state, existing);
      return existing;
    }
    const inFlight = startPromiseOf(existing);
    if (inFlight) return inFlight;
    // Failed worktrees stay failed until the user explicitly retries (via the
    // /__router/retry/<name> endpoint). Auto-restarting on every page-fetch
    // would mask the failure and burn CPU / log noise — a broken worktree
    // should *look* broken, with the captured error visible.
    const failed = failedLifecycle(existing);
    if (failed) throw statusError(failed.lastError.message, 502);
    // Any other in-map phase is unreachable (stopping handles are unlinked
    // before the transition); fall through to start a fresh generation.
  }

  // Invariant #2 of bin/docs/router-protocol.md: atomic registration, then
  // start. Construct the handle, register it, and begin startup in ONE
  // synchronous stretch with no `await` between the worktrees.get() above and
  // the worktrees.set() below — otherwise two near-simultaneous cold requests
  // both observe an empty map, both start, and each spawns a full vite+fastify
  // pair (a leaked generation). Registration happens BEFORE begin() invokes
  // startWorktree, so even a synchronous resolver can't run before the handle
  // is in the map.
  const { handle, begin } = createStartingHandle({ name, startedAt: effects.now() });
  worktrees.set(name, handle);
  const inFlight = begin((h) => startWorktree(state, h));
  // On rejection that ISN'T a parked waitForHttp failure (e.g. an unknown-name
  // 404 from a `/.well-known/...` probe, crawler, or typo — startWorktree
  // throws before any transition), drop the bare starting handle so it leaves
  // no phantom index entry and a later valid request can retry. The failure
  // path transitions this same handle to `failed` in place, so the
  // still-`starting` guard leaves that record intact; a superseded generation
  // (cur !== handle) is likewise left alone.
  inFlight.catch(() => {
    const cur = worktrees.get(name);
    if (cur === handle && cur.lifecycle.phase === "starting") worktrees.delete(name);
  });
  return inFlight;
}

export function createRouterCore(effects: RouterEffects, config: RouterCoreConfig): RouterCore {
  const state: CoreState = { effects, config, worktrees: new Map<string, WorktreeHandle>(), log: config.log };
  const { worktrees } = state;
  return {
    ensureRunning: (name) => ensureRunning(state, name),
    stopWorktree: (name) => stopWorktree(state, name),
    touch: (handle) => touch(state, handle),
    getHandle: (name) => worktrees.get(name),
    entries: () => [...worktrees.entries()],
    clearFailed: (name) => clearFailed(state, name),
    stopAllChildren: () => stopAllChildren(state),
  };
}
