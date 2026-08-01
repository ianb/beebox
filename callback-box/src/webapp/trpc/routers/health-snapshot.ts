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
 * refresh. So a newly broken (or newly repaired) box surfaces within one
 * refresh cycle rather than never — the reason this is stale-while-revalidate
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
}

const snapshots = new Map<string, CacheEntry>();
/** In-flight refreshes, so a burst of cold requests computes once, not N times. */
const refreshes = new Map<string, Promise<HealthReport>>();

export interface HealthSnapshotOptions {
  /** Runs the deep checks. Injected to keep this module free of `health.ts`. */
  compute: () => Promise<HealthReport>;
  /** Skip the cache entirely and compute now. Omit for the cached path. */
  fresh?: boolean | undefined;
  /** Clock override for tests. Omit in production (`Date.now`). */
  now?: (() => number) | undefined;
}

/** Compute, cache, and de-duplicate concurrent refreshes for one box. */
function refresh(boxRoot: string, options: HealthSnapshotOptions): Promise<HealthReport> {
  const inFlight = refreshes.get(boxRoot);
  if (inFlight !== undefined) return inFlight;
  const now = options.now ?? Date.now;
  const promise = options
    .compute()
    .then((report) => {
      snapshots.set(boxRoot, { report, computedAt: now() });
      return report;
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
    const report = await options.compute();
    snapshots.set(boxRoot, { report, computedAt: now() });
    return report;
  }
  const entry = snapshots.get(boxRoot);
  if (entry === undefined) return refresh(boxRoot, options);
  if (now() - entry.computedAt < HEALTH_SNAPSHOT_TTL_MS) return entry.report;
  // Stale: answer instantly from the snapshot, refresh behind the request.
  void refresh(boxRoot, options).catch((e: unknown) => {
    console.error(`[health] background snapshot refresh failed for ${boxRoot}: ${errorMessage(e)}`);
  });
  return entry.report;
}
