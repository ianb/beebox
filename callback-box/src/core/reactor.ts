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
import { runAgent, ensureAgentCommitted, type AgentOptions } from "./agent.js";
import { generateDocs } from "./generate-docs.js";
import { fmt } from "../cli/lib/format.js";

export interface ReactorOptions {
  boxRoot: string;
  dryRun?: boolean | undefined;
  /** Run sync before processing jobs */
  sync?: boolean | undefined;
  /** Maximum sync→process cycles (default 3) */
  maxCycles?: number | undefined;
  /** Poll interval in seconds (0 = one-shot, default) */
  pollInterval?: number | undefined;
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

    const jobFiles = await findJobCards(jobsDir);

    if (jobFiles.length === 0) {
      onLog?.("No pending jobs.\n");
      return { success: true, jobsProcessed: 0, jobsRemaining: 0 };
    }

    const jobPaths = jobFiles.map((f) => path.join("box/jobs", f));
    onLog?.(fmt.header(`Found ${jobFiles.length} job(s):\n`));
    for (const jp of jobPaths) {
      onLog?.(`  - ${jp}\n`);
    }

    // Read each job card to build context
    const jobDescriptions: string[] = [];
    for (const jp of jobPaths) {
      const absPath = path.join(boxRoot, jp);
      try {
        const content = await fs.readFile(absPath, "utf-8");
        jobDescriptions.push(`### ${jp}\n\`\`\`xml\n${content.trim()}\n\`\`\``);
      } catch {
        jobDescriptions.push(`### ${jp}\n(could not read)`);
      }
    }

    const systemPrompt = buildReactorSystemPrompt(boxRoot);
    const userPrompt = buildReactorUserPrompt(jobPaths, jobDescriptions);

    if (dryRun) {
      onLog?.("\n[DRY RUN] Would run agent with prompt:\n");
      onLog?.(userPrompt + "\n");
      return { success: true, jobsProcessed: 0, jobsRemaining: jobFiles.length };
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

    // Ensure the agent committed its work
    await ensureAgentCommitted({
      boxRoot,
      agentResult,
      agentOptions,
      fallbackMessage: "Reactor: agent work (fallback commit)",
      fallbackTrailers: { Phase: "reactor" },
      ...(onLog ? { onOutput: onLog } : {}),
    });

    // Count remaining jobs
    const remaining = await findJobCards(jobsDir);
    const processed = jobFiles.length - remaining.length;

    onLog?.(fmt.dim(`\nCycle complete: ${processed} processed, ${remaining.length} remaining\n`));

    return {
      success: agentResult.success,
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
 * Run `cb sync` as a subprocess.
 */
async function runSync(boxRoot: string, onLog?: (text: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("cb", ["sync"], {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildReactorSystemPrompt(boxRoot: string): string {
  return `You are processing jobs in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

## How Jobs Work

Job cards live in \`box/jobs/\`. Each job card describes work to do.
The card's type (from its file extension, e.g. \`.news.job.card\`) determines
what kind of work and has associated rules with detailed instructions.

Your goal: process every job card and clear the jobs directory.

## Workflow

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

async function findJobCards(jobsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(jobsDir, { recursive: true });
    return entries.filter((e) => e.endsWith(".job.card"));
  } catch {
    return [];
  }
}
