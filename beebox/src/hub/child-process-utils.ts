/**
 * Small process-supervision primitives shared by `src/hub/supervisor.ts`,
 * adapted from the monorepo dev router (`../../../workstreams-app/src/router/router.ts`'s
 * `waitForHttp`/`killGroup`/`sleep`) — see that file's module doc for the
 * original rationale. Kept here as plain functions (no router-specific
 * state) so the hub doesn't depend on the monorepo-only router script.
 */

import http from "node:http";
import { errnoCode } from "../lib/error-guards.js";

export { DEV_BUNDLE_RELOAD_EXIT_CODE } from "../lib/dev-bundle-reload.js";

/**
 * How long a BOX child gets between SIGTERM and SIGKILL.
 *
 * Much longer than {@link KILL_GRACE_MS}, because the thing being interrupted
 * is a git write. A box child that is mid-`git commit` when SIGKILL lands
 * leaves `.git/index.lock` behind with no owner, and every writer in that box
 * then fails until someone removes the file (`lib/git-stale-lock.ts`). Two
 * seconds is not enough: the largest production box is an 11GB repository
 * whose `add -A` alone runs for seconds, and a lazy hub tears boxes down on an
 * idle timer all day, so the 2s escalation was landing on live git writes
 * routinely.
 *
 * This is an upper bound, not a delay: `stopBox`/`stopAll` poll for the child
 * to exit and escalate the moment it does, so an ordinary teardown is still
 * as fast as the child is.
 */
export const BOX_KILL_GRACE_MS = 30_000;

/**
 * Wait for the process GROUPS led by `pids` to empty, up to `timeoutMs`.
 * Returns the pids whose groups are still populated.
 *
 * Groups, not the leaders — that distinction is the whole point. We signal
 * `-pid`, and the process we are actually waiting on is usually a grandchild: a
 * box child's `git`. Polling the leader alone would return as soon as the box
 * server exited and leave its `git` to be killed by whatever teardown follows,
 * which is exactly the mid-index-write SIGKILL this wait exists to avoid.
 *
 * Polling rather than exit events for the same reason: the grandchildren are
 * processes we never spawned and have no handle on.
 */
export async function waitForExit(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let alive = pids.filter((pid) => groupAlive(pid));
  while (alive.length > 0 && Date.now() < deadline) {
    await sleep(EXIT_POLL_MS);
    alive = alive.filter((pid) => groupAlive(pid));
  }
  return alive;
}

/** Poll interval while waiting for children to exit. */
const EXIT_POLL_MS = 100;

export function restartAfterDevBundleReload(options: {
  code: number | null;
  expectedCode: number;
  box: { child: unknown; port: number | undefined; status: string; restarts: number; restartTimer: NodeJS.Timeout | undefined },
  launch: () => void;
}): boolean {
  const { code, expectedCode, box, launch } = options;
  if (code !== expectedCode) return false;
  box.child = undefined;
  box.port = undefined;
  box.status = "starting";
  box.restarts += 1;
  box.restartTimer = setTimeout(launch, 0);
  box.restartTimer.unref();
  return true;
}

/**
 * HTTP-level readiness probe: TCP-accepting isn't enough, a process can
 * accept connections before its request handlers are wired up. Any HTTP
 * response (even a 401/503) counts as "ready" — the hub doesn't assume
 * `BBX_DIAG_API_KEY` is configured, so a box's `/healthz` may legitimately
 * answer "unconfigured" or "unauthorized" while still being a live server.
 */
export interface WaitForHttpOptions {
  port: number;
  reqPath: string;
  timeoutMs: number;
  label: string;
}

export async function waitForHttp({ port, reqPath, timeoutMs, label }: WaitForHttpOptions): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: reqPath, method: "GET", timeout: 1000 },
        (res) => {
          res.resume();
          resolve(true);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
    if (ok) return;
    await sleep(150);
  }
  throw new HttpReadinessTimeoutError({ label, reqPath, timeoutMs });
}

class HttpReadinessTimeoutError extends Error {
  constructor({ label, reqPath, timeoutMs }: { label: string; reqPath: string; timeoutMs: number }) {
    super(`${label} did not respond to HTTP GET ${reqPath} within ${timeoutMs}ms`);
    this.name = "HttpReadinessTimeoutError";
  }
}

/** Human-readable message for an error caught during a box launch: the
 *  readiness-timeout class already carries a descriptive message, everything
 *  else falls back to its `.message` or a string form. */
export function describeError(e: unknown): string {
  if (e instanceof HttpReadinessTimeoutError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Signal a process group (falls back to the bare pid if it isn't a group leader). */
export function killGroup(pid: number | undefined, signal?: NodeJS.Signals): void {
  if (!pid) return;
  const sig = signal ?? "SIGTERM";
  try {
    process.kill(-pid, sig);
  } catch (_e) {
    try {
      process.kill(pid, sig);
    } catch (_e2) {
      /* already gone */
    }
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return errnoCode(e) === "EPERM";
  }
}

/**
 * Whether ANY process remains in the group led by `pid`.
 *
 * `kill(-pid, 0)` succeeds while the group has members and raises ESRCH once it
 * is empty, which is the liveness question a group-directed teardown actually
 * asks. Falls back to the bare pid the way {@link killGroup} does: a child that
 * is not a group leader has no group of its own, and `-pid` would then answer
 * about some unrelated group (or nothing at all).
 */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    if (errnoCode(e) === "EPERM") return true;
    return pidAlive(pid);
  }
}

/**
 * SIGTERM a box child's process group, then SIGKILL whatever survives the box
 * grace period.
 *
 * Detached on purpose: the caller (an idle timer, a readiness-timeout catch)
 * must not block for the whole grace, but the escalation still has to happen.
 * It fires as soon as the group is empty, so an ordinary teardown costs one
 * poll interval, not {@link BOX_KILL_GRACE_MS}.
 */
export function killAfterGrace(pid: number | undefined): void {
  if (pid === undefined) return;
  killGroup(pid, "SIGTERM");
  void waitForExit([pid], BOX_KILL_GRACE_MS)
    .then((survivors) => {
      if (survivors.length === 0) return;
      console.warn(`[hub] box child ${String(pid)}'s process group did not empty within the grace period; killing.`);
      killGroup(pid, "SIGKILL");
    })
    .catch((e: unknown) => {
      console.warn(`[hub] escalation for box child ${String(pid)} failed: ${describeError(e)}`);
    });
}
