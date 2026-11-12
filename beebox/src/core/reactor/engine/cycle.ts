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
import { getBoxTime } from "../../../lib/time.js";
import type { createAgent as realCreateAgent } from "../../agent/invoke/core.js";
import type { generateDocs as realGenerateDocs } from "../../docs-gen/generate/core.js";
import { findJobCards } from "../job-discovery.js";
import { BatchPromptTooLargeError, processBatchJobs, type BatchOutcome } from "./batch-jobs.js";
import type { runSync as realRunSync } from "./subprocess.js";
import type { JobWithContent, ProcessJobsOptions } from "../types.js";
import type { ReactorResult } from "./core.js";
import { getBoxDir, BOX_DIRS } from "../../../lib/paths/core.js";

export interface RunCycleParams {
  boxRoot: string;
  dryRun: boolean;
  sync: boolean;
  skipLowPriority: boolean;
  typeFilter: string | undefined;
  connectorFilter: string | undefined;
  onLog: ((text: string) => void) | undefined;
  agentFactory: typeof realCreateAgent;
  runSync: typeof realRunSync;
  generateDocs: typeof realGenerateDocs;
  /**
   * Job files already sent to an agent in this `runReactor` call. A later
   * cycle of the same run does not select them again, so it takes the next
   * jobs instead of resending one an agent did not finish.
   */
  attempted: Set<string>;
}

/** One cycle's result, plus how many jobs it sent to the agent. */
export type CycleResult = ReactorResult & { selected: number };

type JobCardInfo = Awaited<ReturnType<typeof findJobCards>>[number];

/**
 * Outcome of the discovery stage. A discriminated result so the cycle can
 * dispatch exhaustively instead of threading sentinel counts:
 * - `none` — no pending job this run has not already tried (`remaining`
 *   counts the tried ones still pending).
 * - `skipped` — jobs exist but all low-priority, none past the wait deadline,
 *   and `skipLowPriority` is set; they stay pending (`remaining`).
 * - `ready` — jobs to process this cycle (not necessarily every pending job:
 *   a deadline-triggered cycle admits only a bounded batch of the overdue).
 */
type DiscoverResult =
  | { kind: "none"; remaining: number }
  | { kind: "skipped"; remaining: number }
  | { kind: "ready"; jobCards: JobCardInfo[] };

/** Result of the process stage: agent success plus an explicit processed count. */
interface ProcessOutcome {
  success: boolean;
  jobsProcessed: number;
  jobsRemaining: number;
  selected: number;
}

/** Run sync + agent-doc refresh, then discover and process one batch of jobs. */
export async function runOneCycle(params: RunCycleParams): Promise<CycleResult> {
  const { boxRoot, typeFilter, connectorFilter, onLog } = params;

  await syncStage(params);
  await refreshDocsStage(params);

  const jobsDir = getBoxDir(boxRoot, "jobs");
  await fs.mkdir(jobsDir, { recursive: true });

  const discovered = await discoverStage({ jobsDir, typeFilter, connectorFilter, params });
  switch (discovered.kind) {
    case "none":
      return { success: true, jobsProcessed: 0, jobsRemaining: discovered.remaining, selected: 0 };
    case "skipped":
      return { success: true, jobsProcessed: 0, jobsRemaining: discovered.remaining, selected: 0 };
    case "ready":
      break;
  }

  const outcome = await processStage({ jobCards: discovered.jobCards, jobsDir, params });
  onLog?.(`\nCycle complete: ${outcome.jobsProcessed} processed, ${outcome.jobsRemaining} remaining\n`);
  return outcome;
}

/** Stage 1: pull from external sources (creates jobs). Best-effort. */
async function syncStage(params: RunCycleParams): Promise<void> {
  const { boxRoot, sync, onLog, runSync } = params;
  if (!sync) return;
  onLog?.("[Sync]\n");
  const syncOk = await runSync(boxRoot, onLog);
  if (!syncOk) {
    onLog?.("Sync failed, continuing with existing jobs...\n");
  }
  onLog?.("\n");
}

/** Stage 2: refresh agent docs (fast no-op if inputs haven't changed). */
async function refreshDocsStage(params: RunCycleParams): Promise<void> {
  const { boxRoot, onLog, generateDocs } = params;
  onLog?.("Refreshing agent docs...\n");
  await generateDocs(boxRoot);
}

/**
 * How long a low-priority job may sit pending before it earns a cycle of its
 * own. `skipLowPriority` (which `bbx wakeup` always sets) exists so an
 * otherwise-idle box doesn't spend an agent turn every tick on optional
 * filler — but before this deadline existed it also meant "or never": a box
 * whose `_bookkeeping/jobs` held nothing but low-priority cards skipped every cycle
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
  connectorFilter: string | undefined;
  params: RunCycleParams;
}): Promise<DiscoverResult> {
  const { jobsDir, typeFilter, connectorFilter, params } = opts;
  const { boxRoot, skipLowPriority, onLog } = params;

  const pending = await findJobCards(jobsDir, { typeFilter, connectorFilter });
  // Jobs an earlier cycle of this run already sent wait for the next run.
  const jobCards = pending.filter((j) => !params.attempted.has(j.file));
  if (jobCards.length === 0) {
    onLog?.(pending.length === 0 ? "No pending jobs.\n" : `No pending jobs this run has not tried (${String(pending.length)} remain).\n`);
    return { kind: "none", remaining: pending.length };
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
      onLog?.(`Only ${jobCards.length} low-priority job(s), skipping.\n`);
      return { kind: "skipped", remaining: jobCards.length };
    }
    selected = overdue.slice(0, OVERDUE_LOW_PRIORITY_PER_CYCLE);
    const deferred = jobCards.length - selected.length;
    onLog?.(
      `${overdue.length} low-priority job(s) pending over ${LOW_PRIORITY_MAX_WAIT_LABEL}; processing ${selected.length}.\n`,
    );
    if (deferred > 0) onLog?.(`  ${deferred} other low-priority job(s) wait for the next cycle.\n`);
  }

  onLog?.(`Found ${selected.length} job(s):\n`);
  for (const card of selected) {
    const label = card.priority === "low" ? " (low priority)" : "";
    onLog?.(`  - ${BOX_DIRS.jobs}/${card.file}${label}\n`);
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
  const { boxRoot, dryRun, typeFilter, connectorFilter } = params;

  const agentJobs = await readJobsWithContent({ jobCards, boxRoot });
  if (dryRun && agentJobs.length === 0) {
    return { success: true, jobsProcessed: 0, jobsRemaining: jobCards.length, selected: 0 };
  }

  const { success, selected } = await processAgentJobs({ agentJobs, params });
  const selectedFiles = new Set(agentJobs.filter((j) => selected.includes(j.relPath)).map((j) => j.card.file));
  for (const file of selectedFiles) params.attempted.add(file);

  const remaining = await findJobCards(jobsDir, { typeFilter, connectorFilter });
  const remainingFiles = new Set(remaining.map((c) => c.file));
  // Counted among the jobs sent: a deferred job was never tried.
  const jobsProcessed = [...selectedFiles].filter((file) => !remainingFiles.has(file)).length;

  return { success, jobsProcessed, jobsRemaining: remaining.length, selected: selectedFiles.size };
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
    const jp = path.join(BOX_DIRS.jobs, card.file);
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
 * Process the agent jobs for one cycle, batched into a single session.
 * Succeeds with nothing selected when there are no agent jobs to run. A batch
 * prompt over its budget starts no session: it is logged and fails the cycle.
 */
async function processAgentJobs(opts: {
  agentJobs: JobWithContent[];
  params: RunCycleParams;
}): Promise<BatchOutcome> {
  const { agentJobs, params } = opts;
  if (agentJobs.length === 0) return { success: true, selected: [] };

  const { boxRoot, dryRun, typeFilter, onLog, agentFactory } = params;
  const jobOpts: ProcessJobsOptions = {
    jobs: agentJobs,
    boxRoot,
    dryRun,
    typeFilter,
    onLog,
    createAgent: agentFactory,
  };
  try {
    return await processBatchJobs(jobOpts);
  } catch (e) {
    if (!(e instanceof BatchPromptTooLargeError)) throw e;
    console.error(`[reactor] ${e.message}`);
    onLog?.(`${e.message}\n`);
    return { success: false, selected: [] };
  }
}
