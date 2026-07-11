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
import getPorts from "get-port";
import { getBoxShape } from "../lib/box-shape.js";
import type { HubConfig, BoxEntry } from "./hub-config.js";
import { HubState } from "./hub-state.js";
import { invariant } from "../lib/invariant.js";
import type { Endpoint, EndpointProvider } from "./endpoints.js";
import { killGroup, sleep, HttpReadinessTimeoutError } from "./child-process-utils.js";
import { buildChildEnv } from "./child-env.js";
import { forwardChildOutput } from "./child-output-log.js";
// prettier-ignore
import { type ChildProc, type SpawnChildFn, type CheckReadyFn, defaultSpawnChild, defaultCheckReady, resolveBoxRoot, resolveCbBinary } from "./child-spawn.js";

// `buildChildEnv` (env allowlist) and the child-spawn/box-resolution
// primitives moved to sibling files to keep this one under the 300-line cap;
// `buildChildEnv` is re-exported here so existing importers
// (`test/hub/supervisor.doctest.md`) don't need to change their import path.
// `resolveBoxRoot` importers point at `./child-spawn.js` directly.
export { buildChildEnv };

const KILL_GRACE_MS = 2000;
/** After this many consecutive crash-loop restarts, stop retrying and mark
 *  the box unhealthy until `reloadUnhealthy()` (SIGHUP) is called. No
 *  precedent in router.ts (worktrees don't self-restart) — chosen per the
 *  plan's explicit "pick N=5 unless you find a better precedent" guidance. */
const MAX_CONSECUTIVE_FAILURES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

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
  /** Injectable clock (defaults to `Date.now`), shared with `HubState`, so
   *  doctests can drive idle/keep-set ordering deterministically instead of
   *  waiting out real timers. See `test/hub/supervisor.doctest.md`. */
  now?: () => number;
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
  private readonly now: () => number;
  private readonly hubState: HubState;

  constructor(options: SupervisorOptions) {
    this.config = options.config;
    this.hubSecret = options.hubSecret;
    this.spawnChild = options.spawnChild ?? defaultSpawnChild;
    this.checkReady = options.checkReady ?? defaultCheckReady;
    this.now = options.now ?? Date.now;
    this.hubState = new HubState({ configPath: options.config.configPath, now: this.now });
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
      await this.hubState.load();
      await this.prestartRecent();
      return;
    }
    await Promise.all(Array.from(this.boxes.values()).map((box) => this.launch(box)));
  }

  /**
   * Lazy mode with `keepRecent > 0`: instead of leaving every box stopped,
   * pre-start the `keepRecent` most-recently-used configured boxes (by
   * persisted `hub-state.json` recency) so a hub restart resumes the
   * boxholder's working set rather than everything or nothing. Slugs not in
   * the current config are skipped (a box can be removed between boots), and
   * if fewer boxes have recorded activity, fewer are started. Launches are
   * awaited like a non-lazy `startAll` -- a failure is reported via status,
   * never thrown.
   */
  private async prestartRecent(): Promise<void> {
    if (this.config.keepRecent <= 0) return;
    const ranked = this.hubState.slugsByRecency().filter((slug) => this.boxes.has(slug));
    const toStart = ranked.slice(0, this.config.keepRecent);
    await Promise.all(toStart.map((slug) => this.prestartBox(slug)));
  }

  /** Launch one pre-start box and, if it came up, seed its in-memory recency
   *  from the persisted value (so the keep-set ordering matches what the last
   *  hub incarnation saw) and arm its idle timer. */
  private async prestartBox(slug: string): Promise<void> {
    const box = this.boxes.get(slug);
    invariant(box, `prestart slug "${slug}" must be configured (filtered on boxes.has above)`);
    const persisted = this.hubState.lastActivity(slug);
    await this.launch(box);
    if (!this.get(slug)) return; // launch failed -- reported via status
    box.lastActivity = persisted ?? this.now();
    this.armIdleTimer(box);
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

  /** Record a request against a box: refresh its in-memory + persisted
   *  recency and (re)arm its idle timer. Lazy mode only -- a no-op otherwise,
   *  since resident boxes never idle-stop. */
  private touch(box: ManagedBox): void {
    if (!this.config.lazy) return;
    box.lastActivity = this.now();
    this.hubState.record(box.slug);
    this.armIdleTimer(box);
  }

  /** (Re)start a box's idle timer without touching recency -- the timer fires
   *  into `evaluateIdle`, which either stops the box or keeps it (keep-set)
   *  and re-arms. */
  private armIdleTimer(box: ManagedBox): void {
    if (box.idleTimer) clearTimeout(box.idleTimer);
    box.idleTimer = setTimeout(() => {
      void this.evaluateIdle(box.slug);
    }, this.config.idleMs);
    box.idleTimer.unref();
  }

  /**
   * The idle-timer's decision, factored out of the timer callback so doctests
   * can drive it deterministically (the real `setTimeout` just calls this).
   * A running box that's in the keep-set -- the `config.keepRecent`
   * most-recently-active running boxes -- stays alive and re-arms its timer,
   * so it only stops once displaced by more-recently-used boxes; otherwise it
   * stops as a plain lazy hub would. Returns which branch it took.
   */
  async evaluateIdle(slug: string): Promise<"stopped" | "kept" | "not-running"> {
    const box = this.boxes.get(slug);
    if (!box || box.status !== "running") return "not-running";
    if (this.keepSetSlugs().includes(slug)) {
      this.armIdleTimer(box);
      return "kept";
    }
    await this.stopBox(box);
    return "stopped";
  }

  /** The current keep-set: the `config.keepRecent` most-recently-active
   *  running boxes (by in-memory `lastActivity`). Empty when `keepRecent` is
   *  0. Exposed for `evaluateIdle` and its doctests. */
  keepSetSlugs(): string[] {
    if (this.config.keepRecent <= 0) return [];
    return Array.from(this.boxes.values())
      .filter((box) => box.status === "running")
      .toSorted((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))
      .slice(0, this.config.keepRecent)
      .map((box) => box.slug);
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
    if (this.config.lazy) await this.hubState.flush();
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
      // A lazy child can reach "running" through paths that never call
      // touch() -- a crash-loop backoff retry, or a keepRecent pre-start that
      // failed once and recovered. Without an idle timer such a box would sit
      // resident forever, outside both idle-stop and the keep-set. Arm it
      // here unconditionally; callers that do touch() just re-arm.
      if (this.config.lazy) this.armIdleTimer(box);
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
