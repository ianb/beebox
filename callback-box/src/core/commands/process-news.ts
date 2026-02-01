/**
 * Process-news command - Run the news processing agent.
 *
 * This command invokes Claude Code to process news through three phases:
 *
 * 1. TRIAGE: Review items in box/inbox/news/
 *    - Move uninteresting items to store/trash/news/
 *    - Keep interesting items for analysis
 *
 * 2. ANALYZE: For items that passed triage
 *    - Fetch full article content
 *    - Create analysis (topics, type, thesis, how to use it)
 *    - Move to box/pool/news/
 *
 * 3. CREATE EDITION: From items in box/pool/news/
 *    - Identify themes and notable items
 *    - Create a news-edition card with narrative structure
 *    - Move used items to store/archive/news/
 *
 * Status is expressed by LOCATION, not by attribute:
 * - box/inbox/news/     → New, awaiting triage
 * - box/pool/news/      → Analyzed, ready for edition
 * - store/archive/news/ → Used in an edition
 * - store/trash/news/   → Skipped as uninteresting
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
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
  /** Only do triage phase */
  triageOnly?: boolean;
  /** Only do analyze phase (for items already triaged) */
  analyzeOnly?: boolean;
  /** Only do edition creation phase (for items already analyzed) */
  editionOnly?: boolean;
  /** Show what would happen without doing it */
  dryRun?: boolean;
  /** Force even if another process is running */
  force?: boolean;
}

/**
 * Get news items from a specific directory.
 */
async function getNewsFromDir(boxRoot: string, relativeDir: string): Promise<string[]> {
  const dir = path.join(boxRoot, relativeDir);
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => f.endsWith(".news-item.card"))
      .map((f) => path.join(relativeDir, f));
  } catch {
    return [];
  }
}

/**
 * Ensure a directory exists.
 */
async function ensureDir(boxRoot: string, relativeDir: string): Promise<void> {
  const dir = path.join(boxRoot, relativeDir);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Build the system prompt for news triage.
 */
function buildTriagePrompt(boxRoot: string, batchSize: number): string {
  return `You are triaging news items in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
Review news items in box/inbox/news/ and decide which are worth reading in full.

BATCH SIZE: Process up to ${batchSize} items in this run.

FOR EACH NEWS ITEM:
1. Read the title and summary from the card
2. Decide: Is this likely interesting based on the title/summary?
3. Take action based on your decision:

   INTERESTING → Keep the file where it is (we'll analyze it next)

   NOT INTERESTING → Move to trash:
   \`\`\`
   cb trash <path> --reason "Not interesting: [brief reason]"
   \`\`\`

CRITERIA FOR "INTERESTING":
- Technical content (programming, systems, architecture)
- Novel ideas or approaches
- Significant news in tech/science
- Things that would be educational or useful
- Opinion pieces with substantive arguments

NOT INTERESTING (trash):
- Marketing/promotional content
- Listicles without substance
- Repetitive news already covered elsewhere
- Entertainment gossip
- Job postings, hiring announcements
- Press releases without substance

IMPORTANT: Status is expressed by location, not attributes. Don't modify the status attribute.
Items stay in inbox/news/ if interesting, or get trashed if not.

When done, briefly state how many you kept vs trashed.`;
}

/**
 * Build the system prompt for content analysis.
 */
function buildAnalyzePrompt(boxRoot: string): string {
  return `You are analyzing news articles in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
For each news item in box/inbox/news/ that passed triage:
1. Fetch the full article content
2. Create an analysis of how this article fits into the "mental space"
3. Move the analyzed item to box/pool/news/

STEP 1 - FETCH CONTENT:
Run: cb fetch-news <path>

This fetches the article and adds <content> to the card.

STEP 2 - ADD ANALYSIS:
Edit the card to add an <analysis> element. This is NOT a summary of the content
(the content is already there). Instead, analyze:

- Topics: What themes/subjects does it cover?
- Type: Is it news, opinion, tutorial, announcement, research, etc.?
- Thesis: If opinion/analysis, what's the main argument?
- Tone: Measured, urgent, casual, academic, promotional?
- Timeliness: Is it breaking news, timely, or evergreen?
- Notes: How might this be used in an edition? What pairs well with it?
- Questions: Any open questions this raises?

Example analysis element:
\`\`\`xml
<analysis analyzed-at="${new Date().toISOString()}">
  <topics>
    <topic>AI safety</topic>
    <topic>regulation</topic>
  </topics>
  <type>opinion</type>
  <thesis>AI regulation should focus on outcomes rather than methods</thesis>
  <tone>measured, academic</tone>
  <timeliness>evergreen</timeliness>
  <notes>Could pair well with EU AI Act coverage. Author is respected in the field.</notes>
  <questions>
    <question>How does this compare to the Anthropic safety approach?</question>
  </questions>
</analysis>
\`\`\`

STEP 3 - MOVE TO POOL:
After adding the analysis, move the file:
\`\`\`
mkdir -p box/pool/news
mv <inbox-path> box/pool/news/
git add box/pool/news/<filename>
\`\`\`

Then commit all changes.

When done, state what was analyzed and any notable themes emerging.`;
}

/**
 * Build the system prompt for edition creation.
 */
function buildEditionPrompt(boxRoot: string): string {
  return `You are creating a news edition in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
Create a news-edition card from items in box/pool/news/. This is a narrative publication,
not just a list of summaries.

STEP 1 - SURVEY THE POOL:
Read all items in box/pool/news/ with their <analysis> elements.
Look for:
- Common themes that connect multiple articles
- Timely items that should be featured today
- Interesting contrasts or tensions between pieces
- A narrative arc that could make this edition compelling

Optionally, read recent editions in store/archive/editions/ to:
- Avoid repeating themes too soon
- Build on ongoing stories
- Reference previous coverage

STEP 2 - PLAN THE EDITION:
Before writing, decide:
- What's the headline/angle for this edition?
- What 2-3 themes or sections will structure it?
- Which articles are primary (drive the narrative)?
- Which are supporting (add depth)?
- What expandos would enhance without cluttering?
- Are there questions to pose to the reader?

STEP 3 - CREATE THE EDITION:
Create the edition file:
\`\`\`
cb create box/inbox/editions/<date>_<slug>.news-edition.card
\`\`\`

Then edit it with this structure:

\`\`\`xml
<news-edition status="draft">
  <title>Compelling headline that captures the theme</title>
  <date>${new Date().toISOString().slice(0, 10)}</date>
  <byline>One sentence teaser of what's inside</byline>

  <content format="markdown">
The opening paragraph sets up the theme. What connects today's stories?
What makes this moment interesting?

<section id="s1" heading="First Theme">

The narrative for this theme. Don't just list articles—tell a story about
what's happening in this space.

<expando title="Deep dive: Technical details" id="exp1">
More detailed content that interested readers can explore.
Quote directly from sources when relevant.

> "Direct quotes add credibility and voice" — Source
</expando>

<expando title="Background: Why this matters" id="exp2">
Context that helps readers understand significance.
</expando>

</section>

<section id="s2" heading="Second Theme">

Another narrative thread...

<query id="q1" prompt="What aspects of this interest you most?">
Understanding your interests helps focus future coverage.
</query>

</section>

Closing thoughts that tie things together or look ahead.
  </content>

  <sources>
    <source path="box/pool/news/Article_One.news-item.card" usage="primary">Article Title</source>
    <source path="box/pool/news/Article_Two.news-item.card" usage="supporting">Article Title</source>
  </sources>
</news-edition>
\`\`\`

GUIDELINES:
- BE LIBERAL with expandos - long is fine if it's expandable
- The main narrative should be scannable (1-2 paragraphs per section)
- Use expandos for: technical details, background, quotes, tangents
- Use queries to invite reader engagement (but sparingly)
- Quote sources directly when they say it better
- Link themes across articles, don't just list them

STEP 4 - ARCHIVE USED ITEMS:
After creating the edition, move used items to archive:
\`\`\`
mkdir -p store/archive/news
mv box/pool/news/<used-file> store/archive/news/
git add store/archive/news/<used-file>
\`\`\`

Leave items in pool that weren't used—they'll be available for future editions.

Commit all changes with a message like "Create news edition: [title]"

When done, state the edition title and what was included.`;
}

/**
 * Execute the process-news command.
 */
async function executeProcessNews(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const processArgs = args as ProcessNewsArgs;
  const batchSize = processArgs.batchSize ?? 10;
  const dryRun = processArgs.dryRun ?? false;

  // Determine which phases to run
  const runTriage = !processArgs.analyzeOnly && !processArgs.editionOnly;
  const runAnalyze = !processArgs.triageOnly && !processArgs.editionOnly;
  const runEdition = !processArgs.triageOnly && !processArgs.analyzeOnly;

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

  // Ensure directories exist
  await ensureDir(ctx.boxRoot, "box/inbox/news");
  await ensureDir(ctx.boxRoot, "box/pool/news");
  await ensureDir(ctx.boxRoot, "box/inbox/editions");
  await ensureDir(ctx.boxRoot, "store/archive/news");
  await ensureDir(ctx.boxRoot, "store/archive/editions");
  await ensureDir(ctx.boxRoot, "store/trash/news");

  const results: { phase: string; success: boolean; message: string }[] = [];

  try {
    // Phase 1: Triage
    if (runTriage) {
      ctx.writeLine(fmt.phase("Phase 1: Triage"));
      const inboxItems = await getNewsFromDir(ctx.boxRoot, "box/inbox/news");

      if (inboxItems.length === 0) {
        ctx.writeLine(fmt.dim("No items in inbox to triage."));
        results.push({ phase: "triage", success: true, message: "No items" });
      } else {
        const itemsToProcess = inboxItems.slice(0, batchSize);
        ctx.writeLine(fmt.progress(itemsToProcess.length, inboxItems.length, "items to triage"));

        if (dryRun) {
          ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
          results.push({ phase: "triage", success: true, message: "Dry run" });
        } else {
          const paths = itemsToProcess.join("\n  - ");
          ctx.writeLine(fmt.info("Starting Claude Code agent..."));
          ctx.writeLine("");
          const triageResult = await runAgent({
            boxRoot: ctx.boxRoot,
            systemPrompt: buildTriagePrompt(ctx.boxRoot, batchSize),
            prompt: `Please triage these news items:\n  - ${paths}`,
            onOutput: (text) => ctx.write(text),
          });
          ctx.writeLine("");

          if (triageResult.success) {
            ctx.writeLine(fmt.ok("Agent finished successfully"));
            results.push({ phase: "triage", success: true, message: `Triaged ${itemsToProcess.length} items` });
          } else {
            ctx.writeLine(fmt.fail(`Agent error: ${triageResult.error}`));
            results.push({ phase: "triage", success: false, message: triageResult.error ?? "Failed" });
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

    // Phase 2: Analyze
    if (runAnalyze) {
      ctx.writeLine(fmt.phase("Phase 2: Analyze"));
      // After triage, interesting items are still in inbox/news
      const inboxItems = await getNewsFromDir(ctx.boxRoot, "box/inbox/news");

      if (inboxItems.length === 0) {
        ctx.writeLine(fmt.dim("No items to analyze."));
        results.push({ phase: "analyze", success: true, message: "No items" });
      } else {
        const itemsToAnalyze = inboxItems.slice(0, batchSize);
        ctx.writeLine(fmt.progress(itemsToAnalyze.length, inboxItems.length, "items to analyze"));

        if (dryRun) {
          ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
          results.push({ phase: "analyze", success: true, message: "Dry run" });
        } else {
          const paths = itemsToAnalyze.join("\n  - ");
          ctx.writeLine(fmt.info("Starting Claude Code agent..."));
          ctx.writeLine("");
          const analyzeResult = await runAgent({
            boxRoot: ctx.boxRoot,
            systemPrompt: buildAnalyzePrompt(ctx.boxRoot),
            prompt: `Please analyze these news items:\n  - ${paths}`,
            onOutput: (text) => ctx.write(text),
          });
          ctx.writeLine("");

          if (analyzeResult.success) {
            ctx.writeLine(fmt.ok("Agent finished successfully"));
            results.push({ phase: "analyze", success: true, message: `Analyzed ${itemsToAnalyze.length} items` });
          } else {
            ctx.writeLine(fmt.fail(`Agent error: ${analyzeResult.error}`));
            results.push({ phase: "analyze", success: false, message: analyzeResult.error ?? "Failed" });
          }

          // Commit analysis changes
          const status = await getStatus(ctx.boxRoot);
          if (!status.clean) {
            await stageAll(ctx.boxRoot);
            await commit(ctx.boxRoot, {
              message: `Analyze ${itemsToAnalyze.length} news items`,
              trailers: { "Triggered-By": "cb process-news", Phase: "analyze" },
            });
            ctx.writeLine(fmt.dim("  Analysis changes committed."));
          }
        }
      }
      ctx.writeLine("");
    }

    // Phase 3: Create Edition
    if (runEdition) {
      ctx.writeLine(fmt.phase("Phase 3: Create Edition"));
      const poolItems = await getNewsFromDir(ctx.boxRoot, "box/pool/news");

      if (poolItems.length === 0) {
        ctx.writeLine(fmt.dim("No items in pool to create edition from."));
        results.push({ phase: "edition", success: true, message: "No items" });
      } else {
        ctx.writeLine(`Creating edition from ${fmt.num(poolItems.length)} pooled items...`);

        if (dryRun) {
          ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
          results.push({ phase: "edition", success: true, message: "Dry run" });
        } else {
          ctx.writeLine(fmt.info("Starting Claude Code agent..."));
          ctx.writeLine("");
          const editionResult = await runAgent({
            boxRoot: ctx.boxRoot,
            systemPrompt: buildEditionPrompt(ctx.boxRoot),
            prompt: `Please create a news edition from the items in box/pool/news/`,
            onOutput: (text) => ctx.write(text),
          });
          ctx.writeLine("");

          if (editionResult.success) {
            ctx.writeLine(fmt.ok("Agent finished successfully"));
            results.push({ phase: "edition", success: true, message: "Edition created" });
          } else {
            ctx.writeLine(fmt.fail(`Agent error: ${editionResult.error}`));
            results.push({ phase: "edition", success: false, message: editionResult.error ?? "Failed" });
          }

          // Commit edition changes
          const status = await getStatus(ctx.boxRoot);
          if (!status.clean) {
            await stageAll(ctx.boxRoot);
            await commit(ctx.boxRoot, {
              message: "Create news edition",
              trailers: { "Triggered-By": "cb process-news", Phase: "edition" },
            });
            ctx.writeLine(fmt.dim("  Edition changes committed."));
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
  description: "Run the news processing agent (triage, analyze, create edition)",
  args: [
    {
      name: "batchSize",
      description: "Maximum items to process per phase",
      required: false,
      default: 10,
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
      name: "analyzeOnly",
      description: "Only run analyze phase",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "editionOnly",
      description: "Only run edition creation phase",
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
