/**
 * cb wakeup - Sync data with connectors.
 *
 * Full wakeup flow:
 * 1. Run preprocessors on inbox items (transcription, etc.)
 * 2. Triage feedback (lightweight agent classifies and integrates feedback cards)
 * 3. Run housekeeping (expire old briefs)
 * 4. Run on-wakeup scheduled scripts
 * 5. Run connectors (pull external data, create jobs) — fallback for uncovered connectors
 * 6. Create intake jobs for unjobbed inbox items (UI memos, etc.)
 * 7. Create guide-revision jobs if needed (archived briefs with unprocessed feedback)
 * 8. Process pending jobs via reactor (one cycle, skip low-priority)
 * 9. Push committed changes to the box's git remote (non-fatal if it fails)
 *
 * Under `--connector X`, the wakeup is scoped: step 5 runs only that
 * connector, step 6 scans only its `inboxPaths` and tags new intake
 * jobs `source="X"`, and step 8 passes `sourceFilter: "X"` to the
 * reactor so it processes just the jobs that this run produced.
 * Cross-cutting jobs (guide-revision, etc.) are left for a later
 * unscoped wakeup that matches them.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { createGmailConnector } from "../../connectors/gmail.js";
import { createGoogleCalendarConnector } from "../../connectors/google-calendar.js";
import { createTelegramConnector } from "../../connectors/telegram.js";
import { createGoogleDriveConnector } from "../../connectors/google-drive.js";
import { getAllConnectors, type Connector } from "../../connectors/index.js";
import { runPreActions } from "../../core/preactions/index.js";
import { createLoader } from "../lib/loader.js";
import { getSystemState } from "../../core/state.js";
import { stageAll, stageFiles, commit, getStatus, pushToRemote } from "../lib/git.js";
import { cleanupOldTmpUploads } from "../../core/housekeeping.js";
import { installRootLandmark } from "../../core/box.js";
import { getBoxTime } from "../lib/time.js";
import { createNewIntakeJob } from "../../connectors/intake-utils.js";
import { runOnWakeupScripts } from "./tick-utils.js";
import { runReactor } from "../../core/reactor/index.js";

export const wakeupCommand = new Command("wakeup")
  .description("Sync data with connectors")
  .option("-c, --connector <name>", "Only run specific connector")
  .option("--skip-preprocess", "Skip preprocessing step")
  .option("--skip-triage", "Skip feedback triage step")
  .option("--skip-housekeeping", "Skip housekeeping step")
  .option("--skip-push", "Skip pushing to git remote at the end of the cycle")
  .action(async (options: { connector?: string; skipPreprocess?: boolean; skipTriage?: boolean; skipHousekeeping?: boolean; skipPush?: boolean }) => {
    const boxRoot = await requireBoxRoot();

    // Health check: warn about uncommitted changes
    const status = await getStatus(boxRoot);
    if (!status.clean) {
      const counts = [];
      if (status.staged.length > 0) counts.push(`${status.staged.length} staged`);
      if (status.modified.length > 0) counts.push(`${status.modified.length} modified`);
      if (status.untracked.length > 0) counts.push(`${status.untracked.length} untracked`);
      console.log(`⚠ Uncommitted changes detected: ${counts.join(", ")}`);
      console.log("");
    }

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
      console.log("[Housekeeping]");
      const swept = await cleanupOldTmpUploads(boxRoot, (msg) => console.log(msg));
      const rootLandmarkRefilled = await installRootLandmark(boxRoot);
      if (rootLandmarkRefilled) {
        console.log("  Refilled Box.landmark.card (root landmark was missing)");
      }
      if (swept === 0 && !rootLandmarkRefilled) {
        console.log("  Nothing to clean up");
      }
      console.log("");
    }

    // Step 4: On-wakeup scheduled scripts
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

    // Step 5: Connectors
    console.log("[Running connectors]");

    // Initialize connectors
    createGmailConnector(boxRoot);
    createGoogleCalendarConnector(boxRoot);
    createTelegramConnector(boxRoot);
    createGoogleDriveConnector(boxRoot);

    const connectors = getAllConnectors();

    // Resolve the active connector (set when --connector is passed). We
    // hold onto it so step 5b can scope its inbox scan and step 7 can
    // pass `sourceFilter` to the reactor.
    let activeConnector: Connector | undefined;

    if (connectors.length === 0) {
      console.log("  No connectors configured.");
    } else {
      // Filter by name if specified
      const toRun = options.connector
        ? connectors.filter((c) => c.name === options.connector)
        : connectors;

      if (toRun.length === 0) {
        console.error(`Connector not found: ${options.connector}`);
        process.exit(1);
      }

      if (options.connector) {
        activeConnector = toRun[0];
      }

      let totalCreated = 0;
      let totalPushed = 0;
      let totalJobs = 0;
      let totalErrors = 0;

      for (const connector of toRun) {
        connector.triggeredBy = "cb wakeup";
        console.log(`Syncing ${connector.name}...`);

        try {
          const result = await connector.sync();

          if (result.pushed && result.pushed.length > 0) {
            console.log(`  Pushed ${result.pushed.length} card(s):`);
            for (const card of result.pushed) {
              console.log(`    - ${card}`);
            }
            totalPushed += result.pushed.length;
          }

          if (result.created.length > 0) {
            console.log(`  Created ${result.created.length} card(s):`);
            for (const card of result.created) {
              console.log(`    - ${card}`);
            }
            totalCreated += result.created.length;
          }

          if (result.jobs && result.jobs.length > 0) {
            console.log(`  Jobs created: ${result.jobs.length}`);
            for (const job of result.jobs) {
              console.log(`    - ${job}`);
            }
            totalJobs += result.jobs.length;
          }

          if (result.updated.length > 0) {
            console.log(`  Updated ${result.updated.length} card(s)`);
          }

          if (result.error) {
            console.error(`  Error: ${result.error}`);
            totalErrors++;
          } else if (
            result.created.length === 0 &&
            result.updated.length === 0 &&
            (!result.pushed || result.pushed.length === 0)
          ) {
            console.log("  No new items.");
          }
        } catch (err) {
          console.error(`  Failed: ${(err as Error).message}`);
          totalErrors++;
        }
      }

      const parts: string[] = [];
      if (totalPushed > 0) parts.push(`${totalPushed} pushed`);
      parts.push(`${totalCreated} created`);
      if (totalJobs > 0) parts.push(`${totalJobs} jobs`);
      parts.push(`${totalErrors} errors`);
      console.log(`\nTotal: ${parts.join(", ")}.`);
    }
    console.log("");

    // Step 5a: Clean up stale jobs with all dead references
    console.log("[Checking for stale jobs]");
    const staleCount = await cleanupStaleJobs(boxRoot);
    if (staleCount > 0) {
      console.log(`  Cleaned up ${staleCount} stale job(s)`);
    } else {
      console.log("  No stale jobs");
    }
    console.log("");

    // Step 5b: Create intake jobs for unjobbed inbox items
    console.log("[Checking for unjobbed inbox items]");
    const intakeJobs = await createIntakeJobsForUnjobbed(
      boxRoot,
      activeConnector ? { connector: activeConnector } : {},
    );
    if (intakeJobs > 0) {
      console.log(`  Created intake jobs for ${intakeJobs} item(s)`);
    } else {
      console.log("  No unjobbed items");
    }
    console.log("");

    // Step 6: Process pending jobs. Under --connector X, the source
    // filter restricts processing to jobs tagged source="X" so a
    // gmail-scoped tick doesn't drain RSS or feedback work.
    console.log("[Processing pending jobs]");
    const reactorOptions: Parameters<typeof runReactor>[0] = {
      boxRoot,
      maxCycles: 1,
      skipLowPriority: true,
      onLog: (text) => process.stdout.write(text),
    };
    if (activeConnector) reactorOptions.sourceFilter = activeConnector.name;
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

    // Step 8: Push committed changes to the box's git remote.
    // Non-fatal: push errors (network, auth, upstream race) are logged
    // but don't fail the wakeup.
    if (!options.skipPush) {
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
  });

/**
 * Run preprocessors on all inbox items (transcription, etc.).
 * Returns the number of items that were preprocessed.
 */
async function runPreprocessors(boxRoot: string): Promise<number> {
  const state = await getSystemState(boxRoot);
  if (state.inbox.length === 0) return 0;

  const loader = await createLoader(boxRoot);
  const actionNotes: string[] = [];

  for (const item of state.inbox) {
    try {
      const results = await runPreActions({
        boxRoot,
        loader,
        cardPath: item.path,
      });

      for (const r of results) {
        if (r.result.modified && r.result.message) {
          actionNotes.push(`${item.name}: ${r.result.message}`);
        } else if (r.result.error) {
          actionNotes.push(`${item.name}: ${r.name} failed`);
        }
      }
    } catch (error) {
      console.error(`  Error processing ${item.relativePath}: ${(error as Error).message}`);
    }
  }

  if (actionNotes.length === 0) return 0;

  // Commit pre-action changes
  const status = await getStatus(boxRoot);
  if (!status.clean) {
    await stageAll(boxRoot);
    const lines = [
      `Pre-actions: ${actionNotes.length} item${actionNotes.length === 1 ? "" : "s"}`,
      "",
    ];
    for (const note of actionNotes.slice(0, 5)) {
      lines.push(`- ${note}`);
    }
    if (actionNotes.length > 5) {
      lines.push(`  + ${actionNotes.length - 5} more`);
    }
    await commit(boxRoot, {
      message: lines.join("\n"),
      trailers: {
        "Triggered-By": "cb wakeup",
        Phase: "pre-actions",
      },
    });
  }

  return actionNotes.length;
}

/**
 * Clean up stale job cards whose referenced files no longer exist.
 * This catches jobs that were never finished — the agent ran out of turns,
 * or the items were processed through another path. The job is deleted and
 * committed with an error-indicating message so it can be investigated later.
 */
export async function cleanupStaleJobs(boxRoot: string): Promise<number> {
  const jobsDir = path.join(boxRoot, "box/jobs");
  let jobFiles: string[];
  try {
    jobFiles = await fs.readdir(jobsDir);
  } catch {
    return 0;
  }

  const staleJobs: Array<{ relPath: string; totalRefs: number }> = [];

  for (const file of jobFiles) {
    if (!file.endsWith(".job.card")) continue;
    const filePath = path.join(jobsDir, file);
    const relPath = path.relative(boxRoot, filePath);

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    // Only clean up pending jobs
    if (!content.includes("status=\"pending\"")) continue;

    // Extract all ref="..." from the job
    const refs: string[] = [];
    for (const match of content.matchAll(/ref="([^"]+)"/g)) {
      const ref = match[1]!;
      // Skip URL refs (not file paths)
      if (ref.startsWith("http://") || ref.startsWith("https://")) continue;
      refs.push(ref);
    }

    if (refs.length === 0) continue;

    // Check if ALL referenced files are gone
    let allMissing = true;
    for (const ref of refs) {
      try {
        await fs.access(path.join(boxRoot, ref));
        allMissing = false;
        break;
      } catch {
        // File doesn't exist
      }
    }

    if (allMissing) {
      staleJobs.push({ relPath, totalRefs: refs.length });
    }
  }

  if (staleJobs.length === 0) return 0;

  // Delete stale jobs and commit
  const deletedPaths: string[] = [];
  for (const job of staleJobs) {
    const fullPath = path.join(boxRoot, job.relPath);
    await fs.unlink(fullPath);
    deletedPaths.push(job.relPath);
  }

  await stageFiles(boxRoot, deletedPaths);
  const summary = staleJobs
    .map((j) => `  ${j.relPath} (${j.totalRefs} dead refs)`)
    .join("\n");
  await commit(boxRoot, {
    message: `Clean up ${staleJobs.length} stale job(s) with all dead references\n\nThese jobs were never completed by the agent — all referenced\nfiles have been processed or removed through other paths.\n\n${summary}`,
    trailers: {
      "Triggered-By": "cb wakeup",
      Phase: "stale-job-cleanup",
    },
  });

  return staleJobs.length;
}

/**
 * Scan inbox for items not referenced by any pending job and create
 * intake jobs for them. Returns the number of items covered.
 *
 * Under a full wakeup, scans all of `box/inbox/` (skipping subdirs that
 * have their own pipelines) and tags intake jobs with `source="wakeup"`
 * / `source="wakeup-captures"`. Under a connector-scoped wakeup, scans
 * only `connector.inboxPaths` and tags jobs with the connector's name
 * as `source`, so the reactor's source filter routes them back to the
 * same partial run.
 */
export async function createIntakeJobsForUnjobbed(
  boxRoot: string,
  options: { connector?: Connector } = {}
): Promise<number> {
  const { connector } = options;

  // Subdirectories with their own pipelines — skip these on a full scan.
  const EXCLUDED_SUBDIRS = ["news", "feedback", "editions"];

  // Collect all refs from existing pending job cards
  const jobsDir = path.join(boxRoot, "box/jobs");
  const existingRefs = new Set<string>();
  try {
    const jobFiles = await fs.readdir(jobsDir);
    for (const file of jobFiles) {
      if (!file.endsWith(".job.card")) continue;
      const content = await fs.readFile(path.join(jobsDir, file), "utf-8");
      // Extract all ref="..." attributes from job cards
      for (const match of content.matchAll(/ref="([^"]+)"/g)) {
        existingRefs.add(match[1]!);
      }
    }
  } catch {
    // No jobs dir yet
  }

  // Scan inbox for card files
  const inboxDir = path.join(boxRoot, "box/inbox");
  const unjobbedItems: string[] = [];

  async function scanDir(dir: string, atInboxRoot: boolean): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const relPath = path.relative(boxRoot, fullPath);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        // Skip excluded subdirectories at the inbox root level (full scan only)
        if (atInboxRoot && EXCLUDED_SUBDIRS.includes(entry)) continue;
        await scanDir(fullPath, false);
      } else if (entry.endsWith(".card") && !existingRefs.has(relPath)) {
        unjobbedItems.push(relPath);
      }
    }
  }

  if (connector) {
    // Scoped scan: only the connector's declared inbox paths.
    for (const rel of connector.inboxPaths) {
      await scanDir(path.join(boxRoot, rel), false);
    }
  } else {
    await scanDir(inboxDir, true);
  }
  if (unjobbedItems.length === 0) return 0;

  // Group by type for priority assignment
  const lowPriority = unjobbedItems.filter(
    (p) => p.includes(".capture-session.card") || p.includes(".image.card") || p.includes(".audio.card")
  );
  const normalPriority = unjobbedItems.filter(
    (p) => !lowPriority.includes(p)
  );

  // Source naming: scoped wakeups use the connector name (so the reactor's
  // source filter picks them up in the same run); full wakeups keep the
  // historical "wakeup" / "wakeup-captures" pair.
  const normalSource = connector ? connector.name : "wakeup";
  const lowSource = connector ? connector.name : "wakeup-captures";

  const INTAKE_BATCH_SIZE = 10;
  const jobPaths: string[] = [];

  // Create batched jobs — each batch gets its own job file so the
  // agent can finish each one within its turn limit.
  async function createBatchedJobs(items: string[], opts: {
    source: string;
    priority: "normal" | "low";
    label: string;
  }): Promise<void> {
    for (let i = 0; i < items.length; i += INTAKE_BATCH_SIZE) {
      const batch = items.slice(i, i + INTAKE_BATCH_SIZE);
      const jobPath = await createNewIntakeJob({
        boxRoot,
        source: opts.source,
        items: batch,
        priority: opts.priority,
        description: `Triage ${batch.length} ${opts.label}${batch.length === 1 ? "" : "s"}`,
      });
      jobPaths.push(jobPath);
    }
  }

  if (normalPriority.length > 0) {
    await createBatchedJobs(normalPriority, {
      source: normalSource,
      priority: "normal",
      label: "inbox item",
    });
  }

  if (lowPriority.length > 0) {
    await createBatchedJobs(lowPriority, {
      source: lowSource,
      priority: "low",
      label: "capture item",
    });
  }

  if (jobPaths.length > 0) {
    await stageFiles(boxRoot, jobPaths);
    await commit(boxRoot, {
      message: `Create intake jobs for ${unjobbedItems.length} unjobbed inbox item(s)`,
      trailers: {
        "Triggered-By": "cb wakeup",
        Phase: "intake-jobs",
      },
    });
  }

  return unjobbedItems.length;
}
