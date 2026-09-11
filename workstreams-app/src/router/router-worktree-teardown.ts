// The worktree-lifecycle operations that do NOT start a generation: activity
// tracking and the idle timer, source-freshness reporting, and every teardown
// path (unexpected child exit, explicit/idle stop, dashboard stop, full-router
// shutdown, clearing a failed record).
//
// Split out of router-core.ts, which now owns only the map, `ensureRunning`,
// and the assembly of these pieces into a `RouterCore`. Each function takes the
// shared `CoreState` explicitly instead of closing over it, so the dependency
// runs one way: router-core.ts → router-worktree-start.ts → this module.
//
// The state model itself (the WorktreeHandle shell, the phase union, the
// guarded transition table, and the six incident invariants) lives in
// router-lifecycle.ts.

import path from "node:path";
import {
  type WorktreeHandle,
  type TimerHandle,
  transitionLifecycle,
  readyLifecycle,
  failedLifecycle,
  childPids,
} from "./router-lifecycle.js";
import { errMessage, type RouterEffects, type RouterCoreConfig } from "./router-effects.js";

/** The lifecycle's shared mutable state, threaded through explicitly. */
export interface CoreState {
  effects: RouterEffects;
  config: RouterCoreConfig;
  worktrees: Map<string, WorktreeHandle>;
  log: (msg: string) => void;
}

/** One generation's two children, as the kill paths address them. */
export interface ChildPids {
  vitePid: number | undefined;
  fastifyPid: number | undefined;
}

/** How often a ready generation's source token is recomputed. The check costs
 *  one directory walk (~16ms over ~1000 files), so this keeps a request burst
 *  down to a single one while still noticing a merge within seconds. */
const STALE_CHECK_INTERVAL_MS = 5_000;

export function browseDirsFor(state: CoreState, name: string): { socketDir: string; profileDir: string } {
  const base = path.join(state.config.browseDir, name);
  return { socketDir: path.join(base, "socket"), profileDir: path.join(base, "profile") };
}

/**
 * The secret store a worktree's box reads — its own, beside the browse dirs
 * (`<state>/secrets/<name>.json`), so a test box never touches the
 * boxholder's real `~/.config/beebox/secrets.json`. Undefined for `main`,
 * which is the real deployment surface and keeps the default store. Not under
 * the browse dir: those are torn down with the worktree's browser, and a
 * worktree's test keys should survive a router restart.
 */
export function isolatedSecretsFileFor(browseDir: string, name: string): string | undefined {
  if (name === "main") return undefined;
  return path.join(path.dirname(browseDir), "secrets", `${name}.json`);
}

// SIGTERM→SIGKILL escalation for one generation's children — shared by the
// failure path, the superseded-start self-clean (invariant #5), onChildExit,
// and stopWorktree. Returns the escalation TimerHandle so the caller can store
// it on the handle's stopping variant (teardown can then cancel it, and a
// test's fake clock can reach it). A vite slow to die on SIGTERM (mid
// esbuild/optimizeDeps) would otherwise survive as an orphan, and the pidfile
// is removed right after so the sweep couldn't find it either.
export function killChildren(state: CoreState, { vitePid, fastifyPid }: ChildPids): TimerHandle {
  const { effects, config } = state;
  effects.killGroup(vitePid);
  effects.killGroup(fastifyPid);
  return effects.setTimer(config.killGraceMs, () => {
    effects.killGroup(vitePid, "SIGKILL");
    effects.killGroup(fastifyPid, "SIGKILL");
  });
}

// Stop the agent-browser dashboard daemon owning `browseEnv`'s socket dir.
export async function stopDashboardCmd(state: CoreState, browseEnv: NodeJS.ProcessEnv): Promise<void> {
  const { effects, config } = state;
  await effects
    .spawn("node", {
      args: [config.agentBrowserBin, "dashboard", "stop"],
      options: { env: browseEnv, stdio: "ignore", timeout: 5000 },
    })
    .catch(() => {
      /* nothing to stop, fine */
    });
}

// Record activity and (re)arm the idle timer. Only a `ready` handle has an
// idle timer; other phases are a no-op. Mutates the ready variant's idle
// bookkeeping in place — a within-phase field update, not a transition.
export function touch(state: CoreState, handle: WorktreeHandle): void {
  const { effects, config, log } = state;
  const ready = readyLifecycle(handle);
  if (!ready) return;
  ready.lastActivity = effects.now();
  if (ready.idleTimer) effects.clearTimer(ready.idleTimer);
  ready.idleTimer = effects.setTimer(config.idleTimeoutMs, () => {
    log(`[${handle.name}] idle for ${config.idleTimeoutMs}ms, shutting down`);
    stopWorktree(state, handle.name).catch((err: unknown) =>
      log(`[${handle.name}] idle shutdown error: ${errMessage(err)}`),
    );
  });
  config.onStateChange?.();
}

/**
 * Notice, and say, that a ready generation is running source that has since
 * changed on disk.
 *
 * Detection only — nothing here stops or replaces anything. The router's
 * activity signal (`touch`, above) records HTTP requests and nothing else, so
 * a worktree carrying a live chat over a WebSocket is indistinguishable from
 * an idle one; there is no moment this code could prove is safe to cut. What
 * it can do is stop the staleness being invisible, which is what actually
 * cost time in the reported case: an agent chasing a fix that had landed and
 * was not running.
 *
 * Fire-and-forget on purpose. This sits on the request path, and a slow or
 * broken `sourceToken` must delay nothing; the answer lands on the handle in
 * time for the next request either way.
 */
export function checkSourceFreshness(state: CoreState, handle: WorktreeHandle): void {
  const { effects, config, worktrees, log } = state;
  const ready = readyLifecycle(handle);
  if (!ready) return;
  // Nothing to compare against, or already reported — either way there is no
  // question left to ask.
  if (ready.sourceToken === null || ready.staleSince !== null) return;
  const now = effects.now();
  if (now - ready.lastStaleCheck < STALE_CHECK_INTERVAL_MS) return;
  ready.lastStaleCheck = now;
  void (async () => {
    const wt = await effects.resolveWorktree(handle.name);
    if (!wt) return;
    const current = await effects.sourceToken(wt.root);
    if (current === null || current === ready.sourceToken) return;
    // The walk above is not instant, and a generation can be stopped or
    // replaced while it runs — `stopWorktree` unlinks the handle before its
    // async cleanup, so both the map entry and the lifecycle variant have to
    // still be the ones we sampled. Reporting against a dead generation would
    // announce staleness for a process that is already gone.
    if (worktrees.get(handle.name) !== handle) return;
    if (handle.lifecycle !== ready) return;
    if (ready.staleSince !== null) return;
    ready.staleSince = effects.now();
    log(
      `[${handle.name}] backend source changed since this generation started — ` +
      `it is still running the old code. \`bin/workstreams down ${handle.name}\` replaces it.`,
    );
    config.onStateChange?.();
  })().catch((err: unknown) => log(`[${handle.name}] source freshness check failed: ${errMessage(err)}`));
}

// Invariant #4 of bin/docs/router-protocol.md: an unexpected exit of a `ready`
// generation's child (crash, or a drained SIGTERM finally landing). Verify the
// exiting child still belongs to the map's current handle — a late exit from a
// replaced generation reduces to a log line, never a teardown of the live entry
// (the 2026-06-09 "main restarts every 10s" incident). Reason "exited" →
// detached, fire-and-forget cleanup (no caller awaits an unexpected death).
export function onChildExit(state: CoreState, handle: WorktreeHandle): void {
  const { effects, config, worktrees, log } = state;
  const name = handle.name;
  if (worktrees.get(name) !== handle) {
    log(`[${name}] exit event from a replaced generation, ignoring`);
    return;
  }
  const ready = readyLifecycle(handle);
  if (!ready) return;
  if (ready.idleTimer) effects.clearTimer(ready.idleTimer);
  const { vitePid, fastifyPid } = ready;
  worktrees.delete(name);
  const killTimer = killChildren(state, { vitePid, fastifyPid });
  transitionLifecycle(handle, {
    phase: "stopping",
    reason: "exited",
    vitePid,
    fastifyPid,
    dashboardPort: ready.dashboardPort,
    browseEnv: ready.browseEnv,
    killTimer,
  });
  stopDashboard(state, handle).catch((err: unknown) => {
    // Best-effort: the dashboard daemon may already be gone with its worktree.
    log(`[${name}] dashboard stop after child exit failed: ${errMessage(err)}`);
  });
  effects.pidStore.remove(name, { vitePid, fastifyPid }).catch((err: unknown) => {
    // Best-effort: a concurrent generation may already own (or have removed) the slot.
    log(`[${name}] pidfile removal after child exit failed: ${errMessage(err)}`);
  });
  config.onStateChange?.();
}

// Explicit/idle stop. Reason "requested" → cleanup is AWAITED (the retry
// endpoint relies on stopWorktree completion). Unlink from the map before any
// await so a request arriving mid-stop sees a cold worktree and starts a fresh
// generation, and this cleanup can never delete that new generation's state.
export async function stopWorktree(state: CoreState, name: string): Promise<void> {
  const { effects, config, worktrees } = state;
  const handle = worktrees.get(name);
  if (!handle) return;
  worktrees.delete(name);
  const ready = readyLifecycle(handle);
  if (!ready) {
    // `starting`: the in-flight start owns the children (they live in
    //   startWorktree's scope) and self-cleans on its guarded publication now
    //   that we've unlinked it (invariant #5) — nothing to kill here.
    // `failed`: nothing is running; dropping it from the map is the whole stop.
    config.onStateChange?.();
    return;
  }
  if (ready.idleTimer) effects.clearTimer(ready.idleTimer);
  const { vitePid, fastifyPid } = ready;
  const killTimer = killChildren(state, { vitePid, fastifyPid });
  transitionLifecycle(handle, {
    phase: "stopping",
    reason: "requested",
    vitePid,
    fastifyPid,
    dashboardPort: ready.dashboardPort,
    browseEnv: ready.browseEnv,
    killTimer,
  });
  await effects.pidStore.remove(name, { vitePid, fastifyPid });
  await stopDashboard(state, handle).catch((err: unknown) => {
    // Best-effort: the daemon may already be gone; the stop itself has succeeded.
    state.log(`[${name}] dashboard stop failed: ${errMessage(err)}`);
  });
  config.onStateChange?.();
}

// Stop the agent-browser dashboard for a handle in a phase that owns one
// (`ready` or `stopping`). Other phases carry no dashboard, so this is a no-op.
export async function stopDashboard(state: CoreState, handle: WorktreeHandle): Promise<void> {
  const { effects, config, log } = state;
  const lc = handle.lifecycle;
  const dashboard =
    lc.phase === "ready" || lc.phase === "stopping"
      ? { dashboardPort: lc.dashboardPort, browseEnv: lc.browseEnv }
      : null;
  if (!dashboard || !dashboard.dashboardPort || !dashboard.browseEnv) return;
  try {
    await effects.spawn("node", {
      args: [config.agentBrowserBin, "dashboard", "stop"],
      options: { env: dashboard.browseEnv, stdio: "ignore", timeout: 5000 },
    });
  } catch (err) {
    log(`[${handle.name}] dashboard stop failed: ${errMessage(err)}`);
  }
}

export async function stopAllChildren(state: CoreState): Promise<void> {
  const { effects, config, worktrees } = state;
  // A `starting` handle owns no PIDs yet (they're only published on the
  // ready/failed/stopping variants), so this sweep can't kill its children
  // directly. Instead unlink it from the map right now, which supersedes it:
  // the in-flight startWorktree's own guarded-publication check (invariant
  // #5, `worktrees.get(name) !== handle`) will see itself replaced and
  // self-clean (kill ITS children, remove ITS pidfile) once it reaches that
  // check, instead of publishing `ready`/`failed` after this teardown has
  // already run. Awaited below so shutdown doesn't return before that
  // self-clean has actually happened.
  const supersededStarts: Promise<WorktreeHandle>[] = [];
  for (const [name, handle] of [...worktrees.entries()]) {
    if (handle.lifecycle.phase === "starting") {
      worktrees.delete(name);
      supersededStarts.push(handle.lifecycle.startPromise);
      continue;
    }
    const ready = readyLifecycle(handle);
    if (ready?.idleTimer) effects.clearTimer(ready.idleTimer);
    const { vitePid, fastifyPid } = childPids(handle.lifecycle);
    effects.killGroup(vitePid);
    effects.killGroup(fastifyPid);
  }
  effects.setTimer(config.killGraceMs, () => {
    for (const handle of worktrees.values()) {
      const { vitePid, fastifyPid } = childPids(handle.lifecycle);
      effects.killGroup(vitePid, "SIGKILL");
      effects.killGroup(fastifyPid, "SIGKILL");
    }
  });
  await effects.sleep(500);
  for (const name of worktrees.keys()) {
    await effects.pidStore.remove(name);
  }
  await Promise.allSettled(supersededStarts);
}

export function clearFailed(state: CoreState, name: string): boolean {
  const { worktrees } = state;
  const handle = worktrees.get(name);
  if (handle && failedLifecycle(handle)) {
    worktrees.delete(name);
    return true;
  }
  return false;
}
