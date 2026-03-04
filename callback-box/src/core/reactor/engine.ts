/**
 * Reactor engine — the main sync → process → finalize loop.
 *
 * See DESIGN.md for the full flow and rationale. In brief:
 *
 * 1. Acquire lock (prevent concurrent reactors)
 * 2. Optionally reset chat sessions
 * 3. Loop up to maxCycles times:
 *    a. Sync (cb wakeup) — pulls from external sources, creates jobs
 *    b. generateDocs — refresh agent docs (fast mtime-cached no-op)
 *    c. Find job cards in box/jobs/
 *    d. Partition: procedure jobs vs agent jobs
 *    e. Run procedure jobs via trampoline (no agent needed)
 *    f. Run agent jobs via batch or chat processing
 *    g. Stop if no jobs remain or none were processed (stuck)
 * 4. Finalize (cb finalize) — flush outbound cards
 * 5. Optionally poll (sleep + recurse)
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createAgent as realCreateAgent } from "../agent.js";
import { generateDocs } from "../generate-docs.js";
import { fmt } from "../../cli/lib/format.js";
import {
  loadChatSessions,
  saveChatSessions,
  resetAllSessions,
} from "../chat-reactor-sessions.js";
import { findJobCards } from "./job-discovery.js";
import { detectProcedureInJob, processProcedureJobs } from "./procedure-trampoline.js";
import { processBatchJobs } from "./batch-jobs.js";
import { processChatJobs } from "./chat-jobs.js";
import { runSync, runFinalize } from "./subprocess.js";
import type { JobWithContent, ProcessJobsOptions } from "./types.js";

export interface ReactorOptions {
  boxRoot: string;
  dryRun?: boolean | undefined;
  /** Run sync before processing jobs */
  sync?: boolean | undefined;
  /** Maximum sync→process cycles (default 3) */
  maxCycles?: number | undefined;
  /** Poll interval in seconds (0 = one-shot, default) */
  pollInterval?: number | undefined;
  /** Skip agent invocation if only low-priority jobs remain */
  skipLowPriority?: boolean | undefined;
  /** Only process jobs of this type (e.g. "chat" matches *.chat.job.card) */
  type?: string | undefined;
  /** Reset all persisted chat sessions before processing */
  resetSessions?: boolean | undefined;
  onLog?: ((text: string) => void) | undefined;
  /** Agent factory — override for testing. Defaults to the real createAgent(). */
  createAgent?: typeof realCreateAgent | undefined;
}

export interface ReactorResult {
  success: boolean;
  jobsProcessed: number;
  jobsRemaining: number;
  error?: string;
}

/**
 * Run the reactor loop.
 *
 * If sync is enabled, runs: sync → process jobs → repeat until no new jobs.
 * Otherwise, processes existing jobs one-shot.
 */
export async function runReactor(options: ReactorOptions): Promise<ReactorResult> {
  const {
    boxRoot,
    dryRun = false,
    sync = false,
    maxCycles = 3,
    pollInterval = 0,
    skipLowPriority = false,
    type: typeFilter,
    resetSessions: shouldResetSessions = false,
    onLog,
    createAgent: agentFactory = realCreateAgent,
  } = options;

  // Acquire lock — prevent concurrent reactor runs
  const lockFile = path.join(boxRoot, ".cb-reactor.lock");
  const lockAcquired = await acquireReactorLock(lockFile);
  if (!lockAcquired) {
    onLog?.(fmt.dim("Another reactor is already running, skipping.\n"));
    return { success: true, jobsProcessed: 0, jobsRemaining: 0 };
  }

  // Handle --reset-sessions
  if (shouldResetSessions) {
    const sessions = await loadChatSessions(boxRoot);
    resetAllSessions(sessions);
    await saveChatSessions(boxRoot, sessions);
    onLog?.(fmt.ok("Chat reactor sessions reset.\n"));
  }

  let totalProcessed = 0;
  let lastRemaining = 0;
  let success = true;

  const runOneCycle = async (): Promise<ReactorResult> => {
    // Run sync if enabled
    if (sync) {
      onLog?.(fmt.header("[Sync]\n"));
      const syncOk = await runSync(boxRoot, onLog);
      if (!syncOk) {
        onLog?.(fmt.warn("Sync failed, continuing with existing jobs...\n"));
      }
      onLog?.("\n");
    }

    // Refresh agent docs (fast no-op if inputs haven't changed)
    onLog?.(fmt.dim("Refreshing agent docs...\n"));
    await generateDocs(boxRoot);

    // Find all job cards
    const jobsDir = path.join(boxRoot, "box/jobs");
    await fs.mkdir(jobsDir, { recursive: true });

    const jobCards = await findJobCards(jobsDir, typeFilter);

    if (jobCards.length === 0) {
      onLog?.("No pending jobs.\n");
      return { success: true, jobsProcessed: 0, jobsRemaining: 0 };
    }

    const hasNormalPriority = jobCards.some((j) => j.priority === "normal");

    // Skip if only low-priority jobs and skipLowPriority is set
    if (skipLowPriority && !hasNormalPriority) {
      const count = jobCards.length;
      onLog?.(fmt.dim(`Only ${count} low-priority job(s), skipping.\n`));
      return { success: true, jobsProcessed: 0, jobsRemaining: count };
    }

    onLog?.(fmt.header(`Found ${jobCards.length} job(s):\n`));
    for (const card of jobCards) {
      const label = card.priority === "low" ? " (low priority)" : "";
      onLog?.(`  - box/jobs/${card.file}${label}\n`);
    }

    // Read each job card and detect procedure jobs
    const jobsWithContent: JobWithContent[] = [];
    for (const card of jobCards) {
      const jp = path.join("box/jobs", card.file);
      const absPath = path.join(boxRoot, jp);
      try {
        const content = await fs.readFile(absPath, "utf-8");
        const procedureInfo = await detectProcedureInJob(content, absPath);
        jobsWithContent.push({ card, relPath: jp, content, procedureInfo });
      } catch {
        jobsWithContent.push({ card, relPath: jp, content: "", procedureInfo: null });
      }
    }

    // Partition: procedure jobs vs agent jobs
    const procedureJobs = jobsWithContent.filter((j) => j.procedureInfo !== null);
    const agentJobs = jobsWithContent.filter((j) => j.procedureInfo === null);

    // Process procedure jobs first (trampoline)
    if (procedureJobs.length > 0) {
      await processProcedureJobs({ procedureJobs, boxRoot, dryRun, onLog });
    }

    if (dryRun && agentJobs.length === 0) {
      return { success: true, jobsProcessed: 0, jobsRemaining: jobCards.length };
    }

    // Process remaining agent jobs
    let cycleSuccess = true;
    if (agentJobs.length > 0) {
      const jobOpts: ProcessJobsOptions = { jobs: agentJobs, boxRoot, dryRun, typeFilter, onLog, createAgent: agentFactory };
      if (typeFilter === "chat") {
        // Chat jobs: process individually with per-thread session reuse
        cycleSuccess = await processChatJobs(jobOpts);
      } else {
        // Non-chat jobs: batch into a single agent session
        cycleSuccess = await processBatchJobs(jobOpts);
      }
    }

    // Count remaining jobs
    const remaining = await findJobCards(jobsDir, typeFilter);
    const processed = jobCards.length - remaining.length;

    onLog?.(fmt.dim(`\nCycle complete: ${processed} processed, ${remaining.length} remaining\n`));

    return {
      success: cycleSuccess,
      jobsProcessed: processed,
      jobsRemaining: remaining.length,
    };
  };

  // Main loop
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    if (cycle > 0) {
      onLog?.(fmt.header(`\n--- Cycle ${cycle + 1} ---\n\n`));
    }

    const result = await runOneCycle();
    totalProcessed += result.jobsProcessed;
    lastRemaining = result.jobsRemaining;

    if (!result.success) {
      success = false;
    }

    // Stop if no jobs remain or if we didn't process any (stuck)
    if (result.jobsRemaining === 0 || result.jobsProcessed === 0) {
      break;
    }
  }

  // Run finalize to flush outbound cards
  onLog?.(fmt.header("\n[Finalize]\n"));
  const finalizeOk = await runFinalize(boxRoot, onLog);
  if (!finalizeOk) {
    onLog?.(fmt.warn("Finalize failed.\n"));
  }
  onLog?.("\n");

  // Polling mode: wait and repeat
  if (pollInterval > 0 && success) {
    await releaseReactorLock(lockFile);
    onLog?.(fmt.dim(`\nPolling every ${pollInterval}s... (Ctrl+C to stop)\n`));
    await sleep(pollInterval * 1000);
    // Recurse for next poll iteration (re-acquires lock)
    const pollResult = await runReactor(options);
    return {
      success: pollResult.success,
      jobsProcessed: totalProcessed + pollResult.jobsProcessed,
      jobsRemaining: pollResult.jobsRemaining,
    };
  }

  await releaseReactorLock(lockFile);

  return {
    success,
    jobsProcessed: totalProcessed,
    jobsRemaining: lastRemaining,
  };
}

// ─── Reactor lock ─────────────────────────────────────────────────────

/**
 * Try to acquire a PID-based lock file. Returns true if acquired.
 * Stale locks (dead PIDs) are automatically cleaned up.
 */
async function acquireReactorLock(lockFile: string): Promise<boolean> {
  try {
    const content = await fs.readFile(lockFile, "utf-8");
    const pid = parseInt(content.trim(), 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0); // Check if process is alive
        return false; // Process is alive — lock is held
      } catch {
        // Process is dead — stale lock, clean up and proceed
      }
    }
  } catch {
    // No lock file — proceed
  }

  await fs.writeFile(lockFile, String(process.pid));
  return true;
}

async function releaseReactorLock(lockFile: string): Promise<void> {
  await fs.unlink(lockFile).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
