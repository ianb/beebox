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
import {
  acquireLock as acquireFileLock,
  releaseLock as releaseFileLock,
  LockHeldError,
} from "../../lib/file-lock.js";
import { createAgent as realCreateAgent } from "../agent.js";
import { generateDocs as realGenerateDocs } from "../generate-docs.js";
import { fmt } from "../../cli/lib/format.js";
import {
  loadChatSessions,
  saveChatSessions,
  resetAllSessions,
} from "../chat-reactor-sessions.js";
import { findJobCards } from "./job-discovery.js";
import { processBatchJobs } from "./batch-jobs.js";
import { processChatJobs } from "./chat-jobs.js";
import { runSync as realRunSync, runFinalize as realRunFinalize } from "./subprocess.js";
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
  /**
   * Only process jobs whose frontmatter `source:` matches this value. Used
   * by `cb wakeup --connector X` to drain just the jobs that the same
   * partial run produced. Cross-cutting jobs (different source) are
   * left for the next run that does match them.
   */
  sourceFilter?: string | undefined;
  /** Reset all persisted chat sessions before processing */
  resetSessions?: boolean | undefined;
  onLog?: ((text: string) => void) | undefined;
  /** Agent factory — override for testing. Defaults to the real createAgent(). */
  createAgent?: typeof realCreateAgent | undefined;
  /**
   * Sync subprocess (`cb wakeup`) — override for testing. Defaults to the
   * real spawn. Tests pass a no-op fake to avoid spawning the CLI.
   */
  runSync?: typeof realRunSync | undefined;
  /**
   * Finalize subprocess (`cb finalize`) — override for testing. Defaults to
   * the real spawn. Tests pass a no-op fake to avoid spawning the CLI.
   */
  runFinalize?: typeof realRunFinalize | undefined;
  /**
   * Agent-doc refresh — override for testing. Defaults to the real
   * generateDocs(), which is ~1s cold on a fresh box. Tests that don't
   * assert on generated docs pass a no-op fake.
   */
  generateDocs?: typeof realGenerateDocs | undefined;
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
    dryRun,
    sync,
    maxCycles,
    pollInterval,
    skipLowPriority,
    typeFilter,
    sourceFilter,
    shouldResetSessions,
    onLog,
    agentFactory,
    runSync,
    runFinalize,
    generateDocs,
  } = normalizeReactorOptions(options);

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

  const cycleParams: RunCycleParams = {
    boxRoot,
    dryRun,
    sync,
    skipLowPriority,
    typeFilter,
    sourceFilter,
    onLog,
    agentFactory,
    runSync,
    generateDocs,
  };

  // Main loop
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    if (cycle > 0) {
      onLog?.(fmt.header(`\n--- Cycle ${cycle + 1} ---\n\n`));
    }

    const result = await runOneCycle(cycleParams);
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

// ─── Options ──────────────────────────────────────────────────────────

interface NormalizedReactorOptions {
  boxRoot: string;
  dryRun: boolean;
  sync: boolean;
  maxCycles: number;
  pollInterval: number;
  skipLowPriority: boolean;
  typeFilter: string | undefined;
  sourceFilter: string | undefined;
  shouldResetSessions: boolean;
  onLog: ((text: string) => void) | undefined;
  agentFactory: typeof realCreateAgent;
  runSync: typeof realRunSync;
  runFinalize: typeof realRunFinalize;
  generateDocs: typeof realGenerateDocs;
}

/** Apply defaults to the public {@link ReactorOptions} for internal use. */
function normalizeReactorOptions(options: ReactorOptions): NormalizedReactorOptions {
  return {
    boxRoot: options.boxRoot,
    dryRun: options.dryRun ?? false,
    sync: options.sync ?? false,
    maxCycles: options.maxCycles ?? 3,
    pollInterval: options.pollInterval ?? 0,
    skipLowPriority: options.skipLowPriority ?? false,
    typeFilter: options.type,
    sourceFilter: options.sourceFilter,
    shouldResetSessions: options.resetSessions ?? false,
    onLog: options.onLog,
    agentFactory: options.createAgent ?? realCreateAgent,
    runSync: options.runSync ?? realRunSync,
    runFinalize: options.runFinalize ?? realRunFinalize,
    generateDocs: options.generateDocs ?? realGenerateDocs,
  };
}

// ─── Single cycle ─────────────────────────────────────────────────────

interface RunCycleParams {
  boxRoot: string;
  dryRun: boolean;
  sync: boolean;
  skipLowPriority: boolean;
  typeFilter: string | undefined;
  sourceFilter: string | undefined;
  onLog: ((text: string) => void) | undefined;
  agentFactory: typeof realCreateAgent;
  runSync: typeof realRunSync;
  generateDocs: typeof realGenerateDocs;
}

/** Run sync + agent-doc refresh, then discover and process one batch of jobs. */
async function runOneCycle(params: RunCycleParams): Promise<ReactorResult> {
  const { boxRoot, dryRun, sync, skipLowPriority, typeFilter, sourceFilter, onLog, runSync, generateDocs } = params;

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

  const jobCards = await findJobCards(jobsDir, { typeFilter, sourceFilter });

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

  // Read job cards; every job is handled by an agent.
  const agentJobs = await readJobsWithContent({ jobCards, boxRoot });

  if (dryRun && agentJobs.length === 0) {
    return { success: true, jobsProcessed: 0, jobsRemaining: jobCards.length };
  }

  // Process remaining agent jobs
  const cycleSuccess = await processAgentJobs({ agentJobs, params });

  // Count remaining jobs
  const remaining = await findJobCards(jobsDir, { typeFilter, sourceFilter });
  const processed = jobCards.length - remaining.length;

  onLog?.(fmt.dim(`\nCycle complete: ${processed} processed, ${remaining.length} remaining\n`));

  return {
    success: cycleSuccess,
    jobsProcessed: processed,
    jobsRemaining: remaining.length,
  };
}

/**
 * Read each job card's content. Unreadable cards are queued with empty content
 * so the batch path reports "(could not read)" rather than crashing the cycle.
 */
async function readJobsWithContent(opts: {
  jobCards: Awaited<ReturnType<typeof findJobCards>>;
  boxRoot: string;
}): Promise<JobWithContent[]> {
  const { jobCards, boxRoot } = opts;
  const jobsWithContent: JobWithContent[] = [];
  for (const card of jobCards) {
    const jp = path.join("box/jobs", card.file);
    const absPath = path.join(boxRoot, jp);
    try {
      const content = await fs.readFile(absPath, "utf-8");
      jobsWithContent.push({ card, relPath: jp, content });
    } catch (e) {
      console.warn(`Could not read job card ${jp}:`, e);
      jobsWithContent.push({ card, relPath: jp, content: "" });
    }
  }
  return jobsWithContent;
}

/**
 * Process the agent jobs for one cycle. Chat jobs run individually with
 * per-thread session reuse; everything else batches into a single session.
 * Returns true when there are no agent jobs to run.
 */
async function processAgentJobs(opts: {
  agentJobs: JobWithContent[];
  params: RunCycleParams;
}): Promise<boolean> {
  const { agentJobs, params } = opts;
  if (agentJobs.length === 0) return true;

  const { boxRoot, dryRun, typeFilter, onLog, agentFactory } = params;
  const jobOpts: ProcessJobsOptions = {
    jobs: agentJobs,
    boxRoot,
    dryRun,
    typeFilter,
    onLog,
    createAgent: agentFactory,
  };
  if (typeFilter === "chat") {
    return processChatJobs(jobOpts);
  }
  return processBatchJobs(jobOpts);
}

// ─── Reactor lock ─────────────────────────────────────────────────────

/**
 * Acquire the reactor lock. Returns true on success, false if a live
 * holder owns it. Dead holders are reclaimed automatically.
 */
class ReactorLockError extends Error {
  constructor(cause: unknown, lockPath: string) {
    super(`Failed to acquire reactor lock: ${lockPath}`);
    this.name = "ReactorLockError";
    this.cause = cause;
  }
}

async function acquireReactorLock(lockPath: string): Promise<boolean> {
  try {
    await acquireFileLock(lockPath, { kind: "reactor" });
    return true;
  } catch (err) {
    if (err instanceof LockHeldError) return false;
    throw new ReactorLockError(err, lockPath);
  }
}

async function releaseReactorLock(lockPath: string): Promise<void> {
  await releaseFileLock(lockPath);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
