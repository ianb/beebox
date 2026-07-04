/**
 * Per-box process supervision for `cb hub` (Track D, chunk D1 in
 * `docs/plans/boxes-as-packages-v2.md`). Adapted from the monorepo dev
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
import { getBoxShape, type BoxShape } from "../cli/lib/box-shape.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { fileExists } from "../lib/file-exists.js";
import type { HubConfig, BoxEntry } from "./hub-config.js";
import type { Endpoint, EndpointProvider } from "./endpoints.js";
import { waitForHttp, killGroup, sleep, HttpReadinessTimeoutError } from "./child-process-utils.js";

type ChildProc = ResultPromise<{ stdio: ["ignore", "pipe", "pipe"]; detached: true; cleanup: true }>;

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
}

/**
 * Owns one child process per configured box: spawns it, waits for
 * `/healthz` to answer, restarts it with backoff on unexpected exit (up to
 * `MAX_CONSECUTIVE_FAILURES`), and tears every child down cleanly on
 * `stopAll()`.
 */
export class Supervisor implements EndpointProvider {
  private readonly boxes = new Map<string, ManagedBox>();

  constructor(private readonly config: HubConfig) {
    for (const [slug, entry] of Object.entries(config.boxes)) {
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
      });
    }
  }

  /** Start every configured box and wait for each to answer `/healthz`
   *  (or exhaust its restart budget). Never rejects -- a box that fails to
   *  come up is reported via `getStatuses()`, not thrown. */
  async startAll(): Promise<void> {
    await Promise.all(Array.from(this.boxes.values()).map((box) => this.launch(box)));
  }

  /** SIGTERM every live child, SIGKILL any survivor after the grace
   *  period, same discipline as the dev router's teardown. */
  async stopAll(): Promise<void> {
    const boxes = Array.from(this.boxes.values());
    for (const box of boxes) {
      if (box.restartTimer) clearTimeout(box.restartTimer);
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

      const child = execa(
        cbBinary,
        ["serve", boxRoot, "--slug", box.slug, "--port", String(port)],
        {
          cwd: shape.packageRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
          cleanup: true,
        }
      ) as ChildProc;
      // Swallow the execa promise rejection here (not just via .on("exit")) --
      // otherwise a killed child's eventual rejection surfaces minutes later
      // as an unhandledRejection and crashes the hub. Same fix router.ts
      // applies to its vite/fastify children.
      child.catch(() => { /* handled via onExit below */ });

      box.child = child;
      box.port = port;

      child.on("exit", (code, signal) => {
        this.onChildExit({ box, generation, code, signal });
      });

      await waitForHttp({ port, reqPath: "/healthz", timeoutMs: READY_TIMEOUT_MS, label: `box/${box.slug}` });
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
