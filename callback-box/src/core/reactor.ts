/**
 * Reactor - orchestrates the sync → process jobs → repeat cycle.
 *
 * The reactor globs for `box/jobs/**\/*.job.card`, builds a prompt
 * listing all pending jobs, and runs a single agent session to
 * process them. The agent calls `cb finish <file>` for each
 * completed job.
 *
 * In full mode, it runs sync first (to create jobs), then processes them.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { parseXml, type ElementNode } from "cardworks";
import { schemas } from "../schemas/registry.js";
import { createAgent, ensureAgentCommitted } from "./agent.js";
import { generateDocs } from "./generate-docs.js";
import { startProcedure } from "./procedure/engine.js";
import { finishJob } from "./finish-job.js";
import { fmt } from "../cli/lib/format.js";
import {
  loadChatSessions,
  saveChatSessions,
  getOrCreateSession,
  markSessionUsed,
  resetSession,
  resetAllSessions,
} from "./chat-reactor-sessions.js";
import type { CommandContext } from "./command-runner.js";

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
}

export interface ReactorResult {
  success: boolean;
  jobsProcessed: number;
  jobsRemaining: number;
  error?: string;
}

interface JobWithContent {
  card: JobCardInfo;
  relPath: string;
  content: string;
  procedureInfo: ProcedureJobInfo | null;
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
      onLog?.(fmt.header(`\nProcessing ${procedureJobs.length} procedure job(s):\n`));

      const ctx: CommandContext = {
        boxRoot,
        write: (text: string) => onLog?.(text),
        writeLine: (text: string) => onLog?.(text + "\n"),
      };

      for (const job of procedureJobs) {
        const info = job.procedureInfo!;
        onLog?.(`  ${fmt.strong(info.procedureRef)}${info.directive ? ` (directive: ${info.directive})` : ""}\n`);

        if (dryRun) {
          onLog?.(fmt.dim(`  [DRY RUN] Would run procedure: ${info.procedureRef}\n`));
          continue;
        }

        const result = await startProcedure({
          ctx,
          procedureNameOrPath: info.procedureRef,
          options: { ...(info.directive && { directive: info.directive }) },
        });

        if (result.success) {
          await finishJob({ boxRoot, jobRelPath: job.relPath });
          onLog?.(fmt.ok(`Finished procedure job: ${job.relPath}\n`));
        } else {
          onLog?.(fmt.fail(`Procedure failed for ${job.relPath}: ${result.error ?? "unknown"}\n`));
        }
      }
    }

    if (dryRun && agentJobs.length === 0) {
      return { success: true, jobsProcessed: 0, jobsRemaining: jobCards.length };
    }

    // Process remaining agent jobs
    let cycleSuccess = true;
    if (agentJobs.length > 0) {
      const jobOpts: ProcessJobsOptions = { jobs: agentJobs, boxRoot, dryRun, typeFilter, onLog };
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

// ─── Chat job processing (per-thread session reuse) ─────────────────

interface ProcessJobsOptions {
  jobs: JobWithContent[];
  boxRoot: string;
  dryRun: boolean;
  typeFilter?: string | undefined;
  onLog?: ((text: string) => void) | undefined;
}

/**
 * Process chat jobs individually, one agent call per thread,
 * reusing Claude Code sessions across reactor invocations.
 */
async function processChatJobs(opts: ProcessJobsOptions): Promise<boolean> {
  const { jobs, boxRoot, dryRun, onLog } = opts;
  const sessions = await loadChatSessions(boxRoot);
  let allSuccess = true;

  for (const job of jobs) {
    const threadRef = extractThreadRef(job.content);
    const sessionKey = threadRef ?? job.relPath; // fall back to job path if no thread ref

    if (threadRef) {
      onLog?.(fmt.dim(`  Thread: ${threadRef}\n`));
    }

    const { sessionId, resume } = getOrCreateSession(sessions, sessionKey);
    onLog?.(fmt.dim(`  Session: ${sessionId.slice(0, 8)}... (${resume ? "resume" : "new"})\n`));

    const desc = await buildJobDescription(job, boxRoot);
    const userPrompt = `Please process this job:\n\n${desc}\n\nProcess it according to the instructions, then call \`cb finish\` when done.`;

    if (dryRun) {
      onLog?.("\n[DRY RUN] Would run agent with prompt:\n");
      onLog?.(userPrompt + "\n");
      continue;
    }

    const systemPrompt = buildReactorSystemPrompt(boxRoot);
    const agent = createAgent({
      name: "reactor-chat",
      sessionId,
      resume,
      ...(onLog && { onOutput: onLog }),
    });

    onLog?.("\n");
    const agentResult = await agent.invoke({
      boxRoot,
      systemPrompt,
      prompt: userPrompt,
      maxTurns: 10,
    });

    await ensureAgentCommitted({
      boxRoot,
      agent,
      fallbackMessage: "Reactor: chat agent work (fallback commit)",
      fallbackTrailers: { Phase: "reactor" },
      ...(onLog ? { onOutput: onLog } : {}),
    });

    if (agentResult.success) {
      markSessionUsed(sessions, sessionKey);
    } else {
      // Failed — reset so next message starts fresh
      resetSession(sessions, sessionKey);
      allSuccess = false;
    }
  }

  await saveChatSessions(boxRoot, sessions);
  return allSuccess;
}

// ─── Batch job processing (non-chat) ────────────────────────────────

/**
 * Process agent jobs in a single batched agent session (original behavior).
 */
async function processBatchJobs(opts: ProcessJobsOptions): Promise<boolean> {
  const { jobs, boxRoot, typeFilter, dryRun, onLog } = opts;
  const jobPaths = jobs.map((j) => j.relPath);
  const jobDescriptions: string[] = [];

  for (const job of jobs) {
    if (job.content) {
      jobDescriptions.push(await buildJobDescription(job, boxRoot));
    } else {
      const priorityLabel = job.card.priority === "low" ? " *(low priority)*" : "";
      jobDescriptions.push(`### ${job.relPath}${priorityLabel}\n(could not read)`);
    }
  }

  const systemPrompt = buildReactorSystemPrompt(boxRoot);
  const userPrompt = buildReactorUserPrompt(jobPaths, jobDescriptions);

  if (dryRun) {
    onLog?.("\n[DRY RUN] Would run agent with prompt:\n");
    onLog?.(userPrompt + "\n");
    return true;
  }

  onLog?.("\n");
  const maxTurns = typeFilter ? 10 : 30;
  const agent = createAgent({
    name: "reactor-batch",
    ...(onLog && { onOutput: onLog }),
  });

  const agentResult = await agent.invoke({
    boxRoot,
    systemPrompt,
    prompt: userPrompt,
    maxTurns,
  });

  await ensureAgentCommitted({
    boxRoot,
    agent,
    fallbackMessage: "Reactor: agent work (fallback commit)",
    fallbackTrailers: { Phase: "reactor" },
    ...(onLog ? { onOutput: onLog } : {}),
  });

  return agentResult.success;
}

// ─── Job description building ───────────────────────────────────────

/**
 * Build a formatted job description with inlined refs and schema instructions.
 */
async function buildJobDescription(job: JobWithContent, boxRoot: string): Promise<string> {
  const priorityLabel = job.card.priority === "low" ? " *(low priority)*" : "";
  let desc = `### ${job.relPath}${priorityLabel}\n\`\`\`xml\n${job.content.trim()}\n\`\`\``;

  const refs = extractRefs(job.content);
  for (const ref of refs) {
    const refPath = path.join(boxRoot, ref);
    try {
      const refContent = await fs.readFile(refPath, "utf-8");
      desc += `\n\n#### ${ref}\n\`\`\`xml\n${refContent.trim()}\n\`\`\``;
    } catch {
      // Referenced file doesn't exist — agent will discover this
    }
  }

  const rootTag = extractRootTag(job.content);
  if (rootTag) {
    const instructions = getSchemaInstructions(rootTag);
    if (instructions) {
      desc += `\n\n#### Instructions for ${rootTag}\n${instructions}`;
    }
  }

  return desc;
}

/**
 * Run `cb wakeup` as a subprocess.
 */
async function runSync(boxRoot: string, onLog?: (text: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("cb", ["wakeup"], {
      cwd: boxRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (data) => {
      onLog?.(data.toString());
    });

    child.stderr.on("data", (data) => {
      onLog?.(data.toString());
    });

    child.on("error", (err) => {
      onLog?.(`Sync error: ${err.message}\n`);
      resolve(false);
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

/**
 * Run `cb finalize` as a subprocess.
 */
async function runFinalize(boxRoot: string, onLog?: (text: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("cb", ["finalize"], {
      cwd: boxRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (data: Buffer) => {
      onLog?.(data.toString());
    });

    child.stderr.on("data", (data: Buffer) => {
      onLog?.(data.toString());
    });

    child.on("error", (err) => {
      onLog?.(`Finalize error: ${err.message}\n`);
      resolve(false);
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// ─── Procedure trampoline ────────────────────────────────────────────

interface ProcedureJobInfo {
  procedureRef: string;
  directive?: string;
}

/**
 * Detect if a job card contains a `<procedure ref="...">` element.
 * If so, return the ref and optional directive text.
 */
async function detectProcedureInJob(content: string, filePath: string): Promise<ProcedureJobInfo | null> {
  try {
    const root = await parseXml(content, filePath);
    for (const child of root.children as ElementNode[]) {
      if (child.tagName === "procedure" && child.attrs["ref"]) {
        let directive: string | undefined;
        for (const grandchild of (child.children ?? []) as ElementNode[]) {
          if (grandchild.tagName === "directive") {
            directive = grandchild.text?.trim();
          }
        }
        return { procedureRef: child.attrs["ref"], ...(directive && { directive }) };
      }
    }
  } catch {
    // Not valid XML or no procedure element — not a procedure job
  }
  return null;
}

/**
 * Extract the root element tag name from XML content (e.g. "chat-job" from "<chat-job ...>").
 */
function extractRootTag(xmlContent: string): string | null {
  const match = xmlContent.match(/<([a-z][\w-]*)/);
  return match ? match[1]! : null;
}

/**
 * Look up schema instructions for a given root tag name.
 */
function getSchemaInstructions(tagName: string): string | null {
  const schema = schemas.find((s) => s.tagName === tagName);
  return schema?.instructions ?? null;
}

/**
 * Extract ref="..." attributes from elements like <thread ref="..."> and <item ref="...">.
 */
function extractRefs(xmlContent: string): string[] {
  const refs: string[] = [];
  const pattern = /<(?:thread|item)\s[^>]*ref="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(xmlContent)) !== null) {
    refs.push(match[1]!);
  }
  return refs;
}

/**
 * Extract the thread ref from a job card's XML content.
 * Looks for <thread ref="..."> element.
 */
function extractThreadRef(xmlContent: string): string | null {
  const match = xmlContent.match(/<thread\s[^>]*ref="([^"]+)"/);
  return match ? match[1]! : null;
}

export function buildReactorSystemPrompt(boxRoot: string): string {
  return `You are processing jobs in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

## What You Already Have (DO NOT re-read these)

The following are ALREADY loaded into your context — reading them again wastes time:

1. **Job card XML** — included in the user prompt below
2. **Referenced files** (threads, items) — inlined in the user prompt below
3. **Processing instructions** — included in the user prompt below (from the schema)
4. **.claude/rules/ files** — auto-loaded by the system based on job type
5. **CLAUDE.md and agent-guide.md** — auto-loaded by the system

Do NOT read \`docs/generated/\` or \`.claude/rules/\` files — you already have all the instructions you need.

**Note:** The Edit tool requires you to Read a file first. You may Read a file once before editing it, but do NOT read it to understand the content — you already have that from this prompt.

## Process

For each job:
1. Read the job content from this prompt (already provided below)
2. Do the work (edit files, etc.)
3. Commit your changes
4. Call \`cb finish <job-file-path>\` to complete the job

## Guidelines

- Process one job at a time
- \`cb finish\` only deletes the job file — make sure your work is committed first`;
}

export function buildReactorUserPrompt(jobPaths: string[], jobDescriptions: string[]): string {
  return `Please process the following ${jobPaths.length} job(s):

${jobDescriptions.join("\n\n")}

Process each job according to its type's instructions, then call \`cb finish\` for each one when done.`;
}

interface JobCardInfo {
  file: string;
  priority: "normal" | "low";
}

async function findJobCards(jobsDir: string, typeFilter?: string): Promise<JobCardInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir, { recursive: true });
  } catch {
    return [];
  }

  const suffix = typeFilter ? `.${typeFilter}.job.card` : ".job.card";
  const jobFiles = entries.filter((e) => e.endsWith(suffix));
  const results: JobCardInfo[] = [];

  for (const file of jobFiles) {
    let priority: "normal" | "low" = "normal";
    try {
      const content = await fs.readFile(path.join(jobsDir, file), "utf-8");
      const match = content.match(/priority="(low|normal)"/);
      if (match?.[1] === "low") priority = "low";
    } catch {
      // Can't read — default to normal priority
    }
    results.push({ file, priority });
  }

  // Sort: normal-priority first, low-priority last
  results.sort((a, b) => {
    if (a.priority === b.priority) return 0;
    return a.priority === "normal" ? -1 : 1;
  });

  return results;
}
