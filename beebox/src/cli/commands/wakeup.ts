/**
 * bbx wakeup - Sync data with connectors.
 *
 * Full wakeup flow:
 * 1. Run preprocessors on inbox items (transcription, etc.)
 * 2. Run housekeeping (sweep stale tmp uploads, refill root landmark,
 *    run the todo-review sweep)
 * 3. Run on-wakeup scheduled scripts
 * 4. Run connectors (pull external data, create jobs)
 *    4a. Clean up stale jobs whose refs all point at deleted files
 *    4b. Create intake jobs for unjobbed inbox items (UI memos, etc.)
 * 5. Process pending jobs via reactor (one cycle, skip low-priority)
 * 6. Push committed changes to the box's git remote (non-fatal if it fails)
 *
 * Under `--connector X`, the wakeup is scoped: step 4 runs only that
 * connector, step 4b scans only its `inboxPaths` and tags new intake
 * jobs `source="X"`, and step 5 passes `sourceFilter: "X"` to the
 * reactor so it processes just the jobs that this run produced.
 *
 * If `X` doesn't match any configured connector, steps 4b and 5 are
 * scoped to NOTHING (not to a full unscoped run) — 4b is skipped
 * outright, and step 5's `sourceFilter` is set to the unmatched name so
 * it matches zero jobs. Step 4a (stale-job cleanup) and step 6 (push)
 * still run, and the process exits nonzero.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { getStatus, pushToRemote, stageFiles, commitPaths } from "../../lib/git.js";
import { cleanupOldTmpUploads } from "../../core/housekeeping.js";
import { sweepAbandonedCaptures } from "../../core/capture/sweep.js";
import { installRootLandmark } from "../../core/box/index.js";
import { getBoxTime } from "../../lib/time.js";
import { runOnWakeupScripts } from "./tick-utils.js";
import { runTodoReviewSweep } from "../../core/todo/review-sweep.js";
import { reportWakeupOutcome } from "./wakeup-outcome.js";
import { runReactor } from "../../core/reactor/index.js";
import {
  runConnectors,
  wakeupExitCodeForConnectorErrors,
} from "./wakeup-connectors.js";
import {
  runPreprocessors,
  cleanupStaleJobs,
  createIntakeJobsForUnjobbed,
  createContainsBackfillJob,
  refreshSearchIndex,
} from "./wakeup-steps.js";

// Re-exported so existing importers keep their `wakeup.js` import paths.
export { cleanupStaleJobs, createIntakeJobsForUnjobbed };

interface WakeupOptions {
  connector?: string;
  skipPreprocess?: boolean;
  skipHousekeeping?: boolean;
  skipPush?: boolean;
}

async function reportUncommittedChanges(boxRoot: string): Promise<void> {
  const status = await getStatus(boxRoot);
  if (status.clean) return;
  const counts = [];
  if (status.staged.length > 0) counts.push(`${status.staged.length} staged`);
  if (status.modified.length > 0) counts.push(`${status.modified.length} modified`);
  if (status.untracked.length > 0) counts.push(`${status.untracked.length} untracked`);
  console.log(`⚠ Uncommitted changes detected: ${counts.join(", ")}`);
  console.log("");
}

async function runHousekeeping(boxRoot: string): Promise<void> {
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

async function processPendingJobs(
  boxRoot: string,
  activeConnectorName: string | undefined
): Promise<{ reactorOk: boolean; reactorSkipped: boolean; jobsProcessed: number; jobsRemaining: number }> {
  // Step 5: Process pending jobs. Under --connector X, the source
  // filter restricts processing to jobs tagged source="X" so a
  // gmail-scoped tick doesn't drain other connectors' work.
  console.log("[Processing pending jobs]");
  const reactorOptions: Parameters<typeof runReactor>[0] = {
    boxRoot,
    maxCycles: 1,
    skipLowPriority: true,
    onLog: (text) => process.stdout.write(text),
  };
  if (activeConnectorName) reactorOptions.sourceFilter = activeConnectorName;
  const result = await runReactor(reactorOptions);
  if (result.jobsProcessed > 0) {
    console.log(`  Processed ${result.jobsProcessed} job(s)`);
  } else {
    console.log("  No jobs to process");
  }
  if (result.jobsRemaining > 0) {
    console.log(`  ${result.jobsRemaining} job(s) still remaining`);
  }
  console.log("");
  return {
    reactorOk: result.success,
    reactorSkipped: result.skipped === "locked",
    jobsProcessed: result.jobsProcessed,
    jobsRemaining: result.jobsRemaining,
  };
}

async function pushChanges(boxRoot: string): Promise<void> {
  // Step 6: Push committed changes to the box's git remote.
  // Non-fatal: push errors (network, auth, upstream race) are logged
  // but don't fail the wakeup.
  console.log("[Pushing to remote]");
  const pushResult = await pushToRemote(boxRoot);
  if (pushResult.error) {
    console.log(`  ⚠ push failed: ${pushResult.error}`);
  } else if (pushResult.skipped) {
    console.log(`  ${pushResult.reason}`);
  } else {
    const plural = pushResult.commitsPushed === 1 ? "commit" : "commits";
    console.log(`  ✓ pushed ${pushResult.commitsPushed} ${plural}`);
  }
}

export const wakeupCommand = new Command("wakeup")
  .description("Sync data with connectors")
  .option("-c, --connector <name>", "Only run specific connector")
  .option("--skip-preprocess", "Skip preprocessing step")
  .option("--skip-housekeeping", "Skip housekeeping step")
  .option("--skip-push", "Skip pushing to git remote at the end of the cycle")
  .action(async (options: WakeupOptions) => {
    const boxRoot = await requireBoxRoot();

    // Health check: warn about uncommitted changes
    await reportUncommittedChanges(boxRoot);

    // Step 1: Preprocessors
    if (!options.skipPreprocess) {
      console.log("[Preprocessing inbox items]");
      const preprocessed = await runPreprocessors(boxRoot);
      if (preprocessed > 0) {
        console.log(`  Preprocessed ${preprocessed} item(s)`);
      } else {
        console.log("  No preprocessing needed");
      }
      console.log("");
    }

    // Step 2: Housekeeping
    if (!options.skipHousekeeping) {
      await runHousekeeping(boxRoot);
    }

    // Step 3: On-wakeup scheduled scripts
    if (!options.connector) {
      console.log("[Running on-wakeup scripts]");
      const now = getBoxTime(boxRoot);
      const scriptsRan = await runOnWakeupScripts(boxRoot, now);
      if (scriptsRan > 0) {
        console.log(`  Ran ${scriptsRan} script(s)`);
      } else {
        console.log("  No scripts due");
      }
      console.log("");
    }

    // Step 4: Connectors
    console.log("[Running connectors]");
    const { activeConnector, activeConnectorName, errorCount: connectorErrorCount } = await runConnectors(boxRoot, {
      connector: options.connector,
    });
    console.log("");

    // Step 4a: Clean up stale jobs with all dead references
    console.log("[Checking for stale jobs]");
    const staleCount = await cleanupStaleJobs(boxRoot);
    if (staleCount > 0) {
      console.log(`  Cleaned up ${staleCount} stale job(s)`);
    } else {
      console.log("  No stale jobs");
    }
    console.log("");

    // Step 4b: Create intake jobs for unjobbed inbox items.
    //
    // A named-but-unmatched `--connector` (activeConnector undefined while
    // activeConnectorName is set) must scope this step to NOTHING, not to a
    // full unscoped scan — `{}` below means "no connector filter", which
    // is exactly the opposite of what was requested. Skip the scan
    // entirely in that case; step 4a/6 still run.
    console.log("[Checking for unjobbed inbox items]");
    if (activeConnectorName && !activeConnector) {
      console.log(`  Skipped: connector "${activeConnectorName}" not found`);
    } else {
      const intakeJobs = await createIntakeJobsForUnjobbed(
        boxRoot,
        activeConnector ? { connector: activeConnector } : {},
      );
      if (intakeJobs > 0) {
        console.log(`  Created intake jobs for ${intakeJobs} item(s)`);
      } else {
        console.log("  No unjobbed items");
      }
    }
    console.log("");

    // Step 4c: Reconcile the search index with the card tree. Unconditional
    // and on its own footing — it is the box's only scheduled refresh, and
    // it also produces the `contains` state step 4d reads.
    console.log("[Refreshing search index]");
    const indexFresh = await refreshSearchIndex(boxRoot);
    console.log(indexFresh ? "  Index up to date" : "  Index not refreshed this cycle");
    console.log("");

    // Step 4d: Queue a contains-backfill batch when searchable cards lack
    // the field (one low-priority job per wakeup; drains gradually). Skipped
    // when the refresh above didn't reconcile — it threw, or lost the search
    // lock to another process: the `contains` state it reads would predate
    // the current tree, and a wrong batch is worse than a late one.
    if (indexFresh) {
      const backfill = await createContainsBackfillJob(boxRoot);
      if (backfill > 0) {
        console.log(`[Queued contains backfill job for ${backfill} card(s)]`);
        console.log("");
      }
    }

    // Step 5: Process pending jobs. Pass `activeConnectorName` (the raw
    // requested name), not `activeConnector?.name` — a named-but-unmatched
    // connector must scope the reactor's sourceFilter to that (unmatched)
    // name, not to "everything" (which is what `activeConnector` collapses
    // to when the name didn't match).
    const jobs = await processPendingJobs(boxRoot, activeConnectorName);

    // Step 6: Push committed changes to the box's git remote.
    if (!options.skipPush) {
      await pushChanges(boxRoot);
    }

    const connectorExitCode = wakeupExitCodeForConnectorErrors(connectorErrorCount);
    if (connectorExitCode !== undefined) process.exitCode = connectorExitCode;

    // Opt-in, so a human's `bbx wakeup` stays quiet: a supervising caller sets
    // the env var and reads this back, because the exit code alone cannot say
    // WHICH step failed. See `wakeup-outcome.ts`.
    reportWakeupOutcome({
      connectorErrors: connectorErrorCount,
      reactorOk: jobs.reactorOk,
      reactorSkipped: jobs.reactorSkipped,
      jobsProcessed: jobs.jobsProcessed,
      jobsRemaining: jobs.jobsRemaining,
    });
  });
