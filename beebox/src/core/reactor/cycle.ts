/**
 * One reactor cycle, decomposed into named stages.
 *
 * `runOneCycle` runs sync → refresh docs → discover → process, each a small
 * stage with a typed result, so the loop in engine.ts reads as a pipeline
 * rather than one long function. The process stage returns an explicit
 * processed count (a set difference against the jobs it set out to run) that
 * doesn't miscount when jobs are added concurrently — see {@link processStage}.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fmt } from "../../lib/format.js";
import { getBoxTime } from "../../lib/time.js";
import type { createAgent as realCreateAgent } from "../agent/index.js";
import type { generateDocs as realGenerateDocs } from "../docs-gen/index.js";
import { findJobCards } from "./job-discovery.js";
import { processBatchJobs } from "./batch-jobs.js";
import { processChatJobs } from "./chat-jobs.js";
import type { runSync as realRunSync } from "./subprocess.js";
import type { JobWithContent, ProcessJobsOptions } from "./types.js";
import type { ReactorResult } from "./engine.js";

export interface RunCycleParams {
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

type JobCardInfo = Awaited<ReturnType<typeof findJobCards>>[number];

/**
 * Outcome of the discovery stage. A discriminated result so the cycle can
 * dispatch exhaustively instead of threading sentinel counts:
 * - `none` — no pending jobs at all.
 * - `skipped` — jobs exist but all low-priority, none past the wait deadline,
 *   and `skipLowPriority` is set; they stay pending (`remaining`).
 * - `ready` — jobs to process this cycle (not necessarily every pending job:
 *   a deadline-triggered cycle admits only a bounded batch of the overdue).
 */
type DiscoverResult =
  | { kind: "none" }
  | { kind: "skipped"; remaining: number }
  | { kind: "ready"; jobCards: JobCardInfo[] };

/** Result of the process stage: agent success plus an explicit processed count. */
interface ProcessOutcome {
  success: boolean;
  jobsProcessed: number;
  jobsRemaining: number;
}

/** Run sync + agent-doc refresh, then discover and process one batch of jobs. */
export async function runOneCycle(params: RunCycleParams): Promise<ReactorResult> {
  const { boxRoot, typeFilter, sourceFilter, onLog } = params;

  await syncStage(params);
  await refreshDocsStage(params);

  const jobsDir = path.join(boxRoot, "box/jobs");
  await fs.mkdir(jobsDir, { recursive: true });

  const discovered = await discoverStage({ jobsDir, typeFilter, sourceFilter, params });
  switch (discovered.kind) {
    case "none":
      return { success: true, jobsProcessed: 0, jobsRemaining: 0 };
    case "skipped":
      return { success: true, jobsProcessed: 0, jobsRemaining: discovered.remaining };
    case "ready":
      break;
  }

  const outcome = await processStage({ jobCards: discovered.jobCards, jobsDir, params });
  onLog?.(fmt.dim(`\nCycle complete: ${outcome.jobsProcessed} processed, ${outcome.jobsRemaining} remaining\n`));
  return {
    success: outcome.success,
    jobsProcessed: outcome.jobsProcessed,
    jobsRemaining: outcome.jobsRemaining,
  };
}

/** Stage 1: pull from external sources (creates jobs). Best-effort. */
async function syncStage(params: RunCycleParams): Promise<void> {
  const { boxRoot, sync, onLog, runSync } = params;
  if (!sync) return;
  onLog?.(fmt.header("[Sync]\n"));
  const syncOk = await runSync(boxRoot, onLog);
  if (!syncOk) {
    onLog?.(fmt.warn("Sync failed, continuing with existing jobs...\n"));
  }
  onLog?.("\n");
}

/** Stage 2: refresh agent docs (fast no-op if inputs haven't changed). */
async function refreshDocsStage(params: RunCycleParams): Promise<void> {
  const { boxRoot, onLog, generateDocs } = params;
  onLog?.(fmt.dim("Refreshing agent docs...\n"));
  await generateDocs(boxRoot);
}

/**
 * How long a low-priority job may sit pending before it earns a cycle of its
 * own. `skipLowPriority` (which `bbx wakeup` always sets) exists so an
 * otherwise-idle box doesn't spend an agent turn every tick on optional
 * filler — but before this deadline existed it also meant "or never": a box
 * whose `box/jobs` held nothing but low-priority cards skipped every cycle
 * forever, and one such card (`contains-backfill`) suppressed its own
 * successor as well. Low priority means *may wait*, not *may wait forever*.
 */
const LOW_PRIORITY_MAX_WAIT_MS = 24 * 60 * 60 * 1000;
const LOW_PRIORITY_MAX_WAIT_LABEL = "24h";

/**
 * How many overdue low-priority jobs one deadline-triggered cycle admits.
 * A box coming out of a long wedge can hold months of them; draining the
 * whole backlog into a single agent prompt is its own incident, so the
 * oldest few go per cycle (they're sorted oldest-first) and the rest wait
 * for the next wakeup, which will find them overdue again.
 */
const OVERDUE_LOW_PRIORITY_PER_CYCLE = 5;

/** Stage 3: find job cards and decide whether this cycle has work to do. */
async function discoverStage(opts: {
  jobsDir: string;
  typeFilter: string | undefined;
  sourceFilter: string | undefined;
  params: RunCycleParams;
}): Promise<DiscoverResult> {
  const { jobsDir, typeFilter, sourceFilter, params } = opts;
  const { boxRoot, skipLowPriority, onLog } = params;

  const jobCards = await findJobCards(jobsDir, { typeFilter, sourceFilter });
  if (jobCards.length === 0) {
    onLog?.("No pending jobs.\n");
    return { kind: "none" };
  }

  const hasNormalPriority = jobCards.some((j) => j.priority === "normal");
  let selected = jobCards;
  if (skipLowPriority && !hasNormalPriority) {
    // Nothing but low-priority work. Run only for the jobs past the deadline,
    // and only a bounded batch of them; everything else keeps waiting for a
    // free ride alongside normal work.
    const now = getBoxTime(boxRoot).getTime();
    const overdue = jobCards.filter(
      (j) => j.createdAt !== null && now - j.createdAt.getTime() >= LOW_PRIORITY_MAX_WAIT_MS,
    );
    if (overdue.length === 0) {
      onLog?.(fmt.dim(`Only ${jobCards.length} low-priority job(s), skipping.\n`));
      return { kind: "skipped", remaining: jobCards.length };
    }
    selected = overdue.slice(0, OVERDUE_LOW_PRIORITY_PER_CYCLE);
    const deferred = jobCards.length - selected.length;
    onLog?.(
      fmt.warn(
        `${overdue.length} low-priority job(s) pending over ${LOW_PRIORITY_MAX_WAIT_LABEL}; processing ${selected.length}.\n`,
      ),
    );
    if (deferred > 0) onLog?.(fmt.dim(`  ${deferred} other low-priority job(s) wait for the next cycle.\n`));
  }

  onLog?.(fmt.header(`Found ${selected.length} job(s):\n`));
  for (const card of selected) {
    const label = card.priority === "low" ? " (low priority)" : "";
    onLog?.(`  - box/jobs/${card.file}${label}\n`);
  }
  return { kind: "ready", jobCards: selected };
}


/**
 * Stage 4: read job content, run the agents, and count what was consumed.
 *
 * The processed count is the number of *this cycle's* job cards that no longer
 * exist after the agents ran — an explicit set difference against the jobs we
 * set out to process, not `before.length - after.length`. That old subtraction
 * miscounted whenever a connector or agent added jobs concurrently (new cards
 * inflated the remaining count and silently deflated — even negated — the
 * processed count). New jobs still correctly raise `jobsRemaining` so the loop
 * keeps going; they just no longer corrupt how many originals we credit.
 */
async function processStage(opts: {
  jobCards: JobCardInfo[];
  jobsDir: string;
  params: RunCycleParams;
}): Promise<ProcessOutcome> {
  const { jobCards, jobsDir, params } = opts;
  const { boxRoot, dryRun, typeFilter, sourceFilter } = params;

  const agentJobs = await readJobsWithContent({ jobCards, boxRoot });
  if (dryRun && agentJobs.length === 0) {
    return { success: true, jobsProcessed: 0, jobsRemaining: jobCards.length };
  }

  const success = await processAgentJobs({ agentJobs, params });

  const remaining = await findJobCards(jobsDir, { typeFilter, sourceFilter });
  const remainingFiles = new Set(remaining.map((c) => c.file));
  const jobsProcessed = jobCards.filter((c) => !remainingFiles.has(c.file)).length;

  return { success, jobsProcessed, jobsRemaining: remaining.length };
}

/**
 * Read each job card's content. Unreadable cards are queued with empty content
 * so the batch path reports "(could not read)" rather than crashing the cycle.
 */
async function readJobsWithContent(opts: {
  jobCards: JobCardInfo[];
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
