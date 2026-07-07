/**
 * Per-box process supervision for `cb hub` (Track D, chunk D1 in
 * `docs/implemented-plans/boxes-as-packages-v2.md`). Adapted from the monorepo dev
 * router's spawn/readiness/teardown mechanics (`../../../bin/router.ts`,
 * `startWorktree`/`onChildExit`/`stopWorktree`), productized as engine code:
 * no lazy-start or idle-shutdown (hub children are resident — schedulers and
 * webhooks want them up), no worktree/Vite concept, and it adds crash-loop
 * backoff, which the router never needed (a broken worktree just parks
 * "failed" until a human clicks retry; an unattended hub box needs to retry
 * itself, within limits).
 *
 * This module is the ONLY thing that knows a box's endpoint is currently "a
 * child process this supervisor spawned" — it implements `EndpointProvider`
 * (`./endpoints.js`) so `./hub-server.ts` never needs to know that.
 */

import * as path from "node:path";
import { execa, type ResultPromise } from "execa";
import getPorts from "get-port";
import { getBoxShape, type BoxShape } from "../lib/box-shape.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { fileExists } from "../lib/file-exists.js";
import type { HubConfig, BoxEntry } from "./hub-config.js";
import type { Endpoint, EndpointProvider } from "./endpoints.js";
import { waitForHttp, killGroup, sleep, HttpReadinessTimeoutError } from "./child-process-utils.js";
import { buildChildEnv } from "./child-env.js";
import { forwardChildOutput } from "./child-output-log.js";

type ChildProc = ResultPromise<{ stdio: ["ignore", "pipe", "pipe"]; detached: true; cleanup: true }>;

// `buildChildEnv` moved to `./child-env.ts` to keep this file under the
// 300-line cap; re-exported here so existing importers (including
// `test/hub/supervisor.doctest.md`) don't need to change their import path.
export { buildChildEnv };

/** Params for spawning a box child process -- see `SpawnChildFn`. */
export interface ChildSpawnParams {
  cbBinary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Injectable child-process spawner. Real `execa` by default; tests override
 * it to simulate a child that never becomes ready, deterministically and
 * without a real process -- see `test/hub/supervisor.doctest.md`'s restart
 * race coverage.
 */
export type SpawnChildFn = (params: ChildSpawnParams) => ChildProc;

function defaultSpawnChild(params: ChildSpawnParams): ChildProc {
  return execa(params.cbBinary, params.args, {
    cwd: params.cwd,
    env: params.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    cleanup: true,
  }) as ChildProc;
}

/** Injectable readiness probe -- real `waitForHttp` by default; tests
 *  override it to fail immediately instead of waiting out
 *  `READY_TIMEOUT_MS` for real, so the restart race in
 *  `test/hub/supervisor.doctest.md` runs in milliseconds. */
export type CheckReadyFn = (params: { port: number; label: string }) => Promise<void>;

function defaultCheckReady(params: { port: number; label: string }): Promise<void> {
  return waitForHttp({ port: params.port, reqPath: "/healthz", timeoutMs: READY_TIMEOUT_MS, label: params.label });
}

const READY_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 2000;
/** After this many consecutive crash-loop restarts, stop retrying and mark
 *  the box unhealthy until `reloadUnhealthy()` (SIGHUP) is called. No
 *  precedent in router.ts (worktrees don't self-restart) — chosen per the
 *  plan's explicit "pick N=5 unless you find a better precedent" guidance. */
const MAX_CONSECUTIVE_FAILURES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export class BoxResolutionError extends Error {
  constructor(entryPath: string) {
    super(
      "Configured box path " + entryPath + " has no .cb-box marker at itself or at its " +
        "content/ subdirectory -- not a callback box (checked both the v2 package-root " +
        "and legacy/v2 content-dir shapes)."
    );
    this.name = "BoxResolutionError";
  }
}

/**
 * Resolve a `hub.json` entry's `path` (may be a v2 PACKAGE root or a
 * content dir -- the plan's bilingual layout, resolved downward here the
 * way `findBoxRoot` resolves upward from a cwd) to the actual box
 * (content) root that `getBoxShape` expects.
 */
export async function resolveBoxRoot(entryPath: string): Promise<string> {
  if (await fileExists(path.join(entryPath, ".cb-box"))) return entryPath;
  const nested = path.join(entryPath, "content");
  if (await fileExists(path.join(nested, ".cb-box"))) return nested;
  throw new BoxResolutionError(entryPath);
}

/** The box's own installed `cb` when present (v2, installed), else the
 *  running engine's own `cb` (legacy boxes, or a v2 box mid-transition
 *  that hasn't been `pnpm install`ed yet -- same fallback the plan
 *  specifies for the transition window). */
async function resolveCbBinary(shape: BoxShape): Promise<string> {
  const ownBin = path.join(shape.packageRoot, "node_modules", ".bin", "cb");
  if (await fileExists(ownBin)) return ownBin;
  return path.join(PACKAGE_ROOT, "bin", "cb");
}

export type BoxRunStatus = "starting" | "running" | "unhealthy" | "stopped";

export interface BoxRuntimeStatus {
  slug: string;
  status: BoxRunStatus;
  pid: number | undefined;
  port: number | undefined;
  restarts: number;
  lastError: string | undefined;
}

interface ManagedBox {
  slug: string;
  entry: BoxEntry;
  status: BoxRunStatus;
  child: ChildProc | undefined;
  port: number | undefined;
  restarts: number;
  consecutiveFailures: number;
  lastError: string | undefined;
  /** Guards against a stale exit/readiness event from a generation that's
   *  already been superseded by a restart -- same hazard router.ts's
   *  `onChildExit` comment describes for worktrees. */
  generation: number;
  restartTimer: NodeJS.Timeout | undefined;
  /**
   * Set to the generation number `launch()`'s own readiness-timeout catch
   * block just killed, right before it calls `killGroup()` -- so when that
   * kill's "exit" event later fires (same generation, since a restart
   * hasn't started yet), `onChildExit` recognizes the failure was already
   * recorded and a restart already scheduled, instead of double-counting
   * both and scheduling a second, overlapping child. Cleared once consumed.
   */
  expectedExitGeneration: number | undefined;
  /** Lazy mode only. Set while a cold-start is in flight, so concurrent
   *  requests for the same slug (`ensureRunning`) await the SAME launch
   *  instead of each spawning their own child -- the exact "atomic
   *  register-then-await" hazard `bin/router.ts`'s `ensureRunning` comment
   *  documents for worktrees. Cleared once the launch settles. */
  startPromise: Promise<void> | undefined;
  /** Lazy mode only. Last time an HTTP request touched this box (WS
   *  upgrades never count -- see `hub-server.ts`). Drives the idle timer. */
  lastActivity: number | undefined;
  idleTimer: NodeJS.Timeout | undefined;
}

export interface SupervisorOptions {
  config: HubConfig;
  /**
   * Handed to every spawned child via `CB_HUB_SECRET` (Track D, chunk D2) --
   * the per-boot secret that gates the hub-injected identity headers a box
   * trusts in hub mode. See `src/webapp/auth.ts`'s
   * `isHubMode`/`resolveRequestIdentity`.
   */
  hubSecret: string;
  /** Injectable child spawner -- real `execa` (`defaultSpawnChild`) unless
   *  a test overrides it. See `SpawnChildFn`. */
  spawnChild?: SpawnChildFn;
  /** Injectable readiness probe -- real `waitForHttp` (`defaultCheckReady`)
   *  unless a test overrides it. See `CheckReadyFn`. */
  checkReady?: CheckReadyFn;
}

/**
 * Owns one child process per configured box: spawns it, waits for
 * `/healthz` to answer, restarts it with backoff on unexpected exit (up to
 * `MAX_CONSECUTIVE_FAILURES`), and tears every child down cleanly on
 * `stopAll()`.
 */
export class Supervisor implements EndpointProvider {
  private readonly boxes = new Map<string, ManagedBox>();
  private readonly config: HubConfig;
  private readonly hubSecret: string;
  private readonly spawnChild: SpawnChildFn;
  private readonly checkReady: CheckReadyFn;

  constructor(options: SupervisorOptions) {
    this.config = options.config;
    this.hubSecret = options.hubSecret;
    this.spawnChild = options.spawnChild ?? defaultSpawnChild;
    this.checkReady = options.checkReady ?? defaultCheckReady;
    for (const [slug, entry] of Object.entries(options.config.boxes)) {
      this.boxes.set(slug, {
        slug,
        entry,
        status: "starting",
        child: undefined,
        port: undefined,
        restarts: 0,
        consecutiveFailures: 0,
        lastError: undefined,
        generation: 0,
        restartTimer: undefined,
        expectedExitGeneration: undefined,
        startPromise: undefined,
        lastActivity: undefined,
        idleTimer: undefined,
      });
    }
  }

  /**
   * Start every configured box and wait for each to answer `/healthz` (or
   * exhaust its restart budget) -- UNLESS `config.lazy` is set, in which
   * case nothing is spawned here at all: every box starts "stopped" and
   * `ensureRunning()` spawns it on the first HTTP request (boxholder
   * directive, 2026-07-04 -- the same lazy-per-worktree semantics
   * `bin/router.ts` already has, now available to a production hub for
   * memory-constrained hosts). Never rejects -- a box that fails to come up
   * is reported via `getStatuses()`, not thrown.
   */
  async startAll(): Promise<void> {
    if (this.config.lazy) {
      for (const box of this.boxes.values()) box.status = "stopped";
      return;
    }
    await Promise.all(Array.from(this.boxes.values()).map((box) => this.launch(box)));
  }

  /**
   * Lazy mode only: ensure `slug`'s box is running, spawning it on first
   * request and waiting for readiness if it's currently "stopped" --
   * mirrors `bin/router.ts`'s `ensureRunning` for worktrees. Concurrent
   * callers for the same cold slug all await the one in-flight
   * `startPromise` rather than each spawning their own child. Returns the
   * endpoint once ready, or `undefined` if the slug isn't configured or the
   * launch failed (the caller -- `hub-server.ts` -- turns that into a 502).
   * Non-lazy hubs (or a slug already running) just resolve to `get(slug)`
   * with no spawn attempt -- `EndpointProvider.get()` alone is still
   * correct for them.
   */
  async ensureRunning(slug: string): Promise<Endpoint | undefined> {
    const box = this.boxes.get(slug);
    if (!box) return undefined;
    if (!this.config.lazy) return this.get(slug);
    if (box.status === "running") {
      this.touch(box);
      return this.get(slug);
    }
    if (box.startPromise) {
      // Either our own cold-start below, or a crash-loop retry that raced
      // us in (markFailedOrScheduleRestart's own setTimeout doesn't set
      // startPromise -- only a slug actually requested does). Await it
      // rather than racing a second spawn for the same slug.
      await box.startPromise;
      return this.touchIfRunning(box);
    }
    // "unhealthy" (crash-loop budget exhausted -- needs SIGHUP, same as a
    // non-lazy hub) or "starting" via a scheduled backoff retry (no
    // in-flight promise to await) both fall through here: don't pile a
    // second spawn attempt on top, just report not-yet-available and let
    // the next request try again once that retry has had a chance to land.
    if (box.status !== "stopped") return this.get(slug);
    box.startPromise = this.launch(box).finally(() => {
      box.startPromise = undefined;
    });
    await box.startPromise;
    return this.touchIfRunning(box);
  }

  /** `get(box.slug)` also tells us, via a fresh read, whether the launch
   *  that just settled actually left the box running -- reading through
   *  `get()` (rather than re-checking `box.status` inline) sidesteps a
   *  TS control-flow-narrowing false positive across the `await` above
   *  (the compiler otherwise "remembers" an earlier `!== "running"` check
   *  on the same property access and refuses to narrow it back). */
  private touchIfRunning(box: ManagedBox): Endpoint | undefined {
    const endpoint = this.get(box.slug);
    if (endpoint) this.touch(box);
    return endpoint;
  }

  /** Reset (or start) a box's idle timer. Lazy mode only -- a no-op
   *  otherwise, since resident boxes never idle-stop. */
  private touch(box: ManagedBox): void {
    if (!this.config.lazy) return;
    box.lastActivity = Date.now();
    if (box.idleTimer) clearTimeout(box.idleTimer);
    box.idleTimer = setTimeout(() => {
      void this.stopBox(box);
    }, this.config.idleMs);
    box.idleTimer.unref();
  }

  /**
   * Lazy mode's idle-collection teardown: SIGTERM (SIGKILL fallback) the
   * box's child and park it back at "stopped" -- `ensureRunning()` will
   * cold-start it again on the next request, `getStatuses()`/`/healthz`
   * report "stopped" in the meantime, and the box picker still lists it
   * (it's driven by the static config, not live status -- see
   * `box-picker.ts`). Setting `status = "stopped"` BEFORE killing makes
   * `onChildExit`'s existing `if (box.status === "stopped") return;` guard
   * (written for `stopAll()`) treat this exit as expected too, so it's
   * reused rather than duplicated.
   */
  private async stopBox(box: ManagedBox): Promise<void> {
    if (box.idleTimer) clearTimeout(box.idleTimer);
    box.idleTimer = undefined;
    if (box.status !== "running") return;
    box.status = "stopped";
    const pid = box.child?.pid;
    box.child = undefined;
    box.port = undefined;
    if (pid) {
      killGroup(pid, "SIGTERM");
      setTimeout(() => killGroup(pid, "SIGKILL"), KILL_GRACE_MS).unref();
    }
  }

  /** SIGTERM every live child, SIGKILL any survivor after the grace
   *  period, same discipline as the dev router's teardown. */
  async stopAll(): Promise<void> {
    const boxes = Array.from(this.boxes.values());
    for (const box of boxes) {
      if (box.restartTimer) clearTimeout(box.restartTimer);
      if (box.idleTimer) clearTimeout(box.idleTimer);
      box.status = "stopped";
    }
    const pids = boxes.map((box) => box.child?.pid).filter((pid): pid is number => pid !== undefined);
    for (const pid of pids) killGroup(pid, "SIGTERM");
    if (pids.length === 0) return;
    await sleep(KILL_GRACE_MS);
    for (const pid of pids) killGroup(pid, "SIGKILL");
  }

  /** SIGHUP handling: give any crash-looped ("unhealthy") box a fresh
   *  restart budget and try again. Does not re-read `hub.json` -- adding
   *  or removing boxes still requires a hub restart; this only clears the
   *  "stop retrying" latch the plan calls for. */
  reloadUnhealthy(): void {
    for (const box of this.boxes.values()) {
      if (box.status !== "unhealthy") continue;
      box.consecutiveFailures = 0;
      box.lastError = undefined;
      void this.launch(box);
    }
  }

  get(slug: string): Endpoint | undefined {
    const box = this.boxes.get(slug);
    if (!box || box.status !== "running" || box.port === undefined) return undefined;
    return { slug, origin: `http://127.0.0.1:${box.port}` };
  }

  slugs(): string[] {
    return Array.from(this.boxes.keys());
  }

  getStatuses(): BoxRuntimeStatus[] {
    return Array.from(this.boxes.values()).map((box) => ({
      slug: box.slug,
      status: box.status,
      pid: box.child?.pid,
      port: box.port,
      restarts: box.restarts,
      lastError: box.lastError,
    }));
  }

  private async launch(box: ManagedBox): Promise<void> {
    box.status = "starting";
    const generation = ++box.generation;
    try {
      const boxRoot = await resolveBoxRoot(box.entry.path);
      const shape = await getBoxShape(boxRoot);
      const cbBinary = await resolveCbBinary(shape);
      const port = await getPorts();

      const env = buildChildEnv({ sourceEnv: process.env, hubExtras: { CB_HUB_SECRET: this.hubSecret } });
      const child = this.spawnChild({
        cbBinary,
        args: ["serve", boxRoot, "--slug", box.slug, "--port", String(port)],
        cwd: shape.packageRoot,
        env,
      });
      // Swallow the execa promise rejection here (not just via .on("exit")) --
      // otherwise a killed child's eventual rejection surfaces minutes later
      // as an unhandledRejection and crashes the hub. Same fix router.ts
      // applies to its vite/fastify children.
      child.catch(() => { /* handled via onExit below */ });
      forwardChildOutput({ child, logFile: path.join(boxRoot, ".callback-box", "hub-child.log") });

      box.child = child;
      box.port = port;

      child.on("exit", (code, signal) => {
        this.onChildExit({ box, generation, code, signal });
      });

      await this.checkReady({ port, label: `box/${box.slug}` });
      if (box.generation !== generation) return; // superseded mid-startup
      box.status = "running";
      box.consecutiveFailures = 0;
      box.lastError = undefined;
    } catch (e) {
      if (box.generation !== generation) return; // superseded mid-startup
      const message = describeError(e);
      box.lastError = message;
      box.consecutiveFailures += 1;
      if (box.child) {
        // We're about to kill this generation's child ourselves (e.g. a
        // readiness timeout) -- mark the exit that kill will eventually
        // produce as "expected" so onChildExit doesn't ALSO treat it as an
        // unexpected crash and schedule a second, overlapping restart. Set
        // BEFORE killGroup() so there's no window for the exit event (which
        // can fire synchronously in tests, and fast in practice) to arrive
        // unguarded.
        box.expectedExitGeneration = generation;
        killGroup(box.child.pid, "SIGTERM");
        setTimeout(() => killGroup(box.child?.pid, "SIGKILL"), KILL_GRACE_MS).unref();
      }
      box.child = undefined;
      box.port = undefined;
      this.markFailedOrScheduleRestart(box);
    }
  }

  private onChildExit(params: {
    box: ManagedBox;
    generation: number;
    code: number | null;
    signal: NodeJS.Signals | null;
  }): void {
    const { box, generation, code, signal } = params;
    if (box.generation !== generation) return; // stale exit from a superseded generation
    if (box.status === "stopped") return; // expected -- stopAll() is tearing down
    if (box.expectedExitGeneration === generation) {
      // This generation's child was killed by launch()'s own
      // readiness-timeout catch block, which already recorded the failure
      // and scheduled the restart -- without this guard the same failure
      // gets double-counted and a second, overlapping child gets spawned.
      box.expectedExitGeneration = undefined;
      return;
    }
    box.lastError = `child exited unexpectedly (code=${String(code)}, signal=${String(signal)})`;
    box.consecutiveFailures += 1;
    box.child = undefined;
    box.port = undefined;
    this.markFailedOrScheduleRestart(box);
  }

  private markFailedOrScheduleRestart(box: ManagedBox): void {
    if (box.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      box.status = "unhealthy";
      return;
    }
    box.status = "starting";
    box.restarts += 1;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (box.consecutiveFailures - 1));
    box.restartTimer = setTimeout(() => {
      void this.launch(box);
    }, delay);
    box.restartTimer.unref();
  }
}

function describeError(e: unknown): string {
  if (e instanceof HttpReadinessTimeoutError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
