/**
 * `bbx wakeup` step 2: housekeeping.
 *
 * Sweeps stale tmp uploads and abandoned captures, and refills and commits the
 * root landmark. (The todo-review sweep that used to run here is the stock
 * `todo-review` procedure's precheck now, on its own schedule —
 * `docs/plans/todos-ui.md` Track 7.) Lifted out of `wakeup.ts` so the orchestrator
 * reads as the six steps it is.
 */

import { cleanupOldTmpUploads } from "../../core/housekeeping.js";
import { sweepAbandonedCaptures } from "../../core/capture/sweep.js";
import { installRootLandmark } from "../../core/box/index.js";
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

  console.log("");
}
