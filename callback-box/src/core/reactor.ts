/**
 * Reactor - processes job cards by spawning an agent session.
 *
 * The reactor globs for `box/jobs/**\/*.job.card`, builds a prompt
 * listing all pending jobs, and runs a single agent session to
 * process them. The agent calls `cb finish <file>` for each
 * completed job.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { runAgent, ensureAgentCommitted, type AgentOptions } from "./agent.js";
import { generateDocs } from "./generate-docs.js";
import { fmt } from "../cli/lib/format.js";

export interface ReactorOptions {
  boxRoot: string;
  dryRun?: boolean | undefined;
  onLog?: ((text: string) => void) | undefined;
}

export interface ReactorResult {
  success: boolean;
  jobsProcessed: number;
  jobsRemaining: number;
  error?: string;
}

/**
 * Run the reactor: find all pending jobs and spawn an agent to process them.
 */
export async function runReactor(options: ReactorOptions): Promise<ReactorResult> {
  const { boxRoot, dryRun = false, onLog } = options;

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
  onLog?.(fmt.dim(`\nReactor complete: ${processed} processed, ${remaining.length} remaining\n`));

  return {
    success: agentResult.success,
    jobsProcessed: processed,
    jobsRemaining: remaining.length,
  };
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
