/**
 * Stale-while-revalidate snapshot cache for `health.check`.
 *
 * `runHealthChecks` is deep and slow — it spawns `claude auth status`, runs the
 * git-annex doctor over the attachment trees, walks `tmp-capture/`, and does a
 * dozen serial fs probes (measured 580–650 ms on prod). It rides in the
 * dashboard's tRPC batch, so every dashboard load waited on it.
 *
 * A request never blocks on the deep checks more than once per box: the first
 * call computes and caches, calls within the TTL answer from the snapshot, and
 * a call past the TTL answers from the snapshot *and* kicks a background
 * refresh. So a newly broken (or newly repaired) box surfaces on the request
 * after that one, rather than never — the reason this is stale-while-revalidate
 * and not a blind TTL that would go silent for a minute at a time.
 *
 * `fresh: true` bypasses all of it, for callers that need a verdict computed
 * now (deploy runbooks hitting `/api/trpc/health.check` through the diag-key
 * bypass). The other fresh-by-construction callers — `cb health` and
 * `/api/health` — call `runHealthChecks` directly and never come through here.
 *
 * The cache is per-process and keyed by box root; a `cb serve` child owns one
 * box, and the hub restarts children on deploy, so there is nothing to
 * invalidate across processes.
 *
 * `compute` is injected rather than imported so this module does not value-import
 * `health.ts` (which imports this one for the router).
 */

import { errorMessage } from "../../../lib/error-guards.js";
import type { HealthCheck, VersionInfo } from "./health.js";

/** What `health.check` returns — the shape the dashboard renders. */
export interface HealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  checks: HealthCheck[];
  version: VersionInfo;
}

/**
 * How long a snapshot is served without even kicking a refresh. Long enough
 * that a dashboard reload never re-runs the probes, short enough that a broken
 * box shows up on the next visit rather than the next deploy.
 */
export const HEALTH_SNAPSHOT_TTL_MS = 60_000;

interface CacheEntry {
  report: HealthReport;
  computedAt: number;
  /**
   * Write order. Every computation takes a sequence number when it STARTS, and
   * a completed computation refuses to overwrite an entry written by a
   * later-started one. Without this, a background refresh that began before a
   * `fresh: true` call could land after it and re-poison the cache with the
   * older verdict for the rest of the TTL — exactly the window a deploy
   * verifier is reading.
   */
  seq: number;
  /**
   * The last background refresh for this box threw. The next non-fresh call
   * computes in the FOREGROUND so the failure reaches the caller instead of
   * this serving a last-known-good report indefinitely behind a log line.
   */
  refreshFailed: boolean;
}

const snapshots = new Map<string, CacheEntry>();
/** In-flight refreshes, so a burst of cold requests computes once, not N times. */
const refreshes = new Map<string, Promise<HealthReport>>();
let writeSeq = 0;

export interface HealthSnapshotOptions {
  /** Runs the deep checks. Injected to keep this module free of `health.ts`. */
  compute: () => Promise<HealthReport>;
  /** Skip the cache entirely and compute now. Omit for the cached path. */
  fresh?: boolean | undefined;
  /** Clock override for tests. Omit in production (`Date.now`). */
  now?: (() => number) | undefined;
}

interface RecordArgs {
  report: HealthReport;
  seq: number;
  now: () => number;
}

/** Store a completed computation, unless a later-started one already landed. */
function record(boxRoot: string, { report, seq, now }: RecordArgs): void {
  const existing = snapshots.get(boxRoot);
  if (existing !== undefined && existing.seq > seq) return;
  snapshots.set(boxRoot, { report, computedAt: now(), seq, refreshFailed: false });
}

/** Compute, cache, and de-duplicate concurrent refreshes for one box. */
function refresh(boxRoot: string, options: HealthSnapshotOptions): Promise<HealthReport> {
  const inFlight = refreshes.get(boxRoot);
  if (inFlight !== undefined) return inFlight;
  const now = options.now ?? Date.now;
  const seq = ++writeSeq;
  const promise = options
    .compute()
    .then((report) => {
      record(boxRoot, { report, seq, now });
      return report;
    })
    .catch((e: unknown) => {
      // Latch the failure onto the snapshot so the next reader stops being
      // served a report that may now be a lie. Rethrow: a foreground caller
      // must still see the error.
      const existing = snapshots.get(boxRoot);
      if (existing !== undefined) snapshots.set(boxRoot, { ...existing, refreshFailed: true });
      throw e;
    })
    .finally(() => {
      refreshes.delete(boxRoot);
    });
  refreshes.set(boxRoot, promise);
  return promise;
}

export async function getHealthSnapshot(
  boxRoot: string,
  options: HealthSnapshotOptions,
): Promise<HealthReport> {
  const now = options.now ?? Date.now;
  if (options.fresh === true) {
    // Deliberately NOT joining an in-flight background refresh: that refresh may
    // have started before whatever the caller just changed, and a runbook asking
    // for `fresh` is asking about the state right now.
    const seq = ++writeSeq;
    const report = await options.compute();
    record(boxRoot, { report, seq, now });
    return report;
  }
  const entry = snapshots.get(boxRoot);
  if (entry === undefined) return refresh(boxRoot, options);
  // A refresh that threw means the snapshot's provenance is broken, not merely
  // old. Recompute in the foreground: either it succeeds and clears the latch,
  // or the caller gets the error. One attempt per request either way — this
  // cannot spin.
  if (entry.refreshFailed) return refresh(boxRoot, options);
  if (now() - entry.computedAt < HEALTH_SNAPSHOT_TTL_MS) return entry.report;
  // Stale: answer instantly from the snapshot, refresh behind the request. The
  // refreshed verdict is visible to the NEXT reader, not this one.
  void refresh(boxRoot, options).catch((e: unknown) => {
    console.error(`[health] background snapshot refresh failed for ${boxRoot}: ${errorMessage(e)}`);
  });
  return entry.report;
}
