/**
 * `bbx wakeup` step 2: housekeeping.
 *
 * Sweeps stale tmp uploads and abandoned captures, refills and commits the root
 * landmark, and runs the todo-review sweep (which may queue a job the same
 * cycle's reactor step picks up). Lifted out of `wakeup.ts` so the orchestrator
 * reads as the six steps it is.
 */

import { cleanupOldTmpUploads } from "../../core/housekeeping.js";
import { sweepAbandonedCaptures } from "../../core/capture/sweep.js";
import { installRootLandmark } from "../../core/box/index.js";
import { runTodoReviewSweep } from "../../core/todo/review-sweep.js";
import { stageFiles, commitPaths } from "../../lib/git.js";

export async function runHousekeeping(boxRoot: string): Promise<void> {
  console.log("[Housekeeping]");
  const swept = await cleanupOldTmpUploads(boxRoot, (msg) => console.log(msg));

  // Abandonment sweep (Track 5): finalize/discard staged captures the browser
  // never finished. Seal-only here — with no live chat runtime, sealed-partial
  // sessions wait for the next server startup's resume scan to prepare + deliver
  // them (CAS makes the double-fire safe). Empty and stale entries are handled
  // in full.
  const captureSweep = await sweepAbandonedCaptures({ boxRoot });
  if (captureSweep.sealed.length > 0) {
    console.log(`  Sealed ${captureSweep.sealed.length} abandoned capture(s) as partial (delivered on next server start)`);
  }
  if (captureSweep.discarded.length > 0) {
    console.log(`  Discarded ${captureSweep.discarded.length} empty abandoned capture session(s)`);
  }
  const rootLandmarkPath = await installRootLandmark(boxRoot);
  if (rootLandmarkPath !== null) {
    // Persist the refill so it survives, propagates to clones, and doesn't
    // linger as an uncommitted change (the missing-on-server boxes came from
    // exactly this gap — a refilled but never-committed working file).
    try {
      await stageFiles(boxRoot, [rootLandmarkPath]);
      await commitPaths(boxRoot, {
        paths: [rootLandmarkPath],
        message: "Refill root landmark (was missing or inert)",
        trailers: { "Created-By": "housekeeping" },
      });
      console.log(`  Refilled + committed ${rootLandmarkPath} (root landmark was missing or inert)`);
    } catch (e) {
      // Best-effort: a commit failure shouldn't abort the wakeup. The file is
      // on disk; the next wakeup retries the commit.
      console.warn(`  Refilled ${rootLandmarkPath} but could not commit it:`, e);
    }
  }
  if (swept === 0 && rootLandmarkPath === null) {
    console.log("  Nothing to clean up");
  }

  // Todo-review sweep (docs/implemented-plans/todo-annotation.md Track 5b): computes
  // escalated/stirring/stale sets and, when nonempty, queues a job the
  // reactor cycle below (step 5) picks up this same run — mirrors the
  // contains-backfill job's "housekeeping step queues a job" pattern.
  try {
    const sweep = await runTodoReviewSweep(boxRoot);
    if (sweep.jobPath !== null) {
      console.log(
        `  Todo review: queued ${sweep.jobPath} (${sweep.escalated.length} escalated, ${sweep.stirring.length} stirring, ${sweep.stale.length} stale)`,
      );
    }
  } catch (e) {
    console.error("  Todo review sweep failed:", e);
  }

  console.log("");
}
