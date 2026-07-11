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
// The state model itself (the WorktreeHandle shell, the phase union, the guarded
// transition table, and the six incident invariants) lives in router-lifecycle.ts.
// This file owns the EFFECTS; that file owns the SHAPES.

import { boxEntryToArg, type ResolvedBoxEntry } from "./box-entry.js";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { PidStore, PidExpectation } from "./router-pidfile.js";
import {
  type WorktreeHandle,
  type CapturedError,
  type TimerHandle,
  transitionLifecycle,
  createStartingHandle,
  readyLifecycle,
  failedLifecycle,
  startPromiseOf,
  childPids,
} from "./router-lifecycle.js";

// --- injected effects ---------------------------------------------------------

/** A spawned child, narrowed to exactly what the lifecycle uses (execa's
 *  ResultPromise satisfies this structurally; a test's fake child implements
 *  it). It is a promise (rejects when the child exits non-zero — invariant #3
 *  swallows that at the spawn site) AND a handle exposing pid, output streams,
 *  and the `exit` event. */
export interface SpawnedChild extends Promise<unknown> {
  readonly pid?: number;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
}

/** The subset of execa options the lifecycle passes through (lifecycle children:
 *  detached + piped stdio; dashboard commands: ignored stdio + a timeout). */
export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "ignore" | ["ignore", "pipe", "pipe"];
  detached?: boolean;
  cleanup?: boolean;
  timeout?: number;
}

/** A resolved worktree: where its checkout lives and which boxes it serves.
 *  Produced by the `resolveWorktree` effect (router.ts owns the filesystem
 *  layout constants); the lifecycle only consumes the shape. */
export interface ResolvedWorktree {
  name: string;
  root: string;
  backendCwd: string;
  frontendCwd: string;
  boxes: string[];
}

/**
 * Every impure operation the lifecycle performs. Real implementations live in
 * router.ts; fakes live in the tests. Enumerated deliberately so a reviewer can
 * grep the core for a raw `execa`/`setTimeout`/`Date.now`/`fs` call and know it's
 * a bug (everything must route through here).
 */
export interface RouterEffects {
  /** Spawn a child. Both the two lifecycle children (vite, fastify) and the four
   *  dashboard commands (pre-start stop, start, failed-startup stop, stopDashboard)
   *  go through here. The rejection is swallowed at the spawn site by the caller's
   *  very next line (lifecycle children) or the awaiting `.catch` (dashboard). */
  spawn(command: string, args: string[], options: SpawnOptions): SpawnedChild;
  /** SIGTERM (or the given signal) a child's process GROUP, falling back to the
   *  bare pid. No-op for `undefined`. */
  killGroup(pid: number | undefined, signal?: NodeJS.Signals): void;
  /** Whether a pid is alive (used by the boot sweep, not the lifecycle). */
  pidAlive(pid: number): boolean;
  /** Poll an HTTP GET until it responds or `timeoutMs` elapses; reject on
   *  timeout. The whole probe is the effect (its internal per-request timeouts
   *  stay inside), so a fake replaces readiness wholesale. */
  waitForHttp(port: number, reqPath: string, timeoutMs: number, label: string): Promise<void>;
  /** Arm a timer; the returned handle cancels it. The real impl `unref()`s the
   *  timer and runs the callback inside a try/catch that logs, so a throwing
   *  escalation/idle callback can't crash the router. */
  setTimer(ms: number, fn: () => void): TimerHandle;
  clearTimer(handle: TimerHandle): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** The per-name-serialized pidfile store (invariants #1 + #6). */
  pidStore: PidStore;
  /** Write this worktree's single-slot `hub.json`, returning its path. */
  writeHubConfig(params: { name: string; backendPort: number; resolvedBoxes: ResolvedBoxEntry[] }): Promise<string>;
  getPort(): Promise<number>;
  resolveWorktree(name: string): Promise<ResolvedWorktree | null>;
  resolveBoxEntries(entries: string[]): Promise<ResolvedBoxEntry[]>;
}

/** Static configuration + hooks the lifecycle needs (non-impure values, plus the
 *  tab-title state-change hook that replaces router.ts's old monkey-patching). */
export interface RouterCoreConfig {
  idleTimeoutMs: number;
  killGraceMs: number;
  /** Where per-worktree log files are written (real streams, per the plan; tests
   *  point this at a tmp dir). */
  logDir: string;
  /** Base dir for a worktree's agent-browser socket/profile dirs. */
  browseDir: string;
  agentBrowserBin: string;
  /** `true` reverts the backend to the legacy single server-main.ts process. */
  devNoHub: boolean;
  /** This router process's pid, stamped into pidfile records. */
  routerPid: number;
  log: (msg: string) => void;
  /** Called after every state change (touch / stop / child-exit) so router.ts
   *  can refresh the terminal tab title. Replaces the old let-rebinding hack. */
  onStateChange?: () => void;
}

// --- error helpers (honestly typed; bin/ can't import callback-box's guards) ---

/** A message from an unknown thrown value, without an `as Error` cast. */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** An errno `code` off an unknown thrown value, or undefined. The `in` narrow
 *  exposes the property as `unknown` without a cast. */
export function errnoCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = e.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export interface StatusError extends Error {
  statusCode?: number;
}

export function statusError(message: string, statusCode: number): StatusError {
  const err: StatusError = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/** The HTTP status carried on a thrown value, or undefined (no `as` cast). */
export function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof Error && "statusCode" in err) {
    const sc = err.statusCode;
    if (typeof sc === "number") return sc;
  }
  return undefined;
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
   *  SIGKILL escalation, wait the drain, and remove every child pidfile. */
  stopAllChildren(): Promise<void>;
}

/**
 * Fixed-size ring buffer capturing the tail of a child's interleaved
 * stdout+stderr, surfaced on the failed-startup page. `write` is byte-counted.
 */
function makeOutputRing(maxBytes: number): { write: (s: string) => void; read: () => string } {
  let buf = "";
  return {
    write(s) {
      buf += s;
      if (buf.length > maxBytes) buf = buf.slice(buf.length - maxBytes);
    },
    read() {
      return buf;
    },
  };
}

export function createRouterCore(effects: RouterEffects, config: RouterCoreConfig): RouterCore {
  const { log } = config;
  const worktrees = new Map<string, WorktreeHandle>();

  function browseDirsFor(name: string): { socketDir: string; profileDir: string } {
    const base = path.join(config.browseDir, name);
    return { socketDir: path.join(base, "socket"), profileDir: path.join(base, "profile") };
  }

  // SIGTERM→SIGKILL escalation for one generation's children — shared by the
  // failure path, the superseded-start self-clean (invariant #5), onChildExit,
  // and stopWorktree. Returns the escalation TimerHandle so the caller can store
  // it on the handle's stopping variant (teardown can then cancel it, and a
  // test's fake clock can reach it). A vite slow to die on SIGTERM (mid
  // esbuild/optimizeDeps) would otherwise survive as an orphan, and the pidfile
  // is removed right after so the sweep couldn't find it either.
  function killChildren(vitePid: number | undefined, fastifyPid: number | undefined): TimerHandle {
    effects.killGroup(vitePid);
    effects.killGroup(fastifyPid);
    return effects.setTimer(config.killGraceMs, () => {
      effects.killGroup(vitePid, "SIGKILL");
      effects.killGroup(fastifyPid, "SIGKILL");
    });
  }

  // Stop the agent-browser dashboard daemon owning `browseEnv`'s socket dir.
  async function stopDashboardCmd(browseEnv: NodeJS.ProcessEnv): Promise<void> {
    await effects
      .spawn("node", [config.agentBrowserBin, "dashboard", "stop"], {
        env: browseEnv,
        stdio: "ignore",
        timeout: 5000,
      })
      .catch(() => {
        /* nothing to stop, fine */
      });
  }

  // Record activity and (re)arm the idle timer. Only a `ready` handle has an
  // idle timer; other phases are a no-op. Mutates the ready variant's idle
  // bookkeeping in place — a within-phase field update, not a transition.
  function touch(handle: WorktreeHandle): void {
    const ready = readyLifecycle(handle);
    if (!ready) return;
    ready.lastActivity = effects.now();
    if (ready.idleTimer) effects.clearTimer(ready.idleTimer);
    ready.idleTimer = effects.setTimer(config.idleTimeoutMs, () => {
      log(`[${handle.name}] idle for ${config.idleTimeoutMs}ms, shutting down`);
      stopWorktree(handle.name).catch((err: unknown) =>
        log(`[${handle.name}] idle shutdown error: ${errMessage(err)}`),
      );
    });
    config.onStateChange?.();
  }

  async function ensureRunning(name: string): Promise<WorktreeHandle> {
    const existing = worktrees.get(name);
    if (existing) {
      if (readyLifecycle(existing)) {
        touch(existing);
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
    const inFlight = begin(startWorktree);
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

  async function startWorktree(handle: WorktreeHandle): Promise<WorktreeHandle> {
    const name = handle.name;
    const wt = await effects.resolveWorktree(name);
    if (!wt) throw statusError(`Worktree ${JSON.stringify(name)} not found`, 404);
    log(`[${name}] starting`);

    await fs.mkdir(config.logDir, { recursive: true });
    const logFile = path.join(config.logDir, `${name}.log`);
    const logStream = createWriteStream(logFile, { flags: "a" });
    logStream.write(`\n=== router start ${new Date(effects.now()).toISOString()} ===\n`);

    const [frontendPort, backendPort, dashboardPort] = await Promise.all([
      effects.getPort(),
      effects.getPort(),
      effects.getPort(),
    ]);
    const { socketDir, profileDir } = browseDirsFor(name);
    await Promise.all([
      fs.mkdir(socketDir, { recursive: true }),
      fs.mkdir(profileDir, { recursive: true }),
    ]);

    const baseUrl = `/${name}/`;
    // --disable-warning=DEP0040 silences the punycode deprecation that
    // transitive deps (ajv@6, node-fetch 2) trigger on every node start.
    const nodeOptions = [process.env.NODE_OPTIONS, "--disable-warning=DEP0040"].filter(Boolean).join(" ");
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      FRONTEND_PORT: String(frontendPort),
      BACKEND_PORT: String(backendPort),
      VITE_BASE: baseUrl,
      PORT: String(backendPort),
      NODE_OPTIONS: nodeOptions,
    };
    const browseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      AGENT_BROWSER_SOCKET_DIR: socketDir,
      AGENT_BROWSER_PROFILE: profileDir,
      AGENT_BROWSER_IDLE_TIMEOUT_MS: String(config.idleTimeoutMs),
    };

    log(`[${name}] frontend=${frontendPort} backend=${backendPort} dashboard=${dashboardPort} base=${baseUrl}`);

    // Each of wt.boxes may be a legacy box dir, a v2 package root, or a v2
    // content dir (see box-entry.ts) — resolve to {contentDir, slug} before
    // handing off to the backend, which no longer guesses the slug itself.
    const resolvedBoxes = await effects.resolveBoxEntries(wt.boxes);
    const backendArgs = config.devNoHub
      ? ["./src/webapp/server-main.ts", ...resolvedBoxes.map(boxEntryToArg)]
      : ["./src/cli/index.ts", "hub", "--config", await effects.writeHubConfig({ name, backendPort, resolvedBoxes })];
    const fastify = effects.spawn("node", ["--import=./tsx-preload.mjs", "--import", "tsx", ...backendArgs], {
      cwd: wt.backendCwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cleanup: true,
    });
    // Invariant #3 of bin/docs/router-protocol.md: swallow the execa rejection at
    // spawn time — the VERY NEXT line, before any await. Without it the rejection
    // becomes an unhandledRejection minutes later (when the killed child finally
    // exits) and crashes the whole router. Actual exit handling happens via
    // .on("exit") below; this only prevents the crash. Was a real bug until
    // 2026-06-04. The waitForHttp-failure path throws between here and the exit
    // wiring, so this MUST be here, not on the success path.
    fastify.catch(() => {
      /* handled via .on("exit") + failed-state UX */
    });
    fastify.stdout?.pipe(logStream, { end: false });
    fastify.stderr?.pipe(logStream, { end: false });
    const fastifyOutputRing = makeOutputRing(8 * 1024);
    fastify.stdout?.on("data", (d: Buffer) => fastifyOutputRing.write(d.toString("utf8")));
    fastify.stderr?.on("data", (d: Buffer) => fastifyOutputRing.write(d.toString("utf8")));

    // pnpm workspace with `node-linker=hoisted` (see /.npmrc) puts all binaries
    // at the workspace root's node_modules/.bin — per-package node_modules/.bin
    // dirs aren't populated. Resolve vite from the worktree's monorepo root.
    const viteBin = path.join(wt.root, "node_modules", ".bin", "vite");
    const vite = effects.spawn(viteBin, ["dev", "--port", String(frontendPort)], {
      cwd: wt.frontendCwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cleanup: true,
    });
    vite.catch(() => {
      /* see fastify.catch above — same reason (invariant #3) */
    });
    vite.stdout?.pipe(logStream, { end: false });
    vite.stderr?.pipe(logStream, { end: false });
    const viteOutputRing = makeOutputRing(8 * 1024);
    vite.stdout?.on("data", (d: Buffer) => viteOutputRing.write(d.toString("utf8")));
    vite.stderr?.on("data", (d: Buffer) => viteOutputRing.write(d.toString("utf8")));

    // Kill any orphaned dashboard daemon for this socket dir before starting a new one.
    await stopDashboardCmd(browseEnv);

    let dashboardStarted = false;
    try {
      await effects.spawn(
        "node",
        [config.agentBrowserBin, "dashboard", "start", "--port", String(dashboardPort)],
        { env: browseEnv, stdio: "ignore", timeout: 15000 },
      );
      dashboardStarted = true;
      log(`[${name}] dashboard ready on :${dashboardPort}`);
    } catch (err) {
      log(`[${name}] dashboard failed to start: ${errMessage(err)}`);
    }

    await effects.pidStore.write(name, {
      name,
      vitePid: vite.pid,
      fastifyPid: fastify.pid,
      frontendPort,
      backendPort,
      dashboardPort: dashboardStarted ? dashboardPort : null,
      socketDir,
      profileDir,
      routerPid: config.routerPid,
      startedAt: effects.now(),
    });

    const expect: PidExpectation = { vitePid: vite.pid, fastifyPid: fastify.pid };

    // Wait for both to serve HTTP — not just accept TCP.
    try {
      await Promise.all([
        effects.waitForHttp(frontendPort, baseUrl, 30000, `vite/${name}`),
        effects.waitForHttp(backendPort, "/healthz", 30000, `fastify/${name}`),
      ]);
    } catch (err) {
      const killTimer = killChildren(vite.pid, fastify.pid);
      // The dashboard daemon started before waitForHttp; stop it too so a failed
      // startup doesn't leak an agent-browser process.
      if (dashboardStarted) await stopDashboardCmd(browseEnv);
      await effects.pidStore.remove(name, expect);
      const captured: CapturedError = {
        message: errMessage(err),
        phase: "waitForHttp",
        viteOutput: viteOutputRing.read(),
        fastifyOutput: fastifyOutputRing.read(),
        at: effects.now(),
      };
      log(`[${name}] startup failed in ${captured.phase}: ${captured.message}`);
      // Invariant #5: guarded publication at the failure terminal too. If a stop
      // (or a newer generation) superseded us while we were failing, DON'T park a
      // `failed` record — this handle is off the map, so terminate it as
      // `stopping` (self-clean semantics) and let the generation that owns the
      // slot stand. Only the current generation publishes its `failed` record.
      if (worktrees.get(name) !== handle) {
        log(`[${name}] startup failed but this generation was superseded — not publishing failure`);
        transitionLifecycle(handle, {
          phase: "stopping",
          reason: "requested",
          vitePid: vite.pid,
          fastifyPid: fastify.pid,
          dashboardPort: dashboardStarted ? dashboardPort : null,
          browseEnv,
          killTimer,
        });
        throw statusError(captured.message, 502);
      }
      transitionLifecycle(handle, { phase: "failed", lastError: captured });
      // The failed generation is parked for the error page + retry; its
      // escalation timer stays fire-and-forget (the `failed` variant carries no
      // children to cancel), but it still fires through the timer effect.
      throw statusError(captured.message, 502);
    }

    // Invariant #5: guarded publication. A `/__router/stop/<name>` (or a newer
    // generation) during this cold start unlinks the handle from the map; if that
    // happened, DON'T publish — kill our own children, remove our own pidfile,
    // and resolve without reappearing in the map (the completed start must not
    // silently resurrect a worktree the user stopped, nor clobber a replacement).
    if (worktrees.get(name) !== handle) {
      log(`[${name}] startup finished but this generation was superseded — self-cleaning, not publishing`);
      const killTimer = killChildren(vite.pid, fastify.pid);
      if (dashboardStarted) await stopDashboardCmd(browseEnv);
      await effects.pidStore.remove(name, expect);
      transitionLifecycle(handle, {
        phase: "stopping",
        reason: "requested",
        vitePid: vite.pid,
        fastifyPid: fastify.pid,
        dashboardPort: dashboardStarted ? dashboardPort : null,
        browseEnv,
        killTimer,
      });
      return handle;
    }

    // Still the current generation — publish `ready` by transitioning the same
    // handle in place (it has been in the map since ensureRunning registered it;
    // no map replacement, so the identity guards stay valid).
    transitionLifecycle(handle, {
      phase: "ready",
      vitePid: vite.pid,
      fastifyPid: fastify.pid,
      frontendPort,
      backendPort,
      dashboardPort: dashboardStarted ? dashboardPort : null,
      dashboardUrl: dashboardStarted ? `http://localhost:${dashboardPort}/` : null,
      socketDir,
      profileDir,
      browseEnv,
      logFile,
      lastActivity: effects.now(),
      idleTimer: null,
    });
    touch(handle);
    log(`[${name}] ready`);

    vite.on("exit", (code, signal) => {
      log(`[${name}] vite exited code=${code} signal=${signal}`);
      onChildExit(handle);
    });
    fastify.on("exit", (code, signal) => {
      log(`[${name}] fastify exited code=${code} signal=${signal}`);
      onChildExit(handle);
    });
    // execa-promise rejection handlers are attached at spawn time above — not
    // here — so they're in place even on the waitForHttp-failure path.

    return handle;
  }

  // Invariant #4 of bin/docs/router-protocol.md: an unexpected exit of a `ready`
  // generation's child (crash, or a drained SIGTERM finally landing). Verify the
  // exiting child still belongs to the map's current handle — a late exit from a
  // replaced generation reduces to a log line, never a teardown of the live entry
  // (the 2026-06-09 "main restarts every 10s" incident). Reason "exited" →
  // detached, fire-and-forget cleanup (no caller awaits an unexpected death).
  function onChildExit(handle: WorktreeHandle): void {
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
    const killTimer = killChildren(vitePid, fastifyPid);
    transitionLifecycle(handle, {
      phase: "stopping",
      reason: "exited",
      vitePid,
      fastifyPid,
      dashboardPort: ready.dashboardPort,
      browseEnv: ready.browseEnv,
      killTimer,
    });
    stopDashboard(handle).catch(() => {});
    effects.pidStore.remove(name, { vitePid, fastifyPid }).catch(() => {});
    config.onStateChange?.();
  }

  // Explicit/idle stop. Reason "requested" → cleanup is AWAITED (the retry
  // endpoint relies on stopWorktree completion). Unlink from the map before any
  // await so a request arriving mid-stop sees a cold worktree and starts a fresh
  // generation, and this cleanup can never delete that new generation's state.
  async function stopWorktree(name: string): Promise<void> {
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
    const killTimer = killChildren(vitePid, fastifyPid);
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
    await stopDashboard(handle).catch(() => {});
    config.onStateChange?.();
  }

  // Stop the agent-browser dashboard for a handle in a phase that owns one
  // (`ready` or `stopping`). Other phases carry no dashboard, so this is a no-op.
  async function stopDashboard(handle: WorktreeHandle): Promise<void> {
    const lc = handle.lifecycle;
    const dashboard =
      lc.phase === "ready" || lc.phase === "stopping"
        ? { dashboardPort: lc.dashboardPort, browseEnv: lc.browseEnv }
        : null;
    if (!dashboard || !dashboard.dashboardPort || !dashboard.browseEnv) return;
    try {
      await effects.spawn("node", [config.agentBrowserBin, "dashboard", "stop"], {
        env: dashboard.browseEnv,
        stdio: "ignore",
        timeout: 5000,
      });
    } catch (err) {
      log(`[${handle.name}] dashboard stop failed: ${errMessage(err)}`);
    }
  }

  async function stopAllChildren(): Promise<void> {
    for (const handle of worktrees.values()) {
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
  }

  function clearFailed(name: string): boolean {
    const handle = worktrees.get(name);
    if (handle && failedLifecycle(handle)) {
      worktrees.delete(name);
      return true;
    }
    return false;
  }

  return {
    ensureRunning,
    stopWorktree,
    touch,
    getHandle: (name) => worktrees.get(name),
    entries: () => [...worktrees.entries()],
    clearFailed,
    stopAllChildren,
  };
}
