/**
 * Process-news command - Run the news processing agent.
 *
 * This command invokes Claude Code to:
 * 1. Triage news items (mark interesting vs skipped)
 * 2. Fetch content for interesting items
 * 3. Create a summary of the batch
 *
 * The agent runs in a constrained manner with explicit batch sizing.
 */

import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { getSystemState, type CardInfo } from "../state.js";
import { runAgent } from "../agent.js";
import { acquireLock, releaseLock, getLockInfo } from "../../cli/lib/lock.js";
import { stageAll, commit, getStatus } from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";

/**
 * Arguments for the process-news command.
 */
export interface ProcessNewsArgs {
  /** Maximum number of items to process in this run */
  batchSize?: number;
  /** Only do triage phase (no fetching or summarizing) */
  triageOnly?: boolean;
  /** Only do fetch phase (for items already triaged as interesting) */
  fetchOnly?: boolean;
  /** Only do summary phase (for items already fetched) */
  summarizeOnly?: boolean;
  /** Show what would happen without doing it */
  dryRun?: boolean;
  /** Force even if another process is running */
  force?: boolean;
}

/**
 * Build the system prompt for news triage.
 */
function buildTriagePrompt(boxRoot: string, batchSize: number): string {
  return `You are triaging news items in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
Review news items and decide which are interesting enough to read in full.

BATCH SIZE: You should process up to ${batchSize} items in this run.

FOR EACH NEWS ITEM:
1. Read the title and summary from the card
2. Decide: Is this likely interesting based on the title/summary?
3. Update the card's status attribute:
   - status="interesting" - Worth fetching and reading the full article
   - status="possibly-interesting" - Uncertain, keep for later review
   - status="skipped" - Not interesting, will be trashed

CRITERIA FOR "INTERESTING":
- Technical content (programming, systems, architecture)
- Novel ideas or approaches
- Significant news in tech/science
- Things that would be educational or useful

NOT INTERESTING (skip):
- Marketing/promotional content
- Listicles without substance
- Repetitive news already covered elsewhere
- Entertainment gossip

HOW TO UPDATE STATUS:
Use the Edit tool to change status="new" to status="interesting" (or skipped, etc.)

For skipped items, also run: cb trash <path> --commit --reason "Not interesting: [brief reason]"

When done, briefly summarize what you triaged.`;
}

/**
 * Build the system prompt for content fetching.
 */
function buildFetchPrompt(boxRoot: string): string {
  return `You are fetching full article content for interesting news items.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
For each news item with status="interesting", fetch the full article content.

HOW TO FETCH:
Run the command: cb fetch-news <path> --commit

This will:
- Fetch the article HTML
- Convert to markdown
- Update the card with the content
- Set status to "fetched" (or "fetch-failed")

For each item:
1. Run cb fetch-news <path> --commit
2. Note if it succeeded or failed

When done, summarize what was fetched.`;
}

/**
 * Build the system prompt for news summarization.
 */
function buildSummaryPrompt(boxRoot: string): string {
  return `You are creating a news summary from fetched articles.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
1. Read news items with status="fetched"
2. Read their full content (in the <content> element)
3. Create a news summary card
4. Mark summarized items with status="summarized"

SUMMARY FORMAT:
Create a news-summary card using:

cb create box/inbox/summaries/Daily_Summary_[YYYY-MM-DD].news-summary.card \\
  --commit

Then edit the created card to add the summary content.

SUMMARY CONTENT GUIDELINES:
- Group by theme/topic when possible
- Include 1-2 sentence highlights for each article
- Link back to sources
- Focus on what's actionable or notable

After creating the summary, mark each source item:
- Use Edit to change status="fetched" to status="summarized"

When done, state what was summarized.`;
}

/**
 * Get news items by status.
 */
async function getNewsByStatus(
  boxRoot: string,
  statuses: string[]
): Promise<CardInfo[]> {
  const state = await getSystemState(boxRoot);
  return state.inbox.filter(
    (item) => item.type === "news-item" && statuses.includes(item.status ?? "")
  );
}

/**
 * Execute the process-news command.
 */
async function executeProcessNews(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const processArgs = args as ProcessNewsArgs;
  const batchSize = processArgs.batchSize ?? 5;
  const dryRun = processArgs.dryRun ?? false;

  // Determine which phases to run
  const runTriage = !processArgs.fetchOnly && !processArgs.summarizeOnly;
  const runFetch = !processArgs.triageOnly && !processArgs.summarizeOnly;
  const runSummarize = !processArgs.triageOnly && !processArgs.fetchOnly;

  // Check for existing lock
  if (!processArgs.force) {
    const existingLock = await getLockInfo(ctx.boxRoot);
    if (existingLock) {
      return {
        success: false,
        error: `Another process is running (PID ${existingLock.pid}). Use --force to override.`,
      };
    }
  }

  // Acquire lock
  const lock = await acquireLock(ctx.boxRoot);
  if (!lock && !processArgs.force) {
    return {
      success: false,
      error: "Failed to acquire lock",
    };
  }

  const results: { phase: string; success: boolean; message: string }[] = [];

  try {
    // Phase 1: Triage
    if (runTriage) {
      ctx.writeLine(fmt.phase("Phase 1: Triage"));
      const newItems = await getNewsByStatus(ctx.boxRoot, ["new"]);

      if (newItems.length === 0) {
        ctx.writeLine(fmt.dim("No new items to triage."));
        results.push({ phase: "triage", success: true, message: "No items" });
      } else {
        const itemsToProcess = newItems.slice(0, batchSize);
        ctx.writeLine(fmt.progress(itemsToProcess.length, newItems.length, "items to triage"));

        if (dryRun) {
          ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
          results.push({ phase: "triage", success: true, message: "Dry run" });
        } else {
          const paths = itemsToProcess.map((i) => i.relativePath).join("\n  - ");
          ctx.writeLine(fmt.info("Starting Claude Code agent..."));
          ctx.writeLine("");
          const triageResult = await runAgent({
            boxRoot: ctx.boxRoot,
            systemPrompt: buildTriagePrompt(ctx.boxRoot, batchSize),
            prompt: `Please triage these news items:\n  - ${paths}`,
            onOutput: (text) => {
              // Stream raw output from Claude Code
              ctx.write(text);
            },
          });
          ctx.writeLine("");
          if (triageResult.success) {
            ctx.writeLine(fmt.ok("Agent finished successfully"));
          } else {
            ctx.writeLine(fmt.fail(`Agent error: ${triageResult.error}`));
          }

          if (!triageResult.success) {
            results.push({ phase: "triage", success: false, message: triageResult.error ?? "Failed" });
          } else {
            results.push({ phase: "triage", success: true, message: `Triaged ${itemsToProcess.length} items` });
          }

          // Commit triage changes
          const status = await getStatus(ctx.boxRoot);
          if (!status.clean) {
            await stageAll(ctx.boxRoot);
            await commit(ctx.boxRoot, {
              message: `Triage ${itemsToProcess.length} news items`,
              trailers: { "Triggered-By": "cb process-news", Phase: "triage" },
            });
            ctx.writeLine(fmt.dim("  Triage changes committed."));
          }
        }
      }
      ctx.writeLine("");
    }

    // Phase 2: Fetch
    if (runFetch) {
      ctx.writeLine(fmt.phase("Phase 2: Fetch Content"));
      const interestingItems = await getNewsByStatus(ctx.boxRoot, ["interesting"]);

      if (interestingItems.length === 0) {
        ctx.writeLine(fmt.dim("No interesting items to fetch."));
        results.push({ phase: "fetch", success: true, message: "No items" });
      } else {
        const itemsToFetch = interestingItems.slice(0, batchSize);
        ctx.writeLine(fmt.progress(itemsToFetch.length, interestingItems.length, "items to fetch"));

        if (dryRun) {
          ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
          results.push({ phase: "fetch", success: true, message: "Dry run" });
        } else {
          const paths = itemsToFetch.map((i) => i.relativePath).join("\n  - ");
          ctx.writeLine(fmt.info("Starting Claude Code agent..."));
          ctx.writeLine("");
          const fetchResult = await runAgent({
            boxRoot: ctx.boxRoot,
            systemPrompt: buildFetchPrompt(ctx.boxRoot),
            prompt: `Please fetch content for these items:\n  - ${paths}`,
            onOutput: (text) => {
              // Stream raw output from Claude Code
              ctx.write(text);
            },
          });
          ctx.writeLine("");
          if (fetchResult.success) {
            ctx.writeLine(fmt.ok("Agent finished successfully"));
          } else {
            ctx.writeLine(fmt.fail(`Agent error: ${fetchResult.error}`));
          }

          if (!fetchResult.success) {
            results.push({ phase: "fetch", success: false, message: fetchResult.error ?? "Failed" });
          } else {
            results.push({ phase: "fetch", success: true, message: `Fetched ${itemsToFetch.length} items` });
          }
        }
      }
      ctx.writeLine("");
    }

    // Phase 3: Summarize
    if (runSummarize) {
      ctx.writeLine(fmt.phase("Phase 3: Summarize"));
      const fetchedItems = await getNewsByStatus(ctx.boxRoot, ["fetched"]);

      if (fetchedItems.length === 0) {
        ctx.writeLine(fmt.dim("No fetched items to summarize."));
        results.push({ phase: "summarize", success: true, message: "No items" });
      } else {
        ctx.writeLine(`Summarizing ${fmt.num(fetchedItems.length)} fetched items...`);

        if (dryRun) {
          ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
          results.push({ phase: "summarize", success: true, message: "Dry run" });
        } else {
          const paths = fetchedItems.map((i) => i.relativePath).join("\n  - ");
          ctx.writeLine(fmt.info("Starting Claude Code agent..."));
          ctx.writeLine("");
          const summaryResult = await runAgent({
            boxRoot: ctx.boxRoot,
            systemPrompt: buildSummaryPrompt(ctx.boxRoot),
            prompt: `Please create a summary from these fetched items:\n  - ${paths}`,
            onOutput: (text) => {
              // Stream raw output from Claude Code
              ctx.write(text);
            },
          });
          ctx.writeLine("");
          if (summaryResult.success) {
            ctx.writeLine(fmt.ok("Agent finished successfully"));
          } else {
            ctx.writeLine(fmt.fail(`Agent error: ${summaryResult.error}`));
          }

          if (!summaryResult.success) {
            results.push({ phase: "summarize", success: false, message: summaryResult.error ?? "Failed" });
          } else {
            results.push({ phase: "summarize", success: true, message: `Summarized ${fetchedItems.length} items` });
          }

          // Commit summary changes
          const status = await getStatus(ctx.boxRoot);
          if (!status.clean) {
            await stageAll(ctx.boxRoot);
            await commit(ctx.boxRoot, {
              message: "Create news summary",
              trailers: { "Triggered-By": "cb process-news", Phase: "summarize" },
            });
            ctx.writeLine(fmt.dim("  Summary changes committed."));
          }
        }
      }
      ctx.writeLine("");
    }

    // Summary
    ctx.writeLine(fmt.phase("Results"));
    for (const r of results) {
      ctx.writeLine(fmt.result(r.success, r.phase, r.message));
    }

    const allSuccess = results.every((r) => r.success);
    if (allSuccess) {
      return {
        success: true,
        data: { results },
      };
    } else {
      return {
        success: false,
        data: { results },
        error: "Some phases failed",
      };
    }
  } finally {
    await releaseLock(ctx.boxRoot);
  }
}

// Register the command
registerCommand({
  name: "process-news",
  description: "Run the news processing agent (triage, fetch, summarize)",
  args: [
    {
      name: "batchSize",
      description: "Maximum items to process per phase",
      required: false,
      default: 5,
      type: "number",
    },
    {
      name: "triageOnly",
      description: "Only run triage phase",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "fetchOnly",
      description: "Only run fetch phase",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "summarizeOnly",
      description: "Only run summarize phase",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "dryRun",
      description: "Show what would happen without doing it",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "force",
      description: "Force even if another process is running",
      required: false,
      default: false,
      type: "boolean",
    },
  ],
  execute: executeProcessNews,
});

export { executeProcessNews };
