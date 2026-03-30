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
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { createRssConnector } from "../../connectors/rss.js";
import { createGmailConnector } from "../../connectors/gmail.js";
import { createGoogleCalendarConnector } from "../../connectors/google-calendar.js";
import { createTelegramConnector } from "../../connectors/telegram.js";
import { createGoogleDriveConnector } from "../../connectors/google-drive.js";
import { getAllConnectors } from "../../connectors/index.js";
import { runPreActions } from "../../core/preactions/index.js";
import { createLoader } from "../lib/loader.js";
import { getSystemState } from "../../core/state.js";
import { stageAll, stageFiles, commit, getStatus } from "../lib/git.js";
import { expireOldBriefs } from "../../core/housekeeping.js";
import { getTranscribedFeedbackCards, buildFeedbackTriagePrompt } from "../../core/commands/triage-feedback.js";
import { getUnprocessedBriefs } from "../../core/commands/process-feedback.js";
import { createAgent, ensureAgentCommitted, captureBaseline } from "../../core/agent.js";
import { createGuideRevisionJobTemplate } from "../../schemas/guide-revision-job.js";
import { getBoxTime, getBoxTimeISO } from "../lib/time.js";
import { createNewIntakeJob } from "../../connectors/intake-utils.js";
import { runOnWakeupScripts } from "./tick-utils.js";
import { runReactor } from "../../core/reactor/index.js";

export const wakeupCommand = new Command("wakeup")
  .description("Sync data with connectors")
  .option("-c, --connector <name>", "Only run specific connector")
  .option("--skip-preprocess", "Skip preprocessing step")
  .option("--skip-triage", "Skip feedback triage step")
  .option("--skip-housekeeping", "Skip housekeeping step")
  .action(async (options: { connector?: string; skipPreprocess?: boolean; skipTriage?: boolean; skipHousekeeping?: boolean }) => {
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

    // Step 2: Triage feedback
    if (!options.skipTriage) {
      console.log("[Triaging feedback]");
      const triaged = await runTriageFeedback(boxRoot);
      if (triaged > 0) {
        console.log(`  Triaged ${triaged} feedback card(s)`);
      } else {
        console.log("  No feedback to triage");
      }
      console.log("");
    }

    // Step 3: Housekeeping
    if (!options.skipHousekeeping) {
      console.log("[Housekeeping]");
      const expired = await expireOldBriefs(boxRoot, (msg) => console.log(msg));
      if (expired === 0) {
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
    createRssConnector(boxRoot);
    createGmailConnector(boxRoot);
    createGoogleCalendarConnector(boxRoot);
    createTelegramConnector(boxRoot);
    createGoogleDriveConnector(boxRoot);

    const connectors = getAllConnectors();

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
    const intakeJobs = await createIntakeJobsForUnjobbed(boxRoot);
    if (intakeJobs > 0) {
      console.log(`  Created intake jobs for ${intakeJobs} item(s)`);
    } else {
      console.log("  No unjobbed items");
    }
    console.log("");

    // Step 6: Create guide-revision jobs if needed
    console.log("[Checking for guide revision]");
    const jobPath = await createGuideRevisionJobIfNeeded(boxRoot);
    if (jobPath) {
      console.log(`  Created guide-revision job: ${jobPath}`);
    } else {
      console.log("  No guide revision needed");
    }
    console.log("");

    // Step 7: Process pending jobs
    if (!options.connector) {
      console.log("[Processing pending jobs]");
      const result = await runReactor({
        boxRoot,
        maxCycles: 1,
        skipLowPriority: true,
        onLog: (text) => process.stdout.write(text),
      });
      if (result.jobsProcessed > 0) {
        console.log(`  Processed ${result.jobsProcessed} job(s)`);
      } else {
        console.log("  No jobs to process");
      }
      if (result.jobsRemaining > 0) {
        console.log(`  ${result.jobsRemaining} job(s) still remaining`);
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
      const card = await loader.load(item.path);
      const results = await runPreActions({
        boxRoot,
        loader,
        card,
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
 * Triage feedback cards using a lightweight agent.
 * Classifies feedback and integrates it into target briefs.
 * Returns the number of feedback cards triaged.
 */
async function runTriageFeedback(boxRoot: string): Promise<number> {
  const feedbackCards = await getTranscribedFeedbackCards(boxRoot);
  if (feedbackCards.length === 0) return 0;

  const paths = feedbackCards.join("\n  - ");
  console.log(`  Found ${feedbackCards.length} feedback card(s) to triage`);

  const agent = createAgent({
    name: "triage",
    onOutput: (text) => process.stdout.write(text),
  });

  const baseline = await captureBaseline(boxRoot);
  const result = await agent.invoke({
    boxRoot,
    systemPrompt: buildFeedbackTriagePrompt(boxRoot),
    prompt: `Please triage and integrate these feedback cards:\n  - ${paths}`,
    model: "claude-haiku-4-5-20251001",
    maxTurns: 10,
  });

  if (result.success) {
    await ensureAgentCommitted({
      boxRoot,
      agent,
      baseline,
      fallbackMessage: `Triage ${feedbackCards.length} feedback card(s)`,
      fallbackTrailers: { "Triggered-By": "cb wakeup", Phase: "triage-feedback" },
      onOutput: (text) => process.stdout.write(text),
    });
  } else {
    console.error(`  Triage agent error: ${result.error}`);
  }

  return feedbackCards.length;
}

/**
 * Check for archived briefs with unprocessed feedback and create a
 * guide-revision job if any are found.
 * Returns the job file path, or null if no job was needed.
 */
export async function createGuideRevisionJobIfNeeded(boxRoot: string): Promise<string | null> {
  const unprocessed = await getUnprocessedBriefs(boxRoot);
  if (unprocessed.length === 0) return null;

  // Only include briefs that have actual feedback (overall-rating means user read it)
  const withFeedback: string[] = [];
  for (const briefPath of unprocessed) {
    const fullPath = path.join(boxRoot, briefPath);
    const content = await fs.readFile(fullPath, "utf-8");
    if (content.includes("overall-rating=")) {
      withFeedback.push(briefPath);
    }
  }

  if (withFeedback.length === 0) return null;

  // Check if a guide-revision job already exists
  const jobsDir = path.join(boxRoot, "box/jobs");
  await fs.mkdir(jobsDir, { recursive: true });
  const existingJobs = await fs.readdir(jobsDir);
  if (existingJobs.some((f) => f.endsWith(".guide-revision.job.card"))) {
    console.log("  Guide-revision job already exists, skipping");
    return null;
  }

  // Find the news guide (new format first, then legacy)
  let guidePath: string | undefined;
  try {
    await fs.access(path.join(boxRoot, "config/news.guide.card"));
    guidePath = "config/news.guide.card";
  } catch {
    try {
      await fs.access(path.join(boxRoot, "config/news-guide.news-guide.card"));
      guidePath = "config/news-guide.news-guide.card";
    } catch {
      // No guide found — still create the job, agent can handle it
    }
  }

  const now = getBoxTimeISO(boxRoot);
  const jobContent = createGuideRevisionJobTemplate({
    created: now,
    source: "feedback-sync",
    description: `${withFeedback.length} brief(s) with unprocessed feedback`,
    briefs: withFeedback,
    ...(guidePath && { guide: guidePath }),
  });

  const datePrefix = now.slice(0, 10);
  const jobFileName = `${datePrefix}_feedback.guide-revision.job.card`;
  const jobPath = path.join("box/jobs", jobFileName);
  const fullJobPath = path.join(boxRoot, jobPath);

  await fs.writeFile(fullJobPath, jobContent, "utf-8");

  // Stage and commit
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `Guide revision job: ${withFeedback.length} brief(s) with feedback`,
    trailers: {
      "Triggered-By": "cb wakeup",
      Phase: "guide-revision-check",
    },
  });

  return jobPath;
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
 */
export async function createIntakeJobsForUnjobbed(boxRoot: string): Promise<number> {
  // Subdirectories with their own pipelines — skip these
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

  async function scanDir(dir: string): Promise<void> {
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
        // Skip excluded subdirectories at the inbox root level
        const relToInbox = path.relative(inboxDir, fullPath);
        if (!relToInbox.includes(path.sep) && EXCLUDED_SUBDIRS.includes(relToInbox)) {
          continue;
        }
        await scanDir(fullPath);
      } else if (entry.endsWith(".card") && !existingRefs.has(relPath)) {
        unjobbedItems.push(relPath);
      }
    }
  }

  await scanDir(inboxDir);
  if (unjobbedItems.length === 0) return 0;

  // Group by type for priority assignment
  const lowPriority = unjobbedItems.filter(
    (p) => p.includes(".capture-session.card") || p.includes(".image.card") || p.includes(".audio.card")
  );
  const normalPriority = unjobbedItems.filter(
    (p) => !lowPriority.includes(p)
  );

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
      source: "wakeup",
      priority: "normal",
      label: "inbox item",
    });
  }

  if (lowPriority.length > 0) {
    await createBatchedJobs(lowPriority, {
      source: "wakeup-captures",
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
