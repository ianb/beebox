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
import { runAgent, ensureAgentCommitted, type AgentOptions } from "./agent.js";
import { generateDocs } from "./generate-docs.js";
import { startProcedure } from "./procedure/engine.js";
import { finishJob } from "./finish-job.js";
import { fmt } from "../cli/lib/format.js";
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
  onLog?: ((text: string) => void) | undefined;
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
    onLog,
  } = options;

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

    // Refresh agent docs
    onLog?.(fmt.dim("Refreshing agent docs...\n"));
    await generateDocs(boxRoot);

    // Find all job cards
    const jobsDir = path.join(boxRoot, "box/jobs");
    await fs.mkdir(jobsDir, { recursive: true });

    const jobCards = await findJobCards(jobsDir);

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
    interface JobWithContent {
      card: JobCardInfo;
      relPath: string;
      content: string;
      procedureInfo: ProcedureJobInfo | null;
    }
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

    // Process remaining agent jobs as before
    let cycleSuccess = true;
    if (agentJobs.length > 0) {
      const agentJobPaths = agentJobs.map((j) => j.relPath);
      const jobDescriptions: string[] = [];
      for (const job of agentJobs) {
        const priorityLabel = job.card.priority === "low" ? " *(low priority)*" : "";
        if (job.content) {
          jobDescriptions.push(`### ${job.relPath}${priorityLabel}\n\`\`\`xml\n${job.content.trim()}\n\`\`\``);
        } else {
          jobDescriptions.push(`### ${job.relPath}${priorityLabel}\n(could not read)`);
        }
      }

      const systemPrompt = buildReactorSystemPrompt(boxRoot);
      const userPrompt = buildReactorUserPrompt(agentJobPaths, jobDescriptions);

      if (dryRun) {
        onLog?.("\n[DRY RUN] Would run agent with prompt:\n");
        onLog?.(userPrompt + "\n");
        return { success: true, jobsProcessed: 0, jobsRemaining: jobCards.length };
      }

      // Run the agent
      onLog?.("\n");
      const agentOptions: AgentOptions = {
        boxRoot,
        systemPrompt,
        prompt: userPrompt,
        onOutput: onLog,
        maxTurns: 30,
      };

      const agentResult = await runAgent(agentOptions);
      cycleSuccess = agentResult.success;

      // Ensure the agent committed its work
      await ensureAgentCommitted({
        boxRoot,
        agentResult,
        agentOptions,
        fallbackMessage: "Reactor: agent work (fallback commit)",
        fallbackTrailers: { Phase: "reactor" },
        ...(onLog ? { onOutput: onLog } : {}),
      });
    }

    // Count remaining jobs
    const remaining = await findJobCards(jobsDir);
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
    onLog?.(fmt.dim(`\nPolling every ${pollInterval}s... (Ctrl+C to stop)\n`));
    await sleep(pollInterval * 1000);
    // Recurse for next poll iteration
    const pollResult = await runReactor(options);
    return {
      success: pollResult.success,
      jobsProcessed: totalProcessed + pollResult.jobsProcessed,
      jobsRemaining: pollResult.jobsRemaining,
    };
  }

  return {
    success,
    jobsProcessed: totalProcessed,
    jobsRemaining: lastRemaining,
  };
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

function buildReactorSystemPrompt(boxRoot: string): string {
  return `You are processing jobs in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

## How Jobs Work

Job cards live in \`box/jobs/\`. Each job card describes work to do.
The card's type (from its file extension, e.g. \`.news.job.card\`) determines
what kind of work and has associated rules with detailed instructions.

Your goal: process every job card and clear the jobs directory.

## Process

For each job:
1. Read the job card
2. Follow the instructions for that job type (loaded via .claude/rules/)
3. Do the work, committing as you go
4. When done, call \`cb finish <job-file-path>\` to delete the job card and commit the deletion

## Guidelines

- Process one job at a time
- Commit your work frequently — don't let changes pile up
- Read referenced files before making decisions
- If a job references items (\`<item ref="...">\`), read those items
- \`cb finish\` only deletes the job file — make sure your work is committed first`;
}

function buildReactorUserPrompt(jobPaths: string[], jobDescriptions: string[]): string {
  return `Please process the following ${jobPaths.length} job(s):

${jobDescriptions.join("\n\n")}

Process each job according to its type's instructions, then call \`cb finish\` for each one when done.`;
}

interface JobCardInfo {
  file: string;
  priority: "normal" | "low";
}

async function findJobCards(jobsDir: string): Promise<JobCardInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir, { recursive: true });
  } catch {
    return [];
  }

  const jobFiles = entries.filter((e) => e.endsWith(".job.card"));
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
