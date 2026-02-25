/**
 * Process-news command - Run the news processing agent.
 *
 * This command invokes Claude Code to process news through four phases:
 *
 * 1. TRIAGE: Review items in box/inbox/news/
 *    - Move uninteresting items to store/trash/news/
 *    - Keep interesting items for analysis
 *
 * 2. FETCH: Fetch article content for triaged items
 *    - Runs in outer code (parallel, no agent)
 *    - Adds <content> to each card
 *
 * 3. ANALYZE: For items with fetched content
 *    - Create analysis (topics, type, thesis, how to use it)
 *    - Move to box/pool/news/
 *
 * 4. CREATE BRIEF: From items in box/pool/news/
 *    - Identify themes and notable items
 *    - Create a news-brief card with narrative structure
 *    - Move used items to store/archive/news/
 *
 * Status is expressed by LOCATION, not by attribute:
 * - box/inbox/news/     → New, awaiting triage
 * - box/pool/news/      → Analyzed, ready for brief
 * - store/archive/news/ → Used in a brief
 * - store/trash/news/   → Skipped as uninteresting
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
  runCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { runAgent, ensureAgentCommitted } from "../agent.js";
import { acquireLock, releaseLock, getLockInfo } from "../../cli/lib/lock.js";
import { stageAll, commit } from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";
import { fetchAllNewsItems } from "./fetch-all-news.js";
import { parseXml } from "cardworks";

/**
 * Arguments for the process-news command.
 */
export interface ProcessNewsArgs {
  /** Maximum number of items to process in this run */
  batchSize?: number;
  /** Only do triage phase */
  triageOnly?: boolean;
  /** Only do fetch phase */
  fetchOnly?: boolean;
  /** Only do analyze phase (for items already triaged) */
  analyzeOnly?: boolean;
  /** Only do brief creation phase (for items already analyzed) */
  briefOnly?: boolean;
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
 * Metadata extracted from a news-item card for batch triage.
 */
interface NewsItemMetadata {
  path: string;
  title: string;
  author: string;
  published: string;
  feed: string;
}

/**
 * Extract metadata from news-item cards using parseXml.
 */
async function extractNewsMetadata(
  boxRoot: string,
  items: string[]
): Promise<NewsItemMetadata[]> {
  const results: NewsItemMetadata[] = [];
  for (const relPath of items) {
    try {
      const content = await fs.readFile(path.join(boxRoot, relPath), "utf-8");
      const root = await parseXml(content, relPath);
      let title = "";
      let author = "";
      let published = "";
      let feed = "";
      for (const child of root.children) {
        switch (child.tagName) {
          case "title":
            title = child.text ?? "";
            break;
          case "author":
            author = child.text ?? "";
            break;
          case "published":
            published = child.text ?? "";
            break;
          case "feed":
            feed = child.text ?? "";
            break;
        }
      }
      results.push({ path: relPath, title, author, published, feed });
    } catch {
      // If we can't parse a card, include it with minimal info
      results.push({ path: relPath, title: "(parse error)", author: "", published: "", feed: "" });
    }
  }
  return results;
}

/**
 * Load the news guide content for inline inclusion in the triage prompt.
 */
async function loadGuideContent(boxRoot: string): Promise<string | null> {
  // Prefer compiled reference
  try {
    return await fs.readFile(
      path.join(boxRoot, "docs/generated/news-guide.md"),
      "utf-8"
    );
  } catch {
    // Fall back to raw guide card
    try {
      return await fs.readFile(
        path.join(boxRoot, "config/news.guide.card"),
        "utf-8"
      );
    } catch {
      return null;
    }
  }
}

/**
 * Build the prompt for batch news triage.
 * The LLM picks the best N items from a list of metadata — no tools needed.
 */
function buildTriagePrompt(opts: {
  metadata: NewsItemMetadata[];
  guideContent: string | null;
  selectCount: number;
}): string {
  const { metadata, guideContent, selectCount } = opts;
  const guideSection = guideContent
    ? guideContent
    : "No guide configured. Use general interest criteria: prioritize substantive news, analysis, and technical content. Deprioritize marketing, listicles, press releases, and gossip.";

  const itemLines = metadata
    .map((m, i) => {
      const parts = [m.title || "(no title)"];
      if (m.author) parts.push(m.author);
      if (m.published) parts.push(m.published.slice(0, 10));
      if (m.feed) parts.push(m.feed);
      return `${i + 1}. ${parts.join(" — ")}`;
    })
    .join("\n");

  return `You are selecting the most interesting news items for a personal reader.

USER'S NEWS GUIDE:
${guideSection}

ITEMS:
${itemLines}

Select the ${selectCount} most interesting items based on the guide above.
If there are fewer than ${selectCount} interesting items, select fewer — don't pad with uninteresting ones.

Output a JSON array of the selected item numbers, e.g. [1, 5, 12, 23].
Output ONLY the JSON array, nothing else.`;
}

/**
 * Build the system prompt for content analysis.
 */
function buildAnalyzePrompt(boxRoot: string): string {
  return `You are analyzing news articles in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
For each news item in box/inbox/news/:
1. Read the card (it already has <content> with the fetched article)
2. Create an analysis of how this article fits into the "mental space"
3. Move the analyzed item to box/pool/news/

STEP 1 - READ AND ANALYZE:
Each card already has a <content> element with the fetched article in markdown format.
Read the content and add an <analysis> element. This is NOT a summary of the content
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

If a card has a <fetch-error> instead of <content>, note it in the analysis and
still move it to pool — the brief can decide whether to include it based on
title/summary alone or skip it.

STEP 2 - MOVE TO POOL:
After adding the analysis, move the file:
\`\`\`
cb move <inbox-path> box/pool/news/
\`\`\`

This command handles moving the file and updating any references.
Then commit all changes.

OUTPUT: As you process each item, state what you found:
  ANALYZED: [filename] - [topics/type/timeliness summary]

When done, commit your changes with a detailed message:

\`\`\`bash
git add -A && git commit -m "$(cat <<'EOF'
Analyze <N> items: <key themes>

Items:
- <title> (<type>, <timeliness>) - <topics>
- <title> (<type>, <timeliness>) - <topics>

Emerging themes: <notable patterns or connections>

Triggered-By: cb process-news
Phase: analyze
EOF
)"
\`\`\`

GIT: Do NOT add Co-Authored-By to commits. The system adds appropriate trailers automatically.`;
}

/**
 * Build the system prompt for brief creation.
 */
function buildBriefPrompt(boxRoot: string): string {
  return `You are creating a personal news brief in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

YOUR ROLE:
You are a personal assistant curating news for ONE reader. This is not journalism competing
for attention on a crowded homepage. You don't need to convince anyone to read—they already
want to. Your job is to serve the reader's genuine interests, not to maximize engagement.

AVOID:
- Clickbait headlines ("Your Phone's Secret Conversations", "What They Don't Want You to Know")
- Urgency and alarm ("Breaking:", "Critical:", manufactured importance)
- Mystery as hook (hiding the point to create curiosity)
- Superlatives and hype ("Revolutionary", "Game-changing", "Mind-blowing")
- Treating speculation as fact

INSTEAD:
- Be direct and informative ("New EU AI regulation passes", "How the exploit works")
- Trust the reader's intelligence and curiosity
- Let interesting things be interesting on their own merits
- Summarize accurately rather than tantalizingly
- Be a knowledgeable friend, not a headline writer

CRITICAL - PROVIDE FULL CONTEXT:
The reader has NOT read the source articles. They only see what you write. For each story:
- Introduce what happened and why it matters BEFORE diving into analysis
- Include enough background that the piece stands alone
- Use <excerpt> elements to quote key passages from the source—this provides texture and
  lets the original author's voice come through
- Don't assume shared context; restate key facts even if they seem obvious

YOUR TASK:
Create a news-brief card from items in box/pool/news/. This is a narrative publication,
not just a list of summaries.

STEP 0 - READ OR CREATE THE USER GUIDE:
First, check if config/news.guide.card exists. If it does, read it to understand:
- Triage rules (what to prioritize or skip, with confidence levels)
- Actions (what to do with items — Write Brief, Skip, Ask User, etc.)
- Active experiments to test
- Context notes that might affect curation

Also check docs/generated/news-guide.md for the compiled reference version.

If the guide exists but has NO active/proposed experiments (all are successful/unsuccessful/inconclusive),
create 1-2 new experiments based on what you've learned. The guide should always have experiments to run.

If no guide exists, create one:
\`\`\`
cb create config/news.guide.card -t guide --name news
\`\`\`

IMPORTANT schema rules:
- confidence must be: confirmed, high, medium, low, or hypothesis
- source must be: user-stated, feedback, inferred, or default
- experiment status must be: proposed, active, successful, unsuccessful, or inconclusive

STEP 1 - SURVEY THE POOL:
Read all items in box/pool/news/ with their <analysis> elements.
Look for:
- Common themes that connect multiple articles
- Timely items that should be featured today
- Interesting contrasts or tensions between pieces
- A narrative arc that could make this edition compelling
- Opportunities to test hypotheses from the guide

Optionally, read recent briefs in store/archive/briefs/ to:
- Avoid repeating themes too soon
- Build on ongoing stories
- Reference previous coverage

STEP 2 - PLAN THE BRIEF:
Before writing, decide:
- What's the headline/angle for this brief?
- What 2-3 themes or sections will structure it?
- Which articles are primary (drive the narrative)?
- Which are supporting (add depth)?
- What expandos would enhance without cluttering?
- Are there questions to pose to the reader?

STEP 3 - CREATE THE BRIEF:
Create the brief file in box/output/briefs/ (NOT inbox - briefs are output, not incoming items):
\`\`\`
cb create box/output/briefs/<date>_<slug>.news-brief.card
\`\`\`

Then edit it with this structure. IMPORTANT: <curation> comes FIRST because editorial
decisions should be made before writing content:

\`\`\`xml
<news-brief>
  <curation guide-version="[timestamp from guide's updated-at]">
    <interest application="featured">Topic from guide that was featured</interest>
    <interest application="tested">Topic being tested as hypothesis</interest>
    <experiment-ref id="exp-id">How this edition tests the experiment</experiment-ref>
    <hypothesis id="h1" experiment-ref="exp-id">
      Specific testable claim about what will work
    </hypothesis>
    <rationale>
      Brief explanation of editorial choices and why this angle/approach was selected.
    </rationale>
  </curation>

  <title>Compelling headline that captures the theme</title>
  <date>${new Date().toISOString().slice(0, 10)}</date>
  <byline>One sentence teaser of what's inside</byline>

  <content format="markdown">
The opening paragraph sets up the theme. What connects today's stories?
What makes this moment interesting?

<section id="s1" heading="First Theme" link="https://example.com/article" via="Hacker News">

**Start with context**: What is this about? Who did what? This is for a reader who hasn't
seen the article—introduce the subject, the situation, the key facts.

Then your analysis and narrative. Don't just list articles—tell a story about
what's happening in this space.

<excerpt source="Article Title" link="https://example.com/article">
A memorable passage from the article that captures something essential—the author's
voice, a key technical point, or a surprising finding. Do NOT include quotation marks.
</excerpt>

<expando title="Deep dive: Technical details" id="exp1">
More detailed content that interested readers can explore.
Use more excerpts here for depth.
</expando>

</section>

<section id="s2" heading="Second Theme" link="https://example.com/other" via="Lobsters">

Again, establish context first. Who? What? When? Why does this matter?

Then your narrative...

<query id="q1" prompt="What aspects of this interest you most?">
Understanding your interests helps focus future coverage.
</query>

</section>

Closing thoughts that tie things together or look ahead.
  </content>

  <sources>
    <source path="store/archive/news/Article_One.news-item.card" usage="primary">Article Title</source>
    <source path="store/archive/news/Article_Two.news-item.card" usage="supporting">Article Title</source>
  </sources>
</news-brief>
\`\`\`

CURATION NOTES:
- <curation> comes FIRST - decide what to write about before writing
- Include interests that drove content selection
- Reference active experiments being tested
- State hypotheses that feedback can confirm/deny
- The rationale explains your editorial thinking

GUIDELINES:
- EVERY SECTION needs: link= to the source article, via= to note the feed source (e.g., "Hacker News")
- Include <excerpt> elements liberally—at least one per section, more in expandos
- The <feed> element in each news-item card contains the feed title (use this for "via")
- The <link> element in each news-item card has the article URL
- Provide full context: the reader knows NOTHING except what you write
- BE LIBERAL with expandos - long is fine if it's expandable
- The main narrative should be scannable (1-2 paragraphs per section)
- Use expandos for: technical details, background, quotes, tangents
- Use queries to invite reader engagement (but sparingly)
- Quote sources directly when they say it better
- Link themes across articles, don't just list them

STEP 4 - ARCHIVE USED ITEMS:
After creating the brief, move used items to archive:
\`\`\`
cb move box/pool/news/<used-file> store/archive/news/
\`\`\`

This command handles moving and updating any references (including in the brief you just created).
Leave items in pool that weren't used—they'll be available for future briefs.

When done, commit your changes with a detailed message:

\`\`\`bash
git add -A && git commit -m "$(cat <<'EOF'
Brief: <title>

Sections:
- <section heading> (<source article title>)
- <section heading> (<source article title>)

<N> items used, <M> left in pool.
Editorial angle: <one sentence on why this angle/structure>

Triggered-By: cb process-news
Phase: brief
EOF
)"
\`\`\`

GIT: Do NOT add Co-Authored-By to commits. The system adds appropriate trailers automatically.`;
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
  const runTriage = !processArgs.analyzeOnly && !processArgs.briefOnly && !processArgs.fetchOnly;
  const runFetch = !processArgs.triageOnly && !processArgs.briefOnly;
  const runAnalyze = !processArgs.triageOnly && !processArgs.briefOnly && !processArgs.fetchOnly;
  const runBrief = !processArgs.triageOnly && !processArgs.analyzeOnly && !processArgs.fetchOnly;

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
  await ensureDir(ctx.boxRoot, "box/output/briefs");
  await ensureDir(ctx.boxRoot, "store/archive/news");
  await ensureDir(ctx.boxRoot, "store/archive/briefs");
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
        const selectCount = batchSize * 3;
        ctx.writeLine(`Triaging ${fmt.num(inboxItems.length)} items (selecting up to ${selectCount})...`);

        if (dryRun) {
          ctx.writeLine(fmt.dim("(dry run - skipping triage)"));
          results.push({ phase: "triage", success: true, message: "Dry run" });
        } else {
          // Extract metadata from all cards
          ctx.writeLine(fmt.info("Extracting metadata..."));
          const metadata = await extractNewsMetadata(ctx.boxRoot, inboxItems);
          const guideContent = await loadGuideContent(ctx.boxRoot);

          // Single LLM call to pick best items
          ctx.writeLine(fmt.info("Selecting items (Haiku, single call)..."));
          const triageResult = await runAgent({
            boxRoot: ctx.boxRoot,
            systemPrompt: buildTriagePrompt({ metadata, guideContent, selectCount }),
            prompt: "Select the best items now.",
            onOutput: (text) => ctx.write(text),
            model: "claude-haiku-4-5-20251001",
            maxTurns: 1,
          });
          ctx.writeLine("");

          // Parse selected indices from the LLM response
          let selectedIndices: number[] = [];
          if (triageResult.success && triageResult.output) {
            const match = /\[[\d\s,]+]/.exec(triageResult.output);
            if (match) {
              try {
                selectedIndices = JSON.parse(match[0]) as number[];
              } catch {
                ctx.writeLine(fmt.fail("Failed to parse selection JSON"));
              }
            }
          }

          if (selectedIndices.length === 0) {
            ctx.writeLine(fmt.fail("Triage returned no selections — keeping all items"));
            results.push({ phase: "triage", success: false, message: "No selections returned" });
          } else {
            // Determine which items to trash (not selected)
            const selectedSet = new Set(selectedIndices);
            const keptPaths: string[] = [];
            const trashPaths: string[] = [];
            for (const [i, m] of metadata.entries()) {
              if (selectedSet.has(i + 1)) {
                keptPaths.push(m.path);
              } else {
                trashPaths.push(m.path);
              }
            }

            ctx.writeLine(`Selected ${fmt.num(keptPaths.length)}, trashing ${fmt.num(trashPaths.length)}`);

            // Trash non-selected items
            if (trashPaths.length > 0) {
              await runCommand({
                name: "trash",
                args: {
                  paths: trashPaths,
                  reason: "Not selected during triage",
                },
                ctx,
              });
            }

            // Commit the triage
            await stageAll(ctx.boxRoot);
            await commit(ctx.boxRoot, {
              message: `Triage: ${keptPaths.length}/${metadata.length} items kept`,
              trailers: { "Triggered-By": "cb process-news", Phase: "triage" },
            });

            results.push({
              phase: "triage",
              success: true,
              message: `Kept ${keptPaths.length}, trashed ${trashPaths.length} of ${metadata.length}`,
            });
          }
        }
      }
      ctx.writeLine("");
    }

    // Phase 2: Fetch Content
    if (runFetch) {
      ctx.writeLine(fmt.phase("Phase 2: Fetch Content"));
      const inboxItems = await getNewsFromDir(ctx.boxRoot, "box/inbox/news");

      if (inboxItems.length === 0) {
        ctx.writeLine(fmt.dim("No items to fetch."));
        results.push({ phase: "fetch", success: true, message: "No items" });
      } else if (dryRun) {
        ctx.writeLine(fmt.dim(`(dry run - would fetch up to ${inboxItems.length} items)`));
        results.push({ phase: "fetch", success: true, message: "Dry run" });
      } else {
        const fetchResult = await fetchAllNewsItems({
          boxRoot: ctx.boxRoot,
          dir: "box/inbox/news",
          options: {
            concurrency: 5,
            onProgress: (msg) => ctx.writeLine(msg),
          },
        });

        // Commit fetched content
        if (fetchResult.fetched.length > 0 || fetchResult.failed.length > 0) {
          await stageAll(ctx.boxRoot);
          await commit(ctx.boxRoot, {
            message: `Fetch ${fetchResult.fetched.length} news article(s)${fetchResult.failed.length > 0 ? `, ${fetchResult.failed.length} failed` : ""}`,
            trailers: { "Triggered-By": "cb process-news", Phase: "fetch" },
          });
        }

        if (fetchResult.failed.length > 0) {
          results.push({ phase: "fetch", success: false, message: `${fetchResult.fetched.length} fetched, ${fetchResult.failed.length} failed` });
        } else {
          results.push({ phase: "fetch", success: true, message: `${fetchResult.fetched.length} fetched, ${fetchResult.skipped.length} skipped` });
        }
      }
      ctx.writeLine("");
    }

    // Phase 3: Analyze
    if (runAnalyze) {
      ctx.writeLine(fmt.phase("Phase 3: Analyze"));
      // After triage + fetch, items are still in inbox/news with content
      const inboxItems = await getNewsFromDir(ctx.boxRoot, "box/inbox/news");

      if (inboxItems.length === 0) {
        ctx.writeLine(fmt.dim("No items to analyze."));
        results.push({ phase: "analyze", success: true, message: "No items" });
      } else {
        const itemsToAnalyze = inboxItems.slice(0, batchSize);
        ctx.writeLine(fmt.progress({ current: itemsToAnalyze.length, total: inboxItems.length, label: "items to analyze" }));

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
            maxTurns: 20,
          });
          ctx.writeLine("");

          if (analyzeResult.success) {
            ctx.writeLine(fmt.ok("Agent finished successfully"));
            results.push({ phase: "analyze", success: true, message: `Analyzed ${itemsToAnalyze.length} items` });
          } else {
            ctx.writeLine(fmt.fail(`Agent error: ${analyzeResult.error}`));
            results.push({ phase: "analyze", success: false, message: analyzeResult.error ?? "Failed" });
          }

          // Retry if agent didn't commit, then fallback
          await ensureAgentCommitted({
            boxRoot: ctx.boxRoot,
            agentResult: analyzeResult,
            agentOptions: {
              boxRoot: ctx.boxRoot,
              systemPrompt: buildAnalyzePrompt(ctx.boxRoot),
              prompt: `Please analyze these news items:\n  - ${paths}`,
              maxTurns: 20,
            },
            fallbackMessage: `Analyze ${itemsToAnalyze.length} news items`,
            fallbackTrailers: { "Triggered-By": "cb process-news", Phase: "analyze", Session: analyzeResult.sessionId },
            onOutput: (text) => ctx.write(text),
          });
        }
      }
      ctx.writeLine("");
    }

    // Phase 4: Create Brief
    if (runBrief) {
      ctx.writeLine(fmt.phase("Phase 4: Create Brief"));
      const poolItems = await getNewsFromDir(ctx.boxRoot, "box/pool/news");

      if (poolItems.length === 0) {
        ctx.writeLine(fmt.dim("No items in pool to create brief from."));
        results.push({ phase: "brief", success: true, message: "No items" });
      } else {
        ctx.writeLine(`Creating brief from ${fmt.num(poolItems.length)} pooled items...`);

        if (dryRun) {
          ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
          results.push({ phase: "brief", success: true, message: "Dry run" });
        } else {
          ctx.writeLine(fmt.info("Starting Claude Code agent..."));
          ctx.writeLine("");
          const briefResult = await runAgent({
            boxRoot: ctx.boxRoot,
            systemPrompt: buildBriefPrompt(ctx.boxRoot),
            prompt: "Please create a news brief from the items in box/pool/news/",
            onOutput: (text) => ctx.write(text),
            maxTurns: 40,
          });
          ctx.writeLine("");

          if (briefResult.success) {
            ctx.writeLine(fmt.ok("Agent finished successfully"));
            results.push({ phase: "brief", success: true, message: "Brief created" });
          } else {
            ctx.writeLine(fmt.fail(`Agent error: ${briefResult.error}`));
            results.push({ phase: "brief", success: false, message: briefResult.error ?? "Failed" });
          }

          // Retry if agent didn't commit, then fallback
          await ensureAgentCommitted({
            boxRoot: ctx.boxRoot,
            agentResult: briefResult,
            agentOptions: {
              boxRoot: ctx.boxRoot,
              systemPrompt: buildBriefPrompt(ctx.boxRoot),
              prompt: "Please create a news brief from the items in box/pool/news/",
              maxTurns: 40,
            },
            fallbackMessage: "Create news brief",
            fallbackTrailers: { "Triggered-By": "cb process-news", Phase: "brief", Session: briefResult.sessionId },
            onOutput: (text) => ctx.write(text),
          });
        }
      }
      ctx.writeLine("");
    }

    // Summary
    ctx.writeLine(fmt.phase("Results"));
    for (const r of results) {
      ctx.writeLine(fmt.result({ success: r.success, label: r.phase, message: r.message }));
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
  description: "Run the news processing agent (triage, fetch, analyze, create brief)",
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
      name: "fetchOnly",
      description: "Only run fetch phase",
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
      name: "briefOnly",
      description: "Only run brief creation phase",
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
