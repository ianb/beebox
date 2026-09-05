/**
 * Health checks for work that has stopped moving.
 *
 * Two conditions with the same shape: something entered the box, nothing
 * picked it up, and no other signal says so. Both are `warning` — a backlog
 * is a nudge, not a defect, and neither may fail a deploy or take a box
 * offline.
 */

import { findStaleTmpCaptureCards, TMP_CAPTURE_STALE_MS } from "../../../core/capture/sweep.js";
import { findJobCards } from "../../../core/reactor/job-discovery.js";
import { getBoxTime } from "../../../lib/time.js";
import { getBoxDir } from "../../../lib/paths.js";
import type { HealthCheck } from "./health.js";

/**
 * Captures still sitting unfiled in `tmp-capture/`.
 *
 * Staged captures are deliberately gitignored so a pre-triage photo is not
 * annexed before an agent files it — it still gets renamed, re-encoded, and
 * EXIF-rotated, and annexing on arrival would mint immutable objects for
 * superseded versions. The cost is that a staged capture is in neither git nor
 * the annex, which is the one window where box content has no second record at
 * all. Fine for hours, bad for weeks — so make a long window visible.
 *
 * `warning`, not `error`: a triage backlog is a nudge, not a defect, and this
 * must never fail a deploy or take a box offline. It is also deliberately NOT
 * a `bbx doctor annex` check — that one is configuration-only, and a condition
 * that varies with pending work has no configuration remedy.
 *
 * Reuses the abandonment sweep's existing traversal and threshold rather than
 * walking the tree again with a second notion of "unfiled".
 */
export async function unfiledCapturesCheck(boxRoot: string): Promise<HealthCheck> {
  const days = Math.round(TMP_CAPTURE_STALE_MS / (24 * 60 * 60 * 1000));
  const stale = await findStaleTmpCaptureCards({
    boxRoot,
    now: getBoxTime(boxRoot).getTime(),
  });
  return {
    name: "unfiled-captures",
    ok: stale.length === 0,
    message:
      stale.length === 0
        ? "no captures unfiled past the staging window"
        : `${String(stale.length)} capture(s) unfiled for over ${String(days)} days ` +
          `(e.g. ${stale[0] ?? ""}). Their bytes are in neither git nor the annex — file them with bbx mv.`,
    severity: "warning",
  };
}

/**
 * How long a job may be pending before it counts as stalled. Comfortably
 * above the reactor's 24h low-priority deadline, so ordinary deferred work
 * never trips it — only a job that isn't draining at all.
 */
const STALLED_JOB_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_JOBS_SHOWN = 3;

export async function stalledJobsCheck(boxRoot: string): Promise<HealthCheck> {
  const days = Math.round(STALLED_JOB_MS / (24 * 60 * 60 * 1000));
  const now = getBoxTime(boxRoot).getTime();
  const jobs = await findJobCards(getBoxDir(boxRoot, "jobs"));
  const stalled: Array<{ file: string; ageMs: number }> = [];
  for (const job of jobs) {
    // A card whose age can't be established (no filename stamp, unreadable
    // stat) is left out rather than assumed old — the same "age unknown reads
    // as young" rule the reactor's deadline uses.
    if (job.createdAt === null) continue;
    const ageMs = now - job.createdAt.getTime();
    if (ageMs >= STALLED_JOB_MS) stalled.push({ file: job.file, ageMs });
  }
  stalled.sort((a, b) => b.ageMs - a.ageMs);

  const shown = stalled
    .slice(0, MAX_JOBS_SHOWN)
    .map((j) => `${j.file} (${String(Math.floor(j.ageMs / (24 * 60 * 60 * 1000)))}d)`)
    .join(", ");
  const more = Math.max(0, stalled.length - MAX_JOBS_SHOWN);

  return {
    name: "stalled-jobs",
    ok: stalled.length === 0,
    message:
      stalled.length === 0
        ? "no job pending longer than the reactor should take"
        : `${String(stalled.length)} job(s) pending over ${String(days)} days: ${shown}`
          + `${more > 0 ? `, and ${String(more)} more` : ""}. `
          + "The reactor is not draining them — check bbx wakeup's log for why.",
    severity: "warning",
  };
}
